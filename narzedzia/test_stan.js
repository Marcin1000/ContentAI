#!/usr/bin/env node
'use strict';
/*
 * Test stanu artykulu i komunikatow bledow (runda 3) w prawdziwej przegladarce,
 * z atrapa dostawcow AI - wariant keys z pliku, dostawcy przechwyceni przez page.route.
 *
 * Sprawdza rodzine bledow, ktorej nie widac w podpisach kodu:
 *  - nowe generowanie i artykul z historii nie pokazuja stanu POPRZEDNIEGO tekstu:
 *    pasek statystyk w trakcie (R3-20), panel przerobek, wynik Faktow, JSON-LD,
 *    przycisk SERP; pierwszy klik JSON-LD po nowym artykule otwiera pole,
 *  - Fakty bez zaznaczonych zrodel: zadnego zielonego "bez zastrzezen", jest akcja
 *    "Wybierz zrodla w Bazie" i nie ma "Sprawdz ponownie" (R3-27),
 *  - bledy dostawcy: komunikat ze slownika zamiast surowego angielskiego, przy zlym
 *    kluczu przycisk do kluczy, "Sprobuj ponownie" tylko przy 429/5xx/529/sieci,
 *    to samo w panelu SEO i w powiadomieniu generatora grafik,
 *  - liczby z ulamkiem po polsku z przecinkiem (koszt sesji, FOG).
 *
 * Uzycie (z katalogu repozytorium, po zbudowaniu wariantow):
 *   npm install --no-save playwright && npx playwright install chromium
 *   node narzedzia/test_stan.js
 * Zmienne: CAI_CHROMIUM - sciezka do Chromium, CAI_TEST_ZRZUTY - katalog na zrzuty przy bledzie.
 * Kod wyjscia: 0 gdy wszystko przeszlo, 1 gdy cokolwiek nie.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Brak pakietu playwright: npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }
// R9-F (KOD8-35): dziennik atrapy w katalogu przebiegu, sprzatany po zielonym przebiegu. Wczesniej
// /tmp/atrapa-wywolania-9199.log, czyli ten sam plik co wspolnej atrapy na porcie 9199.
let KAT_DZIENNIKA = null;
if (!process.env.ATRAPA_DZIENNIK) {
  KAT_DZIENNIKA = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-test-atrapa-'));
  process.env.ATRAPA_DZIENNIK = path.join(KAT_DZIENNIKA, 'atrapa-wywolania.log');
}
const atrapa = require('./atrapa/dostawcy.js');

const ZRZUTY = process.env.CAI_TEST_ZRZUTY || path.join(os.tmpdir(), 'cai-test-stan');
const PLIK = 'file://' + path.join(REPO, 'app', 'web-keys.html');

let bledow = 0;
function wynik(nazwa, ok, szczegol) {
  console.log((ok ? 'ok    ' : 'BLAD  ') + nazwa + (!ok && szczegol ? '  [' + szczegol + ']' : ''));
  if (!ok) bledow++;
}
async function krok(nazwa, obietnica) {
  try { await obietnica; return true; }
  catch (e) { wynik('krok: ' + nazwa, false, (e && e.message || String(e)).split('\n')[0]); return false; }
}
async function zrzut(s, nazwa) {
  try { fs.mkdirSync(ZRZUTY, { recursive: true }); await s.screenshot({ path: path.join(ZRZUTY, nazwa + '.png') }); } catch (e) { /* bez zrzutu */ }
}

// ── R9-F: serwer aplikacji z kontami i atrapa dostawcow (wariant proxy, jak test_dymny) ──
const http = require('http');
const { spawn } = require('child_process');
const HASLO = 'test-haslo-123';
function wolnyPort() {
  return new Promise((ok, zle) => {
    const srv = require('net').createServer();
    srv.once('error', zle);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => ok(p)); });
  });
}
function czekajNaPort(port, ms) {
  const koniec = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function proba() {
      const r = http.get({ host: '127.0.0.1', port, path: '/' }, (o) => { o.resume(); resolve(); });
      r.on('error', () => { if (Date.now() > koniec) reject(new Error('port ' + port + ' nie odpowiada')); else setTimeout(proba, 150); });
    })();
  });
}
// Serwer w katalogu tymczasowym: { port, kat, proces, zatrzymaj() }. Atrapa dostawcow na wlasnym porcie.
async function serwerProxy() {
  const portAtrapy = await wolnyPort();
  const port = await wolnyPort();
  const srvAtrapy = atrapa.uruchom(portAtrapy);
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-test-stan-'));
  const { zahaszuj } = require(path.join(REPO, 'serwer', 'server.js'));
  const konta = [['admin', 'admin', 'premium'], ['premium', 'uzytkownik', 'premium'], ['standard', 'uzytkownik', 'standard'], ['darmowy', 'uzytkownik', 'darmowy']]
    .map(([login, rola, plan]) => Object.assign({ login, rola, plan, utworzony: '2026-01-01' }, zahaszuj(HASLO)));
  fs.writeFileSync(path.join(kat, 'uzytkownicy.json'), JSON.stringify(konta, null, 2));
  const env = Object.assign({}, process.env, {
    CAI_UZYTKOWNICY: path.join(kat, 'uzytkownicy.json'), CAI_BAZA: path.join(kat, 'baza'), CAI_UZYCIE: path.join(kat, 'uzycie'),
    CAI_MARKA: kat, CAI_SEKRET_PLIK: path.join(kat, 'sekret'), PORT: String(port), CAI_HOST: '127.0.0.1',
    ANTHROPIC_KEY: 'test-anthropic', OPENAI_KEY: 'test-openai', ELEVEN_KEY: 'test-eleven',
    CAI_URL_ANTHROPIC: 'http://127.0.0.1:' + portAtrapy + '/v1/messages', CAI_URL_OPENAI: 'http://127.0.0.1:' + portAtrapy + '/v1',
    CAI_URL_ELEVEN: 'http://127.0.0.1:' + portAtrapy + '/eleven/v1', CAI_ZAUFANE_ADRESY: '127.0.0.1',
  });
  const proces = spawn(process.execPath, [path.join(REPO, 'serwer', 'server.js')], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proces.stdout.on('data', (d) => { log += d; });
  proces.stderr.on('data', (d) => { log += d; });
  await czekajNaPort(port, 15000);
  return { port, kat, proces, log: () => log, zatrzymaj: () => { proces.kill(); srvAtrapy.close(); fs.rmSync(kat, { recursive: true, force: true }); } };
}
async function zalogujProxy(k, port, login) {
  const s = await k.newPage();
  await s.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  if (await s.$('input[name="login"]')) {
    await s.fill('input[name="login"]', login);
    await s.fill('input[type="password"]', HASLO);
    await Promise.all([s.waitForNavigation({ waitUntil: 'load' }), s.click('button[type="submit"], input[type="submit"]')]);
  }
  await s.waitForFunction(() => typeof generate === 'function' && document.readyState === 'complete', null, { timeout: 15000 });
  await s.evaluate(() => { if (typeof startPomin === 'function') startPomin(); });
  return s;
}
async function kontekstProxy(b, opcje) {
  const k = await b.newContext(Object.assign({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } }, opcje || {}));
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); localStorage.setItem('cai_lang', 'pl'); localStorage.setItem('cai_start_v1', '1'); } catch (e) { /* bez magazynu */ } });
  const bledyJs = [];
  k.on('page', (p) => { p.on('pageerror', (e) => bledyJs.push(e.message.slice(0, 160))); p.on('dialog', (d) => d.accept().catch(() => {})); });
  return { k, bledyJs };
}

