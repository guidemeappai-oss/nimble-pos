import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RemoteDemo } from '../src/remote/Remote'
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(cleanup)
it('requires cashier acceptance and a verified pickup before handing over a remote order', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter>
      <RemoteDemo />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Maison Café/ }))
  fireEvent.click(screen.getByRole('button', { name: /Flat white/ }))
  fireEvent.click(screen.getByRole('button', { name: /Add to basket/ }))
  fireEvent.click(screen.getByRole('button', { name: /Place demo order/ }))
  fireEvent.click(screen.getByRole('button', { name: /Simulate payment/ }))
  expect(
    screen.getByRole('heading', { name: 'Waiting for the venue' }),
  ).toBeTruthy()
  expect(screen.queryByLabelText('Pickup QR code')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Cashier workspace/ }))
  fireEvent.click(screen.getByRole('button', { name: /Accept order/ }))
  fireEvent.click(screen.getByRole('button', { name: /Ready for pickup/ }))
  fireEvent.click(screen.getByRole('button', { name: /Verify pickup/ }))
  expect(screen.getByRole('heading', { name: 'Confirm handover' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Confirm handover/ }))
  fireEvent.click(screen.getByRole('button', { name: /Customer workspace/ }))
  await waitFor(() =>
    expect(screen.getByText('Enjoy your order.')).toBeTruthy(),
  )
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['reject', 'timeout'])(
  'keeps pickup blocked and explains pending owner refund after %s',
  async (mode) => {
    render(
      <MemoryRouter>
        <RemoteDemo />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Maison Café/ }))
    fireEvent.click(screen.getByRole('button', { name: /Flat white/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add to basket/ }))
    fireEvent.click(screen.getByRole('button', { name: /Place demo order/ }))
    fireEvent.click(screen.getByRole('button', { name: /Simulate payment/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cashier workspace/ }))
    if (mode === 'reject') {
      expect(
        (
          screen.getByRole('button', {
            name: /Reject order/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true)
      fireEvent.change(screen.getByLabelText('Reason if declining'), {
        target: { value: 'Coffee machine unavailable' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Reject order/ }))
    } else
      fireEvent.click(
        screen.getByRole('button', { name: /Simulate decision timeout/ }),
      )
    expect(screen.queryByRole('button', { name: /Accept order/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Customer workspace/ }))
    expect(
      screen.getByText(/Your money has not been returned yet/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Pickup QR code')).toBeNull()
    if (mode === 'reject')
      expect(screen.getByText('Coffee machine unavailable')).toBeTruthy()
  },
)
it('requires a bundle choice and snapshots the selected components at the bundle price', async () => {
 render(<MemoryRouter><RemoteDemo /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:/Maison Café/}));
 fireEvent.click(screen.getByRole('button',{name:/Morning ritual/}));
 expect((screen.getByRole('button',{name:/Add to basket/}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText(/Large flat white/));
 expect(screen.getByRole('button',{name:/Add to basket/}).textContent).toContain('€6.60');
 expect((screen.getByLabelText(/Regular flat white/) as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:/Add to basket/}));
 fireEvent.click(screen.getByRole('button',{name:/Place demo order/}));
 expect(await screen.findByText(/1 × Butter croissant \(Classic\)/)).toBeTruthy();
 expect(screen.getByText(/1 × Flat white \(Large\)/)).toBeTruthy();
});
it('blocks a bundle when its included product becomes unavailable', async () => {
 const {MenuBasket} = await import('../src/remote/Remote');
 const target={id:'food',name:'Croissant',category:'Bakery',available:false,variants:[{id:'classic',name:'Classic',priceMinor:300}],extras:[]};
 const bundle={id:'set',name:'Breakfast',category:'Sets',available:true,variants:[{id:'standard',name:'Standard',priceMinor:600}],extras:[],components:[{productId:'food',variantId:'classic',quantity:1}]};
 render(<MenuBasket products={[bundle,target]} venue={{fiatCurrency:'EUR'}} cart={[]} onCart={vi.fn()} onSubmit={vi.fn()} submitLabel="Checkout"/>);
 fireEvent.click(screen.getByRole('button',{name:/Breakfast/}));
 expect((screen.getByRole('button',{name:/Add to basket/}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('status').textContent).toContain('available components');
});
