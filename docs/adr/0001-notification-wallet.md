---
status: accepted
date: 2026-10-14
---

# Osobny portfel Nimble finansuje automatyczne powiadomienia

Po oznaczeniu zamówienia jako gotowe Nimble ma automatycznie wysyłać klientowi 1 lunę z identyfikatorem zdarzenia, bez dodatkowego potwierdzenia sprzedawcy. Użytkownik zaakceptował odrębną usługę z małym portfelem finansowanym przez operatora Nimble: pozwala ona podpisywać sygnały programowo, podczas gdy wysyłka z portfela sprzedawcy przez Nimiq Pay wymaga każdorazowej zgody. Portfel powiadomień nie otrzymuje utargu ani dostępu do kluczy sprzedawców lub klientów.

## Konsekwencje

- Jest to świadomy wyjątek od dotychczasowej zasady braku kluczy i podpisywania w infrastrukturze backendowej. Wyjątek dotyczy wyłącznie środków operatora przeznaczonych na powiadomienia.
- Przy implementacji wymagane są małe saldo, limity wydatków i wywołań, uwierzytelniona zmiana statusu, zabezpieczenie przed powielaniem sygnałów oraz obsługa opłat i wyczerpania środków.
- Stan zamówienia nie zależy od powodzenia przelewu. Transakcja przenosi sygnał; nie stanowi sama w sobie uprawnienia do odczytu zamówienia. Powiązanie wymaga sprawdzenia nadawcy, odbiorcy, sieci i identyfikatora zdarzenia.
- Dla płatności USDT trzeba powiązać także adres Nimiq klienta, na który zostanie wysłana luna.
- Decyzja nie oznacza wdrożenia, utworzenia lub zasilenia portfela ani wykonania realnych transakcji.
- Przed obietnicą powiadomień systemowych trzeba zweryfikować aktualną wersję Nimiq Pay na Androidzie: przy otwartej miniaplikacji, w tle i zablokowanym ekranie, z uwzględnieniem treści memo i zachowania po kliknięciu. Nie zakładamy automatycznego obudzenia kodu miniaplikacji.

## Podstawa techniczna

- https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider — wysyłka z portfela użytkownika wymaga potwierdzenia.
- https://nimiq.dev/web-client/reference/classes/keypair — programowe podpisywanie transakcji.
- https://nimiq.dev/rpc/methods/send-raw-transaction — rozsyłanie podpisanej transakcji.
- https://www.skool.com/miniappscompetition/feature-request-nimiq-pay-show-transaction-memo-in-payment-notifications — relacja twórcy NimJump o sygnałach przez przelew 1 luny; nie jest gwarancją działania na wszystkich urządzeniach.
