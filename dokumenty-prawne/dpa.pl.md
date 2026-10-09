---
tytul: Umowa powierzenia przetwarzania danych osobowych
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
Załącznik 1 do Regulaminu (art. 28 ust. 3 RODO). Źródło: szkic roli prawo (umowa-powierzenia-pl.md, PR8-30).
Załącznik A wstawia serwer z szablonu podprzetwarzajacy.pl.md (jedno źródło, osobna wersja listy).
Załącznik B: stan po rundzie 9, do potwierdzenia przez it-bezpieczenstwo. DO PRZEGLĄDU PRZEZ PRAWNIKA.
-->

Umowa jest zawierana z chwilą akceptacji [Regulaminu]({{URL_REGULAMIN}}) przez Użytkownika, który wprowadza do Serwisu dane osobowe jako administrator (na przykład agencja albo firma).

## § 1. Strony i przedmiot

1. Administrator: Użytkownik Serwisu Content AI, który akceptuje Regulamin (dalej: Administrator).
2. Podmiot przetwarzający: WSTAW_TUTAJ_IMIE_I_NAZWISKO, adres: WSTAW_TUTAJ_ADRES, e-mail: WSTAW_TUTAJ_EMAIL (dalej: Przetwarzający).
3. Administrator powierza Przetwarzającemu przetwarzanie danych osobowych zawartych w treściach, które Administrator wprowadza do Serwisu, w zakresie i celu określonym w § 2.

## § 2. Charakter, cel, zakres i czas przetwarzania

1. Cel: świadczenie usług Serwisu zgodnie z Regulaminem: przechowywanie dokumentów Bazy wiedzy, wyszukiwanie w nich, przekazywanie treści do Dostawców AI w celu wygenerowania wyników na polecenie Administratora, transkrypcja nagrań, publikacja do wskazanych przez Administratora systemów CMS.
2. Charakter: przechowywanie, porządkowanie, wyszukiwanie, przesyłanie, usuwanie; operacje zautomatyzowane.
3. Rodzaje danych: dane zawarte w dokumentach, briefach, tematach i nagraniach Administratora, w szczególności imiona i nazwiska, dane kontaktowe, stanowiska, wypowiedzi, głos (nagrania). Administrator nie wprowadza danych szczególnych kategorii ani danych dotyczących wyroków skazujących, chyba że ma do tego podstawę prawną i uprzedzi Przetwarzającego.
4. Kategorie osób: pracownicy, współpracownicy, klienci i kontrahenci Administratora, osoby wymienione w dokumentach Administratora.
5. Czas: przez okres korzystania z Serwisu, do usunięcia danych przez Administratora albo usunięcia Konta.

## § 3. Obowiązki Przetwarzającego

Przetwarzający:

1. przetwarza dane wyłącznie na udokumentowane polecenie Administratora; poleceniem jest korzystanie z funkcji Serwisu zgodnie z Regulaminem, w tym polecenie przekazania danych do państwa trzeciego w zakresie wskazanym w Załączniku A. Jeżeli prawo nakłada na Przetwarzającego obowiązek przetwarzania, informuje o tym Administratora przed rozpoczęciem przetwarzania, chyba że prawo tego zabrania;
2. zapewnia, że osoby upoważnione do przetwarzania zobowiązały się do zachowania tajemnicy;
3. stosuje środki bezpieczeństwa z art. 32 RODO opisane w Załączniku B;
4. korzysta z dalszych podmiotów przetwarzających na zasadach z § 4;
5. pomaga Administratorowi, w miarę możliwości, w odpowiadaniu na żądania osób, których dane dotyczą (dostęp, sprostowanie, usunięcie, ograniczenie, przeniesienie, sprzeciw); Serwis umożliwia samodzielne usunięcie dokumentów Bazy wiedzy, pobranie danych Konta i usunięcie Konta;
6. pomaga Administratorowi w wywiązaniu się z obowiązków z art. 32-36 RODO, uwzględniając charakter przetwarzania i dostępne informacje;
7. zgłasza Administratorowi naruszenie ochrony danych osobowych bez zbędnej zwłoki, nie później niż w ciągu 48 godzin od jego stwierdzenia, z informacjami z art. 33 ust. 3 RODO, jakie są wtedy dostępne;
8. po zakończeniu świadczenia usług usuwa dane (Administrator może je wcześniej pobrać), chyba że prawo nakazuje ich przechowywanie; dane w kopiach zapasowych są usuwane w cyklu ich nadpisywania, najpóźniej po 30 dniach;
9. udostępnia Administratorowi informacje potrzebne do wykazania zgodności z art. 28 RODO i umożliwia audyty (w pierwszej kolejności w formie pisemnych wyjaśnień; audyt na miejscu po uzgodnieniu terminu z co najmniej 14-dniowym wyprzedzeniem, na koszt Administratora, bez dostępu do danych innych użytkowników);
10. niezwłocznie informuje Administratora, jeżeli jego zdaniem polecenie narusza RODO lub inne przepisy o ochronie danych.

## § 4. Dalsze podmioty przetwarzające

