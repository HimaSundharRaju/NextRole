import { DEFAULT_RESUME_SETTINGS, emptyResume } from "@gettargetrole/resume/schema";
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

  /** A specialist's escalation about riya, with an internal note from priya. */
  const escalationInput = (overrides: Partial<CaseInput> = {}): CaseInput => ({
    kind: "escalation",
    source: "specialist",
    topic: "concierge",
    subject: "Escalation from Priya",
    body: "Client says nothing has been submitted for two weeks.",
    userId: riya,
    contactName: "Riya",
    contactEmail: "riya@example.com",
    raisedByUserId: priya,
    specialistId: priya,
    verified: false,
    visibility: "internal",
    authorKind: "agent",
    authorUserId: priya,
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

  describe("queues and threads", () => {
    it("lists the queues: overdue first, mine and unassigned, and solved in the last 30 days", async () => {
      const now = new Date("2026-11-10T12:00:00Z");
      const old = await db.createCase(
        database,
        helpInput({ now: new Date("2026-11-09T00:00:00Z") }),
      );
      const fresh = await db.createCase(
        database,
        helpInput({ now: new Date("2026-11-10T11:00:00Z") }),
      );
      await db.takeCase(database, { caseId: fresh.caseId, agentId: ana });
      const open = await db.listCases(database, { queue: "open", agentId: ana, now });
      expect(open.map((row) => row.id)).toEqual([old.caseId, fresh.caseId]);
      expect(open[0]!.due?.overdue).toBe(true);
      expect(
        (await db.listCases(database, { queue: "mine", agentId: ana, now })).map((r) => r.id),
      ).toEqual([fresh.caseId]);
      expect(
        (await db.listCases(database, { queue: "unassigned", agentId: ana, now })).map((r) => r.id),
      ).toEqual([old.caseId]);
      expect(
        (
          await db.listCases(database, {
            queue: "open",
            agentId: ana,
            search: `#${old.number}`,
            now,
          })
        ).map((r) => r.id),
      ).toEqual([old.caseId]);
    });

    it("filters the queues by topic, search and status, and shows solved cases from the last 30 days", async () => {
      const now = new Date("2026-11-10T12:00:00Z");
      const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
      const billing = await db.createCase(
        database,
        helpInput({
          topic: "billing",
          subject: "Refund question",
          contactEmail: "pat@example.com",
          now: hoursAgo(2),
        }),
      );
      const waiting = await db.createCase(database, helpInput({ now: hoursAgo(30) }));
      await db.replyAsAgent(database, {
        caseId: waiting.caseId,
        agentId: ana,
        body: "Can you send a screenshot?",
        now: hoursAgo(20),
      });
      const overdue = await db.createCase(
        database,
        helpInput({ subject: "Still waiting", now: hoursAgo(30) }),
      );
      const recentlySolved = await db.createCase(database, helpInput({ now: hoursAgo(100) }));
      await db.solveCase(database, {
        caseId: recentlySolved.caseId,
        agentId: ana,
        now: hoursAgo(90),
      });
      const longAgo = await db.createCase(
        database,
        helpInput({ now: new Date("2026-09-01T00:00:00Z") }),
      );
      await db.solveCase(database, {
        caseId: longAgo.caseId,
        agentId: ana,
        now: new Date("2026-09-02T00:00:00Z"),
      });
      const ids = async (query: Parameters<typeof db.listCases>[1]) =>
        (await db.listCases(database, query)).map((row) => row.id);
      expect(await ids({ queue: "waiting", agentId: ana, now })).toEqual([waiting.caseId]);
      expect(await ids({ queue: "overdue", agentId: ana, now })).toEqual([overdue.caseId]);
      expect(await ids({ queue: "solved", agentId: ana, now })).toEqual([recentlySolved.caseId]);
      expect(await ids({ queue: "open", agentId: ana, topic: "billing", now })).toEqual([
        billing.caseId,
      ]);
      expect(await ids({ queue: "open", agentId: ana, search: "pat@", now })).toEqual([
        billing.caseId,
      ]);
      expect(await ids({ queue: "open", agentId: ana, search: "refund", now })).toEqual([
        billing.caseId,
      ]);
    });

    it("counts unassigned, overdue and waiting cases, and the typical first reply", async () => {
      const now = new Date("2026-11-10T12:00:00Z");
      const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
      const a = await db.createCase(database, helpInput({ now: at(5) }));
      const b = await db.createCase(database, helpInput({ now: at(6) }));
      await db.createCase(database, helpInput({ now: at(48) })); // unanswered, so it's overdue
      await db.replyAsAgent(database, {
        caseId: a.caseId,
        agentId: ana,
        body: "On it.",
        now: at(4),
      }); // after 60 minutes
      await db.replyAsAgent(database, {
        caseId: b.caseId,
        agentId: ana,
        body: "On it.",
        now: at(4),
      }); // after 120 minutes
      expect(await db.careCounts(database, now)).toEqual({
        unassigned: 1,
        overdue: 1,
        waiting: 2,
        typicalFirstReplyMinutes: 90,
      });
    });

    it("shows users their own requests, and escalations only once an agent has written to them", async () => {
      const own = await db.createCase(
        database,
        helpInput({ userId: riya, raisedByUserId: riya, verified: true }),
      );
      const escalation = await db.createCase(database, escalationInput({ userId: riya }));
      expect((await db.userCases(database, riya)).map((row) => row.id)).toEqual([own.caseId]);
      await db.replyAsAgent(database, {
        caseId: escalation.caseId,
        agentId: ana,
        body: "Checking in.",
      });
      expect((await db.userCases(database, riya)).map((row) => row.id).sort()).toEqual(
        [own.caseId, escalation.caseId].sort(),
      );
    });

    it("tells who can see a case: its requester, and an escalation's client only after an agent wrote to them", async () => {
      const own = await db.createCase(
        database,
        helpInput({ userId: riya, raisedByUserId: riya, verified: true }),
      );
      const escalation = await db.createCase(database, escalationInput());
      expect(await db.canUserSeeCase(database, { caseId: own.caseId, userId: riya })).toBe(true);
      expect(await db.canUserSeeCase(database, { caseId: own.caseId, userId: priya })).toBe(false);
      expect(await db.canUserSeeCase(database, { caseId: escalation.caseId, userId: riya })).toBe(
        false,
      );
      await db.replyAsAgent(database, {
        caseId: escalation.caseId,
        agentId: ana,
        body: "Checking in.",
      });
      expect(await db.canUserSeeCase(database, { caseId: escalation.caseId, userId: riya })).toBe(
        true,
      );
    });

    it("keeps internal notes out of the requester's thread and the data export", async () => {
      const { caseId } = await db.createCase(
        database,
        helpInput({ userId: riya, raisedByUserId: riya, verified: true }),
      );
      await db.addNote(database, {
        caseId,
        authorId: ana,
        body: "Looks like a typo in their email.",
      });
      const thread = await db.caseThread(database, caseId, { includeInternal: false });
      expect(thread!.messages.map((m) => m.visibility)).toEqual(["public"]);
      const exported = await db.supportExport(database, riya);
      expect(exported.messages.every((m) => m.visibility === "public")).toBe(true);
    });

    it("exports every case about a user with only the public messages, never internal notes", async () => {
      const own = await db.createCase(
        database,
        helpInput({ userId: riya, raisedByUserId: riya, verified: true }),
      );
      const escalation = await db.createCase(database, escalationInput());
      const exported = await db.supportExport(database, riya);
      expect(exported.cases.map((row) => row.id).sort()).toEqual(
        [own.caseId, escalation.caseId].sort(),
      );
      // The escalation holds only an internal note, so none of its text is exported.
      expect(exported.messages.map((row) => row.caseId)).toEqual([own.caseId]);
      expect(exported.messages.map((row) => row.body)).not.toContain(
        "Client says nothing has been submitted for two weeks.",
      );
      expect(exported.cases[0]).not.toHaveProperty("assigneeId");
    });

    it("shows staff the whole thread, oldest first, with who wrote each message", async () => {
      const start = new Date("2026-11-01T00:00:00Z");
      const { caseId } = await db.createCase(
        database,
        helpInput({ userId: riya, raisedByUserId: riya, authorUserId: riya, now: start }),
      );
      await db.addNote(database, {
        caseId,
        authorId: ana,
        body: "Checking their account.",
        now: new Date(start.getTime() + 60_000),
      });
      await db.replyAsAgent(database, {
        caseId,
        agentId: ana,
        body: "Try the reset link.",
        now: new Date(start.getTime() + 120_000),
      });
      const thread = await db.caseThread(database, caseId, { includeInternal: true });
      expect(thread!.messages.map((m) => [m.authorName, m.visibility, m.body])).toEqual([
        ["Riya", "public", "I never got the email."],
        ["Ana", "internal", "Checking their account."],
        ["Ana", "public", "Try the reset link."],
      ]);
      expect(
        await db.caseThread(database, "00000000-0000-0000-0000-000000000000", {
          includeInternal: true,
        }),
      ).toBeNull();
    });

    it("finds a requester's other cases by account or by email", async () => {
      const first = await db.createCase(database, helpInput({ userId: riya, subject: "First" }));
      const second = await db.createCase(database, helpInput({ subject: "Second" }));
      await db.createCase(
        database,
        helpInput({ contactEmail: "pat@example.com", subject: "A stranger's" }),
      );
      const found = await db.otherCases(database, {
        caseId: first.caseId,
        userId: riya,
        contactEmail: "riya@example.com",
      });
      expect(found.map((row) => row.id)).toEqual([second.caseId]);
      expect(
        await db.otherCases(database, { caseId: first.caseId, userId: null, contactEmail: "" }),
      ).toEqual([]);
    });

    it("finds a client's active specialist and their latest escalation", async () => {
      expect(await db.activeSpecialistId(database, riya)).toBeNull();
      await database
        .insert(db.specialistAssignments)
        .values({ specialistId: priya, clientId: riya });
      expect(await db.activeSpecialistId(database, riya)).toBe(priya);
      await database.update(db.specialistAssignments).set({ active: false });
      expect(await db.activeSpecialistId(database, riya)).toBeNull();

      expect(await db.latestEscalation(database, riya)).toBeNull();
      await db.createCase(
        database,
        escalationInput({ subject: "Older", now: new Date("2026-11-01T00:00:00Z") }),
      );
      const newer = await db.createCase(
        database,
        escalationInput({ subject: "Newer", now: new Date("2026-11-05T00:00:00Z") }),
      );
      expect(await db.latestEscalation(database, riya)).toMatchObject({
        id: newer.caseId,
        status: "open",
      });
      await db.solveCase(database, { caseId: newer.caseId, agentId: ana });
      expect(await db.latestEscalation(database, riya)).toMatchObject({
        id: newer.caseId,
        status: "solved",
      });
    });
  });

  describe("accounts and export links", () => {
    it("summarizes an account: plan, last sign-in, applications by status and cases", async () => {
      const signInAt = new Date("2026-11-09T09:30:00Z");
      await database.insert(db.applications).values([
        { userId: riya, companyName: "Acme", jobTitle: "Engineer", status: "applied" },
        { userId: riya, companyName: "Globex", jobTitle: "Engineer", status: "applied" },
        { userId: riya, companyName: "Initech", jobTitle: "Engineer", status: "saved" },
      ]);
      await database.insert(db.resumes).values({
        userId: riya,
        title: "Main",
        content: emptyResume(),
        settings: DEFAULT_RESUME_SETTINGS,
      });
      await db.createCase(database, helpInput({ userId: riya }));
      const solved = await db.createCase(database, helpInput({ userId: riya }));
      await db.solveCase(database, { caseId: solved.caseId, agentId: ana });
      await database.insert(db.auditLogs).values([
        {
          actorUserId: riya,
          action: "auth.sign_in",
          targetType: "session",
          targetId: "s1",
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
        {
          actorUserId: riya,
          action: "auth.sign_in",
          targetType: "session",
          targetId: "s2",
          createdAt: signInAt,
        },
      ]);
      expect(await db.accountSummary(database, riya)).toMatchObject({
        id: riya,
        email: "riya@example.com",
        emailVerified: false,
        plan: "free",
        role: "user",
        banned: false,
        banReason: null,
        applicationsByStatus: { applied: 2, saved: 1 },
        resumes: 1,
        openCases: 1,
        solvedCases: 1,
        lastSignInAt: signInAt,
      });
      expect(await db.accountSummary(database, "nobody")).toBeNull();
    });

    it("lists what happened to an account, newest first, as actor or target", async () => {
      await database.insert(db.auditLogs).values([
        {
          actorUserId: riya,
          action: "auth.sign_in",
          targetType: "session",
          targetId: "s1",
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
        {
          actorUserId: ada,
          action: "admin.user.ban",
          targetType: "user",
          targetId: riya,
          createdAt: new Date("2026-11-02T00:00:00Z"),
        },
        {
          actorUserId: ana,
          action: "auth.sign_in",
          targetType: "session",
          targetId: "s9",
          createdAt: new Date("2026-11-03T00:00:00Z"),
        },
      ]);
      const activity = await db.accountActivity(database, riya);
      expect(activity.map((row) => [row.action, row.actorEmail])).toEqual([
        ["admin.user.ban", "ada@example.com"],
        ["auth.sign_in", "riya@example.com"],
      ]);
      expect(await db.accountActivity(database, riya, 1)).toHaveLength(1);
    });

    it("allows deletion only for an open, verified 'My data' request from that account", async () => {
      const data = (o = {}) => helpInput({ topic: "data", userId: riya, verified: true, ...o });
      const ok = await db.createCase(database, data());
      const wrongTopic = await db.createCase(database, data({ topic: "account" }));
      const unverified = await db.createCase(database, data({ verified: false }));
      const solved = await db.createCase(database, data());
      await db.solveCase(database, { caseId: solved.caseId, agentId: ana });
      expect(await db.deletableForCase(database, { userId: riya, caseId: ok.caseId })).toBe(true);
      for (const c of [wrongTopic, unverified, solved]) {
        expect(await db.deletableForCase(database, { userId: riya, caseId: c.caseId })).toBe(false);
      }
      expect(await db.deletableForCase(database, { userId: ana, caseId: ok.caseId })).toBe(false);
    });

    it("uses an export link once, only on redeem, and not after 24 hours", async () => {
      const now = new Date("2026-11-10T00:00:00Z");
      const token = await db.createExportLink(database, { userId: riya, createdBy: ana, now });
      expect(await db.exportLinkUsable(database, token, now)).toBe(true);
      expect(await db.exportLinkUsable(database, token, now)).toBe(true); // a scanner's visit doesn't use it up
      expect(await db.redeemExportLink(database, token, now)).toBe(riya);
      expect(await db.redeemExportLink(database, token, now)).toBeNull();
      expect(await db.exportLinkUsable(database, token, now)).toBe(false);
      const late = await db.createExportLink(database, { userId: riya, createdBy: ana, now });
      expect(await db.exportLinkUsable(database, late, new Date("2026-11-11T00:00:01Z"))).toBe(
        false,
      );
      expect(
        await db.redeemExportLink(database, late, new Date("2026-11-11T00:00:01Z")),
      ).toBeNull();
      expect(await db.redeemExportLink(database, "not-a-real-token", now)).toBeNull();
      const stored = await database.select().from(db.exportLinks);
      expect(stored.map((link) => link.tokenHash)).not.toContain(token);
    });
  });
});
