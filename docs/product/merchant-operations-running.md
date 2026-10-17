# Lokal teraz i wyjątki płatnicze — MM-02 / MM-24

Data: 2026-10-16. Baza: 5b17de2. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, code-review. Status: MM-02 ukończone lokalnie; MM-24 ukończone lokalnie w opisanym zakresie zgłoszeń, pierwsze kryterium pozostaje częściowe. Bez wdrożenia.

## Widok operacyjny

Właściciel widzi kolejkę, opóźnienia przygotowania, otwarte zmiany, ostatni sygnał terminala i sprawy wymagające zwrotu. Kierownik otrzymuje podgląd tylko według nadanych uprawnień; nie otrzymuje uprawnień do zwalniania nierozstrzygniętych płatności ani wydawania pieniędzy.

Okno podsumowania to jawne ostatnie 24 godziny, nie nieokreślone „dzisiaj” bez strefy lokalu. Otrzymane wpłaty są pokazywane w oryginalnych aktywach. Sprzedaż obejmuje realizacje przyjęte przez lokal, a nie każdą wpłatę. Przelew do odrzuconego, anulowanego lub spóźnionego checkoutu nie staje się sprzedażą tylko dlatego, że wpłynęły środki.

Sygnał terminala opisuje ostatnią uwierzytelnioną komunikację aplikacji. Nie jest potwierdzeniem fizycznej obecności pracownika. Otwarta zmiana pozostaje osobną informacją. Brak świeżego odczytu pokazuje czas ostatnich poprawnych danych; awaria nie zmienia liczb na zero. Zmiana konta lub lokalu usuwa poprzedni widok i odrzuca spóźnione odpowiedzi.

## Centrum wyjątków

Centrum dotyczy utrwalonych zgłoszeń przelewów i zobowiązań do zwrotu. Nie jest nowym skanerem wszystkich niepowiązanych wpłat na adres portfela. Sam hash ani brak zgodnego potwierdzenia nie oznaczają sukcesu, porażki transakcji lub oszustwa klienta. Stany i błędy są opisywane wyłącznie na podstawie dostępnych danych.

Właściciel filtruje sprawy według aktywa, wieku i rodzaju, widzi powiązane zamówienie, próby i zablokowany zapas. Ponowna weryfikacja korzysta z istniejącego adaptera odczytu blockchain i ma trwały limit oraz idempotencję. Nie podpisuje przelewu i nie inicjuje wypłaty.

Dla płatności nadal nierozstrzygniętej właściciel może z uzasadnieniem odrzucić realizację i zwolnić rezerwację. Decyzja jest trwała: później potwierdzony przelew prowadzi do obowiązku zwrotu, a nie do realizacji bez zapasu. Zamówienie pozostaje monitorowane. Jeżeli potwierdzenie i realizacja wygrały wyścig wcześniej, decyzja jest odrzucana i nie przywraca fizycznego towaru. Kasjer ani kierownik nie mają tego działania.

Każde działanie ma autora, powód i stabilny klucz ponowienia. Utracona odpowiedź nie powiela zwolnienia ani audytu. Zatwierdzanie zwrotu nadal korzysta z dotychczasowego podpisu właściciela w portfelu i istniejącej obsługi wznowienia.

## Odbiór

1. Otworzyć lokal właściciela, potem konto kierownika z reports.view i konto bez tego prawa. Sprawdzić zakres danych i brak działań właściciela u pracowników.
2. Przyjąć wpłatę zdalną bez akceptacji. Pokazać ją jako otrzymane środki, nie sprzedaż. Po akceptacji pojawia się sprzedaż; po odrzuceniu zobowiązanie do zwrotu.
3. Wywołać utratę sieci: widok zachowuje ostatnie liczby, oznacza brak świeżych danych i pokazuje czas aktualizacji.
4. Utworzyć nierozstrzygniętą płatność z rezerwacją. Właściciel odrzuca realizację z powodem: dostępny zapas wraca, ale monitor wpłaty pozostaje aktywny.
5. Potwierdzić tę wpłatę później. Stan przechodzi do zwrotu, a zapas nie jest ponownie rezerwowany ani rozchodowany.
6. Powtórzyć działanie po utracie odpowiedzi oraz równolegle z potwierdzeniem wpłaty; sprawdzić pojedynczy wynik i właściwy autor audytu.

Bramka niezależnych sesji natywnego PostgreSQL z MM-11 i fizyczny Android/Nimiq Pay pozostają wymagane przed wdrożeniem.

## Zakres i otwarte zależności

