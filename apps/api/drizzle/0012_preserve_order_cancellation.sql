ALTER TABLE "merchant_order" ADD COLUMN "cancelled_at" timestamp with time zone;
--> statement-breakpoint
-- Existing refund-required intents retain their conservative handling: older rows
-- cannot distinguish cancellation from an obsolete revision. Never revive them.
UPDATE merchant_order SET cancelled_at=now()
WHERE status='CANCELLED' OR (status='PAYMENT_PENDING' AND payment_requires_refund=true);
