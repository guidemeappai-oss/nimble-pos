CREATE TABLE "merchant_inventory_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"tracked" boolean NOT NULL,
	"quantity" integer NOT NULL,
	"threshold" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_inventory_nonnegative" CHECK ("merchant_inventory_item"."quantity" >= 0 AND "merchant_inventory_item"."threshold" >= 0),
	CONSTRAINT "merchant_inventory_unit" CHECK ("merchant_inventory_item"."unit" IN ('PIECE','PORTION')),
	CONSTRAINT "merchant_inventory_revision" CHECK ("merchant_inventory_item"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_inventory_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"reverses_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_inventory_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_inventory_item" ADD CONSTRAINT "merchant_inventory_item_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_inventory_movement" ADD CONSTRAINT "merchant_inventory_movement_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_inventory_movement" ADD CONSTRAINT "merchant_inventory_movement_item_id_merchant_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."merchant_inventory_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_inventory_request" ADD CONSTRAINT "merchant_inventory_request_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_inventory_reversal" ON "merchant_inventory_movement" USING btree ("reverses_movement_id");--> statement-breakpoint
CREATE INDEX "merchant_inventory_history" ON "merchant_inventory_movement" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_inventory_retry" ON "merchant_inventory_request" USING btree ("venue_id","actor","key");