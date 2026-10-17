CREATE TABLE merchant_menu_schedule (
 venue_id uuid PRIMARY KEY REFERENCES merchant_venue(id), revision integer NOT NULL DEFAULT 0, config jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE merchant_menu_schedule_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES merchant_venue(id), actor text NOT NULL,
 key uuid NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX menu_schedule_request_key ON merchant_menu_schedule_request(venue_id,actor,key);
