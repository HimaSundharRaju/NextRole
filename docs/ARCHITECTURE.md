# GetTargetRole architecture

This document explains how GetTargetRole is put together: its components, the data model, the job
pipeline, the AI integration and the security model. For setup and deployment, see the
[README](../README.md).

## Components

| Component     | Runs as                      | Responsibilities                                                                                                             |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`    | Next.js 16 standalone server | UI (React Server Components), server actions, API routes, authentication, AI calls                                           |
| `apps/worker` | Node.js process with BullMQ  | Job-board ingestion, job alerts, auto-prepare, follow-up reminders; `dist/migrate.js` for migrations                         |
| `apps/edge`   | Cloudflare Worker            | Routes traffic to the web containers and keeps the jobs container running (see [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)) |
| PostgreSQL 16 | Managed database             | All durable state, including sessions and full-text search                                                                   |
| Redis         | Managed cache (`noeviction`) | BullMQ queues and schedulers, distributed rate limits                                                                        |
| Anthropic API | External                     | The model behind every AI feature (`AI_MODEL`)                                                                               |

The two services share code through workspace packages. `core` holds configuration, logging,
crypto, Redis, rate limiting, email and the queue contracts. `db` holds the schema and
migrations. `resume` holds the resume model and renderers, `jobs` the ingestion and matching,
and `ai` the AI integration. The packages ship TypeScript source: Next.js compiles them into
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
   It finds the active companies whose last sync is older than their interval and enqueues a
   `sync-company` job for each. Boards that take many requests to read sync less often (every 3
   hours for Workday, Oracle and Eightfold, 6 for Amazon; `companies.sync_interval_minutes`
   overrides it), and each failure in a row doubles a board's wait, up to a day. A deduplication
   id per company means a board is never synced twice at once, and admins can trigger a sync
   manually.
2. **Fetch.** Connectors call each board's public API with timeouts and typed errors:
   Greenhouse, Lever, Ashby and SmartRecruiters for most companies; Workday, Oracle
   Recruiting Cloud, Eightfold (both of its APIs) and amazon.jobs for large employers; and
   Bullhorn's public jobs API for staffing firms, whose roles at their clients are often
   contracts (W-2, C2C) with an hourly rate, required years and a sponsorship flag. Feeds of
   many employers' jobs are read the same way, each as one board (see below). Boards
   that state years or sponsorship outright have those stored ahead of anything read from
   the text. Every
   request goes through one per-host limiter (at most 2 at a time and 60 a minute, paused after a 429) and identifies itself as `GetTargetRoleBot`; the endpoints used are ones the sites'
   robots.txt allows. Some boards cap a search (Workday at 2,000 results, Amazon at 10,000), so
   their connectors read one job family, country or category at a time. Boards that list jobs
   without descriptions have each new posting's details fetched (up to 250 per sync for large
   boards); postings already stored keep theirs.
3. **Normalize.** Postings are mapped to one shape: title, location, workplace type, salary
   range and period, and apply URL. Descriptions are sanitized against a strict HTML allowlist,
   and skills are extracted with the shared taxonomy in `packages/resume`. Deterministic parsers
   add the fields the job-board filters use, without AI calls: countries and states
   (`locations.ts`, from board-supplied addresses or the location text), employment types
   including explicit W-2, C2C and 1099 arrangements (`employment.ts`), and what the post says
   about visa sponsorship and citizenship or clearance (`visa.ts`, explicit statements only).
4. **Upsert.** Jobs are upserted on `(company, external id)`. A content hash means an unchanged
   posting only updates `last_seen_at`, and a stored posting whose details come from a second
   request is only marked as still open. Jobs that disappear from a board are closed, but only
   when the board listed everything: a listing that is partial (a capped search, a page that
   failed) closes nothing, and neither does one with under a fifth of the board's usual jobs,
   which is flagged on the company until the drop has lasted three syncs. Each job gets a
   fingerprint (employer, title and first place, normalized, so "Amazon.com Services LLC" is
   "Amazon"), and a feed's copy of a job the employer lists itself points to the employer's
   listing (`duplicate_of`); the board and alerts show only the employer's. Two feeds carrying
   the same ad show the copy seen first. A copy stands on its own again when the listing closes.
5. **Enrich.** Every 15 minutes the worker sends open posts that aren't enriched (or changed
   since) to GPT-4o-mini in a half-price batch, newest first, within `ENRICH_DAILY_BUDGET_USD`
   (default $2, about 7,000 posts). The model reads the facts the parsers miss: required years,
   level, education, pay written without a currency symbol, W-2/C2C/1099 terms, workplace,
   sponsorship and clearance statements, and whether the post is an evergreen talent pool. Each
   fact must come with the post's own words, and a fact whose quote isn't in the post word for
   word (or whose number isn't in its quote) is dropped. The board's data and the parsers win;
   enrichment only fills what they left unknown, and keeps its additions until the post
   changes. The job board filters on required years, and the match score uses the post's level
   and years instead of guessing from the title. Feeds that share only a snippet of each post
   (Adzuna) aren't enriched or auto-prepared: there's too little to go on.
6. **Score ghost jobs.** Each sync scores the company's open jobs for signs that no one is being
   hired (`ghosts.ts`, below), and a job listed past its closing date (USAJOBS gives one) is
   closed rather than reopened.
7. **Alert.** New jobs are scored against each candidate's profile, and strong matches create
   notifications. Candidates who need sponsorship aren't alerted about posts that rule it out,
   and nobody is alerted about likely ghost jobs.
8. **Auto-prepare.** For users who turned it on, new jobs at or above their minimum match are
   queued on the `auto-prepare` queue, strongest matches first (see below).

**Staffing agencies.** Companies can be marked as staffing agencies (Bullhorn boards always
are); their jobs carry an agency label, the board can show employers only or agencies only,
and a "Contract roles (W-2 / C2C)" shortcut filters to contract arrangements. Discovery finds
staffing firms' Bullhorn career portals from the settings file (`app.json`) next to the page.
Few staffing firms publish a public feed (most use systems such as JobDiva or iCIMS without
one), so they can be added one by one as they turn up.

**Ghost jobs** (`ghosts.ts`). Nothing proves a post is a ghost job, so each sign adds points
(`jobs.ghost_score`, out of 100, with `ghost_reasons`), and only several together, or a strong
one, reach the likely-ghost line of 60:

| Sign                                                                                     | Points                 |
| ---------------------------------------------------------------------------------------- | ---------------------- |
| Open 60+ days (120+ days), from the board's posting date or else first sighting          | 20 (35)                |
| Reposted: the role closed and came back within 180 days, with no other opening of it     | 15 per repost, up to 2 |
| A talent pool or general application, by its title or enrichment's quoted evergreen flag | 60                     |
| Reported by job seekers ("filled", "never heard back", "looks fake")                     | 20 per person, up to 3 |

A role with another opening still up is a team hiring several people, so it isn't counted as a
repost. Likely ghost jobs are hidden from search unless asked for, and alerts and auto-prepare
skip them (so no AI is spent on them). Signs below the line push a job down the best-match
ranking and show as warnings ("Open 4+ months", "Reposted 2×"). A job page says when the job's
board last listed it ("Verified open · checked 12 min ago"). Every day the worker rescores all
open jobs, since they age without a sync, and closes jobs past their closing date.

Feed jobs need no separate expiry: USAJOBS lists every open announcement with its closing date,
and Adzuna is read a week back, so its jobs close within three weeks of being posted. The plan's
weekly HEAD check of feed links was dropped: USAJOBS doesn't need it, and Adzuna's links are
click-tracked redirects, where automated requests could count as clicks.

**Job feeds** (`feeds.ts`). Feeds carry many employers' jobs, each job naming its employer
(`jobs.employer_name`), which the board, the job page and the AI's cover letters use in place
of the feed's name. When the worker starts, it adds each feed whose keys are set and turns off
each one whose keys aren't, closing its jobs, since a feed's terms can require its jobs to come
down when access ends. A feed an admin turned off stays off.

- **USAJOBS** (`USAJOBS_API_KEY`, `USAJOBS_EMAIL`): federal IT, computer science, computer
  engineering and data science jobs (series 2210, 1550, 0854 and 1560), every 6 hours. The key
  is free and the API may be used commercially.
- **Adzuna** (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`): the newest week of US IT jobs and, read
  separately, IT contracts, every 6 hours (at most 10 pages each, well inside the free tier's 250
  requests a day). Its terms allow commercial use without a license only for a 14-day trial, so
  it stays off until Adzuna licenses the site. Each job is credited "Jobs by Adzuna" with a link
  to Adzuna, applying goes through Adzuna's link, and only pay the ad states is shown, not
  Adzuna's estimates.
