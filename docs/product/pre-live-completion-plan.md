# Nimble — plan ukończenia przed testami na telefonie

Data: 2026-10-16. Baza analizy: `feat/merchant-management`, commit `93ec77f`; osobny worktree MM-27. Status dokumentu: plan wykonawczy, nie raport wykonania. Plan nie uruchamia wdrożenia ani prawdziwych przelewów.

## Cel i granica odbioru

Dostarczyć całość uzgodnionego zakresu MM-01–30 wraz z dotychczasowymi POS, zamówieniami zdalnymi, płatnościami NIM/USDT, lojalnością i sygnałem gotowości. Agent implementuje, testuje, dokumentuje i integruje; użytkownik później sprawdza gotowego kandydata na fizycznym Androidzie/Nimiq Pay. Nie dodajemy USDC tylko dlatego, że był rozważany: aktualny zakres płatności to NIM i USDT. Pełna księgowość, płace, dowóz, OCR i automatyczne tłumaczenia nadal pozostają poza zakresem.

Rozdzielamy MM-31 na **odbiór środowiska agenta** oraz późniejszy **odbiór telefonu i rzeczywistych integracji**. Zaliczenie pierwszego nie oznacza zaliczenia drugiego. Nie oznaczamy całego MM-31 jako ukończonego przed testem urządzenia.

## Stan wejściowy

- Lokalnie zintegrowane: MM-01, 02, 03, 04, 06, 08, 09, 10, 12, 13, 19, 20.
- MM-11: implementacja istnieje; natywna współbieżność pozostaje otwarta.
- MM-24: częściowe — brakuje kompletnej obsługi niezgłoszonych wpłat.
- MM-27: zmiany w osobnym worktree, bez zakończonej integracji.
- Pozostałe funkcje nieukończone. Ostatni zapisany wynik zintegrowany: 561/561; nie jest to wynik ponowiony przy pisaniu planu.
- Przed realizacją sprawdzić HEAD i lokalne zmiany. Zachować istniejącą zmianę zrzutu ekranu. Nie nadpisywać worktree grafiku.

## Organizacja wykonania

Nowy tracker uzupełnia istniejące MM, nie zastępuje ich wymagań i nie zamyka rodziców. Każdy PL ma własny plik, zależności i sprawdzalne kryteria. Tabela poniżej stanowi aktualną kolejkę tego planu; stare etykiety „blocked” nie przesądzają o rzeczywistej gotowości.

Pętla pracy: wybierz zadanie bez otwartych zależności → sprawdź wymagania i ryzyka → implementuj cały przepływ → testuj → przejrzyj → popraw → zapisz dokumentację i commit → przejdź do następnego zadania. Po każdej fali uruchom regresję integracji. Bez zatrzymywania na rutynowych wyborach; rzeczywisty brak dostępu, nierozstrzygnięta decyzja wpływająca na pieniądze albo niespełniona bramka pozostają jawnie otwarte.

Preferowana kolejność fal:

1. **Podstawa odbioru:** PL-01–02 — domknięcie rozpoczętego grafiku i natywny PostgreSQL.
2. **Koniec dnia i płatności:** PL-03–08 — rozliczenie jedzenia, przekazanie, zamknięcie dnia, brakujące wpłaty.
3. **Oferta i zespół:** PL-09–13 — harmonogram menu, zdjęcia, alergeny/języki, rabaty, czas pracy.
4. **Pełny magazyn:** PL-14–19 — receptury, rozchód, produkcja, dostępność, partie i zakupy.
5. **Ekonomia:** PL-20–22 — rozliczenie finansowe, koszty, marża i propozycje.
6. **Kandydat do telefonu:** PL-23–25 — E2E, migracje/odtworzenie, końcowa regresja i pakiet odbioru.

Fale są kolejnością zalecaną; wiążące zależności są w tabeli. PL-17 dodatkowo czeka na harmonogram, PL-18 na rozliczenie jedzenia, PL-20 na rabaty, aby odbiór obejmował ich wzajemne działanie. Bramka PostgreSQL jest wykonywana wcześnie i ponownie na końcowym commicie.

## Zadania wykonawcze

