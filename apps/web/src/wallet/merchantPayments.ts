import type { MerchantAsset, MerchantQuote } from '@nimble/shared'
import { init } from '@nimiq/mini-app-sdk'
import { hostNimiqNetwork } from './hostNetwork'

const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}
interface NimProvider {
  listAccounts(): Promise<unknown>
  isConsensusEstablished(): Promise<unknown>
  getBlockNumber(): Promise<unknown>
  getNetworkId?(): Promise<unknown>
  request?(args: { method: string; params?: unknown[] }): Promise<unknown>
  sendBasicTransactionWithData(tx: {
    recipient: string
    value: number
    data: string
  }): Promise<unknown>
}
function unwrap<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'error' in value) {
    const payload = (value as any).error
    const error = new Error(payload.message) as Error & { code?: string }
    if (payload.type === 'PermissionDeniedError')
      error.code = 'PERMISSION_DENIED'
    throw error
  }
  return value as T
}
function sameAddress(a: string, b: string) {
  return (
    a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase()
  )
}
/** A separate adapter keeps live merchant payments out of the P2P mock provider. */
export function createMerchantWallet(
  options: {
    ethereum?: EthereumProvider
    nimiq?: () => Promise<NimProvider>
    now?: () => number
  } = {},
) {
  const ethereum = () =>
    options.ethereum ??
    (window as unknown as { ethereum?: EthereumProvider }).ethereum
  const initNimiq = options.nimiq ?? (() => init({ timeout: 10000 }))
  const nimiq = async (): Promise<NimProvider> => {
    try {
      return (await initNimiq()) as NimProvider
    } catch {
      throw new Error('WALLET_UNAVAILABLE')
    }
  }
  async function getMerchantNimAddress() {
    const accounts = unwrap<string[]>(await (await nimiq()).listAccounts())
    if (!accounts.length) throw new Error('WALLET_UNAVAILABLE')
    return accounts[0]
  }
  async function getMerchantSender(asset: MerchantAsset) {
    if (asset === 'NIM') return getMerchantNimAddress()
    const provider = ethereum()
    if (!provider) throw new Error('WALLET_UNAVAILABLE')
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    if (
      !Array.isArray(accounts) ||
      typeof accounts[0] !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])
    )
      throw new Error('WALLET_UNAVAILABLE')
    return accounts[0] as string
  }
  async function sendMerchantPayment(
    quote: MerchantQuote,
  ): Promise<{ hash: string }> {
    const assertFresh = () => {
      if (
        !Number.isFinite(Date.parse(quote.expiresAt)) ||
        Date.parse(quote.expiresAt) <= (options.now ?? Date.now)()
      )
        throw new Error('QUOTE_EXPIRED')
    }
    assertFresh()
    if (
      !/^[1-9]\d*$/.test(quote.amountAtomic) ||
      BigInt(quote.amountAtomic) >= 2n ** 256n
    )
      throw new Error('INVALID_AMOUNT')
    if (!sameAddress(await getMerchantSender(quote.asset), quote.sender))
      throw new Error('WRONG_WALLET')
    if (quote.asset === 'NIM') {
      if (
        !['nimiq:24', 'nimiq:5'].includes(quote.network) ||
        BigInt(quote.amountAtomic) > BigInt(Number.MAX_SAFE_INTEGER) ||
        !quote.reference ||
        new TextEncoder().encode(quote.reference).length > 64
      )
        throw new Error('INVALID_QUOTE')
      const provider = await nimiq()
      // Height is only a syncing check. Prefer the official host network;
      // older hosts may expose an explicit network through provider RPC.
      let network: unknown
      try {
        const host = hostNimiqNetwork()
        network = host === 'mainnet' ? 24 : host === 'testnet' ? 5 : provider.getNetworkId
          ? unwrap(await provider.getNetworkId())
          : provider.request
            ? unwrap(
                await provider.request({ method: 'getNetworkId', params: [] }),
              )
            : undefined
      } catch {
        throw new Error('NETWORK_UNVERIFIED')
      }
      if (network === undefined || network === null)
        throw new Error('NETWORK_UNVERIFIED')
      const expected =
        quote.network === 'nimiq:24' ? 'MainAlbatross' : 'TestAlbatross'
      const expectedId = quote.network === 'nimiq:24' ? 24 : 5
      if (network !== expected && network !== expectedId)
        throw new Error('WRONG_NETWORK')
      const [consensus, height] = await Promise.all([
        provider.isConsensusEstablished(),
        provider.getBlockNumber(),
      ])
      const chainHeight = (quote as MerchantQuote & { chainHeight?: number })
        .chainHeight
      if (
        unwrap<boolean>(consensus) !== true ||
        !Number.isSafeInteger(unwrap<number>(height)) ||
        !Number.isSafeInteger(chainHeight)
      )
        throw new Error('WALLET_SYNC_REQUIRED')
      if (Math.abs(unwrap<number>(height) - chainHeight!) > 100_000)
        throw new Error('WRONG_NETWORK')
      assertFresh()
      const data = quote.reference
      const hash = unwrap<string>(
        await provider.sendBasicTransactionWithData({
          recipient: quote.recipient,
          value: Number(quote.amountAtomic),
          data,
        }),
      )
      if (!/^[0-9a-fA-F]{64}$/.test(hash))
        throw new Error('INVALID_TRANSACTION_HASH')
      return { hash }
    }
    if (
      quote.network !== 'eip155:137' ||
      quote.tokenAddress?.toLowerCase() !== USDT_POLYGON.toLowerCase() ||
      !/^0x[0-9a-fA-F]{40}$/.test(quote.recipient)
    )
      throw new Error('INVALID_QUOTE')
    const provider = ethereum()!
    if ((await provider.request({ method: 'eth_chainId' })) !== '0x89')
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x89' }],
      })
    if ((await provider.request({ method: 'eth_chainId' })) !== '0x89')
      throw new Error('WRONG_NETWORK')
    assertFresh()
    const data =
      '0xa9059cbb' +
      quote.recipient.slice(2).toLowerCase().padStart(64, '0') +
      BigInt(quote.amountAtomic).toString(16).padStart(64, '0')
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: quote.sender, to: USDT_POLYGON, value: '0x0', data }],
    })
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new Error('INVALID_TRANSACTION_HASH')
    return { hash }
  }
  return { getMerchantSender, getMerchantNimAddress, sendMerchantPayment }
}
const live = createMerchantWallet()
export const getMerchantSender = live.getMerchantSender
export const getMerchantNimAddress = live.getMerchantNimAddress
export const sendMerchantPayment = live.sendMerchantPayment
