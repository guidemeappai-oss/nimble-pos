import {useCallback,useEffect,useRef,useState} from 'react'
import type {MerchantOperations} from '@nimble/shared'
import type {MerchantApi} from './client'
import {cryptoAmount,money} from './format'
import {merchantError} from './errors'
import {t} from '../i18n'

function exactSales(minor:string,currency:string) {
 const value=BigInt(minor)
 return new Intl.NumberFormat('en',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).formatToParts(value/100n).map(part=>part.type==='fraction'?(value%100n).toString().padStart(2,'0'):part.value).join('')
}


export function VenueOperations({api,venueId,scope,cashier=false,onAction}:{api:MerchantApi;venueId:string;scope:string;cashier?:boolean;onAction:(section:string)=>void}) {
 const identity=`${scope}:${venueId}:${cashier}`
 return <OperationsSession key={identity} api={api} venueId={venueId} cashier={cashier} onAction={onAction}/>
}
function OperationsSession({api,venueId,cashier,onAction}:{api:MerchantApi;venueId:string;cashier:boolean;onAction:(section:string)=>void}) {
 const [data,setData]=useState<MerchantOperations|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const live=useRef(true),request=useRef(0)
 const load=useCallback(async()=>{
  const id=++request.current
  setBusy(true)
  try {const next=await api.request<MerchantOperations>(cashier?'cashier':'owner','GET',`/venues/${venueId}/operations`);if(!next?.window||!next?.terminal||!Array.isArray(next.shifts)||!Array.isArray(next.orders)||!Array.isArray(next.receivedPayments)||typeof next.acceptedSalesMinor!=='string')throw new Error('Venue situation unavailable');if(live.current&&request.current===id){setData(next);setError(null)}}
  catch(e){if(live.current&&request.current===id)setError(merchantError(e))}
  finally{if(live.current&&request.current===id)setBusy(false)}
 },[api,cashier,venueId])
 useEffect(()=>{live.current=true;void load();const timer=setInterval(()=>void load(),15000);return()=>{live.current=false;request.current++;clearInterval(timer)}},[load])
 return <section className="m-panel m-operations" aria-label={t('Your venue now')}>
  <div className="m-row"><div><span className="m-label">{t('Your venue now')}</span><h2>{t('A clear view of your venue')}</h2></div><button disabled={busy} onClick={()=>void load()}>{t('Refresh situation')}</button></div>
  {error&&<p role="alert" className="m-notice">{t('Data may be stale. Last successful figures are retained.')} {error}</p>}
  {!data?<p className="m-muted">{t('Loading venue situation…')}</p>:<>
   <p className="m-muted">{t('Last successful update')}: <time dateTime={data.updatedAt}>{new Date(data.updatedAt).toLocaleString()}</time></p>
   <div className="m-metrics"><div><strong>{data.openOrderCount}</strong><small>{t('Open orders')}</small></div><div><strong>{data.delayedOrderCount}</strong><small>{t('Delayed orders')}</small></div><div><strong>{data.shifts.length}</strong><small>{t('Active shifts')}</small></div><div><strong>{data.refundCount}</strong><small>{t('Refund obligations')}</small></div></div>
   <div className="m-soft"><span className="m-label">{t('Rolling 24 hours')}</span><h3>{exactSales(data.acceptedSalesMinor,data.fiatCurrency)}</h3><p>{t('Accepted sales')}</p><p className="m-muted">{t('Received payments · separate from accepted sales')}</p>{data.receivedPayments.map(receipt=><p key={`${receipt.asset}:${receipt.network}`}><strong>{cryptoAmount(receipt.amountAtomic,receipt.asset)}</strong> · {receipt.network} · {receipt.count} {t('payments')}</p>)}{data.receivedPayments.length===0&&<p>{t('No confirmed receipts in this window.')}</p>}<small>{new Date(data.window.from).toLocaleString()} — {new Date(data.window.to).toLocaleString()}</small></div>
   <p>{t('Terminal')}: <strong>{t(data.terminal.state)}</strong> · {data.terminal.lastSeenAt?new Date(data.terminal.lastSeenAt).toLocaleString():t('No recent heartbeat')}</p>
   <div className="m-row"><button onClick={()=>onAction('Remote orders')}>{t('Open order operations')}</button>{!cashier&&<button onClick={()=>onAction('Payments')}>{t('Resolve payment exceptions')}</button>}{!cashier&&<button onClick={()=>onAction('Refund approvals')}>{t('Review refund approvals')}</button>}</div>
   {data.orders.map(order=><div className="m-line" key={order.id}><span>#{order.number} · {t(order.status)}<small>{order.delayMinutes>0?`${order.delayMinutes} ${t('minutes overdue')}`:t(order.source)}</small></span><strong>{money(order.totalMinor,data.fiatCurrency)}</strong></div>)}
   {data.shifts.map(shift=><p key={shift.id}>{shift.employeeName} · {t('Shift opened')} {new Date(shift.openedAt).toLocaleString()}</p>)}
   {data.truncated&&<p className="m-muted">{t('This preview is limited. Open the detailed sections for more records.')}</p>}
  </>}
 </section>
}
