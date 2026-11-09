import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { CHANGED_MESSAGE } from "../concierge/rules";
import {
  companies,
  jobEmployerName,
  jobReports,
  jobs,
  users,
  type JobReportReason,
} from "../schema";
import { REASON_MAX, SupportError } from "./rules";

const DAY_MS = 86_400_000;
const LATEST_NOTES = 3;

export interface ReportedJob {
  jobId: string;
  title: string;
  companyName: string;
  location: string;
  postedAt: Date | null;
  ghostScore: number;
  applyUrl: string;
  /** Unreviewed reports. */
  reports: number;
  reasons: Partial<Record<JobReportReason, number>>;
  /** The latest non-empty notes, newest first. */
  notes: string[];
  firstReportedAt: Date;
}

/**
 * Open, unhidden jobs with reports nobody has reviewed: the most reported first, then the one
 * reported longest ago.
 */
export async function reportQueue(db: Database, limit = 100): Promise<ReportedJob[]> {
  const grouped = await db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      companyName: jobEmployerName(),
      location: jobs.location,
      postedAt: jobs.postedAt,
      ghostScore: jobs.ghostScore,
      applyUrl: jobs.applyUrl,
      reports: sql<number>`count(*)::int`,
      firstReportedAt: sql<Date | string>`min(${jobReports.createdAt})`,
    })
    .from(jobReports)
    .innerJoin(jobs, eq(jobs.id, jobReports.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(isNull(jobReports.reviewedAt), isNull(jobs.closedAt), isNull(jobs.hiddenAt)))
    .groupBy(jobs.id, companies.id)
    .orderBy(desc(sql`count(*)`), asc(sql`min(${jobReports.createdAt})`))
    .limit(limit);
  if (grouped.length === 0) return [];
  const details = await db
    .select({
      jobId: jobReports.jobId,
      reason: jobReports.reason,
      note: jobReports.note,
    })
    .from(jobReports)
    .where(
      and(
        inArray(
          jobReports.jobId,
          grouped.map((row) => row.jobId),
        ),
        isNull(jobReports.reviewedAt),
      ),
    )
    .orderBy(desc(jobReports.createdAt));
  const byJob = new Map<string, typeof details>();
  for (const detail of details) {
    byJob.set(detail.jobId, [...(byJob.get(detail.jobId) ?? []), detail]);
  }
  return grouped.map((row) => {
    const reports = byJob.get(row.jobId) ?? [];
    const reasons: Partial<Record<JobReportReason, number>> = {};
    for (const report of reports) reasons[report.reason] = (reasons[report.reason] ?? 0) + 1;
    return {
      ...row,
      reasons,
      notes: reports
        .map((report) => report.note.trim())
        .filter(Boolean)
        .slice(0, LATEST_NOTES),
      firstReportedAt: new Date(row.firstReportedAt),
    };
  });
}

/**
 * The job is real: its unreviewed reports stop adding ghost points. Returns how many it cleared.
 * The caller rescores the job.
 */
export async function keepReportedJob(
  db: Database,
  input: { jobId: string; agentId: string; now?: Date },
): Promise<number> {
  const rows = await db
    .update(jobReports)
    .set({
      reviewedAt: input.now ?? new Date(),
      reviewedByUserId: input.agentId,
      resolution: "kept",
    })
    .where(and(eq(jobReports.jobId, input.jobId), isNull(jobReports.reviewedAt)))
    .returning({ userId: jobReports.userId });
  return rows.length;
}

/** Removes a job from search, alerts and proposals; its unreviewed reports are marked hidden. */
export async function hideJob(
  db: Database,
  input: { jobId: string; agentId: string; reason: string; now?: Date },
): Promise<void> {
  const reason = input.reason.trim().slice(0, REASON_MAX);
  if (!reason) throw new SupportError("not_allowed", "Say why you're hiding it.");
  const at = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [job] = await tx
      .update(jobs)
      .set({ hiddenAt: at, hiddenByUserId: input.agentId, hiddenReason: reason })
      .where(and(eq(jobs.id, input.jobId), isNull(jobs.hiddenAt)))
      .returning({ id: jobs.id });
    if (!job) {
      const [exists] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1);
      throw exists
        ? new SupportError("conflict", CHANGED_MESSAGE)
        : new SupportError("not_found", "Job not found.");
    }
    await tx
      .update(jobReports)
      .set({ reviewedAt: at, reviewedByUserId: input.agentId, resolution: "hidden" })
      .where(and(eq(jobReports.jobId, input.jobId), isNull(jobReports.reviewedAt)));
  });
}

/** Undoes a hide: the job is back in search, and its reports are up for review again. */
export async function unhideJob(db: Database, input: { jobId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .update(jobs)
      .set({ hiddenAt: null, hiddenByUserId: null, hiddenReason: "" })
      .where(and(eq(jobs.id, input.jobId), isNotNull(jobs.hiddenAt)))
      .returning({ id: jobs.id });
    if (!job) throw new SupportError("conflict", CHANGED_MESSAGE);
    await tx
      .update(jobReports)
      .set({ reviewedAt: null, reviewedByUserId: null, resolution: null })
      .where(and(eq(jobReports.jobId, input.jobId), eq(jobReports.resolution, "hidden")));
  });
}

/** Jobs customer care hid in the last 30 days, newest first, so a mistake can be undone. */
export async function recentlyHiddenJobs(
  db: Database,
  input: { now?: Date; days?: number },
): Promise<
  Array<{
    jobId: string;
    title: string;
    companyName: string;
    hiddenAt: Date;
    hiddenReason: string;
    hiddenByName: string | null;
  }>
> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.days ?? 30) * DAY_MS);
  const rows = await db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      companyName: jobEmployerName(),
      hiddenAt: jobs.hiddenAt,
      hiddenReason: jobs.hiddenReason,
      hiddenByName: users.name,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(users, eq(users.id, jobs.hiddenByUserId))
    .where(and(isNotNull(jobs.hiddenAt), gte(jobs.hiddenAt, since)))
    .orderBy(desc(jobs.hiddenAt));
  return rows.map((row) => ({ ...row, hiddenAt: row.hiddenAt! }));
}
