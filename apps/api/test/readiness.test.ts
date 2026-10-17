import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { afterAll, expect, it } from 'vitest';
import { freshDb } from './helpers/db';
import { authedApp, makeUser } from './helpers/actors';
const { db, close } = await freshDb();
const { app, tokenFor } = authedApp(db);
afterAll(async () => { await app.close(); await close(); });
async function setup(tracked=false) {
    const owner = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-context-' + crypto.randomUUID()))}` };
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers: owner, payload: { name: 'Context cafe', fiatCurrency: 'EUR', nimAddress: 'NQ-context-owner' } })).json();
    const base = `/v1/merchant/venues/${venue.id}`;
    const employee = (await app.inject({ method: 'POST', url: base + '/employees', headers: owner, payload: { name: 'Ana', pin: '1234' } })).json();
    const terminal = (await app.inject({ method: 'POST', url: base + '/terminal', headers: owner })).json();
    const login = (await app.inject({ method: 'POST', url: '/v1/merchant/terminal/login', headers: { 'x-terminal-token': terminal.terminalToken }, payload: { employeeId: employee.id, pin: '1234' } })).json();
    const worker = { authorization: `Bearer ${login.token}` };
    const shift = (await app.inject({ method: 'POST', url: '/v1/merchant/shifts', headers: worker })).json();
    const item=tracked?(await app.inject({method:'POST',url:base+'/inventory',headers:owner,payload:{name:'Tea portions',unit:'PORTION',tracked:true,openingQuantity:10,threshold:0,reason:'Opening',idempotencyKey:crypto.randomUUID()}})).json():null;
    const product = (await app.inject({ method: 'POST', url: base + '/catalog', headers: owner, payload: { name: 'Tea', category: 'Drinks', variants: [{ id: crypto.randomUUID(), name: 'Cup', priceMinor: 300,...(item?{stockBindings:[{itemId:item.id,quantity:1}]}:{}) }], extras: [] } })).json();
    const order = (await app.inject({ method: 'POST', url: '/v1/merchant/orders', headers: { ...worker, 'idempotency-key': crypto.randomUUID() }, payload: { lines: [{ productId: product.id, variantId: product.variants[0].id, quantity: 2, extraIds: [] }, { productId: product.id, variantId: product.variants[0].id, quantity: 1, extraIds: [] }] } })).json();
    return { owner, worker, base, order, shift, employee };
}
it('exposes frozen paid line quantities and denies collection before readiness', async () => { const { worker, base, order } = await setup(); await db.update(schema.merchantOrder).set({ status: 'PREPARING' }).where(eq(schema.merchantOrder.id, order.id)); const r = await app.inject({ url: base + '/orders/' + order.id + '/readiness', headers: worker }); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ revision: 0, allReady: false, lines: [{ lineIndex: 0, quantity: 2, readyQuantity: 0 }, { lineIndex: 1, quantity: 1, readyQuantity: 0 }] }); expect((await app.inject({ method: 'POST', url: '/v1/merchant/orders/' + order.id + '/status', headers: worker, payload: { revision: 1, status: 'COLLECTED' } })).statusCode).toBe(409); });
async function preparing(tracked=false) { const x = await setup(tracked); await db.update(schema.merchantOrder).set({ status: 'PREPARING', notificationAddress: 'NQ-readiness-customer', paymentSnapshot: { revision: 1, lines: x.order.lines, totalMinor: x.order.totalMinor } }).where(eq(schema.merchantOrder.id, x.order.id)); return { ...x, url: x.base + '/orders/' + x.order.id + '/readiness' }; }
const edit = (revision: number, lineIndex: number, readyQuantity: number) => ({ revision, cartRevision: 1, lineIndex, readyQuantity, idempotencyKey: crypto.randomUUID() });
it('tracks partial quantities, allows correction, then emits a single signal and immutable retry', async () => {
    const { owner, worker, base, order, url } = await preparing(), payload = edit(0, 0, 1);
    const first = await app.inject({ method: 'POST', url, headers: worker, payload });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ status: 'PREPARING', allReady: false, revision: 1 });
    expect((await db.select().from(schema.merchantNotificationOutbox).where(eq(schema.merchantNotificationOutbox.orderId, order.id)))).toHaveLength(0);
    const correction = await app.inject({ method: 'POST', url, headers: worker, payload: edit(1, 0, 0) });
    expect(correction.json().lines[0].readyQuantity).toBe(0);
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: edit(2, 0, 2) })).json().allReady).toBe(false);
    const finish = edit(3, 1, 1), r = await app.inject({ method: 'POST', url, headers: worker, payload: finish });
    expect(r.json()).toMatchObject({ status: 'READY', allReady: true, revision: 4 });
    expect((await app.inject({ method: 'POST', url, headers: worker, payload })).json()).toEqual(first.json());
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: edit(4, 0, 0) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/v1/merchant/orders/' + order.id + '/status', headers: worker, payload: { revision: 1, status: 'READY' } })).statusCode).toBe(200);
    expect((await db.select().from(schema.merchantNotificationOutbox).where(eq(schema.merchantNotificationOutbox.orderId, order.id)))).toHaveLength(1);
    expect((await app.inject({ url, headers: owner })).json()).toEqual(r.json());
    const audit = (await app.inject({ url: base + '/audit', headers: owner })).json();
    expect(JSON.stringify(audit).match(/order.readiness.updated/g)).toHaveLength(4);
    expect((await app.inject({ method: 'POST', url: '/v1/merchant/orders/' + order.id + '/status', headers: worker, payload: { revision: 1, status: 'COLLECTED' } })).json().status).toBe('COLLECTED');
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: finish })).json()).toEqual(r.json());
});
it('rejects stale concurrent updates, invalid quantities, financial changes and other venues', async () => {
    const { owner, worker, order, url } = await preparing(), other = await setup();
    const concurrent = await Promise.all([0, 1].map(i => app.inject({ method: 'POST', url, headers: worker, payload: edit(0, i, 1) })));
    expect(concurrent.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(concurrent.find(r => r.statusCode === 409)!.json().error.code).toBe('READINESS_CONFLICT');
    for (const payload of [edit(1, 0, 3), edit(1, 2, 0), { ...edit(1, 0, 1), cartRevision: 2 }, { ...edit(1, 0, 1), status: 'READY' }, { ...edit(1, 0, 1), totalMinor: 1 }])
        expect((await app.inject({ method: 'POST', url, headers: worker, payload })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: edit(1, 0, 1) })).statusCode).toBe(403);
    for (const headers of [other.owner, other.worker]) {
        expect((await app.inject({ url, headers })).statusCode).toBe(404);
        expect((await app.inject({ method: 'POST', url, headers, payload: edit(1, 0, 1) })).statusCode).toBe(404);
    }
    const checkout = (await app.inject({ url: '/v1/merchant/checkout/' + order.checkoutToken })).json();
    expect(checkout.totalMinor).toBe(900);
    expect(checkout.revision).toBe(1);
});
it('uses paid snapshot lines, marks all through legacy route, and trusts genuine legacy READY rows', async () => {
    const { worker, order, url } = await preparing();
    await db.update(schema.merchantOrder).set({ lines: [{ ...order.lines[0], quantity: 9 }] }).where(eq(schema.merchantOrder.id, order.id));
    expect((await app.inject({ url, headers: worker })).json().lines.map((l: any) => l.quantity)).toEqual([2, 1]);
    const r = await app.inject({ method: 'POST', url: '/v1/merchant/orders/' + order.id + '/status', headers: worker, payload: { revision: 1, status: 'READY' } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await app.inject({ url, headers: worker })).json()).toMatchObject({ allReady: true, revision: 1 });
    const legacy = await preparing();
    await db.update(schema.merchantOrder).set({ status: 'READY' }).where(eq(schema.merchantOrder.id, legacy.order.id));
    expect((await app.inject({ url: legacy.url, headers: legacy.worker })).json()).toMatchObject({ allReady: true, revision: 0 });
});
it('denies new work after closing shift or revoking employee but replays a committed intent', async () => {
    const { owner, worker, order, shift, employee, url } = await preparing(), payload = edit(0, 0, 1), first = await app.inject({ method: 'POST', url, headers: worker, payload });
    // A legacy fixture is already collected so its shift can be closed through the public API.
    await db.update(schema.merchantOrder).set({ status: 'COLLECTED' }).where(eq(schema.merchantOrder.id, order.id));
    expect((await app.inject({ method: 'POST', url: '/v1/merchant/shifts/' + shift.id + '/close', headers: worker })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, headers: worker, payload })).json()).toEqual(first.json());
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: edit(1, 1, 1) })).json().error.code).toBe('SHIFT_REQUIRED');
    await app.inject({ method: 'PATCH', url: '/v1/merchant/employees/' + employee.id, headers: owner, payload: { active: false } });
    expect((await app.inject({ url, headers: worker })).statusCode).toBe(401);
});
it('prepares a real paid cart without changing payment, amount or stock, then enforces remote proof and single pickup', async () => {
    const { worker, owner, base, order, url } = await preparing(true);
    // Start a separate unpaid sale and exercise the public quote/payment boundary.
    await db.update(schema.merchantOrder).set({ status: 'AWAITING_PAYMENT', paymentSnapshot: null }).where(eq(schema.merchantOrder.id, order.id));
    app.deps.merchantPayments = { quote: async (input) => ({ ...input, id: crypto.randomUUID(), network: 'nimiq:5', amountAtomic: '900000', rate: '1', rateAt: new Date().toISOString(), rateSource: 'test', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }), verify: async ({ quote, hash }) => ({ ...quote, hash, confirmedAt: new Date().toISOString() }) };
    const q = await app.inject({ method: 'POST', url: '/v1/merchant/checkout/' + order.checkoutToken + '/quote', payload: { revision: 1, asset: 'NIM', sender: 'NQ-readiness-buyer' } });
    expect(q.statusCode, q.body).toBe(200);
    const paid = await app.inject({ method: 'POST', url: '/v1/merchant/checkout/' + order.checkoutToken + '/payment', payload: { revision: 1, quoteId: q.json().quote.id, hash: 'e'.repeat(64) } });
    expect(paid.json().status).toBe('PREPARING');
    const before = paid.json(), movements = await db.select().from(schema.merchantInventoryMovement);
    expect(movements.filter(m=>m.kind==='SALE')).toHaveLength(1);
    expect((await app.inject({url:base+'/inventory',headers:owner})).json().items[0].quantity).toBe(7);
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: edit(0, 0, 2) })).json().status).toBe('PREPARING');
    await db.update(schema.merchantOrder).set({ source: 'REMOTE', pickupNonce: 'a'.repeat(43), pickupCode: '789123' }).where(eq(schema.merchantOrder.id, order.id));
    const collect = '/v1/merchant/remote/orders/' + order.id + '/collect';
    expect((await app.inject({ method: 'POST', url: collect, headers: worker, payload: { tokenOrCode: '789123' } })).json().error.code).toBe('NOT_READY');
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: edit(1, 1, 1) })).json().status).toBe('READY');
    expect((await app.inject({method:'POST',url:collect,headers:worker,payload:{tokenOrCode:'789124'}})).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: collect, headers: worker, payload: { tokenOrCode: '789123' } })).json().status).toBe('COLLECTED');
    expect((await app.inject({ method: 'POST', url: collect, headers: worker, payload: { tokenOrCode: '789123' } })).statusCode).toBe(404);
    const list = await app.inject({url:'/v1/merchant/venues/'+order.venueId+'/orders',headers:owner});
    expect(list.statusCode,list.body).toBe(200);
    const after=list.json().find((o:any)=>o.id===order.id);
    expect(before.paidSnapshot).toMatchObject({ revision: 1, totalMinor: before.totalMinor, lines: before.lines });
    for (const key of ['payment', 'paidSnapshot', 'totalMinor', 'revision', 'lines'])
        expect(after[key]).toEqual(before[key]);
    expect(await db.select().from(schema.merchantInventoryMovement)).toEqual(movements);
    expect((await app.inject({url:base+'/inventory',headers:owner})).json().items[0].quantity).toBe(7);
});
