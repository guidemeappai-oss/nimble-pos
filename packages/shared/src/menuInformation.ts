import { z } from 'zod'
import type { MerchantProduct } from './merchant'
export const MENU_LANGUAGES = ['en','pl','de','es','fr','pt'] as const
export const MENU_ALLERGENS = ['gluten','crustaceans','eggs','fish','peanuts','soy','milk','nuts','celery','mustard','sesame','sulphites','lupin','molluscs'] as const
export const MenuInformationInput = z.object({
 sourceLanguage:z.enum(MENU_LANGUAGES),
 description:z.string().trim().max(2000).optional(),
 allergensReviewed:z.boolean(),
 allergens:z.array(z.enum(MENU_ALLERGENS)).max(14).refine(v=>new Set(v).size===v.length),
 translations:z.record(z.enum(MENU_LANGUAGES),z.object({name:z.string().trim().min(1).max(120),description:z.string().trim().max(2000).optional()}).strict()),
}).strict()
export type MenuInformation = z.infer<typeof MenuInformationInput>
/** Conservative union of fixed and optional components; unknown is propagated. */
export function menuInformation(product:MerchantProduct, products:MerchantProduct[], language:string) {
 const info=product.information, source=info?.sourceLanguage ?? 'en'
 const translated=language===source ? undefined : info?.translations[language as typeof MENU_LANGUAGES[number]]
 const allergens=new Set<string>(), visited=new Set<string>()
 let known=true
 function visit(p:MerchantProduct) {
  if(visited.has(p.id)) return
  visited.add(p.id)
  if(!p.information?.allergensReviewed) known=false
  p.information?.allergens.forEach(a=>allergens.add(a))
  for(const component of [...p.components ?? [],...p.extras.flatMap(e=>e.component?[e.component]:[])]) {
   const child=products.find(c=>c.id===component.productId)
   if(child) visit(child); else known=false
  }
 }
 visit(product)
 return {name:translated?.name ?? product.name,description:translated ? translated.description : info?.description,language:translated?language:source,fallback:language!==source&&!translated,allergens:[...allergens].sort(),allergensKnown:known}
}
