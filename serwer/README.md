# Content AI - serwer

Serwuje aplikację, pilnuje logowania i pośredniczy w wywołaniach API, dzięki czemu
klucze nigdy nie trafiają do przeglądarki.

**Zero zależności npm** - wyłącznie moduły wbudowane Node ≥ 18. Nie ma `npm install`.

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
| `POST /api/zadanie/anuluj` | przerwanie zadania w tle (`{"id": "..."}`) - przycisk Przerwij |
| `GET /api/status` | stan serwera - **tylko rola admin** |
| `GET /api/marka` | konfiguracja marki; zapis `POST` **tylko rola admin** |
| `POST /auth/login`, `GET /auth/logout`, `GET /auth/me` | logowanie |

Wszystko poza logowaniem wymaga aktywnej sesji.

### Zadania w tle (telefon w tle, zerwane połączenie)

Aplikacja wysyła przy każdym wywołaniu dostawcy (`/api`, `/api/images`, `/api/tts`,
`/api/eleven-tts`, `/api/transcribe`) nagłówek `X-Zadanie` z losowym identyfikatorem.
Serwer prowadzi takie wywołanie do końca, nawet gdy przeglądarka zerwie połączenie
(przełączenie aplikacji na telefonie, wygaszony ekran), i trzyma wynik przez 15 minut
(`serwer/zadania.js`, do 8 zadań na konto). Aplikacja po powrocie ponawia to samo zadanie
i dostaje gotową odpowiedź: bez drugiego wywołania dostawcy i bez drugiego liczenia do
pakietu. Identyfikator jest przypisany do konta, więc inne konto go nie odczyta.
Przerwij w aplikacji woła `POST /api/zadanie/anuluj`, co kończy wywołanie dostawcy
i nie liczy się do pakietu. Wywołanie bez nagłówka działa jak dawniej (zerwanie
przerywa dostawcę).

---

## Konta i role

Konta trzyma `serwer/dane/uzytkownicy.json` (uprawnienia `0600`, wykluczony z repo).
Hasła są haszowane **scryptem** z losową solą - nigdzie nie ma hasła jawnego.

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
node serwer/uzytkownicy.js prosby 20               # ostatnie prośby o dostęp ze strony
```

Hasło ma minimum 10 znaków. Login: 2-40 znaków, małe litery `a-z`, cyfry, kropka,
podkreślnik i myślnik (baza wiedzy i liczniki trzymają login w nazwie pliku, więc dwa
różne loginy nie mogą dać tej samej nazwy). Ostatniego admina nie da się usunąć ani
zdegradować. `usun` kasuje razem z kontem jego prywatną bazę wiedzy i liczniki
użycia (dane marki są wspólne dla zespołu i zostają) i wypisuje, które pliki usunął.
Katalogi danych bierze ze środowiska powłoki: jeśli w `/etc/contentai/srodowisko`
ustawiono `CAI_BAZA` albo `CAI_UZYCIE`, uruchamiaj polecenie z tymi samymi zmiennymi
(`set -a; . /etc/contentai/srodowisko; set +a`), inaczej usunie pliki z katalogów domyślnych.

Ekran logowania jest w barwach marki, po polsku albo angielsku (wg `Accept-Language`,
przełącznik `?lang=en|pl`), w jasnym lub ciemnym motywie wg systemu, bez skryptów i bez
zasobów z obcych serwerów (kroje z `app/pwa/fonty/`). Logowanie zawsze liczy scrypt,
także dla nieistniejącego loginu, więc po czasie odpowiedzi nie da się rozpoznać,
które loginy istnieją.

Sesja siedzi w **podpisanym ciasteczku**, nie w pamięci procesu - restart usługi,
a więc każda aktualizacja, nie wylogowuje zespołu.

W ciasteczku jest jawny opis sesji (login, rola, wygaśnięcie, losowy identyfikator)
plus HMAC-SHA256 z sekretu serwera. Podmiana czegokolwiek psuje podpis. Treść nie jest
tajna i nie musi być - nie ma w niej nic, czego użytkownik by o sobie nie wiedział.

Sekret bierze się z `CAI_SEKRET_SESJI`, a bez niego jest losowany raz i zapisywany
do `serwer/dane/sekret` (uprawnienia `600`). Skasowanie tego pliku wylogowuje wszystkich.

Ceną za brak stanu jest to, że samo wygaśnięcie nie odbiera dostępu natychmiast.
Dlatego są cztery drogi unieważnienia, wszystkie działające **bez restartu**:

| Zdarzenie | Co się dzieje |
|---|---|
| `uzytkownicy.js usun` | weryfikacja szuka konta w pliku - brak konta to koniec dostępu |
| `uzytkownicy.js haslo` | znacznik `sesjeOd` odcina wszystkie sesje wydane wcześniej |
| `uzytkownicy.js rola` | rola czytana z pliku przy każdym żądaniu - degradacja działa od razu |
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
| `CAI_ZAUFANY_NAGLOWEK` | - | nagłówek z loginem z bramy, np. `Remote-User` |
| `CAI_ZAUFANE_ADRESY` | pętla zwrotna | adresy, z których wolno przyjąć ten nagłówek |
| `CAI_DOSTAWCA` | `anthropic` | `anthropic` albo `nvidia` |
| `CAI_MODEL_NVIDIA` | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | model przy `nvidia` |
| `CAI_MODEL_GRAFIKI` | - (model z aplikacji: `gpt-image-2.5-flare`) | podmienia model grafik OpenAI w każdym zapytaniu, np. gdy dostawca wycofa model |
| `CAI_URL_NVIDIA` | `https://integrate.api.nvidia.com/v1/chat/completions` | endpoint NIM |
| `ANTHROPIC_KEY` | - | klucz treści (dostawca `anthropic`) |
| `NVIDIA_KEY` | - | klucz treści (dostawca `nvidia`) |
| `OPENAI_KEY` | - | grafiki, TTS, transkrypcja |
| `ELEVEN_KEY` | - | głos premium |
| `CAI_SERP` | `model` | źródło danych SERP: `model`, `dataforseo` albo `openseo` |
| `CAI_SEO_PROJEKT` | - | id projektu OpenSEO (wymagane przy `CAI_SERP=openseo`) |
| `DATAFORSEO_LOGIN` | - | login DataForSEO (przy `CAI_SERP=dataforseo`) |
| `DATAFORSEO_HASLO` | - | hasło DataForSEO |
| `CAI_BAZA` | `serwer/dane/baza` | katalog bazy wiedzy |
| `CAI_UZYCIE` | `serwer/dane/uzycie` | katalog liczników pakietów |
| `CAI_MODEL_EMBED` | `nvidia/nv-embedqa-e5-v5` | model wektorów |
| `CAI_URL_EMBED` | `https://integrate.api.nvidia.com/v1/embeddings` | endpoint wektorów |
| `CAI_COOKIE_DOMENA` | - | domena ciasteczka sesji, np. `.twojadomena.pl` |
| `CAI_OPENSEO_PORT` | - | port bramy OpenSEO; puste = brama wyłączona |
| `CAI_OPENSEO_UPSTREAM` | `3001` | port kontenera OpenSEO |
| `CAI_OPENSEO_HOST` | `127.0.0.1` | host kontenera OpenSEO |
| `CAI_OPENSEO_ADRES` | - | publiczny adres OpenSEO - dokłada pozycję w menu |
| `CAI_MARKA` | `serwer/dane` | katalog z `marka.json` |
| `CAI_SEKRET_PLIK` | `serwer/dane/sekret` | plik z sekretem sesji (gdy brak `CAI_SEKRET_SESJI`) |
| `CAI_WYLOGOWANE` | `serwer/dane/wylogowane.json` | lista sesji wylogowanych ręcznie |
| `CAI_PROSBY` | `serwer/dane/prosby.jsonl` | prośby o dostęp ze strony produktowej (JSON Lines) |
| `CAI_STRONA_ORIGIN` | `https://content-ai.net,https://www.content-ai.net` | skąd wolno wysłać prośbę o dostęp (lista po przecinku) |
| `CAI_PROSBY_DNI` | `365` | ile dni trzymać prośby o dostęp; starsze wypadają przy starcie i przy zapisie |
| `CAI_MODELE` | - | modele dopuszczone **oprócz** stałych `MODEL_*` aplikacji (lista po przecinku) |
| `CAI_MAX_TOKENS` | `32000` | sufit `max_tokens` w `/api` |
| `CAI_ROZMIARY_GRAFIK` | - | rozmiary grafik **oprócz** `IMG_FORMATS` aplikacji, np. `1792x1024` |
| `CAI_CZAS_TRESCI_MS` | `120000` | limit czasu krótkich wywołań modelu |
| `CAI_CZAS_DLUGI_MS` | `600000` (min. 300000) | limit czasu artykułu, wyszukiwania w sieci, `max_tokens` > 4000 |
| `CAI_CZAS_OBRAZOW_MS` | `240000` | limit czasu generowania grafiki |
| `CAI_CZAS_AUDIO_MS` | `120000` | limit czasu syntezy mowy (OpenAI, ElevenLabs) |
| `CAI_CZAS_TRANSKRYPCJI_MS` | `300000` | limit czasu transkrypcji |
| `CAI_CZAS_SERP_MS` | `30000` | limit czasu DataForSEO i SERP przez OpenSEO |
| `CAI_CZAS_OPENSEO_MS` | `120000` | limit bezczynności bramy OpenSEO |
| `CAI_KOMPRESJA` | `1` | `0` wyłącza kompresję w Node (gdy pakuje Caddy) |

