import { createHash } from "node:crypto";
import { createLogger } from "@gettargetrole/core/logger";
import {
  applications,
  companies,
  getDb,
  jobs,
  type AtsProvider,
  type Database,
} from "@gettargetrole/db";
import { findSkills } from "@gettargetrole/resume/skills";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { boardFetch, getConnector } from "./connectors";
import type { Fetcher, NormalizedJob } from "./connectors/types";
import { parseEmploymentTypes } from "./employment";
import { parseLocations } from "./locations";
import { htmlToText, sanitizeJobHtml } from "./sanitize";
import { parseVisaSignals } from "./visa";

const log = createLogger("ingest");

const UPSERT_BATCH = 100;
const SEEN_BATCH = 1000;
const MAX_HYDRATIONS_PER_SYNC = 60;
const HYDRATION_CONCURRENCY = 4;

/**
 * A board that suddenly lists this small a share of its open jobs is more likely broken (an
 * outage, a changed site) than emptied, so nothing is closed and the sync is flagged. A drop
 * that lasts this many syncs in a row is real (a hiring freeze) and is accepted.
 */
const SUSPICIOUS_DROP_SHARE = 0.2;
const SUSPICIOUS_DROP_MIN_OPEN = 20;
const ACCEPT_DROP_AFTER = 3;

/**
 * A board that can't list everything never proves a job is gone, so its jobs close once they
 * haven't been seen for this long instead.
 */
const UNSEEN_CLOSE_DAYS = 14;

/**
 * Minutes between syncs for boards that list thousands of jobs over many requests; other boards
 * use the worker's interval. `companies.sync_interval_minutes` overrides both.
 */
export const PROVIDER_SYNC_MINUTES: Partial<Record<AtsProvider, number>> = {
  workday: 180,
  oracle: 180,
  eightfold: 180,
  amazon: 360,
};

/** The longest a failing board waits between tries. */
const MAX_BACKOFF_MINUTES = 24 * 60;

