import { createServer } from "node:http";
import { enrichmentBatches, getAi, getAiBatches } from "@gettargetrole/ai";
import { createLogger } from "@gettargetrole/core/logger";
import {
  autoPrepareDeduplicationId,
  JOB_NAMES,
  QUEUE_NAMES,
  syncDeduplicationId,
  type AutoPrepareJob,
  type CreateJobAlertsJob,
  type SyncCompanyJob,
} from "@gettargetrole/core/queues";
import { queueConnection } from "@gettargetrole/core/redis";
import { closeDb } from "@gettargetrole/db";
import { autoPrepareCandidates, createJobAlerts } from "@gettargetrole/jobs/alerts";
import { importYcCompanies, resolveCompanyRequests } from "@gettargetrole/jobs/companies";
import { ensureFeedSources } from "@gettargetrole/jobs/feeds";
import { expireJobs, scoreGhostJobs } from "@gettargetrole/jobs/ghosts";
import { companiesDueForSync, pruneClosedJobs, syncCompany } from "@gettargetrole/jobs/ingest";
import { Queue, Worker, type Job } from "bullmq";
import { pollAiBatches, runStaleRequests, submitAiBatches } from "./batches";
import { pollEnrichmentBatches, submitEnrichmentBatch } from "./enrichment";
import { aiConfigured, loadWorkerEnv } from "./env";
import { autoPrepare } from "./prepare";
import { createFollowUpReminders } from "./reminders";

const log = createLogger("worker");
const env = loadWorkerEnv();
const connection = queueConnection();

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const ingestQueue = new Queue(QUEUE_NAMES.ingest, { connection, defaultJobOptions });
const notificationsQueue = new Queue(QUEUE_NAMES.notifications, { connection, defaultJobOptions });
const autoPrepareQueue = new Queue(QUEUE_NAMES.autoPrepare, {
  connection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
});

const autoPrepareOn = aiConfigured(env);
if (!autoPrepareOn) log.warn("auto-prepare is off: the worker has no AI key (ANTHROPIC_API_KEY)");
// Auto-prepare's AI work goes through the batch API at half price, unless AI_BATCH=off. Batches
// already sent are still read when it's off.
const batches = autoPrepareOn ? getAiBatches() : null;
const batching = batches !== null && env.AI_BATCH === "on";
// Job enrichment runs on GPT-4o-mini batches when OpenAI is configured (ENRICH_JOBS=off stops it).
const enrichment = enrichmentBatches();
const enrichmentOptions = enrichment && {
  ...enrichment,
  dailyBudgetUsd: env.ENRICH_DAILY_BUDGET_USD,
};

/** Queues auto-prepare for users whose settings match the new jobs, strongest matches first. */
async function enqueueAutoPrepare(jobIds: string[]): Promise<number> {
  const candidates = await autoPrepareCandidates(jobIds);
  await autoPrepareQueue.addBulk(
    candidates.map(({ userId, jobId, score }) => ({
      name: JOB_NAMES.autoPrepare,
      data: { userId, jobId, score } satisfies AutoPrepareJob,
      opts: {
        deduplication: { id: autoPrepareDeduplicationId(userId, jobId) },
        // Lower runs first, so a user's daily limit goes to their best matches.
        priority: 101 - score,
      },
    })),
  );
  return candidates.length;
}

async function enqueueSyncs(companyIds: string[], reason: SyncCompanyJob["reason"]) {
  await ingestQueue.addBulk(
    companyIds.map((companyId) => ({
      name: JOB_NAMES.syncCompany,
      data: { companyId, reason } satisfies SyncCompanyJob,
      opts: { deduplication: { id: syncDeduplicationId(companyId) } },
    })),
  );
}

async function handleIngest(job: Job): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.enqueueDueSyncs: {
      const staleAfterMs = env.INGEST_INTERVAL_MINUTES * 60_000;
      const due = await companiesDueForSync(staleAfterMs);
      await enqueueSyncs(due, "schedule");
      return { enqueued: due.length };
    }
    case JOB_NAMES.resolveCompanyRequests: {
      const { resolved, added } = await resolveCompanyRequests();
      // Boards just found get their first sync now rather than at the next schedule.
      await enqueueSyncs(added, "manual");
      return { resolved, added: added.length };
    }
    case JOB_NAMES.importYcCompanies: {
      const queued = await importYcCompanies();
      return { queued };
    }
    case JOB_NAMES.pruneClosedJobs:
      return { deleted: await pruneClosedJobs() };
    case JOB_NAMES.checkJobHealth:
      // Every job ages, including those on boards that haven't synced today.
      return { expired: await expireJobs(), rescored: await scoreGhostJobs() };
    case JOB_NAMES.submitEnrichment:
      return { submitted: enrichmentOptions ? await submitEnrichmentBatch(enrichmentOptions) : 0 };
    case JOB_NAMES.pollEnrichment:
      return { enriched: enrichmentOptions ? await pollEnrichmentBatches(enrichmentOptions) : 0 };
    case JOB_NAMES.syncCompany: {
      const { companyId } = job.data as SyncCompanyJob;
      const result = await syncCompany(companyId);
      if (result.newJobIds.length > 0) {
        await notificationsQueue.add(JOB_NAMES.createJobAlerts, {
          jobIds: result.newJobIds,
        } satisfies CreateJobAlertsJob);
      }
      return { fetched: result.fetched, new: result.newJobIds.length, closed: result.closed };
    }
    default:
      throw new Error(`Unknown ingest job: ${job.name}`);
  }
}

