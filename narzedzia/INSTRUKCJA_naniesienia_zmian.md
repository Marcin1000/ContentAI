# Content AI - zmiany F1-F17 i reskin: co to jest i jak tego pilnować

Ten dokument opisuje zmiany, które kiedyś nanoszono na aplikację skryptami. **Dziś wszystkie
są już wtopione w `app/contentai.src.html`** — nie ma ich czym „nanosić", są częścią kodu.

Dokument służy teraz do dwóch rzeczy:
1. wyjaśnia, co każda zmiana robi i gdzie jej szukać, gdy trzeba coś zmodyfikować;
2. opisuje, jak sprawdzić, że żadna z nich nie wypadła ze źródła (`sprawdz_zrodlo.py`).

---

## Jak dziś wprowadza się zmianę

Nie ma etapu „patchowania". Edytujesz `app/contentai.src.html` bezpośrednio, a warianty
keys/proxy/owner powstają z niego przy budowaniu:

```bash
cd pakowanie
python3 warianty.py --wszystkie -o ../app   # przebuduj warianty w app/
python3 zbuduj_web.py                # payload web/ dla opakowań
```

Jeśli zmiana ma dotyczyć tylko części wariantów, otocz ją dyrektywą — komentarz HTML
w treści strony, komentarz JS wewnątrz `<script>`:

```html
<!--@@IF keys-->        //@@IF owner,proxy
  ...tylko keys           ...owner i proxy
<!--@@ELSE-->           //@@ELSE
<!--@@ENDIF-->          //@@ENDIF
```

Pełny opis dyrektyw: `../README.md`, sekcja „Dyrektywy warunkowe".

---

## Kontrola po zmianie

```bash
cd narzedzia
python3 sprawdz_zrodlo.py            # buduje 3 warianty i sprawdza każdą poprawkę
python3 sprawdz_zrodlo.py --cicho    # tylko podsumowanie (do CI)
```

Skrypt zna sygnaturę każdej zmiany z tabel poniżej: fragment, który **musi** wystąpić po
poprawce, i często fragment sprzed poprawki, który **nie może** wrócić. Dzięki temu wychodzi
zarówno wycięcie zmiany, jak i cofnięcie jej do stanu pierwotnego. Kod wyjścia 1 przy
jakiejkolwiek niezgodności.

Kontrole mają prefiksy — po nich widać, czego dotyczy zgłoszenie:

| Prefiks | Czego pilnuje |
|---|---|
| `F1`–`F17` | poprawki bazowe (tabela niżej) |
| `R/*` | warstwa reskinu |
| `W/*` | różnice między wariantami; `W/blokada*` — że nie wróci blokada urządzenia |
| `D/*` | każda deklaracja klucza występuje **dokładnie raz** (potrójna = martwe UI) |
| `S/*` | pliki `app/web-*.html` zgadzają się ze źródłem |
| `B/*` | baza wiedzy na serwerze |
| `O/*` | brama OpenSEO i synchronizacja motywu |
| `I/*` | okno fraz z OpenSEO w formularzu |
| `Z/*` | zero zależności od obcych serwerów (biblioteki i krój z własnego hosta) |
| `A/*` | dostępność — atrybut `lang` idzie za językiem interfejsu |

Poza tym warto przejść ręcznie:

- aplikacja wstaje w ciemnym motywie, splash pokazuje się raz na sesję
- panele SEO / AIO / AEO / GEO otwierają się w tym samym miejscu
- uzupełnianie luk nie przewija na dół artykułu
- przeróbki, auto-poprawka i sekcja wniosków wychodzą w języku treści
- analiza SERP zwraca dane i pokazuje przycisk SERP

---

## Poprawki bazowe F1-F17

| Kod | Co robi | Gdzie szukać w źródle |
|-----|---------|-----------------------|
| F1 | Render historii przez `_t()` zamiast sztywnego polskiego tekstu | `${history.length ? _t('history-no-filter') : _t('history-empty')}` |
| F2 | Klucz i18n `history-no-filter` w słowniku PL i EN | obok `history-empty` |
| F3 | Wykrycie języka przeglądarki przy pierwszym uruchomieniu | `var currentLang = localStorage.getItem('cai_lang')` |
| F4 | Panel Klucze API: pozycja w menu, klucze z `localStorage`, modal z i18n, komunikat „brak klucza" | tylko wariant `keys`; `openKeysModal`, `id="keys-modal"` |
| F5 | Nazwa sekcji „Kluczowe wnioski" w języku artykułu | `const kwName = ({ 'Polish':'Kluczowe wnioski'` |
| F6 | Prompt SERP: język **poza** schematem JSON — naprawia parsowanie i przywraca przycisk SERP | `_serpLang`, `fetchSerpContext` |
| F7 | Spinner pokazuje pierwszy krok natychmiast; zaszyty polski komunikat premium → `_t()` | `_tickStep`, `msg-spin-premium-eval` |
| F8 | Przeróbki w języku treści zamiast „Napisz po polsku" | `_rpLang`, `runRepurpose` |
| F9 | Auto-poprawka SEO/AIO trzyma język; usunięty mylący prefiks „Premium:" | `improvePrompt`, `LANGUAGE: Write the improved article` |
| F10 | Usunięta reguła CSS psująca panele oceny | brak `.seo-panel, .aio-panel { position: relative; }` |
| F11 | Uzupełnianie luk: status tylko na górze, bez skoku na dół artykułu | komentarz „status generowania sekcji tylko na gorze" |
| F12 | Dropdown przeróbek nad sidebarem (`z-index` 200 → 9000) i otwierany w prawo | `.repurpose-menu`, `left:0;right:auto` |
| F13 | Panel Luk semantycznych scrolluje przy długiej liście | `max-height:65vh;overflow-y:auto` |
| F14 | Przycisk generacji sekcji: kręcące się kółko zamiast klepsydry, kółko i tekst w `inline-flex` | `progress-spinner` |
| F16 | Eksport PDF: meta-box wyciągany z klonu i doklejany na samym końcu | `_runPdf`, `_mbClone` |
| F17 | Empty state jako wyśrodkowany SVG zamiast znaku U+2726 (znak siedzi krzywo w glyphie na fontach mobilnych) | `<div class="placeholder-box"><svg` |

