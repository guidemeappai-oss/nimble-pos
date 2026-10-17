import { afterAll, expect, it } from 'vitest';
import { freshDb } from './helpers/db';
import { authedApp, makeUser } from './helpers/actors';

const { db, close } = await freshDb();
const { app, tokenFor } = authedApp(db);
afterAll(async () => { await app.close(); await close(); });
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const weekStart = '2026-10-12';

async function fixture(prefix: string) {
  const owner = await makeUser(db, `NQ-schedule-${prefix}-123`);
  const ownerHeaders = auth(await tokenFor(owner));
  const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers: ownerHeaders, payload: { name: 'Schedule cafe', fiatCurrency: 'EUR', nimAddress: `NQ-schedule-${prefix}-123` } })).json();
  const base = `/v1/merchant/venues/${venue.id}`;
  const employee = async (name: string, pin: string, permissions: string[] = []) => {
    const profile = (await app.inject({ method: 'POST', url: `${base}/employees`, headers: ownerHeaders, payload: { name, pin } })).json();
    if (permissions.length) await app.inject({ method: 'PATCH', url: `/v1/merchant/employees/${profile.id}`, headers: ownerHeaders, payload: { role: 'MANAGER', permissions, reason: 'Schedule management' } });
    return profile;
  };
  const terminal = (await app.inject({ method: 'POST', url: `${base}/terminal`, headers: ownerHeaders })).json();
  const login = async (profile: any, pin: string) => {
    const response = await app.inject({ method: 'POST', url: '/v1/merchant/terminal/login', headers: { 'x-terminal-token': terminal.terminalToken }, payload: { employeeId: profile.id, pin } });
    expect(response.statusCode).toBe(200);
    return auth(response.json().token);
  };
  return { base, ownerHeaders, employee, login };
}

it('publishes an immutable weekly version, exposes worker assignments and explicit coverage gaps without opening cashier shifts', async () => {
  const f = await fixture('publish-123');
  const manager = await f.employee('Manager', '1234', ['schedule.manage']);
  const staff = await f.employee('Barista', '5678');
  const managerHeaders = await f.login(manager, '1234');
  const draftPayload = {
    weekStart, timeZone: 'Europe/Warsaw', idempotencyKey: crypto.randomUUID(), coverageHours: [{ startsAt: '2026-10-12T07:00:00.000Z', endsAt: '2026-10-12T15:00:00.000Z' }],
    shifts: [{ employeeId: staff.id, startsAt: '2026-10-12T07:00:00.000Z', endsAt: '2026-10-12T11:00:00.000Z', role: 'Barista' }],
  };
  const draft = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: managerHeaders, payload: draftPayload });
  expect(draft.statusCode).toBe(201);
  const schedule = draft.json();
  expect(schedule).toMatchObject({ weekStart, timeZone: 'Europe/Warsaw', version: 1, status: 'DRAFT' });
  expect(schedule.coverage.uncovered).toMatchObject([{ day: 0, from: '13:00', to: '17:00', missingWorkers: 1 }]);
  const staffHeadersBeforePublish = await f.login(staff, '5678');
  expect((await app.inject({ url: `/v1/merchant/schedule/me?weekStart=${weekStart}`, headers: staffHeadersBeforePublish })).json()).toMatchObject({ schedule: null, shifts: [] });
  const renewedManager = await f.login(manager, '1234');
  const retry = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: renewedManager, payload: draftPayload });
  expect(retry.statusCode).toBe(200);
  expect(retry.json().id).toBe(schedule.id);
  const reusedKey = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: renewedManager, payload: { ...draftPayload, timeZone: 'UTC' } });
  expect(reusedKey.statusCode).toBe(409);
  expect(reusedKey.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  const published = await app.inject({ method: 'POST', url: `${f.base}/schedules/${schedule.id}/publish`, headers: renewedManager });
  expect(published.statusCode).toBe(200);
  expect(published.json()).toMatchObject({ version: 1, status: 'PUBLISHED', coverage: { uncovered: [{ day: 0, from: '13:00', to: '17:00', missingWorkers: 1 }] } });
  expect((await app.inject({ url: `${f.base}/schedules/${weekStart}`, headers: f.ownerHeaders })).statusCode).toBe(200);
  const staffHeaders = await f.login(staff, '5678');
  expect((await app.inject({ url: `/v1/merchant/schedule/me?weekStart=${weekStart}`, headers: staffHeaders })).json().shifts).toHaveLength(1);
  expect((await app.inject({ url: '/v1/merchant/shifts/current', headers: staffHeaders })).json()).toBeNull();
  const forbidden = await app.inject({ url: `${f.base}/schedules/${weekStart}`, headers: await f.login(await f.employee('Other', '9012'), '9012') });
  expect(forbidden.statusCode).toBe(403);
});

