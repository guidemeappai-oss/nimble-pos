import { describe, it, expect } from 'vitest'
import { atomicAmountForFiat, makeMerchantFx } from '../src/services/merchantFx'
describe('merchant quotes', () => {
  it('rounds up only the final atomic unit using exact decimal arithmetic', () => {
    expect(atomicAmountForFiat(1234, '0.003', 'NIM')).toBe('411333334')
    expect(atomicAmountForFiat(1234, '4.000001', 'USDT')).toBe('3085000')
  })
})
it.each(['EUR', 'PLN', 'USD'] as const)(
  'uses a live asset-specific %s rate and rejects stale or failed feeds',
  async (fiat) => {
    let now = Date.parse('2026-10-14T10:00:00Z')
    let timestamp = now / 1000
    const calls: string[] = []
    const request = (async (url: any) => {
      calls.push(String(url))
      return new Response(
        JSON.stringify({
          tether: {
            [fiat.toLowerCase()]: 1.234567,
            last_updated_at: timestamp,
          },
        }),
      )
    }) as typeof fetch
    const fx = makeMerchantFx({ fetch: request, now: () => now })
    expect(await fx.rate('USDT', fiat)).toMatchObject({
      value: '1.234567',
      source: 'coingecko:tether',
    })
    expect(calls[0]).toContain(`vs_currencies=${fiat.toLowerCase()}`)
    await fx.rate('USDT', fiat)
    expect(calls).toHaveLength(1)
    timestamp -= 121
    now += 31_000
    await expect(fx.rate('USDT', fiat)).rejects.toThrow('RATES_UNAVAILABLE')
    const unavailable = makeMerchantFx({
      fetch: async () => new Response('', { status: 503 }),
    })
    await expect(unavailable.rate('NIM', fiat)).rejects.toThrow(
      'RATES_UNAVAILABLE',
    )
  },
)
