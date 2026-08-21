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

Sesja siedzi w **podpisanym ciasteczku**, nie w pamięci procesu — restart usługi,
a więc każda aktualizacja, nie wylogowuje zespołu.

W ciasteczku jest jawny opis sesji (login, rola, wygaśnięcie, losowy identyfikator)
plus HMAC-SHA256 z sekretu serwera. Podmiana czegokolwiek psuje podpis. Treść nie jest
tajna i nie musi być — nie ma w niej nic, czego użytkownik by o sobie nie wiedział.

Sekret bierze się z `CAI_SEKRET_SESJI`, a bez niego jest losowany raz i zapisywany
do `serwer/dane/sekret` (uprawnienia `600`). Skasowanie tego pliku wylogowuje wszystkich.

Ceną za brak stanu jest to, że samo wygaśnięcie nie odbiera dostępu natychmiast.
Dlatego są cztery drogi unieważnienia, wszystkie działające **bez restartu**:

| Zdarzenie | Co się dzieje |
|---|---|
| `uzytkownicy.js usun` | weryfikacja szuka konta w pliku — brak konta to koniec dostępu |
| `uzytkownicy.js haslo` | znacznik `sesjeOd` odcina wszystkie sesje wydane wcześniej |
| `uzytkownicy.js rola` | rola czytana z pliku przy każdym żądaniu — degradacja działa od razu |
| wylogowanie użytkownika | identyfikator trafia do `serwer/dane/wylogowane.json` |

Ostatni plik sam się sprząta: wpisy po terminie wypadają przy kolejnym zapisie.

---

## Konfiguracja

Wszystko przez zmienne środowiskowe.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `PORT` | `3100` | port nasłuchu |
| `CAI_HOST` | `127.0.0.1` | interfejs; zostaw lokalny, ruch z zewnątrz puszcza Caddy |
| `CAI_UZYTKOWNICY` | `serwer/dane/uzytkownicy.json` | plik z kontami |
| `CAI_COOKIE_SECURE` | `1` | `0` **tylko** do testów lokalnych bez HTTPS |
| `CAI_SESJA_GODZIN` | `336` (14 dni) | ważność sesji |
| `CAI_SEKRET_SESJI` | losowany i zapisywany | sekret do podpisu ciasteczek |
| `CAI_ZAUFANY_NAGLOWEK` | — | nagłówek z loginem z bramy, np. `Remote-User` |
| `CAI_ZAUFANE_ADRESY` | pętla zwrotna | adresy, z których wolno przyjąć ten nagłówek |
| `CAI_DOSTAWCA` | `anthropic` | `anthropic` albo `nvidia` |
| `CAI_MODEL_NVIDIA` | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | model przy `nvidia` |
| `CAI_URL_NVIDIA` | `https://integrate.api.nvidia.com/v1/chat/completions` | endpoint NIM |
| `ANTHROPIC_KEY` | — | klucz treści (dostawca `anthropic`) |
| `NVIDIA_KEY` | — | klucz treści (dostawca `nvidia`) |
| `OPENAI_KEY` | — | grafiki, TTS, transkrypcja |
| `ELEVEN_KEY` | — | głos premium |
| `CAI_SERP` | `model` | źródło danych SERP: `model`, `dataforseo` albo `openseo` |
| `CAI_SEO_PROJEKT` | — | id projektu OpenSEO (wymagane przy `CAI_SERP=openseo`) |
| `DATAFORSEO_LOGIN` | — | login DataForSEO (przy `CAI_SERP=dataforseo`) |
| `DATAFORSEO_HASLO` | — | hasło DataForSEO |
| `CAI_BAZA` | `serwer/dane/baza` | katalog bazy wiedzy |
| `CAI_UZYCIE` | `serwer/dane/uzycie` | katalog liczników pakietów |
| `CAI_MODEL_EMBED` | `nvidia/nv-embedqa-e5-v5` | model wektorów |
| `CAI_URL_EMBED` | `https://integrate.api.nvidia.com/v1/embeddings` | endpoint wektorów |
| `CAI_COOKIE_DOMENA` | — | domena ciasteczka sesji, np. `.twojadomena.pl` |
| `CAI_OPENSEO_PORT` | — | port bramy OpenSEO; puste = brama wyłączona |
| `CAI_OPENSEO_UPSTREAM` | `3001` | port kontenera OpenSEO |
| `CAI_OPENSEO_HOST` | `127.0.0.1` | host kontenera OpenSEO |
| `CAI_OPENSEO_ADRES` | — | publiczny adres OpenSEO — dokłada pozycję w menu |

