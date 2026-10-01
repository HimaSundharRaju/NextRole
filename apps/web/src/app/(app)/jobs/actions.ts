"use server";

import type { JobContext } from "@gettargetrole/ai";
import { ValidationError } from "@gettargetrole/core/errors";
import {
  findTailoredResume,
  getDb,
  JOB_REPORT_REASONS,
  jobMatches,
  resumeHash,
  saveTailoredResume,
  type TailorNotes,
  type TailorTarget,
} from "@gettargetrole/db";
import { reportJob as recordJobReport, withdrawJobReport } from "@gettargetrole/jobs/ghosts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { aiFor } from "@/server/ai";
import { recordAudit } from "@/server/audit";
import { assertCanActForClient, loadClientUser } from "@/server/concierge";
import {
  addEvent,
  ensureApplicationForJob,
  getApplication,
  markSubmitted,
  updateApplication,
  type ApplicationRow,
} from "@/server/data/applications";
import { getJobDetail, jobContextOf } from "@/server/data/jobs";
import { createOutreach } from "@/server/data/outreach";
import { candidateProfile } from "@/server/data/profile";
import { getPrimaryResume, getResume } from "@/server/data/resumes";
import type { SessionUser } from "@/server/session";

const jobIdSchema = z.object({ jobId: z.uuid() });

/**
 * The apply kit works on a job from the board or on an application whose job description was
 * pasted in. Exactly one of the two ids is given.
 */
function kitSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object({
    jobId: z.uuid().optional(),
    applicationId: z.uuid().optional(),
    /** A specialist working on an assigned client's kit. */
    clientId: z.string().min(1).optional(),
    ...shape,
  });
}

interface KitTarget {
  application: ApplicationRow;
  job: JobContext;
  /** The job on the board, when the kit is for one. */
  jobId: string | null;
  tailorTarget: TailorTarget;
}

async function primaryResumeOrThrow(userId: string) {
  const primary = await getPrimaryResume(userId);
  if (!primary) throw new ValidationError("Add your resume first — go to Resumes to import one.");
  return primary;
}

/** Who the kit belongs to, and who is using it: a specialist can work on an assigned client's kit. */
async function kitOwner(
  user: SessionUser,
  clientId: string | undefined,
): Promise<{ owner: SessionUser; actorId: string }> {
  if (!clientId || clientId === user.id) return { owner: user, actorId: user.id };
  await assertCanActForClient(user, clientId);
  return { owner: await loadClientUser(clientId), actorId: user.id };
}

/** The resume an application should use: its tailored version if there is one, else the main resume. */
async function resumeForApplication(user: SessionUser, application: ApplicationRow) {
  if (application.resumeId) {
    try {
      return await getResume(user.id, application.resumeId);
    } catch {
      // The tailored resume was deleted; fall back to the main one.
    }
  }
  return primaryResumeOrThrow(user.id);
}

async function loadJobAndApplication(owner: SessionUser, actorId: string, jobId: string) {
  const detail = await getJobDetail(owner.id, jobId);
  const application = await ensureApplicationForJob(
    owner.id,
    detail.job,
    detail.company.name,
    actorId,
  );
  return { detail, application, job: jobContextOf(detail.job, detail.company.name) };
}

async function loadKitTarget(
  owner: SessionUser,
  actorId: string,
  input: { jobId?: string; applicationId?: string },
): Promise<KitTarget> {
  if (Boolean(input.jobId) === Boolean(input.applicationId)) {
    throw new ValidationError("Choose a job or an application.");
  }
  if (input.jobId) {
    const { application, job } = await loadJobAndApplication(owner, actorId, input.jobId);
    return { application, job, jobId: input.jobId, tailorTarget: { jobId: input.jobId } };
  }
  const application = await getApplication(owner.id, input.applicationId!);
  if (application.jobId) return loadKitTarget(owner, actorId, { jobId: application.jobId });
  if (!application.jobDescription.trim()) {
    throw new ValidationError("Paste the job description first.");
  }
  return {
    application,
    job: {
      title: application.jobTitle,
      company: application.companyName,
      location: application.location,
      description: application.jobDescription,
    },
    jobId: null,
    tailorTarget: { applicationId: application.id },
  };
}

function refresh(jobId: string | null, applicationId?: string, clientId?: string) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/applications");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  if (clientId) {
    revalidatePath(`/specialist/${clientId}`);
    if (applicationId) revalidatePath(`/specialist/${clientId}/applications/${applicationId}`);
  }
}

export const saveJob = authedAction(jobIdSchema, async ({ jobId }, user) => {
  const detail = await getJobDetail(user.id, jobId);
  const application = await ensureApplicationForJob(
    user.id,
    detail.job,
    detail.company.name,
    user.id,
  );
  refresh(jobId, application.id);
  return { applicationId: application.id };
});

