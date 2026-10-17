# Audyt Merchant POS — 15 października 2026

Zakres: `git diff c9559445b9841fef469e42c18f1ee3a00df72453...363f0351e350139221caa9a54f70b20e3b0115a3`. Skill AI Hero code-review: niezależne osie Standards i Spec oraz sprawdzenie rozliczeń przez prowadzącego audyt. Przegląd obejmuje kod aplikacji; opublikowana demonstracja nie uruchamia backendu płatności.

## Status po naprawie — 15 października 2026

Trzy opisane poniżej błędy zostały poprawione. Weryfikatory rozpoznają spóźnione środki i kierują je do zwrotu; trwałe próby transakcji umożliwiają poprawienie hasha bez drugiego podpisu; wspólne paidOrderSummary zapewnia właściwe podsumowania. Migracje 0011–0012 zachowują wcześniejsze intencje oraz anulowanie zamówienia. Poprawiono także nieaktualną deklarację README.

Ponowny niezależny przegląd Spec i Standards nie znalazł pozostałych ustaleń blokujących w zakresie trzech napraw. Dodatkowy przypadek błędnej klasyfikacji nowej rewizji po starej niezweryfikowanej próbie został odtworzony i poprawiony, z testami zachowującymi rzeczywiste anulowanie. Starsze niejednoznaczne rekordy wymagające zwrotu pozostają ostrożnie kierowane do zwrotu po migracji.

Sugestie dotyczące powielonej wyceny demonstracji i podziału Merchant.tsx pozostają pracami porządkowymi. Obsługa wielu rzeczywistych wpłat na jedno zamówienie nie została dodana; próby służą odzyskaniu oryginalnej płatności, a interfejs nie otwiera kolejnego podpisywania.


Weryfikacja poprawek: 168 testów API, 114 testów interfejsu i 42 testy domeny wspólnej — łącznie 324. TypeScript API/Web i produkcyjny build Vite przechodzą. Testy API korzystają z opisanego wcześniej izolowanego PGlite; testy rzeczywistych sieci i fizycznego Androida nadal są otwarte. Po końcowej poprawce anulowania ponownie uruchomiono cały zestaw API; interfejs i domena wspólna pozostały bez dalszych zmian względem ich zielonego przebiegu.

Poniższe ustalenia dokumentują stan sprzed napraw, wskazany w zakresie audytu.

## Spec

### P1 — przelew zaksięgowany po wygaśnięciu wyceny pozostaje nierozliczony

`apps/api/src/services/merchantPayments.ts:171–177`, wywołania w weryfikatorach Polygon i NIM; `apps/api/src/services/merchantSettlement.ts:84–85`.

Wymaganie: „Cashier observes chain-verified payment” i „Full refund […] exact paid crypto amount”. Wycena jest ważna 120 sekund. Adapter sprawdza ważność przed otwarciem zatwierdzania portfela, ale zatwierdzenie lub włączenie do bloku może nastąpić później. Poprawny, finalny przelew o dokładnej kwocie i właściwych adresach jest wtedy odrzucany przez inQuoteWindow. Weryfikator zwraca null, więc nie zapisuje otrzymanych środków ani nie umożliwia zwrotu. Ten sam problem dotyczy zwrotu zaksięgowanego po ważności jego autoryzacji.

Reprodukcja: kanoniczny finalny przelew USDT, blok w chwili issuedAt+121 sekund, wycena ważna 120 sekund → verify zwraca null. Test wykonany, wynik potwierdzony. Istniejący test odzyskiwania starego checkoutu podstawia łagodniejszy mock verify, więc nie wykrywa tej granicy.

Kierunek poprawki: oddzielić zgodność przelewu z zamówieniem od zgodności czasowej wyceny. Spóźnione, zweryfikowane środki zapisać i skierować do jawnego rozliczenia/zwrotu. Zachować ochronę przed starymi i ponownie użytymi transakcjami; nie usuwać bezwarunkowo wszystkich ograniczeń czasu.

### P1 — pierwszy błędny hash trwale blokuje zamówienie lub zwrot

`apps/api/src/routes/merchant.ts:974–998`, zwroty `1109–1119`; `apps/api/src/services/merchantSettlement.ts:84–85`.

Wymaganie: „Never trust a submitted tx hash without checking chain receipt” oraz obsługa płatności i zwrotów. Pierwszy poprawny składniowo hash zostaje utrwalony przed weryfikacją. Nieistniejący hash powoduje PAYMENT_PENDING; inny, poprawny identyfikator jest odrzucany jako PAYMENT_ALREADY_SUBMITTED. Nie ma końcowego stanu odrzucenia ani ścieżki naprawy. Osoba posiadająca link checkoutu może wywołać ten stan; wystarczy też błąd przy ręcznym odzyskiwaniu transakcji. Zwrot ma analogiczny mechanizm.

Reprodukcja API: verify=null dla hasha A → 200 PAYMENT_PENDING; zgłoszenie poprawnego B → 409 PAYMENT_ALREADY_SUBMITTED; anulowanie przez kasjera → 409. Test wykonany, wynik potwierdzony.

Kierunek poprawki: przechowywać i weryfikować zgłoszenia transakcji jako oddzielne próby. Rozróżnić wynik oczekujący, definitywnie niezgodny/nieudany oraz chwilowy błąd RPC. Umożliwić zweryfikowanie poprawnego hasha bez kasowania historii i bez zachęcania do ponownej płatności przy niepewnym wyniku.

### P2 — kolejka kasjera i lista właściciela pokazują niewłaściwą opłaconą rewizję

`apps/web/src/merchant/Merchant.tsx:1833–1835` i `:605`.

