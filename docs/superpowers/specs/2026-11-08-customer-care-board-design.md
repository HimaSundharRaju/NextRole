# Customer care board: design

- **Date:** 2026-11-08
- **Status:** approved in conversation, awaiting review of this document.
- **Project:** 2 of 2. Project 1, the Concierge staff board, shipped in #39.

## Goal

Every customer issue lands in one place, gets an owner and a status, and gets resolved, and every staff action is on record. Customer care agents work from one board under the Staff menu. From it they:

- answer help requests;
- fix account problems;
- review what users flag about jobs and companies;
- pick up Concierge escalations.

Success looks like this:

- a user who writes in gets a first reply within 24 hours and can follow the conversation in the app;
- an agent solves common account problems without an admin: plan changes, bans, verification, password resets, and data export or deletion;
- nothing users flag sits unreviewed, and a Concierge client who falls behind is noticed the following Monday.

## Decisions

These were agreed while brainstorming:

1. **Replies:** an in-app conversation.
   - Agent replies are emailed to the user with a link back to the conversation, and the user answers in the app.
   - Replying to the email itself isn't captured. Inbound email could be added later on the same threads.
2. **Agent powers:** agents can do everything on a user's account except change roles.
   - Each change needs a short reason and goes in the audit log.
   - Deletion only happens for a request the account itself made, with a typed confirmation.
3. **Assignment:** one shared queue.
   - New requests are unassigned until an agent takes one.
   - Owners can hand a case to another agent, and admins can reassign any case.
4. **Response time:** one target, a first reply within 24 hours.
5. **Escalations** come from three places:
   - a specialist's "Escalate to care" button;
   - a client's "Concierge" topic in Contact support;
   - a weekly check for missed targets. It keeps at most one open escalation per client, and adds later misses to it as notes.
6. **Approach:**
   - Help requests and escalations are cases, in new tables.
   - Job reports and company requests stay in their own tables and appear as review queues.
   - Account help is a lookup page.

## What exists today

- **Roles:** `user`, `specialist` and `admin` (`packages/db/src/schema/auth.ts`).
  - Pages call `requireRole` (`apps/web/src/server/session.ts`). `toSessionUser` turns any role it doesn't know into `user`.
  - The sidebar has a Staff group (`apps/web/src/components/app-shell/nav.tsx`).
- **Account controls:** Admin → Users searches users and changes role, plan or ban (`apps/web/src/app/(app)/admin/actions.ts`). Only admins can do this, and banning deletes the user's sessions.
- **Job reports:** `job_reports` holds one report per user and job, with the reasons `closed`, `no_reply`, `not_real` and `other`.
  - Each report from a different user adds 20 ghost points, up to three reports (`packages/jobs/src/ghosts.ts`).
  - A score of 60 hides a job as a likely ghost.
  - Nobody reviews the reports.
- **Company requests:** `company_requests` has the statuses `pending`, `added`, `tracked` and `not_found`, and the sources `user`, `admin` and `yc`.
  - Discovery works through the pending ones.
  - Admin → Job sources lists them and has "Add by careers URL" (`addCompanyByUrl`, built on `discoverBoard`).
- **Email:** `sendEmail` (`packages/core/src/mailer.ts`) only sends, and Mailpit catches the mail locally. Better Auth sends the verification and password-reset emails.
- **Data rights:** Export (`/api/account/export`, `exportUserData`) and Delete (`deleteUserAccount`) are self-serve in Settings.
- **Shared pieces:**
  - `notifications`, `recordAudit` and the rate-limit policies (`packages/core/src/rate-limit.ts`);
  - from the Concierge board: staff-only notes kept out of client views and exports;
  - conditional updates that fail with "This changed — refresh".
- **Pages:** the `(app)` route group's layout requires sign-in. Signed-out pages live in `(auth)`.
- **Contact:** "Contact support" is only a sentence in Settings.

## Out of scope

