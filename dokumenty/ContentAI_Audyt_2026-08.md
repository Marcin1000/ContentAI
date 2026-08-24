# Content AI — audyt przed wdrożeniem, sierpień 2026

Audyt wykonany przed postawieniem aplikacji na serwerze produkcyjnym, po serii zmian:
pakiety i limity, licznik w interfejsie, kreator pierwszego uruchomienia, klucze
użytkownika, podpowiedzi tematów, strona produktowa i domena.

Zakres: funkcjonalność, spójność źródła, UX/UI, dostępność, dokumentacja.

---

## Podsumowanie

| Obszar | Stan |
|---|---|
| Funkcjonalność | ✅ bez usterek |
| Spójność wariantów | ✅ 68 kontroli, wszystkie przechodzą |
| Testy serwera | ✅ 214/214 |
| i18n | ✅ 755 kluczy, oba języki symetryczne |
| Dostępność | ⚠️ 3 usterki znalezione, **wszystkie poprawione** |
| Dokumentacja | ⚠️ 4 nieaktualności, **wszystkie poprawione** |
| Bezpieczeństwo | ✅ bez zmian względem poprzedniego audytu |

**Znaleziono 7 usterek, naprawiono 7.** Żadna nie była krytyczna, ale trzy z nich są
tego rodzaju, że nie zgłaszają się same — działałyby po cichu źle.

---

## Co zostało sprawdzone i czym

Audyt świadomie opiera się na **kontrolach maszynowych tam, gdzie to możliwe**, bo klasy
błędów opisane niżej są dokładnie tymi, których oko nie łapie: brak nie powoduje awarii,
tylko cichą degradację.

| Kontrola | Czym | Wynik |
|---|---|---|
| Klucze i18n używane vs zadeklarowane | skrypt parsujący oba słowniki przez liczenie nawiasów | 755 = 755, zero braków |
| Martwe przyciski (`onclick` bez funkcji) | skrypt na zbudowanych wariantach | 176 / 189 / 172 uchwytów, wszystkie istnieją |
| Zgodność wariantów ze źródłem | `narzedzia/sprawdz_zrodlo.py` | 68 kontroli, zero niezgodności |
| Logika serwera | `serwer/testy.js` | 214/214 |
| Składnia i pułapki JS | ESLint 9 na wyciętych skryptach | zero błędów |
| Przewijanie i cele dotykowe | Playwright, 360×740, tryb dotykowy | patrz niżej |
| Kontrast WCAG AA | Playwright, pomiar w obu motywach | patrz niżej |
| Obsługa klawiatury | Playwright, Escape i widoczność fokusu | patrz niżej |
| Prawdziwe klucze w repo | `grep` wzorcami dostawców | czysto |

---

## Znalezione usterki

### 1. Ekran wyczerpanego limitu pokazywał surowe słowo

**Klasa:** cicha degradacja i18n. **Waga:** drobna, ale widoczna dla płacącego użytkownika.

Klucz tłumaczenia składany jest w kodzie: `'pakiet-' + czynnosc`. Dla sufitu wywołań serwer
przysyła `czynnosc: 'wywolanie'`, a klucza `pakiet-wywolanie` nie było — istniał tylko
`pakiet-wywolania` (liczba mnoga, używana w liście zużycia).

Skutkiem był ekran limitu z surowym, małą literą napisanym słowem „wywolanie" — w obu
językach. Nie wywala niczego, więc nie zgłosiłoby się samo.

**Naprawione:** klucz dodany w obu słownikach. Automatyczna kontrola i18n wypisuje teraz
prefiksy składane w kodzie (`pakiet-`, `pakiet-fn-`) do ręcznego przejrzenia — bo tej
klasy błędu nie da się wykryć samym parsowaniem.

### 2. Escape nie zamykał trzech nowych okien

**Klasa:** regresja spójności. **Waga:** drobna.

Obsługa klawisza Escape to jedna długa linia wymieniająca każdą funkcję zamykającą
z osobna. Trzy okna dodane w ostatnich zmianach — podpowiedzi tematów, okno pakietu
i kreator — nie zostały do niej dopisane. Reszta aplikacji zamyka się Escape'em,
więc niespójność byłaby odczuwalna.

**Naprawione:** wszystkie trzy dopisane, dwa ostatnie z osłoną `typeof`, bo istnieją
tylko w wariancie `proxy`.

> **To miejsce będzie się psuć dalej.** Każde nowe okno wymaga ręcznego dopisania do tej
> listy i nic o tym nie przypomina. Przy następnej większej zmianie w tym obszarze warto
> zamienić to na wspólny mechanizm — np. atrybut `data-zamykalne` i jedną pętlę.

### 3. Tekst pomocniczy poniżej progu czytelności WCAG

