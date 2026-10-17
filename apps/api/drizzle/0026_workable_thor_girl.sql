CREATE TABLE "merchant_order_readiness" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"quantities" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_readiness_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"order_id" uuid NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_order_readiness" ADD CONSTRAINT "merchant_order_readiness_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_readiness_request" ADD CONSTRAINT "merchant_readiness_request_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_readiness_request_actor_key" ON "merchant_readiness_request" USING btree ("actor","key");