import type { AiCallContext, AiProvider, CandidateProfile, JobContext } from "@gettargetrole/ai";
import { createLogger } from "@gettargetrole/core/logger";
import type { AutoPrepareJob } from "@gettargetrole/core/queues";
import {
  applicationEvents,
  applications,
  AUTO_PREPARE_BUDGET_SHARE,
  companies,
  findTailoredResume,
  getDb,
  jobs,
  MONTHLY_AI_BUDGET_USD,
  monthlyAiSpendMicroUsd,
  notifications,
  profiles,
  recordAiUsage,
  resumeHash,
  resumes,
  saveTailoredResume,
  users,
  type ApplicationStatus,
  type Database,
} from "@gettargetrole/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

const log = createLogger("auto-prepare");

const DAY_MS = 86_400_000;

/** Statuses auto-prepare may fill in; anything further along is the user's to handle. */
const PREPARABLE: ApplicationStatus[] = ["saved", "preparing"];

export type SkipReason =
  | "disabled"
  | "budget"
  | "no_resume"
  | "job_closed"
  | "already_handled"
  | "daily_limit";

export type AutoPrepareOutcome =
  | { status: "ready"; applicationId: string; tailored: boolean; wroteLetter: boolean }
  | { status: "skipped"; reason: SkipReason };

type ApplicationRow = typeof applications.$inferSelect;

interface Slot {
  application: ApplicationRow;
  slotEventId: string;
  created: boolean;
}

function candidateProfileOf(profile: typeof profiles.$inferSelect): CandidateProfile {
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

    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(applicationEvents)
      .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
      .where(
        and(
          eq(applications.userId, userId),
          eq(applicationEvents.type, "auto_prepared"),
          gte(applicationEvents.createdAt, new Date(input.now.getTime() - DAY_MS)),
        ),
      );
    if ((used?.count ?? 0) >= input.dailyLimit) return "daily_limit";

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
async function releaseSlot(db: Database, slot: Slot): Promise<void> {
  await db.delete(applicationEvents).where(eq(applicationEvents.id, slot.slotEventId));
  if (!slot.created) return;
  await db
    .delete(applications)
    .where(
      and(
        eq(applications.id, slot.application.id),
        eq(applications.status, "preparing"),
        eq(applications.coverLetter, ""),
      ),
    );
}

/**
 * Prepares one application for a strong new match: a tailored resume made from the main resume
 * (an existing one for the same main resume is reused, which costs nothing) and a cover letter.
 * The application ends up "ready"; the user reviews it and submits on the employer's site.
 */
export async function autoPrepare(
  input: AutoPrepareJob,
  ai: AiProvider,
  now = new Date(),
  db: Database = getDb(),
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
    dailyLimit: owner.profile.autoPrepareDailyLimit,
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
    let resume = attached ?? (await findTailoredResume(userId, jobId, sourceHash));
    const tailored = !resume;
    if (!resume) {
      const result = await ai.tailorResume({ resume: primary.content, job: jobContext }, ctx);
      resume = await saveTailoredResume({
        userId,
        jobId,
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
        { resume: resume.content, job: jobContext, profile: candidateProfileOf(owner.profile) },
        ctx,
      );
      coverLetter = letter.body;
      await db.insert(applicationEvents).values({
        applicationId,
        type: "kit_generated",
        data: { part: "cover_letter", auto: true },
      });
    }

    await db
      .update(applications)
      .set({ resumeId: resume.id, coverLetter, status: "ready" })
      .where(and(eq(applications.id, applicationId), inArray(applications.status, PREPARABLE)));
    await db
      .insert(notifications)
      .values({
        userId,
        type: "application_ready",
        title: `Ready to apply: ${job.title} at ${companyName}`,
        body: `${score}% match. Review your tailored resume and cover letter, then submit.`,
        link: `/jobs/${jobId}`,
        dedupeKey: `ready:${jobId}`,
      })
      .onConflictDoNothing();
    log.info({ userId, jobId, applicationId, tailored, wroteLetter }, "application prepared");
    return { status: "ready", applicationId, tailored, wroteLetter };
  } catch (error) {
    await releaseSlot(db, slot);
    throw error;
  }
}
