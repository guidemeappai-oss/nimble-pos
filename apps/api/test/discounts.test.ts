import { afterAll, expect, it } from 'vitest';
import { freshDb } from './helpers/db';
import { authedApp, makeUser } from './helpers/actors';
const { db, close } = await freshDb();
const { app, tokenFor } = authedApp(db);
afterAll(async () => { await app.close(); await close(); });
async function setup() {
    const owner = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-context-' + crypto.randomUUID()))}` };
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers: owner, payload: { name: 'Context cafe', fiatCurrency: 'EUR', nimAddress: 'NQ-context-owner' } })).json();
    const base = `/v1/merchant/venues/${venue.id}`;
    const employee = (await app.inject({ method: 'POST', url: base + '/employees', headers: owner, payload: { name: 'Ana', pin: '1234' } })).json();
    const terminal = (await app.inject({ method: 'POST', url: base + '/terminal', headers: owner })).json();
    const login = (await app.inject({ method: 'POST', url: '/v1/merchant/terminal/login', headers: { 'x-terminal-token': terminal.terminalToken }, payload: { employeeId: employee.id, pin: '1234' } })).json();
    const worker = { authorization: `Bearer ${login.token}` };
    const shift = (await app.inject({ method: 'POST', url: '/v1/merchant/shifts', headers: worker })).json();
    const product = (await app.inject({ method: 'POST', url: base + '/catalog', headers: owner, payload: { name: 'Tea', category: 'Drinks', variants: [{ id: crypto.randomUUID(), name: 'Cup', priceMinor: 300 }], extras: [] } })).json();
    const order = (await app.inject({ method: 'POST', url: '/v1/merchant/orders', headers: { ...worker, 'idempotency-key': crypto.randomUUID() }, payload: { lines: [{ productId: product.id, variantId: product.variants[0].id, quantity: 1, extraIds: [] }] } })).json();
    return { owner, worker, base, order, shift, employee };
}
it('requires independent approval above staff limits, freezes discounted snapshots and retries', async () => {
 const {owner,worker,base,order,employee}=await setup(),url=base+'/orders/'+order.id+'/discount';
 const body={revision:1,idempotencyKey:crypto.randomUUID(),kind:'PERCENT',value:1250,reason:'Customer service gesture'};
 const pending=await app.inject({method:'POST',url,headers:worker,payload:body});
 expect(pending.statusCode,pending.body).toBe(200);expect(pending.json()).toMatchObject({status:'PENDING',amountMinor:38});
 expect((await app.inject({method:'POST',url:'/v1/merchant/checkout/'+order.checkoutToken+'/quote',payload:{revision:1,asset:'NIM',sender:'NQ-customer'}})).json().error.code).toBe('DISCOUNT_APPROVAL_PENDING');
 expect((await app.inject({method:'POST',url:url+'/approve',headers:worker,payload:{idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(403);
 const approve={idempotencyKey:crypto.randomUUID()};
 const result=await app.inject({method:'POST',url:url+'/approve',headers:owner,payload:approve});expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({status:'APPLIED',amountMinor:38});
 expect((await app.inject({method:'POST',url:url+'/approve',headers:owner,payload:approve})).json()).toEqual(result.json());
 const checkout=(await app.inject({url:'/v1/merchant/checkout/'+order.checkoutToken})).json();expect(checkout.totalMinor).toBe(262);expect(checkout.revision).toBe(2);
 expect((await app.inject({method:'POST',url,headers:worker,payload:body})).json()).toEqual(pending.json());
 expect((await app.inject({method:'PATCH',url:'/v1/merchant/orders/'+order.id,headers:worker,payload:{revision:2,lines:checkout.lines.map((l:any)=>({productId:l.productId,variantId:l.variantId,quantity:l.quantity,extraIds:l.extraIds}))}})).statusCode).toBe(409);
});

it('auto-applies only an authorised employee discount within both owner limits', async () => {
 const f=await setup();
 const limitUrl=f.base+'/discount-limits/'+f.employee.id;
 expect((await app.inject({method:'PUT',url:limitUrl,headers:f.worker,payload:{maxBasisPoints:2000,maxMinor:100,reason:'Limit'}})).statusCode).toBe(403);
 expect((await app.inject({method:'PUT',url:limitUrl,headers:f.owner,payload:{maxBasisPoints:2000,maxMinor:100,reason:'Owner limit'}})).statusCode).toBe(200);
 await app.inject({method:'PATCH',url:'/v1/merchant/employees/'+f.employee.id,headers:f.owner,payload:{role:'MANAGER',permissions:['discounts.apply'],reason:'May apply small discounts'}});
 const body={revision:1,idempotencyKey:crypto.randomUUID(),kind:'FIXED',value:30,reason:'Small gesture'};
 const applied=await app.inject({method:'POST',url:f.base+'/orders/'+f.order.id+'/discount',headers:f.worker,payload:body});
 expect(applied.statusCode,applied.body).toBe(200);
 expect(applied.json()).toMatchObject({status:'APPLIED',amountMinor:30});
 expect((await app.inject({url:'/v1/merchant/checkout/'+f.order.checkoutToken})).json().totalMinor).toBe(270);
 expect((await app.inject({method:'POST',url:f.base+'/orders/'+f.order.id+'/discount',headers:f.worker,payload:{...body,idempotencyKey:crypto.randomUUID(),revision:2}})).statusCode).toBe(409);
});

it('applies the allowed percentage at a half-cent boundary without demanding an extra approval',async()=>{
 const f=await setup();
 await app.inject({method:'PUT',url:f.base+'/discount-limits/'+f.employee.id,headers:f.owner,payload:{maxBasisPoints:1250,maxMinor:38,reason:'Small service limit'}});
 await app.inject({method:'PATCH',url:'/v1/merchant/employees/'+f.employee.id,headers:f.owner,payload:{role:'MANAGER',permissions:['discounts.apply'],reason:'May discount'}});
 const result=await app.inject({method:'POST',url:f.base+'/orders/'+f.order.id+'/discount',headers:f.worker,payload:{revision:1,idempotencyKey:crypto.randomUUID(),kind:'PERCENT',value:1250,reason:'Twelve and a half percent'}});
 expect(result.statusCode).toBe(200);
 expect(result.json()).toMatchObject({status:'APPLIED',amountMinor:38});
})
