/** Live merchant pricing is separate from the legacy display-only (stale-allowed) rate cache. */
export type MerchantAsset = 'NIM' | 'USDT'
export type MerchantFiat = 'EUR' | 'PLN' | 'USD'
export interface MerchantRate {
  value: string
  at: string
  source: string
}
export interface MerchantFx {
  rate(asset: MerchantAsset, fiat: MerchantFiat): Promise<MerchantRate>
}
export function atomicAmountForFiat(
  totalMinor: number,
  rate: string,
  asset: MerchantAsset,
): string {
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor <= 0 ||
    !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(rate)
  )
    throw new Error('INVALID_QUOTE')
  const [whole, fraction = ''] = rate.split('.')
  const denominator = BigInt(whole + fraction) * 100n
  if (denominator <= 0n) throw new Error('INVALID_RATE')
  const numerator =
    BigInt(totalMinor) *
    10n ** BigInt(fraction.length + (asset === 'NIM' ? 5 : 6))
  const amount = (numerator + denominator - 1n) / denominator
  if (asset === 'NIM' && amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('INVALID_QUOTE')
  if (amount >= 2n ** 256n) throw new Error('INVALID_QUOTE')
  return amount.toString()
}
export function makeMerchantFx(
  options: { fetch?: typeof fetch; now?: () => number; maxAgeMs?: number } = {},
): MerchantFx {
  const request = options.fetch ?? fetch,
    now = options.now ?? Date.now,
    maxAge = options.maxAgeMs ?? 120_000
  const cache = new Map<string, { rate: MerchantRate; fetchedAt: number }>()
  return {
    async rate(asset, fiat) {
      const id = asset === 'NIM' ? 'nimiq-2' : 'tether',
        currency = fiat.toLowerCase()
      const key = `${asset}:${fiat}`
      const cached = cache.get(key)
      if (
        cached &&
        now() - cached.fetchedAt < 30_000 &&
        now() - Date.parse(cached.rate.at) <= maxAge
      )
        return cached.rate
      const response = await request(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${currency}&include_last_updated_at=true&precision=full`,
        { signal: AbortSignal.timeout(8000) },
      )
      if (!response.ok) throw new Error('RATES_UNAVAILABLE')
      const data = (await response.json())?.[id],
        value = data?.[currency],
        at = data?.last_updated_at * 1000
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0 ||
        !Number.isFinite(at) ||
        now() - at > maxAge ||
        at > now() + 5000
      )
        throw new Error('RATES_UNAVAILABLE')
      // Reject scientific notation rather than silently lose precision or use a fallback rate.
      const decimal = String(value)
      atomicAmountForFiat(1, decimal, asset)
      const rate = {
        value: decimal,
        at: new Date(at).toISOString(),
        source: `coingecko:${id}`,
      }
      cache.set(key, { rate, fetchedAt: now() })
      return rate
    },
  }
}
