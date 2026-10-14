# Premiera Content AI: instrukcja krok po kroku

Dla właściciela serwera (Marcin). Kolejność ma znaczenie. Po każdym etapie aplikacja działa
dla obecnych kont jak dotąd, więc można przerwać i wrócić następnego dnia. Szczegóły techniczne
każdego kroku są w `serwer/README.md` (podane sekcje).

Wszystkie polecenia są bez pagera i bez edytorów tam, gdzie się da. Gdzie trzeba coś wpisać
ręcznie, używamy `sudo nano <plik>` (zapis: Ctrl+O, Enter; wyjście: Ctrl+X).

Logowanie na serwer jak zawsze:

```bash
ssh root@100.107.236.125
```

---

## Etap 0. Poza serwerem (zanim zaczniesz)

1. **Konto Stripe** jako osoba fizyczna (tryb testowy działa od razu, tryb live po weryfikacji
   tożsamości i rachunku). Bez NIP.
2. **Konto Resend** (e-maile: potwierdzenie konta, reset hasła, potwierdzenie zakupu).
3. **Księgowa** (lista pytań: `AG/runda8/prawo/decyzje-i-przeglad.md`, część B): przede wszystkim
   kasa rejestrująca (K-07) MUSI być rozstrzygnięta przed pierwszą sprzedażą konsumentowi;
   działalność nierejestrowana ma limit 10 813,50 zł przychodu na kwartał (licznik w CLI: `przychod`).
4. **Prawnik**: przegląd szablonów w `dokumenty-prawne/` (regulamin, polityka prywatności,
   odstąpienie, umowa powierzenia).
5. **Dane usługodawcy** do konfiguracji serwera (NIE do repozytorium): imię i nazwisko, adres,
   telefon (wymagany w regulaminie), e-mail kontaktowy.
6. **Nowe klucze API** Anthropic i OpenAI (rotacja: stare były w notatkach poza serwerem).

---

## Etap 1. Serwer: przygotowanie (raz, nie zmienia aplikacji)

### 1.0 Node.js 22.13 albo nowszy (OBOWIĄZKOWO przed etapem 3)

Nowa wersja trzyma konta we wbudowanej bazie Node (`node:sqlite`), która jest dopiero od Node 22.13.
Na starszym Node nowa wersja **nie wystartuje** (w dzienniku: `modul node:sqlite jest niedostepny`).

```bash
node -v
```

- `v22.13` albo więcej (np. `v22.20.0`, `v24.x`): w porządku, przejdź do 1.1.
- mniej (np. `v18.19.1`, `v20.x`): zainstaluj Node 22 (ta sama wersja co w testach na GitHubie).
  Obecna wersja aplikacji działa na Node 22 bez zmian, więc robisz to osobno, przed nowym kodem:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
sudo systemctl restart contentai
sudo systemctl status contentai --no-pager | head -5
```

Oczekiwane: `node -v` pokazuje `v22.x`, usługa `active (running)`, aplikacja działa jak wcześniej.

### 1.1 Swap 3 GB (dziś brak; skok pamięci ubijał proces)

```bash
free -h; swapon --show
sudo fallocate -l 3G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' | sudo tee /etc/sysctl.d/99-contentai-swap.conf
sudo sysctl --system > /dev/null
free -h
```

Oczekiwane: wiersz `Swap:` z około 3,0 Gi.

### 1.2 Dziennik systemowy: najwyżej 500 MB i 30 dni

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\nMaxRetentionSec=30day\n' | sudo tee /etc/systemd/journald.conf.d/contentai.conf
sudo systemctl restart systemd-journald
journalctl --disk-usage --no-pager
```

### 1.3 Automatyczne aktualizacje bezpieczeństwa

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl status unattended-upgrades --no-pager | head -5
```

### 1.4 Uprawnienia pliku z kluczami

```bash
sudo chown root:root /etc/contentai/srodowisko && sudo chmod 600 /etc/contentai/srodowisko
sudo stat -c '%a %U:%G' /etc/contentai/srodowisko
```

Oczekiwane: `600 root:root`.

### 1.5 Kopie zapasowe

Najprościej na start: w panelu Hetzner Cloud włącz **Backups** dla tego serwera (codzienna kopia
całej maszyny, 7 ostatnich, koszt to część ceny serwera). Dodatkowo usługa Content AI robi co
godzinę kopię bazy kont do `serwer/dane/kopie/` (48 ostatnich). Kopia poza Hetznerem (restic)
jest opisana w raporcie bezpieczeństwa (SEC8-43) i może przyjść później.

### 1.6 Monitoring dostępności (darmowy)

Załóż konto w UptimeRobot i dodaj dwa monitory HTTPS co 5 minut: `https://content-ai.net/`
i `https://app.content-ai.net/` (ekran logowania odpowiada 200). Powiadomienia na Twój e-mail.