- **Not read:** LinkedIn, Indeed, Dice, Monster and Wellfound (their terms forbid it); Google
  Careers, Remotive and Arbeitnow (their robots.txt disallows the pages or APIs a connector
  would read). Apple's careers site is left for a later change.

**Finding more companies** (`discovery.ts`, `companies.ts`). Users ask for a missing company
on the jobs page, by name or careers link; admins add one from any link to its board, careers
page or website; and every Monday the public list of hiring Y Combinator companies is queued.
All of these become `company_requests`, which the worker looks up every 10 minutes (and right
after a user asks), people's first. A link to a board is read directly; another page is read,
if robots.txt allows, for the board it links to or embeds, including a careers page linked from
a company's home page; otherwise the name is tried as a board name on Ashby, Greenhouse and
Lever, where a guessed board must have open jobs. Found boards are added and synced at once,
and the request records what happened, which the user and admins can see.

Matching (`packages/jobs/src/match.ts`) is deterministic and costs nothing to run, so the whole
feed can be ranked. The score is skill overlap (50%), title similarity to the target roles (30%)
and location fit (20%). It is reduced for a seniority mismatch or pay below the salary floor, and
each score comes with the reasons behind it. The AI's deeper fit analysis runs only when a
candidate asks for it on a single job.

## Applying

