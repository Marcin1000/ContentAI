# OpenSEO obok Content AI

[OpenSEO](https://github.com/every-app/open-seo) to otwartoźródłowa alternatywa dla Semrusha
i Ahrefsa: badanie fraz, monitoring pozycji, analiza konkurencji, backlinki, audyty stron
i widoczność w AI. Licencja MIT.

To **osobna aplikacja**, nie moduł Content AI. Stoi obok, na tym samym serwerze, pod własną
domeną. Content AI nie zależy od niej i działa bez niej.

> Ten katalog zawiera wyłącznie konfigurację i instrukcję wdrożenia po naszej stronie.
> Kod OpenSEO mieszka w swoim repozytorium i stamtąd się aktualizuje.

---

## ⚠️ Najpierw to: wersja Docker nie ma logowania

Self-hosting przez Dockera startuje z `AUTH_MODE=local_noauth` — **aplikacja nie ma żadnego
logowania**. Dokumentacja OpenSEO mówi wprost, że wystawienie jej na świat wymaga własnego
„auth-protected reverse proxy, tunnel, or private network".

Co to znaczy praktycznie: jeśli podepniesz domenę bez zabezpieczenia, **każdy, kto trafi
na adres, dostanie pełny dostęp** — zobaczy Twoje dane i będzie wypalał Twoje kredyty
DataForSEO, za które płacisz od zapytania.

Domyślnie ryzyka nie ma, bo `compose.yaml` wiąże port z `127.0.0.1` — z zewnątrz nic nie widać.
**Ryzyko pojawia się dopiero w momencie dodania reverse proxy.** Dlatego konfiguracja Caddy
niżej ma logowanie wbudowane i nie należy go z niej usuwać.

---

## Czego potrzeba

| | |
|---|---|
| Docker + Docker Compose | wersja Docker |
| Konto DataForSEO | **to samo, którego używa Content AI** — jedno konto, jeden rachunek |
| Domena albo Tailscale | żeby dostać się z zewnątrz |
| ~1 GB RAM | pojedynczy kontener |

**Bazy danych nie trzeba stawiać.** OpenSEO w wersji Docker trzyma dane w wolumenie
Dockera (`open_seo_data`), bez osobnego Postgresa.

---

## Instalacja

```bash
# 1. Docker, jeśli jeszcze go nie ma
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

# 2. Kod OpenSEO
sudo git clone https://github.com/every-app/open-seo.git /srv/openseo
cd /srv/openseo
sudo cp .env.example .env
```

### Klucz DataForSEO

OpenSEO oczekuje **jednej zmiennej w formacie base64 z `email:hasło`** — inaczej niż
Content AI, który bierze login i hasło osobno. To te same dane logowania do DataForSEO.

```bash
# podmień na swoje dane z dataforseo.com
echo -n 'twoj@email.pl:twoje-haslo-dataforseo' | base64
```

Wynik wklej do `/srv/openseo/.env`:

```
DATAFORSEO_API_KEY=dHdvakBlbWFpbC5wbDp0d29qZS1oYXNsbw==
PORT=3001
ALLOWED_HOST=seo.twojadomena.pl
OPENSEO_TELEMETRY_DISABLED=1
```

`ALLOWED_HOST` jest wymagany, gdy aplikacja stoi za reverse proxy — bez niego Vite odrzuci
żądania z obcym nagłówkiem `Host`.

`OPENSEO_TELEMETRY_DISABLED=1` wyłącza telemetrię, która domyślnie jest włączona.

### Start

```bash
cd /srv/openseo
sudo docker compose up -d
sudo docker compose logs -f     # Ctrl+C wychodzi z podglądu, kontener działa dalej
```

Sprawdzenie, że wstało (port jest tylko lokalny, więc pytamy z serwera):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001
```

---

## Caddy — HTTPS **i logowanie**

Dopisz do `/etc/caddy/Caddyfile` obok wpisu Content AI:

```
seo.twojadomena.pl {
    # OpenSEO w wersji Docker nie ma wlasnego logowania - to jest jedyna oslona.
    # NIE usuwaj tego bloku, dopoki aplikacja nie dostanie wlasnego uwierzytelniania.
    basic_auth {
        marcin WKLEJ_HASH_Z_CADDY_HASH_PASSWORD
    }
    reverse_proxy 127.0.0.1:3001
}
```

Hash hasła:

```bash
caddy version           # sprawdz wersje
caddy hash-password     # wygeneruj hash
sudo systemctl reload caddy
```

Dyrektywa nazywa się `basic_auth` od **Caddy 2.8**; w starszych wersjach to `basicauth`.
Jeśli Caddy odmówi startu z komunikatem o nierozpoznanej dyrektywie, użyj drugiej nazwy.

Wcześniej ustaw w DNS rekord A `seo.twojadomena.pl` → IP serwera.

**Alternatywa bez hasła w Caddy:** wpuść ruch wyłącznie przez Tailscale, tak jak Cosmos.
Wtedy `basicauth` nie jest potrzebny, bo do adresu nie da się dostać z internetu.

---

## Utrzymanie

```bash
cd /srv/openseo
sudo docker compose pull && sudo docker compose up -d    # aktualizacja
sudo docker compose logs -f                              # log
sudo docker compose down                                 # zatrzymanie
sudo docker compose ps                                   # stan
```

Dane siedzą w wolumenie `open_seo_data`. `docker compose down` ich nie kasuje;
kasuje je dopiero `docker compose down -v` — tego polecenia używaj świadomie.

Kopia zapasowa:

```bash
sudo docker run --rm -v open_seo_data:/dane -v /srv/kopie:/kopie alpine \
  tar czf /kopie/openseo-$(date +%F).tar.gz -C /dane .
```

---

## Jak to się ma do Content AI

Obie aplikacje korzystają z **tego samego konta DataForSEO**, więc zapytania z obu miejsc
schodzą z jednego salda.

| | Content AI | OpenSEO |
|---|---|---|
| Do czego | pisanie treści pod SEO/AIO/AEO/GEO | analiza SEO: pozycje, backlinki, audyty |
| Dane SERP | `CAI_SERP=dataforseo` — prosto z API | pełny interfejs nad tymi danymi |
| Logowanie | konta z rolami, wbudowane | brak w wersji Docker — osłania Caddy |
| Port | 3100 | 3001 |

Content AI **nie woła OpenSEO** i nie jest od niego zależny. Po dane SERP idzie prosto
do DataForSEO, bo przechodzenie przez OpenSEO oznaczałoby dodatkową warstwę po to,
żeby dostać te same dane z tego samego źródła.

OpenSEO wystawia serwer MCP dla agentów AI (Claude Code i podobne) — to naturalna ścieżka,
gdyby kiedyś sięgać do jego danych programowo, ale dziś nic z niej nie korzysta.

---

## Czego nie sprawdziłem

Wdrożenia nie dało się przetestować w środowisku, w którym powstawała ta instrukcja —
nie ma tam Dockera ani konta DataForSEO. Zweryfikowane są **fakty z repozytorium OpenSEO**:
nazwa pliku `compose.yaml`, powiązanie portu z `127.0.0.1`, wolumen `open_seo_data`, brak
osobnej usługi bazy danych, nazwy zmiennych i domyślny `AUTH_MODE=local_noauth`.

Same polecenia uruchom u siebie i obserwuj `docker compose logs -f` przy pierwszym starcie.
