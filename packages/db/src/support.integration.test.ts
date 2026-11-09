import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client";
import type * as DbModule from "./index";
import { ensureTestDatabase, testDatabaseUrl } from "./test-database";

const TEST_DATABASE_URL = testDatabaseUrl("db");

describe.skipIf(!TEST_DATABASE_URL)("customer care (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let database: Database;
  const riya = "user-riya";
  const ana = "agent-ana";
  const ada = "admin-ada";
  const priya = "specialist-priya";

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("./migrate-lib");
    await runMigrations();
    db = await import("./index");
    drizzle = await import("drizzle-orm");
    database = db.getDb();
  });

  beforeEach(async () => {
    await database.execute(drizzle.sql`TRUNCATE users, companies RESTART IDENTITY CASCADE`);
    await database.insert(db.users).values([
      { id: riya, name: "Riya", email: "riya@example.com" },
      { id: ana, name: "Ana", email: "ana@example.com", role: "support" },
      { id: ada, name: "Ada", email: "ada@example.com", role: "admin" },
      { id: priya, name: "Priya", email: "priya@example.com", role: "specialist" },
    ]);
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  type CaseInput = Parameters<typeof DbModule.createCase>[1];

  /** A signed-out help request from riya@example.com. */
  const helpInput = (overrides: Partial<CaseInput> = {}): CaseInput => ({
    kind: "help",
    source: "form",
    topic: "account",
    subject: "Can't sign in",
    body: "I never got the email.",
    userId: null,
    contactName: "Riya",
    contactEmail: "riya@example.com",
    raisedByUserId: null,
    verified: false,
    visibility: "public",
    authorKind: "user",
    authorUserId: null,
    ...overrides,
  });

  const caseRow = async (id: string) => {
    const [row] = await database
      .select()
      .from(db.supportCases)
      .where(drizzle.eq(db.supportCases.id, id));
    return row!;
  };

  const messageBodies = async (id: string, visibility: "public" | "internal") =>
    (
      await database
        .select({ body: db.supportMessages.body })
        .from(db.supportMessages)
        .where(
          drizzle.and(
            drizzle.eq(db.supportMessages.caseId, id),
            drizzle.eq(db.supportMessages.visibility, visibility),
          ),
        )
    ).map((row) => row.body);

  describe("cases", () => {
    it("creates a signed-in request as verified, with a link that opens it", async () => {
      const notice = await db.createCase(database, helpInput({ userId: riya, verified: true }));
      const [row] = await database
        .select()
        .from(db.supportCases)
        .where(drizzle.eq(db.supportCases.id, notice.caseId));
      expect(row).toMatchObject({ status: "open", kind: "help", number: 1001, userId: riya });
      expect(row!.verifiedAt).toBeInstanceOf(Date);
      expect(await db.caseForLink(database, notice.token)).toBe(notice.caseId);
    });

    it("links a signed-out request to the account by email, ignoring case and spaces, without verifying it", async () => {
      const accountId = await db.accountIdForEmail(database, "  RIYA@Example.com ");
      expect(accountId).toBe(riya);
      const notice = await db.createCase(
        database,
        helpInput({ userId: accountId, verified: false, contactEmail: " RIYA@Example.com " }),
      );
      const [row] = await database
        .select()
        .from(db.supportCases)
        .where(drizzle.eq(db.supportCases.id, notice.caseId));
      expect(row).toMatchObject({ contactEmail: "riya@example.com", verifiedAt: null });
    });

    it("lets only one agent take a case", async () => {
      const { caseId } = await db.createCase(database, helpInput());
      const results = await Promise.allSettled([
        db.takeCase(database, { caseId, agentId: ana }),
        db.takeCase(database, { caseId, agentId: ada }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "conflict" },
      });
    });

    it("waits on the user after an agent's reply, takes the case, and reopens when the user answers", async () => {
      const { caseId } = await db.createCase(database, helpInput({ userId: riya, verified: true }));
      await db.replyAsAgent(database, { caseId, agentId: ana, body: "Try the reset link." });
      expect(await caseRow(caseId)).toMatchObject({ status: "waiting_on_user", assigneeId: ana });
      const firstReply = (await caseRow(caseId)).firstRepliedAt;
      await db.replyAsRequester(database, { caseId, userId: riya, body: "Still stuck." });
      await db.replyAsAgent(database, { caseId, agentId: ada, body: "Fixed now." });
      expect(await caseRow(caseId)).toMatchObject({
        status: "waiting_on_user",
        assigneeId: ana,
        firstRepliedAt: firstReply,
      });
      await expect(
        db.replyAsAgent(database, { caseId, agentId: ana, body: "   " }),
      ).rejects.toMatchObject({ code: "not_allowed" });
    });

    it("refuses a hand-off to someone who isn't staff, or by an agent who doesn't own the case", async () => {
      const { caseId } = await db.createCase(database, helpInput());
      await db.takeCase(database, { caseId, agentId: ana });
      await expect(
        db.assignCase(database, { caseId, actorId: ana, actorIsAdmin: false, toAgentId: riya }),
      ).rejects.toMatchObject({ code: "not_allowed" });
      await expect(
        db.assignCase(database, { caseId, actorId: priya, actorIsAdmin: false, toAgentId: ada }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await db.assignCase(database, { caseId, actorId: ada, actorIsAdmin: true, toAgentId: ada });
      expect((await caseRow(caseId)).assigneeId).toBe(ada);
    });

    it("reopens on a reply within 14 days of solving, and refuses replies and links after that", async () => {
      const solvedAt = new Date("2026-11-01T00:00:00Z");
      const { caseId, token } = await db.createCase(
        database,
        helpInput({ userId: riya, verified: true, now: new Date("2026-10-30T00:00:00Z") }),
      );
      await db.solveCase(database, { caseId, agentId: ana, now: solvedAt });
      const day = (n: number) => new Date(solvedAt.getTime() + n * 86_400_000);
      expect(await db.caseForLink(database, token, day(15))).toBeNull();
      await expect(
        db.replyAsRequester(database, { caseId, userId: riya, body: "Hello?", now: day(15) }),
      ).rejects.toMatchObject({ code: "not_allowed" });
      await db.replyAsRequester(database, { caseId, userId: riya, body: "Hello?", now: day(13) });
      expect((await caseRow(caseId)).status).toBe("open");
    });

    it("solves cases left waiting on the user for 7 days, with a note", async () => {
      const start = new Date("2026-11-01T00:00:00Z");
      const { caseId } = await db.createCase(database, helpInput({ now: start }));
      await db.replyAsAgent(database, {
        caseId,
        agentId: ana,
        body: "Can you send a screenshot?",
        now: start,
      });
      expect(await db.autoSolveCases(database, new Date("2026-11-07T23:00:00Z"))).toHaveLength(0);
      const solved = await db.autoSolveCases(database, new Date("2026-11-08T00:00:00Z"));
      expect(solved.map((notice) => notice.caseId)).toEqual([caseId]);
      expect(await messageBodies(caseId, "internal")).toContain(
        "Solved automatically after 7 days without a reply.",
      );
    });

    it("refuses an empty subject or message, and cuts long ones to the limits", async () => {
      await expect(db.createCase(database, helpInput({ subject: "  " }))).rejects.toMatchObject({
        code: "not_allowed",
      });
      await expect(db.createCase(database, helpInput({ body: "" }))).rejects.toMatchObject({
        code: "not_allowed",
      });
      const long = await db.createCase(
        database,
        helpInput({ subject: "s".repeat(200), body: "b".repeat(6000) }),
      );
      expect((await caseRow(long.caseId)).subject).toHaveLength(120);
      expect((await messageBodies(long.caseId, "public"))[0]).toHaveLength(5000);
    });

    it("mints a fresh link for each notice, and every link opens the case", async () => {
      const created = await db.createCase(database, helpInput());
      const replied = await db.replyAsAgent(database, {
        caseId: created.caseId,
        agentId: ana,
        body: "On it.",
      });
      expect(replied.token).not.toBe(created.token);
      expect(await db.caseForLink(database, created.token)).toBe(created.caseId);
      expect(await db.caseForLink(database, replied.token)).toBe(created.caseId);
      expect(await db.caseForLink(database, "not-a-real-token")).toBeNull();
      const stored = await database.select().from(db.supportCaseLinks);
      expect(stored.map((link) => link.tokenHash)).not.toContain(created.token);
    });

    it("solves and reopens a case once, and refuses to do either twice", async () => {
      const { caseId } = await db.createCase(database, helpInput());
      await db.solveCase(database, { caseId, agentId: ana });
      await expect(db.solveCase(database, { caseId, agentId: ana })).rejects.toMatchObject({
        code: "conflict",
      });
      await db.reopenCase(database, { caseId, agentId: ana });
      expect(await caseRow(caseId)).toMatchObject({ status: "open", solvedAt: null });
      await expect(db.reopenCase(database, { caseId, agentId: ana })).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("keeps notes internal without changing the status, and verifies a case only once", async () => {
      const { caseId } = await db.createCase(database, helpInput({ userId: riya }));
      await db.addNote(database, { caseId, authorId: ana, body: "Their email has a typo." });
      await expect(
        db.addNote(database, { caseId, authorId: ana, body: "  " }),
      ).rejects.toMatchObject({ code: "not_allowed" });
      expect(await messageBodies(caseId, "internal")).toEqual(["Their email has a typo."]);
      expect((await caseRow(caseId)).status).toBe("open");
      const first = new Date("2026-11-02T00:00:00Z");
      await db.verifyCase(database, { caseId, now: first });
      await db.verifyCase(database, { caseId, now: new Date("2026-11-03T00:00:00Z") });
      expect((await caseRow(caseId)).verifiedAt).toEqual(first);
    });
  });
});
