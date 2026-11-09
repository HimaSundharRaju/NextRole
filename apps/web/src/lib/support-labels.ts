import type { CaseStatus, SupportTopic } from "@gettargetrole/db/schema";

export const SUPPORT_TOPIC_LABEL: Record<SupportTopic, string> = {
  account: "Account & sign-in",
  billing: "Plan & billing",
  concierge: "Concierge",
  jobs: "Jobs & listings",
  bug: "Something's broken",
  data: "My data (export or delete)",
  other: "Other",
};

/** How a request's status reads to the person who raised it. */
export const USER_STATUS_LABEL: Record<CaseStatus, string> = {
  open: "With our team",
  waiting_on_user: "Waiting on you",
  solved: "Solved",
};

/** How a case's status reads on the care board. */
export const STAFF_STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  waiting_on_user: "Waiting on user",
  solved: "Solved",
};

/** "Due in 3h" or "Overdue by 20m": whole hours from 60 minutes up, minutes below that. */
export function dueLabel(state: { dueAt: Date; overdue: boolean }, now: Date): string {
  const minutes = Math.max(1, Math.floor(Math.abs(state.dueAt.getTime() - now.getTime()) / 60_000));
  const amount = minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
  return state.overdue ? `Overdue by ${amount}` : `Due in ${amount}`;
}
