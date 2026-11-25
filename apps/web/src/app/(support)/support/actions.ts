"use server";

import { ForbiddenError, ValidationError } from "@gettargetrole/core/errors";
import {
  accountIdForEmail,
  activeSpecialistId,
  canUserSeeCase,
  createCase,
  getDb,
  linkStatus,
  replyAsRequester,
  SUPPORT_TOPICS,
  verifyCase,
} from "@gettargetrole/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSupport } from "@/lib/support-errors";
import { publicAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { notifyRequester } from "@/server/support-mail";

const CLOSED = "This request is closed. Start a new request to reach us.";

const submitSchema = z.object({
  topic: z.enum(SUPPORT_TOPICS),
  subject: z.string().trim().min(1, "Add a subject").max(120),
  message: z.string().trim().min(1, "Write your message").max(5000),
  name: z.string().trim().max(100).optional(),
  email: z.union([z.literal(""), z.email()]).optional(),
  website: z.string().optional(),
  followUpTo: z.number().int().positive().optional(),
});

/**
 * Opens a help request, signed in or out. Signed in, it belongs to the account and is verified at
 * once; signed out, it is linked to an account whose email matches but stays unverified until the
 * requester confirms it from the link we email them.
 */
export const submitSupportRequest = publicAction(
  submitSchema,
  async (input, user) => {
    // Bots fill in the hidden field. They get the normal confirmation, and nothing is saved.
    if (input.website) return { number: 0 };
    const name = user ? user.name : (input.name ?? "");
    const email = user ? user.email : (input.email ?? "");
    if (!user && !name) throw new ValidationError("Add your name so we know who to write to.");
    if (!user && !email) throw new ValidationError("Add your email so we can reply.");
    const db = getDb();
    const userId = user ? user.id : await accountIdForEmail(db, email);
    const specialistId =
      input.topic === "concierge" && userId ? await activeSpecialistId(db, userId) : null;
    const notice = await withSupport(() =>
      createCase(db, {
        kind: "help",
        source: "form",
        topic: input.topic,
        subject: input.subject,
        body: input.followUpTo
          ? `Follow-up to #${input.followUpTo}\n\n${input.message}`
          : input.message,
        userId,
        contactName: name,
        contactEmail: email,
        raisedByUserId: user?.id ?? null,
        specialistId,
        verified: Boolean(user),
        visibility: "public",
        authorKind: "user",
        authorUserId: user?.id ?? null,
      }),
    );
    await notifyRequester(notice, "created");
    await recordAudit({
      actorUserId: user?.id ?? null,
      action: "support.case.create",
      targetType: "support_case",
      targetId: notice.caseId,
      metadata: { number: notice.number, topic: input.topic, signedIn: Boolean(user) },
    });
    revalidatePath("/support/requests");
    revalidatePath("/care");
    return { number: notice.number };
  },
  { signedIn: "supportRequest", signedOut: "supportForm" },
);

/** The requester's answer, from their account or from the private link in an email. */
export const replyToRequest = publicAction(
  z.object({
    caseId: z.uuid(),
    message: z.string().trim().min(1, "Write your reply").max(5000),
    key: z.string().max(200).optional(),
  }),
  async ({ caseId, message, key }, user) => {
    const db = getDb();
    const link = key ? await linkStatus(db, key) : null;
    const viaKey = link?.caseId === caseId;
    const viaSession = user ? await canUserSeeCase(db, { caseId, userId: user.id }) : false;
    if (!viaKey && !viaSession) throw new ForbiddenError("You can't reply to this request.");
    // An old email link says why it no longer works instead of failing without a word.
    if (viaKey && !viaSession && link!.expired) throw new ValidationError(CLOSED);
    await withSupport(() =>
      replyAsRequester(db, { caseId, userId: viaSession ? user!.id : null, body: message }),
    );
    revalidatePath("/support/requests");
    revalidatePath(`/support/requests/${caseId}`);
    revalidatePath("/care");
    revalidatePath(`/care/cases/${caseId}`);
    return null;
  },
  { signedIn: "supportReply", signedOut: "supportReply" },
);

/** "Yes, I made this request": the private link proves the requester controls the mailbox. */
export const confirmRequest = publicAction(
  z.object({ caseId: z.uuid(), key: z.string().min(1).max(200) }),
  async ({ caseId, key }) => {
    const db = getDb();
    const link = await linkStatus(db, key);
    if (!link || link.caseId !== caseId || link.expired) {
      throw new ForbiddenError("This link doesn't work any more.");
    }
    await verifyCase(db, { caseId });
    revalidatePath(`/support/requests/${caseId}`);
    revalidatePath(`/care/cases/${caseId}`);
    return null;
  },
  { signedIn: "supportReply", signedOut: "supportReply" },
);
