# Content AI na serwerze, na którym działa już Cosmos

Wersja dla sytuacji, w której masz **jeden VPS z Cosmosem** i chcesz na nim postawić obok
Content AI. Obie aplikacje działają niezależnie - nie współdzielą kodu, danych ani logowania.
Dzielą tylko maszynę.

> **To jest dokument uzupełniający.** Pełny opis każdego kroku, z wyjaśnieniami i tabelą
> problemów, jest w **`dokumenty/ContentAI_Instalacja_na_serwerze.md`**. Tutaj jest tylko to,
> co wygląda inaczej, bo Cosmos już tam siedzi - plus lista pułapek, w które łatwo wdepnąć,
> gdy na jednym serwerze stoją dwie aplikacje.

Czas: 20-30 minut.

---

## 1. Co już masz i czego nie musisz robić

Stawiając Cosmosa, zrobiłeś już połowę roboty:

| Krok z pełnej instrukcji | Stan | Dlaczego |
|---|---|---|
| Serwer VPS z Ubuntu | ✅ gotowe | Ten sam |
| Node.js ≥ 22.13 | ⚠️ do sprawdzenia | Content AI potrzebuje 22.13 lub nowszej (wbudowana baza SQLite); sprawdź `node -v`, starszą zaktualizuj jak w kroku 3 pełnej instrukcji |
| Git | ✅ gotowe | Zainstalowany razem z Node |
| Caddy i HTTPS | ⚠️ zależy | Gotowe, jeśli Cosmos chodzi na domenie. Jeśli tylko na Tailscale - patrz krok 4 |
| Klucze API | ⚠️ do sprawdzenia | Możesz użyć tych samych, ale **nazwy zmiennych są inne** - patrz krok 5 |

Zostaje: pobranie kodu, konto usługi, konto admina, plik z kluczami, usługa systemd i adres.

---

## 2. Sprawdzenie przed startem

Zaloguj się na serwer i wykonaj trzy sprawdzenia.

**Miejsce na dysku** - Content AI zajmuje około 16 MB:

```bash
df -h /
```

**Pamięć** - Content AI to proces bez zależności, zjada kilkadziesiąt megabajtów:

```bash
free -h
```

Jeśli w kolumnie `available` masz powyżej 500 MB, jest z zapasem.

**Czy port 3100 jest wolny:**

```bash
ss -tlnp | grep -E ':(3000|3100)'
```

Powinieneś zobaczyć **tylko** wiersz z `:3000` (to Cosmos). Gdyby coś już siedziało na 3100,
w kroku 3 wpiszesz inny port, np. `3200`, i pamiętasz o tym w kroku 4.

---

## 3. Instalacja

Wszystko jako `root`. Objaśnienia każdego polecenia - w pełnej instrukcji.

```bash
# Kod - Cosmos siedzi w /opt/cosmos, Content AI kładziemy obok, w /srv/contentai
git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai

# SPRAWDŹ, czy kod się pobrał - zanim pójdziesz dalej
test -f /srv/contentai/serwer/uzytkownicy.js \
  && echo "OK - kod pobrany" \
  || echo "STOP - klonowanie się nie udało, nie wykonuj kolejnych poleceń"
```

> ### ⚠️ Nie pomijaj tego sprawdzenia
>
> Gdy klonowanie się nie uda - brak sieci, zapora, literówka w adresie - kolejne
> polecenie (`mkdir -p`) **i tak utworzy katalog** `serwer/dane`. Wygląda wtedy, jakby
> wszystko szło zgodnie z planem, a błąd zobaczysz dopiero trzy kroki dalej jako
> `Cannot find module '/srv/contentai/serwer/uzytkownicy.js'` - komunikat, który
> nie mówi nic o prawdziwej przyczynie.
>
> **Gdy zobaczysz `STOP`** - najpierw ustal, dlaczego klonowanie padło:
>
> ```bash
> git --version                       # czy git w ogóle jest
> curl -sI https://github.com | head -1   # czy serwer widzi GitHuba
> ```
>
> Potem wyczyść to, co zostało, i spróbuj ponownie. **Zajrzyj do katalogu przed
> skasowaniem** - usuwaj tylko wtedy, gdy nie ma tam nic poza pustym `serwer/dane`:
>
> ```bash
> ls -la /srv/contentai /srv/contentai/serwer 2>/dev/null
> rm -rf /srv/contentai
> git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai
> test -f /srv/contentai/serwer/uzytkownicy.js && echo "OK - kod pobrany"
> ```