### Klucze mieszane

Klucz serwera jest domyślny. Jeśli użytkownik poda **własny** klucz, serwer użyje jego
zamiast serwerowego — aplikacja wysyła go w nagłówku `x-api-key` (oraz `x-openai-key`,
`x-eleven-key`). Pusty nagłówek, który aplikacja wysyła w trybie proxy, jest ignorowany
i wraca klucz serwera. Nie wymaga to żadnej zmiany w aplikacji.

### Baza wiedzy (RAG)

Dwa zakresy:

| Zakres | Kto widzi | Kto dodaje |
|---|---|---|
| **prywatna** | tylko właściciel | każdy zalogowany, w swojej |
| **wspólna** | wszyscy | **wyłącznie admin** |

Dokumenty leżą na serwerze (`serwer/dane/baza/`), więc chodzą za użytkownikiem na każde
urządzenie — inaczej niż dotąd, gdy siedziały w `localStorage` przeglądarki.

**Dlaczego to ważne.** Aplikacja wklejała do promptu **całą treść** każdego zaznaczonego
dokumentu. Koszt rósł liniowo z wielkością bazy, przy większej bazie kończył się kontekst,
a trafne fragmenty tonęły w szumie. Teraz tekst jest dzielony na fragmenty po 1500 znaków,
każdy dostaje wektor, a przy generowaniu dobieranych jest tylko kilka najtrafniejszych.

To odwzorowanie rozwiązania z Cosmosa. Różnica jedna: Cosmos liczy wektory lokalnie na GPU
(usługa `senses`, model bge-m3), a tu VPS nie ma karty — więc liczy je API NVIDIA, gdzie
bge-m3 też jest dostępny. Klucz to ten sam `NVIDIA_KEY`.

**Bez klucza to nadal działa**, tylko gorzej: wyszukiwanie schodzi na dopasowanie słów
kluczowych, dokładnie jak awaryjna ścieżka w Cosmosie. Pole `metoda` w odpowiedzi mówi,
która ścieżka zadziałała.

| Endpoint | Do czego |
|---|---|
| `GET /api/baza` | lista dokumentów (wspólne + własne prywatne) |
| `POST /api/baza` | dodanie; `zakres: "wspolna"` wymaga roli admin |
| `POST /api/baza/usun` | usunięcie |
| `POST /api/baza/szukaj` | najtrafniejsze fragmenty + gotowy blok do promptu |

**W aplikacji** (tylko wariant `proxy` — pozostałe nie mają serwera): menu ustawień →
**Baza wiedzy**. Lista łączy oba zakresy, 🌐 to wspólny, 🔒 prywatny; wybór zakresu przy
dodawaniu pokazuje się wyłącznie adminowi.

Przy generowaniu aplikacja woła `/api/baza/szukaj` i wstawia zwrócony blok do promptu —
bez zaznaczania czegokolwiek przez użytkownika. Dawna baza w `localStorage` działa dalej
i dokłada się do tego samego promptu, więc aktualizacja nie zabiera nikomu jego dokumentów.

### Dane SERP

Aplikacja przed generowaniem może sprawdzić, co rankuje w Google. Domyślnie (`CAI_SERP=model`)
robi to, prosząc model o wyszukanie — narzędziem `web_search`, które **istnieje tylko
u Anthropic**. Ma to dwie konsekwencje:

- dane są **szacowane przez model**, a nie mierzone,
- przy `CAI_DOSTAWCA=nvidia` narzędzia nie ma, więc serwer zwraca **HTTP 501 z jasnym
  komunikatem** zamiast pozwolić modelowi zmyślić wyniki i podać je dalej jako fakty.

`CAI_SERP=dataforseo` bierze dane z API DataForSEO — realne wyniki organiczne, niezależnie
od dostawcy modelu. To **to samo źródło, z którego korzysta OpenSEO**.

```
CAI_SERP=dataforseo
DATAFORSEO_LOGIN=twoj@email.pl
DATAFORSEO_HASLO=...
```

