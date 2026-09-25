import { closeDb } from "./client";
import { runMigrations } from "./migrate-lib";

try {
  await runMigrations();
  process.stdout.write("Database migrations applied.\n");
} catch (error) {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
