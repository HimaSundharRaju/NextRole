import { CONCIERGE_WEEKLY_TARGET } from "../plans";
import { SKIP_REASONS, type ApplicationStatus, type BankAnswer, type SkipReason } from "../schema";

export type ConciergeActor = "staff" | "client" | "system";
export type ClientSkipReason = Exclude<SkipReason, "expired">;

/** Reasons a client can pick when skipping; "expired" is the system's own. */
export const CLIENT_SKIP_REASONS = SKIP_REASONS.filter(
  (reason): reason is ClientSkipReason => reason !== "expired",
);

/** The Concierge steps before submission, and the skip. */
export const CONCIERGE_STEPS: readonly ApplicationStatus[] = [
  "proposed",
  "approved",
  "waiting_on_client",
  "skipped",
];

export type ConciergeErrorCode =
  | "not_allowed"
  | "conflict"
  | "consent_required"
  | "paused"
  | "not_found";

/** A Concierge rule was broken; the web app shows `message` to the person. */
export class ConciergeError extends Error {
  constructor(
    readonly code: ConciergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConciergeError";
  }
}

export const CHANGED_MESSAGE = "This changed — refresh to see the latest.";

const isStep = (status: ApplicationStatus) => CONCIERGE_STEPS.includes(status);

/**
 * Whether `actor` may move an application from `from` to `to`. Moves between the tracker's own
 * statuses (saved, applied, interviewing…) stay free, as before; the Concierge steps follow the
 * spec's table: only the client decides on proposals, only staff ask questions, and staff can't
 * submit while a question is open.
 */
export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  actor: ConciergeActor,
): boolean {
  if (from === to) return false;
  if (actor === "system") {
    return (
      (from === "proposed" && to === "skipped") ||
      (from === "waiting_on_client" && to === "approved")
    );
  }
  if (!isStep(from) && !isStep(to)) return true;
  if (from === "skipped") return false;
  if (to === "withdrawn") return true;
  switch (from) {
    case "saved":
      return to === "approved" && actor === "client";
    case "proposed":
      return actor === "client" && (to === "approved" || to === "skipped");
    case "approved":
      return to === "applied" || (actor === "staff" && to === "waiting_on_client");
    case "waiting_on_client":
      return to === "applied" && actor === "client";
    default:
      return false;
  }
}

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday),
  );
}

/** Whether a client is behind their weekly target at this point in the week. */
export function behindPace(
  appliedThisWeek: number,
  target: number,
  now: Date,
  paused = false,
): boolean {
  if (paused || target <= 0) return false;
  const elapsedDays = (now.getTime() - weekStart(now).getTime()) / DAY_MS;
  return appliedThisWeek < Math.floor((target * elapsedDays) / 7);
}

export function targetFor(override: number | null | undefined): number {
  return override ?? CONCIERGE_WEEKLY_TARGET;
}

/** Adds or replaces an answer in the bank; questions match ignoring case and spacing. */
export function mergeAnswer(
  bank: BankAnswer[],
  question: string,
  answer: string,
  now: Date,
): BankAnswer[] {
  const key = question.trim().toLowerCase();
  const others = bank.filter((item) => item.question.trim().toLowerCase() !== key);
  return [
    ...others,
    { question: question.trim(), answer: answer.trim(), updatedAt: now.toISOString() },
  ].slice(-50);
}
