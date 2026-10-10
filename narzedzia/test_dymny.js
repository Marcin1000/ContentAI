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
let atrapa, PORT_ATRAPY, PORT_SERWERA, KAT_DZIENNIKA;
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
  // R9-F (KOD8-35): dziennik atrapy w katalogu przebiegu, sprzatany po zielonym przebiegu
  // (wczesniej po kazdym przebiegu zostawal /tmp/atrapa-wywolania-<port>.log).
  if (!process.env.ATRAPA_DZIENNIK) {
    KAT_DZIENNIKA = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-test-atrapa-'));
    process.env.ATRAPA_DZIENNIK = path.join(KAT_DZIENNIKA, 'atrapa-wywolania.log');
  }
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
  catch (e) { wynik('krok: ' + nazwa, false, (e && e.message || String(e)).split('\n')[0]); await zamknijOkna(); return false; }
}

// R9-F (KOD8-03): po czerwonym kroku okno, ktore zostalo otwarte, przechwytywalo kazde nastepne
// klikniecie (8 kolejnych limitow czasu), a wyjatek konczyl caly przebieg i 7 z 9 scenariuszy sie
// nie wykonywalo. Teraz: po nieudanym kroku zamykamy otwarte okna, a kazdy scenariusz biegnie
// osobno - wyjatek konczy sie bledem z nazwa scenariusza i zamknieciem jego kontekstow.
let PRZEGLADARKA = null;
async function zamknijOkna() {
  if (!PRZEGLADARKA) return;
  for (const k of PRZEGLADARKA.contexts()) {
    for (const s of k.pages()) {
      await s.evaluate(() => {
        for (let i = 0; i < 10 && typeof window.zamknijGorneOkno === 'function' && window.zamknijGorneOkno();) i++;
        document.querySelectorAll('.overlay.open').forEach((o) => o.classList.remove('open'));
      }).catch(() => {});
    }
  }
}
async function osobno(scenariusz, b) {
  PRZEGLADARKA = b;
  const przed = new Set(b.contexts());
  try { await scenariusz(b); }
  catch (e) {
    wynik('scenariusz ' + scenariusz.name + ' przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
    for (const k of b.contexts()) if (!przed.has(k)) await k.close().catch(() => {});
  }
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
  // R9-F (KOD8-27): kreator pierwszego uruchomienia wyskakuje dopiero po odpowiedzi /api/pakiet. Stale 800 ms
  // przegrywalo z wolnym serwerem i kreator zaslanial pierwsze klikniecie - czekamy na jego stan.
  await s.waitForFunction(() => { const m = document.getElementById('start-modal');
    return !m || getComputedStyle(m).display !== 'none' || (typeof magazyn !== 'undefined' && !!magazyn.getItem('cai_start_ukonczony')); }, null, { timeout: 8000 }).catch(() => {});
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
  // R9-F (KOD8-03): okno gotowe, gdy fokus jest w polu nazwy (ustawia go menedzer okien).
  await krok('okno tekstu z fokusem na nazwie', s.waitForFunction(() => (document.activeElement || {}).id === 'm-name', null, { timeout: 3000 }));
  await s.fill('#m-name', 'Cennik montazu');
  await s.fill('#m-content', 'Montaz kosztuje od 18 do 35 tys. zl. Gwarancja 7 lat.');
  const polaTekstu = await s.evaluate(() => ({ nazwa: document.getElementById('m-name').value, tresc: document.getElementById('m-content').value.length }));
  wynik('proxy: okno tekstu - nazwa i tresc w swoich polach', polaTekstu.nazwa === 'Cennik montazu' && polaTekstu.tresc > 20, JSON.stringify(polaTekstu));
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
  // Polski interfejs, jak u wlasciciela (temat bez zrodla w atrapie wymaga trzech brakujacych tematow).
  await s.evaluate(() => { try { magazyn.setItem('cai_lang', 'pl'); localStorage.setItem('cai_lang', 'pl'); } catch (e) { /* bez magazynu */ } });
  await s.reload({ waitUntil: 'load' });
  await s.waitForTimeout(600);
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

  // Dopracuj: druga wersja o tej samej nazwie dostaje numer; ocena ponad progiem konczy sie
  // komunikatem (wczesniej cisza, jakby nic sie nie stalo).
  const gotowe = () => s.waitForFunction(() => !document.getElementById('gen-btn').disabled && getComputedStyle(document.getElementById('spinner')).display === 'none', null, { timeout: 30000 });
  // Atrapa zwraca tekst bez zmian, jesli ma juz jej zdanie "po poprawie" - zdejmujemy je przed kazdym Dopracuj.
  const bezZdaniaAtrapy = () => document.querySelectorAll('#article p').forEach((p) => { if (/Ten przewodnik porządkuje|This guide organises/.test(p.textContent)) p.remove(); });
  await s.evaluate((f) => { (new Function(f))(); kontekstArt.temat = 'Jak wybrać pompę ciepła [atrapa:ocena=55@ocena-premium]'; runPostGenerationPremium(); }, '(' + bezZdaniaAtrapy + ')()');
  await krok('R6 Dopracuj 1', s.waitForFunction(() => versions.length === 2, null, { timeout: 30000 }).then(gotowe));
  await s.evaluate((f) => { (new Function(f))(); runPostGenerationPremium(); }, '(' + bezZdaniaAtrapy + ')()');
  await krok('R6 Dopracuj 2', s.waitForFunction(() => versions.length === 3, null, { timeout: 30000 }).then(gotowe));
  const etyk = await s.evaluate(() => versions.map((v) => v.label));
  wynik('telefon: R6 Dopracuj - powtorzona nazwa wersji z numerem', etyk.length === 3 && new Set(etyk).size === 3, JSON.stringify(etyk));
  await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); kontekstArt.temat = 'Jak wybrać pompę ciepła [atrapa:ocena=90@ocena-premium]'; runPostGenerationPremium(); });
  await s.waitForTimeout(300);
  await krok('R6 Dopracuj bez uwag', gotowe());
  const bezUwag = await s.evaluate(() => ({ wersje: versions.length, toast: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | ') }));
  wynik('telefon: R6 Dopracuj bez uwag - komunikat z ocena zamiast ciszy', bezUwag.wersje === 3 && /90\/100/.test(bezUwag.toast), JSON.stringify(bezUwag));
  wynik('telefon: R6 bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'telefon-r6');
  await k.close();
}

// R6 (audyt E, telefon 412x915): Luki - caly tekst i same tematy czolowki (E-05, E-06), analiza w toku
// nie idzie drugi raz (E-10), sekcje w miejscu z konspektu (E-16), stan Luk per wersja (E-09), panel
// nie otwiera sie sam (E-11), poprawa nie trafia do innego artykulu i blokuje Wygeneruj (E-01),
// bledy widoczne (E-08).
async function wariantTelefonR6Luki(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'premium');
  const luki = [];
  s.on('request', (r) => {
    if (r.method() !== 'POST' || !/\/api$/.test(r.url())) return;
    const d = r.postData() || '';
    if (/semantic SEO expert/.test(d)) { try { luki.push(JSON.parse(d).messages[0].content); } catch (e) { luki.push(''); } }
  });
  const gotowe = (ms) => s.waitForFunction(() => !document.getElementById('gen-btn').disabled && getComputedStyle(document.getElementById('spinner')).display === 'none', null, { timeout: ms || 60000 });
  const generujTu = async (temat) => {
    await s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });
    await s.fill('#topic', temat);
    await s.evaluate(() => { document.getElementById('use-web').checked = true; document.getElementById('use-serp').checked = true; premiumMode = false; generate(true); });
    await gotowe();
  };
  await generujTu('Jak wybrać pompę ciepła');
  await s.evaluate(() => inspektorPokaz('luki'));
  await krok('R6L analiza luk', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 30000 }));
  const a1 = await s.evaluate(() => ({ tematy: serpData.topics.slice(), frazy: serpData.phrases.slice(),
    wiersze: document.querySelectorAll('#gap-missing .gap-miss-item').length + document.querySelectorAll('#gap-present .gap-topic-row').length,
    koniec: (document.querySelector('#article h2:last-of-type') || {}).textContent || '' }));
  const zap = luki[0] || '';
  const listaZap = ((zap.match(/SERP topics \(full list\): ([^\n]*)/) || [])[1] || '');
  wynik('telefon: R6L Luki - same tematy czolowki (bez fraz), kazdy temat raz',
    a1.wiersze === a1.tematy.length && a1.frazy.every((f) => listaZap.split(', ').indexOf(f) === -1 || a1.tematy.indexOf(f) !== -1), JSON.stringify({ wiersze: a1.wiersze, tematy: a1.tematy.length, listaZap: listaZap.slice(0, 120) }));
  wynik('telefon: R6L Luki - do modelu idzie caly tekst (takze ostatnia sekcja)', a1.koniec && zap.indexOf(a1.koniec.trim()) !== -1 && zap.length > 3600, JSON.stringify({ dl: zap.length, koniec: a1.koniec }));

  // E-10: powrot na zakladke w trakcie analizy nie wysyla drugiego zapytania
  await s.evaluate(() => { kontekstArt.temat = 'Jak wybrać pompę ciepła [atrapa:opoznienie=2500@luki]'; kontekstArt.frazy = []; });
  const przed10 = luki.length;
  await s.evaluate(() => refreshGapAnalysis());
  await s.waitForTimeout(300);
  await s.evaluate(() => { inspektorPokaz('serp'); inspektorPokaz('luki'); });
  await krok('R6L analiza po powrocie', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 20000 }));
  await s.waitForTimeout(400);
  wynik('telefon: R6L Luki - powrot na zakladke w trakcie analizy bez drugiego zapytania', luki.length - przed10 === 1, String(luki.length - przed10));
  await s.evaluate(() => { kontekstArt.temat = 'Jak wybrać pompę ciepła'; });

  // E-16: nowe sekcje w miejscu z konspektu (atrapa wskazuje [AFTER: pierwsza sekcja])
  const h2Przed = await s.evaluate(() => [...document.querySelectorAll('#article h2')].map((h) => h.textContent.trim()));
  await s.evaluate(() => { kontekstArt.temat = 'Jak wybrać pompę ciepła [atrapa:opoznienie=2000@luki-sekcje]'; document.querySelectorAll('.gap-miss-check').forEach((c) => { c.checked = true; }); updateGapBtn(); improveFromGaps(); });
  // E-01: w trakcie poprawy Wygeneruj czeka (komunikat), zamiast zaczynac nowy artykul
  await s.waitForTimeout(300);
  const blokada = await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); const w = generate(true); return Promise.resolve(w).then((x) => ({ wynik: x, toast: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | ') })); });
  await krok('R6L poprawa pod luki', s.waitForFunction(() => versions.length >= 2 && document.getElementById('gap-delta').style.display === 'block', null, { timeout: 60000 }));
  wynik('telefon: R6L w trakcie poprawy Wygeneruj czeka z komunikatem', blokada.wynik === false && /trwa|running/i.test(blokada.toast), JSON.stringify(blokada));
  await s.evaluate(() => { kontekstArt.temat = 'Jak wybrać pompę ciepła'; });
  const h2Po = await s.evaluate(() => [...document.querySelectorAll('#article h2')].map((h) => h.textContent.trim()));
  const nowe = h2Po.filter((t) => h2Przed.indexOf(t) === -1);
  wynik('telefon: R6L nowe sekcje za wskazana sekcja, nie na koncu', nowe.length > 0 && h2Po[0] === h2Przed[0] && h2Po[1] === nowe[0] && h2Po.indexOf(h2Przed[1]) > h2Po.indexOf(nowe[nowe.length - 1]), JSON.stringify({ h2Przed: h2Przed.slice(0, 3), h2Po: h2Po.slice(0, 5) }));

  // E-09: "Wariant 1" (przed poprawa) ma wlasna analize; powrot na "Poprawa SERP" bez nowego zapytania
  const przed9 = luki.length;
  await s.evaluate(() => switchVersion(0));
  await krok('R6L Luki dla wersji przed poprawa', s.waitForFunction(() => getComputedStyle(document.getElementById('gap-score-row')).display !== 'none' || document.getElementById('gap-missing-wrap').style.display === 'block', null, { timeout: 20000 }));
  await s.waitForTimeout(300);
  const v0 = await s.evaluate(() => ({ delta: document.getElementById('gap-delta').style.display, nowo: document.getElementById('gap-delta-newly-wrap').style.display }));
  await s.evaluate(() => switchVersion(versions.length - 1));
  await s.waitForTimeout(500);
  const v2 = await s.evaluate(() => ({ delta: document.getElementById('gap-delta').style.display }));
  wynik('telefon: R6L Luki per wersja - przed poprawa bez "Nowo pokryte", po powrocie znow delta bez nowego zapytania',
    v0.delta !== 'block' && v0.nowo !== 'block' && v2.delta === 'block' && luki.length - przed9 <= 1, JSON.stringify({ v0, v2, zapytan: luki.length - przed9 }));

  // E-11: poprawa przy zamknietym arkuszu - komunikat, arkusz sie nie otwiera
  await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); inspektorZamknij(); const c = [...document.querySelectorAll('.gap-miss-check')]; c.forEach((x) => { x.checked = true; }); updateGapBtn(); improveFromGaps(); });
  await krok('R6L druga poprawa', s.waitForFunction(() => versions.length >= 3 && !przerwanieGenerowania, null, { timeout: 60000 }));
  await s.waitForTimeout(300);
  const e11 = await s.evaluate(() => ({ ins: document.getElementById('inspektor').hidden, toast: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | '), wersje: versions.map((v) => v.label) }));
  wynik('telefon: R6L poprawa przy zamknietym arkuszu - komunikat, arkusz zamkniety, numer wersji', e11.ins && /Dopisano|Sections added/.test(e11.toast) && new Set(e11.wersje).size === e11.wersje.length, JSON.stringify(e11));

  // E-01: otwarcie innego artykulu w trakcie poprawy - wynik nie trafia do niego
  await generujTu('Ogród zimowy na balkonie');
  await s.evaluate(() => inspektorPokaz('luki'));
  await krok('R6L luki drugiego artykulu', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 30000 }));
  const inny = await s.evaluate(() => history.find((h) => /pomp/i.test(h.topic)).id);
  const htmlInnego = await s.evaluate((id) => wpisHistorii(id).html, inny);
  await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); kontekstArt.temat = 'Ogród zimowy na balkonie [atrapa:opoznienie=2500@luki-sekcje]'; document.querySelectorAll('.gap-miss-check').forEach((c) => { c.checked = true; }); updateGapBtn(); improveFromGaps(); });
  await s.waitForTimeout(300);
  await s.evaluate((id) => otworzWGeneratorze(id), inny);
  await krok('R6L koniec spoznionej poprawy', s.waitForFunction(() => !przerwanieGenerowania, null, { timeout: 30000 }));
  await s.waitForTimeout(300);
  const e01 = await s.evaluate((id) => ({ h1: (document.querySelector('#article h1') || {}).textContent || '', wersje: versions.length,
    toast: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | '), html: wpisHistorii(id).html }), inny);
  wynik('telefon: R6L spozniona poprawa nie trafia do innego artykulu ani jego wpisu Historii',
    /pomp/i.test(e01.h1) && e01.wersje === 0 && /poprzedniego artykułu|previous article/.test(e01.toast) && e01.html === htmlInnego, JSON.stringify({ h1: e01.h1, wersje: e01.wersje, toast: e01.toast }));

  // E-08: pusta odpowiedz i blad dostawcy przy poprawie - komunikat w panelu
  await s.evaluate(() => inspektorPokaz('luki'));
  await krok('R6L luki po otwarciu z Historii', s.waitForFunction(() => document.getElementById('gap-no-serp').style.display === 'block' || document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 30000 }));
  await generujTu('Rower elektryczny do miasta');
  await s.evaluate(() => inspektorPokaz('luki'));
  await krok('R6L luki trzeciego artykulu', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 30000 }));
  const blad = async (znacznik) => {
    await s.evaluate((z) => { kontekstArt.temat = 'Rower elektryczny do miasta ' + z; document.getElementById('gap-info').hidden = true; document.querySelectorAll('.gap-miss-check').forEach((c) => { c.checked = true; }); updateGapBtn(); improveFromGaps(); }, znacznik);
    await s.waitForFunction(() => !przerwanieGenerowania, null, { timeout: 30000 });
    await s.waitForTimeout(200);
    return s.evaluate(() => { const i = document.getElementById('gap-info'); return { widoczny: !i.hidden, klasa: i.className, tekst: i.textContent, wersje: versions.length }; });
  };
  const pusty = await blad('[atrapa:pusty@luki-sekcje]');
  const p529 = await blad('[atrapa:529@luki-sekcje]');
  wynik('telefon: R6L Popraw pod luki - pusta odpowiedz i blad dostawcy widoczne w panelu',
    pusty.widoczny && /blad/.test(pusty.klasa) && p529.widoczny && /blad/.test(p529.klasa) && pusty.wersje <= 1 && p529.wersje <= 1, JSON.stringify({ pusty, p529 }));

  // E-08: blad analizy SERP przy generowaniu - komunikat i osobny tekst w Lukach
  await s.evaluate(() => document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()));
  await generujTu('Kawa ziarnista do ekspresu [atrapa:529@serp]');
  const serpBladT = await s.evaluate(() => [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | '));
  await s.evaluate(() => { inspektorZamknij(); toggleGapPanel(); });
  await s.waitForTimeout(300);
  const brakSerp = await s.evaluate(() => document.getElementById('gap-no-serp').textContent);
  wynik('telefon: R6L blad SERP przy generowaniu - komunikat i tekst w Lukach', /SERP/.test(serpBladT) && /nie powiodła|failed/.test(brakSerp), JSON.stringify({ serpBladT, brakSerp }));
  wynik('telefon: R6L bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'telefon-r6-luki');
  await k.close();
}

// R6 (wlasciciel): kolejny, inny artykul bez odswiezania strony. "Nowy artykul" czysci temat, frazy,
// wytyczne i wynik (artykul zostaje w Historii), preferencje zostaja, Cofnij przywraca; osobno
// "Przywroc ustawienia domyslne". Telefon 412x915.
async function wariantNowyArtykul(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'standard');
  const stan = () => s.evaluate(() => ({ przycisk: !!document.getElementById('nowy-artykul-btn') && !document.getElementById('nowy-artykul-btn').hidden,
    temat: document.getElementById('topic').value, frazy: keywords.length, extra: document.getElementById('extra').value,
    artykul: getComputedStyle(document.getElementById('article')).display, wersje: versions.length, biezacy: magazyn.getItem('cai_biezacy'),
    hist: history.length, ton: document.getElementById('tone').value, toast: [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | ') }));
  await s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });
  const s0 = await stan();
  await s.fill('#topic', 'Jak wybrać pompę ciepła');
  await s.evaluate(() => { keywords.push('pompa ciepła'); renderKws(); document.getElementById('extra').value = 'Wspomnij o dotacji';
    const t = document.getElementById('tone'); t.value = t.options[1].value; document.getElementById('use-web').checked = true; generate(true); });
  await krok('R6N artykul', czekajNaKoniec(s));
  await s.evaluate(() => ustawWidokMobilny('brief'));
  await s.waitForTimeout(300);
  const s1 = await stan();
  const wymiar = await s.evaluate(() => { const r = document.getElementById('nowy-artykul-btn').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  wynik('telefon: R6N "Nowy artykul" tylko gdy jest co czyscic (przy etykiecie Tematu)', !s0.przycisk && s1.przycisk && s1.artykul === 'block' && wymiar.h <= 30, JSON.stringify({ s0: s0.przycisk, s1: s1.przycisk, wymiar }));
  await krok('R6N Nowy artykul', s.click('#nowy-artykul-btn', { timeout: 3000 }));
  await s.waitForTimeout(300);
  const s2 = await stan();
  wynik('telefon: R6N Nowy artykul - pusty brief i wynik, artykul w Historii, ton zostaje, komunikat z Cofnij',
    s2.temat === '' && s2.frazy === 0 && s2.extra === '' && s2.artykul === 'none' && s2.wersje === 0 && !s2.biezacy && s2.hist === s1.hist && s2.ton === s1.ton && /Cofnij|Undo/.test(s2.toast),
    JSON.stringify(s2));
  await krok('R6N Cofnij', s.click('.powiadomienie .powiadomienie-akcja', { timeout: 3000 }));
  await s.waitForTimeout(400);
  const s3 = await stan();
  wynik('telefon: R6N Cofnij przywraca brief i artykul', s3.temat === s1.temat && s3.frazy === s1.frazy && s3.extra === s1.extra && s3.artykul === 'block', JSON.stringify(s3));
  await s.evaluate(() => ustawWidokMobilny('brief'));
  await s.waitForTimeout(300);
  await s.click('#nowy-artykul-btn').catch(() => {});
  await s.reload({ waitUntil: 'load' });
  await s.waitForTimeout(1000);
  const s4 = await stan();
  wynik('telefon: R6N po Nowym artykule i odswiezeniu brief i wynik zostaja puste', s4.temat === '' && s4.frazy === 0 && s4.artykul === 'none', JSON.stringify(s4));
  // Przywroc ustawienia domyslne + Cofnij
  await s.evaluate(() => { ustawWidokMobilny('brief'); const d = document.getElementById('brief-zaawansowane'); if (d) d.open = true;
    const sp = document.getElementById('use-serp'); sp.checked = true; sp.dispatchEvent(new Event('change', { bubbles: true })); document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); });
  const przed = await s.evaluate(() => ({ ton: document.getElementById('tone').value, serp: document.getElementById('use-serp').checked }));
  await krok('R6N Przywroc ustawienia', s.click('.przywroc-domyslne', { timeout: 3000 }));
  await s.waitForTimeout(300);
  const po = await s.evaluate(() => { const t = document.getElementById('tone'); return { ton: t.value, dom: ([...t.options].find((o) => o.defaultSelected) || t.options[0]).value, serp: document.getElementById('use-serp').checked }; });
  await krok('R6N Cofnij ustawienia', s.click('.powiadomienie .powiadomienie-akcja', { timeout: 3000 }));
  await s.waitForTimeout(300);
  const cof = await s.evaluate(() => ({ ton: document.getElementById('tone').value, serp: document.getElementById('use-serp').checked }));
  wynik('telefon: R6N Przywroc ustawienia domyslne i Cofnij', po.ton === po.dom && !po.serp && cof.ton === przed.ton && cof.serp === przed.serp, JSON.stringify({ przed, po, cof }));
  wynik('telefon: R6N bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'telefon-r6-nowy');
  await k.close();
}

// R6-F (wykonawca F, runda 6, audyt E poza Lukami). Telefon 412x915, konto standard: pusta Baza
// (Fakty wzgledem stron z sieci), potem strona z adresem w Bazie na serwerze (Linki). Na koncu
// Wstecz, bo ostatni krok naprawde opuszcza strone. Kazdy scenariusz pada na 52ad6c5.
// Runda 7 (koordynator): Luki - temat konkurencji odznaczony, wybor zablokowany w trakcie poprawy,
// wynik po poprawie od razu (bez drugiej analizy calego tekstu); tytul zrodla bez "Strona 1 z 7".
async function wariantR7Luki(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'pl-PL' });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); if (!localStorage.getItem('cai_lang')) localStorage.setItem('cai_lang', 'pl'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'premium');
  const luki = [];
  s.on('request', (r) => { if (r.method() === 'POST' && /\/api$/.test(r.url()) && /semantic SEO expert/.test(r.postData() || '')) luki.push(Date.now()); });
  await s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });
  await s.fill('#topic', 'Punkt odbioru paczek w sklepie');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; document.getElementById('use-serp').checked = true; premiumMode = false; generate(true); });
  await s.waitForFunction(() => !document.getElementById('gen-btn').disabled && getComputedStyle(document.getElementById('spinner')).display === 'none', null, { timeout: 60000 });
  const konk = 'Oferta Konkurent Alfa';
  await s.evaluate((t) => { serpData.topics.push(t); gapCache = null; inspektorPokaz('luki'); }, konk);
  await krok('R7L analiza luk', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 1, null, { timeout: 30000 }));
  const lista = await s.evaluate(() => [...document.querySelectorAll('#gap-missing .gap-miss-item')].map((el) => ({
    tekst: el.querySelector('.gap-miss-text').textContent, zazn: el.querySelector('.gap-miss-check').checked, konk: !!el.querySelector('.gap-konk') })));
  const wiersz = lista.find((x) => x.tekst.indexOf(konk) === 0) || {};
  wynik('telefon: R7L temat o konkurencji oznaczony i domyslnie odznaczony, reszta zaznaczona',
    wiersz.konk === true && wiersz.zazn === false && lista.filter((x) => x !== wiersz).every((x) => x.zazn && !x.konk), JSON.stringify(lista));

  const przed = luki.length;
  await s.evaluate(() => { kontekstArt.temat = 'Punkt odbioru paczek w sklepie [atrapa:opoznienie=2000@luki-sekcje]'; improveFromGaps(); });
  await s.waitForTimeout(400);
  const wTrakcie = await s.evaluate(() => [...document.querySelectorAll('#gap-missing .gap-miss-check')].map((c) => c.disabled));
  wynik('telefon: R7L zaznaczenia tematow zablokowane w trakcie poprawy', wTrakcie.length > 0 && wTrakcie.every(Boolean), JSON.stringify(wTrakcie));
  await krok('R7L poprawa pod luki', s.waitForFunction(() => versions.length >= 2 && !przerwanieGenerowania, null, { timeout: 60000 }));
  const poKoncu = Date.now();
  await s.waitForTimeout(800);
  const po = await s.evaluate(() => ({ delta: document.getElementById('gap-delta').style.display,
    ladowanie: getComputedStyle(document.getElementById('gap-loading')).display, przed: document.getElementById('gap-delta-before').textContent,
    poPkt: document.getElementById('gap-delta-after').textContent, wolne: [...document.querySelectorAll('#gap-missing .gap-miss-check')].every((c) => !c.disabled) }));
  wynik('telefon: R7L wynik po poprawie od razu, bez ponownej analizy calego tekstu',
    po.delta === 'block' && po.ladowanie === 'none' && luki.length === przed && parseInt(po.poPkt, 10) > parseInt(po.przed, 10) && po.wolne,
    JSON.stringify({ po, zapytan: luki.length - przed, poKoncu: luki.filter((t) => t >= poKoncu).length }));

  const zrodla = await s.evaluate(() => blokZrodel([{ url: 'https://example.com/regulamin.pdf', tytul: 'Strona 1 z 7 Regulamin usługi odbioru', data: '' },
    { url: 'https://example.com/terms.pdf', tytul: 'Page 2 of 9 - Service terms', data: '' }]));
  wynik('telefon: R7L tytul zrodla z PDF bez numeru strony', /Regulamin usługi odbioru/.test(zrodla) && /Service terms/.test(zrodla) && !/Strona 1 z 7|Page 2 of 9/.test(zrodla), zrodla.replace(/<[^>]+>/g, ' ').slice(0, 200));
  wynik('telefon: R7L bez bledow strony', bledy.length === 0, bledy.join(' | '));
  await k.close();
}

