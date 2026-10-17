import { it, expect, vi } from 'vitest'
import {
  makeNotificationWorker,
  type NotificationStore,
} from '../src/services/merchantNotifications'
it('persists signed bytes before broadcast and retries those same bytes after uncertain delivery', async () => {
  const row: any = {
    eventId: 'event-1',
    orderId: 'order-1',
    recipient: 'NQ recipient',
    network: 'nimiq:24',
    status: 'PENDING',
    rawTransaction: null,
    transactionHash: null,
    attempts: 0,
  }
  const observations: string[] = []
  const store: NotificationStore = {
    exclusive: async (fn) =>
      fn({
        next: async () => (row.status === 'SENT' ? null : { ...row }),
        canSpend: async () => true,
        persistSigned: async (_id, signed) => {
          Object.assign(row, signed)
          observations.push('persist')
        },
        markSent: async () => {
          row.status = 'SENT'
        },
        retry: async () => {
          row.attempts++
        },
      }),
  }
  const sign = vi.fn(async () => ({
    rawTransaction: 'signed-bytes',
    transactionHash: 'hash',
  }))
  const broadcast = vi.fn(async (raw: string) => {
    expect(row.rawTransaction).toBe(raw)
    observations.push('broadcast')
    if (row.attempts === 0) throw new Error('timeout')
    return 'hash'
  })
  const worker = makeNotificationWorker({
    store,
    signer: { sign, broadcast },
    network: 'nimiq:24',
    dailyBudgetLuna: 100,
    feeLuna: 1,
    maxPerMinute: 5,
  })
  await worker.tick()
  await worker.tick()
  await worker.tick()
  expect(sign).toHaveBeenCalledTimes(1)
  expect(broadcast.mock.calls).toEqual([['signed-bytes'], ['signed-bytes']])
  expect(observations).toEqual(['persist', 'broadcast', 'broadcast'])
  expect(row.status).toBe('SENT')
})
it('does not sign or broadcast when the durable budget refuses another reservation', async () => {
  const sign = vi.fn(),
    broadcast = vi.fn()
  const store: NotificationStore = {
    exclusive: async (fn) =>
      fn({
        next: async () => ({
          eventId: 'event-2',
          orderId: 'order-2',
          recipient: 'recipient',
          network: 'nimiq:24',
          rawTransaction: null,
          transactionHash: null,
          attempts: 0,
        }),
        canSpend: async () => false,
        persistSigned: vi.fn(),
        markSent: vi.fn(),
        retry: vi.fn(),
      }),
  }
  await makeNotificationWorker({
    store,
    signer: { sign, broadcast },
    network: 'nimiq:24',
    dailyBudgetLuna: 10,
    feeLuna: 1,
    maxPerMinute: 1,
  }).tick()
  expect(sign).not.toHaveBeenCalled()
  expect(broadcast).not.toHaveBeenCalled()
})
it('signs an independently verifiable one-luna notification using only the operator key', async () => {
  const { makeNotificationSigner } =
    await import('../src/services/merchantNotifications')
  const { PrivateKey, KeyPair, Transaction, Address } =
    await import('@nimiq/core')
  // Deterministic public test key; no funded account is accessed.
  const privateKeyHex = '11'.repeat(32),
    sender = KeyPair.derive(PrivateKey.fromHex(privateKeyHex))
      .toAddress()
      .toUserFriendlyAddress()
  const recipient = new Address(
    new Uint8Array(20).fill(2),
  ).toUserFriendlyAddress()
  const request = (async (_url: any, init: any) => {
    const { method } = JSON.parse(init.body)
    const data =
      method === 'getNetworkId'
        ? 'MainAlbatross'
        : method === 'isConsensusEstablished'
          ? true
          : method === 'getBlockNumber'
            ? 100
            : { balance: 100 }
    return new Response(JSON.stringify({ result: { data } }))
  }) as typeof fetch
  const signer = makeNotificationSigner({
    privateKeyHex,
    senderAddress: sender,
    rpcUrl: 'https://rpc.invalid',
    networkId: 24,
    feeLuna: 2,
    request,
  })
  const signed = await signer.sign({
    eventId: '12345678-1234-1234-1234-123456789abc',
    orderId: 'order',
    recipient,
    network: 'nimiq:24',
    rawTransaction: null,
    transactionHash: null,
    attempts: 0,
  })
  const tx = Transaction.fromAny(signed.rawTransaction)
  expect(() => tx.verify(24)).not.toThrow()
  expect(tx.value).toBe(1n)
  expect(tx.fee).toBe(2n)
  expect(tx.sender.toUserFriendlyAddress()).toBe(sender)
  expect(tx.recipient.toUserFriendlyAddress()).toBe(recipient)
  expect(signed.transactionHash).toBe(tx.hash())
})
