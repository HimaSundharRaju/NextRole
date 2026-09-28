import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as FeedsModule from "./feeds";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";

const TEST_DATABASE_URL = testDatabaseUrl("jobs");

describe.skipIf(!TEST_DATABASE_URL)("job feeds (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let feeds: typeof FeedsModule;

  const usajobsKeys = { USAJOBS_API_KEY: "test-usajobs-key", USAJOBS_EMAIL: "bot@example.com" };
  const adzunaKeys = { ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: "test-app-key" };

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    feeds = await import("./feeds");
  });

  beforeEach(async () => {
    await db.getDb().execute(drizzle.sql`TRUNCATE companies, jobs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  const feedRows = () =>
    db
      .getDb()
      .select({
        id: db.companies.id,
        ats: db.companies.ats,
        boardToken: db.companies.boardToken,
        active: db.companies.active,
      })
      .from(db.companies)
      .orderBy(db.companies.name);

  it("reads the feeds whose keys are set, once", async () => {
    const added = await feeds.ensureFeedSources(usajobsKeys);
    expect(added).toHaveLength(1);
    expect(await feedRows()).toEqual([
      { id: added[0], ats: "usajobs", boardToken: "2210;1550;0854;1560", active: true },
    ]);
    // A restart with the same keys adds nothing.
    expect(await feeds.ensureFeedSources(usajobsKeys)).toEqual([]);

    const both = await feeds.ensureFeedSources({ ...usajobsKeys, ...adzunaKeys });
    expect(both).toHaveLength(2);
    expect((await feedRows()).map((row) => row.boardToken)).toEqual([
      "us|it-jobs|contract",
      "us|it-jobs|",
      "2210;1550;0854;1560",
    ]);
  });

  it("takes a feed's jobs down when its keys go, and brings it back with them", async () => {
    const database = db.getDb();
    const [feedId] = await feeds.ensureFeedSources(adzunaKeys);
    await database.insert(db.jobs).values({
      companyId: feedId!,
      source: "adzuna",
      externalId: "4812345678",
      title: "Senior Software Engineer",
      applyUrl: "https://www.adzuna.com/land/ad/4812345678",
      contentHash: "hash",
    });

    // A partial key isn't a key.
    await feeds.ensureFeedSources({ ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: " " });
    const [company] = await database
      .select()
      .from(db.companies)
      .where(drizzle.eq(db.companies.id, feedId!));
    expect(company).toMatchObject({ active: false, lastSyncError: feeds.FEED_KEYS_MISSING });
    const [job] = await database.select().from(db.jobs);
    expect(job?.closedAt).toBeInstanceOf(Date);

    expect(await feeds.ensureFeedSources(adzunaKeys)).toContain(feedId);
    const [restored] = await database
      .select()
      .from(db.companies)
      .where(drizzle.eq(db.companies.id, feedId!));
    expect(restored).toMatchObject({ active: true, lastSyncError: null, syncFailures: 0 });
  });

  it("leaves a feed an admin turned off alone", async () => {
    const database = db.getDb();
    const [feedId] = await feeds.ensureFeedSources(usajobsKeys);
    await database
      .update(db.companies)
      .set({ active: false })
      .where(drizzle.eq(db.companies.id, feedId!));
    expect(await feeds.ensureFeedSources(usajobsKeys)).toEqual([]);
    expect((await feedRows())[0]?.active).toBe(false);
  });
});
