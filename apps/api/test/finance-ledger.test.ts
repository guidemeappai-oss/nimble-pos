import {expect,it} from 'vitest';
import {financeCsv} from '@nimble/shared';
import {buildFinanceReport,type FinanceFacts} from '../src/services/finance';
const from='2026-10-17T00:00:00.000Z',until='2026-10-18T00:00:00.000Z',at='2026-10-17T12:00:00.000Z';
function facts():FinanceFacts{
 const p={asset:'NIM',network:'nimiq:5',amountAtomic:'900000',sender:'Customer',recipient:'Merchant',hash:'paid',confirmedAt:at},extra={eventKey:'extra:0',asset:'NIM',network:'nimiq:5',amountAtomic:'450000',sender:'Customer',recipient:'Merchant',hash:'extra',eventIndex:0,confirmation:'FINALIZED',occurredAt:at},o={id:'sale',venueId:'venue',payment:p};
 return {sales:[{orderId:'sale',venueId:'venue',occurredAt:new Date(at),data:{status:'RECORDED',orderNumber:1,source:'COUNTER',fiatCurrency:'EUR',totalMinor:'900',listMinor:'1000',discountMinor:'100',paymentHash:'paid',provenance:'LIVE_ACCEPTANCE',timeBasis:'SERVER_ACCEPTANCE'}}],transfers:[{v:{id:'payment',orderId:'sale',purpose:'PAYMENT',network:'nimiq:5',hash:'paid',receipt:p},o},{v:{id:'returned',orderId:'sale',purpose:'REFUND',network:'nimiq:5',hash:'returned',receipt:{...p,sender:'Merchant',recipient:'Customer',hash:'returned'}},o},{v:{id:'remotePayment',orderId:'remote',purpose:'PAYMENT',network:'eip155:137',hash:'remotePay',receipt:{...p,asset:'USDT',network:'eip155:137',amountAtomic:'2000000',hash:'remotePay'}},o:{id:'remote'}}],refunds:[{r:{id:'refund',orderId:'sale',status:'CONFIRMED',pendingHash:'returned'},o}],observations:[{id:'observedPayment',venueId:'venue',event:{...extra,eventKey:'paid:0',hash:'paid',amountAtomic:'900000'}},{id:'observedExtra',venueId:'venue',event:extra},{id:'unallocated',venueId:'venue',event:{...extra,eventKey:'unallocated:0',hash:'unallocated',amountAtomic:'12345'}}],deposits:[{id:'extraLiability',venueId:'venue',data:{id:'extraLiability',kind:'EXCESS',observationId:'observedExtra',orderId:'sale',event:extra,refund:{status:'SUBMITTED',pendingHash:'extraReturn',submittedAt:at,payment:null}}}],attempts:[{orderId:'sale',hash:'returned',purpose:'REFUND',createdAt:new Date(at)}],pending:[{id:'remote',status:'AWAITING_ACCEPTANCE',payment:{asset:'USDT',network:'eip155:137',amountAtomic:'2000000',hash:'remotePay'}}],claims:[{network:'nimiq',hash:'paid',eventIndex:-1,venueId:'venue'},{network:'nimiq',hash:'extra',eventIndex:0,venueId:'venue'}],coverage:[]} as unknown as FinanceFacts;
}
it('matches a hand-calculated discounted sale, duplicate scanner observation, extra deposit, pending return and confirmed sale refund',()=>{
 const report=buildFinanceReport(facts(),from,until,at);
 expect(report.fiat).toEqual([{currency:'EUR',listMinor:'1000',discountMinor:'100',salesMinor:'900',refundedSalesMinor:'900',netSalesMinor:'0'}]);
 expect(report.assets.find(a=>a.asset==='NIM')).toMatchObject({receivedAtomic:'1362345',submittedRefundsAtomic:'1350000',confirmedRefundsAtomic:'900000',netCashAtomic:'462345',refundLiabilityAtomic:'450000',awaitingAcceptanceAtomic:'0',unallocatedAtomic:'12345'});
 expect(report.assets.find(a=>a.asset==='USDT')).toMatchObject({receivedAtomic:'2000000',confirmedRefundsAtomic:'0',awaitingAcceptanceAtomic:'2000000',refundLiabilityAtomic:'0'});
 expect(report.entries.filter(e=>e.kind==='PAYMENT')).toHaveLength(4);expect(report.entries.find(e=>e.kind==='PAYMENT'&&e.hash==='extra')?.liabilityId).toBe('extraLiability');expect(report.entries.find(e=>e.kind==='REFUND_SUBMITTED'&&e.hash==='extraReturn')?.liabilityId).toBe('extraLiability');expect(report.reconciled).toBe(true);
});
it('exports the exact same scoped ledger and sums without private data or interpreting text as spreadsheet formulas',()=>{
 const report=buildFinanceReport(facts(),from,until,at);report.entries[0].label='=HYPERLINK("private")';
 const csv=financeCsv(report),lines=csv.trimEnd().split('\r\n'),columns=lines.shift()!.split(',').map(c=>c.slice(1,-1)),rows=lines.map(line=>Object.fromEntries([...line.matchAll(/"((?:[^"]|"")*)"(?=,|$)/g)].map((m,i)=>[columns[i],m[1].replaceAll('""','"')])));
 expect(rows).toHaveLength(report.entries.length);expect(rows.every(r=>r.range_from===from&&r.range_until_exclusive===until&&r.snapshot_at===at)).toBe(true);
 const sum=(kind:string)=>rows.filter(r=>r.scope==='RANGE'&&r.kind===kind&&r.asset==='NIM').reduce((n,r)=>n+BigInt(r.amount_atomic),0n).toString();expect(sum('PAYMENT')).toBe('1362345');expect(sum('REFUND_CONFIRMED')).toBe('900000');expect(sum('REFUND_SUBMITTED')).toBe('1350000');
 expect(csv).toContain('"\'=HYPERLINK(""private"")"');expect(columns).not.toContain('sender');expect(columns).not.toContain('recipient');expect(csv).not.toContain('checkoutToken');expect(csv).not.toContain('photo');
});
it('keeps current liabilities outside the requested flow range and never uses an extra refund as a fiat sale reversal',()=>{
 const f=facts();f.deposits[0].data.refund!.status='CONFIRMED';f.deposits[0].data.refund!.payment={asset:'NIM',network:'nimiq:5',amountAtomic:'450000',sender:'Merchant',recipient:'Customer',hash:'extraReturn',confirmedAt:'2026-10-18T10:00:00Z'};
 const report=buildFinanceReport(f,'2026-10-18T00:00:00Z','2026-10-19T00:00:00Z','2026-10-18T12:00:00Z');expect(report.fiat).toEqual([]);expect(report.assets.find(a=>a.asset==='NIM')).toMatchObject({receivedAtomic:'0',confirmedRefundsAtomic:'450000',netCashAtomic:'-450000',refundLiabilityAtomic:'0',unallocatedAtomic:'0'});expect(report.liabilitiesAsOf).toBe('2026-10-18T12:00:00Z');
});
it('marks unresolved historical sale evidence and missing submission times without inventing zero prices or dates',()=>{
 const f=facts();f.sales[0].data.status='UNRESOLVED';f.sales[0].occurredAt=null;delete f.deposits[0].data.refund!.submittedAt;
 const report=buildFinanceReport(f,from,until,at);expect(report.reconciled).toBe(false);expect(report.warnings).toContain('LEGACY_SALE_CLASSIFICATION_UNKNOWN');expect(report.warnings).toContain('MISSING_REFUND_SUBMISSION_TIME');expect(report.fiat).toEqual([]);expect(report.entries.find(e=>e.kind==='UNKNOWN_SALE')?.amountMinor).toBeNull();
});
it('keeps old outstanding liabilities in the current snapshot while limiting unallocated receipts to the selected range',()=>{
 const report=buildFinanceReport(facts(),'2026-10-18T00:00:00Z','2026-10-19T00:00:00Z','2026-10-18T12:00:00Z');expect(report.assets.find(a=>a.asset==='NIM')).toMatchObject({receivedAtomic:'0',confirmedRefundsAtomic:'0',refundLiabilityAtomic:'450000',unallocatedAtomic:'0'});expect(report.entries.find(e=>e.kind==='REFUND_LIABILITY')?.scope).toBe('CURRENT');
});
it('keeps an undated deposit visible as unknown instead of assigning it to the selected range',()=>{
 const f=facts();f.observations.find(o=>o.id==='unallocated')!.event.occurredAt=null;const report=buildFinanceReport(f,from,until,at);expect(report.warnings).toContain('MISSING_DEPOSIT_TIME');expect(report.assets.find(a=>a.asset==='NIM')).toMatchObject({receivedAtomic:'1350000',unallocatedAtomic:'0'});expect(report.entries.find(e=>e.kind==='UNKNOWN_DEPOSIT')).toMatchObject({at:null,amountAtomic:'12345'});
});
