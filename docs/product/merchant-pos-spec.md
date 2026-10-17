# Merchant POS implementation specification

## Problem
A small counter-service venue needs a polished Android-phone POS accepting NIM/USDT, with orders and multiple cashiers without granting employees access to owner funds. Competition-ready experience, honest demo, no inventory.

## Authoritative requirements
Read merchant-direction.md and both ADRs. Owner configures venue (EUR/PLN/USD), catalog with size variants and paid extras, employee profiles/PINs and one paired terminal. Cashier opens own shift, builds orders, manually toggles availability, claims payer code or shares order QR; cannot change prices, payout addresses, employees, global reports or send money. Customer sees itemized immutable checkout and fiat/crypto amounts, pays directly to owner and tracks preparation, ready, collected. Full refund is requested by cashier and authorized by owner on separate device; exact paid crypto amount, confirmed only after chain verification. Ready event independently enqueues one 1-luna signal from an isolated operator-funded notification wallet. No claim of native background delivery until device-tested.

## User stories
1. Owner creates a venue and selects its fiat currency and receiving addresses.
2. Owner manages menu, sizes, paid extras and employees.
3. Owner pairs a shared terminal without exposing wallet credentials.
4. Cashier signs in with a profile and PIN on that terminal and works a personal shift.
5. Cashier prepares itemized orders and changes availability without inventory.
6. Customer accesses a checkout by QR or existing pairing code and selects NIM/USDT.
7. Customer approves the exact quoted transfer in their own wallet.
8. Cashier observes chain-verified payment and manages preparation/ready/collection.
9. Customer follows their own order and receives a readiness signal if configured.
10. Cashier requests a refund and owner approves the full exact-asset refund.
11. Owner sees venue reporting; cashier sees only their own shift summary.
12. Visitor tries a clearly isolated example café without signing or sending money.

## Implementation decisions
Additive merchant subsystem: retain all existing P2P flows. Server-authoritative totals in integer minor/atomic units; frozen item snapshots and short-lived quotes. Explicit role/device authorization, revocation, PIN hashing, throttling, duplicate prevention and immutable order revisions. Never trust a submitted tx hash without checking chain receipt, sender, recipient, asset, network, amount and unique assignment. Failed/stale FX blocks live checkout, never substitutes demonstration rates. Exact finalized funds mined after quote expiry are recorded for a full refund, not fulfillment. Submitted hashes are immutable attempts rather than exclusive claims; correcting a hash never requests a second signature and retains earlier attempts for reconciliation. USDT Polygon ERC20 with matching verified tx, no assumed NIM reconciliation semantics. Notifications outbox stores signed raw tx before broadcast and retries same bytes; disabled without dedicated configuration, bounded budget. Demo is in-memory and visibly synthetic. Light/elegant responsive UI uses warm white, graphite, emerald, accessible controls.

## Testing
Existing Vitest API inject tests with Postgres, shared pure-domain tests and React tests. Exercise cashier isolation, bad PIN/revocation, forged totals, unavailable extras, state transitions, repeat requests, actual chain verifier mismatches, refund authority and deduplicated notifications. Browser demo flow and narrow layout. Do not execute real financial transfers or deploy.

## Out of scope
Inventory, customer-composed baskets, multiple terminals, partial refunds, automatic FX swaps, card acceptance, promises of native background hooks.

## Verification gates
Physical Nimiq Pay tests and real mainnet/testnet transactions require an actual device and configured wallets. Document gates honestly; fail closed in live mode. Local development is authorized; no push/deploy performed automatically.
