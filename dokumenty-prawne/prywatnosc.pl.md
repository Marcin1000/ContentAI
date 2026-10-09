---
tytul: Polityka prywatności Content AI
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
Szablon renderuje serwer aplikacji pod /dokumenty/prywatnosc. Źródło: szkic roli prawo z rundy 8
(polityka-prywatnosci-pl.md), zmiany z rundy 9: klucze API w zaszyfrowanych ciasteczkach (SEC8-04, decyzja M-10),
konto samoobsługowe, Stripe, Resend, okresy z decyzji D-14, konfiguracja produkcji z DECYZJE-R9 (bez NVIDIA,
DataForSEO i klucza ElevenLabs po stronie serwera). Bloki w podwójnych nawiasach z pytajnikiem pokazują się tylko,
gdy dana usługa jest włączona w konfiguracji serwera (NVIDIA_KEY, DATAFORSEO_LOGIN, ELEVEN_KEY).
DO PRZEGLĄDU PRZEZ PRAWNIKA. Ta sama wersja musi być w CAI_POLITYKA_WERSJA.
-->

Krótko i rzeczowo: co zbieramy, po co, jak długo to trzymamy i komu przekazujemy. Polityka dotyczy strony content-ai.net, aplikacji app.content-ai.net, płatności i wiadomości e-mail.

## 01. Kto odpowiada za dane

Administratorem danych osobowych jest WSTAW_TUTAJ_IMIE_I_NAZWISKO, adres: WSTAW_TUTAJ_ADRES, który prowadzi serwis Content AI jako osoba fizyczna (dalej: „my”). W sprawach danych osobowych pisz na WSTAW_TUTAJ_EMAIL. Nie wyznaczyliśmy inspektora ochrony danych, bo nie mamy takiego obowiązku.

## 02. Jakie dane zbieramy

**Strona content-ai.net.** Strona nie ładuje skryptów, fontów ani analityki z obcych serwerów i nie ustawia ciasteczek. Zapamiętuje tylko wybór motywu jasnego lub ciemnego, w Twojej przeglądarce. Stronę dostarcza sieć Cloudflare, która przetwarza przy tym techniczne dane połączenia, takie jak adres IP.

**Konto.** Adres e-mail i informacja, czy został potwierdzony, skrót hasła (samego hasła nie przechowujemy; skrót jest liczony algorytmem scrypt z losową solą), data założenia konta, język interfejsu, wybrany pakiet i jego stan, liczniki użycia pakietu, zapis akceptacji regulaminu i polityki prywatności oraz oświadczeń złożonych przy zakupie (z datą i wersją dokumentu), identyfikator klienta i subskrypcji w systemie płatności Stripe. Jeśli wpiszesz dane firmy (nazwa, opis, domeny, głos marki), też je przechowujemy.

**Baza wiedzy.** Dokumenty, które dodasz do bazy wiedzy na serwerze, ich nazwy i fragmenty tekstu. Wyszukujemy w nich po słowach kluczowych.
{{?nvidia}}
Dla kont zespołu, które założyliśmy przed udostępnieniem samodzielnej rejestracji, liczymy też wektory fragmentów (liczbowy opis treści, potrzebny do wyszukiwania po znaczeniu).
{{/nvidia}}

**Treści, nad którymi pracujesz.** Gotowych tekstów i ich historii serwer nie zapisuje na dysku: zostają w Twojej przeglądarce. Wynik każdego zadania (np. artykuł, grafika, nagranie) serwer trzyma w pamięci do 15 minut, żeby oddać go po zerwanym połączeniu, a potem go usuwa.

**Klucze API.** Twoje klucze do dostawców AI trzyma tylko Twoja przeglądarka, w zaszyfrowanym ciasteczku, którego nie odczyta żaden skrypt na stronie. Przy każdym zapytaniu przeglądarka wysyła je do naszego serwera, a serwer odszyfrowuje klucz tylko na czas zapytania i przekazuje go dostawcy. Klucza nie zapisujemy na dysku i nie umieszczamy w dziennikach.

