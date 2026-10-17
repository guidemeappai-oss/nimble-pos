import { createHash } from 'node:crypto'
import { Address } from '@nimiq/core'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import * as s from '../db/schema'
import type { Db } from '../db/client'
import { env } from '../env'
import { taskActorKey, type MerchantTaskHelpers } from './tasks'
import { loyaltyFail as fail } from '../services/loyalty'
import { configuredWalletSource, discoverWalletPage, walletStateView } from '../services/walletDiscovery'
const uuid=z.string().uuid()
export async function walletDiscoveryRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/wallet-discovery'
 const context=async(req:FastifyRequest)=>{const a=await h.actor(req);if(a.kind!=='owner')return fail(403,'OWNER_REQUIRED');const venueId=uuid.parse((req.params as any).venueId),venue=await h.venueFor(a,venueId);return {a,venue}}
 app.get(base,async req=>{
  const {venue}=await context(req),q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query)
  const states=await db.select().from(s.merchantWalletScan).where(eq(s.merchantWalletScan.venueId,venue.id))
  const rows=await db.select().from(s.merchantWalletObservation).where(eq(s.merchantWalletObservation.venueId,venue.id)).orderBy(desc(s.merchantWalletObservation.discoveredAt),desc(s.merchantWalletObservation.id)).limit(26).offset(q.page*25)
  const resolutions=rows.length?await db.select().from(s.merchantDepositResolution).where(and(eq(s.merchantDepositResolution.venueId,venue.id),inArray(s.merchantDepositResolution.observationId,rows.map(r=>r.id)))):[]
  const hashes=rows.map(r=>r.event.hash)
  const attempts=hashes.length?await db.select({orderId:s.merchantTransferAttempt.orderId,hash:s.merchantTransferAttempt.hash,quote:s.merchantTransferAttempt.quote}).from(s.merchantTransferAttempt).innerJoin(s.merchantOrder,eq(s.merchantOrder.id,s.merchantTransferAttempt.orderId)).where(and(eq(s.merchantOrder.venueId,venue.id),eq(s.merchantTransferAttempt.purpose,'PAYMENT'),inArray(sql`lower(${s.merchantTransferAttempt.hash})`,hashes.map(h=>h.toLowerCase())))):[]
  return {states:states.map(walletStateView),items:rows.slice(0,25).map(r=>({...r.event,id:r.id,resolution:resolutions.find(d=>d.observationId===r.id)?.data,reportedOrderIds:[...new Set(attempts.filter(a=>a.hash.toLowerCase()===r.event.hash.toLowerCase()&&a.quote.network===r.event.network&&a.quote.amountAtomic===r.event.amountAtomic&&a.quote.recipient.replaceAll(' ','').toLowerCase()===r.event.recipient.replaceAll(' ','').toLowerCase()).map(a=>a.orderId))]})),hasMore:rows.length>25}
 })
 app.put(base+'/configuration',async req=>{
  const {a,venue}=await context(req),input=z.object({asset:z.enum(['NIM','USDT']),enabled:z.boolean(),startBlock:z.number().int().min(0).max(2147483647).optional(),restart:z.boolean().default(false),reason:z.string().trim().min(3).max(500),idempotencyKey:uuid}).strict().parse(req.body)
  const [existing]=!input.enabled?await db.select().from(s.merchantWalletScan).where(and(eq(s.merchantWalletScan.venueId,venue.id),eq(s.merchantWalletScan.asset,input.asset))):[]
  let recipient:string,network:string
  try{if(existing){recipient=existing.recipient;network=existing.network}else{recipient=input.asset==='NIM'?Address.fromString(venue.nimAddress).toUserFriendlyAddress():venue.usdtAddress?.toLowerCase()??'';if(input.asset==='USDT'&&!/^0x[\da-f]{40}$/i.test(recipient))throw new Error();network=input.asset==='NIM'?`nimiq:${env.nimiqNetwork==='MainAlbatross'?24:5}`:'eip155:137'}}catch{return fail(400,'INVALID_RECEIVER_ADDRESS')}
  return db.transaction(async raw=>{
   const tx=raw as unknown as Db;await tx.select().from(s.merchantVenue).where(eq(s.merchantVenue.id,venue.id)).for('update')
   const actor=taskActorKey(a),hash=createHash('sha256').update(JSON.stringify({venueId:venue.id,action:'wallet.configure',...input})).digest('hex')
   const [oldRequest]=await tx.select().from(s.merchantTaskRequest).where(and(eq(s.merchantTaskRequest.actor,actor),eq(s.merchantTaskRequest.key,input.idempotencyKey)))
   if(oldRequest){if(oldRequest.requestHash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');return oldRequest.response}
   const [old]=await tx.select().from(s.merchantWalletScan).where(and(eq(s.merchantWalletScan.venueId,venue.id),eq(s.merchantWalletScan.asset,input.asset))).for('update')
   const reset=!old||input.restart||old.recipient!==recipient||old.network!==network
   if(reset&&input.asset==='USDT'&&input.startBlock===undefined)fail(400,'HISTORY_START_BLOCK_REQUIRED')
   const cursor=reset?(input.asset==='USDT'?{nextBlock:input.startBlock??0}:{}):old.cursor
   const value={venueId:venue.id,asset:input.asset,network,recipient,enabled:input.enabled,cursor,leaseToken:null,leaseUntil:null,lastError:null,updatedAt:new Date(),...(reset?{coveredThrough:null,lastScannedAt:null}:{})}
   const [saved]=await tx.insert(s.merchantWalletScan).values(value).onConflictDoUpdate({target:[s.merchantWalletScan.venueId,s.merchantWalletScan.asset],set:value}).returning()
   const response=walletStateView(saved);await h.audit(tx,a,venue.id,'wallet.discovery.configuration',input.reason,old?walletStateView(old):null,response);await tx.insert(s.merchantTaskRequest).values({actor,key:input.idempotencyKey,requestHash:hash,response});return response
  })
 })
 app.post(base+'/scan',async req=>{const {venue}=await context(req),input=z.object({asset:z.enum(['NIM','USDT'])}).strict().parse(req.body);return discoverWalletPage(db,app.deps.walletDiscovery??configuredWalletSource(),venue.id,input.asset)})
}