// Bledy dostawcy w ksztalcie odpowiedzi API (tresc jak u Anthropic i OpenAI).
const BLEDY = {
  401: [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }],
  'za-dlugi': [400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 215000 tokens > 200000 maximum' } }],
  srodki: [400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }],
  403: [403, { type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission to use the specified resource.' } }],
  413: [413, { type: 'error', error: { type: 'request_too_large', message: 'Request exceeds the maximum allowed number of bytes.' } }],
  500: [500, { type: 'error', error: { type: 'api_error', message: 'Internal server error' } }],
  529: [529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
  'openai-401': [401, { error: { message: 'Incorrect API key provided: sk-atr***apa.', type: 'invalid_request_error', code: 'invalid_api_key' } }],
};
// Surowe zdania dostawcy, ktore nie moga trafic do glownego komunikatu.
const SUROWE = /invalid x-api-key|prompt is too long|credit balance|does not have permission|exceeds the maximum|Internal server error|Overloaded|Incorrect API key/i;

async function nowaStrona(b, jezyk, stan) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await k.addInitScript((jezyk) => {
    try {
      localStorage.setItem('cai_key_anthropic', 'sk-ant-atrapa');
      localStorage.setItem('cai_key_openai', 'sk-atrapa');
      localStorage.setItem('cai_lang', jezyk);
      localStorage.setItem('cai_start_v1', '1');
      sessionStorage.setItem('cin_splash', '1');
    } catch (e) { /* tryb bez magazynu */ }
  }, jezyk);
  // stan.blad: klucz z BLEDY albo 'siec'; stan.gdzie: 'anthropic' | 'openai'.
  await k.route(/api\.anthropic\.com|api\.openai\.com|api\.elevenlabs\.io/, async (route) => {
    const req = route.request();
    const host = new URL(req.url()).hostname;
    const cel = /openai/.test(host) ? 'openai' : 'anthropic';
    if (stan.blad && req.method() === 'POST' && (stan.gdzie || 'anthropic') === cel) {
      if (stan.blad === 'siec') return route.abort('failed');
      const [status, cialo] = BLEDY[stan.blad];
      return route.fulfill({ status, contentType: 'application/json', headers: atrapa.CORS, body: JSON.stringify(cialo) });
    }
    return atrapa.obsluzRoute(route);
  });
  const s = await k.newPage();
  const bledyJs = [];
  s.on('pageerror', (e) => bledyJs.push(e.message.slice(0, 160)));
  s.on('dialog', (d) => d.accept());
  await s.goto(PLIK, { waitUntil: 'load' });
  await s.waitForTimeout(700);
  return { k, s, bledyJs };
}

const czekajNaKoniec = (s, ms) => s.waitForFunction(() => {
  const b = document.getElementById('gen-btn'), sp = document.getElementById('spinner');
  return b && !b.disabled && sp && getComputedStyle(sp).display === 'none';
}, null, { timeout: ms || 60000 });

async function generuj(s, temat, serp) {
  await s.fill('#topic', temat);
  await s.evaluate((serp) => {
    document.getElementById('use-web').checked = true;
    const u = document.getElementById('use-serp'); if (u) u.checked = !!serp;
  }, serp);
  await s.click('#gen-btn');
}

// Stan widoczny dla uzytkownika: pasek statystyk, przerobka, Fakty, JSON-LD, SERP.
const stan = (s) => s.evaluate(() => {
  const widac = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const st = document.getElementById('article-stats');
  const rp = document.getElementById('repurpose-panel');
  const fw = document.getElementById('fakty-wynik');
  const jb = document.getElementById('jsonld-box');
  return {
    h1: ((document.querySelector('#article h1') || {}).textContent || '').trim(),
    pasek: !!st && st.classList.contains('show') && widac(st),
    slowa: (document.getElementById('stat-words') || {}).textContent || '',
    przerobkaOtwarta: !!rp && rp.classList.contains('show'),
    przerobka: ((document.getElementById('repurpose-out') || {}).value || '').trim(),
    fakty: fw ? (fw.innerText || '').trim() : '',
    faktyZnacznik: !!(fw && fw.querySelector('[data-test-art]')),
    jsonOtwarte: !!jb && jb.classList.contains('show'),
    jsonKod: ((document.getElementById('jsonld-code') || {}).textContent || ''),
    // Przycisk SERP siedzi w menu "Wiecej", wiec liczy sie jego wlasny styl, nie uklad.
    serpPrzycisk: ((document.getElementById('serp-toggle-btn') || {}).style || {}).display === 'flex',
  };
});

async function scenariuszStanu(b) {
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', {});
  // ── Artykul A z SERP, otwarte Fakty, przerobka i JSON-LD ──
  await generuj(s, 'Pompy ciepla w domu jednorodzinnym', true);
  await krok('artykul A', czekajNaKoniec(s));
  await s.evaluate(() => { try { inspektorZamknij(); } catch (e) { /* brak panelu */ } przelaczPanelFaktow(); });
  await s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none', null, { timeout: 30000 }).catch(() => { throw new Error('nie doczekano: koniec ladowania Faktow'); });
  await s.evaluate(() => {
    const fw = document.getElementById('fakty-wynik');
    if (fw && fw.firstElementChild) fw.firstElementChild.setAttribute('data-test-art', 'A');
    runRepurpose('linkedin');
  });
  await s.waitForFunction(() => (document.getElementById('repurpose-out').value || '').length > 20, null, { timeout: 30000 }).catch(() => { throw new Error('nie doczekano: tresc przerobki'); });
  // Typ Article: headline = H1, wiec z kodu widac, ktorego artykulu dotyczy.
  await s.evaluate(() => { document.getElementById('jsonld-type').value = 'article'; toggleJsonLd(); });
  await s.waitForTimeout(1200);
  const a = await stan(s);
  wynik('stan: artykul A z paskiem, przerobka, JSON-LD i SERP (przygotowanie)', a.pasek && a.przerobka.length > 20 && a.jsonOtwarte && a.serpPrzycisk,
    JSON.stringify({ pasek: a.pasek, przerobka: a.przerobka.length, json: a.jsonOtwarte, serp: a.serpPrzycisk }));

  // ── Artykul B bez SERP, z opoznieniem: stan W TRAKCIE ──
  await generuj(s, 'Rowery elektryczne do miasta [atrapa:opoznienie=4000@artykul]', false);
  await s.waitForTimeout(1500);
  const w = await stan(s);
  wynik('stan: w trakcie pasek statystyk schowany (R3-20)', !w.pasek, 'slowa=' + w.slowa);
  wynik('stan: w trakcie panel przerobek zamkniety i pusty', !w.przerobkaOtwarta && !w.przerobka, w.przerobka.slice(0, 60));
  wynik('stan: w trakcie bez wyniku Faktow poprzedniego artykulu', !w.faktyZnacznik, w.fakty.slice(0, 80));
  wynik('stan: w trakcie JSON-LD zamkniete', !w.jsonOtwarte);
  await zrzut(s, 'stan-w-trakcie');
  await krok('artykul B', czekajNaKoniec(s));
  await s.waitForTimeout(500);
  const pb = await stan(s);
  wynik('stan: po B pasek z liczbami B', pb.pasek && pb.slowa !== a.slowa || pb.pasek && /rower/i.test(pb.h1), 'A=' + a.slowa + ' B=' + pb.slowa);
  wynik('stan: po B bez przerobki i Faktow artykulu A', !pb.przerobka && !pb.faktyZnacznik, pb.przerobka.slice(0, 60) + ' | ' + pb.fakty.slice(0, 60));
  wynik('stan: po B bez przycisku SERP (B pisany bez SERP)', !pb.serpPrzycisk);
  const klik = await s.evaluate(() => { document.getElementById('jsonld-type').value = 'article'; toggleJsonLd(); return document.getElementById('jsonld-box').classList.contains('show'); });
  wynik('stan: pierwszy klik JSON-LD po nowym artykule otwiera pole', klik);
  await s.waitForTimeout(1000);
  const headlineB = await s.evaluate(() => ((document.getElementById('jsonld-code').textContent || '').match(/"headline"\s*:\s*"([^"]*)"/) || [])[1] || '');
  wynik('stan: JSON-LD opisuje artykul B', /rower/i.test(headlineB), headlineB);

  // ── Artykul A z historii ──
  await s.evaluate(() => { runRepurpose('linkedin'); });
  await s.waitForFunction(() => (document.getElementById('repurpose-out').value || '').length > 20, null, { timeout: 30000 }).catch(() => { throw new Error('nie doczekano: tresc przerobki'); });
  await s.evaluate(() => otworzWGeneratorze(1));
  await s.waitForTimeout(900);
  const h = await stan(s);
  wynik('stan: z historii przerobka zamknieta i pusta', !h.przerobkaOtwarta && !h.przerobka, h.przerobka.slice(0, 60));
  wynik('stan: z historii bez przycisku SERP cudzego artykulu', !h.serpPrzycisk);
  wynik('stan: z historii JSON-LD zamkniete i puste', !h.jsonOtwarte && !h.jsonKod.trim(), h.jsonKod.slice(0, 60));
  await s.evaluate(() => { document.getElementById('jsonld-type').value = 'article'; toggleJsonLd(); });
  await s.waitForTimeout(1000);
  const headlineA = await s.evaluate(() => ((document.getElementById('jsonld-code').textContent || '').match(/"headline"\s*:\s*"([^"]*)"/) || [])[1] || '');
  wynik('stan: z historii JSON-LD opisuje artykul A', /pomp/i.test(headlineA) && /pomp/i.test(h.h1), 'H1=' + h.h1 + ' headline=' + headlineA);

  // ── Fakty bez zaznaczonych zrodel (R3-27) ──
  for (const ktore of ['pierwsze', 'ponowne']) {
    await s.evaluate(() => {
      const p = document.getElementById('fakty-panel');
      if (p && getComputedStyle(p).display !== 'none') przelaczPanelFaktow();
      przelaczPanelFaktow();
    });
    await s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none', null, { timeout: 30000 }).catch(() => { throw new Error('nie doczekano: koniec ladowania Faktow'); });
    await s.waitForTimeout(400);
    const f = await s.evaluate(() => {
      const fw = document.getElementById('fakty-wynik');
      const ponow = document.getElementById('fakty-refresh-btn');
      return {
        tekst: (fw.innerText || '').replace(/\s+/g, ' ').trim(),
        zielone: !!fw.querySelector('[style*="c-sukces"]'),
        akcja: [...fw.querySelectorAll('button')].some((x) => x.textContent.indexOf(_t('fakty-wybierz-zrodla')) !== -1),
        ponow: !!ponow && getComputedStyle(ponow).display !== 'none',
      };
    });
    wynik('fakty bez zrodel (' + ktore + '): bez zielonego "bez zastrzezen", z akcja Bazy, bez "Sprawdz ponownie"',
      !f.zielone && f.akcja && !f.ponow, JSON.stringify(f).slice(0, 260));
  }

  // ── Liczby po polsku ──
  const liczby = await s.evaluate(() => ({ koszt: (document.getElementById('h-cost') || {}).textContent || '', fog: (document.getElementById('stat-fog') || {}).textContent || '' }));
  wynik('liczby: koszt sesji z przecinkiem dziesietnym (PL)', /^\$\d+,\d{3}$/.test(liczby.koszt), liczby.koszt);
  wynik('liczby: FOG bez kropki dziesietnej (PL)', !/\d\.\d/.test(liczby.fog), liczby.fog);
  wynik('stan: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'stan');
  await k.close();
}

// ── Runda 4, logika generowania (wykonawca A) ──────────────────────────────
// kod-01 pasek wyniku z Historii i po bledzie, kod-03 Generuj grupowo, kod-04 edycja,
// kod-05 Dopracuj tekst, kod-07 jedno generowanie naraz i Popraw, kod-16 spinner i jezyk.
async function scenariuszR4Logiki(b) {
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', {});
  const zapytania = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /anthropic\.com/.test(z.url())) zapytania.push(z.postData() || ''); });
  const artykuly = (od) => zapytania.slice(od).filter((t) => /Keywords to include naturally/.test(t));
  const ocenyPremium = (od) => zapytania.slice(od).filter((t) => /strict hybrid SEO\+AIO content evaluator|"AIO evaluator\.|"SEO content evaluator\./.test(t));
  const poprawy = (od) => zapytania.slice(od).filter((t) => /You are an? (hybrid SEO\+AIO|SEO|AIO) editor\. Fix only/.test(t));
  const powiadomienia = () => s.evaluate(() => [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | '));
  const bezPowiadomien = () => s.evaluate(() => document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()));
  const przyciski = () => s.evaluate(() => {
    const ids = ['fakty-btn', 'aeo-btn', 'geo-btn', 'tts-btn', 'premium-fix-btn', 'repurpose-wrap', 'jsonld-btn', 'seo-btn', 'copy-btn', 'edit-btn'];
    const brak = ids.filter((id) => { const el = document.getElementById(id); return !el || el.style.display === 'none'; });
    const wiecej = (document.getElementById('grupa-wiecej-wrap') || {}).style || {};
    return { brak, wiecej: wiecej.display };
  });

  // ── kod-01: ten sam pasek po generowaniu, z Historii i po bledzie ──
  await generuj(s, 'Artykul do paska wyniku', false);
  await krok('R4 artykul do paska', czekajNaKoniec(s));
  await s.evaluate(() => otworzWGeneratorze(0));
  await s.waitForTimeout(400);
  let p = await przyciski();
  wynik('R4 kod-01: z Historii pasek ma Fakty, AEO, GEO, Posluchaj, Dopracuj, przerobki, JSON-LD i Wiecej', !p.brak.length && p.wiecej === 'inline-flex', JSON.stringify(p));
  await generuj(s, 'Blad przed historia [atrapa:529@artykul]', false);
  await krok('R4 blad generowania', czekajNaKoniec(s));
  await s.evaluate(() => otworzWGeneratorze(0));
  await s.waitForTimeout(400);
  p = await przyciski();
  wynik('R4 kod-01: po bledzie artykul z Historii ma pelny pasek', !p.brak.length && p.wiecej === 'inline-flex', JSON.stringify(p));

  // ── kod-04: zapis poprawek w trakcie edycji, nowe generowanie konczy edycje ──
  await s.evaluate(() => toggleEdit());
  await s.click('#article p');
  await s.keyboard.press('End');
  await s.keyboard.type(' WPISANE1');
  await s.waitForTimeout(1600);
  const e1 = await s.evaluate(() => ({ edycja: editMode, hist: (wpisHistorii(biezacyHist) || {}).html || '' }));
  wynik('R4 kod-04: poprawki w historii bez Gotowe (1 s po zmianie)', e1.edycja && /WPISANE1/.test(e1.hist), 'edycja=' + e1.edycja);
  await s.keyboard.type(' WPISANE2');
  await generuj(s, 'Nowy artykul w trakcie edycji', false);
  await krok('R4 generowanie po edycji', czekajNaKoniec(s));
  const e2 = await s.evaluate(() => ({
    klasa: document.body.classList.contains('edit-active'),
    pasek: document.getElementById('fmt-toolbar').classList.contains('show'),
    edycja: editMode, stary: (history[1] || {}).html || '',
  }));
  wynik('R4 kod-04: nowe generowanie konczy edycje (bez edit-active i paska formatowania)', !e2.klasa && !e2.pasek && !e2.edycja, JSON.stringify({ klasa: e2.klasa, pasek: e2.pasek }));
  wynik('R4 kod-04: poprawki sprzed generowania zapisane w poprzednim wpisie', /WPISANE2/.test(e2.stary));

  // ── kod-05: Dopracuj tekst (znaczniki atrapy w temacie ARTYKULU: Dopracuj czyta kontekst artykulu, kod-08) ──
  await generuj(s, 'Artykul do dopracowania', false);
  await krok('R4 artykul do dopracowania', czekajNaKoniec(s));
  const przed = await s.evaluate(() => ({ hist: wpisHistorii(biezacyHist).html, zrodla: !!document.querySelector('#article .zrodla-box') }));
  let od = zapytania.length;
  await s.evaluate(() => { kontekstArt.temat = 'Artykul do dopracowania [atrapa:ocena=55@ocena-premium]'; runPostGenerationPremium(); });
  await krok('R4 dopracowanie', czekajNaKoniec(s, 30000));
  const po = await s.evaluate(() => ({ hist: wpisHistorii(biezacyHist).html, art: htmlDoZapisu(document.getElementById('article')), zrodla: !!document.querySelector('#article .zrodla-box'), odz: document.getElementById('out-badge').className }));
  const pop = poprawy(od);
  wynik('R4 kod-05: wynik Dopracuj w historii', po.hist !== przed.hist && po.hist === po.art && /ready/.test(po.odz), 'zmieniony=' + (po.hist !== przed.hist) + ' zgodny=' + (po.hist === po.art));
  wynik('R4 kod-05: do modelu bez listy zrodel, zrodla wracaja', pop.length === 1 && !/zrodla-box/.test(pop[0]) && po.zrodla === przed.zrodla, JSON.stringify({ poprawy: pop.length, zrodlaPrzed: przed.zrodla, zrodlaPo: po.zrodla }));
  await s.evaluate(() => { kontekstArt.temat = 'Dlugie dopracowanie [atrapa:opoznienie=8000@ocena-premium]'; runPostGenerationPremium(); });
  await s.waitForTimeout(1000);
  await s.click('#spin-stop');
  const przerwane = await krok('R4 Przerwij konczy Dopracuj', czekajNaKoniec(s, 3000));
  wynik('R4 kod-05: Przerwij zatrzymuje Dopracuj tekst', przerwane && await s.evaluate(() => !/ready|running/.test(document.getElementById('out-badge').className) && !!document.querySelector('#article h1')));
  await czekajNaKoniec(s, 15000).catch(() => {});
  await bezPowiadomien();
  await s.evaluate(() => { kontekstArt.temat = 'Blad dopracowania [atrapa:529@ocena-premium]'; runPostGenerationPremium(); });
  await krok('R4 Dopracuj z bledem', czekajNaKoniec(s, 30000));
  const pw = await powiadomienia();
  const wzorBledu = await s.evaluate(() => _t('msg-premium-blad').trim());
  wynik('R4 kod-05: blad Dopracuj widoczny, odznaka bez "gotowe"', pw.indexOf(wzorBledu) !== -1 && await s.evaluate(() => !/ready/.test(document.getElementById('out-badge').className)), pw.slice(0, 160));

  // ── kod-16: zmiana jezyka w trakcie nie cofa napisu spinnera ──
  await generuj(s, 'Jezyk w trakcie [atrapa:opoznienie=6000@artykul]', false);
  await s.waitForTimeout(3000);
  const sp = await s.evaluate(() => { applyLang('en'); const t = document.getElementById('spin-label').textContent; applyLang('pl');
    return { t, etap1: I18N.en['spin-knowledge'], pisanie: [I18N.en['spin-generating'], I18N.en['spin-generating-seo-aio']] }; });
  wynik('R4 kod-16: spinner po zmianie jezyka zostaje na etapie pisania', sp.t !== sp.etap1 && sp.pisanie.indexOf(sp.t) !== -1, JSON.stringify(sp));

  // ── kod-07: drugie generowanie w trakcie pierwszego ──
  od = zapytania.length;
  await s.evaluate(() => {
    openImproveModal();
    document.getElementById('improve-input').value = 'TEKST-W-TRAKCIE do poprawy';
    runImprove();
    generujZSzyny();
  });
  await s.waitForTimeout(500);
  const dwa = { artykuly: artykuly(od).length, pow: await powiadomienia() };
  wynik('R4 kod-07: Popraw i Ctrl+Enter w trakcie nie startuja drugiego generowania', dwa.artykuly === 0 && /trwa|already running/.test(dwa.pow), JSON.stringify(dwa).slice(0, 200));
  await krok('R4 koniec generowania', czekajNaKoniec(s));
  await s.evaluate(() => closeImproveModal());

  // ── kod-07: Popraw z samokorekta nie gubi wklejonego tekstu ──
  od = zapytania.length;
  await s.evaluate(() => {
    magazyn.removeItem('cai_samokorekta_ok');
    premiumMode = true;
    openImproveModal();
    document.getElementById('improve-input').value = 'MOJ-STARY-TEKST o rowerach miejskich i ich serwisie.';
    runImprove();
  });
  await s.waitForTimeout(400);
  await krok('R4 Popraw z samokorekta', czekajNaKoniec(s));
  const pt = await s.evaluate(() => { const o = document.getElementById('premium-modal').classList.contains('open'); closePremiumModal(); premiumMode = false; pokazSamokorekte();
    return { okno: o, tymczasowy: docs.some((d) => /MOJ-STARY-TEKST/.test(d.content || '')) }; });
  wynik('R4 kod-07: Popraw z samokorekta wysyla wklejony tekst', artykuly(od).some((t) => /MOJ-STARY-TEKST/.test(t)) && !pt.okno && !pt.tymczasowy, JSON.stringify(pt));

  // ── kod-03 / UX4-03: Generuj grupowo ──
  await bezPowiadomien();
  od = zapytania.length;
  const histPrzed = await s.evaluate(() => history.length);
  await s.evaluate(() => {
    keywords.length = 0; keywords.push('ludowe stroje krakowskie'); renderKws();
    document.getElementById('topic').value = 'Temat z briefu';
    magazyn.setItem('cai_samokorekta_ok', '1');
    premiumMode = true; pokazSamokorekte();
    openBulkModal();
    document.getElementById('bulk-topics').value = 'Rowery miejskie\nPompy ciepla [atrapa:529@artykul]\nKawa w biurze';
    updateBulkCount();
    startBulkGenerate();
  });
  await krok('R4 kolejka grupowa', s.waitForFunction(() => !bulkRunning, null, { timeout: 90000 }));
  const g = await s.evaluate(() => ({ temat: document.getElementById('topic').value, status: document.getElementById('bulk-status').textContent,
    ponow: !!document.getElementById('bulk-ponow') && document.getElementById('bulk-ponow').style.display !== 'none', hist: history.length }));
  const art = artykuly(od);
  wynik('R4 kod-03: tematy z kolejki bez fraz z briefu', art.length === 3 && !art.some((t) => /ludowe stroje/.test(t)) && !zapytania.slice(od).some((t) => /"zapytanie":"ludowe/.test(t)), 'artykulow=' + art.length);
  wynik('R4 kod-03: samokorekta dla calej kolejki', ocenyPremium(od).length === 2, 'ocen premium=' + ocenyPremium(od).length);
  wynik('R4 UX4-03: brief nie podmieniony na temat z kolejki', g.temat === 'Temat z briefu', g.temat);
  wynik('R4 UX4-03: licznik liczy tylko udane, jest Ponow nieudane', /2 z 3/.test(g.status) && g.ponow && g.hist === histPrzed + 2, JSON.stringify(g));
  await s.evaluate(() => { keywords.length = 0; renderKws(); });

  // ── kod-03: Escape w trakcie zatrzymuje kolejke ──
  od = zapytania.length;
  const histStop = await s.evaluate(() => history.length);
  await s.evaluate(() => {
    openBulkModal();
    document.getElementById('bulk-topics').value = 'Dlugi temat [atrapa:opoznienie=8000@artykul]\nDrugi temat\nTrzeci temat';
    updateBulkCount();
    startBulkGenerate();
  });
  await s.waitForTimeout(1200);
  await s.keyboard.press('Escape');
  const zamkniete = await s.evaluate(() => !document.getElementById('bulk-modal').classList.contains('open'));
  const koniec = await krok('R4 kolejka zatrzymana', s.waitForFunction(() => !bulkRunning && getComputedStyle(document.getElementById('spinner')).display === 'none', null, { timeout: 5000 }));
  await s.waitForTimeout(1200);
  const hs = await s.evaluate(() => history.length);
  wynik('R4 kod-03: Escape zamyka okno i zatrzymuje kolejke (bez kolejnych tematow)', zamkniete && koniec && artykuly(od).length === 1 && hs === histStop, JSON.stringify({ zamkniete, artykuly: artykuly(od).length, hist: hs - histStop }));

  wynik('R4 logika: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r4-logika');
  await k.close();
}

async function scenariuszBledow(b) {
  const st = {};
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', st);
  const tekstBledu = () => s.evaluate(() => {
    const kb = document.querySelector('#article .komunikat-bledu');
    if (!kb) return null;
    const p = kb.querySelector('p');
    return {
      tekst: (p ? p.innerText : kb.innerText).replace(/\s+/g, ' ').trim(),
      ponow: !!kb.querySelector('.ponow-generowanie'),
      klucze: !!kb.querySelector('[onclick="otworzUstawieniaKlucza()"]'),
      pasek: document.getElementById('article-stats').classList.contains('show'),
    };
  });
  const oczekiwane = {
    401: ['err-klucz', false, true], 'za-dlugi': ['err-za-dlugi', false, false], srodki: ['err-srodki', false, false],
    403: ['err-uprawnienia', false, false], 413: ['err-za-duze', false, false],
    500: ['err-server-500', true, false], 529: ['err-overloaded', true, false], siec: ['err-siec', true, false],
  };
  // Najpierw udany artykul: pasek statystyk po bledzie nie moze zostac z jego liczbami.
  await generuj(s, 'Udany artykul przed bledami', false);
  await krok('artykul przed bledami', czekajNaKoniec(s));
  for (const [blad, [klucz, ponow, klucze]] of Object.entries(oczekiwane)) {
    st.blad = blad; st.gdzie = 'anthropic';
    await generuj(s, 'Test komunikatu bledu ' + blad, false);
    await krok('blad ' + blad, czekajNaKoniec(s));
    const t = await tekstBledu();
    const wzor = await s.evaluate((k) => _t(k), klucz);
    wynik('blad ' + blad + ': komunikat ze slownika, bez surowego tekstu dostawcy',
      !!t && t.tekst.indexOf(wzor) !== -1 && !SUROWE.test(t.tekst), t ? t.tekst.slice(0, 160) : 'brak komunikatu');
    wynik('blad ' + blad + ': "Sprobuj ponownie" ' + (ponow ? 'jest' : 'nie ma') + (klucze ? ', jest przycisk kluczy' : ''),
      !!t && t.ponow === ponow && t.klucze === klucze, JSON.stringify(t));
    wynik('blad ' + blad + ': pasek statystyk poprzedniego artykulu schowany', !!t && !t.pasek);
  }
  st.blad = null;

  // Panel SEO: ten sam komunikat w panelu, ponowienie tylko przy bledzie przejsciowym.
  await generuj(s, 'Artykul do oceny SEO', false);
  await krok('artykul do oceny', czekajNaKoniec(s));
  for (const [blad, klucz, ponow] of [['401', 'err-klucz', false], ['529', 'err-overloaded', true]]) {
    st.blad = blad; st.gdzie = 'anthropic';
    await s.evaluate(() => { seoOpen = false; toggleSeoPanel(true); });
    await s.waitForFunction(() => !!document.querySelector('#seo-content .komunikat-bledu'), null, { timeout: 30000 }).catch(() => { throw new Error('nie doczekano: komunikat bledu w panelu SEO'); });
    const p = await s.evaluate((k) => {
      const kb = document.querySelector('#seo-content .komunikat-bledu');
      return kb ? { ok: kb.innerText.indexOf(_t(k)) !== -1, ponow: !!kb.querySelector('.ponow-generowanie'), tekst: kb.innerText.slice(0, 160) } : null;
    }, klucz);
    wynik('panel SEO, blad ' + blad + ': komunikat ze slownika, ponowienie ' + (ponow ? 'jest' : 'nie ma'),
      !!p && p.ok && p.ponow === ponow && !SUROWE.test(p.tekst.split('\n')[0]), JSON.stringify(p));
  }
  st.blad = null;

  // Generator grafik: zly klucz OpenAI w powiadomieniu, bez surowego "Incorrect API key".
  st.blad = 'openai-401'; st.gdzie = 'openai';
  await s.evaluate(() => {
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    const c = document.getElementById('img-context'); if (c) c.value = 'Pompa ciepla w ogrodzie';
    generateImage();
  });
  await s.waitForFunction(() => document.querySelectorAll('.powiadomienie').length > 0, null, { timeout: 30000 }).catch(() => { throw new Error('nie doczekano: powiadomienie'); });
  const pow = await s.evaluate(() => [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | '));
  const wzorKlucza = await s.evaluate(() => _t('err-klucz'));
  wynik('grafika, zly klucz OpenAI: powiadomienie ze slownika', pow.indexOf(wzorKlucza) !== -1 && !SUROWE.test(pow), pow.slice(0, 200));
  st.blad = null;
  wynik('bledy: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'bledy');
  await k.close();

  // Interfejs EN: ten sam blad po angielsku, liczby z kropka.
  const en = {};
  const e = await nowaStrona(b, 'en', en);
  en.blad = '401'; en.gdzie = 'anthropic';
  await generuj(e.s, 'Error message test in English', false);
  await krok('blad EN', czekajNaKoniec(e.s));
  const tEn = await e.s.evaluate(() => {
    const kb = document.querySelector('#article .komunikat-bledu');
    return kb ? kb.innerText.replace(/\s+/g, ' ').trim() : '';
  });
  wynik('EN: zly klucz po angielsku, bez polskiego zdania', /rejected the API key/.test(tEn) && !/Dostawca|Błąd/.test(tEn), tEn.slice(0, 160));
  en.blad = null;
  await generuj(e.s, 'English article for numbers', false);
  await krok('artykul EN', czekajNaKoniec(e.s));
  const kosztEn = await e.s.evaluate(() => (document.getElementById('h-cost') || {}).textContent || '');
  wynik('EN: koszt sesji z kropka dziesietna', /^\$\d+\.\d{3}$/.test(kosztEn), kosztEn);
  wynik('EN: bez bledow JavaScript', !e.bledyJs.length, e.bledyJs.join(' | '));
  await e.k.close();
}

// ── Runda 4, wykonawca B: historia z trwalym id, kontekst artykulu, funkcje wyniku ──
// Tresci zapytan do dostawcy zbierane, zeby sprawdzic, z jakiego kontekstu korzysta
// funkcja: z artykulu czy z briefu.
function zbieraczZapytan(s) {
  const lista = [];
  s.on('request', (r) => {
    if (r.method() !== 'POST' || !/api\.anthropic\.com/.test(r.url())) return;
    try { lista.push(r.postData() || ''); } catch (e) { /* bez ciala */ }
  });
  return {
    lista,
    ostatnie: (re) => [...lista].reverse().find((t) => re.test(t)) || '',
    wyczysc: () => { lista.length = 0; },
  };
}
async function czekajNaZapytanie(s, z, re, ms) {
  const koniec = Date.now() + (ms || 20000);
  while (Date.now() < koniec) { if (z.ostatnie(re)) return z.ostatnie(re); await s.waitForTimeout(150); }
  throw new Error('nie doczekano zapytania ' + re);
}

async function scenariuszHistoriiR4(b) {
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', {});
  const z = zbieraczZapytan(s);
  const RE_TYT = /SEO title specialist/;

  // ── kod-06: odznaczone dokumenty bazy nie ida do artykulu ──
  await s.evaluate(() => {
    addDoc('Notatka odznaczona', 'ZNACZNIK-ODZNACZONY-1 tresc dokumentu, ktorego autor nie chce w artykule.', '📄');
    docs.forEach((d) => { d.selected = false; });
    renderDocs();
    keywords.length = 0; keywords.push('fraza-artykulu-a'); renderKws();
    document.getElementById('extra').value = 'WYTYCZNA-A';
  });
  z.wyczysc();
  await generuj(s, 'Pompy ciepla AAA', false);
  await krok('R4 artykul A', czekajNaKoniec(s));
  const artA = z.ostatnie(/expert content strategist|SEO and content writer/);
  wynik('R4 kod-06: odznaczony dokument nie trafia do promptu artykulu', !!artA && artA.indexOf('ZNACZNIK-ODZNACZONY-1') === -1, artA ? 'znacznik w promptcie' : 'brak zapytania');
  const etykieta = await s.evaluate(() => [(document.getElementById('kb-select-label') || {}).textContent || '', _t('sidebar-none-selected')]);
  wynik('R4 kod-06: panel mowi, ze nic nie zaznaczone nie zostanie uzyte', etykieta[0] === etykieta[1], etykieta[0]);
  const wpisA = await s.evaluate(() => ({ id: biezacyHist, mag: magazyn.getItem('cai_biezacy'), k: history[0].kontekst, ts: history[0].ts }));
  wynik('R4 kod-09: wpis ma trwale id, cai_biezacy to id', typeof wpisA.id === 'string' && wpisA.id === wpisA.mag && !!wpisA.ts, JSON.stringify(wpisA).slice(0, 200));
  wynik('R4 kod-08: wpis niesie kontekst artykulu (frazy, typ, jezyk, wytyczne)',
    !!wpisA.k && (wpisA.k.frazy || []).join() === 'fraza-artykulu-a' && wpisA.k.jezyk === 'Polski' && !!wpisA.k.typ && wpisA.k.extra === 'WYTYCZNA-A', JSON.stringify(wpisA.k));

  // ── kod-11: kontekst grafiki z artykulu A (tak jak przy otwarciu Grafiki) ──
  await s.evaluate(() => { toggleImgPanel(); toggleImgPanel(); });
  const grafA = await s.evaluate(() => document.getElementById('img-context').value);

  // ── kod-08: brief opisuje juz nastepny tekst; Tytuly, SEO i AIO biora artykul ──
  await s.evaluate(() => {
    document.getElementById('topic').value = 'NOWY TEMAT W TOKU';
    keywords.length = 0; keywords.push('nowa-fraza-briefu'); renderKws();
    document.getElementById('lang').value = 'English';
  });
  z.wyczysc();
  await s.evaluate(() => { openTitlesPanel(); });
  const tyt = await czekajNaZapytanie(s, z, RE_TYT);
  wynik('R4 kod-08: Tytuly z tematu i frazy artykulu, nie z briefu',
    /Topic: Pompy ciepla AAA/.test(tyt) && /Main keyword: fraza-artykulu-a/.test(tyt) && !/NOWY TEMAT|nowa-fraza-briefu/.test(tyt) && /in Polish/.test(tyt), tyt.slice(0, 300));
  await s.waitForTimeout(600);
  await s.evaluate(() => closeTitlesModal());
  await s.evaluate(() => { seoOpen = false; toggleSeoPanel(true); });
  const seo = await czekajNaZapytanie(s, z, /content SEO expert evaluating/);
  wynik('R4 kod-08: ocena SEO z tematu i fraz artykulu', /Temat: Pompy ciepla AAA/.test(seo) && /fraza-artykulu-a/.test(seo) && !/NOWY TEMAT/.test(seo), seo.slice(0, 200));
  await s.evaluate(() => { aioOpen = false; toggleAioPanel(true); });
  const aio = await czekajNaZapytanie(s, z, /AIO \(AI Overview Optimization\) expert/);
  wynik('R4 kod-08: ocena AIO z tematu artykulu', /Pompy ciepla AAA/.test(aio) && !/NOWY TEMAT/.test(aio), aio.slice(0, 200));
  await s.waitForTimeout(600);
  await s.evaluate(() => { document.getElementById('lang').value = 'Polski'; });

  // ── kod-08: napis ladowania Tytulow po bledzie wraca do "Generuje warianty" ──
  const ladowanie = await s.evaluate(() => {
    document.getElementById('titles-loading').textContent = 'STARY BLAD';
    openTitlesPanel();
    return [document.getElementById('titles-loading').textContent, _t('titles-loading')];
  });
  wynik('R4 kod-08: Tytuly przy otwarciu pokazuja napis ladowania, nie stary blad', ladowanie[0] === ladowanie[1], ladowanie[0]);
  await s.waitForTimeout(800);
  await s.evaluate(() => closeTitlesModal());

  // ── kod-12: przerobka z calego artykulu, bez zrodel i meta; bez wyscigu ──
  // LinkedIn odpowiada wolno, FAQ szybko: stara odpowiedz nie moze nadpisac nowej.
  await s.route(/api\.anthropic\.com/, async (route) => {
    const cialo = route.request().postData() || '';
    if (/content repurposing specialist/.test(cialo) && /LinkedIn/.test(cialo)) await new Promise((ok) => setTimeout(ok, 2500));
    return route.fallback();
  });
  const metaA = await s.evaluate(() => {
    const art = document.getElementById('article');
    const p = document.createElement('p'); p.textContent = 'dlugi tekst '.repeat(500) + ' ZNACZNIK-KONCA-ARTYKULU';
    const meta = art.querySelector('.meta-box'); art.insertBefore(p, meta || null);
    return ((art.querySelector('.meta-box p') || {}).textContent || '').trim();
  });
  z.wyczysc();
  await s.evaluate(() => { runRepurpose('linkedin'); });
  await s.waitForTimeout(300);
  await s.evaluate(() => { runRepurpose('faq'); });
  await s.waitForTimeout(4000);
  const rp = await s.evaluate(() => ({ tytul: document.getElementById('repurpose-title').textContent, tekst: document.getElementById('repurpose-out').value }));
  wynik('R4 kod-12: spozniona przerobka LinkedIn nie nadpisuje FAQ', /Q:/.test(rp.tekst), rp.tytul + ' | ' + rp.tekst.slice(0, 120));
  const rpZap = z.ostatnie(/content repurposing specialist/);
  wynik('R4 kod-12: przerobka dostaje koniec dlugiego artykulu, bez opisu meta',
    rpZap.indexOf('ZNACZNIK-KONCA-ARTYKULU') !== -1 && (!metaA || rpZap.indexOf(metaA.slice(0, 60)) === -1) && /temat: Pompy ciepla AAA/.test(rpZap), rpZap.length + ' znakow');
  await s.unroute(/api\.anthropic\.com/);

  // ── Artykul B; kod-11: kontekst grafiki A nie przechodzi na B ──
  await s.evaluate(() => { keywords.length = 0; renderKws(); document.getElementById('extra').value = ''; });
  await generuj(s, 'Rowery elektryczne BBB', false);
  await krok('R4 artykul B', czekajNaKoniec(s));
  const grafPoB = await s.evaluate(() => document.getElementById('img-context').value);
  await s.evaluate(() => { toggleImgPanel(); toggleImgPanel(); });
  const grafB = await s.evaluate(() => document.getElementById('img-context').value);
  wynik('R4 kod-11: grafika po nowym artykule nie opisuje poprzedniego', grafA.length > 20 && grafPoB === '' && /rower/i.test(grafB),
    JSON.stringify({ a: grafA.slice(0, 40), poB: grafPoB.slice(0, 40), b: grafB.slice(0, 40) }));
  z.wyczysc();
  // Artykul angielski: prompt grafiki nie moze mowic "Article content (Polish".
  await s.evaluate(() => { const j = jezykArtykulu; jezykArtykulu = 'en'; const o = imgBuildAIPrompt('Heat pumps at home', 'photo', '', 1024, 1024); jezykArtykulu = j; return o.then(() => '', () => ''); });
  const graf = await czekajNaZapytanie(s, z, /expert art director/).catch(() => '');
  wynik('R4 kod-11: prompt grafiki z jezykiem artykulu, nie na sztywno "Polish"', /Article content \(English/.test(graf), graf.slice(0, 200));

  // ── kod-02: otwarcie A z Historii nie rusza briefu; kontekst A w Tytulach ──
  await s.evaluate(() => { document.getElementById('topic').value = 'NOWY TEMAT W TOKU'; });
  const idA = wpisA.id;
  await s.evaluate((id) => otworzWGeneratorze(id), idA);
  await s.waitForTimeout(500);
  const poHist = await s.evaluate(() => ({ t: document.getElementById('topic').value, h1: ((document.querySelector('#article h1') || {}).textContent || ''), biez: biezacyHist }));
  wynik('R4 kod-02: otwarcie wpisu z Historii nie nadpisuje tematu w briefie', poHist.t === 'NOWY TEMAT W TOKU' && /pomp|fraza-artykulu-a/i.test(poHist.h1) && poHist.biez === idA, JSON.stringify(poHist));
  z.wyczysc();
  await s.evaluate(() => { openTitlesPanel(); });
  const tytA = await czekajNaZapytanie(s, z, RE_TYT);
  wynik('R4 kod-08: Tytuly artykulu z Historii z jego tematu i frazy', /Topic: Pompy ciepla AAA/.test(tytA) && /fraza-artykulu-a/.test(tytA), tytA.slice(0, 200));
  await s.waitForTimeout(600);
  await s.evaluate(() => closeTitlesModal());

  // ── kod-17: wybrana wersja w historii, osobne wyniki ocen, hash z calego tekstu ──
  const wersja = await s.evaluate(() => {
    const art = document.getElementById('article');
    addVersion(htmlDoZapisu(art), 'A');
    const kopia = art.cloneNode(true); kopia.querySelector('h1').textContent = 'WERSJA-DRUGA';
    addVersion(kopia.innerHTML, 'B');
    activeVersion = 0; // na ekranie jest wersja A
    switchVersion(1);
    const poB = wpisHistorii(biezacyHist).html.indexOf('WERSJA-DRUGA') !== -1;
    seoCache = { articleHash: 1, result: {} };
    switchVersion(0);
    return { poB, poA: wpisHistorii(biezacyHist).html.indexOf('WERSJA-DRUGA') === -1, cache: seoCache,
      hash: simpleHash('x'.repeat(600) + 'a') !== simpleHash('x'.repeat(600) + 'b'),
      zapis: JSON.parse(magazyn.getItem('cai_history_v2')).find((h) => h.id === biezacyHist).html.indexOf('WERSJA-DRUGA') === -1 };
  });
  wynik('R4 kod-17: wybrana wersja trafia do wpisu historii i magazynu', wersja.poB && wersja.poA && wersja.zapis, JSON.stringify(wersja));
  wynik('R4 kod-17: przelaczenie wersji zeruje cache ocen, hash z calego tekstu', wersja.cache === null && wersja.hash, JSON.stringify(wersja));

  // ── kod-09: podglad na komputerze nie kasuje wersji; "Otworz" otwiera wlasciwy wpis ──
  const idB = await s.evaluate(() => history[0].id);
  await s.evaluate(() => { switchTab('history', document.querySelector('.tab[onclick*="history"]')); });
  await s.evaluate((id) => previewHistory(id), idB);
  const podglad = await s.evaluate(() => ({ wersje: versions.length, pasek: document.getElementById('versions-bar').classList.contains('show') }));
  wynik('R4 kod-09: podglad Historii nie kasuje wersji artykulu w generatorze', podglad.wersje === 2 && podglad.pasek, JSON.stringify(podglad));
  await s.evaluate((id) => previewHistory(id), idA);
  await s.evaluate(() => { switchTab('generator', document.querySelector('.tab[onclick*="generator"]')); });
  await generuj(s, 'Kawa w biurze CCC', false);
  await krok('R4 artykul C', czekajNaKoniec(s));
  await s.evaluate(() => document.getElementById('h-preview-otworz').click());
  await s.waitForTimeout(500);
  const otw = await s.evaluate(() => ({ h1: ((document.querySelector('#article h1') || {}).textContent || ''), biez: biezacyHist }));
  wynik('R4 kod-09: "Otworz w generatorze" po nowym artykule otwiera podgladany wpis', otw.biez === idA && /pomp|fraza-artykulu-a/i.test(otw.h1), JSON.stringify(otw));

  // ── kod-17: data we wpisie i usuwanie z potwierdzeniem ──
  await s.evaluate(() => { switchTab('history', document.querySelector('.tab[onclick*="history"]')); renderHistory(); });
  const meta = await s.evaluate(() => [(document.querySelector('#h-list-inner .h-item .h-item-meta') || {}).textContent || '', new Date().toLocaleString('pl-PL', { month: 'short' })]);
  wynik('R4 kod-17: wpis historii pokazuje date, nie tylko godzine', meta[0].indexOf(meta[1]) !== -1 && /\d{2}:\d{2}/.test(meta[0]), meta[0]);
  const przed = await s.evaluate(() => history.length);
  await s.click('#h-list-inner .h-item[data-id="' + idA + '"] .h-usun');
  await s.waitForTimeout(300);
  const usun = await s.evaluate((id) => ({ n: history.length, jest: !!wpisHistorii(id), mag: JSON.parse(magazyn.getItem('cai_history_v2')).some((h) => h.id === id), biez: biezacyHist }), idA);
  wynik('R4 kod-17: usuniecie wpisu (po potwierdzeniu) z listy i magazynu', usun.n === przed - 1 && !usun.jest && !usun.mag && usun.biez === null, JSON.stringify(usun));

  // ── kod-10: bez obcinania dlugiego artykulu i dokumentu; pelny magazyn - komunikat ──
  const zapis = await s.evaluate(() => {
    history[0].html = '<h1>Dlugi</h1><p>' + 'slowo '.repeat(8000) + 'KONIEC-ARTYKULU</p>';
    addDoc('Dlugi dokument', 'tekst '.repeat(12000) + 'KONIEC-DOKUMENTU', '📄');
    saveState();
    const h = JSON.parse(magazyn.getItem('cai_history_v2'))[0];
    const d = JSON.parse(magazyn.getItem('cai_docs_v2')).find((x) => x.name === 'Dlugi dokument');
    return { h: h.html.indexOf('KONIEC-ARTYKULU') !== -1, jezyk: h.jezyk, d: !!d && d.content.indexOf('KONIEC-DOKUMENTU') !== -1 };
  });
  wynik('R4 kod-10: dlugi artykul i dokument zapisane w calosci, z jezykiem wpisu', zapis.h && zapis.d && zapis.jezyk === 'pl', JSON.stringify(zapis));
  const pelny = await s.evaluate(() => {
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    for (let i = 0; i < 6; i++) history.push(Object.assign({}, history[0], { id: 'stary' + i, topic: 'Stary ' + i }));
    const n = history.length;
    const oryg = magazyn.setItem;
    // Atrapa pelnego magazynu: historia miesci sie najwyzej w 3 wpisach.
    magazyn.setItem = function (klucz, v) { if (klucz === 'cai_history_v2' && JSON.parse(v).length > 3) return false; return oryg.call(magazyn, klucz, v); };
    try { saveState(); } finally { magazyn.setItem = oryg; }
    return { przed: n, po: history.length, zapis: JSON.parse(magazyn.getItem('cai_history_v2')).length,
      pow: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | ') };
  });
  wynik('R4 kod-10: pelny magazyn - najstarsze wpisy usuniete i komunikat', pelny.po === 3 && pelny.zapis === 3 && /historii/.test(pelny.pow), JSON.stringify(pelny));

  // ── kod-14: wklejanie w Edytuj bez obcych stylow; zapis bez stylow ──
  await s.evaluate(() => { switchTab('generator', document.querySelector('.tab[onclick*="generator"]')); otworzWGeneratorze(history[0].id); });
  await s.waitForTimeout(300);
  await s.evaluate(() => { if (!editMode) toggleEdit(); });
  const wklej = await s.evaluate(() => {
    const art = document.getElementById('article');
    const p = art.querySelector('p');
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/html', '<span style="color:rgb(255,255,255);background-color:rgb(32,33,36);font-family:Comic Sans MS;font-size:28px">WKLEJONE-Z-PRZEGLADARKI</span><font color="red">CZERWONE</font><img src="https://obcy.example/x.png">');
    dt.setData('text/plain', 'WKLEJONE-Z-PRZEGLADARKI CZERWONE');
    p.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const wynikWklejenia = { jest: art.textContent.indexOf('WKLEJONE-Z-PRZEGLADARKI') !== -1, styl: art.querySelectorAll('[style]').length, font: art.querySelectorAll('font, img').length };
    const sp = document.createElement('span'); sp.setAttribute('style', 'font-size: 17px; color: rgb(27, 26, 23)'); sp.textContent = 'STYL-PRZEGLADARKI';
    p.appendChild(sp);
    wynikWklejenia.zapisStyl = /style=/.test(htmlDoZapisu(art));
    return wynikWklejenia;
  });
  wynik('R4 kod-14: wklejony HTML bez stylow, font i obrazkow z obcych stron', wklej.jest && !wklej.styl && !wklej.font, JSON.stringify(wklej));
  wynik('R4 kod-14: zapis do historii i eksportu bez atrybutow style', !wklej.zapisStyl, JSON.stringify(wklej));
  await s.evaluate(() => { if (editMode) toggleEdit(); });

  // ── kod-13: szablony ustawiaja typ, ton i dlugosc (takze wlasna) ──
  const szab = await s.evaluate(() => {
    const st = () => ({ typ: document.getElementById('ctype').value, ton: document.getElementById('tone').value, dl: document.getElementById('length').value, wl: document.getElementById('length-custom').value });
    applyTemplate(3); const landing = st();
    applyLang('en'); applyTemplate(2); const faqEn = st(); applyLang('pl');
    templates.push({ name: 'Stary EN', desc: '', topic: 'T', type: 'FAQ page', length: '~1200 words', tone: 'Expert' });
    applyTemplate(templates.length - 1); const stary = st();
    templates.pop();
    return { landing, faqEn, stary };
  });
  wynik('R4 kod-13: szablon Landing page ustawia typ i ton (PL)', szab.landing.typ === 'Landing page copy' && szab.landing.ton === 'Ekspercki', JSON.stringify(szab.landing));
  wynik('R4 kod-13: szablon FAQ w EN ustawia typ i ton', szab.faqEn.typ === 'FAQ page' && szab.faqEn.ton === 'Przyjazny', JSON.stringify(szab.faqEn));
  wynik('R4 kod-13: wlasny szablon zapisany w EN ustawia ton i dlugosc wlasna w PL',
    szab.stary.typ === 'FAQ page' && szab.stary.ton === 'Ekspercki' && szab.stary.dl === 'custom' && szab.stary.wl === '1200', JSON.stringify(szab.stary));

  // ── UX4-10: Popraw bierze temat z okna (albo domyslny), nie stary temat briefu ──
  await s.evaluate(() => {
    document.getElementById('topic').value = 'STARY TEMAT BRIEFU';
    openImproveModal();
    document.getElementById('improve-input').value = 'Tekst ze strony firmy do poprawy. '.repeat(20);
    document.getElementById('improve-topic').value = 'Temat z okna Popraw';
  });
  z.wyczysc();
  await s.evaluate(() => { runImprove(); });
  await krok('R4 Popraw', czekajNaKoniec(s));
  const pop = z.ostatnie(/expert content strategist|SEO and content writer/);
  const popBrief = await s.evaluate(() => document.getElementById('topic').value);
  wynik('R4 UX4-10: Popraw pisze pod temat z okna, brief zostaje', /Temat z okna Popraw/.test(pop) && !/STARY TEMAT BRIEFU/.test(pop) && popBrief === 'STARY TEMAT BRIEFU',
    popBrief + ' | ' + ((pop.match(/about: [^\\]{0,60}/) || [])[0] || ''));

  wynik('R4 historia i kontekst: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r4-historia');
  await k.close();

  // ── UX4-06: interfejs EN przy pierwszym uruchomieniu - jezyk tekstu English ──
  const e = await nowaStrona(b, 'en', {});
  const jezykEn = await e.s.evaluate(() => document.getElementById('lang').value);
  const wybor = await e.s.evaluate(() => {
    const l = document.getElementById('lang'); l.value = 'Deutsch'; l.dispatchEvent(new Event('change'));
    applyLang('pl'); applyLang('en');
    return l.value;
  });
  wynik('R4 UX4-06: interfejs EN - jezyk tekstu English, wybor autora zostaje', jezykEn === 'English' && wybor === 'Deutsch', jezykEn + ' / ' + wybor);
  wynik('R4 UX4-06: bez bledow JavaScript', !e.bledyJs.length, e.bledyJs.join(' | '));
  await e.k.close();
}

// ── R9-F (runda 9, wykonawca F): poprawki z audytu kodu KOD8 ──────────────────────────────
// Wariant keys z pliku: okno tekstu (KOD8-03).
async function scenariuszR9FKeys(b) {
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', {});
  // KOD8-03: fokus po otwarciu okna tekstu nie przeskakuje do nazwy, gdy autor pisze juz tresc
  // (drugi, opozniony o 80 ms focus() przenosil reszte tekstu do pola nazwy).
  // Autor przechodzi do Tresci 30 ms po otwarciu okna i pisze (20 ms na znak, przez znacznik 80 ms).
  await s.evaluate(() => new Promise((ok) => { openTextModal(); setTimeout(() => { document.getElementById('m-content').focus(); ok(); }, 30); }));
  await s.keyboard.type('Tresc wpisana od razu', { delay: 20 });
  await s.waitForTimeout(200);
  const fokus = await s.evaluate(() => ({ akt: (document.activeElement || {}).id || '', nazwa: document.getElementById('m-name').value, tresc: document.getElementById('m-content').value }));
  wynik('R9-F KOD8-03: okno tekstu - wpisywana tresc zostaje w polu Tresc (fokus nie przeskakuje)',
    fokus.akt === 'm-content' && fokus.nazwa === '' && fokus.tresc === 'Tresc wpisana od razu', JSON.stringify(fokus));
  // Dodaj z pusta trescia: komunikat przy polu i fokus na nim (wczesniej okno stalo bez slowa).
  await s.evaluate(() => { document.getElementById('m-name').value = 'Tylko nazwa'; document.getElementById('m-content').value = ''; saveText(); });
  const pusta = await s.evaluate(() => { const m = document.getElementById('m-blad'); return { otwarte: document.getElementById('text-modal').classList.contains('open'),
    komunikat: m ? m.textContent : '', wzor: typeof _t === 'function' ? _t('text-brak-tresci') : '', rola: m ? m.getAttribute('role') : '', akt: (document.activeElement || {}).id || '',
    niepoprawne: document.getElementById('m-content').getAttribute('aria-invalid') }; });
  wynik('R9-F KOD8-03: Dodaj bez tresci - komunikat przy polu Tresc i fokus na nim',
    pusta.otwarte && !!pusta.komunikat && pusta.komunikat === pusta.wzor && pusta.rola === 'alert' && pusta.akt === 'm-content' && pusta.niepoprawne === 'true', JSON.stringify(pusta));
  await s.evaluate(() => { document.getElementById('m-content').value = 'Montaz kosztuje od 18 do 35 tys. zl.'; saveText(); });
  const zapis = await s.evaluate(() => ({ otwarte: document.getElementById('text-modal').classList.contains('open'), komunikat: !!document.getElementById('m-blad'), doc: docs.some((d) => d.name === 'Tylko nazwa') }));
  wynik('R9-F KOD8-03: po uzupelnieniu tresci dokument zapisany, okno zamkniete, komunikat znika', !zapis.otwarte && !zapis.komunikat && zapis.doc, JSON.stringify(zapis));
  wynik('R9-F keys: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-keys');
  await k.close();
}

// KOD8-14: telefon, Historia -> Pisz. Animacja wejscia pol wymuszala pelny uklad strony osobno dla panelu
// i kazdego pola (11 przeliczen w jednym zadaniu, ok. 1 s zamrozenia na CPU x4). Miara: przeliczenia ukladu
// (CDP Performance.LayoutCount) ponad liczbe klatek w oknie pomiaru. Zwykly uklad raz na klatke zalezy od
// wersji przegladarki (Chromium 141: 2 na 5 klatek, Chrome Headless Shell 153 w CI: 6-7), wymuszone nie.
async function scenariuszR9FTelefonPisz(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await k.addInitScript(() => { try { localStorage.setItem('cai_key_anthropic', 'sk-ant-atrapa'); localStorage.setItem('cai_lang', 'pl'); localStorage.setItem('cai_start_v1', '1'); sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  const s = await k.newPage();
  const bledyJs = [];
  s.on('pageerror', (e) => bledyJs.push(e.message.slice(0, 160)));
  await s.goto(PLIK, { waitUntil: 'load' });
  await s.waitForTimeout(1200);
  const cdp = await k.newCDPSession(s);
  await cdp.send('Performance.enable');
  const uklady = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount') || {}).value || 0;
  const pomiary = [];
  for (let i = 0; i < 2; i++) {
    await s.evaluate(() => switchMobileTab('history'));
    await s.waitForTimeout(700);
    const przed = await uklady();
    const klatki = await s.evaluate(() => new Promise((ok) => {
      let n = 0, liczy = true;
      const licz = () => { if (!liczy) return; n++; requestAnimationFrame(licz); };
      requestAnimationFrame(licz);
      switchMobileTab('generator');
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { liczy = false; ok(n); }, 50)));
    }));
    pomiary.push({ uklady: (await uklady()) - przed, klatki });
  }
  console.log('  KOD8-14 pomiar (przeliczenia ukladu i klatki w oknie): ' + JSON.stringify(pomiary));
  const pola = await s.evaluate(() => ({ n: document.querySelectorAll('#tab-generator .field').length,
    animacje: [...document.querySelectorAll('#tab-generator .field')].filter((f) => f.getAnimations().length > 0).length }));
  // Start na telefonie: odswiezInspektor czytal window.innerWidth (wymuszony uklad calej strony), choc na telefonie wynik jest bez znaczenia.
  const odczyty = await s.evaluate(() => {
    let n = 0;
    const d = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { configurable: true, get() { n++; return d.get.call(window); } });
    try { odswiezInspektor(); } finally { Object.defineProperty(window, 'innerWidth', d); }
    return n;
  });
  wynik('R9-F KOD8-14: telefon - odswiezInspektor bez odczytu innerWidth (bez wymuszonego ukladu przy starcie)', odczyty === 0, 'odczytow: ' + odczyty);
  wynik('R9-F KOD8-14: telefon Historia -> Pisz bez przeliczania ukladu dla kazdego pola (najwyzej 4 uklady ponad klatki)',
    pomiary.every((p) => p.uklady - p.klatki <= 4), JSON.stringify({ pomiary, pola }));
  wynik('R9-F KOD8-14: pola Pisz nadal wjezdzaja animacja', pola.n >= 5 && pola.animacje >= pola.n - 1, JSON.stringify(pola));
  wynik('R9-F KOD8-14: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-telefon-pisz');
  await k.close();
}

// KOD8-25: temat bez limitu dlugosci (wklejony akapit) rozsadzal wpis Historii na telefonie; temat z samych
// spacji: "Wygeneruj" nic nie mowil.
async function scenariuszR9FTemat(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await k.addInitScript(() => { try { localStorage.setItem('cai_key_anthropic', 'sk-ant-atrapa'); localStorage.setItem('cai_lang', 'pl'); localStorage.setItem('cai_start_v1', '1'); sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  await k.route(/api\.anthropic\.com|api\.openai\.com|api\.elevenlabs\.io/, atrapa.obsluzRoute);
  const s = await k.newPage();
  const bledyJs = [];
  s.on('pageerror', (e) => bledyJs.push(e.message.slice(0, 160)));
  await s.goto(PLIK, { waitUntil: 'load' });
  await s.waitForTimeout(700);
  await s.focus('#topic');
  await s.keyboard.insertText('Pompy ciepla w domu jednorodzinnym, '.repeat(12));
  const dlugi = await s.evaluate(() => ({ dl: document.getElementById('topic').value.length, podp: ((document.getElementById('topic-podpowiedz') || {}).textContent || '') }));
  wynik('R9-F KOD8-25: temat najwyzej 300 znakow, z podpowiedzia o Dodatkowych wytycznych', dlugi.dl === 300 && /Dodatkowe wytyczne/.test(dlugi.podp), JSON.stringify(dlugi));
  await s.evaluate(() => { document.getElementById('topic').value = '    '; generate(true); });
  await s.waitForTimeout(300);
  const pusty = await s.evaluate(() => ({ podp: ((document.getElementById('topic-podpowiedz') || {}).textContent || ''), spinner: getComputedStyle(document.getElementById('spinner')).display,
    niepoprawne: document.getElementById('topic').getAttribute('aria-invalid') }));
  wynik('R9-F KOD8-25: pusty temat - komunikat przy polu, bez generowania', pusty.podp === 'Wpisz temat artykułu.' && pusty.spinner === 'none' && pusty.niepoprawne === 'true', JSON.stringify(pusty));
  // Wpis Historii z tematem-akapitem (np. sprzed limitu albo z kolejki): najwyzej dwie linie na liscie.
  await s.evaluate(() => {
    history.unshift({ id: 'hdlugi', ts: Date.now(), topic: 'Bardzo dlugi temat wklejony jako akapit. '.repeat(70), type: 'Artykuł blogowy', words: 800, time: '10:00', html: '<h1>T</h1><p>x</p>' });
    renderHistory(); switchMobileTab('history');
  });
  await s.waitForTimeout(400);
  const wpis = await s.evaluate(() => { const e = document.querySelector('#h-list-inner .h-item[data-id="hdlugi"] .h-item-topic'); return e ? Math.round(e.getBoundingClientRect().height) : -1; });
  wynik('R9-F KOD8-25: wpis Historii z bardzo dlugim tematem ma najwyzej dwie linie tematu', wpis > 0 && wpis <= 48, 'wysokosc tematu: ' + wpis);
  wynik('R9-F KOD8-25: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-temat');
  await k.close();
}

// KOD8-31: szacowany koszt na wlasnych kluczach. Nazwa modelu z data wersji (API zwraca ja dla aliasow) spadala
// na stawke modelu pomocniczego, nie liczyly sie wyszukiwania w sieci ani transkrypcja, a etykieta nie mowila,
// ze to szacunek.
async function scenariuszR9FKoszt(b) {
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', {});
  const ceny = await s.evaluate(() => ({
    wersja: kosztOdpowiedzi({ model: 'claude-opus-5-20261001', usage: { input_tokens: 1000000, output_tokens: 0 } }),
    alias: kosztOdpowiedzi({ model: 'claude-opus-5', usage: { input_tokens: 1000000, output_tokens: 0 } }),
    siec: kosztOdpowiedzi({ model: 'claude-sonnet-5', usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 5 } } }),
    etykieta: _t('hist-cost-wlasne'),
  }));
  wynik('R9-F KOD8-31: cennik po nazwie modelu z data wersji (jak alias), nie stawka modelu pomocniczego', ceny.wersja === ceny.alias && ceny.alias > 0, JSON.stringify(ceny));
  wynik('R9-F KOD8-31: wyszukiwania w sieci wliczone do kosztu (5 wyszukan = 0,05 USD)', Math.abs(ceny.siec - 0.05) < 1e-9, JSON.stringify(ceny));
  wynik('R9-F KOD8-31: etykieta mowi, ze koszt na wlasnych kluczach to szacunek', /Szacunkowy/.test(ceny.etykieta), ceny.etykieta);
  // Transkrypcja nagrania (2 s WAV) dolicza koszt OpenAI.
  const transkrypcja = await s.evaluate(async () => {
    const przed = (kosztyApi.wszystkie || {}).openai || 0;
    const hz = 8000, n = hz * 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const zapisz = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    zapisz(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); zapisz(8, 'WAVE'); zapisz(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, hz, true); v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); zapisz(36, 'data'); v.setUint32(40, n * 2, true);
    const tekst = await transcribeMedia(new File([b], 'nagranie.wav', { type: 'audio/wav' }));
    await new Promise((r) => setTimeout(r, 800));
    return { tekst: String(tekst).slice(0, 30), koszt: ((kosztyApi.wszystkie || {}).openai || 0) - przed };
  });
  wynik('R9-F KOD8-31: transkrypcja dolicza koszt (z dlugosci nagrania)', transkrypcja.tekst.length > 0 && transkrypcja.koszt > 0, JSON.stringify(transkrypcja));
  wynik('R9-F KOD8-31: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-koszt');
  await k.close();
}

// KOD8-22: Widocznosc marki w AI. Zly klucz albo przeciazenie przy wszystkich zapytaniach to blad z powodem
// (bez "0, obecnosc w 0/2" i bez zapisu do historii pomiarow); czesc nieudanych nie zaniza wyniku.
async function scenariuszR9FWidocznosc(b) {
  const st = {};
  const { k, s, bledyJs } = await nowaStrona(b, 'pl', st);
  // Czesciowy blad: zapytanie z "awaria" dostaje 529, pozostale ida do atrapy.
  await k.route(/api\.anthropic\.com/, (route) => {
    const z = route.request();
    if (z.method() === 'POST' && /awaria/.test(z.postData() || '') && /simulate an AI assistant/.test(z.postData() || '')) {
      return route.fulfill({ status: 529, contentType: 'application/json', headers: atrapa.CORS, body: JSON.stringify(BLEDY[529][1]) });
    }
    return route.fallback();
  });
  const pomiar = async (zapytania) => {
    await s.evaluate((z) => { openVisModal(); document.getElementById('vis-brand').value = 'Termoplus'; document.getElementById('vis-comp').value = 'Viessmann, Daikin';
      document.getElementById('vis-prompts').value = z; document.getElementById('vis-iter').value = '1'; window.__w = runVisibility(); }, zapytania);
    await s.waitForFunction(() => !document.getElementById('vis-run-btn').disabled, null, { timeout: 60000 }).catch(() => {});
    return s.evaluate(() => {
      const w = document.getElementById('vis-results');
      const kb = w.querySelector('.komunikat-bledu');
      return { tekst: (w.innerText || '').replace(/\s+/g, ' ').slice(0, 260), blad: kb ? kb.innerText.replace(/\s+/g, ' ').slice(0, 200) : '',
        ponow: !!(kb && kb.querySelector('.ponow-generowanie')), klucze: !!(kb && kb.querySelector('[onclick="otworzUstawieniaKlucza()"]')),
        pomiarow: JSON.parse(magazyn.getItem('cai-vis-runs') || '[]').length };
    });
  };
  for (const [blad, klucz, ponow, klucze] of [['401', 'err-klucz', false, true], ['529', 'err-overloaded', true, false]]) {
    st.blad = blad; st.gdzie = 'anthropic';
    const w = await pomiar('najlepsza pompa ciepla krakow\nmontaz pompy ciepla opinie');
    const wzor = await s.evaluate((kl) => _t(kl), klucz);
    wynik('R9-F KOD8-22: Widocznosc - wszystkie zapytania z bledem ' + blad + ': komunikat z powodem zamiast wyniku 0',
      w.blad.indexOf(wzor) !== -1 && !/obecność w 0\/2/.test(w.tekst) && w.ponow === ponow && w.klucze === klucze, JSON.stringify(w));
    wynik('R9-F KOD8-22: Widocznosc - pomiar z samych bledow (' + blad + ') nie trafia do historii pomiarow', w.pomiarow === 0, JSON.stringify(w));
    await s.evaluate(() => closeVisModal());
  }
  st.blad = null;
  const czesc = await pomiar('najlepsza pompa ciepla krakow\nawaria zapytania o montaz');
  const notka = await s.evaluate(() => _t('vis-czesc-bledow').split('{')[0]);
  wynik('R9-F KOD8-22: Widocznosc - czesc zapytan z bledem: wynik z udanych (obecnosc w N/1) i informacja, ile sie nie udalo',
    /obecność w [01]\/1 /.test(czesc.tekst) && !!notka && czesc.tekst.indexOf(notka) !== -1 && czesc.pomiarow === 1, JSON.stringify(czesc));
  wynik('R9-F KOD8-22: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-widocznosc');
  await k.close();
}

// Wariant proxy: jeden serwer z atrapa na wszystkie scenariusze R9-F (uruchamiany przy pierwszym uzyciu).
let SERWER = null;
async function serwer() { if (!SERWER) SERWER = await serwerProxy(); return SERWER; }
const pakietUzycie = (s) => s.evaluate(async () => (await (await fetch('/api/pakiet')).json()).uzycie || {});

// KOD8-07: wdrozenie (restart uslugi) w trakcie generowania - brama oddaje 502 bez tresci, a serwer po
// chwili dziala. Aplikacja traktuje to jak zerwane polaczenie i odbiera wynik tego samego zadania.
async function scenariuszR9FBrama(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  // Konto standard: licznik artykulow pokazuje, czy artykul policzono raz (premium nie ma licznikow).
  const s = await zalogujProxy(k, srv.port, 'standard');
  const przed = { hist: await s.evaluate(() => history.length), art: ((await pakietUzycie(s)).artykul || {}).zuzyte };
  const zadania = [];
  let bramaRaz = true;
  await s.route(/\/api$/, async (route) => {
    const z = route.request();
    const artykul = z.method() === 'POST' && z.headers()['x-cai-czynnosc'] === 'artykul';
    if (artykul) zadania.push(z.headers()['x-zadanie'] || '');
    if (artykul && bramaRaz) {
      bramaRaz = false;
      // Zapytanie dochodzi do serwera (zadanie biegnie dalej), a przegladarka dostaje 502 bramy bez tresci.
      route.fetch().catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      return route.fulfill({ status: 502, body: '' });
    }
    return route.continue();
  });
  await generuj(s, 'Artykul w oknie restartu [atrapa:opoznienie=2500@artykul]', false);
  await krok('R9-F KOD8-07 generowanie po 502 bramy', czekajNaKoniec(s, 60000));
  await s.unroute(/\/api$/);
  const po = await s.evaluate(() => ({ hist: history.length, odz: document.getElementById('out-badge').className,
    blad: ((document.querySelector('#article .komunikat-bledu') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 140) }));
  po.art = ((await pakietUzycie(s)).artykul || {}).zuzyte;
  wynik('R9-F KOD8-07: 502 bramy w trakcie generowania - artykul odebrany z zadania na serwerze (Historia +1)',
    po.hist === przed.hist + 1 && /ready/.test(po.odz) && !po.blad, JSON.stringify({ przed, po }));
  wynik('R9-F KOD8-07: ponowienie z tym samym X-Zadanie, artykul policzony raz',
    zadania.length >= 2 && !!zadania[0] && zadania.every((x) => x === zadania[0]) && po.art === przed.art + 1, JSON.stringify({ zadania, przed: przed.art, po: po.art }));
  wynik('R9-F KOD8-07: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-brama');
  await k.close();
}

// KOD8-09: dwie karty tego samego konta (wspolny localStorage). Artykul z jednej karty nie moze zniknac
// z Historii, gdy druga zapisze swoja liste; usuniety wpis nie wraca.
async function scenariuszR9FDwieKarty(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const a = await zalogujProxy(k, srv.port, 'standard');
  const bKarta = await k.newPage();
  await bKarta.goto('http://127.0.0.1:' + srv.port + '/', { waitUntil: 'load' });
  await bKarta.waitForFunction(() => typeof generate === 'function' && document.readyState === 'complete', null, { timeout: 15000 });
  await bKarta.evaluate(() => { if (typeof startPomin === 'function') startPomin(); });
  await generuj(a, 'Artykul z karty A', false);
  await krok('R9-F KOD8-09 artykul w karcie A', czekajNaKoniec(a));
  await generuj(bKarta, 'Artykul z karty B', false);
  await krok('R9-F KOD8-09 artykul w karcie B', czekajNaKoniec(bKarta));
  await a.waitForTimeout(500);
  const tematy = (s) => s.evaluate(() => history.map((h) => h.topic).sort().join(' | '));
  const zapisane = (s) => s.evaluate(() => JSON.parse(magazyn.getItem('cai_history_v2') || '[]').map((h) => h.topic).sort().join(' | '));
  const oba = 'Artykul z karty A | Artykul z karty B';
  const st1 = { a: await tematy(a), b: await tematy(bKarta), magazyn: await zapisane(a) };
  wynik('R9-F KOD8-09: dwie karty - oba artykuly w Historii obu kart i w magazynie', st1.a === oba && st1.b === oba && st1.magazyn === oba, JSON.stringify(st1));
  await a.reload({ waitUntil: 'load' });
  await a.waitForFunction(() => typeof generate === 'function' && document.readyState === 'complete', null, { timeout: 15000 });
  const poOdswiezeniu = await tematy(a);
  wynik('R9-F KOD8-09: po odswiezeniu karty A oba artykuly zostaja', poOdswiezeniu === oba, poOdswiezeniu);
  // Usuniecie w karcie B: wpis znika tez w A i nie wraca, gdy A zapisze swoja (starsza) liste.
  await bKarta.evaluate(() => { const h = history.find((x) => x.topic === 'Artykul z karty A'); if (h) usunWpisHistorii(h.id); });
  await a.waitForTimeout(400);
  const poUsunieciuA = await tematy(a);
  await a.evaluate(() => saveState());
  const poZapisieA = { a: await tematy(a), b: await tematy(bKarta), magazyn: await zapisane(a) };
  wynik('R9-F KOD8-09: wpis usuniety w jednej karcie znika w drugiej i nie wraca po jej zapisie',
    poUsunieciuA === 'Artykul z karty B' && poZapisieA.a === 'Artykul z karty B' && poZapisieA.magazyn === 'Artykul z karty B', JSON.stringify({ poUsunieciuA, poZapisieA }));
  wynik('R9-F KOD8-09: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(a, 'r9f-dwie-karty');
  await k.close();
}

// KOD8-13: artykul z wyszukiwaniem, ktory API konczy pierwsza ture "pause_turn". Druga tura to ten sam
// artykul: konto darmowe (3 artykuly) ma po nim zuzyte 1, nie 2.
async function scenariuszR9FPauseTurn(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'darmowy');
  const przed = ((await pakietUzycie(s)).artykul || {}).zuzyte || 0;
  const deklaracje = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url())) deklaracje.push(z.headers()['x-cai-czynnosc'] || '-'); });
  await generuj(s, 'Rowery elektryczne do miasta [atrapa:pause@artykul]', false);
  await krok('R9-F KOD8-13 artykul z pause_turn', czekajNaKoniec(s));
  const st = await s.evaluate(() => ({ odz: document.getElementById('out-badge').className, h2: document.querySelectorAll('#article h2').length }));
  const po = ((await pakietUzycie(s)).artykul || {}).zuzyte || 0;
  const artykul = deklaracje.filter((x) => x === 'artykul').length;
  wynik('R9-F KOD8-13: artykul z tura pause_turn gotowy', /ready/.test(st.odz) && st.h2 >= 2, JSON.stringify(st));
  wynik('R9-F KOD8-13: kontynuacja pause_turn nie deklaruje drugiego artykulu, pakiet -1 (nie -2)',
    artykul === 1 && deklaracje.indexOf('artykul-ciag') !== -1 && po - przed === 1, JSON.stringify({ deklaracje, przed, po }));
  wynik('R9-F KOD8-13: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-pause-turn');
  await k.close();
}

// KOD8-30: telefon ubija karte (albo strona sie przeladowuje) w trakcie generowania. Serwer konczy
// zadanie i liczy artykul; po powrocie aplikacja odbiera ten sam artykul (Historia +1, licznik +1, nie +2).
// Zapis sprzed 15 minut albo zadanie, ktorego serwer juz nie ma: komunikat, bez nowego platnego artykulu.
async function scenariuszR9FPrzeladowanie(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const s = await zalogujProxy(k, srv.port, 'standard');
  const przed = { hist: await s.evaluate(() => history.length), art: ((await pakietUzycie(s)).artykul || {}).zuzyte || 0 };
  await s.evaluate(() => { document.getElementById('topic').value = 'Artykul ubity w tle [atrapa:opoznienie=4000@artykul]'; document.getElementById('use-web').checked = true; generate(true); });
  await s.waitForTimeout(1500);
  // R9-D (KOD8-30, trasa C): po przeladowaniu stan zadania z GET /api/zadanie, bez sondy POST /api z pustym cialem.
  const odbior = { stan: 0, sonda: 0 };
  s.on('request', (z) => { if (z.method() === 'GET' && /\/api\/zadanie\?id=/.test(z.url())) odbior.stan++; if (z.method() === 'POST' && /\/api$/.test(z.url()) && z.postData() === '{}') odbior.sonda++; });
  await s.reload({ waitUntil: 'load' });
  await krok('R9-F KOD8-30 artykul odebrany po przeladowaniu', s.waitForFunction(() => history.some((h) => /Artykul ubity w tle/.test(h.topic)) && /ready/.test(document.getElementById('out-badge').className), null, { timeout: 40000 }));
  const po = await s.evaluate(() => ({ hist: history.length, temat: (history[0] || {}).topic || '', odz: document.getElementById('out-badge').className,
    h2: document.querySelectorAll('#article h2').length, zapis: (() => { try { return sessionStorage.getItem('cai_artykul_w_toku'); } catch (e) { return 'blad'; } })(),
    pow: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent.slice(0, 120)) }));
  po.art = ((await pakietUzycie(s)).artykul || {}).zuzyte || 0;
  wynik('R9-F KOD8-30: przeladowanie w trakcie generowania - artykul odebrany z zadania (Historia +1, na ekranie)',
    po.hist === przed.hist + 1 && /Artykul ubity w tle/.test(po.temat) && /ready/.test(po.odz) && po.h2 >= 2, JSON.stringify({ przed, po }));
  wynik('R9-F KOD8-30: artykul policzony raz (bez drugiego generowania), zapis w karcie usuniety', po.art === przed.art + 1 && po.zapis === null, JSON.stringify({ przed: przed.art, po: po.art, zapis: po.zapis }));
  wynik('R9-D KOD8-30: odbior pyta o stan zadania GET /api/zadanie (trasa C), bez sondy POST /api z pustym cialem', odbior.stan >= 1 && odbior.sonda === 0, JSON.stringify(odbior));
  // Zadanie, ktorego serwer nie ma (np. restart uslugi): komunikat i bez nowego artykulu.
  await s.evaluate(() => { try { sessionStorage.setItem('cai_artykul_w_toku', JSON.stringify({ id: 'brakzadania' + Date.now(), konto: magazyn.konto, start: Date.now(), temat: 'Zgubione zadanie', frazy: [], formularz: {} })); } catch (e) { /* bez magazynu */ } });
  await s.reload({ waitUntil: 'load' });
  await krok('R9-F KOD8-30 komunikat o zgubionym zadaniu', s.waitForFunction(() => [...document.querySelectorAll('.powiadomienie')].some((p) => p.textContent.indexOf(_t('odzysk-blad')) !== -1), null, { timeout: 20000 }));
  const zgubione = await s.evaluate(() => ({ hist: history.length, temat: (history[0] || {}).topic || '', spinner: getComputedStyle(document.getElementById('spinner')).display,
    przycisk: document.getElementById('gen-btn').disabled, zapis: (() => { try { return sessionStorage.getItem('cai_artykul_w_toku'); } catch (e) { return 'blad'; } })() }));
  zgubione.art = ((await pakietUzycie(s)).artykul || {}).zuzyte || 0;
  wynik('R9-F KOD8-30: zadania nie ma na serwerze - komunikat, bez nowego artykulu i bez wpisu',
    zgubione.hist === po.hist && !/Zgubione/.test(zgubione.temat) && zgubione.spinner === 'none' && !zgubione.przycisk && zgubione.zapis === null && zgubione.art === po.art, JSON.stringify(zgubione));
  wynik('R9-F KOD8-30: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-przeladowanie');
  await k.close();
}

// KOD8-17: Fakty dla artykulu napisanego z Bazy na serwerze, zaraz po generowaniu i po odswiezeniu strony
// (artykul wraca z Historii): kontrola zestawia tekst z fragmentami Bazy, nie "Brak zrodel do porownania".
async function scenariuszR9FFakty(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.evaluate(async () => {
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Oferta Termoplus',
      tresc: 'Termoplus montuje pompy ciepla Vitocal w 48 godzin. Gwarancja 7 lat. Pompy ciepla w Krakowie od 28 000 zl.' }) });
    await odswiezListeBazy();
  });
  const zrodlaFaktow = [];
  s.on('request', (z) => { const d = z.postData() || ''; if (z.method() === 'POST' && /\/api$/.test(z.url()) && /fact checker/.test(d)) zrodlaFaktow.push(/Vitocal/.test(d)); });
  await s.evaluate(() => { document.getElementById('topic').value = 'Pompy ciepla w Krakowie'; document.getElementById('use-web').checked = false; generate(true); });
  await krok('R9-F KOD8-17 artykul z Bazy', czekajNaKoniec(s));
  const fakty = async () => {
    await s.evaluate(() => { const p = document.getElementById('fakty-panel'); if (p.style.display === 'block') p.style.display = 'none'; przelaczPanelFaktow(); });
    await s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none', null, { timeout: 30000 }).catch(() => {});
    return s.evaluate(() => ({ stan: faktyStan, tekst: (document.getElementById('fakty-wynik').innerText || '').replace(/\s+/g, ' ').slice(0, 120) }));
  };
  const przed = await fakty();
  await s.reload({ waitUntil: 'load' });
  await s.waitForFunction(() => typeof generate === 'function' && document.readyState === 'complete' && document.getElementById('article').style.display === 'block', null, { timeout: 15000 });
  await s.waitForTimeout(500);
  const po = await fakty();
  wynik('R9-F KOD8-17: Fakty zaraz po generowaniu zestawiaja tekst z Baza na serwerze', przed.stan === 'gotowe' && zrodlaFaktow[0] === true, JSON.stringify({ przed, zrodlaFaktow }));
  wynik('R9-F KOD8-17: po odswiezeniu (artykul z Historii) Fakty dalej widza Baze na serwerze, bez "Brak zrodel"',
    po.stan === 'gotowe' && zrodlaFaktow.length === 2 && zrodlaFaktow[1] === true, JSON.stringify({ po, zrodlaFaktow }));
  await s.evaluate(async () => { const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-17: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-fakty');
  await k.close();
}

// KOD8-16: transkrypcja. Plik ponad limit dostawcy (25 MB) - jasny komunikat przed wyslaniem (bez wysylania
// 26 MB i bez "bledu serwera 500 ... bez analizy SERP"); zerwane polaczenie w trakcie - wynik odebrany
// z zadania na serwerze (transkrypcja policzona raz), a nie blad przy oplaconej pracy.
async function scenariuszR9FTranskrypcja(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'standard');
  const wyslane = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api\/transcribe$/.test(z.url())) wyslane.push(z.headers()['x-zadanie'] || '-'); });
  const ustawPlik = (mb, nazwa) => s.evaluate(({ mb, nazwa }) => {
    const bajty = new Uint8Array(Math.round(mb * 1024 * 1024)); bajty[0] = 0x49; bajty[1] = 0x44; bajty[2] = 0x33;
    const dt = new DataTransfer(); dt.items.add(new File([bajty], nazwa, { type: 'audio/mpeg' }));
    const fi = document.getElementById('au-file'); fi.files = dt.files; if (typeof audioFileLabel === 'function') audioFileLabel();
  }, { mb, nazwa });
  const uruchom = async () => {
    await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((x) => x.remove()); document.getElementById('au-script').innerText = '';
      document.getElementById('au-result-wrap').style.display = 'none'; document.getElementById('au-gen-btn').click(); });
    await s.waitForTimeout(300);
    await s.waitForFunction(() => !document.getElementById('au-gen-btn').disabled, null, { timeout: 60000 }).catch(() => {});
    await s.waitForTimeout(300);
    return s.evaluate(() => ({ wynik: (document.getElementById('au-script').innerText || '').slice(0, 60), widoczny: document.getElementById('au-result-wrap').style.display,
      powiadomienia: [...document.querySelectorAll('.powiadomienie')].map((x) => x.textContent.replace(/\s+/g, ' ').slice(0, 200)) }));
  };
  await s.evaluate(() => { openAudioPanel(); document.getElementById('au-type').value = 'transcription'; audioSetType(); });
  await s.waitForTimeout(300);
  // Plik 26 MB: komunikat o limicie, nic nie idzie do serwera.
  await ustawPlik(26, 'dlugie-nagranie.m4a');
  const duzy = await uruchom();
  const wzorLimitu = await s.evaluate(() => _t('err-transkrypcja-za-duzy').split('{')[0]);
  wynik('R9-F KOD8-16: plik ponad 25 MB - komunikat o limicie przed wyslaniem, bez wysylania pliku',
    wyslane.length === 0 && !!wzorLimitu && duzy.powiadomienia.some((p) => p.indexOf(wzorLimitu) !== -1) && !duzy.powiadomienia.some((p) => /SERP|500/.test(p)), JSON.stringify({ duzy, wyslane }));
  // Zerwane polaczenie: zapytanie dochodzi do serwera, odpowiedz nie wraca; aplikacja odbiera wynik tego samego zadania.
  const przed = ((await pakietUzycie(s)).transkrypcja || {}).zuzyte || 0;
  let zerwij = true;
  await s.route(/\/api\/transcribe$/, async (route) => {
    if (zerwij) { zerwij = false; route.fetch().catch(() => {}); await new Promise((r) => setTimeout(r, 400)); return route.abort('connectionreset'); }
    return route.continue();
  });
  await ustawPlik(0.2, 'nagranie.mp3');
  const zerwane = await uruchom();
  await s.unroute(/\/api\/transcribe$/);
  const po = ((await pakietUzycie(s)).transkrypcja || {}).zuzyte || 0;
  wynik('R9-F KOD8-16: zerwane polaczenie w trakcie transkrypcji - wynik odebrany z serwera, policzony raz',
    zerwane.widoczny === 'block' && zerwane.wynik.length > 5 && !zerwane.powiadomienia.length && wyslane.length >= 2 && wyslane.every((x) => x === wyslane[0] && x !== '-') && po === przed + 1,
    JSON.stringify({ zerwane, wyslane, przed, po }));
  wynik('R9-F KOD8-16: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-transkrypcja');
  await k.close();
}

