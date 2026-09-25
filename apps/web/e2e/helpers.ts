import { expect, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import pg from "pg";

export const PASSWORD = "correct horse battery staple";

export function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Runs a statement against the app database (used to grant roles in tests). */
export async function sql(text: string, values: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://nextrole:nextrole@localhost:5432/nextrole",
  });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

/**
 * Clears the auth endpoints' per-IP rate-limit buckets. Every test signs up from the same
 * address, so without this the suite trips the real sign-up limit (10 per hour).
 */
export async function resetAuthRateLimits(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    const keys = await redis.keys("ba:rl:*");
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

export async function signUp(page: Page, name: string, email: string): Promise<void> {
  await resetAuthRateLimits();
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");
}

/** Signs up and completes onboarding by pasting a short resume. */
export async function signUpAndOnboard(page: Page, name: string, email: string): Promise<void> {
  await signUp(page, name, email);
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page
    .getByLabel("Resume text")
    .fill(
      `${name}\n${email}\nSenior Backend Engineer with 7 years building APIs in Python and Go on AWS and Kubernetes.`,
    );
  await page.getByRole("button", { name: "Import resume" }).click();
  await expect(page.getByText("Your resume is ready")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Target roles").fill("Backend Engineer");
  await page.getByLabel("Work authorization").fill("US citizen");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL("**/dashboard");
}