// Pilne (UX8-01): kreator startowy na koncie Darmowy (klucze serwera, krok kluczy bez pol) przechodzi dalej.
// Wczesniej "Dalej" na kroku kluczy rzucal TypeError i kreator utykal na wszystkich kontach Darmowy.
async function wariantPilneKreator(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, locale: 'pl-PL' });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); localStorage.setItem('cai_lang', 'pl'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'darmowy');
  await krok('PILNE kreator widoczny', s.waitForFunction(() => {
    const m = document.getElementById('start-modal');
    if (m && getComputedStyle(m).display !== 'none') return true;
    if (typeof window.otworzStart === 'function') window.otworzStart();
    return false;
  }, null, { timeout: 15000 }));
  const przebieg = await s.evaluate(() => {
    const kroki = [];
    const tytul = () => (document.querySelector('#start-tresc h2, #start-tresc h3, #start-tresc [style*="font-weight:700"]') || {}).textContent || '';
    for (let i = 0; i < 2; i++) {
      try { window.startDalej(); kroki.push(tytul()); } catch (e) { kroki.push('BLAD: ' + e.message); }
    }
    return { kroki, polaKlucza: !!document.getElementById('start-k-anthropic') };
  });
  wynik('komputer: PILNE kreator na koncie Darmowy przechodzi przez krok kluczy',
    przebieg.kroki.every((t) => t.indexOf('BLAD') !== 0) && !bledy.length && !przebieg.polaKlucza,
    JSON.stringify({ przebieg, bledy }));
  await k.close();
}

