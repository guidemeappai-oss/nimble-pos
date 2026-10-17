CREATE TABLE "merchant_inventory_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"source" text NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_inventory_lot_nonnegative" CHECK ("merchant_inventory_lot"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "merchant_inventory_movement" ADD COLUMN "lot_allocations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_inventory_lot" ADD CONSTRAINT "merchant_inventory_lot_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_inventory_lot" ADD CONSTRAINT "merchant_inventory_lot_item_id_merchant_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."merchant_inventory_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_inventory_lot_item" ON "merchant_inventory_lot" USING btree ("item_id","expires_at");
--> statement-breakpoint
-- Legacy physical balance has no known expiry, receipt time or source lot. Do not invent history.
INSERT INTO merchant_inventory_lot (venue_id,item_id,quantity,label,source)
SELECT venue_id,id,quantity,'Unattributed legacy balance','LEGACY' FROM merchant_inventory_item WHERE quantity>0;
