import {settleDepositLink,checkDepositRefund} from '../services/depositSettlement';
import {createHash,randomUUID} from 'node:crypto';
import {and,asc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {DepositResolution,MerchantQuote,MerchantPayment,WalletObservation} from '@nimble/shared';
import * as s from '../db/schema';
import type {Db} from '../db/client';
import {loyaltyFail as fail} from '../services/loyalty';
import {inventoryRetry} from '../services/inventory';
import {configuredWalletSource} from '../services/walletDiscovery';
import {submitMerchantPaymentIntent} from '../services/merchantPaymentIntent';
import {assertUnassigned} from '../services/merchantSettlement';
import {claimTransfer} from '../services/transferClaims';
import {unavailableMerchantPayments} from '../services/merchantGateway';
import {USDT_POLYGON} from '../services/merchantPayments';
import {taskActorKey,type MerchantTaskHelpers,type MerchantActor} from './tasks';
const uuid=z.string().uuid(),same=(a:string,b:string)=>a.replace(/\s/g,'').toLowerCase()===b.replace(/\s/g,'').toLowerCase();
/** Only positive canonical facts can prove a mismatch. Missing RPC data always remains UNVERIFIED. */
export function depositMismatch(e:WalletObservation,q:MerchantQuote){
 if(e.confirmation!=='FINALIZED')return null;
 if(e.asset!==q.asset||e.network!==q.network)return 'WRONG_ASSET_OR_NETWORK';
 if(!same(e.recipient,q.recipient))return 'WRONG_RECIPIENT';
 if(e.sender&&!same(e.sender,q.sender))return 'WRONG_SENDER';
 if(e.amountAtomic!==q.amountAtomic)return 'WRONG_AMOUNT';
 return null;
}
export async function depositResolutionRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/deposit-resolutions',gateway=()=>app.deps.merchantPayments??unavailableMerchantPayments;
 const finishLink=(venueId:string,id:string)=>settleDepositLink(db,gateway(),venueId,id),checkRefund=(venueId:string,id:string)=>checkDepositRefund(db,gateway(),venueId,id);
 async function context(req:FastifyRequest){const a=await h.actor(req);if(a.kind!=='owner')return fail(403,'OWNER_REQUIRED');const venueId=uuid.parse((req.params as any).venueId);await h.venueFor(a,venueId);return {a,venueId}}
 async function observation(venueId:string,id:string){const [row]=await db.select().from(s.merchantWalletObservation).where(and(eq(s.merchantWalletObservation.id,id),eq(s.merchantWalletObservation.venueId,venueId)));if(!row)return fail(404,'NOT_FOUND');return row}
 async function resolution(store:Db,venueId:string,id:string,lock=false){const query=store.select().from(s.merchantDepositResolution).where(and(eq(s.merchantDepositResolution.id,id),eq(s.merchantDepositResolution.venueId,venueId)));const [row]=lock?await query.for('update'):await query;if(!row)return fail(404,'NOT_FOUND');return row.data}
 async function save(store:Db,value:DepositResolution){await store.update(s.merchantDepositResolution).set({data:value,updatedAt:new Date()}).where(eq(s.merchantDepositResolution.id,value.id));return value}
 async function replay(a:MerchantActor,venueId:string,key:string,payload:unknown){const [row]=await db.select().from(s.merchantInventoryRequest).where(and(eq(s.merchantInventoryRequest.venueId,venueId),eq(s.merchantInventoryRequest.actor,taskActorKey(a)),eq(s.merchantInventoryRequest.key,key)));if(!row)return null;if(row.requestHash!==createHash('sha256').update(JSON.stringify(payload)).digest('hex'))fail(409,'IDEMPOTENCY_CONFLICT');return row.response as {id:string}}
 async function confirmed(e:WalletObservation){let next:WalletObservation;try{next=await (app.deps.walletDiscovery??configuredWalletSource()).refresh(e)}catch{return fail(503,'VERIFICATION_UNAVAILABLE')}
  if(next.eventKey!==e.eventKey||next.hash.toLowerCase()!==e.hash.toLowerCase()||next.asset!==e.asset||next.network!==e.network||next.eventIndex!==e.eventIndex||!same(next.recipient,e.recipient)||next.amountAtomic!==e.amountAtomic||next.sender!==e.sender)fail(503,'INVALID_CHAIN_DATA');
  if(next.confirmation!=='FINALIZED'||!next.occurredAt)return fail(409,'DEPOSIT_UNVERIFIED');return next;
 }
 async function transaction<T>(a:MerchantActor,venueId:string,key:string,payload:unknown,run:(store:Db)=>Promise<T>){return db.transaction(async tx=>{await tx.select().from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId)).for('update');return inventoryRetry(tx as unknown as Db,a,venueId,key,payload,()=>run(tx as unknown as Db))})}
 app.get(base+'/order-context',async req=>{const {venueId}=await context(req),{orderId}=z.object({orderId:uuid}).parse(req.query),[order]=await db.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,orderId),eq(s.merchantOrder.venueId,venueId)));if(!order)return fail(404,'ORDER_NOT_FOUND');return {id:order.id,number:order.number,status:order.status,payment:order.payment,quotes:[...new Map([order.quote,...order.quoteHistory].filter((q):q is MerchantQuote=>!!q).map(q=>[q.id,q])).values()].map(q=>({...q,revision:Number(q.reference.split(':').at(-1))}))}});
 app.get(base,async req=>{const {venueId}=await context(req),{page}=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);const rows=await db.select().from(s.merchantDepositResolution).where(eq(s.merchantDepositResolution.venueId,venueId)).orderBy(asc(s.merchantDepositResolution.createdAt),asc(s.merchantDepositResolution.id)).limit(26).offset(page*25);return {items:rows.slice(0,25).map(r=>r.data),hasMore:rows.length>25}});
 app.post(base,async req=>{
  const {a,venueId}=await context(req),input=z.object({observationId:uuid,decision:z.enum(['UNMATCHED','LINK','EXCESS']),orderId:uuid.optional(),quoteId:z.string().min(1).max(128).optional(),revision:z.number().int().positive().optional(),reason:z.string().trim().min(3).max(500),idempotencyKey:uuid}).strict().parse(req.body),payload={action:'deposit.resolve',input};
  if(input.decision!=='UNMATCHED'&&!input.orderId||input.decision==='LINK'&&(!input.quoteId||!input.revision))fail(400,'ORDER_QUOTE_REQUIRED');
  const oldIntent=await replay(a,venueId,input.idempotencyKey,payload);if(oldIntent)return finishLink(venueId,oldIntent.id);
  const observed=await observation(venueId,input.observationId),event=input.decision==='UNMATCHED'?observed.event:await confirmed(observed.event);
  const intent=await transaction(a,venueId,input.idempotencyKey,payload,async store=>{
   const [locked]=await store.select().from(s.merchantWalletObservation).where(eq(s.merchantWalletObservation.id,observed.id)).for('update');
   if(locked.event.eventKey!==event.eventKey)fail(409,'OBSERVATION_CHANGED');
   const [prior]=await store.select().from(s.merchantDepositResolution).where(eq(s.merchantDepositResolution.observationId,observed.id)).for('update'),old=prior?.data;
   if(old&&(['EXCESS','LINKED'].includes(old.kind)||old.kind==='LINK_PENDING'&&input.decision!=='EXCESS'))fail(409,'DEPOSIT_ALREADY_RESOLVED');
   const value:DepositResolution={id:old?.id??randomUUID(),venueId,observationId:observed.id,kind:'UNMATCHED',event,orderId:input.decision==='UNMATCHED'?null:input.orderId??null,quoteId:input.decision==='UNMATCHED'?null:input.quoteId??null,revision:input.decision==='UNMATCHED'?null:input.revision??null,reason:input.reason,decidedBy:taskActorKey(a),decidedAt:new Date().toISOString(),verification:'UNVERIFIED',verificationCode:null,refund:null};
   if(input.decision!=='UNMATCHED'){
    const [order]=await store.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id,input.orderId!),eq(s.merchantOrder.venueId,venueId))).for('update');if(!order)return fail(404,'ORDER_NOT_FOUND');
    if(input.decision==='LINK'){
     const quote=[order.quote,...order.quoteHistory].find(q=>q?.id===input.quoteId);if(!quote||quote.reference!==`nimble-order:${order.id}:${input.revision}`)return fail(409,'STALE_QUOTE');
     const mismatch=depositMismatch(event,quote);
     if(mismatch){value.kind='MISMATCH';value.verification='CONFIRMED_MISMATCH';value.verificationCode=mismatch}
     else if(order.payment&&same(order.payment.hash,event.hash)&&order.payment.network===event.network){value.kind='LINKED';value.verification='VERIFIED'}
     else {await submitMerchantPaymentIntent(store,order,{revision:input.revision!,quoteId:input.quoteId!,hash:event.hash});value.kind='LINK_PENDING'}
    }else {
     if(order.payment){if(same(order.payment.hash,event.hash)&&order.payment.network===event.network)fail(409,'ADDITIONAL_PAYMENT_REQUIRED')}
     else {const quote=[order.quote,...order.quoteHistory].find(q=>q?.id===input.quoteId);if(!quote||quote.reference!==`nimble-order:${order.id}:${input.revision}`)return fail(409,'ORDER_QUOTE_REQUIRED');if(depositMismatch({...event,amountAtomic:quote.amountAtomic},quote)||BigInt(event.amountAtomic)<=BigInt(quote.amountAtomic))return fail(409,'OVERPAYMENT_PROOF_REQUIRED')}

     const payment:MerchantPayment={asset:event.asset,network:event.network,hash:event.hash.toLowerCase(),sender:event.sender??'',recipient:event.recipient,amountAtomic:event.amountAtomic,confirmedAt:event.occurredAt!};
     await assertUnassigned(store,payment);await claimTransfer(store,{network:event.network,hash:event.hash,eventIndex:event.eventIndex,kind:'DEPOSIT',referenceId:value.id,venueId});
     value.kind='EXCESS';value.verification='VERIFIED';value.refund={status:'REQUESTED',quote:null,quoteHistory:[],pendingHash:null,payment:null,approvedBy:null,approvedAt:null};
    }
   }
   await store.update(s.merchantWalletObservation).set({event,checkedAt:new Date()}).where(eq(s.merchantWalletObservation.id,observed.id));
   if(prior)await save(store,value);else await store.insert(s.merchantDepositResolution).values({id:value.id,venueId,observationId:observed.id,data:value});
   await h.audit(store,a,venueId,'wallet.deposit.'+input.decision.toLowerCase(),input.reason,old??null,value);return {id:value.id};
  });
  return finishLink(venueId,intent.id);
 });
 app.post(base+'/:resolutionId/recheck',async req=>{const {venueId}=await context(req),id=uuid.parse((req.params as any).resolutionId);const value=await finishLink(venueId,id);return value.kind==='EXCESS'?checkRefund(venueId,id):value});
 const refundInput=z.object({reason:z.string().trim().min(3).max(500),idempotencyKey:uuid}).strict();
 app.post(base+'/:resolutionId/refund/approve',async req=>{
  const {a,venueId}=await context(req),id=uuid.parse((req.params as any).resolutionId),input=refundInput.parse(req.body),payload={action:'deposit.refund.approve',id,input},oldIntent=await replay(a,venueId,input.idempotencyKey,payload);if(oldIntent)return resolution(db,venueId,oldIntent.id);
  const old=await resolution(db,venueId,id);if(old.kind!=='EXCESS'||!old.refund)return fail(409,'INVALID_STATE');if(old.refund.pendingHash||old.refund.status==='CONFIRMED'||old.refund.quote&&Date.parse(old.refund.quote.expiresAt)>Date.now())return old;if(!old.event.sender)return fail(409,'DEPOSIT_SENDER_UNKNOWN');
  // Signing envelope only: deposit liabilities carry atomic assets and have no fiat valuation.
  let quote:MerchantQuote={id:randomUUID(),asset:old.event.asset,network:old.event.network,amountAtomic:old.event.amountAtomic,sender:old.event.recipient,recipient:old.event.sender,reference:`nimble-deposit-refund:${id}`,issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'NOT_APPLICABLE_NO_FIAT_VALUATION',...(old.event.asset==='USDT'?{tokenAddress:USDT_POLYGON}:{})};
  const payments=gateway();if(payments.refreshRefundQuote){let refreshed:MerchantQuote;try{refreshed=await payments.refreshRefundQuote(quote)}catch{return fail(503,'PAYMENTS_UNAVAILABLE')};if(refreshed.asset!==quote.asset||refreshed.network!==quote.network||refreshed.amountAtomic!==quote.amountAtomic||!same(refreshed.sender,quote.sender)||!same(refreshed.recipient,quote.recipient)||refreshed.reference!==quote.reference||refreshed.tokenAddress!==quote.tokenAddress||!Number.isFinite(Date.parse(refreshed.expiresAt))||Date.parse(refreshed.expiresAt)<=Date.now())return fail(503,'INVALID_QUOTE');quote=refreshed}
  const result=await transaction(a,venueId,input.idempotencyKey,payload,async store=>{const value=await resolution(store,venueId,id,true),r=value.refund;if(value.kind!=='EXCESS'||!r)return fail(409,'INVALID_STATE');if(r.pendingHash||r.status==='CONFIRMED'||r.quote&&Date.parse(r.quote.expiresAt)>Date.now())return {id};const before=structuredClone(value);if(r.quote)r.quoteHistory.push(r.quote);r.quote=quote;r.status='APPROVED';r.approvedBy=taskActorKey(a);r.approvedAt=new Date().toISOString();await save(store,value);await h.audit(store,a,venueId,'wallet.deposit.refund.approved',input.reason,before,value);return {id}});return resolution(db,venueId,result.id);
 });
 app.post(base+'/:resolutionId/refund/payment',async req=>{
  const {a,venueId}=await context(req),id=uuid.parse((req.params as any).resolutionId),input=refundInput.extend({hash:z.string().regex(/^(?:0x)?[a-fA-F0-9]{64}$/),quoteId:z.string().min(1).max(128)}).parse(req.body),payload={action:'deposit.refund.payment',id,input};
  await transaction(a,venueId,input.idempotencyKey,payload,async store=>{const value=await resolution(store,venueId,id,true),r=value.refund;if(value.kind!=='EXCESS'||!r||!r.quote)return fail(409,'INVALID_STATE');if(r.pendingHash&&(!same(r.pendingHash,input.hash)||r.quote.id!==input.quoteId))return fail(409,'REFUND_ALREADY_SUBMITTED');const submittedQuote=[r.quote,...r.quoteHistory].find(q=>q.id===input.quoteId);if(!submittedQuote)return fail(409,'STALE_QUOTE');if(r.status==='CONFIRMED')return {id};if(r.quote.id!==submittedQuote.id){if(!r.quoteHistory.some(q=>q.id===r.quote!.id))r.quoteHistory.push(r.quote);r.quote=submittedQuote}if(!r.pendingHash)r.submittedAt=new Date().toISOString();r.pendingHash=input.hash.toLowerCase();r.status='SUBMITTED';await save(store,value);await h.audit(store,a,venueId,'wallet.deposit.refund.submitted',input.reason,null,{id,hash:r.pendingHash,quoteId:input.quoteId});return {id}});return checkRefund(venueId,id);
 });

}
