# Windows i macOS - budowa instalatorow (Electron)

## Wymagania na maszynie budujacej
- Node.js 18+ oraz npm
- Windows .exe budujesz na Windows. macOS .dmg budujesz na Macu.
  Budowa .dmg na Windows lub Linux nie jest mozliwa (potrzebne narzedzia systemu macOS).

## Kroki (te same na Windows i Mac)

1. Zbuduj payload web (z katalogu nadrzednego pakietu):
   ```
   python3 ../zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev
   ```
   Skrypt tworzy `web/` obok katalogu zrodlo. Skopiuj lub dowiaz `web/` do katalogu `electron/`:
   ```
   cp -r ../web ./web
   ```
   (Windows PowerShell: `Copy-Item ..\web .\web -Recurse`)

2. Zaleznosci:
   ```
   npm install
   ```

3. Podglad lokalny (opcjonalnie):
   ```
   npm start
   ```

4. Instalator:
   - Windows (plik .exe, instalator NSIS):
     ```
     npm run dist:win
     ```
   - macOS (plik .dmg):
     ```
     npm run dist:mac
     ```
   Wynik laduje w `electron/dist/`.

## Ikona
`build/icon.png` (512x512) jest uzywany do automatycznego wygenerowania ikon Windows i macOS.
Jesli chcesz dopracowac ikone Windows, mozesz podmienic na `build/icon.ico` (256x256).

## Podpis (opcjonalnie, zalecane przy szerszej dystrybucji)
- Windows: bez podpisu SmartScreen pokaze ostrzezenie przy instalacji. Podpis wymaga certyfikatu
  Code Signing.
- macOS: bez podpisu i notaryzacji Gatekeeper zablokuje uruchomienie. Wymaga konta Apple Developer
  (99 USD/rok) i konfiguracji notaryzacji w electron-builder.
Do dystrybucji wewnetrznej (intranet, reczna instalacja) podpis nie jest konieczny, ale uzytkownicy
zobacza ostrzezenia systemowe.

## Mikrofon i linki
- Aplikacja jest serwowana przez wlasny protokol `app://` (secure context), wiec mikrofon dziala.
- Linki z artykulow otwieraja sie w domyslnej przegladarce, nie w oknie aplikacji.

## Po zmianie zawartosci web/
Powtorz `zbuduj_web.py`, skopiuj `web/` i ponownie `npm run dist:win` lub `dist:mac`.
