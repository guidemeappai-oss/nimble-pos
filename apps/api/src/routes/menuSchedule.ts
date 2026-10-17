import { createHash } from 'node:crypto'
import { and,eq } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance,FastifyRequest } from 'fastify'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { defaultMenuSchedule,MenuScheduleConfig } from '../services/menuSchedule'
import type { MerchantActor,MerchantTaskHelpers } from './tasks'
type Helpers={ permittedVenue:(req:FastifyRequest,permission:'menu.manage')=>Promise<typeof s.merchantVenue.$inferSelect>;actor:(req:FastifyRequest)=>Promise<MerchantActor>;fail:(status:number,code:string)=>never;audit:MerchantTaskHelpers['audit'] }
const command=z.object({timezone:z.string(),rules:z.array(z.unknown()),revision:z.number().int().nonnegative(),idempotencyKey:z.string().uuid(),reason:z.string().trim().min(1).max(500)}).strict().transform(v=>({...v,...MenuScheduleConfig.parse({timezone:v.timezone,rules:v.rules})}))
export async function menuScheduleRoutes(app:FastifyInstance,h:Helpers) {
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/menu/schedule'
 app.get(base,async req=>{
  const v=await h.permittedVenue(req,'menu.manage')
  const [row]=await db.select().from(s.merchantMenuSchedule).where(eq(s.merchantMenuSchedule.venueId,v.id))
  return row?{...row.config,revision:row.revision}:{...defaultMenuSchedule,revision:0}
 })
 app.put(base,async req=>{
  const v=await h.permittedVenue(req,'menu.manage'),a=await h.actor(req),input=command.parse(req.body)
  const actor=a.kind==='owner'?`owner:${a.userId}`:`cashier:${a.employeeId}`
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return db.transaction(async raw=>{
   const tx=raw as unknown as Db
   await tx.select().from(s.merchantVenue).where(eq(s.merchantVenue.id,v.id)).for('update')
   const [prior]=await tx.select().from(s.merchantMenuScheduleRequest).where(and(eq(s.merchantMenuScheduleRequest.venueId,v.id),eq(s.merchantMenuScheduleRequest.actor,actor),eq(s.merchantMenuScheduleRequest.key,input.idempotencyKey)))
   if(prior){if(prior.requestHash!==hash)h.fail(409,'IDEMPOTENCY_CONFLICT');return prior.response}
   const [state]=await tx.select().from(s.merchantMenuSchedule).where(eq(s.merchantMenuSchedule.venueId,v.id))
   if((state?.revision??0)!==input.revision)h.fail(409,'MENU_SCHEDULE_CONFLICT')
   const products=await tx.select().from(s.merchantProduct).where(eq(s.merchantProduct.venueId,v.id))
   for(const rule of input.rules){
    const p=products.find(p=>p.id===rule.productId)?.catalog
    if(!p||(rule.kind==='variant'&&!p.variants.some(v=>v.id===rule.optionId))||(rule.kind==='extra'&&!p.extras.some(e=>e.id===rule.optionId)))h.fail(400,'INVALID_SCHEDULE_TARGET')
   }
   const config={timezone:input.timezone,rules:input.rules},response={...config,revision:input.revision+1}
   await tx.insert(s.merchantMenuSchedule).values({venueId:v.id,config,revision:response.revision}).onConflictDoUpdate({target:s.merchantMenuSchedule.venueId,set:{config,revision:response.revision}})
   await h.audit(tx,a,v.id,'menu.schedule.changed',input.reason,state?.config??null,config)
   await tx.insert(s.merchantMenuScheduleRequest).values({venueId:v.id,actor,key:input.idempotencyKey,requestHash:hash,response})
   return response
  })
 })
}
