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
 *   - kod JSON-LD nie zamyka znacznika skryptu tekstem z artykulu;
 *   - R9-D (art. 50 AI Act, PROJEKT-TECHNICZNY rozdz. 9): oznaczenie AI w kazdym formacie - DOCX
 *     (docProps/custom.xml, cp:keywords), PDF (/Keywords i XMP z IPTC Digital Source Type), HTML do CMS
 *     (data-ai-*), JSON-LD (digitalSourceType, bez autora "Redakcja"), PNG (XMP w iTXt, plik z C2PA
 *     dostawcy nietkniety), MP3 (ID3v2.4), widoczna etykieta tekstu wedlug przelacznika (TXT, DOCX,
 *     PDF, schowek, CMS, przerobki), zapowiedz audio, pytanie przed pobraniem grafiki i komunikat
 *     przy kopiowaniu grafiki do schowka, informacja o AI pod artykulem.
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

const ZAKAZANE = ['LOGIN-W-ADRESIE', 'HASLO-W-ADRESIE', 'days ago', 'var(--', 'EKRAN-TYLKO', 'UKRYTE-DOM', 'UKRYTE-SR', 'Brak pokrycia', 'data-tylko-ekran', 'data-brak'];
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
      // R6-F (E-02): notatka z tekstem aplikacji (akapit z tekstem autora zostaje - test_dymny).
      + '<h2>Sekcja bez pokrycia</h2><p data-brak="1">' + tekstWJezyku('gap-brak-pokrycia', 'pl') + '</p>';
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

// ── R9-D: oznaczenia AI w plikach i przy publikacji ─────────────────────────
const IPTC_AI = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
const SCHEMA_AI = 'https://schema.org/TrainedAlgorithmicMediaDigitalSource';
const ETYKIETA_PL = 'Ten tekst powstał z pomocą sztucznej inteligencji (Content AI).';
const ETYKIETA_EN = 'This text was created with the help of artificial intelligence (Content AI).';

