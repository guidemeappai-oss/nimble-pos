import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db),key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-purchase-'+key()))}`},venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Purchasing',fiatCurrency:'EUR',nimAddress:'NQ-purchase-123'}})).json(),base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload});const item=(await call('POST','/inventory',{name:'Milk',unit:'MILLILITRE',openingQuantity:2,threshold:5,tracked:true,reason:'Opening',idempotencyKey:key()})).json(),supplier=(await call('POST','/inventory/suppliers',{name:'Dairy',idempotencyKey:key()})).json();return {call,item,supplier,base,headers}}
it('explains low-stock suggestions, edits drafts and approves exactly one delivery with safe partial receipts',async()=>{
 const f=await setup();const suggestions=(await f.call('GET','/inventory/purchases/suggestions')).json();expect(suggestions.items[0]).toMatchObject({physicalQuantity:2,reservedQuantity:0,pendingLossQuantity:0,availableQuantity:2,threshold:5,targetQuantity:6,incomingQuantity:0,suggestedQuantity:4});
 const payload={supplierId:f.supplier.id,reference:'Weekly milk',lines:[{itemId:f.item.id,quantity:4}],reason:'Replenish milk',idempotencyKey:key()},draft=(await f.call('POST','/inventory/purchases',payload)).json();expect(draft.status).toBe('DRAFT');expect((await f.call('POST','/inventory/purchases',payload)).json()).toEqual(draft);
 const edited=(await f.call('POST',`/inventory/purchases/${draft.id}/draft`,{...payload,revision:1,lines:[{itemId:f.item.id,quantity:6}],idempotencyKey:key()})).json();expect(edited.revision).toBe(2);
 expect((await f.call('POST',`/inventory/purchases/${draft.id}/approve`,{revision:1,reason:'Stale approval',idempotencyKey:key()})).statusCode).toBe(409);
 const approval={revision:2,reason:'Approve six units',idempotencyKey:key()},responses=await Promise.all([f.call('POST',`/inventory/purchases/${draft.id}/approve`,approval),f.call('POST',`/inventory/purchases/${draft.id}/approve`,approval)]);expect(responses.map(r=>r.statusCode)).toEqual([200,200]);expect(responses[1].json()).toEqual(responses[0].json());const approved=responses[0].json();expect(approved.status).toBe('APPROVED');
 expect((await f.call('GET','/inventory/deliveries')).json().deliveries).toHaveLength(1);expect((await f.call('GET','/inventory')).json().items[0].quantity).toBe(2);
 expect((await f.call('POST',`/inventory/purchases/${draft.id}/approve`,{...approval,idempotencyKey:key()})).statusCode).toBe(409);expect((await f.call('POST',`/inventory/purchases/${draft.id}/draft`,{...payload,revision:3,idempotencyKey:key()})).statusCode).toBe(409);
 expect((await f.call('GET','/inventory/purchases/suggestions')).json().items[0]).toMatchObject({incomingQuantity:6,suggestedQuantity:0});
 const receipt={lines:[{itemId:f.item.id,quantity:2}],reason:'Two arrived',idempotencyKey:key()};const received=await f.call('POST',`/inventory/deliveries/${approved.deliveryId}/receipts`,receipt);expect(received.json().status).toBe('PARTIAL');expect((await f.call('POST',`/inventory/deliveries/${approved.deliveryId}/receipts`,receipt)).json()).toEqual(received.json());expect((await f.call('GET','/inventory')).json().items[0].quantity).toBe(4);
});
it('isolates venues, rejects foreign resources and suppliers and checks live management permission',async()=>{
 const a=await setup(),b=await setup(),payload={supplierId:a.supplier.id,lines:[{itemId:a.item.id,quantity:1}],reason:'Purchase milk',idempotencyKey:key()};
 expect((await a.call('POST','/inventory/purchases',{...payload,supplierId:b.supplier.id})).statusCode).toBe(404);expect((await a.call('POST','/inventory/purchases',{...payload,lines:[{itemId:b.item.id,quantity:1}]})).statusCode).toBe(404);
 const draft=(await a.call('POST','/inventory/purchases',payload)).json();expect((await b.call('POST',`/inventory/purchases/${draft.id}/approve`,{revision:1,reason:'Foreign draft',idempotencyKey:key()})).statusCode).toBe(404);
 const employee=(await a.call('POST','/employees',{name:'Cashier',pin:'1234'})).json(),terminal=(await a.call('POST','/terminal')).json(),token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token;
 expect((await app.inject({url:a.base+'/inventory/purchases',headers:{authorization:`Bearer ${token}`}})).statusCode).toBe(403);
});
it('includes live reservations and pending losses in the explained replenishment quantity',async()=>{
 const f=await setup(),variant=key();
 const product=(await f.call('POST','/catalog',{name:'Milk cup',category:'Drinks',variants:[{id:variant,name:'Cup',priceMinor:100,stockBindings:[{itemId:f.item.id,quantity:1}]}],extras:[]})).json();
 const employee=(await f.call('POST','/employees',{name:'Manager',pin:'1234'})).json();await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers:f.headers,payload:{role:'MANAGER',permissions:['inventory.manage'],reason:'Stock management'}});
 const terminal=(await f.call('POST','/terminal')).json(),token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token,headers={authorization:`Bearer ${token}`};
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers});
 app.deps.merchantPayments={quote:async i=>({...i,id:key(),network:'nimiq:5',amountAtomic:'100000',expiresAt:new Date(Date.now()+60000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'test'}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})};
 const order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...headers,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:variant,extraIds:[],quantity:1}]}})).json();
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-purchasing-buyer'}})).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:f.base+'/inventory/losses',headers,payload:{itemId:f.item.id,quantity:1,reason:'DAMAGED',comment:'Pending damaged milk',idempotencyKey:key()}})).json().status).toBe('PENDING');
 const suggestion=(await f.call('GET','/inventory/purchases/suggestions')).json().items[0];expect(suggestion).toMatchObject({physicalQuantity:2,reservedQuantity:1,pendingLossQuantity:1,availableQuantity:0,targetQuantity:6,suggestedQuantity:6});
});
