'use strict';

// ─── Wlasne klucze uzytkownikow (BYOK): ciasteczka, wybor klucza, /api/klucze ──
//
// Decyzje: ARCH8-10..12 (PROJEKT-TECHNICZNY), SEC8-03, SEC8-04, SEC8-10 i M-10
// (DECYZJE-R9). Kontrakt: AG/runda9/WYKONANIE-A0.md 3.10.
//
// Gdzie lezy klucz uzytkownika: w zaszyfrowanym ciasteczku HttpOnly w jego
// przegladarce (AES-256-GCM, klucz szyfru CAI_KLUCZ_CIASTEK tylko na serwerze).
// Serwer odszyfrowuje go w pamieci na czas jednego wywolania dostawcy i nigdzie
// go nie zapisuje. Skrypt na stronie go nie odczyta (HttpOnly), Caddy go nie
// wypisze (naglowek Cookie jest w dzienniku ukryty), a inne konto na tym samym
// komputerze go nie odszyfruje (dane dodatkowe szyfru zawieraja login konta).
//
// Ciasteczka: cai_k_<skrot> (z przedrostkiem __Secure- przy CAI_COOKIE_SECURE=1),
// Path=/api, HttpOnly, SameSite=Strict, bez Domain (nie trafia do seo. ani na strone
// produktowa). "Zapamietaj na tym urzadzeniu" (domyslnie wlaczone) = Max-Age 30 dni,
// inaczej ciasteczko sesyjne. Wartosc: v1.<base64url(iv 12 B | szyfrogram | tag 16 B)>,
// a szyfrogram to JSON { d: { <pole>: <wartosc> }, z: 0|1, t: <ms zapisu> }.
// Dane dodatkowe szyfru (AAD): cai-klucze|v1|<login>|<sesjeOd>|<skrot>. Skutki:
//   - zwykle wylogowanie NIE usuwa kluczy (M-10): nowa sesja tego konta je czyta,
//   - "Wyloguj wszedzie", zmiana i reset hasla podnosza sesjeOd konta, wiec
//     zapamietane klucze traca waznosc na WSZYSTKICH urzadzeniach naraz (bez listy
//     po stronie serwera); na biezacym urzadzeniu A1 dokleja ciasteczkaUsuwajace(),
//   - usuniecie konta: nie ma konta, nie ma czym odszyfrowac,
//   - zmiana CAI_KLUCZ_CIASTEK uniewaznia wszystkie zapamietane klucze (awaryjnie).
//
// Wybor klucza (kluczDla): konto 'wlasne' (i kazde bez jawnego 'serwera') bierze
// WYLACZNIE klucz z ciasteczka - ta galaz nie zna klucza serwera. Konto 'serwera':
// ciasteczko, potem przejsciowo naglowek x-*-key (aplikacja z R8), na koncu klucz
// serwera jak dzis. Klucz uzytkownika Anthropic idzie zawsze do Anthropic, nigdy do
// NVIDIA (SEC8-03); NVIDIA dostaje tylko klucz serwera przy CAI_DOSTAWCA=nvidia.
//
// Trasy (za logowaniem, z kontrola CSRF i Content-Type JSON routera):
//   GET    /api/klucze               stan: { zrodloKluczy, zapis, dostawcy, anthropic: { ustawiony, koncowka,
//                                     zapamietany, wygasa? }, openai: {...}, eleven: {...} } - nigdy caly klucz
//   POST   /api/klucze               { dostawca, klucz, zapamietaj?, sprawdz? } albo { anthropic?, openai?,
//                                     eleven?, zapamietaj? }: format (SEC8-03), opcjonalnie test u dostawcy,
//                                     Set-Cookie; odpowiedz jak GET z { ok: true }
//   DELETE /api/klucze?dostawca=     anthropic|openai|eleven (albo a|o|e) | wszystkie (domyslnie)
//   POST   /api/klucze/usun          { dostawca } - to samo dla klientow bez DELETE
//   POST   /api/klucze/sprawdz       { dostawca, klucz? } (bez klucza: naglowek x-*-key, potem zapisany):
//                                     darmowy odczyt u dostawcy, 10 na minute na konto
//                                     -> { ok, dostawca, powod?: zly-klucz|brak-uprawnien|dostawca-niedostepny|brak-klucza }
//
// Czwarty dostawca (DECYZJE-R9, "OpenSEO i DataForSEO", dopiero po premierze): wlasne
// konto DataForSEO to para login + haslo API zamiast jednego klucza. Wchodzi jednym
// wpisem w DOSTAWCY_OPIS (skrot 'd', pola ['login', 'haslo'], format kazdego pola,
// sprawdzenie GET /v3/appendix/user_data) i jednym w KLUCZE_SERWERA (para z
// KONF.dataForSeo dla kont 'serwera'). Szyfr, ciasteczko cai_k_d, POST /api/klucze
// ({ dostawca: 'dataforseo', login, haslo } albo { dataforseo: { login, haslo } }), stan
// z koncowka loginu i usuwanie dzialaja bez zmian; kluczDla(req, konto, 'dataforseo', KONF)
// zwraca { dane: { login, haslo }, czyj, cel } prosto do serp.zDataForSeo. Wzor wpisow
// jest nizej (zakomentowany).

