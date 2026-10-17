CREATE TABLE "merchant_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"time_zone" text NOT NULL,
	"version" integer NOT NULL,
	"request_key" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"coverage_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_employee_id" uuid,
	"created_by_owner_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_schedule_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_substitution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"schedule_shift_id" uuid NOT NULL,
	"requested_by_employee_id" uuid NOT NULL,
	"substitute_employee_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_employee_id" uuid,
	"reviewed_by_owner_id" uuid,
	"new_schedule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "merchant_schedule" ADD CONSTRAINT "merchant_schedule_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_schedule" ADD CONSTRAINT "merchant_schedule_created_by_employee_id_merchant_employee_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_schedule" ADD CONSTRAINT "merchant_schedule_created_by_owner_id_user_profile_id_fk" FOREIGN KEY ("created_by_owner_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_schedule_shift" ADD CONSTRAINT "merchant_schedule_shift_schedule_id_merchant_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."merchant_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_schedule_shift" ADD CONSTRAINT "merchant_schedule_shift_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_schedule_shift" ADD CONSTRAINT "merchant_schedule_shift_employee_id_merchant_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_schedule_id_merchant_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."merchant_schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_schedule_shift_id_merchant_schedule_shift_id_fk" FOREIGN KEY ("schedule_shift_id") REFERENCES "public"."merchant_schedule_shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_requested_by_employee_id_merchant_employee_id_fk" FOREIGN KEY ("requested_by_employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_substitute_employee_id_merchant_employee_id_fk" FOREIGN KEY ("substitute_employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_reviewed_by_employee_id_merchant_employee_id_fk" FOREIGN KEY ("reviewed_by_employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_reviewed_by_owner_id_user_profile_id_fk" FOREIGN KEY ("reviewed_by_owner_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_substitution" ADD CONSTRAINT "merchant_substitution_new_schedule_id_merchant_schedule_id_fk" FOREIGN KEY ("new_schedule_id") REFERENCES "public"."merchant_schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_schedule_version" ON "merchant_schedule" USING btree ("venue_id","week_start","version");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_schedule_request" ON "merchant_schedule" USING btree ("venue_id","request_key");--> statement-breakpoint
CREATE INDEX "merchant_schedule_current" ON "merchant_schedule" USING btree ("venue_id","week_start","status");--> statement-breakpoint
CREATE INDEX "merchant_schedule_shift_employee" ON "merchant_schedule_shift" USING btree ("venue_id","employee_id","starts_at");--> statement-breakpoint
CREATE INDEX "merchant_substitution_inbox" ON "merchant_substitution" USING btree ("venue_id","status","created_at");