### Klucze mieszane

Klucz serwera jest domyślny. Jeśli użytkownik poda **własny** klucz, serwer użyje jego
zamiast serwerowego - aplikacja wysyła go w nagłówku `x-api-key` (oraz `x-openai-key`,
`x-eleven-key`). Pusty nagłówek, który aplikacja wysyła w trybie proxy, jest ignorowany
i wraca klucz serwera. Nie wymaga to żadnej zmiany w aplikacji.

### Baza wiedzy (RAG)

Dwa zakresy:

| Zakres | Kto widzi | Kto dodaje |
|---|---|---|
| **prywatna** | tylko właściciel | każdy zalogowany, w swojej |
| **wspólna** | wszyscy | **wyłącznie admin** |

Dokumenty leżą na serwerze (`serwer/dane/baza/`), więc chodzą za użytkownikiem na każde
urządzenie - inaczej niż dotąd, gdy siedziały w `localStorage` przeglądarki.

**Dlaczego to ważne.** Aplikacja wklejała do promptu **całą treść** każdego zaznaczonego
dokumentu. Koszt rósł liniowo z wielkością bazy, przy większej bazie kończył się kontekst,
a trafne fragmenty tonęły w szumie. Teraz tekst jest dzielony na fragmenty po 1500 znaków,
każdy dostaje wektor, a przy generowaniu dobieranych jest tylko kilka najtrafniejszych.

To odwzorowanie rozwiązania z Cosmosa. Różnica jedna: Cosmos liczy wektory lokalnie na GPU
(usługa `senses`, model bge-m3), a tu VPS nie ma karty - więc liczy je API NVIDIA, gdzie
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

**W aplikacji** (tylko wariant `proxy` - pozostałe nie mają serwera): menu ustawień →
**Baza wiedzy**. Lista łączy oba zakresy, 🌐 to wspólny, 🔒 prywatny; wybór zakresu przy
dodawaniu pokazuje się wyłącznie adminowi.

### Pobieranie stron do bazy wiedzy

`POST /api/strona` z ciałem `{ "adres": "https://..." }` zwraca `{ adres, tytul, tekst, slowa }`.

Powstało po audycie agencji SEO, która zgłosiła, że dodawanie linków nie działa w ogóle.
Nie działało, bo aplikacja nie pobierała strony: prosiła model, żeby „wszedł na adres"
narzędziem `web_search`. To narzędzie szuka w internecie, a nie pobiera wskazanego
dokumentu, więc w odpowiedzi przychodziło streszczenie wyników wyszukiwania albo zdanie
„nie mogę odwiedzić tej strony".

Teraz serwer pobiera stronę zwykłym żądaniem HTTP, bez modelu i bez tokenów, i zwraca
sam tekst: bez skryptów, stylów, menu i stopki, z zachowanymi poziomami nagłówków.
Aplikacja woła ten endpoint jako pierwszy; gdy serwera nie ma (warianty `keys` i `owner`)
albo strona odmówi, schodzi na narzędzie `web_fetch` modelu.

**Adres jest sprawdzany przy każdym skoku przekierowania.** Bez tego endpoint byłby
okienkiem do sieci wewnętrznej: wystarczyłoby podać `http://169.254.169.254/`, żeby
metadane maszyny trafiły do bazy wiedzy. Odrzucane są wszystkie zakresy specjalne
z rejestrów IANA (`net.BlockList`: pętla zwrotna, prywatne, link-local, CGNAT,
dokumentacyjne, benchmarkowe, multicast, 6to4, NAT64, IPv4 zapisane jako IPv6 i inne)
oraz wszystko, czego nie da się rozpoznać jako adres publiczny. Adres jest sprawdzany
drugi raz **w chwili łączenia** (opcja `lookup` w `http/https.request`), więc zmiana
odpowiedzi DNS między sprawdzeniem a połączeniem nic nie da. Limit 4 MB jest liczony
w trakcie czytania odpowiedzi, a nie po wczytaniu całości. Limity: 4 MB odpowiedzi,
400 tys. znaków tekstu, 5 przekierowań, 20 sekund. Do przeglądarki idą tylko nasze
komunikaty; szczegóły błędów sieci zostają w logu.

