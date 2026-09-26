import { DEFAULT_RESUME_SETTINGS, emptyResume } from "@gettargetrole/resume/schema";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as DbModule from "./index";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("tailored resumes and metering (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let jobId: string;

  const userId = "user-t";
  const notes = {
    summaryOfChanges: ["Led with Go"],
    addedKeywords: [],
    missingKeywords: [],
    suggestions: [],
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("./migrate-lib");
    await runMigrations();
    db = await import("./index");
    drizzle = await import("drizzle-orm");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(
      drizzle.sql`TRUNCATE users, companies, ai_usage RESTART IDENTITY CASCADE`,
    );
    await database.insert(db.users).values({ id: userId, name: "Tara", email: "t@example.com" });
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    const [job] = await database
      .insert(db.jobs)
      .values({
        companyId: company!.id,
        source: "greenhouse",
        externalId: "1",
        title: "Engineer",
        applyUrl: "https://example.com/1",
        contentHash: "h",
      })
      .returning();
    jobId = job!.id;
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  it("finds the newest tailored resume made from the same main resume", async () => {
    const database = db.getDb();
    const [main] = await database
      .insert(db.resumes)
      .values({
        userId,
        title: "Main",
        content: { ...emptyResume(), summary: "Builds payment systems in Go." },
        settings: DEFAULT_RESUME_SETTINGS,
        isPrimary: true,
      })
      .returning();
    // Read back: jsonb reorders keys, and the hash must not care.
    const [stored] = await database
      .select()
      .from(db.resumes)
      .where(drizzle.eq(db.resumes.id, main!.id));
    const hash = db.resumeHash(stored!.content);
    expect(hash).toBe(db.resumeHash(main!.content));

    const save = (sourceHash: string, title: string) =>
      db.saveTailoredResume({
        userId,
        target: { jobId },
        title,
        content: stored!.content,
        settings: stored!.settings,
        sourceHash,
        notes,
        note: "Tailored",
      });
    await save(hash, "First");
    const newest = await save(hash, "Second");
    await save("older-main-resume", "From an older main resume");

    const found = await db.findTailoredResume(userId, { jobId }, hash);
    expect(found).toMatchObject({ id: newest.id, kind: "tailored", tailorNotes: notes });
    expect(await db.findTailoredResume(userId, { jobId }, "unknown")).toBeNull();
    expect(await db.findTailoredResume("someone-else", { jobId }, hash)).toBeNull();

    // A resume tailored to a pasted job description belongs to its application, not a job.
    const [application] = await database
      .insert(db.applications)
      .values({ userId, companyName: "Initech", jobTitle: "Engineer", jobDescription: "Go" })
      .returning();
    const pasted = await db.saveTailoredResume({
      userId,
      target: { applicationId: application!.id },
      title: "Initech — Engineer",
      content: stored!.content,
      settings: stored!.settings,
      sourceHash: hash,
      notes,
      note: "Tailored",
    });
    expect(pasted).toMatchObject({ jobId: null, applicationId: application!.id });
    expect(
      await db.findTailoredResume(userId, { applicationId: application!.id }, hash),
    ).toMatchObject({ id: pasted.id });
    expect((await db.findTailoredResume(userId, { jobId }, hash))?.id).toBe(newest.id);

    const revisions = await database
      .select()
      .from(db.resumeRevisions)
      .where(drizzle.eq(db.resumeRevisions.resumeId, newest.id));
    expect(revisions).toMatchObject([{ source: "ai_tailor", note: "Tailored" }]);
  });

  it("counts only this month's AI spend against the plan budget", async () => {
    const database = db.getDb();
    const lastMonth = new Date(db.startOfMonth().getTime() - 86_400_000);
    await database.insert(db.aiUsage).values([
      { userId, feature: "tailor", model: "m", costMicroUsd: 1_500_000, createdAt: lastMonth },
      { userId, feature: "tailor", model: "m", costMicroUsd: 300_000 },
    ]);
    expect(await db.monthlyAiSpendMicroUsd(userId)).toBe(300_000);
    expect(await db.hasAiBudget(userId, "free")).toBe(true);

    // Free's cap is $0.50.
    await db.recordAiUsage(userId, { feature: "studio", model: "m", costMicroUsd: 300_000 });
    expect(await db.hasAiBudget(userId, "free")).toBe(false);
    expect(await db.hasAiBudget(userId, "plus")).toBe(true);
  });

  it("counts this month's usage units per kind", async () => {
    const database = db.getDb();
    const lastMonth = new Date(db.startOfMonth().getTime() - 86_400_000);
    await database.insert(db.usageEvents).values([
      { userId, unit: "tailor", createdAt: lastMonth },
      { userId, unit: "tailor" },
      { userId, unit: "letter" },
    ]);
    await db.recordUsageEvent(userId, "tailor", "job-1");

    const usage = await db.monthlyUsage(userId);
    expect(usage).toMatchObject({ tailor: 2, letter: 1, studio: 0, auto: 0 });
    expect(Object.keys(usage)).toEqual([...db.USAGE_UNITS]);
    expect(await db.monthlyUnits(userId, "tailor")).toBe(2);
    expect(await db.monthlyUnits("someone-else", "tailor")).toBe(0);
  });
});
