# Wersje menu — MM-04

Data: 2026-10-16. Baza etapu: 0bfdd4b. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, code-review. Etap ukończony lokalnie; bez wdrożenia i push.

## Cel

Właściciel i kierownik z `menu.manage` przygotowują zmiany w zapisanym szkicu. Klient oraz kasjer sprzedający nadal widzą opublikowane menu. Podgląd pozwala sprawdzić produkty, kategorie i ceny przed publikacją całego zestawu zmian.

Szkic jest wspólny dla lokalu, nie prywatny dla telefonu. Zapis wymaga aktualnej rewizji szkicu i wersji menu, od której rozpoczęto edycję. Konflikt wymaga ponownego sprawdzenia zmian, zamiast cichego nadpisania pracy innej osoby.

Publikacja ma utworzyć nową, trwałą wersję i zmienić katalog w jednej transakcji. Przywrócenie historycznej wersji przygotowuje szkic do podglądu; dopiero jego publikacja tworzy kolejną wersję. Nie usuwamy historii i nie cofamy numeru wersji.

Szybka zmiana dostępności nadal jest operacją na żywo. Nie może zostać niezauważenie cofnięta przez starszy szkic. Obowiązują dotychczasowe ograniczenia obietnic lojalnościowych. Zapłacone zamówienie i nadal ważna wycena zachowują swój zapis produktów i cen.

## Granice

Ten etap nie wprowadza grup wyborów, zestawów ani automatycznego rozchodu. Następna zależność dla integracji magazynu to MM-06, a potem MM-10b i MM-11. MM-05 (harmonogram dostępności) jest odrębnym zadaniem.

## Scenariusz odbioru

1. Otworzyć Menu jako właściciel; przygotować nowy produkt i zmienić ceny kilku wariantów w szkicu.
2. Na terminalu i w menu klienta sprawdzić, że nadal obowiązuje poprzedni katalog.
3. Zapisać szkic, odświeżyć stronę i sprawdzić trwałość zmian. Obejrzeć podgląd przed publikacją.
4. Opublikować zmiany z powodem. Wszystkie nowe ceny powinny pojawić się razem; ważna wcześniejsza wycena zachowuje starą kwotę.
5. Z dwóch sesji rozpocząć edycję tej samej rewizji. Pierwszy zapis przechodzi, drugi dostaje konflikt zamiast nadpisania.
6. Zmienić dostępność na terminalu po rozpoczęciu szkicu. Stary szkic nie może cofnąć tej zmiany bez jawnego uzgodnienia.
7. Przywrócić starszą wersję do szkicu, obejrzeć podgląd i opublikować jako nową wersję. Dotychczasowa historia pozostaje czytelna.
8. Kierownik bez `menu.manage` nie odczytuje roboczych zmian ani ich nie publikuje. Odebranie uprawnienia działa przy kolejnym żądaniu.

## Kontrakt i uruchomienie

Przed uruchomieniem nowego API zastosować migrację `0022_certain_invisible_woman` po wcześniejszych migracjach. Dotychczasowe produkty pozostają opublikowanym katalogiem. Przed pierwszym nadpisaniem niepustego katalogu zachowujemy jego wcześniejszy snapshot w historii, aby można było wrócić również do menu sprzed tego etapu.

Endpointy są pod `/v1/merchant/venues/:venueId/menu` i wymagają `menu.manage`:

- `GET /` — opublikowane produkty, rewizja i wspólny szkic w jednym spójnym odczycie.
- `PUT /draft` — pełny szkic, oczekiwana rewizja szkicu (null, jeśli go nie ma), bazowa rewizja publikacji, powód i klucz idempotencji.
- `POST /publish` — rewizja szkicu i publikacji, powód i klucz idempotencji. Zmiany oraz nowa wersja zapisują się razem.
- `GET /versions?page=0&limit=20` — historia z paginacją, maksymalnie 100 wpisów na stronę.
- `POST /versions/:versionId/restore` — kopia historycznego menu do szkicu, z kontrolą obu rewizji, powodem i kluczem idempotencji.

