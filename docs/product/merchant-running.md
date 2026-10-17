# Nimble Counter — uruchomienie i stan implementacji

## Podgląd i demonstracja

W katalogu repozytorium:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nimble/web dev
```

Otwórz `http://localhost:5173/merchant/demo`. Maison Café działa bez bazy, portfela i pieniędzy. Możesz wybrać produkt, rozmiar i dodatki, udostępnić podsumowanie, zasymulować płatność NIM/USDT, odbiór i pełny zwrot zatwierdzany w widoku właściciela. Profile demonstracyjne: Anna `1234`, Leo `5678`. Dane demonstracji są przechowywane wyłącznie w pamięci i znikają po przeładowaniu strony.

## Lokal i wspólny telefon

Właściciel otwiera `/merchant/owner` na swoim urządzeniu, łączy portfel, tworzy lokal z walutą EUR/PLN/USD, adresami odbiorczymi, menu i profilami kasjerów. W sekcji Terminal generuje token, który wprowadza na telefonie kasowym pod `/merchant/terminal`. Token przypisuje jeden telefon; ponowne parowanie lub odwołanie unieważnia stare dostępy.

Kasjer wybiera profil, wpisuje PIN i otwiera własną zmianę. Może układać zamówienia, przełączać dostępność produktów i dodatków, oznaczać gotowość/odbiór oraz zgłaszać zwroty. Nie zmienia cen, odbiorcy utargu ani kont pracowników; widzi swoją historię i wspólną aktywną kolejkę, a raport całego lokalu jest dostępny właścicielowi.

Klient może otworzyć `/merchant/scan`: skanowanie aparatem działa, gdy host udostępnia kamerę i wykrywanie QR. W innych hostach pozostaje wklejenie linku lub skaner Nimiq Pay. Rozpoznawane są wyłącznie odsyłacze do checkoutu tego serwisu, w tym jego App Link w `nimpay.app`; skaner nie przekierowuje do obcej strony z QR.

Właściciel zatwierdza zwrot w swoim portfelu na swoim telefonie. Zwrot obejmuje otrzymaną kwotę kryptowaluty i oddzielną opłatę sieciową; nie przelicza kwoty według nowego kursu. Jest oznaczany jako wykonany dopiero po weryfikacji przelewu.

## Backend i płatności

Dotychczasowy quickstart PostgreSQL i migracji z README nadal obowiązuje. Migracje `0009`–`0012` dodają tabele lokalu, kasjerów, katalogu, zamówień, zwrotów i kolejki powiadomień. Uruchom `pnpm --filter @nimble/api migrate` przed startem serwera.

