import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client";
import {
  specialistAssignments,
  supportCases,
  supportMessages,
  users,
  type CaseKind,
  type CaseStatus,
  type MessageAuthorKind,
  type MessageVisibility,
  type Plan,
  type SupportTopic,
} from "../schema";
import { FIRST_REPLY_HOURS, firstReplyState, normalizeEmail } from "./rules";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The board's Solved filter shows cases solved in the last 30 days. */
const SOLVED_SHOWN_DAYS = 30;
/** The typical first reply looks at help cases created in the last 7 days. */
const TYPICAL_REPLY_DAYS = 7;

export type CaseQueue = "open" | "mine" | "unassigned" | "overdue" | "waiting" | "solved";

export interface CaseRow {
  id: string;
  number: number;
  subject: string;
  topic: SupportTopic;
  kind: CaseKind;
  status: CaseStatus;
  requesterName: string;
  requesterEmail: string;
  /** The requester's plan; null when the email matches no account. */
  requesterPlan: Plan | null;
  assigneeName: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  due: { dueAt: Date; overdue: boolean } | null;
}

/** Unsolved help cases with no agent reply more than 24 hours after they were raised. */
function overdueCondition(now: Date): SQL {
  const dueCutoff = new Date(now.getTime() - FIRST_REPLY_HOURS * HOUR_MS);
  return and(
    ne(supportCases.status, "solved"),
    eq(supportCases.kind, "help"),
    isNull(supportCases.firstRepliedAt),
    lt(supportCases.createdAt, dueCutoff),
  )!;
}

const unassignedCondition = (): SQL =>
  and(ne(supportCases.status, "solved"), isNull(supportCases.assigneeId))!;

function queueCondition(queue: CaseQueue, agentId: string, now: Date): SQL | undefined {
  switch (queue) {
    case "mine":
      return and(ne(supportCases.status, "solved"), eq(supportCases.assigneeId, agentId));
    case "unassigned":
      return unassignedCondition();
    case "overdue":
      return overdueCondition(now);
    case "waiting":
      return eq(supportCases.status, "waiting_on_user");
    case "solved":
      return and(
        eq(supportCases.status, "solved"),
        gte(supportCases.solvedAt, new Date(now.getTime() - SOLVED_SHOWN_DAYS * DAY_MS)),
      );
    default:
      return ne(supportCases.status, "solved");
  }
}

/** Matches a request number (a leading # is dropped), or part of the email or subject. */
function searchCondition(search: string | undefined): SQL | undefined {
  const text = search?.trim().replace(/^#/, "").trim();
  if (!text) return undefined;
  const pattern = `%${text.replace(/[\\%_]/g, "")}%`;
  const matches: SQL[] = [
    ilike(supportCases.contactEmail, pattern),
    ilike(supportCases.subject, pattern),
  ];
  if (/^\d{1,9}$/.test(text)) matches.push(eq(supportCases.number, Number(text)));
  return or(...matches);
}

/**
 * The board's cases for one queue. Unsolved queues list overdue cases first, then the oldest;
 * Solved lists the last 30 days, newest first.
 */
export async function listCases(
  db: Database,
  input: {
    queue: CaseQueue;
    agentId: string;
    topic?: SupportTopic;
    search?: string;
    now?: Date;
    limit?: number;
  },
): Promise<CaseRow[]> {
  const now = input.now ?? new Date();
  const assignee = alias(users, "assignee");
  const conditions = [
    queueCondition(input.queue, input.agentId, now),
    input.topic ? eq(supportCases.topic, input.topic) : undefined,
    searchCondition(input.search),
  ];
  const rows = await db
    .select({
      id: supportCases.id,
      number: supportCases.number,
      subject: supportCases.subject,
      topic: supportCases.topic,
      kind: supportCases.kind,
      status: supportCases.status,
      contactName: supportCases.contactName,
      contactEmail: supportCases.contactEmail,
      accountName: users.name,
      accountEmail: users.email,
      plan: users.plan,
      assigneeName: assignee.name,
      createdAt: supportCases.createdAt,
      firstRepliedAt: supportCases.firstRepliedAt,
      lastMessageAt: supportCases.lastMessageAt,
    })
    .from(supportCases)
    .leftJoin(users, eq(users.id, supportCases.userId))
    .leftJoin(assignee, eq(assignee.id, supportCases.assigneeId))
    .where(and(...conditions))
    .orderBy(
      ...(input.queue === "solved"
        ? [desc(supportCases.solvedAt)]
        : [desc(sql`(${overdueCondition(now)})`), asc(supportCases.createdAt)]),
    )
    .limit(input.limit ?? 200);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    subject: row.subject,
    topic: row.topic,
    kind: row.kind,
    status: row.status,
    requesterName: row.contactName || row.accountName || "",
    requesterEmail: row.contactEmail || row.accountEmail || "",
    requesterPlan: row.plan ?? null,
    assigneeName: row.assigneeName ?? null,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
    due: firstReplyState(
      {
        kind: row.kind,
        status: row.status,
        createdAt: row.createdAt,
        firstRepliedAt: row.firstRepliedAt,
      },
      now,
    ),
  }));
}

