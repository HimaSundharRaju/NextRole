import { createServer } from "node:http";
import { createLogger } from "@nextrole/core/logger";
import {
  JOB_NAMES,
  QUEUE_NAMES,
  syncDeduplicationId,
  type CreateJobAlertsJob,
  type SyncCompanyJob,
} from "@nextrole/core/queues";
import { queueConnection } from "@nextrole/core/redis";
import { closeDb } from "@nextrole/db";
import { createJobAlerts } from "@nextrole/jobs/alerts";
import { companiesDueForSync, syncCompany } from "@nextrole/jobs/ingest";
import { Queue, Worker, type Job } from "bullmq";
import { loadWorkerEnv } from "./env";
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

async function handleIngest(job: Job): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.enqueueDueSyncs: {
      const staleAfterMs = env.INGEST_INTERVAL_MINUTES * 60_000;
      const due = await companiesDueForSync(staleAfterMs);
      await ingestQueue.addBulk(
        due.map((companyId) => ({
          name: JOB_NAMES.syncCompany,
          data: { companyId, reason: "schedule" } satisfies SyncCompanyJob,
          opts: { deduplication: { id: syncDeduplicationId(companyId) } },
        })),
      );
      return { enqueued: due.length };
    }
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
    case JOB_NAMES.createJobAlerts:
      return { created: await createJobAlerts((job.data as CreateJobAlertsJob).jobIds) };
    case JOB_NAMES.followUpReminders:
      return { created: await createFollowUpReminders() };
    default:
      throw new Error(`Unknown notifications job: ${job.name}`);
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

for (const worker of [ingestWorker, notificationsWorker]) {
  worker.on("failed", (job, error) =>
    log.warn({ queue: worker.name, job: job?.name, jobId: job?.id, err: error }, "job failed"),
  );
  worker.on("error", (error) => log.error({ queue: worker.name, err: error }, "worker error"));
}

await ingestQueue.upsertJobScheduler(
  "ingest-schedule",
  { every: env.INGEST_INTERVAL_MINUTES * 60_000 },
  { name: JOB_NAMES.enqueueDueSyncs },
);
await notificationsQueue.upsertJobScheduler(
  "follow-up-schedule",
  { pattern: "0 */1 * * *" },
  { name: JOB_NAMES.followUpReminders },
);

const health = createServer((req, res) => {
  const healthy = ingestWorker.isRunning() && notificationsWorker.isRunning();
  res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: healthy ? "ok" : "degraded" }));
});
if (env.WORKER_HEALTH_PORT > 0) {
  health.listen(env.WORKER_HEALTH_PORT, () =>
    log.info({ port: env.WORKER_HEALTH_PORT }, "health endpoint listening"),
  );
}

log.info(
  { intervalMinutes: env.INGEST_INTERVAL_MINUTES, concurrency: env.INGEST_CONCURRENCY },
  "worker started",
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  health.close();
  await Promise.allSettled([ingestWorker.close(), notificationsWorker.close()]);
  await Promise.allSettled([ingestQueue.close(), notificationsQueue.close()]);
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