Every job can be applied to manually: the job page's apply kit tailors the main resume, writes a
cover letter and drafts answers, and the candidate submits on the employer's site and marks the
application applied. Nothing is ever submitted for them; employers' application forms have no API
that would allow it. Jobs found elsewhere (LinkedIn, Indeed…) get the same kit from a pasted job
description: it is stored on the application (`applications.job_description`), and resumes
tailored to it are reused through `resumes.application_id`. On jobs below a 70% match, tailoring
and AI fit analysis ask for confirmation, since a tailored resume rarely rescues a weak match.

Auto-prepare does the same preparation in the background (`apps/worker/src/prepare.ts`) on plans
that include it (Pro and Concierge; the daily limit is capped at the plan's maximum and there is a
monthly allowance). It is off by default; in Settings the user sets a minimum match score (default 80) and a daily limit
(default 3). For each strong new match the worker:

1. Skips the job if auto-prepare is off, the job has closed, there is no main resume, or the
   user has spent 80% of the month's AI budget (the rest stays available for their own
   requests).
2. Takes a daily slot under a per-user Postgres advisory lock, so parallel jobs can't exceed the
   limit, and only then creates the application. Applications the user has moved past
   preparing are left alone.
3. Reuses a tailored resume made from the same main resume, and queues whatever is still
   missing (the tailored resume, the cover letter) in `ai_batch_requests` for the batch API,
   which charges half price. The letter is written from the main resume, so both run in the same
   batch; the facts are the same.
4. Every 2 minutes the worker sends queued work as one Message Batch (`submit-ai-batches`), and
   every 5 minutes it reads finished batches (`poll-ai-batches`). Results usually arrive within
   minutes and always within 24 hours. Once all of an application's results are in, one
   transaction saves the tailored resume, attaches it and the letter, marks the application
   "Ready to apply", counts the unit and sends an `application_ready` notification.
