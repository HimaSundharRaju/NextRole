import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client";
import {
  applications,
  clientTasks,
  jobs,
  profiles,
  specialistAssignments,
  users,
  type ApplicationStatus,
} from "../schema";
import { behindPace, targetFor, weekStart } from "./rules";

const DAY_MS = 86_400_000;

export type BoardColumn =
  | "proposed"
  | "approved"
  | "waiting"
  | "applied_week"
  | "in_progress"
  | "closed";

/** Where a status sits on the specialist's board; null for the client's own tracker steps. */
export function columnOf(
  status: ApplicationStatus,
  appliedAt: Date | null,
  now: Date,
): BoardColumn | null {
  switch (status) {
    case "proposed":
      return "proposed";
    case "approved":
      return "approved";
    case "waiting_on_client":
      return "waiting";
    case "applied":
      return appliedAt && appliedAt >= weekStart(now) ? "applied_week" : "in_progress";
    case "screening":
    case "interviewing":
      return "in_progress";
    case "offer":
    case "rejected":
    case "withdrawn":
    case "skipped":
      return "closed";
    default:
      return null;
  }
}

/** Boards where applying usually means creating an account first. */
export const NEEDS_ACCOUNT_SOURCES = [
  "workday",
  "oracle",
  "eightfold",
  "amazon",
  "usajobs",
] as const;

export interface BoardCard {
  id: string;
  clientId: string;
  clientName: string;
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  column: BoardColumn;
  updatedAt: Date;
  hasResume: boolean;
  hasLetter: boolean;
  answerCount: number;
  needsAccount: boolean;
  postingClosed: boolean;
}

export interface ClientWeek {
  clientId: string;
  clientName: string;
  target: number;
  appliedThisWeek: number;
  paused: boolean;
  behind: boolean;
  setupDone: boolean;
  /** Answers the client sent since the specialist last opened their workspace. */
  newAnswers: number;
}

async function appliedThisWeek(
  db: Database,
  clientIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: applications.userId, count: sql<number>`count(*)::int` })
    .from(applications)
    .where(
      and(inArray(applications.userId, clientIds), gte(applications.appliedAt, weekStart(now))),
    )
    .groupBy(applications.userId);
  return new Map(rows.map((row) => [row.userId, row.count]));
}

const LIVE_STATUSES: ApplicationStatus[] = [
  "proposed",
  "approved",
  "waiting_on_client",
  "applied",
  "screening",
  "interviewing",
];
const CLOSED_STATUSES: ApplicationStatus[] = ["offer", "rejected", "withdrawn", "skipped"];

