import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import '@fontsource-variable/mulish'
import './styles.css'
import { locale, t } from './i18n'
import { detectNetwork, watchNetworkFlips } from './lib/network'
import { findRemoteChargeId } from './lib/host'
import { Spinner } from './components/Spinner'

document.documentElement.lang = locale

// Two ways a remote-charge link can land here (see host.ts's comment on
// findRemoteChargeId): a plain path open, which the router already handles,
// or the id arriving somewhere else because the host didn't preserve the
// deeplink's path. This check runs before the router even mounts, so it
// covers both — the path case is a harmless no-op since the condition below
// already matches.
if (typeof window !== 'undefined') {
  const id = findRemoteChargeId(window.location)
  if (id && window.location.pathname !== `/r/${id}`)
    window.history.replaceState(null, '', `/r/${id}`)
}

// A payment must reach the chain the wallet is on, so nothing may call the
// API before the network is resolved. That resolution can take seconds —
// it waits for the wallet's consensus — which is why it happens behind a
// visible screen instead of an empty page.
function Boot() {
  const [ready, setReady] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setError(false)
    const timer = setTimeout(() => setSlow(true), 2500)
    void detectNetwork().then(() => {
      if (!active) return
      watchNetworkFlips()
      clearTimeout(timer)
      setReady(true)
    }).catch(() => {
      if (!active) return
      clearTimeout(timer)
      setError(true)
    })
    return () => { active = false; clearTimeout(timer) }
  }, [attempt])

  if (ready) return <App />

  return (
    <main className="boot-screen">
      <h1 className="brand">NIM<em>ble</em></h1>
      {error ? <div role="alert">
        <p>{t('Your wallet network is unavailable. Check your connection and try again.')}</p>
        <button onClick={() => setAttempt(value => value + 1)}>{t('Try again')}</button>
      </div> : <>
        <Spinner />
        {slow && <p className="quiet">{t('Waiting for your wallet to sync…')}</p>}
      </>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Boot />
    </BrowserRouter>
  </StrictMode>,
)
