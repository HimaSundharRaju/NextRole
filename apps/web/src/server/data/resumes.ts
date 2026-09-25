import "server-only";
import { NotFoundError } from "@nextrole/core/errors";
import { getDb, resumeMessages, resumeRevisions, resumes, type RevisionSource } from "@nextrole/db";
import {
  DEFAULT_RESUME_SETTINGS,
  normalizeResume,
  type Resume,
  type ResumeSettings,
} from "@nextrole/resume/schema";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { syncProfileSkills } from "./profile";

export type ResumeRow = typeof resumes.$inferSelect;

const MAX_REVISIONS_PER_RESUME = 100;

export async function listResumes(userId: string) {
  return getDb()
    .select({
      id: resumes.id,
      title: resumes.title,
      kind: resumes.kind,
      isPrimary: resumes.isPrimary,
      jobId: resumes.jobId,
      updatedAt: resumes.updatedAt,
      settings: resumes.settings,
      headline: sql<string>`${resumes.content} -> 'basics' ->> 'headline'`,
    })
    .from(resumes)
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.isPrimary), desc(resumes.updatedAt));
}

/** Loads a resume owned by `userId`; anything else is reported as not found. */
export async function getResume(userId: string, resumeId: string): Promise<ResumeRow> {
  const [row] = await getDb()
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError("Resume");
  return row;
}

export async function getPrimaryResume(userId: string): Promise<ResumeRow | null> {
  const [row] = await getDb()
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)))
    .limit(1);
  return row ?? null;
}

async function pruneRevisions(resumeId: string): Promise<void> {
  const db = getDb();
  const stale = await db
    .select({ id: resumeRevisions.id })
    .from(resumeRevisions)
    .where(eq(resumeRevisions.resumeId, resumeId))
    .orderBy(desc(resumeRevisions.createdAt))
    .offset(MAX_REVISIONS_PER_RESUME);
  if (stale.length) {
    await db.delete(resumeRevisions).where(
      inArray(
        resumeRevisions.id,
        stale.map((row) => row.id),
      ),
    );
  }
}

export async function createResume(
  userId: string,
  input: {
    title: string;
    content: Resume;
    kind?: "master" | "tailored";
    jobId?: string | null;
    settings?: ResumeSettings;
    sourceFileName?: string | null;
    source: RevisionSource;
    note?: string;
    makePrimary?: boolean;
  },
): Promise<ResumeRow> {
  const db = getDb();
  const content = normalizeResume(input.content);
  const kind = input.kind ?? "master";
  const existingPrimary = await getPrimaryResume(userId);
  const makePrimary = kind === "master" && (input.makePrimary || !existingPrimary);

  const row = await db.transaction(async (tx) => {
    if (makePrimary && existingPrimary) {
      await tx.update(resumes).set({ isPrimary: false }).where(eq(resumes.id, existingPrimary.id));
    }
    const [created] = await tx
      .insert(resumes)
      .values({
        userId,
        title: input.title.slice(0, 120),
        kind,
        jobId: input.jobId ?? null,
        content,
        settings: input.settings ?? DEFAULT_RESUME_SETTINGS,
        isPrimary: makePrimary,
        sourceFileName: input.sourceFileName ?? null,
      })
      .returning();
    await tx.insert(resumeRevisions).values({
      resumeId: created!.id,
      content,
      source: input.source,
      note: input.note ?? "Created",
    });
    return created!;
  });

  if (row.isPrimary) await syncProfileSkills(userId, content);
  return row;
}

export async function saveResumeContent(
  userId: string,
  resumeId: string,
  content: Resume,
  source: RevisionSource,
  note: string,
): Promise<{ resume: ResumeRow; revisionId: string }> {
  const existing = await getResume(userId, resumeId);
  const normalized = normalizeResume(content);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(resumes)
      .set({ content: normalized })
      .where(and(eq(resumes.id, existing.id), eq(resumes.userId, userId)))
      .returning();
    const [revision] = await tx
      .insert(resumeRevisions)
      .values({ resumeId: existing.id, content: normalized, source, note: note.slice(0, 200) })
      .returning({ id: resumeRevisions.id });
    return { resume: updated!, revisionId: revision!.id };
  });
  await pruneRevisions(existing.id);
  if (result.resume.isPrimary) await syncProfileSkills(userId, normalized);
  return result;
}

