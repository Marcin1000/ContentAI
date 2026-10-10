#!/usr/bin/env node
'use strict';
/*
 * Test ukladu strony produktowej (showcase/) w prawdziwej przegladarce, na macierzy urzadzen.
 *
 * Kontrole tekstow i plikow (audyt_showcase.py) nie widza, jak strona sie ULOZY: rzad liczb
 * wychodzacy za ekran telefonu, karta karuzeli ucinajaca tekst w pol wiersza, pasek CTA
 * zaslaniajacy przycisk - wszystko to przechodzilo dotad CI na zielono. Ten test otwiera
 * kazda strone z showcase/sitemap.xml (lista STRONY w buduj_strone.py, jedno zrodlo) w Chromium
 * na kazdym rozmiarze z macierzy (telefon, tablet, komputer), w motywie jasnym i ciemnym,
 * po polsku i po angielsku, i sprawdza kryteria:
 *
 *   1. brak poziomego przewijania strony (scrollingElement.scrollWidth <= innerWidth),
 *   2. zaden widoczny tekst ani element interaktywny nie wychodzi poza ekran ani poza
 *      rodzica z overflow hidden/clip; nie ma tekstu uciętego bez wielokropka,
 *   3. pasek przewijany w poziomie tylko z zanikaniem na brzegu i z widocznym kawalkiem
 *      nastepnego elementu (inaczej wyglada jak blad),
 *   4. teksty nie nachodza na siebie,
 *   5. elementy fixed/sticky nie zaslaniaja sie nawzajem ani nie wchodza pod naglowek,
 *      a pole lub przycisk z fokusem nie jest zasloniety (telefon),
 *   6. cele dotyku na telefonie maja co najmniej 44 px (poza linkami w zdaniu),
 *   7. pismo co najmniej 12 px i kontrast tekstu co najmniej AA (4,5:1; duzy tekst 3:1),
 *   8. elementy jednego rzedu (karty, kafle, liczby) maja naglowki na tej samej wysokosci,
 *      a w tresci nie ma pustego pasa wyzszego niz 40% okna,
 *   9. interakcje: na kazdej szerokosci naglowek ma nawigacje po sekcjach (linki albo menu),
 *      menu otwiera sie bez przewijania strony i zamyka po wyborze, kazdy link menu
 *      (i nawigacji na komputerze) prowadzi do sekcji z tytulem pod naglowkiem strony, a pasek
 *      akcji na telefonie jest ukryty w hero, przy zakonczeniu strony (#start z wlasnym
 *      przyciskiem), przy stopce i przy przewijaniu w gore.
 *  10. telefon 412x700 z pismem powiekszonym o 20% (ustawienie rozmiaru tekstu w przegladarce):
 *      kontrole 1-8 (bez poziomego przewijania i bez uciec) na stronie glownej i podstronach
 *      z tabelami.
 *
 * Kryteria 1-9 wziete z rundy 3 (zlecenie koordynatora, pkt 2) i ze skryptu audytowego
 * agencja-strona-frontend (r3/uklad-strony.js), ktory zostaje niezaleznym audytem krzyzowym.
 *
 * Uzycie (z katalogu repozytorium):
 *   npm install --no-save playwright && npx playwright install chromium
 *   node narzedzia/test_uklad_strony.js
 * Zmienne:
 *   CAI_CHROMIUM          sciezka do Chromium (domyslnie z Playwright)
 *   CAI_UKLAD_BAZA        adres gotowej strony (domyslnie: wlasny serwer plikow showcase/)
 *   CAI_UKLAD_ROZMIARY    np. "412x700,1440x900" - tylko te rozmiary
 *   CAI_UKLAD_PELNY=1     cala macierz: 16 rozmiarow x wszystkie strony x 2 motywy (domyslnie tryb szybki do CI:
 *                         320, 390, 412x700, 768, 1280x720, 1440, 2560; PL i EN; ciemny i podstrony przy 390 i 1440)
 *   CAI_UKLAD_ROWNOLEGLE  ile kart naraz (domyslnie 3)
 *   CAI_TEST_ZRZUTY       katalog na zrzuty ekranu przy bledzie
 * Kod wyjscia: 0 gdy wszystko przeszlo, 1 gdy cokolwiek nie.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const REPO = path.resolve(__dirname, '..');
const SHOWCASE = path.join(REPO, 'showcase');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Brak pakietu playwright: npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }

// Macierz z rundy 3 (zlecenie koordynatora, pkt 2). 412x700 = telefon Marcina (Samsung Internet).
const MACIERZ = [
  [320, 568], [360, 640], [360, 800], [390, 844], [412, 700], [412, 915], [430, 932],
  [768, 1024], [820, 1180], [1024, 768],
  [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440],
];
const TELEFON = 600;          // ponizej: kontekst mobilny (dotyk), cele dotyku 44 px
const ZRZUTY = process.env.CAI_TEST_ZRZUTY || path.join(os.tmpdir(), 'cai-test-uklad');

// Tryb szybki (domyslny, CI, ok. 2-3 min): rozsadny podzbior macierzy; EN i PL wszedzie, ciemny motyw i podstrony
// przy 390 i 1440, pismo 120% przy 412x700. CAI_UKLAD_PELNY=1: cala macierz x wszystkie strony x 2 motywy.
const SZYBKA = [[320, 568], [390, 844], [412, 700], [768, 1024], [1280, 720], [1440, 900], [2560, 1440]];
const PELNY = process.env.CAI_UKLAD_PELNY === '1';

function rozmiary() {
  const filtr = (process.env.CAI_UKLAD_ROZMIARY || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!filtr.length) return PELNY ? MACIERZ : SZYBKA;
  return filtr.map(s => s.split('x').map(Number));
}

// Strony z mapy witryny (buduj_strone.py zapisuje ja z listy STRONY), wiec nowa podstrona trafia do testu sama.
function sciezkiStron() {
  const mapa = fs.readFileSync(path.join(SHOWCASE, 'sitemap.xml'), 'utf8');
  const sciezki = [...mapa.matchAll(/<loc>https:\/\/content-ai\.net(\/[^<]*)<\/loc>/g)].map(m => m[1]);
  if (!sciezki.includes('/') || !sciezki.includes('/en/')) throw new Error('showcase/sitemap.xml bez strony glownej PL i EN');
  return sciezki;
}
// Podstrony z tabelami i dlugimi listami: sprawdzane tez z pismem powiekszonym o 20%.
const Z_TABELAMI = ['/klucz-api/', '/ai-act/', '/prywatnosc/'];

// Lista zadan: [rozmiar, motyw, sciezka, skala pisma, czy interakcje]
function zadania() {
  const lista = [];
  const strony = sciezkiStron();
  for (const [w, h] of rozmiary()) {
    const wazny = PELNY || w === 390 || w === 1440;
    for (const sciezka of strony) {
      const glowna = sciezka === '/' || sciezka === '/en/';
      if (!glowna && !wazny) continue;
      for (const motyw of ['light', 'dark']) {
        if (motyw === 'dark' && !wazny) continue;
        // interakcje: strona glowna PL na kazdym rozmiarze, EN przy 390 i 1440 (w trybie pelnym wszedzie), raz na motyw jasny
        const interakcje = motyw === 'light' && glowna && (sciezka === '/' || wazny);
        lista.push([[w, h], motyw, sciezka, 0, interakcje]);
      }
    }
    // telefon Marcina z pismem powiekszonym o 20% (strona glowna i podstrony z tabelami)
    if (w === 412 && h === 700) for (const sciezka of ['/', ...Z_TABELAMI.filter(x => strony.includes(x))]) lista.push([[w, h], 'light', sciezka, 1.2, false]);
  }
  return lista;
}

// --- serwer plikow showcase/ (bez zaleznosci; jak file_server w Caddy) ---
const TYPY = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
function serwerPlikow() {
  return new Promise(ok => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const plik = path.join(SHOWCASE, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!plik.startsWith(SHOWCASE) || !fs.existsSync(plik) || fs.statSync(plik).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream' });
      fs.createReadStream(plik).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

let bledow = 0;
function wynik(nazwa, problemy) {
  if (!problemy.length) { console.log('ok    ' + nazwa); return; }
  bledow++;
  console.log('BLAD  ' + nazwa + '  (' + problemy.length + ')');
  for (const p of problemy.slice(0, Number(process.env.CAI_UKLAD_POKAZ) || 12)) console.log('        ' + p);
  if (problemy.length > (Number(process.env.CAI_UKLAD_POKAZ) || 12)) console.log('        ... i jeszcze ' + (problemy.length - (Number(process.env.CAI_UKLAD_POKAZ) || 12)));
}

/* ======================= kontrole w przegladarce ======================= */

