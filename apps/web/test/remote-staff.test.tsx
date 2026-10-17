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
  queueLimit: 10,
}
const presence = {
  ...settings,
  ...venue,
  pausedUntil: null,
  activeOrders: 0,
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
it('lets the owner configure a persisted active-order limit', async () => {
  let saved: Record<string, unknown> | null = null
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      saved = JSON.parse(String(init.body))
      return json({ ...settings, ...(saved ?? {}) })
    }
    return json(settings)
  }))
  render(<RemoteOwner merchant={api} venue={venue} />)
  const queueLimit = await screen.findByLabelText(/Maximum active remote orders/)
  fireEvent.change(queueLimit, { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: /Save venue listing/ }))
  await waitFor(() => expect(saved?.queueLimit).toBe(4))
})

it('sends a chosen timed pause from the cashier order controls', async () => {
  let pauseRequest: Record<string, unknown> | null = null
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/availability')) {
      pauseRequest = JSON.parse(String(init?.body))
      return json({ ...presence, accepting: false, pausedUntil: new Date(Date.now() + 30 * 60000).toISOString() })
    }
    return json(url.endsWith('/orders') ? [] : presence)
  }))
  render(<RemoteQueue merchant={api} venueId="a" shiftActive={true} presence={presence} />)
  fireEvent.change(screen.getByLabelText('Pause duration'), { target: { value: '30' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pause new orders' }))
  await waitFor(() => expect(pauseRequest).toEqual({ accepting: false, pauseMinutes: 30 }))
})
it('ignores an old venue save response after the owner selects a different venue', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? await new Promise<Response>((resolve) => {
            finish = resolve
          })
        : json(
            url.includes('/a/')
              ? settings
              : {
                  ...settings,
                  description: 'B description',
                  address: 'B address',
                  city: 'B city',
                },
          ),
    ),
  )
  const view = render(<RemoteOwner merchant={api} venue={venue} />)
  await screen.findByDisplayValue('A description')
  fireEvent.click(screen.getByRole('button', { name: /Save venue listing/ }))
  view.rerender(
    <RemoteOwner merchant={api} venue={{ ...venue, id: 'b', name: 'B' }} />,
  )
  await screen.findByDisplayValue('B description')
  await act(async () => {
    finish(json({ ...settings, description: 'STALE A' }))
  })
  expect(screen.getByDisplayValue('B description')).toBeTruthy()
  expect(screen.queryByText('Venue listing saved.')).toBeNull()
  expect(
    (
      screen.getByRole('button', {
        name: /Save venue listing/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false)
})
it('allows cashier to request an owner-approved refund for an accepted remote order', async () => {
  let refunded = false
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/refund')) {
      refunded = true
      return json({ ...order, status: 'REFUND_PENDING' })
    }
    return json(
      url.endsWith('/orders')
        ? [{ ...order, status: refunded ? 'REFUND_PENDING' : 'READY' }]
        : presence,
    )
  })
  vi.stubGlobal('fetch', fetcher)
  render(<RemoteQueue merchant={api} venueId="a" shiftActive={true} />)
  const refund = await screen.findByRole('button', {
    name: /Request full refund/,
  })
  fireEvent.click(refund)
  await screen.findByText(
    /Refund awaiting owner authorization. No pickup is allowed./,
  )
  expect(
    fetcher.mock.calls.some(([url]) => String(url).endsWith('/refund/approve')),
  ).toBe(false)
  expect(
    screen.queryByRole('button', { name: /Request full refund/ }),
  ).toBeNull()
})
it('clears mutation busy state on a terminal scope change while discarding the old verification response', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/pickup/preview')
        ? await new Promise<Response>((resolve) => {
            finish = resolve
          })
        : json(url.endsWith('/orders') ? [order] : presence),
    ),
  )
  const view = render(
    <RemoteQueue merchant={api} venueId="a" shiftActive={true} />,
  )
  const input = await screen.findByLabelText('Pickup QR token or short code')
  fireEvent.change(input, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: /Verify pickup/ }))
  view.rerender(<RemoteQueue merchant={api} venueId="b" shiftActive={true} />)
  fireEvent.change(screen.getByLabelText('Pickup QR token or short code'), {
    target: { value: '999999' },
  })
  expect(
    (screen.getByRole('button', { name: /Verify pickup/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(false)
  await act(async () => {
    finish(json(order))
  })
  expect(screen.queryByRole('heading', { name: 'Confirm handover' })).toBeNull()
})
it('keeps terminal presence alive while the cashier switches away from the remote queue', async () => {
  vi.useFakeTimers()
  const { useRemotePresence } = await import('../src/remote/Remote')
  const { useState } = await import('react')
  let pulses = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/heartbeat')) pulses++
      return json(presence)
    }),
  )
  function TerminalHarness() {
    useRemotePresence(api, 'a', true)
    const [tab, setTab] = useState('Queue')
    return (
      <>
        <button onClick={() => setTab('Menu')}>Menu</button>
        <p>{tab}</p>
      </>
    )
  }
  render(<TerminalHarness />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(pulses).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45000)
  })
  expect(pulses).toBe(4)
})
it('releases a camera permission response arriving after scanner unmount', async () => {
  const { StrictMode } = await import('react')
  let finish: (stream: MediaStream) => void = () => {}
  const stop = vi.fn()
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      async detect() {
        return []
      }
    },
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => json(url.endsWith('/orders') ? [] : presence)),
  )
  const view = render(
    <StrictMode>
      <RemoteQueue merchant={api} venueId="a" shiftActive={true} />
    </StrictMode>,
  )
  fireEvent.click(
    screen.getByRole('button', { name: /Scan customer pickup QR/ }),
  )
  fireEvent.click(
    screen.getByRole('button', { name: /Scan customer pickup QR/ }),
  )
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  view.unmount()
  await act(async () => {
    finish({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  })
  expect(stop).toHaveBeenCalledOnce()
})
it('preserves the cashier preparation estimate across heartbeats and resets for a new venue', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json([])),
  )
  const view = render(
    <RemoteQueue
      merchant={api}
      venueId="a"
      shiftActive={true}
      presence={presence}
    />,
  )
  const input = screen.getByLabelText(
    'Preparation time (minutes)',
  ) as HTMLInputElement
  expect(input.value).toBe('8')
  fireEvent.change(input, { target: { value: '20' } })
  view.rerender(
    <RemoteQueue
      merchant={api}
      venueId="a"
      shiftActive={true}
      presence={{ ...presence }}
    />,
  )
  expect(
    (screen.getByLabelText('Preparation time (minutes)') as HTMLInputElement)
      .value,
  ).toBe('20')
  view.rerender(
    <RemoteQueue
      merchant={api}
      venueId="b"
      shiftActive={true}
      presence={{ ...presence, id: 'b', preparationMinutes: 12 }}
    />,
  )
  expect(
    (screen.getByLabelText('Preparation time (minutes)') as HTMLInputElement)
      .value,
  ).toBe('12')
})

