'use strict';

// ─── Konta samoobslugowe (wykonawca A1) ──────────────────────────────────────
//
// PROJEKT-TECHNICZNY ARCH8-04..08, rozdz. 4 (trasy i przeplywy); kontrakt etapu 0:
// AG/runda9/WYKONANIE-A0.md. Ekrany (czysty HTML bez skryptow) sa w ekrany-kont.js,
// SQL wylacznie w magazyn.js, poczta przez kontrakt C (poczta.wyslij), anulowanie
// subskrypcji przez kontrakt B (platnosci.anulujDlaKonta).
//
// Router (server.js) wola ten modul w dwoch miejscach:
//   1. obsluzPubliczne(sciezka, req, res, kontekst) - PRZED ogolna kontrola CSRF i bez
//      sesji, dla SCIEZKI_PUBLICZNE. Formularze POST sprawdzaja pochodzenie same
//      (kontekst.obcePochodzenie -> strona HTML 403).
//   2. obsluz(sciezka, req, res, kontekst) - z sesja, po platnosci.obsluz i klucze.obsluz:
//      /konto, /konto/*, /api/konto, /api/konto/* (bez /konto/zakup|panel|platnosc - modul B)
//      oraz dwie bramki dla tras dalej w routerze (zgoda wymagana, e-mail niepotwierdzony).
// Obie funkcje zwracaja true, gdy wyslaly odpowiedz, false = router idzie dalej.
//
// Co kiedy dziala (z ustawieniami domyslnymi wszystko jak dzis dla kont zespolu):
//   - rejestracja: tylko przy funkcjaWlaczona('rejestracja') (CAI_REJESTRACJA=1 i pelna
//     konfiguracja); inaczej /rejestracja idzie dalej jak dzis (ekran logowania),
//   - reset hasla i linki e-mailowe: gdy jest poprawny CAI_ADRES_PUBLICZNY (jedyne zrodlo
//     adresow w e-mailach) i nie ma trybu bramy; bez tego /haslo mowi, ze haslo konta
//     zespolu zmienia administrator. Dzieki temu zamkniecie rejestracji (CAI_REJESTRACJA=0)
//     nie odcina istniejacych kont samoobslugowych od resetu i potwierdzenia adresu,
//   - ekran konta i /api/konto: dla kazdego zalogowanego (konta zespolu bez zakupu,
//     bez samodzielnego usuwania i bez wymuszonej akceptacji regulaminu, M-7).
//
// Bezpieczenstwo (SEC8-20..24): pole-pulapka i podpisany znacznik czasu formularza,
// limity per adres IP, siec /24 albo /48 i lacznie (limity.js), opcjonalnie Cloudflare
// Turnstile; tokeny jednorazowe (w bazie skrot sha256), GET nie zuzywa tokenu, potwierdzenie
// adresu przyciskiem POST (skanery poczty otwieraja linki); reset i ponowienie maja te sama
// odpowiedz dla istniejacego i nieistniejacego adresu, a wysylka idzie po odpowiedzi
// (staly czas); formularze konta niosa token CSRF z podpisu sesji (cai_auth zostaje
// SameSite=Lax, bo powrot z Checkout i linki z poczty to nawigacje z innej witryny).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const limity = require('./limity.js');
const pliki = require('./pliki.js');
const baza = require('./baza.js');
const marka = require('./marka.js');
const dokumentyPrawne = require('./dokumenty-prawne.js');
const ekranyPlatnosci = require('./ekrany-platnosci.js');
const ekrany = require('./ekrany-kont.js');

// Sciezki ekranow bez sesji. Router przepuszcza je przez obsluzPubliczne przed
// kontrola CSRF; nowa publiczna sciezka A1 = dopisanie jej tutaj, bez zmian w server.js.
const SCIEZKI_PUBLICZNE = ['/rejestracja', '/potwierdz', '/haslo', '/haslo/nowe', '/do-widzenia'];

const HTML = 'text/html; charset=utf-8';
const { MINUTA, GODZINA, DOBA } = limity;

// ─── Zasady (jedna linia = jedna decyzja; reszta w KONF z rozdz. 6) ─────────
const ZASADY = {
  hasloMin: 10,                    // ARCH8-06, makiety R1/R6
  hasloMax: 256,
  emailMax: 254,                   // ARCH8-04
  formularzMinMs: 3000,            // formularz wyslany szybciej = automat (ARCH8-06)
  formularzMaxMs: 2 * GODZINA,     // starszy = wygasl (wyslij jeszcze raz)
  zmianaEmailMs: DOBA,             // waznosc linku zmiany adresu (ARCH8-07)
  turnstileUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  turnstileCzasMs: 10_000,
  sprzataniePierwszeMs: 10 * MINUTA,
  sprzatanieCoMs: DOBA,
};

// Limity prob (w pamieci procesu, jak licznik logowania; restart je zeruje).
const REJESTRACJA = limity.utworz('rejestracja', [
  { nazwa: 'adres', klucz: (k) => k.ip, ile: 5, oknoMs: GODZINA },
  { nazwa: 'siec', klucz: (k) => limity.siecAdresu(k.ip), ile: 20, oknoMs: DOBA },
  { nazwa: 'wszystko', klucz: () => '*', ile: 300, oknoMs: DOBA },
]);
// Logowanie per konto (ARCH8-05): 20 nieudanych w godzine -> 15 minut blokady.
const PROBY_KONTA = limity.utworz('logowanie-konto', [
  { nazwa: 'konto', klucz: (k) => k.konto, ile: 20, oknoMs: GODZINA },
]);
const BLOKADA_KONTA = limity.utworz('logowanie-konto-blokada', [
  { nazwa: 'konto', klucz: (k) => k.konto, ile: 1, oknoMs: 15 * MINUTA },
]);
const RESET_ADRES = limity.utworz('reset-adres', [{ nazwa: 'adres', klucz: (k) => k.ip, ile: 5, oknoMs: GODZINA }]);
const RESET_EMAIL = limity.utworz('reset-email', [{ nazwa: 'email', klucz: (k) => k.email, ile: 3, oknoMs: GODZINA }]);
// POST /potwierdz i /haslo/nowe: tokeny maja 256 bitow, limit tylko przeciw zalewaniu.
const TOKENY = limity.utworz('tokeny-adres', [{ nazwa: 'adres', klucz: (k) => k.ip, ile: 30, oknoMs: GODZINA }]);
// Ponowna wysylka linku potwierdzajacego: raz na minute, 3 na godzine (wysylka przy rejestracji sie liczy).
const PONOWIENIE = limity.utworz('potwierdzenie-ponow', [
  { nazwa: 'odstep', klucz: (k) => k.login, ile: 1, oknoMs: MINUTA },
  { nazwa: 'godzina', klucz: (k) => k.login, ile: 3, oknoMs: GODZINA },
]);
// Haslo wpisywane na ekranie konta (zmiana hasla, adresu, usuniecie): nieudane proby.
const HASLO_KONTA = limity.utworz('haslo-konta', [{ nazwa: 'konto', klucz: (k) => k.login, ile: 10, oknoMs: GODZINA }]);

// Najczestsze hasla o dlugosci od 10 znakow (lista celowo krotka: blokuje oczywiste
// wybory, nie udaje slownika). Plus hasla z jednego powtorzonego znaku.
const HASLA_POPULARNE = new Set([
  '1234567890', '0123456789', '0987654321', '1234567890a', '12345678910', '1111111111', '0000000000',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', '1q2w3e4r5t', '1qaz2wsx3edc', 'zaq12wsxcde', 'qazwsxedcr',
  'password12', 'password123', 'password1!', 'passw0rd12', 'iloveyou12', 'abcdefghij', 'abc1234567',
  'haslo12345', 'haslo123456', 'kochamcie1', 'polska1234', 'administrator', 'contentai1', 'contentai123',
]);

// Stan wysylki linku potwierdzajacego per konto (baner "Potwierdz adres" w aplikacji).
const WYSYLKI = new Map();          // login -> { ok, czas }
// Prace po wyslaniu odpowiedzi (reset: staly czas odpowiedzi); testy czekaja na nie.
const W_TLE = new Set();
let ostatnieOstrzezenieLimitu = 0;

// ─── Pomocnicze ──────────────────────────────────────────────────────────────

// E-mail do bazy: bez spacji, znakow sterujacych i znakow, ktore cos znacza w HTML i naglowkach.
const WZOR_EMAIL = /^[^\s@<>"'(),;:\\[\]\u0000-\u001f\u007f]+@[^\s@<>"'(),;:\\[\].\u0000-\u001f\u007f]+(\.[^\s@<>"'(),;:\\[\].\u0000-\u001f\u007f]+)+$/;

function poprawnyEmail(adres) {
  return typeof adres === 'string' && adres.length <= ZASADY.emailMax && WZOR_EMAIL.test(adres);
}

/** Czy wpisany tekst moze wrocic do pola e-mail/login ekranu logowania (server.js). */
function emailDoPola(tekst) {
  return poprawnyEmail(String(tekst || '').trim());
}

/** Kod bledu hasla albo null: dlugosc, rozne od e-maila, nie z listy najczestszych. */
function ocenHaslo(haslo, email) {
  const h = String(haslo || '');
  if (h.length < ZASADY.hasloMin) return 'haslo-krotkie';
  if (h.length > ZASADY.hasloMax) return 'haslo-dlugie';
  const male = h.trim().toLowerCase();
  if (email && male === String(email).toLowerCase()) return 'haslo-jak-email';
  if (HASLA_POPULARNE.has(male) || /^(.)\1+$/.test(h)) return 'haslo-slabe';
  return null;
}

/** Czy adres nadaje sie na podstawe odnosnikow w e-mailach (jak w server.js). */
function poprawnyAdresPubliczny(adres) {
  let u;
  try { u = new URL(adres); } catch { return false; }
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
}

/** Linki e-mailowe (reset, potwierdzenie, zmiana adresu): adres publiczny i brak trybu bramy. */
function pocztaKontDostepna(KONF) {
  return !KONF.zaufanyNaglowek && Boolean(KONF.adresPubliczny) && poprawnyAdresPubliczny(KONF.adresPubliczny);
}

/** Odnosnik z tokenem, wylacznie z CAI_ADRES_PUBLICZNY (nigdy z naglowka Host, ARCH8-07). */
function odnosnik(KONF, sciezka, token, jezyk) {
  return `${KONF.adresPubliczny}${sciezka}?t=${encodeURIComponent(token)}&lang=${jezyk === 'en' ? 'en' : 'pl'}`;
}

/** Konto na wlasnym kluczu bez potwierdzonego adresu: zasoby oplacane przez serwer czekaja (ARCH8-05/06). */
function wymagaPotwierdzenia(konto) {
  return Boolean(konto) && konto.zrodloKluczy === 'wlasne' && !konto.emailPotwierdzony;
}

function jezykKonta(konto, zapasowy) {
  return konto && (konto.jezyk === 'en' || konto.jezyk === 'pl') ? konto.jezyk : (zapasowy === 'en' ? 'en' : 'pl');
}

