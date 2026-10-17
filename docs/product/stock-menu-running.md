# PL-17 — dostępność składników

2026-10-17. Lokalna implementacja; natywna bramka i telefon nadal otwarte.

Zasób ma odrębne available (zgoda na nową sprzedaż) i tracked (ewidencja salda). Ręczna blokada nie usuwa zapasu, rezerwacji ani nie blokuje fizycznego rozliczenia/utylizacji. Migracja0037 ustawia istniejące zasoby jako dostępne, zachowując wcześniejsze zachowanie. Dostawa nie kasuje ręcznej blokady. Publiczny katalog łączy aktualne rezerwacje/straty, receptury, gotowe porcje, ręczne ustawienia i harmonogram; brak surowca usuwa dotknięte warianty i wyłącza dodatki/zestawy. Pełna alternatywna receptura może zachować wariant z jawnym obowiązkiem wyboru zamiany. Opcjonalne dodatki współdzielące składniki są dodatkowo sprawdzane na poziomie całego koszyka przez atomową rezerwację.

Wcześniejsze ważne wyceny zachowują swoje rezerwacje. Projekcja katalogu służy nowemu wyborowi; serwerowa transakcja checkoutu nadal sprawdza fizyczne wymagania, blokadę i zasób. Nie włączamy ponownie niespełnionego harmonogramu ani ręcznie wyłączonego produktu.

Magazyn → Wpływ dostępności składników pokazuje warianty/dodatki/zestawy z niedoborem oraz przyjęte PREPARING/READY zamówienia używające ręcznie zablokowanego składnika. To jawna lista wyjątków realizacji; nie zgadujemy problemu gotowego zamówienia na podstawie samego spadku salda po jego sprzedaży. Właściciel może z powodem utworzyć jedno zobowiązanie do zwrotu. W tej transakcji przechodzimy do REFUND_PENDING, zachowujemy rozchód, korygujemy lojalność istniejącą usługą i nie podpisujemy/nie wysyłamy przelewu. Wypłatę nadal zatwierdza i podpisuje właściciel.

Testy stock-menu3/3 w pełnym przebiegu oraz istniejąca rezerwacja POS/remote/nagroda18/18. Scenariusze: wariant/dodatek/zestaw, dostawa vs blokada/harmonogram, alternatywna receptura, zachowanie wcześniejszej rezerwacji, odmowa nowej wyceny, przyjęte zamówienie do wyjątku, jedno zobowiązanie mimo równoczesnego retry, brak odtworzenia zapasu i odmowa kasjerowi. UI stock-menu/product-choices/production6/6. Chromium9/9 obejmuje ręczne zablokowanie składnika i podgląd wpływu na produkt z recepturą. Natywne blokady nie zostały sprawdzone.
