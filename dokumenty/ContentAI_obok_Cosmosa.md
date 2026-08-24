# Content AI na serwerze, na którym działa już Cosmos

Wersja dla sytuacji, w której masz **jeden VPS z Cosmosem** i chcesz na nim postawić obok
Content AI. Obie aplikacje działają niezależnie — nie współdzielą kodu, danych ani logowania.
Dzielą tylko maszynę.

> **To jest dokument uzupełniający.** Pełny opis każdego kroku, z wyjaśnieniami i tabelą
> problemów, jest w **`dokumenty/ContentAI_Instalacja_na_serwerze.md`**. Tutaj jest tylko to,
> co wygląda inaczej, bo Cosmos już tam siedzi — plus lista pułapek, w które łatwo wdepnąć,
> gdy na jednym serwerze stoją dwie aplikacje.

Czas: 20–30 minut.

---

## 1. Co już masz i czego nie musisz robić

Stawiając Cosmosa, zrobiłeś już połowę roboty:

| Krok z pełnej instrukcji | Stan | Dlaczego |
|---|---|---|
| Serwer VPS z Ubuntu | ✅ gotowe | Ten sam |
| Node.js ≥ 18 | ✅ gotowe | Cosmos wymaga tego samego; sprawdź `node -v` |
| Git | ✅ gotowe | Zainstalowany razem z Node |
| Caddy i HTTPS | ⚠️ zależy | Gotowe, jeśli Cosmos chodzi na domenie. Jeśli tylko na Tailscale — patrz krok 4 |
| Klucze API | ⚠️ do sprawdzenia | Możesz użyć tych samych, ale **nazwy zmiennych są inne** — patrz krok 5 |

Zostaje: pobranie kodu, konto usługi, konto admina, plik z kluczami, usługa systemd i adres.

---

## 2. Sprawdzenie przed startem

Zaloguj się na serwer i wykonaj trzy sprawdzenia.

**Miejsce na dysku** — Content AI zajmuje około 16 MB:

```bash
df -h /
```

**Pamięć** — Content AI to proces bez zależności, zjada kilkadziesiąt megabajtów:

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

Wszystko jako `root`. Objaśnienia każdego polecenia — w pełnej instrukcji.

```bash
# Kod — Cosmos siedzi w /opt/cosmos, Content AI kładziemy obok, w /srv/contentai
git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai

# Własne konto systemowe usługi i katalog na dane
useradd --system --home-dir /srv/contentai --shell /usr/sbin/nologin contentai
mkdir -p /srv/contentai/serwer/dane
chown -R contentai:contentai /srv/contentai/serwer/dane

# Twoje konto administratora (zapyta o hasło dwa razy, minimum 10 znaków)
cd /srv/contentai
sudo -u contentai node serwer/uzytkownicy.js dodaj marcin admin

# Klucze i ustawienia — osobny plik, nie ten od Cosmosa
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

Sprawdź, że odpowiada — i że Cosmos dalej odpowiada:

```bash
curl -s -o /dev/null -w "Content AI: %{http_code}\n" http://127.0.0.1:3100/
curl -s -o /dev/null -w "Cosmos:     %{http_code}\n" http://127.0.0.1:3000/
```

Oba mają zwrócić `200`.

---

## 4. Adres — trzy sytuacje

### A. Cosmos już chodzi na domenie przez Caddy

Najprostszy przypadek. **Nie nadpisuj pliku Caddy — dopisz do niego.**

```bash
nano /etc/caddy/Caddyfile
```

Plik ma już wpis Cosmosa. Dopisz **pod nim** drugi blok, nie ruszając pierwszego:

```
cosmos.twojadomena.pl {
    reverse_proxy 127.0.0.1:3000
}

contentai.twojadomena.pl {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}
```

```bash
systemctl reload caddy
```

W panelu domeny dodaj rekord `A` dla `contentai` na to samo IP. Certyfikat Caddy pobierze sam
przy pierwszym wejściu.

> ### ⚠️ Największa pułapka tej konfiguracji
>
> Instrukcja Cosmosa ustawia Caddy poleceniem `echo '...' | sudo tee /etc/caddy/Caddyfile`.
> **`tee` nadpisuje cały plik.** Jeśli kiedykolwiek wykonasz je ponownie — przy
> przenosinach, po awarii, wracając do tamtej instrukcji — wpis Content AI zniknie
> bez śladu, a aplikacja przestanie być dostępna z internetu, mimo że usługa będzie
> działać poprawnie.
>
> Od teraz Caddyfile edytujesz **wyłącznie przez `nano`**. Przed każdą zmianą zrób kopię:
> ```bash
> cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.kopia
> ```

### B. Cosmos chodzi tylko przez Tailscale, a Content AI ma być publiczny

To realny scenariusz, jeśli Cosmos jest Twoim narzędziem prywatnym, a Content AI ma
obsługiwać klientów. Zainstaluj Caddy i skonfiguruj **tylko** Content AI — Cosmos zostaje
tam, gdzie był:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

nano /etc/caddy/Caddyfile
```

