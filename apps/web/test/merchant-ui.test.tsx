import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { MerchantDemo, MerchantWelcome, MerchantOwner } from '../src/merchant/Merchant'
import { Approval } from '../src/screens/Approval'

const testContext = vi.hoisted(() => ({ api: { baseUrl: '/api' }, token: null as string | null }))
vi.mock('../src/AppContext', () => ({
  useApp: () => testContext,
  useAppOptional: () => null,
}))
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(() => { cleanup(); testContext.token = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

it('shows owner setup and PIN terminal separately from the no-wallet demo', () => {
  render(<MemoryRouter><MerchantWelcome /></MemoryRouter>)
  expect(screen.getByRole('link', { name: /Try Maison Café/ }).getAttribute('href')).toBe('/merchant/demo')
  expect(screen.getByRole('link', { name: /Make it yours/ }).getAttribute('href')).toBe('/merchant/owner')
  expect(screen.getByRole('link', { name: /Ready for service/ }).getAttribute('href')).toBe('/merchant/terminal')
})

it('completes an itemized demo checkout with paid extras and pickup tracking without wallets', async () => {
  render(<MemoryRouter><MerchantDemo /></MemoryRouter>)
  expect(screen.getByText(/DEMO · no real funds/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Flat white/ }))
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'large' } })
  fireEvent.click(screen.getByLabelText(/Oat milk/))
  fireEvent.click(screen.getByRole('button', { name: /Add to basket/ }))
  fireEvent.click(screen.getByRole('button', { name: /Share checkout/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Open customer view/ }))
  expect(screen.getByText('Large · Oat milk')).toBeTruthy()
  expect(screen.getAllByText('€6.00')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /Simulate payment/ }))
  await screen.findByText('Payment received. We’re preparing your order.')
  expect(screen.getByText('042')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Simulate ready for pickup/ }))
  await screen.findByText('Come to the counter and show your number.')
  fireEvent.click(screen.getByRole('button', { name: /Simulate collection/ }))
  await screen.findByText('Thank you for stopping by.')
  expect(screen.getByText('Simulated payment · no transaction sent')).toBeTruthy()
})

it('redirects a payer paired to a merchant into itemized checkout before generic approval', async () => {
  const api = {
    getSession: vi.fn(async () => ({ role: 'payer', merchantCheckoutToken: 'private-checkout', status: 'CLAIMED' })),
    openEvents: vi.fn(async () => () => {}),
  }
  const wallet = { sendTransaction: vi.fn() }
  render(<MemoryRouter initialEntries={['/session/s']}><Routes>
    <Route path="/session/:id" element={<Approval api={api as never} wallet={wallet as never} />} />
    <Route path="/merchant/checkout/:token" element={<p>Itemized checkout</p>} />
  </Routes></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Itemized checkout')).toBeTruthy())
  expect(wallet.sendTransaction).not.toHaveBeenCalled()
})

it('recovers a server submitted payment with only verification available and human network labels', async () => {
  const hash = 'ab'.repeat(32)
  const order = {
    id: 'internal-order-uuid', number: 73, revision: 1, status: 'PAYMENT_PENDING',
    fiatCurrency: 'EUR', totalMinor: 600, lines: [], payment: null,
    pendingPaymentHash: hash,
    quote: { id: 'q', asset: 'NIM', amountAtomic: '300000000', recipient: 'NQ customer-visible-address',
      network: 'nimiq:24', reference: 'nimble-order:internal-order-uuid:1', sender: 'NQ sender',
      expiresAt: new Date(Date.now() + 120000).toISOString(), rateAt: new Date().toISOString(), rateSource: 'internal-rpc-source' },
  }
  const fetcher = vi.fn(async () => new Response(JSON.stringify(order)))
  vi.stubGlobal('fetch', fetcher)
  const { MerchantCheckout } = await import('../src/merchant/Merchant')
  render(<MemoryRouter initialEntries={['/merchant/checkout/recovery']}><Routes>
    <Route path="/merchant/checkout/:token" element={<MerchantCheckout />} />
  </Routes></MemoryRouter>)
  const check = await screen.findByRole('button', { name: /Check submitted payment/ })
  expect(screen.getByText('Nimiq mainnet')).toBeTruthy()
  expect(screen.queryByText(/internal-order-uuid/)).toBeNull()
  expect(screen.queryByText(/internal-rpc-source/)).toBeNull()
  expect(screen.getByRole('button', { name: /USDT/ }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: /Approve exact amount/ })).toBeNull()
  fireEvent.click(check)
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/merchant/checkout/recovery/payment', expect.objectContaining({
    body: JSON.stringify({ revision: 1, quoteId: 'q', hash }),
  })))
  const corrected = 'cd'.repeat(32)
  fireEvent.change(screen.getByLabelText('Transaction hash from your wallet'), {target:{value:corrected}})
  fireEvent.click(screen.getByRole('button',{name:/Verify original transfer/}))
  await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/v1/merchant/checkout/recovery/payment',expect.objectContaining({body:JSON.stringify({revision:1,quoteId:'q',hash:corrected})})))
  vi.unstubAllGlobals()
})

