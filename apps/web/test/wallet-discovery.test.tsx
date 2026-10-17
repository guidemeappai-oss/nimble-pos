import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WalletDiscovery } from '../src/merchant/WalletDiscovery'
afterEach(cleanup)
it('shows deposits as separate observations and explicitly runs a next-page read',async()=>{
 const request=vi.fn(async(_a:string,method:string)=>method==='GET'?{states:[],items:[{id:'a',asset:'NIM',amountAtomic:'12345',confirmation:'OBSERVED',network:'nimiq:5',blockNumber:10,eventIndex:0,hash:'a'.repeat(64),sender:'Sender',recipient:'Venue',reportedOrderIds:[]}],hasMore:false}:{processed:1})
 render(<WalletDiscovery api={{request} as never} venueId="venue" scope="owner" />)
 expect(request).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Show wallet deposit monitoring'))
 await screen.findByText('No matching app submission found.')
 expect(screen.queryByText('Accept payment')).toBeNull()
 fireEvent.click(screen.getByText('Scan next history page'))
 await waitFor(()=>expect(request).toHaveBeenCalledWith('owner','POST','/venues/venue/wallet-discovery/scan',{asset:'NIM'}))
})
