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

  // R4 (UX4-04, UX4-07): przelaczniki SERP i AEO w tresci ustawien zaawansowanych (z odstepami),
  // Zrodla i ustawienia nie siedza w polu Dodatkowe wytyczne; skrot statystyk odmienia "slowo" jak arkusz.
  const uklad = await s.evaluate(async () => {
    const tresc = document.querySelector('#brief-zaawansowane > .zaawansowane-tresc');
    const w = { serp: !!(tresc && tresc.contains(document.getElementById('use-serp'))), aeo: !!(tresc && tresc.contains(document.getElementById('use-aeo'))),
      zrodla: !document.querySelector('.field.zrodla').parentElement.closest('.field'), szczegoly: !document.getElementById('brief-zaawansowane').parentElement.closest('.field') };
    const el = document.getElementById('stat-words'), przed = el.textContent;
    for (const n of [833, 851, 1]) { ustawLiczbeStatystyki('stat-words', n); await new Promise((r) => setTimeout(r, 30)); w[n] = document.getElementById('stat-skrot-tekst').textContent.split(' · ')[0]; }
    ustawLiczbeStatystyki('stat-words', przed);
    return w;
  });
  wynik('keys: SERP i AEO w tresci ustawien zaawansowanych, Zrodla poza polem wytycznych', uklad.serp && uklad.aeo && uklad.zrodla && uklad.szczegoly, JSON.stringify(uklad));
  wynik('keys: skrot statystyk z odmiana jak w arkuszu (833 słowa)', uklad[833] === '833 słowa' && uklad[851] === '851 słów' && uklad[1] === '1 słowo', JSON.stringify(uklad));

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
  await s.evaluate(() => { document.getElementById('topic').value = (wpisHistorii(biezacyHist) || history[0]).topic; zapiszSzkic(); });
  await s.goto(adres, { waitUntil: 'load' });
  await krok('artykul po odswiezeniu bez starego tematu', s.waitForFunction(() => getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: 8000 }));
  await s.waitForTimeout(300);
  const st2 = await s.evaluate(() => ({ t: document.getElementById('topic').value, kw: keywords.length, wynik: document.body.classList.contains('widok-wynik') }));
  wynik('keys: po wejsciu brief pusty (temat artykulu nie wraca), widok Brief', st2.t === '' && st2.kw === 0 && !st2.wynik, JSON.stringify(st2));
  // R4 kod-15: Dodatkowe wytyczne poprzedniego artykulu nie przechodza na nastepny tekst.
  await s.fill('#extra', 'Wspomnij o promocji -20% WYTYCZNA-STARA');
  await generuj(s, 'Artykul z wytyczna');
  await krok('szkic z wytyczna zapisany', s.waitForFunction(() => { try { return JSON.parse(magazyn.getItem('cai_szkic') || '{}').extra.indexOf('WYTYCZNA-STARA') !== -1; } catch (e) { return false; } }, null, { timeout: 8000 }));
  await s.goto(adres, { waitUntil: 'load' });
  await krok('artykul z wytyczna po odswiezeniu', s.waitForFunction(() => getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: 8000 }));
  await s.waitForTimeout(300);
  const st3 = await s.evaluate(() => ({ t: document.getElementById('topic').value, extra: document.getElementById('extra').value }));
  wynik('keys: R4 kod-15 po wejsciu wytyczne poprzedniego artykulu wyczyszczone', st3.t === '' && st3.extra === '', JSON.stringify(st3));
  // R4 kod-02: otwarcie starszego wpisu z Historii (jak dotkniecie na telefonie) nie kasuje
  // rozpoczetego briefu, takze po odswiezeniu.
  await s.fill('#topic', 'NOWY TEMAT W TOKU');
  await s.evaluate(() => { keywords.push('nowa fraza'); renderKws(); otworzWGeneratorze(history[history.length - 1].id); });
  await s.waitForTimeout(600);
  const st4 = await s.evaluate(() => document.getElementById('topic').value);
  await s.goto(adres, { waitUntil: 'load' });
  await krok('brief po historii i odswiezeniu', s.waitForFunction(() => getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: 8000 }));
  await s.waitForTimeout(300);
  const st5 = await s.evaluate(() => ({ t: document.getElementById('topic').value, kw: keywords.slice(), biez: biezacyHist, ost: history[history.length - 1].id }));
  wynik('keys: R4 kod-02 wpis z Historii nie nadpisuje briefu (takze po odswiezeniu)',
    st4 === 'NOWY TEMAT W TOKU' && st5.t === 'NOWY TEMAT W TOKU' && st5.kw.indexOf('nowa fraza') !== -1 && st5.biez === st5.ost, JSON.stringify({ st4, st5 }));
  // R5 (komputer): plakietka "z historii" nie wchodzi pod Edytuj, ptaszek w polu zaznaczenia
  // bez powtorzen, pola Drupala w jednym rzedzie na tej samej wysokosci.
  const r5 = await s.evaluate(() => {
    const b = document.getElementById('out-badge').getBoundingClientRect(), e = document.getElementById('edit-btn').getBoundingClientRect();
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'kb-check'; cb.checked = true; document.body.appendChild(cb);
    const cs = getComputedStyle(cb); const ptaszek = cs.backgroundRepeat + '|' + cs.backgroundPosition; cb.remove();
    openWpModal(); switchCmsTab('drupal');
    const t1 = document.getElementById('drupal-ctype').getBoundingClientRect().top, t2 = document.getElementById('drupal-format').getBoundingClientRect().top;
    closeWpModal && closeWpModal();
    // pasek moze przejsc do drugiego wiersza (waska kolumna) - wtedy Edytuj jest pod plakietka
    const odstep = e.top >= b.bottom ? 99 : Math.round(e.left - b.right);
    return { odstep, ptaszek, drupal: Math.round(t2 - t1) };
  });
  wynik('keys: plakietka stanu nie wchodzi pod Edytuj (odstep >= 8 px)', r5.odstep >= 8, JSON.stringify(r5));
  wynik('keys: ptaszek w polu zaznaczenia wysrodkowany, bez powtorzen', /^no-repeat\|50% 50%$/.test(r5.ptaszek), r5.ptaszek);
  wynik('keys: pola Drupala w jednym rzedzie na tej samej wysokosci', Math.abs(r5.drupal) <= 1, String(r5.drupal));
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

  // Koszt API w Historii: konto bez wlasnych kluczy go nie widzi (placi serwer);
  // po wpisaniu wlasnego klucza widzi koszt na swoich kluczach z podzialem na dostawcow.
  const kosztKafel = () => s.evaluate(() => { const k = document.getElementById('h-cost-kafel');
    return { widoczny: !!k && !k.hidden, wartosc: (document.getElementById('h-cost') || {}).textContent || '',
      etykieta: (document.getElementById('h-cost-lbl') || {}).textContent || '', pod: (document.getElementById('h-cost-pod') || {}).textContent || '' }; });
  const k0 = await kosztKafel();
  wynik('proxy: bez wlasnych kluczy koszt API ukryty', !k0.widoczny, JSON.stringify(k0));
  await s.evaluate(() => { magazyn.setItem('cai_klucz_anthropic', 'sk-ant-wlasny-test'); API_KEY = 'sk-ant-wlasny-test'; updateCostDisplay(); });
  await generuj(s, 'Artykul na wlasnym kluczu');
  const k1 = await kosztKafel();
  wynik('proxy: wlasny klucz - koszt na Twoich kluczach z podzialem na dostawcow',
    k1.widoczny && /Twoich|your/i.test(k1.etykieta) && /Anthropic \$0[,.]\d{3}/.test(k1.pod) && !/\$0[,.]000$/.test(k1.wartosc), JSON.stringify(k1));
  await s.evaluate(() => { magazyn.removeItem('cai_klucz_anthropic'); API_KEY = ''; updateCostDisplay(); });

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

  // R5: Grafika i Audio na komputerze (1440x900). Przycisk generowania lezy w oknie od otwarcia ekranu i po
  // wyniku (wczesniej pod krawedzia); generowanie na atrapie, blad dostawcy, historia grafik i audio,
  // Wczytaj artykul, grafika referencyjna z adresu, podcast na 2 glosy i odtwarzanie skryptu.
  const wOknie = (id) => s.evaluate((i) => {
    const b = document.getElementById(i); if (!b) return false;
    const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && !!t && (t === b || b.contains(t));
  }, id);
  await s.evaluate(() => openImgPanelSmart());
  await s.waitForTimeout(400);
  const gOkno = await wOknie('img-gen-btn');
  await s.evaluate(() => { document.getElementById('img-context').value = ''; });
  await krok('Wczytaj artykul (grafika)', s.click('#img-panel button[onclick="imgLoadFromArticle()"]', { timeout: 3000 }));
  const gKontekst = await s.evaluate(() => document.getElementById('img-context').value.length);
  await krok('grafika: Wygeneruj', s.click('#img-gen-btn', { timeout: 3000 }));
  await krok('grafika 1', s.waitForFunction(() => document.getElementById('img-result-wrap').style.display === 'block' && !document.getElementById('img-gen-btn').disabled, null, { timeout: 30000 }));
  await krok('format Kwadrat', s.click('#img-formats .img-fmt-btn:nth-child(2)', { timeout: 3000 }));
  await krok('grafika: Wygeneruj ponownie', s.click('#img-gen-btn', { timeout: 3000 }));
  await krok('grafika 2', s.waitForFunction(() => document.querySelectorAll('#img-history-grid .img-hist-podglad').length === 2 && !document.getElementById('img-gen-btn').disabled, null, { timeout: 30000 }));
  await krok('historia grafik: starsza', s.click('#img-history-grid .img-hist-kafel:nth-child(2) .img-hist-podglad', { timeout: 3000 }));
  const gWynik = await s.evaluate(() => ({ rozmiar: document.getElementById('img-result-size').textContent, info: document.getElementById('img-stopka-info').textContent,
    aktywna: document.querySelector('#img-history-grid .img-hist-kafel:nth-child(2)').classList.contains('aktywny'), pobierz: document.querySelectorAll('#img-history-grid a.img-hist-pobierz[download]').length }));
  const gOknoPo = await wOknie('img-gen-btn');
  wynik('proxy: R5 grafika - Wygeneruj w oknie od otwarcia i po wyniku, kontekst z artykulu, historia dwoch grafik',
    gOkno && gOknoPo && gKontekst > 20 && /^1536×1024/.test(gWynik.rozmiar) && /^1024×1024/.test(gWynik.info) && gWynik.aktywna && gWynik.pobierz === 2,
    JSON.stringify({ gOkno, gOknoPo, gKontekst, gWynik }));
  // grafika referencyjna z adresu: znacznik "dodana" w naglowku zwinietej sekcji, Usun czysci
  await s.evaluate(() => { document.getElementById('img-ref-zwijka').open = true; });
  await s.fill('#img-ref-url-input', 'https://example.com/wzor-postaci.png');
  await krok('grafika referencyjna z adresu', s.click('#img-ref-empty button[onclick="imgLoadReferenceUrl()"]', { timeout: 3000 }));
  await s.evaluate(() => { document.getElementById('img-ref-zwijka').open = false; });
  const gRef = await s.evaluate(() => ({ url: imgRefIsUrl, znacznik: getComputedStyle(document.querySelector('#img-ref-zwijka .modul-znacznik')).display !== 'none' }));
  await s.evaluate(() => imgClearReference());
  const gRefPo = await s.evaluate(() => !imgRefIsUrl && getComputedStyle(document.querySelector('#img-ref-zwijka .modul-znacznik')).display === 'none');
  wynik('proxy: R5 grafika referencyjna w zwijce - znacznik "dodana", Usun czysci', gRef.url && gRef.znacznik && gRefPo, JSON.stringify({ gRef, gRefPo }));
  // blad dostawcy przy promptcie grafiki: pusta ramka wraca, przycisk aktywny, komunikat
  await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); document.getElementById('img-context').value = 'Grafika z bledem [atrapa:400@prompt-grafiki]'; document.getElementById('img-result-wrap').style.display = 'none'; });
  await krok('grafika: blad', s.click('#img-gen-btn', { timeout: 3000 }));
  await krok('grafika: komunikat bledu', s.waitForFunction(() => document.querySelectorAll('.powiadomienie').length > 0 && !document.getElementById('img-gen-btn').disabled, null, { timeout: 30000 }));
  const gBlad = await s.evaluate(() => ({ pusty: getComputedStyle(document.getElementById('img-empty')).display, spinner: getComputedStyle(document.getElementById('img-spinner')).display }));
  wynik('proxy: R5 grafika - blad dostawcy wraca do pustej ramki z aktywnym przyciskiem', gBlad.pusty === 'block' && gBlad.spinner === 'none', JSON.stringify(gBlad));
  await s.evaluate(() => closeImgPanelSmart());
  // Audio: podcast na 2 glosy
  await s.evaluate(() => openAudioPanel());
  await s.waitForTimeout(400);
  const aOkno = await wOknie('au-gen-btn');
  await krok('Wczytaj artykul (audio)', s.click('#audio-panel button[onclick="audioLoadArticle()"]', { timeout: 3000 }));
  const aZrodlo = await s.evaluate(() => document.getElementById('au-source').value.length);
  await s.fill('#au-source', 'Podcast o pompach ciepla dla domu');
  const aGlosy = await s.evaluate(() => ({ typ: document.getElementById('au-type').value, n: document.querySelectorAll('#au-voices-picker select').length, skrot: document.getElementById('au-glosy-skrot').textContent }));
  await krok('audio: Wygeneruj skrypt', s.click('#au-gen-btn', { timeout: 3000 }));
  await krok('skrypt audio', s.waitForFunction(() => document.getElementById('au-result-wrap').style.display === 'block' && !document.getElementById('au-gen-btn').disabled, null, { timeout: 30000 }));
  const aWynik = await s.evaluate(() => { const sc = document.getElementById('au-script').innerText || '';
    return { dlugosc: sc.length, mowcy: /PROWADZĄCY|HOST/.test(sc) && /GOŚĆ|GUEST/.test(sc), hist: document.querySelectorAll('#au-history-wrap button.au-hist-item').length,
      typ: (document.querySelector('#au-history-wrap .au-hist-meta') || {}).textContent || '', pusty: getComputedStyle(document.getElementById('au-empty')).display }; });
  const aOknoPo = await wOknie('au-gen-btn');
  wynik('proxy: R5 audio - Wygeneruj skrypt w oknie, podcast na 2 glosy, skrypt i wpis historii',
    aOkno && aOknoPo && aZrodlo > 20 && aGlosy.typ === 'podcast' && aGlosy.n === 2 && aGlosy.skrot.length > 5 && aWynik.dlugosc > 50 && aWynik.mowcy && aWynik.hist === 1 && /^Podcast/.test(aWynik.typ) && aWynik.pusty === 'none',
    JSON.stringify({ aOkno, aOknoPo, aZrodlo, aGlosy, aWynik }));
  // odtwarzanie: pasek postepu w doku akcji pod skryptem
  await krok('audio: Odtworz', s.click('#au-play-btn', { timeout: 3000 }));
  await krok('audio: pasek odtwarzania', s.waitForFunction(() => { const b = document.getElementById('audio-bar'); return b && b.classList.contains('show') && b.parentElement && b.parentElement.id === 'au-odtwarzacz'; }, null, { timeout: 20000 }));
  await s.evaluate(() => { try { audioBarClose(); } catch (e) { /* brak */ } });
  // historia: wpis wraca po zmianie rodzaju
  await s.evaluate(() => { document.getElementById('au-type').value = 'newsletter'; audioSetType(); });
  await krok('historia audio: wpis', s.click('#au-history-wrap .au-hist-item', { timeout: 3000 }));
  const aHist = await s.evaluate(() => ({ typ: document.getElementById('au-type').value, wynik: document.getElementById('au-result-wrap').style.display }));
  wynik('proxy: R5 audio - odtwarzanie w doku pod skryptem, wpis historii wraca z rodzajem', aHist.typ === 'podcast' && aHist.wynik === 'block', JSON.stringify(aHist));
  await s.evaluate(() => closeAudioPanel());

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

