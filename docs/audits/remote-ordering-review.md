# Zamówienia zdalne — przegląd implementacji

Data: 2026-10-15. Gałąź: feat/remote-ordering. Punkt odniesienia: 32e401f.
Specyfikacja: ../product/remote-ordering-plan.md. Skills: implement-spec, implement, tdd, code-review.

## Standards

Niezależny przegląd nie znalazł naruszenia ADR dotyczących oddzielenia kasjera od portfela właściciela. Cache tożsamości ma zakres pojedynczego żądania.

Wykryto i poprawiono trzy problemy P2 cyklu życia interfejsu:

- Odpowiedź zapisu ustawień starego lokalu mogła zastąpić formularz nowego lokalu. Odczyt i zapis są teraz związane z generacją zakresu, wraz z obsługą błędu i zakończenia.
- Odpowiedź anulowania starego zamówienia mogła podmienić aktualnie otwarty widok. Mutacja sprawdza tożsamość i zakres; poprzednie dane nie wracają po nawigacji.
- Zmiana lokalu lub zmiany kasjera podczas mutacji mogła pozostawić kolejkę stale zablokowaną. Reset zakresu czyści stan zajętości, a zakończenie starej operacji nie odblokowuje nowszej.

Każdy przypadek ma regresję. Zredukowano też duplikację kontraktów przez import RemoteSettings/RemoteVenue z shared. Końcowy przegląd tej osi potwierdził zamknięcie trzech uwag.

## Spec

Wykryto cztery problemy, poprawione w implementacji:

- P1: oczekująca akceptacja płatnego zamówienia nie chroniła jeszcze obiecanego wariantu nagrody. Ochrona katalogu uwzględnia teraz AWAITING_ACCEPTANCE; dołączenie i przypisanie karty zachowują oczekującą kartę również po zmianie wersji programu. Regresja odtwarza wersję V1, płatność, publikację V2 i próbę usunięcia starej nagrody przed akceptacją.
- P2: osobna kolejka zdalna usunęła dostęp do zgłoszenia zwrotu już przyjętego zamówienia. Przywrócono zgłoszenie pełnego zwrotu przez kasjera; podpis pozostaje wyłącznie po stronie właściciela.
- P2: heartbeat działał tylko na zakładce kolejki. Obecność jest teraz częścią aktywnego stanowiska i zmiany, niezależnie od zakładki, z testem ciągłości przy przełączaniu.
- P2: nowe kwoty zobowiązań były dostępne tylko w API. Raport pokazuje osobno otrzymane wpłaty, przyjętą sprzedaż, oczekiwanie na akceptację i kwoty do zwrotu, a także liczbę zamówień według źródła. Test właściciela przeszedł red → green.

Końcowy przegląd wykrył dodatkowo P2: aktualizacja obecności resetowała czas przygotowania wybrany przez kasjera do wartości domyślnej lokalu. Poprawka inicjalizuje wartość raz na lokal/sesję i zachowuje ręczny wybór; regresja sprawdza odświeżenie obecności oraz zmianę lokalu. Końcowy niezależny przegląd potwierdził zamknięcie wszystkich pięciu uwag tej osi.

## Dodatkowe sprawdzenia integracji

Potwierdzono ochronę prywatnych zamówień na dawnych trasach checkout, niezależny od lojalności dowód płatnika NIM/EVM, blokadę obejścia odbioru przez ogólną zmianę statusu oraz rozdzielenie kodów płatności, nagrody i odbioru. Ważna wycena pozostaje rozliczalna po wstrzymaniu nowych zamówień.

Kasjer może zakończyć zmianę z oczekującym zdalnym zwrotem; zobowiązanie pozostaje w kolejce i aktualnym raporcie lokalu. Zamknięty raport zmiany jest historycznym snapshotem. Dotychczasowe reguły nierozliczonych zamówień przy ladzie pozostają zachowane.

Regresje równoległych żądań sprawdzają ponowne tworzenie tego samego zamówienia, wielokrotną akceptację z pojedynczą pieczątką oraz jednorazowe wydanie. Nie są dowodem zachowania niezależnych sesji natywnego PostgreSQL.

## Weryfikacja i ograniczenia

Pełne API: 203/203. Shared: 42/42. Końcowy zintegrowany web: 151/151. Razem 396 testów w trzech zestawach, dodatkowo cztery scenariusze przeglądarkowe. TypeScript API/web oraz produkcyjny build przechodzą. Build zgłasza nieblokujące ostrzeżenie o głównym pakiecie JavaScript przekraczającym 500 kB.

Chromium: pełny przebieg demo od wyboru lokalu do odbioru, 320/390/736/1280 px, bez błędów runtime i poziomego przewijania. Cztery scenariusze Playwright obejmują odbiór, timeout, odmowę i responsywność; każdy przeszedł w osobnym procesie przeglądarki. Zbiorczy pierwszy przebieg ujawnił ograniczenie --single-process przy ponownym użyciu kontekstów przeglądarki w tym środowisku; nie był to błąd aplikacji. Dowód: ../product/screenshots/remote-browser-qa.txt.

Natywny PostgreSQL, fizyczny Android/Nimiq Pay, rzeczywista kamera oraz płatności i zwroty na łańcuchu pozostają osobnymi bramkami odbioru. Testy API uruchomiono na lokalnym PGlite z adapterem protokołu. Nie wykonano wdrożenia, push do GitHub ani rzeczywistych przelewów. Flaga sprzedaży zdalnej domyślnie wyłączona. Dodatkowy test komunikatu zwrotu odróżnia zatwierdzenie właściciela od potwierdzonego przelewu.
