import {DepositDecision,DepositResolutionHistory} from './DepositResolutions'
import { useEffect, useRef, useState } from 'react'
import type { MerchantAsset, WalletDiscoveryView } from '@nimble/shared'
import type { MerchantApi } from './client'
import { cryptoAmount } from './format'
export function WalletDiscovery(props:{api:MerchantApi;venueId:string;scope:string}){const [open,setOpen]=useState(false);return <section><button onClick={()=>setOpen(v=>!v)}>{open?'Hide wallet deposit monitoring':'Show wallet deposit monitoring'}</button>{open&&<DiscoveryView key={`${props.scope}:${props.venueId}`} {...props}/>}</section>}
function DiscoveryView({api,venueId,scope}:Parameters<typeof WalletDiscovery>[0]){
 const [data,setData]=useState<WalletDiscoveryView|null>(null),[asset,setAsset]=useState<MerchantAsset>('NIM'),[block,setBlock]=useState('0'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[page,setPage]=useState(0)
 const generation=useRef(0),lock=useRef(false),intent=useRef<{body:object;signature:string}|null>(null)
 const path=`/venues/${venueId}/wallet-discovery`
 const load=async(g:number)=>{const r=await api.request<WalletDiscoveryView>('owner','GET',path+`?page=${page}`);if(!Array.isArray(r.states)||!Array.isArray(r.items))throw new Error('Deposit history unavailable. Retry refresh.');if(g===generation.current)setData(r)}
 useEffect(()=>{const g=++generation.current;void load(g).catch(e=>{if(g===generation.current)setError(e instanceof Error?e.message:'Could not load wallet history')});return()=>{generation.current++}},[api,path,page])
 const run=async(action:'configure'|'scan',enabled=true)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');const g=generation.current
  try{
   if(action==='configure'){
    if(reason.trim().length<3)return
    const values={asset,enabled,reason:reason.trim(),...(asset==='USDT'?{startBlock:Number(block)}:{})},signature=JSON.stringify(values)
    if(intent.current?.signature!==signature)intent.current={signature,body:{...values,idempotencyKey:crypto.randomUUID()}}
    await api.request('owner','PUT',path+'/configuration',intent.current.body);intent.current=null
   }else await api.request('owner','POST',path+'/scan',{asset})
   if(g!==generation.current)return
   setNotice(action==='scan'?'Wallet history page processed. Discovery does not accept an order or send a refund.':'Monitoring configuration saved.')
   await load(g)
  }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'History scan unavailable')}
  finally{lock.current=false;if(g===generation.current)setBusy(false)}
 }
 return <section className="m-panel"><h3>Wallet deposits without an app submission</h3><p>These records are separate from accepted sales. A reported transaction hash is only a reference; it does not match a deposit to an order automatically. OBSERVED means unverified, FINALIZED means the configured node confirmed the canonical transfer, REMOVED means the source reported a removed event.</p>
 <fieldset disabled={busy}><label>Deposit asset<select value={asset} onChange={e=>setAsset(e.target.value as MerchantAsset)}><option>NIM</option><option>USDT</option></select></label>{asset==='USDT'&&<label>First Polygon block for a new scan<input type="number" min="0" max="2147483647" value={block} onChange={e=>setBlock(e.target.value)}/></label>}<p>Starting at block 0 includes all history available from your configured Polygon node. Large histories take multiple pages. Resuming monitoring keeps the saved checkpoint; it does not restart at this field.</p><label>Monitoring change reason<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><button disabled={reason.trim().length<3} onClick={()=>void run('configure')}>Enable or resume deposit monitoring</button><button disabled={reason.trim().length<3} onClick={()=>void run('configure',false)}>Pause deposit monitoring</button><button onClick={()=>void run('scan')}>Scan next history page</button><button onClick={()=>void load(generation.current).catch(e=>setError(e.message))}>Refresh deposit records</button></fieldset>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{!data&&!error&&<p>Loading deposit records…</p>}
 {data?.states.map(s=><article className="m-soft" key={s.asset}><strong>{s.asset} · {s.enabled?'Monitoring enabled':'Monitoring paused'}</strong><p>{s.recipient} · {s.network}</p><p>Last successful scan: {s.lastScannedAt?new Date(s.lastScannedAt).toLocaleString():'Not scanned'}</p>{s.coveredThrough!==null&&<p>Scanned through block {s.coveredThrough}; next {s.cursor.nextBlock}</p>}{s.cursor.before&&<p>Older history still being imported.</p>}{s.lastError&&<p role="alert">{s.lastError}. The previous checkpoint is retained.</p>}</article>)}
 {data?.items.map(e=><article className="m-soft" key={e.id}><strong>{cryptoAmount(e.amountAtomic,e.asset)} · {e.confirmation}</strong><p>{e.network} · block {e.blockNumber} · event {e.eventIndex}</p><code className="m-operation-hash">{e.hash}</code><p>Sender: {e.sender??'Unknown'} → {e.recipient}</p>{e.reportedOrderIds.length?<p>Hash also reported for order(s): {e.reportedOrderIds.join(', ')}. This is not automatic matching.</p>:<p>No matching app submission found.</p>}<DepositDecision key={`${scope}:${e.id}`} api={api} venueId={venueId} event={e} onChanged={()=>load(generation.current)}/></article>)}{data&&data.items.length===0&&<p>No discovered deposits in this page.</p>}<DepositResolutionHistory api={api} venueId={venueId} scope={scope}/><div className="m-row"><button disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>Previous deposit page</button><span>{page+1}</span><button disabled={busy||!data?.hasMore} onClick={()=>setPage(p=>p+1)}>Next deposit page</button></div></section>
}
