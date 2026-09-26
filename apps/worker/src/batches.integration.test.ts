import {
  MockProvider,
  type AiBatches,
  type BatchEntry,
  type BatchFeature,
  type BatchResult,
  type BatchTask,
} from "@gettargetrole/ai";
import type * as DbModule from "@gettargetrole/db";
import { DEFAULT_RESUME_SETTINGS, emptyResume, type Resume } from "@gettargetrole/resume/schema";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as BatchesModule from "./batches";
import type * as PrepareModule from "./prepare";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** A batch API in memory: results come from the mock provider unless a feature is set to fail. */
class FakeBatches implements AiBatches {
  readonly sent: BatchEntry[][] = [];
  readonly finished = new Set<string>();
  failing = new Map<BatchFeature, BatchResult>();
  batchable = new Set<BatchFeature>(["tailor", "cover_letter"]);
  /** Makes sending a batch fail, as in an outage. */
  down = false;
  private readonly mock = new MockProvider();

  supports(feature: BatchFeature): boolean {
    return this.batchable.has(feature);
  }

  async submit(entries: BatchEntry[]): Promise<string> {
    if (this.down) throw new Error("The AI service is unavailable");
    this.sent.push(entries);
    return `batch_${this.sent.length}`;
  }

  async isDone(batchId: string): Promise<boolean> {
    return this.finished.has(batchId);
  }

  async *results(
    batchId: string,
    entryFor: Parameters<AiBatches["results"]>[1],
  ): AsyncGenerator<{ id: string; result: BatchResult }> {
    for (const entry of this.sent[Number(batchId.split("_")[1]) - 1] ?? []) {
      const known = entryFor(entry.id);
      if (!known) continue;
      await known.ctx.onUsage?.({
        feature: entry.task.feature,
        model: "claude-sonnet-5",
        inputTokens: 2000,
        outputTokens: 800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costMicroUsd: 6000,
        batch: true,
      });
      yield { id: entry.id, result: await this.run(entry.task) };
    }
  }

  private async run(task: BatchTask): Promise<BatchResult> {
    const failure = this.failing.get(task.feature);
    if (failure) return failure;
    const ctx = { userId: null };
    const output =
      task.feature === "tailor"
        ? await this.mock.tailorResume(task.input, ctx)
        : await this.mock.writeCoverLetter(task.input, ctx);
    return { status: "succeeded", output };
  }

  /** Ends every batch sent so far. */
  finishAll(): void {
    this.sent.forEach((_, index) => this.finished.add(`batch_${index + 1}`));
  }
}

class CountingProvider extends MockProvider {
  calls = 0;

  override async tailorResume(...args: Parameters<MockProvider["tailorResume"]>) {
    this.calls++;
    return super.tailorResume(...args);
  }

  override async writeCoverLetter(...args: Parameters<MockProvider["writeCoverLetter"]>) {
    this.calls++;
    return super.writeCoverLetter(...args);
  }
}

function mainResume(): Resume {
  return {
    ...emptyResume(),
    basics: {
      name: "Priya Shah",
      headline: "Backend Engineer",
      email: "priya@example.com",
      phone: "",
      location: "Austin, TX",
      links: [],
    },
    summary: "Backend engineer who builds payment systems in Go.",
    experience: [
      {
        company: "Ledgerly",
        title: "Software Engineer",
        location: "Austin, TX",
        startDate: "Jan 2021",
        endDate: "Present",
        highlights: ["Cut settlement time by 40% by moving batch jobs to Go services"],
      },
    ],
    skills: [{ name: "Languages & data", items: ["Go", "PostgreSQL", "Kubernetes"] }],
  };
}