it('rejects employee overlap and foreign employees, while replacement approval publishes the next schedule version', async () => {
  const f = await fixture('replacement-456');
  const manager = await f.employee('Manager', '1234', ['schedule.manage']);
  const workerA = await f.employee('Worker A', '2222');
  const workerB = await f.employee('Worker B', '3333');
  const workerC = await f.employee('Worker C', '4444');
  const managerHeaders = await f.login(manager, '1234');
  const basePayload = {
    weekStart, timeZone: 'UTC', idempotencyKey: crypto.randomUUID(), coverageHours: [{ startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T17:00:00.000Z' }],
    shifts: [
      { employeeId: workerA.id, startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T13:00:00.000Z', role: 'Barista' },
      { employeeId: workerA.id, startsAt: '2026-10-12T12:00:00.000Z', endsAt: '2026-10-12T15:00:00.000Z', role: 'Cashier' },
    ],
  };
  const conflict = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: managerHeaders, payload: basePayload });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe('SCHEDULE_CONFLICT');
  expect(conflict.json().error.conflicts).toMatchObject([{ employeeId: workerA.id, firstShift: 0, secondShift: 1 }]);
  const valid = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: managerHeaders, payload: { ...basePayload, shifts: [basePayload.shifts[0], { employeeId: workerB.id, startsAt: '2026-10-12T12:00:00.000Z', endsAt: '2026-10-12T14:00:00.000Z', role: 'Cashier' }] } });
  expect(valid.statusCode).toBe(201);
  const schedule = valid.json();
  await app.inject({ method: 'POST', url: `${f.base}/schedules/${schedule.id}/publish`, headers: managerHeaders });
  const workerAHeaders = await f.login(workerA, '2222');
  const request = await app.inject({ method: 'POST', url: `${f.base}/schedules/${schedule.id}/shifts/${schedule.shifts[0].id}/substitutions`, headers: workerAHeaders, payload: { substituteEmployeeId: workerB.id, reason: 'Appointment' } });
  expect(request.statusCode).toBe(201);
  const requestRetry = await app.inject({ method: 'POST', url: `${f.base}/schedules/${schedule.id}/shifts/${schedule.shifts[0].id}/substitutions`, headers: workerAHeaders, payload: { substituteEmployeeId: workerB.id, reason: 'Appointment' } });
  expect(requestRetry.json().id).toBe(request.json().id);
  const differentRequest = await app.inject({ method: 'POST', url: `${f.base}/schedules/${schedule.id}/shifts/${schedule.shifts[0].id}/substitutions`, headers: workerAHeaders, payload: { substituteEmployeeId: workerC.id, reason: 'Different date' } });
  expect(differentRequest.statusCode).toBe(409);
  expect(differentRequest.json().error.code).toBe('SUBSTITUTION_ALREADY_PENDING');
  expect((await app.inject({ method: 'POST', url: `${f.base}/substitutions/${request.json().id}/decision`, headers: workerAHeaders, payload: { decision: 'APPROVE' } })).statusCode).toBe(403);
  const renewedManagerHeaders = await f.login(manager, '1234');
  const conflictApproval = await app.inject({ method: 'POST', url: `${f.base}/substitutions/${request.json().id}/decision`, headers: renewedManagerHeaders, payload: { decision: 'APPROVE' } });
  expect(conflictApproval.statusCode).toBe(409);
  expect(conflictApproval.json().error.code).toBe('SUBSTITUTE_CONFLICT');
  const rejectHeaders = await f.login(manager, '1234');
  expect((await app.inject({ method: 'POST', url: `${f.base}/substitutions/${request.json().id}/decision`, headers: rejectHeaders, payload: { decision: 'REJECT' } })).json().status).toBe('REJECTED');
  const workerARetryHeaders = await f.login(workerA, '2222');
  const nextRequest = await app.inject({ method: 'POST', url: `${f.base}/schedules/${schedule.id}/shifts/${schedule.shifts[0].id}/substitutions`, headers: workerARetryHeaders, payload: { substituteEmployeeId: workerC.id, reason: 'Appointment, alternate available' } });
  expect(nextRequest.statusCode).toBe(201);
  const approveHeaders = await f.login(manager, '1234');
  const approved = await app.inject({ method: 'POST', url: `${f.base}/substitutions/${nextRequest.json().id}/decision`, headers: approveHeaders, payload: { decision: 'APPROVE' } });
  expect(approved.json()).toMatchObject({ status: 'APPROVED', newVersion: 2 });
  expect((await app.inject({ method: 'POST', url: `${f.base}/substitutions/${nextRequest.json().id}/decision`, headers: approveHeaders, payload: { decision: 'APPROVE' } })).json()).toMatchObject({ status: 'APPROVED', newVersion: 2 });
  const workerBHeaders = await f.login(workerB, '3333');
  expect((await app.inject({ url: `/v1/merchant/schedule/me?weekStart=${weekStart}`, headers: workerBHeaders })).json().shifts).toHaveLength(1);
  const workerAAfterPublish = await f.login(workerA, '2222');
  expect((await app.inject({ url: `/v1/merchant/schedule/me?weekStart=${weekStart}`, headers: workerAAfterPublish })).json().shifts).toHaveLength(0);
  const finalManagerHeaders = await f.login(manager, '1234');
  expect((await app.inject({ url: `${f.base}/schedules/${weekStart}`, headers: finalManagerHeaders })).json().schedule.version).toBe(2);
  const other = await fixture('isolated-789');
  expect((await app.inject({ url: `${other.base}/schedules/${weekStart}`, headers: finalManagerHeaders })).statusCode).toBe(404);
});

