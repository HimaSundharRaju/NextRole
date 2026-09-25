import { closeDb } from "./client";
import { seedCompanies, seedDemoJobs } from "./seed-lib";

try {
  const companyCount = await seedCompanies();
  process.stdout.write(`Seeded ${companyCount} new companies.\n`);
  if (process.argv.includes("--demo")) {
    const jobCount = await seedDemoJobs();
    process.stdout.write(`Seeded ${jobCount} demo jobs.\n`);
  }
} catch (error) {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