Zwracane `avgWords` i `avgH2` to zera — ten endpoint DataForSEO nie podaje długości treści
konkurencji, a zero jest uczciwsze niż zmyślona liczba. Aplikacja traktuje je jako brak danych.

DataForSEO jest płatne za zapytanie. Konto zakładasz na dataforseo.com.

### Brama OpenSEO

Podanie `CAI_OPENSEO_PORT` otwiera **drugi port**, na którym ten sam proces stoi przed
kontenerem OpenSEO. Robi dwie rzeczy: wpuszcza wyłącznie zalogowanych do Content AI
i dokleja do stron `app/openseo-motyw.css`, czyli paletę Content AI.

```
CAI_OPENSEO_PORT=3110
CAI_OPENSEO_ADRES=https://seo.twojadomena.pl
CAI_COOKIE_DOMENA=.twojadomena.pl
```

Caddy kieruje `seo.twojadomena.pl` na **3110**, nigdy na 3001 — 3001 to goły kontener,
który startuje z `AUTH_MODE=local_noauth`, czyli bez żadnego logowania.

`CAI_COOKIE_DOMENA` sprawia, że jedna sesja obejmuje obie poddomeny. Bez tego wszystko
działa, tylko logujesz się osobno na każdej. Zmiana tej wartości unieważnia bieżące
ciasteczka — po restarcie wszyscy logują się ponownie.

Token sesji Content AI jest **wycinany** z nagłówka `Cookie` przed przekazaniem żądania
do kontenera — obca aplikacja go nie widzi.

### Pakiety i limity

Trzy pakiety w `serwer/plany.js`. To **tabela danych**, nie kod: zmiana „3 artykuły"
na „5" albo dołożenie grafik do standardu to edycja jednej linii.

| | Darmowy | Standard | Premium |
|---|---|---|---|
| Artykuły | 3 (bez odnawiania) | 50/mies. | bez limitu |
| Grafiki | — | 50/mies. | bez limitu |
| Audio, transkrypcja | — | 20/mies. | bez limitu |
| Wywołania modelu (sufit) | 30 | 750/mies. | bez limitu |
| Dokumenty w bazie | 3 | 50 | bez limitu |
| Analiza SERP | — | tak | tak |
| Dane z OpenSEO | — | — | tak |
| Własny klucz API, CMS | — | tak | tak |

```bash
node serwer/uzytkownicy.js plan anna standard
```

Konto bez wpisanego planu dostaje darmowy. **Admin zawsze działa jak premium**, niezależnie
od wpisu — inaczej właściciel systemu mógłby sobie zablokować własne narzędzie.

Dwie rzeczy warte uwagi przy zmianach:

- **Limit** dotyczy rzeczy liczonych na sztuki (artykuły, grafiki). **Bramka** dotyczy całych
  funkcji (SERP, OpenSEO) — albo je masz, albo nie. Mieszanie tego w jednym mechanizmie
  kończy się zwykle tym, że nie wiadomo, dlaczego komuś coś nie działa.
- Zliczanie następuje **po udanej odpowiedzi dostawcy**. Gdy generowanie padnie na błędzie
  API, użytkownik nie traci sztuki z pakietu — dostał przecież nic.

#### Artykuł to nie to samo co wywołanie modelu

Jedno generowanie artykułu to kilka wywołań: brief, treść, korekta premium, uzupełnianie
luk, przeróbki fragmentów. Gdyby każde liczyło się jako artykuł, pakiet darmowy skończyłby
się w połowie pierwszego tekstu.

Dlatego artykuł liczy się **tylko wtedy, gdy aplikacja się o to zgłosi** — nagłówkiem
`x-cai-czynnosc: artykul`, wysyłanym z jedynego miejsca, które faktycznie generuje treść.
Wszystkie pozostałe wywołania idą na osobny licznik `wywolanie`.

Deklaracja przychodzi z przeglądarki, więc nie jest dowodem — i nie musi nim być. Licznik
wywołań jest **sufitem kosztu**: konto, które nigdy nie przyzna się do artykułu, i tak ma
skończoną pulę. To nie zamek, tylko granica wydatku.

Nagłówek istnieje wyłącznie w wariancie `proxy`. W wariantach łączących się prosto
z `api.anthropic.com` własny nagłówek wywołałby preflight CORS i zablokował generowanie —
pilnuje tego kontrola `U/artykul` w `narzedzia/sprawdz_zrodlo.py`.

