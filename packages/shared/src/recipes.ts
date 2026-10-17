import {z} from 'zod';
import type {MerchantStockBinding} from './merchant';
export const RecipeUnit=z.enum(['mg','g','kg','ml','l','piece','portion']);
export const RecipeInput=z.object({
 recipeId:z.string().uuid().optional(),name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(500),idempotencyKey:z.string().uuid(),
 ingredients:z.array(z.discriminatedUnion('kind',[
  z.object({kind:z.literal('ITEM'),itemId:z.string().uuid(),quantity:z.string().regex(/^\d{1,10}(\.\d{1,3})?$/),unit:RecipeUnit}).strict(),
  z.object({kind:z.literal('RECIPE'),recipeVersionId:z.string().uuid(),quantity:z.number().int().min(1).max(100)}).strict(),
 ])).min(1).max(20),
}).strict();
export type RecipeInput=z.infer<typeof RecipeInput>;
export type RecipeSnapshot={id:string;recipeId:string;version:number;name:string;requirements:MerchantStockBinding[];costMethod:'WEIGHTED_AVERAGE';costMinor:string|null;unitCosts?:{itemId:string;numerator:string|null;denominator:string}[]};
export type RecipeVersion=RecipeSnapshot & {venueId:string;ingredients:RecipeInput['ingredients'];ancestorRecipeIds:string[];createdAt:string;createdBy:string;reason:string};
const units={mg:{dimension:'MASS',scale:1n},g:{dimension:'MASS',scale:1000n},kg:{dimension:'MASS',scale:1000000n},ml:{dimension:'VOLUME',scale:1n},l:{dimension:'VOLUME',scale:1000n},piece:{dimension:'PIECE',scale:1n},portion:{dimension:'PORTION',scale:1n}} as const;
/** Integer canonical stock: mg, ml, pieces or portions. Never rounds ingredient usage. */
export function recipeStockQuantity(quantity:string,unit:z.infer<typeof RecipeUnit>,stockUnit:string):number {
 const target=({MILLIGRAM:'MASS',MILLILITRE:'VOLUME',PIECE:'PIECE',PORTION:'PORTION'} as Record<string,string>)[stockUnit];
 if(!/^\d{1,10}(\.\d{1,3})?$/.test(quantity)||units[unit].dimension!==target)throw new Error('RECIPE_UNIT_MISMATCH');
 const [whole,fraction='']=quantity.split('.');
 const numerator=(BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0')))*units[unit].scale;
 if(numerator%1000n!==0n||numerator<=0n||numerator/1000n>2147483647n)throw new Error('RECIPE_QUANTITY_PRECISION');
 return Number(numerator/1000n);
}
