# Content AI — instrukcja admina

Dotyczy wdrożenia serwerowego: aplikacja stoi na Twoim serwerze, użytkownicy logują się
loginem i hasłem, klucze API zostają po stronie serwera.

Szczegóły techniczne, zmienne środowiskowe i konfiguracja Caddy: **`serwer/README.md`**.

---

## Co się zmieniło względem poprzedniej wersji

Wcześniejsza instrukcja opisywała rozdawanie każdej osobie osobnego pliku HTML z wbudowanym
kluczem i „blokadą urządzenia". **Tego modelu już nie ma** i nie należy do niego wracać:

- klucz w pliku oznaczał, że każdy, kto dostał plik, dostał też Twój klucz;
- blokada urządzenia była pozorna — liczyła odcisk przeglądarki w `localStorage`,
  a wyczyszczenie pamięci przeglądarki lub edycja pliku ją zdejmowały;
- odebranie dostępu jednej osobie wymagało wymiany klucza u wszystkich.

Zastąpiły to konta na serwerze. Dostęp odbiera się jednym poleceniem, klucz zostaje nietknięty.

---

## Codzienna praca

### Dodanie osoby

```bash
cd /srv/contentai
node serwer/uzytkownicy.js dodaj anna
```

Polecenie zapyta o hasło (dwa razy, bez wyświetlania). Przekaż je osobie **innym kanałem
niż login**. Zmianę hasła wykonujesz Ty poleceniem `haslo` — aplikacja nie ma jeszcze
samoobsługowej zmiany.

Rola domyślna to `uzytkownik`. Admina zakłada się jawnie:

```bash
node serwer/uzytkownicy.js dodaj marcin admin
```

### Odebranie dostępu

```bash
node serwer/uzytkownicy.js usun anna
sudo systemctl restart contentai
```

Restart **nie jest już potrzebny** — weryfikacja sesji sięga do pliku kont, więc brak
konta odcina dostęp natychmiast. Zostawiam polecenie w przykładzie, bo nie szkodzi.

### Pozostałe polecenia

```bash
node serwer/uzytkownicy.js lista
node serwer/uzytkownicy.js haslo anna
node serwer/uzytkownicy.js rola anna admin
```

Ostatniego admina nie da się usunąć ani zdegradować — to zabezpieczenie przed odcięciem
sobie dostępu.

---

## Pakiety i limity

```bash
node serwer/uzytkownicy.js plan anna standard
```

Konto bez wpisanego planu dostaje darmowy. **Ty jako admin zawsze działasz jak premium** —
niezależnie od wpisu, żebyś nie mógł sobie zablokować własnego narzędzia.

| | Darmowy | Standard | Premium |
|---|---|---|---|
| Artykuły | 3, bez odnawiania | 50/mies. | bez limitu |
| Grafiki | — | 50/mies. | bez limitu |
| Audio, transkrypcja | — | 20/mies. | bez limitu |
| Dokumenty w bazie | 3 | 50 | bez limitu |
| Analiza SERP | — | tak | tak |
| Dane z OpenSEO | — | — | tak |

Limity zmienia się w jednym miejscu: `serwer/plany.js`. To tabela danych — zmiana
„3 artykuły" na „5" to edycja jednej linii i restart usługi.

**Artykuł to nie to samo co wywołanie modelu.** Jedno generowanie to kilka wywołań: brief,
treść, korekta, przeróbki. Na licznik artykułów wchodzi tylko właściwe generowanie treści;
reszta idzie na osobny licznik wywołań, który jest sufitem kosztu (30 dla darmowego,
750/mies. dla standardu). Dzięki temu pakiet darmowy naprawdę wystarcza na trzy artykuły,
a nie kończy się w połowie pierwszego.

Każdy widzi swój stan w odznace w pasku górnym — nazwa pakietu i licznik artykułów.
Kliknięcie otwiera okno z paskami zużycia i listą funkcji. Po wyczerpaniu limitu serwer
odpowiada **HTTP 402**, a aplikacja pokazuje to samo okno z wyjaśnieniem, zamiast błędu API.

