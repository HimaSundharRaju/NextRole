# Customer Care Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One board where support agents answer help requests, fix account problems, review flagged jobs and company requests, and pick up Concierge escalations, with every action audited.

**Architecture:**

- **Cases:** help requests and escalations are cases, stored in new `support_*` tables. Their rules and queries live in `packages/db/src/support/`, which follows `packages/db/src/concierge/`.
- **Queues:** job reports and company requests stay in their own tables. The board reads them as review queues.
- **Web:** a `(support)` route group serves the signed-in and signed-out pages. `/care` is the staff board.
- **Worker:** auto-solve and the Monday check run in the worker.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Drizzle ORM 0.45 on Postgres, Zod 4, Better Auth 1.7, BullMQ, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-customer-care-board-design.md`

**One deliberate change from the spec:**

- The spec stores one `access_token_hash` on `support_cases`. But a stored hash can't be turned back into the link that later emails need.
- So each email mints its own link token, and their hashes live in `support_case_links`, one row per email.
- Every link stays valid for the case's window. The spec's promise, "only a hash of the link is stored", still holds.

## Global Constraints

- **Copy:** product copy, errors and docs say "AI", never Claude or Anthropic. Commits and PRs carry no AI attribution lines.
- **Times:**
  - `FIRST_REPLY_HOURS = 24`, for `help` cases only;
  - auto-solve after 7 days waiting on the user;
  - the reopen window and private links end 14 days after solving;
  - stale company requests are those `pending` 3 or more days;
  - export links are single-use and valid for 24 hours.
- **Lengths:**
  - subject: 120 characters at most;
  - message: 5,000 characters at most;
  - reason for an account action: 300 characters at most;
  - escalation note: 10–2,000 characters.
- **Rate limits:**
  - the signed-out form: 5 per hour per IP;
  - signed-in requests: 20 per day per user;
  - replies: 60 per hour per person.
- **Tokens:** only hashes of private-link and export-link tokens are stored.
- **Access:**
  - Support agents act only on `user`-role accounts.
  - Nobody acts on their own account.
  - Only admins change roles.
- **Internal notes:** never emailed, never shown to users, and left out of the user's data export.
- **Email format:**
  - subject: `[#<number>] <subject>`;
  - every requester email ends with the private link and "Replies to this email aren't read — use the link above.";
  - in-app message first, email second. A failed email is logged and never undoes the action.
- **Updates:** every update is conditional. A stale action fails with `CHANGED_MESSAGE` ("This changed — refresh to see the latest.").
- **Audit:** every staff action is audited with the action names in the spec's "Access rules and audit".
- **Migration:** `0012`, additive only. The user runs `pnpm db:migrate`.
- **Schedules:** the weekly check runs Mondays at 06:00 UTC, and auto-solve hourly.
- **Testing in the sandbox:** Postgres integration tests (`describe.skipIf(!TEST_DATABASE_URL)`) and Playwright run in CI. Locally, run unit tests, `tsc` and `eslint`.
- **Web pages and server actions** (Tasks 10–14) are server-only, so they have no unit tests. Their rules are tested in the `packages/db` tasks behind them, and their flows by Task 16's end-to-end tests. Each web task ends with `tsc`, `eslint` and the web unit tests passing.

## Review Focus

1. **Email scanners open links before people do.** A single-use export link opened by a mail scanner must not be used up. `GET /support/export?key=` only shows a page, and the download happens on the button's POST. Tested in Task 5 and Task 12.
2. **A signed-out request typed as `" RIYA@Example.com "`** must link to riya@example.com's account, and must not verify the case. Tested in Task 3.
3. **A reply through an email link more than 14 days after solving** must be refused, with "Start a new request", rather than a 500 or a silent success. Tested in Task 3.
4. **A Concierge client with no `profiles` row, or no target override,** must be checked against `CONCIERGE_WEEKLY_TARGET` without crashing. Tested in Task 8.
5. **Crafted requests** that hand a case to a non-staff user, or let a support agent act on a staff account or their own, must be refused. Tested in Task 3 and Task 9.

---

## File structure

**`packages/db/src/schema/support.ts`:** the support enums and the tables `support_cases`, `support_messages`, `support_case_links`, `export_links` and `concierge_week_checks`.

**`packages/db/src/support/`**, one file per job:

- `rules.ts`: pure rules and constants.
- `tokens.ts`: link tokens.
- `email.ts`: email and notification text.
- `cases.ts`: case writes.
- `queries.ts`: board and user reads.
- `accounts.ts`: account summary, export links and the deletion rule.
- `reports.ts`: the job-report queue and hidden jobs.
- `company-requests.ts`: the company-request queue.
- `weekly-check.ts`: the Monday check.
- `index.ts`: exports.

**`apps/web/src/lib/`**, pure and unit-tested:

- `client-ip.ts`
- `support-errors.ts`
- `support-labels.ts`
- `care-rules.ts`

**`apps/web/src/server/`:**

- `care.ts`: staff access helpers.
- `support-mail.ts`: sends the requester's email and in-app notification.
- `action.ts`: gains `publicAction`.

**`apps/web/src/app/(support)/`:** the layout, `support/` (the form), `support/requests/` (list and thread), `support/export/` (the download page) and `support/actions.ts`.

**`apps/web/src/app/(app)/care/`:**

- `page.tsx` (the tabs) and `tabs/*.tsx`;
- `cases/[id]/page.tsx` and `users/[id]/page.tsx`;
- `actions.ts`;
- the client components `case-client.tsx`, `account-client.tsx` and `queue-client.tsx`.

**`apps/web/src/components/app-shell/shell.tsx`:** `AppShell`, now shared by the `(app)` and `(support)` layouts.

**`apps/worker/src/support.ts`:** auto-solve and the weekly check, wired up in `apps/worker/src/index.ts`.

---

### Task 1: Schema, migration and the support role

**Files:**

- Modify: `packages/db/src/schema/auth.ts` (`ROLES`)
- Create: `packages/db/src/schema/support.ts`
- Modify: `packages/db/src/schema/index.ts` (add `export * from "./support";`)
- Modify: `packages/db/src/schema/app.ts`:
  - `JOB_REPORT_REASONS`, plus a new `JOB_REPORT_RESOLUTIONS`;
  - the `jobReports` columns and the `jobs` columns;
  - `COMPANY_REQUEST_STATUSES` and `NOTIFICATION_TYPES`.
- Create (generated): `packages/db/drizzle/0012_customer_care.sql`, its snapshot, and an entry in the journal
- Test: `packages/db/src/db.test.ts`

**Interfaces:**

- Produces: `ROLES` includes `"support"`.
- Produces: `SUPPORT_TOPICS = ["account", "billing", "concierge", "jobs", "bug", "data", "other"]`.
- Produces these enums, each with a type of the same name in the singular:

  | Constant               | Values                               | Type                |
  | ---------------------- | ------------------------------------ | ------------------- |
  | `CASE_KINDS`           | `help`, `escalation`                 | `CaseKind`          |
  | `CASE_SOURCES`         | `form`, `specialist`, `weekly_check` | `CaseSource`        |
  | `CASE_STATUSES`        | `open`, `waiting_on_user`, `solved`  | `CaseStatus`        |
  | `MESSAGE_AUTHOR_KINDS` | `user`, `agent`, `system`            | `MessageAuthorKind` |
  | `MESSAGE_VISIBILITIES` | `public`, `internal`                 | `MessageVisibility` |

- Produces the tables, each with `.enableRLS()`:
  - **`supportCases`:** the spec's columns, without `access_token_hash`.
    - `number` is `integer().generatedAlwaysAsIdentity({ startWith: 1001 }).notNull().unique()`.
    - `contactName` and `contactEmail` default to `""`.
    - `statusChangedAt` is not null and defaults to now.
    - Indexes: `support_cases_status_idx (status, created_at)`, `support_cases_assignee_idx (assignee_id, status)` and `support_cases_user_idx (user_id)`.
  - **`supportMessages`:** the spec's columns, with `support_messages_case_idx (case_id, created_at)`.
  - **`supportCaseLinks`:** `tokenHash` (text, primary key), `caseId` (uuid, references support_cases, on delete cascade) and `createdAt`.
  - **`exportLinks`** and **`conciergeWeekChecks`:** as in the spec. `concierge_week_checks` has the primary key `(client_id, week_start)`.
- Produces these changes to existing tables:
  - `JOB_REPORT_REASONS` gains `"wrong_details"`.
  - `JOB_REPORT_RESOLUTIONS = ["kept", "hidden"]`.
  - `jobReports` gains `reviewedAt`, `reviewedByUserId` and `resolution`.
  - `jobs` gains `hiddenAt`, `hiddenByUserId` and `hiddenReason` (text, not null, default `""`).
  - `COMPANY_REQUEST_STATUSES` gains `"declined"`.
  - `NOTIFICATION_TYPES` gains `"support"`.

- [ ] **Step 1: Write the failing test.** Append to `packages/db/src/db.test.ts`, importing the new constants from `./schema`:

```ts
describe("customer care configuration", () => {
  it("adds the support role, the case enums and the new report, request and notification values", () => {
    expect(ROLES).toContain("support");
    expect(SUPPORT_TOPICS).toEqual([
      "account",
      "billing",
      "concierge",
      "jobs",
      "bug",
      "data",
      "other",
    ]);
    expect(CASE_STATUSES).toEqual(["open", "waiting_on_user", "solved"]);
    expect(JOB_REPORT_REASONS).toContain("wrong_details");
    expect(COMPANY_REQUEST_STATUSES).toContain("declined");
    expect(NOTIFICATION_TYPES).toContain("support");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**
      Run: `cd packages/db && node_modules/.bin/vitest run src/db.test.ts`
      Expected: FAIL, because `SUPPORT_TOPICS` can't be imported.

- [ ] **Step 3: Implement the schema changes listed under Interfaces.**
  - The support tables go in `schema/support.ts` and import `users` from `./auth`.
  - The edits to the existing tables go in `schema/app.ts`, next to the columns they extend.

- [ ] **Step 4: Run the test and the typecheck.**
      Run: `cd packages/db && node_modules/.bin/vitest run src/db.test.ts && node_modules/.bin/tsc --noEmit -p .`
      Expected: PASS, with no type errors.

- [ ] **Step 5: Generate the migration.**
      Run: `cd packages/db && DATABASE_URL=postgres://unused@localhost/unused node_modules/.bin/drizzle-kit generate --name customer_care`
      Then check it: `grep -c "support_cases\|support_messages\|support_case_links\|export_links\|concierge_week_checks\|hidden_at\|reviewed_at" drizzle/0012_customer_care.sql`
      Expected: a count of at least 7, with no `DROP` statements.

- [ ] **Step 6: Commit.**

```bash
git add packages/db/src packages/db/drizzle
git commit -m "Add support cases, messages, links and the support role to the schema"
```

---

### Task 2: Support rules, link tokens and email text

**Files:**

- Create: `packages/db/src/support/rules.ts`, `tokens.ts`, `email.ts` and `index.ts`
- Modify: `packages/db/src/index.ts` (add `export * from "./support";`)
- Test: `packages/db/src/support/rules.test.ts`, `tokens.test.ts` and `email.test.ts`

**Interfaces:**

- Consumes: `weekStart` from `../concierge/rules`, and the Task 1 enums and types.
- Produces, in `rules.ts`:
  - **Constants:** `FIRST_REPLY_HOURS = 24`, `AUTO_SOLVE_DAYS = 7`, `REOPEN_DAYS = 14`, `STALE_REQUEST_DAYS = 3`, `EXPORT_LINK_HOURS = 24`, `SUBJECT_MAX = 120`, `MESSAGE_MAX = 5000` and `REASON_MAX = 300`.
  - **`SupportError`:** `class SupportError extends Error { readonly code: SupportErrorCode }`, where `SupportErrorCode = "not_allowed" | "conflict" | "not_found" | "forbidden"`. Its `name` is `"SupportError"`.
  - **`CaseActor`:** `"user" | "agent" | "system"`.
  - **`canMoveCase(from: CaseStatus, to: CaseStatus, actor: CaseActor, solvedAt: Date | null, now: Date): boolean`.** It returns false when `from === to`. Otherwise it allows:
    - an agent moving any status to `waiting_on_user`;
    - an agent moving `open` or `waiting_on_user` to `solved`;
    - an agent moving `solved` to `open`;
    - a user moving `waiting_on_user` to `open`;
    - a user moving `solved` to `open`, when `openToRequester` holds;
    - the system moving `waiting_on_user` to `solved`.
  - **`openToRequester(status: CaseStatus, solvedAt: Date | null, now: Date): boolean`:** false only once a case has been solved for more than `REOPEN_DAYS`.
  - **`firstReplyState(c: { kind: CaseKind; status: CaseStatus; createdAt: Date; firstRepliedAt: Date | null }, now: Date): { dueAt: Date; overdue: boolean } | null`:** null for escalations, for solved cases, and once a first reply exists.
  - **`weeklyCheckAction(i: { applied: number; target: number; hasOpenEscalation: boolean }): "skip" | "note" | "open"`.**
  - **`previousWeek(now: Date): { start: Date; end: Date }`:** from last Monday 00:00 UTC to this Monday 00:00 UTC.
  - **`normalizeEmail(email: string): string`:** trims and lowercases.
- Produces, in `tokens.ts`:
  - `newLinkToken(): { token: string; hash: string }`: 32 random bytes as base64url; the hash is SHA-256 hex. It uses `node:crypto`, because `packages/db` doesn't depend on `@gettargetrole/core`.
  - `hashLinkToken(token: string): string`.
- Produces, in `email.ts`:
  - `type CaseEmailEvent = "created" | "reply" | "solved" | "auto_solved"`.
  - `caseLink(appUrl: string, caseId: string, token: string): string`, which returns `${appUrl}/support/requests/${caseId}?key=${token}`.
  - `caseEmail(i: { number: number; subject: string; contactName: string; contactEmail: string; event: CaseEmailEvent; body?: string; link: string }): { to: string; subject: string; text: string }`.
  - `caseNotification(i: { userId: string; caseId: string; number: number; subject: string; event: "reply" | "solved" | "auto_solved" }): { userId: string; type: "support"; title: string; body: string; link: string }`:
    - titles: `Reply to request #<n>` for a reply, otherwise `Request #<n> solved`;
    - body: the subject;
    - link: `/support/requests/<caseId>`.

**Exact email text.**

- The subject is always `[#<number>] <subject>`.
- The greeting is `Hi <name>,`, or `Hi,` when the name is empty.
- Each text ends with `\n\nReplies to this email aren't read — use the link above.`

The body for each event:

- **created:** `We've got your request #<n>. We usually reply within a day.\n\n<link>`
- **reply:** `We replied to your request #<n>:\n\n<body>\n\nAnswer here: <link>`
- **solved:** `We've marked your request #<n> as solved. If you still need help, reply within 14 days to reopen it:\n\n<link>`
- **auto_solved:** `We haven't heard back about request #<n>, so we've marked it as solved. Reply within 14 days to reopen it:\n\n<link>`

- [ ] **Step 1: Write the failing tests.**

```ts
// rules.test.ts
const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
type Move = [CaseStatus, CaseStatus, CaseActor, Date | null];

it.each<Move>([
  ["open", "waiting_on_user", "agent", null],
  ["waiting_on_user", "open", "user", null],
  ["open", "solved", "agent", null],
  ["waiting_on_user", "solved", "system", null],
  ["solved", "open", "agent", daysAgo(30)],
  ["solved", "open", "user", daysAgo(13)],
  ["solved", "waiting_on_user", "agent", daysAgo(2)],
])("allows %s → %s by %s", (from, to, actor, solvedAt) => {
  expect(canMoveCase(from, to, actor, solvedAt, NOW)).toBe(true);
});

it.each<Move>([
  ["solved", "open", "user", daysAgo(15)],
  ["open", "solved", "user", null],
  ["open", "solved", "system", null],
  ["open", "waiting_on_user", "user", null],
  ["open", "open", "user", null],
])("refuses %s → %s by %s", (from, to, actor, solvedAt) => {
  expect(canMoveCase(from, to, actor, solvedAt, NOW)).toBe(false);
});

it("keeps the 24-hour target for help cases only", () => {
  const createdAt = new Date("2026-11-10T00:00:00Z");
  const help = { kind: "help" as const, status: "open" as const, createdAt, firstRepliedAt: null };
  expect(firstReplyState(help, new Date("2026-11-10T03:00:00Z"))).toEqual({
    dueAt: new Date("2026-11-11T00:00:00Z"),
    overdue: false,
  });
  expect(firstReplyState(help, new Date("2026-11-11T01:00:00Z"))?.overdue).toBe(true);
  expect(firstReplyState({ ...help, firstRepliedAt: createdAt }, NOW)).toBeNull();
  expect(firstReplyState({ ...help, kind: "escalation" }, NOW)).toBeNull();
  expect(firstReplyState({ ...help, status: "solved" }, NOW)).toBeNull();
});

it("decides the weekly check and finds last week", () => {
  expect(weeklyCheckAction({ applied: 9, target: 15, hasOpenEscalation: false })).toBe("open");
  expect(weeklyCheckAction({ applied: 9, target: 15, hasOpenEscalation: true })).toBe("note");
  expect(weeklyCheckAction({ applied: 15, target: 15, hasOpenEscalation: false })).toBe("skip");
  expect(weeklyCheckAction({ applied: 0, target: 0, hasOpenEscalation: false })).toBe("skip");
  const week = previousWeek(new Date("2026-11-10T08:00:00Z"));
  expect(week.start.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  expect(week.end.toISOString()).toBe("2026-11-09T00:00:00.000Z");
});

it("normalizes emails and keeps solved cases open to the requester for 14 days", () => {
  expect(normalizeEmail("  Riya@Example.COM ")).toBe("riya@example.com");
  expect(openToRequester("solved", daysAgo(13), NOW)).toBe(true);
  expect(openToRequester("solved", daysAgo(15), NOW)).toBe(false);
  expect(openToRequester("waiting_on_user", null, NOW)).toBe(true);
});

// tokens.test.ts
it("makes unguessable tokens and stores only their hash", () => {
  const a = newLinkToken();
  const b = newLinkToken();
  expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(hashLinkToken(a.token)).toBe(a.hash);
  expect(a.token).not.toBe(b.token);
});

// email.test.ts
it("writes reply emails with the subject format, the reply and the link", () => {
  const email = caseEmail({
    number: 1042,
    subject: "Can't sign in",
    contactName: "Riya",
    contactEmail: "riya@example.com",
    event: "reply",
    body: "Try the reset link.",
    link: "https://app.test/support/requests/c1?key=k",
  });
  expect(email).toMatchObject({ to: "riya@example.com", subject: "[#1042] Can't sign in" });
  expect(email.text).toContain("We replied to your request #1042:\n\nTry the reset link.");
  expect(email.text).toContain("Answer here: https://app.test/support/requests/c1?key=k");
  expect(email.text.endsWith("Replies to this email aren't read — use the link above.")).toBe(true);
  const unnamed = caseEmail({
    number: 7,
    subject: "Hello",
    contactName: "",
    contactEmail: "a@b.co",
    event: "created",
    link: "L",
  });
  expect(unnamed.text.startsWith("Hi,\n\n")).toBe(true);
});
```

- [ ] **Step 2: Run them and watch them fail.**
      Run: `cd packages/db && node_modules/.bin/vitest run src/support`
      Expected: FAIL, because the modules can't be found.

- [ ] **Step 3: Implement `rules.ts`, `tokens.ts` and `email.ts`** with the signatures and copy above. `index.ts` re-exports all three.

- [ ] **Step 4: Run the tests, the typecheck and the linter.**
      Run: `cd packages/db && node_modules/.bin/vitest run src/support && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src`
      Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src
git commit -m "Add the support case rules, link tokens and email text"
```

---

### Task 3: Case operations

**Files:**

- Create: `packages/db/src/support/cases.ts`, and export it from `support/index.ts`
- Test: `packages/db/src/support.integration.test.ts` (new)
  - Its harness copies `concierge.integration.test.ts`: `testDatabaseUrl("db")`, migrations in `beforeAll`, and `TRUNCATE users, companies RESTART IDENTITY CASCADE` in `beforeEach`.
  - It seeds `riya` (a user, riya@example.com), `ana` (support), `ada` (admin) and `priya` (specialist).

**Interfaces:**

- Consumes: the Task 1 tables, and from Task 2 `SupportError`, `canMoveCase`, `openToRequester`, `newLinkToken`, `hashLinkToken`, `normalizeEmail` and `AUTO_SOLVE_DAYS`.
- Produces:
  - `interface CaseNotice { caseId: string; number: number; subject: string; contactName: string; contactEmail: string; userId: string | null; token: string }`. The token is a fresh link token, already stored as a hash.
  - **`createCase(db, i): Promise<CaseNotice>`**, where `i` is `{ kind; source; topic; subject; body; userId: string | null; contactName; contactEmail; raisedByUserId: string | null; specialistId?: string | null; verified: boolean; visibility: MessageVisibility; authorKind: MessageAuthorKind; authorUserId: string | null; now?: Date }`.
    - It trims the subject and body, and slices them to `SUBJECT_MAX` and `MESSAGE_MAX`.
    - An empty body or subject throws `not_allowed`.
    - It normalizes `contactEmail`, and sets `verifiedAt = now` when `verified` is true.
  - **`accountIdForEmail(db, email: string): Promise<string | null>`:** matches on `normalizeEmail`.
  - **`takeCase(db, { caseId, agentId }): Promise<void>`:** a conditional update on `assignee_id is null`. If no row changes, it throws `conflict` with `CHANGED_MESSAGE`.
  - **`assignCase(db, { caseId, actorId, actorIsAdmin, toAgentId }): Promise<void>`:**
    - an actor who is neither the case's owner nor an admin gets `forbidden`, "Only the owner or an admin can hand this case off.";
    - a target whose role isn't `support` or `admin` gets `not_allowed`, "Pick a support agent or an admin.";
    - the update is conditional on the owner it read.
  - **`replyAsAgent(db, { caseId, agentId, body, now? }): Promise<CaseNotice>`:**
    - inserts a public `agent` message;
    - sets `status = waiting_on_user`, `first_replied_at = coalesce(first_replied_at, now)`, `assignee_id = coalesce(assignee_id, agentId)`, `solved_at = null`, `status_changed_at = now` and `last_message_at = now`;
    - an empty body gets `not_allowed`, "Write the reply first.".
  - **`addNote(db, { caseId, authorId: string | null, body, authorKind?: "agent" | "system", now? }): Promise<void>`:** an internal message. The status doesn't change.
  - **`replyAsRequester(db, { caseId, userId: string | null, body, now? }): Promise<void>`:**
    - once `!openToRequester`, it throws `not_allowed`, "This request is closed. Start a new request to reach us.";
    - otherwise it inserts a public `user` message, and moves `waiting_on_user` or `solved` to `open`, conditional on the status it read.
  - **`solveCase(db, { caseId, agentId: string | null, now? }): Promise<CaseNotice>`:** conditional on `status in ('open', 'waiting_on_user')`.
  - **`reopenCase(db, { caseId, agentId, now? }): Promise<void>`:** conditional on `status = 'solved'`.
  - **`verifyCase(db, { caseId, now? }): Promise<void>`.**
  - **`caseForLink(db, token: string, now?): Promise<string | null>`:** looks up the link by hash. It returns the case id only while `openToRequester` holds.
  - **`autoSolveCases(db, now?): Promise<CaseNotice[]>`:**
    - takes cases `waiting_on_user` with `status_changed_at <= now - AUTO_SOLVE_DAYS`;
    - solves each one conditionally, with the system note "Solved automatically after 7 days without a reply.".

- [ ] **Step 1: Write the failing tests** in `support.integration.test.ts`:

```ts
it("creates a signed-in request as verified, with a link that opens it", async () => {
  const notice = await db.createCase(database, helpInput({ userId: riya, verified: true }));
  const [row] = await database
    .select()
    .from(db.supportCases)
    .where(drizzle.eq(db.supportCases.id, notice.caseId));
  expect(row).toMatchObject({ status: "open", kind: "help", number: 1001, userId: riya });
  expect(row!.verifiedAt).toBeInstanceOf(Date);
  expect(await db.caseForLink(database, notice.token)).toBe(notice.caseId);
});

it("links a signed-out request to the account by email, ignoring case and spaces, without verifying it", async () => {
  const accountId = await db.accountIdForEmail(database, "  RIYA@Example.com ");
  expect(accountId).toBe(riya);
  const notice = await db.createCase(
    database,
    helpInput({ userId: accountId, verified: false, contactEmail: " RIYA@Example.com " }),
  );
  const [row] = await database
    .select()
    .from(db.supportCases)
    .where(drizzle.eq(db.supportCases.id, notice.caseId));
  expect(row).toMatchObject({ contactEmail: "riya@example.com", verifiedAt: null });
});

it("lets only one agent take a case", async () => {
  const { caseId } = await db.createCase(database, helpInput());
  const results = await Promise.allSettled([
    db.takeCase(database, { caseId, agentId: ana }),
    db.takeCase(database, { caseId, agentId: ada }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "conflict" },
  });
});

it("waits on the user after an agent's reply, takes the case, and reopens when the user answers", async () => {
  const { caseId } = await db.createCase(database, helpInput({ userId: riya, verified: true }));
  await db.replyAsAgent(database, { caseId, agentId: ana, body: "Try the reset link." });
  expect(await caseRow(caseId)).toMatchObject({ status: "waiting_on_user", assigneeId: ana });
  const firstReply = (await caseRow(caseId)).firstRepliedAt;
  await db.replyAsRequester(database, { caseId, userId: riya, body: "Still stuck." });
  await db.replyAsAgent(database, { caseId, agentId: ada, body: "Fixed now." });
  expect(await caseRow(caseId)).toMatchObject({
    status: "waiting_on_user",
    assigneeId: ana,
    firstRepliedAt: firstReply,
  });
  await expect(
    db.replyAsAgent(database, { caseId, agentId: ana, body: "   " }),
  ).rejects.toMatchObject({ code: "not_allowed" });
});

it("refuses a hand-off to someone who isn't staff, or by an agent who doesn't own the case", async () => {
  const { caseId } = await db.createCase(database, helpInput());
  await db.takeCase(database, { caseId, agentId: ana });
  await expect(
    db.assignCase(database, { caseId, actorId: ana, actorIsAdmin: false, toAgentId: riya }),
  ).rejects.toMatchObject({ code: "not_allowed" });
  await expect(
    db.assignCase(database, { caseId, actorId: priya, actorIsAdmin: false, toAgentId: ada }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await db.assignCase(database, { caseId, actorId: ada, actorIsAdmin: true, toAgentId: ada });
  expect((await caseRow(caseId)).assigneeId).toBe(ada);
});

it("reopens on a reply within 14 days of solving, and refuses replies and links after that", async () => {
  const solvedAt = new Date("2026-11-01T00:00:00Z");
  const { caseId, token } = await db.createCase(
    database,
    helpInput({ userId: riya, verified: true, now: new Date("2026-10-30T00:00:00Z") }),
  );
  await db.solveCase(database, { caseId, agentId: ana, now: solvedAt });
  const day = (n: number) => new Date(solvedAt.getTime() + n * 86_400_000);
  expect(await db.caseForLink(database, token, day(15))).toBeNull();
  await expect(
    db.replyAsRequester(database, { caseId, userId: riya, body: "Hello?", now: day(15) }),
  ).rejects.toMatchObject({ code: "not_allowed" });
  await db.replyAsRequester(database, { caseId, userId: riya, body: "Hello?", now: day(13) });
  expect((await caseRow(caseId)).status).toBe("open");
});

it("solves cases left waiting on the user for 7 days, with a note", async () => {
  const start = new Date("2026-11-01T00:00:00Z");
  const { caseId } = await db.createCase(database, helpInput({ now: start }));
  await db.replyAsAgent(database, {
    caseId,
    agentId: ana,
    body: "Can you send a screenshot?",
    now: start,
  });
  expect(await db.autoSolveCases(database, new Date("2026-11-07T23:00:00Z"))).toHaveLength(0);
  const solved = await db.autoSolveCases(database, new Date("2026-11-08T00:00:00Z"));
  expect(solved.map((notice) => notice.caseId)).toEqual([caseId]);
  expect(await messageBodies(caseId, "internal")).toContain(
    "Solved automatically after 7 days without a reply.",
  );
});
```

- `helpInput(overrides)` builds a signed-out `help` / `form` / `account` input for riya@example.com: subject "Can't sign in", body "I never got the email.", `visibility: "public"`, `authorKind: "user"`.
- `caseRow(id)` selects a case.
- `messageBodies(id, visibility)` selects a case's message bodies.

- [ ] **Step 2: Check the tests fail to compile.**
      Run: `cd packages/db && node_modules/.bin/tsc --noEmit -p .`
      Expected: errors, because `createCase` and the rest don't exist yet. (Without `TEST_DATABASE_URL` the suite is skipped, so the compile error is the red step.)

- [ ] **Step 3: Implement `cases.ts`** to the interfaces above. A private `mintLink(db, caseId)` inserts a `support_case_links` row and returns the token, and every function that returns a `CaseNotice` calls it.

- [ ] **Step 4: Run the checks.**
      Run: `cd packages/db && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src && node_modules/.bin/vitest run`
      Expected: PASS. The integration suite runs in CI.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src
git commit -m "Create support cases, take and hand them off, and keep the reply thread and statuses"
```

---

### Task 4: Board and requester queries

**Files:**

- Create: `packages/db/src/support/queries.ts`, and export it
- Test: `packages/db/src/support.integration.test.ts`

**Interfaces:**

- Consumes: Task 3, and `firstReplyState` and `FIRST_REPLY_HOURS` from Task 2.
- Produces:
  - **`type CaseQueue = "open" | "mine" | "unassigned" | "overdue" | "waiting" | "solved"`.** The default is `open`, meaning every unsolved case.
  - **`interface CaseRow { id; number; subject; topic; kind; status; requesterName: string; requesterEmail: string; requesterPlan: Plan | null; assigneeName: string | null; createdAt: Date; lastMessageAt: Date | null; due: { dueAt: Date; overdue: boolean } | null }`.**
  - **`listCases(db, { queue, agentId, topic?, search?, now?, limit = 200 }): Promise<CaseRow[]>`:**
    - Unsolved cases sort overdue first, then by `created_at` ascending.
    - `solved` shows the last 30 days by `solved_at`, newest first.
    - `search` matches the number (with any leading `#` dropped), or an `ilike` on the contact email and subject.
  - **`careCounts(db, now?): Promise<{ unassigned: number; overdue: number; waiting: number; typicalFirstReplyMinutes: number | null }>`.** The typical first reply is `percentile_cont(0.5)` over help cases created in the last 7 days that have a first reply.
  - **`caseThread(db, caseId, { includeInternal: boolean }): Promise<{ case: typeof supportCases.$inferSelect; messages: Array<{ id: string; authorKind: MessageAuthorKind; authorName: string | null; visibility: MessageVisibility; body: string; createdAt: Date }> } | null>`.**
  - **`userCases(db, userId): Promise<Array<{ id; number; subject; status: CaseStatus; lastMessageAt: Date | null }>>`:** cases about the user that the user raised, or that have a public agent message.
  - **`canUserSeeCase(db, { caseId, userId }): Promise<boolean>`:** the same rule as `userCases`.
  - **`otherCases(db, { caseId, userId: string | null, contactEmail, limit = 5 })`.**
  - **`activeSpecialistId(db, clientId): Promise<string | null>`.**
  - **`latestEscalation(db, clientId): Promise<{ id: string; number: number; status: CaseStatus } | null>`.**
  - **`supportExport(db, userId): Promise<{ cases: …; messages: … }>`:** the user's cases, and only their public messages. It's used by the data export.

- [ ] **Step 1: Write the failing tests:**

```ts
it("lists the queues: overdue first, mine and unassigned, and solved in the last 30 days", async () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const old = await db.createCase(database, helpInput({ now: new Date("2026-11-09T00:00:00Z") }));
  const fresh = await db.createCase(database, helpInput({ now: new Date("2026-11-10T11:00:00Z") }));
  await db.takeCase(database, { caseId: fresh.caseId, agentId: ana });
  const open = await db.listCases(database, { queue: "open", agentId: ana, now });
  expect(open.map((row) => row.id)).toEqual([old.caseId, fresh.caseId]);
  expect(open[0]!.due?.overdue).toBe(true);
  expect(
    (await db.listCases(database, { queue: "mine", agentId: ana, now })).map((r) => r.id),
  ).toEqual([fresh.caseId]);
  expect(
    (await db.listCases(database, { queue: "unassigned", agentId: ana, now })).map((r) => r.id),
  ).toEqual([old.caseId]);
  expect(
    (
      await db.listCases(database, { queue: "open", agentId: ana, search: `#${old.number}`, now })
    ).map((r) => r.id),
  ).toEqual([old.caseId]);
});

