import {useCallback,useEffect,useRef,useState} from 'react'
import type {MerchantApi} from './client'
import type {MerchantOrder} from './contract'
import {paidOrderSummary} from './format'
import {merchantError} from './errors'
import {uuid} from '../lib/uuid'
import {t} from '../i18n'
import type {OrderReadiness as Readiness,OrderReadinessInput as Intent} from '@nimble/shared'
interface Props {api:MerchantApi;venueId:string;order:MerchantOrder;scope:string;canWrite:boolean;owner?:boolean;onChanged?:()=>void}
export function OrderReadiness(props:Props){return <ReadinessSession key={`${props.scope}:${props.venueId}:${props.order.id}:${!!props.owner}`} {...props}/>}
function ReadinessSession({api,venueId,order,canWrite,owner=false,onChanged}:Props){
 const [data,setData]=useState<Readiness|null>(null),[selected,setSelected]=useState<Record<number,number>>({}),[error,setError]=useState<string|null>(null),[pending,setPending]=useState<Intent|null>(null),[busy,setBusy]=useState(false)
 const initialRevision=useRef(`${order.revision}:${order.status}`)
 const active=useRef(true),serial=useRef(0),lock=useRef(false),pendingRef=useRef<Intent|null>(null),path=`/venues/${venueId}/orders/${order.id}/readiness`
 const load=useCallback(async()=>{const request=++serial.current;try{const result=await api.request<Readiness>(owner?'owner':'cashier','GET',path);if(result.orderId!==order.id||!Array.isArray(result.lines))throw new Error('Readiness unavailable');if(active.current&&request===serial.current){setData(result);setError(null)}}catch(e){if(active.current&&request===serial.current)setError(merchantError(e))}},[api,owner,path,order.id])
 useEffect(()=>{active.current=true;void load();const timer=setInterval(()=>{if(!pendingRef.current&&!lock.current)void load()},15000);return()=>{active.current=false;serial.current++;clearInterval(timer)}},[load])
 useEffect(()=>{const key=`${order.revision}:${order.status}`;if(initialRevision.current===key)return;initialRevision.current=key;if(!pendingRef.current&&!lock.current)void load()},[order.revision,order.status,load])
 const save=async(lineIndex:number)=>{
  if(lock.current||owner||!data||(!pendingRef.current&&(!canWrite||data.status!=='PREPARING')))return
  const readyQuantity=selected[lineIndex]??data.lines.find(l=>l.lineIndex===lineIndex)?.readyQuantity
  if(readyQuantity===undefined)return
  const replay=!!pendingRef.current
  const intent=pendingRef.current??{revision:data.revision,cartRevision:data.cartRevision,idempotencyKey:uuid(),lineIndex,readyQuantity}
  pendingRef.current=intent;setPending(intent);lock.current=true;setBusy(true);serial.current++
  try{const result=await api.request<Readiness>('cashier','POST',path,intent);if(!active.current)return;setData(result);setSelected({});pendingRef.current=null;setPending(null);setError(null);onChanged?.();if(replay)await load()}
  catch(e){if(!active.current)return;const code=(e as {code?:string}).code;if(['READINESS_CONFLICT','STALE_REVISION','IDEMPOTENCY_CONFLICT','INVALID_STATE'].includes(code??'')){pendingRef.current=null;setPending(null);await load();if(active.current)setError(t('Readiness changed. Review the refreshed quantities before saving again.'))}else setError(merchantError(e))}
  finally{lock.current=false;if(active.current)setBusy(false)}
 }
 const receipt=paidOrderSummary(order),writable=canWrite&&!owner&&data?.status==='PREPARING'&&order.status==='PREPARING'
 return <section className="m-soft m-form" aria-label={t('Item readiness')}>
  <strong>{t('Item readiness')}</strong><p className="m-muted">{t('When every unit is ready, the customer is notified and pickup becomes available.')}</p>
  {error&&<p role="alert">{t('Readiness may be stale. Refresh before making a new decision.')} {error}</p>}
  <button type="button" disabled={busy||!!pending} onClick={()=>void load()}>{t('Refresh readiness')}</button>
  {!data&&!error&&<p>{t('Loading readiness…')}</p>}
  {data?.lines.map(line=>{const product=receipt.lines[line.lineIndex],name=product?.productName??`${t('Item')} ${line.lineIndex+1}`,choice=selected[line.lineIndex]??line.readyQuantity
   return <div key={line.lineIndex} className="m-form"><strong>{name}{product?.variantName?` · ${product.variantName}`:''}</strong><span>{line.readyQuantity} / {line.quantity} {t('ready')}</span>
    {!owner&&<><label>{t('Ready quantity')}: {name}<select aria-label={`${t('Ready quantity')}: ${name}`} disabled={!writable||busy||!!pending} value={choice} onChange={e=>setSelected(old=>({...old,[line.lineIndex]:Number(e.target.value)}))}>{Array.from({length:line.quantity+1},(_,n)=><option key={n} value={n}>{n} / {line.quantity}</option>)}</select></label>
    <button type="button" aria-label={`${t(pending?.lineIndex===line.lineIndex?'Retry same readiness':'Save readiness')}: ${name}`} disabled={(!writable&&!(pending?.lineIndex===line.lineIndex&&!owner))||busy||(!!pending&&pending.lineIndex!==line.lineIndex)||(!pending&&choice===line.readyQuantity)} onClick={()=>void save(line.lineIndex)}>{t(pending?.lineIndex===line.lineIndex?'Retry same readiness':'Save readiness')}</button></>}
   </div>
  })}
  {!owner&&!canWrite&&<p>{t('Open a shift to update readiness.')}</p>}
  {data?.allReady&&<strong>{t('All items ready')}</strong>}
 </section>
}