// Uruchamiane w stronie. Zwraca liste opisow problemow (napisy).
function kontroleUkladu(opcje) {
  const W = document.documentElement.clientWidth;
  const problemy = [];
  const opis = e => {
    const t = (e.getAttribute('aria-label') || e.textContent || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (t ? ' „' + t + '"' : '');
  };
  const styl = e => getComputedStyle(e);
  const widoczny = e => {
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      const s = styl(x);
      if (x.hidden || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || parseFloat(s.opacity) === 0) return false;
      if (x.parentElement && x.parentElement.tagName === 'DETAILS' && !x.parentElement.open && x.tagName !== 'SUMMARY') return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // celowo poza ekranem albo ukryte do czasu uzycia
  const POMIN = '.sr, .sprite, .pulapka, .skip, .dymek, svg, #menu-panel[hidden]';
  const maTekst = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const INTER = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const elementy = [...document.body.querySelectorAll('*')].filter(e => !e.closest(POMIN) && widoczny(e));
  const tekstowe = elementy.filter(maTekst);
  const interaktywne = elementy.filter(e => e.matches(INTER));

  // 1. poziome przewijanie strony
  const se = document.scrollingElement;
  if (se.scrollWidth > innerWidth + 0.5) problemy.push('strona przewija sie w poziomie: scrollWidth ' + se.scrollWidth + ' > ' + innerWidth);

  const przewijanyPrzodek = e => {
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const s = styl(x);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && x.scrollWidth > x.clientWidth + 1) return x;
    }
    return null;
  };

  // 3. paski przewijane w poziomie: zanikanie na brzegu i widoczny kawalek nastepnego elementu
  const paski = new Set();
  for (const x of document.body.querySelectorAll('*')) {
    const s = styl(x);
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && x.scrollWidth > x.clientWidth + 1 && widoczny(x)) paski.add(x);
  }
  for (const x of paski) {
    const s = styl(x), maska = s.maskImage || s.webkitMaskImage || 'none';
    if (maska === 'none') problemy.push('pasek przewijany w poziomie bez zanikania na brzegu: ' + opis(x));
    const r = x.getBoundingClientRect();
    const dzieci = [...x.children].filter(widoczny);
    const pierwszyZa = dzieci.find(d => d.getBoundingClientRect().right > r.right + 1);
    if (pierwszyZa && pierwszyZa.getBoundingClientRect().left > r.right - 24)
      problemy.push('pasek przewijany: nastepny element nie wystaje (nie widac, ze mozna przewinac): ' + opis(x));
  }

  // 2. poza ekranem, uciete przez rodzica, tekst uciety bez wielokropka
  for (const e of new Set([...tekstowe, ...interaktywne])) {
    const r = e.getBoundingClientRect();
    if (!przewijanyPrzodek(e) && (r.left < -1 || r.right > W + 1)) problemy.push('poza ekranem (' + Math.round(r.left) + '..' + Math.round(r.right) + ' przy ' + W + '): ' + opis(e));
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const s = styl(x);
      if (paski.has(x)) break;
      const tnieX = s.overflowX === 'hidden' || s.overflowX === 'clip', tnieY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if (!tnieX && !tnieY) continue;
      const rx = x.getBoundingClientRect();
      const bl = parseFloat(s.borderLeftWidth), br = parseFloat(s.borderRightWidth), bt = parseFloat(s.borderTopWidth), bb = parseFloat(s.borderBottomWidth);
      if (tnieX && (r.left < rx.left + bl - 1 || r.right > rx.right - br + 1)) { problemy.push('uciete w poziomie przez ' + opis(x) + ': ' + opis(e)); break; }
      if (tnieY && (r.top < rx.top + bt - 1 || r.bottom > rx.bottom - bb + 1)) { problemy.push('uciete w pionie przez ' + opis(x) + ': ' + opis(e)); break; }
    }
    const s = styl(e);
    if (maTekst(e) && e.clientWidth > 0) {
      if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis')
        problemy.push('tekst uciety bez wielokropka: ' + opis(e));
      if ((s.overflowY === 'hidden' || s.overflowY === 'clip') && e.scrollHeight > e.clientHeight + 2 && s.webkitLineClamp === 'none')
        problemy.push('tekst uciety w pionie: ' + opis(e));
    }
  }

  // 4. teksty nachodzace na siebie (rozne bloki tekstu, kazdy wiersz osobno)
  const blok = e => { let x = e; while (x && styl(x).display === 'inline') x = x.parentElement; return x; };
  const nieruchome = e => { for (let x = e; x && x !== document.body; x = x.parentElement) { const p = styl(x).position; if (p === 'fixed' || p === 'sticky') return x; } return null; };
  const wiersze = tekstowe.filter(e => !nieruchome(e)).map(e => ({ e, b: blok(e), r: [...e.getClientRects()].filter(q => q.width > 1 && q.height > 1) }));
  let nalozen = 0;
  for (let i = 0; i < wiersze.length && nalozen < 20; i++) for (let j = i + 1; j < wiersze.length; j++) {
    const A = wiersze[i], B = wiersze[j];
    if (A.b === B.b || A.e.contains(B.e) || B.e.contains(A.e)) continue;
    let kolizja = false;
    for (const a of A.r) { for (const b of B.r) {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && w * h > 0.25 * Math.min(a.width * a.height, b.width * b.height)) { kolizja = true; break; }
    } if (kolizja) break; }
    if (kolizja) { problemy.push('teksty nachodza na siebie: ' + opis(A.e) + ' / ' + opis(B.e)); nalozen++; }
  }

  // 6. cele dotyku na telefonie (linki w zdaniu sa wylaczone, jak w WCAG 2.5.8)
  if (opcje.telefon) {
    for (const e of interaktywne) {
      if (e.closest('[aria-hidden="true"]')) continue;
      const s = styl(e);
      const wZdaniu = s.display === 'inline' && blok(e) && blok(e).textContent.trim().length > (e.textContent || '').trim().length + 2;
      if (wZdaniu) continue;
      let r = e.getBoundingClientRect();
      if (e.matches('input[type="checkbox"], input[type="radio"]')) { const l = e.closest('label') || document.querySelector('label[for="' + e.id + '"]'); if (l) r = l.getBoundingClientRect(); }
      if (r.height < 43.5 || r.width < 43.5) problemy.push('cel dotyku ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' px (min. 44): ' + opis(e));
    }
  }

  // 7. pismo >= 12 px i kontrast AA
  const rgba = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const nad = (g, d) => [g[0] * g[3] + d[0] * (1 - g[3]), g[1] * g[3] + d[1] * (1 - g[3]), g[2] * g[3] + d[2] * (1 - g[3]), 1];
  const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const tlo = e => {
    const warstwy = [];
    for (let x = e; x; x = x.parentElement) { const c = rgba(styl(x).backgroundColor); if (c[3] > 0) warstwy.push(c); if (c[3] >= 0.999) break; }
    let wynikT = rgba(styl(document.body).backgroundColor); if (wynikT[3] < 1) wynikT = [255, 255, 255, 1];
    for (let k = warstwy.length - 1; k >= 0; k--) wynikT = nad(warstwy[k], wynikT);
    return wynikT;
  };
  for (const e of tekstowe) {
    const s = styl(e), fs = parseFloat(s.fontSize);
    if (fs < 11.95) problemy.push('pismo ' + fs + ' px (min. 12): ' + opis(e));
    if (e.closest('[aria-hidden="true"], [disabled], fieldset[disabled]')) continue;
    let przezr = 1; for (let x = e; x; x = x.parentElement) przezr *= parseFloat(styl(x).opacity);
    const t = tlo(e), kolor = nad([...rgba(s.color).slice(0, 3), rgba(s.color)[3] * przezr], t);
    const L1 = lum(kolor), L2 = lum(t), k = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const duzy = fs >= 23.95 || (fs >= 18.6 && parseInt(s.fontWeight, 10) >= 700);
    if (k < (duzy ? 3 : 4.5) - 0.01) problemy.push('kontrast ' + k.toFixed(2) + ':1 (min. ' + (duzy ? 3 : 4.5) + '): ' + opis(e));
  }
  return problemy;
}

