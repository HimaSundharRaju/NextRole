import { createHash } from "node:crypto";
import { createLogger } from "@nextrole/core/logger";
import { companies, getDb, jobs, type Database } from "@nextrole/db";
import { findSkills } from "@nextrole/resume/skills";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getConnector } from "./connectors";
import type { Fetcher, NormalizedJob } from "./connectors/types";
import { htmlToText, sanitizeJobHtml } from "./sanitize";

const log = createLogger("ingest");

const UPSERT_BATCH = 100;
const MAX_HYDRATIONS_PER_SYNC = 60;
const HYDRATION_CONCURRENCY = 4;

export interface SyncResult {
  companyId: string;
  fetched: number;
  newJobIds: string[];
  updated: number;
  closed: number;
}

export interface SyncOptions {
  db?: Database;
  fetch?: Fetcher;
  signal?: AbortSignal;
  now?: () => Date;
}

function contentHash(job: NormalizedJob): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        job.title,
        job.location,
        job.workplaceType,
        job.descriptionHtml,
        job.salary,
        job.applyUrl,
      ]),
    )
    .digest("hex");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Pulls one company's public job board and reconciles it with the database:
 * new postings are inserted, changed ones updated, and postings that disappeared are closed.
 */
export async function syncCompany(
  companyId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetch ?? fetch;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error(`Company ${companyId} not found`);

  const startedAt = now();
  const connector = getConnector(company.ats);
  const context = { fetch: fetcher, signal: options.signal };

  try {
    let listed = await connector.listJobs(company.boardToken, context);

    // Only hydrate postings we haven't stored yet; existing ones keep their description.
    if (connector.hydrate && listed.some((job) => job.needsHydration)) {
      const known = new Set(
        (
          await db
            .select({ externalId: jobs.externalId })
            .from(jobs)
            .where(eq(jobs.companyId, company.id))
        ).map((row) => row.externalId),
      );
      const toHydrate = listed
        .filter((job) => job.needsHydration && !known.has(job.externalId))
        .slice(0, MAX_HYDRATIONS_PER_SYNC);
      const hydrated = new Map(
        (
          await mapWithConcurrency(toHydrate, HYDRATION_CONCURRENCY, async (job) => {
            try {
              return await connector.hydrate!(company.boardToken, job, context);
            } catch (error) {
              log.warn({ err: error, externalId: job.externalId }, "hydration failed");
              return job;
            }
          })
        ).map((job) => [job.externalId, job]),
      );
      listed = listed
        .filter(
          (job) => !job.needsHydration || hydrated.has(job.externalId) || known.has(job.externalId),
        )
        .map((job) => hydrated.get(job.externalId) ?? job);
    }

    const newJobIds: string[] = [];
    let updated = 0;
    const seen = new Map(listed.map((job) => [job.externalId, job]));

    for (let offset = 0; offset < seen.size; offset += UPSERT_BATCH) {
      const batch = [...seen.values()].slice(offset, offset + UPSERT_BATCH);
      const rows = batch.map((job) => {
        const descriptionHtml = sanitizeJobHtml(job.descriptionHtml);
        const descriptionText = htmlToText(descriptionHtml);
        return {
          companyId: company.id,
          source: company.ats,
          externalId: job.externalId,
          title: job.title.slice(0, 300),
          department: job.department.slice(0, 300),
          location: job.location.slice(0, 500),
          workplaceType: job.workplaceType,
          employmentType: job.employmentType.slice(0, 100),
          descriptionHtml,
          descriptionText,
          applyUrl: job.applyUrl,
          skills: findSkills(`${job.title}\n${descriptionText}`),
          salaryMin: job.salary?.min ?? null,
          salaryMax: job.salary?.max ?? null,
          salaryCurrency: job.salary?.currency ?? null,
          salaryPeriod: job.salary?.period ?? null,
          postedAt: job.postedAt && !Number.isNaN(job.postedAt.getTime()) ? job.postedAt : null,
          firstSeenAt: startedAt,
          lastSeenAt: startedAt,
          contentHash: contentHash(job),
        };
      });

      const result = await db
        .insert(jobs)
        .values(rows)
        .onConflictDoUpdate({
          target: [jobs.companyId, jobs.externalId],
          set: {
            title: sql`excluded.title`,
            department: sql`excluded.department`,
            location: sql`excluded.location`,
            workplaceType: sql`excluded.workplace_type`,
            employmentType: sql`excluded.employment_type`,
            // SmartRecruiters listings arrive without descriptions; never blank an existing one.
            descriptionHtml: sql`case when excluded.description_html = '' then ${jobs.descriptionHtml} else excluded.description_html end`,
            descriptionText: sql`case when excluded.description_text = '' then ${jobs.descriptionText} else excluded.description_text end`,
            applyUrl: sql`excluded.apply_url`,
            skills: sql`case when excluded.description_text = '' then ${jobs.skills} else excluded.skills end`,
            salaryMin: sql`coalesce(excluded.salary_min, ${jobs.salaryMin})`,
            salaryMax: sql`coalesce(excluded.salary_max, ${jobs.salaryMax})`,
            salaryCurrency: sql`coalesce(excluded.salary_currency, ${jobs.salaryCurrency})`,
            salaryPeriod: sql`coalesce(excluded.salary_period, ${jobs.salaryPeriod})`,
            postedAt: sql`coalesce(${jobs.postedAt}, excluded.posted_at)`,
            lastSeenAt: sql`excluded.last_seen_at`,
            closedAt: sql`null`,
            contentHash: sql`excluded.content_hash`,
            updatedAt: sql`case when ${jobs.contentHash} is distinct from excluded.content_hash then now() else ${jobs.updatedAt} end`,
          },
        })
        .returning({
          id: jobs.id,
          inserted: sql<boolean>`(xmax = 0)`,
        });

      for (const row of result) {
        if (row.inserted) newJobIds.push(row.id);
        else updated++;
      }
    }

    const closedRows = await db
      .update(jobs)
      .set({ closedAt: startedAt })
      .where(
        and(eq(jobs.companyId, company.id), isNull(jobs.closedAt), lt(jobs.lastSeenAt, startedAt)),
      )
      .returning({ id: jobs.id });

    await db
      .update(companies)
      .set({
        lastSyncedAt: now(),
        lastSyncStatus: "ok",
        lastSyncError: null,
        openJobCount: seen.size,
      })
      .where(eq(companies.id, company.id));

    const result: SyncResult = {
      companyId: company.id,
      fetched: seen.size,
      newJobIds,
      updated,
      closed: closedRows.length,
    };
    log.info({ company: company.slug, ...result, newJobIds: newJobIds.length }, "company synced");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(companies)
      .set({ lastSyncedAt: now(), lastSyncStatus: "error", lastSyncError: message.slice(0, 500) })
      .where(eq(companies.id, company.id));
    throw error;
  }
}

/** Active companies that are due for a sync (never synced or older than `staleAfterMs`). */
export async function companiesDueForSync(
  staleAfterMs: number,
  db: Database = getDb(),
): Promise<string[]> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.active, true),
        sql`(${companies.lastSyncedAt} is null or ${companies.lastSyncedAt} < ${cutoff})`,
      ),
    );
  return rows.map((row) => row.id);
}

export async function jobsByIds(ids: string[], db: Database = getDb()) {
  if (ids.length === 0) return [];
  return db.select().from(jobs).where(inArray(jobs.id, ids));
}
