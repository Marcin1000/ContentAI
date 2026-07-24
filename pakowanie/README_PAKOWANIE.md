# Content AI - pakowanie do instalacji (Windows, macOS, Android, iOS)

Ten zestaw bierze istniejaca aplikacje (jeden plik HTML) i opakowuje ja w instalowalne wersje:
- Windows i macOS przez Electron (instalator .exe oraz .dmg),
- Android i iOS przez Capacitor (APK dla Androida, projekt Xcode dla iOS).

Aplikacja pozostaje tym samym kodem. Opakowanie tylko ja uruchamia w oknie systemowym i daje
secure context potrzebny do mikrofonu.

---

## 1. Trzy decyzje do podjecia na starcie

Te decyzje zmieniaja sciezke i koszty. Rekomendacje ponizej.

### a) Ktory wariant aplikacji opakowac

Sa trzy warianty, do roznych celow:

- KEYS (domyslny) - klucze wpisywane w aplikacji. Po instalacji uzytkownik otwiera panel
  "Klucze API" (ikona ustawien) i wpisuje wlasne klucze Anthropic, OpenAI, ElevenLabs.
  Klucze zapisuja sie lokalnie na urzadzeniu (localStorage). Panel otwiera sie sam przy
  pierwszym uruchomieniu. To wariant na spotkania i pokazy wewnetrzne.

- PROXY - bez kluczy w pliku, ruch przez Cloudflare Worker. Do szerszej dystrybucji, gdy
  nie chcesz, zeby kazdy uzytkownik mial wlasny klucz. Klucze trzyma worker.

- OWNER - klucze wpisane na stale w pliku. Tylko na jedno zaufane, wewnetrzne urzadzenie.

Uwaga bezpieczenstwa: instalator i APK to pliki, ktore mozna rozpakowac. Wariant KEYS nie
zawiera zadnych kluczy (kazdy wpisuje swoje), wiec jest bezpieczny do rozdania. Wariant OWNER
ma klucz w srodku i nadaje sie wylacznie na pojedyncze, kontrolowane urzadzenie.


### b) Czy masz dostep do komputera Mac

Mac jest wymagany do:
- zbudowania macOS .dmg,
- zbudowania aplikacji iOS (Xcode).

Windows .exe i Android APK budujesz na Windows lub Linux. Bez Maca zostaje dla iOS jedynie sciezka
PWA (Dodaj do ekranu glownego), z ograniczeniami opisanymi w `capacitor/ios-notes.md`.

### c) Dystrybucja wewnetrzna czy sklepy

- Wewnetrzna (intranet, reczna instalacja, MDM): nie wymaga sklepow ani platnych kont, ale
  uzytkownicy moga zobaczyc ostrzezenia systemowe przy braku podpisu.
- Sklepy (Google Play, App Store): wymagaja kont deweloperskich, podpisu i procesu recenzji.
  iOS dodatkowo wymaga konta Apple Developer (99 USD/rok).

---

## 2. Co da sie zbudowac i na czym

| Cel | Narzedzie | Format | Maszyna budujaca |
|-----|-----------|--------|------------------|
| Windows | Electron | .exe (NSIS) | Windows |
| macOS | Electron | .dmg | Mac |
| Linux (bonus) | Electron | AppImage | Linux |
| Android | Capacitor | APK | Windows/macOS/Linux + Android SDK |
| iOS | Capacitor | aplikacja przez Xcode | Mac |
| iOS bez budowania | PWA | skrot na ekranie glownym | dowolna (potrzebny hosting https) |

Uwaga o iOS: nie istnieje APK dla iOS. To format wylacznie Androida. Na iPhone trzeba albo
zbudowac aplikacje w Xcode na Macu, albo uzyc PWA.

---

## 3. Struktura zestawu

```
contentai/
  app/
    contentai.src.html     <- JEDNO ZRODLO (nie otwierac w przegladarce)
    web-keys.html          <- gotowa aplikacja, wariant KEYS
    web-proxy.html         <- gotowa aplikacja, wariant PROXY
    web-owner.html         <- gotowa aplikacja, wariant OWNER
    worker.js              <- Cloudflare Worker (potrzebny dla wariantu PROXY)
    pwa/                   <- manifest.json + ikony
  pakowanie/
    README_PAKOWANIE.md    <- ten plik
    warianty.py            <- buduje wybrany wariant ze zrodla
    zbuduj_web.py          <- przygotowuje wspolny payload web/ dla obu opakowan
    electron/              <- opakowanie Windows i macOS
      README.md
      main.js, preload.js, package.json, build/icon.png
    capacitor/             <- opakowanie Android i iOS
      android-notes.md
      ios-notes.md
      capacitor.config.json, package.json
      android-res/, ios-res/, resources/   <- ikony natywne i splashe
```

