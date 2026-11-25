CREATE TABLE "concierge_week_checks" (
	"client_id" text NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concierge_week_checks_client_id_week_start_pk" PRIMARY KEY("client_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "concierge_week_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "export_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "export_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_case_links" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_case_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "support_cases_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"topic" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subject" text NOT NULL,
	"user_id" text,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"raised_by_user_id" text,
	"specialist_id" text,
	"assignee_id" text,
	"verified_at" timestamp with time zone,
	"first_replied_at" timestamp with time zone,
	"solved_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_cases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "support_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" text,
	"author_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_reports" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_reports" ADD COLUMN "reviewed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "job_reports" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "hidden_by_user_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "hidden_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "concierge_week_checks" ADD CONSTRAINT "concierge_week_checks_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_links" ADD CONSTRAINT "export_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_links" ADD CONSTRAINT "export_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_case_links" ADD CONSTRAINT "support_case_links_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_specialist_id_users_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_cases_status_idx" ON "support_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_cases_assignee_idx" ON "support_cases" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "support_cases_user_idx" ON "support_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_messages_case_idx" ON "support_messages" USING btree ("case_id","created_at");--> statement-breakpoint
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_hidden_by_user_id_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;