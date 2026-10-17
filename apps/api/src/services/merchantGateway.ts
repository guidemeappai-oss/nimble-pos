import type { MerchantAsset, MerchantFiat, MerchantPayment, MerchantQuote } from '@nimble/shared'
export interface MerchantQuoteInput {
  asset: MerchantAsset
  fiatCurrency: MerchantFiat
  totalMinor: number
  recipient: string
  sender: string
  reference: string
}
export interface MerchantVerifyInput {
  hash: string
  quote: MerchantQuote
}
/** This adapter reads verified chain receipts; it never signs merchant/customer money. */
export type MerchantDisplayRates = Record<
  MerchantAsset,
  { value: string; at: string; source: string } | null
>
export interface MerchantPaymentGateway {
  displayRates?(fiatCurrency: MerchantFiat): Promise<MerchantDisplayRates>
  refreshRefundQuote?(quote: MerchantQuote): Promise<MerchantQuote>
  quote(input: MerchantQuoteInput): Promise<MerchantQuote>
  verify(input: MerchantVerifyInput): Promise<MerchantPayment | null>
}
export const unavailableMerchantPayments: MerchantPaymentGateway = {
  quote: async () => {
    throw new Error('PAYMENTS_UNAVAILABLE')
  },
  verify: async () => {
    throw new Error('PAYMENTS_UNAVAILABLE')
  },
}
export interface MerchantReadyEvent {
  eventId: string
  orderId: string
  recipient: string
  network: string
}
