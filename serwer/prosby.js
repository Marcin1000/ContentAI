'use strict';

// ─── Prosby o dostep ze strony produktowej ───────────────────────────────────
//
// Formularz "Popros o dostep" na content-ai.net wysyla tu imie, e-mail,
// firme, pakiet i wiadomosc. To jedyny endpoint bez logowania i jedyny
// wolany z innego pochodzenia, wiec:
//   - CORS wpuszcza wylacznie Origin z CAI_STRONA_ORIGIN (bez ciasteczek),
//   - kazde pole ma twarda granice dlugosci i formatu (kontrakt formularza
//     showcase/zasoby/strona.js: imie <= 100, email <= 200, firma <= 200,
//     wiadomosc <= 2000; pole zgody wymusza przegladarka i go nie wysyla),
//   - pole-pulapka `strona` (ukryte, wypelniaja je tylko boty) daje udawane
//     200 bez zapisu - bot nie dowie sie, ze go odsialismy,
//   - limit: 5 prosb na godzine z jednego adresu i 200 na dobe lacznie,
//   - zapis to jedna linia JSON na prosbe (JSON Lines) w CAI_PROSBY.
// Prosby czyta administrator: GET /api/admin/prosby albo
// `node serwer/uzytkownicy.js prosby`.

const path = require('node:path');
const pliki = require('./pliki.js');

const PLIK = process.env.CAI_PROSBY || path.join(__dirname, 'dane', 'prosby.jsonl');

const NA_GODZINE_Z_ADRESU = 5;
const NA_DOBE = 200;
const GODZINA = 3600_000;
const DOBA = 24 * GODZINA;
const LIMIT_CIALA = 16 * 1024;

// "nie-wiem" to domyslna opcja listy na stronie produktowej - bez niej
// formularz wyslany bez wyboru pakietu konczylby sie bledem.
const PAKIETY = new Set(['darmowy', 'standard', 'premium', 'nie-wiem']);
const JEZYKI = new Set(['pl', 'en']);
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const KOMUNIKATY = {
  pl: {
    'brak-imienia': 'Wpisz imię.',
    'zly-email': 'Wpisz poprawny adres e-mail, np. anna@firma.pl.',
    'za-dlugie': 'Ten tekst jest za długi.',
    'zly-pakiet': 'Wybierz pakiet z listy.',
    'zly-jezyk': 'Nieznany język formularza.',
    'zle-dane': 'Niepoprawne dane formularza.',
    limit: 'Za dużo prób. Spróbuj ponownie później.',
  },
  en: {
    'brak-imienia': 'Enter your first name.',
    'zly-email': 'Enter a valid email address, e.g. anna@company.com.',
    'za-dlugie': 'This text is too long.',
    'zly-pakiet': 'Choose a plan from the list.',
    'zly-jezyk': 'Unknown form language.',
    'zle-dane': 'Invalid form data.',
    limit: 'Too many attempts. Please try again later.',
  },
};

// Liczniki w pamieci procesu, jak licznik prob logowania: restart je zeruje,
// co przy tej skali wystarcza.
const zAdresu = new Map();   // ip -> [czasy]
let dobowe = [];             // czasy wszystkich przyjetych prosb

function tekst(w) {
  return typeof w === 'string' ? w.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
}

/**
 * Sprawdza dane formularza. Zwraca { prosba } albo { kod, blad: pole (gdy dotyczy pola) }.
 * Kolejnosc sprawdzania = kolejnosc pol w formularzu, zeby pierwszy
 * zgloszony blad byl tym, ktory uzytkownik widzi najwyzej.
 */
function sprawdz(dane) {
  if (!dane || typeof dane !== 'object' || Array.isArray(dane)) return { kod: 'zle-dane' };
  const jezyk = dane.jezyk === undefined || dane.jezyk === '' ? 'pl' : tekst(dane.jezyk).toLowerCase();
  if (!JEZYKI.has(jezyk)) return { kod: 'zly-jezyk', jezyk: 'pl' };

  const imie = tekst(dane.imie);
  if (!imie) return { blad: 'imie', kod: 'brak-imienia', jezyk };
  if (imie.length > 100) return { blad: 'imie', kod: 'za-dlugie', jezyk };

  const email = tekst(dane.email);
  if (email.length > 200) return { blad: 'email', kod: 'za-dlugie', jezyk };
  if (!EMAIL.test(email)) return { blad: 'email', kod: 'zly-email', jezyk };

  const firma = tekst(dane.firma);
  if (firma.length > 200) return { blad: 'firma', kod: 'za-dlugie', jezyk };

  const pakiet = dane.pakiet === undefined || dane.pakiet === '' ? 'nie-wiem' : tekst(dane.pakiet).toLowerCase();
  if (!PAKIETY.has(pakiet)) return { blad: 'pakiet', kod: 'zly-pakiet', jezyk };

  const wiadomosc = typeof dane.wiadomosc === 'string' ? dane.wiadomosc.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
  if (wiadomosc.length > 2000) return { blad: 'wiadomosc', kod: 'za-dlugie', jezyk };

  return { prosba: { imie, email, firma, pakiet, wiadomosc, jezyk } };
}

