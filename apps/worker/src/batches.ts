import type {
  AiBatches,
  AiProvider,
  BatchResult,
  BatchTask,
  CoverLetter,
  TailorResult,
  UsageRecord,
} from "@gettargetrole/ai";
import { createLogger } from "@gettargetrole/core/logger";
import {
  aiBatchRequests,
  aiUsage,
  applicationEvents,
  applications,
  findTailoredResume,
  getDb,
  resumeHash,
  resumes,
  saveTailoredResume,
  type Database,
} from "@gettargetrole/db";
import { DEFAULT_RESUME_SETTINGS } from "@gettargetrole/resume/schema";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { markReady, releaseSlot } from "./prepare";

const log = createLogger("ai-batches");

/** Entries per batch. The API takes up to 100,000; auto-prepare never queues nearly that many. */
const MAX_BATCH_ENTRIES = 500;

/** A failed entry goes into one more batch before its application is given up on. */
const MAX_ATTEMPTS = 2;

/**
 * Work still queued this long after its last change means batches can't be sent (an outage, a
 * proxy that doesn't pass the batch API through, no batch access), so it runs as live calls.
 */
const STALE_QUEUE_MS = 30 * 60_000;

/** Live calls per run of the stale-work fallback, to stay inside the API's rate limits. */
const LIVE_PER_RUN = 10;

/** The batch id of an entry claimed for a live call. */
const LIVE_BATCH_ID = "live";

type BatchRow = typeof aiBatchRequests.$inferSelect;

function taskOf(row: BatchRow): BatchTask {
  return { feature: row.feature, input: row.input } as unknown as BatchTask;
}

/**
 * Sends every queued entry in one batch. The rows stay locked until they're marked submitted,
 * so two workers never send the same entry twice.
 */
export async function submitAiBatches(
  batches: AiBatches,
  db: Database = getDb(),
): Promise<{ submitted: number; batchId: string | null }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(aiBatchRequests)
      .where(eq(aiBatchRequests.status, "queued"))
      .orderBy(asc(aiBatchRequests.createdAt))
      .limit(MAX_BATCH_ENTRIES)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return { submitted: 0, batchId: null };
    const batchId = await batches.submit(
      rows.map((row) => ({ id: row.id, userId: row.userId, task: taskOf(row) })),
    );
    await tx
      .update(aiBatchRequests)
      .set({ status: "submitted", batchId, attempts: sql`${aiBatchRequests.attempts} + 1` })
      .where(
        inArray(
          aiBatchRequests.id,
          rows.map((row) => row.id),
        ),
      );
    return { submitted: rows.length, batchId };
  });
}

/**
 * Stores one entry's result: the output, or the error. A retryable failure goes back in the
 * queue once. Usage is metered here, in the same transaction, so a result read twice (by two
 * workers, or after a crash) is counted once.
 */
async function applyResult(
  db: Database,
  row: BatchRow,
  result: BatchResult,
  usage: UsageRecord[],
): Promise<boolean> {
  const retry = result.status === "failed" && result.retryable && row.attempts < MAX_ATTEMPTS;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(aiBatchRequests)
      .set(
        result.status === "succeeded"
          ? {
              status: "succeeded",
              output: result.output as unknown as Record<string, unknown>,
              error: "",
            }
          : retry
            ? { status: "queued", batchId: null, error: result.error }
            : { status: "failed", error: result.error },
      )
      .where(
        and(
          eq(aiBatchRequests.id, row.id),
          eq(aiBatchRequests.status, "submitted"),
          eq(aiBatchRequests.batchId, row.batchId!),
        ),
      )
      .returning({ id: aiBatchRequests.id });
    if (!updated) return false;
    if (usage.length > 0) {
      await tx.insert(aiUsage).values(usage.map((record) => ({ userId: row.userId, ...record })));
    }
    if (result.status === "failed") {
      log.warn(
        { requestId: row.id, feature: row.feature, error: result.error, retry },
        "batch entry failed",
      );
    }
    return true;
  });
}