export interface SyncResult {
  companyId: string;
  fetched: number;
  newJobIds: string[];
  updated: number;
  closed: number;
  /** False when missing postings weren't closed: the listing was partial or looked broken. */
  closedMissing: boolean;
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

/**
 * A salary as its integer column can hold it. Boards send decimals (hourly rates such as 60.58),
 * which Postgres rejects, failing the whole batch; amounts out of range are dropped.
 */
function wholeSalary(amount: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const rounded = Math.round(amount);
  return Math.abs(rounded) <= 2_147_483_647 ? rounded : null;
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
 * Pulls one company's public job board and reconciles it with the database: new postings are
 * inserted, changed ones updated, and postings that disappeared are closed — only when the board
 * listed everything and the listing doesn't look broken.
 */
export async function syncCompany(
  companyId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetch ?? boardFetch;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error(`Company ${companyId} not found`);

  const startedAt = now();
  const connector = getConnector(company.ats);
  const context = { fetch: fetcher, signal: options.signal };

  try {
    const listing = await connector.listJobs(company.boardToken, context);
    const listed = listing.jobs;
    const known = new Set<string>();
    const hydrated = new Map<string, NormalizedJob>();

    // Only hydrate postings we haven't stored yet; existing ones keep their description.
    if (connector.hydrate && listed.some((job) => job.needsHydration)) {
      for (const row of await db
        .select({ externalId: jobs.externalId })
        .from(jobs)
        .where(eq(jobs.companyId, company.id))) {
        known.add(row.externalId);
      }
      const toHydrate = listed
        .filter((job) => job.needsHydration && !known.has(job.externalId))
        .slice(0, connector.hydrationsPerSync ?? MAX_HYDRATIONS_PER_SYNC);
      await mapWithConcurrency(toHydrate, HYDRATION_CONCURRENCY, async (job) => {
        try {
          hydrated.set(job.externalId, await connector.hydrate!(company.boardToken, job, context));
        } catch (error) {
          log.warn({ err: error, externalId: job.externalId }, "hydration failed");
        }
      });
    }

    // A known posting the listing can't describe (its details come from `hydrate`) is only
    // marked as still open, so the listing's partial fields never overwrite the stored ones.
    // A new posting still waiting for its details is left for the next sync.
    const described: NormalizedJob[] = [];
    const stillOpen: string[] = [];
    for (const job of listed) {
      const full = hydrated.get(job.externalId) ?? job;
      if (!full.needsHydration) described.push(full);
      else if (known.has(job.externalId)) stillOpen.push(job.externalId);
    }

    const newJobIds: string[] = [];
    let updated = 0;
    const toUpsert = [...new Map(described.map((job) => [job.externalId, job])).values()];

    for (let offset = 0; offset < toUpsert.length; offset += UPSERT_BATCH) {
      const batch = toUpsert.slice(offset, offset + UPSERT_BATCH);
      const rows = batch.map((job) => {
        const descriptionHtml = sanitizeJobHtml(job.descriptionHtml);
        const descriptionText = htmlToText(descriptionHtml);
        const places = parseLocations([job.location], job.placeHints);
        const visa = parseVisaSignals(descriptionText);
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
          salaryMin: wholeSalary(job.salary?.min),
          salaryMax: wholeSalary(job.salary?.max),
          salaryCurrency: job.salary?.currency ?? null,
          salaryPeriod: job.salary?.period ?? null,
          countries: places.countries,
          regions: places.regions,
          employmentTypes: parseEmploymentTypes(job.employmentType, job.title, descriptionText),
          visaSponsorship: visa.sponsorship,
          citizenshipRequired: visa.citizenshipRequired,
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
            countries: sql`excluded.countries`,
            regions: sql`excluded.regions`,
            // Like skills, signals read from the description survive listings that omit it.
            employmentTypes: sql`case when excluded.description_text = '' then ${jobs.employmentTypes} else excluded.employment_types end`,
            visaSponsorship: sql`case when excluded.description_text = '' then ${jobs.visaSponsorship} else excluded.visa_sponsorship end`,
            citizenshipRequired: sql`case when excluded.description_text = '' then ${jobs.citizenshipRequired} else excluded.citizenship_required end`,
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

    for (let offset = 0; offset < stillOpen.length; offset += SEEN_BATCH) {
      await db
        .update(jobs)
        .set({ lastSeenAt: startedAt, closedAt: null })
        .where(
          and(
            eq(jobs.companyId, company.id),
            inArray(jobs.externalId, stillOpen.slice(offset, offset + SEEN_BATCH)),
          ),
        );
    }

    const listedCount = new Set(listed.map((job) => job.externalId)).size;
    const suspicious =
      company.openJobCount >= SUSPICIOUS_DROP_MIN_OPEN &&
      listedCount < company.openJobCount * SUSPICIOUS_DROP_SHARE &&
      company.syncFailures < ACCEPT_DROP_AFTER - 1;
    const closeMissing = listing.complete && !suspicious;
    // A partial listing closes only jobs it hasn't seen for a while; a broken one closes none.
    const seenBefore = closeMissing
      ? startedAt
      : suspicious
        ? null
        : new Date(startedAt.getTime() - UNSEEN_CLOSE_DAYS * 86_400_000);
    const closedRows = seenBefore
      ? await db
          .update(jobs)
          .set({ closedAt: startedAt })
          .where(
            and(
              eq(jobs.companyId, company.id),
              isNull(jobs.closedAt),
              lt(jobs.lastSeenAt, seenBefore),
            ),
          )
          .returning({ id: jobs.id })
      : [];

    await db
      .update(companies)
      .set(
        suspicious
          ? {
              // The count it dropped from stays, so the next sync is checked against it too.
              lastSyncedAt: now(),
              lastSyncStatus: "error",
              lastSyncError: `Listed ${listedCount} jobs, down from ${company.openJobCount}; none were closed`,
              syncFailures: sql`${companies.syncFailures} + 1`,
            }
          : {
              lastSyncedAt: now(),
              lastSyncStatus: "ok",
              lastSyncError: null,
              syncFailures: 0,
              // A partial listing isn't the board's size, so the last full count stands.
              openJobCount: listing.complete
                ? listedCount
                : Math.max(listedCount, company.openJobCount),
            },
      )
      .where(eq(companies.id, company.id));

    const result: SyncResult = {
      companyId: company.id,
      fetched: listedCount,
      newJobIds,
      updated,
      closed: closedRows.length,
      closedMissing: closeMissing,
    };
    if (suspicious) log.warn({ company: company.slug, listedCount }, "board listed far fewer jobs");
    log.info({ company: company.slug, ...result, newJobIds: newJobIds.length }, "company synced");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(companies)
      .set({
        lastSyncedAt: now(),
        lastSyncStatus: "error",
        lastSyncError: message.slice(0, 500),
        syncFailures: sql`${companies.syncFailures} + 1`,
      })
      .where(eq(companies.id, company.id));
    throw error;
  }
}

/**
 * Active companies due for a sync: never synced, or last synced longer ago than their interval
 * (`staleAfterMs` unless the company or its provider sets one), doubled for each failure in a
 * row up to a day.
 */
export async function companiesDueForSync(
  staleAfterMs: number,
  db: Database = getDb(),
): Promise<string[]> {
  const byProvider = Object.entries(PROVIDER_SYNC_MINUTES).map(
    ([provider, minutes]) => sql`when ${provider} then ${minutes}::int`,
  );
  const interval = sql`coalesce(${companies.syncIntervalMinutes}, case ${companies.ats} ${sql.join(byProvider, sql` `)} else ${Math.round(staleAfterMs / 60_000)}::int end)`;
  const wait = sql`least(${interval} * power(2, least(${companies.syncFailures}, 10)), ${MAX_BACKOFF_MINUTES}::int)`;
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.active, true),
        sql`(${companies.lastSyncedAt} is null or ${companies.lastSyncedAt} < now() - ${wait} * interval '1 minute')`,
      ),
    );
  return rows.map((row) => row.id);
}

/** How long a closed job is kept: long enough for "recently closed" to mean something. */
export const CLOSED_JOB_RETENTION_DAYS = 60;
const PRUNE_BATCH = 5000;

/**
 * Deletes jobs closed longer than the retention period, except those a user's application
 * points to (its job page stays readable). Large boards close thousands of jobs a month, so
 * without this the table only grows. Works in batches to keep each delete short.
 */
export async function pruneClosedJobs(
  db: Database = getDb(),
  retentionDays = CLOSED_JOB_RETENTION_DAYS,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const rows = await db.execute<{ id: string }>(sql`
      delete from ${jobs}
      where id in (
        select j.id from ${jobs} j
        where j.closed_at < now() - make_interval(days => ${retentionDays})
          and not exists (select 1 from ${applications} a where a.job_id = j.id)
        limit ${PRUNE_BATCH}
      )
      returning id`);
    deleted += rows.rows.length;
    if (rows.rows.length < PRUNE_BATCH) break;
  }
  if (deleted > 0) log.info({ deleted }, "old closed jobs deleted");
  return deleted;
}

export async function jobsByIds(ids: string[], db: Database = getDb()) {
  if (ids.length === 0) return [];
  return db.select().from(jobs).where(inArray(jobs.id, ids));
}
