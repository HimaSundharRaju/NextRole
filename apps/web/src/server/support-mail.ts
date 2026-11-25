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
  users,
  type CaseEmailEvent,
  type CaseNotice,
} from "@gettargetrole/db";
import { inArray } from "drizzle-orm";
import { companyRequestMessages } from "@/lib/company-request-mail";

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

/**
 * Tells each person who asked for a company what became of it, in the app and by email. The
 * answer is already saved, so a failure here is logged and goes no further.
 */
export async function notifyCompanyRequesters(
  result: { outcome: "added" } | { outcome: "declined"; reason: string },
  requesters: Array<{ userId: string; name: string }>,
): Promise<void> {
  if (requesters.length === 0) return;
  const db = getDb();
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      inArray(
        users.id,
        requesters.map((requester) => requester.userId),
      ),
    );
  const byId = new Map(people.map((person) => [person.id, person]));
  for (const requester of requesters) {
    const person = byId.get(requester.userId);
    if (!person) continue;
    const message = companyRequestMessages({
      ...result,
      companyName: requester.name,
      userName: person.name,
      appUrl: getServerEnv().APP_URL,
    });
    try {
      await db
        .insert(notifications)
        .values({ userId: person.id, type: "system", ...message.notification });
    } catch (error) {
      log.warn({ err: error, userId: person.id }, "company request notification failed");
    }
    try {
      await sendEmail({ to: person.email, ...message.email });
    } catch (error) {
      log.warn({ err: error, userId: person.id }, "company request email failed");
    }
  }
}
