import {
  enrichRequest,
  estimateCostMicroUsd,
  type AnyFeatureRequest,
  type JobEnrichment,
  type RequestBatches,
  type UsageRecord,
} from "@gettargetrole/ai";
import { createLogger } from "@gettargetrole/core/logger";
import {
  aiUsage,
  companies,
  EMPLOYMENT_TYPES,
  enrichmentBatches,
  getDb,
  jobs,
  type Database,
  type DbExecutor,
  type EmploymentType,
} from "@gettargetrole/db";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";

const log = createLogger("enrichment");

type JobRow = typeof jobs.$inferSelect;

/**
 * The columns a job gets from its enrichment. Facts from the board and the deterministic
 * parsers win: enrichment fills what they left unknown, and adds W-2, C2C and 1099 terms.
 */
export function enrichedFields(
  job: Pick<
    JobRow,
    | "contentHash"
    | "salaryMax"
    | "employmentType"
    | "employmentTypes"
    | "visaSponsorship"
    | "citizenshipRequired"
    | "workplaceType"
  >,
  enrichment: JobEnrichment,
) {
  const types = new Set<EmploymentType>(job.employmentTypes);
  if (enrichment.contractTerms.length > 0) {
    for (const term of enrichment.contractTerms) types.add(term);
    // The parsers call a post that declares nothing full-time; contract terms say otherwise.
    if (!job.employmentType.trim() && types.has("full_time")) {
      types.delete("full_time");
      types.add("contract");
    }
  }
  const salary = job.salaryMax === null ? enrichment.salary : null;
  return {
    enrichment: enrichment as unknown as Record<string, unknown>,
    enrichedHash: job.contentHash,
    yearsMin: enrichment.yearsMin,
    seniority: enrichment.seniority,
    employmentTypes: EMPLOYMENT_TYPES.filter((type) => types.has(type)),
    visaSponsorship:
      job.visaSponsorship === "unknown" && enrichment.sponsorship
        ? enrichment.sponsorship
        : job.visaSponsorship,
    citizenshipRequired: job.citizenshipRequired || enrichment.citizenshipRequired === true,
    workplaceType:
      job.workplaceType === "unknown" && enrichment.workplace
        ? enrichment.workplace
        : job.workplaceType,
    ...(salary
      ? {
          salaryMin: Math.round(salary.min),
          salaryMax: Math.round(salary.max),
          salaryCurrency: salary.currency,
          salaryPeriod: salary.period,
        }
      : {}),
  };
}

export interface EnrichmentOptions {
  batches: RequestBatches;
  model: string;
  db?: Database;
  /** Most a day's enrichment may spend. */
  dailyBudgetUsd?: number;
  /** Most posts per batch. */
  batchSize?: number;
}

/** Tokens a post's enrichment request takes, for estimating a batch's cost. */
const TOKENS_PER_POST = { inputTokens: 2_500, outputTokens: 350 };
/**
 * Posts per batch and batches waiting at once. OpenAI caps the tokens an account can have
 * queued (2 million for GPT-4o-mini on the first tier); 500 posts are about 1.1 million.
 */
const BATCH_SIZE = 500;
const MAX_IN_FLIGHT = 1;
const DAY_MS = 86_400_000;

function requestFor(job: Pick<JobRow, "title" | "location" | "descriptionText">, company: string) {
  // The cast forgets the feature's types, which the batch doesn't need.
  return enrichRequest({
    title: job.title,
    company,
    location: job.location,
    description: job.descriptionText,
  }) as unknown as AnyFeatureRequest;
}

