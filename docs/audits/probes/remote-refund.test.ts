import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import { env } from '../src/env'
const { db, close } = await freshDb(),
  { app, tokenFor } = authedApp(db)
afterAll(async () => {
  await app.close()
  await close()
})
const root = '/v1/merchant',
  remote = root + '/remote'
let owner: string,
  customer: string,
  cashier: string,
  venue: any,
  product: any,
  order: any
const call = async (
  method: any,
  url: string,
  token?: string,
  payload?: any,
  key?: string,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload,
  })
it('publishes a venue but requires an active cashier to accept remote orders', async () => {
  env.remoteOrderingEnabled = true
  owner = await tokenFor(await makeUser(db, 'NQ-remote-owner-123'))
  customer = await tokenFor(await makeUser(db, 'NQ-remote-customer-123'))
  venue = (
    await call('POST', root + '/venues', owner, {
      name: 'Remote Café',
      fiatCurrency: 'EUR',
      nimAddress: 'NQ-remote-owner-123',
    })
  ).json()
  expect((await call('GET', remote + '/venues')).json().venues).toEqual([])
  await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: true,
    description: 'Coffee',
    address: 'Main 1',
    city: 'Gliwice',
    pickupInstructions: 'Counter',
    preparationMinutes: 10,
  })
  expect(
    (await call('GET', remote + '/venues')).json().venues[0].available,
  ).toBe(false)
  const employee = (
    await call('POST', `${root}/venues/${venue.id}/employees`, owner, {
      name: 'Ana',
      pin: '1234',
    })
  ).json()
  const paired = (
    await call('POST', `${root}/venues/${venue.id}/terminal`, owner)
  ).json()
  cashier = (
    await app.inject({
      method: 'POST',
      url: root + '/terminal/login',
      headers: { 'x-terminal-token': paired.terminalToken },
      payload: { employeeId: employee.id, pin: '1234' },
    })
  ).json().token
  await call('POST', root + '/shifts', cashier)
  await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, {
    accepting: true,
  })
  expect(
    (await call('GET', remote + '/venues')).json().venues[0].available,
  ).toBe(true)
  product = (
    await call('POST', `${root}/venues/${venue.id}/catalog`, owner, {
      name: 'Coffee',
      category: 'Drinks',
      variants: [{ id: crypto.randomUUID(), name: 'Large', priceMinor: 450 }],
      extras: [],
    })
  ).json()
})
it('creates a customer-owned idempotent order and protects every checkout read', async () => {
  const cart = {
    lines: [
      {
        productId: product.id,
        variantId: product.variants[0].id,
        extraIds: [],
        quantity: 1,
      },
    ],
  }
  const response = await call(
    'POST',
    `${remote}/venues/${venue.id}/orders`,
    customer,
    cart,
    'one',
  )
  expect(response.statusCode).toBe(201)
  order = response.json()
  expect(order.shiftId).toBeNull()
  expect(order.source).toBe('REMOTE')
  expect(
    (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'one',
      )
    ).json().id,
  ).toBe(order.id)
  expect(
    (await call('GET', `${root}/checkout/${order.checkoutToken}`)).statusCode,
  ).toBe(401)
  expect(
    (await call('GET', `${root}/checkout/${order.checkoutToken}`, owner))
      .statusCode,
  ).toBe(404)
})
it('checks payer without loyalty, waits for explicit acceptance, and issues recoverable pickup', async () => {
  app.deps.merchantPayments = {
    quote: async (i) => ({
      ...i,
      id: crypto.randomUUID(),
      network: 'nimiq:5',
      amountAtomic: '100000',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      rate: '1',
      rateAt: new Date().toISOString(),
      rateSource: 'test',
    }),
    verify: async ({ quote, hash }) => ({
      ...quote,
      hash,
      confirmedAt: new Date().toISOString(),
    }),
    refreshRefundQuote: async (q) => q,
  }
  const url = `${root}/checkout/${order.checkoutToken}`
  expect(
    (
      await call('POST', url + '/quote', customer, {
        revision: 1,
        asset: 'NIM',
        sender: 'NQ-wrong-remote-123',
      })
    ).statusCode,
  ).toBe(409)
  const quote = await call('POST', url + '/quote', customer, {
    revision: 1,
    asset: 'NIM',
    sender: 'NQ-remote-customer-123',
  })
  expect(quote.statusCode).toBe(200)
  order = quote.json()
  const paid = await call('POST', url + '/payment', customer, {
    revision: 1,
    quoteId: order.quote.id,
    hash: 'a'.repeat(64),
  })
  expect(paid.statusCode).toBe(200)
  expect(paid.json().status).toBe('AWAITING_ACCEPTANCE')
  const refunded = await call('POST', `${root}/orders/${order.id}/refund`, cashier, {})
  expect(refunded.statusCode).toBe(409)
})
