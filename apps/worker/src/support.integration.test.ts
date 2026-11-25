import type * as DbModule from "@gettargetrole/db";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SupportModule from "./support";

const TEST_DATABASE_URL = testDatabaseUrl("worker");

describe.skipIf(!TEST_DATABASE_URL)("customer care jobs (Postgres integration)", () => {
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let support: typeof SupportModule;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    support = await import("./support");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE users, companies RESTART IDENTITY CASCADE`);
    await database.insert(db.users).values([
      { id: "client-1", name: "Riya", email: "riya@example.com" },
      { id: "agent-1", name: "Ana", email: "ana@example.com", role: "support" },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  /** A help case an agent answered on Nov 1, so it waits on the requester. */
  async function answeredCase(overrides: Partial<Parameters<typeof db.createCase>[1]> = {}) {
    const database = db.getDb();
    const start = new Date("2026-11-01T00:00:00Z");
    const notice = await db.createCase(database, {
      kind: "help",
      source: "form",
      topic: "account",
      subject: "Can't sign in",
      body: "I never got the email.",
      userId: "client-1",
      contactName: "Riya",
      contactEmail: "riya@example.com",
      raisedByUserId: "client-1",
      verified: true,
      visibility: "public",
      authorKind: "user",
      authorUserId: "client-1",
      now: start,
      ...overrides,
    });
    await db.replyAsAgent(database, {
      caseId: notice.caseId,
      agentId: "agent-1",
      body: "Try the reset link.",
      now: start,
    });
    return notice.caseId;
  }

  const statusOf = async (caseId: string) =>
    (
      await db
        .getDb()
        .select({ status: db.supportCases.status })
        .from(db.supportCases)
        .where(drizzle.eq(db.supportCases.id, caseId))
    )[0]?.status;

  it("solves cases left waiting a week and tells the requester in the app", async () => {
    await answeredCase();
    expect(await support.runAutoSolve(new Date("2026-11-08T01:00:00Z"))).toBe(1);
    const rows = await db.getDb().select().from(db.notifications);
    expect(rows).toEqual([
      expect.objectContaining({
        userId: "client-1",
        type: "support",
        title: "Request #1001 solved",
        link: expect.stringMatching(/^\/support\/requests\/.+/),
      }),
    ]);
    expect(await support.runAutoSolve(new Date("2026-11-08T02:00:00Z"))).toBe(0);
  });

  it("leaves a case alone before the week is up, and one the requester answered", async () => {
    const early = await answeredCase();
    expect(await support.runAutoSolve(new Date("2026-11-07T23:00:00Z"))).toBe(0);
    await db.replyAsRequester(db.getDb(), {
      caseId: early,
      userId: "client-1",
      body: "Here is the screenshot.",
      now: new Date("2026-11-07T23:30:00Z"),
    });
    expect(await support.runAutoSolve(new Date("2026-11-09T00:00:00Z"))).toBe(0);
    expect(await statusOf(early)).toBe("open");
  });

  it("solves a signed-out requester's case without an in-app notification", async () => {
    const caseId = await answeredCase({ userId: null, raisedByUserId: null, verified: false });
    expect(await support.runAutoSolve(new Date("2026-11-08T01:00:00Z"))).toBe(1);
    expect(await statusOf(caseId)).toBe("solved");
    expect(await db.getDb().select().from(db.notifications)).toEqual([]);
  });

  it("keeps a case solved when the email can't be sent", async () => {
    const caseId = await answeredCase();
    // Production without SMTP_URL is a configuration error, so the real mailer refuses.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_URL", "");
    // Precondition: the mailer really does fail under these settings, so this isn't a free pass.
    const { sendEmail } = await import("@gettargetrole/core/mailer");
    await expect(sendEmail({ to: "riya@example.com", subject: "x", text: "x" })).rejects.toThrow(
      "SMTP_URL is not configured",
    );
    expect(await support.runAutoSolve(new Date("2026-11-08T01:00:00Z"))).toBe(1);
    expect(await statusOf(caseId)).toBe("solved");
    // The in-app notification is written first, so the person still hears about it.
    expect(await db.getDb().select().from(db.notifications)).toHaveLength(1);
  });

  it("escalates a Concierge client who missed last week's target", async () => {
    const database = db.getDb();
    await database
      .update(db.users)
      .set({ plan: "concierge" })
      .where(drizzle.eq(db.users.id, "client-1"));
    await database
      .insert(db.specialistAssignments)
      .values({ specialistId: "agent-1", clientId: "client-1", createdAt: new Date("2026-10-01") });
    await database.insert(db.applications).values(
      Array.from({ length: 4 }, (_, i) => ({
        userId: "client-1",
        companyName: `Company ${i}`,
        jobTitle: "Engineer",
        status: "applied" as const,
        appliedAt: new Date("2026-11-04T12:00:00Z"),
      })),
    );
    const monday = new Date("2026-11-09T06:00:00Z");
    expect(await support.runConciergeWeeklyCheck(monday)).toEqual({ opened: 1, noted: 0 });
    expect(await support.runConciergeWeeklyCheck(monday)).toEqual({ opened: 0, noted: 0 });
    const [escalation] = await database.select().from(db.supportCases);
    expect(escalation).toMatchObject({
      kind: "escalation",
      source: "weekly_check",
      subject: "Missed weekly target: 4 of 15",
    });
  });
});