it('recovers an interrupted approval against its original quote after the cashier edits checkout', async () => {
  const key = 'nimble:merchant:/api:submitted:interrupted-ui'
  localStorage.setItem(key, JSON.stringify({ state: 'SIGNING', revision: 1, quoteId: 'original-quote' }))
  const order = { id: 'order', number: 74, revision: 2, status: 'AWAITING_PAYMENT', fiatCurrency: 'EUR', totalMinor: 900,
    lines: [], payment: null, quote: null }
  const fetcher = vi.fn(async () => new Response(JSON.stringify(order)))
  vi.stubGlobal('fetch', fetcher)
  const wallet = await import('../src/wallet/merchantPayments')
  const send = vi.spyOn(wallet, 'sendMerchantPayment')
  const { MerchantCheckout } = await import('../src/merchant/Merchant')
  render(<MemoryRouter initialEntries={['/merchant/checkout/interrupted-ui']}><Routes>
    <Route path="/merchant/checkout/:token" element={<MerchantCheckout />} />
  </Routes></MemoryRouter>)
  await screen.findByText('Recover your wallet approval.')
  expect(screen.queryByRole('button', { name: /Get exact|Approve exact/ })).toBeNull()
  const hash = 'ef'.repeat(32)
  fireEvent.change(screen.getByLabelText('Transaction hash from your wallet'), { target: { value: hash } })
  fireEvent.click(screen.getByRole('button', { name: /Verify original transfer/ }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/merchant/checkout/interrupted-ui/payment', expect.objectContaining({
    body: JSON.stringify({ revision: 1, quoteId: 'original-quote', hash }),
  })))
  expect(send).not.toHaveBeenCalled()
  send.mockRestore()
  localStorage.removeItem(key)
  vi.unstubAllGlobals()
})

it('shows the immutable paid basket when a late payment settles an earlier revision', async () => {
  const order = {
    id: 'historic', number: 75, revision: 2, status: 'REFUND_PENDING', fiatCurrency: 'EUR', totalMinor: 900,
    lines: [{ quantity: 1, productName: 'New basket', variantName: 'Large', extras: [], totalMinor: 900 }],
    paidSnapshot: { revision: 1, totalMinor: 450, lines: [{ quantity: 1, productName: 'Original flat white', variantName: 'Classic', extras: [], totalMinor: 450 }] },
    payment: { amountAtomic: '225000000', asset: 'NIM', network: 'nimiq:24', hash: 'ab'.repeat(32) }, quote: null,
  }
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(order)))
  const { MerchantCheckout } = await import('../src/merchant/Merchant')
  render(<MemoryRouter initialEntries={['/merchant/checkout/historic']}><Routes>
    <Route path="/merchant/checkout/:token" element={<MerchantCheckout />} />
  </Routes></MemoryRouter>)
  await screen.findByText('YOUR ORDER RECEIPT')
  expect(screen.getByText('1 × Original flat white')).toBeTruthy()
  expect(screen.getAllByText('€4.50')).toHaveLength(2)
  expect(screen.queryByText(/New basket|€9.00/)).toBeNull()
  vi.unstubAllGlobals()
})


