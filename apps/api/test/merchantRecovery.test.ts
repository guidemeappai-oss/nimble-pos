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
async function fixture() {
  const owner = await makeUser(db, `NQ-owner-${crypto.randomUUID()}`),
    ownerToken = await tokenFor(owner)
  const venue = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/venues',
      headers: auth(ownerToken),
      payload: { name: 'Recovery Café', fiatCurrency: 'EUR', nimAddress: owner.walletAddress },
    })
  ).json()
  const employee = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/employees`,
      headers: auth(ownerToken),
      payload: { name: 'Ana', pin: '1234' },
    })
  ).json()
  const terminal = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/terminal`,
      headers: auth(ownerToken),
    })
  ).json()
  const cashierToken = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/terminal/login',
      headers: { 'x-terminal-token': terminal.terminalToken },
      payload: { employeeId: employee.id, pin: '1234' },
    })
  ).json().token
  const shift = (
    await app.inject({ method: 'POST', url: '/v1/merchant/shifts', headers: auth(cashierToken) })
  ).json()
  const product = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/catalog`,
      headers: auth(ownerToken),
      payload: {
        name: 'Coffee',
        category: 'Drinks',
        variants: [{ id: crypto.randomUUID(), name: 'Regular', priceMinor: 510 }],
      },
    })
  ).json()
  const cart = {
    lines: [
      { productId: product.id, variantId: product.variants[0].id, extraIds: [], quantity: 2 },
    ],
  }
  const order = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: { ...auth(cashierToken), 'idempotency-key': crypto.randomUUID() },
      payload: cart,
    })
  ).json()
  app.deps.merchantPayments = {
    quote: async (input) => ({
      id: crypto.randomUUID(),
      ...input,
      network: 'nimiq:5',
      amountAtomic: '25500000',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      rate: '0.004',
      rateAt: new Date().toISOString(),
      rateSource: 'test',
    }),
    verify: async ({ quote, hash }) => ({ ...quote, hash, confirmedAt: new Date().toISOString() }),
  }
  const quoted = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/checkout/${order.checkoutToken}/quote`,
      payload: { revision: 1, asset: 'NIM', sender: 'NQ-recovery-payer' },
    })
  ).json()
  return {
    ownerToken,
    cashierToken,
    venue,
    shift,
    cart,
    order: quoted,
    orderUrl: `/v1/merchant/orders/${order.id}`,
    checkoutUrl: `/v1/merchant/checkout/${order.checkoutToken}`,
  }
}
it('cancels expired checkout and credits late transfer to refund after shift closure', async () => {
  const f = await fixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 180000)
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: f.orderUrl + '/status',
          headers: auth(f.cashierToken),
          payload: { revision: 1, status: 'CANCELLED' },
        })
      ).statusCode,
    ).toBe(200)
    const closed = await app.inject({
      method: 'POST',
      url: `/v1/merchant/shifts/${f.shift.id}/close`,
      headers: auth(f.cashierToken),
    })
    expect(closed.statusCode).toBe(200)
    expect(closed.json().totals.paid).toBe(0)
    app.deps.merchantPayments!.verify = async () => null
    const submitted = await app.inject({
      method: 'POST',
      url: f.checkoutUrl + '/payment',
      payload: { revision: 1, quoteId: f.order.quote.id, hash: '1'.repeat(64) },
    })
    expect(submitted.statusCode).toBe(200)
    expect(submitted.json().status).toBe('PAYMENT_PENDING')
    app.deps.merchantPayments!.verify = async ({ quote, hash }) => ({
      ...quote,
      hash,
      confirmedAt: new Date().toISOString(),
    })
    const { merchantReconciliationTick } = await import('../src/services/merchantSettlement')
    await merchantReconciliationTick(db, app.deps.merchantPayments!)
    const paid = await app.inject({ url: f.checkoutUrl })
    expect(paid.json()).toMatchObject({
      status: 'REFUND_PENDING',
      paidSnapshot: { revision: 1, totalMinor: 1020 },
      refund: { status: 'REQUESTED' },
      payment: { amountAtomic: '25500000' },
    })
    const approved = (
      await app.inject({
        method: 'POST',
        url: f.orderUrl + '/refund/approve',
        headers: auth(f.ownerToken),
      })
    ).json()
    expect(approved.refund.quote.amountAtomic).toBe('25500000')
    const refunded = await app.inject({
      method: 'POST',
      url: f.orderUrl + '/refund/payment',
      headers: auth(f.ownerToken),
      payload: { hash: '2'.repeat(64), quoteId: approved.refund.quote.id },
    })
    expect(refunded.json().status).toBe('REFUNDED')
    expect(
      (
        await app.inject({
          url: `/v1/merchant/shifts/${f.shift.id}/report`,
          headers: auth(f.cashierToken),
        })
      ).json().totals.paid,
    ).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
