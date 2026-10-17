import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MenuScheduleBoard } from '../src/merchant/MenuScheduleBoard'
afterEach(cleanup)
it('saves a product window with explicit venue time zone and retry identity',async()=>{
 const calls: any[]=[]
 const request=vi.fn(async (_authority:string,method:string,_path:string,body:any)=>{if(method==='GET')return {revision:0,timezone:'Europe/Warsaw',rules:[]};calls.push(body);if(calls.length===1)throw new Error('Lost response');return {...body,revision:1}})
 const product={id:'00000000-0000-4000-8000-000000000001',name:'Coffee',category:'Drinks',available:true,variants:[{id:'v',name:'Cup',priceMinor:300}],extras:[]}
 render(<MenuScheduleBoard api={{request} as never} venueId="venue" scope="owner" products={[product]} />)
 fireEvent.change(await screen.findByLabelText('Scheduled product'),{target:{value:product.id}})
 fireEvent.click(screen.getByText('Add or replace availability rule'))
 fireEvent.change(screen.getByLabelText('Availability change reason'),{target:{value:'Morning coffee'}})
 fireEvent.click(screen.getByText('Save availability schedule'))
 await screen.findByRole('alert')
 fireEvent.click(screen.getByText('Save availability schedule'))
 await waitFor(()=>expect(calls).toHaveLength(2))
 expect(calls[0]).toEqual(calls[1])
 expect(calls[0]).toMatchObject({timezone:'Europe/Warsaw',rules:[{weekly:[{day:1,windows:[{start:'09:00',end:'17:00'}]}]}]})
})
