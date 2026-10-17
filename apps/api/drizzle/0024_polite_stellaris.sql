CREATE TABLE "merchant_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"input_hash" text NOT NULL,
	"reason" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_terminal" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_operation" ADD CONSTRAINT "merchant_operation_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_operation" ADD CONSTRAINT "merchant_operation_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_operation_key" ON "merchant_operation" USING btree ("venue_id","key");--> statement-breakpoint
CREATE INDEX "merchant_operation_order_time" ON "merchant_operation" USING btree ("order_id","created_at");
--> statement-breakpoint
ALTER TABLE "merchant_transfer_attempt" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_transfer_attempt" ADD COLUMN "verification_code" text;--> statement-breakpoint
ALTER TABLE "merchant_operation" ADD COLUMN "lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "merchant_operation" ADD COLUMN "lease_until" timestamp with time zone;
