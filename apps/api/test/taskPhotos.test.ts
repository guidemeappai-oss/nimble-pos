import { cleanTaskPhotos } from '../src/services/taskPhotos'
import { afterAll, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const directory=await mkdtemp(join(tmpdir(),'nimble-photos-api-'));process.env.TASK_PHOTO_DIR=directory
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close();await rm(directory,{recursive:true,force:true})})
const auth=(token:string)=>({authorization:`Bearer ${token}`})
it('requires persisted before/after evidence, retries safely and keeps reads private',async()=>{
 const headers=auth(await tokenFor(await makeUser(db,'NQ-photo-owner-123')))
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Photos',fiatCurrency:'EUR',nimAddress:'NQ-photo-owner-123'}})).json(),base=`/v1/merchant/venues/${venue.id}`
 await app.inject({method:'POST',url:`${base}/task-templates`,headers,payload:{title:'Clean toilet',instructions:'Sink and floor',category:'CLEANING',schedule:'DAILY',timeZone:'Europe/Warsaw',dueTime:'12:00',scheduledFor:null,assigneeEmployeeId:null,reviewerEmployeeId:null,requiredPhotos:'BOTH',active:true,idempotencyKey:crypto.randomUUID()}})
 const task=(await app.inject({url:`${base}/tasks`,headers})).json().tasks[0]
 const action=(action:string,revision:number,extra={})=>app.inject({method:'POST',url:`${base}/tasks/${task.id}/actions`,headers,payload:{action,revision,idempotencyKey:crypto.randomUUID(),...extra}})
 await action('START',1)
 expect((await action('SUBMIT',2)).statusCode).toBe(409)
 const photos=`${base}/tasks/${task.id}/photos`,image=await sharp({create:{width:40,height:40,channels:3,background:'#fff'}}).jpeg().toBuffer()
 const input={idempotencyKey:crypto.randomUUID(),phase:'BEFORE',source:'CAMERA',base64:image.toString('base64')}
 const upload=(payload:Record<string,unknown>=input,h=headers)=>app.inject({method:'POST',url:photos,headers:h,payload})
 const first=await upload();expect(first.statusCode).toBe(201);expect(first.json().storageKey).toBeUndefined()
 expect((await upload()).json().id).toBe(first.json().id)
 expect((await upload({...input,phase:'AFTER'})).statusCode).toBe(409)
 expect((await action('SUBMIT',2)).json().error.code).toBe('TASK_AFTER_PHOTO_REQUIRED')
 expect((await upload({...input,idempotencyKey:crypto.randomUUID(),phase:'AFTER'})).statusCode).toBe(201)
 const list=(await app.inject({url:photos,headers})).json();expect(list).toHaveLength(2)
 const downloaded=await app.inject({url:`${photos}/${first.json().id}`,headers});expect(downloaded.statusCode).toBe(200);expect(downloaded.headers['cache-control']).toContain('no-store');expect((await sharp(downloaded.rawPayload).metadata()).format).toBe('jpeg')
 const outsider=auth(await tokenFor(await makeUser(db,'NQ-photo-outsider-123')))
 expect((await app.inject({url:`${photos}/${first.json().id}`,headers:outsider})).statusCode).toBe(404)
 expect((await app.inject({url:`${photos}/${first.json().id}`})).statusCode).toBe(401)
 const third=await upload({...input,idempotencyKey:crypto.randomUUID()});expect(third.statusCode).toBe(201)
 expect((await upload({...input,idempotencyKey:crypto.randomUUID()})).statusCode).toBe(201)
 expect((await upload({...input,idempotencyKey:crypto.randomUUID()})).json().error.code).toBe('PHOTO_LIMIT')
 expect((await app.inject({method:'POST',url:`${photos}/${third.json().id}/remove`,headers,payload:{}})).json().ok).toBe(true)
 const manager=(await app.inject({method:'POST',url:`${base}/employees`,headers,payload:{name:'Reviewer',pin:'5678'}})).json()
 const grant=(permissions:string[])=>app.inject({method:'PATCH',url:`/v1/merchant/employees/${manager.id}`,headers,payload:{role:'MANAGER',permissions,reason:'Review task evidence'}})
 await grant(['tasks.manage'])
 const terminal=(await app.inject({method:'POST',url:`${base}/terminal`,headers})).json()
 const managerToken=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:manager.id,pin:'5678'}})).json().token,managerHeaders=auth(managerToken)
 expect((await app.inject({url:photos,headers:managerHeaders})).statusCode).toBe(403)
 await grant(['tasks.manage','photos.view'])
 expect((await app.inject({url:photos,headers:managerHeaders})).statusCode).toBe(200)
 await grant(['tasks.manage'])
 expect((await app.inject({url:`${photos}/${first.json().id}`,headers:managerHeaders})).statusCode).toBe(403)
 expect((await action('SUBMIT',2)).json().status).toBe('SUBMITTED')
 expect((await app.inject({method:'POST',url:`${photos}/${first.json().id}/remove`,headers,payload:{}})).statusCode).toBe(409)
 expect((await app.inject({method:'POST',url:`${photos}/${first.json().id}/retention`,headers,payload:{days:45,reason:'Open review'}})).statusCode).toBe(200)
 expect((await app.inject({method:'POST',url:`${photos}/${first.json().id}/retention`,headers,payload:{days:91,reason:'Too long'}})).statusCode).toBe(400)
 expect((await action('APPROVE',3)).statusCode).toBe(403)
 expect((await action('OWNER_DECLARE',3,{reason:'Owner completed work'})).json().ownerDeclared).toBe(true)
 const now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+91*86400000)
 try { await cleanTaskPhotos(db); expect((await app.inject({url:`${photos}/${first.json().id}`,headers})).statusCode).toBe(404);expect((await app.inject({url:photos,headers})).json()).toHaveLength(0) }
 finally{now.mockRestore()}

})
it('returns a size error instead of an internal failure for oversized photo requests',async()=>{
 const response=await app.inject({method:'POST',url:`/v1/merchant/venues/${crypto.randomUUID()}/tasks/${crypto.randomUUID()}/photos`,payload:{base64:'a'.repeat(14*1024*1024)}})
 expect(response.statusCode).toBe(413)
 expect(response.json().error.code).toBe('PHOTO_TOO_LARGE')
})
