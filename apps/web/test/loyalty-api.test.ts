import { afterEach, expect, it, vi } from 'vitest'
import { MerchantApi } from '../src/merchant/client'
import { LoyaltyApi, linkLoyaltyEvm } from '../src/loyalty/api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('binds the customer card using owner authentication and an idempotent checkout revision', async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ cardId: 'card', revision: 3 })),
  )
  vi.stubGlobal('fetch', fetcher)
  const api = new LoyaltyApi(
    new MerchantApi(
      '/api',
      () => 'customer-token',
      () => null,
      () => null,
    ),
  )
  await api.bind('checkout-secret', 'card', 3, 'bind-key')
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/merchant/checkout/checkout-secret/loyalty',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer customer-token',
        'idempotency-key': 'bind-key',
      }),
      body: JSON.stringify({ cardId: 'card', revision: 3 }),
    }),
  )
})
it('signs exactly the server challenge with the selected EVM address before linking it', async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith('/challenge')
            ? {
                id: 'challenge',
                message:
                  'Nimble\nDomain: merchant.example\nNetwork: eip155:137\nNonce: one-use',
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              }
            : { address: '0x' + 'ab'.repeat(20) },
        ),
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  const request = vi.fn(async () => '0x' + 'cd'.repeat(65))
  vi.stubGlobal('ethereum', { request })
  const api = new LoyaltyApi(
    new MerchantApi(
      '/api',
      () => 'customer-token',
      () => null,
      () => null,
    ),
  )
  await linkLoyaltyEvm(api, '0x' + 'ab'.repeat(20))
  const signed = request.mock.calls[0] as unknown as [
    { method: string; params: string[] },
  ]
  expect(signed[0].method).toBe('personal_sign')
  expect(
    new TextDecoder().decode(
      Uint8Array.from(signed[0].params[0].slice(2).match(/../g)!, (s) =>
        parseInt(s, 16),
      ),
    ),
  ).toBe(
    'Nimble\nDomain: merchant.example\nNetwork: eip155:137\nNonce: one-use',
  )
  expect(signed[0].params[1]).toBe('0x' + 'ab'.repeat(20))
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/v1/merchant/loyalty/evm/verify',
    expect.objectContaining({
      body: JSON.stringify({
        challengeId: 'challenge',
        signature: '0x' + 'cd'.repeat(65),
      }),
    }),
  )
  expect(request).toHaveBeenCalledTimes(1)
})
it('does not register an expired address challenge or request a wallet signature', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'expired',
            message: 'old',
            expiresAt: '2020-01-01T00:00:00Z',
          }),
        ),
    ),
  )
  const request = vi.fn()
  vi.stubGlobal('ethereum', { request })
  const api = new LoyaltyApi(
    new MerchantApi(
      '/api',
      () => 'customer-token',
      () => null,
      () => null,
    ),
  )
  await expect(linkLoyaltyEvm(api, '0x' + 'ab'.repeat(20))).rejects.toThrow(
    /expired/,
  )
  expect(request).not.toHaveBeenCalled()
})
