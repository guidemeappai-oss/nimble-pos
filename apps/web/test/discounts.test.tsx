import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DiscountPanel } from '../src/merchant/DiscountPanel'
afterEach(cleanup)
const order={id:'order',revision:1,status:'AWAITING_PAYMENT',fiatCurrency:'EUR',totalMinor:300,lines:[]}
it('retries an uncertain discount request with the original intent', async()=>{
 const requests:object[]=[]
 const request=vi.fn(async (_authority:string,method:string,_path:string,body:object)=>{if(method==='GET')return null;requests.push(body);if(requests.length===1)throw new Error('Lost response');return {status:'PENDING',amountMinor:30,reason:'Customer service'}})
 render(<DiscountPanel api={{request} as never} venueId="venue" order={order as never} scope="cashier" />)
 fireEvent.click(screen.getByText('Rabaty i zgody'))
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(1))
 fireEvent.change(screen.getByLabelText('Wartość'),{target:{value:'10'}})
 fireEvent.change(screen.getByLabelText('Powód rabatu'),{target:{value:'Customer service'}})
 fireEvent.click(screen.getByText('Zapisz rabat lub wniosek'))
 await screen.findByRole('alert')
 fireEvent.click(screen.getByText('Ponów ten sam zapis'))
 await waitFor(()=>expect(requests).toHaveLength(2))
 expect(requests[1]).toEqual(requests[0])
})
it('offers owner approval for a pending discount',async()=>{
 const request=vi.fn(async (_authority:string,method:string)=>method==='GET'?{status:'PENDING',amountMinor:38,reason:'Gesture'}:{status:'APPLIED',amountMinor:38,reason:'Gesture'})
 const employees=vi.fn(async()=>[])
 render(<DiscountPanel api={{request,employees} as never} venueId="venue" order={order as never} scope="owner" owner />)
 fireEvent.click(screen.getByText('Rabaty i zgody'))
 fireEvent.click(await screen.findByText('Zatwierdź rabat'))
 await waitFor(()=>expect(request).toHaveBeenCalledWith('owner','POST','/venues/venue/orders/order/discount/approve',expect.objectContaining({idempotencyKey:expect.any(String)})))
})
