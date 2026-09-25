import "server-only";
import type { CandidateProfile } from "@nextrole/ai";
import { getDb, profiles, resumes, users } from "@nextrole/db";
import type { CandidateSignals } from "@nextrole/jobs/match";
import type { Resume } from "@nextrole/resume/schema";
import { findSkills } from "@nextrole/resume/skills";
import { resumeToPlainText } from "@nextrole/resume/text";
import { and, eq } from "drizzle-orm";

export type ProfileRow = typeof profiles.$inferSelect;

export async function getProfile(userId: string): Promise<ProfileRow> {
  const db = getDb();
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(profiles).values({ userId }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return existing!;
}

export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | "headline"
    | "targetTitles"
    | "targetLocations"
    | "remotePreference"
    | "seniority"
    | "yearsExperience"
    | "minSalary"
    | "salaryCurrency"
    | "workAuthorization"
    | "needsSponsorship"
    | "voiceNotes"
    | "phone"
    | "linkedinUrl"
    | "githubUrl"
    | "portfolioUrl"
    | "alertsEnabled"
    | "alertMinScore"
  >
>;

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
  await getProfile(userId);
  await getDb().update(profiles).set(update).where(eq(profiles.userId, userId));
}

/** Keeps the profile's skill list in sync with the primary resume (used for alerts and matching). */
export async function syncProfileSkills(userId: string, resume: Resume): Promise<void> {
  await getProfile(userId);
  await getDb()
    .update(profiles)
    .set({ skills: findSkills(resumeToPlainText(resume)) })
    .where(eq(profiles.userId, userId));
}

export async function markOnboarded(userId: string): Promise<void> {
  await getDb().update(users).set({ onboardedAt: new Date() }).where(eq(users.id, userId));
}

export async function candidateSignals(userId: string): Promise<CandidateSignals> {
  const profile = await getProfile(userId);
  return {
    skills: profile.skills,
    targetTitles: profile.targetTitles,
    targetLocations: profile.targetLocations,
    remotePreference: profile.remotePreference,
    seniority: profile.seniority,
    minSalary: profile.minSalary,
  };
}

export async function candidateProfile(userId: string): Promise<CandidateProfile> {
  const profile = await getProfile(userId);
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

export async function hasPrimaryResume(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)))
    .limit(1);
  return Boolean(row);
}
