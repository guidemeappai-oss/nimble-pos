import {readFile} from 'node:fs/promises';
import {sql} from 'drizzle-orm';
import * as schema from '../src/db/schema';
import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db),key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-lots-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Lots',fiatCurrency:'EUR',nimAddress:'NQ-lots-123'}})).json();
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:`/v1/merchant/venues/${venue.id}`+path,headers,payload});
 const item=(await call('POST','/inventory',{name:'Milk',unit:'MILLILITRE',openingQuantity:10,tracked:true,threshold:0,reason:'Opening',idempotencyKey:key()})).json();
 const supplier=(await call('POST','/inventory/suppliers',{name:'Supplier',idempotencyKey:key()})).json();
 async function receive(label:string,expiresAt:string,quantity=20){const d=(await call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:quantity}],idempotencyKey:key()})).json();const r=await call('POST',`/inventory/deliveries/${d.id}/receipts`,{lines:[{itemId:item.id,quantity,lot:{label,expiresAt}}],reason:'Received lot',idempotencyKey:key()});expect(r.statusCode).toBe(200);return {d,r:r.json()}}
 const lots=async(query='')=>(await call('GET',`/inventory/${item.id}/lots`+query)).json();
 return {call,item,receive,lots,headers,venue};
}
it('allocates earliest expiry before unknown dates, preserves expired stock and stable metadata retries',async()=>{
 const f=await setup();await f.receive('Later','2030-05-01T12:00:00Z');await f.receive('Expired','2020-01-01T12:00:00Z');
 const before=await f.lots('?quantity=25');expect(before.physicalQuantity).toBe(50);expect(before.expiryPolicy).toBe('ALERT_ONLY');expect(before.suggested.map((l:any)=>[l.label,l.quantity])).toEqual([['Expired',20],['Later',5]]);expect(before.items.find((l:any)=>l.label==='Expired').expired).toBe(true);expect(before.items.at(-1).expiresAt).toBeNull();
 const lot=before.items[0],payload={label:'Reviewed expired lot',expiresAt:lot.expiresAt,reason:'Correct label only',idempotencyKey:key()};
 const a=await f.call('PATCH',`/inventory/${f.item.id}/lots/${lot.id}`,payload),b=await f.call('PATCH',`/inventory/${f.item.id}/lots/${lot.id}`,payload);expect(a.statusCode).toBe(200);expect(b.json()).toEqual(a.json());
 const stock=(await f.call('GET','/inventory')).json().items[0];
 expect((await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-25,revision:stock.revision,reason:'Consume expiry first',idempotencyKey:key()})).statusCode).toBe(200);
 const after=await f.lots();expect(after.items.reduce((s:number,l:any)=>s+l.quantity,0)).toBe(25);expect(after.items.find((l:any)=>l.id===lot.id).quantity).toBe(0);
});
it('cannot reverse a receipt using stock belonging to a different lot',async()=>{
 const f=await setup(),first=await f.receive('First','2027-01-01T00:00:00Z');
 let item=(await f.call('GET','/inventory')).json().items[0];
 await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-20,revision:item.revision,reason:'Consume original receipt',idempotencyKey:key()});
 await f.receive('Replacement','2028-01-01T00:00:00Z');
 const response=await f.call('POST',`/inventory/deliveries/${first.d.id}/receipts/${first.r.receipts[0].id}/reverse`,{reason:'Cannot use replacement lot',idempotencyKey:key()});
 expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe('LOT_STOCK_UNAVAILABLE');expect((await f.lots()).physicalQuantity).toBe(30);
});
it('reconciles opposite lot differences atomically without changing total stock and rejects mismatched totals',async()=>{
 const f=await setup();await f.receive('Known','2027-01-01T00:00:00Z');
 const snapshot=(await f.call('POST','/inventory/stocktakes',{itemIds:[f.item.id],idempotencyKey:key()})).json();
 const line=snapshot.lines[0],lots=line.lots;
 const lotCounts=lots.map((l:any,i:number)=>({lotId:l.lotId,countedQuantity:l.quantity+(i===0?-2:2)}));
 const bad=await f.call('POST',`/inventory/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:f.item.id,countedQuantity:29,lotCounts}],reason:'Wrong aggregate count',idempotencyKey:key()});expect(bad.statusCode).toBe(400);
 const response=await f.call('POST',`/inventory/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:f.item.id,countedQuantity:30,lotCounts}],reason:'Correct lot attribution',idempotencyKey:key()});expect(response.statusCode).toBe(200);
 const after=await f.lots();expect(after.physicalQuantity).toBe(30);for(const c of lotCounts)expect(after.items.find((l:any)=>l.id===c.lotId).quantity).toBe(c.countedQuantity);
});
it('rejects foreign lot metadata and a loss attributed to a foreign lot',async()=>{
 const a=await setup(),b=await setup(),lot=(await b.lots()).items[0];
 expect((await a.call('PATCH',`/inventory/${a.item.id}/lots/${lot.id}`,{label:'Wrong venue',expiresAt:null,reason:'Invalid cross venue edit',idempotencyKey:key()})).statusCode).toBe(404);
 expect((await a.call('POST','/inventory/losses',{itemId:a.item.id,lotId:lot.id,quantity:1,reason:'DAMAGED',comment:'Wrong resource lot',idempotencyKey:key()})).statusCode).toBe(409);
 expect((await a.lots()).physicalQuantity).toBe(10);
});

