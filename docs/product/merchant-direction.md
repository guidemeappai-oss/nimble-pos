# Nimble — kierunek produktu dla sprzedawców

Data ustaleń: 2026-10-14. Status: rozmowa produktowa; nie jest to jeszcze specyfikacja implementacji.

## Potwierdzone przez właściciela produktu

- Tworzymy produkt na konkurs Nimiq Mini Apps Competition.
- Pierwszym odbiorcą jest mały lokal z obsługą przy ladzie i płatnością z góry.
- Nie mamy obecnie uzgodnionego lokalu pilotażowego ani kontaktu do sprzedawcy.
- Terminal oznacza aplikację na posiadanym telefonie z Androidem, bez konieczności zakupu lub wynajmu osobnego terminala kartowego.
- Zakres obejmuje katalog produktów, koszyk, płatność i status realizacji zamówienia.
- Rozważano USDT/USDC; dla pierwszej wersji przyjęto NIM i USDT.
- Wygląd, funkcje i prezentacja mają przyciągać uwagę, pobudzać wyobraźnię i sprawiać wrażenie dopracowanego produktu premium. Inspiracja wskazana przez użytkownika: sposób prezentowania produktów przez Steve'a Jobsa.
- Ceny wyświetlamy równocześnie w walucie lokalu (np. EUR) i obok w aktywie płatności NIM/USDT. Szczegóły odświeżania i zamrażania przeliczenia wymagają doprecyzowania.
- Pierwsza wersja przyjmuje NIM oraz USDT; sprzedawca otrzymuje aktywo, którym płaci klient, bez automatycznej zamiany.
- Dodajemy wyraźnie oznaczoną demonstracyjną kawiarnię z gotowymi produktami, dostępną bez zakładania własnego lokalu; tworzenie własnego lokalu stanowi osobną ścieżkę.
- Obok dotychczasowego kodu płatności dodajemy możliwość zeskanowania QR zamówienia przez klienta.
- Po płatności zamówienie przechodzi przez kolejkę: do przygotowania → gotowe → wydane. Numer jest widoczny również klientowi; gotowy produkt można od razu oznaczyć jako wydany.
- Pierwsza wersja obsługuje warianty produktów (np. rozmiar z własną ceną) i dodatki z dopłatą (np. mleko roślinne, dodatkowy shot). Klient widzi wybrane opcje przed zapłatą.
- Nie prowadzimy stanów magazynowych, ilości zapasów ani automatycznego odejmowania produktów lub składników po sprzedaży. Kasjer może ręcznie oznaczyć produkt lub dodatek jako chwilowo niedostępny i ponownie go włączyć.
- Zamówienie tworzy sprzedawca na swoim telefonie, wybierając produkty, warianty i dodatki. Klient po sparowaniu kodem lub zeskanowaniu QR przegląda podsumowanie i zatwierdza płatność. Samodzielne komponowanie zamówienia przez klienta nie wchodzi do pierwszej wersji.
- Przed płatnością sprzedawca może zmienić lub anulować zamówienie. Zmieniona kwota wymaga pokazania klientowi aktualnego podsumowania przed zatwierdzeniem.
- Po płatności pierwsza wersja umożliwia pełny zwrot. Zwracamy dokładnie otrzymaną kwotę NIM lub USDT, bez przeliczenia według nowego kursu. Zamówienie otrzymuje status zwrócone dopiero po potwierdzeniu przelewu zwrotnego.
- Lokal obsługuje jeden współdzielony telefon, na którym kolejno logują się różni kasjerzy, każdy na własne konto operacyjne Nimble.
- Główny portfel z utargiem należy wyłącznie do właściciela. Kasjerzy mogą wykonywać operacje związane z pracą lokalu, ale nie mogą wysyłać środków z głównego portfela.
- Kasjer loguje się przez wybór profilu i indywidualny PIN na wspólnym telefonie wcześniej przypisanym przez właściciela do lokalu.
- Kasjer zgłasza zwrot; właściciel zatwierdza przelew w swoim portfelu na własnym telefonie. Klient widzi „zwrot oczekuje na zatwierdzenie”. To doprecyzowuje wcześniejsze określenie „sprzedawca” w zasadach zwrotów.
- Portfel właściciela i możliwość podpisywania wypłat pozostają poza współdzielonym telefonem kasowym. Tożsamość kasjera jest oddzielona od adresu odbierającego utarg.
- Kasjer obsługuje zamówienia i widzi podsumowanie swojej zmiany. Zarządzanie menu (poza ręczną dostępnością), cenami, kontami pracowników oraz raportem całego lokalu jest uprawnieniem właściciela.
- Podczas konfiguracji właściciel wybiera walutę cen lokalu: EUR, PLN lub USD. Obok ceny pokazujemy wartość w wybranym NIM/USDT.
- Zatwierdzony kierunek wizualny: jasny i elegancki. Interfejs ma zachować wcześniej ustalony charakter premium i przyciągać uwagę w prezentacji konkursowej.