// 5a. Elementy fixed/sticky: nie zaslaniaja sie nawzajem i nie wchodza pod naglowek. Wolane w kilku miejscach przewiniecia.
function kontroleNieruchomych() {
  const problemy = [];
  const widoczny = e => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const nav = document.getElementById('nav');
  const navR = nav && nav.getBoundingClientRect();
  // sticky liczy sie tylko wtedy, gdy jest przyklejony; przy koncu swojej sekcji normalnie odjezdza pod naglowek
  const przyklejony = e => { const s = getComputedStyle(e); if (s.position === 'fixed') return true; const t = parseFloat(s.top); return !isNaN(t) && Math.abs(e.getBoundingClientRect().top - t) < 1.5; };
  const nieruchome = [...document.querySelectorAll('body *')].filter(e => { const p = getComputedStyle(e).position; return (p === 'fixed' || p === 'sticky') && widoczny(e) && przyklejony(e); })
    .filter((e, i, lista) => !lista.some(o => o !== e && o.contains(e)));
  for (let i = 0; i < nieruchome.length; i++) for (let j = i + 1; j < nieruchome.length; j++) {
    const a = nieruchome[i].getBoundingClientRect(), b = nieruchome[j].getBoundingClientRect();
    const fa = getComputedStyle(nieruchome[i]).position === 'fixed', fb = getComputedStyle(nieruchome[j]).position === 'fixed';
    if (!(fa || fb || nieruchome[i] === nav || nieruchome[j] === nav)) continue; // dwa przyklejone bloki tresci w roznych sekcjach
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)
      problemy.push('elementy przyklejone nachodza na siebie przy scrollY=' + Math.round(scrollY) + ': ' + nieruchome[i].className + ' / ' + nieruchome[j].className);
  }
  return problemy;
}

