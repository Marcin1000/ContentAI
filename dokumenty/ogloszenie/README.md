# Promocja Content AI

Pakiet promocji po premierze 12.10: plan na 6 tygodni, teksty do wszystkich kanałów, filmy i grafiki.
Etap 7 w `dokumenty/PREMIERA.md` (Stripe live i otwarta rejestracja) jest zakończony.

| Plik | Co zawiera |
|---|---|
| `plan.md` | plan 14.10-30.11: zasady, kalendarz dzień po dniu, Product Hunt 14.11, cele, pomiar, ryzyka, płatne kanały |
| `linkedin.md` | posty #2-#13 z datami, pierwsze komentarze, wiadomości, odpowiedzi, profil, strona firmowa, wydarzenie |
| `product-hunt.md` | formularz (limity policzone), komentarz twórcy, plan dnia premiery, wiadomości do wspierających, Reddit, odpowiedzi |
| `kanaly.md` | osobisty mail do nowego konta, YouTube (filmy i tutorial), katalogi, agencje, grupy, media |
| `grafiki/` | karuzela PDF do posta #3, grafiki do galerii Product Hunt i dawnych postów (tabela na końcu) |

Wszystkie teksty mają fakty zgodne ze stroną content-ai.net: pakiet Darmowy (3 artykuły, konto bez karty, pierwszy
artykuł bez klucza API, kolejne na własnym kluczu Anthropic, orientacyjnie 0,20-0,40 USD za artykuł), Standard
79 zł albo 19 EUR, Premium 199 zł albo 49 EUR, treści po polsku, angielsku, niemiecku i czesku. Gdy coś z tego
się zmieni, popraw najpierw stronę, potem te teksty i grafiki. Gdy wyłączysz start (`CAI_START=0`) na dłużej,
usuń „pierwszy bez klucza API” z materiałów przed kolejną publikacją.

---

## 1. Lista kontrolna

1. **Najnowsza wersja na serwerze**: mail powitalny wychodzi po potwierdzeniu adresu (punkt 3).
2. **Resend: limit maili.** Plan darmowy wysyła 100 maili dziennie i 3000 miesięcznie. Każda rejestracja to dwa
   maile (link potwierdzający i powitanie po potwierdzeniu), ponowienie linku i reset hasła to kolejne. Po
   przekroczeniu limitu nowe konta nie dostaną linku. Na 13-15.11 (Product Hunt) przejdź na Pro (20 USD
   miesięcznie, 50 000 maili, bez limitu dziennego), potem możesz wrócić na darmowy.
3. **Product Hunt**: formularz wypełnij i zaplanuj we wtorek 20.10 wieczorem (konto ma wtedy tydzień),
   premiera w sobotę 14.11 o 9:01 (`product-hunt.md`).
4. **Ścieżka nowego klienta** w oknie prywatnym przeglądarki, po polsku i po angielsku, na komputerze i na
   telefonie: strona, „Załóż konto”, mail z linkiem, kreator klucza API, mail powitalny, pierwszy artykuł.
5. **Limit przychodu**: `sudo serwer/cli.sh przychod 2026-Q4` co tydzień (działalność nierejestrowana, limit
   kwartalny).

---

## 2. Najbliższe dni

Pełny kalendarz: `plan.md`.

| Kiedy | Co robisz |
|---|---|
| śr 14.10 | 10-15 wiadomości do znajomych pod postem z 14.10, odpowiedzi na komentarze, nagłówek profilu |
| cz 15.10 | 20 min komentowania, 15 zaproszeń, profil na Product Hunt, lista 30 agencji |
| pt 16.10 | katalogi: AlternativeTo, SaaSHub, Toolify |
| sb 17.10 | grupy SEO i content, lista 50 osób z kontem na Product Hunt |
| pn 19.10 | 10 pierwszych wiadomości do agencji |
| **wt 20.10, 7:45** | **post #2 z filmem PL** (`linkedin.md`), wieczorem formularz Product Hunt na 14.11 |
| cz 22.10, 7:45 | post #3: karuzela „6 sposobów, w jakie AI psuje fakty”, kanał YouTube z filmami |
| sb 24.10 | tutorial „pierwszy artykuł i klucz API” (`kanaly.md`, punkt 2), strona firmowa na LinkedIn |

