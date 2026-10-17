CREATE TABLE "merchant_order_context" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"delay_reason" text,
	CONSTRAINT "merchant_order_context_revision" CHECK ("merchant_order_context"."revision" >= 0),
	CONSTRAINT "merchant_order_context_priority" CHECK ("merchant_order_context"."priority" in ('NORMAL','HIGH'))
);
--> statement-breakpoint
CREATE TABLE "merchant_order_context_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"actor" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_order_context" ADD CONSTRAINT "merchant_order_context_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order_context_entry" ADD CONSTRAINT "merchant_order_context_entry_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_order_context_retry" ON "merchant_order_context_entry" USING btree ("actor","key");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_order_context_sequence" ON "merchant_order_context_entry" USING btree ("order_id","revision");--> statement-breakpoint
CREATE INDEX "merchant_order_context_history" ON "merchant_order_context_entry" USING btree ("order_id","revision");