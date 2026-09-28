import { defineConfig } from "tsup";

export default defineConfig({
  // dist/index.js runs the worker; dist/migrate.js applies database migrations and exits.
  entry: ["src/index.ts", "src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they are bundled (and are devDependencies);
  // npm dependencies stay external and are installed by `pnpm deploy --prod` in the Docker image.
  noExternal: [/^@gettargetrole\//],
});