5. A failed entry goes into one more batch. If it fails again, the slot is given back and the
   untouched application removed; a tailored resume that did succeed is kept, so the next tailor
   for that job reuses it for free. If batches can't be sent at all for half an hour (an outage,
   a proxy that doesn't pass the batch API through), the queued work runs as live calls at full
   price instead.

Features routed to OpenAI, and deployments with `AI_BATCH=off`, skip the batch and call the AI
right away. The queue runs two jobs at a time with a rate limit, separate from alerts and
reminders. It needs `ANTHROPIC_API_KEY` in the worker's environment; without it the worker logs
that auto-prepare is off and skips queueing.

## Concierge board

Specialists apply for Concierge clients; the design is in
`docs/superpowers/specs/2026-09-30-concierge-staff-board-design.md`.

- **Workflow.** Applications gain four steps: `proposed`, `approved`, `waiting_on_client` and
  `skipped`. `canTransition` (`packages/db/src/concierge/rules.ts`) decides who may make each
  move: only the client approves or skips, only staff ask questions, and staff can't submit
  without the client's consent. The tracker's plain status change never lands on one of these
  steps, and a staff move to `applied` goes through "Mark submitted", so the consent check and
  the receipt always apply.
- **Operations.** `packages/db/src/concierge/` holds proposals, questions, submission, setup
  and the board queries. Every update checks the current step, so a stale change fails with
  "This changed — refresh" instead of overwriting.
- **Accounts on employer sites.** The client creates a Gmail used only for applications and
  shares it with their specialist by Gmail delegation. Staff create employer accounts with it
  and keep those logins in the team password manager. The app stores no passwords.
- **Views.**
  - `/specialist` is the board across a specialist's clients.
  - `/specialist/[clientId]` is the client workspace, with find, pipeline, profile and timeline
    tabs.
  - Clients approve proposals and answer questions at the top of Applications.
  - Admin → Concierge shows the team's week.
- **Jobs.** The worker expires proposals left for 7 days (03:30 UTC) and emails a daily digest
  of new proposals (14:00 UTC).

## AI integration

All AI features go through the `AiProvider` interface in `packages/ai`: resume import and
generation, tailoring, fit analysis, cover letters, application answers, outreach, interview
prep and the Studio chat.

- **Hybrid routing.** Each feature runs on the cheapest model, Claude or OpenAI, that matched the
  reference in the quality check below (`DEFAULT_ROUTES` in `routing.ts`). `RoutedProvider` sends
  each call to its route. When an OpenAI call fails, or `OPENAI_API_KEY` isn't set, the same
  request runs on the feature's Claude fallback, so users see a result rather than an error.
  `AI_ROUTE_<FEATURE>` overrides one route (`openai:gpt-5-mini`, `anthropic:claude-sonnet-5`), and
  `AI_MODEL` puts every feature on one Claude model.
- **One prompt, two vendors.** `requests.ts` builds every feature's request once (instructions,
  the parts that repeat across a user's calls, the per-call parts, the schema and how the output
  becomes the result), and each provider only translates it: `AnthropicProvider` through the
  Anthropic TypeScript SDK, `OpenAIProvider` through the OpenAI SDK's Responses API. Quality
  comparisons between models are therefore like for like.
- **Model and reasoning.** Claude models run with adaptive thinking at a per-feature effort:
  `high` for writing judged on quality (generation, tailoring), `medium` for interactive and
  extraction work. Older models such as `claude-haiku-4-5` support neither, so requests to them
  leave both out. OpenAI reasoning models (GPT-5 family) get a per-feature reasoning effort;
  GPT-4.x models take none.
- **OpenAI specifics.** Responses aren't stored on OpenAI's side (`store: false`), since resumes
  are personal data. A hash of the user id is sent as `prompt_cache_key`, which raises cache hits
  on the user's resume prefix without revealing the account. Results come back as strict
  JSON-schema outputs (optional fields sent as nullable) and are validated with the same Zod
  schemas as Claude's.
