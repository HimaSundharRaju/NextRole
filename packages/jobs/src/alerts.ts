import { createLogger } from "@nextrole/core/logger";
import { getDb, jobs, notifications, profiles, type Database } from "@nextrole/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { quickMatch } from "./match";

const log = createLogger("alerts");

/**
 * Notifies users about newly discovered jobs that score above their alert threshold.
 * Postgres pre-filters candidates by skill overlap (GIN-indexed array `&&`), then the
 * deterministic scorer ranks them. Notifications are de-duplicated per user and job.
 */
export async function createJobAlerts(jobIds: string[], db: Database = getDb()): Promise<number> {
  if (jobIds.length === 0) return 0;
  const newJobs = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      skills: jobs.skills,
      location: jobs.location,
      workplaceType: jobs.workplaceType,
      salaryMax: jobs.salaryMax,
      salaryPeriod: jobs.salaryPeriod,
    })
    .from(jobs)
    .where(and(inArray(jobs.id, jobIds), isNull(jobs.closedAt)));

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
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.alertsEnabled, true),
          sql`${profiles.skills} && ${sql.param(job.skills)}::text[]`,
        ),
      );

    const rows = candidates.flatMap((candidate) => {
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
