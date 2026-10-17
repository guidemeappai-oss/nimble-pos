# Zarządzanie lokalem — postęp implementacji

Gałąź integracyjna: feat/merchant-management. Plan: merchant-management-plan.md. Implementacja rozpoczęta od MM-01 na bazie da53a1f; wszystkie 31 zadań nie są jeszcze ukończone.

## MM-01 — kierownik, uprawnienia i dziennik

Cel: właściciel nadaje pracownikowi rolę kierownika i wybrane prawa. Kierownik może edytować menu oraz oglądać raport lokalu i dziennik decyzji wyłącznie w przyznanym zakresie. Wypłaty i nadawanie praw pozostają u właściciela.

Kontrakty: PATCH pracownika z rolą, listą praw i powodem; odświeżenie sesji pracownika; stronicowany dziennik lokalu. Istniejące profile pozostają kasjerami bez nowych uprawnień po migracji. Rejestracja PIN/token nie trafia do dziennika.

Przyszłe magazyn, zadania, zdjęcia i rabaty mają osobne domeny uprawnień, ale samo istnienie nazwy nie oznacza wdrożonego modułu.

## Scenariusz odbioru

1. Właściciel wybiera pracownika w Zespole, nadaje rolę kierownika i prawo do menu z powodem.
2. Na przypisanym telefonie pracownik loguje się dotychczasowym PIN-em i otwiera zarządzanie menu.
3. Zmienia produkt; właściciel widzi autora i zmianę w dzienniku.
4. Właściciel cofa prawo. Kolejna operacja jest odrzucona przez serwer, a odświeżenie sesji usuwa panel uprzywilejowany.
5. Kierownik nie może nadać sobie praw, zmienić portfela lokalu ani zatwierdzić zwrotu.
6. Przełączenie profilu lub lokalu nie pokazuje poprzedniego raportu ani historii.

## Walidacja

MM-01 zakończone lokalnie. Backend: pełna regresja API 205/205 na PGlite; końcowy obszar uprawnień i remote 11/11. Zintegrowany frontend: 166/166. Shared: 42/42. Łącznie 413 przypadków, bez doliczania ponowień. TypeScript API/web i build produkcyjny web przechodzą. Build nadal zgłasza nieblokujące ostrzeżenie o głównym pakiecie około 564 kB.

Testy obejmują delegowanie/cofnięcie w aktywnej sesji, blokadę samodzielnego nadawania praw, wyłączność portfela właściciela, izolację lokalu, wymagany powód, brak sekretów w audycie, brak duplikatu zdarzenia przy identycznej zmianie, odświeżanie dostępu oraz ignorowanie spóźnionego raportu po odebraniu uprawnień. Historia ma stronicowanie z testem wpisu starszego niż pierwsze 50.

## Code review

Standards: brak twardych naruszeń. Wskazano zduplikowane typy kontraktów w UI; zastąpione wspólnymi typami, ponowny przegląd bez uwag.

Spec: wykryto P2 — brak nawigacji do historii starszej niż 50 wpisów. Dodano paginację oraz test zmiany lokalu; ponowny przegląd i 4/4 testy obszaru zaliczone. Brak otwartych ustaleń w przejrzanym zakresie MM-01.

## Uruchomienie i ograniczenia

Przed uruchomieniem nowego kodu API wykonać istniejącą procedurę migracji z migracją 0016_shallow_phalanx. Migracja nadaje istniejącym pracownikom rolę CASHIER i pustą listę nowych praw. Właściciel nadaje kierownikowi prawa w panelu Zespół, z uzasadnieniem. Pracownik otwiera Zarządzanie na telefonie kasowym. Historia decyzji jest dostępna właścicielowi lub kierownikowi z prawem audit.view. Nie ma zmiany portfela ani podpisu wypłat przez kierownika.

Nie wykonano testu urządzenia Android/Nimiq Pay ani niezależnych sesji natywnego PostgreSQL. Nie wdrożono kodu na serwer ani nie wykonano push. Istniejąca zmiana screenshotu remote-acceptance.png została zachowana poza commitami implementacji.

## Dalsze etapy

MM-19 i MM-20 ukończone lokalnie: checklisty, zgłoszenia, prywatne zdjęcia i odbiór kierownika. Szczegóły, 435 sprawdzonych przypadków oraz otwarte bramki urządzenia i storage: [staff-tasks-running.md](staff-tasks-running.md).

Pierwotny etap zakończył MM-01, MM-19 i MM-20. Kolejne ukończone lokalnie zakresy opisano poniżej; MM-21 nadal nie jest wdrożone, a bramka środowiskowa MM-11 pozostaje otwarta. MM-08 ukończono w kolejnym etapie opisanym poniżej; MM-27 pozostaje gotowe do podjęcia.

