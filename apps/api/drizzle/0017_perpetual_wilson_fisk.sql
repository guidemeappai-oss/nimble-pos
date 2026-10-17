CREATE TABLE "merchant_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"occurrence" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'TODO' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"assignee_employee_id" uuid,
	"reviewer_employee_id" uuid,
	"submission_number" integer DEFAULT 0 NOT NULL,
	"submission_comment" text,
	"review_comment" text,
	"completed_by" text,
	"owner_declared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_task_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_task_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_task" ADD CONSTRAINT "merchant_task_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_task" ADD CONSTRAINT "merchant_task_template_id_merchant_task_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."merchant_task_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_task" ADD CONSTRAINT "merchant_task_assignee_employee_id_merchant_employee_id_fk" FOREIGN KEY ("assignee_employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_task" ADD CONSTRAINT "merchant_task_reviewer_employee_id_merchant_employee_id_fk" FOREIGN KEY ("reviewer_employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_task_template" ADD CONSTRAINT "merchant_task_template_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_task_occurrence" ON "merchant_task" USING btree ("template_id","occurrence");--> statement-breakpoint
CREATE INDEX "merchant_task_venue" ON "merchant_task" USING btree ("venue_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_task_request_identity" ON "merchant_task_request" USING btree ("actor","key");