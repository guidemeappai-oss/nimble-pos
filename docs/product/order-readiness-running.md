# Gotowość pozycji zamówienia — MM-09

Data: 2026-10-16. Baza: 906ab28. Gałąź: feat/merchant-management. Skills: implement-spec, tdd, code-review. Status: w realizacji; bez wdrożenia.

## Zachowanie

Kasjer widzi gotowe i zamówione sztuki każdej linii, np. 1/2 kaw oraz 0/1 ciasta. Częściowa gotowość zachowuje PREPARING i blokuje odbiór całości. Gdy wszystkie sztuki są gotowe, serwer atomowo ustawia READY i dodaje pojedyncze zdarzenie powiadomienia, jeżeli zamówienie ma przypisany adres odbiorcy.

Ilości odnoszą się do niezmiennego opłaconego koszyka, w tym wariantów i zestawów. Gotowość zestawu dotyczy zamówionej jednostki zestawu; osobne statusy jego składowych pozostają poza tym etapem. Nie zmieniają ceny, obiecanego terminu, płatności ani zużycia magazynu.

Kasjer zapisuje podczas własnej otwartej zmiany. Właściciel ma odczyt. Rewizja chroni równoczesne zmiany, stabilny klucz chroni ponowienie po utracie odpowiedzi, a audyt zachowuje autora i czas. Podczas PREPARING można zmniejszyć omyłkowo oznaczoną ilość; po READY nie cofamy statusu ani wysłanej obietnicy.

Dotychczasowe oznaczenie całego zamówienia jako READY jest operacją wszystkich sztuk, korzystającą ze wspólnych reguł. Odbiór nie może ominąć gotowości. Historyczne READY/COLLECTED zachowują znaczenie bez wymuszenia ponownego przygotowania. Odbiór zdalny zachowuje QR i dotychczasowy dowód odbioru.

## Odbiór

- Dwie linie po 2 i 1 sztuce: częściowe przygotowanie nie ustawia READY i nie tworzy powiadomienia.
- Końcowa sztuka ustawia READY raz; retry nie dodaje zdarzeń, powiadomień ani rozchodu.
- Równoległe zmiany tej samej rewizji mają jednego zwycięzcę, przegrany widzi konflikt.
- PREPARING nie pozwala odebrać całości także przez stary endpoint statusu.
- Obcy lokal, klient, nieaktywna sesja i zamknięta zmiana nie zapisują gotowości.
- Koszyk/cena/termin są niezmienne, QR odbiera całość raz.
- Zmiana profilu czyści widok, utrata sieci nie udaje gotowości, niepewne ponowienie zachowuje zamiar.

Natywny PostgreSQL oraz fizyczny Android/Nimiq Pay pozostają otwartymi bramkami odbioru projektu.

## Uruchomienie i API

Migracja `0026_workable_thor_girl` tworzy zapis ilości gotowych oraz trwałych rezultatów ponowień. `GET /v1/merchant/venues/:venueId/orders/:orderId/readiness` jest dostępny uprawnionemu do lokalu właścicielowi lub kasjerowi. Odpowiedź zawiera rewizję gotowości, rewizję koszyka, status oraz ilości każdej linii. `POST` pod tym samym adresem przyjmuje absolutną ilość gotową, indeks linii, obie rewizje i UUID zamiaru; nowe wpisy wykonuje kasjer podczas własnej otwartej zmiany.

Utrwalony rezultat identycznego żądania można odczytać po zamknięciu zmiany lub zmianie statusu na READY. To potwierdzenie poprzedniego zapisu, bez nowej mutacji. Interfejs blokuje nowe zmiany, ale pozostawia możliwość odzyskania odpowiedzi. Po potwierdzeniu ponowienia pobiera aktualny stan — utrwalony rezultat może opisywać wcześniejszy postęp.

Dotychczasowa ścieżka statusu READY korzysta z tej samej usługi ustawiania wszystkich ilości i powiadomienia. Zarówno POS, jak i odbiór online sprawdzają gotowość; kod/QR nadal potwierdza całe zamówienie. Anulowanie nieopłaconego zamówienia zachowuje dotychczasowe reguły, nie otrzymało dodatkowej blokady otwartej zmiany.

## Przegląd dwóch osi

Spec: trzy znalezione problemy interfejsu poprawiono — kody konfliktów nie zwalniały zamiaru do świadomej korekty; końcowy zapis po utracie odpowiedzi stawał się niemożliwy do potwierdzenia po READY; warunek przycisku pracownika omyłkowo ukrywał klientowi informację o przygotowaniu. Ponowny przegląd zamknął wszystkie uwagi.

Standards: brak naruszeń udokumentowanych zasad. Zgłoszony przypadek niepewnego ponowienia po READY/zamknięciu zmiany poprawiono i objęto testem. Lokalne kopie typów zastąpiono kanonicznymi kontraktami shared. Ponowny przegląd bez otwartych ustaleń.

## Wyniki końcowe

Po scaleniu API i UI: pełne API **275/275** na lokalnym PGlite, web **234/234**, shared **48/48** — **557/557** testów. TypeScript API/web, produkcyjny build web i `git diff --check` przechodzą. Build zgłasza ostrzeżenie o głównym pakiecie, około 685 kB przed gzip.

Testy API obejmują ilości, korektę, finalne READY i pojedynczy outbox, identyczny retry, konflikt współbieżny, granice koszyka, gotowość legacy, zmianę i profil pracownika, snapshot płatności, niezmieniony rozchód zapasu, dowód odbioru QR i pojedynczy odbiór. Web sprawdza POS i kolejkę zdalną, częściowe ilości, odzyskanie odpowiedzi po READY i zamknięciu zmiany oraz zachowanie informacji widocznej dla klienta.

Dwie osie code review zamknięte bez otwartych ustaleń po poprawkach kodów konfliktów, retry po utracie odpowiedzi i widoku klienta. Nie wykonano push ani wdrożenia. Natywny PostgreSQL i fizyczny Android/Nimiq Pay pozostają otwartymi bramkami.
