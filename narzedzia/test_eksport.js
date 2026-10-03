#!/usr/bin/env node
'use strict';
/*
 * Test eksportu Content AI (runda 3, R3-29) w prawdziwej przegladarce, z atrapa dostawcow.
 *
 * Generuje artykul ze zrodlami z sieci (atrapa podaje page_age raz jako date, raz jako
 * "N days ago"), dokleja do zywego artykulu rzeczy, ktore NIE moga wyjsc do klienta,
 * i pobiera DOCX, PDF i TXT, kopiuje do schowka i publikuje do WordPressa (przechwycone).
 * Sprawdza:
 *   - DOCX to prawdziwy WordprocessingML: w:p > 10, A4, style Title i Heading 2, bez altChunk;
 *   - zaden eksport nie zawiera "days ago", "var(--", elementow data-tylko-ekran, tresci
 *     niewidocznej na ekranie ani notatki autora o luce (p[data-brak]);
 *   - nazwa pliku jest w ASCII, bez "__", cieta na granicy slowa (rdzen = poczatek nazwy z H1);
 *   - PDF ma naglowek zrodel i metadane (tytul = H1);
 *   - artykul angielski w polskim interfejsie ma w eksporcie "Sources", daty po angielsku
 *     i jezyk dokumentu en-US;
 *   - kod JSON-LD nie zamyka znacznika skryptu tekstem z artykulu.
 *
 * Uzycie (z katalogu repozytorium, po zbudowaniu wariantow):
 *   npm install --no-save playwright && npx playwright install chromium
 *   node narzedzia/test_eksport.js
 * Zmienne: CAI_CHROMIUM - sciezka do Chromium (domyslnie z Playwright),
 *          CAI_TEST_ZRZUTY - katalog na pobrane pliki i zrzut przy bledzie (domyslnie tmp).
 * Kod wyjscia: 0 gdy wszystko przeszlo, 1 gdy cokolwiek nie.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Brak pakietu playwright: npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }

// Atrapa obsluguje zapytania przez page.route - serwer atrapy nie jest potrzebny.
process.env.ATRAPA_PORT = process.env.ATRAPA_PORT || '0';
const atrapa = require('./atrapa/dostawcy.js');

const WYJSCIE = process.env.CAI_TEST_ZRZUTY || fs.mkdtempSync(path.join(os.tmpdir(), 'cai-test-eksport-'));
fs.mkdirSync(WYJSCIE, { recursive: true });

let bledow = 0;
function wynik(nazwa, ok, szczegol) {
  console.log((ok ? 'ok    ' : 'BLAD  ') + nazwa + (!ok && szczegol ? '  [' + String(szczegol).slice(0, 400) + ']' : ''));
  if (!ok) bledow++;
}

// ── ZIP (DOCX) bez zaleznosci: katalog centralny, STORE albo deflate ─────────
function czytajZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('brak katalogu centralnego ZIP');
  const wpisow = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const pliki = {};
  for (let n = 0; n < wpisow; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('uszkodzony katalog centralny');
    const metoda = buf.readUInt16LE(p + 10);
    const rozmiar = buf.readUInt32LE(p + 20);
    const dlNazwy = buf.readUInt16LE(p + 28);
    const dlExtra = buf.readUInt16LE(p + 30);
    const dlKom = buf.readUInt16LE(p + 32);
    const lokalny = buf.readUInt32LE(p + 42);
    const nazwa = buf.slice(p + 46, p + 46 + dlNazwy).toString('utf8');
    const start = lokalny + 30 + buf.readUInt16LE(lokalny + 26) + buf.readUInt16LE(lokalny + 28);
    const dane = buf.slice(start, start + rozmiar);
    pliki[nazwa] = metoda === 0 ? dane : zlib.inflateRawSync(dane);
    p += 46 + dlNazwy + dlExtra + dlKom;
  }
  return pliki;
}

// Tekst z XML WordprocessingML (w:t), akapity oddzielone nowa linia.
function tekstDocx(xml) {
  return xml.split(/<\/w:p>/).map((p) => (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || [])
    .map((t) => t.replace(/<[^>]+>/g, '')).join('')).join('\n')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Ta sama regula co w aplikacji (M7): transliteracja, male litery, laczniki.
const BEZ_ROZKLADU = { 'ł': 'l', 'Ł': 'L', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'þ': 'th', 'œ': 'oe', 'Œ': 'OE' };
function slug(t) {
  return String(t || '').replace(/[łŁßæÆøØđĐðþœŒ]/g, (z) => BEZ_ROZKLADU[z] || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sprawdzNazwe(opis, nazwa, h1, rozszerzenie) {
  const ascii = /^[a-z0-9-]+\.[a-z0-9]+$/.test(nazwa);
  const rdzen = nazwa.replace(new RegExp('\\.' + rozszerzenie + '$'), '');
  const pelny = slug(h1);
  const naGranicy = pelny.startsWith(rdzen) && (pelny.length === rdzen.length || pelny.charAt(rdzen.length) === '-');
  wynik(opis + ': nazwa w ASCII, bez "__", na granicy slowa, do 80 znakow',
    ascii && !/__|--/.test(nazwa) && naGranicy && rdzen.length <= 80 && rdzen.length > 0,
    nazwa + ' / H1: ' + pelny);
}

const ZAKAZANE = ['LOGIN-W-ADRESIE', 'HASLO-W-ADRESIE', 'days ago', 'var(--', 'EKRAN-TYLKO', 'UKRYTE-DOM', 'UKRYTE-SR', 'NOTATKA-AUTORA', 'data-tylko-ekran', 'data-brak'];
function sprawdzTresc(opis, tekst) {
  const znalezione = ZAKAZANE.filter((z) => tekst.indexOf(z) >= 0);
  wynik(opis + ': bez "days ago", var(--, elementow ekranowych, niewidocznych, notatek o lukach i hasel w linkach', !znalezione.length, znalezione.join(', '));
}

const PRZED_STARTEM = () => {
  try {
    localStorage.setItem('cai_key_anthropic', 'sk-ant-atrapa');
    localStorage.setItem('cai_lang', 'pl');
    localStorage.setItem('cai_start_v1', '1');
    localStorage.setItem('cai-wp', JSON.stringify({ url: 'https://wp.przyklad.test', user: 'redakcja', pass: 'WSTAW_TUTAJ_HASLO' }));
    localStorage.setItem('cai-active-cms', 'wp');
    sessionStorage.setItem('cin_splash', '1');
  } catch (e) { /* tryb bez magazynu */ }
  // Schowek w przegladarce bez okna: zapamietujemy, co aplikacja chciala skopiowac.
  window.__schowek = '';
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (t) => { window.__schowek = String(t); return Promise.resolve(); },
      readText: () => Promise.resolve(window.__schowek) } });
  } catch (e) { /* zostaje prawdziwy schowek */ }
};

