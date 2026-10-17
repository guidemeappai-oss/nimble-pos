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
async function terminal(s:Awaited<ReturnType<typeof setup>>){
 const employee=(await s.call('POST','/employees',{name:'Ana',pin:'1234'})).json()
 const paired=(await s.call('POST','/terminal')).json()
 const token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':paired.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token
 const headers={authorization:`Bearer ${token}`}
 expect((await app.inject({method:'POST',url:'/v1/merchant/shifts',headers})).statusCode).toBe(201)
 return headers
}

async function resource(s:Awaited<ReturnType<typeof setup>>, tracked=true) {
 const r=await s.call('POST','/inventory',{name:'Beans',unit:'PORTION',tracked,openingQuantity:20,threshold:2,reason:'Opening',idempotencyKey:key()})
 expect(r.statusCode).toBe(201);return r.json()
}
it('freezes POS and remote shared stock requirements without changing balances or existing quotes',async()=>{
 const s=await setup(),item=await resource(s,false),cashier=await terminal(s)
 const coffee={...s.coffee,variants:[{...s.coffee.variants[0],stockBindings:[{itemId:item.id,quantity:2}]},{id:key(),name:'Large',priceMinor:500,stockBindings:[{itemId:item.id,quantity:3}]}]}
 expect((await s.call('POST','/catalog',coffee)).statusCode).toBe(200)
 expect((await s.call('POST','/catalog',s.bundle)).statusCode).toBe(201)
 const {env}=await import('../src/env');env.remoteOrderingEnabled=true
 const customer={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-stock-customer-'+key()))}`}
 await app.inject({method:'PATCH',url:`/v1/merchant/remote/venues/${s.venue.id}/settings`,headers:s.headers,payload:{published:true,description:'Lunch',address:'Main 1',city:'Gliwice',pickupInstructions:'Counter',preparationMinutes:10}})
 await app.inject({method:'POST',url:`/v1/merchant/remote/venues/${s.venue.id}/heartbeat`,headers:cashier})
 await app.inject({method:'PATCH',url:`/v1/merchant/remote/venues/${s.venue.id}/availability`,headers:cashier,payload:{accepting:true}})
 app.deps.merchantPayments={quote:async(input)=>({...input,id:key(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})}
 const orders=[]
 for(const [url,headers] of [['/v1/merchant/orders',cashier],[`/v1/merchant/remote/venues/${s.venue.id}/orders`,customer]] as const){
  const created=await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':key()},payload:{lines:[{productId:coffee.id,variantId:coffee.variants[1].id,extraIds:[],quantity:2},{productId:s.bundle.id,variantId:s.bundle.variants[0].id,extraIds:[],quantity:3}]}})
  expect(created.statusCode).toBe(201)
  expect(created.json().lines.map((l:any)=>l.stockRequirements)).toEqual([[{itemId:item.id,quantity:3}],[{itemId:item.id,quantity:2}]])
  orders.push(created.json())
 }
 const checkout=`/v1/merchant/checkout/${orders[0].checkoutToken}`
 const quoted=(await app.inject({method:'POST',url:checkout+'/quote',payload:{revision:1,asset:'NIM',sender:'NQ-stock-buyer'}})).json()
 expect(quoted.quote).toBeDefined()
 expect((await s.call('POST','/catalog',{...coffee,variants:coffee.variants.map((v:any)=>({...v,stockBindings:[{itemId:item.id,quantity:9}]}))})).statusCode).toBe(200)
 const old=(await app.inject({url:checkout})).json()
 expect(old.quote).toEqual(quoted.quote);expect(old.lines[0].stockRequirements[0].quantity).toBe(3)
 const paid=await app.inject({method:'POST',url:checkout+'/payment',payload:{revision:1,quoteId:quoted.quote.id,hash:key().replaceAll('-','').repeat(2)}})
 expect(paid.statusCode).toBe(200);expect(paid.json().paidSnapshot.lines[0].stockRequirements[0].quantity).toBe(3)
 expect((await s.call('GET','/inventory')).json().items[0].quantity).toBe(20)
})
it('rejects foreign resources, ambiguous mappings and unauthorized legacy edits',async()=>{
 const a=await setup(),b=await setup(),foreign=await resource(b),item=await resource(a),cashier=await terminal(a)
 const mapped={...a.coffee,variants:[{...a.coffee.variants[0],stockBindings:[{itemId:foreign.id,quantity:1}]}]}
 const denied=await a.call('POST','/catalog',mapped);expect(denied.statusCode).toBe(400);expect(denied.json().error.code).toBe('INVALID_STOCK_BINDING')
 const state=(await a.call('GET','/menu')).json()
 const draft=await a.call('PUT','/menu/draft',{revision:null,basePublishedRevision:state.publishedRevision,products:[mapped],reason:'Foreign binding',idempotencyKey:key()})
 expect(draft.json().error.code).toBe('INVALID_STOCK_BINDING')
 expect((await app.inject({method:'POST',url:a.base+'/catalog',headers:cashier,payload:{...mapped,variants:[{...mapped.variants[0],stockBindings:[{itemId:item.id,quantity:1}]}]}})).statusCode).toBe(403)
 const ambiguous=await a.call('POST','/catalog',{...a.bundle,variants:[{...a.bundle.variants[0],stockBindings:[{itemId:item.id,quantity:1}]}]})
 expect(ambiguous.json().error.code).toBe('INVALID_STOCK_BINDING')
})
it('saves publishes and restores complete resource mappings without changing existing loyalty promises',async()=>{
 const s=await setup(),item=await resource(s)
 expect((await app.inject({method:'POST',url:s.base+'/loyalty/program',headers:{...s.headers,'idempotency-key':key()},payload:{minimumMinor:400,productId:s.coffee.id,variantId:s.coffee.variants[0].id}})).statusCode).toBe(200)
 const promise=(await s.call('GET','/loyalty/program')).json()
 const mapped={...s.coffee,variants:[{...s.coffee.variants[0],stockBindings:[{itemId:item.id,quantity:2}]}]}
 const state=(await s.call('GET','/menu')).json()
 const saved=await s.call('PUT','/menu/draft',{revision:null,basePublishedRevision:state.publishedRevision,products:[mapped],reason:'Map stock',idempotencyKey:key()})
 expect(saved.statusCode).toBe(200)
 const published=await s.call('POST','/menu/publish',{draftRevision:saved.json().draft.revision,basePublishedRevision:state.publishedRevision,reason:'Publish stock map',idempotencyKey:key()})
 expect(published.statusCode).toBe(200);expect(published.json().products[0].variants[0].stockBindings).toEqual([{itemId:item.id,quantity:2}])
 const versions=(await s.call('GET','/menu/versions')).json()
 const version=versions.versions.find((v:any)=>v.products[0].variants[0].stockBindings?.length)
 const restored=await s.call('POST',`/menu/versions/${version.id}/restore`,{draftRevision:null,basePublishedRevision:published.json().publishedRevision,reason:'Restore mapping',idempotencyKey:key()})
 expect(restored.statusCode).toBe(200);expect(restored.json().draft.products[0].variants[0].stockBindings[0].itemId).toBe(item.id)
 expect((await s.call('GET','/loyalty/program')).json()).toEqual(promise)
})

it('reserves last tracked portions at quote and consumes them once on verified POS settlement',async()=>{
 const s=await setup(),item=await resource(s),cashier=await terminal(s)
 await s.call('POST','/catalog',{...s.coffee,variants:[{...s.coffee.variants[0],stockBindings:[{itemId:item.id,quantity:20}]}]})
 app.deps.merchantPayments={quote:async(input)=>({...input,id:key(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})}
 const order=async()=> (await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:s.coffee.id,variantId:s.coffee.variants[0].id,extraIds:[],quantity:1}]}})).json()
 const a=await order(),b=await order(),quote=(o:any)=>app.inject({method:'POST',url:`/v1/merchant/checkout/${o.checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-stock-buyer'}})
 const first=await quote(a);expect(first.statusCode).toBe(200)
 const second=await quote(b);expect(second.statusCode).toBe(409);expect(second.json().error.code).toBe('INSUFFICIENT_STOCK')
 expect((await s.call('GET','/inventory')).json().items[0]).toMatchObject({quantity:20,reservedQuantity:20,availableQuantity:0})
 const payload={revision:1,quoteId:first.json().quote.id,hash:'e'.repeat(64)},url=`/v1/merchant/checkout/${a.checkoutToken}/payment`
 expect((await app.inject({method:'POST',url,payload})).json().status).toBe('PREPARING')
 expect((await app.inject({method:'POST',url,payload})).statusCode).toBe(200)
 expect((await s.call('GET','/inventory')).json().items[0]).toMatchObject({quantity:0,reservedQuantity:0,availableQuantity:0})
 expect((await s.call('GET',`/inventory/${item.id}/movements`)).json().movements.filter((m:any)=>m.kind==='SALE')).toHaveLength(1)
})
