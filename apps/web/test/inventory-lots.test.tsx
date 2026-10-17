import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {InventoryLotsBoard} from '../src/merchant/InventoryLotsBoard';
afterEach(cleanup);
const lot={id:'lot',label:'Old milk',quantity:5,source:'RECEIPT',expiresAt:'2020-01-01T00:00:00Z',receivedAt:null,expired:true};
it('shows expiry decisions and retries metadata corrections with the same operation key',async()=>{
 const writes:any[]=[];const request=vi.fn(async(_a:string,method:string,_path:string,body:any)=>{if(method==='GET')return {items:[lot],suggested:[],hasMore:false,page:0};writes.push(body);if(writes.length===1)throw new Error('Response lost');return lot});
 render(<InventoryLotsBoard api={{request} as never} venueId="venue" itemId="milk" scope="owner" owner manage revision={1}/>);
 await screen.findByText(/Expired — decision required/);expect(screen.getByText(/Expiry alerts do not remove stock/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Correct lot details'}));fireEvent.change(screen.getByLabelText('Lot label'),{target:{value:'Corrected milk'}});fireEvent.change(screen.getByLabelText('Correction reason'),{target:{value:'Correct printed batch'}});
 fireEvent.click(screen.getByRole('button',{name:'Save lot details'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Save lot details'}));await waitFor(()=>expect(writes).toHaveLength(2));expect(writes[1]).toEqual(writes[0]);
});
it('discards lot history when identity changes',async()=>{
 let alice=true;const api={request:vi.fn(async()=>({items:alice?[lot]:[],suggested:[],hasMore:false,page:0}))} as never;
 const props={api,venueId:'venue',itemId:'milk',owner:false,manage:false,revision:1};
 const view=render(<InventoryLotsBoard {...props} scope="alice"/>);await screen.findByText('Old milk');alice=false;view.rerender(<InventoryLotsBoard {...props} scope="bob"/>);expect(screen.queryByText('Old milk')).toBeNull();
});
