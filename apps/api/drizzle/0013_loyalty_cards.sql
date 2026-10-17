CREATE TABLE "loyalty_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_checkout" (
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"card_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_evm_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loyalty_evm_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"event_key" text NOT NULL,
	"order_id" uuid,
	"reward_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "loyalty_program" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"network" text NOT NULL,
	"version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"minimum_minor" integer NOT NULL,
	"fiat_currency" text NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" text NOT NULL,
	"product_name" text NOT NULL,
	"variant_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_reward" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"number" integer,
	"accepted_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_reward_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "loyalty_card" ADD CONSTRAINT "loyalty_card_program_id_loyalty_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_card" ADD CONSTRAINT "loyalty_card_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_checkout" ADD CONSTRAINT "loyalty_checkout_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_checkout" ADD CONSTRAINT "loyalty_checkout_card_id_loyalty_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."loyalty_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_evm_challenge" ADD CONSTRAINT "loyalty_evm_challenge_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_evm_identity" ADD CONSTRAINT "loyalty_evm_identity_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_card_id_loyalty_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."loyalty_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_reward_id_loyalty_reward_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."loyalty_reward"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_program" ADD CONSTRAINT "loyalty_program_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_program" ADD CONSTRAINT "loyalty_program_product_id_merchant_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."merchant_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_reward" ADD CONSTRAINT "loyalty_reward_card_id_loyalty_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."loyalty_card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_reward" ADD CONSTRAINT "loyalty_reward_accepted_by_merchant_employee_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."merchant_employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_card_identity" ON "loyalty_card" USING btree ("program_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_checkout_revision" ON "loyalty_checkout" USING btree ("order_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_evm_identity_address" ON "loyalty_evm_identity" USING btree ("network","address");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_program_version" ON "loyalty_program" USING btree ("venue_id","network","version");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_request_actor_key" ON "loyalty_request" USING btree ("actor","key");
--> statement-breakpoint
CREATE SEQUENCE loyalty_reward_number_seq;
