# Grupy wyborów i zestawy — MM-06

Data: 2026-10-16. Baza: 982b404. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, codebase-design, code-review. Status: ukończone lokalnie, bez wdrożenia i push.

## Ustalone zachowanie

Grupa wyborów porządkuje istniejące dodatki produktu. Ma nazwę oraz minimum i maksimum wybranych opcji. Minimum większe od zera oznacza obowiązkowy wybór. Dodatek należy najwyżej do jednej grupy; dodatki poza grupami pozostają opcjonalne. Koszyk nadal przekazuje identyfikatory wybranych dodatków, a jedna wspólna reguła sprawdza je dla POS i zamówień zdalnych.

Zestaw jest produktem z własnymi wariantami i ceną oraz wskazaniem konkretnych produktów, wariantów i ilości składowych. Opcja wyboru może także wskazywać składową, np. „espresso” bez dopłaty albo „latte” z dopłatą. Cena wariantu zestawu obejmuje składowe stałe; dodajemy tylko jawne dopłaty wybranych opcji. Nie dodajemy drugi raz cen detalicznych składowych.

Zapis zamówienia zachowuje nazwy, identyfikatory, ilości składowych i naliczone dopłaty. Ilość składowej jest określona na jedną sztukę zamawianego zestawu. Powtarzające się odwołania są agregowane według produktu i wariantu. Nie rozwijamy zagnieżdżonych zestawów; odwołanie musi opisywać prosty wariant, którego realizacja nie wymaga dalszych obowiązkowych wyborów.

## Lojalność i granice

Zakup zestawu korzysta z istniejącego rozliczenia całego zamówienia; składowe nie tworzą dodatkowych zakupów lub pieczątek. Zestaw i produkt z obowiązkowymi wyborami nie są w tym etapie nagrodą lojalnościową. Istniejącej obietnicy nagrody nie można po cichu zamienić na produkt wymagający dopłat lub wyboru składu. Dopłaty są naliczane raz, bez nowego mechanizmu rabatów; MM-26 pozostaje odrębnym etapem.

Odwołania do produktów i wariantów przygotowują MM-10b do wiązania ze wspólnymi zasobami. Nie odejmują jeszcze magazynu. MM-11 doda atomową rezerwację i rozchód sprzedaży. Wymagania fizycznego odbioru Android/Nimiq Pay oraz testu współbieżności natywnego PostgreSQL pozostają otwarte.

## Scenariusz odbioru

1. Utworzyć proste produkty: kanapkę, espresso i latte.
2. W szkicu menu utworzyć zestaw śniadaniowy z własną ceną, jedną kanapką jako składową stałą i grupą „Napój” wymagającą jednej opcji.
3. Powiązać opcję espresso z jego wariantem i dopłatą zero, latte z jego wariantem i dopłatą np. 1 EUR.
4. Zapisać, sprawdzić podgląd i opublikować menu. Sprawdzić identyczne ograniczenia w POS i online: brak napoju oraz dwie opcje przy maksimum jeden są odrzucane.
5. Kupić dwa zestawy z latte. Cena obejmuje dwie ceny zestawu i dwie dopłaty, bez ponownego dodawania cen kanapki i latte.
6. Sprawdzić skład zapisany w zamówieniu. Zmiana późniejszego menu nie zmienia już przyjętego zapisu.
7. Wyłączyć prostą składową. Nowego niewykonalnego zestawu nie można kupić; istniejące opłacone zamówienie zachowuje zapis.


## Uruchomienie i demonstracja

Nie ma nowej migracji SQL: nowe opcjonalne pola są przechowywane w istniejących dokumentach katalogu, wersji menu i zamówienia. Starsze produkty bez grup/składowych zachowują dotychczasowe zachowanie. Edycja wymaga `menu.manage`; obowiązują szkic, podgląd i atomowa publikacja MM-04. Walidacja obejmuje całe przyszłe menu, więc nie da się usunąć wariantu potrzebnego w zestawie ani wskazać produktu innego lokalu. Zagnieżdżenia i odwołania do siebie są odrzucane.

Demo terminala i demo zamówień zdalnych zawierają „Morning ritual”. Ich ceny są przykładami, a płatności pozostają symulacją. Sposób liczenia ceny i składu korzysta z tego samego modułu co API. Ekran wyboru pokazuje wymagane grupy i limity; niedostępna składowa blokuje odpowiednią opcję lub dodanie zestawu. Podsumowanie pokazuje ilości fizycznych składowych dla całej linii zamówienia.

## Walidacja

Zweryfikowano **491 różnych testów**: API **243**, web **203**, shared **45**. W pełnym przebiegu API 240 przypadków przeszło od razu, a 3 testy startu procesu początkowo nie widziały nowych eksportów shared przez alias osobnego worktree. Po scaleniu kanonicznego kodu powtórzono cały plik `hardening.test.ts`: **8/8**, w tym te 3 przypadki. Nie doliczamy ponowionych przypadków do sumy. Pełny web i shared przeszły na scalonym kodzie. TypeScript API/web oraz build produkcyjny przechodzą. Build ostrzega o głównym pakiecie 642,27 kB; podział pozostaje optymalizacją wydajności.

Testy obejmują wybory min/max i dopłaty w POS i online, niedostępność składowej, zależne warianty, izolację lokali, uprawnienia, ochronę nagrody lojalnościowej oraz pojedynczą pieczątkę za opłacone zamówienie kilku zestawów, także po ponowieniu płatności. Test demo potwierdza skład na jedną jednostkę, sumę za dwie sztuki i niezmienność nazwy po zmianie katalogu. Zachowano walidację całkowitej ilości w demo.

### Review Spec

Brak potwierdzonych usterek po przeglądzie finalnych reguł, publicznych ścieżek zakupu i snapshotów. Reguły grup oraz zestawów korzystają ze wspólnego modułu. Automatyczny rozchód magazynu pozostaje poza zakresem zgodnie z zależnościami.

### Review Standards

Brak twardych naruszeń udokumentowanych zasad i brak pozostałych uwag blokujących po ponownym przeglądzie. Wspólny predykat usuwa powielenie reguł kwalifikacji składowej/nagrody. Rozwinięto edytor składu dla czytelności; demonstracja korzysta z kanonicznej wyceny, zachowując kontrolę ilości. Uporządkowano identyfikatory demo, aby edycja całego menu przechodziła tę samą walidację referencji.

Testy API używają lokalnego PGlite. Nie wykonano wdrożenia, rzeczywistych płatności ani fizycznego odbioru Android/Nimiq Pay. Test niezależnych sesji natywnego PostgreSQL pozostaje warunkiem odbioru przyszłej ochrony ostatniej porcji. Istniejący zmodyfikowany screenshot remote-acceptance.png pozostawiono poza commitami.
