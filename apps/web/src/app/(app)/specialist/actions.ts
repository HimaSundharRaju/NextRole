"use server";

import { createLogger } from "@gettargetrole/core/logger";
import { sendEmail } from "@gettargetrole/core/mailer";
import {
  addStaffNote,
  APPLICATION_STATUSES,
  askClient,
  confirmInboxAccess,
  getDb,
  notifications,
  proposeExternal,
  proposeJobs,
  updateAnswerBank,
  users,
} from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withConcierge } from "@/lib/concierge-errors";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { assertCanActForClient } from "@/server/concierge";
import { changeStatus, createExternalApplication } from "@/server/data/applications";
import type { SessionUser } from "@/server/session";

const log = createLogger("specialist");
const specialistRoles = { roles: ["specialist" as const, "admin" as const] };

/** Specialists may only act for clients actively assigned to them; admins for anyone. */
async function assertAssigned(user: SessionUser, clientId: string): Promise<void> {
  await assertCanActForClient(user, clientId);
}

function refreshClient(clientId: string) {
  revalidatePath("/specialist");
  revalidatePath(`/specialist/${clientId}`);
}

async function clientEmail(clientId: string): Promise<{ email: string; name: string } | null> {
  const [row] = await getDb()
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, clientId))
    .limit(1);
  return row ?? null;
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

export const addClientApplication = authedAction(
  z.object({
    clientId: z.string().min(1),
    companyName: z.string().trim().min(1).max(120),
    jobTitle: z.string().trim().min(1).max(160),
    jobUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
    location: z.string().trim().max(120),
  }),
  async ({ clientId, ...input }, user) => {
    await assertAssigned(user, clientId);
    const application = await createExternalApplication(
      clientId,
      { ...input, status: "applied", notes: "" },
      user.id,
    );
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.application.add",
      targetType: "application",
      targetId: application.id,
      metadata: { clientId },
    });
    revalidatePath(`/specialist/${clientId}`);
    return null;
  },
  specialistRoles,
);

export const moveClientApplication = authedAction(
  z.object({
    clientId: z.string().min(1),
    applicationId: z.uuid(),
    status: z.enum(APPLICATION_STATUSES),
  }),
  async ({ clientId, applicationId, status }, user) => {
    await assertAssigned(user, clientId);
    await changeStatus(clientId, applicationId, status, user.id);
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.application.status",
      targetType: "application",
      targetId: applicationId,
      metadata: { clientId, status },
    });
    revalidatePath(`/specialist/${clientId}`);
    return null;
  },
  specialistRoles,
);

export const proposeJobsToClient = authedAction(
  z.object({
    clientId: z.string().min(1),
    jobIds: z.array(z.uuid()).min(1, "Pick at least one job").max(50),
    note: z.string().trim().max(200).optional(),
  }),
  async ({ clientId, jobIds, note }, user) => {
    await assertAssigned(user, clientId);
    const result = await withConcierge(() =>
      proposeJobs(getDb(), { clientId, specialistId: user.id, jobIds, note }),
    );
    if (result.created.length > 0) {
      await getDb()
        .insert(notifications)
        .values({
          userId: clientId,
          type: "concierge",
          title: "New jobs from your specialist",
          body: `${result.created.length} job${result.created.length === 1 ? "" : "s"} to approve or skip.`,
          link: "/applications",
          dedupeKey: `proposals:${new Date().toISOString().slice(0, 10)}`,
        })
        .onConflictDoNothing();
    }
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.proposal.create",
      targetType: "user",
      targetId: clientId,
      metadata: { created: result.created.length, existing: result.existing.length },
    });
    refreshClient(clientId);
    return {
      created: result.created.length,
      existing: result.existing.length,
      unavailable: result.unavailable.length,
    };
  },
  specialistRoles,
);

export const addExternalProposal = authedAction(
  z.object({
    clientId: z.string().min(1),
    companyName: z.string().trim().min(1).max(120),
    jobTitle: z.string().trim().min(1).max(160),
    jobUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
    location: z.string().trim().max(120),
    jobDescription: z.string().trim().min(50, "Paste the job description").max(20_000),
    note: z.string().trim().max(200).optional(),
  }),
  async ({ clientId, ...input }, user) => {
    await assertAssigned(user, clientId);
    const id = await withConcierge(() =>
      proposeExternal(getDb(), { clientId, specialistId: user.id, ...input }),
    );
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.proposal.create",
      targetType: "application",
      targetId: id,
      metadata: { clientId, external: true },
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);

export const askClientQuestion = authedAction(
  z.object({
    clientId: z.string().min(1),
    applicationId: z.uuid(),
    question: z.string().trim().min(3).max(500),
  }),
  async ({ clientId, applicationId, question }, user) => {
    await assertAssigned(user, clientId);
    await withConcierge(() =>
      askClient(getDb(), { clientId, specialistId: user.id, applicationId, question }),
    );
    await getDb().insert(notifications).values({
      userId: clientId,
      type: "concierge",
      title: "Your specialist has a question",
      body: question,
      link: "/applications",
    });
    const client = await clientEmail(clientId);
    if (client) {
      // The in-app notification is already written; a failed email mustn't undo the question.
      await sendEmail({
        to: client.email,
        subject: "Your specialist has a question",
        text: `Hi ${client.name},\n\nYour specialist needs an answer before they can submit an application for you:\n\n"${question}"\n\nAnswer it here: ${appUrl()}/applications\n`,
      }).catch((error: unknown) => log.warn({ err: error, clientId }, "question email failed"));
    }
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.question.ask",
      targetType: "application",
      targetId: applicationId,
      metadata: { clientId },
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);

export const addStaffNoteToApplication = authedAction(
  z.object({
    clientId: z.string().min(1),
    applicationId: z.uuid(),
    note: z.string().trim().min(1).max(2000),
  }),
  async ({ clientId, applicationId, note }, user) => {
    await assertAssigned(user, clientId);
    await withConcierge(() =>
      addStaffNote(getDb(), { clientId, applicationId, specialistId: user.id, note }),
    );
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.note.add",
      targetType: "application",
      targetId: applicationId,
      metadata: { clientId },
    });
    revalidatePath(`/specialist/${clientId}/applications/${applicationId}`);
    return null;
  },
  specialistRoles,
);

export const confirmClientInbox = authedAction(
  z.object({ clientId: z.string().min(1) }),
  async ({ clientId }, user) => {
    await assertAssigned(user, clientId);
    await withConcierge(() => confirmInboxAccess(getDb(), { clientId, specialistId: user.id }));
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.inbox.confirm",
      targetType: "user",
      targetId: clientId,
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);

export const saveClientAnswerBank = authedAction(
  z.object({
    clientId: z.string().min(1),
    answers: z
      .array(z.object({ question: z.string().max(500), answer: z.string().max(2000) }))
      .max(50),
  }),
  async ({ clientId, answers }, user) => {
    await assertAssigned(user, clientId);
    await updateAnswerBank(getDb(), clientId, answers);
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.answers.update",
      targetType: "user",
      targetId: clientId,
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);
