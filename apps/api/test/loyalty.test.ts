import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(async () => {
  await app.close()
  await close()
})
const auth = (token: string, key: string = crypto.randomUUID()) => ({
  authorization: `Bearer ${token}`,
  'idempotency-key': key,
})
let owner: string, customer: string, venue: any, product: any, card: any
it('owner publishes rules and customer voluntarily joins a private recoverable card', async () => {
  owner = await tokenFor(await makeUser(db, 'NQ-owner-loyalty-123'))
  customer = await tokenFor(await makeUser(db, 'NQ-customer-loyalty-123'))
  venue = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/venues',
      headers: auth(owner),
      payload: {
        name: 'Cafe',
        fiatCurrency: 'EUR',
        nimAddress: 'NQ-owner-loyalty-123',
        usdtAddress: '0x' + '1'.repeat(40),
      },
    })
  ).json()
  product = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/catalog`,
      headers: auth(owner),
      payload: {
        name: 'Coffee',
        category: 'Drinks',
        variants: [{ id: crypto.randomUUID(), name: 'Small', priceMinor: 450 }],
        extras: [],
      },
    })
  ).json()
  const url = `/v1/merchant/venues/${venue.id}/loyalty/program`
  const input = {
    minimumMinor: 400,
    productId: product.id,
    variantId: product.variants[0].id,
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: auth(customer),
        payload: input,
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: auth(owner),
        payload: input,
      })
    ).statusCode,
  ).toBe(200)
  expect((await app.inject({ url })).json()).toMatchObject({
    threshold: 5,
    minimumMinor: 400,
    productName: 'Coffee',
  })
  card = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/loyalty/join`,
      headers: auth(customer),
      payload: {},
    })
  ).json()
  expect(card).toMatchObject({ balance: 0, available: 0, entries: [] })
  expect(
    (
      await app.inject({
        url: '/v1/merchant/loyalty/cards',
        headers: auth(customer),
      })
    ).json(),
  ).toHaveLength(1)
  expect(
    (
      await app.inject({
        url: `/v1/merchant/loyalty/cards/${card.id}`,
        headers: auth(owner),
      })
    ).statusCode,
  ).toBe(404)
})
let cashier: string
const bought: any[] = []
async function sale(
  opts: {
    bind?: boolean
    quantity?: number
    sender?: string
    asset?: 'NIM' | 'USDT'
  } = {},
) {
  const made = await app.inject({
    method: 'POST',
    url: '/v1/merchant/orders',
    headers: auth(cashier),
    payload: {
      lines: [
        {
          productId: product.id,
          variantId: product.variants[0].id,
          extraIds: [],
          quantity: opts.quantity ?? 1,
        },
      ],
    },
  })
  expect(made.statusCode).toBe(201)
  const o = made.json(),
    url = `/v1/merchant/checkout/${o.checkoutToken}`
  if (opts.bind !== false) {
    const binding = await app.inject({
      method: 'POST',
      url: url + '/loyalty',
      headers: auth(customer),
      payload: { cardId: card.id, revision: 1 },
    })
    expect(binding.statusCode).toBe(200)
  }
  const quoted = await app.inject({
    method: 'POST',
    url: url + '/quote',
    payload: {
      revision: 1,
      asset: opts.asset ?? 'NIM',
      sender: opts.sender ?? 'NQ-customer-loyalty-123',
    },
  })
  if (quoted.statusCode !== 200) return { o, url, quoted }
  const q = quoted.json()
  const paid = await app.inject({
    method: 'POST',
    url: url + '/payment',
    payload: {
      revision: 1,
      quoteId: q.quote.id,
      hash: crypto.randomUUID().replaceAll('-', '').repeat(2),
    },
  })
  expect(paid.statusCode).toBe(200)
  expect(paid.json().status).toBe('PREPARING')
  bought.push(paid.json())
  return { o: paid.json(), url, quoted }
}
const getCard = async () =>
  (
    await app.inject({
      url: `/v1/merchant/loyalty/cards/${card.id}`,
      headers: auth(customer),
    })
  ).json()
