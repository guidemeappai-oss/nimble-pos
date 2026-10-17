# Nimble — plan zarządzania lokalem z telefonu

Opracowano 2026-10-16 na podstawie ustaleń z 15 października. Baza: da53a1f. Skills: to-spec i to-tickets. Status: realizacja etapami. Ukończono lokalnie MM-01, MM-04, MM-06, MM-10 (10a i 10b), MM-12, MM-13, MM-19 i MM-20. MM-11 zaimplementowano lokalnie; odbiór natywnego PostgreSQL nadal otwarty. Aktualne wyniki w merchant-management-running.md. Tracker lokalny: .scratch/merchant-management/issues/. Brak publikacji zewnętrznych zgłoszeń.

## Problem Statement

Właściciel potrzebuje kontroli nad menu, kolejką, płatnościami, zespołem i zapasami z telefonu. Pracownicy potrzebują jasnych zadań, możliwości udokumentowania wykonania i przekazania otwartych spraw. Właściciel chce zdjęć sprzątania oraz rozliczenia niesprzedanej żywności, aby ograniczyć niewyjaśnione ubytki.

## Solution

Pięć sekcji mobilnych: Dziś, Zamówienia, Menu, Magazyn, Więcej (zespół, zadania, rozliczenia). Właściciel korzysta z własnego telefonu, kasjerzy z przypisanego telefonu lokalu. Nowa rola kierownika ma delegowane uprawnienia operacyjne. Wypłaty nadal podpisuje wyłącznie właściciel.

Magazyn jest świadomym rozszerzeniem wcześniejszego MVP bez stanów. Plan obejmuje wszystkie pomysły z merchant-management-research.md, rozłożone na 31 zadań z mierzalnymi kryteriami. Numery nie oznaczają jednego wielkiego wdrożenia. Szczegółowe estymacje powstają przy projektowaniu konkretnego etapu, nie jako pozorna obietnica terminu całej mapy.

## Fale realizacji

| Fala | Rezultat | Zadania |
| --- | --- | --- |
| A | Uprawnienia, pulpit i kontrola kolejki | 01–03 |
| B | Menu operacyjne i promocje | 04–07, 26 |
| C | Realizacja i pierwszy magazyn | 08–13 |
| D | Zadania ze zdjęciami i rozliczenie końca dnia | 19–23 |
| E | Składniki, produkcja i zaopatrzenie | 14–18 |
| F | Płatności, obsada i ekonomia lokalu | 24–30 |
| G | Końcowy odbiór integracji | 31 |

Fale są rekomendacją; wiążące zależności zawiera backlog. Zadania 19–20 (zdjęcia sprzątania) można realizować już po 01. Zdalny podgląd i centrum płatności także mogą powstać wcześniej niż pełny magazyn. Odbiór każdej fali jest obowiązkowy; 31 nie odkłada testów do końca projektu.

Najkrótsza ścieżka zdjęć: 01 → 19 → 20. Rozliczenie jedzenia dodatkowo potrzebuje 04 → 06 → 10 → 11 oraz 13 → 21. Pierwszy magazyn gotowych porcji nie wymaga receptur.

## User Stories

