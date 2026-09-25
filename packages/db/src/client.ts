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

const SSL_URL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];

/**
 * Connection settings for `pg`. Some providers (Supabase, for one) sign their certificates with
 * their own CA; pass that CA's PEM as `caCert` to verify the server against it. The URL's SSL
 * parameters are dropped in that case, because `pg` would let them override the CA.
 */
export function connectionConfig(
  connectionString: string,
  caCert?: string,
): Pick<pg.PoolConfig, "connectionString" | "ssl"> {
  if (!caCert) return { connectionString };
  const url = new URL(connectionString);
  for (const param of SSL_URL_PARAMS) url.searchParams.delete(param);
  return {
    connectionString: url.toString(),
    // Secrets stores sometimes flatten newlines to "\n"; PEM needs real ones.
    ssl: { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true },
  };
}

export function getPool(): pg.Pool {
  if (!store.__nextrolePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    const pool = new pg.Pool({
      ...connectionConfig(connectionString, process.env.DATABASE_CA_CERT || undefined),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Protect the database from runaway queries. Set per connection rather than as a startup
    // option, which connection poolers such as PgBouncer and Supavisor may reject.
    pool.on("connect", (client) => {
      client.query("SET statement_timeout = 30000").catch(() => undefined);
    });
    store.__nextrolePool = pool;
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
