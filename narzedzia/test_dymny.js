#!/usr/bin/env node
'use strict';
/*
 * Test dymny Content AI w prawdziwej przegladarce, z atrapa dostawcow AI.
 *
 * Podpisy w sprawdz_zrodlo.py pilnuja, ze poprawka jest w kodzie. Ten test
 * sprawdza, ze ona DZIALA: uruchamia aplikacje, generuje artykuly i klika.
 * Wszystkie bledy z audytu rundy 1 (blad API zapisany jako artykul, przerobki
 * martwe za proxy, Escape otwierajacy grafike, historia widoczna dla innego
 * konta) przechodzily dotad CI na zielono, bo zadna kontrola nie uruchamiala
 * aplikacji.
 *
 * Uzycie (z katalogu repozytorium, po zbudowaniu wariantow):
 *   npm install --no-save playwright && npx playwright install chromium
 *   node narzedzia/test_dymny.js
 * Zmienne: CAI_CHROMIUM - sciezka do Chromium (domyslnie z Playwright),
 *          CAI_TEST_ZRZUTY - katalog na zrzuty ekranu przy bledzie.
 * Kod wyjscia: 0 gdy wszystko przeszlo, 1 gdy cokolwiek nie.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Brak pakietu playwright: npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }

// Porty z ATRAPA_PORT / CAI_TEST_PORT albo wolne, wskazane przez system (rownolegle
// przebiegi nie koliduja). Atrapa czyta port przy require, wiec ladujemy ja po wyborze.
let atrapa, PORT_ATRAPY, PORT_SERWERA;
function wolnyPort() {
  return new Promise((ok, zle) => {
    const srv = require('net').createServer();
    srv.once('error', zle);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => ok(p)); });
  });
}
async function przygotujPorty() {
  PORT_ATRAPY = Number(process.env.ATRAPA_PORT) || await wolnyPort();
  PORT_SERWERA = Number(process.env.CAI_TEST_PORT) || await wolnyPort();
  process.env.ATRAPA_PORT = String(PORT_ATRAPY);
  atrapa = require('./atrapa/dostawcy.js');
}
const ZRZUTY = process.env.CAI_TEST_ZRZUTY || path.join(os.tmpdir(), 'cai-test-zrzuty');
const HASLO = 'test-haslo-123';

let bledow = 0;
function wynik(nazwa, ok, szczegol) {
  console.log((ok ? 'ok    ' : 'BLAD  ') + nazwa + (!ok && szczegol ? '  [' + szczegol + ']' : ''));
  if (!ok) bledow++;
}

// Limit czasu kroku nie przerywa testu, ale konczy sie BLEDEM z nazwa kroku - wczesniej
// polkniety limit przenosil czerwien na nastepny scenariusz.
async function krok(nazwa, obietnica) {
  try { await obietnica; return true; }
  catch (e) { wynik('krok: ' + nazwa, false, (e && e.message || String(e)).split('\n')[0]); return false; }
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

function przygotujDane() {
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-test-'));
  const { zahaszuj } = require(path.join(REPO, 'serwer', 'server.js'));
  const konta = [
    ['admin', 'admin', 'premium'], ['premium', 'uzytkownik', 'premium'],
    ['standard', 'uzytkownik', 'standard'], ['darmowy', 'uzytkownik', 'darmowy'],
  ].map(([login, rola, plan]) => Object.assign({ login, rola, plan, utworzony: '2026-01-01' }, zahaszuj(HASLO)));
  fs.writeFileSync(path.join(kat, 'uzytkownicy.json'), JSON.stringify(konta, null, 2));
  return kat;
}

function uruchomSerwer(kat) {
  const env = Object.assign({}, process.env, {
    CAI_UZYTKOWNICY: path.join(kat, 'uzytkownicy.json'), CAI_BAZA: path.join(kat, 'baza'),
    CAI_UZYCIE: path.join(kat, 'uzycie'), CAI_MARKA: kat, CAI_SEKRET_PLIK: path.join(kat, 'sekret'),
    PORT: String(PORT_SERWERA), CAI_HOST: '127.0.0.1',
    ANTHROPIC_KEY: 'test-anthropic', OPENAI_KEY: 'test-openai', ELEVEN_KEY: 'test-eleven',
    CAI_URL_ANTHROPIC: 'http://127.0.0.1:' + PORT_ATRAPY + '/v1/messages',
    CAI_URL_OPENAI: 'http://127.0.0.1:' + PORT_ATRAPY + '/v1',
    CAI_URL_ELEVEN: 'http://127.0.0.1:' + PORT_ATRAPY + '/eleven/v1',
    CAI_ZAUFANE_ADRESY: '127.0.0.1',
  });
  const p = spawn(process.execPath, [path.join(REPO, 'serwer', 'server.js')], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  p.log = () => log;
  return p;
}

const PRZED_STARTEM = () => {
  try {
    localStorage.setItem('cai_key_anthropic', 'sk-ant-atrapa');
    localStorage.setItem('cai_lang', 'pl');
    localStorage.setItem('cai_start_v1', '1');
    sessionStorage.setItem('cin_splash', '1');
  } catch (e) { /* tryb bez magazynu */ }
};

