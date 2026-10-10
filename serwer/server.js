#!/usr/bin/env node
/**
 * Content AI - serwer aplikacji
 *
 * Robi trzy rzeczy:
 *  1. serwuje aplikacje (wariant proxy, z adresami API przepisanymi na wlasny serwer),
 *  2. pilnuje logowania - konta z rolami, hasla haszowane scryptem, sesje w cookie,
 *  3. posredniczy w wywolaniach API, dzieki czemu klucze nigdy nie trafiaja do przegladarki.
 *
 * Zero zaleznosci npm - tylko moduly wbudowane Node >= 22.13 (fetch, node:sqlite).
 *
 * Endpointy proxy odtwarzaja kontrakt app/worker.js, wiec aplikacja dziala bez zmian:
 *   POST /api               -> generowanie tresci
 *   POST /api/images        -> grafiki
 *   POST /api/tts           -> synteza mowy
 *   POST /api/transcribe    -> transkrypcja
 *   POST /api/eleven-tts    -> synteza ElevenLabs
 *
 * Wlasne endpointy serwera (poza kontraktem workera):
 *   POST /api/prosba-o-dostep -> formularz strony produktowej (bez logowania, CORS) - prosby.js
 *   GET  /api/admin/prosby    -> lista prosb o dostep (operator)
 *   POST /api/zadanie/anuluj  -> Przerwij dla zadania w tle (X-Zadanie) - zadania.js
 *   oraz /api/baza, /api/strona, /api/odnosniki, /api/marka, /api/pakiet, /api/seo/* - opis w README
 *
 * Runda 9 (konta samoobslugowe, platnosci, wlasne klucze): trasy nowych modulow
 * wola router w ustalonej kolejnosci (PROJEKT-TECHNICZNY 4.1); kazdy modul
 * eksportuje `async obsluz(sciezka, req, res, kontekst) -> true, gdy obsluzone`:
 *   konta.js (A1), platnosci.js (B), klucze.js (C), dokumenty-prawne.js (E).
 * Konta, liczniki, sesje odwolane, tokeny, zgody i platnosci leza w bazie
 * node:sqlite za jednym modulem serwer/magazyn.js (Node >= 22.13).
 *
 * Konfiguracja przez zmienne srodowiskowe - patrz serwer/README.md.
 */

'use strict';

const http = require('node:http');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const pliki = require('./pliki.js');
const prosby = require('./prosby.js');
const logowanie = require('./logowanie.js');
const serp = require('./serp.js');
const baza = require('./baza.js');
const openseo = require('./openseo.js');
const openseoMcp = require('./openseo-mcp.js');
const plany = require('./plany.js');
const strona = require('./strona.js');
const marka = require('./marka.js');
const zadaniaWTle = require('./zadania.js');
const magazyn = require('./magazyn.js');
const migracja = require('./migracja.js');
const bledy = require('./bledy.js');
const limity = require('./limity.js');
const dzierzawy = require('./dzierzawy.js');
const konta = require('./konta.js');
const klucze = require('./klucze.js');
const poczta = require('./poczta.js');
const platnosci = require('./platnosci.js');
const oznaczenia = require('./oznaczenia.js');
const dokumentyPrawne = require('./dokumenty-prawne.js');

const KATALOG = __dirname;
const APP = path.join(KATALOG, '..', 'app');
// Plik kont w formacie R8. Od rundy 9 czyta go tylko migracja przy starcie
// (serwer/migracja.js); po niej lezy jako uzytkownicy.json.zmigrowany-<czas>.
const PLIK_UZYTKOWNIKOW = process.env.CAI_UZYTKOWNICY || path.join(KATALOG, 'dane', 'uzytkownicy.json');
// Baza kont (SQLite) domyslnie obok pliku kont: serwer/dane/contentai.sqlite. Kto
// przeniosl konta zmienna CAI_UZYTKOWNICY, ma baze w tym samym katalogu.
const PLIK_BAZY = process.env.CAI_SQLITE || path.join(path.dirname(PLIK_UZYTKOWNIKOW), 'contentai.sqlite');

