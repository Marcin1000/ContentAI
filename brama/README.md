# Brama uwierzytelniająca - 2FA, passkeys i jedno logowanie

Content AI ma własne konta z hasłami. To wystarcza do wdrożenia, ale **nie daje
drugiego składnika** - a konto admina zarządza wszystkimi.

Zamiast dopisywać TOTP do naszego serwera, stawiamy przed nim gotową bramę.
Zysk jest większy niż samo 2FA: jedno logowanie obejmuje wtedy **Content AI,
OpenSEO i Cosmos**, a kod odpowiedzialny za uwierzytelnianie utrzymuje ktoś,
kto robi to na pełen etat.

> **Bez tego katalogu wszystko działa jak dotąd.** Brama jest opcją, nie wymogiem.
> Serwer przechodzi w ten tryb dopiero po ustawieniu `CAI_ZAUFANY_NAGLOWEK`.

---

## Co wybrać

| | [Authelia](https://github.com/authelia/authelia) | [tinyauth](https://github.com/steveiliop56/tinyauth) | Cloudflare Access |
|---|---|---|---|
| 2FA | TOTP, WebAuthn/passkeys, Duo | TOTP | zależnie od IdP |
| Konta | plik YAML albo LDAP | plik | u dostawcy |
| Baza danych | niepotrzebna (plik) | niepotrzebna | - |
| Pamięć | ~80-120 MB | ~20 MB | 0 (poza serwerem) |
| Dane wychodzą na zewnątrz | nie | nie | **tak** |

**Rekomendacja: Authelia.** Ma passkeys, dojrzałą integrację z Caddy i nie wymaga
bazy danych przy backendzie plikowym. tinyauth jest lżejszy, ale ma tylko TOTP.
Cloudflare Access odpada, jeśli ruch ma zostać u Ciebie.

---

## Jak to się składa

```
przeglądarka ──► Caddy ──forward_auth──► Authelia   (hasło + drugi składnik)
                   │                        │
                   │     ◄── Remote-User ───┘
                   ▼
            Content AI (3100)   OpenSEO (3110)   Cosmos
```

Caddy pyta Authelię przed każdym żądaniem. Bez sesji użytkownik ląduje na jej
ekranie logowania; z sesją Caddy dokleja nagłówek `Remote-User` i puszcza dalej.

**Content AI czyta z nagłówka wyłącznie login.** Role zostają w naszym pliku kont -
inaczej uprawnienia trzeba by trzymać w dwóch miejscach naraz. Konto musi istnieć
po obu stronach; serwer celowo nie zakłada go z marszu, bo rola ma być czyjąś
decyzją, a nie skutkiem ubocznym pierwszego wejścia.

### Dlaczego to jest bezpieczne tylko za bramą

Serwer przyjmuje `Remote-User` **wyłącznie z zaufanego adresu** - domyślnie z pętli
zwrotnej. Bez tego warunku każdy, kto dosięgnie portu 3100 z pominięciem Caddy,
zostaje adminem przez dopisanie jednego nagłówka.

Dlatego przy włączonej bramie **port 3100 nie może być wystawiony na świat**.
`CAI_HOST` zostaje na `127.0.0.1` - tak jest domyślnie.

W tym trybie własny ekran logowania Content AI jest wyłączony (`POST /auth/login`
zwraca 404), żeby nie tworzyć drugiej, słabszej drogi wejścia omijającej 2FA.

---

## Wdrożenie

### 1. Authelia

```bash
sudo mkdir -p /srv/authelia/config
sudo cp /srv/contentai/brama/authelia.yml /srv/authelia/config/configuration.yml
sudo cp /srv/contentai/brama/compose.yaml /srv/authelia/
```

Wygeneruj sekrety i wpisz je do `/srv/authelia/.env`:

```bash
cd /srv/authelia
{
  echo "AUTHELIA_JWT_SECRET=$(openssl rand -hex 32)"
  echo "AUTHELIA_SESSION_SECRET=$(openssl rand -hex 32)"
  echo "AUTHELIA_STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
} | sudo tee .env > /dev/null
sudo chmod 600 .env
```

### 2. Konta w Authelii

Hasła są haszowane Argon2id. Wygeneruj hash:

```bash
sudo docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password 'twoje-haslo'
```

Wynik wklej do `/srv/authelia/config/users.yml` - wzór w `users.yml.przyklad`.

> **Uwaga na pamięć.** Argon2id domyślnie bierze 64 MB na jedno haszowanie.
> Przy 2 vCPU i innych usługach obok warto zejść do 32 MB - w `authelia.yml`
> jest to już ustawione, z komentarzem.

### 3. Caddy

Zastąp wpisy Content AI i OpenSEO tym, co jest w `Caddyfile.przyklad`.

### 4. Content AI

W `/etc/contentai/srodowisko`:

```
CAI_ZAUFANY_NAGLOWEK=Remote-User
```

```bash
sudo systemctl restart contentai
```

### 5. Sprawdzenie

W trybie incognito wejdź na `https://contentai.twojadomena.pl`:

1. Ma się pokazać ekran **Authelii**, nie Content AI.
2. Po haśle - drugi składnik (przy pierwszym logowaniu Authelia poprowadzi przez
   rejestrację TOTP albo klucza).
3. Po zalogowaniu - Content AI, już zalogowany.
4. `https://seo.twojadomena.pl` - bez ponownego logowania.

Kontrola od strony bezpieczeństwa, **z samego serwera**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H 'Remote-User: marcin' http://127.0.0.1:3100/api/status
```

Z pętli zwrotnej **zwróci 200 - i tak ma być**: to dokładnie ta ścieżka, z której
korzysta Caddy. Dlatego port 3100 nie może być osiągalny z zewnątrz. Sprawdź to:

```bash
sudo ss -tlnp | grep 3100     # ma być 127.0.0.1:3100, nigdy 0.0.0.0:3100
```

---

## Czego to nie załatwia

- **Cosmos** trzeba osobno wpiąć w ten sam `forward_auth` - brama jest wspólna,
  ale każda aplikacja musi z niej skorzystać.
- **Sesje Authelii domyślnie też siedzą w pamięci.** Restart kontenera wylogowuje
  wszystkich. Rozwiązuje to Redis - w `compose.yaml` jest zakomentowany, ~20 MB.
  Sesje samego Content AI restartu nie potrzebują: są w podpisanym ciasteczku.
- **Odebranie dostępu** wymaga teraz dwóch ruchów: usunięcia konta w Authelii
  (odcina logowanie) i w Content AI (odcina rolę). Kolejność bez znaczenia.

## Czego nie sprawdziłem

Tej konfiguracji nie dało się uruchomić w środowisku, w którym powstawała -
nie ma tam Dockera. Sprawdzona jest **strona Content AI**: tryb bramy ma testy
(`node serwer/testy.js`), w tym te potwierdzające, że nagłówek `Remote-User`
z obcego adresu jest odrzucany, a `X-Forwarded-For` nie podszywa adresu źródłowego.

Pliki Authelii pochodzą z jej dokumentacji i przy pierwszym starcie trzeba
obserwować log:

```bash
cd /srv/authelia && sudo docker compose logs -f
```
