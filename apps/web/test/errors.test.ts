import { expect, it } from 'vitest'
import { describeError } from '../src/lib/errors'

it('never yields [object Object]', () => {
  expect(describeError(new Error('boom'))).toBe('boom')
  expect(describeError('plain')).toBe('plain')
  expect(describeError({ message: 'insufficient funds', code: 'INVALID_TX' }))
    .toBe('INVALID_TX: insufficient funds')
  expect(describeError({ error: { message: 'denied', type: 'PermissionDeniedError' } }))
    .toBe('PermissionDeniedError: denied')
  expect(describeError({ weird: true })).toBe('{"weird":true}')
})

import { merchantError } from '../src/merchant/errors'
import { ApiError } from '../src/api/client'
it('explains stock hold conflicts without suggesting a new payment or losing rewards', () => {
  expect(merchantError(new ApiError('INSUFFICIENT_STOCK', 'Stock unavailable', 409))).toContain('Your unused reward and stamps remain available.')
  expect(merchantError(new ApiError('STOCK_RESERVED', 'Stock reserved', 409))).toContain('wait for those orders to finish')
  expect(merchantError(new ApiError('STOCK_RESERVATION_LIMIT', 'Too many holds', 409))).toContain('Finish an existing checkout')
})
