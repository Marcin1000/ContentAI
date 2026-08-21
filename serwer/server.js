#!/usr/bin/env node
/**
 * Content AI - serwer aplikacji
 *
 * Robi trzy rzeczy:
 *  1. serwuje aplikacje (wariant proxy, z adresami API przepisanymi na wlasny serwer),
 *  2. pilnuje logowania - konta z rolami, hasla haszowane scryptem, sesje w cookie,
 *  3. posredniczy w wywolaniach API, dzieki czemu klucze nigdy nie trafiaja do przegladarki.
 *
 * Zero zaleznosci npm - tylko moduly wbudowane Node >= 18 (fetch jest globalny).
 *
 * Endpointy proxy odtwarzaja kontrakt app/worker.js, wiec aplikacja dziala bez zmian:
 *   POST /api               -> generowanie tresci
 *   POST /api/images        -> grafiki
 *   POST /api/tts           -> synteza mowy
 *   POST /api/transcribe    -> transkrypcja
 *   POST /api/eleven-tts    -> synteza ElevenLabs
 *
 * Konfiguracja przez zmienne srodowiskowe - patrz serwer/README.md.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const serp = require('./serp.js');
const baza = require('./baza.js');
const openseo = require('./openseo.js');
const openseoMcp = require('./openseo-mcp.js');
const plany = require('./plany.js');

const KATALOG = __dirname;
const APP = path.join(KATALOG, '..', 'app');
const PLIK_UZYTKOWNIKOW = process.env.CAI_UZYTKOWNICY || path.join(KATALOG, 'dane', 'uzytkownicy.json');

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
  urlNvidia: process.env.CAI_URL_NVIDIA || 'https://integrate.api.nvidia.com/v1/chat/completions',

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
};

// ─── Uzytkownicy ──────────────────────────────────────────────────────────────
// Plik JSON: [{ login, hash, sol, rola, utworzony }]. Rola: 'admin' | 'uzytkownik'.
// Admin widzi /api/status i moze zarzadzac kontami; uzytkownik tylko korzysta z aplikacji.

const ROLE = ['admin', 'uzytkownik'];

function wczytajUzytkownikow() {
  try {
    const dane = JSON.parse(fs.readFileSync(PLIK_UZYTKOWNIKOW, 'utf8'));
    return Array.isArray(dane) ? dane : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Nie udalo sie wczytac uzytkownikow:', e.message);
    return [];
  }
}

function zapiszUzytkownikow(lista) {
  fs.mkdirSync(path.dirname(PLIK_UZYTKOWNIKOW), { recursive: true });
  // 0600 - plik z hashami hasel nie powinien byc czytelny dla innych kont na serwerze
  fs.writeFileSync(PLIK_UZYTKOWNIKOW, JSON.stringify(lista, null, 2), { mode: 0o600 });
}

function zahaszuj(haslo, sol) {
  const s = sol || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(haslo, s, 64).toString('hex');
  return { hash, sol: s };
}

function hasloPasuje(haslo, uzytkownik) {
  const { hash } = zahaszuj(haslo, uzytkownik.sol);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(uzytkownik.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
//   - wylogowanie dopisuje identyfikator sesji do serwer/dane/wylogowane.json,
//   - zmiana hasla, roli albo usuniecie konta podnosi znacznik sesjeOd
//     w pliku kont, co uniewaznia wszystkie starsze sesje tej osoby naraz.

const PLIK_SEKRETU = process.env.CAI_SEKRET_PLIK || path.join(KATALOG, 'dane', 'sekret');
const PLIK_WYLOGOWANYCH = path.join(KATALOG, 'dane', 'wylogowane.json');

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
    fs.mkdirSync(path.dirname(PLIK_SEKRETU), { recursive: true });
    fs.writeFileSync(PLIK_SEKRETU, nowy, { mode: 0o600 });
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

/** Identyfikatory sesji wylogowanych recznie. Maly plik, czytany z dysku. */
function wylogowane() {
  try {
    const dane = JSON.parse(fs.readFileSync(PLIK_WYLOGOWANYCH, 'utf8'));
    return Array.isArray(dane) ? dane : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[sesje] odczyt listy wylogowanych:', e.message);
    return [];
  }
}

