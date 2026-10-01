import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as DbModule from "./index";
import { ensureTestDatabase, testDatabaseUrl } from "./test-database";

const TEST_DATABASE_URL = testDatabaseUrl("db");
const DAY_MS = 86_400_000;

describe.skipIf(!TEST_DATABASE_URL)("concierge (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let jobIds: string[];
  const client = "client-1";
  const specialist = "specialist-1";

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("./migrate-lib");
    await runMigrations();
    db = await import("./index");
    drizzle = await import("drizzle-orm");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE users, companies RESTART IDENTITY CASCADE`);
    await database.insert(db.users).values([
      { id: client, name: "Riya", email: "riya@example.com", plan: "concierge" },
      { id: specialist, name: "Priya", email: "priya@example.com", role: "specialist" },
    ]);
    await database.insert(db.profiles).values({ userId: client });
    await database
      .insert(db.specialistAssignments)
      .values({ specialistId: specialist, clientId: client });
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    const inserted = await database
      .insert(db.jobs)
      .values(
        [1, 2, 3].map((n) => ({
          companyId: company!.id,
          source: "greenhouse" as const,
          externalId: String(n),
          title: `Engineer ${n}`,
          location: "Austin, TX",
          applyUrl: `https://example.com/${n}`,
          contentHash: `h${n}`,
        })),
      )
      .returning({ id: db.jobs.id });
    jobIds = inserted.map((row) => row.id);
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  const statusOf = async (id: string) =>
    (
      await db
        .getDb()
        .select({ status: db.applications.status })
        .from(db.applications)
        .where(drizzle.eq(db.applications.id, id))
    )[0]?.status;

  const propose = (ids: string[], extra: { note?: string; now?: Date } = {}) =>
    db.proposeJobs(db.getDb(), {
      clientId: client,
      specialistId: specialist,
      jobIds: ids,
      ...extra,
    });

  describe("proposals", () => {
    it("proposes each job once and leaves jobs the client already has alone", async () => {
      const first = await propose([jobIds[0]!, jobIds[1]!], { note: "Strong fit" });
      expect(first.created).toHaveLength(2);
      await db.decideProposals(db.getDb(), {
        clientId: client,
        applicationIds: [first.created[0]!],
        decision: "approve",
      });
      const again = await propose([jobIds[0]!]);
      expect(again).toEqual({ created: [], existing: [jobIds[0]], unavailable: [] });
      expect(await statusOf(first.created[0]!)).toBe("approved");
    });

    it("leaves out closed jobs and refuses a paused client", async () => {
      const database = db.getDb();
      await database
        .update(db.jobs)
        .set({ closedAt: new Date() })
        .where(drizzle.eq(db.jobs.id, jobIds[2]!));
      expect((await propose([jobIds[2]!])).unavailable).toEqual([jobIds[2]]);
      await database
        .update(db.profiles)
        .set({ conciergePausedAt: new Date() })
        .where(drizzle.eq(db.profiles.userId, client));
      await expect(propose([jobIds[0]!])).rejects.toMatchObject({ code: "paused" });
    });

    it("records the client's decision, and refuses a stale decision", async () => {
      const database = db.getDb();
      const { created } = await propose([jobIds[0]!, jobIds[1]!]);
      await expect(
        db.decideProposals(database, {
          clientId: client,
          applicationIds: [created[1]!],
          decision: "skip",
        }),
      ).rejects.toMatchObject({ code: "not_allowed" });
      expect(
        await db.decideProposals(database, {
          clientId: client,
          applicationIds: [created[1]!],
          decision: "skip",
          reason: "pay",
        }),
      ).toBe(1);
      const [skipped] = await database
        .select()
        .from(db.applications)
        .where(drizzle.eq(db.applications.id, created[1]!));
      expect(skipped).toMatchObject({ status: "skipped", skipReason: "pay" });
      expect(skipped?.decidedAt).toBeInstanceOf(Date);
      await expect(
        db.decideProposals(database, {
          clientId: client,
          applicationIds: [created[1]!],
          decision: "approve",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        db.decideProposals(database, {
          clientId: "someone-else",
          applicationIds: [created[0]!],
          decision: "approve",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("treats a Concierge client's own saved job as approved, and no one else's", async () => {
      const database = db.getDb();
      const [saved] = await database
        .insert(db.applications)
        .values({ userId: client, jobId: jobIds[0]!, companyName: "Acme", jobTitle: "Engineer 1" })
        .returning();
      expect(
        await db.approveOwnSave(database, { clientId: client, applicationId: saved!.id }),
      ).toBe(true);
      expect(await statusOf(saved!.id)).toBe("approved");
      await database.update(db.users).set({ plan: "pro" }).where(drizzle.eq(db.users.id, client));
      const [other] = await database
        .insert(db.applications)
        .values({ userId: client, jobId: jobIds[1]!, companyName: "Acme", jobTitle: "Engineer 2" })
        .returning();
      expect(
        await db.approveOwnSave(database, { clientId: client, applicationId: other!.id }),
      ).toBe(false);
      expect(await statusOf(other!.id)).toBe("saved");
    });

    it("expires proposals left unanswered for a week", async () => {
      const now = new Date();
      const { created } = await propose([jobIds[0]!], {
        now: new Date(now.getTime() - 8 * DAY_MS),
      });
      await propose([jobIds[1]!], { now });
      expect(await db.expireProposals(db.getDb(), now)).toBe(1);
      const [row] = await db
        .getDb()
        .select()
        .from(db.applications)
        .where(drizzle.eq(db.applications.id, created[0]!));
      expect(row).toMatchObject({ status: "skipped", skipReason: "expired" });
    });
  });
});
