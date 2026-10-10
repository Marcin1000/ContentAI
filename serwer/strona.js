'use strict';

// ─── Pobieranie strony WWW do bazy wiedzy ────────────────────────────────────
//
// Dlaczego to powstalo: aplikacja probowala "kazac modelowi wejsc na strone"
// przez narzedzie web_search. To narzedzie szuka w internecie, a nie pobiera
// wskazanego adresu, wiec model odpowiadal streszczeniem albo zdaniem
// "nie moge odwiedzic tej strony". Agencja SEO zglosila, ze dodawanie linkow
// nie dziala w ogole. Nie dzialalo, bo nikt tej strony nie pobieral.
//
// Tutaj pobieramy ja naprawde: zwyklym zadaniem HTTP, bez modelu i bez
// tokenow. Zwracamy tytul i czysty tekst.

const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

const LIMIT_BAJTOW = 4 * 1024 * 1024;   // wiecej niz strona tekstowa potrzebuje
const LIMIT_ZNAKOW = 400000;            // ~100 tys. tokenow, gorna granica sensu
const LIMIT_PRZEKIEROWAN = 5;
const CZAS_ODPOWIEDZI = 20000;
// Sprawdzenie odnosnika to nie pobranie strony: interesuje nas sam kod
// odpowiedzi. 20 sekund na adres bylo wziete z pobierania tresci i przy
// kilku niereagujacych witrynach kazalo uzytkownikowi czekac minutami.
const CZAS_ODNOSNIKA = 6000;
// Ile adresow pytamy naraz. Szly po kolei, wiec czasy sie sumowaly: 40 adresow
// po dwa zapytania z limitem czasu to w najgorszym razie kilkanascie minut.
const ROWNOLEGLE_ODNOSNIKI = 6;

// Przegladarka, ktora sie nie przedstawia, bywa odrzucana przez CDN-y.
const AGENT = 'Mozilla/5.0 (compatible; ContentAI/1.0; +https://content-ai.net)';

/**
 * Blad z komunikatem napisanym przez nas - wolno go pokazac w przegladarce.
 * Wszystko inne (bledy sieci z adresami i portami) serwer zamienia na ogolny
 * komunikat, zeby nie opowiadac o sieci, w ktorej stoi.
 */
class BladStrony extends Error {
  constructor(komunikat, kod) {
    super(komunikat);
    this.name = 'BladStrony';
    if (kod) this.code = kod;
  }
}

// ─── Ochrona przed SSRF ──────────────────────────────────────────────────────
// Serwer pobiera adres podany przez zalogowanego uzytkownika, wiec bez tej
// kontroli byloby to okienko do sieci wewnetrznej: ktos wpisalby
// http://169.254.169.254/ i dostal metadane maszyny prosto do bazy wiedzy.
//
// Trzy warstwy:
//   1. lista zakresow specjalnych z rejestrow IANA (net.BlockList),
//   2. kontrola KAZDEGO skoku przekierowania - takze przy sprawdzaniu odnosnikow,
//   3. kontrola adresu W CHWILI LACZENIA (opcja lookup w http/https.request):
//      odpowiedz DNS nie moze sie zmienic miedzy sprawdzeniem a polaczeniem.

const ZAKRESY_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
// Bez ::ffff:0:0/96: BlockList sam ocenia adresy IPv4 zapisane jako IPv6
// (w kazdym zapisie) wedlug regul IPv4, a ta regula zablokowalaby caly IPv4.
const ZAKRESY_V6 = [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];
const ZABLOKOWANE = new net.BlockList();
for (const [a, p] of ZAKRESY_V4) ZABLOKOWANE.addSubnet(a, p, 'ipv4');
for (const [a, p] of ZAKRESY_V6) ZABLOKOWANE.addSubnet(a, p, 'ipv6');

