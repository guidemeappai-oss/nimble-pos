# Nimble — kolejne funkcje

Data: 2026-10-15. Research AI Hero. Propozycje do wyboru, nie zatwierdzona specyfikacja ani wykonana implementacja.

## Punkt wyjścia

Obecny zakres obejmuje katalog z wariantami i dodatkami, QR, role właściciel/kasjer, zmiany, płatności, kolejkę, pełne zwroty i raport lokalu. Nie proponujemy tych elementów ponownie jako nowych funkcji. W repo istnieją też wcześniejsze przepływy P2P z historią i eksportem; ich obecność nie oznacza kompletnego eksportu sprzedaży nowego modułu merchant. Testy na fizycznym telefonie i wdrożenie pozostają osobnym etapem.

Źródła lokalne: merchant-pos-spec.md, merchant-direction.md, ../audits/merchant-pos-review.md; apps/web/src/merchant/Merchant.tsx, apps/web/src/wallet/merchantPayments.ts, apps/web/src/lib/network.ts, apps/api/src/routes/merchant.ts.

## Fakty z oficjalnych źródeł

- Konkurs przyznaje 45 punktów za funkcjonalność, niezawodność i użyteczność, 25 za integrację, 15 za rzeczywiste użycie, 10 za design/UX i 5 za promocję. Wskazuje także wartość powracania do aplikacji. Źródło: https://miniappscompetition.com/scoring
- Miniaplikacje działają w WebView; podpisywanie i wysyłanie płatności wymagają zgody w portfelu. Nie wynika z tego możliwość wykonywania własnego kodu w tle po otrzymaniu transferu. Źródło: https://www.nimiq.dev/mini-apps
- Dokumentacja opisuje język hosta, tryb pełnoekranowy i jawne rozpoznanie sieci przez window.nimiqPay.network / getHostNetwork() (helper od SDK 0.2.4). Starszy host może nie udostępniać sieci. Identyfikator urządzenia rozpoznaje urządzenie, nie człowieka ani kasjera. Źródło: https://www.nimiq.dev/mini-apps

## Rekomendowana kolejność — ocena produktowa

1. **Pierwsza sprzedaż krok po kroku.** Krótki kreator konfiguracji lokalu, adresów, pierwszych produktów, kasjera i sparowania telefonu; stan gotowości oraz jasno oddzielony test. Efekt: sprzedawca rozumie, jak zacząć. Wykorzystać istniejące operacje konfiguracji, bez obietnicy konkretnego czasu uruchomienia przed pomiarem.
2. **Karta stałego klienta.** Np. po pięciu kwalifikujących się zakupach nagroda ustalona przez właściciela. Animowana pieczątka po potwierdzeniu płatności, postęp i jednorazowe wykorzystanie nagrody. Największy potencjał demonstracyjny i powód do kolejnej wizyty. Punkty zapisane w bazie, bez nowego tokena i bez zbędnych transakcji. Wymaga uwierzytelnionego powiązania klienta, atomowego naliczania/wykorzystania, zasad zwrotów i limitów. Adres portfela ani device ID same w sobie nie dowodzą jednej osoby. Nagroda jako zniżka wymaga nowej wersji koszyka i obsługi zamówienia o wartości zero; nie wolno udawać płatności on-chain.
3. **Napiwek przed zapłatą.** Opcjonalna kwota, domyślnie zero, osobno od produktów w podsumowaniu. Jedna wyraźnie zatwierdzona płatność do właściciela. Osobne raportowanie; określić pełny zwrot obejmujący napiwek. Bez automatycznych wypłat na portfel kasjera.
4. **Rozwinięty ekran odbioru.** Duży numer, czytelny postęp i dopracowane przejście „gotowe”. Statusy już istnieją; nowe są jakość prezentacji i ewentualny czas oczekiwania. Początkowo czas ręcznie ustawiany przez lokal, wyraźnie orientacyjny. Wibracje/dźwięk i zachowanie po powrocie z tła do sprawdzenia na urządzeniu. Brak obietnicy natywnego push.
5. **Historia zakupów w lokalu i raport dnia.** Dla klienta zapisane potwierdzenia zamówień; dla właściciela filtr dat, popularne produkty i eksport danych sprzedaży merchant (produkty, zwroty, aktywa i kwoty fiat). Rozszerzenie istniejących widoków raportów i potwierdzeń. Nie przedstawiać potwierdzenia zamówienia jako integracji z kasą fiskalną.

Wspólny szlif: własne logo i kolory lokalu, zdjęcia produktów, pełny ekran, ujednolicenie tłumaczeń merchant z językiem hosta. Małe animacje powinny wzmacniać potwierdzenie czynności, zachowywać czytelność i respektować ograniczenie ruchu.

## Etap późniejszy

Samodzielne zamawianie przez klienta po QR przy stoliku lub przed przyjściem: duża wartość, ale świadome rozszerzenie obecnego zakresu. Potrzebne godziny przyjmowania, ręczne wstrzymanie zamówień, dostępność, limity kolejki, polityka przyjęcia/odrzucenia i zwrotów. Nadal bez stanów magazynowych. Wiele terminali i dzielenie rachunku także zmieniają model pracy; nie dokładać ich przed pilotażem podstawowej ścieżki.

## Ustalenie techniczne przed testami

Adapter merchant aktualnie szuka getNetworkId lub request, a routing API korzysta z wysokości bloków. Oficjalna dokumentacja wskazuje teraz jawne pole sieci hosta. W osobnym zadaniu należy ujednolicić rozpoznanie sieci na tej podstawie, sprawdzić wersję SDK i starsze hosty oraz zachować blokadę płatności przy braku pewności. To znalezisko researchu, nie wykonana poprawka.

## Proponowany pokaz

Sprzedawca wybiera kawę → klient widzi koszyk i opcjonalny napiwek → potwierdza płatność → otrzymuje pieczątkę i numer → sprzedawca oznacza gotowość → klient widzi ekran odbioru. Pilot w jednym prawdziwym lokalu pozwoli zweryfikować ten scenariusz i zebrać rzeczywiste opinie; oczekiwanego wzrostu sprzedaży lub powrotów nie traktujemy jako udowodnionego.
