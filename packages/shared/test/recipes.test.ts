import {expect,it} from 'vitest';
import {recipeStockQuantity,priceMerchantCart,type MerchantProduct,type RecipeSnapshot} from '../src';
it('converts exact decimal ingredient units without floating point or silent rounding',()=>{
 expect(recipeStockQuantity('0.018','kg','MILLIGRAM')).toBe(18000);
 expect(recipeStockQuantity('18.125','g','MILLIGRAM')).toBe(18125);
 expect(recipeStockQuantity('0.125','l','MILLILITRE')).toBe(125);
 expect(()=>recipeStockQuantity('0.1','ml','MILLILITRE')).toThrow('RECIPE_QUANTITY_PRECISION');
 expect(()=>recipeStockQuantity('1','g','MILLILITRE')).toThrow('RECIPE_UNIT_MISMATCH');
});
const recipe=(id:string,itemId:string,quantity:number):RecipeSnapshot=>({id,recipeId:id,version:1,name:id,requirements:[{itemId,quantity}],costMethod:'WEIGHTED_AVERAGE',costMinor:null});
it('replaces the whole base recipe without consuming it twice and snapshots the selected versions',()=>{
 const base=recipe('base','milk',150),alternative=recipe('oat','oat-milk',180),shot=recipe('shot','coffee',9000);
 const product:MerchantProduct={id:'p',name:'Latte',category:'Coffee',available:true,variants:[{id:'v',name:'Large',priceMinor:400,recipeVersionId:base.id,recipeSnapshot:base,stockBindings:base.requirements}],extras:[{id:'oat',name:'Oat',priceMinor:50,available:true,recipeVersionId:alternative.id,recipeSnapshot:alternative,stockBindings:alternative.requirements,replacesBaseRecipe:true},{id:'shot',name:'Shot',priceMinor:100,available:true,recipeVersionId:shot.id,recipeSnapshot:shot,stockBindings:shot.requirements}]};
 const priced=priceMerchantCart([product],[{productId:'p',variantId:'v',extraIds:['oat','shot'],quantity:2}]);
 expect(priced.lines[0].stockRequirements).toEqual([{itemId:'oat-milk',quantity:180},{itemId:'coffee',quantity:9000}]);
 expect(priced.lines[0].recipeSnapshots?.map(r=>r.id)).toEqual(['oat','shot']);
 expect(priced.totalMinor).toBe(1100);
});
it('multiplies child recipe requirements once for fixed bundles',()=>{
 const child=recipe('child','beans',18000);
 const coffee:MerchantProduct={id:'coffee',name:'Coffee',category:'Drinks',available:true,variants:[{id:'small',name:'Small',priceMinor:400,recipeVersionId:child.id,recipeSnapshot:child,stockBindings:child.requirements}],extras:[]};
 const bundle:MerchantProduct={id:'bundle',name:'Two coffees',category:'Offers',available:true,components:[{productId:'coffee',variantId:'small',quantity:2}],variants:[{id:'box',name:'Box',priceMinor:700}],extras:[]};
 const line=priceMerchantCart([coffee,bundle],[{productId:'bundle',variantId:'box',extraIds:[],quantity:3}]).lines[0];
 expect(line.stockRequirements).toEqual([{itemId:'beans',quantity:36000}]);expect(line.recipeSnapshots?.[0].quantity).toBe(2);
});
