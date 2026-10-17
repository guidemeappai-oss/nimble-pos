---
status: accepted
date: 2026-10-14
---

# Konto kasjera nie daje dostępu do portfela właściciela

Jeden telefon kasowy jest używany kolejno przez pracowników, którzy logują się do Nimble przez wybór profilu i indywidualny PIN. Utarg trafia do portfela właściciela, którego klucze i zatwierdzanie wypłat pozostają na jego własnym urządzeniu: samo ograniczenie przycisków w Nimble nie chroniłoby środków, gdyby kasjer miał dostęp do portfela w aplikacji hostującej. Kasjer zgłasza zwrot, a właściciel zatwierdza przelew na swoim telefonie; klient widzi oczekiwanie na zatwierdzenie.

## Konsekwencje

- Tożsamość zalogowanego operatora i adres odbiorcy płatności są odrębnymi pojęciami; nie wolno automatycznie kierować utargu do portfela aktualnego kasjera.
- Telefon kasowy przypisuje do lokalu właściciel. Logowanie PIN-em działa w kontekście tego urządzenia, z ograniczeniem prób i kontrolą uprawnień po stronie serwera.
- Powiadomienia transakcyjne finansuje osobny portfel operatora Nimble zgodnie z ADR 0001, więc kasjer nie potrzebuje dostępu do środków właściciela, aby oznaczyć zamówienie jako gotowe.
- Kasjer obsługuje zamówienia, widzi podsumowanie swojej zmiany i może ręcznie przełączać dostępność produktów oraz dodatków. Menu, ceny, konta pracowników i raport całego lokalu są zarządzane przez właściciela.
- Decyzja opisuje docelowe zachowanie, a nie już wdrożoną funkcję.

## Rozszerzenie 2026-10-16: delegowanie operacji lokalu

W ramach MM-01 właściciel może nadać pracownikowi rolę kierownika i jawne uprawnienia do określonych operacji. Początkowo wdrażamy delegowanie edycji menu, odczytu raportu lokalu i dziennika decyzji. Samo nazwanie pracownika kierownikiem nie nadaje wszystkich praw. Prawa są sprawdzane dla lokalu po stronie serwera i odczytywane na nowo przy kolejnych żądaniach, aby cofnięcie dostępu działało także podczas aktywnej sesji.

Konta i nadawanie uprawnień pozostają pod kontrolą właściciela. Kierownik nadal korzysta z operacyjnej sesji na przypisanym terminalu, nie otrzymuje portfela właściciela i nie podpisuje wypłat. Decyzja rozszerza wcześniejsze przypisanie menu i raportów wyłącznie właścicielowi, zachowując wyłączną kontrolę nad utargiem.

Przyszłe domeny zapasów, zadań, zdjęć i rabatów otrzymają osobne uprawnienia przy wdrażaniu ich rzeczywistych operacji; deklaracja uprawnienia nie oznacza istnienia tych modułów. Dziennik decyzji nie zapisuje PIN-ów, tokenów ani kluczy. Korekty są nowymi zdarzeniami zamiast usuwania historii.
