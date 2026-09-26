ALTER TABLE "jobs" ADD COLUMN "salary_annual_min" bigint GENERATED ALWAYS AS (case salary_period when 'hour' then salary_min::bigint * 2080 when 'month' then salary_min::bigint * 12 else salary_min::bigint end) STORED;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_annual_max" bigint GENERATED ALWAYS AS (case salary_period when 'hour' then salary_max::bigint * 2080 when 'month' then salary_max::bigint * 12 else salary_max::bigint end) STORED;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "countries" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "regions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "employment_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "visa_sponsorship" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "citizenship_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_countries_idx" ON "jobs" USING gin ("countries");--> statement-breakpoint
CREATE INDEX "jobs_regions_idx" ON "jobs" USING gin ("regions");--> statement-breakpoint
CREATE INDEX "jobs_employment_types_idx" ON "jobs" USING gin ("employment_types");