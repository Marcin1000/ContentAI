---
tytul: Regulamin serwisu Content AI
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
Szablon renderuje serwer aplikacji pod /dokumenty/regulamin (serwer/dokumenty-prawne.js).
Dane usługodawcy (WSTAW_TUTAJ_IMIE_I_NAZWISKO, WSTAW_TUTAJ_ADRES, WSTAW_TUTAJ_TELEFON, WSTAW_TUTAJ_EMAIL,
WSTAW_TUTAJ_WWW) wstawia serwer ze zmiennych CAI_USLUGODAWCA_*; w repozytorium zostają tylko te znaczniki.
Pola w podwójnych nawiasach klamrowych wypełnia serwer (adresy dokumentów, limit z serwer/plany.js).
Źródło: szkic roli prawo z rundy 8 (RAPORT-prawo.md, PR8-03, PR8-11, PR8-31). DO PRZEGLĄDU PRZEZ PRAWNIKA.
Zmiana treści = nowa wersja i data w nagłówku, ta sama w regulamin.en.md, i ta sama wersja w CAI_REGULAMIN_WERSJA
(zgody przy rejestracji zapisują wersję z konfiguracji).
-->

## § 1. Postanowienia ogólne

1. Regulamin określa zasady korzystania z serwisu Content AI dostępnego pod adresami content-ai.net i app.content-ai.net (dalej: Serwis). Jest regulaminem świadczenia usług drogą elektroniczną.
2. Usługodawcą jest WSTAW_TUTAJ_IMIE_I_NAZWISKO, adres: WSTAW_TUTAJ_ADRES, e-mail: WSTAW_TUTAJ_EMAIL, telefon: WSTAW_TUTAJ_TELEFON (dalej: Usługodawca).
3. Usługodawca jest osobą fizyczną. Prowadzi sprzedaż w ramach działalności, która nie wymaga wpisu do Centralnej Ewidencji i Informacji o Działalności Gospodarczej (art. 5 ust. 1 ustawy Prawo przedsiębiorców), i korzysta ze zwolnienia z podatku VAT.
4. Z Usługodawcą można się kontaktować e-mailem (WSTAW_TUTAJ_EMAIL), telefonicznie (WSTAW_TUTAJ_TELEFON) i listownie (WSTAW_TUTAJ_ADRES). Wszystkie dane Usługodawcy są na stronie [Dane usługodawcy]({{URL_USLUGODAWCA}}).
5. Regulamin jest udostępniony nieodpłatnie przed zawarciem umowy pod adresem {{URL_REGULAMIN}}. Można go pobrać jako plik tekstowy, zapisać jako PDF poleceniem drukowania w przeglądarce i wydrukować.

<!--
PRAWNIK P-02: czy adres może być adresem do doręczeń innym niż adres zamieszkania (ustawa o świadczeniu usług drogą
elektroniczną: "miejsce zamieszkania i adres"; ustawa o prawach konsumenta: "adres przedsiębiorstwa").
KSIĘGOWA K-13: brzmienie informacji o zwolnieniu z VAT. Po rejestracji działalności: firma, NIP, REGON.
-->

## § 2. Definicje

