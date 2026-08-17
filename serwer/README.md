# Content AI — serwer

Serwuje aplikację, pilnuje logowania i pośredniczy w wywołaniach API, dzięki czemu
klucze nigdy nie trafiają do przeglądarki.

**Zero zależności npm** — wyłącznie moduły wbudowane Node ≥ 18. Nie ma `npm install`.

---

## Jak to działa

```
przeglądarka ──HTTPS──► Caddy ──► serwer Node ──► Anthropic / NVIDIA / OpenAI / ElevenLabs
                                       │
                                       ├── ekran logowania (konta z rolami)
                                       └── serwuje app/web-proxy.html
                                           z adresami przepisanymi na /api
```

Serwer odtwarza kontrakt `app/worker.js`, więc **aplikacja działa bez żadnych zmian**:

| Endpoint | Do czego |
|---|---|
| `POST /api` | generowanie treści |
| `POST /api/images` | grafiki |
| `POST /api/tts` | synteza mowy |
| `POST /api/transcribe` | transkrypcja |
| `POST /api/eleven-tts` | synteza ElevenLabs |
| `GET /api/status` | stan serwera — **tylko rola admin** |
| `POST /auth/login`, `GET /auth/logout`, `GET /auth/me` | logowanie |

Wszystko poza logowaniem wymaga aktywnej sesji.

---

## Konta i role

Konta trzyma `serwer/dane/uzytkownicy.json` (uprawnienia `0600`, wykluczony z repo).
Hasła są haszowane **scryptem** z losową solą — nigdzie nie ma hasła jawnego.

| Rola | Co może |
|---|---|
| `admin` | wszystko, w tym `/api/status` |
| `uzytkownik` | korzystać z aplikacji |

```bash
node serwer/uzytkownicy.js dodaj marcin admin      # pyta o hasło, bez echa
node serwer/uzytkownicy.js dodaj anna              # domyślnie rola uzytkownik
node serwer/uzytkownicy.js lista
node serwer/uzytkownicy.js haslo anna              # zmiana hasła
node serwer/uzytkownicy.js rola anna admin
node serwer/uzytkownicy.js usun anna
```

Hasło ma minimum 10 znaków. Ostatniego admina nie da się usunąć ani zdegradować.

Sesje żyją w pamięci — **restart serwera wylogowuje wszystkich**. To świadomy wybór:
zero zależności, a ponowne logowanie kosztuje kilka sekund. Po odebraniu komuś konta
zrestartuj serwer, żeby uciąć jego bieżącą sesję.

---

## Konfiguracja

Wszystko przez zmienne środowiskowe.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `PORT` | `3100` | port nasłuchu |
| `CAI_HOST` | `127.0.0.1` | interfejs; zostaw lokalny, ruch z zewnątrz puszcza Caddy |
| `CAI_COOKIE_SECURE` | `1` | `0` **tylko** do testów lokalnych bez HTTPS |
| `CAI_SESJA_GODZIN` | `336` (14 dni) | ważność sesji |
| `CAI_DOSTAWCA` | `anthropic` | `anthropic` albo `nvidia` |
| `CAI_MODEL_NVIDIA` | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | model przy `nvidia` |
| `CAI_URL_NVIDIA` | `https://integrate.api.nvidia.com/v1/chat/completions` | endpoint NIM |
| `ANTHROPIC_KEY` | — | klucz treści (dostawca `anthropic`) |
| `NVIDIA_KEY` | — | klucz treści (dostawca `nvidia`) |
| `OPENAI_KEY` | — | grafiki, TTS, transkrypcja |
| `ELEVEN_KEY` | — | głos premium |

### Klucze mieszane

Klucz serwera jest domyślny. Jeśli użytkownik poda **własny** klucz, serwer użyje jego
zamiast serwerowego — aplikacja wysyła go w nagłówku `x-api-key` (oraz `x-openai-key`,
`x-eleven-key`). Pusty nagłówek, który aplikacja wysyła w trybie proxy, jest ignorowany
i wraca klucz serwera. Nie wymaga to żadnej zmiany w aplikacji.

### Modele open source

`CAI_DOSTAWCA=nvidia` kieruje generowanie treści do NVIDIA NIM. Serwer tłumaczy żądanie
z formatu Anthropic na OpenAI Chat Completions i odpowiedź z powrotem, więc **aplikacja
nie wie o zmianie**. Bloki obrazów są przy tłumaczeniu pomijane — nie każdy model NIM je przyjmuje.

Grafiki, TTS i transkrypcja nadal idą do OpenAI/ElevenLabs. Ich zamienniki OSS wymagają
własnego GPU, więc na VPS bez karty nie mają sensu.

---

## Uruchomienie na serwerze (Ubuntu)

```bash
# 1. Kod i Node
sudo apt update && sudo apt install -y git nodejs npm
sudo git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai
cd /srv/contentai

# 2. Zbuduj warianty aplikacji (serwer potrzebuje app/web-proxy.html)
python3 pakowanie/warianty.py --wszystkie -o app

# 3. Pierwsze konto administratora
node serwer/uzytkownicy.js dodaj marcin admin

# 4. Klucze i konfiguracja
sudo mkdir -p /etc/contentai
sudo tee /etc/contentai/srodowisko > /dev/null <<'EOF'
PORT=3100
CAI_DOSTAWCA=anthropic
ANTHROPIC_KEY=sk-ant-...
OPENAI_KEY=sk-proj-...
EOF
sudo chmod 600 /etc/contentai/srodowisko
```

### Usługa systemd

```bash
sudo cp /srv/contentai/serwer/contentai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contentai
sudo systemctl status contentai
```

### Caddy — HTTPS

```
contentai.twojadomena.pl {
    reverse_proxy 127.0.0.1:3100
}
```

Caddy sam pobierze certyfikat. **Nie dodawaj tu `basicauth`** — logowanie obsługuje
już serwer, a dwa ekrany logowania pod rząd tylko męczą.

### Aktualizacja

```bash
cd /srv/contentai && sudo git pull
sudo python3 pakowanie/warianty.py --wszystkie -o app
sudo systemctl restart contentai
```

---

## Bezpieczeństwo

Co serwer robi:

- hasła haszowane scryptem z losową solą, porównanie odporne na pomiar czasu
- **8 nieudanych prób logowania z jednego IP → blokada na 15 minut**
- cookie `HttpOnly`, `SameSite=Lax`, `Secure` (gdy `CAI_COOKIE_SECURE=1`)
- klucze API nigdy nie docierają do przeglądarki
- pliki statyczne tylko z `app/pwa/` — reszta katalogu jest niedostępna, próby wyjścia
  poza katalog kończą się 404
- szczegóły błędów dostawcy trafiają do logu serwera, nie do przeglądarki

Czego **nie** robi — i o czym trzeba wiedzieć:

- sesje w pamięci, więc restart wylogowuje wszystkich
- brak 2FA i brak resetu hasła przez e-mail — hasło zmienia admin poleceniem
- licznik prób logowania jest w pamięci i per IP; za wspólnym NAT-em zablokuje wszystkich
  z tego adresu naraz
- serwer ufa nagłówkowi `X-Forwarded-For` — ma sens **tylko** za własnym Caddy/nginx;
  nie wystawiaj go bezpośrednio na świat
