import {and,asc,eq,sql} from 'drizzle-orm';
import type {MerchantPayment,DepositResolution} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import type {MerchantPaymentGateway} from './merchantGateway';
import {assertUnassigned,matches,reconcileMerchantPayment} from './merchantSettlement';
import {claimTransfer} from './transferClaims';
import {loyaltyFail as fail} from './loyalty';
async function resolution(store:Db,venueId:string,id:string,lock=false){const query=store.select().from(s.merchantDepositResolution).where(and(eq(s.merchantDepositResolution.id,id),eq(s.merchantDepositResolution.venueId,venueId)));const [row]=lock?await query.for('update'):await query;if(!row)return fail(404,'NOT_FOUND');return row.data}
async function save(store:Db,value:DepositResolution){await store.update(s.merchantDepositResolution).set({data:value,updatedAt:new Date()}).where(eq(s.merchantDepositResolution.id,value.id));return value}
 export async function settleDepositLink(db:Db,gateway:MerchantPaymentGateway,venueId:string,id:string){let value=await resolution(db,venueId,id);if(value.kind!=='LINK_PENDING'||!value.orderId)return value;
  let code:string|null=null;try{await reconcileMerchantPayment(db,gateway,value.orderId)}catch(e){code=(e as {code?:string}).code??'VERIFICATION_UNAVAILABLE'}
  return db.transaction(async tx=>{const store=tx as unknown as Db,current=await resolution(store,venueId,id,true);if(current.kind!=='LINK_PENDING')return current;const [order]=await tx.select().from(s.merchantOrder).where(eq(s.merchantOrder.id,current.orderId!));
   if(order.payment&&order.payment.hash.toLowerCase()===current.event.hash.toLowerCase()&&order.payment.network===current.event.network){current.kind='LINKED';current.verification='VERIFIED';current.verificationCode=null}
   else {current.verification='UNVERIFIED';current.verificationCode=code??(order.payment?'ORDER_ALREADY_PAID':'UNVERIFIED')}
   return save(store,current);
  });
 }
 export async function checkDepositRefund(db:Db,gateway:MerchantPaymentGateway,venueId:string,id:string){const value=await resolution(db,venueId,id),r=value.refund;if(value.kind!=='EXCESS'||!r?.quote||!r.pendingHash||r.status==='CONFIRMED')return value;
  let payment:MerchantPayment|null;try{payment=await gateway.verify({quote:r.quote,hash:r.pendingHash})}catch{return value}if(!payment||!matches(payment,r.quote,r.pendingHash))return value;
  return db.transaction(async tx=>{const store=tx as unknown as Db,current=await resolution(store,venueId,id,true),refund=current.refund!;if(refund.status==='CONFIRMED')return current;if(refund.pendingHash!==r.pendingHash||refund.quote?.id!==r.quote!.id)return current;await assertUnassigned(store,payment!);await claimTransfer(store,{network:payment!.network,hash:payment!.hash,kind:'DEPOSIT_REFUND',referenceId:id,venueId});refund.status='CONFIRMED';refund.payment=payment;await save(store,current);return current});
 }
/** Checks already recorded intents only; never authorizes, signs or sends a refund. */
export async function reconcileDepositResolutions(db:Db,gateway:MerchantPaymentGateway){
 const rows=await db.select().from(s.merchantDepositResolution).where(sql`${s.merchantDepositResolution.data}->>'kind'='LINK_PENDING' OR (${s.merchantDepositResolution.data}->>'kind'='EXCESS' AND ${s.merchantDepositResolution.data}->'refund'->>'pendingHash' IS NOT NULL AND ${s.merchantDepositResolution.data}->'refund'->>'status'<>'CONFIRMED')`).orderBy(asc(s.merchantDepositResolution.updatedAt),asc(s.merchantDepositResolution.id)).limit(5);
 const failures:{id:string;code:string}[]=[];
 for(const row of rows){await db.update(s.merchantDepositResolution).set({updatedAt:new Date()}).where(eq(s.merchantDepositResolution.id,row.id));try{if(row.data.kind==='LINK_PENDING')await settleDepositLink(db,gateway,row.venueId,row.id);else await checkDepositRefund(db,gateway,row.venueId,row.id)}catch(e){failures.push({id:row.id,code:(e as {code?:string}).code??'VERIFICATION_UNAVAILABLE'})}}
 return failures;
}
export function startDepositReconciliation(db:Db,gateway:MerchantPaymentGateway,intervalMs=5000,onError?:(error:unknown)=>void){let running=false;const timer=setInterval(async()=>{if(running)return;running=true;try{const failures=await reconcileDepositResolutions(db,gateway);if(failures.length)onError?.(failures)}catch(e){onError?.(e)}finally{running=false}},intervalMs);return()=>clearInterval(timer)}