function zapiszWylogowanie(id, wygasa) {
  // Wpisy starsze niz ich wlasne wygasniecie sa juz bez znaczenia - podpisana
  // sesja i tak nie przejdzie kontroli daty. Sprzatamy przy okazji zapisu,
  // zeby plik nie rosl w nieskonczonosc.
  const teraz = Date.now();
  const lista = wylogowane().filter((w) => w.wygasa > teraz);
  lista.push({ id, wygasa });
  try {
    fs.mkdirSync(path.dirname(PLIK_WYLOGOWANYCH), { recursive: true });
    fs.writeFileSync(PLIK_WYLOGOWANYCH, JSON.stringify(lista), { mode: 0o600 });
  } catch (e) {
    console.error('[sesje] zapis wylogowania:', e.message);
  }
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
 * Konta zostaja u nas. Brama mowi KTO przyszedl, role nadal czytamy z pliku
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

  const uzytkownik = wczytajUzytkownikow().find((u) => u.login === login);
  if (!uzytkownik) {
    // Swiadomie nie zakladamy konta z marszu: rola musi byc czyjas decyzja,
    // a nie skutkiem ubocznym pierwszego wejscia.
    console.warn(`[brama] brama wpuscila "${login}", ale nie ma takiego konta`);
    return null;
  }
  return { login: uzytkownik.login, rola: uzytkownik.rola, token: null, id: null, zBramy: true };
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
  // zmiana hasla. Czytamy stan biezacy, nie ten sprzed wydania ciasteczka.
  const uzytkownik = wczytajUzytkownikow().find((u) => u.login === opis.login);
  if (!uzytkownik) return null;
  if (uzytkownik.sesjeOd && opis.wydana < uzytkownik.sesjeOd) return null;

  if (wylogowane().some((w) => w.id === opis.id)) return null;

  // Rola bierze sie z pliku kont, nie z ciasteczka - degradacja admina
  // dziala natychmiast, bez czekania na wygasniecie sesji.
  return { login: uzytkownik.login, rola: uzytkownik.rola, token, id: opis.id, wygasa: opis.wygasa };
}

function parsujCiasteczka(naglowek) {
  const out = {};
  for (const czesc of naglowek.split(';')) {
    const i = czesc.indexOf('=');
    if (i > 0) out[czesc.slice(0, i).trim()] = decodeURIComponent(czesc.slice(i + 1).trim());
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

function adresIp(req) {
  // Za Caddy/nginx prawdziwy adres jest w X-Forwarded-For
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'nieznany';
}

// ─── Aplikacja: wariant proxy z adresami przepisanymi na wlasny serwer ────────
// web-proxy.html ma wpisany placeholder workera. Podmieniamy go na pusty ciag,
// dzieki czemu adresy staja sie wzgledne (/api, /api/images, ...) i trafiaja tutaj.

const PLACEHOLDER_WORKER = 'https://twoj-worker.workers.dev';
const PLACEHOLDER_OPENSEO = 'WSTAW_TUTAJ_ADRES_OPENSEO';
const PLACEHOLDER_DOMENA = 'WSTAW_TUTAJ_DOMENA_CIASTECZKA';
let htmlAplikacji = null;

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
  return htmlAplikacji;
}

// ─── Klucze: serwerowy domyslnie, wlasny uzytkownika gdy przyszedl w naglowku ──
// Aplikacja w wariancie proxy wysyla pusty naglowek x-api-key. Jesli uzytkownik
// wpisze wlasny klucz, przyjdzie tu niepusty i uzyjemy jego zamiast serwerowego.

function kluczDoUzycia(req, naglowek, kluczSerwera) {
  const wlasny = req.headers[naglowek];
  if (typeof wlasny === 'string' && wlasny.trim() && !wlasny.startsWith('WSTAW')) {
    return { klucz: wlasny.trim(), czyj: 'uzytkownika' };
  }
  return { klucz: kluczSerwera, czyj: 'serwera' };
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
  const tresc = JSON.stringify(dane);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(tresc),
  });
  res.end(tresc);
}

function odpowiedzTekst(res, status, tekst, typ = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': typ, 'Content-Length': Buffer.byteLength(tekst) });
  res.end(tekst);
}

function czytajCialo(req, limitBajtow = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const kawalki = [];
    let rozmiar = 0;
    req.on('data', (c) => {
      rozmiar += c.length;
      if (rozmiar > limitBajtow) {
        reject(new Error('cialo zadania za duze'));
        req.destroy();
        return;
      }
      kawalki.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(kawalki)));
    req.on('error', reject);
  });
}