### Konfiguracja marki

Menu ustawień → **Marka**. Okno trzyma całą tożsamość firmy: nazwę, nazwę prawną,
domenę, opis, usługi, rozróżnienie linii biznesowych oraz dwie listy domen.

| Pole | Do czego służy |
|---|---|
| Domeny marki | rozpoznawanie odnośników do własnej strony; puste = brane z adresu bazowego |
| Domeny wykluczone z wyszukiwania | AI ich w ogóle nie zobaczy przy włączonym wyszukiwaniu w sieci |

Lista wykluczeń jest **branżowa**: dla kuriera to inni przewoźnicy i porównywarki, dla
kancelarii inne kancelarie. Dlatego ustawia się ją w aplikacji, a nie w kodzie. Wpisy są
czyszczone przy zapisie: `https://www.Konkurent.PL/cennik` zostaje zapisane jako
`konkurent.pl`, duplikaty znikają, a wpis bez kropki jest odrzucany. Licznik pod polem
pokazuje, co zostało przyjęte. Górny limit to 64 domeny, bo tyle przyjmuje narzędzie
wyszukiwania.

Nazwa marki trafia do reguł generowania: bez niej instrukcja „użyj nazwy z bazy wiedzy"
nie ma kotwicy, bo model nie wie, która z nazw w dokumentach jest tą właściwą.

#### Gdzie to leży

Konfiguracja jest **jedna dla całego wdrożenia**: zapisuje ją administrator, czyta każdy
zalogowany. Wcześniej siedziała w `localStorage` przeglądarki, więc każdy użytkownik
i każde urządzenie miały własną kopię, a nowa osoba w zespole zaczynała od pustej
i generowała teksty bez żadnych reguł o marce.

| Trasa | Kto |
|---|---|
| `GET /api/marka` | każdy zalogowany |
| `POST /api/marka` | **tylko rola admin**; pozostali dostają 403 |

Plik: `serwer/dane/marka.json` (albo `CAI_MARKA`), uprawnienia `600`. Serwer przyjmuje
wyłącznie osiem znanych pól i przycina je do limitu długości - konfiguracja trafia prosto
do promptów, więc nie może być workiem na dowolne klucze.

W aplikacji widać to tak: gdy konfiguracja przyszła z serwera, a zalogowany nie jest
administratorem, pola są tylko do odczytu i pod nimi stoi zdanie, kto je ustawia. Bez tego
zmiany dałoby się wpisać, ale nie weszłyby do promptów - wygrywa wersja z serwera.

Kopia trafia też do `localStorage`, żeby aplikacja miała konfigurację, gdy serwer chwilowo
nie odpowie. Warianty `keys` i `owner` nie mają serwera i działają wyłącznie na
`localStorage`, dokładnie jak dotąd. Wartości początkowe biorą się ze stałej `BRAND`
w `app/contentai.src.html`.

### Sprawdzanie odnośników z artykułu

`POST /api/odnosniki` z ciałem `{ "adresy": ["https://...", ...] }` zwraca dla każdego
`{ adres, status, dziala }`.

Przeglądarka nie sprawdzi obcego adresu, bo nie wolno jej czytać odpowiedzi. Serwer może.
Pyta metodą HEAD, a gdy witryna jej nie obsługuje (405, 501, 403), ponawia metodą GET,
żeby żywy adres nie trafił do raportu jako martwy. Obowiązuje ta sama kontrola adresu co
przy pobieraniu stron, więc odnośnik do sieci wewnętrznej nie zostanie odpytany. Limit
40 adresów na żądanie, bez wpływu na pakiet.

Adresy sprawdzane są **po sześć naraz**, z limitem 6 sekund na żądanie. Wcześniej szły
po kolei z limitem 20 sekund wziętym z pobierania stron: przy kilku witrynach, które nie
odpowiadają na HEAD, panel kontroli faktów potrafił stać pusty przez minuty. Tu interesuje
nas sam kod odpowiedzi, nie treść, więc krótszy limit niczego nie traci.

Aplikacja woła to z panelu **Kontrola faktów**. Sam panel liczy jeszcze dwie rzeczy
lokalnie, bez serwera i bez modelu: czy adres w ogóle występuje w zaznaczonych źródłach
(osobno rozróżnia obcą domenę od znanej domeny z dopisaną podstroną) i czy teksty kotwic
nie powtarzają się ani nie są puste w rodzaju „kliknij tutaj".

Przy generowaniu aplikacja woła `/api/baza/szukaj` i wstawia zwrócony blok do promptu -
bez zaznaczania czegokolwiek przez użytkownika. Dawna baza w `localStorage` działa dalej
i dokłada się do tego samego promptu, więc aktualizacja nie zabiera nikomu jego dokumentów.

### Dane SERP

Aplikacja przed generowaniem może sprawdzić, co rankuje w Google. Domyślnie (`CAI_SERP=model`)
robi to, prosząc model o wyszukanie - narzędziem `web_search`, które **istnieje tylko
u Anthropic**. Ma to dwie konsekwencje:

- dane są **szacowane przez model**, a nie mierzone,
- przy `CAI_DOSTAWCA=nvidia` narzędzia nie ma, więc serwer zwraca **HTTP 501 z jasnym
  komunikatem** zamiast pozwolić modelowi zmyślić wyniki i podać je dalej jako fakty.

`CAI_SERP=dataforseo` bierze dane z API DataForSEO - realne wyniki organiczne, niezależnie
od dostawcy modelu. To **to samo źródło, z którego korzysta OpenSEO**.

