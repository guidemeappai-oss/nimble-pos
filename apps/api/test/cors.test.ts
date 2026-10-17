import { afterAll, expect, it } from 'vitest'
import { authedApp } from './helpers/actors'
import { env } from '../src/env'
const {app}=authedApp({} as never)
afterAll(()=>app.close())
it('allows the configured browser origin to preflight menu draft PUT operations',async()=>{
 const response=await app.inject({method:'OPTIONS',url:'/v1/merchant/venues/00000000-0000-4000-8000-000000000001/menu/draft',headers:{origin:env.corsOrigin,'access-control-request-method':'PUT','access-control-request-headers':'authorization,content-type'}})
 expect(response.statusCode).toBe(204)
 expect(response.headers['access-control-allow-origin']).toBe(env.corsOrigin)
 expect(response.headers['access-control-allow-methods']?.split(',').map(m=>m.trim())).toContain('PUT')
})