/** Reads a finished batch's results into its rows. */
async function readBatch(batches: AiBatches, db: Database, batchId: string): Promise<number> {
  const rows = await db
    .select()
    .from(aiBatchRequests)
    .where(and(eq(aiBatchRequests.batchId, batchId), eq(aiBatchRequests.status, "submitted")));
  const waiting = new Map(rows.map((row) => [row.id, row]));
  const usage = new Map<string, UsageRecord[]>();
  let applied = 0;
  const results = batches.results(batchId, (id) => {
    const row = waiting.get(id);
    if (!row) return undefined;
    const records: UsageRecord[] = [];
    usage.set(id, records);
    return {
      task: taskOf(row),
      ctx: { userId: row.userId, onUsage: (record) => void records.push(record) },
    };
  });
  for await (const { id, result } of results) {
    const row = waiting.get(id);
    if (!row) continue;
    waiting.delete(id);
    if (await applyResult(db, row, result, usage.get(id) ?? [])) applied++;
  }
  // Every entry should have a result; one without is sent again.
  for (const row of waiting.values()) {
    const missing: BatchResult = {
      status: "failed",
      error: "The batch returned no result for this request.",
      retryable: true,
    };
    if (await applyResult(db, row, missing, [])) applied++;
  }
  return applied;
}

export type FinishOutcome = "ready" | "not_ready" | "released";

/**
 * Finishes an application whose batch entries are all done, in one transaction: saves the
 * tailored resume, attaches it and the letter and marks the application ready — or, if an entry
 * failed, keeps what succeeded and gives the slot back. The rows are deleted in the same
 * transaction, so a failure part-way leaves them for the next run. Null when entries are still
 * waiting.
 */
export async function finishApplication(
  db: Database,
  applicationId: string,
): Promise<FinishOutcome | null> {
  return db.transaction(async (tx) => {
    // Locks the rows, so a second worker waits here and then finds them gone.
    const rows = await tx
      .select()
      .from(aiBatchRequests)
      .where(eq(aiBatchRequests.applicationId, applicationId))
      .for("update");
    if (rows.length === 0 || rows.some((row) => !["succeeded", "failed"].includes(row.status))) {
      return null;
    }
    const [first] = rows as [BatchRow];
    const { userId } = first;
    const [application] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1);
    await tx.delete(aiBatchRequests).where(eq(aiBatchRequests.applicationId, applicationId));
    const slot = {
      applicationId,
      slotEventId: first.slotEventId,
      created: first.createdApplication,
    };
    if (!application?.jobId) {
      // Auto-prepare only makes applications for jobs; nothing to finish.
      await releaseSlot(tx, slot);
      return "released";
    }
    const jobId = application.jobId;

    // A tailored resume is kept even if the letter failed: it was paid for, and the next
    // tailor for this job reuses it at no cost.
    const tailorRow = rows.find((row) => row.feature === "tailor");
    let newResumeId: string | null = null;
    if (tailorRow?.status === "succeeded") {
      const source = (taskOf(tailorRow) as Extract<BatchTask, { feature: "tailor" }>).input;
      const result = tailorRow.output as unknown as TailorResult;
      const sourceHash = resumeHash(source.resume);
      // One the user made meanwhile wins over the batch's.
      const mine = await findTailoredResume(userId, { jobId }, sourceHash, tx);
      if (!mine) {
        const [primary] = await tx
          .select({ settings: resumes.settings })
          .from(resumes)
          .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)))
          .limit(1);
        const saved = await saveTailoredResume(
          {
            userId,
            target: { jobId },
            title: `${application.companyName} — ${application.jobTitle}`,
            content: result.resume,
            settings: primary?.settings ?? DEFAULT_RESUME_SETTINGS,
            sourceHash,
            notes: {
              summaryOfChanges: result.summaryOfChanges,
              addedKeywords: result.addedKeywords,
              missingKeywords: result.missingKeywords,
              suggestions: result.suggestions,
            },
            note: `Tailored for ${application.jobTitle} at ${application.companyName} (auto-prepare)`,
          },
          tx,
        );
        newResumeId = saved.id;
      }
    }

    if (rows.some((row) => row.status === "failed")) {
      await releaseSlot(tx, slot);
      return "released";
    }

    const letterRow = rows.find((row) => row.feature === "cover_letter");
    const letter = letterRow ? (letterRow.output as unknown as CoverLetter).body : "";
    const resumeId = application.resumeId ?? newResumeId;
    const coverLetter = application.coverLetter || letter;
    if (!resumeId || !coverLetter) {
      // The user removed what auto-prepare had attached; leave the application to them.
      return "not_ready";
    }
    if (newResumeId) {
      await tx.insert(applicationEvents).values({
        applicationId,
        type: "kit_generated",
        data: { part: "resume", resumeId: newResumeId, auto: true, batch: true },
      });
    }
    if (letter) {
      await tx.insert(applicationEvents).values({
        applicationId,
        type: "kit_generated",
        data: { part: "cover_letter", auto: true, batch: true },
      });
    }
    const ready = await markReady(tx, {
      userId,
      applicationId,
      jobId,
      resumeId,
      coverLetter,
      title: application.jobTitle,
      companyName: application.companyName,
      score: first.score,
    });
    return ready ? "ready" : "not_ready";
  });
}

