# PL-06 — zamknięcie dnia

2026-10-16. Implementacja lokalna; nie zamyka PL-02 ani odbioru telefonu.

Właściciel lub pracownik z reports.view i tasks.manage może przygotować podgląd, uzasadnić przeniesienie każdej otwartej sprawy i zamknąć dzień. Właściciel może zamiast tego zapisać jawne odstępstwo. Strefa IANA, granica godziny i data są utrwalone; przyszłe i nieistniejące daty odrzucane. Jedna data może zostać zamknięta raz w lokalu. Powtórzenie tego samego klucza zwraca zapisany rezultat.

Snapshot issues/sales powstaje w jednym poleceniu SQL, z jednym widokiem MVCC podczas równoległej płatności. Fingerprint podglądu zapobiega zatwierdzeniu nieaktualnych spraw lub sum. Otwarte zadania, zamówienia, zwroty, spisy/straty i nieodebrane przekazania wymagają uzasadnienia. Późniejsze zmiany nie modyfikują historii. Sumy to znane przy odcięciu opłacone i przyjęte zamówienia według ich dnia utworzenia, grupowane walutą, bez kompensowania zwrotów; pełne rozliczenia należą do PL-20. Nie jest to raport księgowy ani pełna historia przepływów.

Zamknięcie nie kończy zmiany kasowej, czasu pracy ani sesji i nie wyłącza przetwarzania płatności/zwrotów. Zapis DAY_CLOSE w istniejącym rejestrze operacji, bez migracji fizycznego schematu. API serializuje zapisy lokalu blokadą rejestru; uprawnienia i audyt sprawdzane przez istniejące helpers. UI właściciela oraz uprawnionego pracownika ma zakładkę Zamknięcie dnia, stabilne retry po utracie odpowiedzi i paginowaną historię.

Testy lokalne: day-close+stock-reservations15/15, day-close UI2/2. Przypadki: wymagane przeniesienie, stale preview, izolacja lokali, nieistniejąca data, powtórny i równoczesny zapis, niezmienność po późniejszym ruchu, równoległa płatność i pozostawiona otwarta zmiana kasowa, retry niepewnego zapisu oraz zmiana tożsamości. Test food-day sprawdza północ i DST. Testy na PGlite nie dowodzą zachowania natywnych blokad.

Rozszerzony test Chromium z rzeczywistym API przeszedł wraz z całym zestawem9/9 E2E: rozliczenie, zdjęcia przed/po, deklaracja właściciela, zatwierdzenie straty i zamknięcie dnia. Nie wykonano testu fizycznej kamery ani natywnego PostgreSQL.