### 1.7 Cosmos działa jako root (ryzyko dla Content AI)

Proces roota na tej samej maszynie widzi klucze i dane klientów Content AI. Przed premierą
zalecane jest uruchomienie Cosmosa na osobnym koncie systemowym. To zmiana w Cosmosie, nie
w Content AI: zrobimy ją osobno, krok po kroku. Sprawdzenie, że porty Cosmosa i SearXNG słuchają
tylko lokalnie:

```bash
sudo ss -ltnp | grep -E ':(3000|7061|8080)\b'
```

Oczekiwane: wszystkie na `127.0.0.1`.

### 1.8 Zapora (tylko gdy app.content-ai.net idzie przez Cloudflare)

W Cloudflare (DNS) sprawdź, czy rekord `app` ma pomarańczową chmurkę (proxy). Jeśli tak, można
wpuszczać na porty 80 i 443 tylko adresy Cloudflare (raport SEC8-42, wariant Hetzner Cloud
Firewall albo `ufw`). Jeśli `app` jest szary (DNS only), NIE ograniczaj portów, bo aplikacja
przestanie działać; wtedy najpierw przełącz `app` na proxy i sprawdź logowanie w aplikacji.

### 1.9 Bez zrzutów pamięci na dysk (SEC8-02)

Zrzut pamięci po awarii procesu zapisałby na dysk klucze z ostatnich zapytań. Usługa ma już
`LimitCORE=0`; to samo dla całego systemu:

```bash
cat /proc/sys/kernel/core_pattern
sudo mkdir -p /etc/systemd/coredump.conf.d
printf '[Coredump]\nStorage=none\nProcessSizeMax=0\n' | sudo tee /etc/systemd/coredump.conf.d/bez-zrzutow.conf
sudo systemctl disable --now apport.service 2>/dev/null; sudo sed -i 's/^enabled=1/enabled=0/' /etc/default/apport 2>/dev/null
sudo systemctl daemon-reload
```

---

## Etap 2. Caddy: dziennik bez kluczy i nowe podstrony (PRZED aktualizacją kodu)

Najpierw sprawdź, czy klucze API nie trafiły już do dzienników (Caddy przy błędzie 502 zapisuje
nagłówki zapytania, SEC8-01):

```bash
sudo journalctl -u caddy --no-pager -o cat | grep -c -E 'X-Api-Key|X-Openai-Key|X-Eleven-Key'
sudo zgrep -c -E 'X-Api-Key|X-Openai-Key|X-Eleven-Key' /var/log/syslog* 2>/dev/null
```

Oczekiwane: same zera. Jeśli gdzieś jest więcej niż 0: osoby, które używały własnych kluczy, muszą je
unieważnić u dostawców (wpisu nie da się usunąć wybiórczo), a Ty po zmianach z tego etapu czyścisz stare
dzienniki: `sudo journalctl --rotate && sudo journalctl --vacuum-time=1s` (archiwalne dzienniki wszystkich
usług) oraz pliki wskazane przez `sudo zgrep -l -E 'X-Api-Key|X-Openai-Key|X-Eleven-Key' /var/log/syslog*`
(`sudo rm <plik>`; bieżący /var/log/syslog najpierw `sudo logrotate -f /etc/logrotate.d/rsyslog`).

Wzorzec jest w repozytorium: `dokumenty/Caddyfile.content-ai`. Najpierw kopia, potem zmiany:

```bash
cd /srv/contentai && sudo git fetch
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.przed-premiera
git show origin/main:dokumenty/Caddyfile.content-ai | cat
sudo nano /etc/caddy/Caddyfile
```

W pliku `/etc/caddy/Caddyfile`:
1. W bloku globalnym (nawiasy klamrowe bez nazwy na samej górze) dopisz sekcję `log default { ... }`
   z filtrem nagłówków (skopiuj ze wzorca, przed sekcją `servers`).