it("counts unassigned, overdue and waiting cases, and the typical first reply", async () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const a = await db.createCase(database, helpInput({ now: at(5) }));
  const b = await db.createCase(database, helpInput({ now: at(6) }));
  await db.createCase(database, helpInput({ now: at(48) })); // unanswered, so it's overdue
  await db.replyAsAgent(database, { caseId: a.caseId, agentId: ana, body: "On it.", now: at(4) }); // after 60 minutes
  await db.replyAsAgent(database, { caseId: b.caseId, agentId: ana, body: "On it.", now: at(4) }); // after 120 minutes
  expect(await db.careCounts(database, now)).toEqual({
    unassigned: 1,
    overdue: 1,
    waiting: 2,
    typicalFirstReplyMinutes: 90,
  });
});

it("shows users their own requests, and escalations only once an agent has written to them", async () => {
  const own = await db.createCase(
    database,
    helpInput({ userId: riya, raisedByUserId: riya, verified: true }),
  );
  const escalation = await db.createCase(database, escalationInput({ userId: riya }));
  expect((await db.userCases(database, riya)).map((row) => row.id)).toEqual([own.caseId]);
  await db.replyAsAgent(database, {
    caseId: escalation.caseId,
    agentId: ana,
    body: "Checking in.",
  });
  expect((await db.userCases(database, riya)).map((row) => row.id).sort()).toEqual(
    [own.caseId, escalation.caseId].sort(),
  );
});