const KONF = {
  port: Number(process.env.PORT || 3100),
  host: process.env.CAI_HOST || '127.0.0.1',
  // Secure na cookie: wymagane, gdy serwer stoi za HTTPS (Caddy/nginx). Domyslnie wlaczone,
  // bo docelowo aplikacja stoi publicznie; do testow lokalnych ustaw CAI_COOKIE_SECURE=0.
  cookieSecure: process.env.CAI_COOKIE_SECURE !== '0',
  // Domena ciasteczka. Pusta = ciasteczko wazne tylko na biezacym hoscie.
  // Ustawiona na domene nadrzedna (np. .twojadomena.pl) sprawia, ze jedno
  // logowanie obejmuje i Content AI, i OpenSEO stojace pod poddomena.
  cookieDomena: process.env.CAI_COOKIE_DOMENA || '',
  sesjaGodzin: Number(process.env.CAI_SESJA_GODZIN || 24 * 14),

  // Logowanie przez zewnetrzna bramę (Authelia, Cloudflare Access, oauth2-proxy).
  // Pusta wartosc = wlasny ekran logowania, czyli stan domyslny. Podanie nazwy
  // naglowka przelacza serwer w tryb, w ktorym tozsamosc przychodzi z bramy -
  // wtedy 2FA, passkeys i SSO robi ona, a my tylko czytamy, kto przyszedl.
  // Szczegoly i uzasadnienie: serwer/README.md, sekcja "Logowanie przez bramę".
  zaufanyNaglowek: (process.env.CAI_ZAUFANY_NAGLOWEK || '').toLowerCase(),
  // Adresy, z ktorych wolno przyjac ten naglowek. Domyslnie tylko petla zwrotna,
  // bo brama stoi na tej samej maszynie. Bez tego kazdy, kto dosiegnie portu
  // bezposrednio, podszylby sie pod dowolne konto jednym naglowkiem.
  zaufaneAdresy: (process.env.CAI_ZAUFANE_ADRESY || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',').map((a) => a.trim()).filter(Boolean),

  // OpenSEO: osobny kontener, przed ktorym stoimy. Wlacza sie podaniem portu
  // nasluchu; wtedy serwer otwiera drugi port, wpuszcza na niego wylacznie
  // zalogowanych i dokleja do stron palete Content AI. Szczegoly: openseo.js.
  openseo: {
    portNasluchu: Number(process.env.CAI_OPENSEO_PORT || 0),
    host: process.env.CAI_OPENSEO_HOST || '127.0.0.1',
    port: Number(process.env.CAI_OPENSEO_UPSTREAM || 3001),
    // Publiczny adres, pod ktory prowadzi pozycja w menu aplikacji.
    adres: process.env.CAI_OPENSEO_ADRES || '',
  },

  // Dostawca tresci: 'anthropic' (domyslnie) albo 'nvidia' (modele open source przez NVIDIA NIM)
  dostawca: (process.env.CAI_DOSTAWCA || 'anthropic').toLowerCase(),
  modelNvidia: process.env.CAI_MODEL_NVIDIA || 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  // Model grafik OpenAI. Pusty = ten, ktory wysle aplikacja. Ustawiony = serwer podmienia model
  // w kazdym zapytaniu o grafike: dostawca wycofuje modele (gpt-image-1 konczy sie 23.10.2026),
  // a zmiana tutaj nie wymaga nowej wersji aplikacji, tylko restartu uslugi.
  modelGrafiki: (process.env.CAI_MODEL_GRAFIKI || '').trim(),
  urlNvidia: process.env.CAI_URL_NVIDIA || 'https://integrate.api.nvidia.com/v1/chat/completions',
  // Adresy pozostalych dostawcow. Domyslnie oficjalne API; nadpisanie sluzy
  // atrapie w testach calej aplikacji i bramom zgodnym z tym samym API.
  urlAnthropic: process.env.CAI_URL_ANTHROPIC || 'https://api.anthropic.com/v1/messages',
  urlOpenai: (process.env.CAI_URL_OPENAI || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  urlEleven: (process.env.CAI_URL_ELEVEN || 'https://api.elevenlabs.io/v1').replace(/\/+$/, ''),

  klucze: {
    anthropic: process.env.ANTHROPIC_KEY || '',
    openai: process.env.OPENAI_KEY || '',
    eleven: process.env.ELEVEN_KEY || '',
    nvidia: process.env.NVIDIA_KEY || '',
  },

  // Baza wiedzy: katalog na dokumenty i konfiguracja liczenia wektorow.
  // Bez klucza wyszukiwanie dziala na slowach kluczowych zamiast na znaczeniu.
  katalogBazy: process.env.CAI_BAZA || path.join(KATALOG, 'dane', 'baza'),
  // Liczniki uzycia pakietow - jeden plik JSON na konto.
  katalogUzycia: process.env.CAI_UZYCIE || path.join(KATALOG, 'dane', 'uzycie'),
  katalogMarki: process.env.CAI_MARKA || path.join(KATALOG, 'dane'),
  wektory: {
    klucz: process.env.NVIDIA_KEY || '',
    url: process.env.CAI_URL_EMBED || 'https://integrate.api.nvidia.com/v1/embeddings',
    model: process.env.CAI_MODEL_EMBED || 'nvidia/nv-embedqa-e5-v5',
  },

  // Zrodlo danych SERP: 'model' (model z web_search, tylko Anthropic),
  // 'dataforseo' (prosto z API) albo 'openseo' (przez kontener OpenSEO)
  serp: (process.env.CAI_SERP || 'model').toLowerCase(),
  // Projekt OpenSEO, w kontekscie ktorego pytamy o dane; narzedzia OpenSEO sa projektowe.
  seoProjekt: process.env.CAI_SEO_PROJEKT || '',
  dataForSeo: {
    login: process.env.DATAFORSEO_LOGIN || '',
    haslo: process.env.DATAFORSEO_HASLO || '',
  },

  // Limity czasu na wywolania dostawcow (ms). Bez nich zawieszony dostawca
  // trzymal zadanie do domyslnych limitow undici, a aplikacja krecila
  // spinnerem bez konca. Dlugie generowanie (artykul, wyszukiwanie w sieci,
  // duze max_tokens) ma osobny, dluzszy limit - nigdy krotszy niz 300 s.
  czasy: {
    tresc: liczbaMs(process.env.CAI_CZAS_TRESCI_MS, 120_000),
    dlugi: Math.max(300_000, liczbaMs(process.env.CAI_CZAS_DLUGI_MS, 600_000)),
    obrazy: liczbaMs(process.env.CAI_CZAS_OBRAZOW_MS, 240_000),
    audio: liczbaMs(process.env.CAI_CZAS_AUDIO_MS, 120_000),
    transkrypcja: liczbaMs(process.env.CAI_CZAS_TRANSKRYPCJI_MS, 300_000),
    serp: liczbaMs(process.env.CAI_CZAS_SERP_MS, 30_000),
    openseo: liczbaMs(process.env.CAI_CZAS_OPENSEO_MS, 120_000),
  },

  // Koszt: modele dozwolone na koncie serwera i sufit max_tokens. Lista modeli
  // to stale MODEL_* odczytane z samej aplikacji przy starcie (zmiana modelu
  // w aplikacji nie wymaga zmiany serwera) plus to, co dopisze CAI_MODELE.
  modeleDodatkowe: lista(process.env.CAI_MODELE),
  maxTokens: Number(process.env.CAI_MAX_TOKENS || 32000),
  // Rozmiary grafik: z IMG_FORMATS aplikacji, plus CAI_ROZMIARY_GRAFIK.
  rozmiaryDodatkowe: lista(process.env.CAI_ROZMIARY_GRAFIK),

  // Kompresja HTML/JS/CSS w Node. Za Caddy z `encode zstd gzip` mozna ja
  // wylaczyc (CAI_KOMPRESJA=0), zeby nie pakowac dwa razy.
  kompresja: process.env.CAI_KOMPRESJA !== '0',

  // Formularz "Popros o dostep" ze strony produktowej: skad wolno wysylac.
  // Domyslnie apex i www: gdyby www nie przekierowywalo (Caddy), formularz
  // z www dostawalby 403 bez CORS i pokazywal mylace "sprobuj za chwile".
  stronaOrigin: lista(process.env.CAI_STRONA_ORIGIN || 'https://content-ai.net,https://www.content-ai.net'),

  // ─── Runda 9: wszystkie zmienne z PROJEKT-TECHNICZNY rozdz. 6 ──────────────
  // Zasada: bez tych zmiennych serwer dziala dokladnie jak dzis. Funkcja z bledna
  // albo niepelna konfiguracja jest wylaczana (KONF.funkcje, sprawdzKonfiguracje),
  // z wpisem w dzienniku bez wartosci sekretow, a serwer startuje dla istniejacych kont.

  // Magazyn (serwer/magazyn.js): plik bazy i katalog kopii co godzine (48 ostatnich).
  sqlite: PLIK_BAZY,
  kopie: process.env.CAI_KOPIE || path.join(path.dirname(PLIK_BAZY), 'kopie'),

  // Konta samoobslugowe (wykonawca A1, konta.js i ekrany-kont.js).
  rejestracja: process.env.CAI_REJESTRACJA === '1',
  // Jedyne zrodlo adresow w e-mailach i adresow powrotu platnosci; nigdy naglowek Host.
  adresPubliczny: String(process.env.CAI_ADRES_PUBLICZNY || '').trim().replace(/\/+$/, ''),
  planNowych: String(process.env.CAI_PLAN_NOWYCH || 'darmowy').trim(),
  emailPotwierdzenieGodzin: liczba(process.env.CAI_EMAIL_POTWIERDZENIE_GODZIN, 48),
  resetMinut: liczba(process.env.CAI_RESET_MINUT, 60),
  resetAdmin: process.env.CAI_RESET_ADMIN === '1',
  niepotwierdzoneDni: liczba(process.env.CAI_NIEPOTWIERDZONE_DNI, 30),
  usuwanieStarych: process.env.CAI_USUWANIE_STARYCH === '1',
  regulaminWersja: String(process.env.CAI_REGULAMIN_WERSJA || '').trim(),
  politykaWersja: String(process.env.CAI_POLITYKA_WERSJA || '').trim(),
  regulaminUrl: process.env.CAI_REGULAMIN_URL || 'https://content-ai.net/regulamin/',
  politykaUrl: process.env.CAI_POLITYKA_URL || 'https://content-ai.net/prywatnosc/',
  wymusAkceptacje: process.env.CAI_WYMUS_AKCEPTACJE === '1',
  zgodyDlaStarych: process.env.CAI_ZGODY_DLA_STARYCH === '1',
  zgodyIp: process.env.CAI_ZGODY_IP === '1',
  // Cloudflare Turnstile na rejestracji i resecie (opcja, domyslnie wylaczona; SEC8-20).
  turnstile: {
    klucz: String(process.env.CAI_TURNSTILE_KLUCZ || '').trim(),
    sekret: String(process.env.CAI_TURNSTILE_SEKRET || '').trim(),
  },
  // Dane uslugodawcy (osoba fizyczna, decyzja 2): tylko w srodowisku serwera, nigdy
  // w repozytorium. Uzywaja ich ekrany, e-maile, /api/konto i dokumenty prawne (E).
  // CAI_USLUGODAWCA_NAZWA to starsza nazwa imienia i nazwiska z projektu - dziala tak samo.
  uslugodawca: {
    imieNazwisko: String(process.env.CAI_USLUGODAWCA_IMIE_NAZWISKO || process.env.CAI_USLUGODAWCA_NAZWA || '').trim(),
    adres: String(process.env.CAI_USLUGODAWCA_ADRES || '').trim(),
    telefon: String(process.env.CAI_USLUGODAWCA_TELEFON || '').trim(),
    email: String(process.env.CAI_USLUGODAWCA_EMAIL || '').trim(),
    www: String(process.env.CAI_USLUGODAWCA_WWW || '').trim(),
  },

  // Dzierzawy, wlasne klucze i zasoby serwera (wykonawca C).
  // Zrodlo SERP dla organizacji innych niz 'glowna'; 'openseo' odrzucane (projekt zespolu).
  serpSamoobsluga: String(process.env.CAI_SERP_SAMOOBSLUGA
    || (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_HASLO ? 'dataforseo' : 'model')).trim().toLowerCase(),
  zadaniaMb: liczba(process.env.CAI_ZADANIA_MB, 200),
  // Klucz szyfrujacy ciasteczek z kluczami uzytkownikow (SEC8-04): 32 bajty w base64,
  // `openssl rand -base64 32`. Zmiana = wszystkie zapamietane klucze niewazne.
  kluczCiastek: kluczZBase64(process.env.CAI_KLUCZ_CIASTEK),

  // Poczta (wykonawca C, poczta.js): 'log' (domyslnie) albo 'resend'.
  poczta: {
    tryb: String(process.env.CAI_POCZTA || 'log').trim().toLowerCase(),
    klucz: String(process.env.CAI_POCZTA_KLUCZ || '').trim(),
    od: String(process.env.CAI_POCZTA_OD || '').trim(),
    odpowiedz: String(process.env.CAI_POCZTA_ODPOWIEDZ || process.env.CAI_USLUGODAWCA_EMAIL || '').trim(),
    url: String(process.env.CAI_POCZTA_URL || 'https://api.resend.com').trim().replace(/\/+$/, ''),
    log: String(process.env.CAI_POCZTA_LOG || '').trim(),
  },

  // Platnosci (wykonawca B, platnosci.js + adapter): puste PLATNOSCI = wylaczone, serwer jak dzis.
  platnosci: {
    dostawca: String(process.env.PLATNOSCI || '').trim().toLowerCase(),
    tryb: String(process.env.PLATNOSCI_TRYB || '').trim().toLowerCase(),
    sprzedaz: process.env.PLATNOSCI_SPRZEDAZ !== '0',
    waluty: lista(process.env.PLATNOSCI_WALUTY || 'eur,pln').map((w) => w.toLowerCase()),
    walutaDomyslna: String(process.env.PLATNOSCI_WALUTA_DOMYSLNA || 'eur').trim().toLowerCase(),
    walutaPl: String(process.env.PLATNOSCI_WALUTA_PL || 'pln').trim().toLowerCase(),
    // "standard:eur=19,pln=79;premium:eur=49,pln=199" - tylko do wyswietlania, obciazenie zawsze wg ceny u dostawcy.
    cenyWyswietlane: String(process.env.PLATNOSCI_CENY_WYSWIETLANE || '').trim(),
    zaleglaDni: liczba(process.env.PLATNOSCI_ZALEGLA_DNI, 7),
    dlaStarych: process.env.PLATNOSCI_DLA_STARYCH === '1',
    probaDni: liczba(process.env.PLATNOSCI_PROBA_DNI, 0, true),
    kodyRabatowe: process.env.PLATNOSCI_KODY_RABATOWE === '1',
    nipKlienta: process.env.PLATNOSCI_NIP_KLIENTA === '1',
    podatki: process.env.PLATNOSCI_PODATKI === '1',
    // Limit kwartalny dzialalnosci nierejestrowanej (DECYZJE-R9 PR8-09) i progi ostrzezen w procentach.
    progKwartalPln: liczba(process.env.PLATNOSCI_PROG_KWARTAL_PLN, 10813.5),
    progiOstrzezen: lista(process.env.PLATNOSCI_PROGI_OSTRZEZEN || '60,80').map(Number).filter((n) => n > 0 && n <= 100),
    wstrzymajPoProgu: process.env.PLATNOSCI_WSTRZYMAJ_PO_PROGU === '1',
    progUeEur: liczba(process.env.PLATNOSCI_PROG_UE_EUR, 10000),
    kursEurPln: liczba(process.env.PLATNOSCI_KURS_EUR_PLN, 4.25),
    // Sprzedaz tylko klientom z krajow UE (D-04), kody ISO 3166-1 alfa-2.
    kraje: lista(process.env.PLATNOSCI_KRAJE
      || 'AT,BE,BG,HR,CY,CZ,DK,EE,FI,FR,DE,GR,HU,IE,IT,LV,LT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE').map((k) => k.toUpperCase()),
    // Metody platnosci (D-12): domyslnie karta; np. "card,blik" (BLIK tylko dla PLN, jesli konto Stripe go ma).
    metody: lista(process.env.PLATNOSCI_METODY || 'card').map((m) => m.toLowerCase()),
    // Odstapienie w 14 dni (D-03): 'proporcjonalny' (zgodny z ustawa) albo 'pelny'.
    zwrot: String(process.env.PLATNOSCI_ZWROT || 'proporcjonalny').trim().toLowerCase(),
    stripe: {
      klucz: String(process.env.STRIPE_KLUCZ || '').trim(),
      sekretWebhooka: lista(process.env.STRIPE_SEKRET_WEBHOOKA),
      // STRIPE_CENA_<PLAN> dla kazdego pakietu: "price_..." albo "eur:price_a,pln:price_b".
      ceny: Object.fromEntries(Object.keys(plany.PLANY)
        .map((p) => [p, String(process.env[`STRIPE_CENA_${p.toUpperCase()}`] || '').trim()])),
      wersjaApi: String(process.env.STRIPE_WERSJA_API || '').trim(),
      urlApi: String(process.env.STRIPE_URL_API || 'https://api.stripe.com').trim().replace(/\/+$/, ''),
      portalKonfiguracja: String(process.env.STRIPE_PORTAL_KONFIGURACJA || '').trim(),
      hostyPrzekierowan: String(process.env.STRIPE_HOSTY_PRZEKIEROWAN || 'https://checkout.stripe.com https://billing.stripe.com')
        .trim().split(/\s+/).filter(Boolean),
    },
  },

  // Oznaczanie tresci AI (wykonawca D): '0' = awaryjne wylaczenie (slad w dzienniku i /api/status).
  oznaczenia: process.env.CAI_OZNACZENIA !== '0',

  // Stan funkcji po kontroli konfiguracji: { rejestracja, platnosci, poczta, kluczeCiastek,
  // serpSamoobsluga, planNowych } -> { wlaczona, bledy[], ostrzezenia[] }. Ustawia sprawdzKonfiguracje().
  funkcje: {},
};

function liczbaMs(wartosc, domyslnie) {
  const n = Number(wartosc);
  return Number.isFinite(n) && n > 0 ? n : domyslnie;
}

/** Liczba ze zmiennej; puste albo niepoprawne -> domyslnie (zero dozwolone, gdy zeroOk). */
function liczba(wartosc, domyslnie, zeroOk = false) {
  if (wartosc === undefined || wartosc === null || String(wartosc).trim() === '') return domyslnie;
  const n = Number(String(wartosc).trim().replace(',', '.'));
  return Number.isFinite(n) && (n > 0 || (zeroOk && n === 0)) ? n : domyslnie;
}

function lista(tekst) {
  return String(tekst || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** CAI_KLUCZ_CIASTEK: 32 bajty w base64 -> { klucz: Buffer|null, ustawiony, poprawny }. */
function kluczZBase64(tekst) {
  const surowy = String(tekst || '').trim();
  if (!surowy) return { klucz: null, ustawiony: false, poprawny: false };
  const bajty = /^[A-Za-z0-9+/_-]+={0,2}$/.test(surowy) ? Buffer.from(surowy, 'base64') : Buffer.alloc(0);
  return bajty.length === 32 ? { klucz: bajty, ustawiony: true, poprawny: true } : { klucz: null, ustawiony: true, poprawny: false };
}

/** Czy adres nadaje sie na CAI_ADRES_PUBLICZNY: https, a http tylko dla petli zwrotnej (testy). */
function poprawnyAdresPubliczny(adres) {
  let u;
  try { u = new URL(adres); } catch { return false; }
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
}

/**
 * Kontrola konfiguracji nowych funkcji (rozdz. 6). Nie przerywa startu: funkcja
 * z bledem zostaje wylaczona. Komunikaty podaja NAZWY zmiennych, nigdy wartosci.
 * Wynik w KONF.funkcje; start() wypisuje go w dzienniku, /api/status pokazuje operatorowi.
 */
function sprawdzKonfiguracje(konf = KONF) {
  const wynik = {};
  const dodaj = (nazwa, zadana, bledy, ostrzezenia = []) => {
    wynik[nazwa] = { zadana, wlaczona: zadana && !bledy.length, bledy, ostrzezenia };
  };
  const brakUslugodawcy = () => ['imieNazwisko', 'adres', 'email']
    .filter((p) => !konf.uslugodawca[p])
    .map((p) => `brak CAI_USLUGODAWCA_${{ imieNazwisko: 'IMIE_NAZWISKO', adres: 'ADRES', email: 'EMAIL' }[p]}`);

  // Poczta: 'resend' bez klucza albo nadawcy schodzi na 'log' (wysylki nie ma, jest dziennik).
  {
    const bledy = [];
    if (!['log', 'resend'].includes(konf.poczta.tryb)) bledy.push('CAI_POCZTA musi byc "log" albo "resend"');
    if (konf.poczta.tryb === 'resend' && !konf.poczta.klucz) bledy.push('brak CAI_POCZTA_KLUCZ');
    if (konf.poczta.tryb === 'resend' && !konf.poczta.od) bledy.push('brak CAI_POCZTA_OD');
    dodaj('poczta', konf.poczta.tryb !== 'log', bledy);
    if (bledy.length) konf.poczta.tryb = 'log';
  }

  // Klucz ciasteczek z kluczami uzytkownikow (C, SEC8-04).
  dodaj('kluczeCiastek', konf.kluczCiastek.ustawiony,
    konf.kluczCiastek.ustawiony && !konf.kluczCiastek.poprawny ? ['CAI_KLUCZ_CIASTEK musi miec 32 bajty w base64 (openssl rand -base64 32)'] : []);

  // Rejestracja (A1): adres publiczny, dane uslugodawcy, wersje dokumentow, klucz ciasteczek; nie w trybie bramy.
  {
    const bledy = [];
    if (konf.zaufanyNaglowek) bledy.push('tryb bramy (CAI_ZAUFANY_NAGLOWEK) wyklucza wlasna rejestracje i reset hasla');
    if (!konf.adresPubliczny) bledy.push('brak CAI_ADRES_PUBLICZNY');
    else if (!poprawnyAdresPubliczny(konf.adresPubliczny)) bledy.push('CAI_ADRES_PUBLICZNY musi byc adresem https://host bez sciezki');
    bledy.push(...brakUslugodawcy());
    if (!konf.regulaminWersja) bledy.push('brak CAI_REGULAMIN_WERSJA');
    if (!konf.politykaWersja) bledy.push('brak CAI_POLITYKA_WERSJA');
    if (!konf.kluczCiastek.poprawny) bledy.push('brak poprawnego CAI_KLUCZ_CIASTEK (konta samoobslugowe pracuja na wlasnych kluczach)');
    const ostrzezenia = konf.poczta.tryb === 'log' ? ['CAI_POCZTA=log: e-maile z linkami trafiaja tylko do dziennika, nie do skrzynek'] : [];
    dodaj('rejestracja', konf.rejestracja, konf.rejestracja ? bledy : [], konf.rejestracja ? ostrzezenia : []);
  }

  // Platnosci (B): rdzen tutaj, szczegoly adaptera (prefiks klucza a tryb, ceny, sekret) w platnosci.sprawdzKonfiguracje.
  {
    const p = konf.platnosci;
    const bledy = [];
    if (p.dostawca) {
      if (!platnosci.DOSTAWCY.includes(p.dostawca)) bledy.push(`PLATNOSCI: nieznany dostawca (znane: ${platnosci.DOSTAWCY.join(', ')})`);
      if (!['test', 'live'].includes(p.tryb)) bledy.push('PLATNOSCI_TRYB musi byc "test" albo "live"');
      if (!konf.adresPubliczny || !poprawnyAdresPubliczny(konf.adresPubliczny)) bledy.push('brak poprawnego CAI_ADRES_PUBLICZNY (adresy powrotu)');
      bledy.push(...brakUslugodawcy());
      if (!p.waluty.length || !p.waluty.every((w) => /^[a-z]{3}$/.test(w))) bledy.push('PLATNOSCI_WALUTY: lista kodow walut, np. eur,pln');
      if (!p.waluty.includes(p.walutaDomyslna)) bledy.push('PLATNOSCI_WALUTA_DOMYSLNA spoza PLATNOSCI_WALUTY');
      if (!p.waluty.includes(p.walutaPl)) bledy.push('PLATNOSCI_WALUTA_PL spoza PLATNOSCI_WALUTY');
      if (!['proporcjonalny', 'pelny'].includes(p.zwrot)) bledy.push('PLATNOSCI_ZWROT musi byc "proporcjonalny" albo "pelny"');
      if (!bledy.length) bledy.push(...platnosci.sprawdzKonfiguracje(konf));
    }
    dodaj('platnosci', Boolean(p.dostawca), bledy);
  }

  // Zrodlo SERP organizacji samoobslugowych: 'openseo' to projekt zespolu - odrzucamy.
  {
    const bledy = [];
    if (!['model', 'dataforseo'].includes(konf.serpSamoobsluga)) {
      bledy.push('CAI_SERP_SAMOOBSLUGA musi byc "model" albo "dataforseo" ("openseo" to projekt zespolu glownego)');
      konf.serpSamoobsluga = konf.dataForSeo.login && konf.dataForSeo.haslo ? 'dataforseo' : 'model';
    }
    dodaj('serpSamoobsluga', Boolean(process.env.CAI_SERP_SAMOOBSLUGA), bledy);
  }

  // Plan nowych kont (decyzja 3): musi istniec w plany.js.
  {
    const bledy = plany.PLANY[konf.planNowych] ? [] : ['CAI_PLAN_NOWYCH: nie ma takiego pakietu w serwer/plany.js - nowe konta dostaja darmowy'];
    if (bledy.length) konf.planNowych = plany.DOMYSLNY;
    dodaj('planNowych', Boolean(process.env.CAI_PLAN_NOWYCH), bledy);
  }

  konf.funkcje = wynik;
  plany.ustawKonfiguracje({ planNowych: konf.planNowych, trybPlatnosci: konf.platnosci.tryb, zaleglaDni: konf.platnosci.zaleglaDni });
  return wynik;
}

/** Stan funkcji dla /api/status: czy zadana, czy dziala i dlaczego nie (bez wartosci zmiennych). */
function stanKonfiguracji() {
  const wynik = {};
  for (const [nazwa, f] of Object.entries(KONF.funkcje)) {
    wynik[nazwa] = { zadana: f.zadana, wlaczona: f.wlaczona, bledy: f.bledy, ostrzezenia: f.ostrzezenia };
  }
  return wynik;
}

/** Czy funkcja jest wlaczona po kontroli konfiguracji ('rejestracja', 'platnosci', ...). */
function funkcjaWlaczona(nazwa) {
  return Boolean(KONF.funkcje[nazwa] && KONF.funkcje[nazwa].wlaczona);
}

/** Wpisy do dziennika przy starcie: co wylaczone i dlaczego (bez wartosci sekretow). */
function zglosKonfiguracje(loguj = console) {
  for (const [nazwa, f] of Object.entries(KONF.funkcje)) {
    if (f.zadana && !f.wlaczona) loguj.error(`[konfiguracja] ${nazwa} WYLACZONE: ${f.bledy.join('; ')}`);
    else if (f.bledy.length) loguj.error(`[konfiguracja] ${nazwa}: ${f.bledy.join('; ')}`);
    for (const o of f.ostrzezenia) loguj.warn(`[konfiguracja] ${nazwa}: ${o}`);
  }
  if (!KONF.oznaczenia) loguj.warn('[konfiguracja] CAI_OZNACZENIA=0: oznaczenia tresci AI wylaczone awaryjnie');
}

sprawdzKonfiguracje(KONF);

// ─── Uzytkownicy ──────────────────────────────────────────────────────────────
// Konta leza w bazie (serwer/magazyn.js, tabela konta): magazyn.konto(login) zwraca
// obiekt { login, hash, sol, rola, plan, sesjeOd, organizacja, pochodzenie,
// zrodloKluczy, email, ... }. Rola: 'admin' | 'uzytkownik'; operator serwera to
// admin organizacji 'glowna' (dzierzawy.operator) - widzi /api/status i prosby.

const ROLE = ['admin', 'uzytkownik'];

// Login: male litery, cyfry, kropka, podkreslnik, myslnik; 2-40 znakow.
// Baza wiedzy i liczniki trzymaja login w nazwie pliku po oczyszczeniu, wiec
// dwa rozne loginy nie moga dac tej samej nazwy (np. "a b" i "a_b").
const WZOR_LOGINU = /^[a-z0-9._-]{2,40}$/;
function poprawnyLogin(login) {
  return typeof login === 'string' && WZOR_LOGINU.test(login);
}

// Wersje synchroniczne zostaja dla CLI i skryptow (zakladanie kont testowych).
// W sciezkach HTTP tylko asynchroniczne: scryptSync blokowal petle zdarzen na
// ok. 53 ms przy kazdej probie logowania, czyli wszystkim naraz (ARCH8-05, SEC8-23).
function zahaszuj(haslo, sol) {
  const s = sol || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(haslo, s, 64).toString('hex');
  return { hash, sol: s };
}

function hasloPasuje(haslo, uzytkownik) {
  const { hash } = zahaszuj(haslo, uzytkownik.sol);
  return rowneSkroty(hash, uzytkownik.hash);
}

function rowneSkroty(policzony, zapisany) {
  const a = Buffer.from(String(policzony || ''), 'hex');
  const b = Buffer.from(String(zapisany || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// scrypt w puli watkow libuv (4 watki, dziela je tez DNS i zlib): najwyzej dwa
// naraz, zeby fala logowan nie zabrala watkow wywolaniom dostawcow; kolejka
// ograniczona, ponad nia odmowa (429 na ekranie logowania) zamiast rosnacej pamieci.
const SCRYPT_RAZEM = 2;
const SCRYPT_KOLEJKA = 200;
let scryptTrwa = 0;
const scryptCzeka = [];

class BladZajety extends Error {
  constructor() {
    super('Za duzo rownoczesnych operacji na haslach');
    this.name = 'BladZajety';
    this.status = 429;
  }
}

function scryptAsync(haslo, sol) {
  return new Promise((ok, zle) => {
    const uruchom = () => {
      scryptTrwa += 1;
      crypto.scrypt(String(haslo), sol, 64, (e, klucz) => {
        scryptTrwa -= 1;
        const nastepny = scryptCzeka.shift();
        if (nastepny) nastepny();
        if (e) zle(e); else ok(klucz);
      });
    };
    if (scryptTrwa < SCRYPT_RAZEM) uruchom();
    else if (scryptCzeka.length >= SCRYPT_KOLEJKA) zle(new BladZajety());
    else scryptCzeka.push(uruchom);
  });
}

/** Ten sam format co zahaszuj (scrypt N=16384, 64 bajty hex, sol 16 bajtow hex), bez blokowania petli. */
async function zahaszujAsync(haslo, sol) {
  const s = sol || crypto.randomBytes(16).toString('hex');
  return { hash: (await scryptAsync(haslo, s)).toString('hex'), sol: s };
}

async function hasloPasujeAsync(haslo, uzytkownik) {
  const { hash } = await zahaszujAsync(haslo, uzytkownik.sol);
  return rowneSkroty(hash, uzytkownik.hash);
}

// Konto-atrapa do logowania na nieistniejacy login: scrypt liczy sie zawsze,
// wiec po czasie odpowiedzi nie da sie odroznic istniejacego loginu od zmyslonego.
let ATRAPA_KONTA = null;
function atrapaKontaAsync() {
  if (!ATRAPA_KONTA) {
    ATRAPA_KONTA = zahaszujAsync(crypto.randomBytes(16).toString('hex')).catch((e) => { ATRAPA_KONTA = null; throw e; });
  }
  return ATRAPA_KONTA;
}

// ─── Sesje ────────────────────────────────────────────────────────────────────
// Sesja siedzi w podpisanym ciasteczku, nie w pamieci procesu. Dzieki temu
// restart uslugi - a wiec kazda aktualizacja - nie wylogowuje calego zespolu.
//
// W ciasteczku jest jawny opis sesji (login, rola, wygasniecie, losowy
// identyfikator) plus HMAC-SHA256 z sekretu serwera. Podmiana czegokolwiek
// psuje podpis, wiec przegladarka nie moze sobie dopisac roli admina.
// Tresc nie jest tajna - i nie musi byc, bo nie ma w niej nic, czego
// uzytkownik by o sobie nie wiedzial.
//
// Cena za brak stanu: samo wygasniecie nie odbiera dostepu natychmiast.
// Dlatego sa dwie drogi uniewaznienia, obie przezywajace restart:
//   - wylogowanie dopisuje identyfikator sesji do tabeli sesje_odwolane w bazie,
//   - zmiana hasla, roli, "wyloguj wszedzie" albo usuniecie konta podnosi znacznik
//     sesjeOd konta, co uniewaznia wszystkie starsze sesje tej osoby naraz.
// Sekret podpisu nie zmienil sie przy przejsciu na baze, wiec ciasteczka sprzed
// migracji sa wazne po niej.

const PLIK_SEKRETU = process.env.CAI_SEKRET_PLIK || path.join(KATALOG, 'dane', 'sekret');
// Lista wylogowan w formacie R8: czyta ja juz tylko migracja (i zapisuje eksport-json).
const PLIK_WYLOGOWANYCH = process.env.CAI_WYLOGOWANE || path.join(KATALOG, 'dane', 'wylogowane.json');

/**
 * Sekret do podpisywania. Z konfiguracji, a jesli jej nie ma - losowany raz
 * i zapisywany obok kont. Bez zapisu kazdy restart generowalby nowy sekret
 * i uniewazniał wszystkie sesje, czyli dokladnie to, co naprawiamy.
 */
function sekretSesji() {
  if (process.env.CAI_SEKRET_SESJI) return process.env.CAI_SEKRET_SESJI;
  try {
    const zapisany = fs.readFileSync(PLIK_SEKRETU, 'utf8').trim();
    if (zapisany) return zapisany;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[sesje] odczyt sekretu:', e.message);
  }
  const nowy = crypto.randomBytes(32).toString('hex');
  try {
    pliki.zapiszAtomowo(PLIK_SEKRETU, nowy);
    console.log(`Wygenerowano sekret sesji: ${PLIK_SEKRETU}`);
  } catch (e) {
    console.warn('[sesje] nie udalo sie zapisac sekretu - restart wylogowuje wszystkich:', e.message);
  }
  return nowy;
}

let SEKRET = null;

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function zB64u(tekst) {
  return Buffer.from(String(tekst).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function podpis(dane) {
  return b64u(crypto.createHmac('sha256', SEKRET || (SEKRET = sekretSesji())).update(dane).digest());
}

/** HMAC-SHA256 z sekretu sesji, base64url - do znacznika czasu formularzy (A1) i podobnych podpisow. */
function podpisz(dane) {
  return podpis(String(dane));
}

/** Skrot e-maila bez jawnego adresu (konta_usuniete, naduzycia darmowego pakietu). */
function skrotEmaila(email) {
  const e = magazyn.normalizujEmail(email);
  if (!e) return null;
  return crypto.createHmac('sha256', SEKRET || (SEKRET = sekretSesji())).update(`email:${e}`).digest('hex');
}

function utworzSesje(uzytkownik) {
  const opis = {
    login: uzytkownik.login,
    rola: uzytkownik.rola,
    wygasa: Date.now() + KONF.sesjaGodzin * 3600_000,
    wydana: Date.now(),
    id: crypto.randomBytes(9).toString('hex'),
  };
  const cialo = b64u(JSON.stringify(opis));
  return `${cialo}.${podpis(cialo)}`;
}

/**
 * Sesje wylogowane recznie i jeszcze nieprzeterminowane: [{ id, wygasa }].
 * Baza niedostepna to BladMagazynu (503), nie pusta lista: pusta oznaczalaby,
 * ze wszystkie uniewaznione sesje znow sa wazne az do wygasniecia.
 */
function wylogowane() {
  return magazyn.sesjeOdwolane();
}

function zapiszWylogowanie(id, wygasa) {
  // Wpisy po terminie wypadaja przy sprzataniu dobowym (magazyn.sprzataj).
  magazyn.odwolajSesje(id, wygasa);
}

/**
 * Odczytuje i weryfikuje sesje z ciasteczka. Zwraca null przy czymkolwiek
 * podejrzanym - zlym podpisie, wygasnieciu, wylogowaniu, uniewaznieniu konta.
 */
/**
 * Tozsamosc z zewnetrznej bramy (Authelia i pokrewne).
 *
 * Brama uwierzytelnia uzytkownika - haslo, TOTP, klucz sprzetowy - i przekazuje
 * dalej sam login w naglowku. My mu ufamy pod dwoma warunkami: naglowek jest
 * skonfigurowany jawnie ORAZ zadanie przyszlo z zaufanego adresu.
 *
 * Drugi warunek jest tu istotny, a nie ozdobny. Bez niego kazdy, kto dosiegnie
 * portu z pominieciem bramy, zostaje adminem przez dopisanie jednego naglowka.
 * Dlatego domyslnie ufamy wylacznie petli zwrotnej: brama i serwer stoja na tej
 * samej maszynie, a port nie jest wystawiony na zewnatrz.
 *
 * Konta zostaja u nas. Brama mowi KTO przyszedl, role nadal czytamy z bazy
 * kont - inaczej trzeba by trzymac uprawnienia w dwoch miejscach naraz.
 */
function tozsamoscZBramy(req) {
  if (!KONF.zaufanyNaglowek) return null;

  const skad = req.socket?.remoteAddress || '';
  if (!KONF.zaufaneAdresy.includes(skad)) {
    console.warn(`[brama] naglowek tozsamosci z niezaufanego adresu ${skad} - odrzucony`);
    return null;
  }

  const login = String(req.headers[KONF.zaufanyNaglowek] || '').trim();
  if (!login) return null;

  const uzytkownik = magazyn.kontoZOrganizacja(login);
  if (!uzytkownik) {
    // Swiadomie nie zakladamy konta z marszu: rola musi byc czyjas decyzja,
    // a nie skutkiem ubocznym pierwszego wejscia.
    console.warn(`[brama] brama wpuscila "${login.slice(0, 60)}", ale nie ma takiego konta`);
    return null;
  }
  return { login: uzytkownik.login, rola: uzytkownik.rola, token: null, id: null, zBramy: true, konto: uzytkownik };
}

function sesjaZadania(req) {
  // Brama ma pierwszenstwo - gdy jest wlaczona, wlasne ciasteczko nie ma znaczenia.
  const zBramy = tozsamoscZBramy(req);
  if (zBramy) return zBramy;
  if (KONF.zaufanyNaglowek) return null;

  const token = parsujCiasteczka(req.headers.cookie || '').cai_auth;
  if (!token) return null;

  const kropka = token.lastIndexOf('.');
  if (kropka < 1) return null;
  const cialo = token.slice(0, kropka);
  const dany = token.slice(kropka + 1);

  // Porownanie odporne na pomiar czasu; rozne dlugosci odrzucamy wczesniej,
  // bo timingSafeEqual rzuca wyjatkiem przy niezgodnych buforach.
  const oczekiwany = Buffer.from(podpis(cialo));
  const otrzymany = Buffer.from(dany);
  if (oczekiwany.length !== otrzymany.length) return null;
  if (!crypto.timingSafeEqual(oczekiwany, otrzymany)) return null;

  let opis;
  try {
    opis = JSON.parse(zB64u(cialo).toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!opis || !opis.login || !(opis.wygasa > Date.now())) return null;

  // Konto moglo w miedzyczasie zniknac, zmienic role albo zostac uniewaznione
  // zmiana hasla. Czytamy stan biezacy z bazy, nie ten sprzed wydania ciasteczka.
  const uzytkownik = magazyn.kontoZOrganizacja(opis.login);
  if (!uzytkownik) return null;
  if (uzytkownik.sesjeOd && opis.wydana < uzytkownik.sesjeOd) return null;

  if (magazyn.sesjaOdwolana(opis.id)) return null;

  // Rola bierze sie z bazy kont, nie z ciasteczka - degradacja admina dziala
  // natychmiast, bez czekania na wygasniecie sesji. `konto` to ten sam odczyt,
  // zeby trasy nie czytaly konta drugi raz (kontoSesji).
  return { login: uzytkownik.login, rola: uzytkownik.rola, token, id: opis.id, wygasa: opis.wygasa, konto: uzytkownik };
}

function parsujCiasteczka(naglowek) {
  const out = {};
  for (const czesc of naglowek.split(';')) {
    const i = czesc.indexOf('=');
    if (i <= 0) continue;
    const surowa = czesc.slice(i + 1).trim();
    // Obce ciasteczko z blednym kodowaniem (np. ustawione przez inna poddomene
    // tej samej domeny) nie moze konczyc kazdego zadania bledem 500.
    let wartosc = surowa;
    try { wartosc = decodeURIComponent(surowa); } catch { /* zostaje surowa wartosc */ }
    out[czesc.slice(0, i).trim()] = wartosc;
  }
  return out;
}

// ─── Ograniczenie prob logowania ──────────────────────────────────────────────
// Prosty licznik per adres IP. Serwer stoi publicznie, wiec bez tego haslo mozna
// zgadywac w nieskonczonosc.

const proby = new Map(); // ip -> { ile, doKiedy }
const MAX_PROB = 8;
const BLOKADA_MS = 15 * 60_000;

function zablokowany(ip) {
  const p = proby.get(ip);
  if (!p) return false;
  if (p.doKiedy < Date.now()) { proby.delete(ip); return false; }
  return p.ile >= MAX_PROB;
}

function nieudanaProba(ip) {
  const p = proby.get(ip) || { ile: 0, doKiedy: Date.now() + BLOKADA_MS };
  p.ile += 1;
  p.doKiedy = Date.now() + BLOKADA_MS;
  proby.set(ip, p);
}

// ─── Ograniczenie wyjsc w swiat ──────────────────────────────────────────────
// Dwa endpointy kaza serwerowi pobrac cudza strone: /api/strona i
// /api/odnosniki. Nie kosztuja tokenow, wiec nie licza sie do pakietu - i to
// wlasnie jest powod, dla ktorego potrzebuja wlasnego hamulca. Bez niego
// zalogowany uzytkownik moglby zrobic z serwera narzedzie do odpytywania
// cudzych witryn w petli, a odpowiadalby za to adres IP tego serwera.
//
// Licznik jest w pamieci procesu, tak samo jak sesje: restart go zeruje, co
// przy tej skali wystarcza i nie wnosi zaleznosci.

const wyjscia = new Map();          // login -> { ile, od }
const OKNO_WYJSC_MS = 60_000;
const MAX_WYJSC_NA_MINUTE = 60;

function wolnoWyjsc(login, ile = 1) {
  const teraz = Date.now();
  const w = wyjscia.get(login);
  if (!w || teraz - w.od > OKNO_WYJSC_MS) {
    wyjscia.set(login, { ile, od: teraz });
    return ile <= MAX_WYJSC_NA_MINUTE;
  }
  if (w.ile + ile > MAX_WYJSC_NA_MINUTE) return false;
  w.ile += ile;
  return true;
}

/** Czy polaczenie przyszlo z petli zwrotnej (Caddy na tej samej maszynie). */
function zPetliZwrotnej(adres) {
  const a = String(adres || '');
  return a === '::1' || /^(::ffff:)?127\./.test(a);
}

/**
 * Adres klienta do licznikow (logowanie, prosby o dostep).
 *
 * X-Forwarded-For czytany wprost byl do podrobienia: inny naglowek = nowy
 * licznik prob. Teraz ufamy wylacznie X-Real-IP i tylko wtedy, gdy polaczenie
 * przyszlo z petli zwrotnej, czyli od Caddy na tej samej maszynie. Caddy
 * ustawia go z {client_ip}, a ten - przy trusted_proxies dla Cloudflare -
 * jest prawdziwym adresem odwiedzajacego (konfiguracja: serwer/README.md).
 */
let ostatnieOstrzezenieIp = 0;
function adresIp(req) {
  const zrodlo = req.socket?.remoteAddress || '';
  if (zPetliZwrotnej(zrodlo)) {
    const realny = req.headers['x-real-ip'];
    if (typeof realny === 'string' && realny.trim()) return realny.trim().slice(0, 64);
    // Zadanie z petli zwrotnej bez X-Real-IP = Caddy bez `header_up X-Real-IP
    // {client_ip}`. Wtedy wszyscy maja jeden adres i jeden licznik prob
    // logowania - blad konfiguracji ma byc widac w logu (raz na godzine).
    if (Date.now() - ostatnieOstrzezenieIp > 3600_000) {
      ostatnieOstrzezenieIp = Date.now();
      console.warn('[adres] zadanie z petli zwrotnej bez naglowka X-Real-IP - w Caddy brakuje '
        + '`header_up X-Real-IP {client_ip}` (dokumenty/Caddyfile.content-ai). Wszyscy klienci '
        + 'dziela teraz jeden licznik prob logowania.');
    }
  }
  return zrodlo || 'nieznany';
}

// ─── Aplikacja: wariant proxy z adresami przepisanymi na wlasny serwer ────────
// web-proxy.html ma wpisany placeholder workera. Podmieniamy go na pusty ciag,
// dzieki czemu adresy staja sie wzgledne (/api, /api/images, ...) i trafiaja tutaj.

const PLACEHOLDER_WORKER = 'https://twoj-worker.workers.dev';
const PLACEHOLDER_OPENSEO = 'WSTAW_TUTAJ_ADRES_OPENSEO';
const PLACEHOLDER_DOMENA = 'WSTAW_TUTAJ_DOMENA_CIASTECZKA';
// Identyfikator konta dla aplikacji: na nim aplikacja zaklada osobne miejsce
// w localStorage, zeby na wspolnym komputerze konta nie widzialy nawzajem
// historii i kluczy. Skrot zamiast loginu - login nie musi lezec w kluczach
// przegladarki.
const PLACEHOLDER_KONTO = 'WSTAW_TUTAJ_KONTO';
function idKonta(login) {
  return crypto.createHash('sha256').update('cai-konto:' + String(login)).digest('hex').slice(0, 16);
}
let htmlAplikacji = null;
// Gotowa strona aplikacji per konto (identyfikator konta w HTML) z wersjami spakowanymi.
const PAMIEC_STRONY = new Map();

function wczytajAplikacje() {
  const plik = path.join(APP, 'web-proxy.html');
  if (!fs.existsSync(plik)) {
    throw new Error(`nie znaleziono ${plik} - zbuduj warianty: cd pakowanie && python3 warianty.py --wszystkie -o ../app`);
  }
  const html = fs.readFileSync(plik, 'utf8');
  if (!html.includes(PLACEHOLDER_WORKER)) {
    throw new Error('web-proxy.html nie zawiera placeholdera workera - czy na pewno to wariant proxy?');
  }
  htmlAplikacji = html.split(PLACEHOLDER_WORKER).join('');

  // Adres OpenSEO i domena ciasteczka. Niepodstawione placeholdery zostaja
  // nietkniete - aplikacja sama rozpoznaje, ze OpenSEO nie ma, i chowa pozycje
  // w menu.
  if (KONF.openseo.adres) {
    htmlAplikacji = htmlAplikacji.split(PLACEHOLDER_OPENSEO).join(KONF.openseo.adres);
  }
  if (KONF.cookieDomena) {
    htmlAplikacji = htmlAplikacji.split(PLACEHOLDER_DOMENA).join(KONF.cookieDomena);
  }
  ustalDozwolone(html);
  return htmlAplikacji;
}

/** Do testow: podstawia gotowy HTML aplikacji (np. bez miejsca na konto) i czysci pamiec stron. */
function ustawHtmlAplikacji(html) {
  htmlAplikacji = html;
  PAMIEC_STRONY.clear();
}

// ─── Koszt: dozwolone modele, sufit tokenow, rozmiary grafik ─────────────────
// /api przepuszczal dowolny model i max_tokens 128000 nawet z konta
// darmowego, a /api/images dowolne n i size. Na koncie serwera to my placimy,
// wiec granice stawia serwer. Listy bierzemy z samej aplikacji (stale MODEL_*
// i IMG_FORMATS), zeby zmiana modelu w aplikacji nie psula generowania.

const MODELE_DOMYSLNE = ['claude-opus-5', 'claude-sonnet-5'];
const ROZMIARY_DOMYSLNE = ['1536x1024', '1024x1024', '1024x1536'];
const DOZWOLONE = { modele: new Set(MODELE_DOMYSLNE), rozmiary: new Set(ROZMIARY_DOMYSLNE) };

function ustalDozwolone(html) {
  const modele = [...String(html).matchAll(/const\s+MODEL_[A-Z_]+\s*=\s*'([a-z0-9][a-z0-9._-]*)'/g)].map((m) => m[1]);
  const formaty = /const IMG_FORMATS\s*=\s*\[([\s\S]*?)\];/.exec(String(html));
  const rozmiary = formaty ? [...formaty[1].matchAll(/api:\s*'(\d+x\d+)'/g)].map((m) => m[1]) : [];
  DOZWOLONE.modele = new Set([...(modele.length ? modele : MODELE_DOMYSLNE), ...KONF.modeleDodatkowe]);
  DOZWOLONE.rozmiary = new Set([...(rozmiary.length ? rozmiary : ROZMIARY_DOMYSLNE), ...KONF.rozmiaryDodatkowe]);
}

/** Opis odmowy dla tresci (/api) albo null, gdy zadanie miesci sie w granicach. */
function odmowaKosztuTresci(body) {
  if (!body || typeof body !== 'object') return 'Niepoprawne zapytanie.';
  if (!DOZWOLONE.modele.has(String(body.model || ''))) {
    return `Model "${String(body.model || '').slice(0, 60)}" nie jest dostępny na tym serwerze. Dozwolone: ${[...DOZWOLONE.modele].join(', ')}.`;
  }
  const mt = body.max_tokens;
  if (mt !== undefined && !(Number.isInteger(mt) && mt > 0 && mt <= KONF.maxTokens)) {
    return `max_tokens musi być liczbą całkowitą od 1 do ${KONF.maxTokens}.`;
  }
  return null;
}

/** To samo dla /api/images: jedna grafika, rozmiar z listy aplikacji. */
function odmowaKosztuGrafiki(body) {
  if (!body || typeof body !== 'object') return 'Niepoprawne zapytanie.';
  if (body.n !== undefined && body.n !== 1) return 'Serwer generuje jedną grafikę na zapytanie (n = 1).';
  if (!DOZWOLONE.rozmiary.has(String(body.size || ''))) {
    return `Rozmiar "${String(body.size || '').slice(0, 20)}" nie jest dostępny. Dozwolone: ${[...DOZWOLONE.rozmiary].join(', ')}.`;
  }
  return null;
}

// ─── Klucze: wybor w serwer/klucze.js (BYOK, ARCH8-10) ──────────────────────
// Konto 'wlasne' bierze wylacznie wlasny klucz z zaszyfrowanego ciasteczka i nie ma
// sciezki do klucza serwera; konto zespolu ('serwera') ciasteczko, potem przejsciowo
// naglowek x-*-key z aplikacji R8, na koncu klucz serwera jak dzis. Klucz uzytkownika
// Anthropic idzie zawsze do Anthropic, nawet przy CAI_DOSTAWCA=nvidia (SEC8-03).

/** 403 brak-klucza (kreator klucza w aplikacji) z nazwa dostawcy; cialo zapytania doczytane. */
function odmowaKlucza(req, res, blad) {
  if (req && typeof req.resume === 'function') req.resume();
  if (!res.headersSent && typeof res.setHeader === 'function') res.setHeader('X-CAI-Dostawca', blad.dostawca);
  return bledy.bladCai(res, blad.kod, blad.status, { dostawca: blad.dostawca, ...(blad.niewazny ? { niewazny: true } : {}) });
}

/**
 * Odpowiedz dostawcy odrzucajaca klucz UZYTKOWNIKA (401, 403 z brakiem uprawnien) idzie
 * bez zmian, z dodanym X-CAI-Kod: zly-klucz i X-CAI-Dostawca (aplikacja otwiera kreator).
 * Odrzucenie klucza serwera to sprawa administratora - bez tych naglowkow.
 */
function naglowkiZlegoKlucza(k, status, cialo, dostawca) {
  return k.czyj === 'uzytkownika' && klucze.odrzucenieKlucza(status, cialo)
    ? { 'X-CAI-Kod': 'zly-klucz', 'X-CAI-Dostawca': dostawca } : {};
}

// ─── Tlumaczenie Anthropic <-> OpenAI (dla dostawcy nvidia) ───────────────────
// Aplikacja mowi formatem Anthropic. NVIDIA NIM jest zgodna z OpenAI. Tlumaczymy
// po stronie serwera, zeby nie ruszac aplikacji.

function anthropicNaOpenai(body) {
  const wiadomosci = [];
  if (body.system) wiadomosci.push({ role: 'system', content: String(body.system) });
  for (const m of body.messages || []) {
    if (typeof m.content === 'string') {
      wiadomosci.push({ role: m.role, content: m.content });
      continue;
    }
    // bloki tresci (tekst + obrazy) -> tekst; obrazy pomijamy, bo nie kazdy model NIM je przyjmuje
    const tekst = (m.content || [])
      .filter((c) => c && c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    wiadomosci.push({ role: m.role, content: tekst });
  }
  const out = { model: KONF.modelNvidia, messages: wiadomosci };
  if (body.max_tokens) out.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  return out;
}

function openaiNaAnthropic(dane) {
  const tekst = dane?.choices?.[0]?.message?.content || '';
  return {
    content: [{ type: 'text', text: tekst }],
    usage: {
      input_tokens: dane?.usage?.prompt_tokens || 0,
      output_tokens: dane?.usage?.completion_tokens || 0,
    },
  };
}

// ─── Odpowiedzi ───────────────────────────────────────────────────────────────

function odpowiedzJson(res, status, dane) {
  if (res.headersSent || res.destroyed) return;
  const tresc = JSON.stringify(dane);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(tresc),
  });
  res.end(tresc);
}

function odpowiedzTekst(res, status, tekst, typ = 'text/plain; charset=utf-8') {
  if (res.headersSent || res.destroyed) return undefined;
  return wyslij(res, status, { 'Content-Type': typ }, Buffer.from(tekst, 'utf8'));
}

// ─── Naglowki bezpieczenstwa ─────────────────────────────────────────────────
// Jedno zrodlo prawdy w Node, wiec dzialaja tez bez Caddy. HSTS ustawia Caddy
// (serwer/README.md), bo dotyczy HTTPS, ktorego Node nie widzi.
//
// 'unsafe-inline' w script-src musi zostac, dopoki aplikacja ma setki
// atrybutow on* i skrypty w HTML. Taka CSP nie zatrzyma wstrzyknietego
// skryptu, ale odcina mu wyprowadzanie danych (connect/img/form/frame) i
// osadzanie aplikacji w obcej ramce. connect-src https: zostaje tylko dla
// publikacji do WordPressa/Drupala prosto z przegladarki.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const NAGLOWKI_BEZPIECZENSTWA = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// Strony osobiste albo z tokenem w adresie (konto, rejestracja, reset, platnosci).
const OSOBISTE = /^\/(konto(\/|\.js$|$)|rejestracja\/?$|potwierdz\/?$|haslo(\/|$)|do-widzenia\/?$|platnosci\/)/;

function ustawNaglowkiBezpieczenstwa(res, sciezka) {
  for (const [k, v] of Object.entries(NAGLOWKI_BEZPIECZENSTWA)) res.setHeader(k, v);
  // Odpowiedzi API i logowania sa osobiste - zadna pamiec podreczna ich nie trzyma.
  if (sciezka === '/api' || sciezka.startsWith('/api/') || sciezka.startsWith('/auth/') || OSOBISTE.test(sciezka)) {
    res.setHeader('Cache-Control', 'no-store');
  }
}

// ─── Kompresja ───────────────────────────────────────────────────────────────
// HTML aplikacji ma ponad 800 kB; spakowany brotli schodzi do okolo 200 kB.
// Bez zaleznosci: zlib jest wbudowany. Za Caddy z `encode zstd gzip` mozna to
// wylaczyc (CAI_KOMPRESJA=0) - Caddy nie pakuje odpowiedzi, ktora juz ma
// Content-Encoding, ale po co liczyc to samo dwa razy.

const TYPY_DO_KOMPRESJI = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/i;

/** 'br', 'gzip' albo null - wg Accept-Encoding klienta. */
function wybierzKodowanie(req) {
  if (!KONF.kompresja || !req) return null;
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  const akceptuje = (nazwa) => ae.split(',').some((c) => {
    const [n, ...param] = c.trim().split(';');
    if (n.trim() !== nazwa) return false;
    const q = param.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
  if (akceptuje('br')) return 'br';
  if (akceptuje('gzip')) return 'gzip';
  return null;
}

function spakuj(bufor, kodowanie, jakosc) {
  if (kodowanie === 'br') {
    return zlib.brotliCompressSync(bufor, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: jakosc || 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bufor.length,
      },
    });
  }
  return zlib.gzipSync(bufor, { level: 6 });
}

// Pakowanie w puli watkow libuv (F, KOD8-32): brotli 11 dla pwa/lib/pdfmake.min.js to 2-4 s,
// a liczone synchronicznie po kazdym restarcie zatrzymywalo serwer dla wszystkich. Male
// odpowiedzi (do 256 kB, ulamki milisekundy) dalej pakujemy od razu.
const PROG_PAKOWANIA_W_TLE = 256 * 1024;

function spakujAsync(bufor, kodowanie, jakosc) {
  return new Promise((ok, zle) => {
    const gotowe = (e, wynik) => (e ? zle(e) : ok(wynik));
    if (kodowanie === 'br') {
      zlib.brotliCompress(bufor, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: jakosc || 5,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bufor.length,
        },
      }, gotowe);
    } else {
      zlib.gzip(bufor, { level: 6 }, gotowe);
    }
  });
}

/**
 * Wersja spakowana wpisu pamieci (plik statyczny, strona aplikacji) -> obietnica bufora.
 * Gotowa: od razu. Liczona: ta sama obietnica dla wszystkich czekajacych (jedno pakowanie
 * na plik i kodowanie). Brotli powyzej 9 (sekundy na duzy plik) liczy sie w tle, a do tego
 * czasu klienci dostaja szybka wersje (brotli 5, dziesiatki milisekund w puli watkow).
 */
function spakowanaWersja(wpis, kod, jakosc = 5) {
  if (wpis.spakowane[kod]) return Promise.resolve(wpis.spakowane[kod]);
  if (!wpis.liczone) wpis.liczone = {};
  const licz = (klucz, q, poPakowaniu) => {
    if (!wpis.liczone[klucz]) {
      wpis.liczone[klucz] = spakujAsync(wpis.dane, kod, q).then(poPakowaniu)
        .finally(() => { delete wpis.liczone[klucz]; });
    }
    return wpis.liczone[klucz];
  };
  const docelowa = () => licz(kod, jakosc, (b) => {
    wpis.spakowane[kod] = b;
    if (wpis.szybkie) delete wpis.szybkie[kod];
    return b;
  });
  if (kod !== 'br' || jakosc <= 9) return docelowa();
  docelowa().catch((e) => console.error('[kompresja]', e.message));
  if (wpis.szybkie && wpis.szybkie[kod]) return Promise.resolve(wpis.szybkie[kod]);
  return licz(`${kod}:szybka`, 5, (b) => {
    if (!wpis.spakowane[kod]) wpis.szybkie = { ...(wpis.szybkie || {}), [kod]: b };
    return b;
  });
}

/** Wysyla gotowe cialo (spakowane albo nie), o ile klient jeszcze czeka. */
function wyslijCialo(res, status, naglowki, cialo, bezCiala) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { ...naglowki, 'Content-Length': cialo.length });
  res.end(bezCiala ? undefined : cialo);
}

/**
 * Wysyla bufor, w razie potrzeby spakowany. `gotowe` pozwala podac wersje
 * spakowane wczesniej (pliki statyczne liczymy raz, nie przy kazdym zadaniu).
 * Duze cialo bez gotowej wersji pakuje w puli watkow i zwraca obietnice.
 */
function wyslij(res, status, naglowki, bufor, gotowe) {
  const typ = String(naglowki['Content-Type'] || '');
  const doKompresji = TYPY_DO_KOMPRESJI.test(typ) && bufor.length > 1024;
  const out = { ...naglowki };
  const bezCiala = Boolean(res.req && res.req.method === 'HEAD');
  const kod = doKompresji ? wybierzKodowanie(res.req) : null;
  if (doKompresji) out.Vary = 'Accept-Encoding';
  if (!kod) return wyslijCialo(res, status, out, bufor, bezCiala);
  const spakowane = { ...out, 'Content-Encoding': kod };
  if (gotowe && gotowe[kod]) return wyslijCialo(res, status, spakowane, gotowe[kod], bezCiala);
  if (bufor.length <= PROG_PAKOWANIA_W_TLE) return wyslijCialo(res, status, spakowane, spakuj(bufor, kod), bezCiala);
  return spakujAsync(bufor, kod).then(
    (cialo) => wyslijCialo(res, status, spakowane, cialo, bezCiala),
    () => wyslijCialo(res, status, out, bufor, bezCiala));
}

/**
 * Cialo zadania z limitem. Po przekroczeniu limitu NIE zrywamy od razu
 * polaczenia: wtedy klient nie dostalby zadnej odpowiedzi (formularz pokazalby
 * "blad sieci"). Odrzucamy z e.status = 413, reszte ciala przepuszczamy w proznie,
 * zeby odpowiedz 413 mogla dojsc, a polaczenie zamykamy po chwili.
 */
function czytajCialo(req, limitBajtow = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const kawalki = [];
    let rozmiar = 0;
    let zaDuze = false;
    const odrzucZaDuze = () => {
      zaDuze = true;
      kawalki.length = 0;
      const e = new Error('cialo zadania za duze');
      e.status = 413;
      reject(e);
      const t = setTimeout(() => req.destroy(), 2000);
      if (t.unref) t.unref();
    };
    // Zadeklarowana dlugosc ponad limit - nie ma po co czytac.
    if (Number(req.headers['content-length'] || 0) > limitBajtow) {
      req.resume();
      odrzucZaDuze();
      return;
    }
    req.on('data', (c) => {
      if (zaDuze) return;
      rozmiar += c.length;
      if (rozmiar > limitBajtow) {
        odrzucZaDuze();
        return;
      }
      kawalki.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(kawalki)));
    req.on('error', reject);
    // Klient zerwal polaczenie w trakcie wysylania ciala: bez tego obietnica
    // wisialaby bez konca (a z nia zadanie w tle czekajace na cialo).
    req.on('close', () => { if (req.complete === false) reject(new Error('zerwane wysylanie zadania')); });
  });
}

// ─── Limity czasu i zerwanie przez klienta ───────────────────────────────────
// Kazde wywolanie dostawcy ma dwa hamulce naraz:
//   - limit czasu z konfiguracji (KONF.czasy) - po nim 504 z czytelnym komunikatem,
//   - zerwanie przez klienta - gdy przegladarka zamknie polaczenie (zamknieta
//     karta, ponowienie, utrata sieci), przerywamy tez wywolanie dostawcy,
//     zamiast placic za odpowiedz, ktorej nikt nie odbierze. Uzycie pakietu
//     liczymy tylko wtedy, gdy odpowiedz byla udana I klient nadal czeka.

class BladCzasu extends Error {
  constructor(ms) {
    super(`Dostawca nie odpowiedział w ciągu ${Math.round(ms / 1000)} s. Spróbuj ponownie za chwilę.`);
    this.name = 'BladCzasu';
    this.status = 504;
  }
}

class KlientOdszedl extends Error {
  constructor() {
    super('klient zamknal polaczenie');
    this.name = 'KlientOdszedl';
  }
}

/**
 * Sygnal dla wywolania dostawcy: limit czasu albo zerwanie przez klienta.
 * Jeden AbortController z dwoma wyzwalaczami (zamiast AbortSignal.any, ktorego
 * nie ma w Node 18); powod przerwania mowi, ktory zadzialal.
 */
function hamulec(res, ms) {
  const ster = new AbortController();
  const zegar = setTimeout(() => ster.abort(new BladCzasu(ms)), ms);
  if (zegar.unref) zegar.unref();
  const poZamknieciu = () => { if (!res.writableEnded && !ster.signal.aborted) ster.abort(new KlientOdszedl()); };
  res.on('close', poZamknieciu);
  return {
    signal: ster.signal,
    // Czy po udanej odpowiedzi dostawcy ktos jeszcze na nia czeka.
    klientCzeka: () => !(ster.signal.reason instanceof KlientOdszedl) && !res.destroyed && !res.writableEnded,
    zwolnij: () => { clearTimeout(zegar); res.removeListener('close', poZamknieciu); },
  };
}

/** Zamienia przerwanie z hamulca na wlasciwy wyjatek (fetch rzuca powod przerwania). */
function powodPrzerwania(e, signal) {
  if (signal && signal.aborted && signal.reason instanceof Error) return signal.reason;
  return e;
}

/** Odpowiedz na limit czasu w ksztalcie bledu Anthropic/OpenAI - aplikacja czyta error.message. */
function odpowiedzCzasu(res, e) {
  odpowiedzJson(res, 504, {
    type: 'error',
    error: { type: 'timeout_error', message: e.message },
    komunikat: e.message,
  });
}

/** fetch z hamulcem; body czytane w tym samym limicie. */
async function fetchZHamulcem(url, opcje, hamulecZadania, czytaj) {
  try {
    const odp = await fetch(url, { ...opcje, signal: hamulecZadania.signal });
    const cialo = czytaj === 'bufor' ? Buffer.from(await odp.arrayBuffer()) : await odp.text();
    return { odp, cialo };
  } catch (e) {
    throw powodPrzerwania(e, hamulecZadania.signal);
  }
}

/** Czy zapytanie do /api to dlugie generowanie (osobny, dluzszy limit czasu). */
function dlugieGenerowanie(body, czynnosci) {
  if (czynnosci.includes('artykul')) return true;
  if (Array.isArray(body.tools) && body.tools.length) return true;
  return Number(body.max_tokens || 0) > 4000;
}

// ─── Proxy do dostawcow ───────────────────────────────────────────────────────

// Budzet pamieci wynikow zadan w tle (ARCH8-12, CAI_ZADANIA_MB, domyslnie 200 MB).
zadaniaWTle.ustaw({ budzetMb: KONF.zadaniaMb });

/**
 * Kontekst SERP. Zwraca { status, dane } gdy obsluzylismy zapytanie tutaj,
 * albo null gdy ma poleciec dotychczasowa sciezka do modelu.
 *
 * Aplikacja parsuje tresc bloku tekstowego jako JSON, wiec odpowiedz musi miec
 * ksztalt Anthropic z JSON-em w srodku - inaczej fetchSerpContext nic nie zrozumie.
 *
 * zrodlo: zrodlo SERP organizacji konta (dzierzawy.zrodloSerp: 'glowna' -> CAI_SERP,
 * inne -> CAI_SERP_SAMOOBSLUGA, nigdy 'openseo'); celModelu: dokad pojdzie wywolanie
 * modelu ('anthropic' albo 'nvidia' - klucz uzytkownika zawsze 'anthropic').
 * Po premierze (DECYZJE-R9) wlasne konto DataForSEO klienta: klucze.kluczDla(...,
 * 'dataforseo') zamiast KONF.dataForSeo w galezi 'dataforseo', bez innych zmian.
 */
async function obsluzSerp(body, zrodlo = KONF.serp, celModelu = KONF.dostawca) {
  const wAnthropic = (obiekt) => ({
    content: [{ type: 'text', text: JSON.stringify(obiekt) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  // Przez OpenSEO: te same dane DataForSEO, ale zapytanie idzie przez kontener,
  // wiec wynik laduje tez w jego historii i widac go w panelu SEO. Wymaga
  // wskazania projektu (CAI_SEO_PROJEKT), bo narzedzia OpenSEO sa projektowe.
  if (zrodlo === 'openseo') {
    const fraza = serp.frazaZZadania(body);
    if (!fraza) return { status: 200, dane: wAnthropic({ context: '', topics: [], phrases: [] }) };
    if (!KONF.openseo.portNasluchu || !KONF.seoProjekt) {
      console.error('[serp] CAI_SERP=openseo wymaga CAI_OPENSEO_PORT i CAI_SEO_PROJEKT');
      return { status: 500, dane: { content: [], error: { komunikat: 'OpenSEO nie jest skonfigurowane jako zrodlo SERP' } } };
    }
    try {
      const surowe = await openseoMcp.wolaj(
        'get_serp_results',
        { projectId: KONF.seoProjekt, queries: [{ keyword: fraza }] },
        { ...KONF.openseo, timeoutMs: KONF.czasy.serp },
        { platne: true }
      );
      const wynik = serp.zbudujWynik(openseoMcp.serpJakDataForSeo(surowe, fraza), fraza);
      wynik.zrodlo = 'openseo';
      console.log(`[serp] openseo "${fraza}": ${wynik.wynikow} wynikow`);
      return { status: 200, dane: wAnthropic(wynik) };
    } catch (e) {
      console.error('[serp] openseo:', e.message);
      if (e.status === 504) {
        return { status: 504, dane: { content: [], error: { type: 'timeout_error', message: 'OpenSEO nie odpowiedziało w czasie. Spróbuj ponownie za chwilę.' } } };
      }
      return { status: 502, dane: { content: [], error: { komunikat: 'Nie udalo sie pobrac danych SERP z OpenSEO' } } };
    }
  }

  if (zrodlo === 'dataforseo') {
    if (!KONF.dataForSeo.login || !KONF.dataForSeo.haslo) {
      console.error('[serp] CAI_SERP=dataforseo, ale brak DATAFORSEO_LOGIN/DATAFORSEO_HASLO');
      return { status: 500, dane: { content: [], error: { komunikat: 'Brak danych dostepowych DataForSEO' } } };
    }
    const fraza = serp.frazaZZadania(body);
    if (!fraza) return { status: 200, dane: wAnthropic({ context: '', topics: [], phrases: [] }) };
    try {
      const wynik = await serp.zDataForSeo(fraza, serp.jezykZZadania(body),
        { ...KONF.dataForSeo, czasMs: KONF.czasy.serp });
      console.log(`[serp] dataforseo "${fraza}": ${wynik.wynikow} wynikow`);
      return { status: 200, dane: wAnthropic(wynik) };
    } catch (e) {
      console.error('[serp] dataforseo:', e.message);
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        return { status: 504, dane: { content: [], error: { type: 'timeout_error', message: 'DataForSEO nie odpowiedziało w czasie. Spróbuj ponownie za chwilę.' } } };
      }
      return { status: 502, dane: { content: [], error: { komunikat: 'Nie udalo sie pobrac danych SERP' } } };
    }
  }

  // CAI_SERP=model, ale dostawca nie ma web_search - lepiej powiedziec to wprost,
  // niz pozwolic modelowi zmyslic dane SERP i podac je dalej jako fakty.
  if (celModelu !== 'anthropic') {
    console.error(`[serp] dostawca ${celModelu} nie obsluguje web_search; ustaw CAI_SERP=dataforseo albo openseo`);
    return {
      status: 501,
      dane: {
        content: [],
        error: { komunikat: 'Analiza SERP wymaga dostawcy anthropic albo CAI_SERP=dataforseo/openseo' },
      },
    };
  }

  return null;
}

// ─── Pakiety: limity i zliczanie ──────────────────────────────────────────────

/** Konto z bazy (odczytane juz przy kontroli sesji) - plan i rola sa tam, nie w ciasteczku. */
function kontoSesji(sesja) {
  if (sesja && sesja.konto) return sesja.konto;
  return magazyn.kontoZOrganizacja(sesja.login) || { login: sesja.login, rola: sesja.rola };
}

/**
 * Zwraca opis odmowy albo null, gdy wolno. Komunikat jest budowany tak, zeby
 * aplikacja miala z czego zrobic sensowny ekran, a nie tylko "brak dostepu":
 * widac plan, limit, zuzycie i to, czy limit sie kiedykolwiek odnowi.
 */
function odmowaLimitu(sesja, czynnosc) {
  const konto = kontoSesji(sesja);
  const wynik = plany.sprawdzLimit({ konto, czynnosc });
  if (wynik.wolno) return null;

  if (wynik.powod === 'nieznana-czynnosc') {
    console.error(`[plany] nieznana czynnosc: ${czynnosc}`);
    return { error: 'Nieznana czynność', czynnosc };
  }

  return {
    error: 'Limit pakietu wyczerpany',
    czynnosc,
    plan: wynik.plan,
    limit: wynik.limit,
    zuzyte: wynik.zuzyte,
    // 'zawsze' znaczy, ze licznik sie nie odnowi - jedyne wyjscie to wyzszy pakiet
    odnawialny: wynik.okres === 'miesiac',
  };
}

/**
 * Co obciazyc za to zapytanie do /api. Zawsze wywolanie modelu, a dodatkowo
 * artykul - ale tylko gdy aplikacja sama zadeklaruje, ze to wlasnie artykul.
 *
 * Jedno generowanie to kilka wywolan modelu (brief, tresc, korekta, przerobki).
 * Liczenie kazdego jako artykulu zjadaloby pakiet darmowy w polowie pierwszego
 * tekstu. Naglowek pochodzi z przegladarki i da sie go nie wyslac - dlatego
 * osobny licznik `wywolanie` jest sufitem kosztu niezaleznym od deklaracji.
 */
function czynnosciTresci(req) {
  const deklaracja = String(req.headers['x-cai-czynnosc'] || '').toLowerCase();
  return deklaracja === 'artykul' ? ['wywolanie', 'artykul'] : ['wywolanie'];
}

/**
 * KOD8-20: limit rezerwowany przed wywolaniem dostawcy (atomowo w bazie), wiec zapytania wyslane
 * naraz nie omijaja limitu. -> { rezerwacja } albo { odmowa } w dzisiejszym ksztalcie 402.
 * Potwierdzenie: policzUzycie po sukcesie; zwolnienie: finally w wykonaj (blad, przerwanie, czas).
 */
function zarezerwujLimit(sesja, czynnosci) {
  const r = plany.zarezerwuj({ konto: kontoSesji(sesja), czynnosci: czynnosci.filter(Boolean) });
  if (r.wolno) return { rezerwacja: r.rezerwacja };
  return { odmowa: odmowaLimitu(sesja, r.czynnosc) || { error: 'Limit pakietu wyczerpany', czynnosc: r.czynnosc } };
}

/** Dopisuje uzycie po udanej odpowiedzi dostawcy (z rezerwacja: potwierdza zarezerwowana sztuke). */
function policzUzycie(sesja, czynnosc) {
  try {
    plany.policz({ konto: kontoSesji(sesja), czynnosc, rezerwacja: sesja && sesja.rezerwacja });
  } catch (e) {
    // Blad licznika nie moze zabrac uzytkownikowi gotowego wyniku - lepiej
    // policzyc o jedno mniej niz oddac blad na juz wykonana prace.
    console.error('[plany] zapis uzycia:', e.message);
  }
}


// ─── Zasoby oplacane przez serwer dla kont na wlasnym kluczu (ARCH8-11) ──────
// Konto 'wlasne' placi samo za model, ale serwer nadal placi za dane SERP z DataForSEO,
// wektory NVIDIA i pobieranie stron (pasmo i adres IP serwera). Dla takich kont te zasoby
// maja pule z pakietu (plany.limitySerwera), a konto samoobslugowe najpierw potwierdza
// e-mail (zasoby serwera dopiero po potwierdzeniu, ARCH8-05). Konta zespolu ('serwera')
// dzialaja jak dzis: bez puli i bez warunku.

/** Czy konto musi najpierw potwierdzic e-mail, zeby uzyc zasobow serwera. */
function czekaNaPotwierdzenie(konto) {
  return plany.naWlasnymKluczu(konto) && konto.pochodzenie === 'samoobsluga' && !konto.emailPotwierdzony;
}

/**
 * Odmowa uzycia zasobu serwera albo null (wolno).
 *   -> { kod: 'email-niepotwierdzony', status: 403, pola } | { kod: 'zasob-serwera-wyczerpany', status: 402, pola }
 */
function odmowaZasobu(konto, zasob, akcja) {
  if (!plany.naWlasnymKluczu(konto)) return null;
  if (czekaNaPotwierdzenie(konto)) {
    return { kod: 'email-niepotwierdzony', status: 403, pola: { akcja, error: 'Potwierdź adres e-mail, żeby korzystać z tej funkcji.' } };
  }
  const s = plany.sprawdzLimitSerwera(konto, zasob);
  if (s.wolno) return null;
  return {
    kod: 'zasob-serwera-wyczerpany',
    status: 402,
    pola: { zasob, limit: s.limit, zuzyte: s.zuzyte, odnawialny: s.okres === 'miesiac', akcja, error: 'Wyczerpano pulę zasobów serwera w Twoim pakiecie.' },
  };
}

/** Dopisuje uzycie zasobu serwera (konta 'serwera': nic); blad licznika nie zabiera wyniku. */
function policzZasob(konto, zasob, ile = 1) {
  try {
    plany.policzSerwer(konto, zasob, ile);
  } catch (e) {
    console.error('[plany] zapis zasobu serwera:', e.message);
  }
}

/**
 * Wektory bazy wiedzy dla konta. Konto 'wlasne' bez potwierdzonego e-maila albo bez puli
 * (D-09: pula 0 we wszystkich pakietach) szuka po slowach kluczowych - bez NVIDIA.
 *   -> { konf, liczyc, powod: null|'email-niepotwierdzony'|'limit-pakietu' }
 */
function wektoryDla(konto) {
  if (!plany.naWlasnymKluczu(konto) || !KONF.wektory.klucz) return { konf: KONF.wektory, liczyc: false, powod: null };
  if (czekaNaPotwierdzenie(konto)) return { konf: { ...KONF.wektory, klucz: '' }, liczyc: false, powod: 'email-niepotwierdzony' };
  if (!plany.sprawdzLimitSerwera(konto, 'wektory').wolno) return { konf: { ...KONF.wektory, klucz: '' }, liczyc: false, powod: 'limit-pakietu' };
  return { konf: KONF.wektory, liczyc: true, powod: null };
}

/**
 * 403 dla zmiany ustawien organizacji (marka, baza wspolna) przez kogos, kto nia nie
 * zarzadza (ARCH8-09). W glownej jak dzis ({ error } z napisem), w samoobslugowej kod
 * uprawnienia-organizacji.
 */
function odmowaOrganizacji(req, res, konto, napisGlownej) {
  if (req && req.readable) req.resume();
  if (dzierzawy.idOrganizacji(konto) === dzierzawy.GLOWNA) return odpowiedzJson(res, 403, { error: napisGlownej });
  return bledy.bladCai(res, 'uprawnienia-organizacji', 403);
}

/**
 * Cialo zapytania proxy. Kopia zadania w tle niesie juz przeczytane cialo (cialoGotowe):
 * bez drugiego czytania i drugiej kopii w pamieci (do 25 MB nagrania, KOD8-05).
 */
function cialoZadania(req, limitBajtow = 25 * 1024 * 1024) {
  if (req && Buffer.isBuffer(req.cialoGotowe)) {
    if (req.cialoGotowe.length > limitBajtow) {
      const e = new Error('cialo zadania za duze');
      e.status = 413;
      e.limitMB = Math.round(limitBajtow / 1024 / 1024);
      return Promise.reject(e);
    }
    return Promise.resolve(req.cialoGotowe);
  }
  return czytajCialo(req, limitBajtow).catch((e) => {
    // Limit trasy (grafika 1 MB, reszta 25 MB) do komunikatu 413.
    if (e && e.status === 413) e.limitMB = Math.round(limitBajtow / 1024 / 1024);
    throw e;
  });
}

async function proxyTresc(req, res, sesja, czynnosci = ['wywolanie']) {
  const konto = kontoSesji(sesja);
  let body;
  try {
    body = JSON.parse((await cialoZadania(req)).toString('utf8'));
  } catch (e) {
    if (e && e.status === 413) throw e;
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }

  // Granice kosztu: model z listy aplikacji i sufit max_tokens.
  const odmowa = odmowaKosztuTresci(body);
  if (odmowa) {
    return odpowiedzJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: odmowa }, komunikat: odmowa });
  }

  // Klucz (BYOK): konto 'wlasne' bez wlasnego klucza konczy sie odmowa, nigdy kluczem
  // serwera; klucz uzytkownika idzie zawsze do Anthropic (cel 'anthropic', SEC8-03).
  const k = klucze.kluczDla(req, konto, 'anthropic', KONF);

  // Zapytanie o kontekst SERP obslugujemy osobno - patrz serwer/serp.js.
  // Rozpoznajemy je po tresci (prompt analizy SERP), a nie po samym narzedziu
  // web_search: to dostaje tez artykul z przelacznikiem sieci i monitor AI.
  if (serp.czyZapytanieSerp(body, req.headers)) {
    // Analiza SERP kosztuje osobno (DataForSEO albo dluzsze wywolanie modelu),
    // wiec jest funkcja pakietowa, a nie czescia limitu artykulow.
    if (sesja && !plany.maFunkcje(konto, 'serp')) {
      return bledy.bladCai(res, 'funkcja-poza-pakietem', 402, {
        content: [],
        error: { komunikat: 'Analiza SERP jest dostępna od pakietu Standard.' },
        funkcja: 'serp',
      });
    }
    // Zrodlo SERP organizacji konta: 'glowna' -> CAI_SERP, inne -> CAI_SERP_SAMOOBSLUGA (ARCH8-09).
    const zrodlo = dzierzawy.zrodloSerp(konto, KONF);
    if (zrodlo === 'dataforseo' || zrodlo === 'openseo') {
      // Dane SERP oplaca serwer: konto na wlasnym kluczu ma na nie pule pakietu (ARCH8-11).
      const odmowaSerp = odmowaZasobu(konto, 'serp', 'serp');
      if (odmowaSerp) return bledy.bladCai(res, odmowaSerp.kod, odmowaSerp.status, { content: [], ...odmowaSerp.pola });
      const wynik = await obsluzSerp(body, zrodlo);
      if (wynik.status < 400 && !res.destroyed) {
        policzUzycie(sesja, 'wywolanie');
        policzZasob(konto, 'serp');
      }
      return odpowiedzJson(res, wynik.status, wynik.dane);
    }
    // 'model': SERP to wywolanie modelu z web_search na kluczu konta (koszt wyszukiwania
    // po stronie klucza uzytkownika przy BYOK), bez puli serwera.
    if (k.blad) return odmowaKlucza(req, res, k.blad);
    const wynik = await obsluzSerp(body, zrodlo, k.cel);
    if (wynik) {
      if (wynik.status < 400 && !res.destroyed) policzUzycie(sesja, 'wywolanie');
      return odpowiedzJson(res, wynik.status, wynik.dane);
    }
    // null = zostaw dotychczasowa sciezke (Anthropic z web_search)
  }

  if (k.blad) return odmowaKlucza(req, res, k.blad);

  const h = hamulec(res, dlugieGenerowanie(body, czynnosci) ? KONF.czasy.dlugi : KONF.czasy.tresc);
  try {
    // NVIDIA tylko z kluczem serwera (konto zespolu przy CAI_DOSTAWCA=nvidia): klucz
    // uzytkownika ma zawsze cel 'anthropic' i do NVIDIA nie trafia (SEC8-03).
    if (k.cel === 'nvidia') {
      if (!k.klucz) return odpowiedzJson(res, 500, { error: 'Brak NVIDIA_KEY na serwerze' });
      const { odp, cialo: surowe } = await fetchZHamulcem(KONF.urlNvidia, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k.klucz },
        body: JSON.stringify(anthropicNaOpenai(body)),
      }, h);
      let dane = null;
      try { dane = JSON.parse(surowe); } catch { /* dostawca zwrocil cos innego niz JSON */ }
      if (!odp.ok) {
        // Log po stronie serwera - w przegladarce nie pokazujemy szczegolow dostawcy
        console.error(`[nvidia] HTTP ${odp.status}: ${surowe.slice(0, 300)}`);
        return odpowiedzJson(res, odp.status, {
          content: [],
          error: { komunikat: `Dostawca NVIDIA odrzucil zadanie (HTTP ${odp.status})` },
        });
      }
      if (!h.klientCzeka()) return undefined;
      for (const czynnosc of czynnosci) policzUzycie(sesja, czynnosc);
      return odpowiedzJson(res, 200, openaiNaAnthropic(dane));
    }

    if (!k.klucz) return odpowiedzJson(res, 500, { error: 'Brak ANTHROPIC_KEY na serwerze' });
    const { odp, cialo: tekst } = await fetchZHamulcem(KONF.urlAnthropic, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': k.klucz,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, h);
    if (!h.klientCzeka()) return undefined;
    if (odp.ok) for (const czynnosc of czynnosci) policzUzycie(sesja, czynnosc);
    return wyslij(res, odp.status, {
      'Content-Type': 'application/json; charset=utf-8', ...naglowkiZlegoKlucza(k, odp.status, tekst, 'anthropic'),
    }, Buffer.from(tekst, 'utf8'));
  } finally {
    h.zwolnij();
  }
}

async function proxyGrafika(req, res, sesja) {
  const k = klucze.kluczDla(req, kontoSesji(sesja), 'openai', KONF);
  if (k.blad) return odmowaKlucza(req, res, k.blad);
  if (!k.klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  let body;
  try {
    body = JSON.parse((await cialoZadania(req, 1024 * 1024)).toString('utf8'));
  } catch (e) {
    if (e && e.status === 413) throw e;
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }
  const odmowa = odmowaKosztuGrafiki(body);
  if (odmowa) return odpowiedzJson(res, 400, { error: { message: odmowa, type: 'invalid_request_error' }, komunikat: odmowa });
  const cialo = { ...body, n: 1 };
  if (KONF.modelGrafiki) cialo.model = KONF.modelGrafiki;
  return wolajOpenAi(res, KONF.urlOpenai + '/images/generations', k, JSON.stringify(cialo),
    'application/json', KONF.czasy.obrazy, sesja, 'grafika');
}

async function proxyOpenAiJson(req, res, url, sesja, czynnosc, czasMs) {
  const k = klucze.kluczDla(req, kontoSesji(sesja), 'openai', KONF);
  if (k.blad) return odmowaKlucza(req, res, k.blad);
  if (!k.klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const cialo = await cialoZadania(req);
  return wolajOpenAi(res, url, k, cialo, 'application/json', czasMs, sesja, czynnosc);
}

async function proxyTranskrypcja(req, res, sesja) {
  const k = klucze.kluczDla(req, kontoSesji(sesja), 'openai', KONF);
  if (k.blad) return odmowaKlucza(req, res, k.blad);
  if (!k.klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const typ = req.headers['content-type'] || 'multipart/form-data';
  const cialo = await cialoZadania(req);
  return wolajOpenAi(res, KONF.urlOpenai + '/audio/transcriptions', k, cialo, typ, KONF.czasy.transkrypcja, sesja, 'transkrypcja');
}

/** Wspolna droga do OpenAI: hamulec, liczenie po sukcesie, odpowiedz bez zmian. */
async function wolajOpenAi(res, url, k, cialo, typ, czasMs, sesja, czynnosc) {
  const h = hamulec(res, czasMs);
  try {
    const { odp, cialo: bufor } = await fetchZHamulcem(url, {
      method: 'POST',
      headers: { 'Content-Type': typ, Authorization: 'Bearer ' + k.klucz },
      body: cialo,
    }, h, 'bufor');
    if (!h.klientCzeka()) return undefined;
    if (odp.ok) policzUzycie(sesja, czynnosc);
    return wyslij(res, odp.status, {
      'Content-Type': odp.headers.get('content-type') || 'application/json; charset=utf-8',
      ...naglowkiZlegoKlucza(k, odp.status, bufor, 'openai'),
    }, bufor);
  } finally {
    h.zwolnij();
  }
}

async function proxyEleven(req, res, sesja) {
  const k = klucze.kluczDla(req, kontoSesji(sesja), 'eleven', KONF);
  if (k.blad) return odmowaKlucza(req, res, k.blad);
  if (!k.klucz) return odpowiedzJson(res, 500, { error: 'Brak ELEVEN_KEY na serwerze' });
  let dane;
  try {
    dane = JSON.parse((await cialoZadania(req)).toString('utf8'));
  } catch (e) {
    if (e && e.status === 413) throw e;
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }
  const glos = dane.voice_id || '21m00Tcm4TlvDq8ikWAM';
  const format = dane.output_format || 'mp3_44100_128';
  const h = hamulec(res, KONF.czasy.audio);
  try {
    const { odp, cialo: bufor } = await fetchZHamulcem(
      KONF.urlEleven + '/text-to-speech/' + encodeURIComponent(glos) + '?output_format=' + encodeURIComponent(format),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': k.klucz },
        body: JSON.stringify({
          text: dane.text || '',
          model_id: dane.model_id || 'eleven_multilingual_v2',
        }),
      },
      h,
      'bufor'
    );
    if (!h.klientCzeka()) return undefined;
    if (odp.ok) policzUzycie(sesja, 'audio');
    return wyslij(res, odp.status, {
      'Content-Type': odp.headers.get('content-type') || 'audio/mpeg', ...naglowkiZlegoKlucza(k, odp.status, bufor, 'eleven'),
    }, bufor);
  } finally {
    h.zwolnij();
  }
}


// ─── Lagodne zatrzymanie (KOD8-07) ───────────────────────────────────────────
// systemctl restart (kazde wdrozenie) wysyla SIGTERM. Dawniej proces konczyl sie od razu
// i ucinal w pol kazde wywolanie dostawcy (artykul z siecia trwa 1-4 min), a Caddy oddawal
// przegladarce 502. Teraz po SIGTERM:
//   - nowe wywolania dostawcow dostaja 503 bez JSON-a z Retry-After (aplikacja ponawia je
//     jak odpowiedz bramy w oknie restartu), a reszta zapytan (strona, pakiet, baza) dziala,
//   - trwajace wywolania i zadania w tle koncza sie normalnie; wynik zadania w tle mozna
//     odebrac ponowieniem z tym samym X-Zadanie, dopoki proces zyje,
//   - wynik zadania gotowy, ale nieodebrany (klient zerwal polaczenie) czeka jeszcze do 15 s
//     na ponowienie, zeby oplacony artykul nie zginal razem z procesem,
//   - gdy nic juz nie trwa (najwyzej 120 s; TimeoutStopSec=150 w uslugach), serwer zamyka
//     port i baze, a proces konczy sie kodem 0. Drugi SIGTERM albo SIGINT konczy od razu.
// Port jest otwarty az do konca pracy, wiec nowy proces wstaje dopiero po starym: okno
// bez serwera to sam start (1-2 s), ktore Caddy przeczekuje dla GET (lb_try_duration).

const ZATRZYMANIE = { trwa: false, aktywne: 0, odMs: 0, obietnica: null };
const ZATRZYMANIE_MAKS_MS = 120_000;
const ZATRZYMANIE_NA_ODBIOR_MS = 15_000;

/** 413 z rozmiarem i rada zamiast 502 "blad dostawcy" (KOD8-16): nagranie, plik albo zapytanie za duze. */
function odpowiedzZaDuze(res, sciezka, mb = 25) {
  const komunikat = sciezka === '/api/transcribe'
    ? `Nagranie jest za duże: serwer przyjmuje najwyżej ${mb} MB. Skróć je albo zapisz w lżejszym formacie (np. MP3) i spróbuj ponownie.`
    : `Zapytanie jest za duże: serwer przyjmuje najwyżej ${mb} MB.`;
  return odpowiedzJson(res, 413, {
    type: 'error', error: { type: 'request_too_large', message: komunikat }, komunikat, limitMB: mb,
  });
}

/** 503 na czas zatrzymania: tekst (nie JSON), zeby aplikacja ponowila jak przy restarcie bramy. */
function odpowiedzRestartu(res) {
  if (res.headersSent || res.destroyed) return;
  wyslij(res, 503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' },
    Buffer.from('Serwer właśnie się aktualizuje. Spróbuj ponownie za kilka sekund.\n', 'utf8'));
}

/**
 * Konczy prace w toku, potem zamyka serwery i baze. -> obietnica kodu wyjscia (0).
 *   lagodneZatrzymanie([serwerAplikacji, bramaOpenSeo], { maksMs, naOdbiorMs, coIleMs, loguj })
 */
function lagodneZatrzymanie(serwery, {
  maksMs = ZATRZYMANIE_MAKS_MS, naOdbiorMs = ZATRZYMANIE_NA_ODBIOR_MS, coIleMs = 200, loguj = console,
} = {}) {
  if (ZATRZYMANIE.obietnica) return ZATRZYMANIE.obietnica;
  ZATRZYMANIE.trwa = true;
  ZATRZYMANIE.odMs = Date.now();
  loguj.log(`[serwer] zatrzymanie: czekam na ${ZATRZYMANIE.aktywne} zapytan i ${zadaniaWTle.trwajace()} zadan w tle `
    + `(najwyzej ${Math.round(maksMs / 1000)} s), nowe wywolania dostawcow -> 503`);
  ZATRZYMANIE.obietnica = new Promise((ok) => {
    let wyszlo = false;
    const wyjdz = () => {
      if (wyszlo) return;
      wyszlo = true;
      try { magazyn.zamknij(); } catch (e) { loguj.error('[serwer] zamkniecie bazy:', e.message); }
      ok(0);
    };
    const zakoncz = (opis) => {
      clearInterval(zegar);
      loguj.log(`[serwer] zatrzymanie: ${opis}, zamykam port`);
      let zamkniete = 0;
      for (const s of serwery) s.close(() => { zamkniete += 1; if (zamkniete >= serwery.length) wyjdz(); });
      // Polaczenia, ktore nie skoncza sie same (zawieszony klient), konczymy po 5 s.
      setTimeout(() => { for (const s of serwery) if (typeof s.closeAllConnections === 'function') s.closeAllConnections(); }, 5000).unref();
      setTimeout(wyjdz, 8000).unref();
    };
    const zegar = setInterval(() => {
      const zostalo = ZATRZYMANIE.aktywne + zadaniaWTle.trwajace();
      const doOdbioru = zostalo === 0 ? zadaniaWTle.nieodebrane(naOdbiorMs) : 0;
      if (zostalo === 0 && doOdbioru === 0) zakoncz(`praca w toku skonczona po ${Math.round((Date.now() - ZATRZYMANIE.odMs) / 100) / 10} s`);
      else if (Date.now() - ZATRZYMANIE.odMs >= maksMs) zakoncz(`limit ${Math.round(maksMs / 1000)} s, przerwane: ${zostalo}`);
    }, coIleMs);
  });
  return ZATRZYMANIE.obietnica;
}

// ─── Logowanie ────────────────────────────────────────────────────────────────
// Wydzielone z routera, bo tego samego ekranu uzywa port OpenSEO - jedno konto
// i jedno logowanie na obie aplikacje.

/** Wspolny ogon ciasteczka sesji; domena tylko wtedy, gdy ustawiona w konfiguracji. */
function atrybutyCiasteczka() {
  return (
    '; HttpOnly; SameSite=Lax; Path=/' +
    (KONF.cookieDomena ? `; Domain=${KONF.cookieDomena}` : '') +
    (KONF.cookieSecure ? '; Secure' : '')
  );
}

/** Naglowek Set-Cookie z nowa sesja konta (logowanie, rejestracja, reset hasla). */
function ciasteczkoSesji(konto) {
  return `cai_auth=${utworzSesje(konto)}${atrybutyCiasteczka()}; Max-Age=${KONF.sesjaGodzin * 3600}`;
}

/** Naglowek Set-Cookie kasujacy sesje w przegladarce (wylogowanie, wyloguj wszedzie, usuniecie konta). */
function ciasteczkoWylogowania() {
  return `cai_auth=${atrybutyCiasteczka()}; Max-Age=0`;
}

/** Jezyk ekranow serwera: ?lang=, pole formularza, potem Accept-Language. */
function jezykZadania(req, wybrany) {
  const jawny = String(wybrany || '').toLowerCase();
  if (jawny === 'pl' || jawny === 'en') return jawny;
  try {
    const q = new URL(req.url, 'http://x').searchParams.get('lang');
    if (q === 'pl' || q === 'en') return q;
  } catch { /* zly adres - zostaje naglowek */ }
  return logowanie.jezykZNaglowka(req.headers['accept-language']);
}

function stronaLogowania(kod, req, jezyk, login) {
  return logowanie.stronaLogowania({
    kod, jezyk: jezyk || (req ? jezykZadania(req) : 'pl'), sciezka: '/auth/login',
    // Login wraca do pola tylko w poprawnym formacie - nic obcego nie trafia do HTML.
    login: poprawnyLogin(login) || konta.emailDoPola(login) ? login : '',
    // R9-A1: "Zaloz konto" przy otwartej rejestracji, "Nie pamietasz hasla?" zawsze poza trybem
    // bramy (bez poczty /haslo mowi, ze haslo konta zespolu zmienia administrator). Port OpenSEO
    // ma inny host, wiec tam odnosniki prowadza na adres aplikacji (albo ich nie ma).
    rejestracja: funkcjaWlaczona('rejestracja'),
    reset: !KONF.zaufanyNaglowek && (kod !== 'openseo' || Boolean(KONF.adresPubliczny)),
    bazaLinkow: kod === 'openseo' ? KONF.adresPubliczny : '',
  });
}

/**
 * Konto z pola `login` formularza (ARCH8-04): ze znakiem @ to e-mail (konto po adresie
 * znormalizowanym jak przy zapisie), bez niego dzisiejszy login. Nazwa pola zostaje
 * `login` (kontrakt bramy OpenSEO i testow).
 */
function kontoDoLogowania(login) {
  if (login.includes('@')) return login.length <= 254 ? magazyn.kontoPoEmailu(login) : null;
  return poprawnyLogin(login) ? magazyn.konto(login) : null;
}

async function obslugaLogowania(req, res) {
  const html = 'text/html; charset=utf-8';
  // Formularz logowania wysyla tylko nasza wlasna strona. Logowanie z obcej
  // (login CSRF) wpinaloby ofiare w konto napastnika.
  if (obcePochodzenie(req)) {
    return odpowiedzTekst(res, 403, stronaLogowania('obce-zrodlo', req), html);
  }
  const ip = adresIp(req);
  if (zablokowany(ip)) {
    return odpowiedzTekst(res, 429, stronaLogowania('za-duzo-prob', req), html);
  }
  const dane = new URLSearchParams((await czytajCialo(req, 8192)).toString('utf8'));
  const login = (dane.get('login') || '').trim();
  const haslo = dane.get('haslo') || '';
  const jezyk = jezykZadania(req, dane.get('jezyk'));
  const uzytkownik = kontoDoLogowania(login);

  // Licznik nieudanych prob per konto (ARCH8-05, SEC8-24): e-mail jest publiczny, wiec
  // zgadywanie hasla z wielu adresow IP ograniczamy tez na koncie (20 na godzine ->
  // 15 minut blokady). Nieistniejacy adres ma licznik po wpisanym tekscie i zachowuje
  // sie tak samo, wiec blokada nie zdradza, czy konto istnieje. Reset hasla dziala mimo niej.
  const kluczProb = konta.probyLogowania.klucz(uzytkownik, login);
  if (konta.probyLogowania.zablokowane(kluczProb)) {
    return odpowiedzTekst(res, 429, stronaLogowania('za-duzo-prob-konto', req, jezyk, login), html);
  }

  // scrypt liczy sie zawsze, takze dla nieistniejacego loginu - inaczej czas
  // odpowiedzi (1 ms wobec 50 ms) zdradzalby, ktore loginy istnieja. Liczony
  // asynchronicznie (pula watkow), wiec nie zatrzymuje generowania innym.
  let pasuje = false;
  try {
    pasuje = await hasloPasujeAsync(haslo, uzytkownik || await atrapaKontaAsync());
  } catch (e) {
    if (e instanceof BladZajety) return odpowiedzTekst(res, 429, stronaLogowania('za-duzo-prob', req, jezyk, login), html);
    throw e;
  }
  if (!uzytkownik || !pasuje) {
    nieudanaProba(ip);
    konta.probyLogowania.porazka(kluczProb);
    return odpowiedzTekst(res, 401, stronaLogowania('zle-dane', req, jezyk, login), html);
  }

  proby.delete(ip);
  konta.probyLogowania.sukces(kluczProb);
  try {
    magazyn.zmienKonto(uzytkownik.login, { ostatnieLogowanie: Date.now() });
  } catch (e) {
    // Znacznik ostatniego logowania (sprzatanie kont niepotwierdzonych) nie moze zablokowac wejscia.
    if (!(e instanceof pliki.BladDanych)) throw e;
    console.error('[logowanie] zapis ostatniego logowania:', e.message);
  }
  res.writeHead(302, { Location: '/', 'Set-Cookie': ciasteczkoSesji(uzytkownik) });
  return res.end();
}

// ─── CSRF ─────────────────────────────────────────────────────────────────────
// SameSite=Lax nie chroni przed zadaniami z tej samej domeny nadrzednej:
// content-ai.net (strona produktowa) i seo. sa dla przegladarki ta sama
// "strona" co aplikacja. Dlatego zadania zmieniajace stan musza przyjsc
// z tego samego pochodzenia:
//   - Sec-Fetch-Site (wszystkie wspolczesne przegladarki) musi byc same-origin,
//   - Origin, gdy jest, musi wskazywac ten sam host co zadanie.
// Brak obu naglowkow = klient spoza przegladarki (curl, skrypt) - on i tak
// nie ma cudzego ciasteczka, wiec CSRF go nie dotyczy.

/** Powod odrzucenia albo null, gdy zadanie przyszlo z naszej strony. */
function obcePochodzenie(req) {
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin') return 'sec-fetch-site';
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* "null" albo smiec */ }
    if (!host || host !== String(req.headers.host || '')) return 'origin';
  }
  return null;
}

/** Czy cialo zadania jest zadeklarowane jako JSON. */
function typJson(req) {
  return /^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''));
}

