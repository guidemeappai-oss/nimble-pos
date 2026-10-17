import { it, expect, afterEach } from 'vitest'
import { createMerchantWallet } from '../src/wallet/merchantPayments'
afterEach(() => { delete (window as unknown as { nimiqPay?: object }).nimiqPay })

it('uses the official host network without requiring undocumented provider RPC methods', async () => {
  const host = window as unknown as { nimiqPay: { network: string } }
  host.nimiqPay = { network: 'testnet' }
  let sends = 0
  const wallet = createMerchantWallet({
    now: () => 1000,
    nimiq: async () => ({
      listAccounts: async () => ['NQ customer'],
      isConsensusEstablished: async () => true,
      getBlockNumber: async () => 100,
      sendBasicTransactionWithData: async () => { sends++; return 'ab'.repeat(32) },
    }),
  })
  const quote: any = {
    asset: 'NIM', network: 'nimiq:5', chainHeight: 100,
    sender: 'NQ customer', recipient: 'NQ café', amountAtomic: '1',
    reference: 'order:42', expiresAt: new Date(2000).toISOString(),
  }
  expect(await wallet.sendMerchantPayment(quote)).toEqual({ hash: 'ab'.repeat(32) })
  host.nimiqPay.network = 'mainnet'
  await expect(wallet.sendMerchantPayment(quote)).rejects.toThrow('WRONG_NETWORK')
  host.nimiqPay.network = 'unknown'
  await expect(wallet.sendMerchantPayment(quote)).rejects.toThrow('NETWORK_UNVERIFIED')
  expect(sends).toBe(1)
})
it('does not sign a NIM checkout until the wallet agrees with the quoted chain height', async () => {
  const sender = 'NQ customer',
    hash = 'ab'.repeat(32)
  let height = 1000000,
    sends = 0
  const wallet = createMerchantWallet({
    now: () => 1000,
    nimiq: async () => ({
      listAccounts: async () => [sender],
      getNetworkId: async () => 'MainAlbatross',
      isConsensusEstablished: async () => true,
      getBlockNumber: async () => height,
      sendBasicTransactionWithData: async () => {
        sends++
        return hash
      },
    }),
  })
  const quote: any = {
    asset: 'NIM',
    network: 'nimiq:24',
    chainHeight: 100,
    sender,
    recipient: 'NQ café',
    amountAtomic: '1',
    reference: 'order:42',
    expiresAt: new Date(2000).toISOString(),
  }
  await expect(wallet.sendMerchantPayment(quote)).rejects.toThrow(
    'WRONG_NETWORK',
  )
  expect(sends).toBe(0)
  height = 102
  expect(await wallet.sendMerchantPayment(quote)).toEqual({ hash })
  expect(sends).toBe(1)
  await expect(
    wallet.sendMerchantPayment({
      ...quote,
      expiresAt: new Date(0).toISOString(),
    }),
  ).rejects.toThrow('QUOTE_EXPIRED')
  expect(sends).toBe(1)
})
it('requests exact ERC20 transfer from the quoted sender on Polygon and requires a matching wallet account', async () => {
  const calls: any[] = []
  const sender = '0x' + '11'.repeat(20),
    recipient = '0x' + '22'.repeat(20),
    hash = '0x' + 'ab'.repeat(32)
  const ethereum = {
    request: async (call: any) => {
      calls.push(call)
      return call.method === 'eth_requestAccounts'
        ? [sender]
        : call.method === 'eth_chainId'
          ? '0x89'
          : call.method === 'eth_sendTransaction'
            ? hash
            : null
    },
  }
  const wallet = createMerchantWallet({ ethereum, now: () => 1000 })
  const quote: any = {
    asset: 'USDT',
    network: 'eip155:137',
    tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    sender,
    recipient,
    amountAtomic: '1234567',
    expiresAt: new Date(2000).toISOString(),
  }
  expect(await wallet.sendMerchantPayment(quote)).toEqual({ hash })
  expect(
    calls.find((c) => c.method === 'eth_sendTransaction').params[0],
  ).toEqual({
    from: sender,
    to: quote.tokenAddress,
    value: '0x0',
    data:
      '0xa9059cbb' +
      recipient.slice(2).padStart(64, '0') +
      '12d687'.padStart(64, '0'),
  })
  await expect(
    wallet.sendMerchantPayment({ ...quote, sender: recipient }),
  ).rejects.toThrow('WRONG_WALLET')
})

it('rejects an explicitly different or unidentifiable NIM network even at the same height', async () => {
  let network: unknown = 'TestAlbatross'
  let sends = 0
  const provider = {
    listAccounts: async () => ['NQ customer'],
    getNetworkId: async () => network,
    isConsensusEstablished: async () => true,
    getBlockNumber: async () => 100,
    sendBasicTransactionWithData: async () => {
      sends++
      return 'ab'.repeat(32)
    },
  }
  const wallet = createMerchantWallet({
    now: () => 1000,
    nimiq: async () => provider,
  })
  const quote: any = {
    asset: 'NIM',
    network: 'nimiq:24',
    chainHeight: 100,
    sender: 'NQ customer',
    recipient: 'NQ café',
    amountAtomic: '1',
    reference: 'order:42',
    expiresAt: new Date(2000).toISOString(),
  }
  await expect(wallet.sendMerchantPayment(quote)).rejects.toThrow(
    'WRONG_NETWORK',
  )
  network = undefined
  await expect(wallet.sendMerchantPayment(quote)).rejects.toThrow(
    'NETWORK_UNVERIFIED',
  )
  expect(sends).toBe(0)
})