it("keeps internal notes out of the requester's thread and the data export", async () => {
  const { caseId } = await db.createCase(
    database,
    helpInput({ userId: riya, raisedByUserId: riya, verified: true }),
  );
  await db.addNote(database, { caseId, authorId: ana, body: "Looks like a typo in their email." });
  const thread = await db.caseThread(database, caseId, { includeInternal: false });
  expect(thread!.messages.map((m) => m.visibility)).toEqual(["public"]);
  const exported = await db.supportExport(database, riya);
  expect(exported.messages.every((m) => m.visibility === "public")).toBe(true);
});
```

`escalationInput(overrides)` is an `escalation` / `specialist` / `concierge` input with an internal agent note from priya.

- [ ] **Step 2: Typecheck and watch it fail.**
      Run: `cd packages/db && node_modules/.bin/tsc --noEmit -p .`
      Expected: errors, because the queries are missing.

- [ ] **Step 3: Implement `queries.ts`** to the interfaces above.

- [ ] **Step 4: Run the checks.**
      Run: `cd packages/db && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src && node_modules/.bin/vitest run`
      Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src
git commit -m "Add the care board's queues, counts and threads, and the requester's own list"
```

---

### Task 5: Account summary, export links and the deletion rule

**Files:**

- Create: `packages/db/src/support/accounts.ts`, and export it
- Test: `packages/db/src/support.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 (`exportLinks`), Task 2 (tokens and `EXPORT_LINK_HOURS`), and Task 3 cases.
- Produces:
  - **`interface AccountSummary { id; name; email; emailVerified: boolean; plan: Plan; role: Role; createdAt: Date; banned: boolean; banReason: string | null; lastSignInAt: Date | null; applicationsByStatus: Partial<Record<ApplicationStatus, number>>; resumes: number; openCases: number; solvedCases: number }`.** `lastSignInAt` is the latest `auth.sign_in` audit entry whose actor is the user.
  - **`accountSummary(db, userId): Promise<AccountSummary | null>`.**
  - **`accountActivity(db, userId, limit = 20): Promise<Array<{ action: string; createdAt: Date; actorEmail: string | null }>>`:** audit rows where the user is the actor, or `target_id = userId`.
  - **`deletableForCase(db, { userId, caseId }): Promise<boolean>`:** true only for a `help` case with the topic `data`, `user_id = userId`, `verified_at` set, and a status other than `solved`.
  - **`createExportLink(db, { userId, createdBy, now? }): Promise<string>`:** returns the token.
  - **`exportLinkUsable(db, token, now?): Promise<boolean>`:** doesn't use the link up.
  - **`redeemExportLink(db, token, now?): Promise<string | null>`:** a conditional update `used_at is null and expires_at > now` that returns the user id.

- [ ] **Step 1: Write the failing tests:**

```ts
it("summarizes an account: plan, last sign-in, applications by status and cases", async () => {
  // Seeds: 2 applied and 1 saved application, a resume, one open and one solved case, and an auth.sign_in audit row.
  expect(await db.accountSummary(database, riya)).toMatchObject({
    plan: "free",
    role: "user",
    applicationsByStatus: { applied: 2, saved: 1 },
    resumes: 1,
    openCases: 1,
    solvedCases: 1,
    lastSignInAt: signInAt,
  });
});

