import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ShiftHandover } from '../src/merchant/ShiftHandover'
afterEach(cleanup)
const saved = { id:'handover',venueId:'venue',shiftId:'shift',status:'PENDING',createdBy:{kind:'cashier',id:'ana',name:'Ana'},successorEmployeeId:null,note:'Check oven',createdAt:'2026-10-16T10:00:00Z',acknowledgedBy:null,acknowledgedAt:null,snapshot:{capturedAt:'2026-10-16T10:00:00Z',orders:[],refunds:[],shortages:[],tasks:[]} }
it('recovers an uncertain write with the same key and shows its recorded snapshot', async () => {
 const bodies: object[]=[]
 const request=vi.fn(async (_auth:string,method:string,_path:string,body:object)=>{if(method==='GET')return {items:[]};bodies.push(body);if(bodies.length===1)throw new Error('Connection lost');return saved})
 render(<ShiftHandover api={{request} as never} venueId="venue" scope="ana" employeeId="ana" />)
 fireEvent.change(await screen.findByLabelText('Handover note'),{target:{value:'Check oven'}})
 fireEvent.click(screen.getByText('Record handover snapshot'))
 await screen.findByRole('alert')
 fireEvent.click(screen.getByText('Retry same operation'))
 await screen.findByText('Pending acknowledgement')
 expect(bodies[0]).toEqual(bodies[1])
 expect(screen.getByText('Check oven')).toBeTruthy()
})
it('does not show a previous employee handover after switching scope',async()=>{
 let resolve: ((value:unknown)=>void)|undefined
 const request=vi.fn(async (_a:string,_m:string,path:string)=>path.includes('second')?new Promise(r=>{resolve=r}):{items:[saved]})
 const {rerender}=render(<ShiftHandover api={{request} as never} venueId="first" scope="ana" employeeId="ana" />)
 await screen.findByText('Check oven')
 rerender(<ShiftHandover api={{request} as never} venueId="second" scope="noah" employeeId="noah" />)
 await waitFor(()=>expect(screen.queryByText('Check oven')).toBeNull())
 resolve?.({items:[]})
})
