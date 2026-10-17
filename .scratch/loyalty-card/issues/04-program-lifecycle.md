# 04: Zmiana programu i raport właściciela

**What to build:** Właściciel zarządza przyszłymi warunkami i ocenia wykorzystanie programu bez utraty praw klientów.

**Blocked by:** 03 — Nagroda od rezerwacji do wydania.

**Status:** completed

**Spec:** docs/product/loyalty-card-plan.md

- [x] Nowa wersja warunków nie zmienia rozpoczętej karty; wyłączenie zatrzymuje naliczanie, zachowuje odbiór.
- [x] Nie można usunąć obiecanej nagrody ani zmienić waluty przy otwartych kartach; ręczna niedostępność działa.
- [x] Raport pokazuje karty, naliczenia, korekty i wydania, osobno od sprzedaży.
- [x] Testy obejmują zmianę programu, wyłączenie, raporty oraz zakaz konfiguracji przez kasjera.

**Wynik:** kod zintegrowany w feat/loyalty-card; lokalne testy i ograniczenia opisuje docs/product/loyalty-running.md. Bramka natywnego PostgreSQL pozostaje otwarta także dla testów współbieżności.
