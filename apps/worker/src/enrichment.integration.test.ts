import type {
  AnyFeatureRequest,
  EnrichmentOutput,
  RequestBatches,
  RequestResult,
} from "@gettargetrole/ai";
import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as EnrichmentModule from "./enrichment";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";

const TEST_DATABASE_URL = testDatabaseUrl("worker");

const CONTRACT_POST = `We're hiring a backend engineer for a 12-month engagement.
Requirements: 5+ years of Java experience.
This role is open to C2C or W2 candidates.
Pay: 70 - 85 USD per hour.
We are unable to sponsor visas for this role.`;

function reading(overrides: Partial<EnrichmentOutput> = {}): EnrichmentOutput {
  return {
    summary: "Builds Java services on a year-long contract.",
    seniority: null,
    seniorityQuote: null,
    yearsMin: 5,
    yearsQuote: "5+ years of Java experience",
    education: null,
    educationQuote: null,
    salaryMin: 70,
    salaryMax: 85,
    salaryCurrency: "USD",
    salaryPeriod: "hour",
    salaryQuote: "70 - 85 USD per hour",
    contractTerms: ["c2c", "w2"],
    contractQuote: "open to C2C or W2 candidates",
    workplace: null,
    workplaceQuote: null,
    sponsorship: "no",
    sponsorshipQuote: "unable to sponsor visas for this role",
    citizenshipRequired: null,
    citizenshipQuote: null,
    evergreen: false,
    evergreenQuote: null,
    ...overrides,
  };
}

/** A batch API in memory; each post gets the scripted reading (or failure) for its id. */
class FakeBatches implements RequestBatches {
  readonly vendor = "openai" as const;
  readonly sent: Array<Array<{ id: string; request: AnyFeatureRequest }>> = [];
  readonly finished = new Set<string>();
  script = new Map<string, EnrichmentOutput | RequestResult>();

  async submit(entries: Array<{ id: string; request: AnyFeatureRequest }>) {
    this.sent.push(entries);
    return `ext_${this.sent.length}`;
  }

  async isDone(batchId: string) {
    return this.finished.has(batchId);
  }

  async *results(batchId: string, requestFor: Parameters<RequestBatches["results"]>[1]) {
    for (const entry of this.sent[Number(batchId.split("_")[1]) - 1] ?? []) {
      const known = requestFor(entry.id);
      const scripted = this.script.get(entry.id);
      if (!known || !scripted) continue;
      if ("status" in scripted) {
        yield { id: entry.id, result: scripted };
        continue;
      }
      await known.ctx.onUsage?.({
        feature: "enrich",
        model: "gpt-4o-mini",
        inputTokens: 2000,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costMicroUsd: 240,
        batch: true,
      });
      // The real check: quotes are verified against the post the request was built from.
      const output = known.request.finish(scripted);
      yield { id: entry.id, result: { status: "succeeded" as const, output } };
    }
  }

  finishAll() {
    this.sent.forEach((_, index) => this.finished.add(`ext_${index + 1}`));
  }
}

