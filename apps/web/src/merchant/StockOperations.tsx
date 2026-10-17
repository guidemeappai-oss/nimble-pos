import type {InventoryLotsView,InventoryLot} from '@nimble/shared';
import {LotFields,type LotDraft} from './LotFields';
import { TaskBoard } from './TaskBoard';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InventoryDelivery, InventoryStocktakeFinalizeInput, InventoryItem, InventoryLoss, InventoryLossPolicy, InventoryLossReason, InventoryStocktake, InventorySupplier } from '@nimble/shared';
import type { MerchantApi } from './client';
import { merchantError } from './errors';
import { t } from '../i18n';

type Props = { api: MerchantApi; venueId: string; scope: string; owner?: boolean; manage?: boolean; canCosts?: boolean; items: InventoryItem[]; currency?: 'EUR' | 'USD' | 'PLN'; onChanged: () => void | Promise<void> };
type Kind = 'suppliers' | 'deliveries' | 'stocktakes' | 'losses';
type Row = InventorySupplier | InventoryDelivery | InventoryStocktake | InventoryLoss;
type Mutation = (endpoint: string, body: Record<string, unknown>, method?: 'POST' | 'PATCH') => Promise<boolean>;
const kinds: Record<Kind, string> = { suppliers: 'Suppliers', deliveries: 'Deliveries', stocktakes: 'Stocktakes', losses: 'Losses' };
const reasons: Record<InventoryLossReason, string> = { DAMAGED: 'Damaged', SPILLED: 'Spilled', EXPIRED: 'Expired', STAFF_MEAL: 'Staff meal', DONATION: 'Donation', CORRECTION: 'Correction' };
const statuses: Record<string, string> = { OPEN: 'Open', PARTIAL: 'Partially received', RECEIVED: 'Received', FINALIZED: 'Finalized', PENDING: 'Awaiting owner approval', APPLIED: 'Applied to stock', REJECTED: 'Rejected' };
const positive = (v: string) => /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 2147483647;
const nonnegative = (v: string) => /^\d+$/.test(v) && Number(v) <= 2147483647;

