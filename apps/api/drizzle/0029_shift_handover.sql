CREATE TABLE merchant_handover (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),venue_id uuid NOT NULL REFERENCES merchant_venue(id),shift_id uuid REFERENCES merchant_shift(id),
 status text NOT NULL CHECK(status IN ('PENDING','ACKNOWLEDGED')),created_by jsonb NOT NULL,successor_employee_id uuid REFERENCES merchant_employee(id),note text NOT NULL,snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),acknowledged_by jsonb,acknowledged_at timestamptz,
 CONSTRAINT merchant_handover_ack CHECK ((status='PENDING' AND acknowledged_by IS NULL AND acknowledged_at IS NULL) OR (status='ACKNOWLEDGED' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL))
);
CREATE INDEX merchant_handover_venue ON merchant_handover(venue_id,created_at);
CREATE UNIQUE INDEX merchant_handover_shift ON merchant_handover(shift_id);
