import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../client";
import { clientTasks, profiles, specialistAssignments } from "../schema";
import { ConciergeError, mergeAnswer } from "./rules";

const GMAIL = /^[^\s@]+@(gmail|googlemail)\.com$/;

/** The client's dedicated job-search Gmail and their consent for the specialist to apply. */
export async function saveJobSearchSetup(
  db: Database,
  input: { clientId: string; jobSearchEmail: string; consent: boolean; now?: Date },
): Promise<void> {
  const email = input.jobSearchEmail.trim().toLowerCase();
  if (!GMAIL.test(email)) {
    throw new ConciergeError(
      "not_allowed",
      "Use the new Gmail address you made for job applications.",
    );
  }
  if (!input.consent) {
    throw new ConciergeError(
      "not_allowed",
      "Tick the consent so your specialist can apply for you.",
    );
  }
  const [current] = await db
    .select({ email: profiles.jobSearchEmail })
    .from(profiles)
    .where(eq(profiles.userId, input.clientId))
    .limit(1);
  await db
    .update(profiles)
    .set({
      jobSearchEmail: email,
      applyConsentAt: input.now ?? new Date(),
      // A different inbox needs the specialist to be given access again.
      ...(current?.email !== email ? { inboxAccessConfirmedAt: null } : {}),
    })
    .where(eq(profiles.userId, input.clientId));
}

/** The specialist confirms Gmail delegation works; the setup task is done. */
export async function confirmInboxAccess(
  db: Database,
  input: { clientId: string; specialistId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(profiles)
    .set({ inboxAccessConfirmedAt: now })
    .where(and(eq(profiles.userId, input.clientId), ne(profiles.jobSearchEmail, "")))
    .returning({ userId: profiles.userId });
  if (!row) {
    throw new ConciergeError(
      "not_allowed",
      "The client hasn't entered their job-search Gmail yet.",
    );
  }
  await db
    .update(clientTasks)
    .set({ status: "done", completedAt: now })
    .where(
      and(
        eq(clientTasks.clientId, input.clientId),
        eq(clientTasks.kind, "setup_inbox"),
        eq(clientTasks.status, "open"),
      ),
    );
}

export async function setConciergePaused(
  db: Database,
  clientId: string,
  paused: boolean,
  now = new Date(),
): Promise<void> {
  await db
    .update(profiles)
    .set({ conciergePausedAt: paused ? now : null })
    .where(eq(profiles.userId, clientId));
}

/** An admin's per-client weekly target; null returns to the plan default. */
export async function setWeeklyTarget(
  db: Database,
  clientId: string,
  target: number | null,
): Promise<void> {
  if (target !== null && (!Number.isInteger(target) || target < 1 || target > 100)) {
    throw new ConciergeError("not_allowed", "Set a weekly target between 1 and 100.");
  }
  await db
    .update(profiles)
    .set({ weeklyTargetOverride: target })
    .where(eq(profiles.userId, clientId));
}

/** Replaces the answer bank from the editor: blanks dropped, repeats merged, at most 50. */
export async function updateAnswerBank(
  db: Database,
  clientId: string,
  entries: Array<{ question: string; answer: string }>,
  now = new Date(),
): Promise<void> {
  const bank = entries
    .filter((entry) => entry.question.trim() && entry.answer.trim())
    .reduce(
      (merged, entry) => mergeAnswer(merged, entry.question, entry.answer, now),
      [] as ReturnType<typeof mergeAnswer>,
    );
  await db.update(profiles).set({ answerBank: bank }).where(eq(profiles.userId, clientId));
}

/**
 * Gives the client to one specialist: any other active assignment ends, and the new specialist
 * needs Gmail access, so a fresh setup task opens. Assigning the current specialist is a no-op.
 */
export async function assignClient(
  db: Database,
  input: { clientId: string; specialistId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const active = await tx
      .select({ specialistId: specialistAssignments.specialistId })
      .from(specialistAssignments)
      .where(
        and(
          eq(specialistAssignments.clientId, input.clientId),
          eq(specialistAssignments.active, true),
        ),
      );
    if (active.length === 1 && active[0]!.specialistId === input.specialistId) return;
    await tx
      .update(specialistAssignments)
      .set({ active: false })
      .where(
        and(
          eq(specialistAssignments.clientId, input.clientId),
          ne(specialistAssignments.specialistId, input.specialistId),
        ),
      );
    await tx
      .insert(specialistAssignments)
      .values({ specialistId: input.specialistId, clientId: input.clientId, active: true })
      .onConflictDoUpdate({
        target: [specialistAssignments.specialistId, specialistAssignments.clientId],
        set: { active: true },
      });
    await tx
      .update(profiles)
      .set({ inboxAccessConfirmedAt: null })
      .where(eq(profiles.userId, input.clientId));
    await tx
      .update(clientTasks)
      .set({ status: "cancelled", completedAt: now })
      .where(
        and(
          eq(clientTasks.clientId, input.clientId),
          eq(clientTasks.kind, "setup_inbox"),
          eq(clientTasks.status, "open"),
        ),
      );
    await tx
      .insert(clientTasks)
      .values({ clientId: input.clientId, specialistId: input.specialistId, kind: "setup_inbox" });
  });
}

/** Whether this specialist is the client's active specialist. */
export async function hasActiveAssignment(
  db: Database,
  specialistId: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ clientId: specialistAssignments.clientId })
    .from(specialistAssignments)
    .where(
      and(
        eq(specialistAssignments.specialistId, specialistId),
        eq(specialistAssignments.clientId, clientId),
        eq(specialistAssignments.active, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Records that the specialist opened the client's workspace (for "new answers" counts). */
export async function markClientViewed(
  db: Database,
  input: { specialistId: string; clientId: string; now?: Date },
): Promise<void> {
  await db
    .update(specialistAssignments)
    .set({ lastViewedAt: input.now ?? new Date() })
    .where(
      and(
        eq(specialistAssignments.specialistId, input.specialistId),
        eq(specialistAssignments.clientId, input.clientId),
      ),
    );
}