1. Jako właściciel chcę delegować prawa operacyjne, aby zarządzać zespołem bez oddawania kontroli nad utargiem.
2. Jako właściciel chcę widzieć bieżącą sytuację na własnym telefonie, aby reagować bez przebywania przy kasie.
3. Jako kierownik chcę regulować przyjmowanie zamówień, aby dopasować kolejkę do wydajności lokalu.
4. Jako właściciel chcę przygotować menu przed publikacją, aby uniknąć przypadkowych cen podczas sprzedaży.
5. Jako właściciel chcę planować dostępność produktów, aby sprzedawać właściwe menu o właściwej porze.
6. Jako właściciel chcę tworzyć zestawy i reguły dodatków, aby sprzedawać poprawne kombinacje.
7. Jako właściciel chcę uzupełniać prezentację produktów, aby publikować czytelne menu.
8. Jako kasjer chcę widzieć kontekst realizacji, aby nie zgubić ustaleń z klientem.
9. Jako kasjer chcę oznaczać gotowe pozycje, aby koordynować przygotowanie zakupu.
10. Jako kasjer chcę znać dostępne ilości, aby nie oferować brakującego towaru.
11. Jako klient chcę mieć zarezerwowany produkt podczas płatności, aby uniknąć zapłaty za sprzedany towar.
12. Jako kierownik chcę przyjmować dostawę telefonem, aby zwiększać zapas z prawidłowym kosztem.
13. Jako kierownik chcę rozliczać różnice zapasu, aby utrzymywać wiarygodny magazyn.
14. Jako właściciel chcę powiązać produkty ze składnikami, aby znać zużycie po sprzedaży.
15. Jako kierownik chcę rejestrować przygotowanie partii, aby zamieniać składniki w gotowe produkty.
16. Jako kasjer chcę wyłączać brakujący składnik, aby zatrzymać niewykonalne zamówienia jednym działaniem.
17. Jako kierownik chcę widzieć partie z bliskim terminem, aby ograniczać przeterminowanie.
18. Jako kierownik chcę przygotowywać zakupy według braków, aby uzupełniać właściwy towar.
19. Jako kierownik chcę przydzielać czynności na zmianę, aby ustalić odpowiedzialność za wykonanie.
20. Jako pracownik chcę dołączyć zdjęcie wykonanej czynności, aby przekazać dokumentację kierownikowi.
21. Jako kierownik chcę uzgadniać pozostałe jedzenie z magazynem, aby zatwierdzać rozliczenie końca dnia.
22. Jako kasjer chcę przekazać otwarte sprawy następcy, aby zachować ciągłość obsługi.
23. Jako kierownik chcę zamknąć dzień operacyjny, aby wiedzieć co pozostaje do rozwiązania.
24. Jako właściciel chcę widzieć płatności wymagające działania, aby rozwiązywać problemy bez szukania transakcji.
25. Jako właściciel chcę uzgodnić sprzedaż z przepływami, aby znać zobowiązania lokalu.
26. Jako kierownik chcę udzielać dozwolonych rabatów, aby rozwiązywać sytuacje klienta w ramach zasad.
27. Jako kierownik chcę planować obsadę, aby zapewnić pracowników w godzinach otwarcia.
28. Jako pracownik chcę rejestrować pracę i przerwy, aby mieć czytelną ewidencję czasu.
29. Jako właściciel chcę znać ekonomię menu, aby podejmować decyzje o cenach.
30. Jako właściciel chcę otrzymywać uzasadnione propozycje, aby ograniczać braki i nadprodukcję.
31. Jako właściciel chcę korzystać ze spójnego systemu na telefonie, aby prowadzić lokal bez utraty danych między modułami.

## Implementation Decisions

### Role i ślad operacji

Serwer egzekwuje prawa per lokal; ukryty przycisk nie jest ochroną. Rozszerzenie ADR 0002 o kierownika i delegowanie menu/magazynu zapisujemy przed włączeniem roli. Każda istotna operacja ma aktora, czas serwera, powód i idempotencję. Uprawnienia do zdjęć, kosztów i raportów są niezależne. Cofnięcie dostępu obowiązuje także dla wcześniej zalogowanej osoby. Korekty tworzą nowy wpis, nie kasują historii.

### Magazyn i płatność

Nowe pojęcia: zasób magazynowy, jednostka, ruch, rezerwacja, spis, dostawa, receptura i wersja, partia, produkcja, rozliczenie dnia. Saldo fizyczne, rezerwacje i ilość wyłączona ze sprzedaży są oddzielne; dostępność wynika z ich uzgodnienia. Pieniądze i ilości mają stałą precyzję. Opcja bez śledzenia pozostaje dostępna.

Propozycja do implementacji: rezerwacja atomowa przy wydaniu wyceny; limit otwartych rezerwacji i czas ważności zapobiegają bezterminowemu blokowaniu. Odświeżenie wyceny nie rezerwuje drugi raz. Zgłoszona transakcja utrzymuje rezerwację do rozliczenia, a nie do zamknięcia ekranu klienta. Trzeba ustalić ograniczony czas obsługi transakcji nierozstrzygniętej oraz ścieżkę wyjątku przed wydaniem MM-11. Potwierdzona płatność REMOTE utrzymuje rezerwację do decyzji; akceptacja zamienia ją w rozchód. COUNTER rozlicza przy potwierdzeniu płatności. To moment ewidencji, nie dowód fizycznego przygotowania.

Odmowa przed przygotowaniem zwalnia rezerwację. Zwrot pieniędzy po przygotowaniu nie odtwarza jedzenia: zwrot towaru, strata i korekta są odrębnymi operacjami. Późna wpłata po zwolnieniu zapasu nie odbiera towaru innemu zamówieniu; przypadek niemożliwy do realizacji przechodzi do istniejącego procesu zwrotu.

Receptura jest zamrożona dla operacji. Produkt przygotowany na zamówienie zużywa składniki; produkt z wyprodukowanej partii zużywa gotową porcję, bo surowce odjęto już przy produkcji. Nie odejmujemy obu. Zestawy i warianty wskazują wspólny zapas. Każdy moduł dostaw, spisów i strat ma idempotencję oraz test współbieżności istotnych ruchów.