it('five confirmed purchases earn once and one reward travels through the cashier queue', async () => {
  const employee = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/employees`,
      headers: auth(owner),
      payload: { name: 'Ana', pin: '1234' },
    })
  ).json()
  const terminal = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/terminal`,
      headers: auth(owner),
    })
  ).json()
  cashier = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/terminal/login',
      headers: { 'x-terminal-token': terminal.terminalToken },
      payload: { employeeId: employee.id, pin: '1234' },
    })
  ).json().token
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/merchant/shifts',
        headers: auth(cashier),
      })
    ).statusCode,
  ).toBe(201)
  app.deps.merchantPayments = {
    quote: async (input) => ({
      ...input,
      id: crypto.randomUUID(),
      network: input.asset === 'NIM' ? 'nimiq:5' : 'eip155:137',
      amountAtomic: '1000',
      rate: '1',
      rateAt: new Date().toISOString(),
      rateSource: 'test',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120000).toISOString(),
    }),
    verify: async ({ quote, hash }) => ({
      ...quote,
      hash,
      confirmedAt: new Date().toISOString(),
    }),
  }
  for (let i = 0; i < 5; i++) await sale()
  expect(await getCard()).toMatchObject({ balance: 5, available: 5 })
  const publicOrder = (
    await app.inject({
      url: `/v1/merchant/checkout/${bought[0].checkoutToken}`,
    })
  ).json()
  expect(publicOrder).not.toHaveProperty('loyalty')
  const key = 'reserve-first'
  const reserve = await app.inject({
    method: 'POST',
    url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
    headers: auth(customer, key),
    payload: {},
  })
  expect(reserve.statusCode).toBe(200)
  const reward = reserve.json()
  expect(reward.token).toBeTruthy()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
        headers: auth(customer, key),
        payload: {},
      })
    ).json(),
  ).toEqual(reward)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
        headers: auth(customer),
        payload: {},
      })
    ).statusCode,
  ).toBe(409)
  const accept = () =>
    app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/loyalty/accept`,
      headers: auth(cashier),
      payload: { token: reward.token },
    })
  const accepted = await accept()
  expect(accepted.statusCode).toBe(200)
  expect(accepted.json().status).toBe('PREPARING')
  expect((await accept()).json().id).toBe(reward.id)
  expect(await getCard()).toMatchObject({ balance: 0, available: 0 })
  for (const status of ['READY', 'COLLECTED'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/merchant/loyalty/rewards/${reward.id}/status`,
          headers: auth(cashier),
          payload: { status },
        })
      ).json().status,
    ).toBe(status)
  expect(
    (
      await app.inject({
        url: `/v1/merchant/venues/${venue.id}/loyalty/report`,
        headers: auth(owner),
      })
    ).json(),
  ).toMatchObject({ cards: 1, earned: 5, collectedRewards: 1 })
  expect(
    (
      await app.inject({
        url: `/v1/merchant/venues/${venue.id}/report`,
        headers: auth(owner),
      })
    ).json().totals,
  ).toMatchObject({ paid: 5, grossMinor: 2250 })
})
async function requestRefund(order: any) {
  return app.inject({
    method: 'POST',
    url: `/v1/merchant/orders/${order.id}/refund`,
    headers: auth(cashier),
    payload: { reason: 'Customer return' },
  })
}
async function confirmRefund(order: any) {
  const approved = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/orders/${order.id}/refund/approve`,
      headers: auth(owner),
    })
  ).json()
  const confirmed = await app.inject({
    method: 'POST',
    url: `/v1/merchant/orders/${order.id}/refund/payment`,
    headers: auth(owner),
    payload: {
      hash: crypto.randomUUID().replaceAll('-', '').repeat(2),
      quoteId: approved.refund.quote.id,
    },
  })
  expect(confirmed.statusCode).toBe(200)
  expect(confirmed.json().status).toBe('REFUNDED')
}
it('refund after collected reward creates debt without reducing the full refund and next purchase pays it off', async () => {
  expect((await requestRefund(bought[0])).statusCode).toBe(200)
  expect(await getCard()).toMatchObject({
    balance: 0,
    available: -1,
    refundHolds: 1,
  })
  await confirmRefund(bought[0])
  expect(await getCard()).toMatchObject({
    balance: -1,
    available: -1,
    refundHolds: 0,
  })
  await sale()
  expect(await getCard()).toMatchObject({ balance: 0, available: 0 })
})
it('unconfirmed transfers and mismatching identity never earn, while optional participation remains optional', async () => {
  const mismatch = await sale({ sender: 'NQ-somebody-else-123' })
  expect(mismatch.quoted.statusCode).toBe(409)
  expect(mismatch.quoted.json().error.code).toBe('LOYALTY_PAYER_MISMATCH')
  const badEvm = await sale({ asset: 'USDT', sender: '0x' + '2'.repeat(40) })
  expect(badEvm.quoted.statusCode).toBe(409)
  expect(badEvm.quoted.json().error.code).toBe('LOYALTY_EVM_PROOF_REQUIRED')
  await sale({ bind: false })
  expect(await getCard()).toMatchObject({ balance: 0 })
  const original = app.deps.merchantPayments!.verify
  app.deps.merchantPayments!.verify = async () => null
  const o = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: auth(cashier),
      payload: {
        lines: [
          {
            productId: product.id,
            variantId: product.variants[0].id,
            extraIds: [],
            quantity: 1,
          },
        ],
      },
    })
  ).json()
  const url = `/v1/merchant/checkout/${o.checkoutToken}`
  await app.inject({
    method: 'POST',
    url: url + '/loyalty',
    headers: auth(customer),
    payload: { cardId: card.id, revision: 1 },
  })
  const q = (
    await app.inject({
      method: 'POST',
      url: url + '/quote',
      payload: { asset: 'NIM', sender: 'NQ-customer-loyalty-123', revision: 1 },
    })
  ).json()
  await app.inject({
    method: 'POST',
    url: url + '/payment',
    payload: { hash: 'a'.repeat(64), quoteId: q.quote.id, revision: 1 },
  })
  expect(await getCard()).toMatchObject({ balance: 0 })
  app.deps.merchantPayments!.verify = original
})
it('unaccepted reservations cancel on refund request and expiry releases stamps; accepted cancellation restores exactly once', async () => {
  for (let i = 0; i < 5; i++) await sale()
  const reserve = async (key: string = crypto.randomUUID()) =>
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
        headers: auth(customer, key),
        payload: {},
      })
    ).json()
  const reward = await reserve()
  expect(await getCard()).toMatchObject({
    balance: 5,
    available: 0,
    reserved: 5,
  })
  await requestRefund(bought.at(-1))
  expect(
    (await getCard()).rewards.find((r: any) => r.id === reward.id).status,
  ).toBe('CANCELLED')
  expect(await getCard()).toMatchObject({
    balance: 5,
    available: 4,
    refundHolds: 1,
  })
  await confirmRefund(bought.at(-1))
  await sale()
  const next = await reserve()
  await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${venue.id}/loyalty/accept`,
    headers: auth(cashier),
    payload: { token: next.token },
  })
  for (let i = 0; i < 2; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/merchant/loyalty/rewards/${next.id}/cancel`,
          headers: auth(cashier),
          payload: {},
        })
      ).statusCode,
    ).toBe(200)
  expect(await getCard()).toMatchObject({ balance: 5, available: 5 })
})

it('unavailable reward preserves stamps and expired reservations are recoverable without spending', async () => {
  const reserved = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
      headers: auth(customer),
      payload: {},
    })
  ).json()
  expect(
    (await getCard()).rewards.find((r: any) => r.id === reserved.id).token,
  ).toBe(reserved.token)
  const availability = `/v1/merchant/venues/${venue.id}/catalog/${product.id}/availability`
  await app.inject({
    method: 'PATCH',
    url: availability,
    headers: auth(cashier),
    payload: { available: false },
  })
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/venues/${venue.id}/loyalty/accept`,
        headers: auth(cashier),
        payload: { token: reserved.token },
      })
    ).statusCode,
  ).toBe(409)
  expect(await getCard()).toMatchObject({ balance: 5, reserved: 5 })
  await app.inject({
    method: 'PATCH',
    url: availability,
    headers: auth(cashier),
    payload: { available: true },
  })
  const { vi } = await import('vitest')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 301000)
  try {
    expect(await getCard()).toMatchObject({
      balance: 5,
      available: 5,
      reserved: 0,
    })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/merchant/venues/${venue.id}/loyalty/accept`,
          headers: auth(cashier),
          payload: { token: reserved.token },
        })
      ).statusCode,
    ).toBe(409)
  } finally {
    vi.useRealTimers()
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/loyalty/rewards/${reserved.id}/cancel`,
      headers: auth(customer),
      payload: {},
    })
  }
})
it('concurrent last-five reservations have one winner and cancelled retries restore only once', async () => {
  const responses = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
        headers: auth(customer),
        payload: {},
      }),
    ),
  )
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409])
  const reward = responses.find((r) => r.statusCode === 200)!.json()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/loyalty/rewards/${reward.id}/cancel`,
        headers: auth(customer),
        payload: {},
      })
    ).statusCode,
  ).toBe(200)
  expect(await getCard()).toMatchObject({ balance: 5, available: 5 })
})
it('EVM proof links only its signer with nonce replay defence and USDT shares the same Nimiq card', async () => {
  const { privateKeyToAccount } = await import('viem/accounts'),
    signer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
  const challenge = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/loyalty/evm/challenge',
      headers: auth(customer),
      payload: { address: signer.address },
    })
  ).json()
  expect(challenge.message).toContain('EVM chain: 137')
  expect(challenge.message).toContain('Domain: nimble.gallareton.pl')
  const signature = await signer.signMessage({ message: challenge.message })
  const verify = () =>
    app.inject({
      method: 'POST',
      url: '/v1/merchant/loyalty/evm/verify',
      headers: auth(customer),
      payload: { challengeId: challenge.id, signature },
    })
  expect((await verify()).statusCode).toBe(200)
  expect((await verify()).statusCode).toBe(401)
  await sale({ asset: 'USDT', sender: signer.address })
  expect(await getCard()).toMatchObject({ balance: 6 })
  const other = await tokenFor(await makeUser(db, 'NQ-other-customer-loyalty'))
  const another = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/loyalty/evm/challenge',
      headers: auth(other),
      payload: { address: signer.address },
    })
  ).json()
  const anotherSignature = await signer.signMessage({
    message: another.message,
  })
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/merchant/loyalty/evm/verify',
        headers: auth(other),
        payload: { challengeId: another.id, signature: anotherSignature },
      })
    ).statusCode,
  ).toBe(409)
})
it('new rules preserve open cards, disabling stops earning while promised rewards remain redeemable', async () => {
  const programUrl = `/v1/merchant/venues/${venue.id}/loyalty/program`
  const configured = await app.inject({
    method: 'POST',
    url: programUrl,
    headers: auth(owner),
    payload: {
      minimumMinor: 9999,
      productId: product.id,
      variantId: product.variants[0].id,
    },
  })
  expect(configured.statusCode).toBe(200)
  expect((await getCard()).program).toMatchObject({
    version: 1,
    minimumMinor: 400,
  })
  const joined = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/loyalty/join`,
      headers: auth(customer),
      payload: {},
    })
  ).json()
  expect(joined.id).toBe(card.id)
  await sale()
  expect(await getCard()).toMatchObject({ balance: 7, earningEnabled: true })
  await app.inject({
    method: 'POST',
    url: programUrl + '/disable',
    headers: auth(owner),
    payload: {},
  })
  expect(await getCard()).toMatchObject({ balance: 7, earningEnabled: false })
  const reserved = await app.inject({
    method: 'POST',
    url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
    headers: auth(customer),
    payload: {},
  })
  expect(reserved.statusCode).toBe(200)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/venues/${venue.id}/loyalty/accept`,
        headers: auth(cashier),
        payload: { token: reserved.json().token },
      })
    ).statusCode,
  ).toBe(200)
  expect(await getCard()).toMatchObject({ balance: 2, available: 2 })
})

it('closed old cards cannot opt back into old terms and late refunds block rewards on a newer card', async () => {
  // Complete the accepted reward and refund remaining stamps so version one closes.
  const oldView = await getCard(),
    reward = oldView.rewards.find((r: any) => r.status === 'PREPARING')
  for (const status of ['READY', 'COLLECTED'])
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/loyalty/rewards/${reward.id}/status`,
      headers: auth(cashier),
      payload: { status },
    })
  const refundable = oldView.entries
    .filter(
      (e: any) =>
        e.kind === 'EARN' &&
        !oldView.entries.some(
          (x: any) => x.kind === 'REFUND' && x.orderId === e.orderId,
        ),
    )
    .slice(-2)
  for (const entry of refundable) {
    const o = bought.find((o) => o.id === entry.orderId)
    await requestRefund(o)
    await confirmRefund(o)
  }
  expect(await getCard()).toMatchObject({ balance: 0 })
  const programUrl = `/v1/merchant/venues/${venue.id}/loyalty/program`
  await app.inject({
    method: 'POST',
    url: programUrl,
    headers: auth(owner),
    payload: {
      minimumMinor: 400,
      productId: product.id,
      variantId: product.variants[0].id,
    },
  })
  const oldCard = card
  const newer = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/loyalty/join`,
      headers: auth(customer),
      payload: {},
    })
  ).json()
  expect(newer.id).not.toBe(oldCard.id)
  const o = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: auth(cashier),
      payload: {
        lines: [
          {
            productId: product.id,
            variantId: product.variants[0].id,
            extraIds: [],
            quantity: 1,
          },
        ],
      },
    })
  ).json()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/checkout/${o.checkoutToken}/loyalty`,
        headers: auth(customer),
        payload: { cardId: oldCard.id, revision: 1 },
      })
    ).statusCode,
  ).toBe(409)
  card = newer
  for (let i = 0; i < 5; i++) await sale()
  expect(await getCard()).toMatchObject({ balance: 5, available: 5 })
  const reservation = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
      headers: auth(customer),
      payload: {},
    })
  ).json()
  const priorPaid = bought[1]
  await requestRefund(priorPaid)
  expect(await getCard()).toMatchObject({ balance: 5, available: 4 })
  expect(
    (await getCard()).rewards.find((r: any) => r.id === reservation.id).status,
  ).toBe('CANCELLED')
  await confirmRefund(priorPaid)
  expect(await getCard()).toMatchObject({ balance: 5, available: 4 })
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/loyalty/cards/${card.id}/reserve`,
        headers: auth(customer),
        payload: {},
      })
    ).statusCode,
  ).toBe(409)
  const joined = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${venue.id}/loyalty/join`,
      headers: auth(customer),
      payload: {},
    })
  ).json()
  expect(joined.id).toBe(oldCard.id)
})

