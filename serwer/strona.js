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

const ENCJE = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  oacute: 'ó', Oacute: 'Ó', hellip: '...', ndash: '-', mdash: '-',
  laquo: '"', raquo: '"', bdquo: '"', ldquo: '"', rdquo: '"', sbquo: ',',
};

function odkodujEncje(tekst) {
  return tekst
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (calosc, nazwa) => (nazwa in ENCJE ? ENCJE[nazwa] : calosc));
}

function tytulStrony(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? odkodujEncje(m[1]).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

function naTekst(html) {
  let t = html;
  // Najpierw wszystko, co nie jest trescia dla czytelnika. Bez tego w bazie
  // wiedzy ladowal kod JavaScriptu i menu powtorzone na kazdej podstronie.
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const znacznik of ['script', 'style', 'noscript', 'svg', 'template',
    'nav', 'header', 'footer', 'form', 'iframe', 'aside']) {
    t = t.replace(new RegExp('<' + znacznik + '\\b[^>]*>[\\s\\S]*?<\\/' + znacznik + '>', 'gi'), ' ');
  }
  // Jesli strona wyroznia tresc glowna, bierzemy tylko ja.
  const glowna = t.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (glowna && glowna[1].length > 500) t = glowna[1];

  // Naglowki dostaja wlasna linie z krzyzykami - dzieki temu struktura strony
  // przezywa konwersje i model widzi, co bylo naglowkiem, a co akapitem.
  t = t.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, poziom, tresc) => '\n\n' + '#'.repeat(Number(poziom)) + ' ' + tresc.replace(/<[^>]+>/g, ' ') + '\n');
  t = t.replace(/<li\b[^>]*>/gi, '\n- ');
  t = t.replace(/<\/(p|div|tr|section|ul|ol|table|li|h[1-6])>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/t[dh]>/gi, ' | ');
  t = t.replace(/<[^>]+>/g, ' ');

  t = odkodujEncje(t);
  t = t.replace(/[ \t ]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
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
  const html = bufor.toString('utf8');

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
