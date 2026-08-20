# Content AI

Generator treści pod SEO, AIO, AEO i GEO — artykuły, grafiki i audio z jednego okna.
Aplikacja jednoplikowa (HTML + JS, bez budowania), pakowana do wersji instalowalnych
na Windows, macOS, Androida i iOS.

**Wersja:** 2.9.0 · **Status:** wdrożenie serwerowe z kontami, bazą wiedzy (RAG) i integracją z OpenSEO

> Aplikacja powstała wcześniej w repozytorium `Marcin1000/Bear` (obok Cosmosa) i została
> stąd wydzielona do własnego repo. Historia tamtych commitów jest zachowana.

---

## Jak uruchomić

**Na własnym komputerze** — otwórz w przeglądarce `app/web-keys.html`. Nic nie trzeba
budować ani instalować; panel „Klucze API" otworzy się sam.

**Na serwerze, dla zespołu** — to główna ścieżka. `serwer/` zawiera serwer Node (zero
zależności npm) z logowaniem, kontami i rolami, proxy do API, bazą wiedzy z wyszukiwaniem
po znaczeniu oraz bramą przed OpenSEO. Klucze nie trafiają do przeglądarek. Instrukcja
wdrożenia: **`serwer/README.md`**, obsługa kont: **`dokumenty/ContentAI_AdminGuide.md`**.

Pozostałe warianty: `app/web-proxy.html` (klucze po stronie serwera lub Cloudflare Workera),
`app/web-owner.html` (klucze wpisane w pliku).

### Co dokłada wdrożenie serwerowe

| | |
|---|---|
| **Konta i role** | logowanie loginem i hasłem, `admin` / `uzytkownik`; odebranie dostępu jednym poleceniem |
| **Klucze po stronie serwera** | nie trafiają do przeglądarki; użytkownik może podstawić własny |
| **Baza wiedzy (RAG)** | prywatna i wspólna, na serwerze; do promptu idą tylko fragmenty pasujące do tematu |
| **Modele open source** | `CAI_DOSTAWCA=nvidia` — serwer tłumaczy format, aplikacja nie wymaga zmian |
| **Realne dane SERP** | `CAI_SERP=dataforseo` albo `openseo` zamiast szacowania przez model |
| **OpenSEO za tym samym logowaniem** | brama: jedno konto, ta sama paleta, wymiana fraz w obie strony |
| **Zero obcych serwerów** | biblioteki i krój pisma hostowane razem z aplikacją |

---

## Jak to działa

Cała aplikacja to **jeden plik HTML** (~666 KB, ~10,5 tys. linii, 9 bloków `<script>`).
Nie ma bundlera ani kroku kompilacji — plik otwiera się bezpośrednio w przeglądarce
albo jest opakowywany w Electron / Capacitor.

Modele: `claude-sonnet-4-6` (treść), `claude-haiku-4-5` (zadania pomocnicze),
`gpt-image-1` (grafiki), `gpt-4o-mini-tts` i ElevenLabs (audio), `gpt-4o-transcribe`
(transkrypcja). Biblioteki do plików (mammoth, pdf.js, pdfmake, xlsx, html-docx-js) oraz krój
IBM Plex leżą **w repozytorium**, w `app/pwa/lib/` i `app/pwa/fonty/` — aplikacja nie pobiera
niczego z obcych serwerów.

### Jedno źródło, trzy warianty

Źródłem prawdy jest **`app/contentai.src.html`** — jeden plik, z którego budowane są trzy
warianty różniące się wyłącznie sposobem podawania kluczy API:

| Wariant | Klucze API | Do czego |
|---------|-----------|----------|
| `keys` | wpisywane w UI, `localStorage` | **domyślny** — pokazy, spotkania, bezpieczny do rozdania |
| `proxy` | po stronie serwera (albo Cloudflare Workera) | **wdrożenie zespołowe** — logowanie, baza wiedzy, OpenSEO |
| `owner` | wpisane w pliku | jedno zaufane urządzenie wewnętrzne |

Gotowe warianty **leżą w repo** i są od razu do otwarcia. Po każdej zmianie w źródle
trzeba je przebudować:

```bash
cd pakowanie
python3 warianty.py --wszystkie -o ../app     # przebuduj wszystkie trzy
```

