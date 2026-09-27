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
  /** Scheduled, and after a user asks for a company: looks up pending company requests. */
  resolveCompanyRequests: "resolve-company-requests",
  /** Scheduled weekly: queues YC's hiring companies that aren't tracked yet. */
  importYcCompanies: "import-yc-companies",
  /** Scheduled daily: deletes jobs closed long ago that no application points to. */
  pruneClosedJobs: "prune-closed-jobs",
  /** Scheduled: sends posts that need enrichment to a batch API. */
  submitEnrichment: "submit-enrichment",
  /** Scheduled: reads finished enrichment batches into their posts. */
  pollEnrichment: "poll-enrichment",
  createJobAlerts: "create-job-alerts",
  /** Scheduled: reminds users about applications whose follow-up date has arrived. */
  followUpReminders: "follow-up-reminders",
  /** Prepares one application (tailored resume + cover letter) for a user who turned it on. */
  autoPrepare: "auto-prepare",
  /** Scheduled: sends queued auto-prepare AI work to the batch API (half price). */
  submitAiBatches: "submit-ai-batches",
  /** Scheduled: reads finished batches and marks their applications ready. */
  pollAiBatches: "poll-ai-batches",
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

/** One lookup of pending company requests at a time; a request made meanwhile joins it. */
export const RESOLVE_REQUESTS_DEDUPLICATION_ID = "resolve-company-requests";

export function autoPrepareDeduplicationId(userId: string, jobId: string): string {
  return `prep:${userId}:${jobId}`;
}
