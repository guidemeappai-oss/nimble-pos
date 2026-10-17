import {and,eq} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {InventoryLotMetadata,type InventoryLot} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {inventoryItem,inventoryRetry} from '../services/inventory';
import {itemLots,proposeLots} from '../services/inventoryLots';
import {type MerchantTaskHelpers} from './tasks';
import {loyaltyFail as fail} from '../services/loyalty';
const view=(l:typeof s.merchantInventoryLot.$inferSelect):InventoryLot=>({...l,expiresAt:l.expiresAt?.toISOString()??null,receivedAt:l.receivedAt?.toISOString()??null,createdAt:l.createdAt.toISOString(),expired:!!l.expiresAt&&l.expiresAt.getTime()<=Date.now()});
export async function inventoryLotRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/inventory/:itemId/lots';
 async function context(req:FastifyRequest,manage=false){const a=await h.actor(req),p=req.params as Record<string,string>,venueId=z.string().uuid().parse(p.venueId),itemId=z.string().uuid().parse(p.itemId);await h.venueFor(a,venueId);if(manage&&a.kind!=='owner'&&!a.permissions?.includes('inventory.manage'))fail(403,'FORBIDDEN');return {a,venueId,itemId}}
 app.get(base,async req=>{
  const {venueId,itemId}=await context(req),q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0),quantity:z.coerce.number().int().positive().max(2147483647).optional()}).parse(req.query);
  return db.transaction(async tx=>{const store=tx as unknown as Db,item=await inventoryItem(store,venueId,itemId,true),lots=await itemLots(store,item.id);return {items:lots.slice(q.page*100,(q.page+1)*100).map(view),hasMore:lots.length>(q.page+1)*100,page:q.page,suggested:q.quantity?await proposeLots(store,venueId,itemId,q.quantity):[],expiryPolicy:'ALERT_ONLY',physicalQuantity:item.quantity,requestedQuantity:q.quantity??null}});
 });
 app.patch(base+'/:lotId',async req=>{
  const {a,venueId,itemId}=await context(req,true),lotId=z.string().uuid().parse((req.params as any).lotId),input=InventoryLotMetadata.extend({reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict().parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;await inventoryItem(store,venueId,itemId,true);
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'lot.metadata',itemId,lotId,input},async()=>{
    const [old]=await tx.select().from(s.merchantInventoryLot).where(and(eq(s.merchantInventoryLot.id,lotId),eq(s.merchantInventoryLot.itemId,itemId),eq(s.merchantInventoryLot.venueId,venueId)));if(!old)fail(404,'LOT_NOT_FOUND');
    const [next]=await tx.update(s.merchantInventoryLot).set({label:input.label,expiresAt:input.expiresAt?new Date(input.expiresAt):null}).where(eq(s.merchantInventoryLot.id,lotId)).returning();
    await h.audit(store,a,venueId,'inventory.lot.metadata',input.reason,view(old),view(next));return view(next);
   });
  });
 });
}
