# Android - budowa APK

## Wymagania na maszynie budujacej
- Node.js 18+ oraz npm
- JDK 17
- Android Studio (zawiera Android SDK i Gradle). Pierwsze uruchomienie pobiera SDK.

## Kroki

1. Zbuduj payload web (z katalogu nadrzednego pakietu):
   ```
   python3 ../zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev
   ```
   Skrypt tworzy `web/` obok katalogu zrodlo. Skopiuj lub dowiaz `web/` do katalogu `capacitor/`:
   ```
   cp -r ../web ./web
   ```

2. Zainstaluj zaleznosci i dodaj platforme:
   ```
   npm install
   npx cap add android
   npx cap sync android
   ```

3. Uprawnienie mikrofonu (dyktowanie i transkrypcja).
   Otworz `android/app/src/main/AndroidManifest.xml` i dodaj w sekcji `<manifest>`:
   ```xml
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   ```
   Uprawnienie `INTERNET` Capacitor dodaje domyslnie.
   Uwaga: jesli mikrofon nie jest potrzebny, mozna pominac. Czytanie na glos silnikiem
   przegladarki oraz cala generacja tresci dzialaja bez mikrofonu.

4. Build APK:
   - przez Android Studio:
     ```
     npx cap open android
     ```
     nastepnie Build > Build Bundle(s)/APK(s) > Build APK(s).
   - lub z linii polecen (debug APK do testow):
     ```
     cd android
     ./gradlew assembleDebug
     ```
     Wynik: `android/app/build/outputs/apk/debug/app-debug.apk`.

5. Wersja do dystrybucji (release).
   Do instalacji poza sklepem podpisz APK wlasnym keystore:
   ```
   ./gradlew assembleRelease
   ```
   Wymaga skonfigurowania podpisu (signingConfigs) w `android/app/build.gradle`.
   APK release jest tym, co rozsyla sie uzytkownikom (sideload) lub publikuje w Google Play
   (wtedy zalecany format AAB: `./gradlew bundleRelease`).

## Po zmianie zawartosci web/
Po kazdej zmianie aplikacji powtorz `zbuduj_web.py`, skopiuj `web/` i wykonaj `npx cap sync android`.

## Uwagi
- Aplikacja laduje sie z `https://localhost` (secure context), wiec mikrofon i schowek dzialaja.
- Biblioteki do parsowania plikow (mammoth, xlsx, pdf.js, html-docx) oraz fonty laduja sie z CDN
  przy pierwszym uzyciu. APK wymaga internetu (i tak jest potrzebny do API). Pelny tryb offline
  wymagalby wbudowania tych bibliotek lokalnie - to osobny zakres.