/** Podpisany znacznik czasu formularza rejestracji: '<ms>.<HMAC sekretu sesji>'. */
function znacznikFormularza(podpisz, teraz = Date.now()) {
  return `${teraz}.${podpisz(`rejestracja:${teraz}`)}`;
}

/** 'ok' | 'szybko' (< 3 s) | 'wygasl' (> 2 h, zly albo brak). */
function ocenZnacznik(znacznik, podpisz, teraz = Date.now()) {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/.exec(String(znacznik || ''));
  if (!m) return 'wygasl';
  const oczekiwany = Buffer.from(podpisz(`rejestracja:${m[1]}`));
  const dany = Buffer.from(m[2]);
  if (oczekiwany.length !== dany.length || !crypto.timingSafeEqual(oczekiwany, dany)) return 'wygasl';
  const wiek = teraz - Number(m[1]);
  if (wiek < ZASADY.formularzMinMs) return 'szybko';
  if (wiek > ZASADY.formularzMaxMs) return 'wygasl';
  return 'ok';
}

/** Token CSRF formularzy konta: podpis sesji (login + identyfikator), bez stanu na serwerze (SEC8-24). */
function tokenCsrf(kontekst, sesja = kontekst.sesja) {
  const s = sesja || {};
  return kontekst.podpisz(`konto-csrf:${s.login || ''}:${s.id || 'brama'}`);
}

function csrfPoprawny(kontekst, wartosc) {
  const a = Buffer.from(tokenCsrf(kontekst));
  const b = Buffer.from(String(wartosc || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function turnstileWlaczony(KONF) {
  return Boolean(KONF.turnstile && KONF.turnstile.klucz && KONF.turnstile.sekret);
}

/** Weryfikacja odpowiedzi widzetu Turnstile u Cloudflare; blad sieci = odmowa. */
async function sprawdzTurnstile(KONF, odpowiedz, ip) {
  const tekst = String(odpowiedz || '');
  if (!tekst || tekst.length > 4096) return false;
  try {
    const odp = await fetch(ZASADY.turnstileUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: KONF.turnstile.sekret, response: tekst, remoteip: ip || '' }).toString(),
      signal: AbortSignal.timeout(ZASADY.turnstileCzasMs),
    });
    if (!odp.ok) return false;
    const dane = await odp.json();
    return Boolean(dane && dane.success === true);
  } catch (e) {
    console.error('[konta] Turnstile:', e.message);
    return false;
  }
}

/** CSP ekranu z widzetem Turnstile: skrypt i ramka z challenges.cloudflare.com (tylko tam). */
function cspZTurnstile(res) {
  const csp = String(res.getHeader('Content-Security-Policy') || '');
  if (!csp) return;
  const host = 'https://challenges.cloudflare.com';
  res.setHeader('Content-Security-Policy', csp
    .replace("script-src 'self'", `script-src 'self' ${host}`)
    .replace("frame-src 'none'", `frame-src ${host}`));
}

function wyslijHtml(res, kontekst, status, tresc, naglowki = {}) {
  if (res.headersSent || res.destroyed) return true;
  for (const [k, v] of Object.entries(naglowki)) res.setHeader(k, v);
  kontekst.odpowiedzTekst(res, status, tresc, HTML);
  return true;
}

function przekieruj(res, adres, naglowki = {}) {
  if (res.headersSent || res.destroyed) return true;
  res.writeHead(303, { Location: adres, ...naglowki });
  res.end();
  return true;
}

function metodaNiedozwolona(res, kontekst, dozwolone, json = false) {
  res.setHeader('Allow', dozwolone);
  if (json) kontekst.odpowiedzJson(res, 405, { error: 'Metoda niedozwolona' });
  else kontekst.odpowiedzTekst(res, 405, 'Metoda niedozwolona');
  return true;
}

/** Cialo formularza (urlencoded) z limitem; za duze -> null. */
async function formularz(req, kontekst, limit = 16 * 1024) {
  try {
    return new URLSearchParams((await kontekst.czytajCialo(req, limit)).toString('utf8'));
  } catch (e) {
    if (e.status === 413) return null;
    throw e;
  }
}

async function wyslijPoczte(kontekst, wiadomosc) {
  try {
    const w = await kontekst.poczta.wyslij(wiadomosc, kontekst.KONF);
    return Boolean(w && w.ok);
  } catch (e) {
    console.error('[konta] poczta:', e.message);
    return false;
  }
}

/** Praca po wyslaniu odpowiedzi (wysylka resetu, powiadomienia); bledy tylko do dziennika. */
function wTle(zadanie) {
  const p = Promise.resolve().then(zadanie).catch((e) => console.error('[konta] w tle:', e.message));
  W_TLE.add(p);
  p.finally(() => W_TLE.delete(p));
  return p;
}

/** Do testow: czeka na prace w tle (wysylki po odpowiedzi). */
async function czekajNaTlo() {
  while (W_TLE.size) await Promise.all([...W_TLE]);
}

function ciasteczkaKluczy(kontekst) {
  try {
    const lista = kontekst.klucze.ciasteczkaUsuwajace(kontekst.KONF);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    console.error('[konta] ciasteczka kluczy:', e.message);
    return [];
  }
}

function dzis(teraz = Date.now()) {
  return new Date(teraz).toISOString().slice(0, 10);
}

function minuty(sekundy) {
  return Math.max(1, Math.ceil((Number(sekundy) || 60) / 60));
}