Poprawkę nanosisz raz, w `app/contentai.src.html`. Że warianty w repo nie rozjechały się
ze źródłem, pilnuje `narzedzia/sprawdz_zrodlo.py`.

> **Nie otwieraj `contentai.src.html` w przeglądarce.** To źródło, w którym leżą obok siebie
> wszystkie trzy warianty — `API_KEY` jest w nim zadeklarowany trzy razy, przez co cały główny
> skrypt nie wykonuje się (martwe zakładki, motyw i przyciski). Plik pokaże w takiej sytuacji
> ostrzeżenie zamiast udawać działającą aplikację.

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

W źródle jest **22 takich bloków**. Dziesięć pierwotnych dotyczy sposobu podawania kluczy:
pozycja „Klucze API" w menu ustawień, klucze i18n PL i EN, komunikat „brak klucza" (PL i EN),
deklaracje `API_KEY`, `OPENAI_API_KEY`/`ELEVEN_API_KEY`, `OWNER_MODE` oraz modal kluczy
z jego skryptem. Pozostałe to funkcje, które mają sens wyłącznie przy własnym serwerze
(`@@IF proxy`): baza wiedzy, wejście do OpenSEO, synchronizacja motywu i okno fraz z OpenSEO.

---

## Struktura

```
contentai/
  app/
    contentai.src.html ŹRÓDŁO — jeden plik z dyrektywami; NIE otwierać w przeglądarce
    web-keys.html      gotowa aplikacja do otwarcia (wariant keys)
    web-proxy.html     gotowa aplikacja (wariant proxy)
    web-owner.html     gotowa aplikacja (wariant owner)
    worker.js          Cloudflare Worker dla wariantu proxy (alternatywa dla serwera)
    openseo-motyw.css  paleta Content AI doklejana do stron OpenSEO
    pwa/               manifest.json + ikony
  showcase/          landing page produktu (osobna strona, nie część aplikacji)
  pakowanie/         opakowania instalacyjne
    warianty.py        preprocesor: źródło -> wybrany wariant
    zbuduj_web.py      buduje payload web/ z wybranego wariantu
    electron/          Windows (.exe) i macOS (.dmg)
    capacitor/         Android (APK) i iOS (Xcode) + ikony natywne i splashe
  serwer/            serwer Node: logowanie, role, proxy, baza wiedzy (zero zależności npm)
    server.js          aplikacja serwerowa i router
    uzytkownicy.js     zarządzanie kontami z linii poleceń
    baza.js            baza wiedzy z wyszukiwaniem po znaczeniu (RAG)
    serp.js            dane SERP z DataForSEO
    openseo.js         brama przed OpenSEO: wspólne logowanie i paleta
    openseo-mcp.js     klient MCP — frazy i dane z OpenSEO
    testy.js           testy (uruchamiane w CI)
    contentai.service  jednostka systemd
  openseo/          wdrożenie OpenSEO obok Content AI + zależności między nimi
  .github/workflows/ CI: kontrola źródła, testy serwera, skan prawdziwych kluczy
  narzedzia/
    sprawdz_zrodlo.py  kontrola źródła: poprawki F1–F17, reskin, warianty, funkcje serwerowe
    INSTRUKCJA_...md   co robi każda z tych zmian i gdzie jej szukać
  dokumenty/         AdminGuide + dokumentacja v27 (PL/EN) + ocena vs konkurencja
  prezentacje/       PL/ i EN/ — deck produktowy, onboarding, security
```

Katalogi `web/` w `pakowanie/electron` i `pakowanie/capacitor` są **generowane**
przez `zbuduj_web.py` i celowo nie są wersjonowane (patrz `.gitignore`).

---

## Budowanie

`zbuduj_web.py` buduje wariant prosto z `app/contentai.src.html` — nie trzeba nic generować wcześniej.

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

### 1. Poprawki F1–F17 i reskin są wtopione w źródło

Nie ma etapu „patchowania" — te zmiany są częścią `app/contentai.src.html`. Pilnuje ich
`narzedzia/sprawdz_zrodlo.py`: buduje wszystkie trzy warianty i sprawdza, czy w każdym
widać ślad po każdej zmianie. Poza F1–F17 i reskinem kontroluje też, że każda deklaracja
klucza występuje dokładnie raz (`D/*`), że warianty w repo zgadzają się ze źródłem (`S/*`)
oraz że funkcje serwerowe są na miejscu: baza wiedzy (`B/*`), OpenSEO (`O/*`) i okno fraz
(`I/*`). Zna sygnaturę „po poprawce" i „sprzed poprawki", więc wyłapuje
zarówno wycięcie zmiany, jak i cofnięcie jej. Kod wyjścia 1 przy niezgodności, więc nadaje
się do CI.

