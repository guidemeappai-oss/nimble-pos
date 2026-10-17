# Rezerwacje i rozchód — MM-11

Data: 2026-10-16. Baza: 8b14a56. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, code-review. Status: implementacja i testy lokalne zakończone; odbiór natywnego PostgreSQL otwarty. Bez wdrożenia.

## Cykl zapasu

Wymagania zasobów pochodzą z zamrożonego zapisu checkoutu MM-10b. Wycena zajmuje dostępne ilości śledzonych zasobów w jednej transakcji. Fizyczny stan nie zmienia się podczas rezerwacji. Ponowienie tej samej wyceny nie zajmuje towaru drugi raz. Dostępna ilość uwzględnia aktywne rezerwacje i zgłoszone straty oczekujące na decyzję.

Zgłoszenie płatności podczas ważnej rezerwacji utrzymuje ją do rozstrzygnięcia weryfikacji. Nie wolno po samym upływie czasu zwolnić zapasu z nierozstrzygniętą płatnością. Przy kasie zweryfikowana płatność przechodzi do przygotowania i rozchoduje towar. Zamówienie zdalne zachowuje zapas do decyzji kasjera: akceptacja rozchoduje, odrzucenie lub timeout zwalnia niezużyty zapas i pozostawia obowiązek zwrotu.

Późny przelew bez skutecznej rezerwacji nie może odebrać towaru innemu klientowi ani wytworzyć ujemnego salda. Prowadzi do istniejącego procesu zwrotu przez właściciela. Zwrot po rzeczywistym rozchodzie nie odtwarza produktu fizycznego.

Ręczne korekty, straty, spisy i odwrócenia przyjęć nie mogą zmniejszyć salda poniżej aktywnie zarezerwowanej ilości. Osobna realizacja darmowej nagrody także musi sprawdzić i rozchodować zasoby atomowo, bez utraty pieczątek przy odmowie i bez ponownego odjęcia przy retry.

## Odbiór natywnego PostgreSQL

Lokalny PGlite służy regresji, lecz nie potwierdza współbieżności niezależnych sesji PostgreSQL. Przed wdrożeniem wymagana jest bramka:

`NATIVE_STOCK_TEST_DATABASE_URL=postgres://…/nimble_stock_test node scripts/test-stock-native.mjs`

Adres musi wskazywać osobną bazę kończącą się `_test`. Fixture testów migruje i czyści dane tej bazy. Skrypt sprawdza dwa niezależne backendy oraz odrzuca środowisko WASM/PGlite; nie przełącza się na atrapę. Następnie uruchamia publiczne scenariusze API rezerwacji i nagród. Nie został uruchomiony przeciw zewnętrznej bazie w tej sesji.

Odbiór fizycznego Androida/Nimiq Pay nadal obejmuje płatność, wznowienie po utracie połączenia, potwierdzenie zamówienia zdalnego i wyświetlenie właściwego stanu rezerwacji. Nie deklarujemy gwarantowanego powiadomienia systemowego.

## Rozstrzygnięcia operacyjne

Decyzja o śledzeniu jest utrwalana przy wycenie. Wyłączenie śledzenia później nie usuwa starej rezerwacji ani jej rozchodu; zasób bez śledzenia nie tworzy klientowi obietnicy zarezerwowanej porcji. Przy włączaniu śledzenia i przy wdrożeniu należy najpierw zakończyć stare wyceny oraz przelewy w toku. Nie odtwarzamy wstecz historycznych ruchów magazynu. Opłacone zamówienie zdalne sprzed wdrożenia, które nie ma wymaganej rezerwacji, nie może ominąć ochrony zapasu przez akceptację — trafia do procesu zwrotu.

Limit aktywnych rezerwacji wynosi 10 na aktora i 100 na lokal. Puste decyzje dla zasobów bez śledzenia nie zajmują tego budżetu. Nierozstrzygnięty zgłoszony hash pozostaje konserwatywnie zablokowany do weryfikacji; nie ma automatycznego zwolnienia, które mogłoby sprzedać porcję po otrzymaniu pieniędzy. Obsługę zgłoszonych wyjątków i jawnej decyzji właściciela dodano w MM-24: [centrum wyjątków](merchant-operations-running.md). Właściciel może odrzucić realizację i zwolnić zapas; późniejsza wpłata pozostaje monitorowana i prowadzi do zwrotu. Nie dodano przycisku kasjera zwalniającego zapas z nierozstrzygniętą wpłatą.

