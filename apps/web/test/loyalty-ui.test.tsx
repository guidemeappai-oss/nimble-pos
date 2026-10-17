import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LoyaltyCardView } from '../src/loyalty/Loyalty'
import type { LoyaltyCard } from '../src/loyalty/types'
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(cleanup)
const card: LoyaltyCard & { earningEnabled: boolean } = {
  id: 'card',
  earningEnabled: true,
  program: {
    id: 'p',
    venueId: 'v',
    venueName: 'Maison Café',
    version: 1,
    active: true,
    threshold: 5,
    network: 'nimiq:5',
    minimumMinor: 300,
    fiatCurrency: 'EUR',
    productId: 'flat',
    variantId: 'classic',
    productName: 'Flat white',
    variantName: 'Classic',
  },
  balance: 5,
  available: 5,
  reserved: 0,
  refundHolds: 0,
  entries: [],
  rewards: [],
}
it('shows the real available progress and reserves a reward only when requested', () => {
  const reserve = vi.fn()
  render(<LoyaltyCardView card={card} onReserve={reserve} />)
  expect(screen.getByText('5 / 5')).toBeTruthy()
  expect(reserve).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Reserve my reward/ }))
  expect(reserve).toHaveBeenCalledOnce()
})
it('explains a refund correction without displaying negative stamp icons', () => {
  render(
    <LoyaltyCardView
      card={{ ...card, balance: -1, available: -1, refundHolds: 1 }}
    />,
  )
  expect(screen.getByText('0 / 5')).toBeTruthy()
  expect(
    screen.getByText(/Your next stamps first cover a refunded purchase/),
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Reserve my reward/ })).toBeNull()
})

it('walks through five simulated purchases and one reward without wallets or requests', async () => {
  const { MemoryRouter } = await import('react-router-dom')
  const { LoyaltyDemo } = await import('../src/loyalty/Loyalty')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(
    <MemoryRouter>
      <LoyaltyDemo />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Join loyalty card/ }))
  for (let i = 0; i < 5; i++)
    fireEvent.click(
      screen.getByRole('button', { name: /Simulate a paid purchase/ }),
    )
  fireEvent.click(screen.getByRole('button', { name: /Reserve my reward/ }))
  expect(screen.getByRole('img', { name: /Reward QR code/ })).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: /Cashier: scan and accept reward/ }),
  )
  expect(screen.getByText('0 / 5')).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: /Cashier: ready for pickup/ }),
  )
  expect(screen.getAllByText('Your reward is ready').length).toBeGreaterThan(0)
  fireEvent.click(
    screen.getByRole('button', { name: /Cashier: hand over reward/ }),
  )
  expect(screen.getByText(/Reward collected. Your next card/)).toBeTruthy()
  expect(fetcher).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