## Sprawdzone źródła i ograniczenia

- https://miniappscompetition.com/scoring — obecna punktacja: funkcjonalność, niezawodność i użyteczność 45; integracja 25; rzeczywiste użycie 15; design i UX 10; promocja 5. Ponownie sprawdzić przed zgłoszeniem.
- https://www.nimiq.com/blog/usdt-integration-nimiq-pay/ — potwierdza USDT na Polygonie w Nimiq Pay.
- https://www.nimiq.dev/mini-apps/features/evm-tokens — miniaplikacje mogą korzystać z tokenów ERC-20 przez provider EVM. Dostępność providera nie dowodzi, że Nimble ma już zaimplementowany przepływ płatności stablecoinem, uzgadnianie transakcji lub obsługę opłat.
- Terminal kryptowalutowy nie oznacza przyjmowania kart Visa/Mastercard. Brak osobnego urządzenia nie oznacza automatycznie zerowych kosztów całej płatności.

## Otwarte decyzje

- Zasady odświeżania oraz zamrażania przeliczenia na aktywo płatności.
- Szczegóły obsługi skanowania QR w Nimiq Pay i powrotu do zamówienia.
- Szczegółowy scenariusz demonstracji oraz tworzenia własnego lokalu.
- Sposób pozyskania autentycznych użytkowników i opinii bez obecnego partnera pilotażowego.
- Dokładne statusy zamówień oraz związek realizacji z potwierdzeniem płatności.
- Konkretna paleta, typografia i kompozycja ekranów w ramach zatwierdzonego jasnego, eleganckiego kierunku — do oceny na prototypie.
- Szczegóły przełączania zmian i przypisania urządzenia.
- Zachowanie przy płatności już wysłanej podczas próby edycji lub anulowania; opłaty zwrotu i obsługa błędów zwrotu.

## Pomysł użytkownika: powiadomienie o odbiorze przez 1 lunę

Użytkownik proponuje, aby przy zmianie na „gotowe” sprzedawca wysyłał klientowi 1 lunę (0,00001 NIM), wywołując powiadomienie portfela. To propozycja do weryfikacji, nie wdrożona funkcja.

- Oficjalny provider pozwala wysłać NIM z wiadomością przez `sendBasicTransactionWithData`; wymaga potwierdzenia w portfelu. Źródło: https://nimiq.dev/mini-apps/api-reference/nimiq-provider
- Autor NimJump opisuje wykorzystanie dokładnie 0,00001 NIM do wywołania powiadomienia o otrzymanej płatności. W tym samym wpisie prosi o wyświetlanie memo; wpis sam w sobie nie dowodzi, że własna treść powiadomienia jest obecnie widoczna. Źródło: https://www.skool.com/miniappscompetition/feature-request-nimiq-pay-show-transaction-memo-in-payment-notifications
- Przed obietnicą działania sprawdzić na Androidzie: aplikacja otwarta, w tle i zablokowany ekran; widoczność memo, ustawienia powiadomień, opłaty i obsługę 1 luny.
- Dla klienta płacącego USDT potrzebny jest także jego powiązany adres Nimiq; adres Polygon nie jest adresem do otrzymania NIM.
- Rekomendacja do zatwierdzenia: status gotowości i aktualizacja ekranu klienta nie zależą od powodzenia przelewu; transakcyjny sygnał jest dodatkiem. Nie umieszczać danych osobowych ani szczegółów koszyka w publicznym memo.

