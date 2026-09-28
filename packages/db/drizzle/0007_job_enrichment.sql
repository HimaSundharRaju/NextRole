CREATE TABLE "enrichment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" text NOT NULL,
	"model" text NOT NULL,
	"external_id" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"job_count" integer NOT NULL,
	"estimated_cost_micro_usd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "enrichment_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "years_min" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "seniority" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "enrichment" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "enriched_hash" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "enrichment_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_enrichment_batch_id_enrichment_batches_id_fk" FOREIGN KEY ("enrichment_batch_id") REFERENCES "public"."enrichment_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_enrichment_batch_idx" ON "jobs" USING btree ("enrichment_batch_id");