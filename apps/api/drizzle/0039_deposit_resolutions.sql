CREATE TABLE "merchant_deposit_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_transfer_claim" (
	"network" text NOT NULL,
	"hash" text NOT NULL,
	"event_index" integer DEFAULT -1 NOT NULL,
	"kind" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"venue_id" uuid,
	"legacy_charge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_deposit_resolution" ADD CONSTRAINT "merchant_deposit_resolution_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_deposit_resolution" ADD CONSTRAINT "merchant_deposit_resolution_observation_id_merchant_wallet_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."merchant_wallet_observation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_transfer_claim" ADD CONSTRAINT "merchant_transfer_claim_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_transfer_claim" ADD CONSTRAINT "merchant_transfer_claim_legacy_charge_id_charge_id_fk" FOREIGN KEY ("legacy_charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_deposit_resolution_observation" ON "merchant_deposit_resolution" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "merchant_deposit_resolution_venue" ON "merchant_deposit_resolution" USING btree ("venue_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_transfer_claim_event" ON "merchant_transfer_claim" USING btree ("network","hash","event_index");
--> statement-breakpoint
-- Preserve the transaction namespace of existing records. Historical collisions remain auditable.
INSERT INTO merchant_transfer_claim(network,hash,kind,reference_id,venue_id)
SELECT CASE WHEN v.network LIKE 'nimiq:%' THEN 'nimiq' ELSE v.network END,lower(v.hash),'ORDER_'||v.purpose,v.order_id,o.venue_id
FROM merchant_verified_transaction v JOIN merchant_order o ON o.id=v.order_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO merchant_transfer_claim(network,hash,kind,reference_id,legacy_charge_id)
SELECT network,lower(hash),'LEGACY',charge_id,charge_id FROM chain_transaction
ON CONFLICT DO NOTHING;
