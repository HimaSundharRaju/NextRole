/*
 * Model quality check. Runs each candidate model on the same inputs for every feature, applies
 * the automatic checks, has two judges from different vendors compare each candidate with the
 * reference (Claude Sonnet 5), and reports the cheapest model per feature that matches it.
 *
 *   NODE_USE_ENV_PROXY=1 node --env-file=.env --import tsx packages/ai/eval/run.mts
 *
 * Options: --features tailor,cover_letter   --judge-items 8   --items 2 (smoke test)
 *          --budget-anthropic 5   --budget-openai 5 (USD of new spending per vendor)
 *          --no-spend yes (rebuild the report from cached results only; nothing new is called)
 *          --own-only yes (only the items built from your own resume; give --judge-items 10 or more
 *                          to judge all of them)
 *          --spot-check yes (also compare Opus 5.5 with Sonnet 5 on tailoring)
 * Sonnet 5.5, priced like the reference, is compared on every writing feature.
 * Every model and judge result is cached under packages/ai/eval/results/, so a rerun only pays
 * for what's missing. Results that failed on an API error (out of credit, overloaded) are retried
 * instead of reused. Cheaper models run cheapest tier first: a feature moves on to the next tier
 * only when nothing in the one before it passed.
 *
 * To include your own resume, put it in fixtures/private/ (gitignored; see fixtures.ts).
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
import {
  OWN_PAIRS,
  OWN_PERSONA,
  OWN_RESUME_PDF,
  PAIRS,
  PERSONAS,
  QUESTIONS,
  STUDIO_CASES,
  type Persona,
} from "./fixtures";
import { judge, JUDGES, type JudgeId, type JudgeResult } from "./judge";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]!.replace(/^--/, ""), process.argv[index + 1] ?? "");
}
type Vendor = "anthropic" | "openai";
const BUDGET_MICRO: Record<Vendor, number> = {
  anthropic: Number(args.get("budget-anthropic") ?? 5) * 1_000_000,
  openai: Number(args.get("budget-openai") ?? 5) * 1_000_000,
};
const JUDGE_ITEMS = Number(args.get("judge-items") ?? 8);
const ITEM_LIMIT = Number(args.get("items") ?? Number.POSITIVE_INFINITY);
const NO_SPEND = args.has("no-spend");
const OWN_ONLY = args.has("own-only");
const SPOT = args.has("spot-check");
const RESULTS = new URL("./results/", import.meta.url);

interface Candidate {
  id: string;
  vendor: Vendor;
  model: string;
}

const REFERENCE_CANDIDATE: Candidate = {
  id: "sonnet-5",
  vendor: "anthropic",
  model: "claude-sonnet-5",
};
const REFERENCE = REFERENCE_CANDIDATE.id;
/**
 * The cheaper model a feature runs on today, when it isn't the reference. Its results are cached
 * from earlier rounds, so a new model has to beat it on cost to replace it.
 */
const CURRENT_ROUTE: Partial<Record<string, Candidate>> = {
  import: { id: "gpt-4o-mini", vendor: "openai", model: "gpt-4o-mini" },
  match: { id: "gpt-4o-mini", vendor: "openai", model: "gpt-4o-mini" },
};
/**
 * Models to try, cheapest tier first. Earlier rounds ruled out Claude Haiku 4.5, GPT-5 mini and
 * nano, GPT-4.1 mini and GPT-4o mini for the writing features (results in docs/ARCHITECTURE.md).
 */
const TIERS: Candidate[][] = [
  // $0.10 / $0.50 per million tokens.
  [
    { id: "haiku-5.5", vendor: "anthropic", model: "claude-haiku-5-5" },
    { id: "gpt-6-luna", vendor: "openai", model: "gpt-6-luna" },
  ],
  // $1 / $5: half the reference's price.
  [{ id: "gpt-6.1-terra", vendor: "openai", model: "gpt-6.1-terra" }],
];
/** The reference's successor at the same price: an upgrade rather than a saving. */
const UPGRADE: Candidate = { id: "sonnet-5.5", vendor: "anthropic", model: "claude-sonnet-5-5" };
const UPGRADE_FEATURES = new Set([
  "tailor",
  "cover_letter",
  "answers",
  "outreach",
  "interview",
  "studio",
]);
/** People wait on these features, so a route must answer this fast on average. */
const MAX_AVG_MS = 30_000;
/** Checked against the reference on a few tailors: is the premium model worth its price? */
const SPOT_CHECK: Candidate = { id: "opus-5.5", vendor: "anthropic", model: "claude-opus-5-5" };