```bash
# Własne konto systemowe usługi i katalog na dane
useradd --system --home-dir /srv/contentai --shell /usr/sbin/nologin contentai
mkdir -p /srv/contentai/serwer/dane
chown -R contentai:contentai /srv/contentai/serwer/dane

# Twoje konto administratora (zapyta o hasło dwa razy, minimum 10 znaków)
cd /srv/contentai
sudo -u contentai node serwer/uzytkownicy.js dodaj marcin admin

# Klucze i ustawienia - osobny plik, nie ten od Cosmosa
mkdir -p /etc/contentai
nano /etc/contentai/srodowisko
```

W edytorze wklej i podmień klucze na swoje:

```ini
PORT=3100
CAI_DOSTAWCA=anthropic
ANTHROPIC_KEY=sk-ant-api03-TWOJ-KLUCZ
OPENAI_KEY=sk-proj-TWOJ-KLUCZ
```

Zapisz (**Ctrl+O**, Enter, **Ctrl+X**) i zabezpiecz plik:

```bash
chmod 600 /etc/contentai/srodowisko
```

Uruchom jako usługę:

```bash
cp /srv/contentai/serwer/contentai.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now contentai
systemctl status contentai
```

Szukasz `Active: active (running)`. Wyjście z podglądu: **q**.

Sprawdź, że odpowiada - i że Cosmos dalej odpowiada:

```bash
curl -s -o /dev/null -w "Content AI: %{http_code}\n" http://127.0.0.1:3100/
curl -s -o /dev/null -w "Cosmos:     %{http_code}\n" http://127.0.0.1:3000/
```

Oba mają zwrócić `200`.

---

## 4. Adres - trzy sytuacje

### A. Cosmos już chodzi na domenie przez Caddy

Najprostszy przypadek. **Nie nadpisuj pliku Caddy - dopisz do niego.**

```bash
nano /etc/caddy/Caddyfile
```

Plik ma już wpis Cosmosa. **Nie ruszasz go** - dopisujesz bloki Content AI, a jeśli
były już wpisy `content-ai.net` / `app.content-ai.net` z wcześniejszej wersji tej
instrukcji, **zastępujesz** je nowymi.

Content AI to **dwa adresy**, nie jeden: strona produktowa (zwykłe pliki, żadnej aplikacji)
i sama aplikacja za logowaniem, plus przekierowanie `www`. Gotowe bloki są w repozytorium:
**`dokumenty/Caddyfile.content-ai`** (jedno źródło prawdy; ten sam blok jest w
`ContentAI_Domena_Cloudflare.md` i `serwer/README.md`).

Jak wkleić, żeby nie zepsuć Cosmosa:

1. Kopia: `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.kopia-$(date +%F)`.
2. **Blok globalny** (nawiasy `{ }` bez nazwy domeny) może być tylko jeden i musi stać
   na samej górze pliku. Jeśli Cosmos już go ma, dopisz do niego sekcje `log default { ... }`
   i `servers { ... }`; jeśli nie - wklej go jako pierwszy, nad wpisem Cosmosa. `trusted_proxies`
   i filtr dziennika dotyczą wtedy wszystkich adresów w pliku, także Cosmosa - to bezpieczne:
   Caddy przyjmie adres klienta z nagłówka wyłącznie od Cloudflare, a filtr tylko usuwa
   z wpisów nagłówki z kluczami (SEC8-01).
3. Bloki domen Content AI wklej **pod** wpisem Cosmosa.

