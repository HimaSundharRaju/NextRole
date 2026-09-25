"use server";

import { ValidationError } from "@nextrole/core/errors";
import { getDb, jobMatches } from "@nextrole/db";
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
import { createResume, getPrimaryResume, getResume } from "@/server/data/resumes";
import type { SessionUser } from "@/server/session";

const jobIdSchema = z.object({ jobId: z.uuid() });

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

function refresh(jobId: string, applicationId?: string) {
  revalidatePath(`/jobs/${jobId}`);
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
    const { ai, ctx } = await aiFor(user);
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
    refresh(jobId);
    return result;
  },
  { rateLimit: "aiHeavy" },
);

export const tailorResumeForJob = authedAction(
  z.object({ jobId: z.uuid(), instructions: z.string().trim().max(1000).optional() }),
  async ({ jobId, instructions }, user) => {
    const primary = await primaryResumeOrThrow(user.id);
    const { detail, application, job } = await loadJobAndApplication(user, jobId);
    const { ai, ctx } = await aiFor(user);
    const result = await ai.tailorResume({ resume: primary.content, job, instructions }, ctx);
    const resume = await createResume(user.id, {
      title: `${detail.company.name} — ${detail.job.title}`,
      content: result.resume,
      kind: "tailored",
      jobId,
      settings: primary.settings,
      source: "ai_tailor",
      note: `Tailored for ${detail.job.title} at ${detail.company.name}`,
    });
    await updateApplication(user.id, application.id, {
      resumeId: resume.id,
      ...(application.status === "saved" ? { status: "preparing" as const } : {}),
    });
    await addEvent(application.id, user.id, "kit_generated", {
      part: "resume",
      resumeId: resume.id,
    });
    refresh(jobId, application.id);
    return {
      resumeId: resume.id,
      applicationId: application.id,
      summaryOfChanges: result.summaryOfChanges,
      addedKeywords: result.addedKeywords,
      missingKeywords: result.missingKeywords,
      suggestions: result.suggestions,
    };
  },
  { rateLimit: "aiHeavy" },
);

export const writeCoverLetter = authedAction(
  z.object({ jobId: z.uuid(), recipientName: z.string().trim().max(100).optional() }),
  async ({ jobId, recipientName }, user) => {
    const { application, job } = await loadJobAndApplication(user, jobId);
    const resume = await resumeForApplication(user, application);
    const { ai, ctx } = await aiFor(user);
    const letter = await ai.writeCoverLetter(
      { resume: resume.content, job, profile: await candidateProfile(user.id), recipientName },
      ctx,
    );
    await updateApplication(user.id, application.id, { coverLetter: letter.body });
    await addEvent(application.id, user.id, "kit_generated", { part: "cover_letter" });
    refresh(jobId, application.id);
    return letter;
  },
  { rateLimit: "aiHeavy" },
);

export const answerApplicationQuestions = authedAction(
  z.object({
    jobId: z.uuid(),
    questions: z
      .array(z.string().trim().min(3).max(500))
      .min(1, "Add at least one question")
      .max(15),
  }),
  async ({ jobId, questions }, user) => {
    const { application, job } = await loadJobAndApplication(user, jobId);
    const resume = await resumeForApplication(user, application);
    const { ai, ctx } = await aiFor(user);
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
  z.object({
    jobId: z.uuid(),
    recipientName: z.string().trim().max(100).optional(),
    recipientTitle: z.string().trim().max(100).optional(),
    recipientEmail: z.union([z.email(), z.literal("")]).optional(),
  }),
  async ({ jobId, recipientName, recipientTitle, recipientEmail }, user) => {
    const { application, job } = await loadJobAndApplication(user, jobId);
    const resume = await resumeForApplication(user, application);
    const { ai, ctx } = await aiFor(user);
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
    let description = "";
    if (application.jobId) {
      const detail = await getJobDetail(user.id, application.jobId).catch(() => null);
      description = detail?.job.descriptionText ?? "";
    }
    const { ai, ctx } = await aiFor(user);
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
