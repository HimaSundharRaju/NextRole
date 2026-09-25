import "server-only";
import { ConflictError, NotFoundError } from "@gettargetrole/core/errors";
import {
  applicationEvents,
  applications,
  getDb,
  jobs,
  outreachMessages,
  resumes,
  type ApplicationStatus,
  type SubmissionReceipt,
} from "@gettargetrole/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

export type ApplicationRow = typeof applications.$inferSelect;

export async function listApplications(userId: string) {
  return getDb()
    .select({
      id: applications.id,
      jobId: applications.jobId,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      location: applications.location,
      status: applications.status,
      appliedAt: applications.appliedAt,
      nextActionAt: applications.nextActionAt,
      followUpDue: sql<boolean>`coalesce(${applications.nextActionAt} <= now(), false)`,
      updatedAt: applications.updatedAt,
      hasCoverLetter: sql<boolean>`${applications.coverLetter} <> ''`,
      resumeId: applications.resumeId,
    })
    .from(applications)
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt))
    .limit(1000);
}

export async function getApplication(
  userId: string,
  applicationId: string,
): Promise<ApplicationRow> {
  const [row] = await getDb()
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError("Application");
  return row;
}

export async function getApplicationDetail(userId: string, applicationId: string) {
  const application = await getApplication(userId, applicationId);
  const db = getDb();
  const [events, outreach, [resume], [job]] = await Promise.all([
    db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, application.id))
      .orderBy(desc(applicationEvents.createdAt))
      .limit(100),
    db
      .select()
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.applicationId, application.id),
          eq(outreachMessages.userId, userId),
        ),
      )
      .orderBy(desc(outreachMessages.createdAt)),
    application.resumeId
      ? db
          .select({ id: resumes.id, title: resumes.title })
          .from(resumes)
          .where(and(eq(resumes.id, application.resumeId), eq(resumes.userId, userId)))
          .limit(1)
      : Promise.resolve([]),
    application.jobId
      ? db
          .select({
            id: jobs.id,
            applyUrl: jobs.applyUrl,
            closedAt: jobs.closedAt,
            descriptionText: jobs.descriptionText,
          })
          .from(jobs)
          .where(eq(jobs.id, application.jobId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { application, events, outreach, resume: resume ?? null, job: job ?? null };
}

export async function addEvent(
  applicationId: string,
  actorUserId: string | null,
  type: (typeof applicationEvents.$inferInsert)["type"],
  data: Record<string, unknown> = {},
): Promise<void> {
  await getDb().insert(applicationEvents).values({ applicationId, actorUserId, type, data });
}

/** Finds or creates the tracker entry for a job (the "saved" state). */
export async function ensureApplicationForJob(
  userId: string,
  job: { id: string; title: string; location: string; applyUrl: string },
  companyName: string,
  actorUserId: string,
): Promise<ApplicationRow> {
  const db = getDb();
  const [created] = await db
    .insert(applications)
    .values({
      userId,
      jobId: job.id,
      companyName,
      jobTitle: job.title,
      jobUrl: job.applyUrl,
      location: job.location,
      createdByUserId: actorUserId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await addEvent(created.id, actorUserId, "created", { source: "job" });
    return created;
  }
  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, job.id)))
    .limit(1);
  if (!existing) throw new ConflictError("Could not save this job. Please retry.");
  return existing;
}

export async function createExternalApplication(
  userId: string,
  input: {
    companyName: string;
    jobTitle: string;
    jobUrl: string;
    location: string;
    status: ApplicationStatus;
    notes: string;
  },
  actorUserId: string,
): Promise<ApplicationRow> {
  const [created] = await getDb()
    .insert(applications)
    .values({
      userId,
      ...input,
      appliedAt: input.status === "applied" ? new Date() : null,
      createdByUserId: actorUserId,
    })
    .returning();
  await addEvent(created!.id, actorUserId, "created", {
    source: actorUserId === userId ? "manual" : "specialist",
  });
  return created!;
}

