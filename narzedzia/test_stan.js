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

(async () => {
  let b;
  try {
    b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
    await scenariuszStanu(b);
    await scenariuszBledow(b);
    await scenariuszHistoriiR4(b);
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    if (b) await b.close();
  }
  console.log(bledow ? '\nBLEDOW: ' + bledow : '\nWszystkie scenariusze przeszly.');
  process.exit(bledow ? 1 : 0);
})();
