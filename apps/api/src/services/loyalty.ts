import { createHmac } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { LoyaltyCard, LoyaltyProgram, LoyaltyReward } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { env } from '../env'
export class LoyaltyError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}
export const loyaltyFail = (status: number, code: string): never => {
  throw new LoyaltyError(status, code)
}
export const loyaltyNetwork = () => env.nimiqNetwork
export const rewardToken = (id: string, userId: string, expiresAt: Date) =>
  createHmac('sha256', env.codePepper)
    .update(`loyalty:${id}:${userId}:${expiresAt.toISOString()}`)
    .digest('base64url')
export async function programView(
  db: Db,
  p: typeof s.loyaltyProgram.$inferSelect,
): Promise<LoyaltyProgram> {
  const [v] = await db
    .select()
    .from(s.merchantVenue)
    .where(eq(s.merchantVenue.id, p.venueId))
  return {
    ...p,
    venueName: v.name,
    fiatCurrency: p.fiatCurrency as LoyaltyProgram['fiatCurrency'],
    threshold: 5,
  }
}
export async function expireReservations(db: Db, cardId: string) {
  const rewards = await db
    .select()
    .from(s.loyaltyReward)
    .where(
      and(
        eq(s.loyaltyReward.cardId, cardId),
        eq(s.loyaltyReward.status, 'RESERVED'),
      ),
    )
  for (const r of rewards)
    if (r.expiresAt.getTime() <= Date.now())
      await db
        .update(s.loyaltyReward)
        .set({ status: 'EXPIRED' })
        .where(eq(s.loyaltyReward.id, r.id))
}
export async function rewardView(
  db: Db,
  r: typeof s.loyaltyReward.$inferSelect,
): Promise<LoyaltyReward> {
  const [c] = await db
    .select()
    .from(s.loyaltyCard)
    .where(eq(s.loyaltyCard.id, r.cardId))
  const [p] = await db
    .select()
    .from(s.loyaltyProgram)
    .where(eq(s.loyaltyProgram.id, c.programId))
  return {
    id: r.id,
    cardId: r.cardId,
    venueId: p.venueId,
    productName: p.productName,
    variantName: p.variantName,
    status: r.status as LoyaltyReward['status'],
    number: r.number,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }
}
export async function cardView(db: Db, cardId: string): Promise<LoyaltyCard> {
  const [c] = await db
    .select()
    .from(s.loyaltyCard)
    .where(eq(s.loyaltyCard.id, cardId))
  if (!c) return loyaltyFail(404, 'NOT_FOUND')
  const [p] = await db
    .select()
    .from(s.loyaltyProgram)
    .where(eq(s.loyaltyProgram.id, c.programId))
  const entries = await db
    .select()
    .from(s.loyaltyLedger)
    .where(eq(s.loyaltyLedger.cardId, c.id))
    .orderBy(asc(s.loyaltyLedger.createdAt))
  const rewards = await db
    .select()
    .from(s.loyaltyReward)
    .where(eq(s.loyaltyReward.cardId, c.id))
    .orderBy(asc(s.loyaltyReward.createdAt))
  const earnedOrderIds = entries
    .filter((e) => e.kind === 'EARN')
    .map((e) => e.orderId!)
  const refundedIds = new Set(
    entries.filter((e) => e.kind === 'REFUND').map((e) => e.orderId),
  )
  const holds = earnedOrderIds.length
    ? await db
        .select()
        .from(s.merchantRefund)
        .where(
          and(
            inArray(s.merchantRefund.orderId, earnedOrderIds),
            inArray(s.merchantRefund.status, ['REQUESTED', 'APPROVED']),
          ),
        )
    : []
  const refundHolds = holds.filter((r) => !refundedIds.has(r.orderId)).length
  const reserved =
    rewards.filter(
      (r) => r.status === 'RESERVED' && r.expiresAt.getTime() > Date.now(),
    ).length * 5
  const related = await db
    .select({ card: s.loyaltyCard })
    .from(s.loyaltyCard)
    .innerJoin(
      s.loyaltyProgram,
      eq(s.loyaltyProgram.id, s.loyaltyCard.programId),
    )
    .where(
      and(
        eq(s.loyaltyCard.userId, c.userId),
        eq(s.loyaltyProgram.venueId, p.venueId),
        eq(s.loyaltyProgram.network, p.network),
      ),
    )
  let previousDebt = 0
  for (const { card } of related) {
    if (card.id === c.id) continue
    const otherEntries = await db
      .select()
      .from(s.loyaltyLedger)
      .where(eq(s.loyaltyLedger.cardId, card.id))
    const otherBalance = otherEntries.reduce((n, e) => n + e.delta, 0)
    const otherEarned = otherEntries
      .filter((e) => e.kind === 'EARN')
      .map((e) => e.orderId!)
    const corrected = new Set(
      otherEntries.filter((e) => e.kind === 'REFUND').map((e) => e.orderId),
    )
    const otherHolds = otherEarned.length
      ? await db
          .select()
          .from(s.merchantRefund)
          .where(
            and(
              inArray(s.merchantRefund.orderId, otherEarned),
              inArray(s.merchantRefund.status, ['REQUESTED', 'APPROVED']),
            ),
          )
      : []
    previousDebt += Math.min(
      0,
      otherBalance - otherHolds.filter((r) => !corrected.has(r.orderId)).length,
    )
  }
  const balance = entries.reduce((n, e) => n + e.delta, 0)
  const [current] = await db
    .select()
    .from(s.loyaltyProgram)
    .where(
      and(
        eq(s.loyaltyProgram.venueId, p.venueId),
        eq(s.loyaltyProgram.network, p.network),
      ),
    )
    .orderBy(asc(s.loyaltyProgram.version))
    .then((rows) => rows.slice(-1))
  return {
    id: c.id,
    program: await programView(db, p),
    earningEnabled: current?.active ?? false,
    balance,
    available: balance - reserved - refundHolds + previousDebt,
    refundHolds,
    reserved,
    entries: entries.map((e) => ({
      ...e,
      kind: e.kind as LoyaltyCard['entries'][number]['kind'],
      createdAt: e.createdAt.toISOString(),
    })),
    rewards: await Promise.all(
      rewards.map(async (r) => ({
        ...(await rewardView(
          db,
          r.expiresAt.getTime() <= Date.now() && r.status === 'RESERVED'
            ? { ...r, status: 'EXPIRED' }
            : r,
        )),
        ...(r.status === 'RESERVED' && r.expiresAt.getTime() > Date.now()
          ? { token: rewardToken(r.id, c.userId, r.expiresAt) }
          : {}),
      })),
    ),
  }
}
export async function lockLoyaltyUser(db: Db, userId: string) {
  // Includes card creation: row-only locks cannot lock a not-yet-existing version.
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`loyalty-cards:${userId}`},0))`,
  )
}
export async function lockCard(db: Db, cardId: string) {
  const [c] = await db
    .select()
    .from(s.loyaltyCard)
    .where(eq(s.loyaltyCard.id, cardId))
  if (!c) return loyaltyFail(404, 'NOT_FOUND')
  await lockLoyaltyUser(db, c.userId)
  // All cards of an account share one stable lock order, including version debt.
  await db
    .select()
    .from(s.loyaltyCard)
    .where(eq(s.loyaltyCard.userId, c.userId))
    .orderBy(asc(s.loyaltyCard.id))
    .for('update')
  await expireReservations(db, cardId)
  return c
}
export async function reconcileLoyaltyReservations(db: Db, cardId: string) {
  await lockCard(db, cardId)
  const view = await cardView(db, cardId)
  if (view.available >= 0) return
  // Cancel newest unaccepted reservations until pending refunds are covered.
  const reserved = view.rewards.filter((r) => r.status === 'RESERVED').reverse()
  let available = view.available
  for (const reward of reserved) {
    if (available >= 0) break
    await db
      .update(s.loyaltyReward)
      .set({ status: 'CANCELLED' })
      .where(eq(s.loyaltyReward.id, reward.id))
    available += 5
  }
}
export async function earnLoyalty(
  db: Db,
  order: typeof s.merchantOrder.$inferSelect,
  paidRevision: number,
  totalMinor: number,
) {
  const [binding] = await db
    .select()
    .from(s.loyaltyCheckout)
    .where(
      and(
        eq(s.loyaltyCheckout.orderId, order.id),
        eq(s.loyaltyCheckout.revision, paidRevision),
      ),
    )
  if (!binding) return
  const card = await lockCard(db, binding.cardId)
  const [p] = await db
    .select()
    .from(s.loyaltyProgram)
    .where(eq(s.loyaltyProgram.id, card.programId))
  const [current] = await db
    .select()
    .from(s.loyaltyProgram)
    .where(
      and(
        eq(s.loyaltyProgram.venueId, p.venueId),
        eq(s.loyaltyProgram.network, p.network),
      ),
    )
    .orderBy(asc(s.loyaltyProgram.version))
    .then((rows) => rows.slice(-1))
  if (
    !current?.active ||
    p.network !== loyaltyNetwork() ||
    p.fiatCurrency !== order.fiatCurrency ||
    totalMinor < p.minimumMinor ||
    totalMinor <= 0
  )
    return
  await db
    .insert(s.loyaltyLedger)
    .values({
      cardId: card.id,
      kind: 'EARN',
      delta: 1,
      eventKey: `earn:${order.id}`,
      orderId: order.id,
    })
    .onConflictDoNothing({ target: s.loyaltyLedger.eventKey })
}
export async function loyaltyRefundRequested(db: Db, orderId: string) {
  const [entry] = await db
    .select()
    .from(s.loyaltyLedger)
    .where(eq(s.loyaltyLedger.eventKey, `earn:${orderId}`))
  if (entry) await reconcileAccountReservations(db, entry.cardId)
}
export async function refundLoyalty(db: Db, orderId: string) {
  const [entry] = await db
    .select()
    .from(s.loyaltyLedger)
    .where(eq(s.loyaltyLedger.eventKey, `earn:${orderId}`))
  if (!entry) return
  await lockCard(db, entry.cardId)
  await db
    .insert(s.loyaltyLedger)
    .values({
      cardId: entry.cardId,
      kind: 'REFUND',
      delta: -1,
      eventKey: `refund:${orderId}`,
      orderId,
    })
    .onConflictDoNothing({ target: s.loyaltyLedger.eventKey })
  await reconcileAccountReservations(db, entry.cardId)
}
export async function validateLoyaltySender(
  db: Db,
  order: typeof s.merchantOrder.$inferSelect,
  asset: 'NIM' | 'USDT',
  sender: string,
) {
  const [binding] = await db
    .select()
    .from(s.loyaltyCheckout)
    .where(
      and(
        eq(s.loyaltyCheckout.orderId, order.id),
        eq(s.loyaltyCheckout.revision, order.revision),
      ),
    )
  if (!binding) return
  const [card] = await db
    .select()
    .from(s.loyaltyCard)
    .where(eq(s.loyaltyCard.id, binding.cardId))
  const normalized = sender.replace(/\s/g, '').toLowerCase()
  if (asset === 'NIM') {
    const [u] = await db
      .select()
      .from(s.userProfile)
      .where(eq(s.userProfile.id, card.userId))
    if (u.walletAddress.replace(/\s/g, '').toLowerCase() !== normalized)
      return loyaltyFail(409, 'LOYALTY_PAYER_MISMATCH')
  } else {
    const [identity] = await db
      .select()
      .from(s.loyaltyEvmIdentity)
      .where(
        and(
          eq(s.loyaltyEvmIdentity.userId, card.userId),
          eq(s.loyaltyEvmIdentity.address, normalized),
          eq(s.loyaltyEvmIdentity.network, loyaltyNetwork()),
        ),
      )
    if (!identity) return loyaltyFail(409, 'LOYALTY_EVM_PROOF_REQUIRED')
  }
}

async function reconcileAccountReservations(db: Db, cardId: string) {
  const c = await lockCard(db, cardId)
  const cards = await db
    .select()
    .from(s.loyaltyCard)
    .where(eq(s.loyaltyCard.userId, c.userId))
    .orderBy(asc(s.loyaltyCard.id))
  for (const card of cards) await reconcileLoyaltyReservations(db, card.id)
}

/** Paid remote checkouts keep their original card open until the venue decision. */
export async function hasPendingLoyaltyAcceptance(db: Db, cardId: string) {
  const [pending] = await db
    .select({ id: s.merchantOrder.id })
    .from(s.loyaltyCheckout)
    .innerJoin(
      s.merchantOrder,
      eq(s.merchantOrder.id, s.loyaltyCheckout.orderId),
    )
    .where(
      and(
        eq(s.loyaltyCheckout.cardId, cardId),
        eq(s.loyaltyCheckout.revision, s.merchantOrder.revision),
        eq(s.merchantOrder.status, 'AWAITING_ACCEPTANCE'),
      ),
    )
    .limit(1)
  return !!pending
}