export function StockOperations(props: Props) {
    return <Operations key={`${props.venueId}:${props.scope}:${props.owner}:${props.manage}:${props.canCosts}`} {...props}/>;
}
function Operations({ api, venueId, owner = false, manage = false, canCosts = false, items, scope, currency = 'EUR', onChanged }: Props) {
    const [kind, setKind] = useState<Kind>('deliveries'), [rows, setRows] = useState<Row[]>([]), [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
    const [page, setPage] = useState(0), [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [policy, setPolicy] = useState<InventoryLossPolicy | null>(null);
    const live = useRef(true), serial = useRef(0), locked = useRef(false), retry = useRef(new Map<string, string>());
    const path = `/venues/${venueId}/inventory`, auth = owner ? 'owner' : 'cashier';
    useEffect(() => { live.current = true; return () => { live.current = false; serial.current++; }; }, []);
    const load = useCallback(async (next = 0) => {
        const n = ++serial.current;
        let result: Record<Kind, Row[]> & { hasMore?: boolean };
        try { result = await api.request(auth, 'GET', `${path}/${kind}?page=${next}&limit=50`); }
        catch(e) { if(!live.current || n !== serial.current) return; if((e as {status?:number}).status===403) setRows([]); throw e; }
        if (!live.current || n !== serial.current) return;
        const data = result[kind] ?? [];
        setRows(old => next ? [...old, ...data.filter(row => !old.some(o => o.id === row.id))] : data);
        setPage(next); setMore(Boolean(result.hasMore));
    }, [api, auth, kind, path]);
    useEffect(() => { setRows([]); setMore(false); setPage(0); setError(null); void load().catch(e => { if (live.current) setError(merchantError(e)); }); return () => { serial.current++; }; }, [load]);
    const loadPolicy = useCallback(async () => { const value = await api.request<InventoryLossPolicy>(auth, 'GET', `${path}/loss-policy`); if (live.current) setPolicy(value); }, [api, auth, path]);
    useEffect(() => { void loadPolicy().catch(e => { if (live.current) setError(merchantError(e)); }); }, [loadPolicy]);
    const [supplierPage, setSupplierPage] = useState(0), [supplierMore, setSupplierMore] = useState(false);
    const supplierSerial = useRef(0);
    const loadSuppliers = useCallback(async (next = 0) => {
        const n = ++supplierSerial.current;
        const value = await api.request<{ suppliers: InventorySupplier[]; hasMore?: boolean }>(auth, 'GET', `${path}/suppliers?page=${next}&limit=50`);
        if (!live.current || n !== supplierSerial.current) return;
        setSuppliers(old => next ? [...old, ...value.suppliers.filter(s => !old.some(o => o.id === s.id))] : value.suppliers);
        setSupplierPage(next); setSupplierMore(Boolean(value.hasMore));
    }, [api, auth, path]);
    useEffect(() => { void loadSuppliers().catch(e => { if (live.current) setError(merchantError(e)); }); }, [loadSuppliers, manage]);
    const mutate: Mutation = async (endpoint, body, method = 'POST') => {
        if (locked.current) return false;
        const signature = JSON.stringify([endpoint, body, method]);
        let key = retry.current.get(signature);
        if (!key) { key = crypto.randomUUID(); retry.current.set(signature, key); }
        locked.current = true; setBusy(true); setError(null); serial.current++; supplierSerial.current++;
        try {
            await api.request(auth, method, `${path}${endpoint}`, { ...body, ...(method === 'POST' || endpoint.includes('/suppliers') ? { idempotencyKey: key } : {}) });
            if (!live.current) return false;
            retry.current.delete(signature);
            try { await Promise.all([load(), loadSuppliers(), loadPolicy(), onChanged()]); }
            catch (e) { if (live.current) setError(merchantError(e)); }
            return live.current;
        } catch (e) {
            if (live.current) { setError(merchantError(e)); if ((e as { status?: number }).status === 403) { setRows([]); setSuppliers([]); setPolicy(null); } }
            return false;
        } finally { if (live.current) { locked.current = false; setBusy(false); } }
    };
    const itemName = (id: string) => items.find(i => i.id === id)?.name ?? id;
    return <section className="m-panel"><h2>{t('Stock operations')}</h2>
        <p>{t('Receipts, losses and stocktakes update physical stock. Refunding a payment does not restore a product.')}</p>
        <nav className="m-actions" aria-label={t('Stock operations')}>{(Object.keys(kinds) as Kind[]).map(k => <button key={k} disabled={busy} aria-pressed={kind === k} onClick={() => { if(kind === k)return; serial.current++; setRows([]); setKind(k); }}>{t(kinds[k])}</button>)}</nav>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} onClick={() => { setError(null); void load().catch(e => { if (live.current) setError(merchantError(e)); }); }}>{t('Refresh operations')}</button>
        {kind === 'suppliers' && <>{manage && <SupplierForm busy={busy} mutate={mutate}/>} {(rows as InventorySupplier[]).map(s => <article className="m-panel" key={s.id}><h3>{s.name}</h3><p>{t(s.active ? 'Active supplier' : 'Inactive supplier')}</p>{manage && <SupplierForm key={`${s.id}:${s.name}:${s.active}`} supplier={s} busy={busy} mutate={mutate}/>}</article>)}</>}
        {kind === 'deliveries' && <>{manage && <DeliveryForm items={items} suppliers={suppliers} canCosts={canCosts} currency={currency} busy={busy} mutate={mutate}/>} {supplierMore && manage && <button disabled={busy} onClick={() => void loadSuppliers(supplierPage + 1).catch(e => { if (live.current) setError(merchantError(e)); })}>{t('Load more suppliers')}</button>} {(rows as InventoryDelivery[]).map(d => <DeliveryCard key={d.id} delivery={d} canCosts={canCosts} manage={manage} busy={busy} mutate={mutate} itemName={itemName} supplierName={suppliers.find(s => s.id === d.supplierId)?.name ?? d.supplierId}/>)}</>}
        {kind === 'stocktakes' && <>{manage && <StocktakeStart items={items} busy={busy} mutate={mutate}/>}<p>{t('Count the stock present when the snapshot was opened. Later deliveries and movements remain in stock; finalization applies only counted minus snapshot quantity.')}</p>{(rows as InventoryStocktake[]).map(s => <StocktakeCard key={`${s.id}:${s.lines.map(l => l.currentRevision).join(',')}`} stocktake={s} manage={manage} busy={busy} mutate={mutate} itemName={itemName}/>)}</>}
        {kind === 'losses' && <>{owner && policy && <LossPolicy key={policy.approvalThreshold} policy={policy} busy={busy} mutate={mutate}/>}<p>{t('Losses above the threshold await the owner. Pending losses reduce availability while physical stock changes only after approval. Rejected losses release availability.')}</p>{policy && <p>{t('Owner approval above quantity')}: {policy.approvalThreshold}</p>}{manage && <LossForm api={api} venueId={venueId} owner={owner} items={items} busy={busy} mutate={mutate}/>} {(rows as InventoryLoss[]).map(loss => <LossCard api={api} venueId={venueId} scope={scope} key={loss.id} loss={loss} owner={owner} busy={busy} mutate={mutate} itemName={itemName}/>)}</>}
        {rows.length === 0 && <p>{t('No operations on this page.')}</p>}
        {more && <button disabled={busy} onClick={() => void load(page + 1).catch(e => { if (live.current) setError(merchantError(e)); })}>{t('Load more operations')}</button>}
    </section>;
}
function SupplierForm({ supplier, busy, mutate }: { supplier?: InventorySupplier; busy: boolean; mutate: Mutation }) {
    const [name, setName] = useState(supplier?.name ?? ''), [active, setActive] = useState(supplier?.active ?? true);
    return <form onSubmit={e => { e.preventDefault(); void mutate(supplier ? `/suppliers/${supplier.id}` : '/suppliers', { name: name.trim(), active }, supplier ? 'PATCH' : 'POST').then(ok => { if (ok && !supplier) setName(''); }); }}>
        <label>{t('Supplier name')}{supplier ? ` · ${supplier.name}` : ''}<input required maxLength={120} value={name} disabled={busy} onChange={e => setName(e.target.value)}/></label>
        <label><input type="checkbox" checked={active} disabled={busy} onChange={e => setActive(e.target.checked)}/>{t('Active supplier')}</label><button disabled={busy || !name.trim()}>{t(supplier ? 'Save supplier' : 'Add supplier')}</button>
    </form>;
}
function DeliveryForm({ items, suppliers, canCosts, currency, busy, mutate }: { items: InventoryItem[]; suppliers: InventorySupplier[]; canCosts: boolean; currency: string; busy: boolean; mutate: Mutation }) {
    const [supplier, setSupplier] = useState(''), [reference, setReference] = useState(''), [lines, setLines] = useState<{ itemId: string; quantity: string; cost: string; costMode: string }[]>([{ itemId: '', quantity: '', cost: '',costMode:'UNIT' }]);
    const update = (n: number, field: 'itemId' | 'quantity' | 'cost' | 'costMode', value: string) => setLines(old => old.map((line, i) => i === n ? { ...line, [field]: value, ...(field==='itemId'&&['MILLIGRAM','MILLILITRE'].includes(items.find(i=>i.id===value)?.unit??'')?{costMode:'TOTAL'}:{}) } : line));
    const valid = supplier && lines.length && lines.every(l => l.itemId && positive(l.quantity) && (!canCosts || !l.cost || nonnegative(l.cost))) && new Set(lines.map(l => l.itemId)).size === lines.length;
    return <form onSubmit={e => { e.preventDefault(); if (!valid) return; void mutate('/deliveries', { supplierId: supplier, reference: reference.trim(), lines: lines.map(l => ({ itemId: l.itemId, expectedQuantity: Number(l.quantity), ...(canCosts && l.cost !== '' ? { [l.costMode==='TOTAL'?'totalCostMinor':'unitCostMinor']: Number(l.cost) } : {}) })) }).then(ok => { if (ok) { setReference(''); setLines([{ itemId: '', quantity: '', cost: '',costMode:'UNIT' }]); } }); }}><h3>{t('Plan a delivery')}</h3>
        <label>{t('Supplier')}<select required disabled={busy} value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">{t('Choose supplier')}</option>{suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>{t('Delivery reference')}<input value={reference} maxLength={120} disabled={busy} onChange={e => setReference(e.target.value)}/></label>
        {lines.map((line, n) => <fieldset key={n} disabled={busy}><legend>{t('Delivery line')} {n + 1}</legend><ItemSelect items={items} value={line.itemId} onChange={v => update(n, 'itemId', v)} label={`${t('Delivery item')} ${n + 1}`}/><Quantity label={`${t('Expected quantity')} ${n + 1}`} value={line.quantity} onChange={v => update(n, 'quantity', v)}/>{canCosts && <><label>{t('Purchase cost basis')}<select value={line.costMode} onChange={e=>update(n,'costMode',e.target.value)}><option value="UNIT">{t('Cost per stock unit')}</option><option value="TOTAL">{t('Total planned line cost')}</option></select></label><Quantity label={`${t(line.costMode==='TOTAL'?'Total purchase cost in minor currency units':'Unit purchase cost in minor currency units')} ${currency} ${n + 1}`} value={line.cost} onChange={v => update(n, 'cost', v)} minimum={0} required={false}/></>}<button type="button" disabled={lines.length === 1} onClick={() => setLines(old => old.filter((_, i) => i !== n))}>{t('Remove line')}</button></fieldset>)}
        <button type="button" disabled={busy || lines.length >= 100} onClick={() => setLines(old => [...old, { itemId: '', quantity: '', cost: '',costMode:'UNIT' }])}>{t('Add delivery line')}</button><button disabled={busy || !valid}>{t('Create delivery')}</button>
    </form>;
}
export function DeliveryCard({ delivery: d, supplierName, canCosts, manage, busy, mutate, itemName }: { delivery: InventoryDelivery; supplierName: string; canCosts: boolean; manage: boolean; busy: boolean; mutate: Mutation; itemName: (id: string) => string }) {
    const [quantities, setQuantities] = useState<Record<string, string>>({}), [reason, setReason] = useState('');
    const [lots,setLots]=useState<Record<string,LotDraft>>({});
    const label = d.reference || d.id;
    const valid = Object.values(quantities).some(positive) && Object.values(quantities).every(v => !v || nonnegative(v));
    return <article className="m-panel"><h3>{label}</h3><p>{supplierName} · {t(statuses[d.status])}</p>
        {d.lines.map(l => <p key={l.itemId}>{itemName(l.itemId)}: {l.receivedQuantity} / {l.expectedQuantity}{canCosts && l.totalCostMinor != null && <span> · {t('Total planned line cost')}: {new Intl.NumberFormat(undefined,{style:'currency',currency:d.fiatCurrency}).format(l.totalCostMinor/100)}</span>}{canCosts && l.unitCostMinor != null && <> · {t('Unit purchase cost')}: <span>{new Intl.NumberFormat(undefined, { style: 'currency', currency: d.fiatCurrency }).format(l.unitCostMinor / 100)}</span></>}</p>)}
        {manage && d.status !== 'RECEIVED' && <form onSubmit={e => { e.preventDefault(); if (!valid) return; void mutate(`/deliveries/${d.id}/receipts`, { lines: d.lines.filter(l => positive(quantities[l.itemId] ?? '')).map(l => ({ itemId: l.itemId, quantity: Number(quantities[l.itemId]),lot:lots[l.itemId] } )), reason: reason.trim() }).then(ok => { if (ok) { setQuantities({}); setReason(''); } }); }}>
            <fieldset disabled={busy}><legend>{t('Partial receipt')}</legend>{d.lines.filter(l => l.receivedQuantity < l.expectedQuantity).map(l => <Quantity key={l.itemId} label={`${t('Receipt quantity')} ${itemName(l.itemId)}`} value={quantities[l.itemId] ?? ''} onChange={v => setQuantities(old => ({ ...old, [l.itemId]: v }))} minimum={0} maximum={l.expectedQuantity - l.receivedQuantity} required={false}/>)}{d.lines.filter(l=>positive(quantities[l.itemId]??'')).map(l=><LotFields key={l.itemId} name={itemName(l.itemId)} value={lots[l.itemId]??{label:'',expiresAt:null}} onChange={v=>setLots(old=>({...old,[l.itemId]:v}))}/>)}<Reason label={`${t('Receipt reason')} ${label}`} value={reason} onChange={setReason}/><button disabled={!valid || !reason.trim()} aria-label={`${t('Receive delivery')} ${label}`}>{t('Receive delivery')}</button></fieldset>
        </form>}
        <h4>{t('Receipt history')}</h4>{d.receipts.map(receipt => <ReceiptCard key={receipt.id} receipt={receipt} deliveryId={d.id} manage={manage} busy={busy} mutate={mutate} itemName={itemName}/>) }
    </article>;
}
function ReceiptCard({ receipt, deliveryId, manage, busy, mutate, itemName }: { receipt: InventoryDelivery['receipts'][number]; deliveryId: string; manage: boolean; busy: boolean; mutate: Mutation; itemName: (id: string) => string }) {
    const [reason, setReason] = useState('');
    return <div className="m-panel"><time>{new Date(receipt.createdAt).toLocaleString()}</time><p>{receipt.reason}</p>{receipt.lines.map(l => <p key={l.itemId}>{itemName(l.itemId)}: +{l.quantity}</p>)}{receipt.reversed ? <p>{t('Receipt reversed')}</p> : manage && <form onSubmit={e => { e.preventDefault(); void mutate(`/deliveries/${deliveryId}/receipts/${receipt.id}/reverse`, { reason: reason.trim() }).then(ok => { if (ok) setReason(''); }); }}><fieldset disabled={busy}><Reason label={`${t('Receipt correction reason')} ${receipt.id}`} value={reason} onChange={setReason}/><button disabled={!reason.trim()}>{t('Reverse receipt')}</button><p>{t('A reversal subtracts this receipt only and preserves its history. Enter a new receipt for the corrected quantity.')}</p></fieldset></form>}</div>;
}
function StocktakeStart({ items, busy, mutate }: { items: InventoryItem[]; busy: boolean; mutate: Mutation }) {
    const [ids, setIds] = useState<string[]>([]), [food,setFood]=useState(false), [timeZone,setTimeZone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone), [boundaryHour,setBoundaryHour]=useState('4');
    return <form onSubmit={e => { e.preventDefault(); void mutate('/stocktakes', { itemIds: ids, ...(food?{foodDay:{timeZone,boundaryHour:Number(boundaryHour)}}:{}) }).then(ok => { if (ok) setIds([]); }); }}><fieldset disabled={busy}><legend>{t('Open stocktake snapshot')}</legend><label><input type="checkbox" checked={food} onChange={e=>setFood(e.target.checked)}/>{t('End-of-day food count')}</label>{food && <><label>{t('Operational timezone')}<input required value={timeZone} onChange={e=>setTimeZone(e.target.value)}/></label><Quantity label={t('Operational day starts at hour')} minimum={0} maximum={23} value={boundaryHour} onChange={setBoundaryHour}/></>}{items.map(i => <label key={i.id}><input type="checkbox" checked={ids.includes(i.id)} onChange={e => setIds(old => e.target.checked ? [...old, i.id] : old.filter(id => id !== i.id))}/>{i.name} · {i.quantity} {t(({PIECE:'pieces',PORTION:'portions',MILLIGRAM:'mg',MILLILITRE:'ml'})[i.unit])}</label>)}<button disabled={!ids.length || ids.length > 100}>{t('Open stocktake')}</button></fieldset></form>;
}
function StocktakeCard({ stocktake: s, manage, busy, mutate, itemName }: { stocktake: InventoryStocktake; manage: boolean; busy: boolean; mutate: Mutation; itemName: (id: string) => string }) {
    const [lotCounts,setLotCounts]=useState<Record<string,Record<string,string>>>({});
    const [allocations,setAllocations]=useState<Record<string,Record<string,string>>>({});
    const allocation=(id:string)=>Object.fromEntries(['keep','disposal','donation','staffMeal'].map(k=>[k,Number(allocations[id]?.[k]??'0')])) as {keep:number;disposal:number;donation:number;staffMeal:number};
    const [counts, setCounts] = useState<Record<string, string>>({}), [reason, setReason] = useState(''), [acknowledged, setAcknowledged] = useState(false);
    const changed = s.lines.some(l => l.currentRevision !== undefined && l.currentRevision !== l.baselineRevision);
    const valid = reason.trim() && s.lines.every(l => nonnegative(counts[l.itemId] ?? '') && (!lotCounts[l.itemId] || Object.values(lotCounts[l.itemId]).every(nonnegative)) && (!s.foodDay || (Object.values(allocations[l.itemId]??{}).every(nonnegative) && Object.values(allocation(l.itemId)).reduce((a,b)=>a+b,0)===Number(counts[l.itemId])))) && (!changed || acknowledged);
    return <article className="m-panel"><h3>{t('Stocktake')} · {new Date(s.createdAt).toLocaleString()}</h3><p>{t(statuses[s.status])}</p>{s.foodDay && <p>{t('End-of-day food count')} · {s.foodDay.date} · {s.foodDay.timeZone} · {s.foodDay.boundaryHour}:00</p>}
        {s.lines.map(l => <div key={l.itemId}><p>{itemName(l.itemId)} · {t('Snapshot quantity')}: {l.expectedQuantity}{s.foodDay && <> · {t('Reserved at snapshot')}: {l.reservedQuantity ?? 0}</>}{l.allocation && <span> · {t('Keep')}: {l.allocation.keep} · {t('Disposal')}: {l.allocation.disposal} · {t('Donation')}: {l.allocation.donation} · {t('Staff meal')}: {l.allocation.staffMeal}</span>}{l.countedQuantity !== null && <> · {t('Counted')}: {l.countedQuantity} · {t('Difference')}: {l.difference}</>}</p>{s.status === 'OPEN' && <p>{t('Current stock')}: {l.currentQuantity ?? l.expectedQuantity} · {t('Movements since snapshot')}: {l.interveningDelta ?? 0}{nonnegative(counts[l.itemId] ?? '') && <> · {t('Stock after finalization')}: <strong>{(l.currentQuantity ?? l.expectedQuantity) + Number(counts[l.itemId]) - l.expectedQuantity}</strong></>}</p>}</div>)}
        {manage && s.status === 'OPEN' && <form onSubmit={e => { e.preventDefault(); if (!valid) return; void mutate(`/stocktakes/${s.id}/finalize`, { counts: s.lines.map(l => ({ itemId: l.itemId, countedQuantity: Number(counts[l.itemId]), ...(lotCounts[l.itemId]?{lotCounts:l.lots!.map(lot=>({lotId:lot.lotId,countedQuantity:Number(lotCounts[l.itemId][lot.lotId]??lot.quantity)}))}:{}), ...(s.foodDay?{allocation:allocation(l.itemId)}:{}), expectedRevision: l.currentRevision ?? l.baselineRevision, acknowledgeIntervening: l.currentRevision !== undefined && l.currentRevision !== l.baselineRevision && acknowledged })), reason: reason.trim() } satisfies Omit<ReturnType<typeof InventoryStocktakeFinalizeInput.parse>, 'idempotencyKey'>).then(ok => { if (ok) setReason(''); }); }}><fieldset disabled={busy}><legend>{t('Finalize stocktake')}</legend>{s.lines.map(l => <Quantity key={l.itemId} label={`${t('Counted quantity')} ${itemName(l.itemId)}`} minimum={0} value={counts[l.itemId] ?? ''} onChange={v => {setCounts(old => ({ ...old, [l.itemId]: v }));setLotCounts(old=>{const next={...old};delete next[l.itemId];return next}); setAcknowledged(false); }}/>) }{s.lines.filter(l=>l.lots?.length).map(l=><fieldset key={l.itemId}><legend>{t('Count by lot')} · {itemName(l.itemId)}</legend><label><input type="checkbox" checked={!!lotCounts[l.itemId]} onChange={e=>{if(e.target.checked){const initial=Object.fromEntries(l.lots!.map(lot=>[lot.lotId,String(lot.quantity)]));setLotCounts(old=>({...old,[l.itemId]:initial}));setCounts(old=>({...old,[l.itemId]:String(l.lots!.reduce((n,lot)=>n+lot.quantity,0))}))}else setLotCounts(old=>{const next={...old};delete next[l.itemId];return next});setAcknowledged(false)}}/>{t('Use lot counts')}</label>{lotCounts[l.itemId]&&l.lots!.map(lot=><Quantity key={lot.lotId} label={`${lot.label||lot.lotId} · ${lot.expiresAt??t('Unknown expiry')}`} minimum={0} value={lotCounts[l.itemId][lot.lotId]??String(lot.quantity)} onChange={v=>{const next={...lotCounts[l.itemId],[lot.lotId]:v};setLotCounts(old=>({...old,[l.itemId]:next}));setCounts(old=>({...old,[l.itemId]:String(Object.values(next).reduce((n,q)=>n+Number(q),0))}));setAcknowledged(false)}}/>)}</fieldset>)}{s.foodDay && <><p>{t('Split the counted food. Disposal is held out of sale pending evidence and approval; donation and staff meals leave stock when confirmed.')}</p>{s.lines.map(l=><fieldset key={l.itemId}><legend>{itemName(l.itemId)}</legend>{(['keep','disposal','donation','staffMeal'] as const).map(k=><Quantity key={k} label={`${t({keep:'Keep',disposal:'Disposal',donation:'Donation',staffMeal:'Staff meal'}[k])} ${itemName(l.itemId)}`} minimum={0} value={allocations[l.itemId]?.[k]??'0'} onChange={v=>setAllocations(old=>({...old,[l.itemId]:{...old[l.itemId],[k]:v}}))}/>)}</fieldset>)}</>}{changed && <><p>{t('Stock moved during counting. Reconcile your count to the opening snapshot using stock history before confirming. Do not enter a later physical count without accounting for those movements.')}</p><label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>{`${t('I reconciled movements since the snapshot')} ${s.id}`}</label></>}<Reason label={`${t('Stocktake reason')} ${s.id}`} value={reason} onChange={setReason}/><button disabled={!valid}>{t('Apply stocktake difference')}</button></fieldset></form>}
    </article>;
}
function LossForm({ api,venueId,owner,items, busy, mutate }: { api:MerchantApi;venueId:string;owner:boolean;items: InventoryItem[]; busy: boolean; mutate: Mutation }) {
    const [item, setItem] = useState(''), [quantity, setQuantity] = useState(''), [reason, setReason] = useState<InventoryLossReason>('DAMAGED'), [comment, setComment] = useState('');
    const [lots,setLots]=useState<InventoryLot[]>([]),[lotId,setLotId]=useState(''),[lotError,setLotError]=useState('');
    useEffect(()=>{let active=true;setLotId('');setLots([]);setLotError('');if(item)void(async()=>{const all:InventoryLot[]=[];let page=0;while(active){const r=await api.request<InventoryLotsView>(owner?'owner':'cashier','GET',`/venues/${venueId}/inventory/${item}/lots?page=${page}`);all.push(...r.items.filter(l=>l.quantity>0));if(!r.hasMore)break;page++}if(active)setLots(all)})().catch(e=>{if(active)setLotError(merchantError(e))});return()=>{active=false}},[api,venueId,owner,item]);
    return <form onSubmit={e => { e.preventDefault(); void mutate('/losses', { itemId: item, ...(lotId?{lotId}:{}), quantity: Number(quantity), reason, comment: comment.trim() }).then(ok => { if (ok) { setQuantity(''); setComment(''); } }); }}><fieldset disabled={busy}><legend>{t('Record a loss')}</legend><ItemSelect items={items} value={item} onChange={setItem} label={t('Loss item')}/>{lotError&&<p role="alert">{lotError}</p>}<label>{t('Loss lot')}<select value={lotId} onChange={e=>setLotId(e.target.value)}><option value="">{t('Suggest earliest expiry')}</option>{lots.map(l=><option key={l.id} value={l.id}>{l.label||l.id} · {l.quantity} · {l.expiresAt??t('Unknown expiry')}</option>)}</select></label><Quantity label={t('Loss quantity')} value={quantity} onChange={setQuantity}/><label>{t('Loss type')}<select value={reason} onChange={e => setReason(e.target.value as InventoryLossReason)}>{(Object.keys(reasons) as InventoryLossReason[]).map(r => <option key={r} value={r}>{t(reasons[r])}</option>)}</select></label><Reason label={t('Loss explanation')} value={comment} onChange={setComment}/><button disabled={!item || !positive(quantity) || !comment.trim()}>{t('Submit loss')}</button></fieldset></form>;
}
function LossCard({ api,venueId,scope,loss, owner, busy, mutate, itemName }: { api:MerchantApi;venueId:string;scope:string; loss: InventoryLoss; owner: boolean; busy: boolean; mutate: Mutation; itemName: (id: string) => string }) {
    const [reason, setReason] = useState(''),[witness,setWitness]=useState(''),[evidence,setEvidence]=useState(false);
    return <article className="m-panel"><h3>{itemName(loss.itemId)} · {loss.quantity}</h3><p>{t(reasons[loss.reason])} · {t(statuses[loss.status])}</p><p>{loss.comment}</p>{loss.lotAllocations?.map(l=><p key={l.lotId}>{l.label||l.lotId}: {l.quantity} · {l.expiresAt??t('Unknown expiry')}</p>)}<p>{t('Requested by')}: {loss.requestedBy}</p>{loss.status === 'PENDING' && <p>{t('Physical stock has not changed. This quantity is excluded from availability until the owner decides.')}</p>}{loss.foodStocktakeId && <><p>{t('Food disposal requires evidence and a separate decision. Stock remains held.')}</p>{loss.disposalReview && <p>{t('Last disposal review')}: {loss.disposalReview.decision} · {loss.disposalReview.reason}</p>}<button disabled={busy} onClick={()=>setEvidence(v=>!v)}>{t('Disposal photo documentation')}</button>{evidence && loss.evidenceTaskId && <FoodDisposalEvidence key={`${scope}:${loss.id}`} api={api} venueId={venueId} scope={scope} owner={owner} taskId={loss.evidenceTaskId}/>}</>}{owner && loss.status === 'PENDING' && <fieldset disabled={busy}>{loss.foodStocktakeId && <label>{t('Witness employee ID (optional)')}<input value={witness} onChange={e=>setWitness(e.target.value)}/></label>}<Reason label={`${t('Loss decision reason')} ${loss.id}`} value={reason} onChange={setReason}/>{(['APPROVE','REJECT'] as const).map(decision => <button key={decision} disabled={!reason.trim()} onClick={() => void mutate(`/losses/${loss.id}/decision`, { decision, reason: reason.trim(), ...(loss.foodStocktakeId?{witnessEmployeeId:witness.trim()||null}:{}) })}>{t(decision === 'APPROVE' ? 'Approve loss' : 'Reject loss')}</button>)}</fieldset>}</article>;
}
function LossPolicy({ policy, busy, mutate }: { policy: InventoryLossPolicy; busy: boolean; mutate: Mutation }) {
    const [threshold, setThreshold] = useState(String(policy.approvalThreshold)), [reason, setReason] = useState('');
    return <form onSubmit={e => { e.preventDefault(); void mutate('/loss-policy', { approvalThreshold: Number(threshold), reason: reason.trim() }, 'PATCH').then(ok => { if (ok) setReason(''); }); }}><fieldset disabled={busy}><legend>{t('Loss approval policy')}</legend><Quantity label={t('Owner approval above quantity')} value={threshold} minimum={0} onChange={setThreshold}/><Reason label={t('Policy change reason')} value={reason} onChange={setReason}/><button disabled={!reason.trim() || !nonnegative(threshold)}>{t('Save approval threshold')}</button></fieldset></form>;
}
function ItemSelect({ items, value, onChange, label }: { items: InventoryItem[]; value: string; onChange: (value: string) => void; label: string }) { return <label>{label}<select required value={value} onChange={e => onChange(e.target.value)}><option value="">{t('Choose stock item')}</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} · {t(({PIECE:'pieces',PORTION:'portions',MILLIGRAM:'mg',MILLILITRE:'ml'})[i.unit])}</option>)}</select></label>; }
function Quantity({ label, value, onChange, minimum = 1, maximum = 2147483647, required = true }: { label: string; value: string; onChange: (value: string) => void; minimum?: number; maximum?: number; required?: boolean }) { return <label>{label}<input type="number" required={required} min={minimum} max={maximum} step="1" value={value} onChange={e => onChange(e.target.value)}/></label>; }
function Reason({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label>{label}<input required maxLength={500} value={value} onChange={e => onChange(e.target.value)}/></label>; }

function FoodDisposalEvidence({api,venueId,scope,owner,taskId}:{api:MerchantApi;venueId:string;scope:string;owner:boolean;taskId:string}) {
 const [employeeId,setEmployeeId]=useState<string>();const [error,setError]=useState<string>();
 useEffect(()=>{let active=true;if(!owner)void api.session().then(s=>{if(active)setEmployeeId(s.employee.id)}).catch(e=>{if(active)setError(merchantError(e))});return()=>{active=false}},[api,owner]);
 if(error)return <p role="alert">{error}</p>;
 if(!owner&&!employeeId)return <p>{t('Loading…')}</p>;
 return <TaskBoard api={api} venueId={venueId} scope={scope} owner={owner} employeeId={employeeId} onlyTaskId={taskId}/>;
}
