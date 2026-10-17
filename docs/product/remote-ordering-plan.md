# Zamów zdalnie, odbierz z QR — plan implementacji

Data: 2026-10-15. Baza: feat/loyalty-card, 32e401f. Skill: AI Hero to-spec.
Status: użytkownik zatwierdził implementację 2026-10-15; implementacja lokalna zakończona na gałęzi feat/remote-ordering; odbiór urządzenia i natywnej bazy pozostaje otwarty. Ten dokument nie oznacza wdrożenia ani publikacji zgłoszeń na GitHub.

## Problem Statement

Klient chce wybrać lokal w Nimble, zamówić przed przyjściem i odebrać zakup bez zamawiania przy ladzie. Kasjer musi zdecydować, czy lokal może zrealizować zamówienie. Samo potwierdzenie płatności nie jest zgodą lokalu na przygotowanie.

## Solution

Ścieżka klienta: lista lokali → menu → koszyk → płatność → oczekiwanie na decyzję → przygotowanie → gotowe → odbiór z QR na własnym telefonie.

Ścieżka kasjera: opłacona prośba o realizację → akceptacja z orientacyjnym czasem lub odrzucenie z powodem → przygotowanie → gotowe → skan i potwierdzenie wydania.

### Ustalenia użytkownika

- Klient wybiera lokal bez skanowania QR na stole.
- Zamawia zdalnie i ma kod odbioru na swoim telefonie.
- Kasjer musi jawnie zaakceptować zamówienie.
- Zachowujemy menu z wariantami i dodatkami, bez stanów magazynowych; oddzielenie kasjera od portfela właściciela; jasny, elegancki wygląd.

### Założenia proponowane dla pierwszej wersji

- Odbiór osobisty, zamówienia na teraz; jeden lokal w koszyku.
- Zachowujemy kolejność z rozmowy: płatność przed akceptacją. To założenie, nie osobna decyzja użytkownika o kolejności. Przed zapłatą klient widzi: lokal może odmówić, a zwrot wymaga zatwierdzenia właściciela. Alternatywa „akceptacja przed płatnością” wymaga zmiany tej części planu.
- Kasjer ma 3 minuty na decyzję od serwerowego potwierdzenia płatności. Termin jest propozycją MVP. Brak decyzji oznacza obowiązek zwrotu, nigdy milczącą akceptację.
- Właściciel publikuje wizytówkę; lokal oddzielnie włącza przyjmowanie zamówień zdalnych. Nowe i istniejące lokale domyślnie niepubliczne, zamówienia zdalne wyłączone.
- Lista i wyszukiwanie po nazwie/mieście; bez mapy i uprawnień lokalizacyjnych.

## User Stories

1. Jako klient chcę znaleźć lokal w aplikacji, aby zamówić przed przyjściem.
2. Jako klient chcę widzieć adres i dostępność zamawiania, aby wybrać właściwy punkt odbioru.
3. Jako klient chcę wybrać warianty i dodatki, aby zamówić właściwy produkt.
4. Jako klient chcę znać dokładną kwotę przed podpisaniem płatności, aby świadomie zapłacić.
5. Jako klient chcę wiedzieć, że płatność czeka na decyzję lokalu, aby nie pomylić jej z przyjęciem zamówienia.
6. Jako klient chcę zobaczyć przewidywany czas po akceptacji, aby zaplanować przyjście.
7. Jako klient chcę odzyskać zamówienie po ponownym otwarciu aplikacji, aby mieć dostęp do odbioru.
8. Jako klient chcę pokazać własny QR, aby sprawnie odebrać zakup.
9. Jako klient chcę użyć krótkiego kodu, aby odebrać zakup przy niedziałającej kamerze.
10. Jako klient chcę widzieć przyczynę odmowy i stan zwrotu, aby wiedzieć, co dzieje się z pieniędzmi.
11. Jako uczestnik programu lojalnościowego chcę otrzymać pieczątkę za przyjęty, opłacony zakup, aby korzystać z tej samej karty również zdalnie.
12. Jako kasjer chcę osobną kolejkę próśb z czasem na decyzję, aby nie przeoczyć zdalnego zamówienia.
13. Jako kasjer chcę przyjąć zamówienie, aby potwierdzić możliwość realizacji.
14. Jako kasjer chcę odrzucić zamówienie z powodem, aby poinformować klienta o braku możliwości realizacji.
15. Jako kasjer chcę wstrzymać nowe zamówienia zdalne, aby obsłużyć kolejkę w lokalu.
16. Jako kasjer chcę zweryfikować kod przy wydaniu, aby nie wydać tego samego zakupu dwukrotnie.
17. Jako właściciel chcę opublikować wizytówkę, aby klienci mogli znaleźć mój lokal.
18. Jako właściciel chcę zatwierdzać zwroty na swoim urządzeniu, aby zachować kontrolę nad utargiem.
19. Jako właściciel chcę odróżniać zamówienia zdalne od sprzedaży przy ladzie, aby rozumieć źródła sprzedaży.