1. Administrator udziela ogólnej zgody na korzystanie z dalszych podmiotów przetwarzających wymienionych w Załączniku A ([lista w wersji {{WERSJA_PODPRZETWARZAJACY}}]({{URL_PODPRZETWARZAJACY}})).
2. Przetwarzający informuje Administratora e-mailem o zamiarze dodania lub zmiany dalszego podmiotu co najmniej 14 dni wcześniej. Administrator może w tym czasie zgłosić uzasadniony sprzeciw; jeżeli strony nie znajdą rozwiązania, Administrator może wypowiedzieć umowę o świadczenie usług ze skutkiem natychmiastowym, a Przetwarzający zwraca część ceny za niewykorzystany okres.
3. Przetwarzający nakłada na dalsze podmioty obowiązki ochrony danych nie mniejsze niż w tej umowie i odpowiada za ich działania jak za własne.
4. **Klucze API Administratora.** Gdy Administrator korzysta w Serwisie z własnego klucza API dostawcy AI (Anthropic, OpenAI, ElevenLabs), dostawca przetwarza dane na podstawie umowy zawartej bezpośrednio z Administratorem (warunki i umowa powierzenia tego dostawcy). W takim przypadku dostawca nie jest dalszym podmiotem przetwarzającym Przetwarzającego, a Przetwarzający jedynie przekazuje zapytanie Administratora do tego dostawcy, nie zapisując klucza ani treści.

<!-- PRAWNIK P-08: potwierdzić kwalifikację z ust. 4. -->

## § 5. Przekazywanie danych poza EOG

Przekazanie danych do państwa trzeciego następuje wyłącznie do podmiotów z Załącznika A, na podstawie decyzji Komisji stwierdzającej odpowiedni stopień ochrony (w tym EU-U.S. Data Privacy Framework dla podmiotów certyfikowanych) albo standardowych klauzul umownych (decyzja wykonawcza Komisji (UE) 2021/914), zawartych przez Przetwarzającego lub przez dalszy podmiot.

## § 6. Odpowiedzialność i postanowienia końcowe

1. Odpowiedzialność stron określa art. 82 RODO, a w pozostałym zakresie Regulamin.
2. Umowa obowiązuje przez czas świadczenia usług i wygasa wraz z umową o prowadzenie Konta, z zastrzeżeniem obowiązków z § 3 pkt 8.
3. W sprawach nieuregulowanych stosuje się RODO i prawo polskie. W razie sprzeczności z Regulaminem w sprawach ochrony danych pierwszeństwo ma ta umowa.

## Załącznik A. Dalsze podmioty przetwarzające {#zalacznik-a}

{{ZALACZNIK_PODPRZETWARZAJACY}}

## Załącznik B. Środki techniczne i organizacyjne {#zalacznik-b}

1. Szyfrowanie transmisji: HTTPS (TLS) z nagłówkiem HSTS; połączenia z dostawcami AI, Stripe i Resend wyłącznie po HTTPS.
2. Uwierzytelnianie: hasła haszowane algorytmem scrypt z losową solą i porównaniem odpornym na pomiar czasu; limity nieudanych prób logowania; sesja w podpisanym pliku cookie HttpOnly, Secure, SameSite=Lax; unieważnianie sesji przy zmianie hasła, wylogowaniu na wszystkich urządzeniach i usunięciu Konta.
3. Klucze API Użytkownika: wyłącznie w zaszyfrowanych plikach cookie przeglądarki (AES-256-GCM, powiązanie z Kontem), niedostępnych dla skryptów strony; serwer odszyfrowuje klucz tylko na czas zapytania i nie zapisuje go na dysku ani w dziennikach.
4. Ochrona aplikacji: polityka bezpieczeństwa treści (CSP) z zakazem osadzania w ramkach, nagłówki nosniff i Referrer-Policy, kontrola pochodzenia żądań (CSRF), kontrola adresów przy pobieraniu stron (ochrona przed odwołaniami do sieci wewnętrznej).
5. Rozdzielenie danych: każde Konto założone samodzielnie ma własną przestrzeń z własną Bazą wiedzy i danymi firmy, niewidoczną dla innych Kont; dane w przeglądarce są oddzielone dla każdego Konta.
6. Minimalizacja: serwer nie zapisuje na dysku wygenerowanych treści; wyniki zadań są w pamięci najwyżej 15 minut; dziennik techniczny nie zawiera adresów IP zwykłych zapytań i jest przechowywany 30 dni.
7. Integralność i dostępność: baza danych z zapisem transakcyjnym, pliki danych dostępne wyłącznie dla konta systemowego usługi; automatyczne kopie zapasowe bazy, przechowywane nie dłużej niż 30 dni.
8. Dostęp administracyjny: wyłącznie Przetwarzający, przez sieć prywatną (VPN) i konto systemowe usługi z ograniczonymi uprawnieniami.
9. Płatności: dane kart przetwarza wyłącznie Stripe; strony Serwisu nie ładują skryptów Stripe.
10. Poczta: wiadomości bez pikseli śledzących i bez przekierowań śledzących kliknięcia; odnośniki z jednorazowymi tokenami nie trafiają do dzienników.
11. Procedury: Przetwarzający prowadzi rejestr kategorii czynności przetwarzania (art. 30 ust. 2 RODO) i rejestr naruszeń ochrony danych.

<!-- it-bezpieczenstwo: potwierdzić punkty 2-8 po scaleniu rundy 9 (SEC8-04, ARCH8-02, ARCH8-25, CAI_KOPIE). -->