it('edits expired checkout and refunds an old revision transfer using original paid snapshot', async () => {
  const f = await fixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 180000)
  try {
    const edited = await app.inject({
      method: 'PATCH',
      url: f.orderUrl,
      headers: auth(f.cashierToken),
      payload: { revision: 1, lines: [{ ...f.cart.lines[0], quantity: 1 }] },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().totalMinor).toBe(510)
    const paid = await app.inject({
      method: 'POST',
      url: f.checkoutUrl + '/payment',
      payload: { revision: 1, quoteId: f.order.quote.id, hash: '3'.repeat(64) },
    })
    expect(paid.statusCode).toBe(200)
    expect(paid.json()).toMatchObject({
      revision: 2,
      totalMinor: 510,
      status: 'REFUND_PENDING',
      paidSnapshot: { revision: 1, totalMinor: 1020 },
      refund: { status: 'REQUESTED' },
    })
    expect(paid.json().lines[0].quantity).toBe(1)
    expect(paid.json().paidSnapshot.lines[0].quantity).toBe(2)
    expect(
      (
        await app.inject({
          url: `/v1/merchant/venues/${f.venue.id}/report`,
          headers: auth(f.ownerToken),
        })
      ).json().totals,
    ).toMatchObject({ grossMinor: 0, netMinor: 0, receivedMinor: 1020 })
  } finally {
    vi.useRealTimers()
  }
})
it('renews expired approved refund and accepts old proof while freezing the first submitted intent', async () => {
  const f = await fixture()
  await app.inject({
    method: 'POST',
    url: f.checkoutUrl + '/payment',
    payload: { revision: 1, quoteId: f.order.quote.id, hash: '4'.repeat(64) },
  })
  await app.inject({
    method: 'POST',
    url: f.orderUrl + '/refund',
    headers: auth(f.cashierToken),
    payload: {},
  })
  let refreshes = 0
  app.deps.merchantPayments!.refreshRefundQuote = async (quote) => ({
    ...quote,
    chainHeight: ++refreshes,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  })
  const initial = (
    await app.inject({
      method: 'POST',
      url: f.orderUrl + '/refund/approve',
      headers: auth(f.ownerToken),
    })
  ).json().refund.quote
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 180000)
  try {
    const renewed = (
      await app.inject({
        method: 'POST',
        url: f.orderUrl + '/refund/approve',
        headers: auth(f.ownerToken),
      })
    ).json().refund.quote
    expect(renewed.id).not.toBe(initial.id)
    expect(renewed.chainHeight).toBe(2)
    expect(renewed.amountAtomic).toBe(initial.amountAtomic)
    app.deps.merchantPayments!.verify = async () => null
    const proof = { hash: '5'.repeat(64), quoteId: initial.id }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: f.orderUrl + '/refund/payment',
          headers: auth(f.ownerToken),
          payload: proof,
        })
      ).json().refund.pendingHash,
    ).toBe(proof.hash)
    const frozen = (
      await app.inject({
        method: 'POST',
        url: f.orderUrl + '/refund/approve',
        headers: auth(f.ownerToken),
      })
    ).json().refund.quote
    expect(frozen.id).toBe(initial.id)
    expect(refreshes).toBe(2)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: f.orderUrl + '/refund/payment',
          headers: auth(f.ownerToken),
          payload: { ...proof, quoteId: renewed.id },
        })
      ).statusCode,
    ).toBe(409)
    app.deps.merchantPayments!.verify = async ({ quote, hash }) => {
      expect(quote.id).toBe(initial.id)
      return { ...quote, hash, confirmedAt: new Date().toISOString() }
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: f.orderUrl + '/refund/payment',
          headers: auth(f.ownerToken),
          payload: proof,
        })
      ).json().status,
    ).toBe('REFUNDED')
  } finally {
    vi.useRealTimers()
  }
})

