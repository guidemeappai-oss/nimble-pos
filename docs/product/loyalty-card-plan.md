# Karta stałego klienta — specyfikacja i plan implementacji

Data: 2026-10-15. Baza kodu: 095c08a. Skills: AI Hero to-spec i to-tickets.
Status: plan zatwierdzony przez użytkownika 2026-10-15; implementacja w toku. Zatwierdzony próg: pięć opłaconych zamówień → wybrany produkt gratis, bez dodatków. Wdrożenie i rzeczywiste przelewy nie są częścią implementacji lokalnej.

## Problem Statement

Klient płaci w Nimble, ale nie ma jeszcze programu nagradzającego kolejne wizyty. Właściciel ma narzędzie do obsługi sprzedaży, lecz potrzebuje prostego powodu, by klient wrócił. Karta powinna być czytelna po jednej płatności, działać bez papieru i nie obciążać kasjera ręcznym naliczaniem punktów.

## Solution

Osobna karta dla każdego lokalu. Po potwierdzeniu kwalifikującej się płatności klient otrzymuje jedną pieczątkę. Pięć pieczątek pozwala zamówić wskazany przez właściciela produkt gratis. Animacja pieczątki, postęp „3 z 5” i gotowa nagroda pojawiają się w Nimble. Serwer przechowuje saldo i historię; nie tworzymy tokena blockchain.

### Rekomendowane reguły MVP

- Jeden aktywny program na lokal, próg pięciu pieczątek. Próg stały w MVP upraszcza komunikację i migracje; konfigurowalny próg później.
- Jedna pieczątka za jedno opłacone zamówienie spełniające minimalną kwotę zakupu. Właściciel ustala dodatnią kwotę minimum w walucie lokalu; brak uniwersalnej kwoty dla różnych lokali. NIM i USDT liczą się jednakowo według utrwalonej wartości zamówienia w fiat.
- Brak pieczątek za zamówienia bezpłatne, odrzucone, anulowane, przeznaczone do obowiązkowego zwrotu lub samo zgłoszenie hasha. Nie naliczamy historycznych zakupów sprzed dołączenia.
- Nagroda: jedna sztuka konkretnego produktu i wariantu bez dodatków. Właściciel wybiera ją z menu. Nagroda odbierana osobno; płatne dodatki i łączenie z płatnym koszykiem poza MVP.
- Bez daty wygaśnięcia pieczątek. Wyłączenie programu zatrzymuje nowe naliczanie; zachowuje saldo i możliwość odbioru obiecanych nagród.
- Warunki programu mają wersje. Każda rozpoczęta karta zachowuje minimum i nagrodę ze swojej wersji, aż saldo zostanie rozliczone. Zmiana warunków obejmuje nowe karty; nie odbiera już zebranych korzyści. W MVP zakaz zmiany waluty lokalu przy otwartych kartach.
- Klient dobrowolnie dołącza przed rozpoczęciem płatności. Płatność bez karty nadal działa. Nie dopisujemy cudzych ani starych zakupów po fakcie.

## User Stories

