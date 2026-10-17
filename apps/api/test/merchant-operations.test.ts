import {eq} from 'drizzle-orm';
import * as s from '../src/db/schema';
import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(); const {app,tokenFor}=authedApp(db);
afterAll(async()=>{await app.close();await close()});
it('owner gets explicit operations window, unknown presence and empty exception page without credentials',async()=>{
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-ops-'+crypto.randomUUID()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Cafe',fiatCurrency:'EUR',nimAddress:'NQ-owner-ops'}})).json();
 const base=`/v1/merchant/venues/${venue.id}`;
 const r=await app.inject({url:base+'/operations',headers});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({acceptedSalesMinor:'0',openOrderCount:0,terminal:{state:'UNKNOWN',lastSeenAt:null}});expect(Date.parse(r.json().window.to)-Date.parse(r.json().window.from)).toBe(86400000);
 expect((await app.inject({url:base+'/payment-exceptions',headers})).json().items).toEqual([]);
 expect((await app.inject({url:base+'/operations'})).statusCode).toBe(401);
});
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-ops-'+crypto.randomUUID()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Cafe',fiatCurrency:'EUR',nimAddress:'NQ-owner-ops'}})).json(); const base=`/v1/merchant/venues/${venue.id}`;
 const employee=(await app.inject({method:'POST',url:base+'/employees',headers,payload:{name:'Ana',pin:'1234'}})).json();const terminal=(await app.inject({method:'POST',url:base+'/terminal',headers})).json();const login=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json();return {headers,venue,base,employee,worker:{authorization:`Bearer ${login.token}`}};
}
it('dashboard permission is live, session polling records terminal presence and exception actions remain owner only',async()=>{
 const {headers,base,employee,worker}=await setup();
 expect((await app.inject({url:base+'/operations',headers:worker})).statusCode).toBe(403);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:['reports.view'],reason:'View operations'}});
 expect((await app.inject({url:base+'/operations',headers:worker})).statusCode).toBe(200);
 await app.inject({url:'/v1/merchant/session',headers:worker});
 expect((await app.inject({url:base+'/operations',headers})).json().terminal.state).toBe('ACTIVE');
 await db.update(s.merchantTerminal).set({lastSeenAt:new Date(Date.now()-61000)}).where(eq(s.merchantTerminal.venueId,base.split('/')[4]));
 expect((await app.inject({url:base+'/operations',headers})).json().terminal.state).toBe('STALE');

 expect((await app.inject({url:base+'/payment-exceptions',headers:worker})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:base+'/orders/'+crypto.randomUUID()+'/recheck',headers:worker,payload:{reason:'Check now',idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(403);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:[],reason:'Remove reports'}});
 expect((await app.inject({url:base+'/operations',headers:worker})).statusCode).toBe(403);
 const other=await setup();expect((await app.inject({url:base+'/operations',headers:other.headers})).statusCode).toBe(404);
});
it('recheck keeps an unknown hash unverified, persists safe diagnostics, and replays without spending another rate slot',async()=>{
 const {headers,base,worker}=await setup();await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:worker});
 const p=(await app.inject({method:'POST',url:base+'/catalog',headers,payload:{name:'Tea',category:'Drinks',variants:[{id:crypto.randomUUID(),name:'Cup',priceMinor:300}],extras:[]}})).json();
 let checks=0;app.deps.merchantPayments={quote:async input=>({...input,id:crypto.randomUUID(),network:'nimiq:5',amountAtomic:'1234',rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async()=>{checks++;return null}};
 const o=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...worker,'idempotency-key':crypto.randomUUID()},payload:{lines:[{productId:p.id,variantId:p.variants[0].id,extraIds:[],quantity:1}]}})).json();const checkout='/v1/merchant/checkout/'+o.checkoutToken;
 const quote=(await app.inject({method:'POST',url:checkout+'/quote',payload:{revision:1,asset:'NIM',sender:'NQ-customer'}})).json().quote;
 await app.inject({method:'POST',url:checkout+'/payment',payload:{revision:1,quoteId:quote.id,hash:'a'.repeat(64)}});
 const payload={reason:'Owner checks pending payment',idempotencyKey:crypto.randomUUID()},url=base+'/orders/'+o.id+'/recheck';
 const checked=await app.inject({method:'POST',url,headers,payload});expect(checked.statusCode,checked.body).toBe(200);expect(checked.json()).toMatchObject({state:'COMPLETE',outcome:'UNVERIFIED'});const count=checks;
 expect((await app.inject({method:'POST',url,headers,payload})).json()).toEqual(checked.json());expect(checks).toBe(count);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,reason:'Another reason'}})).statusCode).toBe(409);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(429);
 const list=(await app.inject({url:base+'/payment-exceptions?asset=NIM&kind=UNVERIFIED',headers})).json();expect(list.items).toHaveLength(1);expect(list.items[0].attempts[0]).toMatchObject({verification:'UNVERIFIED',verificationCode:'UNVERIFIED'});expect(list.items[0].attempts[0].lastCheckedAt).toBeTruthy();expect(JSON.stringify(list)).not.toContain(o.checkoutToken);
 expect((await app.inject({url:base+'/payment-exceptions?asset=USDT',headers})).json().items).toEqual([]);
 const other=await setup();expect((await app.inject({url:other.base+'/payment-exceptions?asset=NIM',headers:other.headers})).json().items).toEqual([]);

 expect((await app.inject({url:base+'/payment-exceptions?minAgeMinutes=60',headers})).json().items).toEqual([]);
 await db.update(s.merchantOperation).set({result:null,leaseUntil:new Date(Date.now()+60000)}).where(eq(s.merchantOperation.id,checked.json().operationId));
 expect((await app.inject({method:'POST',url,headers,payload})).json().state).toBe('PENDING');expect(checks).toBe(count);
 await db.update(s.merchantOperation).set({result:null,leaseUntil:new Date(Date.now()-1000)}).where(eq(s.merchantOperation.id,checked.json().operationId));
 const recovered=await app.inject({method:'POST',url,headers,payload});expect(recovered.statusCode).toBe(200);expect(recovered.json().state).toBe('COMPLETE');expect(recovered.json().operationId).toBe(checked.json().operationId);expect(checks).toBeGreaterThan(count);
 await db.update(s.merchantOperation).set({result:null,leaseUntil:new Date(Date.now()-1000)}).where(eq(s.merchantOperation.id,checked.json().operationId));
 app.deps.merchantPayments.verify=async()=>{await db.update(s.merchantOperation).set({leaseToken:crypto.randomUUID(),leaseUntil:new Date(Date.now()+60000)}).where(eq(s.merchantOperation.id,checked.json().operationId));return null};
 expect((await app.inject({method:'POST',url,headers,payload})).json().state).toBe('PENDING');
 expect((await app.inject({method:'POST',url,headers,payload})).json().state).toBe('PENDING');


});
it('counts received atomic payments separately from accepted snapshot sales at their actual event time',async()=>{
 const {headers,base,venue}=await setup(),now=new Date(),old=new Date(now.getTime()-172800000);
 for(const [accepted,oldPayment,snapshot,amount] of [[true,false,500,'1000'],[false,false,900,'2000'],[true,true,700,'3000']] as const){
 const hash=crypto.randomUUID(),payment={asset:'NIM' as const,network:'nimiq:5',amountAtomic:amount,sender:'NQ-customer',recipient:'NQ-owner',hash,confirmedAt:(oldPayment?old:now).toISOString()};
 const [o]=await db.insert(s.merchantOrder).values({venueId:venue.id,number:accepted?(oldPayment?3:1):2,source:'REMOTE',status:accepted?'PREPARING':'REFUND_PENDING',fiatCurrency:'EUR',totalMinor:9999,lines:[],checkoutToken:crypto.randomUUID(),requestKey:crypto.randomUUID(),requestHash:'fixture',payment,paymentSnapshot:{revision:1,lines:[],totalMinor:snapshot},paymentRequiresRefund:!accepted,decision:accepted?'ACCEPTED':'REJECTED',decisionAt:oldPayment?old:now,createdAt:old}).returning();
 await db.insert(s.merchantVerifiedTransaction).values({orderId:o.id,purpose:'PAYMENT',network:payment.network,hash,receipt:payment});
 if(!accepted) await db.insert(s.merchantRefund).values({orderId:o.id,status:'CONFIRMED'});
 }
 const r=(await app.inject({url:base+'/operations',headers})).json();expect(r.acceptedSalesMinor).toBe('500');expect(r.receivedPayments).toEqual([{asset:'NIM',network:'nimiq:5',amountAtomic:'3000',count:2}]);expect(r.refundCount).toBe(1);expect(r.openOrderCount).toBe(2);
 const report=(await app.inject({url:base+'/report',headers})).json();expect(report.totals).toMatchObject({grossMinor:1200,netMinor:1200,refunded:1,refundedMinor:900,assets:{NIM:'4000',USDT:'0'}});

});
