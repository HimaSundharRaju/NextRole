import pg from "pg";

/*
 * Integration tests share one Postgres server. Each package gets its own database on it, so
 * packages can run their tests at the same time without one's TRUNCATE wiping another's rows;
 * within a package, test files run one after another (see its vitest.config.ts).
 */

/** The database for a package's integration tests, or undefined when they're off. */
export function testDatabaseUrl(name: string): string | undefined {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return undefined;
  const url = new URL(base);
  url.pathname = `/${url.pathname.slice(1)}_${name}`;
  return url.toString();
}

/** Creates the test database if it doesn't exist yet. */
export async function ensureTestDatabase(url: string): Promise<void> {
  // A pool injected for local runs (an in-process Postgres) needs no database created.
  if ((globalThis as { __gettargetrolePool?: unknown }).__gettargetrolePool) return;
  const name = new URL(url).pathname.slice(1);
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`create database "${name.replace(/"/g, "")}"`);
  } catch (error) {
    // Created by another run at the same moment.
    if ((error as { code?: string }).code !== "42P04") throw error;
  } finally {
    await client.end();
  }
}