it('protects a specific lot held by a pending loss while allowing consumption of other lots',async()=>{
 const f=await setup();await f.receive('Held expired milk','2020-01-01T00:00:00Z');
 const employee=(await f.call('POST','/employees',{name:'Manager',pin:'1234'})).json();
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers:f.headers,payload:{role:'MANAGER',permissions:['inventory.manage'],reason:'Stock management'}});
 const terminal=(await f.call('POST','/terminal')).json(),token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token;
 const heldLot=(await f.lots()).items[0];
 const loss=await app.inject({method:'POST',url:`/v1/merchant/venues/${f.venue.id}/inventory/losses`,headers:{authorization:`Bearer ${token}`},payload:{itemId:f.item.id,lotId:heldLot.id,quantity:20,reason:'EXPIRED',comment:'Hold expired milk for review',idempotencyKey:key()}});expect(loss.statusCode).toBe(200);expect(loss.json().status).toBe('PENDING');
 const item=(await f.call('GET','/inventory')).json().items[0];
 expect((await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-10,revision:item.revision,reason:'Consume unheld opening stock',idempotencyKey:key()})).statusCode).toBe(200);
 expect((await f.lots()).items.find((l:any)=>l.id===heldLot.id).quantity).toBe(20);
 expect((await f.call('POST',`/inventory/losses/${loss.json().id}/decision`,{decision:'APPROVE',reason:'Confirmed disposal',idempotencyKey:key()})).statusCode).toBe(200);
 expect((await f.lots()).physicalQuantity).toBe(0);
});
it('backfills existing physical balances without inventing expiry, receipt time or historical movement attribution',async()=>{
 const f=await setup();
 const migration=await readFile(new URL('../drizzle/0038_inventory_lots.sql',import.meta.url),'utf8');
 await db.transaction(async tx=>{
  await tx.delete(schema.merchantInventoryLot);
  await tx.execute(sql.raw(migration.slice(migration.indexOf('INSERT INTO merchant_inventory_lot'))));
  const lots=await tx.select().from(schema.merchantInventoryLot);
  const migrated=lots.find(l=>l.itemId===f.item.id)!;
  expect(migrated).toMatchObject({quantity:10,source:'LEGACY',expiresAt:null,receivedAt:null,sourceId:null});
  const items=await tx.select().from(schema.merchantInventoryItem);
  expect(lots.reduce((n,l)=>n+l.quantity,0)).toBe(items.reduce((n,i)=>n+i.quantity,0));
 });
});
