# Concierge staff board: design

- **Date:** 2026-09-30
- **Status:** approved in conversation, awaiting review of this document.
- **Project:** 1 of 2 (project 2 is the customer care board; see the last section).

## Goal

GetTargetRole doesn't submit applications by software. Instead, your own team applies for Concierge clients. Specialists find jobs, the client approves each one, and the specialist prepares the kit and submits it on the employer's site. The client, the specialist and admins all track the same record.

Success looks like this:

- a specialist moves many clients from "new matching jobs" to "submitted and tracked" quickly;
- clients see and approve what's done in their name;
- admins see each specialist's workload and whether each client's weekly target is being met.

## Decisions

These were agreed while brainstorming:

1. **Users:** your own team, serving paying Concierge clients. There are no outside agencies and no separate workspaces.
2. **Approval:** the client approves each job before anything is submitted. A job the client saves themselves counts as approved.
3. **Accounts on employer sites:** each client creates a new Gmail used only for job applications. They grant access to their specialist's work Google account through Gmail delegation, so no password is shared. Staff create employer-site accounts with that address and handle the codes and employer emails themselves.
4. **Employer-site passwords** that staff create are kept in the team's password manager (1Password or Bitwarden, one shared vault per client), never in the app.
5. **Workload:** each client has one assigned specialist, as today. Admins assign clients and oversee the team.
6. **Targets:** each client has a weekly application target. There's a default for the Concierge plan, which admins can override per client.
7. **Approach:** the staff workflow lives on the existing `applications` record ("Approach A"). There is no separate work-item table.

## What exists today

The feature builds on these:

- **Roles and assignments:**
  - Roles are `user`, `specialist` and `admin` (`packages/db/src/schema/auth.ts`).
  - `specialist_assignments` links specialists to clients, and admins assign them on the Admin → Concierge tab.
- **Specialist pages:**
  - `/specialist` lists a specialist's assigned clients.
  - `/specialist/[clientId]` shows preferences and the main resume, and lets the specialist log applications and change statuses.
  - The actions (`apps/web/src/app/(app)/specialist/actions.ts`) check the assignment (`isAssignedSpecialist`) and write to the audit log (`recordAudit`).
- **Applications:**
  - `applications` holds `status`, `resumeId`, `coverLetter`, `answers`, `receipt`, `appliedAt` and `createdByUserId`.
  - `application_events` is the timeline.
  - `markSubmitted` saves the receipt of exactly what was sent.
- **AI allowances:** the apply kit's features check the plan's monthly allowance through `aiFor(user, unit)` (`apps/web/src/server/ai.ts`).
- **Notifications and email:** the `notifications` table for in-app messages, `sendEmail` (`packages/core/src/mailer.ts`), and BullMQ schedulers in `apps/worker`.

## Out of scope

- Any automated submission (bots, form fillers that press Submit), getting past CAPTCHAs, and storing passwords.
- Open-ended chat between client and specialist. Clients reach the specialist only through approvals and questions; everything else goes to customer care's help requests (project 2).
- Outside agencies, billing changes and the customer care board (project 2).

## Workflow

### Steps

These statuses are added to `APPLICATION_STATUSES`:

| Status              | Meaning                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `proposed`          | The specialist shortlisted the job, and it's waiting for the client's decision. |
| `approved`          | The client approved it; the specialist prepares the kit and submits.            |
| `waiting_on_client` | The specialist asked the client a question they must answer before submitting.  |
| `skipped`           | The client declined, or the proposal expired.                                   |

After submission the existing statuses are unchanged: `applied`, `screening`, `interviewing`, `offer`, `rejected` and `withdrawn`.

### Who can make each change