- **Structured outputs.** Every non-chat feature gets JSON that matches a Zod schema, so results
  are typed and validated before they reach the database or the UI. Most features request a
  structured output. Tailoring returns its result through a non-strict `submit_result` tool
  instead, because the API compiles structured-output and strict-tool schemas into a grammar with
  a size limit, and a whole resume plus the tailoring notes exceeds it.
- **Streaming.** Requests stream and are collected with `finalMessage()`, which avoids timeouts
  on long outputs. The Studio chat streams to the browser over server-sent events.
- **Studio editing tool.** In the Studio, the AI edits the resume through an `update_resume` tool
  with eager input streaming. The tool isn't strict because of the same grammar limit. Every tool
  input is validated against the resume schema before it is applied, and each applied edit is
  saved as a revision the user can restore.
- **Refusal fallbacks.** On models whose safety classifiers can decline a request
  (`claude-opus-5`, `claude-opus-5-5`, `claude-fable-5` and `claude-fable-5-1`), requests opt into
  server-side fallbacks, so a declined request is retried by the API on a fallback model rather
  than failing.
- **Token economy.** Per-job requests send the user's resume and profile first with a cache
  breakpoint, then the job, so the next job's request reads them from the prompt cache; the
  Studio caches earlier turns the same way. These per-user entries live for five minutes.
  Prefixes every user shares live for an hour: the Studio's tool and instructions, and the
  instructions of every batch entry, since a batch can run longer than five minutes. In a batch,
  a resume is cached only when the same user has more than one entry for a feature, because a
  cache write nobody reads costs more than it saves (1.25× the input price for five minutes, 2×
  for an hour; reads cost 0.1×). Caching needs a minimum prefix (512 tokens on `claude-opus-5`,
  1,024 on `claude-sonnet-5`, 4,096 on `claude-haiku-4-5`). Tailor returns only the sections it
  rewrites and copies the rest, and job posts go to the model without their legal notices
  (equal-opportunity, accommodation, privacy and background-check text).
- **Batches.** Background work goes through a batch API at half price (`batch.ts`): Claude's
  Message Batches for auto-prepare, OpenAI's Batch API (a JSONL file in, one out) for job
  enrichment. `RequestBatches` takes any feature request: entries are built by the same code as
  live calls and their results read by the same code, so a batched tailored resume is identical
  in kind to a live one. Only refusal fallbacks are left out, since their beta header would
  apply to the whole batch.
- **Reuse.** A tailored resume stores a hash of the main resume it came from (`resumes.source_hash`),
  as does a fit analysis. Opening Tailor again for a job reuses the existing version when the main
  resume hasn't changed, at no cost; when it has, the job page marks the tailored resume and the
  fit analysis as made from an earlier version.
- **Untrusted content.** Resumes, job descriptions and uploaded documents are wrapped in tagged
  blocks, and the prompts instruct the model to treat them as data, never as instructions.
- **Metering, allowances and budgets.** Each call records its tokens and estimated cost in
  `ai_usage`. Plans (`packages/db/src/plans.ts`) set monthly allowances in units users
  understand: imports, tailored resumes, cover letters, answers, outreach drafts, fit analyses,
  interview prep, Studio messages and auto-prepared applications. Every AI entry point goes
  through `aiFor(user, unit)`, which checks the allowance and the plan's spend cap, and records a
  row in `usage_events` only when a new result is saved, so reused results and failed calls are
  free. The spend cap is about 1.35–1.5× the measured cost of using every allowance
  (`UNIT_COST_USD` and `fullUseCostUsd` in `plans.ts`, which a test keeps in step with the caps),
  so it only stops outliers: Free $0.30, Plus $6, Pro $15 and Concierge $95 a month. The
  dashboard, settings and each AI button show what's left this month. Batched calls are recorded
  at the batch price and flagged (`ai_usage.batch`).
