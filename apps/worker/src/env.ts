import { z } from "zod";

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  INGEST_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(10),
  INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).default(8081),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid worker configuration: ${problems}`);
  }
  return parsed.data;
}
