# Zespoły agentów - agencja i zespół IT

Content AI jest przeglądany i poprawiany przez dwa zespoły agentów Claude Code, tak samo jak
Cosmos. Role są zdefiniowane w `.claude/agents/` (jeden plik to jedna rola), a ten dokument
jest ich wspólnym protokołem: jak pracują, jak się porozumiewają i jak przeżywają limit
sesji, który potrafi przerwać pracę w pół zdania.

| Zespół | Role (`.claude/agents/`) | Do czego |
|---|---|---|
| **Agencja** | `agencja-marka`, `agencja-ux`, `agencja-frontend`, `agencja-strona-projekt`, `agencja-strona-frontend`, `agencja-copywriter`, `agencja-wykonawca` | identyfikacja i system projektowy, wygląd i działanie aplikacji, strona produktowa, teksty |
| **Zespół IT** | `it-atrapa`, `it-kod`, `it-bezpieczenstwo`, `it-plynnosc` | atrapa dostawców AI do testów, jakość kodu, bezpieczeństwo, płynność na komputerze i telefonie |

Role przeglądowe **nie zmieniają repozytorium** - opisują poprawki. Wdraża koordynator
(główna sesja) albo `agencja-wykonawca` z jawnie przydzielonymi plikami.

## Katalog roboczy i tablica

Koordynator zakłada katalog zespołu (w sesji w chmurze - w scratchpadzie) i podaje go każdej
roli w pierwszej wiadomości jako `AG`.

- `AG/tablica.md` - wspólna tablica. Tylko dopisujemy (`cat >> … <<'EOF'`), nigdy nie
  nadpisujemy. Wpis: `## [ROLA → ROLA|WSZYSCY] [krytyczny/wysoki/średni/niski] tytuł` +
  dowód (skrypt, plik:linia, wynik) + propozycja. Odpowiedź: `## [ADRESAT → NADAWCA] PRZYJĘTE: …`.
  Pytanie: `## [ROLA → ROLA] PYTANIE: …`.
- `AG/<rola>/` - skrypty, notatki i dane roli.
- `AG/<rola>/DZIENNIK.md` - stan pracy roli (patrz niżej).
- `AG/ZESPOL.md` - rejestr koordynatora: rola, identyfikator agenta, stan.
- `AG/zrzuty/` - wspólne zrzuty ekranu (`rola-widok-motyw-szerokość.png`).
- `AG/narzedzia/` - wspólne narzędzia koordynatora (patrz niżej). Nie zmieniasz ich.

Współpraca: tablicę czytasz na starcie i co ~15 minut; sprawa z cudzego obszaru to wpis
„→ ROLA", a nie diagnoza w cudzym kodzie; przed wpisem sprawdzasz, czy go już nie ma;
skrypty pożyczasz od innych ról zamiast pisać własne.

## Przetrwanie limitu (obowiązkowe)

Limit sesji przerywa agenta bez ostrzeżenia. Praca ma to przeżyć:

1. **Dziennik po każdym kroku.** `AG/<rola>/DZIENNIK.md` nadpisujesz w całości po każdym
   zakończonym sprawdzeniu (co ~5-10 wywołań narzędzi). Sekcje:
   - `STAN:` pracuje / SKOŃCZONE,
   - `ZROBIONE:` co sprawdzone, z wynikiem jednym zdaniem,
   - `USTALENIA:` priorytet, dowód (ścieżka skryptu), propozycja poprawki - zalążek raportu,
   - `DALEJ:` kolejne kroki w kolejności; pierwszy = od czego zaczniesz po wznowieniu,
   - `PROCESY:` PID, port i polecenie startu wszystkiego, co masz uruchomione.
2. **Ustalenia na tablicę od razu**, nie na końcu. Raport, którego nikt nie zdążył napisać,
   nie istnieje.
3. **Po wznowieniu** czytasz swój dziennik i tablicę, sprawdzasz procesy (`kill -0 PID`),
   stawiasz brakujące i kontynuujesz od `DALEJ`. Nie powtarzasz `ZROBIONE`.
4. **Oszczędzasz limit**: najpierw sprawdzenia o najwyższym ryzyku; krótkie wyjścia
   (`| head -40`, `grep`, `tail -20`); pliki fragmentami (`app/contentai.src.html` ma
   ponad 13 tys. linii - nigdy w całości); bez wypisywania całych logów i JSON-ów.
5. **Koniec**: `STAN: SKOŃCZONE` w dzienniku i raport końcowy jako ostatnia wiadomość.

### Po stronie koordynatora

- Każdą rolę powołuje z jej plikiem z `.claude/agents/`, katalogiem `AG` i portem; zapisuje
  identyfikator w `AG/ZESPOL.md`.
