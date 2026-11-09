import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Database, DbExecutor } from "../client";
import { CHANGED_MESSAGE } from "../concierge/rules";
import {
  supportCaseLinks,
  supportCases,
  supportMessages,
  users,
  type CaseKind,
  type CaseSource,
  type MessageAuthorKind,
  type MessageVisibility,
  type SupportTopic,
} from "../schema";
import {
  AUTO_SOLVE_DAYS,
  canMoveCase,
  MESSAGE_MAX,
  normalizeEmail,
  openToRequester,
  SUBJECT_MAX,
  SupportError,
} from "./rules";
import { hashLinkToken, newLinkToken } from "./tokens";

const DAY_MS = 86_400_000;
const NOT_FOUND = "Request not found.";

/** What a caller needs to tell the requester about a case: its details and a fresh private link. */
export interface CaseNotice {
  caseId: string;
  number: number;
  subject: string;
  contactName: string;
  contactEmail: string;
  userId: string | null;
  /** The link's token. Only its hash is stored. */
  token: string;
}

export interface CreateCaseInput {
  kind: CaseKind;
  source: CaseSource;
  topic: SupportTopic;
  subject: string;
  /** The first message, which is public or internal as `visibility` says. */
  body: string;
  /** Who the case is about. */
  userId: string | null;
  contactName: string;
  contactEmail: string;
  raisedByUserId: string | null;
  specialistId?: string | null;
  /** Whether the requester has already shown they control the account. */
  verified: boolean;
  visibility: MessageVisibility;
  authorKind: MessageAuthorKind;
  authorUserId: string | null;
  now?: Date;
}

const NOTICE_COLUMNS = {
  id: supportCases.id,
  number: supportCases.number,
  subject: supportCases.subject,
  contactName: supportCases.contactName,
  contactEmail: supportCases.contactEmail,
  userId: supportCases.userId,
};

/** Stores a new private link for the case and returns its token. */
async function mintLink(db: DbExecutor, caseId: string): Promise<string> {
  const { token, hash } = newLinkToken();
  await db.insert(supportCaseLinks).values({ tokenHash: hash, caseId });
  return token;
}

async function noticeFor(
  db: DbExecutor,
  row: { id: string } & Omit<CaseNotice, "caseId" | "token">,
): Promise<CaseNotice> {
  return {
    caseId: row.id,
    number: row.number,
    subject: row.subject,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    userId: row.userId,
    token: await mintLink(db, row.id),
  };
}

/** The account that owns this email address, ignoring case and surrounding spaces. */
export async function accountIdForEmail(db: Database, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return row?.id ?? null;
}

/** Opens a case with its first message, and a private link for the requester. Runs inside a transaction too. */
export async function createCase(db: DbExecutor, i: CreateCaseInput): Promise<CaseNotice> {
  const subject = i.subject.trim().slice(0, SUBJECT_MAX);
  const body = i.body.trim().slice(0, MESSAGE_MAX);
  if (!subject) throw new SupportError("not_allowed", "Add a subject.");
  if (!body) throw new SupportError("not_allowed", "Write your message.");
  const now = i.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supportCases)
      .values({
        kind: i.kind,
        source: i.source,
        topic: i.topic,
        subject,
        userId: i.userId,
        contactName: i.contactName.trim(),
        contactEmail: normalizeEmail(i.contactEmail),
        raisedByUserId: i.raisedByUserId,
        specialistId: i.specialistId ?? null,
        verifiedAt: i.verified ? now : null,
        lastMessageAt: now,
        statusChangedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning(NOTICE_COLUMNS);
    await tx.insert(supportMessages).values({
      caseId: row!.id,
      authorUserId: i.authorUserId,
      authorKind: i.authorKind,
      visibility: i.visibility,
      body,
      createdAt: now,
    });
    return noticeFor(tx, row!);
  });
}

/** An agent becomes the owner of a case nobody owns yet; the second of two agents loses. */
export async function takeCase(
  db: Database,
  input: { caseId: string; agentId: string },
): Promise<void> {
  const [row] = await db
    .update(supportCases)
    .set({ assigneeId: input.agentId })
    .where(and(eq(supportCases.id, input.caseId), isNull(supportCases.assigneeId)))
    .returning({ id: supportCases.id });
  if (!row) throw new SupportError("conflict", CHANGED_MESSAGE);
}

