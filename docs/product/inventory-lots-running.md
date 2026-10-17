# PL-18 — partie i terminy przydatności

Dostawy i produkcja tworzą partie z ilością, etykietą i opcjonalnym terminem. Ruchy magazynu zapisują dokładne przydziały partii; rozchód proponuje FEFO (najbliższy termin, następnie data przyjęcia, identyfikator; brak terminu na końcu). Interfejs udostępnia podgląd, propozycję ilości, korektę metadanych z powodem, wybór partii straty i spis według partii. Datownik przyjęcia/produkcji jest jawnie w UTC, prezentacja terminów korzysta z lokalnej strefy przeglądarki.

## Polityka dostępności

ALERT_ONLY: przeterminowanie daje alert i wymaga decyzji operatora. Nie usuwa ilości ani nie odrzuca automatycznie zamówienia. Operator rejestruje stratę lub blokuje składnik przez PL-17. Rezerwacja obiecuje ilość zasobu, nie konkretną partię. Przydział następuje podczas rozchodu; partie wskazane w oczekującej stracie są chronione. Daty nie są traktowane jako potwierdzenie bezpieczeństwa żywności.

## Spójność i migracja

Wspólna blokada zasobu chroni stan fizyczny i sumę partii. Cofnięcie przyjęcia i produkcji odnosi się do oryginalnych partii: nie zastępuje zużytej partii późniejszą dostawą. Korekta produkcji sprzed ewidencji partii wymaga jawnej korekty zamiast odtwarzania nieznanej proweniencji. Spis może rozliczać poszczególne partie, także przy zerowej różnicy sumy; zachowuje koszt średni przy takiej zmianie. Spis sumaryczny pozostaje dostępny, dodatnia nieprzypisana różnica tworzy partię bez terminu.

Migracja0038 zapisuje istniejące dodatnie saldo jako LEGACY, z nieznanym terminem i czasem przyjęcia. Nie odtwarza starych dostaw ani zużyć i nie zmienia ich historii. Czas utworzenia rekordu migracyjnego nie jest czasem przyjęcia fizycznego.

## Weryfikacja

Ukierunkowane API39/39 (następnie dwa dodatkowe przypadki w pełnym przebiegu) (partie, produkcja, operacje magazynu, rezerwacje), UI20/20. Testy obejmują FEFO, wygaśnięcie bez usuwania salda, powtórzenie zapisu, obcy lokal, brak możliwości cofnięcia z zastępczej partii, spis z przeciwnymi różnicami partii i walidację sum. Pełne API337/337, web269/269, shared56/56; typy API/web i build zaliczone. Rozszerzony scenariusz Chromium1/1 z rzeczywistym API/PGlite: etykieta i termin produkcji, ponowny odczyt i propozycja FEFO, istniejące rozliczenie jedzenia i zamknięcie dnia. Natywny PostgreSQL i fizyczny telefon pozostają osobnymi otwartymi bramkami.
