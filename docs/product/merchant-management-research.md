# Nimble: centrum zarządzania lokalem na telefonie

2026-10-15. Skill: research. Status: eksploracja produktowa, nie zatwierdzona specyfikacja ani zlecenie implementacji. Użytkownik chce rozwoju po stronie sprzedawcy: menu, zamówienia, płatności, pracownicy, zmiany i magazyn. Magazyn jest nowym kierunkiem względem wcześniejszego MVP bez stanów.

## Punkt wyjścia

Istnieją menu z wariantami/dodatkami, ręczna dostępność, konta kasjerów i zmiany, raporty, właścicielskie podpisy zwrotów, zamówienia zdalne z akceptacją i lojalność. Rozwijać te przepływy. Dane o faktycznych potrzebach lokali nie zostały jeszcze zebrane; poniższe priorytety są oceną produktową, nie wynikiem badań użytkowników.

## Wnioski ze źródeł

- Square rozróżnia dostępność/sold-out, liczbę gotowych porcji i pełne śledzenie zapasów; obsługuje dostępność wariantów oraz synchronizację kanałów. Źródło: https://squareup.com/help/us/en/article/8495-beta-item-availability
- Toast pozwala opóźniać lub wstrzymywać napływ zamówień online w przeciążeniu. Źródło: https://support.toasttab.com/en/article/Managing-Online-Order-Volume-Throttling-Orders-1492627940253
- Loyverse obsługuje produkty złożone, ilości składników i ich rozchód po sprzedaży; model może wyliczać koszt składników. Źródło: https://help.loyverse.com/help/how-create-composite-item
- Loyverse rozdziela role oraz uprawnienia m.in. do rabatów, menu, zwrotów, raportów i magazynu. Źródło: https://help.loyverse.com/help/how-manage-access-rights-employees
- Square oferuje raporty zmiany i procedury zamknięcia dnia. Źródło: https://squareup.com/help/us/en/article/6594-end-of-day-reporting-with-square-for-restaurants
- Loyverse obejmuje dostawców, zamówienia zakupowe, przyjęcie towaru i aktualizację kosztu. Źródło: https://help.loyverse.com/help/how-purchase-orders-and-suppliers

Te źródła potwierdzają istniejące wzorce funkcjonalne; nie dowodzą dostępności każdej funkcji w każdym kraju, planie czy na każdym telefonie. Propozycje Nimble poniżej są naszym projektem.

## Pomysły i wartość

| Obszar | Propozycja | Przykład działania |
| --- | --- | --- |
| Pulpit | Mój lokal teraz: problemy i bezpośrednie akcje | Dwa spóźnione zamówienia, trzy ostatnie porcje, zwrot do podpisu |
| Menu | Planowane menu i ceny | Śniadania do 11:00, weekendowy brunch; wcześniej wydane wyceny zachowane |
| Menu | Grupy dodatków i zestawy | Wybierz jedno mleko, maksymalnie dwa dodatki; kawa plus ciasto |
| Menu | Edycja seryjna i kopia robocza | Zmień ceny kategorii, obejrzyj podgląd, opublikuj lub przywróć wersję |
| Menu | Zdjęcia, alergeny, tłumaczenia | Jeden spójny katalog dla kasjera i klienta; dane zatwierdza właściciel |
| Zamówienia | Tryb dużego ruchu | Pauza 15 min, dłuższy czas nowych zamówień, limit kolejki |
| Zamówienia | Priorytety i częściowa gotowość | Kawa gotowa, kanapka w przygotowaniu; wydanie całego zamówienia potwierdzane osobno |
| Zamówienia | Wewnętrzne notatki i historia | Dlaczego zmieniono czas, kto przyjął, co ustalono z klientem |
| Płatności | Centrum wyjątków | Nierozpoznana wpłata, oczekujące potwierdzenie, zwrot do podpisu |
| Płatności | Rozliczenie dnia | Osobno sprzedaż, wpłaty, zwroty i zobowiązania, NIM/USDT oraz historyczna wartość fiat |
| Płatności | Eksport operacji | CSV z powiązaniem transakcji i zamówienia; brak obietnicy pełnej księgowości |
| Pracownicy | Kierownik i uprawnienia operacyjne | Rabaty do limitu, korekty zapasów, ceny, raporty; wypłaty nadal podpisuje właściciel |
| Pracownicy | Przekazanie zmiany | Następny kasjer potwierdza przejęcie zamówień i ważnych informacji |
| Pracownicy | Lista otwarcia/zamknięcia | Dostępność menu, zapasy, czystość stanowiska, nierozliczone sprawy |
| Pracownicy | Grafik, czas pracy i zastępstwa | Późniejszy moduł; zmiana kasowa i czas pracy są odrębnymi pojęciami |
| Magazyn | Licznik gotowych sztuk/porcji | Zostało siedem serników, ostatnia porcja blokuje dalszą sprzedaż |
| Magazyn | Dostawy, straty, inwentaryzacja | Przyjęto 24 butelki, dwie uszkodzone, policzono 19; każda korekta z powodem |
| Magazyn | Receptury i półprodukty | Latte zużywa kawę, mleko i kubek; dodatkowy shot zwiększa zużycie kawy |
| Magazyn | Brak składnika steruje menu | Brak mleka owsianego blokuje ten wariant w powiązanych produktach |
| Magazyn | Lista zakupów i terminy | Niski stan dodaje propozycję zakupu; później partie i terminy przydatności |
| Analiza | Koszt, marża i straty | Bestseller z niską marżą; marża składnikowa nie jest zyskiem całego lokalu |
| Właściciel | Zdalny podgląd lokalu | Własny telefon do monitorowania i zarządzania, wspólny telefon do sprzedaży |

