import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getPool } from "./client";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("connection pool (Postgres integration)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterAll(async () => {
    await closeDb();
  });

  it("sets the statement timeout on each new connection before its first query", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.message);
    process.on("warning", onWarning);
    try {
      // Several queries at once on a cold pool, as a page render does.
      const results = await Promise.all(
        Array.from({ length: 4 }, () => getPool().query("SHOW statement_timeout")),
      );
      expect(results.map((result) => result.rows[0].statement_timeout)).toEqual([
        "30s",
        "30s",
        "30s",
        "30s",
      ]);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    // pg warns when a query starts while the connection is still running another one.
    expect(warnings).toEqual([]);
  });
});
