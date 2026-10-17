# 03: Zapis wizytówki zachowuje nowszą edycję

**What to build:** Jako właściciel nie tracę zmian wpisanych podczas oczekiwania na zapis.

**Blocked by:** None (can start immediately)

**Status:** completed — poprawki i lokalna regresja zakończone 2026-10-15

**Priorytet:** P2

Preferowane: zachować nowszy szkic i nie oznaczać go jako zapisanego. Dopuszczalne prostsze rozwiązanie: zablokować cały formularz na czas zapisu; przy błędzie zachować szkic.

- [x] Odpowiedź zapisu A nie kasuje nowszego tekstu B albo edycja B jest jawnie zablokowana podczas żądania.
- [x] Komunikat Zapisano odpowiada aktualnie wyświetlonym wartościom.
- [x] Checkbox publikacji oraz czas przygotowania mają te same zasady co pola tekstowe.
- [x] Błąd zapisu i zmiana lokalu nie usuwają aktualnego szkicu ani nie pokazują sukcesu starego lokalu.
- [x] Test opóźnionego PATCH wykazuje poprawne zachowanie.
