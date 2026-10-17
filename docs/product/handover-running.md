# Przekazanie zmiany — MM-22 / PL-05

Lokalna implementacja: właściciel lub pracownik na otwartej zmianie zapisuje notatkę, opcjonalnego następcę oraz zamrożony zestaw otwartych zamówień, zwrotów, niskich zapasów i zadań. Brak następcy zachowuje oczekującą sprawę. Potwierdzenie jest osobną operacją innej osoby; wskazanego następcy nie zastąpi przypadkowy pracownik ani właściciel. Przekazanie nie kończy zmiany kasowej i nie usuwa zobowiązań lokalu.

Autor, odbiorca i czasy są widoczne właścicielowi, a zapis i potwierdzenie trafiają do dziennika. Idempotencja jest sprawdzana przed wymaganiem otwartej zmiany, aby odzyskać zapisany wynik po zakończeniu pracy. Interfejs ponawia ten sam zamiar po utracie odpowiedzi oraz czyści dane przy zmianie profilu/lokalu. Nowy wynik jest instalowany lokalnie bez ryzykownego ponownego zapisu, jeśli późniejszy odczyt historii zawiedzie.

Migracja 0029_shift_handover.sql. Testy API 2/2: snapshot i retry, brak samoodbioru, wskazany następca, wymóg zmiany, potwierdzenie raz, izolacja lokali. UI 2 przypadki: retry i przełączenie profilu (wynik zapisywany po wykonaniu). TypeScript API/web sprawdzono bez błędów przed scaleniem. Natywna współbieżność i odbiór telefonu nadal otwarte. Pełna regresja integracji wykonywana osobno.
