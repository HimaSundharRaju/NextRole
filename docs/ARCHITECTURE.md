# GetTargetRole architecture

This document explains how GetTargetRole is put together: its components, the data model, the job
pipeline, the Claude integration and the security model. For setup and deployment, see the
[README](../README.md).

## Components

| Component     | Runs as                      | Responsibilities                                                                                                             |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`    | Next.js 16 standalone server | UI (React Server Components), server actions, API routes, authentication, Claude calls                                       |
| `apps/worker` | Node.js process with BullMQ  | Job-board ingestion, job alerts, follow-up reminders; `dist/migrate.js` for migrations                                       |
| `apps/edge`   | Cloudflare Worker            | Routes traffic to the web containers and keeps the jobs container running (see [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)) |
| PostgreSQL 16 | Managed database             | All durable state, including sessions and full-text search                                                                   |
| Redis         | Managed cache (`noeviction`) | BullMQ queues and schedulers, distributed rate limits                                                                        |
| Anthropic API | External                     | Claude Opus 5 for every AI feature                                                                                           |

The two services share code through workspace packages. `core` holds configuration, logging,
crypto, Redis, rate limiting, email and the queue contracts. `db` holds the schema and
migrations. `resume` holds the resume model and renderers, `jobs` the ingestion and matching,
and `ai` the Claude integration. The packages ship TypeScript source: Next.js compiles them into
the web build, and tsup bundles them into the worker.

Neither service keeps state in memory between requests, so both scale horizontally. Sessions
are rows in Postgres. Rate-limit counters and queues live in Redis.

## Data model

| Group        | Tables                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity     | `users` (role, plan, ban, onboarding), `sessions`, `accounts`, `verifications`                                                                       |
| Candidate    | `profiles` (targets, preferences, salary floor, work authorization)                                                                                  |
| Jobs         | `companies` (ATS, board token, sync status), `jobs` (normalized posting with a `tsvector` search column), `job_matches` (per-user score and reasons) |
| Resumes      | `resumes` (structured JSON content and settings), `resume_revisions`, `resume_messages` (Studio chat)                                                |
| Applications | `applications` (status, follow-up date, the kit that was sent), `application_events`, `outreach_messages`                                            |
| Platform     | `notifications`, `ai_usage` (tokens and cost per call), `audit_logs`, `specialist_assignments`                                                       |

Schema changes are made in `packages/db/src/schema` and turned into a SQL migration with
`pnpm db:generate`. Migrations are committed under `packages/db/drizzle` and applied with
`pnpm db:migrate` in development or `node dist/migrate.js` from the worker image.

## Job pipeline

1. **Schedule.** A BullMQ job scheduler (`enqueue-due-syncs`) runs every `INGEST_INTERVAL_MINUTES`.
   It finds the active companies whose last sync is older than the interval and enqueues a
   `sync-company` job for each. A deduplication id per company means a board is never synced twice
   at once, and admins can trigger a sync manually.
2. **Fetch.** Connectors for Greenhouse, Lever, Ashby and SmartRecruiters call each board's
   public API with timeouts and typed errors. Failures are retried with exponential backoff and
   recorded on the company.
3. **Normalize.** Postings are mapped to one shape: title, location, workplace type, salary
   range and period, and apply URL. Descriptions are sanitized against a strict HTML allowlist,
   and skills are extracted with the shared taxonomy in `packages/resume`.
4. **Upsert.** Jobs are upserted on `(company, external id)`. A content hash means an unchanged
   posting only updates `last_seen_at`. Jobs that disappear from a board are marked closed.
5. **Alert.** New jobs are scored against each candidate's profile, and strong matches create
   notifications.

Matching (`packages/jobs/src/match.ts`) is deterministic and costs nothing to run, so the whole
feed can be ranked. The score is skill overlap (50%), title similarity to the target roles (30%)
and location fit (20%). It is reduced for a seniority mismatch or pay below the salary floor, and
each score comes with the reasons behind it. Claude's deeper fit analysis runs only when a
candidate asks for it on a single job.

## Claude integration

All AI features go through the `AiProvider` interface in `packages/ai`: resume import and
generation, tailoring, fit analysis, cover letters, application answers, outreach, interview
prep and the Studio chat. Its production implementation calls the Anthropic TypeScript SDK:

- **Model and reasoning.** Claude Opus 5 (`AI_MODEL`) with adaptive thinking. The effort level is
  set per feature: `high` for writing that is judged on quality (generation, tailoring) and
  `medium` for interactive and extraction work. Models older than Claude 4.6, such as Claude
  Haiku 4.5, don't support adaptive thinking or effort, so requests to them leave both out.
- **Structured outputs.** Every non-chat feature gets JSON that matches a Zod schema, so results
  are typed and validated before they reach the database or the UI. Most features request a
  structured output. Tailoring returns its result through a non-strict `submit_result` tool
  instead, because the API compiles structured-output and strict-tool schemas into a grammar with
  a size limit, and a whole resume plus the tailoring notes exceeds it.
- **Streaming.** Requests stream and are collected with `finalMessage()`, which avoids timeouts
  on long outputs. The Studio chat streams to the browser over server-sent events.
- **Studio editing tool.** In the Studio, Claude edits the resume through an `update_resume` tool
  with eager input streaming. The tool isn't strict because of the same grammar limit. Every tool
  input is validated against the resume schema before it is applied, and each applied edit is
  saved as a revision the user can restore.
- **Refusal fallbacks.** On models whose safety classifiers can decline a request (Claude Opus 5
  and 5.5, Claude Fable 5 and 5.1), requests opt into server-side fallbacks, so a declined
  request is retried by the API on a fallback model rather than failing.
- **Prompt caching.** System prompts are marked cacheable, which cuts cost and latency on repeat
  calls.
- **Untrusted content.** Resumes, job descriptions and uploaded documents are wrapped in tagged
  blocks, and the prompts instruct Claude to treat them as data, never as instructions.
- **Metering and budgets.** Each call records its tokens and estimated cost in `ai_usage`. Before
  a call, the user's spend this month is checked against their plan's budget.
- **Testing.** `AI_PROVIDER=mock` swaps in a deterministic provider for local development and the
  end-to-end suite. The configuration refuses it when `NODE_ENV=production`.

Resume import accepts PDFs, which are sent to Claude as document blocks; Word files, which are
converted to text with mammoth; and pasted text. Claude extracts a structured resume (see
`packages/resume/src/schema.ts`). The same structure feeds the live HTML preview, the PDF
renderer (`@react-pdf/renderer`), the Word renderer (`docx`) and the ATS readiness check.

## Security model

**Authentication.** Better Auth provides email and password sign-in (verified email required in
production) and optional Google sign-in. Sessions are stored in Postgres and checked on every
request, so a ban or a role change takes effect immediately. Sign-in, sign-up and password-reset
endpoints are rate limited per client IP through Redis.

**Authorization.** Every server action goes through `authedAction`, which loads the session,
enforces the allowed roles, applies a per-user rate limit and validates the input with Zod. Data
access functions take the user id and scope every query to it, and a missing or foreign record
returns 404. Specialists can only reach clients assigned to them, and admin pages return 404 for
everyone else.

**Web protections.** `src/proxy.ts` sets a per-request nonce-based Content-Security-Policy. Static
headers add HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a
Permissions-Policy. POST API routes require a same-origin `Origin` header, and server actions have
Next.js's built-in origin check. Redirect targets are restricted to same-site paths.

**Input handling.** Uploads are limited to 5 MB and identified by their magic bytes, not their
file name. Job descriptions are sanitized before they are stored.

**Auditing and privacy.** Sign-ups, sign-ins, admin changes, specialist actions and account
deletion are written to `audit_logs`. The logger redacts passwords, tokens, cookies, emails and
resume text. Users can export all their data or delete their account.

## Operations

- **Health checks.** The web app serves `GET /api/health`, which checks Postgres and Redis. The
  worker serves `GET /healthz` on `WORKER_HEALTH_PORT`. Both Docker images declare a
  `HEALTHCHECK`.
- **Shutdown.** On `SIGTERM` the worker stops taking jobs, lets running jobs finish and closes its
  connections.
- **Logs.** Both services write structured JSON logs with Pino, ready for any log pipeline.
- **Releases.** Run migrations first, then roll out the web app and the worker. Keep each
  migration compatible with the version still running, so a rollout never needs downtime. CI
  builds both images on every pull request.