- **Channels:** receiving email replies, attachments, and a chat widget.
- **Helpdesk extras:** saved replies, satisfaction surveys and priorities.
- **Money:** refunds and billing. There is no billing yet.
- **Agent alerts:** push notifications to agents. The board's counts show what needs attention.
- **Job edits:** changing a job's synced details. Agents keep or hide jobs instead.

## Roles, access and navigation

- **New role:** `ROLES` gains `support`.
  - Admins set it in Admin → Users.
  - `toSessionUser` keeps `support`; today it keeps only `admin` and `specialist`.
- **Navigation:** the Staff group gets a **Customer care** link for `support` and `admin`. Support agents don't see the Concierge board or Admin.
- **Who can do what:**
  - `/care` and everything under it require `support` or `admin`.
  - Admins can do everything support can, and only admins change roles.
- **Staff accounts belong to admins:**
  - Support agents act only on accounts with the `user` role.
  - Admins handle the accounts of specialists, support agents and admins, in Admin → Users.
  - Nobody acts on their own account from the board.

## What users see

The support pages live in a new `(support)` route group, because they work signed in or out. The layout shows the app's sidebar when signed in and a plain header when not.

### Contact support

- **Links:**
  - "Contact support" in the sidebar, and in Settings, replacing today's sentence;
  - "Can't sign in? Contact support" on the sign-in page.
- **Form:** `/support` has a topic, a subject (up to 120 characters) and a message (up to 5,000 characters).
- **Topics** (`SUPPORT_TOPICS`):
  - `account`: Account & sign-in
  - `billing`: Plan & billing
  - `concierge`: Concierge
  - `jobs`: Jobs & listings
  - `bug`: Something's broken
  - `data`: My data (export or delete)
  - `other`: Other
- **Signed in:** the case belongs to the account and is verified at once.
- **Signed out:**
  - The form also asks for a name and an email address.
  - If the email belongs to an account, the case is linked to it but isn't verified (see "The private link").
  - A hidden honeypot field catches bots. Their submissions are dropped, but they still see the normal confirmation.
- **After sending:** "We've got it — request #1042. We usually reply within a day", plus the confirmation email.

### Your requests and the private link

- **The list:** `/support/requests` (signed in) shows the user's cases, newest activity first.
  - Each row shows the number, subject, status ("With our team", "Waiting on you" or "Solved") and last update.
  - A case appears here if the user raised it, or if an agent has written to them publicly.
- **A case:** `/support/requests/[id]` shows the public messages only, with a reply box.
- **The private link:** every case gets a random token when it's created, and only its SHA-256 hash is stored.
  - Every email to the requester carries the link: `/support/requests/[id]?key=<token>`.
  - It works signed out, shows only the public thread, allows replies, and never signs anyone in.
  - It stops working 14 days after the case is solved.
- **Verified:**
  - A case created while signed in is verified from the start.
  - A signed-out case that is linked to an account and not yet verified shows "Yes, I made this request" on its private-link page. Clicking it marks the case verified, because only someone who controls that mailbox has the link.
  - Opening the link alone doesn't verify anything. Someone who receives a request they didn't make shouldn't confirm it just by looking.
- **Solved cases:**
  - A reply within 14 days of solving reopens the case.
  - After that, the reply box is replaced by "Start a new request", which opens the form with "Follow-up to #1042" filled in.

### Emails and notifications

- **Format:** plain text through `sendEmail`, with the subject `[#1042] <subject>`. Each email ends with the private link and "Replies to this email aren't read — use the link above."
- **When:**
  - on submission;
  - on every public agent reply;
  - when the case is solved, whether by an agent or automatically.
- **Escalations:** escalation cases send nothing until an agent writes to the client publicly.
- **In-app:** signed-in users also get a notification for agent replies and solves, with the new `support` notification type.
- **Failures:** the message and the notification are saved first. A failed email is logged and doesn't undo the reply.

## Cases

### Kinds and sources