Ponowienie z tym samym kluczem i inną treścią jest konfliktem. Uprawnienie jest sprawdzane przed odtworzeniem odpowiedzi. Interfejs po zapisach ponownie pobiera bieżący stan, bo odtworzona odpowiedź wcześniejszej operacji nie musi już opisywać najnowszego menu.

Dotychczasowe API pojedynczego produktu pozostaje zgodne wstecznie i aktualizuje rewizję katalogu. Edycja właściciela i kierownika w aplikacji korzysta już ze szkicu. Zmiany dostępności na żywo również zmieniają rewizję, więc starszy szkic wymaga ponownego sprawdzenia i zapisu. Porównanie pokazuje opublikowane ceny oraz dostępność produktów i dodatków. Usunięcie produktu wskazanego przez historyczny program lojalnościowy jest zachowawczo blokowane; nie usuwamy zobowiązania ani powiązanej historii.

Waluta lokalu jest chroniona po zapisaniu cen, szkicu, wersji lub zobowiązań. Sam odczyt pustego edytora nie blokuje zmiany waluty. Sprawdzanie i zmiana waluty korzystają z tej samej blokady transakcyjnej lokalu co zapis szkicu.

## Wyniki walidacji

Pełna regresja po integracji: **API 238/238, web 198/198, shared 42/42 — razem 478/478**. TypeScript API/web oraz build produkcyjny przechodzą. Build zgłasza nieblokujące ostrzeżenie o głównym pakiecie 633,30 kB; jego podział pozostaje optymalizacją wydajności.

Testy publicznego API sprawdzają m.in. trwały szkic i publikację, odtwarzanie odpowiedzi po ponowieniu, konflikty edycji i dostępności, izolację identyfikatorów między lokalami, uprawnienia kierownika i ich odebranie, walutę, zachowanie opłaconego zamówienia i ważnej wyceny oraz atomowe odrzucenie publikacji naruszającej obietnicę lojalnościową. Sprawdzono także powrót do menu zachowanego przed pierwszą publikacją. Testy UI obejmują zapis bez publikacji, wymagany podgląd, zachowanie lokalnych zmian po konflikcie, stabilne klucze ponowień, historię i przywracanie, edycję zbiorczą oraz odcięcie odpowiedzi poprzedniego konta/lokalu.

### Review Spec

Naprawiono możliwość publikacji szkicu o nieaktualnej zapisanej podstawie po ponownym pobraniu workspace. Porównywana jest również baza zapisana w samym szkicu. Uzupełniono testy niezmienności zamówienia/wyceny, lojalności oraz odebrania dostępu. Ponowny przegląd bez pozostałych konkretnych ustaleń w badanym zakresie.

### Review Standards

Uzupełniono idempotencję zapisu i przywracania szkicu wymaganą w planie; sam konflikt rewizji nie wystarczał do obsługi utraconej odpowiedzi. Poprawiono blokadę waluty po samym odczycie pustego edytora. Interfejs korzysta z kanonicznych typów współdzielonych. Recheck bez pozostałych jednoznacznych naruszeń udokumentowanych reguł. Wskazany przypadek starszych produktów bez menuState również uwzględniono: obecność produktu chroni walutę.

Dodatkowo kontrola integracyjna objęła zmianę waluty pod wspólną blokadą transakcyjną, zachowanie początkowego katalogu w historii i warunkowy upsert produktu, który nie może nadpisać produktu innego lokalu przy równoległym użyciu tego samego UUID.

### Ograniczenia odbioru

Testy bazy korzystają z lokalnego PGlite. Niezależne sesje natywnego PostgreSQL oraz fizyczny Android/Nimiq Pay nadal wymagają odbioru środowiskowego. Nie wdrożono aplikacji i nie wykonano rzeczywistych płatności. Istniejący zmodyfikowany screenshot remote-acceptance.png zachowano poza commitami.