Układ pliku po zmianie:

```
# ── blok globalny: jeden, na samej górze (z dokumenty/Caddyfile.content-ai) ──
{
    log default {
        ...filtr naglowkow z kluczami (SEC8-01)...
    }
    servers {
        trusted_proxies static ...adresy Cloudflare...
        client_ip_headers CF-Connecting-IP
    }
}

# ── Cosmos: to, co już masz ──────────────────────────────────────────────────
cosmos.twojadomena.pl {
    reverse_proxy 127.0.0.1:3000
}

# ── Content AI: www.content-ai.net, content-ai.net, app.content-ai.net ──────
#    (bloki z dokumenty/Caddyfile.content-ai, w całości)
```

Pełna treść do wklejenia (blok globalny + bloki Content AI):

```
{
    # Dziennik Caddy bez kluczy API uzytkownikow (SEC8-01). Przy bledzie 502 (restart Node)
    # Caddy zapisuje do journald cale zadanie z naglowkami; sam ukrywa tylko Cookie
    # i Authorization, a X-Api-Key, X-Openai-Key i X-Eleven-Key szlyby jawnym tekstem.
    # Filtr usuwa je ze wszystkich wpisow (bledy i dziennik dostepu kazdej domeny); Cookie
    # (zaszyfrowane klucze BYOK), Authorization i Set-Cookie tez, na wypadek log_credentials.
    # NIE dodawaj w blokach domen log { output file ... } bez tego samego filtra.
    log default {
        output stderr
        format filter {
            wrap json
            fields {
                request>headers>X-Api-Key delete
                request>headers>X-Openai-Key delete
                request>headers>X-Eleven-Key delete
                request>headers>Xi-Api-Key delete
                request>headers>Cookie delete
                request>headers>Authorization delete
                resp_headers>Set-Cookie delete
            }
        }
    }
    servers {
        # Adresy Cloudflare. Tylko z nich Caddy przyjmie adres klienta z naglowka;
        # od kazdego innego polaczenia {client_ip} to adres samego polaczenia.
        # Aplikacja (app., szara chmurka) idzie z pominieciem Cloudflare, wiec u niej
        # {client_ip} to zawsze prawdziwy adres. Aktualna lista: https://www.cloudflare.com/ips/
        trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
        # Cloudflare zawsze wysyla CF-Connecting-IP; X-Forwarded-For jako zapasowy jest zbedny.
        client_ip_headers CF-Connecting-IP
    }
}

# ── Strona produktowa: jeden adres kanoniczny ───────────────────────────────
# www przekierowuje na apex: strona ma canonical i hreflang na https://content-ai.net/,
# a formularz "Popros o dostep" wysyla z jednego pochodzenia (CAI_STRONA_ORIGIN).
www.content-ai.net {
    redir https://content-ai.net{uri} permanent
}

content-ai.net {
    encode zstd gzip
    root * /srv/contentai/showcase

    # Zrodla generatora strony (szablon.html, teksty.json, czesci/) nie sa strona.
    @zrodlo path /zrodlo /zrodlo/*
    respond @zrodlo 404

    # --- Pamiec podreczna ---
    # HTML: przegladarka zawsze pyta (ETag); krawedz Cloudflare trzyma 10 minut.
    # Podstrony to katalogi z index.html, wiec kazdy adres zakonczony ukosnikiem.
    @html path */ *.html
    header @html Cache-Control "public, max-age=0, must-revalidate"
    header @html CDN-Cache-Control "max-age=600"
    # CSS i JS maja w adresie ?v=<skrot tresci> (buduj_strone.py): nowa wersja = nowy adres.
    @zasoby path /zasoby/*
    header @zasoby Cache-Control "public, max-age=31536000, immutable"
    # Fonty maja nazwy bez wersji, wiec 30 dni, nie rok.
    @fonty path /fonty/*
    header @fonty Cache-Control "public, max-age=2592000"
    # Obrazy, ikony, manifest: dzien + tydzien stale-while-revalidate (og-*.png bez wersji w nazwie).
    @obrazy path /obrazy/* /favicon.ico /favicon.svg /site.webmanifest
    header @obrazy Cache-Control "public, max-age=86400, stale-while-revalidate=604800"
    @seo path /robots.txt /sitemap.xml
    header @seo Cache-Control "public, max-age=3600"

    # --- Bezpieczenstwo ---
    # Strona nie ma skryptow ani stylow inline i nie laduje nic z obcych serwerow.
    # connect-src: formularz wysyla POST na https://app.content-ai.net/api/prosba-o-dostep.
    header {
        Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://app.content-ai.net; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        Cross-Origin-Opener-Policy "same-origin"
        -Server
    }

    file_server
}

# ── Aplikacja ───────────────────────────────────────────────────────────────
# Logowanie i konta obsluguje sam Content AI - NIE dodawaj tu basic_auth.
# Naglowki bezpieczenstwa (CSP, X-Frame-Options, nosniff...) wysyla Node; tu tylko HSTS.
# Bez encode: Node sam pakuje HTML/JS/CSS (brotli albo gzip, wersje spakowane trzyma
# w pamieci). Jesli wolisz pakowanie w Caddy, dopisz encode zstd gzip i ustaw
# CAI_KOMPRESJA=0 w /etc/contentai/srodowisko.
app.content-ai.net {
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        -Server
    }
    reverse_proxy 127.0.0.1:3100 {
        # NADPISUJE naglowek od klienta. Bez tej linii X-Real-IP od klienta przechodzi
        # bez zmian i Node mu ufa (limit prob logowania do ominiecia), a bez naglowka
        # wszyscy uzytkownicy sa dla Node jednym adresem 127.0.0.1.
        header_up X-Real-IP {client_ip}
        # Restart przy wdrozeniu (ARCH8-25): przez 10 s Caddy ponawia polaczenie co 250 ms
        # zamiast od razu oddac 502; strony i odczyty przeczekuja start nowego procesu.
        lb_try_duration 10s
        lb_try_interval 250ms
    }
}

# ── Srodowisko testowe (M-9; tylko gdy wdrozone: contentai-test na 127.0.0.1:3101) ──
# Calosc za haslem Caddy poza webhookiem Stripe (ten podpisuje sie sam, HMAC). Haslo:
# caddy hash-password, wynik zamiast WSTAW_TUTAJ_HASH_BCRYPT (Caddy 2.7: basicauth).
# Naglowek Authorization z basic_auth nie idzie dalej do Node. Dziennik: filtr z bloku globalnego.
#
# test.content-ai.net {
#     header {
#         Strict-Transport-Security "max-age=31536000; includeSubDomains"
#         X-Robots-Tag "noindex, nofollow"
#         -Server
#     }
#     @chronione not path /platnosci/webhook/*
#     basic_auth @chronione {
#         WSTAW_TUTAJ_LOGIN WSTAW_TUTAJ_HASH_BCRYPT
#     }
#     reverse_proxy 127.0.0.1:3101 {
#         header_up X-Real-IP {client_ip}
#         header_up -Authorization
#         lb_try_duration 10s
#         lb_try_interval 250ms
#     }
# }

# ── OpenSEO (tylko gdy wdrozone, CAI_OPENSEO_PORT=3110) ──────────────────────
# Port 3110 (brama Content AI), NIGDY 3001 (goly kontener bez logowania).
# encode ma tu sens: brama oddaje HTML nieskompresowany, bo dokleja do niego motyw.
#
# seo.content-ai.net {
#     encode zstd gzip
#     header {
#         Strict-Transport-Security "max-age=31536000; includeSubDomains"
#         -Server
#     }
#     reverse_proxy 127.0.0.1:3110 {
#         header_up X-Real-IP {client_ip}
#     }
# }
```

