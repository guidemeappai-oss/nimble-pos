# Zdjęcia menu — PL-10 / MM-07a

Lokalny upload z podglądem, wymianą i usunięciem przypisania zdjęcia w szkicu. Publikacja udostępnia zdjęcie klientom; usunięcie z opublikowanego katalogu natychmiast blokuje publiczny odczyt (odpowiedzi no-store). Pliki są ponownie kodowane do JPEG, obracane według orientacji, pomniejszane do 2048 px, bez EXIF; powstaje też miniatura. Maksimum wejścia 10 MB, limit 1000 obrazów / 100 MB wejścia względem zapisanych bajtów per lokal. Powtórzenie uploadu zachowuje identyfikator, inna treść z tym samym kluczem jest odrzucana.

Publiczny odczyt wymaga aktualnego powiązania w katalogu; sam UUID nie upublicznia szkicu. Podgląd wymaga menu.manage we właściwym lokalu. Zdjęcia zadań pozostają w osobnej prywatnej przestrzeni. Nie ma współdzielenia ich identyfikatorów. Niepodpięte uploady są usuwane po 24 godzinach; zdjęcia wersji historycznych pozostają do przywracania menu, choć nie są publicznie dostępne. Godzinny worker czyści również pliki bez rekordu po przerwanym zapisie.

Migracja: 0031_menu_images.sql. Konfiguracja MENU_IMAGE_DIR; domyślnie .public/menu-images, w compose osobny trwały wolumen /var/lib/nimble/menu-images. Uwzględnić w kopiach i odtwarzaniu.

Weryfikacja: API zdjęć 3/3; API zdjęć+wersjonowania 7/7 przed dodaniem testu czyszczenia. UI zdjęć 2/2; UI zdjęć+studio 9/9. TypeScript API/web przechodzi. Testy: prywatny podgląd, publikacja/usunięcie, obcy lokal, nieobsługiwany plik, brak sesji, konflikt klucza, czyszczenie porzuconych plików, retry po utracie odpowiedzi oraz limit wejścia w UI. Pełna regresja integracji pozostaje osobnym odbiorem po scaleniu.
