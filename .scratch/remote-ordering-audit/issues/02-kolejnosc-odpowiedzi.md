# 02: Odświeżanie nie cofa skutecznej operacji

**What to build:** Jako klient i kasjer widzę wynik ostatniej zakończonej operacji mimo opóźnionego wcześniejszego odczytu.

**Blocked by:** None (can start immediately)

**Status:** completed — poprawki i lokalna regresja zakończone 2026-10-15

**Priorytet:** P2

Unieważnić odczyty rozpoczęte przed mutacją i zabezpieczyć odświeżenie po niej. Sama generacja konta/lokalu nie wystarcza; nie zakładać, że rewizja koszyka wersjonuje wszystkie stany zamówienia.

- [x] Opóźniony GET nie przywraca płatności po anulowaniu.
- [x] Opóźniony GET kolejki nie przywraca prośby po akceptacji/odmowie ani odbioru po wydaniu.
- [x] Błąd mutacji nie zatrzymuje dalszego odświeżania.
- [x] Zmiana konta, zamówienia i lokalu nadal odrzuca cudze odpowiedzi.
- [x] Testy używają kontrolowanej kolejności odpowiedzi, bez przypadkowych opóźnień.