it('paid snapshot minimum excludes small purchases and late canonical transfers while duplicate settlement earns once', async () => {
  const cards = (
    await app.inject({
      url: '/v1/merchant/loyalty/cards',
      headers: auth(customer),
    })
  ).json()
  card = cards.find((c: any) => c.balance < 0)
  expect(card).toBeTruthy()
  const before = card.balance
  const smallProduct = {
    ...product,
    variants: product.variants.map((v: any) => ({ ...v, priceMinor: 300 })),
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/venues/${venue.id}/catalog`,
        headers: auth(owner),
        payload: smallProduct,
      })
    ).statusCode,
  ).toBe(200)
  await sale()
  expect(await getCard()).toMatchObject({ balance: before })
  await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${venue.id}/catalog`,
    headers: auth(owner),
    payload: product,
  })
  const o = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/orders',
      headers: auth(cashier),
      payload: {
        lines: [
          {
            productId: product.id,
            variantId: product.variants[0].id,
            extraIds: [],
            quantity: 1,
          },
        ],
      },
    })
  ).json()
  const url = `/v1/merchant/checkout/${o.checkoutToken}`
  await app.inject({
    method: 'POST',
    url: url + '/loyalty',
    headers: auth(customer),
    payload: { cardId: card.id, revision: 1 },
  })
  const q = (
    await app.inject({
      method: 'POST',
      url: url + '/quote',
      payload: { asset: 'NIM', sender: 'NQ-customer-loyalty-123', revision: 1 },
    })
  ).json()
  const original = app.deps.merchantPayments!.verify
  app.deps.merchantPayments!.verify = async ({ quote, hash }) => ({
    ...quote,
    hash,
    confirmedAt: new Date(Date.parse(quote.expiresAt) + 1000).toISOString(),
  })
  try {
    const late = await app.inject({
      method: 'POST',
      url: url + '/payment',
      payload: { hash: 'c'.repeat(64), quoteId: q.quote.id, revision: 1 },
    })
    expect(late.json().status).toBe('REFUND_PENDING')
    expect(await getCard()).toMatchObject({ balance: before })
  } finally {
    app.deps.merchantPayments!.verify = original
  }
  const paid = await sale()
  expect(await getCard()).toMatchObject({ balance: before + 1 })
  const proof = {
    hash: paid.o.payment.hash,
    quoteId: paid.o.quote.id,
    revision: 1,
  }
  const { reconcileMerchantPayment } =
    await import('../src/services/merchantSettlement')
  await Promise.all([
    reconcileMerchantPayment(db, app.deps.merchantPayments!, paid.o.id),
    app.inject({ method: 'POST', url: paid.url + '/payment', payload: proof }),
  ])
  expect(await getCard()).toMatchObject({ balance: before + 1 })
})