/** One specialist's board: every active client's live work, and each client's week. */
export async function specialistBoard(
  db: Database,
  specialistId: string,
  now = new Date(),
): Promise<{ cards: BoardCard[]; clients: ClientWeek[] }> {
  const clients = await db
    .select({
      id: users.id,
      name: users.name,
      override: profiles.weeklyTargetOverride,
      paused: profiles.conciergePausedAt,
      access: profiles.inboxAccessConfirmedAt,
      consent: profiles.applyConsentAt,
      lastViewedAt: specialistAssignments.lastViewedAt,
    })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.clientId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(specialistAssignments.specialistId, specialistId),
        eq(specialistAssignments.active, true),
      ),
    )
    .orderBy(users.name);
  if (clients.length === 0) return { cards: [], clients: [] };
  const ids = clients.map((row) => row.id);
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({
      id: applications.id,
      userId: applications.userId,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      status: applications.status,
      appliedAt: applications.appliedAt,
      updatedAt: applications.updatedAt,
      resumeId: applications.resumeId,
      hasLetter: sql<boolean>`${applications.coverLetter} <> ''`,
      answerCount: sql<number>`jsonb_array_length(${applications.answers})::int`,
      jobId: applications.jobId,
      source: jobs.source,
      closedAt: jobs.closedAt,
    })
    .from(applications)
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(
      and(
        inArray(applications.userId, ids),
        or(
          inArray(applications.status, LIVE_STATUSES),
          and(inArray(applications.status, CLOSED_STATUSES), gte(applications.updatedAt, since)),
        ),
      ),
    )
    .orderBy(desc(applications.updatedAt))
    .limit(2000);
  const names = new Map(clients.map((row) => [row.id, row.name]));
  const cards = rows.flatMap((row): BoardCard[] => {
    const column = columnOf(row.status, row.appliedAt, now);
    if (!column) return [];
    return [
      {
        id: row.id,
        clientId: row.userId,
        clientName: names.get(row.userId) ?? "",
        companyName: row.companyName,
        jobTitle: row.jobTitle,
        status: row.status,
        column,
        updatedAt: row.updatedAt,
        hasResume: row.resumeId !== null,
        hasLetter: row.hasLetter,
        answerCount: row.answerCount,
        needsAccount:
          row.jobId === null ||
          (row.source !== null &&
            (NEEDS_ACCOUNT_SOURCES as readonly string[]).includes(row.source)),
        postingClosed: row.closedAt !== null,
      },
    ];
  });
  const applied = await appliedThisWeek(db, ids, now);
  const answered = await db
    .select({ clientId: clientTasks.clientId, completedAt: clientTasks.completedAt })
    .from(clientTasks)
    .where(
      and(
        inArray(clientTasks.clientId, ids),
        eq(clientTasks.kind, "answer_question"),
        eq(clientTasks.status, "done"),
        gte(clientTasks.completedAt, since),
      ),
    );
  return {
    cards,
    clients: clients.map((row) => {
      const target = targetFor(row.override);
      const done = applied.get(row.id) ?? 0;
      const paused = row.paused != null;
      return {
        clientId: row.id,
        clientName: row.name,
        target,
        appliedThisWeek: done,
        paused,
        behind: behindPace(done, target, now, paused),
        setupDone: Boolean(row.consent && row.access),
        newAnswers: answered.filter(
          (task) =>
            task.clientId === row.id &&
            task.completedAt !== null &&
            (row.lastViewedAt === null || task.completedAt > row.lastViewedAt),
        ).length,
      };
    }),
  };
}

export interface SpecialistStats {
  id: string;
  name: string;
  clients: number;
  appliedThisWeek: number;
  targetTotal: number;
  behind: number;
  proposalsWaiting: number;
  oldestProposalDays: number | null;
  openQuestions: number;
  /** Approved ÷ decided proposals in the last 30 days, as a percentage. */
  approvalRate: number | null;
  /** Applications that reached screening or later ÷ applied, last 30 days, as a percentage. */
  interviewRate: number | null;
}

