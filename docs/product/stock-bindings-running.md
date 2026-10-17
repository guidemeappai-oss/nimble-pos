# Wspólny zapas menu — MM-10b

Aktualizacja: późniejszy etap [MM-11](stock-reservations-running.md) dodaje rezerwacje i rozchód; poniższy opis dotyczy wcześniejszego etapu.

Data: 2026-10-16. Baza: b9941f3. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, code-review. Status: ukończone lokalnie, bez wdrożenia i push.

## Zachowanie

Wariant produktu może wskazywać zasoby magazynowe i całkowite ilości potrzebne na jedną sztukę produktu. Dwa warianty mogą wskazywać ten sam zasób; nie tworzymy kopii jego salda. Zwykły dodatek także może mieć własne powiązanie. Brak powiązań jest poprawny i zachowuje działanie dotychczasowego menu.

Składowa zestawu korzysta z powiązań wskazanego wariantu prostego produktu. Stały skład i wybrane opcje są rozwijane raz, z uwzględnieniem ich ilości. Kontener zestawu z gotowym składem nie ma równocześnie własnego powiązania wariantu, a opcja wskazująca składową nie ma równocześnie bezpośredniego powiązania zasobu. Tak unikamy dwóch opisów tego samego zużycia. Zwykły produkt może mieć powiązanie bazowego wariantu i osobne zasoby dodatków.

Powtarzające się zasoby są sumowane. Przykład: dwa warianty kawy wskazują jeden zasób „porcje kawy”; zestaw z jedną kawą i dodatkową kawą jako wybraną opcją potrzebuje dwóch porcji, a nie dwóch niezależnych sald. Ilość fizycznie zamówiona pozostaje istotna — agregacja nie usuwa prawdziwej drugiej porcji.

## Snapshot i przyszła rezerwacja

Zamówienie zachowuje wyliczone identyfikatory zasobów i ilości na jedną sztukę linii. Agregacja całego zamówienia mnoży je przez ilość zamawianych sztuk dokładnie raz. Późniejsza zmiana menu albo przypisań nie zmienia już istniejącego checkoutu lub zakupu. Edycja nieopłaconego koszyka tworzy nowy snapshot zgodnie z aktualnym menu.

W tym etapie nie ma rezerwacji, zmiany salda, blokowania ostatniej sztuki ani automatycznej dostępności menu na podstawie magazynu. Zasób z wyłączonym śledzeniem może pozostać przypisany. Snapshot opisuje powiązanie i ilość; nie kopiuje salda, progu ani flagi śledzenia. MM-11 musi ustalić zasady śledzenia w chwili atomowej rezerwacji, zachować podjętą decyzję i obsłużyć jej późniejsze rozliczenie.

Nagrody lojalnościowe mają osobny model realizacji. Powiązanie zapasu nie zmienia obiecanej nagrody ani jej ceny. Przed automatycznym rozchodem MM-11 musi również objąć rezerwację/snapshot i rozliczenie tej osobnej ścieżki, aby darmowe nagrody nie omijały magazynu. Ten etap nie deklaruje jej automatycznego rozchodu.

## Konfiguracja

Konfiguracja jest częścią menu i wymaga `menu.manage`. Właściciel lub uprawniony kierownik wybiera istniejący zasób swojego lokalu oraz ilość. Zapis szkicu, publikacja i zgodne wstecznie API pojedynczego produktu sprawdzają odwołania po stronie serwera. Zasób innego lokalu lub nieistniejący nie jest poprawnym powiązaniem. Koszt zakupu nie jest potrzebny do konfiguracji i nie jest ujawniany.

Interfejs wskazuje zasoby bez śledzenia oraz jasno opisuje ręczną ewidencję. Pobiera wszystkie strony listy zasobów; błąd pobrania nie usuwa istniejących przypisań. Zmiana konta albo lokalu nie może wstawić starej listy do nowego edytora.

## Odbiór funkcjonalny

