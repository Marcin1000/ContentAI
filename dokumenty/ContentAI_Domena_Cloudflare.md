# Domena content-ai.net na Cloudflare - strona produktowa i aplikacja

Ustawienie domeny tak, żeby pod `content-ai.net` stała strona produktowa, a pod
`app.content-ai.net` - aplikacja z logowaniem. Zakłada, że Content AI jest już
zainstalowany według `dokumenty/ContentAI_Instalacja_na_serwerze.md`.

Czas: 20 minut plus czekanie na certyfikat.

---

## Dlaczego dwa adresy, a nie jeden

| | `content-ai.net` | `app.content-ai.net` |
|---|---|---|
| Co tam stoi | strona produktowa (`showcase/index.html`) | aplikacja |
| Kto ma wejść | każdy, bez logowania | tylko osoby z kontem |
| Cloudflare | **proxy włączone** (pomarańczowa chmurka) | **proxy wyłączone** (szara chmurka) |
| Po co tak | Cloudflare cache'uje statyczną stronę i serwuje ją ze swoich serwerów - Twój VPS prawie się nie rusza | patrz ostrzeżenie o limicie 100 sekund niżej |

Rozdzielenie daje jeszcze jedno: ciasteczko sesji siedzi wyłącznie na `app`, więc strona
produktowa nie ustawia niczego w przeglądarce odwiedzającego i jest w pełni cache'owalna.

---

## 1. Rekordy DNS

W panelu Cloudflare: **DNS → Records → Add record**. Potrzebujesz trzech wpisów.

| Typ | Name | Content | Proxy status |
|---|---|---|---|
| `A` | `@` | adres IP Twojego serwera | **Proxied** (pomarańczowa) |
| `A` | `www` | adres IP Twojego serwera | **Proxied** (pomarańczowa) |
| `A` | `app` | adres IP Twojego serwera | **DNS only** (szara) |

Klikając w chmurkę przy rekordzie, przełączasz ją między pomarańczową a szarą.

> ### ⚠️ Dlaczego `app` musi być szary
>
> Cloudflare w planie darmowym **zrywa połączenie po 100 sekundach** i pokazuje
> błąd **524**. Generowanie długiego artykułu potrafi trwać dłużej - i wtedy
> użytkownik zobaczy błąd Cloudflare zamiast gotowego tekstu, mimo że serwer
> pracuje dalej i klucz API zostaje obciążony.
>
> Szara chmurka znaczy „Cloudflare tylko podaje adres IP, ruch idzie prosto do
> serwera". Nie ma wtedy żadnego limitu czasu, a HTTPS i tak zapewnia Caddy.
>
> **Cena tego rozwiązania:** przy szarej chmurce publiczny adres IP Twojego serwera
> jest widoczny - Cloudflare go nie ukrywa. Dla aplikacji za logowaniem to
> akceptowalne; ochronę przed zalewem żądań ma wtedy zapewnić zapora serwera.

---

## 2. Tryb SSL/TLS

W panelu: **SSL/TLS → Overview → Configure**.

Ustaw **Full (strict)**.

| Tryb | Co robi | Wynik |
|---|---|---|
| Off | brak HTTPS | odpada |
| Flexible | Cloudflare łączy się z serwerem po HTTP | **pętla przekierowań** - Caddy przekierowuje na HTTPS, Cloudflare wraca po HTTP, i tak w kółko |
| Full | HTTPS do serwera, ale bez sprawdzania certyfikatu | działa, ale nie sprawdza, z kim rozmawia |
| **Full (strict)** | HTTPS do serwera z weryfikacją certyfikatu | **to ustaw** - Caddy ma prawdziwy certyfikat Let's Encrypt, więc weryfikacja przechodzi |

**Flexible to najczęstszy błąd** przy stawianiu strony za Cloudflare. Jeśli po
uruchomieniu strona wpada w nieskończone przekierowanie, sprawdź w pierwszej
kolejności to ustawienie.

---

## 3. Caddy - strona, przekierowanie www i aplikacja

Gotowe bloki leżą w repozytorium: **`dokumenty/Caddyfile.content-ai`**. To jedno źródło
prawdy - ten sam blok jest niżej, w `ContentAI_obok_Cosmosa.md` i w `serwer/README.md`.