## Implementation Decisions

### Odkrywanie lokali i dostępność

Publiczna wizytówka zawiera nazwę, krótki opis, adres, miasto, informację o odbiorze, walutę cen i orientacyjny czas przygotowania. Publikacja i przyjmowanie zamówień to oddzielne ustawienia. Publiczny katalog nie ujawnia pracowników, raportów, klientów ani konfiguracji terminala. Zapytania są stronicowane i oddzielone według środowiska/sieci.

Przyjmowanie wymaga aktywnej zmiany i świeżego sygnału obecności terminala. Proponowany heartbeat co 15 sekund, niedostępność po 60 sekundach bez sygnału. Zamknięcie zmiany wyłącza napływ nowych zamówień. To ogranicza zamawianie do nieobsługiwanego telefonu; nie gwarantuje odpowiedzi kasjera.

Serwer sprawdza dostępność lokalu i produktów przy tworzeniu zamówienia oraz wyceny. Wstrzymanie nowych zamówień nie unieważnia poprawnie wydanej, niewygasłej wyceny; płatność nadal trafia do ręcznej decyzji, a brak decyzji do zwrotu. Zmiana menu nie zmienia zamrożonych zakupów. Kasjer może odmówić realizacji niedostępnego produktu. Bez częściowej akceptacji i zamienników w MVP.

### Tożsamość i koszyk

Przeglądanie publiczne; utworzenie zdalnego zamówienia wymaga istniejącego uwierzytelnionego profilu klienta. Używamy obecnego dowodu kontroli płatnika NIM/EVM, izolacji sieci i niezmiennej wyceny. Serwer przelicza koszyk; nie ufa cenom ani tożsamości przesłanym przez interfejs.

Tworzenie z kluczem idempotencji, limity per profil/lokal i ograniczona liczba otwartych checkoutów. Powtórzenie żądania po utracie połączenia zwraca to samo zamówienie. Zmiana koszyka po zapłacie jest niedozwolona. Zapisujemy źródło COUNTER/REMOTE i właściciela zamówienia; odczyt szczegółów wyłącznie przez jego klienta oraz uprawniony personel lokalu.

### Stany i płatność

| Zdarzenie | Stan lub rezultat |
| --- | --- |
| Klient tworzy koszyk | AWAITING_PAYMENT |
| Zgłoszenie transakcji | PAYMENT_PENDING — to jeszcze nie potwierdzenie |
| Serwer potwierdza prawidłową płatność REMOTE | AWAITING_ACCEPTANCE, zapis terminu decyzji |
| Kasjer akceptuje przed terminem | PREPARING, zapis kasjera, zmiany i czasu przygotowania |
| Kasjer odrzuca lub upływa termin | REFUND_PENDING z powodem i jednym zleceniem zwrotu |
| Kasjer oznacza gotowość | READY |
| Kasjer weryfikuje kod i potwierdza wydanie | COLLECTED |
| Serwer potwierdza zwrot właściciela | REFUNDED |

COUNTER zachowuje dotychczasowe przejście płatności do PREPARING. Spóźnione, anulowane i niezgodne płatności nadal podlegają obecnym regułom rozliczenia i obowiązkowego zwrotu; nigdy nie otwierają ręcznej akceptacji.

Odmowa jest decyzją o realizacji, a zwrot osobnym procesem finansowym. Zapisać decyzję, powód, aktora i czas niezależnie od statusu zwrotu. Klient widzi „Lokal odrzucił — zwrot oczekuje na właściciela”, a nie „Pieniądze zwrócone”. Kasjer nie podpisuje wypłat. Nie obiecujemy automatycznego ani natychmiastowego zwrotu.

Przejścia blokują wiersz zamówienia i są idempotentne. Akceptacja i timeout konkurują atomowo; serwer nie pozwala zaakceptować po deadline nawet wtedy, gdy worker jeszcze nie wykonał zadania. Trwały worker cyklicznie znajduje przeterminowane decyzje, odtwarza pracę po restarcie i tworzy co najwyżej jeden zwrot. Działanie nie zależy od otwartej aplikacji.

