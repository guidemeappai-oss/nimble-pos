import { describe, expect, it } from 'vitest'
import { DemoCafe } from '../src/merchant/demo'

describe('isolated example café', () => {
  it('freezes variant and extra prices when a cashier shares checkout', () => {
    const cafe = new DemoCafe()
    cafe.signIn('anna', '1234')
    cafe.openShift()
    const order = cafe.createOrder([{ productId: 'flat', variantId: 'large', extraIds: ['oat'], quantity: 2 }])
    expect(order.totalMinor).toBe(1200)
    expect([order.lines[0].variantName, order.lines[0].extras[0].name].join(' · ')).toBe('Large · Oat milk')
    expect(order.status).toBe('AWAITING_PAYMENT')
    expect(() => cafe.advance(order.id)).toThrow(/paid/)
    cafe.simulatePayment(order.id, 'NIM')
    cafe.advance(order.id)
    expect(cafe.orders[0].status).toBe('READY')
    cafe.advance(order.id)
    expect(cafe.orders[0].status).toBe('COLLECTED')
  })
})

it('invalidates an unpaid checkout when the cashier edits its basket', () => {
  const cafe = new DemoCafe(); cafe.signIn('anna', '1234'); cafe.openShift()
  const order = cafe.createOrder([{ productId: 'flat', variantId: 'classic', extraIds: [], quantity: 1 }])
  cafe.editOrder(order.id, [{ productId: 'espresso', variantId: 'double', extraIds: [], quantity: 2 }])
  expect(order.totalMinor).toBe(700); expect(order.revision).toBe(2)
  cafe.simulatePayment(order.id, 'USDT')
  expect(() => cafe.editOrder(order.id, [])).toThrow(/paid/)
})