1. **Aplikacja**: aplikacja internetowa Content AI pod adresem app.content-ai.net.
2. **Konto**: indywidualne konto Użytkownika w Aplikacji.
3. **Użytkownik**: osoba fizyczna, która ukończyła 18 lat, osoba prawna albo jednostka organizacyjna, która zawarła z Usługodawcą umowę o prowadzenie Konta.
4. **Konsument**: Użytkownik będący osobą fizyczną, który zawiera umowę niezwiązaną bezpośrednio z jego działalnością gospodarczą lub zawodową.
5. **Przedsiębiorca na prawach konsumenta**: osoba fizyczna zawierająca umowę bezpośrednio związaną z jej działalnością gospodarczą, gdy umowa nie ma dla niej charakteru zawodowego. Przysługują jej prawa opisane w § 9 i § 11 na zasadach przewidzianych dla Konsumenta.
6. **Pakiet**: zakres funkcji i limitów Aplikacji opisany w Cenniku ({{URL_CENNIK}}): Darmowy, Standard i Premium.
7. **Subskrypcja**: odpłatna umowa o dostęp do Pakietu Standard albo Premium, zawierana na miesięczne okresy rozliczeniowe odnawiane automatycznie.
8. **Dostawca AI**: zewnętrzny dostawca modeli sztucznej inteligencji: Anthropic (tekst), OpenAI (grafika, mowa, transkrypcja) i ElevenLabs (mowa).
9. **Klucz API**: indywidualny klucz dostępu Użytkownika do usług Dostawcy AI.
10. **Treści Użytkownika**: dane, teksty, dokumenty, nagrania i ustawienia wprowadzone przez Użytkownika.
11. **Wyniki**: teksty, grafiki, nagrania i inne treści wygenerowane w Aplikacji z użyciem sztucznej inteligencji.
12. **Baza wiedzy**: funkcja przechowywania dokumentów Użytkownika na serwerze Usługodawcy w celu wykorzystania ich przy generowaniu Wyników.

## § 3. Rodzaje i zakres usług

1. Usługodawca świadczy drogą elektroniczną usługi: (a) prowadzenia Konta, (b) udostępniania Aplikacji do tworzenia, oceny, edycji, eksportu i publikacji treści (artykuły, oceny SEO, AIO, AEO i GEO, kontrola faktów i odnośników, grafiki, nagrania głosowe, transkrypcje, publikacja w systemach WordPress i Drupal), (c) Bazy wiedzy, (d) informacyjne na stronie content-ai.net.
2. Zakres funkcji i limity zależą od Pakietu i są opisane w Cenniku. Pakiet Darmowy obejmuje jednorazowo limit {{LIMIT_DARMOWY}} artykułów, nie wymaga podania danych karty i nie przechodzi automatycznie w Subskrypcję.
3. Do generowania treści na Koncie założonym samodzielnie potrzebny jest Klucz API Użytkownika: Anthropic do tekstu (wymagany), OpenAI do grafik, mowy i transkrypcji oraz ElevenLabs do mowy (opcjonalne). Opłaty za korzystanie z usług Dostawców AI Użytkownik ponosi bezpośrednio u nich, według ich cenników. Cena Subskrypcji nie obejmuje tych opłat.
4. Dostawcy AI stosują własne warunki i zasady dopuszczalnego użycia, które Użytkownik akceptuje samodzielnie, zakładając u nich konto. Warunki te mogą ograniczać przeznaczenie kluczy, na przykład do celów zawodowych. Użytkownik odpowiada za przestrzeganie warunków Dostawcy AI, z którym zawarł umowę.
5. Klucz API przechowuje wyłącznie przeglądarka Użytkownika, w zaszyfrowanym pliku cookie. Przy każdym zapytaniu przeglądarka przesyła go do serwera Usługodawcy, który odszyfrowuje Klucz API wyłącznie na czas wykonania zapytania, przekazuje go Dostawcy AI i nie zapisuje go.
6. Konta założone przez Usługodawcę przed udostępnieniem samodzielnej rejestracji działają na zasadach uzgodnionych indywidualnie, w tym z użyciem kluczy Usługodawcy, chyba że strony uzgodnią inaczej.
7. Wyniki powstają automatycznie i mogą zawierać błędy, nieaktualne lub nieścisłe informacje. Funkcje oceny i kontroli faktów mają charakter pomocniczy. Przed publikacją Użytkownik sam sprawdza Wyniki.

<!--
PRAWNIK D-01 / PR8-25: warunki komercyjne Anthropic mówią, że API nie jest przeznaczone do użytku konsumenckiego.
Decyzja koordynatora (DECYZJE-R9 D-01): sprzedaż wszystkim, z informacją z ust. 4.
-->

## § 4. Wymagania techniczne

