import {afterAll,it,expect} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db);
afterAll(async()=>{await app.close();await close()});const key=()=>crypto.randomUUID();
async function setup(){
 const address='NQ-recipes-'+key(),headers={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Recipes',fiatCurrency:'EUR',nimAddress:address}})).json();
 const base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload});
 const item=(await call('POST','/inventory',{name:'Coffee',unit:'MILLIGRAM',tracked:true,openingQuantity:100000,threshold:1000,reason:'Opening',idempotencyKey:key()})).json();
 const recipe=async(ingredients:any[],recipeId?:string)=>(await call('POST','/recipes',{name:'Espresso',ingredients,recipeId,reason:'Recipe version',idempotencyKey:key()}));
 return {base,call,item,recipe,headers};
}
it('versions exact recipes, rejects wrong dimensions and logical cycles, and isolates venue references',async()=>{
 const f=await setup(),other=await setup();
 const r=await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'18',unit:'g'}]);expect(r.statusCode).toBe(200);expect(r.json().requirements).toEqual([{itemId:f.item.id,quantity:18000}]);expect(r.json().costMinor).toBeNull();
 const nested=(await f.recipe([{kind:'RECIPE',recipeVersionId:r.json().id,quantity:2}])).json();expect(nested.requirements[0].quantity).toBe(36000);
 expect((await f.recipe([{kind:'RECIPE',recipeVersionId:nested.id,quantity:1}],r.json().recipeId)).json().error.code).toBe('RECIPE_CYCLE');
 expect((await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'1',unit:'ml'}])).json().error.code).toBe('RECIPE_UNIT_MISMATCH');
 expect((await other.recipe([{kind:'RECIPE',recipeVersionId:r.json().id,quantity:1}])).statusCode).toBe(400);
 const next=(await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'20',unit:'g'}],r.json().recipeId)).json();expect(next.version).toBe(2);
 const history=(await f.call('GET','/recipes')).json().items;expect(history.find((v:any)=>v.id===r.json().id).requirements[0].quantity).toBe(18000);
});
it('freezes recipe usage at checkout and never restores consumed ingredients on a refund',async()=>{
 const f=await setup(),r=(await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'18',unit:'g'}])).json();
 const product=(await f.call('POST','/catalog',{name:'Espresso',category:'Coffee',variants:[{id:key(),name:'Single',priceMinor:400,recipeVersionId:r.id}],extras:[]})).json();
 expect(product.variants[0].recipeVersionId).toBe(r.id);
 const employee=(await f.call('POST','/employees',{name:'Cashier',pin:'1234'})).json(),terminal=(await f.call('POST','/terminal')).json();
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token}`};
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier});
 app.deps.merchantPayments={quote:async i=>({...i,id:key(),network:'nimiq:5',amountAtomic:'400000',expiresAt:new Date(Date.now()+60000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'test'}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()}),refreshRefundQuote:async q=>q};
 const order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}})).json();
 expect(order.lines[0].recipeSnapshots[0]).toMatchObject({id:r.id,version:1,costMinor:null});
 const q=(await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-recipe-buyer-123'}})).json();
 const next=(await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'25',unit:'g'}],r.recipeId)).json();
 const updated=await f.call('POST','/catalog',{...product,variants:[{id:product.variants[0].id,name:'Single',priceMinor:400,recipeVersionId:next.id}],reason:'New recipe'});expect(updated.statusCode).toBe(200);
 const paid=await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/payment`,payload:{revision:1,quoteId:q.quote.id,hash:'a'.repeat(64)}});expect(paid.statusCode).toBe(200);
 expect((await f.call('GET','/inventory')).json().items[0].quantity).toBe(82000);
 expect(paid.json().lines[0].recipeSnapshots[0].version).toBe(1);
 const orderPath=`/v1/merchant/orders/${order.id}`;
 expect((await app.inject({method:'POST',url:orderPath+'/refund',headers:cashier,payload:{reason:'Customer request'}})).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:orderPath+'/refund/approve',headers:f.headers})).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:orderPath+'/refund/payment',headers:f.headers,payload:{hash:'b'.repeat(64)}})).json().status).toBe('REFUNDED');
 expect((await f.call('GET','/inventory')).json().items[0].quantity).toBe(82000);
});
it('freezes weighted receipt cost internally while hiding it from checkout and catalog readers',async()=>{
 const f=await setup();
 const portion=(await f.call('POST','/inventory',{name:'Milk portion',unit:'PORTION',tracked:true,openingQuantity:0,threshold:0,reason:'Empty start',idempotencyKey:key()})).json();
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Dairy',idempotencyKey:key()})).json();
 for(const unitCostMinor of [100,200]){
  const delivery=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:portion.id,expectedQuantity:2,unitCostMinor}],idempotencyKey:key()})).json();
  expect((await f.call('POST',`/inventory/deliveries/${delivery.id}/receipts`,{lines:[{itemId:portion.id,quantity:2}],reason:'Received',idempotencyKey:key()})).statusCode).toBe(200);
 }
 const recipe=(await f.recipe([{kind:'ITEM',itemId:portion.id,quantity:'1',unit:'portion'}])).json();
 const product=(await f.call('POST','/catalog',{name:'Milk',category:'Drinks',variants:[{id:key(),name:'Cup',priceMinor:400,recipeVersionId:recipe.id}],extras:[]})).json();
 const employee=(await f.call('POST','/employees',{name:'Cashier',pin:'1234'})).json(),terminal=(await f.call('POST','/terminal')).json();
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token}`};
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier});
 const response=await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}});
 expect(response.statusCode).toBe(201);expect(response.json().lines[0].recipeSnapshots[0].costMinor).toBeNull();
 const {merchantOrder}=await import('../src/db/schema'),{eq}=await import('drizzle-orm');
 const [stored]=await db.select().from(merchantOrder).where(eq(merchantOrder.id,response.json().id));
 expect(stored.lines[0].recipeSnapshots![0].costMinor).toBe('150');
 expect(stored.lines[0].recipeSnapshots![0].unitCosts![0]).toMatchObject({itemId:portion.id,numerator:'150',denominator:'1'});
 const catalog=(await f.call('GET','/catalog')).json();expect(catalog[0].variants[0].recipeSnapshot.costMinor).toBeNull();expect(catalog[0].variants[0].recipeSnapshot.unitCosts).toEqual([]);
});
it('holds recipe ingredients for remote payment and consumes its frozen version only at acceptance',async()=>{
 const {env}=await import('../src/env');env.remoteOrderingEnabled=true;
 const f=await setup(),recipe=(await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'18',unit:'g'}])).json();
 const product=(await f.call('POST','/catalog',{name:'Remote espresso',category:'Coffee',variants:[{id:key(),name:'Single',priceMinor:400,recipeVersionId:recipe.id}],extras:[]})).json();
 const employee=(await f.call('POST','/employees',{name:'Cashier',pin:'1234'})).json(),terminal=(await f.call('POST','/terminal')).json();
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token}`};
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier});
 const remoteBase='/v1/merchant/remote'+f.base.slice('/v1/merchant'.length);
 expect((await app.inject({method:'PATCH',url:remoteBase+'/settings',headers:f.headers,payload:{published:true,description:'Coffee',address:'Main 1',city:'Gliwice',pickupInstructions:'Counter',preparationMinutes:10}})).statusCode).toBe(200);
 await app.inject({method:'POST',url:remoteBase+'/heartbeat',headers:cashier});await app.inject({method:'PATCH',url:remoteBase+'/availability',headers:cashier,payload:{accepting:true}});
 const address='NQ-remote-recipe-buyer-123',customer={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`};
 app.deps.merchantPayments={quote:async i=>({...i,id:key(),network:'nimiq:5',amountAtomic:'400000',expiresAt:new Date(Date.now()+60000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'test'}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})};
 const created=await app.inject({method:'POST',url:remoteBase+'/orders',headers:{...customer,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}});expect(created.statusCode).toBe(201);const order=created.json();
 const q=await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,headers:customer,payload:{revision:1,asset:'NIM',sender:address}});expect(q.statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/payment`,headers:customer,payload:{revision:1,quoteId:q.json().quote.id,hash:'c'.repeat(64)}})).json().status).toBe('AWAITING_ACCEPTANCE');
 expect((await f.call('GET','/inventory')).json().items[0]).toMatchObject({quantity:100000,reservedQuantity:18000});
 const next=(await f.recipe([{kind:'ITEM',itemId:f.item.id,quantity:'25',unit:'g'}],recipe.recipeId)).json();
 expect((await f.call('POST','/catalog',{...product,variants:[{...product.variants[0],recipeVersionId:next.id}],reason:'Updated recipe'})).statusCode).toBe(200);
 const accepted=await app.inject({method:'POST',url:`/v1/merchant/remote/orders/${order.id}/accept`,headers:cashier,payload:{preparationMinutes:10}});expect(accepted.statusCode).toBe(200);
 expect((await f.call('GET','/inventory')).json().items[0]).toMatchObject({quantity:82000,reservedQuantity:0});
});

it('values milligram receipts from an exact total line cost and keeps fractional unit cost',async()=>{
 const f=await setup();
 await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-100000,revision:1,reason:'Empty stock before priced receipt',idempotencyKey:key()});
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Roaster',idempotencyKey:key()})).json();
 const delivery=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:1000000,totalCostMinor:2000}],idempotencyKey:key()})).json();
 expect((await f.call('POST',`/inventory/deliveries/${delivery.id}/receipts`,{lines:[{itemId:f.item.id,quantity:500000}],reason:'Half a kilogram',idempotencyKey:key()})).statusCode).toBe(200);
 const {recipeCostSnapshot}=await import('../src/services/inventoryCost');
 expect(await recipeCostSnapshot(db,f.item.venueId,[{itemId:f.item.id,quantity:18000}])).toMatchObject({costMinor:'36',unitCosts:[{itemId:f.item.id,numerator:'1',denominator:'500'}]});
});