Sprawdź i przeładuj - `validate` wyłapie błąd, zanim zepsuje Cosmosa:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
```

> **Kolejność przy aktualizacji: najpierw Caddy, potem kod.** Nowa wersja Content AI
> ufa nagłówkowi `X-Real-IP` tylko od Caddy (linia `header_up X-Real-IP {client_ip}`).
> Bez niej wszyscy użytkownicy dzielą jeden licznik prób logowania. Najpierw ten
> Caddyfile i `reload`, dopiero potem `git pull` i restart `contentai`.

Rekordy DNS, tryb SSL i ustawienia po stronie Cloudflare - w tym dwie pułapki, z których
każda kończy się błędem nic nie tłumaczącym - opisuje osobno
**`dokumenty/ContentAI_Domena_Cloudflare.md`**.

> **Jeśli Cosmos też stoi za Cloudflare**, dotyczy go ta sama uwaga o zrywaniu połączenia
> po 100 sekundach - ale w mniejszym stopniu. Cosmos strumieniuje odpowiedź (SSE), więc
> pierwsze bajty lecą od razu i limit się nie wyczerpuje. Content AI czeka na cały gotowy
> artykuł, dlatego jego poddomena **musi** mieć w Cloudflare szarą chmurkę.

> ### ⚠️ Największa pułapka tej konfiguracji
>
> Instrukcja Cosmosa ustawia Caddy poleceniem `echo '...' | sudo tee /etc/caddy/Caddyfile`.
> **`tee` nadpisuje cały plik.** Jeśli kiedykolwiek wykonasz je ponownie - przy
> przenosinach, po awarii, wracając do tamtej instrukcji - wpis Content AI zniknie
> bez śladu, a aplikacja przestanie być dostępna z internetu, mimo że usługa będzie
> działać poprawnie.
>
> Od teraz Caddyfile edytujesz **wyłącznie przez `nano`**. Przed każdą zmianą zrób kopię:
> ```bash
> cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.kopia
> ```

### B. Cosmos chodzi tylko przez Tailscale, a Content AI ma być publiczny

To realny scenariusz, jeśli Cosmos jest Twoim narzędziem prywatnym, a Content AI ma
obsługiwać klientów. Zainstaluj Caddy i skonfiguruj **tylko** Content AI - Cosmos zostaje
tam, gdzie był:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

nano /etc/caddy/Caddyfile
```