// ─── Proxy do dostawcow ───────────────────────────────────────────────────────

/**
 * Kontekst SERP. Zwraca { status, dane } gdy obsluzylismy zapytanie tutaj,
 * albo null gdy ma poleciec dotychczasowa sciezka do modelu.
 *
 * Aplikacja parsuje tresc bloku tekstowego jako JSON, wiec odpowiedz musi miec
 * ksztalt Anthropic z JSON-em w srodku - inaczej fetchSerpContext nic nie zrozumie.
 */
async function obsluzSerp(body) {
  const wAnthropic = (obiekt) => ({
    content: [{ type: 'text', text: JSON.stringify(obiekt) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  // Przez OpenSEO: te same dane DataForSEO, ale zapytanie idzie przez kontener,
  // wiec wynik laduje tez w jego historii i widac go w panelu SEO. Wymaga
  // wskazania projektu (CAI_SEO_PROJEKT), bo narzedzia OpenSEO sa projektowe.
  if (KONF.serp === 'openseo') {
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
        KONF.openseo,
        { platne: true }
      );
      const wynik = serp.zbudujWynik(openseoMcp.serpJakDataForSeo(surowe, fraza), fraza);
      wynik.zrodlo = 'openseo';
      console.log(`[serp] openseo "${fraza}": ${wynik.wynikow} wynikow`);
      return { status: 200, dane: wAnthropic(wynik) };
    } catch (e) {
      console.error('[serp] openseo:', e.message);
      return { status: 502, dane: { content: [], error: { komunikat: 'Nie udalo sie pobrac danych SERP z OpenSEO' } } };
    }
  }

  if (KONF.serp === 'dataforseo') {
    if (!KONF.dataForSeo.login || !KONF.dataForSeo.haslo) {
      console.error('[serp] CAI_SERP=dataforseo, ale brak DATAFORSEO_LOGIN/DATAFORSEO_HASLO');
      return { status: 500, dane: { content: [], error: { komunikat: 'Brak danych dostepowych DataForSEO' } } };
    }
    const fraza = serp.frazaZZadania(body);
    if (!fraza) return { status: 200, dane: wAnthropic({ context: '', topics: [], phrases: [] }) };
    try {
      const wynik = await serp.zDataForSeo(fraza, serp.jezykZZadania(body), KONF.dataForSeo);
      console.log(`[serp] dataforseo "${fraza}": ${wynik.wynikow} wynikow`);
      return { status: 200, dane: wAnthropic(wynik) };
    } catch (e) {
      console.error('[serp] dataforseo:', e.message);
      return { status: 502, dane: { content: [], error: { komunikat: 'Nie udalo sie pobrac danych SERP' } } };
    }
  }

  // CAI_SERP=model, ale dostawca nie ma web_search - lepiej powiedziec to wprost,
  // niz pozwolic modelowi zmyslic dane SERP i podac je dalej jako fakty.
  if (KONF.dostawca !== 'anthropic') {
    console.error(`[serp] dostawca ${KONF.dostawca} nie obsluguje web_search; ustaw CAI_SERP=dataforseo albo openseo`);
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

/** Konto z pliku - plan i rola sa tam, nie w ciasteczku. */
function kontoSesji(sesja) {
  return wczytajUzytkownikow().find((u) => u.login === sesja.login) || { login: sesja.login, rola: sesja.rola };
}

/**
 * Zwraca opis odmowy albo null, gdy wolno. Komunikat jest budowany tak, zeby
 * aplikacja miala z czego zrobic sensowny ekran, a nie tylko "brak dostepu":
 * widac plan, limit, zuzycie i to, czy limit sie kiedykolwiek odnowi.
 */
function odmowaLimitu(sesja, czynnosc) {
  const konto = kontoSesji(sesja);
  const wynik = plany.sprawdzLimit({ katalog: KONF.katalogUzycia, uzytkownik: konto, czynnosc });
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

/** Dopisuje uzycie po udanej odpowiedzi dostawcy. */
function policzUzycie(sesja, czynnosc) {
  try {
    plany.policz({ katalog: KONF.katalogUzycia, uzytkownik: kontoSesji(sesja), czynnosc });
  } catch (e) {
    // Blad licznika nie moze zabrac uzytkownikowi gotowego wyniku - lepiej
    // policzyc o jedno mniej niz oddac blad na juz wykonana prace.
    console.error('[plany] zapis uzycia:', e.message);
  }
}

async function proxyTresc(req, res, sesja) {
  let body;
  try {
    body = JSON.parse((await czytajCialo(req)).toString('utf8'));
  } catch {
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }

  // Zapytanie o kontekst SERP obslugujemy osobno - patrz serwer/serp.js
  if (serp.czyZapytanieSerp(body)) {
    // Analiza SERP kosztuje osobno (DataForSEO albo dluzsze wywolanie modelu),
    // wiec jest funkcja pakietowa, a nie czescia limitu artykulow.
    if (sesja && !plany.maFunkcje(kontoSesji(sesja), 'serp')) {
      return odpowiedzJson(res, 402, {
        content: [],
        error: { komunikat: 'Analiza SERP jest dostępna od pakietu Standard.' },
        funkcja: 'serp',
      });
    }
    const wynik = await obsluzSerp(body);
    if (wynik) return odpowiedzJson(res, wynik.status, wynik.dane);
    // null = zostaw dotychczasowa sciezke (dostawca anthropic z web_search)
  }

  if (KONF.dostawca === 'nvidia') {
    const { klucz } = kluczDoUzycia(req, 'x-api-key', KONF.klucze.nvidia);
    if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak NVIDIA_KEY na serwerze' });
    const odp = await fetch(KONF.urlNvidia, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + klucz },
      body: JSON.stringify(anthropicNaOpenai(body)),
    });
    const surowe = await odp.text();
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
    policzUzycie(sesja, 'artykul');
    return odpowiedzJson(res, 200, openaiNaAnthropic(dane));
  }

  const { klucz } = kluczDoUzycia(req, 'x-api-key', KONF.klucze.anthropic);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak ANTHROPIC_KEY na serwerze' });
  const odp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': klucz,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const tekst = await odp.text();
  if (odp.ok) policzUzycie(sesja, 'artykul');
  res.writeHead(odp.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(tekst);
}

async function proxyOpenAiJson(req, res, url, sesja, czynnosc) {
  const { klucz } = kluczDoUzycia(req, 'x-openai-key', KONF.klucze.openai);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const cialo = await czytajCialo(req);
  const odp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + klucz },
    body: cialo,
  });
  const bufor = Buffer.from(await odp.arrayBuffer());
  if (odp.ok) policzUzycie(sesja, czynnosc);
  res.writeHead(odp.status, {
    'Content-Type': odp.headers.get('content-type') || 'application/json; charset=utf-8',
    'Content-Length': bufor.length,
  });
  res.end(bufor);
}

async function proxyTranskrypcja(req, res, sesja) {
  const { klucz } = kluczDoUzycia(req, 'x-openai-key', KONF.klucze.openai);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const cialo = await czytajCialo(req);
  const odp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + klucz,
      'Content-Type': req.headers['content-type'] || 'multipart/form-data',
    },
    body: cialo,
  });
  const tekst = await odp.text();
  if (odp.ok) policzUzycie(sesja, 'transkrypcja');
  res.writeHead(odp.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(tekst);
}