### Dzień, zmiana i czas pracy

Lokal ma strefę czasową i godzinę końca dnia operacyjnego. Zmiana kasowa, dzień operacyjny, sesja logowania i czas pracy są osobnymi pojęciami. Spis utrwala punkt odcięcia i uzgadnia ruchy powstałe w trakcie liczenia. Zamknięcie dnia nie usuwa zobowiązań; późne potwierdzenia płatności/zwrotów pozostają widoczne jako późniejsze zdarzenia. Grafik nie zastępuje ewidencji pracy.

### Zadania ze zdjęciami

Szablon: instrukcja, harmonogram, wykonawca lub rola, termin, wymagane zdjęcia przed/po oraz odbierający. Instancja zachowuje wersję instrukcji. Stany: DO_WYKONANIA → W_TOKU → DO_WERYFIKACJI → ZATWIERDZONE; zwrot do POPRAWY tworzy kolejną wersję zgłoszenia. POMINIĘTE wymaga uprawnienia i powodu. Pracownik widzi komentarz i status. Autor nie odbiera własnego zgłoszenia; lokal jednoosobowy może użyć oznaczonej deklaracji właściciela, bez pozorowania niezależnej kontroli.

Sprzątanie toalety: zadanie o wyznaczonej godzinie, czynności według listy, zdjęcie pustego pomieszczenia po wykonaniu, zgłoszenie, ocena kierownika. Zdjęcia mają przedstawiać rezultat pracy, bez osób, klientów, dokumentów i intymnych sytuacji. Nie przewidujemy automatycznego fotografowania ani monitorowania pracownika w tle.

Brak zdjęcia może wstrzymać zatwierdzenie konkretnej checklisty, ale nie zakończenie czasu pracy ani wylogowanie. Awaria kamery lub sieci daje stan niewysłane albo zgłoszony wyjątek do kierownika; nie pokazuje fałszywego wykonania. Właściciel może zaakceptować odstępstwo z powodem.

### Rozliczenie żywności i zdjęcia utylizacji

Przykład: stan oczekiwany 8 kanapek; pracownik policzył 7. Z tego 4 pozostawia, 2 przeznacza do utylizacji, 1 do zatwierdzonego posiłku. Suma kategorii wynosi 7, a brakująca sztuka tworzy różnicę do wyjaśnienia. System zachowuje wszystkie trzy wartości zamiast poprawiać oczekiwanie na 7.

Przepływ: snapshot zapasu i rezerwacji na dzień → liczenie → podział ilości → powód i zdjęcia → zgłoszenie → akceptacja lub poprawa. Właściciel ustala politykę kategorii: pozostawienie na kolejny dzień, utylizacja, przekazanie lub zatwierdzony posiłek pracowniczy. Nie wymuszamy niszczenia całej niesprzedanej żywności. Wymagane warunki pozostawienia/termin przydatności podaje lokal.

Utylizacja zapisuje ilość, produkt/partię, powód, zdjęcie przed oraz rezultat po według szablonu. Możliwy dodatkowy świadek. Ilość zgłoszona do utylizacji zostaje wyłączona ze sprzedaży; zatwierdzenie księguje rozchód tylko raz. Jeśli żywność już zniszczono, odrzucenie dokumentacji pozostawia sprawę do wyjaśnienia i nie przywraca zapasu automatycznie. Korekta wymaga rzeczywistego sprawdzenia.

Zdjęcie jest dokumentacją do oceny człowieka. Samo nie potwierdza czystości, pełnej ilości, zniszczenia ani braku kradzieży. Niezgodność tworzy sprawę do wyjaśnienia, nigdy automatyczne oskarżenie czy sankcję. Nie projektujemy rozpoznawania twarzy ani scoringu uczciwości.

### Załączniki: zapis, dostęp i retencja

Metadane w bazie, obrazy w prywatnym magazynie obiektowym; oddzielona przestrzeń dla publicznych zdjęć menu. Upload → walidacja typu/rozmiaru → finalizacja i przypisanie do zgłoszenia. Krótkotrwały dostęp wymaga uprawnienia, a sam identyfikator pliku nie wystarcza. Limity kosztu i czyszczenie porzuconych uploadów są częścią funkcji.

Preferowana kamera w aplikacji; import z galerii jako jawnie oznaczony wyjątek zgodnie z polityką lokalu. Czas serwera oznacza przyjęcie pliku, nie zweryfikowany moment zdjęcia. Usuwamy EXIF i nie wymagamy geolokalizacji. Hash identycznego pliku może wskazać duplikat do sprawdzenia, nie dowodzi oszustwa.

