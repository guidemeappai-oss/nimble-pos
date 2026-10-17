# 01: Program i karta klienta

**What to build:** Właściciel uruchamia program, a zalogowany klient dołącza i widzi własną kartę lokalu.

**Blocked by:** None (można rozpocząć po przeglądzie planu).

**Status:** completed

**Spec:** docs/product/loyalty-card-plan.md

- [x] Właściciel wybiera nagrodę (produkt i wariant bez dodatków) oraz dodatnie minimum zakupowe; próg wynosi pięć pieczątek.
- [x] Klient widzi zasady i dołącza dobrowolnie; karta wraca po ponownym zalogowaniu.
- [x] API izoluje lokal, konto i sieć; publiczny checkout nie ujawnia prywatnej karty.
- [x] Migracja pozostawia stare zamówienia bez zmian; testy API obejmują role i cudze karty.

**Wynik:** kod zintegrowany w feat/loyalty-card; lokalne testy i ograniczenia opisuje docs/product/loyalty-running.md. Bramka natywnego PostgreSQL pozostaje otwarta także dla testów współbieżności.
