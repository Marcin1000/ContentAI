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

Restart jest istotny: sesje żyją w pamięci, więc bez niego osoba zostaje zalogowana
do czasu wygaśnięcia sesji (domyślnie 14 dni).

### Pozostałe polecenia

```bash
node serwer/uzytkownicy.js lista
node serwer/uzytkownicy.js haslo anna
node serwer/uzytkownicy.js rola anna admin
```

Ostatniego admina nie da się usunąć ani zdegradować — to zabezpieczenie przed odcięciem
sobie dostępu.

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

## Najczęstsze problemy

**„Niepoprawny login lub hasło" mimo dobrego hasła.** Po 8 nieudanych próbach z jednego
adresu IP serwer blokuje logowanie na 15 minut — dotyczy to również poprawnego hasła.
Poczekaj albo zrestartuj usługę.

**Wszyscy w biurze zablokowani naraz.** Licznik prób jest per adres IP. Za wspólnym NAT-em
cała sieć wygląda jak jeden adres.

**Użytkownik został wylogowany bez powodu.** Sesje są w pamięci — każdy restart usługi
(w tym aktualizacja) wylogowuje wszystkich.

**„Brak ANTHROPIC_KEY na serwerze".** Klucza nie ma w `/etc/contentai/srodowisko` albo
usługa nie została zrestartowana po jego dodaniu.

**Generowanie nie działa po przejściu na NVIDIA.** W przeglądarce jest tylko ogólny
komunikat; prawdziwy jest w logu:

```bash
sudo journalctl -u contentai -n 50
```

**Aplikacja się nie uruchamia, w logu brak `app/web-proxy.html`.** Warianty nie zostały
zbudowane po aktualizacji:

```bash
cd /srv/contentai && sudo python3 pakowanie/warianty.py --wszystkie -o app
sudo systemctl restart contentai
```

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
