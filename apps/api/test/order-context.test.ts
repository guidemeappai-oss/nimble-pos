import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
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
it('keeps staff context and history separate from customer checkout and freezes identical retries', async () => {
    const { owner, worker, base, order, employee } = await setup(), url = base + '/orders/' + order.id + '/context';
    const initial = await app.inject({ url, headers: worker });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toMatchObject({ summary: { orderId: order.id, revision: 0, priority: 'NORMAL', delayReason: null }, entries: [], hasMore: false });
    const payload = { revision: 0, idempotencyKey: crypto.randomUUID(), kind: 'NOTE', text: 'Internal delivery instruction' };
    const note = await app.inject({ method: 'POST', url, headers: worker, payload });
    expect(note.statusCode, note.body).toBe(200);
    expect(note.json()).toMatchObject({ summary: { revision: 1 }, entry: { text: payload.text, actor: { kind: 'cashier', id: employee.id, name: 'Ana' } } });
    expect(Number.isNaN(Date.parse(note.json().entry.createdAt))).toBe(false);
    const priority = await app.inject({ method: 'POST', url, headers: owner, payload: { revision: 1, idempotencyKey: crypto.randomUUID(), kind: 'PRIORITY', text: 'Customer has limited pickup time', priority: 'HIGH' } });
    expect(priority.statusCode, priority.body).toBe(200);
    expect((await app.inject({ method: 'POST', url, headers: worker, payload })).json()).toEqual(note.json());
    expect((await app.inject({ method: 'POST', url, headers: worker, payload: { ...payload, text: 'Changed request' } })).statusCode).toBe(409);
    const page = (await app.inject({ url: url + '?limit=1', headers: owner })).json();
    expect(page.entries).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.entries[0].kind).toBe('PRIORITY');
    expect((await app.inject({ url: url + '?page=1&limit=1', headers: worker })).json().entries[0].text).toBe(payload.text);
    const batch = (await app.inject({ url: base + '/order-context?orderIds=' + order.id, headers: worker })).json();
    expect(batch.items).toEqual([{ orderId: order.id, revision: 2, priority: 'HIGH', delayReason: null }]);
    const publicOrder = (await app.inject({ url: '/v1/merchant/checkout/' + order.checkoutToken })).json();
    expect(JSON.stringify(publicOrder)).not.toContain(payload.text);
    expect(JSON.stringify(publicOrder)).not.toContain('delayReason');
    expect(publicOrder.totalMinor).toBe(300);
});
it('serializes stale edits, rejects price/status fields and preserves the order promises', async () => {
    const { owner, base, order } = await setup(), url = base + '/orders/' + order.id + '/context';
    const original = (await app.inject({ url: '/v1/merchant/checkout/' + order.checkoutToken })).json();
    const responses = await Promise.all(['DELAY', 'NOTE'].map(kind => app.inject({ method: 'POST', url, headers: owner, payload: { revision: 0, idempotencyKey: crypto.randomUUID(), kind, text: kind === 'DELAY' ? 'Waiting for oven' : 'Customer seated upstairs' } })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find(r => r.statusCode === 409)!.json().error.code).toBe('ORDER_CONTEXT_CONFLICT');
    for (const added of [{ totalMinor: 1 }, { acceptanceDeadline: '2099-01-01' }, { status: 'READY' }, { createdAt: '2099-01-01' }, { actor: { name: 'Fake' } }, { priority: 'HIGH' }]) {
        const r = await app.inject({ method: 'POST', url, headers: owner, payload: { revision: 1, idempotencyKey: crypto.randomUUID(), kind: 'NOTE', text: 'Must reject unknown fields', ...added } });
        expect(r.statusCode, r.body).toBe(400);
    }
    const result = await app.inject({ method: 'POST', url, headers: owner, payload: { revision: 1, idempotencyKey: crypto.randomUUID(), kind: 'DELAY', text: 'Waiting for fresh ingredients' } });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().summary.delayReason).toBe('Waiting for fresh ingredients');
    const current = (await app.inject({ url: '/v1/merchant/checkout/' + order.checkoutToken })).json();
    for (const key of ['totalMinor', 'status', 'revision', 'acceptanceDeadline', 'preparationMinutes'])
        expect(current[key]).toEqual(original[key]);
    expect((await app.inject({ url: url + '?limit=1', headers: owner })).json()).toMatchObject({ summary: { revision: 2 }, hasMore: true });
});
it('denies other venues, customer identities, revoked employees and edits after closing the shift', async () => {
    const { owner, worker, base, order, shift, employee } = await setup(), other = await setup(), url = base + '/orders/' + order.id + '/context';
    const payload = { revision: 0, idempotencyKey: crypto.randomUUID(), kind: 'NOTE', text: 'Visible only to staff' };
    const customer = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-client-' + crypto.randomUUID()))}` };
    for (const headers of [{}, customer, other.owner, other.worker]) {
        const get = await app.inject({ url, headers });
        expect([401, 404]).toContain(get.statusCode);
        const post = await app.inject({ method: 'POST', url, headers, payload });
        expect([401, 404]).toContain(post.statusCode);
    }
    expect((await app.inject({ url: other.base + '/order-context?orderIds=' + order.id, headers: other.owner })).statusCode).toBe(404);
    expect((await app.inject({ url: base + '/order-context?orderIds=' + Array.from({ length: 51 }, () => order.id).join(','), headers: owner })).statusCode).toBe(400);
    const accepted = await app.inject({ method: 'POST', url, headers: worker, payload });
    expect(accepted.statusCode).toBe(200);
    // Cancel an unpaid order through the cashier flow, then close their own shift.
    const cancelled = await app.inject({ method: 'POST', url: '/v1/merchant/orders/' + order.id + '/status', headers: worker, payload: { revision: 1, status: 'CANCELLED' } });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const closed = await app.inject({ method: 'POST', url: '/v1/merchant/shifts/' + shift.id + '/close', headers: worker });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await app.inject({ method: 'POST', url, headers: worker, payload })).json()).toEqual(accepted.json());
    const denied = await app.inject({ method: 'POST', url, headers: worker, payload: { ...payload, revision: 1, idempotencyKey: crypto.randomUUID() } });
    expect(denied.statusCode, denied.body).toBe(409);
    expect(denied.json().error.code).toBe('SHIFT_REQUIRED');
    expect((await app.inject({ url, headers: worker })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, headers: owner, payload: { ...payload, revision: 1, idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(200);
    await app.inject({ method: 'PATCH', url: '/v1/merchant/employees/' + employee.id, headers: owner, payload: { active: false } });
    expect((await app.inject({ url, headers: worker })).statusCode).toBe(401);
});
it('never exposes internal notes, priority reasons or delays to the remote customer DTO or list', async () => {
    const { owner, worker, base, order } = await setup(), user = await makeUser(db, 'NQ-remote-context-' + crypto.randomUUID()), customer = { authorization: `Bearer ${await tokenFor(user)}` }, url = base + '/orders/' + order.id + '/context';
    // Remote fixture uses the existing order lifecycle; every private event goes through the public staff API.
    await db.update(schema.merchantOrder).set({ source: 'REMOTE', payerUserId: user.id }).where(eq(schema.merchantOrder.id, order.id));
    const secrets = ['Internal customer discussion', 'Private priority justification', 'Internal oven breakdown'];
    for (const [revision, kind] of ['NOTE', 'PRIORITY', 'DELAY'].entries()) {
        const r = await app.inject({ method: 'POST', url, headers: worker, payload: { revision, idempotencyKey: crypto.randomUUID(), kind, text: secrets[revision], ...(kind === 'PRIORITY' ? { priority: 'HIGH' } : {}) } });
        expect(r.statusCode, r.body).toBe(200);
    }
    for (const publicUrl of ['/v1/merchant/checkout/' + order.checkoutToken, '/v1/merchant/remote/orders/' + order.id, '/v1/merchant/remote/orders']) {
        const r = await app.inject({ url: publicUrl, headers: customer });
        expect(r.statusCode, r.body).toBe(200);
        for (const secret of secrets)
            expect(r.body).not.toContain(secret);
        expect(r.body).not.toContain('delayReason');
        expect(r.body).not.toContain('OrderContext');
    }
    expect((await app.inject({ url, headers: customer })).statusCode).toBe(404);
    const audit = (await app.inject({ url: base + '/audit', headers: owner })).json();
    expect(JSON.stringify(audit)).toContain('order.context.delay');
    expect(JSON.stringify(audit)).toContain('Ana');
});
