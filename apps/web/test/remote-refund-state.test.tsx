import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { OrderCard } from '../src/remote/Remote'
import type { RemoteOrder } from '../src/remote/api'

vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => {}) }))
afterEach(cleanup)

it('distinguishes owner authorization from the confirmed refund transfer', () => {
  const order: RemoteOrder = {
    id: 'order', number: 42, status: 'REFUND_PENDING', fiatCurrency: 'EUR',
    venueId: 'venue', revision: 1, shiftId: null, employeeId: null,
    quote: null, payment: null, createdAt: '2026-10-15T12:00:00.000Z',
    totalMinor: 450, lines: [], decision: 'REJECTED',
    refund: { id: 'refund', status: 'APPROVED', reason: 'Kitchen closed', quote: null },
  }
  render(<MemoryRouter><OrderCard order={order} venue={null} /></MemoryRouter>)
  expect(screen.getByText('Refund authorized')).toBeTruthy()
  expect(screen.getByText(/Waiting for the refund transfer/)).toBeTruthy()
  expect(screen.queryByText('Refund awaiting owner')).toBeNull()
  expect(screen.queryByText('The full original payment has been refunded.')).toBeNull()
})
