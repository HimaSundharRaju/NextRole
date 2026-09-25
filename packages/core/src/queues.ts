/** Queue contracts shared by the web app (producer) and the worker (consumer). */

export const QUEUE_NAMES = {
  ingest: "ingest",
  notifications: "notifications",
} as const;

export const JOB_NAMES = {
  /** Scheduled: finds companies whose boards are due and enqueues a sync for each. */
  enqueueDueSyncs: "enqueue-due-syncs",
  syncCompany: "sync-company",
  createJobAlerts: "create-job-alerts",
  /** Scheduled: reminds users about applications whose follow-up date has arrived. */
  followUpReminders: "follow-up-reminders",
} as const;

export interface SyncCompanyJob {
  companyId: string;
  reason: "schedule" | "manual";
}

export interface CreateJobAlertsJob {
  jobIds: string[];
}

export function syncDeduplicationId(companyId: string): string {
  return `sync:${companyId}`;
}
