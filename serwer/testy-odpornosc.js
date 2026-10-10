'use strict';

// ─── Testy: odpornosc serwera (wykonawca C) ──────────────────────────────────
//
// KOD8-02 (pobranie strony w czasie liniowym), KOD8-15 (kodowanie strony, stary .doc, obraz,
// CSV z polskiego Excela w bazie), KOD8-11 (dokument uciety jawnie), SEC8-30 (plik bazy
// parsowany raz na wersje), kompresja w puli watkow i jedna strona aplikacji (KOD8-06,
// KOD8-32, ARCH8-24, prosba F), lagodne zatrzymanie po SIGTERM (KOD8-07) na osobnym procesie
// serwera. Wolane z testy-byok.js (lista plikow w serwer/testy.js zostaje bez zmian).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { uruchomSerwer, HASLO } = require('./testy-wspolne.js');

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));

/** Czeka, az `warunek()` zwroci wartosc (co 50 ms, najwyzej `ms`). */
async function czekajNa(warunek, ms) {
  const do_ = Date.now() + ms;
  for (;;) {
    const w = warunek();
    if (w) return w;
    if (Date.now() > do_) return null;
    await czekaj(50);
  }
}

function zmierz(f) {
  const t = process.hrtime.bigint();
  const wynik = f();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, wynik };
}

async function testyStrony({ sprawdz }) {
  console.log('\n  odpornosc: pobieranie strony (KOD8-02 czas liniowy, KOD8-15 kodowanie strony)');
  const strona = require('./strona.js');
  const nav = zmierz(() => strona.naTekst('<nav>'.repeat(32000) + '<p>tresc za menu</p>'));
  sprawdz(`KOD8-02: 32 000 niedomknietych <nav> w mniej niz 200 ms (${Math.round(nav.ms)} ms, dawniej ok. 21 s)`,
    nav.ms < 200 && nav.wynik.includes('tresc za menu'));
  const mieszanka = ['<!--', '<script>', '<style>', '<h1>', '<h2 class=x>', '<li', '<main>', '<article>', '<title>', '<', '<aside x']
    .join(' slowo ').repeat(12000);
  const m = zmierz(() => strona.naTekst(mieszanka));
  sprawdz(`KOD8-02: ${Math.round(mieszanka.length / 1024)} kB niedomknietych komentarzy, naglowkow, list i "<" w mniej niz 500 ms (${Math.round(m.ms)} ms)`,
    m.ms < 500 && m.wynik.includes('slowo'));
  let wyjatek = null;
  let encje = '';
  try {
    encje = strona.naTekst('<p>znak &#x110000; i &#99999999999; oraz &constructor; zostaja, a &#322; dziala</p>');
  } catch (e) { wyjatek = e; }
  sprawdz('encje spoza Unicode i nazwy z prototypu obiektu zostaja tekstem (dawniej wyjatek i nieudane pobranie strony)',
    !wyjatek && encje.includes('&#x110000;') && encje.includes('&constructor;') && encje.includes('ł dziala'));

  // KOD8-15: kodowanie z naglowka i z <meta>.
  const CP1250 = { 'ą': 0xb9, 'ć': 0xe6, 'ę': 0xea, 'ł': 0xb3, 'ń': 0xf1, 'ó': 0xf3, 'ś': 0x9c, 'ź': 0x9f, 'ż': 0xbf };
  const ISO2 = { 'ą': 0xb1, 'ć': 0xe6, 'ę': 0xea, 'ł': 0xb3, 'ń': 0xf1, 'ó': 0xf3, 'ś': 0xb6, 'ź': 0xbc, 'ż': 0xbf };
  const zakoduj = (tekst, mapa) => Buffer.from([...tekst].map((z) => (mapa[z] !== undefined ? mapa[z] : z.charCodeAt(0))));
  const odpowiedz = (naglowki, bufor) => async () => ({
    status: 200, ok: true,
    headers: { get: (k) => (naglowki[k.toLowerCase()] !== undefined ? naglowki[k.toLowerCase()] : null) },
    arrayBuffer: async () => bufor.buffer.slice(bufor.byteOffset, bufor.byteOffset + bufor.length),
  });
  const tresc = 'Pompa ciepła zużywa mniej prądu niż kocioł gazowy. '.repeat(8);
  const w1 = await strona.pobierz('https://example.com/a', odpowiedz({ 'content-type': 'text/html; charset=windows-1250' },
    zakoduj(`<html><head><title>Cennik</title></head><body><p>${tresc}</p></body></html>`, CP1250)));
  const w2 = await strona.pobierz('https://example.com/b', odpowiedz({ 'content-type': 'text/html' },
    zakoduj(`<html><head><meta charset="iso-8859-2"><title>Ciepło</title></head><body><p>${tresc}</p></body></html>`, ISO2)));
  const w3 = await strona.pobierz('https://example.com/c', odpowiedz({ 'content-type': 'text/html' },
    zakoduj(`<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1250"></head><body><p>${tresc}</p></body></html>`, CP1250)));
  sprawdz('KOD8-15: strona w windows-1250 (naglowek), ISO-8859-2 (<meta charset>) i windows-1250 (<meta http-equiv>) bez znakow zastepczych',
    w1.tekst.includes('Pompa ciepła zużywa') && w2.tekst.includes('Pompa ciepła zużywa') && w2.tytul === 'Ciepło'
    && w3.tekst.includes('kocioł') && !/\uFFFD/.test(w1.tekst + w2.tekst + w3.tekst));
  const w4 = await strona.pobierz('https://example.com/d', odpowiedz({ 'content-type': 'text/html; charset=nieznane-kodowanie' }, Buffer.from(`<p>${tresc}</p>`)));
  const w5 = await strona.pobierz('https://example.com/e', odpowiedz({ 'content-type': 'text/html' }, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`<p>${tresc}</p>`)])));
  sprawdz('KOD8-15: nieznana nazwa kodowania i UTF-8 z BOM -> UTF-8 jak dawniej', w4.tekst.includes('Pompa ciepła') && w5.tekst.startsWith('Pompa ciepła'));
}

