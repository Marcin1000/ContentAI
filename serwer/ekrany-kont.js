'use strict';

// ─── Ekrany kont serwera (wykonawca A1) ──────────────────────────────────────
//
// Ekrany bez JavaScriptu pod CSP, jak serwer/logowanie.js (ARCH8-06): rejestracja,
// potwierdzenie e-maila, reset hasla, konto, zgody, usuniecie konta, pozegnanie.
// Wspolny wyglad z logowanie.js: szkielet(t, tytul, srodek, opcje), esc(s), akapit(s),
// teksty(jezyk). Uklad z makiet R1-R7 (AG/runda8/agencja-ux/makiety/), teksty z
// AG/runda8/agencja-strona/05-mikroteksty.md, brzmienie zgod z AG/runda8/prawo/
// zgody-i-komunikaty.md (pola wyboru osobno, niezaznaczone, tekst o administratorze danych).
//
// Kazdy ekran to czysta funkcja zwracajaca HTML: bez zapisu i bez bazy. Decyzje
// (co pokazac, czy formularz jest dostepny) podejmuje konta.js i przekazuje gotowe
// dane. Wszystko, co przychodzi z zewnatrz, przechodzi przez esc(). Jedyny skrypt to
// opcjonalny widzet Cloudflare Turnstile (CAI_TURNSTILE_*, domyslnie wylaczony).
//
// Dostepnosc: etykiety pol, komunikat ogolny w aria-live, bledy przy polach z
// aria-invalid i aria-describedby, cele dotyku co najmniej 44 px, pismo od 12 px.

const logowanie = require('./logowanie.js');

const { esc, akapit } = logowanie;

