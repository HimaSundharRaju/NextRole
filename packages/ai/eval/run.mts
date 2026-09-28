/*
 * Model quality check. Runs each candidate model on the same inputs for every feature, applies
 * the automatic checks, has two judges from different vendors compare each candidate with the
 * reference (Claude Sonnet 5), and reports the cheapest model per feature that matches it.
 *
 *   NODE_USE_ENV_PROXY=1 node --env-file=.env --import tsx packages/ai/eval/run.mts
 *
 * Options: --features tailor,cover_letter   --budget 15   --judge-items 8   --items 2 (smoke test)
 *          --no-spend yes (rebuild the report from cached results only; nothing new is called)
 * Every model and judge result is cached under packages/ai/eval/results/, so a rerun only pays
 * for what's missing, and the budget counts cached spend too.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Resume } from "@gettargetrole/resume/schema";
import { resumeToPlainText } from "@gettargetrole/resume/text";
import { AnthropicProvider } from "../src/anthropic-provider";
import { OpenAIProvider } from "../src/openai-provider";
import type {
  ApplicationAnswers,
  CoverLetter,
  FitAnalysis,
  ImportResult,
  InterviewPrep,
  OutreachDraft,
  TailorResult,
} from "../src/schemas";
import type { AiCallContext, AiProvider } from "../src/types";
import {
  checkAnswers,
  checkCoverLetter,
  checkFit,
  checkImport,
  checkInterview,
  checkOutreach,
  checkStudioEdit,
  checkTailor,
} from "./checks";
import { PAIRS, PERSONAS, QUESTIONS, STUDIO_CASES } from "./fixtures";
import { judge, JUDGES, type JudgeId, type JudgeResult } from "./judge";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]!.replace(/^--/, ""), process.argv[index + 1] ?? "");
}
const BUDGET_MICRO = Number(args.get("budget") ?? 15) * 1_000_000;
const JUDGE_ITEMS = Number(args.get("judge-items") ?? 8);
const ITEM_LIMIT = Number(args.get("items") ?? Number.POSITIVE_INFINITY);
const NO_SPEND = args.has("no-spend");
const RESULTS = new URL("./results/", import.meta.url);

interface Candidate {
  id: string;
  vendor: "anthropic" | "openai";
  model: string;
}

const CANDIDATES: Candidate[] = [
  { id: "sonnet-5", vendor: "anthropic", model: "claude-sonnet-5" },
  { id: "haiku-4.5", vendor: "anthropic", model: "claude-haiku-4-5" },
  { id: "gpt-5-mini", vendor: "openai", model: "gpt-5-mini" },
  { id: "gpt-4.1-mini", vendor: "openai", model: "gpt-4.1-mini" },
  { id: "gpt-4o-mini", vendor: "openai", model: "gpt-4o-mini" },
  { id: "gpt-5-nano", vendor: "openai", model: "gpt-5-nano" },
];
const REFERENCE = "sonnet-5";
/** People wait on these features, so a route must answer this fast on average. */
const MAX_AVG_MS = 30_000;
/** Checked against the reference on a few tailors: is Sonnet 5 as good as the current default? */
const SPOT_CHECK: Candidate = { id: "opus-5", vendor: "anthropic", model: "claude-opus-5" };

interface Item {
  id: string;
  task: string;
  resume: string;
  job: string;
  run: (ai: AiProvider, ctx: AiCallContext) => Promise<unknown>;
  check: (output: unknown) => string[];
  render: (output: unknown) => string;
}

interface Generated {
  output: unknown;
  error: string | null;
  costMicroUsd: number;
  ms: number;
}

// --- Ledger -------------------------------------------------------------------------------------

let spentMicro = 0;
const counted = new Set<string>();
class BudgetExceeded extends Error {}

/** A cached result; its cost counts toward the budget once per run. */
function readCache<T>(path: string): T | null {
  const url = new URL(path, RESULTS);
  if (!existsSync(url)) return null;
  const value = JSON.parse(readFileSync(url, "utf8")) as T & { costMicroUsd?: number };
  if (!counted.has(path)) {
    counted.add(path);
    spentMicro += value.costMicroUsd ?? 0;
  }
  return value;
}