Na świeżo zainstalowanym Caddy plik zawiera tylko przykład `:80 { ... }` - usuń go.
Wklej **całą** treść z `dokumenty/Caddyfile.content-ai` (blok globalny + bloki domen,
ta sama co w wariancie A). Cosmosa nie dopisujemy.

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
ufw allow 80/tcp && ufw allow 443/tcp
```

Cosmos pozostaje niewidoczny z internetu - Caddy go nie dotyka, a port 3000 nadal słucha
tylko lokalnie i w tailnecie.

### C. Oba tylko przez Tailscale (testy prywatne)

Content AI domyślnie słucha wyłącznie na `127.0.0.1`, więc przez sam adres tailnetowy go
nie zobaczysz. Wystaw go przez `tailscale serve` **na osobnym porcie**:

```bash
tailscale serve --bg --https=8443 3100
tailscale serve status
```

Adres to wtedy `https://nazwa-maszyny.twoj-tailnet.ts.net:8443`, a Cosmos zostaje na swoim.

> **Nie wystawiaj Content AI pod ścieżką** (`tailscale serve --set-path=/contentai`).
> Aplikacja odwołuje się do własnych adresów bezwzględnych (`/api`, `/auth/login`),
> więc pod prefiksem ścieżki logowanie i generowanie przestaną działać. Osobny port
> jest jedyną prostą drogą.

---

## 5. Pułapki współistnienia

Tego nie ma w pełnej instrukcji, bo dotyczy wyłącznie dwóch aplikacji na jednej maszynie.

### Nazwy zmiennych z kluczami są w obu aplikacjach INNE

To najczęstsze źródło „przecież wpisałem klucz, a nie działa".

