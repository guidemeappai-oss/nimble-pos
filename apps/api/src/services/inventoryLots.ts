import {and,asc,eq,sql} from 'drizzle-orm';
import type {Db} from '../db/client';
import type {LotDelta,LotQuantity} from '@nimble/shared';
import * as s from '../db/schema';
import {loyaltyFail as fail} from './loyalty';
export type LotMutation={reconcile?:boolean;deltas?:LotDelta[];incoming?:{label?:string;expiresAt?:string|null;source?:string;sourceId?:string|null};ignoreLossId?:string};
/** Caller owns the inventory item lock. Expiry only alerts; no quantity is silently removed. */
export async function itemLots(db:Db,itemId:string){return db.select().from(s.merchantInventoryLot).where(eq(s.merchantInventoryLot.itemId,itemId)).orderBy(sql`${s.merchantInventoryLot.expiresAt} ASC NULLS LAST`,sql`${s.merchantInventoryLot.receivedAt} ASC NULLS LAST`,asc(s.merchantInventoryLot.id))}
async function pendingLotHolds(db:Db,venueId:string,itemId:string,ignoreLossId?:string){
 const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'LOSS'),sql`${s.merchantStockOperation.data}->>'status'='PENDING' AND ${s.merchantStockOperation.data}->>'itemId'=${itemId}`));
 const held=new Map<string,number>();
 for(const row of rows){if(row.id===ignoreLossId)continue;const loss=row.data as {lotAllocations?:LotQuantity[]};for(const l of loss.lotAllocations??[])held.set(l.lotId,(held.get(l.lotId)??0)+l.quantity)}
 return held;
}
export async function proposeLots(db:Db,venueId:string,itemId:string,quantity:number,ignoreLossId?:string,lotId?:string):Promise<LotQuantity[]>{
 const lots=await itemLots(db,itemId),holds=await pendingLotHolds(db,venueId,itemId,ignoreLossId),result:LotQuantity[]=[];let remaining=quantity;
 for(const lot of lots){if(lotId&&lot.id!==lotId)continue;const take=Math.min(remaining,Math.max(0,lot.quantity-(holds.get(lot.id)??0)));if(take){result.push({lotId:lot.id,quantity:take,label:lot.label,expiresAt:lot.expiresAt?.toISOString()??null});remaining-=take}if(!remaining)break}
 if(remaining)fail(409,'LOT_STOCK_UNAVAILABLE');return result;
}
export async function moveLots(db:Db,item:typeof s.merchantInventoryItem.$inferSelect,delta:number,kind:string,mutation:LotMutation={}):Promise<LotDelta[]>{
 const lots=await itemLots(db,item.id);
 if(lots.reduce((n,l)=>n+l.quantity,0)!==item.quantity)fail(409,'LOT_BALANCE_MISMATCH');
 if(mutation.deltas){
  if(new Set(mutation.deltas.map(l=>l.lotId)).size!==mutation.deltas.length||mutation.deltas.reduce((n,l)=>n+l.delta,0)!==delta||mutation.deltas.some(l=>!Number.isInteger(l.delta)||(!mutation.reconcile&&Math.sign(l.delta)!==Math.sign(delta))))fail(400,'INVALID_LOT_ALLOCATION');
  const holds=await pendingLotHolds(db,item.venueId,item.id,mutation.ignoreLossId);
  for(const change of mutation.deltas){const lot=lots.find(l=>l.id===change.lotId);if(!lot)return fail(404,'LOT_NOT_FOUND');const next=lot.quantity+change.delta;if(next<0||next>2147483647||change.delta<0&&next<(holds.get(lot.id)??0))fail(409,'LOT_STOCK_UNAVAILABLE');await db.update(s.merchantInventoryLot).set({quantity:next}).where(eq(s.merchantInventoryLot.id,lot.id))}
  return mutation.deltas.map(c=>{const lot=lots.find(l=>l.id===c.lotId)!;return {...c,label:lot.label,expiresAt:lot.expiresAt?.toISOString()??null}});
 }
 if(!delta)return [];
 if(delta>0){
  const [lot]=await db.insert(s.merchantInventoryLot).values({venueId:item.venueId,itemId:item.id,quantity:delta,label:mutation.incoming?.label??'',expiresAt:mutation.incoming?.expiresAt?new Date(mutation.incoming.expiresAt):null,receivedAt:new Date(),source:mutation.incoming?.source??kind,sourceId:mutation.incoming?.sourceId??null}).returning();
  return [{lotId:lot.id,delta,label:lot.label,expiresAt:lot.expiresAt?.toISOString()??null}];
 }
 const allocations=await proposeLots(db,item.venueId,item.id,-delta,mutation.ignoreLossId);
 const changes=allocations.map(({quantity,...l})=>({...l,delta:-quantity}));
 for(const c of changes){const lot=lots.find(l=>l.id===c.lotId)!;await db.update(s.merchantInventoryLot).set({quantity:lot.quantity+c.delta}).where(eq(s.merchantInventoryLot.id,c.lotId))}
 return changes;
}