function writeFile(path: string, contents: string): void {
  const url = new URL(path, RESULTS);
  mkdirSync(new URL(".", url), { recursive: true });
  writeFileSync(url, contents);
}

function writeCache(path: string, value: unknown): void {
  counted.add(path);
  writeFile(path, JSON.stringify(value, null, 2));
}

function guardBudget(): void {
  if (spentMicro >= BUDGET_MICRO) throw new BudgetExceeded("budget reached");
}

async function pool<T>(tasks: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return results;
}

function providerFor(candidate: Candidate): AiProvider {
  return candidate.vendor === "anthropic"
    ? new AnthropicProvider(() => candidate.model)
    : new OpenAIProvider(() => candidate.model);
}

// --- Items per feature ----------------------------------------------------------------------------

const text = (resume: Resume) => resumeToPlainText(resume);
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

function pairItems<T>(
  feature: string,
  task: string,
  run: (pair: (typeof PAIRS)[number], ai: AiProvider, ctx: AiCallContext) => Promise<T>,
  check: (pair: (typeof PAIRS)[number], output: T) => string[],
  render: (output: T) => string,
  limit = PAIRS.length,
): Item[] {
  return PAIRS.slice(0, limit).map((pair) => ({
    id: `${pair.persona.id}__${pair.job.key}`,
    task,
    resume: text(pair.persona.resume),
    job: `${pair.job.title} at ${pair.job.company}\n\n${pair.job.description}`,
    run: (ai, ctx) => run(pair, ai, ctx),
    check: (output) => check(pair, output as T),
    render: (output) => render(output as T),
  }));
}

async function buildItems(): Promise<Record<string, Item[]>> {
  const { renderResumePdf } = await import("@gettargetrole/resume/pdf");
  const pdfs = await Promise.all(PERSONAS.map((persona) => renderResumePdf(persona.resume)));
  return {
    tailor: pairItems<TailorResult>(
      "tailor",
      "Tailor the candidate's resume to the job without inventing anything.",
      ({ persona, job }, ai, ctx) => ai.tailorResume({ resume: persona.resume, job }, ctx),
      ({ persona }, output) => checkTailor(persona.resume, output),
      (output) =>
        `${text(output.resume)}\n\nWhat changed:\n${bullets(output.summaryOfChanges)}\nMissing: ${output.missingKeywords.join(", ")}`,
    ),
    cover_letter: pairItems<CoverLetter>(
      "cover_letter",
      "Write the candidate's cover letter for this job.",
      ({ persona, job }, ai, ctx) =>
        ai.writeCoverLetter({ resume: persona.resume, job, profile: persona.profile }, ctx),
      ({ persona, job }, output) => checkCoverLetter(persona.resume, job, output),
      (output) => `Subject: ${output.subject}\n\n${output.body}`,
    ),
    answers: pairItems<ApplicationAnswers>(
      "answers",
      `Answer these application questions for the candidate: ${QUESTIONS.join(" / ")}`,
      ({ persona, job }, ai, ctx) =>
        ai.answerQuestions(
          { resume: persona.resume, job, profile: persona.profile, questions: QUESTIONS },
          ctx,
        ),
      ({ persona, job }, output) =>
        checkAnswers(persona.resume, job, persona.profile, QUESTIONS, output),
      (output) =>
        output.answers.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n"),
    ),
    outreach: pairItems<OutreachDraft>(
      "outreach",
      "Draft a recruiter email, a LinkedIn connection note (under 300 characters) and a follow-up.",
      ({ persona, job }, ai, ctx) =>
        ai.draftOutreach(
          { resume: persona.resume, job, recipient: null, profile: persona.profile },
          ctx,
        ),
      ({ persona, job }, output) => checkOutreach(persona.resume, job, output),
      (output) =>
        `Email: ${output.email.subject}\n${output.email.body}\n\nLinkedIn: ${output.linkedinNote}\n\nFollow-up: ${output.followUp.subject}\n${output.followUp.body}`,
    ),
    match: pairItems<FitAnalysis>(
      "match",
      "Assess how well the candidate fits the job: a 0-100 score, verdict, strengths, gaps and a recommendation.",
      ({ persona, job }, ai, ctx) =>
        ai.analyzeFit({ resume: persona.resume, job, profile: persona.profile }, ctx),
      (_pair, output) => checkFit(output),
      (output) =>
        `Score ${output.score} (${output.verdict})\n${output.summary}\nStrengths:\n${bullets(output.strengths)}\nGaps:\n${bullets(output.gaps)}\n${output.recommendation}`,
    ),
    interview: pairItems<InterviewPrep>(
      "interview",
      "Prepare the candidate for interviews: likely questions with answer outlines from their real experience.",
      ({ persona, job }, ai, ctx) => ai.prepareInterview({ resume: persona.resume, job }, ctx),
      ({ persona, job }, output) => checkInterview(persona.resume, job, output),
      (output) =>
        output.questions
          .map((item) => `[${item.category}] ${item.question}\n${item.answerOutline}`)
          .join("\n\n"),
      10,
    ),
    import: PERSONAS.flatMap((persona, index) =>
      (["pdf", "text"] as const).map((kind) => ({
        id: `${persona.id}__${kind}`,
        task: "Convert the resume into structured data exactly as written.",
        resume: text(persona.resume),
        job: "",
        run: (ai: AiProvider, ctx: AiCallContext) =>
          ai.importResume(
            kind === "pdf"
              ? { kind: "pdf", data: pdfs[index]!, fileName: `${persona.id}.pdf` }
              : { kind: "text", text: text(persona.resume) },
            ctx,
          ),
        check: (output: unknown) => checkImport(persona.resume, output as ImportResult),
        render: (output: unknown) => text((output as ImportResult).resume),
      })),
    ),
    studio: PERSONAS.slice(0, 3).flatMap((persona) =>
      STUDIO_CASES.map((studioCase, index) => ({
        id: `${persona.id}__${index}`,
        task: `The candidate asked the resume editor: "${studioCase.message}"`,
        resume: text(persona.resume),
        job: "",
        run: async (ai: AiProvider, ctx: AiCallContext) => {
          let reply = "";
          let resume: Resume | null = null;
          for await (const event of ai.studioChat(
            {
              resume: persona.resume,
              history: [],
              message: studioCase.message,
              profile: persona.profile,
            },
            ctx,
          )) {
            if (event.type === "resume") resume = event.resume;
            if (event.type === "done") reply = event.reply;
            if (event.type === "error") throw new Error(event.message);
          }
          return { reply, resume };
        },
        check: (output: unknown) => {
          const { resume } = output as { resume: Resume | null };
          return checkStudioEdit(persona.resume, resume, studioCase.sections, studioCase.expect);
        },
        render: (output: unknown) => {
          const { reply, resume } = output as { reply: string; resume: Resume | null };
          return `${reply}\n\n${resume ? text(resume) : "(no edit)"}`;
        },
      })),
    ),
  };
}