// 5b. Telefon: pole lub przycisk z fokusem nie moze byc zasloniety przez naglowek ani pasek akcji.
async function kontroleFokusu() {
  const problemy = [];
  const klatka = () => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const sel = 'main a[href], main button, main input:not([type="hidden"]):not([tabindex="-1"]), main select, main textarea, main summary, main [tabindex="0"], footer a[href]';
  // tresc zwinietego <details> (np. link w odpowiedzi FAQ) nie dostaje fokusu klawiatura, wiec jej nie sprawdzamy
  const widoczny = e => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const s = getComputedStyle(x); if (x.hidden || s.display === 'none' || s.visibility === 'hidden') return false; if (x.parentElement && x.parentElement.tagName === 'DETAILS' && !x.parentElement.open && x.tagName !== 'SUMMARY') return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const lista = [...document.querySelectorAll(sel)].filter(e => !e.closest('.pulapka, [aria-hidden="true"], fieldset[disabled]') && widoczny(e));
  for (const e of lista) {
    e.focus();
    await klatka(); await klatka();
    const r = e.getClientRects()[0] || e.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = r.top + Math.min(r.height / 2, 12);
    if (y < 0 || y > innerHeight) continue; // wewnatrz przewijanego paska poza widokiem - przegladarka przewija go sama
    const traf = document.elementFromPoint(x, y);
    if (traf && !(traf === e || e.contains(traf) || traf.contains(e) || (traf.closest('label') && traf.closest('label').contains(e))))
      problemy.push('element z fokusem zasloniety przez ' + (traf.closest('#nav, .pasek-cta, .nav') ? (traf.closest('#nav, .pasek-cta, .nav').className || 'nav') : traf.tagName.toLowerCase() + '.' + traf.className) + ': ' + e.tagName.toLowerCase() + ' „' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) + '"');
  }
  return problemy;
}

