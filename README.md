# Content AI

Generator treści pod SEO, AIO, AEO i GEO — artykuły, grafiki i audio z jednego okna.
Aplikacja jednoplikowa (HTML + JS, bez budowania), pakowana do wersji instalowalnych
na Windows, macOS, Androida i iOS.

**Wersja:** 2.8.0 (poprawki bazowe F1–F17 + reskin) · **Status:** przeniesiona do repo, gotowa do dalszej pracy

> Content AI jest niezależna od Cosmosa, który mieszka w katalogu głównym tego repo.
> Oba projekty nie współdzielą kodu.

---

## Jak to działa

Cała aplikacja to **jeden plik HTML** (~666 KB, ~10,5 tys. linii, 9 bloków `<script>`).
Nie ma bundlera ani kroku kompilacji — plik otwiera się bezpośrednio w przeglądarce
albo jest opakowywany w Electron / Capacitor.

Modele: `claude-sonnet-4-6` (treść), `claude-haiku-4-5` (zadania pomocnicze),
`gpt-image-1` (grafiki), `gpt-4o-mini-tts` i ElevenLabs (audio), `gpt-4o-transcribe`
(transkrypcja). Biblioteki do plików (mammoth, pdf.js, xlsx, html-docx-js) ładowane z CDN.

### Trzy warianty tego samego kodu

| Plik | Klucze API | Do czego |
|------|-----------|----------|
| `app/web-keys.html` | wpisywane w UI, `localStorage` | **domyślny** — pokazy, spotkania, bezpieczny do rozdania |
| `app/web-proxy.html` | po stronie Cloudflare Workera | szersza dystrybucja, użytkownik nie ma własnego klucza |
| `app/web-owner.html` | wpisane w pliku | jedno zaufane urządzenie wewnętrzne |

`app/worker.js` to Cloudflare Worker dla wariantu PROXY (proxy do Anthropic, OpenAI, ElevenLabs).

W repo **nie ma żadnych prawdziwych kluczy** — `web-owner.html` zawiera wyłącznie
placeholdery `WSTAW_TUTAJ_KLUCZ_*`. Wypełniaj je lokalnie i nie commituj wyniku.

---

## Struktura

```
contentai/
  app/               kod aplikacji — 3 warianty + worker + PWA (manifest, ikony)
  showcase/          landing page produktu (osobna strona, nie część aplikacji)
  pakowanie/         opakowania instalacyjne
    zbuduj_web.py      buduje payload web/ z wybranego wariantu
    electron/          Windows (.exe) i macOS (.dmg)
    capacitor/         Android (APK) i iOS (Xcode) + ikony natywne i splashe
  narzedzia/         skrypty patchujące z sesji, w której powstały zmiany F1–F17 + reskin
  dokumenty/         AdminGuide + dokumentacja v27 (PL/EN) + ocena vs konkurencja
  prezentacje/       PL/ i EN/ — deck produktowy, onboarding, security
```

Katalogi `web/` w `pakowanie/electron` i `pakowanie/capacitor` są **generowane**
przez `zbuduj_web.py` i celowo nie są wersjonowane (patrz `.gitignore`).

---

## Budowanie

```bash
cd pakowanie

# wariant KEYS (domyślny, bez workera)
python3 zbuduj_web.py

# wariant PROXY (wymaga wdrożonego workera)
python3 zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev

# payload trafia do web/ — skopiuj do wybranego opakowania
cp -r web electron/web     # Windows / macOS
cp -r web capacitor/web    # Android / iOS
```

Dalej: `pakowanie/README_PAKOWANIE.md` (pełna instrukcja),
`pakowanie/electron/INSTRUKCJA_Windows.md`, `pakowanie/capacitor/INSTRUKCJA_Android.md`,
`pakowanie/capacitor/INSTRUKCJA_iOS.md`.

Service Worker jest celowo pomijany w payloadzie, żeby uniknąć zastanego cache
w aplikacji natywnej.

---

## Stan zastany — co trzeba wiedzieć przed dalszą pracą

