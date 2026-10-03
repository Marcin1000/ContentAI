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
  await s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none', null, { timeout: 30000 }).catch(() => {});
  await s.evaluate(() => {
    const fw = document.getElementById('fakty-wynik');
    if (fw && fw.firstElementChild) fw.firstElementChild.setAttribute('data-test-art', 'A');
    runRepurpose('linkedin');
  });
  await s.waitForFunction(() => (document.getElementById('repurpose-out').value || '').length > 20, null, { timeout: 30000 }).catch(() => {});
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
  await s.waitForFunction(() => (document.getElementById('repurpose-out').value || '').length > 20, null, { timeout: 30000 }).catch(() => {});
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
    await s.waitForFunction(() => getComputedStyle(document.getElementById('fakty-loading')).display === 'none', null, { timeout: 30000 }).catch(() => {});
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
    await s.waitForFunction(() => !!document.querySelector('#seo-content .komunikat-bledu'), null, { timeout: 30000 }).catch(() => {});
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
  await s.waitForFunction(() => document.querySelectorAll('.powiadomienie').length > 0, null, { timeout: 30000 }).catch(() => {});
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

(async () => {
  let b;
  try {
    b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
    await scenariuszStanu(b);
    await scenariuszBledow(b);
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    if (b) await b.close();
  }
  console.log(bledow ? '\nBLEDOW: ' + bledow : '\nWszystkie scenariusze przeszly.');
  process.exit(bledow ? 1 : 0);
})();
