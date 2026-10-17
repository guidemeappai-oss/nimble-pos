import { useCallback, useEffect, useRef, useState } from 'react'
import { locale } from '../i18n'
import { uuid } from '../lib/uuid'
import { merchantError } from './errors'
import type { MerchantApi } from './client'

const tr = (en: string, pl: string) => locale === 'pl' ? pl : en
export interface TaskPhoto {
  id: string
  phase: 'BEFORE' | 'AFTER'
  source: 'CAMERA' | 'IMPORT'
  submissionNumber: number
  createdAt: string
  expiresAt: string
}
type Draft = { file: File; source: TaskPhoto['source']; phase: TaskPhoto['phase']; key: string }
export function TaskPhotos({ api, venueId, taskId, submissionNumber, editable, cashier = false, scope }: {
  api: MerchantApi; venueId: string; taskId: string; submissionNumber: number
  editable: boolean; cashier?: boolean; scope: string
}) {
  const authority = cashier ? 'cashier' : 'owner'
  const base = `/venues/${venueId}/tasks/${taskId}/photos`
  const identity = `${scope}:${base}:${submissionNumber}:${editable}`
  const current = useRef(identity)
  current.current = identity
  const mounted = useRef(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [phase, setPhase] = useState<TaskPhoto['phase']>('AFTER')
  const [busy, setBusy] = useState(false)
  const lock = useRef<string | null>(null)
  const [state, setState] = useState<{ scope: string; rows: TaskPhoto[]; urls: Record<string,string>; error: string | null } | null>(null)
  const reads = useRef(0)
  const urls = useRef<string[]>([])
  const clearUrls = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = [] }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearUrls() } }, [])
  const load = useCallback(async () => {
    const started = current.current
    const read = ++reads.current
    try {
      const rows = await api.request<TaskPhoto[]>(authority, 'GET', base)
      const images = await Promise.all(rows.map(async photo => [photo.id, await api.authenticatedPhotoBlob(`${base}/${photo.id}`, cashier)] as const))
      if (!mounted.current || started !== current.current || read !== reads.current) return
      clearUrls()
      const next: Record<string,string> = {}
      for (const [id, blob] of images) { next[id] = URL.createObjectURL(blob); urls.current.push(next[id]) }
      setState({ scope: started, rows, urls: next, error: null })
    } catch (error) {
      if (mounted.current && started === current.current && read === reads.current) {
        clearUrls()
        setState({ scope: started, rows: [], urls: {}, error: merchantError(error) })
      }
    }
  }, [api, authority, base, cashier])
  useEffect(() => { clearUrls(); setState(null); setDraft(null); setBusy(false); void load(); return clearUrls }, [identity, load])
  const visible = state?.scope === identity ? state : null
  const select = (file: File | undefined, source: TaskPhoto['source']) => {
    if (!file || !editable) return
    if (file.size > 10 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)) {
      setState({ scope: identity, rows: visible?.rows ?? [], urls: visible?.urls ?? {}, error: tr('Choose a JPEG, PNG or WebP photo up to 10 MB.', 'Wybierz zdjęcie JPEG, PNG lub WebP do 10 MB.') })
      return
    }
    setDraft({ file, source, phase, key: uuid() })
  }
  const mutate = async (action: () => Promise<unknown>) => {
    const started = identity
    if (lock.current === started) return
    lock.current = started; setBusy(true)
    try {
      await action()
      if (mounted.current && current.current === started) { setDraft(null); await load() }
    } catch (error) {
      if (mounted.current && current.current === started) setState({ scope: started, rows: visible?.rows ?? [], urls: visible?.urls ?? {}, error: merchantError(error) })
    } finally {
      if (lock.current === started) lock.current = null
      if (mounted.current && current.current === started) setBusy(false)
    }
  }
  return <section className="m-panel m-form" aria-label={tr('Task photos', 'Zdjęcia zadania')}>
    <h3>{tr('Photo documentation', 'Dokumentacja zdjęciowa')}</h3>
    <p className="m-muted">{tr('Photograph the result without people or private documents. A photo supports review; it does not prove that a task was completed correctly.', 'Fotografuj rezultat bez osób i prywatnych dokumentów. Zdjęcie pomaga w ocenie, ale samo nie potwierdza prawidłowego wykonania zadania.')}</p>
    {visible?.error && <div><p role="alert">{visible.error}</p><button disabled={busy} onClick={() => void load()}>{tr('Retry loading photos', 'Ponów wczytywanie zdjęć')}</button></div>}
    {!visible && <p role="status">{tr('Loading photos…', 'Wczytywanie zdjęć…')}</p>}
    {visible?.rows.map(photo => <article key={photo.id} className="m-soft">
      <strong>{photo.phase === 'BEFORE' ? tr('Before', 'Przed') : tr('After', 'Po')} · {tr('Submission', 'Zgłoszenie')} {photo.submissionNumber}</strong>
      <p>{photo.source === 'IMPORT' ? tr('Imported photo', 'Zdjęcie zaimportowane') : tr('Camera source declared', 'Zadeklarowane źródło: aparat')}</p>
      <img src={visible.urls[photo.id]} alt={photo.phase === 'BEFORE' ? tr('Task before photo', 'Zdjęcie zadania przed wykonaniem') : tr('Task after photo', 'Zdjęcie zadania po wykonaniu')} style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} />
      <small>{tr('Received', 'Otrzymano')}: {new Date(photo.createdAt).toLocaleString()} · {tr('Deletes on', 'Usunięcie')}: {new Date(photo.expiresAt).toLocaleDateString()}</small>
      {editable && photo.submissionNumber === submissionNumber + 1 && <button disabled={busy} onClick={() => void mutate(() => api.request(authority, 'POST', `${base}/${photo.id}/remove`))}>{tr('Remove photo', 'Usuń zdjęcie')}</button>}
    </article>)}
    {editable && <>
      <label>{tr('Photo stage', 'Etap zdjęcia')}<select value={phase} disabled={busy} onChange={event => setPhase(event.target.value as TaskPhoto['phase'])}><option value="BEFORE">{tr('Before', 'Przed')}</option><option value="AFTER">{tr('After', 'Po')}</option></select></label>
      <label>{tr('Take task photo', 'Zrób zdjęcie zadania')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={event => { select(event.target.files?.[0], 'CAMERA'); event.target.value = '' }} /></label>
      <label>{tr('Import task photo (exception)', 'Importuj zdjęcie zadania (wyjątek)')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { select(event.target.files?.[0], 'IMPORT'); event.target.value = '' }} /></label>
      {draft && <div className="m-soft"><DraftPreview file={draft.file} /><p>{draft.file.name} · {tr('Not uploaded. Leaving this task discards the selected file.', 'Niewysłane. Opuszczenie zadania usuwa wybrany plik.')}</p><button disabled={busy} onClick={() => void mutate(async () => {
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error(tr('Could not read photo.', 'Nie udało się odczytać zdjęcia.'))); reader.readAsDataURL(draft.file) })
        if (current.current !== identity || !mounted.current) return
        return api.request(authority, 'POST', base, { phase: draft.phase, source: draft.source, base64, idempotencyKey: draft.key })
      })}>{busy ? tr('Uploading…', 'Wysyłanie…') : tr('Upload photo', 'Wyślij zdjęcie')}</button><button disabled={busy} onClick={() => setDraft(null)}>{tr('Discard selected photo', 'Odrzuć wybrane zdjęcie')}</button></div>}
      <small>{tr('Up to 4 photos per submission. Nothing is stored for offline upload.', 'Do 4 zdjęć na zgłoszenie. Pliki nie są przechowywane do wysłania offline.')}</small>
    </>}
  </section>
}

function DraftPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value) }, [file])
  return url ? <img src={url} alt={tr('Selected task photo preview', 'Podgląd wybranego zdjęcia zadania')} style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }} /> : null
}