async function wariantR6F(b) {
  // Interfejs i artykul po polsku (komunikaty, odmiana i polski sklad w eksporcie sa sprawdzane po polsku).
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true, locale: 'pl-PL' });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); if (!localStorage.getItem('cai_lang')) localStorage.setItem('cai_lang', 'pl'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'standard');
  const zapytania = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url())) zapytania.push(z.postData() || ''); });
  const ile = (re) => zapytania.filter((t) => re.test(t)).length;
  const ostatnie = (re) => zapytania.filter((t) => re.test(t)).pop() || '';
  const tresc = (cialo) => { try { const c = JSON.parse(cialo); return String(c.system || '') + '\n' + (c.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'); } catch (e) { return ''; } };
  const gotowe = (ms) => s.waitForFunction(() => /ready|uwaga/.test(document.getElementById('out-badge').className) && !document.getElementById('gen-btn').disabled
    && getComputedStyle(document.getElementById('spinner')).display === 'none' && getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: ms || 60000 });
  const pobierzPlik = async (wywolanie) => {
    const [d] = await Promise.all([s.waitForEvent('download', { timeout: 30000 }), s.evaluate(wywolanie)]);
    const sciezka = await d.path();
    return fs.readFileSync(sciezka);
  };
  const NOTATKA = await s.evaluate(() => (typeof tekstWJezyku === 'function' ? tekstWJezyku('gap-brak-pokrycia', 'pl') : I18N.pl['gap-brak-pokrycia']));

  // Artykul z siecia i SERP. E-19: regula "fraza nie jako podmiot zdania" w prompcie generowania.
  await s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });
  await s.fill('#topic', 'Jak wybrać pompę ciepła do domu');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; document.getElementById('use-serp').checked = true; generate(); });
  await krok('R6-F artykul z siecia i SERP', gotowe(60000));
  wynik('telefon: R6-F E-19 regula frazy (nie jako podmiot zdania) w prompcie generowania',
    /KEYWORD AS SUBJECT/.test(tresc(ostatnie(/You are an SEO and content writer|You are an expert content strategist/))), '');

  // E-14: statystyki = eksport. Dwie sekcje z notatka o luce (bez tresci) nie wchodza do liczby slow
  // ani sekcji; skrot "N slow · M min" i wpis Historii licza to samo co pasek.
  await s.evaluate((notatka) => {
    const art = document.getElementById('article');
    const html = '<h2>Sekcja R6F jeden</h2><p data-brak="1">' + notatka + '</p><h2>Sekcja R6F dwa</h2><p data-brak="1">' + notatka + '</p>';
    const przed = art.querySelector('.zrodla-box') || art.querySelector('.meta-box');
    if (przed) przed.insertAdjacentHTML('beforebegin', html); else art.insertAdjacentHTML('beforeend', html);
  }, NOTATKA);
  const statystyki = () => s.evaluate(() => {
    const art = document.getElementById('article');
    const kopia = art.cloneNode(true);
    kopia.querySelectorAll('.zrodla-box, .meta-box, [data-tylko-ekran], p[data-brak]').forEach((e) => e.remove());
    // naglowek, pod ktorym po notatce nic nie zostalo, tez nie jest trescia
    [...kopia.querySelectorAll('h2')].forEach((h) => { const n = h.nextElementSibling; if (!n || /^H[12]$/.test(n.tagName)) h.remove(); });
    const bloki = [...kopia.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,th,td,blockquote')].filter((e) => !e.querySelector('h1,h2,h3,h4,h5,h6,p,li,th,td,blockquote'));
    const slowa = bloki.reduce((n, e) => n + (e.textContent || '').split(/\s+/).filter(Boolean).length, 0);
    const wpis = wpisHistorii(biezacyHist);
    return { oczekiwane: slowa, h2: kopia.querySelectorAll('h2').length, pasek: Number(document.getElementById('stat-words').textContent),
      sekcje: Number(document.getElementById('stat-h2').textContent), skrot: (document.getElementById('stat-skrot-tekst') || {}).textContent || '',
      historia: wpis ? wpis.words : -1 };
  });
  await s.evaluate(() => { toggleEdit(); toggleEdit(); });
  const st1 = await statystyki();
  wynik('telefon: R6-F E-14 statystyki jak eksport (bez notatek o lukach, zrodel i meta), skrot i Historia te same',
    st1.pasek === st1.oczekiwane && st1.sekcje === st1.h2 && st1.skrot.indexOf(String(st1.pasek) + ' ') === 0 && st1.historia === st1.pasek, JSON.stringify(st1));

  // E-02: tekst wpisany w miejsce notatki i nowy akapit z Entera pod notatka sa trescia (bez data-brak).
  await s.evaluate(() => { if (!editMode) toggleEdit(); });
  await s.evaluate(() => {
    const p = [...document.querySelectorAll('#article h2')].find((h) => h.textContent === 'Sekcja R6F jeden').nextElementSibling;
    const art = document.getElementById('article'); art.focus();
    const r = document.createRange(); r.selectNodeContents(p);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await s.keyboard.type('Tekst autora wpisany w sekcji jeden.');
  await s.evaluate(() => {
    const p = [...document.querySelectorAll('#article h2')].find((h) => h.textContent === 'Sekcja R6F dwa').nextElementSibling;
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await s.keyboard.press('Enter');
  await s.keyboard.type('Akapit autora pod notatka w sekcji dwa.');
  const ed = await s.evaluate(() => {
    const art = document.getElementById('article');
    const p1 = [...art.querySelectorAll('p')].find((p) => /Tekst autora wpisany w sekcji jeden/.test(p.textContent));
    const p2 = [...art.querySelectorAll('p')].find((p) => /Akapit autora pod notatka/.test(p.textContent));
    return { p1: !!p1, p1brak: !!(p1 && p1.hasAttribute('data-brak')), p2: !!p2, p2brak: !!(p2 && p2.hasAttribute('data-brak')), notatki: art.querySelectorAll('p[data-brak]').length };
  });
  await s.evaluate(() => { if (editMode) toggleEdit(); document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); });
  wynik('telefon: R6-F E-02 tekst wpisany w notatke i akapit z Entera traca data-brak (notatka obok zostaje)',
    ed.p1 && !ed.p1brak && ed.p2 && !ed.p2brak && ed.notatki === 1, JSON.stringify(ed));
  const st2 = await statystyki();
  wynik('telefon: R6-F E-14 po edycji statystyki licza tekst autora, nie notatke', st2.pasek === st2.oczekiwane && st2.pasek > st1.pasek && st2.sekcje === st1.sekcje + 2, JSON.stringify({ st1, st2 }));

  // Eksport: TXT z tekstem autora i naglowkami, bez notatki; komunikat jako ostrzezenie, z instrukcja.
  // E-18: polski sklad - twarda spacja po jednoliterowych wyrazach w TXT, DOCX i PDF (ekran bez zmian),
  // krotkie akapity PDF w calosci na jednej stronie.
  const txt = (await pobierzPlik(() => dlTxt())).toString('utf8');
  const toast = await s.evaluate(() => [...document.querySelectorAll('.powiadomienie')].map((p) => p.className + '|' + p.textContent).join(' || '));
  // Twarde spacje z E-18 (po "w") porownujemy jak zwykle.
  const txtZw = txt.replace(/\u00a0/g, ' ');
  wynik('telefon: R6-F E-02 tekst autora i naglowki sekcji w pliku, sama notatka pominieta',
    /Tekst autora wpisany w sekcji jeden/.test(txtZw) && /Akapit autora pod notatka w sekcji dwa/.test(txtZw) && /Sekcja R6F jeden/.test(txtZw) && /Sekcja R6F dwa/.test(txtZw)
    && txtZw.indexOf(NOTATKA.slice(0, 30)) < 0, txtZw.slice(0, 200));
  wynik('telefon: R6-F E-02/E-17 komunikat eksportu jako ostrzezenie z instrukcja (usun notatke albo wpisz tresc)',
    /powiadomienie-uwaga\|[^|]*pominięte w eksporcie: 1[^|]*Usuń notatkę albo wpisz w jej miejsce treść/.test(toast), toast);
  const JEDNA = /(^|[\s(„"])[aiouwzAIOUWZ] /m, TWARDA = /(^|[\s(„" ])[aiouwzAIOUWZ] /;
  await s.evaluate(async () => {
    await wczytajSkrypt('pwa/lib/docx-natywny-2.js');
    const org = window.DocxNatywny.zbuduj;
    window.DocxNatywny.zbuduj = function (el) { window.__docxTekst = el.textContent; return org.apply(this, arguments); };
    await new Promise((ok) => zaladujPdfMake(ok));
    const orgPdf = pdfMake.createPdf;
    pdfMake.createPdf = function (dd) { window.__dd = JSON.parse(JSON.stringify(dd)); return orgPdf.apply(this, arguments); };
  });
  await pobierzPlik(() => dlDocx());
  await pobierzPlik(() => dlPdf());
  const typo = await s.evaluate(() => {
    const dd = window.__dd || {};
    const akapity = (dd.content || []).filter((e) => e && (e.style === 'p' || (Array.isArray(e.style) && e.style.indexOf('p') >= 0)));
    const tekstPdf = akapity.map((e) => (Array.isArray(e.text) ? e.text.map((c) => c.text || '').join('') : String(e.text || ''))).join('\n');
    return { docx: window.__docxTekst || '', pdf: tekstPdf, krotkieRazem: akapity.filter((e) => e.unbreakable).length, akapitow: akapity.length,
      ekran: document.getElementById('article').textContent };
  });
  wynik('telefon: R6-F E-18 twarde spacje po jednoliterowych wyrazach w TXT, DOCX i PDF, ekran bez zmian',
    TWARDA.test(txt) && !JEDNA.test(txt) && TWARDA.test(typo.docx) && !JEDNA.test(typo.docx) && TWARDA.test(typo.pdf) && !JEDNA.test(typo.pdf)
    && !/[aiouwzAIOUWZ] /.test(typo.ekran), JSON.stringify({ txt: (txt.match(JEDNA) || [''])[0], docx: (typo.docx.match(JEDNA) || [''])[0], pdf: (typo.pdf.match(JEDNA) || [''])[0] }));
  wynik('telefon: R6-F E-18 krotkie akapity PDF w calosci na jednej stronie (unbreakable)', typo.krotkieRazem > 0 && typo.krotkieRazem <= typo.akapitow, JSON.stringify({ krotkieRazem: typo.krotkieRazem, akapitow: typo.akapitow }));

  // E-17: AEO z odmiana liczebnika (3 nagłówki-pytania, 32 słowa); GEO bez obietnicy JSON-LD i FAQPage.
  const aeoGeo = await s.evaluate(() => {
    const art = document.getElementById('article');
    [...art.querySelectorAll('h2')].forEach((h, i) => { const t = h.textContent.replace(/\?\s*$/, ''); h.textContent = i < 3 ? t + '?' : t; });
    const p = [...art.querySelectorAll('p')].find((x) => !x.closest('.meta-box'));
    if (p) p.textContent = Array.from({ length: 32 }, (_, i) => (i ? 'słowo' : 'Pierwsze')).join(' ') + '.';
    inspektorPokaz('aeo');
    const aeo = document.getElementById('aeo-content').innerText.replace(/\s+/g, ' ');
    inspektorPokaz('geo');
    const geo = document.getElementById('geo-content').innerText.replace(/\s+/g, ' ');
    inspektorZamknij();
    return { aeo, geo };
  });
  wynik('telefon: R6-F E-17 AEO z odmiana liczebnika (3 nagłówki-pytania, 32 słowa)',
    /FAQ: 3 nagłówki-pytania/.test(aeoGeo.aeo) && /pierwszy akapit 32 słowa\b/.test(aeoGeo.aeo), aeoGeo.aeo.slice(0, 200));
  wynik('telefon: R6-F E-17 GEO opisuje to, co liczy (bez JSON-LD i FAQPage)', !/JSON-LD|FAQPage/.test(aeoGeo.geo) && /pyta/.test(aeoGeo.geo), aeoGeo.geo.slice(0, 200));

  // E-17: "Popraw artykul pod brakujace tematy" przyklejony do dolu arkusza (360x700: bez tego pod zgieciem),
  // a po przewinieciu do konca nie zaslania ostatniego elementu.
  await s.setViewportSize({ width: 360, height: 700 });
  await s.evaluate(() => inspektorPokaz('luki'));
  await krok('R6-F analiza luk', s.waitForFunction(() => document.querySelectorAll('#gap-missing .gap-miss-check').length > 0, null, { timeout: 30000 }));
  await s.waitForTimeout(400);
  const lepki = await s.evaluate(async () => {
    const b = document.getElementById('gap-improve-btn'), t = document.querySelector('#inspektor .ins-tresc');
    t.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rb = b.getBoundingClientRect(), rt = t.getBoundingClientRect();
    const w = { pozycja: getComputedStyle(b).position, widoczny: rb.top >= rt.top && rb.bottom <= rt.bottom + 1, dol: Math.round(rt.bottom - rb.bottom), przewiniecie: t.scrollHeight - t.clientHeight };
    t.scrollTop = t.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ost = [...t.querySelectorAll('.gap-topic-row, .gap-miss-item, #gap-no-serp, #gap-present > *')].filter((e) => e.getClientRects().length).pop();
    if (ost) { const ro = ost.getBoundingClientRect(); const x = document.elementFromPoint(ro.left + 20, ro.top + ro.height / 2); w.ostatniWidoczny = !!x && (ost === x || ost.contains(x)); }
    t.scrollTop = 0;
    return w;
  });
  await s.evaluate(() => inspektorZamknij());
  await s.setViewportSize({ width: 412, height: 915 });
  wynik('telefon: R6-F E-17 Popraw pod brakujace tematy przyklejony do dolu arkusza, ostatni element odsloniety',
    lepki.pozycja === 'sticky' && lepki.widoczny && lepki.przewiniecie > 0 && lepki.ostatniWidoczny === true, JSON.stringify(lepki));

  // E-07 + E-10: Fakty przy pustej Bazie porownuja artykul ze stronami z sieci (cytowane fragmenty),
  // z dopiskiem w panelu; wyjscie z zakladki i powrot w trakcie nie wysyla drugiej kontroli.
  await s.evaluate(() => {
    const art = document.getElementById('article');
    const meta = art.querySelector('.zrodla-box') || art.querySelector('.meta-box');
    const p = document.createElement('p'); p.id = 'r6f-opoznienie'; p.textContent = 'Notatka redakcji do kontroli [atrapa:opoznienie=2500@fakty].';
    if (meta) meta.before(p); else art.appendChild(p);
    inspektorPokaz('fakty');
  });
  await s.waitForTimeout(500);
  await s.evaluate(() => inspektorPokaz('aeo'));
  await s.waitForTimeout(300);
  await s.evaluate(() => inspektorPokaz('fakty'));
  await krok('R6-F kontrola faktow', s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none' && document.getElementById('fakty-wynik').textContent.trim().length > 0, null, { timeout: 30000 }));
  await s.waitForTimeout(300);
  const fakty = await s.evaluate(() => ({ dopisek: !!document.querySelector('#fakty-wynik .fakty-wzgledem-sieci'), pusty: !!document.querySelector('#fakty-wynik .fakty-pusty'),
    tekst: document.getElementById('fakty-wynik').textContent.slice(0, 160) }));
  const zapFakty = tresc(ostatnie(/You are a fact checker/));
  wynik('telefon: R6-F E-07 Fakty przy pustej Bazie porownuja ze stronami z sieci (cytowane fragmenty), z dopiskiem',
    ile(/You are a fact checker/) >= 1 && /WEB SOURCES[\s\S]*\n {2}> "/.test(zapFakty) && fakty.dopisek && !fakty.pusty, JSON.stringify(Object.assign({ zapytan: ile(/You are a fact checker/) }, fakty)));
  wynik('telefon: R6-F E-10 powrot na Fakty w trakcie kontroli czeka na nia (jedno zapytanie)', ile(/You are a fact checker/) === 1, 'zapytan: ' + ile(/You are a fact checker/));
  await s.evaluate(() => { inspektorZamknij(); const p = document.getElementById('r6f-opoznienie'); if (p) p.remove(); });

  // E-10: SEO -> AIO -> SEO w trakcie oceny SEO = jedna platna ocena, wynik rysuje sie po powrocie.
  const seoPrzed = ile(/content SEO expert evaluating[\s\S]*\\"items\\"/);
  await s.evaluate(() => { kontekstArt.temat = String(kontekstArt.temat || '') + ' [atrapa:opoznienie=2500@ocena-seo]'; inspektorPokaz('seo'); });
  await s.waitForTimeout(400);
  await s.evaluate(() => inspektorPokaz('aio'));
  await s.waitForTimeout(300);
  await s.evaluate(() => inspektorPokaz('seo'));
  await krok('R6-F ocena SEO', s.waitForFunction(() => !!document.querySelector('#seo-content .seo-score-ring'), null, { timeout: 30000 }));
  const seoZapytan = ile(/content SEO expert evaluating[\s\S]*\\"items\\"/) - seoPrzed;
  await s.evaluate(() => { inspektorZamknij(); kontekstArt.temat = String(kontekstArt.temat || '').replace(/ \[atrapa:[^\]]*\]/g, ''); });
  wynik('telefon: R6-F E-10 SEO -> AIO -> SEO w trakcie oceny: jedna ocena SEO, wynik po powrocie', seoZapytan === 1, 'ocen SEO: ' + seoZapytan);

  // E-19: ta sama regula w ocenie i w poprawie samokorekty (Dopracuj).
  await s.evaluate(() => { kontekstArt.temat = String(kontekstArt.temat || '') + ' [atrapa:ocena=55@ocena-premium]'; runPostGenerationPremium(); });
  await krok('R6-F Dopracuj', s.waitForFunction(() => versions.length >= 2, null, { timeout: 30000 }).then(() => gotowe(30000)));
  await s.evaluate(() => { kontekstArt.temat = String(kontekstArt.temat || '').replace(/ \[atrapa:[^\]]*\]/g, ''); });
  const ocenaS = tresc(ostatnie(/strict hybrid SEO\+AIO content evaluator|"AIO evaluator\.|"SEO content evaluator\./));
  const poprawaS = tresc(ostatnie(/You are an? (hybrid SEO\+AIO|SEO|AIO) editor\. Fix only the listed issues/));
  wynik('telefon: R6-F E-19 regula frazy w ocenie i poprawie samokorekty', /KEYWORD AS SUBJECT/.test(ocenaS) && /KEYWORD AS SUBJECT/.test(poprawaS),
    JSON.stringify({ ocena: ocenaS.length, poprawa: poprawaS.length }));

  // E-12: artykul bez danych SERP (z Historii) - zakladka SERP naprawde znika (hidden przegrywal z display).
  await s.evaluate(() => { otworzWGeneratorze(history[0].id); });
  await s.waitForTimeout(400);
  await s.evaluate(() => inspektorPokaz('luki'));
  await s.waitForTimeout(300);
  const zakl = await s.evaluate(() => { const z = document.querySelector('.ins-zakl[data-ins="serp"]');
    return { hidden: z.hidden, display: getComputedStyle(z).display, serpData: !!serpData }; });
  await s.evaluate(() => inspektorZamknij());
  wynik('telefon: R6-F E-12 zakladka SERP bez danych niewidoczna', zakl.hidden && zakl.display === 'none' && !zakl.serpData, JSON.stringify(zakl));

  // E-13: strona dodana do Bazy (na serwerze) jest w sugestiach linkow - lista /api/baza zwraca jej adres.
  await s.evaluate(() => addDoc('Pompy ciepla - oferta montazu', 'Pompy ciepla do domu: dobor mocy, montaz i serwis. Oferta dla domow jednorodzinnych.', '🔗', 'https://example.com/pompy-ciepla'));
  await krok('R6-F dokument z adresem w Bazie na serwerze', s.waitForFunction(() => (window._bazaSerwer || []).some((d) => d.url === 'https://example.com/pompy-ciepla'), null, { timeout: 10000 }));
  await s.evaluate(() => inspektorPokaz('linki'));
  await s.waitForTimeout(300);
  const linki = await s.evaluate(() => ({ lista: document.getElementById('links-list').textContent.replace(/\s+/g, ' ').slice(0, 200), lokalne: docs.length }));
  await s.evaluate(() => inspektorZamknij());
  wynik('telefon: R6-F E-13 Linki biora adresy z Bazy na serwerze', /https:\/\/example\.com\/pompy-ciepla/.test(linki.lista) && linki.lokalne === 0, JSON.stringify(linki));

  // E-04: Wstecz przy otwartym arkuszu zamyka arkusz bez przeladowania; zamkniecie krzyzykiem zdejmuje
  // wpis historii, wiec nastepne Wstecz dziala zwyczajnie (opuszcza strone).
  wynik('telefon: R6-F bez bledow JavaScript (przed Wstecz)', !bledy.length, bledy.join(' | '));
  const stanWstecz = () => s.evaluate(() => ({ znacznik: window.__bezPrzeladowania === 1, inspektor: document.body.classList.contains('inspektor-otwarty'),
    konto: document.getElementById('settings-menu').classList.contains('open'), baza: document.getElementById('mobile-sidebar').classList.contains('open'),
    nasz: !!(window.history.state && window.history.state.cai), artykul: getComputedStyle(document.getElementById('article')).display }));
  await s.evaluate(() => { window.__bezPrzeladowania = 1; inspektorPokaz('aeo'); });
  await s.waitForTimeout(300);
  const w0 = await stanWstecz();
  await krok('R6-F Wstecz przy inspektorze', s.goBack({ timeout: 5000 }));
  await s.waitForTimeout(400);
  const w1 = await stanWstecz().catch((e) => ({ blad: String(e) }));
  wynik('telefon: R6-F E-04 Wstecz zamyka inspektor, strona sie nie przeladowuje', w0.inspektor && w0.nasz && w1.znacznik === true && !w1.inspektor && w1.artykul === 'block', JSON.stringify({ w0, w1 }));
  await s.evaluate(() => { if (typeof otworzKontoMobilne === 'function') otworzKontoMobilne(); }).catch(() => {});
  await s.waitForTimeout(300);
  await krok('R6-F Wstecz przy menu Konto', s.goBack({ timeout: 5000 }));
  await s.waitForTimeout(400);
  const w2 = await stanWstecz().catch((e) => ({ blad: String(e) }));
  wynik('telefon: R6-F E-04 Wstecz zamyka menu Konto bez przeladowania', w2.znacznik === true && w2.konto === false, JSON.stringify(w2));
  // Arkusz statystyk i menu grupy (Eksport) tak samo; liczba wpisow historii nie rosnie (bez petli).
  const arkusze = [];
  for (const otworz of [() => przelaczStatystyki(true), () => przelaczGrupe('pobierz')]) {
    await s.evaluate(otworz).catch(() => {});
    await s.waitForTimeout(300);
    const przed = await s.evaluate(() => ({ otwarty: document.body.classList.contains('statystyki-otwarte') || !!document.querySelector('.grupa-menu.open'), dl: window.history.length })).catch((e) => ({ blad: String(e) }));
    await krok('R6-F Wstecz przy arkuszu', s.goBack({ timeout: 5000 }));
    await s.waitForTimeout(400);
    const po = await s.evaluate(() => ({ znacznik: window.__bezPrzeladowania === 1, otwarty: document.body.classList.contains('statystyki-otwarte') || !!document.querySelector('.grupa-menu.open'), dl: window.history.length })).catch((e) => ({ blad: String(e) }));
    arkusze.push({ przed, po });
  }
  wynik('telefon: R6-F E-04 Wstecz zamyka arkusz statystyk i menu grupy, bez nowych wpisow historii',
    arkusze.every((a) => a.przed.otwarty && a.po.znacznik === true && a.po.otwarty === false && a.po.dl === a.przed.dl), JSON.stringify(arkusze));
  await s.evaluate(() => { window.__bezPrzeladowania = 1; openMobileSidebar(); }).catch(() => {});
  await s.waitForTimeout(300);
  await krok('R6-F krzyzyk Bazy', s.click('#mobile-sidebar .przycisk-ikona', { timeout: 3000 }));
  await s.waitForTimeout(500);
  const w3 = await stanWstecz().catch((e) => ({ blad: String(e) }));
  await krok('R6-F Wstecz po zamknieciu krzyzykiem', s.goBack({ timeout: 15000, waitUntil: 'load' }));
  await s.waitForTimeout(800);
  const w4 = await s.evaluate(() => ({ znacznik: window.__bezPrzeladowania === 1 })).catch((e) => ({ blad: String(e) }));
  wynik('telefon: R6-F E-04 krzyzyk zdejmuje wpis arkusza, nastepne Wstecz dziala zwyczajnie (opuszcza strone)',
    w3.znacznik === true && w3.baza === false && w3.nasz === false && w4.znacznik === false, JSON.stringify({ w3, w4 }));
  if (bledow) await zrzut(s, 'telefon-r6f');
  await k.close();
}

// R7-I (wykonawca I, runda 7): panel Faktow. Telefon 412x915, konto premium, dokument w Bazie na
// serwerze. Jeden stan ladowania do konca (odnosniki gotowe wczesniej nie rysuja sie jako wynik),
// adres w uwadze jako link, notka zgodna z liczba stron z sieci, kategoria "Sprawdz na stronie"
// z linkiem do strony z listy zrodel (na koncu listy), lista zrodel i ramka meta poza kontrola.
// Kazdy scenariusz pada na a8a2e18.
async function wariantR7I(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'pl-PL' });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); if (!localStorage.getItem('cai_lang')) localStorage.setItem('cai_lang', 'pl'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'premium');
  const zapytania = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url())) zapytania.push(z.postData() || ''); });
  const ostatnieFakty = () => { const t = zapytania.filter((x) => /You are a fact checker/.test(x)).pop() || ''; try { return JSON.parse(t); } catch (e) { return {}; } };
  const gotowe = (ms) => s.waitForFunction(() => /ready|uwaga/.test(document.getElementById('out-badge').className) && !document.getElementById('gen-btn').disabled
    && getComputedStyle(document.getElementById('spinner')).display === 'none' && getComputedStyle(document.getElementById('article')).display === 'block', null, { timeout: ms || 60000 });
  const koniecFaktow = (nazwa) => krok(nazwa, s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none'
    && document.getElementById('fakty-wynik').textContent.trim().length > 0, null, { timeout: 30000 }));

  // Dokument w Bazie (na serwerze): kontrola ma z czym zestawic tekst poza stronami z sieci.
  await s.evaluate(() => addDoc('Automaty paczkowe - oferta R7I', 'Automaty paczkowe w sklepie internetowym: paczka do 25 kg, wymiary skrytki 64 x 38 x 41 cm, odbior w ciagu 2 dni. Automaty paczkowe dla sklepu internetowego dzialaja cala dobe.', '📄', ''));
  await krok('R7-I dokument w Bazie na serwerze', s.waitForFunction(() => (window._bazaSerwer || []).some((d) => /oferta R7I/.test(d.nazwa || d.name || '')), null, { timeout: 10000 }));

  // 3: przelacznik sieci wlaczony, model nie szukal - pasek "Siec: bez wyszukiwania", notka bez "z wlaczonym wyszukiwaniem".
  await s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });
  await s.fill('#topic', 'Automaty paczkowe w sklepie internetowym [atrapa:bez-sieci@artykul]');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; generate(); });
  await krok('R7-I artykul bez wyszukiwania', gotowe(60000));
  await s.evaluate(() => inspektorPokaz('fakty'));
  await koniecFaktow('R7-I kontrola faktow bez wyszukiwania');
  const bezSieci = await s.evaluate(() => ({ pasek: (document.getElementById('stat-siec') || {}).textContent || '', wiedza: !!String(ostatniaWiedzaSerwera || '').trim(),
    notka: (document.querySelector('#fakty-wynik .fakty-siec-bez-stron') || {}).textContent || '', wynik: document.getElementById('fakty-wynik').textContent }));
  await s.evaluate(() => inspektorZamknij());

  // Artykul z siecia (strony z cytowanymi fragmentami) i Baza.
  await s.evaluate(() => { if (typeof ustawWidokMobilny === 'function') ustawWidokMobilny('brief'); });
  await s.fill('#topic', 'Automaty paczkowe w sklepie internetowym');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; generate(); });
  await krok('R7-I artykul z siecia', gotowe(60000));

  // 1 + 2: odnosnik w tekscie (sprawdzony od razu) i kontrola tresci opozniona o 3 s. Do konca
  // tylko napis ladowania - bez licznika i listy; potem adres jako link (host i sciezka, nowa karta).
  const ADRES = 'http://127.0.0.1:' + PORT_PLIKOW + '/brak-strony-r7i.html';
  await s.evaluate((adres) => {
    const art = document.getElementById('article');
    const przed = art.querySelector('.zrodla-box') || art.querySelector('.meta-box');
    const p = document.createElement('p'); p.id = 'r7i-link';
    p.innerHTML = 'Aktualne lokalizacje są na <a href="' + adres + '">tutaj</a> [atrapa:opoznienie=3000@fakty].';
    if (przed) przed.before(p); else art.appendChild(p);
    window.__r7iProbki = [];
    window.__r7iZegar = setInterval(() => {
      const l = document.getElementById('fakty-loading');
      window.__r7iProbki.push({ ladowanie: getComputedStyle(l).display !== 'none', napis: l.textContent, wynik: document.getElementById('fakty-wynik').textContent.trim().slice(0, 60) });
    }, 50);
    inspektorPokaz('fakty');
  }, ADRES);
  await koniecFaktow('R7-I kontrola faktow z siecia');
  await s.waitForTimeout(200);
  const przebieg = await s.evaluate(() => {
    clearInterval(window.__r7iZegar);
    const pr = window.__r7iProbki || [];
    const wTrakcie = pr.filter((x) => x.ladowanie);
    return { probek: wTrakcie.length, zWynikiem: wTrakcie.filter((x) => x.wynik).map((x) => x.napis + ' | ' + x.wynik).slice(0, 3),
      napisy: [...new Set(wTrakcie.map((x) => x.napis))], koniec: document.getElementById('fakty-wynik').textContent.slice(0, 60) };
  });
  wynik('telefon: R7-I Fakty: jeden stan ladowania do konca, bez czesciowego licznika i listy (odnosniki gotowe wczesniej)',
    przebieg.probek >= 20 && przebieg.zWynikiem.length === 0 && /Do sprawdzenia: \d+/.test(przebieg.koniec), JSON.stringify(przebieg));

  const uwagi = await s.evaluate((adres) => {
    const el = [...document.querySelectorAll('#fakty-wynik .fakty-uwaga')];
    const linkAdresu = el.filter((u) => /^link-/.test(u.dataset.rodzaj)).map((u) => u.querySelector('.fakty-adres a')).filter(Boolean)
      .map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, tekst: a.textContent, kursywa: getComputedStyle(a).fontStyle }));
    const strona = el.find((u) => u.dataset.rodzaj === 'strona');
    const aStrony = strona && strona.querySelector('.fakty-adres a');
    return {
      rodzaje: el.map((u) => u.dataset.rodzaj),
      cytatyZAdresem: el.filter((u) => u.textContent.indexOf('"' + adres) >= 0).length,
      linkAdresu: linkAdresu.find((a) => a.href === adres) || null,
      strona: strona ? { etykieta: strona.firstElementChild.textContent.trim(), href: aStrony ? aStrony.getAttribute('href') : '', target: aStrony ? aStrony.target : '', tekst: aStrony ? aStrony.textContent : '' } : null,
      adresyStron: zrodlaSieciowe.map((z) => z.url),
      pasek: (document.getElementById('stat-siec') || {}).textContent || '',
      wynikTekst: document.getElementById('fakty-wynik').textContent,
      zrodlaArt: [...document.querySelectorAll('#article .zrodla-box li')].map((li) => li.textContent.trim()),
      meta: ((document.querySelector('#article .meta-box p') || {}).textContent || '').trim(),
    };
  }, ADRES);
  const host = ADRES.replace(/^http:\/\//, '');
  wynik('telefon: R7-I adres w uwadze jako link (host i sciezka, nowa karta, bez cudzyslowu i kursywy)',
    !!uwagi.linkAdresu && uwagi.linkAdresu.target === '_blank' && /noopener/.test(uwagi.linkAdresu.rel) && uwagi.linkAdresu.tekst === host
    && uwagi.linkAdresu.kursywa !== 'italic' && uwagi.cytatyZAdresem === 0, JSON.stringify({ linkAdresu: uwagi.linkAdresu, cytatyZAdresem: uwagi.cytatyZAdresem }));
  // 3: notka zgodna z paskiem sieci - "bez wyszukiwania": porownanie tylko z dokumentami (bez "z wlaczonym
  // wyszukiwaniem"); "N zrodel": notka o tekscie z wyszukiwaniem.
  const zSiecia = { stron: uwagi.adresyStron.length, pasek: uwagi.pasek, zWyszukiwaniem: /z włączonym wyszukiwaniem/.test(uwagi.wynikTekst), nieSzukal: /nie szukał w sieci/.test(uwagi.wynikTekst) };
  wynik('telefon: R7-I notka Faktow zgodna z paskiem sieci ("bez wyszukiwania" = tylko Twoje dokumenty, "N zrodel" = z wyszukiwaniem)',
    /bez wyszukiwania/.test(bezSieci.pasek) && bezSieci.wiedza && /nie szukał w sieci/.test(bezSieci.notka) && !/z włączonym wyszukiwaniem/.test(bezSieci.wynik)
    && zSiecia.stron > 0 && new RegExp('^' + zSiecia.stron + ' ').test(zSiecia.pasek) && zSiecia.zWyszukiwaniem && !zSiecia.nieSzukal,
    JSON.stringify({ bezSieci: Object.assign({}, bezSieci, { wynik: bezSieci.wynik.slice(-120) }), zSiecia }));

  // 4: "Sprawdz na stronie" - fragment strony urwany. Link do strony z listy zrodel, prompt mowi
  // o urwanych fragmentach, uwaga po twardych (liczba) i przed niesprawdzonym adresem.
  const zap = ostatnieFakty();
  const sys = String(zap.system || '');
  const usr = ((zap.messages || [])[0] || {}).content || '';
  const iStrona = uwagi.rodzaje.indexOf('strona'), iLiczba = uwagi.rodzaje.indexOf('liczba'), iNiespr = uwagi.rodzaje.indexOf('link-niesprawdzony');
  wynik('telefon: R7-I kategoria "Sprawdz na stronie" z linkiem do strony z listy zrodel, po twardych uwagach',
    /SHORT EXCERPTS/.test(sys) && /"strona"/.test(sys) && /\n\[1\] https?:\/\//.test(usr) && !!uwagi.strona && uwagi.strona.etykieta === 'Sprawdź na stronie'
    && uwagi.adresyStron.indexOf(uwagi.strona.href) >= 0 && uwagi.strona.target === '_blank' && iLiczba >= 0 && iStrona > iLiczba && (iNiespr < 0 || iNiespr > iStrona),
    JSON.stringify({ strona: uwagi.strona, rodzaje: uwagi.rodzaje, excerpts: /SHORT EXCERPTS/.test(sys) }));

  // 5: lista zrodel aplikacji (tytuly, daty) i ramka meta nie ida do kontroli jako tresc artykulu.
  const artykulWZapytaniu = String(usr.split('\n\nARTICLE:\n')[1] || '');
  const zrodloWArt = uwagi.zrodlaArt.filter((t) => t && artykulWZapytaniu.indexOf(t) >= 0);
  wynik('telefon: R7-I lista zrodel i ramka meta poza kontrola faktow (tresc artykulu bez nich)',
    artykulWZapytaniu.length > 200 && uwagi.zrodlaArt.length > 0 && zrodloWArt.length === 0 && !!uwagi.meta && artykulWZapytaniu.indexOf(uwagi.meta) < 0
    && /Aktualne lokalizacje/.test(artykulWZapytaniu),
    JSON.stringify({ dl: artykulWZapytaniu.length, zrodel: uwagi.zrodlaArt.length, zrodloWArt: zrodloWArt.slice(0, 2), meta: uwagi.meta.slice(0, 40), metaW: artykulWZapytaniu.indexOf(uwagi.meta) >= 0 }));
  await s.evaluate(() => { inspektorZamknij(); const p = document.getElementById('r7i-link'); if (p) p.remove(); });

  wynik('telefon: R7-I bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'telefon-r7i');
  await k.close();
}

// R7-H (runda 7, wykonawca H): komputer 1280x720 - pusty ekran bez plakietki "gotowy do generowania"
// i bez pustego paska; po generowaniu z samokorekta (2 wersje) i po trzeciej wersji pasek wyniku w jednym
// wierszu; od trzech wersji wybor z listy przelacza artykul; to samo przy 1024 px z rozwinietym briefem.
// Kazdy scenariusz pada na a8a2e18 (main przed runda 7).
async function wariantR7H(b) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 720 }, locale: 'pl-PL' });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); if (!localStorage.getItem('cai_lang')) localStorage.setItem('cai_lang', 'pl'); localStorage.setItem('cai_samokorekta_ok', '1'); } catch (e) { /* bez magazynu */ } });
  const bledy = [];
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  const s = await zaloguj(k, 'premium');
  const pasek = () => s.evaluate(() => {
    const widoczny = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden'; };
    const p = document.querySelector('.output-bar'), o = document.getElementById('out-badge');
    const el = [document.getElementById('versions-bar'), ...p.querySelectorAll('.pasek-akcje > .btn-secondary, .pasek-akcje > .grupa-wrap')].filter(widoczny);
    const gory = el.map((e) => Math.round(e.getBoundingClientRect().top));
    const przyciete = [...p.querySelectorAll('button, .ver-wybor')].filter(widoczny).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.className);
    return { wysokosc: p.offsetHeight, plakietka: widoczny(o) ? o.textContent : '', elementy: el.length, wiersz: gory.length > 1 && Math.max(...gory) - Math.min(...gory) <= 4,
      gory, przyciete, wBok: p.scrollWidth - p.clientWidth, wersjeWidoczne: [...document.querySelectorAll('#versions-bar .ver-btn')].filter(widoczny).map((e) => e.innerText.trim()),
      lista: widoczny(document.querySelector('.ver-wybor')) };
  });
  const p0 = await pasek();
  wynik('komputer: R7-H pusty ekran bez plakietki "gotowy do generowania" i bez pustego paska wyniku', !p0.plakietka && p0.wysokosc === 0, JSON.stringify(p0));
  await s.fill('#topic', 'Jak wybrać pompę ciepła');
  await s.evaluate(() => { document.getElementById('use-web').checked = true; if (!premiumMode) togglePremium(); generate(true); });
  await krok('R7-H artykul z samokorekta', s.waitForFunction(() => versions.length >= 2 && /ready/.test(document.getElementById('out-badge').className) && !document.getElementById('gen-btn').disabled, null, { timeout: 90000 }));
  await s.waitForTimeout(400);
  const p1 = await pasek();
  wynik('komputer: R7-H po samokorekcie (2 wersje) pasek wyniku w jednym wierszu, "Przed | Po", bez przycietych napisow',
    p1.wiersz && p1.elementy >= 5 && !p1.przyciete.length && p1.wBok <= 1 && p1.wersjeWidoczne.join('|') === 'Przed|Po' && !p1.plakietka, JSON.stringify(p1));
  await s.evaluate(() => { addVersion(versions[versions.length - 1].html, _t('ver-serp')); });
  await s.waitForTimeout(400);
  const p2 = await pasek();
  wynik('komputer: R7-H trzecia wersja - pasek w jednym wierszu, wersje jako lista wyboru', p2.wiersz && p2.lista && !p2.wersjeWidoczne.length && !p2.przyciete.length && p2.wBok <= 1, JSON.stringify(p2));
  const wybrano = await krok('R7-H wybor wersji z listy', s.selectOption('#ver-select', '0', { timeout: 3000 }));
  await s.waitForTimeout(300);
  const w = await s.evaluate(() => ({ aktywna: activeVersion, napis: (document.getElementById('ver-wybor-tekst') || {}).textContent, pierwsza: versions[0].label }));
  wynik('komputer: R7-H wybor wersji z listy przelacza artykul', wybrano && w.aktywna === 0 && w.napis === w.pierwsza, JSON.stringify(w));
  await s.setViewportSize({ width: 1024, height: 768 });
  await s.evaluate(() => { if (document.body.classList.contains('brief-zwiniety')) przelaczBrief(false); });
  await s.waitForTimeout(500);
  const p3 = await pasek();
  wynik('komputer: R7-H 1024 px z rozwinietym briefem - pasek w jednym wierszu (podpisy zwiniete do ikon, w title)',
    p3.wiersz && p3.wBok <= 1 && await s.evaluate(() => [...document.querySelectorAll('.pasek-akcje .tylko-ikona')].every((e) => !!e.title)), JSON.stringify(p3));
  await s.setViewportSize({ width: 1280, height: 720 });
  await s.evaluate(() => nowyArtykul());
  await s.waitForTimeout(400);
  const p4 = await pasek();
  wynik('komputer: R7-H po "Nowy artykul" bez plakietki i bez pustego paska', !p4.plakietka && p4.wysokosc === 0, JSON.stringify(p4));
  wynik('komputer: R7-H bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'komputer-r7h');
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

// R9-G: aplikacja zrozumiala dla nowej osoby (UX8-11 do UX8-16): pusta baza bez okna "Brak zrodel wiedzy",
// okno z trzema wyjsciami, wyjasnienia ocen i typow tresci. Telefon i komputer, PL i EN.
// Kazda kontrola pada na 822d52d (main przed runda 9).
async function wariantR9Zrozumialosc(b) {
  const bledy = [];
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'pl-PL', acceptDownloads: true });
  await k.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); if (!localStorage.getItem('cai_lang')) localStorage.setItem('cai_lang', 'pl'); } catch (e) { /* bez magazynu */ } });
  k.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  let s = await zaloguj(k, 'standard');
  // Nowa osoba ma pusta baze: dokumenty dodane przez wczesniejsze scenariusze znikaja z bazy tego konta.
  await s.evaluate(async () => {
    const d = await (await fetch('/api/baza')).json();
    for (const x of (d.dokumenty || [])) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, zakres: x.zakres }) });
  });
  await s.reload({ waitUntil: 'load' });
  await s.waitForTimeout(800);
  await s.evaluate(() => { if (typeof startPomin === 'function') startPomin(); });
  await krok('R9-G liczba dokumentow z serwera', s.waitForFunction(() => typeof window._bazaSerwerLiczba === 'number', null, { timeout: 10000 }));
  const artykuly = [];
  s.on('request', (z) => { if (z.method() === 'POST' && /\/api$/.test(z.url()) && z.headers()['x-cai-czynnosc'] === 'artykul') artykuly.push(z.postData() || ''); });

  // UX8-14: przy pustej bazie "Szukaj w sieci" wlaczone od wejscia, z dopiskiem, a pierwsze Wygeneruj pisze bez okna.
  const start = await s.evaluate(() => ({ web: document.getElementById('use-web').checked,
    opis: document.querySelector('label[for="use-web"] .toggle-hint').textContent, baza: window._bazaSerwerLiczba + docs.length }));
  wynik('telefon: R9-G UX8-14 pusta baza - Szukaj w sieci wlaczone od wejscia, z dopiskiem o pustej bazie',
    start.web && start.baza === 0 && /pusta/.test(start.opis), JSON.stringify(start));
  // UX8-15: postep generowania dla czytnika ekranu - zapis regionu aria-live i aria-busy artykulu w trakcie pierwszego tekstu.
  const zapisSr = [];
  await s.exposeFunction('r9gZapisz', (t) => { zapisSr.push(t); });
  await s.evaluate(() => {
    const r = document.getElementById('gen-postep-sr'), a = document.getElementById('article');
    if (r) new MutationObserver(() => window.r9gZapisz('sr:' + r.textContent)).observe(r, { childList: true, characterData: true, subtree: true });
    if (a) new MutationObserver(() => window.r9gZapisz('busy:' + a.getAttribute('aria-busy'))).observe(a, { attributes: true, attributeFilter: ['aria-busy'] });
  });
  await s.fill('#topic', 'Jak wybrać pompę ciepła do domu');
  await s.click('#gen-btn');
  await s.waitForTimeout(400);
  const okno1 = await s.evaluate(() => document.getElementById('no-source-modal').classList.contains('open'));
  await krok('R9-G pierwszy artykul', czekajNaKoniec(s, 60000));
  await s.waitForTimeout(300);
  const srTeksty = zapisSr.filter((t) => t.indexOf('sr:') === 0), srBusy = zapisSr.filter((t) => t.indexOf('busy:') === 0);
  const regionSr = await s.evaluate(() => { const r = document.getElementById('gen-postep-sr'); return r ? { rola: r.getAttribute('role'), live: r.getAttribute('aria-live') } : null; });
  wynik('telefon: R9-G UX8-15 postep generowania dla czytnika: etapy w regionie aria-live, aria-busy artykulu, na koniec "Artykul gotowy"',
    !!regionSr && regionSr.rola === 'status' && srTeksty.length >= 2 && /…/.test(srTeksty[0]) && srTeksty[srTeksty.length - 1] === 'sr:Artykuł gotowy.'
      && srBusy.indexOf('busy:true') !== -1 && srBusy[srBusy.length - 1] === 'busy:false', JSON.stringify({ regionSr, zapisSr }));
  const pierwszy = await s.evaluate(() => ({ odz: document.getElementById('out-badge').className, h2: document.querySelectorAll('#article h2').length }));
  wynik('telefon: R9-G UX8-14 pierwsze Wygeneruj nowej osoby pisze tekst z siecia, bez okna "Brak zrodel wiedzy"',
    !okno1 && /ready/.test(pierwszy.odz) && pierwszy.h2 > 0 && artykuly.length === 1 && /web_search/.test(artykuly[0]), JSON.stringify({ okno1, pierwszy, zapytan: artykuly.length }));
  // Bez poprawki okno zostaje otwarte: zamykamy je, zeby reszta kontroli dala wlasny wynik.
  if (okno1) await s.evaluate(() => { closeNoSourceModal(); document.getElementById('use-web').checked = true; generate(true); }).then(() => czekajNaKoniec(s, 60000)).catch(() => {});

  // UX8-11: pod przelacznikiem ocen jedno zdanie, co mierzy wybrana ocena; przyciski z podpowiedzia.
  await s.evaluate(() => inspektorPokaz('seo'));
  await s.waitForTimeout(600);
  const oSeo = await s.evaluate(() => ({ opis: (document.getElementById('ins-ocena-opis') || {}).textContent || '',
    widac: !!document.getElementById('ins-ocena-opis') && document.getElementById('ins-ocena-opis').getBoundingClientRect().height > 0,
    podpowiedzi: [...document.querySelectorAll('[data-ins-ocena]')].map((x) => x.title).filter((t) => t.length > 20).length }));
  await s.evaluate(() => inspektorPokaz('geo'));
  await s.waitForTimeout(600);
  const oGeo = await s.evaluate(() => (document.getElementById('ins-ocena-opis') || {}).textContent || '');
  wynik('telefon: R9-G UX8-11 pod SEO/AIO/AEO/GEO zdanie, co mierzy wybrana ocena (GEO to nie geolokalizacja), przyciski z podpowiedzia',
    oSeo.widac && /^SEO: .*Google/.test(oSeo.opis) && /^GEO: .*geolokalizac/.test(oGeo) && oSeo.podpowiedzi === 4, JSON.stringify({ oSeo, oGeo }));
  await s.evaluate(() => inspektorZamknij());
  await s.evaluate(() => ustawWidokMobilny('brief'));
  // UX8-11: Typ tresci SEO / AIO z jednym zdaniem pod polem; dla innych typow bez dopisku.
  const typ = async (v) => { await s.selectOption('#ctype', v); return s.evaluate(() => { const o = document.getElementById('ctype-opis'); return o && !o.hidden && o.getBoundingClientRect().height > 0 ? o.textContent : ''; }); };
  const tH = await typ('Hybryda SEO + AIO'), tB = await typ('Wpis blogowy'), tA = await typ('Treść AIO');
  await s.selectOption('#ctype', 'Hybryda SEO + AIO');
  wynik('telefon: R9-G UX8-11 Typ tresci: zdanie pod polem dla Hybrydy i AIO, bez dopisku dla wpisu blogowego',
    /zalecana/.test(tH) && /Google/.test(tH) && !tB && /AI Overviews/.test(tA), JSON.stringify({ tH, tB, tA }));

  // UX8-14: autor sam wylaczyl siec - okno ma trzy wyjscia, "bez zrodel" z ostrzezeniem pisze tekst bez sieci.
  if (await s.evaluate(() => document.getElementById('use-web').checked)) await krok('R9-G wylacz siec', s.click('#use-web', { timeout: 3000 }));
  await s.fill('#topic', 'Pompa ciepła a fotowoltaika');
  await krok('R9-G Wygeneruj (siec wylaczona)', s.click('#gen-btn', { timeout: 3000 }));
  await krok('R9-G okno Brak zrodel wiedzy', s.waitForFunction(() => document.getElementById('no-source-modal').classList.contains('open'), null, { timeout: 5000 }));
  const okno2 = await s.evaluate(() => {
    const widoczny = (e) => !!e && e.getBoundingClientRect().height > 0;
    const bez = document.getElementById('no-source-bez-btn'), uw = document.getElementById('no-source-bez-uwaga');
    return { web: document.getElementById('use-web').checked, wyjsc: [...document.querySelectorAll('#no-source-modal button:not(.modal-close)')].filter(widoczny).length,
      bez: widoczny(bez) ? bez.textContent : '', uwaga: widoczny(uw) ? uw.textContent : '' };
  });
  const przed = artykuly.length;
  if (okno2.bez) await krok('R9-G Wygeneruj bez zrodel', s.click('#no-source-bez-btn', { timeout: 3000 }));
  else await s.evaluate(() => closeNoSourceModal());
  await krok('R9-G artykul bez zrodel', czekajNaKoniec(s, 60000));
  const bez = await s.evaluate(() => ({ odz: document.getElementById('out-badge').className, web: document.getElementById('use-web').checked,
    okno: document.getElementById('no-source-modal').classList.contains('open') }));
  wynik('telefon: R9-G UX8-14 okno "Brak zrodel wiedzy" ma trzy wyjscia, "Wygeneruj bez zrodel" z ostrzezeniem pisze tekst bez sieci',
    !okno2.web && okno2.wyjsc === 3 && /bez źródeł/.test(okno2.bez) && /Sprawdź/.test(okno2.uwaga) && artykuly.length === przed + 1 && !/web_search/.test(artykuly[przed] || '') && /ready/.test(bez.odz) && !bez.web && !bez.okno,
    JSON.stringify({ okno2, bez, zapytan: artykuly.length - przed }));
  // UX8-15: okna maja nazwe dla czytnika (tytul), kreator mowi "Krok n z m" i stawia fokus na tytule, nie na "Pomin".
  await s.evaluate(() => { closeNoSourceModal(); otworzStart(); });
  await s.waitForTimeout(300);
  const kreator = async () => s.evaluate(() => { const d = document.querySelector('#start-modal [role="dialog"]'); const lb = d && d.getAttribute('aria-labelledby');
    return { nazwa: lb ? ((document.getElementById(lb) || {}).textContent || '') : '', postep: (document.getElementById('start-postep') || {}).textContent || '',
      fokus: document.activeElement ? (document.activeElement.id || document.activeElement.textContent.trim().slice(0, 20)) : '' }; });
  const kr1 = await kreator();
  await s.evaluate(() => startDalej());
  await s.waitForTimeout(200);
  const kr2 = await kreator();
  await s.evaluate(() => startPomin());
  const nazwyOkien = {};
  for (const [id, otworz, zamknij] of [['pakiet-modal', 'otworzPakiet', 'zamknijPakiet'], ['bazas-modal', 'otworzBazeSerwera', 'zamknijBazeSerwera']]) {
    await s.evaluate((f) => { window[f](); }, otworz);
    await s.waitForTimeout(400);
    nazwyOkien[id] = await s.evaluate((i) => { const d = document.querySelector('#' + i + ' [role="dialog"]'); const lb = d && d.getAttribute('aria-labelledby');
      return lb ? ((document.getElementById(lb) || {}).textContent || '').trim() : ''; }, id);
    await s.evaluate((f) => { window[f](); }, zamknij);
  }
  wynik('telefon: R9-G UX8-15 okna z nazwa (kreator, pakiet, baza), kreator "Krok n z 4" i fokus na tytule kroku',
    kr1.nazwa.length > 3 && kr1.postep === 'Krok 1 z 4' && kr1.fokus === 'start-tytul' && kr2.postep === 'Krok 2 z 4' && kr2.fokus === 'start-tytul' && kr2.nazwa !== kr1.nazwa
      && nazwyOkien['pakiet-modal'].length > 3 && nazwyOkien['bazas-modal'].length > 3, JSON.stringify({ kr1, kr2, nazwyOkien }));
  // UX8-13: na telefonie Widocznosc AI (4 narzedzia) w arkuszu Konto, nazwy okien jak w menu, podpis "po co".
  await s.evaluate(() => { closeNoSourceModal(); ustawWidokMobilny('brief'); });
  await krok('R9-G arkusz Konto', s.click('#mnav-konto', { timeout: 3000 }));
  await s.waitForTimeout(400);
  const wid = await s.evaluate(() => {
    const poz = [...document.querySelectorAll('#settings-menu .settings-item')].filter((x) => x.offsetParent !== null && /openVisModal|aivOpen|openRepModal|openTrkModal/.test(x.getAttribute('onclick') || ''));
    return { poz: poz.length, podpisy: poz.map((x) => (x.querySelector('.settings-item-opis') || {}).textContent || '') };
  });
  const oknoZMenu = async (fn) => {
    await s.evaluate(() => { if (!document.getElementById('settings-menu').classList.contains('open')) otworzKontoMobilne(); });
    await s.waitForTimeout(300);
    const ok = await krok('R9-G pozycja ' + fn, s.click('#settings-menu .settings-item[onclick^="' + fn + '"]', { timeout: 3000 }));
    await s.waitForTimeout(400);
    const t = await s.evaluate(() => { const m = [...document.querySelectorAll('.overlay')].filter((o) => getComputedStyle(o).display !== 'none' && o.getClientRects().length).pop(); return m ? (m.querySelector('h3') || {}).textContent : ''; });
    await s.keyboard.press('Escape');
    return ok ? t : '';
  };
  const tVis = await oknoZMenu('openVisModal'), tAiv = await oknoZMenu('aivOpen');
  wynik('telefon: R9-G UX8-13 Widocznosc AI w arkuszu Konto: 4 narzedzia z podpisem "po co", okna nazwane jak w menu',
    wid.poz === 4 && /^czy AI poleca/.test(wid.podpisy[0]) && /^czy AI cytuje/.test(wid.podpisy[1]) && /^wejścia z czatów AI/.test(wid.podpisy[3]) && tVis === 'Obecność marki w AI' && tAiv === 'Cytowania w AI', JSON.stringify({ wid, tVis, tAiv }));
  // UX8-16: Historia mowi, ze jest tylko w tej przegladarce, i daje kopie do pobrania (HTML z artykulami i danymi wpisow).
  await krok('R9-G Historia', s.click('#mnav-hist', { timeout: 3000 }));
  await s.waitForTimeout(400);
  const hist = await s.evaluate(() => { const n = document.getElementById('hist-lokalnie'); return { widac: !!n && n.getBoundingClientRect().height > 0, tekst: n ? n.textContent : '', wpisow: history.length }; });
  let kopia = { plik: '', wpisy: -1, artykuly: -1 };
  try {
    const [pob] = await Promise.all([s.waitForEvent('download', { timeout: 5000 }), s.click('#hist-eksport-btn', { timeout: 3000 })]);
    const tresc = fs.readFileSync(await pob.path(), 'utf8');
    const dane = tresc.match(/<script type="application\/json" id="content-ai-historia">([\s\S]*?)<\/script>/);
    kopia = { plik: pob.suggestedFilename(), wpisy: dane ? JSON.parse(dane[1]).wpisy.length : 0, artykuly: (tresc.match(/<article/g) || []).length };
  } catch (e) { kopia.blad = String(e.message || e).split('\n')[0]; }
  wynik('telefon: R9-G UX8-16 Historia: zdanie "tylko w tej przegladarce" i kopia do pobrania (plik HTML z artykulami i danymi wpisow)',
    hist.widac && /tylko w tej przeglądarce/.test(hist.tekst) && hist.wpisow >= 2 && /^content-ai-historia-\d{4}-\d{2}-\d{2}\.html$/.test(kopia.plik) && kopia.wpisy === hist.wpisow && kopia.artykuly === hist.wpisow,
    JSON.stringify({ hist, kopia }));
  // UX8-12: jedna nazwa na jedna rzecz - wejscie do narzedzia nazywa sie tak jak ekran, ktory otwiera, a cztery
  // sposoby poprawiania maja cztery rozne nazwy (Samokorekta, Popraw ten tekst, Popraw wklejony tekst, Dopisz brakujace tematy).
  const nazwy = await s.evaluate(() => {
    const t = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : '?'; };
    return {
      plan: [t('#grupa-brief-menu button[onclick="openBriefPanel()"]'), t('#brief-panel [data-i18n="brief-title"]')],
      popraw: [t('#grupa-brief-menu button[onclick="openImproveModal()"]'), t('[data-i18n="start-karta-popraw"]'), t('#improve-modal h3')],
      grafika: [t('#grupa-brief-menu button[onclick="openImgPanelSmart()"]'), t('#img-btn'), t('#img-panel .modul-tytul')],
      audio: [t('#grupa-brief-menu button[onclick="openAudioPanel()"]'), t('#audio-panel .modul-tytul')],
      baza: [t('#kb-tab [data-i18n="kb-reopen"]'), t('#mnav-kb [data-i18n="nav-base"]'), t('.layout > .sidebar h2'), t('#mobile-sidebar h2'), t('[data-i18n="bazas-menu-title"]'), t('#bazas-modal .tekst-tytul')],
      glos: [t('[data-i18n="settings-voice-title"]'), t('#voice-modal h3')],
      poprawianie: [t('#premium-btn [data-i18n="btn-premium"]'), t('#premium-fix-btn'), t('#grupa-brief-menu button[onclick="openImproveModal()"]'), t('#gap-improve-btn')],
    };
  });
  const jednaNazwa = ['plan', 'popraw', 'grafika', 'audio', 'baza', 'glos'].every((n) => new Set(nazwy[n]).size === 1 && nazwy[n][0] !== '?');
  wynik('telefon: R9-G UX8-12 jedna nazwa na jedna rzecz: Plan artykulu, Popraw wklejony tekst, Grafika, Audio, Baza wiedzy, czytanie na glos; cztery rozne nazwy poprawiania',
    jednaNazwa && nazwy.plan[0] === 'Plan artykułu' && nazwy.baza[0] === 'Baza wiedzy' && new Set(nazwy.poprawianie).size === 4
      && nazwy.poprawianie.join('|') === 'Samokorekta|Popraw ten tekst|Popraw wklejony tekst|Dopisz brakujące tematy', JSON.stringify(nazwy));
  wynik('telefon: R9-G bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'telefon-r9g');
  await k.close();

  // Komputer, EN: opisy po angielsku, "Dodaj zrodla" otwiera zwinieta baze.
  const k2 = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  await k2.addInitScript(() => { try { sessionStorage.setItem('cin_splash', '1'); localStorage.setItem('cai_lang', 'en'); localStorage.setItem('cai_samokorekta_ok', '1'); } catch (e) { /* bez magazynu */ } });
  k2.on('page', (p) => p.on('pageerror', (e) => bledy.push(e.message)));
  s = await zaloguj(k2, 'standard');
  await krok('R9-G komputer: liczba dokumentow z serwera', s.waitForFunction(() => typeof window._bazaSerwerLiczba === 'number', null, { timeout: 10000 }));
  const en = await s.evaluate(() => ({ web: document.getElementById('use-web').checked, opis: document.querySelector('label[for="use-web"] .toggle-hint').textContent,
    typ: (document.getElementById('ctype-opis') || {}).textContent || '' }));
  wynik('komputer EN: R9-G UX8-14 i UX8-11 dopisek o pustej bazie i opis typu tresci po angielsku',
    en.web && /empty/.test(en.opis) && /recommended/.test(en.typ), JSON.stringify(en));
  // UX8-14: dokument w bazie wylacza siec wlaczona dla pustej bazy (wraca zwykly dopisek), pusta baza znow ja wlacza.
  // W trakcie generowania (spinner) przelacznik stoi: zmiana dopiero po nim.
  const przelacznik = () => s.evaluate(() => ({ web: document.getElementById('use-web').checked,
    klucz: document.querySelector('label[for="use-web"] .toggle-hint').getAttribute('data-i18n'), baza: window._bazaSerwerLiczba }));
  const idDok = await s.evaluate(async () => {
    document.getElementById('spinner').style.display = 'flex';
    await fetch('/api/baza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zakres: 'prywatna', nazwa: 'Oferta R9-G', tresc: 'Pompy ciepla: montaz i serwis w 7 dni.' }) });
    await odswiezListeBazy();
    return ((await (await fetch('/api/baza')).json()).dokumenty || []).map((x) => x.id);
  });
  await s.waitForTimeout(400);
  const wTrakcie = await przelacznik();
  await s.evaluate(() => { document.getElementById('spinner').style.display = 'none'; odswiezLiczniki(); });
  const zDok = await przelacznik();
  await s.evaluate(async (ids) => {
    for (const id of ids) await fetch('/api/baza/usun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, zakres: 'prywatna' }) });
    await odswiezListeBazy();
  }, idDok);
  await s.waitForTimeout(400);
  const bezDok = await przelacznik();
  wynik('komputer EN: R9-G UX8-14 siec wlaczona dla pustej bazy wylacza sie, gdy w bazie jest dokument (po generowaniu, nie w trakcie), i wraca, gdy baza znow jest pusta',
    wTrakcie.web && wTrakcie.baza === 1 && !zDok.web && zDok.klucz === 'toggle-web-hint' && zDok.baza === 1 && bezDok.web && bezDok.klucz === 'toggle-web-hint-pusta' && bezDok.baza === 0,
    JSON.stringify({ wTrakcie, zDok, bezDok }));
  // UX8-24: przykladowy artykul z pustego ekranu - bez klucza i bez zapytania do modelu, nie trafia do Historii.
  let zapytaniaPrzykladu = 0;
  const liczPrzyklad = (z) => { if (z.method() === 'POST' && /\/api(\/|$)/.test(z.url())) zapytaniaPrzykladu++; };
  s.on('request', liczPrzyklad);
  const przykladOk = await krok('R9-G link do przykladu', s.click('#placeholder .start-przyklad', { timeout: 3000 }));
  await s.waitForTimeout(400);
  const przyklad = await s.evaluate(() => {
    const m = document.getElementById('przyklad-modal'), d = m && m.querySelector('[role="dialog"]'), lb = d && d.getAttribute('aria-labelledby');
    return { otwarte: !!m && m.classList.contains('open'), nazwa: lb ? (document.getElementById(lb) || {}).textContent : '',
      h1: (document.querySelector('#przyklad-artykul h1') || {}).textContent || '', h2: document.querySelectorAll('#przyklad-artykul h2').length,
      zrodla: !!document.querySelector('#przyklad-artykul .zrodla-box'), oceny: [...document.querySelectorAll('#przyklad-siatka .przyklad-ocena')].map((o) => o.textContent.slice(0, 12)),
      fakty: (document.getElementById('przyklad-fakty') || {}).textContent || '', hist: history.length,
      fokusNaOknie: !!m && document.activeElement === m.querySelector('.modal') };
  });
  await s.keyboard.press('Escape');
  await s.waitForTimeout(300);
  const poPrzykladzie = await s.evaluate(() => ({ zamkniete: !document.getElementById('przyklad-modal') || !document.getElementById('przyklad-modal').classList.contains('open'), hist: history.length }));
  s.off('request', liczPrzyklad);
  wynik('komputer EN: R9-G UX8-24 przykladowy artykul z pustego ekranu: tekst ze zrodlami, cztery oceny z opisem, kontrola faktow, bez zapytania i bez Historii',
    przykladOk && przyklad.otwarte && przyklad.nazwa === 'Sample article' && /CRM/.test(przyklad.h1) && przyklad.h2 >= 3 && przyklad.zrodla && przyklad.oceny.length === 4
      && /^86SEO/.test(przyklad.oceny[0]) && /Fact check/.test(przyklad.fakty) && przyklad.fokusNaOknie && zapytaniaPrzykladu === 0 && poPrzykladzie.zamkniete && poPrzykladzie.hist === przyklad.hist,
    JSON.stringify({ przyklad, poPrzykladzie, zapytaniaPrzykladu }));
  await s.evaluate(() => { if (!document.body.classList.contains('kb-collapsed')) toggleKbPanel(); });
  if (await s.evaluate(() => document.getElementById('use-web').checked)) await krok('R9-G komputer: wylacz siec', s.click('#use-web', { timeout: 3000 }));
  await s.fill('#topic', 'Heat pump sizing');
  await krok('R9-G komputer: Wygeneruj (siec wylaczona)', s.click('#gen-btn', { timeout: 3000 }));
  await krok('R9-G komputer: okno Brak zrodel wiedzy', s.waitForFunction(() => document.getElementById('no-source-modal').classList.contains('open'), null, { timeout: 5000 }));
  await krok('R9-G komputer: Dodaj zrodla', s.click('#no-source-kb-btn', { timeout: 3000 }));
  await s.waitForTimeout(500);
  const baza = await s.evaluate(() => ({ zwinieta: document.body.classList.contains('kb-collapsed'), okno: document.getElementById('no-source-modal').classList.contains('open'),
    panel: getComputedStyle(document.querySelector('.layout > .sidebar')).display !== 'none' && document.querySelector('.layout > .sidebar').getBoundingClientRect().width > 100 }));
  wynik('komputer EN: R9-G UX8-14 "Dodaj zrodla do bazy wiedzy" otwiera zwinieta baze wiedzy', !baza.zwinieta && !baza.okno && baza.panel, JSON.stringify(baza));
  // UX8-13: na komputerze grupa z arkusza Konto jest ukryta (Widocznosc AI w gornym pasku), fokus menu na pierwszej widocznej pozycji.
  await s.evaluate(() => toggleSettingsMenu());
  await s.waitForTimeout(400);
  const menuK = await s.evaluate(() => ({ grupa: [...document.querySelectorAll('#settings-menu .settings-item')].filter((x) => x.offsetParent !== null && /openVisModal/.test(x.getAttribute('onclick') || '')).length,
    fokus: !!document.activeElement && document.activeElement.classList.contains('settings-item') && document.activeElement.offsetParent !== null }));
  await s.evaluate(() => closeSettingsMenu());
  wynik('komputer EN: R9-G UX8-13 menu konta bez kopii Widocznosci AI, fokus na pierwszej widocznej pozycji', menuK.grupa === 0 && menuK.fokus, JSON.stringify(menuK));
  // UX8-07 (czesc grafiki): brak klucza na serwerze (500 "Brak OPENAI_KEY na serwerze") nie jest ponawiany przez 15 s,
  // a zwykly blad serwera (500 api_error) dalej jest ponawiany.
  let grafik = 0, tryb = 'brak-klucza';
  await s.route(/\/api\/images$/, async (route) => {
    grafik++;
    if (tryb === 'brak-klucza') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Brak OPENAI_KEY na serwerze' }) });
    if (tryb === 'przejsciowy' && grafik === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { type: 'api_error', message: 'Internal server error' } }) });
    return route.continue();
  });
  await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); openImgPanelSmart(); document.getElementById('img-context').value = 'Heat pump in a detached house'; });
  await s.waitForTimeout(400);
  const t0 = Date.now();
  await krok('R9-G grafika bez klucza', s.click('#img-gen-btn', { timeout: 3000 }));
  await krok('R9-G grafika bez klucza: komunikat', s.waitForFunction(() => document.querySelectorAll('.powiadomienie').length > 0 && !document.getElementById('img-gen-btn').disabled, null, { timeout: 40000 }));
  const bezKlucza = { zapytan: grafik, ms: Date.now() - t0, komunikat: await s.evaluate(() => (document.querySelector('.powiadomienie') || {}).textContent || '') };
  tryb = 'przejsciowy'; grafik = 0;
  await s.evaluate(() => { document.querySelectorAll('.powiadomienie').forEach((p) => p.remove()); });
  await krok('R9-G grafika po bledzie przejsciowym', s.click('#img-gen-btn', { timeout: 3000 }));
  await krok('R9-G grafika gotowa po ponowieniu', s.waitForFunction(() => document.getElementById('img-result-wrap').style.display === 'block' && !document.getElementById('img-gen-btn').disabled, null, { timeout: 40000 }));
  const przejsciowy = { zapytan: grafik };
  await s.unroute(/\/api\/images$/);
  await s.evaluate(() => closeImgPanelSmart());
  wynik('komputer EN: R9-G UX8-07 grafika: brak klucza na serwerze bez 15 s ponawiania (jedno zapytanie, komunikat od razu), zwykly 500 dalej ponawiany',
    bezKlucza.zapytan === 1 && bezKlucza.ms < 8000 && /key|klucz/i.test(bezKlucza.komunikat) && przejsciowy.zapytan === 2, JSON.stringify({ bezKlucza, przejsciowy }));
  wynik('komputer EN: R9-G bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await zrzut(s, 'komputer-r9g');
  await k2.close();
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
    await osobno(wariantKeys, b);
    await osobno(wariantProxy, b);
    await osobno(wariantTelefonR6, b);
    await osobno(wariantTelefonR6Luki, b);
    await osobno(wariantNowyArtykul, b);
    await osobno(wariantR6F, b);
    await osobno(wariantR7Luki, b);
    await osobno(wariantR7I, b);
    await osobno(wariantR7H, b);
    await wariantPilneKreator(b);
    await wariantR9Zrozumialosc(b);
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
    console.log(serwer.log().split('\n').slice(-20).join('\n'));
  } finally {
    if (b) await b.close();
    serwer.kill();
    serwerAtrapy.close();
    serwerPlikow.close();
    fs.rmSync(kat, { recursive: true, force: true });
    if (KAT_DZIENNIKA) { if (bledow) console.log('Dziennik atrapy: ' + process.env.ATRAPA_DZIENNIK); else fs.rmSync(KAT_DZIENNIKA, { recursive: true, force: true }); }
  }
  console.log(bledow ? '\nBLEDOW: ' + bledow : '\nWszystkie scenariusze przeszly.');
  process.exit(bledow ? 1 : 0);
})();
