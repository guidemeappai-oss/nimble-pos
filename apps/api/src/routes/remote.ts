import { effectiveCatalog } from '../services/menuSchedule'
import {orderReadiness} from '../services/orderReadiness'
import { consumeOrderStock, releaseOrderStock, orderStockValid } from '../services/stockReservations'
import { remoteQueueCount } from '../services/remoteQueue'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  MerchantOrderInput,
  priceMerchantCart,
  type MerchantOrder,
  type RemoteVenue,
} from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { env } from '../env'
import { loyaltyFail as fail, earnLoyalty } from '../services/loyalty'
import {
  pickupSecret,
  pickupToken,
  rejectRemote,
} from '../services/remoteOrders'
type Actor =
  | {
      kind: 'owner'
      userId: string
    }
  | {
      kind: 'cashier'
      employeeId: string
      venueId: string
      sessionId: string
    }
type Helpers = {
  actor: (req: FastifyRequest) => Promise<Actor>
  venueFor: (
    a: Actor,
    id: string,
    ownerOnly?: boolean,
    store?: Db,
  ) => Promise<typeof s.merchantVenue.$inferSelect>
  view: (
    o: typeof s.merchantOrder.$inferSelect,
    db?: Db,
  ) => Promise<MerchantOrder>
}
const uuid = z.string().uuid()
const params = (r: FastifyRequest) => r.params as Record<string, string>
const settings = z
  .object({
    published: z.boolean(),
    description: z.string().trim().max(400),
    address: z.string().trim().max(200),
    city: z.string().trim().max(100),
    pickupInstructions: z.string().trim().max(400),
    preparationMinutes: z.number().int().min(1).max(180),
    queueLimit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
const settingsView = (v: typeof s.merchantVenue.$inferSelect) => ({
  published: v.remotePublished,
  description: v.remoteDescription,
  address: v.remoteAddress,
  city: v.remoteCity,
  pickupInstructions: v.remotePickupInstructions,
  preparationMinutes: v.remotePreparationMinutes,
  queueLimit: v.remoteQueueLimit,
})
export async function remoteRoutes(app: FastifyInstance, h: Helpers) {
  const { db } = app.deps,
    base = '/v1/merchant/remote'
  const actor = h.actor
  const enabled = () => {
    if (!env.remoteOrderingEnabled) return fail(404, 'REMOTE_ORDERING_DISABLED')
  }
  const customer = async (req: FastifyRequest) => {
    const a = await actor(req)
    if (a.kind !== 'owner') return fail(403, 'CUSTOMER_REQUIRED')
    return a.userId
  }
  const own = async (req: FastifyRequest, tx: Db = db, lock = false) => {
    const u = await customer(req)
    const q = tx
      .select()
      .from(s.merchantOrder)
      .where(
        and(
          eq(s.merchantOrder.id, uuid.parse(params(req).orderId)),
          eq(s.merchantOrder.payerUserId, u),
          eq(s.merchantOrder.source, 'REMOTE'),
        ),
      )
    const [o] = await (lock ? q.for('update') : q)
    if (!o) return fail(404, 'NOT_FOUND')
    return o
  }
  const staff = async (req: FastifyRequest, tx: Db = db) => {
    const a = await actor(req)
    if (a.kind !== 'cashier') return fail(403, 'CASHIER_REQUIRED')
    const [shift] = await tx
      .select()
      .from(s.merchantShift)
      .where(
        and(
          eq(s.merchantShift.employeeId, a.employeeId),
          isNull(s.merchantShift.closedAt),
        ),
      )
      .for('update')
    if (!shift) return fail(409, 'SHIFT_REQUIRED')
    return { ...a, shiftId: shift.id }
  }
  const publicVenue = async (
    v: typeof s.merchantVenue.$inferSelect,
    store: Db = db,
  ): Promise<RemoteVenue> => {
    const activeOrders = await remoteQueueCount(store, v.id)
    const [shift] = await store
      .select({ id: s.merchantShift.id })
      .from(s.merchantShift)
      .where(
        and(
          eq(s.merchantShift.venueId, v.id),
          isNull(s.merchantShift.closedAt),
        ),
      )
      .limit(1)
    const reason = !env.remoteOrderingEnabled
      ? 'DISABLED'
      : !v.remoteAccepting
        ? 'PAUSED'
        : v.remotePausedUntil && v.remotePausedUntil > new Date()
          ? 'PAUSED'
          : activeOrders >= v.remoteQueueLimit
            ? 'BUSY'
        : !shift ||
            !v.remoteHeartbeatAt ||
            Date.now() - v.remoteHeartbeatAt.getTime() > 60000
          ? 'TERMINAL_OFFLINE'
          : null
    return {
      ...settingsView(v),
      pausedUntil: v.remotePausedUntil?.toISOString() ?? null,
      activeOrders,
      id: v.id,
      name: v.name,
      fiatCurrency: v.fiatCurrency as RemoteVenue['fiatCurrency'],
      accepting: v.remoteAccepting,
      available: reason === null,
      unavailableReason: reason,
    }
  }
  const ownView = async (
    o: typeof s.merchantOrder.$inferSelect,
    tx: Db = db,
  ) => {
    const [venue] = await tx
      .select()
      .from(s.merchantVenue)
      .where(eq(s.merchantVenue.id, o.venueId))
    return {
      ...(await h.view(o, tx)),
      venue: await publicVenue(venue, tx),
      pickup:
        o.pickupNonce &&
        o.pickupCode &&
        ['PREPARING', 'READY'].includes(o.status)
          ? { token: pickupToken(o), code: o.pickupCode }
          : null,
    }
  }
  app.get(`${base}/venues`, async (req) => {
    enabled()
    const q = z
      .object({
        q: z.string().trim().max(100).default(''),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query)
    const rows = await db
      .select()
      .from(s.merchantVenue)
      .where(
        and(
          eq(s.merchantVenue.remotePublished, true),
          q.q
            ? or(
                ilike(s.merchantVenue.name, `%${q.q}%`),
                ilike(s.merchantVenue.remoteCity, `%${q.q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(s.merchantVenue.name), asc(s.merchantVenue.id))
      .limit(21)
      .offset((q.page - 1) * 20)
    return {
      venues: await Promise.all(rows.slice(0, 20).map((v) => publicVenue(v))),
      page: q.page,
      hasMore: rows.length > 20,
    }
  })
  app.get(`${base}/venues/:venueId`, async (req) => {
    enabled()
    const [v] = await db
      .select()
      .from(s.merchantVenue)
      .where(
        and(
          eq(s.merchantVenue.id, uuid.parse(params(req).venueId)),
          eq(s.merchantVenue.remotePublished, true),
        ),
      )
    if (!v) return fail(404, 'NOT_FOUND')
    const products = await db
      .select()
      .from(s.merchantProduct)
      .where(eq(s.merchantProduct.venueId, v.id))
    return {
      venue: await publicVenue(v),
      products: await effectiveCatalog(db,v.id,products.map((p) => p.catalog)),
    }
  })
  app.get(`${base}/venues/:venueId/settings`, async (req) =>
    settingsView(
      await h.venueFor(await h.actor(req), params(req).venueId, true),
    ),
  )
  app.patch(`${base}/venues/:venueId/settings`, async (req) => {
    enabled()
    const v = await h.venueFor(await h.actor(req), params(req).venueId, true),
      i = settings.parse(req.body)
    if (i.published && (!i.address || !i.city))
      return fail(400, 'VENUE_ADDRESS_REQUIRED')
    const [u] = await db
      .update(s.merchantVenue)
      .set({
        remotePublished: i.published,
        remoteDescription: i.description,
        remoteAddress: i.address,
        remoteCity: i.city,
        remotePickupInstructions: i.pickupInstructions,
        remotePreparationMinutes: i.preparationMinutes,
        remoteQueueLimit: i.queueLimit ?? v.remoteQueueLimit,
      })
      .where(eq(s.merchantVenue.id, v.id))
      .returning()
    return settingsView(u)
  })
  app.post(`${base}/venues/:venueId/heartbeat`, async (req) => {
    enabled()
    return db.transaction(async (raw) => {
      const tx = raw as unknown as Db,
        a = await staff(req, tx)
      if (a.venueId !== params(req).venueId) return fail(404, 'NOT_FOUND')
      const [v] = await tx
        .update(s.merchantVenue)
        .set({ remoteHeartbeatAt: new Date() })
        .where(eq(s.merchantVenue.id, a.venueId))
        .returning()
      return publicVenue(v, tx)
    })
  })
  app.patch(`${base}/venues/:venueId/availability`, async (req) => {
    enabled()
    return db.transaction(async (raw) => {
      const tx = raw as unknown as Db,
        a = await staff(req, tx),
        i = z.object({ accepting: z.boolean(), pauseMinutes: z.number().int().min(1).max(240).optional() }).strict().parse(req.body)
      if (a.venueId !== params(req).venueId) return fail(404, 'NOT_FOUND')
      const [current] = await tx.select().from(s.merchantVenue).where(eq(s.merchantVenue.id, a.venueId)).for('update')
      if (i.accepting) {
        const [open] = await tx.select({ id: s.merchantShift.id }).from(s.merchantShift).where(and(eq(s.merchantShift.venueId, current.id), isNull(s.merchantShift.closedAt))).limit(1)
        if (!open) return fail(409, 'SHIFT_REQUIRED')
        if (!current.remoteHeartbeatAt || Date.now() - current.remoteHeartbeatAt.getTime() > 60000) return fail(409, 'TERMINAL_OFFLINE')
        if (current.remotePausedUntil && current.remotePausedUntil > new Date()) return fail(409, 'PAUSE_NOT_EXPIRED')
      }
      const now = new Date()
      const [v] = await tx.update(s.merchantVenue).set({
        remoteAccepting: i.accepting,
        remotePausedUntil: i.accepting
          ? null
          : i.pauseMinutes
            ? new Date(now.getTime() + i.pauseMinutes * 60000)
            : current.remotePausedUntil && current.remotePausedUntil > now
              ? current.remotePausedUntil
              : null,
      }).where(eq(s.merchantVenue.id, a.venueId)).returning()
      return publicVenue(v, tx)
    })
  })
  app.post(`${base}/venues/:venueId/orders`, async (req, reply) => {
    enabled()
    const userId = await customer(req),
      venueId = uuid.parse(params(req).venueId),
      input = MerchantOrderInput.parse(req.body),
      key = z.string().min(1).max(128).parse(req.headers['idempotency-key']),
      hash = createHash('sha256')
        .update(JSON.stringify([venueId, input]))
        .digest('hex')
    const o = await db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`remote-customer:${userId}`},0))`,
      )
      const [prior] = await tx
        .select()
        .from(s.merchantOrder)
        .where(
          and(
            eq(s.merchantOrder.payerUserId, userId),
            eq(s.merchantOrder.source, 'REMOTE'),
            eq(s.merchantOrder.requestKey, key),
          ),
        )
      if (prior) {
        if (prior.requestHash !== hash) return fail(409, 'IDEMPOTENCY_CONFLICT')
        return prior
      }
      const [v] = await tx
        .select()
        .from(s.merchantVenue)
        .where(eq(s.merchantVenue.id, venueId))
        .for('update')
      if (!v?.remotePublished) return fail(404, 'NOT_FOUND')
      const availability = await publicVenue(v, tx)
      if (!availability.available)
        return fail(409, availability.unavailableReason === 'BUSY' ? 'VENUE_BUSY' : 'VENUE_UNAVAILABLE')
      const [limits] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.merchantOrder)
        .where(
          and(
            eq(s.merchantOrder.payerUserId, userId),
            eq(s.merchantOrder.source, 'REMOTE'),
            inArray(s.merchantOrder.status, [
              'AWAITING_PAYMENT',
              'PAYMENT_PENDING',
              'AWAITING_ACCEPTANCE',
            ]),
          ),
        )
      if (limits.count >= 3) return fail(429, 'TOO_MANY_OPEN_ORDERS')
      const [recent] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.merchantOrder)
        .where(
          and(
            eq(s.merchantOrder.payerUserId, userId),
            gt(s.merchantOrder.createdAt, new Date(Date.now() - 60000)),
          ),
        )
      if (recent.count >= 10) return fail(429, 'RATE_LIMITED')
      const products = await tx
        .select()
        .from(s.merchantProduct)
        .where(eq(s.merchantProduct.venueId, v.id))
      let cart
      try {
        cart = priceMerchantCart(
          await effectiveCatalog(tx,v.id,products.map((p) => p.catalog),new Date(),true),
          input.lines,
        )
      } catch (e) {
        return fail(409, (e as Error).message)
      }
      await tx
        .update(s.merchantVenue)
        .set({ nextOrderNumber: v.nextOrderNumber + 1 })
        .where(eq(s.merchantVenue.id, v.id))
      const [o] = await tx
        .insert(s.merchantOrder)
        .values({
          venueId: v.id,
          payerUserId: userId,
          source: 'REMOTE',
          number: v.nextOrderNumber,
          fiatCurrency: v.fiatCurrency,
          ...cart,
          checkoutToken: pickupSecret(),
          requestKey: key,
          requestHash: hash,
        })
        .returning()
      await tx
        .insert(s.merchantOrderRevision)
        .values({ orderId: o.id, revision: 1, snapshot: cart })
      return o
    })
    return reply.code(201).send(await ownView(o))
  })
  app.get(`${base}/orders`, async (req) => {
    const u = await customer(req)
    const rows = await db
      .select()
      .from(s.merchantOrder)
      .where(
        and(
          eq(s.merchantOrder.payerUserId, u),
          eq(s.merchantOrder.source, 'REMOTE'),
        ),
      )
      .orderBy(desc(s.merchantOrder.createdAt))
      .limit(100)
    return Promise.all(rows.map((o) => ownView(o)))
  })
  app.get(`${base}/orders/:orderId`, async (req) => ownView(await own(req)))
  app.post(`${base}/orders/:orderId/cancel`, async (req) =>
    db.transaction(async (raw) => {
      const tx = raw as unknown as Db,
        o = await own(req, tx, true)
      if (o.status === 'CANCELLED') return ownView(o, tx)
      if (o.status !== 'AWAITING_PAYMENT' || o.pendingPaymentHash)
        return fail(409, 'ORDER_LOCKED')
      await releaseOrderStock(tx,o.id)
      const [u] = await tx
        .update(s.merchantOrder)
        .set({ status: 'CANCELLED', cancelledAt: new Date() })
        .where(eq(s.merchantOrder.id, o.id))
        .returning()
      return ownView(u, tx)
    }),
  )
  for (const action of ['accept', 'reject'] as const)
    app.post(`${base}/orders/:orderId/${action}`, async (req) =>
      db.transaction(async (raw) => {
        const tx = raw as unknown as Db,
          a = await staff(req, tx)
        const [o] = await tx
          .select()
          .from(s.merchantOrder)
          .where(
            and(
              eq(s.merchantOrder.id, uuid.parse(params(req).orderId)),
              eq(s.merchantOrder.venueId, a.venueId),
              eq(s.merchantOrder.source, 'REMOTE'),
            ),
          )
          .for('update')
        if (!o) return fail(404, 'NOT_FOUND')
        if (o.decision === (action === 'accept' ? 'ACCEPTED' : 'REJECTED'))
          return h.view(o, tx)
        if (o.status !== 'AWAITING_ACCEPTANCE' || !o.payment)
          return fail(409, 'INVALID_STATE')
        if (
          !o.acceptanceDeadline ||
          o.acceptanceDeadline.getTime() <= Date.now()
        ) {
          const u = await rejectRemote(
            tx,
            o,
            'The venue did not respond before the acceptance deadline',
            'TIMED_OUT',
          )
          return h.view(u, tx)
        }
        if (action === 'reject') {
          const { reason } = z
            .object({ reason: z.string().trim().min(1).max(400) })
            .strict()
            .parse(req.body)
          return h.view(
            await rejectRemote(tx, o, reason, 'REJECTED', {
              employeeId: a.employeeId,
              shiftId: a.shiftId,
            }),
            tx,
          )
        }
        if (!(await orderStockValid(tx,o,o.quote!.id,o.paymentSnapshot!.revision,o.paymentSnapshot!.lines)))
          return h.view(await rejectRemote(tx,o,'Stock reservation is missing or expired','REJECTED',{employeeId:a.employeeId,shiftId:a.shiftId}),tx)
        const { preparationMinutes } = z
          .object({ preparationMinutes: z.number().int().min(1).max(180) })
          .strict()
          .parse(req.body)
        let code = ''
        for (let attempt = 0; attempt < 20; attempt++) {
          code = randomInt(100000, 1000000).toString()
          const [used] = await tx
            .select({ id: s.merchantOrder.id })
            .from(s.merchantOrder)
            .where(
              and(
                eq(s.merchantOrder.venueId, o.venueId),
                eq(s.merchantOrder.pickupCode, code),
                inArray(s.merchantOrder.status, ['PREPARING', 'READY']),
              ),
            )
          if (!used) break
          if (attempt === 19) return fail(503, 'PICKUP_CODE_UNAVAILABLE')
        }
        const [u] = await tx
          .update(s.merchantOrder)
          .set({
            status: 'PREPARING',
            employeeId: a.employeeId,
            shiftId: a.shiftId,
            decision: 'ACCEPTED',
            decisionAt: new Date(),
            preparationMinutes,
            pickupNonce: pickupSecret(),
            pickupCode: code,
          })
          .where(eq(s.merchantOrder.id, o.id))
          .returning()
        await earnLoyalty(
          tx,
          o,
          o.paymentSnapshot!.revision,
          o.paymentSnapshot!.totalMinor,
        )
        await consumeOrderStock(tx,u,o.quote!.id)
        return h.view(u, tx)
      }),
    )
  const attempts = new Map<
    string,
    {
      count: number
      since: number
    }
  >()
  async function pickup(
    req: FastifyRequest,
    tx: Db,
    venueId: string,
    lock = false,
  ) {
    const a = await staff(req, tx)
    if (a.venueId !== venueId) return fail(404, 'NOT_FOUND')
    const key = a.sessionId,
      now = Date.now()
    let budget = attempts.get(key)
    if (!budget || now - budget.since > 60000) {
      budget = { count: 0, since: now }
      attempts.set(key, budget)
    }
    if (++budget.count > 20) return fail(429, 'RATE_LIMITED')
    if (attempts.size > 10000)
      for (const [k, b] of attempts)
        if (now - b.since > 60000) attempts.delete(k)
    const { tokenOrCode } = z
      .object({ tokenOrCode: z.string().trim().min(6).max(160) })
      .strict()
      .parse(req.body)
    let orderId: string | undefined
    if (tokenOrCode.startsWith('nimble-pickup:')) {
      const match = /^nimble-pickup:([0-9a-f-]{36}):[A-Za-z0-9_-]{43}$/.exec(
        tokenOrCode,
      )
      if (!match) return fail(404, 'PICKUP_NOT_FOUND')
      orderId = uuid.parse(match[1])
    } else if (!/^\d{6}$/.test(tokenOrCode))
      return fail(404, 'PICKUP_NOT_FOUND')
    const q = tx
      .select()
      .from(s.merchantOrder)
      .where(
        and(
          eq(s.merchantOrder.venueId, venueId),
          eq(s.merchantOrder.source, 'REMOTE'),
          orderId
            ? eq(s.merchantOrder.id, orderId)
            : and(
                eq(s.merchantOrder.pickupCode, tokenOrCode),
                inArray(s.merchantOrder.status, ['PREPARING', 'READY']),
              ),
        ),
      )
    const [o] = await (lock ? q.for('update') : q)
    if (!o || !o.pickupNonce || !['PREPARING', 'READY'].includes(o.status))
      return fail(404, 'PICKUP_NOT_FOUND')
    if (orderId) {
      const expected = pickupToken(o)
      if (
        expected.length !== tokenOrCode.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(tokenOrCode))
      )
        return fail(404, 'PICKUP_NOT_FOUND')
    }
    return o
  }
  app.post(`${base}/venues/:venueId/pickup/preview`, async (req) =>
    db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      return h.view(await pickup(req, tx, uuid.parse(params(req).venueId)), tx)
    }),
  )
  app.post(`${base}/orders/:orderId/collect`, async (req) =>
    db.transaction(async (raw) => {
      const tx = raw as unknown as Db,
        a = await staff(req, tx),
        o = await pickup(req, tx, a.venueId, true)
      if (o.id !== uuid.parse(params(req).orderId))
        return fail(404, 'NOT_FOUND')
      if (o.status !== 'READY' || !(await orderReadiness(tx,o)).allReady) return fail(409, 'NOT_READY')
      const [u] = await tx
        .update(s.merchantOrder)
        .set({ status: 'COLLECTED' })
        .where(eq(s.merchantOrder.id, o.id))
        .returning()
      return h.view(u, tx)
    }),
  )
}