Zawartość:

```
contentai.twojadomena.pl {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}
```

```bash
systemctl reload caddy
ufw allow 80/tcp && ufw allow 443/tcp
```

Cosmos pozostaje niewidoczny z internetu — Caddy go nie dotyka, a port 3000 nadal słucha
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

Skopiowanie linii z jednego pliku do drugiego **nie zgłosi błędu** — zmienna po prostu
zostanie zignorowana, a aplikacja zachowa się, jakby klucza nie było.

**Ten sam klucz może stać w obu plikach** i tak jest normalnie. Zużycie sumuje się na
jednym rachunku u dostawcy — to jedyny skutek uboczny.

### Dwa osobne logowania

| | Cosmos | Content AI |
|---|---|---|
| Sposób | jedno hasło (`COSMOS_PASSWORD`) | konta z loginami i rolami |
| Ciasteczko | `cosmos_auth` | `cai_auth` |
| Gdzie konta | w `.env` | `serwer/dane/uzytkownicy.json` |

Nazwy ciasteczek są różne, więc **aplikacje nie mieszają sobie sesji**, nawet na
poddomenach jednej domeny. Zalogowanie do jednej nie loguje do drugiej — i odwrotnie,
wylogowanie z jednej nie rusza drugiej.

Chcesz jedno logowanie do wszystkiego — patrz krok 8.

### Porty

| Port | Co | Kiedy |
|---|---|---|
| 3000 | Cosmos | zawsze |
| 3100 | Content AI | zawsze |
| 3001 | kontener OpenSEO | tylko przy OpenSEO |
| 3110 | brama OpenSEO | tylko przy OpenSEO |
| 9091 | Authelia | tylko przy bramie 2FA |

Żaden się nie pokrywa. Zmieniając `PORT` w `/etc/contentai/srodowisko`, pamiętaj o
poprawieniu adresu w Caddy — inaczej dostaniesz `502 Bad Gateway`.

### Aplikacje działają na różnych kontach systemowych — tak ma być

Cosmos w instrukcji chodzi jako `root`. Content AI chodzi jako własny użytkownik
`contentai` i może pisać **wyłącznie** do `/srv/contentai/serwer/dane`.

**Nie ujednolicaj tego.** Uruchomienie Content AI jako `root` nic nie ułatwi, a zdejmie
zabezpieczenie. W drugą stronę: nie próbuj przełączać Cosmosa na użytkownika `contentai` —
Cosmos zapisuje w innych miejscach i po prostu przestanie działać.

### Restart jednej usługi nie rusza drugiej

```bash
systemctl restart contentai     # Cosmos działa dalej, nikt się nie wylogowuje
systemctl restart cosmos        # Content AI działa dalej
```

To dwa niezależne procesy. Jedyna rzecz, która potrafi położyć oba naraz, to restart
całego serwera — po nim obie wstaną same.

---

## 6. Lista kontrolna

Po instalacji sprawdź **obie** aplikacje — nie tylko nową.

| # | Co | Ma się stać |
|---|---|---|
| 1 | Otwórz adres Cosmosa | Ekran logowania Cosmosa, wchodzisz jak zawsze |
| 2 | Otwórz adres Content AI | Ekran logowania Content AI |
| 3 | Zaloguj się do Content AI | Wchodzisz; w prawym górnym rogu odznaka pakietu |
| 4 | Wygeneruj artykuł | Tekst się pojawia (sprawdza klucz Anthropic) |
| 5 | `systemctl restart contentai`, odśwież Content AI | **Nadal zalogowany** |
| 6 | Odśwież Cosmosa | **Nadal zalogowany** — restart Content AI go nie dotknął |
| 7 | `systemctl status cosmos contentai` | Obie `active (running)` |

Punkt 5 sprawdza, czy katalog `serwer/dane` należy do właściwego użytkownika. Jeśli
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
```

Aktualizacja Content AI nikogo nie wylogowuje — sesje przeżywają restart.

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

To wszystkie dane obu aplikacji plus konfiguracja adresów. Kodu nie kopiujesz — jest
na GitHubie.

---

## 8. Opcjonalnie: jedno logowanie i 2FA na wszystko

Brama uwierzytelniająca (Authelia) postawiona przed całością obejmuje **obie aplikacje
naraz** — jedno konto, drugi składnik, klucze sprzętowe i passkeys. Gotowy wzór Caddyfile
w `brama/Caddyfile.przyklad` ma już przygotowany (zakomentowany) wpis dla Cosmosa —
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

Adresy obu aplikacji: `/etc/caddy/Caddyfile` (jeden plik, dwa bloki).

---

**Dokumenty pokrewne:** `dokumenty/ContentAI_Domena_Cloudflare.md` (domena za Cloudflare),
`dokumenty/ContentAI_Instalacja_na_serwerze.md` (pełna instrukcja
od zera, z tabelą problemów), `dokumenty/ContentAI_AdminGuide.md` (codzienna obsługa),
`brama/README.md` (2FA i jedno logowanie), `openseo/README.md` (OpenSEO obok).