async function testyBazy({ sprawdz }) {
  console.log('\n  odpornosc: baza wiedzy (KOD8-11 uciecie jawne, KOD8-15 zle pliki, SEC8-30 pamiec plikow)');
  const t = await uruchomSerwer({});
  try {
    const c = await t.zaloguj('premium');
    const pusta = await (await t.zadanie('/api/baza', { headers: { cookie: c } })).json();
    const dlugi = 'Rozdzial katalogu z danymi technicznymi pomp ciepla. '.repeat(2300);
    const dodanie = await t.zadanie('/api/baza', t.json(c, { nazwa: 'Katalog', tresc: dlugi }));
    const dlugiJ = await dodanie.json().catch(() => ({}));
    const krotkiJ = await (await t.zadanie('/api/baza', t.json(c, { nazwa: 'Notatka', tresc: 'Krotka notatka o gwarancji producenta.' }))).json().catch(() => ({}));
    const lista = await (await t.zadanie('/api/baza', { headers: { cookie: c } })).json();
    const naLiscie = (lista.dokumenty || []).find((d) => d.nazwa === 'Katalog') || {};
    sprawdz('KOD8-11: dokument dluzszy niz limit -> uciety: true, zapisanoZnakow (90 000) i znakow (calosc) w odpowiedzi i na liscie',
      dodanie.status === 200 && dlugiJ.uciety === true && dlugiJ.zapisanoZnakow === 90000 && dlugiJ.znakow === dlugi.length
      && naLiscie.uciety === true && naLiscie.zapisanoZnakow === 90000);
    sprawdz('KOD8-11: krotki dokument -> uciety: false, zapisanoZnakow = znakow; GET /api/baza podaje limitZnakow (90 000)',
      krotkiJ.uciety === false && krotkiJ.zapisanoZnakow === krotkiJ.znakow && pusta.limitZnakow === 90000 && lista.limitZnakow === 90000);

    const dodaj = async (dane, jezyk) => {
      const o = await t.zadanie('/api/baza', t.json(c, dane, jezyk ? { 'accept-language': jezyk } : {}));
      return { status: o.status, j: await o.json().catch(() => ({})) };
    };
    const doc = await dodaj({ nazwa: 'stary-word.doc', tresc: 'Tekst ze starego pliku Worda. '.repeat(10) });
    const png = await dodaj({ nazwa: 'zdjecie.png', tresc: '\u0089PNG\r\n\u001a\n' + 'IHDR'.repeat(20) });
    const bin = await dodaj({ nazwa: 'plik-bez-rozszerzenia', tresc: 'abc\u0000def\u0001\u0002ghi'.repeat(40) });
    const csv = await dodaj({ nazwa: 'cennik-excel.csv', tresc: 'Pompa ciep\uFFFDa;Za\uFFFD\uFFFD\uFFFD g\uFFFDl\uFFFD ja\uFFFD\uFFFD;12000\n'.repeat(5) });
    const en = await dodaj({ nazwa: 'stary-word.doc', tresc: 'Text from an old Word file. '.repeat(10) }, 'en');
    const poZlych = await (await t.zadanie('/api/baza', { headers: { cookie: c } })).json();
    const dobry = await dodaj({ nazwa: 'cennik-utf8.csv', tresc: 'Pompa ciepła;Zażółć gęślą jaźń;12000\n'.repeat(5) });
    const powody = [doc, png, bin, csv].map((o) => `${o.status}:${o.j.powod}`).join(',');
    sprawdz(`KOD8-15: stary .doc, obraz, plik binarny i CSV w zlym kodowaniu -> 422 z powodem i komunikatem, nic nie trafia do bazy (${powody})`,
      powody === '422:stary-format,422:obraz,422:plik-binarny,422:kodowanie' && [doc, png, bin, csv].every((o) => /\S{3}/.test(o.j.komunikat || ''))
      && (poZlych.dokumenty || []).length === 2);
    sprawdz('KOD8-15: komunikat po angielsku przy Accept-Language: en; poprawny CSV w UTF-8 z polskimi znakami przechodzi',
      en.status === 422 && /old Office format/.test(en.j.komunikat || '') && dobry.status === 200);
  } finally {
    await t.zamknij();
  }

  // SEC8-30: plik bazy parsowany raz na wersje (i-wezel, rozmiar, czas zmiany), nie przy kazdym zapytaniu.
  const baza = require('./baza.js');
  const pliki = require('./pliki.js');
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-baza-pamiec-'));
  const czytajPrzed = pliki.czytajJson;
  try {
    await baza.dodaj({ katalog: kat, zakres: 'prywatna', login: 'ola', nazwa: 'A', tresc: 'Tekst o pompach ciepla i gwarancji producenta.', konfWektorow: { klucz: '' } });
    baza.wyczyscPamiec();
    let odczytow = 0;
    pliki.czytajJson = (...a) => { odczytow += 1; return czytajPrzed(...a); };
    for (let i = 0; i < 5; i += 1) await baza.szukaj({ katalog: kat, login: 'ola', zapytanie: 'pompach gwarancji', konfWektorow: { klucz: '' } });
    baza.lista({ katalog: kat, login: 'ola' });
    const poSzukaniu = odczytow;
    const plik = path.join(kat, 'u-ola.json');
    const dokumenty = JSON.parse(fs.readFileSync(plik, 'utf8'));
    dokumenty[0].nazwa = 'Zmieniony z zewnatrz';
    fs.writeFileSync(plik, JSON.stringify(dokumenty));
    const poZmianie = baza.lista({ katalog: kat, login: 'ola' });
    sprawdz(`SEC8-30: piec wyszukiwan i lista parsuja plik bazy raz (${poSzukaniu}), zmiana pliku z zewnatrz daje swiezy odczyt`,
      poSzukaniu === 1 && odczytow === 2 && poZmianie[0].nazwa === 'Zmieniony z zewnatrz');
  } finally {
    pliki.czytajJson = czytajPrzed;
    baza.wyczyscPamiec();
    fs.rmSync(kat, { recursive: true, force: true });
  }
}

