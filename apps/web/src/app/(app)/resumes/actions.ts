"use server";

import { emptyResume, resumeSchema, resumeSettingsSchema } from "@gettargetrole/resume/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import {
  clearMessages,
  createResume,
  deleteResume,
  getResume,
  restoreRevision,
  saveResumeContent,
  setPrimaryResume,
  updateResumeMeta,
} from "@/server/data/resumes";

const idSchema = z.object({ resumeId: z.uuid() });

export const createBlankResume = authedAction(
  z.object({ title: z.string().trim().min(1).max(120) }),
  async ({ title }, user) => {
    const resume = emptyResume();
    resume.basics.name = user.name;
    resume.basics.email = user.email;
    const row = await createResume(user.id, {
      title,
      content: resume,
      source: "manual",
      note: "Created blank resume",
    });
    revalidatePath("/resumes");
    return { id: row.id };
  },
);

export const duplicateResume = authedAction(idSchema, async ({ resumeId }, user) => {
  const source = await getResume(user.id, resumeId);
  const row = await createResume(user.id, {
    title: `${source.title} (copy)`.slice(0, 120),
    content: source.content,
    settings: source.settings,
    kind: source.kind,
    jobId: source.jobId,
    source: "manual",
    note: `Duplicated from "${source.title}"`,
  });
  revalidatePath("/resumes");
  return { id: row.id };
});

export const renameResume = authedAction(
  z.object({ resumeId: z.uuid(), title: z.string().trim().min(1).max(120) }),
  async ({ resumeId, title }, user) => {
    await updateResumeMeta(user.id, resumeId, { title });
    revalidatePath("/resumes");
    revalidatePath(`/resumes/${resumeId}`);
    return null;
  },
);

export const makePrimaryResume = authedAction(idSchema, async ({ resumeId }, user) => {
  await setPrimaryResume(user.id, resumeId);
  revalidatePath("/resumes");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return null;
});

export const removeResume = authedAction(idSchema, async ({ resumeId }, user) => {
  await deleteResume(user.id, resumeId);
  await recordAudit({
    actorUserId: user.id,
    action: "resume.delete",
    targetType: "resume",
    targetId: resumeId,
  });
  revalidatePath("/resumes");
  return null;
});

export const saveResume = authedAction(
  z.object({ resumeId: z.uuid(), content: resumeSchema }),
  async ({ resumeId, content }, user) => {
    const { resume } = await saveResumeContent(
      user.id,
      resumeId,
      content,
      "manual",
      "Edited manually",
    );
    revalidatePath(`/resumes/${resumeId}`);
    return { content: resume.content };
  },
);

export const saveResumeSettings = authedAction(
  z.object({ resumeId: z.uuid(), settings: resumeSettingsSchema }),
  async ({ resumeId, settings }, user) => {
    await updateResumeMeta(user.id, resumeId, { settings });
    return null;
  },
);

export const restoreResumeRevision = authedAction(
  z.object({ resumeId: z.uuid(), revisionId: z.uuid() }),
  async ({ resumeId, revisionId }, user) => {
    const { resume } = await restoreRevision(user.id, resumeId, revisionId);
    revalidatePath(`/resumes/${resumeId}`);
    return { content: resume.content };
  },
);

export const clearStudioChat = authedAction(idSchema, async ({ resumeId }, user) => {
  await clearMessages(user.id, resumeId);
  revalidatePath(`/resumes/${resumeId}`);
  return null;
});
