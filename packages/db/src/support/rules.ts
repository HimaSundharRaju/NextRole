import { weekStart } from "../concierge/rules";
import type { CaseKind, CaseStatus } from "../schema";

/** A help request should get its first public agent reply within this many hours. */
export const FIRST_REPLY_HOURS = 24;
/** A case that has waited on the user this many days is solved automatically. */
export const AUTO_SOLVE_DAYS = 7;
/** The requester can reopen a solved case, and use its private link, for this many days. */
export const REOPEN_DAYS = 14;
/** A company request still pending after this many days reaches customer care. */
export const STALE_REQUEST_DAYS = 3;
export const EXPORT_LINK_HOURS = 24;

export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 5000;
export const REASON_MAX = 300;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type SupportErrorCode = "not_allowed" | "conflict" | "not_found" | "forbidden";

/** A support rule was broken; the web app shows `message` to the person. */
export class SupportError extends Error {
  constructor(
    readonly code: SupportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupportError";
  }
}

export type CaseActor = "user" | "agent" | "system";

/** Whether a case is still open to the person who raised it: not solved more than 14 days ago. */
export function openToRequester(status: CaseStatus, solvedAt: Date | null, now: Date): boolean {
  if (status !== "solved" || !solvedAt) return true;
  return now.getTime() - solvedAt.getTime() <= REOPEN_DAYS * DAY_MS;
}

/**
 * Whether `actor` may move a case from `from` to `to`. Agents reply (waiting on the user), solve
 * and reopen; the user's answer reopens a case, within 14 days once it is solved; only the system
 * solves a case by itself, after it has waited on the user too long.
 */
export function canMoveCase(
  from: CaseStatus,
  to: CaseStatus,
  actor: CaseActor,
  solvedAt: Date | null,
  now: Date,
): boolean {
  if (from === to) return false;
  if (actor === "agent") {
    if (to === "waiting_on_user") return true;
    if (to === "solved") return true;
    return to === "open" && from === "solved";
  }
  if (actor === "user") {
    if (to !== "open") return false;
    return from === "waiting_on_user" || openToRequester(from, solvedAt, now);
  }
  return from === "waiting_on_user" && to === "solved";
}

/**
 * The first-reply target for a help case that nobody has answered yet; null for escalations
 * (care may settle them without writing to the client), solved cases and answered ones.
 */
export function firstReplyState(
  c: { kind: CaseKind; status: CaseStatus; createdAt: Date; firstRepliedAt: Date | null },
  now: Date,
): { dueAt: Date; overdue: boolean } | null {
  if (c.kind !== "help" || c.status === "solved" || c.firstRepliedAt) return null;
  const dueAt = new Date(c.createdAt.getTime() + FIRST_REPLY_HOURS * HOUR_MS);
  return { dueAt, overdue: now.getTime() > dueAt.getTime() };
}

/** What the Monday check does for a client: nothing, add a note to their case, or open one. */
export function weeklyCheckAction(i: {
  applied: number;
  target: number;
  hasOpenEscalation: boolean;
}): "skip" | "note" | "open" {
  if (i.target <= 0 || i.applied >= i.target) return "skip";
  return i.hasOpenEscalation ? "note" : "open";
}

/** Last week, Monday 00:00 UTC up to this week's Monday 00:00 UTC. */
export function previousWeek(now: Date): { start: Date; end: Date } {
  const end = weekStart(now);
  return { start: new Date(end.getTime() - 7 * DAY_MS), end };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
