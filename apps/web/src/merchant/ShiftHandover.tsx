import {useEffect,useRef,useState} from 'react';
import type {ShiftHandover as Handover,MerchantEmployee} from '@nimble/shared';
import type {MerchantApi} from './client';
import {merchantError} from './errors';
import {t} from '../i18n';
export function ShiftHandover({api,venueId,scope,owner=false,employeeId,employees=[]}:{api:MerchantApi;venueId:string;scope:string;owner?:boolean;employeeId?:string;employees?:MerchantEmployee[]}){
 const [items,setItems]=useState<Handover[]>([]),[note,setNote]=useState(''),[successor,setSuccessor]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),locked=useRef(false),pending=useRef<{path:string;body:object}|null>(null);
 const auth=owner?'owner':'cashier',path=`/venues/${venueId}/handovers`;
 useEffect(()=>{const g=++generation.current;setItems([]);setNote('');setSuccessor('');setError('');setBusy(false);pending.current=null;locked.current=false;api.request<{items:Handover[]}>(auth,'GET',path).then(r=>{if(g===generation.current)setItems(r.items);}).catch(e=>{if(g===generation.current)setError(merchantError(e));});return()=>{generation.current++;};},[api,auth,path,scope]);
 async function send(request:{path:string;body:object}){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');const g=generation.current;pending.current=request;
  try{const saved=await api.request<Handover>(auth,'POST',request.path,request.body);if(g!==generation.current)return;pending.current=null;setNote('');setItems(old=>old.some(item=>item.id===saved.id)?old.map(item=>item.id===saved.id?saved:item):[saved,...old]);}
  catch(e){if(g===generation.current)setError(merchantError(e));}
  finally{if(g===generation.current){locked.current=false;setBusy(false);}}
 }
 return <section className="m-panel"><h2>{t('Shift handover')}</h2><p>{t('Open matters remain the venue’s responsibility until explicitly acknowledged. Creating a handover does not close a shift.')}</p>
 {error&&<p role="alert">{error} {pending.current&&<button disabled={busy} onClick={()=>void send(pending.current!)}>{t('Retry same operation')}</button>}</p>}
 <form onSubmit={e=>{e.preventDefault();void send({path,body:{note,successorEmployeeId:successor||null,idempotencyKey:crypto.randomUUID()}});}}>
 <label>{t('Handover note')}<textarea required minLength={3} maxLength={2000} value={note} disabled={busy||!!pending.current} onChange={e=>setNote(e.target.value)}/></label>
 <label>{t('Successor')}<select value={successor} disabled={busy||!!pending.current} onChange={e=>setSuccessor(e.target.value)}><option value="">{t('No successor yet — pending')}</option>{employees.filter(e=>e.id!==employeeId&&e.active).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
 <button disabled={busy||!!pending.current||note.trim().length<3}>{t('Record handover snapshot')}</button></form>
 {items.map(item=><article className="m-soft" key={item.id}><h3>{item.createdBy.name} · {new Date(item.createdAt).toLocaleString()}</h3><p>{item.note}</p><strong>{item.status==='PENDING'?t('Pending acknowledgement'):t('Acknowledged')}</strong><p>{t('Successor')}: {employees.find(e=>e.id===item.successorEmployeeId)?.name??item.successorEmployeeId??t('Not assigned')}</p>
 <details><summary>{t('Frozen open matters')}</summary><p>{t('Captured')}: {new Date(item.snapshot.capturedAt).toLocaleString()}</p><h4>{t('Orders')}</h4>{item.snapshot.orders.map(o=><p key={o.id}>#{o.number} · {o.status}</p>)}<h4>{t('Refunds')}</h4>{item.snapshot.refunds.map(r=><p key={r.id}>{r.orderId} · {r.status}</p>)}<h4>{t('Stock shortages')}</h4>{item.snapshot.shortages.map(s=><p key={s.id}>{s.name}: {s.quantity} / {s.threshold}</p>)}<h4>{t('Staff tasks')}</h4>{item.snapshot.tasks.map(s=><p key={s.id}>{s.title} · {s.status}</p>)}</details>
 {item.acknowledgedBy?<p>{item.acknowledgedBy.name} · {new Date(item.acknowledgedAt!).toLocaleString()}</p>:!(item.createdBy.id===employeeId||owner&&item.createdBy.kind==='owner')&&(!item.successorEmployeeId||item.successorEmployeeId===employeeId)&&<button disabled={busy||!!pending.current} onClick={()=>void send({path:`${path}/${item.id}/acknowledge`,body:{idempotencyKey:crypto.randomUUID()}})}>{t('I acknowledge these open matters')}</button>}
 </article>)}
 </section>;
}