2. W bloku `content-ai.net` zamień linię zaczynającą się od `@html path` na `@html path */ *.html`
   (nowe podstrony: klucz API, AI Act, regulamin).
3. W bloku `app.content-ai.net`, wewnątrz `reverse_proxy 127.0.0.1:3100 { ... }`, dopisz
   `lb_try_duration 10s` i `lb_try_interval 250ms`. Sprawdź też, że jest tam linia
   `header_up X-Real-IP {client_ip}` (bez niej wszyscy dzielą jeden licznik prób logowania i rejestracji).

Sprawdzenie i przeładowanie:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sI https://content-ai.net/ | head -3
curl -sI https://app.content-ai.net/ | head -3
```

Gdyby `validate` zgłosił błąd: `sudo cp /etc/caddy/Caddyfile.przed-premiera /etc/caddy/Caddyfile`
i napisz do mnie.

---

## Etap 3. Nowa wersja aplikacji (funkcje premiery wyłączone, migracja kont do bazy)

Wieczorem albo rano, poza godzinami pracy klientów (restart trwa kilka sekund).
Szczegóły: `serwer/README.md`, sekcja "Aktualizacja".

Najpierw kontrola Node (krok 1.0). Polecenie kończy się błędem, gdy Node jest za stary; wtedy nie idź dalej:

```bash
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("Node "+process.version+" jest za stary, zrob krok 1.0"); process.exit(1); } console.log("Node "+process.version+": OK")'
```

```bash
sudo tar czf /root/contentai-dane-$(date +%F-%H%M).tgz -C /srv/contentai/serwer dane
git -C /srv/contentai rev-parse HEAD | sudo tee /root/contentai-poprzedni-commit
cd /srv/contentai && sudo git pull
sudo cp serwer/contentai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart contentai
sleep 5; sudo journalctl -u contentai --no-pager -n 40 | grep -E 'magazyn|migracja|rejestracja|platnosci|blad|error' 
sudo serwer/cli.sh lista
```

Oczekiwane: w dzienniku `[magazyn] migracja: N kont ...` (tylko przy pierwszym starcie),
`rejestracja: zamknieta, platnosci: wylaczone`; `lista` pokazuje te same konta i pakiety.
W przeglądarce obecne konto działa bez ponownego logowania, a grafika generuje się na nowym modelu.

Wycofanie, gdyby coś było nie tak:

```bash
cd /srv/contentai && sudo serwer/cli.sh eksport-json
sudo git checkout $(cat /root/contentai-poprzedni-commit)
sudo cp serwer/contentai.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl restart contentai
```

---

## Etap 4. Konfiguracja premiery: klucz ciasteczek, adres, dane usługodawcy, dokumenty

Klucz szyfrujący ciasteczek z kluczami klientów (wygenerowany na miejscu, nie trafia do historii):

```bash
grep -q '^CAI_KLUCZ_CIASTEK=' /etc/contentai/srodowisko || echo "CAI_KLUCZ_CIASTEK=$(openssl rand -base64 32)" | sudo tee -a /etc/contentai/srodowisko > /dev/null
sudo nano /etc/contentai/srodowisko
```

W edytorze dopisz na końcu (wartości w cudzysłowach, swoje dane zamiast przykładów):

```
CAI_ADRES_PUBLICZNY=https://app.content-ai.net
CAI_USLUGODAWCA_IMIE_NAZWISKO="Imię Nazwisko"
CAI_USLUGODAWCA_ADRES="ulica 1, 00-000 Miasto"
CAI_USLUGODAWCA_TELEFON="+48 000 000 000"
CAI_USLUGODAWCA_EMAIL="kontakt@content-ai.net"
CAI_USLUGODAWCA_WWW=https://content-ai.net
CAI_REGULAMIN_WERSJA=2026-10-v3
CAI_POLITYKA_WERSJA=2026-10-v2
```

```bash
sudo systemctl restart contentai
curl -s https://app.content-ai.net/dokumenty/uslugodawca | grep -c 'do uzupełnienia'
```

Oczekiwane: `0` (wszystkie dane uzupełnione). Dokumenty: `https://app.content-ai.net/dokumenty/regulamin`,
`/dokumenty/prywatnosc`, `/dokumenty/odstapienie`, `/dokumenty/dpa`.

