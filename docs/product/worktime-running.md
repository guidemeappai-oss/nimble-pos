# Czas pracy — PL-13 / MM-28

Lokalna implementacja: pracownik rozpoczyna i kończy pracę oraz przerwy niezależnie od zmiany kasowej, zdjęć i zadań. Zakończenie w trakcie przerwy zamyka również tę przerwę. Czasy zdarzeń nadaje serwer; UI nie nadaje fikcyjnego sukcesu po utracie odpowiedzi. Ponowienie używa tego samego klucza, także po zakończeniu pracy.

Korekta zakończonego wpisu pozostaje wnioskiem. Zatwierdza ją właściciel lub pracownik z time.manage; nie wolno zatwierdzić korekty własnej pracy. Oryginał, proponowane wartości, powód, decyzja i czas pozostają w historii. Zatwierdzenie sprawdza rewizję i brak nakładania z innymi wpisami. Jedna aktywna ewidencja pracownika jest chroniona blokadą pracownika i indeksem unikalnym. Ewidencja zapisuje jednoznaczne chwile; API zachowuje offsety nocy i zmian czasu. Edytor korekt pokazuje strefę urządzenia, w której wpisywane są godziny.

Migracja 0034_work_time.sql; prawo time.manage nadawane przez właściciela w zespole. Dodano także możliwość nadania istniejącego discounts.apply w edytorze dostępu.

Testy API 3/3: start bez zmiany kasowej, przerwa, finish, retry, blokada drugiego startu, obcy lokal, osobna zgoda na korektę, zachowanie oryginału do zatwierdzenia, historia dla pracownika, odrzucenie nakładających się godzin i jawne chwile przejścia DST. UI 2/2: finish w przerwie, retry tego samego zamiaru i czyszczenie poprzedniego profilu. TypeScript API/web przechodzi. Podczas testów wykryto i poprawiono przekazywanie Date w surowym SQL; porównania używają ISO. Pełna regresja integracji i natywne blokady pozostają osobnym odbiorem.