async function testyKompresji({ sprawdz }) {
  console.log('\n  odpornosc: kompresja w puli watkow, jedna strona aplikacji (KOD8-06, KOD8-32, ARCH8-24)');
  const t = await uruchomSerwer({});
  try {
    const c = await t.zaloguj('premium');
    const oryginal = fs.readFileSync(path.join(__dirname, '..', 'app', 'pwa', 'lib', 'pdfmake.min.js'));
    const pobierz = () => t.zadanie('/pwa/lib/pdfmake.min.js', { headers: { cookie: c, 'accept-encoding': 'br' } });
    // Zegar co 10 ms w tym samym procesie co serwer: najdluzsza przerwa miedzy tikami to
    // najdluzsze zatrzymanie petli zdarzen w czasie pierwszych pobran.
    let ostatniTik = Date.now();
    let maksMs = 0;
    const zegar = setInterval(() => { const teraz = Date.now(); maksMs = Math.max(maksMs, teraz - ostatniTik); ostatniTik = teraz; }, 10);
    await czekaj(50);
    let p1;
    let p2;
    let b1 = Buffer.alloc(0);
    let b2 = Buffer.alloc(0);
    try {
      [p1, p2] = await Promise.all([pobierz(), pobierz()]);
      b1 = Buffer.from(await p1.arrayBuffer());
      b2 = Buffer.from(await p2.arrayBuffer());
      await czekaj(30);
    } finally {
      clearInterval(zegar);
    }
    sprawdz(`kompresja: pierwsze pobrania pdfmake.min.js (brotli) nie zatrzymuja petli zdarzen (najdluzej ${maksMs} ms, dawniej 2-4 s), tresc zgodna`,
      p1.status === 200 && p1.headers.get('content-encoding') === 'br' && b1.equals(oryginal) && b2.equals(oryginal) && maksMs < 500);
    const szybka = Number(p1.headers.get('content-length'));
    let dlugosc = szybka;
    for (let i = 0; i < 60 && dlugosc >= szybka; i += 1) {
      await czekaj(250);
      const p = await pobierz();
      await p.arrayBuffer();
      dlugosc = Number(p.headers.get('content-length'));
    }
    sprawdz(`kompresja: najlepsza wersja brotli liczy sie w tle i zastepuje szybka (${szybka} -> ${dlugosc} B)`, dlugosc < szybka);

    const kontoJs = await t.zadanie('/konto.js', { headers: { cookie: c } });
    const kontoTekst = await kontoJs.text();
    const id = (/window\.CAI_KONTO="([0-9a-f]{16})"/.exec(kontoTekst) || [])[1];
    sprawdz('/konto.js (ARCH8-24): identyfikator konta w window.CAI_KONTO, bez pamieci podrecznej',
      kontoJs.status === 200 && Boolean(id) && kontoJs.headers.get('cache-control') === 'private, no-store'
      && /javascript/.test(kontoJs.headers.get('content-type') || ''));
    const c2 = await t.zaloguj('standard');
    const dzis1 = await t.zadanie('/', { headers: { cookie: c } });
    const dzis1T = await dzis1.text();
    const dzis2T = await (await t.zadanie('/', { headers: { cookie: c2 } })).text();
    sprawdz('strona aplikacji z miejscem na konto (dzisiejsza): identyfikator w HTML per konto, private no-store, bez ETag (jak dzis)',
      dzis1T.includes(`content="${id}"`) && !dzis2T.includes(`content="${id}"`)
      && dzis1.headers.get('cache-control') === 'private, no-store' && !dzis1.headers.get('etag'));
    t.srv.ustawHtmlAplikacji(t.srv.wczytajAplikacje().split('WSTAW_TUTAJ_KONTO').join(''));
    const o1 = await t.zadanie('/', { headers: { cookie: c, 'accept-encoding': 'br' } });
    const w1 = await o1.text();
    const o2 = await t.zadanie('/', { headers: { cookie: c2, 'accept-encoding': 'gzip' } });
    const w2 = await o2.text();
    const etag = o1.headers.get('etag');
    const o304 = await t.zadanie('/', { headers: { cookie: c2, 'if-none-match': etag } });
    sprawdz('strona aplikacji bez miejsca na konto (KOD8-06): ta sama dla kazdego konta, ETag i 304, private no-cache',
      w1 === w2 && w1.length > 100000 && Boolean(etag) && o2.headers.get('etag') === etag && o304.status === 304
      && o1.headers.get('cache-control') === 'private, no-cache' && o1.headers.get('content-encoding') === 'br');
  } finally {
    await t.zamknij();
  }
}

