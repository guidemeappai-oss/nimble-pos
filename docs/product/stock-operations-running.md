# Dostawy, spisy i straty — MM-12 / MM-13

Data: 2026-10-16. Baza etapu: 8879a96. Skills: implement-spec, tdd, code-review. Implementacja lokalna; bez wdrożenia i push.

## Przepływy na telefonie

Magazyn obsługuje dostawców oraz plan dostawy z ilością w jednostce zasobu (sztuka lub porcja). Kilka częściowych przyjęć zwiększa saldo osobnymi ruchami. Korekta przyjęcia tworzy przeciwny ruch, zachowując oryginał i możliwość ponownego przyjęcia poprawnej ilości. Powody i autorzy pozostają w historii; ponowienie żądania z tym samym kluczem nie powiela operacji.

Cena zakupu jest zapisywana w najmniejszej jednostce waluty lokalu; brak ceny oznacza nieznany koszt, a nie zero. Właściciel lub pracownik z osobnym `inventory.costs` może podać i odczytać cenę. Samo `inventory.manage` pozwala obsługiwać ilości. API ukrywa koszty także w ponowionych odpowiedziach po odebraniu uprawnienia; dziennik audytu nie zawiera cen zakupu.

Zasobom można przypisać kod i wyszukać go ręcznie albo aparatem. Kamera włącza się po naciśnięciu przycisku i wyłącza po odczycie lub opuszczeniu ekranu. Obsługa aparatu zależy od przeglądarki telefonu; ręczne wpisywanie pozostaje dostępne. Zdjęcia kodów nie są zapisywane.

## Spis i ruchy w trakcie liczenia

Spis zachowuje ilość i rewizję z chwili otwarcia. Liczona ilość dotyczy tego momentu odniesienia. Przykład: otwarcie 24, wynik liczenia 22, późniejsza dostawa +10 daje po uzgodnieniu 32. Gdy dostawa poprzedziła fizyczne liczenie, trzeba najpierw uzgodnić jej wpływ na wynik dla chwili otwarcia; aplikacja nie potrafi samodzielnie ustalić momentu liczenia.

Podgląd pokazuje stan otwarcia, aktualny stan, późniejsze ruchy i wynik po korekcie. Późniejsze ruchy wymagają jawnego potwierdzenia i aktualnej rewizji. Zmiana po podglądzie blokuje zapis do ponownego sprawdzenia. Nierozstrzygnięte zgłoszenia strat blokują otwarcie oraz zakończenie spisu dla tych pozycji, aby nie odejmować tej samej straty dwukrotnie.

## Straty i akceptacja

Powody obejmują uszkodzenie, rozlanie, przeterminowanie, posiłek pracowniczy, darowiznę i korektę. Wymagane są ilość i opis. Właściciel ustala próg ilościowy dla jednej operacji; domyślnie wynosi zero. To nie jest dzienny limit. Operacje poniżej progu mogą być wykonane przez uprawnionego kierownika, większe zgłoszenia czekają na decyzję właściciela. Oczekujące zgłoszenie nie odejmuje jeszcze salda; przy zatwierdzaniu zapas jest ponownie sprawdzany.

Próg obejmuje również ujemne korekty ręczne, odwracanie dodatnich ruchów, sumę niedoborów spisu (nadwyżki jej nie pomniejszają) i korekty przyjęć. Większy niedobór spisu lub korektę przyjęcia kończy właściciel z powodem. Ruchy dostaw, spisów i strat nie mogą być odwracane ogólnym przyciskiem historii.

## Granice i odbiór

To nadal ewidencja zasobów. MM-10b połączy zasoby z wariantami i zestawami, MM-11 doda rezerwację i rozchód sprzedaży. Dostawa odświeża saldo magazynu, ale jeszcze nie zmienia automatycznie dostępności pozycji menu. Zwrot płatności nie odtwarza fizycznego towaru. Przed integracją sprzedaży należy osobno uwzględnić ilości zgłoszone jako straty oczekujące na decyzję.

Rozliczenie jedzenia na koniec zmiany ze zdjęciami (MM-21) nadal wymaga MM-11 oraz integracji z zadaniami MM-20. Zdjęcie jest dokumentacją do oceny człowieka, nie dowodem wykluczającym kradzież.

Uruchomienie wymaga zastosowania migracji 0021 po wcześniejszej 0020. Fizyczny test Android/Nimiq Pay i kamery oraz test współbieżności na niezależnych sesjach natywnego PostgreSQL pozostają odbiorem środowiskowym.

## Wyniki odbioru lokalnego

Pełna regresja po integracji: API **231/231**, web **191/191**, shared **42/42** — razem **464/464**. TypeScript API/web oraz build produkcyjny przechodzą. Build ostrzega o pakiecie głównym 623,67 kB; podział pakietu pozostaje optymalizacją przed dalszym rozrostem.

### Review Spec

Trzy ustalenia naprawione: nakładające się spisy mogły dwukrotnie odjąć niedobór; potwierdzenie późniejszych ruchów było w niewłaściwym miejscu żądania; cena w centach/groszach była wyświetlana jako pełna waluta. Dodano regresje blokady spisów, parsowania rzeczywistego żądania przez wspólny schemat i formatowania cen. Ponowny przegląd bez pozostałych ustaleń w tym zakresie.

### Review Standards

Brak twardych naruszeń udokumentowanych zasad. Naprawiono błąd przejścia między zakładkami z różnymi typami danych oraz potwierdzenie spisu wskazane także przez tę oś. Słabe typowanie żądania spisu zastąpiono kontrolą zgodności z typem wynikającym ze wspólnego schematu. Regresja przejścia z wypełnionej listy dostawców do dostaw przechodzi. Ponowny przegląd bez pozostałych ustaleń w sprawdzonym zakresie.

Testy API korzystają z lokalnego PGlite. Nie zastępują odbioru na niezależnych sesjach PostgreSQL ani na fizycznym telefonie. Istniejący zmodyfikowany screenshot remote-acceptance.png pozostawiono poza commitami.
