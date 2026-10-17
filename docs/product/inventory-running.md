# Podstawowy magazyn — MM-10a

Aktualizacja: późniejszy etap [MM-11](stock-reservations-running.md) dodaje rezerwacje i rozchód; poniższy opis dotyczy wcześniejszego etapu.

Data: 2026-10-16. Gałąź integracyjna: feat/merchant-management. Skills: implement-spec, implement, tdd, code-review. Baza etapu: 25b01cd. MM-10a ukończone lokalnie, bez wdrożenia lub push.

## Dostępne funkcje

Właściciel i kierownik z inventory.manage tworzą zasoby gotowych sztuk/porcji, podają nazwę, stan otwarcia i próg ostrzegawczy. Zasób jest oddzielony od produktu menu. Jednostka po utworzeniu nie zmienia się. Można zmienić nazwę, próg i flagę ewidencji; wyłączenie nie usuwa salda ani historii. W tej wersji ilości są całkowite, bez kilogramów i litrów.

Pracownicy przypisanego terminala odczytują stan oraz historię własnego lokalu; korekty i ustawienia wymagają osobnego uprawnienia. Uprawnienia są odczytywane na nowo przy kolejnych żądaniach. Interfejs usuwa dane przy zmianie konta/lokalu i nie przywraca historii starego zasobu po spóźnionej odpowiedzi.

Stan otwarcia i każda korekta mają trwały ruch z autorem, czasem i powodem. Odwrócenie tworzy nowy przeciwny wpis, nie usuwa oryginału. Jest możliwe tylko raz, nie dotyczy kolejnego odwrócenia i nie może prowadzić do ujemnego salda. Przykład: 24 otwarcia, -3 korekty, +10 uzupełnienia daje 31. Odwrócenie błędnego -3 daje 34; obie operacje pozostają widoczne.

Mutacje salda mają idempotencję, kontrolę rewizji i blokadę zasobu. Ponowienie tego samego żądania nie zmienia ilości drugi raz; ten sam klucz z inną treścią daje konflikt. Ustawienia chroni aktualna rewizja; nieaktualny szkic nie nadpisuje nowszej zmiany. Ilości i progi są ograniczone do zakresu int32, a wynik dodawania sprawdzany przed zapisem. Także migracja definiuje sprawdzenia nieujemnej ilości/progu, poprawnej jednostki i dodatniej rewizji.

Lista zasobów i historia mają paginację po 50 wpisów (API maks. 100). Historia pokazuje odwrócenie także wtedy, gdy sam ruch przeciwny jest na innej stronie. Nie ma usuwania ruchów przez API.

## Ważna granica etapu

To ręczna ewidencja. POS i zamówienia zdalne jeszcze nie rezerwują ani nie odejmują tego zapasu. W aplikacji jest jawny komunikat. Nie blokujemy sprzedaży na podstawie niepełnej ewidencji i nie deklarujemy ochrony ostatniej porcji. MM-10b połączy warianty/zestawy ze wspólnymi zasobami, a MM-11 doda rezerwacje i automatyczny rozchód. Dostawy, koszty zakupu, spisy i zatwierdzanie strat dodaje kolejny etap MM-12/MM-13 opisany w [instrukcji operacji](stock-operations-running.md). Receptury i rozliczenie końca dnia pozostają kolejnymi etapami.

## Uruchomienie i demonstracja

Przed uruchomieniem nowego API zastosować migrację 0020_tough_terrax przez istniejącą procedurę migracji. Istniejące lokale startują bez zasobów; nie odtwarzamy ilości z dawnych zamówień.

1. Właściciel w Zespole nadaje kierownikowi inventory.manage z powodem.
2. W Magazynie tworzy „Gotowe kanapki”, jednostka sztuki, stan otwarcia 24 i próg 5, z uzasadnieniem.
3. Wybiera zasób, wprowadza -3 i powód „Uszkodzone opakowania”. Saldo wynosi 21, ruch zostaje w historii.
4. Wprowadza +10 z powodem ręcznego uzupełnienia. Saldo wynosi 31.
5. Odwraca błędny ruch -3 z nowym powodem; saldo wynosi 34. Ponowienie nie tworzy drugiego odwrócenia.
6. Zwykły kasjer widzi saldo, ale nie zmienia go. Cofnięcie inventory.manage odbiera prawo kolejnej korekty.
7. Przejście z historii zasobu A do B podczas pobierania nie pokazuje wpisów A pod B.

## Walidacja

Pełna regresja zintegrowanej wersji: API 220/220 (w tym 3 nowe zintegrowane testy magazynu, każdy z wieloma scenariuszami publicznymi), web 181/181 (5 nowych testów magazynu), shared 42/42. Łącznie 443/443, bez doliczania powtórnych uruchomień. TypeScript API/web oraz build produkcyjny przechodzą. Build ma istniejące nieblokujące ostrzeżenie o głównym pakiecie około 596 kB.

Code review Spec: znaleziono P2 — późna strona historii A dopisywana pod B. Poprawiono aktualny wybór, numer żądania oraz blokowanie równoległego pobierania; test opóźnionej odpowiedzi przechodzi. Recheck bez pozostałego ustalenia.

Standards: brak twardych naruszeń. Poprawiono także stary błąd po zmianie kontekstu, użyto kanonicznych typów i rozwinięto formatowanie. Recheck bez pozostałych uwag w sprawdzonym zakresie.

Ograniczenia: współbieżność sprawdzona lokalnie na PGlite, nie na osobnych sesjach natywnego PostgreSQL. Nie wykonano fizycznego odbioru Android/Nimiq Pay. Nie wdrożono aplikacji ani nie wykonano rzeczywistych transakcji. Istniejący screenshot remote-acceptance.png pozostawiono poza commitami.

## Następne zależności

MM-12 (dostawy) i MM-13 (spisy/straty) mogą działać na zasobach MM-10a bez oczekiwania na zestawy. MM-21 (rozliczenie jedzenia ze zdjęciami) potrzebuje oprócz MM-13/MM-20 także MM-11, aby stan oczekiwany uwzględniał faktyczną sprzedaż. Całego MM-10 nie oznaczamy jako ukończonego.