/** Plan nowych kont i liczba darmowych artykulow do tekstow ekranow (tylko pakiet Darmowy). */
function darmoweArtykuly(kontekst) {
  const { KONF, plany } = kontekst;
  const plan = plany.PLANY[KONF.planNowych];
  if (KONF.planNowych !== 'darmowy' || !plan || plan.okres !== 'zawsze') return null;
  const n = plan.limity && plan.limity.artykul;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pakietNaSprzedaz(kontekst, pakiet) {
  const p = kontekst.plany.PLANY[pakiet];
  return p && p.sprzedaz ? pakiet : '';
}

/** Po rejestracji albo dla zalogowanego z ?pakiet=: ekran zakupu (B), gdy platnosci dzialaja. */
function celPoRejestracji(kontekst, pakiet) {
  return pakietNaSprzedaz(kontekst, pakiet) && kontekst.funkcjaWlaczona('platnosci')
    ? `/konto/zakup?plan=${encodeURIComponent(pakiet)}&z=app` : '/';
}

/** Stopka ekranow: konto na wlasnym kluczu (i ekrany publiczne przy otwartej rejestracji) mowi o kluczu w przegladarce. */
function stopkaKonta(konto, jezyk) {
  return konto && konto.zrodloKluczy === 'wlasne' ? ekrany.teksty(jezyk).stopka : undefined;
}

function stopkaPubliczna(kontekst, jezyk) {
  return kontekst.funkcjaWlaczona('rejestracja') ? ekrany.teksty(jezyk).stopka : undefined;
}

// ─── Stan zgod (ARCH8-08) ────────────────────────────────────────────────────

/** Akceptacja regulaminu dotyczy kont samoobslugowych (konta zespolu tylko przy CAI_ZGODY_DLA_STARYCH=1). */
function zgodyDotycza(konto, KONF) {
  return Boolean(konto) && (konto.pochodzenie === 'samoobsluga' || KONF.zgodyDlaStarych);
}

function wymagaAkceptacji(konto, KONF) {
  return zgodyDotycza(konto, KONF) && Boolean(KONF.regulaminWersja) && konto.regulaminWersja !== KONF.regulaminWersja;
}

function stanZgod(konto, KONF, magazyn) {
  const dziennik = magazyn.zgody(konto.login);
  const ostatnia = (rodzaj) => dziennik.filter((z) => z.rodzaj === rodzaj).pop() || null;
  const polityka = ostatnia('polityka');
  const wymaga = wymagaAkceptacji(konto, KONF);
  return {
    regulamin: {
      wersja: konto.regulaminWersja || null, czas: konto.regulaminCzas || null, aktualna: KONF.regulaminWersja || null,
      wymagaAkceptacji: wymaga, wymuszona: wymaga && Boolean(KONF.wymusAkceptacje),
    },
    polityka: {
      wersja: polityka && polityka.wartosc ? polityka.wersja : null, czas: polityka ? polityka.czas : null,
      aktualna: KONF.politykaWersja || null,
    },
    marketing: Boolean(konto.marketing),
    dotyczy: zgodyDotycza(konto, KONF),
  };
}

/** 'tak' | 'zespol' (konto glowna, CAI_USUWANIE_STARYCH=0) | 'operator' | 'brama'. */
function mozliwoscUsuniecia(konto, kontekst) {
  if (kontekst.KONF.zaufanyNaglowek) return 'brama';
  if (kontekst.dzierzawy.operator(konto)) return 'operator';
  if (konto.pochodzenie !== 'samoobsluga' && !kontekst.KONF.usuwanieStarych) return 'zespol';
  return 'tak';
}

function subskrypcjaZywa(konto) {
  return Boolean(konto && konto.platnikKlient && ['probna', 'aktywna', 'zalegla', 'anulowana'].includes(konto.subskrypcjaStan));
}

// ─── Logowanie per konto (dla server.js, sekcja "Logowanie") ────────────────

const probyLogowania = {
  /** Klucz licznika: konto po loginie, a nieistniejace po wpisanym tekscie (to samo zachowanie). */
  klucz(konto, wpisany) {
    return konto ? `k:${konto.login}` : `?:${String(wpisany || '').trim().normalize('NFC').toLowerCase().slice(0, 254)}`;
  },
  zablokowane(klucz) {
    return !BLOKADA_KONTA.sprawdz({ konto: klucz }).wolno;
  },
  porazka(klucz) {
    PROBY_KONTA.zapisz({ konto: klucz });
    if (!PROBY_KONTA.sprawdz({ konto: klucz }).wolno) {
      BLOKADA_KONTA.zapisz({ konto: klucz });
      PROBY_KONTA.wyczysc({ konto: klucz });
    }
  },
  sukces(klucz) {
    PROBY_KONTA.wyczysc({ konto: klucz });
    BLOKADA_KONTA.wyczysc({ konto: klucz });
  },
};

// ─── Wysylki ─────────────────────────────────────────────────────────────────

/** Nowy link potwierdzajacy (uniewaznia poprzedni) i e-mail; wynik do banera w aplikacji. */
async function wyslijLinkPotwierdzenia(kontekst, konto, jezyk) {
  const { KONF, magazyn } = kontekst;
  const token = magazyn.zapiszToken({
    login: konto.login, rodzaj: 'potwierdzenie', email: konto.email, wazneMs: KONF.emailPotwierdzenieGodzin * GODZINA,
  });
  PONOWIENIE.zapisz({ login: konto.login });
  const ok = await wyslijPoczte(kontekst, {
    do: konto.email, szablon: 'potwierdzenie', jezyk,
    dane: {
      odnosnik: odnosnik(KONF, '/potwierdz', token, jezyk), email: konto.email,
      godzin: KONF.emailPotwierdzenieGodzin, minut: KONF.emailPotwierdzenieGodzin * 60,
    },
  });
  WYSYLKI.set(konto.login, { ok, czas: Date.now() });
  if (WYSYLKI.size > 5000) WYSYLKI.delete(WYSYLKI.keys().next().value);
  return ok;
}

/** Ponowienie linku dla zalogowanego: { stan: 'wyslano'|'potwierdzony'|'brak-emaila'|'limit'|'niedostepne'|'blad', ponowZa } */
async function ponowPotwierdzenie(kontekst) {
  const konto = kontekst.konto;
  if (!konto.email) return { stan: 'brak-emaila' };
  if (konto.emailPotwierdzony) return { stan: 'potwierdzony' };
  if (!pocztaKontDostepna(kontekst.KONF)) return { stan: 'niedostepne' };
  const w = PONOWIENIE.sprawdz({ login: konto.login });
  if (!w.wolno) return { stan: 'limit', ponowZa: w.ponowZa };
  const ok = await wyslijLinkPotwierdzenia(kontekst, konto, jezykKonta(konto, kontekst.jezyk));
  return { stan: ok ? 'wyslano' : 'blad' };
}

/** Reset hasla po odpowiedzi: limit na adres, konto z adresem, operator tylko przy CAI_RESET_ADMIN=1. */
async function wyslijReset(kontekst, adres, jezyk) {
  const { KONF, magazyn } = kontekst;
  if (!RESET_EMAIL.ocen({ email: adres }).wolno) return 'limit';
  const konto = magazyn.kontoPoEmailu(adres);
  if (!konto || !konto.email) return 'brak';
  if (konto.rola === 'admin' && !KONF.resetAdmin) {
    console.log('[konta] reset hasla konta admin pominiety (CAI_RESET_ADMIN=0)');
    return 'admin';
  }
  const token = magazyn.zapiszToken({ login: konto.login, rodzaj: 'reset', email: konto.email, wazneMs: KONF.resetMinut * MINUTA });
  const j = jezykKonta(konto, jezyk);
  const ok = await wyslijPoczte(kontekst, {
    do: konto.email, szablon: 'reset', jezyk: j,
    dane: { odnosnik: odnosnik(KONF, '/haslo/nowe', token, j), email: konto.email, minut: KONF.resetMinut },
  });
  return ok ? 'wyslano' : 'blad';
}

/** Powiadomienie bezpieczenstwa tylko na potwierdzony adres (niepotwierdzony moze byc cudzy). */
function powiadom(kontekst, konto, szablon, dane = {}) {
  if (!konto || !konto.email || !konto.emailPotwierdzony) return;
  wTle(() => wyslijPoczte(kontekst, {
    do: konto.email, szablon, jezyk: jezykKonta(konto, kontekst.jezyk),
    dane: { email: konto.email, adresAplikacji: kontekst.KONF.adresPubliczny || '', ...dane },
  }));
}

// ─── Usuwanie konta z danymi ─────────────────────────────────────────────────

// Plik, jego kopie po uszkodzeniu (.uszkodzony-*) i pliki tymczasowe zapisu (.<nazwa>.tmp-*):
// ten sam wzor co uzytkownicy.js usun (R3-38: nowe konto nie przejmuje cudzych resztek).
function usunPlikiZRodzina(plikiGlowne) {
  const usuniete = [];
  for (const plik of plikiGlowne) {
    const katalog = path.dirname(plik);
    const nazwa = path.basename(plik);
    let wpisy = [];
    try { wpisy = fs.readdirSync(katalog); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const w of wpisy) {
      if (w !== nazwa && !w.startsWith(`${nazwa}.uszkodzony-`) && !w.startsWith(`.${nazwa}.tmp-`)) continue;
      fs.unlinkSync(path.join(katalog, w));
      usuniete.push(path.join(katalog, w));
    }
  }
  return usuniete;
}

/**
 * Usuwa konto (kaskadowo liczniki i tokeny, wpis w konta_usuniete ze skrotem e-maila),
 * a gdy to ostatnie konto organizacji samoobslugowej, takze jej wiersz; potem pliki:
 * prywatna baza wiedzy, plik licznikow z R8 i pliki organizacji (marka, baza wspolna).
 * Zgody zostaja w bazie jako dowod (tabela bez klucza obcego). -> { usuniete, zOrganizacja, pliki }
 */
function usunKontoZDanymi(srodowisko, konto, { powod, teraz = Date.now() }) {
  const { KONF, magazyn, dzierzawy, plany } = srodowisko;
  const org = konto.organizacja;
  let zOrganizacja = false;
  const usuniete = magazyn.transakcja(() => {
    if (!magazyn.usunKonto(konto.login, { powod, emailSkrot: srodowisko.skrotEmaila(konto.email), teraz })) return false;
    if (org && org !== dzierzawy.GLOWNA && magazyn.liczbaKont({ organizacja: org }) === 0) {
      magazyn.usunOrganizacje(org);
      zOrganizacja = true;
    }
    return true;
  });
  if (!usuniete) return { usuniete: false, zOrganizacja: false, pliki: [] };
  const doUsuniecia = [path.join(KONF.katalogBazy, baza.nazwaPliku('prywatna', konto.login)), plany.plikUzycia(KONF.katalogUzycia, konto.login)];
  if (zOrganizacja) doUsuniecia.push(...dzierzawy.plikiOrganizacji(KONF, org));
  let usunietePliki = [];
  try {
    usunietePliki = usunPlikiZRodzina(doUsuniecia);
  } catch (e) {
    console.error(`[konta] usuwanie plikow konta ${konto.login}:`, e.code || e.message);
  }
  WYSYLKI.delete(konto.login);
  PONOWIENIE.wyczysc({ login: konto.login });
  HASLO_KONTA.wyczysc({ login: konto.login });
  probyLogowania.sukces(probyLogowania.klucz(konto));
  return { usuniete: true, zOrganizacja, pliki: usunietePliki };
}

/** Sprzatanie dobowe: konta samoobslugowe bez potwierdzenia, platnosci i logowania od CAI_NIEPOTWIERDZONE_DNI. */
function sprzatajNiepotwierdzone(srodowisko, teraz = Date.now()) {
  const { KONF, magazyn } = srodowisko;
  const loginy = magazyn.kontaNiepotwierdzone(teraz, KONF.niepotwierdzoneDni);
  let usunieto = 0;
  for (const login of loginy) {
    const k = magazyn.konto(login);
    if (k && usunKontoZDanymi(srodowisko, k, { powod: 'niepotwierdzone', teraz }).usuniete) usunieto += 1;
  }
  return { usunieto, loginy };
}

// ─── Eksport danych (ARCH8-08, PR8-29) ───────────────────────────────────────

function dokumentyEksportu(lista) {
  return lista.map((d) => ({
    id: d.id, nazwa: d.nazwa, zakres: d.zakres, dodany: d.dodany, url: baza.opis(d).url || null, znakow: d.znakow,
    tresc: (d.fragmenty || []).map((f) => f.tekst).join('\n'),
  }));
}

/** Dane konta do pobrania: bez hash i sol, bez wektorow; marka i baza wspolna tylko organizacji samoobslugowej. */
function eksportDanych(kontekst, teraz = Date.now()) {
  const { KONF, magazyn, plany, dzierzawy } = kontekst;
  const konto = kontekst.konto;
  const kopia = {};
  for (const [k, v] of Object.entries(konto)) if (!['hash', 'sol', 'org'].includes(k)) kopia[k] = v;
  const org = konto.org || magazyn.organizacja(konto.organizacja);
  const samoobsluga = Boolean(org) && org.rodzaj === 'samoobsluga';
  const prywatne = pliki.czytajJson(path.join(KONF.katalogBazy, baza.nazwaPliku('prywatna', konto.login)), [], pliki.czyTablica);
  const wspolne = samoobsluga ? pliki.czytajJson(dzierzawy.plikBazyWspolnej(KONF.katalogBazy, org.id), [], pliki.czyTablica) : null;
  const markaOrg = samoobsluga ? marka.oczysc(pliki.czytajJson(dzierzawy.plikMarki(KONF.katalogMarki, org.id), {}, pliki.czyObiekt)) : null;
  const en = kontekst.jezyk === 'en';
  return {
    format: 'content-ai-eksport-danych',
    wersja: 1,
    utworzono: new Date(teraz).toISOString(),
    konto: kopia,
    organizacja: org ? { id: org.id, nazwa: org.nazwa, rodzaj: org.rodzaj, utworzona: org.utworzona } : null,
    pakiet: plany.stanPakietu({ konto }),
    subskrypcja: kontekst.platnosci.stanDlaKonta(konto, kontekst).subskrypcja,
    platnosci: magazyn.platnosciKonta(konto.login),
    zgody: magazyn.zgody(konto.login),
    uzycie: magazyn.uzycieKonta(konto.login),
    bazaWiedzy: { prywatna: dokumentyEksportu(prywatne), wspolna: wspolne ? dokumentyEksportu(wspolne) : null },
    marka: markaOrg,
    uwagi: en
      ? 'Article history, drafts, CMS settings and saved API keys are stored only in your browser, not on the server. Export the history in the app. The team knowledge base and brand of a team account belong to the team and are not included.'
      : 'Historia artykułów, szkice, ustawienia CMS i zapamiętane klucze API są tylko w Twojej przeglądarce, nie na serwerze. Historię wyeksportujesz w aplikacji. Baza wspólna i marka konta zespołu należą do zespołu i nie wchodzą do eksportu.',
  };
}

// ─── Stan konta dla aplikacji: GET /api/konto (rozdz. 4.4) ──────────────────

function stanKonta(kontekst) {
  const { KONF, magazyn, plany, dzierzawy, oznaczenia, platnosci } = kontekst;
  const konto = kontekst.konto;
  const p = platnosci.stanDlaKonta(konto, kontekst);
  const u = KONF.uslugodawca || {};
  const brama = Boolean(KONF.zaufanyNaglowek);
  const czekaNaPotwierdzenie = Boolean(konto.email) && !konto.emailPotwierdzony;
  const wysylka = WYSYLKI.get(konto.login) || null;
  const ponow = czekaNaPotwierdzenie ? PONOWIENIE.sprawdz({ login: konto.login }) : null;
  return {
    login: konto.login,
    email: konto.email || null,
    emailPotwierdzony: Boolean(konto.emailPotwierdzony),
    emailNowy: konto.emailNowy || null,
    rola: konto.rola,
    pochodzenie: konto.pochodzenie,
    zrodloKluczy: konto.zrodloKluczy,
    jezyk: konto.jezyk,
    organizacja: dzierzawy.opisDlaAplikacji(konto),
    pakiet: plany.stanPakietu({ konto }),
    subskrypcja: p.subskrypcja,
    platnosci: p.platnosci,
    zgody: stanZgod(konto, KONF, magazyn),
    oznaczenia: oznaczenia.dlaKonta(konto, KONF),
    uslugodawca: { nazwa: u.imieNazwisko || null, adres: u.adres || null, email: u.email || null, telefon: u.telefon || null, www: u.www || null },
    potwierdzenie: czekaNaPotwierdzenie
      ? { wyslano: wysylka ? wysylka.ok : null, czas: wysylka ? wysylka.czas : null, ponowZa: ponow && !ponow.wolno ? ponow.ponowZa : 0 }
      : null,
    mozliwosci: {
      zmianaEmaila: !brama && pocztaKontDostepna(KONF),
      zmianaHasla: !brama,
      wylogujWszedzie: !brama,
      usuniecie: mozliwoscUsuniecia(konto, kontekst) === 'tak',
      eksport: true,
    },
    adresy: {
      konto: '/konto', eksport: '/konto/eksport', usun: '/konto/usun', zgody: '/konto/zgody',
      regulamin: KONF.regulaminUrl, polityka: KONF.politykaUrl,
      dokumentRegulaminu: dokumentyPrawne.adres('regulamin', kontekst.jezyk),
      dokumentPolityki: dokumentyPrawne.adres('prywatnosc', kontekst.jezyk),
    },
    // Dla formularzy POST /konto/* wysylanych z aplikacji (wyloguj wszedzie, ponowienie linku).
    csrf: tokenCsrf(kontekst),
  };
}

// ─── Trasy publiczne ─────────────────────────────────────────────────────────

function daneRejestracji(kontekst, jezyk, o = {}) {
  const { KONF, plany } = kontekst;
  const pakiet = pakietNaSprzedaz(kontekst, o.pakiet);
  return {
    ...o,
    jezyk,
    pakiet,
    nazwaPakietu: pakiet ? (jezyk === 'en' ? plany.PLANY[pakiet].nazwaEn : plany.PLANY[pakiet].nazwa) : '',
    doPlatnosci: kontekst.funkcjaWlaczona('platnosci'),
    darmowe: darmoweArtykuly(kontekst),
    adresy: {
      regulamin: dokumentyPrawne.adres('regulamin', jezyk), polityka: dokumentyPrawne.adres('prywatnosc', jezyk), logowanie: `/?lang=${jezyk}`,
    },
    administrator: KONF.uslugodawca && KONF.uslugodawca.imieNazwisko,
    hasloMin: ZASADY.hasloMin,
    hasloMax: ZASADY.hasloMax,
    turnstile: turnstileWlaczony(KONF) ? { klucz: KONF.turnstile.klucz } : null,
    znacznik: znacznikFormularza(kontekst.podpisz),
    przelacznikHref: `/rejestracja?lang=${jezyk === 'en' ? 'pl' : 'en'}${pakiet ? `&pakiet=${pakiet}` : ''}`,
  };
}

function ekranRejestracji(res, kontekst, status, jezyk, o = {}, naglowki = {}) {
  if (turnstileWlaczony(kontekst.KONF)) cspZTurnstile(res);
  return wyslijHtml(res, kontekst, status, ekrany.ekranRejestracji(daneRejestracji(kontekst, jezyk, o)), naglowki);
}

async function rejestracja(req, res, kontekst) {
  const { KONF, magazyn, url } = kontekst;
  const metoda = req.method;
  if (metoda === 'GET' || metoda === 'HEAD') {
    const jezyk = kontekst.jezyk;
    if (url.searchParams.get('wyslano') === '1') {
      return wyslijHtml(res, kontekst, 200, ekrany.ekranSprawdzPoczty({ jezyk, adresLogowania: `/?lang=${jezyk}`, przelacznikHref: `/rejestracja?wyslano=1&lang=${jezyk === 'en' ? 'pl' : 'en'}` }));
    }
    // Zalogowany nie zaklada drugiego konta: aplikacja albo zakup wybranego pakietu (STR8-03).
    if (kontekst.sesjaZadania(req)) return przekieruj(res, celPoRejestracji(kontekst, url.searchParams.get('pakiet')));
    return ekranRejestracji(res, kontekst, 200, jezyk, { pakiet: url.searchParams.get('pakiet') || '' });
  }
  if (metoda !== 'POST') return metodaNiedozwolona(res, kontekst, 'GET, HEAD, POST');

  if (kontekst.obcePochodzenie(req)) {
    return wyslijHtml(res, kontekst, 403, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'obce-zrodlo', odnosnik: { href: '/rejestracja', tekst: ekrany.teksty(kontekst.jezyk).rejNaglowek } }));
  }
  const ip = kontekst.adresIp(req);
  const dane = await formularz(req, kontekst);
  const jezyk = kontekst.jezykZadania(req, dane && dane.get('jezyk'));
  if (!dane) return ekranRejestracji(res, kontekst, 413, jezyk, { komunikat: { kod: 'popraw-pola' } });
  const pakiet = String(dane.get('pakiet') || '');
  const email = String(dane.get('email') || '').trim().slice(0, ZASADY.emailMax);
  const haslo = String(dane.get('haslo') || '');
  const zaznaczone = { regulamin: dane.get('zgoda_regulamin') === '1', wiek: dane.get('zgoda_wiek') === '1' };
  const ponownie = (status, o, naglowki) => ekranRejestracji(res, kontekst, status, jezyk, { pakiet, email, zaznaczone, ...o }, naglowki);

  const limit = REJESTRACJA.sprawdz({ ip });
  if (!limit.wolno) {
    if (limit.regula === 'wszystko' && Date.now() - ostatnieOstrzezenieLimitu > GODZINA) {
      ostatnieOstrzezenieLimitu = Date.now();
      console.warn('[konta] rejestracja: wyczerpany dobowy limit wszystkich rejestracji (300) - nowe konta odrzucane do jutra');
    }
    return ponownie(429, { komunikat: { kod: 'za-duzo-prob', wartosc: minuty(limit.ponowZa) } }, { 'Retry-After': String(limit.ponowZa || 60) });
  }
  // Pole-pulapka wypelniaja automaty: udawany sukces, nic nie zapisujemy (wzor prosby.js).
  if (String(dane.get('strona') || '').trim()) {
    REJESTRACJA.zapisz({ ip });
    console.log('[konta] rejestracja: pole-pulapka wypelnione - bez zapisu');
    return przekieruj(res, `/rejestracja?wyslano=1&lang=${jezyk}`);
  }
  const znacznik = ocenZnacznik(dane.get('t'), kontekst.podpisz);
  if (znacznik !== 'ok') return ponownie(400, { komunikat: { kod: znacznik === 'szybko' ? 'formularz-szybko' : 'formularz-wygasl' } });

  const adres = magazyn.normalizujEmail(email);
  const bledy = {};
  if (!adres || !poprawnyEmail(adres)) bledy.email = 'email-zly';
  const bladHasla = ocenHaslo(haslo, adres);
  if (bladHasla) bledy.haslo = bladHasla;
  if (!zaznaczone.regulamin) bledy.regulamin = 'regulamin';
  if (!zaznaczone.wiek) bledy.wiek = 'wiek';
  if (Object.keys(bledy).length) return ponownie(400, { bledy, komunikat: { kod: 'popraw-pola' } });

  if (turnstileWlaczony(KONF) && !(await sprawdzTurnstile(KONF, dane.get('cf-turnstile-response'), ip))) {
    return ponownie(400, { komunikat: { kod: 'turnstile' } });
  }
  // Od tej chwili proba sie liczy: limit chroni tez przed sprawdzaniem, czy adres ma konto.
  REJESTRACJA.zapisz({ ip });
  // Swiadomie (ARCH8-06): przy logowaniu od razu po rejestracji istnienia adresu i tak
  // nie da sie ukryc (nowy adres loguje, istniejacy nie), wiec mowimy to wprost przy polu.
  if (magazyn.kontoPoEmailu(adres)) return ponownie(400, { bledy: { email: 'email-zajety' }, komunikat: { kod: 'popraw-pola' } });

  let skrot;
  try {
    skrot = await kontekst.zahaszujAsync(haslo);
  } catch (e) {
    if (e instanceof kontekst.BladZajety) return ponownie(429, { komunikat: { kod: 'zajety' } }, { 'Retry-After': '5' });
    throw e;
  }
  const teraz = Date.now();
  const ipZgody = KONF.zgodyIp ? ip : null;
  let konto;
  try {
    konto = magazyn.transakcja(() => {
      const k = magazyn.utworzOrganizacjeIKonto({
        email: adres, hash: skrot.hash, sol: skrot.sol, jezyk, plan: null, zrodloKluczy: 'wlasne', teraz,
      });
      magazyn.zmienKonto(k.login, { regulaminWersja: KONF.regulaminWersja, regulaminCzas: teraz });
      const zgoda = (rodzaj, wersja) => magazyn.dopiszZgode({ login: k.login, rodzaj, wersja, wartosc: true, zrodlo: 'rejestracja', ip: ipZgody, teraz });
      zgoda('regulamin', KONF.regulaminWersja);
      zgoda('polityka', KONF.politykaWersja);
      zgoda('pelnoletnosc', null);
      return magazyn.kontoZOrganizacja(k.login);
    });
  } catch (e) {
    if (e instanceof magazyn.BladKonfliktu) return ponownie(400, { bledy: { email: 'email-zajety' }, komunikat: { kod: 'popraw-pola' } });
    throw e;
  }
  console.log(`[konta] rejestracja: ${konto.login} (${kontekst.poczta.maskujAdres(adres)})`);
  await wyslijLinkPotwierdzenia(kontekst, konto, jezyk);
  // Logowanie od razu po rejestracji (ARCH8-06): generowanie na wlasnym kluczu dziala,
  // zasoby oplacane przez serwer czekaja na potwierdzenie adresu.
  return przekieruj(res, celPoRejestracji(kontekst, pakiet), { 'Set-Cookie': kontekst.ciasteczkoSesji(konto) });
}