// KOD8-11: dokument dluzszy niz miesci Baza na serwerze (60 fragmentow po 1500 znakow) - pytanie przed
// dodaniem (z liczbami), a po zapisie informacja, ile zapisano; wczesniej "Dodano do bazy" i cisza.
async function scenariuszR9FDuzyDokument(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  const wyslane = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api\/baza$/.test(z.url())) wyslane.push(JSON.parse(z.postData() || '{}').nazwa || ''); });
  const dodaj = (odpowiedz) => s.evaluate(async (odp) => {
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    window.__pytania = []; window.confirm = (m) => { window.__pytania.push(m); return odp; };
    let tresc = '';
    for (let i = 1; tresc.length < 335000; i++) tresc += 'Rozdzial ' + i + '. Pompa ciepla model XYZ' + i + ' ma gwarancje producenta i serwis w calej Polsce. ';
    tresc += 'Gwarancja producenta XYZ123 wynosi 10 lat.';
    const przed = window._bazaSerwerLiczba || 0;
    addDoc('Katalog produktow', tresc, '📄');
    for (let i = 0; i < 40 && (window._bazaSerwerLiczba || 0) === przed && !document.querySelector('.powiadomienie'); i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 500));
    return { pytania: window.__pytania, liczba: window._bazaSerwerLiczba || 0, lokalne: docs.length, dlugosc: tresc.length,
      pow: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent.replace(/\s+/g, ' ').slice(0, 260)) };
  }, odpowiedz);
  const nie = await dodaj(false);
  wynik('R9-F KOD8-11: dokument ponad limit Bazy - pytanie przed dodaniem z liczbami; "Anuluj" nic nie dodaje',
    nie.pytania.length === 1 && /90[\s .,]?000/.test(nie.pytania[0]) && nie.liczba === 0 && nie.lokalne === 0 && !wyslane.length, JSON.stringify(nie).slice(0, 400));
  const tak = await dodaj(true);
  const wzor = await s.evaluate(() => _t('kb-uciety').split('{')[0]);
  wynik('R9-F KOD8-11: po zgodzie dokument w Bazie i informacja, ile znakow zapisano (zamiast samego "Dodano")',
    tak.pytania.length === 1 && tak.liczba === 1 && wyslane.length === 1 && !!wzor && tak.pow.some((p) => p.indexOf(wzor) !== -1 && /90[\s .,]?000/.test(p)), JSON.stringify(tak).slice(0, 500));
  await s.evaluate(async () => { const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-11: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-duzy-dokument');
  await k.close();
}

// KOD8-29: integracja CMS. Login Drupala z polska litera (btoa przyjmuje tylko Latin-1) i adres bez https://
// (zapytanie szlo pod adres wzgledny, na serwer aplikacji). CMS udawany trasa.
async function scenariuszR9FCms(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  const zapytania = [];
  const naglowek = { 'access-control-allow-origin': '*' };
  await k.route(/cms\.przyklad\.pl/, (route) => {
    const z = route.request();
    zapytania.push({ url: z.url(), auth: z.headers().authorization || '' });
    if (/users\/me/.test(z.url())) return route.fulfill({ status: 200, contentType: 'application/json', headers: naglowek, body: JSON.stringify({ id: 1, name: 'Redakcja' }) });
    if (/jsonapi/.test(z.url())) return route.fulfill({ status: 200, contentType: 'application/vnd.api+json', headers: naglowek, body: JSON.stringify({ data: [] }) });
    return route.fulfill({ status: 404, headers: naglowek, body: '' });
  });
  const testuj = async (cms, url, user, pass) => {
    await s.evaluate(({ cms, url, user, pass }) => {
      openWpModal(); switchCmsTab(cms);
      document.getElementById(cms + '-url').value = url; document.getElementById(cms + '-user').value = user; document.getElementById(cms + '-pass').value = pass;
      document.getElementById('wp-test-result').innerHTML = '';
      testCmsConnection();
    }, { cms, url, user, pass });
    await s.waitForFunction(() => { const r = document.getElementById('wp-test-result'); return r.textContent && r.textContent !== _t('msg-loading-test'); }, null, { timeout: 10000 }).catch(() => {});
    return s.evaluate(() => (document.getElementById('wp-test-result').innerText || '').replace(/\s+/g, ' ').slice(0, 200));
  };
  const drupal = await testuj('drupal', 'https://cms.przyklad.pl', 'Łukasz', 'hasło');
  const authDrupal = (zapytania.find((z) => /jsonapi/.test(z.url)) || {}).auth || '';
  const oczekiwany = 'Basic ' + Buffer.from('Łukasz:hasło', 'utf8').toString('base64');
  const drupalOk = await s.evaluate(() => _t('drupal-ok'));
  wynik('R9-F KOD8-29: Drupal - login i haslo z polskimi literami w naglowku Basic (UTF-8), test polaczenia OK',
    authDrupal === oczekiwany && drupal.indexOf(drupalOk.replace(/<[^>]+>/g, '').slice(0, 12)) !== -1 && !/btoa|Latin1/.test(drupal), JSON.stringify({ drupal, authDrupal }));
  const wp = await testuj('wp', 'cms.przyklad.pl/wp-admin/', 'redakcja', 'abcd efgh');
  const zapWp = zapytania.find((z) => /users\/me/.test(z.url)) || {};
  wynik('R9-F KOD8-29: WordPress - adres bez https:// i z /wp-admin trafia do https://adres/wp-json',
    zapWp.url === 'https://cms.przyklad.pl/wp-json/wp/v2/users/me' && /Redakcja/.test(wp), JSON.stringify({ wp, url: zapWp.url }));
  const zapis = await s.evaluate(() => { switchCmsTab('wp'); document.getElementById('wp-url').value = ' cms.przyklad.pl//'; saveCmsSettings(); const u = wpSettings.url; magazyn.removeItem('cai-wp'); return u; });
  wynik('R9-F KOD8-29: zapis ustawien dopisuje https:// i obcina ukosniki', zapis === 'https://cms.przyklad.pl', zapis);
  wynik('R9-F KOD8-29: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-cms');
  await k.close();
}

// KOD8-32: pierwszy PDF na telefonie - biblioteka (1,7 MB) laduje sie kilka sekund bez znaku zycia, a drugie
// dotkniecie w tym czasie dawalo dwa pliki. Wolne ladowanie udaje trasa z opoznieniem.
async function scenariuszR9FPdf(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.route(/\/pwa\/lib\/pdfmake\.min\.js$/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); return route.continue(); });
  let pobran = 0;
  s.on('download', () => { pobran++; });
  await s.evaluate(() => {
    const art = document.getElementById('article');
    art.innerHTML = '<h1>Pompy ciepla w domu</h1><p>Pompa ciepla obniza koszty ogrzewania.</p><h2>Jak dziala</h2><p>Pobiera cieplo z powietrza.</p>';
    art.style.display = 'block';
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    dlPdf();
  });
  await s.waitForTimeout(300);
  const wTrakcie = await s.evaluate(() => [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent.slice(0, 80)));
  await s.evaluate(() => dlPdf());
  // Pierwsze pobranie biblioteki ze swiezego serwera trwa kilka sekund (kompresja przy pierwszym zapytaniu).
  await s.waitForEvent('download', { timeout: 30000 }).catch(() => {});
  await s.waitForTimeout(2000);
  const wzor = await s.evaluate(() => _t('msg-pdf-przygotowuje').slice(0, 15));
  wynik('R9-F KOD8-32: pierwszy PDF - komunikat od razu, w trakcie ladowania biblioteki', wTrakcie.some((p) => p.indexOf(wzor) === 0), JSON.stringify(wTrakcie));
  wynik('R9-F KOD8-32: drugie dotkniecie w trakcie ladowania nie daje drugiego pliku', pobran === 1, 'pobran: ' + pobran);
  // KOD8-35: emoji dopisane w Edytuj daly w PDF pusty znak \x00 (kroje PDF maja tylko lacinke PL/DE/CZ i typografie).
  const emoji = await s.evaluate(() => {
    const el = document.createElement('div');
    el.innerHTML = '<h2>Oferta 🔥 na zimę</h2><p>👍🏽 Montaż w 48 h 🇵🇱, serwis 1️⃣ dzień. Marka Termoplus® i Vitocal™ © 2026.</p><ul><li>Gwarancja 👨‍👩‍👧 7 lat ✅</li></ul>';
    const teksty = [];
    (function zbierz(w) { if (Array.isArray(w)) { w.forEach(zbierz); return; } if (!w || typeof w !== 'object') { if (typeof w === 'string') teksty.push(w); return; }
      ['text', 'stack', 'ul', 'ol', 'columns'].forEach((p) => { if (w[p] !== undefined) zbierz(w[p]); }); })(trescPdf(el));
    const wszystko = teksty.join('|');
    // Znaki w krojach PDF (cmap z pwa/lib/vfs_fonts.js): ASCII, U+00A0-017E i kilkanascie znakow typografii.
    const TYPOGRAFIA = [0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026, 0x20AC, 0x2122, 0x2212];
    const wKroju = (c) => { const k = c.codePointAt(0); return k === 10 || (k >= 0x20 && k <= 0x7E) || (k >= 0xA0 && k <= 0x17E) || TYPOGRAFIA.includes(k); };
    return { wszystko, poza: [...wszystko].filter((c) => !wKroju(c)).map((c) => c.codePointAt(0).toString(16)) };
  });
  wynik('R9-F KOD8-35: PDF - emoji wypadaja z tekstu (bez pustych znakow), litery, (R), TM i (c) zostaja',
    !emoji.poza.length && /Oferta na zimę/.test(emoji.wszystko) && /Montaż w 48 h, serwis 1 dzień\. Marka Termoplus® i Vitocal™ © 2026\./.test(emoji.wszystko) && /Gwarancja 7 lat(\||$)/.test(emoji.wszystko),
    JSON.stringify(emoji));
  wynik('R9-F KOD8-32: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-pdf');
  await k.close();
}

