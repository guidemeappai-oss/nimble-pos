CREATE TABLE "merchant_menu_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_menu_image" ADD CONSTRAINT "merchant_menu_image_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_menu_image_request" ON "merchant_menu_image" USING btree ("venue_id","request_key");