async function czekajNaKoniec(s, ms) {
  await s.waitForFunction(() => {
    const b = document.getElementById('gen-btn');
    const sp = document.getElementById('spinner');
    return b && !b.disabled && sp && getComputedStyle(sp).display === 'none';
  }, null, { timeout: ms || 60000 });
}

async function pobierz(s, wywolanie, nazwaPliku) {
  const [d] = await Promise.all([s.waitForEvent('download', { timeout: 45000 }), s.evaluate(wywolanie)]);
  const cel = path.join(WYJSCIE, nazwaPliku + '-' + d.suggestedFilename());
  await d.saveAs(cel);
  return { nazwa: d.suggestedFilename(), dane: fs.readFileSync(cel), sciezka: cel };
}

// pymupdf, jesli jest (kontener zespolu ma, CI nie musi): tekst i metadane PDF.
function pdfPrzezPymupdf(sciezka) {
  // Nowsze wersje: "import pymupdf" (stare "fitz" wypisuje ostrzezenie na stdout).
  const skrypt = 'import sys, json\ntry:\n  import pymupdf as fitz\nexcept Exception:\n  try:\n    import fitz\n  except Exception:\n    print("BRAK"); sys.exit(0)\n'
    + 'd = fitz.open(sys.argv[1])\nprint(json.dumps({"tekst": "".join(p.get_text() for p in d), "meta": d.metadata, "strony": d.page_count}))\n';
  const r = spawnSync('python3', ['-c', skrypt, sciezka], { encoding: 'utf8' });
  const linia = String(r.stdout || '').trim().split('\n').pop();
  if (r.status !== 0 || !linia || /^BRAK/.test(linia)) return null;
  try { return JSON.parse(linia); } catch (e) { return null; }
}

