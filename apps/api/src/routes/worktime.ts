import { createHash } from 'node:crypto'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { WorkTimeRecord, WorkTimeCorrection } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { taskActorKey, type MerchantActor, type MerchantTaskHelpers } from './tasks'
import { loyaltyFail as fail } from '../services/loyalty'
const uuid=z.string().uuid(),iso=z.string().datetime({offset:true}),reason=z.string().trim().min(3).max(1000)
const recordView=(r:typeof s.merchantWorkTime.$inferSelect):WorkTimeRecord=>({...r,startedAt:r.startedAt.toISOString(),endedAt:r.endedAt?.toISOString()??null})
const correctionView=(c:typeof s.merchantWorkCorrection.$inferSelect):WorkTimeCorrection=>({...c,createdAt:c.createdAt.toISOString(),reviewedAt:c.reviewedAt?.toISOString()??null})
const correctionInput=z.object({idempotencyKey:uuid,revision:z.number().int().positive(),startedAt:iso,endedAt:iso,breaks:z.array(z.object({startedAt:iso,endedAt:iso}).strict()).max(100),reason}).strict()
export async function workTimeRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/worktime'
 const manager=(a:MerchantActor)=>a.kind==='owner'||!!a.permissions?.includes('time.manage')
 async function context(req:FastifyRequest){const a=await h.actor(req),venueId=uuid.parse((req.params as any).venueId);await h.venueFor(a,venueId);return {a,venueId}}
 async function replay<T>(store:Db,a:MerchantActor,key:string,payload:unknown,run:()=>Promise<T>){
  const actor=taskActorKey(a),hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  await store.execute(sql`select pg_advisory_xact_lock(hashtext(${actor+key}))`)
  const [old]=await store.select().from(s.merchantTaskRequest).where(and(eq(s.merchantTaskRequest.actor,actor),eq(s.merchantTaskRequest.key,key)))
  if(old){if(old.requestHash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');return old.response}
  const response=await run();await store.insert(s.merchantTaskRequest).values({actor,key,requestHash:hash,response});return response
 }
 async function employeeLock(store:Db,employeeId:string){await store.select({id:s.merchantEmployee.id}).from(s.merchantEmployee).where(eq(s.merchantEmployee.id,employeeId)).for('update')}
 app.get(base,async req=>{
  const {a,venueId}=await context(req),q=z.object({before:iso.optional()}).parse(req.query)
  const condition=and(eq(s.merchantWorkTime.venueId,venueId),a.kind==='cashier'&&!manager(a)?eq(s.merchantWorkTime.employeeId,a.employeeId):undefined,q.before?sql`${s.merchantWorkTime.startedAt}<${new Date(q.before).toISOString()}`:undefined)
  const rows=await db.select().from(s.merchantWorkTime).where(condition).orderBy(desc(s.merchantWorkTime.startedAt)).limit(101)
  const corrections=await db.select().from(s.merchantWorkCorrection).where(and(eq(s.merchantWorkCorrection.venueId,venueId),a.kind==='cashier'&&!manager(a)?eq(s.merchantWorkCorrection.employeeId,a.employeeId):undefined)).orderBy(desc(s.merchantWorkCorrection.createdAt)).limit(100)
  return {items:rows.slice(0,100).map(recordView),hasMore:rows.length>100,corrections:corrections.map(correctionView)}
 })
 for(const action of ['start','pause','resume','finish'] as const)app.post(`${base}/${action}`,async req=>{
  const {a,venueId}=await context(req),input=z.object({idempotencyKey:uuid}).strict().parse(req.body)
  if(a.kind!=='cashier')return fail(403,'EMPLOYEE_REQUIRED')
  const employeeId=a.employeeId
  return db.transaction(async raw=>{const tx=raw as unknown as Db;return replay(tx,a,input.idempotencyKey,{action,venueId,...input},async()=>{
   await employeeLock(tx,employeeId)
   const [current]=await tx.select().from(s.merchantWorkTime).where(and(eq(s.merchantWorkTime.employeeId,employeeId),isNull(s.merchantWorkTime.endedAt))).for('update')
   const now=new Date(),stamp=now.toISOString()
   let next:typeof s.merchantWorkTime.$inferSelect
   if(action==='start'){
    if(current)fail(409,'WORK_ALREADY_STARTED')
    const [overlap]=await tx.select({id:s.merchantWorkTime.id}).from(s.merchantWorkTime).where(and(eq(s.merchantWorkTime.employeeId,employeeId),sql`${s.merchantWorkTime.endedAt}>${stamp}`)).limit(1)
    if(overlap)fail(409,'WORK_TIME_OVERLAP')
    ;[next]=await tx.insert(s.merchantWorkTime).values({venueId,employeeId,startedAt:now,status:'WORKING',breaks:[]}).returning()
   }else{
    if(!current||current.venueId!==venueId)fail(409,'WORK_NOT_STARTED')
    if(action==='pause'&&current.status!=='WORKING'||action==='resume'&&current.status!=='PAUSED')fail(409,'INVALID_WORK_TRANSITION')
    const breaks=current.breaks.map(b=>({...b}))
    if(action==='pause')breaks.push({startedAt:stamp,endedAt:null})
    if((action==='resume'||action==='finish')&&current.status==='PAUSED')breaks[breaks.length-1].endedAt=stamp
    ;[next]=await tx.update(s.merchantWorkTime).set({status:action==='finish'?'FINISHED':action==='pause'?'PAUSED':'WORKING',endedAt:action==='finish'?now:null,breaks,revision:current.revision+1}).where(eq(s.merchantWorkTime.id,current.id)).returning()
   }
   const response=recordView(next);await h.audit(tx,a,venueId,'worktime.'+action,'Employee work time event',current?recordView(current):null,response);return response
  })})
 })
 app.post(`${base}/:recordId/corrections`,async req=>{
  const {a,venueId}=await context(req),recordId=uuid.parse((req.params as any).recordId),input=correctionInput.parse(req.body)
  if(a.kind!=='cashier')return fail(403,'EMPLOYEE_REQUIRED')
  const employeeId=a.employeeId
  const start=Date.parse(input.startedAt),end=Date.parse(input.endedAt)
  if(start>=end||end>Date.now())fail(400,'INVALID_WORK_RANGE')
  let previousEnd=start
  for(const b of input.breaks){const from=Date.parse(b.startedAt),to=Date.parse(b.endedAt);if(from<previousEnd||from>=to||to>end)fail(400,'INVALID_WORK_BREAK');previousEnd=to}
  return db.transaction(async raw=>{const tx=raw as unknown as Db;return replay(tx,a,input.idempotencyKey,{action:'correction',venueId,recordId,...input},async()=>{
   await employeeLock(tx,employeeId)
   const [record]=await tx.select().from(s.merchantWorkTime).where(and(eq(s.merchantWorkTime.id,recordId),eq(s.merchantWorkTime.venueId,venueId),eq(s.merchantWorkTime.employeeId,employeeId))).for('update')
   if(!record)fail(404,'NOT_FOUND');if(record.status!=='FINISHED'||record.revision!==input.revision)fail(409,'WORK_REVISION_CONFLICT')
   const [pending]=await tx.select({id:s.merchantWorkCorrection.id}).from(s.merchantWorkCorrection).where(and(eq(s.merchantWorkCorrection.recordId,recordId),eq(s.merchantWorkCorrection.status,'PENDING'))).limit(1)
   if(pending)fail(409,'CORRECTION_PENDING')
   const [created]=await tx.insert(s.merchantWorkCorrection).values({recordId,venueId,employeeId,reason:input.reason,previous:recordView(record),proposed:{startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),breaks:input.breaks.map(b=>({startedAt:new Date(b.startedAt).toISOString(),endedAt:new Date(b.endedAt).toISOString()}))}}).returning()
   await h.audit(tx,a,venueId,'worktime.correction.requested',input.reason,recordView(record),correctionView(created));return correctionView(created)
  })})
 })
 app.post(`${base}/corrections/:correctionId/decision`,async req=>{
  const {a,venueId}=await context(req),correctionId=uuid.parse((req.params as any).correctionId),input=z.object({idempotencyKey:uuid,decision:z.enum(['APPROVE','REJECT']),reason}).strict().parse(req.body)
  if(!manager(a))fail(403,'FORBIDDEN')
  return db.transaction(async raw=>{const tx=raw as unknown as Db;return replay(tx,a,input.idempotencyKey,{action:'correction.decision',venueId,correctionId,...input},async()=>{
   const [found]=await tx.select().from(s.merchantWorkCorrection).where(and(eq(s.merchantWorkCorrection.id,correctionId),eq(s.merchantWorkCorrection.venueId,venueId)))
   if(!found)fail(404,'NOT_FOUND');if(a.kind==='cashier'&&a.employeeId===found.employeeId)fail(403,'SELF_APPROVAL')
   await employeeLock(tx,found.employeeId)
   const [correction]=await tx.select().from(s.merchantWorkCorrection).where(eq(s.merchantWorkCorrection.id,found.id)).for('update')
   if(correction.status!=='PENDING')fail(409,'CORRECTION_ALREADY_DECIDED')
   const [record]=await tx.select().from(s.merchantWorkTime).where(eq(s.merchantWorkTime.id,correction.recordId)).for('update')
   if(input.decision==='APPROVE'){
    if(record.revision!==correction.previous.revision||record.status!=='FINISHED')fail(409,'WORK_REVISION_CONFLICT')
    const proposed=correction.proposed,start=new Date(proposed.startedAt),end=new Date(proposed.endedAt)
    const [overlap]=await tx.select({id:s.merchantWorkTime.id}).from(s.merchantWorkTime).where(and(eq(s.merchantWorkTime.employeeId,record.employeeId),ne(s.merchantWorkTime.id,record.id),sql`${s.merchantWorkTime.startedAt}<${end.toISOString()} AND (${s.merchantWorkTime.endedAt} IS NULL OR ${s.merchantWorkTime.endedAt}>${start.toISOString()})`)).limit(1)
    if(overlap)fail(409,'WORK_TIME_OVERLAP')
    await tx.update(s.merchantWorkTime).set({startedAt:start,endedAt:end,breaks:proposed.breaks,revision:record.revision+1}).where(eq(s.merchantWorkTime.id,record.id))
   }
   const [updated]=await tx.update(s.merchantWorkCorrection).set({status:input.decision==='APPROVE'?'APPROVED':'REJECTED',reviewedAt:new Date(),reviewReason:input.reason,reviewer:taskActorKey(a)}).where(eq(s.merchantWorkCorrection.id,correction.id)).returning()
   await h.audit(tx,a,venueId,'worktime.correction.'+input.decision.toLowerCase(),input.reason,correctionView(correction),correctionView(updated));return correctionView(updated)
  })})
 })
}