### Automatyzacja — decyzja zaakceptowana

Użytkownik zaakceptował osobny portfel powiadomień finansowany przez Nimble. Decyzję i konsekwencje zapisuje [ADR 0001](../adr/0001-notification-wallet.md). Poniższe ustalenia opisują projekt, nie wdrożoną funkcję.

Użytkownik chce automatycznej wysyłki po zmianie statusu i proponuje identyfikowanie zamówienia po kodzie zawartym w transakcji.

- Dokumentacja miniaplikacji wymaga potwierdzenia wysyłki z portfela Nimiq Pay; nie znaleziono udokumentowanego delegowania uprawnień ani trybu cichej wysyłki: https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider oraz https://www.nimiq.dev/mini-apps
- Technicznie można podpisywać transakcje osobnym kluczem przez `KeyPair.signTransaction` i rozsyłać je przez RPC `sendRawTransaction`: https://nimiq.dev/web-client/reference/classes/keypair oraz https://nimiq.dev/rpc/methods/send-raw-transaction
- Zatwierdzony wariant (jeszcze nie przetestowany): osobna usługa powiadomień z małym portfelem finansowanym przez operatora Nimble, bez dostępu do portfeli i utargu sprzedawców. Zmiana statusu przez uprawnionego sprzedawcę zleca pojedynczy przelew do powiązanego odbiorcy; wymagane limity, ochrona przed duplikatami i ponawianie transmisji tej samej transakcji.
- Jest to zaakceptowana zmiana architektoniczna względem obecnej zasady „backend nigdy nie posiada klucza i nie podpisuje”. Odrębna usługa nadal oznacza klucz po stronie infrastruktury Nimble; granicę odpowiedzialności opisuje ADR 0001.
- Sześciocyfrowy kod jest czasowy i może być ponownie użyty. Memo jest publiczne. Zalecany osobny losowy identyfikator zdarzenia związany z zamówieniem; odbiorca weryfikuje także nadawcę, adres odbiorcy, sieć i aktualny stan w Nimble. Identyfikator nie jest uprawnieniem do odczytu szczegółów zamówienia.
- Otwarta miniaplikacja może reagować przez backend/SSE. Nie ustalono, że przychodzący przelew budzi jej WebView, uruchamia własny kod w tle lub otwiera konkretne zamówienie po kliknięciu powiadomienia Nimiq Pay. Te właściwości wymagają osobnego testu urządzenia.
- 1 NIM wystarcza na 100 000 przekazanych kwot po 1 lunie wyłącznie przy pominięciu opłat; nie jest to obietnica 100 000 dostarczonych powiadomień.

## Propozycje do omówienia, nie zatwierdzone wymagania

- Pierwszy pokaz: gotowy przykładowy lokal, wybór dwóch produktów, widok klienta, płatność i numer zamówienia, następnie aktualizacja raportu sprzedawcy.
- USDT na Polygonie; USDC jako ewentualne późniejsze rozszerzenie po ocenie korzyści i weryfikacji pełnej ścieżki na urządzeniu.
- Efekt wizualny budować wokół czytelnego katalogu, przejścia do widoku klienta i zsynchronizowanego potwierdzenia na obu telefonach.
- Baza wizualna do prototypu: ciepła biel, grafitowa typografia, jeden wyrazisty akcent, duże zdjęcia produktów i czytelny koszyk. Dokładny kolor akcentu nie został jeszcze zatwierdzony.
