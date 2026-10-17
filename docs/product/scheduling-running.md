# Grafik zespołu — MM-27

Data: 2026-10-16. Implementacja lokalna na `feat/mm27-scheduling`. Nie wdrożono.

## Co działa

Właściciel lokalu i pracownik z uprawnieniem `schedule.manage` mogą tworzyć wersje tygodniowego grafiku i publikować je zespołowi. Wersje są niezmienne: następny szkic i zaakceptowane zastępstwo tworzą kolejną wersję. Przed publikacją widać strefę lokalu i trzeba ją potwierdzić.

Pracownik pobiera tylko swoje zmiany z najnowszej opublikowanej wersji. Może poprosić o zastępstwo i wskazać aktywnego współpracownika. Kierownik może zaakceptować albo odrzucić wniosek. Akceptacja sprawdza konflikty zastępcy i publikuje kolejną wersję. Powtórzenie decyzji zwraca wynik wcześniejszego rozstrzygnięcia.

Edytor wymaga nazwy strefy IANA, np. `Europe/Warsaw`. Strefa jest zapisana przy wersji grafiku; nie wynika z timezone telefonu managera ani pracownika. Lokalna godzina, która nie występuje przy zmianie czasu lub występuje dwa razy, blokuje zapis. Godziny API są jednoznacznymi chwilami RFC 3339, a zakres tygodnia walidowany jest względem strefy zapisanej w grafiku.

Grafik pracy nie otwiera ani nie zmienia zmiany kasowej `merchantShift`. Publikacja planu pracy i rozpoczęcie obsługi kasy są osobnymi operacjami.

## Uprawnienia i trasy

- `schedule.manage` daje kierownikowi odczyt i zarządzanie grafikiem danego lokalu.
- Właściciel może zarządzać grafikiem własnego lokalu.
- `GET /v1/merchant/schedule/me?weekStart=YYYY-MM-DD` zwraca opublikowany plan, filtrując zmiany do zalogowanego pracownika.
- `GET /v1/merchant/venues/:venueId/schedules/:weekStart` zwraca najnowszą wersję, z diagnostyką obsady i oczekującymi wnioskami.
- `POST /v1/merchant/venues/:venueId/schedules` tworzy szkic. Wymaga `weekStart`, `timeZone`, zakresów godzin w UTC/RFC 3339 oraz `idempotencyKey`.
- `POST /v1/merchant/venues/:venueId/schedules/:scheduleId/publish` publikuje szkic.
- Pracownik wysyła wniosek pod `POST /v1/merchant/venues/:venueId/schedules/:scheduleId/shifts/:shiftId/substitutions`; kierownik podejmuje decyzję pod `POST /v1/merchant/venues/:venueId/substitutions/:requestId/decision`.

Każda ścieżka sprawdza powiązanie z lokalem. Pracownicy bez `schedule.manage` nie odczytują cudzych przydziałów.

## Uruchomienie lokalne

Zastosuj migrację `apps/api/drizzle/0028_mm27_scheduling.sql` istniejącą procedurą migracyjną, uruchom API i aplikację web. W module Merchant otwórz zakładkę Schedule. W pustym tygodniu rozpocznij tworzenie planu, wpisz strefę lokalu, określ godziny otwarcia, przypisz pracownika, zapisz szkic, przejrzyj braki pokrycia i potwierdź strefę przed publikacją. Zaloguj się jako kasjer, aby zobaczyć wyłącznie swój opublikowany plan i złożyć wniosek o zastępstwo.

## Sprawdzenia wykonane

Pełna regresja lokalna: API **281/281**, web **242/242**, shared **48/48**. TypeScript API/web i produkcyjny build przeszły. Testy API używają PGlite; nie potwierdzają natywnych blokad PostgreSQL. Końcowy zestaw grafiku w interfejsie: **6/6**, po poprawce czyszczenia danych przy zmianie pracownika.

Testy regresyjne najpierw odtworzyły utratę wniosków po utworzeniu szkicu, nowy klucz przy ponowieniu zapisu i spóźnioną odpowiedź tygodnia. Naprawiono też widoczność poprzedniego pracownika podczas ładowania nowego profilu. Publikacja i decyzja o zastępstwie serializują się na lokalu, stary szkic nie zastępuje nowszej opublikowanej wersji, a nieaktywny zastępca blokuje akceptację. Nowy szkic kopiuje istniejące przydziały.

Przegląd Standards: brak twardych naruszeń; dwie nieblokujące uwagi o duplikacji mapowania widoku i rozwiązywania stref. Przegląd Spec: poprawiono pozostawianie danych poprzedniego profilu i lokalne godziny łączonych luk obsady. Końcowe testy potwierdzają poprawki. Brak otwartych uwag blokujących w tym zakresie.

## Pozostałe bramki

Testy API wykonano przez PGlite; wymagają jeszcze uruchomienia na natywnym PostgreSQL, w szczególności dla zachowania blokad przy współbieżnych publikacjach i rozstrzyganiu zastępstw. Potrzebny jest również odbiór na urządzeniu Android/Nimiq Pay. Nie wykonano wdrożenia, push ani rzeczywistych płatności.

## Uzupełnienie odbioru w przeglądarce

Scenariusz Chromium z rzeczywistym API/PGlite wykrył brak wejścia do grafiku właściciela oraz użycie tokenu kasjera przez klienta zarządzania. Dodano osobną zakładkę właściciela i jawny wybór jego uprawnień w wywołaniach klienta. Nie stosujemy automatycznego wyboru tokenu zależnego od tego, czy w przeglądarce jest także sesja kasjera. Test klienta sprawdza oba dostępy. Pełny scenariusz przeglądarkowy po poprawce publikuje grafik jako właściciel.