/** The numbers at the top of the board. */
export async function careCounts(
  db: Database,
  now = new Date(),
): Promise<{
  unassigned: number;
  overdue: number;
  waiting: number;
  typicalFirstReplyMinutes: number | null;
}> {
  const recent = new Date(now.getTime() - TYPICAL_REPLY_DAYS * DAY_MS);
  const [row] = await db
    .select({
      unassigned: sql<number>`(count(*) filter (where ${unassignedCondition()}))::int`,
      overdue: sql<number>`(count(*) filter (where ${overdueCondition(now)}))::int`,
      waiting: sql<number>`(count(*) filter (where ${eq(supportCases.status, "waiting_on_user")}))::int`,
      typical: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${supportCases.firstRepliedAt} - ${supportCases.createdAt})) / 60) filter (where ${and(eq(supportCases.kind, "help"), isNotNull(supportCases.firstRepliedAt), gte(supportCases.createdAt, recent))})`,
    })
    .from(supportCases);
  return {
    unassigned: row!.unassigned,
    overdue: row!.overdue,
    waiting: row!.waiting,
    typicalFirstReplyMinutes: row!.typical === null ? null : Math.round(Number(row!.typical)),
  };
}

export interface CaseThread {
  /** The whole case row, with staff-only fields: show a requester only what they should see. */
  case: typeof supportCases.$inferSelect;
  messages: Array<{
    id: string;
    authorKind: MessageAuthorKind;
    authorName: string | null;
    visibility: MessageVisibility;
    body: string;
    createdAt: Date;
  }>;
}

/** A case and its messages, oldest first; the requester's view leaves out internal notes. */
export async function caseThread(
  db: Database,
  caseId: string,
  options: { includeInternal: boolean },
): Promise<CaseThread | null> {
  const [found] = await db.select().from(supportCases).where(eq(supportCases.id, caseId)).limit(1);
  if (!found) return null;
  const messages = await db
    .select({
      id: supportMessages.id,
      authorKind: supportMessages.authorKind,
      authorName: users.name,
      visibility: supportMessages.visibility,
      body: supportMessages.body,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .leftJoin(users, eq(users.id, supportMessages.authorUserId))
    .where(
      and(
        eq(supportMessages.caseId, caseId),
        options.includeInternal ? undefined : eq(supportMessages.visibility, "public"),
      ),
    )
    .orderBy(asc(supportMessages.createdAt));
  return { case: found, messages };
}

/**
 * The cases a user can see: those about them that they raised, or that an agent has written to
 * them about. A Concierge escalation a specialist raised stays hidden until then.
 */
function visibleToUser(db: Database, userId: string): SQL {
  return and(
    eq(supportCases.userId, userId),
    or(
      eq(supportCases.raisedByUserId, userId),
      exists(
        db
          .select({ one: sql`1` })
          .from(supportMessages)
          .where(
            and(
              eq(supportMessages.caseId, supportCases.id),
              eq(supportMessages.visibility, "public"),
              eq(supportMessages.authorKind, "agent"),
            ),
          ),
      ),
    ),
  )!;
}

/** A user's own requests, newest activity first. */
export async function userCases(
  db: Database,
  userId: string,
): Promise<
  Array<{
    id: string;
    number: number;
    subject: string;
    status: CaseStatus;
    lastMessageAt: Date | null;
  }>
> {
  return db
    .select({
      id: supportCases.id,
      number: supportCases.number,
      subject: supportCases.subject,
      status: supportCases.status,
      lastMessageAt: supportCases.lastMessageAt,
    })
    .from(supportCases)
    .where(visibleToUser(db, userId))
    .orderBy(desc(sql`coalesce(${supportCases.lastMessageAt}, ${supportCases.createdAt})`));
}

/**
 * Whether the requester has any reason to know about a case: they opened it (a help request), or
 * staff wrote to them. A staff-raised escalation nobody has written about stays a secret, so
 * nothing is emailed about it, and its being solved is not news.
 */
export async function requesterKnows(db: Database, caseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(
      and(
        eq(supportCases.id, caseId),
        or(
          eq(supportCases.kind, "help"),
          exists(
            db
              .select({ one: sql`1` })
              .from(supportMessages)
              .where(
                and(
                  eq(supportMessages.caseId, supportCases.id),
                  eq(supportMessages.visibility, "public"),
                  eq(supportMessages.authorKind, "agent"),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function canUserSeeCase(
  db: Database,
  input: { caseId: string; userId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(and(eq(supportCases.id, input.caseId), visibleToUser(db, input.userId)))
    .limit(1);
  return Boolean(row);
}

/** The same requester's other cases, by account or by email, for the case page's side panel. */
export async function otherCases(
  db: Database,
  input: { caseId: string; userId: string | null; contactEmail: string; limit?: number },
): Promise<
  Array<{ id: string; number: number; subject: string; status: CaseStatus; createdAt: Date }>
> {
  const email = normalizeEmail(input.contactEmail);
  const same = [
    input.userId ? eq(supportCases.userId, input.userId) : undefined,
    email ? eq(supportCases.contactEmail, email) : undefined,
  ].filter((condition): condition is SQL => condition !== undefined);
  if (same.length === 0) return [];
  return db
    .select({
      id: supportCases.id,
      number: supportCases.number,
      subject: supportCases.subject,
      status: supportCases.status,
      createdAt: supportCases.createdAt,
    })
    .from(supportCases)
    .where(and(ne(supportCases.id, input.caseId), or(...same)))
    .orderBy(desc(supportCases.createdAt))
    .limit(input.limit ?? 5);
}

export async function activeSpecialistId(db: Database, clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ specialistId: specialistAssignments.specialistId })
    .from(specialistAssignments)
    .where(
      and(eq(specialistAssignments.clientId, clientId), eq(specialistAssignments.active, true)),
    )
    .limit(1);
  return row?.specialistId ?? null;
}

/** The newest escalation about a client, for the specialist's workspace header. */
export async function latestEscalation(
  db: Database,
  clientId: string,
): Promise<{ id: string; number: number; status: CaseStatus } | null> {
  const [row] = await db
    .select({ id: supportCases.id, number: supportCases.number, status: supportCases.status })
    .from(supportCases)
    .where(and(eq(supportCases.userId, clientId), eq(supportCases.kind, "escalation")))
    .orderBy(desc(supportCases.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * What goes in a user's data export: every case about them, and only the public messages. That
 * includes escalations staff raised, which their request list hides, because an export is
 * everything stored about the user. Internal notes and staff accounts are never exported.
 */
export async function supportExport(
  db: Database,
  userId: string,
): Promise<{
  cases: Array<{
    id: string;
    number: number;
    kind: CaseKind;
    topic: SupportTopic;
    status: CaseStatus;
    subject: string;
    createdAt: Date;
    solvedAt: Date | null;
  }>;
  messages: Array<{
    caseId: string;
    authorKind: MessageAuthorKind;
    visibility: MessageVisibility;
    body: string;
    createdAt: Date;
  }>;
}> {
  const cases = await db
    .select({
      id: supportCases.id,
      number: supportCases.number,
      kind: supportCases.kind,
      topic: supportCases.topic,
      status: supportCases.status,
      subject: supportCases.subject,
      createdAt: supportCases.createdAt,
      solvedAt: supportCases.solvedAt,
    })
    .from(supportCases)
    .where(eq(supportCases.userId, userId))
    .orderBy(asc(supportCases.createdAt));
  if (cases.length === 0) return { cases, messages: [] };
  const messages = await db
    .select({
      caseId: supportMessages.caseId,
      authorKind: supportMessages.authorKind,
      visibility: supportMessages.visibility,
      body: supportMessages.body,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .where(
      and(
        inArray(
          supportMessages.caseId,
          cases.map((row) => row.id),
        ),
        eq(supportMessages.visibility, "public"),
      ),
    )
    .orderBy(asc(supportMessages.createdAt));
  return { cases, messages };
}