**Płatności.** Dane karty podajesz bezpośrednio w formularzu Stripe; nie mamy do nich dostępu. Od Stripe otrzymujemy: imię i nazwisko lub nazwę, adres e-mail, kraj i adres rozliczeniowy, kwotę, walutę, datę i stan płatności oraz informacje o zwrotach.

**Wiadomości e-mail.** Na Twój adres wysyłamy wiadomości związane z kontem i zamówieniem, na przykład potwierdzenie adresu, link do zmiany hasła i potwierdzenie zawarcia umowy. Nie wysyłamy newslettera.

**Korespondencja i zgłoszenia.** Treść wiadomości do nas, reklamacje, oświadczenia o odstąpieniu od umowy, zgłoszenia nielegalnych treści.

**Dane techniczne.** Techniczny dziennik serwera nie zawiera adresów IP zwykłych zapytań ani kluczy API, ale może zawierać na przykład frazy z analizy SERP i komunikaty o błędach. W wyjątkowych sytuacjach związanych z ochroną przed nadużyciami może zawierać fragment adresu sieci. Do ochrony logowania i rejestracji serwer liczy próby z danego adresu IP i blokuje je czasowo po przekroczeniu limitu.

**Prośby o dostęp wysłane dawnym formularzem.** Jeśli przed udostępnieniem samodzielnej rejestracji wysłałeś prośbę o dostęp przez formularz na stronie, przechowujemy: imię, adres e-mail, opcjonalnie nazwę firmy lub zespołu, wybrany pakiet, opcjonalną wiadomość, język strony, informację o zgodzie na kontakt oraz datę wysłania, adres IP i domenę strony, z której ją wysłano.

## 03. Po co i na jakiej podstawie

| Cel | Podstawa prawna (RODO) |
|---|---|
| Założenie i prowadzenie konta, działanie aplikacji, baza wiedzy, generowanie treści na Twoje polecenie, wiadomości e-mail związane z kontem i zamówieniem | wykonanie umowy, art. 6 ust. 1 lit. b |
| Płatności, potwierdzenia, rachunki, ewidencja sprzedaży, obsługa odstąpienia od umowy i reklamacji | obowiązki prawne (przepisy podatkowe i konsumenckie), art. 6 ust. 1 lit. c, oraz wykonanie umowy |
| Bezpieczeństwo serwisu, ochrona przed nadużyciami (limity logowania i rejestracji), dziennik techniczny | nasz prawnie uzasadniony interes, art. 6 ust. 1 lit. f |
| Ustalenie, dochodzenie i obrona roszczeń (np. zapis akceptacji regulaminu i oświadczeń przy zakupie) | nasz prawnie uzasadniony interes, art. 6 ust. 1 lit. f |
| Rozpatrywanie zgłoszeń nielegalnych treści (akt o usługach cyfrowych) | obowiązek prawny, art. 6 ust. 1 lit. c |
| Odpowiedź na prośbę o dostęp wysłaną dawnym formularzem | działania na Twoje żądanie przed zawarciem umowy, art. 6 ust. 1 lit. b |

Nie przekazujemy danych do celów reklamowych. Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywoływałyby skutki prawne, i nie profilujemy Cię. Limity pakietu są liczone automatycznie według cennika, który akceptujesz.

Podanie adresu e-mail i hasła jest potrzebne do założenia konta, a danych płatności do zakupu pakietu; bez nich nie możemy zawrzeć umowy.

## 04. Jak długo

| Dane | Okres |
|---|---|
| Dane konta | do usunięcia konta |
| Zapis akceptacji regulaminu i oświadczeń przy zakupie | do upływu terminu przedawnienia roszczeń |
| Dokumenty bazy wiedzy | do ich usunięcia przez Ciebie albo do usunięcia konta |
| Liczniki użycia pakietu | okresy miesięczne starsze niż rok są usuwane automatycznie |
| Wynik zadania w pamięci serwera | do 15 minut |
| Dane płatności i dokumenty sprzedaży | 5 lat od końca roku podatkowego, w którym nastąpiła płatność |
| Dziennik techniczny serwera | 30 dni |
| Kopie zapasowe serwera | mogą zawierać usunięte dane jeszcze przez 30 dni, potem są nadpisywane |
| Prośby o dostęp wysłane dawnym formularzem | do około 365 dni od wysłania, potem są usuwane automatycznie |

