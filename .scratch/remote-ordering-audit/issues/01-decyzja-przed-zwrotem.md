# 01: Pełna decyzja o odmowie również przy starszym API

**What to build:** Jako klient otrzymuję jednoznaczną odmowę z powodem, a właściciel zna kasjera i zmianę odpowiedzialne za decyzję.

**Blocked by:** None (can start immediately)

**Status:** completed — poprawki i lokalna regresja zakończone 2026-10-15

**Priorytet:** P2

Ogólna operacja zwrotu nie może przenosić REMOTE z AWAITING_ACCEPTANCE do REFUND_PENDING bez walidacji i zapisu odmowy. Najmniejsza naprawa: zablokować tę ścieżkę i wymagać dedykowanego odrzucenia.

- [x] Opłacone REMOTE przed decyzją nie daje się odrzucić pustym żądaniem ogólnego zwrotu.
- [x] Dedykowana odmowa wymaga aktywnej zmiany i powodu oraz zapisuje aktora, zmianę i czas.
- [x] Ponowienie i konkurencja odmowy z timeoutem tworzą najwyżej jeden obowiązek zwrotu.
- [x] Zwrot po przyjęciu, COUNTER i podpis wyłącznie właściciela działają jak dotąd.
- [x] Test regresyjny obejmuje aktywną i zamkniętą zmianę oraz brak częściowej mutacji przy błędzie.

Współbieżność sprawdzona lokalnie na PGlite. Niezależne sesje natywnego PostgreSQL pozostają bramką zadania 04.
