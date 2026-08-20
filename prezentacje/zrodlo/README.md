# Prezentacje — źródło

`security_deck.js` generuje **obie** wersje przeglądu bezpieczeństwa: `ContentAI_Security.pptx`
(PL) i `ContentAI_Security_EN.pptx` (EN). Treść obu języków siedzi w jednym pliku, więc nie da
się poprawić jednej wersji i zapomnieć o drugiej.

```bash
cd prezentacje/zrodlo
npm install pptxgenjs        # jedyna zależność
node security_deck.js        # wypluwa oba pliki do bieżącego katalogu
```

Gotowe pliki przenieś do `prezentacje/PL/` i `prezentacje/EN/`.

## Dlaczego deck powstaje ze skryptu

Poprzednia wersja opisywała model bezpieczeństwa, którego już nie ma — blokadę urządzenia
po odcisku przeglądarki, obfuskację JavaScriptu i rozdawanie pliku z wbudowanym kluczem.
Rozjechała się z systemem, bo nikt nie miał jak zauważyć, że się rozjechała.

Skrypt tego nie rozwiązuje sam z siebie, ale ustawia jedną rzecz: treść jest w kodzie, obok
reszty repozytorium, więc widać ją w diffie razem ze zmianą, której dotyczy.

Stare wersje leżą jako `ARCHIWUM_*` — do wglądu, nie do wysyłania.

## Paleta i typografia

Barwy wzięte wprost z aplikacji (Deep Space): bursztyn `FFB000` na czerni `07080D`, cyan
`46D5F2` na akcenty techniczne, czerwień i zieleń wyłącznie do rozróżnienia „przed" i „po".

Kroje to **Arial** i **Cambria** — celowo nie IBM Plex, którego używa aplikacja. IBM Plex nie
jest instalowany razem z Office, więc na cudzym komputerze deck rozjechałby się na podstawieniu
kroju. Tu wygląd ma być przewidywalny u odbiorcy, nie zgodny z brandingiem co do piksela.