<!-- D-14 (DECYZJE-R9): dziennik 30 dni, kopie 30 dni, zgody do przedawnienia. PRAWNIK P-07: konkretny okres dla zgód.
KSIĘGOWA K-06: okres przechowywania dokumentów sprzedaży. -->

## 05. Komu przekazujemy dane

Dostęp do danych mamy my oraz firmy, które pomagają nam świadczyć usługę. Aktualna, wersjonowana lista tych firm jest na stronie [Lista dalszych podmiotów przetwarzających]({{URL_PODPRZETWARZAJACY}}).

| Odbiorca | Do czego | Gdzie |
|---|---|---|
| Hetzner Online GmbH | serwer, na którym działa aplikacja i przechowywane są dane konta i baza wiedzy | Niemcy |
| Cloudflare, Inc. | dostarczanie strony content-ai.net i obsługa nazw domen | USA i sieć globalna |
| Stripe Payments Europe, Limited | obsługa płatności; w zakresie zapobiegania oszustwom i zgodności z prawem Stripe działa jako odrębny administrator | Irlandia, USA |
| Resend, Inc. | wysyłka wiadomości e-mail związanych z kontem i zamówieniem | USA |
| Anthropic Ireland, Limited | generowanie tekstu: na Twoim kluczu API albo, dla kont zespołu założonych przez nas, na naszym kluczu | Irlandia, USA |
| OpenAI Ireland Ltd | grafiki, synteza mowy, transkrypcja: na Twoim kluczu API albo, dla kont zespołu założonych przez nas, na naszym kluczu | Irlandia, USA |
| ElevenLabs | synteza mowy, tylko na Twoim kluczu API | według warunków ElevenLabs |
{{?nvidia}}
| NVIDIA Corporation | obliczanie wektorów fragmentów dokumentów bazy wiedzy i zapytań do niej, tylko dla kont zespołu założonych przez nas | USA |
{{/nvidia}}
{{?dataforseo}}
| DataForSEO | wyniki wyszukiwania Google dla wpisanej frazy (przekazujemy tylko frazę) | {{DO_UZUPELNIENIA: siedziba DataForSEO}} |
{{/dataforseo}}

Treści potrzebne do danego zadania (na przykład temat, brief, pasujące fragmenty bazy wiedzy, tekst do odczytania albo nagranie do transkrypcji) serwer przekazuje dostawcy modeli AI. Gdy używasz własnego klucza API, odbywa się to na Twoim koncie u dostawcy i na warunkach Twojej umowy z nim; nasz serwer tylko przekazuje zapytanie. Dostawcy AI, z których korzystamy, zobowiązują się w warunkach dla API, że nie trenują modeli na przesłanych treściach (u OpenAI: domyślnie), i mogą je przechowywać przez krótki czas w celu wykrywania nadużyć (np. OpenAI do 30 dni).

Dane możemy też przekazać organom publicznym, gdy wymagają tego przepisy.

**Dyktowanie w przeglądarce.** Jeśli wybierzesz dyktowanie wbudowane w przeglądarkę, rozpoznawanie mowy wykonuje przeglądarka i jej producent (na przykład w Chrome nagranie może trafiać do serwerów Google), a nie nasz serwer.

## 06. Przekazywanie danych poza Europejski Obszar Gospodarczy