- **Testing.** `AI_PROVIDER=mock` swaps in a deterministic provider for local development and the
  end-to-end suite. The configuration refuses it when `NODE_ENV=production`.

### Choosing models: the quality check

`packages/ai/eval` decides the routes. Every candidate model runs the production prompts on the
same inputs: 20 resume and job pairs (4 synthetic resumes × 5 real public postings, so good fits
and mismatches), 8 imports (4 PDFs, 4 text) and 15 Studio edits. Automatic checks catch the
failures that matter most on a resume: changed or invented employers, titles, dates or
education; technical skills the resume doesn't show; invented numbers; and hard limits such as a
LinkedIn note over 300 characters. Two judges from different vendors (Claude Sonnet 5 and
GPT-5-mini) then compare each candidate with the reference, Claude Sonnet 5, blind and in random
order. A feature moves to a cheaper model only when that model fails no more checks than the
reference, wins or ties at least half the comparisons with both judges, and answers in under 30
seconds on average.

Results from September 2026:

| Feature                                | Route             | Evidence                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resume import                          | `gpt-4o-mini`     | Tied the reference on all 8 imports with both judges; $0.0005 against $0.015                                                                                                                                                                                                  |
| Fit analysis                           | `gpt-4o-mini`     | Won or tied 7 of 8 comparisons (Claude judge) and 6 of 8 (GPT judge); $0.0004 against $0.012                                                                                                                                                                                  |
| Tailoring                              | `claude-sonnet-5` | Cheaper models added technical skills the candidate doesn't have far more often: Sonnet 5 was clean on 15 of 20, Haiku 4.5 on 6, the GPT models on 0–2                                                                                                                        |
| Cover letters, answers, interview prep | `claude-sonnet-5` | Both judges preferred Claude; the GPT models won or tied 0–38% of comparisons                                                                                                                                                                                                 |
| Outreach, Studio, generation           | `claude-sonnet-5` | Not judged yet, so they run on the reference                                                                                                                                                                                                                                  |
| Job enrichment                         | `gpt-4o-mini`     | On 50 real posts it kept the most facts (3.3 a post against 2.1 for GPT-4.1), every quote-checked fact matched GPT-4.1, and 9 of 11 levels fell in the same junior/mid/senior band; $0.0002 a post in batches. GPT-5-nano costs a third as much but found a third fewer facts |

Job enrichment has its own check (`eval/enrich.mts`): each model reads the same real posts,
the quote check runs on every answer, and the facts that survive are compared with GPT-4.1's.

Run it with
`NODE_USE_ENV_PROXY=1 node --env-file=../../.env --import tsx eval/run.mts` from `packages/ai`
(it needs both API keys). Results are cached under `eval/results/`, so a rerun only pays for what's
missing, and `--budget` stops the run before it spends more; `--no-spend yes` rebuilds the report
from the cache.

Resume import accepts PDFs, which are sent to the model as document blocks; Word files, which are
converted to text with mammoth; and pasted text. The model extracts a structured resume (see
`packages/resume/src/schema.ts`). The same structure feeds the live HTML preview, the PDF
renderer (`@react-pdf/renderer`), the Word renderer (`docx`) and the ATS readiness check.

Each ATS suggestion says how to fix it (`packages/resume/src/ats.ts`). Facts only the person has
(contact details, job titles, dates, education) send them to the editor, since the AI must never
make them up. Everything else becomes a request to the Studio AI in the chat: rewrites it can make
from the resume alone, or, for missing numbers, bullets or keywords, a request to ask the person
for the facts first. "Fix all with AI" bundles the rewrites the AI can make alone into one
message. Every fix is a Studio message, counted against the plan like any other.

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
- **AI spend.** Admin → AI usage shows this month's spend by feature and model, how much input
  came from the prompt cache, what batches saved, spend against plan revenue at list prices, and
  the top spenders against their caps.
- **Releases.** Run migrations first, then roll out the web app and the worker. Keep each
  migration compatible with the version still running, so a rollout never needs downtime. CI
  builds both images on every pull request.
