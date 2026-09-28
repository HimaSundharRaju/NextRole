import { createLogger } from "@gettargetrole/core/logger";
import { getDb, jobs, notifications, profiles, type Database } from "@gettargetrole/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { quickMatch } from "./match";

const log = createLogger("alerts");

function openJobs(jobIds: string[], db: Database) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      skills: jobs.skills,
      location: jobs.location,
      workplaceType: jobs.workplaceType,
      salaryMax: jobs.salaryMax,
      salaryPeriod: jobs.salaryPeriod,
      visaSponsorship: jobs.visaSponsorship,
      citizenshipRequired: jobs.citizenshipRequired,
    })
    .from(jobs)
    .where(and(inArray(jobs.id, jobIds), isNull(jobs.closedAt)));
}

/** Postings that say they won't sponsor, or that require citizenship or a clearance. */
function rulesOutSponsorship(job: { visaSponsorship: string; citizenshipRequired: boolean }) {
  return job.visaSponsorship === "no" || job.citizenshipRequired;
}

/**
 * Notifies users about newly discovered jobs that score above their alert threshold.
 * Postgres pre-filters candidates by skill overlap (GIN-indexed array `&&`), then the
 * deterministic scorer ranks them. Notifications are de-duplicated per user and job.
 */
export async function createJobAlerts(jobIds: string[], db: Database = getDb()): Promise<number> {
  if (jobIds.length === 0) return 0;
  const newJobs = await openJobs(jobIds, db);

  let created = 0;
  for (const job of newJobs) {
    if (job.skills.length === 0) continue;
    const candidates = await db
      .select({
        userId: profiles.userId,
        skills: profiles.skills,
        targetTitles: profiles.targetTitles,
        targetLocations: profiles.targetLocations,
        remotePreference: profiles.remotePreference,
        seniority: profiles.seniority,
        minSalary: profiles.minSalary,
        alertMinScore: profiles.alertMinScore,
        needsSponsorship: profiles.needsSponsorship,
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.alertsEnabled, true),
          sql`${profiles.skills} && ${sql.param(job.skills)}::text[]`,
        ),
      );

    const rows = candidates.flatMap((candidate) => {
      if (candidate.needsSponsorship && rulesOutSponsorship(job)) return [];
      const match = quickMatch(candidate, job);
      if (match.score < candidate.alertMinScore) return [];
      return [
        {
          userId: candidate.userId,
          type: "job_match" as const,
          title: `${match.score}% match: ${job.title}`,
          body: match.reasons.join(" · "),
          link: `/jobs/${job.id}`,
          dedupeKey: `job:${job.id}`,
        },
      ];
    });
    if (rows.length === 0) continue;
    const inserted = await db
      .insert(notifications)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    created += inserted.length;
  }
  log.info({ jobs: newJobs.length, notifications: created }, "job alerts created");
  return created;
}

export interface AutoPrepareCandidate {
  userId: string;
  jobId: string;
  score: number;
}

/**
 * Users with auto-prepare on whose profile matches a new job at or above their minimum score,
 * best matches first. Scoring is the same deterministic match as alerts, so it costs no AI tokens;
 * users who need sponsorship skip jobs that rule it out.
 */
export async function autoPrepareCandidates(
  jobIds: string[],
  db: Database = getDb(),
): Promise<AutoPrepareCandidate[]> {
  if (jobIds.length === 0) return [];
  const found: AutoPrepareCandidate[] = [];
  for (const job of await openJobs(jobIds, db)) {
    if (job.skills.length === 0) continue;
    const candidates = await db
      .select({
        userId: profiles.userId,
        skills: profiles.skills,
        targetTitles: profiles.targetTitles,
        targetLocations: profiles.targetLocations,
        remotePreference: profiles.remotePreference,
        seniority: profiles.seniority,
        minSalary: profiles.minSalary,
        autoPrepareMinScore: profiles.autoPrepareMinScore,
        needsSponsorship: profiles.needsSponsorship,
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.autoPrepareEnabled, true),
          sql`${profiles.skills} && ${sql.param(job.skills)}::text[]`,
        ),
      );
    for (const candidate of candidates) {
      if (candidate.needsSponsorship && rulesOutSponsorship(job)) continue;
      const { score } = quickMatch(candidate, job);
      if (score >= candidate.autoPrepareMinScore) {
        found.push({ userId: candidate.userId, jobId: job.id, score });
      }
    }
  }
  return found.sort((a, b) => b.score - a.score);
}
