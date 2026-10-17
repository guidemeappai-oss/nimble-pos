# 04: Odbiór napraw i bramek uruchomienia

**What to build:** Jako właściciel uruchamiam zamówienia po sprawdzeniu rzeczywistej bazy, portfela i telefonu.

**Blocked by:** 01, 02, 03

**Status:** blocked — oczekuje na natywny PostgreSQL i fizyczny Android/Nimiq Pay

**Priorytet:** bramka wydania, nie potwierdzony błąd

Połączyć regresję napraw z pozostającym odbiorem operacyjnym. Przygotowanie niezależnych testów może zacząć się wcześniej; końcowy odbiór zależy od trzech napraw.

- [x] Testy API/web/shared, TypeScript i build przechodzą po naprawach.
- [ ] Natywny PostgreSQL: oddzielne sesje konkurują accept/reject/timeout oraz dwa odbiory; jeden wynik i jeden refund.
- [ ] Android/Nimiq Pay: logowanie, powrót z podpisu, NIM/USDT, odzyskanie zamówienia i kamera przechodzą w uzgodnionym środowisku testowym.
- [ ] Zmiana kasjera, brak sieci i restart workera zachowują obowiązki lokalu.
- [ ] Zapisać wersję aplikacji, środowisko, wyniki i pozostałe ograniczenia; brak wyniku nie jest zaliczeniem.
- [ ] Publikacja i rzeczywiste płatności wymagają osobnego działania operacyjnego; flaga pozostaje wyłączona do odbioru.
