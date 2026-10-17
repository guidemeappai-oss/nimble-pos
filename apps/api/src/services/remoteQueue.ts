import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as schema from '../db/schema'

/** Counts accepted remote-order slots and checkout quotes that still reserve a slot. */
export async function remoteQueueCount(db: Db, venueId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.merchantOrder)
    .where(
      and(
        eq(schema.merchantOrder.venueId, venueId),
        eq(schema.merchantOrder.source, 'REMOTE'),
        or(
          inArray(schema.merchantOrder.status, [
            'PAYMENT_PENDING',
            'AWAITING_ACCEPTANCE',
            'PREPARING',
            'READY',
          ]),
          and(
            eq(schema.merchantOrder.status, 'AWAITING_PAYMENT'),
            sql`${schema.merchantOrder.quote}->>'expiresAt' > ${new Date().toISOString()}`,
          ),
        ),
      ),
    )
  return row.count
}