1. Jako właściciel chcę ustawić produkt nagrodę, aby promować ponowne wizyty.
2. Jako właściciel chcę określić minimalną wartość zakupu, aby program miał sens dla mojego lokalu.
3. Jako klient chcę poznać zasady przed dołączeniem, aby wiedzieć, za co otrzymam nagrodę.
4. Jako klient chcę otrzymać pieczątkę po potwierdzonej płatności, aby nie prosić kasjera o jej dodanie.
5. Jako klient chcę widzieć postęp na karcie lokalu, aby wiedzieć, ile brakuje do nagrody.
6. Jako klient chcę odzyskać kartę po ponownym zalogowaniu tym samym kontem, aby nie stracić postępu po zamknięciu aplikacji.
7. Jako klient płacący USDT chcę korzystać z tej samej karty Nimble, aby nie rozdzielać korzyści według waluty płatności.
8. Jako klient chcę sam zdecydować o użyciu nagrody, aby nie zużyła się bez mojej zgody.
9. Jako kasjer chcę zobaczyć potwierdzony przez serwer odbiór nagrody, aby nie przyjmować zrzutu ekranu jako kuponu.
10. Jako kasjer chcę obsłużyć nagrodę w kolejce przygotowania, aby nie wprowadzać papierowego procesu.
11. Jako klient chcę zachować pieczątki po odrzuceniu odbioru niedostępnej nagrody, aby nie stracić korzyści.
12. Jako właściciel chcę, by zwroty korygowały pieczątki, aby zwrócone zakupy nie finansowały kolejnych nagród.
13. Jako klient chcę zobaczyć powód korekty karty, aby saldo było zrozumiałe.
14. Jako właściciel chcę widzieć liczbę kart, naliczonych pieczątek i odebranych nagród, aby ocenić użycie programu.
15. Jako odwiedzający demo chcę przejść od zakupu do nagrody, aby szybko zrozumieć działanie Nimble.

## Implementation Decisions

### Tożsamość i uprawnienia

Wykorzystać istniejące uwierzytelnienie portfelem i profil klienta Nimble. Karta identyfikowana przez lokal, profil klienta i wersję programu, z izolacją środowiska/sieci. Device ID, adres przesłany w formularzu ani token QR nie są dowodem tożsamości.

Obecny model ma payerUserId, lecz ścieżka QR nie zawsze go zapisuje. Dodać uwierzytelnione dołączenie do karty i związanie jej z zamówieniem przed pierwszą wyceną. Zamrozić powiązanie przy rozpoczęciu płatności; odmówić przejęcia przez inne konto. Dla NIM sprawdzić zgodność z uwierzytelnioną tożsamością płatnika. Dla USDT wymagać dowodu kontroli adresu EVM powiązanego z kontem (podpis jednorazowego wyzwania z domeną, siecią i terminem ważności), nie ufać nimAddress. Nie wymagać EVM przy zakupie NIM. Zmiana konta nie przenosi automatycznie karty; łączenie różnych portfeli poza MVP. Odmowa udziału nie blokuje zwykłej płatności.

Właściciel konfiguruje program; kasjer obsługuje odbiór bez ręcznego dopisywania punktów. Klient czyta wyłącznie własne karty. Kasjer widzi tylko dane potrzebne do aktualnego odbioru, nie historię zakupów klienta. Publiczny checkout nie ujawnia salda, profilu ani historii karty.

### Moduł i dane

Wydzielić moduł lojalnościowy zamiast dokładać całą logikę do dużego ekranu merchant. Kontrakty domenowe obejmują program i jego wersję, kartę, niezmienny dziennik operacji oraz odbiór nagrody. Dziennik zawiera naliczenie +1, korektę zwrotu -1, użycie -5 i przywrócenie anulowanej nagrody +5. Unikalne klucze zdarzeń zapobiegają powtórzeniu operacji dla tego samego zamówienia/odbioru.

Powiązanie programu i klienta zapisywać w niezmiennym kontekście konkretnej rewizji zamówienia. Do kwalifikacji używać opłaconego snapshotu, nie aktualnego koszyka ani kursu. Nowe tabele i nullable powiązania dodać migracją bez zmiany znaczenia starych zamówień.

Publiczne operacje: konfiguracja i wyłączenie programu przez właściciela; lista własnych kart; dołączenie i powiązanie checkoutu; historia własnej karty; rezerwacja nagrody; przyjęcie/anulowanie/wydanie przez kasjera; statystyki właściciela. Wszystkie mutacje z walidacją roli, lokalu, wersji oraz kluczem idempotencji.

### Naliczanie i zwroty

Dopisać pieczątkę w tej samej transakcji bazy, która zatwierdza kwalifikującą się płatność i przejście do przygotowania. Ścieżka obowiązkowego zwrotu nie nalicza nic. Aktualizacja klienta korzysta z istniejącego odświeżania stanu; animacja nie jest źródłem prawdy.

