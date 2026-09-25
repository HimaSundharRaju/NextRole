import { z } from "zod";

/**
 * Environment variables are validated lazily (on first use) instead of at import time, so
 * `next build` and unit tests can import server modules without a full production env.
 */

const base64Key32 = z.string().refine((value) => Buffer.from(value, "base64").length === 32, {
  message: "must be 32 random bytes, base64-encoded (openssl rand -base64 32)",
});

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    // PEM of the CA that signs the database server certificate (e.g. Supabase's own CA).
    DATABASE_CA_CERT: z.string().optional(),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    BETTER_AUTH_URL: z.url().optional(),
    // Comma-separated IPs/CIDR ranges of the reverse proxies in front of the app. Needed when
    // requests pass through more than one proxy hop, so rate limits key on the real client IP.
    TRUSTED_PROXIES: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ENCRYPTION_KEY: base64Key32,
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    LINKEDIN_CLIENT_ID: z.string().optional(),
    LINKEDIN_CLIENT_SECRET: z.string().optional(),

    AI_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
    AI_MODEL: z.string().min(1).default("claude-opus-5"),
    ANTHROPIC_API_KEY: z.string().optional(),

    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default("GetTargetRole <no-reply@gettargetrole.app>"),

    INGEST_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.AI_PROVIDER === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "the mock AI provider is for tests only and cannot run in production",
      });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached env so the next call re-reads process.env. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