const crypto = require('node:crypto');
const limity = require('./limity.js');

const WERSJA = 'v1';
const MAX_AGE_ZAPAMIETAJ = 30 * 24 * 3600;      // s, "Zapamietaj na tym urzadzeniu" (M-10)
const CZAS_SPRAWDZENIA_MS = 10_000;
const LIMIT_CIALA = 16 * 1024;

// Naglowek klucza z aplikacji R8: dzis tylko przejsciowo, tylko dla kont 'serwera'.
const NAGLOWEK = { anthropic: 'x-api-key', openai: 'x-openai-key', eleven: 'x-eleven-key' };

/**
 * Opis dostawcow. Nowy dostawca = nowy wpis tutaj (i w KLUCZE_SERWERA), bez zmian
 * w reszcie modulu:
 *   skrot        litera w nazwie ciasteczka i w danych dodatkowych szyfru (nigdy nie zmieniac)
 *   nazwa        do komunikatow
 *   pola         nazwy pol sekretu: ['klucz'] albo np. ['login', 'haslo']
 *   format       { pole: RegExp } - kontrola przy zapisie i przed kazdym uzyciem (SEC8-03)
 *   zakazane     [{ wzor, powod }] dla pierwszego pola (klucz administracyjny, cudzy dostawca)
 *   wskazowka    poczatek klucza do komunikatu o zlym formacie
 *   sprawdzenie  (dane, konf) -> { url, naglowki }: darmowy odczyt u dostawcy (bez kosztu)
 */
const DOSTAWCY_OPIS = {
  anthropic: {
    skrot: 'a',
    nazwa: 'Anthropic',
    pola: ['klucz'],
    format: { klucz: /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,300}$/ },
    zakazane: [{ wzor: /^sk-ant-admin/i, powod: 'administracyjny' }],
    wskazowka: 'sk-ant-api',
    sprawdzenie: (dane, konf) => ({
      url: String(konf.urlAnthropic || 'https://api.anthropic.com/v1/messages').replace(/\/messages\/?$/, '') + '/models?limit=1',
      naglowki: { 'x-api-key': dane.klucz, 'anthropic-version': '2023-06-01' },
    }),
  },
  openai: {
    skrot: 'o',
    nazwa: 'OpenAI',
    pola: ['klucz'],
    format: { klucz: /^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,300}$/ },
    // sk-ant-... tez pasuje do ogolnego wzoru OpenAI: klucz Anthropic wklejony w zle pole
    // poszedlby do OpenAI (SEC8-03), wiec odrzucamy go wprost.
    zakazane: [{ wzor: /^sk-admin-/i, powod: 'administracyjny' }, { wzor: /^sk-ant-/i, powod: 'inny-dostawca' }],
    wskazowka: 'sk-proj-',
    sprawdzenie: (dane, konf) => ({
      url: String(konf.urlOpenai || 'https://api.openai.com/v1') + '/models',
      naglowki: { Authorization: 'Bearer ' + dane.klucz },
    }),
  },
  eleven: {
    skrot: 'e',
    nazwa: 'ElevenLabs',
    pola: ['klucz'],
    format: { klucz: /^(?:sk_[a-f0-9]{40,64}|[a-f0-9]{32})$/ },
    zakazane: [],
    wskazowka: 'sk_',
    sprawdzenie: (dane, konf) => ({
      url: String(konf.urlEleven || 'https://api.elevenlabs.io/v1') + '/user',
      naglowki: { 'xi-api-key': dane.klucz },
    }),
  },
  // Po premierze (DECYZJE-R9): wlasne konto DataForSEO klienta, para login + haslo API.
  // dataforseo: {
  //   skrot: 'd',
  //   nazwa: 'DataForSEO',
  //   pola: ['login', 'haslo'],
  //   format: { login: /^[^\s:]{3,100}$/, haslo: /^[\x21-\x7e]{8,100}$/ },
  //   zakazane: [],
  //   wskazowka: 'login i haslo API z panelu DataForSEO',
  //   sprawdzenie: (dane) => ({
  //     url: 'https://api.dataforseo.com/v3/appendix/user_data',
  //     naglowki: { Authorization: 'Basic ' + Buffer.from(`${dane.login}:${dane.haslo}`).toString('base64') },
  //   }),
  // },
};
const DOSTAWCY = Object.keys(DOSTAWCY_OPIS);
const PO_SKROCIE = Object.fromEntries(DOSTAWCY.map((d) => [DOSTAWCY_OPIS[d].skrot, d]));

