import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

interface DbGlobal {
  __nextrolePool?: pg.Pool;
  __nextroleDb?: Database;
}

// Survive Next.js dev hot reloads without leaking a new pool on every edit.
const store = globalThis as unknown as DbGlobal;

export function getPool(): pg.Pool {
  if (!store.__nextrolePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    store.__nextrolePool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Protect the database from runaway queries.
      options: "-c statement_timeout=30000",
    });
  }
  return store.__nextrolePool;
}

export function getDb(): Database {
  if (!store.__nextroleDb) {
    store.__nextroleDb = drizzle(getPool(), { schema });
  }
  return store.__nextroleDb;
}

export async function closeDb(): Promise<void> {
  const pool = store.__nextrolePool;
  store.__nextrolePool = undefined;
  store.__nextroleDb = undefined;
  if (pool) await pool.end();
}