```bash
cd narzedzia && python3 sprawdz_zrodlo.py --cicho
```

Poprzednie skrypty (`rebuild_all.py`, `apply_faza.py`) usunięto — nie dało się ich uruchomić
(ścieżki `/home/claude/...`, brak plików DEV), a ich zadanie jest wykonane. Zostają w historii
gita, szczegóły w `narzedzia/INSTRUKCJA_naniesienia_zmian.md`.

Jedno źródło powstało przez złożenie trzech wariantów z powrotem w komplet, z weryfikacją
przez porównanie bajtowe: warianty `owner` i `proxy` odtwarzają się **co do bajtu**, a `keys`
różni się jedną linią komentarza. Ta różnica jest zamierzona — `keys` z paczki miał starszą
wersję komentarza niż ta, którą generował bieżący `apply_faza.py`, więc ujednolicono do wersji
zgodnej z narzędziem.

### 2. Wariant brandowany nie ma odpowiednika

`apply_faza.py` miał przełącznik `SPLASH='dhl'`, przemalowujący splash i reskin na branding DHL.
W repo jest wyłącznie wersja odbrandowana. Odtworzenie wariantu brandowanego to świadoma decyzja
o umieszczeniu cudzego znaku towarowego w repozytorium, nie zwykła zmiana techniczna.

### 3. Zasoby natywne pochodzą ze starszej paczki

`ContentAI_komplet_reskin.zip` miał nowszy kod aplikacji, ale **zgubił** ikony natywne
i część instrukcji. Przy przenoszeniu odtworzono ze starszego `ContentAI_pakowanie.zip`:

- `capacitor/android-res/` — ikony launchera (legacy + round + adaptive) w 5 gęstościach
- `capacitor/ios-res/` — `AppIcon-1024.png`
- `capacitor/resources/` — `icon.png`, `splash.png`, `splash-dark.png`
- sekcję **„Krok 2b"** w `INSTRUKCJA_Android.md` — obejście dla Windows ARM, gdzie
  `npx @capacitor/assets` wywala się na kompilacji `sharp` (błąd MSB8020)

Ikony są odbrandowane (bursztynowa gwiazda na `#07080D`), zgodne z logo z showcase.

### 4. Aplikacja nie wysyła żądań poza wywołaniami API

Biblioteki i krój pisma są hostowane razem z aplikacją — poza wywołaniami do Anthropic,
OpenAI i ElevenLabs (albo do Twojego serwera, w wariancie proxy) nie leci nic. Dzięki temu
działa w zamkniętej sieci firmowej i nikt z zewnątrz nie może podmienić kodu, który się
w niej wykonuje.

Pełnego trybu offline nadal nie ma i mieć nie może — generowanie treści wymaga API modelu.
Nie ma też service workera: aplikacja to jeden plik aktualizowany przez `git pull` i restart
usługi, więc cache oznaczałby użytkowników pracujących na starej wersji.

Ścieżki do bibliotek są względne (`pwa/lib/…`), więc działają tak samo przy otwarciu pliku
z dysku, z serwera i w paczce natywnej. `zbuduj_web.py` kopiuje oba katalogi do payloadu.

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

Obecność każdej z tych zmian sprawdza `narzedzia/sprawdz_zrodlo.py`.

---

## Checklista weryfikacyjna po zmianach

Automatycznie — `cd narzedzia && python3 sprawdz_zrodlo.py` (buduje trzy warianty, sprawdza
obecność wszystkich poprawek oraz bilans `<style>`/`<script>`). Ręcznie:

- Aplikacja wstaje w ciemnym motywie, splash pokazuje się raz na sesję
- Panele SEO / AIO / AEO / GEO otwierają się w tym samym miejscu
- Uzupełnianie luk nie przewija na dół artykułu
- Przeróbki, auto-poprawka i sekcja wniosków wychodzą w języku treści
- Analiza SERP zwraca dane i pokazuje przycisk SERP