// KOD8-33: konto darmowe (SERP poza pakietem) - zakladka Luki mowila tylko "Wlacz Analize SERP", czego nie da
// sie zrobic. Ma mowic, od ktorego pakietu sa Luki, z przejsciem do pakietow.
async function scenariuszR9FLukiDarmowy(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'darmowy');
  await s.waitForFunction(() => { const p = document.getElementById('use-serp'); return p && p.disabled; }, null, { timeout: 10000 }).catch(() => {});
  await generuj(s, 'Pompy ciepla w domu', false);
  await krok('R9-F KOD8-33 artykul na koncie darmowym', czekajNaKoniec(s));
  await s.evaluate(() => inspektorPokaz('luki'));
  await s.waitForFunction(() => getComputedStyle(document.getElementById('gap-no-serp')).display === 'block', null, { timeout: 10000 }).catch(() => {});
  const luki = await s.evaluate(() => { const e = document.getElementById('gap-no-serp'); return { tekst: (e.innerText || '').replace(/\s+/g, ' '), pakiety: !!e.querySelector('[onclick="otworzPakiet()"]'),
    wzor: _t('gap-serp-pakiet'), stary: _t('gap-no-serp') }; });
  wynik('R9-F KOD8-33: konto bez SERP - Luki mowia, od ktorego pakietu sa dostepne, z przejsciem do pakietow',
    luki.tekst.indexOf(luki.wzor) !== -1 && luki.tekst.indexOf(luki.stary) === -1 && luki.pakiety, JSON.stringify(luki));
  wynik('R9-F KOD8-33: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-luki-darmowy');
  await k.close();
}

