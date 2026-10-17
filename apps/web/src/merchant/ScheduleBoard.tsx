import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MerchantApi } from './client'
import type { MerchantEmployee, MerchantSchedule, ScheduleShift } from './contract'

type DraftShift = { employeeId: string; startsAt: string; endsAt: string; role: string }
type Props = { api: MerchantApi; venueId: string; employeeId: string; manage: boolean; owner?: boolean }

function mondayOf(date = new Date()) {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}
const localDateTime = (date: string, time: string) => `${date}T${time}`
const formatters = new Map<string, Intl.DateTimeFormat>()
const offsetsByDay = new Map<string, number[]>()
const formatterFor = (timeZone: string) => {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  formatters.set(timeZone, formatter)
  return formatter
}
const zoneParts = (instant: number, timeZone: string) => Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(instant)).map(x => [x.type, x.value]))
const toLocalInput = (value: string, timeZone: string) => {
  const parts = zoneParts(new Date(value).getTime(), timeZone)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
type LocalTimeResolution = { kind: 'valid'; iso: string } | { kind: 'missing' | 'repeated' | 'invalid-zone' | 'invalid' }
const resolveLocalTime = (value: string, timeZone: string): LocalTimeResolution => {
  if (!value || !timeZone) return { kind: 'invalid' }
  const [date, time] = value.split('T'), [year, month, day] = (date ?? '').split('-').map(Number), [hour, minute] = (time ?? '').split(':').map(Number)
  if (![year, month, day, hour, minute].every(Number.isInteger)) return { kind: 'invalid' }
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const normalized = new Date(target)
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day || hour < 0 || hour > 23 || minute < 0 || minute > 59) return { kind: 'invalid' }
  const cacheKey = `${timeZone}:${date}`
  let offsets = offsetsByDay.get(cacheKey)
  try {
    if (!offsets) {
      const zoneOffsets = new Set<number>(), dayStart = Date.UTC(year, month - 1, day)
      for (let offset = -48 * 60; offset <= 48 * 60; offset += 30) {
        const probe = dayStart + offset * 60_000
        const p = zoneParts(probe, timeZone)
        zoneOffsets.add(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - probe)
      }
      offsets = [...zoneOffsets]
      offsetsByDay.set(cacheKey, offsets)
    }
  } catch { return { kind: 'invalid-zone' } }
  const candidates = offsets.map(offset => target - offset).filter(instant => {
    const p = zoneParts(instant, timeZone)
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) === target
  }).sort((a, b) => a - b)
  if (!candidates.length) return { kind: 'missing' }
  if (candidates.length > 1) return { kind: 'repeated' }
  return { kind: 'valid', iso: new Date(candidates[0]).toISOString() }
}
const localIssue = (value: string, label: string, timeZone: string) => {
  const result = resolveLocalTime(value, timeZone)
  if (result.kind === 'missing') return `${label}: this local time does not exist because clocks move forward. Choose another time.`
  if (result.kind === 'repeated') return `${label}: this local time occurs twice because clocks move back. Choose a time outside the repeated hour.`
  if (result.kind === 'invalid-zone') return 'Enter a valid IANA time zone, for example Europe/Warsaw.'
  if (result.kind === 'invalid') return `${label}: enter a valid date and time.`
  return null
}
const toIso = (value: string, timeZone: string) => {
  const result = resolveLocalTime(value, timeZone)
  if (result.kind !== 'valid') throw new Error(localIssue(value, 'Time', timeZone) ?? 'Choose a valid venue time zone.')
  return result.iso
}
const weekDay = (week: string, day: number, timeZone: string) => {
  const date = new Date(`${week}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + day)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone })
}

export function ScheduleBoard({ api, venueId, employeeId, manage, owner = false }: Props) {
  const [weekStart, setWeekStart] = useState(mondayOf)
  const [timeZone, setTimeZone] = useState('')
  const [schedule, setSchedule] = useState<MerchantSchedule | null>(null)
  const [employees, setEmployees] = useState<MerchantEmployee[]>([])
  const [mine, setMine] = useState<ScheduleShift[]>([])
  const [pending, setPending] = useState<{ id: string; scheduleShiftId: string; requestedByEmployeeId: string; substituteEmployeeId: string; reason: string }[]>([])
  const [editing, setEditing] = useState(false)
  const [publishConfirmed, setPublishConfirmed] = useState(false)
  const [coverage, setCoverage] = useState({ startsAt: localDateTime(mondayOf(), '09:00'), endsAt: localDateTime(mondayOf(), '17:00'), minimumWorkers: 1 })
  const [drafts, setDrafts] = useState<DraftShift[]>([{ employeeId: '', startsAt: localDateTime(mondayOf(), '09:00'), endsAt: localDateTime(mondayOf(), '13:00'), role: 'Service' }])
  const [substitute, setSubstitute] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadGeneration = useRef(0)
  const saveAttempt = useRef<{ fingerprint: string; key: string } | null>(null)
  const extraCoverage = useRef<MerchantSchedule['coverageHours']>([])
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setError(null)
    if (manage) {
      const data = await (owner ? api.venueSchedule(venueId, weekStart, true) : api.venueSchedule(venueId, weekStart))
      if (generation !== loadGeneration.current) return
      setSchedule(data.schedule)
      setTimeZone(data.schedule?.timeZone ?? '')
      setEmployees(data.employees.filter(e => e.active))
      setPending(data.pendingSubstitutions)
    } else {
      const data = await api.mySchedule(weekStart)
      if (generation !== loadGeneration.current) return
      setSchedule(data.schedule as MerchantSchedule | null)
      setTimeZone(data.schedule?.timeZone ?? '')
      setMine(data.shifts)
      setEmployees(data.employees.filter(e => e.active))
    }
  }, [api, manage, venueId, weekStart, employeeId, owner])

  useEffect(() => { setSchedule(null); setMine([]); setEmployees([]); setPending([]); setTimeZone(''); setBusy(false); setEditing(false); setPublishConfirmed(false); setSubstitute({}); setReason({}); let active = true; void load().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load schedule') }); return () => { active = false; loadGeneration.current++ } }, [load])

  const employeeName = useMemo(() => new Map(employees.map(e => [e.id, e.name])), [employees])
  const timeIssues = useMemo(() => {
    if (!timeZone.trim()) return ['Choose the venue time zone before setting schedule times.']
    return [
      ...([['Open from', coverage.startsAt], ['Open until', coverage.endsAt]] as [string, string][]).map(([label, value]) => localIssue(value, label, timeZone)),
      ...drafts.flatMap((shift, index) => [localIssue(shift.startsAt, `Shift ${index + 1} start`, timeZone), localIssue(shift.endsAt, `Shift ${index + 1} end`, timeZone)]),
    ].filter((issue): issue is string => Boolean(issue))
  }, [timeZone, coverage, drafts])
  const beginDraft = () => {
    saveAttempt.current = null
    extraCoverage.current = schedule?.coverageHours.slice(1) ?? []
    setCoverage({ startsAt: localDateTime(weekStart, '09:00'), endsAt: localDateTime(weekStart, '17:00'), minimumWorkers: 1 })
    setDrafts([{ employeeId: employees[0]?.id ?? '', startsAt: localDateTime(weekStart, '09:00'), endsAt: localDateTime(weekStart, '13:00'), role: 'Service' }])
    if (schedule) {
      const local = (iso: string) => { const p = zoneParts(Date.parse(iso), schedule.timeZone); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` }
      if (schedule.coverageHours[0]) setCoverage({ startsAt: local(schedule.coverageHours[0].startsAt), endsAt: local(schedule.coverageHours[0].endsAt), minimumWorkers: schedule.coverageHours[0].minimumWorkers ?? 1 })
      setDrafts(schedule.shifts.map(x => ({ employeeId: x.employeeId, startsAt: local(x.startsAt), endsAt: local(x.endsAt), role: x.role })))
    }
    setEditing(true); setPublishConfirmed(false); setNotice(null); setError(null)
  }
  const saveDraft = async () => {
    if (!drafts.length || !timeZone.trim() || timeIssues.length || drafts.some(x => !x.employeeId || !x.role.trim() || !x.startsAt || !x.endsAt)) return
    const generation = loadGeneration.current
    setBusy(true); setError(null)
    try {
      const fingerprint = JSON.stringify({ weekStart, timeZone, coverage, drafts })
      if (saveAttempt.current?.fingerprint !== fingerprint) saveAttempt.current = { fingerprint, key: crypto.randomUUID() }
      const createInput = {
        weekStart,
        timeZone,
        idempotencyKey: saveAttempt.current.key,
        coverageHours: [{ startsAt: toIso(coverage.startsAt, timeZone), endsAt: toIso(coverage.endsAt, timeZone), minimumWorkers: Number(coverage.minimumWorkers) }, ...extraCoverage.current],
        shifts: drafts.map(x => ({ employeeId: x.employeeId, startsAt: toIso(x.startsAt, timeZone), endsAt: toIso(x.endsAt, timeZone), role: x.role.trim() })),
      }
      const created = await (owner ? api.createSchedule(venueId, createInput, true) : api.createSchedule(venueId, createInput))
      if (generation !== loadGeneration.current) return
      setSchedule(created); setEditing(false); setPublishConfirmed(false); setNotice(`Draft v${created.version} saved. Review coverage gaps before publishing.`)
    } catch (e) { if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : 'Could not save schedule') } finally { if (generation === loadGeneration.current) setBusy(false) }
  }
  const publish = async () => {
    if (!schedule) return
    const generation = loadGeneration.current
    setBusy(true); setError(null)
    try { const published = await (owner ? api.publishSchedule(venueId, schedule.id, true) : api.publishSchedule(venueId, schedule.id)); if (generation !== loadGeneration.current) return; setSchedule(published); setNotice('Schedule published to the team.') } catch (e) { if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : 'Could not publish schedule') } finally { if (generation === loadGeneration.current) setBusy(false) }
  }
  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    const generation = loadGeneration.current
    setBusy(true); setError(null)
    try { await (owner ? api.decideSubstitution(venueId, id, decision, true) : api.decideSubstitution(venueId, id, decision)); if (generation !== loadGeneration.current) return; setNotice(decision === 'APPROVE' ? 'Substitution approved. A new schedule version is live.' : 'Substitution declined.'); setBusy(false); await load() } catch (e) { if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : 'Could not review request') } finally { if (generation === loadGeneration.current) setBusy(false) }
  }
  const request = async (shift: ScheduleShift) => {
    const selected = substitute[shift.id], note = reason[shift.id]?.trim()
    if (!schedule || !selected || !note) return
    const generation = loadGeneration.current
    setBusy(true); setError(null)
    try { await api.requestSubstitution(venueId, schedule.id, shift.id, { substituteEmployeeId: selected, reason: note }); if (generation !== loadGeneration.current) return; setNotice('Substitution request sent to the manager.'); setBusy(false); await load() } catch (e) { if (generation === loadGeneration.current) setError(e instanceof Error ? e.message : 'Could not request a substitute') } finally { if (generation === loadGeneration.current) setBusy(false) }
  }
  const orderedShifts = manage ? schedule?.shifts ?? [] : mine

  return <section className="m-panel schedule-board" aria-labelledby="schedule-heading">
    <header className="m-row schedule-heading">
      <div><span className="m-label">TEAM · WEEKLY PLAN</span><h2 id="schedule-heading">Schedule</h2><p className="m-muted">{timeZone ? `Local venue time · ${timeZone}. Work plan and cashier shift are separate.` : 'No published schedule time zone. The manager must choose the venue time zone before creating a schedule.'}</p></div>
      <label>Week starting<input aria-label="Week starting Monday" type="date" disabled={busy} value={weekStart} onChange={e => { if (e.target.value) { setEditing(false); setSchedule(null); setMine([]); setPending([]); setPublishConfirmed(false); setNotice(null); setWeekStart(e.target.value) } }} /></label>
    </header>
    {error && <p role="alert" className="m-error">{error}</p>}{notice && <p role="status" className="m-soft">{notice}</p>}
    {manage ? <>
      {schedule && <>
        <div className="m-row schedule-version"><h3>{schedule.status === 'PUBLISHED' ? 'Published schedule' : 'Draft schedule'} · v{schedule.version}</h3><span className="m-label">{schedule.status}</span></div>
        {schedule.coverage.uncovered.length > 0 ? <aside className="schedule-gaps"><strong>Coverage gaps</strong>{schedule.coverage.uncovered.map((gap, i) => <p key={`${gap.startsAt}-${i}`}>{weekDay(weekStart, gap.day, timeZone)} · {gap.from}–{gap.to} · {gap.missingWorkers} missing</p>)}</aside> : <p className="schedule-covered">All declared opening hours are covered.</p>}
        <div className="schedule-shifts">{schedule.shifts.map(shift => <article key={shift.id} className="schedule-shift"><div><strong>{employeeName.get(shift.employeeId) ?? 'Team member'}</strong><span>{shift.role}</span></div><time>{new Date(shift.startsAt).toLocaleString(undefined, { timeZone })} – {new Date(shift.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone })}</time></article>)}</div>
        {schedule.status === 'DRAFT' && <div className="schedule-publish"><p>Times will be published in <strong>{schedule.timeZone}</strong>.</p><label><input type="checkbox" checked={publishConfirmed} onChange={e => setPublishConfirmed(e.target.checked)} /> I checked the venue time zone and schedule times.</label><button className="m-primary" disabled={busy || !publishConfirmed} onClick={() => void publish()}>Publish to team →</button></div>}
      </>}
      {pending.length > 0 && <section className="schedule-requests"><h3>Substitution requests</h3>{pending.map(item => <article key={item.id} className="schedule-request"><div><strong>{employeeName.get(item.requestedByEmployeeId) ?? 'Team member'} → {employeeName.get(item.substituteEmployeeId) ?? 'Substitute'}</strong><p>{item.reason}</p></div><button disabled={busy} onClick={() => void decide(item.id, 'APPROVE')}>Approve</button><button className="m-soft" disabled={busy} onClick={() => void decide(item.id, 'REJECT')}>Decline</button></article>)}</section>}
      {!editing ? <button className="m-soft" disabled={busy || employees.length === 0} onClick={beginDraft}>{schedule ? 'Create next version' : 'Build this week’s schedule'} +</button> : <div className="schedule-editor">
        <label>Venue time zone<input aria-label="Venue time zone" list="venue-time-zones" value={timeZone} placeholder="Choose an IANA time zone" onChange={e => setTimeZone(e.target.value.trim())} /><datalist id="venue-time-zones">{['Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo', 'UTC'].map(zone => <option key={zone} value={zone} />)}</datalist></label>
        <p className="m-muted">All schedule times use this venue time zone, never the phone’s current zone.</p>
        {timeIssues.length > 0 && <aside className="schedule-gaps" role="alert"><strong>Review schedule times</strong>{timeIssues.map(issue => <p key={issue}>{issue}</p>)}</aside>}
        <h3>Coverage hours</h3><div className="schedule-inputs"><label>Open from<input type="datetime-local" value={coverage.startsAt} onChange={e => setCoverage(x => ({ ...x, startsAt: e.target.value }))} /></label><label>Open until<input type="datetime-local" value={coverage.endsAt} onChange={e => setCoverage(x => ({ ...x, endsAt: e.target.value }))} /></label><label>People required<input type="number" min="1" max="20" value={coverage.minimumWorkers} onChange={e => setCoverage(x => ({ ...x, minimumWorkers: Number(e.target.value) }))} /></label></div>
        <h3>Assigned shifts</h3>{drafts.map((shift, index) => <div className="schedule-draft-row" key={index}><label>Team member<select value={shift.employeeId} onChange={e => setDrafts(items => items.map((x, i) => i === index ? { ...x, employeeId: e.target.value } : x))}><option value="">Choose a person</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>Role<input maxLength={60} value={shift.role} onChange={e => setDrafts(items => items.map((x, i) => i === index ? { ...x, role: e.target.value } : x))} /></label><label>From<input type="datetime-local" value={shift.startsAt} onChange={e => setDrafts(items => items.map((x, i) => i === index ? { ...x, startsAt: e.target.value } : x))} /></label><label>Until<input type="datetime-local" value={shift.endsAt} onChange={e => setDrafts(items => items.map((x, i) => i === index ? { ...x, endsAt: e.target.value } : x))} /></label><button className="m-soft" onClick={() => setDrafts(items => items.filter((_, i) => i !== index))}>Remove</button></div>)}
        <div className="m-row"><button className="m-soft" onClick={() => setDrafts(items => [...items, { employeeId: employees[0]?.id ?? '', startsAt: localDateTime(weekStart, '09:00'), endsAt: localDateTime(weekStart, '13:00'), role: 'Service' }])}>Add shift +</button><button className="m-primary" disabled={busy || drafts.length === 0 || timeIssues.length > 0 || drafts.some(x => !x.employeeId || !x.role.trim())} onClick={() => void saveDraft()}>Save draft →</button><button className="m-soft" onClick={() => setEditing(false)}>Cancel</button></div>
      </div>}
    </> : <>
      <div className="schedule-shifts">{orderedShifts.map(shift => <article key={shift.id} className="schedule-shift"><div><strong>{shift.role}</strong><span>{new Date(shift.startsAt).toLocaleDateString(undefined, { timeZone })}</span></div><time>{new Date(shift.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone })} – {new Date(shift.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone })}</time>{schedule?.status === 'PUBLISHED' && employees.length > 0 && <details><summary>Request a substitute</summary><label>Ask a teammate<select aria-label="Choose substitute" value={substitute[shift.id] ?? ''} onChange={e => setSubstitute(v => ({ ...v, [shift.id]: e.target.value }))}><option value="">Choose a person</option>{employees.filter(e => e.id !== employeeId).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>Reason<textarea maxLength={500} value={reason[shift.id] ?? ''} onChange={e => setReason(v => ({ ...v, [shift.id]: e.target.value }))} /></label><button disabled={busy || !substitute[shift.id] || !reason[shift.id]?.trim()} onClick={() => void request(shift)}>Send request →</button></details>}</article>)}</div>
      {!schedule && <p>No published schedule for this week yet.</p>}{schedule && orderedShifts.length === 0 && <p>No shifts assigned to you this week.</p>}
    </>}
  </section>
}
