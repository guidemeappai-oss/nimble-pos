# 05: Pokaz konkursowy i odbiór całości

**What to build:** Klient widzi dopracowaną kartę i pełny scenariusz od pierwszego zakupu do nagrody.

**Blocked by:** 04 — Zmiana programu i raport właściciela.

**Status:** blocked — implementacja i lokalna weryfikacja zakończone; odbiór na fizycznym Androidzie i natywnym PostgreSQL oczekuje na środowisko.

**Spec:** docs/product/loyalty-card-plan.md

- [x] Demo odtwarza wszystkie etapy w osobnym stanie bez portfela i pieniędzy.
- [x] Karta ma stany zbierania, rezerwacji, gotowości i korekty; animacje respektują ograniczenie ruchu.
- [x] Przepływ działa na wąskim ekranie, po odświeżeniu i utracie połączenia, z tłumaczeniami.
- [x] Przechodzą właściwe testy API/web/shared, sprawdzanie typów i build; przegląd standardów i zgodności ze specyfikacją.
- [ ] Odbiór na Androidzie i natywnym PostgreSQL udokumentowany oddzielnie; brak środowiska oznacza otwartą bramkę, nie sukces.
- [ ] Przed testem realnej płatności zamknięte osobne zadanie zgodności rozpoznania sieci Nimiq Pay.

**Wynik:** kod zintegrowany w feat/loyalty-card; lokalne testy i ograniczenia opisuje docs/product/loyalty-running.md. Bramka natywnego PostgreSQL pozostaje otwarta także dla testów współbieżności.
