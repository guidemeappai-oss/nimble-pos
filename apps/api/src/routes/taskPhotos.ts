import { createHash } from 'node:crypto'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import * as s from '../db/schema'
import type { Db } from '../db/client'
import { loyaltyFail as fail } from '../services/loyalty'
import { configuredTaskPhotoStorage } from '../services/taskPhotos'
import { TASK_PHOTO_MAX_BYTES, TASK_PHOTO_RETENTION_MS } from '../services/taskPhotoStorage'
import { taskActorKey, taskManage, type MerchantTaskHelpers } from './tasks'
const params=(r:FastifyRequest)=>r.params as Record<string,string>,uuid=z.string().uuid()
const view=(p:typeof s.merchantTaskPhoto.$inferSelect)=>({id:p.id,phase:p.phase,source:p.source,submissionNumber:p.submissionNumber,createdAt:p.createdAt.toISOString(),expiresAt:p.expiresAt.toISOString()})
export async function taskPhotoRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,storage=configuredTaskPhotoStorage(),base='/v1/merchant/venues/:venueId/tasks/:taskId/photos'
 async function context(req:FastifyRequest,store:Db=db){
  const a=await h.actor(req),venueId=uuid.parse(params(req).venueId),taskId=uuid.parse(params(req).taskId)
  await h.venueFor(a,venueId,false,store)
  const [task]=await store.select().from(s.merchantTask).where(and(eq(s.merchantTask.id,taskId),eq(s.merchantTask.venueId,venueId))).for('update')
  if(!task)fail(404,'NOT_FOUND')
  const own=task.completedBy===taskActorKey(a)
  const review=taskManage(a)&&(a.kind==='owner'||!!a.permissions?.includes('photos.view'))
  if(!own&&!review)fail(403,'FORBIDDEN')
  return {a,venueId,task,own}
 }
 app.get(base,async req=>{const {task}=await context(req);const photos=await db.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.taskId,task.id),gt(s.merchantTaskPhoto.expiresAt,new Date()))).orderBy(asc(s.merchantTaskPhoto.createdAt));return photos.map(view)})
 app.post(base,{bodyLimit:Math.ceil(TASK_PHOTO_MAX_BYTES*4/3)+4096},async(req,reply)=>{
  // Authenticate before decoding or processing the image; context is checked again under lock.
  await context(req)
  const input=z.object({idempotencyKey:uuid,phase:z.enum(['BEFORE','AFTER']),source:z.enum(['CAMERA','IMPORT']),base64:z.string().max(Math.ceil(TASK_PHOTO_MAX_BYTES*4/3)).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).parse(req.body)
  const bytes=Buffer.from(input.base64,'base64'),hash=createHash('sha256').update(bytes).update(input.phase).update(input.source).digest('hex')
  if(bytes.length>TASK_PHOTO_MAX_BYTES)fail(413,'PHOTO_TOO_LARGE')
  let newKey:string|null=null
  try{
   const result=await db.transaction(async tx=>{
    const {a,venueId,task,own}=await context(req,tx as unknown as Db)
    const [old]=await tx.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.taskId,task.id),eq(s.merchantTaskPhoto.idempotencyKey,input.idempotencyKey)))
    if(old){if(old.author!==taskActorKey(a)||old.requestHash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');if(old.expiresAt.getTime()<=Date.now())fail(410,'PHOTO_EXPIRED');return view(old)}
    if(!own)fail(403,'FORBIDDEN')
    if(!['IN_PROGRESS','CHANGES_REQUESTED'].includes(task.status))fail(409,'TASK_NOT_EDITABLE')
    const current=await tx.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.taskId,task.id),eq(s.merchantTaskPhoto.submissionNumber,task.submissionNumber+1),gt(s.merchantTaskPhoto.expiresAt,new Date())))
    if(current.length>=4)fail(409,'PHOTO_LIMIT')
    const saved=await storage.save(bytes);newKey=saved.key
    const [photo]=await tx.insert(s.merchantTaskPhoto).values({taskId:task.id,venueId,author:taskActorKey(a),submissionNumber:task.submissionNumber+1,idempotencyKey:input.idempotencyKey,requestHash:hash,phase:input.phase,source:input.source,storageKey:saved.key,bytes:saved.bytes,expiresAt:new Date(Date.now()+TASK_PHOTO_RETENTION_MS)}).returning()
    await h.audit(tx as unknown as Db,a,venueId,'task.photo.added','Task evidence uploaded',null,view(photo));return view(photo)
   });reply.code(201);return result
  }catch(error){if(newKey)await storage.remove(newKey);throw error}
 })
 app.get(`${base}/:photoId`,async(req,reply)=>{
  const {task}=await context(req),[photo]=await db.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.id,uuid.parse(params(req).photoId)),eq(s.merchantTaskPhoto.taskId,task.id)))
  if(!photo||photo.expiresAt.getTime()<=Date.now())fail(404,'PHOTO_NOT_FOUND')
  const thumbnail=(req.query as Record<string,string>).thumbnail==='1'
  try{return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type('image/jpeg').send(await storage.read(photo.storageKey,thumbnail))}catch{fail(404,'PHOTO_NOT_FOUND')}
 })
 app.post(`${base}/:photoId/retention`,async req=>{
  const {days,reason}=z.object({days:z.number().int().min(31).max(90),reason:z.string().trim().min(1).max(1000)}).parse(req.body)
  return db.transaction(async tx=>{
   const {a,venueId,task}=await context(req,tx as unknown as Db)
   if(!taskManage(a)||(a.kind==='cashier'&&!a.permissions?.includes('photos.view')))fail(403,'FORBIDDEN')
   const [photo]=await tx.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.id,uuid.parse(params(req).photoId)),eq(s.merchantTaskPhoto.taskId,task.id))).for('update')
   if(!photo||photo.expiresAt.getTime()<=Date.now())fail(404,'PHOTO_NOT_FOUND')
   if(!['SUBMITTED','CHANGES_REQUESTED'].includes(task.status))fail(409,'TASK_NOT_OPEN')
   const expiresAt=new Date(photo.createdAt.getTime()+days*86400000)
   if(expiresAt<photo.expiresAt)fail(409,'RETENTION_CANNOT_SHRINK')
   const [next]=await tx.update(s.merchantTaskPhoto).set({expiresAt}).where(eq(s.merchantTaskPhoto.id,photo.id)).returning()
   await h.audit(tx as unknown as Db,a,venueId,'task.photo.retention.extended',reason,view(photo),view(next));return view(next)
  })
 })
 app.post(`${base}/:photoId/remove`,async req=>{
  let key:string|null=null
  const result=await db.transaction(async tx=>{
   const {a,venueId,task,own}=await context(req,tx as unknown as Db)
   if(!own)fail(403,'FORBIDDEN')
   const [photo]=await tx.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.id,uuid.parse(params(req).photoId)),eq(s.merchantTaskPhoto.taskId,task.id)))
   if(!photo) return {ok:true}
   if(!['IN_PROGRESS','CHANGES_REQUESTED'].includes(task.status)||photo.submissionNumber!==task.submissionNumber+1)fail(409,'PHOTO_ALREADY_SUBMITTED')
   key=photo.storageKey;await tx.delete(s.merchantTaskPhoto).where(eq(s.merchantTaskPhoto.id,photo.id));await h.audit(tx as unknown as Db,a,venueId,'task.photo.removed','Unsubmitted task evidence removed',view(photo),null);return {ok:true}
  });if(key)await storage.remove(key);return result
 })
}