it('owner recovers an interrupted refund without opening the wallet again', async () => {
  testContext.token = 'owner'
  const order = { id: 'refund-order', number: 76, revision: 3, status: 'REFUND_PENDING', totalMinor: 600, fiatCurrency: 'EUR',
    payment: { amountAtomic: '300000000', asset: 'NIM' }, refund: { status: 'APPROVED', quote: { id: 'new-refund-quote', expiresAt: new Date(Date.now() + 120000).toISOString() } } }
  const key = 'nimble:merchant:/api:refund:refund-order'
  localStorage.setItem(key, JSON.stringify({ state: 'SIGNING', revision: 2, quoteId: 'original-refund-quote' }))
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/venues') ? [{ id: 'venue', name: 'Café', fiatCurrency: 'EUR' }] :
    url.endsWith('/orders') ? [order] : url.endsWith('/report') ? { totals: { netMinor: 600, grossMinor: 600, refundedMinor: 0, paid: 1, fiatCurrency: 'EUR', assets: { NIM: '300000000', USDT: '0' } } } :
    url.endsWith('/refund/payment') ? order : []
  )))
  vi.stubGlobal('fetch', fetcher)
  const wallet = await import('../src/wallet/merchantPayments')
  const send = vi.spyOn(wallet, 'sendMerchantPayment')
  render(<MemoryRouter><MerchantOwner /></MemoryRouter>)
  await screen.findByText('Recover your wallet approval.')
  expect(screen.queryByRole('button', { name: /Approve in owner wallet/ })).toBeNull()
  const hash = '12'.repeat(32)
  fireEvent.change(screen.getByLabelText('Transaction hash from your wallet'), { target: { value: hash } })
  fireEvent.click(screen.getByRole('button', { name: /Verify original transfer/ }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/merchant/orders/refund-order/refund/payment', expect.objectContaining({
    body: JSON.stringify({ hash, quoteId: 'original-refund-quote' }),
  })))
  expect(send).not.toHaveBeenCalled()
})

it('owner refreshes an expired unsent refund quote before requesting wallet approval', async () => {
  testContext.token = 'owner'
  const freshQuote = { id: 'fresh-refund-quote', expiresAt: new Date(Date.now() + 120000).toISOString() }
  const order = { id: 'expired-refund', number: 77, revision: 3, status: 'REFUND_PENDING', totalMinor: 600, fiatCurrency: 'EUR',
    payment: { amountAtomic: '300000000', asset: 'NIM' }, refund: { status: 'APPROVED', quote: { id: 'expired-quote', expiresAt: new Date(Date.now() - 10000).toISOString() } } }
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/venues') ? [{ id: 'venue', name: 'Café', fiatCurrency: 'EUR' }] :
    url.endsWith('/orders') ? [order] : url.endsWith('/report') ? { totals: { netMinor: 600, grossMinor: 600, refundedMinor: 0, paid: 1, fiatCurrency: 'EUR', assets: { NIM: '300000000', USDT: '0' } } } :
    url.endsWith('/refund/approve') ? { ...order, refund: { ...order.refund, quote: freshQuote } } :
    url.endsWith('/refund/payment') ? order : []
  )))
  vi.stubGlobal('fetch', fetcher)
  const wallet = await import('../src/wallet/merchantPayments')
  const send = vi.spyOn(wallet, 'sendMerchantPayment').mockResolvedValue({ hash: '34'.repeat(32) })
  render(<MemoryRouter><MerchantOwner /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Approve in owner wallet/ }))
  await waitFor(() => expect(send).toHaveBeenCalledWith(freshQuote))
  expect(fetcher).toHaveBeenCalledWith('/api/v1/merchant/orders/expired-refund/refund/approve', expect.any(Object))
})

