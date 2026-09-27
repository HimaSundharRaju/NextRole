import { defineConfig } from "vitest/config";

// Integration test files share this package's test database (see packages/db/src/test-database.ts),
// so they run one after another.
export default defineConfig({ test: { fileParallelism: false } });
