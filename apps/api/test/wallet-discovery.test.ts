import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
import type { WalletObservation } from '@nimble/shared'
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
const recipient='NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
async function fixture(){const owner={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-wallet-owner-'+crypto.randomUUID()))}`};const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers:owner,payload:{name:'Wallet cafe',fiatCurrency:'EUR',nimAddress:recipient}})).json();return {owner,base:`/v1/merchant/venues/${venue.id}`,venue}}
const event=(hash:string):WalletObservation=>({eventKey:`nimiq:5:${recipient}:${hash}:0`,asset:'NIM',network:'nimiq:5',recipient,hash,eventIndex:0,sender:recipient,amountAtomic:'12345',blockNumber:10,blockHash:'b'.repeat(64),occurredAt:'2026-10-16T10:00:00.000Z',confirmation:'OBSERVED'})
it('discovers different deposits without merging equal amounts, preserves checkpoint on RPC failure and updates confirmation',async()=>{
 const f=await fixture(),base=f.base+'/wallet-discovery',a=event('a'.repeat(64)),b=event('b'.repeat(64));let failing=false,final=false
 app.deps.walletDiscovery={page:async({cursor})=>{if(failing)throw new Error('secret rpc url');return {events:[{...a,confirmation:final?'FINALIZED':'OBSERVED'},b],cursor:{checkpoint:a.hash},done:true,coveredThrough:null}},refresh:async e=>({...e,confirmation:final?'FINALIZED':'OBSERVED'})}
 const configure={asset:'NIM',enabled:true,reason:'Monitor venue wallet',idempotencyKey:crypto.randomUUID()}
 expect((await app.inject({method:'PUT',url:base+'/configuration',headers:f.owner,payload:configure})).statusCode).toBe(200)
 expect((await app.inject({method:'POST',url:base+'/scan',headers:f.owner,payload:{asset:'NIM'}})).statusCode).toBe(200)
 expect((await app.inject({method:'POST',url:base+'/scan',headers:f.owner,payload:{asset:'NIM'}})).statusCode).toBe(200)
 const first=(await app.inject({url:base,headers:f.owner})).json();expect(first.items).toHaveLength(2);expect(first.items[0].reportedOrderIds).toEqual([])
 failing=true
 const failed=await app.inject({method:'POST',url:base+'/scan',headers:f.owner,payload:{asset:'NIM'}})
 expect(failed.statusCode).toBe(503);expect(failed.body).not.toContain('secret rpc url')
 const afterFailure=(await app.inject({url:base,headers:f.owner})).json();expect(afterFailure.states[0].cursor).toEqual(first.states[0].cursor);expect(afterFailure.items).toHaveLength(2)
 failing=false;final=true
 await app.inject({method:'POST',url:base+'/scan',headers:f.owner,payload:{asset:'NIM'}})
 expect((await app.inject({url:base,headers:f.owner})).json().items.every((e:any)=>e.confirmation==='FINALIZED')).toBe(true)
 const foreign=await fixture();expect((await app.inject({url:base,headers:foreign.owner})).statusCode).toBe(404)
 expect((await app.inject({url:base})).statusCode).toBe(401)
})
it('does not commit a page arriving after the owner paused monitoring',async()=>{
 const f=await fixture(),base=f.base+'/wallet-discovery';let release!:()=>void,started!:()=>void
 const entered=new Promise<void>(r=>{started=r}),wait=new Promise<void>(r=>{release=r})
 app.deps.walletDiscovery={page:async()=>{started();await wait;return {events:[event('c'.repeat(64))],cursor:{checkpoint:'c'.repeat(64)},done:true,coveredThrough:null}},refresh:async e=>e}
 await app.inject({method:'PUT',url:base+'/configuration',headers:f.owner,payload:{asset:'NIM',enabled:true,reason:'Start monitoring',idempotencyKey:crypto.randomUUID()}})
 const scan=app.inject({method:'POST',url:base+'/scan',headers:f.owner,payload:{asset:'NIM'}}).then(r=>r)
 await entered
 await app.inject({method:'PUT',url:base+'/configuration',headers:f.owner,payload:{asset:'NIM',enabled:false,reason:'Pause monitoring',idempotencyKey:crypto.randomUUID()}})
 release();expect((await scan).statusCode).toBe(409)
 expect((await app.inject({url:base,headers:f.owner})).json().items).toEqual([])
})
