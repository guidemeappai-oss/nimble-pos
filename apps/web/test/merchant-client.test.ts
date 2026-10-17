import { afterEach, expect, it, vi } from 'vitest'
import { MerchantApi } from '../src/merchant/client'
afterEach(() => vi.unstubAllGlobals())
it('pairs a shared terminal and logs a cashier in without owner wallet credentials', async () => {
  const requests: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { requests.push(init); return new Response(JSON.stringify({ token: 'cashier-secret', employee: { id: 'anna', name: 'Anna' } }), { status: 200 }) })
  const api = new MerchantApi('/api', () => 'owner-secret', () => null, () => 'terminal-secret')
  await api.profiles()
  await api.login('anna', '1234')
  expect(requests.map(r => r.headers)).toEqual([{ 'content-type': 'application/json', 'x-terminal-token': 'terminal-secret' }, { 'content-type': 'application/json', 'x-terminal-token': 'terminal-secret' }])
})
it('creates orders under cashier authority with stable idempotency', async () => {
  let captured: RequestInit | undefined
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { captured = init; return new Response('{}') })
  const api = new MerchantApi('', () => 'owner', () => 'cashier', () => 'terminal')
  await api.createOrder([{ productId: 'p', variantId: 'v', extraIds: [], quantity: 2 }], 'retry-key')
  expect(captured?.headers).toMatchObject({ authorization: 'Bearer cashier', 'idempotency-key': 'retry-key' })
  expect(captured?.body).toBe('{"lines":[{"productId":"p","variantId":"v","extraIds":[],"quantity":2}]}')
})
it('uses explicit owner authority for schedule management even when a cashier session is also stored',async()=>{
 const requests:RequestInit[]=[]
 vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{requests.push(init);return new Response('{}')})
 const api=new MerchantApi('',()=> 'owner',()=> 'cashier',()=> 'terminal')
 await api.venueSchedule('venue','2026-10-12',true)
 await api.createSchedule('venue',{weekStart:'2026-10-12',timeZone:'Europe/Warsaw',coverageHours:[],shifts:[],idempotencyKey:'retry'},true)
 await api.publishSchedule('venue','schedule',true)
 await api.decideSubstitution('venue','request','APPROVE',true)
 await api.mySchedule('2026-10-12')
 expect(requests.map(r=>(r.headers as Record<string,string>).authorization)).toEqual(['Bearer owner','Bearer owner','Bearer owner','Bearer owner','Bearer cashier'])
})
