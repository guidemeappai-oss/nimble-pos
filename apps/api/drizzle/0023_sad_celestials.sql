CREATE TABLE "merchant_stock_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"quote_id" text NOT NULL,
	"revision" integer NOT NULL,
	"requirements" jsonb NOT NULL,
	"status" text DEFAULT 'HELD' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_reward" ADD COLUMN "stock_requirements" jsonb;--> statement-breakpoint
ALTER TABLE "merchant_stock_reservation" ADD CONSTRAINT "merchant_stock_reservation_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_stock_reservation" ADD CONSTRAINT "merchant_stock_reservation_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_stock_reservation_quote" ON "merchant_stock_reservation" USING btree ("order_id","quote_id");--> statement-breakpoint
CREATE INDEX "merchant_stock_reservation_venue" ON "merchant_stock_reservation" USING btree ("venue_id","status");