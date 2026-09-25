import type { Resume, ResumeSettings } from "@gettargetrole/resume/schema";
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());
const emptyTextArray = sql`'{}'::text[]`;

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const userRef = () =>
  text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/* ------------------------------------------------------------------------------------------ */
/* Profile & preferences                                                                      */
/* ------------------------------------------------------------------------------------------ */

export const WORKPLACE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const REMOTE_PREFERENCES = ["remote", "hybrid", "onsite", "any"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

export const SENIORITY_LEVELS = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export const profiles = pgTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    headline: text("headline").notNull().default(""),
    targetTitles: text("target_titles").array().notNull().default(emptyTextArray),
    targetLocations: text("target_locations").array().notNull().default(emptyTextArray),
    remotePreference: text("remote_preference", { enum: REMOTE_PREFERENCES })
      .notNull()
      .default("any"),
    seniority: text("seniority", { enum: SENIORITY_LEVELS }),
    yearsExperience: integer("years_experience"),
    minSalary: integer("min_salary"),
    salaryCurrency: text("salary_currency").notNull().default("USD"),
    workAuthorization: text("work_authorization").notNull().default(""),
    needsSponsorship: boolean("needs_sponsorship").notNull().default(false),
    skills: text("skills").array().notNull().default(emptyTextArray),
    /** Facts and tone the AI uses to answer application questions in the user's own voice. */
    voiceNotes: text("voice_notes").notNull().default(""),
    phone: text("phone").notNull().default(""),
    linkedinUrl: text("linkedin_url").notNull().default(""),
    githubUrl: text("github_url").notNull().default(""),
    portfolioUrl: text("portfolio_url").notNull().default(""),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    alertMinScore: integer("alert_min_score").notNull().default(70),
    createdAt,
    updatedAt,
  },
  (table) => [index("profiles_skills_idx").using("gin", table.skills)],
).enableRLS();

/* ------------------------------------------------------------------------------------------ */
/* Companies & jobs (ingested from public ATS job boards)                                     */
/* ------------------------------------------------------------------------------------------ */

export const ATS_PROVIDERS = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    ats: text("ats", { enum: ATS_PROVIDERS }).notNull(),
    boardToken: text("board_token").notNull(),
    website: text("website").notNull().default(""),
    logoUrl: text("logo_url").notNull().default(""),
    active: boolean("active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncStatus: text("last_sync_status", { enum: ["ok", "error"] }),
    lastSyncError: text("last_sync_error"),
    openJobCount: integer("open_job_count").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("companies_ats_board_uq").on(table.ats, table.boardToken)],
).enableRLS();

export const SALARY_PERIODS = ["year", "month", "hour"] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    source: text("source", { enum: ATS_PROVIDERS }).notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    department: text("department").notNull().default(""),
    location: text("location").notNull().default(""),
    workplaceType: text("workplace_type", { enum: WORKPLACE_TYPES }).notNull().default("unknown"),
    employmentType: text("employment_type").notNull().default(""),
    /** Sanitized at ingestion with a strict allow-list; safe to render. */
    descriptionHtml: text("description_html").notNull().default(""),
    descriptionText: text("description_text").notNull().default(""),
    applyUrl: text("apply_url").notNull(),
    skills: text("skills").array().notNull().default(emptyTextArray),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period", { enum: SALARY_PERIODS }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    contentHash: text("content_hash").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(department, '') || ' ' || coalesce(location, '')), 'B') || setweight(to_tsvector('english', coalesce(description_text, '')), 'C')`,
    ),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("jobs_company_external_uq").on(table.companyId, table.externalId),
    index("jobs_open_recent_idx")
      .on(table.firstSeenAt.desc())
      .where(sql`closed_at is null`),
    index("jobs_search_idx").using("gin", table.searchVector),
    index("jobs_skills_idx").using("gin", table.skills),
  ],
).enableRLS();

export const MATCH_VERDICTS = ["strong", "good", "stretch", "poor"] as const;
export type MatchVerdict = (typeof MATCH_VERDICTS)[number];

/** Claude's fit analysis of a job against the user's resume (cached per user+job). */
export const jobMatches = pgTable(
  "job_matches",
  {
    userId: userRef(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    resumeId: uuid("resume_id"),
    score: integer("score").notNull(),
    verdict: text("verdict", { enum: MATCH_VERDICTS }).notNull(),
    summary: text("summary").notNull(),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
    model: text("model").notNull(),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.userId, table.jobId] })],
).enableRLS();

