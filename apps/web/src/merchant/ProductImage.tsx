import { useEffect, useRef, useState } from 'react'
import { networkChoice } from '../lib/network'
export type ProductImageApi = { upload(input: { base64: string; idempotencyKey: string }): Promise<{ id: string }>; preview(id: string): Promise<Blob> }
export function PublicProductImage({ imageId, alt }: { imageId: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [imageId])
  return failed ? null : <img className="m-product-photo" src={`${networkChoice().base}/v1/merchant/menu-images/${encodeURIComponent(imageId)}`} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}
export function ProductImagePreview({ imageId, load }: { imageId: string; load(id: string): Promise<Blob> }) {
  const [url, setUrl] = useState<string | null>(null)
  // The loader is supplied inline; id is the lifetime of this preview.
  const loader = useRef(load); loader.current = load
  useEffect(() => {
    let active = true, objectUrl: string | undefined
    setUrl(null)
    void loader.current(imageId).then(blob => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl)
    }).catch(() => { /* Unavailable image must not block menu editing. */ })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [imageId])
  return url ? <img className="m-product-photo" src={url} alt="Product photograph preview" /> : <p className="m-muted">Photograph preview unavailable or loading.</p>
}
export function ProductImageEditor({ imageId, api, onChange }: { imageId?: string; api: ProductImageApi; onChange(id: string | undefined): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const intent = useRef<{ file: File; key: string } | null>(null), active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const upload = async (file: File) => {
    if (busy) return
    if (!file.size || file.size > 10 * 1024 * 1024) { setError('Choose an image up to 10 MB.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)) { setError('Choose a JPEG, PNG, WebP or HEIF photograph.'); return }
    if (intent.current?.file !== file) intent.current = { file, key: crypto.randomUUID() }
    setBusy(true); setError(null)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read photograph.'))
        reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file)
      })
      if (!active.current) return
      const result = await api.upload({ base64, idempotencyKey: intent.current.key })
      if (active.current) { onChange(result.id); intent.current = null }
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Could not upload photograph.') }
    finally { if (active.current) setBusy(false) }
  }
  return <section><h3>Product photograph</h3><p className="m-muted">Preview stays private until the menu is published. JPEG, PNG, WebP or HEIF, up to 10 MB.</p>{imageId && <ProductImagePreview imageId={imageId} load={api.preview} />}<label>Choose product photograph<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file) }} /></label>{error && <p role="alert">{error}</p>}{error && intent.current && <button type="button" disabled={busy} onClick={() => void upload(intent.current!.file)}>Retry photograph upload</button>}{imageId && <button type="button" disabled={busy} onClick={() => onChange(undefined)}>Remove product photograph</button>}{busy && <p role="status">Uploading photograph…</p>}</section>
}
