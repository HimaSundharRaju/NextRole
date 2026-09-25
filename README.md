# NextRole

NextRole is an AI job-search platform. It pulls in real openings from company job boards as they
are posted, scores each one against your resume, and uses Claude to write your resume, tailor it
to a job, draft the cover letter, answer application questions and write the recruiter message.
Applications are tracked on a board with follow-up reminders. The Concierge plan adds a human
specialist who works through your job search alongside you.

You stay in control: NextRole prepares everything for an application, **you review it and submit
it yourself**. Nothing is auto-submitted on your behalf.

## Features

| Area                  | What you get                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Job discovery**     | Openings ingested from public Greenhouse, Lever, Ashby and SmartRecruiters boards every 10 minutes, full-text search and filters, match scores against your resume, job alerts.                                                            |
| **Resume Studio**     | Import a PDF, Word file or pasted text into a structured resume. Chat with Claude to rewrite, quantify or tighten it with a live preview. Every change is a restorable version. ATS readiness check, three templates, PDF and Word export. |
| **Apply kit**         | Per job: a fit analysis, a tailored resume with a summary of what changed, a cover letter, answers to application questions, and a recruiter email plus LinkedIn note. "I've applied" saves a receipt of exactly what you sent.            |
| **Tracker**           | Kanban board from saved to offer, notes, follow-up reminders and interview prep sheets.                                                                                                                                                    |
| **Concierge**         | Specialists see and work on the job searches of the clients assigned to them.                                                                                                                                                              |
| **Admin console**     | Users, roles, plans and bans; job boards and sync status; specialist assignments; audit log.                                                                                                                                               |
| **Plans and budgets** | Starter, Pro and Concierge plans, each with a monthly Claude spend cap that is metered per request.                                                                                                                                        |
| **Privacy**           | Users can export all their data as JSON or delete their account.                                                                                                                                                                           |

## Architecture

```mermaid
flowchart LR
  browser([Browser]) -->|HTTPS| web["apps/web<br/>Next.js 16"]
  web --> pg[(PostgreSQL 16)]
  web --> redis[(Redis)]
  web -->|Claude API| claude[Anthropic]
  web -. enqueue .-> redis
  worker["apps/worker<br/>BullMQ"] --> pg
  worker --> redis
  worker -->|public job boards| ats[Greenhouse · Lever · Ashby · SmartRecruiters]
```

The web app and the worker are stateless and scale horizontally: sessions live in Postgres, and
rate limits and queues live in Redis. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
data model, the Claude integration and the security model.

| Path              | Contents                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Next.js 16 app (App Router, React 19, Tailwind CSS 4): pages, server actions, API routes, auth             |
| `apps/worker`     | BullMQ worker: job-board ingestion, job alerts, follow-up reminders; also applies migrations in production |
| `packages/ai`     | Claude integration: prompts, structured outputs, the Studio editing tool, usage metering, a mock for tests |
| `packages/resume` | Resume schema, skills taxonomy, ATS checks, PDF and Word rendering                                         |
| `packages/jobs`   | Job-board connectors, HTML sanitizing, normalization, matching, ingestion, alerts                          |
| `packages/db`     | Drizzle ORM schema, SQL migrations, seed data                                                              |
| `packages/core`   | Environment validation, logging, encryption, Redis, rate limiting, email, queue contracts                  |
| `infra`           | Docker Compose for local Postgres, Redis and Mailpit, and for the full stack                               |

**Stack:** TypeScript 5.9, Next.js 16, React 19, Tailwind CSS 4, Better Auth, PostgreSQL 16 with
Drizzle ORM, Redis with BullMQ, the Anthropic TypeScript SDK (Claude Opus 5), Zod, Pino,
Vitest, Playwright, pnpm workspaces and Turborepo.

## Getting started

Prerequisites: Node.js 22.12+, pnpm 10 (`corepack enable`) and Docker.

```bash
pnpm install
pnpm infra:up                    # Postgres, Redis and Mailpit on localhost

cp .env.example .env             # then fill in the secrets below
cp .env apps/web/.env.local      # Next.js reads its env from apps/web

pnpm db:migrate
pnpm db:seed -- --demo           # default job boards, plus sample jobs to explore offline
pnpm dev                         # web on http://localhost:3000 and the worker
```

Set these three values in both env files:

| Variable             | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 48`                                    |
| `ENCRYPTION_KEY`     | output of `openssl rand -base64 32`                                    |
| `ANTHROPIC_API_KEY`  | an API key from [console.anthropic.com](https://console.anthropic.com) |

To try the app without an API key, set `AI_PROVIDER=mock` for deterministic sample output (the
app refuses to start with it in production). In development, emails such as password resets are
written to the log; set `SMTP_URL=smtp://localhost:1025` to see them in Mailpit at
http://localhost:8025 instead.

Roles are `user`, `specialist` and `admin`. To make yourself an admin:

```bash
psql postgres://nextrole:nextrole@localhost:5432/nextrole \
  -c "update users set role = 'admin' where email = 'you@example.com'"
```

## Configuration

All configuration comes from environment variables, validated at startup. `.env.example` lists
every variable with its default.

