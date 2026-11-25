# Concierge Staff Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Specialists find jobs for Concierge clients, clients approve each one, and specialists prepare kits and submit on employer sites. The client, the specialist and admins track one shared record, with weekly targets and an admin team view.

**Architecture:**

- The workflow lives on the existing `applications` row: four new statuses and a few columns.
- The Concierge domain logic is pure rules plus database operations in `packages/db/src/concierge/`, covered by Postgres integration tests.
- The Next.js app (`apps/web`) adds thin server actions and pages over that logic.
- The worker (`apps/worker`) adds two daily jobs.

**Tech stack:**

- Web: Next.js 16 (App Router, server actions), React 19.
- Data: Drizzle ORM on Postgres, Zod 4.
- Jobs: BullMQ.
- Tests: Vitest (PGlite in the sandbox) and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-concierge-staff-board-design.md`

## Global Constraints

**Copy and commits:**

- Product copy says "AI", never an AI vendor's name.
- Commit messages and PR descriptions carry no AI-vendor attribution lines (project rule).

**What the product must never do:**

- submit applications automatically, get past CAPTCHAs, or store any password;
- hold employer-site logins in the app (they live in the team's password manager).

**Clients and consent:**

- The client approves every job before staff submit it. A job the client saves themselves counts as approved.
- Staff can't mark an application submitted until the client's consent (`profiles.apply_consent_at`) is recorded.
- The job-search inbox must be a Gmail (`@gmail.com` or `@googlemail.com`), shared by Gmail delegation.

**Numbers and definitions:**

- Weekly target default `CONCIERGE_WEEKLY_TARGET = 15`, which an admin can override per client.
- Weeks start Monday 00:00 UTC.
- A client is behind pace when `applied_this_week < floor(target × days_elapsed ÷ 7)`. Paused clients are never behind.
- Proposals expire after 7 days unanswered, as `skipped` with reason `expired`.

**Roles and privacy:**

- Roles stay `user`, `specialist` and `admin`.
- A specialist acts only for clients actively assigned to them; admins can act for everyone.
- `staff_note` events never reach the client: not in client pages, and not in the data export.

**Running things:**

- Migrations: the user runs `pnpm db:migrate` locally, and CI runs it before end-to-end tests.
- Integration tests in the sandbox use the PGlite harness: `TEST_DATABASE_URL=postgres://postgres@memory/postgres npx vitest run --config /private/tmp/claude-501/-Users-sundhar-raju-Projects-NextRole/26fcde03-93e0-42e0-850a-a29b54786f1a/scratchpad/vitest.pglite.config.mjs --root . <files>`, run from the package directory.
- In CI, `pnpm test` runs them against real Postgres.
- Use local tool binaries (`npx vitest`, `npx tsc`, `npx eslint` inside a package; `./node_modules/.bin/prettier` at the repo root). The sandbox blocks the npm registry.

## Review Focus

