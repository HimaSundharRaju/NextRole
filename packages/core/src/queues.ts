/** Queue contracts shared by the web app (producer) and the worker (consumer). */

export const QUEUE_NAMES = {
  ingest: "ingest",
  notifications: "notifications",
  /** Tailored resumes and cover letters for auto-prepare; AI calls are slow, so they wait here. */
  autoPrepare: "auto-prepare",
} as const;

export const JOB_NAMES = {
  /** Scheduled: finds companies whose boards are due and enqueues a sync for each. */
  enqueueDueSyncs: "enqueue-due-syncs",
  syncCompany: "sync-company",
  createJobAlerts: "create-job-alerts",
  /** Scheduled: reminds users about applications whose follow-up date has arrived. */
  followUpReminders: "follow-up-reminders",
  /** Prepares one application (tailored resume + cover letter) for a user who turned it on. */
  autoPrepare: "auto-prepare",
} as const;

export interface SyncCompanyJob {
  companyId: string;
  reason: "schedule" | "manual";
}

export interface CreateJobAlertsJob {
  jobIds: string[];
}

export interface AutoPrepareJob {
  userId: string;
  jobId: string;
  /** Match score when the job was found. */
  score: number;
}

export function syncDeduplicationId(companyId: string): string {
  return `sync:${companyId}`;
}

export function autoPrepareDeduplicationId(userId: string, jobId: string): string {
  return `prep:${userId}:${jobId}`;
}