// KOD8-34: generowanie bez internetu (pociag, winda). Spinner mowi, ze aplikacja czeka na siec (zamiast
// "Generuje tresc... pisze artykul"), a artykul po powrocie sieci powstaje Z wiedza z Bazy na serwerze.
async function scenariuszR9FBezSieci(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.evaluate(async () => {
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Oferta Termoplus',
      tresc: 'Termoplus montuje pompy ciepla Vitocal w 48 godzin. Gwarancja 7 lat.' }) });
    await odswiezListeBazy();
  });
  let zWiedza = null;
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url()) && z.headers()['x-cai-czynnosc'] === 'artykul') zWiedza = /Vitocal/.test(z.postData() || ''); });
  await k.setOffline(true);
  await s.evaluate(() => { document.getElementById('topic').value = 'Pompy ciepla Termoplus'; document.getElementById('use-web').checked = false; window.__g = generate(true); });
  await s.waitForTimeout(2500);
  const offline = await s.evaluate(() => {
    const widac = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; };
    return { siec: widac('spin-siec') ? document.getElementById('spin-siec').textContent : '', etap: widac('spin-label'), wzor: _t('spin-brak-sieci') };
  });
  await k.setOffline(false);
  await krok('R9-F KOD8-34 artykul po powrocie sieci', czekajNaKoniec(s, 40000));
  const po = await s.evaluate(() => ({ odz: document.getElementById('out-badge').className, siec: !!document.querySelector('#spinner.czeka-na-siec') }));
  wynik('R9-F KOD8-34: bez internetu spinner mowi, ze czeka na siec (etapy pisania schowane)', offline.siec === offline.wzor && !offline.etap, JSON.stringify(offline));
  wynik('R9-F KOD8-34: po powrocie sieci artykul gotowy i napisany z wiedza z Bazy na serwerze', /ready/.test(po.odz) && !po.siec && zWiedza === true, JSON.stringify({ po, zWiedza }));
  await s.evaluate(async () => { const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-34: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-bez-sieci');
  await k.close();
}

// KOD8-19: prompt artykulu w wariancie z serwerem mowil modelowi "You have 0 knowledge source(s)" i "Knowledge base
// ONLY", a zaraz potem dawal fragmenty z Bazy na serwerze. Licznik zrodel ma liczyc te fragmenty.
async function scenariuszR9FPromptBazy(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.evaluate(async () => {
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Oferta Termoplus',
      tresc: 'Termoplus montuje pompy ciepla Vitocal w 48 godzin. Gwarancja 7 lat. Pompy ciepla w Krakowie od 28 000 zl.' }) });
    await odswiezListeBazy();
  });
  const prompty = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url()) && z.headers()['x-cai-czynnosc'] === 'artykul') { try { prompty.push(JSON.parse(z.postData()).messages[0].content); } catch (e) { /* inne cialo */ } } });
  await s.evaluate(() => { document.getElementById('topic').value = 'Pompy ciepla w Krakowie'; document.getElementById('use-web').checked = false; generate(true); });
  await krok('R9-F KOD8-19 artykul z Bazy na serwerze', czekajNaKoniec(s));
  const poczatek = (prompty[0] || '').split('\n')[0];
  wynik('R9-F KOD8-19: prompt liczy fragmenty z Bazy na serwerze jako zrodla (nie "You have 0 knowledge source(s)")',
    /WIEDZA FIRMOWA/.test(prompty[0] || '') && !/You have 0 knowledge source/.test(poczatek) && /passage\(s\) from the company knowledge base on the server/.test(poczatek), poczatek);
  await s.evaluate(async () => { const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-19: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-prompt-bazy');
  await k.close();
}

// KOD8-18: w wariancie z serwerem wszystkie dokumenty sa w Bazie na serwerze, a brief, Podpowiedz tematy i llms.txt
// czytaly tylko dokumenty z przegladarki. Brief prosil o tekst w jezyku interfejsu, nie artykulu.
async function scenariuszR9FPomocnicy(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.evaluate(async () => {
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Oferta Termoplus',
      url: 'https://termoplus.example.com/oferta', tresc: 'Termoplus montuje pompy ciepla Vitocal w Krakowie w 48 godzin. Gwarancja 7 lat.' }) });
    await odswiezListeBazy();
    const l = document.getElementById('lang'); l.value = 'English'; l.dispatchEvent(new Event('change'));
  });
  const zap = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url())) { try { const d = JSON.parse(z.postData()); zap.push({ sys: String(d.system || ''), tresc: JSON.stringify(d.messages || []) }); } catch (e) { /* inne */ } } });
  // Brief
  await s.evaluate(() => { document.getElementById('topic').value = 'Pompy ciepla w Krakowie'; openBriefPanel(true); });
  await s.waitForFunction(() => !document.querySelector('#brief-content .seo-loading'), null, { timeout: 30000 }).catch(() => {});
  const brief = zap.find((z) => /content strategist/.test(z.sys) && !/EXACTLY 10 article topics/.test(z.sys)) || { sys: '', tresc: '' };
  wynik('R9-F KOD8-18: brief dostaje wiedze z Bazy na serwerze i pisze w jezyku artykulu (English przy interfejsie PL)',
    /Vitocal/.test(brief.tresc) && /MUST be in English/.test(brief.sys), JSON.stringify({ sys: brief.sys.slice(-60), tresc: brief.tresc.slice(0, 160) }));
  await s.evaluate(() => { try { closeBriefPanel(); } catch (e) { /* zamkniety */ } });
  // Podpowiedz tematy
  await s.evaluate(() => otworzTematy());
  const pole = await s.evaluate(() => getComputedStyle(document.getElementById('tematy-baza-wrap')).display !== 'none' && document.getElementById('tematy-baza').checked);
  await s.evaluate(() => { document.getElementById('tematy-zapotrzebowanie').value = 'Klienci pytaja o pompy ciepla'; generujTematy(); });
  await s.waitForFunction(() => !document.querySelector('#tematy-wynik .seo-loading'), null, { timeout: 30000 }).catch(() => {});
  const tematy = zap.filter((z) => /EXACTLY 10 article topics/.test(z.sys)).pop() || { tresc: '' };
  wynik('R9-F KOD8-18: Podpowiedz tematy - pole Bazy widoczne przy dokumentach na serwerze i wiedza w zapytaniu', pole && /Vitocal/.test(tematy.tresc), JSON.stringify({ pole, tresc: tematy.tresc.slice(0, 200) }));
  await s.evaluate(() => zamknijTematy());
  // llms.txt: adres strony z Bazy na serwerze, kontekst z serwera, naglowki w jezyku tekstu
  const llms = await s.evaluate(async () => {
    openLlmsModal(); document.getElementById('llms-name').value = 'Termoplus';
    await generateLlms();
    return { pelny: document.getElementById('llms-out-full-ta').value, podstawowy: document.getElementById('llms-out-basic-ta').value };
  });
  wynik('R9-F KOD8-18: llms.txt - strona z Bazy na serwerze w "Important pages", kontekst z serwera, naglowki po angielsku',
    /termoplus\.example\.com\/oferta/.test(llms.podstawowy) && /Vitocal/.test(llms.pelny) && /## About the company/.test(llms.podstawowy) && !/O firmie|Brak dokumentów/.test(llms.pelny), JSON.stringify(llms).slice(0, 400));
  await s.evaluate(async () => { try { closeLlmsModal(); } catch (e) { /* */ } const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-18: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-pomocnicy');
  await k.close();
}

// KOD8-23: Widocznosc AI i Narracja marki. Rynek i jezyk "Polish" na sztywno (anglojezyczny klient dostawal pomiar
// polskiego rynku i polska narracje), Narracja porownywala z "(no documents)" przy Bazie na serwerze, a blad API
// w kroku 1 dawal "Brak odpowiedzi z narracja" bez powodu.
async function scenariuszR9FNarracja(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.evaluate(async () => {
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Oferta Termoplus',
      tresc: 'Termoplus montuje pompy ciepla Vitocal w Krakowie w 48 godzin. Gwarancja 7 lat.' }) });
    await odswiezListeBazy();
    const l = document.getElementById('lang'); l.value = 'English'; l.dispatchEvent(new Event('change'));
  });
  const zap = [];
  let blad401 = false;
  await s.route(/\/api$/, (route) => {
    const z = route.request();
    let d = {}; try { d = JSON.parse(z.postData() || '{}'); } catch (e) { /* inne cialo */ }
    zap.push({ sys: String(d.system || ''), tresc: JSON.stringify(d.messages || []) });
    if (blad401 && /A user asks about the brand/.test(String(d.system || ''))) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    }
    return route.continue();
  });
  await s.evaluate(() => { openVisModal(); document.getElementById('vis-brand').value = 'Termoplus'; document.getElementById('vis-comp').value = 'Viessmann';
    document.getElementById('vis-prompts').value = 'best heat pump installer'; document.getElementById('vis-iter').value = '1'; window.__w = runVisibility(); });
  await s.waitForFunction(() => !document.getElementById('vis-run-btn').disabled, null, { timeout: 60000 }).catch(() => {});
  const pomiar = zap.find((z) => /simulate an AI assistant/.test(z.sys)) || { sys: '' };
  wynik('R9-F KOD8-23: Widocznosc - rynek z jezyka tekstu (English), nie "Polish market" na sztywno', !!pomiar.sys && !/Polish market/.test(pomiar.sys) && /English/.test(pomiar.sys), pomiar.sys.slice(0, 160));
  await s.evaluate(() => { window.__n = runNarrative(); });
  await s.waitForFunction(() => !document.getElementById('vis-narr-btn').disabled, null, { timeout: 60000 }).catch(() => {});
  const krok1 = zap.find((z) => /A user asks about the brand/.test(z.sys)) || { sys: '', tresc: '' };
  const krok2 = zap.find((z) => /GROUND TRUTH/.test(z.tresc)) || { tresc: '' };
  wynik('R9-F KOD8-23: Narracja w jezyku tekstu (English), bez "in Polish" i "Opowiedz o marce"', /in English/.test(krok1.sys) && !/in Polish/.test(krok1.sys) && !/Opowiedz o marce/.test(krok1.tresc), krok1.sys.slice(-120) + ' | ' + krok1.tresc.slice(0, 80));
  wynik('R9-F KOD8-23: Narracja porownuje z Baza na serwerze (nie "(no documents)")', /Vitocal/.test(krok2.tresc) && !/\(no documents\)/.test(krok2.tresc), krok2.tresc.slice(0, 200));
  blad401 = true;
  await s.evaluate(() => { window.__n = runNarrative(); });
  await s.waitForFunction(() => !document.getElementById('vis-narr-btn').disabled, null, { timeout: 60000 }).catch(() => {});
  const blad = await s.evaluate(() => { const kb = document.querySelector('#vis-results .komunikat-bledu'); return { tekst: kb ? kb.innerText.replace(/\s+/g, ' ') : (document.getElementById('vis-results').innerText || ''), wzor: _t('err-klucz') }; });
  wynik('R9-F KOD8-23: Narracja - blad API (zly klucz) z powodem zamiast "Brak odpowiedzi z narracja"', blad.tekst.indexOf(blad.wzor) !== -1, blad.tekst.slice(0, 200));
  await s.unroute(/\/api$/);
  await s.evaluate(async () => { closeVisModal(); const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-23: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-narracja');
  await k.close();
}

// KOD8-10: sesja wygasla w trakcie pracy. Lista Bazy czytala {"error":"Niezalogowany"} jak pusta liste
// ("Brak dokumentow", licznik 0), a nowy dokument po cichu zostawal tylko w przegladarce.
async function scenariuszR9FSesja(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  await s.evaluate(async () => {
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Cennik', tresc: 'Montaz kosztuje od 18 do 35 tys. zl.' }) });
    await odswiezListeBazy();
  });
  const przed = await s.evaluate(() => window._bazaSerwerLiczba);
  // Wygasniecie sesji: przegladarka nie ma juz ciasteczka sesji, serwer odpowiada 401.
  const ciastka = await k.cookies();
  await k.clearCookies();
  const lista = await s.evaluate(async () => {
    await otworzBazeSerwera();
    return { liczba: window._bazaSerwerLiczba, tekst: (document.getElementById('bazas-lista').innerText || '').replace(/\s+/g, ' ').slice(0, 160),
      pusto: _t('bazas-pusto'), sesja: _t('bazas-sesja') };
  });
  wynik('R9-F KOD8-10: po wygasnieciu sesji lista Bazy mowi o sesji, a nie "Brak dokumentow"; licznik zostaje',
    przed === 1 && lista.liczba === 1 && lista.tekst.indexOf(lista.sesja) !== -1 && lista.tekst.indexOf(lista.pusto) === -1, JSON.stringify(lista));
  const dodanie = await s.evaluate(async () => {
    zamknijBazeSerwera();
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    addDoc('Nowy dokument', 'Tresc nowego dokumentu po wygasnieciu sesji.', '✏️');
    await new Promise((r) => setTimeout(r, 1200));
    return { lokalne: docs.length, pow: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent.replace(/\s+/g, ' ').slice(0, 200)), wzor: _t('kb-sesja-wygasla') };
  });
  wynik('R9-F KOD8-10: dodanie dokumentu przy wygaslej sesji - komunikat o sesji, bez cichego zapisu tylko w przegladarce',
    dodanie.lokalne === 0 && dodanie.pow.some((p) => p.indexOf(dodanie.wzor) !== -1), JSON.stringify(dodanie));
  await k.addCookies(ciastka);
  await s.evaluate(async () => { const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); });
  wynik('R9-F KOD8-10: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-sesja');
  await k.close();
}