MM-02 obejmuje podgląd i przejścia do istniejących działań. MM-24 w tym etapie obejmuje zgłoszone próby oraz istniejące zobowiązania do zwrotu. Pierwotne kryterium wszystkich niedopasowanych i błędnych wpłat pozostaje częściowe: brak indeksowania niezgłoszonych wpłat całego portfela, a adapter bez potwierdzenia nie pozwala rozróżnić transakcji odrzuconej od jeszcze niewidocznej. Nie nazywamy takich prób błędnymi ani nie oznaczamy tego kryterium jako ukończonego.

Odrzucenie realizacji zapisuje decyzję, zwolnienie zapasu, audyt i wynik operacji w jednej transakcji. Ponowna weryfikacja używa trwałej dzierżawy; po jej wygaśnięciu ten sam klucz może wznowić pracę. Zewnętrzne sprawdzanie przelewu odbywa się poza blokadą zamówienia. Stary wykonawca nie może nadpisać wyniku nowego.

## Przegląd zmian względem 5b17de2

Oś Spec: wykryto trzy błędy — pominięcie potwierdzonych zwrotów odrzuconych zamówień w raporcie, brak ręcznej weryfikacji po odrzuceniu realizacji nierozstrzygniętej wpłaty oraz uwzględnianie wygasłych rezerwacji w podglądzie blokady. Wszystkie trzy poprawiono; niezależny ponowny przegląd nie zgłosił otwartych ustaleń w tym zakresie.

Oś Standards: wykryto jeden błąd — stary wykonawca po utracie dzierżawy mógł zwrócić lokalny wynik COMPLETE, mimo że zapis został odrzucony przez warunek leaseToken. Poprawiono przez UPDATE RETURNING oraz odczyt utrwalonego wyniku albo PENDING; ponowny przegląd potwierdził usunięcie naruszenia. Dwie uwagi projektowe dotyczyły łączenia cykli życia obu działań i użycia string zamiast istniejących typów domenowych. Typy statusu, źródła i celu zawężono do kontraktów domenowych. Rozdzielenie funkcji obu działań pozostaje nieblokującą uwagą projektową.

## Uruchomienie

Przed uruchomieniem API zastosować migrację `0024_polite_stellaris`: tabela zamiarów operacji, dzierżawy weryfikacji, czas sygnału terminala oraz bezpieczne diagnostyki prób płatniczych. Nie zawiera kluczy portfela ani nowej usługi podpisującej.

Panel właściciela: Przegląd → bieżący lokal; Płatności → wyjątki. Kierownik z `reports.view`: Zarządzanie → podgląd. Przyjmowanie i przygotowanie zamówień nadal odbywa się na sparowanym terminalu. Weryfikacja właściciela jest ograniczona do 10 nowych zamiarów na minutę dla lokalu i jednego na 30 sekund dla zamówienia. Aktywna dzierżawa trwa 60 sekund; ponowienie tego samego klucza po jej wygaśnięciu wznawia pracę bez nowego zamiaru lub audytu.

Skrypt `scripts/test-stock-native.mjs` obejmuje teraz również wyścig odrzucenia realizacji z potwierdzeniem wpłaty. Wymaga wskazania izolowanej bazy testowej natywnego PostgreSQL. Nie uruchamiano go na zewnętrznej bazie.

## Wyniki końcowe

Po scaleniu API, interfejsu i poprawek przeglądu: pełne API **265/265** na lokalnym PGlite, web **221/221**, shared **48/48** — **534/534** unikalne przypadki. TypeScript API/web oraz produkcyjny build web przechodzą. Build zgłasza istniejące ostrzeżenie rozmiaru głównego pakietu, teraz około 672 kB przed gzip. `git diff --check` i składnia skryptu bramki natywnej przechodzą.

Pierwszy pełny przebieg API ujawnił jedną nieaktualną asercję `merchantRecovery`: spóźniona wpłata była traktowana jako sprzedaż. Test poprawiono na gross=0, net=0, received=1020, zachowując pierwotny snapshot 1020 wobec zmienionego koszyka 510. Po sprawdzeniu 8/8 testów tego pliku ponowiono pełne API, uzyskując 265/265.

Regresje obejmują aktualne uprawnienia i izolację lokalu, faktyczny czas potwierdzenia i snapshot sprzedaży, brak podwójnego zwrotu/rozchodu, aktywną i wygasłą dzierżawę oraz utratę jej tokenu podczas odczytu adaptera, równoległe odrzucenie realizacji i potwierdzenie wpłaty, pojedynczy audyt oraz identyczny utrwalony wynik ponowienia. Interfejs sprawdza zachowanie ostatnich danych, spóźnione odpowiedzi, filtry, odtworzenie zamiaru i ponowną weryfikację po odrzuceniu realizacji.

Nie wykonano push, wdrożenia, podpisu transakcji ani testów na prawdziwych środkach. Natywny PostgreSQL i fizyczny Android/Nimiq Pay nadal wymagają odbioru.
