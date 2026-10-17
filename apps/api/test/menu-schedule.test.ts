import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const {db,close}=await freshDb()
const {app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
it('persists effective POS availability, retries once and preserves an already issued quote',async()=>{
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-menu-schedule-owner'))}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Schedule cafe',fiatCurrency:'EUR',nimAddress:'NQ-menu-schedule-owner'}})).json()
 const base=`/v1/merchant/venues/${venue.id}`
 const product=(await app.inject({method:'POST',url:base+'/catalog',headers,payload:{name:'Coffee',category:'Drinks',available:true,variants:[{id:crypto.randomUUID(),name:'Cup',priceMinor:300}],extras:[]}})).json()
 const employee=(await app.inject({method:'POST',url:base+'/employees',headers,payload:{name:'Ana',pin:'1234'}})).json()
 const terminal=(await app.inject({method:'POST',url:base+'/terminal',headers})).json()
 const login=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json()
 const cashier={authorization:`Bearer ${login.token}`}
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier})
 app.deps.merchantPayments={quote:async input=>({...input,id:crypto.randomUUID(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})}
 const create=()=>app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':crypto.randomUUID()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}})
 const order=(await create()).json()
 const unquoted=(await create()).json()
 const quotePayload={revision:1,asset:'NIM',sender:'NQ-schedule-customer'}
 const quote=(await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:quotePayload})).json()
 const body={revision:0,timezone:'Europe/Warsaw',rules:[{productId:product.id,kind:'product',weekly:[],exceptions:[],disabledUntil:'2099-01-01T00:00:00Z'}],idempotencyKey:crypto.randomUUID(),reason:'Temporarily stop coffee'}
 expect((await app.inject({method:'PUT',url:base+'/menu/schedule',headers:cashier,payload:body})).statusCode).toBe(403)
 const saved=await app.inject({method:'PUT',url:base+'/menu/schedule',headers,payload:body})
 expect(saved.statusCode,saved.body).toBe(200)
 expect(saved.json().revision).toBe(1)
 expect((await app.inject({method:'PUT',url:base+'/menu/schedule',headers,payload:body})).json()).toEqual(saved.json())
 expect((await app.inject({url:base+'/catalog',headers:cashier})).json()[0].available).toBe(false)
 expect((await create()).statusCode).toBe(409)
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${unquoted.checkoutToken}/quote`,payload:quotePayload})).statusCode).toBe(409)
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:quotePayload})).json().quote).toEqual(quote.quote)
 expect((await app.inject({method:'PUT',url:base+'/menu/schedule',headers,payload:{...body,idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409)
})
