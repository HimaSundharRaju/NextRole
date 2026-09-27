ALTER TABLE "jobs" ADD COLUMN "employer_name" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_duplicate_of_jobs_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_fingerprint_idx" ON "jobs" USING btree ("fingerprint") WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX "jobs_duplicate_of_idx" ON "jobs" USING btree ("duplicate_of");