1. Do korzystania z Aplikacji potrzebne są: urządzenie z dostępem do internetu, aktualna wersja przeglądarki Chrome, Edge, Firefox albo Safari z włączonym JavaScriptem, zapisem plików cookie i pamięci lokalnej, adres e-mail oraz Klucz API. Do dyktowania potrzebny jest mikrofon.
2. Historia Wyników, szkice i ustawienia są przechowywane w pamięci przeglądarki na urządzeniu Użytkownika, a Klucze API w zaszyfrowanych plikach cookie tej przeglądarki. Usługodawca nie ma dostępu do historii i szkiców i nie tworzy ich kopii. Wyczyszczenie danych przeglądarki albo zmiana urządzenia oznacza ich utratę, dlatego ważne Wyniki warto eksportować do plików.
3. Ryzyka związane z korzystaniem z usług drogą elektroniczną to m.in. przechwycenie danych logowania, złośliwe oprogramowanie na urządzeniu Użytkownika i phishing. Użytkownik chroni swoje hasło i Klucze API i nie korzysta z Aplikacji na niezaufanych urządzeniach.

## § 5. Ceny i płatności

1. Ceny Pakietów są podane w Cenniku i na ekranie zakupu jako ceny końcowe, w złotych albo w euro, zależnie od waluty wybranej przy zakupie. Usługodawca korzysta ze zwolnienia z VAT, więc cena nie zawiera tego podatku i jest kwotą do zapłaty.
2. Płatności obsługuje Stripe Payments Europe, Limited (Irlandia). Dostępne metody płatności są widoczne w formularzu płatności. Dane karty przetwarza wyłącznie Stripe.
3. Subskrypcja jest opłacana z góry za każdy miesięczny okres rozliczeniowy i odnawia się automatycznie, dopóki Użytkownik z niej nie zrezygnuje (§ 10). Opłata za kolejny okres jest pobierana w dniu jego rozpoczęcia.
4. Po każdej płatności Użytkownik otrzymuje od Stripe e-mailem potwierdzenie płatności. Na żądanie zgłoszone w ciągu 3 miesięcy od końca miesiąca, w którym wykonano usługę lub otrzymano zapłatę, Usługodawca wystawia rachunek.
5. Jeżeli płatność za kolejny okres się nie powiedzie, Użytkownik otrzymuje o tym wiadomość e-mail, a płatność jest ponawiana. Jeżeli płatność nie powiedzie się w ciągu {{ZALEGLA_DNI}} dni, dostęp do Pakietu płatnego zostaje wstrzymany, a Konto działa na zasadach Pakietu Darmowego (bez ponownego przyznania limitu darmowych artykułów) do czasu skutecznej płatności albo zakończenia Subskrypcji.
6. Niewykorzystane limity nie przechodzą na kolejny okres rozliczeniowy.
7. Przy każdej informacji o obniżce ceny Usługodawca podaje także najniższą cenę z 30 dni przed wprowadzeniem obniżki.
8. Subskrypcję mogą zamówić osoby, których adres rozliczeniowy znajduje się w państwie członkowskim Unii Europejskiej wskazanym w formularzu płatności.

<!--
KSIĘGOWA K-03: rachunek na żądanie, treść dokumentu. PR8-11: w tekstach Serwisu nie pada nazwa dokumentu sprzedaży
z VAT, tylko potwierdzenie płatności od Stripe i rachunek na żądanie.
D-04: lista państw w konfiguracji płatności (wykonawca B); ust. 8 musi się z nią zgadzać.
-->

## § 6. Zawarcie umowy