| Kind         | Source         | Who it's about                                                      | Raised by      |
| ------------ | -------------- | ------------------------------------------------------------------- | -------------- |
| `help`       | `form`         | the requester, or nobody when a signed-out email matches no account | the requester  |
| `escalation` | `specialist`   | the Concierge client                                                | the specialist |
| `escalation` | `weekly_check` | the Concierge client                                                | the system     |

A client's own "Concierge" request is a `help` case with the topic `concierge`, and their specialist is recorded on it. The specialist doesn't see it.

### Statuses

| From                      | To                | When                                                                  |
| ------------------------- | ----------------- | --------------------------------------------------------------------- |
| _(new)_                   | `open`            | a form submission, a specialist's escalation or the weekly check      |
| any                       | `waiting_on_user` | an agent posts a public reply                                         |
| `waiting_on_user`         | `open`            | the user replies                                                      |
| `solved`                  | `open`            | the user replies within 14 days of solving, or an agent clicks Reopen |
| `open`, `waiting_on_user` | `solved`          | an agent clicks Solve, or the case has waited on the user for 7 days  |

Internal notes never change the status. The rules live in one pure function, `canMoveCase(from, to, actor)`, in `packages/db/src/support/rules.ts`.

### Ownership

- **Take it:** new cases are unassigned. **Take it** makes the agent the owner. It only succeeds while the case is still unassigned; otherwise the agent sees "This changed — refresh".
- **Replying:** a public reply on an unassigned case makes the replier its owner.
- **Handing off:** the owner can hand the case to another agent (support or admin), and admins can reassign any case.
- **Anyone helps:** any agent can reply to any case or add a note.

### The first-reply target

- **Setting:** a single constant, `FIRST_REPLY_HOURS = 24`.
- **What it covers:** `help` cases. Each is due 24 hours after it's created, and the first public agent reply meets the target. Internal notes don't count.
- **Overdue:** a help case that isn't solved, has no public agent reply, and is more than 24 hours old.
- **On the board:** cards show "Due in 3h" or "Overdue by 5h".
- **Escalations don't count,** because care may settle them without writing to the client. They show their age instead.
- **Typical first-reply time:** the median, over help cases created in the last 7 days that have a first reply.

### Internal notes

- **What they are:** staff-only messages on a case.
- **Privacy:** they're never emailed, never shown to the user, and left out of the user's data export.
- **System notes:** the system adds notes too, for account actions taken from the case, repeated missed weeks and automatic solves.

## The care board

### `/care?tab=requests` (the default tab)

- **Counts:**
  - unassigned cases;
  - overdue cases;
  - cases waiting on the user;
  - the typical first-reply time.
- **Quick filters:**
  - Mine
  - Unassigned
  - Overdue
  - Waiting on user
  - Solved (the last 30 days)
- **Other filters:** topic, and a search by request number, email or subject.
- **Each row:** number, subject, topic, kind, requester (name, email and plan), owner, status, due time or age, and last message time.
- **Sorting:** unsolved cases sort overdue first, then oldest first.

### `/care/cases/[id]`

- **The conversation:** public messages and internal notes, clearly marked, oldest first.
- **The reply box:**
  - **Send reply:** public, and emailed to the requester.
  - **Add note:** internal.
- **Actions:** Take it, Hand off (pick an agent), Solve and Reopen.
- **The side panel:**
  - **The requester:** name, email, whether verified, plan, join date, and a link to their account page. When a signed-out email matches no account, it shows "No account".
  - **Concierge clients:**
    - their specialist and setup status;
    - this week and last week against target;
    - open proposals and last activity;
    - for admins, a link to Admin → Concierge.
  - **Other recent cases** from the same requester.
- **Audit:** every change to a case goes in the audit log. Opening one doesn't; the account page view is what's audited.

### `/care?tab=reports`

- **The list:** open, unhidden jobs that have reports nobody has reviewed, grouped by job, most-reported first.
- **Each row:**
  - the title, company, location and posting date;
  - the ghost score, and the number of reports by reason;
  - the latest notes;
  - links to the job page and the employer's posting.
