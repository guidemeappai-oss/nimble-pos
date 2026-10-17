# Nimble POS — fork projektu Nimble

**Zacznij od [FORK-START-PL.md](FORK-START-PL.md)** — instalacja, uruchomienie, zakres funkcji i bramki przed live.

# Nimble

Code-mediated peer-to-peer payments inside [Nimiq Pay](https://nimiq.com).
The payer generates a temporary six-digit code and tells it to the receiver.
The receiver claims the code and creates a charge; the payer reviews the
exact transfer (recipient, amount, asset, network) and confirms it in the
Nimiq Pay wallet. The receiver treats the payment as successful only after
blockchain finality. No QR codes, payment links, or wallet addresses are
exchanged.

Nimble is a Nimiq Pay **Mini App**: a web app running in a WebView inside
Nimiq Pay, talking to the wallet through the injected `window.nimiq`
provider (`@nimiq/mini-app-sdk`). Customer and venue-owner keys stay in their wallets. The backend never signs
customer payments or owner refunds. An optional isolated operator-funded wallet
signs 1-luna pickup signals; see [ADR 0001](docs/adr/0001-notification-wallet.md).

> **Judging the competition?** [JUDGES.md](JUDGES.md) answers the scoring
> checklist question by question, with pointers to verify every claim.

## Merchant Counter

Counter turns a shared Android phone into a venue POS: a product menu with
sizes and paid extras, cashier profiles and PINs, personal shifts, itemized
orders, QR/code checkout, and preparation/ready/collection tracking. Prices
are shown in EUR, PLN or USD alongside NIM/USDT estimates. Payments go directly
to the owner's receiving address; employees never receive wallet spending
credentials. Full refunds require the owner on their own phone.

Run the web app and open **`/merchant/demo`** to try Maison Café without a
wallet, database or real funds. Live owner setup is under `/merchant/owner`,
and the paired cashier phone under `/merchant/terminal`. Customers can scan
an order at `/merchant/scan` or follow its checkout link.

Loyalty cards: `/merchant/loyalty/demo` demonstrates five purchases and a free reward.
Customers find their live cards under `/merchant/cards`; owners configure the reward
and minimum purchase in the Loyalty tab. Rewards stay separate from paid sales.
See [loyalty setup and acceptance](docs/product/loyalty-running.md).

Remote pickup ordering adds venue discovery at `/venues`, customer orders at
`/orders`, and an isolated demonstration at `/remote/demo`. Customers order and
pay before arriving; a cashier must explicitly accept the paid order before
preparation begins. Rejected or unanswered orders require an owner-authorized
refund. The customer carries the pickup QR on their own phone, and the cashier
verifies it before confirming handover. Remote ordering defaults to disabled
(`REMOTE_ORDERING_ENABLED=0`); see [setup and acceptance](docs/product/remote-ordering-running.md).

See [the setup and device verification guide](docs/product/merchant-running.md)
for live RPC configuration, exact payment verification, recovery after an
interrupted wallet approval, and the optional operator-funded one-luna pickup
signal. Native signing/network capabilities and background notifications still
require physical Nimiq Pay testing. The demo does not simulate real usage or
claim that a transaction has been sent.

[Counter preview](docs/product/screenshots/counter-desktop.png) ·
[Customer checkout](docs/product/screenshots/checkout.png) ·
[Pickup screen](docs/product/screenshots/pickup.png)

## Try it (no setup)

1. Install [Nimiq Pay](https://www.nimiq.com/nimiq-pay/), open
   **Mini Apps → Custom URL** and enter: `https://nimble.gallareton.pl`
2. Connect the wallet, tap **Pay** to show a code — and have a second
   person (or your second device) claim it under **Charge**. Watch both
   screens follow the payment live until **Confirmed**.

Nimble detects your wallet's network and serves the matching backend:
regular wallets pay with real NIM on **mainnet**; if you'd rather test
with play money, long-press the settings button in Nimiq Pay (~10 s),
switch to **Testnet**, tap **Get free NIM** (faucet) — the app follows
your wallet automatically, with a separate testnet history.

## Repo layout

```
apps/web         React + Vite Mini App (the UI)
apps/api         Fastify API: sessions, charges, SSE, transaction monitor
packages/shared  domain types, luna arithmetic, session state machine, API contract
e2e              Playwright end-to-end suite (mock wallet + fake chain)
```

## Quickstart (mock mode — no wallet, no chain)

Requirements: Node 22+, pnpm 9+, Docker.

```bash
pnpm install
docker compose up -d postgres
pnpm --filter @nimble/api generate && pnpm --filter @nimble/api migrate
MOCK_AUTH=1 FAKE_CHAIN=1 pnpm --filter @nimble/api dev
VITE_WALLET=mock pnpm --filter @nimble/web dev
```

Open two browser profiles at `http://localhost:5173` and walk through
Pay ↔ Charge. Drive fake finality with:

```bash
curl -X POST localhost:3000/__test/chain/advance -H 'content-type: application/json' -d '{"blocks":1}'
curl -X POST localhost:3000/__test/chain/advance -H 'content-type: application/json' -d '{"macro":true}'
```

`MOCK_AUTH` / `FAKE_CHAIN` refuse to start with `NODE_ENV=production`.

## Tests

```bash
pnpm test                     # unit + integration (needs the postgres container)
pnpm --filter @nimble/e2e test   # Playwright end-to-end
```

## Real devices (developer protocol)

See [DEVICE_TESTING.md](DEVICE_TESTING.md) — Nimiq Pay has a hidden
developer menu with a testnet switch and a faucet; the Mini App loads
straight from your dev server via Custom URL.

## Deploy (public HTTPS)

One container serves the API and the built web app from the same origin;
`render.yaml` is a ready [Render](https://render.com) Blueprint (web
service + managed Postgres, secrets generated). Any Docker host works:

```bash
docker build -t nimble .
docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... -e CODE_PEPPER=... nimble
```

In Nimiq Pay: **Mini Apps → Custom URL** → your deployment URL.

## Design notes

- Money is integer **luna** (`bigint`, 1 NIM = 100 000 luna) end to end;
  JSON carries decimal strings.
- The 6-digit code is a **locator, not a credential**: it pairs two
  sessions and is consumed atomically by the first claimer; every failure
  mode returns the same generic response.
- The payer's approval binds recipient, amount, asset, network and a random
  reconciliation token that travels in the transaction's data field — if the
  client dies after broadcasting, the backend matches the transfer on-chain
  and the payment still completes.
- "Paid" means **finalized**: a transaction is CONFIRMED only after the
  including block is sealed by a macro block (Albatross finality).

## Roadmap

See [ROADMAP.md](ROADMAP.md) — request-by-link, bill splitting, merchant
POS mode, Cashlink cheques, phone-number transfers, USDT on Polygon.

## License

[MIT](LICENSE)
