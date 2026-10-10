# Content AI - serwer

Serwuje aplikację, pilnuje logowania i pośredniczy w wywołaniach API, dzięki czemu
klucze nigdy nie trafiają do przeglądarki.

**Zero zależności npm** - wyłącznie moduły wbudowane Node ≥ 22.13 (`fetch`, `node:sqlite`). Nie ma `npm install`.

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
| `POST /auth/login`, `GET /auth/logout`, `GET /auth/me` | logowanie; `/auth/me` zwraca też `email` i `organizacja: { id, nazwa, rodzaj, mozeZarzadzac }` |

Wszystko poza logowaniem wymaga aktywnej sesji (wyjątki: prośba o dostęp, ekrany
rejestracji i resetu hasła, dokumenty prawne i webhook płatności - niżej).

Runda 9 dokłada trasy nowych modułów. Router woła je w stałej kolejności
(`serwer/server.js`, funkcja `obsluz`), więc moduły nie dopisują tras w `server.js`:

| Kolejność | Trasy | Moduł |
|---|---|---|
| 1 | nagłówki bezpieczeństwa | `server.js` |
| 2 | `POST /api/prosba-o-dostep` (bez zmian) | `prosby.js` |
| 3 | `POST /platnosci/webhook/<dostawca>` - bez sesji i bez kontroli CSRF, podpis dostawcy | `platnosci.js` |
| 4 | `/rejestracja`, `/potwierdz`, `/haslo`, `/haslo/nowe`, `/do-widzenia` - publiczne, własna kontrola pochodzenia | `konta.js` |
| 5 | ogólna kontrola CSRF (bez zmian) | `server.js` |
| 6 | `GET /dokumenty/<nazwa>`, `GET /en/dokumenty/<nazwa>` - publiczne | `dokumenty-prawne.js` |
| 7 | `/auth/login`, `/auth/logout`, sesja (bez sesji: 401 z kodem `sesja` albo ekran logowania) | `server.js` |
| 8 | `/konto/zakup`, `/konto/panel`, `/konto/platnosc`, `/api/platnosci/*` | `platnosci.js` |
| 8 | `/api/klucze`, `/api/klucze/*` | `klucze.js` |
| 8 | `/konto`, `/konto/*`, `/api/konto`, `/api/konto/*` | `konta.js` |
| 8 | dalej dzisiejsze trasy w dzisiejszej kolejności | `server.js` |

Każda własna odmowa serwera ma nagłówek `X-CAI-Kod` (lista kodów: `serwer/bledy.js`,
PROJEKT-TECHNICZNY rozdz. 5). Dzisiejsze odpowiedzi 401 i 402 zachowują wszystkie pola,
także `error` jako napis, i dostają tylko `kod` oraz nagłówek.

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

