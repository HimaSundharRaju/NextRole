import { MockProvider } from "@gettargetrole/ai";
import type * as DbModule from "@gettargetrole/db";
import { DEFAULT_RESUME_SETTINGS, emptyResume, type Resume } from "@gettargetrole/resume/schema";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as PrepareModule from "./prepare";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

class CountingProvider extends MockProvider {
  tailorCalls = 0;
  letterCalls = 0;
  failLetter = false;

  override async tailorResume(...args: Parameters<MockProvider["tailorResume"]>) {
    this.tailorCalls++;
    return super.tailorResume(...args);
  }

  override async writeCoverLetter(...args: Parameters<MockProvider["writeCoverLetter"]>) {
    this.letterCalls++;
    if (this.failLetter) throw new Error("The AI service is unavailable");
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

describe.skipIf(!TEST_DATABASE_URL)("auto-prepare (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let prepare: typeof PrepareModule;
  let jobIds: string[];
  let ai: CountingProvider;

  const userId = "user-p";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    prepare = await import("./prepare");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(
      drizzle.sql`TRUNCATE users, companies, notifications, ai_usage RESTART IDENTITY CASCADE`,
    );
    await database.insert(db.users).values({ id: userId, name: "Priya", email: "p@example.com" });
    await database.insert(db.profiles).values({
      userId,
      skills: ["go", "kubernetes", "postgresql"],
      targetTitles: ["Software Engineer"],
      autoPrepareEnabled: true,
      autoPrepareDailyLimit: 1,
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
    const inserted = await database
      .insert(db.jobs)
      .values(
        ["Senior Software Engineer, Payments", "Software Engineer, Ledger"].map((title, i) => ({
          companyId: company!.id,
          source: "greenhouse" as const,
          externalId: `job-${i}`,
          title,
          applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${i}`,
          descriptionText: "We build payments in Go on Kubernetes and PostgreSQL.",
          skills: ["go", "kubernetes", "postgresql"],
          contentHash: `hash-${i}`,
        })),
      )
      .returning({ id: db.jobs.id });
    jobIds = inserted.map((row) => row.id);
    ai = new CountingProvider();
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  async function applicationFor(jobId: string) {
    const [row] = await db
      .getDb()
      .select()
      .from(db.applications)
      .where(drizzle.eq(db.applications.jobId, jobId));
    return row;
  }

  it("tailors the main resume, writes a cover letter and marks the application ready", async () => {
    const outcome = await prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai);
    expect(outcome).toMatchObject({ status: "ready", tailored: true, wroteLetter: true });

    const application = await applicationFor(jobIds[0]!);
    expect(application).toMatchObject({ status: "ready", userId });
    expect(application?.coverLetter).toContain("Software Engineer, Payments");

    const database = db.getDb();
    const [primary] = await database
      .select()
      .from(db.resumes)
      .where(drizzle.eq(db.resumes.isPrimary, true));
    const [tailored] = await database
      .select()
      .from(db.resumes)
      .where(drizzle.eq(db.resumes.id, application!.resumeId!));
    expect(tailored).toMatchObject({ kind: "tailored", jobId: jobIds[0] });
    expect(tailored?.sourceHash).toBe(db.resumeHash(primary!.content));
    expect(tailored?.tailorNotes?.summaryOfChanges.length).toBeGreaterThan(0);

    const events = await database
      .select({ type: db.applicationEvents.type, data: db.applicationEvents.data })
      .from(db.applicationEvents)
      .where(drizzle.eq(db.applicationEvents.applicationId, application!.id));
    expect(events.map((event) => event.type).sort()).toEqual([
      "auto_prepared",
      "created",
      "kit_generated",
      "kit_generated",
    ]);
    expect(events.find((event) => event.type === "created")?.data).toEqual({
      source: "auto_prepare",
    });

    const [notification] = await database.select().from(db.notifications);
    expect(notification).toMatchObject({
      userId,
      type: "application_ready",
      link: `/jobs/${jobIds[0]}`,
    });

    // A second run finds it done and spends nothing.
    await expect(
      prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai),
    ).resolves.toEqual({ status: "skipped", reason: "already_handled" });
    expect({ tailor: ai.tailorCalls, letter: ai.letterCalls }).toEqual({ tailor: 1, letter: 1 });
  });

  it("reuses a tailored resume made from the same main resume", async () => {
    const database = db.getDb();
    const [primary] = await database.select().from(db.resumes);
    const existing = await db.saveTailoredResume({
      userId,
      jobId: jobIds[0]!,
      title: "Acme — Senior Software Engineer, Payments",
      content: primary!.content,
      settings: primary!.settings,
      sourceHash: db.resumeHash(primary!.content),
      notes: { summaryOfChanges: [], addedKeywords: [], missingKeywords: [], suggestions: [] },
      note: "Tailored",
    });

    const outcome = await prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai);
    expect(outcome).toMatchObject({ status: "ready", tailored: false });
    expect(ai.tailorCalls).toBe(0);
    expect((await applicationFor(jobIds[0]!))?.resumeId).toBe(existing.id);
  });

  it("stops at the daily limit without creating an application", async () => {
    await prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai);
    await expect(
      prepare.autoPrepare({ userId, jobId: jobIds[1]!, score: 85 }, ai),
    ).resolves.toEqual({ status: "skipped", reason: "daily_limit" });
    expect(await applicationFor(jobIds[1]!)).toBeUndefined();

    await db.getDb().update(db.profiles).set({ autoPrepareDailyLimit: 2 });
    await expect(
      prepare.autoPrepare({ userId, jobId: jobIds[1]!, score: 85 }, ai),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("takes one slot at a time when jobs run in parallel", async () => {
    const outcomes = await Promise.all(
      jobIds.map((jobId) => prepare.autoPrepare({ userId, jobId, score: 90 }, ai)),
    );
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["ready", "skipped"]);
  });

  it("skips when auto-prepare is off, the budget is nearly spent or there's no main resume", async () => {
    const database = db.getDb();
    const run = () => prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai);

    await database.update(db.profiles).set({ autoPrepareEnabled: false });
    await expect(run()).resolves.toEqual({ status: "skipped", reason: "disabled" });
    await database.update(db.profiles).set({ autoPrepareEnabled: true });

    // Free plan: $2 a month, and auto-prepare leaves the last 20% for the user.
    await database.insert(db.aiUsage).values({
      userId,
      feature: "tailor",
      model: "mock",
      costMicroUsd: 1_600_000,
    });
    await expect(run()).resolves.toEqual({ status: "skipped", reason: "budget" });
    await database.delete(db.aiUsage);

    await database.update(db.jobs).set({ closedAt: new Date() });
    await expect(run()).resolves.toEqual({ status: "skipped", reason: "job_closed" });
    await database.update(db.jobs).set({ closedAt: null });

    await database.delete(db.resumes);
    await expect(run()).resolves.toEqual({ status: "skipped", reason: "no_resume" });
    expect(ai.tailorCalls + ai.letterCalls).toBe(0);
  });

  it("leaves applications the user has moved past preparing alone", async () => {
    await db.getDb().insert(db.applications).values({
      userId,
      jobId: jobIds[0]!,
      companyName: "Acme",
      jobTitle: "Senior Software Engineer, Payments",
      status: "applied",
    });
    await expect(
      prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai),
    ).resolves.toEqual({ status: "skipped", reason: "already_handled" });
    expect((await applicationFor(jobIds[0]!))?.status).toBe("applied");
  });

  it("gives the slot back when the AI fails, and keeps the tailored resume for the retry", async () => {
    ai.failLetter = true;
    await expect(prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai)).rejects.toThrow(
      "unavailable",
    );
    expect(await applicationFor(jobIds[0]!)).toBeUndefined();
    const database = db.getDb();
    const events = await database.select().from(db.applicationEvents);
    expect(events).toHaveLength(0);

    ai.failLetter = false;
    await expect(
      prepare.autoPrepare({ userId, jobId: jobIds[0]!, score: 92 }, ai),
    ).resolves.toMatchObject({ status: "ready", tailored: false });
    expect(ai.tailorCalls).toBe(1);
  });
});