1. **Proposing a job the client already has** (saved, applied, skipped) must not duplicate it or reset its status. Covered by Task 3's "proposes each job once" test.
2. **A decision on a stale proposal** (expired, withdrawn, or another client's) must fail with "This changed — refresh", not silently. Covered by Task 3's "stale decision" test.
3. **A paused client** must get no new proposals and must not show as behind pace. Covered by Task 3's paused test and Task 2's `behindPace` test.
4. **Reassigning a client** must remove the old specialist's access immediately and require inbox access again for the new one. Covered by Task 5's reassignment test.
5. **Missing consent** must block staff submission but not the client's own "I've applied". Covered by Task 4's consent tests.

---

### Task 1: Schema, migration and plan default

**Files:**

- Modify: `packages/db/src/schema/app.ts`
- Modify: `packages/db/src/plans.ts`
- Modify: `packages/db/src/index.ts`
- Create (generated): `packages/db/drizzle/0011_concierge_board.sql`, `packages/db/drizzle/meta/0011_snapshot.json`, and an entry in `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/src/db.test.ts`

**Interfaces:**

- Produces:
  - `APPLICATION_STATUSES` now includes `"proposed" | "approved" | "waiting_on_client" | "skipped"`.
  - `SKIP_REASONS`, `type SkipReason`, `interface BankAnswer { question: string; answer: string; updatedAt: string }`.
  - `CLIENT_TASK_KINDS`, `CLIENT_TASK_STATUSES`, the `clientTasks` table, and `type ClientTaskKind`.
  - New columns on `applications`, `profiles` and `specialistAssignments` (listed below).
  - `NOTIFICATION_TYPES` gains `"concierge"`.
  - `CONCIERGE_WEEKLY_TARGET: number` (15), exported from `@gettargetrole/db`.

- [ ] **Step 1: Write the failing test.** Append to `packages/db/src/db.test.ts` (add `APPLICATION_STATUSES` and `CONCIERGE_WEEKLY_TARGET` to its imports: `import { APPLICATION_STATUSES } from "./schema"; import { CONCIERGE_WEEKLY_TARGET } from "./plans";`):

```ts
describe("concierge configuration", () => {
  it("adds the Concierge steps and a positive weekly target", () => {
    expect(APPLICATION_STATUSES).toEqual(
      expect.arrayContaining(["proposed", "approved", "waiting_on_client", "skipped"]),
    );
    expect(CONCIERGE_WEEKLY_TARGET).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/db && npx vitest run src/db.test.ts`
Expected: FAIL. `CONCIERGE_WEEKLY_TARGET` is undefined, and the new statuses are missing.

- [ ] **Step 3: Add the plan default.** In `packages/db/src/plans.ts`, below `AUTO_PREPARE_DAILY_MAX`:

```ts
/** Applications a Concierge client's specialist aims to submit each week, unless an admin overrides it. */
export const CONCIERGE_WEEKLY_TARGET = 15;
```

In `packages/db/src/index.ts`, add `CONCIERGE_WEEKLY_TARGET,` to the `./plans` export list.

- [ ] **Step 4: Extend the schema** in `packages/db/src/schema/app.ts`.

(a) Just above `export const profiles = pgTable(`, add:

```ts
/** One of a Concierge client's standard answers, reused on every application. */
export interface BankAnswer {
  question: string;
  answer: string;
  updatedAt: string;
}
```

(b) In the `profiles` columns, directly after `autoPrepareDailyLimit`:

```ts
    /** Concierge: the dedicated job-search Gmail the client shares with their specialist. */
    jobSearchEmail: text("job_search_email").notNull().default(""),
    /** When the specialist confirmed Gmail delegation works. */
    inboxAccessConfirmedAt: timestamp("inbox_access_confirmed_at", { withTimezone: true }),
    /** When the client authorized their specialist to apply on their behalf. */
    applyConsentAt: timestamp("apply_consent_at", { withTimezone: true }),
    /** Applications per week; null uses CONCIERGE_WEEKLY_TARGET. */
    weeklyTargetOverride: integer("weekly_target_override"),
    /** Set while the client has paused their search. */
    conciergePausedAt: timestamp("concierge_paused_at", { withTimezone: true }),
    answerBank: jsonb("answer_bank").$type<BankAnswer[]>().notNull().default([]),
```

(c) Replace `APPLICATION_STATUSES` with:

```ts
export const APPLICATION_STATUSES = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  // Concierge: a specialist proposes, the client approves or skips, staff submit.
  "proposed",
  "approved",
  "waiting_on_client",
  "skipped",
] as const;
```

(d) Just above `export const applications = pgTable(`, add:

```ts
/** Why a client declined a proposed job; "expired" is set when a proposal goes unanswered. */
export const SKIP_REASONS = [
  "company",
  "location",
  "pay",
  "not_a_fit",
  "other",
  "expired",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
```

(e) In the `applications` columns, directly after `createdByUserId: …,`:

```ts
    /** Concierge: the specialist who proposed the job, their note, and the client's decision. */
    proposedByUserId: text("proposed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    proposalNote: text("proposal_note").notNull().default(""),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    skipReason: text("skip_reason", { enum: SKIP_REASONS }),
    /** Who pressed Submit on the employer's site: the specialist or the client. */
    submittedByUserId: text("submitted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
```

(f) Replace `APPLICATION_EVENT_TYPES` with:

```ts
export const APPLICATION_EVENT_TYPES = [
  "created",
  "status_changed",
  "note",
  "kit_generated",
  "outreach_drafted",
  "submitted",
  "auto_prepared",
  "proposed",
  "approved",
  "skipped",
  "question_asked",
  "question_answered",
  /** Internal to staff; never shown to the client. */
  "staff_note",
] as const;
```

(g) Directly after the `applicationEvents` table definition, add:

```ts
export const CLIENT_TASK_KINDS = ["setup_inbox", "answer_question"] as const;
export type ClientTaskKind = (typeof CLIENT_TASK_KINDS)[number];
export const CLIENT_TASK_STATUSES = ["open", "done", "cancelled"] as const;

/** Something a Concierge client must do: share their job-search inbox, or answer a question. */
export const clientTasks = pgTable(
  "client_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    specialistId: text("specialist_id").references(() => users.id, { onDelete: "set null" }),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", { enum: CLIENT_TASK_KINDS }).notNull(),
    question: text("question").notNull().default(""),
    answer: text("answer").notNull().default(""),
    saveToBank: boolean("save_to_bank").notNull().default(false),
    status: text("status", { enum: CLIENT_TASK_STATUSES }).notNull().default("open"),
    createdAt,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("client_tasks_client_idx").on(table.clientId, table.status)],
).enableRLS();
```

(h) Replace `NOTIFICATION_TYPES` with:

```ts
export const NOTIFICATION_TYPES = [
  "job_match",
  "follow_up",
  "application_ready",
  "system",
  "concierge",
] as const;
```

(i) In the `specialistAssignments` columns, directly after `active: …,`:

```ts
    /** When the specialist last opened this client's workspace, for "new answers" counts. */
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
```

- [ ] **Step 5: Run the test to see it pass**

Run: `cd packages/db && npx vitest run src/db.test.ts && npx tsc --noEmit -p .`
Expected: PASS, and no type errors.

- [ ] **Step 6: Generate the migration**

Run: `cd packages/db && DATABASE_URL=postgres://unused@localhost/unused npx drizzle-kit generate --name concierge_board`
Expected: `drizzle/0011_concierge_board.sql` is created. Check that it creates `client_tasks`, adds `proposed_by_user_id … submitted_by_user_id` to `applications`, adds the six profile columns, and adds `last_viewed_at`:

Run: `grep -c "client_tasks\|proposed_by_user_id\|submitted_by_user_id\|answer_bank\|last_viewed_at" drizzle/0011_concierge_board.sql`
Expected: a count of at least 5.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src packages/db/drizzle
git commit -m "Add Concierge steps, client tasks and job-search setup to the schema"
```

---

### Task 2: Concierge rules

**Files:**

- Create: `packages/db/src/concierge/rules.ts`
- Create: `packages/db/src/concierge/index.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/concierge/rules.test.ts`

**Interfaces:**

- Consumes: `ApplicationStatus`, `SKIP_REASONS`, `SkipReason`, `BankAnswer` (Task 1); `CONCIERGE_WEEKLY_TARGET` (Task 1).
- Produces:
  - `type ConciergeActor = "staff" | "client" | "system"` and `type ClientSkipReason = Exclude<SkipReason, "expired">`.
  - `CLIENT_SKIP_REASONS: ClientSkipReason[]`, `CONCIERGE_STEPS: readonly ApplicationStatus[]` and `CHANGED_MESSAGE: string`.
  - `class ConciergeError extends Error { code: ConciergeErrorCode }`, with `ConciergeErrorCode = "not_allowed" | "conflict" | "consent_required" | "paused" | "not_found"`.
  - `canTransition(from: ApplicationStatus, to: ApplicationStatus, actor: ConciergeActor): boolean`
  - `weekStart(now: Date): Date`
  - `behindPace(appliedThisWeek: number, target: number, now: Date, paused?: boolean): boolean`
  - `targetFor(override: number | null | undefined): number`
  - `mergeAnswer(bank: BankAnswer[], question: string, answer: string, now: Date): BankAnswer[]`

- [ ] **Step 1: Write the failing tests** in `packages/db/src/concierge/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "../schema";
import {
  behindPace,
  canTransition,
  mergeAnswer,
  targetFor,
  weekStart,
  type ConciergeActor,
} from "./rules";

type Move = [ApplicationStatus, ApplicationStatus, ConciergeActor];

describe("canTransition", () => {
  const allowed: Move[] = [
    ["proposed", "approved", "client"],
    ["proposed", "skipped", "client"],
    ["proposed", "skipped", "system"],
    ["proposed", "withdrawn", "staff"],
    ["approved", "waiting_on_client", "staff"],
    ["approved", "applied", "staff"],
    ["approved", "applied", "client"],
    ["waiting_on_client", "approved", "system"],
    ["waiting_on_client", "applied", "client"],
    ["waiting_on_client", "withdrawn", "staff"],
    ["saved", "approved", "client"],
    ["saved", "applied", "client"],
    ["applied", "interviewing", "staff"],
    ["interviewing", "offer", "client"],
  ];
  const refused: Move[] = [
    ["proposed", "approved", "staff"],
    ["proposed", "skipped", "staff"],
    ["proposed", "applied", "staff"],
    ["approved", "waiting_on_client", "client"],
    ["waiting_on_client", "applied", "staff"],
    ["waiting_on_client", "approved", "staff"],
    ["skipped", "approved", "client"],
    ["skipped", "withdrawn", "staff"],
    ["applied", "proposed", "staff"],
    ["saved", "approved", "staff"],
    ["approved", "approved", "client"],
    ["applied", "screening", "system"],
  ];
  it.each(allowed)("lets %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });
  it.each(refused)("refuses %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
  });
});

describe("weekStart", () => {
  it("starts weeks on Monday at midnight UTC", () => {
    const monday = "2026-09-28T00:00:00.000Z";
    expect(weekStart(new Date("2026-10-04T23:30:00Z")).toISOString()).toBe(monday);
    expect(weekStart(new Date(monday)).toISOString()).toBe(monday);
    expect(weekStart(new Date("2026-09-30T12:00:00Z")).toISOString()).toBe(monday);
  });
});

describe("behindPace", () => {
  const wednesdayNoon = new Date("2026-09-30T12:00:00Z"); // 2.5 days into the week

  it("expects a share of the target by this point in the week", () => {
    // floor(15 × 2.5 ÷ 7) = 5
    expect(behindPace(5, 15, wednesdayNoon)).toBe(false);
    expect(behindPace(4, 15, wednesdayNoon)).toBe(true);
  });

  it("never flags a paused client or a zero target, and expects nothing on Monday morning", () => {
    expect(behindPace(0, 15, wednesdayNoon, true)).toBe(false);
    expect(behindPace(0, 0, wednesdayNoon)).toBe(false);
    expect(behindPace(0, 15, new Date("2026-09-28T00:00:00Z"))).toBe(false);
  });
});

describe("targetFor and mergeAnswer", () => {
  it("uses the default target unless overridden", () => {
    expect(targetFor(null)).toBe(15);
    expect(targetFor(8)).toBe(8);
  });

  it("replaces an answer to the same question, ignoring case and spacing", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const bank = mergeAnswer([], "Notice period?", "Two weeks", now);
    const updated = mergeAnswer(bank, "  notice PERIOD? ", "One month", now);
    expect(updated).toEqual([
      { question: "notice PERIOD?", answer: "One month", updatedAt: now.toISOString() },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run src/concierge/rules.test.ts`
Expected: FAIL with "Cannot find module './rules'".

- [ ] **Step 3: Implement** `packages/db/src/concierge/rules.ts`:

```ts
import { CONCIERGE_WEEKLY_TARGET } from "../plans";
import { SKIP_REASONS, type ApplicationStatus, type BankAnswer, type SkipReason } from "../schema";

export type ConciergeActor = "staff" | "client" | "system";
export type ClientSkipReason = Exclude<SkipReason, "expired">;

/** Reasons a client can pick when skipping; "expired" is the system's own. */
export const CLIENT_SKIP_REASONS = SKIP_REASONS.filter(
  (reason): reason is ClientSkipReason => reason !== "expired",
);

/** The Concierge steps before submission, and the skip. */
export const CONCIERGE_STEPS: readonly ApplicationStatus[] = [
  "proposed",
  "approved",
  "waiting_on_client",
  "skipped",
];

export type ConciergeErrorCode =
  | "not_allowed"
  | "conflict"
  | "consent_required"
  | "paused"
  | "not_found";

/** A Concierge rule was broken; the web app shows `message` to the person. */
export class ConciergeError extends Error {
  constructor(
    readonly code: ConciergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConciergeError";
  }
}

export const CHANGED_MESSAGE = "This changed — refresh to see the latest.";

const isStep = (status: ApplicationStatus) => CONCIERGE_STEPS.includes(status);

/**
 * Whether `actor` may move an application from `from` to `to`. Moves between the tracker's own
 * statuses (saved, applied, interviewing…) stay free, as before; the Concierge steps follow the
 * spec's table: only the client decides on proposals, only staff ask questions, and staff can't
 * submit while a question is open.
 */
export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  actor: ConciergeActor,
): boolean {
  if (from === to) return false;
  if (actor === "system") {
    return (
      (from === "proposed" && to === "skipped") ||
      (from === "waiting_on_client" && to === "approved")
    );
  }
  if (!isStep(from) && !isStep(to)) return true;
  if (from === "skipped") return false;
  if (to === "withdrawn") return true;
  switch (from) {
    case "saved":
      return to === "approved" && actor === "client";
    case "proposed":
      return actor === "client" && (to === "approved" || to === "skipped");
    case "approved":
      return to === "applied" || (actor === "staff" && to === "waiting_on_client");
    case "waiting_on_client":
      return to === "applied" && actor === "client";
    default:
      return false;
  }
}

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday),
  );
}

/** Whether a client is behind their weekly target at this point in the week. */
export function behindPace(
  appliedThisWeek: number,
  target: number,
  now: Date,
  paused = false,
): boolean {
  if (paused || target <= 0) return false;
  const elapsedDays = (now.getTime() - weekStart(now).getTime()) / DAY_MS;
  return appliedThisWeek < Math.floor((target * elapsedDays) / 7);
}

export function targetFor(override: number | null | undefined): number {
  return override ?? CONCIERGE_WEEKLY_TARGET;
}

/** Adds or replaces an answer in the bank; questions match ignoring case and spacing. */
export function mergeAnswer(
  bank: BankAnswer[],
  question: string,
  answer: string,
  now: Date,
): BankAnswer[] {
  const key = question.trim().toLowerCase();
  const others = bank.filter((item) => item.question.trim().toLowerCase() !== key);
  return [
    ...others,
    { question: question.trim(), answer: answer.trim(), updatedAt: now.toISOString() },
  ].slice(-50);
}
```

Create `packages/db/src/concierge/index.ts`:

```ts
export * from "./rules";
```

In `packages/db/src/index.ts`, add at the end:

```ts
export * from "./concierge";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd packages/db && npx vitest run src/concierge/rules.test.ts && npx tsc --noEmit -p .`
Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/concierge packages/db/src/index.ts
git commit -m "Add the Concierge step rules, weekly pace and answer bank helpers"
```

---

### Task 3: Proposals and decisions

**Files:**

- Create: `packages/db/src/concierge/proposals.ts`
- Modify: `packages/db/src/concierge/index.ts`
- Test: `packages/db/src/concierge.integration.test.ts` (created here; Tasks 4–6 add to it)

**Interfaces:**

- Consumes: `ConciergeError`, `CHANGED_MESSAGE` and `ClientSkipReason` (Task 2); the schema (Task 1); `jobEmployerName()` (existing in the schema).
- Produces:
  - `isConciergeClient(db: Database, clientId: string): Promise<boolean>`
  - `interface ProposeResult { created: string[]; existing: string[]; unavailable: string[] }`, where `created` holds application ids, and `existing` and `unavailable` hold job ids.
  - `proposeJobs(db, { clientId, specialistId, jobIds, note?, now? }): Promise<ProposeResult>`
  - `proposeExternal(db, { clientId, specialistId, companyName, jobTitle, jobUrl, location, jobDescription, note?, now? }): Promise<string>`
  - `decideProposals(db, { clientId, applicationIds, decision: "approve" | "skip", reason?: ClientSkipReason, now? }): Promise<number>`
  - `approveOwnSave(db, { clientId, applicationId }): Promise<boolean>`
  - `PROPOSAL_DAYS = 7`
  - `expireProposals(db: Database, now?: Date): Promise<number>`

- [ ] **Step 1: Write the failing tests.** Create `packages/db/src/concierge.integration.test.ts`:

```ts
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as DbModule from "./index";
import { ensureTestDatabase, testDatabaseUrl } from "./test-database";

const TEST_DATABASE_URL = testDatabaseUrl("db");
const DAY_MS = 86_400_000;

describe.skipIf(!TEST_DATABASE_URL)("concierge (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let jobIds: string[];
  const client = "client-1";
  const specialist = "specialist-1";

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("./migrate-lib");
    await runMigrations();
    db = await import("./index");
    drizzle = await import("drizzle-orm");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE users, companies RESTART IDENTITY CASCADE`);
    await database.insert(db.users).values([
      { id: client, name: "Riya", email: "riya@example.com", plan: "concierge" },
      { id: specialist, name: "Priya", email: "priya@example.com", role: "specialist" },
    ]);
    await database.insert(db.profiles).values({ userId: client });
    await database
      .insert(db.specialistAssignments)
      .values({ specialistId: specialist, clientId: client });
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    const inserted = await database
      .insert(db.jobs)
      .values(
        [1, 2, 3].map((n) => ({
          companyId: company!.id,
          source: "greenhouse" as const,
          externalId: String(n),
          title: `Engineer ${n}`,
          location: "Austin, TX",
          applyUrl: `https://example.com/${n}`,
          contentHash: `h${n}`,
        })),
      )
      .returning({ id: db.jobs.id });
    jobIds = inserted.map((row) => row.id);
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  const statusOf = async (id: string) =>
    (
      await db
        .getDb()
        .select({ status: db.applications.status })
        .from(db.applications)
        .where(drizzle.eq(db.applications.id, id))
    )[0]?.status;

  const propose = (ids: string[], extra: { note?: string; now?: Date } = {}) =>
    db.proposeJobs(db.getDb(), {
      clientId: client,
      specialistId: specialist,
      jobIds: ids,
      ...extra,
    });

  describe("proposals", () => {
    it("proposes each job once and leaves jobs the client already has alone", async () => {
      const first = await propose([jobIds[0]!, jobIds[1]!], { note: "Strong fit" });
      expect(first.created).toHaveLength(2);
      await db.decideProposals(db.getDb(), {
        clientId: client,
        applicationIds: [first.created[0]!],
        decision: "approve",
      });
      const again = await propose([jobIds[0]!]);
      expect(again).toEqual({ created: [], existing: [jobIds[0]], unavailable: [] });
      expect(await statusOf(first.created[0]!)).toBe("approved");
    });

    it("leaves out closed jobs and refuses a paused client", async () => {
      const database = db.getDb();
      await database
        .update(db.jobs)
        .set({ closedAt: new Date() })
        .where(drizzle.eq(db.jobs.id, jobIds[2]!));
      expect((await propose([jobIds[2]!])).unavailable).toEqual([jobIds[2]]);
      await database
        .update(db.profiles)
        .set({ conciergePausedAt: new Date() })
        .where(drizzle.eq(db.profiles.userId, client));
      await expect(propose([jobIds[0]!])).rejects.toMatchObject({ code: "paused" });
    });

    it("records the client's decision, and refuses a stale decision", async () => {
      const database = db.getDb();
      const { created } = await propose([jobIds[0]!, jobIds[1]!]);
      await expect(
        db.decideProposals(database, {
          clientId: client,
          applicationIds: [created[1]!],
          decision: "skip",
        }),
      ).rejects.toMatchObject({ code: "not_allowed" });
      expect(
        await db.decideProposals(database, {
          clientId: client,
          applicationIds: [created[1]!],
          decision: "skip",
          reason: "pay",
        }),
      ).toBe(1);
      const [skipped] = await database
        .select()
        .from(db.applications)
        .where(drizzle.eq(db.applications.id, created[1]!));
      expect(skipped).toMatchObject({ status: "skipped", skipReason: "pay" });
      expect(skipped?.decidedAt).toBeInstanceOf(Date);
      await expect(
        db.decideProposals(database, {
          clientId: client,
          applicationIds: [created[1]!],
          decision: "approve",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        db.decideProposals(database, {
          clientId: "someone-else",
          applicationIds: [created[0]!],
          decision: "approve",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("treats a Concierge client's own saved job as approved, and no one else's", async () => {
      const database = db.getDb();
      const [saved] = await database
        .insert(db.applications)
        .values({ userId: client, jobId: jobIds[0]!, companyName: "Acme", jobTitle: "Engineer 1" })
        .returning();
      expect(
        await db.approveOwnSave(database, { clientId: client, applicationId: saved!.id }),
      ).toBe(true);
      expect(await statusOf(saved!.id)).toBe("approved");
      await database.update(db.users).set({ plan: "pro" }).where(drizzle.eq(db.users.id, client));
      const [other] = await database
        .insert(db.applications)
        .values({ userId: client, jobId: jobIds[1]!, companyName: "Acme", jobTitle: "Engineer 2" })
        .returning();
      expect(
        await db.approveOwnSave(database, { clientId: client, applicationId: other!.id }),
      ).toBe(false);
      expect(await statusOf(other!.id)).toBe("saved");
    });

    it("expires proposals left unanswered for a week", async () => {
      const now = new Date();
      const { created } = await propose([jobIds[0]!], {
        now: new Date(now.getTime() - 8 * DAY_MS),
      });
      await propose([jobIds[1]!], { now });
      expect(await db.expireProposals(db.getDb(), now)).toBe(1);
      const [row] = await db
        .getDb()
        .select()
        .from(db.applications)
        .where(drizzle.eq(db.applications.id, created[0]!));
      expect(row).toMatchObject({ status: "skipped", skipReason: "expired" });
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run from `packages/db`: `TEST_DATABASE_URL=postgres://postgres@memory/postgres npx vitest run --config /private/tmp/claude-501/-Users-sundhar-raju-Projects-NextRole/26fcde03-93e0-42e0-850a-a29b54786f1a/scratchpad/vitest.pglite.config.mjs --root . src/concierge.integration.test.ts`
Expected: FAIL with "db.proposeJobs is not a function".

- [ ] **Step 3: Implement** `packages/db/src/concierge/proposals.ts`:

```ts
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Database } from "../client";
import {
  applicationEvents,
  applications,
  companies,
  jobEmployerName,
  jobs,
  profiles,
  specialistAssignments,
  users,
} from "../schema";
import { CHANGED_MESSAGE, ConciergeError, type ClientSkipReason } from "./rules";

/** A Concierge client: on the Concierge plan, with an active specialist. */
export async function isConciergeClient(db: Database, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      specialistAssignments,
      and(eq(specialistAssignments.clientId, users.id), eq(specialistAssignments.active, true)),
    )
    .where(and(eq(users.id, clientId), eq(users.plan, "concierge")))
    .limit(1);
  return Boolean(row);
}

async function isPaused(db: Database, clientId: string): Promise<boolean> {
  const [profile] = await db
    .select({ paused: profiles.conciergePausedAt })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1);
  return Boolean(profile?.paused);
}

async function assertNotPaused(db: Database, clientId: string): Promise<void> {
  if (await isPaused(db, clientId)) {
    throw new ConciergeError("paused", "This client has paused their search.");
  }
}

export interface ProposeResult {
  /** Applications created, one per newly proposed job. */
  created: string[];
  /** Jobs the client already has in their tracker, left as they are. */
  existing: string[];
  /** Jobs that are closed or unknown. */
  unavailable: string[];
}

/** Proposes open board jobs to a client, with an optional note they'll see. */
export async function proposeJobs(
  db: Database,
  input: { clientId: string; specialistId: string; jobIds: string[]; note?: string; now?: Date },
): Promise<ProposeResult> {
  await assertNotPaused(db, input.clientId);
  const now = input.now ?? new Date();
  const note = input.note?.trim().slice(0, 200) ?? "";
  const open = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      applyUrl: jobs.applyUrl,
      employer: jobEmployerName(),
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(inArray(jobs.id, input.jobIds), isNull(jobs.closedAt)));
  const result: ProposeResult = {
    created: [],
    existing: [],
    unavailable: input.jobIds.filter((id) => !open.some((job) => job.id === id)),
  };
  for (const job of open) {
    const [row] = await db
      .insert(applications)
      .values({
        userId: input.clientId,
        jobId: job.id,
        companyName: job.employer,
        jobTitle: job.title,
        jobUrl: job.applyUrl,
        location: job.location,
        status: "proposed",
        proposedByUserId: input.specialistId,
        proposedAt: now,
        proposalNote: note,
        createdByUserId: input.specialistId,
      })
      .onConflictDoNothing()
      .returning({ id: applications.id });
    if (!row) {
      result.existing.push(job.id);
      continue;
    }
    result.created.push(row.id);
    await db
      .insert(applicationEvents)
      .values({ applicationId: row.id, actorUserId: input.specialistId, type: "proposed" });
  }
  return result;
}

/** Proposes a job found elsewhere, with its pasted description. Returns the application's id. */
export async function proposeExternal(
  db: Database,
  input: {
    clientId: string;
    specialistId: string;
    companyName: string;
    jobTitle: string;
    jobUrl: string;
    location: string;
    jobDescription: string;
    note?: string;
    now?: Date;
  },
): Promise<string> {
  await assertNotPaused(db, input.clientId);
  const [row] = await db
    .insert(applications)
    .values({
      userId: input.clientId,
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      jobUrl: input.jobUrl,
      location: input.location,
      jobDescription: input.jobDescription,
      status: "proposed",
      proposedByUserId: input.specialistId,
      proposedAt: input.now ?? new Date(),
      proposalNote: input.note?.trim().slice(0, 200) ?? "",
      createdByUserId: input.specialistId,
    })
    .returning({ id: applications.id });
  await db.insert(applicationEvents).values({
    applicationId: row!.id,
    actorUserId: input.specialistId,
    type: "proposed",
    data: { source: "external" },
  });
  return row!.id;
}

/**
 * The client approves or skips proposals. Only still-proposed applications of this client
 * change; if none do, the client was looking at something stale.
 */
export async function decideProposals(
  db: Database,
  input: {
    clientId: string;
    applicationIds: string[];
    decision: "approve" | "skip";
    reason?: ClientSkipReason;
    now?: Date;
  },
): Promise<number> {
  if (input.decision === "skip" && !input.reason) {
    throw new ConciergeError("not_allowed", "Choose why you're skipping it.");
  }
  const now = input.now ?? new Date();
  const updated = await db
    .update(applications)
    .set(
      input.decision === "approve"
        ? { status: "approved", decidedAt: now }
        : { status: "skipped", decidedAt: now, skipReason: input.reason },
    )
    .where(
      and(
        eq(applications.userId, input.clientId),
        inArray(applications.id, input.applicationIds),
        eq(applications.status, "proposed"),
      ),
    )
    .returning({ id: applications.id });
  if (updated.length === 0) throw new ConciergeError("conflict", CHANGED_MESSAGE);
  await db.insert(applicationEvents).values(
    updated.map((row) => ({
      applicationId: row.id,
      actorUserId: input.clientId,
      type: input.decision === "approve" ? ("approved" as const) : ("skipped" as const),
      data: input.reason ? { reason: input.reason } : {},
    })),
  );
  return updated.length;
}

/** A job a Concierge client saves themselves counts as approved for their specialist. */
export async function approveOwnSave(
  db: Database,
  input: { clientId: string; applicationId: string },
): Promise<boolean> {
  if (!(await isConciergeClient(db, input.clientId)) || (await isPaused(db, input.clientId))) {
    return false;
  }
  const [row] = await db
    .update(applications)
    .set({ status: "approved", decidedAt: new Date() })
    .where(
      and(
        eq(applications.id, input.applicationId),
        eq(applications.userId, input.clientId),
        eq(applications.status, "saved"),
      ),
    )
    .returning({ id: applications.id });
  if (!row) return false;
  await db.insert(applicationEvents).values({
    applicationId: row.id,
    actorUserId: input.clientId,
    type: "approved",
    data: { source: "saved" },
  });
  return true;
}

export const PROPOSAL_DAYS = 7;

/** Proposals left unanswered for PROPOSAL_DAYS become skipped, reason "expired". */
export async function expireProposals(db: Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PROPOSAL_DAYS * 86_400_000);
  const expired = await db
    .update(applications)
    .set({ status: "skipped", skipReason: "expired", decidedAt: now })
    .where(and(eq(applications.status, "proposed"), lt(applications.proposedAt, cutoff)))
    .returning({ id: applications.id });
  if (expired.length > 0) {
    await db.insert(applicationEvents).values(
      expired.map((row) => ({
        applicationId: row.id,
        actorUserId: null,
        type: "skipped" as const,
        data: { reason: "expired" },
      })),
    );
  }
  return expired.length;
}
```

Add to `packages/db/src/concierge/index.ts`:

```ts
export * from "./proposals";
```

- [ ] **Step 4: Run the tests to see them pass**

Run the Step 2 command again.
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/concierge packages/db/src/concierge.integration.test.ts
git commit -m "Propose jobs to Concierge clients, record their decisions and expire old proposals"
```

---

### Task 4: Questions, submission and staff notes

**Files:**

- Create: `packages/db/src/concierge/applying.ts`
- Modify: `packages/db/src/concierge/index.ts`
- Test: `packages/db/src/concierge.integration.test.ts` (add a `describe` block)

**Interfaces:**

- Consumes: `canTransition`, `CONCIERGE_STEPS`, `ConciergeError`, `CHANGED_MESSAGE` and `mergeAnswer` (Task 2); `clientTasks` and `SubmissionReceipt` (Task 1 and existing); `proposeJobs` and `decideProposals` (Task 3, used by the tests).
- Produces:
  - `askClient(db, { clientId, specialistId, applicationId, question, now? }): Promise<{ taskId: string }>`
  - `answerTask(db, { clientId, taskId, answer, saveToBank, now? }): Promise<void>`
  - `type ApplicationRow = typeof applications.$inferSelect`
  - `submitApplication(db, { ownerId, applicationId, actorId, actor: "staff" | "client", now? }): Promise<ApplicationRow>`
  - `addStaffNote(db, { clientId, applicationId, specialistId, note }): Promise<void>`

- [ ] **Step 1: Write the failing tests.** Inside the outer `describe` of `packages/db/src/concierge.integration.test.ts`, after the "proposals" block, add:

```ts
describe("questions and submission", () => {
  const approvedApplication = async (jobIndex = 0) => {
    const { created } = await propose([jobIds[jobIndex]!]);
    await db.decideProposals(db.getDb(), {
      clientId: client,
      applicationIds: created,
      decision: "approve",
    });
    return created[0]!;
  };

  it("asks the client a question and resumes when they answer", async () => {
    const database = db.getDb();
    const id = await approvedApplication();
    await expect(
      db.askClient(database, {
        clientId: client,
        specialistId: specialist,
        applicationId: id,
        question: " ",
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    const { taskId } = await db.askClient(database, {
      clientId: client,
      specialistId: specialist,
      applicationId: id,
      question: "What salary are you targeting?",
    });
    expect(await statusOf(id)).toBe("waiting_on_client");
    await db.answerTask(database, {
      clientId: client,
      taskId,
      answer: "$180k base",
      saveToBank: true,
    });
    expect(await statusOf(id)).toBe("approved");
    const [profile] = await database
      .select({ bank: db.profiles.answerBank })
      .from(db.profiles)
      .where(drizzle.eq(db.profiles.userId, client));
    expect(profile?.bank).toEqual([
      expect.objectContaining({ question: "What salary are you targeting?", answer: "$180k base" }),
    ]);
    await expect(
      db.answerTask(database, { clientId: client, taskId, answer: "again", saveToBank: false }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("only lets staff submit once the client has consented", async () => {
    const database = db.getDb();
    const id = await approvedApplication();
    const staffSubmit = () =>
      db.submitApplication(database, {
        ownerId: client,
        applicationId: id,
        actorId: specialist,
        actor: "staff",
      });
    await expect(staffSubmit()).rejects.toMatchObject({ code: "consent_required" });
    await database
      .update(db.profiles)
      .set({ applyConsentAt: new Date() })
      .where(drizzle.eq(db.profiles.userId, client));
    const row = await staffSubmit();
    expect(row).toMatchObject({ status: "applied", submittedByUserId: specialist });
    expect(row.receipt?.submittedAt).toBeTruthy();
    expect(row.appliedAt).toBeInstanceOf(Date);
  });

  it("lets the client submit themselves without the consent", async () => {
    const id = await approvedApplication();
    const row = await db.submitApplication(db.getDb(), {
      ownerId: client,
      applicationId: id,
      actorId: client,
      actor: "client",
    });
    expect(row).toMatchObject({ status: "applied", submittedByUserId: client });
  });

  it("refuses to submit a skipped job", async () => {
    const database = db.getDb();
    const { created } = await propose([jobIds[1]!]);
    await db.decideProposals(database, {
      clientId: client,
      applicationIds: created,
      decision: "skip",
      reason: "company",
    });
    await expect(
      db.submitApplication(database, {
        ownerId: client,
        applicationId: created[0]!,
        actorId: client,
        actor: "client",
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("keeps staff notes on the application's timeline", async () => {
    const database = db.getDb();
    const id = await approvedApplication();
    await db.addStaffNote(database, {
      clientId: client,
      applicationId: id,
      specialistId: specialist,
      note: "Referral from Sam",
    });
    const events = await database
      .select({ type: db.applicationEvents.type })
      .from(db.applicationEvents)
      .where(drizzle.eq(db.applicationEvents.applicationId, id));
    expect(events.map((event) => event.type)).toContain("staff_note");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run the PGlite command from Task 3, Step 2.
Expected: the new tests FAIL with "db.askClient is not a function".

- [ ] **Step 3: Implement** `packages/db/src/concierge/applying.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  applicationEvents,
  applications,
  clientTasks,
  profiles,
  resumes,
  type SubmissionReceipt,
} from "../schema";
import {
  canTransition,
  CHANGED_MESSAGE,
  CONCIERGE_STEPS,
  ConciergeError,
  mergeAnswer,
} from "./rules";

export type ApplicationRow = typeof applications.$inferSelect;

/** The specialist needs something only the client knows before submitting. */
export async function askClient(
  db: Database,
  input: {
    clientId: string;
    specialistId: string;
    applicationId: string;
    question: string;
    now?: Date;
  },
): Promise<{ taskId: string }> {
  const question = input.question.trim().slice(0, 500);
  if (question.length < 3) {
    throw new ConciergeError("not_allowed", "Write the question for the client.");
  }
  return db.transaction(async (tx) => {
    const [moved] = await tx
      .update(applications)
      .set({ status: "waiting_on_client" })
      .where(
        and(
          eq(applications.id, input.applicationId),
          eq(applications.userId, input.clientId),
          eq(applications.status, "approved"),
        ),
      )
      .returning({ id: applications.id });
    if (!moved) throw new ConciergeError("conflict", CHANGED_MESSAGE);
    const [task] = await tx
      .insert(clientTasks)
      .values({
        clientId: input.clientId,
        specialistId: input.specialistId,
        applicationId: input.applicationId,
        kind: "answer_question",
        question,
      })
      .returning({ id: clientTasks.id });
    await tx.insert(applicationEvents).values({
      applicationId: input.applicationId,
      actorUserId: input.specialistId,
      type: "question_asked",
      data: { question },
    });
    return { taskId: task!.id };
  });
}

/** The client answers; the application goes back to the specialist to submit. */
export async function answerTask(
  db: Database,
  input: { clientId: string; taskId: string; answer: string; saveToBank: boolean; now?: Date },
): Promise<void> {
  const answer = input.answer.trim().slice(0, 2000);
  if (!answer) throw new ConciergeError("not_allowed", "Write your answer first.");
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [task] = await tx
      .update(clientTasks)
      .set({ answer, saveToBank: input.saveToBank, status: "done", completedAt: now })
      .where(
        and(
          eq(clientTasks.id, input.taskId),
          eq(clientTasks.clientId, input.clientId),
          eq(clientTasks.kind, "answer_question"),
          eq(clientTasks.status, "open"),
        ),
      )
      .returning({ applicationId: clientTasks.applicationId, question: clientTasks.question });
    if (!task) throw new ConciergeError("conflict", CHANGED_MESSAGE);
    if (task.applicationId) {
      const [moved] = await tx
        .update(applications)
        .set({ status: "approved" })
        .where(
          and(
            eq(applications.id, task.applicationId),
            eq(applications.status, "waiting_on_client"),
          ),
        )
        .returning({ id: applications.id });
      if (moved) {
        await tx.insert(applicationEvents).values({
          applicationId: moved.id,
          actorUserId: input.clientId,
          type: "question_answered",
          data: { question: task.question, answer },
        });
      }
    }
    if (input.saveToBank) {
      const [profile] = await tx
        .select({ bank: profiles.answerBank })
        .from(profiles)
        .where(eq(profiles.userId, input.clientId));
      await tx
        .update(profiles)
        .set({ answerBank: mergeAnswer(profile?.bank ?? [], task.question, answer, now) })
        .where(eq(profiles.userId, input.clientId));
    }
  });
}

/**
 * Marks an application submitted on the employer's site and keeps a receipt of exactly what was
 * sent. Staff need the client's consent first; the update only lands if nobody moved the
 * application meanwhile.
 */
export async function submitApplication(
  db: Database,
  input: {
    ownerId: string;
    applicationId: string;
    actorId: string;
    actor: "staff" | "client";
    now?: Date;
  },
): Promise<ApplicationRow> {
  const now = input.now ?? new Date();
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.ownerId)))
    .limit(1);
  if (!application) throw new ConciergeError("not_found", "Application not found.");
  if (application.status === "applied") return application;
  if (
    CONCIERGE_STEPS.includes(application.status) &&
    !canTransition(application.status, "applied", input.actor)
  ) {
    throw new ConciergeError(
      "not_allowed",
      "This application can't be submitted from its current step.",
    );
  }
  if (input.actor === "staff") {
    const [profile] = await db
      .select({ consent: profiles.applyConsentAt })
      .from(profiles)
      .where(eq(profiles.userId, input.ownerId))
      .limit(1);
    if (!profile?.consent) {
      throw new ConciergeError(
        "consent_required",
        "The client hasn't given consent to apply on their behalf yet.",
      );
    }
  }
  let resume: SubmissionReceipt["resume"] = null;
  let resumeTitle = "";
  if (application.resumeId) {
    const [row] = await db
      .select({ content: resumes.content, title: resumes.title })
      .from(resumes)
      .where(and(eq(resumes.id, application.resumeId), eq(resumes.userId, input.ownerId)))
      .limit(1);
    resume = row?.content ?? null;
    resumeTitle = row?.title ?? "";
  }
  const receipt: SubmissionReceipt = {
    submittedAt: now.toISOString(),
    resumeId: application.resumeId,
    resumeTitle,
    resume,
    coverLetter: application.coverLetter,
    answers: application.answers,
  };
  const [row] = await db
    .update(applications)
    .set({
      status: "applied",
      receipt,
      submittedByUserId: input.actorId,
      appliedAt: application.appliedAt ?? now,
      // Default follow-up one week after applying.
      nextActionAt: application.nextActionAt ?? new Date(now.getTime() + 7 * 86_400_000),
    })
    .where(and(eq(applications.id, application.id), eq(applications.status, application.status)))
    .returning();
  if (!row) throw new ConciergeError("conflict", CHANGED_MESSAGE);
  await db.insert(applicationEvents).values([
    { applicationId: row.id, actorUserId: input.actorId, type: "submitted", data: { resumeTitle } },
    {
      applicationId: row.id,
      actorUserId: input.actorId,
      type: "status_changed",
      data: { from: application.status, to: "applied" },
    },
  ]);
  return row;
}

/** An internal note on the application's timeline; the client never sees it. */
export async function addStaffNote(
  db: Database,
  input: { clientId: string; applicationId: string; specialistId: string; note: string },
): Promise<void> {
  const note = input.note.trim().slice(0, 2000);
  if (!note) throw new ConciergeError("not_allowed", "Write the note first.");
  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.clientId)))
    .limit(1);
  if (!application) throw new ConciergeError("not_found", "Application not found.");
  await db.insert(applicationEvents).values({
    applicationId: application.id,
    actorUserId: input.specialistId,
    type: "staff_note",
    data: { note },
  });
}
```

Add to `packages/db/src/concierge/index.ts`:

```ts
export * from "./applying";
```

- [ ] **Step 4: Run the tests to see them pass**

Run the PGlite command from Task 3, Step 2, then `npx tsc --noEmit -p .`.
Expected: PASS (10 tests), and no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/concierge packages/db/src/concierge.integration.test.ts
git commit -m "Ask Concierge clients questions, submit with consent and keep staff notes"
```

---

### Task 5: Client setup, targets, answer bank and assignment

**Files:**

- Create: `packages/db/src/concierge/clients.ts`
- Modify: `packages/db/src/concierge/index.ts`
- Test: `packages/db/src/concierge.integration.test.ts` (add a `describe` block)

**Interfaces:**

- Consumes: `ConciergeError` and `mergeAnswer` (Task 2); the schema (Task 1).
- Produces:
  - `saveJobSearchSetup(db, { clientId, jobSearchEmail, consent: boolean, now? }): Promise<void>`
  - `confirmInboxAccess(db, { clientId, specialistId, now? }): Promise<void>`
  - `setConciergePaused(db, clientId: string, paused: boolean, now?: Date): Promise<void>`
  - `setWeeklyTarget(db, clientId: string, target: number | null): Promise<void>`
  - `updateAnswerBank(db, clientId: string, entries: Array<{ question: string; answer: string }>, now?: Date): Promise<void>`
  - `assignClient(db, { clientId, specialistId }): Promise<void>`
  - `markClientViewed(db, { specialistId, clientId, now? }): Promise<void>`
  - `hasActiveAssignment(db, specialistId: string, clientId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests.** Add inside the outer `describe`:

```ts
describe("client setup and assignment", () => {
  const profileOf = async () =>
    (await db.getDb().select().from(db.profiles).where(drizzle.eq(db.profiles.userId, client)))[0];
  const openTasks = async () =>
    (
      await db
        .getDb()
        .select()
        .from(db.clientTasks)
        .where(drizzle.eq(db.clientTasks.clientId, client))
    ).filter((task) => task.status === "open");

  it("saves the job-search Gmail with consent, and resets access when it changes", async () => {
    const database = db.getDb();
    await expect(
      db.saveJobSearchSetup(database, {
        clientId: client,
        jobSearchEmail: "riya@yahoo.com",
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await expect(
      db.saveJobSearchSetup(database, {
        clientId: client,
        jobSearchEmail: "riya.jobs@gmail.com",
        consent: false,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await db.saveJobSearchSetup(database, {
      clientId: client,
      jobSearchEmail: "Riya.Jobs@gmail.com",
      consent: true,
    });
    await db.confirmInboxAccess(database, { clientId: client, specialistId: specialist });
    expect((await profileOf())?.inboxAccessConfirmedAt).toBeInstanceOf(Date);
    await db.saveJobSearchSetup(database, {
      clientId: client,
      jobSearchEmail: "riya.search@gmail.com",
      consent: true,
    });
    const profile = await profileOf();
    expect(profile).toMatchObject({
      jobSearchEmail: "riya.search@gmail.com",
      inboxAccessConfirmedAt: null,
    });
    expect(profile?.applyConsentAt).toBeInstanceOf(Date);
  });

  it("won't confirm access before the client enters an address", async () => {
    await expect(
      db.confirmInboxAccess(db.getDb(), { clientId: client, specialistId: specialist }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("moves a client to a new specialist, who needs inbox access again", async () => {
    const database = db.getDb();
    await database
      .insert(db.users)
      .values({ id: "specialist-2", name: "Sam", email: "sam@example.com", role: "specialist" });
    await db.saveJobSearchSetup(database, {
      clientId: client,
      jobSearchEmail: "riya.jobs@gmail.com",
      consent: true,
    });
    await db.confirmInboxAccess(database, { clientId: client, specialistId: specialist });
    await db.assignClient(database, { clientId: client, specialistId: "specialist-2" });
    const assignments = await database
      .select()
      .from(db.specialistAssignments)
      .where(drizzle.eq(db.specialistAssignments.clientId, client));
    expect(assignments.filter((row) => row.active).map((row) => row.specialistId)).toEqual([
      "specialist-2",
    ]);
    // The old specialist loses access at once; the new one has it.
    expect(await db.hasActiveAssignment(database, specialist, client)).toBe(false);
    expect(await db.hasActiveAssignment(database, "specialist-2", client)).toBe(true);
    expect(await openTasks()).toEqual([
      expect.objectContaining({ kind: "setup_inbox", specialistId: "specialist-2" }),
    ]);
    expect((await profileOf())?.inboxAccessConfirmedAt).toBeNull();
    // Assigning the same specialist again changes nothing.
    await db.assignClient(database, { clientId: client, specialistId: "specialist-2" });
    expect(await openTasks()).toHaveLength(1);
  });

  it("keeps weekly targets in range, pauses, and tidies the answer bank", async () => {
    const database = db.getDb();
    await expect(db.setWeeklyTarget(database, client, 0)).rejects.toMatchObject({
      code: "not_allowed",
    });
    await db.setWeeklyTarget(database, client, 20);
    await db.setConciergePaused(database, client, true);
    await db.updateAnswerBank(database, client, [
      { question: "Notice period?", answer: "Two weeks" },
      { question: "notice period?", answer: "One month" },
      { question: "  ", answer: "ignored" },
    ]);
    const profile = await profileOf();
    expect(profile?.weeklyTargetOverride).toBe(20);
    expect(profile?.conciergePausedAt).toBeInstanceOf(Date);
    expect(profile?.answerBank).toEqual([
      expect.objectContaining({ question: "notice period?", answer: "One month" }),
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run the PGlite command from Task 3, Step 2.
Expected: the new tests FAIL with "db.saveJobSearchSetup is not a function".

- [ ] **Step 3: Implement** `packages/db/src/concierge/clients.ts`:

```ts
import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../client";
import { clientTasks, profiles, specialistAssignments } from "../schema";
import { ConciergeError, mergeAnswer } from "./rules";

const GMAIL = /^[^\s@]+@(gmail|googlemail)\.com$/;

/** The client's dedicated job-search Gmail and their consent for the specialist to apply. */
export async function saveJobSearchSetup(
  db: Database,
  input: { clientId: string; jobSearchEmail: string; consent: boolean; now?: Date },
): Promise<void> {
  const email = input.jobSearchEmail.trim().toLowerCase();
  if (!GMAIL.test(email)) {
    throw new ConciergeError(
      "not_allowed",
      "Use the new Gmail address you made for job applications.",
    );
  }
  if (!input.consent) {
    throw new ConciergeError(
      "not_allowed",
      "Tick the consent so your specialist can apply for you.",
    );
  }
  const [current] = await db
    .select({ email: profiles.jobSearchEmail })
    .from(profiles)
    .where(eq(profiles.userId, input.clientId))
    .limit(1);
  await db
    .update(profiles)
    .set({
      jobSearchEmail: email,
      applyConsentAt: input.now ?? new Date(),
      // A different inbox needs the specialist to be given access again.
      ...(current?.email !== email ? { inboxAccessConfirmedAt: null } : {}),
    })
    .where(eq(profiles.userId, input.clientId));
}

/** The specialist confirms Gmail delegation works; the setup task is done. */
export async function confirmInboxAccess(
  db: Database,
  input: { clientId: string; specialistId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(profiles)
    .set({ inboxAccessConfirmedAt: now })
    .where(and(eq(profiles.userId, input.clientId), ne(profiles.jobSearchEmail, "")))
    .returning({ userId: profiles.userId });
  if (!row) {
    throw new ConciergeError(
      "not_allowed",
      "The client hasn't entered their job-search Gmail yet.",
    );
  }
  await db
    .update(clientTasks)
    .set({ status: "done", completedAt: now })
    .where(
      and(
        eq(clientTasks.clientId, input.clientId),
        eq(clientTasks.kind, "setup_inbox"),
        eq(clientTasks.status, "open"),
      ),
    );
}

export async function setConciergePaused(
  db: Database,
  clientId: string,
  paused: boolean,
  now = new Date(),
): Promise<void> {
  await db
    .update(profiles)
    .set({ conciergePausedAt: paused ? now : null })
    .where(eq(profiles.userId, clientId));
}

/** An admin's per-client weekly target; null returns to the plan default. */
export async function setWeeklyTarget(
  db: Database,
  clientId: string,
  target: number | null,
): Promise<void> {
  if (target !== null && (!Number.isInteger(target) || target < 1 || target > 100)) {
    throw new ConciergeError("not_allowed", "Set a weekly target between 1 and 100.");
  }
  await db
    .update(profiles)
    .set({ weeklyTargetOverride: target })
    .where(eq(profiles.userId, clientId));
}

/** Replaces the answer bank from the editor: blanks dropped, repeats merged, at most 50. */
export async function updateAnswerBank(
  db: Database,
  clientId: string,
  entries: Array<{ question: string; answer: string }>,
  now = new Date(),
): Promise<void> {
  const bank = entries
    .filter((entry) => entry.question.trim() && entry.answer.trim())
    .reduce(
      (merged, entry) => mergeAnswer(merged, entry.question, entry.answer, now),
      [] as ReturnType<typeof mergeAnswer>,
    );
  await db.update(profiles).set({ answerBank: bank }).where(eq(profiles.userId, clientId));
}

/**
 * Gives the client to one specialist: any other active assignment ends, and the new specialist
 * needs Gmail access, so a fresh setup task opens. Assigning the current specialist is a no-op.
 */
export async function assignClient(
  db: Database,
  input: { clientId: string; specialistId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const active = await tx
      .select({ specialistId: specialistAssignments.specialistId })
      .from(specialistAssignments)
      .where(
        and(
          eq(specialistAssignments.clientId, input.clientId),
          eq(specialistAssignments.active, true),
        ),
      );
    if (active.length === 1 && active[0]!.specialistId === input.specialistId) return;
    await tx
      .update(specialistAssignments)
      .set({ active: false })
      .where(
        and(
          eq(specialistAssignments.clientId, input.clientId),
          ne(specialistAssignments.specialistId, input.specialistId),
        ),
      );
    await tx
      .insert(specialistAssignments)
      .values({ specialistId: input.specialistId, clientId: input.clientId, active: true })
      .onConflictDoUpdate({
        target: [specialistAssignments.specialistId, specialistAssignments.clientId],
        set: { active: true },
      });
    await tx
      .update(profiles)
      .set({ inboxAccessConfirmedAt: null })
      .where(eq(profiles.userId, input.clientId));
    await tx
      .update(clientTasks)
      .set({ status: "cancelled", completedAt: now })
      .where(
        and(
          eq(clientTasks.clientId, input.clientId),
          eq(clientTasks.kind, "setup_inbox"),
          eq(clientTasks.status, "open"),
        ),
      );
    await tx
      .insert(clientTasks)
      .values({ clientId: input.clientId, specialistId: input.specialistId, kind: "setup_inbox" });
  });
}

/** Whether this specialist is the client's active specialist. */
export async function hasActiveAssignment(
  db: Database,
  specialistId: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ clientId: specialistAssignments.clientId })
    .from(specialistAssignments)
    .where(
      and(
        eq(specialistAssignments.specialistId, specialistId),
        eq(specialistAssignments.clientId, clientId),
        eq(specialistAssignments.active, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Records that the specialist opened the client's workspace (for "new answers" counts). */
export async function markClientViewed(
  db: Database,
  input: { specialistId: string; clientId: string; now?: Date },
): Promise<void> {
  await db
    .update(specialistAssignments)
    .set({ lastViewedAt: input.now ?? new Date() })
    .where(
      and(
        eq(specialistAssignments.specialistId, input.specialistId),
        eq(specialistAssignments.clientId, input.clientId),
      ),
    );
}
```

Add to `packages/db/src/concierge/index.ts`:

```ts
export * from "./clients";
```

- [ ] **Step 4: Run the tests to see them pass**

Run the PGlite command from Task 3, Step 2, then `npx tsc --noEmit -p . && npx eslint src`.
Expected: PASS (14 tests), with no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/concierge packages/db/src/concierge.integration.test.ts
git commit -m "Save job-search setup, targets and answer banks, and move clients between specialists"
```

---

### Task 6: Board queries for specialists, clients and admins

**Files:**

- Create: `packages/db/src/concierge/board.ts`
- Modify: `packages/db/src/concierge/index.ts`
- Test: `packages/db/src/concierge/board.test.ts` (pure) and `packages/db/src/concierge.integration.test.ts` (add a `describe` block)

**Interfaces:**

- Consumes: `weekStart`, `behindPace` and `targetFor` (Task 2); the Task 3–5 operations (tests only).
- Produces:
  - `type BoardColumn = "proposed" | "approved" | "waiting" | "applied_week" | "in_progress" | "closed"`
  - `columnOf(status: ApplicationStatus, appliedAt: Date | null, now: Date): BoardColumn | null`
  - `NEEDS_ACCOUNT_SOURCES`
  - `interface BoardCard { id; clientId; clientName; companyName; jobTitle; status; column: BoardColumn; updatedAt: Date; hasResume: boolean; hasLetter: boolean; answerCount: number; needsAccount: boolean; postingClosed: boolean }`
  - `interface ClientWeek { clientId; clientName; target: number; appliedThisWeek: number; paused: boolean; behind: boolean; setupDone: boolean; newAnswers: number }`
  - `specialistBoard(db, specialistId: string, now?: Date): Promise<{ cards: BoardCard[]; clients: ClientWeek[] }>`
  - `interface SpecialistStats { id; name; clients: number; appliedThisWeek: number; targetTotal: number; behind: number; proposalsWaiting: number; oldestProposalDays: number | null; openQuestions: number; approvalRate: number | null; interviewRate: number | null }`
  - `interface TeamClient { clientId; name; email; specialistId; specialistName: string; setup: "done" | "waiting_access" | "not_started"; paused: boolean; appliedThisWeek: number; target: number; behind: boolean; lastActivity: Date | null }`
  - `teamOverview(db, now?: Date): Promise<{ specialists: SpecialistStats[]; clients: TeamClient[] }>`
  - `interface ClientProposal`, `interface ClientQuestion` and `interface ClientConcierge`, as defined in the code below.
  - `clientConcierge(db, clientId: string, now?: Date): Promise<ClientConcierge>`

- [ ] **Step 1: Write the failing tests.** Create `packages/db/src/concierge/board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { columnOf } from "./board";

describe("columnOf", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("places each status in its board column", () => {
    expect(columnOf("proposed", null, now)).toBe("proposed");
    expect(columnOf("approved", null, now)).toBe("approved");
    expect(columnOf("waiting_on_client", null, now)).toBe("waiting");
    expect(columnOf("applied", new Date("2026-09-29T09:00:00Z"), now)).toBe("applied_week");
    expect(columnOf("applied", new Date("2026-09-20T09:00:00Z"), now)).toBe("in_progress");
    expect(columnOf("interviewing", null, now)).toBe("in_progress");
    expect(columnOf("skipped", null, now)).toBe("closed");
    expect(columnOf("saved", null, now)).toBeNull();
  });
});
```

Then add inside the outer `describe` of `concierge.integration.test.ts`:

```ts
describe("boards", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("shows the specialist their clients' work and weekly pace", async () => {
    const database = db.getDb();
    const { created } = await propose(jobIds, { now });
    await db.decideProposals(database, {
      clientId: client,
      applicationIds: [created[0]!, created[1]!],
      decision: "approve",
      now,
    });
    await database
      .update(db.profiles)
      .set({ applyConsentAt: now })
      .where(drizzle.eq(db.profiles.userId, client));
    await db.submitApplication(database, {
      ownerId: client,
      applicationId: created[0]!,
      actorId: specialist,
      actor: "staff",
      now,
    });
    await database.update(db.jobs).set({ closedAt: now }).where(drizzle.eq(db.jobs.id, jobIds[1]!));
    const board = await db.specialistBoard(database, specialist, now);
    expect(board.cards.map((card) => [card.id, card.column])).toEqual(
      expect.arrayContaining([
        [created[0], "applied_week"],
        [created[1], "approved"],
        [created[2], "proposed"],
      ]),
    );
    expect(board.cards.find((card) => card.id === created[1])?.postingClosed).toBe(true);
    expect(board.clients).toEqual([
      expect.objectContaining({
        clientId: client,
        target: 15,
        appliedThisWeek: 1,
        behind: true,
        paused: false,
      }),
    ]);
  });

  it("summarizes the team for admins", async () => {
    const database = db.getDb();
    const { created } = await propose([jobIds[0]!, jobIds[1]!], {
      now: new Date(now.getTime() - 3 * DAY_MS),
    });
    await db.decideProposals(database, {
      clientId: client,
      applicationIds: [created[0]!],
      decision: "approve",
      now,
    });
    const team = await db.teamOverview(database, now);
    expect(team.specialists).toEqual([
      expect.objectContaining({
        id: specialist,
        clients: 1,
        proposalsWaiting: 1,
        oldestProposalDays: 3,
        approvalRate: 100,
      }),
    ]);
    expect(team.clients).toEqual([
      expect.objectContaining({
        clientId: client,
        specialistId: specialist,
        setup: "not_started",
        target: 15,
      }),
    ]);
  });

  it("gives the client their proposals, questions and week", async () => {
    const database = db.getDb();
    const { created } = await propose([jobIds[0]!, jobIds[1]!], { note: "Payments team" });
    await db.decideProposals(database, {
      clientId: client,
      applicationIds: [created[1]!],
      decision: "approve",
    });
    await db.askClient(database, {
      clientId: client,
      specialistId: specialist,
      applicationId: created[1]!,
      question: "Open to relocating?",
    });
    const view = await db.clientConcierge(database, client);
    expect(view.specialist).toEqual({ name: "Priya", email: "priya@example.com" });
    expect(view.proposals).toEqual([
      expect.objectContaining({ id: created[0], note: "Payments team", proposedByName: "Priya" }),
    ]);
    expect(view.questions).toEqual([expect.objectContaining({ question: "Open to relocating?" })]);
    expect(view.week).toEqual({ applied: 0, target: 15 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/db && npx vitest run src/concierge/board.test.ts` (Expected: FAIL, cannot find `./board`), then the PGlite command from Task 3, Step 2 (Expected: the board tests FAIL).

- [ ] **Step 3: Implement** `packages/db/src/concierge/board.ts`:

```ts
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client";
import {
  applications,
  clientTasks,
  jobs,
  profiles,
  specialistAssignments,
  users,
  type ApplicationStatus,
} from "../schema";
import { behindPace, targetFor, weekStart } from "./rules";

const DAY_MS = 86_400_000;

export type BoardColumn =
  | "proposed"
  | "approved"
  | "waiting"
  | "applied_week"
  | "in_progress"
  | "closed";

/** Where a status sits on the specialist's board; null for the client's own tracker steps. */
export function columnOf(
  status: ApplicationStatus,
  appliedAt: Date | null,
  now: Date,
): BoardColumn | null {
  switch (status) {
    case "proposed":
      return "proposed";
    case "approved":
      return "approved";
    case "waiting_on_client":
      return "waiting";
    case "applied":
      return appliedAt && appliedAt >= weekStart(now) ? "applied_week" : "in_progress";
    case "screening":
    case "interviewing":
      return "in_progress";
    case "offer":
    case "rejected":
    case "withdrawn":
    case "skipped":
      return "closed";
    default:
      return null;
  }
}

/** Boards where applying usually means creating an account first. */
export const NEEDS_ACCOUNT_SOURCES = [
  "workday",
  "oracle",
  "eightfold",
  "amazon",
  "usajobs",
] as const;

export interface BoardCard {
  id: string;
  clientId: string;
  clientName: string;
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  column: BoardColumn;
  updatedAt: Date;
  hasResume: boolean;
  hasLetter: boolean;
  answerCount: number;
  needsAccount: boolean;
  postingClosed: boolean;
}

export interface ClientWeek {
  clientId: string;
  clientName: string;
  target: number;
  appliedThisWeek: number;
  paused: boolean;
  behind: boolean;
  setupDone: boolean;
  /** Answers the client sent since the specialist last opened their workspace. */
  newAnswers: number;
}

async function appliedThisWeek(
  db: Database,
  clientIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: applications.userId, count: sql<number>`count(*)::int` })
    .from(applications)
    .where(
      and(inArray(applications.userId, clientIds), gte(applications.appliedAt, weekStart(now))),
    )
    .groupBy(applications.userId);
  return new Map(rows.map((row) => [row.userId, row.count]));
}

const LIVE_STATUSES: ApplicationStatus[] = [
  "proposed",
  "approved",
  "waiting_on_client",
  "applied",
  "screening",
  "interviewing",
];
const CLOSED_STATUSES: ApplicationStatus[] = ["offer", "rejected", "withdrawn", "skipped"];

/** One specialist's board: every active client's live work, and each client's week. */
export async function specialistBoard(
  db: Database,
  specialistId: string,
  now = new Date(),
): Promise<{ cards: BoardCard[]; clients: ClientWeek[] }> {
  const clients = await db
    .select({
      id: users.id,
      name: users.name,
      override: profiles.weeklyTargetOverride,
      paused: profiles.conciergePausedAt,
      access: profiles.inboxAccessConfirmedAt,
      consent: profiles.applyConsentAt,
      lastViewedAt: specialistAssignments.lastViewedAt,
    })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.clientId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(specialistAssignments.specialistId, specialistId),
        eq(specialistAssignments.active, true),
      ),
    )
    .orderBy(users.name);
  if (clients.length === 0) return { cards: [], clients: [] };
  const ids = clients.map((row) => row.id);
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({
      id: applications.id,
      userId: applications.userId,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      status: applications.status,
      appliedAt: applications.appliedAt,
      updatedAt: applications.updatedAt,
      resumeId: applications.resumeId,
      hasLetter: sql<boolean>`${applications.coverLetter} <> ''`,
      answerCount: sql<number>`jsonb_array_length(${applications.answers})::int`,
      jobId: applications.jobId,
      source: jobs.source,
      closedAt: jobs.closedAt,
    })
    .from(applications)
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(
      and(
        inArray(applications.userId, ids),
        or(
          inArray(applications.status, LIVE_STATUSES),
          and(inArray(applications.status, CLOSED_STATUSES), gte(applications.updatedAt, since)),
        ),
      ),
    )
    .orderBy(desc(applications.updatedAt))
    .limit(2000);
  const names = new Map(clients.map((row) => [row.id, row.name]));
  const cards = rows.flatMap((row): BoardCard[] => {
    const column = columnOf(row.status, row.appliedAt, now);
    if (!column) return [];
    return [
      {
        id: row.id,
        clientId: row.userId,
        clientName: names.get(row.userId) ?? "",
        companyName: row.companyName,
        jobTitle: row.jobTitle,
        status: row.status,
        column,
        updatedAt: row.updatedAt,
        hasResume: row.resumeId !== null,
        hasLetter: row.hasLetter,
        answerCount: row.answerCount,
        needsAccount:
          row.jobId === null ||
          (row.source !== null &&
            (NEEDS_ACCOUNT_SOURCES as readonly string[]).includes(row.source)),
        postingClosed: row.closedAt !== null,
      },
    ];
  });
  const applied = await appliedThisWeek(db, ids, now);
  const answered = await db
    .select({ clientId: clientTasks.clientId, completedAt: clientTasks.completedAt })
    .from(clientTasks)
    .where(
      and(
        inArray(clientTasks.clientId, ids),
        eq(clientTasks.kind, "answer_question"),
        eq(clientTasks.status, "done"),
        gte(clientTasks.completedAt, since),
      ),
    );
  return {
    cards,
    clients: clients.map((row) => {
      const target = targetFor(row.override);
      const done = applied.get(row.id) ?? 0;
      const paused = row.paused != null;
      return {
        clientId: row.id,
        clientName: row.name,
        target,
        appliedThisWeek: done,
        paused,
        behind: behindPace(done, target, now, paused),
        setupDone: Boolean(row.consent && row.access),
        newAnswers: answered.filter(
          (task) =>
            task.clientId === row.id &&
            task.completedAt !== null &&
            (row.lastViewedAt === null || task.completedAt > row.lastViewedAt),
        ).length,
      };
    }),
  };
}

export interface SpecialistStats {
  id: string;
  name: string;
  clients: number;
  appliedThisWeek: number;
  targetTotal: number;
  behind: number;
  proposalsWaiting: number;
  oldestProposalDays: number | null;
  openQuestions: number;
  /** Approved ÷ decided proposals in the last 30 days, as a percentage. */
  approvalRate: number | null;
  /** Applications that reached screening or later ÷ applied, last 30 days, as a percentage. */
  interviewRate: number | null;
}

export interface TeamClient {
  clientId: string;
  name: string;
  email: string;
  specialistId: string;
  specialistName: string;
  setup: "done" | "waiting_access" | "not_started";
  paused: boolean;
  appliedThisWeek: number;
  target: number;
  behind: boolean;
  lastActivity: Date | null;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/** The admin's view of every specialist and every active Concierge client. */
export async function teamOverview(
  db: Database,
  now = new Date(),
): Promise<{ specialists: SpecialistStats[]; clients: TeamClient[] }> {
  const since = sql`${new Date(now.getTime() - 30 * DAY_MS).toISOString()}::timestamptz`;
  const specialistRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.role, "specialist"))
    .orderBy(users.name);
  const clientRows = await db
    .select({
      clientId: users.id,
      name: users.name,
      email: users.email,
      specialistId: specialistAssignments.specialistId,
      jobSearchEmail: profiles.jobSearchEmail,
      consent: profiles.applyConsentAt,
      access: profiles.inboxAccessConfirmedAt,
      override: profiles.weeklyTargetOverride,
      paused: profiles.conciergePausedAt,
    })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.clientId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(specialistAssignments.active, true))
    .orderBy(users.name);
  const ids = clientRows.map((row) => row.clientId);
  const applied = await appliedThisWeek(db, ids, now);
  const perClient =
    ids.length === 0
      ? []
      : await db
          .select({
            userId: applications.userId,
            proposals: sql<number>`(count(*) filter (where ${applications.status} = 'proposed'))::int`,
            oldestProposal: sql<
              string | null
            >`min(${applications.proposedAt}) filter (where ${applications.status} = 'proposed')`,
            decided: sql<number>`(count(*) filter (where ${applications.decidedAt} >= ${since} and ${applications.proposedAt} is not null and ${applications.skipReason} is distinct from 'expired'))::int`,
            approved: sql<number>`(count(*) filter (where ${applications.decidedAt} >= ${since} and ${applications.proposedAt} is not null and ${applications.skipReason} is null))::int`,
            appliedRecent: sql<number>`(count(*) filter (where ${applications.appliedAt} >= ${since}))::int`,
            interviews: sql<number>`(count(*) filter (where ${applications.appliedAt} >= ${since} and ${applications.status} in ('screening', 'interviewing', 'offer')))::int`,
            lastActivity: sql<string | null>`max(${applications.updatedAt})`,
          })
          .from(applications)
          .where(inArray(applications.userId, ids))
          .groupBy(applications.userId);
  const questions =
    ids.length === 0
      ? []
      : await db
          .select({ clientId: clientTasks.clientId, count: sql<number>`count(*)::int` })
          .from(clientTasks)
          .where(
            and(
              inArray(clientTasks.clientId, ids),
              eq(clientTasks.kind, "answer_question"),
              eq(clientTasks.status, "open"),
            ),
          )
          .groupBy(clientTasks.clientId);
  const stats = new Map(perClient.map((row) => [row.userId, row]));
  const openQuestions = new Map(questions.map((row) => [row.clientId, row.count]));
  const specialistNames = new Map(specialistRows.map((row) => [row.id, row.name]));

  const clients: TeamClient[] = clientRows.map((row) => {
    const target = targetFor(row.override);
    const done = applied.get(row.clientId) ?? 0;
    const paused = row.paused != null;
    const last = stats.get(row.clientId)?.lastActivity;
    return {
      clientId: row.clientId,
      name: row.name,
      email: row.email,
      specialistId: row.specialistId,
      specialistName: specialistNames.get(row.specialistId) ?? "",
      setup:
        row.consent && row.access ? "done" : row.jobSearchEmail ? "waiting_access" : "not_started",
      paused,
      appliedThisWeek: done,
      target,
      behind: behindPace(done, target, now, paused),
      lastActivity: last ? new Date(last) : null,
    };
  });

  const specialists: SpecialistStats[] = specialistRows.map((specialist) => {
    const mine = clients.filter((row) => row.specialistId === specialist.id);
    const rows = mine.map((row) => stats.get(row.clientId));
    const sum = (pick: (row: NonNullable<(typeof rows)[number]>) => number) =>
      rows.reduce((total, row) => total + (row ? pick(row) : 0), 0);
    const oldest = rows
      .map((row) => (row?.oldestProposal ? new Date(row.oldestProposal).getTime() : null))
      .filter((time): time is number => time !== null)
      .sort((a, b) => a - b)[0];
    return {
      id: specialist.id,
      name: specialist.name,
      clients: mine.length,
      appliedThisWeek: mine.reduce((total, row) => total + row.appliedThisWeek, 0),
      targetTotal: mine.reduce((total, row) => total + (row.paused ? 0 : row.target), 0),
      behind: mine.filter((row) => row.behind).length,
      proposalsWaiting: sum((row) => row.proposals),
      oldestProposalDays:
        oldest === undefined ? null : Math.floor((now.getTime() - oldest) / DAY_MS),
      openQuestions: mine.reduce((total, row) => total + (openQuestions.get(row.clientId) ?? 0), 0),
      approvalRate: percent(
        sum((row) => row.approved),
        sum((row) => row.decided),
      ),
      interviewRate: percent(
        sum((row) => row.interviews),
        sum((row) => row.appliedRecent),
      ),
    };
  });
  return { specialists, clients };
}

export interface ClientProposal {
  id: string;
  jobId: string | null;
  companyName: string;
  jobTitle: string;
  location: string;
  note: string;
  proposedAt: Date | null;
  proposedByName: string | null;
  /** The board job's fields for pay and a match score; null for jobs found elsewhere. */
  job: {
    title: string;
    skills: string[];
    location: string;
    workplaceType: (typeof jobs.$inferSelect)["workplaceType"];
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: (typeof jobs.$inferSelect)["salaryPeriod"];
    visaSponsorship: (typeof jobs.$inferSelect)["visaSponsorship"];
    citizenshipRequired: boolean;
    seniority: (typeof jobs.$inferSelect)["seniority"];
    yearsMin: number | null;
  } | null;
}

export interface ClientQuestion {
  id: string;
  question: string;
  applicationId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  createdAt: Date;
}

export interface ClientConcierge {
  specialist: { name: string; email: string } | null;
  setup: {
    jobSearchEmail: string;
    consentAt: Date | null;
    accessConfirmedAt: Date | null;
    paused: boolean;
  };
  proposals: ClientProposal[];
  questions: ClientQuestion[];
  week: { applied: number; target: number };
}

/** What a Concierge client sees: their specialist, setup, proposals, questions and week. */
export async function clientConcierge(
  db: Database,
  clientId: string,
  now = new Date(),
): Promise<ClientConcierge> {
  const [specialist] = await db
    .select({ name: users.name, email: users.email })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.specialistId))
    .where(
      and(eq(specialistAssignments.clientId, clientId), eq(specialistAssignments.active, true)),
    )
    .limit(1);
  const [profile] = await db
    .select({
      jobSearchEmail: profiles.jobSearchEmail,
      consentAt: profiles.applyConsentAt,
      accessConfirmedAt: profiles.inboxAccessConfirmedAt,
      paused: profiles.conciergePausedAt,
      override: profiles.weeklyTargetOverride,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1);
  const proposer = alias(users, "proposer");
  const proposalRows = await db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
      location: applications.location,
      note: applications.proposalNote,
      proposedAt: applications.proposedAt,
      proposedByName: proposer.name,
      skills: jobs.skills,
      title: jobs.title,
      jobLocation: jobs.location,
      workplaceType: jobs.workplaceType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      salaryPeriod: jobs.salaryPeriod,
      visaSponsorship: jobs.visaSponsorship,
      citizenshipRequired: jobs.citizenshipRequired,
      seniority: jobs.seniority,
      yearsMin: jobs.yearsMin,
    })
    .from(applications)
    .leftJoin(proposer, eq(proposer.id, applications.proposedByUserId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, clientId), eq(applications.status, "proposed")))
    .orderBy(desc(applications.proposedAt));
  const questionRows = await db
    .select({
      id: clientTasks.id,
      question: clientTasks.question,
      applicationId: clientTasks.applicationId,
      jobTitle: applications.jobTitle,
      companyName: applications.companyName,
      createdAt: clientTasks.createdAt,
    })
    .from(clientTasks)
    .leftJoin(applications, eq(applications.id, clientTasks.applicationId))
    .where(
      and(
        eq(clientTasks.clientId, clientId),
        eq(clientTasks.kind, "answer_question"),
        eq(clientTasks.status, "open"),
      ),
    )
    .orderBy(clientTasks.createdAt);
  const applied = (await appliedThisWeek(db, [clientId], now)).get(clientId) ?? 0;
  return {
    specialist: specialist ?? null,
    setup: {
      jobSearchEmail: profile?.jobSearchEmail ?? "",
      consentAt: profile?.consentAt ?? null,
      accessConfirmedAt: profile?.accessConfirmedAt ?? null,
      paused: profile?.paused != null,
    },
    proposals: proposalRows.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      companyName: row.companyName,
      jobTitle: row.jobTitle,
      location: row.location,
      note: row.note,
      proposedAt: row.proposedAt,
      proposedByName: row.proposedByName,
      job:
        row.jobId &&
        row.title !== null &&
        row.skills !== null &&
        row.workplaceType !== null &&
        row.visaSponsorship !== null &&
        row.citizenshipRequired !== null
          ? {
              title: row.title,
              skills: row.skills,
              location: row.jobLocation ?? "",
              workplaceType: row.workplaceType,
              salaryMin: row.salaryMin,
              salaryMax: row.salaryMax,
              salaryCurrency: row.salaryCurrency,
              salaryPeriod: row.salaryPeriod,
              visaSponsorship: row.visaSponsorship,
              citizenshipRequired: row.citizenshipRequired,
              seniority: row.seniority,
              yearsMin: row.yearsMin,
            }
          : null,
    })),
    questions: questionRows,
    week: { applied, target: targetFor(profile?.override) },
  };
}
```

Add to `packages/db/src/concierge/index.ts`:

```ts
export * from "./board";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd packages/db && npx vitest run src/concierge/board.test.ts`, the PGlite command from Task 3, Step 2, then `npx tsc --noEmit -p . && npx eslint src`.
Expected: PASS (1 unit test and 17 integration tests), with no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/concierge packages/db/src/concierge.integration.test.ts
git commit -m "Add the specialist board, the admin team view and the client's Concierge view"
```

---

### Task 7: Web access helpers and tracker rules

**Files:**

- Create: `apps/web/src/lib/concierge-errors.ts`
- Test: `apps/web/src/lib/concierge-errors.test.ts`
- Create: `apps/web/src/server/concierge.ts`
- Modify: `apps/web/src/server/data/applications.ts` (`changeStatus`, `markSubmitted`, `getApplicationDetail`)
- Modify: `apps/web/src/server/data/account.ts` (export `client_tasks`, leave out staff notes)
- Modify: `apps/web/src/lib/statuses.ts`
- Modify: `apps/web/src/app/(app)/applications/board.tsx` (the status select offers only the client's moves)

**Interfaces:**

- Consumes: `ConciergeError`, `canTransition`, `submitApplication` and `hasActiveAssignment` (Tasks 2, 4 and 5).
- Produces:
  - `toAppError(error: unknown): unknown` and `withConcierge<T>(run: () => Promise<T>): Promise<T>`
  - `canActForClient(user: SessionUser, clientId: string): Promise<boolean>`
  - `assertCanActForClient(user, clientId): Promise<void>`
  - `loadClientUser(clientId: string): Promise<SessionUser>`
  - `changeStatus(userId, applicationId, status, actorUserId)`, which now refuses moves `canTransition` refuses. The actor is `"client"` when `actorUserId === userId`, else `"staff"`.
  - `markSubmitted(userId, applicationId, actorUserId)`, which now runs through `submitApplication` (so it covers consent, conflicts and `submitted_by_user_id`).
  - `getApplicationDetail(userId, applicationId, options?: { includeStaffNotes?: boolean })`
  - `STATUS_META` entries for the four new statuses
  - `CLIENT_SELECTABLE_STATUSES: ApplicationStatus[]`
  - `boardColumns(concierge: boolean): ApplicationStatus[]`

- [ ] **Step 1: Write the failing test** `apps/web/src/lib/concierge-errors.test.ts`:

```ts
import { ConflictError, ValidationError } from "@gettargetrole/core/errors";
import { ConciergeError } from "@gettargetrole/db";
import { describe, expect, it } from "vitest";
import { toAppError, withConcierge } from "./concierge-errors";

describe("toAppError", () => {
  it("turns Concierge rule breaks into messages people can read", () => {
    expect(toAppError(new ConciergeError("conflict", "This changed"))).toBeInstanceOf(
      ConflictError,
    );
    const consent = toAppError(new ConciergeError("consent_required", "No consent yet"));
    expect(consent).toBeInstanceOf(ValidationError);
    expect((consent as Error).message).toBe("No consent yet");
  });

  it("passes other errors through", async () => {
    const other = new Error("boom");
    expect(toAppError(other)).toBe(other);
    await expect(
      withConcierge(async () => {
        throw new ConciergeError("paused", "Paused");
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/web && npx vitest run src/lib/concierge-errors.test.ts`
Expected: FAIL, cannot find `./concierge-errors`.

- [ ] **Step 3: Implement the helpers.** Create `apps/web/src/lib/concierge-errors.ts`:

```ts
import { ConflictError, NotFoundError, ValidationError } from "@gettargetrole/core/errors";
import { ConciergeError } from "@gettargetrole/db";

/** Maps a Concierge rule break to the app error whose message is shown to the person. */
export function toAppError(error: unknown): unknown {
  if (!(error instanceof ConciergeError)) return error;
  switch (error.code) {
    case "conflict":
      return new ConflictError(error.message);
    case "not_found":
      return new NotFoundError("Application");
    default:
      return new ValidationError(error.message);
  }
}

/** Runs a Concierge operation, turning its rule breaks into readable errors. */
export async function withConcierge<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAppError(error);
  }
}
```

Create `apps/web/src/server/concierge.ts`:

```ts
import "server-only";
import { ForbiddenError, NotFoundError } from "@gettargetrole/core/errors";
import { getDb, hasActiveAssignment, PLANS, users, type Plan } from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import type { SessionUser } from "./session";

/** Admins act for anyone; a specialist only for clients actively assigned to them. */
export async function canActForClient(user: SessionUser, clientId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  return user.role === "specialist" && hasActiveAssignment(getDb(), user.id, clientId);
}

export async function assertCanActForClient(user: SessionUser, clientId: string): Promise<void> {
  if (!(await canActForClient(user, clientId))) throw new ForbiddenError();
}

/** The client as a session user, so their plan's allowances apply to work done for them. */
export async function loadClientUser(clientId: string): Promise<SessionUser> {
  const [row] = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      plan: users.plan,
      onboardedAt: users.onboardedAt,
    })
    .from(users)
    .where(eq(users.id, clientId))
    .limit(1);
  if (!row) throw new NotFoundError("Client");
  return {
    ...row,
    role: "user",
    plan: PLANS.includes(row.plan as Plan) ? (row.plan as Plan) : "free",
  };
}
```

- [ ] **Step 4: Apply the tracker rules** in `apps/web/src/server/data/applications.ts`.

Add to the imports: `import { ValidationError } from "@gettargetrole/core/errors";`, `canTransition` and `submitApplication` from `@gettargetrole/db`, `ne` from `drizzle-orm`, and `import { withConcierge } from "@/lib/concierge-errors";`.

Replace `changeStatus` with:

```ts
export async function changeStatus(
  userId: string,
  applicationId: string,
  status: ApplicationStatus,
  actorUserId: string,
): Promise<ApplicationRow> {
  const application = await getApplication(userId, applicationId);
  if (application.status === status) return application;
  if (!canTransition(application.status, status, actorUserId === userId ? "client" : "staff")) {
    throw new ValidationError("That move isn't available for this application.");
  }
  const update: Partial<ApplicationRow> = { status };
  if (status === "applied" && !application.appliedAt) {
    update.appliedAt = new Date();
    // Default follow-up one week after applying.
    update.nextActionAt = application.nextActionAt ?? new Date(Date.now() + 7 * 86_400_000);
  }
  const [row] = await getDb()
    .update(applications)
    .set(update)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .returning();
  await addEvent(application.id, actorUserId, "status_changed", {
    from: application.status,
    to: status,
  });
  return row!;
}
```

Replace `markSubmitted` with:

```ts
/** Marks an application as submitted and stores an immutable receipt of exactly what was sent. */
export async function markSubmitted(
  userId: string,
  applicationId: string,
  actorUserId: string,
): Promise<ApplicationRow> {
  return withConcierge(() =>
    submitApplication(getDb(), {
      ownerId: userId,
      applicationId,
      actorId: actorUserId,
      actor: actorUserId === userId ? "client" : "staff",
    }),
  );
}
```

In `getApplicationDetail`, change the signature to `export async function getApplicationDetail(userId: string, applicationId: string, options: { includeStaffNotes?: boolean } = {})`, and change the events query's `.where(eq(applicationEvents.applicationId, application.id))` to:

```ts
      .where(
        options.includeStaffNotes
          ? eq(applicationEvents.applicationId, application.id)
          : and(
              eq(applicationEvents.applicationId, application.id),
              ne(applicationEvents.type, "staff_note"),
            ),
      )
```

In `apps/web/src/server/data/account.ts`:

- Add `clientTasks` to the `@gettargetrole/db` imports, and `and` and `ne` to the `drizzle-orm` import.
- Change the application events query's `.where(inArray(applicationEvents.applicationId, appIds))` to `.where(and(inArray(applicationEvents.applicationId, appIds), ne(applicationEvents.type, "staff_note")))`.
- After `jobReports`, add:

```ts
    clientTasks: await db.select().from(clientTasks).where(eq(clientTasks.clientId, userId)),
```

- [ ] **Step 5: Update the status labels.** In `apps/web/src/lib/statuses.ts`, add these entries to `STATUS_META`:

```ts
  proposed: { label: "Proposed", tone: "neutral" },
  approved: { label: "With your specialist", tone: "primary" },
  waiting_on_client: { label: "Waiting on you", tone: "warning" },
  skipped: { label: "Skipped", tone: "neutral" },
```

and append:

```ts
/** Statuses a client can move a card to themselves; Concierge steps move through their own flows. */
export const CLIENT_SELECTABLE_STATUSES: ApplicationStatus[] = [
  "saved",
  "preparing",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

/** The tracker's columns; Concierge clients also see what's with their specialist or waiting on them. */
export function boardColumns(concierge: boolean): ApplicationStatus[] {
  return concierge ? ["approved", "waiting_on_client", ...BOARD_COLUMNS] : BOARD_COLUMNS;
}
```

In `apps/web/src/app/(app)/applications/board.tsx`:

- Replace both option loops that map `Object.entries(STATUS_META)` with:

```tsx
{
  CLIENT_SELECTABLE_STATUSES.map((value) => (
    <option key={value} value={value}>
      {STATUS_META[value].label}
    </option>
  ));
}
```

- Add `CLIENT_SELECTABLE_STATUSES` to the `@/lib/statuses` import.

- [ ] **Step 6: Run the checks**

Run: `cd apps/web && npx vitest run src/lib/concierge-errors.test.ts && npx tsc --noEmit -p . && npx eslint src/lib src/server "src/app/(app)/applications"`
Expected: PASS, with no type or lint errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "Enforce Concierge steps in the tracker and keep staff notes out of client views"
```

---

### Task 8: Apply kit on a client's behalf

**Files:**

- Modify: `apps/web/src/app/(app)/jobs/actions.ts`
- Modify: `apps/web/src/components/jobs/apply-kit.tsx`

**Interfaces:**

- Consumes: `assertCanActForClient` and `loadClientUser` (Task 7); `markSubmitted` (Task 7); `recordAudit` (existing).
- Produces:
  - The kit actions `tailorResumeForJob`, `writeCoverLetter`, `answerApplicationQuestions`, `draftOutreach`, `saveKit` and `markApplied` accept an optional `clientId`. When it's set, the work happens on the client's application and charges the client's allowances. Events record the specialist as the actor, and `markApplied` writes a `specialist.application.submitted` audit entry.
  - `KitTarget = ({ jobId: string } | { applicationId: string }) & { clientId?: string }`.

- [ ] **Step 1: Add the owner resolution** in `apps/web/src/app/(app)/jobs/actions.ts`. Add these imports:

```ts
import { recordAudit } from "@/server/audit";
import { assertCanActForClient, loadClientUser } from "@/server/concierge";
```

Change `kitSchema` to:

```ts
function kitSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object({
    jobId: z.uuid().optional(),
    applicationId: z.uuid().optional(),
    /** A specialist working on an assigned client's kit. */
    clientId: z.string().min(1).optional(),
    ...shape,
  });
}
```

Add below `primaryResumeOrThrow`:

```ts
/** Who the kit belongs to, and who is using it: a specialist can work on an assigned client's kit. */
async function kitOwner(
  user: SessionUser,
  clientId: string | undefined,
): Promise<{ owner: SessionUser; actorId: string }> {
  if (!clientId || clientId === user.id) return { owner: user, actorId: user.id };
  await assertCanActForClient(user, clientId);
  return { owner: await loadClientUser(clientId), actorId: user.id };
}
```

Change `loadJobAndApplication` and `loadKitTarget` to take the owner and the actor:

```ts
async function loadJobAndApplication(owner: SessionUser, actorId: string, jobId: string) {
  const detail = await getJobDetail(owner.id, jobId);
  const application = await ensureApplicationForJob(
    owner.id,
    detail.job,
    detail.company.name,
    actorId,
  );
  return { detail, application, job: jobContextOf(detail.job, detail.company.name) };
}

async function loadKitTarget(
  owner: SessionUser,
  actorId: string,
  input: { jobId?: string; applicationId?: string },
): Promise<KitTarget> {
  if (Boolean(input.jobId) === Boolean(input.applicationId)) {
    throw new ValidationError("Choose a job or an application.");
  }
  if (input.jobId) {
    const { application, job } = await loadJobAndApplication(owner, actorId, input.jobId);
    return { application, job, jobId: input.jobId, tailorTarget: { jobId: input.jobId } };
  }
  const application = await getApplication(owner.id, input.applicationId!);
  if (application.jobId) return loadKitTarget(owner, actorId, { jobId: application.jobId });
  if (!application.jobDescription.trim()) {
    throw new ValidationError("Paste the job description first.");
  }
  return {
    application,
    job: {
      title: application.jobTitle,
      company: application.companyName,
      location: application.location,
      description: application.jobDescription,
    },
    jobId: null,
    tailorTarget: { applicationId: application.id },
  };
}
```

Change `refresh` to:

```ts
function refresh(jobId: string | null, applicationId?: string, clientId?: string) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/applications");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  if (clientId) {
    revalidatePath(`/specialist/${clientId}`);
    if (applicationId) revalidatePath(`/specialist/${clientId}/applications/${applicationId}`);
  }
}
```

Update `saveJob`, which is always the user's own job: `loadJobAndApplication` isn't used there, and its `ensureApplicationForJob(user.id, …, user.id)` call stays as it is.

- [ ] **Step 2: Rewrite the kit actions to use the owner.** Replace `tailorResumeForJob`, `writeCoverLetter`, `answerApplicationQuestions`, `draftOutreach`, `saveKit` and `markApplied` with:

```ts
export const tailorResumeForJob = authedAction(
  kitSchema({
    instructions: z.string().trim().max(1000).optional(),
    /** Make a new version even when one from the current main resume exists. */
    force: z.boolean().optional(),
  }),
  async ({ instructions, force, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const primary = await primaryResumeOrThrow(owner.id);
    const { application, job, jobId, tailorTarget } = await loadKitTarget(owner, actorId, ids);
    const sourceHash = resumeHash(primary.content);
    // A version made from this exact main resume is reused, which costs no tokens.
    const existing =
      force || instructions ? null : await findTailoredResume(owner.id, tailorTarget, sourceHash);
    let resumeId = existing?.id;
    let notes: TailorNotes | null = existing?.tailorNotes ?? null;
    if (!resumeId) {
      const { ai, ctx, charge } = await aiFor(owner, "tailor");
      const result = await ai.tailorResume({ resume: primary.content, job, instructions }, ctx);
      notes = {
        summaryOfChanges: result.summaryOfChanges,
        addedKeywords: result.addedKeywords,
        missingKeywords: result.missingKeywords,
        suggestions: result.suggestions,
      };
      const created = await saveTailoredResume({
        userId: owner.id,
        target: tailorTarget,
        title: `${job.company} — ${job.title}`,
        content: result.resume,
        settings: primary.settings,
        sourceHash,
        notes,
        note: `Tailored for ${job.title} at ${job.company}`,
      });
      resumeId = created.id;
      await charge(resumeId);
      await addEvent(application.id, actorId, "kit_generated", { part: "resume", resumeId });
    }
    await updateApplication(owner.id, application.id, {
      resumeId,
      ...(application.status === "saved" ? { status: "preparing" as const } : {}),
    });
    refresh(jobId, application.id, clientId);
    return {
      resumeId,
      applicationId: application.id,
      reused: Boolean(existing),
      summaryOfChanges: notes?.summaryOfChanges ?? [],
      addedKeywords: notes?.addedKeywords ?? [],
      missingKeywords: notes?.missingKeywords ?? [],
      suggestions: notes?.suggestions ?? [],
    };
  },
  { rateLimit: "aiHeavy" },
);

export const writeCoverLetter = authedAction(
  kitSchema({ recipientName: z.string().trim().max(100).optional() }),
  async ({ recipientName, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const { application, job, jobId } = await loadKitTarget(owner, actorId, ids);
    const resume = await resumeForApplication(owner, application);
    const { ai, ctx, charge } = await aiFor(owner, "letter");
    const letter = await ai.writeCoverLetter(
      { resume: resume.content, job, profile: await candidateProfile(owner.id), recipientName },
      ctx,
    );
    await updateApplication(owner.id, application.id, { coverLetter: letter.body });
    await charge(application.id);
    await addEvent(application.id, actorId, "kit_generated", { part: "cover_letter" });
    refresh(jobId, application.id, clientId);
    return letter;
  },
  { rateLimit: "aiHeavy" },
);

export const answerApplicationQuestions = authedAction(
  kitSchema({
    questions: z
      .array(z.string().trim().min(3).max(500))
      .min(1, "Add at least one question")
      .max(15),
  }),
  async ({ questions, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const { application, job, jobId } = await loadKitTarget(owner, actorId, ids);
    const resume = await resumeForApplication(owner, application);
    const { ai, ctx, charge } = await aiFor(owner, "answers");
    const result = await ai.answerQuestions(
      { resume: resume.content, job, profile: await candidateProfile(owner.id), questions },
      ctx,
    );
    const merged = new Map(application.answers.map((item) => [item.question, item.answer]));
    for (const item of result.answers) merged.set(item.question, item.answer);
    const answers = [...merged.entries()]
      .map(([question, answer]) => ({ question, answer }))
      .slice(-30);
    await updateApplication(owner.id, application.id, { answers });
    await charge(application.id);
    await addEvent(application.id, actorId, "kit_generated", {
      part: "answers",
      count: result.answers.length,
    });
    refresh(jobId, application.id, clientId);
    return result.answers;
  },
  { rateLimit: "aiHeavy" },
);

export const draftOutreach = authedAction(
  kitSchema({
    recipientName: z.string().trim().max(100).optional(),
    recipientTitle: z.string().trim().max(100).optional(),
    recipientEmail: z.union([z.email(), z.literal("")]).optional(),
  }),
  async ({ recipientName, recipientTitle, recipientEmail, clientId, ...ids }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const { application, job, jobId } = await loadKitTarget(owner, actorId, ids);
    const resume = await resumeForApplication(owner, application);
    const { ai, ctx, charge } = await aiFor(owner, "outreach");
    const draft = await ai.draftOutreach(
      {
        resume: resume.content,
        job,
        recipient: recipientName ? { name: recipientName, title: recipientTitle ?? "" } : null,
        profile: await candidateProfile(owner.id),
      },
      ctx,
    );
    const recipient = {
      recipientName: recipientName ?? "",
      recipientTitle: recipientTitle ?? "",
      recipientEmail: recipientEmail ?? "",
    };
    const shared = { applicationId: application.id, jobId, ...recipient };
    await createOutreach(owner.id, {
      ...shared,
      channel: "email",
      subject: draft.email.subject,
      body: draft.email.body,
    });
    await createOutreach(owner.id, { ...shared, channel: "linkedin", body: draft.linkedinNote });
    await createOutreach(owner.id, {
      ...shared,
      channel: "email",
      subject: draft.followUp.subject,
      body: draft.followUp.body,
    });
    await charge(application.id);
    await addEvent(application.id, actorId, "outreach_drafted", {});
    refresh(jobId, application.id, clientId);
    revalidatePath("/outreach");
    return draft;
  },
  { rateLimit: "aiHeavy" },
);

export const saveKit = authedAction(
  z.object({
    applicationId: z.uuid(),
    clientId: z.string().min(1).optional(),
    coverLetter: z.string().max(10_000),
    answers: z
      .array(
        z.object({ question: z.string().trim().min(1).max(500), answer: z.string().max(5000) }),
      )
      .max(30),
  }),
  async ({ applicationId, clientId, coverLetter, answers }, user) => {
    const { owner } = await kitOwner(user, clientId);
    await updateApplication(owner.id, applicationId, { coverLetter, answers });
    refresh(null, applicationId, clientId);
    return null;
  },
);

export const markApplied = authedAction(
  z.object({ applicationId: z.uuid(), clientId: z.string().min(1).optional() }),
  async ({ applicationId, clientId }, user) => {
    const { owner, actorId } = await kitOwner(user, clientId);
    const application = await markSubmitted(owner.id, applicationId, actorId);
    if (owner.id !== actorId) {
      await recordAudit({
        actorUserId: actorId,
        action: "specialist.application.submitted",
        targetType: "application",
        targetId: applicationId,
        metadata: { clientId: owner.id },
      });
    }
    if (application.jobId) revalidatePath(`/jobs/${application.jobId}`);
    refresh(null, applicationId, clientId);
    revalidatePath("/dashboard");
    return null;
  },
);
```

`analyzeFit` and `prepareInterview` stay as the user's own actions.

- [ ] **Step 3: Pass the client through the apply kit.** In `apps/web/src/components/jobs/apply-kit.tsx`:
- Change `export type KitTarget = { jobId: string } | { applicationId: string };` to `export type KitTarget = ({ jobId: string } | { applicationId: string }) & { clientId?: string };`.
- Change `saveKit({ applicationId: application.id, coverLetter, answers })` to `saveKit({ applicationId: application.id, clientId: target.clientId, coverLetter, answers })`.
- Change `return markApplied({ applicationId });` to `return markApplied({ applicationId, clientId: target.clientId });`.
- Change the label of the button that calls `markApplied` from `I've applied` to `{target.clientId ? "Mark submitted" : "I've applied"}`.

The other kit calls already spread `...target`, so `clientId` flows through.

- [ ] **Step 4: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint "src/app/(app)/jobs" src/components/jobs`
Expected: no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/jobs/actions.ts" apps/web/src/components/jobs/apply-kit.tsx
git commit -m "Let specialists use the apply kit on an assigned client's applications"
```

---

### Task 9: Specialist actions

**Files:**

- Modify: `apps/web/src/app/(app)/specialist/actions.ts`

**Interfaces:**

- Consumes:
  - from Tasks 3–5: `proposeJobs`, `proposeExternal`, `askClient`, `addStaffNote`, `confirmInboxAccess` and `updateAnswerBank`;
  - from Task 7: `withConcierge`, `assertCanActForClient` and `changeStatus`;
  - `sendEmail` from `@gettargetrole/core/mailer`, and `recordAudit`.
- Produces these server actions:
  - `proposeJobsToClient({ clientId, jobIds: string[], note? }) → { created: number; existing: number; unavailable: number }`
  - `addExternalProposal({ clientId, companyName, jobTitle, jobUrl, location, jobDescription, note? }) → null`
  - `askClientQuestion({ clientId, applicationId, question }) → null`
  - `addStaffNoteToApplication({ clientId, applicationId, note }) → null`
  - `confirmClientInbox({ clientId }) → null`
  - `saveClientAnswerBank({ clientId, answers: Array<{ question; answer }> }) → null`
  - The existing `addClientApplication` and `moveClientApplication` now allow admins through (`assertCanActForClient`).

- [ ] **Step 1: Replace the file's header and assignment check.** In `apps/web/src/app/(app)/specialist/actions.ts`, replace everything above `export const addClientApplication` with:

```ts
"use server";

import { createLogger } from "@gettargetrole/core/logger";
import { sendEmail } from "@gettargetrole/core/mailer";
import {
  addStaffNote,
  APPLICATION_STATUSES,
  askClient,
  confirmInboxAccess,
  getDb,
  notifications,
  proposeExternal,
  proposeJobs,
  updateAnswerBank,
  users,
} from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withConcierge } from "@/lib/concierge-errors";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { assertCanActForClient } from "@/server/concierge";
import { changeStatus, createExternalApplication } from "@/server/data/applications";
import type { SessionUser } from "@/server/session";

const log = createLogger("specialist");
const specialistRoles = { roles: ["specialist" as const, "admin" as const] };

/** Specialists may only act for clients actively assigned to them; admins for anyone. */
async function assertAssigned(user: SessionUser, clientId: string): Promise<void> {
  await assertCanActForClient(user, clientId);
}

function refreshClient(clientId: string) {
  revalidatePath("/specialist");
  revalidatePath(`/specialist/${clientId}`);
}

async function clientEmail(clientId: string): Promise<{ email: string; name: string } | null> {
  const [row] = await getDb()
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, clientId))
    .limit(1);
  return row ?? null;
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
```

Remove `ForbiddenError`, `APPLICATION_STATUSES` (now imported from `@gettargetrole/db` above) and `isAssignedSpecialist` from the old imports. In `moveClientApplication`, `changeStatus(clientId, applicationId, status, user.id)` now enforces staff moves (Task 7).

- [ ] **Step 2: Add the new actions** at the end of the file:

```ts
export const proposeJobsToClient = authedAction(
  z.object({
    clientId: z.string().min(1),
    jobIds: z.array(z.uuid()).min(1, "Pick at least one job").max(50),
    note: z.string().trim().max(200).optional(),
  }),
  async ({ clientId, jobIds, note }, user) => {
    await assertAssigned(user, clientId);
    const result = await withConcierge(() =>
      proposeJobs(getDb(), { clientId, specialistId: user.id, jobIds, note }),
    );
    if (result.created.length > 0) {
      await getDb()
        .insert(notifications)
        .values({
          userId: clientId,
          type: "concierge",
          title: "New jobs from your specialist",
          body: `${result.created.length} job${result.created.length === 1 ? "" : "s"} to approve or skip.`,
          link: "/applications",
          dedupeKey: `proposals:${new Date().toISOString().slice(0, 10)}`,
        })
        .onConflictDoNothing();
    }
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.proposal.create",
      targetType: "user",
      targetId: clientId,
      metadata: { created: result.created.length, existing: result.existing.length },
    });
    refreshClient(clientId);
    return {
      created: result.created.length,
      existing: result.existing.length,
      unavailable: result.unavailable.length,
    };
  },
  specialistRoles,
);

export const addExternalProposal = authedAction(
  z.object({
    clientId: z.string().min(1),
    companyName: z.string().trim().min(1).max(120),
    jobTitle: z.string().trim().min(1).max(160),
    jobUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
    location: z.string().trim().max(120),
    jobDescription: z.string().trim().min(50, "Paste the job description").max(20_000),
    note: z.string().trim().max(200).optional(),
  }),
  async ({ clientId, ...input }, user) => {
    await assertAssigned(user, clientId);
    const id = await withConcierge(() =>
      proposeExternal(getDb(), { clientId, specialistId: user.id, ...input }),
    );
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.proposal.create",
      targetType: "application",
      targetId: id,
      metadata: { clientId, external: true },
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);

export const askClientQuestion = authedAction(
  z.object({
    clientId: z.string().min(1),
    applicationId: z.uuid(),
    question: z.string().trim().min(3).max(500),
  }),
  async ({ clientId, applicationId, question }, user) => {
    await assertAssigned(user, clientId);
    await withConcierge(() =>
      askClient(getDb(), { clientId, specialistId: user.id, applicationId, question }),
    );
    await getDb().insert(notifications).values({
      userId: clientId,
      type: "concierge",
      title: "Your specialist has a question",
      body: question,
      link: "/applications",
    });
    const client = await clientEmail(clientId);
    if (client) {
      // The in-app notification is already written; a failed email mustn't undo the question.
      await sendEmail({
        to: client.email,
        subject: "Your specialist has a question",
        text: `Hi ${client.name},\n\nYour specialist needs an answer before they can submit an application for you:\n\n"${question}"\n\nAnswer it here: ${appUrl()}/applications\n`,
      }).catch((error: unknown) => log.warn({ err: error, clientId }, "question email failed"));
    }
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.question.ask",
      targetType: "application",
      targetId: applicationId,
      metadata: { clientId },
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);

export const addStaffNoteToApplication = authedAction(
  z.object({
    clientId: z.string().min(1),
    applicationId: z.uuid(),
    note: z.string().trim().min(1).max(2000),
  }),
  async ({ clientId, applicationId, note }, user) => {
    await assertAssigned(user, clientId);
    await withConcierge(() =>
      addStaffNote(getDb(), { clientId, applicationId, specialistId: user.id, note }),
    );
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.note.add",
      targetType: "application",
      targetId: applicationId,
      metadata: { clientId },
    });
    revalidatePath(`/specialist/${clientId}/applications/${applicationId}`);
    return null;
  },
  specialistRoles,
);

export const confirmClientInbox = authedAction(
  z.object({ clientId: z.string().min(1) }),
  async ({ clientId }, user) => {
    await assertAssigned(user, clientId);
    await withConcierge(() => confirmInboxAccess(getDb(), { clientId, specialistId: user.id }));
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.inbox.confirm",
      targetType: "user",
      targetId: clientId,
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);

export const saveClientAnswerBank = authedAction(
  z.object({
    clientId: z.string().min(1),
    answers: z
      .array(z.object({ question: z.string().max(500), answer: z.string().max(2000) }))
      .max(50),
  }),
  async ({ clientId, answers }, user) => {
    await assertAssigned(user, clientId);
    await updateAnswerBank(getDb(), clientId, answers);
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.answers.update",
      targetType: "user",
      targetId: clientId,
    });
    refreshClient(clientId);
    return null;
  },
  specialistRoles,
);
```

- [ ] **Step 3: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint "src/app/(app)/specialist"`
Expected: no type or lint errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/specialist/actions.ts"
git commit -m "Add specialist actions to propose jobs, ask questions, note and confirm inbox access"
```

---

### Task 10: The specialist's board page

**Files:**

- Create: `apps/web/src/components/concierge/board-card.tsx`
- Modify (rewrite): `apps/web/src/app/(app)/specialist/page.tsx`

**Interfaces:**

- Consumes: `specialistBoard`, `BoardCard`, `ClientWeek` and `BoardColumn` (Task 6); `requireRole` (existing).
- Produces: the page `/specialist?client=<id>&column=<BoardColumn>`.

- [ ] **Step 1: Create the card** `apps/web/src/components/concierge/board-card.tsx`:

```tsx
import type { BoardCard } from "@gettargetrole/db";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

/** One application on the specialist's board. */
export function ConciergeCard({ card }: { card: BoardCard }) {
  const kit = [
    card.hasResume ? "Resume" : null,
    card.hasLetter ? "Letter" : null,
    card.answerCount > 0 ? `${card.answerCount} answers` : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/specialist/${card.clientId}/applications/${card.id}`}
      className="block rounded-lg border border-border bg-card p-3 text-sm shadow-sm hover:shadow-md"
    >
      <p className="font-medium leading-snug">{card.jobTitle}</p>
      <p className="text-xs text-muted-foreground">
        {card.companyName} · {card.clientName}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone="outline">{timeAgo(card.updatedAt)}</Badge>
        {card.needsAccount ? <Badge tone="warning">Needs an employer account</Badge> : null}
        {card.postingClosed ? <Badge tone="danger">Posting closed</Badge> : null}
        {kit.length > 0 ? <Badge tone="success">{kit.join(" · ")}</Badge> : null}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Rewrite** `apps/web/src/app/(app)/specialist/page.tsx`:

```tsx
import { getDb, specialistBoard, type BoardColumn } from "@gettargetrole/db";
import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConciergeCard } from "@/components/concierge/board-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Concierge board" };

const COLUMNS: Array<{ id: BoardColumn; label: string }> = [
  { id: "proposed", label: "Proposed" },
  { id: "approved", label: "Approved — to submit" },
  { id: "waiting", label: "Waiting on client" },
  { id: "applied_week", label: "Applied this week" },
  { id: "in_progress", label: "In progress" },
  { id: "closed", label: "Closed" },
];

export default async function ConciergeBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; column?: string }>;
}) {
  const user = await requireRole("specialist", "admin");
  const { client, column } = await searchParams;
  const board = await specialistBoard(getDb(), user.id);
  if (board.clients.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Concierge board"
          description="Your clients' job searches in one place."
        />
        <EmptyState
          icon={UsersRound}
          title="No clients assigned"
          description="An admin assigns Concierge clients from Admin → Concierge."
        />
      </div>
    );
  }
  const cards = board.cards.filter(
    (card) => (!client || card.clientId === client) && (!column || card.column === column),
  );
  const shown = column ? COLUMNS.filter((item) => item.id === column) : COLUMNS;
  const href = (next: { client?: string; column?: string }) => {
    const params = new URLSearchParams();
    if (next.client) params.set("client", next.client);
    if (next.column) params.set("column", next.column);
    const query = params.toString();
    return query ? `/specialist?${query}` : "/specialist";
  };

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Concierge board"
        description="Every client's shortlist, submissions and replies. Every action is logged to the client's timeline."
      />
      <ul className="mb-4 flex gap-3 overflow-x-auto pb-1" aria-label="Clients this week">
        {board.clients.map((week) => (
          <li key={week.clientId}>
            <Link
              href={`/specialist/${week.clientId}`}
              className={cn(
                "block min-w-44 rounded-xl border bg-card p-3 text-sm shadow-sm",
                week.behind ? "border-danger" : "border-border",
              )}
            >
              <p className="font-medium">{week.clientName}</p>
              <p className={cn("text-xs", week.behind ? "text-danger" : "text-muted-foreground")}>
                {week.paused ? "Paused" : `${week.appliedThisWeek} of ${week.target} this week`}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {!week.setupDone ? <Badge tone="warning">Setup unfinished</Badge> : null}
                {week.newAnswers > 0 ? (
                  <Badge tone="primary">
                    {week.newAnswers} new answer{week.newAnswers === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <nav className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Filters">
        <Link
          href={href({ column })}
          className={cn("rounded-full border px-3 py-1", !client && "border-primary text-primary")}
        >
          All clients
        </Link>
        {board.clients.map((week) => (
          <Link
            key={week.clientId}
            href={href({ client: week.clientId, column })}
            className={cn(
              "rounded-full border px-3 py-1",
              client === week.clientId && "border-primary text-primary",
            )}
          >
            {week.clientName}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <Link
          href={href({ client })}
          className={cn("rounded-full border px-3 py-1", !column && "border-primary text-primary")}
        >
          All columns
        </Link>
        {COLUMNS.map((item) => (
          <Link
            key={item.id}
            href={href({ client, column: item.id })}
            className={cn(
              "rounded-full border px-3 py-1",
              column === item.id && "border-primary text-primary",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {shown.map((item) => {
          const inColumn = cards.filter((card) => card.column === item.id);
          return (
            <section
              key={item.id}
              aria-label={`${item.label} column`}
              className="rounded-xl bg-muted/40 p-2"
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {item.label}
                <span className="text-xs font-normal text-muted-foreground">{inColumn.length}</span>
              </h2>
              <div className="space-y-2">
                {inColumn.map((card) => (
                  <ConciergeCard key={card.id} card={card} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint "src/app/(app)/specialist" src/components/concierge`
Expected: no type or lint errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/specialist/page.tsx" apps/web/src/components/concierge
git commit -m "Show specialists one board across their clients, with each client's week"
```

---

### Task 11: The client workspace and apply page

**Files:**

- Create: `apps/web/src/server/data/concierge.ts`
- Modify (rewrite): `apps/web/src/app/(app)/specialist/[clientId]/page.tsx`
- Modify: `apps/web/src/app/(app)/specialist/[clientId]/client-panel.tsx` (add the client components)
- Create: `apps/web/src/app/(app)/specialist/[clientId]/applications/[applicationId]/page.tsx`

**Interfaces:**

- Consumes:
  - Task 9's actions;
  - `canActForClient` and `loadClientUser` (Task 7), and `columnOf` and `markClientViewed` (Tasks 5–6);
  - the existing helpers `searchJobs`, `getApplicationDetail`, `getJobDetail`, `monthlyUsage`, `allowancesFor` and `ApplyKit`.
- Produces:
  - `clientTimeline(clientId: string, limit?: number)`: events with the actor's name, staff notes included.
  - `clientSetup(clientId: string)`: `{ jobSearchEmail, consentAt, accessConfirmedAt, weeklyTargetOverride, answerBank }`.
  - The page `/specialist/[clientId]?tab=find|pipeline|profile|timeline`, and the apply page.

- [ ] **Step 1: Create the data helpers** `apps/web/src/server/data/concierge.ts`:

```ts
import "server-only";
import { applicationEvents, applications, getDb, profiles, users } from "@gettargetrole/db";
import { desc, eq } from "drizzle-orm";

/** A client's recent timeline across applications, including staff notes (staff only). */
export async function clientTimeline(clientId: string, limit = 100) {
  return getDb()
    .select({
      id: applicationEvents.id,
      type: applicationEvents.type,
      data: applicationEvents.data,
      createdAt: applicationEvents.createdAt,
      actorName: users.name,
      jobTitle: applications.jobTitle,
      companyName: applications.companyName,
      applicationId: applications.id,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .leftJoin(users, eq(users.id, applicationEvents.actorUserId))
    .where(eq(applications.userId, clientId))
    .orderBy(desc(applicationEvents.createdAt))
    .limit(limit);
}

export async function clientSetup(clientId: string) {
  const [row] = await getDb()
    .select({
      jobSearchEmail: profiles.jobSearchEmail,
      consentAt: profiles.applyConsentAt,
      accessConfirmedAt: profiles.inboxAccessConfirmedAt,
      weeklyTargetOverride: profiles.weeklyTargetOverride,
      answerBank: profiles.answerBank,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1);
  return (
    row ?? {
      jobSearchEmail: "",
      consentAt: null,
      accessConfirmedAt: null,
      weeklyTargetOverride: null,
      answerBank: [],
    }
  );
}
```

- [ ] **Step 2: Add the workspace's client components.** Append to `apps/web/src/app/(app)/specialist/[clientId]/client-panel.tsx`, and add `useState` to its React import, plus `Textarea` and `Label` to its `@/components/ui/form` import:

```tsx
import type { BankAnswer } from "@gettargetrole/db/schema";
import {
  addExternalProposal,
  addStaffNoteToApplication,
  askClientQuestion,
  confirmClientInbox,
  proposeJobsToClient,
  saveClientAnswerBank,
} from "../actions";

/** Proposes a job found outside the board, with its pasted description. */
export function ExternalProposalForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      const result = await addExternalProposal({
        clientId,
        companyName: String(form.get("companyName") ?? ""),
        jobTitle: String(form.get("jobTitle") ?? ""),
        jobUrl: String(form.get("jobUrl") ?? ""),
        location: String(form.get("location") ?? ""),
        jobDescription: String(form.get("jobDescription") ?? ""),
        note: String(form.get("note") ?? "") || undefined,
      });
      if (!result.ok) {
        toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0]! : result.error);
        return;
      }
      formElement.reset();
      toast.success("Proposed to the client.");
      router.refresh();
    });
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-2">
      <Input name="companyName" placeholder="Company" required aria-label="Company" />
      <Input name="jobTitle" placeholder="Job title" required aria-label="Job title" />
      <Input name="jobUrl" placeholder="https://… link to the posting" aria-label="Job link" />
      <Input name="location" placeholder="Location" aria-label="Location" />
      <Textarea
        name="jobDescription"
        placeholder="Paste the job description"
        required
        rows={4}
        className="sm:col-span-2"
        aria-label="Job description"
      />
      <Input
        name="note"
        maxLength={200}
        placeholder="Note to the client (optional)"
        className="sm:col-span-2"
        aria-label="Note to the client"
      />
      <Button type="submit" loading={pending} className="sm:col-span-2 sm:justify-self-start">
        Propose to client
      </Button>
    </form>
  );
}

export function ProposeJobsForm({
  clientId,
  jobs,
}: {
  clientId: string;
  jobs: Array<{
    id: string;
    title: string;
    companyName: string;
    location: string;
    score: number;
    status: string | null;
  }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              aria-label={`Propose ${job.title}`}
              disabled={Boolean(job.status)}
              checked={picked.includes(job.id)}
              onChange={(event) =>
                setPicked((current) =>
                  event.target.checked
                    ? [...current, job.id]
                    : current.filter((id) => id !== job.id),
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{job.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {job.companyName} · {job.location}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {job.status ? job.status : `${job.score}% match`}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          placeholder="Note to the client (optional)"
          aria-label="Note to the client"
          className="max-w-md"
        />
        <Button
          disabled={picked.length === 0}
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await proposeJobsToClient({
                clientId,
                jobIds: picked,
                note: note || undefined,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              const { created, existing } = result.data;
              toast.success(
                existing > 0
                  ? `Proposed ${created}; ${existing} already in their tracker.`
                  : `Proposed ${created} job${created === 1 ? "" : "s"} to the client.`,
              );
              setPicked([]);
              setNote("");
              router.refresh();
            })
          }
        >
          Propose to client ({picked.length})
        </Button>
      </div>
    </div>
  );
}

export function ConfirmInboxButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await confirmClientInbox({ clientId });
          if (!result.ok) toast.error(result.error);
          else toast.success("Inbox access confirmed.");
          router.refresh();
        })
      }
    >
      I can open their inbox
    </Button>
  );
}

export function AnswerBankEditor({ clientId, bank }: { clientId: string; bank: BankAnswer[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState([
    ...bank.map(({ question, answer }) => ({ question, answer })),
    { question: "", answer: "" },
  ]);
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-2">
          <Input
            value={row.question}
            onChange={(event) =>
              setRows((current) =>
                current.map((item, i) =>
                  i === index ? { ...item, question: event.target.value } : item,
                ),
              )
            }
            placeholder="Question, e.g. Notice period?"
            aria-label={`Question ${index + 1}`}
          />
          <Input
            value={row.answer}
            onChange={(event) =>
              setRows((current) =>
                current.map((item, i) =>
                  i === index ? { ...item, answer: event.target.value } : item,
                ),
              )
            }
            placeholder="The client's answer"
            aria-label={`Answer ${index + 1}`}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRows((current) => [...current, { question: "", answer: "" }])}
        >
          Add a row
        </Button>
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveClientAnswerBank({ clientId, answers: rows });
              if (!result.ok) toast.error(result.error);
              else toast.success("Answer bank saved.");
              router.refresh();
            })
          }
        >
          Save answers
        </Button>
      </div>
    </div>
  );
}

export function AskClientForm({
  clientId,
  applicationId,
}: {
  clientId: string;
  applicationId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  return (
    <div className="space-y-2">
      <Label htmlFor="ask-client">Ask the client</Label>
      <Textarea
        id="ask-client"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Something only they know, e.g. expected salary"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={question.trim().length < 3}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await askClientQuestion({ clientId, applicationId, question });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Question sent. The application waits for their answer.");
            setQuestion("");
            router.refresh();
          })
        }
      >
        Ask client
      </Button>
    </div>
  );
}

export function StaffNoteForm({
  clientId,
  applicationId,
}: {
  clientId: string;
  applicationId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <Label htmlFor="staff-note">Staff note (the client never sees it)</Label>
      <Textarea
        id="staff-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!note.trim()}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addStaffNoteToApplication({ clientId, applicationId, note });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setNote("");
            router.refresh();
          })
        }
      >
        Add note
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the workspace page** `apps/web/src/app/(app)/specialist/[clientId]/page.tsx`:

```tsx
import { columnOf, getDb, markClientViewed, targetFor } from "@gettargetrole/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScaledPreview } from "@/components/resume/scaled-preview";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { STATUS_META } from "@/lib/statuses";
import { cn, timeAgo } from "@/lib/utils";
import { recordAudit } from "@/server/audit";
import { canActForClient, loadClientUser } from "@/server/concierge";
import { listApplications } from "@/server/data/applications";
import { clientSetup, clientTimeline } from "@/server/data/concierge";
import { searchJobs } from "@/server/data/jobs";
import { getProfile } from "@/server/data/profile";
import { getPrimaryResume } from "@/server/data/resumes";
import { requireRole } from "@/server/session";
import {
  AddForClientForm,
  AnswerBankEditor,
  ClientStatusSelect,
  ConfirmInboxButton,
  ExternalProposalForm,
  ProposeJobsForm,
} from "./client-panel";

export const metadata: Metadata = { title: "Client" };

const TABS = [
  { id: "find", label: "Find jobs" },
  { id: "pipeline", label: "Pipeline" },
  { id: "profile", label: "Profile" },
  { id: "timeline", label: "Timeline" },
] as const;

export default async function ClientWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const staff = await requireRole("specialist", "admin");
  const { clientId } = await params;
  const { tab = "find", q } = await searchParams;
  if (!(await canActForClient(staff, clientId))) notFound();
  const client = await loadClientUser(clientId).catch(() => notFound());
  if (staff.role === "specialist") {
    await markClientViewed(getDb(), { specialistId: staff.id, clientId });
  }
  await recordAudit({
    actorUserId: staff.id,
    action: "specialist.client.view",
    targetType: "user",
    targetId: clientId,
  });
  const setup = await clientSetup(clientId);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/specialist" className="text-sm text-muted-foreground hover:text-foreground">
        ← Concierge board
      </Link>
      <PageHeader
        title={client.name}
        description={`${client.email} · ${client.plan} plan · target ${targetFor(setup.weeklyTargetOverride)} a week`}
      />
      <nav className="mb-4 flex gap-2 border-b border-border" aria-label="Client tabs">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/specialist/${clientId}?tab=${item.id}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "find" ? <FindTab clientId={clientId} q={q} /> : null}
      {tab === "pipeline" ? <PipelineTab clientId={clientId} /> : null}
      {tab === "profile" ? <ProfileTab clientId={clientId} setup={setup} /> : null}
      {tab === "timeline" ? <TimelineTab clientId={clientId} /> : null}
    </div>
  );
}

async function FindTab({ clientId, q }: { clientId: string; q?: string }) {
  const result = await searchJobs(clientId, { q: q || undefined, sort: "match", posted: "30d" });
  return (
    <div className="space-y-4">
      <form className="flex gap-2" action={`/specialist/${clientId}`}>
        <input type="hidden" name="tab" value="find" />
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search titles or skills"
          aria-label="Search jobs"
        />
      </form>
      <p className="text-sm text-muted-foreground">
        Ranked by this client's resume and preferences. Jobs already in their tracker can't be
        proposed again.
      </p>
      <ProposeJobsForm
        clientId={clientId}
        jobs={result.items.map((job) => ({
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          location: job.location,
          score: job.match.score,
          status: job.applicationStatus
            ? (STATUS_META[job.applicationStatus as keyof typeof STATUS_META]?.label ??
              job.applicationStatus)
            : null,
        }))}
      />
      <Card>
        <CardHeader
          title="Found a job elsewhere?"
          description="Paste its description to propose it to the client."
        />
        <CardBody>
          <ExternalProposalForm clientId={clientId} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Applied somewhere else?"
          description="Log a role the client applied to outside the board."
        />
        <CardBody>
          <AddForClientForm clientId={clientId} />
        </CardBody>
      </Card>
    </div>
  );
}

async function PipelineTab({ clientId }: { clientId: string }) {
  const items = await listApplications(clientId);
  const now = new Date();
  const live = items.filter((item) => columnOf(item.status, item.appliedAt, now) !== null);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
      {live.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2">
          <Link
            href={`/specialist/${clientId}/applications/${item.id}`}
            className="min-w-0 hover:underline"
          >
            <span className="block truncate font-medium">{item.jobTitle}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.companyName}</span>
          </Link>
          <ClientStatusSelect clientId={clientId} applicationId={item.id} status={item.status} />
        </li>
      ))}
    </ul>
  );
}

async function ProfileTab({
  clientId,
  setup,
}: {
  clientId: string;
  setup: Awaited<ReturnType<typeof clientSetup>>;
}) {
  const [profile, resume] = await Promise.all([getProfile(clientId), getPrimaryResume(clientId)]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Job-search inbox"
            description="The client's Gmail for applications, shared with you by delegation."
          />
          <CardBody className="space-y-2 text-sm">
            <p>{setup.jobSearchEmail || "Not entered yet."}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone={setup.consentAt ? "success" : "warning"}>
                {setup.consentAt ? "Consent given" : "No consent yet"}
              </Badge>
              <Badge tone={setup.accessConfirmedAt ? "success" : "warning"}>
                {setup.accessConfirmedAt ? "Access confirmed" : "Access not confirmed"}
              </Badge>
            </div>
            {setup.jobSearchEmail && !setup.accessConfirmedAt ? (
              <ConfirmInboxButton clientId={clientId} />
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Answer bank"
            description="Standard answers you reuse on every application."
          />
          <CardBody>
            <AnswerBankEditor clientId={clientId} bank={setup.answerBank} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search preferences" />
          <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Roles: </span>
              {profile.targetTitles.join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Locations: </span>
              {profile.targetLocations.join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Work authorization: </span>
              {profile.workAuthorization || "—"}
              {profile.needsSponsorship ? " (needs sponsorship)" : ""}
            </p>
          </CardBody>
        </Card>
      </div>
      <Card className="overflow-hidden lg:self-start">
        <CardHeader
          title="Main resume"
          description={resume ? resume.title : "The client hasn't added a resume yet."}
        />
        {resume ? (
          <ScaledPreview
            resume={resume.content}
            settings={resume.settings}
            className="max-h-[48rem] rounded-none"
          />
        ) : null}
      </Card>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  status_changed: "Moved",
  note: "Note",
  kit_generated: "Kit prepared",
  outreach_drafted: "Outreach drafted",
  submitted: "Submitted",
  auto_prepared: "Auto-prepared",
  proposed: "Proposed",
  approved: "Approved",
  skipped: "Skipped",
  question_asked: "Question asked",
  question_answered: "Question answered",
  staff_note: "Staff note",
};

async function TimelineTab({ clientId }: { clientId: string }) {
  const events = await clientTimeline(clientId);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
      {events.map((event) => (
        <li key={event.id} className="px-4 py-2">
          <p>
            <span className="font-medium">{EVENT_LABEL[event.type] ?? event.type}</span>{" "}
            <span className="text-muted-foreground">
              · {event.jobTitle} at {event.companyName} · {event.actorName ?? "System"} ·{" "}
              {timeAgo(event.createdAt)}
            </span>
          </p>
          {typeof event.data.note === "string" ? (
            <p className="text-muted-foreground">{event.data.note}</p>
          ) : null}
          {typeof event.data.question === "string" ? (
            <p className="text-muted-foreground">Q: {event.data.question}</p>
          ) : null}
          {typeof event.data.answer === "string" ? (
            <p className="text-muted-foreground">A: {event.data.answer}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Create the apply page** `apps/web/src/app/(app)/specialist/[clientId]/applications/[applicationId]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyKit } from "@/components/jobs/apply-kit";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { allowancesFor } from "@/lib/plans";
import { STATUS_META } from "@/lib/statuses";
import { monthlyUsage } from "@/server/ai";
import { canActForClient, loadClientUser } from "@/server/concierge";
import { getApplicationDetail } from "@/server/data/applications";
import { clientSetup } from "@/server/data/concierge";
import { requireRole } from "@/server/session";
import { AskClientForm, StaffNoteForm } from "../../client-panel";

export const metadata: Metadata = { title: "Apply for client" };

export default async function ClientApplyPage({
  params,
}: {
  params: Promise<{ clientId: string; applicationId: string }>;
}) {
  const staff = await requireRole("specialist", "admin");
  const { clientId, applicationId } = await params;
  if (!(await canActForClient(staff, clientId))) notFound();
  const client = await loadClientUser(clientId).catch(() => notFound());
  const detail = await getApplicationDetail(clientId, applicationId, {
    includeStaffNotes: true,
  }).catch(() => notFound());
  const [setup, usage] = await Promise.all([clientSetup(clientId), monthlyUsage(clientId)]);
  const { application, job, resume } = detail;
  const applyUrl = job?.applyUrl || application.jobUrl;

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`/specialist/${clientId}?tab=pipeline`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {client.name}
      </Link>
      <PageHeader
        title={application.jobTitle}
        description={`${application.companyName} · for ${client.name}`}
        actions={
          <Badge tone={STATUS_META[application.status].tone}>
            {STATUS_META[application.status].label}
          </Badge>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ApplyKit
          target={{ applicationId: application.id, clientId }}
          applyUrl={applyUrl}
          application={{
            id: application.id,
            status: application.status,
            resumeId: application.resumeId,
            coverLetter: application.coverLetter,
            answers: application.answers,
            appliedAt: application.appliedAt?.toISOString() ?? null,
          }}
          tailored={resume ? { notes: resume.tailorNotes, stale: false } : null}
          allowances={allowancesFor(client.plan, usage)}
          matchScore={100}
        />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Apply with" />
            <CardBody className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Job-search email: </span>
                {setup.jobSearchEmail || "Not set up yet"}
              </p>
              {!setup.consentAt ? (
                <p className="text-danger">
                  The client hasn't given consent yet, so you can't mark it submitted.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Employer-site passwords you create go in the team password manager, never here.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Answer bank" />
            <CardBody className="space-y-1 text-sm">
              {setup.answerBank.length === 0 ? (
                <p className="text-muted-foreground">No saved answers yet.</p>
              ) : null}
              {setup.answerBank.map((item) => (
                <p key={item.question}>
                  <span className="text-muted-foreground">{item.question}</span> {item.answer}
                </p>
              ))}
            </CardBody>
          </Card>
          {application.status === "approved" ? (
            <Card>
              <CardBody>
                <AskClientForm clientId={clientId} applicationId={application.id} />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardBody>
              <StaffNoteForm clientId={clientId} applicationId={application.id} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

`ApplyKit` gets the same props the job page (`apps/web/src/app/(app)/jobs/[id]/page.tsx`) passes: `target`, `applyUrl`, `application`, `tailored`, `allowances` and `matchScore`.

- [ ] **Step 5: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint "src/app/(app)/specialist" src/server/data/concierge.ts`
Expected: no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(app)/specialist" apps/web/src/server/data/concierge.ts
git commit -m "Add the client workspace: find and propose jobs, pipeline, profile, timeline and apply"
```

---

### Task 12: What the client sees

**Files:**

- Modify: `apps/web/src/app/(app)/applications/actions.ts`
- Create: `apps/web/src/components/concierge/from-specialist.tsx`
- Create: `apps/web/src/components/concierge/setup-card.tsx`
- Modify: `apps/web/src/app/(app)/applications/page.tsx`
- Modify: `apps/web/src/app/(app)/applications/board.tsx` (a `columns` prop)
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/actions.ts` and `apps/web/src/app/(app)/settings/page.tsx`
- Modify: `apps/web/src/app/(app)/jobs/actions.ts` (`saveJob` → `approveOwnSave`)

**Interfaces:**

- Consumes:
  - from Tasks 3–6: `decideProposals`, `answerTask`, `approveOwnSave`, `saveJobSearchSetup`, `setConciergePaused`, `clientConcierge`, `CLIENT_SKIP_REASONS` and `ClientSkipReason`;
  - `quickMatch` and `candidateSignals` (existing);
  - `boardColumns` (Task 7).
- Produces:
  - actions `decideSpecialistProposals({ applicationIds, decision, reason? })`, `answerSpecialistQuestion({ taskId, answer, saveToBank })`, `saveJobSearchEmail({ jobSearchEmail, consent })` and `setSearchPaused({ paused })`;
  - components `FromSpecialist`, `ConciergeSetupCard` and `ConciergeWeekCard`.

- [ ] **Step 1: Add the client actions.** Append to `apps/web/src/app/(app)/applications/actions.ts`, adding the imports `answerTask`, `CLIENT_SKIP_REASONS`, `decideProposals` and `getDb` from `@gettargetrole/db`, and `withConcierge` from `@/lib/concierge-errors`:

```ts
export const decideSpecialistProposals = authedAction(
  z.object({
    applicationIds: z.array(z.uuid()).min(1).max(50),
    decision: z.enum(["approve", "skip"]),
    reason: z.enum(CLIENT_SKIP_REASONS as [string, ...string[]]).optional(),
  }),
  async ({ applicationIds, decision, reason }, user) => {
    const changed = await withConcierge(() =>
      decideProposals(getDb(), {
        clientId: user.id,
        applicationIds,
        decision,
        reason: reason as (typeof CLIENT_SKIP_REASONS)[number] | undefined,
      }),
    );
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    return { changed };
  },
);

export const answerSpecialistQuestion = authedAction(
  z.object({
    taskId: z.uuid(),
    answer: z.string().trim().min(1).max(2000),
    saveToBank: z.boolean(),
  }),
  async ({ taskId, answer, saveToBank }, user) => {
    await withConcierge(() =>
      answerTask(getDb(), { clientId: user.id, taskId, answer, saveToBank }),
    );
    revalidatePath("/applications");
    return null;
  },
);
```

- [ ] **Step 2: Create** `apps/web/src/components/concierge/from-specialist.tsx`:

```tsx
"use client";

import type { ClientSkipReason } from "@gettargetrole/db";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  answerSpecialistQuestion,
  decideSpecialistProposals,
} from "@/app/(app)/applications/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

const SKIP_LABEL: Record<ClientSkipReason, string> = {
  company: "Not this company",
  location: "Location",
  pay: "Pay too low",
  not_a_fit: "Not a fit",
  other: "Other",
};

export interface ProposalView {
  id: string;
  jobTitle: string;
  companyName: string;
  location: string;
  pay: string | null;
  score: number | null;
  note: string;
  proposedByName: string | null;
}

export interface QuestionView {
  id: string;
  question: string;
  jobTitle: string | null;
  companyName: string | null;
}

/** Jobs the specialist proposed, and questions waiting on the client. */
export function FromSpecialist({
  specialistName,
  proposals,
  questions,
}: {
  specialistName: string;
  proposals: ProposalView[];
  questions: QuestionView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, ClientSkipReason>>({});
  const [answers, setAnswers] = useState<Record<string, { text: string; save: boolean }>>({});
  if (proposals.length === 0 && questions.length === 0) return null;

  const decide = (
    applicationIds: string[],
    decision: "approve" | "skip",
    reason?: ClientSkipReason,
  ) =>
    startTransition(async () => {
      const result = await decideSpecialistProposals({ applicationIds, decision, reason });
      if (!result.ok) toast.error(result.error);
      setPicked([]);
      router.refresh();
    });

  return (
    <section
      aria-label="From your specialist"
      className="mb-6 space-y-3 rounded-xl border border-primary/40 bg-primary-soft/30 p-4"
    >
      <h2 className="font-semibold">From {specialistName}</h2>
      {questions.map((question) => {
        const answer = answers[question.id] ?? { text: "", save: true };
        return (
          <div key={question.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <p className="font-medium">{question.question}</p>
            {question.jobTitle ? (
              <p className="text-xs text-muted-foreground">
                For {question.jobTitle} at {question.companyName}
              </p>
            ) : null}
            <Textarea
              className="mt-2"
              rows={2}
              value={answer.text}
              aria-label="Your answer"
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: { ...answer, text: event.target.value },
                }))
              }
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={answer.save}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: { ...answer, save: event.target.checked },
                  }))
                }
              />
              Save for future applications
            </label>
            <Button
              size="sm"
              className="mt-2"
              disabled={!answer.text.trim()}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await answerSpecialistQuestion({
                    taskId: question.id,
                    answer: answer.text,
                    saveToBank: answer.save,
                  });
                  if (!result.ok) toast.error(result.error);
                  else toast.success("Thanks — your specialist will take it from here.");
                  router.refresh();
                })
              }
            >
              Send answer
            </Button>
          </div>
        );
      })}
      {proposals.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Approve the jobs you want {specialistName} to apply to.
            </p>
            <Button
              size="sm"
              disabled={picked.length === 0}
              loading={pending}
              onClick={() => decide(picked, "approve")}
            >
              Approve selected ({picked.length})
            </Button>
          </div>
          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm"
            >
              <input
                type="checkbox"
                aria-label={`Select ${proposal.jobTitle}`}
                checked={picked.includes(proposal.id)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked
                      ? [...current, proposal.id]
                      : current.filter((id) => id !== proposal.id),
                  )
                }
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{proposal.jobTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {proposal.companyName} · {proposal.location}
                  {proposal.pay ? ` · ${proposal.pay}` : ""}
                </p>
                {proposal.note ? <p className="text-xs">“{proposal.note}”</p> : null}
              </div>
              {proposal.score !== null ? (
                <Badge tone="primary">{proposal.score}% match</Badge>
              ) : null}
              <Button size="sm" loading={pending} onClick={() => decide([proposal.id], "approve")}>
                Approve
              </Button>
              <Select
                aria-label={`Why skip ${proposal.jobTitle}`}
                className="h-8 w-40 text-xs"
                value={reasons[proposal.id] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [proposal.id]: event.target.value as ClientSkipReason,
                  }))
                }
              >
                <option value="">Skip because…</option>
                {(Object.keys(SKIP_LABEL) as ClientSkipReason[]).map((reason) => (
                  <option key={reason} value={reason}>
                    {SKIP_LABEL[reason]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!reasons[proposal.id]}
                loading={pending}
                onClick={() => decide([proposal.id], "skip", reasons[proposal.id])}
              >
                Skip
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Create** `apps/web/src/components/concierge/setup-card.tsx`:

```tsx
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";

export function ConciergeSetupCard({
  specialist,
  jobSearchEmail,
  consentAt,
  accessConfirmedAt,
}: {
  specialist: { name: string; email: string } | null;
  jobSearchEmail: string;
  consentAt: Date | null;
  accessConfirmedAt: Date | null;
}) {
  if (consentAt && accessConfirmedAt) return null;
  return (
    <Card>
      <CardHeader
        title="Set up your job-search inbox"
        description="So your specialist can create employer accounts and apply for you."
      />
      <CardBody className="space-y-2 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create a new Gmail used only for job applications.</li>
          <li>
            In that Gmail, open Settings → Accounts → &ldquo;Grant access to your account&rdquo; and
            add <strong>{specialist?.email ?? "your specialist"}</strong>.
          </li>
          <li>
            Enter the address and give consent in{" "}
            <Link href="/settings#concierge" className="text-primary">
              Settings
            </Link>
            .
          </li>
        </ol>
        <p className="text-muted-foreground">
          {jobSearchEmail
            ? accessConfirmedAt
              ? "All set."
              : `Waiting for ${specialist?.name ?? "your specialist"} to confirm access to ${jobSearchEmail}.`
            : "Not started yet."}
        </p>
      </CardBody>
    </Card>
  );
}

export function ConciergeWeekCard({
  specialistName,
  applied,
  target,
  paused,
}: {
  specialistName: string;
  applied: number;
  target: number;
  paused: boolean;
}) {
  return (
    <Card>
      <CardHeader title="This week" />
      <CardBody className="space-y-2 text-sm">
        {paused ? (
          <p>Your search is paused. Resume it in Settings when you're ready.</p>
        ) : (
          <>
            <p>
              {specialistName} applied to {applied} of your {target} this week.
            </p>
            <ProgressBar value={Math.min(100, Math.round((applied / Math.max(target, 1)) * 100))} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 4: Show them.** In `apps/web/src/app/(app)/applications/page.tsx`:
- Load `clientConcierge(getDb(), user.id)` only when `user.plan === "concierge"`, together with `candidateSignals(user.id)`.
- Render `<FromSpecialist specialistName={view.specialist?.name ?? "your specialist"} proposals={…} questions={view.questions} />` above `<ApplicationBoard …>`.
- Map each proposal to `ProposalView`, with `score: proposal.job ? quickMatch(signals, proposal.job).score : null` and `pay: formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)` (`formatSalary` from `@/lib/utils`).
- Pass `concierge={user.plan === "concierge"}` to `ApplicationBoard`. In `board.tsx`, add the prop `concierge?: boolean` and replace `BOARD_COLUMNS` in `const columns = …` with `boardColumns(Boolean(concierge))`.

The data code for the page:

```tsx
const concierge = user.plan === "concierge" ? await clientConcierge(getDb(), user.id) : null;
const signals = concierge ? await candidateSignals(user.id) : null;
const proposals =
  concierge && signals
    ? concierge.proposals.map((proposal) => ({
        id: proposal.id,
        jobTitle: proposal.jobTitle,
        companyName: proposal.companyName,
        location: proposal.location,
        note: proposal.note,
        proposedByName: proposal.proposedByName,
        score: proposal.job ? quickMatch(signals, proposal.job).score : null,
        pay: proposal.job
          ? formatSalary(
              proposal.job.salaryMin,
              proposal.job.salaryMax,
              proposal.job.salaryCurrency,
              proposal.job.salaryPeriod,
            )
          : null,
      }))
    : [];
```

and, before the board:

```tsx
{
  concierge ? (
    <FromSpecialist
      specialistName={concierge.specialist?.name ?? "your specialist"}
      proposals={proposals}
      questions={concierge.questions}
    />
  ) : null;
}
```

The page's new imports:

```tsx
import { clientConcierge, getDb } from "@gettargetrole/db";
import { quickMatch } from "@gettargetrole/jobs/match";
import { FromSpecialist } from "@/components/concierge/from-specialist";
import { formatSalary } from "@/lib/utils";
import { candidateSignals } from "@/server/data/profile";
```

In `apps/web/src/app/(app)/dashboard/page.tsx`, add the imports `import { clientConcierge, getDb } from "@gettargetrole/db";` and `import { ConciergeSetupCard, ConciergeWeekCard } from "@/components/concierge/setup-card";`. Add this line after the page's existing data fetching:

```tsx
const concierge = user.plan === "concierge" ? await clientConcierge(getDb(), user.id) : null;
```

and render these two cards at the top of the dashboard grid:

```tsx
{
  concierge ? (
    <>
      <ConciergeSetupCard
        specialist={concierge.specialist}
        jobSearchEmail={concierge.setup.jobSearchEmail}
        consentAt={concierge.setup.consentAt}
        accessConfirmedAt={concierge.setup.accessConfirmedAt}
      />
      <ConciergeWeekCard
        specialistName={concierge.specialist?.name ?? "Your specialist"}
        applied={concierge.week.applied}
        target={concierge.week.target}
        paused={concierge.setup.paused}
      />
    </>
  ) : null;
}
```

- [ ] **Step 5: Settings: setup and pause.** Append to `apps/web/src/app/(app)/settings/actions.ts` (import `getDb`, `saveJobSearchSetup` and `setConciergePaused` from `@gettargetrole/db`, and `withConcierge`):

```ts
export const saveJobSearchEmail = authedAction(
  z.object({ jobSearchEmail: z.string().trim().max(200), consent: z.boolean() }),
  async ({ jobSearchEmail, consent }, user) => {
    await withConcierge(() =>
      saveJobSearchSetup(getDb(), { clientId: user.id, jobSearchEmail, consent }),
    );
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return null;
  },
);

export const setSearchPaused = authedAction(
  z.object({ paused: z.boolean() }),
  async ({ paused }, user) => {
    await setConciergePaused(getDb(), user.id, paused);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return null;
  },
);
```

Append to `apps/web/src/app/(app)/settings/settings-forms.tsx`:

- add `saveJobSearchEmail` and `setSearchPaused` to its `./actions` import;
- add `Input` and `Label` from `@/components/ui/form` and `Button` from `@/components/ui/button` if they aren't imported yet;
- add `import { useRouter } from "next/navigation";`.

```tsx
export function ConciergeSettingsForm({
  jobSearchEmail,
  consent,
  paused,
}: {
  jobSearchEmail: string;
  consent: boolean;
  paused: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(jobSearchEmail);
  const [agreed, setAgreed] = useState(consent);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveJobSearchEmail({ jobSearchEmail: email, consent: agreed });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved. Your specialist will confirm they can open it.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="job-search-email">Job-search Gmail</Label>
          <Input
            id="job-search-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="yourname.jobs@gmail.com"
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          I authorize my specialist to create accounts and apply for jobs on my behalf with this
          email.
        </label>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </form>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          defaultChecked={paused}
          onChange={(event) => {
            const next = event.target.checked;
            startTransition(async () => {
              const result = await setSearchPaused({ paused: next });
              if (!result.ok) toast.error(result.error);
              else toast.success(next ? "Search paused." : "Search resumed.");
              router.refresh();
            });
          }}
        />
        Pause my search (your specialist stops proposing and the weekly target is suspended)
      </label>
    </div>
  );
}
```

In `apps/web/src/app/(app)/settings/page.tsx`:

- add the imports `import { clientConcierge, getDb } from "@gettargetrole/db";` and `ConciergeSettingsForm` to the `./settings-forms` import;
- after the page's data loading, add `const concierge = user.plan === "concierge" ? await clientConcierge(getDb(), user.id) : null;`;
- render this card before the danger zone card:

```tsx
{
  concierge ? (
    <Card id="concierge">
      <CardHeader
        title="Concierge"
        description="Your job-search Gmail, your consent, and pausing your search."
      />
      <CardBody>
        <ConciergeSettingsForm
          jobSearchEmail={concierge.setup.jobSearchEmail}
          consent={Boolean(concierge.setup.consentAt)}
          paused={concierge.setup.paused}
        />
      </CardBody>
    </Card>
  ) : null;
}
```

- [ ] **Step 5b: Show who submitted.** In `getApplicationDetail` (`apps/web/src/server/data/applications.ts`, adding `users` to its `@gettargetrole/db` import), before its `return`:

```ts
const submittedByName =
  application.submittedByUserId && application.submittedByUserId !== userId
    ? ((
        await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, application.submittedByUserId))
          .limit(1)
      )[0]?.name ?? null)
    : null;
```

and add `submittedByName` to the returned object. In `apps/web/src/app/(app)/applications/[id]/page.tsx`, directly after the status `<Badge …>{STATUS_META[application.status].label}</Badge>`:

```tsx
{
  detail.submittedByName ? (
    <Badge tone="outline">Submitted by {detail.submittedByName}</Badge>
  ) : null;
}
```

- [ ] **Step 6: A client's saved job counts as approved.** In `saveJob` in `apps/web/src/app/(app)/jobs/actions.ts`, after `ensureApplicationForJob(...)`:

```ts
await approveOwnSave(getDb(), { clientId: user.id, applicationId: application.id });
```

(import `approveOwnSave` from `@gettargetrole/db`; `getDb` is already imported).

- [ ] **Step 7: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint src`
Expected: no type or lint errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "Show Concierge clients their proposals, questions, setup, week and pause switch"
```

---

### Task 13: Admin team view

**Files:**

- Modify: `apps/web/src/app/(app)/admin/actions.ts` (`assignSpecialist` → `assignClient`; new `setClientWeeklyTarget`)
- Modify: `apps/web/src/app/(app)/admin/page.tsx` (the `Specialists` tab)
- Modify: `apps/web/src/app/(app)/admin/admin-client.tsx` (a `TargetForm` component)

**Interfaces:**

- Consumes: `teamOverview`, `assignClient` and `setWeeklyTarget` (Tasks 5–6); `withConcierge` (Task 7).
- Produces: the action `setClientWeeklyTarget({ clientId, target: number | null })`, and the Concierge tab's team tables.

- [ ] **Step 1: Assign through the rules.** In `assignSpecialist` in `apps/web/src/app/(app)/admin/actions.ts`, replace the `db.insert(specialistAssignments)…onConflictDoUpdate(…)` statement with:

```ts
await assignClient(db, { clientId: client.id, specialistId });
```

In its audit call, change `action: "admin.specialist.assign"` to `action: "admin.concierge.assign"`. Import `assignClient` and `setWeeklyTarget` from `@gettargetrole/db`, and `withConcierge` from `@/lib/concierge-errors`. Then append:

```ts
export const setClientWeeklyTarget = authedAction(
  z.object({ clientId: z.string().min(1), target: z.number().int().min(1).max(100).nullable() }),
  async ({ clientId, target }, user) => {
    await withConcierge(() => setWeeklyTarget(getDb(), clientId, target));
    await recordAudit({
      actorUserId: user.id,
      action: "admin.concierge.target",
      targetType: "user",
      targetId: clientId,
      metadata: { target },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);
```

- [ ] **Step 2: The target form.** Append to `apps/web/src/app/(app)/admin/admin-client.tsx`, using the file's existing `useAction` helper and importing `setClientWeeklyTarget`:

```tsx
export function TargetForm({
  clientId,
  target,
  isOverride,
}: {
  clientId: string;
  target: number;
  isOverride: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("target") ?? "").trim();
        run(
          () => setClientWeeklyTarget({ clientId, target: value ? Number(value) : null }),
          value ? "Target saved." : "Back to the plan default.",
        );
      }}
    >
      <Input
        name="target"
        type="number"
        min={1}
        max={100}
        defaultValue={isOverride ? target : ""}
        placeholder={String(target)}
        className="h-8 w-20"
        aria-label="Weekly target"
      />
      <Button size="sm" variant="secondary" loading={pending}>
        Set
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: The team tables.** In `apps/web/src/app/(app)/admin/page.tsx`, change `Specialists()` so that, below the existing assignments card, it also renders a "Team this week" card and a "Clients" card:

```tsx
async function Specialists() {
  const { specialists, assignments } = await listAssignments();
  const team = await teamOverview(getDb());
  const overrides = new Map(
    (
      await getDb()
        .select({ userId: profiles.userId, override: profiles.weeklyTargetOverride })
        .from(profiles)
        .where(inArray(profiles.userId, team.clients.map((row) => row.clientId).concat(["-"])))
    ).map((row) => [row.userId, row.override]),
  );
  const byId = new Map(specialists.map((specialist) => [specialist.id, specialist]));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Team this week"
          description="Applications against targets, proposals waiting and results over the last 30 days."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Specialist</th>
                <th className="py-2 pr-3">Clients</th>
                <th className="py-2 pr-3">Applied / target</th>
                <th className="py-2 pr-3">Behind</th>
                <th className="py-2 pr-3">Proposals waiting</th>
                <th className="py-2 pr-3">Open questions</th>
                <th className="py-2 pr-3">Approval rate</th>
                <th className="py-2">Interview rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {team.specialists.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3 font-medium">{row.name}</td>
                  <td className="py-2 pr-3">{row.clients}</td>
                  <td className="py-2 pr-3">
                    {row.appliedThisWeek} / {row.targetTotal}
                  </td>
                  <td className={row.behind > 0 ? "py-2 pr-3 text-danger" : "py-2 pr-3"}>
                    {row.behind}
                  </td>
                  <td className="py-2 pr-3">
                    {row.proposalsWaiting}
                    {row.oldestProposalDays !== null ? ` (oldest ${row.oldestProposalDays}d)` : ""}
                  </td>
                  <td className="py-2 pr-3">{row.openQuestions}</td>
                  <td className="py-2 pr-3">
                    {row.approvalRate === null ? "—" : `${row.approvalRate}%`}
                  </td>
                  <td className="py-2">
                    {row.interviewRate === null ? "—" : `${row.interviewRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Clients" />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">Specialist</th>
                <th className="py-2 pr-3">Setup</th>
                <th className="py-2 pr-3">This week</th>
                <th className="py-2 pr-3">Weekly target</th>
                <th className="py-2 pr-3">Last activity</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {team.clients.map((row) => (
                <tr key={row.clientId}>
                  <td className="py-2 pr-3">
                    <span className="font-medium">{row.name}</span>{" "}
                    <span className="text-muted-foreground">({row.email})</span>
                  </td>
                  <td className="py-2 pr-3">{row.specialistName}</td>
                  <td className="py-2 pr-3">
                    {row.setup === "done"
                      ? "Done"
                      : row.setup === "waiting_access"
                        ? "Waiting for access"
                        : "Not started"}
                  </td>
                  <td className={row.behind ? "py-2 pr-3 text-danger" : "py-2 pr-3"}>
                    {row.paused ? "Paused" : `${row.appliedThisWeek} / ${row.target}`}
                  </td>
                  <td className="py-2 pr-3">
                    <TargetForm
                      clientId={row.clientId}
                      target={row.target}
                      isOverride={overrides.get(row.clientId) != null}
                    />
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {row.lastActivity ? timeAgo(row.lastActivity) : "—"}
                  </td>
                  <td className="py-2">
                    <Link href={`/specialist/${row.clientId}`} className="text-primary">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Concierge assignments"
          description="Each client has one specialist; assigning a new one asks the client to share their inbox again."
        />
        <CardBody className="space-y-4">
          <AssignForm specialists={specialists} />
          <ul className="divide-y divide-border text-sm">
            {assignments.map((assignment) => (
              <li
                key={`${assignment.specialistId}-${assignment.clientId}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span>
                  <span className="font-medium">{assignment.clientName}</span>{" "}
                  <span className="text-muted-foreground">({assignment.clientEmail})</span> →{" "}
                  {byId.get(assignment.specialistId)?.name ?? "Unknown specialist"}
                </span>
                <UnassignButton
                  specialistId={assignment.specialistId}
                  clientId={assignment.clientId}
                />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
```

Add to the page's imports:

- `teamOverview`, `getDb` and `profiles` from `@gettargetrole/db`;
- `inArray` from `drizzle-orm`;
- `TargetForm` from `./admin-client`;
- `Link` from `next/link`, if it isn't imported already.

- [ ] **Step 4: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint "src/app/(app)/admin"`
Expected: no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/admin"
git commit -m "Add the Concierge team view, weekly targets and one-specialist assignments to Admin"
```

---

### Task 14: Worker jobs: expiry and daily digest

**Files:**

- Modify: `packages/core/src/queues.ts`
- Create: `apps/worker/src/concierge.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/src/concierge.integration.test.ts`

**Interfaces:**

- Consumes: `expireProposals` (Task 3); `notifications` and `applications` (schema); `sendEmail`.
- Produces:
  - `JOB_NAMES.expireProposals = "expire-proposals"` and `JOB_NAMES.conciergeDigest = "concierge-digest"`
  - `sendConciergeDigests(now?: Date, db?: Database): Promise<number>`, the number of clients emailed.

- [ ] **Step 1: Write the failing test** `apps/worker/src/concierge.integration.test.ts`:

```ts
import type * as DbModule from "@gettargetrole/db";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as ConciergeModule from "./concierge";

const TEST_DATABASE_URL = testDatabaseUrl("worker");

describe.skipIf(!TEST_DATABASE_URL)("Concierge daily digest (Postgres integration)", () => {
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let concierge: typeof ConciergeModule;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    concierge = await import("./concierge");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE users, companies RESTART IDENTITY CASCADE`);
    await database
      .insert(db.users)
      .values({ id: "client-1", name: "Riya", email: "riya@example.com", plan: "concierge" });
    await database.insert(db.applications).values({
      userId: "client-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      status: "proposed",
      proposedAt: new Date("2026-09-30T08:00:00Z"),
    });
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  it("sends one digest per client per day for new proposals", async () => {
    const now = new Date("2026-09-30T14:00:00Z");
    expect(await concierge.sendConciergeDigests(now)).toBe(1);
    expect(await concierge.sendConciergeDigests(now)).toBe(0);
    const rows = await db.getDb().select().from(db.notifications);
    expect(rows).toEqual([
      expect.objectContaining({
        userId: "client-1",
        type: "concierge",
        dedupeKey: "digest:2026-09-30",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run from `apps/worker`: `TEST_DATABASE_URL=postgres://postgres@memory/postgres npx vitest run --config /private/tmp/claude-501/-Users-sundhar-raju-Projects-NextRole/26fcde03-93e0-42e0-850a-a29b54786f1a/scratchpad/vitest.pglite.config.mjs --root . src/concierge.integration.test.ts`
Expected: FAIL, cannot find `./concierge`.

- [ ] **Step 3: Implement.** In `packages/core/src/queues.ts`, add to `JOB_NAMES`:

```ts
  /** Scheduled daily: Concierge proposals left unanswered for a week become skipped. */
  expireProposals: "expire-proposals",
  /** Scheduled daily: one email per Concierge client with new proposals. */
  conciergeDigest: "concierge-digest",
```

Create `apps/worker/src/concierge.ts`:

```ts
import { sendEmail } from "@gettargetrole/core/mailer";
import { applications, getDb, notifications, users, type Database } from "@gettargetrole/db";
import { and, eq, gte, sql } from "drizzle-orm";

export { expireProposals } from "@gettargetrole/db";

const DAY_MS = 86_400_000;

/**
 * Emails each Concierge client with proposals from the last day, once per day: the in-app
 * notification's dedupe key (digest:<date>) decides who still needs today's email.
 */
export async function sendConciergeDigests(
  now = new Date(),
  db: Database = getDb(),
): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select({
      userId: applications.userId,
      email: users.email,
      name: users.name,
      count: sql<number>`count(*)::int`,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(eq(applications.status, "proposed"), gte(applications.proposedAt, since)))
    .groupBy(applications.userId, users.email, users.name);
  const day = now.toISOString().slice(0, 10);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  let sent = 0;
  for (const row of rows) {
    const [inserted] = await db
      .insert(notifications)
      .values({
        userId: row.userId,
        type: "concierge",
        title: "New jobs from your specialist",
        body: `${row.count} job${row.count === 1 ? "" : "s"} waiting for your approval.`,
        link: "/applications",
        dedupeKey: `digest:${day}`,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!inserted) continue;
    try {
      await sendEmail({
        to: row.email,
        subject: "New jobs from your specialist",
        text: `Hi ${row.name},\n\nYour specialist found ${row.count} job${row.count === 1 ? "" : "s"} for you. Approve the ones you want them to apply to, or skip the rest:\n\n${base}/applications\n\nProposals you don't answer within a week are skipped.\n`,
      });
    } catch (error) {
      // Undo today's marker so the queue's retry sends this email again.
      await db.delete(notifications).where(eq(notifications.id, inserted.id));
      throw error;
    }
    sent++;
  }
  return sent;
}
```

In `apps/worker/src/index.ts`:

- import `{ expireProposals, sendConciergeDigests } from "./concierge"`;
- add these cases to `handleNotifications`:

```ts
    case JOB_NAMES.expireProposals:
      return { expired: await expireProposals(getDb()) };
    case JOB_NAMES.conciergeDigest:
      return { sent: await sendConciergeDigests() };
```

- add `getDb` to the `@gettargetrole/db` import;
- after the `follow-up-schedule` scheduler, add:

```ts
await notificationsQueue.upsertJobScheduler(
  "expire-proposals-schedule",
  // Daily at 03:30 UTC.
  { pattern: "30 3 * * *" },
  { name: JOB_NAMES.expireProposals },
);
await notificationsQueue.upsertJobScheduler(
  "concierge-digest-schedule",
  // Daily at 14:00 UTC.
  { pattern: "0 14 * * *" },
  { name: JOB_NAMES.conciergeDigest },
);
```

- [ ] **Step 4: Run the tests to see them pass**

Run the Step 2 command again, then `cd apps/worker && npx tsc --noEmit -p . && npx eslint src && cd ../../packages/core && npx tsc --noEmit -p .`.
Expected: PASS, with no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queues.ts apps/worker/src
git commit -m "Expire week-old Concierge proposals and send clients a daily digest"
```

---

### Task 15: Staff navigation

**Files:**

- Modify: `apps/web/src/components/app-shell/nav.tsx`

**Interfaces:**

- Produces: a "Staff" group in the sidebar, holding Concierge board (specialists and admins) and Admin (admins). Customer care joins it in project 2.

- [ ] **Step 1: Group the staff links.** In `NavLinks`, replace the `links` construction and the returned markup with:

```tsx
const staff = [
  ...(role === "specialist" || role === "admin"
    ? [{ href: "/specialist", label: "Concierge board", icon: UsersRound }]
    : []),
  ...(role === "admin" ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
];
const renderLink = ({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Shield;
}) => {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      key={href}
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary-soft text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
};
return (
  <nav className="flex flex-col gap-1" aria-label="App">
    {LINKS.map(renderLink)}
    {staff.length > 0 ? (
      <>
        <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Staff
        </p>
        {staff.map(renderLink)}
      </>
    ) : null}
  </nav>
);
```

- [ ] **Step 2: Run the checks**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint src/components/app-shell`
Expected: no type or lint errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/app-shell/nav.tsx
git commit -m "Group staff pages under a Staff heading in the sidebar"
```

---

### Task 16: End-to-end test of the whole flow

**Files:**

- Create: `apps/web/e2e/concierge.spec.ts`

**Interfaces:**

- Consumes: `signUpAndOnboard`, `setPlan`, `sql` and `uniqueEmail` from `e2e/helpers.ts`; everything above.

- [ ] **Step 1: Write the test** `apps/web/e2e/concierge.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { setPlan, signUpAndOnboard, sql, uniqueEmail } from "./helpers";

test("a specialist proposes, the client approves, the specialist submits and everyone sees it", async ({
  browser,
}) => {
  const clientEmail = uniqueEmail("riya");
  const specialistEmail = uniqueEmail("priya");
  const clientPage = await (await browser.newContext()).newPage();
  const specialistPage = await (await browser.newContext()).newPage();

  await signUpAndOnboard(clientPage, "Riya Client", clientEmail);
  await setPlan(clientEmail, "concierge");
  await signUpAndOnboard(specialistPage, "Priya Specialist", specialistEmail);
  await sql("update users set role = 'specialist' where email = $1", [specialistEmail]);
  const ids = await sql("select id, email from users where email = any($1)", [
    [clientEmail, specialistEmail],
  ]);
  const clientId = ids.rows.find((row) => row.email === clientEmail).id;
  const specialistId = ids.rows.find((row) => row.email === specialistEmail).id;
  await sql("insert into specialist_assignments (specialist_id, client_id) values ($1, $2)", [
    specialistId,
    clientId,
  ]);

  // The client sets up their job-search Gmail and gives consent.
  await clientPage.goto("/settings#concierge");
  await clientPage.getByLabel("Job-search Gmail").fill("riya.jobs.e2e@gmail.com");
  await clientPage
    .getByLabel(/I authorize my specialist to create accounts and apply for jobs/)
    .check();
  await clientPage.getByRole("button", { name: "Save" }).first().click();

  // The specialist proposes two jobs.
  await specialistPage.goto(`/specialist/${clientId}?tab=find`);
  const boxes = specialistPage.getByRole("checkbox", { name: /^Propose / });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await specialistPage.getByRole("button", { name: /Propose to client \(2\)/ }).click();
  await expect(specialistPage.getByText("Proposed 2 jobs to the client.")).toBeVisible();

  // The client approves one and skips the other.
  await clientPage.goto("/applications");
  const section = clientPage.getByRole("region", { name: "From your specialist" });
  await section.getByRole("button", { name: "Approve", exact: true }).first().click();
  await section.getByRole("combobox").first().selectOption("pay");
  await section.getByRole("button", { name: "Skip", exact: true }).first().click();
  await expect(clientPage.getByRole("region", { name: "From your specialist" })).toHaveCount(0);

  // The specialist opens the approved application and marks it submitted.
  await specialistPage.goto("/specialist?column=approved");
  await specialistPage
    .getByRole("region", { name: "Approved — to submit column" })
    .getByRole("link")
    .first()
    .click();
  await specialistPage.getByRole("button", { name: "Mark submitted" }).click();
  await expect(specialistPage.getByText("Applied", { exact: true }).first()).toBeVisible();

  // The client sees the week's progress and who submitted.
  await clientPage.goto("/dashboard");
  await expect(clientPage.getByText(/applied to 1 of your 15 this week/)).toBeVisible();

  // An admin sees the same numbers on the team view.
  const adminEmail = uniqueEmail("ada");
  const adminPage = await (await browser.newContext()).newPage();
  await signUpAndOnboard(adminPage, "Ada Admin", adminEmail);
  await sql("update users set role = 'admin' where email = $1", [adminEmail]);
  await adminPage.goto("/admin?tab=specialists");
  await expect(adminPage.getByRole("row", { name: /Riya Client/ })).toContainText("1 / 15");
});
```

- [ ] **Step 2: Typecheck the test**

Run: `cd apps/web && npx tsc --noEmit -p .`
Expected: no type errors. (Playwright can't run in the sandbox, which can't bind ports; CI runs it.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/concierge.spec.ts
git commit -m "Cover the Concierge flow end to end: propose, approve, submit and track"
```

---

### Task 17: Documentation

**Files:**

- Modify: `README.md` (the Concierge row in the features table)
- Modify: `docs/ARCHITECTURE.md` (a "Concierge board" section)

- [ ] **Step 1: Update the README.** Replace the `**Concierge**` table row's description with: "Your team applies for Concierge clients. Specialists find and propose jobs, and clients approve each one. Specialists tailor the kit and submit on the employer's site using a job-search Gmail the client shares by delegation. One board tracks everything, with weekly targets and an admin team view. No passwords are stored and nothing is submitted by bots."

- [ ] **Step 2: Add the architecture section.** Add this section to `docs/ARCHITECTURE.md` after the job pipeline sections:

```markdown
## Concierge board

Specialists apply for Concierge clients; the design is in
`docs/superpowers/specs/2026-09-30-concierge-staff-board-design.md`.

- **Workflow.** Applications gain four steps: `proposed`, `approved`, `waiting_on_client` and
  `skipped`. `canTransition` (`packages/db/src/concierge/rules.ts`) decides who may make each
  move: only the client approves or skips, only staff ask questions, and staff can't submit
  without the client's consent.
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
```

- [ ] **Step 3: Format and commit**

Run: `./node_modules/.bin/prettier --write README.md docs/ARCHITECTURE.md`

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "Document the Concierge board"
```