**Klasa:** dostępność. **Waga:** średnia — dotyczyła **każdej etykiety pola** w aplikacji.

Zmienna `--text3` daje kolor wszystkim etykietom, podpowiedziom i opisom. Zmierzony
kontrast wynosił **3,13:1** przy wymaganych 4,5:1 dla tekstu poniżej 18,66 px — a etykiety
pól mają 11 px. Dotyczyło to obu motywów.

Pierwsza poprawka była **niewystarczająca**: dobrałem wartość względem bieli, a realne tło
strony to `#EEF1F6`, co dawało 4,45:1 — wciąż pod progiem. Wykrył to dopiero powtórny
pomiar.

**Naprawione:** `--text3` to teraz `#616A7E` (jasny) i `#868FAB` (ciemny). Ten sam odcień,
tylko tyle ciemniejszy i jaśniejszy, żeby przejść próg. Pomiar po poprawce:

| Motyw | Najgorsza etykieta przed | Po |
|---|---|---|
| jasny | 3,13:1 | **5,42:1** |
| ciemny | 3,13:1 | **5,76:1** |

### 4. Przycisk zamykania okna węższy niż wymagane minimum

**Klasa:** dostępność dotykowa. **Waga:** drobna.

`.modal-close` miał 21 px szerokości przy 24 px wymaganych przez WCAG 2.5.8 (poziom AA).

**Naprawione:** dodany `padding: 2px 8px` z kompensującym ujemnym marginesem — obszar
kliknięcia rośnie, układ nie drgnął.

### 5–7. Dokumentacja rozjechana z kodem

| Co | Było | Jest |
|---|---|---|
| Rozmiar i objętość źródła | „~666 KB, ~10,5 tys. linii" | ~664 KB, 11,9 tys. linii |
| Liczba bloków warunkowych | „22 takich bloków" | 25, z wymienieniem nowych |
| Lista funkcji wdrożenia serwerowego | bez pakietów i kreatora | uzupełniona |

---

## Czego audyt **nie** wykrył, a co warto wiedzieć

**Cele dotykowe w pasku górnym.** Odznaka pakietu ma 28 px wysokości, tyle samo co
przełącznik języka obok. To spełnia minimum WCAG 2.5.8 (24 px), ale jest poniżej
zalecanych przez Apple 44 px. Świadomie zostawione — podniesienie tylko odznaki
rozjechałoby ją z sąsiadem, a przebudowa całego paska to zmiana projektowa, nie poprawka
audytowa.

**Dwa trafienia kontrastu to artefakty pomiaru**, nie usterki: przycisk generowania ma tło
z gradientu (`background-image`), którego mój pomiar nie widzi i schodzi na tło rodzica,
a plakietka „SYSTEM READY" jest dekoracyjna i oznaczona `aria-hidden`.

**Wykrywanie motywu w moim narzędziu było początkowo błędne** — aplikacja oznacza tryb
ciemny klasą `dark-mode` na `<body>`, a nie `dark`, przez co pierwsze przebiegi zamieniły
motywy miejscami. Wynik merytoryczny się nie zmienił (obie wartości były pod progiem),
ale to przypomnienie, żeby nie ufać jednemu przebiegowi narzędzia napisanego ad hoc.

---

## Czego nadal nie ma

Poniższe **nie są usterkami** — to świadomie odłożony zakres:

| Brak | Konsekwencja | Kiedy potrzebne |
|---|---|---|
| Samodzielna rejestracja | konta zakłada admin poleceniem | przed sprzedażą |
| Płatności | pakiet nadaje admin | przed sprzedażą |
| Reset hasła przez e-mail | hasło zmienia admin | przy pierwszym użytkowniku spoza zespołu |
| 2FA we własnym logowaniu | drugi składnik daje dopiero brama | przy publicznym wystawieniu |
| Regulamin i polityka prywatności | — | przed sprzedażą |

---

## Ocena gotowości

**Do testów na własnym serwerze: gotowe.** Wszystko, co miało działać, działa i jest
sprawdzone na uruchomionej aplikacji, nie tylko przeczytane w kodzie.

**Do sprzedaży: brakuje warstwy handlowej** — rejestracji, płatności i dokumentów
prawnych. To nie jest kwestia jakości kodu, tylko niezbudowanego jeszcze zakresu.

Największym ryzykiem technicznym pozostaje **jeden plik HTML o 11,9 tys. linii**. Nie
przeszkadza w działaniu i nie jest powodem, żeby wstrzymywać wdrożenie, ale każda kolejna
funkcja jest w nim trudniejsza do dołożenia niż poprzednia. Rekomendacja bez zmian:
podział przez `@@INCLUDE` w istniejącym preprocesorze, **po** weekendzie testów, nie przed.