// --- Running ------------------------------------------------------------------------------------

async function generate(feature: string, candidate: Candidate, item: Item): Promise<Generated> {
  const path = `${feature}/${candidate.id}/${item.id}.json`;
  const cached = readCache<Generated>(path);
  if (cached) return cached;
  if (NO_SPEND) return { output: null, error: "not run", costMicroUsd: 0, ms: 0 };
  guardBudget();
  let cost = 0;
  const started = Date.now();
  const ctx: AiCallContext = {
    userId: "eval",
    onUsage: (record) => {
      cost += record.costMicroUsd;
    },
  };
  let result: Generated;
  try {
    const output = await item.run(providerFor(candidate), ctx);
    result = { output, error: null, costMicroUsd: cost, ms: Date.now() - started };
  } catch (error) {
    result = {
      output: null,
      error: error instanceof Error ? error.message : String(error),
      costMicroUsd: cost,
      ms: Date.now() - started,
    };
  }
  spentMicro += result.costMicroUsd;
  writeCache(path, result);
  return result;
}

function candidateFirst(key: string): boolean {
  return createHash("sha256").update(key).digest()[0]! % 2 === 0;
}

async function compare(
  feature: string,
  candidate: Candidate,
  item: Item,
  mine: Generated,
  reference: Generated,
): Promise<JudgeResult[]> {
  const results = await Promise.all(
    JUDGES.map(async ({ id }): Promise<JudgeResult | null> => {
      const path = `${feature}/judge/${candidate.id}/${item.id}__${id}.json`;
      const cached = readCache<JudgeResult>(path);
      if (cached) return cached;
      if (NO_SPEND) return null;
      guardBudget();
      const result = await judge(id, {
        task: item.task,
        resume: item.resume,
        job: item.job,
        candidate: item.render(mine.output),
        reference: item.render(reference.output),
        candidateFirst: candidateFirst(`${feature}/${candidate.id}/${item.id}`),
      });
      spentMicro += result.costMicroUsd;
      writeCache(path, result);
      return result;
    }),
  );
  return results.filter((result): result is JudgeResult => result !== null);
}

