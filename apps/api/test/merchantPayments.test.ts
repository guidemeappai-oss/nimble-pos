import { describe, it, expect } from 'vitest'
import {
  makeMerchantPayments,
  USDT_POLYGON,
} from '../src/services/merchantPayments'
const now = Date.parse('2026-10-14T10:00:00Z')
const sender = '0x' + '11'.repeat(20),
  recipient = '0x' + '22'.repeat(20)
const fx = {
  rate: async () => ({
    value: '4',
    at: new Date(now).toISOString(),
    source: 'test-feed',
  }),
}
describe('merchant payment gateway', () => {
  it('publishes only fresh configured display rates and refreshes refunds without repricing them', async () => {
    let rateCalls = 0
    const request = (async (_url: any, init: any) => {
      const { method } = JSON.parse(init.body)
      return new Response(
        JSON.stringify({
          result: {
            data:
              method === 'getNetworkId'
                ? 'MainAlbatross'
                : method === 'isConsensusEstablished'
                  ? true
                  : 987654,
          },
        }),
      )
    }) as typeof fetch
    const gateway = makeMerchantPayments({
      fx: {
        rate: async () => {
          rateCalls++
          return {
            value: '4',
            at: new Date(now).toISOString(),
            source: 'verified-feed',
          }
        },
      },
      nimiqRpcUrl: 'https://rpc.invalid',
      now: () => now,
      request,
    })
    expect(await gateway.displayRates!('EUR')).toEqual({
      NIM: {
        value: '4',
        at: new Date(now).toISOString(),
        source: 'verified-feed',
      },
      USDT: null,
    })
    const quote: any = {
      id: 'refund',
      asset: 'NIM',
      network: 'nimiq:24',
      amountAtomic: '123456',
      sender: 'owner',
      recipient: 'customer',
      reference: 'refund:42',
      chainHeight: 100,
      issuedAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString(),
      rate: 'old-rate',
    }
    const refreshed = await gateway.refreshRefundQuote!(quote)
    expect(refreshed).toMatchObject({
      amountAtomic: '123456',
      sender: 'owner',
      recipient: 'customer',
      chainHeight: 987654,
      reference: 'refund:42',
      rate: 'old-rate',
    })
    expect(rateCalls).toBe(1)
    const stale = makeMerchantPayments({
      fx: {
        rate: async () => ({
          value: '4',
          at: new Date(0).toISOString(),
          source: 'stale-feed',
        }),
      },
      nimiqRpcUrl: 'https://rpc.invalid',
      now: () => now,
    })
    expect(await stale.displayRates!('USD')).toEqual({ NIM: null, USDT: null })
  })
  it('freezes an exact atomic Polygon quote using the venue fiat rate', async () => {
    const gateway = makeMerchantPayments({
      fx,
      polygonRpcUrl: 'https://rpc.invalid',
      now: () => now,
    })
    const quote = await gateway.quote({
      asset: 'USDT',
      fiatCurrency: 'PLN',
      totalMinor: 1234,
      sender,
      recipient,
      reference: 'order:1',
    })
    expect(quote).toMatchObject({
      amountAtomic: '3085000',
      network: 'eip155:137',
      tokenAddress: USDT_POLYGON,
      rate: '4',
      sender,
      recipient,
    })
    expect(Date.parse(quote.expiresAt)).toBe(now + 120000)
  })
})
const hash = '0x' + 'ab'.repeat(32),
  blockHash = '0x' + 'cd'.repeat(32)
