import {and,eq,inArray} from 'drizzle-orm';
import type {MerchantProduct,MerchantStockBinding} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {stockAvailabilityBatch} from './stockReservations';
export type StockMenuOption={productId:string;productName:string;kind:'VARIANT'|'EXTRA';optionId:string;optionName:string;missingItemIds:string[]};
export async function stockMenuProjection(db:Db,venueId:string,products:MerchantProduct[]){
 const ids=[...new Set(products.flatMap(p=>[...p.variants,...p.extras].flatMap(o=>(o.stockBindings??[]).map(b=>b.itemId))))];
 const items=ids.length?await db.select().from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId,venueId),inArray(s.merchantInventoryItem.id,ids))):[];
 const availability=await stockAvailabilityBatch(db,items),map=new Map(items.map(i=>[i.id,i]));
 const missing=(bindings:MerchantStockBinding[])=>{
  const totals=new Map<string,number>();for(const b of bindings)totals.set(b.itemId,(totals.get(b.itemId)??0)+b.quantity);
  return [...totals].filter(([id,qty])=>{const item=map.get(id);return !item||!item.available||item.tracked&&availability.get(id)!.availableQuantity<qty}).map(([id])=>id);
 };
 const child=(ref:{productId:string;variantId:string;quantity:number})=>products.find(p=>p.id===ref.productId)?.variants.find(v=>v.id===ref.variantId)?.stockBindings?.map(b=>({...b,quantity:b.quantity*ref.quantity}))??[];
 const impact:StockMenuOption[]=[];
 const projected=products.map(p=>{
  const extras=p.extras.map(e=>{const missingItemIds=missing([...(e.stockBindings??[]),...(e.component?child(e.component):[])]);if(missingItemIds.length)impact.push({productId:p.id,productName:p.name,kind:'EXTRA',optionId:e.id,optionName:e.name,missingItemIds});return {...e,available:e.available&&!missingItemIds.length}});
  const variants=p.variants.flatMap(v=>{
   const missingItemIds=missing([...(v.stockBindings??[]),...(p.components??[]).flatMap(child)]);
   if(!missingItemIds.length)return [v];
   impact.push({productId:p.id,productName:p.name,kind:'VARIANT',optionId:v.id,optionName:v.name,missingItemIds});
   const alternative=!p.components?.length&&!!v.recipeVersionId&&extras.some(e=>e.replacesBaseRecipe&&e.available);
   return alternative?[{...v,requiresRecipeReplacement:true}]:[];
  });
  return {...p,extras,variants,available:p.available&&variants.length>0};
 });
 return {products:projected,impact,blockedItemIds:items.filter(i=>!i.available).map(i=>i.id)};
}
