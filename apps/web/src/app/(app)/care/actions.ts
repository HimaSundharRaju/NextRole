"use server";

import {
  assignCase,
  getDb,
  reopenCase,
  replyAsAgent,
  requesterKnows,
  solveCase,
  takeCase,
  addNote,
} from "@gettargetrole/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSupport } from "@/lib/support-errors";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { notifyRequester } from "@/server/support-mail";

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