it("allows deletion only for an open, verified 'My data' request from that account", async () => {
  const data = (o = {}) => helpInput({ topic: "data", userId: riya, verified: true, ...o });
  const ok = await db.createCase(database, data());
  const wrongTopic = await db.createCase(database, data({ topic: "account" }));
  const unverified = await db.createCase(database, data({ verified: false }));
  const solved = await db.createCase(database, data());
  await db.solveCase(database, { caseId: solved.caseId, agentId: ana });
  expect(await db.deletableForCase(database, { userId: riya, caseId: ok.caseId })).toBe(true);
  for (const c of [wrongTopic, unverified, solved]) {
    expect(await db.deletableForCase(database, { userId: riya, caseId: c.caseId })).toBe(false);
  }
  expect(await db.deletableForCase(database, { userId: ana, caseId: ok.caseId })).toBe(false);
});

it("uses an export link once, only on redeem, and not after 24 hours", async () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const token = await db.createExportLink(database, { userId: riya, createdBy: ana, now });
  expect(await db.exportLinkUsable(database, token, now)).toBe(true);
  expect(await db.exportLinkUsable(database, token, now)).toBe(true); // a scanner's visit doesn't use it up
  expect(await db.redeemExportLink(database, token, now)).toBe(riya);
  expect(await db.redeemExportLink(database, token, now)).toBeNull();
  const late = await db.createExportLink(database, { userId: riya, createdBy: ana, now });
  expect(await db.redeemExportLink(database, late, new Date("2026-11-11T00:00:01Z"))).toBeNull();
});
```

- [ ] **Step 2: Typecheck and watch it fail.** Same command as Task 4.
- [ ] **Step 3: Implement `accounts.ts`.**
- [ ] **Step 4: Run the checks.** Same command as Task 4.
- [ ] **Step 5: Commit.**

```bash
git add packages/db/src
git commit -m "Summarize accounts for care, add single-use export links and the deletion rule"
```

---

### Task 6: Report review, ghost scoring and hidden jobs

**Files:**

- Create: `packages/db/src/support/reports.ts`, and export it
- Modify: `packages/jobs/src/ghosts.ts`. In `scoreGhostJobs`, the reports subquery counts only `r.reason <> 'wrong_details' and r.resolution is distinct from 'kept'`.
- Modify: `packages/jobs/src/alerts.ts`. `openJobs` adds `isNull(jobs.hiddenAt)`.
- Modify: `packages/db/src/concierge/proposals.ts`. The `proposeJobs` open-jobs query adds `isNull(jobs.hiddenAt)`.
- Modify: `apps/web/src/server/data/jobs.ts`. `whereFor` adds `isNull(jobs.hiddenAt)`, which also covers `topMatches` and the specialist's Find tab.
- Test: `packages/jobs/src/ghosts.integration.test.ts`, `packages/db/src/support.integration.test.ts` and `packages/db/src/concierge.integration.test.ts`

**Interfaces:**

- Produces:
  - **`interface ReportedJob { jobId; title; companyName; location; postedAt: Date | null; ghostScore: number; applyUrl: string; reports: number; reasons: Partial<Record<JobReportReason, number>>; notes: string[]; firstReportedAt: Date }`.** `notes` holds up to the three latest non-empty notes.
  - **`reportQueue(db, limit = 100): Promise<ReportedJob[]>`:**
    - open, unhidden jobs that have reports with `reviewed_at is null`;
    - sorted by report count descending, then oldest report first.
  - **`keepReportedJob(db, { jobId, agentId, now? }): Promise<number>`:** marks the unreviewed reports `kept` and returns how many. The caller then runs `scoreGhostJobs(db, { jobIds: [jobId] })`.
  - **`hideJob(db, { jobId, agentId, reason, now? }): Promise<void>`:** sets `hidden_at`, `hidden_by_user_id` and `hidden_reason`, and marks the unreviewed reports `hidden`.
  - **`unhideJob(db, { jobId }): Promise<void>`:** clears the hidden fields.
  - **`recentlyHiddenJobs(db, { now?, days = 30 }): Promise<Array<{ jobId; title; companyName; hiddenAt: Date; hiddenReason: string; hiddenByName: string | null }>>`.**

- [ ] **Step 1: Write the failing tests.**

  In `packages/jobs/src/ghosts.integration.test.ts`, where `reportFrom(userIds, jobId, reason)` inserts each user if missing, then that user's report:

```ts
it("doesn't count wrong-details reports or reports care kept", async () => {
  const id = await addJob();
  await reportFrom(["u1", "u2"], id, "not_real");
  await reportFrom(["u3"], id, "wrong_details");
  await ghosts.scoreGhostJobs(db.getDb(), { jobIds: [id] });
  expect((await ghostOf(id)).score).toBe(2 * ghosts.GHOST_POINTS.report);
  await db.keepReportedJob(db.getDb(), { jobId: id, agentId: "u1" });
  await ghosts.scoreGhostJobs(db.getDb(), { jobIds: [id] });
  expect((await ghostOf(id)).score).toBe(0);
});

