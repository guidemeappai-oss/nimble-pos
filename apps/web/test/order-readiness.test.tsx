import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {OrderReadiness} from '../src/merchant/OrderReadiness'
import {MerchantApi} from '../src/merchant/client'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const order={id:'o',revision:4,status:'PREPARING',lines:[{productName:'Coffee',variantName:'Large',quantity:3}],payment:{},paidSnapshot:{lines:[{productName:'Coffee',variantName:'Large',quantity:3}],totalMinor:900}} as any
const state={orderId:'o',revision:4,cartRevision:2,status:'PREPARING',lines:[{lineIndex:0,quantity:3,readyQuantity:1}],allReady:false}
const api=()=>new MerchantApi('',()=>'',()=>'',()=>null)
it('saves a partial quantity and only refreshes the queue after server confirmation',async()=>{
 const client=api(),changed=vi.fn();let resolve!:(value:unknown)=>void
 const request=vi.spyOn(client,'request').mockImplementation(async(_a,method)=>method==='GET'?state:new Promise(r=>{resolve=r}))
 const view=render(<OrderReadiness api={client} venueId="v" order={order} scope="a" canWrite onChanged={changed}/> )
 await screen.findByText('1 / 3 ready');fireEvent.change(screen.getByLabelText('Ready quantity: Coffee'),{target:{value:'2'}})
 fireEvent.click(screen.getByRole('button',{name:'Save readiness: Coffee'}))
 expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('Ready for pickup')).toBeNull()
 await act(async()=>resolve({...state,revision:5,lines:[{lineIndex:0,quantity:3,readyQuantity:2}]}))
 await screen.findByText('2 / 3 ready');expect(changed).toHaveBeenCalledTimes(1)
 expect(request.mock.calls.find(c=>c[1]==='POST')?.[3]).toMatchObject({revision:4,cartRevision:2,lineIndex:0,readyQuantity:2})
})
it('retries an uncertain final unit with the same key and shows completion only from the server',async()=>{
 const client=api(),changed=vi.fn();let calls=0
 const request=vi.spyOn(client,'request').mockImplementation(async(_a,method)=>{if(method==='GET')return calls>=2?{...state,status:'READY',allReady:true,lines:[{lineIndex:0,quantity:3,readyQuantity:3}]}:state;if(++calls===1)throw new Error('offline');return {...state,revision:5,status:'READY',allReady:true,lines:[{lineIndex:0,quantity:3,readyQuantity:3}]}})
 const view=render(<OrderReadiness api={client} venueId="v" order={order} scope="a" canWrite onChanged={changed}/> )
 await screen.findByText('1 / 3 ready');fireEvent.change(screen.getByLabelText('Ready quantity: Coffee'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'Save readiness: Coffee'}))
 await screen.findByRole('alert');expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('All items ready')).toBeNull()
 view.rerender(<OrderReadiness api={client} venueId="v" order={{...order,status:'READY',revision:5}} scope="a" canWrite={false} onChanged={changed}/>)
 fireEvent.click(screen.getByRole('button',{name:'Retry same readiness: Coffee'}));await screen.findByText('All items ready')
 const posts=request.mock.calls.filter(c=>c[1]==='POST');expect(posts[0][3]).toEqual(posts[1][3]);expect(changed).toHaveBeenCalledTimes(1)
 expect((screen.getByLabelText('Ready quantity: Coffee') as HTMLSelectElement).disabled).toBe(true)
})
it('refreshes a revision conflict, retains the selected quantity, and makes a new intent on explicit retry',async()=>{
 const client=api();let revision=4
 const request=vi.spyOn(client,'request').mockImplementation(async(_a,method)=>{if(method==='GET')return {...state,revision};revision=7;throw {code:'READINESS_CONFLICT',message:'conflict'}})
 render(<OrderReadiness api={client} venueId="v" order={order} scope="a" canWrite/> )
 await screen.findByText('1 / 3 ready');fireEvent.change(screen.getByLabelText('Ready quantity: Coffee'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'Save readiness: Coffee'}))
 await screen.findByText(/Readiness changed/);expect((screen.getByLabelText('Ready quantity: Coffee') as HTMLSelectElement).value).toBe('2')
 fireEvent.click(screen.getByRole('button',{name:'Save readiness: Coffee'}));await waitFor(()=>expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(2))
 const posts=request.mock.calls.filter(c=>c[1]==='POST');expect(posts[1][3]).toMatchObject({revision:7,readyQuantity:2});expect((posts[0][3] as any).idempotencyKey).not.toBe((posts[1][3] as any).idempotencyKey)
})
it('ignores a late previous cashier response and disables writes with no open shift',async()=>{
 const client=api();const resolves:((value:unknown)=>void)[]=[]
 const request=vi.spyOn(client,'request').mockImplementation(()=>new Promise(r=>resolves.push(r)))
 const view=render(<OrderReadiness api={client} venueId="v" order={order} scope="a" canWrite/> )
 view.rerender(<OrderReadiness api={client} venueId="v" order={order} scope="b" canWrite={false}/> )
 await act(async()=>{resolves[0](state)})
 expect(screen.queryByText('1 / 3 ready')).toBeNull()
 await act(async()=>{resolves[1](state)})
 await screen.findByText('1 / 3 ready');expect((screen.getByLabelText('Ready quantity: Coffee') as HTMLSelectElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Save readiness: Coffee'}));expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(0)
})
it('shows bounded quantities from the immutable paid basket and owner read-only progress',async()=>{
 const client=api();vi.spyOn(client,'request').mockResolvedValue(state)
 const edited={...order,lines:[{productName:'Wrong cart',quantity:9}]}
 const view=render(<OrderReadiness api={client} venueId="v" order={edited} scope="a" canWrite/> )
 await screen.findByText('1 / 3 ready');expect(screen.queryByText('Wrong cart')).toBeNull();expect(screen.getAllByRole('option').map(o=>(o as HTMLOptionElement).value)).toEqual(['0','1','2','3'])
 view.rerender(<OrderReadiness api={client} venueId="v" order={edited} scope="owner" canWrite owner/> )
 await screen.findByText('1 / 3 ready');expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByRole('button',{name:'Save readiness: Coffee'})).toBeNull()
})
