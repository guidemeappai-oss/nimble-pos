import {expect,it} from 'vitest'
import {validateMerchantCatalog} from '@nimble/shared'
import {DemoCafe} from '../src/merchant/demo'

it('demonstrates a breakfast bundle with required choices and immutable per-unit composition',()=>{
 const cafe=new DemoCafe()
 expect(()=>validateMerchantCatalog(cafe.products)).not.toThrow()
 cafe.signIn('anna','1234');cafe.openShift()
 const line={productId:'breakfast',variantId:'breakfast-one',extraIds:['breakfast-flat'],quantity:2}
 expect(()=>cafe.createOrder([{...line,extraIds:[]}])).toThrow('CHOICE_REQUIRED')
 expect(()=>cafe.createOrder([{...line,quantity:1.5}])).toThrow('Invalid quantity')
 const order=cafe.createOrder([line])
 expect(order.totalMinor).toBe(1400)
 expect(order.lines[0].components).toEqual([
  {productId:'croissant',variantId:'croissant-classic',quantity:1,productName:'Butter croissant',variantName:'Freshly baked'},
  {productId:'flat',variantId:'classic',quantity:1,productName:'Flat white',variantName:'Classic'},
 ])
 cafe.products.find(p=>p.id==='croissant')!.name='Later name'
 expect(order.lines[0].components?.[0].productName).toBe('Butter croissant')
 expect(()=>cafe.createOrder([{...line,extraIds:['breakfast-flat','breakfast-espresso']}])).toThrow('CHOICE_LIMIT')
 cafe.setAvailability('flat',false)
 expect(()=>cafe.createOrder([line])).toThrow('UNAVAILABLE_ITEM')
})