Żądanie zwrotu blokuje możliwość wykorzystania odpowiadającej mu jeszcze nieodjętej pieczątki. Dopiero potwierdzony zwrot dopisuje -1, atomowo ze zmianą statusu zwrotu; blokada wtedy znika. Saldo dostępne = saldo dziennika minus aktywne rezerwacje nagród i blokady oczekujących zwrotów. Saldo może być ujemne, jeśli nagroda została już odebrana: kolejne pieczątki wyrównują korektę. Nigdy nie zmniejszamy należnego zwrotu kryptowaluty. UI wyjaśnia korektę bez pokazywania ujemnej liczby ikon pieczątek.

Jeżeli zwrot uniemożliwia realizację zarezerwowanej, lecz nieprzyjętej nagrody, anulować rezerwację atomowo. Nagrody już przyjętej do przygotowania nie cofać automatycznie — ewentualny deficyt rozliczyć przyszłymi pieczątkami. Stosować jednakową kolejność blokad w rozliczeniu płatności, zwrocie i odbiorze; testować współbieżność.

### Odbiór bez fikcyjnej płatności

Klient rezerwuje nagrodę; saldo pozwala na najwyżej tyle równoległych rezerwacji, ile pokrywa pieczątek. Rezerwacja wygasa po 5 minutach przed przyjęciem przez kasjera. Kasjer skanuje krótkotrwały token przypisany do klienta, lokalu i rezerwacji; serwer sprawdza ważność i ręczną dostępność produktu. Sama znajomość identyfikatora karty nie wystarcza.

Przyjęcie atomowo zużywa pięć pieczątek i tworzy pozycję realizacji typu nagroda z numerem odbioru oraz statusem PREPARING → READY → COLLECTED. Ma wspólny widok kolejki, ale odrębny typ danych od płatnego zamówienia. Nie wysyła transakcji o wartości zero, nie uruchamia wyceny ani nie udaje opłaconej sprzedaży. Ponowny skan zwraca tę samą realizację.

Anulowanie przed wydaniem przywraca pięć pieczątek dokładnie raz. Po wydaniu brak anulowania w MVP. Niedostępność produktu zatrzymuje przyjęcie, bez utraty pieczątek. Usunięcie produktu/variantu obiecanego na otwartej karcie jest blokowane; ręczna niedostępność nadal dozwolona. Powiadomienie 1-luna nie jest wymaganiem MVP nagród; gotowość widoczna w otwartej aplikacji.

### Wygląd i raportowanie

Jasna karta z nazwą lokalu, pięcioma polami pieczątek, nazwą nagrody i jednym głównym działaniem. Stany: brak udziału, zbieranie, nagroda dostępna, rezerwacja, przygotowanie, gotowe, wydane, korekta po zwrocie. Animacje respektują ograniczenie ruchu; status i postęp czytelne także bez animacji i kolorów. Język zgodny z aplikacją.

Raport programu pokazuje karty, naliczenia, korekty i wydane nagrody. Bezpłatne nagrody nie zwiększają sprzedaży fiat/krypto i nie naliczają pieczątek. Zachować osobną liczbę realizacji nagród; nie mieszać ich z liczbą płatnych zamówień ani średnią wartością koszyka. Wyłączenie funkcji nie usuwa danych i nie przerywa zwykłych płatności.

## Testing Decisions

Główna granica testów: publiczne API merchant/loyalty przez Fastify inject z bazą i kontrolowaną bramką płatności, jak w istniejących testach merchant. Sprawdzać to, co klient/kasjer widzi oraz trwałe efekty, nie kolejność prywatnych funkcji. Osobno krótki przepływ UI i test na telefonie. To proponowany zakres testów do przeglądu wraz z planem.

