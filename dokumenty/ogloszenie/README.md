# Ogłoszenie premiery Content AI

Pakiet na premierę: posty na LinkedIn (PL i EN), Product Hunt, grafiki i plan dnia.
Etap 7 w `dokumenty/PREMIERA.md` (Stripe live i otwarta rejestracja) musi być zakończony.

| Plik | Co zawiera |
|---|---|
| `linkedin.md` | posty PL i EN, pierwsze komentarze z linkami, teksty alternatywne grafik, zasady odpowiedzi |
| `product-hunt.md` | wszystkie pola formularza (z policzonymi limitami), kolejność galerii, komentarz twórcy, gotowe odpowiedzi na częste pytania |
| `grafiki/` | grafiki do postów i galerii (tabela na końcu) |

Wszystkie teksty mają fakty zgodne ze stroną content-ai.net: pakiet Darmowy (3 artykuły, bez karty),
Standard 79 zł albo 19 EUR, Premium 199 zł albo 49 EUR, własny klucz API Anthropic (orientacyjnie
0,20-0,40 USD za artykuł), treści po polsku, angielsku, niemiecku i czesku. Gdy coś z tego się zmieni,
popraw najpierw stronę, potem te teksty i grafiki.

---

## 1. Zanim cokolwiek opublikujesz

1. **Najnowsza wersja na serwerze**, z logo w mailach. Sprawdzenie:
   `sudo serwer/cli.sh poczta-test twoj@adres.pl` (mail próbny ma u góry znak Content AI).
2. **Wygląd Stripe** (logo i kolory w Checkout, w panelu subskrypcji i w mailach Stripe):
   `dokumenty/marka/README.md`.
3. **Resend: limit maili.** Plan darmowy wysyła 100 maili dziennie i 3000 miesięcznie. Każda
   rejestracja to co najmniej jeden mail (link potwierdzający), ponowienie linku i reset hasła to
   kolejne. Po przekroczeniu limitu nowe konta nie dostaną linku. Sprawdź plan w panelu Resend
   (Settings, Billing). Na tydzień premiery przejdź na Pro (20 USD miesięcznie, 50 000 maili, bez
   limitu dziennego), potem możesz wrócić na darmowy.
4. **Konto na Product Hunt** załóż od razu: nowe konto może opublikować produkt dopiero po tygodniu.
   Uzupełnij zdjęcie, imię i nazwisko, nagłówek i link do LinkedIn. Potem wypełnij formularz według
   `product-hunt.md` i zaplanuj publikację („Schedule”).
5. **Ścieżka nowego klienta** w oknie prywatnym przeglądarki, po polsku i po angielsku, na komputerze
   i na telefonie: strona, „Załóż konto”, mail z linkiem, kreator klucza API, pierwszy artykuł.
6. **Limit przychodu**: `sudo serwer/cli.sh przychod` (działalność nierejestrowana, limit kwartalny).

---

## 2. Plan

| Kiedy | Co robisz |
|---|---|
| dziś i jutro | wdrożenie, wygląd Stripe, plan Resend, konto na Product Hunt |
| środa 14.10, 8:30 | post PL na LinkedIn (`linkedin.md`), od razu pierwszy komentarz z linkami, przez godzinę odpowiadasz na komentarze |
| od 14.10 do 19.10 | poprawki po pierwszych opiniach, formularz na Product Hunt wypełniony i zaplanowany |
| wtorek 20.10, 9:01 | start na Product Hunt, od razu komentarz twórcy (`product-hunt.md`) |
| wtorek 20.10, około 9:30 | post EN na LinkedIn, w pierwszym komentarzu adres strony na Product Hunt |
| wtorek 20.10, cały dzień | odpowiedzi na Product Hunt w ciągu około 30 minut, serwer co 2-3 godziny (punkt 3) |
| środa 21.10 | podziękowanie w komentarzu na Product Hunt i pod postami, lista uwag do poprawek |

**Godzina startu.** Dzień na Product Hunt zaczyna się o 00:01 czasu pacyficznego. W Polsce to 9:01
do 24.10, 8:01 od 25.10 do 31.10 (Europa przechodzi na czas zimowy tydzień przed USA) i znowu 9:01
od 1.11.

**Dzień tygodnia.** Od wtorku do czwartku Product Hunt ma najwięcej odwiedzających, ale też najwięcej
premier. W sobotę i niedzielę jest odwrotnie. Celem są nowe konta i opinie, a nie miejsce w rankingu,
więc wtorek jest dobry. Termin możesz przesunąć, byle tydzień po założeniu konta na Product Hunt.

---

## 3. W dniu premiery: kontrola serwera

```bash
# nowe konta dzisiaj (data założenia konta jest liczona w UTC)
sudo serwer/cli.sh lista | grep -c "utworzony: $(date -u +%F)"
# rejestracje i błędy od północy
sudo journalctl -u contentai --no-pager --since today | grep -c '\[konta\] rejestracja:'
sudo journalctl -u contentai --no-pager --since today | grep -ciE 'error|blad'
# maile, które nie wyszły (wpis wygląda tak: [poczta] resend: potwierdzenie -> a***@...: BLAD HTTP 429 ...)
sudo journalctl -u contentai --no-pager --since today | grep -c '\[poczta\].*BLAD'
sudo journalctl -u contentai --no-pager --since today | grep '\[poczta\].*BLAD' | tail -3
free -h; df -h /
```

Gdyby coś poszło źle, `dokumenty/PREMIERA.md`, etap 8:
- zalew rejestracji albo nadużycia: `CAI_REJESTRACJA=0` i restart (założone konta działają dalej),
- problem z płatnościami: `PLATNOSCI_SPRZEDAZ=0` i restart (opłacone pakiety działają dalej),
- maile nie dochodzą: panel Resend (Logs) i limit planu z punktu 1.3.

Błędy w aplikacji: zrzut ekranu, godzina, przeglądarka i co było kliknięte. Prześlij mi zbiorczo.

---

## 4. Jak mierzyć efekt

Strona nie ma analityki i tak zostaje (obiecuje to w stopce). Efekt mierzysz liczbą kont i zakupów:
po każdym poście zapisz datę, kanał, liczbę nowych kont (`lista`, polecenie wyżej) i przychód
(`przychod`). Po tygodniu widać, który kanał dał konta, a który tylko polubienia.

---

## 5. Grafiki

Powstały ze zrzutów aplikacji z przykładowym artykułem o wyborze CRM (ten sam przykład co na stronie).
Gdy zmieni się cennik albo wygląd aplikacji, poproś o nowe.

| Plik | Rozmiar | Gdzie |
|---|---|---|
| `grafiki/linkedin-pl.png` | 1200 x 1500 | post PL na LinkedIn |
| `grafiki/linkedin-en.png` | 1200 x 1500 | post EN na LinkedIn |
| `grafiki/ph-miniatura.png` | 240 x 240 | Product Hunt, miniatura (Thumbnail) |
| `grafiki/ph-1-przeglad.png` | 1270 x 760 | Product Hunt, galeria 1 (okładka) |
| `grafiki/ph-2-fakty.png` | 1270 x 760 | Product Hunt, galeria 2 |
| `grafiki/ph-3-oceny.png` | 1270 x 760 | Product Hunt, galeria 3 |
| `grafiki/ph-4-eksport.png` | 1270 x 760 | Product Hunt, galeria 4 |
| `grafiki/ph-5-cennik.png` | 1270 x 760 | Product Hunt, galeria 5 |
