import {loyaltyRefundRequested} from '../services/loyalty'
import {and,eq,inArray,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {aggregateMerchantStockRequirements} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {effectiveCatalog} from '../services/menuSchedule';
import {stockMenuProjection} from '../services/stockMenu';
import {inventoryRetry} from '../services/inventory';
import {releaseOrderStock} from '../services/stockReservations';
import {type MerchantTaskHelpers} from './tasks';
import {loyaltyFail as fail} from '../services/loyalty';
export async function stockMenuRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/inventory/availability-impact';
 async function context(req:FastifyRequest){const a=await h.actor(req),venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);if(a.kind!=='owner'&&!a.permissions?.includes('inventory.manage'))fail(403,'FORBIDDEN');return {a,venueId}}
 const blocked=async(store:Db,venueId:string)=>store.select({id:s.merchantInventoryItem.id,name:s.merchantInventoryItem.name,available:s.merchantInventoryItem.available}).from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId,venueId),eq(s.merchantInventoryItem.available,false)));
 app.get(base,async req=>{
  const {venueId}=await context(req);
  const products=await db.select().from(s.merchantProduct).where(eq(s.merchantProduct.venueId,venueId));
  const scheduled=await effectiveCatalog(db,venueId,products.map(p=>p.catalog),new Date(),true);
  const {impact}=await stockMenuProjection(db,venueId,scheduled),resources=await db.select({id:s.merchantInventoryItem.id,name:s.merchantInventoryItem.name,available:s.merchantInventoryItem.available}).from(s.merchantInventoryItem).where(eq(s.merchantInventoryItem.venueId,venueId)),ids=new Set(resources.filter(r=>!r.available).map(r=>r.id));
  const open=await db.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.venueId,venueId),inArray(s.merchantOrder.status,['PREPARING','READY'])));
  const orders=open.flatMap(o=>{const blockedItemIds=aggregateMerchantStockRequirements(o.paymentSnapshot?.lines??o.lines).filter(b=>ids.has(b.itemId)).map(b=>b.itemId);return blockedItemIds.length?[{id:o.id,number:o.number,status:o.status,blockedItemIds}]:[]});
  return {options:impact,orders,resources};
 });
 app.post(base+'/orders/:id/refund',async req=>{
  const {a,venueId}=await context(req);if(a.kind!=='owner')fail(403,'OWNER_REQUIRED');
  const id=z.string().uuid().parse((req.params as any).id),input=z.object({reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict().parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'stock.fulfillment.refund',id,input},async()=>{
    const [order]=await tx.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,id),eq(s.merchantOrder.venueId,venueId))).for('update');if(!order)fail(404,'NOT_FOUND');
    const [existing]=await tx.select().from(s.merchantRefund).where(eq(s.merchantRefund.orderId,id));
    if(existing)return {orderId:id,status:order.status,refundId:existing.id};
    if(!order.payment||!['PREPARING','READY'].includes(order.status))fail(409,'INVALID_STATE');
    const ids=new Set((await blocked(store,venueId)).map(r=>r.id));
    if(!aggregateMerchantStockRequirements(order.paymentSnapshot?.lines??order.lines).some(b=>ids.has(b.itemId)))fail(409,'NO_STOCK_FULFILLMENT_ISSUE');
    const [refund]=await tx.insert(s.merchantRefund).values({orderId:id,reason:input.reason}).returning();
    await releaseOrderStock(store,id);
    await tx.update(s.merchantOrder).set({status:'REFUND_PENDING',paymentRequiresRefund:true,cancelledAt:new Date()}).where(eq(s.merchantOrder.id,id));
    await loyaltyRefundRequested(store,id);
    const result={orderId:id,status:'REFUND_PENDING',refundId:refund.id};
    await h.audit(store,a,venueId,'stock.fulfillment.refund.requested',input.reason,null,result);return result;
   });
  });
 });
}