Przekroczenie limitu to **HTTP 402** z opisem: plan, limit, zużycie i to, czy licznik się
kiedykolwiek odnowi. Aplikacja przechwytuje to w jednym miejscu (opakowany `fetch`) i
pokazuje okno pakietu z paskami zużycia, zamiast ogólnego błędu API.

| Endpoint | Do czego |
|---|---|
| `GET /api/pakiet` | własny pakiet: limity, zużycie, dostępne funkcje, nazwa i opis PL/EN |

Liczniki leżą w `serwer/dane/uzycie/` — jeden plik JSON na konto. Miesięczne okresy starsze
niż rok wypadają przy kolejnym zapisie, żeby plik nie puchł.

### Logowanie przez bramę

Ustawienie `CAI_ZAUFANY_NAGLOWEK` przełącza serwer w tryb, w którym uwierzytelnia
**zewnętrzna brama** (Authelia i pokrewne), a my czytamy z nagłówka sam login.
Wtedy 2FA, passkeys i SSO robi ona.

```
CAI_ZAUFANY_NAGLOWEK=Remote-User
```

Serwer przyjmuje ten nagłówek **wyłącznie z zaufanego adresu** — domyślnie z pętli
zwrotnej. Bez tego warunku każdy, kto dosięgnie portu z pominięciem bramy, zostaje
adminem przez dopisanie jednego nagłówka. Dlatego w tym trybie port nie może być
wystawiony na świat; `CAI_HOST` zostaje na `127.0.0.1`.

Własny ekran logowania jest wtedy wyłączony (`POST /auth/login` → 404), żeby nie
tworzyć drugiej drogi wejścia omijającej drugi składnik. Role nadal czytamy
z pliku kont — konto musi istnieć po obu stronach.

Wdrożenie z gotowymi plikami konfiguracyjnymi: **`brama/README.md`**.

### Dane z OpenSEO (`/api/seo/*`)

Content AI pyta OpenSEO o jego dane przez serwer MCP kontenera (`serwer/openseo-mcp.js`).
W trybie `local_noauth` ten endpoint nie wymaga tokenu, a ruch idzie po pętli zwrotnej.

| Endpoint | Do czego | Koszt |
|---|---|---|
| `GET /api/seo/projekty` | lista projektów | **0** |
| `GET /api/seo/frazy` | zapisane frazy z metrykami i tagami | **0** |
| `POST /api/seo/frazy` | oddanie fraz z tagiem (domyślnie `content-ai`) | **0** |
| `GET /api/seo/okazje` | strony na pozycjach 4–20 (wymaga GSC + GA4) | **0** |
| `POST /api/seo/badaj` | badanie nowych fraz | **płatne** |

Zero oznacza tu dosłownie zero: te narzędzia czytają bazę OpenSEO i nie wołają DataForSEO.
Płatne narzędzie odmówi wywołania bez jawnego `potwierdzam: true` i zapisze do logu login
osoby, która je uruchomiła — wydatek ma mieć właściciela.

Szczegóły, uzasadnienie wyborów i wdrożenie: **`openseo/README.md`**.

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
- pliki statyczne tylko z listy dozwolonych: `manifest.json`, `icons/*`, `pwa/lib/*.js`
  i `pwa/fonty/*.woff2` — reszta katalogu jest niedostępna, próby wyjścia poza katalog
  kończą się 404
- aplikacja nie pobiera niczego z obcych serwerów: biblioteki (mammoth, pdf.js, pdfmake,
  xlsx, html-docx-js) i krój IBM Plex leżą w repozytorium i idą z Twojego hosta
- szczegóły błędów dostawcy trafiają do logu serwera, nie do przeglądarki

Czego **nie** robi — i o czym trzeba wiedzieć:

- **brak 2FA we własnym logowaniu** — drugi składnik daje dopiero brama, patrz `brama/README.md`
- brak resetu hasła przez e-mail — hasło zmienia admin poleceniem
- licznik prób logowania jest w pamięci i per IP; za wspólnym NAT-em zablokuje wszystkich
  z tego adresu naraz
- serwer ufa nagłówkowi `X-Forwarded-For` — ma sens **tylko** za własnym Caddy/nginx;
  nie wystawiaj go bezpośrednio na świat