1. Umowa o prowadzenie Konta zostaje zawarta z chwilą założenia Konta, po akceptacji Regulaminu. Jest zawarta na czas nieokreślony.
2. Aby zamówić Subskrypcję, Użytkownik: (a) wybiera Pakiet w Aplikacji, (b) zapoznaje się z podsumowaniem (cena, okres rozliczeniowy, automatyczne odnawianie, sposób rezygnacji), (c) akceptuje Regulamin, (d) jeżeli jest Konsumentem albo Przedsiębiorcą na prawach konsumenta, żąda rozpoczęcia świadczenia przed upływem terminu do odstąpienia od umowy (§ 9 ust. 4), (e) podaje dane płatności w formularzu Stripe i zatwierdza zamówienie przyciskiem oznaczającym obowiązek zapłaty.
3. Umowa o Subskrypcję zostaje zawarta z chwilą potwierdzenia płatności. Dostęp do Pakietu jest udzielany niezwłocznie.
4. Usługodawca przesyła na adres e-mail Użytkownika potwierdzenie zawarcia umowy wraz z treścią Regulaminu, pouczeniem o prawie odstąpienia od umowy ze wzorem formularza i potwierdzeniem żądania z ust. 2 lit. d.
5. Umowa jest zawierana w języku polskim albo angielskim, zależnie od wersji językowej Regulaminu zaakceptowanej przez Użytkownika.

<!-- PRAWNIK P-04, P-05: czy żądanie z ust. 2 lit. d może być warunkiem zakupu; napis przycisku w formularzu Stripe. -->

## § 7. Zasady korzystania i treści

1. Użytkownik korzysta z Serwisu zgodnie z prawem, Regulaminem i dobrymi obyczajami. Zakazane jest dostarczanie treści o charakterze bezprawnym i korzystanie z Serwisu w celu:
   1. naruszania praw osób trzecich, w tym praw autorskich, znaków towarowych i dóbr osobistych;
   2. tworzenia fałszywych opinii lub recenzji konsumenckich, fałszywych rekomendacji albo treści wprowadzających w błąd co do ich pochodzenia lub autora;
   3. podszywania się pod inne osoby lub instytucje, w tym pod media, urzędy i kandydatów w wyborach;
   4. generowania lub obróbki realistycznych wizerunków intymnych rozpoznawalnej osoby bez jej wyraźnej zgody oraz treści przedstawiających seksualne wykorzystywanie dzieci;
   5. rozsyłania niezamówionych informacji handlowych;
   6. obchodzenia zabezpieczeń Serwisu lub Dostawców AI albo naruszania warunków Dostawców AI;
   7. usuwania, zmieniania lub fałszowania oznaczeń informujących, że treść została wygenerowana przez sztuczną inteligencję, wprowadzonych przez Serwis lub Dostawców AI (metadane, znaki wodne), z wyjątkiem usunięcia widocznej etykiety, którą Użytkownik sam dodał;
   8. wprowadzania danych osobowych osób trzecich bez podstawy prawnej, w szczególności danych szczególnych kategorii.
2. Oznaczanie treści AI. Serwis wspiera wymogi przejrzystości z art. 50 rozporządzenia (UE) 2024/1689 (AI Act): oznacza Wyniki w formacie nadającym się do odczytu maszynowego tam, gdzie pozwala na to format pliku lub kanał publikacji. Szczegóły są na stronie „AI Act i przejrzystość” ({{URL_AI_ACT}}).
3. Obowiązki Użytkownika przy publikacji (art. 50 ust. 4 AI Act). Użytkownik, który publikuje Wyniki, sam ocenia i wykonuje obowiązki podmiotu stosującego system AI; Aplikacja udostępnia w tym celu przełączniki widocznej etykiety. W szczególności Użytkownik:
   1. ujawnia, że obraz lub nagranie zostało wygenerowane lub zmanipulowane przez AI, jeżeli przypomina istniejące osoby, przedmioty, miejsca lub zdarzenia i mogłoby zostać uznane za prawdziwe;
   2. ujawnia, że tekst opublikowany w celu informowania opinii publicznej o sprawach interesu publicznego został wygenerowany przez AI, chyba że przeszedł przegląd człowieka lub kontrolę redakcyjną, a osoba fizyczna lub prawna ponosi odpowiedzialność redakcyjną za jego publikację;
   3. informuje słuchaczy, że nagranie odczytuje syntetyczny głos.
