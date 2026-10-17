import {afterAll,it,expect} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db);
afterAll(async()=>{await app.close();await close()});
const key=()=>crypto.randomUUID();
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-ops-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Ops',fiatCurrency:'EUR',nimAddress:'NQ-ops-owner-123'}})).json();
 const base=`/v1/merchant/venues/${venue.id}/inventory`;
 const call=async(path:string,payload?:unknown,method=payload?'POST':'GET')=>app.inject({method:method as any,url:base+path,headers,payload:payload as any});
 const item=(await call('',{name:'Cake',unit:'PIECE',tracked:true,openingQuantity:10,threshold:2,reason:'Opening',idempotencyKey:key()})).json();
 return {headers,base,call,item};
}
it('receives a delivery in parts, retries safely and reverses an incorrect receipt',async()=>{
 const {call,item}=await setup();
 const supplier=(await call('/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 const delivery=(await call('/deliveries',{supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:8,unitCostMinor:150}],idempotencyKey:key()})).json();
 const payload={lines:[{itemId:item.id,quantity:3}],reason:'Three arrived',idempotencyKey:key()};
 const partial=await call(`/deliveries/${delivery.id}/receipts`,payload);
 expect(partial.statusCode).toBe(200);expect(partial.json().status).toBe('PARTIAL');
 expect((await call(`/deliveries/${delivery.id}/receipts`,payload)).json()).toEqual(partial.json());
 expect((await call('')).json().items[0].quantity).toBe(13);
 const complete=(await call(`/deliveries/${delivery.id}/receipts`,{...payload,lines:[{itemId:item.id,quantity:5}],idempotencyKey:key()})).json();
 expect(complete.status).toBe('RECEIVED');
 const reversed=(await call(`/deliveries/${delivery.id}/receipts/${complete.receipts[0].id}/reverse`,{reason:'Wrong receipt',idempotencyKey:key()})).json();
 expect(reversed.status).toBe('PARTIAL');expect((await call('')).json().items[0].quantity).toBe(15);
});
it('finalizes a count against its opening snapshot without erasing later deliveries',async()=>{
 const {call,item}=await setup();
 const opened=(await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).json();
 expect(opened.lines[0]).toMatchObject({expectedQuantity:10,baselineRevision:1});
 await call(`/${item.id}/movements`,{delta:5,revision:1,reason:'Intervening addition',idempotencyKey:key()});
 const input={counts:[{itemId:item.id,countedQuantity:8,expectedRevision:2,acknowledgeIntervening:true}],reason:'Two missing at opening count',idempotencyKey:key()};
 const finalized=await call(`/stocktakes/${opened.id}/finalize`,input);
 expect(finalized.json()).toMatchObject({status:'FINALIZED',lines:[{difference:-2,countedQuantity:8}]});
 expect((await call('')).json().items[0].quantity).toBe(13);
 expect((await call(`/stocktakes/${opened.id}/finalize`,input)).json()).toEqual(finalized.json());
 expect((await call(`/stocktakes/${opened.id}/finalize`,{...input,idempotencyKey:key()})).statusCode).toBe(409);
});
async function manager(setupResult:Awaited<ReturnType<typeof setup>>,permissions=['inventory.manage']){
 const {base,headers}=setupResult,venueBase=base.replace('/inventory','');
 const employee=(await app.inject({method:'POST',url:venueBase+'/employees',headers,payload:{name:'Manager',pin:'1234'}})).json();
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions,reason:'Stock operations'}});
 const terminal=(await app.inject({method:'POST',url:venueBase+'/terminal',headers})).json();
 const token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token;
 const worker={authorization:`Bearer ${token}`};
 const call=async(path:string,payload?:unknown,method=payload?'POST':'GET')=>app.inject({method:method as any,url:base+path,headers:worker,payload:payload as any});
 return {call,employee};
}
it('redacts unit costs on reads, mutations, idempotent replay and audit while checking live permissions',async()=>{
 const setupResult=await setup(),{call:owner,item,headers,base}=setupResult,{call,employee}=await manager(setupResult,['inventory.manage','audit.view']);
 const supplier=(await owner('/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 const payload={supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:3,unitCostMinor:150}],idempotencyKey:key()};
 expect((await call('/deliveries',payload)).statusCode).toBe(403);
 const delivery=(await owner('/deliveries',payload)).json();
 expect(delivery.lines[0].unitCostMinor).toBe(150);
 const totalDelivery=(await owner('/deliveries',{supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:2,totalCostMinor:300}],idempotencyKey:key()})).json();
 const redactedTotal=(await call('/deliveries')).json().deliveries.find((d:any)=>d.id===totalDelivery.id);
 expect(redactedTotal.lines[0]).not.toHaveProperty('totalCostMinor');
 expect((await call('/deliveries')).json().deliveries[0].lines[0]).not.toHaveProperty('unitCostMinor');
 const received=(await call(`/deliveries/${delivery.id}/receipts`,{lines:[{itemId:item.id,quantity:2}],reason:'Received',idempotencyKey:key()})).json();
 expect(received.lines[0]).not.toHaveProperty('unitCostMinor');
 const audit=(await app.inject({url:base.replace('/inventory','/audit'),headers})).json();
 expect(JSON.stringify(audit)).not.toContain('unitCostMinor');
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:['inventory.manage','inventory.costs'],reason:'Costs access'}});
 expect((await call('/deliveries')).json().deliveries[0].lines[0].unitCostMinor).toBe(150);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:[],reason:'Revoke stock'}});
 expect((await call(`/deliveries/${delivery.id}/receipts`,{lines:[{itemId:item.id,quantity:1}],reason:'Received',idempotencyKey:key()})).statusCode).toBe(403);
});
it('requires owner approval for losses above threshold and prevents negative balances or legacy bypass',async()=>{
 const setupResult=await setup(),{call:owner,item}=setupResult,{call}=await manager(setupResult);
 const requested=(await call('/losses',{itemId:item.id,quantity:7,reason:'EXPIRED',comment:'Expired at closing',idempotencyKey:key()})).json();
 expect(requested.status).toBe('PENDING');expect((await owner('')).json().items[0].quantity).toBe(10);
 expect((await call(`/losses/${requested.id}/decision`,{decision:'APPROVE',reason:'Checked',idempotencyKey:key()})).statusCode).toBe(403);
 expect((await call(`/${item.id}/movements`,{delta:-7,revision:1,reason:'Bypass',idempotencyKey:key()})).statusCode).toBe(409);
 expect((await owner(`/${item.id}/movements`,{delta:-5,revision:1,reason:'Actual stock reduced',idempotencyKey:key()})).json().error.code).toBe('STOCK_RESERVED');
 expect((await owner('/losses')).json().losses[0].status).toBe('PENDING');
 const rejected=(await owner(`/losses/${requested.id}/decision`,{decision:'REJECT',reason:'Correct count first',idempotencyKey:key()})).json();expect(rejected.status).toBe('REJECTED');
 expect((await owner(`/${item.id}/movements`,{delta:-5,revision:1,reason:'Correct count after resolving loss',idempotencyKey:key()})).statusCode).toBe(200);
 await owner('/loss-policy',{approvalThreshold:2,reason:'Small losses allowed'},'PATCH');
 const payload={itemId:item.id,quantity:2,reason:'DAMAGED',comment:'Two damaged',idempotencyKey:key()};
 const loss=await call('/losses',payload);expect(loss.json().status).toBe('APPLIED');
 expect((await call('/losses',payload)).json()).toEqual(loss.json());expect((await owner('')).json().items[0].quantity).toBe(3);
 expect((await owner(`/${item.id}/movements/${loss.json().movementId}/reverse`,{revision:3,reason:'Cannot generic reverse loss',idempotencyKey:key()})).statusCode).toBe(409);
});
it('isolates venues, validates barcode lookup and rolls back invalid counts and receipt corrections',async()=>{
 const {call,item}=await setup(),other=await setup();
 await call(`/${item.id}`,{name:'Cake',tracked:true,threshold:2,barcode:'1234567890',revision:1,reason:'Label'},'PATCH');
 expect((await call('/lookup?barcode=1234567890')).json().items[0].id).toBe(item.id);
 expect((await other.call('/lookup?barcode=1234567890')).json().items).toEqual([]);
 expect((await other.call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).statusCode).toBe(404);
 const count=(await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).json();
 await call(`/${item.id}/movements`,{delta:-9,revision:2,reason:'Later reduction',idempotencyKey:key()});
 expect((await call(`/stocktakes/${count.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:0}],reason:'Opening shortage',idempotencyKey:key()})).statusCode).toBe(409);
 expect((await call('/stocktakes')).json().stocktakes[0].status).toBe('OPEN');expect((await call('')).json().items[0].quantity).toBe(1);
});
it('checks the whole stocktake shortage against the per-operation approval limit',async()=>{
 const setupResult=await setup(),{call:owner,item}=setupResult,{call}=await manager(setupResult);
 const second=(await owner('',{name:'Soup',unit:'PORTION',tracked:true,openingQuantity:5,threshold:1,reason:'Opening',idempotencyKey:key()})).json();
 await owner('/loss-policy',{approvalThreshold:2,reason:'Two per operation'},'PATCH');
 const snapshot=(await call('/stocktakes',{itemIds:[item.id,second.id],idempotencyKey:key()})).json();
 const counts={counts:[{itemId:item.id,countedQuantity:8},{itemId:second.id,countedQuantity:3}],reason:'Four total missing',idempotencyKey:key()};
 expect((await call(`/stocktakes/${snapshot.id}/finalize`,counts)).statusCode).toBe(409);
 expect((await owner('')).json().items.map((i:any)=>i.quantity)).toEqual([10,5]);
 expect((await owner(`/stocktakes/${snapshot.id}/finalize`,counts)).json().status).toBe('FINALIZED');
});
it('requires explicit review of intervening stock movements and rejects stale previews',async()=>{
 const {call,item}=await setup();
 const snapshot=(await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).json();
 await call(`/${item.id}/movements`,{delta:10,revision:1,reason:'Delivery after cutoff',idempotencyKey:key()});
 const preview=(await call(`/stocktakes/${snapshot.id}`)).json();expect(preview.lines[0]).toMatchObject({expectedQuantity:10,currentQuantity:20,interveningDelta:10,currentRevision:2});
 const payload={counts:[{itemId:item.id,countedQuantity:8}],reason:'Count at opening time',idempotencyKey:key()};
 const missing=await call(`/stocktakes/${snapshot.id}/finalize`,payload);expect(missing.statusCode).toBe(409);expect(missing.json().error.code).toBe('STOCKTAKE_MOVEMENTS_CHANGED');
 await call(`/${item.id}/movements`,{delta:1,revision:2,reason:'Later correction',idempotencyKey:key()});
 expect((await call(`/stocktakes/${snapshot.id}/finalize`,{...payload,counts:[{itemId:item.id,countedQuantity:8,expectedRevision:2,acknowledgeIntervening:true}]})).statusCode).toBe(409);
 expect((await call(`/stocktakes/${snapshot.id}/finalize`,{...payload,counts:[{itemId:item.id,countedQuantity:8,expectedRevision:3,acknowledgeIntervening:true}]})).json().status).toBe('FINALIZED');
 expect((await call('')).json().items[0].quantity).toBe(19);
});
it('redacts previously privileged retry results after cost permission is revoked',async()=>{
 const setupResult=await setup(),{call:owner,item,headers}=setupResult,{call,employee}=await manager(setupResult,['inventory.manage','inventory.costs']);
 const supplier=(await owner('/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 const input={supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:3,unitCostMinor:150}],idempotencyKey:key()};
 expect((await call('/deliveries',input)).json().lines[0].unitCostMinor).toBe(150);
 const delivery=(await owner('/deliveries')).json().deliveries[0];
 const receipt={lines:[{itemId:item.id,quantity:1}],reason:'Received',idempotencyKey:key()};
 expect((await call(`/deliveries/${delivery.id}/receipts`,receipt)).json().lines[0].unitCostMinor).toBe(150);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:['inventory.manage'],reason:'Costs revoked'}});
 expect((await call(`/deliveries/${delivery.id}/receipts`,receipt)).json().lines[0]).not.toHaveProperty('unitCostMinor');
 const all=['menu.manage','reports.view','inventory.manage','tasks.manage','photos.view','discounts.apply','audit.view','inventory.costs'];
 expect((await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:all,reason:'All management capabilities'}})).statusCode).toBe(200);
});
it('blocks stocktakes while overlapping losses await a decision, including new requests after opening',async()=>{
 const setupResult=await setup(),{call:owner,item}=setupResult,{call}=await manager(setupResult);
 const pending=(await call('/losses',{itemId:item.id,quantity:2,reason:'EXPIRED',comment:'Closing expired',idempotencyKey:key()})).json();
 const blocked=await owner('/stocktakes',{itemIds:[item.id],idempotencyKey:key()});expect(blocked.statusCode).toBe(409);expect(blocked.json().error.code).toBe('STOCKTAKE_PENDING_LOSSES');
 await owner(`/losses/${pending.id}/decision`,{decision:'REJECT',reason:'Recount first',idempotencyKey:key()});
 const snapshot=(await owner('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).json();
 await call('/losses',{itemId:item.id,quantity:2,reason:'DAMAGED',comment:'New loss',idempotencyKey:key()});
 const finalized=await owner(`/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:8}],reason:'Recount',idempotencyKey:key()});expect(finalized.statusCode).toBe(409);expect(finalized.json().error.code).toBe('STOCKTAKE_PENDING_LOSSES');
 expect((await owner('')).json().items[0].quantity).toBe(10);
});
it('guards receipt reversals by the whole receipt quantity and preserves a truthful ledger',async()=>{
 const setupResult=await setup(),{call:owner,item}=setupResult,{call}=await manager(setupResult);
 const supplier=(await owner('/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 const delivery=(await owner('/deliveries',{supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:5}],idempotencyKey:key()})).json();
 const received=(await call(`/deliveries/${delivery.id}/receipts`,{lines:[{itemId:item.id,quantity:5}],reason:'Received',idempotencyKey:key()})).json();
 const path=`/deliveries/${delivery.id}/receipts/${received.receipts[0].id}/reverse`,payload={reason:'Receipt was entered twice externally',idempotencyKey:key()};
 expect((await call(path,payload)).statusCode).toBe(409);expect((await owner('')).json().items[0].quantity).toBe(15);
 expect((await owner(path,payload)).json().status).toBe('OPEN');expect((await owner('')).json().items[0].quantity).toBe(10);
});
it('prevents overlapping open stocktakes of the same items and permits a new count after finalization',async()=>{
 const {call,item}=await setup();
 const snapshot=(await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).json();
 const overlapping=await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()});
 expect(overlapping.statusCode).toBe(409);expect(overlapping.json().error.code).toBe('STOCKTAKE_ALREADY_OPEN');
 const second=(await call('',{name:'Soup',unit:'PORTION',tracked:true,openingQuantity:5,threshold:1,reason:'Opening',idempotencyKey:key()})).json();
 expect((await call('/stocktakes',{itemIds:[second.id],idempotencyKey:key()})).statusCode).toBe(200);
 expect((await call(`/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:8}],reason:'Opening count',idempotencyKey:key()})).json().status).toBe('FINALIZED');
 const next=await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()});expect(next.statusCode).toBe(200);expect(next.json().lines[0].expectedQuantity).toBe(8);
});

it('applies a concurrently retried delivery receipt exactly once',async()=>{
 const {call,item}=await setup();
 const supplier=(await call('/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 const delivery=(await call('/deliveries',{supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:8}],idempotencyKey:key()})).json();
 const payload={lines:[{itemId:item.id,quantity:3}],reason:'Concurrent retry',idempotencyKey:key()};
 const responses=await Promise.all([call(`/deliveries/${delivery.id}/receipts`,payload),call(`/deliveries/${delivery.id}/receipts`,payload)]);
 expect(responses.map(r=>r.statusCode)).toEqual([200,200]);
 expect(responses[0].json()).toEqual(responses[1].json());
 expect((await call('')).json().items[0].quantity).toBe(13);
});
it('allows only one overlapping stocktake to open concurrently',async()=>{
 const {call,item}=await setup();
 const responses=await Promise.all([1,2].map(()=>call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})));
 expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
 expect(responses.find(r=>r.statusCode===409)!.json().error.code).toBe('STOCKTAKE_ALREADY_OPEN');
 expect((await call('/stocktakes')).json().stocktakes).toHaveLength(1);
 expect((await call('')).json().items[0].quantity).toBe(10);
});
it('applies only one of two concurrent owner loss decisions',async()=>{
 const f=await setup(),{call}=await manager(f);
 const loss=(await call('/losses',{itemId:f.item.id,quantity:3,reason:'EXPIRED',comment:'Checked',idempotencyKey:key()})).json();
 expect(loss.status).toBe('PENDING');
 const responses=await Promise.all([1,2].map(()=>f.call(`/losses/${loss.id}/decision`,{decision:'APPROVE',reason:'Checked',idempotencyKey:key()})));
 expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
 expect(responses.find(r=>r.statusCode===409)!.json().error.code).toBe('ALREADY_DECIDED');
 expect((await f.call('')).json().items[0].quantity).toBe(7);
});
it('reconciles food allocations, preserves later deliveries and holds disposal out of sale',async()=>{
 const {call,item}=await setup();
 const opened=await call('/stocktakes',{itemIds:[item.id],foodDay:{timeZone:'Europe/Warsaw',boundaryHour:4},idempotencyKey:key()});
 expect(opened.statusCode).toBe(200);
 const snapshot=opened.json();expect(snapshot.foodDay).toMatchObject({timeZone:'Europe/Warsaw',boundaryHour:4});
 expect(snapshot.foodDay.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(snapshot.lines[0].reservedQuantity).toBe(0);
 await call(`/${item.id}/movements`,{delta:5,revision:1,reason:'Later delivery',idempotencyKey:key()});
 const payload={counts:[{itemId:item.id,countedQuantity:8,allocation:{keep:3,disposal:2,donation:2,staffMeal:1},expectedRevision:2,acknowledgeIntervening:true}],reason:'Food close',idempotencyKey:key()};
 const result=await call(`/stocktakes/${snapshot.id}/finalize`,payload);
 expect(result.statusCode).toBe(200);expect(result.json().lines[0]).toMatchObject({difference:-2,allocation:payload.counts[0].allocation});
 expect((await call(`/stocktakes/${snapshot.id}/finalize`,payload)).json()).toEqual(result.json());
 expect((await call('')).json().items[0]).toMatchObject({quantity:10,pendingLossQuantity:2,availableQuantity:8});
 const loss=(await call('/losses')).json().losses[0];expect(loss.foodStocktakeId).toBe(snapshot.id);
 expect((await call(`/losses/${loss.id}/decision`,{decision:'APPROVE',reason:'Needs photos',idempotencyKey:key()})).json().error.code).toBe('FOOD_DISPOSAL_EVIDENCE_REQUIRED');
 expect((await call(`/losses/${loss.id}/decision`,{decision:'REJECT',reason:'Correct evidence',idempotencyKey:key()})).json()).toMatchObject({status:'PENDING',disposalReview:{decision:'REJECT'}});
 expect((await call('')).json().items[0]).toMatchObject({pendingLossQuantity:2,availableQuantity:8});
});
it('rejects invalid food allocation sums and overlapping generic counts without changing stock',async()=>{
 const {call,item}=await setup();
 const snapshot=(await call('/stocktakes',{itemIds:[item.id],foodDay:{timeZone:'UTC',boundaryHour:0},idempotencyKey:key()})).json();
 expect((await call('/stocktakes',{itemIds:[item.id],idempotencyKey:key()})).statusCode).toBe(409);
 const bad=await call(`/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:8,allocation:{keep:8,disposal:1,donation:0,staffMeal:0}}],reason:'Invalid split',idempotencyKey:key()});
 expect(bad.json().error.code).toBe('FOOD_ALLOCATION_MISMATCH');
 expect((await call('')).json().items[0].quantity).toBe(10);
 expect((await call('/stocktakes')).json().stocktakes[0].status).toBe('OPEN');
});
it('requires before/after food evidence and applies concurrent approvals once',async()=>{
 const {call,item,headers,base}=await setup();
 const snapshot=(await call('/stocktakes',{itemIds:[item.id],foodDay:{timeZone:'UTC',boundaryHour:0},idempotencyKey:key()})).json();
 await call(`/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:10,allocation:{keep:7,disposal:3,donation:0,staffMeal:0}}],reason:'Closing food',idempotencyKey:key()});
 const loss=(await call('/losses')).json().losses[0],taskBase=base.replace('/inventory','')+`/tasks/${loss.evidenceTaskId}`;
 const action=async(action:string,revision:number,reason='Reviewed')=>app.inject({method:'POST',url:taskBase+'/actions',headers,payload:{action,revision,reason,idempotencyKey:key()}});
 expect((await action('SUBMIT',1)).json().error.code).toBe('TASK_BEFORE_PHOTO_REQUIRED');
 const sharp=(await import('sharp')).default;
 const image=await sharp({create:{width:4,height:4,channels:3,background:'#fff'}}).jpeg().toBuffer();
 for(const phase of ['BEFORE','AFTER']) {
  const upload=await app.inject({method:'POST',url:taskBase+'/photos',headers,payload:{phase,source:'CAMERA',base64:image.toString('base64'),idempotencyKey:key()}});
  expect(upload.statusCode).toBe(201);
 }
 expect((await action('SUBMIT',1)).statusCode).toBe(200);
 expect((await action('OWNER_DECLARE',2)).statusCode).toBe(200);
 const payload={decision:'APPROVE',reason:'Verified disposal',idempotencyKey:key()};
 const approvals=await Promise.all([call(`/losses/${loss.id}/decision`,payload),call(`/losses/${loss.id}/decision`,payload)]);
 expect(approvals.map(r=>r.statusCode)).toEqual([200,200]);expect(approvals[0].json()).toEqual(approvals[1].json());
 expect((await call('')).json().items[0]).toMatchObject({quantity:7,pendingLossQuantity:0,availableQuantity:7});
});
it('records an explicit owner photo exception before disposal approval',async()=>{
 const {call,item,headers,base}=await setup();
 const snapshot=(await call('/stocktakes',{itemIds:[item.id],foodDay:{timeZone:'UTC',boundaryHour:0},idempotencyKey:key()})).json();
 await call(`/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:item.id,countedQuantity:10,allocation:{keep:9,disposal:1,donation:0,staffMeal:0}}],reason:'Broken camera',idempotencyKey:key()});
 const loss=(await call('/losses')).json().losses[0];
 expect((await app.inject({method:'POST',url:base.replace('/inventory','')+`/tasks/${loss.evidenceTaskId}/actions`,headers,payload:{action:'OWNER_EXCEPTION',revision:1,reason:'Camera failed; checked in person',idempotencyKey:key()}})).statusCode).toBe(200);
 expect((await call(`/losses/${loss.id}/decision`,{decision:'APPROVE',reason:'Exception reviewed',idempotencyKey:key()})).statusCode).toBe(200);
 expect((await call('')).json().items[0].quantity).toBe(9);
});