---

## 3. Kontrola serwera

```bash
# nowe konta dzisiaj (data założenia konta jest liczona w UTC)
sudo serwer/cli.sh lista | grep -c "utworzony: $(date -u +%F)"
# rejestracje, potwierdzone adresy i maile powitalne od północy
sudo journalctl -u contentai --no-pager --since today | grep -c '\[konta\] rejestracja:'
sudo journalctl -u contentai --no-pager --since today | grep -c '\[konta\] adres potwierdzony:'
sudo journalctl -u contentai --no-pager --since today | grep -c '\[poczta\] resend: powitanie'
# błędy i maile, które nie wyszły (wpis wygląda tak: [poczta] resend: potwierdzenie -> a***@...: BLAD HTTP 429 ...)
sudo journalctl -u contentai --no-pager --since today | grep -ciE 'error|blad'
sudo journalctl -u contentai --no-pager --since today | grep '\[poczta\].*BLAD' | tail -3
free -h; df -h /
```

Gdyby coś poszło źle, `dokumenty/PREMIERA.md`, etap 8:
- zalew rejestracji albo nadużycia: `CAI_REJESTRACJA=0` i restart (założone konta działają dalej),
- problem z płatnościami: `PLATNOSCI_SPRZEDAZ=0` i restart (opłacone pakiety działają dalej),
- maile nie dochodzą: panel Resend (Logs) i limit planu z punktu 1.

Błędy w aplikacji: zrzut ekranu, godzina, przeglądarka i co było kliknięte. Przekazuj zbiorczo.

---

## 4. Jak mierzyć efekt

Strona nie ma analityki i tak zostaje (obiecuje to w stopce). Efekt mierzysz liczbą kont, aktywacją i zakupami,
raz w tygodniu w arkuszu: wzór, cele i polecenia są w `plan.md`, punkt 6.

**Skąd przychodzą konta.** Każdy link do strony w materiałach ma znacznik `?z=` miejsca publikacji. Strona przenosi
go do rejestracji, a udana rejestracja dopisuje 1 do zbiorczego licznika: miesiąc, znacznik, liczba (bez powiązania
z kontem, bez ciasteczek). Wynik: `sudo serwer/cli.sh zrodla` (ostatnie 3 miesiące) albo `zrodla 12`.

| Znacznik | Gdzie |
|---|---|
| `?z=li2` … `?z=li13` | pierwszy komentarz pod postem o tym numerze (`linkedin.md`) |
| `?z=li-profil` | „Polecane” i „Projekty” na profilu LinkedIn |
| `?z=li-dm`, `?z=li-firma` | wiadomości 1:1 z linkiem, strona firmowa Content AI |
| `?z=agencje`, `?z=grupy` | rozmowy z agencjami, wpisy w grupach |
| `?z=yt` | opisy filmów na YouTube |
| `?z=ph` | pole „Links” na Product Hunt (Product Hunt dopisuje też `ref=producthunt`) |
| `?z=alternativeto`, `?z=saashub`, `?z=toolify` | katalogi |
| `?z=reddit`, `?z=ih`, `?z=demo` | Reddit i Indie Hackers w dniu premiery, wydarzenie z demo |

Nazwa znacznika: małe litery, cyfry i łączniki, do 32 znaków. Ten sam znacznik działa na każdej podstronie,
np. `https://content-ai.net/klucz-api/?z=li4`.

---

## 5. Filmy