it('active reward variants cannot disappear before the first customer joins', async () => {
  const account = await tokenFor(
    await makeUser(db, 'NQ-new-owner-program-promise'),
  )
  const v = (
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/venues',
      headers: auth(account),
      payload: {
        name: 'Promise Cafe',
        fiatCurrency: 'EUR',
        nimAddress: 'NQ-new-owner-program-promise',
      },
    })
  ).json()
  const p = (
    await app.inject({
      method: 'POST',
      url: `/v1/merchant/venues/${v.id}/catalog`,
      headers: auth(account),
      payload: {
        name: 'Tea',
        category: 'Drinks',
        variants: [{ id: crypto.randomUUID(), name: 'Large', priceMinor: 450 }],
        extras: [],
      },
    })
  ).json()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/v1/merchant/venues/${v.id}/loyalty/program`,
        headers: auth(account),
        payload: {
          minimumMinor: 400,
          productId: p.id,
          variantId: p.variants[0].id,
        },
      })
    ).statusCode,
  ).toBe(200)
  const modified = {
    ...p,
    variants: [{ id: crypto.randomUUID(), name: 'New small', priceMinor: 250 }],
  }
  const removed = await app.inject({
    method: 'POST',
    url: `/v1/merchant/venues/${v.id}/catalog`,
    headers: auth(account),
    payload: modified,
  })
  expect(removed.statusCode).toBe(409)
  expect(removed.json().error.code).toBe('LOYALTY_REWARD_PRODUCT_LOCKED')
  expect(
    (
      await app.inject({
        url: `/v1/merchant/venues/${v.id}/catalog`,
        headers: auth(account),
      })
    ).json()[0].variants[0].id,
  ).toBe(p.variants[0].id)
})