/** Token z odnosnika: potwierdzenie albo zmiana adresu (takze zuzyty - ekran "juz potwierdzony"). */
function tokenAdresu(magazyn, token) {
  for (const rodzaj of ['potwierdzenie', 'zmiana-email']) {
    const r = magazyn.sprawdzToken(token, rodzaj, { takzeUzyte: true });
    if (r) return { rodzaj, ...r };
  }
  return null;
}

/** Stan ekranu potwierdzenia bez zmian w bazie: 'formularz' | 'juz' | 'niewazny'. */
function stanTokenuAdresu(magazyn, rec) {
  if (!rec) return 'niewazny';
  const konto = magazyn.konto(rec.login);
  if (!konto) return 'niewazny';
  if (rec.rodzaj === 'potwierdzenie') {
    if (konto.email !== rec.email) return 'niewazny';
    if (konto.emailPotwierdzony) return 'juz';
    return rec.uzyty ? 'niewazny' : 'formularz';
  }
  if (rec.uzyty) return konto.email === rec.email && konto.emailPotwierdzony ? 'juz' : 'niewazny';
  return konto.emailNowy === rec.email ? 'formularz' : 'niewazny';
}

async function potwierdz(req, res, kontekst) {
  const { magazyn, url } = kontekst;
  const metoda = req.method;
  const sesja = kontekst.sesjaZadania(req);
  const ekran = (status, jezyk, o) => wyslijHtml(res, kontekst, status, ekrany.ekranPotwierdzenia({
    jezyk, zalogowany: Boolean(sesja), csrf: sesja ? tokenCsrf(kontekst, sesja) : '', stopka: stopkaPubliczna(kontekst, jezyk), ...o,
  }));
  if (metoda === 'GET' || metoda === 'HEAD') {
    // GET niczego nie zmienia: skaner poczty, ktory otworzy link, nie potwierdza adresu.
    const token = String(url.searchParams.get('t') || '');
    const rec = tokenAdresu(magazyn, token);
    const stan = stanTokenuAdresu(magazyn, rec);
    return ekran(200, kontekst.jezyk, {
      stan, rodzaj: rec ? rec.rodzaj : 'potwierdzenie', email: rec ? rec.email : '', token,
      przelacznikHref: `/potwierdz?t=${encodeURIComponent(token)}&lang=${kontekst.jezyk === 'en' ? 'pl' : 'en'}`,
    });
  }
  if (metoda !== 'POST') return metodaNiedozwolona(res, kontekst, 'GET, HEAD, POST');
  if (kontekst.obcePochodzenie(req)) {
    return wyslijHtml(res, kontekst, 403, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'obce-zrodlo' }));
  }
  if (!TOKENY.ocen({ ip: kontekst.adresIp(req) }).wolno) {
    return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'za-duzo-prob' }));
  }
  const dane = await formularz(req, kontekst);
  const jezyk = kontekst.jezykZadania(req, dane && dane.get('jezyk'));
  const token = String((dane && dane.get('t')) || '');
  const rec = tokenAdresu(magazyn, token);
  const stan = stanTokenuAdresu(magazyn, rec);
  if (stan !== 'formularz') return ekran(stan === 'juz' ? 200 : 400, jezyk, { stan, rodzaj: rec ? rec.rodzaj : 'potwierdzenie' });
  const teraz = Date.now();
  let wynik;
  try {
    wynik = magazyn.transakcja(() => {
      const k = magazyn.konto(rec.login);
      if (rec.rodzaj === 'potwierdzenie') {
        if (!k || k.email !== rec.email) return 'niewazny';
        if (!magazyn.zuzyjToken(token, 'potwierdzenie', { teraz })) return k.emailPotwierdzony ? 'juz' : 'niewazny';
        if (!k.emailPotwierdzony) magazyn.zmienKonto(k.login, { emailPotwierdzony: teraz });
        return 'potwierdzony';
      }
      if (!k || k.emailNowy !== rec.email) return 'niewazny';
      const zajety = magazyn.kontoPoEmailu(rec.email);
      if (zajety && zajety.login !== k.login) return 'zajety';
      if (!magazyn.zuzyjToken(token, 'zmiana-email', { teraz })) return 'niewazny';
      magazyn.zmienKonto(k.login, { email: rec.email, emailNowy: null, emailPotwierdzony: teraz });
      // Linki wyslane na stary adres (reset, potwierdzenie) przestaja dzialac.
      magazyn.usunTokeny(k.login, ['potwierdzenie', 'reset']);
      return 'potwierdzony';
    });
  } catch (e) {
    if (!(e instanceof magazyn.BladKonfliktu)) throw e;
    wynik = 'zajety';
  }
  if (wynik === 'potwierdzony') console.log(`[konta] ${rec.rodzaj === 'zmiana-email' ? 'zmiana adresu' : 'adres potwierdzony'}: ${rec.login}`);
  return ekran(wynik === 'potwierdzony' || wynik === 'juz' ? 200 : (wynik === 'zajety' ? 409 : 400), jezyk, {
    stan: wynik, rodzaj: rec.rodzaj, email: rec.email,
  });
}