- **Keep it:** marks the job's unreviewed reports `kept`.
  - Kept reports stop adding ghost points, and the job is rescored.
  - New reports count as usual.
- **Hide it** (a reason is required): sets the job's `hidden_at` and marks its reports `hidden`.
  - Hidden jobs drop out of search, top matches, alerts, auto-prepare and Concierge proposals.
  - The job page tells anyone who opens it that the posting was removed.
  - Syncs never clear the marker, and applications already made for the job stay.
- **Undoing a hide:** a "Recently hidden" filter (the last 30 days) has **Show it again**.
- **The new report reason:** the report form on the job page gains "Wrong details (location, pay or company)" (`wrong_details`), which doesn't count toward the ghost score.

### `/care?tab=companies`

- **The list:** requests from users (`source = user`) that are `not_found`, or still `pending` 3 days after they were made. Each shows the name, link, who asked, their note and age.
- **Add it:** the agent confirms or pastes the careers URL, and the existing detection (`discoverBoard`, as in `addCompanyByUrl`) finds the board and tracks the company.
  - The request becomes `added`, with the company linked.
  - Other user requests for the same company that are still `pending` or `not_found` are resolved with it. "The same company" means the same name, ignoring case, or the same careers host.
  - Each requester gets an in-app notification and an email.
  - If detection can't read the board, the agent sees why and the request stays as it was.
- **Can't add it** (a reason is required): the request becomes `declined`, and the reason is saved in its note and sent to the requester.

### `/care?tab=users` and `/care/users/[id]`

- **Search:** by name or email, with the existing `searchUsers`.
- **The account page shows:**
  - **The account:** name, email, whether it's verified, plan, role, join date, ban and reason, and last sign-in (the latest `auth.sign_in` audit entry).
  - **Usage:** this month's usage against allowances (`monthlyUsage`, `allowancesFor`), and AI spend against the plan's cap.
  - **Activity:** the last 20 audit-log entries about the account.
  - **Counts:** applications by status, resumes, and open and solved cases.
  - **Concierge clients:** their specialist, setup status, and this week and last week against target.
- **What it doesn't show:** resume contents, cover letters, application answers or outreach.
- **Audit:** opening the page is audited as `care.user.view`.

## Account help

These actions are on `/care/users/[id]`, for support agents and admins.

- **Reasons:** each action needs a reason of up to 300 characters.
- **Audit:** each goes in the audit log.
- **Case notes:** when the page was opened from a case (`?case=<id>`), each action also adds a system note to that case.
- **Limits:** support agents act only on `user` accounts, and nobody acts on their own account.

| Action              | Rules                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change plan         | Free, Plus, Pro or Concierge. Assigning a specialist stays in Admin → Concierge.                                                                                                                                                                                                                                  |
| Ban or unban        | Banning deletes the user's sessions, as Admin does today.                                                                                                                                                                                                                                                         |
| Resend verification | Only while the email is unverified. Sends Better Auth's verification email.                                                                                                                                                                                                                                       |
| Send password reset | Sends Better Auth's reset email, whose link lasts 1 hour.                                                                                                                                                                                                                                                         |
| Send export link    | Emails the account's address a single-use link, valid for 24 hours, to `/api/account/export/link?key=<token>`. It downloads what Settings → Export does, without signing in.                                                                                                                                      |
| Delete account      | Only from a `help` case with the topic `data` that is linked to this account, verified and not solved. The agent types the account's email to confirm. The account is deleted as Settings → Delete does, the user gets a confirmation email, and the case stays, without the account link and with a system note. |

"Unlock" is covered by unbanning and the password reset. The sign-in rate limit clears itself within a minute.

## Concierge escalations

- **The specialist's button:** **Escalate to care** in the client workspace (`/specialist/[clientId]`).
  - It takes a note of 10–2,000 characters, and opens an `escalation` case about the client (source `specialist`) with the note as an internal note.
  - It's audited as `specialist.case.escalate`.
  - The workspace header shows the latest escalation's status: "Escalated to care · open" or "· solved". Specialists see nothing else of the case.
