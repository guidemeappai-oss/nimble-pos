import { useEffect, useRef, useState } from 'react'
import type { MenuScheduleView, MerchantProduct } from '@nimble/shared'
import { MenuScheduleConfig } from '@nimble/shared'
import type { MerchantApi } from './client'
function instantInZone(local: string, timezone: string) {
  const target = Date.parse(`${local}:00Z`)
  if (!Number.isFinite(target)) throw new Error('Choose a valid pause end time.')
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
  const matches: number[] = []
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = target + offset * 60000
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type,p.value]))
    if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === local) matches.push(instant)
  }
  if (matches.length !== 1) throw new Error(matches.length ? 'This time occurs twice when clocks change. Choose another time.' : 'This time does not exist when clocks change. Choose another time.')
  return new Date(matches[0]).toISOString()
}
export function MenuScheduleBoard(props: { api: MerchantApi; venueId: string; cashier?: boolean; scope: string; products: MerchantProduct[] }) {
  return <ScheduleEditor key={`${props.scope}:${props.venueId}`} {...props} />
}
function ScheduleEditor({ api, venueId, cashier = false, products }: Parameters<typeof MenuScheduleBoard>[0]) {
  const [config, setConfig] = useState<MenuScheduleView | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [reason, setReason] = useState(''), [target, setTarget] = useState(''), [kind, setKind] = useState<'product'|'variant'|'extra'>('product'), [optionId, setOption] = useState('')
  const [day, setDay] = useState(1), [start, setStart] = useState('09:00'), [end, setEnd] = useState('17:00'), [exception, setException] = useState(''), [closed, setClosed] = useState(false), [until, setUntil] = useState('')
  const generation = useRef(0), active = useRef(true), intent = useRef<{ signature: string; key: string } | null>(null), lock = useRef(false)
  const path = `/venues/${venueId}/menu/schedule`, authority = cashier ? 'cashier' : 'owner'
  useEffect(() => { const g=++generation.current; active.current = true; void api.request<MenuScheduleView>(authority, 'GET', path).then(r => { const parsed=MenuScheduleConfig.safeParse({timezone:r.timezone,rules:r.rules}); if(!parsed.success||!Number.isInteger(r.revision))throw new Error('Availability schedule unavailable. Reload this view.'); if(active.current&&g===generation.current)setConfig(r) }).catch(e => { if(active.current&&g===generation.current)setError(String(e.message)) }); return () => { active.current = false;generation.current++ } }, [api, authority, path])
  const update = (next: MenuScheduleView) => { setConfig(next); setNotice(''); intent.current = null }
  const product = products.find(p => p.id === target)
  const addRule = (temporaryOnly = false) => {
    if(!config || !target || (kind !== 'product' && !optionId))return
    if (temporaryOnly && !until) { setError('Choose when the pause should end.'); return }
    let disabledUntil: string | undefined
    try { disabledUntil = until ? instantInZone(until, config.timezone) : undefined } catch(e) { setError(e instanceof Error ? e.message : 'Invalid time'); return }
    const key = (r: MenuScheduleView['rules'][number]) => r.productId === target && r.kind === kind && r.optionId === (kind === 'product' ? undefined : optionId)
    const old = config.rules.find(key)
    const windows = closed ? [] : [{ start, end }]
    const rule = { productId: target, kind, ...(kind !== 'product' ? { optionId } : {}), weekly: old?.weekly ?? [], exceptions: old?.exceptions ?? [], disabledUntil: disabledUntil || old?.disabledUntil || null }
    if(!temporaryOnly && exception) rule.exceptions = [...rule.exceptions.filter(x => x.date !== exception), { date: exception, windows }]
    else if(!temporaryOnly) rule.weekly = [...rule.weekly.filter(x => x.day !== day), { day, windows }]
    const next = { ...config, rules: [...config.rules.filter(r => !key(r)), rule] }
    const parsed = MenuScheduleConfig.safeParse(nextConfig(next))
    if(!parsed.success){setError(parsed.error.issues[0]?.message ?? 'Invalid schedule');return}
    setError(''); update(next)
  }
  const nextConfig = (v: MenuScheduleView) => ({ timezone: v.timezone, rules: v.rules })
  const save = async () => {
    if(!config || !reason.trim() || lock.current)return
    lock.current = true; setBusy(true); setError('')
    const body = { ...nextConfig(config), revision: config.revision, reason: reason.trim() }
    const signature = JSON.stringify(body)
    if(intent.current?.signature !== signature)intent.current = { signature, key: crypto.randomUUID() }
    try { const result = await api.request<MenuScheduleView>(authority, 'PUT', path, { ...body, idempotencyKey: intent.current.key }); if(active.current){setConfig(result);intent.current=null;setNotice('Availability schedule saved. Existing quotes keep their terms.')} }
    catch(e){if(active.current)setError(e instanceof Error?e.message:'Could not save schedule')}
    finally{lock.current=false;if(active.current)setBusy(false)}
  }
  if(!config)return <section className="m-panel"><h3>Menu availability schedule</h3><p>{error || 'Loading schedule…'}</p></section>
  return <section className="m-panel"><h3>Menu availability schedule</h3><p>Changes apply to new purchases in POS and online. Manual unavailability always takes precedence. Weekly windows use local wall-clock time; an overnight window continues into the next day unless that date has an exception.</p><fieldset disabled={busy}><label>Availability time zone<input value={config.timezone} onChange={e => update({...config,timezone:e.target.value})}/></label><label>Scheduled product<select value={target} onChange={e=>{setTarget(e.target.value);setOption('')}}><option value="">Choose product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Schedule target<select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setOption('')}}><option value="product">Whole product</option><option value="variant">Variant</option><option value="extra">Add-on</option></select></label>{kind!=='product'&&<label>Scheduled option<select value={optionId} onChange={e=>setOption(e.target.value)}><option value="">Choose option</option>{(kind==='variant'?product?.variants:product?.extras)?.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
  <label>Day of week<select value={day} onChange={e=>setDay(Number(e.target.value))}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label><label>Date exception<input type="date" value={exception} onChange={e=>setException(e.target.value)}/></label><label><input type="checkbox" checked={closed} onChange={e=>setClosed(e.target.checked)}/>Closed for selected day</label><label>Available from<input type="time" disabled={closed} value={start} onChange={e=>setStart(e.target.value)}/></label><label>Available until<input type="time" disabled={closed} value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Pause until · {config.timezone}<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label><button type="button" onClick={()=>addRule()}>Add or replace availability rule</button><button type="button" onClick={()=>addRule(true)}>Apply temporary pause only</button>
  {config.rules.map((r,i)=><article className="m-soft" key={`${r.productId}:${r.kind}:${r.optionId}`}><strong>{products.find(p=>p.id===r.productId)?.name??'Removed product'} · {r.kind}</strong>{r.weekly.map(w=><p key={w.day}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][w.day]}: {w.windows.map(x=>`${x.start}–${x.end}`).join(', ')||'Closed'}</p>)}{r.exceptions.map(x=><p key={x.date}>{x.date}: {x.windows.map(w=>`${w.start}–${w.end}`).join(', ')||'Closed'}</p>)}{r.disabledUntil&&<><p>Paused until {new Date(r.disabledUntil).toLocaleString(undefined,{timeZone:config.timezone})}</p><button type="button" onClick={()=>update({...config,rules:config.rules.map((x,index)=>i===index?{...x,disabledUntil:null}:x)})}>End timed pause</button></>}<button type="button" onClick={()=>update({...config,rules:config.rules.filter((_,index)=>i!==index)})}>Remove availability rule</button></article>)}<label>Availability change reason<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><button type="button" disabled={!reason.trim()} onClick={()=>void save()}>Save availability schedule</button></fieldset>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</section>
}
