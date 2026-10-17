import {afterAll,expect,it} from 'vitest'
import {freshDb} from './helpers/db'
import {authedApp,makeUser} from './helpers/actors'
const {db,close}=await freshDb()
const {app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
const key=()=>crypto.randomUUID()
async function setup(){
 const address='NQ-bundle-'+key(),headers={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Lunch Cafe',fiatCurrency:'EUR',nimAddress:address}})).json()
 const base=`/v1/merchant/venues/${venue.id}`
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload})
 const coffee=(await call('POST','/catalog',{name:'Coffee',category:'Drinks',variants:[{id:key(),name:'One',priceMinor:400}],extras:[]})).json()
 const bundle={id:key(),name:'Lunch',category:'Food',available:true,variants:[{id:key(),name:'One',priceMinor:900}],extras:[],components:[{productId:coffee.id,variantId:coffee.variants[0].id,quantity:1}]}
 return {headers,venue,base,call,coffee,bundle}
}
it('persists bundle references and prevents a legacy edit deleting a referenced variant',async()=>{
 const s=await setup()
 const created=await s.call('POST','/catalog',s.bundle)
 expect(created.statusCode).toBe(201)
 expect(created.json().components).toEqual(s.bundle.components)
 const rejected=await s.call('POST','/catalog',{...s.coffee,variants:[{id:key(),name:'Other',priceMinor:100}]})
 expect(rejected.statusCode).toBe(400)
 expect(rejected.json().error.code).toBe('INVALID_COMPONENT')
 expect((await s.call('GET','/catalog')).json().find((p:any)=>p.id===s.coffee.id).variants[0].id).toBe(s.coffee.variants[0].id)
})
it('validates complete draft references and rejects grouped or bundle loyalty rewards, preserving active promises',async()=>{
 const s=await setup()
 const extra={id:key(),name:'Milk',available:true,priceMinor:50}
 const grouped={...s.coffee,extras:[extra],choiceGroups:[{id:key(),name:'Milk choice',min:1,max:1,extraIds:[extra.id]}]}
 expect((await s.call('POST','/catalog',grouped)).statusCode).toBe(200)
 const program=async(product:any)=>app.inject({method:'POST',url:s.base+'/loyalty/program',headers:{...s.headers,'idempotency-key':key()},payload:{minimumMinor:400,productId:product.id,variantId:product.variants[0].id}})
 expect((await program(grouped)).json().error.code).toBe('INVALID_REWARD_PRODUCT')
 expect((await s.call('POST','/catalog',s.coffee)).statusCode).toBe(200)
 expect((await program(s.coffee)).statusCode).toBe(200)
 expect((await s.call('POST','/catalog',grouped)).json().error.code).toBe('LOYALTY_REWARD_PRODUCT_LOCKED')
 expect((await s.call('POST','/catalog',s.bundle)).statusCode).toBe(201)
 expect((await program(s.bundle)).json().error.code).toBe('INVALID_REWARD_PRODUCT')
 const state=(await s.call('GET','/menu')).json()
 const draft=async(products:any[])=>s.call('PUT','/menu/draft',{revision:state.draft?.revision??null,basePublishedRevision:state.publishedRevision,products,reason:'Check components',idempotencyKey:key()})
 const orphaned=await draft([s.bundle])
 expect(orphaned.statusCode).toBe(400);expect(orphaned.json().error.code).toBe('INVALID_COMPONENT')
 const nested=await draft([s.coffee,s.bundle,{...s.bundle,id:key(),variants:[{id:key(),name:'One',priceMinor:100}],components:[{productId:s.bundle.id,variantId:s.bundle.variants[0].id,quantity:1}]}])
 expect(nested.json().error.code).toBe('INVALID_COMPONENT')
 const valid=await draft([s.coffee,s.bundle]);expect(valid.statusCode).toBe(200)
 expect((await s.call('POST','/menu/publish',{draftRevision:valid.json().draft.revision,basePublishedRevision:state.publishedRevision,reason:'Publish valid bundles',idempotencyKey:key()})).statusCode).toBe(200)
})
async function terminal(s:Awaited<ReturnType<typeof setup>>){
 const employee=(await s.call('POST','/employees',{name:'Ana',pin:'1234'})).json()
 const paired=(await s.call('POST','/terminal')).json()
 const token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':paired.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token
 const headers={authorization:`Bearer ${token}`}
 expect((await app.inject({method:'POST',url:'/v1/merchant/shifts',headers})).statusCode).toBe(201)
 return headers
}
it('enforces the same required choices and child availability in POS and remote orders with frozen composition',async()=>{
 const s=await setup(),cashier=await terminal(s)
 const option={id:key(),name:'Coffee choice',available:true,priceMinor:100,component:s.bundle.components[0]}
 const bundle={...s.bundle,components:[{...s.bundle.components[0],quantity:2}],extras:[option,{id:key(),name:'Other coffee',available:true,priceMinor:50,component:option.component}],choiceGroups:[{id:key(),name:'Drink',min:1,max:1,extraIds:[] as string[]}]}
 bundle.choiceGroups[0].extraIds=bundle.extras.map(e=>e.id)
 expect((await s.call('POST','/catalog',bundle)).statusCode).toBe(201)
 const {env}=await import('../src/env');env.remoteOrderingEnabled=true
 const customer={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-bundle-customer-'+key()))}`}
 await app.inject({method:'PATCH',url:`/v1/merchant/remote/venues/${s.venue.id}/settings`,headers:s.headers,payload:{published:true,description:'Lunch',address:'Main 1',city:'Gliwice',pickupInstructions:'Counter',preparationMinutes:10}})
 await app.inject({method:'POST',url:`/v1/merchant/remote/venues/${s.venue.id}/heartbeat`,headers:cashier})
 await app.inject({method:'PATCH',url:`/v1/merchant/remote/venues/${s.venue.id}/availability`,headers:cashier,payload:{accepting:true}})
 for(const [url,headers] of [['/v1/merchant/orders',cashier],[`/v1/merchant/remote/venues/${s.venue.id}/orders`,customer]] as const){
  const create=(extraIds:string[])=>app.inject({method:'POST',url,headers:{...headers,'idempotency-key':key()},payload:{lines:[{productId:bundle.id,variantId:bundle.variants[0].id,extraIds,quantity:2}]}})
  expect((await create([])).json().error.code).toBe('CHOICE_REQUIRED')
  expect((await create(bundle.extras.map(e=>e.id))).json().error.code).toBe('CHOICE_LIMIT')
  const accepted=await create([option.id]);expect(accepted.statusCode).toBe(201)
  expect(accepted.json()).toMatchObject({totalMinor:2000,lines:[{components:[{productId:s.coffee.id,quantity:3,productName:'Coffee'}]}]})
  expect((await s.call('PATCH',`/catalog/${s.coffee.id}/availability`,{available:false})).statusCode).toBe(200)
  expect((await create([option.id])).json().error.code).toBe('UNAVAILABLE_ITEM')
  const old=await app.inject({url:`/v1/merchant/checkout/${accepted.json().checkoutToken}`,headers})
  expect(old.json().lines[0].components[0].productName).toBe('Coffee')
  await s.call('PATCH',`/catalog/${s.coffee.id}/availability`,{available:true})
 }
})
it('counts a paid bundle order once for loyalty and leaves reward prices independent',async()=>{
 const s=await setup(),cashier=await terminal(s)
 expect((await s.call('POST','/catalog',s.bundle)).statusCode).toBe(201)
 expect((await app.inject({method:'POST',url:s.base+'/loyalty/program',headers:{...s.headers,'idempotency-key':key()},payload:{minimumMinor:400,productId:s.coffee.id,variantId:s.coffee.variants[0].id}})).statusCode).toBe(200)
 const address='NQ-bundle-loyal-'+key(),customer={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`}
 const card=(await app.inject({method:'POST',url:s.base+'/loyalty/join',headers:{...customer,'idempotency-key':key()},payload:{}})).json()
 app.deps.merchantPayments={quote:async(input)=>({...input,id:key(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})}
 const order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:s.bundle.id,variantId:s.bundle.variants[0].id,extraIds:[],quantity:3}]}})).json()
 const url=`/v1/merchant/checkout/${order.checkoutToken}`
 expect((await app.inject({method:'POST',url:url+'/loyalty',headers:{...customer,'idempotency-key':key()},payload:{cardId:card.id,revision:1}})).statusCode).toBe(200)
 const quoted=(await app.inject({method:'POST',url:url+'/quote',payload:{revision:1,asset:'NIM',sender:address}})).json()
 const payload={revision:1,quoteId:quoted.quote.id,hash:key().replaceAll('-','').repeat(2)}
 for(let retry=0;retry<2;retry++)expect((await app.inject({method:'POST',url:url+'/payment',payload})).statusCode).toBe(200)
 const result=(await app.inject({url:`/v1/merchant/loyalty/cards/${card.id}`,headers:customer})).json()
 expect(result.balance).toBe(1);expect(result.entries.filter((e:any)=>e.kind==='EARN')).toHaveLength(1)
 expect(result.program.variantName).toBe('One')
})
it('keeps bundle component references within the venue and requires menu permission',async()=>{
 const a=await setup(),b=await setup(),cashier=await terminal(a)
 const foreign={...a.bundle,components:b.bundle.components}
 expect((await a.call('POST','/catalog',foreign)).json().error.code).toBe('INVALID_COMPONENT')
 const denied=await app.inject({method:'POST',url:a.base+'/catalog',headers:cashier,payload:a.bundle})
 expect(denied.statusCode).toBe(403)
 expect((await a.call('GET','/catalog')).json()).toHaveLength(1)
})
