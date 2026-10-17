import {claimTransfer} from './transferClaims'
import { orderStockValid, consumeOrderStock, releaseOrderStock, releaseSiblingOrderStock } from './stockReservations'
import { remoteAcceptanceTick } from './remoteOrders'
import { earnLoyalty, refundLoyalty } from './loyalty'
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm'
import type { MerchantPayment, MerchantQuote } from '@nimble/shared'
import type { Db } from '../db/client'
import {
  chainTransaction,
  merchantOrder,
  merchantRefund,
  merchantVerifiedTransaction,
  merchantTransferAttempt,
} from '../db/schema'
import type { MerchantPaymentGateway } from './merchantGateway'
export class MerchantSettlementError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}
const fail = (status: number, code: string): never => {
  throw new MerchantSettlementError(status, code)
}
const sameAddress = (a: string, b: string) =>
  a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase()
export function matches(payment: MerchantPayment, quote: MerchantQuote, hash: string) {
  return (
    payment.hash.toLowerCase() === hash.toLowerCase() &&
    payment.asset === quote.asset &&
    payment.network === quote.network &&
    payment.amountAtomic === quote.amountAtomic &&
    sameAddress(payment.sender, quote.sender) &&
    sameAddress(payment.recipient, quote.recipient) &&
    Number.isFinite(Date.parse(payment.confirmedAt))
  )
}
async function verified(
  gateway: MerchantPaymentGateway,
  quote: MerchantQuote,
  hash: string,
) {
  let payment: MerchantPayment | null
  try {
    payment = await gateway.verify({ quote, hash })
  } catch {
    return fail(503, 'PAYMENTS_UNAVAILABLE')
  }
  if (payment && !matches(payment, quote, hash))
    return fail(409, 'PAYMENT_MISMATCH')
  return payment ? { ...payment, hash: payment.hash.toLowerCase() } : null
}
export async function assertUnassigned(store: Db, payment: MerchantPayment) {
  // Legacy P2P calls its Nimiq network "nimiq". Its hashes and merchant
  // hashes share the same on-chain transaction namespace on this deployment.
  const [legacy] = await store
    .select()
    .from(chainTransaction)
    .where(
      and(
        eq(
          chainTransaction.network,
          payment.network.startsWith('nimiq:') ? 'nimiq' : payment.network,
        ),
        sql`lower(${chainTransaction.hash}) = ${payment.hash.toLowerCase()}`,
      ),
    )
  const [assigned] = await store
    .select()
    .from(merchantVerifiedTransaction)
    .where(
      and(
        eq(merchantVerifiedTransaction.network, payment.network),
        eq(merchantVerifiedTransaction.hash, payment.hash),
      ),
    )
  if (legacy || assigned) return fail(409, 'TRANSACTION_ALREADY_ASSIGNED')
}
async function record(
  store: Db,
  orderId: string,
  purpose: 'PAYMENT' | 'REFUND',
  payment: MerchantPayment,
) {
  await assertUnassigned(store, payment)
  const [order]=await store.select().from(merchantOrder).where(eq(merchantOrder.id,orderId))
  await claimTransfer(store,{network:payment.network,hash:payment.hash,kind:'ORDER_'+purpose,referenceId:orderId,venueId:order.venueId})
  await store.insert(merchantVerifiedTransaction).values({
    orderId,
    purpose,
    network: payment.network,
    hash: payment.hash.toLowerCase(),
    receipt: payment,
  })
}
async function findVerifiedAttempt(
  db: Db,
  gateway: MerchantPaymentGateway,
  orderId: string,
  purpose: 'PAYMENT' | 'REFUND',
) {
  const attempts = await db
    .select()
    .from(merchantTransferAttempt)
    .where(
      and(
        eq(merchantTransferAttempt.orderId, orderId),
        eq(merchantTransferAttempt.purpose, purpose),
        lte(merchantTransferAttempt.nextCheckAt, new Date()),
      ),
    )
    .orderBy(
      asc(merchantTransferAttempt.nextCheckAt),
      asc(merchantTransferAttempt.createdAt),
    )
    .limit(5)
  let lastError: unknown
  for (const attempt of attempts) {
    let verificationCode='UNVERIFIED'
    const lastCheckedAt=new Date()
    try {
      const payment = await verified(gateway, attempt.quote, attempt.hash)
      if (payment) {
        await assertUnassigned(db, payment)
        await db.update(merchantTransferAttempt).set({lastCheckedAt,verificationCode:'VERIFIED',checks:attempt.checks+1}).where(eq(merchantTransferAttempt.id,attempt.id))
        return { attempt, payment }
      }
    } catch (error) {
      lastError = error
      verificationCode=error instanceof MerchantSettlementError && ['PAYMENT_MISMATCH','TRANSACTION_ALREADY_ASSIGNED','PAYMENTS_UNAVAILABLE'].includes(error.code)?error.code:'PAYMENTS_UNAVAILABLE'
    }
    // Unknown, failed or mismatching hashes never exclude later submissions.
    // Backoff bounds repeated work; an explicit retry makes its attempt due again.
    const delay =
      attempt.checks === 0
        ? 0
        : Math.min(3600, 5 * 2 ** Math.min(attempt.checks, 10))
    await db
      .update(merchantTransferAttempt)
      .set({
        checks: attempt.checks + 1, lastCheckedAt, verificationCode,
        nextCheckAt: new Date(Date.now() + delay * 1000),
      })
      .where(eq(merchantTransferAttempt.id, attempt.id))
  }
  if (lastError) throw lastError
  return null
}
/** Verify persisted attempts without signing or trusting a submitted hash. */
export async function reconcileMerchantPayment(
  db: Db,
  gateway: MerchantPaymentGateway,
  orderId: string,
) {
  const [order] = await db
    .select()
    .from(merchantOrder)
    .where(eq(merchantOrder.id, orderId))
  if (!order || order.payment || order.status !== 'PAYMENT_PENDING') return
  const found = await findVerifiedAttempt(db, gateway, orderId, 'PAYMENT')
  if (!found) return
  const { attempt, payment } = found
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(merchantOrder)
      .where(eq(merchantOrder.id, orderId))
      .for('update')
    if (current.payment) return
    if (current.status !== 'PAYMENT_PENDING' || !attempt.snapshot)
      return fail(409, 'STALE_QUOTE')
    const requiresRefund =
      !!current.cancelledAt ||
      attempt.requiresRefund ||
      current.revision !== attempt.snapshot.revision ||
      Date.parse(payment.confirmedAt) > Date.parse(attempt.quote.expiresAt) ||
      !(await orderStockValid(tx as unknown as Db,current,attempt.quote.id,attempt.snapshot.revision,attempt.snapshot.lines))
    await record(tx as unknown as Db, orderId, 'PAYMENT', payment)
    await tx
      .update(merchantOrder)
      .set({
        payment,
        quote: attempt.quote,
        pendingPaymentHash: attempt.hash,
        paymentSnapshot: attempt.snapshot,
        paymentRequiresRefund: requiresRefund,
        status: requiresRefund ? 'REFUND_PENDING' : current.source === 'REMOTE' ? 'AWAITING_ACCEPTANCE' : 'PREPARING',
        acceptanceDeadline: !requiresRefund && current.source === 'REMOTE' ? new Date(Date.now()+180000) : null,
      })
      .where(eq(merchantOrder.id, orderId))
    if (!requiresRefund && current.source !== 'REMOTE')
      await earnLoyalty(
        tx as unknown as Db,
        current,
        attempt.snapshot.revision,
        attempt.snapshot.totalMinor,
      )
    if(!requiresRefund) await releaseSiblingOrderStock(tx as unknown as Db,orderId,attempt.quote.id)
    if(!requiresRefund && current.source!=='REMOTE') await consumeOrderStock(tx as unknown as Db,current,attempt.quote.id)
    if(requiresRefund) await releaseOrderStock(tx as unknown as Db,orderId)
    if (requiresRefund)
      await tx
        .insert(merchantRefund)
        .values({
          orderId,
          reason:
            'Payment arrived after quote expiry or for a cancelled or superseded checkout',
        })
        .onConflictDoNothing({ target: merchantRefund.orderId })
  })
}
/** Refund amount/asset/addresses are frozen in each owner authorization, never FX. */
export async function reconcileMerchantRefund(
  db: Db,
  gateway: MerchantPaymentGateway,
  orderId: string,
) {
  const [refund] = await db
    .select()
    .from(merchantRefund)
    .where(eq(merchantRefund.orderId, orderId))
  if (!refund || refund.status !== 'APPROVED') return
  const found = await findVerifiedAttempt(db, gateway, orderId, 'REFUND')
  if (!found) return
  const { attempt, payment } = found
  await db.transaction(async (tx) => {
    await tx
      .select()
      .from(merchantOrder)
      .where(eq(merchantOrder.id, orderId))
      .for('update')
    const [current] = await tx
      .select()
      .from(merchantRefund)
      .where(eq(merchantRefund.id, refund.id))
    if (current.status === 'CONFIRMED') return
    if (current.status !== 'APPROVED') return fail(409, 'STALE_QUOTE')
    await record(tx as unknown as Db, orderId, 'REFUND', payment)
    await tx
      .update(merchantRefund)
      .set({
        status: 'CONFIRMED',
        quote: attempt.quote,
        pendingHash: attempt.hash,
      })
      .where(eq(merchantRefund.id, refund.id))
    await tx
      .update(merchantOrder)
      .set({ status: 'REFUNDED' })
      .where(eq(merchantOrder.id, orderId))
    await refundLoyalty(tx as unknown as Db, orderId)
  })
}
export async function merchantReconciliationTick(
  db: Db,
  gateway: MerchantPaymentGateway,
) {
  await remoteAcceptanceTick(db)
  const payments = await db
    .select({ id: merchantOrder.id })
    .from(merchantOrder)
    .where(
      and(
        eq(merchantOrder.status, 'PAYMENT_PENDING'),
        isNotNull(merchantOrder.pendingPaymentHash),
      ),
    )
  const refunds = await db
    .select({ orderId: merchantRefund.orderId })
    .from(merchantRefund)
    .where(
      and(
        eq(merchantRefund.status, 'APPROVED'),
        isNotNull(merchantRefund.pendingHash),
      ),
    )
  const results: {
    orderId: string
    error: string
  }[] = []
  for (const order of payments) {
    try {
      await reconcileMerchantPayment(db, gateway, order.id)
    } catch (err) {
      results.push({ orderId: order.id, error: (err as Error).message })
    }
  }
  for (const refund of refunds) {
    try {
      await reconcileMerchantRefund(db, gateway, refund.orderId)
    } catch (err) {
      results.push({ orderId: refund.orderId, error: (err as Error).message })
    }
  }
  return results
}
export function startMerchantReconciliation(
  db: Db,
  gateway: MerchantPaymentGateway,
  intervalMs = 5000,
  onError?: (err: unknown) => void,
) {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      const failures = await merchantReconciliationTick(db, gateway)
      if (failures.length) onError?.(failures)
    } catch (err) {
      onError?.(err)
    } finally {
      running = false
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
