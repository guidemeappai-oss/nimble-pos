import { createHash } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import * as s from '../db/schema'
import type { Db } from '../db/client'
import { taskActorKey, type MerchantTaskHelpers } from './tasks'
import { loyaltyFail as fail } from '../services/loyalty'
const uuid = z.string().uuid()
const intent = z.object({ revision:z.number().int().positive(),idempotencyKey:uuid,kind:z.enum(['PERCENT','FIXED']),value:z.number().int().positive().max(100000000),reason:z.string().trim().min(3).max(500) }).strict()
export async function discountRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId'
 async function context(req:any){const a=await h.actor(req),venueId=uuid.parse(req.params.venueId);await h.venueFor(a,venueId);return {a,venueId}}
 async function replay(store:Db,a:Parameters<typeof taskActorKey>[0],key:string,payload:unknown,run:()=>Promise<unknown>){
  const actor=taskActorKey(a),hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  await store.execute(sql`select pg_advisory_xact_lock(hashtext(${actor+key}))`)
  const [old]=await store.select().from(s.merchantTaskRequest).where(and(eq(s.merchantTaskRequest.actor,actor),eq(s.merchantTaskRequest.key,key)))
  if(old){if(old.requestHash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');return old.response}
  const response=await run();await store.insert(s.merchantTaskRequest).values({actor,key,requestHash:hash,response});return response
 }
 app.get(base+'/discount-limits',async req=>{const {a,venueId}=await context(req);return db.select().from(s.merchantDiscountLimit).where(and(eq(s.merchantDiscountLimit.venueId,venueId),a.kind==='cashier'?eq(s.merchantDiscountLimit.employeeId,a.employeeId):undefined))})
 app.put(base+'/discount-limits/:employeeId',async req=>{
  const {a,venueId}=await context(req);if(a.kind!=='owner')fail(403,'FORBIDDEN')
  const employeeId=uuid.parse((req.params as any).employeeId),input=z.object({maxBasisPoints:z.number().int().min(0).max(10000),maxMinor:z.number().int().min(0).max(100000000),reason:z.string().trim().min(3).max(500)}).strict().parse(req.body)
  return db.transaction(async tx=>{const store=tx as unknown as Db;const [employee]=await tx.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id,employeeId),eq(s.merchantEmployee.venueId,venueId)));if(!employee)fail(404,'NOT_FOUND')
   const value={venueId,employeeId,maxBasisPoints:input.maxBasisPoints,maxMinor:input.maxMinor};await tx.insert(s.merchantDiscountLimit).values(value).onConflictDoUpdate({target:s.merchantDiscountLimit.employeeId,set:value});await h.audit(store,a,venueId,'discount.limit',input.reason,null,value);return value
  })
 })
 app.get(base+'/orders/:orderId/discount',async req=>{const {venueId}=await context(req),orderId=uuid.parse((req.params as any).orderId);const [o]=await db.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,orderId),eq(s.merchantOrder.venueId,venueId)));if(!o)fail(404,'NOT_FOUND');const [d]=await db.select().from(s.merchantDiscount).where(eq(s.merchantDiscount.orderId,orderId));return d??null})
 async function apply(store:Db,o:typeof s.merchantOrder.$inferSelect,d:typeof s.merchantDiscount.$inferSelect,approver:string){
  if(o.status!=='AWAITING_PAYMENT'||o.source!=='COUNTER'||o.revision!==d.orderRevision||o.quote||o.quoteHistory.length||o.pendingPaymentHash||o.payment||o.paymentSnapshot)fail(409,'ORDER_LOCKED')
  const [old]=await store.select().from(s.merchantOrderRevision).where(and(eq(s.merchantOrderRevision.orderId,o.id),eq(s.merchantOrderRevision.revision,o.revision)))
  if(!old)fail(409,'STALE_REVISION')
  const totalMinor=o.totalMinor-d.amountMinor
  await store.update(s.merchantOrder).set({totalMinor,revision:o.revision+1}).where(eq(s.merchantOrder.id,o.id))
  await store.insert(s.merchantOrderRevision).values({orderId:o.id,revision:o.revision+1,snapshot:{...old.snapshot,totalMinor}})
  const [result]=await store.update(s.merchantDiscount).set({status:'APPLIED',approvedBy:approver,approvedAt:new Date()}).where(eq(s.merchantDiscount.orderId,o.id)).returning();return result
 }
 app.post(base+'/orders/:orderId/discount',async req=>{
  const {a,venueId}=await context(req),orderId=uuid.parse((req.params as any).orderId),input=intent.parse(req.body)
  return db.transaction(async tx=>replay(tx as unknown as Db,a,input.idempotencyKey,{action:'discount.request',venueId,orderId,...input},async()=>{
   const store=tx as unknown as Db
   if(a.kind==='cashier'){const [shift]=await tx.select().from(s.merchantShift).where(and(eq(s.merchantShift.employeeId,a.employeeId),eq(s.merchantShift.venueId,venueId),isNull(s.merchantShift.closedAt))).for('update');if(!shift)fail(409,'SHIFT_REQUIRED')}
   const [o]=await tx.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,orderId),eq(s.merchantOrder.venueId,venueId))).for('update');if(!o)fail(404,'NOT_FOUND')
   if(o.status!=='AWAITING_PAYMENT'||o.source!=='COUNTER'||o.revision!==input.revision||o.quote||o.quoteHistory.length||o.paymentSnapshot||o.payment||o.pendingPaymentHash)fail(409,'ORDER_LOCKED')
   const [existing]=await tx.select().from(s.merchantDiscount).where(eq(s.merchantDiscount.orderId,orderId));if(existing)fail(409,'DISCOUNT_EXISTS')
   if(input.kind==='PERCENT'&&input.value>10000)fail(400,'INVALID_DISCOUNT')
   const amountMinor=input.kind==='FIXED'?input.value:Math.floor((o.totalMinor*input.value+5000)/10000)
   if(amountMinor<1||amountMinor>=o.totalMinor)fail(400,'INVALID_DISCOUNT')
   const [limit]=a.kind==='cashier'?await tx.select().from(s.merchantDiscountLimit).where(eq(s.merchantDiscountLimit.employeeId,a.employeeId)):[]
   const percentLimitMinor=limit?Math.floor((o.totalMinor*limit.maxBasisPoints+5000)/10000):0
   const allowed=a.kind==='owner'||!!a.permissions?.includes('discounts.apply')&&!!limit&&amountMinor<=limit.maxMinor&&amountMinor<=percentLimitMinor
   const [d]=await tx.insert(s.merchantDiscount).values({orderId,venueId,orderRevision:o.revision,kind:input.kind,value:input.value,amountMinor,reason:input.reason,requestedBy:taskActorKey(a),status:'PENDING'}).returning()
   const result=allowed?await apply(store,o,d,taskActorKey(a)):d
   await h.audit(store,a,venueId,'discount.request',input.reason,null,result);return result
  }))
 })
 app.post(base+'/orders/:orderId/discount/cancel',async req=>{
  const {a,venueId}=await context(req),orderId=uuid.parse((req.params as any).orderId),input=z.object({idempotencyKey:uuid}).strict().parse(req.body)
  return db.transaction(async tx=>replay(tx as unknown as Db,a,input.idempotencyKey,{action:'discount.cancel',venueId,orderId,...input},async()=>{
   const [o]=await tx.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,orderId),eq(s.merchantOrder.venueId,venueId))).for('update');if(!o)fail(404,'NOT_FOUND')
   const [d]=await tx.select().from(s.merchantDiscount).where(eq(s.merchantDiscount.orderId,orderId));if(!d||d.status!=='PENDING')fail(409,'DISCOUNT_EXISTS');if(a.kind!=='owner'&&d.requestedBy!==taskActorKey(a))fail(403,'FORBIDDEN')
   await tx.delete(s.merchantDiscount).where(eq(s.merchantDiscount.orderId,orderId));await h.audit(tx as unknown as Db,a,venueId,'discount.cancel',d.reason,d,null);return {cancelled:true}
  }))
 })
 app.post(base+'/orders/:orderId/discount/approve',async req=>{
  const {a,venueId}=await context(req);if(a.kind!=='owner')fail(403,'FORBIDDEN')
  const orderId=uuid.parse((req.params as any).orderId),input=z.object({idempotencyKey:uuid}).strict().parse(req.body)
  return db.transaction(async tx=>replay(tx as unknown as Db,a,input.idempotencyKey,{action:'discount.approve',venueId,orderId,...input},async()=>{
   const store=tx as unknown as Db,[o]=await tx.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,orderId),eq(s.merchantOrder.venueId,venueId))).for('update');if(!o)fail(404,'NOT_FOUND')
   const [d]=await tx.select().from(s.merchantDiscount).where(eq(s.merchantDiscount.orderId,orderId));if(!d)fail(404,'NOT_FOUND');if(d.requestedBy===taskActorKey(a))fail(403,'SELF_APPROVAL');if(d.status!=='PENDING')fail(409,'DISCOUNT_EXISTS')
   const result=await apply(store,o,d,taskActorKey(a));await h.audit(store,a,venueId,'discount.approve',d.reason,d,result);return result
  }))
 })
}