const transferTopic =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
function polygonFixture(
  overrides: Record<string, any> = {},
  mutate?: (method: string, result: any) => void,
) {
  const log = {
    address: USDT_POLYGON,
    topics: [
      transferTopic,
      '0x' + sender.slice(2).padStart(64, '0'),
      '0x' + recipient.slice(2).padStart(64, '0'),
    ],
    data: '0x' + BigInt(3085000).toString(16).padStart(64, '0'),
    transactionHash: hash,
    blockHash,
    removed: false,
  }
  const data: Record<string, any> = {
    eth_chainId: '0x89',
    eth_getTransactionReceipt: {
      transactionHash: hash,
      status: '0x1',
      blockNumber: '0x64',
      blockHash,
      from: sender,
      to: USDT_POLYGON,
      logs: [log],
    },
    eth_getTransactionByHash: {
      hash,
      blockHash,
      blockNumber: '0x64',
      from: sender,
      to: USDT_POLYGON,
      value: '0x0',
      input:
        '0xa9059cbb' +
        recipient.slice(2).padStart(64, '0') +
        BigInt(3085000).toString(16).padStart(64, '0'),
    },
    ...overrides,
  }
  return (async (_url: any, init: any) => {
    const { method, params } = JSON.parse(init.body)
    const result =
      method === 'eth_getBlockByNumber'
        ? params[0] === 'finalized'
          ? { number: '0x65' }
          : {
              hash: blockHash,
              number: '0x64',
              timestamp: '0x' + BigInt(now / 1000).toString(16),
            }
        : data[method]
    mutate?.(method, result)
    return new Response(JSON.stringify({ result }))
  }) as typeof fetch
}
it('settles only exact canonical finalized Polygon transfers, never submitted hashes alone', async () => {
  const gateway = makeMerchantPayments({
    fx,
    polygonRpcUrl: 'https://rpc.invalid',
    now: () => now,
    request: polygonFixture(),
  })
  const quote = await gateway.quote({
    asset: 'USDT',
    fiatCurrency: 'PLN',
    totalMinor: 1234,
    sender,
    recipient,
    reference: 'order:1',
  })
  expect(await gateway.verify({ hash, quote })).toMatchObject({
    hash,
    asset: 'USDT',
    amountAtomic: '3085000',
  })
  const failed = makeMerchantPayments({
    fx,
    polygonRpcUrl: 'https://rpc.invalid',
    now: () => now,
    request: polygonFixture({ eth_getTransactionReceipt: null }),
  })
  expect(await failed.verify({ hash, quote })).toBeNull()
})
it('verifies NIM memo, exact value and execution in a canonical batch finalized by a macro block', async () => {
  const { Address } = await import('@nimiq/core')
  const nimSender = new Address(
      new Uint8Array(20).fill(1),
    ).toUserFriendlyAddress(),
    nimRecipient = new Address(
      new Uint8Array(20).fill(2),
    ).toUserFriendlyAddress()
  const nimHash = 'ef'.repeat(32)
  const tx = {
    hash: nimHash,
    from: nimSender,
    to: nimRecipient,
    value: 308500,
    recipientData: Buffer.from('order:1').toString('hex'),
    networkId: 24,
    blockNumber: 101,
    timestamp: now,
    executionResult: true,
  }
  const request = (async (_url: any, init: any) => {
    const { method, params } = JSON.parse(init.body)
    const data =
      method === 'getNetworkId'
        ? 'MainAlbatross'
        : method === 'isConsensusEstablished'
          ? true
          : method === 'getBlockNumber'
            ? 101
            : method === 'getTransactionByHash'
              ? tx
              : params[0] === 101
                ? { number: 101, hash: 'bb'.repeat(32), transactions: [tx] }
                : { number: params[0], type: 'macro' }
    return new Response(JSON.stringify({ result: { data } }))
  }) as typeof fetch
  const gateway = makeMerchantPayments({
    fx,
    nimiqRpcUrl: 'https://rpc.invalid',
    now: () => now,
    request,
  })
  const quote = await gateway.quote({
    asset: 'NIM',
    fiatCurrency: 'PLN',
    totalMinor: 1234,
    sender: nimSender,
    recipient: nimRecipient,
    reference: 'order:1',
  })
  expect(await gateway.verify({ hash: nimHash, quote })).toMatchObject({
    asset: 'NIM',
    amountAtomic: '308500',
    hash: nimHash,
  })
  tx.timestamp = now + 121000
  expect(await gateway.verify({ hash: nimHash, quote })).toMatchObject({ confirmedAt: new Date(now + 121000).toISOString() })
  tx.recipientData = Buffer.from('other-order').toString('hex')
  expect(await gateway.verify({ hash: nimHash, quote })).toBeNull()
})

it.each([
  ['chain id', (m: string, r: any) => {}, { eth_chainId: '0x1' }],
  [
    'failed execution',
    (m: string, r: any) => {
      if (m === 'eth_getTransactionReceipt') r.status = '0x0'
    },
    {},
  ],
  [
    'wrong sender',
    (m: string, r: any) => {
      if (m === 'eth_getTransactionByHash') r.from = recipient
    },
    {},
  ],
  [
    'wrong token',
    (m: string, r: any) => {
      if (m === 'eth_getTransactionReceipt') r.logs[0].address = recipient
    },
    {},
  ],
  [
    'wrong recipient',
    (m: string, r: any) => {
      if (m === 'eth_getTransactionReceipt')
        r.logs[0].topics[2] = '0x' + '0'.repeat(64)
    },
    {},
  ],
  [
    'wrong amount',
    (m: string, r: any) => {
      if (m === 'eth_getTransactionReceipt')
        r.logs[0].data = '0x' + '0'.repeat(63) + '1'
    },
    {},
  ],
  [
    'removed log',
    (m: string, r: any) => {
      if (m === 'eth_getTransactionReceipt') r.logs[0].removed = true
    },
    {},
  ],
  [
    'reorg',
    (m: string, r: any) => {
      if (m === 'eth_getBlockByNumber' && r.hash)
        r.hash = '0x' + 'ee'.repeat(32)
    },
    {},
  ],
  [
    'unfinalized',
    (m: string, r: any) => {
      if (m === 'eth_getBlockByNumber' && !r.hash) r.number = '0x63'
    },
    {},
  ],
  [
    'historical matching transfer',
    (m: string, r: any) => {
      if (m === 'eth_getBlockByNumber' && r.timestamp) r.timestamp = '0x1'
    },
    {},
  ],
])(
  'never settles a Polygon receipt with %s',
  async (_label, mutate, overrides) => {
    const gateway = makeMerchantPayments({
      fx,
      polygonRpcUrl: 'https://rpc.invalid',
      now: () => now,
      request: polygonFixture(overrides, mutate),
    })
    const quote = await gateway.quote({
      asset: 'USDT',
      fiatCurrency: 'EUR',
      totalMinor: 1234,
      sender,
      recipient,
      reference: 'order:1',
    })
    const result = await gateway.verify({ hash, quote }).catch(() => null)
    expect(result).toBeNull()
  },
)

it('recognizes exact finalized funds arriving after quote expiry for safe reconciliation', async () => {
    const gateway = makeMerchantPayments({
        fx, polygonRpcUrl: 'https://rpc.invalid', now: () => now,
        request: polygonFixture({}, (method, result) => {
            if (method === 'eth_getBlockByNumber' && result.timestamp)
                result.timestamp = '0x' + BigInt((now + 121000) / 1000).toString(16)
        }),
    })
    const quote = await gateway.quote({ asset: 'USDT', fiatCurrency: 'EUR', totalMinor: 1234, sender, recipient, reference: 'order:late' })
    expect(await gateway.verify({ hash, quote })).toMatchObject({ hash, amountAtomic: '3085000', confirmedAt: new Date(now + 121000).toISOString() })
})