interface Row {
  candidate: string;
  model: string;
  ok: number;
  total: number;
  hardFailures: number;
  sampleFailures: string[];
  costPerSuccessMicro: number;
  avgMs: number;
  judged: Record<JudgeId, { win: number; tie: number; loss: number }>;
  eligible: boolean;
  /** Passed the checks but has no verdict from one of the judges yet. */
  pending: boolean;
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;

/** Progress and the report go to stdout; this is a command-line script. */
const print = (line: string) => process.stdout.write(`${line}\n`);

async function runFeature(feature: string, items: Item[]): Promise<Row[]> {
  const runs = new Map<string, Generated[]>();
  await Promise.all(
    CANDIDATES.map(async (candidate) => {
      runs.set(
        candidate.id,
        await pool(
          items.map((item) => () => generate(feature, candidate, item)),
          3,
        ),
      );
    }),
  );
  const failuresOf = (generated: Generated, item: Item) =>
    generated.error ? [`error: ${generated.error}`] : item.check(generated.output);
  const reference = runs.get(REFERENCE)!;
  const referenceFailures = reference.filter(
    (generated, index) => failuresOf(generated, items[index]!).length > 0,
  ).length;
  // Judge on items where the reference itself passed, so the comparison is against a good output.
  const judgeable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => failuresOf(reference[index]!, item).length === 0)
    .slice(0, JUDGE_ITEMS);

  const rows: Row[] = [];
  for (const candidate of CANDIDATES) {
    const generated = runs.get(candidate.id)!;
    const failures = generated.map((entry, index) => failuresOf(entry, items[index]!));
    const hardFailures = failures.filter((list) => list.length > 0).length;
    const ok = generated.length - hardFailures;
    const cost = generated.reduce((sum, entry) => sum + entry.costMicroUsd, 0);
    const avgMs = generated.reduce((sum, entry) => sum + entry.ms, 0) / generated.length;
    const judged = Object.fromEntries(
      JUDGES.map(({ id }) => [id, { win: 0, tie: 0, loss: 0 }]),
    ) as Row["judged"];
    const passesChecks = hardFailures <= referenceFailures;
    if (candidate.id !== REFERENCE && passesChecks) {
      const comparisons = await pool(
        judgeable
          .filter(({ index }) => !generated[index]!.error)
          .map(
            ({ item, index }) =>
              () =>
                compare(feature, candidate, item, generated[index]!, reference[index]!),
          ),
        4,
      );
      for (const results of comparisons) {
        for (const result of results) judged[result.judge][result.outcome] += 1;
      }
    }
    const winOrTie = (id: JudgeId) => {
      const { win, tie, loss } = judged[id];
      const total = win + tie + loss;
      return total === 0 ? 0 : (win + tie) / total;
    };
    rows.push({
      candidate: candidate.id,
      model: candidate.model,
      ok,
      total: generated.length,
      hardFailures,
      sampleFailures: failures.flat().slice(0, 4),
      costPerSuccessMicro: ok ? cost / ok : Number.POSITIVE_INFINITY,
      avgMs,
      judged,
      eligible:
        candidate.id === REFERENCE ||
        (passesChecks && avgMs <= MAX_AVG_MS && JUDGES.every(({ id }) => winOrTie(id) >= 0.5)),
      pending:
        candidate.id !== REFERENCE &&
        passesChecks &&
        JUDGES.some(({ id }) => judged[id].win + judged[id].tie + judged[id].loss === 0),
    });
  }
  return rows;
}

