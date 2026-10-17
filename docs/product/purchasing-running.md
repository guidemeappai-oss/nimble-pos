# PL-19 — zakupy i zamówienia dostaw

Panel „Purchases and replenishment” w magazynie pokazuje uzasadnione propozycje i pozwala przenieść je do edytowalnego szkicu. Cel to próg niskiego zapasu +1 (z limitem integer). Dostępność wylicza istniejący mechanizm rezerwacji: max(0, stan fizyczny − aktywne rezerwacje − oczekujące straty). Proponowany zakup to max(0, cel − dostępność − nieprzyjęta część istniejących dostaw). Zablokowanie sprzedaży składnika nie wymyśla fizycznego niedoboru. Szkice nie są liczone jako zamówiony towar.

Szkic ma wersję, dostawcę, referencję, ilości i autora. Zmiana wymaga aktualnej rewizji. Zatwierdzenie tworzy dokładnie jedną powiązaną dostawę; nie zmienia magazynu. Przycisk otwiera tę dostawę z istniejącymi częściowymi przyjęciami, partiami i korektami. Aktualnie zamówienie zakupu nie zawiera cen: brak ceny pozostaje nieznany, nigdy zero. Dotychczasowy przepływ dostawy z ceną pozostaje dostępny w operacjach magazynu.

CSV powstaje wyłącznie na żądanie użytkownika, zawiera identyfikatory zakupu i dostawy oraz snapshot nazw, jednostek i ilości. Wartości tekstowe są cytowane, cudzysłowy podwajane, prefiksy formuł także po białych znakach neutralizowane apostrofem. Nie wysyłamy wiadomości ani zamówienia do dostawcy.

Uprawnienie inventory.manage jest sprawdzane na żywo; wszystkie dokumenty są ograniczone lokalem. Wspólna blokada operacji magazynowych i klucz idempotencji chronią zatwierdzenie. Niepewna odpowiedź blokuje nowe zapisy do ponowienia tej samej operacji. Błąd odświeżenia po potwierdzonym zapisie nie uruchamia drugiego zapisu.

## Weryfikacja

API zakupy+operacje magazynu21/21: propozycje, rezerwacje i oczekujące straty, poprawka szkicu, stara rewizja, równoległe zatwierdzenie, jedna dostawa, częściowe przyjęcie i retry, izolacja lokalu i brak uprawnień. UI zakupy3/3 (niepewny zapis, potwierdzony zapis z błędem odświeżenia, zmiana tożsamości). Pełny web272/272, shared57/57, typy API/web i build zaliczone. Przegląd zgodności: akceptacja nie przyjmuje zapasu, powiązanie jest trwałe, CSV nie wysyła zamówień, koszty nie są domyślane.

Rozszerzony scenariusz Chromium1/1 przeszedł szkic → zatwierdzenie → częściowe przyjęcie. Pełny przebieg Chromium9/9 wraz z pobraniem CSV zaliczony: cztery P2P fake-chain, cztery remote demo i jeden przepływ rzeczywistego API/PGlite. Ostatnie pełne API337/337 dotyczy commitu PL-18; po PL-19 uruchomiono ukierunkowane21/21, bez deklarowania nowego pełnego wyniku. Natywna baza i fizyczny telefon nadal otwarte.
