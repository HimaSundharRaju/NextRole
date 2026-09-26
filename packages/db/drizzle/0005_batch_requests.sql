CREATE TABLE "ai_batch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"application_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"batch_id" text,
	"output" jsonb,
	"error" text DEFAULT '' NOT NULL,
	"slot_event_id" uuid NOT NULL,
	"created_application" boolean DEFAULT false NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_batch_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "batch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_batch_requests" ADD CONSTRAINT "ai_batch_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_batch_requests" ADD CONSTRAINT "ai_batch_requests_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_batch_requests_application_feature_uq" ON "ai_batch_requests" USING btree ("application_id","feature");--> statement-breakpoint
CREATE INDEX "ai_batch_requests_status_idx" ON "ai_batch_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_batch_requests_batch_idx" ON "ai_batch_requests" USING btree ("batch_id");