1. Utworzyć zasób „Gotowe kanapki” ze stanem 24 oraz dwa warianty menu.
2. Powiązać oba warianty z tym samym zasobem, po jednej sztuce na wariant.
3. Wskazać jeden wariant jako składową zestawu i wybrać opcjonalną drugą porcję.
4. Zapisać, obejrzeć podgląd i opublikować menu. Utworzyć zamówienie przy kasie i zdalnie, sprawdzając sumę wymagań zasobów bez zmiany salda.
5. Zmienić przypisanie w menu i ponownie opublikować. Istniejący checkout ma zachować dawny snapshot, nowe zamówienie ma otrzymać nowy.
6. Wyłączyć śledzenie zasobu i sprawdzić, że konfiguracja i zakup nadal działają. Ręczne saldo pozostaje dziennikiem MM-10a, bez automatycznego odejmowania.

## Uruchomienie i kontrakt

Nie ma nowej migracji SQL. Nowe opcjonalne pola są przechowywane w istniejących dokumentach katalogu, historii menu i zamówienia. Backend i interfejs należy wydać w zgodnej wersji.

Wariant oraz zwykły dodatek przyjmują opcjonalne `stockBindings: [{itemId, quantity}]`: do 20 różnych zasobów na opcję, ilość całkowita 1–100. Zapisane `line.stockRequirements` mają identyczny format, ale zawierają już sumę wynikającą z wybranego wariantu, składowych i dodatków na jedną sztukę linii. API nie przyjmuje tego snapshotu od klienta. Funkcja `aggregateMerchantStockRequirements` sumuje wymagania dla całego zamówienia; pośrednie wyniki i końcowa ilość zasobu są ograniczone do dodatniego int32.

Walidacja odbywa się przy zapisie szkicu, publikacji, przywróceniu wersji i przez starsze API pojedynczego produktu. Weryfikacja zasobów jest odczytem ograniczonym do lokalu. Nieoczekiwane błędy bazy nie są zamieniane na błędy walidacji z ujawnioną treścią SQL; propagują do istniejącej obsługi błędów serwera.

## Przeglądy

### Spec

Końcowy przegląd nie wykazał pozostałych ustaleń. Potwierdzono walidację wszystkich ścieżek zapisu, wspólny identyfikator zasobu zamiast kopiowania salda, agregację i niezmienność snapshotu. Początkową lukę testową lojalności uzupełniono porównaniem programu przed publikacją i po zmianie przypisań. Osobna realizacja nagrody i faktyczne zmiany salda pozostają do MM-11.

### Standards

Końcowy przegląd nie wykazał pozostałych ustaleń. Zachowano uprawnienia i izolację lokali z ADR 0002, kanoniczne typy oraz bezpieczne sumowanie ilości. Odrzucane są odpowiedzi zasobów po zmianie kontekstu i zachowywane są istniejące przypisania przy błędzie pobrania. Kontrola integracyjna poprawiła także rozdzielenie błędu domenowego nieprawidłowego powiązania od nieoczekiwanego błędu DB.

## Granice odbioru

Testy API używają lokalnego PGlite. Niezależne sesje natywnego PostgreSQL oraz fizyczny Android/Nimiq Pay nadal wymagają odbioru środowiskowego. Nie wdrożono aplikacji ani nie wykonano rzeczywistych płatności. Istniejący zmodyfikowany screenshot remote-acceptance.png zachowano poza commitami.

## Wyniki testów

Pełna regresja scalonego kodu: **API246/246, web207/207, shared48/48 — razem501/501**. TypeScript API/web i build produkcyjny przechodzą. Build ostrzega o głównym pakiecie647,86kB; podział pozostaje optymalizacją. Nowe testy obejmują wspólny zasób wielu wariantów, stały i wybrany skład zestawu, zamrożony checkout/wycenę/płatność, izolację lokali, uprawnienia, niezmienność programu lojalnościowego, brak śledzenia, przepełnienie ilości, pełną paginację zasobów i spóźnione odpowiedzi poprzedniego lokalu.
