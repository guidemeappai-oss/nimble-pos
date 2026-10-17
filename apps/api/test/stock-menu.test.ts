import {afterAll,it,expect} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db);const key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-stock-menu-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Stock menu',fiatCurrency:'EUR',nimAddress:'NQ-stock-menu-123'}})).json();
 const base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload});
 const raw=(await call('POST','/inventory',{name:'Beans',unit:'MILLIGRAM',tracked:true,openingQuantity:18000,threshold:0,reason:'Opening',idempotencyKey:key()})).json();
 const recipe=(await call('POST','/recipes',{name:'Single espresso',ingredients:[{kind:'ITEM',itemId:raw.id,quantity:'18',unit:'g'}],reason:'Recipe',idempotencyKey:key()})).json();
 const double=(await call('POST','/recipes',{name:'Double espresso',ingredients:[{kind:'RECIPE',recipeVersionId:recipe.id,quantity:2}],reason:'Recipe',idempotencyKey:key()})).json();
 const milk=(await call('POST','/inventory',{name:'Milk',unit:'MILLILITRE',tracked:true,openingQuantity:0,threshold:0,reason:'Opening',idempotencyKey:key()})).json();
 const product=(await call('POST','/catalog',{name:'Coffee',category:'Drinks',variants:[{id:key(),name:'Small',priceMinor:300,recipeVersionId:recipe.id},{id:key(),name:'Large',priceMinor:500,recipeVersionId:double.id}],extras:[{id:key(),name:'Milk',priceMinor:50,available:true,stockBindings:[{itemId:milk.id,quantity:50}]}]})).json();
 const patch=async(available:boolean)=>{const row=(await call('GET','/inventory')).json().items.find((i:any)=>i.id===raw.id);return call('PATCH',`/inventory/${raw.id}`,{name:raw.name,tracked:true,threshold:0,available,revision:row.revision,reason:'Ingredient decision'})};
 return {headers,venue,base,call,raw,milk,recipe,product,patch};
}
it('shows dependent variants and bundles and restores stock without overriding a schedule or manual block',async()=>{
 const f=await setup();
 const bundle=(await f.call('POST','/catalog',{name:'Two coffees',category:'Offers',components:[{productId:f.product.id,variantId:f.product.variants[0].id,quantity:2}],variants:[{id:key(),name:'Pair',priceMinor:500}],extras:[]})).json();
 let catalog=(await f.call('GET','/catalog')).json();expect(catalog.find((p:any)=>p.id===f.product.id).extras[0].available).toBe(false);expect(catalog.find((p:any)=>p.id===f.product.id).variants.map((v:any)=>v.name)).toEqual(['Small']);expect(catalog.find((p:any)=>p.id===bundle.id).available).toBe(false);
 const impact=(await f.call('GET','/inventory/availability-impact')).json();expect(impact.options.map((i:any)=>i.optionName)).toEqual(expect.arrayContaining(['Large','Pair','Milk']));
 await f.call('POST',`/inventory/${f.raw.id}/movements`,{delta:18000,revision:1,reason:'Additional beans',idempotencyKey:key()});
 catalog=(await f.call('GET','/catalog')).json();expect(catalog.find((p:any)=>p.id===bundle.id).available).toBe(true);
 expect((await f.patch(false)).statusCode).toBe(200);expect((await f.call('GET','/catalog')).json().every((p:any)=>!p.available)).toBe(true);
 await f.call('POST',`/inventory/${f.raw.id}/movements`,{delta:18000,revision:3,reason:'Delivery does not clear manual block',idempotencyKey:key()});
 expect((await f.call('GET','/catalog')).json().every((p:any)=>!p.available)).toBe(true);
 await f.call('PUT','/menu/schedule',{revision:0,timezone:'UTC',rules:[{productId:f.product.id,kind:'product',weekly:[],exceptions:[],disabledUntil:'2099-01-01T00:00:00Z'}],reason:'Scheduled stop',idempotencyKey:key()});
 await f.patch(true);catalog=(await f.call('GET','/catalog')).json();expect(catalog.find((p:any)=>p.id===f.product.id).available).toBe(false);expect(catalog.find((p:any)=>p.id===bundle.id).available).toBe(false);
});
it('preserves a prior reservation, blocks new quotes, and creates a single owner refund obligation for affected accepted work',async()=>{
 const f=await setup();
 const employee=(await f.call('POST','/employees',{name:'Cashier',pin:'1234'})).json(),terminal=(await f.call('POST','/terminal')).json();
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token}`};
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier});
 app.deps.merchantPayments={quote:async i=>({...i,id:key(),network:'nimiq:5',amountAtomic:'300000',expiresAt:new Date(Date.now()+60000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'test'}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})};
 const create=async()=>(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:f.product.id,variantId:f.product.variants[0].id,extraIds:[],quantity:1}]}})).json();
 const order=await create(),other=await create(),payload={revision:1,asset:'NIM',sender:'NQ-stock-menu-buyer'};
 const q=(await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload})).json();
 await f.patch(false);
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload})).json().quote.id).toBe(q.quote.id);
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${other.checkoutToken}/quote`,payload})).json().error.code).toBe('INSUFFICIENT_STOCK');
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/payment`,payload:{revision:1,quoteId:q.quote.id,hash:'f'.repeat(64)}})).json().status).toBe('PREPARING');
 const impact=(await f.call('GET','/inventory/availability-impact')).json();expect(impact.orders[0]).toMatchObject({id:order.id,blockedItemIds:[f.raw.id]});
 const decision={reason:'Blocked ingredient cannot be used',idempotencyKey:key()};
 const path=`/inventory/availability-impact/orders/${order.id}/refund`;
 const rejected=await app.inject({method:'POST',url:f.base+path,headers:cashier,payload:decision});expect(rejected.statusCode).toBe(403);
 const results=await Promise.all([f.call('POST',path,decision),f.call('POST',path,decision)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect(results[0].json()).toEqual(results[1].json());
 const {merchantRefund}=await import('../src/db/schema'),{eq}=await import('drizzle-orm');
 const refunds=await db.select().from(merchantRefund).where(eq(merchantRefund.orderId,order.id));expect(refunds).toHaveLength(1);expect(refunds[0]).toMatchObject({status:'REQUESTED',quote:null,pendingHash:null});
 expect((await f.call('GET','/inventory')).json().items[0].quantity).toBe(0);
 expect((await f.call('GET','/inventory/availability-impact')).json().orders).toHaveLength(0);
});

it('keeps a complete alternative recipe selectable when the base ingredient is missing',async()=>{
 const f=await setup();
 const oat=(await f.call('POST','/inventory',{name:'Oat drink',unit:'MILLILITRE',tracked:true,openingQuantity:1000,threshold:0,reason:'Opening',idempotencyKey:key()})).json();
 const make=async(name:string,itemId:string,quantity:string)=>(await f.call('POST','/recipes',{name,ingredients:[{kind:'ITEM',itemId,quantity,unit:'ml'}],reason:'Alternative recipe',idempotencyKey:key()})).json();
 const milkRecipe=await make('Milk cup',f.milk.id,'150'),oatRecipe=await make('Oat cup',oat.id,'180');
 const product=(await f.call('POST','/catalog',{name:'Milk drink',category:'Drinks',variants:[{id:key(),name:'Cup',priceMinor:300,recipeVersionId:milkRecipe.id}],extras:[{id:key(),name:'Oat alternative',priceMinor:50,available:true,recipeVersionId:oatRecipe.id,replacesBaseRecipe:true}]})).json();
 const effective=(await f.call('GET','/catalog')).json().find((p:any)=>p.id===product.id);
 expect(effective.available).toBe(true);expect(effective.variants[0].requiresRecipeReplacement).toBe(true);expect(effective.extras[0].available).toBe(true);
});