export interface TeamClient {
  clientId: string;
  name: string;
  email: string;
  specialistId: string;
  specialistName: string;
  setup: "done" | "waiting_access" | "not_started";
  paused: boolean;
  appliedThisWeek: number;
  target: number;
  behind: boolean;
  lastActivity: Date | null;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/** The admin's view of every specialist and every active Concierge client. */
export async function teamOverview(
  db: Database,
  now = new Date(),
): Promise<{ specialists: SpecialistStats[]; clients: TeamClient[] }> {
  const since = sql`${new Date(now.getTime() - 30 * DAY_MS).toISOString()}::timestamptz`;
  const specialistRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.role, "specialist"))
    .orderBy(users.name);
  const clientRows = await db
    .select({
      clientId: users.id,
      name: users.name,
      email: users.email,
      specialistId: specialistAssignments.specialistId,
      jobSearchEmail: profiles.jobSearchEmail,
      consent: profiles.applyConsentAt,
      access: profiles.inboxAccessConfirmedAt,
      override: profiles.weeklyTargetOverride,
      paused: profiles.conciergePausedAt,
    })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.clientId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(specialistAssignments.active, true))
    .orderBy(users.name);
  const ids = clientRows.map((row) => row.clientId);
  const applied = await appliedThisWeek(db, ids, now);
  const perClient =
    ids.length === 0
      ? []
      : await db
          .select({
            userId: applications.userId,
            proposals: sql<number>`(count(*) filter (where ${applications.status} = 'proposed'))::int`,
            oldestProposal: sql<
              string | null
            >`min(${applications.proposedAt}) filter (where ${applications.status} = 'proposed')`,
            decided: sql<number>`(count(*) filter (where ${applications.decidedAt} >= ${since} and ${applications.proposedAt} is not null and ${applications.skipReason} is distinct from 'expired'))::int`,
            approved: sql<number>`(count(*) filter (where ${applications.decidedAt} >= ${since} and ${applications.proposedAt} is not null and ${applications.skipReason} is null))::int`,
            appliedRecent: sql<number>`(count(*) filter (where ${applications.appliedAt} >= ${since}))::int`,
            interviews: sql<number>`(count(*) filter (where ${applications.appliedAt} >= ${since} and ${applications.status} in ('screening', 'interviewing', 'offer')))::int`,
            lastActivity: sql<string | null>`max(${applications.updatedAt})`,
          })
          .from(applications)
          .where(inArray(applications.userId, ids))
          .groupBy(applications.userId);
  const questions =
    ids.length === 0
      ? []
      : await db
          .select({ clientId: clientTasks.clientId, count: sql<number>`count(*)::int` })
          .from(clientTasks)
          .where(
            and(
              inArray(clientTasks.clientId, ids),
              eq(clientTasks.kind, "answer_question"),
              eq(clientTasks.status, "open"),
            ),
          )
          .groupBy(clientTasks.clientId);
  const stats = new Map(perClient.map((row) => [row.userId, row]));
  const openQuestions = new Map(questions.map((row) => [row.clientId, row.count]));
  const specialistNames = new Map(specialistRows.map((row) => [row.id, row.name]));

  const clients: TeamClient[] = clientRows.map((row) => {
    const target = targetFor(row.override);
    const done = applied.get(row.clientId) ?? 0;
    const paused = row.paused != null;
    const last = stats.get(row.clientId)?.lastActivity;
    return {
      clientId: row.clientId,
      name: row.name,
      email: row.email,
      specialistId: row.specialistId,
      specialistName: specialistNames.get(row.specialistId) ?? "",
      setup:
        row.consent && row.access ? "done" : row.jobSearchEmail ? "waiting_access" : "not_started",
      paused,
      appliedThisWeek: done,
      target,
      behind: behindPace(done, target, now, paused),
      lastActivity: last ? new Date(last) : null,
    };
  });

  const specialists: SpecialistStats[] = specialistRows.map((specialist) => {
    const mine = clients.filter((row) => row.specialistId === specialist.id);
    const rows = mine.map((row) => stats.get(row.clientId));
    const sum = (pick: (row: NonNullable<(typeof rows)[number]>) => number) =>
      rows.reduce((total, row) => total + (row ? pick(row) : 0), 0);
    const oldest = rows
      .map((row) => (row?.oldestProposal ? new Date(row.oldestProposal).getTime() : null))
      .filter((time): time is number => time !== null)
      .sort((a, b) => a - b)[0];
    return {
      id: specialist.id,
      name: specialist.name,
      clients: mine.length,
      appliedThisWeek: mine.reduce((total, row) => total + row.appliedThisWeek, 0),
      targetTotal: mine.reduce((total, row) => total + (row.paused ? 0 : row.target), 0),
      behind: mine.filter((row) => row.behind).length,
      proposalsWaiting: sum((row) => row.proposals),
      oldestProposalDays:
        oldest === undefined ? null : Math.floor((now.getTime() - oldest) / DAY_MS),
      openQuestions: mine.reduce((total, row) => total + (openQuestions.get(row.clientId) ?? 0), 0),
      approvalRate: percent(
        sum((row) => row.approved),
        sum((row) => row.decided),
      ),
      interviewRate: percent(
        sum((row) => row.interviews),
        sum((row) => row.appliedRecent),
      ),
    };
  });
  return { specialists, clients };
}

export interface ClientProposal {
  id: string;
  jobId: string | null;
  companyName: string;
  jobTitle: string;
  location: string;
  note: string;
  proposedAt: Date | null;
  proposedByName: string | null;
  /** The board job's fields for pay and a match score; null for jobs found elsewhere. */
  job: {
    title: string;
    skills: string[];
    location: string;
    workplaceType: (typeof jobs.$inferSelect)["workplaceType"];
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: (typeof jobs.$inferSelect)["salaryPeriod"];
    visaSponsorship: (typeof jobs.$inferSelect)["visaSponsorship"];
    citizenshipRequired: boolean;
    seniority: (typeof jobs.$inferSelect)["seniority"];
    yearsMin: number | null;
  } | null;
}