async function nowaStrona(b, wp) {
  const k = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await k.addInitScript(PRZED_STARTEM);
  await k.route(/api\.anthropic\.com|api\.openai\.com|api\.elevenlabs\.io/, (route) => atrapa.obsluzRoute(route));
  // WordPress klienta: przechwytujemy wpis, zamiast go wysylac.
  await k.route(/wp\.przyklad\.test/, (route) => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    try { wp.push(JSON.parse(req.postData() || '{}')); } catch (e) { wp.push({ blad: String(e) }); }
    return route.fulfill({ status: 201, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: JSON.stringify({ id: 1, link: 'https://wp.przyklad.test/?p=1' }) });
  });
  const s = await k.newPage();
  const bledy = [];
  s.on('pageerror', (e) => bledy.push(e.message));
  s.on('dialog', (d) => d.accept());
  await s.goto('file://' + path.join(REPO, 'app', 'web-keys.html'), { waitUntil: 'load' });
  await s.waitForTimeout(600);
  return { k, s, bledy };
}

async function generuj(s, temat, jezyk) {
  await s.fill('#topic', temat);
  await s.evaluate((j) => {
    document.getElementById('use-web').checked = true;
    if (j) document.getElementById('lang').value = j;
  }, jezyk || 'Polski');
  await s.click('#gen-btn');
  await czekajNaKoniec(s);
  return s.evaluate(() => {
    const art = document.getElementById('article');
    const h1 = art.querySelector('h1');
    return {
      h1: h1 ? h1.textContent.trim() : '',
      zrodla: art.querySelectorAll('.zrodla-box li').length,
      daty: art.querySelectorAll('.zrodla-box time[datetime]').length,
      etykietaZrodel: (art.querySelector('.zrodla-box .zrodla-label') || {}).textContent || '',
      etykietaMeta: (art.querySelector('.meta-box .meta-label') || {}).textContent || '',
      odznaka: document.getElementById('out-badge').className,
    };
  });
}

// Rzeczy, ktore nie moga wyjsc do klienta, doklejone do zywego artykulu przed zrodlami.
async function doklejPulapki(s) {
  await s.evaluate(() => {
    const art = document.getElementById('article');
    const zrodla = art.querySelector('.zrodla-box');
    // Sekcja z notatka o luce na koncu (przed zrodlami): pod jej naglowkiem nic wiecej nie ma.
    const html = '<div data-tylko-ekran>EKRAN-TYLKO</div>'
      + '<p style="display:none">UKRYTE-DOM</p>'
      + '<p style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">UKRYTE-SR</p>'
      + '<p>Akapit ze stylem <span style="color:var(--text3)">motywu</span> zostaje bez stylu.</p>'
      + '<p>Link z loginem: <a href="https://LOGIN-W-ADRESIE:HASLO-W-ADRESIE@example.com/x">panel</a>.</p>'
      + '<h2>Czy kod JSON-LD jest bezpieczny?</h2><p>Tekst z </p>'
      + '<h2>Sekcja bez pokrycia</h2><p data-brak="1">NOTATKA-AUTORA</p>';
    if (zrodla) zrodla.insertAdjacentHTML('beforebegin', html); else art.insertAdjacentHTML('beforeend', html);
    // Tekst zamykajacy znacznik skryptu w tresci (jako tekst, nie znacznik).
    const ps = art.querySelectorAll('h2 + p:not([data-brak])');
    ps[ps.length - 1].appendChild(document.createTextNode('</scr' + 'ipt><scr' + 'ipt>window.__jsonld=1</scr' + 'ipt>'));
    // Stara pozycja zrodla z data wzgledna (wpis historii sprzed poprawki).
    const li = art.querySelector('.zrodla-box li');
    if (li) li.insertAdjacentHTML('beforeend', ' <span style="color:var(--text3)">(368 days ago)</span>');
  });
}