Liczniki leżą w `serwer/dane/uzycie/` — jeden plik JSON na konto. Żeby komuś wyzerować
pulę, wystarczy skasować jego plik.

---

## Klucze API

Klucze siedzą w `/etc/contentai/srodowisko` (uprawnienia `600`) i **nigdy nie docierają
do przeglądarki użytkownika**. Po zmianie klucza:

```bash
sudo systemctl restart contentai
```

Użytkownik może podstawić **własny** klucz — wtedy generowania obciążają jego konto,
nie Twoje. Serwer rozpoznaje to automatycznie, nic nie trzeba konfigurować.

Stan kluczy sprawdzisz jako admin pod `/api/status` — pokazuje wyłącznie, czy klucz jest
ustawiony, nigdy jego treść.

---

## Przełączenie na modele open source

W `/etc/contentai/srodowisko`:

```
CAI_DOSTAWCA=nvidia
NVIDIA_KEY=nvapi-...
CAI_MODEL_NVIDIA=nvidia/llama-3.3-nemotron-super-49b-v1.5
```

```bash
sudo systemctl restart contentai
```

Serwer tłumaczy format Anthropic ↔ OpenAI, więc **aplikacja nie wymaga żadnej zmiany**.
Powrót do Anthropic to `CAI_DOSTAWCA=anthropic` i restart.

Czego to nie obejmuje: grafiki, synteza mowy i transkrypcja nadal idą do OpenAI/ElevenLabs.
Ich odpowiedniki open source wymagają własnego GPU, więc na VPS bez karty nie mają sensu.

---

## Dane SERP — realne zamiast szacowanych

Analiza SERP przed generowaniem domyślnie prosi model, żeby wyszukał w Google. Działa to
**tylko przy dostawcy Anthropic** i daje dane szacowane, nie mierzone.

Żeby mieć realne wyniki niezależnie od modelu, w `/etc/contentai/srodowisko`:

```
CAI_SERP=dataforseo
DATAFORSEO_LOGIN=twoj@email.pl
DATAFORSEO_HASLO=...
```

```bash
sudo systemctl restart contentai
```

To samo źródło danych, z którego korzysta OpenSEO. **Płatne za zapytanie** — konto na
dataforseo.com. Bez tego przy `CAI_DOSTAWCA=nvidia` analiza SERP zwróci błąd 501
z komunikatem, zamiast po cichu podać zmyślone dane.

---

## Baza wiedzy — prywatna i wspólna

Każdy zalogowany ma **własną bazę prywatną**, widoczną tylko dla niego. Obok jest **baza
wspólna**, widoczna dla wszystkich — i do niej dodaje **wyłącznie admin**. Dzięki temu
wiedza firmowa jest jedna i nikt jej przypadkiem nie podmieni.

Dokumenty leżą na serwerze, więc użytkownik ma swoją bazę na każdym urządzeniu.

**Gdzie to jest w aplikacji.** Menu ustawień → **Baza wiedzy**. Okno pokazuje jedną listę,
w której wspólne dokumenty mają znaczek 🌐, a prywatne 🔒. Wybór zakresu przy dodawaniu
widzi tylko admin — użytkownik dodaje zawsze do swojej prywatnej i nie musi o tym myśleć.

Baza działa **w tle**: przy każdym generowaniu serwer sam dobiera fragmenty pasujące
do tematu i dokłada je do promptu. Użytkownik niczego nie zaznacza. Stare okno „Baza
wiedzy" z dokumentami w przeglądarce zostaje i działa jak dotąd — te dwa źródła się
sumują, więc nikomu nie znika to, co już miał wgrane.

Żeby wyszukiwanie działało po znaczeniu, a nie po słowach, wystarczy `NVIDIA_KEY`
w `/etc/contentai/srodowisko` — ten sam klucz, którego używasz do modeli. Bez niego baza
nadal działa, ale schodzi na dopasowanie słów kluczowych.

Stan sprawdzisz jako admin pod `/api/status` — pole `wektory` mówi, czy klucz jest ustawiony.

---