interface Item {
  id: string;
  task: string;
  resume: string;
  job: string;
  run: (ai: AiProvider, ctx: AiCallContext) => Promise<unknown>;
  check: (output: unknown) => string[];
  render: (output: unknown) => string;
  /** Built from the owner's own resume (fixtures/private/). */
  own?: boolean;
}

interface Generated {
  output: unknown;
  error: string | null;
  costMicroUsd: number;
  ms: number;
}

// --- Ledger -------------------------------------------------------------------------------------

/** New spending this run, per vendor; only this counts toward the budgets. */
const spent: Record<Vendor, number> = { anthropic: 0, openai: 0 };
/** What the cached results this run reused cost when they were made. */
let reusedMicro = 0;
const counted = new Set<string>();
class BudgetExceeded extends Error {}

/**
 * Messages of failures from the API itself (a rejected or expired key, no credit left, overload),
 * not from the model's output.
 */
const API_ERROR =
  /couldn't process this request|busy right now|unavailable right now|not configured correctly/i;

/** A cached result, reused for free. */
function readCache<T>(path: string): T | null {
  const url = new URL(path, RESULTS);
  if (!existsSync(url)) return null;
  const value = JSON.parse(readFileSync(url, "utf8")) as T & { costMicroUsd?: number };
  if (!counted.has(path)) {
    counted.add(path);
    reusedMicro += value.costMicroUsd ?? 0;
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

function guardBudget(vendor: Vendor): void {
  if (spent[vendor] >= BUDGET_MICRO[vendor]) {
    throw new BudgetExceeded(`the ${vendor} budget was reached`);
  }
}

const totalSpent = () => spent.anthropic + spent.openai;

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
  return [...PAIRS.slice(0, limit), ...OWN_PAIRS].map((pair) => ({
    id: `${pair.persona.id}__${pair.job.key}`,
    task,
    resume: text(pair.persona.resume),
    job: `${pair.job.title} at ${pair.job.company}\n\n${pair.job.description}`,
    run: (ai, ctx) => run(pair, ai, ctx),
    check: (output) => check(pair, output as T),
    render: (output) => render(output as T),
    own: pair.persona.own === true,
  }));
}

/** The owner's original resume file, checked against their confirmed persona.json. */
function ownImportItem(persona: Persona, pdf: Buffer): Item {
  return {
    id: "owner__original-pdf",
    task: "Convert the resume into structured data exactly as written.",
    resume: text(persona.resume),
    job: "",
    run: (ai, ctx) => ai.importResume({ kind: "pdf", data: pdf, fileName: "resume.pdf" }, ctx),
    check: (output) => checkImport(persona.resume, output as ImportResult),
    render: (output) => text((output as ImportResult).resume),
    own: true,
  };
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
    import: [
      ...(OWN_PERSONA && OWN_RESUME_PDF ? [ownImportItem(OWN_PERSONA, OWN_RESUME_PDF)] : []),
      ...PERSONAS.flatMap((persona, index) =>
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
    ],
    studio: [
      ...[...PERSONAS.slice(0, 3), ...(OWN_PERSONA ? [OWN_PERSONA] : [])].flatMap((persona) =>
        STUDIO_CASES.map((studioCase, index) =>
          studioItem(persona, `${persona.id}__${index}`, studioCase.message, {
            task: `The candidate asked the resume editor: "${studioCase.message}"`,
            job: "",
            check: (resume) =>
              checkStudioEdit(persona.resume, resume, studioCase.sections, studioCase.expect),
          }),
        ),
      ),
      ...ownStudioTailorItems(),
    ],
  };
}

/** One request to the Studio chat; the output is its reply and the edited resume. */
function studioItem(
  persona: Persona,
  id: string,
  message: string,
  rest: { task: string; job: string; check: (resume: Resume | null) => string[] },
): Item {
  return {
    id,
    own: persona.own === true,
    task: rest.task,
    resume: text(persona.resume),
    job: rest.job,
    run: async (ai, ctx) => {
      let reply = "";
      let resume: Resume | null = null;
      for await (const event of ai.studioChat(
        { resume: persona.resume, history: [], message, profile: persona.profile },
        ctx,
      )) {
        if (event.type === "resume") resume = event.resume;
        if (event.type === "done") reply = event.reply;
        if (event.type === "error") throw new Error(event.message);
      }
      return { reply, resume };
    },
    check: (output) => rest.check((output as { resume: Resume | null }).resume),
    render: (output) => {
      const { reply, resume } = output as { reply: string; resume: Resume | null };
      return `${reply}\n\n${resume ? text(resume) : "(no edit)"}`;
    },
  };
}

/** Tailoring through the Studio chat on the owner's resume, held to the tailor feature's facts. */
function ownStudioTailorItems(): Item[] {
  return OWN_PAIRS.slice(0, 2).map(({ persona, job }) => {
    const posting = `${job.title} at ${job.company}\n\n${job.description}`;
    const message = `Tailor my resume to this job without adding anything I haven't done.\n\n${posting.slice(0, 3000)}`;
    return studioItem(persona, `${persona.id}__tailor-${job.key}`, message, {
      task: `The candidate asked the resume editor to tailor the resume to the ${job.title} role at ${job.company} without inventing anything.`,
      job: posting,
      check: (resume) => {
        if (!resume) return ["no edit applied"];
        const sections: Array<keyof Resume> = ["basics", "summary", "experience", "skills"];
        const tailored = { resume, summaryOfChanges: ["studio"], missingKeywords: [] };
        return [
          ...new Set([
            ...checkStudioEdit(persona.resume, resume, sections),
            ...checkTailor(persona.resume, tailored as unknown as TailorResult),
          ]),
        ];
      },
    });
  });
}

// --- Running ------------------------------------------------------------------------------------

async function generate(feature: string, candidate: Candidate, item: Item): Promise<Generated> {
  const path = `${feature}/${candidate.id}/${item.id}.json`;
  const cached = readCache<Generated>(path);
  if (cached && (NO_SPEND || !(cached.error && API_ERROR.test(cached.error)))) return cached;
  if (NO_SPEND) return { output: null, error: "not run", costMicroUsd: 0, ms: 0 };
  guardBudget(candidate.vendor);
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
  spent[candidate.vendor] += result.costMicroUsd;
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
    JUDGES.map(async ({ id, vendor }): Promise<JudgeResult | null> => {
      const path = `${feature}/judge/${candidate.id}/${item.id}__${id}.json`;
      const cached = readCache<JudgeResult>(path);
      if (cached) return cached;
      if (NO_SPEND) return null;
      guardBudget(vendor);
      const result = await judge(id, {
        task: item.task,
        resume: item.resume,
        job: item.job,
        candidate: item.render(mine.output),
        reference: item.render(reference.output),
        candidateFirst: candidateFirst(`${feature}/${candidate.id}/${item.id}`),
      });
      spent[vendor] += result.costMicroUsd;
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

const runAll = (feature: string, candidate: Candidate, items: Item[]) =>
  pool(
    items.map((item) => () => generate(feature, candidate, item)),
    3,
  );

async function runFeature(feature: string, items: Item[]): Promise<Row[]> {
  const failuresOf = (generated: Generated, item: Item) =>
    generated.error ? [`error: ${generated.error}`] : item.check(generated.output);
  const reference = await runAll(feature, REFERENCE_CANDIDATE, items);
  const referenceFailures = reference.filter(
    (generated, index) => failuresOf(generated, items[index]!).length > 0,
  ).length;
  // Judge on items where the reference itself passed, so the comparison is against a good output.
  // Up to half of them come from the owner's own resume, when it's set up.
  const passing = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => failuresOf(reference[index]!, item).length === 0);
  const judgeable = [
    ...passing.filter(({ item }) => item.own).slice(0, Math.ceil(JUDGE_ITEMS / 2)),
    ...passing.filter(({ item }) => !item.own),
  ].slice(0, JUDGE_ITEMS);

  async function rowFor(candidate: Candidate): Promise<Row> {
    const generated =
      candidate.id === REFERENCE ? reference : await runAll(feature, candidate, items);
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
    // As good as the reference: each judge prefers it at least as often as it prefers the reference.
    const atLeastAsGood = (id: JudgeId) => {
      const { win, tie, loss } = judged[id];
      return win + tie + loss > 0 && win >= loss;
    };
    return {
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
        (passesChecks && avgMs <= MAX_AVG_MS && JUDGES.every(({ id }) => atLeastAsGood(id))),
      pending:
        candidate.id !== REFERENCE &&
        passesChecks &&
        JUDGES.some(({ id }) => judged[id].win + judged[id].tie + judged[id].loss === 0),
    };
  }

  const rows = [await rowFor(REFERENCE_CANDIDATE)];
  const current = CURRENT_ROUTE[feature];
  if (current) rows.push(await rowFor(current));
  for (const tier of TIERS) {
    rows.push(...(await Promise.all(tier.map((candidate) => rowFor(candidate)))));
    // Once a model cheaper than the reference passes, the dearer tiers can't win on cost.
    if (rows.some((row) => row.candidate !== REFERENCE && row.eligible)) break;
  }
  // After the tiers, so that the upgrade passing doesn't stop a cheaper tier from being tried.
  if (UPGRADE_FEATURES.has(feature)) rows.push(await rowFor(UPGRADE));
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
    const reference = await generate("tailor", REFERENCE_CANDIDATE, item);
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
    `New spend: Claude ${usd(spent.anthropic)} of ${usd(BUDGET_MICRO.anthropic)}, OpenAI ${usd(spent.openai)} of ${usd(BUDGET_MICRO.openai)}. Reused from earlier runs: ${usd(reusedMicro)}.`,
    ``,
    `A model is eligible when it fails no more checks than the reference (Claude Sonnet 5), each judge prefers it at least as often as the reference, and it answers within ${MAX_AVG_MS / 1000}s on average. The cheapest eligible model is chosen.`,
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
      `## Spot check: Opus 5.5 vs Sonnet 5 on tailoring`,
      ``,
      `From Opus 5.5's side, win/tie/loss — Claude judge ${spot["claude-judge"].win}/${spot["claude-judge"].tie}/${spot["claude-judge"].loss}, GPT judge ${spot["gpt-judge"].win}/${spot["gpt-judge"].tie}/${spot["gpt-judge"].loss}.`,
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
    const items = allItems[feature]!.filter((item) => !OWN_ONLY || item.own).slice(0, ITEM_LIMIT);
    if (!items.length) throw new Error(`No ${feature} items; is fixtures/private/ filled in?`);
    print(
      `\n== ${feature} (${items.length} items) — new spend so far Claude ${usd(spent.anthropic)}, OpenAI ${usd(spent.openai)}`,
    );
    results[feature] = await runFeature(feature, items);
    for (const row of results[feature]!) {
      print(
        `  ${row.model.padEnd(18)} checks ${row.ok}/${row.total}  cost/success ${usd(row.costPerSuccessMicro)}  ${(row.avgMs / 1000).toFixed(1)}s  eligible ${row.eligible}`,
      );
    }
  }
  if (SPOT && features.includes("tailor" as never) && !NO_SPEND) {
    spot = await spotCheck(allItems.tailor!.filter((item) => !OWN_ONLY || item.own));
  }
} catch (error) {
  if (!(error instanceof BudgetExceeded)) throw error;
  print(`\nStopped: ${error.message} after new spend of ${usd(totalSpent())}.`);
}
const markdown = report(results, spot);
writeFile("report.md", markdown);
writeCache("summary.json", { spent, reusedMicro, results, spot });
print(`\n${markdown}`);
