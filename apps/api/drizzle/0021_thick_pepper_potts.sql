CREATE TABLE "merchant_inventory_policy" (
	"venue_id" uuid PRIMARY KEY NOT NULL,
	"approval_threshold" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "merchant_inventory_policy_nonnegative" CHECK ("merchant_inventory_policy"."approval_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_stock_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_inventory_item" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "merchant_inventory_policy" ADD CONSTRAINT "merchant_inventory_policy_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_stock_operation" ADD CONSTRAINT "merchant_stock_operation_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_stock_operations_venue" ON "merchant_stock_operation" USING btree ("venue_id","kind","created_at");