async function scenariuszPolski(b) {
  const wp = [];
  const { k, s, bledy } = await nowaStrona(b, wp);
  const temat = 'Największe tajemnice świata kontra AI: co sztuczna inteligencja już rozwiązała, a czego wciąż nie umie wyjaśnić';
  const r = await generuj(s, temat, 'Polski');
  wynik('PL: artykul ze zrodlami z sieci', /ready/.test(r.odznaka) && r.zrodla >= 2, JSON.stringify(r));
  wynik('PL: kazde zrodlo ma date bezwzgledna (<time datetime>), takze z "N days ago"', r.zrodla > 0 && r.daty === r.zrodla, r.daty + '/' + r.zrodla);
  wynik('PL: etykiety w aplikacji ze slownika', r.etykietaZrodel === 'Źródła z sieci' && r.etykietaMeta === 'Opis meta (SEO)', r.etykietaZrodel + ' | ' + r.etykietaMeta);
  const hist = await s.evaluate(() => ({ html: history[0] && history[0].html, jezyk: history[0] && history[0].jezyk }));
  wynik('PL: historia ma zrodla z datami i jezyk artykulu', /zrodla-box/.test(hist.html || '') && /<time datetime="\d{4}-\d{2}-\d{2}">/.test(hist.html || '') && hist.jezyk === 'pl', hist.jezyk);
  sprawdzTresc('PL: wpis historii', hist.html || '');

  await doklejPulapki(s);

  // DOCX
  const docx = await pobierz(s, () => dlDocx(), 'pl');
  sprawdzNazwe('PL DOCX', docx.nazwa, r.h1, 'docx');
  let zip = {};
  try { zip = czytajZip(docx.dane); } catch (e) { wynik('PL DOCX: poprawny ZIP', false, e.message); }
  const dok = (zip['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
  const style = (zip['word/styles.xml'] || Buffer.alloc(0)).toString('utf8');
  const core = (zip['docProps/core.xml'] || Buffer.alloc(0)).toString('utf8');
  const akapitow = (dok.match(/<w:p[ >]/g) || []).length;
  const wszystko = Object.keys(zip).map((n) => n + '\n' + zip[n].toString('utf8')).join('\n');
  wynik('PL DOCX: WordprocessingML (w:p > 10), bez altChunk', akapitow > 10 && !/altChunk/i.test(wszystko), 'w:p=' + akapitow);
  wynik('PL DOCX: strona A4', /<w:pgSz w:w="11906" w:h="16838"/.test(dok));
  wynik('PL DOCX: style Title i Heading 2 uzyte i zdefiniowane',
    /w:pStyle w:val="Title"/.test(dok) && /w:pStyle w:val="Heading2"/.test(dok) && /w:styleId="Heading2"/.test(style));
  wynik('PL DOCX: jezyk pl-PL', /w:lang w:val="pl-PL"/.test(style));
  const tekstD = tekstDocx(dok);
  sprawdzTresc('PL DOCX', wszystko);
  wynik('PL DOCX: naglowek "Źródła" i daty "30 wrz 2025"', /(^|\n)Źródła\n/.test(tekstD) && /\b\d{1,2} (sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru) \d{4}\b/.test(tekstD));
  wynik('PL DOCX: pusta sekcja z notatka o luce pominieta', tekstD.indexOf('Sekcja bez pokrycia') < 0);
  wynik('PL DOCX: tytul w metadanych = H1', core.indexOf('<dc:title>') >= 0 && tekstDocx('<w:p><w:t>' + (core.match(/<dc:title>([^<]*)<\/dc:title>/) || [])[1] + '</w:t></w:p>').trim() === r.h1);
  const powiadomienia = await s.evaluate(() => [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | '));
  wynik('PL: komunikat o pominietych sekcjach bez pokrycia', /pominięte w eksporcie: 1/.test(powiadomienia), powiadomienia);

  // PDF: definicja dokumentu i plik
  await s.evaluate(() => new Promise((ok) => zaladujPdfMake(ok)));
  await s.evaluate(() => {
    const org = pdfMake.createPdf;
    pdfMake.createPdf = function (dd) { window.__dd = JSON.parse(JSON.stringify(dd)); return org.apply(this, arguments); };
  });
  const pdf = await pobierz(s, () => dlPdf(), 'pl');
  sprawdzNazwe('PL PDF', pdf.nazwa, r.h1, 'pdf');
  const dd = await s.evaluate(() => window.__dd);
  const ddTekst = JSON.stringify(dd || {});
  wynik('PL PDF: plik PDF', pdf.dane.slice(0, 5).toString() === '%PDF-' && pdf.dane.length > 2000, pdf.dane.length + ' B');
  wynik('PL PDF: naglowek zrodel (h2 "Źródła")', !!dd && (dd.content || []).some((e) => e && e.text === 'Źródła' && e.style === 'h2'));
  wynik('PL PDF: metadane tytul = H1, A4', !!dd && dd.info && dd.info.title === r.h1 && dd.pageSize === 'A4', dd && JSON.stringify(dd.info));
  sprawdzTresc('PL PDF (definicja)', ddTekst);
  const fitz = pdfPrzezPymupdf(pdf.sciezka);
  if (fitz) {
    wynik('PL PDF (pymupdf): tekst ma "Źródła", tytul w metadanych', /Źródła/.test(fitz.tekst) && fitz.meta && fitz.meta.title === r.h1, fitz.meta && fitz.meta.title);
    sprawdzTresc('PL PDF (pymupdf)', fitz.tekst);
  } else {
    console.log('info  PL PDF: pymupdf niedostepny - tekst PDF sprawdzony przez definicje dokumentu');
  }

  // TXT
  const txt = await pobierz(s, () => dlTxt(), 'pl');
  sprawdzNazwe('PL TXT', txt.nazwa, r.h1, 'txt');
  const t = txt.dane.toString('utf8');
  sprawdzTresc('PL TXT', t);
  wynik('PL TXT: zrodla z adresami i etykieta "Opis meta (SEO)"', /(^|\n)Źródła\n/.test(t) && /https:\/\//.test(t) && /Opis meta \(SEO\): /.test(t));

  // Schowek i WordPress
  await s.evaluate(() => copyOut());
  await s.waitForTimeout(200);
  sprawdzTresc('PL schowek', await s.evaluate(() => window.__schowek || ''));
  wynik('PL schowek: tekst skopiowany', (await s.evaluate(() => (window.__schowek || '').length)) > 500);
  await s.evaluate(() => publishToCms('draft'));
  await s.waitForTimeout(300);
  const wpis = wp[0] || {};
  wynik('PL WordPress: wpis wyslany z tytulem = H1', wpis.title === r.h1 && typeof wpis.content === 'string', JSON.stringify(wpis).slice(0, 200));
  sprawdzTresc('PL WordPress', String(wpis.content || ''));

  // JSON-LD: tekst z artykulu nie zamyka znacznika skryptu.
  const jsonld = await s.evaluate(() => {
    const typ = document.getElementById('jsonld-type');
    if (typ) typ.value = 'faq';
    generateJsonLd();
    return document.getElementById('jsonld-code').textContent;
  });
  const zamkniec = (jsonld.match(/<\/script/gi) || []).length;
  let jsonOk = false;
  try { jsonOk = /window\.__jsonld/.test(JSON.parse(jsonld.replace(/^[^\n]*\n/, '').replace(/\n[^\n]*$/, '')).mainEntity.map((q) => q.acceptedAnswer.text).join(' ')); } catch (e) { jsonOk = false; }
  wynik('PL JSON-LD: jedno zamkniecie znacznika, JSON nadal poprawny', zamkniec === 1 && jsonOk, 'zamkniec=' + zamkniec);

  wynik('PL: bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await s.screenshot({ path: path.join(WYJSCIE, 'pl-blad.png') }).catch(() => {});
  await k.close();
}

async function scenariuszAngielski(b) {
  const wp = [];
  const { k, s, bledy } = await nowaStrona(b, wp);
  const r = await generuj(s, 'How to choose a CRM system for a small business', 'English');
  wynik('EN (interfejs PL): artykul ze zrodlami', /ready/.test(r.odznaka) && r.zrodla >= 2, JSON.stringify(r));
  const docx = await pobierz(s, () => dlDocx(), 'en');
  sprawdzNazwe('EN DOCX', docx.nazwa, r.h1, 'docx');
  const zip = czytajZip(docx.dane);
  const dok = zip['word/document.xml'].toString('utf8');
  const style = zip['word/styles.xml'].toString('utf8');
  const tekstD = tekstDocx(dok);
  wynik('EN DOCX: jezyk en-US, naglowek "Sources", daty po angielsku',
    /w:lang w:val="en-US"/.test(style) && /(^|\n)Sources\n/.test(tekstD) && /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/.test(tekstD),
    tekstD.slice(-400));
  wynik('EN DOCX: bez polskich etykiet i miesiecy', !/Źródła|Opis meta|znak(i|ów)?\b|\b\d{1,2} (sty|lut|kwi|maj|cze|lip|sie|wrz|paź|lis|gru) \d{4}/.test(tekstD));
  sprawdzTresc('EN DOCX', tekstD);
  const txt = await pobierz(s, () => dlTxt(), 'en');
  const t = txt.dane.toString('utf8');
  wynik('EN TXT: "Sources" i "Meta description (SEO)"', /(^|\n)Sources\n/.test(t) && /Meta description \(SEO\): /.test(t), t.slice(-300));
  wynik('EN: bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  await k.close();
}

(async () => {
  let b;
  try {
    b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
    await scenariuszPolski(b);
    await scenariuszAngielski(b);
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    if (b) await b.close();
  }
  console.log('\nPobrane pliki: ' + WYJSCIE);
  console.log(bledow ? 'BLEDOW: ' + bledow : 'Wszystkie scenariusze eksportu przeszly.');
  process.exit(bledow ? 1 : 0);
})();
