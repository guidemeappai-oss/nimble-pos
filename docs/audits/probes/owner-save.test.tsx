import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteOwner, RemoteQueue } from '../src/remote/Remote'
import { MerchantApi } from '../src/merchant/client'
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const json = (value: unknown) => new Response(JSON.stringify(value))
const api = new MerchantApi(
  '/api',
  () => 'owner',
  () => 'cashier',
  () => 'terminal',
)
const venue = {
  id: 'a',
  name: 'A',
  fiatCurrency: 'EUR' as const,
  nimAddress: 'NQ A',
  usdtAddress: null,
}
const settings = {
  published: true,
  description: 'A description',
  address: 'A address',
  city: 'A city',
  pickupInstructions: 'Counter',
  preparationMinutes: 8,
}
const presence = {
  ...settings,
  ...venue,
  accepting: true,
  available: true,
  unavailableReason: null,
}
const order = {
  id: 'o',
  venueId: 'a',
  number: 42,
  revision: 1,
  source: 'REMOTE',
  status: 'READY',
  fiatCurrency: 'EUR',
  totalMinor: 380,
  lines: [],
  quote: null,
  payment: {
    asset: 'NIM',
    amountAtomic: '12500000',
    network: 'nimiq:5',
    hash: 'a',
  },
  refund: null,
  createdAt: new Date().toISOString(),
}
it('audit: saving must not erase edits made while the request is pending', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? new Promise<Response>(resolve => { finish = resolve }) : json(settings)))
  render(<RemoteOwner merchant={api} venue={venue} />)
  await screen.findByDisplayValue('A description')
  fireEvent.click(screen.getByRole('button', { name: /Save venue listing/ }))
  fireEvent.change(screen.getByDisplayValue('A description'), { target: { value: 'NEW description' } })
  await act(async () => { finish(json(settings)) })
  expect(screen.queryByDisplayValue('NEW description')).not.toBeNull()
})
