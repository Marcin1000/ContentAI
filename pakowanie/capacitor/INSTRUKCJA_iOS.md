# Content AI - wersja na iPhone (iOS), krok po kroku

Najważniejsze na start: iOS nie używa APK. To format wyłącznie Androida. Aplikację
na iPhone buduje się na komputerze Mac w programie Xcode. Bez Maca zostaje ścieżka
PWA (skrót na ekranie głównym) - opisana na końcu.

Są więc dwie drogi:
- A. Natywna (Mac + Xcode) - pełna aplikacja, instalacja na telefonie lub do TestFlight.
- B. PWA (bez budowania) - skrót do strony na ekranie głównym, działa bez Maca.


# Droga A. Natywna (Mac + Xcode)

## Co musisz mieć (jednorazowo)
1. Komputer Mac z systemem macOS.
2. Xcode - zainstaluj z App Store (duży plik, kilka GB). Uruchom raz, żeby dokończył
   instalację komponentów.
3. Node.js LTS - z https://nodejs.org.
4. CocoaPods - w aplikacji Terminal wpisz:
   ```
   sudo gem install cocoapods
   ```
5. Konto Apple. Do wyboru:
   - bezpłatne (zwykłe Apple ID) - instalacja na własnym iPhonie, ale aplikacja
     wygasa po 7 dniach i trzeba ją zainstalować ponownie,
   - płatne Apple Developer (99 USD/rok) - TestFlight, dystrybucja wewnętrzna, App Store.

## Krok 1. Otwórz Terminal w folderze capacitor
W aplikacji Terminal wejdź do folderu komendą `cd`, np.:
```
cd ~/Downloads/ContentAI_pakowanie/capacitor
```

## Krok 2. Zainstaluj zależności i dodaj platformę iOS
```
npm install
npx cap add ios
npx cap sync ios
```

## Krok 2b. Ustaw ikone aplikacji (gotowe ikony, bez kompilacji)

Wazne: nie polegaj na `npx @capacitor/assets`, jesli ciagnie `sharp` i probuje kompilowac
(na ARM to sie nie powiedzie). Uzyj gotowej ikony z paczki.

Po `npx cap add ios` podmien zawartosc AppIcon:
```
cp -r ios-res/AppIcon.appiconset/* ios/App/App/Assets.xcassets/AppIcon.appiconset/
npx cap sync ios
```
To wstawi brandowa ikone (1024, uniwersalna) bez kompilacji. Grafike zmienisz podmieniajac
`ios-res/AppIcon.appiconset/AppIcon-1024.png`.


## Krok 3. Otwórz projekt w Xcode
```
npx cap open ios
```
Xcode otworzy projekt aplikacji.

## Krok 4. Włącz mikrofon (dyktowanie i transkrypcja)
W Xcode po lewej znajdź plik `Info` (Info.plist) i dodaj nowy klucz:
- klucz: `Privacy - Microphone Usage Description`
  (techniczna nazwa: `NSMicrophoneUsageDescription`),
- wartość: `Aplikacja używa mikrofonu do dyktowania i transkrypcji.`

Bez tego wpisu system zablokuje mikrofon. Generowanie treści i czytanie na głos
działają niezależnie od mikrofonu.

## Krok 5. Podpis (Signing)
W Xcode kliknij projekt na górze drzewa po lewej, zakładka "Signing & Capabilities":
- zaznacz "Automatically manage signing",
- w polu "Team" wybierz swoje konto Apple (zaloguj się przez Add an Account, jeśli puste).

## Krok 6. Uruchom na telefonie lub symulatorze
1. Na górze Xcode, obok przycisku Play, wybierz urządzenie:
   - podłączony przez kabel iPhone, albo
   - symulator (np. iPhone 15).
2. Kliknij Play (trójkąt). Xcode zbuduje i zainstaluje aplikację.
3. Przy pierwszym uruchomieniu na fizycznym iPhonie z kontem bezpłatnym telefon
   poprosi o zaufanie profilu: na telefonie wejdź w Ustawienia > Ogólne >
   Zarządzanie VPN i urządzeniami > Twój profil > Zaufaj.
4. Po uruchomieniu otworzy się panel Klucze API. Wpisz:
   - Anthropic (wymagany, z console.anthropic.com),
   - OpenAI (grafiki, audio, transkrypcja),
   - ElevenLabs (głos premium, opcjonalny).

## Krok 7. Dystrybucja (opcjonalnie, wymaga konta płatnego)
W Xcode: Product > Archive, potem Distribute App:
- TestFlight - dla testerów wewnętrznych,
- App Store - publicznie.

## Po zmianie zawartości aplikacji
W folderze `capacitor`:
```
npx cap sync ios
```
Potem ponownie Play w Xcode (Krok 6). Wpis o mikrofonie zostaje.


# Droga B. PWA (bez Maca, bez budowania)

Aplikacja ma już manifest i meta tagi Apple, więc można ją dodać jako skrót na
ekranie głównym iPhone bez Xcode.

1. Opublikuj aplikację pod adresem https (intranet lub serwer firmowy). Wariant
   keys nadaje się wprost; wariant proxy wymaga działającego workera.
2. Na iPhonie otwórz ten adres w przeglądarce Safari.
3. Naciśnij przycisk Udostępnij (kwadrat ze strzałką) > Dodaj do ekranu głównego.

Ograniczenia PWA na iOS:
- mikrofon (dyktowanie) bywa zawodny lub nie działa; czytanie na głos i generowanie
  treści działają,
- wymaga hostingu https - nie da się z pliku lokalnego,
- to nie jest aplikacja ze sklepu, tylko skrót uruchamiający stronę w trybie pełnoekranowym.

Wniosek: jeśli dyktowanie na iPhonie ma działać pewnie, potrzebna jest droga A (Mac + Xcode).


## Najczęstsze problemy (Droga A)
- "No account / Failed to register bundle identifier" - zaloguj konto Apple w
  Xcode (Settings > Accounts) i wybierz Team w Signing & Capabilities.
- Aplikacja przestała działać po tygodniu - to limit konta bezpłatnego (7 dni).
  Zainstaluj ponownie (Play w Xcode) albo przejdź na konto płatne.
- "Could not find Pod" lub błąd CocoaPods - uruchom w folderze `capacitor/ios/App`:
  ```
  pod install
  ```
