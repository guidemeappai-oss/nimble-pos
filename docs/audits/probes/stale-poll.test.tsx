import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  RemoteMenu,
  RemoteOrders,
  RemoteOrderDetails,
} from '../src/remote/Remote'
const context = vi.hoisted(() => ({
  app: {
    api: { baseUrl: '/test' },
    token: 'customer-a' as string | null,
    address: 'NQ A',
    login: vi.fn(),
    logout: vi.fn(),
    wallet: {},
  },
}))
vi.mock('../src/AppContext', () => ({ useApp: () => context.app }))
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  context.app.token = 'customer-a'
  context.app.login.mockReset()
})
const venue = {
  id: 'v',
  name: 'Maison Café',
  fiatCurrency: 'EUR',
  description: 'Coffee',
  address: '12 Garden Street',
  city: 'Berlin',
  pickupInstructions: 'Window counter',
  preparationMinutes: 8,
  published: true,
  accepting: true,
  available: true,
  unavailableReason: null,
}
const product = {
  id: 'coffee',
  name: 'Flat white',
  category: 'Coffee',
  available: true,
  variants: [{ id: 'regular', name: 'Regular', priceMinor: 380 }],
  extras: [],
}
const order = {
  id: 'o',
  venueId: 'v',
  number: 42,
  status: 'AWAITING_ACCEPTANCE',
  source: 'REMOTE',
  lines: [
    {
      productName: 'Flat white',
      variantName: 'Regular',
      quantity: 1,
      totalMinor: 380,
      extras: [],
    },
  ],
  totalMinor: 380,
  fiatCurrency: 'EUR',
  createdAt: new Date().toISOString(),
  payment: { asset: 'NIM' },
  quote: null,
  pickup: null,
  venue,
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
it('audit: stale poll must not restore payment after successful cancellation', async () => {
  vi.useFakeTimers()
  let getCount = 0
  let finishPoll!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return json({ ...order, status: 'CANCELLED' })
    getCount++
    if (getCount === 1) return json({ ...order, status: 'AWAITING_PAYMENT' })
    return new Promise<Response>(resolve => { finishPoll = resolve })
  }))
  render(<MemoryRouter initialEntries={['/orders/o']}><Routes>
    <Route path="/orders/:orderId" element={<RemoteOrderDetails />} />
  </Routes></MemoryRouter>)
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(getCount).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
  await act(async () => {})
  expect(screen.getByRole('heading', { name: 'Order cancelled.' })).toBeTruthy()
  await act(async () => { finishPoll(json({ ...order, status: 'AWAITING_PAYMENT' })) })
  expect(screen.queryByRole('heading', { name: 'Order cancelled.' })).not.toBeNull()
})