it("sends no alerts for hidden jobs", async () => {
  // As "sends no alerts for likely ghost jobs", but with hiddenAt set instead of a high ghost score.
  expect(await alerts.createJobAlerts([hiddenId], db.getDb())).toBe(0);
});
```

In `support.integration.test.ts`:

```ts
it("queues jobs with unreviewed reports, most reported first, and clears them when kept or hidden", async () => {
  // Job A has 2 reports and job B has 1.
  expect((await db.reportQueue(database)).map((j) => j.jobId)).toEqual([jobA, jobB]);
  await db.keepReportedJob(database, { jobId: jobA, agentId: ana });
  await db.hideJob(database, { jobId: jobB, agentId: ana, reason: "Duplicate of another post" });
  expect(await db.reportQueue(database)).toEqual([]);
  expect((await db.recentlyHiddenJobs(database, {})).map((j) => j.jobId)).toEqual([jobB]);
  await db.unhideJob(database, { jobId: jobB });
  expect(await db.recentlyHiddenJobs(database, {})).toEqual([]);
});
```

In `concierge.integration.test.ts`:

```ts
it("won't propose a hidden job", async () => {
  await database
    .update(db.jobs)
    .set({ hiddenAt: new Date() })
    .where(drizzle.eq(db.jobs.id, jobIds[0]!));
  const result = await propose([jobIds[0]!]);
  expect(result).toMatchObject({ created: [], unavailable: [jobIds[0]] });
});
```

- [ ] **Step 2: Typecheck all three packages and watch them fail.**
      Run: `cd packages/db && node_modules/.bin/tsc --noEmit -p . ; cd ../jobs && node_modules/.bin/tsc --noEmit -p .`
      Expected: errors, because the report functions are missing.

- [ ] **Step 3: Implement `reports.ts`, and the four query edits listed under Files.**

- [ ] **Step 4: Run the checks.**
      Run: `for p in packages/db packages/jobs apps/web; do (cd $p && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src) || exit 1; done; (cd packages/db && node_modules/.bin/vitest run) && (cd packages/jobs && node_modules/.bin/vitest run)`
      Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src packages/jobs/src apps/web/src/server/data/jobs.ts
git commit -m "Review reported jobs: keep them, or hide them from search, alerts and proposals"
```

---

### Task 7: The company-request queue

**Files:**

- Create: `packages/db/src/support/company-requests.ts`, and export it
- Test: `packages/db/src/support.integration.test.ts`

**Interfaces:**

- Consumes: `STALE_REQUEST_DAYS` (Task 2), and `companyRequests` (with `declined` from Task 1).
- Produces:
  - **`interface QueuedRequest { id; name; url; status: "pending" | "not_found"; requesterId: string | null; requesterEmail: string | null; note: string; createdAt: Date }`.**
  - **`companyRequestQueue(db, now?): Promise<QueuedRequest[]>`:** `source = 'user'` requests that are `not_found`, or `pending` with `created_at <= now - 3 days`. Oldest first.
  - **`resolveCompanyRequests(db, { requestId, companyId, status: "added" | "tracked" }): Promise<Array<{ userId: string; name: string }>>`:**
    - resolves the request and every other `pending` or `not_found` user request for the same company;
    - returns the requesters to notify.
    - **Same company** means the same name after `trim().toLowerCase()`, or the same `new URL(url).hostname` with a leading `www.` dropped. Matching is done in TypeScript on the candidate rows, and a URL that doesn't parse simply doesn't match.
  - **`declineCompanyRequest(db, { requestId, reason }): Promise<{ userId: string | null; name: string }>`:** sets the status to `declined` and the note to the reason. An empty reason gets `not_allowed`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("queues user requests that weren't found or have been pending 3 days, and leaves out YC imports", async () => {
  // Seeds: a not_found user request; a user request pending 4 days; one pending 1 day; and a not_found yc request.
  expect((await db.companyRequestQueue(database, now)).map((r) => r.name)).toEqual([
    "Globex",
    "Initech",
  ]);
});

it("resolves every open request for the same company, by name or careers host", async () => {
  // Requests "Globex" (riya), " globex " (ana) and "Globex Corp" at https://www.globex.com/careers (ada).
  // An earlier request was already declined.
  const told = await db.resolveCompanyRequests(database, {
    requestId: first,
    companyId,
    status: "added",
  });
  expect(told.map((t) => t.userId).sort()).toEqual([ada, ana, riya].sort());
  // The declined request stays declined.
});

it("declines a request with the reason saved", async () => {
  await db.declineCompanyRequest(database, {
    requestId,
    reason: "Their jobs are only on LinkedIn.",
  });
  // The row has status "declined" and the note "Their jobs are only on LinkedIn."
});
```

- [ ] **Step 2: Typecheck and watch it fail.**
- [ ] **Step 3: Implement `company-requests.ts`.**
- [ ] **Step 4: Run the checks.** Same command as Task 4.
- [ ] **Step 5: Commit.**

```bash
git add packages/db/src
git commit -m "Queue company requests discovery couldn't resolve, and resolve or decline them"
```

---

### Task 8: The Monday missed-target check

**Files:**

- Create: `packages/db/src/support/weekly-check.ts`, and export it
- Test: `packages/db/src/support.integration.test.ts`

**Interfaces:**

- Consumes:
  - from Task 2: `previousWeek` and `weeklyCheckAction`;
  - from the Concierge rules: `targetFor`;
  - from Task 3: `createCase` and `addNote`;
  - from Task 4: `activeSpecialistId`.
- Produces: `runWeeklyCheck(db, now = new Date()): Promise<{ opened: number; noted: number }>`.

**Algorithm:** for `{ start, end } = previousWeek(now)`:

1. Select active assignments where `specialist_assignments.created_at < start`, the user's plan is `concierge`, and the profile isn't paused. Left-join `profiles`, so a missing profile counts as not paused, with no override.
2. Count each client's applications with `applied_at >= start and applied_at < end`.
3. For each client, `insert into concierge_week_checks (client_id, week_start) … on conflict do nothing returning`. Skip the client unless a row was inserted.
4. Look up whether the client has an unsolved escalation, then apply `weeklyCheckAction({ applied, target: targetFor(override), hasOpenEscalation })`:
   - **`note`:** `addNote(system)` with the text `Missed the week of <Mon d>: <applied> of <target>`, for example "Missed the week of Nov 2: 9 of 15".
   - **`open`:** `createCase` with these fields:
     - `kind: "escalation"`, `source: "weekly_check"`, `topic: "concierge"`;
     - the subject `Missed weekly target: <applied> of <target>`;
     - the user, contact name and contact email set to the client's;
     - `raisedByUserId: null`, and `specialistId` set to the active specialist;
     - `visibility: "internal"`, `authorKind: "system"`;
     - the same note text as the body.
   - **`skip`:** nothing.

The date in the note is formatted with `toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })`.

- [ ] **Step 1: Write the failing tests:**

```ts
const monday = new Date("2026-11-09T06:00:00Z"); // checks the week of Nov 2

it("opens one escalation for a client who missed last week, then notes the next miss", async () => {
  // riya is a Concierge client assigned on Oct 1, with 9 applications last week.
  expect(await db.runWeeklyCheck(database, monday)).toEqual({ opened: 1, noted: 0 });
  const nextMonday = new Date("2026-11-16T06:00:00Z");
  expect(await db.runWeeklyCheck(database, nextMonday)).toEqual({ opened: 0, noted: 1 });
  // The case's subject is "Missed weekly target: 9 of 15", and its internal notes include "Missed the week of Nov 9: 0 of 15".
});

it("skips paused clients and clients assigned during the week, and runs once a week", async () => {
  // One client paused, one assigned Nov 4.
  expect(await db.runWeeklyCheck(database, monday)).toEqual({ opened: 0, noted: 0 });
  // riya missed: the first run opens a case, and a second run on the same Monday does nothing.
});

