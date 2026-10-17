import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteOwner } from '../src/remote/Remote'
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
it.each(['description', 'published', 'preparation'])('saving preserves a newer %s edit without claiming it was saved', async (field) => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? new Promise<Response>(resolve => { finish = resolve }) : json(settings)))
  render(<RemoteOwner merchant={api} venue={venue} />)
  await screen.findByDisplayValue('A description')
  fireEvent.click(screen.getByRole('button', { name: /Save venue listing/ }))
  if (field === 'description') fireEvent.change(screen.getByDisplayValue('A description'), { target: { value: 'NEW description' } })
  if (field === 'published') fireEvent.click(screen.getByRole('checkbox'))
  if (field === 'preparation') fireEvent.change(screen.getByLabelText('Default preparation time (minutes)'), { target: { value: '19' } })
  await act(async () => { finish(json(settings)) })
  if (field === 'description') expect(screen.queryByDisplayValue('NEW description')).not.toBeNull()
  if (field === 'published') expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  if (field === 'preparation') expect((screen.getByLabelText('Default preparation time (minutes)') as HTMLInputElement).value).toBe('19')
  expect(screen.queryByText('Venue listing saved.')).toBeNull()
})
