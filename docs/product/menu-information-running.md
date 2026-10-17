# Informacje o menu — PL-11 / MM-07b

Implementacja lokalna. Edytor szkicu zapisuje język źródłowy, opisy, ręcznie przygotowane tłumaczenia i potwierdzenie sprawdzenia alergenów. Publikacja menu zatwierdza komplet informacji. Warianty i nieproduktowe dodatki wymagają zbiorczej deklaracji właściciela; zestawy i produktowe zamiany pokazują konserwatywną sumę alergenów wszystkich opcji. Brak danych którejkolwiek składowej pozostaje jawnie nieznany. To informacja lokalu, nie automatyczna weryfikacja składu.

Obsługiwane języki danych: en, pl, de, es, fr, pt. Brak tłumaczenia pokazuje język źródłowy i etykietę zastępczą. Nie wykonuje się automatycznych tłumaczeń. Informacje widoczne w podglądzie, POS i menu zdalnym. Wersje menu zachowują informacje historyczne.

Weryfikacja lokalna: API 1/1 (prywatny szkic, publikacja, historia); shared 4/4 (walidacja, tłumaczenie/fallback, nieznane alergeny, zestawy); UI 3/3 (prezentacja i edycja). TypeScript API/web przechodzi. Pełna regresja integracji jest osobnym odbiorem po scaleniu. Telefon i rzeczywisty odbiór lokalu pozostają otwarte.
