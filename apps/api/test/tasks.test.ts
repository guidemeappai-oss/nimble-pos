import { afterAll, expect, it, vi } from 'vitest';
import { freshDb } from './helpers/db';
import { authedApp, makeUser } from './helpers/actors';
const { db, close } = await freshDb();
const { app, tokenFor } = authedApp(db);
afterAll(async () => { await app.close(); await close(); });
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const input = { title: 'Clean toilet', instructions: 'Clean sink', category: 'CLEANING', schedule: 'DAILY', timeZone: 'Europe/Warsaw', dueTime: '12:00', scheduledFor: null, assigneeEmployeeId: null, reviewerEmployeeId: null, requiredPhotos: 'NONE', active: true };
it('persists a single scheduled checklist and snapshots its instructions', async () => {
    const token = await tokenFor(await makeUser(db, 'NQ-tasks-owner-123')), headers = auth(token);
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Tasks', fiatCurrency: 'EUR', nimAddress: 'NQ-tasks-owner-123' } })).json(), base = `/v1/merchant/venues/${venue.id}`;
    const payload = { ...input, idempotencyKey: crypto.randomUUID() };
    const create = () => app.inject({ method: 'POST', url: `${base}/task-templates`, headers, payload });
    const response = await create();
    expect(response.statusCode).toBe(201);
    const template = response.json();
    expect((await create()).json().id).toBe(template.id);
    const first = (await app.inject({ url: `${base}/tasks`, headers })).json().tasks;
    expect(first).toHaveLength(1);
    expect((await app.inject({ url: `${base}/tasks`, headers })).json().tasks).toEqual(first);
    expect((await app.inject({ method: 'PATCH', url: `${base}/task-templates/${template.id}`, headers, payload: { ...input, instructions: 'New instructions', revision: 1, reason: 'Updated procedure' } })).statusCode).toBe(200);
    expect((await app.inject({ url: `${base}/tasks`, headers })).json().tasks[0].instructions).toBe('Clean sink');
    const action = (action: string, revision: number, extras = {}) => app.inject({ method: 'POST', url: `${base}/tasks/${first[0].id}/actions`, headers, payload: { action, revision, idempotencyKey: crypto.randomUUID(), ...extras } });
    expect((await action('START', 1)).json().status).toBe('IN_PROGRESS');
    expect((await action('SUBMIT', 2, { comment: 'Done' })).json().status).toBe('SUBMITTED');
    expect((await action('APPROVE', 3)).statusCode).toBe(403);
    expect((await action('OWNER_DECLARE', 3)).statusCode).toBe(400);
    expect((await action('OWNER_DECLARE', 3, { reason: 'Owner performed and declared' })).json()).toMatchObject({ status: 'APPROVED', ownerDeclared: true });
});
it('restricts templates to managers, isolates venues and protects retry and review', async () => {
    const token = await tokenFor(await makeUser(db, 'NQ-task-employees-123')), headers = auth(token);
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Team', fiatCurrency: 'EUR', nimAddress: 'NQ-task-employees-123' } })).json(), base = `/v1/merchant/venues/${venue.id}`;
    async function employee(name: string, pin: string) { return (await app.inject({ method: 'POST', url: `${base}/employees`, headers, payload: { name, pin } })).json(); }
    const worker = await employee('Worker', '1234'), manager = await employee('Manager', '5678');
    await app.inject({ method: 'PATCH', url: `/v1/merchant/employees/${manager.id}`, headers, payload: { role: 'MANAGER', permissions: ['tasks.manage'], reason: 'Manage tasks' } });
    const terminal = (await app.inject({ method: 'POST', url: `${base}/terminal`, headers })).json();
    async function login(e: any, pin: string) { return (await app.inject({ method: 'POST', url: '/v1/merchant/terminal/login', headers: { 'x-terminal-token': terminal.terminalToken }, payload: { employeeId: e.id, pin } })).json().token; }
    const workerToken = await login(worker, '1234'), workerHeaders = auth(workerToken);
    expect((await app.inject({ method: 'POST', url: `${base}/task-templates`, headers: workerHeaders, payload: { ...input, idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(403);
    const managerToken = await login(manager, '5678'), managerHeaders = auth(managerToken);
    expect((await app.inject({ url: `${base}/task-people`, headers: managerHeaders })).json().employees).toHaveLength(2);
    const created = await app.inject({ method: 'POST', url: `${base}/task-templates`, headers: managerHeaders, payload: { ...input, assigneeEmployeeId: manager.id, idempotencyKey: crypto.randomUUID() } });
    expect(created.statusCode).toBe(201);
    const task = (await app.inject({ url: `${base}/tasks`, headers: managerHeaders })).json().tasks[0];
    const act = (action: string, revision: number, key = crypto.randomUUID(), h = managerHeaders) => app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/actions`, headers: h, payload: { action, revision, idempotencyKey: key } });
    const key = crypto.randomUUID();
    expect((await act('START', 1, key)).json().revision).toBe(2);
    expect((await act('START', 1, key)).json().revision).toBe(2);
    expect((await act('SUBMIT', 1, key)).statusCode).toBe(409);
    expect((await act('SUBMIT', 2)).json().status).toBe('SUBMITTED');
    expect((await act('APPROVE', 3)).statusCode).toBe(403);
    expect((await act('APPROVE', 3, crypto.randomUUID(), headers)).json().status).toBe('APPROVED');
    const outsider = auth(await tokenFor(await makeUser(db, 'NQ-task-outsider-123')));
    expect((await app.inject({ url: `${base}/tasks`, headers: outsider })).statusCode).toBe(404);
    expect((await act('SKIP', 4, crypto.randomUUID(), outsider)).statusCode).toBe(404);
});
it('backfills local daily occurrences after restart without duplicating daylight-saving day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
        vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
        const token = await tokenFor(await makeUser(db, 'NQ-task-clock-123')), headers = auth(token);
        const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Clock', fiatCurrency: 'EUR', nimAddress: 'NQ-task-clock-123' } })).json(), base = `/v1/merchant/venues/${venue.id}`;
        const created = await app.inject({ method: 'POST', url: `${base}/task-templates`, headers, payload: { ...input, dueTime: '02:30', idempotencyKey: crypto.randomUUID() } });
        expect(created.statusCode).toBe(201);
        expect((await app.inject({ url: `${base}/tasks`, headers })).json().tasks).toHaveLength(1);
        vi.setSystemTime(new Date('2026-10-26T08:00:00Z'));
        const refreshedHeaders = auth(await tokenFor(await makeUser(db, 'NQ-task-clock-123')));
        const restarted = authedApp(db).app;
        try {
            const tasks = (await restarted.inject({ url: `${base}/tasks`, headers: refreshedHeaders })).json().tasks;
            expect(tasks).toHaveLength(3);
            expect(tasks.map((t: any) => t.dueAt)).toEqual(['2026-10-24T00:30:00.000Z', '2026-10-25T01:30:00.000Z', '2026-10-26T01:30:00.000Z']);
            expect((await restarted.inject({ url: `${base}/tasks`, headers: refreshedHeaders })).json().tasks.map((t: any) => t.id)).toEqual(tasks.map((t: any) => t.id));
        }
        finally {
            await restarted.close();
        }
    }
    finally {
        vi.useRealTimers();
    }
});
it('blocks required image submissions before files exist', async () => {
    const headers = auth(await tokenFor(await makeUser(db, 'NQ-task-photos-123')));
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Images', fiatCurrency: 'EUR', nimAddress: 'NQ-task-photos-123' } })).json(), base = `/v1/merchant/venues/${venue.id}`;
    await app.inject({ method: 'POST', url: `${base}/task-templates`, headers, payload: { ...input, requiredPhotos: 'BOTH', idempotencyKey: crypto.randomUUID() } });
    const task = (await app.inject({ url: `${base}/tasks`, headers })).json().tasks[0];
    const act = (action: string, revision: number) => app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/actions`, headers, payload: { action, revision, idempotencyKey: crypto.randomUUID() } });
    expect((await act('START', 1)).statusCode).toBe(200);
    expect((await act('SUBMIT', 2)).statusCode).toBe(409);
    expect((await app.inject({ url: `${base}/tasks`, headers })).json().tasks[0].status).toBe('IN_PROGRESS');
    expect((await act('OWNER_EXCEPTION', 2)).statusCode).toBe(400);
    const exception = await app.inject({ method: 'POST', url: `${base}/tasks/${task.id}/actions`, headers, payload: { action: 'OWNER_EXCEPTION', revision: 2, idempotencyKey: crypto.randomUUID(), reason: 'Camera unavailable; owner checked in person' } });
    expect(exception.json()).toMatchObject({ status: 'APPROVED', ownerDeclared: true, photoExceptionReason: 'Camera unavailable; owner checked in person', submissionNumber: 1 });
});
it('materializes one task for an existing shift and worker submits it for independent review', async () => {
    const headers = auth(await tokenFor(await makeUser(db, 'NQ-task-shift-123')));
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Shift', fiatCurrency: 'EUR', nimAddress: 'NQ-task-shift-123' } })).json(), base = `/v1/merchant/venues/${venue.id}`;
    const worker = (await app.inject({ method: 'POST', url: `${base}/employees`, headers, payload: { name: 'Shift worker', pin: '1234' } })).json();
    const terminal = (await app.inject({ method: 'POST', url: `${base}/terminal`, headers })).json();
    const login = (await app.inject({ method: 'POST', url: '/v1/merchant/terminal/login', headers: { 'x-terminal-token': terminal.terminalToken }, payload: { employeeId: worker.id, pin: '1234' } })).json(), staff = auth(login.token);
    expect((await app.inject({ method: 'POST', url: '/v1/merchant/shifts', headers: staff })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `${base}/task-templates`, headers, payload: { ...input, schedule: 'SHIFT', idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(201);
    const first = (await app.inject({ url: `${base}/tasks`, headers: staff })).json().tasks;
    expect(first).toHaveLength(1);
    expect(first[0].assigneeEmployeeId).toBe(worker.id);
    expect((await app.inject({ url: `${base}/tasks`, headers: staff })).json().tasks).toHaveLength(1);
    const act = (action: string, revision: number, h = staff, extras = {}) => app.inject({ method: 'POST', url: `${base}/tasks/${first[0].id}/actions`, headers: h, payload: { action, revision, idempotencyKey: crypto.randomUUID(), ...extras } });
    expect((await act('START', 1)).statusCode).toBe(200);
    expect((await act('SUBMIT', 2)).json().status).toBe('SUBMITTED');
    expect((await act('APPROVE', 3)).statusCode).toBe(403);
    expect((await act('REQUEST_CHANGES', 3, headers, { reason: 'Wipe handle' })).json().status).toBe('CHANGES_REQUESTED');
    expect((await act('START', 4)).statusCode).toBe(200);
    expect((await act('SUBMIT', 5)).json().submissionNumber).toBe(2);
    expect((await act('APPROVE', 6, headers)).json().status).toBe('APPROVED');
});
it('does not backfill paused daily deadlines when a template is enabled again', async () => {
 vi.useFakeTimers({toFake:['Date']})
 try {
 vi.setSystemTime(new Date('2026-11-01T08:00:00Z'))
 const user=await makeUser(db,'NQ-task-pause-123')
 let headers=auth(await tokenFor(user))
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Pause',fiatCurrency:'EUR',nimAddress:'NQ-task-pause-123'}})).json(),base=`/v1/merchant/venues/${venue.id}`
 const t=(await app.inject({method:'POST',url:`${base}/task-templates`,headers,payload:{...input,idempotencyKey:crypto.randomUUID()}})).json()
 const before=(await app.inject({url:`${base}/tasks`,headers})).json().tasks
 expect(before).toHaveLength(1)
 expect((await app.inject({method:'PATCH',url:`${base}/task-templates/${t.id}`,headers,payload:{...input,active:false,revision:1,reason:'Closed this week'}})).statusCode).toBe(200)
 vi.setSystemTime(new Date('2026-11-04T19:00:00Z'));headers=auth(await tokenFor(user))
 expect((await app.inject({method:'PATCH',url:`${base}/task-templates/${t.id}`,headers,payload:{...input,active:true,revision:2,reason:'Reopen'}})).statusCode).toBe(200)
 const resumed=(await app.inject({url:`${base}/tasks`,headers})).json().tasks
 expect(resumed).toEqual(before)
 vi.setSystemTime(new Date('2026-11-05T08:00:00Z'));headers=auth(await tokenFor(user))
 const next=(await app.inject({url:`${base}/tasks`,headers})).json().tasks
 expect(next.map((t:any)=>t.dueAt)).toEqual(['2026-11-01T11:00:00.000Z','2026-11-05T11:00:00.000Z'])
 }finally{vi.useRealTimers()}
})
it('does not create tasks for shifts that ended while the template was paused', async () => {
 const now=new Date(),yesterday=new Date(now.getTime()-86400000),tomorrow=new Date(now.getTime()+86400000)
 const user=await makeUser(db,'NQ-task-shift-pause-123')
 let headers=auth(await tokenFor(user)),base='',templateId=''
 vi.useFakeTimers({toFake:['Date']})
 try{
 vi.setSystemTime(yesterday);headers=auth(await tokenFor(user))
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Shift pause',fiatCurrency:'EUR',nimAddress:'NQ-task-shift-pause-123'}})).json();base=`/v1/merchant/venues/${venue.id}`
 const t=(await app.inject({method:'POST',url:`${base}/task-templates`,headers,payload:{...input,schedule:'SHIFT',idempotencyKey:crypto.randomUUID()}})).json();templateId=t.id
 await app.inject({method:'PATCH',url:`${base}/task-templates/${templateId}`,headers,payload:{...input,schedule:'SHIFT',active:false,revision:1,reason:'Paused'}})
 vi.useRealTimers();headers=auth(await tokenFor(user))
 const worker=(await app.inject({method:'POST',url:`${base}/employees`,headers,payload:{name:'Paused worker',pin:'1234'}})).json()
 const terminal=(await app.inject({method:'POST',url:`${base}/terminal`,headers})).json()
 const login=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:worker.id,pin:'1234'}})).json(),staff=auth(login.token)
 const shift=(await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:staff})).json()
 expect((await app.inject({method:'POST',url:`/v1/merchant/shifts/${shift.id}/close`,headers:staff})).statusCode).toBe(200)
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(tomorrow);headers=auth(await tokenFor(user))
 expect((await app.inject({method:'PATCH',url:`${base}/task-templates/${templateId}`,headers,payload:{...input,schedule:'SHIFT',active:true,revision:2,reason:'Resumed'}})).statusCode).toBe(200)
 expect((await app.inject({url:`${base}/tasks`,headers})).json().tasks).toHaveLength(0)
 }finally{vi.useRealTimers()}
})