Proponowane parametry: do 4 zdjęć na zgłoszenie, do 10 MB na wejściu, skompresowana wersja i miniatura; retencja 30 dni jako parametr produktowy, nie deklarowany obowiązek prawny. Konfiguracja i ograniczone przedłużenie dla otwartej sprawy z autorem/powodem. Usuwanie obejmuje obiekty, miniatury i cykl kopii zgodnie z przyjętą polityką; audyt może zachować informację o usunięciu bez zdjęcia.

Pierwsza wersja nie przechowuje trwałej kolejki prywatnych zdjęć offline na wspólnym telefonie. Niewysłane zdjęcie ma jasny status; użytkownik jest uprzedzony o utracie przy opuszczeniu widoku. Ponowienie jest bezpieczne, zgłoszenie nie przechodzi w ukończone przed zapisem wymaganych plików. Zmiana kasjera usuwa podglądy i dane poprzednika z pamięci. Test na rzeczywistym hoście jest bramką MM-20.

### Finanse i analiza

Oddzielamy sprzedaż, wpłatę, zobowiązanie i faktyczny zwrot. NIM i USDT nie są dodawane jako jedna ilość; fiat korzysta z historycznej wyceny. Proponowana wycena magazynu: średnia ważona dostaw, konsekwentnie stosowana do rozchodu i produkcji; zapisać ostateczną decyzję przed MM-29. Marża składnikowa nie jest zyskiem netto; brak kosztów nie oznacza zera. Podpowiedzi pokazują podstawę i wymagają zatwierdzenia; nie składają zamówień samodzielnie.

### Migracje i kolejność kontraktów

Rozbudowujemy obecne granice katalogu, zamówień, pracowników i raportów. Dwie nowe domeny: ruchy/rezerwacje magazynowe oraz zadania/zgłoszenia/załączniki. Każdy ticket obejmuje potrzebny schemat, API, UI i test zamiast oddzielnego wdrażania pustych warstw. Migracje addytywne; magazyn zaczyna od jawnego stanu otwarcia, nie zgaduje historii z dawnych zamówień. Moduły za flagami. Wyłączenie modułu zatrzymuje nowe operacje, zachowując rozliczanie rozpoczętych. Rollback nie kasuje ruchów ani dowodów.

## Testing Decisions

Używamy istniejących granic: Fastify inject z testową bazą, interakcje React i E2E kluczowych ścieżek. Nowa granica: publiczne upload/finalizacja/odczyt/usunięcie przez testowy storage. Fizyczny Android/Nimiq Pay weryfikuje kamerę, pamięć, uprawnienia i przełączanie profili.

Obowiązkowe scenariusze: ostatnia sztuka POS/online, opóźniona płatność, retry dostawy/rozchodu, zestawy, różne receptury i partie, spis podczas sprzedaży, zdjęcie sprzątania i poprawa, rozliczenie części zapasu, odrzucenie dokumentacji zniszczonego jedzenia, dwukrotna akceptacja, cudzy lokal/załącznik, zmiana pracownika w trakcie uploadu, retencja, północ i zmiana czasu. Rzeczywista współbieżność wymaga niezależnych sesji PostgreSQL. Brak wyniku urządzenia/bazy to otwarta bramka, nie test zaliczony.

## Backlog

