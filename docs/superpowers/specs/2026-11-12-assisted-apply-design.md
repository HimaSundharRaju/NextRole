# Assisted apply: design

- **Date:** 2026-11-12
- **Status:** draft for the owner's review. Not approved; nothing is built.
- **Plans:** Pro and Concierge.
- **Written against:** `main` plus the customer care board branch (`feat/customer-care-board`: hidden jobs, migration 0012). Build after that branch merges.

## Summary

Pro and Concierge get an **Apply queue** and a **browser extension**. The app prepares applications as auto-prepare does today. Each day the person approves which ones to send; the app opens each employer form with everything filled in; the person reads it and presses the employer's own Submit button. Nothing in the product ever submits an application. "System" below means an employer's applicant-tracking system, such as Greenhouse, Lever, Ashby or Workday.

- **Why a person presses Submit:** Greenhouse, Lever and Ashby accept applications by API only with the employer's own key. A bot would have to drive the employer's page, which these systems screen for. See "Why no bot submits".
- **Limits:** Pro may fill up to 20 applications a day and Concierge 25 per client. There are no new AI allowances: filling costs no AI, and AI drafts of free-text answers use the existing `answers` allowance.
- **Safety:** answers to legal and factual questions come only from answers the person confirmed once, per country, and are never guessed. Consents are never ticked. A tailored resume can't add employers, titles, dates, schools, degrees, certifications, skills or numbers without the person's OK. Every submission leaves a receipt: what the app supplied and, with the extension, the form's fields as sent and where each came from.
- **Build first:** the in-app queue with standard answers, the facts check and the apply sheet (S1). Then Greenhouse form questions and answers (S2), then the extension (S3 and S4), then Concierge (S5).

## Goal

Let a Pro or Concierge user send many good applications with far less effort, without lowering quality, risking their accounts or misrepresenting themselves.

Success looks like this:

- **Time:** about 1 minute of the person's time per application on Greenhouse, Lever and Ashby with the extension, and about 4 minutes through the apply sheet anywhere else. Today's manual kit takes roughly 10 to 15 minutes. These are estimates: the app records when a form is opened and when it is submitted, so the real medians are known from the first week.
- **Truth:** every field in a receipt names its source, and no fact on an application is one the person didn't confirm.
- **Results:** applications sent this way reach "screening" or later at least as often as manual ones, measured after four weeks.
- **Standing:** no account bans or employer complaints traced to the tool.

## Decisions

Settled with the owner while brainstorming:

1. A person always presses Submit. No bot, worker or extension submits.
2. Both layers: an in-app queue and a browser extension, built in that order.
3. Pro may fill up to **20 applications a day**; Concierge keeps 25.
4. Answers on work authorization, sponsorship and the like come only from the person's profile and are exactly true.
5. Existing allowances and AI budget caps stay as they are. Every AI call goes through `aiFor(user, unit)`.

My calls, for the owner to confirm in review:

