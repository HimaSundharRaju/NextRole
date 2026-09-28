/*
 * Quality check for job enrichment. Runs each candidate model on the same real postings and
 * compares what survives the quote check: how many claimed facts had real quotes, how many facts
 * each model found, and how often it agrees with a stronger reference model and with the
 * deterministic parsers. Prints a table and writes results/enrich-report.md.
 *
 *   NODE_USE_ENV_PROXY=1 node --env-file=../../.env --import tsx eval/enrich.mts   (from packages/ai)
 *
 * Options: --budget 2 (USD, cached spend included)   --postings 50   --concurrency 2
 * Postings come from public job boards (Greenhouse, Ashby, Lever, Workday, amazon.jobs) and are
 * cached under results/, with every model's answers, so a rerun only pays for what's missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getOpenAI, OpenAIProvider } from "../src/openai-provider";
import {
  decodeEntities,
  enrichRequest,
  postingText,
  verifyEnrichment,
  type EnrichmentOutput,
  type JobEnrichment,
} from "../src/enrich";
import type { JobContext, UsageRecord } from "../src/types";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index]!.replace(/^--/, ""), process.argv[index + 1] ?? "");
}
const BUDGET_MICRO = Number(args.get("budget") ?? 2) * 1_000_000;
const POSTINGS = Number(args.get("postings") ?? 50);
// Calls at once; lower tiers limit tokens per minute (30,000 for gpt-4.1 on tier 1).
const CONCURRENCY = Number(args.get("concurrency") ?? 2);
const RESULTS = new URL("./results/enrich/", import.meta.url);
const UA = "GetTargetRoleBot/1.0 (+https://gettargetrole.app/bot)";

const REFERENCE = "gpt-4.1";
const CANDIDATES = ["gpt-4o-mini", "gpt-4.1-nano", "gpt-4.1-mini", "gpt-5-nano"];

interface Posting extends JobContext {
  id: string;
}

const text = (html: string) =>
  decodeEntities(
    decodeEntities(html)
      .replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();

async function getJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      accept: "application/json",
      "user-agent": UA,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return (await response.json()) as T;
}

/** A spread of real postings: startups, big tech, a bank, Amazon. */
async function collectPostings(): Promise<Posting[]> {
  const out: Posting[] = [];
  for (const [company, token] of [
    ["Stripe", "stripe"],
    ["Datadog", "datadog"],
    ["Airbnb", "airbnb"],
  ] as const) {
    const data = await getJson<{
      jobs: Array<{ id: number; title: string; location?: { name?: string }; content: string }>;
    }>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    for (const job of data.jobs.slice(0, 7)) {
      out.push({
        id: `gh-${job.id}`,
        title: job.title,
        company,
        location: job.location?.name ?? "",
        description: text(job.content),
      });
    }
  }
  for (const [company, token] of [
    ["OpenAI", "openai"],
    ["Ramp", "ramp"],
  ] as const) {
    const data = await getJson<{
      jobs: Array<{ id: string; title: string; location?: string; descriptionHtml?: string }>;
    }>(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`);
    for (const job of data.jobs.slice(0, 7)) {
      out.push({
        id: `ashby-${job.id}`,
        title: job.title,
        company,
        location: job.location ?? "",
        description: text(job.descriptionHtml ?? ""),
      });
    }
  }
  const lever = await getJson<
    Array<{
      id: string;
      text: string;
      categories?: { location?: string };
      descriptionPlain?: string;
      lists?: Array<{ text: string; content: string }>;
    }>
  >("https://api.lever.co/v0/postings/palantir?mode=json");
  for (const job of lever.slice(0, 6)) {
    const lists = (job.lists ?? []).map((list) => `${list.text}\n${text(list.content)}`).join("\n");
    out.push({
      id: `lever-${job.id}`,
      title: job.text,
      company: "Palantir",
      location: job.categories?.location ?? "",
      description: `${job.descriptionPlain ?? ""}\n${lists}`,
    });
  }
  const amazon = await getJson<{
    jobs: Array<{
      id_icims: string;
      title: string;
      normalized_location?: string;
      description?: string;
      basic_qualifications?: string;
      preferred_qualifications?: string;
    }>;
  }>("https://www.amazon.jobs/en/search.json?offset=0&result_limit=6&sort=recent");
  for (const job of amazon.jobs) {
    out.push({
      id: `amazon-${job.id_icims}`,
      title: job.title,
      company: "Amazon",
      location: job.normalized_location ?? "",
      description: text(
        `${job.description ?? ""}<br>Basic qualifications<br>${job.basic_qualifications ?? ""}<br>Preferred qualifications<br>${job.preferred_qualifications ?? ""}`,
      ),
    });
  }
  const site =
    "https://barclays.wd3.myworkdayjobs.com/wday/cxs/barclays/External_Career_Site_Barclays";
  const listed = await getJson<{ jobPostings: Array<{ title: string; externalPath: string }> }>(
    `${site}/jobs`,
    {
      appliedFacets: {},
      limit: 6,
      offset: 0,
      searchText: "",
    },
  );
  for (const job of listed.jobPostings) {
    const detail = await getJson<{
      jobPostingInfo: { title: string; location?: string; jobDescription?: string };
    }>(`${site}${job.externalPath}`);
    out.push({
      id: `workday-${job.externalPath.split("/").pop()}`,
      title: detail.jobPostingInfo.title,
      company: "Barclays",
      location: detail.jobPostingInfo.location ?? "",
      description: text(detail.jobPostingInfo.jobDescription ?? ""),
    });
  }
  return out.filter((posting) => posting.description.length > 200);
}

interface Run {
  /** The model's answer before the quote check, which runs when the report is built. */
  output: EnrichmentOutput | null;
  error: string | null;
  costMicroUsd: number;
}

let spent = 0;

async function run(model: string, posting: Posting): Promise<Run> {
  const file = new URL(`${model}/${posting.id}.json`, RESULTS);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as Run;
    spent += cached.costMicroUsd;
    return cached;
  }
  if (spent >= BUDGET_MICRO) return { output: null, error: "over budget", costMicroUsd: 0 };
  const provider = new OpenAIProvider(() => model);
  // The raw answer is kept, so the quote check can change without paying again.
  const request = { ...enrichRequest(posting), finish: (output: EnrichmentOutput) => output };
  const usage: UsageRecord[] = [];
  const ctx = { userId: null, onUsage: (record: UsageRecord) => void usage.push(record) };
  const cost = () => usage.reduce((total, record) => total + record.costMicroUsd, 0);
  let result: Run;
  try {
    const response = await getOpenAI().responses.create(provider.batchBody(request));
    result = {
      output: await provider.readBatchResponse(request, response, ctx),
      error: null,
      costMicroUsd: cost(),
    };
  } catch (error) {
    result = {
      output: null,
      error: error instanceof Error ? error.message : String(error),
      costMicroUsd: cost(),
    };
  }
  spent += result.costMicroUsd;
  mkdirSync(new URL(`${model}/`, RESULTS), { recursive: true });
  writeFileSync(file, JSON.stringify(result, null, 1));
  return result;
}

/** The quote check, as production runs it. */
function verified(result: Run, posting: Posting): JobEnrichment | null {
  return result.output
    ? verifyEnrichment(result.output, `${posting.title}\n${postingText(posting)}`)
    : null;
}

const agree = <T,>(a: T | null | undefined, b: T | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? null : a === b;

mkdirSync(RESULTS, { recursive: true });
const postingsFile = new URL("postings.json", RESULTS);
if (!existsSync(postingsFile))
  writeFileSync(postingsFile, JSON.stringify(await collectPostings(), null, 1));
const postings = (JSON.parse(readFileSync(postingsFile, "utf8")) as Posting[]).slice(0, POSTINGS);
console.log(`${postings.length} postings`);

// Every model on every posting, a few calls at a time; the report below reads the cache.
const work = [REFERENCE, ...CANDIDATES].flatMap((model) =>
  postings.map((posting) => () => run(model, posting)),
);
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let task = work.shift(); task; task = work.shift()) await task();
  }),
);
spent = 0;

const reference = new Map<string, Run>();
for (const posting of postings) reference.set(posting.id, await run(REFERENCE, posting));

const rows: string[] = [];
for (const model of [REFERENCE, ...CANDIDATES]) {
  let claimed = 0;
  let kept = 0;
  let facts = 0;
  let errors = 0;
  let cost = 0;
  const agreements: Record<string, { same: number; compared: number }> = {};
  const count = (field: string, verdict: boolean | null) => {
    if (verdict === null) return;
    agreements[field] ??= { same: 0, compared: 0 };
    agreements[field].compared++;
    if (verdict) agreements[field].same++;
  };
  for (const posting of postings) {
    const result = model === REFERENCE ? reference.get(posting.id)! : await run(model, posting);
    cost += result.costMicroUsd;
    const e = verified(result, posting);
    if (!e) {
      errors++;
      continue;
    }
    const keptHere = Object.keys(e.quotes).length;
    kept += keptHere;
    claimed += keptHere + e.dropped.length;
    facts += keptHere + (e.seniority ? 1 : 0);
    const ref = verified(reference.get(posting.id)!, posting);
    if (model !== REFERENCE && ref) {
      count("years", agree(e.yearsMin, ref.yearsMin));
      count("education", agree(e.education, ref.education));
      count("seniority", agree(e.seniority, ref.seniority));
      count("sponsorship", agree(e.sponsorship, ref.sponsorship));
      count("salary", agree(e.salary?.max, ref.salary?.max));
    }
  }
  const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 100)}%`);
  const agreement = ["years", "education", "seniority", "sponsorship", "salary"]
    .map(
      (field) => `${field} ${pct(agreements[field]?.same ?? 0, agreements[field]?.compared ?? 0)}`,
    )
    .join(", ");
  const ok = postings.length - errors;
  const row = `| ${model} | ${pct(kept, claimed)} | ${(facts / Math.max(ok, 1)).toFixed(1)} | ${model === REFERENCE ? "reference" : agreement} | ${errors} | $${(cost / Math.max(ok, 1) / 1e6).toFixed(5)} |`;
  rows.push(row);
  console.log(row);
}

const report = [
  "# Job enrichment check",
  "",
  `${postings.length} real postings. Quotes checked word for word. Cost per posting is at batch prices, what production pays; the check itself ran live, at twice that.`,
  "",
  "| Model | Quotes that checked out | Facts per posting | Agreement with the reference (where both found the fact) | Errors | Cost per posting |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  `Spent: $${(spent / 1e6).toFixed(2)}`,
].join("\n");
writeFileSync(new URL("../enrich-report.md", RESULTS), report);
console.log(`\nspent $${(spent / 1e6).toFixed(3)}`);
