# syntax=docker/dockerfile:1.7
# NextRole background worker (job ingestion, alerts, reminders), running as a non-root user.
# The same image applies database migrations:  node dist/migrate.js
# Build from the repository root:  docker build -f apps/worker/Dockerfile -t nextrole-worker .

ARG NODE_IMAGE=node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
# Workspace packages are bundled into dist/ by tsup; `pnpm deploy --prod` then collects only the
# npm packages the bundle imports at runtime.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@nextrole/worker..." \
 && pnpm --filter @nextrole/worker build \
 && pnpm --filter @nextrole/worker deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    WORKER_HEALTH_PORT=8081
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.WORKER_HEALTH_PORT || 8081) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
