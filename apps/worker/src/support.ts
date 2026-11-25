import { createLogger } from "@gettargetrole/core/logger";
import { sendEmail } from "@gettargetrole/core/mailer";
import {
  autoSolveCases,
  caseEmail,
  caseLink,
  caseNotification,
  getDb,
  notifications,
  runWeeklyCheck,
  type Database,
} from "@gettargetrole/db";

const log = createLogger("support");

/**
 * Solves the cases that have waited on the requester for a week, and tells each requester: an
 * in-app notification for signed-in users, then an email with their private link. The case is
 * already solved by then, so a failure to tell someone is logged and goes no further.
 */
export async function runAutoSolve(now = new Date(), db: Database = getDb()): Promise<number> {
  const solved = await autoSolveCases(db, now);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  for (const notice of solved) {
    if (notice.userId) {
      try {
        await db.insert(notifications).values(
          caseNotification({
            userId: notice.userId,
            caseId: notice.caseId,
            number: notice.number,
            subject: notice.subject,
            event: "auto_solved",
          }),
        );
      } catch (error) {
        log.warn({ err: error, caseId: notice.caseId }, "auto-solve notification failed");
      }
    }
    if (!notice.contactEmail) continue;
    try {
      await sendEmail(
        caseEmail({
          number: notice.number,
          subject: notice.subject,
          contactName: notice.contactName,
          contactEmail: notice.contactEmail,
          event: "auto_solved",
          link: caseLink(appUrl, notice.caseId, notice.token),
        }),
      );
    } catch (error) {
      log.warn({ err: error, caseId: notice.caseId }, "auto-solve email failed");
    }
  }
  return solved.length;
}

/** The Monday check for Concierge clients who missed last week's target. */
export function runConciergeWeeklyCheck(
  now = new Date(),
  db: Database = getDb(),
): Promise<{ opened: number; noted: number }> {
  return runWeeklyCheck(db, now);
}