/**
 * Klucze serwera. Wolane WYLACZNIE z galezi konta zrodloKluczy='serwera' w kluczDla
 * (i dla informacji kluczSerwera w stanie takiego konta) - konto 'wlasne' tu nie dochodzi.
 */
const KLUCZE_SERWERA = {
  anthropic: (konf) => (konf.dostawca === 'nvidia'
    ? { klucz: konf.klucze.nvidia, cel: 'nvidia' }
    : { klucz: konf.klucze.anthropic, cel: 'anthropic' }),
  openai: (konf) => ({ klucz: konf.klucze.openai, cel: 'openai' }),
  eleven: (konf) => ({ klucz: konf.klucze.eleven, cel: 'eleven' }),
  // dataforseo: (konf) => ({ dane: { login: konf.dataForSeo.login, haslo: konf.dataForSeo.haslo }, cel: 'dataforseo' }),
};

// Trasa proxy -> dostawca, ktorego klucz jest potrzebny (szybka kontrola w routerze).
const DOSTAWCA_TRASY = {
  '/api': 'anthropic',
  '/api/images': 'openai',
  '/api/tts': 'openai',
  '/api/transcribe': 'openai',
  '/api/eleven-tts': 'eleven',
};

const STAN = { konf: null, zapisow: 0, usuniec: 0, sprawdzen: 0 };

// ─── Ciasteczka i szyfr ──────────────────────────────────────────────────────

function kluczSzyfru(konf) {
  const k = konf && konf.kluczCiastek;
  return k && k.poprawny && Buffer.isBuffer(k.klucz) && k.klucz.length === 32 ? k.klucz : null;
}

function nazwaCiasteczka(dostawca, konf) {
  return `${konf && konf.cookieSecure ? '__Secure-' : ''}cai_k_${DOSTAWCY_OPIS[dostawca].skrot}`;
}

function atrybuty(konf) {
  return `; Path=/api; HttpOnly; SameSite=Strict${konf && konf.cookieSecure ? '; Secure' : ''}`;
}

function daneDodatkowe(konto, dostawca) {
  return Buffer.from(`cai-klucze|${WERSJA}|${konto.login}|${Number(konto.sesjeOd) || 0}|${DOSTAWCY_OPIS[dostawca].skrot}`, 'utf8');
}

function zaszyfruj(obiekt, klucz, aad) {
  const iv = crypto.randomBytes(12);
  const szyfr = crypto.createCipheriv('aes-256-gcm', klucz, iv);
  szyfr.setAAD(aad);
  const tresc = Buffer.concat([szyfr.update(JSON.stringify(obiekt), 'utf8'), szyfr.final()]);
  return `${WERSJA}.${Buffer.concat([iv, tresc, szyfr.getAuthTag()]).toString('base64url')}`;
}

/** Odszyfrowany obiekt albo null (zly tag, inne konto, inny klucz szyfru, smiec). */
function odszyfruj(wartosc, klucz, aad) {
  const s = String(wartosc || '');
  if (!s.startsWith(`${WERSJA}.`) || s.length > 4096) return null;
  try {
    const b = Buffer.from(s.slice(WERSJA.length + 1), 'base64url');
    if (b.length < 12 + 16 + 2) return null;
    const odszyfr = crypto.createDecipheriv('aes-256-gcm', klucz, b.subarray(0, 12));
    odszyfr.setAAD(aad);
    odszyfr.setAuthTag(b.subarray(b.length - 16));
    const tekst = Buffer.concat([odszyfr.update(b.subarray(12, b.length - 16)), odszyfr.final()]).toString('utf8');
    const obiekt = JSON.parse(tekst);
    return obiekt && typeof obiekt === 'object' ? obiekt : null;
  } catch {
    return null;
  }
}

/** Ciasteczka z naglowka; przy powtorzonej nazwie wygrywa pierwsze (najdokladniejsza sciezka). */
function ciasteczka(naglowek) {
  const wynik = Object.create(null);
  for (const czesc of String(naglowek || '').split(';')) {
    const i = czesc.indexOf('=');
    if (i <= 0) continue;
    const nazwa = czesc.slice(0, i).trim();
    if (!(nazwa in wynik)) wynik[nazwa] = czesc.slice(i + 1).trim();
  }
  return wynik;
}

