# Marka w Stripe

Pliki powstają z `narzedzia/grafiki_marki.js` (znak z `app/pwa/icons/favicon.svg`, kolor `--c-akcent`,
krój Schibsted Grotesk), tak jak znak w nagłówku e-maili aplikacji (`serwer/zasoby/poczta-znak.png`).

| Plik | Rozmiar | Gdzie w Stripe | Gdzie widać |
|---|---|---|---|
| `stripe-ikona.png` | 512 x 512, ciemne tło | Branding, **Icon** | maile Stripe (pokwitowanie, zwrot), Checkout, panel subskrypcji, faktury |
| `stripe-logo.png` | 1200 x 300, przezroczyste tło | Branding, **Logo** | Checkout, PDF faktur |

Kolory:
- **Brand color**: `#141413` (ciemny, jak tło ikony aplikacji i przycisk w mailach Content AI),
- **Accent color**: `#F6A623` (złoty, jak znak i główny przycisk w aplikacji).

## Krok po kroku

1. Zaloguj się do Stripe i sprawdź, że jesteś w koncie live (bez paska „Sandbox” u góry).
2. Otwórz https://dashboard.stripe.com/settings/branding (w wyszukiwarce panelu: „Branding”).
3. **Icon**: Upload, plik `stripe-ikona.png`.
4. **Logo**: Upload, plik `stripe-logo.png`.
5. **Brand color**: `#141413`. **Accent color**: `#F6A623`.
6. Sprawdź podgląd po prawej stronie: Checkout, e-mail i panel subskrypcji. Napis na przyciskach ma być
   czytelny. Gdyby złoty przycisk miał biały napis i słabo się czytał, zamień kolory miejscami.
7. Kliknij **Save**.

Pliki pobierzesz z GitHuba (folder `dokumenty/marka`, przycisk „Download raw file”) albo z serwera:
`/srv/contentai/dokumenty/marka/`.
