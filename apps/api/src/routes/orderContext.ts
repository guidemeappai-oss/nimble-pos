import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OrderContextSummary, OrderContextEntry, OrderContextResult } from '@nimble/shared';
import * as s from '../db/schema';
import type { Db } from '../db/client';
import type { MerchantTaskHelpers } from './tasks';
import { taskActorKey } from './tasks';
import { loyaltyFail as fail } from '../services/loyalty';
const uuid = z.string().uuid(), priority = z.enum(['NORMAL', 'HIGH']);
const inputSchema = z.object({ revision: z.number().int().min(0).max(2147483646), idempotencyKey: uuid, kind: z.enum(['NOTE', 'PRIORITY', 'DELAY']), text: z.string().trim().min(3).max(1000), priority: priority.optional() }).strict().superRefine((v, c) => { if ((v.kind === 'PRIORITY') !== (v.priority !== undefined))
    c.addIssue({ code: z.ZodIssueCode.custom, message: 'priority belongs to PRIORITY entries only', path: ['priority'] }); });
const empty = (orderId: string): OrderContextSummary => ({ orderId, revision: 0, priority: 'NORMAL', delayReason: null });
export async function orderContextRoutes(app: FastifyInstance, h: MerchantTaskHelpers) {
    const db = app.deps.db, base = '/v1/merchant/venues/:venueId';
    async function context(req: FastifyRequest) { const a = await h.actor(req), p = req.params as Record<string, string>, venueId = uuid.parse(p.venueId); await h.venueFor(a, venueId); return { a, venueId, orderId: p.orderId ? uuid.parse(p.orderId) : null }; }
    async function checkOrder(store: Db, venueId: string, orderId: string, lock = false) { const q = store.select({ id: s.merchantOrder.id }).from(s.merchantOrder).where(and(eq(s.merchantOrder.id, orderId), eq(s.merchantOrder.venueId, venueId))); const [row] = await (lock ? q.for('update') : q); if (!row)
        fail(404, 'NOT_FOUND'); }
    app.get(base + '/order-context', async (req) => {
        const { venueId } = await context(req), q = z.object({ orderIds: z.string().transform(x => x.split(',')).pipe(z.array(uuid).min(1).max(50)) }).strict().parse(req.query), ids = [...new Set(q.orderIds)];
        const orders = await db.select({ id: s.merchantOrder.id }).from(s.merchantOrder).where(and(eq(s.merchantOrder.venueId, venueId), inArray(s.merchantOrder.id, ids)));
        if (orders.length !== ids.length)
            fail(404, 'NOT_FOUND');
        const rows = await db.select().from(s.merchantOrderContext).where(inArray(s.merchantOrderContext.orderId, ids)), map = new Map(rows.map(r => [r.orderId, r]));
        return { items: ids.map(id => map.get(id) ?? empty(id)) };
    });
    app.get(base + '/orders/:orderId/context', async (req) => {
        const { venueId, orderId } = await context(req), q = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(req.query);
        return db.transaction(async (tx) => {
            await checkOrder(tx as unknown as Db, venueId, orderId!, true);
            const [summary] = await tx.select().from(s.merchantOrderContext).where(eq(s.merchantOrderContext.orderId, orderId!));
            const rows = await tx.select().from(s.merchantOrderContextEntry).where(eq(s.merchantOrderContextEntry.orderId, orderId!)).orderBy(desc(s.merchantOrderContextEntry.revision)).offset(q.page * q.limit).limit(q.limit + 1);
            return { summary: summary ?? empty(orderId!), entries: rows.slice(0, q.limit).map(r => r.response.entry), hasMore: rows.length > q.limit };
        });
    });
    app.post(base + '/orders/:orderId/context', async (req) => {
        const { a, venueId, orderId } = await context(req), input = inputSchema.parse(req.body), actor = taskActorKey(a), hash = createHash('sha256').update(JSON.stringify({ venueId, orderId, ...input })).digest('hex');
        return db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${actor + input.idempotencyKey}))`);
            await checkOrder(tx as unknown as Db, venueId, orderId!);
            const [old] = await tx.select().from(s.merchantOrderContextEntry).where(and(eq(s.merchantOrderContextEntry.actor, actor), eq(s.merchantOrderContextEntry.key, input.idempotencyKey)));
            if (old) {
                if (old.requestHash !== hash)
                    fail(409, 'IDEMPOTENCY_CONFLICT');
                return old.response;
            }
            // Closing a shift takes this same row lock; an edit cannot commit after a completed close.
            if (a.kind === 'cashier') {
                const [shift] = await tx.select().from(s.merchantShift).where(and(eq(s.merchantShift.employeeId, a.employeeId), eq(s.merchantShift.venueId, venueId), isNull(s.merchantShift.closedAt))).for('update');
                if (!shift)
                    fail(409, 'SHIFT_REQUIRED');
            }
            await checkOrder(tx as unknown as Db, venueId, orderId!, true);
            const [stored] = await tx.select().from(s.merchantOrderContext).where(eq(s.merchantOrderContext.orderId, orderId!));
            const before: OrderContextSummary = stored ?? empty(orderId!);
            if (before.revision !== input.revision)
                fail(409, 'ORDER_CONTEXT_CONFLICT');
            const summary: OrderContextSummary = { ...before, revision: before.revision + 1, ...(input.kind === 'PRIORITY' ? { priority: input.priority! } : {}), ...(input.kind === 'DELAY' ? { delayReason: input.text } : {}) };
            const entry: OrderContextEntry = { id: randomUUID(), kind: input.kind, text: input.text, ...(input.kind === 'PRIORITY' ? { priority: input.priority! } : {}), actor: { kind: a.kind, id: a.kind === 'owner' ? a.userId : a.employeeId, name: a.kind === 'owner' ? 'Owner' : a.name ?? 'Employee' }, createdAt: new Date().toISOString() };
            const result: OrderContextResult = { summary, entry };
            await tx.insert(s.merchantOrderContext).values(summary).onConflictDoUpdate({ target: s.merchantOrderContext.orderId, set: summary });
            await tx.insert(s.merchantOrderContextEntry).values({ id: entry.id, orderId: orderId!, revision: summary.revision, actor, key: input.idempotencyKey, requestHash: hash, response: result, createdAt: new Date(entry.createdAt) });
            await h.audit(tx as unknown as Db, a, venueId, 'order.context.' + input.kind.toLowerCase(), input.text, before, { ...summary, entryId: entry.id });
            return result;
        });
    });
}