Konta trzyma baza `serwer/dane/contentai.sqlite` (wbudowany `node:sqlite`, uprawnienia
`0600`, wykluczona z repo; szczegóły w sekcji [Magazyn danych](#magazyn-danych-sqlite)).
Dawny plik `uzytkownicy.json` usługa przenosi do bazy przy pierwszym starcie (migracja).
Hasła są haszowane **scryptem** z losową solą - nigdzie nie ma hasła jawnego.

| Rola | Co może |
|---|---|
| `admin` | wszystko, w tym `/api/status` |
| `uzytkownik` | korzystać z aplikacji |

Na serwerze polecenia idą przez `serwer/cli.sh`: ładuje `/etc/contentai/srodowisko`
i uruchamia CLI jako konto usługi `contentai`, więc widzi te same katalogi i bazę co
usługa, a pliki bazy nie powstają jako root (plik roota z trybem `0600` zablokowałby
usłudze zapis). `uzytkownicy.js` sam odmawia pracy, gdy katalog danych należy do
innego konta niż proces.

```bash
sudo serwer/cli.sh dodaj marcin admin      # pyta o hasło, bez echa
sudo serwer/cli.sh dodaj anna              # domyślnie rola uzytkownik
sudo serwer/cli.sh lista
sudo serwer/cli.sh haslo anna              # zmiana hasła
sudo serwer/cli.sh rola anna admin
sudo serwer/cli.sh usun anna
sudo serwer/cli.sh prosby 20               # ostatnie prośby o dostęp ze strony
sudo serwer/cli.sh migruj --sprawdz        # co przeniesie migracja z plików JSON (bez zmian)
sudo serwer/cli.sh eksport-json            # wycofanie do R8: pliki JSON z bazy
sudo serwer/cli.sh kopia                   # kopia bazy w trakcie pracy usługi
```

Lokalnie (testy, własny komputer) to samo wprost: `node serwer/uzytkownicy.js lista`.

Hasło ma minimum 10 znaków. Login: 2-40 znaków, małe litery `a-z`, cyfry, kropka,
podkreślnik i myślnik (baza wiedzy i liczniki trzymają login w nazwie pliku, więc dwa
różne loginy nie mogą dać tej samej nazwy). Ostatniego admina nie da się usunąć ani
zdegradować. Rola `admin` (operator serwera) istnieje tylko w organizacji głównej
zespołu. `usun` kasuje razem z kontem jego prywatną bazę wiedzy i liczniki użycia
(dane marki są wspólne dla zespołu i zostają), wpisuje konto do `konta_usuniete`
i wypisuje, co usunął; ostatnie konto organizacji samoobsługowej zabiera ze sobą jej
markę i bazę wspólną. Loginy z przedrostkiem `k-` są zarezerwowane dla kont
samoobsługowych. Katalogi danych CLI bierze ze środowiska - dlatego `cli.sh`.

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
| `uzytkownicy.js usun` | weryfikacja szuka konta w bazie - brak konta to koniec dostępu |
| `uzytkownicy.js haslo` | znacznik `sesjeOd` odcina wszystkie sesje wydane wcześniej |
| `uzytkownicy.js rola` | rola czytana z bazy przy każdym żądaniu - degradacja działa od razu |
| wylogowanie użytkownika | identyfikator trafia do tabeli `sesje_odwolane` w bazie |

Tabela sama się sprząta: wpisy po terminie wypadają przy sprzątaniu dobowym. Sekret
podpisu nie zmienił się przy przejściu na bazę, więc ciasteczka wydane przed migracją
są ważne po niej (nikt nie loguje się ponownie po wdrożeniu).

---

## Konfiguracja

Wszystko przez zmienne środowiskowe.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `PORT` | `3100` | port nasłuchu |
| `CAI_HOST` | `127.0.0.1` | interfejs; zostaw lokalny, ruch z zewnątrz puszcza Caddy |
| `CAI_UZYTKOWNICY` | `serwer/dane/uzytkownicy.json` | plik kont w formacie R8: czyta go tylko migracja przy starcie (potem `*.zmigrowany-<czas>`); katalog tego pliku to domyślny katalog bazy |
| `CAI_COOKIE_SECURE` | `1` | `0` **tylko** do testów lokalnych bez HTTPS |
| `CAI_SESJA_GODZIN` | `336` (14 dni) | ważność sesji |
| `CAI_SEKRET_SESJI` | losowany i zapisywany | sekret do podpisu ciasteczek |
| `CAI_ZAUFANY_NAGLOWEK` | - | nagłówek z loginem z bramy, np. `Remote-User` |
| `CAI_ZAUFANE_ADRESY` | pętla zwrotna | adresy, z których wolno przyjąć ten nagłówek |
| `CAI_DOSTAWCA` | `anthropic` | `anthropic` albo `nvidia` |
| `CAI_MODEL_NVIDIA` | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | model przy `nvidia` |
| `CAI_MODEL_GRAFIKI` | - (model z aplikacji: `gpt-image-2.5-flare`) | podmienia model grafik OpenAI w każdym zapytaniu, np. gdy dostawca wycofa model |
| `CAI_URL_NVIDIA` | `https://integrate.api.nvidia.com/v1/chat/completions` | endpoint NIM |
| `CAI_URL_ANTHROPIC` | `https://api.anthropic.com/v1/messages` | endpoint Anthropic (nadpisanie dla atrapy w testach i bram zgodnych z API) |
| `CAI_URL_OPENAI` | `https://api.openai.com/v1` | baza API OpenAI (grafiki, TTS, transkrypcja; nadpisanie dla atrapy) |
| `CAI_URL_ELEVEN` | `https://api.elevenlabs.io/v1` | baza API ElevenLabs (nadpisanie dla atrapy) |
| `ANTHROPIC_KEY` | - | klucz treści (dostawca `anthropic`) |
| `NVIDIA_KEY` | - | klucz treści (dostawca `nvidia`) |
| `OPENAI_KEY` | - | grafiki, TTS, transkrypcja |
| `ELEVEN_KEY` | - | głos premium |
| `CAI_SERP` | `model` | źródło danych SERP: `model`, `dataforseo` albo `openseo` |
| `CAI_SEO_PROJEKT` | - | id projektu OpenSEO (wymagane przy `CAI_SERP=openseo`) |
| `DATAFORSEO_LOGIN` | - | login DataForSEO (przy `CAI_SERP=dataforseo`) |
| `DATAFORSEO_HASLO` | - | hasło DataForSEO |
| `CAI_BAZA` | `serwer/dane/baza` | katalog bazy wiedzy |
| `CAI_UZYCIE` | `serwer/dane/uzycie` | liczniki pakietów w formacie R8 (tylko migracja i `eksport-json`; w działaniu liczniki są w bazie). Migracja bierze ten katalog, gdy leży obok pliku kont albo jest wskazany tą zmienną; cudzego nie rusza |
| `CAI_MODEL_EMBED` | `nvidia/nv-embedqa-e5-v5` | model wektorów |
| `CAI_URL_EMBED` | `https://integrate.api.nvidia.com/v1/embeddings` | endpoint wektorów |
| `CAI_COOKIE_DOMENA` | - | domena ciasteczka sesji, np. `.twojadomena.pl` |
| `CAI_OPENSEO_PORT` | - | port bramy OpenSEO; puste = brama wyłączona |
| `CAI_OPENSEO_UPSTREAM` | `3001` | port kontenera OpenSEO |
| `CAI_OPENSEO_HOST` | `127.0.0.1` | host kontenera OpenSEO |
| `CAI_OPENSEO_ADRES` | - | publiczny adres OpenSEO - dokłada pozycję w menu |
| `CAI_MARKA` | `serwer/dane` | katalog z `marka.json` |
| `CAI_SEKRET_PLIK` | `serwer/dane/sekret` | plik z sekretem sesji (gdy brak `CAI_SEKRET_SESJI`) |
| `CAI_WYLOGOWANE` | `serwer/dane/wylogowane.json` | lista sesji wylogowanych w formacie R8 (tylko migracja i `eksport-json`). Jak wyżej: migracja bierze plik obok pliku kont albo wskazany tą zmienną |
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

**Runda 9** (PROJEKT-TECHNICZNY rozdz. 6). Zasada: bez tych zmiennych serwer działa
dokładnie jak dziś. Funkcja z błędną albo niepełną konfiguracją jest wyłączana (wpis
`[konfiguracja] ... WYLACZONE: ...` w dzienniku z nazwami zmiennych, nigdy z wartościami;
stan w `/api/status`, sekcja `konfiguracja`), a serwer startuje dla istniejących kont.
W repozytorium tylko nazwy i wartości `WSTAW_TUTAJ_*`; prawdziwe wartości (klucze, dane
usługodawcy) wyłącznie w `/etc/contentai/srodowisko`.

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| **Magazyn** | | |
| `CAI_SQLITE` | `contentai.sqlite` w katalogu `CAI_UZYTKOWNICY` (`serwer/dane/contentai.sqlite`) | baza kont, liczników, sesji odwołanych, tokenów, zgód i płatności (WAL dokłada `-wal` i `-shm` obok) |
| `CAI_KOPIE` | `kopie` obok bazy | kopie bazy co godzinę, 48 ostatnich |
| **Konta samoobsługowe** (A1) | | |
| `CAI_REJESTRACJA` | `0` | `1` = rejestracja otwarta; wymaga `CAI_ADRES_PUBLICZNY`, danych usługodawcy, wersji regulaminu i polityki oraz `CAI_KLUCZ_CIASTEK`; wyklucza tryb bramy |
| `CAI_ADRES_PUBLICZNY` | - | `https://app.content-ai.net`: jedyne źródło adresów w e-mailach i adresów powrotu płatności (nigdy nagłówek `Host`) |
| `CAI_PLAN_NOWYCH` | `darmowy` | plan konta samoobsługowego bez subskrypcji (decyzja 3); nieznany = `darmowy` + błąd w dzienniku |
| `CAI_EMAIL_POTWIERDZENIE_GODZIN` | `48` | ważność linku potwierdzającego e-mail |
| `CAI_RESET_MINUT` | `60` | ważność linku resetu hasła |
| `CAI_RESET_ADMIN` | `0` | `1` = reset e-mailem także dla operatora |
| `CAI_NIEPOTWIERDZONE_DNI` | `30` | usuwanie niepotwierdzonych kont bez płatności i bez logowania |
| `CAI_USUWANIE_STARYCH` | `0` | `1` = konta organizacji `glowna` mogą usunąć się same |
| `CAI_REGULAMIN_WERSJA`, `CAI_POLITYKA_WERSJA` | - | wersje dokumentów zapisywane przy zgodzie (np. `2026-10-v1`) |
| `CAI_REGULAMIN_URL`, `CAI_POLITYKA_URL` | `https://content-ai.net/regulamin/`, `https://content-ai.net/prywatnosc/` | odnośniki na ekranach i w e-mailach |
| `CAI_WYMUS_AKCEPTACJE` | `0` | `1` = nowa wersja regulaminu blokuje API do akceptacji |
| `CAI_ZGODY_DLA_STARYCH` | `0` | `1` = konta `glowna` też akceptują regulamin |
| `CAI_ZGODY_IP` | `0` | `1` = zapis adresu IP przy zgodzie (decyzja prawa) |
| `CAI_TURNSTILE_KLUCZ`, `CAI_TURNSTILE_SEKRET` | - | Cloudflare Turnstile na rejestracji i resecie (opcja, domyślnie wyłączona) |
| **Dane usługodawcy** (osoba fizyczna, decyzja 2; ekrany, e-maile, `/api/konto`, dokumenty prawne) | | |
| `CAI_USLUGODAWCA_IMIE_NAZWISKO` | - | imię i nazwisko (starsza nazwa z projektu `CAI_USLUGODAWCA_NAZWA` działa tak samo) |
| `CAI_USLUGODAWCA_NAZWA` | - | zapasowa nazwa `CAI_USLUGODAWCA_IMIE_NAZWISKO` |
| `CAI_USLUGODAWCA_ADRES` | - | adres do doręczeń |
| `CAI_USLUGODAWCA_TELEFON` | - | telefon (opcjonalnie) |
| `CAI_USLUGODAWCA_EMAIL` | - | e-mail kontaktowy, rachunek na żądanie, domyślny `Reply-To` poczty |
| `CAI_USLUGODAWCA_WWW` | - | adres strony (opcjonalnie) |
| **Dzierżawy, własne klucze, zasoby serwera** (C) | | |
| `CAI_SERP_SAMOOBSLUGA` | `dataforseo` przy danych DataForSEO, inaczej `model` | źródło SERP organizacji innych niż `glowna`; `openseo` odrzucane |
| `CAI_ZADANIA_MB` | `200` | budżet pamięci wyników zadań w tle |
| `CAI_KLUCZ_CIASTEK` | - | klucz szyfrujący ciasteczek z kluczami użytkowników (32 bajty base64: `openssl rand -base64 32`, SEC8-04); zmiana = zapamiętane klucze nieważne |
| **Poczta** (C) | | |
| `CAI_POCZTA` | `log` | `resend` albo `log`; `resend` bez klucza albo nadawcy schodzi na `log` z błędem w dzienniku |
| `CAI_POCZTA_KLUCZ` | - | klucz API Resend (`re_...`), tylko wysyłka dla domeny |
| `CAI_POCZTA_OD` | - | nadawca, np. `Content AI <konto@mail.content-ai.net>` |
| `CAI_POCZTA_ODPOWIEDZ` | `CAI_USLUGODAWCA_EMAIL` | `Reply-To` |
| `CAI_POCZTA_URL` | `https://api.resend.com` | nadpisanie dla atrapy w testach |
| `CAI_POCZTA_LOG` | - | plik JSON Lines z pełnymi wiadomościami (tylko testy i środowisko testowe) |
| **Płatności - rdzeń** (B) | | |
| `PLATNOSCI` | - | `stripe`; puste = płatności wyłączone, serwer jak dziś |
| `PLATNOSCI_TRYB` | - | `test` albo `live`; wymagane przy `PLATNOSCI`, sprawdzane z prefiksem klucza |
| `PLATNOSCI_SPRZEDAZ` | `1` | `0` = brak nowych zakupów; webhook, panel i uzgadnianie działają |
| `PLATNOSCI_WALUTY` | `eur,pln` | waluty oferowane |
| `PLATNOSCI_WALUTA_DOMYSLNA` | `eur` | waluta dla interfejsu innego niż polski |
| `PLATNOSCI_WALUTA_PL` | `pln` | waluta dla interfejsu polskiego (M-1) |
| `PLATNOSCI_CENY_WYSWIETLANE` | - | `standard:eur=19,pln=79;premium:eur=49,pln=199`; puste = kwoty od dostawcy |
| `PLATNOSCI_ZALEGLA_DNI` | `7` | okres łaski przy zaległej płatności |
| `PLATNOSCI_DLA_STARYCH` | `0` | `1` = konta `glowna` mogą kupować (M-7) |
| `PLATNOSCI_PROBA_DNI` | `0` | dni okresu próbnego w Checkout (M-6: bez) |
| `PLATNOSCI_KODY_RABATOWE` | `0` | kody rabatowe w Checkout (M-6) |
| `PLATNOSCI_NIP_KLIENTA` | `0` | zbieranie NIP klienta (decyzja 2: wyłączone) |
| `PLATNOSCI_PODATKI` | `0` | automatyczne podatki dostawcy (dopiero po rejestracji działalności) |
| `PLATNOSCI_PROG_KWARTAL_PLN` | `10813.5` | limit kwartalny działalności nierejestrowanej (PR8-09; wartość od prawa, zmienia się z płacą minimalną) |
| `PLATNOSCI_PROGI_OSTRZEZEN` | `60,80` | progi ostrzeżeń w procentach limitu kwartalnego |
| `PLATNOSCI_WSTRZYMAJ_PO_PROGU` | `0` | `1` = po przekroczeniu limitu sprzedaż nowym klientom wstrzymana |
| `PLATNOSCI_PROG_UE_EUR` | `10000` | próg sprzedaży B2C do innych krajów UE w roku |
| `PLATNOSCI_KURS_EUR_PLN` | `4.25` | przybliżony kurs tylko do ostrzeżeń |
| `PLATNOSCI_KRAJE` | 27 krajów UE | kraje, w których sprzedajemy (D-04), kody ISO po przecinku |
| `PLATNOSCI_METODY` | `card` | metody płatności (D-12), np. `card,blik` |
| `PLATNOSCI_ZWROT` | `proporcjonalny` | zwrot przy odstąpieniu w 14 dni (D-03): `proporcjonalny` albo `pelny` |
| **Stripe - adapter** (B) | | |
| `STRIPE_KLUCZ` | - | klucz ograniczony `rk_test_...` / `rk_live_...` |
| `STRIPE_SEKRET_WEBHOOKA` | - | `whsec_...`, kilka po przecinku na czas zmiany |
| `STRIPE_CENA_<PLAN>` | - | dla każdego pakietu na sprzedaż: `STRIPE_CENA_STANDARD=price_...` albo `eur:price_a,pln:price_b` |
| `STRIPE_WERSJA_API` | stała `WERSJA_API` w adapterze | wersja wysyłana w `Stripe-Version` |
| `STRIPE_URL_API` | `https://api.stripe.com` | nadpisanie dla atrapy |
| `STRIPE_PORTAL_KONFIGURACJA` | - | `bpc_...`, gdy jest kilka konfiguracji Portalu |
| `STRIPE_HOSTY_PRZEKIEROWAN` | `https://checkout.stripe.com https://billing.stripe.com` | hosty dopisywane do `form-action` na ekranach płatności |
| **Oznaczenia AI** (D) | | |
| `CAI_OZNACZENIA` | `1` | `0` = awaryjne wyłączenie warstwy maszynowej i etykiet (niezalecane; ślad w dzienniku) |

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
| Wywołania modelu (sufit) | 30 (na własnym kluczu: 47) | 750/mies. | bez limitu |
| Dokumenty w bazie | 3 | 50 | bez limitu |
| Analiza SERP | - | tak | tak |
| Dane z OpenSEO | - | - | tak |
| Własny klucz API, CMS | - | tak | tak |

```bash
node serwer/uzytkownicy.js plan anna standard
```

Konto bez wpisanego planu dostaje darmowy (konto samoobsługowe: `CAI_PLAN_NOWYCH`, domyślnie
darmowy). **Admin zawsze działa jak premium**, niezależnie od wpisu - inaczej właściciel
systemu mógłby sobie zablokować własne narzędzie (od rundy 9: admin organizacji głównej).

Konta na **własnym kluczu** (`zrodlo_kluczy='wlasne'`, każde konto z rejestracji) mają
dwie różnice, a konta zespołu na kluczach serwera działają dokładnie jak dziś, także gdy
mają ten sam pakiet:

- sufit wywołań z `limityWlasneKlucze` (pakiet darmowy: 47, decyzja M-3: trzy pełne artykuły
  z zapasem 30%). Pomiar na atrapie: artykuł z siecią i SERP, samokorektą, ocenami
  SEO/AIO/AEO/GEO, Faktami i Lukami z poprawą to 9 wywołań modelu (typ Hybryda SEO + AIO),
  w najgorszym zmierzonym wariancie 12 (Artykuł SEO z oceną i poprawą w trakcie generowania,
  wyszukiwanie z `pause_turn`); 3 × 12 × 1,3 = 46,8, czyli 47. AEO i GEO liczy przeglądarka,
  bez wywołań,
- osobna pula zasobów opłacanych przez serwer, `limitySerwera` pakietu: `serp` (DataForSEO),
  `wektory` (wyszukiwanie po znaczeniu), `strony` (pobieranie stron i sprawdzanie odnośników),
  liczona w tej samej tabeli jako `serwer:<zasob>` (`plany.sprawdzLimitSerwera`, `plany.policzSerwer`).
  `0` znaczy "niedostępne w pakiecie": tak jest z `wektory` we wszystkich pakietach (decyzja D-09,
  konta samoobsługowe szukają w bazie po słowach kluczowych, bez NVIDIA). Liczby z projektu
  (20 / 1000 / 5000) wracają zmianą tej wartości w `plany.js`.

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

Liczniki leżą w bazie (tabela `uzycie`: konto, okres `zawsze` albo `RRRR-MM`, czynność),
dopisywane atomowo. Miesięczne okresy starsze niż rok wypadają przy sprzątaniu dobowym.

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
# 1. Kod i Node (wymagany Node >= 22.13 - sprawdź `node -v` po instalacji; node:sqlite)
sudo apt update && sudo apt install -y git nodejs
sudo git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai

# 2. Konto systemowe usługi i katalog na dane
sudo useradd --system --home-dir /srv/contentai --shell /usr/sbin/nologin contentai
sudo mkdir -p /srv/contentai/serwer/dane
sudo chown -R contentai:contentai /srv/contentai/serwer/dane

# 3. Pierwsze konto administratora - jako użytkownik usługi, nie root
cd /srv/contentai
sudo -u contentai node --disable-warning=ExperimentalWarning serwer/uzytkownicy.js dodaj marcin admin
# (po kroku 4 to samo krócej: sudo serwer/cli.sh dodaj marcin admin)

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
`serwer/dane/` (baza z plikami `-wal` i `-shm`, kopie, sekret sesji, baza wiedzy).
**Nie zamieniaj tego na `DynamicUser=yes`**: systemd nadaje wtedy
zmienny UID i nie przejmuje na własność katalogu z `ReadWritePaths`, więc proces
nie zapisze ani sekretu sesji, ani bazy kont. Serwer przeżywa to po cichu -
objawem byłoby wylogowywanie po każdym restarcie.

Plik usługi uruchamia Node z `--disable-warning=ExperimentalWarning` (`node:sqlite` ma
w Node 22 status 1.1) i `--max-old-space-size=900`, ma `MemoryHigh=1200M`, `MemoryMax=1500M`
(przekroczenie zabija tylko Content AI, `Restart=always` go podnosi), `UMask=0077` (pliki
bazy tylko dla konta usługi), `LimitCORE=0` (zrzut pamięci zapisałby klucze z zapytań)
i utwardzenie z SEC8-41 (`CapabilityBoundingSet=`, `SystemCallFilter=@system-service`,
`ProtectProc=invisible` i pokrewne). Po zmianie pliku: `sudo cp` jak wyżej
i `sudo systemctl daemon-reload`. Środowisko testowe (`test.content-ai.net`, port 3101):
`serwer/contentai-test.service` - osobny klon w `/srv/contentai-test`, osobny plik
`/etc/contentai/srodowisko-test`, bez wglądu w dane produkcji.

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
- **Dziennik bez kluczy (SEC8-01)**: `log default` z `format filter` w bloku globalnym
  usuwa z każdego wpisu Caddy nagłówki `X-Api-Key`, `X-Openai-Key`, `X-Eleven-Key`,
  `Xi-Api-Key`, `Cookie` (zaszyfrowane klucze BYOK), `Authorization` i `Set-Cookie`. Bez
  filtra błąd 502 (restart Node) zapisywał do journald całe żądanie z kluczami jawnym
  tekstem. Własne `log { output file ... }` w bloku domeny ma osobny format: dopisz do niego
  ten sam filtr. Sprawdzenie: `journalctl -u caddy --no-pager -o cat | grep -c -E
  'X-Api-Key|X-Openai-Key|X-Eleven-Key'` daje 0.
- **`lb_try_duration 10s`** (ARCH8-25): w oknie restartu (nowy proces wstaje 1-2 s) Caddy
  ponawia połączenie co 250 ms zamiast od razu oddać 502. Strony i odczyty przeczekują
  restart; wywołania dostawców w trakcie łagodnego zatrzymania dostają 503 z `Retry-After`
  (aplikacja ponawia je sama, rozdział "Własne klucze").
- **`test.content-ai.net`** (zakomentowany, M-9): środowisko testowe za `basic_auth` poza
  `/platnosci/webhook/*`, port 3101 (`serwer/contentai-test.service`).

### Aktualizacja

```bash
cd /srv/contentai && sudo git pull
sudo systemctl restart contentai
```

Gdy wydanie zmienia blok Caddy (`dokumenty/Caddyfile.content-ai`): **najpierw** Caddyfile,
`caddy validate` i `systemctl reload caddy`, **dopiero potem** `git pull` i restart.

**Pierwsze wdrożenie rundy 9 (konta w bazie)** - poza godzinami pracy:

1. kopia danych: `sudo tar czf /root/contentai-dane-$(date +%F-%H%M).tgz -C /srv/contentai/serwer dane`
   i `git -C /srv/contentai rev-parse HEAD | sudo tee /root/contentai-poprzedni-commit`;
2. `sudo git pull`, nowy plik usługi (`sudo cp serwer/contentai.service /etc/systemd/system/`,
   `sudo systemctl daemon-reload`), restart. Bez nowych zmiennych wszystkie nowe funkcje są
   wyłączone, a konta zespołu działają jak dotąd;
3. przy starcie usługa przenosi `uzytkownicy.json`, `uzycie/` i `wylogowane.json` do bazy
   w jednej transakcji: w dzienniku `[magazyn] migracja: N kont, M licznikow, K sesji`,
   oryginały zostają jako `*.zmigrowany-<czas>`, a ich kopia w `dane/przed-migracja-<czas>/`;
   awaria w połowie wycofuje transakcję i zostawia pliki JSON nietknięte (usługa się wtedy
   nie podnosi - wróć do poprzedniego commitu jak niżej);
4. sprawdzenie: `sudo serwer/cli.sh lista` (te same konta i pakiety), w przeglądarce
   istniejące konto bez ponownego logowania (ciasteczko sprzed migracji jest ważne),
   odznaka pakietu z tym samym zużyciem, `/api/status` (sekcje `magazyn`, `konfiguracja`).

**Wycofanie do poprzedniego wydania** (PROJEKT-TECHNICZNY 12.6): `sudo serwer/cli.sh eksport-json`
zapisuje `uzytkownicy.json`, `uzycie/` i `wylogowane.json` w dawnym formacie (tylko konta
zespołu; konta samoobsługowe czekają w bazie), potem
`sudo git checkout $(cat /root/contentai-poprzedni-commit)`, poprzedni plik usługi,
`daemon-reload` i restart. Powrót do nowego wydania to `git checkout` i restart: migracja
przy starcie przenosi zmiany z czasu wycofania (hasła, pakiety, liczniki, konta usunięte
w starym wydaniu znikają też z bazy).

---

## Bezpieczeństwo

Co serwer robi:

- hasła haszowane scryptem z losową solą, porównanie odporne na pomiar czasu; w ścieżkach
  HTTP scrypt liczy pula wątków (najwyżej dwa naraz), więc logowania nie zatrzymują
  generowania innym (SEC8-23)
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

Konta, liczniki, wylogowania, tokeny, zgody i płatności leżą w bazie - patrz
[Magazyn danych](#magazyn-danych-sqlite). Każdy pozostały plik danych (baza wiedzy, marka, sekret) jest
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

---

## Magazyn danych (SQLite)

Od rundy 9 konta, liczniki pakietów, wylogowane sesje, tokeny e-mailowe, zgody, zdarzenia
i rejestr płatności leżą w jednej bazie wbudowanego modułu `node:sqlite` (Node ≥ 22.13,
bez zależności npm): `serwer/dane/contentai.sqlite` (`CAI_SQLITE`). Baza wiedzy, marka
i sekret sesji zostają plikami.

- **Jeden moduł**: `serwer/magazyn.js` to jedyne miejsce z SQL (funkcje domenowe:
  `konto`, `kontoPoEmailu`, `utworzKonto`, `zmienKonto`, `policz`, `zarezerwuj`,
  `odwolajSesje`, `zapiszToken`, `dopiszZgode`, `zapiszZdarzenie`, `transakcja`...).
  Nowa kolumna to numerowana migracja schematu w tym pliku; wersja schematu w tabeli `meta`.
- **Tryb pracy**: WAL, `synchronous=FULL`, klucze obce; zmiana jednego konta to jeden
  wiersz w transakcji (koniec zgubionych zmian między CLI a serwerem). Odczyt konta przy
  każdym zapytaniu trwa mikrosekundy zamiast parsowania całego pliku kont.
- **Błędy**: baza zajęta ponad limit czekania, uszkodzona albo niedostępna to 503
  „dane chwilowo niedostępne" (jak uszkodzony plik), nigdy „nie ma takiego konta";
  uszkodzony plik bazy zostaje nietknięty, a obok ląduje kopia `.uszkodzony-<czas>`.
- **Kopie**: usługa robi kopię w trakcie pracy co godzinę do `CAI_KOPIE` (48 ostatnich,
  pliki `0600`); ręcznie `sudo serwer/cli.sh kopia [plik]`. Kopia poza serwerem: SEC8-43.
- **Sprzątanie dobowe**: sesje odwołane po terminie, tokeny tydzień po terminie, zdarzenia
  płatności starsze niż 90 dni, liczniki miesięczne starsze niż 13 miesięcy.
- **Migracja z plików** (`serwer/migracja.js`): przy starcie, gdy leży `uzytkownicy.json`.
  Najpierw czyta i sprawdza wszystko (uszkodzony plik przerywa migrację przed pierwszym
  zapisem), potem jedna transakcja; dopiero po niej kopia do `dane/przed-migracja-<czas>/`
  i zmiana nazw na `*.zmigrowany-<czas>`. Ponowna migracja tych samych plików niczego nie
  zmienia. `sudo serwer/cli.sh migruj --sprawdz` pokazuje wynik bez zmian.
  Do czasu migracji CLI odmawia pracy na bazie (pusta lista kont myliłaby).
- **Wycofanie**: `sudo serwer/cli.sh eksport-json` (sekcja Aktualizacja).

Organizacje (dzierżawy): każde konto należy do organizacji; dzisiejsze konta i konta
z `uzytkownicy.js dodaj` do organizacji `glowna` (marka i baza wspólna zespołu na
dzisiejszych ścieżkach), konto samoobsługowe do własnej `o-...`. Reguły i ścieżki plików
organizacji: `serwer/dzierzawy.js` (`operator`, `mozeZarzadzac`, `zrodloSerp`, `plikMarki`,
`plikBazyWspolnej`). Ogólny ogranicznik prób dla nowych formularzy: `serwer/limity.js`.

## Konta samoobsługowe

`serwer/konta.js` (trasy i reguły) i `serwer/ekrany-kont.js` (ekrany): rejestracja,
potwierdzenie e-maila, logowanie e-mailem, reset hasła, ekran konta, zgody, eksport
danych i usunięcie konta. SQL tylko w `magazyn.js`, e-maile przez `poczta.wyslij` (C),
anulowanie subskrypcji przez `platnosci.anulujDlaKonta` (B). Ekrany to czysty HTML bez
skryptów, pod tą samą CSP co logowanie, z `Cache-Control: no-store`, po polsku i angielsku
(`?lang=`), w jasnym i ciemnym motywie.

**Bez nowych zmiennych konta zespołu działają jak dziś**: ekran logowania ma "Poproś
o dostęp" i zdanie o administratorze, `/rejestracja` pokazuje logowanie, a nowe są tylko
etykieta "E-mail lub login" i odnośnik "Nie pamiętasz hasła?" (bez `CAI_ADRES_PUBLICZNY`
prowadzi do informacji, że hasło konta zespołu zmienia administrator). Konto zespołu
(organizacja `glowna`) zachowuje login, klucze serwera i pakiet; z adresem e-mail
(`uzytkownicy.js email`) loguje się nim albo loginem. Rejestrację otwiera
`CAI_REJESTRACJA=1` (z pełną konfiguracją, inaczej funkcja zostaje wyłączona z wpisem
w dzienniku). Reset hasła i odnośniki w e-mailach działają, gdy jest poprawny
`CAI_ADRES_PUBLICZNY`, także przy zamkniętej rejestracji, więc jej zamknięcie nie odcina
istniejących klientów.

### Przepływy

| Trasa | Co robi |
|---|---|
| `GET/POST /rejestracja` | e-mail, hasło (10-256 znaków, nie z listy najczęstszych, inne niż e-mail), zgody: regulamin i ukończone 18 lat (osobne, niezaznaczone pola) oraz informacja o administratorze danych z odnośnikiem do polityki. Konto `k-...` i organizacja `o-...` w jednej transakcji, zgody z wersją (`CAI_REGULAMIN_WERSJA`, `CAI_POLITYKA_WERSJA`) i czasem, klucze `wlasne`, plan `CAI_PLAN_NOWYCH`. Sesja od razu, `303` do aplikacji albo, przy `?pakiet=` i włączonych płatnościach, do zakupu (`/konto/zakup?plan=...`). Zajęty adres: komunikat przy polu (logowanie od razu po rejestracji i tak zdradza, czy adres był wolny) |
| `GET /potwierdz?t=`, `POST /potwierdz` | GET tylko pokazuje przycisk (skanery poczty otwierają linki), POST potwierdza. Link 48 h (`CAI_EMAIL_POTWIERDZENIE_GODZIN`), jednorazowy, nowy unieważnia poprzedni. Ten sam ekran potwierdza zmianę adresu (link 24 h na nowy adres) |
| `/auth/login` | pole "E-mail lub login" (znak `@` = e-mail). Do limitu prób per IP dochodzi limit per konto: 20 nieudanych prób w godzinę blokuje logowanie hasłem na 15 minut; komunikat proponuje reset, a reset działa mimo blokady. Przy otwartej rejestracji "Załóż konto" zamiast "Poproś o dostęp". Język: polski, gdy polski stoi w `Accept-Language` najwyżej, inaczej angielski (jak aplikacja); bez nagłówka polski |
| `GET/POST /haslo` | ta sama odpowiedź dla istniejącego i nieistniejącego adresu; list idzie po wysłaniu odpowiedzi (stały czas). Operator serwera bez resetu e-mailem (`CAI_RESET_ADMIN=0`), w trybie bramy reset wyłączony |
| `GET/POST /haslo/nowe?t=` | GET nie zużywa tokenu (60 min, `CAI_RESET_MINUT`); POST ustawia hasło, `sesje_od` (wylogowanie wszędzie), potwierdza e-mail, zdejmuje blokadę prób, kasuje ciasteczka kluczy, loguje i wysyła "hasło zmienione" |
| `GET /konto` | adres (stan, ponowne wysłanie linku, zmiana po podaniu hasła: link na nowy adres, informacja na stary), hasło (zmiana wylogowuje inne urządzenia i usuwa zapamiętane klucze), pakiet i zużycie (sekcja płatności od B, jeśli jest), "Wyloguj na wszystkich urządzeniach", eksport, regulamin i prywatność, usunięcie |
| `GET /konto/eksport` | JSON do pobrania: konto (bez `hash` i `sol`), organizacja, zgody, zużycie, płatności, baza wiedzy (tekst bez wektorów), marka organizacji. Historia artykułów jest tylko w przeglądarce (eksport w aplikacji) |
| `GET/POST /konto/usun` | hasło i "rozumiem". Najpierw anulowanie subskrypcji przez B: błąd = `503`, konto zostaje (klient nie płaci za usunięte konto). Potem konto i organizacja w jednej transakcji, wpis `konta_usuniete` ze skrótem e-maila (bez adresu), pliki konta i organizacji (z kopiami `.uszkodzony-*` i `.tmp-*`); odpowiedź z `Clear-Site-Data: "cache", "cookies", "storage"`, ciasteczkami kasującymi sesję i klucze, list "konto usunięte". Konta zespołu: nie (administrator, `uzytkownicy.js usun`), chyba że `CAI_USUWANIE_STARYCH=1` |
| `GET/POST /konto/zgody` | akceptacja nowej wersji regulaminu (gdy `CAI_REGULAMIN_WERSJA` różni się od zaakceptowanej) |
| `/do-widzenia` | publiczny ekran po usunięciu |

Do potwierdzenia adresu konto na własnym kluczu pisze normalnie, ale zasoby opłacane przez
serwer czekają: `POST /api/strona` i `POST /api/odnosniki` (akcja `strony`) odpowiadają
`403 email-niepotwierdzony`; SERP i wektory sprawdza C przez `konta.wymagaPotwierdzenia(konto)`.
Konta niepotwierdzone, bez płatności i bez logowania od `CAI_NIEPOTWIERDZONE_DNI` (30) znikają
przy sprzątaniu dobowym. Przy `CAI_WYMUS_AKCEPTACJE=1` nowa wersja regulaminu blokuje
zapisujące trasy `/api/*` kodem `403 zgoda-wymagana` (poza `/api/konto*` i przerwaniem zadania)
do akceptacji; konta zespołu tylko przy `CAI_ZGODY_DLA_STARYCH=1`.

### Ochrona formularzy

| Mechanizm | Wartość |
|---|---|
| pułapka | ukryte pole `strona`: wypełnione = udawany sukces, bez konta |
| znacznik czasu | podpisany sekretem sesji; formularz szybszy niż 3 s albo starszy niż 2 h jest odrzucany |
| rejestracja | 5 na godzinę z adresu IP, 20 na dobę z sieci `/24` (IPv6: `/48`), 300 na dobę łącznie (`429` z `Retry-After`) |
| reset hasła | 5 na godzinę z adresu IP, 3 na godzinę na adres e-mail (bez zdradzania, czy konto istnieje) |
| tokeny z e-maili | `POST /potwierdz`, `/haslo/nowe`: 30 na godzinę z adresu IP |
| ponowny link potwierdzający | raz na minutę, 3 na godzinę na konto |
| hasło na ekranie konta | 10 nieudanych prób na godzinę na konto |
| Cloudflare Turnstile | opcja: `CAI_TURNSTILE_KLUCZ` i `CAI_TURNSTILE_SEKRET` (oba albo żaden); CSP tych dwóch ekranów dopuszcza wtedy `challenges.cloudflare.com` |

Liczniki leżą w pamięci procesu (`serwer/limity.js`), jak licznik logowania; restart je zeruje.
Tokeny z e-maili: 32 losowe bajty, w bazie tylko `sha256`, jednorazowe; odnośniki zawsze
z `CAI_ADRES_PUBLICZNY`, nigdy z nagłówka `Host`. Formularze `/konto/*` niosą token CSRF
(HMAC sekretem sesji z loginu i identyfikatora sesji) obok kontroli pochodzenia; ciasteczko
sesji zostaje `SameSite=Lax`, bo powrót ze Stripe i linki z poczty to nawigacje z innej witryny.

### JSON dla aplikacji

- `GET /api/konto`: login, e-mail i jego stan (`potwierdzenie.wyslano`, `ponowZa`),
  organizacja (`mozeZarzadzac`), pakiet, subskrypcja i płatności (B), zgody
  (`wymagaAkceptacji`), oznaczenia (D), dane usługodawcy, `mozliwosci`, adresy ekranów
  i `csrf` do formularzy `/konto/*`.
- `POST /api/konto/potwierdzenie`: ponowne wysłanie linku (`429 za-duzo-prob` z `ponowZa`).
- `POST /api/konto/zgody` `{ regulamin?, polityka?, marketing? }`,
  `POST /api/konto/ustawienia` `{ oznaczenia?, jezyk? }`.

### CLI

```bash
sudo serwer/cli.sh pokaz anna@firma.pl          # konto, organizacja, klucze, pakiet, zużycie, subskrypcja, zgody (bez hasha)
sudo serwer/cli.sh email anna anna@firma.pl     # adres logowania od administratora (od razu potwierdzony)
sudo serwer/cli.sh email anna -                 # konto zespołu bez adresu (loguje się loginem)
sudo serwer/cli.sh klucze k-abcdefgh2345 serwera  # źródło kluczy: wlasne|serwera (bez argumentu pokazuje)
sudo serwer/cli.sh organizacja anna@firma.pl    # organizacja: konta, pliki marki i bazy wspólnej
sudo serwer/cli.sh organizacja o-abcdefgh2345 nazwa Biuro Nowak   # nazwa (`-` usuwa)
```

Każde polecenie przyjmuje login albo e-mail. `email` sprawdza format i unikalność, a linki
wysłane wcześniej na stary adres przestają działać; konto samoobsługowe nie może zostać
bez adresu. Zmiana kluczy działa od następnego zapytania, bez restartu.

### Włączenie

1. Dane usługodawcy (`CAI_USLUGODAWCA_*`), `CAI_ADRES_PUBLICZNY`, wersje dokumentów,
   `CAI_KLUCZ_CIASTEK` (C) i poczta (`CAI_POCZTA`, C) w `/etc/contentai/srodowisko`.
2. `CAI_REJESTRACJA=1` i restart; dziennik startu pokazuje `rejestracja: otwarta`.
3. Opcjonalnie Turnstile (klucz i sekret z panelu Cloudflare).

## Płatności

Wykonawca B. Rdzeń niezależny od dostawcy (`serwer/platnosci.js`), adapter Stripe na `fetch`
z przypiętą wersją API `2025-03-31.basil` (`serwer/platnosci-stripe.js`, jedyny plik, który zna
Stripe), ekrany bez JavaScriptu (`serwer/ekrany-platnosci.js`), polecenia CLI (`serwer/platnosci-cli.js`),
atrapa Stripe (`narzedzia/atrapa/stripe.js`) i testy (`serwer/testy-platnosci.js`).
Bez `PLATNOSCI` wszystkie trasy płatności odpowiadają `404 platnosci-wylaczone`, webhook przechodzi
dalej jak dziś, a konta działają w swoich pakietach. Błąd konfiguracji wyłącza tylko płatności
(wpis `[konfiguracja]` w dzienniku i `/api/status.konfiguracja.platnosci.bledy`, z nazwami zmiennych).

Marcin sprzedaje jako osoba fizyczna bez działalności (decyzja 2): bez Stripe Tax i bez NIP klienta,
rejestr wpłat i zwrotów, licznik przychodu w kwartale z progami, sprzedaż tylko do krajów
z `PLATNOSCI_KRAJE` (D-04), odstąpienie w 14 dni ze zwrotem proporcjonalnym (D-03, `PLATNOSCI_ZWROT`).

### Jak to działa

- **Zakup** (ARCH8-19): aplikacja woła `POST /api/platnosci/zakup` i robi `location.assign(url)`, a ekran
  serwera `GET /konto/zakup?plan=&waluta=&z=app|konto` ma formularz `POST /konto/zakup` (303 do Checkout).
  Ekran pokazuje podsumowanie (cena końcowa, odnawianie co miesiąc, rezygnacja), dwa osobne pola zgody
  (regulamin z pouczeniem; żądanie rozpoczęcia świadczenia przed upływem 14 dni, PR8-31), informację
  o krajach UE i dane usługodawcy. Oba oświadczenia trafiają do `zgody` (wersja regulaminu, źródło
  `zakup`) przed przekierowaniem; identyfikator zgody i wersja idą w `metadata` sesji. Kolejność kontroli:
  sprzedaż, prawo zakupu (konta `glowna` i operator tylko przy `PLATNOSCI_DLA_STARYCH=1`), pakiet,
  waluta, żywa subskrypcja (409), zgoda, limit 10 sesji na godzinę, cena, wyłącznik po progu.
- **Waluta** (M-1): klient, który już płacił, zawsze w swojej walucie (Stripe nie łączy walut u klienta);
  potem wybrana; potem z języka (`PLATNOSCI_WALUTA_PL` dla polskiego, `PLATNOSCI_WALUTA_DOMYSLNA` dla innych).
- **Checkout**: `mode=subscription`, `currency` przy cenie wielowalutowej, `client_reference_id` = login,
  adres rozliczeniowy wymagany, metody z `PLATNOSCI_METODY` (`auto` = ustawienia panelu Stripe; BLIK tylko
  dla PLN; Przelewy24 odrzucane, PR8-13), bez `automatic_tax` i `tax_id_collection` (opcje
  `PLATNOSCI_PODATKI`, `PLATNOSCI_NIP_KLIENTA`), tekst nad przyciskiem "zamawiasz subskrypcję z obowiązkiem
  zapłaty ... co miesiąc" (`custom_text.submit`). Zgodę na regulamin zbiera nasz ekran, nie Checkout
  (`consent_collection` wymaga adresu regulaminu w panelu Stripe i dublowałby pole).
- **Ceny** (ARCH8-17): kwoty na ekranach z `PLATNOSCI_CENY_WYSWIETLANE`, obciążenie zawsze według ceny
  w Stripe. Ceny u dostawcy są pobierane przy starcie (bez sieci: ostrzeżenie i ponowienie po 5 min),
  co 6 h i przed pierwszą sprzedażą; pozycja (pakiet i waluta) z ceną nieaktywną, nie miesięczną,
  z innego trybu albo inną niż na ekranie jest wstrzymana (`400 plan-niedostepny`, `powod: 'cena'`).
- **Powrót** `GET /konto/platnosc?wynik=ok&sesja={CHECKOUT_SESSION_ID}&z=`: sesja musi należeć do
  zalogowanego konta (inaczej 403), stan z API bez czekania na webhook, potem 303 na
  `/?platnosc=ok|oczekuje|kraj|anulowana` (przy `z=konto` na `/konto?platnosc=...`). `oczekuje`: aplikacja
  odpytuje `GET /api/platnosci/stan`, webhook dokończy.
- **Panel klienta**: `POST /api/platnosci/panel` albo formularz `POST /konto/panel` (303 do Customer Portal,
  powrót `/?konto=1` albo `/konto`). Zmiana pakietu, karty i anulowanie na koniec okresu są w Portalu.
- **Webhook** `POST /platnosci/webhook/stripe` (ARCH8-15): przed sesją i CSRF, podpis HMAC na surowych
  bajtach (`Stripe-Signature`, kilka `v1`, kilka sekretów w `STRIPE_SEKRET_WEBHOOKA` na czas zmiany,
  tolerancja 300 s), idempotencja po `event.id` (`platnosci_zdarzenia`), zdarzenie innego trybu
  (`livemode`) ignorowane, stan zawsze z API (lista subskrypcji klienta, kolejność zdarzeń bez znaczenia),
  zamek per klient. Błąd API dostawcy: 503, zdarzenie zostaje nieprzetworzone i Stripe je ponowi.
  Obsługiwane: `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
  `invoice.paid` (rejestr wpłat), `invoice.payment_failed`, `charge.refunded` (zwroty z panelu Stripe).
- **Stany** (ARCH8-16): `trialing` -> `probna`, `active` -> `aktywna`, `active` z anulowaniem na koniec
  okresu -> `anulowana` (pakiet do `okresDo`), `past_due`/`unpaid` -> `zalegla` (pakiet przez
  `PLATNOSCI_ZALEGLA_DNI`), `canceled`/`incomplete_expired`/`paused` -> `wygasla`, `incomplete` -> `brak`.
  Powiązanie z innego trybu (`platnik_tryb`) nigdy nie daje dostępu.
- **Uzgadnianie** co 6 h (i `platnosci-synchronizuj`): konta z żywą subskrypcją albo dawno nieuzgadniane,
  najwyżej 3 zapytania na sekundę, brakujące wpłaty z API, dokończenie odstąpień przerwanych błędem
  dostawcy. Konto `aktywna` z `okresDo` starszym niż 2 doby jest synchronizowane w tle przy zapytaniu.
- **Kraj spoza `PLATNOSCI_KRAJE`**: Checkout nie ogranicza kraju adresu rozliczeniowego, więc zakup
  z takim adresem jest od razu anulowany i zwracany w całości (`zwrot` z powodem `kraj`), a aplikacja
  dostaje `platnosci.odrzucenie` i powrót `?platnosc=kraj`.
- **Odstąpienie w 14 dni** (PR8-31, art. 11a dyrektywy 2011/83/UE): przycisk "Odstąp od umowy tutaj"
  (sekcja konta, `/konto/odstapienie?z=konto`), drugi krok "Potwierdź odstąpienie od umowy", API dla
  aplikacji i `zwrot <login>` dla oświadczeń e-mailem albo listem. Termin: koniec 14. dnia po dniu zawarcia
  (czas polski). Serwer zapisuje oświadczenie (`odstapienia`, z chwilą złożenia), anuluje subskrypcję od razu
  i zleca zwrot: `proporcjonalny` = wpłata minus rozpoczęte doby dostępu (`kwota * dni / dni okresu`,
  zaokrąglone), `pelny` = cała wpłata. Awaria dostawcy: oświadczenie zostaje w stanie `blad` (liczy się
  chwila złożenia), dokończy je uzgadnianie albo `zwrot <login> --wykonaj`, ten sam klucz idempotencji.
  Usunięcie konta (A1) w terminie odstąpienia = odstąpienie ze zwrotem, po terminie anulowanie bez zwrotu.
- **Przychód i progi** (PR8-09): wpłaty z kwartału (czas polski) minus zwroty zlecone w kwartale, EUR po
  `PLATNOSCI_KURS_EUR_PLN` (przybliżenie do ostrzeżeń, nie księgowość). Progi `PLATNOSCI_PROGI_OSTRZEZEN`
  i 100% limitu `PLATNOSCI_PROG_KWARTAL_PLN`, sprzedaż do konsumentów z innych krajów UE w roku (80% i 100%
  `PLATNOSCI_PROG_UE_EUR`): wpis w dzienniku, `/api/status.platnosci.progi` i jeden e-mail
  `prog-przychodu` do usługodawcy na próg i okres. `PLATNOSCI_WSTRZYMAJ_PO_PROGU=1` odmawia zakupu, który
  przekroczyłby limit kwartalny (`403 sprzedaz-wstrzymana`, `powod: 'prog'`); zarządzanie subskrypcją działa.

### Kontrakt dla aplikacji (D)

| Trasa | Ciało | Odpowiedź | Odmowy (`X-CAI-Kod`) |
|---|---|---|---|
| `GET /api/platnosci/stan` | - | `{ subskrypcja, platnosci }` jak w `/api/konto` (niżej) | `404 platnosci-wylaczone` |
| `POST /api/platnosci/zakup` | `{ plan, waluta?, zgodaNaWykonanie: true, zgodaRegulamin?, jezyk?, z? }` | `{ url, plan, waluta, kwota }` | `403 zgoda-wymagana`, `400 plan-niedostepny` (`powod: 'cena'`), `409 subskrypcja-istnieje`, `403 zakup-niedozwolony`, `403 sprzedaz-wstrzymana` (`powod: 'konfiguracja'\|'prog'`), `429 za-duzo-prob` (`ponowZa`), `503 dostawca-platnosci-niedostepny` |
| `POST /api/platnosci/panel` | `{ jezyk?, z? }` | `{ url }` | `409 brak-subskrypcji`, `503` |
| `GET /api/platnosci/odstapienie` | - | `{ mozliwe, powod, zawarcie, termin, szacunek: { kwota, waluta, tryb, dniUzyte, dniOkresu }, plan }` | - |
| `POST /api/platnosci/odstapienie` | `{ potwierdzam: true }` | `{ ok, odstapienie: { id, zlozone, zwrot: { kwota, waluta, tryb, dniUzyte, dniOkresu, najpozniej } } }` | `403 zgoda-wymagana`, `409 odstapienie-niedostepne` (`powod: 'brak-umowy'\|'zlozone'\|'po-terminie'`), `503` (oświadczenie zapisane) |

`platnosci.stanDlaKonta(konto, kontekst)` (synchronicznie, bez sieci) daje sekcje `/api/konto`:
`subskrypcja: { stan, plan, okresDo, waluta, dostepDo }` i `platnosci: { wlaczone, sprzedaz, tryb, dostawca,
waluty, walutaDomyslna, wymagaZgodyNaWykonanie, mozeKupic, maPanel, plany: [{ plan, nazwa, nazwaEn, opis,
opisEn, limity, funkcje, limitDokumentow, ceny: { eur: 1900, pln: 7900 } }] }` oraz pola B: `walutaWymuszona`
(waluta klienta, który już płacił), `zakupNiedozwolony`, `kraje`, `zwrot` (tryb), `odstapienie: { mozliwe,
do, zawarcie, szacunek, adres, ponowienie }` albo `{ mozliwe: false, powod, do, zlozone: { czas, stan, kwota,
waluta } }`, `odrzucenie: { powod: 'kraj', kraj, czas }`, `adresy: { zakup, panel, odstapienie }`,
`rachunek: { email }`. Kwoty w jednostkach najmniejszych (grosze, centy), czasy w ms.

### Kontrakt dla kont (A1) i poczty (C)

- `/konto` (A1): `ekrany.sekcjaKonta({ jezyk, stan: platnosci.stanDlaKonta(konto, kontekst), pakiety:
  plany.PLANY })` zwraca sekcję "Pakiet i płatności" (stan, formularz panelu, "Odstąp od umowy tutaj",
  rachunek na prośbę), a przed wysłaniem ekranu `platnosci.cspEkranu(res, kontekst)` dopisuje hosty dostawcy
  do `form-action` (przeglądarka stosuje je do przekierowania 303 po formularzu panelu).
- Usunięcie konta (A1): `await platnosci.anulujDlaKonta(konto, kontekst)`; wyjątek = konto zostaje
  (klient płaciłby dalej).
- E-maile (C, `serwer/poczta-szablony.js`; bez szablonu B zapisuje ostrzeżenie i nie wysyła):
  `zakup-potwierdzenie` (potwierdzenie umowy na trwałym nośniku, PR8-31; raz na sesję Checkout) z `dane:
  { pakiet, kwota, waluta, dataZawarcia, nastepnaPlatnosc, terminOdstapienia, zadanieWykonania, trybZwrotu,
  regulaminWersja, adresRegulaminu, adresOdstapienia, adresKonta, zalaczniki: [{ nazwa, typ, tresc }] }`
  (regulamin i pouczenie z formularzem jako tekst z `dokumenty-prawne.js`); `odstapienie-potwierdzenie`
  z `dane: { pakiet, dataZawarcia, zlozone, kwotaZwrotu, waluta, terminZwrotu, dniUzyte, dniOkresu,
  potracenie, trybZwrotu, adresKonta }`; `prog-przychodu` (do usługodawcy) z `dane: { rodzaj: 'kwartal'|'ue',
  prog, okres, przychod, limit, procent, opis }`. Teksty: AG/runda8/prawo/zgody-i-komunikaty.md pkt 5 i 6.
  Potwierdzenia płatności, nieudane płatności i wygasające karty wysyła Stripe (ARCH8-21).
- Limit pakietu (KOD8-20): `plany.zarezerwuj({ konto, czynnosci })` przed wywołaniem dostawcy,
  `plany.policz({ ..., rezerwacja })` po sukcesie, `rezerwacja.zwolnij()` w `finally`; wpięcie w proxy
  `server.js` (sekcja C) jest w łatce AG/runda9/b/kod8-20-server.diff. Kontynuacja po `pause_turn`
  (`x-cai-czynnosc: artykul-ciag`, KOD8-13) liczy się jak zwykłe wywołanie modelu, nie jak drugi artykuł.

### Polecenia (`sudo serwer/cli.sh <polecenie>`, środowisko testowe: `--srodowisko /etc/contentai/srodowisko-test`)

| Polecenie | Co robi |
|---|---|
| `platnosci-sprawdz` | konfiguracja, ceny u dostawcy (z porównaniem z `PLATNOSCI_CENY_WYSWIETLANE`), ostatni webhook, nieprzetworzone zdarzenia, uzgadnianie, odstąpienia z błędem, przychód kwartału; kod 0 = gotowe do sprzedaży |
| `platnosci-synchronizuj [login]` | uzgodnienie stanu i wpłat z Stripe, dokończenie odstąpień z błędem |
| `platnosci-powiaz <login> <cus_...> [--zamien]` | powiązanie konta z klientem Stripe, tylko `PLATNOSCI_TRYB=test` (skrypt testu z zegarem) |
| `przychod [RRRR-Qn\|RRRR]` | wpłaty minus zwroty per waluta i kraj, razem w PLN, procent limitu kwartalnego, sprzedaż do innych krajów UE w roku |
| `ewidencja <od> <do> [--dziennie]` | CSV (średnik, przecinek dziesiętny) wpłat i zwrotów do ewidencji sprzedaży: data, rodzaj, identyfikator, konto, kraj, kwota, waluta, PLN, narastająco w kwartale, pakiet, okres; `--dziennie`: sumy dzienne. Kolumny potwierdza księgowa (PR8-12) |
| `zwrot <login> [--zlozone RRRR-MM-DD[THH:MM]] [--pelny] [--wykonaj]` | odstąpienie zgłoszone e-mailem albo listem: bez `--wykonaj` tylko wyliczenie; `--zlozone` = chwila otrzymania oświadczenia (czas polski); `--pelny` = zwrot całości |

### Test w prawdziwym trybie testowym Stripe (T1-T12, PROJEKT-TECHNICZNY 12.4)

Przed testem (raz, w panelu Stripe w trybie testowym, przełącznik "Test mode"):
1. Product catalog: "Content AI Standard" i "Content AI Premium", każdy z ceną cykliczną miesięczną 19 EUR
   i 49 EUR z opcją waluty PLN 79 i 199 zł ("Add another currency"). Identyfikatory cen (`price_...`)
   do `STRIPE_CENA_STANDARD` i `STRIPE_CENA_PREMIUM`.
2. Settings > Billing > Customer portal: zmiana karty TAK, anulowanie TAK (na koniec okresu), zmiana pakietu
   TAK (obie ceny), historia faktur NIE, adres powrotu `https://test.content-ai.net/konto`.
3. Settings > Customer emails: potwierdzenia udanych płatności, zwroty, nieudane płatności i wygasające
   karty TAK; wysyłka faktur NIE.
4. Developers > API keys > Create restricted key "content-ai-serwer": zapis Customers, Checkout Sessions,
   Customer portal, Subscriptions, Refunds; odczyt Prices, Products, Invoices, Invoice Payments, Charges ->
   `STRIPE_KLUCZ` (`rk_test_...`). Osobny klucz `sk_test_...` tylko do skryptu T8 (nigdy w pliku środowiska).
5. Developers > Webhooks > Add endpoint `https://test.content-ai.net/platnosci/webhook/stripe`, zdarzenia:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`;
   "Signing secret" (`whsec_...`) -> `STRIPE_SEKRET_WEBHOOKA`.
6. `/etc/contentai/srodowisko-test`: `PLATNOSCI=stripe`, `PLATNOSCI_TRYB=test`, `STRIPE_KLUCZ`,
   `STRIPE_SEKRET_WEBHOOKA`, `STRIPE_CENA_STANDARD`, `STRIPE_CENA_PREMIUM`,
   `PLATNOSCI_CENY_WYSWIETLANE=standard:eur=19,pln=79;premium:eur=49,pln=199`,
   `CAI_ADRES_PUBLICZNY=https://test.content-ai.net`, `CAI_USLUGODAWCA_IMIE_NAZWISKO`, `CAI_USLUGODAWCA_ADRES`,
   `CAI_USLUGODAWCA_EMAIL` (wartości tylko w pliku środowiska). Restart usługi testowej, potem
   `sudo serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test platnosci-sprawdz` -> "Gotowe (kod 0)".

| Krok | Co zrobić | Czego się spodziewać |
|---|---|---|
| T1 | Rejestracja nowego konta, e-mail potwierdzający (A1, C) | konto potwierdzone, sesja od razu |
| T2 | "Generuj" bez klucza; zły klucz; dobry klucz (C, D) | kreator bez zapytania; "odrzucony"; artykuł |
| T3 | Trzy artykuły, czwarty (D) | okno pakietu: PLN przy polskim interfejsie, EUR przy angielskim |
| T4 | Zakup Standard w PLN kartą `4242 4242 4242 4242` (dowolna przyszła data, CVC); na ekranie zakupu najpierw "Przejdź do płatności" bez zgód | bez zgód komunikat przy polach; w Checkout tekst o obowiązku zapłaty 79,00 zł co miesiąc i napis przycisku do zapisania dla prawnika (P-05); powrót, "Pakiet aktywny"; `platnosci-synchronizuj <login>` pokazuje `aktywna (standard)`; w panelu Stripe zdarzenia webhooka z odpowiedzią 200; `przychod` pokazuje 79,00 zł; e-mail potwierdzenia umowy (gdy C doda szablon `zakup-potwierdzenie`) |
| T4a | To samo konto: "Odstąp od umowy tutaj" i "Potwierdź odstąpienie od umowy" | "Odstąpienie przyjęte", w Stripe zwrot (Payments > płatność > Refunds) na kwotę z ekranu (79,00 zł minus rozpoczęte doby), konto w pakiecie Darmowym, `ewidencja` z wierszem zwrotu |
| T5 | Drugie konto, interfejs angielski, zakup w EUR; w Checkout kraj adresu np. Niemcy | waluta `eur` (parametr `currency` przy cenie wielowalutowej działa); `przychod` liczy sprzedaż do UE (DE) |
| T5a | Trzecie konto, w Checkout kraj adresu spoza UE (np. United States) | powrót z komunikatem o kraju, subskrypcja anulowana i zwrócona w całości |
| T6 | Karta 3D Secure `4000 0027 6000 3184`; karta odrzucana `4000 0000 0000 0002`; przy `PLATNOSCI_METODY=card,blik` BLIK w PLN | po uwierzytelnieniu `aktywna`; odrzucenie: błąd w Checkout, stan bez zmian; BLIK: sprawdzić, czy Stripe przyjmuje go w subskrypcji (inaczej zostaje `card`) |
| T7 | Portal ("Zarządzaj subskrypcją"): Premium, powrót do Standard, anulowanie, wznowienie, zmiana karty | stany `aktywna` -> `anulowana` (do daty) -> `aktywna`; pakiet zgodny z ceną |
| T8 | `STRIPE_KLUCZ_ZEGARY=sk_test_... STRIPE_CENA_STANDARD=price_... node narzedzia/test_platnosci_stripe.js --login <login> --waluta pln --cli "sudo serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test" --sprzataj` | kod 0: zegar przesunięty o miesiąc, `invoice.paid`, nowy `okres_do`, druga wpłata w rejestrze |
| T9 | To samo z `--karta 0341 --miesiace 2` | miesiąc 1: `zalegla` (baner, pakiet przez `PLATNOSCI_ZALEGLA_DNI`); po ponowieniach Stripe (ustawienia Smart Retries) `wygasla` i pakiet Darmowy |
| T10 | Developers > Webhooks: "Resend" kilku zdarzeń; wyłączyć punkt końcowy, anulować w Portalu, włączyć i `platnosci-synchronizuj` | duplikaty bez skutków (200, `powtorzone`); stan dogoniony przez uzgadnianie |
| T11 | Usunięcie konta z aktywną subskrypcją (A1) | subskrypcja anulowana w Stripe (w 14 dniach od zakupu ze zwrotem), konto i pliki usunięte |
| T12 | `PLATNOSCI_PROG_KWARTAL_PLN=100`, restart, zakup; potem restart bez `PLATNOSCI` | jeden e-mail `prog-przychodu` na próg (60%, 80%, 100%); bez płatności aplikacja bez przycisków zakupu, konta `glowna` jak dziś |

Przełączenie na live (12.5): produkty, ceny, Portal, klucz i webhook utworzone osobno w trybie live
(adres `https://app.content-ai.net/platnosci/webhook/stripe`), `PLATNOSCI_TRYB=live` i wszystkie `STRIPE_*`
z trybu live, `platnosci-sprawdz` kod 0. Serwer odmawia klucza z innego trybu (prefiks `rk_test_`/`rk_live_`).
Wycofanie: `PLATNOSCI_SPRZEDAZ=0` (nowych zakupów nie ma, webhook, Portal i uzgadnianie działają).

## Własne klucze

Konta samoobsługowe pracują na własnych kluczach (`zrodlo_kluczy = 'wlasne'`), konta zespołu
(`'serwera'`) jak dotąd na kluczach serwera. Moduł `serwer/klucze.js` (ARCH8-10..12, SEC8-03,
SEC8-04, decyzja M-10), testy `serwer/testy-byok.js`.

**Gdzie leży klucz.** W zaszyfrowanym ciasteczku HttpOnly w przeglądarce użytkownika:
`cai_k_a` (Anthropic), `cai_k_o` (OpenAI), `cai_k_e` (ElevenLabs), przy `CAI_COOKIE_SECURE=1`
z przedrostkiem `__Secure-`; `Path=/api`, `SameSite=Strict`, bez `Domain` (nie trafia do `seo.`
ani na stronę produktową). "Zapamiętaj na tym urządzeniu" (domyślnie) = 30 dni, inaczej do
zamknięcia przeglądarki. Szyfr AES-256-GCM kluczem `CAI_KLUCZ_CIASTEK`, który jest tylko na
serwerze; dane dodatkowe szyfru wiążą ciasteczko z loginem konta i z `sesje_od`. Skutki:
- zwykłe wylogowanie nie usuwa zapamiętanych kluczy (M-10),
- "Wyloguj wszędzie", zmiana i reset hasła unieważniają je na wszystkich urządzeniach naraz,
- inne konto na tym samym komputerze ich nie odszyfruje, a zmiana `CAI_KLUCZ_CIASTEK`
  unieważnia wszystkie (awaryjnie),
- serwer nie zapisuje klucza nigdzie: ani w bazie, ani w dzienniku, ani w pamięci zadania
  w tle po wywołaniu dostawcy (kopia zapytania traci nagłówki z kluczami i ciasteczka).

Bez `CAI_KLUCZ_CIASTEK` zapis kluczy jest wyłączony (`503 niezaimplementowane`,
`powod: 'zapis-wylaczony'`), a konta `wlasne` dostają `brak-klucza`.

**Który klucz idzie do dostawcy (`kluczDla`).** Konto `wlasne` (i każde bez jawnego `'serwera'`):
wyłącznie klucz z ciasteczka; bez niego `403 brak-klucza` (z `dostawca`, przy nieważnym
ciasteczku `niewazny: true`) przed limitem pakietu i przed zadaniem w tle, bez wywołania
dostawcy. Konto `serwera`: ciasteczko, potem przejściowo nagłówek `x-api-key` / `x-openai-key` /
`x-eleven-key` (aplikacja R8), na końcu klucz serwera jak dziś. Klucz użytkownika Anthropic idzie
zawsze do Anthropic, także przy `CAI_DOSTAWCA=nvidia` (SEC8-03); NVIDIA dostaje tylko klucz
serwera. Klucz użytkownika odrzucony przez dostawcę (401, 403 z brakiem uprawnień): odpowiedź
dostawcy bez zmian plus nagłówki `X-CAI-Kod: zly-klucz` i `X-CAI-Dostawca`.

**API dla aplikacji** (za logowaniem; JSON z kontrolą CSRF jak reszta `/api`):

| Trasa | Ciało | Odpowiedź |
|---|---|---|
| `GET /api/klucze` | - | `{ zrodloKluczy, zapis, dostawcy, anthropic: { ustawiony, koncowka, zapamietany, wygasa?, niewazny?, kluczSerwera? }, openai, eleven }`; nigdy cały klucz, `koncowka` to 4 ostatnie znaki |
| `POST /api/klucze` | `{ dostawca, klucz, zapamietaj?, sprawdz? }` albo `{ anthropic?, openai?, eleven?, zapamietaj? }` | `200 { ok: true, zapisano: true, ...stan }` i `Set-Cookie`; zły format: `400 zly-klucz` z `format` (`format`, `administracyjny`, `inny-dostawca`), `komunikat` PL/EN i `X-CAI-Dostawca`; z `sprawdz: true` i kluczem odrzuconym u dostawcy: `200 { ok: false, zapisano: false, powod }` |
| `DELETE /api/klucze?dostawca=anthropic\|openai\|eleven\|wszystkie` (z `Content-Type: application/json`) albo `POST /api/klucze/usun` `{ dostawca? }` | - | `200 { ok: true, usunieto, ...stan }` i ciasteczka kasujące |
| `POST /api/klucze/sprawdz` | `{ dostawca, klucz? }` (bez klucza: zapisany) | `200 { ok, dostawca, powod?, status? }`; `powod`: `brak-klucza`, `zly-klucz`, `brak-uprawnien`, `dostawca-niedostepny`; bez kosztu (lista modeli, dane konta), 10 na minutę (`429 za-duzo-prob`) |

Formaty (SEC8-03): Anthropic `sk-ant-api..` (klucz administracyjny `sk-ant-admin..` odrzucany),
OpenAI `sk-..`, `sk-proj-..`, `sk-svcacct-..` (bez `sk-admin-..` i bez klucza Anthropic w polu
OpenAI), ElevenLabs `sk_..` albo 32 znaki szesnastkowe. Zapisów 30 na minutę na konto.
Wylogowanie wszędzie i usunięcie konta (A1) doklejają `klucze.ciasteczkaUsuwajace(KONF)`.

Miejsce na czwartego dostawcę (własne konto DataForSEO klienta, para login + hasło): wpis
`dataforseo` w `DOSTAWCY_OPIS` i `KLUCZE_SERWERA` (`serwer/klucze.js`, zakomentowany wzór),
ciasteczko `cai_k_d` z tym samym szyfrem (szyfrogram niesie obiekt pól, nie jeden napis),
w `obsluzSerp` gałąź `dataforseo` bierze `klucze.kluczDla(req, konto, 'dataforseo', KONF).dane`
zamiast `KONF.dataForSeo`.

## Dzierżawy

Organizacja jako dzierżawa (ARCH8-09, KOD8-01, SEC8-50..52), testy `serwer/testy-dzierzawy.js`.
Dzisiejsze konta należą do organizacji `glowna` i działają jak dotąd: te same pliki, ten sam
administrator. Każde konto samoobsługowe to własna organizacja `o-...`, której jest właścicielem.

| Zasób | `glowna` | organizacja samoobsługowa |
|---|---|---|
| Marka (`GET/POST /api/marka`) | `<CAI_MARKA>/marka.json`, zmienia admin | `<CAI_MARKA>/marki/<id>.json`, zmienia właściciel |
| Baza wspólna (`/api/baza*`) | `<CAI_BAZA>/wspolna.json`, pisze admin | `<CAI_BAZA>/wspolna-<id>.json`, pisze właściciel |
| Limit dokumentów pakietu | liczy dokumenty prywatne | liczy prywatne i wspólne |
| OpenSEO (brama `seo.` i `/api/seo/*`) | jak dziś (pakiet) | brak (`402 funkcja-poza-pakietem`), także przy roli `admin` |
| Źródło SERP | `CAI_SERP` | `CAI_SERP_SAMOOBSLUGA` (`model` albo `dataforseo`, nigdy projekt OpenSEO) |
| Panel operatora (`/api/status`, `/api/admin/*`) | admin | brak (`403`) |

`GET /api/marka` zwraca `{ marka, zakres: 'glowna'|'samoobsluga', mozeEdytowac }`; odmowa zapisu
w `glowna` jak dotąd (`403 { error }`), w organizacji samoobsługowej `403 uprawnienia-organizacji`.
Wyszukiwanie w bazie i blok "WIEDZA FIRMOWA" biorą wyłącznie bazę wspólną organizacji konta
i jego prywatną. Przegląd 17 zasobów współdzielonych (historia, widoczność AI, CMS, prośby,
liczniki, zadania w tle, pliki tymczasowe i inne) z decyzją dla każdego: AG/runda9/WYKONANIE-C.md.

**Zasoby opłacane przez serwer dla kont `wlasne`** (ARCH8-11). Konto na własnym kluczu płaci samo
za model, ale serwer płaci za dane SERP z DataForSEO, wektory NVIDIA i pobieranie stron (pasmo
i adres IP serwera). Te zasoby mają pulę z pakietu (`plany.limitySerwera`); po jej wyczerpaniu
`402 zasob-serwera-wyczerpany` z polami `zasob`, `limit`, `zuzyte`, `odnawialny`. Konto
samoobsługowe korzysta z nich dopiero po potwierdzeniu e-maila (`403 email-niepotwierdzony`).
Sprawdzanie odnośników przy kończącej się puli sprawdza tyle, ile zostało, resztę zwraca jako
`stan: 'nieznany', powod: 'limit-pakietu'` (pole `pominiete`). Wektory (D-09: pula 0 we
wszystkich pakietach) dla kont `wlasne` są wyłączone: baza szuka po słowach kluczowych,
odpowiedź ma `powod` / `powodWektorow: 'limit-pakietu'`. Konta zespołu: bez puli, jak dziś.

## Poczta

`serwer/poczta.js` i `serwer/poczta-szablony.js` (ARCH8-21, PR8-27), testy `serwer/testy-poczta.js`,
atrapa `narzedzia/atrapa/poczta.js` (API jak Resend).

- `CAI_POCZTA=log` (domyślnie): nic nie wychodzi; w dzienniku tylko szablon, zamaskowany adres
  (`a***@firma.pl`) i wynik, pełna wiadomość wyłącznie w pliku `CAI_POCZTA_LOG` (testy,
  środowisko testowe). Z `CAI_REJESTRACJA=1` start ostrzega, że linki nie trafią do skrzynek.
- `CAI_POCZTA=resend`: `POST <CAI_POCZTA_URL>/emails` przez `fetch` (bez npm), limit czasu 10 s,
  jedno ponowienie po 1 s przy błędzie sieci, 429 i 5xx z tym samym `Idempotency-Key` (Resend nie
  wyśle wiadomości drugi raz). Brak klucza albo nadawcy: funkcja wyłączona, poczta schodzi na `log`.
- Odnośnik z tokenem nigdy nie trafia do dziennika ani do `/api/status` (sekcja `poczta`: `tryb`,
  `wyslanych`, `bledow`, `ostatniBlad` bez adresów i odnośników).
- Szablony PL i EN (tekst + prosty HTML, przycisk, bez obrazków i pikseli, stopka z danymi
  usługodawcy): `potwierdzenie`, `reset`, `haslo-zmienione`, `zmiana-email`, `zmiana-email-info`,
  `konto-usuniete`, `prog-przychodu`, `powitanie`, `konto-istnieje`, `test`, `zakup-potwierdzenie`
  i `odstapienie-potwierdzenie` (trwały nośnik umowy, PR8-31; pola `dane` jak w sekcji
  "Płatności"). Pola każdego szablonu: nagłówek `serwer/poczta-szablony.js`. Rozliczenia
  (potwierdzenia płatności) wysyła Stripe.
- Załączniki: `dane.zalaczniki: [{ nazwa, typ, tresc }]` (np. regulamin i pouczenie w TXT) idą do
  Resend jako `attachments` (base64), najwyżej 5 po 2 MB; w `CAI_POCZTA_LOG` tylko nazwa, typ
  i rozmiar.

Konfiguracja Resend (raz, Marcin):
1. Resend → Domains → dodaj domenę nadawcy (np. `mail.content-ai.net`), wpisz u Cloudflare
   rekordy z panelu (SEC8-27): SPF (gdy domena ma już SPF, dołóż `include`, drugi rekord SPF to
   błąd), DKIM oraz DMARC (`_dmarc`: `v=DMARC1; p=quarantine; rua=mailto:...; adkim=s; aspf=s`,
   po obserwacji raportów `p=reject`); poczekaj na "Verified". Nadawca zawsze z własnej domeny.
2. W ustawieniach domeny **wyłącz śledzenie otwarć i kliknięć** (PR8-27: bez pikseli
   i przekierowań, bez banera zgody).
3. API Keys → klucz z uprawnieniem "Sending access" tylko dla tej domeny → `CAI_POCZTA_KLUCZ`,
   `CAI_POCZTA=resend`, `CAI_POCZTA_OD="Content AI <konto@mail.content-ai.net>"`, restart.
4. `sudo serwer/cli.sh poczta-test twoj@adres.pl`: wiadomość próbna (sprawdź SPF, DKIM i DMARC
   "pass" w nagłówkach); polecenie ostrzega, gdy domena ma włączone śledzenie (o ile klucz
   może odczytać domeny; klucz tylko do wysyłki: sprawdź w panelu).

## Odporność serwera

Wykonawca C, testy `serwer/testy-odpornosc.js` (wołane z `testy-byok.js`).

- **Łagodne zatrzymanie (KOD8-07).** `systemctl restart` wysyła SIGTERM: nowe wywołania dostawców
  dostają `503` tekstem z `Retry-After: 5` (aplikacja ponawia je jak odpowiedź bramy), reszta
  (strona, pakiet, baza, odbiór wyniku zadania) działa; trwające wywołania i zadania w tle kończą
  się normalnie, gotowy, ale nieodebrany wynik czeka do 15 s na ponowienie z tym samym
  `X-Zadanie`. Gdy nic nie trwa (najwyżej 120 s, `TimeoutStopSec=150`), proces zamyka port i bazę.
  Drugi SIGTERM kończy od razu. Okno bez serwera to sam start nowego procesu (Caddy:
  `lb_try_duration`).
- **Stan zadania (KOD8-30).** `GET /api/zadanie?id=<id>` albo `GET /api/zadanie/<id>` →
  `{ id, stan: 'trwa'|'gotowe'|'przerwane'|'brak', status? }` (tylko zadania własnego konta).
  `gotowe`: ponowienie `POST` z tym samym `X-Zadanie` odbierze wynik bez nowego wywołania
  i liczenia. Kolejność w proxy bez zmian: zadanie szukane przed limitem i walidacją ciała.
- **Za duże zapytanie (KOD8-16).** Ponad limit trasy (25 MB; `/api/images`: 1 MB) na `/api`,
  `/api/images`, `/api/tts`, `/api/transcribe`, `/api/eleven-tts`: `413 { type: 'error', error: { type:
  'request_too_large', message }, komunikat, limitMB }` zamiast 502 (albo 400 przy grafice).
- **Pamięć zadań (ARCH8-12, KOD8-05).** `CAI_ZADANIA_MB` liczy wyniki i ciała zapytań zadań
  w toku (nagrania do transkrypcji); bez miejsca zapytanie idzie zwykłym wywołaniem. Wynik
  odebrany czeka 2 minuty, nieodebrany 15; sprzątanie co minutę.
- **Kompresja (prośba F, KOD8-32).** Duże odpowiedzi (ponad 256 kB) pakowane w puli wątków.
  Pliki z `pwa/lib/` dostają od razu wersję brotli 5, a brotli 11 liczy się w tle i ją zastępuje:
  po restarcie żadne pakowanie nie zatrzymuje serwera (dawniej ok. 4,7 s dla wszystkich).
- **Jedna strona aplikacji (KOD8-06, ARCH8-24).** `GET /konto.js` →
  `window.CAI_KONTO="<identyfikator konta>";` (`Cache-Control: private, no-store`). Aplikacja,
  której HTML nie ma już `WSTAW_TUTAJ_KONTO` (ładuje `<script src="/konto.js">` przed pierwszym
  skryptem i czyta `window.CAI_KONTO`, z zapasem na `meta[name="cai-konto"]`), dostaje jedną
  wersję HTML dla wszystkich kont z `ETag`, `304` i `Cache-Control: private, no-cache`.
  Dzisiejsza aplikacja (z meta) działa jak dotąd, strona per konto.
- **Baza wiedzy.** Dokument dłuższy niż 90 000 znaków (60 fragmentów) jest ucinany jawnie
  (KOD8-11): `POST /api/baza` i lista mają `uciety`, `zapisanoZnakow`, `znakow`, a
  `GET /api/baza` ma `limitZnakow`. Stary `.doc`/`.ppt`/`.xls`, obraz, plik binarny i tekst
  ze znakami zastępczymi (CSV z polskiego Excela w Windows-1250) dostają `422 { error, komunikat,
  powod: 'stary-format'|'obraz'|'plik-binarny'|'kodowanie' }` (KOD8-15, PL/EN wg języka).
  Plik bazy jest parsowany raz na wersję (i-węzeł, rozmiar, czas zmiany), nie przy każdym
  wyszukiwaniu (SEC8-30, pamięć 64 MB).
- **Pobieranie stron.** HTML na tekst w czasie liniowym (KOD8-02: 32 000 niedomkniętych
  `<nav>` w kilkanaście ms zamiast 21 s), kodowanie strony z nagłówka, BOM albo `<meta>`
  (Windows-1250, ISO-8859-2; KOD8-15).

## Oznaczanie treści AI

Content AI oznacza wyniki zgodnie z art. 50 AI Act w dwóch warstwach (projekt, rozdz. 9).
Wykonawca D: `serwer/oznaczenia.js`, aplikacja (`app/contentai.src.html`, blok „OZNACZENIA AI”)
i `app/pwa/lib/docx-natywny-2.js`.

**Warstwa maszynowa** (zawsze, gdy rodzaj ma `metadane: true`), kod źródła z IPTC Digital Source
Type: `trainedAlgorithmicMedia` dla treści z AI, `compositeWithTrainedAlgorithmicMedia` dla tekstu
użytkownika istotnie przerobionego przez AI („Popraw wklejony tekst”):

| Format | Co niesie plik |
|---|---|
| DOCX | `docProps/custom.xml` (AIGenerated, AISystem, DigitalSourceType, AIMarkingVersion; AIEditedByHuman po ręcznej poprawce w trybie Edytuj) i `cp:keywords` |
| PDF | `/Keywords` i `/DigitalSourceType` w informacjach dokumentu oraz pakiet XMP (`Iptc4xmpExt:DigitalSourceType`, `xmp:CreatorTool`) dopisany aktualizacją przyrostową |
| WordPress, Drupal | treść wpisu w `<div data-ai-generated data-ai-system data-ai-source-type>` (Drupal zachowuje atrybuty w formacie `full_html`, `basic_html` je usuwa: aplikacja o tym mówi) |
| JSON-LD | `digitalSourceType` ze schema.org; bez domyślnego autora „Redakcja” (autor tylko z konfiguracji marki) |
| PNG | XMP we fragmencie `iTXt` (`XML:com.adobe.xmp`) zaraz po `IHDR`; plik z manifestem C2PA dostawcy (`caBX`) zostaje bajt w bajt |
| MP3 | ID3v2.4 na początku sklejonego pliku: `TXXX AI_GENERATED`, `TXXX DIGITAL_SOURCE_TYPE`, `TSSE`, `TIT2`, `COMM` z informacją o syntetycznym głosie; znaczniki fragmentów od dostawcy są zdejmowane |

**Etykiety widoczne** (art. 50 ust. 4 to obowiązek publikującego): przełączniki tekstu, grafiki
i audio z wartościami domyślnymi z decyzji M-5 / D-08: tekst wyłączona, grafika wyłączona
(przed pobraniem pytanie, czy przedstawia prawdziwe osoby, miejsca albo zdarzenia), audio
(zapowiedź głosowa na początku nagrania) włączona. Etykieta tekstu jest w języku artykułu
(pl, en, de, cs) i trafia tylko do kopii dla klienta: TXT, DOCX, PDF, schowek, wpis w CMS,
krótka wersja przy kopiowaniu przeróbek. Napis na grafice to nowy plik PNG z naszym XMP.
Zapowiedź audio jest doklejona do pierwszego fragmentu nagrania, więc nie kosztuje osobnego
wywołania dostawcy. Ten sam stan przełącznika widać w menu Eksport, oknie publikacji do CMS,
przy grafice, w module audio, przy przeróbkach i w Koncie.

**W aplikacji**: informacja o AI pod artykułem, przy grafice i w module audio, „Syntetyczny głos
AI” na pasku odtwarzania, przypomnienie o art. 50 ust. 4 w oknie publikacji do CMS i komunikat
przy kopiowaniu grafiki do schowka (kopia nie niesie oznaczenia, D-07).

Konfiguracja: stała `OZNACZENIA` w `serwer/oznaczenia.js` (wersja, kody IPTC i schema.org,
słowa kluczowe plików, teksty etykiet PL/EN/DE/CS, wartość każdego przełącznika:
`zawsze`, `domyslnie-wlaczona`, `domyslnie-wylaczona` albo `nigdy`). Ta sama stała jest w aplikacji
jako `OZNACZENIA_DOMYSLNE`, bo warianty keys i owner działają bez serwera; `serwer/testy-oznaczenia.js`
pilnuje, że obie są równe (zmiana tekstu etykiety = ta sama zmiana w obu plikach). Za serwerem
aplikacja dostaje stałą razem z wyborem użytkownika w `/api/konto.oznaczenia`, a zmianę przełącznika
zapisuje `POST /api/konto/ustawienia { "oznaczenia": { "tekst"?, "grafika"?, "audio"? } }` (tylko
znane pola logiczne). Bez modułu kont wybór zostaje w tej przeglądarce. `CAI_OZNACZENIA=0` wyłącza
obie warstwy awaryjnie (ślad w dzienniku przy starcie).

Sprawdzenie: `node narzedzia/test_eksport.js` (scenariusze „AI”: każdy format) i `node serwer/testy.js`
(sekcja „oznaczenia AI (D)”). Ręcznie: `exiftool plik.png` albo `exiftool plik.mp3`, w PDF
`python3 -c "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); print(d.metadata, d.get_xml_metadata())" plik.pdf`,
w Wordzie Plik, Informacje, Właściwości, Właściwości zaawansowane, Niestandardowe.

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