it("uses the plan's default target when the client has no profile row", async () => {
  // Delete riya's profiles row, with 3 applications last week.
  expect(await db.runWeeklyCheck(database, monday)).toEqual({ opened: 1, noted: 0 });
  // The subject is "Missed weekly target: 3 of 15".
});
```

- [ ] **Step 2: Typecheck and watch it fail.**
- [ ] **Step 3: Implement `weekly-check.ts`** as described above.
- [ ] **Step 4: Run the checks.** Same command as Task 4.
- [ ] **Step 5: Commit.**

```bash
git add packages/db/src
git commit -m "Escalate Concierge clients who missed last week's target, once per week"
```

---

### Task 9: Web foundations: role, IP, errors, labels, access and mail

**Files:**

- Modify: `apps/web/src/server/session.ts`. `toSessionUser` keeps `"support"`.
- Modify: `apps/web/src/app/(app)/admin/admin-client.tsx`. The role select gains `<option value="support">Support</option>`.
- Modify: `packages/core/src/rate-limit.ts`, adding `supportForm: { points: 5, duration: 60 * 60 }`, `supportRequest: { points: 20, duration: 24 * 60 * 60 }` and `supportReply: { points: 60, duration: 60 * 60 }`.
- Create: `apps/web/src/lib/client-ip.ts`, `support-errors.ts`, `support-labels.ts` and `care-rules.ts`, each with a `.test.ts`
- Modify: `apps/web/src/server/action.ts` (`publicAction`)
- Create: `apps/web/src/server/care.ts` and `apps/web/src/server/support-mail.ts`

**Interfaces:**

- **`clientIp(headers: Headers, trustedProxies: string[]): string`:**
  - It walks `x-forwarded-for` from the right and returns the first address that isn't in `trustedProxies`. Matching uses `net.BlockList`: `addSubnet` for CIDRs, `addAddress` for single IPs, and `net.isIP` for the family.
  - Without one, it uses `x-real-ip`, then `"unknown"`.
- **`toSupportError(error: unknown): unknown`** and **`withSupport<T>(run: () => Promise<T>): Promise<T>`:** `conflict` becomes `ConflictError(message)`, `forbidden` becomes `ForbiddenError(message)`, `not_found` becomes `NotFoundError("Request")`, and anything else becomes `ValidationError(message)`. Other errors pass through unchanged.
- **`SUPPORT_TOPIC_LABEL: Record<SupportTopic, string>`:** the spec's labels, such as "Account & sign-in".
- **`USER_STATUS_LABEL`:** "With our team", "Waiting on you" and "Solved".
- **`STAFF_STATUS_LABEL`:** "Open", "Waiting on user" and "Solved".
- **`dueLabel(state: { dueAt: Date; overdue: boolean }, now: Date): string`:** "Due in 3h", "Due in 45m", "Overdue by 5h" or "Overdue by 20m". Whole hours from 60 minutes up, minutes below that.
- **`canActOnAccount(staff: { id: string; role: Role }, target: { id: string; role: Role }): boolean`:** false on oneself. Admins may act on anyone else; support agents only on a `user`.
- **`publicAction<S, R>(schema, handler: (input, user: SessionUser | null, ip: string) => Promise<R>, options: { signedIn: RateLimitPolicy; signedOut: RateLimitPolicy })`:** works like `authedAction`, but without a session check.
  - The rate-limit key is the user id when signed in, otherwise `ip:<clientIp>`.
  - The IP comes from `clientIp(await headers(), getServerEnv().TRUSTED_PROXIES)`.
- **`requireCareAgent(): Promise<SessionUser>`:** returns `requireRole("support", "admin")`.
- **`assertCanActOnAccount(staff: SessionUser, userId: string): Promise<{ id: string; role: Role; name: string; email: string }>`:** loads the target and throws `ForbiddenError("Staff accounts are managed by admins.")` when `canActOnAccount` is false. It throws `ForbiddenError("You can't change your own account here.")` when the target is the staff member's own account.
- **`careAgents(): Promise<Array<{ id: string; name: string }>>`:** users with role `support` or `admin`.
- **`notifyRequester(notice: CaseNotice, event: CaseEmailEvent, body?: string): Promise<void>`:**
  - inserts `caseNotification(...)` when `notice.userId` is set and the event isn't `created`;
  - then calls `sendEmail(caseEmail({ ..., link: caseLink(APP_URL, notice.caseId, notice.token) }))`, catching and logging any failure.

- [ ] **Step 1: Write the failing tests:**

```ts
// client-ip.test.ts
it("uses the rightmost address that isn't a trusted proxy", () => {
  const h = (xff: string, real?: string) =>
    new Headers({ "x-forwarded-for": xff, ...(real ? { "x-real-ip": real } : {}) });
  expect(clientIp(h("203.0.113.9, 10.0.0.5"), ["10.0.0.0/8"])).toBe("203.0.113.9");
  expect(clientIp(h("1.1.1.1, 203.0.113.9"), [])).toBe("203.0.113.9"); // a spoofed leftmost entry is ignored
  expect(clientIp(h("2001:db8::1, 192.0.2.1"), ["192.0.2.1"])).toBe("2001:db8::1");
  expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }), [])).toBe("198.51.100.7");
  expect(clientIp(new Headers(), [])).toBe("unknown");
});

// support-errors.test.ts
it("turns support rule breaks into readable app errors", () => {
  expect(toSupportError(new SupportError("conflict", "This changed"))).toBeInstanceOf(
    ConflictError,
  );
  const forbidden = toSupportError(new SupportError("forbidden", "Only the owner"));
  expect(forbidden).toBeInstanceOf(ForbiddenError);
  expect((forbidden as Error).message).toBe("Only the owner");
  expect((toSupportError(new SupportError("not_found", "x")) as Error).message).toBe(
    "Request not found.",
  );
});

// support-labels.test.ts
it("labels due times in hours, or minutes under an hour", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  expect(dueLabel({ dueAt: at(190), overdue: false }, now)).toBe("Due in 3h");
  expect(dueLabel({ dueAt: at(45), overdue: false }, now)).toBe("Due in 45m");
  expect(dueLabel({ dueAt: at(-300), overdue: true }, now)).toBe("Overdue by 5h");
  expect(dueLabel({ dueAt: at(-20), overdue: true }, now)).toBe("Overdue by 20m");
});

// care-rules.test.ts
it("lets support act only on regular users, and nobody on themselves", () => {
  const staff = (role: Role) => ({ id: "s", role });
  expect(canActOnAccount(staff("support"), { id: "u", role: "user" })).toBe(true);
  expect(canActOnAccount(staff("support"), { id: "u", role: "specialist" })).toBe(false);
  expect(canActOnAccount(staff("support"), { id: "u", role: "admin" })).toBe(false);
  expect(canActOnAccount(staff("admin"), { id: "u", role: "support" })).toBe(true);
  expect(canActOnAccount(staff("admin"), { id: "s", role: "admin" })).toBe(false);
});
```

- [ ] **Step 2: Run them and watch them fail.**
      Run: `cd apps/web && node_modules/.bin/vitest run src/lib`
      Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement the files listed under Files** to the interfaces above.

- [ ] **Step 4: Run the checks.**
      Run: `cd apps/web && node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src && cd ../../packages/core && node_modules/.bin/tsc --noEmit -p .`
      Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src packages/core/src/rate-limit.ts
git commit -m "Add the support role to sessions, client IPs, support errors, labels, access rules and requester mail"
```

---

### Task 10: The user side: Contact support and your requests

**Files:**

- Create: `apps/web/src/components/app-shell/shell.tsx`. `AppShell({ user, children })` holds today's `(app)/layout.tsx` markup, and that layout now renders `<AppShell>`.
- Create: `apps/web/src/app/(support)/layout.tsx`. With a session it renders `AppShell`; without one, a header with the logo and a "Sign in" link.
- Create: `apps/web/src/app/(support)/support/page.tsx` and `support-form.tsx` (a client component)
- Create: `apps/web/src/app/(support)/support/actions.ts`
- Create: `apps/web/src/app/(support)/support/requests/page.tsx`, plus `requests/[id]/page.tsx` and `thread-client.tsx`
- Modify: `apps/web/src/components/app-shell/nav.tsx`. A "Contact support" link (icon `LifeBuoy`) goes at the bottom of the sidebar and the mobile menu.
- Modify: `apps/web/src/app/(app)/settings/page.tsx`. "Contact support" becomes a link to `/support`.
- Modify: `apps/web/src/app/(auth)/auth-forms.tsx`. The sign-in form gets "Can't sign in? Contact support".
- Modify: `apps/web/src/server/data/account.ts`. `exportUserData` adds `support: await supportExport(db, userId)`.

**Interfaces:**

- Consumes: Tasks 3, 4 and 9.
- Produces, in `support/actions.ts`:
  - **`submitSupportRequest({ topic, subject, message, name?, email?, website?, followUpTo? }) → ActionResult<{ number: number }>`**, through `publicAction` with `signedIn: "supportRequest"` and `signedOut: "supportForm"`.
    - **The honeypot:** a non-empty `website` returns `{ number: 0 }` without saving. The form still shows the normal confirmation for that case.
    - **Signed in:** the account's name and email, with `userId` and `raisedByUserId` set to the user, and `verified: true`.
    - **Signed out:** `name` and `email` are required. `userId` comes from `accountIdForEmail(email)`, `raisedByUserId` is null, and `verified` is false.
    - **The Concierge topic:** `specialistId = await activeSpecialistId(db, userId)`.
    - **A follow-up:** `followUpTo` puts "Follow-up to #<n>" at the start of the body.
    - **Afterwards:** it calls `notifyRequester(notice, "created")`, and writes the audit entry `support.case.create`.
  - **`replyToRequest({ caseId, message, key? }) → ActionResult<null>`**, with `signedIn` and `signedOut` both `"supportReply"`. The requester must be allowed to see the case: either signed in with `canUserSeeCase` true, or holding a `key` for which `caseForLink(key) === caseId`. It then calls `replyAsRequester`.
  - **`confirmRequest({ caseId, key }) → ActionResult<null>`:** checks the key with `caseForLink` and calls `verifyCase`.

**Pages and copy:**

- **`/support`:**
  - The form has a topic select from `SUPPORT_TOPIC_LABEL`, a subject (`maxLength` 120), a message (`maxLength` 5,000), and, when signed out, a name and email.
  - The honeypot `website` input sits in a visually hidden wrapper with `aria-hidden` and `tabIndex={-1}`.
  - The `data` topic shows: "You can also export or delete your data yourself in Settings."
  - On success: "We've got it — request #<n>. We usually reply within a day."
  - `?followUp=<n>` fills the form in for a follow-up.
- **`/support/requests`:** signed in only, and it redirects to sign-in otherwise. It lists `userCases`, with each status shown as `USER_STATUS_LABEL`.
- **`/support/requests/[id]`:** the public thread from `caseThread(…, { includeInternal: false })` and a reply box. Access is the same as for `replyToRequest`; anyone else gets `notFound()`.
  - A case linked to an account that isn't verified and was opened through a key shows the button "Yes, I made this request".
  - Once `openToRequester` is false, the reply box becomes "This request is closed." and a "Start a new request" link to `/support?followUp=<n>`.