// R6 (telefon 412x915, konto premium): przeplyw wlasciciela z rundy 6 - Wybierz przy bazie, artykul
// z siecia, SERP i samokorekta, Luki, "Popraw pod brakujace tematy", trzy wersje, SERP, cudzyslowy.
async function wariantTelefonR6(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'premium');
  const brief = () => s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });

  // "Wybierz" przy Bazie wiedzy: na telefonie zwijal niewidoczny panel komputera i nic sie nie dzialo.
  await brief();
  await krok('R6 Wybierz przy bazie', s.click('.zrodla-baza button', { timeout: 3000 }));
  await s.waitForTimeout(300);
  wynik('telefon: R6 Wybierz przy Bazie wiedzy otwiera arkusz bazy', await s.evaluate(() => document.getElementById('mobile-sidebar').classList.contains('open')));
  await s.evaluate(() => closeMobileSidebar());

  await brief();
  await s.fill('#topic', 'Jak wybrać pompę ciepła');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; document.getElementById('use-serp').checked = true; premiumMode = true; generate(true); });
  await krok('R6 artykul z siecia, SERP i samokorekta', s.waitForFunction(() => versions.length === 2 && !document.getElementById('gen-btn').disabled
    && getComputedStyle(document.getElementById('spinner')).display === 'none', null, { timeout: 60000 }));
  wynik('telefon: R6 podpis pod "Generuje tresc" wysrodkowany', await s.evaluate(() => getComputedStyle(document.getElementById('spin-sub')).textAlign === 'center'));

  // Luki: pokryte tematy jako wiersze z widocznym znacznikiem (emoji w kontenerze font-size 0 znikaly).
  await s.evaluate(() => inspektorPokaz('luki'));
  await krok('R6 analiza luk', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 30000 }));
  const l1 = await s.evaluate(() => { const w = [...document.querySelectorAll('#gap-present .gap-topic-row')];
    return { w: w.length, ikony: w.filter((r) => { const i = r.querySelector('.gap-topic-icon svg'); return i && i.getBoundingClientRect().width >= 12; }).length }; });
  wynik('telefon: R6 Luki - pokryte tematy z widocznym znacznikiem', l1.w > 0 && l1.ikony === l1.w, JSON.stringify(l1));

  // Popraw pod brakujace tematy: atrapa nie ma zrodla dla ostatniego tematu (data-brak) i dopisuje
  // punkt wnioskow za kazda sekcje. Lista zrodel zostaje, pusta sekcja nie trafia do artykulu,
  // wynik liczy tylko napisane sekcje, wnioski nie puchna, panel mowi, ktorego tematu brakuje.
  const przed = await s.evaluate(() => document.querySelectorAll('#article .zrodla-box li').length);
  await s.evaluate(() => { document.querySelectorAll('.gap-miss-check').forEach((c) => { c.checked = true; }); updateGapBtn(); improveFromGaps(); });
  await krok('R6 poprawa pod luki', s.waitForFunction(() => versions.length === 3 && document.getElementById('gap-delta').style.display === 'block', null, { timeout: 60000 }));
  await s.waitForTimeout(300);
  const po = await s.evaluate(() => {
    const art = document.getElementById('article');
    const h = [...art.querySelectorAll('h2')].find((x) => /Kluczowe wnioski|Key takeaways/.test(x.textContent));
    const x = [...document.querySelectorAll('#gap-all-topics .gap-topic-row')].filter((r) => r.querySelector('use[href="#i-circle-x"]'));
    const wpis = wpisHistorii(biezacyHist), tmp = document.createElement('div');
    tmp.innerHTML = (wpis && wpis.html) || '';
    return { zrodla: art.querySelectorAll('.zrodla-box li').length, brak: art.querySelectorAll('[data-brak]').length,
      h2: art.querySelectorAll('h2').length, h2Historii: tmp.querySelectorAll('h2').length,
      wnioski: h && h.nextElementSibling ? h.nextElementSibling.querySelectorAll('li').length : 0,
      wynik: document.getElementById('gap-delta-after').textContent, bezZnacznika: x.length,
      info: (document.getElementById('gap-info') || { hidden: true }).hidden ? '' : document.getElementById('gap-info').textContent };
  });
  wynik('telefon: R6 Popraw pod luki - zrodla zostaja, bez pustych sekcji, wnioski do 8 punktow',
    przed > 0 && po.zrodla >= przed && po.brak === 0 && po.wnioski > 0 && po.wnioski <= 8, JSON.stringify(Object.assign({ przed }, po)));
  wynik('telefon: R6 Popraw pod luki - nowe sekcje od razu we wpisie historii', po.h2 > 0 && po.h2Historii === po.h2, JSON.stringify({ h2: po.h2, h2Historii: po.h2Historii }));
  wynik('telefon: R6 Popraw pod luki - temat bez zrodla nie podbija wyniku i jest opisany w panelu',
    !/^100/.test(po.wynik) && po.bezZnacznika >= 1 && /: 1\b/.test(po.info), JSON.stringify(po));

  // Trzy wersje: segment Przed | Po | Poprawa SERP wchodzil na "N slow · M min".
  await s.evaluate(() => { inspektorZamknij(); window.scrollTo(0, 0); });
  await s.waitForTimeout(300);
  const w = await s.evaluate(() => {
    const r = (e) => { const x = e ? e.getBoundingClientRect() : { left: 0, right: 0, width: 0, height: 0 }; return { l: Math.round(x.left), r: Math.round(x.right), w: Math.round(x.width), h: Math.round(x.height) }; };
    return { skrot: r(document.getElementById('stat-skrot')), wybor: r(document.querySelector('.ver-wybor')), select: r(document.getElementById('ver-select')),
      przyciski: [...document.querySelectorAll('#versions-bar .ver-btn')].filter((x) => x.getBoundingClientRect().width > 0).length };
  });
  wynik('telefon: R6 trzy wersje - lista wyboru obok statystyk, bez nachodzenia, cel 44 px',
    w.wybor.w > 0 && w.przyciski === 0 && w.skrot.w > 0 && w.skrot.r <= w.wybor.l && w.wybor.r <= 412 && w.select.h >= 44, JSON.stringify(w));
  await krok('R6 wybor wersji z listy', s.selectOption('#ver-select', '0', { timeout: 3000 }));
  wynik('telefon: R6 wybor wersji z listy przelacza artykul', await s.evaluate(() => activeVersion === 0 && document.getElementById('ver-wybor-tekst').textContent === versions[0].label));
  await s.selectOption('#ver-select', '2').catch(() => {});

  // Ocena po przelaczeniu wersji: otwarty panel AEO liczy sie dla wybranej wersji
  // (wczesniej zostawal wynik poprzedniej, az do ponownego otwarcia panelu).
  const aeo = await s.evaluate(() => {
    const tekst = () => (document.getElementById('aeo-content').innerText || '').replace(/\s+/g, ' ').trim();
    inspektorPokaz('aeo');
    const v2 = tekst();
    switchVersion(0);
    const poPrzelaczeniu = tekst();
    inspektorZamknij(); inspektorPokaz('aeo');
    const ponownie = tekst();
    switchVersion(2); inspektorZamknij();
    return { rozne: v2 !== ponownie, aktualny: poPrzelaczeniu === ponownie, v2: v2.slice(0, 60), poPrzelaczeniu: poPrzelaczeniu.slice(0, 60), ponownie: ponownie.slice(0, 60) };
  });
  wynik('telefon: R6 ocena AEO po przelaczeniu wersji dotyczy wybranej wersji', aeo.rozne && aeo.aktualny, JSON.stringify(aeo));

  // SERP: srednie czolowki obok liczb artykulu; nowa zakladka otwiera sie od gory.
  await s.evaluate(() => inspektorPokaz('luki'));
  await s.waitForTimeout(200);
  await s.evaluate(() => { const t = document.querySelector('#inspektor .ins-tresc'); if (t) t.scrollTop = 400; inspektorPokaz('serp'); });
  await s.waitForTimeout(300);
  const sp = await s.evaluate(() => ({ wiersze: document.querySelectorAll('#serp-stats .serp-por-wiersz').length, przew: (document.querySelector('#inspektor .ins-tresc') || {}).scrollTop }));
  wynik('telefon: R6 SERP - porownanie z artykulem, zakladka od gory', sp.wiersze === 2 && sp.przew === 0, JSON.stringify(sp));
  await s.evaluate(() => inspektorZamknij());

  // Cudzyslowy w polskim tekscie: proste i angielskie na „...” (jezyk z tresci, nie z interfejsu);
  // tekst angielski bez zmian.
  const cudz = await s.evaluate(() => {
    const pl = document.createElement('div');
    pl.innerHTML = '<h2>Jak wybrać pompę ciepła do starszego domu</h2><p>Hasło "poprawi się później" i <strong>"wariant</strong> premium" oraz „dobry” i “angielski” obok ekranu 27".</p>';
    const en = document.createElement('div');
    en.innerHTML = '<p>The "quick" fix and the "slow" one are both fine for this simple English text sample.</p>';
    uporzadkujArtykul(pl); uporzadkujArtykul(en);
    return { pl: pl.querySelector('p').textContent, en: en.textContent };
  });
  wynik('telefon: R6 cudzyslowy w polskim artykule', cudz.pl === 'Hasło „poprawi się później” i „wariant premium” oraz „dobry” i „angielski” obok ekranu 27".'
    && /"quick"/.test(cudz.en), JSON.stringify(cudz));

  // Poprawa SERP trafia do historii: po odswiezeniu wraca artykul z nowymi sekcjami (wczesniej wracal sprzed poprawy).
  const naEkranie = await s.evaluate(() => document.querySelectorAll('#article h2').length);
  await s.reload({ waitUntil: 'load' });
  await krok('R6 artykul po odswiezeniu', s.waitForFunction(() => getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: 10000 }));
  await s.waitForTimeout(300);
  const poOdsw = await s.evaluate(() => ({ h2: document.querySelectorAll('#article h2').length, zrodla: document.querySelectorAll('#article .zrodla-box li').length }));
  wynik('telefon: R6 poprawa pod luki zapisana w historii (po odswiezeniu)', poOdsw.h2 === naEkranie && poOdsw.zrodla > 0, JSON.stringify({ naEkranie, poOdsw }));
  wynik('telefon: R6 bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'telefon-r6');
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
    await wariantTelefonR6(b);
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