| From                              | To                    | Who                                  | Notes                                                                                                            |
| --------------------------------- | --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| _(new)_                           | `proposed`            | Specialist or admin                  | Can carry an optional note to the client, up to 200 characters.                                                  |
| _(new)_                           | `approved`            | The client, by saving a job          | Only for Concierge clients with an active assignment.                                                            |
| `proposed`                        | `approved`            | The client                           | Sets `decided_at`.                                                                                               |
| `proposed`                        | `skipped`             | The client                           | A reason is required: `company`, `location`, `pay`, `not_a_fit` or `other`.                                      |
| `proposed`                        | `skipped`             | The system                           | After 7 days unanswered, with reason `expired`.                                                                  |
| `approved`                        | `waiting_on_client`   | Specialist                           | Creates an "answer a question" task.                                                                             |
| `waiting_on_client`               | `approved`            | The system                           | When the client answers the task.                                                                                |
| `approved`                        | `applied`             | Specialist, through "Mark submitted" | Only once the client's consent is recorded. Saves the receipt and sets `submitted_by_user_id` to the specialist. |
| `approved` or `waiting_on_client` | `applied`             | The client, through "I've applied"   | Sets `submitted_by_user_id` to the client.                                                                       |
| `applied` onward                  | the existing statuses | Specialist or client                 | Unchanged.                                                                                                       |
| any step before `applied`         | `withdrawn`           | Specialist or client                 |                                                                                                                  |

The rules live in one pure function, `canTransition(from, to, actor)`, in `packages/db`. Every action calls it.

Each update is conditional: `update … where id = ? and status = <expected>`. If nothing changes, the action raises a `ConflictError`, which shows the user "This changed — refresh".

When a proposed or approved application's job posting closes (`jobs.closed_at`), its card shows "Posting closed". The specialist can withdraw it.

## Data model

Migration `0011`.

### `applications`: new columns

| Column                 | Type                                                                     | Purpose                                           |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| `proposed_by_user_id`  | text, references users (on delete set null)                              | The specialist who proposed the job.              |
| `proposed_at`          | timestamptz                                                              |                                                   |
| `proposal_note`        | text, default `''`                                                       | The note shown to the client.                     |
| `decided_at`           | timestamptz                                                              | When the client approved or skipped.              |
| `skip_reason`          | text enum: `company`, `location`, `pay`, `not_a_fit`, `other`, `expired` |                                                   |
| `submitted_by_user_id` | text, references users (on delete set null)                              | Who pressed Submit: the specialist or the client. |

New `APPLICATION_EVENT_TYPES`:

- `proposed`, `approved`, `skipped`, `question_asked`, `question_answered`;
- `staff_note`, which is never returned to the client.

### `client_tasks`: new table

| Column                       | Type                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `id`                         | uuid, primary key                                           |
| `client_id`                  | text, references users (on delete cascade)                  |
| `specialist_id`              | text, references users (on delete set null)                 |
| `application_id`             | uuid, references applications (on delete cascade), nullable |
| `kind`                       | text enum: `setup_inbox`, `answer_question`                 |
| `question`                   | text, default `''`                                          |
| `answer`                     | text, default `''`                                          |
| `save_to_bank`               | boolean, default false                                      |
| `status`                     | text enum: `open`, `done`, `cancelled`                      |
| `created_at`, `completed_at` | timestamptz                                                 |

Index: `(client_id, status)`.

### `profiles`: new columns

| Column                      | Type                                                    | Purpose                                      |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `job_search_email`          | text, default `''`                                      | The dedicated Gmail.                         |
| `inbox_access_confirmed_at` | timestamptz                                             | Set by the specialist once delegation works. |
| `apply_consent_at`          | timestamptz                                             | Set when the client ticks the consent below. |
| `weekly_target_override`    | integer, nullable                                       | Null uses the plan default.                  |
| `concierge_paused_at`       | timestamptz, nullable                                   | Set while the client has paused.             |
| `answer_bank`               | jsonb `[{ question, answer, updatedAt }]`, default `[]` | The client's standard answers.               |

The consent wording: "I authorize my specialist to create accounts and apply for jobs on my behalf with this email."

### Plan configuration

`packages/db/src/plans.ts` gains `CONCIERGE_WEEKLY_TARGET = 15`.

## Specialist board

### `/specialist`: My board

This replaces today's client list: one board across all of the specialist's active clients.

- **Columns:**
  - Proposed
  - Approved (to submit)
  - Waiting on client
  - Applied this week
  - In progress (screening, interviewing)
  - Closed (offer, rejected, withdrawn or skipped in the last 30 days)
