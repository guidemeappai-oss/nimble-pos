import { eq } from 'drizzle-orm';
import type { OrderReadiness, MerchantOrderStatus } from '@nimble/shared';
import * as s from '../db/schema';
import type { Db } from '../db/client';
import { env } from '../env';
import { loyaltyFail as fail } from './loyalty';
export type ReadinessOrder = typeof s.merchantOrder.$inferSelect;
export async function orderReadiness(store: Db, o: ReadinessOrder): Promise<OrderReadiness> {
    const [saved] = await store.select().from(s.merchantOrderReadiness).where(eq(s.merchantOrderReadiness.orderId, o.id));
    const lines = (o.paymentSnapshot?.lines ?? o.lines).map((line, lineIndex) => ({ lineIndex, quantity: line.quantity, readyQuantity: saved?.quantities[lineIndex] ?? (['READY', 'COLLECTED'].includes(o.status) ? line.quantity : 0) }));
    return { orderId: o.id, revision: saved?.revision ?? 0, cartRevision: o.paymentSnapshot?.revision ?? o.revision, status: o.status as MerchantOrderStatus, lines, allReady: lines.length > 0 && lines.every(l => l.readyQuantity === l.quantity) };
}
/** Caller holds the order row lock. This is the sole partial/mark-all readiness writer. */
export async function changeOrderReadiness(store: Db, o: ReadinessOrder, quantities: number[]) {
    const before = await orderReadiness(store, o);
    if (o.status !== 'PREPARING')
        fail(409, 'INVALID_STATE');
    if (quantities.length !== before.lines.length || quantities.some((q, i) => !Number.isInteger(q) || q < 0 || q > before.lines[i].quantity))
        fail(400, 'INVALID_READY_QUANTITY');
    const allReady = quantities.length > 0 && quantities.every((q, i) => q === before.lines[i].quantity);
    await store.insert(s.merchantOrderReadiness).values({ orderId: o.id, revision: before.revision + 1, quantities }).onConflictDoUpdate({ target: s.merchantOrderReadiness.orderId, set: { revision: before.revision + 1, quantities } });
    if (allReady) {
        await store.update(s.merchantOrder).set({ status: 'READY' }).where(eq(s.merchantOrder.id, o.id));
        if (o.notificationAddress)
            await store.insert(s.merchantNotificationOutbox).values({ orderId: o.id, recipient: o.notificationAddress, network: env.nimiqNetwork === 'MainAlbatross' ? 'nimiq:24' : 'nimiq:5' }).onConflictDoNothing({ target: s.merchantNotificationOutbox.orderId });
    }
    return orderReadiness(store, { ...o, status: allReady ? 'READY' : o.status });
}