export const analyzeFit = authedAction(
  jobIdSchema,
  async ({ jobId }, user) => {
    const detail = await getJobDetail(user.id, jobId);
    const primary = await primaryResumeOrThrow(user.id);
    const { ai, ctx, charge } = await aiFor(user, "fit");
    const result = await ai.analyzeFit(
      {
        resume: primary.content,
        job: jobContextOf(detail.job, detail.company.name),
        profile: await candidateProfile(user.id),
      },
      ctx,
    );
    const values = {
      userId: user.id,
      jobId,
      resumeId: primary.id,
      sourceHash: resumeHash(primary.content),
      score: result.score,
      verdict: result.verdict,
      summary: `${result.summary} ${result.recommendation}`.trim(),
      strengths: result.strengths,
      gaps: result.gaps,
      model: ai.modelFor("match"),
    };
    await getDb()
      .insert(jobMatches)
      .values(values)
      .onConflictDoUpdate({
        target: [jobMatches.userId, jobMatches.jobId],
        set: { ...values, createdAt: new Date() },
      });
    await charge(jobId);
    refresh(jobId);
    return result;
  },
  { rateLimit: "aiHeavy" },
);

export const tailorResumeForJob = authedAction(
  kitSchema({
    instructions: z.string().trim().max(1000).optional(),
    /** Make a new version even when one from the current main resume exists. */
    force: z.boolean().optional(),
  }),
  async ({ instructions, force, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const primary = await primaryResumeOrThrow(owner.id);
    const { application, job, jobId, tailorTarget } = await loadKitTarget(owner, actorId, ids);
    const sourceHash = resumeHash(primary.content);
    // A version made from this exact main resume is reused, which costs no tokens.
    const existing =
      force || instructions ? null : await findTailoredResume(owner.id, tailorTarget, sourceHash);
    let resumeId = existing?.id;
    let notes: TailorNotes | null = existing?.tailorNotes ?? null;
    if (!resumeId) {
      const { ai, ctx, charge } = await aiFor(owner, "tailor");
      const result = await ai.tailorResume({ resume: primary.content, job, instructions }, ctx);
      notes = {
        summaryOfChanges: result.summaryOfChanges,
        addedKeywords: result.addedKeywords,
        missingKeywords: result.missingKeywords,
        suggestions: result.suggestions,
      };
      const created = await saveTailoredResume({
        userId: owner.id,
        target: tailorTarget,
        title: `${job.company} — ${job.title}`,
        content: result.resume,
        settings: primary.settings,
        sourceHash,
        notes,
        note: `Tailored for ${job.title} at ${job.company}`,
      });
      resumeId = created.id;
      await charge(resumeId);
      await addEvent(application.id, actorId, "kit_generated", { part: "resume", resumeId });
    }
    await updateApplication(owner.id, application.id, {
      resumeId,
      ...(application.status === "saved" ? { status: "preparing" as const } : {}),
    });
    refresh(jobId, application.id, clientId);
    return {
      resumeId,
      applicationId: application.id,
      reused: Boolean(existing),
      summaryOfChanges: notes?.summaryOfChanges ?? [],
      addedKeywords: notes?.addedKeywords ?? [],
      missingKeywords: notes?.missingKeywords ?? [],
      suggestions: notes?.suggestions ?? [],
    };
  },
  { rateLimit: "aiHeavy" },
);

export const writeCoverLetter = authedAction(
  kitSchema({ recipientName: z.string().trim().max(100).optional() }),
  async ({ recipientName, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const { application, job, jobId } = await loadKitTarget(owner, actorId, ids);
    const resume = await resumeForApplication(owner, application);
    const { ai, ctx, charge } = await aiFor(owner, "letter");
    const letter = await ai.writeCoverLetter(
      { resume: resume.content, job, profile: await candidateProfile(owner.id), recipientName },
      ctx,
    );
    await updateApplication(owner.id, application.id, { coverLetter: letter.body });
    await charge(application.id);
    await addEvent(application.id, actorId, "kit_generated", { part: "cover_letter" });
    refresh(jobId, application.id, clientId);
    return letter;
  },
  { rateLimit: "aiHeavy" },
);

export const answerApplicationQuestions = authedAction(
  kitSchema({
    questions: z
      .array(z.string().trim().min(3).max(500))
      .min(1, "Add at least one question")
      .max(15),
  }),
  async ({ questions, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const { application, job, jobId } = await loadKitTarget(owner, actorId, ids);
    const resume = await resumeForApplication(owner, application);
    const { ai, ctx, charge } = await aiFor(owner, "answers");
    const result = await ai.answerQuestions(
      { resume: resume.content, job, profile: await candidateProfile(owner.id), questions },
      ctx,
    );
    const merged = new Map(application.answers.map((item) => [item.question, item.answer]));
    for (const item of result.answers) merged.set(item.question, item.answer);
    const answers = [...merged.entries()]
      .map(([question, answer]) => ({ question, answer }))
      .slice(-30);
    await updateApplication(owner.id, application.id, { answers });
    await charge(application.id);
    await addEvent(application.id, actorId, "kit_generated", {
      part: "answers",
      count: result.answers.length,
    });
    refresh(jobId, application.id, clientId);
    return result.answers;
  },
  { rateLimit: "aiHeavy" },
);

export const draftOutreach = authedAction(
  kitSchema({
    recipientName: z.string().trim().max(100).optional(),
    recipientTitle: z.string().trim().max(100).optional(),
    recipientEmail: z.union([z.email(), z.literal("")]).optional(),
  }),
  async ({ recipientName, recipientTitle, recipientEmail, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const { application, job, jobId } = await loadKitTarget(owner, actorId, ids);
    const resume = await resumeForApplication(owner, application);
    const { ai, ctx, charge } = await aiFor(owner, "outreach");
    const draft = await ai.draftOutreach(
      {
        resume: resume.content,
        job,
        recipient: recipientName ? { name: recipientName, title: recipientTitle ?? "" } : null,
        profile: await candidateProfile(owner.id),
      },
      ctx,
    );
    const recipient = {
      recipientName: recipientName ?? "",
      recipientTitle: recipientTitle ?? "",
      recipientEmail: recipientEmail ?? "",
    };
    const shared = { applicationId: application.id, jobId, ...recipient };
    await createOutreach(owner.id, {
      ...shared,
      channel: "email",
      subject: draft.email.subject,
      body: draft.email.body,
    });
    await createOutreach(owner.id, { ...shared, channel: "linkedin", body: draft.linkedinNote });
    await createOutreach(owner.id, {
      ...shared,
      channel: "email",
      subject: draft.followUp.subject,
      body: draft.followUp.body,
    });
    await charge(application.id);
    await addEvent(application.id, actorId, "outreach_drafted", {});
    refresh(jobId, application.id, clientId);
    revalidatePath("/outreach");
    return draft;
  },
  { rateLimit: "aiHeavy" },
);

export const prepareInterview = authedAction(
  z.object({ applicationId: z.uuid() }),
  async ({ applicationId }, user) => {
    const application = await getApplication(user.id, applicationId);
    const resume = await resumeForApplication(user, application);
    let description = application.jobDescription;
    if (application.jobId) {
      const detail = await getJobDetail(user.id, application.jobId).catch(() => null);
      description = detail?.job.descriptionText || description;
    }
    const { ai, ctx, charge } = await aiFor(user, "interview");
    const prep = await ai.prepareInterview(
      {
        resume: resume.content,
        job: {
          title: application.jobTitle,
          company: application.companyName,
          location: application.location,
          description: description || `${application.jobTitle} at ${application.companyName}`,
        },
      },
      ctx,
    );
    await charge(application.id);
    await addEvent(application.id, user.id, "kit_generated", { part: "interview", prep });
    revalidatePath(`/applications/${application.id}`);
    return prep;
  },
  { rateLimit: "aiHeavy" },
);

export const saveKit = authedAction(
  z.object({
    applicationId: z.uuid(),
    clientId: z.string().min(1).optional(),
    coverLetter: z.string().max(10_000),
    answers: z
      .array(
        z.object({ question: z.string().trim().min(1).max(500), answer: z.string().max(5000) }),
      )
      .max(30),
  }),
  async ({ applicationId, clientId, coverLetter, answers }, user) => {
    const { owner } = await kitOwner(user, clientId);
    await updateApplication(owner.id, applicationId, { coverLetter, answers });
    refresh(null, applicationId, clientId);
    return null;
  },
);

export const markApplied = authedAction(
  z.object({ applicationId: z.uuid(), clientId: z.string().min(1).optional() }),
  async ({ applicationId, clientId }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const application = await markSubmitted(owner.id, applicationId, actorId);
    if (owner.id !== actorId) {
      await recordAudit({
        actorUserId: actorId,
        action: "specialist.application.submitted",
        targetType: "application",
        targetId: applicationId,
        metadata: { clientId: owner.id },
      });
    }
    if (application.jobId) revalidatePath(`/jobs/${application.jobId}`);
    refresh(null, applicationId, clientId);
    revalidatePath("/dashboard");
    return null;
  },
);

/** A job seeker's report that a job isn't really open; enough of them hide it for everyone. */
export const reportJob = authedAction(
  z.object({
    jobId: z.uuid(),
    reason: z.enum(JOB_REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  }),
  async ({ jobId, reason, note }, user) => {
    // Checks the job exists and can be seen.
    await getJobDetail(user.id, jobId);
    await recordJobReport({ userId: user.id, jobId, reason, note });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return null;
  },
  { rateLimit: "jobReport" },
);

export const withdrawReport = authedAction(jobIdSchema, async ({ jobId }, user) => {
  await withdrawJobReport({ userId: user.id, jobId });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return null;
});