| Variable                                   | Required | Description                                                                                                 |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                  | yes      | Public URL of the web app. With `https://` the auth cookies are marked `Secure`.                            |
| `DATABASE_URL`                             | yes      | PostgreSQL connection string (`DATABASE_POOL_MAX` sets the pool size, default 10)                           |
| `REDIS_URL`                                | yes      | Redis connection string. Redis must use `maxmemory-policy noeviction` (a BullMQ requirement).               |
| `BETTER_AUTH_SECRET`                       | yes      | At least 32 random characters; signs sessions and tokens                                                    |
| `ENCRYPTION_KEY`                           | yes      | 32 random bytes, base64; for encrypting stored third-party credentials such as mailbox tokens (AES-256-GCM) |
| `ANTHROPIC_API_KEY`                        | yes      | Claude API key                                                                                              |
| `AI_MODEL`                                 | no       | Claude model, default `claude-opus-5`                                                                       |
| `SMTP_URL`, `EMAIL_FROM`                   | prod     | Outgoing email. Production requires email verification, so SMTP must be configured.                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no       | Enables "Continue with Google"                                                                              |
| `TRUSTED_PROXIES`                          | no       | Proxy IPs/CIDRs to trust when requests pass through more than one proxy hop                                 |
| `INGEST_INTERVAL_MINUTES`                  | no       | How often each job board is re-synced (default 10)                                                          |
| `INGEST_CONCURRENCY`, `WORKER_HEALTH_PORT` | no       | Worker parallelism (default 4) and health port (default 8081)                                               |
| `LOG_LEVEL`                                | no       | Pino log level (default `info`)                                                                             |

## Testing

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                        # unit tests for every package
TEST_DATABASE_URL=postgres://nextrole:nextrole@localhost:5432/nextrole_test pnpm test
                                 # ...plus the Postgres integration tests (use a separate database)
pnpm test:e2e                    # Playwright end-to-end suite
```

The end-to-end suite runs the real app against Postgres and Redis, using the mock AI provider on
port 3100. Before the first run: `pnpm db:migrate && pnpm db:seed -- --demo` and
`pnpm --filter @nextrole/web exec playwright install chromium`. It covers the full candidate
journey (onboarding, apply kit, tracker, Resume Studio, exports) and the security guarantees:
authentication redirects, CSP headers, CSRF rejection, upload validation, cross-user isolation,
admin-only access and bans.

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of these on every
pull request and builds both Docker images.

## Deployment

The two images are built from the repository root. Both run as a non-root user and include a
health check.

```bash
docker build -f apps/web/Dockerfile -t nextrole-web .        # Next.js standalone server, port 3000
docker build -f apps/worker/Dockerfile -t nextrole-worker .  # worker, health on port 8081
```

On each release:

1. Run the migrations once, with the production environment:
   `docker run --rm --env-file production.env nextrole-worker node dist/migrate.js`. Add `--seed`
   to also add the default job boards; it is idempotent.
2. Roll out the web image (two or more replicas behind a load balancer) and the worker (one or
   more replicas; BullMQ keeps scheduled jobs from being duplicated).
3. Probe `GET /api/health` on the web app (it checks Postgres and Redis) and `GET /healthz` on port
   8081 of the worker.

To run the whole stack locally from the production images, reading secrets from the root `.env`:

```bash
docker compose -f infra/docker-compose.yml --profile app up --build   # http://localhost:3000
```

Production checklist:

- Serve over HTTPS and set `APP_URL` to the public `https://` URL.
- Keep secrets in a secret manager, never in images; `.dockerignore` keeps `.env` files out of builds.
- Use managed Postgres with backups and point-in-time recovery, and Redis with `noeviction`.
- Configure `SMTP_URL`, because production sign-ups must verify their email address.
- If there is more than one proxy in front of the app (for example CDN → load balancer), set
  `TRUSTED_PROXIES` so rate limits apply per client rather than to one shared bucket.

## Security

- Sessions are stored server-side in Postgres, so bans, role changes and sign-outs take effect
  immediately. Cookies are HttpOnly and SameSite.
- Every page carries a per-request nonce-based Content-Security-Policy, plus HSTS,
  `X-Frame-Options`, `nosniff` and a restrictive Permissions-Policy.
- Server actions check the session, role, a Redis rate limit and Zod-validated input. API routes
  reject cross-site POSTs.
- All queries are scoped to their owner. Another user's data returns 404.
- Uploads are validated by content (magic bytes) and size. Job descriptions from outside sources
  are sanitized against a strict allowlist.
- Text from resumes, job posts and uploads is wrapped as untrusted data in Claude prompts, to
  resist prompt injection. Claude's structured output and tool calls are validated with Zod before
  they are used.
- Admin actions and sign-ins are written to an audit log. Logs redact credentials and personal data.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Roadmap

- Browser extension that fills in application forms on company career sites for you to submit
- Send outreach from your own Gmail or Outlook account and track replies
- Stripe billing for the Pro and Concierge plans
- Finding recruiter and hiring-manager contacts
- More job sources (Workday, iCIMS and job-board partners) and LinkedIn sign-in

## License

[Apache License 2.0](LICENSE)