NIM korzysta z `NIMIQ_RPC_URL` właściwego dla `NIMIQ_NETWORK`. Puste lub nieustawione RPC używa dotychczasowego domyślnego adresu sieci. USDT wymaga jawnego `POLYGON_RPC_URL` dla Polygon mainnet, chain ID 137, oraz adresu USDT lokalu. Obsługiwany kontrakt: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`, 6 miejsc dziesiętnych. Nie zastępuj go tokenem testowym pod tą samą nazwą.

Wyświetlane szacunki korzystają ze świeżych kursów CoinGecko; brak lub przeterminowanie kursu nie wprowadza fikcyjnej ceny. Ostateczna wycena ma ustaloną kwotę w najmniejszych jednostkach i ważność 120 sekund. Podczas jej ważności zamówienie jest zablokowane do edycji. Po wygaśnięciu bez znanego przelewu można je zmienić/anulować. Prawidłowy finalny przelew zaksięgowany po wygaśnięciu wyceny jest zapisywany i kierowany do pełnego zwrotu zamiast realizacji zamówienia. Wygaśnięcie wyceny nie ukrywa otrzymanych środków; dokładny zwrot zaksięgowany po terminie autoryzacji również można potwierdzić. Zachowana historia pozwala sprawdzić wcześniejszy przelew; płatność za anulowaną lub zmienioną wersję tworzy prośbę o pełny zwrot z oryginalnym podsumowaniem.

Przed otwarciem zatwierdzania portfela przeglądarka zapisuje zamiar płatności/zwrotu. Przeładowanie w niepewnym momencie blokuje kolejne podpisanie; można podać identyfikator z historii portfela i sprawdzić tę samą transakcję. Serwer utrwala każde zgłoszenie transakcji wraz z właściwą wyceną i podsumowaniem, sprawdzając je także po zamknięciu klienta. Błędny hash można poprawić identyfikatorem istniejącego przelewu z historii portfela; poprawienie nie uruchamia podpisywania ani nowej płatności. Pierwsze zgłoszenie pozostaje zachowane. Nowe identyfikatory mają limit 5 na minutę dla zamówienia i rodzaju operacji, a automatyczne sprawdzanie niepotwierdzonych prób ma narastający odstęp (maksymalnie godzinę). Ręczne sprawdzenie ponownie uruchamia weryfikację wskazanej próby. Znany przelew nadal blokuje ponowne podpisywanie i edycję koszyka. Portfel wybiera opłatę sieciową; obsługa ERC20 nie jest obietnicą darmowego gazu.

## Sygnały odbioru

Domyślnie wysyłka jest wyłączona. Aby ją włączyć, ustaw wszystkie `NOTIFICATION_*` z przykładów w `deploy/`, finansując wyłącznie osobny portfel operatora Nimble. `NOTIFICATIONS_ENABLED=true` uruchamia kolejkę; `NOTIFICATION_NETWORK_ID` musi odpowiadać stosowi Nimiq (mainnet 24, testnet 5).

Przejście do Gotowe tworzy jeden wpis kolejki. Worker podpisuje 1 lunę z identyfikatorem zdarzenia, trwale zapisuje podpisane bajty przed wysyłką i ponawia te same bajty przy niepewnym wyniku. Limity obejmują wartość i opłatę, a zmiana statusu zamówienia działa niezależnie od dostarczenia sygnału.

## Wymagane sprawdzenie na urządzeniu przed użyciem produkcyjnym

- Nimiq Pay musi udostępnić jednoznaczny identyfikator wybranej sieci przez provider; brak tej możliwości blokuje podpisanie NIM. Sama wysokość bloków nie potwierdza sieci. Obsługa tego zapytania wymaga testu aktualnej wersji Nimiq Pay.
- Sprawdź, czy konto zwrócone przy połączeniu odpowiada faktycznemu nadawcy wybranemu w zatwierdzaniu NIM.
- Przejdź rzeczywisty przepływ NIM/USDT, finalność, odrzucenie, zwrot oraz powrót do WebView po zatwierdzeniu. Lokalne testy weryfikatorów używają kontrolowanych odpowiedzi RPC; nie zastępują tych sprawdzeń.
- Sprawdź link/QR w Androidzie, kamerę/skaner Nimiq Pay oraz uprawnienia EVM/gaz.
- Sprawdź alert przelewu 1 luny z aplikacją w tle i zablokowanym ekranem. Nie zakładamy, że przelew budzi WebView, otwiera zamówienie lub pozwala miniaplikacji zmienić treść systemowego powiadomienia.

W tej implementacji nie wykonano realnych przelewów, zasilenia portfela powiadomień, wdrożenia ani publikacji na GitHubie.

## Weryfikacja lokalnej implementacji — 14 października 2026

- API: 162 testy w 30 plikach.
- Web: 111 testów w 19 plikach.
- Wspólna domena: 42 testy. Łącznie 315 testów przechodzi.
- Dodatkowo wszystkie 4 istniejące testy Playwright P2P przechodzą: płatność dwóch użytkowników, odrzucenie, zużyty/niepoprawny kod i anulowanie.
- TypeScript API/Web oraz produkcyjny build Vite przechodzą.
- Przegląd zgodności ze specyfikacją i standardami zakończony; wykryte problemy rozliczeń, odzyskiwania płatności i uprawnień zostały poprawione i ponownie sprawdzone.
- Demonstracja w Chromium: warianty/dodatki, USDT, przygotowanie, odbiór i zwrot zatwierdzany przez właściciela. Widoki 320, 390, 736 i 1280 px bez poziomego przepełnienia. Zrzuty są w `docs/product/screenshots/`.

Testy bazy uruchomiono na izolowanym PGlite z adapterem protokołu, ponieważ środowisko nie udostępnia natywnego PostgreSQL/Dockera. Adapter nie zmienia SQL, ale wspólny backend PGlite nie odwzorowuje wszystkich przeplotów równoległych sesji. Przed wdrożeniem uruchom zestaw API i scenariusze konkurencyjnych operacji na natywnym PostgreSQL. Testy RPC używają kontrolowanych odpowiedzi; realna sieć i Android pozostają bramką wydania opisaną powyżej.

## Poprawki po audycie — 15 października 2026

Spóźnione, zweryfikowane wpłaty są widoczne i trafiają do pełnego zwrotu. Zgłoszenia różnych hashy są przechowywane niezależnie i sprawdzane w tle; poprawienie błędu nie usuwa wcześniejszego zgłoszenia ani nie wywołuje podpisu. Kasjer, właściciel i klient korzystają ze wspólnego wyboru opłaconego podsumowania.

Migracja `0011` zachowuje oczekujące intencje jako próby transakcji. `0012` utrwala fakt anulowania niezależnie od aktualnie sprawdzanej rewizji. Starsze niejednoznaczne rekordy oczekujące ze znacznikiem wymaganego zwrotu zachowują tę ostrożną klasyfikację po migracji; nie są automatycznie wznawiane do realizacji.

Model nadal obejmuje jedną faktyczną wpłatę na zamówienie. Historia prób służy odzyskaniu identyfikatora oryginalnego przelewu, a interfejs blokuje kolejne podpisywanie. Rozliczenie dwóch różnych rzeczywistych wpłat na to samo zamówienie pozostaje poza zakresem tego modelu.

Weryfikacja poprawek: 168 testów API, 114 testów interfejsu i 42 testy domeny wspólnej — łącznie 324. TypeScript API/Web i produkcyjny build Vite przechodzą. Testy API korzystają z opisanego wcześniej izolowanego PGlite; testy rzeczywistych sieci i fizycznego Androida nadal są otwarte. Po końcowej poprawce anulowania ponownie uruchomiono cały zestaw API; interfejs i domena wspólna pozostały bez dalszych zmian względem ich zielonego przebiegu.
