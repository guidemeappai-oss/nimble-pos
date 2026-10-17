# Nimble — własny fork, instrukcja przekazania

Stan: 17 października 2026. Publiczny projekt: https://github.com/guidemeappai-oss/nimble-pos

## Szybki start z GitHuba

```bash
git clone https://github.com/guidemeappai-oss/nimble-pos.git
cd nimble-pos
```

Następnie przejdź do sekcji 3 (demo), 4 (Docker) lub 5 (development). Nie musisz tworzyć kolejnego forka ani importować bundle. Gotowy kod jest na `main`; bazę V1 zachowuje gałąź `upstream-v1-base`. Historia oryginału pozostaje zachowana, a rozszerzenia publikowane są jako zbiorczy commit. Pełna historia prac lokalnych jest w wcześniej przygotowanym bundle. Sekcje o tworzeniu repozytorium i imporcie pakietu poniżej są alternatywną drogą odtworzenia.

## 1. Co otrzymujesz

Oryginał: https://github.com/gallareton/nimble (licencja MIT; zachowaj LICENSE).
**V1** oznacza tutaj dokładnie bazę naszych zmian: `c9559445b9841fef469e42c18f1ee3a00df72453`, lokalnie oznaczoną tagiem `upstream-v1-base`. To nasza nazwa punktu odniesienia, nie oficjalne wydanie autora ani zapewnienie o aktualnym HEAD GitHuba.

Ukończony kod funkcji: commit `8282525`; gałąź forka zawiera dodatkowo tę instrukcję i konfigurację uruchomienia. To pełna aplikacja z zachowaną historią V1, a nie zestaw plików do ręcznego kopiowania. Nie trzeba scalać zmian do oryginalnego repozytorium. Fork GitHub został utworzony przez właściciela konta; kod jest przygotowany do publikacji w tym repozytorium.

Pakiet `nimble-fork-handoff.zip` zawiera pełny `nimble-fork.bundle`, tę instrukcję oraz osobny szkic PL-21. Bundle obejmuje historię gałęzi i tag V1, bez node_modules, sekretów środowiska, bazy i zdjęć przesłanych przez użytkowników. Rozpoczęty PL-21 nie należy do uruchamialnej gałęzi. Lokalnie zmodyfikowany zrzut `remote-acceptance.png` pozostawiono w poprzednim workspace; pakiet zachowuje wersję już zapisaną w Git.

## 2. Odtworzenie i własne repozytorium

Zainstaluj Git, Node.js 22 i pnpm **9.15.0**. Dla wariantu kontenerowego wystarczy Git oraz Docker Engine z Compose v2.

Po rozpakowaniu pakietu:

```bash
git clone -b fork/merchant-prelive ./nimble-fork.bundle nimble-fork
cd nimble-fork
git remote remove origin
git remote add upstream https://github.com/gallareton/nimble.git
# Lokalna blokada przypadkowego push do oryginału:
git remote set-url --push upstream DISABLED
git log -1 --oneline
git diff --stat upstream-v1-base..HEAD
```

Na GitHubie utwórz własny fork oryginału, wybierając własne konto/organizację. Jeśli jesteś właścicielem oryginału i interfejs nie pozwala na fork do tego samego konta, użyj innej organizacji albo osobnego pustego repozytorium `nimble-fork` (zachowa historię, choć GitHub nie oznaczy go jako fork).

Poniższe polecenia wykonaj dopiero z adresem **własnego** repozytorium:

```bash
git remote add origin https://github.com/TWOJE-KONTO/nimble-fork.git
git push -u origin fork/merchant-prelive
git push origin refs/tags/upstream-v1-base
```

W ustawieniach własnego repozytorium wybierz `fork/merchant-prelive` jako gałąź domyślną. Nie używaj `push --mirror`, `push --force` ani PR do upstream. Przyszłe zmiany oryginału można pobrać przez `git fetch upstream` i ocenić na osobnej gałęzi; nie są automatycznie dołączane.

## 3. Najprostszy podgląd bez pieniędzy