6. The person sets a daily cap, default 5, up to the plan's ceiling. The window is the last 24 hours, as for auto-prepare.
7. **Quick fill:** a job with no prepared kit can still be queued and filled with the main resume and no cover letter, if its match is at least the person's auto-prepare minimum (default 80, never below the app's 70). Below that, a kit has to be prepared first. If a form requires a cover letter, the sheet offers the existing letter writer (the `letter` allowance).
8. The extension runs on Chrome and Edge, and only on Greenhouse, Lever and Ashby forms. Every other system uses the apply sheet.
9. Form fields are matched by fixed rules. AI only drafts free-text answers; nothing asks an AI what a legal question means.
10. A remote switch can turn the extension off for a system, an employer or a version without a store release.
11. The answer bank (today Concierge's `profiles.answer_bank`) opens to Pro.
12. A list of companies to skip lives in settings; the queue never offers them.
13. The email on a form is the resume's email; for a Concierge client it is their job-search email when set.
14. Street address, postal code, date of birth, government or tax IDs and bank details are never stored or filled.
15. A form is matched to its application by the posting's identity, never by title.
16. On a plan without assisted apply, the queue, sheet and extension refuse to open applications.
17. Product copy says the app fills the form and the person presses Submit. It never says "auto-apply" or "submits for you".
18. Before the extension reaches anyone beyond the owner, the three systems' candidate terms and the store's policies get a legal review. This design has not had one.

## Why no bot submits

- **Greenhouse:** every read endpoint of the Job Board API is public. The application POST needs HTTP Basic Auth with the employer's own API key ([docs](https://docs.greenhouse.io/job-board.html)). Some candidates are asked for an emailed code, depending on the board's spam sensitivity and their score ([help article](https://support.greenhouse.io/hc/en-us/articles/115005448066)), and Greenhouse sells applicant fraud screening to employers (Real Talent).
- **Lever:** `POST /v0/postings/SITE/ID?key=APIKEY`, with a key a Super Admin of the employer's account generates. Its own docs tell employers to add captchas and IP-based rate limits to custom forms ([postings API](https://github.com/lever/postings-api)).
- **Ashby:** `applicationForm.submit` needs an employer API key with the `candidatesWrite` permission ([reference](https://developers.ashbyhq.com/reference/applicationformsubmit)).
- **So** a third party can only submit by driving the employer's page with a script, from a data-centre address, past captchas and codes. That is what these systems screen for, and an application flagged as risky can be sent to a code step or rejected by the employer. It can cost the candidate the job, not just risk a ban.
- **LinkedIn** does not allow third-party software, "bots, browser plug-ins, or browser extensions" that automate activity on its site; accounts may be restricted or shut down ([help](https://www.linkedin.com/help/linkedin/answer/a1341387)). The extension never runs there.

A person who reads the form and clicks Submit also keeps the application truthful: the click is their attestation.

## Approaches considered

**A. In-app queue (copy and open).** Each approved application opens as an apply sheet: the employer's form in a tab, and in the app the resume file, letter, answers and every standard field with a Copy button. The person pastes and submits. About 4 minutes. Works for every employer system, including Workday, which needs a per-employer account. No new product to maintain. Still manual typing.

**B. Browser extension that fills the form.** Reads the form in the person's own browser, fills it from the same data, flags what it can't fill, and leaves Submit to the person. About 1 minute. It is a second product to ship, get through store review and keep working as employers change their forms.

**C. Server-side submission** (an API, or a hosted or headless browser, with or without a review first). Rejected: the APIs need employer keys; a driven page is screened, and many employers' terms prohibit it; the person wouldn't have clicked; and it would need captcha and code handling we must never build.

**Chosen: A and B together.** A is the foundation, the fallback for every system the extension doesn't cover, and the data the extension reads. Coverage in the local job data: Greenhouse 76%, Ashby 19%, Lever 5% of open jobs (older data; the Workday boards were never synced there). 63% of Greenhouse postings link to the employer's own domain, so the extension must handle Greenhouse forms embedded in other sites. Competitive research (2026-11-12) found that a rival agent that submits by bot shows a resume diff and a field-by-field receipt; the preview and the receipts here are the parity answer, with a person pressing Submit.

## What exists today

- **Auto-prepare** (`apps/worker/src/prepare.ts`) builds a tailored resume and cover letter for strong new matches and marks the application `ready`. The user sets a minimum score (default 80) and a daily limit (default 3, capped by `AUTO_PREPARE_DAILY_MAX`: Pro 3, Concierge 25). The window is the last 24 hours. The manual kit moves an application from `saved` to `preparing` and never to `ready`.
- **Plans** (`packages/db/src/plans.ts`): monthly allowances per unit (Pro: `auto` 90, `tailor` 100, `letter` 100, `answers` 100; Concierge: 750, 600, 600, 600), unit costs (`auto` about 1.5 cents, `answers` 1.1 cents) and monthly AI caps (Pro $15, Concierge $95). `MIN_AI_MATCH` is 70.
- **`aiFor(user, unit)`** (`apps/web/src/server/ai.ts`) checks the plan's allowance and the monthly cap, and `charge` counts the unit once the result is saved.
- **Kit answers:** the person pastes the form's questions and `answerApplicationQuestions` drafts answers (up to 15 per call, 30 kept). `ANSWERS_SYSTEM` makes legal and factual answers come only from the profile, else `[Please fill in: …]`.
- **Receipts:** `submitApplication` (`packages/db/src/concierge/applying.ts`) stores a `SubmissionReceipt` (resume snapshot, letter, answers) and sets `submitted_by_user_id`. The receipt is what the app held, not what the form received.
- **Concierge:** statuses `proposed`, `approved`, `waiting_on_client`, `skipped`; `canTransition` (`packages/db/src/concierge/rules.ts`); the client's standing consent (`profiles.apply_consent_at`); the answer bank; `askClient`; `assertCanActForClient`. Today `canTransition` does not allow `ready` to `approved`.
- **Jobs:** `apply_url`, `source`, `external_id`, the company's `board_token`, `visa_sponsorship`, `citizenship_required`, `ghost_score`, `closed_at`, `expires_at`, and (customer care branch) `hidden_at`.
- **Greenhouse** publishes a job's form: `GET …/jobs/{id}?questions=true` returns `questions`, `location_questions`, `compliance` and `demographic_questions`. Lever's public posting data does not include custom questions. Ashby's public data has not been checked.
- **Rate limits** (`packages/core/src/rate-limit.ts`) and the public-only fetch guard for connectors (`packages/jobs/src/connectors/public-only.ts`).
- **Stated scope:** the README says "Nothing is auto-submitted on your behalf" and lists a form-filling extension "for you to submit" on its roadmap. The Concierge spec puts bots and "form fillers that press Submit", captchas and stored passwords out of scope. This design keeps all of that true: the extension fills and never presses Submit.

## The experience

### Set up once

Settings gets an **Apply queue** section:

- **Standard answers** (below): confirmed once, editable any time. Work authorization and sponsorship for at least one country are needed before the first approval.
- **Daily cap:** default 5, up to the plan's ceiling.
- **Companies to skip.**

Concierge: the specialist and client set this up together on the client's workspace; the client confirms.

### Each day: the queue

Applications tab → **Queue**. It lists the `ready` applications that auto-prepare made, and anything the person adds with **Add to queue**: a kit they prepared by hand, or a job with no kit, which becomes a quick fill. Adding moves the application to `ready`. Each card:

```
Staff Data Engineer · Acme · Remote (US)                      91% match
Why: Python, SQL, Spark match · title fits · pay above your floor
Tailored resume · cover letter · 2 answers drafted                   [Preview]
Fills with: the extension (Greenhouse)
! The AI added "Terraform" to your skills.  I have this · Remove it
! The post says it does not sponsor visas; your profile says you need sponsorship.
                                                      [Skip ▾]  [Approve]
```

- **Preview** shows the tailored resume against the main one with the changed lines marked, and the cover letter.
- **Fills with** says how the application will be filled and, when it can't be the extension, why: "the sheet: Workday needs your sign-in", "the sheet: this employer's own form isn't recognised".
- **Approve / Skip:** one tap each. Skip asks for one of the existing reasons. **Approve all** approves every card that has no open warning. The cap limits how many forms are opened each day; approved cards left over wait for the next day's slots.
- **Not offered:** jobs that are closed, expired, hidden, on the skip list, or with a ghost score of 60 or more.
- **Warnings that need a tap** (never silent): a new skill or number from the facts check ("Remove it" takes the skill out of this application's tailored resume only); "no sponsorship" while the profile needs it; citizenship required while the profile says otherwise; a match below 70; pay below the floor; a second application to the same employer in 30 days.
- **Counter:** "Opened in the last 24 hours: 3 of 5 (ceiling 20)." The dashboard's "Ready to apply" links here.

Approving moves the application `ready` → `approved`. Skipping moves it to `skipped`. Both reuse the Concierge steps (`canTransition` gains `ready` → `approved` or `skipped` for the owner of the application).

### Filling, layer 1: the apply sheet

**Open next** (or the application's **Apply** button) opens `/applications/[id]/apply`:

- The employer's form opens in a new tab.
- Beside it: the resume as a PDF, the cover letter, each standard field and each answer in the form's order (Greenhouse, from its published questions) or a standard order, each with **Copy**.
- Anything not on file is marked "yours to fill".
- Applications made from a pasted job description can use the sheet too; the extension only fills the allowed systems.
- **I submitted** records the receipt and opens the next application.

Opening an application counts against the day's cap once; reopening is free.

### Filling, layer 2: the extension

On a supported form the extension fills what it can and shows a side panel:

```
Greenhouse · Staff Data Engineer · Acme                    Filled 14 of 17
  ✓ Name, email, phone, links         your profile
  ✓ Authorized to work in the US: Yes your standard answers
  ✓ Resume: Acme-Staff-Data-Eng.pdf   AI changed 4 bullets
  ✎ Why Acme?                         AI draft · tick when read
  ! Salary expectation                not on file · yours to fill
You press Submit on the form. The extension never does.
```

- **When it fills:** only in a tab opened from the queue's Open next, or when the person clicks Fill on a supported form that matches an approved application. A form is matched to its application by the posting's identity (system, board and job id from the page's address), never by title.
- **Unknown or ambiguous fields** are left alone and flagged. A person's own edits are never overwritten.
- **After the person presses Submit,** the panel looks for the system's confirmation. If it sees none within about 10 seconds it asks "Did it go through?". Only the page's confirmation or the person's answer records the application as applied.
- It then saves the receipt and offers the next application.

### Receipts

The receipt keeps the resume, letter and answers it stores today, each answer now with its source (`profile`, `standard`, `bank`, `ai_draft`), plus when the form was opened and submitted, whether the page or the person confirmed it, and whether it went through the sheet or the extension. From the sheet it records what the app supplied, not what the person typed. From the extension it also records the form as it was when the person pressed Submit: each field's label, value and source (adding `person` for edits), whether an AI draft was left unchanged or edited, and the form's URL and system. Receipts are removed with the account and included in the data export.

### Concierge

- The specialist opens an `approved` application from the client's workspace, in the sheet or with the extension. The same fill ceiling applies per client.
- Required: the client's `apply_consent_at`, the application `approved`, the search not paused. Otherwise the open is refused.
- The email on the form is the client's job-search email (`profiles.job_search_email`) when set, because replies are read through it; otherwise the resume's email.
- A field with nothing on file can be sent to the client with the existing **Ask client**; the application waits as `waiting_on_client`.
- The client gets **Approve all** on proposals.
- **Hand to my specialist:** a client filling their own queue can hand any application to their specialist with one tap, giving a reason (a sign-in wall, a form that isn't recognised, a question they'd rather not answer). It stays `approved` and shows on the specialist's board marked with the reason. Pro has no specialist, so it is not offered there.
- Receipts record the specialist as the submitter; opening and submitting are audited (`specialist.application.filled`, `specialist.application.submitted`).

## Standard answers

A typed set on the profile. Each entry has the value and the date the person confirmed it. The existing `work_authorization` and `needs_sponsorship` seed the first suggestion but are not trusted until the person confirms.

| Answer                                                                                                                                      | Source                                                                                                                     | How it is filled                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, email, phone, city and region, links                                                                                                  | The resume attached to the application and the profile; for Concierge clients the email is their job-search email when set | When the label matches                                                                                                                                                                                                      |
| Work authorization, per country                                                                                                             | Standard answers                                                                                                           | Yes/No fields and exact-match options only. The country comes from the label, or from the job's country when the form says "this country" and the job lists exactly one. No answer for that country: left blank and flagged |
| Sponsorship now or later, per country                                                                                                       | Standard answers                                                                                                           | The same rules                                                                                                                                                                                                              |
| Relocation, notice period, earliest start                                                                                                   | Standard answers                                                                                                           | Text, or an exact-match option                                                                                                                                                                                              |
| Salary expectation                                                                                                                          | An amount the person typed (never derived from the pay floor)                                                              | A number field with a matching currency; otherwise flagged                                                                                                                                                                  |
| Gender, race or ethnicity, veteran and disability status                                                                                    | Standard answers; setup preselects "Decline to self-identify" for each, and nothing is filled until the person confirms    | An exact-match option only                                                                                                                                                                                                  |
| How did you hear about us                                                                                                                   | The job came from the GetTargetRole board                                                                                  | "Job board", or "Other: GetTargetRole", when the option exists                                                                                                                                                              |
| Free-text questions                                                                                                                         | Answer bank on an exact or near-exact match, else an AI draft                                                              | Marked as a draft until read                                                                                                                                                                                                |
| Consents and attestations ("I certify", privacy policy, background check, drug test, criminal history, security clearance, age and similar) | Not stored                                                                                                                 | Never filled; the person ticks them                                                                                                                                                                                         |
| Worked here before? Referral? Street address, postal code, date of birth, government or tax ID, bank details                                | Not stored                                                                                                                 | Left for the person                                                                                                                                                                                                         |

## Safety rules

1. **Submit is the person's.** The extension has no code path that clicks a submit control or calls `submit()` or `requestSubmit()`; a lint rule and a test enforce it. The server never contacts an employer to submit.
2. **No evasion.** The extension never solves or skips captchas, emailed codes or identity checks, never adds artificial delays, proxies or spoofing, and acts only in the person's own browser session. Neither the app nor the extension stores employer passwords or sign-in codes.
3. **Facts are exact.** Answers to legal and factual questions come only from confirmed standard answers. A select or radio is filled only when an option matches the answer exactly, never the nearest one. Anything else is left blank and flagged.
4. **Nothing is attested for the person.** Consents and attestations are never ticked or stored.
5. **Facts check on every resume and letter**, run by fixed rules before an application can be approved and again when it is opened: the tailored resume may not add or change a company, title, date, location, school, degree or certification compared with the main resume (leaving one out is shown, not blocked); any skill not in the main resume needs "I have this" or is removed; any number in the resume, letter or an AI draft that is not in the main resume, the profile or the job post is flagged. Confirmations are kept on the application (`confirmed_claims`).
6. **AI drafts are labelled.** They are filled, marked "AI draft · tick when read", and the receipt records whether they were left unchanged or edited. The panel's "ready" state needs every draft ticked.
7. **Allowed sites only.** The manifest's host list is the allowlist: the app's own origin and the Greenhouse, Lever and Ashby hosts (including Greenhouse embeds on employer sites). LinkedIn, Indeed and the like are never in it. Everything else uses the sheet.
8. **Pace and duplicates.** One application per job (existing unique index). One form is opened at a time. The daily cap counts forms opened in the last 24 hours. A second application to one employer in 30 days needs a tap.
9. **Remote switch.** Config is data, never code, and can disable a system, an employer or a version. A disabled system falls back to the sheet.
10. **Concierge consent holds.** Staff can't open an application without the client's consent and approval, and the client's pause stops it.

## Plan limits and cost

|                                                               | Free | Plus | Pro                 | Concierge             |
| ------------------------------------------------------------- | ---- | ---- | ------------------- | --------------------- |
| Assisted apply                                                | no   | no   | yes                 | yes                   |
| Fill ceiling, last 24 hours (`ASSISTED_APPLY_DAILY_MAX`, new) | 0    | 0    | 20                  | 25 per client         |
| Person's own cap                                              |      |      | default 5           | default 5             |
| Kits prepared by auto-prepare (unchanged)                     | 0    | 0    | 3 a day, 90 a month | 25 a day, 750 a month |
| Kits prepared by hand (unchanged, `tailor` and `letter`)      | 0    | 40   | 100                 | 600                   |
| AI drafts of free-text answers (unchanged, `answers`)         | 0    | 40   | 100                 | 600                   |

Auto-prepare's daily limit still controls how many kits are prepared; the fill ceiling controls how many forms are opened. At 20 a day, most of a Pro user's fills would be quick fills: about 3 kits a day come from auto-prepare and about 3 from the manual allowances. The match gate on quick fill is the quality control, and the ceiling is one constant to lower.

On a plan without assisted apply the settings stay, but the queue, sheet and extension refuse to open applications, as auto-prepare does today.

The Concierge plan card says "25+ tailored applications a day", while a specialist's default target is 15 applications a week (`CONCIERGE_WEEKLY_TARGET`). This design changes neither; the gap is worth settling separately.

| Piece                                                                  | AI  | Cost                                           |
| ---------------------------------------------------------------------- | --- | ---------------------------------------------- |
| A kit from auto-prepare (tailor and letter, batch)                     | yes | about 1.5 cents, existing `auto` unit          |
| AI drafts for free-text questions                                      | yes | about 1.1 cents a set, existing `answers` unit |
| Quick fill, field matching, facts check, answer-bank matches, receipts | no  | none                                           |
| Extension requests                                                     | no  | small server work                              |
| Chrome Web Store                                                       |     | a one-time developer registration fee          |

- **Worst case** for one assisted application is about 2.6 cents (kit plus answers).
- **The monthly AI cap is untouched.** Pro's full-use cost stays $11.10 against its $15 cap, and Concierge's $63.87 against $95. What changes is how much of the `answers` allowance gets used.
- **When `answers` runs out,** the extension still fills everything that needs no AI, flags the free-text questions and shows the existing allowance message. When the monthly cap is reached, `aiFor` refuses as it does today.
- **Raising Pro's `answers` allowance is not recommended for v1.** At 300 a month it adds $2.20 to full use ($13.30), and the $15 cap would need to rise to about $18 to keep its 1.35× margin.

## Data model

New columns on `profiles`:

- `standard_answers` (jsonb, default `{}`): the typed set above, with per-entry confirmation dates.
- `apply_daily_cap` (integer, default 5).
- `apply_skip_companies` (text array, default empty).

New columns on `applications`:

- `fill_opened_at`: when it was first opened for filling; the cap counts these.
- `confirmed_claims` (text array): the skills and numbers the person confirmed.

New tables:

- `extension_tokens`: id, user, token hash, label, created, last used, expires, revoked. Scoped to apply reads and writes. A staff token acts only for clients that `assertCanActForClient` allows, checked on every request.
- `job_forms`: job, system, the published questions (jsonb), fetched at.
- `fill_reports`: system, handler version, fields filled, fields flagged, flagged labels, whether a code was asked for, outcome. It holds no user id or values and is kept for 90 days.

Other changes:

- `SubmissionReceipt` (jsonb): the new optional fields above.
- `application_events`: new types `fill_opened`, `submit_detected` and `handed_off`.
- `canTransition`: `ready` → `approved` or `skipped` for the owner.
- `plans.ts`: `ASSISTED_APPLY_DAILY_MAX`.
- Rate-limit policies for pairing, opening, drafts and receipts.
- Migration numbers follow whatever is last when this is built.

## The extension

- **Where:** a new `apps/extension` in the monorepo, TypeScript, one Manifest V3 build for Chrome and Edge. It talks only to the web app's API.
- **Permissions:** the app's origin and the Greenhouse, Lever and Ashby hosts, with all frames (Greenhouse forms are embedded on employer domains). No broad host access and no remote code.
- **Pairing:** a signed-in `/extension/connect` page hands the extension a short-lived one-time code, which it trades for a token held in extension storage. Tokens are listed and revoked in Settings and expire after 90 days unused. Cookies are not used.
- **Handlers:** one per system (Greenhouse hosted and embed, Lever, Ashby). Each knows its field names, how to set values so the page's framework notices them, how to attach files, and its confirmation signal. Label matching is a fixed dictionary of synonyms per standard answer.
- **Panel:** the browser's side panel, so it works inside embedded forms.
- **Files:** the resume PDF comes from the app's existing renderer with the application's saved settings. A cover letter goes in as text, or as a PDF made from the letter when the form takes only a file.
- **Free text:** the extension sends the form's question labels to the app, which returns bank matches and AI drafts (`aiFor(owner, "answers")`, one `answers` unit per request as the kit does today; the extension sends all of a form's free-text questions in one request).
- **Fill reports:** after each form, per-system counts of fields filled and flagged, with no values or personal data. An alert fires when the flagged share or the code prompts rise.

### Server endpoints (under `/api/extension`, bearer token)

- **Config** (public): minimum version, enabled systems, blocked hosts.
- **Pair:** trade a one-time code for a token.
- **Queue:** the person's approved applications.
- **Open:** checks the plan, status, consent, pause, the job still being open, the facts check and the cap; sets `fill_opened_at` once; returns the packet (standard values, resume link, letter, bank matches, known questions).
- **Drafts:** matches and AI drafts for the labels the extension read.
- **Receipt:** stores the field snapshot and records the application as applied through `submitApplication`, so the same transition and consent rules apply.
- **Reports:** fill reports.

### Privacy

- The extension reads only the application form on an allowed page, and only once armed. It never reads other tabs, history or cookies.
- Question labels reach the server only to match or draft answers. Filled values reach it only in the receipt after the person submits.
- Receipts are deleted with the account and included in the export; the privacy policy is updated before the store listing.

## Error handling

- **Field not found or form changed:** the field is flagged "fill by hand" and the panel links to the sheet. A system whose handler can't recognise the page falls back to the sheet.
- **Token expired or revoked:** the panel asks to reconnect.
- **Cap reached:** "You've opened 20 in the last 24 hours. Next slot at 14:10."
- **Job closed, hidden or expired since approval:** the open is refused and the card says why.
- **Consent missing, paused, or status changed:** refused with the existing Concierge messages ("This changed — refresh").
- **Allowance used or cap reached:** free-text questions are flagged, not guessed.
- **A confirmation signal is never seen:** the person is asked; the application is not marked applied meanwhile.

## Testing

- **Unit:** label to standard-answer matching, including country resolution and the exact-option rule; the facts check (additions, omissions, numbers); the cap window; the new `canTransition` moves; token scopes; receipt sources.
- **Integration (Postgres):** approve, skip and approve-all; the cap with parallel opens (an advisory lock, as in auto-prepare's `takeSlot`); refusals for closed or hidden jobs, missing consent and a paused client; receipts through `submitApplication`; the export includes receipts.
- **Extension:** each handler against saved HTML of real forms (hosted and embedded) in Chromium with the extension loaded. Fixtures cover unknown required fields, a select with no exact option, a custom file widget and a verification-code step. A test fails if extension source can click a submit control or call `submit()` or `requestSubmit()`.
- **AI:** reuse the answer checks in `packages/ai/eval`: a legal question with nothing on file returns `[Please fill in: …]`, and drafts add no numbers.
- **By hand:** the owner's own account and a throwaway account fill real public postings on each system up to the Submit button.

## Build order and rollout

Each step ships on its own.

- **S1, in-app queue, no extension, no new AI.** The plan constant and gating; the settings section (standard answers, cap, skip list); the facts check and confirmations; the `canTransition` change; the Queue tab with preview, approve, skip and approve-all; the apply sheet with Copy buttons; the cap and `fill_opened_at`; receipts for the sheet path; the README (its roadmap line about a form-filling extension moves to features) and the architecture "Applying" section.
- **S2, Greenhouse questions and answers.** `job_forms` from the public API (through the existing public-only fetch guard); the answer bank for Pro; AI drafts after approval, charged to `answers`; the sheet in the form's own order.
- **S3, extension core and Greenhouse.** `apps/extension`, pairing and tokens, the endpoints, the Greenhouse handler (hosted and embed), the side panel, field-level receipts, config and fill reports.
- **S4, Lever and Ashby handlers.**
- **S5, Concierge.** Specialist open and fill, ask-client from the panel, client approve-all, audit.

Rollout: S1 to Pro and Concierge behind an environment switch. Before S3 reaches anyone beyond the owner, the three systems' candidate terms and the store's policies get a legal review; this design has not had one. The extension starts as an unlisted store listing, used first on the owner's own account, then widened. The measures under "Goal" are checked after four weeks, and the ceiling and the quick-fill gate are adjusted from them.

## Out of scope

- Anything that submits for the person: server-side submission, hosted or headless browsers, or any use of employers' application APIs.
- Solving or skipping captchas, emailed codes and identity checks; proxies, spoofed browsers, artificial delays.
- LinkedIn, Indeed and other job sites, including saving jobs from them with the extension (LinkedIn forbids extensions that read its pages); Easy Apply.
- Workday, SmartRecruiters, Oracle and Eightfold forms (the sheet covers them), and forms built on an employer's own custom page.
- Firefox, Safari and mobile.
- AI classification of unknown form labels, auto-approving jobs, ticking consents, creating employer accounts, and sending follow-ups.
- Plus plan access.
- A per-application human hand-off for Pro, and published outcome statistics. The receipts make both possible later.

## Risks

| Risk                                                                    | Answer                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An employer's terms forbid automated tools                              | The person reads and submits, as with a password manager. Three systems only, a remote switch by system and employer, and no evasion.                                  |
| A system changes its form                                               | Saved-form tests, fill reports, a handler version in the config, and a fall back to the sheet.                                                                         |
| Filling triggers a code or screening                                    | The person handles it. Fill reports count code prompts per system and alert on a rise.                                                                                 |
| Store review refuses or delists                                         | Narrow permissions, bundled code only, a privacy policy, an unlisted start. The sheet works without the extension.                                                     |
| An AI draft goes out unread                                             | Labelled drafts, "tick when read", and receipts that record unchanged or edited.                                                                                       |
| Employers cap applications per candidate, or turn against mass applying | Low defaults, a prompt for a second application to one employer, match gates, and no retries: if a form refuses an application, the panel shows the message and stops. |
| Employer terms and store policies have not had a legal review           | A review before S3 reaches anyone beyond the owner (see Rollout).                                                                                                      |
| Volume lowers quality                                                   | The quick-fill match gate, the per-employer prompt, the response-rate comparison, and a ceiling that is one constant.                                                  |

## Left to the builder

- The extension's build tooling, and whether the review panel is the side panel (preferred) or an in-page overlay.
- The exact type of `standard_answers`, the label dictionaries, and the option-matching table.
- Each handler's confirmation signal and its way of attaching files.
- Whether Ashby publishes a job's form without a key (check `jobPosting.info`); until then treat it like Lever.
- The cover-letter PDF renderer, if forms need one.
- Route names, rate-limit numbers, and the wording of the new UI.

## For the owner to confirm

1. **Quick-fill gate:** match at least 80 (the person's auto-prepare minimum), never below 70. At 20 a day this decides how many sent applications are not tailored.
2. **Daily cap default of 5**, and Concierge's default.
3. **Pro `answers` stays at 100 a month,** about 3 AI-drafted forms a day. A bigger number is a cost decision (see "Plan limits and cost").
4. **An unlisted store listing first**, public after the owner's own use.
5. **Order against the customer care branch:** this builds on its hidden jobs and migration 0012.
6. **Hand-off:** a Concierge client can hand any application to their specialist. Pro gets no per-application hand-off; offering one would be a pricing decision.
