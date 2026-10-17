import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MerchantReport } from '../src/merchant/Report'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('separates received funds and outstanding obligations from accepted sales', async () => {
  const totals = {
    count: 3, paid: 3, refunded: 0, grossMinor: 450, netMinor: 450,
    refundedMinor: 0, receivedMinor: 1500, pendingAcceptanceMinor: 600,
    refundPendingMinor: 450, fiatCurrency: 'EUR' as const, assets: { NIM: '150000', USDT: '0' },
  }
  render(<MerchantReport report={{orders:[],totals}} title="Venue report" />)
  const received = await screen.findByText('Payments received')
  expect(received.parentElement?.textContent).toContain('€15.00')
  expect(screen.getByText('Awaiting venue acceptance').parentElement?.textContent).toContain('€6.00')
  expect(screen.getByText('Awaiting refund').parentElement?.textContent).toContain('€4.50')
  expect(screen.getByText('Accepted sales').parentElement?.textContent).toContain('€4.50')
})
