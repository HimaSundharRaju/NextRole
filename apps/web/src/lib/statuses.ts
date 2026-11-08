import type { ApplicationStatus } from "@gettargetrole/db/schema";

export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: "neutral" | "primary" | "success" | "warning" | "danger" }
> = {
  saved: { label: "Saved", tone: "neutral" },
  preparing: { label: "Preparing", tone: "neutral" },
  ready: { label: "Ready to apply", tone: "primary" },
  applied: { label: "Applied", tone: "primary" },
  screening: { label: "Screening", tone: "warning" },
  interviewing: { label: "Interviewing", tone: "warning" },
  offer: { label: "Offer", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  proposed: { label: "Proposed", tone: "neutral" },
  approved: { label: "With your specialist", tone: "primary" },
  waiting_on_client: { label: "Waiting on you", tone: "warning" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const BOARD_COLUMNS: ApplicationStatus[] = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
];
export const CLOSED_STATUSES: ApplicationStatus[] = ["rejected", "withdrawn"];

/** Statuses a client can move a card to themselves; Concierge steps move through their own flows. */
export const CLIENT_SELECTABLE_STATUSES: ApplicationStatus[] = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

/** The tracker's columns; Concierge clients also see what's with their specialist or waiting on them. */
export function boardColumns(concierge: boolean): ApplicationStatus[] {
  return concierge ? ["approved", "waiting_on_client", ...BOARD_COLUMNS] : BOARD_COLUMNS;
}