it('validates schedule boundaries in the venue timezone across the daylight-saving transition', async () => {
  const f = await fixture('dst-999');
  const staff = await f.employee('Night worker', '2222');
  const payload = {
    weekStart: '2026-10-26', timeZone: 'Europe/Warsaw', idempotencyKey: crypto.randomUUID(),
    coverageHours: [{ startsAt: '2026-10-25T23:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z' }],
    shifts: [{ employeeId: staff.id, startsAt: '2026-10-25T23:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z', role: 'Opening' }],
  };
  const invalidZone = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: f.ownerHeaders, payload: { ...payload, timeZone: 'Mars/Olympus_Mons' } });
  expect(invalidZone.statusCode).toBe(400);
  const missingZone = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: f.ownerHeaders, payload: { ...payload, timeZone: undefined } });
  expect(missingZone.statusCode).toBe(400);
  const response = await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: f.ownerHeaders, payload });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ weekStart: '2026-10-26', timeZone: 'Europe/Warsaw', coverage: { uncovered: [] } });
});

it('keeps pending requests visible beside drafts, rejects inactive substitutes and superseded publication', async () => {
  const f = await fixture('version-guard');
  const worker = await f.employee('Original', '1111');
  const substitute = await f.employee('Substitute', '2222');
  const payload = { weekStart, timeZone: 'UTC', coverageHours: [], shifts: [{ employeeId: worker.id, startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T13:00:00.000Z', role: 'Service' }] };
  const create = async () => (await app.inject({ method: 'POST', url: `${f.base}/schedules`, headers: f.ownerHeaders, payload: { ...payload, idempotencyKey: crypto.randomUUID() } })).json();
  const first = await create();
  await app.inject({ method: 'POST', url: `${f.base}/schedules/${first.id}/publish`, headers: f.ownerHeaders });
  const request = (await app.inject({ method: 'POST', url: `${f.base}/schedules/${first.id}/shifts/${first.shifts[0].id}/substitutions`, headers: await f.login(worker, '1111'), payload: { substituteEmployeeId: substitute.id, reason: 'Appointment' } })).json();
  const second = await create();
  expect((await app.inject({ url: `${f.base}/schedules/${weekStart}`, headers: f.ownerHeaders })).json().pendingSubstitutions).toHaveLength(1);
  await app.inject({ method: 'PATCH', url: `/v1/merchant/employees/${substitute.id}`, headers: f.ownerHeaders, payload: { active: false } });
  const inactive = await app.inject({ method: 'POST', url: `${f.base}/substitutions/${request.id}/decision`, headers: f.ownerHeaders, payload: { decision: 'APPROVE' } });
  expect(inactive.statusCode).toBe(409);
  expect(inactive.json().error.code).toBe('SCHEDULE_EMPLOYEE_INACTIVE');
  const third = await create();
  await app.inject({ method: 'POST', url: `${f.base}/schedules/${third.id}/publish`, headers: f.ownerHeaders });
  const obsolete = await app.inject({ method: 'POST', url: `${f.base}/schedules/${second.id}/publish`, headers: f.ownerHeaders });
  expect(obsolete.statusCode).toBe(409);
  expect(obsolete.json().error.code).toBe('SCHEDULE_STALE');
  const reject = await app.inject({ method: 'POST', url: `${f.base}/substitutions/${request.id}/decision`, headers: f.ownerHeaders, payload: { decision: 'REJECT' } });
  expect(reject.json().status).toBe('REJECTED');
});

it('serializes concurrent weekly drafts and never republishes an older version over a newer one',async()=>{
 const f=await fixture('concurrent-'+crypto.randomUUID());
 const drafts=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`${f.base}/schedules`,headers:f.ownerHeaders,payload:{weekStart,timeZone:'UTC',idempotencyKey:crypto.randomUUID(),coverageHours:[],shifts:[]}})));
 expect(drafts.map(r=>r.statusCode)).toEqual([201,201]);
 const versions=drafts.map(r=>r.json()).sort((a,b)=>a.version-b.version);
 expect(versions.map(v=>v.version)).toEqual([1,2]);
 const published=await Promise.all(versions.map(v=>app.inject({method:'POST',url:`${f.base}/schedules/${v.id}/publish`,headers:f.ownerHeaders})));
 expect(published[1].statusCode).toBe(200);
 expect([200,409]).toContain(published[0].statusCode);
 const current=(await app.inject({url:`${f.base}/schedules/${weekStart}`,headers:f.ownerHeaders})).json();
 expect(current.schedule).toMatchObject({id:versions[1].id,version:2,status:'PUBLISHED'});
});
