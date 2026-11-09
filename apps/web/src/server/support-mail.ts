import "server-only";
import { getServerEnv } from "@gettargetrole/core/env";
import { createLogger } from "@gettargetrole/core/logger";
import { sendEmail } from "@gettargetrole/core/mailer";
import {
  caseEmail,
  caseLink,
  caseNotification,
  getDb,
  notifications,
  type CaseEmailEvent,
  type CaseNotice,
} from "@gettargetrole/db";

const log = createLogger("support-mail");

/**
 * Tells a requester about their case: an in-app notification for signed-in users, then an email
 * with their private link. The case is already saved, so a failure here is logged and never
 * undoes the action that led to it.
 */
export async function notifyRequester(
  notice: CaseNotice,
  event: CaseEmailEvent,
  body?: string,
): Promise<void> {
  if (notice.userId && event !== "created") {
    try {
      await getDb()
        .insert(notifications)
        .values(
          caseNotification({
            userId: notice.userId,
            caseId: notice.caseId,
            number: notice.number,
            subject: notice.subject,
            event,
          }),
        );
    } catch (error) {
      log.warn({ err: error, caseId: notice.caseId }, "support notification failed");
    }
  }
  if (!notice.contactEmail) return;
  try {
    await sendEmail(
      caseEmail({
        number: notice.number,
        subject: notice.subject,
        contactName: notice.contactName,
        contactEmail: notice.contactEmail,
        event,
        body,
        link: caseLink(getServerEnv().APP_URL, notice.caseId, notice.token),
      }),
    );
  } catch (error) {
    log.warn({ err: error, caseId: notice.caseId }, "support email failed");
  }
}