export async function updateResumeMeta(
  userId: string,
  resumeId: string,
  update: { title?: string; settings?: ResumeSettings },
): Promise<void> {
  await getResume(userId, resumeId);
  await getDb()
    .update(resumes)
    .set({
      ...(update.title !== undefined ? { title: update.title.slice(0, 120) } : {}),
      ...(update.settings ? { settings: update.settings } : {}),
    })
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)));
}

export async function setPrimaryResume(userId: string, resumeId: string): Promise<void> {
  const resume = await getResume(userId, resumeId);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(resumes)
      .set({ isPrimary: false })
      .where(and(eq(resumes.userId, userId), eq(resumes.isPrimary, true)));
    await tx
      .update(resumes)
      .set({ isPrimary: true, kind: "master" })
      .where(eq(resumes.id, resume.id));
  });
  await syncProfileSkills(userId, resume.content);
}

export async function deleteResume(userId: string, resumeId: string): Promise<void> {
  const resume = await getResume(userId, resumeId);
  const db = getDb();
  await db.delete(resumes).where(and(eq(resumes.id, resume.id), eq(resumes.userId, userId)));
  if (resume.isPrimary) {
    const [next] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.kind, "master"), ne(resumes.id, resume.id)))
      .orderBy(desc(resumes.updatedAt))
      .limit(1);
    if (next) await setPrimaryResume(userId, next.id);
  }
}

export async function listRevisions(userId: string, resumeId: string, limit = 30) {
  await getResume(userId, resumeId);
  return getDb()
    .select({
      id: resumeRevisions.id,
      source: resumeRevisions.source,
      note: resumeRevisions.note,
      createdAt: resumeRevisions.createdAt,
    })
    .from(resumeRevisions)
    .where(eq(resumeRevisions.resumeId, resumeId))
    .orderBy(desc(resumeRevisions.createdAt))
    .limit(limit);
}

export async function restoreRevision(userId: string, resumeId: string, revisionId: string) {
  await getResume(userId, resumeId);
  const [revision] = await getDb()
    .select()
    .from(resumeRevisions)
    .where(and(eq(resumeRevisions.id, revisionId), eq(resumeRevisions.resumeId, resumeId)))
    .limit(1);
  if (!revision) throw new NotFoundError("Version");
  return saveResumeContent(
    userId,
    resumeId,
    revision.content,
    "restore",
    "Restored an earlier version",
  );
}

export async function listMessages(userId: string, resumeId: string, limit = 60) {
  await getResume(userId, resumeId);
  const rows = await getDb()
    .select({
      id: resumeMessages.id,
      role: resumeMessages.role,
      content: resumeMessages.content,
      createdAt: resumeMessages.createdAt,
    })
    .from(resumeMessages)
    .where(eq(resumeMessages.resumeId, resumeId))
    .orderBy(desc(resumeMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function appendMessages(
  resumeId: string,
  messages: Array<{ role: "user" | "assistant"; content: string; revisionId?: string | null }>,
): Promise<void> {
  const now = Date.now();
  await getDb()
    .insert(resumeMessages)
    .values(
      messages.map((message, index) => ({
        resumeId,
        role: message.role,
        content: message.content.slice(0, 20_000),
        revisionId: message.revisionId ?? null,
        // Keep insertion order stable even within the same millisecond.
        createdAt: new Date(now + index),
      })),
    );
}

export async function clearMessages(userId: string, resumeId: string): Promise<void> {
  await getResume(userId, resumeId);
  await getDb().delete(resumeMessages).where(eq(resumeMessages.resumeId, resumeId));
}

export async function oldestFirstMessages(resumeId: string) {
  return getDb()
    .select({ role: resumeMessages.role, content: resumeMessages.content })
    .from(resumeMessages)
    .where(eq(resumeMessages.resumeId, resumeId))
    .orderBy(asc(resumeMessages.createdAt))
    .limit(200);
}