async function resetHasla(req, res, kontekst) {
  const { KONF, magazyn } = kontekst;
  const metoda = req.method;
  const ekran = (status, jezyk, o) => {
    if (turnstileWlaczony(KONF) && o.stan === 'formularz') cspZTurnstile(res);
    return wyslijHtml(res, kontekst, status, ekrany.ekranResetu({
      jezyk, minut: KONF.resetMinut, kontakt: KONF.uslugodawca && KONF.uslugodawca.email,
      turnstile: turnstileWlaczony(KONF) ? { klucz: KONF.turnstile.klucz } : null,
      przelacznikHref: `/haslo?lang=${jezyk === 'en' ? 'pl' : 'en'}`, stopka: stopkaPubliczna(kontekst, jezyk), ...o,
    }));
  };
  if (metoda === 'GET' || metoda === 'HEAD') {
    return ekran(200, kontekst.jezyk, { stan: pocztaKontDostepna(KONF) ? 'formularz' : 'niedostepny' });
  }
  if (metoda !== 'POST') return metodaNiedozwolona(res, kontekst, 'GET, HEAD, POST');
  if (kontekst.obcePochodzenie(req)) {
    return wyslijHtml(res, kontekst, 403, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'obce-zrodlo', odnosnik: { href: '/haslo', tekst: ekrany.teksty(kontekst.jezyk).resetNaglowek } }));
  }
  const ip = kontekst.adresIp(req);
  const dane = await formularz(req, kontekst);
  const jezyk = kontekst.jezykZadania(req, dane && dane.get('jezyk'));
  if (!pocztaKontDostepna(KONF)) return ekran(200, jezyk, { stan: 'niedostepny' });
  const email = String((dane && dane.get('email')) || '').trim().slice(0, ZASADY.emailMax);
  const limit = RESET_ADRES.sprawdz({ ip });
  if (!limit.wolno) {
    res.setHeader('Retry-After', String(limit.ponowZa || 60));
    return ekran(429, jezyk, { stan: 'formularz', email, komunikat: { kod: 'za-duzo-prob', wartosc: minuty(limit.ponowZa) } });
  }
  RESET_ADRES.zapisz({ ip });
  const adres = magazyn.normalizujEmail(email);
  if (!adres || !poprawnyEmail(adres)) return ekran(400, jezyk, { stan: 'formularz', email, blad: 'email-zly' });
  if (turnstileWlaczony(KONF) && !(await sprawdzTurnstile(KONF, dane.get('cf-turnstile-response'), ip))) {
    return ekran(400, jezyk, { stan: 'formularz', email, komunikat: { kod: 'turnstile' } });
  }
  // Ta sama odpowiedz dla kazdego adresu (SEC8-21), a wyszukanie konta i wysylka dopiero
  // po odpowiedzi: czas odpowiedzi nie zalezy od tego, czy konto istnieje.
  ekran(200, jezyk, { stan: 'wyslano', email: adres });
  wTle(() => wyslijReset(kontekst, adres, jezyk));
  return true;
}

/** Konto z tokenu resetu (bez zuzycia) albo null: konto istnieje, adres sie zgadza, operator wg CAI_RESET_ADMIN. */
function kontoZTokenuResetu(kontekst, token) {
  const { KONF, magazyn } = kontekst;
  const rec = magazyn.sprawdzToken(token, 'reset');
  if (!rec) return null;
  const konto = magazyn.konto(rec.login);
  if (!konto || konto.email !== rec.email) return null;
  if (konto.rola === 'admin' && !KONF.resetAdmin) return null;
  return { rec, konto };
}

async function noweHaslo(req, res, kontekst) {
  const { KONF, magazyn, url } = kontekst;
  const metoda = req.method;
  const ekran = (status, jezyk, o) => wyslijHtml(res, kontekst, status, ekrany.ekranNowegoHasla({
    jezyk, hasloMin: ZASADY.hasloMin, hasloMax: ZASADY.hasloMax, stopka: stopkaPubliczna(kontekst, jezyk), ...o,
  }));
  if (metoda === 'GET' || metoda === 'HEAD') {
    // GET pokazuje formularz i NIE zuzywa tokenu (ARCH8-07): zuzywa go dopiero zapis hasla.
    const token = String(url.searchParams.get('t') || '');
    const z = kontoZTokenuResetu(kontekst, token);
    const przelacznikHref = `/haslo/nowe?t=${encodeURIComponent(token)}&lang=${kontekst.jezyk === 'en' ? 'pl' : 'en'}`;
    if (!z) return ekran(200, kontekst.jezyk, { stan: 'niewazny', przelacznikHref });
    return ekran(200, kontekst.jezyk, { stan: 'formularz', token, email: z.konto.email, przelacznikHref, stopka: stopkaKonta(z.konto, kontekst.jezyk) });
  }
  if (metoda !== 'POST') return metodaNiedozwolona(res, kontekst, 'GET, HEAD, POST');
  if (kontekst.obcePochodzenie(req)) {
    return wyslijHtml(res, kontekst, 403, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'obce-zrodlo' }));
  }
  if (!TOKENY.ocen({ ip: kontekst.adresIp(req) }).wolno) {
    return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'za-duzo-prob' }));
  }
  const dane = await formularz(req, kontekst);
  const jezyk = kontekst.jezykZadania(req, dane && dane.get('jezyk'));
  const token = String((dane && dane.get('t')) || '');
  const haslo = String((dane && dane.get('haslo')) || '');
  const z = kontoZTokenuResetu(kontekst, token);
  if (!z) return ekran(400, jezyk, { stan: 'niewazny' });
  // Walidacja przed zuzyciem tokenu: literowka w hasle nie pali linku.
  const bladHasla = ocenHaslo(haslo, z.konto.email);
  if (bladHasla) return ekran(400, jezyk, { stan: 'formularz', token, email: z.konto.email, blad: bladHasla, komunikat: { kod: 'popraw-pola' } });
  let skrot;
  try {
    skrot = await kontekst.zahaszujAsync(haslo);
  } catch (e) {
    if (e instanceof kontekst.BladZajety) return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk, kod: 'zajety' }));
    throw e;
  }
  const teraz = Date.now();
  const konto = magazyn.transakcja(() => {
    if (!magazyn.zuzyjToken(token, 'reset', { teraz })) return null;
    const k = magazyn.konto(z.rec.login);
    if (!k || k.email !== z.rec.email) return null;
    // Nowe haslo odcina wszystkie dotychczasowe sesje (sesjeOd), a link z tej skrzynki
    // potwierdza tez sam adres.
    magazyn.zmienKonto(k.login, { hash: skrot.hash, sol: skrot.sol, sesjeOd: teraz, emailPotwierdzony: k.emailPotwierdzony || teraz });
    magazyn.usunTokeny(k.login, ['reset']);
    return magazyn.kontoZOrganizacja(k.login);
  });
  if (!konto) return ekran(400, jezyk, { stan: 'niewazny' });
  // Reset dziala mimo blokady logowania na konto i ja zdejmuje (dowod posiadania skrzynki).
  probyLogowania.sukces(probyLogowania.klucz(konto));
  HASLO_KONTA.wyczysc({ login: konto.login });
  console.log(`[konta] nowe haslo z linku resetu: ${konto.login}`);
  powiadom(kontekst, konto, 'haslo-zmienione', { odnosnikResetu: `${KONF.adresPubliczny}/haslo` });
  return przekieruj(res, '/', { 'Set-Cookie': [kontekst.ciasteczkoSesji(konto), ...ciasteczkaKluczy(kontekst)] });
}

