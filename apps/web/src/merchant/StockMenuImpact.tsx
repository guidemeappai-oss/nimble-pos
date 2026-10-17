import {useEffect,useRef,useState} from 'react';
import type {StockMenuImpact as Impact} from '@nimble/shared';
import type {MerchantApi} from './client';
import {merchantError} from './errors';
import {t} from '../i18n';
type Props={api:MerchantApi;venueId:string;scope:string;owner?:boolean;revision:string};
export function StockMenuImpact(props:Props){return <ImpactSession key={`${props.scope}:${props.venueId}:${props.owner}`} {...props}/>}
function ImpactSession({api,venueId,owner=false,revision}:Props){
 const [data,setData]=useState<Impact|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[reason,setReason]=useState<Record<string,string>>({}),[message,setMessage]=useState('');
 const live=useRef(true),serial=useRef(0),lock=useRef(false),keys=useRef(new Map<string,string>()),auth=owner?'owner':'cashier',base=`/venues/${venueId}/inventory/availability-impact`;
 const load=async()=>{const n=++serial.current;const r=await api.request<Impact>(auth,'GET',base);if(live.current&&n===serial.current)setData(r)};
 useEffect(()=>{live.current=true;setError(null);void load().catch(e=>{if(live.current){setData(null);setError(merchantError(e))}});return()=>{live.current=false;serial.current++}},[api,auth,base,revision]);
 const refund=async(id:string)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError(null);
  const signature=id+':'+reason[id].trim();let key=keys.current.get(signature);if(!key){key=crypto.randomUUID();keys.current.set(signature,key)}
  try{await api.request(auth,'POST',base+`/orders/${id}/refund`,{reason:reason[id].trim(),idempotencyKey:key});if(live.current){setMessage(t('Refund requested. The owner still approves and signs the transfer. Ingredients were not restored.'));await load()}}
  catch(e){if(live.current)setError(merchantError(e))}finally{lock.current=false;if(live.current)setBusy(false)}
 };
 return <section className="m-panel"><h2>{t('Ingredient availability impact')}</h2><p>{t('The preview respects stock reservations, manual blocks and menu schedules. Each final basket is checked atomically at checkout.')}</p>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}<button disabled={busy} onClick={()=>void load().catch(e=>{if(live.current)setError(merchantError(e))})}>{t('Refresh ingredient impact')}</button>
 {data&&<><h3>{t('Unavailable variants and add-ons')}</h3>{!data.options.length&&<p>{t('No stock shortages in the current menu.')}</p>}{data.options.map(o=><p key={`${o.productId}:${o.kind}:${o.optionId}`}>{o.productName} · {o.optionName}: {o.missingItemIds.map(id=>data.resources.find(r=>r.id===id)?.name??id).join(', ')}</p>)}<h3>{t('Accepted orders requiring a decision')}</h3>{!data.orders.length&&<p>{t('No accepted orders affected by a manual ingredient block.')}</p>}{data.orders.map(o=><article className="m-soft" key={o.id}><h4>#{o.number} · {o.status}</h4><p>{o.blockedItemIds.map(id=>data.resources.find(r=>r.id===id)?.name??id).join(', ')}</p>{owner?<><label>{t('Stock exception refund reason')} {o.number}<input maxLength={500} value={reason[o.id]??''} disabled={busy} onChange={e=>setReason(old=>({...old,[o.id]:e.target.value}))}/></label><button disabled={busy||(reason[o.id]?.trim().length??0)<3} onClick={()=>void refund(o.id)}>{t('Request owner-approved refund')}</button></>:<p>{t('Ask the owner to resolve this fulfillment exception.')}</p>}</article>)}</>}
 </section>;
}