/** The owner (or an admin) hands a case to another support agent or admin. */
export async function assignCase(
  db: Database,
  input: { caseId: string; actorId: string; actorIsAdmin: boolean; toAgentId: string },
): Promise<void> {
  const [current] = await db
    .select({ assigneeId: supportCases.assigneeId })
    .from(supportCases)
    .where(eq(supportCases.id, input.caseId))
    .limit(1);
  if (!current) throw new SupportError("not_found", NOT_FOUND);
  if (!input.actorIsAdmin && current.assigneeId !== input.actorId) {
    throw new SupportError("forbidden", "Only the owner or an admin can hand this case off.");
  }
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, input.toAgentId))
    .limit(1);
  if (!target || (target.role !== "support" && target.role !== "admin")) {
    throw new SupportError("not_allowed", "Pick a support agent or an admin.");
  }
  const [row] = await db
    .update(supportCases)
    .set({ assigneeId: input.toAgentId })
    .where(
      and(
        eq(supportCases.id, input.caseId),
        current.assigneeId === null
          ? isNull(supportCases.assigneeId)
          : eq(supportCases.assigneeId, current.assigneeId),
      ),
    )
    .returning({ id: supportCases.id });
  if (!row) throw new SupportError("conflict", CHANGED_MESSAGE);
}

/**
 * A public agent reply. The case now waits on the user; the first such reply meets the first-reply
 * target, and replying to an unowned case makes the replier its owner.
 */
export async function replyAsAgent(
  db: Database,
  input: { caseId: string; agentId: string; body: string; now?: Date },
): Promise<CaseNotice> {
  const body = input.body.trim().slice(0, MESSAGE_MAX);
  if (!body) throw new SupportError("not_allowed", "Write the reply first.");
  const at = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(supportCases)
      .set({
        status: "waiting_on_user",
        firstRepliedAt: sql`coalesce(${supportCases.firstRepliedAt}, ${at.toISOString()}::timestamptz)`,
        assigneeId: sql`coalesce(${supportCases.assigneeId}, ${input.agentId})`,
        solvedAt: null,
        statusChangedAt: at,
        lastMessageAt: at,
      })
      .where(eq(supportCases.id, input.caseId))
      .returning(NOTICE_COLUMNS);
    if (!row) throw new SupportError("not_found", NOT_FOUND);
    await tx.insert(supportMessages).values({
      caseId: input.caseId,
      authorUserId: input.agentId,
      authorKind: "agent",
      visibility: "public",
      body,
      createdAt: at,
    });
    return noticeFor(tx, row);
  });
}

/** A staff-only note (or a system note). It changes nothing else about the case. */
export async function addNote(
  db: DbExecutor,
  input: {
    caseId: string;
    authorId: string | null;
    body: string;
    authorKind?: "agent" | "system";
    now?: Date;
  },
): Promise<void> {
  const body = input.body.trim().slice(0, MESSAGE_MAX);
  if (!body) throw new SupportError("not_allowed", "Write the note first.");
  const [found] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(eq(supportCases.id, input.caseId))
    .limit(1);
  if (!found) throw new SupportError("not_found", NOT_FOUND);
  await db.insert(supportMessages).values({
    caseId: input.caseId,
    authorUserId: input.authorId,
    authorKind: input.authorKind ?? "agent",
    visibility: "internal",
    body,
    createdAt: input.now ?? new Date(),
  });
}

/**
 * The requester's reply. It reopens a case that was waiting on them or solved, and is refused once
 * the case has been solved for more than 14 days.
 */
