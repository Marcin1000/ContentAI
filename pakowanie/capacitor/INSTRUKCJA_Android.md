# Content AI - budowa APK na Androida (krok po kroku)

Instrukcja prowadzi od zera do gotowego pliku .apk, który zainstalujesz na telefonie.
Większość pracy robi się raz: instalacja Android Studio. Potem build to kilka kliknięć.

Wariant domyślny w tej paczce to wersja "na spotkania": po instalacji wpisujesz
własne klucze API w aplikacji (panel Klucze API). Klucze nie są nigdzie zaszyte.

Uwaga: APK to format wyłącznie Androida. iPhone (iOS) nie używa APK - to osobna ścieżka.


## Co dostaniesz po zbudowaniu

Plik `app-debug.apk` - instalowalny na dowolnym telefonie z Androidem (wersja do
testów i pokazów, tzw. sideload). Wersja podpisana do sklepu Google Play to osobny,
późniejszy krok.


## Co musisz mieć zainstalowane (jednorazowo)

1. Node.js LTS - jeśli budowałeś już wersję na Windows, masz go. Jeśli nie:
   pobierz z https://nodejs.org i zainstaluj.

2. Android Studio - pobierz z https://developer.android.com/studio i zainstaluj.
   Przy pierwszym uruchomieniu kreator (Setup Wizard) sam pobierze Android SDK.
   Zgódź się na pobranie i poczekaj, aż skończy (to kilka minut i kilka GB).
   Android Studio zawiera wszystko, co potrzebne do buildu (SDK, Gradle, Java) -
   nie musisz instalować niczego więcej.

Jak sprawdzić Node (wpisz w PowerShell lub terminalu):
```
node -v
npm -v
```


## Krok 1. Otwórz PowerShell w folderze capacitor

1. Rozpakuj paczkę `ContentAI_pakowanie`.
2. Wejdź do folderu `capacitor`.
3. W pasku adresu Eksploratora plików wpisz `powershell` i naciśnij Enter.
   (Na Macu otwierasz Terminal i wchodzisz do folderu komendą `cd`.)


## Krok 2. Zainstaluj zależności i dodaj platformę Android

```
npm install
npx cap add android
npx cap sync android
```
`npm install` pobiera Capacitora. `cap add android` tworzy podfolder `android`
z projektem. `cap sync` wgrywa zawartość aplikacji (folder `web`) do projektu.


## Krok 2b. Ustaw ikone aplikacji (gotowe ikony, bez kompilacji)

Wazne: na Windows ARM (arm64) NIE uzywaj `npx @capacitor/assets` - narzedzie ciagnie
biblioteke `sharp`, ktora nie ma gotowego binarium na ARM i probuje sie skompilowac
(blad MSB8020: brak narzedzi kompilacji v145). Zamiast tego skopiuj gotowe ikony z paczki.

Po `npx cap add android` skopiuj zawartosc `android-res\res` do projektu (nadpisz istniejace):

PowerShell (w folderze capacitor):
```
Copy-Item android-res\res\* android\app\src\main\res\ -Recurse -Force
npx cap sync android
```
Mac/Linux:
```
cp -r android-res/res/* android/app/src/main/res/
npx cap sync android
```
To wgra brandowa ikone launchera (legacy + round + adaptive) w 5 gestosciach, bez zadnej kompilacji.

Alternatywa tylko dla Windows x64 / Intel Maca (gdzie `sharp` ma gotowe binarium): mozesz
uzyc `npm i -D @capacitor/assets` i `npx @capacitor/assets generate --android` z plikami
z folderu `resources`. Na ARM ta sciezka nie zadziala - trzymaj sie kopiowania `android-res`.


## Krok 3. Włącz mikrofon (dyktowanie i transkrypcja)

To jeden wpis w pliku konfiguracji Androida.

1. Otwórz plik:
   `capacitor\android\app\src\main\AndroidManifest.xml`
2. Wewnątrz znacznika `<manifest ...>` dodaj linię:
   ```
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   ```
3. Zapisz plik.

Bez tego wpisu dyktowanie nie zadziała. Generowanie treści, grafik i czytanie
na głos silnikiem przeglądarki działają niezależnie od mikrofonu.


## Krok 4. Otwórz projekt w Android Studio

```
npx cap open android
```
Android Studio otworzy projekt. Przy pierwszym razie u dołu ekranu poleci
"Gradle sync" - poczekaj, aż skończy (pasek postępu zniknie). Pierwszy raz
może potrwać kilka minut, bo dociąga komponenty.


## Krok 5. Zbuduj APK

W Android Studio, w górnym menu:
1. Build > Build Bundle(s) / APK(s) > Build APK(s).
2. Poczekaj na komunikat "APK(s) generated successfully".
3. W tym komunikacie kliknij "locate" - otworzy się folder z plikiem.

Plik będzie tutaj:
```
capacitor\android\app\build\outputs\apk\debug\app-debug.apk
```


## Krok 6. Zainstaluj APK na telefonie

1. Prześlij `app-debug.apk` na telefon (kabel USB, e-mail do siebie, dysk w chmurze).
2. Na telefonie otwórz plik. Android zapyta o zgodę na instalację z nieznanego
   źródła - włącz "Zezwalaj z tego źródła" i wróć do instalacji.
3. Po zainstalowaniu uruchom aplikację. Otworzy się panel Klucze API - wpisz:
   - Anthropic (wymagany, z console.anthropic.com),
   - OpenAI (grafiki, audio, transkrypcja),
   - ElevenLabs (głos premium, opcjonalny).
4. Przy pierwszym dyktowaniu telefon zapyta o dostęp do mikrofonu - zezwól.


## Po zmianie zawartości aplikacji

Jeśli wgrasz nowszą wersję aplikacji (folder `web`), w folderze `capacitor`:
```
npx cap sync android
```
Potem zbuduj APK ponownie (Krok 5). Wpis o mikrofonie z Kroku 3 zostaje, nie
trzeba go dodawać drugi raz.

Aby zmienić wariant (np. na proxy) albo wgrać nowszą wersję z pliku źródłowego,
najpierw zbuduj `web` skryptem z folderu nadrzędnego:
```
python ..\zbuduj_web.py
Copy-Item ..\web .\web -Recurse -Force
npx cap sync android
```
(Na Macu: `python3 ../zbuduj_web.py` i `cp -r ../web ./web`.)


## Wersja do sklepu Google Play (później)

Plik debug nadaje się do pokazów i ręcznej instalacji. Do Google Play potrzebny
jest build podpisany własnym kluczem (keystore) i format AAB zamiast APK. To
osobny krok - daj znać, przygotujemy konfigurację podpisu.


## Najczęstsze problemy

- "SDK location not found" - nie dokończył się Setup Wizard w Android Studio.
  Otwórz Android Studio, dokończ pobieranie SDK, spróbuj ponownie.
- Gradle sync trwa bardzo długo albo się wywala - sprawdź internet i firewall
  firmowy. Pierwszy build pobiera komponenty.
- `npx nie jest rozpoznawane` - Node.js nie jest zainstalowany albo PowerShell
  był otwarty przed instalacją. Zamknij i otwórz PowerShell na nowo.
- Dyktowanie nie działa - sprawdź, czy dodałeś wpis RECORD_AUDIO z Kroku 3 i czy
  zezwoliłeś na dostęp do mikrofonu przy pierwszym użyciu.
