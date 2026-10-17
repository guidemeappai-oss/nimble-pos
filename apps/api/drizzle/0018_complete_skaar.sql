CREATE TABLE "merchant_task_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author" text NOT NULL,
	"submission_number" integer NOT NULL,
	"phase" text NOT NULL,
	"source" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"storage_key" uuid NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_task_photo" ADD CONSTRAINT "merchant_task_photo_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_task_photo" ADD CONSTRAINT "merchant_task_photo_task_id_merchant_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."merchant_task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_task_photo_retry" ON "merchant_task_photo" USING btree ("task_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "merchant_task_photo_task" ON "merchant_task_photo" USING btree ("task_id","submission_number");