function adresPrywatny(ip) {
  const rodzaj = net.isIP(String(ip || ''));
  if (rodzaj === 0) return true;   // nie rozpoznalismy - traktujemy jak prywatny
  try {
    return ZABLOKOWANE.check(ip, rodzaj === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return true;
  }
}

/** Nazwa hosta z adresu bez nawiasow IPv6 ([::1] -> ::1). */
function hostBezNawiasow(u) {
  return u.hostname.replace(/^\[|\]$/g, '');
}

async function sprawdzAdres(adres) {
  let u;
  try { u = new URL(adres); } catch { throw new BladStrony('Niepoprawny adres'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BladStrony('Dozwolone sa tylko adresy http i https');
  }
  const host = hostBezNawiasow(u);
  // Adres podany wprost jako IP sprawdzamy od razu - przy laczeniu Node nie
  // pyta wtedy DNS, wiec kontrola w lookup by go nie zobaczyla.
  if (net.isIP(host)) {
    if (adresPrywatny(host)) throw new BladStrony('Adres wskazuje na siec wewnetrzna', 'CAI_SIEC_WEWNETRZNA');
    return u;
  }
  let wyniki;
  try {
    wyniki = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new BladStrony('Nie udalo sie rozwiazac nazwy hosta');
  }
  if (!wyniki.length) throw new BladStrony('Nie udalo sie rozwiazac nazwy hosta');
  for (const w of wyniki) {
    if (adresPrywatny(w.address)) throw new BladStrony('Adres wskazuje na siec wewnetrzna', 'CAI_SIEC_WEWNETRZNA');
  }
  return u;
}

/**
 * lookup dla http/https.request: rozwiazuje nazwe i odrzuca polaczenie, gdy
 * KTORYKOLWIEK adres jest wewnetrzny. Dziala w chwili laczenia, wiec zmiana
 * odpowiedzi DNS po sprawdzAdres (DNS rebinding) nic nie da.
 */
function bezpiecznyLookup(hostname, opcje, oddzwon) {
  dns.lookup(hostname, opcje, (blad, adres, rodzina) => {
    if (blad) return oddzwon(blad);
    const lista = Array.isArray(adres) ? adres : [{ address: adres, family: rodzina }];
    if (!lista.length || lista.some((a) => adresPrywatny(a.address))) {
      return oddzwon(new BladStrony('Adres wskazuje na siec wewnetrzna', 'CAI_SIEC_WEWNETRZNA'));
    }
    return oddzwon(null, adres, rodzina);
  });
}

/**
 * Jedno zapytanie HTTP bez sledzenia przekierowan, z kontrola adresu przy
 * laczeniu. Zwraca obiekt w ksztalcie odpowiedzi fetch (status, ok,
 * headers.get) plus surowy strumien do czytania z limitem bajtow.
 */
function zapytanieHttp(href, opcje = {}) {
  return new Promise((rozwiaz, odrzuc) => {
    const u = new URL(href);
    const modul = u.protocol === 'https:' ? https : http;
    const zadanie = modul.request(u, {
      method: opcje.method || 'GET',
      headers: opcje.headers || {},
      lookup: bezpiecznyLookup,
      signal: opcje.signal,
    }, (odp) => {
      rozwiaz({
        status: odp.statusCode,
        ok: odp.statusCode >= 200 && odp.statusCode < 300,
        headers: { get: (k) => { const v = odp.headers[String(k).toLowerCase()]; return v === undefined ? null : String(v); } },
        strumien: odp,
        zamknij: () => odp.destroy(),
      });
    });
    zadanie.on('error', odrzuc);
    zadanie.end();
  });
}

/**
 * Czyta cialo odpowiedzi, liczac bajty w trakcie: po przekroczeniu limitu
 * przerywa od razu, zamiast najpierw wczytac calosc do pamieci.
 */
async function czytajZLimitem(odp, limit) {
  if (odp.strumien) {
    return new Promise((rozwiaz, odrzuc) => {
      const kawalki = [];
      let rozmiar = 0;
      odp.strumien.on('data', (c) => {
        rozmiar += c.length;
        if (rozmiar > limit) {
          odp.strumien.destroy();
          odrzuc(new BladStrony('Strona jest za duza'));
          return;
        }
        kawalki.push(c);
      });
      odp.strumien.on('end', () => rozwiaz(Buffer.concat(kawalki)));
      odp.strumien.on('error', odrzuc);
    });
  }
  if (odp.body && typeof odp.body.getReader === 'function') {
    const czytnik = odp.body.getReader();
    const kawalki = [];
    let rozmiar = 0;
    for (;;) {
      const { done, value } = await czytnik.read();
      if (done) break;
      rozmiar += value.length;
      if (rozmiar > limit) {
        await czytnik.cancel().catch(() => {});
        throw new BladStrony('Strona jest za duza');
      }
      kawalki.push(Buffer.from(value));
    }
    return Buffer.concat(kawalki);
  }
  // Odpowiedz bez strumienia (atrapa w testach) - sprawdzamy po fakcie.
  const bufor = Buffer.from(await odp.arrayBuffer());
  if (bufor.length > limit) throw new BladStrony('Strona jest za duza');
  return bufor;
}

/** Zwalnia polaczenie, gdy tresci odpowiedzi nie potrzebujemy. */
function porzuc(odp) {
  try {
    if (odp && typeof odp.zamknij === 'function') odp.zamknij();
    else if (odp && odp.body && typeof odp.body.cancel === 'function') odp.body.cancel().catch(() => {});
  } catch { /* juz zamkniete */ }
}

/**
 * Petla przekierowan: kazdy skok przechodzi te sama kontrole adresu co
 * pierwszy. Zwraca { odp, adres } ostatniego skoku.
 */
async function zPrzekierowaniami(adres, opcje, fetchImpl) {
  let biezacy = adres;
  for (let skok = 0; skok <= LIMIT_PRZEKIEROWAN; skok++) {
    const u = await sprawdzAdres(biezacy);
    const odp = await fetchImpl(u.href, { ...opcje, redirect: 'manual' });
    const dokad = odp.status >= 300 && odp.status < 400 ? odp.headers.get('location') : null;
    if (!dokad) return { odp, adres: u.href };
    porzuc(odp);
    biezacy = new URL(dokad, u.href).href;
  }
  throw new BladStrony('Za duzo przekierowan');
}

// ─── HTML na tekst ───────────────────────────────────────────────────────────
// KOD8-02: kazdy krok to jedno przejscie po tekscie (szukanie od biezacej pozycji).
// Dawne wyrazenia z leniwym [\s\S]*? (i samo <[^>]+>) szukaly zamkniecia za KAZDYM
// otwarciem az do konca dokumentu, wiec strona z tysiacami niedomknietych znacznikow
// (<nav>, <h1>, <!--, sam "<") zatrzymywala petle zdarzen calego serwera na dziesiatki
// sekund (32 000 x <nav>: 21 s). Kroki i ich kolejnosc sa te same co dawniej, wiec
// zwykla strona daje ten sam tekst. Zasada wspolna: gdy za otwarciem nie ma juz
// zamkniecia (albo znaku '>'), nie ma go tez za zadnym dalszym otwarciem - koniec.

const ENCJE = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  oacute: 'ó', Oacute: 'Ó', hellip: '...', ndash: '-', mdash: '-',
  laquo: '"', raquo: '"', bdquo: '"', ldquo: '"', rdquo: '"', sbquo: ',',
};

/** Znak z encji liczbowej albo null poza zakresem Unicode (dawniej wyjatek i blad pobrania). */
function znakZKodu(kod) {
  return Number.isInteger(kod) && kod > 0 && kod <= 0x10ffff && (kod < 0xd800 || kod > 0xdfff)
    ? String.fromCodePoint(kod) : null;
}

function odkodujEncje(tekst) {
  return tekst
    .replace(/&#x([0-9a-f]+);/gi, (calosc, h) => znakZKodu(parseInt(h, 16)) ?? calosc)
    .replace(/&#(\d+);/g, (calosc, d) => znakZKodu(Number(d)) ?? calosc)
    .replace(/&([a-z]+);/gi, (calosc, nazwa) => (Object.prototype.hasOwnProperty.call(ENCJE, nazwa) ? ENCJE[nazwa] : calosc));
}

const ZNAK_SLOWA = /[A-Za-z0-9_]/;

/** Wzor napisu bez rozrozniania wielkosci liter (do szukania od pozycji). */
function wzorNapisu(napis) {
  return new RegExp(napis.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'gi');
}

/** Pozycja nastepnego wystapienia wzoru (flagi g, i) od miejsca `od` albo -1. */
function nastepny(wzor, t, od) {
  wzor.lastIndex = od;
  const m = wzor.exec(t);
  return m ? m.index : -1;
}

/**
 * Bloki od otwarcia do najblizszego zamkniecia -> zamiana. `znacznik`: za nazwa granica slowa
 * i znak '>' (jak /<nav\b[^>]*>[\s\S]*?<\/nav>/gi); bez niego sam napis (jak /<!--[\s\S]*?-->/g).
 */
function usunBloki(t, otwarcie, zamkniecie, zamiana, znacznik) {
  const wzorOtwarcia = wzorNapisu(otwarcie);
  const wzorZamkniecia = wzorNapisu(zamkniecie);
  let wynik = '';
  let pos = 0;
  let od = 0;
  for (;;) {
    const i = nastepny(wzorOtwarcia, t, od);
    if (i < 0) break;
    let koniec = i + otwarcie.length;
    if (znacznik) {
      if (koniec < t.length && ZNAK_SLOWA.test(t[koniec])) { od = koniec; continue; }
      const gt = t.indexOf('>', koniec);
      if (gt < 0) break;
      koniec = gt + 1;
    }
    const k = nastepny(wzorZamkniecia, t, koniec);
    if (k < 0) break;
    wynik += t.slice(pos, i) + zamiana;
    pos = k + zamkniecie.length;
    od = pos;
  }
  return pos === 0 ? t : wynik + t.slice(pos);
}

/** Tresc pierwszego <main> albo <article> do najblizszego zamkniecia ktoregokolwiek, albo null. */
function trescGlowna(t) {
  const wMain = /<main/gi;
  const wArticle = /<article/gi;
  let a = nastepny(wMain, t, 0);
  let b = nastepny(wArticle, t, 0);
  for (;;) {
    if (a < 0 && b < 0) return null;
    const zMain = a >= 0 && (b < 0 || a < b);
    const i = zMain ? a : b;
    const po = i + (zMain ? 5 : 8);
    if (po < t.length && ZNAK_SLOWA.test(t[po])) {
      if (zMain) a = nastepny(wMain, t, i + 1); else b = nastepny(wArticle, t, i + 1);
      continue;
    }
    const gt = t.indexOf('>', po);
    if (gt < 0) return null;
    const k1 = nastepny(/<\/main>/gi, t, gt + 1);
    const k2 = nastepny(/<\/article>/gi, t, gt + 1);
    if (k1 < 0 && k2 < 0) return null;
    return t.slice(gt + 1, k1 < 0 ? k2 : k2 < 0 ? k1 : Math.min(k1, k2));
  }
}

/** Kazdy znacznik "<...>" (co najmniej jeden znak w srodku) -> zamiana (jak /<[^>]+>/g). */
function bezZnacznikow(t, zamiana) {
  let wynik = '';
  let pos = 0;
  let od = 0;
  for (;;) {
    const i = t.indexOf('<', od);
    if (i < 0) break;
    const gt = t.indexOf('>', i + 1);
    if (gt < 0) break;
    if (gt === i + 1) { od = gt; continue; }
    wynik += t.slice(pos, i) + zamiana;
    pos = gt + 1;
    od = pos;
  }
  return pos === 0 ? t : wynik + t.slice(pos);
}

/** Kazde otwarcie <znacznik ...> (granica slowa, do najblizszego '>') -> zamiana (jak /<li\b[^>]*>/gi). */
function zamienOtwarcia(t, znacznik, zamiana) {
  const wzor = wzorNapisu('<' + znacznik);
  let wynik = '';
  let pos = 0;
  let od = 0;
  for (;;) {
    const i = nastepny(wzor, t, od);
    if (i < 0) break;
    const po = i + 1 + znacznik.length;
    if (po < t.length && ZNAK_SLOWA.test(t[po])) { od = po; continue; }
    const gt = t.indexOf('>', po);
    if (gt < 0) break;
    wynik += t.slice(pos, i) + zamiana;
    pos = gt + 1;
    od = pos;
  }
  return pos === 0 ? t : wynik + t.slice(pos);
}

/**
 * Naglowki h1-h6: dla kazdego otwarcia najblizsze zamkniecie tego samego poziomu (jak
 * /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi). Ostatnio znalezione zamkniecie kazdego poziomu
 * i znak '>' sa pamietane, wiec niedomkniete naglowki nie skanuja dokumentu od nowa.
 */
function zamienNaglowki(t, zamiana) {
  const wzor = /<h([1-6])/gi;
  const zamkniecia = new Map();   // poziom -> pozycja zamkniecia (-1: brak do konca)
  let gt = -2;                    // ostatnio znaleziony '>' (-1: brak do konca)
  let wynik = '';
  let pos = 0;
  for (let m = wzor.exec(t); m; m = wzor.exec(t)) {
    const i = m.index;
    const poziom = m[1];
    const po = i + 3;
    if (po < t.length && ZNAK_SLOWA.test(t[po])) continue;
    if (gt !== -1 && gt < po) gt = t.indexOf('>', po);
    if (gt < 0) break;
    let k = zamkniecia.has(poziom) ? zamkniecia.get(poziom) : -2;
    if (k !== -1 && k <= gt) {
      k = nastepny(new RegExp(`</h${poziom}>`, 'gi'), t, gt + 1);
      zamkniecia.set(poziom, k);
    }
    if (k < 0) continue;
    wynik += t.slice(pos, i) + zamiana(poziom, t.slice(gt + 1, k));
    pos = k + 5;
    wzor.lastIndex = pos;
  }
  return pos === 0 ? t : wynik + t.slice(pos);
}

function tytulStrony(html) {
  const i = nastepny(/<title/gi, html, 0);
  const gt = i < 0 ? -1 : html.indexOf('>', i + 6);
  const k = gt < 0 ? -1 : nastepny(/<\/title>/gi, html, gt + 1);
  return k < 0 ? '' : odkodujEncje(html.slice(gt + 1, k)).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function naTekst(html) {
  let t = html;
  // Najpierw wszystko, co nie jest trescia dla czytelnika. Bez tego w bazie
  // wiedzy ladowal kod JavaScriptu i menu powtorzone na kazdej podstronie.
  t = usunBloki(t, '<!--', '-->', ' ', false);
  for (const znacznik of ['script', 'style', 'noscript', 'svg', 'template',
    'nav', 'header', 'footer', 'form', 'iframe', 'aside']) {
    t = usunBloki(t, '<' + znacznik, '</' + znacznik + '>', ' ', true);
  }
  // Jesli strona wyroznia tresc glowna, bierzemy tylko ja.
  const glowna = trescGlowna(t);
  if (glowna !== null && glowna.length > 500) t = glowna;

  // Naglowki dostaja wlasna linie z krzyzykami - dzieki temu struktura strony
  // przezywa konwersje i model widzi, co bylo naglowkiem, a co akapitem.
  t = zamienNaglowki(t, (poziom, tresc) => '\n\n' + '#'.repeat(Number(poziom)) + ' ' + bezZnacznikow(tresc, ' ') + '\n');
  t = zamienOtwarcia(t, 'li', '\n- ');
  t = t.replace(/<\/(p|div|tr|section|ul|ol|table|li|h[1-6])>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/t[dh]>/gi, ' | ');
  t = bezZnacznikow(t, ' ');

  t = odkodujEncje(t);
  t = t.replace(/[ \t ]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// ─── Kodowanie strony (KOD8-15) ──────────────────────────────────────────────
// Strona w windows-1250 albo ISO-8859-2 (starsze polskie witryny) czytana jako UTF-8
// dawala w bazie "Pompa ciep�a". Kolejnosc jak w przegladarce: znacznik BOM, charset
// z naglowka Content-Type, <meta charset> albo <meta http-equiv> w pierwszych 4 kB,
// domyslnie UTF-8. Nieznana nazwa kodowania -> UTF-8 (TextDecoder z pelnym ICU w Node).

function kodowanieStrony(bufor, typ) {
  if (bufor.length >= 3 && bufor[0] === 0xef && bufor[1] === 0xbb && bufor[2] === 0xbf) return 'utf-8';
  const zNaglowka = /charset\s*=\s*["']?([\w.:-]+)/i.exec(typ || '');
  if (zNaglowka) return zNaglowka[1];
  const poczatek = bufor.subarray(0, 4096).toString('latin1');
  const zMeta = /<meta\b[^>]*?charset\s*=\s*["']?([\w.:-]+)/i.exec(poczatek);
  // Deklaracja UTF-16 w <meta> pliku czytanego bajtami to w praktyce UTF-8 (tak robi przegladarka).
  if (zMeta && !/^utf-?16/i.test(zMeta[1])) return zMeta[1];
  return 'utf-8';
}

function odkodujStrone(bufor, typ) {
  try {
    return new TextDecoder(kodowanieStrony(bufor, typ)).decode(bufor);
  } catch {
    return bufor.toString('utf8');
  }
}

// ─── Pobranie ────────────────────────────────────────────────────────────────

// fetchImpl wstrzykujemy tak samo jak w baza.js - zeby testy mogly przejsc
// petle przekierowan bez sieci. Kontrola adresu zostaje w srodku, wiec
// podstawiony fetch nie omija jej ani na pierwszym adresie, ani na zadnym
// kolejnym skoku. Domyslnie zapytanieHttp, ktore sprawdza adres takze przy
// samym laczeniu.
async function pobierz(adres, fetchImpl = zapytanieHttp) {
  const { odp, adres: koncowy } = await zPrzekierowaniami(adres, {
    signal: AbortSignal.timeout(CZAS_ODPOWIEDZI),
    headers: { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,text/plain' },
  }, fetchImpl);

  if (!odp.ok) { porzuc(odp); throw new BladStrony('Strona odpowiedziala bledem HTTP ' + odp.status); }

  const typ = (odp.headers.get('content-type') || '').toLowerCase();
  if (typ && !typ.includes('html') && !typ.includes('text/plain') && !typ.includes('xml')) {
    porzuc(odp);
    throw new BladStrony('To nie jest strona tekstowa (' + typ.split(';')[0] + ')');
  }
  const dlugosc = Number(odp.headers.get('content-length') || 0);
  if (dlugosc && dlugosc > LIMIT_BAJTOW) { porzuc(odp); throw new BladStrony('Strona jest za duza'); }

  const bufor = await czytajZLimitem(odp, LIMIT_BAJTOW);
  const html = odkodujStrone(bufor, typ);

  const tekst = naTekst(html).slice(0, LIMIT_ZNAKOW);
  const slowa = tekst.split(/\s+/).filter(Boolean).length;
  if (slowa < 30) {
    // Najczestszy powod: strona buduje sie w przegladarce i w samym HTML-u
    // nie ma jeszcze tresci. Mowimy to wprost, zamiast zwracac pustke.
    throw new BladStrony('Strona nie zawiera czytelnego tekstu (' + slowa
      + ' slow). Prawdopodobnie tresc dogrywa sie skryptem.');
  }

  return { adres: koncowy, tytul: tytulStrony(html), tekst, slowa };
}

// ─── Sprawdzenie, czy odnosnik zyje ──────────────────────────────────────────
// Artykul moze zawierac adres, ktory model zbudowal sam: wyglada jak ze
// zrodla, a prowadzi donikad. Przegladarka tego nie sprawdzi, bo obca witryna
// nie pozwala jej czytac odpowiedzi. Serwer moze - i robi to z ta sama
// ochrona adresu co przy pobieraniu strony.
async function sprawdzOdnosniki(adresy, fetchImpl = zapytanieHttp) {
  const doSprawdzenia = adresy.slice(0, 40);

  // Przekierowania sledzimy sami, z kontrola kazdego skoku - redirect:'follow'
  // sprawdzal tylko pierwszy adres, a kolejne skoki mogly prowadzic do sieci
  // wewnetrznej. Tresci nie czytamy: liczy sie kod odpowiedzi.
  async function zapytaj(href, metoda) {
    const { odp } = await zPrzekierowaniami(href, {
      method: metoda,
      signal: AbortSignal.timeout(CZAS_ODNOSNIKA),
      headers: { 'User-Agent': AGENT },
    }, fetchImpl);
    porzuc(odp);
    return odp;
  }

  async function jeden(adres) {
    let u;
    try {
      u = await sprawdzAdres(adres);
    } catch (e) {
      return { adres, status: 0, stan: 'odrzucony', dziala: false, blad: e.message };
    }

    // HEAD jest tansze, ale duze witryny za CDN-em czesto na nie nie
    // odpowiadaja: albo oddaja 403/405, albo po prostu wisza az do
    // przekroczenia czasu. Dlatego po KAZDYM niepowodzeniu HEAD, takze po
    // wyjatku, pytamy jeszcze raz metoda GET.
    let odp = null;
    let blad = null;
    try {
      odp = await zapytaj(u.href, 'HEAD');
    } catch (e) {
      blad = e;
    }
    // Przekierowanie do sieci wewnetrznej to odmowa, nie "nie odpowiada".
    if (blad && blad.code === 'CAI_SIEC_WEWNETRZNA') {
      return { adres, status: 0, stan: 'odrzucony', dziala: false, blad: blad.message };
    }
    const wartoPonowic = !odp
      || odp.status === 403 || odp.status === 405
      || odp.status === 501 || odp.status === 429;
    if (wartoPonowic) {
      try {
        odp = await zapytaj(u.href, 'GET');
        blad = null;
      } catch (e) {
        blad = e;
        odp = null;
      }
      if (blad && blad.code === 'CAI_SIEC_WEWNETRZNA') {
        return { adres, status: 0, stan: 'odrzucony', dziala: false, blad: blad.message };
      }
    }

    if (!odp) {
      // NIE to samo co "adres nie odpowiada". Przekroczony czas albo blad
      // sieci znaczy, ze kontrola sie nie odbyla - zglaszanie tego jako
      // martwego odnosnika bylo falszywym alarmem na dzialajacych stronach.
      // Komunikat systemowy (adres, port) nie idzie do przegladarki.
      const czas = blad && (blad.name === 'TimeoutError' || blad.name === 'AbortError' || /timeout|aborted/i.test(blad.message));
      return { adres, status: 0, stan: 'nieznany', dziala: false,
               blad: !blad ? '' : blad instanceof BladStrony ? blad.message
                 : czas ? 'Brak odpowiedzi w wyznaczonym czasie' : 'Blad polaczenia' };
    }
    return {
      adres, status: odp.status,
      stan: odp.status < 400 ? 'dziala' : 'martwy',
      dziala: odp.status < 400,
    };
  }

  // Kolejnosc wyniku musi odpowiadac kolejnosci wejscia, bo wywolujacy
  // zestawia je z wlasna lista. Dlatego kazdy robotnik wpisuje sie pod swoj
  // indeks, a nie dopisuje na koniec.
  const wynik = new Array(doSprawdzenia.length);
  let nastepny = 0;
  async function robotnik() {
    for (;;) {
      const i = nastepny++;
      if (i >= doSprawdzenia.length) return;
      wynik[i] = await jeden(doSprawdzenia[i]);
    }
  }
  const ilu = Math.min(ROWNOLEGLE_ODNOSNIKI, doSprawdzenia.length);
  await Promise.all(Array.from({ length: ilu }, robotnik));
  return wynik;
}

module.exports = {
  pobierz, naTekst, adresPrywatny, sprawdzAdres, sprawdzOdnosniki,
  BladStrony, zapytanieHttp, czytajZLimitem, bezpiecznyLookup, ZAKRESY_V4, ZAKRESY_V6,
};
