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
    return { owner, worker, base, order, shift, employee, terminal };
}
it('preserves a pending handover without a successor and freezes retries for owner audit', async () => {
 const {owner,worker,base,order,employee}=await setup();
 const payload={idempotencyKey:crypto.randomUUID(),note:'Oven waiting for repair',successorEmployeeId:null};
 const made=await app.inject({method:'POST',url:base+'/handovers',headers:worker,payload});
 expect(made.statusCode,made.body).toBe(200);
 expect(made.json()).toMatchObject({status:'PENDING',createdBy:{id:employee.id,name:'Ana'},snapshot:{orders:[{id:order.id}]}});
 expect((await app.inject({method:'POST',url:base+'/handovers',headers:worker,payload})).json()).toEqual(made.json());
 expect((await app.inject({url:base+'/handovers',headers:owner})).json().items).toEqual([made.json()]);
 expect((await app.inject({method:'POST',url:base+'/handovers/'+made.json().id+'/acknowledge',headers:worker,payload:{idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409);
});

it('lets the named successor acknowledge once and isolates venues', async () => {
 const f=await setup();
 const successor=(await app.inject({method:'POST',url:f.base+'/employees',headers:f.owner,payload:{name:'Noah',pin:'5678'}})).json();
 const created=await app.inject({method:'POST',url:f.base+'/handovers',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID(),note:'Please check the oven',successorEmployeeId:successor.id}});
 expect(created.statusCode).toBe(200);
 const path=f.base+'/handovers/'+created.json().id+'/acknowledge';
 expect((await app.inject({method:'POST',url:path,headers:f.owner,payload:{idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(403);
 const login=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':f.terminal.terminalToken},payload:{employeeId:successor.id,pin:'5678'}})).json();
 const headers={authorization:`Bearer ${login.token}`};
 expect((await app.inject({method:'POST',url:path,headers,payload:{idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409);
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers});
 const body={idempotencyKey:crypto.randomUUID()};
 const ack=await app.inject({method:'POST',url:path,headers,payload:body});
 expect(ack.statusCode,ack.body).toBe(200);
 expect(ack.json()).toMatchObject({status:'ACKNOWLEDGED',acknowledgedBy:{id:successor.id,name:'Noah'}});
 expect((await app.inject({method:'POST',url:path,headers,payload:body})).json()).toEqual(ack.json());
 const foreign=await setup();
 expect((await app.inject({url:f.base+'/handovers',headers:foreign.owner})).statusCode).toBe(404);
 const history=(await app.inject({url:f.base+'/handovers',headers:f.owner})).json();
 expect(history.items[0]).toMatchObject({createdBy:{name:'Ana'},acknowledgedBy:{name:'Noah'}});
});
