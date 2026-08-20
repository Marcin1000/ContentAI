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
  wektory: {
    klucz: process.env.NVIDIA_KEY || '',
    url: process.env.CAI_URL_EMBED || 'https://integrate.api.nvidia.com/v1/embeddings',
    model: process.env.CAI_MODEL_EMBED || 'nvidia/nv-embedqa-e5-v5',
  },

  // Zrodlo danych SERP: 'model' (model z web_search, tylko Anthropic) albo 'dataforseo'
  serp: (process.env.CAI_SERP || 'model').toLowerCase(),
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
// W pamieci - restart serwera wylogowuje wszystkich. Swiadomy wybor: brak zaleznosci,
// a ponowne zalogowanie kosztuje uzytkownika kilka sekund.

const sesje = new Map(); // token -> { login, rola, wygasa }

function utworzSesje(uzytkownik) {
  const token = crypto.randomBytes(32).toString('hex');
  sesje.set(token, {
    login: uzytkownik.login,
    rola: uzytkownik.rola,
    wygasa: Date.now() + KONF.sesjaGodzin * 3600_000,
  });
  return token;
}

function sesjaZadania(req) {
  const ciasteczka = parsujCiasteczka(req.headers.cookie || '');
  const token = ciasteczka.cai_auth;
  if (!token) return null;
  const s = sesje.get(token);
  if (!s) return null;
  if (s.wygasa < Date.now()) {
    sesje.delete(token);
    return null;
  }
  return { ...s, token };
}

function parsujCiasteczka(naglowek) {
  const out = {};
  for (const czesc of naglowek.split(';')) {
    const i = czesc.indexOf('=');
    if (i > 0) out[czesc.slice(0, i).trim()] = decodeURIComponent(czesc.slice(i + 1).trim());
  }
  return out;
}

// Sprzatanie wygaslych sesji co godzine, zeby mapa nie rosla w nieskonczonosc
setInterval(() => {
  const teraz = Date.now();
  for (const [token, s] of sesje) if (s.wygasa < teraz) sesje.delete(token);
}, 3600_000).unref();

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
    console.error(`[serp] dostawca ${KONF.dostawca} nie obsluguje web_search; ustaw CAI_SERP=dataforseo`);
    return {
      status: 501,
      dane: {
        content: [],
        error: { komunikat: 'Analiza SERP wymaga dostawcy anthropic albo CAI_SERP=dataforseo' },
      },
    };
  }

  return null;
}

async function proxyTresc(req, res) {
  let body;
  try {
    body = JSON.parse((await czytajCialo(req)).toString('utf8'));
  } catch {
    return odpowiedzJson(res, 400, { error: 'Niepoprawny JSON' });
  }

  // Zapytanie o kontekst SERP obslugujemy osobno - patrz serwer/serp.js
  if (serp.czyZapytanieSerp(body)) {
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
  res.writeHead(odp.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(tekst);
}

async function proxyOpenAiJson(req, res, url) {
  const { klucz } = kluczDoUzycia(req, 'x-openai-key', KONF.klucze.openai);
  if (!klucz) return odpowiedzJson(res, 500, { error: 'Brak OPENAI_KEY na serwerze' });
  const cialo = await czytajCialo(req);
  const odp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + klucz },
    body: cialo,
  });
  const bufor = Buffer.from(await odp.arrayBuffer());
  res.writeHead(odp.status, {
    'Content-Type': odp.headers.get('content-type') || 'application/json; charset=utf-8',
    'Content-Length': bufor.length,
  });
  res.end(bufor);
}

async function proxyTranskrypcja(req, res) {
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
  res.writeHead(odp.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(tekst);
}

async function proxyEleven(req, res) {
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

// ─── Router ───────────────────────────────────────────────────────────────────

async function obsluz(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sciezka = url.pathname;

  // Logowanie
  if (sciezka === '/auth/login' && req.method === 'POST') {
    return obslugaLogowania(req, res);
  }

  if (sciezka === '/auth/logout') {
    const s = sesjaZadania(req);
    if (s) sesje.delete(s.token);
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
      cookieDomena: Boolean(KONF.cookieDomena),
      uzytkownikow: wczytajUzytkownikow().length,
      aktywnychSesji: sesje.size,
    });
  }

  // ─── Baza wiedzy ───────────────────────────────────────────────────────────
  if (sciezka === '/api/baza' && req.method === 'GET') {
    return odpowiedzJson(res, 200, { dokumenty: baza.lista({ katalog: KONF.katalogBazy, login: sesja.login }) });
  }

  if (sciezka === '/api/baza' && req.method === 'POST') {
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

  // Proxy
  if (req.method === 'POST') {
    try {
      if (sciezka === '/api') return await proxyTresc(req, res);
      if (sciezka === '/api/images') return await proxyOpenAiJson(req, res, 'https://api.openai.com/v1/images/generations');
      if (sciezka === '/api/tts') return await proxyOpenAiJson(req, res, 'https://api.openai.com/v1/audio/speech');
      if (sciezka === '/api/transcribe') return await proxyTranskrypcja(req, res);
      if (sciezka === '/api/eleven-tts') return await proxyEleven(req, res);
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
};

function plikStatyczny(res, sciezka) {
  // Tylko manifest i ikony PWA; reszta katalogu nie jest publiczna.
  const dozwolone = /^\/(manifest\.json|icons\/[A-Za-z0-9._-]+)$/;
  if (!dozwolone.test(sciezka)) return odpowiedzTekst(res, 404, 'Nie znaleziono');

  const plik = path.join(APP, 'pwa', sciezka);
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

module.exports = { zahaszuj, hasloPasuje, anthropicNaOpenai, openaiNaAnthropic, ROLE, PLIK_UZYTKOWNIKOW, wczytajUzytkownikow, zapiszUzytkownikow };
