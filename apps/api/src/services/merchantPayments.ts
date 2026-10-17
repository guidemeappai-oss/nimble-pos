import { randomUUID } from 'node:crypto'
import { Address, Policy } from '@nimiq/core'
import type { MerchantQuote } from '@nimble/shared'
import type { MerchantPaymentGateway } from './merchantGateway'
import {
  atomicAmountForFiat,
  makeMerchantFx,
  type MerchantFx,
} from './merchantFx'
export const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
export type Rpc = (method: string, params?: unknown[]) => Promise<any>
export function makeRpc(
  url: string,
  nimiq = false,
  request: typeof fetch = fetch,
): Rpc {
  let id = 0
  return async (method, params = []) => {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error('CHAIN_UNAVAILABLE')
    const body = await response.json()
    if (body.error || !('result' in body)) throw new Error('CHAIN_UNAVAILABLE')
    return nimiq ? body.result?.data : body.result
  }
}
export function makeMerchantPayments(options: {
  fx?: MerchantFx
  nimiqRpcUrl?: string
  nimiqNetworkId?: 24 | 5
  polygonRpcUrl?: string
  now?: () => number
  request?: typeof fetch
}): MerchantPaymentGateway {
  const now = options.now ?? Date.now,
    fx = options.fx ?? makeMerchantFx(),
    networkId = options.nimiqNetworkId ?? 24
  async function nimHeight() {
    if (!options.nimiqRpcUrl) throw new Error('PAYMENTS_UNAVAILABLE')
    const rpc = makeRpc(options.nimiqRpcUrl, true, options.request)
    const [network, consensus, height] = await Promise.all([
      rpc('getNetworkId'),
      rpc('isConsensusEstablished'),
      rpc('getBlockNumber'),
    ])
    if (
      network !== (networkId === 24 ? 'MainAlbatross' : 'TestAlbatross') ||
      consensus !== true ||
      !Number.isSafeInteger(height) ||
      height < 1
    )
      throw new Error('CHAIN_UNAVAILABLE')
    return height as number
  }
  return {
    async displayRates(fiatCurrency) {
      const read = async (asset: 'NIM' | 'USDT') => {
        if (asset === 'NIM' ? !options.nimiqRpcUrl : !options.polygonRpcUrl)
          return null
        try {
          const rate = await fx.rate(asset, fiatCurrency)
          if (
            !Number.isFinite(Date.parse(rate.at)) ||
            now() - Date.parse(rate.at) > 120_000 ||
            Date.parse(rate.at) > now() + 5000
          )
            return null
          atomicAmountForFiat(1, rate.value, asset)
          return rate
        } catch {
          return null
        }
      }
      const [NIM, USDT] = await Promise.all([read('NIM'), read('USDT')])
      return { NIM, USDT }
    },
    async refreshRefundQuote(quote) {
      if (quote.asset === 'NIM' && quote.network !== `nimiq:${networkId}`)
        throw new Error('WRONG_NETWORK')
      if (
        quote.asset === 'USDT' &&
        (quote.network !== 'eip155:137' || !options.polygonRpcUrl)
      )
        throw new Error('PAYMENTS_UNAVAILABLE')
      return {
        ...quote,
        issuedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + 24 * 60 * 60_000).toISOString(),
        ...(quote.asset === 'NIM' ? { chainHeight: await nimHeight() } : {}),
      }
    },
    async quote(input) {
      if (input.asset === 'NIM' ? !options.nimiqRpcUrl : !options.polygonRpcUrl)
        throw new Error('PAYMENTS_UNAVAILABLE')
      const sender =
        input.asset === 'NIM'
          ? Address.fromString(input.sender).toUserFriendlyAddress()
          : evmAddress(input.sender)
      const recipient =
        input.asset === 'NIM'
          ? Address.fromString(input.recipient).toUserFriendlyAddress()
          : evmAddress(input.recipient)
      if (!input.reference || Buffer.byteLength(input.reference) > 64)
        throw new Error('INVALID_REFERENCE')
      const rate = await fx.rate(input.asset, input.fiatCurrency)
      if (
        !Number.isFinite(Date.parse(rate.at)) ||
        now() - Date.parse(rate.at) > 120000 ||
        Date.parse(rate.at) > now() + 5000
      )
        throw new Error('RATES_UNAVAILABLE')
      let chainHeight: number | undefined
      if (input.asset === 'NIM') {
        chainHeight = await nimHeight()
      }
      return {
        id: randomUUID(),
        asset: input.asset,
        network: input.asset === 'NIM' ? `nimiq:${networkId}` : 'eip155:137',
        amountAtomic: atomicAmountForFiat(
          input.totalMinor,
          rate.value,
          input.asset,
        ),
        sender,
        recipient,
        reference: input.reference,
        issuedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + 120000).toISOString(),
        rate: rate.value,
        rateAt: rate.at,
        rateSource: rate.source,
        ...(input.asset === 'USDT'
          ? { tokenAddress: USDT_POLYGON }
          : { chainHeight }),
      }
    },
    async verify({ hash, quote }) {
      if (!/^[1-9]\d*$/.test(quote.amountAtomic)) return null
      if (quote.asset === 'USDT') {
        if (!options.polygonRpcUrl) throw new Error('PAYMENTS_UNAVAILABLE')
        return verifyPolygon(
          makeRpc(options.polygonRpcUrl, false, options.request),
          hash,
          quote,
        )
      }
      if (!options.nimiqRpcUrl) throw new Error('PAYMENTS_UNAVAILABLE')
      return verifyNimiq(
        makeRpc(options.nimiqRpcUrl, true, options.request),
        hash,
        quote,
        networkId,
      )
    },
  }
}
function evmAddress(value: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('INVALID_ADDRESS')
  return value.toLowerCase()
}

