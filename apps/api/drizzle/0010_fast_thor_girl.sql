ALTER TABLE "merchant_order" ADD COLUMN "payment_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD COLUMN "payment_requires_refund" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_refund" ADD COLUMN "quote_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
