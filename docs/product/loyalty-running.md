# Karta stałego klienta — odbiór i uruchomienie

Zakres: program jednego lokalu, pięć kwalifikujących się zamówień za produkt gratis. Specyfikacja: loyalty-card-plan.md. Wymagane jest wdrożenie API i migracji razem z frontendem. Sam statyczny frontend nie zapisuje kart klientów.

## Przed testem na urządzeniu

- Wykonać kopię bazy przed uruchomieniem nowych migracji na istniejącym serwerze.
- Sprawdzić konfigurację sieci backendu i Nimiq Pay. Dane testowe oraz saldo karty nie powinny przechodzić do środowiska mainnet.
- Zalogować właściciela na jego telefonie, a kasjera na przypisanym telefonie kasowym. Konto kasjera nie udostępnia podpisywania z portfela właściciela.
- Ustawić w menu produkt i wariant nagrody oraz dodatnią minimalną kwotę kwalifikującego zakupu.
- Test NIM wykonać najpierw na testnecie. Przełączenie testnetu Nimiq nie zmienia sieci EVM; nie traktować USDT Polygon jako bezpłatnego testowego tokena.

## Scenariusz podstawowy

1. Właściciel konfiguruje program lojalnościowy lokalu.
2. Klient otwiera zamówienie z QR, loguje się własnym kontem i dołącza do programu przed wyceną. Sprawdza nagrodę i minimum zakupowe.
3. Klient zatwierdza kwalifikującą się płatność. Karta otrzymuje jedną pieczątkę dopiero po jej potwierdzeniu.
4. Klient zamyka miniaplikację i otwiera ją ponownie. Po zalogowaniu tym samym kontem widzi zachowany postęp.
5. Po pięciu kwalifikujących się zakupach klient rezerwuje nagrodę i pokazuje QR kasjerowi.
6. Kasjer przyjmuje nagrodę. Ta sama realizacja przechodzi przez przygotowanie, gotowość i wydanie; nie pojawia się zgoda na przelew o wartości zero.
7. Ponowny skan nie tworzy drugiej nagrody. W raporcie sprzedaży gratis nie zwiększa utargu.

## Przypadki istotne dla odbioru

- Drugie konto nie widzi karty pierwszego, nawet jeśli zna link jego zamówienia.
- Jeden zakup poniżej minimum nie daje pieczątki. Zmieniony koszyk nie zastępuje podsumowania już opłaconego zamówienia.
- Odświeżenie po zapłacie i powtórne zgłoszenie tego samego hasha nie naliczają dodatkowej pieczątki.
- Dwa równoczesne odbiory ostatnich pięciu pieczątek pozwalają przyjąć najwyżej jedną nagrodę.
- Nieprzyjęta rezerwacja po pięciu minutach wygasa i zwalnia saldo. Produkt niedostępny nie zabiera punktów.
- Anulowanie przyjętej nagrody przed wydaniem przywraca pięć punktów raz. Wydanej nagrody nie można anulować w MVP.
- Zwrot zakupu blokuje jego pieczątkę, a po potwierdzeniu przelewu koryguje saldo dokładnie raz. Po odebranej nagrodzie korekta może wymagać uzupełnienia kolejnymi zakupami; nie pomniejsza kwoty zwrotu kryptowaluty.
- Zmiana warunków programu nie zmienia obietnicy na istniejącej karcie. Wyłączenie programu nie odbiera możliwości wykorzystania wcześniej zebranych pieczątek.
- Tryb demonstracyjny nie zapisuje prawdziwych pieczątek i nie podpisuje transakcji.

## Bramki weryfikacji

Wypełniać na podstawie rzeczywistego wykonania, nie samego istnienia testu.

- [x] Automatyczne testy API, shared i web zakończone powodzeniem.
- [x] Sprawdzanie typów API/web i produkcyjny build zakończone powodzeniem.
- [x] Przegląd zgodności ze specyfikacją i standardami zakończony; istotne uwagi rozwiązane.
- [x] Scenariusz demo i wąski ekran sprawdzone w przeglądarce.
- [ ] Testy konkurujących transakcji wykonane na natywnym PostgreSQL.
- [ ] Pełny przebieg na fizycznym Androidzie wewnątrz Nimiq Pay.
- [ ] Zweryfikowany przebieg USDT z dowodem kontroli adresu EVM (osobna zgoda na rzeczywistą płatność).

Weryfikacja lokalna: API 192/192, shared 42/42, web 131/131; dodatkowo 29 testów API ponownie po zmianie blokad. TypeScript API/web i build produkcyjny przechodzą. Chromium: pięć zakupów → rezerwacja → przygotowanie → gotowe → wydane, szerokości 320/390/736/1280 px, bez błędów runtime. Raport przeglądu: ../audits/loyalty-card-review.md. Przeglądarka i lokalna baza testowa nie zastępują ostatnich trzech bramek.

Demo karty: `/merchant/loyalty/demo`. Karty zalogowanego klienta: `/merchant/cards`. Konfiguracja: zakładka Loyalty właściciela; nagrody kasjera: kolejka stanowiska. Nowa migracja: `0013_loyalty_cards.sql`.