> ### ⚠️ Nie nadpisuj pliku - dopisz albo zastąp bloki tych domen
>
> Na serwerze może już stać inna usługa (np. Cosmos) z własnym wpisem w tym samym pliku.
> Zrób kopię i edytuj ręcznie:
> ```bash
> cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.kopia-$(date +%F)
> nano /etc/caddy/Caddyfile
> ```
> - **blok globalny** (nawiasy `{ }` bez nazwy domeny): Caddy przyjmuje tylko jeden i musi
>   on stać **na samej górze** pliku. Jeśli plik już go ma, dopisz do niego sekcję
>   `servers { ... }`; jeśli nie ma, wklej go jako pierwszy,
> - bloki `www.content-ai.net`, `content-ai.net` i `app.content-ai.net` **zastępują**
>   dotychczasowe wpisy tych domen (np. stare `content-ai.net, www.content-ai.net { ... }`),
> - wpisów innych usług nie ruszasz.

> **Kolejność przy aktualizacji istniejącej instalacji: najpierw Caddy, potem kod.**
> Serwer Node ufa nagłówkowi `X-Real-IP` tylko od Caddy z tej samej maszyny. Nowa wersja
> Content AI bez linii `header_up X-Real-IP {client_ip}` widzi wszystkich jako jeden adres
> (jedna osoba blokuje logowanie całemu zespołowi na 15 minut), a stare `reverse_proxy`
> przepuszcza `X-Real-IP` od klienta, więc da się nim obejść limit prób. Dlatego:
> 1. ten Caddyfile + `caddy validate` + `systemctl reload caddy`,
> 2. dopiero potem `cd /srv/contentai && git pull && systemctl restart contentai`.

Bloki do wklejenia (wymagają Caddy 2.7 lub nowszego - sprawdź `caddy version`):

```
{
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
    @html path / /en/ /prywatnosc/ /en/privacy/ *.html
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
    }
}

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

Sprawdź składnię i przeładuj:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
systemctl status caddy --no-pager
```

Co robi każdy fragment:

| Fragment | Po co |
|---|---|
| `trusted_proxies` + `client_ip_headers CF-Connecting-IP` | strona idzie przez Cloudflare (pomarańczowa chmurka); bez tego Caddy widziałby adres Cloudflare zamiast odwiedzającego |
| `header_up X-Real-IP {client_ip}` | prawdziwy adres klienta dla Node (licznik prób logowania, limit próśb o dostęp); **nadpisuje** nagłówek wysłany przez klienta |
| `www.content-ai.net` → `redir` | jeden adres kanoniczny; formularz „Poproś o dostęp" działa z jednego pochodzenia, wyszukiwarka nie widzi duplikatu |
| `@zrodlo` → 404 | źródła generatora strony (`showcase/zrodlo/`) nie są publikowane |
| `Content-Security-Policy` strony | strona ładuje wyłącznie własne pliki; jedyne połączenie na zewnątrz to formularz do `app.content-ai.net` |
| `Strict-Transport-Security` | przeglądarka nie wraca już na `http://`; `includeSubDomains` obejmuje też `app.` i `seo.`, więc każda poddomena musi mieć HTTPS (Caddy robi to sam) |
| `Cache-Control` | HTML zawsze świeży, CSS/JS z wersją w adresie na rok, fonty 30 dni, obrazy dzień |
| brak nagłówków bezpieczeństwa w `app.` | wysyła je sam Content AI (CSP, `X-Frame-Options`, `nosniff`...) - nie dubluj ich w Caddy |

Gdyby Cloudflare miał trzymać HTML na krawędzi: **Caching → Cache Rules** dla
`content-ai.net` → *Eligible for cache*, Edge TTL *Use cache-control header if present*
(nagłówek `CDN-Cache-Control` daje 10 minut). Bez reguły HTML idzie z serwera - też dobrze.

> **Pliki strony musi umieć odczytać Caddy.** Katalog `showcase` przychodzi
> razem z repozytorium i ma domyślne prawa odczytu dla wszystkich, więc zwykle
> nie trzeba nic robić. Gdyby strona zwracała `403`, sprawdź:
> ```bash
> ls -ld /srv/contentai /srv/contentai/showcase
> ```

---

## 4. Sprawdzenie

Po kilku minutach (Cloudflare musi rozpropagować DNS, Caddy pobrać certyfikat):

```bash
curl -sI https://content-ai.net | head -3
curl -sI https://app.content-ai.net | head -3
```

Oba mają zwrócić `HTTP/2 200`. Dalej:

```bash
curl -sI https://www.content-ai.net | head -3                  # 301 -> https://content-ai.net/
curl -sI https://content-ai.net/zrodlo/teksty.json | head -1   # 404
curl -sI https://content-ai.net | grep -iE 'content-security|strict'
curl -sI https://app.content-ai.net | grep -iE 'content-security|strict'
journalctl -u contentai -n 50 --no-pager | grep -i 'x-real-ip' # pusto = Caddy przekazuje adres klienta
```

W przeglądarce:

| # | Co | Ma się stać |
|---|---|---|
| 1 | `https://content-ai.net` | Strona produktowa, kłódka przy adresie |
| 2 | Kliknij **Zaloguj się** w prawym górnym rogu | Przechodzisz na `app.content-ai.net`, widzisz ekran logowania |
| 3 | Zaloguj się | Wchodzisz do aplikacji; przy pierwszym wejściu wita Cię kreator konfiguracji |
| 4 | Wygeneruj artykuł | Tekst się pojawia - bez błędu 524 nawet przy długim tekście |
| 5 | `https://www.content-ai.net` | Przekierowanie na `https://content-ai.net` (ten sam adres w pasku) |
| 6 | Formularz „Poproś o dostęp" na stronie | Komunikat o wysłaniu; prośbę widać w `node serwer/uzytkownicy.js prosby` |

---

## 5. Aktualizacja strony produktowej

Strona to zwykły plik w repozytorium, więc aktualizuje się razem z resztą:

```bash
cd /srv/contentai && git pull
```

Caddy poda nową wersję od razu - nie trzeba go restartować. Cloudflare może jeszcze
przez chwilę serwować starą wersję z cache; żeby to wymusić natychmiast, w panelu:
**Caching → Configuration → Purge Everything**.

> Adres aplikacji jest w stronie produktowej **w jednym miejscu** - stałe `APP` i `API`
> w `narzedzia/buduj_strone.py` (strona jest generowana: `python3 narzedzia/buduj_strone.py`).
> Zmieniając domenę, poprawiasz je, budujesz stronę od nowa i zmieniasz domeny w Caddyfile
> oraz `CAI_STRONA_ORIGIN`.

---

## 6. Kiedy coś nie działa

| Objaw | Przyczyna | Co zrobić |
|---|---|---|
| Nieskończone przekierowanie | Tryb SSL ustawiony na **Flexible** | Przełącz na **Full (strict)** (krok 2) |
| **Błąd 524** przy generowaniu | `app` ma pomarańczową chmurkę i Cloudflare zerwał połączenie po 100 s | Przełącz rekord `app` na **DNS only** (krok 1) |
| Błąd 521 albo 522 | Caddy nie działa albo zapora blokuje port 443 | `systemctl status caddy`, `ufw status` |
| `502 Bad Gateway` na `app` | Content AI nie działa albo słucha na innym porcie | `systemctl status contentai`, sprawdź `PORT` w `/etc/contentai/srodowisko` |
| `403` na stronie produktowej | Caddy nie może odczytać plików | `ls -ld /srv/contentai/showcase` |
| Ostrzeżenie o certyfikacie na `app` | Caddy jeszcze go nie pobrał | Poczekaj 3 minuty; `journalctl -u caddy -n 30 --no-pager` |
| Strona pokazuje starą treść po `git pull` | Cache Cloudflare | **Caching → Purge Everything** |
| Formularz „Poproś o dostęp": „Nie udało się wysłać" | strona otwarta z adresu spoza `CAI_STRONA_ORIGIN` (np. `www` bez przekierowania) | blok `www.content-ai.net` z `redir` (krok 3); `CAI_STRONA_ORIGIN` w `/etc/contentai/srodowisko` |
| Po aktualizacji nikt z zespołu nie może się zalogować („Za dużo prób") | brak `header_up X-Real-IP {client_ip}` - Node widzi wszystkich jako 127.0.0.1 | blok `app.content-ai.net` z kroku 3; w logu `journalctl -u contentai` jest ostrzeżenie o braku X-Real-IP |
| `caddy validate`: nieznana dyrektywa `client_ip_headers` | Caddy starszy niż 2.7 | `apt update && apt install --only-upgrade caddy` |

---

## Co dalej

**Konta dla użytkowników.** Zakładasz je poleceniem - patrz
`dokumenty/ContentAI_AdminGuide.md`. Osoba dostaje login i hasło, przy pierwszym
wejściu prowadzi ją kreator konfiguracji.

**Dwuskładnikowe logowanie.** Brama Authelia przed `app.content-ai.net` - patrz
`brama/README.md`. Strona produktowa zostaje wtedy otwarta dla wszystkich, bramkowana
jest tylko aplikacja.

**Samodzielna rejestracja i płatności.** Tego jeszcze nie ma - konta nadaje admin.
To świadomy krok pierwszy: limity pakietów działają i można je testować, zanim
wejdzie bramka płatnicza.

---

**Dokumenty pokrewne:** `dokumenty/ContentAI_Instalacja_na_serwerze.md` (instalacja od zera),
`dokumenty/ContentAI_obok_Cosmosa.md` (gdy na serwerze działa już Cosmos),
`dokumenty/ContentAI_AdminGuide.md` (konta i pakiety).