| Zadanie | Zakres | Rezultat | Zależności PL |
|---|---|---|---|
| [PL-01](../../.scratch/pre-live-completion/issues/01.md) | MM-27 | Domknięcie grafiku i zastępstw | — |
| [PL-02](../../.scratch/pre-live-completion/issues/02.md) | MM-11 / MM-31 | Powtarzalne środowisko natywnego PostgreSQL | — |
| [PL-03](../../.scratch/pre-live-completion/issues/03.md) | MM-21a | Rozliczenie policzonego jedzenia | 02 |
| [PL-04](../../.scratch/pre-live-completion/issues/04.md) | MM-21b | Odbiór utylizacji i wyjątków | 03 |
| [PL-05](../../.scratch/pre-live-completion/issues/05.md) | MM-22 | Przekazanie zmiany | — |
| [PL-06](../../.scratch/pre-live-completion/issues/06.md) | MM-23 | Zamknięcie dnia | 04, 05 |
| [PL-07](../../.scratch/pre-live-completion/issues/07.md) | MM-24a | Wykrywanie niezgłoszonych wpłat | — |
| [PL-08](../../.scratch/pre-live-completion/issues/08.md) | MM-24b | Rozstrzyganie wyjątków płatniczych | 07, 02 |
| [PL-09](../../.scratch/pre-live-completion/issues/09.md) | MM-05 | Harmonogram dostępności menu | — |
| [PL-10](../../.scratch/pre-live-completion/issues/10.md) | MM-07a | Publiczne zdjęcia menu | — |
| [PL-11](../../.scratch/pre-live-completion/issues/11.md) | MM-07b | Alergeny i języki menu | — |
| [PL-12](../../.scratch/pre-live-completion/issues/12.md) | MM-26 | Rabaty i zgody | — |
| [PL-13](../../.scratch/pre-live-completion/issues/13.md) | MM-28 | Ewidencja pracy i przerw | 01 |
| [PL-14](../../.scratch/pre-live-completion/issues/14.md) | MM-14a | Receptury i jednostki | 02 |
| [PL-15](../../.scratch/pre-live-completion/issues/15.md) | MM-14b | Rozchód według receptury | 14 |
| [PL-16](../../.scratch/pre-live-completion/issues/16.md) | MM-15 | Produkcja i półprodukty | 15 |
| [PL-17](../../.scratch/pre-live-completion/issues/17.md) | MM-16 | Brak składnika steruje ofertą | 15, 09 |
| [PL-18](../../.scratch/pre-live-completion/issues/18.md) | MM-17 | Partie i terminy przydatności | 16, 04 |
| [PL-19](../../.scratch/pre-live-completion/issues/19.md) | MM-18 | Zakupy i zamówienia dostaw | 17 |
| [PL-20](../../.scratch/pre-live-completion/issues/20.md) | MM-25 | Rozliczenia i eksport | 06, 08, 12 |
| [PL-21](../../.scratch/pre-live-completion/issues/21.md) | MM-29 | Koszt, marża i straty | 16, 20 |
| [PL-22](../../.scratch/pre-live-completion/issues/22.md) | MM-30 | Podpowiedzi zakupów i produkcji | 18, 19, 21 |
| [PL-23](../../.scratch/pre-live-completion/issues/23.md) | MM-31a | Pełny dzień lokalu w przeglądarce | 01, 04, 05, 06, 08, 09, 10, 11, 12, 13, 18, 19, 20, 21, 22 |
| [PL-24](../../.scratch/pre-live-completion/issues/24.md) | MM-31b | Próba migracji i odzyskiwania | 23 |
| [PL-25](../../.scratch/pre-live-completion/issues/25.md) | MM-31c | Wydanie kandydata do testów telefonu | 24 |

## Warunki „gotowe do testów telefonu”

- [ ] Każde kryterium MM-01–30 ma dowód implementacji i wynik odbioru; żadne częściowe zadanie nie jest ukryte pod „done”.
- [ ] Wszystkie funkcje działają razem na jednym commicie i bazie po aktualnych migracjach.
- [ ] Pełne API, UI, shared, typy i build przechodzą; E2E wykorzystuje prawdziwe API/bazę, a nie tylko demo.
- [ ] Natywny PostgreSQL sprawdzony na niezależnych sesjach; udokumentowane przypadki konkurencji.
- [ ] POS, remote, odmowa, zwrot, lojalność i powiadomienie sprawdzone także po restarcie i utracie odpowiedzi.
- [ ] Brak otwartych błędów powodujących utratę danych/pieniędzy, obejście uprawnień albo blokadę podstawowego przepływu. Pozostałe ograniczenia wyszczególnione.
- [ ] Odtworzenie kopii i migracja przetestowane; prywatne zdjęcia nie stają się publiczne.
- [ ] Dostępny pakiet testowy: hash wersji, raport, dane scenariusza, instrukcja uruchomienia i resetu, scenariusze telefonu.

