ALTER TABLE "job_matches" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "auto_prepare_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "auto_prepare_min_score" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "auto_prepare_daily_limit" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "tailor_notes" jsonb;