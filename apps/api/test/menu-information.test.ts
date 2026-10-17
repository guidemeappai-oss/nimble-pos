import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const {db,close}=await freshDb()
const {app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()})
it('keeps information private until publication and preserves it in version history',async()=>{
 const token=await tokenFor(await makeUser(db,'NQ-menu-information'))
 const headers={authorization:`Bearer ${token}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Info cafe',fiatCurrency:'EUR',nimAddress:'NQ-menu-information'}})).json()
 const base=`/v1/merchant/venues/${venue.id}`
 const information={sourceLanguage:'en',description:'Espresso',allergensReviewed:true,allergens:['milk'],translations:{pl:{name:'Kawa'}}}
 const product={id:crypto.randomUUID(),name:'Coffee',category:'Drinks',available:true,variants:[{id:crypto.randomUUID(),name:'Classic',priceMinor:100}],extras:[],information}
 const saved=await app.inject({method:'PUT',url:base+'/menu/draft',headers,payload:{idempotencyKey:crypto.randomUUID(),revision:null,basePublishedRevision:0,products:[product],reason:'Owner reviewed information'}})
 expect(saved.statusCode).toBe(200)
 expect((await app.inject({method:'GET',url:base+'/catalog',headers})).json()).toEqual([])
 expect((await app.inject({method:'POST',url:base+'/menu/publish',headers,payload:{idempotencyKey:crypto.randomUUID(),draftRevision:saved.json().draft.revision,basePublishedRevision:0,reason:'Approved information'}})).statusCode).toBe(200)
 expect((await app.inject({method:'GET',url:base+'/catalog',headers})).json()[0].information).toEqual(information)
 expect((await app.inject({method:'GET',url:base+'/menu/versions',headers})).json().versions[0].products[0].information).toEqual(information)
})
