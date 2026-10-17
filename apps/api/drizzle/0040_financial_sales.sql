CREATE TABLE "merchant_financial_sale" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"venue_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_financial_sale" ADD CONSTRAINT "merchant_financial_sale_order_id_merchant_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_financial_sale" ADD CONSTRAINT "merchant_financial_sale_venue_id_merchant_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."merchant_venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_financial_sale_range" ON "merchant_financial_sale" USING btree ("venue_id","occurred_at");
--> statement-breakpoint
-- Backfill only evidence preserved by the previous model; ambiguous history stays explicitly unresolved.
WITH facts AS (
 SELECT o.*,coalesce(o.payment_snapshot->'lines',o.lines) AS sale_lines,
 coalesce((o.payment_snapshot->>'totalMinor')::bigint,o.total_minor::bigint) AS sale_total,
 coalesce((SELECT sum((l->>'totalMinor')::bigint) FROM jsonb_array_elements(coalesce(o.payment_snapshot->'lines',o.lines)) l),0) AS sale_list,
 (EXISTS(SELECT 1 FROM merchant_stock_reservation r WHERE r.order_id=o.id AND r.status='CONSUMED') OR EXISTS(SELECT 1 FROM merchant_inventory_movement m WHERE m.venue_id=o.venue_id AND m.kind='SALE' AND m.reason IN ('POS order '||o.id,'Remote order '||o.id))) AS consumed
 FROM merchant_order o WHERE o.payment IS NOT NULL
), classified AS (
 SELECT *, (consumed OR (source='REMOTE' AND decision='ACCEPTED') OR (source='COUNTER' AND NOT payment_requires_refund AND cancelled_at IS NULL)) AND payment_snapshot IS NOT NULL AND sale_list>=sale_total AS recognized
 FROM facts
 WHERE consumed OR (source='REMOTE' AND decision='ACCEPTED') OR (source='COUNTER' AND NOT payment_requires_refund AND cancelled_at IS NULL)
 OR (source='COUNTER' AND cancelled_at IS NOT NULL AND cancelled_at>(payment->>'confirmedAt')::timestamptz AND (payment->>'confirmedAt')::timestamptz<=coalesce((quote->>'expiresAt')::timestamptz,cancelled_at))
)
INSERT INTO merchant_financial_sale(order_id,venue_id,occurred_at,data)
SELECT id,venue_id,CASE WHEN NOT recognized THEN NULL WHEN source='REMOTE' THEN coalesce(decision_at,(payment->>'confirmedAt')::timestamptz) ELSE (payment->>'confirmedAt')::timestamptz END,
jsonb_build_object('orderNumber',number,'source',source,'shiftId',shift_id,'employeeId',employee_id,'fiatCurrency',fiat_currency,
 'totalMinor',sale_total::text,'listMinor',CASE WHEN sale_list>=sale_total THEN sale_list::text ELSE NULL END,'discountMinor',CASE WHEN sale_list>=sale_total THEN (sale_list-sale_total)::text ELSE NULL END,
 'lines',sale_lines,'paymentHash',payment->>'hash','status',CASE WHEN recognized THEN 'RECORDED' ELSE 'UNRESOLVED' END,
 'provenance',CASE WHEN NOT recognized THEN 'LEGACY_UNKNOWN' WHEN consumed THEN 'LEGACY_CONSUMPTION' ELSE 'LEGACY_STATE' END,
 'timeBasis',CASE WHEN NOT recognized THEN 'UNKNOWN' WHEN source='REMOTE' THEN 'REMOTE_DECISION' ELSE 'PAYMENT_CONFIRMATION' END)
FROM classified ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Recover the first submission time only when an actual audit record exists.
WITH submitted AS (
 SELECT ("after"->>'id')::uuid AS id,min(created_at) AS at FROM merchant_audit
 WHERE action='wallet.deposit.refund.submitted' AND "after"->>'id' IS NOT NULL GROUP BY "after"->>'id'
)
UPDATE merchant_deposit_resolution r SET data=jsonb_set(r.data,'{refund,submittedAt}',to_jsonb(submitted.at))
FROM submitted WHERE r.id=submitted.id AND r.data->>'kind'='EXCESS' AND r.data->'refund'->>'submittedAt' IS NULL;
