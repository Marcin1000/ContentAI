'use strict';

// ─── Prosby o dostep ze strony produktowej ───────────────────────────────────
//
// Formularz "Popros o dostep" na content-ai.net wysyla tu imie, e-mail,
// firme, pakiet i wiadomosc. To jedyny endpoint bez logowania i jedyny
// wolany z innego pochodzenia, wiec:
//   - CORS wpuszcza wylacznie Origin z CAI_STRONA_ORIGIN (bez ciasteczek),
//   - kazde pole ma twarda granice dlugosci i formatu (kontrakt formularza
//     showcase/zasoby/strona.js: imie <= 100, email <= 200, firma <= 200,
//     wiadomosc <= 2000; zgoda opcjonalna - zapisujemy, czy przyszla),
//   - pole-pulapka `strona` (ukryte, wypelniaja je tylko boty) daje udawane
//     200 bez zapisu - bot nie dowie sie, ze go odsialismy,
//   - limity: 5 prosb na godzine z jednego adresu, 20 na dobe z jednej sieci
//     (/24 IPv4, /48 IPv6), 200 na dobe lacznie "miekko" (dalej przyjmujemy
//     z flaga ponadLimit i ostrzezeniem w logu, zeby ktos z wieloma adresami
//     nie zatkal formularza wszystkim) i 2000 na dobe twardo,
//   - zapis to jedna linia JSON na prosbe (JSON Lines) w CAI_PROSBY,
//   - okres przechowywania: CAI_PROSBY_DNI (domyslnie 365); starsze wpisy
//     wypadaja przy starcie serwera i przy zapisie (najwyzej raz na dobe),
//   - adres IP z adresIp() serwera (X-Real-IP tylko od Caddy), nie z X-Forwarded-For.
// Prosby czyta administrator: GET /api/admin/prosby albo
// `node serwer/uzytkownicy.js prosby`.

const path = require('node:path');
const pliki = require('./pliki.js');

const PLIK = process.env.CAI_PROSBY || path.join(__dirname, 'dane', 'prosby.jsonl');

const NA_GODZINE_Z_ADRESU = 5;
const NA_DOBE_Z_SIECI = 20;
const NA_DOBE = 200;          // miekki: ponad nim przyjmujemy z flaga ponadLimit
const NA_DOBE_TWARDO = 2000;  // twardy: ponad nim 429
const DNI = Math.max(1, Number(process.env.CAI_PROSBY_DNI) || 365);
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
    'za-duze': 'Formularz jest za duży. Skróć wiadomość.',
    limit: 'Za dużo prób. Spróbuj ponownie później.',
  },
  en: {
    'brak-imienia': 'Enter your first name.',
    'zly-email': 'Enter a valid email address, e.g. anna@company.com.',
    'za-dlugie': 'This text is too long.',
    'zly-pakiet': 'Choose a plan from the list.',
    'zly-jezyk': 'Unknown form language.',
    'zle-dane': 'Invalid form data.',
    'za-duze': 'The form is too large. Please shorten your message.',
    limit: 'Too many attempts. Please try again later.',
  },
};

// Liczniki w pamieci procesu, jak licznik prob logowania: restart je zeruje,
// co przy tej skali wystarcza.
const zAdresu = new Map();   // ip -> [czasy]
const zSieci = new Map();    // siec (/24 albo /48) -> [czasy]
let dobowe = [];             // czasy wszystkich przyjetych prosb
let ostatnieSprzatanie = 0;

/** Siec adresu: /24 dla IPv4 (takze zapisanego jako ::ffff:a.b.c.d), /48 dla IPv6. */
function siecAdresu(ip) {
  const a = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(a);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (a.includes(':')) {
    // Rozwiniecie '::' do pelnych 8 grup, potem pierwsze trzy (48 bitow).
    const [przod, tyl = ''] = a.split('::');
    const p = przod ? przod.split(':') : [];
    const t = tyl ? tyl.split(':') : [];
    const grupy = a.includes('::') ? [...p, ...Array(Math.max(0, 8 - p.length - t.length)).fill('0'), ...t] : p;
    return grupy.slice(0, 3).map((g) => g || '0').join(':') + '::/48';
  }
  return a || 'nieznany';
}

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

/**
 * Decyzja limitu dla adresu. Zwraca { wolno, ponadLimit, powod }. Gdy wolno -
 * od razu wpisuje prosbe do licznikow.
 */
