import { MerchantApi } from '../merchant/client'
import type {
  MerchantCartLine,
  MerchantOrder,
  MerchantProduct,
  MerchantFiat,
} from '../merchant/contract'
export type { RemoteSettings, RemoteVenue } from '@nimble/shared'
import type { RemoteSettings, RemoteVenue } from '@nimble/shared'
export type RemoteOrder = MerchantOrder
export class RemoteApi {
  constructor(private merchant: MerchantApi) {}
  venues(q = '', page = 1) {
    return this.merchant.request<{
      venues: RemoteVenue[]
      page: number
      hasMore: boolean
    }>(
      'public',
      'GET',
      `/remote/venues?q=${encodeURIComponent(q)}&page=${page}`,
    )
  }
  menu(id: string) {
    return this.merchant.request<{
      venue: RemoteVenue
      products: MerchantProduct[]
    }>('public', 'GET', `/remote/venues/${id}`)
  }
  settings(id: string) {
    return this.merchant.request<RemoteSettings>(
      'owner',
      'GET',
      `/remote/venues/${id}/settings`,
    )
  }
  saveSettings(id: string, value: RemoteSettings) {
    return this.merchant.request<RemoteSettings>(
      'owner',
      'PATCH',
      `/remote/venues/${id}/settings`,
      value,
    )
  }
  heartbeat(id: string) {
    return this.merchant.request<RemoteVenue>(
      'cashier',
      'POST',
      `/remote/venues/${id}/heartbeat`,
    )
  }
  availability(id: string, accepting: boolean, pauseMinutes?: number) {
    return this.merchant.request<RemoteVenue>(
      'cashier',
      'PATCH',
      `/remote/venues/${id}/availability`,
      { accepting, ...(pauseMinutes ? { pauseMinutes } : {}) },
    )
  }
  create(id: string, lines: MerchantCartLine[], key: string) {
    return this.merchant.request<RemoteOrder>(
      'owner',
      'POST',
      `/remote/venues/${id}/orders`,
      { lines },
      key,
    )
  }
  orders() {
    return this.merchant.request<RemoteOrder[]>(
      'owner',
      'GET',
      '/remote/orders',
    )
  }
  order(id: string) {
    return this.merchant.request<RemoteOrder>(
      'owner',
      'GET',
      `/remote/orders/${id}`,
    )
  }
  cancel(id: string) {
    return this.merchant.request<RemoteOrder>(
      'owner',
      'POST',
      `/remote/orders/${id}/cancel`,
    )
  }
  accept(id: string, preparationMinutes: number) {
    return this.merchant.request<RemoteOrder>(
      'cashier',
      'POST',
      `/remote/orders/${id}/accept`,
      { preparationMinutes },
    )
  }
  reject(id: string, reason: string) {
    return this.merchant.request<RemoteOrder>(
      'cashier',
      'POST',
      `/remote/orders/${id}/reject`,
      { reason },
    )
  }
  preview(id: string, tokenOrCode: string) {
    return this.merchant.request<RemoteOrder>(
      'cashier',
      'POST',
      `/remote/venues/${id}/pickup/preview`,
      { tokenOrCode },
    )
  }
  collect(id: string, tokenOrCode: string) {
    return this.merchant.request<RemoteOrder>(
      'cashier',
      'POST',
      `/remote/orders/${id}/collect`,
      { tokenOrCode },
    )
  }
}