4. Użytkownik odpowiada za publikację i wykorzystanie Wyników, w tym za ich zgodność z prawem i prawdziwość.
5. Usługodawca nie rości sobie praw do Treści Użytkownika ani do Wyników. Użytkownik udziela Usługodawcy niewyłącznej, nieodpłatnej licencji na przechowywanie i przetwarzanie Treści Użytkownika wyłącznie w zakresie potrzebnym do świadczenia usług, na czas korzystania z Serwisu. Usługodawca nie gwarantuje, że Wyniki są objęte ochroną prawa autorskiego ani że są unikalne.

## § 8. Zgłaszanie nielegalnych treści i moderacja

1. Punktem kontaktowym dla organów państw członkowskich, Komisji Europejskiej i użytkowników w sprawach rozporządzenia (UE) 2022/2065 (akt o usługach cyfrowych) jest adres WSTAW_TUTAJ_EMAIL. Kontakt jest możliwy w języku polskim i angielskim.
2. Każdy może zgłosić treść przechowywaną w Serwisie, którą uważa za nielegalną. Zgłoszenie powinno zawierać: uzasadnienie, dlaczego treść jest nielegalna; wskazanie treści pozwalające ją odnaleźć; imię i nazwisko oraz adres e-mail zgłaszającego (z wyjątkiem zgłoszeń dotyczących wykorzystywania seksualnego dzieci); oświadczenie, że zgłoszenie jest dokonywane w dobrej wierze i jest prawidłowe i kompletne.
3. Usługodawca potwierdza otrzymanie zgłoszenia, rozpatruje je bez zbędnej zwłoki i informuje zgłaszającego o decyzji i możliwości jej zaskarżenia.
4. Usługodawca nie przegląda rutynowo dokumentów Bazy wiedzy. Działa na podstawie zgłoszeń, nakazów organów i własnej wiedzy o naruszeniu. Dostawcy AI stosują własne automatyczne filtry i mogą odmówić wygenerowania treści.
5. Jeżeli Usługodawca usuwa treść, ogranicza dostęp do niej albo zawiesza Konto, przekazuje Użytkownikowi uzasadnienie: co zrobiono, na jakiej podstawie, jakie fakty wzięto pod uwagę oraz jak się odwołać (reklamacja z § 11).
6. O podejrzeniu przestępstwa zagrażającego życiu lub bezpieczeństwu osób Usługodawca zawiadamia właściwe organy.

## § 9. Prawo odstąpienia od umowy (Konsumenci i Przedsiębiorcy na prawach konsumenta)

1. Konsument może odstąpić od umowy o Subskrypcję w terminie 14 dni od dnia jej zawarcia bez podania przyczyny.
2. Aby odstąpić, wystarczy przed upływem terminu użyć funkcji odstąpienia od umowy w ustawieniach Konta, wysłać oświadczenie e-mailem na adres WSTAW_TUTAJ_EMAIL albo listem na adres WSTAW_TUTAJ_ADRES. Można skorzystać ze [wzoru formularza odstąpienia]({{URL_ODSTAPIENIE}}), ale nie jest to obowiązkowe. Usługodawca niezwłocznie potwierdza otrzymanie oświadczenia e-mailem.
3. Usługodawca zwraca płatności niezwłocznie, nie później niż w terminie 14 dni od dnia otrzymania oświadczenia, tą samą metodą płatności, chyba że Konsument zgodzi się na inną, bez kosztów dla Konsumenta.
4. Jeżeli Konsument zażądał rozpoczęcia świadczenia przed upływem terminu do odstąpienia, płaci kwotę proporcjonalną do zakresu świadczenia spełnionego do chwili odstąpienia, liczoną według ceny Subskrypcji za liczbę dni, w których Pakiet był dostępny. Usługodawca potrąca tę kwotę ze zwrotu.
5. Po odstąpieniu dostęp do Pakietu płatnego wygasa, a Konto działa na zasadach Pakietu Darmowego (bez ponownego przyznania limitu darmowych artykułów).

