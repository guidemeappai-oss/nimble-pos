import { StrictMode } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { toCanvas } from 'qrcode'
import {
  LoyaltyCards,
  LoyaltyOwner,
  LoyaltyQueue,
} from '../src/loyalty/Loyalty'
import { MerchantCheckout } from '../src/merchant/Merchant'
import { MerchantApi } from '../src/merchant/client'
const app = vi.hoisted(() => ({
  token: 'customer-jwt',
  address: 'NQ customer',
  api: { baseUrl: '/api' },
  login: vi.fn(),
}))
vi.mock('../src/AppContext', () => ({ useApp: () => app }))
vi.mock('../src/wallet/merchantPayments', () => ({
  getMerchantSender: vi.fn(async () => 'NQ customer'),
  getMerchantNimAddress: vi.fn(async () => 'NQ customer'),
  sendMerchantPayment: vi.fn(),
}))
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  localStorage.clear()
  app.token = 'customer-jwt'
  app.address = 'NQ customer'
  vi.useRealTimers()
})
const program = {
  id: 'p',
  venueId: 'venue',
  venueName: 'Café',
  network: 'nimiq:5',
  version: 1,
  active: true,
  threshold: 5,
  minimumMinor: 300,
  fiatCurrency: 'EUR',
  productId: 'coffee',
  variantId: 'classic',
  productName: 'Flat white',
  variantName: 'Classic',
}
const card = {
  id: 'card',
  program,
  earningEnabled: true,
  balance: 5,
  available: 0,
  refundHolds: 0,
  reserved: 5,
  entries: [],
  rewards: [
    {
      id: 'reward',
      cardId: 'card',
      venueId: 'venue',
      status: 'RESERVED',
      number: null,
      productName: 'Flat white',
      variantName: 'Classic',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      createdAt: new Date().toISOString(),
      token: 'server-recovered-secret',
    },
  ],
}
it('reopens a reserved reward QR from authenticated server state on a new device', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify([card])))
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter>
      <LoyaltyCards />
    </MemoryRouter>,
  )
  expect(
    await screen.findByRole('img', { name: 'Reward QR code' }),
  ).toBeTruthy()
  await waitFor(() =>
    expect(toCanvas).toHaveBeenCalledWith(
      expect.anything(),
      'server-recovered-secret',
      expect.anything(),
    ),
  )
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/merchant/loyalty/cards',
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer customer-jwt',
      }),
    }),
  )
})
it('publishes owner-selected product variant and minimum using authenticated API', async () => {
  const fetcher = vi.fn(
    async (url: string, options: RequestInit) =>
      new Response(
        JSON.stringify(
          url.endsWith('/report')
            ? {
                cards: 0,
                earned: 0,
                corrections: 0,
                collectedRewards: 0,
                activeRewards: 0,
              }
            : options.method === 'POST'
              ? program
              : null,
        ),
      ),
  )
  vi.stubGlobal('fetch', fetcher)
  const api = new MerchantApi(
    '/api',
    () => app.token,
    () => null,
    () => null,
  )
  render(
    <MemoryRouter>
      <LoyaltyOwner
        api={api}
        venue={{
          id: 'venue',
          name: 'Café',
          fiatCurrency: 'EUR',
          nimAddress: 'NQ owner',
          usdtAddress: null,
        }}
        products={[
          {
            id: 'coffee',
            name: 'Flat white',
            category: 'Coffee',
            available: true,
            variants: [{ id: 'classic', name: 'Classic', priceMinor: 450 }],
            extras: [],
          },
        ]}
      />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/Minimum qualifying purchase/), {
    target: { value: '4.50' },
  })
  fireEvent.change(screen.getByLabelText('Reward product and size'), {
    target: { value: JSON.stringify(['coffee', 'classic']) },
  })
  fireEvent.submit(
    screen
      .getByRole('button', { name: /Start loyalty program/ })
      .closest('form')!,
  )
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/merchant/venues/venue/loyalty/program',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          minimumMinor: 450,
          productId: 'coffee',
          variantId: 'classic',
        }),
        headers: expect.objectContaining({
          authorization: 'Bearer customer-jwt',
          'idempotency-key': expect.any(String),
        }),
      }),
    ),
  )
})
it('keeps loyalty optional and binds only after the customer explicitly opts in before quoting', async () => {
  const order = {
    id: 'order',
    venueId: 'venue',
    number: 3,
    revision: 1,
    status: 'AWAITING_PAYMENT',
    fiatCurrency: 'EUR',
    totalMinor: 450,
    lines: [],
    payment: null,
    quote: null,
  }
  const calls: string[] = []
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    calls.push(`${options.method} ${url}`)
    if (url.endsWith('/program')) return new Response(JSON.stringify(program))
    if (url.endsWith('/cards'))
      return new Response(
        JSON.stringify([{ ...card, available: 1, reserved: 0, rewards: [] }]),
      )
    if (url.endsWith('/loyalty')) return new Response(JSON.stringify(null))
    return new Response(JSON.stringify(order))
  })
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter initialEntries={['/merchant/checkout/secret']}>
      <Routes>
        <Route
          path="/merchant/checkout/:token"
          element={<MerchantCheckout />}
        />
      </Routes>
    </MemoryRouter>,
  )
  const checkbox = await screen.findByLabelText(
    'Collect a stamp for this purchase',
  )
  expect((checkbox as HTMLInputElement).checked).toBe(false)
  expect(
    calls.some((c) => c.startsWith('POST') && c.endsWith('/loyalty')),
  ).toBe(false)
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: /Get exact NIM quote/ }))
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/merchant/checkout/secret/loyalty',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cardId: 'card', revision: 1 }),
      }),
    ),
  )
  await waitFor(() =>
    expect(calls).toContain('POST /api/v1/merchant/checkout/secret/quote'),
  )
  expect(
    calls.indexOf('POST /api/v1/merchant/checkout/secret/loyalty'),
  ).toBeLessThan(calls.indexOf('POST /api/v1/merchant/checkout/secret/quote'))
  expect((checkbox as HTMLInputElement).disabled).toBe(true)
})

