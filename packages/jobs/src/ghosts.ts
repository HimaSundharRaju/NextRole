import { createLogger } from "@gettargetrole/core/logger";
import { getDb, jobReports, jobs, type Database, type JobReportReason } from "@gettargetrole/db";
import { and, eq, isNull, lt, sql, type SQL } from "drizzle-orm";

/*
 * Ghost jobs: posts that stay up with no one being hired for them. Nothing proves a job is a
 * ghost, so each sign adds points and only several together (or a strong one) pass the line
 * where search hides the job, alerts skip it and auto-prepare spends nothing on it.
 */

const log = createLogger("ghosts");

/** At this score a job is likely a ghost job. */
export const LIKELY_GHOST_SCORE = 60;

/**
 * Points per sign, capped at 100 in all. Months open with two reposts pass the line, as do
 * three reports or a talent pool; months open alone, or one report, don't.
 */
export const GHOST_POINTS = {
  open60: 20,
  open120: 35,
  /** Per repost, counting up to two. */
  repost: 15,
  evergreen: 60,
  /** Per report from a different job seeker, counting up to three. */
  report: 20,
} as const;

/** How far back a closed posting of the same role makes a new one a repost. */
const REPOST_WINDOW_DAYS = 180;

/** Titles of talent pools and general applications rather than one opening (a Postgres regex). */
export const TALENT_POOL_TITLE =
  "\\y(general application|open application|speculative application|talent (community|network|pool|pipeline)|future (opportunit|opening|role)|expression of interest|always (hiring|accepting)|evergreen)";

/**
 * Counts, for a company's jobs first seen since `since`, how often the employer has posted the
 * role before: the latest earlier posting of it (same fingerprint) that closed in the half year
 * before, plus that posting's own count. A role with another posting still open is a team
 * hiring several people, not a repost.
 */
export async function markReposts(db: Database, companyId: string, since: Date): Promise<void> {
  await db.execute(sql`
    update ${jobs} as j set repost_count = coalesce((
      select p.repost_count + 1 from ${jobs} p
      where p.company_id = j.company_id and p.fingerprint = j.fingerprint and p.id <> j.id
        and p.closed_at is not null
        and p.first_seen_at < j.first_seen_at
        and p.closed_at > j.first_seen_at - make_interval(days => ${REPOST_WINDOW_DAYS}::int)
      order by p.first_seen_at desc
      limit 1
    ), 0)
    where j.company_id = ${companyId}
      and j.first_seen_at >= ${since.toISOString()}::timestamptz
      and j.closed_at is null and j.fingerprint is not null
      and not exists (
        select 1 from ${jobs} o
        where o.company_id = j.company_id and o.fingerprint = j.fingerprint and o.id <> j.id
          and o.closed_at is null
      )`);
}

/**
 * Scores open jobs (all, a company's, or the given ones) for the signs of a ghost job. A job's
 * age counts from when its board says it was posted, else from when it was first seen.
 * Returns how many scores changed.
 */
export async function scoreGhostJobs(
  db: Database = getDb(),
  scope: { companyId?: string; jobIds?: string[] } = {},
): Promise<number> {
  const where: SQL[] = [sql`j.closed_at is null`];
  if (scope.companyId) where.push(sql`j.company_id = ${scope.companyId}`);
  if (scope.jobIds) where.push(sql`j.id = any(${sql.param(scope.jobIds)}::uuid[])`);
  const points = GHOST_POINTS;
  const result = await db.execute(sql`
    with signs as (
      select j.id,
        now() - coalesce(j.posted_at, j.first_seen_at) as age,
        least(j.repost_count, 2) as reposts,
        (j.title ~* ${TALENT_POOL_TITLE}
          or coalesce((j.enrichment ->> 'evergreen')::boolean, false)) as evergreen,
        (select least(count(*), 3)::int from ${jobReports} r where r.job_id = j.id) as reports
      from ${jobs} j
      where ${sql.join(where, sql` and `)}
    ),
    scored as (
      select id,
        array_remove(array[
          case
            when age >= interval '120 days' then 'open_120d'
            when age >= interval '60 days' then 'open_60d'
          end,
          case when reposts > 0 then 'reposted' end,
          case when evergreen then 'evergreen' end,
          case when reports > 0 then 'reported' end
        ], null) as reasons,
        least(100,
          case
            when age >= interval '120 days' then ${points.open120}::int
            when age >= interval '60 days' then ${points.open60}::int
            else 0
          end
          + reposts * ${points.repost}::int
          + case when evergreen then ${points.evergreen}::int else 0 end
          + reports * ${points.report}::int
        ) as score
      from signs
    )
    update ${jobs} as target
    set ghost_score = scored.score, ghost_reasons = scored.reasons
    from scored
    where target.id = scored.id
      and (target.ghost_score <> scored.score or target.ghost_reasons <> scored.reasons)`);
  return result.rowCount ?? 0;
}

/**
 * Closes open jobs whose closing date has passed: a sync closes them too, but a board that
 * stopped syncing wouldn't. Returns how many closed.
 */
export async function expireJobs(db: Database = getDb(), now = new Date()): Promise<number> {
  const closed = await db
    .update(jobs)
    .set({ closedAt: now })
    .where(and(isNull(jobs.closedAt), lt(jobs.expiresAt, now)))
    .returning({ id: jobs.id });
  if (closed.length > 0) log.info({ closed: closed.length }, "expired jobs closed");
  return closed.length;
}

/** Records (or updates) a job seeker's report that a job isn't really open, and rescores it. */
export async function reportJob(
  input: { userId: string; jobId: string; reason: JobReportReason; note?: string },
  db: Database = getDb(),
): Promise<void> {
  const note = input.note?.trim().slice(0, 500) ?? "";
  await db
    .insert(jobReports)
    .values({ userId: input.userId, jobId: input.jobId, reason: input.reason, note })
    .onConflictDoUpdate({
      target: [jobReports.userId, jobReports.jobId],
      set: { reason: input.reason, note, createdAt: new Date() },
    });
  await scoreGhostJobs(db, { jobIds: [input.jobId] });
}

/** Withdraws a job seeker's report, and rescores the job. */
export async function withdrawJobReport(
  input: { userId: string; jobId: string },
  db: Database = getDb(),
): Promise<void> {
  await db
    .delete(jobReports)
    .where(and(eq(jobReports.userId, input.userId), eq(jobReports.jobId, input.jobId)));
  await scoreGhostJobs(db, { jobIds: [input.jobId] });
}
