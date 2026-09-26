import { createHash } from "node:crypto";
import { normalizeResume, type Resume, type ResumeSettings } from "@gettargetrole/resume/schema";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { resumeRevisions, resumes, type TailorNotes } from "./schema/app";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

/**
 * Hash of a resume's content, independent of key order (jsonb reorders keys). A tailored resume
 * stores the hash of the main resume it came from, so a changed main resume shows it as stale.
 */
export function resumeHash(content: Resume): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(content)))
    .digest("hex");
}

/** What a resume is tailored to: a job on the board, or an application with a pasted description. */
export type TailorTarget = { jobId: string } | { applicationId: string };

function targetCondition(target: TailorTarget) {
  return "jobId" in target
    ? eq(resumes.jobId, target.jobId)
    : eq(resumes.applicationId, target.applicationId);
}

/** The newest tailored resume for a target made from this exact main resume, if any. */
export async function findTailoredResume(userId: string, target: TailorTarget, sourceHash: string) {
  const [row] = await getDb()
    .select()
    .from(resumes)
    .where(
      and(
        eq(resumes.userId, userId),
        targetCondition(target),
        eq(resumes.kind, "tailored"),
        eq(resumes.sourceHash, sourceHash),
      ),
    )
    .orderBy(desc(resumes.createdAt))
    .limit(1);
  return row ?? null;
}

export async function saveTailoredResume(input: {
  userId: string;
  target: TailorTarget;
  title: string;
  content: Resume;
  settings: ResumeSettings;
  sourceHash: string;
  notes: TailorNotes;
  note: string;
}) {
  const content = normalizeResume(input.content);
  return getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(resumes)
      .values({
        userId: input.userId,
        title: input.title.slice(0, 120),
        kind: "tailored",
        jobId: "jobId" in input.target ? input.target.jobId : null,
        applicationId: "applicationId" in input.target ? input.target.applicationId : null,
        content,
        settings: input.settings,
        sourceHash: input.sourceHash,
        tailorNotes: input.notes,
      })
      .returning();
    await tx.insert(resumeRevisions).values({
      resumeId: created!.id,
      content,
      source: "ai_tailor",
      note: input.note,
    });
    return created!;
  });
}
