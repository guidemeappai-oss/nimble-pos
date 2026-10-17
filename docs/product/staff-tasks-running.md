# Checklisty i zdjęcia — MM-19 / MM-20

Data: 2026-10-16. Gałąź: feat/merchant-management. Implementacja lokalna, bez wdrożenia i push. Skills: implement-spec, implement, tdd, code-review. Baza etapu: 1bb2c3c.

## Co działa

Właściciel lub kierownik z tasks.manage tworzy i edytuje szablon: instrukcja, kategoria, harmonogram jednorazowy/dzienny/na zmianę, termin, strefa czasowa, wykonawca, odbierający i wymagane zdjęcia (brak/przed/po/oba). Istniejące wystąpienia zachowują wersję instrukcji. Można zmienić przydział zadania TODO z powodem.

Pracownik przejmuje nieprzydzielone zadanie albo rozpoczyna przydzielone. Po wykonaniu zgłasza je do odbioru. Kierownik akceptuje lub zwraca do poprawy z powodem. Autor nie odbiera własnego zgłoszenia. Pominięcie wymaga uprawnienia i uzasadnienia. Odrębna deklaracja właściciela ma trwałą etykietę „bez niezależnej weryfikacji”; jawny wyjątek zdjęciowy właściciela także ma osobne oznaczenie i powód. Kierownik nie może ominąć wymagań fotografii.

Zdjęcia można wykonać aparatem lub zaimportować z jawnym oznaczeniem źródła. Atrybut aparatu jest wskazówką urządzenia, nie dowodem czasu wykonania zdjęcia. Podgląd przed wysłaniem, stan niewysłane, bezpieczny retry i usunięcie własnego niezgłoszonego pliku. Do 4 zdjęć na zgłoszenie, do 10 MB wejścia; JPEG/PNG/WebP w interfejsie. Serwer ponownie koduje obraz, usuwa EXIF i zapisuje wersję do 2048 px oraz miniaturę do 320 px. Zgłoszenie i zatwierdzenie sprawdzają zapisane, niewygasłe załączniki właściwej wersji.

Pracownik ma dostęp do własnej dokumentacji. Kierownik potrzebuje tasks.manage i photos.view. Właściciel ma dostęp do swojego lokalu. Każdy odczyt jest autoryzowany; pliki nie mają publicznych URL-i. Zmiana profilu czyści podglądy, a stare odpowiedzi są ignorowane. Brak trwałej kolejki offline. Zdjęcia dokumentują zgłoszenie; system nie ocenia uczciwości i nie rozstrzyga kradzieży.

## Harmonogram

Wystąpienia utrwalane są podczas pobierania listy, nie przez osobny worker wysyłający powiadomienia. Restart i odświeżanie nie dublują zadań. Dzienne zaległości materializują się partiami do 366 dni, kontynuując od ostatniego wystąpienia; bardzo długa zaległość może wymagać kolejnych odświeżeń. Początkowe utworzenie zachowuje zadanie bieżącego dnia. Po reaktywacji lub zmianie trybu harmonogramu nowy punkt aktywacji wyklucza wcześniejsze terminy i zamknięte zmiany z okresu wyłączenia. Istniejące zadania pozostają bez zmian; otwarta zmiana może otrzymać zadanie po reaktywacji zgodnie z trybem SHIFT.

## Uruchomienie

Zastosować migracje 0017, 0018 i 0019 przez istniejącą procedurę migracji, zanim nowy kod API zacznie obsługiwać ruch. Dockerfile wykonuje tę procedurę przy starcie kontenera zgodnie z dotychczasowym wdrożeniem. Nie wykonano migracji na produkcji.

Zdjęcia używają lokalnego prywatnego adaptera plikowego, nie zewnętrznego object storage. Docker ma TASK_PHOTO_DIR=/var/lib/nimble/task-photos, a compose montuje nazwany wolumen nimble-task-photos. Należy zachować go razem z bazą przy aktualizacji kontenera. Poza Dockerem ustawić TASK_PHOTO_DIR na trwały katalog poza publicznym katalogiem web; domyślny katalog deweloperski to .private/task-photos względem procesu API. Zdjęcia są wykluczone z git i kontekstu budowania obrazu.

