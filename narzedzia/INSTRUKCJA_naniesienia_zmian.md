# Content AI - instrukcja naniesienia dzisiejszych zmian (odbrand i DHL)

Ten pakiet pozwala nanieść wszystkie zmiany z dzisiejszej sesji na dowolną kopię aplikacji
Content AI, w wersji odbrandowanej i z brandingiem DHL. Zawiera dwa skrypty, które są dokładnym,
przetestowanym zapisem zmian (mają wpisane konkretne stringi do podmiany).

Proces jest dwuetapowy:
1. Poprawki bazowe (F1-F11) - `rebuild_all.py`
2. Warstwa kinowa (reskin: Faza 1+2+3 + splash + mobile) - `apply_faza.py`

Kolejność jest istotna: najpierw poprawki, potem reskin.


## Jak uruchomić

### Etap 1 - poprawki bazowe (`rebuild_all.py`)
Skrypt sam obsługuje obie wersje (DHL i odbrand) i sam wykrywa różnice brandingowe.
Na górze pliku, w słowniku `KITS`, ustaw ścieżki do swoich plików źródłowych:
- `dev` - czytelny wariant DEV (np. ContentAI.html albo DHL_ContentAI.html)
- `owner` - wariant z kluczem w pliku
- `out` - katalog docelowy na warianty
- `btn` - kolor przycisku panelu Klucze API (`var(--accent,#d97706)` dla odbrand, `var(--red)` dla DHL)

Uruchom: `python3 rebuild_all.py`
Efekt: pliki `web-keys.html`, `web-proxy.html`, `web-owner.html` z naniesionymi F1-F11.

### Etap 2 - reskin (`apply_faza.py`)
Na górze ustaw:
- `SRC` - wariant keys z etapu 1 (np. .../zrodlo/web-keys.html)
- `OUT` - plik wynikowy (np. ContentAI_faza2.html)

Uruchom: `python3 apply_faza.py`
Efekt: gotowa reskinowana aplikacja (splash, animacje, poprawki mobile).


## Co dokładnie zmieniają skrypty

### Etap 1 - poprawki bazowe (funkcje w `rebuild_all.py`)

| Kod | Co robi | Gdzie / kotwica |
|-----|---------|-----------------|
| F1 | Render historii używa `_t()` zamiast sztywnego PL | `${history.length ? 'Brak wyników...' : 'Brak historii...'}` |
| F2 | Dodaje klucz i18n `history-no-filter` (PL i EN) | słowniki i18n, po `history-empty` |
| F3 | Wykrywa język przegladarki przy 1. uruchomieniu | `var currentLang = localStorage.getItem(...) || 'pl'` |
| F4 | Panel Klucze API (wariant keys): pozycja w menu, klucze z localStorage, modal z i18n, komunikat nokey | tylko wariant DEV z placeholderami `WSTAW_TUTAJ...` |
| F5 | Nazwa sekcji Kluczowe wnioski w języku artykułu | glowny prompt, `"Kluczowe wnioski" (or its equivalent...)` |
| F6 | Prompt SERP: jezyk POZA schematem JSON (naprawia parsowanie, przywraca przycisk SERP) | `fetchSerpContext`, `in the same language as keyword` |
| F7 | Spinner: natychmiastowy pierwszy krok (usuwa stary komunikat Premium) + zaszyty PL komunikat premium -> `_t()` | `const activeSteps = buildSteps(...)` + `'Premium: oceniam i poprawiam...'` |
| F8 | Przerobki (repurpose) w jezyku tresci zamiast Napisz po polsku | `runRepurpose`, 5 promptow + system prompt |
| F9 | Auto-poprawka SEO/AIO: jezyk w improvePrompt + usuniecie mylacego prefiksu Premium | `improvePrompt` + `'Premium: ' + (currentLang...)` |
| F10 | Usuwa regule CSS psujaca panele (tylko odbrand; DHL jej nie ma) | `.seo-panel, .aio-panel { position: relative; }` (warunkowo) |
| F11 | Uzupelnianie luk: status tylko na gorze, bez skoku na dol | `art.appendChild(_genInd);` + `_genInd.scrollIntoView(...)` |
| F12 | Dropdown Przerobek: z-index nad sidebar (200 -> 9000) + otwieranie w prawo (`left:0;right:auto`) | CSS `.repurpose-menu { ... z-index:200 }` |
| F13 | Panel Luk semantycznych: scroll przy dlugiej liscie (`max-height:65vh;overflow-y:auto`) | `id="gap-panel" style="...margin:0 0 0"` |
| F14 | Przycisk generacji sekcji: krecace sie kolko (`progress-spinner`) zamiast klepsydry. Kolko + tekst w wewnetrznym wrapperze `inline-flex; align-items:center; gap:8px` (pionowe wyrownanie i rowny odstep, niezaleznie od renderu `<button>`) | `if (btn) { btn.disabled = true; btn.textContent = _t('msg-spin-sections'); }` |
| F16 | Eksport PDF: jawne wyciagniecie meta-box z klonu i doklejenie na samym koncu (gwarancja pozycji) | `function _runPdf() { const articleContent = buildContent(art.innerHTML); }` |
| F17 | Empty state: gwiazdka jako wysrodkowany SVG zamiast znaku Unicode U+2726 (znak nie jest optycznie wysrodkowany w glyphie na fontach mobilnych) | `<div class="placeholder-box">✦</div>` |