Nie stosujemy samej liczby testów jako kryterium jakości. Raport rozróżnia testy na stubach RPC, natywną bazę, prawdziwą przeglądarkę i niewykonane integracje zewnętrzne. W razie niedostępnego PostgreSQL lub indeksowania sieci nie zmieniamy kryterium na łatwiejsze — dokumentujemy blokadę i rozwiązujemy ją przed deklaracją gotowości.

## Macierz odpowiedzialności

| Obszar | Agent przed przekazaniem | Użytkownik później |
|---|---|---|
| Funkcje biznesowe | Cały zakres, integracja, testy i przegląd | Wygoda i poprawność w realnej pracy |
| Baza i dane | Natywne blokady, migracje, kopia/odtworzenie | Nie wymaga ręcznych testów SQL |
| Telefon | Responsywność, symulacja kamery/odmowy sieci w przeglądarce | Fizyczna kamera, uprawnienia, klawiatura, powrót do aplikacji |
| Portfel i blockchain | Kontrolowane odpowiedzi, błędy, finalność, retry, zgodność kontraktów; dostępne odczyty integracyjne opisane osobno | Rzeczywisty provider Nimiq Pay, podpis NIM, osobny test USDT i zwrotu |
| Gotowość zamówienia | Jedno zdarzenie, worker, retry, zapis przed wysłaniem | Zachowanie alertu 1 luny w tle i przy zablokowanym ekranie |
| Uruchomienie | Zweryfikowany build i instrukcja testowej instancji HTTPS | Dostęp do instancji i odbiór na telefonie; publiczny start po odbiorze |

Samo zapisanie kodu nie daje adresu dostępnego z telefonu. Przed odbiorem trzeba uruchomić osobną instancję testową z HTTPS, bazą i storage oraz konfiguracją właściwej sieci. Hosting/dostępy są wymaganiem przygotowania środowiska; plan nie twierdzi, że już istnieją. Wdrożenie i rzeczywiste przelewy są odrębnymi czynnościami od niniejszego przygotowania planu.

## Późniejsza lista testów użytkownika

1. Właściciel tworzy lokal, publikuje menu, nadaje prawa i paruje telefon kasowy; kasjer nie może wypłacić utargu.
2. POS: wariant, dodatek, zestaw i rabat → płatność → częściowa gotowość → gotowe → jeden odbiór QR.
3. Remote: zakup → akceptacja lub odmowa → odbiór albo zwrot; pauza i limit kolejki.
4. Lojalność: kwalifikujące zakupy, odbiór nagrody, ponowny skan i korekta po zwrocie.
5. Magazyn: dostawa, produkcja, sprzedaż, brak składnika, spis, strata, rozliczenie jedzenia ze zdjęciami.
6. Zespół: grafik, zastępstwo, przerwa, checklisty, poprawa zgłoszenia, przekazanie i zamknięcie dnia.
7. Finanse: wyjątek płatniczy, raport, eksport i koszt produktu.
8. Warunki telefonu: odmowa kamery, utrata sieci, zamknięcie aplikacji, restart, zmiana pracownika i powrót z portfela.
9. Osobno NIM i USDT, ich sieci, kwoty, opłaty i potwierdzenia; testnet Nimiq nie czyni USDT testowym.
10. Gotowość: powiadomienie przy aktywnej aplikacji, w tle i przy zablokowanym ekranie — bez założenia gwarantowanego wybudzenia.

Każdy zgłoszony błąd: wersja, rola, scenariusz, kroki, oczekiwany/rzeczywisty wynik, czas i zrzut bez sekretów. Naprawa przechodzi regresję agenta, potem ponowny test telefonu. Publiczne uruchomienie dopiero po zamknięciu tego odbioru.
