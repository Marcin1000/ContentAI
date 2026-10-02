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
 * Wlasne endpointy serwera (poza kontraktem workera):
 *   POST /api/prosba-o-dostep -> formularz strony produktowej (bez logowania, CORS) - prosby.js
 *   GET  /api/admin/prosby    -> lista prosb o dostep (admin)
 *   oraz /api/baza, /api/strona, /api/odnosniki, /api/marka, /api/pakiet, /api/seo/* - opis w README
 *
 * Konfiguracja przez zmienne srodowiskowe - patrz serwer/README.md.
 */

'use strict';

const http = require('node:http');
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
  stronaOrigin: lista(process.env.CAI_STRONA_ORIGIN || 'https://content-ai.net'),
};

function liczbaMs(wartosc, domyslnie) {
  const n = Number(wartosc);
  return Number.isFinite(n) && n > 0 ? n : domyslnie;
}

function lista(tekst) {
  return String(tekst || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// ─── Uzytkownicy ──────────────────────────────────────────────────────────────
// Plik JSON: [{ login, hash, sol, rola, utworzony }]. Rola: 'admin' | 'uzytkownik'.
// Admin widzi /api/status i moze zarzadzac kontami; uzytkownik tylko korzysta z aplikacji.

const ROLE = ['admin', 'uzytkownik'];

// Brak pliku = brak kont (start poprosi o pierwsze). Uszkodzony plik to
// BladDanych: zadania dostaja 503, a `uzytkownicy.js dodaj` nie zapisze listy
// z jednym kontem na miejscu calej reszty.
function wczytajUzytkownikow() {
  return pliki.czytajJson(PLIK_UZYTKOWNIKOW, [], pliki.czyTablica);
}

function zapiszUzytkownikow(lista) {
  // 0600 - plik z hashami hasel nie powinien byc czytelny dla innych kont na serwerze
  pliki.zapiszJson(PLIK_UZYTKOWNIKOW, lista, 2);
}

// Login: male litery, cyfry, kropka, podkreslnik, myslnik; 2-40 znakow.
// Baza wiedzy i liczniki trzymaja login w nazwie pliku po oczyszczeniu, wiec
// dwa rozne loginy nie moga dac tej samej nazwy (np. "a b" i "a_b").
const WZOR_LOGINU = /^[a-z0-9._-]{2,40}$/;
function poprawnyLogin(login) {
  return typeof login === 'string' && WZOR_LOGINU.test(login);
}

function zahaszuj(haslo, sol) {
  const s = sol || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(haslo, s, 64).toString('hex');
  return { hash, sol: s };
}

function hasloPasuje(haslo, uzytkownik) {
  const { hash } = zahaszuj(haslo, uzytkownik.sol);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(String(uzytkownik.hash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Konto-atrapa do logowania na nieistniejacy login: scrypt liczy sie zawsze,
// wiec po czasie odpowiedzi nie da sie odroznic istniejacego loginu od zmyslonego.
let ATRAPA_KONTA = null;
function atrapaKonta() {
  if (!ATRAPA_KONTA) {
    ATRAPA_KONTA = zahaszuj(crypto.randomBytes(16).toString('hex'));
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
//   - wylogowanie dopisuje identyfikator sesji do serwer/dane/wylogowane.json,
//   - zmiana hasla, roli albo usuniecie konta podnosi znacznik sesjeOd
//     w pliku kont, co uniewaznia wszystkie starsze sesje tej osoby naraz.

const PLIK_SEKRETU = process.env.CAI_SEKRET_PLIK || path.join(KATALOG, 'dane', 'sekret');
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
 * Identyfikatory sesji wylogowanych recznie. Maly plik, czytany z dysku.
 * Uszkodzony plik to BladDanych, nie pusta lista: pusta oznaczalaby, ze
 * wszystkie uniewaznione sesje znow sa wazne az do wygasniecia.
 */
function wylogowane() {
  return pliki.czytajJson(PLIK_WYLOGOWANYCH, [], pliki.czyTablica);
}

function zapiszWylogowanie(id, wygasa) {
  // Wpisy starsze niz ich wlasne wygasniecie sa juz bez znaczenia - podpisana
  // sesja i tak nie przejdzie kontroli daty. Sprzatamy przy okazji zapisu,
  // zeby plik nie rosl w nieskonczonosc.
  const teraz = Date.now();
  const lista = wylogowane().filter((w) => w.wygasa > teraz);
  lista.push({ id, wygasa });
  pliki.zapiszJson(PLIK_WYLOGOWANYCH, lista);
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
function adresIp(req) {
  const zrodlo = req.socket?.remoteAddress || '';
  if (zPetliZwrotnej(zrodlo)) {
    const realny = req.headers['x-real-ip'];
    if (typeof realny === 'string' && realny.trim()) return realny.trim().slice(0, 64);
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
  if (res.headersSent || res.destroyed) return;
  const tresc = JSON.stringify(dane);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(tresc),
  });
  res.end(tresc);
}

function odpowiedzTekst(res, status, tekst, typ = 'text/plain; charset=utf-8') {
  if (res.headersSent || res.destroyed) return;
  wyslij(res, status, { 'Content-Type': typ }, Buffer.from(tekst, 'utf8'));
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

function ustawNaglowkiBezpieczenstwa(res, sciezka) {
  for (const [k, v] of Object.entries(NAGLOWKI_BEZPIECZENSTWA)) res.setHeader(k, v);
  // Odpowiedzi API i logowania sa osobiste - zadna pamiec podreczna ich nie trzyma.
  if (sciezka === '/api' || sciezka.startsWith('/api/') || sciezka.startsWith('/auth/')) {
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

/**
 * Wysyla bufor, w razie potrzeby spakowany. `gotowe` pozwala podac wersje
 * spakowane wczesniej (pliki statyczne liczymy raz, nie przy kazdym zadaniu).
 */
function wyslij(res, status, naglowki, bufor, gotowe) {
  const typ = String(naglowki['Content-Type'] || '');
  const doKompresji = TYPY_DO_KOMPRESJI.test(typ) && bufor.length > 1024;
  let cialo = bufor;
  const out = { ...naglowki };
  if (doKompresji) {
    out.Vary = 'Accept-Encoding';
    const kod = wybierzKodowanie(res.req);
    if (kod) {
      cialo = (gotowe && gotowe[kod]) || spakuj(bufor, kod);
      out['Content-Encoding'] = kod;
    }
  }
  out['Content-Length'] = cialo.length;
  res.writeHead(status, out);
  res.end(res.req && res.req.method === 'HEAD' ? undefined : cialo);
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

  if (KONF.serp === 'dataforseo') {
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


async function proxyTresc(req, res, sesja, czynnosci = ['wywolanie']) {
  let body;
  try {
    body = JSON.parse((await czytajCialo(req)).toString('utf8'));
  } catch {
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }

  // Granice kosztu: model z listy aplikacji i sufit max_tokens.
  const odmowa = odmowaKosztuTresci(body);
  if (odmowa) {
    return odpowiedzJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: odmowa }, komunikat: odmowa });
  }

  // Zapytanie o kontekst SERP obslugujemy osobno - patrz serwer/serp.js.
  // Rozpoznajemy je po tresci (prompt analizy SERP), a nie po samym narzedziu
  // web_search: to dostaje tez artykul z przelacznikiem sieci i monitor AI.
  if (serp.czyZapytanieSerp(body, req.headers)) {
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
    if (wynik) {
      if (wynik.status < 400 && !res.destroyed) policzUzycie(sesja, 'wywolanie');
      return odpowiedzJson(res, wynik.status, wynik.dane);
    }
    // null = zostaw dotychczasowa sciezke (dostawca anthropic z web_search)
  }

  const h = hamulec(res, dlugieGenerowanie(body, czynnosci) ? KONF.czasy.dlugi : KONF.czasy.tresc);
  try {
    if (KONF.dostawca === 'nvidia') {
      const { klucz } = kluczDoUzycia(req, 'x-api-key', KONF.klucze.nvidia);
      if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak NVIDIA_KEY na serwerze' });
      const { odp, cialo: surowe } = await fetchZHamulcem(KONF.urlNvidia, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + klucz },
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

    const { klucz } = kluczDoUzycia(req, 'x-api-key', KONF.klucze.anthropic);
    if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak ANTHROPIC_KEY na serwerze' });
    const { odp, cialo: tekst } = await fetchZHamulcem(KONF.urlAnthropic, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': klucz,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, h);
    if (!h.klientCzeka()) return undefined;
    if (odp.ok) for (const czynnosc of czynnosci) policzUzycie(sesja, czynnosc);
    return wyslij(res, odp.status, { 'Content-Type': 'application/json; charset=utf-8' }, Buffer.from(tekst, 'utf8'));
  } finally {
    h.zwolnij();
  }
}

async function proxyGrafika(req, res, sesja) {
  const { klucz } = kluczDoUzycia(req, 'x-openai-key', KONF.klucze.openai);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  let body;
  try {
    body = JSON.parse((await czytajCialo(req, 1024 * 1024)).toString('utf8'));
  } catch {
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }
  const odmowa = odmowaKosztuGrafiki(body);
  if (odmowa) return odpowiedzJson(res, 400, { error: { message: odmowa, type: 'invalid_request_error' }, komunikat: odmowa });
  return wolajOpenAi(res, KONF.urlOpenai + '/images/generations', klucz, JSON.stringify({ ...body, n: 1 }),
    'application/json', KONF.czasy.obrazy, sesja, 'grafika');
}

async function proxyOpenAiJson(req, res, url, sesja, czynnosc, czasMs) {
  const { klucz } = kluczDoUzycia(req, 'x-openai-key', KONF.klucze.openai);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const cialo = await czytajCialo(req);
  return wolajOpenAi(res, url, klucz, cialo, 'application/json', czasMs, sesja, czynnosc);
}

async function proxyTranskrypcja(req, res, sesja) {
  const { klucz } = kluczDoUzycia(req, 'x-openai-key', KONF.klucze.openai);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const cialo = await czytajCialo(req);
  return wolajOpenAi(res, KONF.urlOpenai + '/audio/transcriptions', klucz, cialo,
    req.headers['content-type'] || 'multipart/form-data', KONF.czasy.transkrypcja, sesja, 'transkrypcja');
}

/** Wspolna droga do OpenAI: hamulec, liczenie po sukcesie, odpowiedz bez zmian. */
async function wolajOpenAi(res, url, klucz, cialo, typ, czasMs, sesja, czynnosc) {
  const h = hamulec(res, czasMs);
  try {
    const { odp, cialo: bufor } = await fetchZHamulcem(url, {
      method: 'POST',
      headers: { 'Content-Type': typ, Authorization: 'Bearer ' + klucz },
      body: cialo,
    }, h, 'bufor');
    if (!h.klientCzeka()) return undefined;
    if (odp.ok) policzUzycie(sesja, czynnosc);
    return wyslij(res, odp.status, {
      'Content-Type': odp.headers.get('content-type') || 'application/json; charset=utf-8',
    }, bufor);
  } finally {
    h.zwolnij();
  }
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
  const h = hamulec(res, KONF.czasy.audio);
  try {
    const { odp, cialo: bufor } = await fetchZHamulcem(
      KONF.urlEleven + '/text-to-speech/' + encodeURIComponent(glos) + '?output_format=' + encodeURIComponent(format),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': klucz },
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
    return wyslij(res, odp.status, { 'Content-Type': odp.headers.get('content-type') || 'audio/mpeg' }, bufor);
  } finally {
    h.zwolnij();
  }
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
    login: poprawnyLogin(login) ? login : '',
  });
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
  const uzytkownik = wczytajUzytkownikow().find((u) => u.login === login);

  // scrypt liczy sie zawsze, takze dla nieistniejacego loginu - inaczej czas
  // odpowiedzi (1 ms wobec 50 ms) zdradzalby, ktore loginy istnieja.
  const pasuje = hasloPasuje(haslo, uzytkownik || atrapaKonta());
  if (!uzytkownik || !pasuje) {
    nieudanaProba(ip);
    return odpowiedzTekst(res, 401, stronaLogowania('zle-dane', req, jezyk, login), html);
  }

  proby.delete(ip);
  const token = utworzSesje(uzytkownik);
  const ciasteczko = `cai_auth=${token}${atrybutyCiasteczka()}; Max-Age=${KONF.sesjaGodzin * 3600}`;
  res.writeHead(302, { Location: '/', 'Set-Cookie': ciasteczko });
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

async function obsluz(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sciezka = url.pathname;
  const html = 'text/html; charset=utf-8';
  ustawNaglowkiBezpieczenstwa(res, sciezka);

  // ─── Prosba o dostep ze strony produktowej ─────────────────────────────────
  // Jedyny endpoint bez logowania i jedyny wolany z innego pochodzenia
  // (content-ai.net), wiec ma wlasne CORS zamiast kontroli CSRF.
  if (sciezka === '/api/prosba-o-dostep') {
    return prosby.obsluz(req, res, {
      dozwoloneOrigin: KONF.stronaOrigin, adresIp, czytajCialo, odpowiedzJson, typJson,
    });
  }

  // ─── CSRF: zadania zmieniajace stan tylko z naszej strony ──────────────────
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

  // Logowanie
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

  // Wszystko ponizej wymaga zalogowania
  const sesja = sesjaZadania(req);
  if (!sesja) {
    // Endpointy programistyczne odpowiadaja JSON-em; strony - ekranem logowania.
    if (sciezka.startsWith('/api') || sciezka.startsWith('/auth/')) {
      return odpowiedzJson(res, 401, { error: 'Niezalogowany' });
    }
    // Manifest i ikony musza byc dostepne przed zalogowaniem (instalacja PWA,
    // ikona karty na ekranie logowania); nie zawieraja nic osobistego.
    if (czyPublicznyPlik(sciezka)) return plikStatyczny(req, res, sciezka);
    res.setHeader('Cache-Control', 'no-store');
    return odpowiedzTekst(res, 200, stronaLogowania('', req), html);
  }

  if (sciezka === '/auth/me') {
    return odpowiedzJson(res, 200, { login: sesja.login, rola: sesja.rola });
  }

  // Prosby o dostep - lista dla administratora.
  if (sciezka === '/api/admin/prosby' && req.method === 'GET') {
    if (sesja.rola !== 'admin') return odpowiedzJson(res, 403, { error: 'Wymagana rola admin' });
    const ile = Math.min(Math.max(Number(url.searchParams.get('ile')) || 200, 1), 1000);
    const { wpisy, pominiete } = prosby.lista(ile);
    return odpowiedzJson(res, 200, { prosby: wpisy, pominiete });
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

  // ─── Konfiguracja marki ────────────────────────────────────────────────────
  // Jedna dla calego wdrozenia: czytaja wszyscy, pisze administrator.
  // Wczesniej siedziala w localStorage przegladarki, wiec kazdy uzytkownik
  // mial wlasna kopie, a nowa osoba w zespole zaczynala od pustej.
  if (sciezka === '/api/marka' && req.method === 'GET') {
    return odpowiedzJson(res, 200, { marka: marka.wczytaj(KONF.katalogMarki) });
  }

  if (sciezka === '/api/marka' && req.method === 'POST') {
    if (sesja.rola !== 'admin') {
      return odpowiedzJson(res, 403, { error: 'Konfiguracje marki zmienia administrator' });
    }
    let dane;
    try {
      // Po oczyszczeniu konfiguracja ma najwyzej okolo 18 kB - 64 kB to zapas
      // na formatowanie JSON-a, nie zaproszenie do wysylania czegokolwiek.
      dane = await cialoJson(req, 64 * 1024);
    } catch (e) {
      return odpowiedzJson(res, e.status || 400, { error: e.message });
    }
    return odpowiedzJson(res, 200, { marka: marka.zapisz(KONF.katalogMarki, dane) });
  }

  // ─── Pobranie strony WWW do bazy wiedzy ────────────────────────────────────
  // Zwyklym zadaniem HTTP, bez modelu. Nie liczy sie do pakietu, bo nie
  // kosztuje ani jednego tokenu.
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
    try {
      return odpowiedzJson(res, 200, await strona.pobierz(String(dane.adres || '')));
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
  // odpowiedzi. Serwer moze. Nie liczy sie do pakietu - to samo HTTP.
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
    return odpowiedzJson(res, 200, { odnosniki: await strona.sprawdzOdnosniki(adresy) });
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
      if (e instanceof pliki.BladDanych) throw e;
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
      // Aplikacja sprawdza te liste przy kazdym starcie, zeby wiedziec, czy
      // pokazac przycisk OpenSEO. 501 zostawial czerwony blad w konsoli przy
      // kazdym wejsciu - brak OpenSEO to normalny stan, a nie awaria.
      if (sciezka === '/api/seo/projekty' && req.method === 'GET') {
        return odpowiedzJson(res, 200, { projekty: [], dostepne: false });
      }
      return odpowiedzJson(res, 501, { error: 'OpenSEO nie jest wdrozone na tym serwerze.' });
    }
    if (!plany.maFunkcje(kontoSesji(sesja), 'openseo')) {
      return odpowiedzJson(res, 402, { error: 'Dane z OpenSEO są dostępne w pakiecie Premium.', funkcja: 'openseo' });
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
  if (req.method === 'POST') {
    const CZYNNOSCI = {
      '/api/images': 'grafika',
      '/api/tts': 'audio',
      '/api/eleven-tts': 'audio',
      '/api/transcribe': 'transkrypcja',
    };
    // /api obsluguje zarowno artykul, jak i wywolania pomocnicze - patrz czynnosciTresci()
    const czynnosci = sciezka === '/api' ? czynnosciTresci(req) : [CZYNNOSCI[sciezka]];
    for (const czynnosc of czynnosci) {
      if (!czynnosc) continue;
      const odmowa = odmowaLimitu(sesja, czynnosc);
      if (odmowa) return odpowiedzJson(res, 402, odmowa);
    }

    try {
      if (sciezka === '/api') return await proxyTresc(req, res, sesja, czynnosci);
      if (sciezka === '/api/images') return await proxyGrafika(req, res, sesja);
      if (sciezka === '/api/tts') return await proxyOpenAiJson(req, res, KONF.urlOpenai + '/audio/speech', sesja, 'audio', KONF.czasy.audio);
      if (sciezka === '/api/transcribe') return await proxyTranskrypcja(req, res, sesja);
      if (sciezka === '/api/eleven-tts') return await proxyEleven(req, res, sesja);
    } catch (e) {
      if (e instanceof KlientOdszedl) {
        // Przegladarka zamknela polaczenie - wywolanie dostawcy przerwane,
        // nic nie liczymy i nie ma komu odpowiadac.
        console.log(`[proxy] ${sciezka}: klient odszedl, wywolanie dostawcy przerwane`);
        return undefined;
      }
      if (e instanceof BladCzasu) {
        console.error(`[proxy] ${sciezka}: ${e.message}`);
        return odpowiedzCzasu(res, e);
      }
      if (e instanceof pliki.BladDanych) throw e;
      console.error(`[proxy] ${sciezka}:`, e.message);
      return odpowiedzJson(res, 502, { error: 'Błąd połączenia z dostawcą API' });
    }
  }

  // Aplikacja i pliki statyczne
  if (sciezka === '/' || sciezka === '/index.html') {
    const id = idKonta(sesja.login);
    // Strona zawiera identyfikator konta - nie moze trafic do wspolnej pamieci podrecznej.
    res.setHeader('Cache-Control', 'private, no-store');
    // HTML jest staly w obrebie procesu, rozni sie tylko identyfikatorem konta,
    // wiec gotowa i spakowana wersje trzymamy per konto (pakowanie to ~30 ms).
    let wpis = PAMIEC_STRONY.get(id);
    if (!wpis) {
      wpis = { dane: Buffer.from((htmlAplikacji || wczytajAplikacje()).split(PLACEHOLDER_KONTO).join(id), 'utf8'), spakowane: {} };
      if (PAMIEC_STRONY.size >= 200) PAMIEC_STRONY.delete(PAMIEC_STRONY.keys().next().value);
      PAMIEC_STRONY.set(id, wpis);
    }
    const kod = wybierzKodowanie(req);
    if (kod && !wpis.spakowane[kod]) wpis.spakowane[kod] = spakuj(wpis.dane, kod);
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
  // Wersje spakowane liczymy raz, z najwyzsza jakoscia brotli - plik sie nie zmienia.
  const kod = TYPY_DO_KOMPRESJI.test(naglowki['Content-Type']) && wpis.dane.length > 1024 ? wybierzKodowanie(req) : null;
  if (kod && !wpis.spakowane[kod]) wpis.spakowane[kod] = spakuj(wpis.dane, kod, 11);
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

/** Serwer aplikacji bez nasluchu - start() go uruchamia, testy stawiaja na porcie 0. */
function utworzSerwer() {
  return http.createServer((req, res) => {
    obsluz(req, res).catch((e) => odpowiedzNaBlad(req, res, e, 'serwer'));
  });
}

function start() {
  if (!ROLE.includes('admin')) throw new Error('bledna konfiguracja rol');

  try {
    wczytajAplikacje();
  } catch (e) {
    console.error('BLAD:', e.message);
    process.exit(1);
  }

  let uzytkownicy;
  try {
    uzytkownicy = wczytajUzytkownikow();
  } catch (e) {
    console.error('BLAD:', e.message);
    process.exit(1);
  }
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

  utworzSerwer().listen(KONF.port, KONF.host, () => {
    console.log(`Content AI: http://${KONF.host}:${KONF.port}`);
    console.log(`  dostawca tresci: ${KONF.dostawca}${KONF.dostawca === 'nvidia' ? ' (' + KONF.modelNvidia + ')' : ''}`);
    console.log(`  kont: ${uzytkownicy.length}, cookie Secure: ${KONF.cookieSecure ? 'tak' : 'NIE (tylko do testow lokalnych)'}`);
    console.log(`  modele: ${[...DOZWOLONE.modele].join(', ')}; max_tokens <= ${KONF.maxTokens}; kompresja: ${KONF.kompresja ? 'tak' : 'nie'}`);
  });

  if (KONF.openseo.portNasluchu) startOpenSeo();
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
    maDostepDoOpenSeo: (konto) => konto.rola === 'admin' || plany.maFunkcje(konto, 'openseo'),
    stronaBezPakietu: (req) => logowanie.stronaOpenSeoBezPakietu(jezykZadania(req)),
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
  utworzBrameOpenSeo().listen(KONF.openseo.portNasluchu, KONF.host, () => {
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
  zahaszuj, hasloPasuje, anthropicNaOpenai, openaiNaAnthropic, ROLE,
  PLIK_UZYTKOWNIKOW, wczytajUzytkownikow, zapiszUzytkownikow, poprawnyLogin, WZOR_LOGINU,
  // Sesje - wystawione do testow; produkcyjnie wola je tylko router.
  utworzSesje, sesjaZadania, zapiszWylogowanie, wylogowane, PLIK_WYLOGOWANYCH,
  czynnosciTresci, parsujCiasteczka, adresIp, obcePochodzenie, jezykZadania,
  // Serwer do testow integracyjnych (port 0, bez start()).
  utworzSerwer, utworzBrameOpenSeo, wczytajAplikacje, KONF, DOZWOLONE, CSP,
};
