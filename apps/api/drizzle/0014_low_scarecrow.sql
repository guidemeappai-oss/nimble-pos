ALTER TABLE "merchant_order" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_order" ALTER COLUMN "shift_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "source" text DEFAULT 'COUNTER' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "acceptance_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "decision_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "preparation_minutes" integer;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "pickup_nonce" text;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "pickup_code" text;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_accepting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_pickup_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_preparation_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD COLUMN "remote_heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_remote_request" ON "merchant_order" USING btree ("payer_user_id","request_key") WHERE source = 'REMOTE';--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_remote_pickup_code" ON "merchant_order" USING btree ("venue_id","pickup_code") WHERE source = 'REMOTE' and status in ('PREPARING','READY');