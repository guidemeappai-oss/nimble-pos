import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {PurchaseOrdersBoard} from '../src/merchant/PurchaseOrdersBoard';
afterEach(cleanup);
const suggestion={itemId:'milk',name:'Milk',unit:'MILLILITRE',physicalQuantity:2,reservedQuantity:1,pendingLossQuantity:0,availableQuantity:1,threshold:5,targetQuantity:6,incomingQuantity:2,suggestedQuantity:3};
it('uses editable explained suggestions and freezes an uncertain draft until the exact operation is retried',async()=>{
 const writes:any[]=[];const request=vi.fn(async(_auth:string,method:string,path:string,body:any)=>{
  if(method==='POST'){writes.push(body);if(writes.length===1)throw new Error('Response lost');return {id:'purchase'}}
  if(path.includes('/suggestions'))return {items:[suggestion]};if(path.includes('/purchases'))return {items:[],hasMore:false};if(path.includes('/suppliers'))return {suppliers:[{id:'supplier',name:'Dairy',active:true}],hasMore:false};return {items:[{id:'milk',name:'Milk'}],hasMore:false};
 });
 render(<PurchaseOrdersBoard api={{request} as never} venueId="venue" scope="owner" owner canCosts onChanged={()=>{}}/>);
 await screen.findByRole('option',{name:'Dairy'});await screen.findByText('Milk: 3 MILLILITRE');fireEvent.click(screen.getByRole('button',{name:'Use suggestions in draft'}));
 expect((screen.getByLabelText('Purchase quantity Milk') as HTMLInputElement).value).toBe('3');fireEvent.change(screen.getByLabelText('Purchase quantity Milk'),{target:{value:'4'}});fireEvent.change(screen.getByLabelText('Purchase supplier'),{target:{value:'supplier'}});fireEvent.change(screen.getByLabelText('Purchase reason'),{target:{value:'Four units for tomorrow'}});
 fireEvent.click(screen.getByRole('button',{name:'Save purchase draft'}));await screen.findByRole('alert');expect((screen.getByLabelText('Purchase reason').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Retry same purchase operation'}));await waitFor(()=>expect(writes).toHaveLength(2));expect(writes[1]).toEqual(writes[0]);expect(writes[1].lines).toEqual([{itemId:'milk',quantity:4}]);
});
it('clears purchase data on identity change',async()=>{
 let alice=true;const api={request:vi.fn(async(_a:string,_m:string,path:string)=>path.includes('suppliers')?{suppliers:[],hasMore:false}:path.includes('suggestions')?{items:alice?[suggestion]:[]}:{items:[],hasMore:false})} as never;
 const props={api,venueId:'venue',owner:false,canCosts:false,onChanged:()=>{}};const view=render(<PurchaseOrdersBoard {...props} scope="alice"/>);await screen.findByText('Milk: 3 MILLILITRE');alice=false;view.rerender(<PurchaseOrdersBoard {...props} scope="bob"/>);expect(screen.queryByText('Milk: 3 MILLILITRE')).toBeNull();
});
it('does not offer another write retry when only the refresh failed after a confirmed save',async()=>{
 let saved=false;const changed=vi.fn();const request=vi.fn(async(_a:string,method:string,path:string)=>{if(method==='POST'){saved=true;return {id:'saved'}}if(saved)throw new Error('Refresh offline');if(path.includes('/suggestions'))return {items:[]};if(path.includes('/suppliers'))return {suppliers:[{id:'supplier',name:'Dairy',active:true}],hasMore:false};if(path.includes('/purchases'))return {items:[],hasMore:false};return {items:[{id:'milk',name:'Milk'}],hasMore:false}});
 render(<PurchaseOrdersBoard api={{request} as never} venueId="venue" scope="owner" owner canCosts onChanged={changed}/>);await screen.findByRole('option',{name:'Dairy'});
 fireEvent.change(screen.getByLabelText('Purchase supplier'),{target:{value:'supplier'}});fireEvent.change(screen.getByLabelText('Purchase quantity Milk'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Purchase reason'),{target:{value:'Milk for tomorrow'}});fireEvent.click(screen.getByRole('button',{name:'Save purchase draft'}));await screen.findByRole('alert');
 expect(changed).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'Retry same purchase operation'})).toBeNull();expect((screen.getByLabelText('Purchase reason').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
});
