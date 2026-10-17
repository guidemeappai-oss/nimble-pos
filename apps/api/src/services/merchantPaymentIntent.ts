import {and,eq,gt,sql} from 'drizzle-orm';
import type {Db} from '../db/client';
import * as schema from '../db/schema';
import {pinOrderStock} from './stockReservations';
import {loyaltyFail as fail} from './loyalty';
export async function submitAttempt(
    store: Db,
    values: typeof schema.merchantTransferAttempt.$inferInsert,
  ) {
    const [existing] = await store
      .select()
      .from(schema.merchantTransferAttempt)
      .where(
        and(
          eq(schema.merchantTransferAttempt.orderId, values.orderId),
          eq(schema.merchantTransferAttempt.purpose, values.purpose),
          eq(schema.merchantTransferAttempt.hash, values.hash),
          eq(schema.merchantTransferAttempt.quoteId, values.quoteId),
        ),
      )
    const [{ count }] = await store
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.merchantTransferAttempt)
      .where(
        and(
          eq(schema.merchantTransferAttempt.orderId, values.orderId),
          eq(schema.merchantTransferAttempt.purpose, values.purpose),
          gt(
            schema.merchantTransferAttempt.createdAt,
            new Date(Date.now() - 60000),
          ),
        ),
      )
    if (!existing && count >= 5) return fail(429, 'TRANSFER_ATTEMPTS_THROTTLED')
    if (existing)
      await store
        .update(schema.merchantTransferAttempt)
        .set({ nextCheckAt: new Date() })
        .where(eq(schema.merchantTransferAttempt.id, existing.id))
    else await store.insert(schema.merchantTransferAttempt).values(values)
  }

export async function submitMerchantPaymentIntent(store:Db,o:typeof schema.merchantOrder.$inferSelect,input:{revision:number;quoteId:string;hash:string}){
      if (o.payment) {
        if (o.payment.hash.toLowerCase() === input.hash.toLowerCase()) return o
        return fail(409, 'ALREADY_PAID')
      }
      // An expired quote can still have an in-flight transfer. Retain every
      // quoted amount, then freeze the first submitted intent for reconciliation.
      const submittedQuote = [o.quote, ...o.quoteHistory].find(
        (q) => q?.id === input.quoteId,
      )
      if (
        !submittedQuote ||
        submittedQuote.reference !== `nimble-order:${o.id}:${input.revision}`
      )
        return fail(409, 'STALE_QUOTE')
      if (
        !['AWAITING_PAYMENT', 'PAYMENT_PENDING', 'CANCELLED'].includes(o.status)
      )
        return fail(409, 'INVALID_STATE')
      const [snapshot] = await store
        .select()
        .from(schema.merchantOrderRevision)
        .where(
          and(
            eq(schema.merchantOrderRevision.orderId, o.id),
            eq(schema.merchantOrderRevision.revision, input.revision),
          ),
        )
      if (!snapshot) return fail(409, 'STALE_QUOTE')
      await pinOrderStock(store as unknown as Db,o,submittedQuote.id,input.revision)
      await submitAttempt(store as unknown as Db, {
        orderId: o.id,
        purpose: 'PAYMENT',
        hash: input.hash.toLowerCase(),
        quoteId: submittedQuote.id,
        quote: submittedQuote,
        snapshot: { ...snapshot.snapshot, revision: input.revision },
        requiresRefund:
          !!o.cancelledAt ||
          o.status === 'CANCELLED' ||
          o.revision !== input.revision,
      })
      // Keep the first unknown intent locked; additional hashes are verified independently.
      if (o.pendingPaymentHash) return o
      const [updated] = await store
        .update(schema.merchantOrder)
        .set({
          paymentSnapshot: { ...snapshot.snapshot, revision: input.revision },
          paymentRequiresRefund:
            !!o.cancelledAt ||
            o.status === 'CANCELLED' ||
            o.revision !== input.revision,
          status: 'PAYMENT_PENDING',
          quote: submittedQuote,
          quoteHistory:
            o.quote &&
            o.quote.id !== submittedQuote.id &&
            !o.quoteHistory.some((q) => q.id === o.quote!.id)
              ? [...o.quoteHistory, o.quote]
              : o.quoteHistory,
          pendingPaymentHash: input.hash.toLowerCase(),
        })
        .where(eq(schema.merchantOrder.id, o.id))
        .returning()
      return updated

}