Wymaganie: „frozen item snapshots […] immutable order revisions”. Po opłaceniu wcześniejszej wersji backend zachowuje paidSnapshot, a bieżące lines i totalMinor dotyczą nowszej wersji. Klient korzysta z paidSnapshot, ale kolejka kasjera i lista właściciela renderują bieżące dane. Przykład z istniejącego testu merchantRecovery: opłacono dwie sztuki za 10,20; po edycji jedna sztuka za 5,10. Kasjer widzi jedną sztukę i 5,10 obok kryptokwoty starego przelewu.

Potwierdzenie: przepływ danych w kodzie i istniejący scenariusz testowy odzyskania rewizji. Bez nowego testu przeglądarkowego. Kierunek poprawki: wspólny selektor opłaconego podsumowania dla klienta, kasjera i właściciela.

Brak potwierdzonego nieuzasadnionego poszerzenia zakresu.

## Standards

Brak potwierdzonego naruszenia udokumentowanych zasad. Backendowy podpis powiadomień jest dozwolonym wyjątkiem ADR 0001. Nie znaleziono AGENTS.md, CODING_STANDARDS.md ani CONTRIBUTING.md.

- **P2, heurystyka Duplicated Code:** `apps/web/src/merchant/demo.ts:42–54` powiela wycenę, podczas gdy edycja w :62 korzysta z priceMerchantCart. Tworzenie demo pomija wspólną kontrolę dodatniej sumy i maksymalnej wartości koszyka. Dalsze kopie kalkulacji są w Merchant.tsx:1337–1350 i :1602–1612. Ujednolicić domenową wycenę i snapshoty.
- **P3, heurystyka Divergent Change:** Merchant.tsx skupia zarządzanie lokalem, menu, logowanie kasjera, kolejkę, checkout i odzyskiwanie płatności w 2641 liniach. Wydzielić ekrany i logikę ich stanu, zachowując małe wspólne komponenty.
- **Niespójność dokumentacji:** README:13–14 deklaruje „backend never signs anything”, mimo zaakceptowanego wyjątku dla portfela powiadomień. Doprecyzować, że klucze klientów i właścicieli pozostają w portfelach, a opcjonalny portfel operatora ma oddzielną rolę.

## Weryfikacja i ograniczenia

Dwie celowane reprodukcje Vitest przeszły: celowo potwierdzają obecne błędne zachowanie, nie jego naprawę. Test API uruchomiono na izolowanym PGlite z użytym wcześniej adapterem protokołu; test weryfikatora korzysta z kontrolowanych odpowiedzi RPC. Nie powtarzano całego zestawu 315 testów ani 4 scenariuszy P2P — audyt nie zmieniał kodu produkcyjnego. Wcześniejsze zielone wyniki nie obejmowały opisanych granic.

Nie wykonano realnych przelewów ani testów fizycznego Androida. Zgodność providera Nimiq Pay, powiadomienie przy blokadzie ekranu i współbieżność na natywnym PostgreSQL pozostają wcześniejszymi, jawnie otwartymi bramkami wydania. Nie są przedstawione jako nowe odkrycia.

Wniosek Spec: 3 ustalenia (2 P1, 1 P2), najpoważniejsze dotyczą rozliczania środków. Wniosek Standards: 0 twardych naruszeń, 2 heurystyki i 1 niespójność dokumentacji; najważniejsze jest powielenie wyceny. Rekomendacja: poprawić ustalenia Spec przed podłączeniem prawdziwych płatności. Audyt nie wprowadza napraw.

## Reprodukcje

Poniższe testy dopisano do tymczasowych kopii odpowiednio merchantPayments.test.ts i merchantRecovery.test.ts, aby użyć ich istniejących fixture. Uruchomiono tylko nazwy AUDIT (2 passed, 17 skipped). Tymczasowe pliki usunięto po audycie.

### auditPayments.temp.test.ts

```ts
it('AUDIT: successful finalized payment mined one second after expiry is invisible', async () => {
  const gateway = makeMerchantPayments({fx, polygonRpcUrl:'https://rpc.invalid', now:()=>now,
    request:polygonFixture({},(method,result)=>{if(method==='eth_getBlockByNumber' && result.timestamp) result.timestamp='0x'+BigInt((now+121000)/1000).toString(16)})});
  const quote=await gateway.quote({asset:'USDT',fiatCurrency:'EUR',totalMinor:1234,sender,recipient,reference:'order:1'});
  expect(await gateway.verify({hash,quote})).toBeNull();
});
```

### auditRecovery.temp.test.ts

```ts
it('AUDIT: unknown hash prevents correct replacement and cancellation indefinitely', async()=>{
 const f=await fixture(); app.deps.merchantPayments!.verify=async()=>null;
 const bad=await app.inject({method:'POST',url:f.checkoutUrl+'/payment',payload:{revision:1,quoteId:f.order.quote.id,hash:'a'.repeat(64)}});
 expect(bad.statusCode).toBe(200);expect(bad.json().status).toBe('PAYMENT_PENDING');
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()});
 const correct=await app.inject({method:'POST',url:f.checkoutUrl+'/payment',payload:{revision:1,quoteId:f.order.quote.id,hash:'b'.repeat(64)}});
 expect(correct.statusCode).toBe(409);expect(correct.json().error.code).toBe('PAYMENT_ALREADY_SUBMITTED');
 const cancel=await app.inject({method:'POST',url:f.orderUrl+'/status',headers:auth(f.cashierToken),payload:{revision:1,status:'CANCELLED'}});
 expect(cancel.statusCode).toBe(409);
});
```