Konta zespołu logują się dalej loginem. Żeby ktoś z zespołu mógł się logować także e-mailem
i sam zresetować hasło, przypisz mu adres (po etapie 5, bo reset wysyła e-mail):

```bash
sudo serwer/cli.sh email <login> <adres@e-mail>
```

---

## Etap 5. Poczta (Resend)

Szczegóły: `serwer/README.md`, sekcja "Poczta".
1. Resend: Domains, dodaj `mail.content-ai.net`; rekordy z panelu Resend wpisz w Cloudflare (DNS)
   jako "DNS only" (szara chmurka): SPF, DKIM i DMARC (`_dmarc`). Poczekaj na "Verified".
2. W ustawieniach domeny w Resend **wyłącz śledzenie otwarć i kliknięć**.
3. API Keys: klucz "Sending access" tylko dla tej domeny.
4. `sudo nano /etc/contentai/srodowisko` i dopisz:

```
CAI_POCZTA=resend
CAI_POCZTA_KLUCZ=re_WSTAW_TUTAJ
CAI_POCZTA_OD="Content AI <konto@mail.content-ai.net>"
CAI_POCZTA_ODPOWIEDZ=kontakt@content-ai.net
```

```bash
sudo systemctl restart contentai
sudo serwer/cli.sh poczta-test twoj@adres.pl
```

Oczekiwane: wiadomość próbna w skrzynce, w nagłówkach SPF, DKIM i DMARC "pass".

---

## Etap 6. Środowisko testowe i Stripe w trybie testowym

Osobna kopia aplikacji pod `test.content-ai.net` (za hasłem), z kluczami testowymi Stripe. Tu
sprawdzasz zakup, odstąpienie i portal klienta, zanim ktokolwiek zapłaci naprawdę.

1. Cloudflare DNS: rekord `test` (A, adres serwera 95.216.216.175, pomarańczowa chmurka).
2. Caddy: odkomentuj blok `test.content-ai.net` ze wzorca, hasło: `caddy hash-password`
   (wynik w miejsce `WSTAW_TUTAJ_HASH_BCRYPT`), `validate`, `reload` jak w etapie 2. Jeśli pozostałe
   bloki mają linię `bind` (np. Tailscale zajmuje port 443 na swoim adresie), skopiuj ją też do bloku
   `test`; bez niej `reload` kończy się błędem `address already in use`.
3. Kopia aplikacji i usługa testowa:

```bash
sudo git clone /srv/contentai /srv/contentai-test
sudo mkdir -p /srv/contentai-test/serwer/dane && sudo chown -R contentai:contentai /srv/contentai-test/serwer/dane
sudo cp /etc/contentai/srodowisko /etc/contentai/srodowisko-test && sudo chmod 600 /etc/contentai/srodowisko-test
sudo nano /etc/contentai/srodowisko-test
```

   W pliku testowym zmień: `PORT=3101`, `CAI_ADRES_PUBLICZNY=https://test.content-ai.net`,
   `CAI_REJESTRACJA=1`, dopisz ustawienia Stripe z kroku 4 i usuń klucze produkcyjne AI, jeśli
   chcesz testować tylko na własnym kluczu.
4. Stripe w trybie testowym ("Test mode"): produkty, ceny (19/49 EUR z opcją 79/199 zł), Customer
   portal, klucz ograniczony i webhook: dokładnie według `serwer/README.md`, sekcja
   "Test w prawdziwym trybie testowym Stripe", punkty 1-6.

```bash
sudo /srv/contentai-test/serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test dodaj marcin admin
sudo cp /srv/contentai-test/serwer/contentai-test.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now contentai-test
sudo /srv/contentai-test/serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test platnosci-sprawdz
```

   Pierwsze polecenie zakłada konto administratora (pyta o hasło): bez żadnego konta serwer nie
   wystartuje, także przy otwartej rejestracji.

Oczekiwane: "Gotowe (kod 0)". Potem przejdź kroki T1-T12 z tej samej sekcji README (rejestracja,
klucz, 3 artykuły, zakup kartą testową `4242 4242 4242 4242`, odstąpienie, portal, kraj spoza UE).
Każdy krok ma w tabeli "czego się spodziewać". Wynik (zrzuty albo notatki) wyślij mi.

---

## Etap 7. Start: Stripe live i otwarta rejestracja

