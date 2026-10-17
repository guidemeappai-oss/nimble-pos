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
const openRemote = async () => {
  await call('POST', `${remote}/venues/${venue.id}/heartbeat`, cashier)
  return call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, { accepting: true })
}
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
  await openRemote()
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
  expect((await call('POST', `${root}/orders/${order.id}/refund`, cashier, {})).statusCode).toBe(409)
  expect((await call('GET', `${remote}/orders/${order.id}`, customer)).json().status).toBe('AWAITING_ACCEPTANCE')
  const initialShift = (await call('GET', `${root}/shifts/current`, cashier)).json()
  expect((await call('POST', `${root}/shifts/${initialShift.id}/close`, cashier)).statusCode).toBe(200)
  expect((await call('POST', `${root}/orders/${order.id}/refund`, cashier, {})).statusCode).toBe(409)
  const unchanged = (await call('GET', `${remote}/orders/${order.id}`, customer)).json()
  expect(unchanged.status).toBe('AWAITING_ACCEPTANCE')
  expect(unchanged.refund).toBeNull()
  expect(unchanged.decision).toBeNull()
  await call('POST', root + '/shifts', cashier)
  await openRemote()
  const accepted = await call(
    'POST',
    `${remote}/orders/${order.id}/accept`,
    cashier,
    { preparationMinutes: 8 },
  )
  expect(accepted.statusCode).toBe(200)
  expect(accepted.json().pickup).toBeUndefined()
  order = (await call('GET', `${remote}/orders/${order.id}`, customer)).json()
  expect(order.pickup.token).toMatch(/^nimble-pickup:/)
})
it('previews without collecting and requires READY and a single verified pickup', async () => {
  const pickup = order.pickup
  expect(
    (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/pickup/preview`,
        cashier,
        { tokenOrCode: pickup.token },
      )
    ).json().status,
  ).toBe('PREPARING')
  expect(
    (
      await call('POST', `${remote}/orders/${order.id}/collect`, cashier, {
        tokenOrCode: pickup.token,
      })
    ).statusCode,
  ).toBe(409)
  expect(
    (
      await call('POST', `${root}/orders/${order.id}/status`, cashier, {
        revision: 1,
        status: 'COLLECTED',
      })
    ).statusCode,
  ).toBe(409)
  expect(
    (
      await call('POST', `${root}/orders/${order.id}/status`, cashier, {
        revision: 1,
        status: 'READY',
      })
    ).statusCode,
  ).toBe(200)
  expect(
    (
      await call('POST', `${remote}/orders/${order.id}/collect`, cashier, {
        tokenOrCode: pickup.code,
      })
    ).json().status,
  ).toBe('COLLECTED')
  expect(
    (
      await call('POST', `${remote}/orders/${order.id}/collect`, cashier, {
        tokenOrCode: pickup.token,
      })
    ).statusCode,
  ).toBe(404)
})
it('rejects with one refund obligation and excludes unaccepted payments from sales', async () => {
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
  const o = (
    await call(
      'POST',
      `${remote}/venues/${venue.id}/orders`,
      customer,
      cart,
      'reject',
    )
  ).json()
  const url = `${root}/checkout/${o.checkoutToken}`
  const q = (
    await call('POST', url + '/quote', customer, {
      revision: 1,
      asset: 'NIM',
      sender: 'NQ-remote-customer-123',
    })
  ).json()
  await call('POST', url + '/payment', customer, {
    revision: 1,
    quoteId: q.quote.id,
    hash: 'b'.repeat(64),
  })
  const rejected = await call(
    'POST',
    `${remote}/orders/${o.id}/reject`,
    cashier,
    { reason: 'Kitchen closed' },
  )
  expect(rejected.statusCode).toBe(200)
  expect(rejected.json().status).toBe('REFUND_PENDING')
  expect(rejected.json().decision).toBe('REJECTED')
  expect(rejected.json().refund.reason).toBe('Kitchen closed')
  expect(
    (
      await call('POST', `${remote}/orders/${o.id}/reject`, cashier, {
        reason: 'Kitchen closed',
      })
    ).json().refund.id,
  ).toBe(rejected.json().refund.id)
  expect(
    (await call('GET', `${remote}/orders/${o.id}`, customer)).json().pickup,
  ).toBeNull()
  const report = (
    await call('GET', `${root}/venues/${venue.id}/report`, owner)
  ).json()
  expect(report.totals.grossMinor).toBe(450)
  expect(report.totals.receivedMinor).toBe(900)
  expect(report.totals.refundPendingMinor).toBe(450)
  expect(
    (await call('POST', `${root}/orders/${o.id}/refund/approve`, cashier))
      .statusCode,
  ).toBe(403)
})
it('expires persisted acceptance deadlines without a terminal and does not accept late decisions', async () => {
  const { merchantOrder } = await import('../src/db/schema'),
    { eq } = await import('drizzle-orm'),
    { remoteAcceptanceTick } = await import('../src/services/remoteOrders')
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
  const o = (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'timeout',
      )
    ).json(),
    url = `${root}/checkout/${o.checkoutToken}`
  const q = (
    await call('POST', url + '/quote', customer, {
      revision: 1,
      asset: 'NIM',
      sender: 'NQ-remote-customer-123',
    })
  ).json()
  await call('POST', url + '/payment', customer, {
    revision: 1,
    quoteId: q.quote.id,
    hash: 'c'.repeat(64),
  })
  await db
    .update(merchantOrder)
    .set({ acceptanceDeadline: new Date(Date.now() - 1) })
    .where(eq(merchantOrder.id, o.id))
  await remoteAcceptanceTick(db)
  await remoteAcceptanceTick(db)
  const detail = (
    await call('GET', `${remote}/orders/${o.id}`, customer)
  ).json()
  expect(detail.decision).toBe('TIMED_OUT')
  expect(detail.refund.status).toBe('REQUESTED')
  expect(detail.pickup).toBeNull()
  expect(
    (
      await call('POST', `${remote}/orders/${o.id}/accept`, cashier, {
        preparationMinutes: 3,
      })
    ).statusCode,
  ).toBe(409)
})
it('honors an issued quote after pause while blocking new baskets, and preserves pickup address when hidden', async () => {
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
  const o = (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'pause',
      )
    ).json(),
    url = `${root}/checkout/${o.checkoutToken}`
  const q = (
    await call('POST', url + '/quote', customer, {
      revision: 1,
      asset: 'NIM',
      sender: 'NQ-remote-customer-123',
    })
  ).json()
  await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, {
    accepting: false,
  })
  expect(
    (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'paused',
      )
    ).statusCode,
  ).toBe(409)
  expect(
    (
      await call('POST', url + '/quote', customer, {
        revision: 1,
        asset: 'NIM',
        sender: 'NQ-remote-customer-123',
      })
    ).json().quote.id,
  ).toBe(q.quote.id)
  expect(
    (
      await call('POST', url + '/payment', customer, {
        revision: 1,
        quoteId: q.quote.id,
        hash: 'd'.repeat(64),
      })
    ).json().status,
  ).toBe('AWAITING_ACCEPTANCE')
  await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: false,
    description: 'Coffee',
    address: 'Main 1',
    city: 'Gliwice',
    pickupInstructions: 'Counter',
    preparationMinutes: 10,
  })
  expect(
    (await call('GET', `${remote}/orders/${o.id}`, customer)).json().venue
      .address,
  ).toBe('Main 1')
})
it('requires EVM proof without enrolling and awards loyalty only at acceptance, never rejection', async () => {
  await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: true,
    description: 'Coffee',
    address: 'Main 1',
    city: 'Gliwice',
    pickupInstructions: 'Counter',
    preparationMinutes: 10,
  })
  await openRemote()
  await call(
    'POST',
    `${root}/venues/${venue.id}/loyalty/program`,
    owner,
    {
      minimumMinor: 400,
      productId: product.id,
      variantId: product.variants[0].id,
    },
    'program',
  )
  const card = (
    await call(
      'POST',
      `${root}/venues/${venue.id}/loyalty/join`,
      customer,
      {},
      'join',
    )
  ).json()
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
  async function paid(key: string, hash: string) {
    const o = (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        key,
      )
    ).json()
    expect(o.id).toBeTruthy()
    const url = `${root}/checkout/${o.checkoutToken}`
    expect(
      (
        await call('POST', url + '/quote', customer, {
          revision: 1,
          asset: 'USDT',
          sender: '0x' + '2'.repeat(40),
        })
      ).json().error.code,
    ).toBe('LOYALTY_EVM_PROOF_REQUIRED')
    expect(
      (
        await call(
          'POST',
          url + '/loyalty',
          customer,
          { cardId: card.id, revision: 1 },
          key + 'bind',
        )
      ).statusCode,
    ).toBe(200)
    const q = (
      await call('POST', url + '/quote', customer, {
        revision: 1,
        asset: 'NIM',
        sender: 'NQ-remote-customer-123',
      })
    ).json()
    await call('POST', url + '/payment', customer, {
      revision: 1,
      quoteId: q.quote.id,
      hash: hash.repeat(64),
    })
    return o
  }
  const rejected = await paid('loyalty-reject', 'e')
  expect(
    (await call('GET', `${root}/loyalty/cards/${card.id}`, customer)).json()
      .balance,
  ).toBe(0)
  await call('POST', `${remote}/orders/${rejected.id}/reject`, cashier, {
    reason: 'Unavailable',
  })
  const approved = (
    await call('POST', `${root}/orders/${rejected.id}/refund/approve`, owner)
  ).json()
  expect(
    (
      await call(
        'POST',
        `${root}/orders/${rejected.id}/refund/payment`,
        owner,
        { hash: 'f'.repeat(64), quoteId: approved.refund.quote.id },
      )
    ).json().status,
  ).toBe('REFUNDED')
  expect(
    (await call('GET', `${root}/loyalty/cards/${card.id}`, customer)).json()
      .balance,
  ).toBe(0)
  const accepted = await paid('loyalty-accept', '1')
  await call('POST', `${remote}/orders/${accepted.id}/accept`, cashier, {
    preparationMinutes: 3,
  })
  await call('POST', `${remote}/orders/${accepted.id}/accept`, cashier, {
    preparationMinutes: 3,
  })
  expect(
    (await call('GET', `${root}/loyalty/cards/${card.id}`, customer)).json()
      .balance,
  ).toBe(1)
  await call('POST', `${root}/orders/${accepted.id}/refund`, cashier, {
    reason: 'Return',
  })
  const refund = (
    await call('POST', `${root}/orders/${accepted.id}/refund/approve`, owner)
  ).json()
  await call('POST', `${root}/orders/${accepted.id}/refund/payment`, owner, {
    hash: '2'.repeat(64),
    quoteId: refund.refund.quote.id,
  })
  expect(
    (await call('GET', `${root}/loyalty/cards/${card.id}`, customer)).json()
      .balance,
  ).toBe(0)
})
it('lets a cashier close a shift while the owner refund remains in the venue queue', async () => {
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
  const o = (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'shift-refund',
      )
    ).json(),
    url = `${root}/checkout/${o.checkoutToken}`
  const q = (
    await call('POST', url + '/quote', customer, {
      revision: 1,
      asset: 'NIM',
      sender: 'NQ-remote-customer-123',
    })
  ).json()
  await call('POST', url + '/payment', customer, {
    revision: 1,
    quoteId: q.quote.id,
    hash: '3'.repeat(64),
  })
  await call('POST', `${remote}/orders/${o.id}/reject`, cashier, {
    reason: 'Closing kitchen',
  })
  const shift = (await call('GET', `${root}/shifts/current`, cashier)).json()
  expect(
    (await call('POST', `${root}/shifts/${shift.id}/close`, cashier))
      .statusCode,
  ).toBe(200)
  const report = (
    await call('GET', `${root}/venues/${venue.id}/report`, owner)
  ).json()
  expect(report.orders.find((x: any) => x.id === o.id).refund.status).toBe(
    'REQUESTED',
  )
  expect(
    (await call('GET', `${root}/venues/${venue.id}/orders`, cashier))
      .json()
      .some((x: any) => x.id === o.id),
  ).toBe(true)
  expect(
    (await call('GET', `${remote}/venues`)).json().venues[0].available,
  ).toBe(false)
})
it('preserves the first loyalty promise while a paid remote order awaits acceptance across program versions', async () => {
  await call('POST', root + '/shifts', cashier)
  await openRemote()
  const newVariant = { id: crypto.randomUUID(), name: 'Small', priceMinor: 300 }
  const updated = { ...product, variants: [...product.variants, newVariant] }
  expect(
    (await call('POST', `${root}/venues/${venue.id}/catalog`, owner, updated))
      .statusCode,
  ).toBe(200)
  const card = (
    await call(
      'POST',
      `${root}/venues/${venue.id}/loyalty/join`,
      customer,
      {},
      'promise-join',
    )
  ).json()
  expect(card.balance).toBe(0)
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
  const o = (
      await call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'promise-remote',
      )
    ).json(),
    url = `${root}/checkout/${o.checkoutToken}`
  await call(
    'POST',
    url + '/loyalty',
    customer,
    { revision: 1, cardId: card.id },
    'promise-bind',
  )
  const q = (
    await call('POST', url + '/quote', customer, {
      revision: 1,
      asset: 'NIM',
      sender: 'NQ-remote-customer-123',
    })
  ).json()
  expect(
    (
      await call('POST', url + '/payment', customer, {
        revision: 1,
        quoteId: q.quote.id,
        hash: '4'.repeat(64),
      })
    ).json().status,
  ).toBe('AWAITING_ACCEPTANCE')
  expect(
    (
      await call(
        'POST',
        `${root}/venues/${venue.id}/loyalty/program`,
        owner,
        { minimumMinor: 400, productId: product.id, variantId: newVariant.id },
        'promise-p2',
      )
    ).statusCode,
  ).toBe(200)
  expect(
    (
      await call(
        'POST',
        `${root}/venues/${venue.id}/loyalty/join`,
        customer,
        {},
        'promise-join-p2',
      )
    ).json().id,
  ).toBe(card.id)
  const removal = await call(
    'POST',
    `${root}/venues/${venue.id}/catalog`,
    owner,
    { ...updated, variants: [newVariant] },
  )
  expect(removal.statusCode).toBe(409)
  expect(removal.json().error.code).toBe('LOYALTY_REWARD_PRODUCT_LOCKED')
  expect(
    (
      await call('POST', `${remote}/orders/${o.id}/accept`, cashier, {
        preparationMinutes: 5,
      })
    ).json().status,
  ).toBe('PREPARING')
  expect(
    (await call('GET', `${root}/loyalty/cards/${card.id}`, customer)).json()
      .balance,
  ).toBe(1)
})
// Same scenarios are reusable against native PostgreSQL; PGlite does not prove
// separate-session lock scheduling and is not the production concurrency gate.
it('serializes concurrent create, duplicate acceptance and competing pickup requests', async () => {
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
  const created = await Promise.all(
    [0, 1].map(() =>
      call(
        'POST',
        `${remote}/venues/${venue.id}/orders`,
        customer,
        cart,
        'competing-create',
      ),
    ),
  )
  expect(created.map((r) => r.statusCode)).toEqual([201, 201])
  const o = created[0].json()
  expect(created[1].json().id).toBe(o.id)
  const card = (
      await call(
        'POST',
        `${root}/venues/${venue.id}/loyalty/join`,
        customer,
        {},
        'competing-join',
      )
    ).json(),
    before = card.balance,
    url = `${root}/checkout/${o.checkoutToken}`
  expect(
    (
      await call(
        'POST',
        url + '/loyalty',
        customer,
        { revision: 1, cardId: card.id },
        'competing-bind',
      )
    ).statusCode,
  ).toBe(200)
  const q = (
    await call('POST', url + '/quote', customer, {
      revision: 1,
      asset: 'NIM',
      sender: 'NQ-remote-customer-123',
    })
  ).json()
  await call('POST', url + '/payment', customer, {
    revision: 1,
    quoteId: q.quote.id,
    hash: '5'.repeat(64),
  })
  const decisions = await Promise.all(
    [0, 1].map(() =>
      call('POST', `${remote}/orders/${o.id}/accept`, cashier, {
        preparationMinutes: 5,
      }),
    ),
  )
  expect(decisions.map((r) => r.statusCode)).toEqual([200, 200])
  expect(decisions[0].json().decisionAt).toBe(decisions[1].json().decisionAt)
  expect(
    (await call('GET', `${root}/loyalty/cards/${card.id}`, customer)).json()
      .balance,
  ).toBe(before + 1)
  const detail = (
    await call('GET', `${remote}/orders/${o.id}`, customer)
  ).json()
  await call('POST', `${root}/orders/${o.id}/status`, cashier, {
    revision: 1,
    status: 'READY',
  })
  const pickups = await Promise.all(
    [0, 1].map(() =>
      call('POST', `${remote}/orders/${o.id}/collect`, cashier, {
        tokenOrCode: detail.pickup.token,
      }),
    ),
  )
  expect(pickups.map((r) => r.statusCode).sort()).toEqual([200, 404])
  expect(
    (await call('GET', `${remote}/orders/${o.id}`, customer)).json().status,
  ).toBe('COLLECTED')
})

it('persists timed order pauses and requires live cashier presence before reopening', async () => {
  const configured = await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: true,
    description: 'Coffee',
    address: 'Main 1',
    city: 'Gliwice',
    pickupInstructions: 'Counter',
    preparationMinutes: 12,
    queueLimit: 4,
  })
  expect(configured.statusCode).toBe(200)
  expect(configured.json().queueLimit).toBe(4)

  const paused = await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, {
    accepting: false,
    pauseMinutes: 15,
  })
  expect(paused.statusCode).toBe(200)
  const deadline = paused.json().pausedUntil
  expect(Date.parse(deadline)).toBeGreaterThan(Date.now())
  expect((await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue.pausedUntil).toBe(deadline)

  const earlyReopen = await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, { accepting: true })
  expect(earlyReopen.statusCode).toBe(409)
  expect(earlyReopen.json().error.code).toBe('PAUSE_NOT_EXPIRED')

  const repeatedClose = await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, { accepting: false })
  expect(repeatedClose.statusCode).toBe(200)
  expect(repeatedClose.json().pausedUntil).toBe(deadline)
  const earlyReopenAfterRepeatedClose = await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, { accepting: true })
  expect(earlyReopenAfterRepeatedClose.statusCode).toBe(409)
  expect(earlyReopenAfterRepeatedClose.json().error.code).toBe('PAUSE_NOT_EXPIRED')

  const { merchantVenue } = await import('../src/db/schema')
  await db.update(merchantVenue).set({ remotePausedUntil: new Date(Date.now() - 1000), remoteHeartbeatAt: new Date(Date.now() - 61000) }).where((await import('drizzle-orm')).eq(merchantVenue.id, venue.id))
  const staleReopen = await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, { accepting: true })
  expect(staleReopen.statusCode).toBe(409)
  expect(staleReopen.json().error.code).toBe('TERMINAL_OFFLINE')

  await call('POST', `${remote}/venues/${venue.id}/heartbeat`, cashier)
  const reopened = await call('PATCH', `${remote}/venues/${venue.id}/availability`, cashier, { accepting: true })
  expect(reopened.statusCode).toBe(200)
  expect(reopened.json().accepting).toBe(true)
  expect(reopened.json().pausedUntil).toBeNull()
})

it('blocks new remote orders at the active queue limit without counting unpaid baskets', async () => {
  const { merchantOrder, merchantVenue } = await import('../src/db/schema')
  const { eq } = await import('drizzle-orm')
  app.deps.merchantPayments = {
    quote: async (i) => ({ ...i, id: crypto.randomUUID(), network: 'nimiq:5', amountAtomic: '100000', expiresAt: new Date(Date.now() + 60000).toISOString(), rate: '1', rateAt: new Date().toISOString(), rateSource: 'test' }),
    verify: async ({ quote, hash }) => ({ ...quote, hash, confirmedAt: new Date().toISOString() }),
    refreshRefundQuote: async (q) => q,
  }
  const before = (await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue.activeOrders as number
  const queueLimit = before + 1
  const settingsUpdate = await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: true,
    description: 'Coffee',
    address: 'Main 1',
    city: 'Gliwice',
    pickupInstructions: 'Counter',
    preparationMinutes: 10,
    queueLimit,
  })
  expect(settingsUpdate.statusCode).toBe(200)
  const currentShift = (await call('GET', `${root}/shifts/current`, cashier)).json()
  if (!currentShift?.id) await call('POST', `${root}/shifts`, cashier)
  await openRemote()
  const nextCustomer = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-queue-limit-customer'))}` }
  const cart = { lines: [{ productId: product.id, variantId: product.variants[0].id, extraIds: [], quantity: 1 }] }
  const accepted = await call('POST', `${remote}/venues/${venue.id}/orders`, nextCustomer.authorization.slice(7), cart, 'queue-limit-first')
  expect(accepted.statusCode).toBe(201)
  expect((await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue.activeOrders).toBe(before)
  const checkoutUrl = `${root}/checkout/${accepted.json().checkoutToken}`
  const quoteResponse = await call('POST', `${checkoutUrl}/quote`, nextCustomer.authorization.slice(7), { revision: 1, asset: 'NIM', sender: 'NQ-queue-limit-customer' })
  expect(quoteResponse.statusCode).toBe(200)
  const issuedQuote = quoteResponse.json().quote

  const venueState = (await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue
  expect(venueState.activeOrders).toBe(queueLimit)
  expect(venueState.unavailableReason).toBe('BUSY')
  const blocked = await call('POST', `${remote}/venues/${venue.id}/orders`, owner, cart, 'queue-limit-second')
  expect(blocked.statusCode).toBe(409)
  expect(blocked.json().error.code).toBe('VENUE_BUSY')
  const retainedQuote = await call('POST', `${checkoutUrl}/quote`, nextCustomer.authorization.slice(7), { revision: 1, asset: 'NIM', sender: 'NQ-queue-limit-customer' })
  expect(retainedQuote.statusCode).toBe(200)
  expect(retainedQuote.json().quote.id).toBe(issuedQuote.id)
  const paid = await call('POST', `${checkoutUrl}/payment`, nextCustomer.authorization.slice(7), { revision: 1, quoteId: issuedQuote.id, hash: crypto.randomUUID().replaceAll('-', '').repeat(2) })
  expect(paid.statusCode, JSON.stringify(paid.json())).toBe(200)
  expect(paid.json().status).toBe('AWAITING_ACCEPTANCE')
  expect((await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue.activeOrders).toBe(queueLimit)

  const acceptedPromise = await call('POST', `${remote}/orders/${accepted.json().id}/accept`, cashier, { preparationMinutes: 12 })
  expect(acceptedPromise.statusCode).toBe(200)
  expect(acceptedPromise.json().preparationMinutes).toBe(12)
  await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: true,
    description: 'Coffee',
    address: 'Main 1',
    city: 'Gliwice',
    pickupInstructions: 'Counter',
    preparationMinutes: 25,
    queueLimit,
  })
  const preservedPromise = await call('GET', `${remote}/orders/${accepted.json().id}`, nextCustomer.authorization.slice(7))
  expect(preservedPromise.json().preparationMinutes).toBe(12)
  expect(preservedPromise.json().venue.preparationMinutes).toBe(25)

  await db.update(merchantOrder).set({ status: 'CANCELLED' }).where(eq(merchantOrder.id, accepted.json().id))
  await db.update(merchantVenue).set({ remoteQueueLimit: 10 }).where(eq(merchantVenue.id, venue.id))
})

it('reserves the last queue slot for only one concurrent checkout quote', async () => {
  const { merchantOrder, merchantVenue } = await import('../src/db/schema')
  const { eq } = await import('drizzle-orm')
  const before = (await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue.activeOrders as number
  await call('PATCH', `${remote}/venues/${venue.id}/settings`, owner, {
    published: true, description: 'Coffee', address: 'Main 1', city: 'Gliwice', pickupInstructions: 'Counter', preparationMinutes: 10, queueLimit: before + 1,
  })
  const currentShift = (await call('GET', `${root}/shifts/current`, cashier)).json()
  if (!currentShift?.id) await call('POST', `${root}/shifts`, cashier)
  await openRemote()
  const cart = { lines: [{ productId: product.id, variantId: product.variants[0].id, extraIds: [], quantity: 1 }] }
  const addresses = [1,2].map(() => 'NQ-queue-'+crypto.randomUUID())
  const buyers = await Promise.all(addresses.map(async address => tokenFor(await makeUser(db, address))))
  const orders = await Promise.all(buyers.map(buyer => call('POST', `${remote}/venues/${venue.id}/orders`, buyer, cart, crypto.randomUUID())))
  expect(orders.map(r => r.statusCode)).toEqual([201,201])
  try {
    const quotes = await Promise.all(orders.map((r,i) => call('POST', `${root}/checkout/${r.json().checkoutToken}/quote`, buyers[i], { revision: 1, asset: 'NIM', sender: addresses[i] })))
    expect(quotes.map(r => r.statusCode).sort(), JSON.stringify(quotes.map(r=>r.json()))).toEqual([200,409])
    expect(quotes.find(r => r.statusCode === 409)!.json().error.code).toBe('VENUE_BUSY')
    expect((await call('GET', `${remote}/venues/${venue.id}`, customer)).json().venue.activeOrders).toBe(before + 1)
  } finally {
    for (const order of orders) await db.update(merchantOrder).set({ status: 'CANCELLED' }).where(eq(merchantOrder.id, order.json().id))
    await db.update(merchantVenue).set({ remoteQueueLimit: 10 }).where(eq(merchantVenue.id, venue.id))
  }
})
