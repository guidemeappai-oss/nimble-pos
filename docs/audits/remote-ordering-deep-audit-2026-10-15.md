# Audyt zamówień zdalnych — plan implementacyjny

Aktualizacja po audycie: zadania 01–03 zaimplementowane lokalnie na polecenie użytkownika. Szczegóły walidacji: remote-ordering-fixes-2026-10-15.md. Poniższe ustalenia opisują stan sprzed napraw.

Data: 2026-10-15. Repo: gallareton/nimble, gałąź feat/remote-ordering. Zakres zmian: `git diff 32e401f...4501d2c` oraz powiązane istniejące trasy. Skills: code-review (dwa niezależne przeglądy), diagnosing-bugs (kontrolowane reprodukcje), to-tickets (osobne zadania z zależnościami).

**Wynik: trzy nowe błędy P2, każdy odtworzony testem.** Nie znaleziono nowego P0/P1 w sprawdzonym zakresie; to nie gwarancja braku innych usterek. Nie wykonano napraw ani wdrożenia. Plan jest propozycją prac po audycie. Wcześniejszych napraw z remote-ordering-review.md nie liczymy ponownie.

## Standards — jakość i poprawność implementacji

Brak stwierdzonego twardego naruszenia GLOSSARY.md i ADR 0001/0002 w sprawdzonym zakresie. Dwa błędy poprawności znalezione podczas tego przeglądu:

### S1 · P2 · Odpowiedź zapisu usuwa nowsze zmiany wizytówki

Źródło na badanym commicie: `apps/web/src/remote/Remote.tsx:1092–1099,1130–1133,1181`.
Pola pozostają edytowalne podczas PATCH. Odpowiedź bezwarunkowo zastępuje aktualny szkic i pokazuje sukces. Odtworzenie: zapisz opis A → wpisz B przed odpowiedzią → zakończ zapis A. Tekst B znika. Kontrola generacji lokalu nie chroni kolejnych edycji tego samego lokalu.

Dowód wykonawczy: `owner-save.test.tsx`, 1 test, 1 oczekiwane niepowodzenie (`expected null not to be null` przy sprawdzaniu nowszego tekstu). Zadanie 03.

### S2 · P2 · Starszy odczyt cofa widoczny wynik operacji

Źródło: `apps/web/src/remote/Remote.tsx:732–738,780–786`; analogiczna luka kolejki: `1270–1278,1298–1302`.
Generacja zmienia się przy zmianie kontekstu, lecz nie przy mutacji. Odtworzenie: wyświetl AWAITING_PAYMENT → rozpocznij kolejny GET i zatrzymaj odpowiedź → anuluj, uzyskując CANCELLED → dostarcz stary GET. Ekran ponownie proponuje płatność. Backend nie został cofnięty; błąd dotyczy prezentacji i dostępnych działań do następnego odświeżenia.

Dowód wykonawczy: `stale-poll.test.tsx`, 1 test, 1 oczekiwane niepowodzenie; komunikat anulowania obecny przed dostarczeniem starego GET znika po nim. Wariant kolejki kasjera ma potwierdzoną analogiczną ścieżkę w kodzie, lecz nie był osobno uruchamiany. Zadanie 02.

Heurystyka utrzymaniowa: możliwe Duplicated Code w ręcznie powtarzanych zabezpieczeniach generacji. Nie jest osobnym błędem ani obowiązkiem dużego refaktoru; rozważyć małą wspólną abstrakcję przy zadaniu 02, jeśli uprości rozwiązanie.

Bilans tej osi: 0 twardych naruszeń standardów, 2 błędy P2, 1 heurystyka.

## Spec — zgodność z ustalonym zachowaniem

### F1 · P2 · Ogólny zwrot omija decyzję o odmowie

Źródło: `apps/api/src/routes/merchant.ts:1451–1478`; kontrola kasjera `224–231`, lokalu `284–298`.
Starsza trasa przyjmuje dowolne opłacone zamówienie, w tym REMOTE/AWAITING_ACCEPTANCE. Puste żądanie tworzy refund i zmienia status, bez zapisania decyzji, jej czasu, powodu oraz przypisania kasjera i zmiany. Worker przestaje je wybierać, ponieważ obsługuje AWAITING_ACCEPTANCE. To błąd integracji z istniejącą trasą, nie nowo dodana trasa refundu.

