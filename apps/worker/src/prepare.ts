import type {
  AiBatches,
  AiCallContext,
  AiProvider,
  BatchTask,
  CandidateProfile,
  JobContext,
} from "@gettargetrole/ai";
import { createLogger } from "@gettargetrole/core/logger";
import type { AutoPrepareJob } from "@gettargetrole/core/queues";
import {
  aiBatchRequests,
  applicationEvents,
  applications,
  AUTO_PREPARE_BUDGET_SHARE,
  AUTO_PREPARE_DAILY_MAX,
  companies,
  findTailoredResume,
  getDb,
  jobs,
  MONTHLY_AI_BUDGET_USD,
  monthlyAiSpendMicroUsd,
  notifications,
  PLAN_LIMITS,
  profiles,
  recordAiUsage,
  recordUsageEvent,
  resumeHash,
  resumes,
  saveTailoredResume,
  startOfMonth,
  users,
  type ApplicationStatus,
  type Database,
  type DbExecutor,
} from "@gettargetrole/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

const log = createLogger("auto-prepare");

const DAY_MS = 86_400_000;

/** Statuses auto-prepare may fill in; anything further along is the user's to handle. */
const PREPARABLE: ApplicationStatus[] = ["saved", "preparing"];

export type SkipReason =
  | "disabled"
  | "plan"
  | "monthly_limit"
  | "budget"
  | "no_resume"
  | "job_closed"
  | "already_handled"
  | "daily_limit";

export type AutoPrepareOutcome =
  | { status: "ready"; applicationId: string; tailored: boolean; wroteLetter: boolean }
  | { status: "queued"; applicationId: string; tailor: boolean; letter: boolean }
  | { status: "skipped"; reason: SkipReason };

type ApplicationRow = typeof applications.$inferSelect;

interface Slot {
  application: ApplicationRow;
  slotEventId: string;
  created: boolean;
}

export interface AutoPrepareOptions {
  now?: Date;
  db?: Database;
  /**
   * Batch processing: the AI work is queued and finished by the batch schedulers at half price.
   * Without it, the AI is called right away.
   */
  batches?: AiBatches | null;
}

export function candidateProfileOf(profile: typeof profiles.$inferSelect): CandidateProfile {
  return {
    targetTitles: profile.targetTitles,
    workAuthorization: profile.workAuthorization,
    needsSponsorship: profile.needsSponsorship,
    minSalary: profile.minSalary,
    salaryCurrency: profile.salaryCurrency,
    voiceNotes: profile.voiceNotes,
    phone: profile.phone,
    linkedinUrl: profile.linkedinUrl,
  };
}

/**
 * Takes one of the user's daily auto-prepare slots and returns the application to fill in. A
 * per-user advisory lock keeps parallel jobs from both taking the last slot, and the application
 * is only created once a slot is free. The slot is the `auto_prepared` event itself.
 */
