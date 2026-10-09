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

Wykonawca A1 (`serwer/konta.js`, `serwer/ekrany-kont.js`): rejestracja, potwierdzenie
e-maila, reset hasła, ekran konta, zgody, eksport danych i usunięcie konta.
Etap 0: kontrakt tras i zaślepki (trasy z sesją odpowiadają 501, publiczne przy
`CAI_REJESTRACJA=0` działają jak dziś).

## Płatności

Wykonawca B (`serwer/platnosci.js`, `serwer/platnosci-stripe.js`, `serwer/ekrany-platnosci.js`,
`serwer/platnosci-cli.js`): Stripe Checkout i Customer Portal, webhook, stany subskrypcji,
rejestr wpłat. Etap 0: kontrakt i zaślepki (bez `PLATNOSCI` trasy zakupu odpowiadają
`404 platnosci-wylaczone`, a webhook przechodzi dalej jak dziś).

## Własne klucze

Wykonawca C (`serwer/klucze.js`): klucze użytkowników w zaszyfrowanych ciasteczkach
(`CAI_KLUCZ_CIASTEK`), `kluczDla()` bez ścieżki do klucza serwera dla kont `wlasne`,
`/api/klucze`. Etap 0: kontrakt i zaślepki.

## Dzierżawy

Wykonawca C: marka i baza wspólna per organizacja (`serwer/dzierzawy.js`, `marka.js`,
`baza.js`), OpenSEO tylko w organizacji `glowna`, limity zasobów serwera dla kont `wlasne`.

## Poczta

Wykonawca C (`serwer/poczta.js`, `serwer/poczta-szablony.js`): Resend albo dziennik.
Etap 0: tryb `log` działa (zamaskowany adres w dzienniku, pełna wiadomość tylko
w `CAI_POCZTA_LOG`), adapter Resend to zaślepka.

## Oznaczanie treści AI

Wykonawca D (`serwer/oznaczenia.js`, aplikacja): konfiguracja oznaczeń (stała z rozdz. 9.1
projektu, domyślne etykiety wg decyzji M-5) wysyłana aplikacji w `/api/konto.oznaczenia`.

## Strona i dokumenty

Wykonawca E (`serwer/dokumenty-prawne.js`, szablony w `dokumenty-prawne/`): regulamin,
polityka prywatności, odstąpienie, DPA i dane usługodawcy pod `/dokumenty/<nazwa>`
i `/en/dokumenty/<nazwa>`, z danymi `CAI_USLUGODAWCA_*` z konfiguracji (nie z repozytorium).
Etap 0: trasa publiczna i zaślepka (501 „dokument w przygotowaniu").