Warianty KEYS, PROXY i OWNER leza gotowe w `app/` - mozna je otworzyc wprost w przegladarce.
Powstaja ze zrodla; po kazdej zmianie w `contentai.src.html` przebuduj je:
`cd pakowanie && python3 warianty.py --wszystkie -o ../app`.
`zbuduj_web.py --wariant <nazwa>` buduje payload web/ prosto ze zrodla, niezaleznie od tych plikow.

---

## 4. Krok wspolny: przygotowanie web/ i workera

### 4.1 Wariant PROXY wymaga dzialajacego Cloudflare Worker

Bez tego aplikacja nie ma jak wolac API. Worker masz w `app/worker.js`.
W skrocie (instrukcja jest w komentarzu na gorze worker.js):
1. Wdroz `worker.js` na Cloudflare Workers.
2. Ustaw zmienne srodowiskowe workera: `ANTHROPIC_KEY`, `OPENAI_KEY`, opcjonalnie `ELEVEN_KEY`.
3. Zapisz adres workera, np. `https://moj-worker.example.workers.dev`.

### 4.2 Zbuduj payload web/

Na spotkania (wariant z wpisywaniem kluczy, bez workera):
```
python3 zbuduj_web.py
```

Do szerszej dystrybucji (wariant proxy, wymaga workera z sekcji 4.1):
```
python3 zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev
```

Skrypt tworzy katalog `web/` (index.html + manifest.json + icons/). Service Worker jest celowo
pomijany, zeby uniknac problemow ze stalym cache w aplikacji natywnej.

Po zbudowaniu `web/` skopiuj go do opakowania, ktorego uzywasz:
```
cp -r web electron/web        # dla Windows/macOS
cp -r web capacitor/web       # dla Android/iOS
```

---

## 5. Sciezki budowy

- Windows i macOS: szczegoly w `electron/README.md`
  (w skrocie: `cd electron && npm install && npm run dist:win` lub `npm run dist:mac`)
- Android: szczegoly w `capacitor/android-notes.md`
  (w skrocie: `cd capacitor && npm install && npx cap add android && npx cap sync && build APK`)
- iOS: szczegoly w `capacitor/ios-notes.md` (Xcode na Macu albo PWA)

---

## 6. Koszty i wymagania (skrot)

| Pozycja | Windows | macOS | Android | iOS |
|---------|---------|-------|---------|-----|
| Maszyna budujaca | Windows | Mac | dowolna + Android SDK | Mac |
| Konto platne | nie | tylko do podpisu/notaryzacji | nie (sideload), Play do sklepu | Apple Developer 99 USD/rok do urzadzenia/sklepu |
| Bez podpisu | ostrzezenie SmartScreen | Gatekeeper blokuje, trzeba obejsc | dziala (sideload, debug/release) | tylko symulator lub 7 dni na wlasnym urzadzeniu |

---

## 7. Czego ten zestaw nie robi

- Nie kompiluje binariow za Ciebie. To gotowy do zbudowania projekt; instalatory i APK powstaja
  na docelowych maszynach (m.in. .dmg i iOS wymagaja Maca, APK wymaga Android SDK).
- Nie wdraza workera. Worker wdraza sie raz na Cloudflare (sekcja 4.1).
- Nie zapewnia trybu w pelni offline. Biblioteki do plikow i fonty laduja sie z CDN; aplikacja
  i tak potrzebuje internetu do API. Pelny offline to osobny zakres (wbudowanie bibliotek lokalnie).

---

## 8. Najkrotsza sciezka na spotkanie (Windows, wariant keys)

```
python3 zbuduj_web.py
cp -r web electron/web
cd electron
npm install
npm run dist:win
# instalator w electron/dist/
# po instalacji: uruchom, panel "Klucze API" otworzy sie sam, wpisz klucze
```

Dla Androida zamiast electron uzyj capacitor (patrz capacitor/android-notes.md), payload web/ ten sam.

