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

const dns = require('node:dns').promises;
const net = require('node:net');

const LIMIT_BAJTOW = 4 * 1024 * 1024;   // wiecej niz strona tekstowa potrzebuje
const LIMIT_ZNAKOW = 400000;            // ~100 tys. tokenow, gorna granica sensu
const LIMIT_PRZEKIEROWAN = 5;
const CZAS_ODPOWIEDZI = 20000;

// Przegladarka, ktora sie nie przedstawia, bywa odrzucana przez CDN-y.
const AGENT = 'Mozilla/5.0 (compatible; ContentAI/1.0; +https://content-ai.net)';

// ─── Ochrona przed SSRF ──────────────────────────────────────────────────────
// Serwer pobiera adres podany przez zalogowanego uzytkownika, wiec bez tej
// kontroli byloby to okienko do sieci wewnetrznej: ktos wpisalby
// http://169.254.169.254/ i dostal metadane maszyny prosto do bazy wiedzy.
// Sprawdzamy KAZDY skok przekierowania, nie tylko pierwszy adres.

function adresPrywatny(ip) {
  const rodzaj = net.isIP(ip);
  if (rodzaj === 4) {
    const o = ip.split('.').map(Number);
    if (o[0] === 10) return true;
    if (o[0] === 127) return true;
    if (o[0] === 0) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true;   // metadane chmury
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
    if (o[0] >= 224) return true;                    // multicast i wyzej
    return false;
  }
  if (rodzaj === 6) {
    const a = ip.toLowerCase();
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('fc') || a.startsWith('fd')) return true;   // unique local
    if (a.startsWith('fe8') || a.startsWith('fe9')
      || a.startsWith('fea') || a.startsWith('feb')) return true; // link local
    // ::ffff:10.0.0.1 - adres IPv4 zapisany jako IPv6
    const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return adresPrywatny(m[1]);
    return false;
  }
  return true;   // nie rozpoznalismy - traktujemy jak prywatny
}

async function sprawdzAdres(adres) {
  let u;
  try { u = new URL(adres); } catch { throw new Error('Niepoprawny adres'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Dozwolone sa tylko adresy http i https');
  }
  // Gdy w adresie jest wprost IP, dns.lookup i tak je zwroci - sprawdzamy raz.
  let wyniki;
  try {
    wyniki = await dns.lookup(u.hostname, { all: true });
  } catch {
    throw new Error('Nie udalo sie rozwiazac nazwy hosta');
  }
  if (!wyniki.length) throw new Error('Nie udalo sie rozwiazac nazwy hosta');
  for (const w of wyniki) {
    if (adresPrywatny(w.address)) throw new Error('Adres wskazuje na siec wewnetrzna');
  }
  return u;
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
// kolejnym skoku.
async function pobierz(adres, fetchImpl = fetch) {
  let biezacy = adres;
  let odp = null;

  for (let skok = 0; skok <= LIMIT_PRZEKIEROWAN; skok++) {
    const u = await sprawdzAdres(biezacy);
    const przerwij = AbortSignal.timeout(CZAS_ODPOWIEDZI);
    odp = await fetchImpl(u.href, {
      redirect: 'manual',           // kazdy skok sprawdzamy sami
      signal: przerwij,
      headers: { 'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml,text/plain' },
    });
    if (odp.status >= 300 && odp.status < 400 && odp.headers.get('location')) {
      biezacy = new URL(odp.headers.get('location'), u.href).href;
      odp = null;
      continue;
    }
    break;
  }

  if (!odp) throw new Error('Za duzo przekierowan');
  if (!odp.ok) throw new Error('Strona odpowiedziala bledem HTTP ' + odp.status);

  const typ = (odp.headers.get('content-type') || '').toLowerCase();
  if (typ && !typ.includes('html') && !typ.includes('text/plain') && !typ.includes('xml')) {
    throw new Error('To nie jest strona tekstowa (' + typ.split(';')[0] + ')');
  }
  const dlugosc = Number(odp.headers.get('content-length') || 0);
  if (dlugosc && dlugosc > LIMIT_BAJTOW) throw new Error('Strona jest za duza');

  const bufor = Buffer.from(await odp.arrayBuffer());
  if (bufor.length > LIMIT_BAJTOW) throw new Error('Strona jest za duza');
  const html = bufor.toString('utf8');

  const tekst = naTekst(html).slice(0, LIMIT_ZNAKOW);
  const slowa = tekst.split(/\s+/).filter(Boolean).length;
  if (slowa < 30) {
    // Najczestszy powod: strona buduje sie w przegladarce i w samym HTML-u
    // nie ma jeszcze tresci. Mowimy to wprost, zamiast zwracac pustke.
    throw new Error('Strona nie zawiera czytelnego tekstu (' + slowa
      + ' slow). Prawdopodobnie tresc dogrywa sie skryptem.');
  }

  return { adres: biezacy, tytul: tytulStrony(html), tekst, slowa };
}

// ─── Sprawdzenie, czy odnosnik zyje ──────────────────────────────────────────
// Artykul moze zawierac adres, ktory model zbudowal sam: wyglada jak ze
// zrodla, a prowadzi donikad. Przegladarka tego nie sprawdzi, bo obca witryna
// nie pozwala jej czytac odpowiedzi. Serwer moze - i robi to z ta sama
// ochrona adresu co przy pobieraniu strony.
async function sprawdzOdnosniki(adresy, fetchImpl = fetch) {
  const wynik = [];
  for (const adres of adresy.slice(0, 40)) {
    try {
      const u = await sprawdzAdres(adres);
      // HEAD jest tansze, ale czesc serwerow go nie obsluguje i odpowiada
      // 405 albo 501. Wtedy pytamy jeszcze raz metoda GET, zeby nie zglosic
      // zywego adresu jako martwego.
      let odp = await fetchImpl(u.href, {
        method: 'HEAD', redirect: 'follow',
        signal: AbortSignal.timeout(CZAS_ODPOWIEDZI),
        headers: { 'User-Agent': AGENT },
      });
      if (odp.status === 405 || odp.status === 501 || odp.status === 403) {
        odp = await fetchImpl(u.href, {
          method: 'GET', redirect: 'follow',
          signal: AbortSignal.timeout(CZAS_ODPOWIEDZI),
          headers: { 'User-Agent': AGENT },
        });
      }
      wynik.push({ adres, status: odp.status, dziala: odp.status < 400 });
    } catch (e) {
      wynik.push({ adres, status: 0, dziala: false, blad: e.message });
    }
  }
  return wynik;
}

module.exports = { pobierz, naTekst, adresPrywatny, sprawdzAdres, sprawdzOdnosniki };
