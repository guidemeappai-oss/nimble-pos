# Karta stałego klienta — przegląd zmian

Data: 2026-10-15. Gałąź: feat/loyalty-card. Punkt odniesienia: 095c08a. Skills: AI Hero implement-spec, implement, tdd, code-review. Zakres: zatwierdzona specyfikacja loyalty-card-plan.md i pięć zadań lokalnego trackera.

## Standards

Niezależny przegląd wykrył dwa problemy P2 dotyczące cyklu życia interfejsu:

- Skaner QR po powtórnym montowaniu w StrictMode pozostawiał znacznik zamontowania ustawiony na false; możliwe były także równoległe uruchomienia kamery. Poprawka resetuje znacznik w efekcie, blokuje start w toku i zwalnia strumień po odmontowaniu. Testy obejmują StrictMode, ponowne kliknięcia i odmontowanie podczas zgody na kamerę.
- Starsza odpowiedź odpytywania mogła nadpisać stan po operacji lub po zmianie konta. Poprawka wiąże dane z zakresem konta/API oraz numerem żądania, czyści widoczne dane po zmianie zakresu i unieważnia stare odczyty po mutacji. Dodano test opóźnionych odpowiedzi.

Nie znaleziono naruszenia udokumentowanego podziału uprawnień właściciel/kasjer ani dostępu do kluczy portfela właściciela. Uwagi dotyczące skanera i odpytywania poprawiono w f7e176c.

## Spec

Niezależny przegląd wykrył dwa problemy:

- P1: możliwe było usunięcie wariantu nagrody aktywnego programu, jeżeli nie było jeszcze kart z dodatnim saldem. Ochrona obejmuje teraz aktywne programy, otwarte zobowiązania i przypisane płatności w toku. Edycja katalogu i konfiguracja programu współdzielą blokadę lokalu, a sprawdzenie zobowiązania blokuje kartę, aby równoległe potwierdzenie płatności nie unieważniło odczytu.
- P2: klient widział anulowanie nagrody już przyjętej przez kasjera, podczas gdy API prawidłowo wymagało roli kasjera. Klient otrzymuje tę akcję wyłącznie dla nieprzyjętej rezerwacji.

Poprawki: 8530d86, 9536bbe, f7e176c. Końcowy przegląd wykrył także P2: odpytywanie co trzy sekundy odrzucało wszystkie odpowiedzi trwające ponad trzy sekundy. Kolejny odczyt jest teraz planowany dopiero po zakończeniu poprzedniego; test z odpowiedziami trwającymi cztery sekundy przeszedł cykl red → green dla kart oraz kolejki. Dodatkowy przegląd salda uwzględnił zwroty po przejściu do nowej wersji programu: zadłużenie z wcześniejszej karty tego samego lokalu i sieci ogranicza dostępne nagrody. Wspólna blokada profilu poprzedza blokady kart i tworzenie nowej karty.

## Weryfikacja i ograniczenia

Pełny zestaw API: 192/192. Po końcowej poprawce blokad: 29/29 testów związanych z kartą, merchant i odzyskiwaniem płatności. Shared: 42/42. Końcowy web: 131/131; razem 365 testów w trzech zestawach. TypeScript API/web i produkcyjny build przechodzą. Końcowy niezależny przegląd potwierdził zamknięcie zgłoszonych problemów; brak dalszych konkretnych blokujących usterek w przejrzanym zakresie.

Osie przeglądu: Standards — 2 uwagi P2, rozwiązane; Spec — 1 uwaga P1 i 2 uwagi P2, rozwiązane. Nie łączymy wyniku obu osi w jeden ranking.

Demo w Chromium sprawdzono od pięciu zakupów przez rezerwację, przygotowanie i wydanie nagrody, przy szerokościach 320/390/736/1280 px. Ten pokaz nie podpisuje ani nie wysyła transakcji.

Natywny PostgreSQL i fizyczny Android/Nimiq Pay pozostają osobnymi bramkami odbioru. Testy API korzystają z lokalnego PGlite i adaptera protokołu, więc nie dowodzą poprawności wszystkich przeplotów transakcji serwera PostgreSQL. Próba uruchomienia natywnego PostgreSQL w tym środowisku została zablokowana przez brak możliwości uruchomienia procesu pod innym UID; nie obchodzono ograniczeń środowiska.

Nie wykonano wdrożenia, push do GitHub ani rzeczywistych przelewów.