async function testyZatrzymania({ sprawdz }) {
  console.log('\n  odpornosc: lagodne zatrzymanie po SIGTERM (KOD8-07, osobny proces serwera)');
  const { spawn } = require('node:child_process');
  const atrapaModul = require('../narzedzia/atrapa/dostawcy.js');
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-sigterm-'));
  // Dziennik wywolan atrapy w katalogu testu, nie we wspolnym pliku atrapy 9199.
  const dziennikPrzed = atrapaModul.KONF.dziennik;
  atrapaModul.KONF.dziennik = path.join(kat, 'atrapa.log');
  const atrapa = atrapaModul.uruchom(0, '127.0.0.1');
  await new Promise((r) => (atrapa.listening ? r() : atrapa.once('listening', r)));
  const portAtrapy = atrapa.address().port;
  const { zahaszuj } = require('./server.js');
  fs.writeFileSync(path.join(kat, 'uzytkownicy.json'), JSON.stringify([
    Object.assign({ login: 'premium', rola: 'uzytkownik', plan: 'premium', utworzony: '2026-01-01' }, zahaszuj(HASLO)),
  ]));
  const env = {
    ...process.env, PORT: '0', CAI_HOST: '127.0.0.1',
    CAI_UZYTKOWNICY: path.join(kat, 'uzytkownicy.json'), CAI_SQLITE: path.join(kat, 'contentai.sqlite'),
    CAI_KOPIE: path.join(kat, 'kopie'), CAI_BAZA: path.join(kat, 'baza'), CAI_UZYCIE: path.join(kat, 'uzycie'),
    CAI_MARKA: kat, CAI_SEKRET_PLIK: path.join(kat, 'sekret'), CAI_WYLOGOWANE: path.join(kat, 'wylogowane.json'),
    CAI_PROSBY: path.join(kat, 'prosby.jsonl'), CAI_POCZTA_LOG: path.join(kat, 'poczta.jsonl'), CAI_COOKIE_SECURE: '0',
    ANTHROPIC_KEY: 'test', OPENAI_KEY: 'test', CAI_URL_ANTHROPIC: `http://127.0.0.1:${portAtrapy}/v1/messages`,
    CAI_URL_OPENAI: `http://127.0.0.1:${portAtrapy}/v1`,
  };
  const dziecko = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let dziennik = '';
  dziecko.stdout.on('data', (d) => { dziennik += d; });
  dziecko.stderr.on('data', (d) => { dziennik += d; });
  const wyjscie = new Promise((r) => dziecko.once('exit', (kod, sygnal) => r({ kod, sygnal })));
  try {
    const port = await czekajNa(() => (/Content AI: http:\/\/127\.0\.0\.1:(\d+)/.exec(dziennik) || [])[1], 20000);
    if (!port) throw new Error('serwer testowy nie wstal: ' + dziennik.slice(-500));
    const adres = `http://127.0.0.1:${port}`;
    const zWlasnej = { origin: adres, 'sec-fetch-site': 'same-origin' };
    const logowanie = await fetch(adres + '/auth/login', {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...zWlasnej },
      body: new URLSearchParams({ login: 'premium', haslo: HASLO }).toString(),
    });
    const cookie = (logowanie.headers.get('set-cookie') || '').split(';')[0];
    const post = (cialo, inne = {}) => ({
      method: 'POST', headers: { 'Content-Type': 'application/json', ...zWlasnej, cookie, ...inne }, body: JSON.stringify(cialo),
    });
    const artykul = (znacznik) => ({ model: 'claude-sonnet-5', max_tokens: 50, messages: [{ role: 'user', content: `Generowanie w trakcie wdrozenia ${znacznik}` }] });
    const wTrakcie = fetch(adres + '/api', post(artykul('[atrapa:opoznienie=2500]'), { 'x-zadanie': 'zatrzymanie-0001' }))
      .then(async (o) => ({ status: o.status, json: await o.json().catch(() => null) }), (e) => ({ blad: e.message }));
    const zrywam = new AbortController();
    fetch(adres + '/api', { ...post(artykul('[atrapa:opoznienie=1200]'), { 'x-zadanie': 'zatrzymanie-0002' }), signal: zrywam.signal }).catch(() => null);
    await czekaj(400);
    zrywam.abort();
    dziecko.kill('SIGTERM');
    await czekaj(300);
    const nowe = await fetch(adres + '/api', post(artykul('nowe')));
    await nowe.text();
    const pakiet = await fetch(adres + '/api/pakiet', { headers: { cookie } });
    await pakiet.arrayBuffer();
    sprawdz('po SIGTERM: nowe wywolanie dostawcy -> 503 tekstem z Retry-After (aplikacja ponawia), reszta serwera dziala',
      nowe.status === 503 && nowe.headers.get('retry-after') === '5' && /text\/plain/.test(nowe.headers.get('content-type') || '') && pakiet.status === 200);
    await czekaj(1200);
    const odbior = await fetch(adres + '/api', post({}, { 'x-zadanie': 'zatrzymanie-0002' }));
    const odbiorJ = await odbior.json().catch(() => null);
    sprawdz('po SIGTERM: wynik zadania, ktorego klient zerwal polaczenie, odbiera ponowienie z tym samym X-Zadanie',
      odbior.status === 200 && Boolean(odbiorJ) && Array.isArray(odbiorJ.content));
    const w = await wTrakcie;
    sprawdz('po SIGTERM: trwajace generowanie konczy sie normalnie (200 z trescia zamiast zerwanego polaczenia)',
      w.status === 200 && Boolean(w.json) && Array.isArray(w.json.content));
    const koniec = await Promise.race([wyjscie, czekaj(12000).then(() => null)]);
    sprawdz('po SIGTERM: proces konczy sie sam kodem 0, gdy nic juz nie trwa i wyniki sa odebrane',
      Boolean(koniec) && koniec.kod === 0 && /zatrzymanie: praca w toku skonczona/.test(dziennik));
  } finally {
    if (dziecko.exitCode === null && dziecko.signalCode === null) dziecko.kill('SIGKILL');
    await new Promise((r) => atrapa.close(r));
    atrapaModul.KONF.dziennik = dziennikPrzed;
    fs.rmSync(kat, { recursive: true, force: true });
  }
}

