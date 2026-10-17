import {afterAll,expect,it} from 'vitest'
import {freshDb} from './helpers/db'
import {authedApp,makeUser} from './helpers/actors'
const {db,close}=await freshDb()
const {app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
const key=()=>crypto.randomUUID()
it.each(['owner first','verification first'])('serializes owner rejection with confirmed payment: %s',async(start)=>{
 const owner={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-release-owner-'+key()))}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers:owner,payload:{name:'Race Cafe',fiatCurrency:'EUR',nimAddress:'NQ-release-race-owner'}})).json()
 const base=`/v1/merchant/venues/${venue.id}`
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers:owner,payload})
 const stock=(await call('POST','/inventory',{name:'Last portion',unit:'PORTION',tracked:true,openingQuantity:1,threshold:0,reason:'Opening',idempotencyKey:key()})).json()
 const product=(await call('POST','/catalog',{name:'Coffee',category:'Coffee',variants:[{id:key(),name:'One',priceMinor:450,stockBindings:[{itemId:stock.id,quantity:1}]}],extras:[]})).json()
 const employee=(await call('POST','/employees',{name:'Ana',pin:'1234'})).json()
 const terminal=(await call('POST','/terminal')).json()
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token}`}
 expect((await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier})).statusCode).toBe(201)
 let confirmed=false
 app.deps.merchantPayments={quote:async input=>({...input,id:key(),network:'nimiq:5',amountAtomic:'1000',rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async({quote,hash})=>confirmed?{...quote,hash,confirmedAt:new Date().toISOString()}:null}
 const order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}})).json()
 const checkout=`/v1/merchant/checkout/${order.checkoutToken}`
 const quote=(await app.inject({method:'POST',url:checkout+'/quote',payload:{revision:1,asset:'NIM',sender:'NQ-release-customer'}})).json().quote
 const submitted={revision:1,quoteId:quote.id,hash:key().replaceAll('-','').repeat(2)}
 expect((await app.inject({method:'POST',url:checkout+'/payment',payload:submitted})).json().status).toBe('PAYMENT_PENDING')
 expect((await call('GET','/inventory')).json().items[0]).toMatchObject({quantity:1,reservedQuantity:1,availableQuantity:0})
 confirmed=true
 const decision={reason:'Owner refuses unresolved fulfillment',idempotencyKey:key()}
 const reject=()=>call('POST',`/orders/${order.id}/reject-fulfillment`,decision)
 const verify=()=>app.inject({method:'POST',url:checkout+'/payment',payload:submitted})
 const results=await Promise.all(start==='owner first'?[reject(),verify()]:[verify(),reject()])
 const rejected=results[start==='owner first'?0:1]
 const verified=results[start==='owner first'?1:0]
 expect(verified.statusCode,verified.body).toBe(200)
 expect([200,409]).toContain(rejected.statusCode)
 const winner=rejected.statusCode===200?'owner':'payment'
 if(winner==='owner')expect(rejected.json()).toMatchObject({state:'COMPLETE',orderStatus:expect.stringMatching(/^(PAYMENT_PENDING|REFUND_PENDING)$/),requiresRefund:true,outcome:'REJECTED'})
 else expect(rejected.json().error.code).toBe('PAYMENT_ALREADY_RESOLVED')
 const final=(await app.inject({url:checkout})).json()
 expect(final.status).toBe(winner==='owner'?'REFUND_PENDING':'PREPARING')
 expect(final.payment).toBeTruthy()
 if(winner==='owner')expect(final.refund).toMatchObject({status:'REQUESTED'})
 expect((await call('GET','/inventory')).json().items[0]).toMatchObject({quantity:winner==='owner'?1:0,reservedQuantity:0,availableQuantity:winner==='owner'?1:0})
 expect((await call('GET',`/inventory/${stock.id}/movements`)).json().movements.filter((m:any)=>m.kind==='SALE')).toHaveLength(winner==='owner'?0:1)
 const repeated=await reject()
 expect(repeated.statusCode).toBe(rejected.statusCode)
 if(winner==='owner')expect(repeated.json()).toEqual(rejected.json())
 expect((await app.inject({method:'POST',url:checkout+'/payment',payload:submitted})).json().status).toBe(final.status)
 const audit=(await call('GET','/audit')).json().filter((entry:any)=>entry.reason===decision.reason)
 expect(audit).toHaveLength(winner==='owner'?1:0)
 if(winner==='owner')expect(audit[0].actorKind).toBe('owner')
})
