import { applications, getDb, notifications, type Database } from "@gettargetrole/db";
import { and, inArray, isNotNull, lte } from "drizzle-orm";

const ACTIVE_STATUSES = ["applied", "screening", "interviewing", "offer"] as const;

/**
 * Creates one in-app reminder per application whose follow-up date has arrived.
 * The dedupe key includes the follow-up date, so rescheduling produces a new reminder.
 */
export async function createFollowUpReminders(
  now = new Date(),
  db: Database = getDb(),
): Promise<number> {
  const due = await db
    .select({
      id: applications.id,
      userId: applications.userId,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      nextActionAt: applications.nextActionAt,
    })
    .from(applications)
    .where(
      and(
        isNotNull(applications.nextActionAt),
        lte(applications.nextActionAt, now),
        inArray(applications.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(5000);
  if (due.length === 0) return 0;

  const inserted = await db
    .insert(notifications)
    .values(
      due.map((app) => ({
        userId: app.userId,
        type: "follow_up" as const,
        title: `Follow up with ${app.companyName}`,
        body: `It's time to check in about the ${app.jobTitle} role.`,
        link: `/applications/${app.id}`,
        dedupeKey: `follow-up:${app.id}:${app.nextActionAt!.toISOString().slice(0, 10)}`,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return inserted.length;
}
