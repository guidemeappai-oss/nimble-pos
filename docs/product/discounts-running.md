# Rabaty — MM-26 / PL-12

Właściciel ustala pracownikowi limit procentowy (punkty bazowe) i kwotowy; oba muszą być spełnione. Sam limit nie zastępuje prawa discounts.apply. Bez prawa lub powyżej limitu powstaje wniosek wymagający decyzji właściciela. Kasjer musi mieć otwartą zmianę. Wypłaty pozostają poza zakresem pracownika.

Jeden rabat dotyczy całego koszyka POS, łącznie z zestawami. Nie dodaje się drugiego rabatu ani rabatu do bezpłatnej nagrody. Zakup po rabacie może kwalifikować się do pieczątki według końcowej kwoty. Procent jest zapisywany jako liczba całkowita punktów bazowych; zaokrąglenie do grosza to połówka w górę. Kwota po rabacie musi pozostać dodatnia. Wniosek blokuje płatność do zatwierdzenia/wycofania, zatwierdzenie zamraża koszyk. Rabat jest niemożliwy po wystawieniu wyceny lub otrzymaniu wpłaty. Zapisana rewizja i późniejsza wycena zachowują końcową cenę. Dziennik zawiera autora, powód oraz zgodę.

Migracja 0032_discounts.sql. API 2/2: niezależna zgoda, brak zgody kasjera, blokada wyceny oczekującej, retry, snapshot końcowej ceny, blokada edycji, ustawienie limitu wyłącznie przez właściciela, zastosowanie w ramach prawa i limitu, brak drugiego rabatu. UI: testy retry i zgody właściciela; wynik należy odczytać z faktycznego uruchomienia przed końcowym odbiorem integracji. Natywny PostgreSQL i telefon pozostają otwarte.
