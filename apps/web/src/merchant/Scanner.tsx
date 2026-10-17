import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export function checkoutPathFromQr(
  text: string,
  origin: string,
): string | null {
  try {
    const local = new URL(origin)
    let url = new URL(text.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.hostname === 'nimpay.app') {
      const prefix = `/miniapps/open/${local.host}/`
      if (!url.pathname.startsWith(prefix)) return null
      url = new URL(url.pathname.slice(prefix.length - 1) + url.search, origin)
    }
    if (url.origin !== local.origin) return null
    const match = url.pathname.match(
      /^\/merchant\/checkout\/([A-Za-z0-9_-]{43})$/,
    )
    if (!match) return null
    const network = url.searchParams.get('n')
    return `/merchant/checkout/${match[1]}${network === 'main' || network === 'test' ? `?n=${network}` : ''}`
  } catch {
    return null
  }
}

interface Detector {
  detect(image: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type DetectorClass = new (options: { formats: string[] }) => Detector

export function MerchantScanner() {
  const navigate = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stop()
    }
  }, [])
  const open = (value: string) => {
    const path = checkoutPathFromQr(value, window.location.origin)
    if (!path) {
      setNotice('This is not a checkout link from this Nimble venue service.')
      return false
    }
    stop()
    navigate(path)
    return true
  }
  const start = async () => {
    setNotice(null)
    const BarcodeDetector = (
      window as unknown as { BarcodeDetector?: DetectorClass }
    ).BarcodeDetector
    if (!BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setNotice(
        'Camera scanning is unavailable here. Paste the checkout link below, or use the Nimiq Pay scanner.',
      )
      return
    }
    setBusy(true)
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] })
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      if (!mounted.current) {
        camera.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = camera
      video.current!.srcObject = camera
      await video.current!.play()
      if (!mounted.current) {
        stop()
        return
      }
      setActive(true)
      let detecting = false
      timer.current = setInterval(async () => {
        if (detecting || !video.current || video.current.readyState < 2) return
        detecting = true
        try {
          for (const code of await detector.detect(video.current)) {
            if (
              mounted.current &&
              stream.current === camera &&
              open(code.rawValue)
            )
              break
          }
        } catch {
          /* try the next camera frame */
        } finally {
          detecting = false
        }
      }, 300)
    } catch {
      stop()
      setActive(false)
      setNotice(
        'The camera could not be opened. Allow camera access, or paste the checkout link below.',
      )
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    open(link)
  }
  return (
    <main className="merchant">
      <header className="m-header">
        <Link className="m-brand" to="/merchant">
          nimble<span>·</span>
        </Link>
        <Link to="/merchant">Back to Counter</Link>
      </header>
      <section className="m-customer">
        <span className="m-label">CUSTOMER CHECKOUT</span>
        <h1>
          Your order.
          <br />
          One scan away.
        </h1>
        <p className="m-muted">
          Scan the QR shown by your cashier to review your order before paying.
        </p>
        <video
          className="m-scanner-video"
          ref={video}
          hidden={!active}
          muted
          playsInline
          aria-label="Checkout QR camera preview"
        />
        {active ? (
          <button
            onClick={() => {
              stop()
              setActive(false)
            }}
          >
            Stop camera
          </button>
        ) : (
          <button
            className="m-primary"
            disabled={busy}
            onClick={() => void start()}
          >
            Scan checkout QR <span>↗</span>
          </button>
        )}
        {notice && (
          <p role="status" className="m-notice">
            {notice}
          </p>
        )}
        <form className="m-form m-panel" onSubmit={submit}>
          <label>
            Or paste your checkout link
            <input
              type="url"
              required
              maxLength={3000}
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://…/merchant/checkout/…"
            />
          </label>
          <button className="m-primary">
            Review order <span>→</span>
          </button>
        </form>
      </section>
    </main>
  )
}
