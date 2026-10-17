import { merchantRewardProduct } from '@nimble/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toCanvas } from 'qrcode'
import { useApp } from '../AppContext'
import { t } from '../i18n'
import { uuid } from '../lib/uuid'
import { MerchantApi } from '../merchant/client'
import type {
  MerchantAsset,
  MerchantOrder,
  MerchantProduct,
  MerchantVenue,
} from '../merchant/contract'
import { DemoCafe } from '../merchant/demo'
import { money } from '../merchant/format'
import { merchantError } from '../merchant/errors'
import { LoyaltyApi, linkLoyaltyEvm } from './api'
import type {
  LoyaltyCard,
  LoyaltyProgram,
  LoyaltyReport,
  LoyaltyReward,
} from './types'
import './loyalty.css'

function useLoyaltyApi(merchant?: MerchantApi) {
  const app = useApp()
  return useMemo(
    () =>
      new LoyaltyApi(
        merchant ??
          new MerchantApi(
            app.api.baseUrl,
            () => app.token,
            () => null,
            () => null,
          ),
      ),
    [merchant, app.api.baseUrl, app.token],
  )
}
function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="m-notice">
      {message}
    </p>
  ) : null
}
function rewardStatus(status: LoyaltyReward['status']) {
  return t(
    {
      RESERVED: 'Show this QR at the counter',
      PREPARING: 'Your reward is being prepared',
      READY: 'Your reward is ready',
      COLLECTED: 'Enjoy your reward',
      CANCELLED: 'Reservation cancelled',
      EXPIRED: 'Reservation expired',
    }[status],
  )
}
export function LoyaltyCardView({
  card,
  busy = false,
  onReserve,
  children,
}: {
  card: LoyaltyCard
  busy?: boolean
  onReserve?: () => void
  children?: React.ReactNode
}) {
  const stamps = Math.min(5, Math.max(0, card.available))
  return (
    <section className="l-card" aria-label={t('Loyalty card')}>
      <div className="m-row">
        <span className="m-label">{t('A LITTLE THANK YOU')}</span>
        <span className="l-mark" aria-hidden="true">
          ✦
        </span>
      </div>
      <h2>{card.program.venueName}</h2>
      <p>{t('Five good moments. One on us.')}</p>
      <div className="l-stamps" aria-label={`${stamps} / 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={i < stamps ? 'l-stamp is-earned' : 'l-stamp'}
            aria-hidden="true"
          >
            {i < stamps ? '✦' : i + 1}
          </span>
        ))}
      </div>
      <div className="m-row">
        <strong>{stamps} / 5</strong>
        <span>
          {card.program.productName} · {card.program.variantName}
        </span>
      </div>
      <p className="l-rules">
        {t('One stamp per paid order from')}{' '}
        {money(card.program.minimumMinor, card.program.fiatCurrency)}.{' '}
        {t('Reward includes one product, without extras.')}
      </p>
      {!card.earningEnabled && (
        <p className="l-rules">
          {t('New stamps are paused. Your earned rewards remain available.')}
        </p>
      )}
      {card.refundHolds > 0 && (
        <p className="l-rules">
          {t('Some stamps are held while a refund is pending.')}
        </p>
      )}
      {card.available < 0 && (
        <p className="l-rules">
          {t('Your next stamps first cover a refunded purchase.')}
        </p>
      )}
      {card.available >= 5 && onReserve && (
        <button className="m-primary" disabled={busy} onClick={onReserve}>
          {t('Reserve my reward')} <span>→</span>
        </button>
      )}
      {children}
    </section>
  )
}
function RewardTicket({
  reward,
  onCancel,
  busy,
}: {
  reward: LoyaltyReward
  onCancel?: () => void
  busy: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (reward.token && reward.status === 'RESERVED' && ref.current)
      void toCanvas(ref.current, reward.token, {
        width: 208,
        margin: 1,
        color: { dark: '#173f32', light: '#ffffff' },
      }).catch(() => {})
  }, [reward.token, reward.status])
  return (
    <div className={`l-ticket l-ticket-${reward.status.toLowerCase()}`}>
      <strong role="status">{rewardStatus(reward.status)}</strong>
      <p>
        {reward.productName} · {reward.variantName}
      </p>
      {reward.number !== null && (
        <p className="l-pickup">#{String(reward.number).padStart(3, '0')}</p>
      )}
      {reward.status === 'RESERVED' && (
        <>
          {reward.token ? (
            <>
              <canvas
                role="img"
                ref={ref}
                aria-label={t('Reward QR code')}
                className="m-qr"
              />
              <details>
                <summary>{t('Show reward code')}</summary>
                <code className="m-tx">{reward.token}</code>
              </details>
            </>
          ) : (
            <p>
              {t(
                'Open the reservation on the phone where you created it to show its QR.',
              )}
            </p>
          )}
          <small>
            {t('Valid until')} {new Date(reward.expiresAt).toLocaleTimeString()}
          </small>
        </>
      )}
      {onCancel &&
        ['RESERVED', 'PREPARING', 'READY'].includes(reward.status) && (
          <button disabled={busy} onClick={onCancel}>
            {t('Cancel reward')}
          </button>
        )}
    </div>
  )
}

export function LoyaltyOwner({
  api: merchant,
  venue,
  products,
  demo,
}: {
  api: MerchantApi
  venue: MerchantVenue
  products: MerchantProduct[]
  demo?: DemoCafe
}) {
  const api = useLoyaltyApi(merchant)
  const [program, setProgram] = useState<LoyaltyProgram | null>(null)
  const [report, setReport] = useState<LoyaltyReport | null>(null)
  const [minimum, setMinimum] = useState('3.00')
  const [selection, setSelection] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const key = useRef(uuid())
  const load = useCallback(async () => {
    const [p, r] = demo
      ? [demo.loyalty.program, demo.loyalty.report()]
      : await Promise.all([api.program(venue.id), api.report(venue.id)])
    setProgram(p)
    setReport(r)
  }, [api, venue.id, demo])
  useEffect(() => {
    void load().catch((e) => setNotice(merchantError(e)))
  }, [load])
  const run = async (action: () => Promise<unknown> | unknown) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await action()
      key.current = uuid()
      await load()
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="l-layout">
      <section className="m-panel">
        <span className="m-label">{t('LOYALTY PROGRAM')}</span>
        <h2>{t('Give them a reason to return.')}</h2>
        <p>
          {t(
            'Five qualifying purchases unlock one product on the house. Existing cards keep their promised terms.',
          )}
        </p>
        {program && (
          <div className="m-soft">
            <strong>
              {program.productName} · {program.variantName}
            </strong>
            <p>
              {t('One stamp per paid order from')}{' '}
              {money(program.minimumMinor, program.fiatCurrency)}
            </p>
            <small>
              {program.active
                ? t('Accepting new cards')
                : t('New stamps paused')}{' '}
              · {t('Version')} {program.version}
            </small>
          </div>
        )}
        <form
          className="m-form"
          onSubmit={(e) => {
            e.preventDefault()
            const [productId, variantId] = JSON.parse(selection) as [
              string,
              string,
            ]
            void run(() =>
              demo
                ? demo.loyalty.configure(
                    Number(minimum) * 100,
                    productId,
                    variantId,
                    demo.products,
                  )
                : api.configure(
                    venue.id,
                    {
                      minimumMinor: Math.round(Number(minimum) * 100),
                      productId,
                      variantId,
                    },
                    key.current,
                  ),
            )
          }}
        >
          <label>
            {t('Minimum qualifying purchase')} ({venue.fiatCurrency})
            <input
              required
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
          </label>
          <label>
            {t('Reward product and size')}
            <select
              required
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
            >
              <option value="">{t('Choose a reward')}</option>
              {products.filter(merchantRewardProduct).flatMap((p) =>
                p.variants.map((v) => (
                  <option
                    key={`${p.id}:${v.id}`}
                    value={JSON.stringify([p.id, v.id])}
                  >
                    {p.name} · {v.name}
                  </option>
                )),
              )}
            </select>
          </label>
          <small>Rewards use standalone products without required choices.</small>
          <small>
            {t(
              'One item, without extras. New terms apply to new cards; current cards keep their reward.',
            )}
          </small>
          <button className="m-primary" disabled={busy}>
            {program
              ? t('Publish new program terms')
              : t('Start loyalty program')}{' '}
            <span>→</span>
          </button>
        </form>
        {program?.active && (
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                demo ? demo.loyalty.disable() : api.disable(venue.id),
              )
            }
          >
            {t('Pause new stamps')}
          </button>
        )}
        <ErrorMessage message={notice} />
      </section>
      <section className="m-panel">
        <span className="m-label">{t('RETURNING CUSTOMERS')}</span>
        <h2>{t('Small gestures. Real returns.')}</h2>
        {report && (
          <div className="m-metrics">
            {[
              [report.cards, 'Customer cards'],
              [report.earned, 'Stamps earned'],
              [report.corrections, 'Refund corrections'],
              [report.collectedRewards, 'Rewards collected'],
              [report.activeRewards, 'Rewards in progress'],
            ].map(([n, label]) => (
              <div key={label}>
                <strong>{n}</strong>
                <small>{t(String(label))}</small>
              </div>
            ))}
          </div>
        )}
        <p className="m-muted">
          {t(
            'Complimentary rewards are counted separately from sales and never earn stamps.',
          )}
        </p>
      </section>
    </div>
  )
}

export function useCheckoutLoyalty({
  merchant,
  order,
  checkoutToken,
  demo,
  disabled,
}: {
  merchant: MerchantApi
  order: MerchantOrder | null
  checkoutToken?: string
  demo?: DemoCafe
  disabled: boolean
}) {
  const app = useApp()
  const api = useLoyaltyApi(merchant)
  const [program, setProgram] = useState<LoyaltyProgram | null>(null)
  const [card, setCard] = useState<LoyaltyCard | null>(null)
  const [participating, setParticipating] = useState(false)
  const [boundRevision, setBoundRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const joinKey = useRef(uuid())
  const currentIdentity = useRef(app.token)
  currentIdentity.current = app.token
  const load = useCallback(async () => {
    if (!order) return
    if (demo) {
      setProgram(demo.loyalty.program)
      setCard(demo.loyalty.joined ? demo.loyalty.card() : null)
      return
    }
    const identity = app.token
    const p = await api.program(order.venueId)
    if (currentIdentity.current !== identity) return
    setProgram(p)
    if (app.token) {
      const [cards, binding] = await Promise.all([
        api.cards(),
        checkoutToken ? api.binding(checkoutToken) : Promise.resolve(null),
      ])
      if (currentIdentity.current !== identity) return
      setCard(
        cards.find((c) => c.id === binding?.cardId) ??
          cards.find(
            (c) =>
              c.program.venueId === order.venueId &&
              (c.balance !== 0 || c.reserved > 0 || c.refundHolds > 0) &&
              (c.program.network === p?.network || !p),
          ) ??
          cards.find(
            (c) =>
              c.program.venueId === order.venueId && c.program.id === p?.id,
          ) ??
          (p ? null : cards.find((c) => c.program.venueId === order.venueId)) ??
          null,
      )
      if (binding?.revision === order.revision) {
        setParticipating(true)
        setBoundRevision(binding.revision)
      } else if (boundRevision !== null && boundRevision !== order.revision) {
        setParticipating(false)
        setBoundRevision(null)
      }
    } else {
      setCard(null)
      setParticipating(false)
      setBoundRevision(null)
    }
  }, [api, order?.venueId, order?.revision, app.token, demo, checkoutToken])
  useEffect(() => {
    void load().catch((e) => setNotice(merchantError(e)))
  }, [load, order?.status])
  const join = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const c = demo
        ? demo.loyalty.join()
        : await api.join(order!.venueId, joinKey.current)
      setCard(c)
      setParticipating(true)
      if (demo) demo.loyalty.attach(order!.id, true)
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      setBusy(false)
    }
  }
  const prepare = async (asset: MerchantAsset, sender: string) => {
    if (!participating || !card || !checkoutToken || !order || demo) return
    if (asset === 'USDT') await linkLoyaltyEvm(api, sender)
    await api.bind(
      checkoutToken,
      card.id,
      order.revision,
      `bind-${card.id}-${order.id}-${order.revision}`,
    )
    setBoundRevision(order.revision)
  }
  const node =
    program || (card && (app.token || demo)) ? (
      <div className="l-checkout">
        {card && (app.token || demo) ? (
          <LoyaltyCardView card={card}>
            <Link to="/merchant/cards">{t('Open my loyalty cards')} →</Link>
          </LoyaltyCardView>
        ) : (
          <div className="m-soft">
            <strong>{t('Five good moments. One on us.')}</strong>
            <p>
              {t('Join this venue’s loyalty card before paying.')}{' '}
              {t('One stamp per paid order from')}{' '}
              {money(program!.minimumMinor, program!.fiatCurrency)}.{' '}
              {t('Your reward')}: {program!.productName} ·{' '}
              {program!.variantName}.
            </p>
          </div>
        )}
        {!disabled && (
          <>
            {app.token || demo ? (
              card ? (
                <label className="l-opt-in">
                  <input
                    type="checkbox"
                    disabled={boundRevision === order?.revision}
                    checked={participating}
                    onChange={(e) => {
                      setParticipating(e.target.checked)
                      if (demo) demo.loyalty.attach(order!.id, e.target.checked)
                    }}
                  />
                  {t('Collect a stamp for this purchase')}
                </label>
              ) : (
                <button disabled={busy} onClick={() => void join()}>
                  {t('Join loyalty card')}
                </button>
              )
            ) : (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void app
                    .login()
                    .catch((e) => setNotice(merchantError(e)))
                    .finally(() => setBusy(false))
                }}
              >
                {t('Connect wallet for loyalty')}
              </button>
            )}
            <small>
              {t(
                'Optional. You can always pay without joining. For USDT, your wallet will ask you to verify your Polygon address.',
              )}
            </small>
          </>
        )}
        <ErrorMessage message={notice} />
      </div>
    ) : null
  return { node, prepare, refresh: load, participating }
}

export function LoyaltyCards() {
  const app = useApp()
  const api = useLoyaltyApi()
  const scope = useMemo(() => ({ api, token: app.token }), [api, app.token])
  const latestScope = useRef(scope)
  latestScope.current = scope
  const generation = useRef(0)
  const [cardState, setCardState] = useState<{
    scope: typeof scope
    cards: LoyaltyCard[]
  }>({ scope, cards: [] })
  const cards = cardState.scope === scope ? cardState.cards : []
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reserveKeys = useRef(new Map<string, string>())
  const storagePrefix = `nimble:loyalty:${app.api.baseUrl}:${app.address}:`
  const tokens = useRef(new Map<string, string>())
  const load = useCallback(async () => {
    if (app.token) {
      const request = ++generation.current
      const next = await api.cards()
      if (request === generation.current && latestScope.current === scope)
        setCardState({ scope, cards: next })
    }
  }, [api, app.token, scope])
  useEffect(() => {
    reserveKeys.current.clear()
    tokens.current.clear()
    setNotice(null)
    if (!app.token) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        await load()
      } catch (e) {
        if (active) setNotice(merchantError(e))
      }
      if (active) timer = setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => {
      active = false
      ++generation.current
      clearTimeout(timer)
    }
  }, [load, app.token])
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    ++generation.current
    setBusy(true)
    setNotice(null)
    try {
      await action()
      await load()
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="merchant">
      <header className="m-header">
        <Link to="/" className="m-brand">
          nimble<span>·</span>
        </Link>
        <Link to="/merchant">{t('Back')}</Link>
      </header>
      <div className="m-heading">
        <span className="m-label">{t('YOUR LOYALTY CARDS')}</span>
        <h1>{t('Good to see you again.')}</h1>
        <p>{t('Your favourite places. A little closer to your next treat.')}</p>
      </div>
      <ErrorMessage message={notice} />
      {!app.token ? (
        <button
          className="m-primary"
          disabled={busy}
          onClick={() => void run(() => app.login())}
        >
          {t('Connect wallet')}
        </button>
      ) : !cards.length ? (
        <section className="m-panel">
          <h2>{t('Your first stamp starts at the counter.')}</h2>
          <p>
            {t('Join a venue’s card when reviewing your order, before paying.')}
          </p>
          <Link to="/merchant/scan">{t('Scan checkout QR')} →</Link>
        </section>
      ) : (
        <div className="l-card-grid">
          {cards.map((card) => (
            <div key={card.id}>
              <LoyaltyCardView
                card={card}
                busy={busy}
                onReserve={() =>
                  void run(async () => {
                    let key =
                      reserveKeys.current.get(card.id) ??
                      localStorage.getItem(
                        `${storagePrefix}reserve:${card.id}`,
                      ) ??
                      undefined
                    if (!key) {
                      key = uuid()
                      reserveKeys.current.set(card.id, key)
                      localStorage.setItem(
                        `${storagePrefix}reserve:${card.id}`,
                        key,
                      )
                    }
                    const r = await api.reserve(card.id, key)
                    reserveKeys.current.delete(card.id)
                    localStorage.removeItem(
                      `${storagePrefix}reserve:${card.id}`,
                    )
                    if (r.token) {
                      tokens.current.set(r.id, r.token)
                      localStorage.setItem(
                        `${storagePrefix}token:${r.id}`,
                        r.token,
                      )
                    }
                  })
                }
              />
              {card.rewards
                .filter((r) => !['CANCELLED', 'EXPIRED'].includes(r.status))
                .map((r) => (
                  <RewardTicket
                    key={r.id}
                    reward={{
                      ...r,
                      token:
                        r.token ??
                        tokens.current.get(r.id) ??
                        localStorage.getItem(`${storagePrefix}token:${r.id}`) ??
                        undefined,
                    }}
                    busy={busy}
                    onCancel={
                      r.status === 'RESERVED'
                        ? () => void run(() => api.cancel(r.id))
                        : undefined
                    }
                  />
                ))}
              <details className="l-history">
                <summary>{t('Card activity')}</summary>
                {card.entries.length ? (
                  card.entries.map((e) => (
                    <div key={e.id} className="m-line">
                      <span>
                        {t(
                          {
                            EARN: 'Purchase stamp',
                            REFUND: 'Refund correction',
                            REDEEM: 'Reward used',
                            RESTORE: 'Reward restored',
                          }[e.kind],
                        )}
                        <small>{new Date(e.createdAt).toLocaleString()}</small>
                      </span>
                      <strong>
                        {e.delta > 0 ? '+' : ''}
                        {e.delta}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p>{t('Your next qualifying purchase will appear here.')}</p>
                )}
              </details>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

export function LoyaltyQueue({
  api: merchant,
  venueId,
  demo,
  refreshDemo = () => {},
}: {
  api: MerchantApi
  venueId: string
  demo?: DemoCafe
  refreshDemo?: () => void
}) {
  const api = useLoyaltyApi(merchant)
  const scope = useMemo(() => ({ api, venueId, demo }), [api, venueId, demo])
  const latestScope = useRef(scope)
  latestScope.current = scope
  const generation = useRef(0)
  const [rewardState, setRewardState] = useState<{
    scope: typeof scope
    rewards: LoyaltyReward[]
  }>({ scope, rewards: [] })
  const rewards = rewardState.scope === scope ? rewardState.rewards : []
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const key = useRef(uuid())
  useEffect(() => {
    setToken('')
    setNotice(null)
    key.current = uuid()
  }, [scope])
  const load = useCallback(async () => {
    const request = ++generation.current
    const next = demo ? demo.loyalty.card().rewards : await api.rewards(venueId)
    if (request === generation.current && latestScope.current === scope)
      setRewardState({ scope, rewards: next })
  }, [api, venueId, demo, scope])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        await load()
      } catch (e) {
        if (active) setNotice(merchantError(e))
      }
      if (active && !demo) timer = setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => {
      active = false
      ++generation.current
      clearTimeout(timer)
    }
  }, [load])
  const run = async (action: () => Promise<unknown> | unknown) => {
    if (busy) return
    ++generation.current
    setBusy(true)
    setNotice(null)
    try {
      await action()
      key.current = uuid()
      await load()
      refreshDemo()
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="l-queue">
      <form
        className="m-panel m-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() =>
            demo
              ? demo.loyalty.accept(token, demo.products)
              : api.accept(venueId, token, key.current),
          )
        }}
      >
        <span className="m-label">{t('LOYALTY REWARDS')}</span>
        <h2>{t('A treat, ready for the counter.')}</h2>
        <RewardScanner onScan={setToken} />
        <label>
          {t('Reward code')}
          <input
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="m-primary" disabled={busy}>
          {t('Verify and prepare reward')} →
        </button>
        <small>
          {t(
            'Only a live server confirmation accepts a reward. A screenshot alone is not a redeemed reward.',
          )}
        </small>
      </form>
      <ErrorMessage message={notice} />
      {rewards
        .filter((r) => ['PREPARING', 'READY'].includes(r.status))
        .map((r) => (
          <section className="m-panel m-order" key={r.id}>
            <div className="m-row">
              <strong className="m-order-number">
                #{String(r.number).padStart(3, '0')}
              </strong>
              <span className="m-status">{t('Complimentary reward')}</span>
            </div>
            <h3>{r.productName}</h3>
            <p>
              {r.variantName} · {t('Without extras')}
            </p>
            <strong>{rewardStatus(r.status)}</strong>
            <div className="m-actions">
              <button
                className="m-primary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    demo
                      ? demo.loyalty.status(
                          r.id,
                          r.status === 'PREPARING' ? 'READY' : 'COLLECTED',
                        )
                      : api.status(
                          r.id,
                          r.status === 'PREPARING' ? 'READY' : 'COLLECTED',
                        ),
                  )
                }
              >
                {r.status === 'PREPARING'
                  ? t('Ready for pickup')
                  : t('Mark collected')}{' '}
                →
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    demo ? demo.loyalty.cancel(r.id) : api.cancel(r.id, true),
                  )
                }
              >
                {t('Cancel reward')}
              </button>
            </div>
          </section>
        ))}
    </section>
  )
}

function RewardScanner({ onScan }: { onScan: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stopRef = useRef<() => void>(() => {})
  const mounted = useRef(true)
  const starting = useRef(false)
  const [cameraPending, setCameraPending] = useState(false)
  const [active, setActive] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopRef.current()
    }
  }, [])
  const start = async () => {
    if (starting.current || active) return
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => {
          detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>
        }
      }
    ).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setNotice(t('Camera unavailable. Paste the reward code below.'))
      return
    }
    try {
      starting.current = true
      setCameraPending(true)
      setNotice(null)
      const detector = new Detector({ formats: ['qr_code'] })
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      let timer: ReturnType<typeof setInterval> | null = null
      stopRef.current = () => {
        if (timer) clearInterval(timer)
        stream.getTracks().forEach((t) => t.stop())
      }
      video.current!.srcObject = stream
      await video.current!.play()
      if (!mounted.current) {
        stopRef.current()
        return
      }
      setActive(true)
      let scanning = false
      timer = setInterval(async () => {
        if (scanning || !video.current || video.current.readyState < 2) return
        scanning = true
        try {
          const codes = await detector.detect(video.current)
          if (codes[0] && mounted.current) {
            onScan(codes[0].rawValue)
            stopRef.current()
            setActive(false)
          }
        } catch {
        } finally {
          scanning = false
        }
      }, 350)
    } catch {
      stopRef.current()
      if (mounted.current)
        setNotice(t('Camera unavailable. Paste the reward code below.'))
    } finally {
      starting.current = false
      if (mounted.current) setCameraPending(false)
    }
  }
  return (
    <div>
      <video
        className="m-scanner-video"
        ref={video}
        muted
        playsInline
        hidden={!active}
        aria-label={t('Reward QR camera preview')}
      />
      <button
        type="button"
        disabled={cameraPending}
        onClick={() => {
          if (active) {
            stopRef.current()
            setActive(false)
          } else void start()
        }}
      >
        {active ? t('Stop camera') : t('Scan reward QR')}
      </button>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}

export function LoyaltyDemo() {
  const [cafe, setCafe] = useState(() => new DemoCafe())
  const [, render] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [asset, setAsset] = useState<MerchantAsset>('NIM')
  const refresh = () => render((n) => n + 1)
  const run = (action: () => unknown) => {
    setNotice(null)
    try {
      action()
      refresh()
    } catch (e) {
      setNotice(merchantError(e))
    }
  }
  const card = cafe.loyalty.card()
  const reward = card.rewards.find((r) =>
    ['RESERVED', 'PREPARING', 'READY'].includes(r.status),
  )
  return (
    <main className="merchant">
      <header className="m-header">
        <Link className="m-brand" to="/merchant/demo">
          nimble<span>·</span>
        </Link>
        <span className="m-demo">DEMO · no real funds</span>
      </header>
      <div className="m-heading">
        <span className="m-label">{t('A REASON TO RETURN')}</span>
        <h1>{t('Five good moments. One on us.')}</h1>
        <p>
          {t(
            'Try five purchases, then follow your reward from the counter to collection. Everything here is simulated.',
          )}
        </p>
      </div>
      <ErrorMessage message={notice} />
      <div className="l-layout">
        <div>
          <LoyaltyCardView
            card={card}
            onReserve={
              cafe.loyalty.joined
                ? () => run(() => cafe.loyalty.reserve())
                : undefined
            }
          />
          {reward && (
            <RewardTicket
              reward={reward}
              busy={false}
              onCancel={() => run(() => cafe.loyalty.cancel(reward.id))}
            />
          )}
        </div>
        <section className="m-panel">
          <span className="m-label">{t('YOUR LOYALTY JOURNEY')}</span>
          <h2>
            {!cafe.loyalty.joined
              ? t('Start with a little hello.')
              : reward
                ? rewardStatus(reward.status)
                : t('Your next favourite moment.')}
          </h2>
          <p>
            {t(
              'One qualifying purchase earns one stamp, in NIM or USDT. Your fifth stamp unlocks a Classic Flat white, without extras.',
            )}
          </p>
          {!cafe.loyalty.joined ? (
            <button
              className="m-primary"
              onClick={() => run(() => cafe.loyalty.join())}
            >
              {t('Join loyalty card')} →
            </button>
          ) : (
            <>
              {!reward && (
                <>
                  <div className="m-asset-choice">
                    {(['NIM', 'USDT'] as const).map((a) => (
                      <button
                        key={a}
                        aria-pressed={asset === a}
                        onClick={() => setAsset(a)}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                  <button
                    className="m-primary"
                    onClick={() =>
                      run(() => {
                        if (!cafe.cashier) {
                          cafe.signIn('anna', '1234')
                          cafe.openShift()
                        }
                        const o = cafe.createOrder([
                          {
                            productId: 'flat',
                            variantId: 'classic',
                            extraIds: [],
                            quantity: 1,
                          },
                        ])
                        cafe.loyalty.attach(o.id, true)
                        cafe.simulatePayment(o.id, asset)
                      })
                    }
                  >
                    {t('Simulate a paid purchase')} →
                  </button>
                </>
              )}
              {reward?.status === 'RESERVED' && (
                <button
                  className="m-primary"
                  onClick={() =>
                    run(() => cafe.loyalty.accept(reward.token!, cafe.products))
                  }
                >
                  {t('Cashier: scan and accept reward')} →
                </button>
              )}
              {reward?.status === 'PREPARING' && (
                <button
                  className="m-primary"
                  onClick={() =>
                    run(() => cafe.loyalty.status(reward.id, 'READY'))
                  }
                >
                  {t('Cashier: ready for pickup')} →
                </button>
              )}
              {reward?.status === 'READY' && (
                <button
                  className="m-primary"
                  onClick={() =>
                    run(() => cafe.loyalty.status(reward.id, 'COLLECTED'))
                  }
                >
                  {t('Cashier: hand over reward')} ✓
                </button>
              )}
              {card.rewards.some((r) => r.status === 'COLLECTED') && (
                <p role="status">
                  {t(
                    'Reward collected. Your next card starts with your next purchase.',
                  )}
                </p>
              )}
              <div className="l-demo-actions">
                <button
                  onClick={() =>
                    run(() => {
                      const order = cafe.orders.find(
                        (o) => o.payment && o.status !== 'REFUNDED',
                      )
                      if (!order) throw new Error('Make a purchase first.')
                      cafe.requestRefund(order.id)
                      cafe.approveRefund(order.id, 'owner')
                    })
                  }
                >
                  {t('Simulate a full refund')}
                </button>
                <button
                  onClick={() => {
                    setCafe(new DemoCafe())
                    setNotice(null)
                  }}
                >
                  {t('Restart demo')}
                </button>
              </div>
            </>
          )}
          <p className="m-muted">
            {t(
              'No real funds, wallet approvals, or blockchain transactions. The live program uses server-verified payments.',
            )}
          </p>
          <div className="m-metrics">
            <div>
              <strong>{cafe.loyalty.report().earned}</strong>
              <small>{t('Stamps earned')}</small>
            </div>
            <div>
              <strong>{cafe.loyalty.report().collectedRewards}</strong>
              <small>{t('Rewards collected')}</small>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
