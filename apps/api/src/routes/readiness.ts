import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as s from '../db/schema';
import type { Db } from '../db/client';
import type { MerchantTaskHelpers } from './tasks';
import { taskActorKey } from './tasks';
import { loyaltyFail as fail } from '../services/loyalty';
import { orderReadiness, changeOrderReadiness } from '../services/orderReadiness';
const uuid = z.string().uuid(), integer = z.number().int().min(0).max(2147483646);
export async function readinessRoutes(app: FastifyInstance, h: MerchantTaskHelpers) {
    const db = app.deps.db, url = '/v1/merchant/venues/:venueId/orders/:orderId/readiness';
    async function context(req: FastifyRequest) { const a = await h.actor(req), p = req.params as Record<string, string>, venueId = uuid.parse(p.venueId), orderId = uuid.parse(p.orderId); await h.venueFor(a, venueId); return { a, venueId, orderId }; }
    async function order(store: Db, venueId: string, orderId: string, lock = false) { const q = store.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id, orderId), eq(s.merchantOrder.venueId, venueId))); const [o] = await (lock ? q.for('update') : q); if (!o)
        fail(404, 'NOT_FOUND'); return o; }
    app.get(url, async (req) => { const { venueId, orderId } = await context(req); return db.transaction(async (tx) => orderReadiness(tx as unknown as Db, await order(tx as unknown as Db, venueId, orderId, true))); });
    app.post(url, async (req) => {
        const { a, venueId, orderId } = await context(req);
        if (a.kind !== 'cashier')
            return fail(403, 'CASHIER_REQUIRED');
        const input = z.object({ revision: integer, cartRevision: integer, idempotencyKey: uuid, lineIndex: integer, readyQuantity: integer }).strict().parse(req.body), actor = taskActorKey(a), hash = createHash('sha256').update(JSON.stringify({ venueId, orderId, ...input })).digest('hex');
        return db.transaction(async (raw) => {
            const tx = raw as unknown as Db;
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${actor + input.idempotencyKey}))`);
            await order(tx, venueId, orderId);
            const [old] = await tx.select().from(s.merchantReadinessRequest).where(and(eq(s.merchantReadinessRequest.actor, actor), eq(s.merchantReadinessRequest.key, input.idempotencyKey)));
            if (old) {
                if (old.requestHash !== hash)
                    fail(409, 'IDEMPOTENCY_CONFLICT');
                return old.response;
            }
            const [shift] = await tx.select().from(s.merchantShift).where(and(eq(s.merchantShift.venueId, venueId), eq(s.merchantShift.employeeId, a.employeeId), isNull(s.merchantShift.closedAt))).for('update');
            if (!shift)
                fail(409, 'SHIFT_REQUIRED');
            const o = await order(tx, venueId, orderId, true), before = await orderReadiness(tx, o);
            if (before.cartRevision !== input.cartRevision)
                fail(409, 'STALE_REVISION');
            if (before.revision !== input.revision)
                fail(409, 'READINESS_CONFLICT');
            if (!before.lines[input.lineIndex])
                fail(400, 'INVALID_LINE');
            const quantities = before.lines.map(l => l.readyQuantity);
            quantities[input.lineIndex] = input.readyQuantity;
            const result = await changeOrderReadiness(tx, o, quantities);
            await tx.insert(s.merchantReadinessRequest).values({ actor, key: input.idempotencyKey, orderId, requestHash: hash, response: result });
            await h.audit(tx, a, venueId, 'order.readiness.updated', 'Preparation progress', before, result);
            return result;
        });
    });
}