/** Naglowek Set-Cookie z zaszyfrowanym sekretem dostawcy dla konta. */
function ciasteczkoZKluczem(dostawca, dane, konto, konf, zapamietaj, teraz = Date.now()) {
  const klucz = kluczSzyfru(konf);
  if (!klucz) throw new Error('klucze: brak poprawnego CAI_KLUCZ_CIASTEK');
  const wartosc = zaszyfruj({ d: dane, z: zapamietaj ? 1 : 0, t: teraz }, klucz, daneDodatkowe(konto, dostawca));
  return `${nazwaCiasteczka(dostawca, konf)}=${wartosc}${atrybuty(konf)}${zapamietaj ? `; Max-Age=${MAX_AGE_ZAPAMIETAJ}` : ''}`;
}

/**
 * Naglowki Set-Cookie kasujace ciasteczka z kluczami (domyslnie wszystkie). A1 dokleja je
 * przy "Wyloguj wszedzie", zmianie i resecie hasla oraz usunieciu konta; zwykle
 * wylogowanie ich NIE dokleja (M-10).
 */
function ciasteczkaUsuwajace(konf, dostawcy = DOSTAWCY) {
  return dostawcy.map((d) => `${nazwaCiasteczka(d, konf)}=${atrybuty(konf)}; Max-Age=0`);
}

// ─── Format kluczy (SEC8-03) ─────────────────────────────────────────────────

/** null, gdy sekret ma poprawny format; inaczej { powod: 'format'|'administracyjny'|'inny-dostawca', pole }. */
function zlyFormat(dostawca, dane) {
  const opis = DOSTAWCY_OPIS[dostawca];
  if (!opis || !dane || typeof dane !== 'object') return { powod: 'format', pole: null };
  for (const pole of opis.pola) {
    const w = dane[pole];
    if (typeof w !== 'string' || !w) return { powod: 'format', pole };
    if (pole === opis.pola[0]) {
      const zakaz = opis.zakazane.find((z) => z.wzor.test(w));
      if (zakaz) return { powod: zakaz.powod, pole };
    }
    if (!opis.format[pole].test(w)) return { powod: 'format', pole };
  }
  return null;
}

const KOMUNIKATY_FORMATU = {
  pl: {
    format: (o) => `To nie jest klucz ${o.nazwa}. Sprawdź, czy skopiowano cały klucz (zaczyna się od ${o.wskazowka}).`,
    administracyjny: (o) => `To klucz administracyjny ${o.nazwa}. Wklej zwykły klucz API, bez uprawnień do zarządzania kontem.`,
    'inny-dostawca': (o) => `To wygląda na klucz innego dostawcy. W tym polu wklej klucz ${o.nazwa} (zaczyna się od ${o.wskazowka}).`,
  },
  en: {
    format: (o) => `This is not a ${o.nazwa} API key. Check that the whole key was copied (it starts with ${o.wskazowka}).`,
    administracyjny: (o) => `This is a ${o.nazwa} admin key. Paste a regular API key without account management permissions.`,
    'inny-dostawca': (o) => `This looks like another provider's key. Paste your ${o.nazwa} key here (it starts with ${o.wskazowka}).`,
  },
};

function komunikatFormatu(dostawca, powod, jezyk) {
  const zestaw = KOMUNIKATY_FORMATU[jezyk === 'en' ? 'en' : 'pl'];
  return (zestaw[powod] || zestaw.format)(DOSTAWCY_OPIS[dostawca]);
}

// ─── Odczyt klucza ───────────────────────────────────────────────────────────

/**
 * Sekret dostawcy z ciasteczka konta:
 *   null                                 brak ciasteczka (albo zapis kluczy wylaczony)
 *   { niewazne: true }                   jest, ale sie nie odszyfruje (inne konto, "wyloguj wszedzie",
 *                                        zmiana hasla, zmieniony CAI_KLUCZ_CIASTEK) albo ma zly format
 *   { dane, zapamietany, od }            sekret do uzycia
 */
function zCiasteczka(req, konto, dostawca, konf) {
  if (!konto || !konto.login) return null;
  const klucz = kluczSzyfru(konf);
  if (!klucz) return null;
  const surowe = ciasteczka(req && req.headers && req.headers.cookie)[nazwaCiasteczka(dostawca, konf)];
  if (!surowe) return null;
  const tresc = odszyfruj(surowe, klucz, daneDodatkowe(konto, dostawca));
  if (!tresc || !tresc.d || typeof tresc.d !== 'object') return { niewazne: true };
  const dane = {};
  for (const pole of DOSTAWCY_OPIS[dostawca].pola) dane[pole] = tresc.d[pole];
  if (zlyFormat(dostawca, dane)) return { niewazne: true };
  return { dane, zapamietany: Boolean(tresc.z), od: Number(tresc.t) || null };
}

/**
 * Klucz z naglowka x-*-key (aplikacja z R8). Tylko po trim(), bez prefiksu WSTAW,
 * drukowalne ASCII bez spacji, 20-300 znakow: naglowek idzie dalej do dostawcy.
 */
