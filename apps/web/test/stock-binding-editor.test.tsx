import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProductForm } from '../src/merchant/ProductForm'
afterEach(cleanup)
const stock = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',venueId:'venue',name:'Coffee portions',unit:'PORTION' as const,tracked:false,barcode:null,quantity:12,threshold:0,revision:1,createdAt:'now',updatedAt:'now' }
const product = {id:'p',name:'Coffee',category:'Drinks',available:true,variants:[{id:'v',name:'Classic',priceMinor:300}],extras:[{id:'e',name:'Shot',priceMinor:50,available:true}]}
it('configures independent variant and extra resources and preserves them when editing a name', async () => {
 const save=vi.fn(async()=>{})
 render(<ProductForm product={product} stocks={[stock]} currency="EUR" busy={false} onSave={save} onClose={()=>{}} />)
 fireEvent.click(screen.getByRole('button',{name:'Add stock resource for variant Classic'}))
 fireEvent.change(screen.getByLabelText('Stock quantity for variant Classic 1'),{target:{value:'2'}})
 fireEvent.click(screen.getByRole('button',{name:'Add stock resource for extra Shot'}))
 fireEvent.change(screen.getByLabelText('Product name'),{target:{value:'Espresso'}})
 fireEvent.submit(screen.getByRole('button',{name:'Save product →'}).closest('form')!)
 expect(save).toHaveBeenCalledWith(expect.objectContaining({name:'Espresso',variants:[expect.objectContaining({stockBindings:[{itemId:stock.id,quantity:2}]})],extras:[expect.objectContaining({stockBindings:[{itemId:stock.id,quantity:1}]})]}))
 expect(screen.getAllByText(/not tracked/).length).toBeGreaterThan(0)
})
it('derives bundle resources and preserves unavailable links during unrelated edits', () => {
 const save=vi.fn(async()=>{})
 const child={...product,extras:[],variants:[{...product.variants[0],stockBindings:[{itemId:stock.id,quantity:2}]}]}
 const bundle={id:'bundle',name:'Breakfast',category:'Meals',available:true,variants:[{id:'bundle-v',name:'Set',priceMinor:800}],extras:[],components:[{productId:'p',variantId:'v',quantity:3}]}
 const view=render(<ProductForm product={bundle} products={[child]} stocks={[stock]} currency="EUR" busy={false} onSave={save} onClose={()=>{}} />)
 expect(screen.getByText(/6 × Coffee portions/)).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Add stock resource for variant Set'})).toBeNull()
 view.unmount()
 render(<ProductForm product={child} currency="EUR" busy={false} onSave={save} onClose={()=>{}} />)
 fireEvent.change(screen.getByLabelText('Product name'),{target:{value:'Renamed'}})
 fireEvent.submit(screen.getByRole('button',{name:'Save product →'}).closest('form')!)
 expect(save).toHaveBeenCalledWith(expect.objectContaining({variants:[expect.objectContaining({stockBindings:[{itemId:stock.id,quantity:2}]})]}))
 expect((screen.getByRole('button',{name:'Remove stock resource for variant Classic 1'}) as HTMLButtonElement).disabled).toBe(true)
})
it('loads every inventory page and discards late results after switching venue', async () => {
 const { MenuWorkspaceBoard }=await import('../src/merchant/MenuWorkspaceBoard')
 const requests:string[]=[]
 let resolveOld!:(value:unknown)=>void
 const api={request:vi.fn(async (_actor:string,_method:string,path:string)=>{
   requests.push(path)
   if(path.includes('/recipes')) return {items:[],hasMore:false}
   if(path.endsWith('/menu')) return {publishedRevision:0,products:[product],draft:null}
   if(path.includes('/old/')) return new Promise(resolve=>{resolveOld=resolve})
   return path.includes('page=0') ? {items:[],hasMore:true} : {items:[stock],hasMore:false}
 })} as any
 const venue={id:'old',name:'Cafe',fiatCurrency:'EUR' as const,nimAddress:'',usdtAddress:null}
 const view=render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[product]} onPublished={async()=>{}} />)
 await screen.findByRole('button',{name:'Edit Coffee'})
 view.rerender(<MenuWorkspaceBoard api={api} venue={{...venue,id:'new'}} scope="owner" products={[product]} onPublished={async()=>{}} />)
 fireEvent.click(await screen.findByRole('button',{name:'Edit Coffee'}))
 const add=await screen.findByRole('button',{name:'Add stock resource for variant Classic'})
 const {waitFor,act}=await import('@testing-library/react')
 await waitFor(()=>expect((add as HTMLButtonElement).disabled).toBe(false))
 expect(requests).toContain('/venues/new/inventory?page=1&limit=50')
 await act(async()=>resolveOld({items:[{...stock,name:'Old secret stock'}],hasMore:false}))
 fireEvent.click(add)
 expect(screen.queryByText(/Old secret stock/)).toBeNull()
 expect(screen.getByRole('option',{name:/Coffee portions/})).toBeTruthy()
})
it('does not silently discard direct stock links when a product becomes a bundle', () => {
 const save=vi.fn(async()=>{})
 const bound={...product,variants:[{...product.variants[0],stockBindings:[{itemId:stock.id,quantity:1}]}]}
 const child={...product,id:'child',variants:[{...product.variants[0],id:'child-v'}],extras:[]}
 render(<ProductForm product={bound} products={[child]} stocks={[stock]} currency="EUR" busy={false} onSave={save} onClose={()=>{}} />)
 fireEvent.click(screen.getByRole('button',{name:'Add included component +'}))
 expect(screen.getByText('Remove direct resource links before using component resources.')).toBeTruthy()
 fireEvent.submit(screen.getByRole('button',{name:'Save product →'}).closest('form')!)
 expect(save).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Remove stock resource for variant Classic 1'}))
 fireEvent.submit(screen.getByRole('button',{name:'Save product →'}).closest('form')!)
 expect(save).toHaveBeenCalledWith(expect.objectContaining({variants:[expect.objectContaining({stockBindings:[]})],components:[{productId:'child',variantId:'child-v',quantity:1}]}))
})
