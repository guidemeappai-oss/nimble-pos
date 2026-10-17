# 03: Nagroda od rezerwacji do wydania

**What to build:** Klient rezerwuje nagrodę, kasjer przyjmuje ją z QR i wydaje przez kolejkę.

**Blocked by:** 02 — Pieczątka po zakupie i korekta zwrotu.

**Status:** completed

**Spec:** docs/product/loyalty-card-plan.md

- [x] Rezerwacja pięciu punktów wygasa po pięciu minutach, jeśli kasjer jej nie przyjmie.
- [x] Przyjęcie zużywa punkty raz i tworzy odrębną realizację nagrody PREPARING → READY → COLLECTED.
- [x] Nagroda nie wywołuje płatności, nie nalicza punktów i nie zwiększa przychodu ani liczby płatnych zamówień.
- [x] Anulowanie przed wydaniem przywraca punkty raz; niedostępność produktu nie powoduje utraty punktów.
- [x] Zwrot kolidujący z rezerwacją i saldo ujemne po odebranej nagrodzie zachowują reguły specyfikacji.
- [ ] Dwa równoczesne odbiory i wyścig zwrot/odbiór testowane przez API oraz na natywnym PostgreSQL.

**Wynik:** kod zintegrowany w feat/loyalty-card; lokalne testy i ograniczenia opisuje docs/product/loyalty-running.md. Bramka natywnego PostgreSQL pozostaje otwarta także dla testów współbieżności.