function kluczZNaglowka(req, dostawca) {
  const nazwa = NAGLOWEK[dostawca];
  const wartosc = nazwa && req && req.headers ? req.headers[nazwa] : undefined;
  if (typeof wartosc !== 'string') return '';
  const t = wartosc.trim();
  if (!t || t.startsWith('WSTAW') || !/^[\x21-\x7e]{20,300}$/.test(t)) return '';
  return t;
}

/**
 * Klucz do jednego wywolania dostawcy.
 *   -> { klucz, dane, czyj: 'uzytkownika'|'serwera', cel: 'anthropic'|'nvidia'|'openai'|'eleven', zrodlo }
 *    | { blad: { kod: 'brak-klucza', status: 403, dostawca, niewazny? } }
 * Konto 'wlasne' NIGDY nie dostaje klucza serwera: jego galaz konczy sie przed
 * jakimkolwiek odwolaniem do KONF.klucze.
 */
function kluczDla(req, konto, dostawca, konf) {
  if (!DOSTAWCY_OPIS[dostawca]) throw new Error(`klucze.kluczDla: nieznany dostawca "${dostawca}"`);
  const wlasny = zCiasteczka(req, konto, dostawca, konf);
  if (wlasny && wlasny.dane) {
    return { klucz: wlasny.dane.klucz, dane: wlasny.dane, czyj: 'uzytkownika', cel: dostawca, zrodlo: 'ciasteczko' };
  }
  // Konto na wlasnych kluczach - i kazde, ktore nie ma jawnie 'serwera' (bezpieczny domysl).
  if (!konto || konto.zrodloKluczy !== 'serwera') {
    const blad = { kod: 'brak-klucza', status: 403, dostawca };
    if (wlasny && wlasny.niewazne) blad.niewazny = true;
    return { blad };
  }
  // Konto 'serwera' (zespol): przejsciowo klucz z naglowka, potem klucz serwera jak dzis.
  const zNaglowka = kluczZNaglowka(req, dostawca);
  if (zNaglowka) return { klucz: zNaglowka, dane: { klucz: zNaglowka }, czyj: 'uzytkownika', cel: dostawca, zrodlo: 'naglowek' };
  const s = KLUCZE_SERWERA[dostawca](konf);
  return { klucz: s.klucz || '', dane: s.dane || { klucz: s.klucz || '' }, czyj: 'serwera', cel: s.cel, zrodlo: 'serwer' };
}

/**
 * Szybka kontrola w routerze, przed limitem pakietu i zadaniem w tle: konto bez
 * uzywalnego klucza dostaje 403 od razu, a nie jako wynik zadania.
 *   -> null | { kod: 'brak-klucza', status: 403, dostawca, niewazny? }
 */
function brakKlucza(sciezka, req, konto, konf) {
  const dostawca = DOSTAWCA_TRASY[sciezka];
  if (!dostawca) return null;
  const k = kluczDla(req, konto, dostawca, konf);
  return k.blad ? { ...k.blad } : null;
}

/** Czy odpowiedz dostawcy to odrzucenie klucza uzytkownika (401, 403 z brakiem uprawnien). */
function odrzucenieKlucza(status, cialo) {
  if (status === 401) return true;
  if (status !== 403) return false;
  const tekst = Buffer.isBuffer(cialo) ? cialo.subarray(0, 4000).toString('utf8') : String(cialo || '').slice(0, 4000);
  return /permission|unauthori[sz]ed|invalid[_ ]api[_ ]key/i.test(tekst);
}

// ─── Sprawdzenie u dostawcy (bez kosztu) ─────────────────────────────────────

