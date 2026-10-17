# Poprawki po audycie zamówień zdalnych

2026-10-15. Punkt wyjścia: 4501d2c. Zadania 01–03 wykonane lokalnie; zadanie 04 pozostaje częściowo zablokowane. Skills: implement, tdd, code-review.

- Starsza operacja zwrotu zwraca 409 REMOTE_DECISION_REQUIRED dla REMOTE/AWAITING_ACCEPTANCE przed jakąkolwiek mutacją. Wymagane pozostaje dedykowane odrzucenie z powodem i aktywną zmianą. Zwroty po przyjęciu oraz COUNTER zachowują dotychczasowy proces.
- Szczegóły zamówienia unieważniają odczyty sprzed anulowania i wstrzymują nowe odczyty podczas operacji. Kolejka unieważnia starsze odczyty, pomija polling podczas operacji i dopuszcza autorytatywne odświeżenie po niej. Zabezpieczenia zmiany konta/lokalu pozostają aktywne.
- Formularz właściciela wersjonuje edycje wszystkich pól. Starszy zapis nie zastępuje nowszego szkicu i nie pokazuje komunikatu sukcesu dla niezapisanej edycji. Nie blokujemy dalszego pisania.

## Walidacja

Trzy czerwone reprodukcje wykonano podczas audytu przed naprawą. Testy regresyjne przechodzą po poprawkach. Dodatkowo sprawdzono zamkniętą zmianę i brak częściowej mutacji, zachowanie nowszego opisu/publikacji/czasu, polling po nieudanym anulowaniu oraz stare odczyty kolejki po accept/reject/refund/collect.

API: pełna regresja 203/203 na PGlite; po rozszerzeniu testu API ponownie remote.test.ts 11/11. Web: końcowa pełna regresja 161/161. Shared: 42/42. Łącznie 406 przypadków w trzech pakietach (powtórnych uruchomień nie doliczamy). TypeScript API/web oraz build produkcyjny web przechodzą. Build nadal zgłasza nieblokujące ostrzeżenie o głównym pakiecie około 555 kB.

## Standards

Niezależny przegląd względem 4501d2c: brak konkretnych naruszeń standardów i regresji. Zgodność z rozdziałem ról ADR 0002 zachowana.

## Spec

Niezależny przegląd: brak nowego błędu w poprawkach. Wskazane luki w testach zamkniętej zmiany, pól wizytówki i kolejki uzupełniono przed zakończeniem. Bilans: 0 otwartych ustaleń wymagających zmiany kodu w przejrzanych poprawkach.

## Pozostały odbiór

Nie wykonano testów oddzielnych sesji natywnego PostgreSQL ani fizycznego Androida/Nimiq Pay, kamery i rzeczywistych podpisów. Zadanie 04 zachowuje te bramki. Nie wykonano wdrożenia, push ani rzeczywistych płatności. Istniejącej zmiany screenshotu remote-acceptance.png nie włączono do commita napraw.
