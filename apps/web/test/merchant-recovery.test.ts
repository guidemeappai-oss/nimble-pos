import { afterEach, expect, it, vi } from 'vitest'
import { readSubmitted, submitOnce } from '../src/merchant/recovery'

afterEach(() => localStorage.clear())

it('retains a sent hash after registration fails and retries that transaction after reload', async () => {
  const send = vi.fn(async () => ({ hash: 'submitted-hash' }))
  const register = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
  const details = { revision: 2, quoteId: 'exact-quote' }
  await expect(submitOnce('payment', details, send, register)).rejects.toThrow('offline')
  expect(readSubmitted('payment')).toEqual({ ...details, hash: 'submitted-hash' })
  await submitOnce('payment', { revision: 3, quoteId: 'changed' }, send, register)
  expect(send).toHaveBeenCalledTimes(1)
  expect(register).toHaveBeenLastCalledWith({ ...details, hash: 'submitted-hash' })
})

it('coalesces simultaneous approval taps into one wallet transfer', async () => {
  const send = vi.fn(async () => ({ hash: 'only-transfer' }))
  const register = vi.fn(async () => ({}))
  await Promise.all([
    submitOnce('refund', { revision: 1, quoteId: 'refund-quote' }, send, register),
    submitOnce('refund', { revision: 1, quoteId: 'refund-quote' }, send, register),
  ])
  expect(send).toHaveBeenCalledTimes(1)
  expect(register).toHaveBeenCalledTimes(1)
})

it('blocks another signature after reload while the first wallet broadcast remains unresolved', async () => {
  let resolveWallet!: (value: { hash: string }) => void
  const send = vi.fn(() => new Promise<{ hash: string }>(resolve => { resolveWallet = resolve }))
  const register = vi.fn(async () => ({}))
  const first = submitOnce('interrupted', { revision: 4, quoteId: 'old-quote' }, send, register)
  expect(JSON.parse(localStorage.getItem('interrupted')!)).toEqual({ state: 'SIGNING', revision: 4, quoteId: 'old-quote' })
  vi.resetModules()
  const reloaded = await import('../src/merchant/recovery')
  await expect(reloaded.submitOnce('interrupted', { revision: 5, quoteId: 'new-quote' }, send, register)).rejects.toThrow('SIGNING_UNCERTAIN')
  expect(send).toHaveBeenCalledTimes(1)
  resolveWallet({ hash: 'ab'.repeat(32) })
  await first
})

it('recovers an uncertain payment with its original quote and never signs it again', async () => {
  const send = vi.fn(async () => { throw new Error('connection interrupted') })
  const register = vi.fn(async () => ({}))
  await expect(submitOnce('unknown', { revision: 3, quoteId: 'original' }, send, register)).rejects.toThrow('connection interrupted')
  const recovery = await import('../src/merchant/recovery')
  expect(recovery.readSigningIntent('unknown')).toEqual({ state: 'SIGNING', revision: 3, quoteId: 'original' })
  const hash = 'cd'.repeat(32)
  recovery.restoreSubmittedHash('unknown', hash)
  await recovery.submitOnce('unknown', { revision: 5, quoteId: 'latest' }, send, register)
  expect(send).toHaveBeenCalledTimes(1)
  expect(register).toHaveBeenCalledWith({ revision: 3, quoteId: 'original', hash })
})

it('allows a new wallet attempt only after explicit refusal or a known pre-sign failure', async () => {
  const send = vi.fn().mockRejectedValueOnce({ code: 4001 }).mockResolvedValueOnce({ hash: 'ef'.repeat(32) })
  const register = vi.fn(async () => ({}))
  await expect(submitOnce('refused', { revision: 1, quoteId: 'q' }, send, register)).rejects.toMatchObject({ code: 4001 })
  expect(localStorage.getItem('refused')).toBeNull()
  await submitOnce('refused', { revision: 1, quoteId: 'q' }, send, register)
  expect(send).toHaveBeenCalledTimes(2)
})

it('corrects a mistyped submitted hash while preserving the quote and never signing again', async () => {
    const recovery = await import('../src/merchant/recovery')
    const send = vi.fn(async () => ({ hash: 'aa'.repeat(32) }))
    const register = vi.fn(async () => ({}))
    await recovery.submitOnce('correct', { revision: 2, quoteId: 'original' }, send, register)
    recovery.restoreSubmittedHash('correct', 'bb'.repeat(32))
    await recovery.submitOnce('correct', { revision: 3, quoteId: 'new' }, send, register)
    expect(send).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenLastCalledWith({ revision: 2, quoteId: 'original', hash: 'bb'.repeat(32) })
})