/** -> { ok: true } | { ok: false, powod: 'zly-klucz'|'brak-uprawnien'|'dostawca-niedostepny', status? } */
async function sprawdzUDostawcy(dostawca, dane, konf, fetchImpl = fetch) {
  const { url, naglowki } = DOSTAWCY_OPIS[dostawca].sprawdzenie(dane, konf || {});
  let odp;
  let tresc = '';
  try {
    odp = await fetchImpl(url, {
      method: 'GET',
      headers: { ...naglowki, 'User-Agent': 'ContentAI/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(CZAS_SPRAWDZENIA_MS),
    });
    tresc = (await odp.text().catch(() => '')).slice(0, 4000);
  } catch {
    return { ok: false, powod: 'dostawca-niedostepny' };
  }
  if (odp.status >= 200 && odp.status < 300) return { ok: true };
  if (odp.status === 401 || odp.status === 403) {
    // Klucz rozpoznany, ale bez prawa do tego odczytu (np. klucz projektu OpenAI tylko do grafik
    // i audio, klucz ElevenLabs tylko do mowy): to nie jest "zly klucz".
    const bezUprawnien = /missing_permissions|insufficient permissions|missing scopes|permission_error/i.test(tresc);
    return { ok: false, powod: bezUprawnien ? 'brak-uprawnien' : 'zly-klucz', status: odp.status };
  }
  return { ok: false, powod: 'dostawca-niedostepny', status: odp.status };
}

// ─── Stan dla aplikacji ──────────────────────────────────────────────────────

function koncowka(dostawca, dane) {
  return String(dane[DOSTAWCY_OPIS[dostawca].pola[0]] || '').slice(-4);
}

/** Stan kluczy konta. `zmiany`: { dostawca: wpis|null } po zapisie albo usunieciu w tym zapytaniu. */
function stanKluczy(req, konto, konf, zmiany = {}) {
  const serwera = Boolean(konto) && konto.zrodloKluczy === 'serwera';
  const wynik = { zrodloKluczy: serwera ? 'serwera' : 'wlasne', zapis: Boolean(kluczSzyfru(konf)), dostawcy: DOSTAWCY.slice() };
  for (const dostawca of DOSTAWCY) {
    const k = Object.prototype.hasOwnProperty.call(zmiany, dostawca) ? zmiany[dostawca] : zCiasteczka(req, konto, dostawca, konf);
    const pozycja = k && k.dane
      ? { ustawiony: true, koncowka: koncowka(dostawca, k.dane), zapamietany: Boolean(k.zapamietany) }
      : { ustawiony: false };
    if (k && k.dane && k.zapamietany && k.od) pozycja.wygasa = k.od + MAX_AGE_ZAPAMIETAJ * 1000;
    if (k && k.niewazne) pozycja.niewazny = true;
    // Konto zespolu: czy jest klucz serwera (sam fakt, bez wartosci) - bez wlasnego klucza dziala on.
    if (serwera) pozycja.kluczSerwera = Boolean(KLUCZE_SERWERA[dostawca](konf).klucz);
    wynik[dostawca] = pozycja;
  }
  return wynik;
}

// ─── Trasy /api/klucze* ──────────────────────────────────────────────────────

const LIMIT_SPRAWDZEN = limity.utworz('klucze-sprawdz', [
  { nazwa: 'konto', klucz: (k) => k.login, ile: 10, oknoMs: limity.MINUTA },
]);
const LIMIT_ZAPISOW = limity.utworz('klucze-zapis', [
  { nazwa: 'konto', klucz: (k) => k.login, ile: 30, oknoMs: limity.MINUTA },
]);

/** 'anthropic' | 'a' | ... -> nazwa dostawcy albo null. */
function dostawcaZNazwy(nazwa) {
  const n = String(nazwa || '').trim().toLowerCase();
  if (DOSTAWCY_OPIS[n]) return n;
  return PO_SKROCIE[n] || null;
}

/** Sekret z pol obiektu: dla jednego pola przyjmuje tez sam napis. -> obiekt pol albo null (pusto). */
function sekretZWartosci(dostawca, wartosc) {
  const pola = DOSTAWCY_OPIS[dostawca].pola;
  const zrodlo = typeof wartosc === 'string' && pola.length === 1 ? { [pola[0]]: wartosc } : wartosc;
  if (!zrodlo || typeof zrodlo !== 'object') return null;
  const dane = {};
  let cokolwiek = false;
  for (const pole of pola) {
    const w = zrodlo[pole];
    dane[pole] = typeof w === 'string' ? w.trim() : '';
    if (dane[pole]) cokolwiek = true;
  }
  return cokolwiek ? dane : null;
}

/** Wpisy do zapisania z ciala POST: [{ dostawca, dane }] albo { blad }. */
function wpisyZCiala(cialo) {
  if (!cialo || typeof cialo !== 'object' || Array.isArray(cialo)) return { blad: 'Niepoprawne zapytanie' };
  if (cialo.dostawca !== undefined) {
    const dostawca = dostawcaZNazwy(cialo.dostawca);
    if (!dostawca) return { blad: 'Nieznany dostawca' };
    const dane = sekretZWartosci(dostawca, cialo);
    return dane ? [{ dostawca, dane }] : { blad: 'Brak klucza do zapisania' };
  }
  const wpisy = [];
  for (const dostawca of DOSTAWCY) {
    if (cialo[dostawca] === undefined || cialo[dostawca] === null) continue;
    const dane = sekretZWartosci(dostawca, cialo[dostawca]);
    if (dane) wpisy.push({ dostawca, dane });
  }
  return wpisy.length ? wpisy : { blad: 'Brak klucza do zapisania' };
}

/** Cialo JSON zapytania; puste cialo = {}. Blad -> wyjatek z status 400/413. */
async function cialoLubPuste(req, kontekst) {
  let surowe;
  try {
    surowe = await kontekst.czytajCialo(req, LIMIT_CIALA);
  } catch {
    const e = new Error('Cialo zadania za duze');
    e.status = 413;
    throw e;
  }
  const tekst = surowe.toString('utf8').trim();
  if (!tekst) return {};
  try {
    return JSON.parse(tekst);
  } catch {
    const e = new Error('Niepoprawny JSON');
    e.status = 400;
    throw e;
  }
}

function odpowiedzZlegoFormatu(res, kontekst, dostawca, zly) {
  const tekst = komunikatFormatu(dostawca, zly.powod, kontekst.jezyk);
  res.setHeader('X-CAI-Dostawca', dostawca);
  kontekst.bladCai(res, 'zly-klucz', 400, {
    dostawca, powod: 'format', format: zly.powod, error: { type: 'cai_zly_klucz', message: tekst }, komunikat: tekst,
  });
}

async function trasaZapisu(req, res, kontekst) {
  const { KONF, konto } = kontekst;
  if (!kluczSzyfru(KONF)) {
    req.resume();
    kontekst.bladCai(res, 'niezaimplementowane', 503, {
      modul: 'klucze', powod: 'zapis-wylaczony',
      error: 'Zapamiętywanie kluczy jest wyłączone na tym serwerze (brak CAI_KLUCZ_CIASTEK).',
    });
    return;
  }
  const limit = LIMIT_ZAPISOW.ocen({ login: konto.login });
  if (!limit.wolno) {
    req.resume();
    kontekst.bladCai(res, 'za-duzo-prob', 429, { ponowZa: limit.ponowZa });
    return;
  }
  let cialo;
  try { cialo = await cialoLubPuste(req, kontekst); } catch (e) { kontekst.odpowiedzJson(res, e.status, { error: e.message }); return; }
  const wpisy = wpisyZCiala(cialo);
  if (wpisy.blad) { kontekst.odpowiedzJson(res, 400, { error: wpisy.blad }); return; }
  for (const w of wpisy) {
    const zly = zlyFormat(w.dostawca, w.dane);
    if (zly) { odpowiedzZlegoFormatu(res, kontekst, w.dostawca, zly); return; }
  }
  // "Zapisz i sprawdz": nic nie zapisujemy, gdy dostawca odrzuci klucz.
  if (cialo.sprawdz === true) {
    for (const w of wpisy) {
      const lim = LIMIT_SPRAWDZEN.ocen({ login: konto.login });
      if (!lim.wolno) { kontekst.bladCai(res, 'za-duzo-prob', 429, { ponowZa: lim.ponowZa }); return; }
      STAN.sprawdzen += 1;
      const wynik = await sprawdzUDostawcy(w.dostawca, w.dane, KONF);
      if (!wynik.ok) {
        kontekst.odpowiedzJson(res, 200, { ok: false, zapisano: false, dostawca: w.dostawca, powod: wynik.powod, ...(wynik.status ? { status: wynik.status } : {}) });
        return;
      }
    }
  }
  const zapamietaj = cialo.zapamietaj !== false;
  const teraz = Date.now();
  res.setHeader('Set-Cookie', wpisy.map((w) => ciasteczkoZKluczem(w.dostawca, w.dane, konto, KONF, zapamietaj, teraz)));
  STAN.zapisow += wpisy.length;
  const zmiany = Object.fromEntries(wpisy.map((w) => [w.dostawca, { dane: w.dane, zapamietany: zapamietaj, od: teraz }]));
  kontekst.odpowiedzJson(res, 200, { ok: true, zapisano: true, ...stanKluczy(req, konto, KONF, zmiany) });
}

async function trasaUsuniecia(req, res, kontekst, zParametru) {
  const { KONF, konto } = kontekst;
  let cialo = {};
  try { cialo = await cialoLubPuste(req, kontekst); } catch (e) { kontekst.odpowiedzJson(res, e.status, { error: e.message }); return; }
  const nazwa = String(zParametru || (cialo && cialo.dostawca) || 'wszystkie').trim().toLowerCase();
  const lista = nazwa === 'wszystkie' ? DOSTAWCY.slice() : [dostawcaZNazwy(nazwa)];
  if (lista.some((d) => !d)) { kontekst.odpowiedzJson(res, 400, { error: 'Nieznany dostawca' }); return; }
  res.setHeader('Set-Cookie', ciasteczkaUsuwajace(KONF, lista));
  STAN.usuniec += lista.length;
  kontekst.odpowiedzJson(res, 200, { ok: true, usunieto: lista, ...stanKluczy(req, konto, KONF, Object.fromEntries(lista.map((d) => [d, null]))) });
}

async function trasaSprawdzenia(req, res, kontekst) {
  const { KONF, konto } = kontekst;
  let cialo;
  try { cialo = await cialoLubPuste(req, kontekst); } catch (e) { kontekst.odpowiedzJson(res, e.status, { error: e.message }); return; }
  const dostawca = dostawcaZNazwy(cialo.dostawca);
  if (!dostawca) { kontekst.odpowiedzJson(res, 400, { error: 'Nieznany dostawca' }); return; }
  const lim = LIMIT_SPRAWDZEN.ocen({ login: konto.login });
  if (!lim.wolno) { kontekst.bladCai(res, 'za-duzo-prob', 429, { ponowZa: lim.ponowZa }); return; }
  // Klucz z ciala (kreator przed zapisem), z naglowka (kontrakt projektu 4.2), albo zapisany.
  // Nigdy klucz serwera: sprawdzamy klucz uzytkownika.
  let dane = sekretZWartosci(dostawca, cialo);
  if (!dane) { const z = kluczZNaglowka(req, dostawca); if (z) dane = { klucz: z }; }
  if (!dane) { const k = zCiasteczka(req, konto, dostawca, KONF); if (k && k.dane) dane = k.dane; }
  if (!dane) { kontekst.odpowiedzJson(res, 200, { ok: false, dostawca, powod: 'brak-klucza' }); return; }
  const zly = zlyFormat(dostawca, dane);
  if (zly) {
    kontekst.odpowiedzJson(res, 200, { ok: false, dostawca, powod: 'zly-klucz', format: zly.powod, komunikat: komunikatFormatu(dostawca, zly.powod, kontekst.jezyk) });
    return;
  }
  STAN.sprawdzen += 1;
  const wynik = await sprawdzUDostawcy(dostawca, dane, KONF);
  kontekst.odpowiedzJson(res, 200, { ok: wynik.ok, dostawca, ...(wynik.powod ? { powod: wynik.powod } : {}), ...(wynik.status ? { status: wynik.status } : {}) });
}

/** /api/klucze i /api/klucze/* (kontrakt w naglowku pliku). -> true, gdy obsluzone. */
async function obsluz(sciezka, req, res, kontekst) {
  if (sciezka !== '/api/klucze' && !sciezka.startsWith('/api/klucze/')) return false;
  if (!kontekst.konto) {
    kontekst.bladCai(res, 'sesja', 401, { error: 'Niezalogowany' });
    return true;
  }
  if (sciezka === '/api/klucze') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      kontekst.odpowiedzJson(res, 200, stanKluczy(req, kontekst.konto, kontekst.KONF));
    } else if (req.method === 'POST') {
      await trasaZapisu(req, res, kontekst);
    } else if (req.method === 'DELETE') {
      await trasaUsuniecia(req, res, kontekst, kontekst.url && kontekst.url.searchParams.get('dostawca'));
    } else {
      res.setHeader('Allow', 'GET, POST, DELETE');
      kontekst.odpowiedzJson(res, 405, { error: 'Metoda niedozwolona' });
    }
    return true;
  }
  if (sciezka === '/api/klucze/usun' && req.method === 'POST') {
    await trasaUsuniecia(req, res, kontekst, null);
    return true;
  }
  if (sciezka === '/api/klucze/sprawdz' && req.method === 'POST') {
    await trasaSprawdzenia(req, res, kontekst);
    return true;
  }
  kontekst.odpowiedzJson(res, 404, { error: 'Nieznany endpoint kluczy' });
  return true;
}