## Magazyn MM-10a — ukończony lokalnie

Ręczne zasoby, stany otwarcia, progi, ruchy i odwrócenia są dostępne w telefonie. Pełna regresja: 443/443, TypeScript i build zaliczone. [Instrukcja i wyniki](inventory-running.md). Pełne MM-10 nadal wymaga 10b (powiązań z wariantami/zestawami), a MM-11 odpowiada za automatyczny rozchód i rezerwacje. MM-12/MM-13 zrealizowano w kolejnym etapie na istniejącym dzienniku. MM-21 wymaga także MM-11, aby stan oczekiwany obejmował faktyczne sprzedaże.

## Dostawy i rozliczanie zapasu — MM-12 / MM-13

Dodano dostawców, częściowe przyjęcia i ich korekty, osobne uprawnienie do cen zakupu, kody z obsługą aparatu, spisy z punktem odniesienia oraz straty zatwierdzane według progu właściciela. [Instrukcja i odbiór](stock-operations-running.md). Integracja ze sprzedażą i dostępnością menu pozostaje w MM-10b/MM-11.

## Wersje menu — MM-04

Właściciel i uprawniony kierownik zapisują wspólny szkic, zmieniają zbiorczo ceny i kategorie, sprawdzają podgląd, publikują cały katalog i przywracają starszą wersję do szkicu. Konflikty oraz utrata odpowiedzi mają obsługę rewizji i idempotencji. [Instrukcja i wyniki](menu-versions-running.md). Odblokowano MM-05 i MM-06; ścieżka do wspólnego zapasu prowadzi dalej przez MM-06 → MM-10b → MM-11.

## Grupy wyborów i zestawy — MM-06

Wspólne reguły POS i online obsługują obowiązkowe wybory, min/max i dopłaty. Zestaw ma własną cenę, stałe oraz wybrane składowe i niezmienny zapis w zamówieniu. Zakup zestawu nie nalicza osobnych pieczątek za składowe. [Instrukcja i odbiór](menu-bundles-running.md). Odblokowano MM-10b: przypisanie wariantów i składowych do wspólnych zasobów; automatyczny rozchód nadal czeka na MM-11.

## Wspólne zasoby menu — MM-10b

Warianty i dodatki mogą wskazywać zasoby lokalu. Zestawy wyliczają wymagania ze składowych raz, a checkout zachowuje niezmienny snapshot. Pełna regresja: API246, web207, shared48, razem501/501. TypeScript i build przechodzą. [Instrukcja i wyniki](stock-bindings-running.md). MM-10 ukończone lokalnie; MM-11 nadal odpowiada za atomową rezerwację, rozchód i osobną ścieżkę nagród.

## Rezerwacje i rozchód — MM-11, odbiór środowiskowy otwarty

Dodano atomową rezerwację przy wycenie, utrzymanie zgłoszonej wpłaty, rozchód POS/zaakceptowanego REMOTE i nagrody, zwalnianie niewykorzystanego zapasu oraz ochronę korekt. Pełna regresja lokalna: API259, web212, shared48 — razem519/519. TypeScript i build przechodzą. [Instrukcja, ograniczenia i odbiór](stock-reservations-running.md). Bramka natywnego PostgreSQL oraz fizyczny Android/Nimiq Pay pozostają niewykonane; nie zamykamy tego kryterium MM-11 i nie wdrażamy. MM-24 ma doprecyzowaną obsługę nierozstrzygniętych wpłat blokujących zapas.

## Lokal teraz i centrum wyjątków — MM-02 / częściowe MM-24

Pulpit rozdziela otrzymane aktywa od zaakceptowanej sprzedaży, pokazuje kolejkę, opóźnienia, zmiany, ostatni sygnał terminala i zwroty. Centrum utrwalonych zgłoszeń ma filtry, diagnostyki, wznawialną weryfikację oraz wyłączną decyzję właściciela o odrzuceniu realizacji i zwolnieniu zapasu. Późna wpłata nadal prowadzi do zwrotu, nigdy do realizacji bez towaru. [Zakres, przegląd i odbiór](merchant-operations-running.md). MM-24 pozostaje częściowe: nie dodano skanera niezgłoszonych wpłat całego portfela ani definitywnej klasyfikacji błędnej transakcji przy braku potwierdzenia adaptera.

Walidacja tego etapu: API265 + web221 + shared48 = **534/534**; TypeScript i build przechodzą. Cztery błędy wykryte w dwóch osiach przeglądu poprawiono i sprawdzono ponownie. Migracja `0024_polite_stellaris` wymagana przed uruchomieniem nowego API; bez wdrożenia.

