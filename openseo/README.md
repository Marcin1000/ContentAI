# OpenSEO obok Content AI

[OpenSEO](https://github.com/every-app/open-seo) to otwartoźródłowa alternatywa dla Semrusha
i Ahrefsa: badanie fraz, monitoring pozycji, analiza konkurencji, backlinki, audyty stron
i widoczność w AI. Licencja MIT.

Kod OpenSEO jest **osobny** i tak zostaje - nie forkujemy go i nie budujemy własnego obrazu.
Dla użytkownika ma to jednak wyglądać jak jedna aplikacja, więc Content AI staje przed
OpenSEO jako **brama**: jedno logowanie i ta sama paleta barw.

> Ten katalog zawiera wyłącznie konfigurację i instrukcję wdrożenia po naszej stronie.
> Kod OpenSEO mieszka w swoim repozytorium i stamtąd się aktualizuje.

---

## Jak to jest poskładane

```
przeglądarka ──HTTPS──► Caddy ──► brama Content AI ──► kontener OpenSEO
   seo.twojadomena.pl              (port 3110)            (port 3001)
                                        │
                                        ├── wpuszcza tylko zalogowanych
                                        └── dokleja paletę Content AI
```

**Brama to `serwer/openseo.js`** - ten sam proces Node, który obsługuje Content AI, tylko
nasłuchujący na drugim porcie. Robi dokładnie dwie rzeczy i nic ponadto.

### 1. Jedno logowanie

Wersja Docker OpenSEO startuje z `AUTH_MODE=local_noauth` - **aplikacja nie ma żadnego
logowania**. Dokumentacja OpenSEO mówi wprost, że wystawienie jej na świat wymaga własnego
„auth-protected reverse proxy, tunnel, or private network".

Co to znaczy praktycznie: gdybyś podpiął domenę wprost pod port 3001, **każdy, kto trafi
na adres, dostałby pełny dostęp** - zobaczyłby Twoje dane i wypalał Twoje kredyty DataForSEO,
za które płacisz od zapytania.

Bramę przechodzą wyłącznie osoby zalogowane do Content AI - **tym samym kontem**, bez drugiego
hasła. Kto nie ma sesji, dostaje ekran logowania Content AI, a żądanie w ogóle nie dociera
do kontenera. Odebranie komuś konta odcina go od obu aplikacji naraz.

Warunek: obie poddomeny muszą należeć do tej samej domeny, a serwer musi mieć ustawione
`CAI_COOKIE_DOMENA` (np. `.twojadomena.pl`). Bez tego wszystko działa, tylko logujesz się
osobno na każdej poddomenie.

### 2. Ta sama paleta

Do każdej strony brama dokleja `app/openseo-motyw.css` - barwy, promienie i krój pisma
Content AI. OpenSEO stoi na daisyUI, a daisyUI bierze kolory ze **zmiennych CSS**, więc
przemalowanie to podmiana ~25 zmiennych, a nie grzebanie w ich komponentach.

To jest powód, dla którego przeżyje `docker compose pull`: zaczepiamy się o kontrakt
zmiennych daisyUI, a nie o nazwy klas OpenSEO, które mogą się zmienić w każdej wersji.

Jasny/ciemny idzie za przełącznikiem w Content AI (ciasteczko `cai_motyw`). Gdy ciasteczka
nie ma, OpenSEO idzie za ustawieniem systemu - nadal spójnie, tylko bez synchronizacji.

**Czego brama nie robi:** nie zmienia układu ekranów, nie tłumaczy interfejsu i nie dodaje
funkcji. OpenSEO zostaje OpenSEO - po prostu w barwach Content AI.

---

## Zależność funkcjonalna: frazy krążą między aplikacjami

Poza wyglądem i logowaniem obie aplikacje **wymieniają dane**. Zamysł jest jeden:

> OpenSEO wie, **co warto napisać**. Content AI to **pisze**. Po napisaniu frazy wracają
> do OpenSEO, żeby dało się śledzić ich pozycje.

```
OpenSEO                          Content AI
──────────────────────────────   ──────────────────────────────
człowiek bada i taguje frazy
        │
        └──► zapisane frazy ────► 📈 przy polu „Słowa kluczowe"
                                          │
                                  artykuł powstaje na tych frazach
                                          │
        ◄──── tag content-ai ◄────────────┘
   rank tracking śledzi pozycje
```

**W aplikacji:** w formularzu artykułu, obok pola „Słowa kluczowe", pojawia się przycisk 📈.
Otwiera listę fraz zapisanych w projekcie OpenSEO - z wolumenem, trudnością i tagami.
Zaznaczasz, klikasz „Dodaj zaznaczone" i lądują w polu fraz. W tym samym oknie jest ruch
powrotny: „Oddaj frazy tego artykułu do OpenSEO" zapisuje je z tagiem `content-ai`.

Przycisk pokazuje się tylko wtedy, gdy OpenSEO faktycznie odpowiada.

### Skąd te dane - i ile kosztują

Content AI rozmawia z OpenSEO przez jego **serwer MCP** (`/mcp` w kontenerze). W trybie
Docker (`AUTH_MODE=local_noauth`) ten endpoint nie wymaga tokenu, a my pukamy po pętli
zwrotnej, więc nie trzeba nic dodatkowo konfigurować.

**Podział kosztów jest tu najważniejszy.** Część narzędzi OpenSEO czyta tylko jego własną
bazę i nie kosztuje nic. Część woła DataForSEO i jest płatna za zapytanie - z tego samego
salda, którego używa Content AI.

| Co robi aplikacja | Endpoint | Koszt |
|---|---|---|
| lista projektów | `GET /api/seo/projekty` | **0** |
| zapisane frazy z metrykami | `GET /api/seo/frazy` | **0** |
| oddanie fraz z tagiem | `POST /api/seo/frazy` | **0** |
| strony blisko czołówki (poz. 4-20) | `GET /api/seo/okazje` | **0** |
| badanie nowych fraz | `POST /api/seo/badaj` | **płatne** |

Wywołanie płatnego narzędzia wymaga jawnego `potwierdzam: true` i trafia do logu razem
z loginem osoby, która je uruchomiła. Okno fraz w aplikacji celowo **nie ma** badania -
robi się je w OpenSEO, gdzie widać koszt zapytania.

`GET /api/seo/okazje` wymaga podłączonego Search Console i GA4 po stronie OpenSEO. Bez
nich zwraca błąd z komunikatem, a nie puste dane.

### Brief bierze frazy z OpenSEO

Przy generowaniu Briefu aplikacja pyta OpenSEO o zapisane frazy pasujące do tematu i **stawia
je przed propozycjami modelu**. Zweryfikowane mają obramowanie w kolorze akcentu i wolumen
obok nazwy.

Kolejność jest tu całą treścią pomysłu: fraza z OpenSEO przeszła przez badanie i przez czyjąś
decyzję o otagowaniu, więc jest **faktem**. Propozycja modelu to **domysł**. Gdy ta sama fraza
jest po obu stronach, liczy się raz - po stronie zweryfikowanej.

Projekt dobierany jest automatycznie: `CAI_SEO_PROJEKT`, a bez niego pierwszy z listy. Przy
jednym projekcie - a tak zaczyna każdy - nie ma czego wybierać, więc pytanie o to byłoby
pustym krokiem.

Gdy OpenSEO nie odpowiada, Brief wygląda dokładnie jak dotąd.

### SERP przez OpenSEO

Trzecie źródło danych SERP dla Content AI:

```
CAI_SERP=openseo
CAI_SEO_PROJEKT=<id projektu z OpenSEO>
```

To te same dane DataForSEO co przy `CAI_SERP=dataforseo` (i tak samo płatne), ale zapytanie
idzie przez kontener, więc wynik widać też w panelu OpenSEO. Id projektu odczytasz
z `GET /api/seo/projekty` albo z adresu w panelu.

---

## Czego potrzeba

| | |
|---|---|
| Docker + Docker Compose | wersja Docker |
| Konto DataForSEO | **to samo, którego używa Content AI** - jedno konto, jeden rachunek |
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

OpenSEO oczekuje **jednej zmiennej w formacie base64 z `email:hasło`** - inaczej niż
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

`ALLOWED_HOST` jest wymagany, gdy aplikacja stoi za reverse proxy - bez niego Vite odrzuci
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

## Włączenie bramy

W `/etc/contentai/srodowisko` (to plik **Content AI**, nie OpenSEO):

```
CAI_OPENSEO_PORT=3110
CAI_OPENSEO_UPSTREAM=3001
CAI_OPENSEO_ADRES=https://seo.twojadomena.pl
CAI_COOKIE_DOMENA=.twojadomena.pl
```

```bash
sudo systemctl restart contentai
```

W logu powinny być dwa nasłuchy:

```bash
sudo journalctl -u contentai -n 20
#   Content AI: http://127.0.0.1:3100
#   OpenSEO za logowaniem: http://127.0.0.1:3110
```

`CAI_OPENSEO_ADRES` dokłada pozycję **OpenSEO** w menu ustawień Content AI. Bez tej zmiennej
brama działa tak samo, tylko w menu nie ma skrótu.

Zmiana `CAI_COOKIE_DOMENA` unieważnia bieżące ciasteczka - po pierwszym restarcie wszyscy
logują się ponownie. Później już nie.

---

## Caddy - HTTPS

Dopisz do `/etc/caddy/Caddyfile` obok wpisu Content AI (pełny wzór: `Caddyfile.przyklad`):

```
seo.twojadomena.pl {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3110
}
```

```bash
sudo systemctl reload caddy
```

**Port 3110, nie 3001.** 3001 to goły kontener bez logowania; 3110 to brama. To jedyne
miejsce, w którym łatwo zrobić sobie krzywdę - wpisanie tam 3001 wystawia OpenSEO na świat
bez żadnej ochrony.

`encode` nie jest ozdobnikiem: brama oddaje treść nieskompresowaną, bo musi widzieć HTML,
żeby dokleić motyw. Kompresję do przeglądarki robi Caddy.

Wcześniej ustaw w DNS rekord A `seo.twojadomena.pl` → IP serwera.

**Alternatywa:** wpuść ruch wyłącznie przez Tailscale, tak jak Cosmos. Brama i tak zostaje -
logowanie Content AI działa niezależnie od tego, którędy przyszedł ruch.

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
kasuje je dopiero `docker compose down -v` - tego polecenia używaj świadomie.

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
| Dane SERP | `CAI_SERP=dataforseo` - prosto z API | pełny interfejs nad tymi danymi |
| Logowanie | konta z rolami, wbudowane | to samo konto, przez bramę |
| Wygląd | paleta Content AI | ta sama paleta, doklejana przez bramę |
| Port | 3100 | 3110 (brama) → 3001 (kontener) |

Content AI **nie woła OpenSEO** i nie jest od niego zależny - poza bramą, która tylko
przepuszcza ruch. Po dane SERP Content AI idzie prosto do DataForSEO, bo przechodzenie
przez OpenSEO oznaczałoby dodatkową warstwę po to, żeby dostać te same dane z tego
samego źródła.

Gdy kontener nie działa, Content AI działa dalej bez zmian - brama pokazuje wtedy stronę
z podpowiedzią, co sprawdzić.

OpenSEO wystawia serwer MCP dla agentów AI (Claude Code i podobne) - to naturalna ścieżka,
gdyby kiedyś sięgać do jego danych programowo, ale dziś nic z niej nie korzysta.

---

## Co jest sprawdzone, a co nie

**Sprawdzone automatycznie** (`node serwer/testy.js`, 34 testy samej bramy): odmowa bez
sesji i to, że żądanie nie dociera wtedy do kontenera; doklejanie motywu przed `</head>`;
przeliczanie długości treści; przepuszczanie zasobów bez zmian; odcinanie nagłówków
hop-by-hop; to, że token sesji Content AI **nie wycieka** do OpenSEO; zachowanie nagłówka
`Host` (wymaga tego `ALLOWED_HOST`); strona 502, gdy kontener nie odpowiada.

**Sprawdzone w przeglądarce:** paleta na prawdziwym daisyUI 5.7.19 - komponenty `btn`,
`input`, `select`, `badge`, karty i tabele w wersji jasnej i ciemnej.

**Niesprawdzone:** samo wdrożenie Dockera. W środowisku, w którym powstawała ta instrukcja,
nie ma demona Dockera ani konta DataForSEO, więc bramę testowałem wobec atrapy mówiącej tym
samym protokołem, a nie wobec żywego OpenSEO. Zweryfikowane są **fakty z repozytorium
OpenSEO**: nazwa pliku `compose.yaml`, powiązanie portu z `127.0.0.1`, wolumen
`open_seo_data`, brak osobnej usługi bazy danych, nazwy zmiennych, domyślny
`AUTH_MODE=local_noauth` oraz to, że motywy są zbudowane na zmiennych daisyUI.

Same polecenia uruchom u siebie i obserwuj `docker compose logs -f` przy pierwszym starcie.
Przy pierwszym wejściu na `seo.twojadomena.pl` sprawdź dwie rzeczy: że w trybie incognito
dostajesz ekran logowania, i że po zalogowaniu strona jest w barwach Content AI.
