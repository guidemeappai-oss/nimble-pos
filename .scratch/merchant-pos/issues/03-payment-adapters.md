# 03: Verified NIM/USDT payments and notification delivery

**What to build:** Exact FX quotes, payment/refund verification and wallet adapters; isolated notification signer with persistent outbox contract and tests.

**Blocked by:** None for adapters; 01 for wiring

**Status:** implemented — device/release verification remains in docs/product/merchant-running.md

- [x] Local implementation reviewed against docs/product/merchant-pos-spec.md
- [x] Meaningful API/shared/UI behavior tests pass
- [x] Existing P2P API/UI regression suites and all 4 Playwright scenarios pass
- [ ] Production device and native PostgreSQL verification (see running guide)
