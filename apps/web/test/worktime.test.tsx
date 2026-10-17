import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkTimeBoard } from '../src/merchant/WorkTimeBoard'
afterEach(cleanup)
it('lets a worker finish during a break and retry the same uncertain write',async()=>{
 const record={id:'record',venueId:'venue',employeeId:'ana',startedAt:'2026-10-16T09:00:00Z',endedAt:null,status:'PAUSED',breaks:[{startedAt:'2026-10-16T10:00:00Z',endedAt:null}],revision:2}
 const calls:any[]=[]
 let finished=false
 const request=vi.fn(async (_a:string,method:string,path:string,body:any)=>{
  if(method==='GET')return {items:[finished?{...record,status:'FINISHED',endedAt:'2026-10-16T10:10:00Z'}:record],corrections:[],hasMore:false}
  calls.push({path,body});if(calls.length===1)throw new Error('Lost response');finished=true;return {...record,status:'FINISHED',endedAt:'2026-10-16T10:10:00Z'}
 })
 render(<WorkTimeBoard api={{request} as never} venueId="venue" scope="ana" employeeId="ana" />)
 fireEvent.click(await screen.findByText('Finish work'))
 await screen.findByRole('alert')
 fireEvent.click(screen.getByText('Retry recorded intent'))
 await screen.findByText('Work time operation recorded.')
 expect(calls[0]).toEqual(calls[1])
 expect(calls[0].path).toContain('/finish')
})
it('clears the previous employee view while the next account is loading',async()=>{
 let resolve:((v:unknown)=>void)|undefined
 const request=vi.fn(async (_a:string,_m:string,path:string)=>path.includes('/first/')?{items:[{id:'r',employeeId:'ana',startedAt:'2026-10-16T09:00:00Z',endedAt:null,status:'WORKING',breaks:[]}],corrections:[],hasMore:false}:new Promise(r=>{resolve=r}))
 const {rerender}=render(<WorkTimeBoard api={{request} as never} venueId="first" scope="ana" employeeId="ana" />)
 await screen.findByText('Working')
 rerender(<WorkTimeBoard api={{request} as never} venueId="second" scope="noah" employeeId="noah" />)
 await waitFor(()=>expect(screen.queryByText('Working')).toBeNull())
 expect(screen.queryByText('Start work')).toBeNull()
 resolve?.({items:[],corrections:[],hasMore:false})
})