Naruszenie specyfikacji: remote-ordering-plan.md, sekcje „Stany i płatność” oraz „Zmiany, raporty i dane”: odmowa ma powód, aktora i czas niezależnie od procesu finansowego; odmowa rejestruje rzeczywistą zmianę. Rozdzielenie podpisu wypłaty pozostaje zachowane — kasjer nie otrzymuje prawa wydania pieniędzy.

Dowód wykonawczy: Fastify inject z PGlite, rzeczywista ścieżka utworzenia i weryfikacji płatności, symulowana bramka blockchain. Przed żądaniem stan AWAITING_ACCEPTANCE; `POST /v1/merchant/orders/:id/refund {}` zwraca 200 zamiast oczekiwanego 409. Testy przygotowania przechodzą (2), asercja zabezpieczenia zawodzi (1). Brak zapisu metadanych i brak wymogu aktywnej zmiany wynikają z odczytu kodu; wariant zamkniętej zmiany pozostaje osobnym testem odbioru. Zadanie 01.

Bilans tej osi: 1 błąd P2.

## Plan i zależności

Priorytety dotyczą każdej osi osobno; numeracja określa proponowaną kolejność pracy, nie wspólny ranking.

| Zadanie | Efekt | Blokowane przez |
| --- | --- | --- |
| [01 — decyzja przed zwrotem](../../.scratch/remote-ordering-audit/issues/01-decyzja-przed-zwrotem.md) | Każda odmowa ma wymagany kontekst; brak obejścia starym API | — |
| [02 — kolejność odpowiedzi](../../.scratch/remote-ordering-audit/issues/02-kolejnosc-odpowiedzi.md) | Stary odczyt nie cofa anulowania ani decyzji kasjera | — |
| [03 — zapis wizytówki](../../.scratch/remote-ordering-audit/issues/03-zapis-wizytowki.md) | Nowsza edycja pozostaje bezpieczna | — |
| [04 — odbiór przed uruchomieniem](../../.scratch/remote-ordering-audit/issues/04-odbior-przed-uruchomieniem.md) | Regresja napraw, natywny PostgreSQL, Android/Nimiq Pay | 01, 02, 03 |

Każde zadanie ma kryteria odbioru. 01–03 można wykonywać niezależnie; 02 i 03 dotykają wspólnego pliku, więc równoległe zmiany wymagają koordynacji. Plan nie wymaga zmiany modelu płatności przed akceptacją ani uprawnień właściciela.

## Dowody i granice audytu

Reprodukcje zachowano w `docs/audits/probes/`. Są celowo czerwone na badanym commicie i poza domyślnym zbiorem testów. Aby uruchomić: skopiuj pliki TSX do `apps/web/test/`, plik TS do `apps/api/test/`; importy zakładają te katalogi. Uruchom Vitest dla wybranego pliku z odpowiedniego pakietu. API wymaga wyłącznie izolowanej testowej bazy, ponieważ helper freshDb czyści dane. W tym środowisku użyto `/workspace/scratch/8c4b192c1c98/test-tools/run-with-db.mjs -- node node_modules/vitest/vitest.mjs run test/audit-remote-refund.test.ts`. Po próbach usunięto tymczasowe kopie z katalogów testów aplikacji.

Nowe uruchomienia: 5 przypadków w 3 plikach, 2 przechodzące przygotowania i 3 oczekiwane niepowodzenia wykrywające błędy. Nie uruchamiano ponownie pełnej regresji ani builda, ponieważ nie zmieniano produkcyjnego kodu. Poprzedni zapis 396 testów i 4 scenariuszy przeglądarkowych pozostaje wynikiem wcześniejszej implementacji, nie tego audytu.

Natywny PostgreSQL z oddzielnymi sesjami, fizyczny Android/Nimiq Pay, kamera i rzeczywiste podpisy płatności/zwrotów nie zostały zweryfikowane w tym audycie. Są bramkami zadania 04, a nie wykrytymi błędami. Testy wykorzystują sztuczne konta i symulowane potwierdzenia; nie dowodzą gotowości produkcyjnego wdrożenia. Flaga zdalnych zamówień pozostaje domyślnie wyłączona.

Zachowano istniejącą modyfikację remote-acceptance.png. Dodano wyłącznie dokumentację, propozycje zadań i odtwarzalne próby audytowe. Nie opublikowano issues ani zmian na GitHub.