function testyCaddy({ sprawdz }) {
  console.log('\n  odpornosc: blok Caddy (SEC8-01 dziennik bez kluczy, ARCH8-25 restart, podstrony strony)');
  const korzen = path.join(__dirname, '..');
  const linie = fs.readFileSync(path.join(korzen, 'dokumenty', 'Caddyfile.content-ai'), 'utf8').split('\n');
  const start = linie.indexOf('{');
  const globalny = linie.slice(start, linie.indexOf('}', start) + 1).join('\n');
  const blok = linie.slice(start, linie.findIndex((l) => l.startsWith('# Zmienne uslugi'))).join('\n');
  const usuwane = ['X-Api-Key', 'X-Openai-Key', 'X-Eleven-Key', 'Xi-Api-Key', 'Cookie', 'Authorization']
    .filter((n) => !globalny.includes(`request>headers>${n} delete`));
  sprawdz(`Caddy: log default z format filter w bloku globalnym usuwa naglowki z kluczami i ciasteczka (brak: ${usuwane.join(', ') || 'nic'})`,
    /log default \{[\s\S]*format filter \{/.test(globalny) && usuwane.length === 0);
  const app = blok.slice(blok.indexOf('app.content-ai.net {'), blok.indexOf('# ── Srodowisko testowe'));
  sprawdz('Caddy: app. ponawia polaczenie w oknie restartu (lb_try_duration 10s, lb_try_interval 250ms)',
    /reverse_proxy 127\.0\.0\.1:3100 \{[\s\S]*?lb_try_duration 10s\n\s+lb_try_interval 250ms\n\s+\}/.test(app));
  sprawdz('Caddy: naglowki HTML strony dla kazdego adresu zakonczonego ukosnikiem (@html path */ *.html)',
    blok.includes('@html path */ *.html'));
  sprawdz('Caddy: zakomentowany blok test.content-ai.net (basic_auth poza webhookiem, port 3101, X-Real-IP)',
    /# test\.content-ai\.net \{[\s\S]*#\s+@chronione not path \/platnosci\/webhook\/\*[\s\S]*#\s+basic_auth @chronione[\s\S]*#\s+reverse_proxy 127\.0\.0\.1:3101 \{\n#\s+header_up X-Real-IP \{client_ip\}/.test(blok));
}

async function uruchom({ sprawdz }) {
  testyCaddy({ sprawdz });
  await testyStrony({ sprawdz });
  await testyBazy({ sprawdz });
  await testyKompresji({ sprawdz });
  await testyZatrzymania({ sprawdz });
}

module.exports = { uruchom };
