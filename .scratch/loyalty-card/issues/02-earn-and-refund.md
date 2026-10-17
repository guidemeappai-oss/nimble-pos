# 02: Pieczątka po zakupie i korekta zwrotu

**What to build:** Klient otrzymuje jedną pieczątkę za kwalifikujący zakup; zwroty są widoczne na karcie.

**Blocked by:** 01 — Program i karta klienta.

**Status:** completed

**Spec:** docs/product/loyalty-card-plan.md

- [x] QR oraz kod wiążą kartę z uwierzytelnionym klientem przed wyceną; powiązanie jest zamrożone w rewizji.
- [x] NIM wymaga zgodności konta; USDT wymaga zweryfikowanego powiązania adresu EVM, bez zaufania do nimAddress.
- [x] Naliczanie jest atomowe z potwierdzeniem płatności, idempotentne i oparte o opłacony snapshot.
- [x] Zamówienia niespełniające minimum i obowiązkowo zwracane nie naliczają punktu.
- [x] Żądanie zwrotu blokuje punkt; potwierdzenie dopisuje korektę raz i pokazuje przyczynę.
- [x] Testy obejmują powtórzenia, restart, konkurujące rozliczenia i nieuprawnione powiązanie klienta.

**Wynik:** kod zintegrowany w feat/loyalty-card; lokalne testy i ograniczenia opisuje docs/product/loyalty-running.md. Bramka natywnego PostgreSQL pozostaje otwarta także dla testów współbieżności.