/**
 * GET/POST /rejestracja, GET/POST /potwierdz, GET/POST /haslo, GET/POST /haslo/nowe, GET /do-widzenia.
 * -> true, gdy obsluzone. Tryb bramy (CAI_ZAUFANY_NAGLOWEK): konta i hasla trzyma brama - false.
 * Rejestracja wylaczona (CAI_REJESTRACJA=0 albo zla konfiguracja): /rejestracja -> false (jak dzis).
 */
async function obsluzPubliczne(sciezka, req, res, kontekst) {
  if (!SCIEZKI_PUBLICZNE.includes(sciezka)) return false;
  if (kontekst.KONF.zaufanyNaglowek) return false;
  switch (sciezka) {
    case '/rejestracja':
      if (!kontekst.funkcjaWlaczona('rejestracja')) return false;
      return rejestracja(req, res, kontekst);
    case '/potwierdz':
      return potwierdz(req, res, kontekst);
    case '/haslo':
      return resetHasla(req, res, kontekst);
    case '/haslo/nowe':
      return noweHaslo(req, res, kontekst);
    case '/do-widzenia':
      if (req.method !== 'GET' && req.method !== 'HEAD') return metodaNiedozwolona(res, kontekst, 'GET, HEAD');
      return wyslijHtml(res, kontekst, 200, ekrany.ekranPozegnania({ jezyk: kontekst.jezyk, stopka: stopkaPubliczna(kontekst, kontekst.jezyk) }));
    default:
      return false;
  }
}

// ─── Trasy z sesja ───────────────────────────────────────────────────────────

// Zasoby oplacane przez serwer, ktore czekaja na potwierdzenie adresu (ARCH8-05/06):
// pobieranie stron i sprawdzanie odnosnikow (pasmo i adres IP serwera). Wektory bazy
// wiedzy sa dla kont samoobslugowych wylaczone (D-09), a SERP z DataForSEO sprawdza C.
const ZASOBY_PO_POTWIERDZENIU = { '/api/strona': 'strony', '/api/odnosniki': 'strony' };

function trasaKonta(sciezka) {
  return sciezka === '/api/konto' || sciezka.startsWith('/api/konto/');
}

/** Bramki dla tras dalej w routerze; true = odpowiedz wyslana. */
function bramki(sciezka, req, res, kontekst) {
  const { KONF } = kontekst;
  const konto = kontekst.konto;
  const zmienia = req.method !== 'GET' && req.method !== 'HEAD';
  // Nowa wersja regulaminu przy CAI_WYMUS_AKCEPTACJE=1: API uzycia czeka na akceptacje
  // (stan konta, akceptacja i przerwanie zadania dzialaja; strony tez, zeby dalo sie zaakceptowac).
  if (KONF.wymusAkceptacje && zmienia && (sciezka === '/api' || sciezka.startsWith('/api/'))
    && !trasaKonta(sciezka) && sciezka !== '/api/zadanie/anuluj' && wymagaAkceptacji(konto, KONF)) {
    req.resume();
    kontekst.bladCai(res, 'zgoda-wymagana', 403, { wersja: KONF.regulaminWersja });
    return true;
  }
  if (zmienia && ZASOBY_PO_POTWIERDZENIU[sciezka] && wymagaPotwierdzenia(konto)) {
    req.resume();
    kontekst.bladCai(res, 'email-niepotwierdzony', 403, { akcja: ZASOBY_PO_POTWIERDZENIU[sciezka] });
    return true;
  }
  return false;
}

function daneEkranuKonta(kontekst, o = {}) {
  const { KONF, plany } = kontekst;
  const konto = kontekst.konto;
  const jezyk = kontekst.jezyk;
  const brama = Boolean(KONF.zaufanyNaglowek);
  const rodzaj = konto.org ? konto.org.rodzaj : (konto.organizacja === kontekst.dzierzawy.GLOWNA ? 'glowna' : 'samoobsluga');
  const zespolowe = rodzaj === 'glowna';
  const pakiet = plany.stanPakietu({ konto });
  const uzycie = ['artykul', 'grafika', 'audio', 'transkrypcja']
    .filter((c) => pakiet.uzycie[c] && pakiet.uzycie[c].limit !== 0)
    .map((c) => ({ czynnosc: c, limit: pakiet.uzycie[c].limit, zuzyte: pakiet.uzycie[c].zuzyte }));
  const stanPlatnosci = kontekst.platnosci.stanDlaKonta(konto, kontekst);
  let sekcjaPlatnosci = '';
  if (typeof ekranyPlatnosci.sekcjaKonta === 'function') {
    try {
      sekcjaPlatnosci = String(ekranyPlatnosci.sekcjaKonta({ jezyk, konto, stan: stanPlatnosci, kontekst }) || '');
    } catch (e) {
      console.error('[konta] sekcja platnosci:', e.message);
    }
  }
  const zgody = stanZgod(konto, KONF, kontekst.magazyn);
  return {
    naglowek: konto.email || konto.login, utworzonyMs: konto.utworzonyMs, zespolowe,
    email: konto.email, emailPotwierdzony: Boolean(konto.emailPotwierdzony), emailNowy: konto.emailNowy,
    csrf: tokenCsrf(kontekst), hasloMin: ZASADY.hasloMin, hasloMax: ZASADY.hasloMax,
    mozliwosci: { email: !brama && pocztaKontDostepna(KONF), haslo: !brama, sesje: !brama, usun: mozliwoscUsuniecia(konto, kontekst) },
    pakiet: { nazwa: jezyk === 'en' ? pakiet.nazwaEn : pakiet.nazwa, uzycie, zespolu: zespolowe },
    sekcjaPlatnosci,
    adresZakupu: !sekcjaPlatnosci && stanPlatnosci.platnosci.wlaczone && !zespolowe ? `/konto/zakup?z=konto&lang=${jezyk}` : '',
    zgody: { ...zgody.regulamin, dotyczy: zgody.dotyczy },
    adresy: { regulamin: dokumentyPrawne.adres('regulamin', jezyk), polityka: dokumentyPrawne.adres('prywatnosc', jezyk) },
    brama,
    stopka: stopkaKonta(konto, jezyk),
    ...o,
  };
}

function ekranKonta(res, kontekst, status, o = {}) {
  // Formularz panelu klienta przekierowuje do hosta dostawcy platnosci: CSP form-action z modulu B.
  if (kontekst.platnosci && typeof kontekst.platnosci.cspEkranu === 'function') kontekst.platnosci.cspEkranu(res, kontekst);
  return wyslijHtml(res, kontekst, status, ekrany.ekranKonta({ jezyk: kontekst.jezyk, dane: daneEkranuKonta(kontekst, o) }));
}

const KOMUNIKATY_OK = { haslo: 'ok-haslo', email: 'ok-email', potwierdzenie: 'ok-potwierdzenie', zgoda: 'ok-zgoda' };

/** Komunikat ekranu konta z adresu po przekierowaniu (?ok=haslo, ?blad=wysylka, ?blad=ponow&za=40). */
function komunikatZAdresu(url) {
  const ok = url.searchParams.get('ok');
  if (KOMUNIKATY_OK[ok]) return { kod: KOMUNIKATY_OK[ok], rodzaj: 'ok' };
  const blad = url.searchParams.get('blad');
  if (blad === 'wysylka') return { kod: 'wysylka-blad' };
  if (blad === 'ponow') return { kod: 'ponow-czekaj', rodzaj: 'info', wartosc: Math.max(1, Math.min(3600, Number(url.searchParams.get('za')) || 60)) };
  return null;
}

function odmowaCsrf(res, kontekst) {
  return wyslijHtml(res, kontekst, 403, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'csrf', odnosnik: { href: '/konto', tekst: ekrany.teksty(kontekst.jezyk).wrocDoKonta } }));
}

function zaDuzoProbKonta(res, kontekst, ponowZa) {
  res.setHeader('Retry-After', String(ponowZa || 60));
  return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'za-duzo-prob', odnosnik: { href: '/konto', tekst: ekrany.teksty(kontekst.jezyk).wrocDoKonta } }));
}

/** Haslo z formularza konta: true | false (porazka policzona) | 'zajety'. */
async function hasloKontaPasuje(kontekst, haslo) {
  const konto = kontekst.konto;
  try {
    if (await kontekst.hasloPasujeAsync(String(haslo || ''), konto)) {
      HASLO_KONTA.wyczysc({ login: konto.login });
      return true;
    }
  } catch (e) {
    if (e instanceof kontekst.BladZajety) return 'zajety';
    throw e;
  }
  HASLO_KONTA.zapisz({ login: konto.login });
  return false;
}

async function zmianaHasla(req, res, kontekst) {
  const konto = kontekst.konto;
  if (kontekst.KONF.zaufanyNaglowek) return wyslijHtml(res, kontekst, 404, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'niedostepne' }));
  const dane = await formularz(req, kontekst);
  if (!dane || !csrfPoprawny(kontekst, dane.get('csrf'))) return odmowaCsrf(res, kontekst);
  const limit = HASLO_KONTA.sprawdz({ login: konto.login });
  if (!limit.wolno) return zaDuzoProbKonta(res, kontekst, limit.ponowZa);
  const pasuje = await hasloKontaPasuje(kontekst, dane.get('stare'));
  if (pasuje === 'zajety') return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'zajety' }));
  if (!pasuje) return ekranKonta(res, kontekst, 400, { bledy: { stare: 'haslo-zle' }, komunikat: { kod: 'popraw-pola' } });
  const nowe = String(dane.get('nowe') || '');
  const blad = ocenHaslo(nowe, konto.email);
  if (blad) return ekranKonta(res, kontekst, 400, { bledy: { nowe: blad }, komunikat: { kod: 'popraw-pola' } });
  let skrot;
  try {
    skrot = await kontekst.zahaszujAsync(nowe);
  } catch (e) {
    if (e instanceof kontekst.BladZajety) return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'zajety' }));
    throw e;
  }
  const teraz = Date.now();
  kontekst.magazyn.zmienKonto(konto.login, { hash: skrot.hash, sol: skrot.sol, sesjeOd: teraz });
  kontekst.magazyn.usunTokeny(konto.login, ['reset']);
  probyLogowania.sukces(probyLogowania.klucz(konto));
  console.log(`[konta] zmiana hasla: ${konto.login}`);
  powiadom(kontekst, konto, 'haslo-zmienione', { odnosnikResetu: pocztaKontDostepna(kontekst.KONF) ? `${kontekst.KONF.adresPubliczny}/haslo` : '' });
  // To urzadzenie zostaje zalogowane nowa sesja; pozostale odcina sesjeOd. Zapamietane
  // klucze API znikaja (DECYZJE-R9 M-10).
  const swieze = kontekst.magazyn.kontoZOrganizacja(konto.login);
  return przekieruj(res, `/konto?ok=haslo&lang=${kontekst.jezyk}`, { 'Set-Cookie': [kontekst.ciasteczkoSesji(swieze), ...ciasteczkaKluczy(kontekst)] });
}

