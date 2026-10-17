import { describe, expect, it } from 'vitest'
import { MerchantProductInput, menuInformation, type MerchantProduct } from '../src/index'
const product = (id: string, info?: MerchantProduct['information']): MerchantProduct => ({id,name:'Coffee',category:'Drinks',available:true,variants:[{id:'v',name:'Classic',priceMinor:100}],extras:[],information:info})
describe('published menu information', () => {
 it('never presents missing allergen information as allergen-free', () => {
  expect(menuInformation(product('a'), [], 'pl').allergensKnown).toBe(false)
 })
 it('uses approved translations and explicitly identifies fallback', () => {
  const p=product('a',{allergens:['milk'],allergensReviewed:true,sourceLanguage:'en',translations:{pl:{name:'Kawa',description:'Opis'}}})
  expect(menuInformation(p,[p],'pl')).toMatchObject({name:'Kawa',description:'Opis',fallback:false,allergens:['milk'],allergensKnown:true})
  expect(menuInformation(p,[p],'de')).toMatchObject({name:'Coffee',fallback:true,language:'en'})
 })
 it('includes all bundle choices conservatively and propagates unknown information', () => {
  const milk=product('milk',{allergens:['milk'],allergensReviewed:true,sourceLanguage:'en',translations:{}})
  const unknown=product('unknown')
  const bundle=product('bundle',{allergens:[],allergensReviewed:true,sourceLanguage:'en',translations:{}})
  bundle.components=[{productId:'milk',variantId:'v',quantity:1}]
  bundle.extras=[{id:'x',name:'Swap',available:true,priceMinor:0,component:{productId:'unknown',variantId:'v',quantity:1}}]
  expect(menuInformation(bundle,[bundle,milk,unknown],'en')).toMatchObject({allergens:['milk'],allergensKnown:false})
 })
 it('validates reviewed data and rejects unknown allergen identifiers', () => {
  const p={...product('a'),id:undefined,variants:[{id:'00000000-0000-4000-8000-000000000001',name:'Classic',priceMinor:100}],information:{allergens:['invented'],allergensReviewed:true,sourceLanguage:'en',translations:{}}}
  expect(MerchantProductInput.safeParse(p).success).toBe(false)
 })
})