it('starts one reward camera in StrictMode and releases its stream when leaving', async () => {
  const stop = vi.fn()
  let resolveCamera!: (stream: MediaStream) => void
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        resolveCamera = resolve
      }),
  )
  vi.stubGlobal('navigator', { language: 'en', mediaDevices: { getUserMedia } })
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      async detect() {
        return []
      }
    },
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(
    () => {},
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]')),
  )
  const api = new MerchantApi(
    '/api',
    () => app.token,
    () => 'cashier',
    () => null,
  )
  const view = render(
    <StrictMode>
      <MemoryRouter>
        <LoyaltyQueue api={api} venueId="venue" />
      </MemoryRouter>
    </StrictMode>,
  )
  const scan = screen.getByRole('button', { name: 'Scan reward QR' })
  fireEvent.click(scan)
  fireEvent.click(scan)
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  await act(async () => {
    resolveCamera({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  })
  await screen.findByRole('button', { name: 'Stop camera' })
  expect(stop).not.toHaveBeenCalled()
  view.unmount()
  expect(stop).toHaveBeenCalledOnce()
})

it('lets the customer cancel only an unaccepted reservation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              ...card,
              rewards: [
                {
                  ...card.rewards[0],
                  status: 'PREPARING',
                  number: 8,
                  token: undefined,
                },
              ],
            },
          ]),
        ),
    ),
  )
  render(
    <MemoryRouter>
      <LoyaltyCards />
    </MemoryRouter>,
  )
  await screen.findByText('Your reward is being prepared')
  expect(screen.queryByRole('button', { name: 'Cancel reward' })).toBeNull()
})

