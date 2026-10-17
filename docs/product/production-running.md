# PL-16 — produkcja i półprodukty

2026-10-17. Lokalnie zintegrowane; PL-02 nie został zaliczony.

Jedna transakcja zapisuje zużycie niezmiennej wersji receptury, liczbę partii, planowany i rzeczywisty uzysk oraz stratę uzysku. Wszystkie zasoby, w tym wyjście, blokowane w tej samej kolejności ID co checkout. Brak surowca, rezerwacja lub przekroczony limit wycofuje całość. Rejestr PRODUCTION przechowuje aktora, czas, powód, wersję i dokładny koszt. Półprodukt stanowi zwykły zasób ITEM w kolejnej recepturze; referencja RECIPE rozwija składniki, a nie zużywa wyprodukowanego zapasu. Graf zależności zarejestrowanych produkcji odrzuca bezpośrednie i pośrednie cykle.

Średni koszt surowców trafia do gotowego zapasu jako dokładny ułamek koszt/uzysk. Brak ceny pozostaje nieznany. Sprzedaż produktu powiązanego z gotową porcją odejmuje tę porcję; surowce nie są odejmowane drugi raz. Wyjątek: produkt jawnie przypięty do receptury nadal oznacza przygotowanie na zamówienie, więc konfigurację wybiera właściciel.

Właściciel może cofnąć błędny wpis z powodem, jeśli całość gotowego uzysku jest dostępna. Usunięcie uzysku i przywrócenie surowców/cen zachodzi atomowo, z oznaczeniem REVERSED; ponowienie klucza zwraca wynik, drugi klucz nie ponawia skutku. To korekta błędnego wpisu, nie automatyczny zwrot surowców po rzeczywistej stracie. Historia grafu obejmuje też cofnięte wpisy.

UI: Magazyn → Produkcja i półprodukty. Podgląd wymagań, rzeczywiste ilości i strata, paginowana historia, korekta właściciela. Niepewna odpowiedź blokuje nowy wpis i zachowuje dokładną operację do retry. Zmiana sesji czyści stan. Koszt jest ukryty bez inventory.costs; audyt nie ujawnia cen.

Testy API production+recipes8/8: atomowość, brak zasobu, obcy lokal, cykl, retry/równoczesna korekta, odmowa cofnięcia wykorzystanego uzysku, dokładny koszt, brak drugiego rozchodu po sprzedaży oraz uprawnienia/ukrycie kosztów. UI production+inventory10/10; typy i build zaliczone. Rozszerzony Chromium9/9 obejmuje rzeczywistą produkcję i sprawdza końcowe stany przez API. Trwa pełna regresja; dwa testy grafiku w obciążonym przebiegu przekroczyły5sekund i wymagają osobnego ponowienia.

Przegląd integracji zabezpieczył także bezpośredni endpoint cofania ruchów: PRODUCTION i PRODUCTION_REVERSAL wymagają korekty całej partii, nie mogą przywrócić samych surowców. Publiczny test próby obejścia przechodzi. Izolowane schedules+production8/8 po dwóch timeoutach grafiku w pełnym przebiegu (328/330). Wynik timeoutów nie jest ukrywany ani uznany za zaliczenie pełnej regresji; końcowy przebieg należy ponowić bez równoległego obciążenia.