// KOD8-28: sciezki, ktorych nie sprawdzal zaden test (raport it-kod, "0 testow"): pliki do Bazy przez pole pliku
// (handleFiles/processFile), strona do Bazy (saveUrl + /api/strona), przeniesienie dokumentow z przegladarki na
// serwer (przeniesNaSerwer), Glos marki (analyzeBrandVoice) uzyty w prompcie artykulu, panel KD (toggleKdPanel),
// lektor artykulu (speakArticle) i monitor widocznosci AI (aivCheckOne/aivCheckAll).
async function scenariuszR9FPokrycie(b) {
  const srv = await serwer();
  const { k, bledyJs } = await kontekstProxy(b);
  const s = await zalogujProxy(k, srv.port, 'premium');
  const wyczyscBaze = () => s.evaluate(async () => { const d = await (await fetch('/api/baza')).json(); for (const x of d.dokumenty || []) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) }); await odswiezListeBazy(); });
  // Kazde powiadomienie od chwili pokazania (znikaja po 6 s, a na ekranie mieszcza sie 4).
  const powiadomienia = () => s.evaluate(() => window.__powiadomienia.slice());
  await s.evaluate(() => {
    window.__powiadomienia = [];
    new MutationObserver((zmiany) => zmiany.forEach((z) => z.addedNodes.forEach((n) => {
      if (n.classList && n.classList.contains('powiadomienie')) window.__powiadomienia.push(n.textContent.replace(/\s+/g, ' '));
    }))).observe(document.body, { childList: true, subtree: true });
  });
  const czekajNaBaze = (n) => s.waitForFunction((n) => (window._bazaSerwerLiczba || 0) >= n, n, { timeout: 15000 }).catch(() => {});
  await wyczyscBaze();
  const doBazy = [];
  const zap = [];
  s.on('request', (z) => {
    if (z.method() !== 'POST') return;
    if (/\/api\/baza$/.test(z.url())) { try { doBazy.push(JSON.parse(z.postData() || '{}')); } catch (e) { /* inne cialo */ } }
    if (/\/api$/.test(z.url())) zap.push({ czynnosc: z.headers()['x-cai-czynnosc'] || '', cialo: z.postData() || '' });
  });

  // Pliki przez pole pliku: TXT z polskimi literami, DOCX (z generatora eksportu aplikacji), prezentacja i pusty plik.
  const docx = await s.evaluate(async () => {
    await wczytajSkrypt('pwa/lib/docx-natywny.js');
    const el = document.createElement('div');
    el.innerHTML = '<h1>Oferta serwisowa</h1><p>Przegląd pompy ciepła raz w roku. Gwarancja 7 lat, dojazd w 48 godzin.</p>';
    const bajty = new Uint8Array(await (await window.DocxNatywny.zbuduj(el, { tytul: 'Oferta serwisowa', jezyk: 'pl-PL' })).arrayBuffer());
    let bin = ''; for (const x of bajty) bin += String.fromCharCode(x);
    return btoa(bin);
  });
  await s.evaluate(() => document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()));
  await s.setInputFiles('#file-input', [
    { name: 'cennik.txt', mimeType: 'text/plain', buffer: Buffer.from('Pompa ciepła Vitocal 250-A: montaż w 48 godzin, cena od 38 000 zł. Żółta karta gwarancyjna na 7 lat.', 'utf8') },
    { name: 'oferta-serwisowa.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docx, 'base64') },
    { name: 'prezentacja.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('PK') },
    { name: 'pusty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
  ]);
  await czekajNaBaze(2);
  await s.waitForTimeout(500);
  const pliki = await s.evaluate(() => ({ liczba: window._bazaSerwerLiczba || 0, lokalne: docs.length,
    pptx: _t('msg-plik-pptx').replace('{name}', 'prezentacja.pptx'), pusty: _t('msg-plik-pusty').replace('{name}', 'pusty.txt') }));
  const powPliki = await powiadomienia();
  const txt = doBazy.find((d) => d.nazwa === 'cennik.txt') || {};
  const dok = doBazy.find((d) => d.nazwa === 'oferta-serwisowa.docx') || {};
  wynik('R9-F KOD8-28: pliki do Bazy przez pole pliku - TXT i DOCX z polskimi literami na serwerze, bez kopii w przegladarce',
    /Pompa ciepła Vitocal/.test(txt.tresc || '') && /Żółta karta/.test(txt.tresc || '') && /Przegląd pompy ciepła/.test(dok.tresc || '') && /Gwarancja 7 lat/.test(dok.tresc || '')
      && pliki.liczba === 2 && pliki.lokalne === 0, JSON.stringify({ pliki, txt: (txt.tresc || '').slice(0, 80), dok: (dok.tresc || '').slice(0, 80) }));
  wynik('R9-F KOD8-28: prezentacja i pusty plik - komunikat zamiast dokumentu w Bazie',
    doBazy.length === 2 && powPliki.some((p) => p.indexOf(pliki.pptx) !== -1) && powPliki.some((p) => p.indexOf(pliki.pusty) !== -1), JSON.stringify({ wyslane: doBazy.map((d) => d.nazwa), powPliki }).slice(0, 400));

  // Strona do Bazy: adres bez https://, serwer pobiera strone (/api/strona udawane trasa - kontener nie ma sieci).
  let adresStrony = '';
  await s.route(/\/api\/strona$/, (route) => {
    try { adresStrony = JSON.parse(route.request().postData() || '{}').adres || ''; } catch (e) { /* inne cialo */ }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tytul: 'Termoplus - pompy ciepła w Krakowie',
      tekst: 'Termoplus montuje pompy ciepła w Krakowie i okolicach, z przeglądem po pierwszym sezonie grzewczym. '.repeat(6) + 'Serwis odpowiada w 24 godziny.' }) });
  });
  await s.evaluate(async () => { openUrlModal(); document.getElementById('u-url').value = 'termoplus.example.com/oferta'; await saveUrl(); });
  await czekajNaBaze(3);
  await s.unroute(/\/api\/strona$/);
  const strona = doBazy.find((d) => d.nazwa === 'Termoplus - pompy ciepła w Krakowie') || {};
  const oknoAdresu = await s.evaluate(() => document.getElementById('url-modal').classList.contains('open'));
  wynik('R9-F KOD8-28: strona do Bazy (saveUrl + /api/strona) - https:// dopisane, tytul strony jako nazwa, tresc i adres na serwerze',
    adresStrony === 'https://termoplus.example.com/oferta' && strona.url === 'https://termoplus.example.com/oferta' && /montuje pompy ciepła/.test(strona.tresc || '') && !oknoAdresu,
    JSON.stringify({ adresStrony, url: strona.url, tresc: (strona.tresc || '').slice(0, 80), oknoAdresu }));

  // Dokument sprzed Bazy na serwerze (tylko w przegladarce): "Przenies na serwer" w panelu Bazy.
  const przen = await s.evaluate(async () => {
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    docs.push({ name: 'Notatka z przegladarki', content: 'Klienci pytaja o dotacje Czyste Powietrze i montaz zima.', icon: '✏️', words: 9, added: new Date(), selected: true, url: null });
    rysujBazeWPanelu();
    const przycisk = document.querySelector('#kb-serwer .kb-przenies');
    const przed = window._bazaSerwerLiczba || 0;
    if (przycisk) przycisk.click();
    for (let i = 0; i < 60 && ((window._bazaSerwerLiczba || 0) === przed || docs.length); i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 300));
    return { przycisk: !!przycisk, przed, po: window._bazaSerwerLiczba || 0, lokalne: docs.length, wzor: _t('kb-przeniesiono') + ': 1', pow: window.__powiadomienia.slice(-3) };
  });
  wynik('R9-F KOD8-28: przeniesienie dokumentu z przegladarki na serwer - w Bazie na serwerze, nie w przegladarce, z komunikatem',
    przen.przycisk && przen.po === przen.przed + 1 && przen.lokalne === 0 && doBazy.some((d) => d.nazwa === 'Notatka z przegladarki') && przen.pow.some((p) => p.indexOf(przen.wzor) !== -1), JSON.stringify(przen).slice(0, 400));

  // Glos marki: profil z probek tekstu, zapisany i uzyty w prompcie nastepnego artykulu.
  const bv = await s.evaluate(async () => {
    openBvModal();
    document.getElementById('bv-articles').value = 'Pompa ciepla to inwestycja na lata. Liczymy koszty uczciwie i mowimy wprost, ile zaoszczedzisz. '
      + 'Montaz trwa dwa dni, a serwis odpowiada w 24 godziny. Bez zargonu, za to z liczbami.';
    document.querySelector('#bv-input-area button[onclick="analyzeBrandVoice()"]').click();
    for (let i = 0; i < 80 && !brandVoiceProfile; i++) await new Promise((r) => setTimeout(r, 250));
    return { styl: (brandVoiceProfile && brandVoiceProfile.style) || '', zapisany: !!magazyn.getItem('cai-bv'), otwarte: document.getElementById('bv-modal').classList.contains('open') };
  });
  wynik('R9-F KOD8-28: Glos marki - profil stylu z probek zapisany, okno zamkniete', !!bv.styl && bv.zapisany && !bv.otwarte, JSON.stringify(bv));
  // Podpis w menu ustawien: byl polski na sztywno (takze w interfejsie EN), a po zmianie jezyka "Nieaktywny".
  const plakietka = await s.evaluate(() => {
    const sub = () => document.getElementById('bv-menu-sub').textContent;
    const w = { pl: sub(), wzorPl: _t('settings-bv-active') };
    ustawJezyk('en'); w.en = sub(); w.wzorEn = _t('settings-bv-active');
    ustawJezyk('pl'); w.znowuPl = sub();
    return w;
  });
  wynik('R9-F KOD8-28: Glos marki - podpis "aktywny" w menu ze slownika, takze po zmianie jezyka',
    plakietka.pl === plakietka.wzorPl && plakietka.en === plakietka.wzorEn && plakietka.en !== plakietka.pl && plakietka.znowuPl === plakietka.wzorPl, JSON.stringify(plakietka));
  await s.fill('#kw-input', 'pompy ciepla');
  await s.press('#kw-input', 'Enter');
  await s.evaluate(() => { document.getElementById('topic').value = 'Pompy ciepla w Krakowie'; document.getElementById('use-web').checked = false; generate(true); });
  await krok('R9-F KOD8-28 artykul z Glosem marki', czekajNaKoniec(s));
  const artykul = zap.filter((z) => z.czynnosc === 'artykul').map((z) => z.cialo);
  wynik('R9-F KOD8-28: Glos marki trafia do promptu artykulu', !!bv.styl && artykul.some((c) => c.indexOf('BRAND VOICE - apply this style: ' + JSON.stringify(bv.styl).slice(1, -1)) !== -1),
    'zapytan artykulu: ' + artykul.length);

  // Panel KD: klik w gestosc slow kluczowych otwiera tabele, drugi klik zamyka.
  const kd = await s.evaluate(() => {
    const w = document.getElementById('stat-kd-wrap'), p = document.getElementById('kd-panel');
    w.click(); const otwarty = p.style.display === 'block', wiersze = p.querySelectorAll('.kd-row').length;
    w.click(); return { otwarty, wiersze, zamkniety: p.style.display === 'none' };
  });
  wynik('R9-F KOD8-28: panel KD - tabela gestosci slow kluczowych otwiera sie i zamyka', kd.otwarty && kd.wiersze > 0 && kd.zamkniety, JSON.stringify(kd));

  // Lektor: "Posluchaj" czyta artykul glosem z serwera (TTS przez /api/tts, atrapa MP3).
  const tts = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api\/tts/.test(z.url())) tts.push(z.url()); });
  const przedLektorem = (await powiadomienia()).length;
  await krok('R9-F KOD8-28 lektor: menu Wiecej', s.click('#grupa-wiecej-wrap > button', { timeout: 5000 }));
  await krok('R9-F KOD8-28 lektor: Posluchaj', s.click('#tts-btn', { timeout: 5000 }));
  await s.waitForFunction(() => window.AUDIO && AUDIO.buffer && AUDIO.playing, null, { timeout: 30000 }).catch(() => {});
  const lektor = await s.evaluate(() => ({ gra: !!(AUDIO.buffer && AUDIO.playing), czas: Math.round(AUDIO.dur || 0), przycisk: document.getElementById('tts-btn').textContent.trim(), wzor: _t('audio-pause') }));
  lektor.pow = (await powiadomienia()).slice(przedLektorem).map((p) => p.slice(0, 160));
  await s.evaluate(() => { try { audioBarClose(); } catch (e) { /* bez paska */ } });
  wynik('R9-F KOD8-28: lektor artykulu - glos z serwera gra, przycisk "Pauza", bez bledu', lektor.gra && lektor.przycisk === lektor.wzor && tts.length > 0 && !lektor.pow.length,
    JSON.stringify({ lektor, tts: tts.length }));

  // Monitor widocznosci AI: zapytania dodane w oknie, "Sprawdz" przy jednym i "Sprawdz wszystkie" zapisuja pomiar.
  // Domeny google.com i gov.pl sa zawsze w wynikach wyszukiwania atrapy, wiec status to "cytowane".
  const aiv = await s.evaluate(async () => {
    aivOpen();
    const c = aivCfg(); c.domains = ['google.com', 'gov.pl']; c.brands = ['Termoplus']; c.queries = []; aivSave(c);
    for (const q of ['czy Termoplus to dobry instalator pomp ciepla', 'najlepszy instalator pomp ciepla w Krakowie']) { document.getElementById('aiv-add-input').value = q; aivAdd(); }
    await aivCheckOne(0, document.querySelector('#aiv-list button[onclick^="aivCheckOne(0"]'));
    const poJednym = aivCfg().queries.map((q) => (q.hist || []).length);
    await aivCheckAll(null);
    const po = aivCfg().queries;
    const wynik = { poJednym, poWszystkich: po.map((q) => (q.hist || []).length), status: po.map((q) => (q.hist && q.hist.length ? q.hist[q.hist.length - 1].status : '')),
      ocena: document.getElementById('aiv-score').textContent, lista: (document.getElementById('aiv-list').innerText || '').replace(/\s+/g, ' ').slice(0, 240), etykieta: _t('aiv-status-cited') };
    aivClose();
    return wynik;
  });
  const pytaniaAiv = zap.filter((z) => /helpful AI assistant answering a user question using web search/.test(z.cialo));
  wynik('R9-F KOD8-28: monitor widocznosci AI - "Sprawdz" i "Sprawdz wszystkie" zapisuja pomiar z wyszukiwaniem, wynik i status w oknie',
    aiv.poJednym.join() === '1,0' && aiv.poWszystkich.join() === '2,1' && aiv.status.every((x) => x === 'cited') && aiv.ocena === '100/100' && aiv.lista.indexOf(aiv.etykieta) !== -1
      && pytaniaAiv.length === 3 && pytaniaAiv.every((z) => /web_search/.test(z.cialo) && /in Polish/.test(z.cialo)), JSON.stringify({ aiv, pytan: pytaniaAiv.length }).slice(0, 500));

  await wyczyscBaze();
  wynik('R9-F KOD8-28: bez bledow JavaScript', !bledyJs.length, bledyJs.join(' | '));
  if (bledow) await zrzut(s, 'r9f-pokrycie');
  await k.close();
}

