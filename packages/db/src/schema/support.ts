import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/*
 * Customer care: help requests and Concierge escalations ("cases"), their messages, the private
 * links emailed to requesters, single-use data-export links, and the record of which weeks the
 * Concierge missed-target check has run.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

/** A user column that is kept, as null, when the account is deleted. */
const optionalUser = (column: string) =>
  text(column).references(() => users.id, { onDelete: "set null" });

/** What a help request is about; escalations use "concierge". */
export const SUPPORT_TOPICS = [
  "account",
  "billing",
  "concierge",
  "jobs",
  "bug",
  "data",
  "other",
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/** A user's help request, or a Concierge problem handed to customer care. */
export const CASE_KINDS = ["help", "escalation"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/** Where a case came from: the Contact support form, a specialist, or the Monday check. */
export const CASE_SOURCES = ["form", "specialist", "weekly_check"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

export const CASE_STATUSES = ["open", "waiting_on_user", "solved"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const MESSAGE_AUTHOR_KINDS = ["user", "agent", "system"] as const;
export type MessageAuthorKind = (typeof MESSAGE_AUTHOR_KINDS)[number];

/** Internal messages are staff-only: never emailed, shown to the user or exported. */
export const MESSAGE_VISIBILITIES = ["public", "internal"] as const;
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];

export const supportCases = pgTable(
  "support_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The request number people quote ("#1042"). */
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 1001 }).notNull().unique(),
    kind: text("kind", { enum: CASE_KINDS }).notNull(),
    source: text("source", { enum: CASE_SOURCES }).notNull(),
    topic: text("topic", { enum: SUPPORT_TOPICS }).notNull(),
    status: text("status", { enum: CASE_STATUSES }).notNull().default("open"),
    subject: text("subject").notNull(),
    /** Who the case is about; null when a signed-out email matches no account. */
    userId: optionalUser("user_id"),
    /** Where emails go. Kept after the account is deleted. */
    contactName: text("contact_name").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    raisedByUserId: optionalUser("raised_by_user_id"),
    /** The client's specialist, on Concierge cases. */
    specialistId: optionalUser("specialist_id"),
    /** The agent who owns the case. */
    assigneeId: optionalUser("assignee_id"),
    /** When the requester proved they control the account; deletion requires it. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** The first public agent reply, which meets the first-reply target. */
    firstRepliedAt: timestamp("first_replied_at", { withTimezone: true }),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    /** The clock for solving cases that have waited on the user too long. */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("support_cases_status_idx").on(table.status, table.createdAt),
    index("support_cases_assignee_idx").on(table.assigneeId, table.status),
    index("support_cases_user_idx").on(table.userId),
  ],
).enableRLS();

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => supportCases.id, { onDelete: "cascade" }),
    authorUserId: optionalUser("author_user_id"),
    authorKind: text("author_kind", { enum: MESSAGE_AUTHOR_KINDS }).notNull(),
    visibility: text("visibility", { enum: MESSAGE_VISIBILITIES }).notNull(),
    body: text("body").notNull(),
    createdAt,
  },
  (table) => [index("support_messages_case_idx").on(table.caseId, table.createdAt)],
).enableRLS();

/**
 * The private links in emails to a requester. Each email gets its own link, and only its hash is
 * stored; a link stops working 14 days after the case is solved.
 */
export const supportCaseLinks = pgTable("support_case_links", {
  tokenHash: text("token_hash").primaryKey(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => supportCases.id, { onDelete: "cascade" }),
  createdAt,
}).enableRLS();

/** Single-use data-export links an agent emails to a user, valid for 24 hours. */
export const exportLinks = pgTable("export_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdByUserId: optionalUser("created_by_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt,
}).enableRLS();

/** One row per Concierge client and week the missed-target check has covered. */
export const conciergeWeekChecks = pgTable(
  "concierge_week_checks",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The Monday that week began, as YYYY-MM-DD. */
    weekStart: date("week_start", { mode: "string" }).notNull(),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.clientId, table.weekStart] })],
).enableRLS();
