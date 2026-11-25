import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as JobsModule from "./jobs";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";

// Next's marker that keeps server modules out of client bundles; under plain Node it throws.
vi.mock("server-only", () => ({}));

const TEST_DATABASE_URL = testDatabaseUrl("web");

describe.skipIf(!TEST_DATABASE_URL)("job search (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let jobSearch: typeof JobsModule;
  let companyId: string;
  const userId = "job-search-user";

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    jobSearch = await import("./jobs");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE companies, jobs, users RESTART IDENTITY CASCADE`);
    await database
      .insert(db.users)
      .values({ id: userId, name: "Priya Raman", email: "priya@example.com" });
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    companyId = company!.id;
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  let externalIds = 0;
  async function addJob(title: string, yearsMin: number | null = null) {
    await db
      .getDb()
      .insert(db.jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `job-${++externalIds}`,
        title,
        yearsMin,
        location: "Austin, TX",
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        contentHash: "hash",
      });
  }

  /** The titles the job board lists with the "up to N years" filter, alphabetically. */
  async function listed(maxYears?: "2" | "5" | "8") {
    const result = await jobSearch.searchJobs(userId, { sort: "newest", maxYears });
    expect(result.total).toBe(result.items.length);
    return result.items.map((job) => job.title).sort();
  }

  it("applies 'up to N years' to the level a title implies when a post states no years", async () => {
    await addJob("Data Engineer"); // no cue in the title: kept at every limit
    await addJob("Software Engineer II, Big Data"); // mid: 2 years
    await addJob("Senior Software Engineer, Data Engineering"); // senior: 5 years
    await addJob("Staff Software Engineer, Data Warehouse"); // staff: 8 years
    await addJob("Principal Engineer, Big Data Platform"); // principal: 10 years
    await addJob("Staff Software Engineer", 3); // the post's own figure beats the title
    await addJob("Data Analyst", 9); // more than every limit, as stated

    expect(await listed()).toHaveLength(7);
    expect(await listed("2")).toEqual(["Data Engineer", "Software Engineer II, Big Data"]);
    expect(await listed("5")).toEqual([
      "Data Engineer",
      "Senior Software Engineer, Data Engineering",
      "Software Engineer II, Big Data",
      "Staff Software Engineer",
    ]);
    expect(await listed("8")).toEqual([
      "Data Engineer",
      "Senior Software Engineer, Data Engineering",
      "Software Engineer II, Big Data",
      "Staff Software Engineer",
      "Staff Software Engineer, Data Warehouse",
    ]);
    // The default "best match" ranking uses the same filter.
    const ranked = await jobSearch.searchJobs(userId, { maxYears: "2" });
    expect(ranked.items.map((job) => job.title).sort()).toEqual([
      "Data Engineer",
      "Software Engineer II, Big Data",
    ]);
  });
});