Uwaga do docx: meta-box w eksporcie docx ma juz wymuszone jasne tlo (`.meta-box { background:#FFF8CC }`
w osobnym stylu eksportu, niezalezne od trybu dark aplikacji), wiec render docx jest poprawny bez
osobnego fixu (dlatego nie ma F15 w kodzie zrodlowym).

### Etap 2 - reskin (`apply_faza.py`, append-only + splash)

- Splash (Faza 3): ciemny `#07080D` na stale (nie `var(--bg)`, bo w light-mode robi sie jasny),
  czasteczki 2D na caly ekran, logo + pasek, raz na sesje (sessionStorage), pomijalny tapnieciem,
  reduced-motion pomija. Wstawiany PO `</head>` i realnym `<body>` (uwaga: w `<head>` jest
  komentarz CSS z tekstem `<body>` - nie trafiac w niego, stad szukanie po `</head>`).
- Faza 1: przejscia zakladek + wejscie pol formularza (sterowane JS, bez migania przy powrocie
  z Grafiki/Audio - guard `MODULE`, opakowane `switchTab` i `switchMobileTab`).
- Faza 2: odliczanie wyniku SEO/AIO/AEO/GEO (0 -> wynik), pasek postepu generowania tresci,
  pasek postepu generowania grafiki (obserwacja `#img-spinner`, ta sama mechanika co dla tresci:
  wypelnianie 0 -> 92% podczas generacji, 100% i reset po zakonczeniu), pop nowego slowa
  kluczowego, wejscia widokow, wejscie paneli Grafika/Audio, press przyciskow.
- Pozycja paneli oceny (CSS): SEO/AIO/AEO/GEO w tym samym miejscu (`right:20px;top:60px;width:290px`,
  scoped do `body:not(.is-mobile)`).
- Mobile: pusty stan i spinner wysrodkowane w pionie (`min-height:52vh`), immersyjny scroll do
  miejsca generacji po kliknieciu Generuj.


## Roznice DHL vs odbrand (skrypty obsluguja to automatycznie)

- Klucz localStorage jezyka: `dhl_ai_lang` (DHL) vs `cai_lang` (odbrand). F3 obsluguje oba.
- Kolor we wskazniku luk: `var(--red)` (DHL) vs `var(--accent)` (odbrand). F11 jest niezalezny
  od koloru (usuwa tylko append + scroll).
- Bug CSS z F10 wystepuje tylko w odbrand. Skrypt usuwa go warunkowo (w DHL nic nie robi).
- Reskin uzywa `var(--accent)`, ktory rozwiazuje sie zaleznie od motywu - dziala w obu.


## Branding splasha (przelacznik `SPLASH` w apply_faza.py)

Na gorze `apply_faza.py` jest przelacznik `SPLASH`:
- `SPLASH='odbrand'` - splash z czasteczkami bursztyn+cyan na ciemnym tle (#07080D), wordmark CONTENTAI.
- `SPLASH='dhl'` - splash tradycyjny: zolte tlo DHL (#FFCC00), oficjalne SVG logo DHL (czerwone #D40511),
  wordmark "Content AI" 1:1 z topbarem aplikacji (font DM Sans, Content waga 500, AI waga 700, kolor #D40511),
  pasek ladowania czerwony, bez czastek. Ta sama mechanika: raz na sesje (sessionStorage), fade out,
  pomijalny tapnieciem, reduced-motion pomija.

Dla `SPLASH='dhl'` skrypt dodatkowo przekolorowuje reskin na branding DHL (pasek postepu tresci i grafiki
oraz focus): gradient bursztyn+cyan -> `#D40511`+`#FFCC00`, poswiata spinnera -> `rgba(212,5,17,.35)`,
`var(--accent)` -> `#D40511`. Font DM Sans jest juz ladowany w `<head>` aplikacji DHL, wiec wordmark
dziedziczy dokladny krój bez dodatkowego importu.


## Weryfikacja po naniesieniu (szybka checklista)

- Aplikacja wstaje normalnie (ciemny motyw), splash na start (raz na sesje).
- Bilans tagow: `<style>` == `</style>` oraz `<script>` == `</script>` (gdyby sie rozjechalo,
  to znak zlego wstrzykniecia - patrz uwaga o komentarzu `<body>` w `<head>`).
- Panele SEO/AIO/AEO/GEO otwieraja sie w tym samym miejscu.
- Uzupelnianie luk nie rzuca na dol artykulu.
- Przerobki, auto-poprawka i sekcja wnioskow wychodza w jezyku tresci.
- Analiza SERP zwraca dane i pokazuje przycisk SERP.