- **The client's own request:** the "Concierge" topic opens a `help` case about the client, with their specialist recorded. The specialist doesn't see it.
- **The weekly check** runs Mondays at 06:00 UTC. It looks at each client on the Concierge plan who isn't paused when the check runs, and whose active assignment started before last week began.
  - It counts applications applied last week (Monday 00:00 to Monday 00:00, UTC) against the client's target, `targetFor(weekly_target_override)`.
  - If the client is below target and already has an unsolved escalation, it adds a system note, such as "Missed the week of Nov 2: 9 of 15".
  - If the client is below target with no unsolved escalation, it opens an unassigned escalation (source `weekly_check`) titled "Missed weekly target: 9 of 15".
  - `concierge_week_checks` records each client and week, so a second run does nothing.
- **On the case page:** the Concierge side panel. Agents reply to the client from the case, and admins change the specialist in Admin → Concierge.

## Data model

Migration `0012` only adds tables, columns and values. The code lives in `packages/db/src/support/` (rules, cases, queues and the weekly check), following `packages/db/src/concierge/`.

### `support_cases`: new table

| Column                          | Type                                                           | Purpose                                             |
| ------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| `id`                            | uuid                                                           |                                                     |
| `number`                        | integer, generated always as identity                          | The request number users see (#1042).               |
| `kind`                          | text enum: `help`, `escalation`                                |                                                     |
| `source`                        | text enum: `form`, `specialist`, `weekly_check`                |                                                     |
| `topic`                         | text enum: `SUPPORT_TOPICS`                                    | Escalations use `concierge`.                        |
| `status`                        | text enum: `open`, `waiting_on_user`, `solved`; default `open` |                                                     |
| `subject`                       | text                                                           |                                                     |
| `user_id`                       | text, references users (on delete set null)                    | Who the case is about.                              |
| `contact_name`, `contact_email` | text                                                           | Where emails go. Kept after the account is deleted. |
| `raised_by_user_id`             | text, references users (on delete set null)                    | Null for the weekly check.                          |
| `specialist_id`                 | text, references users (on delete set null)                    | Set on Concierge cases.                             |
| `assignee_id`                   | text, references users (on delete set null)                    | The owner.                                          |
| `verified_at`                   | timestamptz                                                    | When the requester proved control of the account.   |
| `access_token_hash`             | text, unique                                                   | The private link.                                   |
| `first_replied_at`              | timestamptz                                                    | The first public agent reply.                       |
| `solved_at`                     | timestamptz                                                    |                                                     |
| `last_message_at`               | timestamptz                                                    |                                                     |
| `status_changed_at`             | timestamptz                                                    | The clock for auto-solving.                         |
| `created_at`, `updated_at`      | timestamptz                                                    |                                                     |

Indexes: `(status, created_at)`, `(assignee_id, status)` and `(user_id)`.

### `support_messages`: new table

| Column           | Type                                               |
| ---------------- | -------------------------------------------------- |
| `id`             | uuid                                               |
| `case_id`        | uuid, references support_cases (on delete cascade) |
| `author_user_id` | text, references users (on delete set null)        |
| `author_kind`    | text enum: `user`, `agent`, `system`               |
| `visibility`     | text enum: `public`, `internal`                    |
| `body`           | text, up to 5,000 characters                       |
| `created_at`     | timestamptz                                        |

Index: `(case_id, created_at)`.

### `export_links`: new table

| Column               | Type                                        |
| -------------------- | ------------------------------------------- |
| `id`                 | uuid                                        |
| `user_id`            | text, references users (on delete cascade)  |
| `token_hash`         | text, unique                                |
| `created_by_user_id` | text, references users (on delete set null) |
| `expires_at`         | timestamptz, 24 hours after creation        |
| `used_at`            | timestamptz                                 |
| `created_at`         | timestamptz                                 |

### `concierge_week_checks`: new table

| Column       | Type                                       |
| ------------ | ------------------------------------------ |
| `client_id`  | text, references users (on delete cascade) |
| `week_start` | date                                       |
| `created_at` | timestamptz                                |

The primary key is `(client_id, week_start)`, which makes the weekly check safe to run twice.

### Changes to existing tables

- **`users.role`:** `ROLES` gains `support`. It's a text enum, so the database doesn't change.
- **`job_reports`:**
  - `reason` gains `wrong_details`;
  - new columns `reviewed_at`, `reviewed_by_user_id` (references users, on delete set null) and `resolution` (`kept` or `hidden`).
- **`jobs`:** new columns `hidden_at`, `hidden_by_user_id` (references users, on delete set null) and `hidden_reason` (text, default empty).
- **`company_requests`:** `status` gains `declined`, with the reason in `note`.
- **`notifications`:** `NOTIFICATION_TYPES` gains `support`.

## Background jobs

Both run on the notifications queue in `apps/worker`, like the Concierge jobs.

- **`support-auto-solve`, hourly:** cases that have waited on the user for 7 or more days become `solved`, with a system note and the solved email.
- **`concierge-weekly-check`, Mondays at 06:00 UTC:** as described under Concierge escalations.

## Access rules and audit

- **Staff:** pages and actions need `support` or `admin`. Support agents' account actions apply only to `user` accounts, and never to their own.
- **Users:** they see their own cases. A private link shows one case's public thread.
- **Specialists:** they see only the status of escalations for clients actively assigned to them.
- **Data export:** a user's export includes their cases and public messages, but not internal notes.
- **Audit entries:**
  - **Cases:** `care.case.take`, `care.case.assign`, `care.case.reply`, `care.case.note`, `care.case.solve`, `care.case.reopen`.
  - **Accounts:** `care.user.view`, `care.user.plan`, `care.user.ban`, `care.user.unban`, `care.user.verification`, `care.user.password_reset`, `care.user.export_link`, `care.user.delete`.
  - **Reports:** `care.report.keep`, `care.report.hide`, `care.report.unhide`.
  - **Company requests:** `care.company_request.add`, `care.company_request.decline`.
  - **Specialists:** `specialist.case.escalate`.
  - **Users:** `support.case.create`, and `account.export` when an export link is used.

## Error handling

- **Stale changes:** for example, two agents taking the same case, or a reply to a case that has just been solved. Updates are conditional, and the loser sees "This changed — refresh".
- **Broken rules:** for example, deleting without a verified data request, acting on a staff account, or using an expired private link. The person sees a specific message. Where the page already knows, the button is disabled and says why.
- **Rate limits** (new policies):
  - the signed-out form: 5 per hour per IP;
  - signed-in requests: 20 per day per user;
  - replies: 60 per hour per person, whether user or agent.
- **Email failures:** logged. The message and the notification stand.

## Testing

- **Unit tests:**
  - case moves (`canMoveCase`);
  - the due and overdue calculation;
  - private-link and export-link checks: hashing, expiry, and single use;
  - ghost scoring that skips kept and `wrong_details` reports;
  - the weekly check's decision: open a case, add a note, or skip.
- **Postgres integration tests** (in CI):
  - cases created signed in and signed out, with account linking;
  - two agents taking the same case;
  - reply, then waiting, then the user's reply reopening the case;
  - auto-solve, and the 14-day reopen window;
  - private-link expiry and verification;
  - the weekly check run twice;
  - keep, hide and unhide, and their effect on the ghost score and search;
  - company requests added and declined, with the requesters notified;
  - the deletion rule;
  - export links that work once and expire;
  - the staff-account limit.
- **End-to-end test:**
  - a user submits Contact support;
  - an agent takes the case and replies;
  - the user sees the reply and answers;
  - the agent solves the case;
  - the agent also changes a user's plan from the account page.

## Rollout

1. The user runs `pnpm db:migrate` for migration 0012. It only adds things.
2. An admin gives agents the `support` role in Admin → Users.
3. The "Contact support" sentence in Settings becomes a link to `/support`.