/** Sekcja /api/status: bez kluczy i bez danych kont, same liczniki. */
function stan() {
  return {
    wdrozone: true,
    zapis: STAN.konf ? Boolean(kluczSzyfru(STAN.konf)) : null,
    zapisow: STAN.zapisow,
    usuniec: STAN.usuniec,
    sprawdzen: STAN.sprawdzen,
  };
}

function inicjuj(kontekstSerwera) {
  STAN.konf = (kontekstSerwera && kontekstSerwera.KONF) || null;
  if (STAN.konf && !kluczSzyfru(STAN.konf) && kontekstSerwera.magazyn
    && kontekstSerwera.magazyn.liczbaKont({ pochodzenie: 'samoobsluga' }) > 0) {
    console.warn('[klucze] brak poprawnego CAI_KLUCZ_CIASTEK: konta samoobslugowe nie zapisza kluczy i nie wygeneruja tresci');
  }
}

module.exports = {
  NAGLOWEK, DOSTAWCY, DOSTAWCY_OPIS, DOSTAWCA_TRASY, MAX_AGE_ZAPAMIETAJ,
  kluczDla, brakKlucza, ciasteczkaUsuwajace, ciasteczkoZKluczem, nazwaCiasteczka, zlyFormat, komunikatFormatu,
  odrzucenieKlucza, sprawdzUDostawcy, stanKluczy, obsluz, stan, inicjuj,
};