Anulowanie przed zgłoszeniem płatności dostępne klientowi; rozpoczętej płatności nie przedstawiamy jako cofniętej. Po zgłoszeniu transakcji klient obserwuje wynik, a wyjątki obsługuje lokal przez istniejący proces zwrotu. Rozbudowana polityka rezygnacji po akceptacji i nieodebrania poza MVP; nieodebrane zamówienie pozostaje READY, bez automatycznego wydania lub przepadku środków.

### Zmiany, raporty i dane

Obecne zamówienia wymagają kasjera i zmiany już podczas tworzenia. Zdalne powstają bez kasjera: migracja dopuszcza brak tych powiązań dla REMOTE przed decyzją, zachowując dotychczasowe wymagania COUNTER. Akceptacja lub odmowa rejestruje rzeczywistego kasjera i jego zmianę; timeout rejestruje aktora systemowego. Nie podstawiamy sztucznego kasjera.

Kolejka zdalna jest wspólna dla lokalu i przeżywa zmianę pracownika. Każdy uprawniony kasjer z aktywną zmianą może kontynuować realizację. Raport lokalu obejmuje również wpłaty oczekujące na decyzję i zwroty; raport zmiany nie może ich ukrywać przez złączenia wymagające shiftId. Oddzielić wpłaty, przyjętą sprzedaż oraz kwoty do zwrotu, bez podwójnego liczenia. Zamknięcie zmiany nie usuwa spraw lokalu.

### Lojalność

Dla REMOTE naliczanie przenosimy z samego potwierdzenia płatności do atomowej akceptacji opłaconego zamówienia. Używamy zamrożonego powiązania programu i snapshotu koszyka; zachowujemy istniejące blokady profilu/karty i idempotencję. COUNTER nalicza jak dotąd. Odrzucenie i timeout nie dają pieczątki; zwrot bez wcześniejszego EARN nie odejmuje punktu. Zwrot po przyjęciu korzysta z dotychczasowych korekt. Zdalne zamawianie darmowej nagrody poza MVP; istniejący odbiór nagrody pozostaje dostępny.

### QR odbioru

Osobny typ tokenu, inny niż checkout, kod płatności i QR nagrody. Losowy, niezgadywalny sekret związany z zamówieniem, lokalem i środowiskiem; bez danych osobowych. Zapis umożliwia bezpieczne odzyskanie tego samego QR przez właściciela zamówienia po restarcie. Publiczny katalog i zwykłe DTO kasjera nie ujawniają sekretu.

QR dostępny po przyjęciu; widok wyraźnie pokazuje PREPARING lub READY. Sam skan nie wydaje produktu: pokazuje podsumowanie, a kasjer potwierdza odbiór wyłącznie ze stanu READY. Atomowe przejście do COLLECTED uniemożliwia drugie wydanie. Refund/cancel blokuje wykorzystanie. Weryfikacja wymaga połączenia z serwerem; brak sieci nie daje fałszywego sukcesu.

Alternatywny krótki kod jest unikalny wśród aktywnych odbiorów lokalu; wyszukiwanie wyłącznie dla zalogowanego kasjera właściwego lokalu, z limitami prób. Nie używamy numeru zamówienia jako sekretu. Udostępnienie QR pozwala przekazać możliwość odbioru innej osobie; klient otrzymuje jasną informację, by kod pokazywać dopiero przy odbiorze. Sekret nie trafia do logów, analityki ani wiadomości blockchain.

### Interfejs

Klient: Lokale, ekran lokalu/menu, koszyk, płatność, Moje zamówienia, karta aktywnego zamówienia z adresem, decyzją, czasem i QR. Jasne tło, wyraźne zdjęcie/identyfikacja lokalu dopiero z dostarczonych zasobów, mocna typografia i jeden główny przycisk na ekran. Stany ładowania, braku lokali, odmowy, braku sieci i zwrotu są pełnymi widokami.

Kasjer: sekcja „Do akceptacji” z odliczaniem, zawartością i przyciskami Przyjmij/Odrzuć; po akceptacji obecna kolejka. Akceptacja zawiera szacowany czas, domyślnie z ustawień lokalu. Właściciel: wizytówka i domyślny czas; kasjer: przełącznik przyjmowania zamówień. Sygnał dźwiękowy tylko tam, gdzie host go umożliwia; status odświeża się w otwartej aplikacji, bez obietnicy push w tle. Opcjonalny sygnał 1 luny pozostaje zgodny z ADR 0001.

## Kolejność implementacji

Każdy etap kończy się działającą ścieżką i testami zachowania. Bez osobnego projektu, który duplikuje płatności i kolejkę.