Gdy etap 6 przeszedł, Stripe zweryfikował konto, a księgowa potwierdziła kasę rejestrującą:
1. W Stripe w trybie live utwórz to samo co w etapie 6 (produkty, ceny, portal, klucz ograniczony,
   webhook na `https://app.content-ai.net/platnosci/webhook/stripe`). Portal live ma osobne ustawienia
   (https://dashboard.stripe.com/settings/billing/portal, w wyszukiwarce panelu: "Customer portal"):
   zmiana pakietu z oboma produktami, proporcje z fakturą od razu, obniżenie pakietu na koniec okresu
   (README, punkt 2). Bez tego przycisk "Zmień pakiet" w aplikacji otworzy zwykły panel Stripe.
2. `sudo nano /etc/contentai/srodowisko`: `PLATNOSCI=stripe`, `PLATNOSCI_TRYB=live`, wszystkie
   `STRIPE_*` z trybu live, `PLATNOSCI_CENY_WYSWIETLANE="standard:eur=19,pln=79;premium:eur=49,pln=199"` (w cudzysłowie: średnik bez niego przerywa wczytanie pliku w `cli.sh`),
   `CAI_REGULAMIN_WERSJA=2026-10-v3` (wersja z nagłówka `dokumenty-prawne/regulamin.pl.md`; ta sama
   zmiana w `/etc/contentai/srodowisko-test`), na końcu `CAI_REJESTRACJA=1`. Konta, które zaakceptowały
   poprzednią wersję regulaminu, przy następnym wejściu zaakceptują nową.

```bash
sudo systemctl restart contentai
sudo serwer/cli.sh platnosci-sprawdz
sudo journalctl -u contentai --no-pager -n 20 | grep -E 'rejestracja|platnosci'
```

Oczekiwane: kod 0 i `rejestracja: otwarta, platnosci: stripe (live)`. W dzienniku nie ma wpisu
`wersja w konfiguracji rozna od dokumentu` (wersja regulaminu w konfiguracji = wersja dokumentu).
3. Jeden prawdziwy zakup Twoją kartą, potem zwrot: `sudo serwer/cli.sh zwrot <login albo e-mail> --pelny --wykonaj`.
   Bez `--wykonaj` polecenie tylko wylicza zwrot.
4. Wygląd Stripe (logo w Checkout, w panelu subskrypcji i w mailach Stripe): Settings, Branding
   (https://dashboard.stripe.com/settings/branding), w trybie live. Pliki i kolory: `dokumenty/marka/README.md`.
5. Ogłoszenie (LinkedIn, Product Hunt): teksty, grafiki i plan dnia w `dokumenty/ogloszenie/`.

---

## Etap 8. Gdyby coś poszło źle po starcie

- Wstrzymanie nowych zakupów (klienci z pakietem dalej działają): `PLATNOSCI_SPRZEDAZ=0` i restart.
- Zamknięcie rejestracji (konta już założone działają): `CAI_REJESTRACJA=0` i restart.
- Wyłączenie pierwszego artykułu bez klucza (etap 10): `CAI_START=0` i restart. Klucz startu zostaje
  w pliku, a nowe osoby od razu dostają kreator klucza.
- Gdyby oznaczenia AI psuły jakiś plik u klienta: `CAI_OZNACZENIA=0` i restart (wyłącza oznaczenia
  awaryjnie, dziennik startu to odnotuje); potem napisz do mnie, bo oznaczenia są wymagane od 2.08.2026.
- Wycofanie kodu: tylko przy błędzie danych, według etapu 3 (najpierw `eksport-json`).

## Etap 9. Pierwszy tydzień

Codziennie rano:

```bash
sudo journalctl -u contentai --no-pager --since yesterday | grep -ciE 'error|blad'
sudo serwer/cli.sh przychod
sudo serwer/cli.sh start
free -h; df -h /
```

`przychod` pokazuje sumę w kwartale i ostrzega przy 60% i 80% limitu działalności nierejestrowanej.

## Etap 10. Pierwszy artykuł bez klucza (od 14.10.2026)

Nowe konto pisze pierwszy artykuł bez własnego klucza API, na osobnym kluczu startu z własnym limitem
wydatków. Szczegóły i bezpieczniki: `serwer/README.md`, sekcja "Pierwszy artykuł bez klucza".
Strona i aplikacja zmieniają się jednym `git pull`, więc klucz startu wpisz PRZED aktualizacją kodu:
inaczej strona obieca artykuł bez klucza, a aplikacja jeszcze go nie da.

1. Konsola Anthropic (https://platform.claude.com): Settings, Workspaces, "Create workspace", nazwa
   `Content AI start`. W tym obszarze: Limits, miesięczny limit wydatków (np. 30 USD, to około
   75-150 artykułów). Potem API keys, "Create key" w obszarze `Content AI start`. Skopiuj klucz od razu:
   pełny klucz widać tylko w tym oknie, a lista kluczy pokazuje go skróconego (z "..." w środku).
2. Kopia danych i klucz startu w pliku środowiska (klucz tylko tutaj, nigdzie indziej):

```bash
sudo tar czf /root/contentai-dane-$(date +%F-%H%M).tgz -C /srv/contentai/serwer dane
sudo nano /etc/contentai/srodowisko
```

   Dopisz i zmień:

```
CAI_START_KLUCZ=WSTAW_TUTAJ_KLUCZ_STARTU
CAI_REGULAMIN_WERSJA=2026-10-v3
CAI_POLITYKA_WERSJA=2026-10-v2
```

   Zamiast `WSTAW_TUTAJ_KLUCZ_STARTU` wklej klucz z kroku 1. Nowe klucze z konsoli zaczynają się od
   `sk-ant-usr-`, starsze od `sk-ant-api03-`. Jedna linia, bez cudzysłowu, spacji i komentarza.
   Opcjonalnie: `CAI_START_DZIENNIE` (20 nowych osób na dobę), `CAI_START_WYWOLAN` (25),
   `CAI_START_MINUT` (120). Te same wersje dokumentów wpisz w `/etc/contentai/srodowisko-test`.
3. Aktualizacja i restart (migracja 6 tworzy tabelę przydziałów):

```bash
git -C /srv/contentai rev-parse HEAD | sudo tee /root/contentai-commit-przed-$(date +%F-%H%M)
cd /srv/contentai && sudo git pull
sudo systemctl restart contentai
sleep 5; sudo journalctl -u contentai --no-pager -n 40 | grep -E 'magazyn|migracja|start|bez klucza|blad|error'
sudo serwer/cli.sh start
```

   Plik `contentai-commit-przed-...` ma w nazwie datę, więc ponowne uruchomienie bloku nie nadpisze
   commita sprzed aktualizacji. Do wycofania (etap 3) weź commit z pierwszego pliku z tego dnia
   (`ls /root/contentai-commit-przed-*`). W dzienniku: `migracja 6` i `pierwszy artykul bez klucza: do 20 nowych
   dziennie`, bez linii `start WYLACZONE`. Pierwsza linia `start` to "włączony", a pod nią
   "Klucz startu w Anthropic: działa" (sprawdzenie bez kosztu). Gdy pisze "WYŁĄCZONY", linia "Powód:"
   mówi, co jest nie tak z wartością (bez pokazywania klucza). Popraw ją i zrób restart. Ustawienia
   pod spodem działają dopiero przy włączonym starcie.
4. Próba: okno prywatne, rejestracja na nowy adres, potwierdzenie, artykuł bez klucza. Potem
   `sudo serwer/cli.sh start` pokazuje `dziś 1 z 20`.
5. Cloudflare: Caching, Configuration, "Purge Everything" (nowe teksty strony).
6. Dotychczasowe konta: e-mail o zmianie regulaminu, polityki i listy podprzetwarzających co najmniej
   30 dni przed wejściem w życie (regulamin § 12 ust. 2). Pierwszy artykuł bez klucza dostają po
   akceptacji nowej wersji w Koncie, nowe konta od rejestracji.
7. Zalecane przy darmowym artykule: Cloudflare Turnstile na rejestracji (`CAI_TURNSTILE_KLUCZ`
   i `CAI_TURNSTILE_SEKRET`, `serwer/README.md`, "Ochrona formularzy").

Po wyczerpaniu limitu wydatków obszaru startu Anthropic odrzuca zapytania, a serwer sam wstrzymuje
start do końca doby (wpis `[start] ... WSTRZYMANY` w dzienniku). Nowe osoby dostają wtedy kreator
klucza z informacją, że darmowe artykuły na dziś się skończyły.
