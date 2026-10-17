import { and, eq, gt } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { loyaltyFail } from './loyalty'
import { createTaskPhotoStorage } from './taskPhotoStorage'
export const configuredTaskPhotoStorage=()=>createTaskPhotoStorage(process.env.TASK_PHOTO_DIR??'.private/task-photos')
// Called within the locked task transaction. A failed upload is never evidence.
export async function ensureTaskEvidence(db:Db,task:typeof s.merchantTask.$inferSelect){
 const required=task.snapshot.requiredPhotos
 const photos=await db.select().from(s.merchantTaskPhoto).where(and(eq(s.merchantTaskPhoto.taskId,task.id),eq(s.merchantTaskPhoto.submissionNumber,task.status==='SUBMITTED'?task.submissionNumber:task.submissionNumber+1),gt(s.merchantTaskPhoto.expiresAt,new Date())))
 if(['BEFORE','BOTH'].includes(required)&&!photos.some(p=>p.phase==='BEFORE'))loyaltyFail(409,'TASK_BEFORE_PHOTO_REQUIRED')
 if(['AFTER','BOTH'].includes(required)&&!photos.some(p=>p.phase==='AFTER'))loyaltyFail(409,'TASK_AFTER_PHOTO_REQUIRED')
}
export async function cleanTaskPhotos(db:Db){
 const storage=configuredTaskPhotoStorage()
 const photos=await db.select().from(s.merchantTaskPhoto)
 const active=new Set<string>()
 for(const photo of photos){
  const retained=await db.transaction(async tx=>{
   const [current]=await tx.select().from(s.merchantTaskPhoto).where(eq(s.merchantTaskPhoto.id,photo.id)).for('update')
   if(!current)return false
   if(current.expiresAt.getTime()>Date.now())return true
   await storage.remove(current.storageKey)
   await tx.delete(s.merchantTaskPhoto).where(eq(s.merchantTaskPhoto.id,current.id))
   return false
  })
  if(retained)active.add(photo.storageKey)
 }
 await storage.cleanOrphans(active)
}