async function proxyEleven(req, res, sesja) {
  const { klucz } = kluczDoUzycia(req, 'x-eleven-key', KONF.klucze.eleven);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak ELEVEN_KEY na serwerze' });
  let dane;
  try {
    dane = JSON.parse((await czytajCialo(req)).toString('utf8'));
  } catch {
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }
  const glos = dane.voice_id || '21m00Tcm4TlvDq8ikWAM';
  const format = dane.output_format || 'mp3_44100_128';
  const odp = await fetch(
    'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(glos) + '?output_format=' + encodeURIComponent(format),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': klucz },
      body: JSON.stringify({
        text: dane.text || '',
        model_id: dane.model_id || 'eleven_multilingual_v2',
      }),
    }
  );
  const bufor = Buffer.from(await odp.arrayBuffer());
  if (odp.ok) policzUzycie(sesja, 'audio');
  res.writeHead(odp.status, {
    'Content-Type': odp.headers.get('content-type') || 'audio/mpeg',
    'Content-Length': bufor.length,
  });
  res.end(bufor);
}

// ─── Ekran logowania ──────────────────────────────────────────────────────────

function stronaLogowania(komunikat = '') {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Content AI - logowanie</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#07080D;color:#ECEBE6;font:15px/1.5 system-ui,-apple-system,sans-serif;padding:20px}
  form{width:100%;max-width:340px}
  .znak{display:flex;align-items:center;gap:12px;margin-bottom:28px}
  .znak svg{width:34px;height:34px;color:#F6A623;filter:drop-shadow(0 0 12px rgba(246,166,35,.5))}
  .znak span{font:600 18px/1 ui-monospace,monospace;letter-spacing:.22em}
  .znak b{color:#F6A623}
  label{display:block;font-size:12px;font-weight:600;margin:0 0 6px}
  input{width:100%;padding:11px 12px;margin-bottom:16px;border:1px solid #2a2d36;border-radius:8px;
    background:#12141b;color:#ECEBE6;font-size:14px}
  input:focus{outline:2px solid #F6A623;outline-offset:1px;border-color:transparent}
  button{width:100%;padding:12px;border:0;border-radius:8px;background:#F6A623;color:#120A00;
    font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#ffc661}
  .blad{background:rgba(220,60,60,.12);border:1px solid rgba(220,60,60,.4);color:#ff9c9c;
    padding:10px 12px;border-radius:8px;margin-bottom:16px;font-size:13px}
</style></head><body>
<form method="POST" action="/auth/login">
  <div class="znak">
    <svg viewBox="0 0 32 32"><path d="M16 1.5 L18.4 13.6 L30.5 16 L18.4 18.4 L16 30.5 L13.6 18.4 L1.5 16 L13.6 13.6 Z" fill="currentColor"/></svg>
    <span>CONTENT<b>AI</b></span>
  </div>
  ${komunikat ? `<div class="blad">${komunikat}</div>` : ''}
  <label for="login">Login</label>
  <input id="login" name="login" autocomplete="username" autofocus required>
  <label for="haslo">Hasło</label>
  <input id="haslo" name="haslo" type="password" autocomplete="current-password" required>
  <button type="submit">Zaloguj</button>
</form>
</body></html>`;
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

async function obslugaLogowania(req, res) {
  const ip = adresIp(req);
  if (zablokowany(ip)) {
    return odpowiedzTekst(res, 429, stronaLogowania('Za dużo prób. Spróbuj za 15 minut.'), 'text/html; charset=utf-8');
  }
  const dane = new URLSearchParams((await czytajCialo(req, 8192)).toString('utf8'));
  const login = (dane.get('login') || '').trim();
  const haslo = dane.get('haslo') || '';
  const uzytkownik = wczytajUzytkownikow().find((u) => u.login === login);

  if (!uzytkownik || !hasloPasuje(haslo, uzytkownik)) {
    nieudanaProba(ip);
    return odpowiedzTekst(res, 401, stronaLogowania('Niepoprawny login lub hasło.'), 'text/html; charset=utf-8');
  }

  proby.delete(ip);
  const token = utworzSesje(uzytkownik);
  const ciasteczko = `cai_auth=${token}${atrybutyCiasteczka()}; Max-Age=${KONF.sesjaGodzin * 3600}`;
  res.writeHead(302, { Location: '/', 'Set-Cookie': ciasteczko });
  return res.end();
}

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
async function cialoJson(req) {
  try {
    return JSON.parse((await czytajCialo(req)).toString('utf8'));
  } catch {
    const e = new Error('Niepoprawny JSON');
    e.status = 400;
    throw e;
  }
}

/** Ekran wylogowania w trybie bramy - sesje trzyma ona, nie my. */
function stronaWylogowaniaZBramy() {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<title>Wylogowanie</title>
<style>body{font-family:'IBM Plex Sans',system-ui,sans-serif;background:#07080D;color:#E9EDF6;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
div{max-width:420px;padding:32px;background:#11131D;border:1px solid #242A3B;border-radius:14px}
h1{font-size:18px;margin:0 0 12px;color:#FFB000}p{font-size:13px;color:#9DA6BC;line-height:1.6;margin:0}</style>
</head><body><div><h1>Wyloguj się w bramie</h1>
<p>Logowaniem zarządza brama uwierzytelniająca, więc sesję kończysz po jej stronie.
Zamknięcie tej karty nie wystarczy.</p></div></body></html>`;
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function obsluz(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sciezka = url.pathname;

  // Logowanie
  if (sciezka === '/auth/login' && req.method === 'POST') {
    // W trybie bramy nasz wlasny ekran logowania jest wylaczony - hasla
    // sprawdza brama, a przyjmowanie ich takze tutaj tworzyloby druga,
    // slabsza droge wejscia, omijajaca drugi skladnik.
    if (KONF.zaufanyNaglowek) return odpowiedzTekst(res, 404, 'Nie znaleziono');
    return obslugaLogowania(req, res);
  }

  if (sciezka === '/auth/logout') {
    const s = sesjaZadania(req);
    // Wylogowanie zapisujemy na dysku, zeby przezylo restart - podpisane
    // ciasteczko samo w sobie jest wazne az do wygasniecia.
    // W trybie bramy nie mamy czego uniewazniac: sesje trzyma brama i to u niej
    // trzeba sie wylogowac, wiec tylko tam odsylamy.
    if (KONF.zaufanyNaglowek) {
      return odpowiedzTekst(res, 200, stronaWylogowaniaZBramy(), 'text/html; charset=utf-8');
    }
    if (s) zapiszWylogowanie(s.id, s.wygasa);
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': `cai_auth=${atrybutyCiasteczka()}; Max-Age=0`,
    });
    return res.end();
  }

  // Wszystko ponizej wymaga zalogowania
  const sesja = sesjaZadania(req);
  if (!sesja) {
    // Endpointy programistyczne odpowiadaja JSON-em; strony - ekranem logowania.
    if (sciezka.startsWith('/api') || sciezka.startsWith('/auth/')) {
      return odpowiedzJson(res, 401, { error: 'Niezalogowany' });
    }
    return odpowiedzTekst(res, 200, stronaLogowania(), 'text/html; charset=utf-8');
  }

  if (sciezka === '/auth/me') {
    return odpowiedzJson(res, 200, { login: sesja.login, rola: sesja.rola });
  }

  // Status - tylko admin. Nie pokazuje kluczy, wylacznie czy sa ustawione.
  if (sciezka === '/api/status') {
    if (sesja.rola !== 'admin') return odpowiedzJson(res, 403, { error: 'Wymagana rola admin' });
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
      uzytkownikow: wczytajUzytkownikow().length,
      // Sesji nie da sie zliczyc - sa bezstanowe, po stronie przegladarek.
      // Zamiast tego pokazujemy, ile jest recznych wylogowan w mocy.
      wylogowanychSesji: wylogowane().length,
    });
  }

  // Wlasny pakiet: limity, zuzycie i dostepne funkcje. Kazdy widzi swoj.
  if (sciezka === '/api/pakiet' && req.method === 'GET') {
    return odpowiedzJson(res, 200, plany.stanPakietu({
      katalog: KONF.katalogUzycia,
      uzytkownik: kontoSesji(sesja),
    }));
  }

  // ─── Baza wiedzy ───────────────────────────────────────────────────────────
  if (sciezka === '/api/baza' && req.method === 'GET') {
    return odpowiedzJson(res, 200, { dokumenty: baza.lista({ katalog: KONF.katalogBazy, login: sesja.login }) });
  }

  if (sciezka === '/api/baza' && req.method === 'POST') {
    // Limit dokumentow jest pakietowy: darmowy ma trzy, premium bez ograniczenia.
    const konto = kontoSesji(sesja);
    const limitDok = plany.planKonta(konto).limitDokumentow;
    if (limitDok !== null) {
      const wlasne = baza.lista({ katalog: KONF.katalogBazy, login: sesja.login })
        .filter((d) => d.zakres !== baza.WSPOLNA).length;
      if (wlasne >= limitDok) {
        return odpowiedzJson(res, 402, {
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
    // Do bazy wspolnej pisze wylacznie admin - inaczej kazdy zmienialby wiedze zespolu.
    if (zakres === baza.WSPOLNA && sesja.rola !== 'admin') {
      return odpowiedzJson(res, 403, { error: 'Do bazy wspólnej dodaje wyłącznie admin' });
    }
    try {
      const opis = await baza.dodaj({
        katalog: KONF.katalogBazy, zakres, login: sesja.login,
        nazwa: dane.nazwa, tresc: dane.tresc, konfWektorow: KONF.wektory,
      });
      console.log(`[baza] +${zakres} "${opis.nazwa}" (${opis.fragmentow} fragm., wektory: ${opis.zWektorami})`);
      return odpowiedzJson(res, 200, opis);
    } catch (e) {
      return odpowiedzJson(res, 400, { error: e.message });
    }
  }

  if (sciezka === '/api/baza/usun' && req.method === 'POST') {
    let dane;
    try { dane = JSON.parse((await czytajCialo(req)).toString('utf8')); }
    catch { return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' }); }
    const zakres = dane.zakres === baza.WSPOLNA ? baza.WSPOLNA : 'prywatna';
    if (zakres === baza.WSPOLNA && sesja.rola !== 'admin') {
      return odpowiedzJson(res, 403, { error: 'Z bazy wspólnej usuwa wyłącznie admin' });
    }
    const usuniety = baza.usun({ katalog: KONF.katalogBazy, zakres, login: sesja.login, id: dane.id });
    return odpowiedzJson(res, usuniety ? 200 : 404, usuniety ? { ok: true } : { error: 'Nie znaleziono dokumentu' });
  }

  if (sciezka === '/api/baza/szukaj' && req.method === 'POST') {
    let dane;
    try { dane = JSON.parse((await czytajCialo(req)).toString('utf8')); }
    catch { return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' }); }
    const wynik = await baza.szukaj({
      katalog: KONF.katalogBazy, login: sesja.login,
      zapytanie: String(dane.zapytanie || ''),
      ile: Math.min(Number(dane.ile) || baza.DOMYSLNIE_FRAGMENTOW, 30),
      konfWektorow: KONF.wektory,
    });
    return odpowiedzJson(res, 200, { ...wynik, prompt: baza.doPromptu(wynik) });
  }

  // ─── Dane z OpenSEO ────────────────────────────────────────────────────────
  // Content AI pyta OpenSEO o jego wlasne dane przez serwer MCP kontenera.
  // Domyslna sciezka jest DARMOWA (czyta baze OpenSEO). Narzedzia platne, ktore
  // wolaja DataForSEO, wymagaja jawnego potwierdzenia - patrz openseo-mcp.js.
  if (sciezka.startsWith('/api/seo/')) {
    if (!KONF.openseo.portNasluchu) {
      return odpowiedzJson(res, 501, { error: 'OpenSEO nie jest wdrozone na tym serwerze.' });
    }
    if (!plany.maFunkcje(kontoSesji(sesja), 'openseo')) {
      return odpowiedzJson(res, 402, { error: 'Dane z OpenSEO są dostępne w pakiecie Premium.', funkcja: 'openseo' });
    }
    try {
      return await obsluzSeo(sciezka, req, res, sesja);
    } catch (e) {
      const status = e.status || 502;
      if (status >= 500) console.error('[seo]', e.message);
      return odpowiedzJson(res, status, { error: e.message });
    }
  }

  // Proxy - kazde wywolanie kosztuje, wiec przechodzi przez limit pakietu.
  // Czynnosc jest liczona dopiero po udanej odpowiedzi dostawcy: gdy generowanie
  // padnie na bledzie API, uzytkownik nie traci sztuki z pakietu.
  if (req.method === 'POST') {
    const CZYNNOSCI = {
      '/api': 'artykul',
      '/api/images': 'grafika',
      '/api/tts': 'audio',
      '/api/eleven-tts': 'audio',
      '/api/transcribe': 'transkrypcja',
    };
    const czynnosc = CZYNNOSCI[sciezka];
    if (czynnosc) {
      const odmowa = odmowaLimitu(sesja, czynnosc);
      if (odmowa) return odpowiedzJson(res, 402, odmowa);
    }

    try {
      if (sciezka === '/api') return await proxyTresc(req, res, sesja);
      if (sciezka === '/api/images') return await proxyOpenAiJson(req, res, 'https://api.openai.com/v1/images/generations', sesja, 'grafika');
      if (sciezka === '/api/tts') return await proxyOpenAiJson(req, res, 'https://api.openai.com/v1/audio/speech', sesja, 'audio');
      if (sciezka === '/api/transcribe') return await proxyTranskrypcja(req, res, sesja);
      if (sciezka === '/api/eleven-tts') return await proxyEleven(req, res, sesja);
    } catch (e) {
      console.error(`[proxy] ${sciezka}:`, e.message);
      return odpowiedzJson(res, 502, { error: 'Błąd połączenia z dostawcą API' });
    }
  }

  // Aplikacja i pliki statyczne
  if (sciezka === '/' || sciezka === '/index.html') {
    const html = htmlAplikacji || wczytajAplikacje();
    return odpowiedzTekst(res, 200, html, 'text/html; charset=utf-8');
  }

  return plikStatyczny(res, sciezka);
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

function plikStatyczny(res, sciezka) {
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

  const dane = fs.readFileSync(plik);
  res.writeHead(200, {
    'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream',
    'Content-Length': dane.length,
  });
  res.end(dane);
}

// ─── Start ────────────────────────────────────────────────────────────────────

function start() {
  if (!ROLE.includes('admin')) throw new Error('bledna konfiguracja rol');

  try {
    wczytajAplikacje();
  } catch (e) {
    console.error('BLAD:', e.message);
    process.exit(1);
  }

  const uzytkownicy = wczytajUzytkownikow();
  if (uzytkownicy.length === 0) {
    console.error('BLAD: brak kont. Zaloz pierwsze: node serwer/uzytkownicy.js dodaj <login> admin');
    process.exit(1);
  }

  if (KONF.dostawca === 'nvidia' && !KONF.klucze.nvidia) {
    console.warn('UWAGA: CAI_DOSTAWCA=nvidia, ale brak NVIDIA_KEY - generowanie tresci nie zadziala.');
  }
  if (KONF.dostawca === 'anthropic' && !KONF.klucze.anthropic) {
    console.warn('UWAGA: brak ANTHROPIC_KEY - tresc zadziala tylko dla uzytkownikow z wlasnym kluczem.');
  }

  http.createServer((req, res) => {
    obsluz(req, res).catch((e) => {
      console.error('[serwer]', e.message);
      if (!res.headersSent) odpowiedzTekst(res, 500, 'Blad serwera');
      else res.end();
    });
  }).listen(KONF.port, KONF.host, () => {
    console.log(`Content AI: http://${KONF.host}:${KONF.port}`);
    console.log(`  dostawca tresci: ${KONF.dostawca}${KONF.dostawca === 'nvidia' ? ' (' + KONF.modelNvidia + ')' : ''}`);
    console.log(`  kont: ${uzytkownicy.length}, cookie Secure: ${KONF.cookieSecure ? 'tak' : 'NIE (tylko do testow lokalnych)'}`);
  });

  if (KONF.openseo.portNasluchu) startOpenSeo();
}

/**
 * Drugi port - przed OpenSEO. Osobny nasluch, bo OpenSEO dostaje wlasny host
 * (seo.twojadomena.pl) i wlasny korzen; szczegoly i uzasadnienie w openseo.js.
 */
function startOpenSeo() {
  const brama = openseo.utworz(KONF.openseo, {
    sesjaZadania,
    obslugaLogowania,
    stronaLogowania,
    adresIp,
  });

  const serwer = http.createServer((req, res) => {
    brama.obsluz(req, res).catch((e) => {
      console.error('[openseo]', e.message);
      if (!res.headersSent) odpowiedzTekst(res, 500, 'Blad serwera');
      else res.end();
    });
  });

  serwer.on('upgrade', (req, gniazdo, glowa) => brama.obsluzUpgrade(req, gniazdo, glowa));

  serwer.listen(KONF.openseo.portNasluchu, KONF.host, () => {
    console.log(`OpenSEO za logowaniem: http://${KONF.host}:${KONF.openseo.portNasluchu}`);
    console.log(`  kontener: http://${KONF.openseo.host}:${KONF.openseo.port}`);
    if (!KONF.cookieDomena) {
      console.warn('  UWAGA: bez CAI_COOKIE_DOMENA logowanie nie przechodzi miedzy poddomenami.');
    }
  });
}

if (require.main === module) start();

module.exports = {
  zahaszuj, hasloPasuje, anthropicNaOpenai, openaiNaAnthropic, ROLE,
  PLIK_UZYTKOWNIKOW, wczytajUzytkownikow, zapiszUzytkownikow,
  // Sesje - wystawione do testow; produkcyjnie wola je tylko router.
  utworzSesje, sesjaZadania, zapiszWylogowanie, wylogowane, PLIK_WYLOGOWANYCH,
};