export async function replyAsRequester(
  db: Database,
  input: { caseId: string; userId: string | null; body: string; now?: Date },
): Promise<void> {
  const body = input.body.trim().slice(0, MESSAGE_MAX);
  if (!body) throw new SupportError("not_allowed", "Write your reply first.");
  const at = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: supportCases.status, solvedAt: supportCases.solvedAt })
      .from(supportCases)
      .where(eq(supportCases.id, input.caseId))
      .limit(1);
    if (!current) throw new SupportError("not_found", NOT_FOUND);
    const reopens = current.status !== "open";
    if (reopens && !canMoveCase(current.status, "open", "user", current.solvedAt, at)) {
      throw new SupportError(
        "not_allowed",
        "This request is closed. Start a new request to reach us.",
      );
    }
    await tx.insert(supportMessages).values({
      caseId: input.caseId,
      authorUserId: input.userId,
      authorKind: "user",
      visibility: "public",
      body,
      createdAt: at,
    });
    const [row] = await tx
      .update(supportCases)
      .set(
        reopens
          ? { status: "open", solvedAt: null, statusChangedAt: at, lastMessageAt: at }
          : { lastMessageAt: at },
      )
      .where(and(eq(supportCases.id, input.caseId), eq(supportCases.status, current.status)))
      .returning({ id: supportCases.id });
    if (!row) throw new SupportError("conflict", CHANGED_MESSAGE);
  });
}

/** Marks an open or waiting case solved; it is a conflict if someone solved it first. */
export async function solveCase(
  db: Database,
  input: { caseId: string; agentId: string | null; now?: Date },
): Promise<CaseNotice> {
  const at = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(supportCases)
      .set({ status: "solved", solvedAt: at, statusChangedAt: at })
      .where(
        and(
          eq(supportCases.id, input.caseId),
          inArray(supportCases.status, ["open", "waiting_on_user"]),
        ),
      )
      .returning(NOTICE_COLUMNS);
    if (!row) throw new SupportError("conflict", CHANGED_MESSAGE);
    return noticeFor(tx, row);
  });
}

export async function reopenCase(
  db: Database,
  input: { caseId: string; agentId: string; now?: Date },
): Promise<void> {
  const [row] = await db
    .update(supportCases)
    .set({ status: "open", solvedAt: null, statusChangedAt: input.now ?? new Date() })
    .where(and(eq(supportCases.id, input.caseId), eq(supportCases.status, "solved")))
    .returning({ id: supportCases.id });
  if (!row) throw new SupportError("conflict", CHANGED_MESSAGE);
}

/** The requester has shown they control the account. The first time is kept. */
export async function verifyCase(
  db: Database,
  input: { caseId: string; now?: Date },
): Promise<void> {
  await db
    .update(supportCases)
    .set({ verifiedAt: input.now ?? new Date() })
    .where(and(eq(supportCases.id, input.caseId), isNull(supportCases.verifiedAt)));
}

/** The case a private link opens, while the link still works (not 14 days past solving). */
export async function caseForLink(
  db: Database,
  token: string,
  now = new Date(),
): Promise<string | null> {
  const [row] = await db
    .select({
      caseId: supportCases.id,
      status: supportCases.status,
      solvedAt: supportCases.solvedAt,
    })
    .from(supportCaseLinks)
    .innerJoin(supportCases, eq(supportCases.id, supportCaseLinks.caseId))
    .where(eq(supportCaseLinks.tokenHash, hashLinkToken(token)))
    .limit(1);
  if (!row || !openToRequester(row.status, row.solvedAt, now)) return null;
  return row.caseId;
}

/** Solves cases that have waited on the user for 7 days, with a system note on each. */
export async function autoSolveCases(db: Database, now = new Date()): Promise<CaseNotice[]> {
  const cutoff = new Date(now.getTime() - AUTO_SOLVE_DAYS * DAY_MS);
  const due = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(
      and(eq(supportCases.status, "waiting_on_user"), lte(supportCases.statusChangedAt, cutoff)),
    );
  const notices: CaseNotice[] = [];
  for (const { id } of due) {
    const notice = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(supportCases)
        .set({ status: "solved", solvedAt: now, statusChangedAt: now })
        .where(and(eq(supportCases.id, id), eq(supportCases.status, "waiting_on_user")))
        .returning(NOTICE_COLUMNS);
      // The user answered while we were working through the list.
      if (!row) return null;
      await tx.insert(supportMessages).values({
        caseId: id,
        authorUserId: null,
        authorKind: "system",
        visibility: "internal",
        body: `Solved automatically after ${AUTO_SOLVE_DAYS} days without a reply.`,
        createdAt: now,
      });
      return noticeFor(tx, row);
    });
    if (notice) notices.push(notice);
  }
  return notices;
}
