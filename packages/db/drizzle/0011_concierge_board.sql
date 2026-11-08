CREATE TABLE "client_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"specialist_id" text,
	"application_id" uuid,
	"kind" text NOT NULL,
	"question" text DEFAULT '' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"save_to_bank" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "proposed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "proposal_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submitted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "job_search_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "inbox_access_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "apply_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weekly_target_override" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "concierge_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "answer_bank" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "specialist_assignments" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_specialist_id_users_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_tasks_client_idx" ON "client_tasks" USING btree ("client_id","status");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;