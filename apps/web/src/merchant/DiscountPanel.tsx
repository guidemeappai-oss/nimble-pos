import {useEffect,useRef,useState} from 'react'
import type {MerchantOrder,MerchantEmployee} from '@nimble/shared'
import type {MerchantApi} from './client'
import {uuid} from '../lib/uuid'
import {merchantError} from './errors'
import {money} from './format'
type Discount={status:'PENDING'|'APPLIED';amountMinor:number;reason:string;requestedBy:string;approvedBy:string|null}
export function DiscountPanel(props:{api:MerchantApi;venueId:string;order:MerchantOrder;scope:string;owner?:boolean;onChanged?:()=>void}){return <DiscountSession key={`${props.scope}:${props.venueId}:${props.order.id}`} {...props}/>}
function DiscountSession({api,venueId,order,owner=false,onChanged}:Parameters<typeof DiscountPanel>[0]){
 const [open,setOpen]=useState(false),[data,setData]=useState<Discount|null>(null),[kind,setKind]=useState('PERCENT'),[value,setValue]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[people,setPeople]=useState<MerchantEmployee[]>([]),[person,setPerson]=useState(''),[percent,setPercent]=useState('0'),[minor,setMinor]=useState('0')
 const active=useRef(true),pending=useRef<{path:string;body:object}|null>(null),lock=useRef(false),authority=owner?'owner':'cashier',path=`/venues/${venueId}/orders/${order.id}/discount`
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 const load=async()=>{try{const d=await api.request<Discount|null>(authority,'GET',path);if(active.current)setData(d);if(owner){const p=await api.employees(venueId);if(active.current)setPeople(p)}}catch(e){if(active.current)setError(merchantError(e))}}
 const send=async(suffix:string,body:object)=>{if(lock.current)return;lock.current=true;setBusy(true);pending.current??={path:path+suffix,body};try{await api.request(authority,'POST',pending.current.path,pending.current.body);pending.current=null;if(active.current){await load();onChanged?.();setError('')}}catch(e){if(active.current)setError(merchantError(e))}finally{lock.current=false;if(active.current)setBusy(false)}}
 if(order.status!=='AWAITING_PAYMENT'&&!order.discountMinor)return null
 return <section><button type="button" onClick={()=>{setOpen(!open);if(!open)void load()}}>Rabaty i zgody</button>{order.discountMinor? <p>Rabat: −{money(order.discountMinor,order.fiatCurrency)}</p>:null}{open&&<div>
 <p>Jeden rabat od całego koszyka wraz z zestawami. Zakup może zbierać pieczątkę; nagrody lojalnościowe są osobnym odbiorem. Zatwierdzenie zamraża koszyk. Rabat procentowy zaokrąglamy do najbliższego grosza (połówka w górę).</p>
 {error&&<p role="alert">{error}</p>}{data?<><p>{data.status==='PENDING'?'Oczekuje na zgodę właściciela':'Zastosowany'}: −{money(data.amountMinor,order.fiatCurrency)} · {data.reason}</p>{data.status==='PENDING'&&<>{owner&&<button disabled={busy} onClick={()=>void send('/approve',{idempotencyKey:uuid()})}>Zatwierdź rabat</button>}<button disabled={busy} onClick={()=>void send('/cancel',{idempotencyKey:uuid()})}>Wycofaj wniosek</button></>}</>:<>
 <label>Rodzaj rabatu<select disabled={busy||!!pending.current} value={kind} onChange={e=>setKind(e.target.value)}><option value="PERCENT">Procent</option><option value="FIXED">Kwota w groszach</option></select></label>
 <label>Wartość<input type="number" min="0.01" step={kind==='PERCENT'?'0.01':'1'} disabled={busy||!!pending.current} value={value} onChange={e=>setValue(e.target.value)}/></label>
 <label>Powód rabatu<input value={reason} minLength={3} maxLength={500} disabled={busy||!!pending.current} onChange={e=>setReason(e.target.value)}/></label>
 <button disabled={busy||(!pending.current&&(reason.trim().length<3||!Number(value)))} onClick={()=>void send('',{revision:order.revision,idempotencyKey:uuid(),kind,value:kind==='PERCENT'?Math.round(Number(value)*100):Number(value),reason})}>{pending.current?'Ponów ten sam zapis':'Zapisz rabat lub wniosek'}</button></>}
 {owner&&<fieldset disabled={busy}><legend>Limity pracownika — oba muszą być spełnione</legend><label>Pracownik<select value={person} onChange={e=>setPerson(e.target.value)}><option value="">Wybierz</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Maksymalny procent<input type="number" value={percent} onChange={e=>setPercent(e.target.value)}/></label><label>Maksymalna kwota (grosze)<input type="number" value={minor} onChange={e=>setMinor(e.target.value)}/></label><button disabled={!person||reason.trim().length<3} onClick={async()=>{try{await api.request('owner','PUT',`/venues/${venueId}/discount-limits/${person}`,{maxBasisPoints:Math.round(Number(percent)*100),maxMinor:Number(minor),reason});if(active.current)setError('Limity zapisane')}catch(e){if(active.current)setError(merchantError(e))}}}>Zapisz limity z podanym powodem</button></fieldset>}
 </div>}</section>
}