```bash
npm install -g pnpm@9.15.0
pnpm install --frozen-lockfile
pnpm --filter @nimble/web dev
```

Otwórz `http://localhost:5173/merchant/demo`, `/remote/demo` lub `/merchant/loyalty/demo`. Demo pokazuje przykładowe procesy, ale nie wszystkie nowe moduły i nie trwałe dane. Pełne moduły wymagają API i bazy.

## 4. Pełna aplikacja — osobny stos Docker

Z katalogu forka wygeneruj lokalne sekrety (Python 3; plik powstanie tylko, jeśli jeszcze nie istnieje):

```bash
python3 - <<'PYENV'
import os, secrets
fd = os.open('.fork.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    for key in ('POSTGRES_PASSWORD', 'JWT_SECRET', 'CODE_PEPPER'):
        f.write(key + '=' + secrets.token_hex(32) + '\n')
    f.write('APP_ORIGIN=localhost:3000\nCORS_ORIGIN=http://localhost:3000\nNIMIQ_NETWORK=TestAlbatross\nWALLET_DISCOVERY_ENABLED=0\n')
PYENV
docker compose --env-file .fork.env -f compose.fork.yaml up -d --build
docker compose --env-file .fork.env -f compose.fork.yaml logs -f app
```

Aplikacja: `http://localhost:3000`; kontrola startu: `/healthz`. Obraz kompiluje frontend, a przy starcie uruchamia istniejące migracje Drizzle (do `0040`) i API. API działa przez `tsx`; projekt nie posiada osobnego skryptu kompilacji API do dist. Nie generuj nowych migracji podczas zwykłej instalacji.

Stos ma własną bazę `nimble_fork` i trwałe wolumeny bazy, prywatnych zdjęć zadań oraz zdjęć menu. Nie korzysta z bazy V1. `docker compose ... down` zatrzymuje stos; `down -v` usuwa jego dane — nie używaj tego przy normalnej aktualizacji.

Konfiguracja domyślna: Nimiq testnet, zamówienia zdalne włączone globalnie, skaner portfela i powiadomienia wyłączone. To rzeczywisty backend bez mocków, a nie symulator przelewów. Produkcyjny tryb odrzuca MOCK_AUTH/FAKE_CHAIN.

Dla telefonu umieść usługę za reverse proxy z HTTPS; port jest celowo związany z localhost serwera. Ustaw w `.fork.env` `APP_ORIGIN` na nazwę własnej domeny, `CORS_ORIGIN` na pełne `https://...`, właściwe `NIMIQ_NETWORK` i `NIMIQ_RPC_URL`, następnie ponów `up -d`. W Nimiq Pay otwórz własny adres HTTPS jako Mini App i wybierz tę samą sieć. Nie korzystaj z adresu oryginalnej publicznej aplikacji w celu testowania forka.

USDT wymaga `POLYGON_RPC_URL` i Polygon mainnet oraz gazu; Nimiq testnet nie tworzy testowego USDT. Skaner wpłat włącza `WALLET_DISCOVERY_ENABLED=1` z odpowiednim RPC. Szczegóły konfiguracji i zakresu skanowania: [wallet-discovery-running.md](docs/product/wallet-discovery-running.md). Powiadomienia 1-luna wymagają osobnego portfela operatora i konfiguracji opisanej w [merchant-running.md](docs/product/merchant-running.md); nie są konieczne do pracy kasy.

## 5. Lokalny development i kompilacja

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm --filter @nimble/api migrate
# Terminal A, tylko lokalnie:
MOCK_AUTH=1 FAKE_CHAIN=1 REMOTE_ORDERING_ENABLED=1 pnpm --filter @nimble/api dev
# Terminal B:
VITE_WALLET=mock VITE_API_URL=http://localhost:3000 pnpm --filter @nimble/web dev
```

Domyślna baza developerska: `postgres://postgres:nimblink@localhost:5433/nimblink`. Nie uruchamiaj równocześnie kontenera app na porcie 3000. Zmienne należy eksportować lub podać w poleceniu; API nie ładuje automatycznie dowolnego pliku `.env`. Fake-chain służy testom P2P, nie zastępuje weryfikacji merchant NIM/USDT i kursów.

