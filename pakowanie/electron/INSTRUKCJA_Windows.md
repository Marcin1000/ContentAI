# Content AI - budowa wersji na Windows (krok po kroku)

Instrukcja prowadzi od zera do gotowego instalatora .exe. Komendy wpisujesz
w PowerShell albo w Wierszu poleceń (CMD). Działa tak samo w obu.

Wariant domyślny w tej paczce to wersja "na spotkania": po instalacji wpisujesz
własne klucze API w aplikacji (panel Klucze API). Klucze nie są nigdzie zaszyte.


## Co dostaniesz po zbudowaniu

W podfolderze `electron\dist\` powstaną dwa pliki:
- `Content AI Setup 2.8.0.exe` - klasyczny instalator (skrót na pulpicie i w menu Start),
- `ContentAI-portable.exe` - wersja bez instalacji, odpalasz dwuklikiem.


## Co musisz mieć zainstalowane (jednorazowo)

1. Node.js LTS - pobierz z https://nodejs.org i zainstaluj (klikasz Dalej, Dalej).
   To dostarcza polecenie `npm`. electron-builder dociąga resztę sam przy pierwszym buildzie.

2. Python 3 - pobierz z https://www.python.org/downloads/ i zainstaluj.
   WAŻNE: na pierwszym ekranie instalatora zaznacz "Add Python to PATH", potem Install.

Jak sprawdzić, że są zainstalowane (wpisz w PowerShell):
```
node -v
npm -v
python --version
```
Każda komenda powinna wypisać numer wersji. Jeśli `python --version` nie działa,
zamknij i otwórz PowerShell na nowo (PATH odświeża się po restarcie okna).


## Krok 1. Otwórz PowerShell w folderze z aplikacją

1. Rozpakuj paczkę `ContentAI_pakowanie` (prawy klik na zip > Wyodrębnij wszystko).
2. Wejdź do środka, do folderu `electron`.
3. W pasku adresu Eksploratora plików wpisz `powershell` i naciśnij Enter.
   PowerShell otworzy się już ustawiony na tym folderze.

Alternatywnie otwórz PowerShell ręcznie i przejdź do folderu komendą `cd`, np.:
```
cd C:\Users\TwojaNazwa\Downloads\ContentAI_pakowanie\electron
```


## Krok 2. Zainstaluj zależności (jednorazowo, potrzebny internet)

```
npm install
```
Pobiera Electron i electron-builder. Pierwszy raz trwa kilka minut.


## Krok 3. (Opcjonalnie) Podejrzyj aplikację bez budowania

```
npm start
```
Aplikacja odpali się od razu w oknie. Zamknij okno, żeby wrócić do budowania.


## Krok 4. Zbuduj instalator

```
npm run dist:win
```
Po zakończeniu pliki gotowe są w `electron\dist\`:
- `Content AI Setup 2.8.0.exe`
- `ContentAI-portable.exe`


## Krok 5. Instalacja i pierwsze uruchomienie

1. Uruchom `Content AI Setup 2.8.0.exe`. Możesz wybrać katalog instalacji.
   Powstanie skrót na pulpicie i w menu Start.
2. Aplikacja nie jest podpisana cyfrowo, więc Windows SmartScreen może pokazać
   ostrzeżenie. Kliknij "Więcej informacji" > "Uruchom mimo to".
   Aby usunąć to ostrzeżenie na stałe, trzeba kupić certyfikat do podpisu kodu (opcjonalne).
3. Po uruchomieniu otworzy się panel Klucze API. Wpisz swoje klucze:
   - Anthropic (wymagany, z console.anthropic.com),
   - OpenAI (grafiki, audio, transkrypcja),
   - ElevenLabs (głos premium, opcjonalny).
   Klucze możesz później zmienić: ikona ustawień > Klucze API.


## Gdzie są zapisywane dane i klucze

Aplikacja używa pamięci lokalnej silnika Chromium (wbudowanego w Electron).
Dane leżą w profilu aplikacji:
```
C:\Users\TwojaNazwa\AppData\Roaming\Content AI
```
Tam trzymane są m.in. wpisane klucze API i ustawienia. Klucze nie opuszczają
tego komputera poza wywołaniami do API danego dostawcy.


## Mikrofon i linki

- Dyktowanie mikrofonem działa (aplikacja w opakowaniu desktop ma bezpieczny kontekst).
- Linki z artykułów otwierają się w domyślnej przeglądarce, nie w oknie aplikacji.


## Opcjonalnie. Zmiana wariantu lub aktualizacja treści aplikacji

Folder `electron\web` to gotowa zawartość aplikacji (wariant na spotkania).
Jeśli chcesz zbudować inny wariant albo wgrać nowszą wersję aplikacji, użyj
skryptu z folderu nadrzędnego paczki. W PowerShell, będąc w folderze `electron`:

Wariant na spotkania (klucze wpisywane w aplikacji), bez dodatkowej konfiguracji:
```
python ..\zbuduj_web.py
Copy-Item ..\web .\web -Recurse -Force
```

Wariant proxy (klucze trzyma Cloudflare Worker, do szerszej dystrybucji):
```
python ..\zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev
Copy-Item ..\web .\web -Recurse -Force
```

Potem ponownie:
```
npm run dist:win
```


## macOS w skrócie

To samo robi się na Macu, tylko:
- zamiast `python` używasz `python3`,
- zamiast Copy-Item kopiujesz tak: `cp -r ../web ./web`,
- instalator budujesz komendą `npm run dist:mac`, wynik to plik `.dmg` w `electron/dist/`.
Pliku .dmg nie zbudujesz na Windowsie - potrzebny jest komputer Mac.
Na macOS bez podpisu Gatekeeper zablokuje uruchomienie, trzeba je obejść ręcznie
(prawy klik na aplikacji > Otwórz) albo podpisać build kontem Apple Developer.


## Najczęstsze problemy

- `npm nie jest rozpoznawane` - Node.js nie jest zainstalowany albo PowerShell
  był otwarty przed instalacją. Zamknij i otwórz PowerShell na nowo.
- `python nie jest rozpoznawane` - przy instalacji Pythona nie zaznaczyłeś
  "Add Python to PATH". Zainstaluj ponownie z zaznaczoną tą opcją.
- Build przerywa się przy pobieraniu - sprawdź połączenie z internetem albo
  firewall firmowy. electron-builder pobiera komponenty z github.com.