async function handleNotifications(job: Job): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.createJobAlerts: {
      const { jobIds } = job.data as CreateJobAlertsJob;
      const created = await createJobAlerts(jobIds);
      return { created, autoPrepare: autoPrepareOn ? await enqueueAutoPrepare(jobIds) : 0 };
    }
    case JOB_NAMES.followUpReminders:
      return { created: await createFollowUpReminders() };
    default:
      throw new Error(`Unknown notifications job: ${job.name}`);
  }
}

async function handleAutoPrepare(job: Job): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.autoPrepare:
      return autoPrepare(job.data as AutoPrepareJob, getAi(), {
        batches: batching ? batches : null,
      });
    case JOB_NAMES.submitAiBatches:
      return batching && batches ? submitAiBatches(batches) : { submitted: 0 };
    case JOB_NAMES.pollAiBatches: {
      if (!batches) return { read: 0 };
      // Queued work that can't go out in a batch runs as live calls; the poll then finishes
      // those applications along with the batched ones.
      const live = await runStaleRequests(getAi(), undefined, {
        staleAfterMs: batching ? undefined : 0,
      });
      return { live, ...(await pollAiBatches(batches)) };
    }
    default:
      throw new Error(`Unknown auto-prepare job: ${job.name}`);
  }
}

const ingestWorker = new Worker(QUEUE_NAMES.ingest, handleIngest, {
  connection,
  concurrency: env.INGEST_CONCURRENCY,
  // Be a polite crawler: cap board fetches across all worker replicas.
  limiter: { max: 20, duration: 60_000 },
});

const notificationsWorker = new Worker(QUEUE_NAMES.notifications, handleNotifications, {
  connection,
  concurrency: 2,
});

const autoPrepareWorker = new Worker(QUEUE_NAMES.autoPrepare, handleAutoPrepare, {
  connection,
  concurrency: 2,
  // Keeps background AI calls well inside the API rate limits across worker replicas.
  limiter: { max: 30, duration: 60_000 },
});

const workers = [ingestWorker, notificationsWorker, autoPrepareWorker];
for (const worker of workers) {
  worker.on("failed", (job, error) =>
    log.warn({ queue: worker.name, job: job?.name, jobId: job?.id, err: error }, "job failed"),
  );
  worker.on("error", (error) => log.error({ queue: worker.name, err: error }, "worker error"));
}

// Feeds whose keys were just set get their first sync now; ones whose keys went are closed.
await enqueueSyncs(await ensureFeedSources(), "manual");
await ingestQueue.upsertJobScheduler(
  "ingest-schedule",
  { every: env.INGEST_INTERVAL_MINUTES * 60_000 },
  { name: JOB_NAMES.enqueueDueSyncs },
);
await ingestQueue.upsertJobScheduler(
  "company-requests-schedule",
  { every: 10 * 60_000 },
  // Runs that overlap are safe: each request is claimed by one run.
  { name: JOB_NAMES.resolveCompanyRequests },
);
await ingestQueue.upsertJobScheduler(
  "prune-schedule",
  // Daily at 04:00 UTC.
  { pattern: "0 4 * * *" },
  { name: JOB_NAMES.pruneClosedJobs },
);
await ingestQueue.upsertJobScheduler(
  "job-health-schedule",
  // Daily at 04:30 UTC.
  { pattern: "30 4 * * *" },
  { name: JOB_NAMES.checkJobHealth },
);
if (enrichmentOptions) {
  await ingestQueue.upsertJobScheduler(
    "enrichment-submit-schedule",
    { every: 15 * 60_000 },
    { name: JOB_NAMES.submitEnrichment },
  );
  await ingestQueue.upsertJobScheduler(
    "enrichment-poll-schedule",
    { every: 5 * 60_000 },
    { name: JOB_NAMES.pollEnrichment },
  );
} else {
  await ingestQueue.removeJobScheduler("enrichment-submit-schedule");
  await ingestQueue.removeJobScheduler("enrichment-poll-schedule");
}
await ingestQueue.upsertJobScheduler(
  "yc-import-schedule",
  // Mondays at 05:00 UTC.
  { pattern: "0 5 * * 1" },
  { name: JOB_NAMES.importYcCompanies },
);
await notificationsQueue.upsertJobScheduler(
  "follow-up-schedule",
  { pattern: "0 */1 * * *" },
  { name: JOB_NAMES.followUpReminders },
);
if (batching) {
  await autoPrepareQueue.upsertJobScheduler(
    "submit-ai-batches",
    { every: 2 * 60_000 },
    { name: JOB_NAMES.submitAiBatches },
  );
} else {
  await autoPrepareQueue.removeJobScheduler("submit-ai-batches");
}
if (batches) {
  await autoPrepareQueue.upsertJobScheduler(
    "poll-ai-batches",
    { every: 5 * 60_000 },
    { name: JOB_NAMES.pollAiBatches },
  );
} else {
  await autoPrepareQueue.removeJobScheduler("poll-ai-batches");
}

const health = createServer((req, res) => {
  const healthy = workers.every((worker) => worker.isRunning());
  res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: healthy ? "ok" : "degraded" }));
});
if (env.WORKER_HEALTH_PORT > 0) {
  health.listen(env.WORKER_HEALTH_PORT, () =>
    log.info({ port: env.WORKER_HEALTH_PORT }, "health endpoint listening"),
  );
}

log.info(
  {
    intervalMinutes: env.INGEST_INTERVAL_MINUTES,
    concurrency: env.INGEST_CONCURRENCY,
    autoPrepare: autoPrepareOn,
    batches: batching,
    enrichment: enrichment?.model ?? "off",
  },
  "worker started",
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  health.close();
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await Promise.allSettled([
    ingestQueue.close(),
    notificationsQueue.close(),
    autoPrepareQueue.close(),
  ]);
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
