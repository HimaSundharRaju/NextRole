import { createLogger } from "@gettargetrole/core/logger";
import { closeDb } from "@gettargetrole/db";
import { runMigrations } from "@gettargetrole/db/migrate";
import { seedCompanies } from "@gettargetrole/db/seed";

/**
 * Applies pending database migrations and exits. The worker image ships the SQL migrations in
 * ./drizzle next to ./dist, and deployments run this once before starting the web app and worker:
 *
 *   node dist/migrate.js          apply migrations (set MIGRATIONS_DIR to use another folder)
 *   node dist/migrate.js --seed   also add the default public job boards (idempotent)
 */
const log = createLogger("migrate");

try {
  await runMigrations(process.env.MIGRATIONS_DIR || undefined);
  log.info("database migrations applied");
  if (process.argv.includes("--seed")) {
    log.info({ added: await seedCompanies() }, "default companies seeded");
  }
} catch (error) {
  log.error({ err: error }, "database migration failed");
  process.exitCode = 1;
} finally {
  await closeDb();
}