async function czekajNaKoniec(s, ms) {
  await s.waitForFunction(() => {
    const b = document.getElementById('gen-btn');
    const sp = document.getElementById('spinner');
    return b && !b.disabled && sp && getComputedStyle(sp).display === 'none';
  }, null, { timeout: ms || 60000 });
}

async function generuj(s, temat) {
  await s.fill('#topic', temat);
  await s.evaluate(() => { document.getElementById('use-web').checked = true; });
  await s.click('#gen-btn');
  await czekajNaKoniec(s);
  return s.evaluate(() => {
    const art = document.getElementById('article');
    let hist = 0; try { hist = history.length; } catch (e) { hist = -1; }
    return {
      odznaka: document.getElementById('out-badge').className + '|' + document.getElementById('out-badge').textContent,
      h2: art.querySelectorAll('h2').length, meta: !!art.querySelector('.meta-box'),
      poczatek: (art.innerText || '').slice(0, 200), hist,
    };
  });
}

async function zrzut(s, nazwa) {
  try { fs.mkdirSync(ZRZUTY, { recursive: true }); await s.screenshot({ path: path.join(ZRZUTY, nazwa + '.png') }); } catch (e) { /* bez zrzutu */ }
}

// ── Wariant keys: plik z dysku, dostawcy przechwyceni w przegladarce ─────────
async function wariantKeys(b) {
  const plik = 'file://' + path.join(REPO, 'app', 'web-keys.html');
  async function strona(zly, adres = plik) {
    const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    await k.addInitScript(PRZED_STARTEM);
    await k.route(/api\.anthropic\.com|api\.openai\.com|api\.elevenlabs\.io/, async (route) => {
      if (zly && route.request().method() === 'POST') {
        const c = JSON.parse(route.request().postData() || '{}');
        if (c.max_tokens > 1000 && /Temat zlosliwy/.test(JSON.stringify(c.messages || ''))) {
          return route.fulfill({ status: 200, contentType: 'application/json', headers: atrapa.CORS,
            body: JSON.stringify({ type: 'message', role: 'assistant', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
              content: [{ type: 'text', text: '<h1>T</h1><p onclick="window.__xss=1">A <a href="javascript:window.__xss=2">x</a> <a href="https://example.com/y">y</a></p><img src="x" onerror="window.__xss=3"><svg><script>window.__xss=4</script></svg><h2>S</h2><div class="meta-box"><p>M</p></div>' }] }) });
        }
      }
      return atrapa.obsluzRoute(route);
    });
    const s = await k.newPage();
    const bledy = [];
    s.on('pageerror', (e) => bledy.push(e.message));
    s.on('dialog', (d) => d.accept());
    await s.goto(adres, { waitUntil: 'load' });
    await s.waitForTimeout(600);
    return { k, s, bledy };
  }

  let { k, s, bledy } = await strona(false);
  let r = await generuj(s, 'Jak wybrac pompe ciepla do domu');
  wynik('keys: artykul gotowy, sekcje i meta', /ready/.test(r.odznaka) && r.h2 >= 3 && r.meta, JSON.stringify(r));
  wynik('keys: artykul w historii', r.hist === 1, 'hist=' + r.hist);
  r = await generuj(s, 'Temat uciety [atrapa:max-tokens@artykul]');
  wynik('keys: artykul uciety oznaczony ostrzezeniem', /uwaga/.test(r.odznaka), r.odznaka);
  r = await generuj(s, 'Temat bledu [atrapa:529@artykul]');
  wynik('keys: blad API nie jest artykulem i nie trafia do historii', /^badge\|/.test(r.odznaka) && !/ready/.test(r.odznaka) && r.hist === 2, r.odznaka + ' hist=' + r.hist);
  r = await generuj(s, 'Temat ze wstepem [atrapa:wstep]');
  wynik('keys: zapowiedz wyszukiwania nie trafia nad tytul', !/Wyszukam|I will search/.test(r.poczatek.slice(0, 80)), r.poczatek.slice(0, 60));

  // Samokorekta w menu obok przycisku Wygeneruj: przelacznik nie zamyka menu,
  // stan widac na przycisku; Dodatkowe wytyczne stoja poza zaawansowanymi.
  await s.click('#grupa-brief-wrap > .btn-secondary');
  await s.click('#premium-btn');
  const sk = await s.evaluate(() => ({
    otwarte: document.getElementById('grupa-brief-wrap').classList.contains('open') || getComputedStyle(document.getElementById('grupa-brief-menu')).display !== 'none',
    aria: document.getElementById('premium-btn').getAttribute('aria-checked'),
    naPrzycisku: document.getElementById('gen-btn').classList.contains('z-samokorekta') && premiumMode === true,
    wytyczne: !document.getElementById('extra').closest('#brief-zaawansowane'),
  }));
  await s.click('#premium-btn');
  const skWyl = await s.evaluate(() => premiumMode === false && !document.getElementById('gen-btn').classList.contains('z-samokorekta'));
  await s.keyboard.press('Escape');
  wynik('keys: samokorekta w menu przelacza sie i pokazuje stan na przycisku', sk.otwarte && sk.aria === 'true' && sk.naPrzycisku && skWyl, JSON.stringify(sk));
  wynik('keys: dodatkowe wytyczne poza ustawieniami zaawansowanymi', sk.wytyczne, '');

  // Brief artykulu zapamietany dla tematu: drugie otwarcie bez nowego zapytania,
  // "Analizuj ponownie" pyta jeszcze raz; liczba slow bez podwojonego "slow".
  let briefZapytan = 0;
  const liczBrief = (z) => { if (z.method() === 'POST' && /Analyze the topic and knowledge base/.test(z.postData() || '')) briefZapytan++; };
  s.on('request', liczBrief);
  await s.fill('#topic', 'Temat do briefu');
  await s.evaluate(() => openBriefPanel());
  await krok('brief artykulu', s.waitForFunction(() => !!document.getElementById('brief-kw-list'), null, { timeout: 15000 }));
  await s.evaluate(() => closeBriefPanel());
  await s.evaluate(() => openBriefPanel());
  await s.waitForTimeout(300);
  const br = await s.evaluate(() => ({ zapamietany: !!document.querySelector('#brief-content .brief-zapamietany'),
    tekst: document.getElementById('brief-content').textContent }));
  const pierwszy = briefZapytan;
  await s.evaluate(() => openBriefPanel(true));
  await krok('brief ponownie', s.waitForFunction(() => !!document.getElementById('brief-kw-list') && !document.querySelector('#brief-content .brief-zapamietany'), null, { timeout: 15000 }));
  wynik('keys: brief zapamietany dla tematu, Analizuj ponownie pyta jeszcze raz',
    pierwszy === 1 && br.zapamietany && briefZapytan === 2, JSON.stringify({ pierwszy, razem: briefZapytan, zapamietany: br.zapamietany }));
  wynik('keys: liczba slow w briefie bez podwojonego slowa', !/(słów|words)\s+(słów|words)/.test(br.tekst), br.tekst.slice(-60));
  s.off('request', liczBrief);
  await s.evaluate(() => closeBriefPanel());

  // Ucieta samokorekta (max_tokens przy poprawie) nie zastepuje pelnego artykulu.
  await s.fill('#topic', 'Temat premium [atrapa:ocena=55@ocena-premium] [atrapa:max-tokens@poprawa]');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; premiumMode = true; generate(true); });
  await krok('generowanie z samokorekta', s.waitForFunction(() => !document.getElementById('gen-btn').disabled && getComputedStyle(document.getElementById('spinner')).display === 'none', null, { timeout: 60000 }));
  const pr = await s.evaluate(() => { premiumMode = false; const a = document.getElementById('article');
    return { h2: a.querySelectorAll('h2').length, meta: !!a.querySelector('.meta-box'), info: [...document.querySelectorAll('.powiadomienie')].map(p => p.textContent).join(' ') }; });
  wynik('keys: ucieta samokorekta zostawia oryginal i informuje', pr.h2 >= 3 && pr.meta && /limicie|length limit/.test(pr.info), JSON.stringify(pr));

  // Escape na swiezej stronie nie otwiera Generatora grafik; okna maja role i fokus.
  await s.keyboard.press('Escape');
  await s.keyboard.press('Escape');
  wynik('keys: Escape nie otwiera Generatora grafik', await s.evaluate(() => getComputedStyle(document.getElementById('img-panel')).display === 'none'));
  const przycisk = await s.$('button[onclick="otworzTematy()"]');
  await przycisk.focus();
  await s.keyboard.press('Enter');
  await s.waitForTimeout(200);
  const okno = await s.evaluate(() => {
    const d = document.querySelector('#tematy-modal .modal');
    return { rola: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), fokus: d.contains(document.activeElement) };
  });
  wynik('keys: okno ma role dialog i fokus w srodku', okno.rola === 'dialog' && okno.modal === 'true' && okno.fokus, JSON.stringify(okno));
  await s.keyboard.press('Escape');
  await s.waitForTimeout(150);
  wynik('keys: Escape zamyka okno i oddaje fokus', await s.evaluate(() => !document.getElementById('tematy-modal').classList.contains('open') && document.activeElement && document.activeElement.getAttribute('onclick') === 'otworzTematy()'));

  // Przerwanie dlugiego generowania.
  const histPrzed = await s.evaluate(() => history.length);
  await s.fill('#topic', 'Dlugie pisanie [atrapa:opoznienie=8000@artykul]');
  await s.click('#gen-btn');
  await s.waitForTimeout(1500);
  await s.click('#spin-stop');
  await krok('Przerwij konczy generowanie', czekajNaKoniec(s, 8000));
  const po = await s.evaluate(() => ({ odz: document.getElementById('out-badge').className, h: history.length, temat: document.getElementById('topic').value }));
  wynik('keys: Przerwij konczy generowanie bez wpisu w historii', po.h === histPrzed && /Dlugie/.test(po.temat) && !/ready/.test(po.odz), JSON.stringify(po));

  wynik('keys: bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'keys');
  await k.close();

  // Szkic i ostatni artykul po odswiezeniu. Ten scenariusz idzie z adresu http, nie
  // z file://: Chromium 153 (headless shell w CI) daje nowemu dokumentowi z file://
  // w okolo 40% przebiegow pusty localStorage (zostaja tylko klucze z PRZED_STARTEM),
  // i to zarowno po reload, jak i po ponownym wejsciu. To cecha przegladarki dla
  // plikow z dysku; uzytkownicy otwieraja aplikacje z serwera.
  const adres = 'http://127.0.0.1:' + PORT_PLIKOW + '/web-keys.html';
  const bledowPrzed = bledow;
  ({ k, s, bledy } = await strona(false, adres));
  await generuj(s, 'Artykul przed odswiezeniem');
  await s.fill('#topic', 'Temat w trakcie pisania');
  // Odswiezenie dopiero, gdy szkic i historia sa na pewno w magazynie (zapis szkicu jest
  // odkladany o 400 ms, a historia po pierwszym malowaniu): bez tego na wolniejszym
  // CI odswiezenie wyprzedzalo zapis.
  await krok('szkic zapisany przed odswiezeniem', s.waitForFunction(() => {
    try { return JSON.parse(magazyn.getItem('cai_szkic') || '{}').topic === 'Temat w trakcie pisania' && JSON.parse(magazyn.getItem('cai_history_v2') || '[]').length > 0
      && magazyn.getItem('cai_biezacy') !== null; } catch (e) { return false; }
  }, null, { timeout: 8000 }));
  await s.goto(adres, { waitUntil: 'load' });
  await krok('szkic i artykul po odswiezeniu', s.waitForFunction(() => document.getElementById('topic').value !== '' && getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: 8000 }));
  const st = await s.evaluate(() => ({ t: document.getElementById('topic').value, art: getComputedStyle(document.getElementById('article')).display,
    // diagnostyka na wypadek bledu: co jest w magazynie po odswiezeniu
    szkic: (magazyn.getItem('cai_szkic') || '').slice(0, 60), hist: (magazyn.getItem('cai_history_v2') || '').length, biezacy: magazyn.getItem('cai_biezacy'),
    ls: (() => { try { return localStorage.length; } catch (e) { return e.name; } })() }));
  wynik('keys: szkic formularza i artykul wracaja po odswiezeniu', st.t === 'Temat w trakcie pisania' && st.art === 'block', JSON.stringify(st));
  // Temat, z ktorego powstal ostatni artykul, nie wraca do briefu; start na Briefie.
  await s.evaluate(() => { document.getElementById('topic').value = history[biezacyHist >= 0 ? biezacyHist : 0].topic; zapiszSzkic(); });
  await s.goto(adres, { waitUntil: 'load' });
  await krok('artykul po odswiezeniu bez starego tematu', s.waitForFunction(() => getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: 8000 }));
  await s.waitForTimeout(300);
  const st2 = await s.evaluate(() => ({ t: document.getElementById('topic').value, kw: keywords.length, wynik: document.body.classList.contains('widok-wynik') }));
  wynik('keys: po wejsciu brief pusty (temat artykulu nie wraca), widok Brief', st2.t === '' && st2.kw === 0 && !st2.wynik, JSON.stringify(st2));
  wynik('keys (http): bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow > bledowPrzed) await zrzut(s, 'keys-odswiezenie');
  await k.close();

  ({ k, s, bledy } = await strona(true));
  await generuj(s, 'Temat zlosliwy');
  const x = await s.evaluate(() => {
    const art = document.getElementById('article');
    return { xss: window.__xss || 0, js: art.querySelectorAll('a[href^="javascript"]').length, on: art.querySelectorAll('[onclick],[onerror]').length,
      obce: art.querySelectorAll('img,svg,script').length, dobry: !!art.querySelector('a[href="https://example.com/y"]'), meta: !!art.querySelector('.meta-box') };
  });
  wynik('keys: HTML od modelu oczyszczony, zwykle znaczniki zostaja', x.xss === 0 && !x.js && !x.on && !x.obce && x.dobry && x.meta, JSON.stringify(x));
  await k.close();

  // Uszkodzone ustawienia w magazynie nie zatrzymuja aplikacji.
  const k2 = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await k2.addInitScript(() => { try { localStorage.setItem('cai-wp', '{zepsuty'); localStorage.setItem('cai-bv', '{'); sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  const s2 = await k2.newPage();
  const b2 = [];
  s2.on('pageerror', (e) => b2.push(e.message));
  await s2.goto(plik, { waitUntil: 'load' });
  await s2.waitForTimeout(600);
  wynik('keys: uszkodzony magazyn nie zatrzymuje skryptu (telefon)', !b2.length && await s2.evaluate(() => document.body.classList.contains('is-mobile')), b2.join(' | '));
  await k2.close();
}

// ── Wariant proxy: serwer z kontami, dostawcy na atrapie ────────────────────
async function zaloguj(k, login) {
  const s = await k.newPage();
  await s.goto('http://127.0.0.1:' + PORT_SERWERA + '/', { waitUntil: 'load' });
  if (await s.$('input[name="login"]')) {
    await s.fill('input[name="login"]', login);
    await s.fill('input[type="password"]', HASLO);
    await Promise.all([s.waitForNavigation({ waitUntil: 'load' }), s.click('button[type="submit"], input[type="submit"]')]);
  }
  await s.waitForTimeout(800);
  await s.evaluate(() => { if (typeof startPomin === 'function') startPomin(); });
  return s;
}

async function wariantProxy(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  // Nasluch od pierwszego zaladowania kazdej strony - blad skladni w skrypcie
  // wykonanym przed zalogowaniem albo zaraz po nim tez ma oblac test.
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  let s = await zaloguj(k, 'premium');
  const r = await generuj(s, 'Artykul konta premium');
  wynik('proxy: artykul gotowy', /ready/.test(r.odznaka) && r.h2 >= 3, JSON.stringify(r));

  // Telefon w tle: polaczenie zrywa sie w trakcie generowania (przelaczenie aplikacji),
  // serwer konczy zadanie, a aplikacja po powrocie sieci odbiera wynik zamiast
  // "Brak polaczenia z serwerem" (serwer/zadania.js, fetchZadania w aplikacji).
  const histPrzedZ = await s.evaluate(() => history.length);
  // Zapytanie o artykul dochodzi do serwera, ale odpowiedz nie wraca do przegladarki:
  // route.fetch() wysyla je naprawde, route.abort() zrywa polaczenie po stronie strony.
  let zerwij = true;
  await s.route(/\/api$/, async (route) => {
    const z = route.request();
    if (zerwij && z.method() === 'POST' && z.headers()['x-cai-czynnosc'] === 'artykul' && /Artykul w tle/.test(z.postData() || '')) {
      zerwij = false;
      route.fetch().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await s.fill('#topic', 'Artykul w tle [atrapa:opoznienie=2500@artykul]');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; generate(); });
  await krok('generowanie po zerwanym polaczeniu', czekajNaKoniec(s, 40000));
  const zt = await s.evaluate(() => ({ h: history.length, odz: document.getElementById('out-badge').className,
    art: getComputedStyle(document.getElementById('article')).display, blad: (document.querySelector('#output-area .error-box, .blad-generowania') || {}).textContent || '' }));
  wynik('proxy: zerwane polaczenie w trakcie generowania - wynik odebrany po powrocie', zt.h === histPrzedZ + 1 && /ready/.test(zt.odz) && zt.art === 'block', JSON.stringify(zt));
  wynik('proxy: polaczenie naprawde zerwane w tescie', !zerwij);
  await s.unroute(/\/api$/);

  // Zatrzymaj w Generuj grupowo przerywa biezacy artykul takze na serwerze
  // (anulowanie zadania w tle) i nie startuje kolejnych tematow (kod-03).
  const grupowe = { anuluj: 0, artykuly: 0 };
  const liczGrupowe = (z) => {
    if (z.method() !== 'POST') return;
    if (/\/api\/zadanie\/anuluj$/.test(z.url())) grupowe.anuluj++;
    else if (/\/api$/.test(z.url()) && z.headers()['x-cai-czynnosc'] === 'artykul') grupowe.artykuly++;
  };
  s.on('request', liczGrupowe);
  await s.evaluate(() => {
    openBulkModal();
    document.getElementById('bulk-topics').value = 'Dlugi grupowy [atrapa:opoznienie=6000@artykul]\nDrugi grupowy';
    updateBulkCount();
    startBulkGenerate();
  });
  await s.waitForTimeout(1500);
  await krok('Zatrzymaj w kolejce grupowej', s.click('#bulk-stop', { timeout: 3000 }));
  await krok('kolejka grupowa zatrzymana', s.waitForFunction(() => !bulkRunning, null, { timeout: 5000 }));
  await s.waitForTimeout(800);
  s.off('request', liczGrupowe);
  await s.evaluate(() => closeBulkModal());
  wynik('proxy: Zatrzymaj w Generuj grupowo anuluje zadanie na serwerze i nie startuje kolejnych', grupowe.anuluj >= 1 && grupowe.artykuly === 1, JSON.stringify(grupowe));

  await s.evaluate(() => runRepurpose('linkedin'));
  await krok('przerobka LinkedIn', s.waitForFunction(() => { const o = document.getElementById('repurpose-out'); return o && o.value && o.value.length > 20; }, null, { timeout: 30000 }));
  const rp = await s.evaluate(() => (document.getElementById('repurpose-out') || {}).value || '');
  wynik('proxy: przerobka LinkedIn dziala bez klucza w przegladarce', rp.length > 20 && !/Brak klucza|Missing API key/.test(rp), rp.slice(0, 60));

  // Jedna baza wiedzy: tekst z panelu idzie na serwer.
  await s.evaluate(() => openTextModal());
  await s.fill('#m-name', 'Cennik montazu');
  await s.fill('#m-content', 'Montaz kosztuje od 18 do 35 tys. zl. Gwarancja 7 lat.');
  await s.evaluate(() => saveText());
  await krok('dokument w bazie serwera', s.waitForFunction(() => (window._bazaSerwerLiczba || 0) > 0, null, { timeout: 10000 }));
  wynik('proxy: dokument z panelu trafia do bazy na serwerze', await s.evaluate(() => window._bazaSerwerLiczba === 1 && docs.length === 0));

  wynik('proxy: pozycja Wyloguj sie w menu', !!(await s.$('[onclick="wyloguj()"]')));
  await s.evaluate(() => { magazyn.setItem('cai_klucz_anthropic', 'sk-ant-wlasny'); magazyn.setItem('cai-wp', '{"url":"https://x.pl","pass":"tajne"}'); zapiszSzkic(); });
  await Promise.all([s.waitForNavigation({ waitUntil: 'load' }), s.evaluate(() => wyloguj())]);
  wynik('proxy: wylogowanie wraca do ekranu logowania', !!(await s.$('input[name="login"]')));
  const mag = await s.evaluate(() => Object.keys(localStorage));
  wynik('proxy: wylogowanie usuwa klucze i hasla CMS konta, szkic zostaje',
    !mag.some((n) => /cai_klucz_|cai_key_|cai-wp$|cai-drupal$/.test(n)) && mag.some((n) => /cai_szkic$/.test(n)), mag.join(','));
  await s.close();
  s = await zaloguj(k, 'standard');
  wynik('proxy: inne konto nie widzi historii poprzedniego', await s.evaluate(() => history.length === 0));
  wynik('proxy: inne konto nie widzi bazy prywatnej poprzedniego', await s.evaluate(() => (window._bazaSerwerLiczba || 0) === 0));
  wynik('proxy: bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'proxy');
  await k.close();
}

// Pliki z app/ pod http://127.0.0.1 - dla scenariuszy, ktore z file:// sa w CI niestabilne.
let PORT_PLIKOW;
const TYPY = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
async function uruchomSerwerPlikow() {
  const kat = path.join(REPO, 'app');
  PORT_PLIKOW = await wolnyPort();
  const srv = http.createServer((zad, odp) => {
    const sciezka = path.normalize(path.join(kat, decodeURIComponent(zad.url.split('?')[0])));
    if (!sciezka.startsWith(kat + path.sep) || !fs.existsSync(sciezka) || !fs.statSync(sciezka).isFile()) { odp.writeHead(404); return odp.end(); }
    odp.writeHead(200, { 'Content-Type': TYPY[path.extname(sciezka)] || 'application/octet-stream' });
    fs.createReadStream(sciezka).pipe(odp);
  });
  await new Promise((ok) => srv.listen(PORT_PLIKOW, '127.0.0.1', ok));
  return srv;
}

(async () => {
  await przygotujPorty();
  const serwerPlikow = await uruchomSerwerPlikow();
  const serwerAtrapy = atrapa.uruchom();
  const kat = przygotujDane();
  const serwer = uruchomSerwer(kat);
  let b;
  try {
    await czekajNaPort(PORT_SERWERA, 15000);
    b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
    await wariantKeys(b);
    await wariantProxy(b);
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
    console.log(serwer.log().split('\n').slice(-20).join('\n'));
  } finally {
    if (b) await b.close();
    serwer.kill();
    serwerAtrapy.close();
    serwerPlikow.close();
    fs.rmSync(kat, { recursive: true, force: true });
  }
  console.log(bledow ? '\nBLEDOW: ' + bledow : '\nWszystkie scenariusze przeszly.');
  process.exit(bledow ? 1 : 0);
})();