Film pokazuje prawdziwą aplikację na tym samym przykładzie co strona (artykuł o wyborze CRM, trzy dokumenty
w Bazie wiedzy): pytanie „Kto podał, że wdrożenie trwa 2 dni?”, trzy dokumenty, które tego nie podają, kontrola
faktów, poprawa jednym kliknięciem, cztery oceny, eksport z informacją o AI i plansza z adresem. Napisy są
w obrazie (LinkedIn odtwarza bez dźwięku), a osobno w plikach SRT dla YouTube. Ścieżki dźwiękowej nie ma.
Wynik poprawy w filmie jest przygotowany na przykładzie, a przycisk, powiadomienie i oceny to prawdziwy interfejs.

Pliki są duże (7-10 MB), więc nie ma ich w repozytorium. Są w rozmowie, w dwóch paczkach (PL i EN), a film PL 4:5
także osobno:

| Plik | Gdzie |
|---|---|
| `content-ai-film-pl-4x5.mp4` (1080 x 1350, 25 s) | post #2 na LinkedIn (20.10) |
| `content-ai-film-en-4x5.mp4` (1080 x 1350, 25 s) | post #9 EN w dniu Product Hunt (14.11) |
| `content-ai-film-pl-16x9.mp4` (1920 x 1080, 25 s) | YouTube po polsku |
| `content-ai-film-en-16x9.mp4` (1920 x 1080, 25 s) | YouTube po angielsku, link w galerii Product Hunt |
| `content-ai-film-pl-4x5-krotki.mp4`, `content-ai-film-en-4x5-krotki.mp4` (18 s) | odpowiedzi w komentarzach, wiadomości 1:1, drugi post bez ocen i eksportu |
| `*-miniatura.jpg` | miniatury: 4:5 (kadr z pytaniem i zaznaczonymi zdaniami), 16:9 (duży napis dla listy YouTube) |
| `content-ai-film-pl.srt`, `content-ai-film-en.srt` | napisy dla YouTube |

**LinkedIn:** film dodajesz jak zdjęcie (ikona filmu przy tworzeniu posta). Najlepiej z komputera: tam da się
ustawić miniaturę (`*-4x5-miniatura.jpg`). Pierwsza klatka filmu to już pytanie i zaznaczone zdania, więc
działa także bez własnej miniatury.

**YouTube dla Product Hunt:** tytuły, opisy i kolejność kroków są w `kanaly.md`, punkt 2. Link do filmu EN
wklej w formularzu Product Hunt w polu wideo galerii.

---

## 6. Grafiki

Grafiki do Product Hunt powstały ze zrzutów aplikacji z przykładowym artykułem o wyborze CRM (ten sam przykład
co na stronie i w filmie), a karuzela korzysta z tego samego przykładu. Gdy zmieni się cennik, pakiet Darmowy albo
wygląd aplikacji, poproś o nowe.

| Plik | Rozmiar | Gdzie |
|---|---|---|
| `grafiki/karuzela-6-sposobow.pdf` | 8 stron 1080 x 1350 | post #3 na LinkedIn (22.10), jako dokument; później grupy i wiadomości do agencji |
| `grafiki/ph-miniatura.png` | 240 x 240 | Product Hunt, miniatura (Thumbnail) |
| `grafiki/ph-1-przeglad.png` | 1270 x 760 | Product Hunt, galeria 1 (okładka), katalogi |
| `grafiki/ph-2-fakty.png` | 1270 x 760 | Product Hunt, galeria 2, katalogi |
| `grafiki/ph-3-oceny.png` | 1270 x 760 | Product Hunt, galeria 3, katalogi |
| `grafiki/ph-4-eksport.png` | 1270 x 760 | Product Hunt, galeria 4 |
| `grafiki/ph-5-cennik.png` | 1270 x 760 | Product Hunt, galeria 5 |
| `grafiki/linkedin-pl.png`, `grafiki/linkedin-en.png` | 1200 x 1500 | post z 14.10 (archiwum), zapas zamiast filmu |
