import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {VenueOperations} from '../src/merchant/VenueOperations'
import {MerchantApi} from '../src/merchant/client'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const data={updatedAt:'2026-10-16T10:00:00Z',window:{from:'2026-10-15T10:00:00Z',to:'2026-10-16T10:00:00Z'},fiatCurrency:'EUR',acceptedSalesMinor:'1200',receivedPayments:[{asset:'NIM',network:'NIMIQ',amountAtomic:'200000',count:1}],openOrderCount:3,delayedOrderCount:1,refundCount:2,orders:[],shifts:[],terminal:{state:'STALE',lastSeenAt:null},truncated:false}
it('retains last successful venue data and labels it stale after refresh fails',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 vi.spyOn(api,'request').mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('offline'))
 render(<VenueOperations api={api} venueId="a" scope="owner:a" onAction={()=>{}}/>)
 await screen.findByText('€12.00')
 fireEvent.click(screen.getByRole('button',{name:'Refresh situation'}))
 await screen.findByRole('alert')
 expect(screen.getByText('€12.00')).toBeTruthy()
 expect(screen.getByText(/Last successful update/)).toBeTruthy()
})
it('clears the previous venue immediately and ignores its late response',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 let old!:(value:unknown)=>void
 vi.spyOn(api,'request').mockImplementationOnce(()=>new Promise(resolve=>{old=resolve})).mockResolvedValue({...data,acceptedSalesMinor:'4500'})
 const view=render(<VenueOperations api={api} venueId="a" scope="owner:a" onAction={()=>{}}/>)
 view.rerender(<VenueOperations api={api} venueId="b" scope="owner:b" onAction={()=>{}}/>)
 await screen.findByText('€45.00')
 await act(async()=>old(data))
 expect(screen.queryByText('€12.00')).toBeNull()
 expect(screen.getByText('€45.00')).toBeTruthy()
})
it('shows a manager the situation without owner payment actions',async()=>{
 const api=new MerchantApi('',()=>'',()=>'',()=>null)
 const request=vi.spyOn(api,'request').mockResolvedValue(data)
 render(<VenueOperations api={api} venueId="a" scope="manager:a" cashier onAction={()=>{}}/>)
 await screen.findByText('€12.00')
 expect(request.mock.calls[0][0]).toBe('cashier')
 expect(screen.queryByRole('button',{name:'Resolve payment exceptions'})).toBeNull()
 expect(screen.queryByRole('button',{name:'Review refund approvals'})).toBeNull()
})