| Do czego | Cosmos (`/opt/cosmos/.env`) | Content AI (`/etc/contentai/srodowisko`) |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_KEY` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_KEY` |
| NVIDIA | `NVIDIA_API_KEY` | `NVIDIA_KEY` |
| ElevenLabs | `ELEVENLABS_API_KEY` | `ELEVEN_KEY` |

Skopiowanie linii z jednego pliku do drugiego **nie zgłosi błędu** - zmienna po prostu
zostanie zignorowana, a aplikacja zachowa się, jakby klucza nie było.

**Ten sam klucz może stać w obu plikach** i tak jest normalnie. Zużycie sumuje się na
jednym rachunku u dostawcy - to jedyny skutek uboczny.

### Dwa osobne logowania

| | Cosmos | Content AI |
|---|---|---|
| Sposób | jedno hasło (`COSMOS_PASSWORD`) | konta z loginami i rolami |
| Ciasteczko | `cosmos_auth` | `cai_auth` |
| Gdzie konta | w `.env` | `serwer/dane/uzytkownicy.json` |

Nazwy ciasteczek są różne, więc **aplikacje nie mieszają sobie sesji**, nawet na
poddomenach jednej domeny. Zalogowanie do jednej nie loguje do drugiej - i odwrotnie,
wylogowanie z jednej nie rusza drugiej.

Chcesz jedno logowanie do wszystkiego - patrz krok 8.

### Porty

| Port | Co | Kiedy |
|---|---|---|
| 3000 | Cosmos | zawsze |
| 3100 | Content AI | zawsze |
| 3001 | kontener OpenSEO | tylko przy OpenSEO |
| 3110 | brama OpenSEO | tylko przy OpenSEO |
| 9091 | Authelia | tylko przy bramie 2FA |

Żaden się nie pokrywa. Zmieniając `PORT` w `/etc/contentai/srodowisko`, pamiętaj o
poprawieniu adresu w Caddy - inaczej dostaniesz `502 Bad Gateway`.

### Aplikacje działają na różnych kontach systemowych - tak ma być

Cosmos w instrukcji chodzi jako `root`. Content AI chodzi jako własny użytkownik
`contentai` i może pisać **wyłącznie** do `/srv/contentai/serwer/dane`.

**Nie ujednolicaj tego.** Uruchomienie Content AI jako `root` nic nie ułatwi, a zdejmie
zabezpieczenie. W drugą stronę: nie próbuj przełączać Cosmosa na użytkownika `contentai` -
Cosmos zapisuje w innych miejscach i po prostu przestanie działać.

### Restart jednej usługi nie rusza drugiej

```bash
systemctl restart contentai     # Cosmos działa dalej, nikt się nie wylogowuje
systemctl restart cosmos        # Content AI działa dalej
```

To dwa niezależne procesy. Jedyna rzecz, która potrafi położyć oba naraz, to restart
całego serwera - po nim obie wstaną same.

---

## 6. Lista kontrolna

Po instalacji sprawdź **obie** aplikacje - nie tylko nową.

| # | Co | Ma się stać |
|---|---|---|
| 1 | Otwórz adres Cosmosa | Ekran logowania Cosmosa, wchodzisz jak zawsze |
| 2 | Otwórz `content-ai.net` | Strona produktowa, bez pytania o hasło |
| 3 | Kliknij na niej **Zaloguj się** | Przechodzisz na `app.content-ai.net`, ekran logowania Content AI |
| 4 | Zaloguj się | Wchodzisz; przy pierwszym wejściu wita Cię kreator konfiguracji |
| 5 | Wygeneruj artykuł | Tekst się pojawia (sprawdza klucz Anthropic) |
| 6 | `systemctl restart contentai`, odśwież Content AI | **Nadal zalogowany** |
| 7 | Odśwież Cosmosa | **Nadal zalogowany** - restart Content AI go nie dotknął |
| 8 | `systemctl status cosmos contentai` | Obie `active (running)` |
| 9 | Otwórz `www.content-ai.net` | Przekierowanie na `content-ai.net` |
| 10 | `journalctl -u contentai -n 50 --no-pager \| grep -i x-real-ip` | Pusto - Caddy przekazuje adres klienta |

