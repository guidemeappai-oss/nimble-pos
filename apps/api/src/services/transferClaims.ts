import {and,eq,sql} from 'drizzle-orm';
import type {Db} from '../db/client';
import {merchantTransferClaim} from '../db/schema';
import {loyaltyFail} from './loyalty';
export const transferNamespace=(network:string)=>network.startsWith('nimiq:')?'nimiq':network;
/** Insert in the same transaction as the financial effect; a conflicting claim rolls everything back. */
export async function claimTransfer(db:Db,input:{network:string;hash:string;kind:string;referenceId:string;venueId?:string|null;legacyChargeId?:string|null;eventIndex?:number}){
 const network=transferNamespace(input.network),hash=input.hash.toLowerCase(),eventIndex=input.eventIndex??-1;
 await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'transfer:'+network+':'+hash}))`);
 const existing=await db.select().from(merchantTransferClaim).where(and(eq(merchantTransferClaim.network,network),eq(merchantTransferClaim.hash,hash)));
 if(existing.some(c=>eventIndex===-1||c.eventIndex===-1||c.eventIndex===eventIndex))loyaltyFail(409,'TRANSACTION_ALREADY_ASSIGNED');
 const [claim]=await db.insert(merchantTransferClaim).values({...input,network,hash,eventIndex}).onConflictDoNothing().returning();
 if(!claim)loyaltyFail(409,'TRANSACTION_ALREADY_ASSIGNED');
}
