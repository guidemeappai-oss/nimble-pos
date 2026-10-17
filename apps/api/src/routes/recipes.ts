import {randomUUID} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {RecipeInput,recipeStockQuantity,type RecipeVersion} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {inventoryItem,inventoryRetry} from '../services/inventory';
import {recipeVersions} from '../services/recipes';
import {taskActorKey,type MerchantTaskHelpers} from './tasks';
import {loyaltyFail as fail} from '../services/loyalty';
export async function recipeRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/recipes';
 async function context(req:FastifyRequest,edit=false){const a=await h.actor(req),venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);if(a.kind!=='owner'&&!(a.permissions?.includes(edit?'menu.manage':'inventory.manage')||!edit&&a.permissions?.includes('menu.manage')))fail(403,'FORBIDDEN');return {a,venueId}}
 app.get(base,async req=>{const {venueId}=await context(req),q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'RECIPE'))).orderBy(desc(s.merchantStockOperation.createdAt),desc(s.merchantStockOperation.id)).limit(51).offset(q.page*50);return {items:rows.slice(0,50).map(r=>r.data),hasMore:rows.length>50}});
 app.post(base,async req=>{
  const {a,venueId}=await context(req,true),input=RecipeInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'recipe.version',input},async()=>{
    const recipeId=input.recipeId??randomUUID();
    const previous=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'RECIPE'),sql`${s.merchantStockOperation.data}->>'recipeId'=${recipeId}`));
    if(input.recipeId&&!previous.length)fail(404,'INVALID_RECIPE');
    const nested=await recipeVersions(store,venueId,input.ingredients.flatMap(i=>i.kind==='RECIPE'?[i.recipeVersionId]:[]));
    const ancestors=[...new Set([...nested.values()].flatMap(r=>[r.recipeId,...r.ancestorRecipeIds]))];
    if(ancestors.includes(recipeId))fail(400,'RECIPE_CYCLE');
    const totals=new Map<string,number>();
    const add=(itemId:string,quantity:number)=>{const total=(totals.get(itemId)??0)+quantity;if(!Number.isSafeInteger(total)||total>2147483647)fail(400,'RECIPE_QUANTITY_PRECISION');totals.set(itemId,total)};
    for(const ingredient of input.ingredients){
     if(ingredient.kind==='ITEM'){
      const item=await inventoryItem(store,venueId,ingredient.itemId);
      try{add(item.id,recipeStockQuantity(ingredient.quantity,ingredient.unit,item.unit))}catch(e){fail(400,e instanceof Error?e.message:'INVALID_RECIPE')}
     }else for(const binding of nested.get(ingredient.recipeVersionId)!.requirements)add(binding.itemId,binding.quantity*ingredient.quantity);
    }
    if(totals.size>20)fail(400,'RECIPE_RESOURCE_LIMIT');
    const value:RecipeVersion={id:randomUUID(),recipeId,version:Math.max(0,...previous.map(r=>(r.data as RecipeVersion).version))+1,venueId,name:input.name,ingredients:input.ingredients,ancestorRecipeIds:ancestors,requirements:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([itemId,quantity])=>({itemId,quantity})),costMethod:'WEIGHTED_AVERAGE',costMinor:null,createdAt:new Date().toISOString(),createdBy:taskActorKey(a),reason:input.reason};
    await tx.insert(s.merchantStockOperation).values({id:value.id,venueId,kind:'RECIPE',data:value});
    await h.audit(store,a,venueId,'recipe.version.created',input.reason,null,value);
    return value;
   });
  });
 });
}