// Endpointy przyjmujace inne cialo niz JSON: formularze logowania i
// wylogowania oraz nagrania do transkrypcji (multipart/form-data).
const BEZ_JSON = new Set(['/auth/login', '/auth/logout', '/api/transcribe']);

// ─── Dane z OpenSEO ───────────────────────────────────────────────────────────
// Zamysl: OpenSEO wie, co warto pisac (frazy sprawdzone i otagowane przez
// czlowieka), Content AI to pisze, a po napisaniu oddaje frazy z powrotem, zeby
// dalo sie sledzic pozycje. Petla zamyka sie bez przeklejania przez schowek.
//
// Podzial kosztow jest tu swiadomy: czytanie zapisanych fraz i oddawanie ich
// z powrotem nie kosztuje nic, bo dotyka tylko bazy OpenSEO. Badanie nowych fraz
// wola DataForSEO i jest platne za zapytanie, wiec wymaga jawnego potwierdzenia
// z aplikacji i trafia do logu z loginem osoby, ktora je uruchomila.

async function obsluzSeo(sciezka, req, res, sesja) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const konf = KONF.openseo;

  // Lista projektow - od niej zaczyna aplikacja, bo reszta narzedzi potrzebuje id.
  if (sciezka === '/api/seo/projekty' && req.method === 'GET') {
    const dane = await openseoMcp.wolaj('list_projects', {}, konf);
    return odpowiedzJson(res, 200, { projekty: openseoMcp.projektyDoAplikacji(dane) });
  }

  // Frazy zapisane w projekcie. Darmowe - czyta baze OpenSEO, nie DataForSEO.
  if (sciezka === '/api/seo/frazy' && req.method === 'GET') {
    const projekt = await projektDomyslny(url.searchParams.get('projekt'), konf);
    if (!projekt) return odpowiedzJson(res, 400, { error: 'Brak projektu' });
    const argumenty = { projectId: projekt, limit: 100 };
    const tag = url.searchParams.get('tag');
    const szukaj = url.searchParams.get('szukaj');
    if (tag) argumenty.tags = [tag];
    if (szukaj) argumenty.search = szukaj;
    const dane = await openseoMcp.wolaj('list_saved_keywords', argumenty, konf);
    return odpowiedzJson(res, 200, openseoMcp.frazyDoAplikacji(dane));
  }

  // Oddanie fraz do OpenSEO po napisaniu tekstu. Darmowe i idempotentne.
  if (sciezka === '/api/seo/frazy' && req.method === 'POST') {
    const dane = await cialoJson(req);
    const frazy = (Array.isArray(dane.frazy) ? dane.frazy : [])
      .map((f) => String(f || '').trim())
      .filter(Boolean)
      .slice(0, 100);
    if (!dane.projekt) return odpowiedzJson(res, 400, { error: 'Brak projektu' });
    if (!frazy.length) return odpowiedzJson(res, 400, { error: 'Brak fraz do zapisania' });

    const tagi = (Array.isArray(dane.tagi) ? dane.tagi : ['content-ai'])
      .map((t) => String(t || '').trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 20);

    const wynik = await openseoMcp.wolaj(
      'save_keywords',
      { projectId: String(dane.projekt), keywords: frazy, tags: tagi, tagMode: 'append' },
      konf
    );
    return odpowiedzJson(res, 200, { zapisano: frazy.length, tagi, wynik });
  }

  // Strony blisko czolowki (pozycje 4-20) - naturalna lista "co odswiezyc".
  // Wymaga podlaczonego Search Console i GA4 po stronie OpenSEO.
  if (sciezka === '/api/seo/okazje' && req.method === 'GET') {
    const projekt = url.searchParams.get('projekt');
    if (!projekt) return odpowiedzJson(res, 400, { error: 'Brak projektu' });
    const dane = await openseoMcp.wolaj(
      'get_search_opportunities',
      { projectId: projekt, limit: 25 },
      konf
    );
    return odpowiedzJson(res, 200, dane);
  }

  // Badanie nowych fraz. PLATNE - wola DataForSEO z tego samego salda, ktorego
  // uzywa Content AI. Bez jawnego potwierdzenia klient MCP odmowi wywolania.
  if (sciezka === '/api/seo/badaj' && req.method === 'POST') {
    const dane = await cialoJson(req);
    if (!dane.projekt) return odpowiedzJson(res, 400, { error: 'Brak projektu' });
    if (dane.potwierdzam !== true) {
      return odpowiedzJson(res, 400, { error: 'Badanie fraz jest platne - wymaga potwierdzenia.' });
    }
    const zarodki = (Array.isArray(dane.frazy) ? dane.frazy : [])
      .map((f) => String(f || '').trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!zarodki.length) return odpowiedzJson(res, 400, { error: 'Brak fraz wyjsciowych' });

    // Do logu, bo to wydatek: ma byc widac, kto go uruchomil.
    console.log(`[seo] platne badanie fraz (${zarodki.length}) - ${sesja.login}`);
    const wynik = await openseoMcp.wolaj(
      'research_keywords',
      { projectId: String(dane.projekt), seeds: zarodki.map((s) => ({ seed: s })) },
      konf,
      { platne: true }
    );
    return odpowiedzJson(res, 200, wynik);
  }

  return odpowiedzJson(res, 404, { error: 'Nieznany endpoint SEO' });
}

