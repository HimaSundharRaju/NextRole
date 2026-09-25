import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./client";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(getDb(), { migrationsFolder });
}