const MIESIACE = {
  pl: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** Polska odmiana po liczbie: 1 artykul, 2-4 artykuly, 5+ artykulow (12-14 jak 5+). */
function odmiana(n, formy) {
  const d = n % 10;
  const s = n % 100;
  if (n === 1) return formy[0];
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return formy[1];
  return formy[2];
}

/** Data slownie w jezyku ekranu: "9 października 2026" / "9 October 2026". */
function data(ms, jezyk) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  const m = MIESIACE[jezyk === 'en' ? 'en' : 'pl'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

const T = {
  pl: {
    // rejestracja (R1)
    rejTytul: 'Załóż konto · Content AI',
    rejNaglowek: 'Załóż konto',
    rejWstep: (n) => `Na start dostajesz ${n} ${odmiana(n, ['artykuł', 'artykuły', 'artykułów'])} w pakiecie Darmowym, bez karty. Do pisania potrzebny będzie Twój klucz API Anthropic: podłączysz go zaraz po rejestracji.`,
    rejWstepOgolny: 'Do pisania potrzebny będzie Twój klucz API Anthropic: podłączysz go zaraz po rejestracji.',
    rejWstepPakiet: (p) => `Wybrany pakiet: ${p}. Najpierw załóż konto, potem przejdziesz do płatności w Stripe.`,
    email: 'E-mail',
    haslo: 'Hasło',
    hasloPodpowiedz: (min) => `Co najmniej ${min} znaków. Najlepiej kilka słów, których nie używasz nigdzie indziej.`,
    zgodaRegulamin: (a) => `Akceptuję <a href="${a}" target="_blank" rel="noopener">Regulamin</a> serwisu Content AI.`,
    zgodaWiek: 'Mam ukończone 18 lat.',
    administrator: (kto, a) => `Administratorem Twoich danych jest ${kto}. Przetwarzamy je, żeby założyć i prowadzić konto. Szczegóły i Twoje prawa: <a href="${a}" target="_blank" rel="noopener">Polityka prywatności</a>.`,
    administratorBezNazwy: (a) => `Przetwarzamy Twoje dane, żeby założyć i prowadzić konto. Szczegóły i Twoje prawa: <a href="${a}" target="_blank" rel="noopener">Polityka prywatności</a>.`,
    informacjaAi: 'Content AI tworzy treści z pomocą sztucznej inteligencji. Wyniki mogą zawierać błędy: sprawdź fakty przed publikacją. Pliki z Content AI mają oznaczenie, że powstały z użyciem AI.',
    pulapka: 'Strona internetowa (zostaw puste)',
    rejPrzycisk: 'Załóż konto',
    maszKonto: 'Masz już konto?',
    zalogujSie: 'Zaloguj się',
    kroki: (n) => [
      'Załóż konto i potwierdź adres e-mail.',
      'Podłącz swój klucz API Anthropic: aplikacja pokaże, jak go zdobyć.',
      n ? `Napisz ${n} ${odmiana(n, ['artykuł', 'artykuły', 'artykułów'])} za darmo. Pakiet wybierzesz, kiedy zechcesz.` : 'Napisz pierwszy artykuł. Pakiet wybierzesz, kiedy zechcesz.',
    ],
    stopka: 'Twój klucz API zapisuje tylko Twoja przeglądarka.',
    // bledy przy polach
    bledy: {
      'email-zly': 'Wpisz adres e-mail w formie nazwa@domena.pl.',
      'email-zajety': 'Ten adres ma już konto. Zaloguj się albo ustaw nowe hasło.',
      'email-taki-sam': 'To jest Twój obecny adres.',
      'haslo-krotkie': (min) => `Hasło musi mieć co najmniej ${min} znaków.`,
      'haslo-dlugie': (min, max) => `Hasło może mieć najwyżej ${max} znaków.`,
      'haslo-jak-email': 'Hasło nie może być takie samo jak adres e-mail.',
      'haslo-slabe': 'To hasło jest zbyt popularne. Wybierz inne.',
      'haslo-zle': 'Niepoprawne hasło.',
      'haslo-puste': 'Wpisz hasło.',
      regulamin: 'Zaznacz akceptację regulaminu, żeby założyć konto.',
      wiek: 'Zaznacz, że masz ukończone 18 lat, żeby założyć konto.',
      rozumiem: 'Zaznacz, że rozumiesz skutki usunięcia konta.',
      zgoda: 'Zaznacz akceptację nowej wersji regulaminu.',
    },
    // komunikaty ogolne
    komunikaty: {
      'popraw-pola': 'Popraw zaznaczone pola.',
      'formularz-wygasl': 'Formularz wygasł. Sprawdź dane i wyślij go jeszcze raz.',
      'formularz-szybko': 'Sprawdź dane i wyślij formularz jeszcze raz.',
      turnstile: 'Nie udało się potwierdzić, że formularz wysyła człowiek. Spróbuj jeszcze raz.',
      'za-duzo-prob': (min) => `Za dużo prób z tego adresu. Spróbuj ponownie za ${min} ${odmiana(min, ['minutę', 'minuty', 'minut'])}.`,
      zajety: 'Serwer jest chwilowo zajęty. Spróbuj ponownie za chwilę.',
      'ok-haslo': 'Hasło zmienione. Wylogowaliśmy Cię na pozostałych urządzeniach.',
      'ok-email': 'Wysłaliśmy link na nowy adres. Adres zmieni się, gdy klikniesz przycisk w wiadomości.',
      'ok-potwierdzenie': 'Wysłane. Nowy link zastępuje poprzedni.',
      'ok-zgoda': 'Zapisaliśmy akceptację regulaminu.',
      'wysylka-blad': 'Nie udało się wysłać wiadomości. Spróbuj ponownie za chwilę.',
      'ponow-czekaj': (s) => `Kolejną wiadomość wyślesz za ${s} s.`,
      'email-niepotwierdzony': 'Najpierw potwierdź obecny adres e-mail. Link wyślesz ponownie przyciskiem obok adresu.',
    },
    // sprawdz skrzynke (R2)
    pocztaTytul: 'Sprawdź skrzynkę · Content AI',
    pocztaNaglowek: 'Sprawdź skrzynkę',
    pocztaTekst: (e, g) => `Wysłaliśmy wiadomość na adres ${e}. Kliknij w niej przycisk „Potwierdź adres”, żeby aktywować konto. Link jest ważny ${g} ${odmiana(g, ['godzinę', 'godziny', 'godzin'])}.`,
    pocztaOgolna: 'Jeśli dane się zgadzają, za chwilę dostaniesz wiadomość z linkiem.',
    pocztaBrak: 'Nie widzisz wiadomości? Sprawdź folder spam albo oferty.',
    // potwierdzenie (R3)
    potwTytul: 'Potwierdź adres · Content AI',
    potwNaglowek: 'Potwierdź adres e-mail',
    potwNaglowekNowy: 'Potwierdź nowy adres e-mail',
    potwKonto: (e) => `Konto: ${e}. Jeden klik i konto jest aktywne.`,
    potwKontoNowy: (e) => `Nowy adres konta: ${e}. Po potwierdzeniu logujesz się tym adresem.`,
    potwPrzycisk: 'Potwierdź adres',
    potwDlaczego: 'Przycisk zamiast potwierdzenia samym linkiem: programy pocztowe same otwierają odnośniki i zużyłyby jednorazowy kod.',
    potwOkNaglowek: 'Adres potwierdzony',
    potwOkTekst: 'Konto jest aktywne. Teraz podłącz klucz API, a potem napiszesz pierwszy artykuł.',
    potwOkNowyNaglowek: 'Adres zmieniony',
    potwOkNowyTekst: (e) => `Od teraz logujesz się adresem ${e}.`,
    potwJuzNaglowek: 'Adres jest już potwierdzony',
    potwJuzTekst: 'Ten link był już użyty, a konto jest aktywne.',
    potwZlyNaglowek: 'Link nieważny',
    potwZlyTekst: 'Ten link wygasł albo został już użyty. Zaloguj się, a wyślemy nowy.',
    potwZlyTekstZalogowany: 'Ten link wygasł albo został już użyty. Wyślij nowy przyciskiem poniżej.',
    potwZajetyNaglowek: 'Adres ma już konto',
    potwZajetyTekst: 'Adresu nie zmieniliśmy, bo w międzyczasie ktoś założył na niego konto. Wybierz inny adres na ekranie konta.',
    przejdzDoAplikacji: 'Przejdź do aplikacji',
    wyslijNowyLink: 'Wyślij nowy link',
    // reset (R5, R6)
    resetTytul: 'Nie pamiętasz hasła? · Content AI',
    resetNaglowek: 'Nie pamiętasz hasła?',
    resetWstep: 'Podaj adres e-mail konta. Wyślemy link do ustawienia nowego hasła.',
    resetPrzycisk: 'Wyślij link',
    resetZespol: 'Konto z loginem nadanym przez administratora zespołu, bez adresu e-mail? Nowe hasło ustawia administrator.',
    resetWyslano: (e, m) => `Jeśli pod adresem ${e} jest konto, za chwilę dostaniesz link. Jest ważny ${m} ${odmiana(m, ['minutę', 'minuty', 'minut'])}.`,
    resetNiedostepny: 'Hasło do konta zespołu zmienia administrator. Napisz do niego, a ustawi nowe.',
    resetNiedostepnyKontakt: (e) => `Hasło do konta zespołu zmienia administrator. Napisz do niego albo na ${e}.`,
    wrocDoLogowania: 'Wróć do logowania',
    noweTytul: 'Ustaw nowe hasło · Content AI',
    noweNaglowek: 'Ustaw nowe hasło',
    noweKonto: (e) => `Konto: ${e}`,
    noweHaslo: 'Nowe hasło',
    nowePodpowiedz: (min) => `Co najmniej ${min} znaków.`,
    nowePrzycisk: 'Zapisz i zaloguj się',
    noweUwaga: 'Po zmianie hasła wylogujemy Cię na pozostałych urządzeniach i usuniemy zapamiętane klucze API.',
    noweZlyTekst: 'Ten link wygasł albo został już użyty. Poproś o nowy.',
    // konto
    kontoTytul: 'Konto · Content AI',
    kontoNaglowek: 'Konto',
    kontoOd: (d) => `konto od ${d}`,
    kontoZespolu: 'konto zespołu',
    sekcjaEmail: 'Adres e-mail',
    emailPotwierdzony: 'potwierdzony',
    emailNiepotwierdzony: 'niepotwierdzony',
    emailBrak: 'Konto nie ma adresu e-mail. Dodaj go, żeby logować się adresem i samodzielnie ustawiać nowe hasło.',
    emailCzeka: (e) => `Czeka na potwierdzenie: ${e}. Kliknij przycisk w wiadomości wysłanej na ten adres.`,
    emailNiepotwierdzonyOpis: 'Potwierdź adres, żeby korzystać z pobierania stron i sprawdzania odnośników.',
    wyslijPonownie: 'Wyślij link ponownie',
    zmienEmail: 'Zmień adres e-mail',
    dodajEmail: 'Dodaj adres e-mail',
    nowyEmail: 'Nowy adres e-mail',
    hasloObecne: 'Obecne hasło',
    zmienEmailUwaga: 'Wyślemy link na nowy adres. Do czasu kliknięcia logujesz się dotychczasowym.',
    sekcjaHaslo: 'Hasło',
    zmienHaslo: 'Zmień hasło',
    hasloStare: 'Obecne hasło',
    hasloNowe: 'Nowe hasło',
    hasloUwaga: 'Po zmianie hasła wylogujemy Cię na pozostałych urządzeniach i usuniemy zapamiętane klucze API.',
    sekcjaPakiet: 'Pakiet',
    pakietNazwa: (n) => `Pakiet: ${n}`,
    pakietBezLimitu: 'bez limitu',
    pakietZespolu: 'Pakiet przydziela administrator zespołu.',
    pakietyIPlatnosci: 'Pakiety i płatności',
    czynnosci: { artykul: 'Artykuły', grafika: 'Grafiki', audio: 'Audio (lektor)', transkrypcja: 'Transkrypcje' },
    zuzycie: (z, l) => `${z} z ${l}`,
    sekcjaSesje: 'Urządzenia',
    sesjeOpis: 'Wylogujemy Cię na wszystkich urządzeniach, także na tym, i usuniemy zapamiętane klucze API.',
    wylogujWszedzie: 'Wyloguj na wszystkich urządzeniach',
    sekcjaDane: 'Twoje dane',
    daneOpis: 'Konto, zgody, zużycie, płatności i baza wiedzy w jednym pliku JSON.',
    pobierzDane: 'Pobierz moje dane',
    daneHistoria: 'Historia artykułów jest zapisana tylko w tej przeglądarce. Wyeksportujesz ją w aplikacji.',
    sekcjaDokumenty: 'Regulamin i prywatność',
    dokumentyWersja: (w, d) => `Zaakceptowana wersja regulaminu: ${w}${d ? `, ${d}` : ''}.`,
    dokumentyBrak: 'Konto zespołu działa na zasadach uzgodnionych z administratorem.',
    dokumentyNowa: 'Jest nowa wersja regulaminu.',
    zaakceptujNowa: 'Przeczytaj i zaakceptuj',
    regulamin: 'Regulamin',
    polityka: 'Polityka prywatności',
    sekcjaUsun: 'Usuń konto',
    usunOpis: 'Usuniemy konto, bazę wiedzy i dane firmy. Subskrypcja zostanie anulowana od razu (zwroty: zgodnie z Regulaminem).',
    usunZespol: 'To konto należy do zespołu, więc usuwa je administrator.',
    usunOperator: 'To konto administratora serwera. Usuwa się je poleceniem na serwerze, gdy jest inny administrator.',
    usunPrzejdz: 'Usuń konto',
    wroc: 'Wróć do aplikacji',
    bramaHasla: 'Logowaniem i hasłem zarządza brama uwierzytelniająca.',
    // usuniecie
    usunTytul: 'Usuń konto · Content AI',
    usunNaglowek: 'Usunąć konto na zawsze?',
    usunCo: (e) => `Usuniemy konto ${e}, bazę wiedzy i dane firmy.`,
    usunSubskrypcja: 'Subskrypcja zostanie anulowana od razu (zwroty: zgodnie z Regulaminem).',
    usunPrzegladarka: 'Wyczyścimy też dane Content AI w tej przeglądarce: historię artykułów i zapamiętane klucze. Jeśli chcesz zachować historię, najpierw ją wyeksportuj w aplikacji.',
    usunStripe: 'Potwierdzenia płatności przechowuje Stripe tak długo, jak wymaga prawo.',
    usunNajpierw: 'Zanim usuniesz konto, możesz pobrać swoje dane:',
    usunHaslo: 'Hasło, żeby potwierdzić',
    usunRozumiem: 'Rozumiem, że usunięcia konta nie da się cofnąć.',
    usunPrzycisk: 'Usuń konto na zawsze',
    anuluj: 'Anuluj',
    usunNieTytul: 'Usunięcie konta · Content AI',
    usunNieNaglowek: 'Usunięcie konta',
    // pozegnanie (R7)
    zegnajTytul: 'Konto usunięte · Content AI',
    zegnajNaglowek: 'Konto usunięte',
    zegnajCo: (e) => `Usunęliśmy konto ${e}, bazę wiedzy i dane firmy.`,
    zegnajOgolne: 'Konto, baza wiedzy i dane firmy są usunięte.',
    zegnajSubskrypcja: 'Subskrypcja jest anulowana.',
    zegnajPrzegladarka: 'Wyczyściliśmy też dane Content AI w tej przeglądarce. Na innych urządzeniach usuniesz je w ustawieniach przeglądarki.',
    zegnajStrona: 'Wróć na content-ai.net',
    // zgody
    zgodyTytul: 'Regulamin · Content AI',
    zgodyNaglowek: 'Nowa wersja regulaminu',
    zgodyTekst: (w) => `Zmieniliśmy Regulamin (wersja ${w}). Przeczytaj go i zaakceptuj, żeby dalej korzystać z Content AI.`,
    zgodyPole: (w, a) => `Akceptuję <a href="${a}" target="_blank" rel="noopener">Regulamin</a> serwisu Content AI w wersji ${w}.`,
    zgodyPrzycisk: 'Zapisz akceptację',
    zgodyAktualne: (w) => `Masz zaakceptowaną aktualną wersję regulaminu (${w}).`,
    // ekrany komunikatow
    ekrany: {
      'obce-zrodlo': ['Formularz odrzucony', 'Formularz nie pochodził z tej strony. Odśwież stronę i spróbuj ponownie.'],
      'za-duzo-prob': ['Za dużo prób', 'Za dużo prób w krótkim czasie. Spróbuj ponownie za kilka minut.'],
      csrf: ['Formularz wygasł', 'Odśwież stronę konta i spróbuj ponownie.'],
      'nie-znaleziono': ['Nie ma takiej strony', 'Sprawdź adres albo wróć do aplikacji.'],
      niedostepne: ['Niedostępne na tym serwerze', 'Ta funkcja nie jest włączona na tym serwerze.'],
      zajety: ['Serwer jest zajęty', 'Serwer jest chwilowo zajęty. Spróbuj ponownie za chwilę.'],
      'anulowanie-blad': ['Nie udało się anulować subskrypcji', 'Operator płatności nie odpowiada, więc konta nie usunęliśmy: płaciłbyś dalej. Spróbuj ponownie za kilka minut.'],
      'wysylka-blad': ['Nie udało się wysłać wiadomości', 'Spróbuj ponownie za chwilę.'],
    },
    zaloguj: 'Zaloguj się',
    wrocDoKonta: 'Wróć do konta',
  },
  en: {
    rejTytul: 'Create account · Content AI',
    rejNaglowek: 'Create your account',
    rejWstep: (n) => `You start with ${n} ${n === 1 ? 'article' : 'articles'} on the Free plan, no card needed. To write, you will need your own Anthropic API key: you connect it right after signing up.`,
    rejWstepOgolny: 'To write, you will need your own Anthropic API key: you connect it right after signing up.',
    rejWstepPakiet: (p) => `Selected plan: ${p}. Create your account first, then you will go to payment in Stripe.`,
    email: 'Email',
    haslo: 'Password',
    hasloPodpowiedz: (min) => `At least ${min} characters. A few words you do not use anywhere else work best.`,
    zgodaRegulamin: (a) => `I accept the Content AI <a href="${a}" target="_blank" rel="noopener">Terms of Service</a>.`,
    zgodaWiek: 'I am at least 18 years old.',
    administrator: (kto, a) => `Your data controller is ${kto}. We process your data to create and run your account. Details and your rights: <a href="${a}" target="_blank" rel="noopener">Privacy Policy</a>.`,
    administratorBezNazwy: (a) => `We process your data to create and run your account. Details and your rights: <a href="${a}" target="_blank" rel="noopener">Privacy Policy</a>.`,
    informacjaAi: 'Content AI creates content with the help of artificial intelligence. Results may contain errors: check the facts before publishing. Files from Content AI are marked as AI-generated.',
    pulapka: 'Website (leave empty)',
    rejPrzycisk: 'Create account',
    maszKonto: 'Already have an account?',
    zalogujSie: 'Sign in',
    kroki: (n) => [
      'Create your account and confirm your email address.',
      'Connect your own Anthropic API key: the app shows you how to get one.',
      n ? `Write ${n} ${n === 1 ? 'article' : 'articles'} for free. Choose a plan whenever you like.` : 'Write your first article. Choose a plan whenever you like.',
    ],
    stopka: 'Only your browser saves your API key.',
    bledy: {
      'email-zly': 'Enter an email address like name@example.com.',
      'email-zajety': 'This address already has an account. Sign in or set a new password.',
      'email-taki-sam': 'This is your current address.',
      'haslo-krotkie': (min) => `Your password must be at least ${min} characters long.`,
      'haslo-dlugie': (min, max) => `Your password can be at most ${max} characters long.`,
      'haslo-jak-email': 'Your password cannot be the same as your email address.',
      'haslo-slabe': 'This password is too common. Choose another one.',
      'haslo-zle': 'Incorrect password.',
      'haslo-puste': 'Enter your password.',
      regulamin: 'Tick the box to accept the terms and create your account.',
      wiek: 'Tick the box to confirm you are at least 18 years old.',
      rozumiem: 'Tick the box to confirm you understand what deleting the account means.',
      zgoda: 'Tick the box to accept the new version of the terms.',
    },
    komunikaty: {
      'popraw-pola': 'Please correct the marked fields.',
      'formularz-wygasl': 'The form has expired. Check your details and send it again.',
      'formularz-szybko': 'Check your details and send the form again.',
      turnstile: 'We could not confirm that a person sent the form. Please try again.',
      'za-duzo-prob': (min) => `Too many attempts from this address. Try again in ${min} ${min === 1 ? 'minute' : 'minutes'}.`,
      zajety: 'The server is busy right now. Please try again in a moment.',
      'ok-haslo': 'Password changed. We have signed you out on your other devices.',
      'ok-email': 'We sent a link to the new address. The address changes when you click the button in that message.',
      'ok-potwierdzenie': 'Sent. The new link replaces the previous one.',
      'ok-zgoda': 'Your acceptance of the terms has been saved.',
      'wysylka-blad': 'We could not send the message. Please try again in a moment.',
      'ponow-czekaj': (s) => `You can send another message in ${s} s.`,
      'email-niepotwierdzony': 'Confirm your current email address first. You can resend the link with the button next to the address.',
    },
    pocztaTytul: 'Check your inbox · Content AI',
    pocztaNaglowek: 'Check your inbox',
    pocztaTekst: (e, g) => `We sent a message to ${e}. Click “Confirm address” in it to activate your account. The link is valid for ${g} ${g === 1 ? 'hour' : 'hours'}.`,
    pocztaOgolna: 'If the details are correct, you will receive a message with a link shortly.',
    pocztaBrak: 'Can’t see it? Check your spam or promotions folder.',
    potwTytul: 'Confirm address · Content AI',
    potwNaglowek: 'Confirm your email address',
    potwNaglowekNowy: 'Confirm your new email address',
    potwKonto: (e) => `Account: ${e}. One click and your account is active.`,
    potwKontoNowy: (e) => `New account address: ${e}. After confirming, you sign in with this address.`,
    potwPrzycisk: 'Confirm address',
    potwDlaczego: 'A button instead of the link alone: email programs open links by themselves and would use up the one-time code.',
    potwOkNaglowek: 'Address confirmed',
    potwOkTekst: 'Your account is active. Now connect your API key, and then you can write your first article.',
    potwOkNowyNaglowek: 'Address changed',
    potwOkNowyTekst: (e) => `From now on you sign in with ${e}.`,
    potwJuzNaglowek: 'This address is already confirmed',
    potwJuzTekst: 'This link has already been used, and your account is active.',
    potwZlyNaglowek: 'Link not valid',
    potwZlyTekst: 'This link has expired or has already been used. Sign in and we will send a new one.',
    potwZlyTekstZalogowany: 'This link has expired or has already been used. Send a new one with the button below.',
    potwZajetyNaglowek: 'This address already has an account',
    potwZajetyTekst: 'We did not change your address because someone has created an account with it in the meantime. Choose another address on the account screen.',
    przejdzDoAplikacji: 'Go to the app',
    wyslijNowyLink: 'Send a new link',
    resetTytul: 'Forgot your password? · Content AI',
    resetNaglowek: 'Forgot your password?',
    resetWstep: 'Enter your account email. We will send you a link to set a new password.',
    resetPrzycisk: 'Send link',
    resetZespol: 'Is your account a username set up by your team administrator, without an email address? Your administrator sets a new password.',
    resetWyslano: (e, m) => `If there is an account for ${e}, you will receive a link shortly. It is valid for ${m} ${m === 1 ? 'minute' : 'minutes'}.`,
    resetNiedostepny: 'Your team administrator changes the password of a team account. Ask them to set a new one.',
    resetNiedostepnyKontakt: (e) => `Your team administrator changes the password of a team account. Ask them, or write to ${e}.`,
    wrocDoLogowania: 'Back to sign in',
    noweTytul: 'Set a new password · Content AI',
    noweNaglowek: 'Set a new password',
    noweKonto: (e) => `Account: ${e}`,
    noweHaslo: 'New password',
    nowePodpowiedz: (min) => `At least ${min} characters.`,
    nowePrzycisk: 'Save and sign in',
    noweUwaga: 'After the change we will sign you out on your other devices and remove saved API keys.',
    noweZlyTekst: 'This link has expired or has already been used. Request a new one.',
    kontoTytul: 'Account · Content AI',
    kontoNaglowek: 'Account',
    kontoOd: (d) => `account since ${d}`,
    kontoZespolu: 'team account',
    sekcjaEmail: 'Email address',
    emailPotwierdzony: 'confirmed',
    emailNiepotwierdzony: 'not confirmed',
    emailBrak: 'This account has no email address. Add one to sign in with it and to set a new password yourself.',
    emailCzeka: (e) => `Waiting for confirmation: ${e}. Click the button in the message sent to that address.`,
    emailNiepotwierdzonyOpis: 'Confirm your address to use page fetching and link checking.',
    wyslijPonownie: 'Send the link again',
    zmienEmail: 'Change email address',
    dodajEmail: 'Add an email address',
    nowyEmail: 'New email address',
    hasloObecne: 'Current password',
    zmienEmailUwaga: 'We will send a link to the new address. Until you click it, you sign in with the current one.',
    sekcjaHaslo: 'Password',
    zmienHaslo: 'Change password',
    hasloStare: 'Current password',
    hasloNowe: 'New password',
    hasloUwaga: 'After the change we will sign you out on your other devices and remove saved API keys.',
    sekcjaPakiet: 'Plan',
    pakietNazwa: (n) => `Plan: ${n}`,
    pakietBezLimitu: 'no limit',
    pakietZespolu: 'Your team administrator assigns the plan.',
    pakietyIPlatnosci: 'Plans and billing',
    czynnosci: { artykul: 'Articles', grafika: 'Images', audio: 'Audio (voice-over)', transkrypcja: 'Transcriptions' },
    zuzycie: (z, l) => `${z} of ${l}`,
    sekcjaSesje: 'Devices',
    sesjeOpis: 'We will sign you out on all devices, including this one, and remove saved API keys.',
    wylogujWszedzie: 'Sign out on all devices',
    sekcjaDane: 'Your data',
    daneOpis: 'Your account, consents, usage, payments and knowledge base in one JSON file.',
    pobierzDane: 'Download my data',
    daneHistoria: 'Your article history is stored only in this browser. You can export it in the app.',
    sekcjaDokumenty: 'Terms and privacy',
    dokumentyWersja: (w, d) => `Accepted version of the terms: ${w}${d ? `, ${d}` : ''}.`,
    dokumentyBrak: 'Your team account follows the terms agreed with your administrator.',
    dokumentyNowa: 'There is a new version of the terms.',
    zaakceptujNowa: 'Read and accept',
    regulamin: 'Terms of Service',
    polityka: 'Privacy Policy',
    sekcjaUsun: 'Delete account',
    usunOpis: 'We will delete your account, knowledge base and business details. Your subscription will be cancelled right away (refunds: as set out in the Terms).',
    usunZespol: 'This account belongs to a team, so your administrator deletes it.',
    usunOperator: 'This is the server administrator account. It is deleted with a command on the server once there is another administrator.',
    usunPrzejdz: 'Delete account',
    wroc: 'Back to the app',
    bramaHasla: 'Sign-in and passwords are handled by an authentication gateway.',
    usunTytul: 'Delete account · Content AI',
    usunNaglowek: 'Delete your account for good?',
    usunCo: (e) => `We will delete the account ${e}, its knowledge base and business details.`,
    usunSubskrypcja: 'Your subscription will be cancelled right away (refunds: as set out in the Terms).',
    usunPrzegladarka: 'We will also clear Content AI data in this browser: article history and saved keys. To keep your history, export it in the app first.',
    usunStripe: 'Stripe keeps payment confirmations for as long as the law requires.',
    usunNajpierw: 'Before you delete the account, you can download your data:',
    usunHaslo: 'Password, to confirm',
    usunRozumiem: 'I understand that deleting the account cannot be undone.',
    usunPrzycisk: 'Delete account for good',
    anuluj: 'Cancel',
    usunNieTytul: 'Deleting the account · Content AI',
    usunNieNaglowek: 'Deleting the account',
    zegnajTytul: 'Account deleted · Content AI',
    zegnajNaglowek: 'Account deleted',
    zegnajCo: (e) => `We have deleted the account ${e}, its knowledge base and business details.`,
    zegnajOgolne: 'Your account, knowledge base and business details have been deleted.',
    zegnajSubskrypcja: 'Your subscription is cancelled.',
    zegnajPrzegladarka: 'We have also cleared Content AI data in this browser. On other devices, clear it in your browser settings.',
    zegnajStrona: 'Back to content-ai.net',
    zgodyTytul: 'Terms · Content AI',
    zgodyNaglowek: 'New version of the terms',
    zgodyTekst: (w) => `We have changed the Terms of Service (version ${w}). Read them and accept them to keep using Content AI.`,
    zgodyPole: (w, a) => `I accept version ${w} of the Content AI <a href="${a}" target="_blank" rel="noopener">Terms of Service</a>.`,
    zgodyPrzycisk: 'Save acceptance',
    zgodyAktualne: (w) => `You have accepted the current version of the terms (${w}).`,
    ekrany: {
      'obce-zrodlo': ['Form rejected', 'The form did not come from this site. Refresh the page and try again.'],
      'za-duzo-prob': ['Too many attempts', 'Too many attempts in a short time. Try again in a few minutes.'],
      csrf: ['The form has expired', 'Refresh the account page and try again.'],
      'nie-znaleziono': ['Page not found', 'Check the address or go back to the app.'],
      niedostepne: ['Not available on this server', 'This feature is not enabled on this server.'],
      zajety: ['The server is busy', 'The server is busy right now. Please try again in a moment.'],
      'anulowanie-blad': ['We could not cancel your subscription', 'The payment provider is not responding, so we did not delete the account: you would keep paying. Please try again in a few minutes.'],
      'wysylka-blad': ['We could not send the message', 'Please try again in a moment.'],
    },
    zaloguj: 'Sign in',
    wrocDoKonta: 'Back to the account',
  },
};

function teksty(jezyk) {
  return T[jezyk === 'en' ? 'en' : 'pl'];
}

// Dodatkowy CSS ekranow kont (tokeny z logowanie.STYL, bez wlasnych kolorow).
const STYL_KONT = `
.pole-blad{display:flex;gap:6px;align-items:flex-start;margin:6px 0 0;color:var(--c-blad);font-size:13px;line-height:1.45}
.podpowiedz{margin:6px 0 0;color:var(--c-tekst-3);font-size:13px;line-height:1.45}
.pole-wyboru{margin:0 0 14px}
.zgoda{display:flex;gap:12px;align-items:flex-start;min-height:44px;margin:0;font:400 14px/1.45 var(--f-ui);color:var(--c-tekst-2);cursor:pointer}
.zgoda input{flex:none;width:22px;height:22px;margin:1px 0 0;padding:0;border-radius:4px;accent-color:var(--c-akcent)}
.zgoda input[aria-invalid="true"]{outline:2px solid var(--c-blad);outline-offset:2px}
.zgoda a{font-weight:600}
.pulapka{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.maly{margin:14px 0 0;color:var(--c-tekst-3);font-size:13px;line-height:1.5}
.adres{overflow-wrap:anywhere;color:var(--c-tekst);font-weight:600}
.komunikat.ok{border-color:var(--c-info-ramka);background:var(--c-info-tlo);color:var(--c-info)}
.sekcja{margin:28px 0 0;padding-top:20px;border-top:1px solid var(--c-linia)}
.sekcja h2{margin:0 0 8px;font:600 17px/1.3 var(--f-ui)}
.sekcja p{margin:0 0 10px;color:var(--c-tekst-2);font-size:14px;line-height:1.5}
.sekcja form{margin-top:12px}
.stan{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:var(--r-sm);font:600 12px/1.5 var(--f-ui);vertical-align:1px}
.stan-ok{background:var(--c-info-tlo);color:var(--c-info)}
.stan-uwaga{background:var(--c-akcent-tlo);color:var(--c-akcent-mocny)}
.zuzycie{margin:0 0 10px;padding:0;list-style:none}
.zuzycie li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--c-linia);font-size:14px;color:var(--c-tekst-2)}
.zuzycie b{color:var(--c-tekst);font-weight:600}
.przycisk-2{background:transparent;color:var(--c-tekst);border:1px solid var(--c-linia-2)}
.przycisk-2:hover{background:transparent;border-color:var(--c-ramka)}
.przycisk-2:active{background:transparent}
.przycisk-grozny{background:var(--c-blad);color:var(--c-tlo)}
.przycisk-grozny:hover,.przycisk-grozny:active{background:var(--c-blad);filter:brightness(1.08)}
.lista{margin:0 0 16px;padding-left:20px;color:var(--c-tekst-2);font-size:14px;line-height:1.5}
.lista li{margin:0 0 6px}
.odnosniki{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0 0 10px}
.odnosniki a{display:inline-flex;align-items:center;min-height:44px;font-size:14px;font-weight:600}
`;

const IKONA_OK = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';

/** Komunikat ogolny w aria-live: { rodzaj: 'blad'|'info'|'ok', tekst } albo null (pusty kontener zostaje). */
function komunikatHtml(k) {
  if (!k || !k.tekst) return '<p class="komunikat" id="komunikat" role="status" aria-live="polite"></p>';
  const blad = k.rodzaj === 'blad';
  const klasa = blad ? '' : (k.rodzaj === 'ok' ? ' ok' : ' info');
  const ikona = blad ? logowanie.IKONA_BLEDU : (k.rodzaj === 'ok' ? IKONA_OK : logowanie.IKONA_INFO);
  return `<p class="komunikat${klasa}" id="komunikat" role="${blad ? 'alert' : 'status'}" aria-live="${blad ? 'assertive' : 'polite'}">${ikona}<span>${esc(k.tekst)}</span></p>`;
}

/** Pole tekstowe z etykieta, podpowiedzia i bledem (aria-describedby wskazuje oba). */
function pole({ id, nazwa, etykieta, typ = 'text', wartosc = '', autocomplete, podpowiedz, blad, maxlength, autofocus, dodatkowe = '' }) {
  const opis = [podpowiedz ? `${id}-p` : '', blad ? `${id}-b` : ''].filter(Boolean).join(' ');
  return `<div class="pole">
          <label for="${id}">${esc(etykieta)}</label>
          <input id="${id}" name="${nazwa || id}" type="${typ}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${maxlength ? ` maxlength="${maxlength}"` : ''}`
    + `${wartosc ? ` value="${esc(wartosc)}"` : ''}${autofocus ? ' autofocus' : ''}${blad ? ' aria-invalid="true"' : ''}${opis ? ` aria-describedby="${opis}"` : ''}${dodatkowe}>`
    + `${podpowiedz ? `\n          <p class="podpowiedz" id="${id}-p">${akapit(podpowiedz)}</p>` : ''}`
    + `${blad ? `\n          <p class="pole-blad" id="${id}-b">${esc(blad)}</p>` : ''}
        </div>`;
}

/** Pole wyboru (zgoda): tresc to zaufany HTML zlozony z escapowanych czesci i naszych odnosnikow. */
function poleWyboru({ id, nazwa, trescHtml, blad, zaznaczone }) {
  return `<div class="pole-wyboru">
          <label class="zgoda" for="${id}"><input type="checkbox" id="${id}" name="${nazwa || id}" value="1"${zaznaczone ? ' checked' : ''}`
    + `${blad ? ` aria-invalid="true" aria-describedby="${id}-b"` : ''}><span>${trescHtml}</span></label>`
    + `${blad ? `\n          <p class="pole-blad" id="${id}-b">${esc(blad)}</p>` : ''}
        </div>`;
}

function ukryte(nazwa, wartosc) {
  return `<input type="hidden" name="${nazwa}" value="${esc(wartosc)}">`;
}

function przycisk(tekst, klasa = '') {
  return `<button type="submit"${klasa ? ` class="${klasa}"` : ''}>${esc(tekst)}${klasa ? '' : logowanie.STRZALKA}</button>`;
}

/** Tekst bledu pola z kodu (funkcja dostaje minimalna i maksymalna dlugosc hasla). */
function tekstBledu(tk, kod, min, max) {
  if (!kod) return '';
  const w = tk.bledy[kod];
  if (typeof w === 'function') return w(min, max);
  return w || kod;
}

/** Komunikat ogolny z kodu: { kod, rodzaj, wartosc } -> { rodzaj, tekst }. */
function komunikatZKodu(tk, k) {
  if (!k || !k.kod) return null;
  const w = tk.komunikaty[k.kod];
  const tekst = typeof w === 'function' ? w(k.wartosc) : (w || '');
  return tekst ? { rodzaj: k.rodzaj || 'blad', tekst } : null;
}

function strona(jezyk, tytul, srodek, opcje = {}) {
  const t = logowanie.teksty(jezyk);
  return logowanie.szkielet(t, tytul, srodek, { styl: STYL_KONT, ...opcje });
}

// ─── Rejestracja (R1) i "Sprawdz skrzynke" (R2) ──────────────────────────────

/**
 * ekranRejestracji({ jezyk, email, bledy: { email, haslo, regulamin, wiek }, komunikat: { kod, rodzaj, wartosc },
 *   znacznik, pakiet, nazwaPakietu, doPlatnosci, darmowe, adresy: { regulamin, polityka, logowanie },
 *   administrator, hasloMin, hasloMax, turnstile: { klucz } | null, przelacznikHref, zaznaczone: { regulamin, wiek } })
 */
function ekranRejestracji(o = {}) {
  const jezyk = o.jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const bledy = o.bledy || {};
  const min = o.hasloMin || 10;
  const max = o.hasloMax || 256;
  const adresy = o.adresy || {};
  const wstep = o.pakiet && o.doPlatnosci ? tk.rejWstepPakiet(o.nazwaPakietu || o.pakiet)
    : (o.darmowe ? tk.rejWstep(o.darmowe) : tk.rejWstepOgolny);
  const turnstile = o.turnstile && o.turnstile.klucz
    ? `\n        <div class="pole cf-turnstile" data-sitekey="${esc(o.turnstile.klucz)}" data-language="${jezyk}"></div>` : '';
  const srodek = `      <h1>${esc(tk.rejNaglowek)}</h1>
      <p class="wstep">${akapit(wstep)}</p>
      ${komunikatHtml(komunikatZKodu(tk, o.komunikat))}
      <form method="POST" action="/rejestracja" novalidate>
        ${ukryte('jezyk', jezyk)}
        ${ukryte('t', o.znacznik || '')}
        ${o.pakiet ? ukryte('pakiet', o.pakiet) : ''}
        <div class="pulapka" aria-hidden="true"><label for="strona">${esc(tk.pulapka)}</label><input id="strona" name="strona" type="text" tabindex="-1" autocomplete="off"></div>
        ${pole({ id: 'email', etykieta: tk.email, typ: 'email', wartosc: o.email, autocomplete: 'email', maxlength: 254, blad: tekstBledu(tk, bledy.email, min, max), autofocus: !o.email || Boolean(bledy.email), dodatkowe: ' autocapitalize="none" spellcheck="false"' })}
        ${pole({ id: 'haslo', etykieta: tk.haslo, typ: 'password', autocomplete: 'new-password', maxlength: max, podpowiedz: tk.hasloPodpowiedz(min), blad: tekstBledu(tk, bledy.haslo, min, max), autofocus: Boolean(o.email) && !bledy.email })}
        ${poleWyboru({ id: 'zgoda_regulamin', trescHtml: tk.zgodaRegulamin(esc(adresy.regulamin || '/dokumenty/regulamin')), blad: tekstBledu(tk, bledy.regulamin), zaznaczone: o.zaznaczone && o.zaznaczone.regulamin })}
        ${poleWyboru({ id: 'zgoda_wiek', trescHtml: esc(tk.zgodaWiek), blad: tekstBledu(tk, bledy.wiek), zaznaczone: o.zaznaczone && o.zaznaczone.wiek })}${turnstile}
        ${przycisk(tk.rejPrzycisk)}
      </form>
      <p class="maly">${o.administrator ? tk.administrator(esc(o.administrator), esc(adresy.polityka || '/dokumenty/prywatnosc')) : tk.administratorBezNazwy(esc(adresy.polityka || '/dokumenty/prywatnosc'))}</p>
      <p class="maly">${akapit(tk.informacjaAi)}</p>
      <p class="dostep">${esc(tk.maszKonto)} <a href="${esc(adresy.logowanie || '/')}">${esc(tk.zalogujSie)}</a></p>`;
  const glowa = o.turnstile && o.turnstile.klucz
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '';
  return strona(jezyk, tk.rejTytul, srodek, {
    kroki: tk.kroki(o.darmowe), stopka: tk.stopka, przelacznikHref: o.przelacznikHref, glowa,
  });
}

/** "Sprawdz skrzynke" po rejestracji (albo udawany sukces przy polu-pulapce, bez adresu). */
function ekranSprawdzPoczty({ jezyk = 'pl', email = '', godzin = 48, przelacznikHref, adresLogowania = '/' } = {}) {
  const tk = teksty(jezyk);
  const tresc = email ? tk.pocztaTekst(email, godzin) : tk.pocztaOgolna;
  const srodek = `      <h1>${esc(tk.pocztaNaglowek)}</h1>
      <p class="wstep">${akapit(tresc)}</p>
      <p class="maly">${akapit(tk.pocztaBrak)}</p>
      <p class="dostep">${esc(tk.maszKonto)} <a href="${esc(adresLogowania)}">${esc(tk.zalogujSie)}</a></p>`;
  return strona(jezyk, tk.pocztaTytul, srodek, { kroki: tk.kroki(null), stopka: tk.stopka, przelacznikHref });
}

// ─── Potwierdzenie e-maila (R3) ──────────────────────────────────────────────

/**
 * ekranPotwierdzenia({ jezyk, stan: 'formularz'|'potwierdzony'|'juz'|'niewazny'|'zajety',
 *   rodzaj: 'potwierdzenie'|'zmiana-email', email, token, zalogowany, csrf, przelacznikHref })
 */
function ekranPotwierdzenia(o = {}) {
  const jezyk = o.jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const nowy = o.rodzaj === 'zmiana-email';
  const doAplikacji = `<a class="wtorny" href="/?lang=${jezyk}">${esc(o.zalogowany ? tk.przejdzDoAplikacji : tk.zaloguj)}</a>`;
  let srodek;
  if (o.stan === 'formularz') {
    srodek = `      <h1>${esc(nowy ? tk.potwNaglowekNowy : tk.potwNaglowek)}</h1>
      <p class="wstep">${akapit((nowy ? tk.potwKontoNowy : tk.potwKonto)(o.email || ''))}</p>
      <form method="POST" action="/potwierdz">
        ${ukryte('jezyk', jezyk)}
        ${ukryte('t', o.token || '')}
        ${przycisk(tk.potwPrzycisk)}
      </form>
      <p class="maly">${akapit(tk.potwDlaczego)}</p>`;
  } else if (o.stan === 'potwierdzony') {
    srodek = `      <h1>${esc(nowy ? tk.potwOkNowyNaglowek : tk.potwOkNaglowek)}</h1>
      <p class="wstep">${akapit(nowy ? tk.potwOkNowyTekst(o.email || '') : tk.potwOkTekst)}</p>
      ${doAplikacji}`;
  } else if (o.stan === 'juz') {
    srodek = `      <h1>${esc(tk.potwJuzNaglowek)}</h1>
      <p class="wstep">${akapit(tk.potwJuzTekst)}</p>
      ${doAplikacji}`;
  } else if (o.stan === 'zajety') {
    srodek = `      <h1>${esc(tk.potwZajetyNaglowek)}</h1>
      <p class="wstep">${akapit(tk.potwZajetyTekst)}</p>
      <a class="wtorny" href="/konto?lang=${jezyk}">${esc(tk.wrocDoKonta)}</a>`;
  } else {
    const ponow = o.zalogowany && o.csrf
      ? `<form method="POST" action="/konto/potwierdzenie">
        ${ukryte('csrf', o.csrf)}
        ${przycisk(tk.wyslijNowyLink)}
      </form>`
      : doAplikacji;
    srodek = `      <h1>${esc(tk.potwZlyNaglowek)}</h1>
      <p class="wstep">${akapit(o.zalogowany ? tk.potwZlyTekstZalogowany : tk.potwZlyTekst)}</p>
      ${ponow}`;
  }
  return strona(jezyk, tk.potwTytul, srodek, { stopka: o.stopka, przelacznikHref: o.przelacznikHref });
}

// ─── Reset hasla (R5, R6) ────────────────────────────────────────────────────

/**
 * ekranResetu({ jezyk, stan: 'formularz'|'wyslano'|'niedostepny', email, blad, komunikat, minut,
 *   kontakt, turnstile: { klucz } | null, przelacznikHref })
 */
function ekranResetu(o = {}) {
  const jezyk = o.jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const wroc = `<p class="dostep"><a href="/?lang=${jezyk}">${esc(tk.wrocDoLogowania)}</a></p>`;
  let srodek;
  if (o.stan === 'wyslano') {
    srodek = `      <h1>${esc(tk.pocztaNaglowek)}</h1>
      <p class="wstep">${akapit(tk.resetWyslano(o.email || '', o.minut || 60))}</p>
      <p class="maly">${akapit(tk.pocztaBrak)}</p>
      ${wroc}`;
  } else if (o.stan === 'niedostepny') {
    srodek = `      <h1>${esc(tk.resetNaglowek)}</h1>
      <p class="wstep">${akapit(o.kontakt ? tk.resetNiedostepnyKontakt(o.kontakt) : tk.resetNiedostepny)}</p>
      ${wroc}`;
  } else {
    const turnstile = o.turnstile && o.turnstile.klucz
      ? `\n        <div class="pole cf-turnstile" data-sitekey="${esc(o.turnstile.klucz)}" data-language="${jezyk}"></div>` : '';
    srodek = `      <h1>${esc(tk.resetNaglowek)}</h1>
      <p class="wstep">${akapit(tk.resetWstep)}</p>
      ${komunikatHtml(komunikatZKodu(tk, o.komunikat))}
      <form method="POST" action="/haslo" novalidate>
        ${ukryte('jezyk', jezyk)}
        ${pole({ id: 'email', etykieta: tk.email, typ: 'email', wartosc: o.email, autocomplete: 'email', maxlength: 254, blad: tekstBledu(tk, o.blad), autofocus: true, dodatkowe: ' autocapitalize="none" spellcheck="false"' })}${turnstile}
        ${przycisk(tk.resetPrzycisk)}
      </form>
      <p class="maly">${akapit(tk.resetZespol)}</p>
      ${wroc}`;
  }
  const glowa = o.stan === 'formularz' && o.turnstile && o.turnstile.klucz
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : '';
  return strona(jezyk, tk.resetTytul, srodek, { przelacznikHref: o.przelacznikHref, glowa, stopka: o.stopka });
}

/** ekranNowegoHasla({ jezyk, stan: 'formularz'|'niewazny', token, email, blad, komunikat, hasloMin, hasloMax, przelacznikHref }) */
function ekranNowegoHasla(o = {}) {
  const jezyk = o.jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const min = o.hasloMin || 10;
  const max = o.hasloMax || 256;
  let srodek;
  if (o.stan === 'formularz') {
    srodek = `      <h1>${esc(tk.noweNaglowek)}</h1>
      <p class="wstep">${akapit(tk.noweKonto(o.email || ''))}</p>
      ${komunikatHtml(komunikatZKodu(tk, o.komunikat))}
      <form method="POST" action="/haslo/nowe" novalidate>
        ${ukryte('jezyk', jezyk)}
        ${ukryte('t', o.token || '')}
        <input type="hidden" name="email" autocomplete="username" value="${esc(o.email || '')}">
        ${pole({ id: 'haslo', etykieta: tk.noweHaslo, typ: 'password', autocomplete: 'new-password', maxlength: max, podpowiedz: tk.nowePodpowiedz(min), blad: tekstBledu(tk, o.blad, min, max), autofocus: true })}
        ${przycisk(tk.nowePrzycisk)}
      </form>
      <p class="maly">${akapit(tk.noweUwaga)}</p>`;
  } else {
    srodek = `      <h1>${esc(tk.potwZlyNaglowek)}</h1>
      <p class="wstep">${akapit(tk.noweZlyTekst)}</p>
      <a class="wtorny" href="/haslo?lang=${jezyk}">${esc(tk.wyslijNowyLink)}</a>`;
  }
  return strona(jezyk, tk.noweTytul, srodek, { przelacznikHref: o.przelacznikHref, stopka: o.stopka });
}

// ─── Konto ───────────────────────────────────────────────────────────────────

/**
 * ekranKonta({ jezyk, dane }) - dane sklada konta.js (bez hash i sol):
 *   { naglowek: e-mail albo login, utworzonyMs, zespolowe, email, emailPotwierdzony, emailNowy,
 *     csrf, komunikat: { kod, rodzaj, wartosc }, bledy: { pole: kod }, hasloMin, hasloMax,
 *     mozliwosci: { email, haslo, sesje, usun: 'tak'|'zespol'|'operator'|'brama' },
 *     pakiet: { nazwa, uzycie: [{ czynnosc, limit, zuzyte }], zespolu },
 *     sekcjaPlatnosci (HTML od B albo ''), adresZakupu, zgody: { wersja, czas, wymagaAkceptacji, dotyczy },
 *     adresy: { regulamin, polityka }, brama }
 */
function ekranKonta({ jezyk = 'pl', dane = {} } = {}) {
  jezyk = jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const d = dane;
  const bledy = d.bledy || {};
  const min = d.hasloMin || 10;
  const max = d.hasloMax || 256;
  const mozliwosci = d.mozliwosci || {};
  const csrf = ukryte('csrf', d.csrf || '');
  const podtytul = [d.zespolowe ? tk.kontoZespolu : '', d.utworzonyMs ? tk.kontoOd(data(d.utworzonyMs, jezyk)) : ''].filter(Boolean).join(' · ');
  const sekcje = [];

  // E-mail: stan potwierdzenia, ponowienie, zmiana albo dodanie adresu.
  {
    const czesci = [`<section class="sekcja" aria-labelledby="s-email"><h2 id="s-email">${esc(tk.sekcjaEmail)}</h2>`];
    if (d.email) {
      czesci.push(`<p><span class="adres">${esc(d.email)}</span><span class="stan ${d.emailPotwierdzony ? 'stan-ok' : 'stan-uwaga'}">${esc(d.emailPotwierdzony ? tk.emailPotwierdzony : tk.emailNiepotwierdzony)}</span></p>`);
      if (!d.emailPotwierdzony) {
        czesci.push(`<p>${akapit(tk.emailNiepotwierdzonyOpis)}</p>`);
        if (mozliwosci.email) {
          czesci.push(`<form method="POST" action="/konto/potwierdzenie">${csrf}${przycisk(tk.wyslijPonownie, 'przycisk-2')}</form>`);
        }
      }
    } else {
      czesci.push(`<p>${akapit(tk.emailBrak)}</p>`);
    }
    if (d.emailNowy) czesci.push(`<p>${akapit(tk.emailCzeka(d.emailNowy))}</p>`);
    if (mozliwosci.email && (!d.email || d.emailPotwierdzony)) {
      czesci.push(`<form method="POST" action="/konto/email" novalidate>
        ${csrf}
        ${pole({ id: 'nowy', etykieta: tk.nowyEmail, typ: 'email', autocomplete: 'email', maxlength: 254, wartosc: d.wpisanyEmail, blad: tekstBledu(tk, bledy.nowy), dodatkowe: ' autocapitalize="none" spellcheck="false"' })}
        ${pole({ id: 'haslo-email', nazwa: 'haslo', etykieta: tk.hasloObecne, typ: 'password', autocomplete: 'current-password', blad: tekstBledu(tk, bledy.hasloEmail, min, max) })}
        ${przycisk(d.email ? tk.zmienEmail : tk.dodajEmail, 'przycisk-2')}
      </form>
      <p class="maly">${akapit(tk.zmienEmailUwaga)}</p>`);
    }
    czesci.push('</section>');
    sekcje.push(czesci.join('\n      '));
  }

  // Haslo.
  if (mozliwosci.haslo) {
    sekcje.push(`<section class="sekcja" aria-labelledby="s-haslo"><h2 id="s-haslo">${esc(tk.sekcjaHaslo)}</h2>
      <form method="POST" action="/konto/haslo" novalidate>
        ${csrf}
        <input type="hidden" name="login" autocomplete="username" value="${esc(d.email || d.naglowek || '')}">
        ${pole({ id: 'stare', etykieta: tk.hasloStare, typ: 'password', autocomplete: 'current-password', blad: tekstBledu(tk, bledy.stare, min, max) })}
        ${pole({ id: 'nowe', etykieta: tk.hasloNowe, typ: 'password', autocomplete: 'new-password', maxlength: max, podpowiedz: tk.nowePodpowiedz(min), blad: tekstBledu(tk, bledy.nowe, min, max) })}
        ${przycisk(tk.zmienHaslo, 'przycisk-2')}
      </form>
      <p class="maly">${akapit(tk.hasloUwaga)}</p></section>`);
  } else if (d.brama) {
    sekcje.push(`<section class="sekcja" aria-labelledby="s-haslo"><h2 id="s-haslo">${esc(tk.sekcjaHaslo)}</h2>
      <p>${akapit(tk.bramaHasla)}</p></section>`);
  }

  // Pakiet: nazwa, zuzycie, sekcja platnosci (B) albo odnosnik do zakupu.
  {
    const p = d.pakiet || {};
    const wiersze = (p.uzycie || []).map((u) => `<li><span>${esc(tk.czynnosci[u.czynnosc] || u.czynnosc)}</span><b>${esc(u.limit === null || u.limit === undefined ? tk.pakietBezLimitu : tk.zuzycie(u.zuzyte || 0, u.limit))}</b></li>`).join('');
    sekcje.push(`<section class="sekcja" aria-labelledby="s-pakiet"><h2 id="s-pakiet">${esc(tk.sekcjaPakiet)}</h2>
      <p>${esc(tk.pakietNazwa(p.nazwa || ''))}</p>
      ${wiersze ? `<ul class="zuzycie">${wiersze}</ul>` : ''}
      ${p.zespolu ? `<p>${akapit(tk.pakietZespolu)}</p>` : ''}${d.sekcjaPlatnosci || ''}
      ${!d.sekcjaPlatnosci && d.adresZakupu ? `<div class="odnosniki"><a href="${esc(d.adresZakupu)}">${esc(tk.pakietyIPlatnosci)}</a></div>` : ''}</section>`);
  }

  // Urzadzenia: wyloguj wszedzie.
  if (mozliwosci.sesje) {
    sekcje.push(`<section class="sekcja" aria-labelledby="s-sesje"><h2 id="s-sesje">${esc(tk.sekcjaSesje)}</h2>
      <p>${akapit(tk.sesjeOpis)}</p>
      <form method="POST" action="/konto/wyloguj-wszedzie">${csrf}${przycisk(tk.wylogujWszedzie, 'przycisk-2')}</form></section>`);
  }

  // Dane: eksport.
  sekcje.push(`<section class="sekcja" aria-labelledby="s-dane"><h2 id="s-dane">${esc(tk.sekcjaDane)}</h2>
      <p>${akapit(tk.daneOpis)}</p>
      <div class="odnosniki"><a href="/konto/eksport" download>${esc(tk.pobierzDane)}</a></div>
      <p class="maly">${akapit(tk.daneHistoria)}</p></section>`);

  // Regulamin i prywatnosc.
  {
    const z = d.zgody || {};
    const adresy = d.adresy || {};
    const stan = !z.dotyczy ? tk.dokumentyBrak
      : (z.wersja ? tk.dokumentyWersja(z.wersja, data(z.czas, jezyk)) : '');
    sekcje.push(`<section class="sekcja" aria-labelledby="s-dok"><h2 id="s-dok">${esc(tk.sekcjaDokumenty)}</h2>
      ${stan ? `<p>${akapit(stan)}</p>` : ''}
      ${z.wymagaAkceptacji ? `<p>${esc(tk.dokumentyNowa)}</p><div class="odnosniki"><a href="/konto/zgody?lang=${jezyk}">${esc(tk.zaakceptujNowa)}</a></div>` : ''}
      <div class="odnosniki"><a href="${esc(adresy.regulamin || '/dokumenty/regulamin')}">${esc(tk.regulamin)}</a><a href="${esc(adresy.polityka || '/dokumenty/prywatnosc')}">${esc(tk.polityka)}</a></div></section>`);
  }

  // Usuniecie konta.
  {
    const u = mozliwosci.usun;
    const tresc = u === 'tak'
      ? `<p>${akapit(tk.usunOpis)}</p>\n      <div class="odnosniki"><a href="/konto/usun?lang=${jezyk}">${esc(tk.usunPrzejdz)}</a></div>`
      : `<p>${akapit(u === 'operator' ? tk.usunOperator : (u === 'brama' ? tk.bramaHasla : tk.usunZespol))}</p>`;
    sekcje.push(`<section class="sekcja" aria-labelledby="s-usun"><h2 id="s-usun">${esc(tk.sekcjaUsun)}</h2>
      ${tresc}</section>`);
  }

  const srodek = `      <h1>${esc(tk.kontoNaglowek)}</h1>
      <p class="wstep"><span class="adres">${esc(d.naglowek || '')}</span>${podtytul ? ` · ${esc(podtytul)}` : ''}</p>
      ${komunikatHtml(komunikatZKodu(tk, d.komunikat))}
      ${sekcje.join('\n      ')}
      <a class="wtorny" href="/">${esc(tk.wroc)}</a>`;
  return strona(jezyk, tk.kontoTytul, srodek, { przelacznikHref: `/konto?lang=${jezyk === 'en' ? 'pl' : 'en'}`, stopka: d.stopka });
}

/**
 * ekranUsuniecia({ jezyk, dane: { email, naglowek, mozna: 'tak'|'zespol'|'operator'|'brama', subskrypcja (bool),
 *   csrf, bledy: { haslo, rozumiem }, rozumiem } })
 */
function ekranUsuniecia({ jezyk = 'pl', dane = {} } = {}) {
  jezyk = jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const d = dane;
  const bledy = d.bledy || {};
  if (d.mozna !== 'tak') {
    const srodek = `      <h1>${esc(tk.usunNieNaglowek)}</h1>
      <p class="wstep">${akapit(d.mozna === 'operator' ? tk.usunOperator : (d.mozna === 'brama' ? tk.bramaHasla : tk.usunZespol))}</p>
      <a class="wtorny" href="/konto?lang=${jezyk}">${esc(tk.wrocDoKonta)}</a>`;
    return strona(jezyk, tk.usunNieTytul, srodek, { przelacznik: false, stopka: d.stopka });
  }
  const punkty = [tk.usunCo(d.email || d.naglowek || ''), d.subskrypcja ? tk.usunSubskrypcja : '', tk.usunPrzegladarka, tk.usunStripe]
    .filter(Boolean).map((p) => `<li>${akapit(p)}</li>`).join('');
  const srodek = `      <h1>${esc(tk.usunNaglowek)}</h1>
      <ul class="lista">${punkty}</ul>
      <p class="maly">${esc(tk.usunNajpierw)}</p>
      <div class="odnosniki"><a href="/konto/eksport" download>${esc(tk.pobierzDane)}</a></div>
      ${komunikatHtml(komunikatZKodu(tk, d.komunikat))}
      <form method="POST" action="/konto/usun" novalidate>
        ${ukryte('csrf', d.csrf || '')}
        ${ukryte('jezyk', jezyk)}
        <input type="hidden" name="login" autocomplete="username" value="${esc(d.email || d.naglowek || '')}">
        ${pole({ id: 'haslo', etykieta: tk.usunHaslo, typ: 'password', autocomplete: 'current-password', blad: tekstBledu(tk, bledy.haslo), autofocus: true })}
        ${poleWyboru({ id: 'rozumiem', trescHtml: esc(tk.usunRozumiem), blad: tekstBledu(tk, bledy.rozumiem), zaznaczone: d.rozumiem })}
        ${przycisk(tk.usunPrzycisk, 'przycisk-grozny')}
      </form>
      <a class="wtorny" href="/konto?lang=${jezyk}">${esc(tk.anuluj)}</a>`;
  return strona(jezyk, tk.usunTytul, srodek, { przelacznik: false, stopka: d.stopka });
}

/** Ekran po usunieciu konta (R7): odpowiedz z Clear-Site-Data, wiec tez bez przelacznika jezyka. */
function ekranPozegnania({ jezyk = 'pl', email = '', subskrypcja = false, stopka } = {}) {
  const tk = teksty(jezyk);
  const srodek = `      <h1>${esc(tk.zegnajNaglowek)}</h1>
      <p class="wstep">${akapit(email ? tk.zegnajCo(email) : tk.zegnajOgolne)}${subskrypcja ? ` ${akapit(tk.zegnajSubskrypcja)}` : ''}</p>
      <p class="maly">${akapit(tk.usunStripe)}</p>
      <p class="maly">${akapit(tk.zegnajPrzegladarka)}</p>
      <p class="dostep"><a href="${jezyk === 'en' ? 'https://content-ai.net/en/' : 'https://content-ai.net/'}">${esc(tk.zegnajStrona)}</a></p>`;
  return strona(jezyk, tk.zegnajTytul, srodek, { przelacznik: false, stopka });
}

/** Akceptacja nowej wersji regulaminu: ekranZgody({ jezyk, wersja, adres, csrf, blad, aktualne, stopka }) */
function ekranZgody({ jezyk = 'pl', wersja = '', adres = '/dokumenty/regulamin', csrf = '', blad = '', aktualne = false, stopka } = {}) {
  jezyk = jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const srodek = aktualne
    ? `      <h1>${esc(tk.regulamin)}</h1>
      <p class="wstep">${akapit(tk.zgodyAktualne(wersja))}</p>
      <a class="wtorny" href="/">${esc(tk.wroc)}</a>`
    : `      <h1>${esc(tk.zgodyNaglowek)}</h1>
      <p class="wstep">${akapit(tk.zgodyTekst(wersja))}</p>
      ${komunikatHtml(blad ? { rodzaj: 'blad', tekst: tk.komunikaty['popraw-pola'] } : null)}
      <form method="POST" action="/konto/zgody" novalidate>
        ${ukryte('csrf', csrf)}
        ${ukryte('regulamin', wersja)}
        ${poleWyboru({ id: 'akceptuje', trescHtml: tk.zgodyPole(esc(wersja), esc(adres)), blad: blad ? tekstBledu(tk, 'zgoda') : '' })}
        ${przycisk(tk.zgodyPrzycisk)}
      </form>
      <a class="wtorny" href="/">${esc(tk.wroc)}</a>`;
  return strona(jezyk, tk.zgodyTytul, srodek, { przelacznik: false, stopka });
}

/** Ekran komunikatu: ekranKomunikatu({ jezyk, kod, odnosnik: { href, tekst }, stopka }) z kodow T.ekrany. */
function ekranKomunikatu({ jezyk = 'pl', kod = 'nie-znaleziono', odnosnik, stopka } = {}) {
  jezyk = jezyk === 'en' ? 'en' : 'pl';
  const tk = teksty(jezyk);
  const [tytul, tekst] = tk.ekrany[kod] || tk.ekrany['nie-znaleziono'];
  const link = odnosnik || { href: '/', tekst: tk.wroc };
  const srodek = `      <h1>${esc(tytul)}</h1>
      <p class="wstep">${akapit(tekst)}</p>
      <a class="wtorny" href="${esc(link.href)}">${esc(link.tekst)}</a>`;
  return strona(jezyk, `${tytul} · Content AI`, srodek, { przelacznik: false, stopka });
}

/** Zaslepka z etapu 0 (zostaje w kontrakcie): strona "jeszcze niedostepne". */
function ekranNiedostepny({ jezyk = 'pl' } = {}) {
  return ekranKomunikatu({ jezyk, kod: 'niedostepne' });
}

module.exports = {
  ekranRejestracji, ekranSprawdzPoczty, ekranPotwierdzenia, ekranResetu, ekranNowegoHasla, ekranKonta,
  ekranUsuniecia, ekranPozegnania, ekranZgody, ekranKomunikatu, ekranNiedostepny, teksty, odmiana, data, STYL_KONT,
};
