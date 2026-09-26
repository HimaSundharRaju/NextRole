import "server-only";
import {
  JOB_NAMES,
  QUEUE_NAMES,
  RESOLVE_REQUESTS_DEDUPLICATION_ID,
  syncDeduplicationId,
  type SyncCompanyJob,
} from "@gettargetrole/core/queues";
import { queueConnection } from "@gettargetrole/core/redis";
import { Queue } from "bullmq";

let ingestQueue: Queue | undefined;

function getIngestQueue(): Queue {
  ingestQueue ??= new Queue(QUEUE_NAMES.ingest, { connection: queueConnection() });
  return ingestQueue;
}

export async function enqueueCompanySync(companyId: string): Promise<void> {
  await getIngestQueue().add(
    JOB_NAMES.syncCompany,
    { companyId, reason: "manual" } satisfies SyncCompanyJob,
    {
      deduplication: { id: syncDeduplicationId(companyId) },
      attempts: 2,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 24 * 3600 },
    },
  );
}

/** Looks up pending company requests now, rather than at the next scheduled run. */
export async function enqueueCompanyRequests(): Promise<void> {
  await getIngestQueue().add(
    JOB_NAMES.resolveCompanyRequests,
    {},
    {
      deduplication: { id: RESOLVE_REQUESTS_DEDUPLICATION_ID },
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 24 * 3600 },
    },
  );
}
