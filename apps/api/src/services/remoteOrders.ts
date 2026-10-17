import { releaseOrderStock } from './stockReservations'
import { createHmac, randomBytes } from 'node:crypto'
import { and, eq, lte } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { env } from '../env'
export const pickupToken = (o: typeof s.merchantOrder.$inferSelect) =>
  `nimble-pickup:${o.id}:${createHmac('sha256', env.codePepper).update(`remote:${env.nimiqNetwork}:${o.venueId}:${o.id}:${o.pickupNonce}`).digest('base64url')}`
export const pickupSecret = () => randomBytes(32).toString('base64url')
export async function rejectRemote(
  store: Db,
  o: typeof s.merchantOrder.$inferSelect,
  reason: string,
  decision: 'REJECTED' | 'TIMED_OUT',
  actor?: {
    employeeId: string
    shiftId: string
  },
) {
  await releaseOrderStock(store,o.id)
  await store
    .insert(s.merchantRefund)
    .values({ orderId: o.id, reason })
    .onConflictDoNothing({ target: s.merchantRefund.orderId })
  const [updated] = await store
    .update(s.merchantOrder)
    .set({
      status: 'REFUND_PENDING',
      decision,
      decisionReason: reason,
      decisionAt: new Date(),
      paymentRequiresRefund: true,
      ...actor,
    })
    .where(eq(s.merchantOrder.id, o.id))
    .returning()
  return updated
}
/** Persisted deadline is authoritative, even after restart or while the terminal is offline. */
export async function remoteAcceptanceTick(db: Db) {
  const due = await db
    .select({ id: s.merchantOrder.id })
    .from(s.merchantOrder)
    .where(
      and(
        eq(s.merchantOrder.source, 'REMOTE'),
        eq(s.merchantOrder.status, 'AWAITING_ACCEPTANCE'),
        lte(s.merchantOrder.acceptanceDeadline, new Date()),
      ),
    )
  for (const { id } of due)
    await db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      const [o] = await tx
        .select()
        .from(s.merchantOrder)
        .where(eq(s.merchantOrder.id, id))
        .for('update')
      if (
        o.status === 'AWAITING_ACCEPTANCE' &&
        o.acceptanceDeadline &&
        o.acceptanceDeadline.getTime() <= Date.now()
      )
        await rejectRemote(
          tx,
          o,
          'The venue did not respond before the acceptance deadline',
          'TIMED_OUT',
        )
    })
}
