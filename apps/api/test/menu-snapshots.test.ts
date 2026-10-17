import {afterAll,expect,it} from 'vitest'
import {freshDb} from './helpers/db'
import {authedApp,makeUser} from './helpers/actors'
const {db,close}=await freshDb()
const {app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
const key=()=>crypto.randomUUID()
async function setup(){
 const address='NQ-menu-snap-'+key()
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Snapshot Cafe',fiatCurrency:'EUR',nimAddress:address}})).json()
 const base=`/v1/merchant/venues/${venue.id}`
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload})
 const product=(await call('POST','/catalog',{name:'Coffee',category:'Drinks',available:true,variants:[{id:key(),name:'Classic',priceMinor:450}],extras:[]})).json()
 return {headers,venue,base,call,product}
}
async function draft(s:Awaited<ReturnType<typeof setup>>,products:any[]){
 const current=(await s.call('GET','/menu')).json()
 const saved=await s.call('PUT','/menu/draft',{revision:current.draft?.revision??null,basePublishedRevision:current.publishedRevision,products,reason:'Prepare new prices',idempotencyKey:key()})
 expect(saved.statusCode).toBe(200)
 return {draftRevision:saved.json().draft.revision,basePublishedRevision:current.publishedRevision,reason:'Publish checked prices',idempotencyKey:key()}
}
it('preserves a paid order and valid quote when a new menu changes the same variant price',async()=>{
 const s=await setup()
 const employee=(await s.call('POST','/employees',{name:'Ana',pin:'1234'})).json()
 const terminal=(await s.call('POST','/terminal')).json()
 const token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token
 const cashier={authorization:`Bearer ${token}`}
 expect((await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier})).statusCode).toBe(201)
 app.deps.merchantPayments={quote:async(input)=>({...input,id:key(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})}
 const create=async()=>{
  const r=await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:s.product.id,variantId:s.product.variants[0].id,extraIds:[],quantity:1}]}})
  expect(r.statusCode).toBe(201);return r.json()
 }
 const quoted=async(o:any)=>{const r=await app.inject({method:'POST',url:`/v1/merchant/checkout/${o.checkoutToken}/quote`,payload:{revision:o.revision,asset:'NIM',sender:'NQ-menu-customer-123'}});expect(r.statusCode).toBe(200);return r.json()}
 const first=await quoted(await create())
 const paid=await app.inject({method:'POST',url:`/v1/merchant/checkout/${first.checkoutToken}/payment`,payload:{revision:first.revision,quoteId:first.quote.id,hash:key().replaceAll('-','').repeat(2)}})
 expect(paid.statusCode).toBe(200);expect(paid.json().status).toBe('PREPARING')
 const waiting=await quoted(await create())
 const command=await draft(s,[{...s.product,name:'New Coffee',variants:[{...s.product.variants[0],priceMinor:650}]}])
 expect((await s.call('POST','/menu/publish',command)).statusCode).toBe(200)
 const oldPaid=(await app.inject({url:`/v1/merchant/checkout/${first.checkoutToken}`})).json()
 expect(oldPaid.totalMinor).toBe(450);expect(oldPaid.lines[0].productName).toBe('Coffee')
 const oldWaiting=await quoted(waiting)
 expect(oldWaiting.quote).toEqual(waiting.quote);expect(oldWaiting.totalMinor).toBe(450)
 expect((await create()).totalMinor).toBe(650)
 const history=(await s.call('GET','/menu/versions')).json()
 const baseline=history.versions.find((version:any)=>version.products[0]?.variants[0]?.priceMinor===450)
 expect(baseline).toBeDefined()
 const current=(await s.call('GET','/menu')).json()
 const restored=await s.call('POST',`/menu/versions/${baseline.id}/restore`,{draftRevision:null,basePublishedRevision:current.publishedRevision,reason:'Restore imported original menu',idempotencyKey:key()})
 expect(restored.statusCode).toBe(200)
 expect(restored.json().draft.products[0].variants[0].priceMinor).toBe(450)
 expect((await s.call('GET','/catalog')).json()[0].variants[0].priceMinor).toBe(650)
})
it('rejects a menu removing an active loyalty variant and leaves all published products unchanged',async()=>{
 const s=await setup()
 const second=(await s.call('POST','/catalog',{name:'Cake',category:'Food',available:true,variants:[{id:key(),name:'Slice',priceMinor:300}],extras:[]})).json()
 expect((await app.inject({method:'POST',url:s.base+'/loyalty/program',headers:{...s.headers,'idempotency-key':key()},payload:{minimumMinor:400,productId:s.product.id,variantId:s.product.variants[0].id}})).statusCode).toBe(200)
 const before=(await s.call('GET','/catalog')).json()
 const command=await draft(s,[{...s.product,variants:[{id:key(),name:'Different',priceMinor:700}]},{...second,variants:[{...second.variants[0],priceMinor:800}]}])
 const rejected=await s.call('POST','/menu/publish',command)
 expect(rejected.statusCode).toBe(409);expect(rejected.json().error.code).toBe('LOYALTY_REWARD_PRODUCT_LOCKED')
 expect((await s.call('GET','/catalog')).json()).toEqual(before)
 expect((await s.call('GET','/menu')).json().draft).not.toBeNull()
})