Zapytanie o SERP serwer rozpoznaje po treści, a nie po samym narzędziu `web_search`:
prompt systemowy analizy SERP („Search for top Google results for the given keyword")
i wiadomość „Keyword: <fraza>" z `fetchSerpContext`. Narzędzie dostają też artykuł
z przełącznikiem sieci, monitor AI i widoczność marki - te idą do modelu jak zwykłe
wywołanie (pakiet darmowy ich nie blokuje, a przy `CAI_SERP=dataforseo` artykuł
dostaje artykuł, nie JSON z danymi SERP).

```
CAI_SERP=dataforseo
DATAFORSEO_LOGIN=twoj@email.pl
DATAFORSEO_HASLO=...
```

Zwracane `avgWords` i `avgH2` to zera - ten endpoint DataForSEO nie podaje długości treści
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

Caddy kieruje `seo.twojadomena.pl` na **3110**, nigdy na 3001 - 3001 to goły kontener,
który startuje z `AUTH_MODE=local_noauth`, czyli bez żadnego logowania.

`CAI_COOKIE_DOMENA` sprawia, że jedna sesja obejmuje obie poddomeny. Bez tego wszystko
działa, tylko logujesz się osobno na każdej. Zmiana tej wartości unieważnia bieżące
ciasteczka - po restarcie wszyscy logują się ponownie.

Token sesji Content AI jest **wycinany** z nagłówka `Cookie` przed przekazaniem żądania
do kontenera - obca aplikacja go nie widzi.

Brama wysyła też **nagłówki bezpieczeństwa**: jej własne strony (logowanie, 402, błąd
kontenera) mają ten sam zestaw co aplikacja (CSP z `frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`), a strony z kontenera minimum,
które nie łamie obcej aplikacji: `X-Frame-Options: SAMEORIGIN`,
`Content-Security-Policy: frame-ancestors 'self'`, `nosniff`, `Referrer-Policy: same-origin`.
Nagłówek ustawiony przez samo OpenSEO wygrywa z naszym.

Brama sprawdza też **pakiet**: kontener nie ma własnego logowania, więc bez tego każde
konto (także darmowe) miałoby pełne OpenSEO, łącznie z płatnymi badaniami DataForSEO.
Wchodzi konto z funkcją `openseo` w pakiecie (Premium) albo z rolą admin; reszta dostaje
**402** ze stroną z wyjaśnieniem, a WebSocket jest zamykany.

### Pakiety i limity

Trzy pakiety w `serwer/plany.js`. To **tabela danych**, nie kod: zmiana „3 artykuły"
na „5" albo dołożenie grafik do standardu to edycja jednej linii.

| | Darmowy | Standard | Premium |
|---|---|---|---|
| Artykuły | 3 (bez odnawiania) | 50/mies. | bez limitu |
| Grafiki | - | 50/mies. | bez limitu |
| Audio, transkrypcja | - | 20/mies. | bez limitu |
| Wywołania modelu (sufit) | 30 | 750/mies. | bez limitu |
| Dokumenty w bazie | 3 | 50 | bez limitu |
| Analiza SERP | - | tak | tak |
| Dane z OpenSEO | - | - | tak |
| Własny klucz API, CMS | - | tak | tak |

```bash
node serwer/uzytkownicy.js plan anna standard
```

Konto bez wpisanego planu dostaje darmowy. **Admin zawsze działa jak premium**, niezależnie
od wpisu - inaczej właściciel systemu mógłby sobie zablokować własne narzędzie.

Dwie rzeczy warte uwagi przy zmianach:

- **Limit** dotyczy rzeczy liczonych na sztuki (artykuły, grafiki). **Bramka** dotyczy całych
  funkcji (SERP, OpenSEO) - albo je masz, albo nie. Mieszanie tego w jednym mechanizmie
  kończy się zwykle tym, że nie wiadomo, dlaczego komuś coś nie działa.
- Zliczanie następuje **po udanej odpowiedzi dostawcy**. Gdy generowanie padnie na błędzie
  API, użytkownik nie traci sztuki z pakietu - dostał przecież nic.

#### Artykuł to nie to samo co wywołanie modelu

Jedno generowanie artykułu to kilka wywołań: brief, treść, korekta premium, uzupełnianie
luk, przeróbki fragmentów. Gdyby każde liczyło się jako artykuł, pakiet darmowy skończyłby
się w połowie pierwszego tekstu.

Dlatego artykuł liczy się **tylko wtedy, gdy aplikacja się o to zgłosi** - nagłówkiem
`x-cai-czynnosc: artykul`, wysyłanym z jedynego miejsca, które faktycznie generuje treść.
Wszystkie pozostałe wywołania idą na osobny licznik `wywolanie`.

Deklaracja przychodzi z przeglądarki, więc nie jest dowodem - i nie musi nim być. Licznik
wywołań jest **sufitem kosztu**: konto, które nigdy nie przyzna się do artykułu, i tak ma
skończoną pulę. To nie zamek, tylko granica wydatku.

Nagłówek istnieje wyłącznie w wariancie `proxy`. W wariantach łączących się prosto
z `api.anthropic.com` własny nagłówek wywołałby preflight CORS i zablokował generowanie -
pilnuje tego kontrola `U/artykul` w `narzedzia/sprawdz_zrodlo.py`.

Przekroczenie limitu to **HTTP 402** z opisem: plan, limit, zużycie i to, czy licznik się
kiedykolwiek odnowi. Aplikacja przechwytuje to w jednym miejscu (opakowany `fetch`) i
pokazuje okno pakietu z paskami zużycia, zamiast ogólnego błędu API.

| Endpoint | Do czego |
|---|---|
| `GET /api/pakiet` | własny pakiet: limity, zużycie, dostępne funkcje, nazwa i opis PL/EN |

Liczniki leżą w `serwer/dane/uzycie/` - jeden plik JSON na konto. Miesięczne okresy starsze
niż rok wypadają przy kolejnym zapisie, żeby plik nie puchł.

### Logowanie przez bramę

Ustawienie `CAI_ZAUFANY_NAGLOWEK` przełącza serwer w tryb, w którym uwierzytelnia
**zewnętrzna brama** (Authelia i pokrewne), a my czytamy z nagłówka sam login.
Wtedy 2FA, passkeys i SSO robi ona.

```
CAI_ZAUFANY_NAGLOWEK=Remote-User
```

Serwer przyjmuje ten nagłówek **wyłącznie z zaufanego adresu** - domyślnie z pętli
zwrotnej. Bez tego warunku każdy, kto dosięgnie portu z pominięciem bramy, zostaje
adminem przez dopisanie jednego nagłówka. Dlatego w tym trybie port nie może być
wystawiony na świat; `CAI_HOST` zostaje na `127.0.0.1`.

Własny ekran logowania jest wtedy wyłączony (`POST /auth/login` → 404), żeby nie
tworzyć drugiej drogi wejścia omijającej drugi składnik. Role nadal czytamy
z pliku kont - konto musi istnieć po obu stronach.

Wdrożenie z gotowymi plikami konfiguracyjnymi: **`brama/README.md`**.

### Dane z OpenSEO (`/api/seo/*`)

Content AI pyta OpenSEO o jego dane przez serwer MCP kontenera (`serwer/openseo-mcp.js`).
W trybie `local_noauth` ten endpoint nie wymaga tokenu, a ruch idzie po pętli zwrotnej.

| Endpoint | Do czego | Koszt |
|---|---|---|
| `GET /api/seo/projekty` | lista projektów | **0** |
| `GET /api/seo/frazy` | zapisane frazy z metrykami i tagami | **0** |
| `POST /api/seo/frazy` | oddanie fraz z tagiem (domyślnie `content-ai`) | **0** |
| `GET /api/seo/okazje` | strony na pozycjach 4-20 (wymaga GSC + GA4) | **0** |
| `POST /api/seo/badaj` | badanie nowych fraz | **płatne** |

Bez bramy OpenSEO (`CAI_OPENSEO_PORT` puste) `GET /api/seo/projekty` odpowiada
`200 {projekty: [], dostepne: false}` - aplikacja sprawdza tę listę przy każdym starcie
i brak OpenSEO jest normalnym stanem, nie błędem. Pozostałe `/api/seo/*` dają wtedy 501.

Zero oznacza tu dosłownie zero: te narzędzia czytają bazę OpenSEO i nie wołają DataForSEO.
Płatne narzędzie odmówi wywołania bez jawnego `potwierdzam: true` i zapisze do logu login
osoby, która je uruchomiła - wydatek ma mieć właściciela.

Szczegóły, uzasadnienie wyborów i wdrożenie: **`openseo/README.md`**.

### Modele open source

`CAI_DOSTAWCA=nvidia` kieruje generowanie treści do NVIDIA NIM. Serwer tłumaczy żądanie
z formatu Anthropic na OpenAI Chat Completions i odpowiedź z powrotem, więc **aplikacja
nie wie o zmianie**. Bloki obrazów są przy tłumaczeniu pomijane - nie każdy model NIM je przyjmuje.

Grafiki, TTS i transkrypcja nadal idą do OpenAI/ElevenLabs. Ich zamienniki OSS wymagają
własnego GPU, więc na VPS bez karty nie mają sensu.

---

## Uruchomienie na serwerze (Ubuntu)

Pełna instrukcja krok po kroku, od pustego VPS-a do działającej strony:
**`dokumenty/ContentAI_Instalacja_na_serwerze.md`**. Poniżej skrót dla kogoś, kto zna Linuksa.

```bash
# 1. Kod i Node (wymagany Node >= 18 - sprawdź `node -v` po instalacji)
sudo apt update && sudo apt install -y git nodejs
sudo git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai

# 2. Konto systemowe usługi i katalog na dane
sudo useradd --system --home-dir /srv/contentai --shell /usr/sbin/nologin contentai
sudo mkdir -p /srv/contentai/serwer/dane
sudo chown -R contentai:contentai /srv/contentai/serwer/dane

# 3. Pierwsze konto administratora - jako użytkownik usługi, nie root
cd /srv/contentai
sudo -u contentai node serwer/uzytkownicy.js dodaj marcin admin

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

Warianty aplikacji leżą w repo gotowe - po świeżym klonie nie ma czego budować.
`python3 pakowanie/warianty.py --wszystkie -o app` uruchamiasz dopiero po zmianie
w `app/contentai.src.html`.

### Usługa systemd

```bash
sudo cp /srv/contentai/serwer/contentai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contentai
sudo systemctl status contentai
```

Usługa chodzi na stałym koncie `contentai` i zapisuje wyłącznie do
`serwer/dane/`. **Nie zamieniaj tego na `DynamicUser=yes`**: systemd nadaje wtedy
zmienny UID i nie przejmuje na własność katalogu z `ReadWritePaths`, więc proces
nie zapisze ani sekretu sesji, ani liczników pakietów. Serwer przeżywa to po cichu -
objawem byłoby wylogowywanie po każdym restarcie i limity, które nic nie liczą.

### Caddy - HTTPS

Jedno źródło prawdy: **`dokumenty/Caddyfile.content-ai`** (strona produktowa
`content-ai.net`, przekierowanie `www`, aplikacja `app.`, opcjonalnie `seo.`). Ten sam blok
jest w `dokumenty/ContentAI_Domena_Cloudflare.md` i `dokumenty/ContentAI_obok_Cosmosa.md`;
wersje z bramą Authelia i z OpenSEO: `brama/Caddyfile.przyklad`, `openseo/Caddyfile.przyklad`.

**Nie nadpisuj `/etc/caddy/Caddyfile`** - na serwerze może stać Cosmos albo inna usługa.
Zrób kopię, blok globalny `{ servers { ... } }` dopisz na samą górę (Caddy przyjmuje tylko
jeden, pierwszy w pliku; jeśli już jest, dopisz do niego sekcję `servers`), bloki domen
Content AI zastąp albo dopisz, potem `caddy validate --config /etc/caddy/Caddyfile
--adapter caddyfile` i `systemctl reload caddy`. Wymaga Caddy 2.7+.

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

Caddy sam pobierze certyfikat. **Nie dodawaj tu `basic_auth`** - logowanie obsługuje
już serwer, a dwa ekrany logowania pod rząd tylko męczą.

- **`header_up X-Real-IP {client_ip}` jest obowiązkowe.** Node czyta `X-Real-IP` tylko
  wtedy, gdy połączenie przyszło z pętli zwrotnej (Caddy na tej samej maszynie);
  `X-Forwarded-For` jest ignorowany. Bez tej linii wszyscy użytkownicy są dla Node jednym
  adresem `127.0.0.1` (8 błędnych prób jednej osoby blokuje logowanie całemu zespołowi),
  a gołe `reverse_proxy` przepuszcza `X-Real-IP` od klienta, więc da się nim obejść limit.
  Serwer wypisuje w logu ostrzeżenie, gdy żądanie z pętli zwrotnej przyjdzie bez tego
  nagłówka (raz na godzinę).
- **`trusted_proxies` + `client_ip_headers CF-Connecting-IP`**: strona produktowa idzie
  przez Cloudflare (pomarańczowa chmurka), więc bez tego `{client_ip}` byłby adresem
  Cloudflare. Aplikacja (`app.`, szara chmurka) łączy się z pominięciem Cloudflare - tam
  `{client_ip}` to zawsze adres połączenia.
- **HSTS** ustawia Caddy, bo dotyczy HTTPS, którego Node nie widzi. Bez `preload` na
  start; `includeSubDomains` obejmuje też `seo.` i każdą inną poddomenę, więc wszystkie
  muszą mieć certyfikat (Caddy robi to sam). Pozostałe nagłówki bezpieczeństwa aplikacji
  wysyła Node, więc w bloku `app.` ich nie dubluj.
- **Kompresja**: Node sam pakuje HTML, JS i CSS (brotli albo gzip wg `Accept-Encoding`,
  z `Vary: Accept-Encoding`, wersje spakowane trzyma w pamięci), więc blok `app.` nie ma
  `encode`. Jeśli wolisz pakowanie w Caddy, dopisz `encode zstd gzip` i ustaw
  `CAI_KOMPRESJA=0`.
- Brama OpenSEO (`seo.` → port `CAI_OPENSEO_PORT`) potrzebuje tego samego
  `header_up X-Real-IP {client_ip}`; tam `encode` zostaje, bo brama oddaje HTML
  nieskompresowany.

### Aktualizacja

```bash
cd /srv/contentai && sudo git pull
sudo systemctl restart contentai
```

Gdy wydanie zmienia blok Caddy (`dokumenty/Caddyfile.content-ai`): **najpierw** Caddyfile,
`caddy validate` i `systemctl reload caddy`, **dopiero potem** `git pull` i restart.

---

## Bezpieczeństwo

Co serwer robi:

- hasła haszowane scryptem z losową solą, porównanie odporne na pomiar czasu
- **8 nieudanych prób logowania z jednego IP → blokada na 15 minut**
- cookie `HttpOnly`, `SameSite=Lax`, `Secure` (gdy `CAI_COOKIE_SECURE=1`)
- klucze API nigdy nie docierają do przeglądarki
- pliki statyczne tylko z listy dozwolonych: `manifest.json`, `icons/*`, `pwa/lib/*.js`
  i `pwa/fonty/*.woff2` - reszta katalogu jest niedostępna, próby wyjścia poza katalog
  kończą się 404; przed zalogowaniem dostępne są tylko manifest, ikony i kroje (ekran
  logowania), biblioteki aplikacji dopiero po zalogowaniu
- aplikacja nie pobiera niczego z obcych serwerów: biblioteki (mammoth, pdf.js, pdfmake,
  xlsx, html-docx-js) i kroje (Schibsted Grotesk, Literata, JetBrains Mono) leżą w repozytorium i idą z Twojego hosta
- szczegóły błędów dostawcy trafiają do logu serwera, nie do przeglądarki

Czego **nie** robi - i o czym trzeba wiedzieć:

- **brak 2FA we własnym logowaniu** - drugi składnik daje dopiero brama, patrz `brama/README.md`
- brak resetu hasła przez e-mail - hasło zmienia admin poleceniem
- licznik prób logowania jest w pamięci i per IP; za wspólnym NAT-em zablokuje wszystkich
  z tego adresu naraz
- adres klienta bierze z `X-Real-IP` tylko przy połączeniu z pętli zwrotnej (od Caddy),
  więc port Node nie może być wystawiony na świat; `CAI_HOST` zostaje na `127.0.0.1`

### Nagłówki bezpieczeństwa

Każda odpowiedź aplikacji i ekranu logowania ma:

| Nagłówek | Wartość |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https:; media-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), payment=(), usb=(), microphone=(self)` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control` (`/api/*`, `/auth/*`, ekran logowania) | `no-store` |

`'unsafe-inline'` w `script-src` musi zostać, dopóki aplikacja ma setki atrybutów
`on*` i skrypty w HTML. Taka polityka nie zatrzyma wstrzykniętego skryptu, ale odcina
mu wyprowadzanie danych i osadzanie aplikacji w obcej ramce. `connect-src https:`
zostaje dla publikacji do WordPressa i Drupala prosto z przeglądarki; po przeniesieniu
publikacji na serwer można je zawęzić do `'self'`. HSTS: patrz sekcja Caddy.

### CSRF

`SameSite=Lax` nie chroni przed żądaniami z tej samej domeny nadrzędnej (strona
produktowa i `seo.` są dla przeglądarki tą samą „stroną" co aplikacja). Dlatego:

- POST (i inne metody zmieniające stan) z `Sec-Fetch-Site` innym niż `same-origin`
  albo z `Origin` wskazującym inny host niż żądanie → **403**,
- endpointy JSON wymagają `Content-Type: application/json` (inaczej **415**); wyjątki:
  formularze `/auth/login` i `/auth/logout` oraz nagrania do `/api/transcribe`
  (`multipart/form-data`),
- wylogowanie to POST formularzem; `GET /auth/logout` działa dla zgodności tylko
  z własnej strony albo wpisany ręcznie, a z obcego odnośnika pokazuje ekran
  z przyciskiem „Wyloguj się",
- jedyny wyjątek od kontroli pochodzenia to `/api/prosba-o-dostep` (własne CORS).

### Pliki danych

Każdy plik danych (konta, liczniki, baza wiedzy, wylogowania, marka, sekret) jest
zapisywany atomowo: plik tymczasowy w tym samym katalogu, `fsync`, `rename`. Na dysku
jest zawsze cała stara albo cała nowa wersja. Uszkodzony plik **nie jest** traktowany
jak pusty: serwer go nie nadpisuje, obok kładzie kopię `<plik>.uszkodzony-<czas>`,
zapisuje błąd w logu i odpowiada **503** („dane chwilowo niedostępne"), dopóki
administrator nie przywróci pliku z kopii albo go nie usunie. Dawniej uszkodzony plik
kont dawał pustą listę, a następne `uzytkownicy.js dodaj` zapisywało listę z jednym
kontem na miejscu całej reszty.

### Pamięć podręczna plików statycznych

`pwa/lib/*`, `pwa/fonty/*` i `icons/*` idą z `Cache-Control: public, max-age=31536000,
immutable` i `ETag`; `manifest.json` z `max-age=3600`. Strona aplikacji (`/`) zostaje
`private, no-store`, bo zawiera identyfikator konta.

**Zasada: zmiana treści takiego pliku = nowa nazwa pliku** (np. `icon-192-v2.png`,
`pdfmake-0.2.10.min.js`) i nowe odwołanie w aplikacji lub manifeście. Podmiana pliku
pod tą samą nazwą nie dotrze do przeglądarek, które mają go już w pamięci, przez rok.

### Limity czasu i zerwane połączenia

Każde wywołanie dostawcy (Anthropic, NVIDIA, OpenAI, ElevenLabs, DataForSEO, OpenSEO)
ma limit czasu z tabeli konfiguracji. Po jego przekroczeniu aplikacja dostaje **504**
z komunikatem „Dostawca nie odpowiedział w ciągu N s. Spróbuj ponownie za chwilę."
(`error.type: timeout_error`). Długie generowanie (artykuł, wyszukiwanie w sieci,
`max_tokens` > 4000) ma osobny limit, nigdy krótszy niż 300 s.

Gdy przeglądarka zamknie połączenie (zamknięta karta, ponowienie), serwer przerywa też
wywołanie dostawcy. Pakiet jest liczony tylko wtedy, gdy odpowiedź dostawcy była udana
**i** klient nadal na nią czekał.

### Koszt: modele, tokeny, grafiki

Na koncie serwera płaci operator, więc granice stawia serwer, a nie przeglądarka:

- `/api` przyjmuje tylko modele ze stałych `MODEL_*` aplikacji (odczytanych z
  `web-proxy.html` przy starcie, więc zmiana modelu w aplikacji nie wymaga zmiany
  serwera) i z `CAI_MODELE`; `max_tokens` najwyżej `CAI_MAX_TOKENS`,
- `/api/images`: jedna grafika na zapytanie (`n` = 1), rozmiar tylko z `IMG_FORMATS`
  aplikacji i `CAI_ROZMIARY_GRAFIK`,
- zapytanie spoza tych granic → **400** z komunikatem, bez wywołania dostawcy.

### Prośby o dostęp (`POST /api/prosba-o-dostep`)

Formularz „Poproś o dostęp" ze strony produktowej. Bez logowania, CORS tylko dla
`CAI_STRONA_ORIGIN` (bez ciasteczek), `Content-Type: application/json`.

| Pole | Zasada |
|---|---|
| `imie` | 1-100 znaków |
| `email` | adres e-mail, najwyżej 200 znaków |
| `firma` | może być puste, najwyżej 200 znaków |
| `pakiet` | `nie-wiem` (domyślna opcja formularza), `darmowy`, `standard` albo `premium` |
| `wiadomosc` | może być puste, najwyżej 2000 znaków |
| `jezyk` | `pl` albo `en` |
| `strona` | pole-pułapka: niepuste = bot, udawane `200 {ok:true}` bez zapisu |

Odpowiedzi (kontrakt formularza `showcase/zasoby/strona.js`): `200 {ok:true}`;
`400 {ok:false, blad, pole?, komunikat}`, gdzie `blad` to `brak-imienia`, `zly-email`,
`za-dlugie`, `zly-pakiet`, `zly-jezyk` albo `zle-dane`, a `pole` wskazuje pole formularza;
`413 {ok:false, blad:'za-duze'}` przy ciele ponad 16 kB (odpowiedź z CORS, a nie zerwane
połączenie); `429 {ok:false, blad:'limit'}`. `OPTIONS` → 204. Każda odpowiedź na dozwolony
`Origin` ma ten sam `Access-Control-Allow-Origin`, `Allow-Methods: POST, OPTIONS`,
`Allow-Headers: Content-Type` i `Vary: Origin`; obcy `Origin` dostaje 403 bez nagłówków CORS.

Limity (liczniki w pamięci procesu):

| Limit | Wartość | Po przekroczeniu |
|---|---|---|
| jeden adres | 5 na godzinę | 429 |
| jedna sieć (`/24` IPv4, `/48` IPv6) | 20 na dobę | 429 |
| wszystkie prośby, miękki | 200 na dobę | przyjęta z `ponadLimit: true` i ostrzeżeniem w logu - ktoś z wieloma adresami nie zatka formularza wszystkim |
| wszystkie prośby, twardy | 2000 na dobę | 429 |

Adres to wynik `adresIp()` serwera (`X-Real-IP` tylko od Caddy z pętli zwrotnej,
`X-Forwarded-For` jest ignorowany). Pole `zgoda` jest opcjonalne: rekord ma `zgoda: true`
tylko wtedy, gdy formularz je wysłał (`zgoda: true`), w każdym innym razie `false`.
Każda prośba to jedna linia JSON w `CAI_PROSBY` (czas, adres IP, pola formularza, zgoda,
pochodzenie). Prośby starsze niż `CAI_PROSBY_DNI` (domyślnie 365 dni) serwer usuwa przy
starcie i przy zapisie (najwyżej raz na dobę); nieczytelnych linii nie wyrzuca.
Odczyt: `GET /api/admin/prosby` (rola admin) albo `node serwer/uzytkownicy.js prosby [ile]`.

## Strona i dokumenty

Dwie części, które razem zastępują dawny formularz „Poproś o dostęp": statyczna strona
produktowa `content-ai.net` (konto zakłada się samemu w aplikacji) i dokumenty prawne,
które renderuje serwer aplikacji, bo tylko jego konfiguracja zna dane usługodawcy.

### Strona produktowa (`showcase/`)

Źródła w `showcase/zrodlo/`: `szablon.html` (strona główna z cennikiem, FAQ i zakończeniem
„trzy kroki do pierwszego artykułu"), `klucz-api.html`, `ai-act.html`, `prywatnosc.html`,
`regulamin.html`, wspólne `czesci/`, słownik `teksty.json` (PL i EN) i ustawienia
`konfiguracja.json`. Budowanie: `python3 narzedzia/buduj_strone.py` (CI: `--sprawdz`).
Lista stron (`STRONY` w `buduj_strone.py`) jest jedna: z niej powstają `sitemap.xml`
i hreflang, a `audyt_showcase.py` i `test_uklad_strony.js` sprawdzają te same strony.

| Strona PL | Strona EN | Treść |
|---|---|---|
| `/` | `/en/` | produkt, cennik (`#cennik`, stara kotwica `#pakiety` działa), FAQ, `#start` |
| `/klucz-api/` | `/en/api-key/` | jak zdobyć klucz Anthropic (oraz OpenAI i ElevenLabs), koszt artykułu ze źródłem i datą |
| `/ai-act/` | `/en/ai-act/` | AI Act i przejrzystość („wspiera wymogi przejrzystości", nigdy „w pełni zgodne") |
| `/prywatnosc/` | `/en/privacy/` | krótko o samej stronie i odnośnik do pełnej polityki |
| `/regulamin/` | `/en/terms/` | wejście na pełny regulamin (domyślny `CAI_REGULAMIN_URL`) |

`konfiguracja.json` (zmiana = edycja pliku i `buduj_strone.py`, bez zmian w kodzie):

| Pole | Domyślnie | Znaczenie |
|---|---|---|
| `aplikacja` | `https://app.content-ai.net/` | „Zaloguj się" |
| `rejestracja` | `https://app.content-ai.net/rejestracja` | „Załóż konto"; karty pakietów dokładają `?pakiet=standard\|premium`, strona EN `lang=en` |
| `dokumenty` | `https://app.content-ai.net/dokumenty/` | odnośniki do dokumentów prawnych (stopka, cennik, zakończenie, podstrony) |
| `email_kontakt` | `kontakt@content-ai.net` | stopka, FAQ, AI Act (`mailto:`); w Cloudflare wyłącz Email Address Obfuscation i Rocket Loader, inaczej CSP zablokuje ich skrypt |
| `ceny` | `standard:eur=19,pln=79;premium:eur=49,pln=199` | ten sam zapis i te same kwoty co `PLATNOSCI_CENY_WYSWIETLANE`; ceny końcowe; PL w zł, EN w EUR, druga waluta w notce; także JSON-LD `offers` |
| `koszt_artykulu` | `{"pl": "0,25-0,50 USD", "en": "$0.25-0.50"}` | szacunek kosztu modelu za artykuł (hero, cennik, FAQ, klucz API); wyliczenie i stawki w tekście `key-3-jak` |
| `data_stanu` | `2026-10-09` | „Stan na ..." podstron klucz API i AI Act (data odczytu cenników dostawców) |
| `audio_liczone` | `fragmenty` | jak serwer liczy audio: `fragmenty` (każde wywołanie lektora, uczciwy opis w cenniku) albo `nagrania` (jedno nagranie na budowanie; wariant tekstów `@nagrania`) |
| `oznaczenia` | `[]` | formaty, które aplikacja naprawdę oznacza: `docx`, `pdf`, `cms`, `jsonld`, `png`, `mp3`, `txt`, `etykiety` (widoczne etykiety); pusta lista = wariant `@przejsciowy` (FAQ i AI Act bez „wspiera wymogi" i bez opisu oznaczeń w plikach) |

Kontrole `buduj_strone.py --sprawdz` (zatrzymują CI): teksty PL i EN kompletne i użyte,
liczby i funkcje pakietów w cenniku zgodne z `serwer/plany.js` (`LICZBY_PAKIETOW`,
`BEZ_LIMITU`, `ZERO`, `FUNKCJE_W_TABELI`), poprawna `konfiguracja.json`, wersje dokumentów
PL i EN zgodne, długość przykładowego opisu meta zgodna z liczbą na stronie, tytuł do 70
i opis do 160 znaków, bez długich myślników i bez zakazanych sformułowań (`ZAKAZANE`:
nazwa dokumentu sprzedaży z VAT (PR8-11), „w pełni zgodne", „Poproś o dostęp", OpenSEO, DataForSEO,
NVIDIA, marki klientów).

Zmiana ceny: cena w Stripe, `PLATNOSCI_CENY_WYSWIETLANE` na serwerze i `ceny`
w `konfiguracja.json` (potem `buduj_strone.py` i wdrożenie `showcase/`). Strona nie łączy się
ze Stripe, więc zgodności kwot pilnuje serwer (`platnosci-sprawdz`), a tej trójki człowiek.

Caddy (`dokumenty/Caddyfile.content-ai`): nowe podstrony to katalogi z `index.html`, więc
dopasowanie nagłówków HTML powinno obejmować każdy adres zakończony ukośnikiem:
`@html path */ *.html`. Strona nie wysyła już niczego do aplikacji (bez formularza),
więc `connect-src` może zostać samym `'self'`.

### Dokumenty prawne (`/dokumenty/<nazwa>`)

Moduł `serwer/dokumenty-prawne.js`, szablony `dokumenty-prawne/<nazwa>.pl.md`
i `<nazwa>.en.md` (Markdown z nagłówkiem `tytul`, `wersja`, `data`; komentarze `<!-- -->`
dla prawnika nie trafiają na stronę). Trasa w `server.js`: `GET` i `HEAD`
`/dokumenty/<nazwa>?lang=pl|en` oraz `/en/dokumenty/<nazwa>`, bez logowania;
`?format=txt` oddaje plik tekstowy do pobrania (PDF: polecenie drukowania w przeglądarce).
Nagłówki: `X-Robots-Tag: noindex`, `Cache-Control: public, max-age=300`, kompresja brotli
albo gzip, bez skryptów.

| Nazwa | Dokument |
|---|---|
| `regulamin` | Regulamin (wersja zapisywana przy zgodzie: `CAI_REGULAMIN_WERSJA`) |
| `prywatnosc` | Polityka prywatności (`CAI_POLITYKA_WERSJA`) |
| `odstapienie` | pouczenie o odstąpieniu od umowy z wzorem formularza |
| `dpa` | umowa powierzenia przetwarzania danych z listą podprzetwarzających jako załącznikiem A |
| `podprzetwarzajacy` | lista podprzetwarzających z własną wersją i historią zmian |
| `uslugodawca` | dane usługodawcy i punkt kontaktowy |

Dane usługodawcy: znaczniki `WSTAW_TUTAJ_IMIE_I_NAZWISKO`, `_ADRES`, `_TELEFON`, `_EMAIL`,
`_WWW` w szablonach zastępują wartości `CAI_USLUGODAWCA_*` (tabela zmiennych wyżej).
W repozytorium zostają tylko znaczniki. Puste pole = na stronie widoczny znacznik
„do uzupełnienia" (EN „to be completed"); przy `PLATNOSCI_TRYB=live` serwer raz zapisuje
w dzienniku ostrzeżenie `[dokumenty] tryb live: ...` z nazwami pustych zmiennych (bez
wartości). Puste `CAI_USLUGODAWCA_WWW` = `https://content-ai.net`.

Usługi wymieniane warunkowo (polityka, lista podprzetwarzających): NVIDIA tylko przy
`NVIDIA_KEY`, ElevenLabs po stronie serwera tylko przy `ELEVEN_KEY`, DataForSEO tylko przy
`DATAFORSEO_LOGIN` i `DATAFORSEO_HASLO`. Bez nich dokumenty mówią to, co jest prawdą na
produkcji: Anthropic i OpenAI na kluczach serwera dla kont zespołu, ElevenLabs tylko na
własnym kluczu użytkownika.

Zmiana dokumentu: popraw oba języki, podnieś `wersja` i `data` w nagłówkach (PL i EN takie
same, pilnuje tego `buduj_strone.py`), ustaw tę samą wersję w `CAI_REGULAMIN_WERSJA` albo
`CAI_POLITYKA_WERSJA`, przebuduj stronę (wersje widać na `/regulamin/` i `/prywatnosc/`)
i zrestartuj serwer. Rozjazd wersji z konfiguracji i z nagłówka szablonu serwer zgłasza
w dzienniku (`[dokumenty] wersja w konfiguracji rozna od dokumentu: ...`), a funkcja
`rozjazdyWersji(konf)` modułu daje tę listę kontroli przy starcie. Zmiana listy
podprzetwarzających: nowy wiersz w historii zmian i nowa wersja listy. Zalecane adresy na ekranach i w e-mailach:
`CAI_REGULAMIN_URL=https://app.content-ai.net/dokumenty/regulamin`,
`CAI_POLITYKA_URL=https://app.content-ai.net/dokumenty/prywatnosc` (domyślne adresy
`content-ai.net/regulamin/` i `/prywatnosc/` też działają: prowadzą do tych dokumentów).