it('records funds mined after expiry as requiring full refund instead of preparing the order', async () => {
    const f = await fixture()
    app.deps.merchantPayments!.verify = async ({ quote, hash }) => ({
        ...quote, hash, confirmedAt: new Date(Date.parse(quote.expiresAt) + 1000).toISOString(),
    })
    const result = await app.inject({ method: 'POST', url: f.checkoutUrl + '/payment', payload: {
            revision: 1, quoteId: f.order.quote.id, hash: 'c'.repeat(64),
        } })
    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject({ status: 'REFUND_PENDING', refund: { status: 'REQUESTED' }, payment: { hash: 'c'.repeat(64) } })
})
it('reconciles a corrected payment and refund hash without signing again or losing earlier attempts', async () => {
    const f = await fixture()
    app.deps.merchantPayments!.verify = async () => null
    const submit = (hash: string) => app.inject({ method: 'POST', url: f.checkoutUrl + '/payment', payload: { revision: 1, quoteId: f.order.quote.id, hash } })
    expect((await submit('d'.repeat(64))).statusCode).toBe(200)
    expect((await submit('e'.repeat(64))).statusCode).toBe(200)
    app.deps.merchantPayments!.verify = async ({ quote, hash }) => hash === 'e'.repeat(64) ? { ...quote, hash, confirmedAt: new Date().toISOString() } : null
    const { merchantReconciliationTick } = await import('../src/services/merchantSettlement')
    await merchantReconciliationTick(db, app.deps.merchantPayments!)
    const paid = (await app.inject({ url: f.checkoutUrl })).json()
    expect(paid).toMatchObject({ status: 'PREPARING', payment: { hash: 'e'.repeat(64) } })
    await app.inject({ method: 'POST', url: f.orderUrl + '/refund', headers: auth(f.cashierToken) })
    const approved = (await app.inject({ method: 'POST', url: f.orderUrl + '/refund/approve', headers: auth(f.ownerToken) })).json()
    app.deps.merchantPayments!.verify = async () => null
    for (const hash of ['f'.repeat(64), '0'.repeat(64)]) {
        expect((await app.inject({ method: 'POST', url: f.orderUrl + '/refund/payment', headers: auth(f.ownerToken), payload: { hash, quoteId: approved.refund.quote.id } })).statusCode).toBe(200)
    }
    app.deps.merchantPayments!.verify = async ({ quote, hash }) => hash === '0'.repeat(64) ? { ...quote, hash, confirmedAt: new Date().toISOString() } : null
    await merchantReconciliationTick(db, app.deps.merchantPayments!)
    expect((await app.inject({ url: f.checkoutUrl })).json()).toMatchObject({ status: 'REFUNDED', refund: { status: 'CONFIRMED' } })
})
it('does not let an already assigned transaction exclude a later valid attempt', async () => {
    const first = await fixture()
    const hash = '12'.repeat(32)
    expect((await app.inject({ method: 'POST', url: first.checkoutUrl + '/payment', payload: { revision: 1, quoteId: first.order.quote.id, hash } })).statusCode).toBe(200)
    const second = await fixture()
    expect((await app.inject({ method: 'POST', url: second.checkoutUrl + '/payment', payload: { revision: 1, quoteId: second.order.quote.id, hash } })).statusCode).toBe(409)
    const corrected = await app.inject({ method: 'POST', url: second.checkoutUrl + '/payment', payload: { revision: 1, quoteId: second.order.quote.id, hash: '34'.repeat(32) } })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json()).toMatchObject({ status: 'PREPARING', payment: { hash: '34'.repeat(32) } })
})
it.each([false, true])('decides fulfillment from the verified revision, preserving cancellation=%s', async (cancelled) => {
    const f = await fixture()
    const wrongHash = crypto.randomUUID().replaceAll('-', '').repeat(2)
    const correctHash = crypto.randomUUID().replaceAll('-', '').repeat(2)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
        vi.setSystemTime(Date.now() + 180000)
        await app.inject({ method: 'PATCH', url: f.orderUrl, headers: auth(f.cashierToken), payload: { revision: 1, lines: f.cart.lines.map(x => ({ ...x, quantity: 1 })) } })
        const current = (await app.inject({ method: 'POST', url: f.checkoutUrl + '/quote', payload: { revision: 2, asset: 'NIM', sender: 'NQ-recovery-payer' } })).json()
        if (cancelled) {
            vi.setSystemTime(Date.now() + 180000)
            expect((await app.inject({ method: 'POST', url: f.orderUrl + '/status', headers: auth(f.cashierToken), payload: { revision: 2, status: 'CANCELLED' } })).statusCode).toBe(200)
        }
        app.deps.merchantPayments!.verify = async () => null
        await app.inject({ method: 'POST', url: f.checkoutUrl + '/payment', payload: { revision: 1, quoteId: f.order.quote.id, hash: wrongHash } })
        app.deps.merchantPayments!.verify = async ({ quote, hash }) => hash === correctHash ? { ...quote, hash, confirmedAt: new Date(Date.parse(current.quote.issuedAt) + 1000).toISOString() } : null
        const paid = await app.inject({ method: 'POST', url: f.checkoutUrl + '/payment', payload: { revision: 2, quoteId: current.quote.id, hash: correctHash } })
        expect(paid.statusCode).toBe(200)
        expect(paid.json()).toMatchObject({ status: cancelled ? 'REFUND_PENDING' : 'PREPARING', paidSnapshot: { revision: 2, totalMinor: 510 } })
    }
    finally {
        vi.useRealTimers()
    }
})