- [ ] **Step 1: Implement `support/actions.ts`** to the interfaces above. The submit schema is:

```ts
const submitSchema = z.object({
  topic: z.enum(SUPPORT_TOPICS),
  subject: z.string().trim().min(1, "Add a subject").max(120),
  message: z.string().trim().min(1, "Write your message").max(5000),
  name: z.string().trim().max(100).optional(),
  email: z.union([z.literal(""), z.email()]).optional(),
  website: z.string().optional(),
  followUpTo: z.number().int().positive().optional(),
});
```

- [ ] **Step 2: Implement the rest:** the `AppShell` extraction, the `(support)` layout, the pages, the links and the `exportUserData` change.

- [ ] **Step 3: Run the checks.**
      Run: `cd apps/web && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src && node_modules/.bin/vitest run`
      Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src
git commit -m "Let users contact support signed in or out, follow their requests and reply in the app"
```

---

### Task 11: The care board: requests and the case page

**Files:**

- Create: `apps/web/src/app/(app)/care/page.tsx`. It reads `?tab=requests|reports|companies|users` and `?queue=`, `?topic=` and `?q=`, and renders the tab nav.
- Create: `apps/web/src/app/(app)/care/tabs/requests.tsx`, showing the counts and the case table
- Create: `apps/web/src/app/(app)/care/cases/[id]/page.tsx`
- Create: `apps/web/src/app/(app)/care/actions.ts` (the case actions)
- Create: `apps/web/src/app/(app)/care/case-client.tsx`, with `TakeButton`, `HandOffForm`, `CaseReplyBox` (whose buttons are "Send reply" and "Add note"), `SolveButton` and `ReopenButton`
- Modify: `apps/web/src/components/app-shell/nav.tsx`. The Staff group gets `{ href: "/care", label: "Customer care", icon: Headset }` for `support` and `admin`.

**Interfaces:**

- Consumes: Tasks 3 and 4; `accountSummary` (Task 5); and `careAgents`, `withSupport`, `notifyRequester`, `dueLabel` and `STAFF_STATUS_LABEL` (Task 9).
- Produces, in `care/actions.ts`, all through `authedAction` with `roles: ["support", "admin"]` and wrapped in `withSupport`:

  | Action                               | Calls                                                            | Audit entry        |
  | ------------------------------------ | ---------------------------------------------------------------- | ------------------ |
  | `takeCaseAction({ caseId })`         | `takeCase`                                                       | `care.case.take`   |
  | `handOffCase({ caseId, toAgentId })` | `assignCase` (`actorIsAdmin = user.role === "admin"`)            | `care.case.assign` |
  | `replyToCase({ caseId, message })`   | `replyAsAgent`, then `notifyRequester(notice, "reply", message)` | `care.case.reply`  |
  | `addCaseNote({ caseId, message })`   | `addNote`                                                        | `care.case.note`   |
  | `solveCaseAction({ caseId })`        | `solveCase`, then `notifyRequester(notice, "solved")`            | `care.case.solve`  |
  | `reopenCaseAction({ caseId })`       | `reopenCase`                                                     | `care.case.reopen` |
  - `replyToCase` and `addCaseNote` use the `supportReply` rate limit.
  - Each action revalidates `/care` and `/care/cases/<id>`.

**The case page:**

- **The thread:** internal notes on a tinted background, labeled "Internal note".
- **The side panel:**
  - the requester, from `accountSummary`, with a link to `/care/users/<id>?case=<caseId>`, or "No account";
  - `otherCases`;
  - the Concierge panel, added in Task 14.
- **The header:** the number, subject, topic, status (`STAFF_STATUS_LABEL`), owner, and `dueLabel` for help cases.

- [ ] **Step 1: Implement the case actions** in `care/actions.ts`, from the table above.
- [ ] **Step 2: Implement the pages, the client components and the nav link.**
- [ ] **Step 3: Run the checks.** Same command as Task 10.
- [ ] **Step 4: Commit.**

```bash
git add apps/web/src
git commit -m "Add the care board's request queues and the case page, where agents take, reply and solve"
```

---

### Task 12: Account help: the account page, the actions and the export download

**Files:**

- Create: `apps/web/src/app/(app)/care/tabs/users.tsx`, a search using `searchUsers`
- Create: `apps/web/src/app/(app)/care/users/[id]/page.tsx`
- Create: `apps/web/src/app/(app)/care/account-client.tsx` (`AccountActions`)
- Modify: `apps/web/src/app/(app)/care/actions.ts` (the account actions)
- Create: `apps/web/src/app/(support)/support/export/page.tsx`
- Create: `apps/web/src/app/api/account/export/link/route.ts` (`POST` only)

**Interfaces:**

- Consumes: Task 5, and from Task 9 `assertCanActOnAccount`, `notifyRequester` and `addNote`, plus `getAuth`, `monthlyUsage`, `allowancesFor` and `monthlyAiSpendMicroUsd`.
- Produces these account actions. Each takes `reason` (1–300 characters) and an optional `caseId`, calls `assertCanActOnAccount`, writes the audit entry `care.user.<x>` with `{ reason, caseId }`, and, when a `caseId` is given, adds the system note `<What happened>: <reason>`:

  | Action                                                        | What it does                                                                                                                                                 | Audit entry                          |
  | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
  | `setPlanForUser({ userId, plan, … })`                         | Changes the plan.                                                                                                                                            | `care.user.plan`                     |
  | `setBanForUser({ userId, banned, … })`                        | Bans or unbans. Banning deletes the user's sessions, as Admin does.                                                                                          | `care.user.ban` or `care.user.unban` |
  | `resendVerification({ userId, … })`                           | Refused with "Their email is already verified." when it is. Otherwise `getAuth().api.sendVerificationEmail({ body: { email, callbackURL: "/dashboard" } })`. | `care.user.verification`             |
  | `sendPasswordReset({ userId, … })`                            | `getAuth().api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } })`.                                                                    | `care.user.password_reset`           |
  | `sendExportLink({ userId, … })`                               | `createExportLink`, then emails the account (copy below).                                                                                                    | `care.user.export_link`              |
  | `deleteUserForCase({ userId, caseId, confirmEmail, reason })` | Described below.                                                                                                                                             | `care.user.delete`                   |

- **`deleteUserForCase`:**
  - it requires `deletableForCase`, and `normalizeEmail(confirmEmail) === account.email`. Otherwise it's refused with "This needs an open, confirmed 'My data' request from this account.";
  - it calls `deleteUserAccount(userId)`;
  - it emails the confirmation (copy below);
  - it adds the system note "Account deleted at the user's request.".
- **The download:**
  - **`GET /support/export?key=`:**
    - if `exportLinkUsable`, the page shows a **Download my data** button that POSTs the key;
    - otherwise: "This link has expired or was already used. Contact support for a new one."
  - **`POST /api/account/export/link`:**
    - checks `isSameOrigin` and calls `redeemExportLink`;
    - returns `exportUserData(userId)` with the same headers as `/api/account/export`;
    - writes the audit entry `account.export` with `{ via: "link" }`.

**Exact copy:**

- **The export email:**
  - subject: `Your GetTargetRole data export`;
  - text: `Hi <name>,\n\nHere's a link to download your GetTargetRole data. It works once, for 24 hours:\n<APP_URL>/support/export?key=<token>\n\nIf you didn't ask for this, you can ignore this email.`
- **The deletion email:**
  - subject: `Your GetTargetRole account was deleted`;
  - text: `Hi <name>,\n\nAs you asked, we've deleted your GetTargetRole account and everything in it.\n\nThanks for using GetTargetRole.`

**The page:** it shows the `AccountSummary`, the usage bars (the existing `UsageBars`), the AI spend against `PLANS[plan].monthlyAiBudgetUsd`, `accountActivity`, and the Concierge block from Task 14. Opening the page writes the audit entry `care.user.view`.

`AccountActions` renders each action as a small form with a reason field. For the delete action it adds a "Type their email to confirm" field, and it's disabled with the reason when `deletableForCase` is false for the current `?case=`.

- [ ] **Step 1: Implement the account actions** in `care/actions.ts`, and the POST route.
- [ ] **Step 2: Implement the users tab, the account page, `AccountActions` and the `/support/export` page.**
- [ ] **Step 3: Run the checks.** Same command as Task 10.
- [ ] **Step 4: Commit.**

```bash
git add apps/web/src
git commit -m "Add the care account page: plan, ban, verification and reset emails, export links and deletion on request"
```

---

### Task 13: The reports and company-requests tabs

**Files:**

