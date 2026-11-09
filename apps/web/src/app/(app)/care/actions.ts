"use server";

import { getServerEnv } from "@gettargetrole/core/env";
import { ExternalServiceError, ValidationError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { sendEmail } from "@gettargetrole/core/mailer";
import {
  addNote,
  assignCase,
  createExportLink,
  deletableForCase,
  getDb,
  normalizeEmail,
  PLANS,
  reopenCase,
  replyAsAgent,
  requesterKnows,
  solveCase,
  takeCase,
  users,
} from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSupport } from "@/lib/support-errors";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { assertCanActOnAccount } from "@/server/care";
import { deleteUserAccount } from "@/server/data/account";
import { applyBan } from "@/server/data/admin";
import type { SessionUser } from "@/server/session";
import { notifyRequester } from "@/server/support-mail";

const log = createLogger("care");

const careRoles = { roles: ["support" as const, "admin" as const] };
const caseId = z.uuid();
const text = (empty: string) => z.string().trim().min(1, empty).max(5000);

function refresh(id: string) {
  revalidatePath("/care");
  revalidatePath(`/care/cases/${id}`);
}

const audit = (actorUserId: string, action: string, id: string, metadata = {}) =>
  recordAudit({ actorUserId, action, targetType: "support_case", targetId: id, metadata });

export const takeCaseAction = authedAction(
  z.object({ caseId }),
  async ({ caseId: id }, user) => {
    await withSupport(() => takeCase(getDb(), { caseId: id, agentId: user.id }));
    await audit(user.id, "care.case.take", id);
    refresh(id);
    return null;
  },
  careRoles,
);

export const handOffCase = authedAction(
  z.object({ caseId, toAgentId: z.string().min(1) }),
  async ({ caseId: id, toAgentId }, user) => {
    await withSupport(() =>
      assignCase(getDb(), {
        caseId: id,
        actorId: user.id,
        actorIsAdmin: user.role === "admin",
        toAgentId,
      }),
    );
    await audit(user.id, "care.case.assign", id, { toAgentId });
    refresh(id);
    return null;
  },
  careRoles,
);

/** A public reply: emailed to the requester, who answers in the app. */
export const replyToCase = authedAction(
  z.object({ caseId, message: text("Write the reply first") }),
  async ({ caseId: id, message }, user) => {
    const notice = await withSupport(() =>
      replyAsAgent(getDb(), { caseId: id, agentId: user.id, body: message }),
    );
    await audit(user.id, "care.case.reply", id);
    await notifyRequester(notice, "reply", message);
    refresh(id);
    return null;
  },
  { ...careRoles, rateLimit: "supportReply" },
);

/** A note only staff see: never emailed, never shown to the requester or exported. */
export const addCaseNote = authedAction(
  z.object({ caseId, message: text("Write the note first") }),
  async ({ caseId: id, message }, user) => {
    await withSupport(() => addNote(getDb(), { caseId: id, authorId: user.id, body: message }));
    await audit(user.id, "care.case.note", id);
    refresh(id);
    return null;
  },
  { ...careRoles, rateLimit: "supportReply" },
);

export const solveCaseAction = authedAction(
  z.object({ caseId }),
  async ({ caseId: id }, user) => {
    const db = getDb();
    const notice = await withSupport(() => solveCase(db, { caseId: id, agentId: user.id }));
    await audit(user.id, "care.case.solve", id);
    // A staff-raised escalation nobody wrote to the client about ends quietly.
    if (await requesterKnows(db, id)) await notifyRequester(notice, "solved");
    refresh(id);
    return null;
  },
  careRoles,
);

export const reopenCaseAction = authedAction(
  z.object({ caseId }),
  async ({ caseId: id }, user) => {
    await withSupport(() => reopenCase(getDb(), { caseId: id, agentId: user.id }));
    await audit(user.id, "care.case.reopen", id);
    refresh(id);
    return null;
  },
  careRoles,
);

/* ------------------------------------------------------------------------------------------ */
/* Account help                                                                               */
/* ------------------------------------------------------------------------------------------ */

const accountInput = {
  userId: z.string().min(1),
  reason: z.string().trim().min(1, "Say why").max(300),
  /** The request the agent came from; the action is noted on it. */
  caseId: z.uuid().optional(),
};

interface AccountInput {
  userId: string;
  reason: string;
  caseId?: string;
}

type Target = Awaited<ReturnType<typeof assertCanActOnAccount>>;

/**
 * What every account action shares: staff accounts and your own are off limits, the action runs,
 * it is audited with its reason, and the request it came from gets a note saying what was done.
 */