// Scenariusze po kolei, kazdy osobno: wyjatek w jednym (KOD8-03) nie pomija nastepnych.
// CAI_TEST_TYLKO=nazwa,nazwa uruchamia wybrane (np. CAI_TEST_TYLKO=r9f-keys).
const SCENARIUSZE = [
  ['stan', scenariuszStanu], ['r4-logika', scenariuszR4Logiki], ['bledy', scenariuszBledow], ['historia-r4', scenariuszHistoriiR4],
  ['r9f-keys', scenariuszR9FKeys], ['r9f-telefon-pisz', scenariuszR9FTelefonPisz], ['r9f-temat', scenariuszR9FTemat], ['r9f-koszt', scenariuszR9FKoszt], ['r9f-widocznosc', scenariuszR9FWidocznosc], ['r9f-brama', scenariuszR9FBrama], ['r9f-dwie-karty', scenariuszR9FDwieKarty],
  ['r9f-pause-turn', scenariuszR9FPauseTurn], ['r9f-przeladowanie', scenariuszR9FPrzeladowanie], ['r9f-fakty', scenariuszR9FFakty],
  ['r9f-transkrypcja', scenariuszR9FTranskrypcja], ['r9f-duzy-dokument', scenariuszR9FDuzyDokument],
  ['r9f-cms', scenariuszR9FCms], ['r9f-pdf', scenariuszR9FPdf],
  ['r9f-luki-darmowy', scenariuszR9FLukiDarmowy], ['r9f-bez-sieci', scenariuszR9FBezSieci],
  ['r9f-prompt-bazy', scenariuszR9FPromptBazy], ['r9f-pomocnicy', scenariuszR9FPomocnicy],
  ['r9f-narracja', scenariuszR9FNarracja], ['r9f-sesja', scenariuszR9FSesja],
  ['r9f-pokrycie', scenariuszR9FPokrycie],
];
(async () => {
  let b;
  const tylko = String(process.env.CAI_TEST_TYLKO || '').split(',').map((x) => x.trim()).filter(Boolean);
  try {
    b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
    for (const [nazwa, scenariusz] of SCENARIUSZE) {
      if (tylko.length && tylko.indexOf(nazwa) < 0) continue;
      const przed = new Set(b.contexts());
      try { await scenariusz(b); }
      catch (e) {
        wynik('scenariusz ' + nazwa + ' przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
        for (const k of b.contexts()) if (!przed.has(k)) await k.close().catch(() => {});
      }
    }
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    if (b) await b.close();
    if (SERWER) { if (bledow) console.log(SERWER.log().split('\n').slice(-15).join('\n')); SERWER.zatrzymaj(); }
    if (KAT_DZIENNIKA) { if (bledow) console.log('Dziennik atrapy: ' + process.env.ATRAPA_DZIENNIK); else fs.rmSync(KAT_DZIENNIKA, { recursive: true, force: true }); }
  }
  console.log(bledow ? '\nBLEDOW: ' + bledow : '\nWszystkie scenariusze przeszly.');
  process.exit(bledow ? 1 : 0);
})();