- **Card:**
  - job title and company, and the client's name;
  - days in the column;
  - kit readiness: tailored resume, cover letter and answers each present or not;
  - a "Needs an employer account" badge when the job's source is Workday, Oracle, Eightfold, Amazon or USAJOBS, or the application was added from an outside link;
  - a "Posting closed" flag.
- **Top strip:**
  - each client's week, for example "9 of 15", marked red when behind pace;
  - answers that clients sent since the specialist last looked;
  - clients whose setup isn't finished.
- **Filters:** by client and by column.

**Applied this week** counts the client's applications whose `applied_at` falls in the current week, whoever pressed Submit. Weeks start Monday 00:00 UTC.

**Behind pace** means `applied_this_week < target × (days elapsed this week ÷ 7)`, rounded down. Paused clients are never behind pace.

### `/specialist/[clientId]`: client workspace

Today's page grows into tabs:

- **Find jobs:** the job search (`searchJobs`), ranked by the _client's_ resume and preferences. Tick jobs and click "Propose to client", with an optional note. An outside job can be added by pasting its link and description (the existing `createExternalApplication`, created as `proposed`).
- **Pipeline:** the board's columns, for this client only.
- **Apply:** for one application, the existing apply kit (tailor resume, cover letter, answers), used on the client's behalf. It also shows:
  - the employer link and the job-search email to use;
  - the answer bank, with copy buttons;
  - **Mark submitted**, which moves it to `applied` through `markSubmitted`;
  - **Ask client**, which moves it to `waiting_on_client` and creates the task.
- **Profile:**
  - preferences and work authorization (read-only);
  - setup status and the confirm-access button;
  - the answer bank, which the specialist can also edit;
  - the weekly target.
- **Timeline:** events including staff notes, the client's tasks, and who made each change.

### Acting for the client

`aiForClient(specialist, clientId, unit)` works like `aiFor`:

- it checks the **client's** plan allowance and AI budget, and records usage and usage events against the client;
- it first confirms the specialist has an active assignment to that client (admins always pass);
- an audit entry records the specialist as the actor.

New actions go in `apps/web/src/app/(app)/specialist/actions.ts`, each asserting the assignment and writing an audit entry:

- `proposeJobs`
- `addExternalProposal`
- `markSubmittedForClient`
- `askClient`
- `addStaffNote`
- `confirmInboxAccess`
- `updateAnswerBank`

Board queries go in `apps/web/src/server/data/concierge.ts`.

## What the client sees

- **Setup card** (dashboard, while setup is unfinished). Three steps:
  1. create a new Gmail for job applications;
  2. grant access to the specialist, with the specialist's work email and a short illustrated guide;
  3. enter the address and tick the consent.

  The card turns green once the specialist confirms access. It's created as a `setup_inbox` task when the client is first assigned, and again whenever they're reassigned.

- **From your specialist** (top of Applications, plus a dashboard card):
  - Proposals show title, company, location, pay, match score and the specialist's note, with **Approve** and **Skip** (the reason is required). Several can be approved at once.
  - Open "answer a question" tasks appear here too. Answering has a "save for future applications" box, which adds the answer to `answer_bank`.
- **Notifications:**
  - an in-app notification for each proposal batch and each question;
  - a daily email digest when there are new proposals;
  - an immediate email for a question, since it holds up an application.
- **Tracker:**
  - For Concierge clients, `approved` and `waiting_on_client` appear as columns labelled "With your specialist" and "Waiting on you".
  - `proposed` and `skipped` don't appear on the board; proposals are in the section above.
  - Staff submissions show "Submitted by <specialist name>" and the receipt.
  - `staff_note` events never appear.
- **Weekly card:** "Priya applied to 9 of your 15 this week."
- **Pause:** a switch in Settings that sets `concierge_paused_at`. While paused, specialists can't propose and the target is suspended. Turning it off resumes both.

`STATUS_META` and `BOARD_COLUMNS` (`apps/web/src/lib/statuses.ts`) gain the new statuses. Users not on Concierge never see them.

## Admin team view

The Admin → Concierge tab grows from today's assignment list.

**Per specialist:**