```bash
pnpm --filter @nimble/api exec tsc --noEmit
pnpm --filter @nimble/web build
```

Frontend powstaje w `apps/web/dist`. Poza Dockerem API może serwować go po ustawieniu `WEB_DIST` na bezwzględny katalog dist; ustaw także DATABASE_URL, JWT_SECRET, CODE_PEPPER i właściwą sieć. Dla wspólnej domeny buduj frontend z `VITE_API_URL=''`. Wersję testową z `VITE_WALLET=mock` trzeba przebudować bez tej zmiennej przed testami portfela.

## 6. Funkcje i sposób pracy

| Obszar | Wykonane funkcje i instrukcja |
|---|---|
| Kasa i płatności | Lokal, pracownicy/PIN, parowanie telefonu, zmiany, warianty/dodatki, wyceny NIM/USDT, gotowość/odbiór, zwroty właściciela — [merchant-running](docs/product/merchant-running.md). |
| Zamówienia zdalne i lojalność | Odkrywanie lokali, płatność przed odbiorem, akceptacja kasjera, QR odbioru, karty i nagrody — [remote](docs/product/remote-ordering-running.md), [loyalty](docs/product/loyalty-running.md). |
| Zarządzanie | Uprawnienia, audyt, zadania ze zdjęciami, grafik, ewidencja czasu/przerw, przekazanie zmiany, zamknięcie dnia — odpowiednie `*-running.md` w docs/product. |
| Menu | Wersjonowanie/publikacja, zestawy, kalendarz dostępności, zdjęcia, alergeny, tłumaczenia, kontrolowane rabaty — [menu-versions](docs/product/menu-versions-running.md), [discounts](docs/product/discounts-running.md). |
| Magazyn | Dostawy/częściowe przyjęcia, spisy, rezerwacje, straty, rozliczenie żywności i utylizacja ze zdjęciami — [stock-operations](docs/product/stock-operations-running.md), [food-reconciliation](docs/product/food-reconciliation-running.md). |
| Receptury i produkcja | Wersje receptur, jednostki, koszt średni ważony, rozchód składników, półprodukty i rzeczywisty uzysk, blokady składników — [recipes](docs/product/recipes-running.md), [production](docs/product/production-running.md). |
| Partie i zakupy | FEFO, terminy ważności, alerty, partie w spisach/stratach, propozycje uzupełnień, szkice zakupów i powiązane dostawy — [inventory-lots](docs/product/inventory-lots-running.md), [purchasing](docs/product/purchasing-running.md). |
| Rozliczenia | Skaner wpłat, dowiązanie transferów, nadpłaty i zwroty, trwałe dowody sprzedaży, raport fiat/krypto/zobowiązań i CSV — [deposit-resolutions](docs/product/deposit-resolutions-running.md), [finance](docs/product/finance-running.md). |

Pierwsze uruchomienie: właściciel otwiera `/merchant/owner`, łączy portfel i tworzy lokal, odbiorców płatności oraz profile pracowników. Następnie konfiguruje magazyn, receptury i opublikowane menu; generuje token dla `/merchant/terminal`. Pracownik paruje telefon, loguje się PIN-em i otwiera zmianę. Zamówienia zdalne trzeba dodatkowo udostępnić w ustawieniach lokalu. Klient korzysta z `/venues`, `/orders`, `/merchant/scan` i `/merchant/cards`.

Przepływ: interfejs React → API Fastify → PostgreSQL; wspólne typy i reguły w packages/shared. Wycena zamraża warunki płatności i rezerwuje magazyn. Potwierdzenie wymaga weryfikacji sieciowej; zamówienie zdalne wymaga jeszcze akceptacji. Rozchód następuje raz. Zwrot finansowy nie przywraca automatycznie żywności na magazyn. Klucze klienta/właściciela pozostają w portfelu, backend nie podpisuje ich przelewów. Partie przeterminowane powodują alert, nie automatyczne usunięcie. Raport finansowy rozdziela sprzedaż, wpływy, zwroty zgłoszone/potwierdzone i zobowiązania; nie jest raportem zysku netto.