async function zmianaEmaila(req, res, kontekst) {
  const { KONF, magazyn } = kontekst;
  const konto = kontekst.konto;
  if (KONF.zaufanyNaglowek || !pocztaKontDostepna(KONF)) return wyslijHtml(res, kontekst, 404, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'niedostepne' }));
  const dane = await formularz(req, kontekst);
  if (!dane || !csrfPoprawny(kontekst, dane.get('csrf'))) return odmowaCsrf(res, kontekst);
  // Zmiana adresu czeka na potwierdzenie obecnego (ARCH8-06); konto bez adresu moze go dodac.
  if (konto.email && !konto.emailPotwierdzony) {
    return ekranKonta(res, kontekst, 403, { komunikat: { kod: 'email-niepotwierdzony' } });
  }
  const limit = HASLO_KONTA.sprawdz({ login: konto.login });
  if (!limit.wolno) return zaDuzoProbKonta(res, kontekst, limit.ponowZa);
  const wpisany = String(dane.get('nowy') || '').trim().slice(0, ZASADY.emailMax);
  const pasuje = await hasloKontaPasuje(kontekst, dane.get('haslo'));
  if (pasuje === 'zajety') return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'zajety' }));
  if (!pasuje) return ekranKonta(res, kontekst, 400, { bledy: { hasloEmail: 'haslo-zle' }, wpisanyEmail: wpisany, komunikat: { kod: 'popraw-pola' } });
  const adres = magazyn.normalizujEmail(wpisany);
  let blad = null;
  if (!adres || !poprawnyEmail(adres)) blad = 'email-zly';
  else if (adres === konto.email) blad = 'email-taki-sam';
  else {
    const zajety = magazyn.kontoPoEmailu(adres);
    if (zajety && zajety.login !== konto.login) blad = 'email-zajety';
  }
  if (blad) return ekranKonta(res, kontekst, 400, { bledy: { nowy: blad }, wpisanyEmail: wpisany, komunikat: { kod: 'popraw-pola' } });
  magazyn.zmienKonto(konto.login, { emailNowy: adres });
  const token = magazyn.zapiszToken({ login: konto.login, rodzaj: 'zmiana-email', email: adres, wazneMs: ZASADY.zmianaEmailMs });
  const jezyk = jezykKonta(konto, kontekst.jezyk);
  const ok = await wyslijPoczte(kontekst, {
    do: adres, szablon: 'zmiana-email', jezyk,
    dane: { odnosnik: odnosnik(KONF, '/potwierdz', token, jezyk), email: konto.email || null, nowyEmail: adres, godzin: ZASADY.zmianaEmailMs / GODZINA },
  });
  // Informacja na dotychczasowy adres (zmiane mogl zlecic ktos z cudzym dostepem do sesji).
  powiadom(kontekst, konto, 'zmiana-email-info', { nowyEmail: adres });
  console.log(`[konta] zmiana adresu zlecona: ${konto.login} -> ${kontekst.poczta.maskujAdres(adres)}`);
  return przekieruj(res, `/konto?${ok ? 'ok=email' : 'blad=wysylka'}&lang=${kontekst.jezyk}`);
}

async function wylogujWszedzie(req, res, kontekst) {
  const konto = kontekst.konto;
  if (kontekst.KONF.zaufanyNaglowek) return wyslijHtml(res, kontekst, 404, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'niedostepne' }));
  const dane = await formularz(req, kontekst);
  if (!dane || !csrfPoprawny(kontekst, dane.get('csrf'))) return odmowaCsrf(res, kontekst);
  kontekst.magazyn.zmienKonto(konto.login, { sesjeOd: Date.now() });
  const sesja = kontekst.sesja;
  if (sesja && sesja.id) {
    try { kontekst.zapiszWylogowanie(sesja.id, sesja.wygasa); } catch (e) { console.error('[konta] zapis wylogowania:', e.message); }
  }
  console.log(`[konta] wyloguj wszedzie: ${konto.login}`);
  return przekieruj(res, '/', { 'Set-Cookie': [kontekst.ciasteczkoWylogowania(), ...ciasteczkaKluczy(kontekst)] });
}

async function ponowienieFormularzem(req, res, kontekst) {
  const dane = await formularz(req, kontekst);
  if (!dane || !csrfPoprawny(kontekst, dane.get('csrf'))) return odmowaCsrf(res, kontekst);
  const w = await ponowPotwierdzenie(kontekst);
  const lang = `&lang=${kontekst.jezyk}`;
  if (w.stan === 'wyslano') return przekieruj(res, `/konto?ok=potwierdzenie${lang}`);
  if (w.stan === 'limit') return przekieruj(res, `/konto?blad=ponow&za=${w.ponowZa}${lang}`);
  if (w.stan === 'blad') return przekieruj(res, `/konto?blad=wysylka${lang}`);
  return przekieruj(res, `/konto?lang=${kontekst.jezyk}`);
}