- active clients;
- this week's applications against the combined targets of their clients;
- clients behind pace;
- proposals waiting (count, and the oldest's age);
- open questions;
- approval rate: approved ÷ decided proposals, last 30 days;
- interview rate: applications that reached `screening` or later ÷ applied, last 30 days.

**Per client:** specialist, setup status, paused or active, the week's progress, last activity.

**Actions:**

- assign or reassign a specialist (reassigning creates a new setup task for the delegation);
- set a client's target override;
- open any client's workspace. Today `/specialist/[clientId]` returns 404 unless the viewer is assigned to the client; the check changes to let admins through.

## Background jobs

The existing worker's notifications queue gets two schedulers:

- **`expire-proposals`**, daily: `proposed` applications older than 7 days become `skipped` with reason `expired`, and an event is recorded.
- **`concierge-digest`**, daily at 14:00 UTC: one email per client with proposals created since yesterday's digest. Notification `dedupe_key` values of `digest:<date>` keep it to one per client per day.

Question emails go out from the `askClient` action itself, not from a scheduler.

## Access rules and audit

- Specialists can only read or change clients they're actively assigned to (`isAssignedSpecialist`). Admins can reach everyone.
- Clients can only read and change their own applications and tasks, and can only approve or skip `proposed` ones.
- Staff can't "Mark submitted" until `apply_consent_at` is set. The server returns a clear error, and the button explains why it's off.
- Every staff action writes an audit entry:
  - `specialist.proposal.create`
  - `specialist.application.submitted`
  - `specialist.question.ask`
  - `specialist.note.add`
  - `specialist.inbox.confirm`
  - `specialist.answers.update`
  - `admin.concierge.target`
  - `admin.concierge.assign`

  Client decisions are recorded as application events.

- `staff_note` events and the proposing specialist's internal data are excluded from every client-facing query and export, except the specialist's name on submissions.

## Error handling

- **A step that no longer matches** (a race): `ConflictError` with "This changed — refresh".
- **Allowance used up:** the existing `QuotaExceededError` message, with the client's plan named.
- **Missing consent or setup:** the specific message, and the action is disabled in the interface.
- **A proposal for a job the client already has an application for:** it's refused and the existing application is shown.
- **Email failure:** the digest or question email is retried by the queue; the in-app notification is always written first.

## Testing

**Unit (`packages/db`):**

- every allowed and refused `canTransition` pair;
- weekly counting and behind-pace across week boundaries (Mondays, UTC);
- answer-bank merging when a question is saved twice.

**Integration (Postgres; PGlite locally):**

- propose → approve → submit, with the receipt and `submitted_by_user_id`;
- skip with a reason;
- a question round trip returning to `approved`;
- expiry after 7 days;
- the consent block;
- an unassigned specialist refused;
- a client unable to act on another client's proposals;
- a conflict when the step changed;
- a client's saved job arriving as `approved`.

**End-to-end (Playwright):**

1. A specialist proposes two jobs.
2. The client approves one and skips one.
3. The specialist marks the approved one submitted.
4. The client sees "Submitted by …" and "1 of 15".
5. The admin team view shows the same numbers.

## Rollout

- Migration `0011`. Existing applications logged by specialists keep their statuses and are unaffected.
- The new flow applies to users on the Concierge plan with an active assignment.
- **Navigation:** a "Staff" menu for staff roles, with Concierge board (specialists and admins) and Admin (admins). Customer care joins it in project 2.

## Project 2: customer care board (separate spec)

This is agreed in scope but not designed yet. It will reuse the Staff menu, the audit log and the notes pattern, and add a `support` role. It covers:

- **Help requests:**
  - a "Contact support" form in the app;
  - agents reply by email from the board;
  - statuses: open, waiting on user, solved.
- **Account help:**
  - look up a user's plan, usage and recent activity;
  - change plan, unlock or ban, resend verification;
  - handle data export and deletion requests.
- **Report and request queues:**
  - job reports (ghost jobs);
  - company requests discovery couldn't resolve;
  - jobs flagged as wrong.
- **Concierge escalations:** client complaints and missed weekly targets, handed from this board to care.
