import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The integration suites share this package's test database (see
    // packages/db/src/test-database.ts) and truncate it, so files run one at a time.
    fileParallelism: false,
  },
});
