CREATE TABLE "merchant_menu_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_menu_state" (
	"venue_id" uuid PRIMARY KEY NOT NULL,
	"published_revision" integer DEFAULT 0 NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"draft_base_revision" integer,
	"draft_products" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_menu_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"products" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_menu_request" ADD CONSTRAINT "merchant_menu_request_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_menu_state" ADD CONSTRAINT "merchant_menu_state_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_menu_version" ADD CONSTRAINT "merchant_menu_version_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_menu_request_key" ON "merchant_menu_request" USING btree ("venue_id","actor","key");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_menu_revision" ON "merchant_menu_version" USING btree ("venue_id","revision");