/** Spent on enrichment in the last day, plus what waiting batches should cost. */
async function spentToday(db: DbExecutor): Promise<number> {
  const since = new Date(Date.now() - DAY_MS);
  const [[used], [waiting]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` })
      .from(aiUsage)
      .where(and(eq(aiUsage.feature, "enrich"), gte(aiUsage.createdAt, since))),
    db
      .select({ total: sql<string>`coalesce(sum(${enrichmentBatches.estimatedCostMicroUsd}), 0)` })
      .from(enrichmentBatches)
      .where(eq(enrichmentBatches.status, "submitted")),
  ]);
  return Number(used?.total ?? 0) + Number(waiting?.total ?? 0);
}

/**
 * Sends open posts that aren't enriched (or changed since) as one batch, newest first, within
 * the daily budget. One worker at a time (an advisory lock), so no post is sent twice. Returns
 * how many went.
 */
export async function submitEnrichmentBatch(options: EnrichmentOptions): Promise<number> {
  const db = options.db ?? getDb();
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('enrichment:submit', 0)) as locked`,
    );
    if (!lock.rows[0]?.locked) return 0;
    // Posts left on a batch that was read (a worker stopped part-way) go back in line.
    await tx
      .update(jobs)
      .set({ enrichmentBatchId: null })
      .where(
        inArray(
          jobs.enrichmentBatchId,
          tx
            .select({ id: enrichmentBatches.id })
            .from(enrichmentBatches)
            .where(ne(enrichmentBatches.status, "submitted")),
        ),
      );
    const [{ count: inFlight } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(enrichmentBatches)
      .where(eq(enrichmentBatches.status, "submitted"));
    if (inFlight >= MAX_IN_FLIGHT) return 0;

    const perPost = estimateCostMicroUsd(
      options.model,
      { ...TOKENS_PER_POST, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { batch: true },
    );
    const budget = (options.dailyBudgetUsd ?? 2) * 1_000_000;
    const affordable = Math.floor((budget - (await spentToday(tx))) / Math.max(perPost, 1));
    const limit = Math.min(options.batchSize ?? BATCH_SIZE, affordable);
    if (limit <= 0) return 0;

    const due = await tx
      .select({
        id: jobs.id,
        title: jobs.title,
        location: jobs.location,
        descriptionText: jobs.descriptionText,
        companyName: companies.name,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(
        and(
          isNull(jobs.closedAt),
          isNull(jobs.enrichmentBatchId),
          ne(jobs.descriptionText, ""),
          sql`${jobs.enrichedHash} is distinct from ${jobs.contentHash}`,
        ),
      )
      .orderBy(desc(jobs.firstSeenAt))
      .limit(limit);
    if (due.length === 0) return 0;

    const externalId = await options.batches.submit(
      due.map((job) => ({ id: job.id, request: requestFor(job, job.companyName) })),
    );
    const [batch] = await tx
      .insert(enrichmentBatches)
      .values({
        vendor: options.batches.vendor,
        model: options.model,
        externalId,
        jobCount: due.length,
        estimatedCostMicroUsd: perPost * due.length,
      })
      .returning({ id: enrichmentBatches.id });
    for (let offset = 0; offset < due.length; offset += 1000) {
      await tx
        .update(jobs)
        .set({ enrichmentBatchId: batch!.id })
        .where(
          inArray(
            jobs.id,
            due.slice(offset, offset + 1000).map((job) => job.id),
          ),
        );
    }
    log.info({ batchId: batch!.id, posts: due.length }, "enrichment batch submitted");
    return due.length;
  });
}

/**
 * Reads finished enrichment batches into their posts. A post whose request the API rejected is
 * marked done so it isn't sent again until it changes; one that merely didn't run goes back in
 * line. Returns how many posts were enriched.
 */
export async function pollEnrichmentBatches(options: EnrichmentOptions): Promise<number> {
  const db = options.db ?? getDb();
  const waiting = await db
    .select()
    .from(enrichmentBatches)
    .where(eq(enrichmentBatches.status, "submitted"));
  let enriched = 0;
  for (const batch of waiting) {
    if (!(await options.batches.isDone(batch.externalId))) continue;
    // Claimed first, so two workers never read (and meter) the same batch.
    const [claimed] = await db
      .update(enrichmentBatches)
      .set({ status: "done", finishedAt: new Date() })
      .where(and(eq(enrichmentBatches.id, batch.id), eq(enrichmentBatches.status, "submitted")))
      .returning({ id: enrichmentBatches.id });
    if (!claimed) continue;
    const posts = await db
      .select({ job: jobs, companyName: companies.name })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(jobs.enrichmentBatchId, batch.id));
    const byId = new Map(posts.map((post) => [post.job.id, post]));
    const usage: UsageRecord[] = [];
    const ctx = { userId: null, onUsage: (record: UsageRecord) => void usage.push(record) };
    for await (const { id, result } of options.batches.results(batch.externalId, (id) => {
      const post = byId.get(id);
      return post && { request: requestFor(post.job, post.companyName), ctx };
    })) {
      const post = byId.get(id);
      if (!post) continue;
      byId.delete(id);
      if (result.status === "succeeded") {
        const fields = enrichedFields(post.job, result.output as JobEnrichment);
        await db
          .update(jobs)
          .set({ ...fields, enrichmentBatchId: null })
          .where(eq(jobs.id, id));
        enriched++;
      } else {
        await db
          .update(jobs)
          .set(
            result.retryable
              ? { enrichmentBatchId: null }
              : { enrichmentBatchId: null, enrichedHash: post.job.contentHash },
          )
          .where(eq(jobs.id, id));
      }
    }
    // Posts with no result go back in line.
    if (byId.size > 0) {
      await db
        .update(jobs)
        .set({ enrichmentBatchId: null })
        .where(eq(jobs.enrichmentBatchId, batch.id));
    }
    if (usage.length > 0) {
      await db.insert(aiUsage).values(usage.map((record) => ({ userId: null, ...record })));
    }
    log.info({ batchId: batch.id, enriched }, "enrichment batch read");
  }
  return enriched;
}