export async function updateApplication(
  userId: string,
  applicationId: string,
  update: Partial<
    Pick<
      ApplicationRow,
      "notes" | "nextActionAt" | "coverLetter" | "answers" | "resumeId" | "status"
    >
  >,
): Promise<ApplicationRow> {
  await getApplication(userId, applicationId);
  const [row] = await getDb()
    .update(applications)
    .set(update)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .returning();
  return row!;
}

export async function changeStatus(
  userId: string,
  applicationId: string,
  status: ApplicationStatus,
  actorUserId: string,
): Promise<ApplicationRow> {
  const application = await getApplication(userId, applicationId);
  if (application.status === status) return application;
  const update: Partial<ApplicationRow> = { status };
  if (status === "applied" && !application.appliedAt) {
    update.appliedAt = new Date();
    // Default follow-up one week after applying.
    update.nextActionAt = application.nextActionAt ?? new Date(Date.now() + 7 * 86_400_000);
  }
  const [row] = await getDb()
    .update(applications)
    .set(update)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .returning();
  await addEvent(application.id, actorUserId, "status_changed", {
    from: application.status,
    to: status,
  });
  return row!;
}

/** Marks an application as submitted and stores an immutable receipt of exactly what was sent. */
export async function markSubmitted(
  userId: string,
  applicationId: string,
  actorUserId: string,
): Promise<ApplicationRow> {
  const application = await getApplication(userId, applicationId);
  let resume: SubmissionReceipt["resume"] = null;
  let resumeTitle = "";
  if (application.resumeId) {
    const [row] = await getDb()
      .select({ content: resumes.content, title: resumes.title })
      .from(resumes)
      .where(and(eq(resumes.id, application.resumeId), eq(resumes.userId, userId)))
      .limit(1);
    resume = row?.content ?? null;
    resumeTitle = row?.title ?? "";
  }
  const receipt: SubmissionReceipt = {
    submittedAt: new Date().toISOString(),
    resumeId: application.resumeId,
    resumeTitle,
    resume,
    coverLetter: application.coverLetter,
    answers: application.answers,
  };
  await getDb()
    .update(applications)
    .set({ receipt })
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  await addEvent(application.id, actorUserId, "submitted", { resumeTitle });
  return changeStatus(userId, applicationId, "applied", actorUserId);
}

export async function deleteApplication(userId: string, applicationId: string): Promise<void> {
  await getApplication(userId, applicationId);
  await getDb()
    .delete(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
}

export async function pipelineStats(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ status: applications.status, count: sql<number>`count(*)::int` })
    .from(applications)
    .where(eq(applications.userId, userId))
    .groupBy(applications.status);
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count])) as Partial<
    Record<ApplicationStatus, number>
  >;
  const [week] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        gte(applications.appliedAt, new Date(Date.now() - 7 * 86_400_000)),
      ),
    );
  const applied = ["applied", "screening", "interviewing", "offer", "rejected"].reduce(
    (total, status) => total + (byStatus[status as ApplicationStatus] ?? 0),
    0,
  );
  const responded = ["screening", "interviewing", "offer"].reduce(
    (total, status) => total + (byStatus[status as ApplicationStatus] ?? 0),
    0,
  );
  return {
    byStatus,
    appliedThisWeek: week?.count ?? 0,
    interviews: byStatus.interviewing ?? 0,
    responseRate: applied ? Math.round((responded / applied) * 100) : null,
  };
}

export async function followUpsDue(userId: string) {
  return getDb()
    .select({
      id: applications.id,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      nextActionAt: applications.nextActionAt,
    })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applications.status, ["applied", "screening", "interviewing", "offer"]),
        sql`${applications.nextActionAt} <= now() + interval '2 days'`,
      ),
    )
    .orderBy(applications.nextActionAt)
    .limit(5);
}
