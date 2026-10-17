import { WalletDiscovery } from './WalletDiscovery'
import {useCallback,useEffect,useRef,useState} from 'react'
import type {PaymentException,PaymentExceptions as ExceptionPageData,OperationActionResult} from '@nimble/shared'
import type {MerchantApi} from './client'
import {ApiError} from '../api/client'
import {merchantError} from './errors'
import {cryptoAmount} from './format'
import {uuid} from '../lib/uuid'
import {t} from '../i18n'
type Intent={action:'recheck'|'reject-fulfillment';reason:string;idempotencyKey:string}
export function PaymentExceptions({api,venueId,scope,onRefunds}:{api:MerchantApi;venueId:string;scope:string;onRefunds:()=>void}) {
 return <ExceptionSession key={`${scope}:${venueId}`} api={api} venueId={venueId} scope={scope} onRefunds={onRefunds}/>
}
function ExceptionSession({api,venueId,scope,onRefunds}:{api:MerchantApi;venueId:string;scope:string;onRefunds:()=>void}) {
 const [asset,setAsset]=useState(''),[age,setAge]=useState('0'),[kind,setKind]=useState(''),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0)
 const query=new URLSearchParams({page:String(page),limit:'25',minAgeMinutes:age});if(asset)query.set('asset',asset);if(kind)query.set('kind',kind)
 return <section className="m-panel"><span className="m-label">{t('Payments')}</span><h2>{t('Payment exceptions')}</h2><p>{t('A submitted hash is not proof of receipt. Only verified transfers count as received payments.')}</p><div className="m-row">
  <label>{t('Asset filter')}<select value={asset} onChange={e=>{setAsset(e.target.value);setPage(0)}}><option value="">{t('All assets')}</option><option>NIM</option><option>USDT</option></select></label>
  <label>{t('Exception filter')}<select value={kind} onChange={e=>{setKind(e.target.value);setPage(0)}}><option value="">{t('All exceptions')}</option><option value="UNVERIFIED">{t('Unverified')}</option><option value="REFUND_REQUIRED">{t('Refund required')}</option></select></label>
  <label>{t('Age filter')}<select value={age} onChange={e=>{setAge(e.target.value);setPage(0)}}><option value="0">{t('Any age')}</option><option value="15">{t('Over 15 minutes')}</option><option value="60">{t('Over one hour')}</option><option value="1440">{t('Over one day')}</option></select></label>
  <button onClick={()=>setRefresh(v=>v+1)}>{t('Refresh exceptions')}</button></div>
  <WalletDiscovery api={api} venueId={venueId} scope={scope}/><ExceptionPage key={query.toString()} api={api} venueId={venueId} scope={scope} query={query.toString()} refresh={refresh} page={page} onPage={setPage} onRefresh={()=>setRefresh(v=>v+1)} onRefunds={onRefunds}/>
 </section>
}
function ExceptionPage({api,venueId,scope,query,refresh,page,onPage,onRefresh,onRefunds}:{api:MerchantApi;venueId:string;scope:string;query:string;refresh:number;page:number;onPage:(page:number)=>void;onRefresh:()=>void;onRefunds:()=>void}) {
 const [data,setData]=useState<ExceptionPageData|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const live=useRef(true),generation=useRef(0)
 const load=useCallback(async()=>{const id=++generation.current;setBusy(true);try{const value=await api.request<ExceptionPageData>('owner','GET',`/venues/${venueId}/payment-exceptions?${query}`);if(live.current&&generation.current===id){setData(value);setError(null)}}catch(e){if(live.current&&generation.current===id)setError(merchantError(e))}finally{if(live.current&&generation.current===id)setBusy(false)}},[api,venueId,query])
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;generation.current++}},[load,refresh])
 return <>{error&&<p role="alert">{t('Data may be stale. Last successful figures are retained.')} {error}</p>}{data&&<p className="m-muted">{t('Last successful update')}: {new Date(data.updatedAt).toLocaleString()}</p>}{!data&&!error&&<p>{t('Loading payment exceptions…')}</p>}{data?.items.map(item=><ExceptionCard key={item.order.id} api={api} venueId={venueId} scope={scope} item={item} onRefresh={onRefresh} onRefunds={onRefunds}/>)}{data?.items.length===0&&<p>{t('No matching payment exceptions.')}</p>}<div className="m-row"><button disabled={page===0||busy} onClick={()=>onPage(page-1)}>{t('Previous page')}</button><span>{t('Page')} {page+1}</span><button disabled={!data?.hasMore||busy} onClick={()=>onPage(page+1)}>{t('Next page')}</button></div></>
}
function ExceptionCard({api,venueId,scope,item,onRefresh,onRefunds}:{api:MerchantApi;venueId:string;scope:string;item:PaymentException;onRefresh:()=>void;onRefunds:()=>void}) {
 const storageKey=`nimble:operation-intent:${scope}:${venueId}:${item.order.id}`
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null)
 const [intent,setIntent]=useState<Intent|null>(()=>{try{const value=JSON.parse(sessionStorage.getItem(storageKey)??'null');return value&&['recheck','reject-fulfillment'].includes(value.action)&&typeof value.reason==='string'&&typeof value.idempotencyKey==='string'?value:null}catch{return null}})
 const live=useRef(true),pending=useRef(false)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 const submit=async(action:Intent['action'])=>{
  if(pending.current)return
  const current=intent??{action,reason:action==='reject-fulfillment'?reason.trim():'Owner requested verification',idempotencyKey:uuid()}
  if(current.action==='reject-fulfillment'&&!current.reason)return
  try{sessionStorage.setItem(storageKey,JSON.stringify(current))}catch{setError(t('Cannot preserve this decision safely. Enable session storage before continuing.'));return}
  setIntent(current);pending.current=true;setBusy(true);setError(null);setMessage(null)
  try{
   const result=await api.request<OperationActionResult>('owner','POST',`/venues/${venueId}/orders/${item.order.id}/${current.action}`,{reason:current.reason,idempotencyKey:current.idempotencyKey})
   if(!live.current)return
   if(result.state==='PENDING'){setMessage(t('This decision is still pending. Refresh the exception list to see the latest server state.'));return}
   sessionStorage.removeItem(storageKey);setIntent(null)
   setMessage(result.outcome==='VERIFIED'?t('The server verified the transfer.'):result.outcome==='REJECTED'?t('Fulfillment rejected. Stock released; payment monitoring continues.'):result.outcome==='VERIFICATION_UNAVAILABLE'?t('Verification service is unavailable. No payment confirmation was made.'):t('The payment remains unverified. Do not ask the customer to pay again.'))
   onRefresh()
  }catch(e){if(live.current){if(e instanceof ApiError && e.status === 409){sessionStorage.removeItem(storageKey);setIntent(null)}setError(merchantError(e));onRefresh()}}
  finally{pending.current=false;if(live.current)setBusy(false)}
 }
 return <article className="m-soft m-payment-exception"><div className="m-row"><h3>{t('Order')} #{item.order.number}</h3><strong>{t(item.kind)}</strong></div><p>{t('Order ID')}: <code>{item.order.id}</code> · {t(item.order.status)}</p><p>{t('Created')}: {new Date(item.order.createdAt).toLocaleString()}</p>{item.quoteExpiresAt&&<p>{t('Quote expires')}: {new Date(item.quoteExpiresAt).toLocaleString()}</p>}
 {item.contextTruncated&&<p className="m-notice">{t('Payment context is limited to the first 25 attempts and held resources.')}</p>}
 {item.attempts.map(attempt=><div className="m-line" key={attempt.id}><div><strong>{cryptoAmount(attempt.amountAtomic,attempt.asset)}</strong><small>{t(attempt.purpose)} · {t(attempt.verification)}</small><code className="m-operation-hash">{attempt.hash}</code>{attempt.verificationCode&&<small>{t('Verification result')}: {t(attempt.verificationCode)}</small>}{attempt.lastCheckedAt&&<small>{t('Last checked')}: {new Date(attempt.lastCheckedAt).toLocaleString()}</small>}<small>{t('Checks')}: {attempt.checks} · {attempt.nextCheckAt?`${t('Next check')}: ${new Date(attempt.nextCheckAt).toLocaleString()}`:t('No scheduled check time')}</small></div></div>)}
 <p>{t('Held stock')}: {item.holds.length?item.holds.map(hold=>`${hold.itemId} × ${hold.quantity}`).join(', '):t('None')}</p>
 {item.order.fulfillmentRejectedAt&&<p className="m-notice">{t('Fulfillment was rejected. Monitoring continues for late funds requiring a refund.')}</p>}
 {item.lastRecheckAt&&<p className="m-muted">{t('Last recheck')}: {new Date(item.lastRecheckAt).toLocaleString()}</p>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {item.kind==='REFUND_REQUIRED'?<button onClick={onRefunds}>{t('Open owner refund approvals')}</button>:<><button disabled={busy||!!intent} onClick={()=>void submit('recheck')}>{t('Recheck payment')}</button><p className="m-muted">{t('Rejecting fulfillment releases reserved stock. Payment monitoring continues. Any later verified funds require an owner-approved refund; the order will not be fulfilled automatically.')}</p><label>{t('Reason for rejecting fulfillment')}<textarea value={reason} disabled={busy||!!intent} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><button className="m-danger" disabled={busy||!!intent||reason.trim().length<3||!!item.order.fulfillmentRejectedAt} onClick={()=>void submit('reject-fulfillment')}>{t('Reject fulfillment and release stock')}</button></>}
 {intent&&<button disabled={busy} onClick={()=>void submit(intent.action)}>{t('Retry the same decision')}</button>}
 </article>
}
