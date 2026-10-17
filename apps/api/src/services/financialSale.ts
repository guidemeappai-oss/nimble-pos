import {eq} from 'drizzle-orm';
import type {FinancialSaleSnapshot,MerchantFiat} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {loyaltyFail as fail} from './loyalty';
/** Same transaction as acceptance and consumption; later refund decisions cannot erase the original sale. */
export async function recordFinancialSale(store:Db,orderId:string){
 const [order]=await store.select().from(s.merchantOrder).where(eq(s.merchantOrder.id,orderId));
 if(!order?.payment||!order.paymentSnapshot||order.paymentRequiresRefund||order.source==='REMOTE'&&order.decision!=='ACCEPTED')return fail(409,'SALE_ACCEPTANCE_REQUIRED');
 const snapshot=order.paymentSnapshot,list=snapshot.lines.reduce((sum,l)=>sum+BigInt(l.totalMinor),0n),total=BigInt(snapshot.totalMinor);
 if(total<0n||list<total)return fail(409,'INVALID_SALE_SNAPSHOT');
 const data:FinancialSaleSnapshot={orderNumber:order.number,source:order.source as 'COUNTER'|'REMOTE',shiftId:order.shiftId,employeeId:order.employeeId,fiatCurrency:order.fiatCurrency as MerchantFiat,totalMinor:total.toString(),listMinor:list.toString(),discountMinor:(list-total).toString(),lines:snapshot.lines,paymentHash:order.payment.hash,status:'RECORDED',provenance:'LIVE_ACCEPTANCE',timeBasis:order.source==='REMOTE'?'REMOTE_DECISION':'SERVER_ACCEPTANCE'};
 await store.insert(s.merchantFinancialSale).values({orderId,venueId:order.venueId,occurredAt:order.source==='REMOTE'?order.decisionAt??new Date():new Date(),data}).onConflictDoNothing();
}