async function spotCheck(
  items: Item[],
): Promise<Record<JudgeId, { win: number; tie: number; loss: number }>> {
  const tally = Object.fromEntries(
    JUDGES.map(({ id }) => [id, { win: 0, tie: 0, loss: 0 }]),
  ) as Record<JudgeId, { win: number; tie: number; loss: number }>;
  for (const item of items.slice(0, 5)) {
    const opus = await generate("tailor", SPOT_CHECK, item);
    const reference = await generate("tailor", CANDIDATES[0]!, item);
    if (opus.error || reference.error) continue;
    for (const result of await compare("tailor", SPOT_CHECK, item, opus, reference)) {
      tally[result.judge][result.outcome] += 1;
    }
  }
  return tally;
}

// --- Report -------------------------------------------------------------------------------------

function report(
  results: Record<string, Row[]>,
  spot: Record<JudgeId, { win: number; tie: number; loss: number }> | null,
): string {
  const lines = [
    `# Model quality check`,
    ``,
    `Total spend: ${usd(spentMicro)} (budget ${usd(BUDGET_MICRO)}).`,
    ``,
  ];
  const routes: Record<string, string> = {};
  for (const [feature, rows] of Object.entries(results)) {
    const chosen = rows
      .filter((row) => row.eligible)
      .sort((a, b) => a.costPerSuccessMicro - b.costPerSuccessMicro)[0]!;
    routes[feature] = chosen.model;
    lines.push(`## ${feature}`, ``);
    lines.push(
      `| Model | Passed checks | Claude judge (win/tie/loss) | GPT judge (win/tie/loss) | Cost per success | Avg time | Eligible |`,
    );
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const row of rows) {
      const tally = (id: JudgeId) =>
        row.candidate === REFERENCE
          ? "reference"
          : `${row.judged[id].win}/${row.judged[id].tie}/${row.judged[id].loss}`;
      lines.push(
        `| ${row.model}${row.model === chosen.model ? " **(chosen)**" : ""} | ${row.ok}/${row.total} | ${tally("claude-judge")} | ${tally("gpt-judge")} | ${usd(row.costPerSuccessMicro)} | ${(row.avgMs / 1000).toFixed(1)}s | ${row.eligible ? "yes" : row.pending ? "judging pending" : "no"} |`,
      );
    }
    const failing = rows.filter((row) => row.sampleFailures.length);
    if (failing.length) {
      lines.push(``, `Sample check failures:`);
      for (const row of failing) lines.push(`- ${row.model}: ${row.sampleFailures.join("; ")}`);
    }
    lines.push(``);
  }
  if (spot) {
    lines.push(
      `## Spot check: Opus 5 vs Sonnet 5 on tailoring`,
      ``,
      `From Opus 5's side, win/tie/loss — Claude judge ${spot["claude-judge"].win}/${spot["claude-judge"].tie}/${spot["claude-judge"].loss}, GPT judge ${spot["gpt-judge"].win}/${spot["gpt-judge"].tie}/${spot["gpt-judge"].loss}.`,
      ``,
    );
  }
  lines.push(`## Routes`, ``, "```json", JSON.stringify(routes, null, 2), "```");
  return lines.join("\n");
}

// --- Main ---------------------------------------------------------------------------------------

const allItems = await buildItems();
const features = (args.get("features") ?? Object.keys(allItems).join(",")).split(",") as Array<
  keyof typeof allItems
>;
const results: Record<string, Row[]> = {};
let spot: Awaited<ReturnType<typeof spotCheck>> | null = null;
try {
  for (const feature of features) {
    const items = allItems[feature]!.slice(0, ITEM_LIMIT);
    print(`\n== ${feature} (${items.length} items) — spent so far ${usd(spentMicro)}`);
    results[feature] = await runFeature(feature, items);
    for (const row of results[feature]!) {
      print(
        `  ${row.model.padEnd(18)} checks ${row.ok}/${row.total}  cost/success ${usd(row.costPerSuccessMicro)}  ${(row.avgMs / 1000).toFixed(1)}s  eligible ${row.eligible}`,
      );
    }
  }
  if (features.includes("tailor" as never) && !NO_SPEND) spot = await spotCheck(allItems.tailor!);
} catch (error) {
  if (!(error instanceof BudgetExceeded)) throw error;
  print(`\nStopped: ${error.message} at ${usd(spentMicro)}.`);
}
const markdown = report(results, spot);
writeFile("report.md", markdown);
writeCache("summary.json", { spentMicro, results, spot });
print(`\n${markdown}`);
