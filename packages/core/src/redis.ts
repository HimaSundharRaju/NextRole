import { Redis } from "ioredis";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      // Fail fast on request paths instead of queueing commands forever while Redis is down.
      maxRetriesPerRequest: 2,
      enableAutoPipelining: true,
      lazyConnect: false,
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

/** Connection options for BullMQ, which needs `maxRetriesPerRequest: null` for blocking commands. */
export function queueConnection(): { url: string; maxRetriesPerRequest: null } {
  return { url: process.env.REDIS_URL ?? "redis://localhost:6379", maxRetriesPerRequest: null };
}