| Zadanie | Rezultat | Blokowane przez |
| --- | --- | --- |
| [MM-01](../../.scratch/merchant-management/issues/01.md) | Role kierownika i dziennik decyzji | — |
| [MM-02](../../.scratch/merchant-management/issues/02.md) | Mój lokal teraz i zdalny podgląd | 01 |
| [MM-03](../../.scratch/merchant-management/issues/03.md) | Tryb dużego ruchu | 01, 02 |
| [MM-04](../../.scratch/merchant-management/issues/04.md) | Wersje menu i edycja zbiorcza | 01 |
| [MM-05](../../.scratch/merchant-management/issues/05.md) | Harmonogram menu i czasowa dostępność | 04 |
| [MM-06](../../.scratch/merchant-management/issues/06.md) | Grupy wyborów i zestawy | 04 |
| [MM-07](../../.scratch/merchant-management/issues/07.md) | Zdjęcia menu, alergeny i języki | 04 |
| [MM-08](../../.scratch/merchant-management/issues/08.md) | Priorytety, notatki i historia zamówienia | 01 |
| [MM-09](../../.scratch/merchant-management/issues/09.md) | Gotowość pozycji zamówienia | 08 |
| [MM-10](../../.scratch/merchant-management/issues/10.md) | Licznik porcji i historia zapasu | 01, 06 |
| [MM-11](../../.scratch/merchant-management/issues/11.md) | Ochrona ostatniej porcji | 10 |
| [MM-12](../../.scratch/merchant-management/issues/12.md) | Dostawy i dostawcy | 10a |
| [MM-13](../../.scratch/merchant-management/issues/13.md) | Straty i inwentaryzacja | 10a |
| [MM-14](../../.scratch/merchant-management/issues/14.md) | Receptury i zużycie dodatków | 11, 12 |
| [MM-15](../../.scratch/merchant-management/issues/15.md) | Produkcja i półprodukty | 14 |
| [MM-16](../../.scratch/merchant-management/issues/16.md) | Brak składnika steruje menu | 14 |
| [MM-17](../../.scratch/merchant-management/issues/17.md) | Partie i terminy przydatności | 12, 15 |
| [MM-18](../../.scratch/merchant-management/issues/18.md) | Lista zakupów i zamówienia dostaw | 12, 16 |
| [MM-19](../../.scratch/merchant-management/issues/19.md) | Zadania i checklisty pracowników | 01 |
| [MM-20](../../.scratch/merchant-management/issues/20.md) | Zdjęcia i odbiór wykonania zadania | 19 |
| [MM-21](../../.scratch/merchant-management/issues/21.md) | Rozliczenie jedzenia ze zdjęciami | 11, 13, 20 |
| [MM-22](../../.scratch/merchant-management/issues/22.md) | Przekazanie zmiany | 08, 19 |
| [MM-23](../../.scratch/merchant-management/issues/23.md) | Zamknięcie dnia i wyjątki | 21, 22 |
| [MM-24](../../.scratch/merchant-management/issues/24.md) | Centrum wyjątków płatniczych | 01, 02 |
| [MM-25](../../.scratch/merchant-management/issues/25.md) | Rozliczenie finansowe i eksport | 23, 24 |
| [MM-26](../../.scratch/merchant-management/issues/26.md) | Rabaty i limity zgody | 01, 06 |
| [MM-27](../../.scratch/merchant-management/issues/27.md) | Grafik i zastępstwa | 01 |
| [MM-28](../../.scratch/merchant-management/issues/28.md) | Czas pracy i korekty | 27 |
| [MM-29](../../.scratch/merchant-management/issues/29.md) | Koszt produktów, marża i straty | 14, 15, 25 |
| [MM-30](../../.scratch/merchant-management/issues/30.md) | Podpowiedzi zakupów i przygotowania | 17, 18, 29 |
| [MM-31](../../.scratch/merchant-management/issues/31.md) | Odbiór integracji i wdrażanie etapami | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30 |

## Out of Scope

Pełna księgowość i płace, dostawa do klienta, rezerwacje stolików, terminal kartowy, automatyczne wypłaty, ciągły monitoring, rozpoznawanie twarzy, automatyczne oskarżenia pracowników. Częściowa gotowość nie dodaje częściowych zwrotów. OCR faktur i generowanie tłumaczeń AI są opcjonalnym przyszłym rozszerzeniem, nie warunkiem realizacji opisanych funkcji.

## Further Notes

Parametry oznaczone jako proponowane należy rozstrzygnąć w konkretnym etapie: limit i czas nierozstrzygniętych rezerwacji, metoda kosztu, polityka zdjęć/retencji oraz reguły rozliczenia jedzenia. Nie wymagają zatrzymania przygotowania mapy. Plan nie oznacza już wdrożonych funkcji. Pierwszym zadaniem implementacyjnym jest MM-01; MM-19 i MM-20 pozwalają następnie szybko pokazać nowy przepływ zdjęć.

## Etapowanie magazynu — 2026-10-16

Na ścieżce magazynu wydzielono [MM-10a](../../.scratch/merchant-management/issues/10a.md): ręczne zasoby gotowych sztuk i historia, zależne tylko od ukończonego MM-01. Nie wymaga to wersjonowania menu ani zestawów. Pozostała część MM-10b zachowuje zależność od MM-06, a automatyczne rezerwacje i rozchody należą do MM-11. Nie oznacza to wyłączenia wcześniejszych kryteriów ani zamknięcia całego MM-10.

Doprecyzowanie po MM-10a: MM-12 i MM-13 mogą korzystać z podstawowych zasobów bez zestawów. MM-21 zależy dodatkowo od MM-11, aby stan oczekiwany uwzględniał rzeczywistą sprzedaż; sama ręczna ewidencja nie wystarcza do takiego rozliczenia.