/**
 * Projekt, w kontekscie ktorego pytamy OpenSEO. Kolejnosc: to, co podala
 * aplikacja, potem CAI_SEO_PROJEKT, a na koncu pierwszy projekt z listy.
 *
 * Ostatni krok jest po to, zeby Brief dzialal bez zadnej konfiguracji: przy
 * jednym projekcie - a tak zaczyna kazdy - nie ma czego wybierac, wiec pytanie
 * uzytkownika o to byloby pustym krokiem.
 */
async function projektDomyslny(podany, konf) {
  if (podany) return podany;
  if (KONF.seoProjekt) return KONF.seoProjekt;
  try {
    const dane = await openseoMcp.wolaj('list_projects', {}, konf);
    return openseoMcp.projektyDoAplikacji(dane)[0]?.id || null;
  } catch (e) {
    return null;
  }
}

/** Cialo zadania jako JSON, z czytelnym bledem zamiast wyjatku. */
async function cialoJson(req, limitBajtow) {
  let surowe;
  try {
    surowe = await czytajCialo(req, limitBajtow);
  } catch {
    // Osobny komunikat: "Niepoprawny JSON" przy zadaniu wiekszym od limitu
    // wysylaloby szukajacego bledu w zle miejsce.
    const e = new Error('Cialo zadania za duze');
    e.status = 413;
    throw e;
  }
  try {
    return JSON.parse(surowe.toString('utf8'));
  } catch {
    const e = new Error('Niepoprawny JSON');
    e.status = 400;
    throw e;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

// ─── Kontekst dla modulow tras (rozdz. 4.1) ─────────────────────────────────
// Moduly nowych tras (konta, platnosci, klucze) nie wymagaja server.js (bez
// petli w require) - wszystko, czego potrzebuja, dostaja tutaj.

const POMOCNICY = {
  // moduly
  magazyn, plany, dzierzawy, limity, bledy, poczta, platnosci, oznaczenia, klucze, logowanie,
  bladCai: bledy.bladCai,
  // odpowiedzi i zapytania
  odpowiedzJson, odpowiedzTekst, wyslij, czytajCialo, cialoJson, typJson, obcePochodzenie, adresIp, jezykZadania,
  // sesje i hasla
  utworzSesje, ciasteczkoSesji, ciasteczkoWylogowania, atrybutyCiasteczka, zapiszWylogowanie,
  zahaszujAsync, hasloPasujeAsync, atrapaKontaAsync, BladZajety, podpisz, skrotEmaila,
  idKonta, poprawnyLogin, stronaLogowania, funkcjaWlaczona,
  // A1: publiczne ekrany kont rozpoznaja zalogowanego (np. /rejestracja -> aplikacja)
  sesjaZadania,
};

/**
 * Kontekst zapytania przekazywany modulom: { KONF, url, sciezka, jezyk, sesja, konto, ...POMOCNICY }.
 * konto = konto z organizacja (pole org) albo null bez sesji.
 */
function kontekstZadania(req, url, sesja = null) {
  return {
    ...POMOCNICY,
    KONF,
    url,
    sciezka: url.pathname,
    jezyk: jezykZadania(req),
    sesja,
    konto: sesja ? kontoSesji(sesja) : null,
  };
}

async function obsluz(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sciezka = url.pathname;
  const html = 'text/html; charset=utf-8';
  // 1. Naglowki bezpieczenstwa (ekrany platnosci nadpisuja CSP u siebie, ARCH8-19).
  ustawNaglowkiBezpieczenstwa(res, sciezka);

  // ─── 2. Prosba o dostep ze strony produktowej ──────────────────────────────
  // Endpoint bez logowania wolany z innego pochodzenia (content-ai.net), wiec ma
  // wlasne CORS zamiast kontroli CSRF. Zostaje dla zgodnosci (M-11).
  if (sciezka === '/api/prosba-o-dostep') {
    return prosby.obsluz(req, res, {
      dozwoloneOrigin: KONF.stronaOrigin, adresIp, czytajCialo, odpowiedzJson, typJson,
    });
  }

  // ─── 3. Webhook platnosci (B): bez sesji, bez kontroli CSRF, surowe cialo ───
  // Bezpieczenstwo to wylacznie podpis dostawcy (ARCH8-15). Wylaczone platnosci:
  // modul zwraca false i zapytanie idzie dalej jak dzis.
  if (sciezka.startsWith('/platnosci/webhook/')
    && await platnosci.obsluzWebhook(sciezka, req, res, kontekstZadania(req, url))) return undefined;

  // ─── 4. Publiczne ekrany kont (A1) z wlasna kontrola pochodzenia ────────────
  // /rejestracja, /potwierdz, /haslo, /haslo/nowe, /do-widzenia (GET i POST):
  // formularze sprawdzaja obcePochodzenie() same i odpowiadaja strona HTML 403,
  // jak logowanie. Rejestracja wylaczona: modul zwraca false, dalej jak dzis.
  if (konta.SCIEZKI_PUBLICZNE.includes(sciezka)
    && await konta.obsluzPubliczne(sciezka, req, res, kontekstZadania(req, url))) return undefined;

  // ─── 5. CSRF: zadania zmieniajace stan tylko z naszej strony ───────────────
  const zmienia = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (zmienia && sciezka !== '/auth/login') {
    const powod = obcePochodzenie(req);
    if (powod) {
      console.warn(`[csrf] odrzucone ${req.method} ${sciezka} (${powod}: ${req.headers.origin || req.headers['sec-fetch-site'] || '-'})`);
      return odpowiedzJson(res, 403, { error: 'Zadanie spoza aplikacji odrzucone', komunikat: 'Żądanie spoza aplikacji zostało odrzucone.' });
    }
    // Cialo JSON tylko z Content-Type application/json. Formularz z obcej
    // strony moze wyslac wylacznie text/plain, urlencoded albo multipart -
    // bez tego wymogu "prosty" POST omijalby preflight CORS.
    if ((sciezka === '/api' || sciezka.startsWith('/api/')) && !BEZ_JSON.has(sciezka) && !typJson(req)) {
      return odpowiedzJson(res, 415, { error: 'Wymagany Content-Type: application/json' });
    }
  }

  // ─── 6. Publiczne GET: dokumenty prawne (E) ─────────────────────────────────
  // /dokumenty/<nazwa> i /en/dokumenty/<nazwa> (regulamin, prywatnosc, odstapienie,
  // dpa, uslugodawca): bez logowania, dane uslugodawcy z konfiguracji (nie z repo).
  // Jezyk: przedrostek /en/, potem ?lang=pl|en, domyslnie polski.
  const dokument = /^\/(?:(en)\/)?dokumenty\/([a-z0-9-]{1,40})\/?$/.exec(sciezka);
  if (dokument) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return odpowiedzTekst(res, 405, 'Metoda niedozwolona');
    }
    const lang = url.searchParams.get('lang');
    const jezykDokumentu = dokument[1] === 'en' ? 'en' : (lang === 'en' || lang === 'pl' ? lang : 'pl');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return dokumentyPrawne.obsluz(req, res, { nazwa: dokument[2], jezyk: jezykDokumentu, konf: KONF });
  }

  // Logowanie (sekcja A1: obslugaLogowania, stronaLogowania)
  if (sciezka === '/auth/login' && req.method === 'POST') {
    // W trybie bramy nasz wlasny ekran logowania jest wylaczony - hasla
    // sprawdza brama, a przyjmowanie ich takze tutaj tworzyloby druga,
    // slabsza droge wejscia, omijajaca drugi skladnik.
    if (KONF.zaufanyNaglowek) return odpowiedzTekst(res, 404, 'Nie znaleziono');
    return obslugaLogowania(req, res);
  }

  if (sciezka === '/auth/logout') {
    const jezyk = jezykZadania(req);
    // W trybie bramy nie mamy czego uniewazniac: sesje trzyma brama i to u niej
    // trzeba sie wylogowac, wiec tylko tam odsylamy.
    if (KONF.zaufanyNaglowek) {
      return odpowiedzTekst(res, 200, logowanie.stronaWylogowaniaZBramy(jezyk), html);
    }
    // Aplikacja wylogowuje formularzem POST. GET zostaje dla zgodnosci (stare
    // zakladki), ale tylko z wlasnej strony albo wpisany recznie - link albo
    // obrazek z obcej strony dostaje ekran z przyciskiem zamiast wylogowania.
    if (req.method !== 'POST') {
      const sfs = req.headers['sec-fetch-site'];
      if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
        return odpowiedzTekst(res, 403, logowanie.stronaPotwierdzeniaWylogowania(jezyk), html);
      }
    }
    const s = sesjaZadania(req);
    // Wylogowanie zapisujemy na dysku, zeby przezylo restart - podpisane
    // ciasteczko samo w sobie jest wazne az do wygasniecia.
    if (s) {
      try { zapiszWylogowanie(s.id, s.wygasa); } catch (e) {
        console.error('[sesje] zapis wylogowania:', e.message);
      }
    }
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': `cai_auth=${atrybutyCiasteczka()}; Max-Age=0`,
    });
    return res.end();
  }

  // ─── 7. Wszystko ponizej wymaga zalogowania ─────────────────────────────────
  const sesja = sesjaZadania(req);
  if (!sesja) {
    // Endpointy programistyczne odpowiadaja JSON-em; strony - ekranem logowania.
    // `error` zostaje napisem: po nim aplikacja rozpoznaje blad wlasny serwera.
    if (sciezka.startsWith('/api') || sciezka.startsWith('/auth/')) {
      return bledy.bladCai(res, 'sesja', 401, { error: 'Niezalogowany' });
    }
    // Manifest i ikony musza byc dostepne przed zalogowaniem (instalacja PWA,
    // ikona karty na ekranie logowania); nie zawieraja nic osobistego.
    if (czyPublicznyPlik(sciezka)) return plikStatyczny(req, res, sciezka);
    res.setHeader('Cache-Control', 'no-store');
    return odpowiedzTekst(res, 200, stronaLogowania('', req), html);
  }

  // ─── 8. Trasy z sesja: najpierw nowe moduly, potem dzisiejsze trasy ─────────
  const konto = kontoSesji(sesja);
  const kontekst = kontekstZadania(req, url, sesja);
  // B: /konto/zakup, /konto/panel, /konto/platnosc, /api/platnosci/* (ARCH8-19)
  if (await platnosci.obsluz(sciezka, req, res, kontekst)) return undefined;
  // C: /api/klucze, /api/klucze/* (BYOK, SEC8-04)
  if (await klucze.obsluz(sciezka, req, res, kontekst)) return undefined;
  // A1: /konto, /konto/*, /api/konto, /api/konto/*
  if (await konta.obsluz(sciezka, req, res, kontekst)) return undefined;
  // C: GET /konto.js (ARCH8-24) - w sekcji "Aplikacja i pliki statyczne" ponizej.

  if (sciezka === '/auth/me') {
    return odpowiedzJson(res, 200, {
      login: sesja.login,
      rola: sesja.rola,
      email: konto.email || null,
      organizacja: dzierzawy.opisDlaAplikacji(konto),
    });
  }

  // Prosby o dostep - lista dla operatora serwera.
  if (sciezka === '/api/admin/prosby' && req.method === 'GET') {
    if (!dzierzawy.operator(konto)) return odpowiedzJson(res, 403, { error: 'Wymagana rola admin' });
    const ile = Math.min(Math.max(Number(url.searchParams.get('ile')) || 200, 1), 1000);
    const { wpisy, pominiete } = prosby.lista(ile);
    return odpowiedzJson(res, 200, { prosby: wpisy, pominiete });
  }

  // Status - tylko operator. Nie pokazuje kluczy, wylacznie czy sa ustawione.
  if (sciezka === '/api/status') {
    if (!dzierzawy.operator(konto)) return odpowiedzJson(res, 403, { error: 'Wymagana rola admin' });
    return odpowiedzJson(res, 200, {
      dostawca: KONF.dostawca,
      model: KONF.dostawca === 'nvidia' ? KONF.modelNvidia : 'claude (wg aplikacji)',
      klucze: {
        anthropic: Boolean(KONF.klucze.anthropic),
        openai: Boolean(KONF.klucze.openai),
        eleven: Boolean(KONF.klucze.eleven),
        nvidia: Boolean(KONF.klucze.nvidia),
      },
      serp: KONF.serp,
      wektory: Boolean(KONF.wektory.klucz),
      modelWektorow: KONF.wektory.model,
      dataForSeo: Boolean(KONF.dataForSeo.login && KONF.dataForSeo.haslo),
      openseo: Boolean(KONF.openseo.portNasluchu),
      openseoOdpowiada: KONF.openseo.portNasluchu ? await openseoMcp.czyDziala(KONF.openseo) : false,
      seoProjekt: Boolean(KONF.seoProjekt),
      cookieDomena: Boolean(KONF.cookieDomena),
      uzytkownikow: magazyn.liczbaKont(),
      // Sesji nie da sie zliczyc - sa bezstanowe, po stronie przegladarek.
      // Zamiast tego pokazujemy, ile jest recznych wylogowan w mocy.
      wylogowanychSesji: magazyn.liczbaOdwolanych(),
      // Runda 9 (ARCH8-25): magazyn, wylaczone funkcje z powodem, platnosci, poczta.
      magazyn: magazyn.stan(),
      konfiguracja: stanKonfiguracji(),
      platnosci: platnosci.stan(),
      poczta: poczta.stan(),
      oznaczenia: KONF.oznaczenia,
      // C: zapis kluczy uzytkownikow (liczniki, bez wartosci) i pamiec zadan w tle.
      kluczeUzytkownikow: klucze.stan(KONF),
      zadania: zadaniaWTle.stan(),
    });
  }

  // Wlasny pakiet: limity, zuzycie i dostepne funkcje. Kazdy widzi swoj.
  if (sciezka === '/api/pakiet' && req.method === 'GET') {
    return odpowiedzJson(res, 200, plany.stanPakietu({ konto }));
  }

  // ─── Konfiguracja marki ────────────────────────────────────────────────────
  // Jedna na organizacje (dzierzawy, ARCH8-09, SEC8-51): zespol glowny ma dzisiejszy plik
  // (czytaja wszyscy w zespole, pisze administrator), konto samoobslugowe wlasna marke,
  // ktora edytuje jej wlasciciel. Wczesniej siedziala w localStorage przegladarki, wiec
  // kazdy uzytkownik mial wlasna kopie, a nowa osoba w zespole zaczynala od pustej.
  if (sciezka === '/api/marka' && req.method === 'GET') {
    return odpowiedzJson(res, 200, {
      marka: marka.wczytaj(KONF.katalogMarki, dzierzawy.idOrganizacji(konto)),
      zakres: dzierzawy.opisDlaAplikacji(konto).rodzaj,
      mozeEdytowac: dzierzawy.mozeZarzadzac(konto, konto.org),
    });
  }

  if (sciezka === '/api/marka' && req.method === 'POST') {
    // Zapis: w glownej administrator jak dzis, w samoobslugowej jej wlasciciel.
    if (!dzierzawy.mozeZarzadzac(konto, konto.org)) return odmowaOrganizacji(req, res, konto, 'Konfiguracje marki zmienia administrator');
    let dane;
    try {
      // Po oczyszczeniu konfiguracja ma najwyzej okolo 18 kB - 64 kB to zapas
      // na formatowanie JSON-a, nie zaproszenie do wysylania czegokolwiek.
      dane = await cialoJson(req, 64 * 1024);
    } catch (e) {
      return odpowiedzJson(res, e.status || 400, { error: e.message });
    }
    return odpowiedzJson(res, 200, { marka: marka.zapisz(KONF.katalogMarki, dane, dzierzawy.idOrganizacji(konto)) });
  }

  // ─── Pobranie strony WWW do bazy wiedzy ────────────────────────────────────
  // Zwyklym zadaniem HTTP, bez modelu. Nie liczy sie do pakietu artykulow, bo nie
  // kosztuje ani jednego tokenu; konto na wlasnym kluczu ma na to pule serwera
  // (pasmo i adres IP serwera, ARCH8-11) i potrzebuje potwierdzonego e-maila.
  if (sciezka === '/api/strona' && req.method === 'POST') {
    let dane;
    try {
      dane = await cialoJson(req);
    } catch (e) {
      return odpowiedzJson(res, e.status || 400, { error: e.message });
    }
    if (!wolnoWyjsc(sesja.login)) {
      return odpowiedzJson(res, 429, { error: 'Za duzo pobran w krotkim czasie. Sprobuj za chwile.' });
    }
    const odmowaStron = odmowaZasobu(konto, 'strony', 'strona');
    if (odmowaStron) return bledy.bladCai(res, odmowaStron.kod, odmowaStron.status, odmowaStron.pola);
    try {
      const pobrana = await strona.pobierz(String(dane.adres || ''));
      policzZasob(konto, 'strony', 1);
      return odpowiedzJson(res, 200, pobrana);
    } catch (e) {
      // 502, bo blad jest po stronie pobieranej witryny, nie zadania. Do
      // przegladarki idzie tylko nasz wlasny komunikat - komunikat bledu sieci
      // (adres, port, kod systemowy) mowilby za duzo o sieci serwera.
      if (!(e instanceof strona.BladStrony)) console.error('[strona]', e.message);
      return odpowiedzJson(res, 502, { error: e instanceof strona.BladStrony ? e.message : 'Nie udalo sie pobrac strony' });
    }
  }

  // ─── Sprawdzenie odnosnikow z gotowego artykulu ────────────────────────────
  // Przegladarka nie sprawdzi obcego adresu, bo nie wolno jej czytac
  // odpowiedzi. Serwer moze. Nie liczy sie do pakietu - to samo HTTP; dla konta
  // na wlasnym kluczu kazdy adres to jedna sztuka z puli stron serwera.
  if (sciezka === '/api/odnosniki' && req.method === 'POST') {
    let dane;
    try {
      dane = await cialoJson(req);
    } catch (e) {
      return odpowiedzJson(res, e.status || 400, { error: e.message });
    }
    const adresy = Array.isArray(dane.adresy) ? dane.adresy.map(String) : [];
    // Kazdy adres to osobne wyjscie w swiat, wiec liczy sie osobno.
    if (!wolnoWyjsc(sesja.login, adresy.length || 1)) {
      return odpowiedzJson(res, 429, { error: 'Za duzo sprawdzen w krotkim czasie. Sprobuj za chwile.' });
    }
    const odmowaStron = odmowaZasobu(konto, 'strony', 'odnosniki');
    if (odmowaStron) return bledy.bladCai(res, odmowaStron.kod, odmowaStron.status, odmowaStron.pola);
    // Pula prawie pusta: sprawdzamy tyle adresow, ile zostalo, reszta "nieznany" z powodem
    // (ta sama dlugosc i kolejnosc, ktorej oczekuje aplikacja).
    const pula = plany.sprawdzLimitSerwera(konto, 'strony');
    const doSprawdzenia = pula.zostalo === null ? adresy : adresy.slice(0, pula.zostalo);
    const odnosniki = await strona.sprawdzOdnosniki(doSprawdzenia);
    policzZasob(konto, 'strony', doSprawdzenia.length);
    const pominiete = adresy.slice(doSprawdzenia.length).map((adres) => ({
      adres, status: 0, stan: 'nieznany', dziala: false, powod: 'limit-pakietu', blad: 'Wyczerpano pulę sprawdzeń w pakiecie',
    }));
    return odpowiedzJson(res, 200, pominiete.length ? { odnosniki: [...odnosniki, ...pominiete], pominiete: pominiete.length } : { odnosniki });
  }

  // ─── Baza wiedzy ───────────────────────────────────────────────────────────
  // Baza wspolna jest per organizacja (ARCH8-09, SEC8-50): konto widzi wspolna swojej
  // organizacji i swoja prywatna; do wspolnej pisze ten, kto organizacja zarzadza.
  const orgBazy = dzierzawy.idOrganizacji(konto);
  if (sciezka === '/api/baza' && req.method === 'GET') {
    return odpowiedzJson(res, 200, {
      dokumenty: baza.lista({ katalog: KONF.katalogBazy, login: sesja.login, organizacja: orgBazy }),
      // KOD8-11: ile znakow dokumentu trafia do bazy (aplikacja pyta przed dodaniem dluzszego).
      limitZnakow: baza.LIMIT_ZNAKOW,
    });
  }

  if (sciezka === '/api/baza' && req.method === 'POST') {
    // Limit dokumentow jest pakietowy: darmowy ma trzy, premium bez ograniczenia.
    // W organizacji samoobslugowej liczy dokumenty prywatne i wspolne: wlasciciel pisze
    // do obu, wiec "wspolna" nie moze omijac limitu pakietu.
    const limitDok = plany.planKonta(konto).limitDokumentow;
    if (limitDok !== null) {
      const wlasne = baza.lista({ katalog: KONF.katalogBazy, login: sesja.login, organizacja: orgBazy })
        .filter((d) => orgBazy !== dzierzawy.GLOWNA || d.zakres !== baza.WSPOLNA).length;
      if (wlasne >= limitDok) {
        return bledy.bladCai(res, 'limit-pakietu', 402, {
          error: `Limit dokumentów w tym pakiecie: ${limitDok}.`,
          limit: limitDok,
          zuzyte: wlasne,
        });
      }
    }
    let dane;
    try { dane = JSON.parse((await czytajCialo(req)).toString('utf8')); }
    catch { return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' }); }

    const zakres = dane.zakres === baza.WSPOLNA ? baza.WSPOLNA : 'prywatna';
    // Do bazy wspolnej pisze tylko zarzadzajacy organizacja (glowna: admin) - inaczej
    // kazdy zmienialby wiedze zespolu.
    if (zakres === baza.WSPOLNA && !dzierzawy.mozeZarzadzac(konto, konto.org)) {
      return odmowaOrganizacji(req, res, konto, 'Do bazy wspólnej dodaje wyłącznie admin');
    }
    // KOD8-15: stary .doc, obraz albo zle odczytane kodowanie - jasny komunikat zamiast smieci w bazie.
    const zlaTresc = baza.sprawdzTresc(dane.nazwa, dane.tresc);
    if (zlaTresc) {
      const komunikat = jezykZadania(req) === 'en' ? zlaTresc.komunikatEn : zlaTresc.komunikat;
      return odpowiedzJson(res, 422, { error: komunikat, komunikat, powod: zlaTresc.powod });
    }
    const wektory = wektoryDla(konto);
    try {
      // R6-F (E-13): adres strony (pole url albo "Zrodlo: URL" w tresci) wraca w liscie /api/baza.
      const opis = await baza.dodaj({
        katalog: KONF.katalogBazy, zakres, login: sesja.login, organizacja: orgBazy,
        nazwa: dane.nazwa, tresc: dane.tresc, url: dane.url, konfWektorow: wektory.konf,
      });
      if (wektory.liczyc && opis.zWektorami) policzZasob(konto, 'wektory', 1);
      // Dziennik bez nazwy dokumentu (dane klienta, SEC8-54): zakres i liczby wystarcza.
      console.log(`[baza] +${zakres} (${opis.fragmentow} fragm., wektory: ${opis.zWektorami}${opis.uciety ? `, uciety do ${opis.zapisanoZnakow} z ${opis.znakow} znakow` : ''})`);
      return odpowiedzJson(res, 200, wektory.powod ? { ...opis, powodWektorow: wektory.powod } : opis);
    } catch (e) {
      if (e instanceof pliki.BladDanych) throw e;
      return odpowiedzJson(res, 400, { error: e.message });
    }
  }

  if (sciezka === '/api/baza/usun' && req.method === 'POST') {
    let dane;
    try { dane = JSON.parse((await czytajCialo(req)).toString('utf8')); }
    catch { return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' }); }
    const zakres = dane.zakres === baza.WSPOLNA ? baza.WSPOLNA : 'prywatna';
    if (zakres === baza.WSPOLNA && !dzierzawy.mozeZarzadzac(konto, konto.org)) {
      return odmowaOrganizacji(req, res, konto, 'Z bazy wspólnej usuwa wyłącznie admin');
    }
    const usuniety = baza.usun({ katalog: KONF.katalogBazy, zakres, login: sesja.login, id: dane.id, organizacja: orgBazy });
    return odpowiedzJson(res, usuniety ? 200 : 404, usuniety ? { ok: true } : { error: 'Nie znaleziono dokumentu' });
  }

  if (sciezka === '/api/baza/szukaj' && req.method === 'POST') {
    let dane;
    try { dane = JSON.parse((await czytajCialo(req)).toString('utf8')); }
    catch { return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' }); }
    const wektory = wektoryDla(konto);
    const wynik = await baza.szukaj({
      katalog: KONF.katalogBazy, login: sesja.login, organizacja: orgBazy,
      zapytanie: String(dane.zapytanie || ''),
      ile: Math.min(Number(dane.ile) || baza.DOMYSLNIE_FRAGMENTOW, 30),
      konfWektorow: wektory.konf,
    });
    if (wektory.liczyc && wynik.metoda === 'wektory') policzZasob(konto, 'wektory', 1);
    // Konto na wlasnym kluczu bez puli wektorow (D-09) szuka po slowach kluczowych: powod jawnie.
    const powod = wektory.powod && wynik.metoda === 'slowa-kluczowe' ? { powod: wektory.powod } : {};
    return odpowiedzJson(res, 200, { ...wynik, ...powod, prompt: baza.doPromptu(wynik) });
  }

  // ─── Dane z OpenSEO ────────────────────────────────────────────────────────
  // Content AI pyta OpenSEO o jego wlasne dane przez serwer MCP kontenera.
  // Domyslna sciezka jest DARMOWA (czyta baze OpenSEO). Narzedzia platne, ktore
  // wolaja DataForSEO, wymagaja jawnego potwierdzenia - patrz openseo-mcp.js.
  if (sciezka.startsWith('/api/seo/')) {
    if (!KONF.openseo.portNasluchu) {
      // Aplikacja sprawdza te liste przy kazdym starcie, zeby wiedziec, czy
      // pokazac przycisk OpenSEO. 501 zostawial czerwony blad w konsoli przy
      // kazdym wejsciu - brak OpenSEO to normalny stan, a nie awaria.
      if (sciezka === '/api/seo/projekty' && req.method === 'GET') {
        return odpowiedzJson(res, 200, { projekty: [], dostepne: false });
      }
      return odpowiedzJson(res, 501, { error: 'OpenSEO nie jest wdrozone na tym serwerze.' });
    }
    // Jeden kontener i jeden projekt zespolu (SEC8-52): maFunkcje daje 'openseo' tylko
    // organizacji glownej, wiec konto samoobslugowe dostaje odmowe takze w Premium.
    if (!plany.maFunkcje(konto, 'openseo')) {
      return bledy.bladCai(res, 'funkcja-poza-pakietem', 402, { error: 'Dane z OpenSEO są dostępne w pakiecie Premium.', funkcja: 'openseo' });
    }
    try {
      return await obsluzSeo(sciezka, req, res, sesja);
    } catch (e) {
      if (e instanceof pliki.BladDanych) throw e;
      const status = e.status || 502;
      if (status >= 500) console.error('[seo]', e.message);
      return odpowiedzJson(res, status, { error: e.message });
    }
  }

  // Proxy - kazde wywolanie kosztuje, wiec przechodzi przez limit pakietu.
  // Czynnosc jest liczona dopiero po udanej odpowiedzi dostawcy: gdy generowanie
  // padnie na bledzie API, uzytkownik nie traci sztuki z pakietu.
  // Przerwij w aplikacji konczy zadanie w tle (serwer/zadania.js) - bez tego
  // generowanie trwaloby dalej i liczylo sie do pakietu.
  // KOD8-30: jawny stan zadania w tle (aplikacja po powrocie karty sprawdza, czy jest co
  // odebrac, zanim wysle ponowienie z tym samym X-Zadanie). Bez tresci i bez kosztu.
  //   GET /api/zadanie?id=<id> albo /api/zadanie/<id> -> { id, stan: trwa|gotowe|przerwane|brak, status? }
  const zadanieStan = /^\/api\/zadanie(?:\/([A-Za-z0-9_-]{8,64}))?$/.exec(sciezka);
  if (zadanieStan && req.method === 'GET') {
    const id = zadanieStan[1] || String(url.searchParams.get('id') || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return odpowiedzJson(res, 400, { error: 'Niepoprawny identyfikator zadania' });
    return odpowiedzJson(res, 200, { id, ...zadaniaWTle.stanZadania(sesja.login, id) });
  }

  if (sciezka === '/api/zadanie/anuluj' && req.method === 'POST') {
    let dane = {};
    try { dane = JSON.parse((await czytajCialo(req, 4096)).toString('utf8')); } catch { /* puste cialo */ }
    const id = /^[A-Za-z0-9_-]{8,64}$/.test(String(dane.id || '')) ? String(dane.id) : '';
    return odpowiedzJson(res, 200, { ok: true, anulowane: zadaniaWTle.anuluj(sesja.login, id) });
  }

  const PROXY = new Set(['/api', '/api/images', '/api/tts', '/api/eleven-tts', '/api/transcribe']);
  if (req.method === 'POST' && PROXY.has(sciezka)) {
    // Ponowienie zadania po zerwanym polaczeniu (telefon w tle): wynik z pamieci
    // albo czekanie na trwajace wywolanie - bez drugiego wywolania i liczenia.
    const idZadania = zadaniaWTle.idZNaglowka(req);
    const bylo = zadaniaWTle.znajdz(sesja.login, idZadania);
    if (bylo) {
      req.resume();
      return zadaniaWTle.odbierz(bylo, res);
    }

    // KOD8-07: w trakcie lagodnego zatrzymania nowe wywolania dostawcow czekaja na nowy
    // proces (aplikacja ponawia 503 bez JSON-a jak odpowiedz bramy w oknie restartu),
    // a wyniki trwajacych zadan nadal mozna odebrac (wyzej).
    if (ZATRZYMANIE.trwa) {
      req.resume();
      return odpowiedzRestartu(res);
    }

    // BYOK (ARCH8-10): konto na wlasnych kluczach bez klucza dostaje 403 od razu - przed
    // limitem pakietu i przed zadaniem w tle, ktore inaczej oddaloby odmowe jako wynik.
    const brak = klucze.brakKlucza(sciezka, req, konto, KONF);
    if (brak) return odmowaKlucza(req, res, brak);

    const CZYNNOSCI = {
      '/api/images': 'grafika',
      '/api/tts': 'audio',
      '/api/eleven-tts': 'audio',
      '/api/transcribe': 'transkrypcja',
    };
    // /api obsluguje zarowno artykul, jak i wywolania pomocnicze - patrz czynnosciTresci()
    const czynnosci = sciezka === '/api' ? czynnosciTresci(req) : [CZYNNOSCI[sciezka]];
    const { rezerwacja, odmowa } = zarezerwujLimit(sesja, czynnosci);
    if (odmowa) return bledy.bladCai(res, 'limit-pakietu', 402, odmowa);
    sesja.rezerwacja = rezerwacja;

    const wykonaj = async (cel, zad = req) => {
      try {
        if (sciezka === '/api') return await proxyTresc(zad, cel, sesja, czynnosci);
        if (sciezka === '/api/images') return await proxyGrafika(zad, cel, sesja);
        if (sciezka === '/api/tts') return await proxyOpenAiJson(zad, cel, KONF.urlOpenai + '/audio/speech', sesja, 'audio', KONF.czasy.audio);
        if (sciezka === '/api/transcribe') return await proxyTranskrypcja(zad, cel, sesja);
        if (sciezka === '/api/eleven-tts') return await proxyEleven(zad, cel, sesja);
      } catch (e) {
        if (e instanceof KlientOdszedl) {
          // Przegladarka zamknela polaczenie (albo Przerwij przy zadaniu w tle) -
          // wywolanie dostawcy przerwane, nic nie liczymy i nie ma komu odpowiadac.
          console.log(`[proxy] ${sciezka}: klient odszedl, wywolanie dostawcy przerwane`);
          return undefined;
        }
        if (e instanceof BladCzasu) {
          console.error(`[proxy] ${sciezka}: ${e.message}`);
          return odpowiedzCzasu(cel, e);
        }
        // KOD8-16: za duze nagranie albo zapytanie to 413 z rozmiarem, a nie 502 "blad dostawcy".
        if (e && e.status === 413) return odpowiedzZaDuze(cel, sciezka, e.limitMB);
        if (e instanceof pliki.BladDanych) throw e;
        console.error(`[proxy] ${sciezka}:`, e.message);
        return odpowiedzJson(cel, 502, { error: 'Błąd połączenia z dostawcą API' });
      } finally {
        rezerwacja.zwolnij();
      }
      return undefined;
    };
    // Zwykle wywolanie (bez trybu w tle); kopia zapytania traci klucze zaraz po nim.
    const wykonajTeraz = async (cel, zad) => {
      try {
        return await wykonaj(cel, zad);
      } finally {
        if (zad !== req) zadaniaWTle.wyczyscKopie(zad);
      }
    };
    // Z identyfikatorem zadanie idzie w tle: konczy sie mimo zerwanego polaczenia.
    // Cialo czytamy najpierw w calosci - zadanie zapisujemy dopiero, gdy doszlo cale,
    // zeby urwane wysylanie nie zostawilo w pamieci zlego wyniku dla ponowienia.
    if (idZadania) {
      let cialo;
      try {
        cialo = await czytajCialo(req);
      } catch (e) {
        rezerwacja.zwolnij();
        if (e.status === 413) return odpowiedzZaDuze(res, sciezka);
        return undefined;
      }
      // Kopia z WLASNYM obiektem naglowkow (ARCH8-12): po wywolaniu dostawcy zadania.js
      // usuwa z niej naglowki z kluczami i ciasteczka; oryginal zapytania zostaje nietkniety.
      // Cialo idzie gotowe (cialoGotowe), bez drugiego czytania i drugiej kopii w pamieci.
      const kopia = Object.assign(Readable.from([cialo]), {
        headers: { ...req.headers }, method: req.method, url: req.url, socket: req.socket, cialoGotowe: cialo,
      });
      const wpis = zadaniaWTle.uruchom(sesja.login, idZadania, kopia, (cel) => wykonaj(cel, kopia));
      if (wpis) return zadaniaWTle.odbierz(wpis, res);
      // Budzet pamieci wynikow (CAI_ZADANIA_MB) zajety przez zadania w toku: zwykle wywolanie.
      return wykonajTeraz(res, kopia);
    }
    return wykonajTeraz(res, req);
  }

  // Aplikacja i pliki statyczne
  // ARCH8-24: identyfikator konta dla aplikacji osobnym, malym skryptem (przed pierwszym
  // skryptem aplikacji), dzieki czemu strona aplikacji moze byc jedna dla wszystkich kont.
  if (sciezka === '/konto.js' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.setHeader('Cache-Control', 'private, no-store');
    return odpowiedzTekst(res, 200, `window.CAI_KONTO=${JSON.stringify(idKonta(sesja.login))};\n`, 'text/javascript; charset=utf-8');
  }

  if (sciezka === '/' || sciezka === '/index.html') {
    const tresc = htmlAplikacji || wczytajAplikacje();
    // Aplikacja, ktora bierze identyfikator z /konto.js, nie ma w HTML miejsca na konto:
    // wtedy jedna wersja (i jedna spakowana) dla wszystkich kont zamiast do 200 kopii
    // po ok. 1,9 MB. Starsza aplikacja (z miejscem na konto) dziala jak dotad.
    const id = tresc.includes(PLACEHOLDER_KONTO) ? idKonta(sesja.login) : '';
    // HTML jest staly w obrebie procesu, rozni sie najwyzej identyfikatorem konta,
    // wiec gotowa i spakowana wersje trzymamy raz (albo per konto, pakowanie to ~30 ms).
    let wpis = PAMIEC_STRONY.get(id || '*');
    if (!wpis) {
      const dane = Buffer.from(id ? tresc.split(PLACEHOLDER_KONTO).join(id) : tresc, 'utf8');
      wpis = { dane, spakowane: {}, etag: id ? null : '"' + crypto.createHash('sha256').update(dane).digest('base64url').slice(0, 27) + '"' };
      if (PAMIEC_STRONY.size >= 200) PAMIEC_STRONY.delete(PAMIEC_STRONY.keys().next().value);
      PAMIEC_STRONY.set(id || '*', wpis);
    }
    // Strona z identyfikatorem konta nie moze trafic do zadnej pamieci podrecznej. Wspolna
    // wersja (KOD8-06) ma ETag: przegladarka pyta przy kazdym wejsciu i dostaje 304.
    res.setHeader('Cache-Control', wpis.etag ? 'private, no-cache' : 'private, no-store');
    if (wpis.etag) {
      res.setHeader('ETag', wpis.etag);
      const ifNone = String(req.headers['if-none-match'] || '');
      if (ifNone && ifNone.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(wpis.etag)) {
        res.writeHead(304, { Vary: 'Accept-Encoding' });
        return res.end();
      }
    }
    const kod = wybierzKodowanie(req);
    if (kod && !wpis.spakowane[kod]) {
      try { await spakowanaWersja(wpis, kod); } catch (e) { console.error('[aplikacja] pakowanie:', e.message); }
    }
    return wyslij(res, 200, { 'Content-Type': html }, wpis.dane, wpis.spakowane);
  }

  return plikStatyczny(req, res, sciezka);
}

const TYPY = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

// Pliki publiczne jeszcze przed zalogowaniem: manifest, ikony i fonty (ekran
// logowania pisze krojem marki). Biblioteki aplikacji zostaja za logowaniem.
function czyPublicznyPlik(sciezka) {
  return /^\/(manifest\.json|icons\/[A-Za-z0-9._-]+|pwa\/fonty\/[A-Za-z0-9._-]+\.woff2)$/.test(sciezka);
}

// Pamiec podreczna plikow statycznych: tresc, ETag i wersje spakowane liczymy
// raz na wersje pliku (rozmiar + czas zmiany), a nie przy kazdym zadaniu.
const PAMIEC_PLIKOW = new Map();

function wpisPliku(plik) {
  const st = fs.statSync(plik);
  const klucz = `${st.size}:${st.mtimeMs}`;
  const byl = PAMIEC_PLIKOW.get(plik);
  if (byl && byl.klucz === klucz) return byl;
  const dane = fs.readFileSync(plik);
  const wpis = {
    klucz,
    dane,
    etag: '"' + crypto.createHash('sha256').update(dane).digest('base64url').slice(0, 27) + '"',
    spakowane: {},
  };
  PAMIEC_PLIKOW.set(plik, wpis);
  return wpis;
}

function plikStatyczny(req, res, sciezka) {
  // Manifest, ikony i biblioteki aplikacji; reszta katalogu nie jest publiczna.
  // Biblioteki (mammoth, pdf.js, pdfmake, xlsx, html-docx-js) leza u nas zamiast
  // na obcym CDN - dzieki temu dzialaja w zamknietej sieci i nikt z zewnatrz
  // nie moze podmienic kodu wykonywanego w aplikacji.
  const dozwolone = /^\/(manifest\.json|icons\/[A-Za-z0-9._-]+|pwa\/(lib\/[A-Za-z0-9._-]+\.js|fonty\/[A-Za-z0-9._-]+\.woff2))$/;
  if (!dozwolone.test(sciezka)) return odpowiedzTekst(res, 404, 'Nie znaleziono');

  // Aplikacja wola biblioteki sciezka wzgledna (pwa/lib/...), zeby dzialaly tez
  // przy otwarciu pliku z dysku. Serwer widzi wtedy /pwa/lib/... i musi zdjac
  // ten przedrostek, bo katalogiem bazowym jest juz app/pwa.
  const wzgledna = sciezka.startsWith('/pwa/') ? sciezka.slice(4) : sciezka;
  const plik = path.join(APP, 'pwa', wzgledna);
  const wKatalogu = path.resolve(plik).startsWith(path.resolve(path.join(APP, 'pwa')));
  if (!wKatalogu || !fs.existsSync(plik)) return odpowiedzTekst(res, 404, 'Nie znaleziono');

  const wpis = wpisPliku(plik);
  // Biblioteki, fonty i ikony maja stale nazwy i nie zmieniaja sie miedzy
  // wydaniami, wiec przegladarka trzyma je rok bez pytania. ZASADA: zmiana
  // tresci takiego pliku = nowa nazwa pliku (serwer/README.md). Manifest
  // zmienia sie przy zmianie marki - godzina, potem pytanie z ETag.
  const naglowki = {
    'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream',
    'Cache-Control': sciezka === '/manifest.json' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
    ETag: wpis.etag,
  };
  const ifNone = String(req.headers['if-none-match'] || '');
  if (ifNone && ifNone.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(wpis.etag)) {
    res.writeHead(304, { ETag: wpis.etag, 'Cache-Control': naglowki['Cache-Control'], Vary: 'Accept-Encoding' });
    return res.end();
  }
  // Wersje spakowane liczymy raz, z najwyzsza jakoscia brotli - plik sie nie zmienia. Liczymy
  // je w puli watkow, a do czasu najlepszej wersji klient dostaje szybka (spakowanaWersja).
  const kod = TYPY_DO_KOMPRESJI.test(naglowki['Content-Type']) && wpis.dane.length > 1024 ? wybierzKodowanie(req) : null;
  if (kod && !wpis.spakowane[kod]) {
    return spakowanaWersja(wpis, kod, 11).then(
      (cialo) => wyslij(res, 200, naglowki, wpis.dane, { [kod]: cialo }),
      (e) => {
        console.error('[pliki] pakowanie:', e.message);
        return wyslijCialo(res, 200, { ...naglowki, Vary: 'Accept-Encoding' }, wpis.dane, req.method === 'HEAD');
      });
  }
  return wyslij(res, 200, naglowki, wpis.dane, wpis.spakowane);
}

// ─── Start ────────────────────────────────────────────────────────────────────

/**
 * Odpowiedz na blad, ktory wyszedl z routera. Uszkodzony plik danych to 503
 * z wyjasnieniem, a nie "Blad serwera" - administrator ma wiedziec, co naprawic,
 * a uzytkownik, ze to chwilowe.
 */
function odpowiedzNaBlad(req, res, e, nazwa) {
  if (e instanceof pliki.BladDanych) {
    console.error(`[${nazwa}] ${e.message}`);
    if (res.headersSent) return res.end();
    const sciezka = String(req.url || '').split('?')[0];
    if (sciezka.startsWith('/api') || sciezka.startsWith('/auth/me')) {
      return odpowiedzJson(res, 503, { error: 'Dane chwilowo niedostepne', komunikat: 'Dane serwera są chwilowo niedostępne. Administrator dostał zgłoszenie.' });
    }
    return odpowiedzTekst(res, 503, logowanie.stronaBleduDanych(jezykZadania(req)), 'text/html; charset=utf-8');
  }
  console.error(`[${nazwa}]`, e.message);
  if (!res.headersSent) odpowiedzTekst(res, 500, 'Blad serwera');
  else res.end();
}

/**
 * Otwiera baze (KONF.sqlite) i, gdy lezy jeszcze plik kont R8, migruje go
 * (serwer/migracja.js: jedna transakcja, pliki JSON nietkniete przy awarii,
 * kopia w dane/przed-migracja-<czas>/). Idempotentne: druga proba niczego nie
 * robi. Blad (uszkodzony plik, baza niedostepna) leci dalej: start() konczy proces,
 * a pliki R8 zostaja na miejscu.
 */
function przygotujMagazyn({ loguj = (t) => console.log(t) } = {}) {
  magazyn.otworz({ plik: KONF.sqlite, timeoutMs: 2000 });
  const zrodla = zrodlaMigracji();
  if (fs.existsSync(PLIK_UZYTKOWNIKOW)) {
    for (const p of zrodla.pominiete) {
      loguj(`[magazyn] migracja: pomijam ${p} (poza katalogiem pliku kont i bez jawnej zmiennej CAI_UZYCIE/CAI_WYLOGOWANE)`);
    }
  }
  return migracja.migrujZJson({ ...zrodla, loguj });
}

/**
 * Pliki R8 do migracji (serwer i `uzytkownicy.js migruj`): liczniki i wylogowania tylko
 * wskazane zmienna albo lezace obok pliku kont (migracja.zrodlaR8).
 */
function zrodlaMigracji() {
  return migracja.zrodlaR8({
    plikKont: PLIK_UZYTKOWNIKOW, katalogUzycia: KONF.katalogUzycia, plikWylogowanych: PLIK_WYLOGOWANYCH,
    jawneUzycie: Boolean(process.env.CAI_UZYCIE), jawneWylogowane: Boolean(process.env.CAI_WYLOGOWANE),
  });
}

/** Serwer aplikacji bez nasluchu - start() go uruchamia, testy stawiaja na porcie 0. */
function utworzSerwer() {
  // Testy tworza serwer bez start(): baza (i migracja plikow testu) tutaj.
  if (magazyn.sciezkaBazy() !== path.resolve(KONF.sqlite)) przygotujMagazyn();
  return http.createServer((req, res) => {
    // Zapytania w toku (lagodne zatrzymanie czeka, az skoncza sie wszystkie, KOD8-07).
    ZATRZYMANIE.aktywne += 1;
    res.once('close', () => { ZATRZYMANIE.aktywne -= 1; });
    if (ZATRZYMANIE.trwa) res.setHeader('Connection', 'close');
    obsluz(req, res).catch((e) => odpowiedzNaBlad(req, res, e, 'serwer'));
  });
}

/** Kopia bazy co godzine (48 ostatnich, ARCH8-02) i sprzatanie dobowe; zegary nie trzymaja procesu. */
function uruchomZegaryMagazynu() {
  const kopia = () => magazyn.kopiaOkresowa({ katalog: KONF.kopie, zostaw: 48 })
    .catch((e) => console.error('[magazyn] kopia:', e.message));
  const sprzataj = () => {
    try {
      const w = magazyn.sprzataj();
      if (w.sesje || w.tokeny || w.zdarzenia || w.liczniki) {
        console.log(`[magazyn] sprzatanie: sesje ${w.sesje}, tokeny ${w.tokeny}, zdarzenia ${w.zdarzenia}, liczniki ${w.liczniki}`);
      }
    } catch (e) {
      console.error('[magazyn] sprzatanie:', e.message);
    }
  };
  setTimeout(kopia, 60_000).unref();
  setInterval(kopia, 3600_000).unref();
  sprzataj();
  setInterval(sprzataj, 24 * 3600_000).unref();
}

function start() {
  if (!ROLE.includes('admin')) throw new Error('bledna konfiguracja rol');

  try {
    wczytajAplikacje();
  } catch (e) {
    console.error('BLAD:', e.message);
    process.exit(1);
  }

  let kont = 0;
  try {
    przygotujMagazyn();
    kont = magazyn.liczbaKont();
  } catch (e) {
    console.error('BLAD:', e.message);
    if (!(e instanceof pliki.BladDanych)) console.error(e.stack);
    process.exit(1);
  }
  if (kont === 0) {
    console.error('BLAD: brak kont. Zaloz pierwsze: sudo serwer/cli.sh dodaj <login> admin '
      + '(albo node serwer/uzytkownicy.js dodaj <login> admin jako konto uslugi)');
    process.exit(1);
  }
  zglosKonfiguracje();

  if (KONF.dostawca === 'nvidia' && !KONF.klucze.nvidia) {
    console.warn('UWAGA: CAI_DOSTAWCA=nvidia, ale brak NVIDIA_KEY - generowanie tresci nie zadziala.');
  }
  if (KONF.dostawca === 'anthropic' && !KONF.klucze.anthropic) {
    console.warn('UWAGA: brak ANTHROPIC_KEY - tresc zadziala tylko dla uzytkownikow z wlasnym kluczem.');
  }

  // Prosby o dostep (dane osobowe) trzymamy najwyzej CAI_PROSBY_DNI dni.
  try { prosby.sprzataj(); } catch (e) { console.error('[prosby] sprzatanie:', e.message); }

  uruchomZegaryMagazynu();
  // Moduly rundy 9: zegary (uzgadnianie platnosci, sprzatanie kont), kontrole przy starcie.
  const kontekstSerwera = { ...POMOCNICY, KONF };
  for (const [nazwa, modul] of Object.entries({ konta, klucze, poczta, platnosci })) {
    try {
      if (typeof modul.inicjuj === 'function') modul.inicjuj(kontekstSerwera);
    } catch (e) {
      console.error(`[${nazwa}] inicjalizacja:`, e.message);
    }
  }

  const serwer = utworzSerwer();
  serwer.listen(KONF.port, KONF.host, () => {
    // Port z gniazda (CAI_PORT=0 w testach to port wybrany przez system).
    console.log(`Content AI: http://${KONF.host}:${serwer.address().port}`);
    console.log(`  dostawca tresci: ${KONF.dostawca}${KONF.dostawca === 'nvidia' ? ' (' + KONF.modelNvidia + ')' : ''}`);
    if (KONF.modelGrafiki) console.log(`  model grafik: ${KONF.modelGrafiki} (CAI_MODEL_GRAFIKI)`);
    console.log(`  kont: ${kont}, baza: ${KONF.sqlite}, cookie Secure: ${KONF.cookieSecure ? 'tak' : 'NIE (tylko do testow lokalnych)'}`);
    console.log(`  rejestracja: ${funkcjaWlaczona('rejestracja') ? 'otwarta' : 'zamknieta'}, platnosci: ${funkcjaWlaczona('platnosci') ? `${KONF.platnosci.dostawca} (${KONF.platnosci.tryb})` : 'wylaczone'}, poczta: ${KONF.poczta.tryb}`);
    console.log(`  modele: ${[...DOZWOLONE.modele].join(', ')}; max_tokens <= ${KONF.maxTokens}; kompresja: ${KONF.kompresja ? 'tak' : 'nie'}`);
  });

  const brama = KONF.openseo.portNasluchu ? startOpenSeo() : null;

  // KOD8-07: wdrozenie (SIGTERM) konczy prace w toku zamiast ucinac generowanie w pol.
  const zatrzymaj = (sygnal) => {
    if (ZATRZYMANIE.trwa) {
      console.log(`[serwer] ${sygnal} w trakcie zatrzymania: koniec od razu`);
      process.exit(0);
    }
    console.log(`[serwer] ${sygnal}`);
    lagodneZatrzymanie([serwer, brama].filter(Boolean)).then((kod) => process.exit(kod));
  };
  process.on('SIGTERM', () => zatrzymaj('SIGTERM'));
  process.on('SIGINT', () => zatrzymaj('SIGINT'));
}

/** Brama przed OpenSEO - wydzielona, zeby testy mogly ja postawic na porcie 0. */
function utworzBrameOpenSeo() {
  const brama = openseo.utworz({ ...KONF.openseo, timeoutMs: KONF.czasy.openseo }, {
    sesjaZadania,
    obslugaLogowania,
    stronaLogowania,
    adresIp,
    // Brama sprawdza pakiet: OpenSEO w kontenerze nie ma wlasnego logowania,
    // wiec bez tego kazde konto (takze darmowe) mialo pelne OpenSEO.
    kontoSesji,
    // Dzierzawy (ARCH8-09, SEC8-52): jeden kontener i jeden projekt zespolu, wiec tylko
    // organizacja glowna - operator albo konto glownej z OpenSEO w pakiecie.
    maDostepDoOpenSeo: (konto) => dzierzawy.operator(konto)
      || (dzierzawy.idOrganizacji(konto) === dzierzawy.GLOWNA && plany.maFunkcje(konto, 'openseo')),
    stronaBezPakietu: (req) => logowanie.stronaOpenSeoBezPakietu(jezykZadania(req)),
    // Strony samej bramy (logowanie, 402, blad) - ten sam zestaw co aplikacja.
    naglowkiBezpieczenstwa: NAGLOWKI_BEZPIECZENSTWA,
  });

  const serwer = http.createServer((req, res) => {
    brama.obsluz(req, res).catch((e) => odpowiedzNaBlad(req, res, e, 'openseo'));
  });
  serwer.on('upgrade', (req, gniazdo, glowa) => {
    try {
      brama.obsluzUpgrade(req, gniazdo, glowa);
    } catch (e) {
      console.error('[openseo ws]', e.message);
      gniazdo.destroy();
    }
  });
  return serwer;
}

/**
 * Drugi port - przed OpenSEO. Osobny nasluch, bo OpenSEO dostaje wlasny host
 * (seo.twojadomena.pl) i wlasny korzen; szczegoly i uzasadnienie w openseo.js.
 */
function startOpenSeo() {
  return utworzBrameOpenSeo().listen(KONF.openseo.portNasluchu, KONF.host, () => {
    console.log(`OpenSEO za logowaniem: http://${KONF.host}:${KONF.openseo.portNasluchu}`);
    console.log(`  kontener: http://${KONF.openseo.host}:${KONF.openseo.port}`);
    if (!KONF.cookieDomena) {
      console.warn('  UWAGA: bez CAI_COOKIE_DOMENA logowanie nie przechodzi miedzy poddomenami.');
    }
  });
}

if (require.main === module) start();

module.exports = {
  wolnoWyjsc,
  zahaszuj, hasloPasuje, zahaszujAsync, hasloPasujeAsync, anthropicNaOpenai, openaiNaAnthropic, ROLE,
  PLIK_UZYTKOWNIKOW, PLIK_BAZY, poprawnyLogin, WZOR_LOGINU,
  // Sesje - wystawione do testow; produkcyjnie wola je tylko router.
  utworzSesje, sesjaZadania, zapiszWylogowanie, wylogowane, PLIK_WYLOGOWANYCH, zrodlaMigracji, ciasteczkoSesji, ciasteczkoWylogowania,
  czynnosciTresci, parsujCiasteczka, adresIp, obcePochodzenie, jezykZadania, podpisz, skrotEmaila,
  wyzerujOstrzezenieIp: () => { ostatnieOstrzezenieIp = 0; },
  // Baza i konfiguracja (CLI, testy): otwarcie z migracja, kontrola konfiguracji.
  przygotujMagazyn, sprawdzKonfiguracje, funkcjaWlaczona, stanKonfiguracji, kontekstZadania,
  // Serwer do testow integracyjnych (port 0, bez start()).
  utworzSerwer, utworzBrameOpenSeo, wczytajAplikacje, ustawHtmlAplikacji, KONF, DOZWOLONE, CSP,
};
