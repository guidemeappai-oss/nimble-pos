import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { MerchantAsset, WalletDiscoveryState, WalletObservation } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { env } from '../env'
import { makeWalletDiscoverySource, type WalletDiscoverySource } from './walletDiscoverySource'
import { loyaltyFail as fail } from './loyalty'
export const configuredWalletSource=()=>makeWalletDiscoverySource({nimiqRpcUrl:env.nimiqRpcUrl,networkId:env.nimiqNetwork==='MainAlbatross'?24:5,polygonRpcUrl:process.env.POLYGON_RPC_URL})
export const walletStateView=(r:typeof s.merchantWalletScan.$inferSelect):WalletDiscoveryState=>({asset:r.asset,network:r.network,recipient:r.recipient,enabled:r.enabled,cursor:r.cursor,lastScannedAt:r.lastScannedAt?.toISOString()??null,lastError:r.lastError,coveredThrough:r.coveredThrough})
const observation=z.object({eventKey:z.string().min(1).max(500),asset:z.enum(['NIM','USDT']),network:z.string(),recipient:z.string(),hash:z.string().min(64).max(66),eventIndex:z.number().int().nonnegative(),sender:z.string().nullable(),amountAtomic:z.string().regex(/^\d+$/),blockNumber:z.number().int().nonnegative(),blockHash:z.string().nullable(),occurredAt:z.string().datetime().nullable(),confirmation:z.enum(['OBSERVED','FINALIZED','REMOVED'])}).strict()
/** All effects are discovery records; this never posts sales, stock or refunds. */
export async function discoverWalletPage(db:Db,source:WalletDiscoverySource,venueId:string,asset:MerchantAsset){
 const token=randomUUID(),now=new Date()
 const state=await db.transaction(async tx=>{
  await tx.select({id:s.merchantVenue.id}).from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId)).for('update')
  const [current]=await tx.select().from(s.merchantWalletScan).where(and(eq(s.merchantWalletScan.venueId,venueId),eq(s.merchantWalletScan.asset,asset))).for('update')
  if(!current||!current.enabled)fail(409,'WALLET_DISCOVERY_DISABLED')
  if(current.leaseUntil&&current.leaseUntil>now)fail(409,'WALLET_SCAN_BUSY')
  const [claimed]=await tx.update(s.merchantWalletScan).set({leaseToken:token,leaseUntil:new Date(now.getTime()+120000),updatedAt:now}).where(eq(s.merchantWalletScan.id,current.id)).returning();return claimed
 })
 try{
  const page=await source.page({asset,network:state.network,recipient:state.recipient,cursor:state.cursor})
  const pending=await db.select().from(s.merchantWalletObservation).where(and(eq(s.merchantWalletObservation.venueId,venueId),sql`${s.merchantWalletObservation.event}->>'confirmation' = 'OBSERVED' AND ${s.merchantWalletObservation.event}->>'asset' = ${asset} AND ${s.merchantWalletObservation.event}->>'network' = ${state.network} AND ${s.merchantWalletObservation.event}->>'recipient' = ${state.recipient}`)).orderBy(asc(s.merchantWalletObservation.checkedAt)).limit(10)
  const refreshed:WalletObservation[]=[]
  for(const row of pending.filter(row=>row.event.asset===asset&&row.event.recipient===state.recipient&&row.event.confirmation==='OBSERVED').slice(0,10))refreshed.push(await source.refresh(row.event))
  const events=[...page.events,...refreshed].map(e=>observation.parse(e))
  if(events.some(e=>e.asset!==asset||e.network!==state.network||e.recipient!==state.recipient||e.eventKey!==`${e.network}:${e.recipient}:${e.hash}:${e.eventIndex}`))throw new Error('INVALID_CHAIN_DATA')
  return await db.transaction(async tx=>{
   await tx.select({id:s.merchantVenue.id}).from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId)).for('update')
   const [current]=await tx.select().from(s.merchantWalletScan).where(eq(s.merchantWalletScan.id,state.id)).for('update')
   if(current.leaseToken!==token||!current.enabled)fail(409,'WALLET_SCAN_REPLACED')
   for(const event of events)await tx.insert(s.merchantWalletObservation).values({venueId,eventKey:event.eventKey,event,checkedAt:new Date()}).onConflictDoUpdate({target:[s.merchantWalletObservation.venueId,s.merchantWalletObservation.eventKey],set:{event,checkedAt:new Date()}})
   const [updated]=await tx.update(s.merchantWalletScan).set({cursor:page.cursor,coveredThrough:page.coveredThrough,lastScannedAt:new Date(),lastError:null,leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(eq(s.merchantWalletScan.id,state.id)).returning()
   return {processed:page.events.length,done:page.done,state:walletStateView(updated)}
  })
 }catch(error){
  const code=error instanceof Error&&['INVALID_CHAIN_DATA','HISTORY_SOURCE_UNAVAILABLE','WRONG_OR_UNAVAILABLE_NETWORK','WALLET_SCAN_REPLACED'].includes(error.message)?error.message:'HISTORY_SCAN_UNAVAILABLE'
  await db.update(s.merchantWalletScan).set({lastError:code,leaseToken:null,leaseUntil:null,updatedAt:new Date()}).where(and(eq(s.merchantWalletScan.id,state.id),eq(s.merchantWalletScan.leaseToken,token)))
  throw Object.assign(new Error(code),{status:code==='WALLET_SCAN_REPLACED'?409:503,code})
 }
}
export async function discoverWallets(db:Db,source:WalletDiscoverySource){
 const rows=await db.select().from(s.merchantWalletScan).where(eq(s.merchantWalletScan.enabled,true)).orderBy(asc(s.merchantWalletScan.updatedAt)).limit(20)
 for(const row of rows)try{await discoverWalletPage(db,source,row.venueId,row.asset)}catch{/* Per-venue errors are persisted and visible to the owner. */}
}