// 8a. Elementy jednego rzedu (karty, kafle, liczby): naglowki na tej samej wysokosci.
function kontroleRzedow() {
  const problemy = [];
  const KONTENERY = ['.problemy', '.kto', '.pakiety', '.bento', '.sec-lista', '.fk-dodatki', '.dowody', '.kroki'];
  const widoczny = e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  for (const sel of KONTENERY) for (const k of document.querySelectorAll(sel)) {
    if (!widoczny(k)) continue;
    const dzieci = [...k.children].filter(widoczny);
    const rzedy = [];
    for (const d of dzieci) {
      const top = d.getBoundingClientRect().top;
      let rz = rzedy.find(x => Math.abs(x.top - top) <= 2);
      if (!rz) { rz = { top, el: [] }; rzedy.push(rz); }
      rz.el.push(d);
    }
    for (const rz of rzedy) {
      if (rz.el.length < 2) continue;
      const naglowki = rz.el.map(d => d.querySelector('h3, b')).filter(Boolean).filter(widoczny);
      if (naglowki.length < 2) continue;
      const tops = naglowki.map(n => n.getBoundingClientRect().top);
      if (Math.max(...tops) - Math.min(...tops) > 3)
        problemy.push('rzad nierowny w ' + sel + ': naglowki na wysokosciach ' + tops.map(Math.round).join(', ') + ' („' + naglowki[0].textContent.trim().slice(0, 24) + '"...)');
    }
  }
  return problemy;
}