- Pięć poprawnych zamówień → pięć naliczeń → jedna wydana nagroda → zero dostępnych pieczątek.
- Płatność poniżej minimum, niewłaściwa sieć/kwota, duplikat hasha, niepotwierdzony przelew, spóźniona płatność skierowana do zwrotu: bez pieczątki.
- Ponowne zgłoszenie płatności, równoległy worker i restart: dokładnie jedna pieczątka.
- QR i kod płatności dają kartę właściwego zalogowanego klienta; inny profil, lokal, terminal lub token checkoutu nie pozwala przejąć karty.
- USDT: wymagany zweryfikowany związek adresu płatnika z profilem; NIM i USDT z tego samego konta uzupełniają tę samą kartę w danym środowisku.
- Dwa równoległe odbiory ostatnich pięciu pieczątek: tylko jeden zostaje przyjęty. Wygasła rezerwacja zwalnia saldo; ponowne przyjęcie/anulowanie nie tworzy dodatkowych operacji.
- Zwrot przed/po przyjęciu nagrody, zwrot po jej wydaniu oraz równoczesny zwrot/odbiór zachowują reguły salda i pełną kwotę zwrotu.
- Warunki istniejącej karty nie zmieniają się po nowej konfiguracji. Wyłączenie nie usuwa możliwości odbioru.
- Brak sieci nie potwierdza lokalnie naliczenia ani odbioru; po ponownym otwarciu serwer odtwarza stan.
- Raporty sprzedaży pozostają poprawne po wydaniu darmowej nagrody; brak stanów magazynowych i dodatkowych uprawnień do portfela.
- Test równoległych transakcji wykonać także na natywnym PostgreSQL; sam lokalny adapter testowy nie zamyka tej bramki.
- Android/Nimiq Pay: logowanie, QR, płatność, ponowne otwarcie karty, rezerwacja i wydanie; osobno od demonstracji bez pieniędzy.

## Out of Scope

Nowy token/NFT, transfer pieczątek, wspólne karty różnych lokali, automatyczne wypłaty, cashback, ręczne przyznawanie punktów przez kasjera, wiele telefonów kasowych, magazyn, częściowe zwroty, wygasanie punktów, płatne dodatki do darmowej nagrody, obietnica natywnych powiadomień w tle.

## Kolejność realizacji

| Zadanie | Blokowane przez | Działający rezultat |
|---|---|---|
| 01. Program i karta klienta | — | Właściciel konfiguruje program, klient dołącza i widzi własną pustą kartę. |
| 02. Pieczątka po zakupie z korektą zwrotu | 01 | Płatność dopisuje punkt, zwrot koryguje saldo; działają QR i kod. |
| 03. Nagroda od rezerwacji do wydania | 02 | Klient wykorzystuje pięć punktów, kasjer realizuje nagrodę w kolejce. |
| 04. Zmiana programu i raport właściciela | 03 | Istniejące korzyści są zachowane, właściciel widzi faktyczne użycie. |
| 05. Pokaz konkursowy i odbiór całości | 04 | Pełny przepływ demo, dopracowana karta i weryfikacja na urządzeniu. |

Każde zadanie obejmuje dane, API, interfejs i testy swojego zachowania. Bez osobnych etapów „cała baza”, „cały backend”, „cały frontend”. Robocze zgłoszenia znajdują się w skonfigurowanym lokalnym trackerze pod nazwą loyalty-card; nie opublikowano ich na GitHubie.

## Further Notes

Użytkownik zatwierdził regułę „pięć opłaconych zamówień → wybrany wariant gratis” i brak dodatków do nagrody w MVP oraz zlecił realizację zadań. Minimum zakupowe ustala później właściciel konkretnego lokalu. Proponowane testy przy publicznym API wykorzystują już stosowane granice systemu.

Warunek testów płatności na urządzeniu: osobne zadanie zgodności rozpoznawania sieci Nimiq Pay wskazane we wcześniejszym researchu. Nie jest blokadą przygotowania modułu i testów lokalnych, ale musi być rozwiązane przed odbiorem prawdziwego przepływu płatności. Bez automatycznego publikowania i przelewów podczas implementacji.
