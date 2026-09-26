"use server";

import type { JobContext } from "@gettargetrole/ai";
import { ValidationError } from "@gettargetrole/core/errors";
import {
  findTailoredResume,
  getDb,
  jobMatches,
  resumeHash,
  saveTailoredResume,
  type TailorNotes,
  type TailorTarget,
} from "@gettargetrole/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { aiFor } from "@/server/ai";
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
  return z.object({ jobId: z.uuid().optional(), applicationId: z.uuid().optional(), ...shape });
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

async function loadJobAndApplication(user: SessionUser, jobId: string) {
  const detail = await getJobDetail(user.id, jobId);
  const application = await ensureApplicationForJob(
    user.id,
    detail.job,
    detail.company.name,
    user.id,
  );
  return { detail, application, job: jobContextOf(detail.job, detail.company.name) };
}

async function loadKitTarget(
  user: SessionUser,
  input: { jobId?: string; applicationId?: string },
): Promise<KitTarget> {
  if (Boolean(input.jobId) === Boolean(input.applicationId)) {
    throw new ValidationError("Choose a job or an application.");
  }
  if (input.jobId) {
    const { application, job } = await loadJobAndApplication(user, input.jobId);
    return { application, job, jobId: input.jobId, tailorTarget: { jobId: input.jobId } };
  }
  const application = await getApplication(user.id, input.applicationId!);
  if (application.jobId) return loadKitTarget(user, { jobId: application.jobId });
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

function refresh(jobId: string | null, applicationId?: string) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/applications");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
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
      model: ai.model,
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
  async ({ instructions, force, ...ids }, user) => {
    const primary = await primaryResumeOrThrow(user.id);
    const { application, job, jobId, tailorTarget } = await loadKitTarget(user, ids);
    const sourceHash = resumeHash(primary.content);
    // A version made from this exact main resume is reused, which costs no tokens.
    const existing =
      force || instructions ? null : await findTailoredResume(user.id, tailorTarget, sourceHash);
    let resumeId = existing?.id;
    let notes: TailorNotes | null = existing?.tailorNotes ?? null;
    if (!resumeId) {
      const { ai, ctx, charge } = await aiFor(user, "tailor");
      const result = await ai.tailorResume({ resume: primary.content, job, instructions }, ctx);
      notes = {
        summaryOfChanges: result.summaryOfChanges,
        addedKeywords: result.addedKeywords,
        missingKeywords: result.missingKeywords,
        suggestions: result.suggestions,
      };
      const created = await saveTailoredResume({
        userId: user.id,
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
      await addEvent(application.id, user.id, "kit_generated", { part: "resume", resumeId });
    }
    await updateApplication(user.id, application.id, {
      resumeId,
      ...(application.status === "saved" ? { status: "preparing" as const } : {}),
    });
    refresh(jobId, application.id);
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
  async ({ recipientName, ...ids }, user) => {
    const { application, job, jobId } = await loadKitTarget(user, ids);
    const resume = await resumeForApplication(user, application);
    const { ai, ctx, charge } = await aiFor(user, "letter");
    const letter = await ai.writeCoverLetter(
      { resume: resume.content, job, profile: await candidateProfile(user.id), recipientName },
      ctx,
    );
    await updateApplication(user.id, application.id, { coverLetter: letter.body });
    await charge(application.id);
    await addEvent(application.id, user.id, "kit_generated", { part: "cover_letter" });
    refresh(jobId, application.id);
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
  async ({ questions, ...ids }, user) => {
    const { application, job, jobId } = await loadKitTarget(user, ids);
    const resume = await resumeForApplication(user, application);
    const { ai, ctx, charge } = await aiFor(user, "answers");
    const result = await ai.answerQuestions(
      { resume: resume.content, job, profile: await candidateProfile(user.id), questions },
      ctx,
    );
    const merged = new Map(application.answers.map((item) => [item.question, item.answer]));
    for (const item of result.answers) merged.set(item.question, item.answer);
    const answers = [...merged.entries()]
      .map(([question, answer]) => ({ question, answer }))
      .slice(-30);
    await updateApplication(user.id, application.id, { answers });
    await charge(application.id);
    await addEvent(application.id, user.id, "kit_generated", {
      part: "answers",
      count: result.answers.length,
    });
    refresh(jobId, application.id);
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
  async ({ recipientName, recipientTitle, recipientEmail, ...ids }, user) => {
    const { application, job, jobId } = await loadKitTarget(user, ids);
    const resume = await resumeForApplication(user, application);
    const { ai, ctx, charge } = await aiFor(user, "outreach");
    const draft = await ai.draftOutreach(
      {
        resume: resume.content,
        job,
        recipient: recipientName ? { name: recipientName, title: recipientTitle ?? "" } : null,
        profile: await candidateProfile(user.id),
      },
      ctx,
    );
    const recipient = {
      recipientName: recipientName ?? "",
      recipientTitle: recipientTitle ?? "",
      recipientEmail: recipientEmail ?? "",
    };
    const shared = { applicationId: application.id, jobId, ...recipient };
    await createOutreach(user.id, {
      ...shared,
      channel: "email",
      subject: draft.email.subject,
      body: draft.email.body,
    });
    await createOutreach(user.id, { ...shared, channel: "linkedin", body: draft.linkedinNote });
    await createOutreach(user.id, {
      ...shared,
      channel: "email",
      subject: draft.followUp.subject,
      body: draft.followUp.body,
    });
    await charge(application.id);
    await addEvent(application.id, user.id, "outreach_drafted", {});
    refresh(jobId, application.id);
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
    coverLetter: z.string().max(10_000),
    answers: z
      .array(
        z.object({ question: z.string().trim().min(1).max(500), answer: z.string().max(5000) }),
      )
      .max(30),
  }),
  async ({ applicationId, coverLetter, answers }, user) => {
    await updateApplication(user.id, applicationId, { coverLetter, answers });
    revalidatePath(`/applications/${applicationId}`);
    return null;
  },
);

export const markApplied = authedAction(
  z.object({ applicationId: z.uuid() }),
  async ({ applicationId }, user) => {
    const application = await markSubmitted(user.id, applicationId, user.id);
    if (application.jobId) revalidatePath(`/jobs/${application.jobId}`);
    revalidatePath("/applications");
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/dashboard");
    return null;
  },
);