describe.skipIf(!TEST_DATABASE_URL)("auto-prepare batches (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let prepare: typeof PrepareModule;
  let batchJobs: typeof BatchesModule;
  let jobId: string;
  let ai: CountingProvider;
  let batches: FakeBatches;

  const userId = "user-b";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    prepare = await import("./prepare");
    batchJobs = await import("./batches");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(
      drizzle.sql`TRUNCATE users, companies, notifications, ai_usage RESTART IDENTITY CASCADE`,
    );
    await database
      .insert(db.users)
      .values({ id: userId, name: "Priya", email: "b@example.com", plan: "pro" });
    await database.insert(db.profiles).values({
      userId,
      skills: ["go", "kubernetes", "postgresql"],
      targetTitles: ["Software Engineer"],
      autoPrepareEnabled: true,
      autoPrepareDailyLimit: 3,
    });
    await database.insert(db.resumes).values({
      userId,
      title: "Main resume",
      content: mainResume(),
      settings: DEFAULT_RESUME_SETTINGS,
      isPrimary: true,
    });
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    const [job] = await database
      .insert(db.jobs)
      .values({
        companyId: company!.id,
        source: "greenhouse",
        externalId: "job-1",
        title: "Senior Software Engineer, Payments",
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        descriptionText: "We build payments in Go on Kubernetes and PostgreSQL.",
        skills: ["go", "kubernetes", "postgresql"],
        contentHash: "hash-1",
      })
      .returning({ id: db.jobs.id });
    jobId = job!.id;
    ai = new CountingProvider();
    batches = new FakeBatches();
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  const run = () => prepare.autoPrepare({ userId, jobId, score: 91 }, ai, { batches });

  async function application() {
    const [row] = await db
      .getDb()
      .select()
      .from(db.applications)
      .where(drizzle.eq(db.applications.jobId, jobId));
    return row;
  }

  const requests = () => db.getDb().select().from(db.aiBatchRequests);

  it("queues the work, sends it in one batch and marks the application ready at half price", async () => {
    expect(await run()).toMatchObject({ status: "queued", tailor: true, letter: true });
    expect(ai.calls).toBe(0);
    expect(await application()).toMatchObject({ status: "preparing", resumeId: null });
    expect((await requests()).map((row) => row.status)).toEqual(["queued", "queued"]);

    // Queued once: a second run for the same job doesn't take another slot.
    await expect(run()).resolves.toEqual({ status: "skipped", reason: "already_handled" });

    expect(await batchJobs.submitAiBatches(batches)).toEqual({ submitted: 2, batchId: "batch_1" });
    expect(batches.sent[0]!.map((entry) => entry.task.feature).sort()).toEqual([
      "cover_letter",
      "tailor",
    ]);
    // Nothing waiting any more, so nothing is sent again.
    expect(await batchJobs.submitAiBatches(batches)).toEqual({ submitted: 0, batchId: null });

    // Still running.
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ read: 0, ready: 0 });
    expect(await application()).toMatchObject({ status: "preparing" });

    batches.finishAll();
    expect(await batchJobs.pollAiBatches(batches)).toEqual({
      read: 2,
      ready: 1,
      not_ready: 0,
      released: 0,
    });
    const ready = await application();
    expect(ready).toMatchObject({ status: "ready" });
    expect(ready?.coverLetter).toContain("Senior Software Engineer, Payments");
    const database = db.getDb();
    const [tailored] = await database
      .select()
      .from(db.resumes)
      .where(drizzle.eq(db.resumes.id, ready!.resumeId!));
    expect(tailored).toMatchObject({ kind: "tailored", jobId });
    expect(tailored?.sourceHash).toBe(db.resumeHash(mainResume()));

    const usage = await database.select().from(db.aiUsage);
    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.batch && row.userId === userId)).toBe(true);
    expect(await db.monthlyUnits(userId, "auto")).toBe(1);
    const [notification] = await database.select().from(db.notifications);
    expect(notification).toMatchObject({ type: "application_ready", link: `/jobs/${jobId}` });
    expect(await requests()).toEqual([]);
  });

  it("retries a failed entry once, then gives the slot back and keeps the tailored resume", async () => {
    batches.failing.set("cover_letter", {
      status: "failed",
      error: "Overloaded",
      retryable: true,
    });
    await run();
    await batchJobs.submitAiBatches(batches);
    batches.finishAll();
    await batchJobs.pollAiBatches(batches);
    // The resume is done; the letter goes into the next batch.
    const afterFirst = await requests();
    expect(afterFirst.find((row) => row.feature === "tailor")?.status).toBe("succeeded");
    expect(afterFirst.find((row) => row.feature === "cover_letter")).toMatchObject({
      status: "queued",
      attempts: 1,
      batchId: null,
    });

    expect(await batchJobs.submitAiBatches(batches)).toMatchObject({ submitted: 1 });
    batches.finishAll();
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ read: 1, released: 1 });

    // The application auto-prepare created is gone and its slot is free again.
    expect(await application()).toBeUndefined();
    expect(await db.monthlyUnits(userId, "auto")).toBe(0);
    expect(await db.getDb().select().from(db.notifications)).toEqual([]);
    // The tailored resume was paid for; the next tailor for this job reuses it.
    const kept = await db.findTailoredResume(userId, { jobId }, db.resumeHash(mainResume()));
    expect(kept).toMatchObject({ kind: "tailored" });
    expect(await requests()).toEqual([]);
  });

  it("gives up at once on a request the API rejects", async () => {
    batches.failing.set("tailor", {
      status: "failed",
      error: "invalid request",
      retryable: false,
    });
    await run();
    await batchJobs.submitAiBatches(batches);
    batches.finishAll();
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ read: 2, released: 1 });
    expect(await application()).toBeUndefined();
  });

  it("queues only the letter when a tailored resume already exists, attaching it now", async () => {
    const existing = await db.saveTailoredResume({
      userId,
      target: { jobId },
      title: "Acme — Senior Software Engineer, Payments",
      content: mainResume(),
      settings: DEFAULT_RESUME_SETTINGS,
      sourceHash: db.resumeHash(mainResume()),
      notes: { summaryOfChanges: [], addedKeywords: [], missingKeywords: [], suggestions: [] },
      note: "Tailored",
    });
    expect(await run()).toMatchObject({ status: "queued", tailor: false, letter: true });
    expect((await application())?.resumeId).toBe(existing.id);
    await batchJobs.submitAiBatches(batches);
    batches.finishAll();
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ ready: 1 });
    expect(await application()).toMatchObject({ status: "ready", resumeId: existing.id });
  });

  it("leaves an application the user moved along, but still counts the work", async () => {
    await run();
    await batchJobs.submitAiBatches(batches);
    const current = await application();
    await db
      .getDb()
      .update(db.applications)
      .set({ status: "applied" })
      .where(drizzle.eq(db.applications.id, current!.id));
    batches.finishAll();
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ read: 2, not_ready: 1 });
    expect(await application()).toMatchObject({ status: "applied", resumeId: null });
    expect(await db.monthlyUnits(userId, "auto")).toBe(1);
    expect(await db.getDb().select().from(db.notifications)).toEqual([]);
  });

  it("meters each result once when two workers read the same batch", async () => {
    await run();
    await batchJobs.submitAiBatches(batches);
    batches.finishAll();
    const [first, second] = await Promise.all([
      batchJobs.pollAiBatches(batches),
      batchJobs.pollAiBatches(batches),
    ]);
    expect(first.read + second.read).toBe(2);
    expect(first.ready + second.ready).toBe(1);
    expect(await db.getDb().select().from(db.aiUsage)).toHaveLength(2);
    expect(await db.monthlyUnits(userId, "auto")).toBe(1);
  });

  it("runs work that can't be sent in a batch as live calls after half an hour", async () => {
    batches.down = true;
    await run();
    await expect(batchJobs.submitAiBatches(batches)).rejects.toThrow("unavailable");
    expect((await requests()).map((row) => row.status)).toEqual(["queued", "queued"]);

    // Too soon: batches may still get through.
    expect(await batchJobs.runStaleRequests(ai)).toBe(0);
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await batchJobs.runStaleRequests(ai, undefined, { now: later })).toBe(2);
    expect(ai.calls).toBe(2);
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ ready: 1 });
    expect(await application()).toMatchObject({ status: "ready" });
    // Live calls cost full price.
    const usage = await db.getDb().select().from(db.aiUsage);
    expect(usage).toHaveLength(2);
    expect(usage.some((row) => row.batch)).toBe(false);
  });

  it("puts back work whose live call never finished", async () => {
    await run();
    // A worker claimed both entries for live calls and stopped half an hour ago.
    await db.getDb().execute(
      drizzle.sql`update ai_batch_requests set status = 'submitted', batch_id = 'live',
        updated_at = now() - interval '31 minutes'`,
    );
    expect(await batchJobs.runStaleRequests(ai)).toBe(0);
    expect((await requests()).map((row) => [row.status, row.batchId])).toEqual([
      ["queued", null],
      ["queued", null],
    ]);
    expect(await batchJobs.submitAiBatches(batches)).toMatchObject({ submitted: 2 });
  });

  it("runs queued work straight away once batching is turned off", async () => {
    await run();
    expect(await batchJobs.runStaleRequests(ai, undefined, { staleAfterMs: 0 })).toBe(2);
    expect(await batchJobs.pollAiBatches(batches)).toMatchObject({ ready: 1 });
    expect(batches.sent).toEqual([]);
  });

  it("calls the AI right away for a feature that can't be batched", async () => {
    batches.batchable.delete("tailor");
    expect(await run()).toMatchObject({ status: "ready", tailored: true, wroteLetter: true });
    expect(ai.calls).toBe(2);
    expect(await requests()).toEqual([]);
  });
});