<!--
D-03 (DECYZJE-R9): domyślnie zwrot proporcjonalny, w konfiguracji płatności można przełączyć na pełny. Pełny zwrot jest
korzystniejszy dla Konsumenta niż ten tekst, więc tekst zostaje prawdziwy w obu ustawieniach; przy stałym przejściu
na pełny zwrot ust. 4 może brzmieć: "Usługodawca zwraca całą zapłaconą kwotę."
-->

## § 10. Rezygnacja z Subskrypcji i rozwiązanie umów

1. Użytkownik może w każdej chwili zrezygnować z Subskrypcji w ustawieniach Konta (panel płatności Stripe). Rezygnacja działa na koniec opłaconego okresu rozliczeniowego; do tego czasu Pakiet pozostaje dostępny. Za niewykorzystaną część okresu nie przysługuje zwrot, z wyjątkiem przypadków z § 9, § 11 i ust. 4.
2. Użytkownik może w każdej chwili usunąć Konto w ustawieniach Konta albo żądaniem wysłanym e-mailem. Usunięcie Konta kończy Subskrypcję od razu; po upływie terminu do odstąpienia od umowy bez zwrotu za niewykorzystaną część okresu. Usunięcie Konta usuwa też dokumenty Bazy wiedzy (§ 14).
3. Usługodawca może wypowiedzieć umowę o prowadzenie Konta z ważnych przyczyn: rażące lub powtarzające się naruszenie § 7, działanie na szkodę Serwisu lub innych Użytkowników, nakaz organu. Wypowiedzenie następuje e-mailem z uzasadnieniem i 14-dniowym terminem, a w przypadkach rażących (np. treści z § 7 ust. 1 pkt 4) ze skutkiem natychmiastowym.
4. Jeżeli Usługodawca zakończy świadczenie usług z przyczyn niezależnych od Użytkownika, zwraca część ceny za niewykorzystaną część okresu rozliczeniowego.

## § 11. Reklamacje i zgodność usługi z umową

1. Usługodawca odpowiada wobec Konsumenta za zgodność usługi cyfrowej z umową na zasadach ustawy o prawach konsumenta.
2. Reklamację można złożyć e-mailem (WSTAW_TUTAJ_EMAIL) albo listem (WSTAW_TUTAJ_ADRES). Warto opisać problem, datę jego wystąpienia i oczekiwany sposób załatwienia.
3. Usługodawca odpowiada na reklamację w terminie 14 dni od jej otrzymania.
4. W razie braku zgodności usługi z umową Konsument może żądać doprowadzenia jej do zgodności, a gdy to niemożliwe, nie nastąpiło w rozsądnym terminie lub brak zgodności jest istotny, obniżenia ceny albo odstąpienia od umowy, na zasadach ustawy.
5. Konsument może skorzystać z pozasądowych sposobów rozpatrywania sporów, m.in. pomocy miejskiego lub powiatowego rzecznika konsumentów, Wojewódzkiego Inspektoratu Inspekcji Handlowej oraz, w sporach transgranicznych w UE, Europejskiego Centrum Konsumenckiego. Informacje: https://prawakonsumenta.uokik.gov.pl
6. Przedsiębiorcy, którzy nie są Przedsiębiorcami na prawach konsumenta, składają reklamacje w ten sam sposób; uprawnienia z ust. 1 i 4 ich nie dotyczą.

<!-- PRAWNIK: brzmienie art. 7a ustawy o prawach konsumenta (ust. 3); P-14: udział w pozasądowym rozwiązywaniu sporów (ust. 5). -->

## § 12. Zmiany usługi, cen i Regulaminu

