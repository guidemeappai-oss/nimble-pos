import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {StrictMode} from 'react'
import {OrderContextPanel,useOrderContextQueue} from '../src/merchant/OrderContext'
import {MerchantApi} from '../src/merchant/client'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const summary={orderId:'o',revision:0,priority:'NORMAL',delayReason:null}
const data={summary,entries:[{id:'old',kind:'NOTE',text:'Keep warm',actor:{kind:'cashier',id:'e',name:'Ana'},createdAt:'2026-10-16T10:00:00Z'}],hasMore:true}
it('shows internal author history and retries an uncertain note with the identical intent',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 const request=vi.spyOn(api,'request').mockImplementation(async(_a,method)=>{if(method==='GET')return data;throw new Error('offline')})
 render(<OrderContextPanel api={api} venueId="v" orderId="o" scope="cashier:a" canWrite/> )
 fireEvent.click(screen.getByRole('button',{name:'Internal order context'}))
 await screen.findByText('Keep warm');expect(screen.getByText(/Ana/)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Internal note or reason'),{target:{value:'No lid please'}})
 fireEvent.click(screen.getByRole('button',{name:'Save internal context'}))
 await screen.findByRole('alert')
 fireEvent.click(screen.getByRole('button',{name:'Retry same entry'}))
 await waitFor(()=>expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(2))
 const posts=request.mock.calls.filter(c=>c[1]==='POST');expect(posts[0][3]).toEqual(posts[1][3])
 expect(posts[0][3]).toMatchObject({revision:0,kind:'NOTE',text:'No lid please'})
})
it('records a delay reason and navigates older history without changing the note draft',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 const request=vi.spyOn(api,'request').mockImplementation(async(_a,method,path,body)=>method==='POST'?{summary:{...summary,revision:1,delayReason:'Machine warming'},entry:{}}:path.includes('page=1')?{...data,entries:[{...data.entries[0],id:'older',text:'Original request'}],hasMore:false}:data)
 render(<OrderContextPanel api={api} venueId="v" orderId="o" scope="owner:a" owner canWrite/> )
 fireEvent.click(screen.getByRole('button',{name:'Internal order context'}));await screen.findByText('Keep warm')
 fireEvent.click(screen.getByRole('button',{name:'Older entries'}));await screen.findByText('Original request')
 fireEvent.change(screen.getByLabelText('Entry type'),{target:{value:'DELAY'}})
 fireEvent.change(screen.getByLabelText('Internal note or reason'),{target:{value:'Machine warming'}})
 fireEvent.click(screen.getByRole('button',{name:'Save internal context'}))
 await waitFor(()=>expect(request.mock.calls.find(c=>c[1]==='POST')?.[3]).toMatchObject({kind:'DELAY',text:'Machine warming',revision:0}))
 expect(request.mock.calls.find(c=>c[1]==='POST')?.[0]).toBe('owner')
})
it('requires a fresh decision after a revision conflict while retaining the draft',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 const request=vi.spyOn(api,'request').mockImplementation(async(_a,method)=>{if(method==='GET')return {...data,summary:{...summary,revision:3}};throw {code:'ORDER_CONTEXT_CONFLICT',message:'conflict'}})
 render(<OrderContextPanel api={api} venueId="v" orderId="o" scope="a" canWrite/> )
 fireEvent.click(screen.getByRole('button',{name:'Internal order context'}));await screen.findByText('Keep warm')
 fireEvent.change(screen.getByLabelText('Internal note or reason'),{target:{value:'Keep ice separate'}})
 fireEvent.click(screen.getByRole('button',{name:'Save internal context'}));await screen.findByText(/Context changed/)
 expect((screen.getByLabelText('Internal note or reason') as HTMLTextAreaElement).value).toBe('Keep ice separate')
 expect(screen.queryByRole('button',{name:'Retry same entry'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Save internal context'}));await waitFor(()=>expect(request.mock.calls.filter(c=>c[1]==='POST')).toHaveLength(2))
 const posts=request.mock.calls.filter(c=>c[1]==='POST');expect((posts[0][3] as any).idempotencyKey).not.toBe((posts[1][3] as any).idempotencyKey)
})
it('closes and clears internal history when the cashier profile changes, ignoring late history',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null);let resolve!:(value:unknown)=>void
 vi.spyOn(api,'request').mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue({...data,entries:[]})
 const view=render(<OrderContextPanel api={api} venueId="v" orderId="o" scope="cashier:a" canWrite/> )
 fireEvent.click(screen.getByRole('button',{name:'Internal order context'}))
 view.rerender(<OrderContextPanel api={api} venueId="v" orderId="o" scope="cashier:b" canWrite={false}/> )
 await act(async()=>resolve(data));expect(screen.queryByText('Keep warm')).toBeNull()
 expect(screen.getByRole('button',{name:'Internal order context'}).getAttribute('aria-expanded')).toBe('false')
 fireEvent.click(screen.getByRole('button',{name:'Internal order context'}));await screen.findByText('No internal entries yet.')
 expect((screen.getByRole('button',{name:'Save internal context'}) as HTMLButtonElement).disabled).toBe(true)
})
it('shows high priority first, preserves order inside groups, and loads under StrictMode',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 vi.spyOn(api,'request').mockResolvedValue({items:[{...summary,orderId:'a'},{...summary,orderId:'b',priority:'HIGH'},{...summary,orderId:'c',priority:'HIGH'}]})
 function Queue(){const context=useOrderContextQueue(api,'v','token',[{id:'a'},{id:'b'},{id:'c'}]);return <ol>{context.orders.map(o=><li key={o.id}>{o.id}</li>)}</ol>}
 render(<StrictMode><Queue/></StrictMode>)
 await waitFor(()=>expect(screen.getAllByRole('listitem').map(e=>e.textContent)).toEqual(['b','c','a']))
})
it('batches more than 50 summaries and ignores a previous profile response',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null);let resolve!:(value:unknown)=>void
 const request=vi.spyOn(api,'request').mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue({items:[]})
 const orders=Array.from({length:51},(_,i)=>({id:`o${i}`}))
 function Queue({scope}:{scope:string}){const data=useOrderContextQueue(api,'v',scope,orders);return <ol>{data.orders.map(o=><li key={o.id}>{o.id}</li>)}</ol>}
 const view=render(<Queue scope="a"/>);view.rerender(<Queue scope="b"/>)
 await waitFor(()=>expect(request.mock.calls).toHaveLength(3))
 await act(async()=>resolve({items:[{...summary,orderId:'o50',priority:'HIGH'}]}))
 expect(screen.getAllByRole('listitem')[0].textContent).toBe('o0')
 expect(request.mock.calls.every(c=>c[2].split('orderIds=')[1].split(',').length<=50)).toBe(true)
})
