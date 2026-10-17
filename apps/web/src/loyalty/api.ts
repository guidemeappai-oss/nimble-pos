import type { MerchantApi } from '../merchant/client'
import type {
  LoyaltyCard,
  LoyaltyEvmChallenge,
  LoyaltyProgram,
  LoyaltyReport,
  LoyaltyReward,
} from './types'
import { uuid } from '../lib/uuid'

export class LoyaltyApi {
  constructor(private merchant: MerchantApi) {}
  program(venue: string) {
    return this.merchant.request<LoyaltyProgram | null>(
      'public',
      'GET',
      `/venues/${venue}/loyalty/program`,
    )
  }
  configure(
    venue: string,
    input: { minimumMinor: number; productId: string; variantId: string },
    key: string,
  ) {
    return this.merchant.request<LoyaltyProgram>(
      'owner',
      'POST',
      `/venues/${venue}/loyalty/program`,
      input,
      key,
    )
  }
  disable(venue: string) {
    return this.merchant.request<LoyaltyProgram>(
      'owner',
      'POST',
      `/venues/${venue}/loyalty/program/disable`,
      {},
      uuid(),
    )
  }
  cards() {
    return this.merchant.request<LoyaltyCard[]>(
      'owner',
      'GET',
      '/loyalty/cards',
    )
  }
  card(id: string) {
    return this.merchant.request<LoyaltyCard>(
      'owner',
      'GET',
      `/loyalty/cards/${id}`,
    )
  }
  join(venue: string, key: string) {
    return this.merchant.request<LoyaltyCard>(
      'owner',
      'POST',
      `/venues/${venue}/loyalty/join`,
      {},
      key,
    )
  }
  bind(token: string, cardId: string, revision: number, key: string) {
    return this.merchant.request(
      'owner',
      'POST',
      `/checkout/${token}/loyalty`,
      { cardId, revision },
      key,
    )
  }
  binding(token: string) {
    return this.merchant.request<{ cardId: string; revision: number } | null>(
      'owner',
      'GET',
      `/checkout/${token}/loyalty`,
    )
  }
  challenge(address: string) {
    return this.merchant.request<LoyaltyEvmChallenge>(
      'owner',
      'POST',
      '/loyalty/evm/challenge',
      { address },
    )
  }
  verify(challengeId: string, signature: string) {
    return this.merchant.request('owner', 'POST', '/loyalty/evm/verify', {
      challengeId,
      signature,
    })
  }
  reserve(id: string, key: string) {
    return this.merchant.request<LoyaltyReward>(
      'owner',
      'POST',
      `/loyalty/cards/${id}/reserve`,
      {},
      key,
    )
  }
  cancel(id: string, cashier = false) {
    return this.merchant.request<LoyaltyReward>(
      cashier ? 'cashier' : 'owner',
      'POST',
      `/loyalty/rewards/${id}/cancel`,
      {},
      uuid(),
    )
  }
  rewards(venue: string) {
    return this.merchant.request<LoyaltyReward[]>(
      'cashier',
      'GET',
      `/venues/${venue}/loyalty/rewards`,
    )
  }
  accept(venue: string, token: string, key: string) {
    return this.merchant.request<LoyaltyReward>(
      'cashier',
      'POST',
      `/venues/${venue}/loyalty/accept`,
      { token },
      key,
    )
  }
  status(id: string, status: 'READY' | 'COLLECTED') {
    return this.merchant.request<LoyaltyReward>(
      'cashier',
      'POST',
      `/loyalty/rewards/${id}/status`,
      { status },
      uuid(),
    )
  }
  report(venue: string) {
    return this.merchant.request<LoyaltyReport>(
      'owner',
      'GET',
      `/venues/${venue}/loyalty/report`,
    )
  }
}

/** Proves control of the selected Polygon account without sending funds. */
export async function linkLoyaltyEvm(api: LoyaltyApi, address: string) {
  const provider = (
    window as unknown as {
      ethereum?: {
        request(args: { method: string; params?: unknown[] }): Promise<unknown>
      }
    }
  ).ethereum
  if (!provider) throw new Error('WALLET_UNAVAILABLE')
  const challenge = await api.challenge(address)
  if (Date.parse(challenge.expiresAt) <= Date.now())
    throw new Error('This wallet verification has expired. Try again.')
  const message = `0x${Array.from(new TextEncoder().encode(challenge.message), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })
  if (typeof signature !== 'string' || !/^0x[0-9a-f]+$/i.test(signature))
    throw new Error(
      'Wallet verification was declined. You can still pay without a loyalty card.',
    )
  await api.verify(challenge.id, signature)
}