describe.skipIf(!TEST_DATABASE_URL)("job enrichment (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let enrichment: typeof EnrichmentModule;
  let batches: FakeBatches;
  let companyId: string;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    enrichment = await import("./enrichment");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(
      drizzle.sql`TRUNCATE companies, jobs, ai_usage, enrichment_batches RESTART IDENTITY CASCADE`,
    );
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    companyId = company!.id;
    batches = new FakeBatches();
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  async function addJob(
    externalId: string,
    description: string,
    extra: Record<string, unknown> = {},
  ) {
    const [job] = await db
      .getDb()
      .insert(db.jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId,
        title: "Backend Engineer",
        applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${externalId}`,
        descriptionText: description,
        contentHash: `hash-${externalId}`,
        employmentTypes: ["full_time"],
        ...extra,
      })
      .returning();
    return job!;
  }

  const options = () => ({ batches, model: "gpt-4o-mini", dailyBudgetUsd: 2 });
  const jobById = async (id: string) =>
    (await db.getDb().select().from(db.jobs).where(drizzle.eq(db.jobs.id, id)))[0]!;

  it("sends posts that need it, newest first, and fills in what they say", async () => {
    const hour = 3600_000;
    const older = await addJob("1", CONTRACT_POST, {
      firstSeenAt: new Date(Date.now() - 2 * hour),
    });
    const newer = await addJob("2", CONTRACT_POST, { firstSeenAt: new Date(Date.now() - hour) });
    // Already enriched as it is, closed, or with nothing to read: not sent.
    await addJob("3", CONTRACT_POST, { enrichedHash: "hash-3" });
    await addJob("4", CONTRACT_POST, { closedAt: new Date() });
    await addJob("5", "");

    expect(await enrichment.submitEnrichmentBatch(options())).toBe(2);
    expect(batches.sent[0]!.map((entry) => entry.id)).toEqual([newer.id, older.id]);
    // Waiting posts aren't sent twice.
    expect(await enrichment.submitEnrichmentBatch(options())).toBe(0);

    batches.script.set(newer.id, reading());
    batches.script.set(older.id, reading({ sponsorshipQuote: "We sponsor H-1B visas" }));
    expect(await enrichment.pollEnrichmentBatches(options())).toBe(0);
    batches.finishAll();
    expect(await enrichment.pollEnrichmentBatches(options())).toBe(2);

    const enriched = await jobById(newer.id);
    expect(enriched).toMatchObject({
      yearsMin: 5,
      // The post doesn't state a level; years alone don't set one.
      seniority: null,
      // The C2C/W2 terms make a post that declared nothing a contract role.
      employmentTypes: ["contract", "w2", "c2c"],
      visaSponsorship: "no",
      salaryMin: 70,
      salaryMax: 85,
      salaryPeriod: "hour",
      enrichedHash: "hash-2",
      enrichmentBatchId: null,
    });
    expect(enriched.enrichment).toMatchObject({ summary: expect.stringContaining("Java") });
    // A quote that isn't in the post drops that fact only.
    const unquoted = await jobById(older.id);
    expect(unquoted).toMatchObject({ visaSponsorship: "unknown", yearsMin: 5 });

    const usage = await db.getDb().select().from(db.aiUsage);
    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.userId === null && row.feature === "enrich" && row.batch)).toBe(
      true,
    );
    const [batch] = await db.getDb().select().from(db.enrichmentBatches);
    expect(batch).toMatchObject({ status: "done", jobCount: 2, vendor: "openai" });
  });

  it("keeps board facts over enrichment", async () => {
    const job = await addJob("1", CONTRACT_POST, {
      employmentType: "Full-time",
      salaryMin: 150000,
      salaryMax: 180000,
      salaryPeriod: "year",
      visaSponsorship: "yes",
      yearsMin: 4,
    });
    await enrichment.submitEnrichmentBatch(options());
    batches.script.set(job.id, reading());
    batches.finishAll();
    await enrichment.pollEnrichmentBatches(options());
    expect(await jobById(job.id)).toMatchObject({
      employmentTypes: ["full_time", "w2", "c2c"],
      salaryMin: 150000,
      salaryPeriod: "year",
      visaSponsorship: "yes",
      yearsMin: 4,
    });
  });

  it("retries posts that didn't run, and sets aside ones the API rejects", async () => {
    const rejected = await addJob("1", CONTRACT_POST);
    const expired = await addJob("2", CONTRACT_POST);
    const missing = await addJob("3", CONTRACT_POST);
    await enrichment.submitEnrichmentBatch(options());
    batches.script.set(rejected.id, { status: "failed", error: "Invalid", retryable: false });
    batches.script.set(expired.id, { status: "failed", error: "Expired", retryable: true });
    batches.finishAll();
    await enrichment.pollEnrichmentBatches(options());

    expect(await jobById(rejected.id)).toMatchObject({
      enrichedHash: "hash-1",
      enrichmentBatchId: null,
    });
    for (const id of [expired.id, missing.id]) {
      expect(await jobById(id)).toMatchObject({ enrichedHash: null, enrichmentBatchId: null });
    }
    // The next batch takes the ones worth trying again.
    expect(await enrichment.submitEnrichmentBatch(options())).toBe(2);
  });

  it("meters a batch once when two workers read it", async () => {
    const job = await addJob("1", CONTRACT_POST);
    await enrichment.submitEnrichmentBatch(options());
    batches.script.set(job.id, reading());
    batches.finishAll();
    const [first, second] = await Promise.all([
      enrichment.pollEnrichmentBatches(options()),
      enrichment.pollEnrichmentBatches(options()),
    ]);
    expect(first + second).toBe(1);
    expect(await db.getDb().select().from(db.aiUsage)).toHaveLength(1);
  });

  it("puts back posts left on a batch that was read part-way", async () => {
    const job = await addJob("1", CONTRACT_POST);
    await enrichment.submitEnrichmentBatch(options());
    // A worker claimed the batch and stopped before reading it.
    await db.getDb().update(db.enrichmentBatches).set({ status: "done" });
    expect(await enrichment.submitEnrichmentBatch(options())).toBe(1);
    expect((await jobById(job.id)).enrichmentBatchId).not.toBeNull();
  });

  it("stops at the daily budget", async () => {
    await addJob("1", CONTRACT_POST);
    await addJob("2", CONTRACT_POST);
    // A post costs about $0.00028 in a gpt-4o-mini batch; $0.0003 left buys one.
    await db.getDb().insert(db.aiUsage).values({
      userId: null,
      feature: "enrich",
      model: "gpt-4o-mini",
      costMicroUsd: 1_999_700,
    });
    expect(await enrichment.submitEnrichmentBatch(options())).toBe(1);
    expect(await enrichment.submitEnrichmentBatch(options())).toBe(0);
  });
});
