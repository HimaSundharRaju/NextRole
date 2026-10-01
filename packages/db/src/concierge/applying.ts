import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  applicationEvents,
  applications,
  clientTasks,
  profiles,
  resumes,
  type SubmissionReceipt,
} from "../schema";
import {
  canTransition,
  CHANGED_MESSAGE,
  CONCIERGE_STEPS,
  ConciergeError,
  mergeAnswer,
} from "./rules";

export type ApplicationRow = typeof applications.$inferSelect;

/** The specialist needs something only the client knows before submitting. */
export async function askClient(
  db: Database,
  input: {
    clientId: string;
    specialistId: string;
    applicationId: string;
    question: string;
    now?: Date;
  },
): Promise<{ taskId: string }> {
  const question = input.question.trim().slice(0, 500);
  if (question.length < 3) {
    throw new ConciergeError("not_allowed", "Write the question for the client.");
  }
  return db.transaction(async (tx) => {
    const [moved] = await tx
      .update(applications)
      .set({ status: "waiting_on_client" })
      .where(
        and(
          eq(applications.id, input.applicationId),
          eq(applications.userId, input.clientId),
          eq(applications.status, "approved"),
        ),
      )
      .returning({ id: applications.id });
    if (!moved) throw new ConciergeError("conflict", CHANGED_MESSAGE);
    const [task] = await tx
      .insert(clientTasks)
      .values({
        clientId: input.clientId,
        specialistId: input.specialistId,
        applicationId: input.applicationId,
        kind: "answer_question",
        question,
      })
      .returning({ id: clientTasks.id });
    await tx.insert(applicationEvents).values({
      applicationId: input.applicationId,
      actorUserId: input.specialistId,
      type: "question_asked",
      data: { question },
    });
    return { taskId: task!.id };
  });
}

/** The client answers; the application goes back to the specialist to submit. */
export async function answerTask(
  db: Database,
  input: { clientId: string; taskId: string; answer: string; saveToBank: boolean; now?: Date },
): Promise<void> {
  const answer = input.answer.trim().slice(0, 2000);
  if (!answer) throw new ConciergeError("not_allowed", "Write your answer first.");
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [task] = await tx
      .update(clientTasks)
      .set({ answer, saveToBank: input.saveToBank, status: "done", completedAt: now })
      .where(
        and(
          eq(clientTasks.id, input.taskId),
          eq(clientTasks.clientId, input.clientId),
          eq(clientTasks.kind, "answer_question"),
          eq(clientTasks.status, "open"),
        ),
      )
      .returning({ applicationId: clientTasks.applicationId, question: clientTasks.question });
    if (!task) throw new ConciergeError("conflict", CHANGED_MESSAGE);
    if (task.applicationId) {
      const [moved] = await tx
        .update(applications)
        .set({ status: "approved" })
        .where(
          and(
            eq(applications.id, task.applicationId),
            eq(applications.status, "waiting_on_client"),
          ),
        )
        .returning({ id: applications.id });
      if (moved) {
        await tx.insert(applicationEvents).values({
          applicationId: moved.id,
          actorUserId: input.clientId,
          type: "question_answered",
          data: { question: task.question, answer },
        });
      }
    }
    if (input.saveToBank) {
      const [profile] = await tx
        .select({ bank: profiles.answerBank })
        .from(profiles)
        .where(eq(profiles.userId, input.clientId));
      await tx
        .update(profiles)
        .set({ answerBank: mergeAnswer(profile?.bank ?? [], task.question, answer, now) })
        .where(eq(profiles.userId, input.clientId));
    }
  });
}

/**
 * Marks an application submitted on the employer's site and keeps a receipt of exactly what was
 * sent. Staff need the client's consent first; the update only lands if nobody moved the
 * application meanwhile.
 */
export async function submitApplication(
  db: Database,
  input: {
    ownerId: string;
    applicationId: string;
    actorId: string;
    actor: "staff" | "client";
    now?: Date;
  },
): Promise<ApplicationRow> {
  const now = input.now ?? new Date();
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.ownerId)))
    .limit(1);
  if (!application) throw new ConciergeError("not_found", "Application not found.");
  if (application.status === "applied") return application;
  if (
    CONCIERGE_STEPS.includes(application.status) &&
    !canTransition(application.status, "applied", input.actor)
  ) {
    throw new ConciergeError(
      "not_allowed",
      "This application can't be submitted from its current step.",
    );
  }
  if (input.actor === "staff") {
    const [profile] = await db
      .select({ consent: profiles.applyConsentAt })
      .from(profiles)
      .where(eq(profiles.userId, input.ownerId))
      .limit(1);
    if (!profile?.consent) {
      throw new ConciergeError(
        "consent_required",
        "The client hasn't given consent to apply on their behalf yet.",
      );
    }
  }
  let resume: SubmissionReceipt["resume"] = null;
  let resumeTitle = "";
  if (application.resumeId) {
    const [row] = await db
      .select({ content: resumes.content, title: resumes.title })
      .from(resumes)
      .where(and(eq(resumes.id, application.resumeId), eq(resumes.userId, input.ownerId)))
      .limit(1);
    resume = row?.content ?? null;
    resumeTitle = row?.title ?? "";
  }
  const receipt: SubmissionReceipt = {
    submittedAt: now.toISOString(),
    resumeId: application.resumeId,
    resumeTitle,
    resume,
    coverLetter: application.coverLetter,
    answers: application.answers,
  };
  const [row] = await db
    .update(applications)
    .set({
      status: "applied",
      receipt,
      submittedByUserId: input.actorId,
      appliedAt: application.appliedAt ?? now,
      // Default follow-up one week after applying.
      nextActionAt: application.nextActionAt ?? new Date(now.getTime() + 7 * 86_400_000),
    })
    .where(and(eq(applications.id, application.id), eq(applications.status, application.status)))
    .returning();
  if (!row) throw new ConciergeError("conflict", CHANGED_MESSAGE);
  await db.insert(applicationEvents).values([
    { applicationId: row.id, actorUserId: input.actorId, type: "submitted", data: { resumeTitle } },
    {
      applicationId: row.id,
      actorUserId: input.actorId,
      type: "status_changed",
      data: { from: application.status, to: "applied" },
    },
  ]);
  return row;
}

/** An internal note on the application's timeline; the client never sees it. */
export async function addStaffNote(
  db: Database,
  input: { clientId: string; applicationId: string; specialistId: string; note: string },
): Promise<void> {
  const note = input.note.trim().slice(0, 2000);
  if (!note) throw new ConciergeError("not_allowed", "Write the note first.");
  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.clientId)))
    .limit(1);
  if (!application) throw new ConciergeError("not_found", "Application not found.");
  await db.insert(applicationEvents).values({
    applicationId: application.id,
    actorUserId: input.specialistId,
    type: "staff_note",
    data: { note },
  });
}
