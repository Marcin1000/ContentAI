# iOS - budowa aplikacji

Wazne: iOS nie uzywa formatu APK. To format wylacznie Androida. Na iPhone i iPad aplikacje
buduje sie w Xcode na komputerze Mac, a instaluje przez konto Apple Developer, TestFlight albo
App Store. Alternatywa bez budowania natywnego to PWA (sekcja na koncu).

## Sciezka natywna (Capacitor + Xcode)

### Wymagania
- Komputer Mac z systemem macOS
- Xcode (z App Store)
- CocoaPods (`sudo gem install cocoapods`)
- Konto Apple Developer:
  - bezplatne: instalacja na wlasnym urzadzeniu, certyfikat wygasa po 7 dniach
  - platne (99 USD/rok): TestFlight, dystrybucja wewnetrzna, App Store

### Kroki
1. Zbuduj payload web i skopiuj do `capacitor/`:
   ```
   python3 ../zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev
   cp -r ../web ./web
   ```

2. Zaleznosci i platforma:
   ```
   npm install
   npx cap add ios
   npx cap sync ios
   ```

3. Uprawnienie mikrofonu.
   Otworz projekt:
   ```
   npx cap open ios
   ```
   W Xcode w pliku `Info.plist` dodaj klucz:
   - `NSMicrophoneUsageDescription` = "Aplikacja uzywa mikrofonu do dyktowania i transkrypcji."

4. Podpis i uruchomienie:
   - w Xcode wybierz Team w zakladce Signing & Capabilities,
   - podlacz iPhone lub wybierz symulator,
   - Run (przycisk play) buduje i instaluje aplikacje.

5. Dystrybucja:
   - Product > Archive, nastepnie Distribute App,
   - TestFlight (testerzy wewnetrzni) lub App Store (publicznie).

## Sciezka bez budowania: PWA (Dodaj do ekranu glownego)

Aplikacja ma juz manifest i meta tagi Apple, wiec mozna ja zainstalowac jako PWA bez Xcode:
1. Opublikuj aplikacje pod adresem https (intranet lub serwer), z dzialajacym workerem.
2. Na iPhone otworz adres w Safari.
3. Przycisk Udostepnij > Dodaj do ekranu glownego.

Ograniczenia PWA na iOS:
- mikrofon w trybie PWA na iOS bywa zawodny (dyktowanie moze nie dzialac; czytanie na glos i
  generacja tresci dzialaja),
- wymaga hostingu pod https (nie da sie z pliku lokalnego),
- to nie jest aplikacja ze sklepu, tylko skrot uruchamiajacy strone w trybie pelnoekranowym.

Wniosek: jesli mikrofon na iOS jest istotny, potrzebna jest sciezka natywna z Xcode na Macu.