it('shows the original paid snapshot in the cashier queue and owner recent orders', async () => {
  const order = {id:'old-revision',number:78,revision:2,status:'REFUND_PENDING',fiatCurrency:'EUR',totalMinor:900,
    lines:[{quantity:1,productName:'New basket',variantName:'Large',extras:[],totalMinor:900}],
    paidSnapshot:{revision:1,totalMinor:450,lines:[{quantity:1,productName:'Original flat white',variantName:'Classic',extras:[],totalMinor:450}]},
    payment:{amountAtomic:'225000000',asset:'NIM'},refund:{status:'REQUESTED',quote:null},quote:null}
  const venue={id:'venue',name:'Café',fiatCurrency:'EUR'}
  const report={totals:{netMinor:450,grossMinor:450,refundedMinor:0,paid:1,fiatCurrency:'EUR',assets:{NIM:'225000000',USDT:'0'}}}
  vi.stubGlobal('fetch',async (url:string)=>new Response(JSON.stringify(
    url.endsWith('/venues')?[venue]:url.endsWith('/orders')?[order]:url.endsWith('/report')?report:url.endsWith('/current')?null:[])))
  sessionStorage.setItem('nimble:merchant:/api:cashier',JSON.stringify({token:'cashier',employee:{id:'ana',name:'Ana'},venue}))
  const {MerchantTerminal}=await import('../src/merchant/Merchant')
  render(<MemoryRouter><MerchantTerminal /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button',{name:/^Queue$/}))
  await screen.findByText('1 × Original flat white')
  expect(screen.queryByText(/New basket|€9.00/)).toBeNull()
  cleanup();sessionStorage.clear();testContext.token='owner'
  render(<MemoryRouter><MerchantOwner /></MemoryRouter>)
  await screen.findByText('Recent orders')
  await screen.findByText('#078')
  expect(screen.queryByText('€9.00')).toBeNull()
})

it('owner corrects a submitted refund hash without opening the wallet again', async () => {
  testContext.token = 'owner'
  const order = {id:'correct-refund',number:79,revision:1,status:'REFUND_PENDING',fiatCurrency:'EUR',totalMinor:600,
    payment:{amountAtomic:'300000000',asset:'NIM'},refund:{status:'APPROVED',pendingHash:'aa'.repeat(32),quote:{id:'refund-quote'}}}
  const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/venues')?[{id:'venue',name:'Café',fiatCurrency:'EUR'}]:url.endsWith('/orders')?[order]:url.endsWith('/report')?null:url.endsWith('/refund/payment')?order:[])))
  vi.stubGlobal('fetch',fetcher)
  const wallet=await import('../src/wallet/merchantPayments');const send=vi.spyOn(wallet,'sendMerchantPayment')
  render(<MemoryRouter><MerchantOwner /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Transaction hash from your wallet'),{target:{value:'bb'.repeat(32)}})
  fireEvent.click(screen.getByRole('button',{name:/Verify original transfer/}))
  await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/v1/merchant/orders/correct-refund/refund/payment',expect.objectContaining({body:JSON.stringify({hash:'bb'.repeat(32),quoteId:'refund-quote'})})))
  expect(send).not.toHaveBeenCalled()
})
it('shows per-unit preparation in POS and allows handover only once READY',async()=>{
 const venue={id:'venue',name:'Café',fiatCurrency:'EUR'}
 const order={id:'prepared',venueId:'venue',number:81,revision:1,status:'PREPARING',fiatCurrency:'EUR',totalMinor:900,lines:[{productName:'Coffee',variantName:'Large',extras:[],quantity:3,totalMinor:900}],payment:{asset:'NIM',amountAtomic:'450000000'}}
 vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('/readiness')?{orderId:'prepared',revision:1,cartRevision:1,status:'PREPARING',lines:[{lineIndex:0,quantity:3,readyQuantity:2}],allReady:false}:url.endsWith('/orders')?[order]:url.endsWith('/current')?{id:'shift'}:[])))
 sessionStorage.setItem('nimble:merchant:/api:cashier',JSON.stringify({token:'cashier',employee:{id:'ana',name:'Ana'},venue}))
 const {MerchantTerminal}=await import('../src/merchant/Merchant')
 render(<MemoryRouter><MerchantTerminal/></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:/^Queue$/}));await screen.findByText('2 / 3 ready')
 expect(screen.queryByRole('button',{name:'Handed over'})).toBeNull();expect(screen.queryByRole('button',{name:/Mark collected/})).toBeNull();expect(screen.queryByRole('button',{name:/Ready for pickup/})).toBeNull()
 expect((screen.getByLabelText('Ready quantity: Coffee') as HTMLSelectElement).disabled).toBe(false)
})