**Dlaczego nie ma F15.** Meta-box w eksporcie DOCX ma wymuszone jasne tło (`.meta-box { background:#FFF8CC }`
w osobnym stylu eksportu, niezależnym od ciemnego motywu aplikacji), więc render DOCX był poprawny
bez osobnej poprawki.

---

## Warstwa reskinu

| Element | Co robi | Gdzie szukać |
|---------|---------|--------------|
| Splash | Ciemne tło `#07080D` na stałe (nie `var(--bg)`, bo w jasnym motywie robiło się białe), cząsteczki na cały ekran, logo i pasek, raz na sesję (`sessionStorage`), pomijalny tapnięciem, pomijany przy reduced-motion | `id="cin-splash"`, `id="cin-splash-css"` |
| Faza 1 | Przejścia zakładek i wejście pól formularza, bez migania przy powrocie z Grafiki/Audio | `<style id="cin-reskin">`, `switchTab` |
| Faza 2 | Odliczanie wyniku SEO/AIO/AEO/GEO od zera, pasek postępu treści i grafiki, pop nowego słowa kluczowego, wejścia widoków | `cin-progress`, `#img-spinner` |
| Pozycja paneli | SEO/AIO/AEO/GEO w tym samym miejscu, tylko poza mobile | `body:not(.is-mobile)` |
| Mobile | Pusty stan i spinner wyśrodkowane w pionie, scroll do miejsca generacji po kliknięciu Generuj | `min-height:52vh` |

Uwaga historyczna: splash wstawiano **po** `</head>` i realnym `<body>`, bo w `<head>` jest
komentarz CSS zawierający tekst `<body>`. Dziś nie ma to znaczenia (splash jest już w źródle),
ale ta pułapka wraca przy każdym skrypcie, który wstrzykuje coś „po `<body>`".

---

## Różnice między wariantami

Warianty różnią się w 22 miejscach, wszystkie oznaczone dyrektywami w źródle.

**Sposób podawania kluczy** — dziesięć pierwotnych bloków:

- pozycja „Klucze API" w menu ustawień — tylko `keys`
- klucze i18n panelu, słownik PL i EN — tylko `keys`
- komunikat „brak klucza" (PL i EN) — `keys` kieruje do panelu, `owner`/`proxy` do edycji pliku
- deklaracja `API_KEY` — `keys` z `localStorage`, `owner` z placeholderem, `proxy` puste + adresy workera
- deklaracje `OPENAI_API_KEY` i `ELEVEN_API_KEY` — jak wyżej
- `OWNER_MODE` — `true` tylko w `owner`
- modal Kluczy API wraz ze skryptem — tylko `keys`

**Funkcje wymagające własnego serwera** — wyłącznie `@@IF proxy`, bo bez serwera nie mają
z czym rozmawiać:

- pozycja „Baza wiedzy" w menu i okno bazy (prywatna + wspólna, na serwerze)
- wstrzyknięcie wiedzy z serwera do promptu zamiast wklejania całych dokumentów
- pozycja „OpenSEO" w menu i otwieranie panelu
- synchronizacja jasny/ciemny do OpenSEO przez ciasteczko `cai_motyw`
- przycisk 📈 przy polu słów kluczowych i okno fraz z OpenSEO
- klucze i18n tych trzech funkcji, słownik PL i EN

---

## Co zniknęło z tego katalogu i gdzie tego szukać

Były tu dwa skrypty: `rebuild_all.py` (nanosił F1-F17 i budował trzy warianty)
i `apply_faza.py` (nanosił reskin). Usunięto je, bo:

- ich zadanie jest wykonane — wszystkie zmiany są w źródle;
- nie dało się ich uruchomić: odwoływały się do ścieżek `/home/claude/...` i do czytelnych
  plików DEV (`ContentAI.html`, `ContentAI_owner.html`), których nie było w przekazanych paczkach;
- budowanie wariantów przejął `pakowanie/warianty.py`, który działa na jednym źródle.

Oba pliki zostają w historii gita — w pierwszym commicie tego repozytorium:

```bash
git show e281ec2:narzedzia/rebuild_all.py
git show e281ec2:narzedzia/apply_faza.py
```

Zawierają dokładne pary „string przed → string po" dla każdej poprawki, przydatne przy
analizie, skąd wziął się dany fragment kodu.

**Jedna rzecz nie ma dziś odpowiednika:** `apply_faza.py` miał przełącznik `SPLASH='dhl'`,
który przemalowywał splash i reskin na branding DHL (żółte tło `#FFCC00`, logo DHL `#D40511`,
czerwony pasek ładowania, bez cząsteczek). W repo jest wyłącznie wersja odbrandowana.
Gdyby wariant brandowany był znów potrzebny, trzeba go świadomie odtworzyć — to decyzja
o umieszczeniu cudzego znaku towarowego w repozytorium, nie zwykła zmiana techniczna.
