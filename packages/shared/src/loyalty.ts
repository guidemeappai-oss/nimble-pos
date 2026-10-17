import { z } from 'zod'
import type { MerchantFiat } from './merchant'
export const LoyaltyProgramInput = z
  .object({
    minimumMinor: z.number().int().positive().max(100000000),
    productId: z.string().uuid(),
    variantId: z.string().min(1).max(128),
  })
  .strict()
export interface LoyaltyProgram {
  id: string
  venueId: string
  venueName: string
  network: string
  version: number
  active: boolean
  threshold: 5
  minimumMinor: number
  fiatCurrency: MerchantFiat
  productId: string
  variantId: string
  productName: string
  variantName: string
}
export interface LoyaltyEntry {
  id: string
  kind: 'EARN' | 'REFUND' | 'REDEEM' | 'RESTORE'
  delta: number
  orderId: string | null
  rewardId: string | null
  createdAt: string
}
export interface LoyaltyReward {
  id: string
  cardId: string
  venueId: string
  productName: string
  variantName: string
  status:
    'RESERVED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED' | 'EXPIRED'
  number: number | null
  expiresAt: string
  createdAt: string
  token?: string
}
export interface LoyaltyCard {
  id: string
  program: LoyaltyProgram
  earningEnabled: boolean
  balance: number
  available: number
  refundHolds: number
  reserved: number
  entries: LoyaltyEntry[]
  rewards: LoyaltyReward[]
}
export interface LoyaltyReport {
  cards: number
  earned: number
  corrections: number
  collectedRewards: number
  activeRewards: number
}
export interface LoyaltyEvmChallenge {
  id: string
  message: string
  expiresAt: string
}
