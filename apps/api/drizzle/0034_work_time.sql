CREATE TABLE merchant_work_time (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES merchant_venue(id), employee_id uuid NOT NULL REFERENCES merchant_employee(id),
 started_at timestamptz NOT NULL, ended_at timestamptz, status text NOT NULL CHECK(status IN ('WORKING','PAUSED','FINISHED')), breaks jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK(ended_at IS NULL OR ended_at>=started_at), CHECK((status='FINISHED')=(ended_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX merchant_work_time_history ON merchant_work_time(venue_id,employee_id,started_at);
--> statement-breakpoint
CREATE UNIQUE INDEX merchant_work_time_active ON merchant_work_time(employee_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE TABLE merchant_work_correction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES merchant_work_time(id),venue_id uuid NOT NULL REFERENCES merchant_venue(id),employee_id uuid NOT NULL REFERENCES merchant_employee(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')), reason text NOT NULL,previous jsonb NOT NULL,proposed jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,review_reason text,reviewer text
);
