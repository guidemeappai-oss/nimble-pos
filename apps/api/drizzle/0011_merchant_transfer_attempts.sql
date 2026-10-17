CREATE TABLE "merchant_transfer_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"hash" text NOT NULL,
	"quote_id" text NOT NULL,
	"quote" jsonb NOT NULL,
	"snapshot" jsonb,
	"requires_refund" boolean DEFAULT false NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_transfer_attempt" ADD CONSTRAINT "merchant_transfer_attempt_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_attempt_unique" ON "merchant_transfer_attempt" USING btree ("order_id","purpose","hash","quote_id");--> statement-breakpoint
CREATE INDEX "merchant_attempt_due" ON "merchant_transfer_attempt" USING btree ("order_id","purpose","next_check_at");
--> statement-breakpoint
INSERT INTO merchant_transfer_attempt (order_id,purpose,hash,quote_id,quote,snapshot,requires_refund)
SELECT id,'PAYMENT',lower(pending_payment_hash),quote->>'id',quote,
  coalesce(payment_snapshot,jsonb_build_object('revision',revision,'lines',lines,'totalMinor',total_minor)),payment_requires_refund
FROM merchant_order WHERE pending_payment_hash IS NOT NULL AND quote IS NOT NULL AND payment IS NULL AND status='PAYMENT_PENDING';
--> statement-breakpoint
INSERT INTO merchant_transfer_attempt (order_id,purpose,hash,quote_id,quote)
SELECT order_id,'REFUND',lower(pending_hash),quote->>'id',quote
FROM merchant_refund WHERE pending_hash IS NOT NULL AND quote IS NOT NULL AND status='APPROVED';