## Najbardziej obiecujące połączenia

1. Ostatnia porcja: wspólny licznik dla lady i online, rezerwacja podczas ważnego checkoutu, rozliczenie po akceptacji. Odrzucenie zwalnia rezerwację; zwrot finansowy nie oznacza automatycznego przywrócenia przygotowanego jedzenia. Późne wpłaty wymagają istniejącej ścieżki wyjątków. Trzeba zdefiniować moment rezerwacji i jej wygasanie przed implementacją.
2. Przekazanie lokalu: kasjer kończy zmianę, przekazuje trzy otwarte zamówienia, brak mleka i oczekujący zwrot. Następny potwierdza przejęcie; właściciel widzi historię. To nie jest samo przełączenie PIN-u.
3. Tryb dużego ruchu: jedna akcja reguluje czas i przyjmowanie nowych zamówień. Nie zmienia po cichu obietnic dla już przyjętych zakupów; odrębne zasady dla wycen już wydanych.
4. Menu reagujące na magazyn: oznaczenie braku składnika wskazuje wszystkie dotknięte produkty i dodatki; pozwala ograniczyć tylko odpowiednie warianty.

## Proponowana kolejność

A. Pulpit Mój lokal teraz + tryb dużego ruchu: wykorzystuje istniejące dane i daje natychmiastową kontrolę.
B. Menu operacyjne + gotowe sztuki/porcje: pierwsza wersja magazynu, widoczny efekt w sprzedaży przy ladzie i online.
C. Przekazanie zmiany + kierownik i uprawnienia: jasna odpowiedzialność oraz wygoda właściciela.
D. Receptury, dostawy i straty: pełniejsze zarządzanie zapasami po potwierdzeniu prostego modelu w lokalu.
E. Marże, podpowiedzi zakupowe, grafik: zależą od jakości zbieranych danych.

Preferowany pierwszy większy pakiet: „Mam kontrolę nad dzisiejszym dniem” — pulpit + gotowe porcje + przekazanie zmiany, wdrażane jako oddzielne małe etapy. Nie uruchamiać wszystkiego jednocześnie.

## Kierunek interfejsu

Na telefonie pięć sekcji: Dziś, Zamówienia, Menu, Magazyn, Więcej (zespół, rozliczenia, ustawienia). Dziś skupia sprawy wymagające działania. Uprawnienia zmieniają dostępne operacje; kasjer nie musi widzieć pełnego panelu właściciela. Szybkie działania bez wielopoziomowych formularzy: +dostawa, strata, brak produktu, pauza, przekazanie zmiany.

## Decyzje przed specyfikacją

Pierwsza persona (kawiarnia, piekarnia lub mały lokal obiadowy), magazyn gotowych produktów vs składników, moment rezerwacji zapasu, polityka korekt, rola kierownika, zakres pracy właściciela z drugiego telefonu. Eksploracja nie zatwierdza implementacji tych modułów.

## Rozszerzenie zlecone 2026-10-15

Użytkownik zlecił plan wszystkich pomysłów oraz zadań pracowniczych ze zdjęciami (sprzątanie toalet i rozliczanie pozostałego jedzenia/utylizacji). Plan i 31 zadań: [merchant-management-plan.md](merchant-management-plan.md). Zdjęcie dokumentuje zgłoszenie do oceny kierownika; nie jest samoistnym dowodem braku kradzieży.