// 8b. Pusty pas w tresci wyzszy niz 40% okna (miedzy pierwsza a ostatnia trescia strony).
// Element przyklejony (sticky, np. scena „Jak to dziala" albo margines) jest widoczny przez cala
// wysokosc swojego rodzica, wiec jego tresc wypelnia caly ten przedzial, a nie tylko miejsce startu.
function kontrolePustych() {
  const H = innerHeight, Y = scrollY;
  const przedzialy = [];
  const tlo = getComputedStyle(document.body).backgroundColor;
  const lepkie = [...document.body.querySelectorAll('*')].filter(x => x.id !== 'nav' && getComputedStyle(x).position === 'sticky' && x.parentElement);
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('.sprite, .sr, .pulapka, .skip, .pasek-cta, #nav, .dymek')) continue;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const tekst = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const media = /^(svg|img|input|button|select|textarea|canvas|video)$/i.test(e.tagName);
    const ramka = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0 || (s.backgroundColor !== tlo && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor));
    if (!(tekst || media || ramka)) continue;
    const lepki = lepkie.find(l => l.contains(e));
    const zakres = lepki ? lepki.parentElement.getBoundingClientRect() : r;
    przedzialy.push([zakres.top + Y, zakres.bottom + Y]);
  }
  przedzialy.sort((a, b) => a[0] - b[0]);
  const problemy = [];
  let koniec = przedzialy.length ? przedzialy[0][1] : 0;
  for (const [a, b] of przedzialy) {
    if (a - koniec > 0.4 * H) problemy.push('pusty pas ' + Math.round(a - koniec) + ' px (ponad 40% okna) od y=' + Math.round(koniec));
    koniec = Math.max(koniec, b);
  }
  return problemy;
}