Domyślna retencja: 30 dni. Odczyt wygasłego zdjęcia jest blokowany od razu; czyszczenie plików i miniatur uruchamia się przy starcie API i co godzinę. Porzucone uploady mają godzinę ochronną przed sprzątaniem. API umożliwia uprawnionemu kierownikowi/właścicielowi przedłużenie otwartej sprawy do maks. 90 dni od utworzenia z wymaganym powodem; formularz przedłużania nie jest jeszcze eksponowany w telefonie. Kopie zapasowe wymagają osobnego cyklu przechowywania i odtworzenia bazy razem z wolumenem. Odtworzone wygasłe pliki nadal podlegają kontroli terminu i czyszczeniu.

Nowa zależność: sharp 0.34.5 z lockfile. Lokalna weryfikacja instalacji użyła cache, frozen-lockfile i ignore-scripts; natywny prebuilt działa w wykonanych testach przetwarzania obrazów. Docelowy obraz Docker/architektura nie zostały zbudowane w tym środowisku — bramka uruchomienia.

## Odbiór w aplikacji

1. Właściciel w Zespole nadaje kierownikowi tasks.manage i photos.view z powodem.
2. W zakładce Zadania tworzy szablon „Sprzątanie toalety”, wybiera termin, pracownika, odbierającego i zdjęcia przed/po.
3. Pracownik na przypisanym telefonie otwiera Zadania, rozpoczyna czynność, zapisuje zdjęcie przed, wykonuje pracę i zapisuje zdjęcie po. Fotografuje puste pomieszczenie, bez osób i dokumentów.
4. Zgłasza wykonanie. Próba zgłoszenia bez wymaganych zdjęć daje błąd, a nie sukces.
5. Kierownik ogląda dokumentację i zatwierdza albo prosi o poprawę. Zdjęcia zgłoszonej wersji są niezmienne; poprawa ma kolejne zgłoszenie.
6. Wyłączenie szablonu i reaktywacja nie tworzy zaległości z okresu pauzy. Zmiana kasjera nie pokazuje poprzednich zdjęć.
7. W jednoosobowym lokalu właściciel wykonuje nieprzydzielone zadanie i zapisuje jawną deklarację. Awaria kamery może zostać rozliczona wyłącznie jawnym wyjątkiem właściciela z powodem.

## Testy i przegląd

Pełna regresja API na integracji: 214/214 przed końcowymi poprawkami. Po dodaniu 2 scenariuszy reaktywacji i scenariusza zbyt dużego requestu: odpowiednie testy końcowe tasks+taskPhotos 9/9, magazyn obrazów wcześniej 3/3. Obecny zbiór API zawiera 217 sprawdzonych przypadków; ponowień nie doliczamy. Końcowy pełny web: 176/176. Shared: 42/42. Łącznie 435 różnych przypadków sprawdzonych w tym etapie. TypeScript API/web i build produkcyjny przechodzą. Pozostaje nieblokujące ostrzeżenie o pakiecie web około 587 kB.

TDD odtworzył m.in. brak delegacji w API, wymagania zdjęć, błędną odpowiedź 500 zamiast 413 dla zbyt dużego obrazu oraz tworzenie zaległych zadań z okresu pauzy. Testy obejmują strefy czasowe/DST, retry, snapshot instrukcji, uprawnienia i cofnięcie praw, samodzielny odbiór, limity zdjęć, retencję, EXIF, miniatury i porzucone pliki. Testy interfejsu obejmują błędy, zmianę konta, spóźnione odpowiedzi, ponowienie uploadu, deklarację i utrwalony wyjątek.

Spec review: poprawiono niedostępną ścieżkę właściciela, brak selektora wymagań zdjęć i brak trwałej etykiety deklaracji. Ponowny przegląd bez pozostałych ustaleń. Standards: brak twardych naruszeń; poprawiono czytelność modułu zadań i dodano ponowienie wczytywania zdjęć. Osobny przegląd root wykrył i naprawił reaktywację harmonogramu oraz błąd limitu uploadu.

## Pozostałe bramki i zakres

Nie wykonano fizycznego Android/Nimiq Pay: aparatu, uprawnień hosta, pamięci przy dużym zdjęciu i przerwania uploadu. Współbieżność niezależnych sesji natywnego PostgreSQL oraz produkcyjne odtworzenie bazy+wolumenu pozostają otwarte. Nie deklarujemy gwarantowanego powiadomienia w tle ani działającej kolejki offline.

MM-19 i MM-20 są ukończone lokalnie. MM-21 — rozliczenie jedzenia według magazynu — nadal wymaga MM-13 (straty/inwentaryzacja), a więc wcześniejszych etapów magazynu. Same zdjęcia nie implementują jeszcze rozliczania pozostałego jedzenia. Pozostałe moduły planu nadal mają swoje zależności.
