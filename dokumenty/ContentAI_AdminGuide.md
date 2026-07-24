# Content AI - Instrukcja Admina

---

## Zanim zaczniesz - jednorazowy setup

Potrzebujesz tego tylko raz, na swoim komputerze:

1. **Python 3** → pobierz z [python.org](https://python.org) i zainstaluj
2. **Node.js** → pobierz z [nodejs.org](https://nodejs.org) i zainstaluj
3. Otwórz terminal (cmd / PowerShell) i wpisz:
   ```
   npm install -g javascript-obfuscator
   ```

U siebie lokalnie trzymasz te pliki - **nikomu ich nie wysyłaj:**
```
ContentAI.html   ← główny plik źródłowy
build.py             ← skrypt do generowania plików dla użytkowników
build.bat            ← uruchamia build.py dwuklikiem (Windows)
worker.js            ← plik serwera (tylko przy wdrożeniu PWA)
```

---

## Jak dodać nowego użytkownika - krok po kroku

### Krok 1 - Utwórz klucz API dla tej osoby

Wejdź na [console.anthropic.com](https://console.anthropic.com):

1. **API Keys → Create Key**
2. Nazwij klucz np. `anna_k` (imię osoby)
3. Skopiuj klucz - wyświetla się tylko raz
4. **Settings → Limits → Monthly Spend Limit** → ustaw np. `$10`

---

### Krok 2 - Wpisz dane osoby do pliku

Otwórz `ContentAI.html` w Notatniku lub VS Code.

Znajdź i zmień dwie linie:

```javascript
const API_KEY = 'WSTAW_TUTAJ_NOWY_KLUCZ_API';
```
→ wklej klucz z kroku 1, np.:
```javascript
const API_KEY = 'sk-ant-api03-...';
```

```javascript
const USER_LABEL = 'WSTAW_TUTAJ_ID';
```
→ wpisz zanonimizowany identyfikator użytkownika (nie imię i nazwisko), bez spacji i polskich znaków, np.:
```javascript
const USER_LABEL = 'u-2207';
```

> USER_LABEL nie musi być danymi osobowymi. Zalecany jest zanonimizowany ciąg (np. u-2207, mkt-07) jednoznacznie wskazujący konkretnego użytkownika. Ogranicza to dane osobowe wysyłane do API (wymóg ODO).

Jeśli osoba ma korzystać z **generatora grafik**, wpisz też klucz OpenAI:
```javascript
const OPENAI_API_KEY = 'WSTAW_TUTAJ_KLUCZ_OPENAI';
```
→ wklej klucz z [platform.openai.com](https://platform.openai.com), np.:
```javascript
const OPENAI_API_KEY = 'sk-proj-...';
```
Jeśli pole zostawisz puste, generowanie tekstu działa normalnie, a generator grafik pokaże komunikat o braku klucza.

Zapisz plik.

---

### Krok 3 - Wygeneruj plik dla użytkownika

Otwórz terminal w folderze z plikami i wpisz:
```
python3 build.py
```
Na Windows możesz też kliknąć dwukrotnie `build.bat`.

W folderze `dist/` pojawi się 5 wersji pliku:

| Plik | Dla kogo |
|---|---|
| `ContentAI.html` | DEV - czytelny, do edycji (nie wysyłaj) |
| `ContentAI_internal.html` | jeden użytkownik - obfuskowany, blokada urządzenia |
| `ContentAI_proxy.html` | wdrożenie PWA - bez klucza, klucze na serwerze |
| `ContentAI_owner.html` | Ty/admin - czytelny, bez blokady urządzenia |
| `ContentAI_team.html` | grupa (pilotaż, security review) - obfuskowany, bez blokady |

Dla pojedynczego użytkownika wewnętrznego wyślij:
```
dist/ContentAI_internal.html
```

---

### Krok 4 - Wyślij plik

Wyślij `ContentAI_internal.html` przez **Teams lub OneDrive** (nie mailem grupowym).

Powiedz osobie żeby:
- Zapisała plik w stałym miejscu na dysku, np. `C:\Content AI\`
- Zawsze otwierała go z tego samego miejsca
- Nie przenosiła go do innych folderów (zmiana lokalizacji = reset dostępu)

---

## Zarządzanie kluczami API

Wszystko przez [console.anthropic.com](https://console.anthropic.com):

| Co chcesz zrobić | Gdzie |
|---|---|
| Nowy klucz | API Keys → Create Key |
| Limit kosztów | Settings → Limits → Monthly Spend Limit |
| Podgląd użycia | Usage (filtruj po nazwie klucza) |
| Zablokowanie klucza | API Keys → Delete |

> Jeden klucz = jedna osoba. Limit $5-15/mies. na osobę w zależności od intensywności użycia.

---

## Najczęstsze problemy

### „Nieautoryzowane urządzenie"

Osoba przeniosła plik, zmieniła przeglądarkę lub reinstalowała system.

**Rozwiązanie:** Wygeneruj nowy plik (Kroki 2-4) i wyślij ponownie. Dostęp zarejestruje się automatycznie przy pierwszym otwarciu nowego pliku.

---

### Osoba zgubiła plik

1. Unieważnij jej klucz w Anthropic Console (API Keys → Delete)
2. Utwórz nowy klucz
3. Wygeneruj i wyślij nowy plik (Kroki 1-4)

---

### Podejrzenie nadużycia klucza

1. Sprawdź Usage w Anthropic Console - filtruj po nazwie klucza
2. Jeśli zapytania są poza godzinami pracy lub jest ich za dużo - usuń klucz natychmiast
3. Opcjonalnie: wyjaśnij sprawę z osobą, wygeneruj nowy klucz

---

## Co zabezpiecza system

| Zabezpieczenie | Co robi |
|---|---|
| Obfuskacja kodu | Klucz API jest ukryty w obfuskowanym kodzie pliku |
| Limit kosztów | Nawet jeśli klucz wycieknie, koszt jest ograniczony |
| Device fingerprint | Plik działa tylko na urządzeniu, na którym był pierwszy raz otwarty |
| User watermark | Każde zapytanie do API jest oznaczone imieniem użytkownika |
| Jeden klucz per osoba | Łatwa identyfikacja i natychmiastowe zablokowanie |

---

## Opcja: integracja z Azure AI Foundry (firmowa subskrypcja Microsoft)

Domyślnie aplikacja łączy się bezpośrednio z Anthropic (treść) i OpenAI (grafiki). Jeśli firma chce kierować ruch przez subskrypcję Azure Content AI - z rozliczeniem w Azure i danymi w tenancie firmowym - można przełączyć aplikację na Azure AI Foundry bez zmiany funkcji. Claude jest dostępny na Foundry z tym samym API, więc nie zmienia się jakość ani sposób działania.

### Co przygotowuje zespół Azure (jednorazowo)

1. W portalu `ai.azure.com` utwórz zasób Foundry (region East US2 lub Sweden Central).
2. Wdróż deployment modelu Claude (np. `claude-sonnet-4-6`) - sekcja Models + endpoints → Deploy base model.
3. Wdróż deployment modelu grafik (gpt-image lub DALL-E) w zasobie Azure OpenAI.
4. Z sekcji Keys and Endpoint skopiuj: endpoint i klucz dla treści oraz endpoint i klucz dla grafik.

### Konfiguracja w pliku DEV

W górnej części pliku, w bloku konfiguracji, ustaw:

```
const USE_AZURE = true;
const AZURE_FOUNDRY_URL       = 'https://TWOJ-ZASOB.services.ai.azure.com/anthropic/v1/messages';
const AZURE_FOUNDRY_KEY       = 'klucz-z-Keys-and-Endpoint';
const AZURE_CLAUDE_DEPLOYMENT = 'claude-sonnet-4-6';   // nazwa Twojego deploymentu
const AZURE_HAIKU_DEPLOYMENT  = 'claude-haiku-4-5';
const AZURE_OPENAI_IMG_URL    = 'https://TWOJ-ZASOB.openai.azure.com/openai/deployments/DEPLOYMENT/images/generations?api-version=2025-04-01-preview';
const AZURE_OPENAI_KEY        = 'klucz-Azure-OpenAI';
```

Następnie uruchom `python3 build.py` i rozdystrybuuj plik jak zwykle. Aby wrócić do trybu bezpośredniego, ustaw `USE_AZURE = false`.

### Co się zmienia, a co nie

| Element | Tryb bezpośredni | Tryb Azure |
|---|---|---|
| Treść (model) | Claude przez api.anthropic.com | Claude przez Foundry (ten sam model) |
| Grafiki | OpenAI gpt-image | Azure OpenAI gpt-image/DALL-E |
| Klucz API treści | `API_KEY` | `AZURE_FOUNDRY_KEY` |
| Rozliczenie | konto Anthropic + OpenAI | subskrypcja Azure (jedna faktura) |
| Wyszukiwanie w sieci (Widoczność / Raport) | dostępne | dostępne (Foundry / Claude) |
| Funkcje aplikacji | bez zmian | bez zmian |

Szczegóły techniczne, przepływ danych i odpowiedzi na pytania IT: patrz `ContentAI_Azure_IT.pdf`.

---

## Nowe moduły AI (v2.7) - co admin powinien wiedzieć

Aplikacja ma teraz funkcje gotowości i widoczności w AI. Z perspektywy admina ważne są cztery rzeczy.

**Koszt: wyszukiwanie w sieci.** Moduły Widoczność AI i Raport AI używają wyszukiwania w sieci po stronie Anthropic. To dodatkowy, płatny element zużycia (poza tokenami tekstu). Jeśli zespół intensywnie korzysta z pomiaru widoczności, uwzględnij to w limicie kosztów na klucz (Settings → Limits). Generowanie treści, llms.txt, schema i tracking nie używają wyszukiwania.

**Dane lokalne (localStorage).** Oprócz historii artykułów i Brand Voice aplikacja zapisuje lokalnie w przeglądarce: konfigurację encji (`cai-llms`), konfigurację widoczności (`cai-vis`) oraz snapshoty pomiarów, do 20 (`cai-vis-runs`). Nic z tego nie trafia na serwery Content AI ani zewnętrzne bazy. Wyczyszczenie danych przeglądarki kasuje te wpisy.

**Nowe pozycje w menu ustawień (kółko zębate):** Pliki dla AI (llms.txt, schema), Widoczność AI, Raport AI, Tracking AI (robots.txt dla botów AI, UTM). Użytkownik nie konfiguruje nic na poziomie kluczy - działa to na tym samym kluczu API co generowanie. Doszedł też nowy typ treści: informacja prasowa (łącznie 9 typów).

**Tryb Azure GPT-only.** Jeśli używasz wariantu z modelem GPT przez Azure (`USE_AZURE_GPT = true`), wyszukiwanie w sieci jest niedostępne, więc moduły Widoczność AI i Narracja marki są wyłączone. Tryb Azure z Claude (Foundry, `USE_AZURE = true`) obsługuje wszystkie funkcje.

---

## Moduł audio i asystent głosowy (v2.8) - co admin powinien wiedzieć

Aplikacja czyta wygenerowane treści na głos, tworzy podcast wielogłosowy, pozwala dyktować do pól oraz transkrybować nagrania. Z perspektywy admina ważne jest pięć rzeczy.

**Wybór silnika.** Są trzy silniki głosu. Przeglądarka działa lokalnie i bez kosztu, nic nie wysyła. OpenAI daje wyższą jakość i idzie przez ten sam proxy co generowanie. ElevenLabs daje najlepszy polski i działa bez serwera, bezpośrednio z przeglądarki na klucz lub proxy.

**Klucze.** OpenAI korzysta z tego samego klucza co grafiki. ElevenLabs wymaga osobnego klucza `ELEVEN_API_KEY` (z elevenlabs.io), opcjonalnie. Bez klucza ElevenLabs i bez proxy ten silnik jest niedostępny, ale przeglądarka i OpenAI działają.

**Koszt.** Synteza OpenAI to około $0.05-0.15 za podcast, transkrypcja około $0.03-0.10. ElevenLabs rozlicza się według planu (znaki lub kredyty). Przeglądarka jest darmowa. Uwzględnij audio w limicie kosztów na klucz, jeśli zespół intensywnie generuje podcasty.

**Limit równoczesnych żądań ElevenLabs.** Plany ElevenLabs mają limit równoczesnych żądań (na niższych planach 3). Aplikacja generuje segmenty podcastu maksymalnie po 3 naraz dla ElevenLabs i ponawia żądanie przy chwilowym przekroczeniu (kod 429), więc generacja nie zatrzymuje się na błędzie. Jeśli zespół potrzebuje szybszej generacji, rozważ wyższy plan ElevenLabs.

**Dane głosowe (ODO).** Czytanie na głos w silniku przeglądarki jest lokalne i nic nie wysyła. Dyktowanie i transkrypcja w trybie OpenAI wysyłają nagranie głosu do OpenAI. Dyktowanie w silniku przeglądarki wysyła nagranie do usługi dostawcy przeglądarki (Google w Chrome). Nie wolno dyktować ani wczytywać do transkrypcji danych osobowych poza dozwolonym zakresem (kontakt prasowy lub marketingowy).

---

## Zasady przetwarzania danych osobowych (ODO)

Niezależnie od modułu admin pilnuje zasad zgłoszonych do ODO.

- Zakaz danych nadawców i odbiorców przesyłek oraz pracowników dostawców i kontrahentów. Te dane są przetwarzane w innych procesach, nie w generowaniu treści.
- Zakaz danych osób poniżej 18 roku życia.
- Dozwolone są dane kontaktów prasowych i marketingowych reprezentujących Content AI.
- USER_LABEL to zanonimizowany identyfikator (np. u-2207), nie imię i nazwisko. Ogranicza dane osobowe wysyłane do API.
- Po teście użytkownik czyści dane przeglądarki (localStorage), żeby nie zostawić treści z danymi.

---

*Content AI - Marcin Przybylski*
