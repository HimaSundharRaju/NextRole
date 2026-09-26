import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The integration suites share one test database and truncate it, so files run one at a time.
    fileParallelism: false,
  },
});