### 1. Brakuje czytelnego źródła DEV

Skrypty w `narzedzia/` (`rebuild_all.py`, `apply_faza.py`) generowały warianty
keys/proxy/owner z plików `ContentAI.html` i `ContentAI_owner.html`. **Tych plików nie było
w przekazanych paczkach** — skrypty odwołują się do nieistniejących ścieżek `/home/claude/...`
i w tej postaci nie da się ich uruchomić.

W praktyce znaczy to, że **`app/web-keys.html` jest teraz źródłem prawdy**, a nie artefaktem
budowania. Zmiany nanosi się bezpośrednio na warianty. Skrypty w `narzedzia/` zostają jako
dokumentacja tego, co i gdzie zostało zmienione (kotwice, konkretne stringi) — przydatne przy
odtwarzaniu zmiany w drugim wariancie.

Do rozważenia w dalszej pracy: sprowadzenie trzech wariantów do jednego źródła z parametrem
budowania, żeby każda poprawka nie wymagała trzech edycji. Warianty różnią się dziś w ok. 165
miejscach każdy — głównie w warstwie kluczy i wywołań API.

### 2. Zasoby natywne pochodzą ze starszej paczki

`ContentAI_komplet_reskin.zip` miał nowszy kod aplikacji, ale **zgubił** ikony natywne
i część instrukcji. Przy przenoszeniu odtworzono ze starszego `ContentAI_pakowanie.zip`:

- `capacitor/android-res/` — ikony launchera (legacy + round + adaptive) w 5 gęstościach
- `capacitor/ios-res/` — `AppIcon-1024.png`
- `capacitor/resources/` — `icon.png`, `splash.png`, `splash-dark.png`
- sekcję **„Krok 2b"** w `INSTRUKCJA_Android.md` — obejście dla Windows ARM, gdzie
  `npx @capacitor/assets` wywala się na kompilacji `sharp` (błąd MSB8020)

Ikony są odbrandowane (bursztynowa gwiazda na `#07080D`), zgodne z logo z showcase.

### 3. Aplikacja nie działa offline

Biblioteki do plików i fonty ładują się z CDN, a same generacje i tak wymagają internetu.
Pełny offline to osobny zakres (wbudowanie bibliotek lokalnie).

---

## Zakres zmian F1–F17 + reskin

Pełna tabela z kotwicami w kodzie: `narzedzia/INSTRUKCJA_naniesienia_zmian.md`.

W skrócie — **poprawki bazowe:** i18n historii, wykrywanie języka przeglądarki przy pierwszym
starcie, panel Klucze API, sekcja wniosków w języku treści, prompt SERP z językiem poza schematem
JSON (naprawia parsowanie), spinner pierwszego kroku, przeróbki i auto-poprawka w języku treści,
usunięcie reguły CSS psującej panele oceny, uzupełnianie luk bez skoku na dół artykułu, dropdown
przeróbek nad sidebarem, scroll panelu Luk, spinner sekcji, eksport PDF, empty-state jako SVG.

**Reskin:** splash raz na sesję (pomijalny tapnięciem, respektuje reduced-motion), przejścia
zakładek i wejścia pól, odliczanie wyników oceny, paski postępu treści i grafiki, ujednolicona
pozycja paneli oceny, poprawki mobile.

`apply_faza.py` ma przełącznik `SPLASH` — wariant `odbrand` (bursztyn + cyan) i `dhl`
(żółte tło, logo DHL). W repo jest wersja odbrandowana.

---

## Checklista weryfikacyjna po zmianach

- Aplikacja wstaje w ciemnym motywie, splash pokazuje się raz na sesję
- Bilans tagów: `<style>` == `</style>`, `<script>` == `</script>`
- Panele SEO / AIO / AEO / GEO otwierają się w tym samym miejscu
- Uzupełnianie luk nie przewija na dół artykułu
- Przeróbki, auto-poprawka i sekcja wniosków wychodzą w języku treści
- Analiza SERP zwraca dane i pokazuje przycisk SERP
