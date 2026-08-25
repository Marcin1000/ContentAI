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

## 3. Caddy - dwa bloki w jednym pliku

```bash
nano /etc/caddy/Caddyfile
```

Zawartość (podmień nic - domena jest już wpisana):

```
# ── Strona produktowa ────────────────────────────────────────────────────────
# Zwykłe pliki z katalogu showcase. Nie ma tu żadnej aplikacji ani logowania.
content-ai.net, www.content-ai.net {
    encode zstd gzip
    root * /srv/contentai/showcase
    file_server
}

# ── Aplikacja ────────────────────────────────────────────────────────────────
# Logowanie i konta obsługuje sam Content AI - nie dodawaj tu basicauth.
app.content-ai.net {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}
```

```bash
systemctl reload caddy
```

Sprawdź, czy Caddy przyjął konfigurację:

```bash
systemctl status caddy --no-pager
```

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

Oba mają zwrócić `HTTP/2 200`.

W przeglądarce:

| # | Co | Ma się stać |
|---|---|---|
| 1 | `https://content-ai.net` | Strona produktowa, kłódka przy adresie |
| 2 | Kliknij **Zaloguj się** w prawym górnym rogu | Przechodzisz na `app.content-ai.net`, widzisz ekran logowania |
| 3 | Zaloguj się | Wchodzisz do aplikacji; przy pierwszym wejściu wita Cię kreator konfiguracji |
| 4 | Wygeneruj artykuł | Tekst się pojawia - bez błędu 524 nawet przy długim tekście |
| 5 | `https://www.content-ai.net` | To samo co punkt 1 |

---

## 5. Aktualizacja strony produktowej

Strona to zwykły plik w repozytorium, więc aktualizuje się razem z resztą:

```bash
cd /srv/contentai && git pull
```

Caddy poda nową wersję od razu - nie trzeba go restartować. Cloudflare może jeszcze
przez chwilę serwować starą wersję z cache; żeby to wymusić natychmiast, w panelu:
**Caching → Configuration → Purge Everything**.

> Adres aplikacji jest w stronie produktowej **w jednym miejscu** - stała
> `ADRES_APLIKACJI` w skrypcie na końcu `showcase/index.html`. Zmieniając domenę,
> poprawiasz tylko ją.

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
