import {
  Address,
  KeyPair,
  PrivateKey,
  Transaction,
  TransactionBuilder,
} from '@nimiq/core'
import type { Sql } from 'postgres'
import { makeRpc } from './merchantPayments'

export interface NotificationRow {
  eventId: string
  orderId: string
  recipient: string
  network: string
  rawTransaction: string | null
  transactionHash: string | null
  attempts: number
}
export interface SignedNotification {
  rawTransaction: string
  transactionHash: string
}
interface NotificationSession {
  next(): Promise<NotificationRow | null>
  canSpend(
    luna: number,
    dailyBudget: number,
    maxPerMinute: number,
  ): Promise<boolean>
  persistSigned(eventId: string, signed: SignedNotification): Promise<void>
  markSent(eventId: string): Promise<void>
  retry(eventId: string, attempts: number): Promise<void>
}
export interface NotificationStore {
  exclusive(run: (session: NotificationSession) => Promise<void>): Promise<void>
}
export interface NotificationSigner {
  sign(event: NotificationRow): Promise<SignedNotification>
  broadcast(rawTransaction: string): Promise<string>
}
/** One committed outbox row per READY event; a retry never creates another signed transaction. */
export function makeNotificationWorker(options: {
  store: NotificationStore
  signer: NotificationSigner
  network: string
  dailyBudgetLuna: number
  feeLuna: number
  maxPerMinute: number
}) {
  if (
    !Number.isSafeInteger(options.dailyBudgetLuna) ||
    options.dailyBudgetLuna < 1 ||
    !Number.isSafeInteger(options.feeLuna) ||
    options.feeLuna < 0 ||
    !Number.isSafeInteger(options.maxPerMinute) ||
    options.maxPerMinute < 1
  )
    throw new Error('INVALID_NOTIFICATION_LIMITS')
  return {
    async tick() {
      await options.store.exclusive(async (session) => {
        const event = await session.next()
        if (!event) return
        try {
          if (event.network !== options.network)
            throw new Error('WRONG_NOTIFICATION_NETWORK')
          let signed: SignedNotification
          if (event.rawTransaction && event.transactionHash)
            signed = {
              rawTransaction: event.rawTransaction,
              transactionHash: event.transactionHash,
            }
          else {
            if (event.rawTransaction || event.transactionHash)
              throw new Error('INVALID_OUTBOX')
            if (
              !(await session.canSpend(
                1 + options.feeLuna,
                options.dailyBudgetLuna,
                options.maxPerMinute,
              ))
            )
              return
            signed = await options.signer.sign(event)
            // This await must commit durably BEFORE the first externally visible broadcast.
            await session.persistSigned(event.eventId, signed)
          }
          const hash = await options.signer.broadcast(signed.rawTransaction)
          if (hash.toLowerCase() !== signed.transactionHash.toLowerCase())
            throw new Error('WRONG_BROADCAST_HASH')
          await session.markSent(event.eventId)
        } catch {
          // No raw errors: RPC URLs and signing material must not leak into logs.
          await session.retry(event.eventId, event.attempts + 1)
        }
      })
    },
  }
}

/** Session advisory lock serializes workers; each statement autocommits, including signed bytes. */
export function makePostgresNotificationStore(sql: Sql): NotificationStore {
  return {
    async exclusive(run) {
      const connection = await sql.reserve()
      let locked = false
      try {
        const [lock] =
          await connection`select pg_try_advisory_lock(791235883) as locked`
        locked = lock.locked
        if (!locked) return
        await run({
          async next() {
            const [row] = await connection<
              NotificationRow[]
            >`select event_id as "eventId",order_id as "orderId",recipient,network,raw_transaction as "rawTransaction",transaction_hash as "transactionHash",attempts from merchant_notification_outbox where status='PENDING' and next_attempt_at<=now() order by next_attempt_at,created_at limit 1`
            return row ?? null
          },
          async canSpend(luna, dailyBudget, maxPerMinute) {
            // Count persisted reservations, including uncertain broadcasts. Retried rows are conservatively
            // reserved on later days while pending; signing time is immutable.
            const rows =
              await connection`select raw_transaction, signed_at>=now()-interval '1 minute' as recent from merchant_notification_outbox where raw_transaction is not null and (signed_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' or status='PENDING')`
            let spent = 0n,
              recent = 0
            for (const row of rows) {
              const tx = Transaction.fromAny(row.raw_transaction)
              spent += tx.value + tx.fee
              if (row.recent) recent++
            }
            return (
              spent + BigInt(luna) <= BigInt(dailyBudget) &&
              recent < maxPerMinute
            )
          },
          async persistSigned(eventId, signed) {
            const rows =
              await connection`update merchant_notification_outbox set raw_transaction=${signed.rawTransaction},transaction_hash=${signed.transactionHash},signed_at=now(),next_attempt_at=now() where event_id=${eventId} and raw_transaction is null and status='PENDING' returning event_id`
            if (rows.length !== 1) throw new Error('OUTBOX_CONFLICT')
          },
          async markSent(eventId) {
            await connection`update merchant_notification_outbox set status='SENT' where event_id=${eventId}`
          },
          async retry(eventId, attempts) {
            const delay = Math.min(3600, 2 ** Math.min(attempts, 12))
            await connection`update merchant_notification_outbox set attempts=${attempts},status=${attempts >= 12 ? 'FAILED' : 'PENDING'},next_attempt_at=now()+${delay}*interval '1 second' where event_id=${eventId}`
          },
        })
      } finally {
        try {
          if (locked) await connection`select pg_advisory_unlock(791235883)`
        } finally {
          connection.release()
        }
      }
    },
  }
}

