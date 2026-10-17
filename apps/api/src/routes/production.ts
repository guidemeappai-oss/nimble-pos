import {randomUUID} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {ProductionInput,type ProductionBatch} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {inventoryItem,inventoryMove,inventoryRetry} from '../services/inventory';
import {inventoryCosts,calculateRecipeCost} from '../services/inventoryCost';
import {recipeVersions} from '../services/recipes';
import {taskActorKey,type MerchantTaskHelpers} from './tasks';
import {loyaltyFail as fail} from '../services/loyalty';
export async function productionRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/production';
 async function context(req:FastifyRequest){const a=await h.actor(req),venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);if(a.kind!=='owner'&&!a.permissions?.includes('inventory.manage'))fail(403,'FORBIDDEN');return {a,venueId}}
 const publicView=(r:ProductionBatch)=>({...r,unitCosts:[],outputCost:null,recipe:{...r.recipe,costMinor:null,unitCosts:[]}});
 app.get(base,async req=>{const {a,venueId}=await context(req),q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION'))).orderBy(desc(s.merchantStockOperation.createdAt),desc(s.merchantStockOperation.id)).limit(51).offset(q.page*50);return {items:rows.slice(0,50).map(r=>a.kind==='owner'||a.permissions?.includes('inventory.costs')?r.data:publicView(r.data as ProductionBatch)),hasMore:rows.length>50}});
 app.post(base,async req=>{
  const {a,venueId}=await context(req),input=ProductionInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   const result=await inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.create',input},async()=>{
    const recipe=(await recipeVersions(store,venueId,[input.recipeVersionId])).get(input.recipeVersionId)!;
    const requirements=recipe.requirements.map(b=>({itemId:b.itemId,quantity:b.quantity*input.batches}));
    const expectedYield=input.expectedYieldPerBatch*input.batches;
    if(expectedYield>2147483647||input.actualYield>expectedYield||requirements.some(b=>b.quantity>2147483647))fail(400,'INVALID_PRODUCTION_YIELD');
    if(requirements.some(b=>b.itemId===input.outputItemId))fail(400,'PRODUCTION_CYCLE');
    const history=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION')));
    const graph=new Map<string,Set<string>>();
    for(const row of history){const batch=row.data as ProductionBatch;const deps=graph.get(batch.outputItemId)??new Set<string>();for(const r of batch.requirements)deps.add(r.itemId);graph.set(batch.outputItemId,deps)}
    const reaches=(id:string,seen=new Set<string>()):boolean=>{if(id===input.outputItemId)return true;if(seen.has(id))return false;seen.add(id);return [...graph.get(id)??[]].some(next=>reaches(next,seen))};
    if(requirements.some(r=>reaches(r.itemId)))fail(400,'PRODUCTION_CYCLE');
    // Match checkout lock ordering even when output sorts before the ingredients.
    for(const id of [...new Set([input.outputItemId,...requirements.map(r=>r.itemId)])].sort())await inventoryItem(store,venueId,id,true);
    const costs=await inventoryCosts(store,venueId),valuation=calculateRecipeCost(costs,requirements);
    const perBatch=calculateRecipeCost(costs,recipe.requirements);
    const outputCost=input.actualYield&&valuation.exactCost?{numerator:valuation.exactCost.numerator,denominator:(BigInt(valuation.exactCost.denominator)*BigInt(input.actualYield)).toString()}:null;
    const batchId=randomUUID(),inputLotDeltas:NonNullable<ProductionBatch['inputLotDeltas']>=[];
    for(const r of requirements){const {movement}=await inventoryMove(store,a,venueId,r.itemId,-r.quantity,'PRODUCTION',input.reason);inputLotDeltas.push({itemId:r.itemId,deltas:movement.lotAllocations})}
    const outputLotDeltas=input.actualYield?(await inventoryMove(store,a,venueId,input.outputItemId,input.actualYield,'PRODUCTION',input.reason,null,0,outputCost,{incoming:{...input.lot,source:'PRODUCTION',sourceId:batchId}})).movement.lotAllocations:[];
    const value:ProductionBatch={inputLotDeltas,outputLotDeltas,id:batchId,venueId,status:'PRODUCED',recipe:{id:recipe.id,recipeId:recipe.recipeId,version:recipe.version,name:recipe.name,requirements:recipe.requirements,costMethod:'WEIGHTED_AVERAGE',costMinor:perBatch.costMinor,unitCosts:perBatch.unitCosts},batches:input.batches,outputItemId:input.outputItemId,expectedYield,actualYield:input.actualYield,waste:expectedYield-input.actualYield,requirements,unitCosts:requirements.map(r=>costs.get(r.itemId)??{itemId:r.itemId,numerator:null,denominator:'1'}),outputCost,reason:input.reason,createdAt:new Date().toISOString(),createdBy:taskActorKey(a),reversedAt:null,reversedBy:null,reversalReason:null};
    await tx.insert(s.merchantStockOperation).values({id:value.id,venueId,kind:'PRODUCTION',data:value});
    await h.audit(store,a,venueId,'production.created',input.reason,null,publicView(value));return value;
   });
   return a.kind==='owner'||a.permissions?.includes('inventory.costs')?result:publicView(result);
  });
 });
 app.post(base+'/:id/reverse',async req=>{
  const {a,venueId}=await context(req);if(a.kind!=='owner')fail(403,'OWNER_REQUIRED');
  const id=z.string().uuid().parse((req.params as any).id),input=z.object({reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict().parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.reverse',id,input},async()=>{
    const [row]=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION'))).for('update');if(!row)fail(404,'NOT_FOUND');const value=row.data as ProductionBatch;
    if(value.status!=='PRODUCED')fail(409,'PRODUCTION_ALREADY_REVERSED');
    for(const itemId of [...new Set([value.outputItemId,...value.requirements.map(r=>r.itemId)])].sort())await inventoryItem(store,venueId,itemId,true);
    if(!value.inputLotDeltas||!value.outputLotDeltas)fail(409,'LOT_PROVENANCE_UNKNOWN');
    if(value.actualYield)await inventoryMove(store,a,venueId,value.outputItemId,-value.actualYield,'PRODUCTION_REVERSAL',input.reason,null,0,value.outputCost,{deltas:value.outputLotDeltas!.map(l=>({lotId:l.lotId,delta:-l.delta}))});
    for(const r of value.requirements){const c=value.unitCosts.find(c=>c.itemId===r.itemId);await inventoryMove(store,a,venueId,r.itemId,r.quantity,'PRODUCTION_REVERSAL',input.reason,null,0,c?.numerator!=null?{numerator:c.numerator,denominator:c.denominator}:null,{deltas:value.inputLotDeltas!.find(l=>l.itemId===r.itemId)!.deltas.map(l=>({lotId:l.lotId,delta:-l.delta}))})}
    Object.assign(value,{status:'REVERSED',reversedAt:new Date().toISOString(),reversedBy:taskActorKey(a),reversalReason:input.reason});await tx.update(s.merchantStockOperation).set({data:value}).where(eq(s.merchantStockOperation.id,id));await h.audit(store,a,venueId,'production.reversed',input.reason,null,publicView(value));return value;
   });
  });
 });
}
