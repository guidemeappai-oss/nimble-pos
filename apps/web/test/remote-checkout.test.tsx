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
import { MerchantCheckout } from '../src/merchant/Merchant'
import { MerchantApi } from '../src/merchant/client'
const app = vi.hoisted(() => ({
  token: 'customer-a',
  address: 'NQ A',
  api: { baseUrl: '/api' },
  login: vi.fn(),
}))
vi.mock('../src/AppContext', () => ({ useApp: () => app }))
vi.mock('../src/wallet/merchantPayments', () => ({
  getMerchantSender: vi.fn(async () => '0x' + 'ab'.repeat(20)),
  getMerchantNimAddress: vi.fn(async () => 'NQ A'),
  sendMerchantPayment: vi.fn(),
}))
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  app.token = 'customer-a'
  localStorage.clear()
})
const order = {
  id: 'o',
  venueId: 'v',
  number: 42,
  revision: 1,
  source: 'REMOTE',
  status: 'AWAITING_ACCEPTANCE',
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
const json = (value: unknown) => new Response(JSON.stringify(value))
const tree = () => (
  <MemoryRouter initialEntries={['/merchant/checkout/secret']}>
    <Routes>
      <Route path="/merchant/checkout/:token" element={<MerchantCheckout />} />
    </Routes>
  </MemoryRouter>
)
it('uses customer authorization for checkout, quote and payment recovery', async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json({}))
  vi.stubGlobal('fetch', fetcher)
  const api = new MerchantApi(
    '/api',
    () => 'customer',
    () => 'cashier',
    () => 'terminal',
  )
  await api.checkout('secret')
  await api.quote('secret', 1, 'NIM', 'NQ A')
  await api.payment('secret', 1, 'q', 'hash')
  expect(
    fetcher.mock.calls.map(([, init]) => (init as RequestInit)?.headers),
  ).toEqual(
    Array(3).fill({
      'content-type': 'application/json',
      authorization: 'Bearer customer',
    }),
  )
})
it('shows accepted-payment waiting copy and serially refreshes slow remote checkout responses', async () => {
  vi.useFakeTimers()
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/checkout/secret')) {
        calls++
        await new Promise((resolve) => setTimeout(resolve, 4000))
        return json({ ...order, stockReservation: {status: 'HELD', expiresAt: null} })
      }
      return json(null)
    }),
  )
  render(tree())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(
    screen.getByRole('heading', { name: 'Waiting for the venue' }),
  ).toBeTruthy()
  expect(
    screen.queryByText('Payment received. We’re preparing your order.'),
  ).toBeNull()
  expect(screen.queryByText('YOUR PICKUP NUMBER')).toBeNull()
  expect(
    screen.getByRole('link', { name: /Open my order/ }).getAttribute('href'),
  ).toBe('/orders/o')
  expect(screen.getByText('Stock is held while payment verification or venue acceptance is pending.')).toBeTruthy()
  expect(calls).toBe(1)
})
it('requires Polygon wallet ownership proof for remote checkout even without joining loyalty', async () => {
  const signature = vi.fn(async () => '0x' + 'ab'.repeat(65))
  vi.stubGlobal('ethereum', { request: signature })
  const fetcher = vi.fn(async (url: string) =>
    json(
      url.endsWith('/checkout/secret')
        ? { ...order, status: 'AWAITING_PAYMENT', payment: null }
        : url.endsWith('/loyalty/evm/challenge')
          ? {
              id: 'challenge',
              message: 'Sign Nimble wallet proof',
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            }
          : null,
    ),
  )
  vi.stubGlobal('fetch', fetcher)
  render(tree())
  await screen.findByText('TOTAL TO PAY')
  fireEvent.click(screen.getByRole('button', { name: /USDT/ }))
  fireEvent.click(screen.getByRole('button', { name: /Get exact USDT quote/ }))
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith('/loyalty/evm/verify'),
      ),
    ).toBe(true),
  )
  expect(signature).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'personal_sign' }),
  )
  expect(
    fetcher.mock.calls.some(([url]) =>
      String(url).endsWith('/loyalty/evm/verify'),
    ),
  ).toBe(true)
})
