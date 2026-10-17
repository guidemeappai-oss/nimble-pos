import { effectiveCatalog } from '../services/menuSchedule'
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { LoyaltyProgramInput, merchantRewardProduct } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { env } from '../env'
import {
  cardView,
  hasPendingLoyaltyAcceptance,
  loyaltyFail as fail,
  loyaltyNetwork,
  lockCard,
  lockLoyaltyUser,
  programView,
  rewardView,
  rewardToken,
} from '../services/loyalty'
import { verifyLoyaltyEvmSignature } from '../services/loyaltyEvm'
import { consumeRewardStock } from '../services/stockReservations'
type Actor =
  | { kind: 'owner'; userId: string }
  | { kind: 'cashier'; employeeId: string; venueId: string; sessionId: string }
type Helpers = {
  actor: (req: FastifyRequest) => Promise<Actor>
  venueFor: (
    actor: Actor,
    venueId: string,
    ownerOnly?: boolean,
    db?: Db,
  ) => Promise<typeof s.merchantVenue.$inferSelect>
  publicOrder: (
    token: string,
    db?: Db,
    lock?: boolean,
    req?: FastifyRequest,
  ) => Promise<typeof s.merchantOrder.$inferSelect>
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const uuid = z.string().uuid()
const params = (req: FastifyRequest) => req.params as Record<string, string>
export async function loyaltyRoutes(app: FastifyInstance, h: Helpers) {
  const { db } = app.deps
  const base = '/v1/merchant'
  const customer = async (req: FastifyRequest) => {
    const a = await h.actor(req)
    if (a.kind !== 'owner') return fail(403, 'CUSTOMER_REQUIRED')
    return a.userId
  }
  const current = async (store: Db, venueId: string) => {
    const [p] = await store
      .select()
      .from(s.loyaltyProgram)
      .where(
        and(
          eq(s.loyaltyProgram.venueId, uuid.parse(venueId)),
          eq(s.loyaltyProgram.network, loyaltyNetwork()),
        ),
      )
      .orderBy(desc(s.loyaltyProgram.version))
      .limit(1)
    return p
  }
  const ownCard = async (
    store: Db,
    cardId: string,
    userId: string,
    lock = false,
  ) => {
    const [c] = await store
      .select()
      .from(s.loyaltyCard)
      .where(eq(s.loyaltyCard.id, uuid.parse(cardId)))
    if (!c || c.userId !== userId) return fail(404, 'NOT_FOUND')
    const [p] = await store
      .select()
      .from(s.loyaltyProgram)
      .where(eq(s.loyaltyProgram.id, c.programId))
    if (p.network !== loyaltyNetwork()) return fail(404, 'NOT_FOUND')
    if (lock) await lockCard(store, c.id)
    return { card: c, program: p }
  }
  async function mutate(
    req: FastifyRequest,
    actor: string,
    work: (tx: Db) => Promise<unknown>,
  ) {
    const key = z.string().min(1).max(128).parse(req.headers['idempotency-key'])
    const hash = digest(JSON.stringify([req.method, req.url, req.body ?? null]))
    return db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      // Serialize one actor's retries across routes, including the first request.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`loyalty:${actor}`},0))`,
      )
      const [prior] = await tx
        .select()
        .from(s.loyaltyRequest)
        .where(
          and(eq(s.loyaltyRequest.actor, actor), eq(s.loyaltyRequest.key, key)),
        )
      if (prior) {
        if (prior.requestHash !== hash) return fail(409, 'IDEMPOTENCY_CONFLICT')
        return prior.response
      }
      const response = await work(tx)
      await tx
        .insert(s.loyaltyRequest)
        .values({ actor, key, requestHash: hash, response })
      return response
    })
  }
  app.get(`${base}/venues/:venueId/loyalty/program`, async (req) => {
    const p = await current(db, params(req).venueId)
    return p ? programView(db, p) : null
  })
  app.post(`${base}/venues/:venueId/loyalty/program`, async (req) => {
    const a = await h.actor(req),
      input = LoyaltyProgramInput.parse(req.body)
    const v = await h.venueFor(a, params(req).venueId, true)
    return mutate(req, a.kind === 'owner' ? a.userId : '', async (tx) => {
      await tx
        .select()
        .from(s.merchantVenue)
        .where(eq(s.merchantVenue.id, v.id))
        .for('update')
      const [product] = await tx
        .select()
        .from(s.merchantProduct)
        .where(
          and(
            eq(s.merchantProduct.id, input.productId),
            eq(s.merchantProduct.venueId, v.id),
          ),
        )
      const variant = product?.catalog.variants.find(
        (x) => x.id === input.variantId,
      )
      if (!product || !variant || !merchantRewardProduct(product.catalog)) return fail(400, 'INVALID_REWARD_PRODUCT')
      const old = await current(tx, v.id)
      if (old)
        await tx
          .update(s.loyaltyProgram)
          .set({ active: false })
          .where(eq(s.loyaltyProgram.id, old.id))
      const [p] = await tx
        .insert(s.loyaltyProgram)
        .values({
          ...input,
          venueId: v.id,
          network: loyaltyNetwork(),
          version: (old?.version ?? 0) + 1,
          fiatCurrency: v.fiatCurrency,
          productName: product.catalog.name,
          variantName: variant.name,
        })
        .returning()
      return programView(tx, p)
    })
  })
  app.post(`${base}/venues/:venueId/loyalty/program/disable`, async (req) => {
    const a = await h.actor(req),
      v = await h.venueFor(a, params(req).venueId, true)
    return mutate(req, a.kind === 'owner' ? a.userId : '', async (tx) => {
      await tx
        .select()
        .from(s.merchantVenue)
        .where(eq(s.merchantVenue.id, v.id))
        .for('update')
      const p = await current(tx, v.id)
      if (!p) return fail(404, 'NOT_FOUND')
      const [updated] = await tx
        .update(s.loyaltyProgram)
        .set({ active: false })
        .where(eq(s.loyaltyProgram.id, p.id))
        .returning()
      return programView(tx, updated)
    })
  })
  app.get(`${base}/loyalty/cards`, async (req) => {
    const userId = await customer(req)
    const cards = await db
      .select({ id: s.loyaltyCard.id })
      .from(s.loyaltyCard)
      .innerJoin(
        s.loyaltyProgram,
        eq(s.loyaltyProgram.id, s.loyaltyCard.programId),
      )
      .where(
        and(
          eq(s.loyaltyCard.userId, userId),
          eq(s.loyaltyProgram.network, loyaltyNetwork()),
        ),
      )
    return Promise.all(cards.map((c) => cardView(db, c.id)))
  })
  app.get(`${base}/loyalty/cards/:cardId`, async (req) => {
    const userId = await customer(req)
    const { card } = await ownCard(db, params(req).cardId, userId)
    return cardView(db, card.id)
  })
  app.post(`${base}/venues/:venueId/loyalty/join`, async (req) => {
    const userId = await customer(req),
      venueId = uuid.parse(params(req).venueId)
    return mutate(req, userId, async (tx) => {
      await lockLoyaltyUser(tx, userId)
      const p = await current(tx, venueId)
      if (!p?.active) return fail(409, 'LOYALTY_DISABLED')
      // An unfinished or indebted old card retains its promise and cannot be skipped.
      const cards = await tx
        .select({ card: s.loyaltyCard, program: s.loyaltyProgram })
        .from(s.loyaltyCard)
        .innerJoin(
          s.loyaltyProgram,
          eq(s.loyaltyProgram.id, s.loyaltyCard.programId),
        )
        .where(
          and(
            eq(s.loyaltyCard.userId, userId),
            eq(s.loyaltyProgram.venueId, venueId),
            eq(s.loyaltyProgram.network, loyaltyNetwork()),
          ),
        )
        .orderBy(asc(s.loyaltyProgram.version))
      for (const c of cards) {
        await lockCard(tx, c.card.id)
        const view = await cardView(tx, c.card.id)
        if (
          c.program.id === p.id ||
          (await hasPendingLoyaltyAcceptance(tx, c.card.id)) ||
          view.balance !== 0 ||
          view.refundHolds ||
          view.rewards.some((r) =>
            ['RESERVED', 'PREPARING', 'READY'].includes(r.status),
          )
        )
          return view
      }
      const [c] = await tx
        .insert(s.loyaltyCard)
        .values({ programId: p.id, userId })
        .onConflictDoUpdate({
          target: [s.loyaltyCard.programId, s.loyaltyCard.userId],
          set: { userId },
        })
        .returning()
      return cardView(tx, c.id)
    })
  })
  app.get(`${base}/checkout/:checkoutToken/loyalty`, async (req) => {
    const userId = await customer(req),
      order = await h.publicOrder(params(req).checkoutToken, db, false, req)
    const [binding] = await db
      .select({
        cardId: s.loyaltyCheckout.cardId,
        revision: s.loyaltyCheckout.revision,
        userId: s.loyaltyCard.userId,
      })
      .from(s.loyaltyCheckout)
      .innerJoin(s.loyaltyCard, eq(s.loyaltyCard.id, s.loyaltyCheckout.cardId))
      .where(
        and(
          eq(s.loyaltyCheckout.orderId, order.id),
          eq(s.loyaltyCheckout.revision, order.revision),
        ),
      )
    return binding && binding.userId === userId
      ? { cardId: binding.cardId, revision: binding.revision }
      : null
  })
  app.post(`${base}/checkout/:checkoutToken/loyalty`, async (req) => {
    const userId = await customer(req),
      input = z
        .object({ cardId: uuid, revision: z.number().int().positive() })
        .strict()
        .parse(req.body)
    return mutate(req, userId, async (tx) => {
      const order = await h.publicOrder(
        params(req).checkoutToken,
        tx,
        true,
        req,
      )
      if (
        order.status !== 'AWAITING_PAYMENT' ||
        order.quote ||
        order.quoteHistory.length ||
        order.pendingPaymentHash
      )
        return fail(409, 'LOYALTY_CHECKOUT_LOCKED')
      if (order.revision !== input.revision) return fail(409, 'STALE_REVISION')
      if (order.payerUserId && order.payerUserId !== userId)
        return fail(409, 'LOYALTY_PAYER_MISMATCH')
      const { card, program } = await ownCard(tx, input.cardId, userId, true)
      const active = await current(tx, program.venueId)
      if (program.venueId !== order.venueId || !active?.active)
        return fail(409, 'LOYALTY_DISABLED')
      const selected = await cardView(tx, card.id)
      if (
        program.id !== active.id &&
        selected.balance === 0 &&
        !(await hasPendingLoyaltyAcceptance(tx, card.id)) &&
        !selected.refundHolds &&
        !selected.rewards.some((r) =>
          ['RESERVED', 'PREPARING', 'READY'].includes(r.status),
        )
      )
        return fail(409, 'LOYALTY_CARD_CLOSED')
      const older = await tx
        .select({ card: s.loyaltyCard, program: s.loyaltyProgram })
        .from(s.loyaltyCard)
        .innerJoin(
          s.loyaltyProgram,
          eq(s.loyaltyProgram.id, s.loyaltyCard.programId),
        )
        .where(
          and(
            eq(s.loyaltyCard.userId, userId),
            eq(s.loyaltyProgram.venueId, program.venueId),
            eq(s.loyaltyProgram.network, loyaltyNetwork()),
          ),
        )
        .orderBy(asc(s.loyaltyProgram.version))
      for (const prior of older) {
        if (prior.program.version >= program.version) break
        const priorView = await cardView(tx, prior.card.id)
        if (
          priorView.balance !== 0 ||
          (await hasPendingLoyaltyAcceptance(tx, prior.card.id)) ||
          priorView.refundHolds ||
          priorView.rewards.some((r) =>
            ['RESERVED', 'PREPARING', 'READY'].includes(r.status),
          )
        )
          return fail(409, 'LOYALTY_PRIOR_CARD_OPEN')
      }
      const [existing] = await tx
        .select()
        .from(s.loyaltyCheckout)
        .where(
          and(
            eq(s.loyaltyCheckout.orderId, order.id),
            eq(s.loyaltyCheckout.revision, order.revision),
          ),
        )
      if (existing && existing.cardId !== card.id)
        return fail(409, 'LOYALTY_CHECKOUT_LOCKED')
      await tx
        .insert(s.loyaltyCheckout)
        .values({
          orderId: order.id,
          revision: order.revision,
          cardId: card.id,
        })
        .onConflictDoNothing()
      await tx
        .update(s.merchantOrder)
        .set({ payerUserId: userId })
        .where(eq(s.merchantOrder.id, order.id))
      return { cardId: card.id, revision: order.revision }
    })
  })
  app.post(`${base}/loyalty/evm/challenge`, async (req) => {
    const userId = await customer(req),
      input = z
        .object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
        .strict()
        .parse(req.body)
    const id = crypto.randomUUID(),
      expiresAt = new Date(Date.now() + 300000),
      address = input.address.toLowerCase()
    const message = `Nimble loyalty wallet proof\nDomain: ${env.appOrigin}\nNimiq environment: ${loyaltyNetwork()}\nEVM chain: 137\nAccount: ${userId}\nAddress: ${address}\nNonce: ${id}\nExpires: ${expiresAt.toISOString()}\nThis links this payment address to your Nimble loyalty cards.`
    await db
      .insert(s.loyaltyEvmChallenge)
      .values({ id, userId, address, message, expiresAt })
    return { id, message, expiresAt: expiresAt.toISOString() }
  })
  app.post(`${base}/loyalty/evm/verify`, async (req) => {
    const userId = await customer(req),
      input = z
        .object({ challengeId: uuid, signature: z.string().max(200) })
        .strict()
        .parse(req.body)
    const [c] = await db
      .select()
      .from(s.loyaltyEvmChallenge)
      .where(
        and(
          eq(s.loyaltyEvmChallenge.id, input.challengeId),
          eq(s.loyaltyEvmChallenge.userId, userId),
          isNull(s.loyaltyEvmChallenge.usedAt),
          gt(s.loyaltyEvmChallenge.expiresAt, new Date()),
        ),
      )
    if (
      !c ||
      !c.message.startsWith(
        `Nimble loyalty wallet proof\nDomain: ${env.appOrigin}\nNimiq environment: ${loyaltyNetwork()}\nEVM chain: 137\n`,
      ) ||
      !(await verifyLoyaltyEvmSignature(c.message, input.signature, c.address))
    )
      return fail(401, 'EVM_PROOF_INVALID')
    return db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      const [used] = await tx
        .update(s.loyaltyEvmChallenge)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(s.loyaltyEvmChallenge.id, c.id),
            isNull(s.loyaltyEvmChallenge.usedAt),
            gt(s.loyaltyEvmChallenge.expiresAt, new Date()),
          ),
        )
        .returning()
      if (!used) return fail(401, 'EVM_PROOF_INVALID')
      const [existing] = await tx
        .select()
        .from(s.loyaltyEvmIdentity)
        .where(
          and(
            eq(s.loyaltyEvmIdentity.address, c.address),
            eq(s.loyaltyEvmIdentity.network, loyaltyNetwork()),
          ),
        )
      if (existing && existing.userId !== userId)
        return fail(409, 'EVM_ALREADY_LINKED')
      await tx
        .insert(s.loyaltyEvmIdentity)
        .values({ userId, address: c.address, network: loyaltyNetwork() })
        .onConflictDoNothing()
      return { address: c.address }
    })
  })
  app.post(`${base}/loyalty/cards/:cardId/reserve`, async (req) => {
    const userId = await customer(req)
    return mutate(req, userId, async (tx) => {
      const { card } = await ownCard(tx, params(req).cardId, userId, true)
      await lockCard(tx, card.id)
      const view = await cardView(tx, card.id)
      if (view.available < 5) return fail(409, 'INSUFFICIENT_STAMPS')
      const id = crypto.randomUUID(),
        expiresAt = new Date(Date.now() + 300000),
        token = rewardToken(id, userId, expiresAt)
      const [r] = await tx
        .insert(s.loyaltyReward)
        .values({ id, cardId: card.id, tokenHash: digest(token), expiresAt })
        .returning()
      return { ...(await rewardView(tx, r)), token }
    })
  })
  const rewardContext = async (tx: Db, rewardId: string) => {
    const [r] = await tx
      .select()
      .from(s.loyaltyReward)
      .where(eq(s.loyaltyReward.id, uuid.parse(rewardId)))
    if (!r) return fail(404, 'NOT_FOUND')
    await lockCard(tx, r.cardId)
    const [fresh] = await tx
      .select()
      .from(s.loyaltyReward)
      .where(eq(s.loyaltyReward.id, r.id))
    return fresh
  }
  app.get(`${base}/venues/:venueId/loyalty/rewards`, async (req) => {
    const v = await h.venueFor(await h.actor(req), params(req).venueId)
    const rewards = await db
      .select({ reward: s.loyaltyReward })
      .from(s.loyaltyReward)
      .innerJoin(s.loyaltyCard, eq(s.loyaltyCard.id, s.loyaltyReward.cardId))
      .innerJoin(
        s.loyaltyProgram,
        eq(s.loyaltyProgram.id, s.loyaltyCard.programId),
      )
      .where(
        and(
          eq(s.loyaltyProgram.venueId, v.id),
          eq(s.loyaltyProgram.network, loyaltyNetwork()),
          inArray(s.loyaltyReward.status, ['PREPARING', 'READY', 'COLLECTED']),
        ),
      )
      .orderBy(desc(s.loyaltyReward.createdAt))
      .limit(100)
    return Promise.all(rewards.map(({ reward }) => rewardView(db, reward)))
  })
  app.post(`${base}/venues/:venueId/loyalty/accept`, async (req) => {
    const a = await h.actor(req)
    if (a.kind !== 'cashier') return fail(403, 'CASHIER_REQUIRED')
    const v = await h.venueFor(a, params(req).venueId),
      input = z
        .object({ token: z.string().min(20).max(128) })
        .strict()
        .parse(req.body)
    return mutate(req, a.sessionId, async (tx) => {
      const [found] = await tx
        .select()
        .from(s.loyaltyReward)
        .where(eq(s.loyaltyReward.tokenHash, digest(input.token)))
      if (!found) return fail(404, 'NOT_FOUND')
      const r = await rewardContext(tx, found.id),
        [card] = await tx
          .select()
          .from(s.loyaltyCard)
          .where(eq(s.loyaltyCard.id, r.cardId)),
        [p] = await tx
          .select()
          .from(s.loyaltyProgram)
          .where(eq(s.loyaltyProgram.id, card.programId))
      if (p.venueId !== v.id || p.network !== loyaltyNetwork())
        return fail(404, 'NOT_FOUND')
      if (['PREPARING', 'READY', 'COLLECTED'].includes(r.status))
        return rewardView(tx, r)
      if (r.status !== 'RESERVED') return fail(409, 'REWARD_NOT_AVAILABLE')
      const view = await cardView(tx, card.id)
      if (view.available < 0) return fail(409, 'INSUFFICIENT_STAMPS')
      const [product] = await tx
        .select()
        .from(s.merchantProduct)
        .where(eq(s.merchantProduct.id, p.productId))
      const effectiveReward = product ? (await effectiveCatalog(tx, v.id, [product.catalog],new Date(),true))[0] : null
      if (
        !effectiveReward?.available ||
        !merchantRewardProduct(product.catalog) ||
        !effectiveReward.variants.some((x) => x.id === p.variantId)
      )
        return fail(409, 'REWARD_PRODUCT_UNAVAILABLE')
      const [employee] = await tx
        .select()
        .from(s.merchantEmployee)
        .where(eq(s.merchantEmployee.id, a.employeeId))
      // The promise retains its product and variant; bindings are frozen at acceptance.
      // Stock and stamps commit together, so unavailable stock leaves the reward reserved.
      await consumeRewardStock(tx, {
        venueId: v.id,
        rewardId: r.id,
        actorId: a.employeeId,
        actorName: employee.name,
        requirements: effectiveReward.variants.find((x) => x.id === p.variantId)!.stockBindings ?? [],
        recipeSnapshot: effectiveReward.variants.find((x) => x.id === p.variantId)!.recipeSnapshot,
      })
      // Distinct reward numbers avoid modifying the paid-sales counter or reports.
      const [number] = await tx.execute(
        sql`select nextval('loyalty_reward_number_seq') as n`,
      )
      await tx.insert(s.loyaltyLedger).values({
        cardId: card.id,
        kind: 'REDEEM',
        delta: -5,
        eventKey: `redeem:${r.id}`,
        rewardId: r.id,
      })
      const [updated] = await tx
        .update(s.loyaltyReward)
        .set({
          status: 'PREPARING',
          number: Number(number.n),
          acceptedBy: a.employeeId,
        })
        .where(eq(s.loyaltyReward.id, r.id))
        .returning()
      return rewardView(tx, updated)
    })
  })
  app.post(`${base}/loyalty/rewards/:rewardId/cancel`, async (req) => {
    const a = await h.actor(req)
    return mutate(
      req,
      a.kind === 'owner' ? a.userId : a.sessionId,
      async (tx) => {
        const r = await rewardContext(tx, params(req).rewardId),
          [c] = await tx
            .select()
            .from(s.loyaltyCard)
            .where(eq(s.loyaltyCard.id, r.cardId)),
          [p] = await tx
            .select()
            .from(s.loyaltyProgram)
            .where(eq(s.loyaltyProgram.id, c.programId))
        if (p.network !== loyaltyNetwork()) return fail(404, 'NOT_FOUND')
        if (a.kind === 'owner') {
          if (c.userId !== a.userId) return fail(404, 'NOT_FOUND')
          if (!['RESERVED', 'CANCELLED', 'EXPIRED'].includes(r.status))
            return fail(403, 'CASHIER_REQUIRED')
        } else await h.venueFor(a, p.venueId, false, tx)
        if (['CANCELLED', 'EXPIRED'].includes(r.status))
          return rewardView(tx, r)
        if (r.status === 'COLLECTED')
          return fail(409, 'REWARD_ALREADY_COLLECTED')
        if (['PREPARING', 'READY'].includes(r.status))
          await tx
            .insert(s.loyaltyLedger)
            .values({
              cardId: c.id,
              kind: 'RESTORE',
              delta: 5,
              eventKey: `restore:${r.id}`,
              rewardId: r.id,
            })
            .onConflictDoNothing({ target: s.loyaltyLedger.eventKey })
        const [updated] = await tx
          .update(s.loyaltyReward)
          .set({ status: 'CANCELLED' })
          .where(eq(s.loyaltyReward.id, r.id))
          .returning()
        return rewardView(tx, updated)
      },
    )
  })
  app.post(`${base}/loyalty/rewards/:rewardId/status`, async (req) => {
    const a = await h.actor(req)
    if (a.kind !== 'cashier') return fail(403, 'CASHIER_REQUIRED')
    const input = z
      .object({ status: z.enum(['READY', 'COLLECTED']) })
      .strict()
      .parse(req.body)
    return mutate(req, a.sessionId, async (tx) => {
      const r = await rewardContext(tx, params(req).rewardId),
        [c] = await tx
          .select()
          .from(s.loyaltyCard)
          .where(eq(s.loyaltyCard.id, r.cardId)),
        [p] = await tx
          .select()
          .from(s.loyaltyProgram)
          .where(eq(s.loyaltyProgram.id, c.programId))
      if (p.network !== loyaltyNetwork()) return fail(404, 'NOT_FOUND')
      await h.venueFor(a, p.venueId, false, tx)
      if (r.status === input.status) return rewardView(tx, r)
      if (!(
        (r.status === 'PREPARING' && input.status === 'READY') ||
        (r.status === 'READY' && input.status === 'COLLECTED')
      ))
        return fail(409, 'INVALID_STATE')
      const [updated] = await tx
        .update(s.loyaltyReward)
        .set({ status: input.status })
        .where(eq(s.loyaltyReward.id, r.id))
        .returning()
      return rewardView(tx, updated)
    })
  })
  app.get(`${base}/venues/:venueId/loyalty/report`, async (req) => {
    const v = await h.venueFor(await h.actor(req), params(req).venueId, true)
    const cards = await db
      .select({ card: s.loyaltyCard })
      .from(s.loyaltyCard)
      .innerJoin(
        s.loyaltyProgram,
        eq(s.loyaltyProgram.id, s.loyaltyCard.programId),
      )
      .where(
        and(
          eq(s.loyaltyProgram.venueId, v.id),
          eq(s.loyaltyProgram.network, loyaltyNetwork()),
        ),
      )
    const views = await Promise.all(
        cards.map(({ card }) => cardView(db, card.id)),
      ),
      entries = views.flatMap((c) => c.entries),
      rewards = views.flatMap((c) => c.rewards)
    return {
      cards: cards.length,
      earned: entries.filter((e) => e.kind === 'EARN').length,
      corrections: entries.filter((e) => e.kind === 'REFUND').length,
      collectedRewards: rewards.filter((r) => r.status === 'COLLECTED').length,
      activeRewards: rewards.filter((r) =>
        ['PREPARING', 'READY'].includes(r.status),
      ).length,
    }
  })
}
