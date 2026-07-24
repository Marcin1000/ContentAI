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

### Jedno źródło, trzy warianty

Źródłem prawdy jest **`app/contentai.html`** — jeden plik, z którego budowane są trzy
warianty różniące się wyłącznie sposobem podawania kluczy API:

| Wariant | Klucze API | Do czego |
|---------|-----------|----------|
| `keys` | wpisywane w UI, `localStorage` | **domyślny** — pokazy, spotkania, bezpieczny do rozdania |
| `proxy` | po stronie Cloudflare Workera | szersza dystrybucja, użytkownik nie ma własnego klucza |
| `owner` | wpisane w pliku | jedno zaufane urządzenie wewnętrzne |

```bash
cd pakowanie
python3 warianty.py --wariant proxy --worker-url https://moj.workers.dev -o /tmp/proxy.html
python3 warianty.py --wszystkie          # wszystkie trzy do app/dist/
```

Pliki `web-keys.html`, `web-proxy.html`, `web-owner.html` są **generowane** i nie leżą
w repo (patrz `.gitignore`). Poprawkę nanosisz raz, w `app/contentai.html`.

`app/worker.js` to Cloudflare Worker dla wariantu PROXY (proxy do Anthropic, OpenAI, ElevenLabs).

W repo **nie ma żadnych prawdziwych kluczy** — źródło zawiera wyłącznie placeholdery
`WSTAW_TUTAJ_KLUCZ_*`. Wypełniaj je lokalnie i nie commituj wyniku.

### Dyrektywy warunkowe

Fragmenty specyficzne dla wariantu są w źródle otoczone dyrektywami — w HTML jako komentarz
HTML, wewnątrz `<script>` jako komentarz JS:

```html
<!--@@IF keys-->        //@@IF owner,proxy
  ...tylko dla keys       ...dla owner i proxy
<!--@@ELSE-->           //@@ELSE
  ...dla pozostałych      ...dla keys
<!--@@ENDIF-->          //@@ENDIF
```

`@@IF` przyjmuje listę wariantów po przecinku. Zagnieżdżanie jest celowo niedozwolone —
płaska struktura daje się sprawdzić wzrokiem. Preprocesor (`pakowanie/warianty.py`) odrzuca
niedomknięty `@@IF`, `@@ELSE`/`@@ENDIF` bez `@@IF`, podwójny `@@ELSE` i nieznany wariant,
a po złożeniu kontroluje bilans `<style>`/`<script>` i to, że żadna dyrektywa nie została
w wyniku.

W źródle jest **10 takich bloków**: pozycja „Klucze API" w menu ustawień, klucze i18n PL i EN,
komunikat „brak klucza" (PL i EN), deklaracje `API_KEY`, `OPENAI_API_KEY`/`ELEVEN_API_KEY`,
`OWNER_MODE` oraz modal kluczy wraz z jego skryptem.

---

## Struktura

```
contentai/
  app/
    contentai.html     ŹRÓDŁO PRAWDY — jeden plik z dyrektywami wariantów
    worker.js          Cloudflare Worker dla wariantu proxy
    pwa/               manifest.json + ikony
  showcase/          landing page produktu (osobna strona, nie część aplikacji)
  pakowanie/         opakowania instalacyjne
    warianty.py        preprocesor: źródło -> wybrany wariant
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

`zbuduj_web.py` buduje wariant prosto z `app/contentai.html` — nie trzeba nic generować wcześniej.

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

### 1. Skrypty w `narzedzia/` są dokumentacją, nie narzędziem

`rebuild_all.py` i `apply_faza.py` generowały warianty z plików `ContentAI.html`
i `ContentAI_owner.html`. **Tych plików nie było w przekazanych paczkach** — skrypty
odwołują się do nieistniejących ścieżek `/home/claude/...` i nie da się ich uruchomić.

Zastąpił je `pakowanie/warianty.py`, który buduje warianty z `app/contentai.html`.
Skrypty zostają jako zapis tego, co i gdzie zostało zmienione w F1–F17 i w reskinie
(kotwice, konkretne stringi) — przydatne przy analizie, skąd wziął się dany fragment kodu.

Jedno źródło powstało przez złożenie trzech wariantów z powrotem w komplet, z weryfikacją
przez porównanie bajtowe: warianty `owner` i `proxy` odtwarzają się **co do bajtu**, a `keys`
różni się jedną linią komentarza. Ta różnica jest zamierzona — `keys` z paczki miał starszą
wersję komentarza niż ta, którą generuje bieżący `apply_faza.py`, więc ujednolicono do wersji
zgodnej z narzędziem.

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
