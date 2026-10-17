CREATE TABLE "merchant_cashier_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "merchant_cashier_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "merchant_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_notification_outbox" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"network" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"raw_transaction" text,
	"signed_at" timestamp with time zone,
	"transaction_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_notification_outbox_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "merchant_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"fiat_currency" text NOT NULL,
	"total_minor" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"checkout_token" text NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"pending_payment_hash" text,
	"quote_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quote" jsonb,
	"payment" jsonb,
	"claim_session_id" uuid,
	"notification_address" text,
	"payer_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_order_checkout_token_unique" UNIQUE("checkout_token"),
	CONSTRAINT "merchant_order_claim_session_id_unique" UNIQUE("claim_session_id")
);
--> statement-breakpoint
CREATE TABLE "merchant_order_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_pin_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"catalog" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"reason" text,
	"pending_hash" text,
	"quote" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_refund_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "merchant_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"report_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "merchant_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_terminal_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "merchant_venue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fiat_currency" text NOT NULL,
	"nim_address" text NOT NULL,
	"usdt_address" text,
	"next_order_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_verified_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"network" text NOT NULL,
	"hash" text NOT NULL,
	"receipt" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_session" ADD COLUMN "merchant_checkout_token" text;--> statement-breakpoint
ALTER TABLE "merchant_cashier_session" ADD CONSTRAINT "merchant_cashier_session_terminal_id_merchant_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."merchant_terminal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_cashier_session" ADD CONSTRAINT "merchant_cashier_session_employee_id_merchant_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_employee" ADD CONSTRAINT "merchant_employee_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_notification_outbox" ADD CONSTRAINT "merchant_notification_outbox_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD CONSTRAINT "merchant_order_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD CONSTRAINT "merchant_order_employee_id_merchant_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD CONSTRAINT "merchant_order_shift_id_merchant_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."merchant_shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD CONSTRAINT "merchant_order_claim_session_id_payment_session_id_fk" FOREIGN KEY ("claim_session_id") REFERENCES "public"."payment_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order" ADD CONSTRAINT "merchant_order_payer_user_id_user_profile_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_order_revision" ADD CONSTRAINT "merchant_order_revision_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_pin_attempt" ADD CONSTRAINT "merchant_pin_attempt_terminal_id_merchant_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."merchant_terminal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_product" ADD CONSTRAINT "merchant_product_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_refund" ADD CONSTRAINT "merchant_refund_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_shift" ADD CONSTRAINT "merchant_shift_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_shift" ADD CONSTRAINT "merchant_shift_employee_id_merchant_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_terminal" ADD CONSTRAINT "merchant_terminal_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_venue" ADD CONSTRAINT "merchant_venue_owner_user_id_user_profile_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_verified_transaction" ADD CONSTRAINT "merchant_verified_transaction_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_order_number" ON "merchant_order" USING btree ("venue_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_order_request" ON "merchant_order" USING btree ("employee_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_revision_unique" ON "merchant_order_revision" USING btree ("order_id","revision");--> statement-breakpoint
CREATE INDEX "merchant_pin_attempt_terminal" ON "merchant_pin_attempt" USING btree ("terminal_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_one_open_shift" ON "merchant_shift" USING btree ("employee_id") WHERE closed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_one_terminal" ON "merchant_terminal" USING btree ("venue_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_network_hash" ON "merchant_verified_transaction" USING btree ("network","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_order_purpose" ON "merchant_verified_transaction" USING btree ("order_id","purpose");