1. Usługodawca może zmieniać funkcje Aplikacji z uzasadnionych przyczyn: zmiany przepisów, zmiany usług Dostawców AI, bezpieczeństwo, rozwój funkcji. Zmiana jest bezpłatna dla Użytkownika. Jeżeli zmiana istotnie i negatywnie wpływa na dostęp do usługi lub korzystanie z niej przez Konsumenta, Usługodawca informuje o niej z wyprzedzeniem na trwałym nośniku, a Konsument może rozwiązać umowę na zasadach ustawy o prawach konsumenta.
2. Usługodawca może zmienić Regulamin lub ceny z ważnych przyczyn: zmiana przepisów, decyzja lub orzeczenie organu, zmiana cen lub warunków Dostawców AI, płatności lub hostingu, zmiana zakresu usług, przeciwdziałanie nadużyciom. O zmianie informuje e-mailem co najmniej 30 dni przed jej wejściem w życie.
3. Nowa cena obowiązuje od pierwszego okresu rozliczeniowego rozpoczynającego się po wejściu zmiany w życie. Użytkownik, który nie akceptuje zmiany, może zrezygnować z Subskrypcji przed tą datą bez żadnych kosztów.
4. Do umów zawartych przed zmianą stosuje się dotychczasowy Regulamin do końca bieżącego okresu rozliczeniowego, chyba że Użytkownik zaakceptuje zmianę wcześniej.

## § 13. Odpowiedzialność

1. Usługodawca dokłada starań, aby Serwis działał nieprzerwanie, ale może planowo przerywać jego działanie w celu konserwacji, w miarę możliwości poza godzinami 8:00-20:00 czasu polskiego. Dostępność usług Dostawców AI zależy od nich.
2. Wobec Konsumentów odpowiedzialność Usługodawcy wynika z przepisów prawa i nie jest ograniczana w zakresie, w jakim przepisy na to nie pozwalają.
3. Wobec Użytkowników niebędących Konsumentami ani Przedsiębiorcami na prawach konsumenta odpowiedzialność Usługodawcy jest ograniczona do kwoty zapłaconej przez Użytkownika w ostatnich 3 miesiącach i nie obejmuje utraconych korzyści; ograniczenie nie dotyczy szkody wyrządzonej umyślnie.
4. Usługodawca nie odpowiada za treść Wyników opublikowanych przez Użytkownika, za decyzje podjęte na ich podstawie ani za skutki naruszenia przez Użytkownika warunków Dostawców AI.

## § 14. Dane osobowe

1. Zasady przetwarzania danych osobowych opisuje [Polityka prywatności]({{URL_PRYWATNOSC}}).
2. Jeżeli Użytkownik wprowadza do Serwisu dane osobowe, za które odpowiada jako administrator (np. w dokumentach Bazy wiedzy), Usługodawca przetwarza je w jego imieniu na podstawie [umowy powierzenia przetwarzania danych osobowych]({{URL_DPA}}) (Załącznik 1), zawieranej wraz z akceptacją Regulaminu.
3. Po usunięciu Konta Usługodawca usuwa dokumenty Bazy wiedzy i dane Konta z wyjątkiem danych, które musi przechowywać na podstawie przepisów (np. dokumenty sprzedaży) lub dla dochodzenia roszczeń, przez okres wskazany w Polityce prywatności.

## § 15. Postanowienia końcowe

1. Do umów stosuje się prawo polskie. Wybór prawa nie pozbawia Konsumenta ochrony, jaką zapewniają mu bezwzględnie obowiązujące przepisy prawa państwa jego zwykłego pobytu.
2. Spory z Konsumentami rozstrzygają sądy właściwe według przepisów ogólnych. Spory z innymi Użytkownikami rozstrzyga sąd właściwy dla miejsca zamieszkania Usługodawcy.
3. Regulamin w wersji {{WERSJA}} z {{DATA}} obowiązuje od dnia jego udostępnienia w Serwisie.

## Załączniki

1. [Umowa powierzenia przetwarzania danych osobowych]({{URL_DPA}}) z [listą dalszych podmiotów przetwarzających]({{URL_PODPRZETWARZAJACY}}).
2. [Pouczenie o prawie odstąpienia od umowy i wzór formularza]({{URL_ODSTAPIENIE}}).
3. [Cennik]({{URL_CENNIK}}).
