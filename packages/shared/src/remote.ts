import type { MerchantFiat } from './merchant'
export interface RemoteSettings {
  published: boolean
  description: string
  address: string
  city: string
  pickupInstructions: string
  preparationMinutes: number
  queueLimit: number
}
export interface RemoteVenue extends RemoteSettings {
  id: string
  name: string
  fiatCurrency: MerchantFiat
  accepting: boolean
  available: boolean
  unavailableReason: 'DISABLED' | 'PAUSED' | 'BUSY' | 'TERMINAL_OFFLINE' | null
  pausedUntil: string | null
  activeOrders: number
}