/* ------------------------------------------------------------------------------------------ */
/* Resumes                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const RESUME_KINDS = ["master", "tailored"] as const;

export const resumes = pgTable(
  "resumes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    title: text("title").notNull(),
    kind: text("kind", { enum: RESUME_KINDS }).notNull().default("master"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    content: jsonb("content").$type<Resume>().notNull(),
    settings: jsonb("settings").$type<ResumeSettings>().notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    sourceFileName: text("source_file_name"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("resumes_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    uniqueIndex("resumes_one_primary_per_user_uq")
      .on(table.userId)
      .where(sql`is_primary`),
  ],
).enableRLS();

export const REVISION_SOURCES = [
  "manual",
  "ai_chat",
  "ai_generate",
  "ai_tailor",
  "import",
  "restore",
] as const;
export type RevisionSource = (typeof REVISION_SOURCES)[number];

/** Immutable snapshots: undo history and proof of exactly what was sent with an application. */
export const resumeRevisions = pgTable(
  "resume_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    content: jsonb("content").$type<Resume>().notNull(),
    source: text("source", { enum: REVISION_SOURCES }).notNull(),
    note: text("note").notNull().default(""),
    createdAt,
  },
  (table) => [index("resume_revisions_resume_idx").on(table.resumeId, table.createdAt.desc())],
).enableRLS();

/** Resume Studio conversation history. */
export const resumeMessages = pgTable(
  "resume_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    revisionId: uuid("revision_id").references(() => resumeRevisions.id, { onDelete: "set null" }),
    createdAt,
  },
  (table) => [index("resume_messages_resume_idx").on(table.resumeId, table.createdAt)],
).enableRLS();

/* ------------------------------------------------------------------------------------------ */
/* Applications, outreach & notifications                                                     */
/* ------------------------------------------------------------------------------------------ */

export const APPLICATION_STATUSES = [
  "saved",
  "preparing",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ApplicationAnswer {
  question: string;
  answer: string;
}

export interface SubmissionReceipt {
  submittedAt: string;
  resumeId: string | null;
  resumeTitle: string;
  resume: Resume | null;
  coverLetter: string;
  answers: ApplicationAnswer[];
}

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    jobTitle: text("job_title").notNull(),
    jobUrl: text("job_url").notNull().default(""),
    location: text("location").notNull().default(""),
    status: text("status", { enum: APPLICATION_STATUSES }).notNull().default("saved"),
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    coverLetter: text("cover_letter").notNull().default(""),
    answers: jsonb("answers").$type<ApplicationAnswer[]>().notNull().default([]),
    receipt: jsonb("receipt").$type<SubmissionReceipt>(),
    notes: text("notes").notNull().default(""),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("applications_user_status_idx").on(table.userId, table.status),
    uniqueIndex("applications_user_job_uq")
      .on(table.userId, table.jobId)
      .where(sql`job_id is not null`),
  ],
).enableRLS();

export const APPLICATION_EVENT_TYPES = [
  "created",
  "status_changed",
  "note",
  "kit_generated",
  "outreach_drafted",
  "submitted",
] as const;

export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type", { enum: APPLICATION_EVENT_TYPES }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("application_events_app_idx").on(table.applicationId, table.createdAt)],
).enableRLS();

export const OUTREACH_CHANNELS = ["email", "linkedin"] as const;

export const outreachMessages = pgTable(
  "outreach_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    channel: text("channel", { enum: OUTREACH_CHANNELS }).notNull(),
    recipientName: text("recipient_name").notNull().default(""),
    recipientTitle: text("recipient_title").notNull().default(""),
    recipientEmail: text("recipient_email").notNull().default(""),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    status: text("status", { enum: ["draft", "sent"] })
      .notNull()
      .default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [index("outreach_user_idx").on(table.userId, table.createdAt.desc())],
).enableRLS();

export const NOTIFICATION_TYPES = ["job_match", "follow_up", "system"] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link").notNull().default(""),
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index("notifications_user_idx").on(table.userId, table.createdAt.desc()),
    uniqueIndex("notifications_dedupe_uq").on(table.userId, table.dedupeKey),
  ],
).enableRLS();

/* ------------------------------------------------------------------------------------------ */
/* Operations: AI metering, audit trail, concierge specialists                                */
/* ------------------------------------------------------------------------------------------ */

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    createdAt,
  },
  (table) => [index("ai_usage_user_created_idx").on(table.userId, table.createdAt)],
).enableRLS();

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull().default(""),
    targetId: text("target_id").notNull().default(""),
    ipAddress: text("ip_address").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt.desc()),
    index("audit_logs_action_idx").on(table.action, table.createdAt.desc()),
  ],
).enableRLS();

/** Concierge plan: a specialist works a client's pipeline on their behalf. */
export const specialistAssignments = pgTable(
  "specialist_assignments",
  {
    specialistId: text("specialist_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.specialistId, table.clientId] }),
    index("specialist_assignments_client_idx").on(table.clientId),
  ],
).enableRLS();
