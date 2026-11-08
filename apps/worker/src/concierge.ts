import { sendEmail } from "@gettargetrole/core/mailer";
import { applications, getDb, notifications, users, type Database } from "@gettargetrole/db";
import { and, eq, gte, sql } from "drizzle-orm";

export { expireProposals } from "@gettargetrole/db";

const DAY_MS = 86_400_000;

/**
 * Emails each Concierge client with proposals from the last day, once per day: the in-app
 * notification's dedupe key (digest:<date>) decides who still needs today's email.
 */
export async function sendConciergeDigests(
  now = new Date(),
  db: Database = getDb(),
): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select({
      userId: applications.userId,
      email: users.email,
      name: users.name,
      count: sql<number>`count(*)::int`,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(eq(applications.status, "proposed"), gte(applications.proposedAt, since)))
    .groupBy(applications.userId, users.email, users.name);
  const day = now.toISOString().slice(0, 10);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  let sent = 0;
  for (const row of rows) {
    const [inserted] = await db
      .insert(notifications)
      .values({
        userId: row.userId,
        type: "concierge",
        title: "New jobs from your specialist",
        body: `${row.count} job${row.count === 1 ? "" : "s"} waiting for your approval.`,
        link: "/applications",
        dedupeKey: `digest:${day}`,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!inserted) continue;
    try {
      await sendEmail({
        to: row.email,
        subject: "New jobs from your specialist",
        text: `Hi ${row.name},\n\nYour specialist found ${row.count} job${row.count === 1 ? "" : "s"} for you. Approve the ones you want them to apply to, or skip the rest:\n\n${base}/applications\n\nProposals you don't answer within a week are skipped.\n`,
      });
    } catch (error) {
      // Undo today's marker so the queue's retry sends this email again.
      await db.delete(notifications).where(eq(notifications.id, inserted.id));
      throw error;
    }
    sent++;
  }
  return sent;
}