async function actOnAccount<T>(
  user: SessionUser,
  input: AccountInput,
  action: string,
  summary: string,
  run: (target: Target) => Promise<T>,
): Promise<T> {
  const target = await assertCanActOnAccount(user, input.userId);
  const result = await run(target);
  await recordAudit({
    actorUserId: user.id,
    action,
    targetType: "user",
    targetId: input.userId,
    metadata: { reason: input.reason, caseId: input.caseId },
  });
  if (input.caseId) {
    // The action is done; a note that can't be added (a stale link) mustn't report it as failed.
    await addNote(getDb(), {
      caseId: input.caseId,
      authorId: null,
      authorKind: "system",
      body: `${summary}: ${input.reason}`,
    }).catch((error: unknown) =>
      log.warn({ err: error, caseId: input.caseId }, "case note failed"),
    );
    revalidatePath(`/care/cases/${input.caseId}`);
  }
  revalidatePath(`/care/users/${input.userId}`);
  return result;
}

/** Sends one of our own emails; a failure is reported to the agent, who can try again. */
async function sendOrFail(message: Parameters<typeof sendEmail>[0]): Promise<void> {
  try {
    await sendEmail(message);
  } catch (error) {
    log.warn({ err: error }, "care email failed");
    throw new ExternalServiceError("Email");
  }
}

export const setPlanForUser = authedAction(
  z.object({ ...accountInput, plan: z.enum(PLANS) }),
  async (input, user) => {
    await actOnAccount(
      user,
      input,
      "care.user.plan",
      `${user.name} changed the plan to ${input.plan}`,
      () => getDb().update(users).set({ plan: input.plan }).where(eq(users.id, input.userId)),
    );
    return null;
  },
  careRoles,
);

export const setBanForUser = authedAction(
  z.object({ ...accountInput, banned: z.boolean() }),
  async (input, user) => {
    await actOnAccount(
      user,
      input,
      input.banned ? "care.user.ban" : "care.user.unban",
      `${user.name} ${input.banned ? "banned" : "unbanned"} the account`,
      () => applyBan(input.userId, input.banned, input.reason),
    );
    return null;
  },
  careRoles,
);

export const resendVerification = authedAction(
  z.object(accountInput),
  async (input, user) => {
    await actOnAccount(
      user,
      input,
      "care.user.verification",
      `${user.name} sent a new verification email`,
      async (target) => {
        if (target.emailVerified) throw new ValidationError("Their email is already verified.");
        await getAuth().api.sendVerificationEmail({
          body: { email: target.email, callbackURL: "/dashboard" },
        });
      },
    );
    return null;
  },
  careRoles,
);

export const sendPasswordReset = authedAction(
  z.object(accountInput),
  async (input, user) => {
    await actOnAccount(
      user,
      input,
      "care.user.password_reset",
      `${user.name} sent a password reset email`,
      async (target) => {
        await getAuth().api.requestPasswordReset({
          body: { email: target.email, redirectTo: "/reset-password" },
        });
      },
    );
    return null;
  },
  careRoles,
);

/** Emails the account a link that downloads its data once, for 24 hours, without signing in. */
export const sendExportLink = authedAction(
  z.object(accountInput),
  async (input, user) => {
    await actOnAccount(
      user,
      input,
      "care.user.export_link",
      `${user.name} sent a data export link`,
      async (target) => {
        const token = await createExportLink(getDb(), {
          userId: target.id,
          createdBy: user.id,
        });
        await sendOrFail({
          to: target.email,
          subject: "Your GetTargetRole data export",
          text: `Hi ${target.name},\n\nHere's a link to download your GetTargetRole data. It works once, for 24 hours:\n${getServerEnv().APP_URL}/support/export?key=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
        });
      },
    );
    return null;
  },
  careRoles,
);

/**
 * Deletes an account for a "My data" request that the account itself raised: the request must be
 * open and confirmed, and the agent types the account's email to be sure. The request stays, as
 * a record, without the account link.
 */
export const deleteUserForCase = authedAction(
  z.object({ ...accountInput, caseId: z.uuid(), confirmEmail: z.string().trim().min(1) }),
  async (input, user) => {
    await actOnAccount(
      user,
      input,
      "care.user.delete",
      "Account deleted at the user's request.",
      async (target) => {
        const allowed = await deletableForCase(getDb(), {
          userId: target.id,
          caseId: input.caseId,
        });
        if (!allowed || normalizeEmail(input.confirmEmail) !== normalizeEmail(target.email)) {
          throw new ValidationError(
            "This needs an open, confirmed 'My data' request from this account.",
          );
        }
        await deleteUserAccount(target.id);
        await sendOrFail({
          to: target.email,
          subject: "Your GetTargetRole account was deleted",
          text: `Hi ${target.name},\n\nAs you asked, we've deleted your GetTargetRole account and everything in it.\n\nThanks for using GetTargetRole.`,
        }).catch((error: unknown) => log.warn({ err: error }, "deletion email failed"));
      },
    );
    return null;
  },
  careRoles,
);