/**
 * Reads the results of every finished batch, then finishes the applications that have all their
 * results. Safe to run on several workers at once.
 */
export async function pollAiBatches(
  batches: AiBatches,
  db: Database = getDb(),
): Promise<{ read: number } & Record<FinishOutcome, number>> {
  const pending = await db
    .selectDistinct({ batchId: aiBatchRequests.batchId })
    .from(aiBatchRequests)
    .where(eq(aiBatchRequests.status, "submitted"));
  let read = 0;
  for (const { batchId } of pending) {
    if (!batchId || batchId === LIVE_BATCH_ID) continue;
    try {
      if (await batches.isDone(batchId)) read += await readBatch(batches, db, batchId);
    } catch (error) {
      // One unreadable batch shouldn't hold up the others; it's tried again next run.
      log.error({ batchId, err: error }, "could not read batch");
    }
  }

  const done = await db
    .select({ applicationId: aiBatchRequests.applicationId })
    .from(aiBatchRequests)
    .groupBy(aiBatchRequests.applicationId)
    .having(sql`bool_and(${aiBatchRequests.status} in ('succeeded', 'failed'))`);
  const outcomes: Record<FinishOutcome, number> = { ready: 0, not_ready: 0, released: 0 };
  for (const { applicationId } of done) {
    try {
      const outcome = await finishApplication(db, applicationId);
      if (outcome) outcomes[outcome]++;
    } catch (error) {
      log.error({ applicationId, err: error }, "could not finish a batched application");
    }
  }
  if (read > 0 || done.length > 0) log.info({ read, ...outcomes }, "batch results applied");
  return { read, ...outcomes };
}

/**
 * The fallback for batches that can't be sent: work queued for over half an hour runs as live
 * calls at full price, so users still get their applications. With batching turned off
 * (`staleAfterMs` 0), work left in the queue runs straight away. An entry claimed for a live
 * call that never finished (the worker stopped mid-call) goes back in the queue.
 */
export async function runStaleRequests(
  ai: AiProvider,
  db: Database = getDb(),
  { now = new Date(), staleAfterMs = STALE_QUEUE_MS }: { now?: Date; staleAfterMs?: number } = {},
): Promise<number> {
  // Always the full half hour here: a shorter wait could requeue a call still running elsewhere.
  await db
    .update(aiBatchRequests)
    .set({ status: "queued", batchId: null })
    .where(
      and(
        eq(aiBatchRequests.status, "submitted"),
        eq(aiBatchRequests.batchId, LIVE_BATCH_ID),
        lt(aiBatchRequests.updatedAt, new Date(now.getTime() - STALE_QUEUE_MS)),
      ),
    );
  const stale = await db
    .select()
    .from(aiBatchRequests)
    .where(
      and(
        eq(aiBatchRequests.status, "queued"),
        staleAfterMs > 0
          ? lt(aiBatchRequests.updatedAt, new Date(now.getTime() - staleAfterMs))
          : undefined,
      ),
    )
    .orderBy(asc(aiBatchRequests.createdAt))
    .limit(LIVE_PER_RUN);
  let ran = 0;
  for (const row of stale) {
    // Claimed first, so neither a batch nor another worker picks it up as well.
    const [claimed] = await db
      .update(aiBatchRequests)
      .set({
        status: "submitted",
        batchId: LIVE_BATCH_ID,
        attempts: sql`${aiBatchRequests.attempts} + 1`,
      })
      .where(and(eq(aiBatchRequests.id, row.id), eq(aiBatchRequests.status, "queued")))
      .returning();
    if (!claimed) continue;
    const usage: UsageRecord[] = [];
    const ctx = { userId: row.userId, onUsage: (record: UsageRecord) => void usage.push(record) };
    const task = taskOf(row);
    let result: BatchResult;
    try {
      const output =
        task.feature === "tailor"
          ? await ai.tailorResume(task.input, ctx)
          : await ai.writeCoverLetter(task.input, ctx);
      result = { status: "succeeded", output };
    } catch (error) {
      result = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
    if (await applyResult(db, claimed, result, usage)) ran++;
  }
  if (ran > 0) log.warn({ ran }, "ran stale batch work as live calls");
  return ran;
}
