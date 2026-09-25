import { REMOTE_PREFERENCES, SENIORITY_LEVELS } from "@nextrole/db/schema";
import { z } from "zod";

const shortList = z.array(z.string().trim().min(1).max(80)).max(10);

export const preferencesSchema = z.object({
  targetTitles: shortList,
  targetLocations: shortList,
  remotePreference: z.enum(REMOTE_PREFERENCES),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  minSalary: z.number().int().min(0).max(5_000_000).nullable(),
  salaryCurrency: z.string().trim().length(3).toUpperCase(),
  workAuthorization: z.string().trim().max(200),
  needsSponsorship: z.boolean(),
  alertsEnabled: z.boolean(),
  alertMinScore: z.number().int().min(30).max(95),
  completeOnboarding: z.boolean().optional(),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => value === "" || /^https:\/\/[^\s]+$/i.test(value), "Use a full https:// link");

export const aboutSchema = z.object({
  headline: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  voiceNotes: z.string().trim().max(4000),
});
export type AboutInput = z.infer<typeof aboutSchema>;

export const uuidSchema = z.uuid();

export function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}