| Etap | Dostarczany rezultat | Zależność |
| --- | --- | --- |
| 1. Lokal w aplikacji | Publikacja wizytówki, publiczna lista i menu, przełącznik dostępności oraz heartbeat | — |
| 2. Zamówienie klienta | Własny koszyk, profil klienta, idempotentne utworzenie, odzyskiwanie; migracja źródła i przypisań | 1 |
| 3. Płatność i decyzja | AWAITING_ACCEPTANCE, kolejka kasjera, accept/reject, worker timeout, zwroty, raporty i poprawne naliczanie lojalności | 2 |
| 4. Odbiór z telefonu | Moje zamówienia, QR i kod awaryjny, skaner, jednorazowe wydanie | 3 |
| 5. Demo i odbiór jakościowy | Elegancki pełny przepływ dwóch ról, scenariusze odmowy/timeout, regresja POS i lojalności, instrukcja uruchomienia | 4 |

Nie udostępniać etapów 1–2 jako działającej sprzedaży zdalnej przed ukończeniem 3–4. Flaga funkcji domyślnie wyłączona. Migracja addytywna bez zmiany znaczenia historii sprzedaży.

## Testing Decisions

Preferujemy istniejące granice testowe: Fastify inject z bazą i kontrolowaną bramką płatności; testy interakcji React; jeden scenariusz przeglądarkowy klient–kasjer. Testujemy publiczne zachowanie, nie prywatne funkcje. Są to proponowane punkty weryfikacji zgodne z dotychczasowym projektem.

- Cały przebieg: znalezienie lokalu, wariant/dodatek, płatność, jawna akceptacja, jedna pieczątka, gotowość, skan i pojedyncze wydanie.
- Odmowa i timeout: jeden obowiązek zwrotu, brak pieczątki i brak prawa odbioru; tylko właściciel może zatwierdzić wypłatę.
- Niezweryfikowany hash, zła sieć, cudzy płatnik, wygasła wycena i późna płatność nie uruchamiają przygotowania.
- Równoległe accept/reject/timeout, wielokrotne callbacki płatności i dwa skany: jeden wynik. Testy rzeczywistej współbieżności na natywnym PostgreSQL, nie wyłącznie emulatorze.
- Restart workera i aplikacji, utrata sieci, zmiana konta, powolne odświeżanie i zmiana kasjera nie gubią zamówienia ani nie ujawniają cudzych danych.
- Wstrzymanie lokalu podczas checkoutu respektuje już wydaną wycenę; utrata obecności terminala blokuje nowe zamówienia.
- Raporty uwzględniają zamówienia bez przypisanej zmiany, odrzucone wpłaty i zwroty bez zawyżania sprzedaży.
- Regresja istniejącego COUNTER, karty, korekt zwrotu oraz odbioru darmowej nagrody; żaden QR nie działa w innym typie operacji.
- Mobilne szerokości 320/390 px i desktop; rzeczywisty Android/Nimiq Pay: przełączanie ról, podpis NIM/USDT, powrót do zamówienia oraz kamera.

Warunek ukończenia: testy automatyczne, TypeScript i build przechodzą; dokumentacja migracji, flagi i obsługi wyjątków gotowa. Przed uruchomieniem płatności dla klientów dodatkowo wymagane testy natywnego PostgreSQL oraz urządzenia/hosta. Nie uznajemy lokalnego demo za potwierdzenie tych bramek.

## Out of Scope

Dostawa, mapa/geolokalizacja, rezerwacja stolika, zamówienia na godzinę, koszyk wielu lokali, stany magazynowe, częściowa akceptacja i częściowe zwroty, automatyczne wypłaty z utargu, escrow, natywne gwarantowane powiadomienia, oceny lokali oraz promocje. Publikacja na serwerze i rzeczywiste transakcje są osobnymi działaniami operacyjnymi.

## Further Notes

Najważniejsza konsekwencja płatności przed akceptacją: klient może czekać na ręczny zwrot właściciela. Interfejs musi to komunikować przed zapłatą. Jeśli preferowany będzie model „najpierw decyzja, potem zapłać”, należy przed kodowaniem zmienić maszynę stanów, terminy i naliczanie; nie mieszać obu modeli w MVP.

Plan opiera się na odczycie obecnych kontraktów zamówień, tras merchant, schematu bazy, rozliczania płatności, planu lojalności oraz ADR o rozdzieleniu ról i portfelu powiadomień. Nie wymaga nowych dostawców płatności. Nie utworzono zewnętrznych issues. Implementację wykonano po zatwierdzeniu użytkownika; wyniki i bramki opisuje remote-ordering-running.md.