## 7. Weryfikacja i rzeczy pozostałe

Wykonane lokalnie: PL-01,03–20. PL-02 (odbiór na natywnym PostgreSQL) pozostaje otwarte. PL-21 zawiera tylko rozpoczęte typy i arytmetykę kosztów — brak kompletnego raportu marży. PL-22 rekomendacje, PL-23 hardening/E2E, PL-24 migracje/restore i PL-25 końcowy odbiór pozostają do ukończenia. Pełny plan: [pre-live-completion-plan.md](docs/product/pre-live-completion-plan.md).

Ostatnie wyniki przed pakowaniem: web281/281, shared57/57, Chromium9/9; typy i build zaliczone. Finanse API46/46, późniejszy test finansów10/10. Ostatni pełny przebieg API345/346 miał timeout sweeper; osobne ponowienie2/2 przeszło, co nie oznacza pełnej zielonej regresji. Testy bazowe korzystały z PGlite, przeglądarka z testowych portfeli/łańcucha. Docker, rzeczywisty PostgreSQL, RPC i fizyczny telefon nie mają jeszcze pełnego odbioru. Konfiguracja przekazania jest przygotowana, nie została wdrożona.

Testy na własnym komputerze:

```bash
pnpm --filter @nimble/shared test
pnpm --filter @nimble/web test
# Dedykowana baza tylko do testów — runner usuwa jej dane:
docker compose exec postgres createdb -U postgres nimble_test
NATIVE_POSTGRES_TEST_URL=postgres://postgres:nimblink@localhost:5433/nimble_test NATIVE_POSTGRES_ALLOW_RESET=yes node scripts/test-native-postgres.mjs
# E2E używa osobnej bazy nimblink_test i portów 3100/5174:
docker compose exec postgres createdb -U postgres nimblink_test
pnpm --filter @nimble/e2e exec playwright install chromium
TEST_DATABASE_URL=postgres://postgres:nimblink@localhost:5433/nimblink_test REMOTE_ORDERING_ENABLED=1 pnpm --filter @nimble/e2e test
```

Jeśli baza testowa już istnieje, pomiń createdb. Nigdy nie wskazuj testom bazy użytkowej. Workflow `.github/workflows/native-postgres.yml` pozwala wykonać pełne API na natywnym PostgreSQL w swoim forku; jego przygotowanie nie oznacza zakończonego przebiegu CI.

Przed live: pełna regresja natywna, próba backup/restore, test poprawnej migracji kopii danych, następnie telefon (podpis, odmowa, powrót do WebView, odzyskanie hash, finalność i zwrot; kamera/QR, uprawnienia i wąskie ekrany). Aktualizację istniejącej V1 testuj wyłącznie na kopii jej bazy oraz plików. Nie podłączaj starego kodu V1 do bazy po nowych migracjach. Rollback wymaga przywrócenia pasującego backupu bazy i plików wraz z wersją kodu. Automatyczny i zweryfikowany proces migracji/restore jest jeszcze zadaniem PL-24.

## 8. Kontynuacja przez programistę lub agenta

Zacznij od niniejszego pliku, planu pre-live i `docs/product/pre-live-completion-running.md`; starsze sekcje dokumentów opisują historyczny stan, najnowsze dopiski mają pierwszeństwo. Ukończ PL-21/22, potem bramki PL-02/23–25. Szkic PL-21 w pakiecie jest opcjonalnym materiałem roboczym, nie funkcją gotową do wdrożenia. Zalecane skille: implement/implement-spec do planu, diagnosing-bugs do awarii, code-review do odbioru oraz handoff do przekazania. Zachowaj wszystkie istniejące testy P2P i reguły odzyskiwania płatności.