## Kontekst realizacji — MM-08

Priorytety NORMAL/HIGH, wewnętrzne notatki i powody opóźnienia mają autora, czas oraz nieedytowalną historię. POS, zamówienia online i widok właściciela korzystają z osobnego zasobu pracowniczego; klient nie otrzymuje notatek. Zapis chronią rewizja, trwała idempotencja i własna otwarta zmiana kasjera. Wycena i obiecany termin pozostają niezależne od kolejności. [Zakres, odbiór i wyniki](order-context-running.md).

Regresja: API269 + web227 + shared48 = **544/544**, TypeScript i build przechodzą. Dwie osie przeglądu zamknięte bez otwartych ustaleń po poprawkach cyklu StrictMode, świeżości podsumowania i wspólnych typów. Migracja `0025_lying_agent_brand` wymagana przed uruchomieniem; bez wdrożenia. MM-09 i MM-03 są gotowe do podjęcia.

## Gotowość pozycji — MM-09

Kasjer zapisuje gotowość każdej sztuki względem niezmiennego koszyka; całość zmienia się na READY tylko po przygotowaniu wszystkich pozycji. Jedno powiadomienie trafia do istniejącego outboxa, odbiór QR pozostaje jednorazowy, a status nie wywołuje drugiego rozchodu. [Zakres i wyniki](order-readiness-running.md).

Regresja: API275 + web234 + shared48 = **557/557**, TypeScript i build przechodzą. Dwie osie przeglądu bez otwartych ustaleń. Migracja `0026_workable_thor_girl` wymagana przed uruchomieniem.

## Tryb dużego ruchu — MM-03

Właściciel konfiguruje domyślny czas przygotowania i maksymalną liczbę aktywnych miejsc kolejki. Kasjer może wstrzymać nowe zamówienia na 15, 30, 60 lub 120 minut. Termin pauzy jest zapisany w `merchant_venue`; po jego upływie lokal nadal czeka na jawne wznowienie. Wznowienie wymaga aktywnej zmiany i heartbeat’u terminala młodszego niż 60 sekund. Endpoint nie tworzy heartbeat’u przy włączeniu.

Kolejka liczy weryfikowane płatności, opłacone zamówienia oczekujące na decyzję kasjera oraz pozycje PREPARING/READY. Aktywna wycena w AWAITING_PAYMENT rezerwuje miejsce do wygaśnięcia; nieopłacony koszyk bez aktywnej wyceny nie zajmuje limitu. Nowe zamówienia i nowe wyceny są sprawdzane pod blokadą wiersza lokalu, więc równoległe checkouty nie zajmują tego samego ostatniego miejsca. Odczyt już aktywnej wyceny następuje przed gate’em i zachowuje wcześniejszą kwotę także po pauzie lub zapełnieniu kolejki. Termin zaakceptowanego zamówienia pozostaje zapisany na zamówieniu i nie zmienia go edycja domyślnego czasu.

API: `PATCH /v1/merchant/remote/venues/:venueId/settings` przyjmuje `queueLimit` 1–100 wraz z domyślnym czasem przygotowania; `PATCH /availability` przyjmuje `{ accepting, pauseMinutes? }`, z pauzą 1–240 minut. `GET` zwraca limit, `activeOrders` oraz `pausedUntil`. Migracja `0027_busy_order_controls` dodaje trwały limit i termin pauzy.

Walidacja: API 277/277 przez lokalny harness PGlite, web 236/236 i shared 48/48 — razem **561/561**; TypeScript API/web i produkcyjny build przechodzą. Build zachowuje ostrzeżenie o głównym pakiecie JS powyżej 500 kB. Code review po scaleniu zakończono po poprawkach, bez otwartych ustaleń. Natywny PostgreSQL i urządzenie Android/Nimiq Pay nie były używane. Bez push ani wdrożenia.

Code review MM-03: poprawiono ponowne zamknięcie lokalu bez `pauseMinutes`, które wcześniej mogło wyczyścić aktywny termin pauzy. Regresja potwierdza zachowanie terminu i dalszą blokadę wznowienia przed jego upływem. Wspólne liczenie zajętości kolejki zostało wydzielone do serwisu używanego przez publiczny status lokalu i tworzenie nowych wycen; obejmuje również płatności `PAYMENT_PENDING`.

## Grafik — MM-27 / PL-01

Grafik i zastępstwa scalone lokalnie. API281/281, web242/242, shared48/48, typy i build przechodzą. Poprawiono retry, stare odpowiedzi, izolację profili oraz serializację publikacji. Szczegóły: [scheduling-running.md](scheduling-running.md). Natywna baza i telefon pozostają otwarte.
