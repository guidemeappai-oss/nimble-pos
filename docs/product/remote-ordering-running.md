# Zamówienia zdalne — uruchomienie i odbiór

Specyfikacja: [remote-ordering-plan.md](remote-ordering-plan.md). Klient płaci przed decyzją lokalu. Odrzucona płatność wymaga osobnego zwrotu podpisanego przez właściciela; kasjer nie ma uprawnień do wypłaty.

## Przygotowanie

1. Wdrożyć API, migracje i frontend z tej samej wersji. Przed migracją istniejącej bazy wykonać kopię zapasową.
2. Zachować osobne bazy i konfiguracje mainnet/testnet. Sprawdzić zgodność sieci backendu z Nimiq Pay. Testnet Nimiq nie przełącza USDT na testową sieć Polygon.
3. Zostawić `REMOTE_ORDERING_ENABLED=0` do zakończenia testów odbioru. W środowisku testowym włączyć `REMOTE_ORDERING_ENABLED=1`; ustawienie przekazuje produkcyjny plik compose.
4. Uzupełnić wizytówkę lokalu: adres, miasto, informację o odbiorze i orientacyjny czas przygotowania. Publikacja wizytówki i przyjmowanie zamówień to osobne ustawienia.
5. Właściciel pracuje na swoim urządzeniu z portfelem utargu. Telefon kasowy przypisać do lokalu; kasjer rozpoczyna zmianę i włącza zamówienia zdalne.
6. Przed publicznym uruchomieniem upewnić się, że właściciel może obsłużyć zwroty. Nie opisywać odrzucenia jako automatycznego zwrotu pieniędzy.

## Scenariusz podstawowy na dwóch urządzeniach

1. Klient znajduje opublikowany lokal w Nimble i sprawdza adres odbioru.
2. Wybiera produkt, wariant i dodatek. Widzi kwotę fiat, wybraną kryptowalutę i warunki akceptacji/zwrotu.
3. Loguje się istniejącym profilem i opcjonalnie dołącza do karty lojalnościowej przed wyceną.
4. Zatwierdza płatność w portfelu. Sam hash nie oznacza akceptacji ani potwierdzonej płatności.
5. Po potwierdzeniu przez API klient widzi oczekiwanie na decyzję; kasjer dostaje pozycję do akceptacji. Zamówienie nie przechodzi jeszcze do przygotowania i nie otrzymuje pieczątki.
6. Kasjer przyjmuje zamówienie z szacowanym czasem. Klient widzi przygotowanie, adres i kod odbioru; kwalifikujący zakup dostaje jedną pieczątkę.
7. Klient zamyka aplikację i wraca na to samo konto. Zamówienie i kod pozostają dostępne.
8. Kasjer oznacza gotowość. Klient pokazuje QR na swoim telefonie.
9. Kasjer skanuje, sprawdza podsumowanie i potwierdza wydanie. Sam skan nie wydaje produktu.
10. Ponowny skan nie umożliwia drugiego wydania. Sprawdzić raport lokalu i zmianę kasjera.

## Odmowa, brak odpowiedzi i zwrot

- Odrzucić drugie opłacone zamówienie z powodem. Klient widzi odmowę i oczekiwanie na zwrot właściciela; brak pieczątki i aktywnego odbioru.
- Pozostawić trzecie zamówienie bez decyzji. Po terminie worker tworzy jeden obowiązek zwrotu. Zamknąć i ponownie uruchomić API: przeterminowane sprawy muszą być podjęte ponownie, bez powielania zwrotu.
- Spróbować zaakceptować po terminie przed kolejnym przebiegiem workera. Serwer musi odmówić.
- Właściciel zatwierdza pełny zwrot w tym samym aktywie. Dopiero potwierdzenie łańcuchowe pozwala pokazać „zwrócono”. Kasjer nie może użyć tego uprawnienia.
- Zwrot odrzuconego zakupu bez naliczonej pieczątki nie obniża salda karty. Zwrot przyjętego zakupu koryguje wcześniejszą pieczątkę zgodnie z zasadami lojalności.

## Przerwy i uprawnienia

- Wstrzymanie zamówień lub brak obecności terminala blokuje nowe checkouty; już ważna wycena zachowuje uzgodnione reguły rozliczenia.
- Zmiana kasjera nie ukrywa kolejki lokalu. Nie należy pozostawiać aplikacji bez obsługi, licząc na gwarantowany dźwięk lub powiadomienie w tle.
- Klient B nie odczyta zamówień ani QR klienta A. QR płatności, nagrody i odbioru nie mogą działać zamiennie.
- Obcy lokal nie weryfikuje kodu odbioru. Krótki kod podlega ograniczeniom prób; nie jest publicznym wyszukiwaniem zamówień.
- Brak połączenia podczas skanu nie może pokazywać sukcesu. Wydanie wymaga stanu READY i atomowego potwierdzenia API.
- Dwie próby akceptacji, akceptacja równocześnie z timeoutem i dwa równoczesne wydania mają dokładnie jeden wynik. Zweryfikować na natywnym PostgreSQL.

## Bramki odbioru

Zaznaczać wyłącznie na podstawie faktycznie wykonanych sprawdzeń.

- [x] Testy API, shared i web przechodzą.
- [x] TypeScript API/web i build produkcyjny przechodzą.
- [x] Przegląd zgodności ze specyfikacją i standardami zakończony; uwagi rozwiązane.
- [x] Pełny przepływ demo, odmowa i wąski ekran sprawdzone w przeglądarce.
- [ ] Konkurujące transakcje sprawdzone na natywnym PostgreSQL.
- [ ] Fizyczny Android/Nimiq Pay: logowanie, płatność, powrót do aplikacji i kamera.
- [ ] Rzeczywista płatność oraz zwrot NIM sprawdzone w uzgodnionym środowisku.
- [ ] Rzeczywista ścieżka USDT z dowodem kontroli EVM sprawdzona osobno.

Implementacja lokalna i demonstracja nie oznaczają wdrożenia na serwerze ani wykonania rzeczywistych przelewów.

## Wynik implementacji lokalnej

Gałąź `feat/remote-ordering`. Punkty wejścia: `/venues`, `/orders`, `/orders/:orderId`, demo `/remote/demo`; właściciel: zakładka Remote orders, kasjer: kolejka stanowiska. Nowe migracje: `0014_low_scarecrow.sql` oraz `0015_ordinary_eternals.sql`. Druga zachowuje wymóg przypisania kasjera i zmiany dla COUNTER; REMOTE powstaje bez fikcyjnego pracownika.

Weryfikacja: API 203/203, shared 42/42, web 151/151 (396 razem); TypeScript API/web i produkcyjny build przechodzą. Dodatkowo cztery scenariusze Playwright oraz pełny pokaz Chromium z kontrolą szerokości 320/390/736/1280 px. Przegląd: [remote-ordering-review.md](../audits/remote-ordering-review.md). Ostrzeżenie builda o pakiecie JavaScript powyżej 500 kB nie blokuje kompilacji.

Testy konkurujących żądań można ponowić na dedykowanym natywnym PostgreSQL przez zestaw API `remote.test.ts`; wymagany `TEST_DATABASE_URL` musi wskazywać bazę testową, ponieważ helper ją czyści. Lokalny przebieg PGlite nie zamyka bramki natywnych sesji.

Zamknięty raport zmiany zachowuje stan z chwili zakończenia. Oczekujący zwrot REMOTE nie blokuje zmiany kasjera; jego aktualny stan pozostaje w raporcie i kolejce lokalu. Klient widzi osobno zgodę właściciela na zwrot i potwierdzenie zwrotnego przelewu.