// Fragmenty PNG: [{ typ, dane, crcOk }].
function fragmentyPng(buf) {
  const lista = [];
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return lista;
  const crcTab = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcTab[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcTab[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  let p = 8;
  while (p + 12 <= buf.length) {
    const dl = buf.readUInt32BE(p), typ = buf.slice(p + 4, p + 8).toString('latin1');
    const dane = buf.slice(p + 8, p + 8 + dl);
    lista.push({ typ, dane, crcOk: crc(buf.slice(p + 4, p + 8 + dl)) === buf.readUInt32BE(p + 8 + dl) });
    p += 12 + dl;
    if (typ === 'IEND') break;
  }
  return lista;
}
// Ramki ID3v2.4 z poczatku pliku: { wersja, ramki: [{ id, dane }] }.
function ramkiId3(buf) {
  if (buf.slice(0, 3).toString('latin1') !== 'ID3') return null;
  const ss = (o) => ((buf[o] & 0x7F) << 21) | ((buf[o + 1] & 0x7F) << 14) | ((buf[o + 2] & 0x7F) << 7) | (buf[o + 3] & 0x7F);
  const koniec = 10 + ss(6), ramki = [];
  let p = 10;
  while (p + 10 <= koniec) {
    const id = buf.slice(p, p + 4).toString('latin1'); if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const dl = ss(p + 4);
    ramki.push({ id, dane: buf.slice(p + 10, p + 10 + dl) });
    p += 10 + dl;
  }
  return { wersja: buf[3], ramki, koniec };
}
function pdfPrzezPymupdfXmp(sciezka) {
  const skrypt = 'import sys, json\ntry:\n  import pymupdf as fitz\nexcept Exception:\n  try:\n    import fitz\n  except Exception:\n    print("BRAK"); sys.exit(0)\n'
    + 'd = fitz.open(sys.argv[1])\nprint(json.dumps({"meta": d.metadata, "xmp": d.get_xml_metadata(), "naprawiony": bool(getattr(d, "is_repaired", False)), "strony": d.page_count}))\n';
  const r = spawnSync('python3', ['-c', skrypt, sciezka], { encoding: 'utf8' });
  const linia = String(r.stdout || '').trim().split('\n').pop();
  if (r.status !== 0 || !linia || /^BRAK/.test(linia)) return null;
  try { return JSON.parse(linia); } catch (e) { return null; }
}

async function scenariuszOznaczenia(b) {
  const wp = [];
  const { k, s, bledy } = await nowaStrona(b, wp);
  const r = await generuj(s, 'Jak wybrać pompę ciepła do domu jednorodzinnego', 'Polski');
  wynik('AI: artykul gotowy', /ready/.test(r.odznaka), JSON.stringify(r));
  const info = await s.evaluate(() => { const i = document.getElementById('ai-info-artykul'); return { widac: !!i && !i.hidden && i.offsetHeight > 0, tekst: i ? i.textContent : '' }; });
  wynik('AI: pod artykulem informacja, ze tekst powstal z pomoca AI (art. 50 ust. 1)', info.widac && /pomocą AI/.test(info.tekst) && /metadanych/.test(info.tekst), JSON.stringify(info));
  const domyslne = await s.evaluate(() => ({ tekst: wyborOznaczenia('tekst'), grafika: wyborOznaczenia('grafika'), audio: wyborOznaczenia('audio') }));
  wynik('AI: domyslne etykiety widoczne jak w M-5/D-08 (tekst i grafika wylaczone, audio wlaczone)', !domyslne.tekst && !domyslne.grafika && domyslne.audio, JSON.stringify(domyslne));

  // 1. Etykieta wylaczona: oznaczenie maszynowe w kazdym formacie, bez zdania w tresci.
  const docx = await pobierz(s, () => dlDocx(), 'ai');
  const zip = czytajZip(docx.dane);
  const custom = (zip['docProps/custom.xml'] || Buffer.alloc(0)).toString('utf8');
  const typy = (zip['[Content_Types].xml'] || Buffer.alloc(0)).toString('utf8');
  const rels = (zip['_rels/.rels'] || Buffer.alloc(0)).toString('utf8');
  const core = (zip['docProps/core.xml'] || Buffer.alloc(0)).toString('utf8');
  const dok = (zip['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
  wynik('AI DOCX: docProps/custom.xml z AIGenerated, AISystem i DigitalSourceType (IPTC), w typach i relacjach pakietu',
    /name="AIGenerated"><vt:bool>true<\/vt:bool>/.test(custom) && /name="AISystem"><vt:lpwstr>Content AI<\/vt:lpwstr>/.test(custom)
    && custom.indexOf('<vt:lpwstr>' + IPTC_AI + '</vt:lpwstr>') >= 0 && /PartName="\/docProps\/custom.xml"/.test(typy) && /Target="docProps\/custom.xml"/.test(rels), custom.slice(0, 300));
  wynik('AI DOCX: cp:keywords "AI-generated" z nazwa narzedzia', /<cp:keywords>AI-generated; trainedAlgorithmicMedia; Content AI<\/cp:keywords>/.test(core), core.slice(0, 300));
  wynik('AI DOCX: bez widocznej etykiety, gdy przelacznik wylaczony', tekstDocx(dok).indexOf(ETYKIETA_PL) < 0);

  await s.evaluate(() => new Promise((ok) => zaladujPdfMake(ok)));
  await s.evaluate(() => { const org = pdfMake.createPdf; pdfMake.createPdf = function (dd) { window.__dd = JSON.parse(JSON.stringify(dd)); return org.apply(this, arguments); }; });
  const pdf = await pobierz(s, () => dlPdf(), 'ai');
  const pdfTekst = pdf.dane.toString('latin1');
  const dd = await s.evaluate(() => window.__dd);
  wynik('AI PDF: /Keywords "AI-generated" i DigitalSourceType w informacjach dokumentu', !!dd && dd.info && /AI-generated/.test(dd.info.keywords || '') && dd.info.DigitalSourceType === IPTC_AI
    && /\/Keywords\s*(\(|<|\d+ 0 R)/.test(pdfTekst) && /\/DigitalSourceType\s*(\(|<|\d+ 0 R)/.test(pdfTekst), dd && JSON.stringify(dd.info));
  wynik('AI PDF: pakiet XMP (/Metadata, IPTC Digital Source Type, CreatorTool) dopisany aktualizacja przyrostowa',
    /\/Type \/Metadata \/Subtype \/XML/.test(pdfTekst) && pdfTekst.indexOf('Iptc4xmpExt:DigitalSourceType="' + IPTC_AI + '"') >= 0 && /xmp:CreatorTool="Content AI"/.test(pdfTekst)
    && /\/Metadata \d+ 0 R/.test(pdfTekst) && /\/Prev \d+/.test(pdfTekst) && /%%EOF\s*$/.test(pdfTekst));
  const fitz = pdfPrzezPymupdfXmp(pdf.sciezka);
  if (fitz) {
    wynik('AI PDF (pymupdf): plik czytelny bez naprawy, slowa kluczowe i XMP z kodem IPTC',
      !fitz.naprawiony && fitz.strony > 0 && /AI-generated/.test((fitz.meta || {}).keywords || '') && (fitz.xmp || '').indexOf(IPTC_AI) >= 0, JSON.stringify(fitz).slice(0, 300));
  } else {
    console.log('info  AI PDF: pymupdf niedostepny - XMP sprawdzony w bajtach pliku');
  }
  wynik('AI PDF: bez widocznej etykiety, gdy przelacznik wylaczony', JSON.stringify(dd || {}).indexOf(ETYKIETA_PL) < 0);
  // KOD8-35 (prosba F): tytul ze stopki i marka z naglowka bez emoji - kroje PDF ich nie maja (pusty znak w pliku).
  const rama = await s.evaluate(() => {
    const marka = window.nazwaMarki;
    window.nazwaMarki = () => 'Kawiarnia \u2615 Mała';
    try {
      const d = dokumentPdf([], '\u{1F525} Oferta \u{1F1F5}\u{1F1F1} na zimę 1\uFE0F\u20E3', '', 'pl-PL');
      return { stopka: d.footer(1, 2).columns[0].text, naglowek: d.header().stack[0].text, tytul: d.info.title };
    } finally { window.nazwaMarki = marka; }
  });
  wynik('PDF: tytul w stopce i marka w naglowku bez emoji (litery zostaja), w metadanych tytul bez zmian',
    rama.stopka === 'Oferta na zimę 1' && rama.naglowek === 'Kawiarnia Mała' && /\u{1F525}/u.test(rama.tytul), JSON.stringify(rama));

  const txt = (await pobierz(s, () => dlTxt(), 'ai')).dane.toString('utf8');
  wynik('AI TXT: bez etykiety, gdy przelacznik wylaczony', txt.indexOf(ETYKIETA_PL) < 0);
  await s.evaluate(() => { window.__schowek = ''; copyOut(); });
  await s.waitForTimeout(200);
  wynik('AI schowek: bez etykiety, gdy przelacznik wylaczony', (await s.evaluate(() => window.__schowek || '')).indexOf(ETYKIETA_PL) < 0);
  await s.evaluate(() => { openWpPublish(); publishToCms('draft'); });
  await s.waitForTimeout(400);
  const wpis = String((wp[0] || {}).content || '');
  wynik('AI WordPress: tresc wpisu w <div data-ai-generated data-ai-system data-ai-source-type> (IPTC)',
    wpis.indexOf('<div data-ai-generated="true" data-ai-system="Content AI" data-ai-source-type="' + IPTC_AI + '">') === 0 && /<\/div>$/.test(wpis), wpis.slice(0, 160));
  const okno = await s.evaluate(() => ({ przelacznik: !!document.getElementById('ozn-tekst-cms') && !document.getElementById('ozn-tekst-cms').closest('.ozn-wiersz').hidden,
    przypomnienie: (document.getElementById('ozn-cms-przypomnienie') || {}).textContent || '' }));
  wynik('AI CMS: w oknie publikacji przelacznik etykiety i przypomnienie o art. 50 ust. 4', okno.przelacznik && /sprawach publicznych/.test(okno.przypomnienie) && /Więcej/.test(okno.przypomnienie), JSON.stringify(okno));
  wynik('AI WordPress: bez etykiety, gdy przelacznik wylaczony', wpis.indexOf(ETYKIETA_PL) < 0 && wpis.indexOf('data-ai-label') < 0);
  await s.evaluate(() => closeWpPublishModal());

  const ld = await s.evaluate(() => { const t = document.getElementById('jsonld-type'); if (t) t.value = 'article'; generateJsonLd(); return document.getElementById('jsonld-code').textContent; });
  let schema = {};
  try { schema = JSON.parse(ld.replace(/^[^\n]*\n/, '').replace(/\n[^\n]*$/, '')); } catch (e) { schema = {}; }
  wynik('AI JSON-LD: digitalSourceType schema.org i bez domyslnego autora "Redakcja" (PR8-20)',
    schema.digitalSourceType === SCHEMA_AI && ld.indexOf('Redakcja') < 0 && !(schema.author && schema.author['@type'] === 'Person' && /Redakcja/.test(schema.author.name || '')), ld.slice(0, 300));

  // 2. Etykieta wlaczona: zdanie w jezyku artykulu na koncu tekstu, przed zrodlami.
  await s.evaluate(() => ustawWyborOznaczenia('tekst', true));
  const przelaczniki = await s.evaluate(() => [...document.querySelectorAll('[data-oznaczenie="tekst"]')].map((x) => x.type === 'checkbox' ? x.checked : x.getAttribute('aria-checked') === 'true'));
  wynik('AI: jeden stan przelacznika tekstu w eksporcie, publikacji i przerobkach', przelaczniki.length >= 3 && przelaczniki.every(Boolean), JSON.stringify(przelaczniki));
  // Pliki maja polski sklad (twarde spacje po jednoliterowych wyrazach, R6-F E-18): porownujemy jak zwykle spacje.
  const bezTwardych = (t) => String(t).replace(/\u00a0/g, ' ');
  const txt2 = bezTwardych((await pobierz(s, () => dlTxt(), 'ai-etykieta')).dane.toString('utf8'));
  const pozEt = txt2.indexOf(ETYKIETA_PL), pozZr = txt2.search(/(^|\n)Źródła\n/);
  wynik('AI TXT: etykieta wlaczona - zdanie na koncu tekstu, przed zrodlami', pozEt > 0 && (pozZr < 0 || pozEt < pozZr), txt2.slice(Math.max(0, pozEt - 80), pozEt + 120));
  const zip2 = czytajZip((await pobierz(s, () => dlDocx(), 'ai-etykieta')).dane);
  const dok2 = zip2['word/document.xml'].toString('utf8');
  wynik('AI DOCX: etykieta wlaczona - akapit ze stylem OznaczenieAI', bezTwardych(tekstDocx(dok2)).indexOf(ETYKIETA_PL) >= 0 && /w:pStyle w:val="OznaczenieAI"/.test(dok2)
    && /w:styleId="OznaczenieAI"/.test(zip2['word/styles.xml'].toString('utf8')));
  await pobierz(s, () => dlPdf(), 'ai-etykieta');
  const dd2 = await s.evaluate(() => window.__dd);
  wynik('AI PDF: etykieta wlaczona - akapit z etykieta w tresci dokumentu', bezTwardych(JSON.stringify(dd2 || {})).indexOf(ETYKIETA_PL) >= 0);
  await s.evaluate(() => { window.__schowek = ''; copyOut(); });
  await s.waitForTimeout(200);
  wynik('AI schowek: etykieta wlaczona - zdanie w kopiowanym tekscie', bezTwardych(await s.evaluate(() => window.__schowek || '')).indexOf(ETYKIETA_PL) >= 0);
  await s.evaluate(() => { openWpPublish(); publishToCms('draft'); });
  await s.waitForTimeout(400);
  const wpis2 = String((wp[1] || {}).content || '');
  wynik('AI WordPress: etykieta wlaczona - <p class="oznaczenie-ai" data-ai-label="true"> w opakowaniu data-ai-*',
    /<p class="oznaczenie-ai" data-ai-label="true">Ten tekst powstał z pomocą sztucznej inteligencji \(Content AI\)\.<\/p>/.test(wpis2) && wpis2.indexOf('<div data-ai-generated="true"') === 0, wpis2.slice(-260));
  await s.evaluate(() => closeWpPublishModal());
  const zywy = await s.evaluate(() => document.getElementById('article').querySelectorAll('.oznaczenie-ai, [data-ai-label]').length + (history[0] && /oznaczenie-ai/.test(history[0].html || '') ? 10 : 0));
  wynik('AI: etykieta tylko w kopii dla klienta, nie w zywym artykule ani w Historii', zywy === 0, String(zywy));
  const rp = await s.evaluate(() => [przerobkaZOznaczeniemAI('Post na LinkedIn.'), (ustawWyborOznaczenia('tekst', false), przerobkaZOznaczeniemAI('Post na LinkedIn.'))]);
  wynik('AI przerobki: krotka etykieta przy kopiowaniu tylko z wlaczonym przelacznikiem', /Post na LinkedIn\.\n\nPrzygotowano z pomocą AI\.$/.test(rp[0]) && rp[1] === 'Post na LinkedIn.', JSON.stringify(rp));

  // 3. Tekst uzytkownika przerobiony przez AI ("Popraw wklejony tekst"): kod tresci zlozonej (PR8-18).
  const zlozone = await s.evaluate(() => { kontekstArt.ai = nowePochodzenieAI('zlozone'); const w = wlasciwosciAI(); const k = kopiaDoEksportu(document.getElementById('article'), 'cms');
    const r = { docx: w && w.zrodlo, cms: k.getAttribute('data-ai-source-type') }; kontekstArt.ai = nowePochodzenieAI('ai'); return r; });
  wynik('AI: tekst uzytkownika przerobiony przez AI - compositeWithTrainedAlgorithmicMedia we wlasciwosciach i w CMS',
    /compositeWithTrainedAlgorithmicMedia$/.test(zlozone.docx || '') && /compositeWithTrainedAlgorithmicMedia$/.test(zlozone.cms || ''), JSON.stringify(zlozone));

  // 4. PNG: XMP w iTXt po IHDR; plik z manifestem C2PA dostawcy (caBX) zostaje bajt w bajt.
  const png = await s.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d'); g.fillStyle = 'rgb(20, 120, 200)'; g.fillRect(0, 0, 64, 48);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    const zwykly = new Uint8Array(await blob.arrayBuffer());
    const w = oznaczPng(zwykly);
    // Ten sam plik z fragmentem caBX (manifest C2PA) zaraz po IHDR.
    const dlIhdr = 8 + 12 + 13;
    const ca = new Uint8Array(zwykly.length + 16);
    ca.set(zwykly.subarray(0, dlIhdr), 0);
    ca.set([0, 0, 0, 4, 0x63, 0x61, 0x42, 0x58, 1, 2, 3, 4, 0, 0, 0, 0], dlIhdr);
    ca.set(zwykly.subarray(dlIhdr), dlIhdr + 16);
    const wc = oznaczPng(ca);
    const b64 = (u) => { let x = ''; for (const v of u) x += String.fromCharCode(v); return btoa(x); };
    return { oznaczony: b64(w.bajty), powod: w.powod, c2pa: wc.powod, c2paTenSam: wc.bajty === ca, drugi: oznaczPng(w.bajty).powod };
  });
  const frag = fragmentyPng(Buffer.from(png.oznaczony, 'base64'));
  const xmp = frag.filter((f) => f.typ === 'iTXt' && f.dane.slice(0, 17).toString('latin1') === 'XML:com.adobe.xmp')[0];
  wynik('AI PNG: XMP (iTXt XML:com.adobe.xmp) zaraz po IHDR, z IPTC Digital Source Type i poprawna suma CRC',
    png.powod === 'xmp-dodany' && frag[0] && frag[0].typ === 'IHDR' && frag[1] === xmp && !!xmp && xmp.crcOk
    && xmp.dane.toString('utf8').indexOf('Iptc4xmpExt:DigitalSourceType="' + IPTC_AI + '"') >= 0 && frag.every((f) => f.crcOk), JSON.stringify(frag.map((f) => f.typ)));
  wynik('AI PNG: plik z manifestem C2PA dostawcy nietkniety, drugie oznaczenie nie dubluje XMP', png.c2pa === 'c2pa-dostawcy' && png.c2paTenSam && png.drugi === 'xmp-jest', JSON.stringify({ c2pa: png.c2pa, drugi: png.drugi }));

  // Pobranie grafiki: przy wylaczonym napisie pytanie o realne osoby, miejsca i zdarzenia (D-08).
  await s.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = 'rgb(240, 240, 235)'; g.fillRect(0, 0, 320, 200);
    window.__grafika = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  });
  const [pobranaBez] = await Promise.all([
    s.waitForEvent('download', { timeout: 15000 }),
    (async () => {
      await s.evaluate(() => { window.__zapytanie = pobierzGrafikeZOznaczeniem(window.__grafika, 'grafika-test.png'); });
      await s.waitForSelector('#ozn-grafika-modal.open', { timeout: 5000 });
      await s.click('#ozn-grafika-modal .btn-secondary');
    })(),
  ]);
  const plikBez = fs.readFileSync(await pobranaBez.path());
  const fragBez = fragmentyPng(plikBez);
  wynik('AI grafika: pytanie przed pobraniem, "Nie" = plik bez napisu z XMP', fragBez.some((f) => f.typ === 'iTXt' && f.dane.toString('utf8').indexOf(IPTC_AI) >= 0), JSON.stringify(fragBez.map((f) => f.typ)));
  const [pobranaZ] = await Promise.all([
    s.waitForEvent('download', { timeout: 15000 }),
    s.evaluate(() => { ustawWyborOznaczenia('grafika', true); return pobierzGrafikeZOznaczeniem(window.__grafika, 'grafika-napis.png'); }),
  ]);
  const plikZ = fs.readFileSync(await pobranaZ.path());
  const fragZ = fragmentyPng(plikZ);
  const pytanieDrugi = await s.evaluate(() => document.getElementById('ozn-grafika-modal').classList.contains('open'));
  wynik('AI grafika: napis wlaczony - nowy plik (napis w rogu) z XMP, bez pytania', !pytanieDrugi && !plikZ.equals(plikBez)
    && fragZ.some((f) => f.typ === 'iTXt' && f.dane.toString('utf8').indexOf(IPTC_AI) >= 0) && fragZ.every((f) => f.crcOk));
  await s.evaluate(() => ustawWyborOznaczenia('grafika', false));
  const schowekGrafiki = await s.evaluate(async () => {
    document.querySelectorAll('.powiadomienie').forEach((p) => p.remove());
    navigator.clipboard.write = () => Promise.resolve();
    if (!document.getElementById('img-copy-btn')) { const b = document.createElement('button'); b.id = 'img-copy-btn'; document.body.appendChild(b); }
    imgCurrentBlob = window.__grafika;
    await imgCopyResult();
    return [...document.querySelectorAll('.powiadomienie')].map((p) => p.textContent).join(' | ');
  });
  wynik('AI grafika: kopia do schowka - komunikat, ze kopia nie niesie oznaczenia (D-07)', /Kopia w schowku nie zawiera oznaczenia AI/.test(schowekGrafiki), schowekGrafiki);

  // 5. MP3: ID3v2.4 na poczatku sklejonego pliku, znaczniki fragmentow zdjete; zapowiedz glosowa.
  const mp3 = await s.evaluate(async () => {
    const id3 = (tresc) => new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4].concat([0x54, 0x58, 0x58, 0x58].slice(0, 4)));
    const ramka = new Uint8Array([0xFF, 0xFB, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8]);
    const czesc = (n) => new Blob([id3(), ramka, new Uint8Array([n])], { type: 'audio/mpeg' });
    const wynikBlob = await zbudujMp3([czesc(1), czesc(2)], { jezyk: 'pl', tytul: 'Pompa ciepła' });
    const u = new Uint8Array(await wynikBlob.arrayBuffer());
    let x = ''; for (const v of u) x += String.fromCharCode(v);
    return { b64: btoa(x), typ: wynikBlob.type };
  });
  const bufMp3 = Buffer.from(mp3.b64, 'base64');
  const tag = ramkiId3(bufMp3);
  const txxx = (tag ? tag.ramki : []).filter((r) => r.id === 'TXXX').map((r) => r.dane.slice(1).toString('utf8'));
  const tekstRamki = (id) => { const r = (tag ? tag.ramki : []).filter((x) => x.id === id)[0]; return r ? r.dane.slice(1).toString('utf8') : ''; };
  const comm = (tag ? tag.ramki : []).filter((r) => r.id === 'COMM')[0];
  wynik('AI MP3: ID3v2.4 z TXXX AI_GENERATED i DIGITAL_SOURCE_TYPE (IPTC), TSSE Content AI, tytul i COMM o syntetycznym glosie',
    mp3.typ === 'audio/mpeg' && !!tag && tag.wersja === 4 && txxx.indexOf('AI_GENERATED\u0000true') >= 0 && txxx.indexOf('DIGITAL_SOURCE_TYPE\u0000' + IPTC_AI) >= 0
    && tekstRamki('TSSE') === 'Content AI' && tekstRamki('TIT2') === 'Pompa ciepła' && !!comm && /syntetyczny głos/.test(comm.dane.toString('utf8')), JSON.stringify(txxx));
  const reszta = tag ? bufMp3.slice(tag.koniec) : Buffer.alloc(0);
  wynik('AI MP3: znaczniki ID3 fragmentow od dostawcy zdjete (jeden znacznik na poczatku pliku)', reszta.indexOf('ID3') < 0 && reszta.length === 2 * 13, String(reszta.length));
  const zapowiedz = await s.evaluate(() => [zZapowiedziaAI([{ speaker: 0, text: 'Dzień dobry.' }], 'pl')[0].text, (ustawWyborOznaczenia('audio', false), zZapowiedziaAI([{ speaker: 0, text: 'Dzień dobry.' }], 'pl')[0].text)]);
  await s.evaluate(() => ustawWyborOznaczenia('audio', true));
  wynik('AI audio: zapowiedz "syntetyczny glos" na poczatku nagrania (domyslnie wlaczona), bez niej po wylaczeniu',
    /^Ten materiał odczytuje syntetyczny głos wygenerowany przez sztuczną inteligencję\. Dzień dobry\.$/.test(zapowiedz[0]) && zapowiedz[1] === 'Dzień dobry.', JSON.stringify(zapowiedz));

  wynik('AI: bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  if (bledow) await s.screenshot({ path: path.join(WYJSCIE, 'ai-blad.png') }).catch(() => {});
  await k.close();
}

// Artykul angielski: etykieta w jezyku tresci, nie interfejsu.
async function scenariuszOznaczeniaEn(b) {
  const { k, s, bledy } = await nowaStrona(b, []);
  await generuj(s, 'How to choose a heat pump for a family home', 'English');
  await s.evaluate(() => ustawWyborOznaczenia('tekst', true));
  const txt = (await pobierz(s, () => dlTxt(), 'ai-en')).dane.toString('utf8').replace(/\u00a0/g, ' ');
  wynik('AI EN TXT: etykieta w jezyku artykulu (EN) przy interfejsie PL', txt.indexOf(ETYKIETA_EN) > 0 && txt.indexOf(ETYKIETA_PL) < 0, txt.slice(-400));
  wynik('AI EN: bez bledow JavaScript', !bledy.length, bledy.join(' | '));
  await k.close();
}

(async () => {
  let b;
  try {
    b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
    await scenariuszPolski(b);
    await scenariuszAngielski(b);
    await scenariuszOznaczenia(b);
    await scenariuszOznaczeniaEn(b);
  } catch (e) {
    wynik('test przerwany wyjatkiem', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    if (b) await b.close();
  }
  console.log('\nPobrane pliki: ' + WYJSCIE);
  console.log(bledow ? 'BLEDOW: ' + bledow : 'Wszystkie scenariusze eksportu przeszly.');
  process.exit(bledow ? 1 : 0);
})();
