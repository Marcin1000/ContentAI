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

---

## Etap 2. Caddy: dziennik bez kluczy i nowe podstrony (PRZED aktualizacją kodu)

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
   `lb_try_duration 10s` i `lb_try_interval 250ms`.

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
CAI_REGULAMIN_WERSJA=2026-10-v1
CAI_POLITYKA_WERSJA=2026-10-v1
```

```bash
sudo systemctl restart contentai
curl -s https://app.content-ai.net/dokumenty/uslugodawca | grep -c 'do uzupełnienia'
```

Oczekiwane: `0` (wszystkie dane uzupełnione). Dokumenty: `https://app.content-ai.net/dokumenty/regulamin`,
`/dokumenty/prywatnosc`, `/dokumenty/odstapienie`, `/dokumenty/dpa`.

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
   (wynik w miejsce `WSTAW_TUTAJ_HASH_BCRYPT`), `validate`, `reload` jak w etapie 2.
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
sudo cp /srv/contentai-test/serwer/contentai-test.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now contentai-test
sudo /srv/contentai-test/serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test platnosci-sprawdz
```

Oczekiwane: "Gotowe (kod 0)". Potem przejdź kroki T1-T12 z tej samej sekcji README (rejestracja,
klucz, 3 artykuły, zakup kartą testową `4242 4242 4242 4242`, odstąpienie, portal, kraj spoza UE).
Każdy krok ma w tabeli "czego się spodziewać". Wynik (zrzuty albo notatki) wyślij mi.

---

## Etap 7. Start: Stripe live i otwarta rejestracja

Gdy etap 6 przeszedł, Stripe zweryfikował konto, a księgowa potwierdziła kasę rejestrującą:
1. W Stripe w trybie live utwórz to samo co w etapie 6 (produkty, ceny, portal, klucz ograniczony,
   webhook na `https://app.content-ai.net/platnosci/webhook/stripe`).
2. `sudo nano /etc/contentai/srodowisko`: `PLATNOSCI=stripe`, `PLATNOSCI_TRYB=live`, wszystkie
   `STRIPE_*` z trybu live, `PLATNOSCI_CENY_WYSWIETLANE=standard:eur=19,pln=79;premium:eur=49,pln=199`,
   na końcu `CAI_REJESTRACJA=1`.

```bash
sudo systemctl restart contentai
sudo serwer/cli.sh platnosci-sprawdz
sudo journalctl -u contentai --no-pager -n 20 | grep -E 'rejestracja|platnosci'
```

Oczekiwane: kod 0 i `rejestracja: otwarta, platnosci: stripe (live)`.
3. Jeden prawdziwy zakup Twoją kartą, potem zwrot: `sudo serwer/cli.sh zwrot <login> --pelny --wykonaj`.
4. Ogłoszenie (LinkedIn, Product Hunt).

---

## Etap 8. Gdyby coś poszło źle po starcie

- Wstrzymanie nowych zakupów (klienci z pakietem dalej działają): `PLATNOSCI_SPRZEDAZ=0` i restart.
- Zamknięcie rejestracji (konta już założone działają): `CAI_REJESTRACJA=0` i restart.
- Wycofanie kodu: tylko przy błędzie danych, według etapu 3 (najpierw `eksport-json`).

## Etap 9. Pierwszy tydzień

Codziennie rano:

```bash
sudo journalctl -u contentai --no-pager --since yesterday | grep -ciE 'error|blad'
sudo serwer/cli.sh przychod
free -h; df -h /
```

`przychod` pokazuje sumę w kwartale i ostrzega przy 60% i 80% limitu działalności nierejestrowanej.
