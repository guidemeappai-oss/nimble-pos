# Rozliczenie jedzenia — PL-03/04

2026-10-16. Implementacja lokalna; PL-02 nadal acceptance-blocked. Użytkownik polecił kontynuację pozostałych funkcji; otwarta bramka bazy nie zostaje oznaczona jako zaliczona.

Rozszerzono istniejący spis bez nowej tabeli: strefa IANA, godzina granicy dnia, wyliczona data operacyjna, snapshot zapasu i rezerwacji, policzona ilość/różnica i podział keep/disposal/donation/staffMeal. Suma podziału musi odpowiadać ilości policzonej. Późniejsze ruchy wymagają jawnego uzgodnienia bieżącej rewizji; korekta dotyczy snapshotu. Nakładające się spisy pozostają blokowane. Przekazanie i posiłki odpisują zapas; podlegają łącznie z niedoborem istniejącemu progowi zgody właściciela.

Utylizacja tworzy powiązaną stratę PENDING oraz jednorazowe zadanie z wymaganymi zdjęciami przed/po. Ilość jest natychmiast wyłączona ze sprzedaży, ale ruch LOSS następuje dopiero po zatwierdzeniu zadania i decyzji właściciela. Istniejący prywatny storage, normalizacja zdjęć,30-dniowa retencja i jawny wyjątek właściciela są ponownie wykorzystane. Odrzucenie dokumentacji pozostawia PENDING i blokadę; nie przywraca towaru. Opcjonalny świadek musi być aktywny, z tego samego lokalu i inny niż zgłaszający; deklaracja świadka nie jest jego osobnym podpisem. Audyt zachowuje decyzje.

UI: Magazyn → spisy → rozliczenie jedzenia; straty → dokumentacja zdjęciowa utylizacji zawiera powiązane zadanie i obsługę zdjęć. Publiczne API i JSON spisu zachowują zgodność ze zwykłymi spisami.

Weryfikacja lokalna: API inventory-operations+stock-reservations30/30, UI stock-operations/staff-tasks/task-photos17/17. Nowe przypadki: podział i retry, niezgodna suma/overlap, utrzymanie blokady po odrzuceniu, zdjęcia przed/po, wyjątek właściciela, równoczesne zatwierdzenia i konkurencja ostatniej porcji POS kontra utylizacja. Test kalendarza obejmuje północ oraz oba przejścia DST. Współbieżność na PGlite nie stanowi odbioru natywnego PostgreSQL.

Rozszerzony test Chromium z rzeczywistym API przeszedł wraz z całym zestawem9/9 E2E: rozliczenie, zdjęcia przed/po, deklaracja właściciela, zatwierdzenie straty i zamknięcie dnia. Nie wykonano testu fizycznej kamery ani natywnego PostgreSQL.
