import { it, expect, vi } from 'vitest'
import postgres from 'postgres'
import { Address, KeyPair, PrivateKey, TransactionBuilder } from '@nimiq/core'
import {
  makeNotificationWorker,
  makePostgresNotificationStore,
} from '../src/services/merchantNotifications'
it('recovers persisted bytes after a worker restart and enforces a budget across workers', async () => {
  const schema = 'notification_test_' + Date.now()
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://postgres:nimblink@localhost:5433/nimblink_test'
  const admin = postgres(url)
  await admin.unsafe(`create schema ${schema}`)
  const sql = postgres(url, { connection: { search_path: schema } })
  try {
    // Set it explicitly as well as in connection startup parameters: embedded
    // PostgreSQL protocol runners do not apply every startup parameter.
    await sql.unsafe(`set search_path to ${schema}`)
    await sql`create table merchant_notification_outbox(event_id text primary key,order_id text unique,recipient text,network text,status text default 'PENDING',raw_transaction text,transaction_hash text,signed_at timestamptz,attempts integer default 0,next_attempt_at timestamptz default now(),created_at timestamptz default now())`
    await sql`insert into merchant_notification_outbox(event_id,order_id,recipient,network) values ('event-1','order-1','recipient','nimiq:24')`
    const key = KeyPair.derive(PrivateKey.fromHex('11'.repeat(32)))
    const tx = TransactionBuilder.newBasicWithData(
      key.toAddress(),
      new Address(new Uint8Array(20).fill(2)),
      new TextEncoder().encode('event-1'),
      1n,
      2n,
      100,
      24,
    )
    key.signTransaction(tx)
    const sign = vi.fn(async () => ({
      rawTransaction: tx.toHex(),
      transactionHash: tx.hash(),
    }))
    const firstBroadcast = vi.fn(async () => {
      throw new Error('unknown delivery')
    })
    const options = {
      network: 'nimiq:24',
      dailyBudgetLuna: 3,
      feeLuna: 2,
      maxPerMinute: 5,
    }
    await makeNotificationWorker({
      ...options,
      store: makePostgresNotificationStore(sql),
      signer: { sign, broadcast: firstBroadcast },
    }).tick()
    const [persisted] =
      await sql`select raw_transaction,transaction_hash from merchant_notification_outbox where event_id='event-1'`
    expect(persisted.raw_transaction).toBe(tx.toHex())
    await sql`update merchant_notification_outbox set next_attempt_at=now() where event_id='event-1'`
    const broadcast = vi.fn(async (raw: string) => {
      expect(raw).toBe(persisted.raw_transaction)
      return persisted.transaction_hash
    })
    const restarted = makeNotificationWorker({
      ...options,
      store: makePostgresNotificationStore(sql),
      signer: { sign, broadcast },
    })
    await Promise.all([restarted.tick(), restarted.tick()])
    expect(sign).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledTimes(1)
    await sql`insert into merchant_notification_outbox(event_id,order_id,recipient,network) values ('event-2','order-2','recipient','nimiq:24')`
    await restarted.tick()
    expect(sign).toHaveBeenCalledTimes(1)
  } finally {
    await sql`set search_path to public`
    await sql.end()
    await admin.unsafe(`drop schema ${schema} cascade`)
    await admin.end()
  }
})