Ruch `SALE` zawiera rzeczywistego pracownika realizującego sprzedaż lub przyjmującego nagrodę; identyfikator zamówienia jest powodem ruchu. Nie przypisujemy klientowi roli kasjera. Dostępność strony magazynu jest liczona zbiorczo z aktywnych rezerwacji i oczekujących strat, bez ponownego odczytywania zamkniętej historii dla każdego zasobu.


## Uruchomienie i zgodność

Nowe API wymaga migracji `0023_sad_celestials` po wcześniejszych migracjach. Dodaje ona trwałe rezerwacje powiązane z zamówieniem i wyceną oraz snapshot zasobów nagrody. API i web należy wydać razem. Wdrożenie oraz powrót do starszego API wymagają zakończenia aktywnych wycen i przelewów w toku; nie cofamy obsługi rezerwacji pod aktywnymi płatnościami.

GET magazynu i wyszukiwanie po kodzie zwracają osobno `quantity`, `reservedQuantity`, `pendingLossQuantity`, `availableQuantity`. Status `stockReservation` w zamówieniu pochodzi z serwera: NONE, HELD, EXPIRED, RELEASED lub CONSUMED. `expiresAt=null` przy HELD oznacza utrzymanie do weryfikacji/rozstrzygnięcia, a nie nieskończony licznik klienta. Zasób bez śledzenia nie otrzymuje obietnicy rezerwacji.

## Testy i przeglądy

Pełna regresja scalonego kodu: **API259/259, web212/212, shared48/48 — razem519/519**. TypeScript API/web i build produkcyjny przechodzą. Build ma nieblokujące ostrzeżenie o pakiecie głównym652,95kB; podział pozostaje optymalizacją. Skrypt odbioru natywnego przeszedł kontrolę składni i odmawia działania bez jawnej konfiguracji; nie wykonano testu na natywnym PostgreSQL.

Testy publicznego API obejmują: dokładnie jednego zwycięzcę konkurencji POS/REMOTE, konkurencję z nagrodą, wygaśnięcie i późną wpłatę, utrzymanie niezweryfikowanego hasha, idempotencję płatności, zmianę śledzenia po wycenie, akceptację/odrzucenie/timeout REMOTE, limity, ochronę ręcznych korekt i oczekujących strat, starsze opłacone zamówienie bez rezerwacji oraz zwalnianie rezerwacji innej wyceny po rozliczeniu zwycięskiego przelewu. Nagroda bez zapasu zachowuje pieczątki i możliwość ponowienia.

### Spec

Poprawiono autora rozchodu zdalnego: zapisywany jest przyjmujący pracownik, nie klient. Test trójstronnego wyścigu początkowo dawał fałszywie dodatni wynik, bo zdalny klient wysyłał cudzy adres i przegrywał przez PAYER_MISMATCH. Wzmocniona asercja najpierw wykazała ten błąd; po poprawieniu nadawcy każdy przegrany musi mieć INSUFFICIENT_STOCK. Test przeszedł w pełnej regresji PGlite. Końcowy recheck bez pozostałych ustaleń; kryterium natywnego PostgreSQL pozostaje jawnie otwarte.

### Standards

Poprawiono dwie uwagi P2: rzeczywisty autor ruchu SALE oraz zbiorczy odczyt dostępności z filtrami aktywnych danych w SQL. Ponowny przegląd bez pozostałych ustaleń wymagających poprawy. Kontrola integracyjna objęła również nieodtwarzanie rezerwacji po wygaśnięciu, zachowanie pustej decyzji śledzenia, usuwanie osieroconych rezerwacji innych wycen i poprawne rozliczenie oczekującej straty bez podwójnego odejmowania.

Wynik lokalny nie zastępuje niewykonanego testu niezależnych sesji PostgreSQL ani fizycznego Androida. Nie wykonano rzeczywistych płatności, wdrożenia lub push. Istniejący zmodyfikowany screenshot remote-acceptance.png zachowano poza commitami.
