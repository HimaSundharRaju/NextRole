"use server";

import { APPLICATION_STATUSES } from "@gettargetrole/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import {
  addEvent,
  changeStatus,
  createExternalApplication,
  deleteApplication,
  updateApplication,
} from "@/server/data/applications";

const httpsUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(1000)]);

const jobDescription = z
  .string()
  .trim()
  .min(200, "Paste the full job description (at least a few paragraphs)")
  .max(20_000, "That's longer than a job description — paste up to 20,000 characters");

/** Starts an application for a job found elsewhere, from its pasted description. */
export const createFromJobDescription = authedAction(
  z.object({
    companyName: z.string().trim().min(1, "Company is required").max(120),
    jobTitle: z.string().trim().min(1, "Job title is required").max(160),
    jobUrl: httpsUrl,
    location: z.string().trim().max(120),
    jobDescription,
  }),
  async (input, user) => {
    const application = await createExternalApplication(
      user.id,
      { ...input, status: "saved", notes: "" },
      user.id,
    );
    revalidatePath("/applications");
    return { id: application.id };
  },
);

/** Adds the job description to an application tracked by hand, so the apply kit can use it. */
export const saveJobDescription = authedAction(
  z.object({ applicationId: z.uuid(), jobDescription }),
  async ({ applicationId, jobDescription }, user) => {
    await updateApplication(user.id, applicationId, { jobDescription });
    revalidatePath(`/applications/${applicationId}`);
    return null;
  },
);

export const addApplication = authedAction(
  z.object({
    companyName: z.string().trim().min(1, "Company is required").max(120),
    jobTitle: z.string().trim().min(1, "Job title is required").max(160),
    jobUrl: httpsUrl,
    location: z.string().trim().max(120),
    status: z.enum(APPLICATION_STATUSES),
    notes: z.string().max(5000),
  }),
  async (input, user) => {
    const application = await createExternalApplication(user.id, input, user.id);
    revalidatePath("/applications");
    return { id: application.id };
  },
);

export const moveApplication = authedAction(
  z.object({ applicationId: z.uuid(), status: z.enum(APPLICATION_STATUSES) }),
  async ({ applicationId, status }, user) => {
    await changeStatus(user.id, applicationId, status, user.id);
    revalidatePath("/applications");
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/dashboard");
    return null;
  },
);

export const updateApplicationDetails = authedAction(
  z.object({
    applicationId: z.uuid(),
    notes: z.string().max(20_000),
    nextActionAt: z.string().nullable(),
  }),
  async ({ applicationId, notes, nextActionAt }, user) => {
    const date = nextActionAt ? new Date(nextActionAt) : null;
    await updateApplication(user.id, applicationId, {
      notes,
      nextActionAt: date && !Number.isNaN(date.getTime()) ? date : null,
    });
    await addEvent(applicationId, user.id, "note", { updated: true });
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/dashboard");
    return null;
  },
);

export const removeApplication = authedAction(
  z.object({ applicationId: z.uuid() }),
  async ({ applicationId }, user) => {
    await deleteApplication(user.id, applicationId);
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    return null;
  },
);