/** Czy wolno przyjac kolejna prosbe z tego adresu; jesli tak - zapisuje ja w licznikach. */
function wolno(ip, teraz = Date.now()) {
  dobowe = dobowe.filter((t) => teraz - t < DOBA);
  const lista = (zAdresu.get(ip) || []).filter((t) => teraz - t < GODZINA);
  if (lista.length >= NA_GODZINE_Z_ADRESU || dobowe.length >= NA_DOBE) {
    zAdresu.set(ip, lista);
    return false;
  }
  lista.push(teraz);
  zAdresu.set(ip, lista);
  dobowe.push(teraz);
  // Sprzatanie adresow bez wpisow z ostatniej godziny - mapa nie rosnie bez konca.
  if (zAdresu.size > 5000) {
    for (const [k, v] of zAdresu) if (!v.some((t) => teraz - t < GODZINA)) zAdresu.delete(k);
  }
  return true;
}

function zapisz(prosba, plik = PLIK) {
  pliki.dopiszLinie(plik, prosba);
}

/** Ostatnie prosby, najnowsze pierwsze. */
function lista(ile = 200, plik = PLIK) {
  const { wpisy, pominiete } = pliki.czytajLinie(plik);
  return { wpisy: wpisy.slice(-ile).reverse(), pominiete };
}

function naglowkiCors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/**
 * Obsluga trasy /api/prosba-o-dostep. Zaleznosci z server.js (adres IP,
 * czytanie ciala, odpowiedz JSON) przychodza z zewnatrz - bez petli w require.
 */
async function obsluz(req, res, z) {
  const origin = req.headers.origin;
  // Bez Origin przychodzi tylko klient spoza przegladarki (curl) - wpuszczamy,
  // bo limit i tak go obowiazuje. Obcy Origin odrzucamy bez CORS, wiec
  // przegladarka nie pokaze odpowiedzi skryptowi z tamtej strony.
  if (origin && !z.dozwoloneOrigin.includes(origin)) {
    return z.odpowiedzJson(res, 403, { ok: false, blad: 'origin', komunikat: 'Niedozwolone pochodzenie zadania.' });
  }
  // Ten sam Allow-Origin przy kazdej odpowiedzi (takze 400 i 429) - inaczej
  // przegladarka schowa przed formularzem tresc bledu.
  if (origin) for (const [k, v] of Object.entries(naglowkiCors(origin))) res.setHeader(k, v);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Content-Length': 0 });
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return z.odpowiedzJson(res, 405, { ok: false, blad: 'metoda', komunikat: 'Dozwolona jest tylko metoda POST.' });
  }
  if (!z.typJson(req)) {
    return z.odpowiedzJson(res, 415, { ok: false, blad: 'typ', komunikat: 'Wymagany Content-Type: application/json.' });
  }

  let dane;
  try {
    dane = JSON.parse((await z.czytajCialo(req, LIMIT_CIALA)).toString('utf8'));
  } catch {
    return z.odpowiedzJson(res, 400, { ok: false, blad: 'zle-dane', komunikat: KOMUNIKATY.pl['zle-dane'] });
  }

  // Pulapka: pole ukryte przed ludzmi. Wypelnione = bot. Udajemy sukces.
  if (dane && typeof dane === 'object' && typeof dane.strona === 'string' && dane.strona.trim()) {
    console.log('[prosby] pole-pulapka wypelnione - odrzucone bez zapisu');
    return z.odpowiedzJson(res, 200, { ok: true });
  }

  // 400: blad = kod, ktory strona zamienia na wlasny komunikat; pole = ktore
  // pole podswietlic (tylko pola formularza); komunikat = tekst w jezyku formularza.
  const wynik = sprawdz(dane);
  if (wynik.kod) {
    const odp = { ok: false, blad: wynik.kod };
    if (wynik.blad) odp.pole = wynik.blad;
    odp.komunikat = KOMUNIKATY[wynik.jezyk || 'pl'][wynik.kod];
    return z.odpowiedzJson(res, 400, odp);
  }

  const ip = z.adresIp(req);
  if (!wolno(ip)) return z.odpowiedzJson(res, 429, { ok: false, blad: 'limit' });

  zapisz({
    czas: new Date().toISOString(),
    ip,
    ...wynik.prosba,
    // Pola zgody strona nie wysyla - przegladarka nie pusci formularza bez
    // zaznaczenia. Samo wyslanie jest wiec faktem udzielenia zgody.
    zgoda: true,
    zrodlo: origin || null,
  });
  console.log(`[prosby] nowa prosba o dostep (${wynik.prosba.pakiet}, ${wynik.prosba.jezyk})`);
  return z.odpowiedzJson(res, 200, { ok: true });
}

/** Do testow: wyzerowanie licznikow. */
function wyzerujLimity() {
  zAdresu.clear();
  dobowe = [];
}

module.exports = {
  obsluz, sprawdz, wolno, zapisz, lista, wyzerujLimity, PLIK, PAKIETY,
  NA_GODZINE_Z_ADRESU, NA_DOBE,
};
