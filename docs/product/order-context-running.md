# Kontekst realizacji zamówienia — MM-08

Data: 2026-10-16. Baza: 5a89772. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, code-review. Status: ukończone lokalnie; odbiór urządzenia pozostaje otwarty. Bez wdrożenia.

## Zachowanie

Pracownik otwiera kontekst zamówienia w kolejce POS lub online. Widzi wewnętrzną notatkę, ostatni powód opóźnienia, priorytet oraz historię z autorem i czasem. HIGH przesuwa zamówienie przed NORMAL, zachowując kolejność w ramach grupy. Nie zmienia to opłaconej ceny, wyceny, stanu realizacji ani obietnicy czasu.

Notatki i powody nie trafiają do klienta, publicznego checkoutu ani potwierdzenia płatności. Właściciel odczytuje je osobno z listy zamówień. Kasjer może dodawać wpisy podczas własnej otwartej zmiany. Uprawnienia i powiązanie lokalu egzekwuje serwer.

Korekta to nowy wpis; historia nie ma edycji ani usuwania. Priorytet wymaga powodu. Optymistyczna rewizja chroni przed nadpisaniem zmiany innej osoby, a trwały klucz ponowienia przed podwójnym zapisem po utracie odpowiedzi.

## Odbiór

- Notatka, priorytet i opóźnienie zapisują autora oraz czas; kolejne strony pokazują starszą historię.
- HIGH pojawia się na początku odpowiedniej kolejki; ceny i obiecany czas pozostają identyczne.
- Klient ani obcy lokal nie odczytuje kontekstu; nieaktywna sesja i zamknięta zmiana nie zapisują wpisu.
- Identyczne ponowienie daje jeden wpis i audyt; konflikt rewizji nie udaje sukcesu.
- Przełączenie kasjera/lokalu usuwa stary widok i ignoruje jego spóźnione odpowiedzi.

Natywny PostgreSQL oraz fizyczny Android/Nimiq Pay pozostają otwartymi bramkami odbioru projektu.

## API i uruchomienie

Migracja `0025_lying_agent_brand` tworzy osobne podsumowania kontekstu i nieedytowalne wpisy. Nie dodaje notatek do tabeli snapshotów koszyka ani DTO klienta. `GET /v1/merchant/venues/:venueId/order-context?orderIds=...` pobiera zbiorczo maksymalnie 50 podsumowań. Interfejs dzieli większe listy na porcje i odświeża je co 15 sekund. `GET /v1/merchant/venues/:venueId/orders/:orderId/context?page=0&limit=20` udostępnia historię; `POST` pod tym samym adresem zapisuje nowy wpis z rewizją i kluczem.

Nowe wpisy kasjera wymagają otwartej własnej zmiany. Odczyt już utrwalonego potwierdzenia identycznego żądania jest możliwy także po zamknięciu zmiany, po ponownej autoryzacji profilu i lokalu; nie wykonuje nowej mutacji. Utrata odpowiedzi w otwartym panelu zachowuje niezmienny zamiar do ponowienia. Przełączenie profilu czyści formularz. Konflikt odświeża historię i zachowuje tekst do świadomej ponownej decyzji.

## Przegląd dwóch osi

Spec: końcowy przegląd bez otwartych ustaleń. Obejmuje izolację klienta, własną zmianę, idempotencję, rewizję, stabilne priorytety, paginację i integrację trzech widoków. Obserwację starego priorytetu w otwartym panelu poprawiono przez wybór podsumowania z nowszą rewizją.

Standards: brak naruszeń udokumentowanych zasad. Usunięto problem cyklu StrictMode: cleanup unieważniał tożsamość bez przywrócenia w ponownym setup. Test regresyjny wykazał problem, po poprawce przechodzi. Zastąpiono lokalne kopie typów importami wspólnego kontraktu. Ponowny przegląd zamknął obie uwagi.

## Wyniki końcowe

Zintegrowana regresja: API **269/269** na lokalnym PGlite, web **227/227**, shared **48/48** — razem **544/544** unikalne przypadki. TypeScript API/web, build produkcyjny i `git diff --check` przechodzą. Build nadal ostrzega o rozmiarze głównego pakietu, obecnie około 680 kB przed gzip.

Cztery nowe przypadki API obejmują historię i autorów, idempotencję i równoległy konflikt rewizji, ścisłą walidację bez zmian finansowych, uprawnienia i zamknięcie zmiany oraz prywatność trzech rodzajów wpisów w checkoutcie i klienckich endpointach online. Sześć nowych testów React obejmuje zapis/ponowienie, opóźnienie i strony historii, konflikt, zmianę profilu, StrictMode z priorytetami oraz porcjowanie 51 podsumowań i spóźnione odpowiedzi.

Nie wykonano push ani wdrożenia. Nie przeprowadzono odbioru na fizycznym Androidzie/Nimiq Pay ani niezależnych sesjach natywnego PostgreSQL. Dotychczasowa zmiana zrzutu ekranu została zachowana poza commitami tego etapu. Odblokowano MM-09; MM-03 jest także gotowe po lokalnym zakończeniu MM-02.
