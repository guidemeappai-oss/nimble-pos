import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const {db,close}=await freshDb()
const {app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
async function fixture(){
 const owner={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-worktime-'+crypto.randomUUID()))}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers:owner,payload:{name:'Worktime cafe',fiatCurrency:'EUR',nimAddress:'NQ-worktime-owner'}})).json()
 const base=`/v1/merchant/venues/${venue.id}`
 const employee=(await app.inject({method:'POST',url:base+'/employees',headers:owner,payload:{name:'Ana',pin:'1234'}})).json()
 const terminal=(await app.inject({method:'POST',url:base+'/terminal',headers:owner})).json()
 const worker={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token}`}
 return {owner,worker,base,employee}
}
it('records work and breaks independently from the cashier shift and retries a finished operation',async()=>{
 const f=await fixture(),url=f.base+'/worktime'
 const payload={idempotencyKey:crypto.randomUUID()}
 const start=await app.inject({method:'POST',url:url+'/start',headers:f.worker,payload})
 expect(start.statusCode,start.body).toBe(200)
 expect(start.json()).toMatchObject({employeeId:f.employee.id,status:'WORKING',breaks:[]})
 expect((await app.inject({method:'POST',url:url+'/start',headers:f.worker,payload})).json()).toEqual(start.json())
 expect((await app.inject({method:'POST',url:url+'/start',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409)
 expect((await app.inject({url:'/v1/merchant/shifts/current',headers:f.worker})).json()).toBeNull()
 const pause=await app.inject({method:'POST',url:url+'/pause',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID()}})
 expect(pause.json().status).toBe('PAUSED')
 const finishBody={idempotencyKey:crypto.randomUUID()}
 const finish=await app.inject({method:'POST',url:url+'/finish',headers:f.worker,payload:finishBody})
 expect(finish.json()).toMatchObject({status:'FINISHED',breaks:[{endedAt:expect.any(String)}],endedAt:expect.any(String)})
 expect((await app.inject({method:'POST',url:url+'/finish',headers:f.worker,payload:finishBody})).json()).toEqual(finish.json())
 expect((await app.inject({url:url,headers:f.owner})).json().items).toHaveLength(1)
 const other=await fixture()
 expect((await app.inject({url:url,headers:other.owner})).statusCode).toBe(404)
})
it('keeps the original hours until an authorised correction is approved and exposes its history to the worker',async()=>{
 const f=await fixture(),url=f.base+'/worktime'
 const started=(await app.inject({method:'POST',url:url+'/start',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID()}})).json()
 const finished=(await app.inject({method:'POST',url:url+'/finish',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID()}})).json()
 const change={idempotencyKey:crypto.randomUUID(),revision:finished.revision,startedAt:'2026-10-15T06:00:00Z',endedAt:'2026-10-15T14:00:00Z',breaks:[{startedAt:'2026-10-15T10:00:00Z',endedAt:'2026-10-15T10:30:00Z'}],reason:'Forgot to clock in yesterday'}
 const proposal=await app.inject({method:'POST',url:url+'/'+started.id+'/corrections',headers:f.worker,payload:change})
 expect(proposal.statusCode,proposal.body).toBe(200)
 expect((await app.inject({url:url,headers:f.worker})).json().items[0].startedAt).toBe(finished.startedAt)
 const decisionUrl=url+'/corrections/'+proposal.json().id+'/decision'
 const decision={idempotencyKey:crypto.randomUUID(),decision:'APPROVE',reason:'Checked with employee'}
 expect((await app.inject({method:'POST',url:decisionUrl,headers:f.worker,payload:decision})).statusCode).toBe(403)
 expect((await app.inject({method:'POST',url:decisionUrl,headers:f.owner,payload:decision})).statusCode).toBe(200)
 const result=(await app.inject({url:url,headers:f.worker})).json()
 expect(result.items[0]).toMatchObject({startedAt:'2026-10-15T06:00:00.000Z',endedAt:'2026-10-15T14:00:00.000Z'})
 expect(result.corrections[0]).toMatchObject({status:'APPROVED',reason:change.reason,previous:{startedAt:finished.startedAt}})
})
it('rejects overlapping approved corrections and records midnight / DST instants without guessing local offsets',async()=>{
 const f=await fixture(),url=f.base+'/worktime'
 const finish=async()=>{await app.inject({method:'POST',url:url+'/start',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID()}});return (await app.inject({method:'POST',url:url+'/finish',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID()}})).json()}
 const first=await finish()
 const propose=async(record:any)=>app.inject({method:'POST',url:url+'/'+record.id+'/corrections',headers:f.worker,payload:{idempotencyKey:crypto.randomUUID(),revision:record.revision,startedAt:'2026-03-28T23:30:00+01:00',endedAt:'2026-03-29T03:30:00+02:00',breaks:[],reason:'Clock change night shift'}})
 const c1=(await propose(first)).json()
 const approve=(id:string)=>app.inject({method:'POST',url:url+'/corrections/'+id+'/decision',headers:f.owner,payload:{idempotencyKey:crypto.randomUUID(),decision:'APPROVE',reason:'Confirmed time sheet'}})
 expect((await approve(c1.id)).statusCode).toBe(200)
 const second=await finish(),c2=(await propose(second)).json()
 const conflict=await approve(c2.id)
 expect(conflict.statusCode,conflict.body).toBe(409)
 expect(conflict.json().error.code).toBe('WORK_TIME_OVERLAP')
 const records=(await app.inject({url,headers:f.worker})).json().items
 expect(records.find((r:any)=>r.id===first.id)).toMatchObject({startedAt:'2026-03-28T22:30:00.000Z',endedAt:'2026-03-29T01:30:00.000Z'})
 expect(records.find((r:any)=>r.id===second.id).startedAt).toBe(second.startedAt)
})