// 9. Interakcje na swiezej stronie (bez odslaniania sekcji - tak, jak widzi je gosc).
async function kontroleInterakcji(ctx, baza, sciezka, [w, h], telefon) {
  const problemy = [];
  const strona = await ctx.newPage();
  strona.on('pageerror', e => problemy.push('blad JS: ' + e.message));
  await strona.goto(baza + sciezka, { waitUntil: 'load' });
  await strona.evaluate(() => document.fonts && document.fonts.ready);
  const stanKotwicy = id => strona.evaluate(i => {
    const cel = document.getElementById(i); if (!cel) return null;
    const tytul = cel.querySelector('h2, h1') || cel;
    const nav = document.getElementById('nav').getBoundingClientRect();
    const menu = document.querySelector('.menu-btn');
    return { top: Math.round(tytul.getBoundingClientRect().top), dol: Math.round(nav.bottom), H: innerHeight, menu: menu ? menu.getAttribute('aria-expanded') : null };
  }, id);
  // 9a. nawigacja po sekcjach: widoczne linki w naglowku albo przycisk menu z panelem (na kazdej szerokosci jedno z dwojga)
  const tryb = await strona.evaluate(() => {
    const widac = e => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    if (widac(document.querySelector('.menu-btn'))) return 'menu';
    if ([...document.querySelectorAll('.nav-linki a')].some(widac)) return 'linki';
    return null;
  });
  if (!tryb) problemy.push('brak nawigacji po sekcjach w naglowku (ani linkow, ani przycisku menu)');
  const linki = !tryb ? [] : await strona.evaluate(m => [...document.querySelectorAll(m ? '#menu-panel a[href*="#"]' : '.nav-linki a[href*="#"]')]
    .map(a => a.getAttribute('href')).filter(h => !/#(dostep|start)$/.test(h)), tryb === 'menu');
  for (const href of linki) {
    const id = href.slice(href.indexOf('#') + 1);
    await strona.evaluate(() => window.scrollTo(0, 0)); await strona.waitForTimeout(80);
    if (tryb === 'menu') {
      await strona.click('.menu-btn'); await strona.waitForTimeout(250);
      const y = await strona.evaluate(() => Math.round(scrollY));
      if (y > 5) { problemy.push('otwarcie menu przewija strone (scrollY ' + y + ')'); break; }
      if (!await strona.isVisible('#menu-panel a[href="' + href + '"]')) { problemy.push('menu nie pokazuje linku ' + href); break; }
      await strona.click('#menu-panel a[href="' + href + '"]');
    } else {
      await strona.click('.nav-linki a[href="' + href + '"]');
    }
    await strona.waitForTimeout(900);
    const s = await stanKotwicy(id);
    if (!s) { problemy.push('link ' + href + ' bez celu na stronie'); continue; }
    if (s.top < s.dol - 1 || s.top > s.H - 40) problemy.push('po kliknieciu ' + href + ' tytul sekcji poza widokiem (gora ' + s.top + ' px, dol naglowka ' + s.dol + ' px)');
    if (tryb === 'menu' && s.menu === 'true') problemy.push('menu zostaje otwarte po kliknieciu ' + href);
  }
  if (telefon) {
    // 9b. pasek akcji: ukryty w hero, widoczny po minieciu hero przy przewijaniu w dol, ukryty przy przewijaniu w gore, przy zakonczeniu strony i stopce
    const pasek = () => strona.evaluate(() => { const p = document.getElementById('pasek-cta'); if (!p) return null; const s = getComputedStyle(p); return s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.5 && p.classList.contains('widoczny'); });
    const przewin = async (ile, krok) => { for (let i = 0; i < ile; i++) { await strona.evaluate(d => window.scrollBy(0, d), krok); await strona.waitForTimeout(40); } await strona.waitForTimeout(250); };
    await strona.evaluate(() => window.scrollTo(0, 0)); await strona.waitForTimeout(300);
    if (await pasek()) problemy.push('pasek akcji widoczny w hero');
    const doMinieciaHero = await strona.evaluate(() => { const c = document.querySelector('.hero .cta'); return c ? Math.ceil(c.getBoundingClientRect().bottom + 200) : 900; });
    await przewin(Math.ceil(doMinieciaHero / 100), 100);
    if (!await pasek()) problemy.push('pasek akcji niewidoczny po minieciu hero (przewijanie w dol)');
    await przewin(3, -40);
    if (await pasek()) problemy.push('pasek akcji widoczny przy przewijaniu w gore');
    const doKonca = await strona.evaluate(() => { const k = document.getElementById('start'); return k ? Math.round(scrollY + k.getBoundingClientRect().top + 40) : null; });
    if (doKonca === null) problemy.push('brak zakonczenia strony #start');
    else {
      await strona.evaluate(y => window.scrollTo(0, y), doKonca); await strona.waitForTimeout(400);
      if (await pasek()) problemy.push('pasek akcji widoczny przy zakonczeniu strony (#start)');
    }
    await strona.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await strona.waitForTimeout(400);
    if (await pasek()) problemy.push('pasek akcji widoczny przy stopce');
  }
  await strona.close();
  return problemy;
}

/* ======================= przebieg ======================= */

async function sprawdzStrone(przegladarka, baza, [w, h], motyw, sciezka, zFokusem, skala, interakcje) {
  const telefon = w < TELEFON;
  const ctx = await przegladarka.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: telefon, hasTouch: telefon,
    colorScheme: motyw, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const strona = await ctx.newPage();
  const problemy = [];
  strona.on('pageerror', e => problemy.push('blad JS: ' + e.message));
  await strona.goto(baza + sciezka, { waitUntil: 'load' });
  await strona.evaluate(() => document.fonts && document.fonts.ready);
  // Wejscia (.wej) i content-visibility nie zmieniaja szerokosci, ale sekcje poza oknem nie maja jeszcze ukladu - odslaniamy wszystko.
  await strona.evaluate(() => {
    document.documentElement.classList.add('wej-wszystko');
    const s = document.createElement('style');
    s.textContent = 'main>section{content-visibility:visible!important}';
    document.head.appendChild(s);
  });
  // powiekszone pismo (ustawienie „rozmiar tekstu" w Samsung Internet / Androidzie): kazdy element dostaje pismo x skala
  if (skala) await strona.evaluate(k => {
    const el = [...document.querySelectorAll('body *')];
    const px = el.map(e => parseFloat(getComputedStyle(e).fontSize));
    el.forEach((e, i) => { if (px[i]) e.style.setProperty('font-size', (px[i] * k) + 'px', 'important'); });
  }, skala);
  await strona.waitForTimeout(150);
  problemy.push(...await strona.evaluate(kontroleUkladu, { telefon }));
  problemy.push(...await strona.evaluate(kontroleRzedow));
  problemy.push(...await strona.evaluate(kontrolePustych));
  // fixed/sticky w kilku miejscach strony
  const wys = await strona.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < wys; y += Math.round(h * 0.8)) {
    await strona.evaluate(v => window.scrollTo(0, v), y);
    await strona.waitForTimeout(60);
    problemy.push(...await strona.evaluate(kontroleNieruchomych));
  }
  if (zFokusem) problemy.push(...await strona.evaluate(kontroleFokusu));
  // interakcje (menu, kotwice, pasek akcji) na wybranych stronach glownych
  if (interakcje) problemy.push(...await kontroleInterakcji(ctx, baza, sciezka, [w, h], telefon));
  const unikalne = [...new Set(problemy)];
  if (unikalne.length) {
    fs.mkdirSync(ZRZUTY, { recursive: true });
    await strona.evaluate(() => window.scrollTo(0, 0));
    await strona.screenshot({ path: path.join(ZRZUTY, 'uklad-' + w + 'x' + h + '-' + motyw + (skala ? '-pismo' + skala : '') + sciezka.replace(/\//g, '_') + '.png'), fullPage: true }).catch(() => {});
  }
  await ctx.close();
  return unikalne;
}

(async () => {
  let srv = null, baza = process.env.CAI_UKLAD_BAZA;
  if (!baza) { srv = await serwerPlikow(); baza = 'http://127.0.0.1:' + srv.address().port; }
  const przegladarka = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
  const t0 = Date.now();
  // kilka kart naraz (osobne konteksty); wyniki wypisywane w stalej kolejnosci
  const lista = zadania(), wyniki = new Array(lista.length);
  let nast = 0, wypisane = 0;
  const wypisz = () => {
    while (wypisane < lista.length && wyniki[wypisane]) {
      const [[w, h], motyw, sciezka, skala] = lista[wypisane];
      wynik(w + 'x' + h + ' ' + (motyw === 'light' ? 'jasny ' : 'ciemny') + ' ' + sciezka + (skala ? ' pismo ' + Math.round(skala * 100) + '%' : ''), wyniki[wypisane]);
      wypisane++;
    }
  };
  const pracownik = async () => {
    while (nast < lista.length) {
      const i = nast++;
      const [roz, motyw, sciezka, skala, interakcje] = lista[i];
      // fokus (zaslanianie przez pasek i naglowek) tylko na telefonie i w motywie jasnym - uklad w obu motywach jest ten sam
      const zFokusem = roz[0] < TELEFON && motyw === 'light' && !skala;
      wyniki[i] = await sprawdzStrone(przegladarka, baza, roz, motyw, sciezka, zFokusem, skala, interakcje);
      wypisz();
    }
  };
  const ile = Math.max(1, Number(process.env.CAI_UKLAD_ROWNOLEGLE) || 3);
  await Promise.all(Array.from({ length: ile }, pracownik));
  await przegladarka.close();
  if (srv) srv.close();
  console.log('\nBLEDOW: ' + bledow + '   (' + lista.length + ' widokow, ' + Math.round((Date.now() - t0) / 1000) + ' s, tryb ' + (PELNY ? 'pelny' : 'szybki') + ')');
  process.exit(bledow ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
