import { PublicProductImage } from '../merchant/ProductImage'
import { ProductInformation } from '../merchant/ProductInformation'
import {OrderReadiness} from '../merchant/OrderReadiness'
import {OrderContextPanel,useOrderContextQueue} from '../merchant/OrderContext'
import { StockReservationStatus } from '../merchant/StockReservationStatus'
import { priceMerchantCart } from '@nimble/shared'
import { ProductChoices, validProductChoices, OrderComposition } from '../merchant/ProductChoices'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toCanvas } from 'qrcode'
import { useApp } from '../AppContext'
import { MerchantApi } from '../merchant/client'
import type {
  MerchantCartLine,
  MerchantProduct,
  MerchantVenue,
} from '../merchant/contract'
import { money, orderStatus } from '../merchant/format'
import { merchantError } from '../merchant/errors'
import { uuid } from '../lib/uuid'
import { locale } from '../i18n'
import {
  RemoteApi,
  type RemoteOrder,
  type RemoteSettings,
  type RemoteVenue,
} from './api'
import './remote.css'
// New copy is bilingual; other host languages use the English source.
const tr = (en: string, pl: string) => (locale === 'pl' ? pl : en)
function useRemoteApi() {
  const app = useApp()
  const merchant = useMemo(
    () =>
      new MerchantApi(
        app.api.baseUrl,
        () => app.token,
        () => {
          try {
            return (
              JSON.parse(
                sessionStorage.getItem(
                  `nimble:merchant:${app.api.baseUrl}:cashier`,
                ) ?? 'null',
              )?.token ?? null
            )
          } catch {
            return null
          }
        },
        () =>
          localStorage.getItem(`nimble:merchant:${app.api.baseUrl}:terminal`),
      ),
    [app.api.baseUrl, app.token],
  )
  return {
    app,
    merchant,
    api: useMemo(() => new RemoteApi(merchant), [merchant]),
  }
}
function Frame({
  children,
  demo = false,
}: {
  children: ReactNode
  demo?: boolean
}) {
  return (
    <main className="merchant remote">
      <header className="m-header">
        <Link className="m-brand" to="/venues">
          nimble<span>·</span>
        </Link>
        <nav className="r-nav">
          {demo && (
            <span className="m-demo">
              DEMO · {tr('no real funds', 'bez prawdziwych środków')}
            </span>
          )}
          <Link to="/venues">{tr('Venues', 'Lokale')}</Link>
          <Link to="/orders">{tr('My orders', 'Moje zamówienia')}</Link>
          <Link to="/merchant/cards">
            {tr('Loyalty cards', 'Karty lojalnościowe')}
          </Link>
        </nav>
      </header>
      {children}
      <footer className="m-footer">
        <span>
          {tr(
            'A little ahead. A little more time for you.',
            'Zamów wcześniej. Miej więcej czasu dla siebie.',
          )}
        </span>
        <Link to="/merchant/terminal">{tr('For venues', 'Dla lokali')} ↗</Link>
      </footer>
    </main>
  )
}
function ErrorNotice({ error }: { error: string | null }) {
  return error ? (
    <p className="m-notice" role="alert">
      {error}
    </p>
  ) : null
}
function useSerialPoll(
  load: () => Promise<void>,
  enabled = true,
  interval = 3000,
) {
  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      await load()
      if (active) timer = setTimeout(() => void poll(), interval)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [load, enabled, interval])
}
export function RemoteVenues() {
  const { api } = useRemoteApi()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{
    venues: RemoteVenue[]
    hasMore: boolean
  }>({ venues: [], hasMore: false })
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const timer = setTimeout(
      () =>
        void api
          .venues(query, page)
          .then((data) => {
            if (active) setResult(data)
          })
          .catch((e) => {
            if (active) setError(merchantError(e))
          })
          .finally(() => {
            if (active) setLoading(false)
          }),
      250,
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [api, query, page])
  return (
    <Frame>
      <section className="r-hero">
        <span className="m-label">
          {tr(
            'ORDER AHEAD · PICK UP HAPPY',
            'ZAMÓW WCZEŚNIEJ · ODBIERZ Z UŚMIECHEM',
          )}
        </span>
        <h1>{tr('Your next good moment.', 'Twój następny miły moment.')}</h1>
        <p>
          {tr(
            'Find your place. Pick your favourites. We’ll save you the queue.',
            'Znajdź swój lokal. Wybierz ulubione smaki. Odbierz bez zamawiania przy ladzie.',
          )}
        </p>
        <label className="r-search">
          {tr('Search venues', 'Szukaj lokalu')}
          <input
            type="search"
            value={query}
            placeholder={tr('Name or city…', 'Nazwa lub miasto…')}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <Link to="/remote/demo">
          {tr('Try the full demo', 'Wypróbuj pełne demo')} ↗
        </Link>
      </section>
      <ErrorNotice error={error} />
      {loading ? (
        <p role="status">
          {tr(
            'Finding your next stop…',
            'Szukamy Twojego następnego przystanku…',
          )}
        </p>
      ) : (
        <>
          <div className="r-venues">
            {result.venues.map((venue) => (
              <Link
                className="r-venue m-panel"
                key={venue.id}
                to={`/venues/${venue.id}`}
              >
                <VenueCard venue={venue} />
              </Link>
            ))}
          </div>
          {!result.venues.length && !error && (
            <section className="m-panel">
              <h2>{tr('A quiet neighbourhood.', 'Jeszcze tu spokojnie.')}</h2>
              <p>
                {tr(
                  'No venues match your search. Try another name or city.',
                  'Nie znaleźliśmy lokali. Spróbuj innej nazwy lub miasta.',
                )}
              </p>
            </section>
          )}
          <div className="m-actions">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              {tr('Previous', 'Poprzednia')}
            </button>
            <span>{page}</span>
            <button
              disabled={!result.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              {tr('Next', 'Następna')}
            </button>
          </div>
        </>
      )}
    </Frame>
  )
}
function VenueCard({ venue }: { venue: RemoteVenue }) {
  return (
    <>
      <div className="r-venue-art" aria-hidden="true">
        {venue.name.slice(0, 1)}
        <span>↗</span>
      </div>
      <div className="m-row">
        <h2>{venue.name}</h2>
        <span className={`r-pill ${venue.available ? 'r-open' : ''}`}>
          {venue.available
            ? tr('Taking orders', 'Przyjmuje zamówienia')
            : tr('Orders paused', 'Zamówienia wstrzymane')}
        </span>
      </div>
      <p>{venue.description}</p>
      <p className="m-muted">
        {venue.address} · {venue.city}
      </p>
      <small>
        {tr('Pickup', 'Odbiór')} · ~{venue.preparationMinutes} min
      </small>
    </>
  )
}
export function RemoteMenu() {
  const { venueId = '' } = useParams()
  const { api, app } = useRemoteApi()
  const navigate = useNavigate()
  const [data, setData] = useState<{
    venue: RemoteVenue
    products: MerchantProduct[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cart, setCart] = useState<MerchantCartLine[]>([])
  const key = useRef(uuid())
  const identity = useRef({ token: app.token, base: app.api.baseUrl, venueId })
  identity.current = { token: app.token, base: app.api.baseUrl, venueId }
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    setData(null)

    api
      .menu(venueId)
      .then((v) => {
        if (active) setData(v)
      })
      .catch((e) => {
        if (active) setError(merchantError(e))
      })
    return () => {
      active = false
    }
  }, [api, venueId])
  useEffect(() => {
    setCart([])
    key.current = uuid()
  }, [venueId])
  const locked = useRef(false)
  const create = async () => {
    if (locked.current || !data) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const startingToken = app.token
      const token = startingToken ?? (await app.login()).token
      const sameContext = () =>
        mounted.current &&
        identity.current.base === app.api.baseUrl &&
        identity.current.venueId === venueId &&
        (identity.current.token === startingToken ||
          identity.current.token === token)
      if (!sameContext()) return
      const authenticated = new RemoteApi(
        new MerchantApi(
          app.api.baseUrl,
          () => token,
          () => null,
          () => null,
        ),
      )
      const order = await authenticated.create(venueId, cart, key.current)
      if (sameContext()) navigate(`/orders/${order.id}`)
    } catch (e) {
      setError(merchantError(e))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <Frame>
      <ErrorNotice error={error} />
      {data ? (
        <>
          <section className="r-menu-header">
            <Link to="/venues">← {tr('All venues', 'Wszystkie lokale')}</Link>
            <span className="m-label">{data.venue.city}</span>
            <h1>{data.venue.name}</h1>
            <p>{data.venue.description}</p>
            <p className="m-muted">
              {data.venue.address} · {tr('Pickup in about', 'Odbiór za około')}{' '}
              {data.venue.preparationMinutes} min
            </p>
            {data.venue.pickupInstructions && (
              <p>{data.venue.pickupInstructions}</p>
            )}
            {!data.venue.available && (
              <p className="m-notice">
                {tr(
                  'This venue is not taking new orders right now. You can still browse the menu.',
                  'Lokal nie przyjmuje teraz nowych zamówień. Możesz przeglądać menu.',
                )}
              </p>
            )}
          </section>
          <MenuBasket
            products={data.products}
            venue={data.venue}
            cart={cart}
            onCart={(lines) => {
              setCart(lines)
              key.current = uuid()
            }}
            disabled={busy || !data.venue.available}
            onSubmit={() => void create()}
            submitLabel={
              app.token
                ? tr('Place order', 'Złóż zamówienie')
                : tr('Connect wallet to order', 'Połącz portfel, aby zamówić')
            }
            busy={busy}
          />
        </>
      ) : (
        !error && (
          <p role="status">{tr('Loading menu…', 'Wczytywanie menu…')}</p>
        )
      )}
    </Frame>
  )
}
export function MenuBasket({
  products,
  venue,
  cart,
  onCart,
  onSubmit,
  disabled = false,
  busy = false,
  submitLabel,
}: {
  products: MerchantProduct[]
  venue: Pick<RemoteVenue, 'fiatCurrency'>
  cart: MerchantCartLine[]
  onCart: (lines: MerchantCartLine[]) => void
  onSubmit: () => void
  disabled?: boolean
  busy?: boolean
  submitLabel: string
}) {
  const [selected, setSelected] = useState<MerchantProduct | null>(null)
  const [variant, setVariant] = useState('')
  const [extras, setExtras] = useState<string[]>([])
  const [quantity, setQuantity] = useState(1)
  const total = cart.reduce((sum, line) => {
    const p = products.find((p) => p.id === line.productId)
    return (
      sum +
      ((p?.variants.find((v) => v.id === line.variantId)?.priceMinor ?? 0) +
        (p?.extras
          .filter((e) => line.extraIds.includes(e.id))
          .reduce((n, e) => n + e.priceMinor, 0) ?? 0)) *
        line.quantity
    )
  }, 0)
  return (
    <div className="r-menu-layout">
      <section>
        <h2>
          {tr('A little of what you love.', 'To, co lubisz najbardziej.')}
        </h2>
        <div className="r-products">
          {products.map((p) => (
            <button
              className="r-product m-panel"
              disabled={disabled || !p.available}
              key={p.id}
              onClick={() => {
                setSelected(p)
                setVariant(p.variants[0]?.id ?? '')
                setExtras([])
                setQuantity(1)
              }}
            >
              <span className="m-label">{p.category}</span>
              {p.imageId && <PublicProductImage imageId={p.imageId} alt={p.name} />}<strong>{p.name}</strong><ProductInformation product={p} products={products}/>
              <span>
                {tr('From', 'Od')}{' '}
                {money(
                  (p.variants.length ? Math.min(...p.variants.map((v) => v.priceMinor)) : 0),
                  venue.fiatCurrency,
                )}
              </span>
              <small>
                {p.available ? '+' : tr('Unavailable', 'Niedostępny')}
              </small>
            </button>
          ))}
        </div>
        {selected && (
          <form
            className="m-panel m-form r-options"
            onSubmit={(e) => {
              e.preventDefault()
              if (!validProductChoices(selected,extras,products,variant)) return
              onCart([
                ...cart,
                {
                  productId: selected.id,
                  variantId: variant,
                  extraIds: extras,
                  quantity,
                },
              ])
              setSelected(null)
            }}
          >
            <div className="m-row">
              <h3>{selected.name}</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={tr('Close options', 'Zamknij opcje')}
              >
                ×
              </button>
            </div>
            <label>
              {tr('Variant', 'Wariant')}
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
              >
                {selected.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {money(v.priceMinor, venue.fiatCurrency)}
                  </option>
                ))}
              </select>
            </label>
            <ProductChoices variantId={variant} products={products} product={selected} selected={extras} onChange={setExtras} currency={venue.fiatCurrency} disabled={disabled}/>
            <label>
              {tr('Quantity', 'Liczba')}
              <input
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <button
              className="m-primary"
              disabled={disabled || !variant || quantity < 1 || quantity > 100 || !validProductChoices(selected,extras,products,variant)}
            >
              {tr('Add to basket', 'Dodaj do koszyka')} <span>{money(((selected.variants.find(v=>v.id===variant)?.priceMinor ?? 0)+selected.extras.filter(e=>extras.includes(e.id)).reduce((n,e)=>n+e.priceMinor,0))*quantity,venue.fiatCurrency)} +</span>
            </button>
          </form>
        )}
      </section>
      <aside className="m-panel r-basket">
        <span className="m-label">
          {tr('YOUR LITTLE MOMENT', 'TWÓJ MAŁY MOMENT')}
        </span>
        <h2>{tr('Your basket', 'Twój koszyk')}</h2>
        {cart.map((line, index) => {
          const p = products.find((p) => p.id === line.productId)
          return (
            <div className="r-cart-line" key={index}>
              <div>
                <strong>
                  {line.quantity} × {p?.name}
                </strong>
                <small>
                  {p?.variants.find((v) => v.id === line.variantId)?.name}
                  {p?.extras
                    .filter((e) => line.extraIds.includes(e.id))
                    .map((e) => ` · ${e.name}`)
                    .join('')}
                </small>
              </div>
              <button
                aria-label={`${tr('Remove', 'Usuń')} ${p?.name}`}
                disabled={busy}
                onClick={() => onCart(cart.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          )
        })}
        {!cart.length && (
          <p className="m-muted">
            {tr('Something good starts here.', 'Tu zaczyna się coś dobrego.')}
          </p>
        )}
        <div className="r-cart-total">
          <span>{tr('Total', 'Razem')}</span>
          <strong>{money(total, venue.fiatCurrency)}</strong>
        </div>
        <p className="r-fine">
          {tr(
            'Choose NIM or USDT at checkout. The exact crypto amount is quoted before you pay.',
            'Przy płatności wybierzesz NIM lub USDT. Dokładną kwotę poznasz przed zapłatą.',
          )}
        </p>
        <p className="r-warning">
          {tr(
            'Payment comes before venue acceptance. If declined or unanswered, your refund needs owner approval.',
            'Płacisz przed decyzją lokalu. W razie odmowy lub braku odpowiedzi zwrot wymaga zatwierdzenia właściciela.',
          )}
        </p>
        <button
          className="m-primary"
          disabled={disabled || !cart.length}
          onClick={onSubmit}
        >
          {submitLabel}
          <span>→</span>
        </button>
      </aside>
    </div>
  )
}
export function RemoteOrders() {
  const { api, app } = useRemoteApi()
  const [orders, setOrders] = useState<RemoteOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const scope = useRef(0)
  useEffect(() => {
    scope.current++
    setOrders([])
    setError(null)
    return () => {
      scope.current++
    }
  }, [api])
  const load = useCallback(async () => {
    const current = scope.current
    try {
      const next = await api.orders()
      if (current === scope.current) {
        setOrders(next)
        setError(null)
      }
    } catch (e) {
      if (current === scope.current) setError(merchantError(e))
    }
  }, [api])
  useSerialPoll(load, Boolean(app.token))
  return (
    <Frame>
      <section className="r-hero">
        <span className="m-label">{tr('YOUR ORDERS', 'TWOJE ZAMÓWIENIA')}</span>
        <h1>
          {tr('Good things, on their way.', 'Dobre rzeczy są już w drodze.')}
        </h1>
        <p>
          {tr(
            'Your orders stay here when you come back. Use the same wallet account.',
            'Po powrocie znajdziesz tutaj swoje zamówienia. Użyj tego samego konta portfela.',
          )}
        </p>
      </section>
      <ErrorNotice error={error} />
      {!app.token ? (
        <button
          className="m-primary"
          onClick={() =>
            void app.login().catch((e) => setError(merchantError(e)))
          }
        >
          {tr('Connect wallet', 'Połącz portfel')} →
        </button>
      ) : orders.length ? (
        <div className="r-venues">
          {orders.map((order) => (
            <Link
              className="m-panel r-venue"
              key={order.id}
              to={`/orders/${order.id}`}
            >
              <span className="m-label">
                #{String(order.number).padStart(3, '0')}
              </span>
              <h2>{order.lines.map((l) => l.productName).join(', ')}</h2>
              <span className="r-pill">{statusText(order.status, order.refund)}</span>
              <p>{money(order.totalMinor, order.fiatCurrency)}</p>
              <small>{new Date(order.createdAt).toLocaleString()}</small>
            </Link>
          ))}
        </div>
      ) : (
        !error && (
          <section className="m-panel">
            <h2>
              {tr(
                'Your first good moment awaits.',
                'Twój pierwszy miły moment czeka.',
              )}
            </h2>
            <Link to="/venues">{tr('Find a venue', 'Wybierz lokal')} →</Link>
          </section>
        )
      )}
    </Frame>
  )
}
function statusText(status: string, refund?: RemoteOrder['refund']) {
  if (status === 'REFUND_PENDING' && refund?.status === 'APPROVED')
    return tr('Refund authorized', 'Zwrot zatwierdzony')
  return (
    (
      {
        AWAITING_PAYMENT: tr('Awaiting payment', 'Oczekuje na płatność'),
        PAYMENT_PENDING: tr('Verifying payment', 'Weryfikujemy płatność'),
        AWAITING_ACCEPTANCE: tr(
          'Waiting for the venue',
          'Oczekuje na decyzję lokalu',
        ),
        PREPARING: tr('Preparing', 'W przygotowaniu'),
        READY: tr('Ready for pickup', 'Gotowe do odbioru'),
        COLLECTED: tr('Collected', 'Odebrane'),
        REFUND_PENDING: tr(
          'Refund awaiting owner',
          'Zwrot oczekuje na właściciela',
        ),
        REFUNDED: tr('Refunded', 'Zwrócono środki'),
        CANCELLED: tr('Cancelled', 'Anulowane'),
      } as Record<string, string>
    )[status] ?? status
  )
}
export function RemoteOrderDetails() {
  const { orderId = '' } = useParams()
  const { api, app } = useRemoteApi()
  const [order, setOrder] = useState<RemoteOrder | null>(null)
  const [venue, setVenue] = useState<RemoteVenue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scope = useRef(0)
  const reads = useRef(0)
  const cancelling = useRef<number | null>(null)
  useEffect(() => {
    scope.current++
    setOrder(null)
    setVenue(null)
    setBusy(false)
    setError(null)
    return () => {
      scope.current++
    }
  }, [api, orderId])
  const load = useCallback(async () => {
    const current = scope.current
    if (cancelling.current === current) return
    const read = ++reads.current
    try {
      const next = await api.order(orderId)
      if (current !== scope.current || read !== reads.current) return
      setOrder(next)
      setVenue(next.venue ?? null)
      setError(null)
      if (next.venue) return
      try {
        const data = await api.menu(next.venueId)
        if (current === scope.current && read === reads.current) setVenue(data.venue)
      } catch {
        /* An unpublished venue must not hide an owned order. */
      }
    } catch (e) {
      if (current === scope.current && read === reads.current) setError(merchantError(e))
    }
  }, [api, orderId])
  useSerialPoll(load, Boolean(app.token))
  return (
    <Frame>
      <ErrorNotice error={error} />
      {!app.token ? (
        <section className="m-panel">
          <h1>
            {tr('Your order is safe.', 'Twoje zamówienie jest zapisane.')}
          </h1>
          <p>
            {tr(
              'Connect the wallet account that placed this order.',
              'Połącz konto portfela, z którego złożono to zamówienie.',
            )}
          </p>
          <button
            className="m-primary"
            onClick={() =>
              void app.login().catch((e) => setError(merchantError(e)))
            }
          >
            {tr('Connect wallet', 'Połącz portfel')}
          </button>
        </section>
      ) : order ? (
        <OrderCard
          order={order}
          venue={venue}
          busy={busy}
          onCancel={async () => {
            if (busy || cancelling.current === scope.current) return
            const generation = scope.current
            cancelling.current = generation
            reads.current++
            setBusy(true)
            try {
              const next = await api.cancel(order.id)
              if (generation === scope.current) setOrder(next)
            } catch (e) {
              if (generation === scope.current) setError(merchantError(e))
            } finally {
              if (generation === scope.current) {
                reads.current++
                setBusy(false)
              }
              if (cancelling.current === generation) cancelling.current = null
            }
          }}
        />
      ) : (
        !error && (
          <p role="status">
            {tr('Loading your order…', 'Wczytywanie zamówienia…')}
          </p>
        )
      )}
    </Frame>
  )
}
export function OrderCard({
  order,
  venue,
  busy = false,
  onCancel,
  onDemoPay,
}: {
  order: RemoteOrder
  venue: RemoteVenue | null
  busy?: boolean
  onCancel?: () => void
  onDemoPay?: () => void
}) {
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const accepted = ['PREPARING', 'READY'].includes(order.status)
  const title = (
    {
      AWAITING_PAYMENT: tr('Make it yours.', 'Zamów po swojemu.'),
      PAYMENT_PENDING: tr(
        'Checking your payment.',
        'Sprawdzamy Twoją płatność.',
      ),
      AWAITING_ACCEPTANCE: tr(
        'Waiting for the venue',
        'Czekamy na decyzję lokalu',
      ),
      PREPARING: tr('Your moment is brewing.', 'Twój moment się przygotowuje.'),
      READY: tr('Your order is ready.', 'Twoje zamówienie jest gotowe.'),
      COLLECTED: tr('Enjoy your order.', 'Smacznego!'),
      REFUND_PENDING: tr('Your refund is pending.', 'Twój zwrot oczekuje.'),
      REFUNDED: tr('Your payment was refunded.', 'Płatność została zwrócona.'),
      CANCELLED: tr('Order cancelled.', 'Zamówienie anulowane.'),
    } as Record<string, string>
  )[order.status]
  return (
    <section className="r-order-detail">
      <span className="m-label">
        {venue?.name ?? tr('YOUR ORDER', 'TWOJE ZAMÓWIENIE')} · #
        {String(order.number).padStart(3, '0')}
      </span>
      <h1>{title}</h1>
      <StockReservationStatus reservation={order.stockReservation} />
      <span className="r-pill">{statusText(order.status, order.refund)}</span>
      {venue && (
        <p className="m-muted">
          {venue.address} · {venue.city}
          <br />
          {venue.pickupInstructions}
        </p>
      )}
      {order.status === 'AWAITING_ACCEPTANCE' && (
        <div className="m-panel">
          <h2>
            {tr(
              'Paid. Awaiting acceptance.',
              'Opłacone. Oczekuje na akceptację.',
            )}
          </h2>
          <p>
            {tr(
              'The cashier must accept before preparation starts. No response means a refund awaiting owner approval.',
              'Kasjer musi przyjąć zamówienie przed rozpoczęciem przygotowania. Brak odpowiedzi oznacza zwrot oczekujący na właściciela.',
            )}
          </p>
          {order.acceptanceDeadline && (
            <strong>
              {tr('Decision time remaining', 'Pozostały czas na decyzję')}:{' '}
              {Math.max(
                0,
                Math.ceil(
                  (Date.parse(order.acceptanceDeadline) - clock) / 1000,
                ),
              )}{' '}
              s
            </strong>
          )}
        </div>
      )}
      {order.status === 'PREPARING' && (
        <p>
          {tr('Estimated preparation', 'Przewidywane przygotowanie')}:{' '}
          {order.preparationMinutes ?? venue?.preparationMinutes} min
        </p>
      )}
      {['REFUND_PENDING', 'REFUNDED'].includes(order.status) && (
        <div className="r-warning">
          <p>
            {order.decision === 'TIMED_OUT'
              ? tr(
                  'The venue did not respond in time.',
                  'Lokal nie odpowiedział w wyznaczonym czasie.',
                )
              : order.decision === 'REJECTED'
                ? tr(
                    'The venue declined your order.',
                    'Lokal odrzucił zamówienie.',
                  )
                : tr(
                    'This order requires a refund.',
                    'To zamówienie wymaga zwrotu.',
                  )}
          </p>
          {order.decisionReason && <p>{order.decisionReason}</p>}
          <strong>
            {order.status === 'REFUNDED'
              ? tr(
                  'The full original payment has been refunded.',
                  'Pełna pierwotna płatność została zwrócona.',
                )
              : order.refund?.status === 'APPROVED'
                ? tr(
                    'The owner authorized your refund. Waiting for the refund transfer; your money has not been returned yet.',
                    'Właściciel zatwierdził zwrot. Oczekujemy na przelew zwrotny; pieniądze nie zostały jeszcze zwrócone.',
                  )
                : tr(
                  'Your money has not been returned yet. Only the venue owner can authorize the refund.',
                  'Pieniądze nie zostały jeszcze zwrócone. Tylko właściciel lokalu może zatwierdzić zwrot.',
                )}
          </strong>
        </div>
      )}
      {accepted && order.pickup && (
        <section className="m-panel r-pickup">
          <span className="m-label">
            {tr('YOUR PICKUP PASS', 'TWÓJ KOD ODBIORU')}
          </span>
          <PickupQr token={order.pickup.token} />
          <strong className="r-pickup-code">{order.pickup.code}</strong>
          <p>
            {tr(
              'Show this only when collecting. Sharing it lets someone else pick up your order.',
              'Pokaż kod dopiero przy odbiorze. Udostępniając go, pozwalasz innej osobie odebrać zamówienie.',
            )}
          </p>
          {order.status === 'PREPARING' && (
            <small>
              {tr(
                'Your pass is ready; your order is still being prepared.',
                'Kod już jest, ale zamówienie jest jeszcze w przygotowaniu.',
              )}
            </small>
          )}
        </section>
      )}
      <section className="m-panel">
        <OrderLines order={order} />
        <div className="r-cart-total">
          <span>{tr('Total', 'Razem')}</span>
          <strong>{money(order.totalMinor, order.fiatCurrency)}</strong>
        </div>
        {order.payment && (
          <small>
            {tr('Payment received', 'Płatność otrzymana')} ·{' '}
            {order.payment.asset}
          </small>
        )}
      </section>
      {order.status === 'AWAITING_PAYMENT' && (
        <>
          <p className="r-warning">
            {tr(
              'Pay first, then wait for the cashier’s decision. A rejected or unanswered order requires a refund approved by the owner.',
              'Najpierw płacisz, potem czekasz na decyzję kasjera. Odrzucenie lub brak odpowiedzi wymaga zwrotu zatwierdzonego przez właściciela.',
            )}
          </p>
          {onDemoPay ? (
            <button className="m-primary" onClick={onDemoPay}>
              {tr('Simulate payment', 'Symuluj płatność')} →
            </button>
          ) : (
            order.checkoutToken && (
              <Link
                className="m-primary r-link-button"
                to={`/merchant/checkout/${order.checkoutToken}`}
              >
                {tr('Review & pay', 'Sprawdź i zapłać')} →
              </Link>
            )
          )}
          {onCancel && (
            <button disabled={busy} onClick={onCancel}>
              {tr('Cancel unpaid order', 'Anuluj nieopłacone zamówienie')}
            </button>
          )}
        </>
      )}
    </section>
  )
}
function OrderLines({ order }: { order: RemoteOrder }) {
  const lines =
    order.payment && order.paidSnapshot ? order.paidSnapshot.lines : order.lines
  return (
    <div>
      {lines.map((line, index) => (
        <div className="r-cart-line" key={index}>
          <div>
            <strong>
              {line.quantity} × {line.productName}
            </strong>
            <small>
              {line.variantName}
              {line.extras.map((e) => ` · ${e.name}`).join('')}
            </small>
            <OrderComposition line={line}/>
          </div>
          <span>{money(line.totalMinor, order.fiatCurrency)}</span>
        </div>
      ))}
    </div>
  )
}
function PickupQr({ token }: { token: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current)
      void toCanvas(canvas.current, token, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
      }).catch(() => {})
  }, [token])
  return (
    <canvas
      ref={canvas}
      aria-label={tr('Pickup QR code', 'Kod QR odbioru')}
      role="img"
    />
  )
}
const emptySettings: RemoteSettings = {
  published: false,
  description: '',
  address: '',
  city: '',
  pickupInstructions: '',
  preparationMinutes: 10,
  queueLimit: 10,
}
export function RemoteOwner({
  merchant,
  venue,
}: {
  merchant: MerchantApi
  venue: MerchantVenue | null
}) {
  const api = useMemo(() => new RemoteApi(merchant), [merchant])
  const [settings, setSettings] = useState<RemoteSettings>(emptySettings)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const edits = useRef(0)
  const ownerScope = useRef(0)
  const saving = useRef<number | null>(null)
  useEffect(() => {
    ownerScope.current++
    let active = true
    setBusy(false)
    setSaved(false)
    setLoaded(false)
    setError(null)
    if (venue)
      void api
        .settings(venue.id)
        .then((s) => {
          if (active) {
            setSettings(s)
            setLoaded(true)
          }
        })
        .catch((e) => {
          if (active) setError(merchantError(e))
        })
    return () => {
      active = false
      ownerScope.current++
    }
  }, [api, venue?.id])
  if (!venue)
    return <p>{tr('Create a venue first.', 'Najpierw utwórz lokal.')}</p>
  const field = (
    name: keyof RemoteSettings,
    label: string,
    maxLength: number,
  ) => (
    <label>
      {label}
      <input
        required={settings.published && ['address', 'city'].includes(name)}
        maxLength={maxLength}
        value={String(settings[name])}
        onChange={(e) => {
          edits.current++
          setSaved(false)
          setSettings({ ...settings, [name]: e.target.value })
        }}
      />
    </label>
  )
  return (
    <section className="m-panel">
      <span className="m-label">
        {tr('REMOTE ORDERING', 'ZAMÓWIENIA ZDALNE')}
      </span>
      <h2>
        {tr('Let good moments find you.', 'Daj się znaleźć na dobry moment.')}
      </h2>
      <p className="m-muted">
        {tr(
          'Publish your venue, then let the cashier open remote ordering during an active shift. Payments still require a cashier’s acceptance.',
          'Opublikuj lokal, a kasjer włączy zamówienia zdalne podczas aktywnej zmiany. Opłacone zamówienia nadal wymagają akceptacji kasjera.',
        )}
      </p>
      <ErrorNotice error={error} />
      {loaded && (
        <form
          className="m-form"
          onSubmit={async (e) => {
            e.preventDefault()
            const generation = ownerScope.current
            const submittedEdit = edits.current
            if (saving.current === generation) return
            saving.current = generation
            setBusy(true)
            setError(null)
            setSaved(false)
            try {
              const next = await api.saveSettings(venue.id, settings)
              if (generation !== ownerScope.current) return
              if (submittedEdit === edits.current) {
                setSettings(next)
                setSaved(true)
              }
            } catch (e) {
              if (generation === ownerScope.current) setError(merchantError(e))
            } finally {
              if (saving.current === generation) saving.current = null
              if (generation === ownerScope.current) setBusy(false)
            }
          }}
        >
          <label className="m-row">
            <span>
              {tr('Visible in venue directory', 'Widoczny na liście lokali')}
            </span>
            <input
              type="checkbox"
              checked={settings.published}
              onChange={(e) => {
                edits.current++
                setSaved(false)
                setSettings({ ...settings, published: e.target.checked })
              }}
            />
          </label>
          {field('description', tr('Short description', 'Krótki opis'), 500)}
          {field('address', tr('Pickup address', 'Adres odbioru'), 200)}
          {field('city', tr('City', 'Miasto'), 100)}
          {field(
            'pickupInstructions',
            tr('Pickup instructions', 'Wskazówki odbioru'),
            500,
          )}
          <label>
            {tr(
              'Default preparation time (minutes)',
              'Domyślny czas przygotowania (minuty)',
            )}
            <input
              type="number"
              min="1"
              max="120"
              required
              value={settings.preparationMinutes}
              onChange={(e) => {
                edits.current++
                setSaved(false)
                setSettings({
                  ...settings,
                  preparationMinutes: Number(e.target.value),
                })
              }}
            />
          </label>
          <label>
            {tr('Maximum active remote orders', 'Limit aktywnych zamówień zdalnych')}
            <input
              type="number"
              min="1"
              max="100"
              required
              value={settings.queueLimit}
              onChange={(e) => {
                edits.current++
                setSaved(false)
                setSettings({ ...settings, queueLimit: Number(e.target.value) })
              }}
            />
            <small>{tr('Counts payments being verified and paid orders awaiting acceptance, preparation or pickup. Issued, active quotes also reserve a place.', 'Limit obejmuje weryfikowane płatności, opłacone zamówienia czekające na akceptację, przygotowanie lub odbiór oraz aktywne wyceny.')}</small>
          </label>
          <button className="m-primary" disabled={busy}>
            {tr('Save venue listing', 'Zapisz wizytówkę')} →
          </button>
          {saved && (
            <p role="status">
              {tr('Venue listing saved.', 'Wizytówka została zapisana.')}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
/** Presence belongs to the signed-in terminal/shift, independent of the visible tab. */
export function useRemotePresence(
  merchant: MerchantApi,
  venueId: string | null,
  active: boolean,
) {
  const api = useMemo(() => new RemoteApi(merchant), [merchant])
  const [venue, setVenue] = useState<RemoteVenue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scope = useRef(0)
  useEffect(() => {
    scope.current++
    setVenue(null)
    setError(null)
    return () => {
      scope.current++
    }
  }, [api, venueId, active])
  const heartbeat = useCallback(async () => {
    if (!venueId) return
    const generation = scope.current
    try {
      const next = await api.heartbeat(venueId)
      if (generation === scope.current) {
        setVenue(next)
        setError(null)
      }
    } catch (e) {
      if (generation === scope.current) setError(merchantError(e))
    }
  }, [api, venueId])
  useSerialPoll(heartbeat, active && Boolean(venueId), 15000)
  return { venue, error }
}
export function RemoteQueue({
  contextScope = "",
  merchant,
  venueId,
  shiftActive,
  onChanged,
  presence,
  presenceError,
}: {
  merchant: MerchantApi
  contextScope?: string
  venueId: string
  shiftActive: boolean
  onChanged?: () => void
  presence?: RemoteVenue | null
  presenceError?: string | null
}) {
  const api = useMemo(() => new RemoteApi(merchant), [merchant])
  const [orders, setOrders] = useState<RemoteOrder[]>([])
  const context = useOrderContextQueue(merchant,venueId,contextScope,orders,false,shiftActive&&!!contextScope)
  const [availability, setAvailability] = useState<RemoteVenue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [minutes, setMinutes] = useState(10)
  const [pauseMinutes, setPauseMinutes] = useState(15)
  const minutesInitialized = useRef(false)
  const [reason, setReason] = useState('')
  const [credential, setCredential] = useState('')
  const [preview, setPreview] = useState<RemoteOrder | null>(null)
  const [verifiedCredential, setVerifiedCredential] = useState('')
  const scope = useRef(0)
  const reads = useRef(0)
  const locked = useRef<number | null>(null)
  useEffect(() => {
    scope.current++
    minutesInitialized.current = false
    setMinutes(10)
    setBusy(false)
    setOrders([])
    setAvailability(null)
    setPreview(null)
    setCredential('')
    setVerifiedCredential('')
    setError(null)
    return () => {
      scope.current++
    }
  }, [api, venueId, shiftActive])
  const load = useCallback(async (afterAction = false) => {
    const generation = scope.current
    if (!afterAction && locked.current === generation) return
    const read = ++reads.current
    try {
      const next = await merchant.orders(venueId)
      if (generation === scope.current && read === reads.current)
        setOrders((next as RemoteOrder[]).filter((o) => o.source === 'REMOTE'))
    } catch (e) {
      if (generation === scope.current && read === reads.current) setError(merchantError(e))
    }
  }, [merchant, venueId])
  useSerialPoll(load, shiftActive)
  useEffect(() => {
    const current = presence?.id === venueId ? presence : null
    setAvailability(current)
    if (current && !minutesInitialized.current) {
      setMinutes(current.preparationMinutes)
      minutesInitialized.current = true
    }
  }, [presence, venueId, shiftActive, api])
  const run = async (action: () => Promise<unknown>) => {
    const generation = scope.current
    if (locked.current === generation) return
    reads.current++
    locked.current = generation
    setBusy(true)
    setError(null)
    try {
      await action()
      if (generation === scope.current) {
        await load(true)
        onChanged?.()
      }
    } catch (e) {
      if (generation === scope.current) setError(merchantError(e))
    } finally {
      if (locked.current === generation) locked.current = null
      if (generation === scope.current) setBusy(false)
    }
  }
  const verify = (value: string) =>
    run(async () => {
      const current = scope.current
      setPreview(null)
      setVerifiedCredential('')
      const result = await api.preview(venueId, value.trim())
      if (current !== scope.current) return
      setPreview(result)
      setVerifiedCredential(value.trim())
    })
  return (
    <section className="r-remote-queue">
      <div className="m-panel">
        <div className="m-row">
          <div>
            <span className="m-label">
              {tr('REMOTE ORDERS', 'ZAMÓWIENIA ZDALNE')}
            </span>
            <h2>
              {tr(
                'A warm welcome, from afar.',
                'Przywitaj ich z wyprzedzeniem.',
              )}
            </h2>
          </div>
          <label className="r-toggle">
            <input
              type="checkbox"
              checked={availability?.accepting ?? false}
              disabled={busy || !shiftActive || !availability}
              onChange={(e) =>
                void run(async () => {
                  const generation = scope.current
                  const next = await api.availability(venueId, e.target.checked)
                  if (generation === scope.current) setAvailability(next)
                })
              }
            />
            {tr('Accept new remote orders', 'Przyjmuj nowe zamówienia zdalne')}
          </label>
        </div>
        <p className="m-muted">
          {tr(
            'Keep this terminal open and connected. New orders pause when its presence expires or the shift closes.',
            'Pozostaw terminal otwarty i połączony z internetem. Nowe zamówienia zostaną wstrzymane po utracie obecności lub zamknięciu zmiany.',
          )}
        </p>
        {availability && (
          <div className="m-row" aria-label={tr('Remote order controls', 'Sterowanie zamówieniami zdalnymi')}>
            <p role="status">
              {tr('Active queue', 'Aktywna kolejka')}: {availability.activeOrders}/{availability.queueLimit}
              {availability.pausedUntil && (Date.parse(availability.pausedUntil) > Date.now()
                ? ` · ${tr('Paused until', 'Pauza do')} ${new Date(availability.pausedUntil).toLocaleTimeString()}`
                : !availability.accepting
                  ? ` · ${tr('Pause ended; reopen when ready', 'Pauza minęła; możesz ponownie włączyć zamówienia')}`
                  : '')}
            </p>
            <label>
              {tr('Pause duration', 'Czas pauzy')}
              <select aria-label={tr('Pause duration', 'Czas pauzy')} value={pauseMinutes} onChange={(e) => setPauseMinutes(Number(e.target.value))}>
                {[15, 30, 60, 120].map((value) => <option key={value} value={value}>{value} {tr('minutes', 'min')}</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !shiftActive || !availability.accepting}
              onClick={() => void run(async () => {
                const generation = scope.current
                const next = await api.availability(venueId, false, pauseMinutes)
                if (generation === scope.current) setAvailability(next)
              })}
            >{tr('Pause new orders', 'Wstrzymaj nowe zamówienia')}</button>
          </div>
        )}
        {availability?.unavailableReason === 'BUSY' && <p role="status">{tr('Queue is at its configured limit. New checkouts pause until an order is collected or rejected.', 'Kolejka osiągnęła ustawiony limit. Nowe płatności zostaną wznowione, gdy zamówienie zostanie odebrane lub odrzucone.')}</p>}
        {!shiftActive && (
          <p>
            {tr(
              'Open a shift to manage remote orders.',
              'Otwórz zmianę, aby obsługiwać zamówienia zdalne.',
            )}
          </p>
        )}
        <ErrorNotice error={error ?? presenceError ?? null} />{context.error&&<p role="alert">{tr("Priority data may be stale.","Priorytety mogą być nieaktualne.")} {context.error}</p>}
      </div>
      {shiftActive && (
        <>
          <section className="m-panel m-form">
            <h3>{tr('Pickup verification', 'Weryfikacja odbioru')}</h3>
            <PickupScanner
              key={`${venueId}:${scope.current}`}
              onRead={(value) => void verify(value)}
              disabled={busy}
            />
            <form
              className="m-form"
              onSubmit={(e) => {
                e.preventDefault()
                void verify(credential)
              }}
            >
              <label>
                {tr(
                  'Pickup QR token or short code',
                  'Token QR odbioru lub krótki kod',
                )}
                <input
                  maxLength={500}
                  required
                  autoComplete="off"
                  value={credential}
                  onChange={(e) => {
                    setCredential(e.target.value)
                    setPreview(null)
                    setVerifiedCredential('')
                  }}
                />
              </label>
              <button disabled={busy || !credential.trim()}>
                {tr('Verify pickup', 'Sprawdź odbiór')} →
              </button>
            </form>
            {preview && (
              <div className="r-confirm">
                <h3>{tr('Confirm handover', 'Potwierdź wydanie')}</h3>
                <strong>
                  #{String(preview.number).padStart(3, '0')} ·{' '}
                  {statusText(preview.status, preview.refund)}
                </strong>
                <OrderLines order={preview} />
                <button
                  className="m-primary"
                  disabled={busy || preview.status !== 'READY'}
                  onClick={() =>
                    void run(async () => {
                      const generation = scope.current
                      await api.collect(preview.id, verifiedCredential)
                      if (generation !== scope.current) return
                      setPreview(null)
                      setCredential('')
                      setVerifiedCredential('')
                    })
                  }
                >
                  {tr('Confirm handover', 'Potwierdź wydanie')} ✓
                </button>
                {preview.status !== 'READY' && (
                  <p>
                    {tr(
                      'The order must be ready before handover.',
                      'Przed wydaniem zamówienie musi być gotowe.',
                    )}
                  </p>
                )}
              </div>
            )}
          </section>
          <div className="m-form r-decision-settings">
            <label>
              {tr('Preparation time (minutes)', 'Czas przygotowania (minuty)')}
              <input
                type="number"
                min="1"
                max="120"
                value={minutes}
                onChange={(e) => {
                  minutesInitialized.current = true
                  setMinutes(Number(e.target.value))
                }}
              />
            </label>
            <label>
              {tr('Reason if declining', 'Powód odmowy')}
              <input
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tr(
                  'Tell the customer what happened',
                  'Poinformuj klienta, co się stało',
                )}
              />
            </label>
          </div>
          <h3>{tr('Needs your decision', 'Do akceptacji')}</h3>
          {context.orders
            .filter((o) => o.status === 'AWAITING_ACCEPTANCE')
            .map((order) => (
              <div key={order.id}><OrderContextPanel api={merchant} venueId={venueId} orderId={order.id} scope={contextScope} canWrite={shiftActive} summary={context.summaries.get(order.id)} onChanged={()=>void context.refresh()}/>{['PREPARING','READY'].includes(order.status)&&<OrderReadiness api={merchant} venueId={venueId} order={order as Parameters<MerchantApi['status']>[0]} scope={contextScope} canWrite={shiftActive} onChanged={()=>{void load(true);onChanged?.()}}/>}<StaffOrder
                order={order}
                busy={busy}
                onAccept={() => void run(() => api.accept(order.id, minutes))}
                onReject={() =>
                  void run(() => api.reject(order.id, reason.trim()))
                }
                canReject={Boolean(reason.trim())}
                canAccept={
                  Number.isInteger(minutes) && minutes >= 1 && minutes <= 120
                }
              /></div>
            ))}
          {!orders.some((o) => o.status === 'AWAITING_ACCEPTANCE') && (
            <p className="m-muted">
              {tr(
                'No orders waiting for a decision.',
                'Nie ma zamówień oczekujących na decyzję.',
              )}
            </p>
          )}
          <h3>
            {tr(
              'Remote preparation & pickup',
              'Przygotowanie i odbiór zamówień zdalnych',
            )}
          </h3>
          {context.orders
            .filter((o) =>
              ['PREPARING', 'READY', 'COLLECTED', 'REFUND_PENDING'].includes(
                o.status,
              ),
            )
            .map((order) => (
              <div key={order.id}><OrderContextPanel api={merchant} venueId={venueId} orderId={order.id} scope={contextScope} canWrite={shiftActive} summary={context.summaries.get(order.id)} onChanged={()=>void context.refresh()}/>{['PREPARING','READY'].includes(order.status)&&<OrderReadiness api={merchant} venueId={venueId} order={order as Parameters<MerchantApi['status']>[0]} scope={contextScope} canWrite={shiftActive} onChanged={()=>{void load(true);onChanged?.()}}/>}<StaffOrder
                order={order}
                busy={busy}
                onRefund={() =>
                  void run(async () => {
                    const generation = scope.current
                    await merchant.refund(
                      order.id,
                      tr(
                        'Customer requested a full refund.',
                        'Klient poprosił o pełny zwrot.',
                      ),
                    )
                    if (generation !== scope.current) return
                    setPreview(null)
                    setVerifiedCredential('')
                  })
                }

              /></div>
            ))}
        </>
      )}
    </section>
  )
}
function StaffOrder({
  order,
  busy = false,
  onAccept,
  onReject,
  onReady,
  onRefund,
  canAccept = true,
  canReject = true,
  onVerify,
}: {
  order: RemoteOrder
  busy?: boolean
  onAccept?: () => void
  onReject?: () => void
  onReady?: () => void
  onRefund?: () => void
  canAccept?: boolean
  canReject?: boolean
  onVerify?: () => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = order.acceptanceDeadline
    ? Math.max(
        0,
        Math.ceil((Date.parse(order.acceptanceDeadline) - now) / 1000),
      )
    : null
  return (
    <article className="m-panel r-staff-order">
      <div className="m-row">
        <strong className="m-order-number">
          #{String(order.number).padStart(3, '0')}
        </strong>
        <span className="r-pill">{statusText(order.status, order.refund)}</span>
      </div>
      <StockReservationStatus reservation={order.stockReservation} />
      <OrderLines order={order} />
      {order.status === 'AWAITING_ACCEPTANCE' && (
        <>
          <p>
            {tr('Decision time remaining', 'Pozostały czas na decyzję')}:{' '}
            {left ?? '—'} s
          </p>
          <div className="m-actions">
            <button
              className="m-primary"
              disabled={busy || !canAccept || left === 0}
              onClick={onAccept}
            >
              {tr('Accept order', 'Przyjmij zamówienie')} →
            </button>
            <button
              disabled={busy || !canReject || left === 0}
              onClick={onReject}
            >
              {tr('Reject order', 'Odrzuć zamówienie')}
            </button>
          </div>
        </>
      )}
      {order.status === 'PREPARING' && onReady && (
        <button className="m-primary" disabled={busy} onClick={onReady}>
          {tr('Ready for pickup', 'Gotowe do odbioru')} →
        </button>
      )}
      {order.status === 'READY' && (
        <p>
          {tr(
            'Verify the customer’s pickup code, then confirm handover.',
            'Sprawdź kod odbioru klienta, następnie potwierdź wydanie.',
          )}
        </p>
      )}
      {order.status === 'READY' && onVerify && (
        <button onClick={onVerify}>
          {tr('Verify pickup', 'Sprawdź odbiór')} →
        </button>
      )}
      {['PREPARING', 'READY', 'COLLECTED'].includes(order.status) &&
        onRefund && (
          <button disabled={busy} onClick={onRefund}>
            {tr('Request full refund', 'Poproś o pełny zwrot')}
          </button>
        )}
      {order.status === 'REFUND_PENDING' && (
        <p>
          {tr(
            'Refund awaiting owner authorization. No pickup is allowed.',
            'Zwrot czeka na zatwierdzenie właściciela. Odbiór jest zablokowany.',
          )}
        </p>
      )}
    </article>
  )
}
interface BarcodeDetectorLike {
  detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
function PickupScanner({
  onRead,
  disabled,
}: {
  onRead: (value: string) => void
  disabled: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(false)
  const starting = useRef(false)
  const generation = useRef(0)
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stop = () => {
    generation.current++
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
  const start = async () => {
    if (starting.current || stream.current) return
    starting.current = true
    setPending(true)
    setError(null)
    const current = ++generation.current
    try {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (options: {
            formats: string[]
          }) => BarcodeDetectorLike
        }
      ).BarcodeDetector
      if (!Detector || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          tr(
            'Camera unavailable. Enter the short pickup code instead.',
            'Kamera niedostępna. Wpisz krótki kod odbioru.',
          ),
        )
      const detector = new Detector({ formats: ['qr_code'] })
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      if (!mounted.current || current !== generation.current) {
        camera.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = camera
      if (video.current) {
        video.current.srcObject = camera
        await video.current.play()
      }
      if (!mounted.current || current !== generation.current) {
        camera.getTracks().forEach((track) => track.stop())
        return
      }
      setActive(true)
      let detecting = false
      timer.current = setInterval(async () => {
        if (detecting || !video.current || video.current.readyState < 2) return
        detecting = true
        try {
          const codes = await detector.detect(video.current)
          if (mounted.current && current === generation.current && codes[0]) {
            stop()
            setActive(false)
            onRead(codes[0].rawValue)
          }
        } catch {
          /* retry camera frame */
        } finally {
          detecting = false
        }
      }, 300)
    } catch (e) {
      if (mounted.current && current === generation.current) {
        stop()
        setActive(false)
        setError(
          e instanceof Error
            ? e.message
            : tr(
                'Camera unavailable. Enter the pickup code.',
                'Kamera niedostępna. Wpisz kod odbioru.',
              ),
        )
      }
    } finally {
      starting.current = false
      if (mounted.current) setPending(false)
    }
  }
  return (
    <div>
      <video
        className="m-scanner-video"
        ref={video}
        hidden={!active}
        muted
        playsInline
        aria-label={tr('Pickup camera preview', 'Podgląd kamery odbioru')}
      />
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          if (active) {
            stop()
            setActive(false)
          } else void start()
        }}
      >
        {active
          ? tr('Stop camera', 'Zatrzymaj kamerę')
          : tr('Scan customer pickup QR', 'Skanuj QR odbioru klienta')}{' '}
        ↗
      </button>
      <ErrorNotice error={error} />
    </div>
  )
}
const demoVenue: RemoteVenue = {
  id: 'demo',
  name: 'Maison Café',
  fiatCurrency: 'EUR',
  published: true,
  description: 'Small rituals. Very good coffee.',
  address: '12 Garden Street',
  city: 'Berlin',
  pickupInstructions: 'Pick up at the counter by the window.',
  preparationMinutes: 8,
  queueLimit: 10,
  accepting: true,
  available: true,
  unavailableReason: null,
  pausedUntil: null,
  activeOrders: 0,
}
const demoProducts: MerchantProduct[] = [
 {id:'breakfast',name:'Morning ritual',category:'Breakfast',available:true,variants:[{id:'set',name:'Breakfast set',priceMinor:590}],components:[{productId:'croissant',variantId:'classic',quantity:1}],choiceGroups:[{id:'drink',name:'Your coffee',min:1,max:1,extraIds:['flat-choice','large-choice']}],extras:[{id:'flat-choice',name:'Regular flat white',priceMinor:0,available:true,component:{productId:'flat',variantId:'regular',quantity:1}},{id:'large-choice',name:'Large flat white',priceMinor:70,available:true,component:{productId:'flat',variantId:'large',quantity:1}}]},
  {
    id: 'flat',
    name: 'Flat white',
    category: 'Coffee',
    available: true,
    variants: [
      { id: 'regular', name: 'Regular', priceMinor: 380 },
      { id: 'large', name: 'Large', priceMinor: 450 },
    ],
    extras: [
      { id: 'oat', name: 'Oat milk', priceMinor: 60, available: true },
      { id: 'shot', name: 'Extra shot', priceMinor: 90, available: true },
    ],
  },
  {
    id: 'croissant',
    name: 'Butter croissant',
    category: 'Bakery',
    available: true,
    variants: [{ id: 'classic', name: 'Classic', priceMinor: 290 }],
    extras: [],
  },
]
export function RemoteDemo() {
  const [venue, setVenue] = useState(false)
  const [cart, setCart] = useState<MerchantCartLine[]>([])
  const [order, setOrder] = useState<RemoteOrder | null>(null)
  const [role, setRole] = useState<'customer' | 'cashier'>('customer')
  const [verified, setVerified] = useState(false)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(8)
  const [paused, setPaused] = useState(false)
  const create = () => {
    const {lines} = priceMerchantCart(demoProducts,cart)
    setOrder({
      id: 'demo-order',
      venueId: 'demo',
      number: 42,
      source: 'REMOTE',
      revision: 1,
      status: 'AWAITING_PAYMENT',
      fiatCurrency: 'EUR',
      totalMinor: lines.reduce((n, l) => n + l.totalMinor, 0),
      lines,
      employeeId: null,
      shiftId: null,
      quote: null,
      payment: null,
      refund: null,
      createdAt: new Date().toISOString(),
      pickup: null,
    })
  }
  const pay = () =>
    setOrder((current) =>
      current
        ? {
            ...current,
            status: 'AWAITING_ACCEPTANCE',
            payment: {
              asset: 'NIM',
              network: 'demo',
              amountAtomic: '12500000',
              sender: 'demo-customer',
              recipient: 'demo-venue',
              hash: 'demo-no-transaction',
              confirmedAt: new Date().toISOString(),
            },
            acceptanceDeadline: new Date(Date.now() + 180000).toISOString(),
          }
        : null,
    )
  const accept = () =>
    setOrder((current) =>
      current
        ? {
            ...current,
            status: 'PREPARING',
            decision: 'ACCEPTED',
            decisionAt: new Date().toISOString(),
            preparationMinutes: minutes,
            employeeId: 'demo-cashier',
            shiftId: 'demo-shift',
            pickup: {
              token: 'nimble-pickup:demo:private-order-token',
              code: '824 193',
            },
          }
        : null,
    )
  const reject = (timeout = false) =>
    setOrder((current) =>
      current
        ? {
            ...current,
            status: 'REFUND_PENDING',
            decision: timeout ? 'TIMED_OUT' : 'REJECTED',
            decisionReason: timeout
              ? 'The venue did not respond in time.'
              : reason,
            pickup: null,
            refund: {
              id: 'demo-refund',
              status: 'REQUESTED',
              reason: timeout ? 'No response' : reason,
              quote: null,
            },
          }
        : null,
    )
  return (
    <Frame demo>
      <div className="r-demo-toolbar">
        <div className="m-actions">
          <button
            aria-pressed={role === 'customer'}
            onClick={() => setRole('customer')}
          >
            {tr('Customer workspace', 'Widok klienta')}
          </button>
          <button
            aria-pressed={role === 'cashier'}
            onClick={() => setRole('cashier')}
          >
            {tr('Cashier workspace', 'Widok kasjera')}
          </button>
          <button
            onClick={() => {
              setOrder(null)
              setCart([])
              setVenue(false)
              setVerified(false)
              setReason('')
              setRole('customer')
            }}
          >
            {tr('Start again', 'Zacznij od nowa')}
          </button>
        </div>
        <p>
          {tr(
            'An isolated walkthrough. No wallet, server or real payment.',
            'Odizolowane demo. Bez portfela, serwera i prawdziwych płatności.',
          )}
        </p>
      </div>
      {role === 'customer' ? (
        order ? (
          <OrderCard
            order={order}
            venue={demoVenue}
            onCancel={() => setOrder({ ...order, status: 'CANCELLED' })}
            onDemoPay={pay}
          />
        ) : venue ? (
          <>
            <section className="r-menu-header">
              <span className="m-label">{demoVenue.city}</span>
              <h1>{demoVenue.name}</h1>
              <p>{demoVenue.description}</p>
              <p>
                {demoVenue.address} · ~{demoVenue.preparationMinutes} min
              </p>
            </section>
            <MenuBasket
              products={demoProducts}
              venue={demoVenue}
              cart={cart}
              onCart={setCart}
              onSubmit={create}
              disabled={paused}
              submitLabel={tr('Place demo order', 'Złóż zamówienie demo')}
            />
          </>
        ) : (
          <>
            <section className="r-hero">
              <span className="m-label">
                {tr('YOUR NEXT GOOD MOMENT', 'TWÓJ NASTĘPNY MIŁY MOMENT')}
              </span>
              <h1>
                {tr(
                  'Order ahead. Arrive happy.',
                  'Zamów wcześniej. Przyjdź z uśmiechem.',
                )}
              </h1>
              <p>
                {tr(
                  'Your coffee can get started before you get there.',
                  'Twoja kawa może zacząć się przygotowywać, zanim dotrzesz na miejsce.',
                )}
              </p>
            </section>
            <button
              className="m-panel r-venue r-demo-venue"
              onClick={() => setVenue(true)}
            >
              <VenueCard venue={{ ...demoVenue, available: !paused }} />
            </button>
          </>
        )
      ) : (
        <section>
          <div className="m-row">
            <h1>{tr('Your remote counter.', 'Twoja zdalna lada.')}</h1>
            <label className="r-toggle">
              <input
                type="checkbox"
                checked={!paused}
                onChange={(e) => setPaused(!e.target.checked)}
              />
              {tr(
                'Accept new remote orders',
                'Przyjmuj nowe zamówienia zdalne',
              )}
            </label>
          </div>
          {!order ? (
            <p>
              {tr(
                'Place an order in the customer workspace first.',
                'Najpierw złóż zamówienie w widoku klienta.',
              )}
            </p>
          ) : (
            <>
              {order.status === 'AWAITING_ACCEPTANCE' && (
                <div className="m-panel m-form">
                  <label>
                    {tr(
                      'Preparation time (minutes)',
                      'Czas przygotowania (minuty)',
                    )}
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    {tr('Reason if declining', 'Powód odmowy')}
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                </div>
              )}
              <StaffOrder
                order={order}
                onAccept={accept}
                onReject={() => reject()}
                canAccept={minutes >= 1 && minutes <= 120}
                canReject={Boolean(reason.trim())}
                onReady={() => setOrder({ ...order, status: 'READY' })}
                onVerify={() => setVerified(true)}
              />
              {order.status === 'AWAITING_ACCEPTANCE' && (
                <button onClick={() => reject(true)}>
                  {tr('Simulate decision timeout', 'Symuluj brak odpowiedzi')}
                </button>
              )}
              {verified && order.status === 'READY' && (
                <section className="m-panel r-confirm">
                  <h3>{tr('Confirm handover', 'Potwierdź wydanie')}</h3>
                  <OrderLines order={order} />
                  <button
                    className="m-primary"
                    onClick={() => {
                      setOrder({ ...order, status: 'COLLECTED', pickup: null })
                      setVerified(false)
                    }}
                  >
                    {tr('Confirm handover', 'Potwierdź wydanie')} ✓
                  </button>
                </section>
              )}

              {order.status === 'REFUND_PENDING' && (
                <p className="r-warning">
                  {tr(
                    'No loyalty stamp earned. Only the owner may authorize a real refund.',
                    'Bez pieczątki lojalnościowej. Tylko właściciel może zatwierdzić prawdziwy zwrot.',
                  )}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </Frame>
  )
}
