import { expect, it } from 'vitest'
import { priceMerchantCart, canMerchantTransition, MerchantOrderInput } from '../src/merchant'
const product = {
  id: 'coffee',
  name: 'Coffee',
  category: 'Drinks',
  available: true,
  variants: [{ id: 'large', name: 'Large', priceMinor: 450 }],
  extras: [{ id: 'oat', name: 'Oat milk', priceMinor: 60, available: true }],
}
it('freezes itemized prices from the server catalog and refuses unavailable choices', () => {
  expect(
    priceMerchantCart(
      [product],
      [{ productId: 'coffee', variantId: 'large', extraIds: ['oat'], quantity: 2 }],
    ),
  ).toMatchObject({
    totalMinor: 1020,
    lines: [{ productName: 'Coffee', variantName: 'Large', unitPriceMinor: 510, totalMinor: 1020 }],
  })
  expect(() =>
    priceMerchantCart(
      [{ ...product, available: false }],
      [{ productId: 'coffee', variantId: 'large', extraIds: [], quantity: 1 }],
    ),
  ).toThrow('UNAVAILABLE_ITEM')
  expect(() =>
    priceMerchantCart(
      [product],
      [{ productId: 'coffee', variantId: 'large', extraIds: ['missing'], quantity: 1 }],
    ),
  ).toThrow('UNAVAILABLE_ITEM')
  expect(() =>
    priceMerchantCart(
      [product],
      [{ productId: 'coffee', variantId: 'large', extraIds: ['oat', 'oat'], quantity: 1 }],
    ),
  ).toThrow('DUPLICATE_EXTRA')
})
it('does not accept caller supplied totals or skip verified payment to readiness', () => {
  expect(MerchantOrderInput.safeParse({ lines: [], totalMinor: 1 }).success).toBe(false)
  expect(canMerchantTransition('AWAITING_PAYMENT', 'READY')).toBe(false)
  expect(canMerchantTransition('PAYMENT_PENDING', 'CANCELLED')).toBe(false)
  expect(canMerchantTransition('PREPARING', 'READY')).toBe(true)
  expect(canMerchantTransition('PREPARING', 'COLLECTED')).toBe(false)
    expect(canMerchantTransition('READY', 'COLLECTED')).toBe(true)
})
it('validates required choices and freezes bundle composition without charging component prices twice', () => {
  const sandwich = {...product, id:'sandwich', name:'Sandwich', variants:[{id:'regular',name:'Regular',priceMinor:700}], extras:[]}
  const bundle = {...product,id:'bundle',name:'Lunch',variants:[{id:'lunch',name:'One',priceMinor:900}], components:[{productId:'sandwich',variantId:'regular',quantity:1}], extras:[{id:'coffee-choice',name:'Coffee',priceMinor:100,available:true,component:{productId:'coffee',variantId:'large',quantity:1}}], choiceGroups:[{id:'drink',name:'Drink',min:1,max:1,extraIds:['coffee-choice']}]}
  const line={productId:'bundle',variantId:'lunch',extraIds:['coffee-choice'],quantity:2}
  expect(priceMerchantCart([product,sandwich,bundle],[line])).toMatchObject({totalMinor:2000,lines:[{components:[{productId:'sandwich',productName:'Sandwich',quantity:1},{productId:'coffee',productName:'Coffee',quantity:1}]}]})
  expect(()=>priceMerchantCart([product,sandwich,bundle],[{...line,extraIds:[]}])).toThrow('CHOICE_REQUIRED')
})
it('rejects invalid group membership, nesting and missing component variants', async () => {
  const {validateMerchantCatalog}=await import('../src/merchant')
  const grouped={...product,choiceGroups:[{id:'group',name:'Milk',min:1,max:1,extraIds:['oat']}]}
  expect(()=>validateMerchantCatalog([grouped])).not.toThrow()
  expect(()=>validateMerchantCatalog([{...grouped,choiceGroups:[...grouped.choiceGroups,{...grouped.choiceGroups[0],id:'other'}]}])).toThrow('INVALID_CHOICE_GROUP')
  expect(()=>validateMerchantCatalog([{...grouped,choiceGroups:[{...grouped.choiceGroups[0],min:2}]}])).toThrow('INVALID_CHOICE_GROUP')
  const bundle={...product,id:'bundle',variants:[{id:'bundle-v',name:'Meal',priceMinor:700}],extras:[],components:[{productId:product.id,variantId:'missing',quantity:1}]}
  expect(()=>validateMerchantCatalog([product,bundle])).toThrow('INVALID_COMPONENT')
  expect(()=>validateMerchantCatalog([grouped,{...bundle,components:[{productId:product.id,variantId:'large',quantity:1}]}])).toThrow('INVALID_COMPONENT')
})
it('does not trust caller derived snapshots and leaves unselected unavailable choices usable', () => {
  const other={...product,id:'other',variants:[{id:'other-v',name:'Other',priceMinor:900}],extras:[],available:false}
  const optional={...product,extras:[{id:'choice',name:'Other',available:true,priceMinor:100,component:{productId:'other',variantId:'other-v',quantity:1}}]}
  const cart={productId:'coffee',variantId:'large',extraIds:[],quantity:1,components:[{productId:'forged',quantity:100}]}
  expect(priceMerchantCart([optional,other],[cart]).lines[0]).not.toHaveProperty('components')
  expect(()=>priceMerchantCart([optional,other],[{...cart,extraIds:['choice']}])).toThrow('UNAVAILABLE_ITEM')
})