it.each([['AWAITING_ACCEPTANCE', 'reject'], ['AWAITING_ACCEPTANCE', 'accept'], ['PREPARING', 'refund'], ['READY', 'refund']])('keeps the refreshed queue after %s/%s despite an older poll', async (status, operation) => {
  vi.useFakeTimers()
  let calls = 0
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (_url.endsWith('/readiness')) return json({orderId:'o',revision:1,cartRevision:1,status,lines:[],allReady:status==='READY'})
    if (init?.method === 'POST') return json({ ...order, status: operation === 'accept' ? 'PREPARING' : 'REFUND_PENDING' })
    calls++
    if (calls === 2) return new Promise<Response>(resolve => { finish = resolve })
    return json([{ ...order, status: calls === 1 ? status : operation === 'accept' ? 'PREPARING' : 'REFUND_PENDING' }])
  }))
  render(<RemoteQueue merchant={api} venueId="a" shiftActive={true} />)
  await act(async () => {})
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  const action = status === 'AWAITING_ACCEPTANCE'
    ? screen.getByRole('button', { name: operation === 'accept' ? /Accept order/ : /Reject/ })
    : screen.getByRole('button', { name: /Request full refund/ })
  if (status === 'AWAITING_ACCEPTANCE') fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Kitchen closed' } })
  fireEvent.click(action)
  await act(async () => {})
  if (operation === 'accept') expect(screen.queryByRole('button', { name: /Accept order/ })).toBeNull()
  else expect(screen.getByText(/Refund awaiting owner authorization. No pickup is allowed./)).toBeTruthy()
  await act(async () => { finish(json([{ ...order, status }])) })
  if (operation === 'accept') expect(screen.queryByRole('button', { name: /Accept order/ })).toBeNull()
  else expect(screen.getByText(/Refund awaiting owner authorization. No pickup is allowed./)).toBeTruthy()
})

it('does not restore READY from a poll started before handover', async () => {
  vi.useFakeTimers()
  let collected = false
  let delay = false
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/pickup/preview')) return json(order)
    if (url.endsWith('/collect')) { collected = true; return json({ ...order, status: 'COLLECTED' }) }
    if (delay) { delay = false; return new Promise<Response>(resolve => { finish = resolve }) }
    return json([{ ...order, status: collected ? 'COLLECTED' : 'READY' }])
  }))
  render(<RemoteQueue merchant={api} venueId="a" shiftActive={true} />)
  await act(async () => {})
  fireEvent.change(screen.getByLabelText('Pickup QR token or short code'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: /Verify pickup/ }))
  await act(async () => {})
  delay = true
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  fireEvent.click(screen.getByRole('button', { name: /Confirm handover/ }))
  await act(async () => {})
  expect(screen.queryByText('Ready for pickup')).toBeNull()
  await act(async () => { finish(json([order])) })
  expect(screen.queryByText('Ready for pickup')).toBeNull()
})
it('prepares remote units individually without exposing a whole-order or handover shortcut',async()=>{
 let readyQuantity=0
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/readiness')){if(init?.method==='POST')readyQuantity=JSON.parse(String(init.body)).readyQuantity;return json({orderId:'o',revision:2,cartRevision:1,status:'PREPARING',lines:[{lineIndex:0,quantity:3,readyQuantity}],allReady:false})}
  if(url.endsWith('/orders'))return json([{...order,status:'PREPARING',lines:[{productName:'Coffee',variantName:'Large',extras:[],quantity:3,unitMinor:380,totalMinor:1140}]}])
  return json(presence)
 })
 vi.stubGlobal('fetch',fetcher)
 render(<RemoteQueue merchant={api} venueId="a" contextScope="cashier" shiftActive/>)
 await screen.findByText('0 / 3 ready');expect(screen.queryByRole('button',{name:/Ready for pickup/})).toBeNull();expect(screen.queryByRole('button',{name:/Confirm handover/})).toBeNull()
 fireEvent.change(screen.getByLabelText('Ready quantity: Coffee'),{target:{value:'2'}})
 fireEvent.click(screen.getByRole('button',{name:'Save readiness: Coffee'}));await screen.findByText('2 / 3 ready')
 expect(fetcher.mock.calls.some(([url])=>url.endsWith('/status'))).toBe(false)
})
