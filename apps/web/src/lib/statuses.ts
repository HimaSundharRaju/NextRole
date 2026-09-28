import type { ApplicationStatus } from "@gettargetrole/db/schema";

export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: "neutral" | "primary" | "success" | "warning" | "danger" }
> = {
  saved: { label: "Saved", tone: "neutral" },
  preparing: { label: "Preparing", tone: "neutral" },
  applied: { label: "Applied", tone: "primary" },
  screening: { label: "Screening", tone: "warning" },
  interviewing: { label: "Interviewing", tone: "warning" },
  offer: { label: "Offer", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const BOARD_COLUMNS: ApplicationStatus[] = [
  "saved",
  "preparing",
  "applied",
  "screening",
  "interviewing",
  "offer",
];
export const CLOSED_STATUSES: ApplicationStatus[] = ["rejected", "withdrawn"];