it('freezes shared resource requirements per line unit and aggregates quantities once', async () => {
 const {aggregateMerchantStockRequirements}=await import('../src/merchant')
 const coffee={...product,variants:[{...product.variants[0],stockBindings:[{itemId:'beans',quantity:2}]}],extras:[{...product.extras[0],stockBindings:[{itemId:'milk',quantity:1}]}]}
 const meal={...product,id:'meal',variants:[{id:'meal-v',name:'Meal',priceMinor:900}],extras:[],components:[{productId:'coffee',variantId:'large',quantity:2}]}
 const priced=priceMerchantCart([coffee,meal],[{productId:'coffee',variantId:'large',extraIds:['oat'],quantity:3},{productId:'meal',variantId:'meal-v',extraIds:[],quantity:2}])
 expect(priced.lines[0].stockRequirements).toEqual([{itemId:'beans',quantity:2},{itemId:'milk',quantity:1}])
 expect(priced.lines[1].stockRequirements).toEqual([{itemId:'beans',quantity:4}])
 expect(aggregateMerchantStockRequirements(priced.lines)).toEqual([{itemId:'beans',quantity:14},{itemId:'milk',quantity:3}])
 coffee.variants[0].stockBindings[0].quantity=9
 expect(priced.lines[0].stockRequirements?.[0].quantity).toBe(2)
})
it('rejects duplicate and ambiguous resource mappings, forged input and overflowing totals', async () => {
 const {validateMerchantCatalog,aggregateMerchantStockRequirements}=await import('../src/merchant')
 const bound={...product,variants:[{...product.variants[0],stockBindings:[{itemId:'beans',quantity:2}]}]}
 expect(()=>validateMerchantCatalog([{...bound,variants:[{...bound.variants[0],stockBindings:[{itemId:'beans',quantity:2},{itemId:'beans',quantity:1}]}]}])).toThrow('INVALID_STOCK_BINDING')
 expect(()=>validateMerchantCatalog([{...bound,components:[{productId:'other',variantId:'v',quantity:1}]}])).toThrow('INVALID_STOCK_BINDING')
 expect(()=>validateMerchantCatalog([{...product,extras:[{...product.extras[0],component:{productId:'other',variantId:'v',quantity:1},stockBindings:[{itemId:'beans',quantity:1}]}]}])).toThrow('INVALID_STOCK_BINDING')
 const snapshot=priceMerchantCart([bound],[{productId:'coffee',variantId:'large',extraIds:[],quantity:1}]).lines[0]
 expect(()=>aggregateMerchantStockRequirements([{...snapshot,quantity:100,stockRequirements:[{itemId:'beans',quantity:2147483647}]}])).toThrow('INVALID_STOCK_BINDING')
 expect(MerchantOrderInput.safeParse({lines:[{productId:crypto.randomUUID(),variantId:crypto.randomUUID(),quantity:1,extraIds:[],stockRequirements:[]}]}).success).toBe(false)
 expect(priceMerchantCart([product],[{productId:'coffee',variantId:'large',extraIds:[],quantity:1}]).lines[0]).not.toHaveProperty('stockRequirements')
})
it('rejects an order whose individually valid bundle requirements overflow the ledger total', () => {
 const child={...product,variants:[{...product.variants[0],stockBindings:[{itemId:'beans',quantity:100}]}],extras:[]}
 const meal={...product,id:'meal',variants:[{id:'meal-v',name:'Meal',priceMinor:1}],extras:Array.from({length:20},(_,i)=>({id:'e'+i,name:'Choice',available:true,priceMinor:0,component:{productId:'coffee',variantId:'large',quantity:100}})),components:Array.from({length:20},()=>({productId:'coffee',variantId:'large',quantity:100}))}
 expect(()=>priceMerchantCart([child,meal],Array.from({length:100},()=>({productId:'meal',variantId:'meal-v',extraIds:meal.extras.map(e=>e.id),quantity:100})))).toThrow('INVALID_STOCK_BINDING')
 expect(()=>priceMerchantCart([{...meal,variants:[{...meal.variants[0],stockBindings:[{itemId:'beans',quantity:1}]}]},child],[{productId:'meal',variantId:'meal-v',extraIds:[],quantity:1}])).toThrow('INVALID_STOCK_BINDING')
})
