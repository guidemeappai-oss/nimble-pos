import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DayCloseBoard} from '../src/merchant/DayCloseBoard';
afterEach(cleanup);
const preview={date:'2026-10-16',timeZone:'UTC',boundaryHour:4,fingerprint:'a'.repeat(64),snapshot:{capturedAt:'2026-10-16T20:00:00Z',issues:[{key:'TASK:t',kind:'TASK',title:'Clean oven',status:'SUBMITTED'}],sales:[]}};
it('requires an explanation and retries an uncertain close with the same key',async()=>{
 const writes:any[]=[];
 const request=vi.fn(async(_auth:string,method:string,path:string,body:any)=>{if(method==='GET')return path.includes('preview')?preview:{items:[],hasMore:false};writes.push(body);if(writes.length===1)throw new Error('Lost response');return {...preview,id:'closed',venueId:'v',closedBy:'owner:o',note:body.note,carry:body.carry,ownerExceptionReason:null}});
 render(<DayCloseBoard api={{request} as never} venueId="v" scope="owner" owner/>);
 fireEvent.click(screen.getByRole('button',{name:'Review day closing'}));
 await screen.findByLabelText('Carry-forward reason TASK:t');
 fireEvent.change(screen.getByLabelText('Day closing note'),{target:{value:'Done for today'}});
 expect((screen.getByRole('button',{name:'Close operational day'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Carry-forward reason TASK:t'),{target:{value:'Owner reviews tomorrow'}});
 fireEvent.click(screen.getByRole('button',{name:'Close operational day'}));
 await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Close operational day'}));
 await waitFor(()=>expect(writes).toHaveLength(2));expect(writes[0]).toEqual(writes[1]);
 await screen.findByText('Clean oven · SUBMITTED: Owner reviews tomorrow');
});
it('clears the closing preview when the employee scope changes',async()=>{
 const request=vi.fn(async(_a:string,_m:string,p:string)=>p.includes('preview')?preview:{items:[],hasMore:false});
 const view=render(<DayCloseBoard api={{request} as never} venueId="v" scope="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'Review day closing'}));await screen.findByLabelText('Carry-forward reason TASK:t');
 view.rerender(<DayCloseBoard api={{request} as never} venueId="v" scope="bob"/>);
 expect(screen.queryByLabelText('Carry-forward reason TASK:t')).toBeNull();
});
