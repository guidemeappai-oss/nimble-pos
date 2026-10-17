# Harmonogram menu — MM-05 / PL-09

Menu ma oddzielną, rewizjonowaną konfigurację dostępności: strefa lokalu, tygodniowe przedziały, wyjątki dat oraz czasowe pauzy produktu, wariantu i dodatku. Dni: 0=niedziela. Przedziały zaczynają się włącznie, kończą wyłącznie; przedział przez północ należy do dnia rozpoczęcia, a wyjątek następnej daty ma pierwszeństwo nad jego końcówką. Oba wystąpienia powtarzanej godziny działają według tego samego lokalnego okna. Brakującej godziny wiosną nie ma do sprzedaży.

POS, nowe zamówienie zdalne i nowa wycena korzystają z efektywnego katalogu; odczyt ważnej wyceny poprzedza nowe ograniczenia. Akceptacja nagrody sprawdza bieżącą dostępność. Ręczne wyłączenie produktu/dodatku pozostaje nadrzędne. Wygaśnięcie pauzy nie omija okien ani ręcznych wyłączeń. Edytor harmonogramu w studio menu korzysta z opublikowanych produktów, nie nieopublikowanego szkicu. Konfigurację harmonogramu zapisuje się osobno i zmienia ona dostępność od razu, bez zmiany cen.

Migracja 0030_menu_schedule.sql. API 5/5 (w tym cztery reguły czasowe i test publicznego przepływu: uprawnienia, zapis, retry, konflikt, blokada nowego POS i zachowanie aktywnej wyceny). UI edytora 1/1; typy API/web przechodzą przed końcowymi zmianami edytora, które podlegają ponownemu sprawdzeniu. Natywna konkurencja i telefon nadal otwarte. Pełna regresja po scaleniu jest osobną bramką.
