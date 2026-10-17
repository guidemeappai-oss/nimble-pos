import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProductInformation, ProductInformationEditor } from '../src/merchant/ProductInformation'
import { ProductForm } from '../src/merchant/ProductForm'
const product={id:'00000000-0000-4000-8000-000000000001',name:'Coffee',category:'Drinks',available:true,variants:[{id:'00000000-0000-4000-8000-000000000002',name:'Classic',priceMinor:300}],extras:[]}
afterEach(cleanup)
it('shows unknown allergens and explicit source-language fallback',()=>{
 render(<ProductInformation product={product} products={[product]} language="pl"/> )
 expect(screen.getByText(/Allergen information incomplete/)).toBeTruthy()
 expect(screen.getByText(/Translation unavailable/)).toBeTruthy()
 expect(screen.queryByText(/none declared/)).toBeNull()
})
it('edits approved information in the product draft',async()=>{
 const onSave=vi.fn(async()=>{})
 render(<ProductForm product={product} products={[product]} currency="EUR" busy={false} onSave={onSave} onClose={()=>{}}/> )
 fireEvent.change(screen.getByLabelText('PL product name'),{target:{value:'Kawa'}})
 fireEvent.click(screen.getByLabelText('milk'))
 fireEvent.click(screen.getByLabelText('I reviewed allergens for all variants and add-ons'))
 fireEvent.submit(screen.getByLabelText('Product name').closest('form')!)
 expect(onSave).toHaveBeenCalledWith(expect.objectContaining({information:expect.objectContaining({allergens:['milk'],allergensReviewed:true,translations:{pl:{name:'Kawa'}}})}))
})
it('changing allergens invalidates the review confirmation',()=>{
 const onChange=vi.fn()
 render(<ProductInformationEditor value={{sourceLanguage:'en',allergensReviewed:true,allergens:[],translations:{}}} onChange={onChange}/>)
 fireEvent.click(screen.getByLabelText('eggs'))
 expect(onChange).toHaveBeenCalledWith(expect.objectContaining({allergensReviewed:false,allergens:['eggs']}))
})