export function makeNotificationSigner(options: {
  privateKeyHex: string
  senderAddress: string
  rpcUrl: string
  networkId: 24 | 5
  feeLuna: number
  request?: typeof fetch
}): NotificationSigner {
  if (
    !/^[0-9a-fA-F]{64}$/.test(options.privateKeyHex) ||
    !Number.isSafeInteger(options.feeLuna) ||
    options.feeLuna < 0
  )
    throw new Error('INVALID_NOTIFICATION_CONFIG')
  const key = PrivateKey.fromHex(options.privateKeyHex),
    pair = KeyPair.derive(key)
  const sender = Address.fromString(options.senderAddress)
  if (!pair.toAddress().equals(sender))
    throw new Error('NOTIFICATION_KEY_MISMATCH')
  const rpc = makeRpc(options.rpcUrl, true, options.request)
  return {
    async sign(event) {
      if (event.network !== `nimiq:${options.networkId}`)
        throw new Error('WRONG_NETWORK')
      const [network, consensus, height, account] = await Promise.all([
        rpc('getNetworkId'),
        rpc('isConsensusEstablished'),
        rpc('getBlockNumber'),
        rpc('getAccountByAddress', [options.senderAddress]),
      ])
      if (
        network !==
          (options.networkId === 24 ? 'MainAlbatross' : 'TestAlbatross') ||
        consensus !== true ||
        !Number.isSafeInteger(height) ||
        height < 1
      )
        throw new Error('CHAIN_UNAVAILABLE')
      if (
        !Number.isSafeInteger(account?.balance) ||
        account.balance < 1 + options.feeLuna
      )
        throw new Error('NOTIFICATION_BALANCE_LOW')
      const data = new TextEncoder().encode(`nimble:ready:${event.eventId}`)
      if (data.length > 64) throw new Error('INVALID_EVENT')
      const tx = TransactionBuilder.newBasicWithData(
        sender,
        Address.fromString(event.recipient),
        data,
        1n,
        BigInt(options.feeLuna),
        height,
        options.networkId,
      )
      pair.signTransaction(tx)
      return { rawTransaction: tx.toHex(), transactionHash: tx.hash() }
    },
    async broadcast(raw) {
      return rpc('sendRawTransaction', [raw])
    },
  }
}

/** Missing dedicated settings disable the worker. Never derive its key from owner wallets. */
export function configuredNotificationWorker(
  sql: Sql,
  config: Record<string, string | undefined>,
) {
  const names = [
    'NOTIFICATION_PRIVATE_KEY_HEX',
    'NOTIFICATION_SENDER_ADDRESS',
    'NOTIFICATION_RPC_URL',
    'NOTIFICATION_NETWORK_ID',
    'NOTIFICATION_DAILY_BUDGET_LUNA',
    'NOTIFICATION_FEE_LUNA',
    'NOTIFICATION_MAX_PER_MINUTE',
  ] as const
  if (
    config.NOTIFICATIONS_ENABLED !== 'true' ||
    names.some((name) => !config[name])
  )
    return null
  const networkId = Number(config.NOTIFICATION_NETWORK_ID)
  if (networkId !== 24 && networkId !== 5)
    throw new Error('INVALID_NOTIFICATION_NETWORK')
  const feeLuna = Number(config.NOTIFICATION_FEE_LUNA)
  return makeNotificationWorker({
    store: makePostgresNotificationStore(sql),
    signer: makeNotificationSigner({
      privateKeyHex: config.NOTIFICATION_PRIVATE_KEY_HEX!,
      senderAddress: config.NOTIFICATION_SENDER_ADDRESS!,
      rpcUrl: config.NOTIFICATION_RPC_URL!,
      networkId,
      feeLuna,
    }),
    network: `nimiq:${networkId}`,
    dailyBudgetLuna: Number(config.NOTIFICATION_DAILY_BUDGET_LUNA),
    feeLuna,
    maxPerMinute: Number(config.NOTIFICATION_MAX_PER_MINUTE),
  })
}