function eksport(res, kontekst) {
  const dane = eksportDanych(kontekst);
  res.setHeader('Content-Disposition', `attachment; filename="content-ai-dane-${dzis()}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  kontekst.wyslij(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, Buffer.from(JSON.stringify(dane, null, 2), 'utf8'));
  return true;
}

function daneUsuniecia(kontekst, o = {}) {
  const konto = kontekst.konto;
  return {
    email: konto.email, naglowek: konto.login, mozna: mozliwoscUsuniecia(konto, kontekst),
    subskrypcja: subskrypcjaZywa(konto), csrf: tokenCsrf(kontekst), stopka: stopkaKonta(konto, kontekst.jezyk), ...o,
  };
}

async function usuniecieKonta(req, res, kontekst) {
  const konto = kontekst.konto;
  const jezyk = kontekst.jezyk;
  const ekran = (status, o) => wyslijHtml(res, kontekst, status, ekrany.ekranUsuniecia({ jezyk, dane: daneUsuniecia(kontekst, o) }));
  if (req.method === 'GET' || req.method === 'HEAD') return ekran(200);
  if (req.method !== 'POST') return metodaNiedozwolona(res, kontekst, 'GET, HEAD, POST');
  const dane = await formularz(req, kontekst);
  if (!dane || !csrfPoprawny(kontekst, dane.get('csrf'))) return odmowaCsrf(res, kontekst);
  // Konta zespolu usuwa administrator (CAI_USUWANIE_STARYCH=0, M-7), operatora nikt z ekranu.
  if (mozliwoscUsuniecia(konto, kontekst) !== 'tak') return ekran(403);
  const limit = HASLO_KONTA.sprawdz({ login: konto.login });
  if (!limit.wolno) return zaDuzoProbKonta(res, kontekst, limit.ponowZa);
  const rozumiem = dane.get('rozumiem') === '1';
  const haslo = String(dane.get('haslo') || '');
  const bledy = {};
  if (!haslo) bledy.haslo = 'haslo-puste';
  else {
    const pasuje = await hasloKontaPasuje(kontekst, haslo);
    if (pasuje === 'zajety') return wyslijHtml(res, kontekst, 429, ekrany.ekranKomunikatu({ jezyk, kod: 'zajety' }));
    if (!pasuje) bledy.haslo = 'haslo-zle';
  }
  if (!rozumiem) bledy.rozumiem = 'rozumiem';
  if (Object.keys(bledy).length) return ekran(400, { bledy, rozumiem, komunikat: { kod: 'popraw-pola' } });

  // (1) Subskrypcja u dostawcy platnosci: anulowanie od razu. Blad = konto zostaje
  // (klient placilby dalej za usuniete konto), komunikat "sprobuj za chwile".
  const zywa = subskrypcjaZywa(konto);
  try {
    const w = await kontekst.platnosci.anulujDlaKonta(konto, kontekst);
    if (w && w.ok === false) throw new Error(w.blad || 'dostawca odrzucil anulowanie');
  } catch (e) {
    console.error(`[konta] usuniecie ${konto.login}: anulowanie subskrypcji nie powiodlo sie: ${e.message}`);
    return wyslijHtml(res, kontekst, 503, ekrany.ekranKomunikatu({ jezyk, kod: 'anulowanie-blad', odnosnik: { href: '/konto', tekst: ekrany.teksty(jezyk).wrocDoKonta } }), { 'Retry-After': '60' });
  }
  // (2) Konto, organizacja i pliki; (3) e-mail; (4) odpowiedz czyszczaca przegladarke.
  const wynik = usunKontoZDanymi(kontekst, konto, { powod: 'uzytkownik' });
  console.log(`[konta] konto usuniete przez uzytkownika: ${konto.login}${wynik.zOrganizacja ? ` (z organizacja ${konto.organizacja})` : ''}, plikow: ${wynik.pliki.length}`);
  powiadom(kontekst, konto, 'konto-usuniete', {});
  // 200 zamiast przekierowania: Clear-Site-Data na pewno zadziala (czysci klucze i historie w tej przegladarce).
  return wyslijHtml(res, kontekst, 200, ekrany.ekranPozegnania({ jezyk, email: konto.email || '', subskrypcja: zywa, stopka: stopkaKonta(konto, jezyk) }), {
    'Clear-Site-Data': '"cache", "cookies", "storage"',
    'Set-Cookie': [kontekst.ciasteczkoWylogowania(), ...ciasteczkaKluczy(kontekst)],
  });
}

async function zgodyEkran(req, res, kontekst) {
  const { KONF, magazyn } = kontekst;
  const konto = kontekst.konto;
  const jezyk = kontekst.jezyk;
  const adres = dokumentyPrawne.adres('regulamin', jezyk);
  const ekran = (status, o) => wyslijHtml(res, kontekst, status, ekrany.ekranZgody({
    jezyk, wersja: KONF.regulaminWersja, adres, csrf: tokenCsrf(kontekst), stopka: stopkaKonta(konto, jezyk), ...o,
  }));
  if (req.method === 'GET' || req.method === 'HEAD') {
    const wymaga = wymagaAkceptacji(konto, KONF);
    return ekran(200, { aktualne: !wymaga, wersja: wymaga ? KONF.regulaminWersja : (konto.regulaminWersja || KONF.regulaminWersja || '') });
  }
  if (req.method !== 'POST') return metodaNiedozwolona(res, kontekst, 'GET, HEAD, POST');
  const dane = await formularz(req, kontekst);
  if (!dane || !csrfPoprawny(kontekst, dane.get('csrf'))) return odmowaCsrf(res, kontekst);
  if (!KONF.regulaminWersja) return ekran(200, { aktualne: true, wersja: konto.regulaminWersja || '' });
  // Akceptacja dotyczy wersji, ktora uzytkownik widzial; zmiana konfiguracji w miedzyczasie = formularz od nowa.
  if (dane.get('akceptuje') !== '1' || dane.get('regulamin') !== KONF.regulaminWersja) return ekran(400, { blad: true });
  const teraz = Date.now();
  magazyn.transakcja(() => {
    magazyn.dopiszZgode({ login: konto.login, rodzaj: 'regulamin', wersja: KONF.regulaminWersja, wartosc: true, zrodlo: 'konto', ip: KONF.zgodyIp ? kontekst.adresIp(req) : null, teraz });
    magazyn.zmienKonto(konto.login, { regulaminWersja: KONF.regulaminWersja, regulaminCzas: teraz });
  });
  return przekieruj(res, `/konto?ok=zgoda&lang=${jezyk}`);
}

/** Cialo JSON tras /api/konto/*: obiekt albo odpowiedz z bledem (null). */
async function cialoObiekt(req, res, kontekst) {
  let dane;
  try {
    dane = await kontekst.cialoJson(req, 16 * 1024);
  } catch (e) {
    kontekst.odpowiedzJson(res, e.status || 400, { error: e.message });
    return null;
  }
  if (!dane || typeof dane !== 'object' || Array.isArray(dane)) {
    kontekst.odpowiedzJson(res, 400, { error: 'Oczekiwany obiekt JSON' });
    return null;
  }
  return dane;
}

async function apiZgody(req, res, kontekst) {
  const { KONF, magazyn } = kontekst;
  const konto = kontekst.konto;
  const dane = await cialoObiekt(req, res, kontekst);
  if (!dane) return true;
  const nieznane = Object.keys(dane).find((k) => !['regulamin', 'polityka', 'marketing'].includes(k));
  if (nieznane) return kontekst.odpowiedzJson(res, 400, { error: 'Nieznane pole', pole: nieznane }) || true;
  if ('regulamin' in dane && (!KONF.regulaminWersja || dane.regulamin !== KONF.regulaminWersja)) {
    return kontekst.odpowiedzJson(res, 400, { error: 'Nieaktualna wersja regulaminu', pole: 'regulamin', aktualna: KONF.regulaminWersja || null }) || true;
  }
  if ('polityka' in dane && (!KONF.politykaWersja || dane.polityka !== KONF.politykaWersja)) {
    return kontekst.odpowiedzJson(res, 400, { error: 'Nieaktualna wersja polityki prywatnosci', pole: 'polityka', aktualna: KONF.politykaWersja || null }) || true;
  }
  if ('marketing' in dane && typeof dane.marketing !== 'boolean') {
    return kontekst.odpowiedzJson(res, 400, { error: 'marketing: oczekiwana wartosc logiczna', pole: 'marketing' }) || true;
  }
  const teraz = Date.now();
  const ip = KONF.zgodyIp ? kontekst.adresIp(req) : null;
  magazyn.transakcja(() => {
    const zgoda = (rodzaj, wersja, wartosc) => magazyn.dopiszZgode({ login: konto.login, rodzaj, wersja, wartosc, zrodlo: 'aplikacja', ip, teraz });
    if ('regulamin' in dane) {
      zgoda('regulamin', KONF.regulaminWersja, true);
      magazyn.zmienKonto(konto.login, { regulaminWersja: KONF.regulaminWersja, regulaminCzas: teraz });
    }
    if ('polityka' in dane) zgoda('polityka', KONF.politykaWersja, true);
    if ('marketing' in dane) {
      zgoda('marketing', null, dane.marketing);
      magazyn.zmienKonto(konto.login, { marketing: dane.marketing });
    }
  });
  const swieze = magazyn.kontoZOrganizacja(konto.login);
  return kontekst.odpowiedzJson(res, 200, { ok: true, zgody: stanZgod(swieze, KONF, magazyn) }) || true;
}

async function apiUstawienia(req, res, kontekst) {
  const { KONF, magazyn, oznaczenia } = kontekst;
  const konto = kontekst.konto;
  const dane = await cialoObiekt(req, res, kontekst);
  if (!dane) return true;
  const nieznane = Object.keys(dane).find((k) => !['oznaczenia', 'jezyk'].includes(k));
  if (nieznane) return kontekst.odpowiedzJson(res, 400, { error: 'Nieznane pole', pole: nieznane }) || true;
  const zmiany = {};
  if ('oznaczenia' in dane) {
    const w = oznaczenia.sprawdzUstawienia(dane.oznaczenia);
    if (!w.ok) return kontekst.odpowiedzJson(res, 400, { error: 'Niepoprawne ustawienia oznaczen', pole: `oznaczenia.${w.pole}` }) || true;
    zmiany.oznaczenia = { ...(konto.oznaczenia && typeof konto.oznaczenia === 'object' ? konto.oznaczenia : {}), ...w.oznaczenia };
  }
  if ('jezyk' in dane) {
    if (dane.jezyk !== 'pl' && dane.jezyk !== 'en') return kontekst.odpowiedzJson(res, 400, { error: 'jezyk: pl albo en', pole: 'jezyk' }) || true;
    zmiany.jezyk = dane.jezyk;
  }
  if (Object.keys(zmiany).length) magazyn.zmienKonto(konto.login, zmiany);
  const swieze = magazyn.kontoZOrganizacja(konto.login);
  return kontekst.odpowiedzJson(res, 200, { ok: true, oznaczenia: oznaczenia.dlaKonta(swieze, KONF), jezyk: swieze.jezyk }) || true;
}

async function apiPotwierdzenie(req, res, kontekst) {
  req.resume();
  const w = await ponowPotwierdzenie(kontekst);
  if (w.stan === 'limit') {
    res.setHeader('Retry-After', String(w.ponowZa || 60));
    kontekst.bladCai(res, 'za-duzo-prob', 429, { ponowZa: w.ponowZa });
    return true;
  }
  return kontekst.odpowiedzJson(res, 200, { ok: w.stan === 'wyslano' || w.stan === 'potwierdzony', stan: w.stan }) || true;
}

/**
 * Z sesja: GET /konto, POST /konto/potwierdzenie, POST /konto/email, POST /konto/haslo,
 * POST /konto/wyloguj-wszedzie, GET /konto/eksport, GET|POST /konto/usun, GET|POST /konto/zgody,
 * GET /api/konto (stan 4.4), POST /api/konto/zgody, POST /api/konto/ustawienia,
 * POST /api/konto/potwierdzenie; do tego bramki dla tras dalej w routerze.
 */
async function obsluz(sciezka, req, res, kontekst) {
  if (!kontekst.konto) return false;
  if (bramki(sciezka, req, res, kontekst)) return true;
  const strona = sciezka === '/konto' || sciezka.startsWith('/konto/');
  const api = trasaKonta(sciezka);
  if (!strona && !api) return false;
  const m = req.method;
  const odczyt = m === 'GET' || m === 'HEAD';
  const tylko = (warunek, dozwolone) => (warunek ? null : metodaNiedozwolona(res, kontekst, dozwolone, api));
  switch (sciezka) {
    case '/konto':
      return tylko(odczyt, 'GET, HEAD') || ekranKonta(res, kontekst, 200, { komunikat: komunikatZAdresu(kontekst.url) });
    case '/konto/potwierdzenie':
      return tylko(m === 'POST', 'POST') || ponowienieFormularzem(req, res, kontekst);
    case '/konto/email':
      return tylko(m === 'POST', 'POST') || zmianaEmaila(req, res, kontekst);
    case '/konto/haslo':
      return tylko(m === 'POST', 'POST') || zmianaHasla(req, res, kontekst);
    case '/konto/wyloguj-wszedzie':
      return tylko(m === 'POST', 'POST') || wylogujWszedzie(req, res, kontekst);
    case '/konto/eksport':
      return tylko(odczyt, 'GET, HEAD') || eksport(res, kontekst);
    case '/konto/usun':
      return usuniecieKonta(req, res, kontekst);
    case '/konto/zgody':
      return zgodyEkran(req, res, kontekst);
    case '/api/konto':
      return tylko(odczyt, 'GET, HEAD') || kontekst.odpowiedzJson(res, 200, stanKonta(kontekst)) || true;
    case '/api/konto/zgody':
      return tylko(m === 'POST', 'POST') || apiZgody(req, res, kontekst);
    case '/api/konto/ustawienia':
      return tylko(m === 'POST', 'POST') || apiUstawienia(req, res, kontekst);
    case '/api/konto/potwierdzenie':
      return tylko(m === 'POST', 'POST') || apiPotwierdzenie(req, res, kontekst);
    default:
      if (api) return kontekst.odpowiedzJson(res, 404, { error: 'Nieznany endpoint konta' }) || true;
      return wyslijHtml(res, kontekst, 404, ekrany.ekranKomunikatu({ jezyk: kontekst.jezyk, kod: 'nie-znaleziono', odnosnik: { href: '/konto', tekst: ekrany.teksty(kontekst.jezyk).wrocDoKonta } }));
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

let zegarSprzatania = null;

/**
 * Wolane raz przy starcie serwera (po migracji, przed listen) z { KONF, magazyn, ... }:
 * ostrzezenia konfiguracji kont i zegar dobowy usuwania kont niepotwierdzonych.
 */
function inicjuj(srodowisko) {
  const { KONF } = srodowisko;
  if (KONF.turnstile && Boolean(KONF.turnstile.klucz) !== Boolean(KONF.turnstile.sekret)) {
    console.warn('[konta] Turnstile WYLACZONY: ustaw oba CAI_TURNSTILE_KLUCZ i CAI_TURNSTILE_SEKRET');
  }
  if (srodowisko.funkcjaWlaczona('rejestracja')) {
    for (const r of dokumentyPrawne.rozjazdyWersji(KONF)) console.warn(`[konta] zgody przy rejestracji zapisza wersje z konfiguracji, a dokument ma inna: ${r}`);
  }
  const sprzataj = () => {
    try {
      const w = sprzatajNiepotwierdzone(srodowisko);
      if (w.usunieto) console.log(`[konta] sprzatanie: usuniete konta niepotwierdzone (${KONF.niepotwierdzoneDni} dni bez potwierdzenia i logowania): ${w.usunieto}`);
    } catch (e) {
      console.error('[konta] sprzatanie kont niepotwierdzonych:', e.message);
    }
  };
  if (zegarSprzatania) clearInterval(zegarSprzatania);
  setTimeout(sprzataj, ZASADY.sprzataniePierwszeMs).unref();
  zegarSprzatania = setInterval(sprzataj, ZASADY.sprzatanieCoMs);
  zegarSprzatania.unref();
}

module.exports = {
  SCIEZKI_PUBLICZNE, obsluzPubliczne, obsluz, inicjuj,
  // dla server.js (sekcja Logowanie) i modulow C/B
  probyLogowania, emailDoPola, wymagaPotwierdzenia, pocztaKontDostepna,
  // do testow i CLI
  ZASADY, ocenHaslo, poprawnyEmail, znacznikFormularza, ocenZnacznik, usunKontoZDanymi, sprzatajNiepotwierdzone,
  eksportDanych, stanZgod, czekajNaTlo,
};