const same = (a: unknown, b: string) =>
  typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
const transferTopic =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
// Quote expiry blocks new signing; it must not hide funds that actually arrived.
// Settlement routes late verified receipts to a full refund instead of fulfillment.
function afterQuoteIssued(timestamp: number, quote: MerchantQuote) {
  const issued = Date.parse(quote.issuedAt ?? ''),
    expires = Date.parse(quote.expiresAt)
  return (
    Number.isFinite(timestamp) &&
    timestamp >= issued - 1000 &&
    Number.isFinite(expires)
  )
}
async function verifyPolygon(rpc: Rpc, hash: string, quote: MerchantQuote) {
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(hash) ||
    quote.network !== 'eip155:137' ||
    !same(quote.tokenAddress, USDT_POLYGON)
  )
    return null
  if ((await rpc('eth_chainId')) !== '0x89') throw new Error('WRONG_NETWORK')
  const [receipt, tx, finalized] = await Promise.all([
    rpc('eth_getTransactionReceipt', [hash]),
    rpc('eth_getTransactionByHash', [hash]),
    rpc('eth_getBlockByNumber', ['finalized', false]),
  ])
  if (
    !receipt ||
    !tx ||
    !finalized ||
    receipt.status !== '0x1' ||
    !same(receipt.transactionHash, hash) ||
    !same(tx.hash, hash) ||
    !receipt.blockHash ||
    !receipt.blockNumber
  )
    return null
  if (
    !same(tx.blockHash, receipt.blockHash) ||
    tx.blockNumber !== receipt.blockNumber ||
    BigInt(finalized.number) < BigInt(receipt.blockNumber)
  )
    return null
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
  if (
    !block ||
    !same(block.hash, receipt.blockHash) ||
    block.number !== receipt.blockNumber ||
    !afterQuoteIssued(Number(BigInt(block.timestamp)) * 1000, quote)
  )
    return null
  const input =
    '0xa9059cbb' +
    evmAddress(quote.recipient).slice(2).padStart(64, '0') +
    BigInt(quote.amountAtomic).toString(16).padStart(64, '0')
  if (
    !same(tx.from, quote.sender) ||
    !same(receipt.from, quote.sender) ||
    !same(tx.to, USDT_POLYGON) ||
    !same(receipt.to, USDT_POLYGON) ||
    tx.value !== '0x0' ||
    !same(tx.input, input)
  )
    return null
  const topic = (address: string) =>
    '0x' + evmAddress(address).slice(2).padStart(64, '0')
  const transfers = (receipt.logs ?? []).filter(
    (log: any) =>
      same(log.address, USDT_POLYGON) && same(log.topics?.[0], transferTopic),
  )
  if (transfers.length !== 1) return null
  const log = transfers[0]
  if (
    log.removed === true ||
    !same(log.transactionHash, hash) ||
    !same(log.blockHash, receipt.blockHash) ||
    log.topics.length !== 3 ||
    !same(log.topics[1], topic(quote.sender)) ||
    !same(log.topics[2], topic(quote.recipient)) ||
    !/^0x[0-9a-fA-F]{64}$/.test(log.data) ||
    BigInt(log.data) !== BigInt(quote.amountAtomic)
  )
    return null
  return {
    asset: quote.asset,
    network: quote.network,
    amountAtomic: quote.amountAtomic,
    sender: quote.sender,
    recipient: quote.recipient,
    hash: hash.toLowerCase(),
    confirmedAt: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
  }
}

async function verifyNimiq(
  rpc: Rpc,
  hash: string,
  quote: MerchantQuote,
  networkId: number,
) {
  if (!/^[0-9a-fA-F]{64}$/.test(hash) || quote.network !== `nimiq:${networkId}`)
    return null
  const [network, consensus] = await Promise.all([
    rpc('getNetworkId'),
    rpc('isConsensusEstablished'),
  ])
  if (
    network !== (networkId === 24 ? 'MainAlbatross' : 'TestAlbatross') ||
    consensus !== true
  )
    throw new Error('CHAIN_UNAVAILABLE')
  const tx = await rpc('getTransactionByHash', [hash])
  if (!tx || !Number.isSafeInteger(tx.blockNumber) || tx.blockNumber <= 0)
    return null
  const finalHeight = Policy.macroBlockAfter(tx.blockNumber)
  const [block, finalized] = await Promise.all([
    rpc('getBlockByNumber', [tx.blockNumber, true]),
    rpc('getBlockByNumber', [finalHeight, false]),
  ])
  if (
    !block ||
    block.number !== tx.blockNumber ||
    !finalized ||
    finalized.number !== finalHeight ||
    finalized.type !== 'macro'
  )
    return null
  const canonical = block.transactions?.find((candidate: any) =>
    same(candidate.hash, hash),
  )
  if (
    !canonical ||
    canonical.executionResult !== true ||
    canonical.networkId !== networkId ||
    canonical.blockNumber !== tx.blockNumber ||
    !afterQuoteIssued(canonical.timestamp, quote)
  )
    return null
  if (
    Address.fromString(canonical.from).toUserFriendlyAddress() !==
      quote.sender ||
    Address.fromString(canonical.to).toUserFriendlyAddress() !== quote.recipient
  )
    return null
  if (
    !Number.isSafeInteger(canonical.value) ||
    String(canonical.value) !== quote.amountAtomic ||
    !same(
      canonical.recipientData,
      Buffer.from(quote.reference, 'utf8').toString('hex'),
    )
  )
    return null
  return {
    asset: quote.asset,
    network: quote.network,
    amountAtomic: quote.amountAtomic,
    sender: quote.sender,
    recipient: quote.recipient,
    hash: hash.toLowerCase(),
    confirmedAt: new Date(canonical.timestamp).toISOString(),
  }
}