- **Strażnik**: przed wypuszczeniem zespołu zakłada zadanie cykliczne budzące sesję
  koordynatora, które wznawia role, które padły na limicie (`SendMessage`: „Limit się
  odnowił - kontynuuj od DALEJ w swoim DZIENNIK.md"). Gdy wznowienie się nie uda, nowy agent
  tej roli zaczyna od dziennika.
- Gdy wszystkie role skończą: scalenie tablicy i raportów w jedną listę, wdrożenie, pełna
  bateria kontroli z CI, `main` tylko po zielonym CI, raport dla Marcina.

## Twarde zasady dla ról przeglądowych

- Nie zmieniasz plików w repozytorium (żadnych edycji, commitów, `git checkout`/`stash`).
  Także `app/web-*.html` - przebudowa wariantów to zmiana repozytorium.
- Zabijasz tylko własne procesy (`kill <pid>`); nigdy `pkill -f` ani `fuser -k` (`pkill -f`
  z wzorcem pasującym do polecenia zabija własną powłokę).
- Wspólną atrapę dostawców (port 9199) stawia koordynator i jej nie zabijasz.
- Playwright: `NODE_PATH=AG/node_modules`, Chromium z `/opt/pw-browsers/chromium`,
  `waitUntil: 'load'` (nigdy `networkidle`), `serviceWorkers: 'block'`.
- Szczegóły zewnętrznych API (Anthropic, OpenAI, ElevenLabs, NVIDIA, Cloudflare) oznaczasz:
  pewne (dokumentacja, kod) czy z pamięci.
- Wszystko po polsku.

## Zasady projektu, których pilnuje CI

Każda propozycja musi się z nimi zgadzać - inaczej nie przejdzie:

- Aplikacja to **jeden plik źródłowy** `app/contentai.src.html`; warianty `keys`, `proxy`,
  `owner` powstają z niego przez `cd pakowanie && python3 warianty.py --wszystkie -o ../app`
  (dyrektywy `@@IF`/`@@ELSE`/`@@ENDIF`, bez zagnieżdżania).
- Serwer (`serwer/`) to Node bez zależności npm. Aplikacja nie pobiera niczego z obcych
  serwerów (biblioteki i fonty z własnego hosta, kontrole `Z/*`).
- Każdy tekst interfejsu ma wpis w obu słownikach (PL i EN); `audyt_i18n.py` to sprawdza.
- Każdy `onclick`/`onchange` musi wskazywać istniejącą funkcję (`audyt_uchwyty.py`).
- Bez długich myślników (znak U+2014) w interfejsie, na stronie i w dokumentacji (`audyt_myslniki.py`).
- Bez prawdziwych kluczy API w repozytorium, wyłącznie `WSTAW_TUTAJ_*`.
- Bez marki klienta (DHL i in.) w materiałach publicznych.
- Poprawki pilnuje `narzedzia/sprawdz_zrodlo.py` (podpis kodu po poprawce i przed nią).

Pełna bateria: `.github/workflows/kontrola.yml`.

## Wspólne narzędzia (`AG/narzedzia/`)

| Plik | Do czego |
|---|---|
| `serwer.sh <rola> <port>` | serwer Content AI z kontami testowymi w `AG/<rola>/dane`, dostawcy przekierowani na atrapę; wypisuje PID |
| `konta.js <katalog>` | konta testowe: `admin` (admin, premium), `premium`, `standard`, `darmowy`; hasło `test-haslo-123` |
| `zaloguj.js` | `zaloguj(kontekst, 'http://127.0.0.1:<port>', 'admin')` - logowanie w Playwright |
| `atrapa-dostawcow.js` | atrapa API Anthropic / OpenAI / ElevenLabs na porcie 9199 (stawia koordynator) |

Serwer pod `http://127.0.0.1:<port>/` podaje aplikację (wariant `proxy`) po zalogowaniu.
Wariant `keys` otwierasz jako plik (`file:///home/user/contentai/app/web-keys.html`) - wtedy
wywołania idą wprost do `api.anthropic.com` i trzeba je przechwycić w Playwright
(`page.route`) albo wpisać klucz atrapy.

Strona produktowa: `cd /home/user/contentai/showcase && python3 -m http.server <port> --bind 127.0.0.1`.

## Porty

| Rola | Serwery | Własne atrapy |
|---|---|---|
| agencja-marka / ux / frontend | 3613 / 3611 / 3612 (+10, +20 na warianty) | - |
| agencja-strona-projekt / strona-frontend / copywriter | 3621 / 3622 / 3623 | - |
| agencja-wykonawca | 3721-3729 (podaje koordynator) | - |
| it-atrapa / kod / bezpieczenstwo / plynnosc | 3811 / 3812 / 3813 / 3815 | 7810-7819 / 7820-7829 / 7830-7839 / 7850-7859 |
| wspólna atrapa dostawców | 9199 | - |

## Raport końcowy (ostatnia wiadomość roli)

Ustalenia wg priorytetu: `[priorytet] tytuł - dowód - konkretna poprawka (zarys kodu,
plik:linia)`. Osobno **POTWIERDZONE** (odtworzone) i **PODEJRZENIA**. Na końcu krótko:
co sprawdzone i działa. Przed końcem zabijasz swoje procesy.

## Kontekst produkcji (dla obu zespołów)

VPS, `/srv/contentai`, systemd `contentai.service` (port 3100 na 127.0.0.1), Caddy:
`content-ai.net` - strona produktowa (pliki z `showcase/`), `app.content-ai.net` - aplikacja
(wariant `proxy` za logowaniem serwera). Serwer trzyma `app/web-proxy.html` w pamięci od
startu, więc po `git pull` potrzebny jest restart. Konta, plany i dane w `serwer/dane/`
(poza repozytorium). Aktualizacja: `cd /srv/contentai && sudo git pull && sudo systemctl restart contentai`.
