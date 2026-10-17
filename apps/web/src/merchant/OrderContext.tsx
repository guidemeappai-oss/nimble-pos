import {useCallback,useEffect,useRef,useState} from 'react'
import type {MerchantApi} from './client'
import {merchantError} from './errors'
import {uuid} from '../lib/uuid'
import {t} from '../i18n'
import type {OrderContextSummary as ContextSummary,OrderContextEntry as Entry,OrderContextMutation as Intent} from '@nimble/shared'
interface History {summary:ContextSummary;entries:Entry[];hasMore:boolean}
export function useOrderContextQueue<T extends {id:string}>(api:MerchantApi,venueId:string,scope:string,orders:T[],owner=false,enabled=true){
 const ids=orders.map(o=>o.id).join(','),identity=`${scope}:${venueId}:${owner}`,current=useRef(identity);current.current=identity
 const [state,setState]=useState<{identity:string;items:ContextSummary[];error:string|null}>({identity,items:[],error:null})
 const serial=useRef(0)
 const load=useCallback(async()=>{
  if(!enabled||!venueId||!ids)return
  const request=++serial.current
  try{const chunks=ids.split(','),items:ContextSummary[]=[]
   for(let i=0;i<chunks.length;i+=50){const result=await api.request<{items:ContextSummary[]}>(owner?'owner':'cashier','GET',`/venues/${venueId}/order-context?orderIds=${chunks.slice(i,i+50).join(',')}`);if(current.current!==identity||request!==serial.current)return;items.push(...result.items)}
   if(current.current===identity)setState({identity,items,error:null})
  }catch(e){if(current.current===identity&&request===serial.current)setState(old=>({identity,items:old.identity===identity?old.items:[],error:merchantError(e)}))}
 },[api,venueId,ids,identity,owner,enabled])
 useEffect(()=>{current.current=identity;void load();const timer=setInterval(()=>void load(),15000);return()=>{clearInterval(timer);serial.current++;current.current=''}},[load,identity])
 const items=state.identity===identity?state.items:[],summaries=new Map(items.map(item=>[item.orderId,item]))
 return {orders:[...orders].sort((a,b)=>Number(summaries.get(b.id)?.priority==='HIGH')-Number(summaries.get(a.id)?.priority==='HIGH')),summaries,error:state.identity===identity?state.error:null,refresh:load}
}
export function OrderContextPanel(props:{api:MerchantApi;venueId:string;orderId:string;scope:string;owner?:boolean;canWrite:boolean;summary?:ContextSummary;onChanged?:()=>void;demo?:boolean}){
 return <ContextSession key={`${props.scope}:${props.venueId}:${props.orderId}`} {...props}/>
}
function ContextSession({api,venueId,orderId,owner=false,canWrite,summary,onChanged,demo=false}:{api:MerchantApi;venueId:string;orderId:string;scope:string;owner?:boolean;canWrite:boolean;summary?:ContextSummary;onChanged?:()=>void;demo?:boolean}){
 const [open,setOpen]=useState(false),[data,setData]=useState<History|null>(null),[page,setPage]=useState(0),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
 const [text,setText]=useState(''),[kind,setKind]=useState<Entry['kind']>('NOTE'),[priority,setPriority]=useState<'NORMAL'|'HIGH'>('HIGH'),[pending,setPending]=useState<Intent|null>(null)
 const active=useRef(true),read=useRef(0),lock=useRef(false),path=`/venues/${venueId}/orders/${orderId}/context`
 const load=useCallback(async(p:number)=>{const request=++read.current;try{const result=await api.request<History>(owner?'owner':'cashier','GET',`${path}?page=${p}&limit=20`);if(active.current&&request===read.current){setData(result);setPage(p);setError(null)}}catch(e){if(active.current&&request===read.current)setError(merchantError(e))}},[api,owner,path])
 useEffect(()=>{active.current=true;return()=>{active.current=false;read.current++}},[])
 const save=async()=>{
  if(lock.current||!canWrite||!data)return
  const intent=pending??{revision:data.summary.revision,idempotencyKey:uuid(),kind,text:text.trim(),...(kind==='PRIORITY'?{priority}:{})}
  setPending(intent);lock.current=true;setBusy(true);read.current++
  try{await api.request(owner?'owner':'cashier','POST',path,intent);if(!active.current)return;setPending(null);setText('');await load(0);if(active.current)onChanged?.()}
  catch(e){if(!active.current)return;const code=(e as {code?:string}).code;if(code==='ORDER_CONTEXT_CONFLICT'||code==='IDEMPOTENCY_CONFLICT'){setPending(null);await load(0);if(active.current)setError(t('Context changed. Review the refreshed history before saving again.'))}else setError(merchantError(e))}
  finally{lock.current=false;if(active.current)setBusy(false)}
 }
 const visible=summary&&(!data||summary.revision>data.summary.revision)?summary:data?.summary??summary
 return <section className="m-order-context">
  {visible?.priority==='HIGH'&&<strong className="m-notice">{t('High priority')}</strong>}
  {visible?.delayReason&&<p>{t('Internal delay reason')}: {visible.delayReason}</p>}
  <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open&&!demo)void load(0)}}>{t('Internal order context')}</button>
  {open&&<div className="m-soft m-form"><p className="m-muted">{t('Only staff can see these notes. Priority does not change the promised time or paid price.')}</p>
   {demo?<p>{t('Internal context requires a connected venue.')}</p>:<>
    {error&&<p role="alert">{t('History may be stale. Last successful entries are retained.')} {error}</p>}
    <button type="button" disabled={busy} onClick={()=>void load(page)}>{t('Refresh history')}</button>
    {data?.entries.map(entry=><article key={entry.id}><strong>{t(entry.kind)}{entry.priority?` · ${t(entry.priority)}`:''}</strong><p>{entry.text}</p><small>{entry.actor.name} · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></small></article>)}
    {data?.entries.length===0&&<p>{t('No internal entries yet.')}</p>}
    <div className="m-row"><button type="button" disabled={busy||page===0} onClick={()=>void load(page-1)}>{t('Newer entries')}</button><span>{page+1}</span><button type="button" disabled={busy||!data?.hasMore} onClick={()=>void load(page+1)}>{t('Older entries')}</button></div>
    {!canWrite&&<p>{t('Open a shift to add internal context.')}</p>}
    <label>{t('Entry type')}<select value={kind} disabled={busy||!!pending||!canWrite} onChange={e=>setKind(e.target.value as Entry['kind'])}><option value="NOTE">{t('Note')}</option><option value="PRIORITY">{t('Priority')}</option><option value="DELAY">{t('Delay reason')}</option></select></label>
    {kind==='PRIORITY'&&<label>{t('Priority')}<select value={priority} disabled={busy||!!pending||!canWrite} onChange={e=>setPriority(e.target.value as 'NORMAL'|'HIGH')}><option value="HIGH">{t('High priority')}</option><option value="NORMAL">{t('Normal priority')}</option></select></label>}
    <label>{t('Internal note or reason')}<textarea maxLength={1000} minLength={3} value={text} disabled={busy||!!pending||!canWrite} onChange={e=>setText(e.target.value)}/></label>
    <button type="button" disabled={busy||!canWrite||!data||(!pending&&text.trim().length<3)} onClick={()=>void save()}>{t(pending?'Retry same entry':'Save internal context')}</button>
   </>}
  </div>}
 </section>
}