- Create: `apps/web/src/app/(app)/care/tabs/reports.tsx`, with the queue and a "Recently hidden" filter (`?hidden=1`)
- Create: `apps/web/src/app/(app)/care/tabs/companies.tsx`
- Create: `apps/web/src/app/(app)/care/queue-client.tsx`, with `ReportActions` (Keep it, and Hide it with a reason), `ShowAgainButton` and `CompanyRequestActions` (Add it with a careers URL, and Can't add it with a reason)
- Modify: `apps/web/src/app/(app)/care/actions.ts`
- Modify: `apps/web/src/app/(app)/jobs/[id]/page.tsx`. A job with `hiddenAt` shows an `Alert` with "This posting was removed by our team, so it no longer appears in search." in place of the `FitPanel` and `ApplyKit`.
- Modify: `apps/web/src/lib/job-labels.ts`. `JOB_REPORT_REASON_LABEL.wrong_details` is "Wrong details (location, pay or company)".

**Interfaces:**

- Consumes: Tasks 6 and 7, `scoreGhostJobs` (`@gettargetrole/jobs/ghosts`), and `discoverBoard`, `boardFetch`, `trackBoard` and `enqueueCompanySync`, as `addCompanyByUrl` uses them.
- Produces these actions, all with `roles: ["support", "admin"]`:

  | Action                                           | What it does                                                       | Audit entry                    |
  | ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------ |
  | `keepJobAction({ jobId })`                       | `keepReportedJob`, then `scoreGhostJobs`                           | `care.report.keep`             |
  | `hideJobAction({ jobId, reason })`               | `hideJob`                                                          | `care.report.hide`             |
  | `unhideJobAction({ jobId })`                     | `unhideJob`, then `scoreGhostJobs`                                 | `care.report.unhide`           |
  | `addRequestedCompany({ requestId, url, name })`  | Described below.                                                   | `care.company_request.add`     |
  | `declineRequestedCompany({ requestId, reason })` | `declineCompanyRequest`, then notifies the requester (copy below). | `care.company_request.decline` |

- **`addRequestedCompany`:**
  - it runs `discoverBoard`. When that finds nothing, it fails with the same message as `addCompanyByUrl`;
  - it runs `trackBoard`, and enqueues a sync when the company is new;
  - it calls `resolveCompanyRequests` with `status: created ? "added" : "tracked"`, and notifies each requester (copy below);
  - it's rate-limited by `adminSync`.

**Exact copy for the requester notifications,** sent as type `system` in-app and by email to the requester:

- **Added:**
  - in-app: the title `We added <name>`, the body `Its jobs will show up within the hour.` and the link `/jobs`;
  - email subject: `We added <name> to GetTargetRole`;
  - email text: `Hi <userName>,\n\nYou asked us to add <name>. It's on GetTargetRole now, and its open jobs will show up within the hour:\n<APP_URL>/jobs`
- **Declined:**
  - in-app: the title `We couldn't add <name>`, with the reason as the body;
  - email subject: `We couldn't add <name>`;
  - email text: `Hi <userName>,\n\nYou asked us to add <name>, but we couldn't: <reason>`

- [ ] **Step 1: Implement the queue actions** in `care/actions.ts`, from the table above.
- [ ] **Step 2: Implement the two tabs, `queue-client.tsx`, the job page notice and the new report label.**
- [ ] **Step 3: Run the checks.** Same command as Task 10.
- [ ] **Step 4: Commit.**

```bash
git add apps/web/src
git commit -m "Add the reports and company-request queues to the care board, and mark removed postings"
```

---

### Task 14: Concierge escalations in the app

**Files:**

- Modify: `packages/db/src/support/queries.ts`, adding `conciergeContext`
- Test: `packages/db/src/support.integration.test.ts`
- Modify: `apps/web/src/app/(app)/specialist/actions.ts` (`escalateClient`)
- Modify: `apps/web/src/app/(app)/specialist/[clientId]/client-panel.tsx` (`EscalateForm`)
- Modify: `apps/web/src/app/(app)/specialist/[clientId]/page.tsx`. The header gets the escalate form and the latest escalation's status.
- Modify: `apps/web/src/app/(app)/care/cases/[id]/page.tsx` and `care/users/[id]/page.tsx`, adding the Concierge panel

**Interfaces:**

- **`conciergeContext(db, clientId, now?): Promise<{ specialistName: string | null; specialistEmail: string | null; setupDone: boolean; thisWeek: { applied: number; target: number }; lastWeek: { applied: number; target: number }; openProposals: number; lastActivity: Date | null } | null>`:** null when the user isn't on the Concierge plan.
- **`escalateClient({ clientId, note })`:** roles `specialist` and `admin`, with `assertCanActForClient` and a note of 10–2,000 characters (`z.string().trim().min(10).max(2000)`).
  - It calls `createCase` with these fields:
    - `kind: "escalation"`, `source: "specialist"`, `topic: "concierge"`;
    - the subject `Escalation from <user.name>`;
    - the note as the body;
    - the client as the user, with the client's name and email as the contact;
    - `raisedByUserId: user.id`;
    - `specialistId: user.role === "specialist" ? user.id : await activeSpecialistId(db, clientId)`;
    - `verified: false`, `visibility: "internal"`, `authorKind: "agent"`, `authorUserId: user.id`.
  - It writes the audit entry `specialist.case.escalate`. No email is sent.
- **The workspace header:** `latestEscalation(db, clientId)` shows a `Badge` reading `Escalated to care · open` or `Escalated to care · solved`.

- [ ] **Step 1: Write the failing test:**

```ts
it("gives care the Concierge context: specialist, setup and this week and last week against target", async () => {
  // riya: Concierge, assigned to priya, consent and inbox access set, 9 applications last week and 2 this week, 1 open proposal.
  expect(await db.conciergeContext(database, riya, new Date("2026-11-10T12:00:00Z"))).toMatchObject(
    {
      specialistName: "Priya",
      setupDone: true,
      thisWeek: { applied: 2, target: 15 },
      lastWeek: { applied: 9, target: 15 },
      openProposals: 1,
    },
  );
  expect(await db.conciergeContext(database, ana)).toBeNull();
});
```

- [ ] **Step 2: Typecheck and watch it fail.**
- [ ] **Step 3: Implement** `conciergeContext`, the action, the form, the header status and the panels.
- [ ] **Step 4: Run the checks.** The Task 4 command and the Task 10 command.
- [ ] **Step 5: Commit.**

```bash
git add packages/db/src apps/web/src
git commit -m "Let specialists escalate a client to care, and show care the client's Concierge week"
```

---

### Task 15: Worker jobs: auto-solve and the Monday check

**Files:**

- Modify: `packages/core/src/queues.ts`. `JOB_NAMES` gains `supportAutoSolve: "support-auto-solve"` (scheduled hourly: solves cases left waiting on the user for 7 days) and `conciergeWeeklyCheck: "concierge-weekly-check"` (scheduled Mondays: escalates Concierge clients who missed last week's target).
- Create: `apps/worker/src/support.ts`
- Modify: `apps/worker/src/index.ts`, adding the cases in `handleNotifications` and the two schedulers after `follow-up-schedule`
- Test: `apps/worker/src/support.integration.test.ts`

**Interfaces:**

- **`runAutoSolve(now = new Date(), db = getDb()): Promise<number>`:** calls `autoSolveCases`. For each notice it inserts `caseNotification` (event `auto_solved`) when there's a `userId`, then sends `caseEmail` (event `auto_solved`) with the link built from `APP_URL`. A failed email is logged, and the case stays solved. It returns how many cases it solved.
- **`runConciergeWeeklyCheck(now = new Date(), db = getDb()): Promise<{ opened: number; noted: number }>`:** calls `runWeeklyCheck`.
- **The schedulers:**
  - `support-auto-solve-schedule` runs at `{ pattern: "0 * * * *" }`;
  - `concierge-weekly-check-schedule` runs at `{ pattern: "0 6 * * 1" }`, Mondays at 06:00 UTC.

- [ ] **Step 1: Write the failing test.** It follows the harness in `apps/worker/src/concierge.integration.test.ts`:

```ts
it("solves cases left waiting a week and tells the requester in the app", async () => {
  // A case for client-1 answered by an agent on Nov 1.
  expect(await support.runAutoSolve(new Date("2026-11-08T01:00:00Z"))).toBe(1);
  const rows = await db.getDb().select().from(db.notifications);
  expect(rows).toEqual([expect.objectContaining({ userId: "client-1", type: "support" })]);
  expect(await support.runAutoSolve(new Date("2026-11-08T02:00:00Z"))).toBe(0);
});
```

- [ ] **Step 2: Typecheck and watch it fail.**
      Run: `cd apps/worker && node_modules/.bin/tsc --noEmit -p .`
      Expected: an error, because `./support` can't be found.
- [ ] **Step 3: Implement** `support.ts`, the new job names, and the worker wiring.
- [ ] **Step 4: Run the checks.**
      Run: `cd apps/worker && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint src && node_modules/.bin/vitest run && cd ../../packages/core && node_modules/.bin/tsc --noEmit -p .`
      Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/queues.ts apps/worker/src
git commit -m "Auto-solve quiet support cases hourly and run the Concierge missed-target check on Mondays"
```

---

### Task 16: End-to-end tests

**Files:**

- Create: `apps/web/e2e/care.spec.ts`

**Interfaces:** it consumes `signUpAndOnboard`, `sql`, `uniqueEmail` and `setPlan` from `e2e/helpers.ts`.

- [ ] **Step 1: Write the tests.**

  **"a user writes in, an agent takes it and replies, the user answers, and the agent solves it":**
  1. The user signs up.
  2. The agent signs up, and is given the support role with `sql("update users set role = 'support' where email = $1", [agentEmail])`.
  3. The user opens `/support`, picks "Account & sign-in", fills in the subject "Can't change my plan" and a message, and submits. They see `/We've got it — request #\d+/`.
  4. The agent opens `/care`, sees the row, opens it, clicks "Take it", types a reply, and clicks "Send reply".
  5. The user opens `/support/requests` and sees "Waiting on you". They open the request, see the agent's reply, answer, and see "With our team".
  6. The agent opens the case, clicks "Solve", and sees "Solved".
  7. From the case's account link, the agent sets the plan to "Plus" with a reason, and sees the toast "Plan changed.".
  8. A query confirms `users.plan` is `plus`.

  **"an agent hides a reported job, and search stops showing it":**
  1. The user opens the "Senior Backend Engineer, Payments" job page and reports it as "It looks fake or misleading".
  2. The agent opens `/care?tab=reports`, clicks "Hide it" with a reason, and sees the job disappear from the queue.
  3. On `/jobs`, the user no longer finds the link "Senior Backend Engineer, Payments".

- [ ] **Step 2: Typecheck and lint.**
      Run: `cd apps/web && node_modules/.bin/tsc --noEmit -p . && node_modules/.bin/eslint e2e`
      Expected: PASS. Playwright runs in CI.
- [ ] **Step 3: Commit.**

```bash
git add apps/web/e2e/care.spec.ts
git commit -m "Cover customer care end to end: a request answered and solved, and a reported job hidden"
```

---

### Task 17: Documentation

**Files:**

- Modify: `README.md`, adding a features row
- Modify: `docs/ARCHITECTURE.md`, adding a "Customer care board" section after "Concierge board"

- [ ] **Step 1: The README row.** Add **Customer care** after **Concierge**, with this text:

  > A support team answers help requests from a Contact support form (signed in or out), fixes account problems, reviews reported jobs and company requests, and picks up Concierge escalations, all from one board. Replies are emailed with a link back to the conversation, and every staff action is audited.

- [ ] **Step 2: The architecture section.** It covers:
  - the case tables and rules in `packages/db/src/support/`;
  - private links stored as hashes in `support_case_links`, one per email;
  - `publicAction`, and the client IP that honors `TRUSTED_PROXIES`;
  - the staff-account limit;
  - hidden jobs, and how sync never clears them;
  - the two worker schedules.

  Keep it as bullets, like the Concierge section.

- [ ] **Step 3: Format and commit.**
      Run: `./node_modules/.bin/prettier --write README.md docs/ARCHITECTURE.md`

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "Document the customer care board"
```