it('ignores an old card response after the authenticated customer changes', async () => {
  let finishOld!: (response: Response) => void
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++
      if (calls === 1)
        return new Promise<Response>((resolve) => {
          finishOld = resolve
        })
      return new Response(
        JSON.stringify([
          {
            ...card,
            program: { ...program, venueName: 'New account café' },
            rewards: [],
          },
        ]),
      )
    }),
  )
  const view = render(
    <MemoryRouter>
      <LoyaltyCards />
    </MemoryRouter>,
  )
  await waitFor(() => expect(calls).toBe(1))
  app.token = 'new-customer-jwt'
  app.address = 'NQ new customer'
  view.rerender(
    <MemoryRouter>
      <LoyaltyCards />
    </MemoryRouter>,
  )
  await screen.findByText('New account café')
  await act(async () => {
    finishOld(
      new Response(
        JSON.stringify([
          { ...card, program: { ...program, venueName: 'Old account café' } },
        ]),
      ),
    )
  })
  expect(screen.queryByText('Old account café')).toBeNull()
  expect(screen.getByText('New account café')).toBeTruthy()
})

it('renders cards and the reward queue when every read takes longer than the polling delay', async () => {
  vi.useFakeTimers()
  const preparing = { ...card.rewards[0], status: 'PREPARING', number: 8, token: undefined }
  const fetcher = vi.fn(async (url: string) => {
    await new Promise(resolve => setTimeout(resolve, 4000))
    return new Response(JSON.stringify(url.endsWith('/loyalty/cards') ? [card] : [preparing]))
  })
  vi.stubGlobal('fetch', fetcher)
  const api = new MerchantApi('/api', () => app.token, () => 'cashier', () => null)
  render(<MemoryRouter><LoyaltyCards /><LoyaltyQueue api={api} venueId="venue" /></MemoryRouter>)
  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
  expect(screen.getByText(program.venueName)).toBeTruthy()
  expect(screen.getByRole('button', { name: /Ready for pickup/ })).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(7000) })
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(screen.getByRole('button', { name: /Ready for pickup/ })).toBeTruthy()
})

it('does not let a slow queue poll undo a confirmed reward status change', async () => {
  vi.useFakeTimers()
  let finishPoll!: (response: Response) => void
  let reads = 0
  const preparing = {
    ...card.rewards[0],
    status: 'PREPARING',
    number: 8,
    token: undefined,
  }
  const ready = { ...preparing, status: 'READY' }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === 'POST') return new Response(JSON.stringify(ready))
      reads++
      if (reads === 2)
        return new Promise<Response>((resolve) => {
          finishPoll = resolve
        })
      return new Response(JSON.stringify([reads > 2 ? ready : preparing]))
    }),
  )
  const api = new MerchantApi(
    '/api',
    () => app.token,
    () => 'cashier',
    () => null,
  )
  render(
    <MemoryRouter>
      <LoyaltyQueue api={api} venueId="venue" />
    </MemoryRouter>,
  )
  await act(async () => {})
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(reads).toBe(2)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ready for pickup/ }))
  })
  expect(screen.getByRole('button', { name: /Mark collected/ })).toBeTruthy()
  await act(async () => {
    finishPoll(new Response(JSON.stringify([preparing])))
  })
  expect(screen.queryByRole('button', { name: /Ready for pickup/ })).toBeNull()
  expect(screen.getByRole('button', { name: /Mark collected/ })).toBeTruthy()
})

it('keeps an unavailable reward redeemable after a stock rejection without showing preparation', async () => {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      writes.push(options.body as string)
      return new Response(JSON.stringify({error:{code:'INSUFFICIENT_STOCK',message:'No portions available'}}),{status:409})
    }
    return new Response(JSON.stringify([]))
  }))
  const api = new MerchantApi('/api', () => app.token, () => 'cashier', () => null)
  render(<MemoryRouter><LoyaltyQueue api={api} venueId="venue" /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Reward code'), { target:{value:'reward-token'} })
  fireEvent.click(screen.getByRole('button',{name:/Verify and prepare reward/}))
  await screen.findByText(/Your unused reward and stamps remain available/)
  expect(screen.queryByRole('button',{name:/Ready for pickup/})).toBeNull()
  expect((screen.getByLabelText('Reward code') as HTMLInputElement).value).toBe('reward-token')
  fireEvent.click(screen.getByRole('button',{name:/Verify and prepare reward/}))
  await waitFor(()=>expect(writes).toHaveLength(2))
  expect(JSON.parse(writes[0]).idempotencyKey).toBe(JSON.parse(writes[1]).idempotencyKey)
})