Część firm z punktu 05 działa poza Europejskim Obszarem Gospodarczym albo korzysta z podwykonawców spoza niego. Dane trafiają do nich z zabezpieczeniami przewidzianymi w RODO: na podstawie decyzji Komisji Europejskiej stwierdzającej odpowiedni poziom ochrony dla firm z USA uczestniczących w programie EU-U.S. Data Privacy Framework albo na podstawie standardowych klauzul umownych przyjętych przez Komisję. Kopię zabezpieczeń możesz otrzymać, pisząc do nas.

## 07. Ciasteczka i pamięć przeglądarki

Sama strona content-ai.net nie ustawia ciasteczek; zapamiętuje tylko wybór motywu, w Twojej przeglądarce.

Aplikacja app.content-ai.net ustawia:

| Ciasteczko | Do czego | Jak długo |
|---|---|---|
| cai_auth | sesja logowania | do wylogowania, najdłużej 14 dni |
| cai_motyw | wybrany motyw jasny albo ciemny, ustawiany po zmianie motywu | rok |
| __Secure-cai_k_a, __Secure-cai_k_o, __Secure-cai_k_e | zaszyfrowane klucze API Anthropic, OpenAI i ElevenLabs, przypisane do Twojego konta | z opcją „Zapamiętaj na tym urządzeniu” 30 dni, bez niej do zamknięcia przeglądarki |

Ciasteczek z kluczami nie odczyta żaden skrypt na stronie ani inne konto. Zapamiętany klucz zostaje w przeglądarce także po zwykłym wylogowaniu; usuwa go przycisk „Usuń klucz”, wylogowanie na wszystkich urządzeniach, zmiana i reset hasła oraz usunięcie konta.

Historię tekstów, szkic, ustawienia i dane dostępu do WordPressa lub Drupala aplikacja trzyma w pamięci Twojej przeglądarki, osobno dla każdego konta. Możesz je usunąć, czyszcząc dane przeglądarki dla app.content-ai.net.

Płatność odbywa się na stronie Stripe (checkout.stripe.com), która stosuje własne ciasteczka, opisane w polityce prywatności Stripe. Na stronach Content AI nie ładujemy skryptów Stripe.

Wszystkie te ciasteczka i zapisy są niezbędne do działania funkcji, o które prosisz, dlatego nie pytamy o zgodę. Nie używamy ciasteczek analitycznych ani reklamowych. Wiadomości e-mail od nas nie zawierają pikseli śledzących otwarcia ani przekierowań śledzących kliknięcia.

## 08. Sztuczna inteligencja i Twoje treści

- Content AI wspiera wymogi przejrzystości z art. 50 rozporządzenia (UE) 2024/1689 (AI Act): pliki i treści wygenerowane w aplikacji oznaczamy w formacie maszynowym tam, gdzie pozwala na to format. Oznaczenia te nie zawierają Twoich danych osobowych. Dostawcy AI mogą dodawać własne niewidoczne znaki wodne; według ich informacji nie zawierają one danych o użytkowniku. Szczegóły: strona „AI Act i przejrzystość” ({{URL_AI_ACT}}).
- Przed dodaniem dokumentu do bazy wiedzy sprawdź, czy nie zawiera danych osobowych pracowników ani klientów, których nie potrzebujesz. Jeżeli wprowadzasz dane osobowe, za które odpowiadasz, przetwarzamy je w Twoim imieniu na podstawie [umowy powierzenia]({{URL_DPA}}) (załącznik do regulaminu).

## 09. Twoje prawa

Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i przeniesienia oraz prawo sprzeciwu wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie. Zgodę, jeśli jej udzieliłeś, możesz w każdej chwili cofnąć bez wpływu na wcześniejsze przetwarzanie. Odpowiadamy w ciągu miesiąca.

Dane konta pobierzesz, a konto usuniesz w ustawieniach konta w aplikacji. W innych sprawach pisz na WSTAW_TUTAJ_EMAIL.

Możesz też złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, https://uodo.gov.pl).

## 10. Zmiany polityki

O istotnych zmianach tej polityki poinformujemy e-mailem i w aplikacji. Każda wersja ma numer i datę podane na górze strony; poprzednie wersje udostępniamy na żądanie.
