# Content AI — instalacja na serwerze, krok po kroku

Instrukcja od zera: pusty serwer → działająca strona pod Twoim adresem, z logowaniem
i kontami. Pisana tak, żeby dało się ją wykonać bez znajomości Linuksa — każde polecenie
jest do skopiowania, a pod nim jest napisane, **co powinieneś zobaczyć**.

Czas: około godziny, z czego większość to czekanie.

> **Jak czytać.** Wszystko w ramkach kopiujesz do okna terminala i naciskasz Enter.
> Wiersze zaczynające się od `#` to komentarze — możesz je kopiować razem z resztą,
> nic nie robią. Wszędzie, gdzie widzisz `twojadomena.pl`, wpisujesz swoją domenę.

---

## Spis treści

1. [Zanim zaczniesz](#1-zanim-zaczniesz)
2. [Wejście na serwer](#2-wejście-na-serwer)
3. [Node.js](#3-nodejs)
4. [Pobranie Content AI](#4-pobranie-content-ai)
5. [Konto systemowe usługi](#5-konto-systemowe-usługi)
6. [Twoje konto administratora](#6-twoje-konto-administratora)
7. [Klucze API](#7-klucze-api)
8. [Uruchomienie jako usługa](#8-uruchomienie-jako-usługa)
9. [Sprawdzenie na serwerze](#9-sprawdzenie-na-serwerze)
10. [Domena i HTTPS](#10-domena-i-https)
11. [Pierwsze logowanie](#11-pierwsze-logowanie)
12. [Lista kontrolna — czy wszystko działa](#12-lista-kontrolna--czy-wszystko-działa)
13. [Dodawanie ludzi i pakietów](#13-dodawanie-ludzi-i-pakietów)
14. [Codzienna obsługa](#14-codzienna-obsługa)
15. [Kiedy coś nie działa](#15-kiedy-coś-nie-działa)
16. [Dodatki opcjonalne](#16-dodatki-opcjonalne)

---

## 1. Zanim zaczniesz

Potrzebujesz trzech rzeczy:

| Co | Skąd | Uwagi |
|---|---|---|
| **Serwer VPS** | np. Hetzner, OVH, Mikr.us, DigitalOcean | Ubuntu 24.04 LTS, minimum 1 vCPU i 1 GB RAM. Content AI prawie nic nie liczy sam — cała praca dzieje się w API. |
| **Domena** | dowolny rejestrator | Wystarczy jedna poddomena, np. `contentai.twojadomena.pl`. |
| **Klucze API** | console.anthropic.com, platform.openai.com | Anthropic — treść (obowiązkowy). OpenAI — grafiki, lektor, transkrypcja (opcjonalny). |

> ### ⚠️ Najpierw wymień klucze API
>
> Jeśli Twoje klucze były kiedykolwiek w pliku, który trafił poza Twój komputer — do chmury,
> do rozmowy, do maila — **wygeneruj nowe i unieważnij stare**, zanim postawisz to na serwerze.
> Klucz to karta płatnicza: kto go ma, generuje na Twój rachunek.
>
> - Anthropic: console.anthropic.com → *API Keys* → usuń stary, *Create Key*
> - OpenAI: platform.openai.com → *API keys* → *Revoke*, potem *Create new secret key*
>
> Przy okazji ustaw tam **limity wydatków miesięcznych**. To pięć minut, a oszczędza
> nieprzyjemnych niespodzianek.

### Ustaw DNS już teraz

W panelu swojego rejestratora domeny dodaj rekord:

| Typ | Nazwa | Wartość |
|---|---|---|
| `A` | `contentai` | adres IP Twojego serwera |

Zmiana rozchodzi się po świecie od kilku minut do kilku godzin — dlatego robisz to
na początku, żeby w kroku 10 było już gotowe.

---

## 2. Wejście na serwer

Na swoim komputerze otwórz **PowerShell** (Windows) albo **Terminal** (Mac/Linux) i wpisz:

```bash
ssh root@ADRES_IP_TWOJEGO_SERWERA
```

Przy pierwszym połączeniu zapyta o odcisk klucza — wpisz `yes`. Potem podaj hasło,
które dostałeś od dostawcy VPS-a. Hasło **nie wyświetla się podczas wpisywania** — to
normalne, pisz i naciśnij Enter.

Gdy zobaczysz coś w stylu `root@twoj-serwer:~#` — jesteś w środku. Wszystkie kolejne
polecenia wykonujesz tutaj.

Zacznij od aktualizacji systemu:

```bash
apt update && apt upgrade -y
```

To potrwa minutę–dwie. Jeśli pojawi się niebieski ekran z pytaniem o restart usług,
zaznacz `<Ok>` i naciśnij Enter.

---

## 3. Node.js

Content AI to program w Node.js. Potrzebna jest **wersja 18 lub nowsza**.

```bash
apt install -y git nodejs
node -v
```

Ostatnie polecenie wypisze wersję, np. `v18.19.1`. **Sprawdź pierwszą liczbę:**

- **18 albo więcej** → w porządku, przejdź do kroku 4.
- **mniej niż 18** (np. `v12.22.9`) → Twoja wersja Ubuntu ma stary pakiet. Zainstaluj
  nowszy z oficjalnego źródła Node:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
```

Teraz powinno pokazać `v22.x`.

---

## 4. Pobranie Content AI

```bash
git clone https://github.com/Marcin1000/ContentAI.git /srv/contentai
cd /srv/contentai
```

Powinieneś zobaczyć postęp pobierania i na końcu `Resolving deltas: 100%`.

> **Nie ma tu żadnego „instalowania zależności".** Serwer Content AI korzysta wyłącznie
> z tego, co Node ma wbudowane — nie ma `npm install`, nie ma czego budować. Gotowa
> aplikacja (`app/web-proxy.html`) leży już w pobranym kodzie.

---

## 5. Konto systemowe usługi

Content AI nie powinien działać jako `root`. Zakładasz mu własne konto o minimalnych
uprawnieniach i katalog, w którym wolno mu zapisywać dane.

```bash
useradd --system --home-dir /srv/contentai --shell /usr/sbin/nologin contentai
mkdir -p /srv/contentai/serwer/dane
chown -R contentai:contentai /srv/contentai/serwer/dane
```

Polecenia nic nie wypisują — brak komunikatu oznacza sukces.

> **Dlaczego to jest ważne — i co się dzieje, gdy się o tym zapomni.** W katalogu
> `serwer/dane` lądują konta, sekret podpisujący sesje, baza wiedzy i liczniki pakietów.
> Sprawdziłem oba możliwe błędy:
>
> - **plik z kontami należy do `root`** → usługa go nie przeczyta i **w ogóle nie wstanie**,
>   wypisując mylące `BLAD: brak kont` (mimo że konto istnieje),
> - **katalog nie jest zapisywalny** → usługa wstanie, ale w logu będzie
>   `[sesje] nie udalo sie zapisac sekretu`, a objawem będzie wylogowywanie po każdym
>   restarcie i limity pakietów, które nic nie liczą.
>
> Ten jeden `chown` załatwia obie sprawy. Dlatego w kroku 6 konto zakładasz przez
> `sudo -u contentai`, a nie jako `root`.

---

## 6. Twoje konto administratora

```bash
cd /srv/contentai
sudo -u contentai node serwer/uzytkownicy.js dodaj marcin admin
```

Zamiast `marcin` wpisz login, jakiego chcesz używać. Program poprosi o hasło **dwa razy**
(za drugim razem dla potwierdzenia). Hasło nie wyświetla się podczas pisania — pisz spokojnie
i naciśnij Enter.

Wymagane minimum to **10 znaków**. Użyj czegoś, czego nie masz nigdzie indziej.

Powinieneś zobaczyć potwierdzenie dodania konta. Sprawdź:

```bash
sudo -u contentai node serwer/uzytkownicy.js lista
```

Zobaczysz swój login z rolą `admin`.

> **`sudo -u contentai` nie jest ozdobnikiem.** Uruchamia polecenie jako użytkownik usługi,
> dzięki czemu pliki od razu mają właściwego właściciela. Gdybyś zrobił to jako `root`,
> usługa nie mogłaby ich potem przeczytać.

---

## 7. Klucze API

Klucze trzymasz w osobnym pliku, poza katalogiem z kodem — żeby nigdy nie trafiły
przypadkiem do repozytorium.

```bash
mkdir -p /etc/contentai
nano /etc/contentai/srodowisko
```

Otworzy się prosty edytor. Wklej poniższe (w PuTTY wklejasz **prawym przyciskiem myszy**),
podmieniając klucze na swoje:

```ini
PORT=3100
CAI_DOSTAWCA=anthropic
ANTHROPIC_KEY=sk-ant-api03-TWOJ-KLUCZ
OPENAI_KEY=sk-proj-TWOJ-KLUCZ
```

Zapisz i wyjdź: **Ctrl+O**, Enter, potem **Ctrl+X**.

Zabezpiecz plik, żeby czytał go tylko `root`:

```bash
chmod 600 /etc/contentai/srodowisko
```

### Co jeszcze można tu wpisać

Wszystkie ustawienia są opcjonalne — bez nich działają wartości domyślne.

| Wiersz | Do czego |
|---|---|
| `ELEVEN_KEY=...` | lepszej jakości lektor (elevenlabs.io) |
| `NVIDIA_KEY=...` | wyszukiwanie po znaczeniu w bazie wiedzy; bez niego działa wyszukiwanie po słowach |
| `CAI_SESJA_GODZIN=336` | jak długo trwa zalogowanie (domyślnie 14 dni) |
| `CAI_SERP=dataforseo` | realne dane z Google zamiast szacowanych przez model (płatne, patrz krok 16) |

Pełna lista: `serwer/README.md` w pobranym kodzie.

---

## 8. Uruchomienie jako usługa

„Usługa" znaczy: program startuje sam po włączeniu serwera i sam wstaje po awarii.

```bash
cp /srv/contentai/serwer/contentai.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now contentai
systemctl status contentai
```

Ostatnie polecenie pokaże stan. Szukasz zielonego napisu:

```
Active: active (running)
```

Wyjdź z podglądu klawiszem **q**.

Jeśli widzisz `failed` — przejdź od razu do [kroku 15](#15-kiedy-coś-nie-działa), tam jest
tabela z przyczynami.

---

## 9. Sprawdzenie na serwerze

Zanim zajmiesz się domeną, sprawdź, czy program w ogóle odpowiada:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/
```

Powinno wypisać **`200`**. To znaczy: serwer działa i oddaje ekran logowania.

Zobacz też, co wypisał przy starcie:

```bash
journalctl -u contentai -n 20 --no-pager
```

Szukasz trzech linii mniej więcej takich:

```
Content AI: http://127.0.0.1:3100
  dostawca tresci: anthropic
  kont: 1, cookie Secure: TAK
```

> Port `3100` jest widoczny **tylko z wnętrza serwera** — z internetu nikt się do niego nie
> dostanie. Ruch z zewnątrz wpuści dopiero Caddy w następnym kroku, po HTTPS. Tak ma być.

---

## 10. Domena i HTTPS

Caddy to serwer, który stanie przed Content AI, obsłuży adres `https://` i **sam pobierze
i będzie odnawiał certyfikat**. Nie musisz nic o certyfikatach wiedzieć.

### Instalacja

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

(Gdyby te adresy kiedyś przestały działać, aktualne polecenia są zawsze na
caddyserver.com/docs/install.)

### Konfiguracja

```bash
nano /etc/caddy/Caddyfile
```

Usuń **całą** zawartość (przytrzymaj **Ctrl+K**, aż plik będzie pusty) i wpisz:

```
contentai.twojadomena.pl {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}
```

Zapisz: **Ctrl+O**, Enter, **Ctrl+X**. Przeładuj:

```bash
systemctl reload caddy
```

### Otwórz porty

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

> **Nie dopisuj do Caddy żadnego `basicauth`.** Logowanie obsługuje już Content AI —
> dwa ekrany logowania pod rząd tylko męczą, a niczego nie dokładają.

---

## 11. Pierwsze logowanie

Otwórz w przeglądarce:

```
https://contentai.twojadomena.pl
```

Powinieneś zobaczyć ciemny ekran logowania z napisem **CONTENT AI** i kłódkę przy adresie.

Zaloguj się loginem i hasłem z kroku 6.

**Jeśli przeglądarka pokazuje ostrzeżenie o certyfikacie** — poczekaj 2–3 minuty i odśwież.
Caddy pobiera certyfikat przy pierwszym wejściu, a DNS musi zdążyć się rozejść.

---

## 12. Lista kontrolna — czy wszystko działa

Przejdź to raz, po kolei. Każdy punkt sprawdza inną warstwę.

| # | Co zrobić | Co ma się stać |
|---|---|---|
| 1 | Zaloguj się | Wchodzisz do aplikacji, w prawym górnym rogu widzisz odznakę pakietu |
| 2 | Najedź na odznakę i kliknij | Otwiera się okno „🎟 Twój pakiet" z paskami zużycia. Jako admin masz **Premium, bez limitu** |
| 3 | Wpisz temat i wygeneruj artykuł | Po chwili pojawia się gotowy tekst. To sprawdza klucz Anthropic |
| 4 | Wygeneruj grafikę | Obrazek się pojawia. To sprawdza klucz OpenAI |
| 5 | Odśwież stronę (F5) | **Nadal jesteś zalogowany** |
| 6 | `systemctl restart contentai`, odśwież stronę | **Nadal jesteś zalogowany** ← to sprawdza, czy krok 5 instalacji się udał |
| 7 | Przełącz język na EN i z powrotem | Interfejs tłumaczy się w całości |

Punkt 6 jest najważniejszy z całej listy. Jeśli po restarcie usługi **wyrzuca Cię do
logowania**, wróć do [kroku 5](#5-konto-systemowe-usługi) — usługa nie może zapisywać
w `serwer/dane`.

Sprawdź to od strony serwera:

```bash
ls -la /srv/contentai/serwer/dane/
```

Wszystkie pliki powinny mieć właściciela `contentai`, nie `root`. Jeśli mają `root`:

```bash
chown -R contentai:contentai /srv/contentai/serwer/dane
systemctl restart contentai
```

---

## 13. Dodawanie ludzi i pakietów

Wszystkie polecenia wykonujesz w `/srv/contentai`:

```bash
cd /srv/contentai
```

### Nowa osoba

```bash
sudo -u contentai node serwer/uzytkownicy.js dodaj anna
```

Bez dopisku `admin` konto dostaje zwykłą rolę. Program poprosi o hasło — przekaż je
tej osobie bezpiecznym kanałem i poproś o zmianę.

### Nadanie pakietu

```bash
sudo -u contentai node serwer/uzytkownicy.js plan anna standard
```

Do wyboru: `darmowy`, `standard`, `premium`. Konto bez nadanego pakietu dostaje `darmowy`.

| | Darmowy | Standard | Premium |
|---|---|---|---|
| Artykuły | 3, bez odnawiania | 50/mies. | bez limitu |
| Grafiki | — | 50/mies. | bez limitu |
| Audio, transkrypcja | — | 20/mies. | bez limitu |
| Dokumenty w bazie wiedzy | 3 | 50 | bez limitu |
| Analiza SERP | — | tak | tak |
| Dane z OpenSEO | — | — | tak |

**Ty jako admin zawsze działasz jak premium**, niezależnie od wpisu — żebyś nie mógł
sobie zablokować własnego narzędzia.

Limity zmienia się w pliku `serwer/plany.js` — to zwykła tabelka, zmiana „3 artykuły"
na „5" to poprawienie jednej liczby i `systemctl restart contentai`.

### Pozostałe polecenia

```bash
sudo -u contentai node serwer/uzytkownicy.js lista          # kto ma konto
sudo -u contentai node serwer/uzytkownicy.js haslo anna     # zmiana hasła
sudo -u contentai node serwer/uzytkownicy.js rola anna admin
sudo -u contentai node serwer/uzytkownicy.js usun anna      # odebranie dostępu
```

Zmiana hasła, roli albo usunięcie konta **działa natychmiast** — nie trzeba restartować
usługi, a osoba zostaje wylogowana ze wszystkich urządzeń.

Ostatniego admina nie da się usunąć ani zdegradować.

### Wyzerowanie komuś licznika

Liczniki to zwykłe pliki — jeden na konto:

```bash
rm /srv/contentai/serwer/dane/uzycie/anna.json
```

---

## 14. Codzienna obsługa

### Podgląd, co się dzieje

```bash
journalctl -u contentai -f
```

Log leci na żywo. Wyjście: **Ctrl+C**.

### Restart i stan

```bash
systemctl restart contentai
systemctl status contentai
```

### Aktualizacja

```bash
cd /srv/contentai
git pull
systemctl restart contentai
```

Aktualizacja **nikogo nie wylogowuje** — sesje przeżywają restart.

### Kopia zapasowa

Wszystkie Twoje dane to dwa miejsca:

```bash
tar czf ~/contentai-kopia-$(date +%F).tar.gz \
    /srv/contentai/serwer/dane \
    /etc/contentai/srodowisko
```

Pobierz plik na swój komputer (ze swojego komputera, nie z serwera):

```bash
scp root@ADRES_IP:~/contentai-kopia-*.tar.gz .
```

Rób to raz w tygodniu. W `serwer/dane` są konta, baza wiedzy i liczniki — kodu nie
musisz kopiować, jest na GitHubie.

---

## 15. Kiedy coś nie działa

Zanim zaczniesz zgadywać, **przeczytaj log** — zwykle jest tam napisane wprost, co jest nie tak:

```bash
journalctl -u contentai -n 50 --no-pager
```

| Objaw | Prawdopodobna przyczyna | Co zrobić |
|---|---|---|
| `systemctl status` pokazuje `failed` | Błąd w pliku z kluczami albo za stary Node | `journalctl -u contentai -n 50 --no-pager` i przeczytaj ostatnie linie |
| W logu `BLAD: brak kont`, a konto **na pewno** założyłeś | Plik z kontami należy do `root`, więc usługa go nie przeczyta | `chown -R contentai:contentai /srv/contentai/serwer/dane` i `systemctl restart contentai` |
| W logu `BLAD: brak kont`, konta faktycznie nie ma | Nie wykonałeś kroku 6 | Wróć do [kroku 6](#6-twoje-konto-administratora) |
| W logu `[sesje] nie udalo sie zapisac sekretu` | Usługa nie może pisać w `serwer/dane` | `chown -R contentai:contentai /srv/contentai/serwer/dane` i restart |
| Po restarcie usługi wyrzuca do logowania | To samo — to jest widoczny objaw powyższego | Jak wyżej |
| Limity pakietów nic nie liczą | To samo | Jak wyżej |
| W logu `nie znaleziono ... web-proxy.html` | Niepełny klon repozytorium | `cd /srv/contentai && git checkout app/` |
| Strona nie otwiera się w ogóle | DNS jeszcze się nie rozszedł albo zapora | Sprawdź `ping contentai.twojadomena.pl`; sprawdź `ufw status` |
| Ostrzeżenie o certyfikacie | Caddy jeszcze go nie pobrał | Poczekaj 3 minuty; `journalctl -u caddy -n 30 --no-pager` |
| „Nieznany błąd API" przy generowaniu | Zły klucz albo brak środków u dostawcy | Sprawdź klucz w `/etc/contentai/srodowisko` i saldo na koncie Anthropic/OpenAI |
| Nie możesz się zalogować, hasło na pewno dobre | 8 nieudanych prób → blokada na 15 minut | Odczekaj 15 minut albo zrestartuj usługę |
| Zapomniałeś hasła | — | `sudo -u contentai node serwer/uzytkownicy.js haslo TWOJ_LOGIN` |

Gdy nic z powyższego nie pasuje, do zgłoszenia problemu dołącz wynik:

```bash
systemctl status contentai --no-pager
journalctl -u contentai -n 50 --no-pager
node -v
```

---

## 16. Dodatki opcjonalne

Wszystkie są **niepotrzebne do działania** — Content AI jest kompletny po kroku 12.
Dokładasz je wtedy, kiedy ich potrzebujesz.

### Realne dane z Google zamiast szacowanych

Domyślnie analiza SERP opiera się na tym, co model wyszuka i oszacuje. Konto na
dataforseo.com daje dane mierzone. Dopisz do `/etc/contentai/srodowisko`:

```ini
CAI_SERP=dataforseo
DATAFORSEO_LOGIN=twoj@email.pl
DATAFORSEO_HASLO=...
```

i `systemctl restart contentai`. Płatne za zapytanie.

### OpenSEO — pozycje, backlinki, audyty

Osobna aplikacja w kontenerze Dockera, wpięta za to samo logowanie i w tę samą paletę
kolorów. Frazy krążą między nią a Content AI w obie strony.

Instrukcja: **`openseo/README.md`** w pobranym kodzie.

### Logowanie dwuskładnikowe (2FA)

Własne logowanie Content AI nie ma drugiego składnika. Daje go brama uwierzytelniająca
(Authelia) postawiona przed całością — obsługuje kody z telefonu, klucze sprzętowe
i passkeys, i obejmuje przy okazji wszystkie Twoje aplikacje naraz.

Gotowe pliki konfiguracyjne i instrukcja: **`brama/README.md`**.

### Modele open source zamiast Anthropic

`CAI_DOSTAWCA=nvidia` plus `NVIDIA_KEY=...` kieruje generowanie treści do NVIDIA NIM.
Aplikacja nie wymaga żadnej zmiany — serwer tłumaczy formaty w locie. Grafiki i audio
nadal idą do OpenAI.

---

## Ściągawka

```bash
# stan i log
systemctl status contentai
journalctl -u contentai -f

# restart i aktualizacja
systemctl restart contentai
cd /srv/contentai && git pull && systemctl restart contentai

# konta i pakiety (zawsze z /srv/contentai)
sudo -u contentai node serwer/uzytkownicy.js lista
sudo -u contentai node serwer/uzytkownicy.js dodaj anna
sudo -u contentai node serwer/uzytkownicy.js plan anna standard
sudo -u contentai node serwer/uzytkownicy.js haslo anna
sudo -u contentai node serwer/uzytkownicy.js usun anna

# kopia zapasowa
tar czf ~/contentai-kopia-$(date +%F).tar.gz /srv/contentai/serwer/dane /etc/contentai/srodowisko
```

| Gdzie co leży | |
|---|---|
| Kod aplikacji | `/srv/contentai` |
| Konta, baza wiedzy, liczniki | `/srv/contentai/serwer/dane` |
| Klucze API i ustawienia | `/etc/contentai/srodowisko` |
| Definicja usługi | `/etc/systemd/system/contentai.service` |
| Konfiguracja adresu i HTTPS | `/etc/caddy/Caddyfile` |

---

**Dokumenty pokrewne:** `dokumenty/ContentAI_AdminGuide.md` (codzienna obsługa),
`serwer/README.md` (pełny opis serwera i wszystkich ustawień), `openseo/README.md`,
`brama/README.md`.