## OpenSEO pod jednym logowaniem

OpenSEO to osobna aplikacja w kontenerze — analiza SEO: pozycje, backlinki, audyty.
Dla użytkownika ma jednak wyglądać jak część całości, więc Content AI stoi przed nią jako
brama: **to samo konto, ten sam wygląd, żadnego drugiego hasła.**

W `/etc/contentai/srodowisko`:

```
CAI_OPENSEO_PORT=3110
CAI_OPENSEO_ADRES=https://seo.twojadomena.pl
CAI_COOKIE_DOMENA=.twojadomena.pl
```

```bash
sudo systemctl restart contentai
```

W menu ustawień pojawia się wtedy pozycja **OpenSEO**, otwierająca panel w nowej karcie.
Osoba niezalogowana dostaje ekran logowania Content AI, a żądanie w ogóle nie dociera
do kontenera. Odebranie komuś konta odcina go od obu aplikacji naraz.

Jasny/ciemny idzie za przełącznikiem w Content AI — OpenSEO otwiera się w tym samym motywie.

**Uwaga przy Caddy:** kieruj `seo.twojadomena.pl` na port **3110**, nigdy na 3001.
3001 to goły kontener, który nie ma żadnego logowania — wystawienie go wprost oznacza,
że każdy zobaczy Twoje dane i będzie wypalał kredyty DataForSEO.

### Frazy krążą między aplikacjami

Obie aplikacje wymieniają dane. Zamysł: **OpenSEO wie, co warto napisać; Content AI to pisze;
po napisaniu frazy wracają do OpenSEO, żeby dało się śledzić pozycje.**

W formularzu artykułu, obok pola „Słowa kluczowe", jest przycisk 📈. Otwiera frazy zapisane
w projekcie OpenSEO — z wolumenem, trudnością i tagami. W tym samym oknie działa ruch
powrotny: „Oddaj frazy tego artykułu do OpenSEO" zapisuje je z tagiem `content-ai`.

**Praktyczny obieg pracy:** w OpenSEO zbadaj frazy i otaguj te do napisania (np. tagiem
`do-napisania`). W Content AI filtrujesz po tym tagu, piszesz tekst, oddajesz frazy z powrotem.
Rank tracking w OpenSEO ma wtedy komplet fraz, na których faktycznie piszecie.

**Koszty.** Czytanie zapisanych fraz i oddawanie ich z powrotem **nie kosztuje nic** — dotyka
tylko bazy OpenSEO. Badanie nowych fraz woła DataForSEO i jest płatne, dlatego celowo nie ma
go w tym oknie: robi się je w OpenSEO, gdzie widać koszt zapytania.

Opcjonalnie SERP dla Content AI może też iść przez OpenSEO — wtedy wyniki widać w jego panelu:

```
CAI_SERP=openseo
CAI_SEO_PROJEKT=<id projektu>
```

Instalacja samego OpenSEO i pełna konfiguracja: **`openseo/README.md`**.

---

## Najczęstsze problemy

**„Niepoprawny login lub hasło" mimo dobrego hasła.** Po 8 nieudanych próbach z jednego
adresu IP serwer blokuje logowanie na 15 minut — dotyczy to również poprawnego hasła.
Poczekaj albo zrestartuj usługę.

**Wszyscy w biurze zablokowani naraz.** Licznik prób jest per adres IP. Za wspólnym NAT-em
cała sieć wygląda jak jeden adres.

**Użytkownik został wylogowany bez powodu.** Sesje przeżywają restart, więc sprawdź trzy
rzeczy: czy nie zmieniłeś mu hasła lub roli (jedno i drugie unieważnia stare sesje), czy
nie minęło 14 dni, i czy nie zniknął plik `serwer/dane/sekret` — jego skasowanie wylogowuje
wszystkich naraz.

**„Brak ANTHROPIC_KEY na serwerze".** Klucza nie ma w `/etc/contentai/srodowisko` albo
usługa nie została zrestartowana po jego dodaniu.

**Generowanie nie działa po przejściu na NVIDIA.** W przeglądarce jest tylko ogólny
komunikat; prawdziwy jest w logu:

```bash
sudo journalctl -u contentai -n 50
```

**OpenSEO prosi o logowanie mimo zalogowania w Content AI.** Brakuje `CAI_COOKIE_DOMENA`
albo obie aplikacje stoją pod różnymi domenami. Ciasteczko sesji nie przechodzi między
domenami — muszą to być poddomeny tej samej domeny.

**OpenSEO pokazuje „OpenSEO nie odpowiada".** Brama działa, kontener nie:

```bash
sudo docker compose -f /srv/openseo/compose.yaml ps
```

**OpenSEO wygląda jak obca aplikacja (fiolet zamiast bursztynu).** Zniknął plik
`app/openseo-motyw.css` — w logu jest wtedy ostrzeżenie przy starcie. Przywróć go
z repozytorium i zrestartuj usługę.

**Aplikacja się nie uruchamia, w logu brak `app/web-proxy.html`.** Warianty nie zostały
zbudowane po aktualizacji:

```bash
cd /srv/contentai && sudo python3 pakowanie/warianty.py --wszystkie -o app
sudo systemctl restart contentai
```

---

## Aplikacja nie łączy się z obcymi serwerami

Biblioteki do wczytywania i eksportu plików oraz krój pisma leżą w repozytorium i są
serwowane z Twojego serwera. Poza wywołaniami do Anthropic, OpenAI i ElevenLabs przeglądarka
użytkownika nie wysyła nic na zewnątrz.

Praktycznie znaczy to dwie rzeczy: aplikacja działa w zamkniętej sieci firmowej, a nikt spoza
organizacji nie może podmienić kodu, który wykonuje się u Twoich użytkowników.

Po aktualizacji repozytorium biblioteki aktualizują się razem z kodem — nie ma osobnego kroku.

---

## Drugi składnik logowania

Content AI ma własne konta z hasłami, ale **nie ma drugiego składnika** — a konto admina
zarządza wszystkimi. Zamiast dopisywać TOTP do naszego serwera, stawia się przed nim gotową
bramę uwierzytelniającą.

Zysk jest większy niż samo 2FA: jedno logowanie obejmuje wtedy **Content AI, OpenSEO
i Cosmos**, a kod od uwierzytelniania utrzymuje ktoś, kto robi to na pełen etat.

```
CAI_ZAUFANY_NAGLOWEK=Remote-User
```

Po tej zmianie własny ekran logowania Content AI znika — hasło i drugi składnik sprawdza
brama, a my czytamy z nagłówka sam login. Role zostają w naszym pliku kont, więc konto musi
istnieć po obu stronach.

**Warunek bezpieczeństwa:** port 3100 nie może być wtedy osiągalny z zewnątrz. Serwer ufa
nagłówkowi tylko z pętli zwrotnej, ale gdyby ktoś dosięgnął portu bezpośrednio, zostałby
adminem przez dopisanie jednej linijki. Sprawdzenie:

```bash
sudo ss -tlnp | grep 3100     # ma być 127.0.0.1:3100, nigdy 0.0.0.0:3100
```

Gotowe pliki konfiguracyjne i instrukcja krok po kroku: **`brama/README.md`**.

---

## Zasady przetwarzania danych osobowych (ODO)

Niezależnie od modułu admin pilnuje zasad zgłoszonych do ODO.

- Zakaz danych nadawców i odbiorców przesyłek oraz pracowników dostawców i kontrahentów.
  Te dane są przetwarzane w innych procesach, nie w generowaniu treści.
- Zakaz danych osób poniżej 18 roku życia.
- Dozwolone są dane kontaktów prasowych i marketingowych reprezentujących Content AI.
- Loginy powinny być zanonimizowane (np. `u-2207`), a nie imię i nazwisko — ogranicza to
  dane osobowe w logach serwera.
- Treści generowane w aplikacji zostają w przeglądarce użytkownika (`localStorage`).
  Po pracy na danych wrażliwych użytkownik czyści dane przeglądarki.

---

*Content AI — Marcin Przybylski*
