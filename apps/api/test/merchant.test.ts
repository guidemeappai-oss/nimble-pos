import { afterAll, expect, it, vi } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(async () => {
  await app.close()
  await close()
})
const auth = (token: string) => ({ authorization: `Bearer ${token}` })
let ownerToken: string,
  venue: any,
  employee: any,
  terminalToken: string,
  cashierToken: string,
  product: any,
  shift: any,
  order: any
it('owner creates venue, cashier has a separate device-scoped identity and cannot manage money or prices', async () => {
  const owner = await makeUser(db, 'NQ-owner-merchant-123')
  ownerToken = await tokenFor(owner)
  const created = await app.inject({
    method: 'POST',
    url: '/v1/merchant/venues',
    headers: auth(ownerToken),
    payload: {
      name: 'Café',
      fiatCurrency: 'EUR',
      nimAddress: 'NQ-owner-merchant-123',
      usdtAddress: '0x' + '1'.repeat(40),
    },
  })
  expect(created.statusCode).toBe(201)
  venue = created.json()
  expect(
    (
      await app.inject({ url: `/v1/merchant/venues/${venue.id}/rates`, headers: auth(ownerToken) })
    ).json(),
  ).toEqual({ NIM: null, USDT: null })
  const er = await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${venue.id}/employees`,
    headers: auth(ownerToken),
    payload: { name: 'Ana', pin: '1234' },
  })
  expect(er.statusCode).toBe(201)
  employee = er.json()
  expect(employee.pinHash).toBeUndefined()
  const paired = await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${venue.id}/terminal`,
    headers: auth(ownerToken),
  })
  expect(paired.statusCode).toBe(201)
  terminalToken = paired.json().terminalToken
  const login = await app.inject({
    method: 'POST',
    url: '/v1/merchant/terminal/login',
    headers: { 'x-terminal-token': terminalToken },
    payload: { employeeId: employee.id, pin: '1234' },
  })
  expect(login.statusCode).toBe(200)
  cashierToken = login.json().token
  expect(
    (await app.inject({ url: '/v1/merchant/venues', headers: auth(cashierToken) })).statusCode,
  ).toBe(403)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { ...auth(cashierToken), 'idempotency-key': 'p2p' },
      })
    ).statusCode,
  ).toBe(401)
})
const cart = () => ({
  lines: [
    {
      productId: product.id,
      variantId: product.variants[0].id,
      extraIds: [product.extras[0].id],
      quantity: 2,
    },
  ],
})
const orderUrl = () => `/v1/merchant/orders/${order.id}`
const checkoutUrl = () => `/v1/merchant/checkout/${order.checkoutToken}`
it('prices frozen server snapshots, refuses forged totals, unavailable extras, and conflicting retries', async () => {
  const p = await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${venue.id}/catalog`,
    headers: auth(ownerToken),
    payload: {
      name: 'Coffee',
      category: 'Drinks',
      variants: [{ id: crypto.randomUUID(), name: 'Large', priceMinor: 450 }],
      extras: [{ id: crypto.randomUUID(), name: 'Oat', priceMinor: 60 }],
    },
  })
  expect(p.statusCode).toBe(201)
  product = p.json()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/venues/${venue.id}/catalog`,
        headers: auth(cashierToken),
        payload: product,
      })
    ).statusCode,
  ).toBe(403)
  const opened = await app.inject({
    method: 'POST',
    url: '/v1/merchant/shifts',
    headers: auth(cashierToken),
  })
  expect(opened.statusCode).toBe(201)
  shift = opened.json()
  const create = (key: string, payload: any) =>
    app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: { ...auth(cashierToken), 'idempotency-key': key },
      payload,
    })
  expect((await create('forged', { ...cart(), totalMinor: 1 })).statusCode).toBe(400)
  const sale = await create('sale-1', cart())
  expect(sale.statusCode).toBe(201)
  order = sale.json()
  expect(order.totalMinor).toBe(1020)
  expect(order.lines[0].unitPriceMinor).toBe(510)
  expect((await create('sale-1', cart())).json().id).toBe(order.id)
  expect(
    (await create('sale-1', { lines: [{ ...cart().lines[0], quantity: 3 }] })).statusCode,
  ).toBe(409)
  const toggle = `/v1/merchant/venues/${venue.id}/catalog/${product.id}/availability`
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: toggle,
        headers: auth(cashierToken),
        payload: { extraId: product.extras[0].id, available: false },
      })
    ).statusCode,
  ).toBe(200)
  expect((await create('unavailable', cart())).statusCode).toBe(409)
  await app.inject({
    method: 'PATCH',
    url: toggle,
    headers: auth(cashierToken),
    payload: { extraId: product.extras[0].id, available: true },
  })
  expect((await app.inject({ url: checkoutUrl() })).json().totalMinor).toBe(1020)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/shifts/${shift.id}/close`,
        headers: auth(cashierToken),
      })
    ).statusCode,
  ).toBe(409)
})
it('payer code delivers a merchant checkout capability with no P2P charge', async () => {
  const payer = await makeUser(db, 'NQ-payer-merchant-123'),
    payerToken = await tokenFor(payer)
  const code = (
    await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { ...auth(payerToken), 'idempotency-key': 'merchant-code' },
    })
  ).json()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: orderUrl() + '/claim',
        headers: auth(cashierToken),
        payload: { code: code.code },
      })
    ).statusCode,
  ).toBe(200)
  const payerView = (
    await app.inject({ url: `/v1/sessions/${code.sessionId}`, headers: auth(payerToken) })
  ).json()
  expect(payerView.merchantCheckoutToken).toBe(order.checkoutToken)
  expect(payerView.charge).toBeUndefined()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: orderUrl() + '/claim',
        headers: auth(cashierToken),
        payload: { code: code.code },
      })
    ).statusCode,
  ).toBe(404)
})
const quoteFixture = (input: any) => ({
  id: crypto.randomUUID(),
  ...input,
  network: input.asset === 'NIM' ? 'nimiq:5' : 'eip155:137',
  amountAtomic: '25500000',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 120000).toISOString(),
  rate: '0.004',
  rateAt: new Date().toISOString(),
  rateSource: 'test',
})
it('locks revision at quote and requires an exact verified receipt before preparation', async () => {
  app.deps.merchantPayments = {
    quote: async (input) => quoteFixture(input),
    verify: async () => null,
    displayRates: async () => ({
      NIM: { value: '0.004', at: new Date().toISOString(), source: 'test' },
      USDT: null,
    }),
  }
  expect(
    (
      await app.inject({
        url: `/v1/merchant/venues/${venue.id}/rates`,
        headers: auth(cashierToken),
      })
    ).json().NIM.value,
  ).toBe('0.004')
  const quoted = await app.inject({
    method: 'POST',
    url: checkoutUrl() + '/quote',
    payload: { revision: order.revision, asset: 'NIM', sender: 'NQ-payer-merchant-123' },
  })
  expect(quoted.statusCode).toBe(200)
  order = quoted.json()
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: orderUrl(),
        headers: auth(cashierToken),
        payload: { revision: order.revision, ...cart() },
      })
    ).statusCode,
  ).toBe(409)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: orderUrl() + '/status',
        headers: auth(cashierToken),
        payload: { revision: order.revision, status: 'READY' },
      })
    ).statusCode,
  ).toBe(409)
  const body = { revision: order.revision, quoteId: order.quote.id, hash: 'a'.repeat(64) }
  const pending = await app.inject({
    method: 'POST',
    url: checkoutUrl() + '/payment',
    payload: body,
  })
  expect(pending.statusCode).toBe(200)
  expect(pending.json().status).toBe('PAYMENT_PENDING')
  app.deps.merchantPayments.verify = async ({ quote, hash }) => ({
    ...quote,
    amountAtomic: '1',
    hash,
    confirmedAt: new Date().toISOString(),
  })
  expect(
    (await app.inject({ method: 'POST', url: checkoutUrl() + '/payment', payload: body }))
      .statusCode,
  ).toBe(409)
  app.deps.merchantPayments.verify = async ({ quote, hash }) => ({
    ...quote,
    hash,
    confirmedAt: new Date().toISOString(),
  })
  const paid = await app.inject({ method: 'POST', url: checkoutUrl() + '/payment', payload: body })
  expect(paid.statusCode).toBe(200)
  order = paid.json()
  expect(order.status).toBe('PREPARING')
  expect(order.payment.amountAtomic).toBe('25500000')
  expect(
    (await app.inject({ method: 'POST', url: checkoutUrl() + '/payment', payload: body })).json()
      .status,
  ).toBe('PREPARING')
})
it('deduplicates ready signaling and permits only the owner to approve exact full asset refund', async () => {
  const ready = () =>
    app.inject({
      method: 'POST',
      url: orderUrl() + '/status',
      headers: auth(cashierToken),
      payload: { revision: order.revision, status: 'READY' },
    })
  expect((await ready()).json().status).toBe('READY')
  expect((await ready()).statusCode).toBe(200)
  const { merchantNotificationOutbox } = await import('../src/db/schema')
  const rows = await db.select().from(merchantNotificationOutbox)
  expect(rows).toHaveLength(1)
  expect(rows[0].recipient).toBe('NQ-payer-merchant-123')
  expect(rows[0].rawTransaction).toBeNull()
  const requested = await app.inject({
    method: 'POST',
    url: orderUrl() + '/refund',
    headers: auth(cashierToken),
    payload: { reason: 'Changed mind' },
  })
  expect(requested.statusCode).toBe(200)
  expect(requested.json().status).toBe('REFUND_PENDING')
  expect(
    (
      await app.inject({
        method: 'POST',
        url: orderUrl() + '/refund/approve',
        headers: auth(cashierToken),
      })
    ).statusCode,
  ).toBe(403)
  app.deps.merchantPayments!.refreshRefundQuote = async (quote) => ({ ...quote, amountAtomic: '1' })
  expect(
    (
      await app.inject({
        method: 'POST',
        url: orderUrl() + '/refund/approve',
        headers: auth(ownerToken),
      })
    ).statusCode,
  ).toBe(503)
  expect((await app.inject({ url: checkoutUrl() })).json().refund.status).toBe('REQUESTED')
  app.deps.merchantPayments!.refreshRefundQuote = async (quote) => ({
    ...quote,
    chainHeight: 123456,
    issuedAt: new Date().toISOString(),
  })
  const approved = await app.inject({
    method: 'POST',
    url: orderUrl() + '/refund/approve',
    headers: auth(ownerToken),
  })
  expect(approved.statusCode).toBe(200)
  const rq = approved.json().refund.quote
  expect(rq.amountAtomic).toBe(order.payment.amountAtomic)
  expect(rq.asset).toBe('NIM')
  expect(rq.sender).toBe(order.payment.recipient)
  expect(rq.recipient).toBe(order.payment.sender)
  expect(rq.chainHeight).toBe(123456)
  const refunded = await app.inject({
    method: 'POST',
    url: orderUrl() + '/refund/payment',
    headers: auth(ownerToken),
    payload: { hash: 'b'.repeat(64) },
  })
  expect(refunded.statusCode).toBe(200)
  expect(refunded.json().status).toBe('REFUNDED')
  const report = (
    await app.inject({ url: `/v1/merchant/venues/${venue.id}/report`, headers: auth(ownerToken) })
  ).json()
  expect(report.totals).toMatchObject({
    paid: 1,
    refunded: 1,
    grossMinor: 1020,
    netMinor: 0,
    assets: { NIM: '0', USDT: '0' },
  })
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/shifts/${shift.id}/close`,
        headers: auth(cashierToken),
      })
    ).statusCode,
  ).toBe(200)
})
it('persists pending hashes and completes payment and refund after clients leave', async () => {
  shift = (
    await app.inject({ method: 'POST', url: '/v1/merchant/shifts', headers: auth(cashierToken) })
  ).json()
  order = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: { ...auth(cashierToken), 'idempotency-key': 'background' },
      payload: cart(),
    })
  ).json()
  app.deps.merchantPayments = {
    quote: async (input) => quoteFixture(input),
    verify: async () => null,
  }
  order = (
    await app.inject({
      method: 'POST',
      url: checkoutUrl() + '/quote',
      payload: { revision: 1, asset: 'NIM', sender: 'NQ-background-payer' },
    })
  ).json()
  const hash = 'c'.repeat(64)
  const pending = (
    await app.inject({
      method: 'POST',
      url: checkoutUrl() + '/payment',
      payload: { revision: 1, quoteId: order.quote.id, hash },
    })
  ).json()
  expect(pending.pendingPaymentHash).toBe(hash)
  app.deps.merchantPayments.verify = async ({ quote, hash }) => ({
    ...quote,
    hash,
    confirmedAt: new Date().toISOString(),
  })
  const { merchantReconciliationTick } = await import('../src/services/merchantSettlement')
  await merchantReconciliationTick(db, app.deps.merchantPayments)
  order = (await app.inject({ url: checkoutUrl() })).json()
  expect(order.status).toBe('PREPARING')
  await app.inject({
    method: 'POST',
    url: orderUrl() + '/refund',
    headers: auth(cashierToken),
    payload: {},
  })
  await app.inject({
    method: 'POST',
    url: orderUrl() + '/refund/approve',
    headers: auth(ownerToken),
  })
  app.deps.merchantPayments.verify = async () => null
  const refund = (
    await app.inject({
      method: 'POST',
      url: orderUrl() + '/refund/payment',
      headers: auth(ownerToken),
      payload: { hash: 'd'.repeat(64) },
    })
  ).json()
  expect(refund.refund.pendingHash).toBe('d'.repeat(64))
  expect(refund.status).toBe('REFUND_PENDING')
  app.deps.merchantPayments.verify = async ({ quote, hash }) => ({
    ...quote,
    hash,
    confirmedAt: new Date().toISOString(),
  })
  await merchantReconciliationTick(db, app.deps.merchantPayments)
  expect((await app.inject({ url: checkoutUrl() })).json().status).toBe('REFUNDED')
})
it('refreshes an expired quote for the same immutable cart and reconciles the original quoted transfer', async () => {
  order = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: { ...auth(cashierToken), 'idempotency-key': 'expiry' },
      payload: cart(),
    })
  ).json()
  const edited = await app.inject({
    method: 'PATCH',
    url: orderUrl(),
    headers: auth(cashierToken),
    payload: { revision: 1, lines: [{ ...cart().lines[0], quantity: 1 }] },
  })
  expect(edited.statusCode).toBe(200)
  order = edited.json()
  expect(order.revision).toBe(2)
  expect(order.totalMinor).toBe(510)
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: orderUrl(),
        headers: auth(cashierToken),
        payload: { revision: 1, ...cart() },
      })
    ).statusCode,
  ).toBe(409)
  let quoteCalls = 0
  app.deps.merchantPayments = {
    quote: async (input) => {
      quoteCalls++
      return { ...quoteFixture(input), amountAtomic: quoteCalls === 1 ? '25500000' : '26000000' }
    },
    verify: async ({ quote, hash }) => ({ ...quote, hash, confirmedAt: new Date().toISOString() }),
  }
  const payload = { revision: 2, asset: 'NIM', sender: 'NQ-expiry-payer' }
  order = (await app.inject({ method: 'POST', url: checkoutUrl() + '/quote', payload })).json()
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: orderUrl(),
          headers: auth(cashierToken),
          payload: { revision: 2, ...cart() },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: orderUrl() + '/status',
          headers: auth(cashierToken),
          payload: { revision: 2, status: 'CANCELLED' },
        })
      ).statusCode,
    ).toBe(409)
    vi.setSystemTime(Date.now() + 180000)
    const refreshed = await app.inject({ method: 'POST', url: checkoutUrl() + '/quote', payload })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json().quote.id).not.toBe(order.quote.id)
    expect(quoteCalls).toBe(2)
    app.deps.merchantPayments.verify = async () => null
    const submitted = { revision: 2, quoteId: order.quote.id, hash: 'e'.repeat(64) }
    expect(
      (
        await app.inject({ method: 'POST', url: checkoutUrl() + '/payment', payload: submitted })
      ).json().status,
    ).toBe('PAYMENT_PENDING')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: checkoutUrl() + '/payment',
          payload: { ...submitted, quoteId: refreshed.json().quote.id },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: checkoutUrl() + '/payment',
          payload: { ...submitted, hash: '0'.repeat(64) },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ method: 'POST', url: checkoutUrl() + '/quote', payload })).statusCode,
    ).toBe(409)
    app.deps.merchantPayments.verify = async ({ quote, hash }) => ({
      ...quote,
      hash,
      confirmedAt: new Date().toISOString(),
    })
    const late = (
      await app.inject({
        method: 'POST',
        url: checkoutUrl() + '/payment',
        payload: { revision: 2, quoteId: order.quote.id, hash: 'e'.repeat(64) },
      })
    ).json()
    expect(late.status).toBe('REFUND_PENDING')
    expect(late.payment.amountAtomic).toBe('25500000')
  } finally {
    vi.useRealTimers()
  }
})
it('rejects transaction reuse and mismatches in every receipt field', async () => {
  order = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: { ...auth(cashierToken), 'idempotency-key': 'receipt-mismatches' },
      payload: cart(),
    })
  ).json()
  order = (
    await app.inject({
      method: 'POST',
      url: checkoutUrl() + '/quote',
      payload: { revision: 1, asset: 'NIM', sender: 'NQ-expiry-payer' },
    })
  ).json()
  const payload = { revision: 1, quoteId: order.quote.id, hash: 'f'.repeat(64) }
  for (const mismatch of [
    { hash: '0'.repeat(64) },
    { asset: 'USDT' },
    { network: 'nimiq:24' },
    { sender: 'NQ-imposter-payer' },
    { recipient: 'NQ-imposter-owner' },
    { amountAtomic: '1' },
    { confirmedAt: 'invalid' },
  ]) {
    app.deps.merchantPayments!.verify = async ({ quote, hash }) =>
      ({ ...quote, hash, confirmedAt: new Date().toISOString(), ...mismatch }) as any
    expect(
      (await app.inject({ method: 'POST', url: checkoutUrl() + '/payment', payload })).statusCode,
    ).toBe(409)
    expect((await app.inject({ url: checkoutUrl() })).json().status).toBe('PAYMENT_PENDING')
  }
  app.deps.merchantPayments!.verify = async ({ quote, hash }) => ({
    ...quote,
    hash,
    confirmedAt: new Date().toISOString(),
  })
  expect(
    (await app.inject({ method: 'POST', url: checkoutUrl() + '/payment', payload })).json().status,
  ).toBe('PREPARING')
  order = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: { ...auth(cashierToken), 'idempotency-key': 'receipt-replay' },
      payload: cart(),
    })
  ).json()
  order = (
    await app.inject({
      method: 'POST',
      url: checkoutUrl() + '/quote',
      payload: { revision: 1, asset: 'NIM', sender: 'NQ-expiry-payer' },
    })
  ).json()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: checkoutUrl() + '/payment',
        payload: { ...payload, quoteId: order.quote.id },
      })
    ).statusCode,
  ).toBe(409)
  expect((await app.inject({ url: checkoutUrl() })).json().status).toBe('PAYMENT_PENDING')
})
it('isolates cashier shift reports and revokes sessions on profile switch, PIN reset and terminal replacement', async () => {
  const other = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/employees`,
      headers: auth(ownerToken),
      payload: { name: 'Ben', pin: '5678' },
    })
  ).json()
  const login = (employeeId: string, pin: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/merchant/terminal/login',
      headers: { 'x-terminal-token': terminalToken },
      payload: { employeeId, pin },
    })
  const oldToken = cashierToken
  cashierToken = (await login(other.id, '5678')).json().token
  const queue = (
    await app.inject({ url: `/v1/merchant/venues/${venue.id}/orders`, headers: auth(cashierToken) })
  ).json()
  expect(queue.length).toBeGreaterThan(0)
  expect(
    queue.every((sale: any) => ['PREPARING', 'READY', 'REFUND_PENDING'].includes(sale.status)),
  ).toBe(true)
  const ownerOrders = (
    await app.inject({ url: `/v1/merchant/venues/${venue.id}/orders`, headers: auth(ownerToken) })
  ).json()
  expect(ownerOrders.some((sale: any) => sale.status === 'REFUNDED')).toBe(true)
  expect(queue.some((sale: any) => sale.status === 'REFUNDED')).toBe(false)
  expect(
    (await app.inject({ url: '/v1/merchant/shifts/current', headers: auth(oldToken) })).statusCode,
  ).toBe(401)
  expect(
    (
      await app.inject({
        url: `/v1/merchant/shifts/${shift.id}/report`,
        headers: auth(cashierToken),
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (
      await app.inject({
        url: `/v1/merchant/venues/${venue.id}/report`,
        headers: auth(cashierToken),
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/v1/merchant/venues/${venue.id}`,
        headers: auth(cashierToken),
        payload: venue,
      })
    ).statusCode,
  ).toBe(403)
  await app.inject({
    method: 'PATCH',
    url: `/v1/merchant/employees/${other.id}`,
    headers: auth(ownerToken),
    payload: { pin: '8765' },
  })
  expect(
    (await app.inject({ url: '/v1/merchant/shifts/current', headers: auth(cashierToken) }))
      .statusCode,
  ).toBe(401)
  expect((await login(other.id, '5678')).statusCode).toBe(401)
  cashierToken = (await login(other.id, '8765')).json().token
  await app.inject({
    method: 'PATCH',
    url: `/v1/merchant/employees/${other.id}`,
    headers: auth(ownerToken),
    payload: { active: false },
  })
  expect(
    (await app.inject({ url: '/v1/merchant/shifts/current', headers: auth(cashierToken) }))
      .statusCode,
  ).toBe(401)
  expect((await login(other.id, '8765')).statusCode).toBe(401)
  for (let attempt = 0; attempt < 3; attempt++)
    expect((await login(employee.id, '0000')).statusCode).toBe(401)
  expect((await login(employee.id, '1234')).statusCode).toBe(429)
  const oldTerminal = terminalToken
  terminalToken = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/terminal`,
      headers: auth(ownerToken),
    })
  ).json().terminalToken
  expect(
    (
      await app.inject({
        url: '/v1/merchant/terminal/profiles',
        headers: { 'x-terminal-token': oldTerminal },
      })
    ).statusCode,
  ).toBe(401)
  cashierToken = (await login(employee.id, '1234')).json().token
  await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${venue.id}/terminal/revoke`,
    headers: auth(ownerToken),
  })
  expect(
    (await app.inject({ url: '/v1/merchant/shifts/current', headers: auth(cashierToken) }))
      .statusCode,
  ).toBe(401)
})