Punkt 6 sprawdza, czy katalog `serwer/dane` należy do właściwego użytkownika. Jeśli
wyrzuca do logowania:

```bash
chown -R contentai:contentai /srv/contentai/serwer/dane
systemctl restart contentai
```

---

## 7. Obsługa obu naraz

### Stan i log

```bash
systemctl status cosmos contentai --no-pager     # obie naraz
journalctl -u contentai -f                       # log Content AI
journalctl -u cosmos -f                          # log Cosmosa
```

### Aktualizacja

Osobno, bo to osobne repozytoria:

```bash
cd /srv/contentai && git pull && systemctl restart contentai
cd /opt/cosmos    && git pull && systemctl restart cosmos
# Gdy wydanie zmienia blok Caddy (patrz dokumenty/Caddyfile.content-ai): NAJPIERW
# Caddyfile + caddy validate + systemctl reload caddy, dopiero potem te polecenia.
```

Aktualizacja Content AI nikogo nie wylogowuje - sesje przeżywają restart.

### Kopia zapasowa obu aplikacji

```bash
tar czf ~/kopia-$(date +%F).tar.gz \
    /srv/contentai/serwer/dane \
    /etc/contentai/srodowisko \
    /opt/cosmos/data \
    /opt/cosmos/.env \
    /etc/caddy/Caddyfile
```

Ze swojego komputera:

```bash
scp root@ADRES_IP:~/kopia-*.tar.gz .
```

To wszystkie dane obu aplikacji plus konfiguracja adresów. Kodu nie kopiujesz - jest
na GitHubie.

---

## 8. Opcjonalnie: jedno logowanie i 2FA na wszystko

Brama uwierzytelniająca (Authelia) postawiona przed całością obejmuje **obie aplikacje
naraz** - jedno konto, drugi składnik, klucze sprzętowe i passkeys. Gotowy wzór Caddyfile
w `brama/Caddyfile.przyklad` ma już przygotowany (zakomentowany) wpis dla Cosmosa -
wystarczy odkomentować i wpisać jego port.

Wtedy Cosmos i Content AI przestają pytać o własne hasła, a robi to brama.

Instrukcja: **`brama/README.md`**.

---

## Ściągawka

```bash
# stan obu
systemctl status cosmos contentai --no-pager

# restart pojedynczo
systemctl restart contentai
systemctl restart cosmos

# log
journalctl -u contentai -f

# konta i pakiety Content AI (zawsze z /srv/contentai)
cd /srv/contentai
sudo -u contentai node serwer/uzytkownicy.js lista
sudo -u contentai node serwer/uzytkownicy.js dodaj anna
sudo -u contentai node serwer/uzytkownicy.js plan anna standard
```

| Gdzie co leży | Cosmos | Content AI |
|---|---|---|
| Kod | `/opt/cosmos` | `/srv/contentai` |
| Dane | `/opt/cosmos/data` | `/srv/contentai/serwer/dane` |
| Klucze i ustawienia | `/opt/cosmos/.env` | `/etc/contentai/srodowisko` |
| Usługa | `/etc/systemd/system/cosmos.service` | `/etc/systemd/system/contentai.service` |
| Port | 3000 | 3100 |
| Użytkownik systemowy | `root` | `contentai` |

Adresy wszystkich trzech rzeczy - Cosmos, strona produktowa, aplikacja - leżą
w jednym pliku `/etc/caddy/Caddyfile`, każda jako osobny blok.

---

**Dokumenty pokrewne:** `dokumenty/ContentAI_Domena_Cloudflare.md` (domena za Cloudflare),
`dokumenty/ContentAI_Instalacja_na_serwerze.md` (pełna instrukcja
od zera, z tabelą problemów), `dokumenty/ContentAI_AdminGuide.md` (codzienna obsługa),
`brama/README.md` (2FA i jedno logowanie), `openseo/README.md` (OpenSEO obok).
