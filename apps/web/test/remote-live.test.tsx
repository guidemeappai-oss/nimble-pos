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
it('keeps the chosen basket when wallet authentication is needed and creates with that account', async () => {
  context.app.token = null
  context.app.login.mockResolvedValue({
    token: 'signed-in-customer',
    address: 'NQ A',
  })
  const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/orders') && init?.method === 'POST'
      ? json({ ...order, status: 'AWAITING_PAYMENT' })
      : json({ venue, products: [product] }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter initialEntries={['/venues/v']}>
      <Routes>
        <Route path="/venues/:venueId" element={<RemoteMenu />} />
        <Route path="/orders/:orderId" element={<h1>Created order</h1>} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Flat white/ }))
  fireEvent.click(screen.getByRole('button', { name: /Add to basket/ }))
  fireEvent.click(
    screen.getByRole('button', { name: /Connect wallet to order/ }),
  )
  await screen.findByText('Created order')
  const request = fetcher.mock.calls.find(
    ([, init]) => init?.method === 'POST',
  )!
  expect(JSON.parse(String(request[1]?.body))).toEqual({
    lines: [
      { productId: 'coffee', variantId: 'regular', extraIds: [], quantity: 1 },
    ],
  })
  expect((request[1]?.headers as Record<string, string>).authorization).toBe(
    'Bearer signed-in-customer',
  )
})
it('shows recovery address from the private order even when its venue is unpublished', async () => {
  const fetcher = vi.fn(async () =>
    json({
      ...order,
      status: 'READY',
      pickup: { token: 'secret', code: '123456' },
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter initialEntries={['/orders/o']}>
      <Routes>
        <Route path="/orders/:orderId" element={<RemoteOrderDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText(/12 Garden Street/)
  expect(screen.getByLabelText('Pickup QR code')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('renders slow responses and does not overlap order polling', async () => {
  vi.useFakeTimers()
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 4000))
      return json([order])
    }),
  )
  render(
    <MemoryRouter>
      <RemoteOrders />
    </MemoryRouter>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(screen.getByText('Flat white')).toBeTruthy()
  expect(calls).toBe(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(calls).toBe(2)
})
it('discards the previous account’s late response after account switch', async () => {
  let finish: (response: Response) => void = () => {}
  const fetcher = vi.fn((_: string, init?: RequestInit) =>
    (init?.headers as Record<string, string>).authorization ===
    'Bearer customer-a'
      ? new Promise<Response>((resolve) => {
          finish = resolve
        })
      : Promise.resolve(json([])),
  )
  vi.stubGlobal('fetch', fetcher)
  const tree = () => (
    <MemoryRouter>
      <RemoteOrders />
    </MemoryRouter>
  )
  const view = render(tree())
  context.app.token = 'customer-b'
  view.rerender(tree())
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  await act(async () => {
    finish(json([order]))
  })
  expect(screen.queryByText('Flat white')).toBeNull()
})
it('does not navigate to a previous account’s newly created order after switching accounts', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) =>
      url.endsWith('/orders') && init?.method === 'POST'
        ? await new Promise<Response>((resolve) => {
            finish = resolve
          })
        : json({ venue, products: [product] }),
    ),
  )
  const tree = () => (
    <MemoryRouter initialEntries={['/venues/v']}>
      <Routes>
        <Route path="/venues/:venueId" element={<RemoteMenu />} />
        <Route path="/orders/:orderId" element={<h1>Created order</h1>} />
      </Routes>
    </MemoryRouter>
  )
  const view = render(tree())
  fireEvent.click(await screen.findByRole('button', { name: /Flat white/ }))
  fireEvent.click(screen.getByRole('button', { name: /Add to basket/ }))
  fireEvent.click(screen.getByRole('button', { name: /Place order/ }))
  context.app.token = 'customer-b'
  view.rerender(tree())
  await act(async () => {
    finish(json({ ...order, status: 'AWAITING_PAYMENT' }))
  })
  expect(screen.queryByText('Created order')).toBeNull()
})
it('ignores cancellation results after switching to a different customer order', async () => {
  const { useNavigate } = await import('react-router-dom')
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/cancel')
        ? await new Promise<Response>((resolve) => {
            finish = resolve
          })
        : json({
            ...order,
            id: url.endsWith('/other') ? 'other' : 'o',
            number: url.endsWith('/other') ? 99 : 42,
            status: 'AWAITING_PAYMENT',
            payment: null,
          }),
    ),
  )
  function Jump() {
    const navigate = useNavigate()
    return (
      <button onClick={() => navigate('/orders/other')}>Other order</button>
    )
  }
  render(
    <MemoryRouter initialEntries={['/orders/o']}>
      <Jump />
      <Routes>
        <Route path="/orders/:orderId" element={<RemoteOrderDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Cancel unpaid order' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Other order' }))
  await screen.findByText(/#099/)
  await act(async () => {
    finish(json({ ...order, status: 'CANCELLED' }))
  })
  expect(screen.queryByRole('heading', { name: 'Order cancelled.' })).toBeNull()
  expect(screen.getByText(/#099/)).toBeTruthy()
  expect(
    (
      screen.getByRole('button', {
        name: 'Cancel unpaid order',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false)
})