export interface ClientQuestion {
  id: string;
  question: string;
  applicationId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  createdAt: Date;
}

export interface ClientConcierge {
  specialist: { name: string; email: string } | null;
  setup: {
    jobSearchEmail: string;
    consentAt: Date | null;
    accessConfirmedAt: Date | null;
    paused: boolean;
  };
  proposals: ClientProposal[];
  questions: ClientQuestion[];
  week: { applied: number; target: number };
}

/** What a Concierge client sees: their specialist, setup, proposals, questions and week. */
export async function clientConcierge(
  db: Database,
  clientId: string,
  now = new Date(),
): Promise<ClientConcierge> {
  const [specialist] = await db
    .select({ name: users.name, email: users.email })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.specialistId))
    .where(
      and(eq(specialistAssignments.clientId, clientId), eq(specialistAssignments.active, true)),
    )
    .limit(1);
  const [profile] = await db
    .select({
      jobSearchEmail: profiles.jobSearchEmail,
      consentAt: profiles.applyConsentAt,
      accessConfirmedAt: profiles.inboxAccessConfirmedAt,
      paused: profiles.conciergePausedAt,
      override: profiles.weeklyTargetOverride,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1);
  const proposer = alias(users, "proposer");
  const proposalRows = await db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      location: applications.location,
      note: applications.proposalNote,
      proposedAt: applications.proposedAt,
      proposedByName: proposer.name,
      skills: jobs.skills,
      title: jobs.title,
      jobLocation: jobs.location,
      workplaceType: jobs.workplaceType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      salaryPeriod: jobs.salaryPeriod,
      visaSponsorship: jobs.visaSponsorship,
      citizenshipRequired: jobs.citizenshipRequired,
      seniority: jobs.seniority,
      yearsMin: jobs.yearsMin,
    })
    .from(applications)
    .leftJoin(proposer, eq(proposer.id, applications.proposedByUserId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, clientId), eq(applications.status, "proposed")))
    .orderBy(desc(applications.proposedAt));
  const questionRows = await db
    .select({
      id: clientTasks.id,
      question: clientTasks.question,
      applicationId: clientTasks.applicationId,
      jobTitle: applications.jobTitle,
      companyName: applications.companyName,
      createdAt: clientTasks.createdAt,
    })
    .from(clientTasks)
    .leftJoin(applications, eq(applications.id, clientTasks.applicationId))
    .where(
      and(
        eq(clientTasks.clientId, clientId),
        eq(clientTasks.kind, "answer_question"),
        eq(clientTasks.status, "open"),
      ),
    )
    .orderBy(clientTasks.createdAt);
  const applied = (await appliedThisWeek(db, [clientId], now)).get(clientId) ?? 0;
  return {
    specialist: specialist ?? null,
    setup: {
      jobSearchEmail: profile?.jobSearchEmail ?? "",
      consentAt: profile?.consentAt ?? null,
      accessConfirmedAt: profile?.accessConfirmedAt ?? null,
      paused: profile?.paused != null,
    },
    proposals: proposalRows.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      companyName: row.companyName,
      jobTitle: row.jobTitle,
      location: row.location,
      note: row.note,
      proposedAt: row.proposedAt,
      proposedByName: row.proposedByName,
      job:
        row.jobId &&
        row.title !== null &&
        row.skills !== null &&
        row.workplaceType !== null &&
        row.visaSponsorship !== null &&
        row.citizenshipRequired !== null
          ? {
              title: row.title,
              skills: row.skills,
              location: row.jobLocation ?? "",
              workplaceType: row.workplaceType,
              salaryMin: row.salaryMin,
              salaryMax: row.salaryMax,
              salaryCurrency: row.salaryCurrency,
              salaryPeriod: row.salaryPeriod,
              visaSponsorship: row.visaSponsorship,
              citizenshipRequired: row.citizenshipRequired,
              seniority: row.seniority,
              yearsMin: row.yearsMin,
            }
          : null,
    })),
    questions: questionRows,
    week: { applied, target: targetFor(profile?.override) },
  };
}
