import {afterAll,it,expect} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
import {foodOperationalDate} from '@nimble/shared';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db);
afterAll(async()=>{await app.close();await close()});
const key=()=>crypto.randomUUID();
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-day-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Day close',fiatCurrency:'EUR',nimAddress:'NQ-day-123'}})).json();
 const base=`/v1/merchant/venues/${venue.id}`;
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload});
 const w={timeZone:'Europe/Warsaw',boundaryHour:4,date:foodOperationalDate(new Date(),'Europe/Warsaw',4)};
 const preview=async()=>(await call('GET','/day-closes/preview?'+new URLSearchParams({...w,boundaryHour:String(w.boundaryHour)}))).json();
 return {call,preview,w,headers,base};
}
it('requires explicit carry-forward, captures immutable cutoff and retries a close safely',async()=>{
 const f=await setup();
 const item=(await f.call('POST','/inventory',{name:'Cake',unit:'PIECE',tracked:true,openingQuantity:3,threshold:0,reason:'Start',idempotencyKey:key()})).json();
 const count=(await f.call('POST','/inventory/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).json();
 const p=await f.preview();expect(p.snapshot.issues).toMatchObject([{key:'STOCK:'+count.id,kind:'STOCK',status:'OPEN'}]);
 const payload={...f.w,note:'Closing the day',expectedFingerprint:p.fingerprint,carry:[],idempotencyKey:key()};
 expect((await f.call('POST','/day-closes',payload)).json().error.code).toBe('DAY_UNRESOLVED_ISSUES');
 payload.carry=p.snapshot.issues.map((i:any)=>({key:i.key,reason:'Continue tomorrow'}));
 const closed=await f.call('POST','/day-closes',payload);expect(closed.statusCode).toBe(200);
 expect((await f.call('POST','/day-closes',payload)).json()).toEqual(closed.json());
 expect((await f.call('POST','/day-closes',{...payload,idempotencyKey:key()})).json().error.code).toBe('DAY_ALREADY_CLOSED');
 await f.call('POST',`/inventory/stocktakes/${count.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:3}],reason:'Completed after cutoff',idempotencyKey:key()});
 const history=(await f.call('GET','/day-closes')).json();expect(history.items[0]).toEqual(closed.json());
 expect((await f.preview()).snapshot.issues).toHaveLength(0);
});
it('rejects a stale preview and foreign access, records owner exception and serializes duplicate day closes',async()=>{
 const f=await setup(),other=await setup(),before=await f.preview();
 await f.call('POST','/handovers',{note:'Continue unresolved matters',successorEmployeeId:null,idempotencyKey:key()});
 const payload={...f.w,note:'Close with exception',expectedFingerprint:before.fingerprint,carry:[],ownerExceptionReason:'Owner takes responsibility',idempotencyKey:key()};
 expect((await f.call('POST','/day-closes',payload)).json().error.code).toBe('DAY_PREVIEW_CHANGED');
 const current=await f.preview();
 const responses=await Promise.all([1,2].map(()=>f.call('POST','/day-closes',{...payload,expectedFingerprint:current.fingerprint,idempotencyKey:key()})));
 expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
 expect((await f.call('GET','/day-closes')).json().items).toHaveLength(1);
 expect((await app.inject({url:f.base+'/day-closes',headers:other.headers})).statusCode).toBe(404);
 expect((await f.call('GET','/day-closes/preview?timeZone=UTC&boundaryHour=0&date=2026-13-99')).statusCode).toBe(400);
});
