import {inventoryCosts,calculateRecipeCost} from './inventoryCost';
import {and,eq,inArray} from 'drizzle-orm';
import type {MerchantProduct,RecipeSnapshot,RecipeVersion} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {loyaltyFail as fail} from './loyalty';
export async function recipeVersions(db:Db,venueId:string,ids:string[]){
 if(!ids.length)return new Map<string,RecipeVersion>();
 const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'RECIPE'),inArray(s.merchantStockOperation.id,[...new Set(ids)])));
 if(rows.length!==new Set(ids).size)fail(400,'INVALID_RECIPE');
 return new Map(rows.map(r=>[r.id,r.data as RecipeVersion]));
}
export async function applyRecipes(db:Db,venueId:string,products:MerchantProduct[],includeCosts=false):Promise<MerchantProduct[]>{
 const ids=products.flatMap(p=>[...p.variants,...p.extras].flatMap(o=>o.recipeVersionId?[o.recipeVersionId]:[]));
 const versions=await recipeVersions(db,venueId,ids);
 const costs=includeCosts&&versions.size?await inventoryCosts(db,venueId):new Map();
 const costSnapshots=new Map([...versions.values()].map(r=>[r.id,includeCosts ? calculateRecipeCost(costs,r.requirements) : {costMinor:null,unitCosts:[]}] as const));
 const resolve=<T extends {recipeVersionId?:string}>(option:T):T & {recipeSnapshot?:RecipeSnapshot}=>{
  if(!option.recipeVersionId)return option;
  const r=versions.get(option.recipeVersionId)!;
  return {...option,stockBindings:r.requirements,recipeSnapshot:{id:r.id,recipeId:r.recipeId,version:r.version,name:r.name,requirements:r.requirements,costMethod:r.costMethod,costMinor:costSnapshots.get(r.id)!.costMinor,unitCosts:costSnapshots.get(r.id)!.unitCosts}};
 };
 return products.map(p=>({...p,variants:p.variants.map(resolve),extras:p.extras.map(resolve)}));
}