function ocenLimit(ip, teraz = Date.now()) {
  dobowe = dobowe.filter((t) => teraz - t < DOBA);
  const siec = siecAdresu(ip);
  const lista = (zAdresu.get(ip) || []).filter((t) => teraz - t < GODZINA);
  const listaSieci = (zSieci.get(siec) || []).filter((t) => teraz - t < DOBA);
  zAdresu.set(ip, lista);
  zSieci.set(siec, listaSieci);
  if (lista.length >= NA_GODZINE_Z_ADRESU) return { wolno: false, powod: 'adres' };
  if (listaSieci.length >= NA_DOBE_Z_SIECI) return { wolno: false, powod: 'siec' };
  if (dobowe.length >= NA_DOBE_TWARDO) return { wolno: false, powod: 'dobowy' };
  const ponadLimit = dobowe.length >= NA_DOBE;
  lista.push(teraz);
  listaSieci.push(teraz);
  dobowe.push(teraz);
  // Sprzatanie wpisow bez ruchu - mapy nie rosna bez konca.
  if (zAdresu.size > 5000) {
    for (const [k, v] of zAdresu) if (!v.some((t) => teraz - t < GODZINA)) zAdresu.delete(k);
  }
  if (zSieci.size > 5000) {
    for (const [k, v] of zSieci) if (!v.some((t) => teraz - t < DOBA)) zSieci.delete(k);
  }
  return { wolno: true, ponadLimit };
}

/** Zgodna wstecz: czy wolno przyjac kolejna prosbe z tego adresu. */
function wolno(ip, teraz = Date.now()) {
  return ocenLimit(ip, teraz).wolno;
}

function zapisz(prosba, plik = PLIK) {
  pliki.dopiszLinie(plik, prosba);
  if (Date.now() - ostatnieSprzatanie > DOBA) {
    try { sprzataj(plik); } catch (e) { console.error('[prosby] sprzatanie:', e.message); }
  }
}

/**
 * Usuwa prosby starsze niz CAI_PROSBY_DNI dni (dane osobowe nie leza w nieskonczonosc).
 * Linii, ktorych nie da sie odczytac, nie wyrzucamy - mogly byc czyjas prosba.
 * Plik przepisujemy atomowo i tylko wtedy, gdy cos wypadlo. Zwraca liczbe usunietych.
 */
function sprzataj(plik = PLIK, teraz = Date.now(), dni = DNI) {
  ostatnieSprzatanie = teraz;
  const fs = require('node:fs');
  let surowe;
  try {
    surowe = fs.readFileSync(plik, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  const granica = teraz - dni * DOBA;
  const zostaja = [];
  let usuniete = 0;
  for (const linia of surowe.split('\n')) {
    if (!linia.trim()) continue;
    let wpis = null;
    try { wpis = JSON.parse(linia); } catch { /* zostaje jak jest */ }
    const czas = wpis ? Date.parse(wpis.czas) : NaN;
    if (wpis && Number.isFinite(czas) && czas < granica) { usuniete += 1; continue; }
    zostaja.push(linia);
  }
  if (usuniete) {
    pliki.zapiszAtomowo(plik, zostaja.length ? zostaja.join('\n') + '\n' : '');
    console.log(`[prosby] usunieto ${usuniete} prosb starszych niz ${dni} dni`);
  }
  return usuniete;
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

  let surowe;
  try {
    surowe = await z.czytajCialo(req, LIMIT_CIALA);
  } catch (e) {
    // Za duze cialo: 413 z JSON-em i CORS (ustawionym wyzej), a nie zerwane
    // polaczenie - formularz pokaze komunikat zamiast "bledu sieci".
    res.setHeader('Connection', 'close');
    return z.odpowiedzJson(res, 413, { ok: false, blad: 'za-duze', komunikat: KOMUNIKATY.pl['za-duze'] });
  }
  let dane;
  try {
    dane = JSON.parse(surowe.toString('utf8'));
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

  // Adres z adresIp() serwera: X-Real-IP tylko od Caddy z petli zwrotnej.
  const ip = z.adresIp(req);
  const limit = ocenLimit(ip);
  if (!limit.wolno) return z.odpowiedzJson(res, 429, { ok: false, blad: 'limit' });
  if (limit.ponadLimit) {
    console.warn(`[prosby] ponad ${NA_DOBE} prosb w ciagu doby - przyjeta z flaga ponadLimit (siec ${siecAdresu(ip)})`);
  }

  zapisz({
    czas: new Date().toISOString(),
    ip,
    ...wynik.prosba,
    // Zapisujemy tylko to, co przyszlo: zgoda: true wylacznie wtedy, gdy
    // formularz ja wyslal. Brak pola (stara strona, curl, bot) = false.
    zgoda: dane.zgoda === true,
    ...(limit.ponadLimit ? { ponadLimit: true } : {}),
    zrodlo: origin || null,
  });
  console.log(`[prosby] nowa prosba o dostep (${wynik.prosba.pakiet}, ${wynik.prosba.jezyk})`);
  return z.odpowiedzJson(res, 200, { ok: true });
}

/** Do testow: wyzerowanie licznikow. */
function wyzerujLimity() {
  zAdresu.clear();
  zSieci.clear();
  dobowe = [];
}

module.exports = {
  obsluz, sprawdz, wolno, ocenLimit, siecAdresu, zapisz, sprzataj, lista, wyzerujLimity, PLIK, PAKIETY,
  NA_GODZINE_Z_ADRESU, NA_DOBE_Z_SIECI, NA_DOBE, NA_DOBE_TWARDO, DNI,
};
