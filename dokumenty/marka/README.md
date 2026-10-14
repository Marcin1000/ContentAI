# Marka w Stripe

Pliki powstają z `narzedzia/grafiki_marki.js` (znak z `app/pwa/icons/favicon.svg`, kolor `--c-akcent`,
krój Schibsted Grotesk), tak jak znak w nagłówku e-maili aplikacji (`serwer/zasoby/poczta-znak.png`).
Ten sam generator rysuje ikony aplikacji i strony, obrazki przy linkach (og:image), grafiki README
i ikony aplikacji natywnych. `narzedzia/test_znak.js` sprawdza, że wszędzie jest ten sam znak.

| Plik | Rozmiar | Gdzie w Stripe | Gdzie widać |
|---|---|---|---|
| `stripe-ikona.png` | 512 x 512, ciemne tło | Branding, **Icon** | maile Stripe (pokwitowanie, zwrot), Checkout, panel subskrypcji, faktury |
| `stripe-logo.png` | 1200 x 300, przezroczyste tło | Branding, **Logo** | Checkout, PDF faktur |

Kolory (ustawione i sprawdzone w podglądzie Stripe 12.10.2026):
- **Brand color**: `#F6A623` (złoty, jak znak). Stripe maluje nim tło panelu z nazwą produktu i ceną,
  tekst na nim jest ciemny (kontrast 9,1:1).
- **Accent color**: `#141413` (ciemny, jak przycisk w mailach Content AI). To kolor przycisku „Zapłać”
  z białym napisem (kontrast 18,4:1).
- Odwrotnie nie ustawiaj: Stripe daje wtedy biały napis na złotym przycisku (kontrast 2:1, słabo czytelny).
- **Prefer logo over icon**: wyłączone. Na złotym tle złota gwiazdka z logo zlewa się z tłem,
  a ciemna okrągła ikona jest dobrze widoczna.

## Krok po kroku

1. Zaloguj się do Stripe i sprawdź, że jesteś w koncie live (bez paska „Sandbox” u góry).
2. Otwórz https://dashboard.stripe.com/settings/branding (w wyszukiwarce panelu: „Branding”).
3. **Icon**: Upload, plik `stripe-ikona.png`.
4. **Logo**: Upload, plik `stripe-logo.png`.
5. **Brand color**: `#F6A623`. **Accent color**: `#141413`. **Prefer logo over icon**: bez zaznaczenia.
6. Sprawdź podgląd po prawej stronie na zakładkach Checkout, Email receipts, Customer portal i Invoice.
   Przycisk „Zapłać” ma być czarny z białym napisem.
7. Kliknij **Save changes**. „Add your domain” pomiń (własna domena dla Checkout nie jest potrzebna).

Pliki pobierzesz z GitHuba (folder `dokumenty/marka`, przycisk „Download raw file”) albo z serwera:
`/srv/contentai/dokumenty/marka/`.
