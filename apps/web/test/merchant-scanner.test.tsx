import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { checkoutPathFromQr, MerchantScanner } from '../src/merchant/Scanner'
afterEach(cleanup)
const token = 'a'.repeat(43)
it('accepts only this service checkout capability, including its Nimiq Pay app link', () => {
  const origin = 'https://nimble.example'
  expect(
    checkoutPathFromQr(`${origin}/merchant/checkout/${token}?n=test`, origin),
  ).toBe(`/merchant/checkout/${token}?n=test`)
  expect(
    checkoutPathFromQr(
      `https://nimpay.app/miniapps/open/nimble.example/merchant/checkout/${token}`,
      origin,
    ),
  ).toBe(`/merchant/checkout/${token}`)
  expect(
    checkoutPathFromQr(
      `https://attacker.example/merchant/checkout/${token}`,
      origin,
    ),
  ).toBeNull()
  expect(
    checkoutPathFromQr(
      `https://nimpay.app/miniapps/open/attacker.example/merchant/checkout/${token}`,
      origin,
    ),
  ).toBeNull()
  expect(checkoutPathFromQr('javascript:alert(1)', origin)).toBeNull()
})
it('opens the pasted order locally without starting a camera or wallet operation', () => {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<MerchantScanner />} />
        <Route
          path="/merchant/checkout/:token"
          element={<p>Order summary</p>}
        />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Or paste your checkout link'), {
    target: { value: `${window.location.origin}/merchant/checkout/${token}` },
  })
  fireEvent.click(screen.getByRole('button', { name: /Review order/ }))
  expect(screen.getByText('Order summary')).toBeTruthy()
})
