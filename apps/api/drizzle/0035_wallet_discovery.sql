CREATE TABLE merchant_wallet_scan (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),venue_id uuid NOT NULL REFERENCES merchant_venue(id),asset text NOT NULL CHECK(asset IN ('NIM','USDT')),network text NOT NULL,recipient text NOT NULL,enabled boolean NOT NULL DEFAULT false,cursor jsonb NOT NULL DEFAULT '{}',covered_through integer,lease_token uuid,lease_until timestamptz,last_scanned_at timestamptz,last_error text,updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_wallet_scan_asset ON merchant_wallet_scan(venue_id,asset);
--> statement-breakpoint
CREATE TABLE merchant_wallet_observation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),venue_id uuid NOT NULL REFERENCES merchant_venue(id),event_key text NOT NULL,event jsonb NOT NULL,discovered_at timestamptz NOT NULL DEFAULT now(),checked_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_wallet_event_key ON merchant_wallet_observation(venue_id,event_key);
--> statement-breakpoint
CREATE INDEX merchant_wallet_observed ON merchant_wallet_observation(venue_id,discovered_at);