async function takeSlot(
  db: Database,
  input: {
    userId: string;
    dailyLimit: number;
    monthlyLimit: number;
    job: { id: string; title: string; location: string; applyUrl: string };
    companyName: string;
    score: number;
    now: Date;
  },
): Promise<Slot | SkipReason> {
  const { userId, job } = input;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`auto-prepare:${userId}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, job.id)))
      .limit(1);
    if (
      existing &&
      (!PREPARABLE.includes(existing.status) || (existing.resumeId && existing.coverLetter))
    ) {
      return "already_handled";
    }
    if (existing) {
      // A slot already taken for it means it's being prepared, possibly in a batch.
      const [held] = await tx
        .select({ id: applicationEvents.id })
        .from(applicationEvents)
        .where(
          and(
            eq(applicationEvents.applicationId, existing.id),
            eq(applicationEvents.type, "auto_prepared"),
          ),
        )
        .limit(1);
      if (held) return "already_handled";
    }

    const slotsSince = async (since: Date) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(applicationEvents)
        .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
        .where(
          and(
            eq(applications.userId, userId),
            eq(applicationEvents.type, "auto_prepared"),
            gte(applicationEvents.createdAt, since),
          ),
        );
      return row?.count ?? 0;
    };
    if ((await slotsSince(startOfMonth(input.now))) >= input.monthlyLimit) return "monthly_limit";
    if ((await slotsSince(new Date(input.now.getTime() - DAY_MS))) >= input.dailyLimit) {
      return "daily_limit";
    }

    let application = existing;
    if (!application) {
      [application] = await tx
        .insert(applications)
        .values({
          userId,
          jobId: job.id,
          companyName: input.companyName,
          jobTitle: job.title,
          jobUrl: job.applyUrl,
          location: job.location,
          status: "preparing",
        })
        .onConflictDoNothing()
        .returning();
      // The user saved it a moment ago; leave it to them.
      if (!application) return "already_handled";
      await tx.insert(applicationEvents).values({
        applicationId: application.id,
        type: "created",
        data: { source: "auto_prepare" },
      });
    }
    const [slot] = await tx
      .insert(applicationEvents)
      .values({
        applicationId: application.id,
        type: "auto_prepared",
        data: { score: input.score },
      })
      .returning({ id: applicationEvents.id });
    return { application, slotEventId: slot!.id, created: !existing };
  });
}

/** Gives the slot back after a failure, and removes an application nobody has touched yet. */
export async function releaseSlot(
  db: DbExecutor,
  slot: { applicationId: string; slotEventId: string; created: boolean },
): Promise<void> {
  await db.delete(applicationEvents).where(eq(applicationEvents.id, slot.slotEventId));
  if (!slot.created) return;
  await db
    .delete(applications)
    .where(
      and(
        eq(applications.id, slot.applicationId),
        eq(applications.status, "preparing"),
        eq(applications.coverLetter, ""),
      ),
    );
}

/**
 * Attaches the tailored resume and cover letter and marks the application ready, unless the
 * user has moved it along meanwhile. Either way the work counts against the plan; the user is
 * notified only when the application is ready.
 */
export async function markReady(
  db: DbExecutor,
  input: {
    userId: string;
    applicationId: string;
    jobId: string;
    resumeId: string;
    coverLetter: string;
    title: string;
    companyName: string;
    score: number;
  },
): Promise<boolean> {
  const [updated] = await db
    .update(applications)
    .set({ resumeId: input.resumeId, coverLetter: input.coverLetter, status: "ready" })
    .where(and(eq(applications.id, input.applicationId), inArray(applications.status, PREPARABLE)))
    .returning({ id: applications.id });
  await recordUsageEvent(input.userId, "auto", input.applicationId, db);
  if (!updated) return false;
  await db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: "application_ready",
      title: `Ready to apply: ${input.title} at ${input.companyName}`,
      body: `${input.score}% match. Review your tailored resume and cover letter, then submit.`,
      link: `/jobs/${input.jobId}`,
      dedupeKey: `ready:${input.jobId}`,
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Queues the application's AI work for the batch schedulers. A tailored resume that already
 * exists is attached now; the rest arrives with the batch.
 */
async function queueBatch(
  db: Database,
  input: {
    userId: string;
    slot: Slot;
    score: number;
    existingResumeId: string | null;
    tasks: BatchTask[];
  },
): Promise<void> {
  const { slot } = input;
  await db.transaction(async (tx) => {
    if (input.existingResumeId && !slot.application.resumeId) {
      await tx
        .update(applications)
        .set({ resumeId: input.existingResumeId })
        .where(eq(applications.id, slot.application.id));
    }
    await tx.insert(aiBatchRequests).values(
      input.tasks.map((task) => ({
        userId: input.userId,
        applicationId: slot.application.id,
        feature: task.feature,
        input: task.input as unknown as Record<string, unknown>,
        slotEventId: slot.slotEventId,
        createdApplication: slot.created,
        score: input.score,
      })),
    );
  });
}

/**
 * Prepares one application for a strong new match: a tailored resume made from the main resume
 * (an existing one for the same main resume is reused, which costs nothing) and a cover letter.
 * The application ends up "ready"; the user reviews it and submits on the employer's site. With
 * `batches`, the AI work is queued for a batch and the application becomes ready when it's done.
 */
export async function autoPrepare(
  input: AutoPrepareJob,
  ai: AiProvider,
  { now = new Date(), db = getDb(), batches = null }: AutoPrepareOptions = {},
): Promise<AutoPrepareOutcome> {
  const { userId, jobId, score } = input;
  const skip = (reason: SkipReason): AutoPrepareOutcome => {
    log.info({ userId, jobId, reason }, "auto-prepare skipped");
    return { status: "skipped", reason };
  };

  const [owner] = await db
    .select({ plan: users.plan, profile: profiles })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!owner?.profile.autoPrepareEnabled) return skip("disabled");
  // Plans without auto-prepare keep the setting but don't run it.
  const planDailyMax = AUTO_PREPARE_DAILY_MAX[owner.plan];
  if (planDailyMax === 0) return skip("plan");

  const budget = MONTHLY_AI_BUDGET_USD[owner.plan] * 1_000_000 * AUTO_PREPARE_BUDGET_SHARE;
  if ((await monthlyAiSpendMicroUsd(userId)) >= budget) return skip("budget");

  const [primary] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)))
    .limit(1);
  if (!primary) return skip("no_resume");

  const [posting] = await db
    .select({ job: jobs, companyName: companies.name })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!posting || posting.job.closedAt) return skip("job_closed");
  const { job, companyName } = posting;

  const slot = await takeSlot(db, {
    userId,
    dailyLimit: Math.min(owner.profile.autoPrepareDailyLimit, planDailyMax),
    monthlyLimit: PLAN_LIMITS[owner.plan].auto,
    job,
    companyName,
    score,
    now,
  });
  if (typeof slot === "string") return skip(slot);

  const ctx: AiCallContext = { userId, onUsage: (record) => recordAiUsage(userId, record) };
  const jobContext: JobContext = {
    title: job.title,
    company: companyName,
    location: job.location,
    description: job.descriptionText,
  };
  const applicationId = slot.application.id;
  try {
    // A resume the user already attached to this application is kept as it is.
    const [attached] = slot.application.resumeId
      ? await db
          .select()
          .from(resumes)
          .where(and(eq(resumes.id, slot.application.resumeId), eq(resumes.userId, userId)))
          .limit(1)
      : [];
    const sourceHash = resumeHash(primary.content);
    const existing = attached ?? (await findTailoredResume(userId, { jobId }, sourceHash));
    const profile = candidateProfileOf(owner.profile);

    const tasks: BatchTask[] = [];
    if (!existing) {
      tasks.push({ feature: "tailor", input: { resume: primary.content, job: jobContext } });
    }
    if (!slot.application.coverLetter) {
      // In a batch the letter can't wait for the tailored resume, so it's written from the main
      // resume: the same facts, and both run in one batch.
      tasks.push({
        feature: "cover_letter",
        input: { resume: (existing ?? primary).content, job: jobContext, profile },
      });
    }
    if (batches && tasks.length > 0 && tasks.every((task) => batches.supports(task.feature))) {
      await queueBatch(db, {
        userId,
        slot,
        score,
        existingResumeId: existing?.id ?? null,
        tasks,
      });
      const tailor = !existing;
      const letter = !slot.application.coverLetter;
      log.info({ userId, jobId, applicationId, tailor, letter }, "application queued for a batch");
      return { status: "queued", applicationId, tailor, letter };
    }

    let resume = existing;
    const tailored = !resume;
    if (!resume) {
      const result = await ai.tailorResume({ resume: primary.content, job: jobContext }, ctx);
      resume = await saveTailoredResume({
        userId,
        target: { jobId },
        title: `${companyName} — ${job.title}`,
        content: result.resume,
        settings: primary.settings,
        sourceHash,
        notes: {
          summaryOfChanges: result.summaryOfChanges,
          addedKeywords: result.addedKeywords,
          missingKeywords: result.missingKeywords,
          suggestions: result.suggestions,
        },
        note: `Tailored for ${job.title} at ${companyName} (auto-prepare)`,
      });
      await db.insert(applicationEvents).values({
        applicationId,
        type: "kit_generated",
        data: { part: "resume", resumeId: resume.id, auto: true },
      });
    }

    let coverLetter = slot.application.coverLetter;
    const wroteLetter = !coverLetter;
    if (!coverLetter) {
      const letter = await ai.writeCoverLetter(
        { resume: resume.content, job: jobContext, profile },
        ctx,
      );
      coverLetter = letter.body;
      await db.insert(applicationEvents).values({
        applicationId,
        type: "kit_generated",
        data: { part: "cover_letter", auto: true },
      });
    }

    await markReady(db, {
      userId,
      applicationId,
      jobId,
      resumeId: resume.id,
      coverLetter,
      title: job.title,
      companyName,
      score,
    });
    log.info({ userId, jobId, applicationId, tailored, wroteLetter }, "application prepared");
    return { status: "ready", applicationId, tailored, wroteLetter };
  } catch (error) {
    await releaseSlot(db, {
      applicationId,
      slotEventId: slot.slotEventId,
      created: slot.created,
    });
    throw error;
  }
}
