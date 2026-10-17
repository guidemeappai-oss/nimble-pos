import { expect, test } from '@playwright/test'

// An isolated demonstration: never requests a wallet signature or sends money.
async function paidOrder(page: import('@playwright/test').Page) {
  await page.goto('/remote/demo')
  await page.getByRole('button', { name: /Maison Café/ }).click()
  await page.getByRole('button', { name: /Flat white/ }).click()
  await page.getByRole('button', { name: /Add to basket/ }).click()
  await page.getByRole('button', { name: /Place demo order/ }).click()
  await page.getByRole('button', { name: /Simulate payment/ }).click()
}

test('customer orders remotely and cashier confirms a single pickup', async ({ page }) => {
  await paidOrder(page)
  await page.getByRole('button', { name: /Cashier workspace/ }).click()
  await page.getByRole('button', { name: /Accept order/ }).click()
  await page.getByRole('button', { name: /Ready for pickup/ }).click()
  await page.getByRole('button', { name: /Verify pickup/ }).click()
  await page.getByRole('button', { name: /Confirm handover/ }).click()
  await page.getByRole('button', { name: /Customer workspace/ }).click()
  await expect(page.getByText(/collected/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Confirm handover/ })).toHaveCount(0)
})

test('unanswered paid order becomes a refund obligation', async ({ page }) => {
  await paidOrder(page)
  await page.getByRole('button', { name: /Cashier workspace/ }).click()
  await page.getByRole('button', { name: /Simulate decision timeout/ }).click()
  await page.getByRole('button', { name: /Customer workspace/ }).click()
  await expect(page.getByText(/refund/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Confirm handover/ })).toHaveCount(0)
})

test('declining explains the reason without claiming money was returned', async ({ page }) => {
  await paidOrder(page)
  await page.getByRole('button', { name: /Cashier workspace/ }).click()
  await page.getByLabel('Reason if declining').fill('Kitchen closed')
  await page.getByRole('button', { name: /Reject order/ }).click()
  await page.getByRole('button', { name: /Customer workspace/ }).click()
  await expect(page.getByText('Kitchen closed')).toBeVisible()
  await expect(page.getByText(/money has not been returned yet/i)).toBeVisible()
  await expect(page.getByRole('img', { name: /Pickup QR code/ })).toHaveCount(0)
})

test('remote demonstration fits narrow phones and desktop', async ({ page }) => {
  await page.goto('/remote/demo')
  for (const width of [320, 390, 736, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
