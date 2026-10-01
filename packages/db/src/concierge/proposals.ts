import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Database } from "../client";
import {
  applicationEvents,
  applications,
  companies,
  jobEmployerName,
  jobs,
  profiles,
  specialistAssignments,
  users,
} from "../schema";
import { CHANGED_MESSAGE, ConciergeError, type ClientSkipReason } from "./rules";

/** A Concierge client: on the Concierge plan, with an active specialist. */
export async function isConciergeClient(db: Database, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      specialistAssignments,
      and(eq(specialistAssignments.clientId, users.id), eq(specialistAssignments.active, true)),
    )
    .where(and(eq(users.id, clientId), eq(users.plan, "concierge")))
    .limit(1);
  return Boolean(row);
}

async function isPaused(db: Database, clientId: string): Promise<boolean> {
  const [profile] = await db
    .select({ paused: profiles.conciergePausedAt })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1);
  return Boolean(profile?.paused);
}

async function assertNotPaused(db: Database, clientId: string): Promise<void> {
  if (await isPaused(db, clientId)) {
    throw new ConciergeError("paused", "This client has paused their search.");
  }
}

export interface ProposeResult {
  /** Applications created, one per newly proposed job. */
  created: string[];
  /** Jobs the client already has in their tracker, left as they are. */
  existing: string[];
  /** Jobs that are closed or unknown. */
  unavailable: string[];
}

/** Proposes open board jobs to a client, with an optional note they'll see. */
export async function proposeJobs(
  db: Database,
  input: { clientId: string; specialistId: string; jobIds: string[]; note?: string; now?: Date },
): Promise<ProposeResult> {
  await assertNotPaused(db, input.clientId);
  const now = input.now ?? new Date();
  const note = input.note?.trim().slice(0, 200) ?? "";
  const open = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      applyUrl: jobs.applyUrl,
      employer: jobEmployerName(),
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(inArray(jobs.id, input.jobIds), isNull(jobs.closedAt)));
  const result: ProposeResult = {
    created: [],
    existing: [],
    unavailable: input.jobIds.filter((id) => !open.some((job) => job.id === id)),
  };
  for (const job of open) {
    const [row] = await db
      .insert(applications)
      .values({
        userId: input.clientId,
        jobId: job.id,
        companyName: job.employer,
        jobTitle: job.title,
        jobUrl: job.applyUrl,
        location: job.location,
        status: "proposed",
        proposedByUserId: input.specialistId,
        proposedAt: now,
        proposalNote: note,
        createdByUserId: input.specialistId,
      })
      .onConflictDoNothing()
      .returning({ id: applications.id });
    if (!row) {
      result.existing.push(job.id);
      continue;
    }
    result.created.push(row.id);
    await db
      .insert(applicationEvents)
      .values({ applicationId: row.id, actorUserId: input.specialistId, type: "proposed" });
  }
  return result;
}

/** Proposes a job found elsewhere, with its pasted description. Returns the application's id. */
export async function proposeExternal(
  db: Database,
  input: {
    clientId: string;
    specialistId: string;
    companyName: string;
    jobTitle: string;
    jobUrl: string;
    location: string;
    jobDescription: string;
    note?: string;
    now?: Date;
  },
): Promise<string> {
  await assertNotPaused(db, input.clientId);
  const [row] = await db
    .insert(applications)
    .values({
      userId: input.clientId,
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      jobUrl: input.jobUrl,
      location: input.location,
      jobDescription: input.jobDescription,
      status: "proposed",
      proposedByUserId: input.specialistId,
      proposedAt: input.now ?? new Date(),
      proposalNote: input.note?.trim().slice(0, 200) ?? "",
      createdByUserId: input.specialistId,
    })
    .returning({ id: applications.id });
  await db.insert(applicationEvents).values({
    applicationId: row!.id,
    actorUserId: input.specialistId,
    type: "proposed",
    data: { source: "external" },
  });
  return row!.id;
}

/**
 * The client approves or skips proposals. Only still-proposed applications of this client
 * change; if none do, the client was looking at something stale.
 */
export async function decideProposals(
  db: Database,
  input: {
    clientId: string;
    applicationIds: string[];
    decision: "approve" | "skip";
    reason?: ClientSkipReason;
    now?: Date;
  },
): Promise<number> {
  if (input.decision === "skip" && !input.reason) {
    throw new ConciergeError("not_allowed", "Choose why you're skipping it.");
  }
  const now = input.now ?? new Date();
  const updated = await db
    .update(applications)
    .set(
      input.decision === "approve"
        ? { status: "approved", decidedAt: now }
        : { status: "skipped", decidedAt: now, skipReason: input.reason },
    )
    .where(
      and(
        eq(applications.userId, input.clientId),
        inArray(applications.id, input.applicationIds),
        eq(applications.status, "proposed"),
      ),
    )
    .returning({ id: applications.id });
  if (updated.length === 0) throw new ConciergeError("conflict", CHANGED_MESSAGE);
  await db.insert(applicationEvents).values(
    updated.map((row) => ({
      applicationId: row.id,
      actorUserId: input.clientId,
      type: input.decision === "approve" ? ("approved" as const) : ("skipped" as const),
      data: input.reason ? { reason: input.reason } : {},
    })),
  );
  return updated.length;
}

/** A job a Concierge client saves themselves counts as approved for their specialist. */
export async function approveOwnSave(
  db: Database,
  input: { clientId: string; applicationId: string },
): Promise<boolean> {
  if (!(await isConciergeClient(db, input.clientId)) || (await isPaused(db, input.clientId))) {
    return false;
  }
  const [row] = await db
    .update(applications)
    .set({ status: "approved", decidedAt: new Date() })
    .where(
      and(
        eq(applications.id, input.applicationId),
        eq(applications.userId, input.clientId),
        eq(applications.status, "saved"),
      ),
    )
    .returning({ id: applications.id });
  if (!row) return false;
  await db.insert(applicationEvents).values({
    applicationId: row.id,
    actorUserId: input.clientId,
    type: "approved",
    data: { source: "saved" },
  });
  return true;
}

export const PROPOSAL_DAYS = 7;

/** Proposals left unanswered for PROPOSAL_DAYS become skipped, reason "expired". */
export async function expireProposals(db: Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PROPOSAL_DAYS * 86_400_000);
  const expired = await db
    .update(applications)
    .set({ status: "skipped", skipReason: "expired", decidedAt: now })
    .where(and(eq(applications.status, "proposed"), lt(applications.proposedAt, cutoff)))
    .returning({ id: applications.id });
  if (expired.length > 0) {
    await db.insert(applicationEvents).values(
      expired.map((row) => ({
        applicationId: row.id,
        actorUserId: null,
        type: "skipped" as const,
        data: { reason: "expired" },
      })),
    );
  }
  return expired.length;
}
