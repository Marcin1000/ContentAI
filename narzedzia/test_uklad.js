#!/usr/bin/env node
'use strict';
/*
 * Test ukladu aplikacji Content AI na macierzy urzadzen (runda 3).
 *
 * Test dymny sprawdza, ze aplikacja DZIALA; ten - ze kazdy ekran MIESCI SIE na kazdym rozmiarze
 * (zrzuty z telefonu 412 x 700 px z rundy 3: przyciski poza ekranem, tabela lamiaca lata na "199/7",
 * uciety pasek statystyk, artykul na 40% ekranu). Baza: przeglad agencja-frontend (uklad-aplikacji.js),
 * dolozone kryteria wykonawcy wygladu (A): pole dotyku z pseudo-elementem, wyraz zlamany w srodku,
 * ikona przyklejona do tekstu, ekran wyniku na telefonie wg specu agencja-ux R3-07, stala wysokosc
 * arkusza oceny, arkusze bez pustego miejsca, mala odznaka pakietu.
 *
 * Sam stawia atrape dostawcow z repo i serwer na wolnych portach, loguje sie i przechodzi ekrany:
 * logowanie, start, brief z zaawansowanymi, okno samokorekty, generowanie, wynik (tez dlugi artykul
 * z tabela i 12 zrodlami), panel kontroli (SEO/AIO/AEO/GEO, Fakty, Luki, Linki, SERP), Tworz
 * (grafika, tytuly, posty), Wiecej, Eksport, Baza, Historia, Konto, okna (klucze, marka, pakiet, WP).
 *
 * Kryteria twarde (ZLECENIE-R3 pkt 2):
 *   poziome            poziome przewijanie strony (scrollingElement.scrollWidth > szerokosc okna)
 *   poza-ekran         widoczny tekst albo element interaktywny czesciowo poza ekranem (poziomo)
 *   przyciete          tekst/element czesciowo przyciety przez rodzica z overflow hidden/clip
 *   uciety-tekst       tekst ucinany przez wlasne pudelko bez wielokropka (tez select i placeholder)
 *   pasek-bez-wskazowki pojemnik przewijany poziomo bez zanikania/cienia na brzegu
 *   fixed-fixed        elementy fixed/sticky nachodza na siebie (poza warstwa modalna nad reszta)
 *   zasloniety         srodek elementu interaktywnego pod elementem fixed/sticky
 *   ostatni-zasloniety po przewinieciu pojemnika do konca ostatni element pod fixed/sticky
 *   cel-dotyku         telefon: pole dotyku < 44 px (z pseudo-elementami ::before/::after)
 *   male-pismo         pismo ponizej 12 px
 *   slowo-zlamane      wyraz zlamany w srodku (np. rok w waskiej kolumnie tabeli)
 *   ikona-przyklejona  ikona przycisku bez odstepu od tekstu
 *   niewysrodkowany    komputer: obszar roboczy niewysrodkowany w swojej kolumnie
 *   wynik-telefon      telefon 412x700 i 320x568: pasy, gora H1 i obszar artykulu (spec R3-07)
 *   arkusz-skok        arkusz oceny zmienia wysokosc miedzy "Analizuje..." a wynikiem
 *   arkusz-luka        puste miejsce pod lista w arkuszu menu
 *   odznaka-duza       telefon: odznaka pakietu wyzsza niz 24 px
 *   panel-otwarty-sam  panel kontroli otwarty po generowaniu bez akcji uzytkownika
 *   tekst-120          412x700 i 360x800: tekst powiekszony o 20% (jak skalowanie tekstu w Samsung Internet) -
 *                      bez poziomego przewijania, wyjscia poza ekran i uciec (brief, generator grafik, wynik)
 *   drugi-dotyk        telefon: drugie dotkniecie przycisku menu (zeby je zamknac) trafia w pozycje menu
 *                      i wysyla zapytanie do /api (platna akcja) albo nie zamyka menu
 * Miekkie (informacyjne): nachodzi, kontrast (< AA, pelne tla), udzial artykulu, wysrodkowanie.
 *
 * Uzycie (z katalogu repozytorium, po zbudowaniu wariantow):
 *   node narzedzia/test_uklad.js --ci                   # zestaw CI (9 kontekstow), kod wyjscia 1 przy bledach
 *   node narzedzia/test_uklad.js                        # cala macierz x jasny/ciemny + EN przy 390 i 1440
 *   --rozmiary=telefon,tablet,komputer | 390x844,412x700   --motywy=ciemny,jasny  --en=390x844,1440x900|brak
 *   --ekrany=start,wynik,...  --zrzuty=<katalog> --prefiks=r3-uklad-  --zrzuty-tryb=nowe|wszystkie|brak
 *   --wynik=<plik.json>  --kontrast=0  --wyjatki=<plik.json>  --baza=http://127.0.0.1:PORT (gotowy serwer)
 * Zmienne: CAI_CHROMIUM (sciezka Chromium), CAI_REPO, CAI_TEST_ZRZUTY (zrzuty przy bledzie w CI).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

// ── opcje ───────────────────────────────────────────────────────────────────
const ARG = {};
for (const a of process.argv.slice(2)) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) ARG[m[1]] = m[2] === undefined ? '1' : m[2]; }
const CI = !!ARG.ci;
const REPO = path.resolve(ARG.repo || process.env.CAI_REPO || path.join(__dirname, '..'));
const HASLO = 'test-haslo-123';
const KONTO = ARG.konto || 'admin';
const ZRZUTY = ARG.zrzuty || process.env.CAI_TEST_ZRZUTY || path.join(os.tmpdir(), 'cai-uklad-zrzuty');
const PREFIKS = ARG.prefiks || 'uklad-';
const TRYB_ZRZUTOW = ARG['zrzuty-tryb'] || (CI && !process.env.CAI_TEST_ZRZUTY ? 'brak' : 'nowe');
const KONTRAST = ARG.kontrast !== '0';
const TWARDE = ['panel-otwarty-sam', 'poziome', 'poza-ekran', 'przyciete', 'uciety-tekst', 'pasek-bez-wskazowki', 'fixed-fixed', 'zasloniety', 'ostatni-zasloniety', 'cel-dotyku', 'male-pismo',
  'slowo-zlamane', 'ikona-przyklejona', 'niewysrodkowany', 'wynik-telefon', 'arkusz-skok', 'arkusz-luka', 'odznaka-duza', 'drugi-dotyk', 'tekst-120', 'pasek-przed-artykulem'];

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Brak pakietu playwright (NODE_PATH albo npm install --no-save playwright)'); process.exit(2); }

const UA_TEL = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const UA_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MACIERZ = {
  telefon: ['320x568', '360x640', '360x800', '390x844', '412x700', '412x915', '430x932'],
  tablet: ['768x1024', '820x1180', '1024x768'],
  komputer: ['1280x720', '1366x768', '1440x900', '1536x864', '1920x1080', '2560x1440'],
};
function grupa(r) { for (const g of Object.keys(MACIERZ)) if (MACIERZ[g].includes(r)) return g; const w = +r.split('x')[0]; return w <= 430 ? 'telefon' : w < 1100 ? 'tablet' : 'komputer'; }
function rozwin(lista) { return lista.split(',').flatMap((x) => MACIERZ[x.trim()] || [x.trim()]).filter(Boolean); }
// Zestaw CI (ok. 4 min): telefon najwezszy i jak u Marcina, tablet, maly komputer w ciemnym PL i duzy komputer w EN;
// ekrany: start, brief, wynik po generowaniu z SERP, arkusze, grafika, Baza i Historia. Pelna macierz: bez --ci.
const ZESTAW_CI = ['320x568', '412x700', '768x1024', '1280x720'];
const EKRANY_CI = ['start', 'brief-zaawansowane', 'menu-brief', 'wynik', 'wynik-bez-paneli', 'wynik-przewiniety', 'ocen-seo', 'arkusz-wysokosc', 'ocen-aio',
  'fakty', 'menu-tworz', 'menu-wiecej', 'menu-eksport', 'grafika', 'wynik-dlugi', 'wynik-dlugi-tabela', 'wynik-dlugi-zrodla', 'baza', 'historia', 'historia-podglad', 'tekst-120'];
const ROZMIARY = rozwin(ARG.rozmiary || (CI ? ZESTAW_CI.join(',') : 'telefon,tablet,komputer'));
const MOTYWY = (ARG.motywy || (CI ? 'ciemny' : 'ciemny,jasny')).split(',');
const EN = ARG.en === 'brak' ? [] : rozwin(ARG.en || (CI ? '1920x1080' : '390x844,1440x900'));
const JASNY_CI = [];
const TYLKO = ARG.ekrany ? ARG.ekrany.split(',') : (CI ? EKRANY_CI : null);
// kroki potrzebne do dalszego przebiegu (generowanie) ida zawsze
const ZAWSZE = ['samokorekta-okno', 'generowanie', 'wynik'];
const chce = (e) => !TYLKO || TYLKO.includes(e);

// ── serwer i atrapa (wolne porty) albo --baza ───────────────────────────────
function wolnyPort() {
  return new Promise((ok, zle) => { const s = require('net').createServer(); s.once('error', zle); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function czekajNaPort(port, ms) {
  const koniec = Date.now() + ms;
  return new Promise((ok, zle) => { (function proba() { const r = http.get({ host: '127.0.0.1', port, path: '/' }, (o) => { o.resume(); ok(); }); r.on('error', () => { if (Date.now() > koniec) zle(new Error('port ' + port + ' nie odpowiada')); else setTimeout(proba, 150); }); })(); });
}
async function postawSrodowisko() {
  if (ARG.baza) return { baza: ARG.baza.replace(/\/$/, ''), sprzataj: async () => {} };
  const portAtrapy = Number(process.env.ATRAPA_PORT) || await wolnyPort();
  const portSerwera = await wolnyPort();
  process.env.ATRAPA_PORT = String(portAtrapy);
  const atrapa = require(path.join(REPO, 'narzedzia', 'atrapa', 'dostawcy.js'));
  const serwerAtrapy = atrapa.uruchom(portAtrapy, '127.0.0.1');
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-uklad-'));
  const { zahaszuj } = require(path.join(REPO, 'serwer', 'server.js'));
  const konta = [['admin', 'admin', 'premium'], ['premium', 'uzytkownik', 'premium'], ['standard', 'uzytkownik', 'standard'], ['darmowy', 'uzytkownik', 'darmowy']]
    .map(([login, rola, plan]) => Object.assign({ login, rola, plan, utworzony: '2026-01-01' }, zahaszuj(HASLO)));
  fs.writeFileSync(path.join(kat, 'uzytkownicy.json'), JSON.stringify(konta, null, 2));
  const env = Object.assign({}, process.env, {
    CAI_UZYTKOWNICY: path.join(kat, 'uzytkownicy.json'), CAI_BAZA: path.join(kat, 'baza'), CAI_UZYCIE: path.join(kat, 'uzycie'),
    CAI_MARKA: kat, CAI_SEKRET_PLIK: path.join(kat, 'sekret'), PORT: String(portSerwera), CAI_HOST: '127.0.0.1',
    ANTHROPIC_KEY: 'test-anthropic', OPENAI_KEY: 'test-openai', ELEVEN_KEY: 'test-eleven',
    CAI_URL_ANTHROPIC: 'http://127.0.0.1:' + portAtrapy + '/v1/messages', CAI_URL_OPENAI: 'http://127.0.0.1:' + portAtrapy + '/v1',
    CAI_URL_ELEVEN: 'http://127.0.0.1:' + portAtrapy + '/eleven/v1', CAI_ZAUFANE_ADRESY: '127.0.0.1', CAI_COOKIE_SECURE: '0',
  });
  const serwer = spawn(process.execPath, [path.join(REPO, 'serwer', 'server.js')], { cwd: REPO, env, stdio: ['ignore', 'ignore', 'ignore'] });
  await czekajNaPort(portSerwera, 15000);
  return {
    baza: 'http://127.0.0.1:' + portSerwera,
    sprzataj: async () => {
      await new Promise((ok) => { serwer.once('exit', ok); serwer.kill(); setTimeout(ok, 4000); }); // dane dopiero po zamknieciu serwera
      try { serwerAtrapy.close(); } catch (e) { /* juz zamknieta */ }
      fs.rmSync(kat, { recursive: true, force: true });
    },
  };
}

// ── audyt w przegladarce (funkcja samowystarczalna, przekazywana do evaluate) ─
function audytStrony(o) {
  const W = document.documentElement.clientWidth || innerWidth;
  const H = innerHeight;
  const wyniki = [];
  const metryki = {};
  const SEL_INT = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[onclick],label[for]';
  const MODAL = 'body:not(.is-mobile):not(.kb-collapsed) .layout > .sidebar,[role=dialog],[aria-modal="true"],.overlay.open,.grupa-menu.open,.settings-menu.open,#mobile-sidebar.open,#inspektor:not([hidden]),#img-panel,#audio-panel,.repurpose-panel.show,.brief-panel.show';
  const cache = new Map();
  const cs = (e) => { let c = cache.get(e); if (!c) { c = getComputedStyle(e); cache.set(e, c); } return c; };
  const widoczny = (e) => {
    if (!e || !e.isConnected) return false;
    if (e.checkVisibility && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return false;
    const r = e.getBoundingClientRect(); return r.width >= 1 && r.height >= 1;
  };
  const srOnly = (e) => { const r = e.getBoundingClientRect(); const c = cs(e); return (r.width <= 2 && r.height <= 2) || /rect\(0/.test(c.clip) || /inset\(50%/.test(c.clipPath); };
  const DYN = /^(show|open|active|aktywny|aktywna|wybrany|r3-|ready|running|is-|ins-otwarty)/;
  function czesc(x) {
    if (x.id) return '#' + x.id;
    let s = x.tagName.toLowerCase();
    const kl = [...x.classList].filter((c) => !DYN.test(c)).slice(0, 2);
    if (kl.length) s += '.' + kl.join('.');
    const oc = x.getAttribute('onclick');
    if (oc) s += '[onclick^="' + oc.slice(0, 26).replace(/"/g, "'") + '"]';
    else if (x.getAttribute('data-ins')) s += '[data-ins="' + x.getAttribute('data-ins') + '"]';
    else if (x.getAttribute('data-ins-ocena')) s += '[data-ins-ocena="' + x.getAttribute('data-ins-ocena') + '"]';
    else if (!kl.length && x.getAttribute('data-i18n')) s += '[data-i18n="' + x.getAttribute('data-i18n') + '"]';
    return s;
  }
  function sel(e) {
    if (!e || e.nodeType !== 1) return '';
    if (e === document.scrollingElement || e === document.documentElement) return 'html';
    if (e === document.body) return 'body';
    const cz = [czesc(e)];
    let p = e.parentElement, n = 0;
    while (p && p !== document.body && n < 3 && !cz[0].startsWith('#')) { const c = czesc(p); cz.unshift(c); if (c.startsWith('#')) break; p = p.parentElement; n++; }
    return cz.join(' > ');
  }
  const tekst = (e) => ((e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || '') + '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  const oznacz = (e, k) => { if (o.oznacz && e && e.setAttribute) e.setAttribute('data-r3', k); };
  const zgloszoneEl = new Map(); // kategoria -> Set elementow (deduplikacja potomkow, niezaleznie od zrzutow)
  const dodaj = (k, e, d) => { wyniki.push(Object.assign({ k, s: e ? sel(e) : '', t: e ? tekst(e) : '' }, d || {})); if (e) { if (!zgloszoneEl.has(k)) zgloszoneEl.set(k, new Set()); zgloszoneEl.get(k).add(e); if (TW.has(k)) oznacz(e, k); } };
  const TW = new Set(o.twarde || []);
  const maTekst = (e) => { for (const n of e.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; };
  // Pole dotyku: prostokat elementu powiekszony o ::before/::after z position:absolute
  // (wzorzec "maly wyglad, cel 44 px": inset ujemny). Wartosci top/right/bottom/left w px.
  const poleDotyku = (e) => {
    const r = e.getBoundingClientRect();
    let g = r.top, d = r.bottom, l = r.left, p = r.right;
    if (cs(e).position !== 'static') {
      for (const ps of ['::before', '::after']) {
        const pc = getComputedStyle(e, ps);
        if (!pc || pc.content === 'none' || pc.content === 'normal' || pc.position !== 'absolute' || pc.pointerEvents === 'none' || pc.display === 'none') continue;
        const px = (v) => (v && /px$/.test(v) ? parseFloat(v) : null);
        const t = px(pc.top), b = px(pc.bottom), lf = px(pc.left), rt = px(pc.right);
        if (t !== null) g = Math.min(g, r.top + t);
        if (b !== null) d = Math.max(d, r.bottom - b);
        if (lf !== null) l = Math.min(l, r.left + lf);
        if (rt !== null) p = Math.max(p, r.right - rt);
      }
    }
    return { width: p - l, height: d - g };
  };
  const fixedPrzodek = (e) => { for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const ps = cs(p).position; if (ps === 'fixed' || ps === 'sticky') return p; } return null; };

  // 1. poziome przewijanie strony
  const se = document.scrollingElement;
  if (se.scrollWidth > W + 1) dodaj('poziome', null, { s: 'html', scrollWidth: se.scrollWidth, W });

  // 2. kandydaci: elementy z tekstem i interaktywne
  const wszystkie = [...document.body.getElementsByTagName('*')].filter((e) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path|use|SVG|PATH|USE|BR|OPTION)$/.test(e.tagName) && !(e.closest && e.closest('svg')));
  const interaktywne = new Set(document.body.querySelectorAll(SEL_INT));
  const zgloszone = new Map(); // klucz k|sel -> wpis (deduplikacja w obrebie ekranu)
  const zglos = (k, e, d) => { const kl = k + '|' + sel(e); const b = zgloszone.get(kl); if (b) { b.ile = (b.ile || 1) + 1; return; } dodaj(k, e, d); zgloszone.set(kl, wyniki[wyniki.length - 1]); };
  const przodekZgloszony = (e, k) => { const z = zgloszoneEl.get(k); if (!z) return false; for (let p = e.parentElement; p; p = p.parentElement) if (z.has(p)) return true; return false; };
  const przewijanePoziomo = new Set();

  for (const e of wszystkie) {
    const int = interaktywne.has(e);
    if (!int && !maTekst(e)) continue;
    if (!widoczny(e) || srOnly(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right <= 0 || r.left >= W) continue; // poza ekranem w calosci: szuflada, odsylacz "przejdz do tresci"
    if (r.width * r.height > 0.6 * W * H && !maTekst(e)) continue; // tlo okna z onclick
    let zatrzymX = false, zatrzymY = false, ukryty = false, przyciecie = null;
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const c = cs(p);
      const ox = c.overflowX, oy = c.overflowY;
      if (ox !== 'visible' || oy !== 'visible') {
        const pr = p.getBoundingClientRect();
        const L = pr.left + (parseFloat(c.borderLeftWidth) || 0), P = pr.right - (parseFloat(c.borderRightWidth) || 0);
        const T = pr.top + (parseFloat(c.borderTopWidth) || 0), D = pr.bottom - (parseFloat(c.borderBottomWidth) || 0);
        if (!zatrzymX) {
          if (ox === 'hidden' || ox === 'clip') {
            if (r.right <= L + 1 || r.left >= P - 1) { ukryty = true; break; }
            if ((r.left < L - 1 || r.right > P + 1) && !przyciecie) przyciecie = { p, os: 'x', o: Math.round(Math.max(L - r.left, r.right - P)) };
          } else if (ox === 'auto' || ox === 'scroll') {
            if ((r.left < L - 1 || r.right > P + 1) && p.scrollWidth > p.clientWidth + 2) przewijanePoziomo.add(p);
            zatrzymX = true;
          }
        }
        if (!zatrzymY) {
          if (oy === 'hidden' || oy === 'clip') {
            if (r.bottom <= T + 1 || r.top >= D - 1) { ukryty = true; break; }
            if ((r.top < T - 1 || r.bottom > D + 1) && !przyciecie) przyciecie = { p, os: 'y', o: Math.round(Math.max(T - r.top, r.bottom - D)) };
          } else if (oy === 'auto' || oy === 'scroll') zatrzymY = true;
        }
      }
      if (c.position === 'fixed') break;
      if (zatrzymX && zatrzymY) break;
    }
    if (ukryty) continue;
    if (przyciecie) {
      const zBody = przyciecie.p === document.body;
      const k = zBody ? 'poza-ekran' : 'przyciete';
      if (!przodekZgloszony(e, k)) zglos(k, e, { rect: R(r), rodzic: sel(przyciecie.p), os: przyciecie.os, o: przyciecie.o });
    } else if (!zatrzymX && (r.left < -1 || r.right > W + 1)) {
      if (!przodekZgloszony(e, 'poza-ekran')) zglos('poza-ekran', e, { rect: R(r), W, o: Math.round(Math.max(-r.left, r.right - W)) });
    }
    // 3. tekst ucinany przez wlasne pudelko
    const c = cs(e);
    if (maTekst(e) && e.tagName !== 'TEXTAREA') {
      if ((c.overflowX === 'hidden' || c.overflowX === 'clip') && e.scrollWidth > e.clientWidth + 1 && c.textOverflow !== 'ellipsis')
        zglos('uciety-tekst', e, { os: 'x', scrollWidth: e.scrollWidth, clientWidth: e.clientWidth });
      else if ((c.overflowY === 'hidden' || c.overflowY === 'clip') && e.scrollHeight > e.clientHeight + 2 && (!c.webkitLineClamp || c.webkitLineClamp === 'none'))
        zglos('uciety-tekst', e, { os: 'y', scrollHeight: e.scrollHeight, clientHeight: e.clientHeight });
    }
  }
  // select i placeholder: tekst szerszy niz pole (bez wielokropka)
  const ctx = document.createElement('canvas').getContext('2d');
  const szer = (t, c) => { ctx.font = c.fontStyle + ' ' + c.fontWeight + ' ' + c.fontSize + ' ' + c.fontFamily; return ctx.measureText(t).width; };
  for (const e of document.body.querySelectorAll('select, input[placeholder]:not([type=checkbox]):not([type=radio]), input[type=text], input[type=url], input[type=search]')) {
    if (!widoczny(e)) continue;
    const r = e.getBoundingClientRect(); if (r.right <= 0 || r.left >= W) continue;
    const c = cs(e);
    const miejsce = e.clientWidth - (parseFloat(c.paddingLeft) || 0) - (parseFloat(c.paddingRight) || 0);
    if (e.tagName === 'SELECT') {
      const t = (e.options[e.selectedIndex] || {}).text || '';
      if (t && szer(t, c) > miejsce + 1) zglos('uciety-tekst', e, { os: 'select', tekstPx: Math.round(szer(t, c)), miejsce: Math.round(miejsce), t: t.slice(0, 48) });
    } else if (!e.value && e.placeholder && c.textOverflow !== 'ellipsis') {
      const w = szer(e.placeholder, getComputedStyle(e, '::placeholder'));
      if (w > miejsce + 1) zglos('uciety-tekst', e, { os: 'placeholder', tekstPx: Math.round(w), miejsce: Math.round(miejsce), t: e.placeholder.slice(0, 48) });
    }
  }

  // 4. paski przewijane poziomo: musza wygladac na przewijane (zanikanie na brzegu)
  for (const e of wszystkie) {
    const c = cs(e);
    if (!(c.overflowX === 'auto' || c.overflowX === 'scroll')) continue;
    if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.tagName) || !widoczny(e)) continue;
    if (e.scrollWidth <= e.clientWidth + 2 || e.clientWidth < 40) continue;
    const r = e.getBoundingClientRect(); if (r.right <= 0 || r.left >= W) continue;
    const pseudo = (x) => x && ['::before', '::after'].some((ps) => { const pc = getComputedStyle(x, ps); return pc.content !== 'none' && /gradient/.test(pc.backgroundImage); });
    const maska = (c.maskImage && c.maskImage !== 'none') || (c.webkitMaskImage && c.webkitMaskImage !== 'none');
    const cien = /local/.test(c.backgroundAttachment) && /gradient/.test(c.backgroundImage);
    const zanik = maska || cien || pseudo(e) || pseudo(e.parentElement) || (e.parentElement && /zanik|fade|cien/.test(e.parentElement.className));
    const dz = [...e.children].filter(widoczny);
    const polowa = dz.some((d) => { const dr = d.getBoundingClientRect(); if (dr.left < r.right && dr.right > r.right) { const f = (r.right - dr.left) / dr.width; return f > 0.15 && f < 0.85; } return false; });
    if (!zanik) zglos('pasek-bez-wskazowki', e, { scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, polowa, rect: R(r) });
  }

  // 5. fixed/sticky: nakladanie na siebie
  const fx = [];
  for (const e of wszystkie.concat([...document.body.querySelectorAll('nav,header,footer,aside')])) {
    const ps = cs(e).position;
    if (ps !== 'fixed' && ps !== 'sticky') continue;
    if (!widoczny(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
    if (fx.some((f) => f.el === e)) continue;
    fx.push({ el: e, r, pos: ps, pelny: r.width * r.height >= 0.8 * W * H, modal: e.matches(MODAL) || !!e.closest(MODAL) || !!e.querySelector('[role=dialog],[aria-modal="true"]') });
  }
  metryki.fixed = fx.map((f) => sel(f.el) + ' ' + f.pos + ' ' + R(f.r).join(','));
  for (let i = 0; i < fx.length; i++) for (let j = i + 1; j < fx.length; j++) {
    const A = fx[i], B = fx[j];
    if (A.pelny && B.pelny) continue;
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue; // zagniezdzone: arkusz w pasku akcji itp.
    const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
    const iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
    if (ix <= 2 || iy <= 2) continue;
    const cx = (Math.max(A.r.left, B.r.left) + Math.min(A.r.right, B.r.right)) / 2;
    const cy = (Math.max(A.r.top, B.r.top) + Math.min(A.r.bottom, B.r.bottom)) / 2;
    const t = document.elementFromPoint(Math.max(0, Math.min(W - 1, cx)), Math.max(0, Math.min(H - 1, cy)));
    const gora = t && B.el.contains(t) ? B : t && A.el.contains(t) ? A : null;
    if (!gora) continue;
    const dol = gora === A ? B : A;
    if (gora.modal && (dol.pelny || !dol.modal)) continue; // warstwa modalna nad paskami: zamierzone
    if (gora.pelny) continue;
    if (dol.pelny && !dol.modal) continue; // pasek nad samym tlem arkusza: decyzja projektowa, nie zasloniecie tresci
    zglos('fixed-fixed', gora.el, { pod: sel(dol.el), nachodzenie: [Math.round(ix), Math.round(iy)], rect: R(gora.r), rectPod: R(dol.r) });
  }

  // 6. zasloniete elementy interaktywne (srodek pod innym elementem)
  // Gdy otwarta jest warstwa modalna (arkusz, okno, szuflada z tlem), elementy pod tlem sa zasloniete celowo:
  // sprawdzamy wtedy tylko wnetrze otwartych warstw.
  const otwarte = [...document.body.querySelectorAll(MODAL)].filter(widoczny);
  const srodek = document.elementFromPoint(W / 2, H / 2);
  const pelnyNaSrodku = fx.find((f) => f.pelny && srodek && f.el.contains(srodek));
  let warstwy = null;
  if (pelnyNaSrodku) warstwy = otwarte.length ? otwarte : [pelnyNaSrodku.el];
  else if (otwarte.some((m) => m.contains(srodek))) warstwy = otwarte.filter((m) => m.contains(srodek));
  const wWarstwie = (e) => !warstwy || warstwy.some((m) => m.contains(e));
  metryki.warstwy = warstwy ? warstwy.map(sel) : [];
  for (const e of interaktywne) {
    if (!wWarstwie(e)) continue;
    if (!widoczny(e) || srOnly(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height > 0.5 * W * H) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
    const t = document.elementFromPoint(cx, cy);
    if (!t || t === e || e.contains(t) || t.contains(e)) continue;
    const lab = t.closest && t.closest('label');
    if (lab && (lab.control === e || lab.contains(e))) continue;
    if (e.labels && [...e.labels].some((l) => l.contains(t))) continue;
    if (t.closest && t.closest('.grupa-menu.open,.settings-menu.open,[role=menu],[role=listbox]')) continue; // otwarte menu rozwijane nad trescia: zamierzone
    const F = fixedPrzodek(t);
    if (F && !F.contains(e)) {
      // zasloniecie przy biezacym przewinieciu jest normalne, jesli pojemnik da sie przewinac dalej
      const fr = F.getBoundingClientRect();
      let K = null;
      for (let p = e.parentElement; p; p = p.parentElement) { if (p === document.body) { K = document.scrollingElement; break; } const c = cs(p); if ((c.overflowY === 'auto' || c.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 2) { K = p; break; } if (c.position === 'fixed') break; }
      let daSie = false;
      if (K) {
        // pasek dolny (srodek w dolnej polowie ekranu) odslania element przewijaniem w dol, gorny - w gore;
        // element moze zaczynac sie ponizej gornej krawedzi wysokiego dolnego paska (stopka briefu)
        const pasekNizej = (fr.top + fr.bottom) / 2 > H / 2;
        if (pasekNizej) daSie = (K.scrollHeight - K.clientHeight - K.scrollTop) >= (r.bottom - fr.top) + 2;
        else daSie = K.scrollTop >= (fr.bottom - r.top) + 2;
      }
      if (!daSie) zglos('zasloniety', e, { przez: sel(F), rect: R(r), kontener: K ? sel(K) : '(brak przewijania)' });
    }
    else if (!F && !fixedPrzodek(e)) {
      const tr = t.getBoundingClientRect();
      if (tr.width * tr.height < 0.5 * W * H) zglos('nachodzi', e, { przez: sel(t), rect: R(r) });
    }
  }

  // 7. ostatni element pojemnikow przewijanych (w pionie) nie moze zostac pod fixed/sticky
  if (o.ostatni !== false) {
    const kont = [document.scrollingElement].concat(wszystkie.filter((e) => { const c = cs(e); return (c.overflowY === 'auto' || c.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 80 && widoczny(e) && wWarstwie(e); }));
    for (const K of kont) {
      const dok = K === document.scrollingElement;
      if (dok && warstwy) continue;
      if (dok && K.scrollHeight <= innerHeight + 4) continue;
      const zap = K.scrollTop;
      K.scrollTop = K.scrollHeight;
      const kr = dok ? { top: 0, bottom: H, left: 0, right: W } : K.getBoundingClientRect();
      let ost = null, ostB = -1;
      for (const e of (dok ? wszystkie : K.querySelectorAll('*'))) {
        if (!(interaktywne.has(e) || maTekst(e))) continue;
        if (!dok && !K.contains(e)) continue;
        if (dok) { let wInnym = false; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const c = cs(p); if ((c.overflowY === 'auto' || c.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 4) { wInnym = true; break; } if (c.position === 'fixed') { wInnym = true; break; } } if (wInnym) continue; }
        { const F = fixedPrzodek(e); if (F && F !== K && K.contains(F)) continue; } // tresc paskow fixed/sticky wewnatrz pojemnika to nie "ostatni element"
        if (!widoczny(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.bottom > kr.bottom + 1 || r.top < kr.top - 1 || r.right <= 0 || r.left >= W) continue;
        if (r.bottom > ostB) { ostB = r.bottom; ost = e; }
      }
      if (ost) {
        const r = ost.getBoundingClientRect();
        const y = Math.min(r.bottom - 3, kr.bottom - 3), x = Math.max(1, Math.min(W - 2, r.left + Math.min(r.width / 2, 40)));
        const t = document.elementFromPoint(x, y);
        if (t && t !== ost && !ost.contains(t) && !t.contains(ost)) {
          const F = fixedPrzodek(t);
          if (F && !F.contains(ost)) zglos('ostatni-zasloniety', ost, { kontener: sel(K), przez: sel(F), rect: R(r) });
        }
      }
      K.scrollTop = zap;
    }
  }

  // 8. cele dotyku (telefon)
  if (o.telefon) {
    const klikalny = 'button,a[href],label,[onclick],[role=button],[role=tab],[role=menuitem],summary';
    const przewiniecie = document.scrollingElement.scrollTop;
    for (const e of interaktywne) {
      if (!wWarstwie(e)) continue;
      if (!widoczny(e) || srOnly(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.right <= 0 || r.left >= W) continue;
      if (r.bottom <= 0 && (przewiniecie === 0 || fixedPrzodek(e))) continue; // poza ekranem u gory (odsylacz "przejdz do tresci")
      if (r.top >= H && fixedPrzodek(e)) continue;
      if (r.width >= 44 && r.height >= 44) continue;
      { const pd = poleDotyku(e); if (pd.width >= 43.5 && pd.height >= 43.5) continue; }
      if (e.tagName === 'LABEL' && e.control && widoczny(e.control)) { const cr = e.control.getBoundingClientRect(); if (cr.height >= 40 && cr.width >= 44) continue; } // etykieta pola: rownowazny cel to samo pole
      if (r.width * r.height > 0.5 * W * H) continue;
      if (e.tagName === 'A' && /^inline/.test(cs(e).display)) { const blok = e.closest('#article p, #article li, #article td, #article th, #article dd, p'); if (blok && (blok.innerText || '').trim().length > (e.innerText || '').trim().length + 8) continue; } // odnosnik w zdaniu: wyjatek WCAG 2.5.8
      let cel = r;
      if (e.matches('input[type=checkbox],input[type=radio]')) { const l = (e.labels && e.labels[0]) || e.closest('label'); if (l) cel = l.getBoundingClientRect(); }
      const rodzic = e.parentElement && e.parentElement.closest(klikalny);
      if (rodzic && rodzic !== e && interaktywne.has(rodzic)) continue; // celem jest element nadrzedny - oceniany osobno
      if (cel.width >= 44 && cel.height >= 44) continue;
      zglos('cel-dotyku', e, { wymiar: [Math.round(cel.width), Math.round(cel.height)] });
    }
  }

  // 9. pismo ponizej 12 px  10. kontrast (pelne tla)
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const widziane = new Set();
  const kolor = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const mieszaj = (g, d) => ({ r: g.r * g.a + d.r * (1 - g.a), g: g.g * g.a + d.g * (1 - g.a), b: g.b * g.a + d.b * (1 - g.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const tlo = (e) => { const w = []; for (let p = e; p; p = p.parentElement) { const c = cs(p); if (c.backgroundImage && c.backgroundImage !== 'none') return null; if (parseFloat(c.opacity) < 1) return null; const k = kolor(c.backgroundColor); if (k && k.a > 0) { w.push(k); if (k.a >= 1) break; } } let b = { r: 255, g: 255, b: 255, a: 1 }; for (let i = w.length - 1; i >= 0; i--) b = mieszaj(w[i], b); return b; };
  let n;
  while ((n = tw.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    const e = n.parentElement;
    if (!e || widziane.has(e) || (e.closest && e.closest('svg,script,style,noscript'))) continue;
    widziane.add(e);
    if (!wWarstwie(e)) continue;
    if (!widoczny(e) || srOnly(e)) continue;
    const r = e.getBoundingClientRect(); if (r.right <= 0 || r.left >= W) continue;
    const c = cs(e);
    const px = parseFloat(c.fontSize);
    if (px === 0) continue; // etykieta ukryta przez font-size:0 (np. przyciski z sama ikona)
    if (px < 12) zglos('male-pismo', e, { px: Math.round(px * 10) / 10 });
    if (o.kontrast && !e.closest('[disabled],[aria-disabled="true"]')) {
      const fg = kolor(c.color), bg = tlo(e);
      if (fg && bg) {
        const f2 = fg.a < 1 ? mieszaj(fg, bg) : fg;
        const L1 = lum(f2), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const duzy = px >= 24 || (px >= 18.66 && (parseInt(c.fontWeight, 10) || 400) >= 700);
        if (ratio < (duzy ? 3 : 4.5) - 0.01) zglos('kontrast', e, { ratio: Math.round(ratio * 100) / 100, px: Math.round(px), kolor: c.color, tlo: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')' });
      }
    }
  }

  // 9b. wyraz zlamany w srodku (komorki tabel, przyciski, odznaki, naglowki) i ikona bez odstepu od tekstu
  const SEL_WYRAZ = 'td, th, button, .badge, .astat, label, h1, h2, h3, .ver-btn, .btn-secondary, .poz-menu, .ins-zakl, .start-karta b, .stat-skrot';
  for (const e of document.body.querySelectorAll(SEL_WYRAZ)) {
    if (!wWarstwie(e) || !widoczny(e) || srOnly(e)) continue;
    const r = e.getBoundingClientRect(); if (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) continue;
    for (const n of e.childNodes) {
      if (n.nodeType !== 3) continue;
      const re = /[^\s\u00a0]{2,}/g; let m, zlamany = null;
      while ((m = re.exec(n.nodeValue))) {
        const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        if (new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size > 1) { zlamany = m[0]; break; }
      }
      if (zlamany) { zglos('slowo-zlamane', e, { wyraz: zlamany.slice(0, 40) }); break; }
    }
  }
  for (const e of interaktywne) {
    if (!wWarstwie(e) || !widoczny(e) || srOnly(e)) continue;
    const ik = e.querySelector(':scope > svg.ikona');
    const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!ik || !tn || !(ik.compareDocumentPosition(tn) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const st = tn.nodeValue.search(/\S/);
    const rg = document.createRange(); rg.setStart(tn, st); rg.setEnd(tn, st + 1);
    const zr = rg.getBoundingClientRect(), ir = ik.getBoundingClientRect();
    if (zr.width && Math.abs(zr.top - ir.top) < ir.height && zr.left - ir.right < 3.5) zglos('ikona-przyklejona', e, { odstep: Math.round(zr.left - ir.right) });
  }
  if (o.telefon) {
    const od = document.getElementById('pakiet-badge');
    if (od && widoczny(od) && od.getBoundingClientRect().height > 24.5) zglos('odznaka-duza', od, { wysokosc: Math.round(od.getBoundingClientRect().height) });
  }

  // 10b. panel kontroli otwarty sam po generowaniu (nikt go nie otwieral)
  if (o.inspektorPoGenerowaniu) {
    const ins = document.getElementById('inspektor');
    if (ins && !ins.hidden && widoczny(ins)) dodaj('panel-otwarty-sam', ins, { rect: R(ins.getBoundingClientRect()), zakladka: ((ins.querySelector('.ins-zakl[aria-selected="true"]') || {}).innerText || '').trim() });
  }

  // 11. pomiary
  const art = document.getElementById('article');
  if (art && widoczny(art)) {
    let w = 0, wsz = 0;
    for (let y = 1; y < H; y += 4) { wsz++; const t = document.elementFromPoint(W / 2, y); if (t && art.contains(t)) w++; }
    metryki.artykulUdzial = Math.round(100 * w / wsz);
  }
  if (!o.telefon && W >= 1024) {
    const kol = document.querySelector('.output-col');
    const ins = document.getElementById('inspektor');
    if (kol && widoczny(kol)) {
      const kr = kol.getBoundingClientRect();
      let L = kr.left, P = kr.right;
      if (ins && !ins.hidden && widoczny(ins) && !/fixed|absolute/.test(cs(ins).position)) { const ir = ins.getBoundingClientRect(); if (ir.left > L + 200 && ir.left < P) P = ir.left; }
      let tresc = null;
      if (art && widoczny(art) && art.innerHTML.trim()) tresc = art.getBoundingClientRect();
      else {
        const ph = document.getElementById('placeholder');
        if (ph && widoczny(ph)) {
          let l = Infinity, p = -Infinity;
          for (const e of ph.querySelectorAll('*')) { if (!widoczny(e) || !(maTekst(e) || interaktywne.has(e))) continue; const r = e.getBoundingClientRect(); l = Math.min(l, r.left); p = Math.max(p, r.right); }
          if (isFinite(l)) tresc = { left: l, right: p };
        }
      }
      if (tresc) {
        const ml = Math.round(tresc.left - L), mr = Math.round(P - tresc.right);
        metryki.wysrodkowanie = { lewy: ml, prawy: mr, obszar: Math.round(P - L) };
        if (Math.abs(ml - mr) > Math.max(24, 0.04 * (P - L))) dodaj('niewysrodkowany', null, { s: art && widoczny(art) && art.innerHTML.trim() ? '#article' : '#placeholder', lewy: ml, prawy: mr, obszar: Math.round(P - L) });
      }
    }
  }
  return { wyniki, metryki };
}

// Ekran wyniku na telefonie (spec agencja-ux R3-07): pasy u gory i u dolu, gora H1, obszar artykulu.
// Paski to elementy fixed/sticky z tlem, szersze niz pol ekranu i nizsze niz 30% ekranu, plus
// .output-bar-left (widoczna czesc przyklejonego wiersza meta).
function pomiarWyniku() {
  const W = innerWidth, H = innerHeight;
  const art = document.getElementById('article');
  if (!art || getComputedStyle(art).display === 'none') return null;
  const h1 = art.querySelector('h1');
  let gora = 0, dol = H;
  for (const el of document.body.querySelectorAll('*')) {
    const c = getComputedStyle(el);
    const lewy = el.matches('.output-bar-left');
    if (!lewy && c.position !== 'fixed' && c.position !== 'sticky') continue;
    if (art.contains(el) || el.contains(art) || el.closest('#powiadomienia')) continue;
    if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) continue;
    if (!lewy && (c.backgroundColor === 'transparent' || /,\s*0\)$/.test(c.backgroundColor))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < W * 0.5 || r.height < 1 || r.height > H * 0.3 || r.bottom <= 0 || r.top >= H) continue;
    if (r.top < H / 2) gora = Math.max(gora, r.bottom); else dol = Math.min(dol, r.top);
  }
  const h1Top = h1 ? h1.getBoundingClientRect().top : null;
  const start = h1Top === null ? gora : Math.max(gora, h1Top);
  const bloki = [...art.querySelectorAll('p, li, h2, h3, .meta-box, td')].filter((e) => e.offsetParent !== null && e.textContent.trim());
  const ostatni = bloki.length ? bloki[bloki.length - 1].getBoundingClientRect().bottom : null;
  return { gora: Math.round(gora), dolPaski: Math.round(H - dol), h1: h1Top === null ? null : Math.round(h1Top),
    obszar: Math.round(((dol - start) / H) * 1000) / 10, widok: Math.round(((dol - gora) / H) * 1000) / 10,
    ostatni: ostatni === null ? null : Math.round(ostatni), dol: Math.round(dol) };
}

// ── przebieg jednego kontekstu (rozmiar x motyw x jezyk) ─────────────────────
const FIKSTURA_EXTRA = `
<h2>Porównanie formatów i kosztów kopii w latach 1997-2024</h2>
<p>Zestawienie pokazuje, jak zmieniały się formaty dystrybucji, rozdzielczość i koszt jednej kopii filmu w kinach w Polsce. Dane są przykładowe i służą do porównania.</p>
<table><thead><tr><th>Rok</th><th>Format dystrybucji</th><th>Rozdzielczość</th><th>Udział w rynku</th><th>Koszt kopii (zł)</th><th>Uwagi dystrybutora</th></tr></thead>
<tbody>
<tr><td>1997</td><td>Taśma 35 mm</td><td>analogowa</td><td>98,5%</td><td>4 800</td><td>Kopie wymieniane po ok. 500 projekcjach</td></tr>
<tr><td>2001</td><td>Taśma 35 mm, dźwięk cyfrowy</td><td>analogowa</td><td>96,0%</td><td>5 200</td><td>Pierwsze kina z dźwiękiem Dolby Digital</td></tr>
<tr><td>2009</td><td>Projekcja cyfrowa 2K</td><td>2048×1080</td><td>21,4%</td><td>1 150</td><td>Dysk twardy zamiast szpuli</td></tr>
<tr><td>2013</td><td>DCP 2K / 4K</td><td>4096×2160</td><td>88,7%</td><td>650</td><td>Koniec masowego kopiowania taśm</td></tr>
<tr><td>2019</td><td>DCP 4K z HDR</td><td>4096×2160</td><td>97,2%</td><td>420</td><td>Dystrybucja satelitarna i sieciowa</td></tr>
<tr><td>2024</td><td>DCP 4K, HFR 48 kl./s</td><td>4096×2160</td><td>99,1%</td><td>380</td><td>Pliki szyfrowane kluczem KDM</td></tr>
</tbody></table>
<h3>Co pokazuje zestawienie</h3>
<p>Najdłuższy wyraz w tym akapicie to Konstantynopolitańczykowianeczka, a adres bez spacji brzmi https://www.przyklad-dlugiej-domeny-filmowej.pl/archiwum/2024/10/porownanie-formatow-kinowych-bez-spacji?zrodlo=raport&wersja=pelna.</p>
<ul><li>Koszt kopii spadł ponad dziesięciokrotnie.</li><li>Rozdzielczość wzrosła z analogowej do 4096×2160.</li><li>Udział projekcji cyfrowej przekroczył 99%.</li></ul>
<h2>Najczęstsze pytania o jakość obrazu w kinie</h2>
<h3>Dlaczego stare filmy wyglądają inaczej?</h3>
<p>Taśma ma inną ziarnistość i zakres tonalny niż matryca cyfrowa. Rekonstrukcja cyfrowa potrafi wydobyć szczegóły, ale też je wygładzić.</p>
<h3>Czy 4K zawsze oznacza lepszy obraz?</h3>
<p>Nie zawsze: liczy się też kompresja, kalibracja projektora i odległość widza od ekranu.</p>`;
const FIKSTURA_ZRODLA = [
  ['https://www.portal-filmowy.pl/artykul/filmy-sprzed-lat-w-ktorych-cgi-w-ogole-sie-nie-zestarzalo', 'Filmy sprzed lat, w których CGI w ogóle się NIE ZESTARZAŁO', '368 days ago'],
  ['https://kino-i-technika.pl/efekty-niespecjalne-dlaczego-efekty-w-filmach-przestaly-robic-wrazenie', 'Efekty niespecjalne: dlaczego efekty w filmach przestały robić wrażenie?', '3712 days ago'],
  ['https://www.magazyn-ekranowy.pl/niewidzialne-efekty-specjalne', 'Niewidzialne efekty specjalne. Zobacz, jak CGI buduje świat filmu, gdy nawet tego nie zauważasz.', '319 days ago'],
  ['https://www.example-cinema.com/which-movie-has-the-highest-vfx', 'Which Movie Has the Highest VFX? A Deep Dive into Cinematic Spectacle', 'September 30, 2025'],
  ['https://www.example-cinema.com/the-best-cgi-movies-of-the-90s', 'The best CGI movies of the 90s', '872 days ago'],
  ['https://www.przyklad-forum.pl/watek/most-visual-effects-shots-in-a-movie', 'Most visual effects shots in a movie', '1655 days ago'],
  ['https://www.example-news.com/marvel-vfx-artists-allege-tension', 'Marvel VFX Artists Allege \'Tension\' and \'Turmoil\' on \'Ant-Man\'', '1318 days ago'],
  ['https://www.serwis-kulturalny.pl/dlaczego-nowe-filmy-i-seriale-sa-tak-ciemne-hipernaturalizm', 'Dlaczego nowe filmy i seriale są tak ciemne? Hipernaturalizm ma swoje wady', '1269 days ago'],
  ['https://www.blog-o-kinie.pl/dlaczego-filmy-wygladaja-coraz-gorzej', 'Dlaczego filmy wyglądają coraz gorzej? Na pewno to zauważyliście', '253 days ago'],
  ['https://www.example-news.com/why-so-many-vfx-artists-are-fed-up', 'Why So Many VFX Artists Are Fed Up With Working on Big Franchise Films', 'March 3, 2024'],
  ['https://www.przyklad-dlugiej-domeny-filmowej.pl/archiwum/2024/10/porownanie-formatow-kinowych', 'Porównanie formatów kinowych: od taśmy 35 mm do DCP 4K', '45 days ago'],
  ['https://www.serwis-kulturalny.pl/rekonstrukcja-cyfrowa-klasyki', 'Rekonstrukcja cyfrowa klasyki: co zyskujemy, a co tracimy', 'June 12, 2025'],
];

async function uspokoj(s, ms = 250) {
  await s.waitForTimeout(ms);
  await s.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || !isFinite(((a.effect && a.effect.getComputedTiming()) || {}).endTime)), null, { timeout: 2500 }).catch(() => {});
}
async function klik(s, css, dotyk) {
  const l = s.locator(css).filter({ visible: true }).first();
  if (dotyk) await l.tap({ timeout: 5000 }); else await l.click({ timeout: 5000 });
}
async function czekajNaKoniecGenerowania(s, ms) {
  await s.waitForFunction(() => { const b = document.getElementById('gen-btn'); const sp = document.getElementById('spinner'); return b && !b.disabled && sp && getComputedStyle(sp).display === 'none'; }, null, { timeout: ms || 90000 });
}
const RESET = () => {
  const k = (f) => { try { f(); } catch (e) { /* brak funkcji w tym wariancie */ } };
  k(() => zamknijGrupyPaska()); k(() => inspektorZamknij()); k(() => closeSettingsMenu()); k(() => closeMobileSidebar());
  k(() => closeTitlesModal()); k(() => closeRepurposePanel()); k(() => closeKeysModal()); k(() => closeLlmsModal());
  k(() => zamknijPakiet()); k(() => closeWpModal()); k(() => closePremiumModal()); k(() => closeBriefPanel()); k(() => closeAudioPanel());
  k(() => { const p = document.getElementById('img-panel'); if (p && p.style.display !== 'none') closeImgPanelSmart(); });
  document.querySelectorAll('.overlay.open').forEach((o) => o.classList.remove('open'));
  document.querySelectorAll('[data-r3]').forEach((e) => e.removeAttribute('data-r3'));
};

async function przebieg(b, srod, rozmiar, motyw, jezyk, zbior) {
  const [w, h] = rozmiar.split('x').map(Number);
  const gr = grupa(rozmiar);
  const telefon = gr === 'telefon';
  const dotyk = gr !== 'komputer' && !(gr === 'tablet' && w >= 1024 && false);
  const opcje = { viewport: { width: w, height: h }, serviceWorkers: 'block', acceptDownloads: false, colorScheme: motyw === 'jasny' ? 'light' : 'dark', locale: jezyk === 'en' ? 'en-US' : 'pl-PL', reducedMotion: 'no-preference' };
  if (gr === 'telefon') Object.assign(opcje, { isMobile: true, hasTouch: true, userAgent: UA_TEL, deviceScaleFactor: 1 });
  else if (gr === 'tablet') Object.assign(opcje, { isMobile: w < 1024, hasTouch: true, userAgent: UA_TAB, deviceScaleFactor: 1 });
  const k = await b.newContext(opcje);
  const host = new URL(srod.baza).hostname;
  await k.addCookies([{ name: 'cai_motyw', value: motyw, domain: host, path: '/' }]);
  await k.addInitScript(({ jezyk, motyw }) => {
    try {
      if (!sessionStorage.getItem('r3_init')) {
        sessionStorage.setItem('r3_init', '1');
        localStorage.setItem('cai_lang', jezyk);
        localStorage.setItem('cai-dark', motyw === 'ciemny' ? '1' : '');
        localStorage.setItem('cai_start_ukonczony', '1'); localStorage.setItem('cai_start_v1', '1');
      }
      sessionStorage.setItem('cin_splash', '1');
    } catch (e) { /* bez magazynu */ }
    // staly czas: atrapa liczy tresc z daty w promptcie, zrzuty i uklad maja byc powtarzalne
    const D = Date, przes = Date.UTC(2026, 9, 1, 10, 0, 0) - D.now();
    class Staly extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + przes); } static now() { return D.now() + przes; } }
    window.Date = Staly;
  }, { jezyk, motyw });
  const s = await k.newPage();
  const bledyJs = [];
  s.on('pageerror', (e) => bledyJs.push(e.message.slice(0, 160)));
  s.on('dialog', (d) => d.accept().catch(() => {}));
  let postApi = 0;
  s.on('request', (q) => { if (q.method() === 'POST' && /\/api\//.test(q.url())) postApi++; });
  // Drugie dotkniecie w miejscu przycisku otwartego menu: menu ma sie zamknac, bez zadnego POST /api.
  const drugiDotyk = async (ekran, przycisk) => {
    if (!telefon) return;
    const r = await s.evaluate((css) => { const b = [...document.querySelectorAll(css)].find((e) => e.offsetParent !== null); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, przycisk);
    if (!r) return;
    const przed = postApi;
    await s.touchscreen.tap(r.x, r.y);
    await s.waitForTimeout(700);
    const otwarte = await s.evaluate(() => !!document.querySelector('.grupa-menu.open'));
    if (postApi !== przed || otwarte) ustalenie(ekran, 'drugi-dotyk', przycisk, { postApi: postApi - przed, menuOtwarte: otwarte });
    // nastepny krok testu korzysta z otwartego menu
    if (!otwarte) { await s.touchscreen.tap(r.x, r.y); await s.waitForTimeout(450); }
  };
  const tag = `${rozmiar}-${motyw}-${jezyk}`;
  const wynikiKontekstu = [];
  const widzianeKlucze = zbior.widziane;

  async function zbadaj(ekran, dodatkowe = {}) {
    if (!chce(ekran)) return null;
    await s.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    let r;
    try { r = await s.evaluate(audytStrony, Object.assign({ telefon, kontrast: KONTRAST, oznacz: TRYB_ZRZUTOW !== 'brak', twarde: TWARDE }, dodatkowe)); }
    catch (e) { r = { wyniki: [{ k: 'blad-audytu', s: '', t: e.message.split('\n')[0].slice(0, 120) }], metryki: {} }; }
    const wpis = { ekran, rozmiar, grupa: gr, motyw, jezyk, wyniki: r.wyniki, metryki: r.metryki, bledyJs: bledyJs.splice(0) };
    wynikiKontekstu.push(wpis);
    const twarde = r.wyniki.filter((x) => TWARDE.includes(x.k) || x.k === 'niewysrodkowany');
    const nowe = twarde.filter((x) => { const kl = ekran + '|' + rozmiar + '|' + x.k + '|' + x.s; if (widzianeKlucze.has(kl)) return false; widzianeKlucze.add(kl); return true; });
    if (TRYB_ZRZUTOW === 'wszystkie' || (TRYB_ZRZUTOW === 'nowe' && nowe.length)) {
      fs.mkdirSync(ZRZUTY, { recursive: true });
      await s.addStyleTag({ content: '[data-r3]{outline:2px dashed #ff00d4 !important;outline-offset:-1px !important}' }).catch(() => {});
      await s.screenshot({ path: path.join(ZRZUTY, `${PREFIKS}${ekran}-${tag}.png`) }).catch(() => {});
      wpis.zrzut = `${PREFIKS}${ekran}-${tag}.png`;
    }
    await s.evaluate(() => document.querySelectorAll('[data-r3]').forEach((e) => e.removeAttribute('data-r3'))).catch(() => {});
    const krotko = twarde.map((x) => x.k).reduce((a, k2) => { a[k2] = (a[k2] || 0) + 1; return a; }, {});
    console.log(`  ${tag.padEnd(22)} ${ekran.padEnd(22)} ${JSON.stringify(krotko)}${r.metryki.artykulUdzial !== undefined ? ' artykul=' + r.metryki.artykulUdzial + '%' : ''}${r.metryki.wysrodkowanie ? ' srodek=' + r.metryki.wysrodkowanie.lewy + '/' + r.metryki.wysrodkowanie.prawy : ''}`);
    return wpis;
  }
  // Ustalenie z pomiaru poza audytem strony (pomiar wyniku, arkusze) dopisane do wpisu ekranu.
  const ustalenie = (ekran, k, s2, dane) => {
    let wpis = [...wynikiKontekstu].reverse().find((w2) => w2.ekran === ekran);
    if (!wpis) { wpis = { ekran, rozmiar, grupa: gr, motyw, jezyk, wyniki: [], metryki: {} }; wynikiKontekstu.push(wpis); }
    wpis.wyniki.push(Object.assign({ k, s: s2, t: '' }, dane || {}));
    console.log(`  ${tag.padEnd(22)} ${ekran.padEnd(22)} ${k}: ${JSON.stringify(dane)}`);
  };
  const krok = async (nazwa, fn) => { if (TYLKO && !ZAWSZE.includes(nazwa) && !TYLKO.some((e) => nazwa === e || nazwa.startsWith(e + '-') || e.startsWith(nazwa))) return; try { await fn(); } catch (e) { wynikiKontekstu.push({ ekran: nazwa, rozmiar, grupa: gr, motyw, jezyk, wyniki: [{ k: 'blad-przebiegu', s: '', t: e.message.split('\n')[0].slice(0, 160) }], metryki: {} }); console.log(`  ${tag.padEnd(22)} ${nazwa.padEnd(22)} BLAD PRZEBIEGU: ${e.message.split('\n')[0].slice(0, 120)}`); await s.evaluate(RESET).catch(() => {}); } };
  const reset = async () => { await s.evaluate(RESET).catch(() => {}); await uspokoj(s, 150); };
  const widok = async (w2) => { if (telefon || (gr === 'tablet' && w < 1024)) await s.evaluate((x) => { try { ustawWidokMobilny(x); } catch (e) { /* brak przelacznika */ } }, w2); await uspokoj(s, 150); };

  // logowanie
  await s.goto(srod.baza + '/' + (jezyk === 'en' ? '?lang=en' : ''), { waitUntil: 'load' });
  await uspokoj(s, 300);
  if (await s.$('input[name="login"]')) {
    await zbadaj('logowanie');
    await s.fill('input[name="login"]', KONTO);
    await s.fill('input[name="haslo"], input[type="password"]', HASLO);
    await Promise.all([s.waitForNavigation({ waitUntil: 'load' }), s.click('button[type="submit"], input[type="submit"]')]);
  }
  await s.waitForTimeout(900);
  await s.evaluate(() => { try { if (document.getElementById('start-modal') && getComputedStyle(document.getElementById('start-modal')).display !== 'none') startPomin(); } catch (e) { /* bez kreatora */ } });
  const kbPoczatek = await s.evaluate(() => document.body.classList.contains('kb-collapsed'));
  await uspokoj(s, 300);

  await krok('start', async () => { await zbadaj('start');
    // przed pierwszym artykulem pasek wyniku nie pokazuje grup (Tworz, Eksport, Wiecej) - nie ma na czym dzialac
    const grupy = await s.evaluate(() => [...document.querySelectorAll('.pasek-akcje .grupa-wrap')].filter((g) => g.offsetParent !== null && getComputedStyle(g).display !== 'none').map((g) => g.id));
    if (grupy.length) ustalenie('start', 'pasek-przed-artykulem', '.pasek-akcje', { grupy }); if (telefon) { await widok('wynik'); await zbadaj('start-wynik'); await widok('brief'); } });
  await krok('brief-zaawansowane', async () => {
    await widok('brief');
    await s.evaluate(() => { const d = document.getElementById('extra') && document.getElementById('extra').closest('details'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } });
    await uspokoj(s, 250);
    await zbadaj('brief-zaawansowane');
    await s.evaluate(() => { window.scrollTo(0, 0); const t = document.getElementById('tresc-glowna'); if (t) t.scrollTop = 0; });
  });
  if (telefon) {
    await krok('menu-brief', async () => {
      await widok('brief');
      await klik(s, '#grupa-brief-wrap > button', dotyk); await uspokoj(s, 300);
      await zbadaj('menu-brief');
      await drugiDotyk('menu-brief', '#grupa-brief-wrap > button');
    });
    await reset();
  }
  // generowanie z samokorekta, siecia i SERP (jedno wywolanie, wszystko potrzebne dalej)
  await krok('samokorekta-okno', async () => {
    await widok('brief');
    await s.fill('#topic', jezyk === 'en' ? 'Why old films look better than new ones' : 'Dlaczego filmy sprzed 30 lat wyglądają lepiej niż teraz');
    await s.fill('#kw-input', jezyk === 'en' ? 'old films' : 'stare filmy'); await s.press('#kw-input', 'Enter');
    await s.evaluate(() => {
      const d = document.getElementById('extra') && document.getElementById('extra').closest('details'); if (d) d.open = true;
      document.getElementById('extra').value = '[atrapa:opoznienie=2500@artykul]';
      document.getElementById('use-web').checked = true; document.getElementById('use-serp').checked = true;
      try { onSerpToggle(); } catch (e) { /* brak */ }
    });
    const prem = await s.evaluate(() => { const b = document.getElementById('premium-btn'); return b ? (b.type === 'checkbox' ? b.checked : b.classList.contains('active')) : null; });
    if (!prem) await s.evaluate(() => togglePremium());
    await s.evaluate(() => generate());
    await uspokoj(s, 400);
    const okno = await s.evaluate(() => { const m = document.getElementById('premium-modal'); return !!m && m.classList.contains('open'); });
    if (okno) await zbadaj('samokorekta-okno');
  });
  await krok('generowanie', async () => {
    const okno = await s.evaluate(() => { const m = document.getElementById('premium-modal'); return !!m && m.classList.contains('open'); });
    if (okno) await s.evaluate(() => premiumProceed());
    await s.waitForTimeout(1100);
    await zbadaj('generowanie');
    await czekajNaKoniecGenerowania(s, 120000);
    await s.evaluate(() => { document.getElementById('extra').value = ''; });
  });
  await krok('wynik', async () => {
    await widok('wynik');
    await s.evaluate(() => { window.scrollTo(0, 0); const o = document.getElementById('out-scroll'); if (o) o.scrollTop = 0; });
    await uspokoj(s, 300);
    await zbadaj('wynik', { inspektorPoGenerowaniu: true });
    await s.evaluate(() => { try { inspektorZamknij(); } catch (e) { /* brak */ } });
    await uspokoj(s, 300);
    await zbadaj('wynik-bez-paneli');
    if (telefon && chce('wynik-bez-paneli')) {
      const m = await s.evaluate(pomiarWyniku);
      const scisle = ['412x700', '320x568'].includes(rozmiar);
      if (m) {
        const zle = [];
        if (scisle && m.gora > 92) zle.push('pasy u gory ' + m.gora + ' px > 92');
        if (scisle && m.dolPaski > 112) zle.push('paski u dolu ' + m.dolPaski + ' px > 112');
        if (scisle && (m.h1 === null || m.h1 > 110)) zle.push('gora H1 ' + m.h1 + ' px > 110');
        if (scisle && m.obszar < 55) zle.push('obszar artykulu ' + m.obszar + '% < 55%');
        if (zle.length) ustalenie('wynik-bez-paneli', 'wynik-telefon', '#article', { pomiar: m, bledy: zle });
        else console.log(`  ${tag.padEnd(22)} ${'wynik-bez-paneli'.padEnd(22)} pomiar R3-07: ${JSON.stringify(m)}`);
      }
    }
    await s.evaluate(() => { const h = document.querySelector('#article h2'); if (h) h.scrollIntoView({ block: 'start' }); });
    await uspokoj(s, 300);
    await zbadaj('wynik-przewiniety');
    if (telefon && chce('wynik-przewiniety')) {
      // czytanie: ciagly ruch w dol (paski chowaja sie po 16 px ruchu), potem koniec artykulu
      for (let i = 0; i < 8; i++) { await s.mouse.wheel(0, 40); await s.waitForTimeout(40); }
      await uspokoj(s, 450);
      const m = await s.evaluate(pomiarWyniku);
      if (m && rozmiar === '412x700' && m.widok < 90) ustalenie('wynik-przewiniety', 'wynik-telefon', '#article', { pomiar: m, bledy: ['przy czytaniu obszar ' + m.widok + '% < 90%'] });
      await s.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await uspokoj(s, 450);
      const k2 = await s.evaluate(pomiarWyniku);
      if (k2 && k2.ostatni !== null && k2.ostatni > k2.dol) ustalenie('wynik-przewiniety', 'wynik-telefon', '#article', { pomiar: k2, bledy: ['ostatni wiersz pod paskami'] });
    }
    await s.evaluate(() => { window.scrollTo(0, 0); const o = document.getElementById('out-scroll'); if (o) o.scrollTop = 0; });
  });
  // panel kontroli
  const panel = async (ekran, akcja, czekaj) => krok(ekran, async () => {
    await widok('wynik');
    await akcja();
    if (czekaj) await s.waitForFunction(czekaj, null, { timeout: 30000 }).catch(() => {});
    await uspokoj(s, 500);
    await zbadaj(ekran);
  });
  await panel('ocen-seo', async () => { await klik(s, '[onclick="inspektorPokaz()"]', dotyk); }, () => !document.querySelector('#seo-content .seo-loading'));
  if (telefon && chce('ocen-aio')) {
    await krok('arkusz-wysokosc', async () => {
      await widok('wynik');
      await s.evaluate(() => { try { if (typeof aioCache !== 'undefined') aioCache = null; } catch (e) { /* brak */ } });
      await klik(s, '#inspektor [data-ins-ocena="aio"]', dotyk);
      await s.waitForTimeout(120);
      const h1 = await s.evaluate(() => Math.round(document.getElementById('inspektor').getBoundingClientRect().height));
      await s.waitForFunction(() => !document.querySelector('#aio-content .seo-loading'), null, { timeout: 30000 }).catch(() => {});
      await uspokoj(s, 400);
      const h2 = await s.evaluate(() => Math.round(document.getElementById('inspektor').getBoundingClientRect().height));
      if (Math.abs(h1 - h2) > 2) ustalenie('ocen-aio', 'arkusz-skok', '#inspektor', { przed: h1, po: h2 });
      await klik(s, '#inspektor [data-ins-ocena="seo"]', dotyk).catch(() => {});
    });
  }
  for (const o2 of ['aio', 'aeo', 'geo']) await panel('ocen-' + o2, async () => { await klik(s, `#inspektor [data-ins-ocena="${o2}"]`, dotyk); }, new Function(`return !document.querySelector('#${o2}-content .seo-loading')`));
  await panel('fakty', async () => { await klik(s, '#inspektor .ins-zakl[data-ins="fakty"]', dotyk); }, () => { const l = document.getElementById('fakty-loading'); return !l || getComputedStyle(l).display === 'none'; });
  await panel('luki', async () => { await klik(s, '#inspektor .ins-zakl[data-ins="luki"]', dotyk); }, () => { const l = document.getElementById('gap-loading'); return !l || getComputedStyle(l).display === 'none'; });
  await panel('linki', async () => { await klik(s, '#inspektor .ins-zakl[data-ins="linki"]', dotyk); }, () => { const l = document.getElementById('links-loading'); return !l || getComputedStyle(l).display === 'none'; });
  await panel('serp', async () => { await klik(s, '#inspektor .ins-zakl[data-ins="serp"]', dotyk); }, null);
  await reset();
  // Twórz
  await krok('menu-tworz', async () => { await widok('wynik'); await klik(s, `button[onclick="przelaczGrupe('tworz')"]`, dotyk); await uspokoj(s, 300); await zbadaj('menu-tworz');
    if (telefon) {
      const luka = await s.evaluate(() => {
        const m = document.querySelector('.grupa-menu.open');
        if (!m) return null;
        const dz = [...m.children].filter((d) => d.offsetParent !== null && d.getBoundingClientRect().height > 0);
        if (!dz.length) return null;
        const pad = parseFloat(getComputedStyle(m).paddingBottom) || 0;
        return Math.round(m.getBoundingClientRect().bottom - dz[dz.length - 1].getBoundingClientRect().bottom - pad + Math.min(pad, 24));
      });
      if (luka !== null && luka > 24) ustalenie('menu-tworz', 'arkusz-luka', '.grupa-menu.open', { luka });
    }
    await drugiDotyk('menu-tworz', `.pasek-akcje button[onclick="przelaczGrupe('tworz')"]`);
  });
  await krok('grafika', async () => {
    await klik(s, '#img-btn', dotyk); await uspokoj(s, 400); await zbadaj('grafika');
    await s.evaluate(() => { const b = document.getElementById('img-gen-btn'); if (b) b.scrollIntoView({ block: 'center' }); });
    await s.evaluate(() => generateImage());
    await s.waitForFunction(() => { const sp = document.getElementById('img-spinner'); return !sp || getComputedStyle(sp).display === 'none'; }, null, { timeout: 60000 }).catch(() => {});
    await uspokoj(s, 400);
    await s.evaluate(() => { const w2 = document.getElementById('img-result-wrap'); if (w2) w2.scrollIntoView({ block: 'start' }); });
    await uspokoj(s, 200);
    await zbadaj('grafika-wynik');
  });
  await reset();
  await krok('tytuly', async () => {
    await widok('wynik'); await klik(s, `button[onclick="przelaczGrupe('tworz')"]`, dotyk); await uspokoj(s, 200); await klik(s, '#titles-btn', dotyk);
    await s.waitForFunction(() => { const l = document.getElementById('titles-loading'); return !l || getComputedStyle(l).display === 'none'; }, null, { timeout: 30000 }).catch(() => {});
    await uspokoj(s, 300); await zbadaj('tytuly');
  });
  await reset();
  await krok('posty', async () => {
    await widok('wynik'); await klik(s, `button[onclick="przelaczGrupe('tworz')"]`, dotyk); await uspokoj(s, 200); await klik(s, `.repurpose-item[onclick="runRepurpose('linkedin')"]`, dotyk);
    await s.waitForFunction(() => { const l = document.getElementById('repurpose-loading'); return !l || getComputedStyle(l).display === 'none'; }, null, { timeout: 30000 }).catch(() => {});
    await uspokoj(s, 300); await zbadaj('posty');
  });
  await reset();
  await krok('menu-wiecej', async () => { await widok('wynik'); await klik(s, `button[onclick="przelaczGrupe('wiecej')"]`, dotyk); await uspokoj(s, 300); await zbadaj('menu-wiecej');
    if (telefon) {
      const luka = await s.evaluate(() => {
        const m = document.querySelector('.grupa-menu.open');
        if (!m) return null;
        const dz = [...m.children].filter((d) => d.offsetParent !== null && d.getBoundingClientRect().height > 0);
        if (!dz.length) return null;
        const pad = parseFloat(getComputedStyle(m).paddingBottom) || 0;
        return Math.round(m.getBoundingClientRect().bottom - dz[dz.length - 1].getBoundingClientRect().bottom - pad + Math.min(pad, 24));
      });
      if (luka !== null && luka > 24) ustalenie('menu-wiecej', 'arkusz-luka', '.grupa-menu.open', { luka });
    }
    await drugiDotyk('menu-wiecej', `.pasek-akcje button[onclick="przelaczGrupe('wiecej')"]`);
  });
  await reset();
  await krok('menu-eksport', async () => { await widok('wynik'); await klik(s, `button[onclick="przelaczGrupe('pobierz')"]`, dotyk); await uspokoj(s, 300); await zbadaj('menu-eksport');
    if (telefon) {
      const luka = await s.evaluate(() => {
        const m = document.querySelector('.grupa-menu.open');
        if (!m) return null;
        const dz = [...m.children].filter((d) => d.offsetParent !== null && d.getBoundingClientRect().height > 0);
        if (!dz.length) return null;
        const pad = parseFloat(getComputedStyle(m).paddingBottom) || 0;
        return Math.round(m.getBoundingClientRect().bottom - dz[dz.length - 1].getBoundingClientRect().bottom - pad + Math.min(pad, 24));
      });
      if (luka !== null && luka > 24) ustalenie('menu-eksport', 'arkusz-luka', '.grupa-menu.open', { luka });
    }
    await drugiDotyk('menu-eksport', `.pasek-akcje button[onclick="przelaczGrupe('pobierz')"]`);
  });
  await reset();
  // dlugi artykul z tabela i 12 zrodlami (przez historie i "Otworz w generatorze")
  await krok('wynik-dlugi', async () => {
    await s.evaluate(({ extra, zr }) => {
      const art = document.getElementById('article');
      const tmp = document.createElement('div'); tmp.innerHTML = art.innerHTML;
      tmp.querySelectorAll('.zrodla-box').forEach((e) => e.remove());
      const meta = tmp.querySelector('.meta-box');
      if (meta) meta.insertAdjacentHTML('beforebegin', extra); else tmp.insertAdjacentHTML('beforeend', extra);
      const html = dolaczZrodla(tmp.innerHTML, zr.map((z) => ({ url: z[0], tytul: z[1], data: z[2] })));
      history.unshift({ topic: 'Długi artykuł z tabelą i 12 źródłami', type: document.getElementById('ctype').value, words: 2600, time: '12:00', html });
      try { saveState(); } catch (e) { /* bez zapisu */ }
      try { renderHistory(); } catch (e) { /* bez listy */ }
      otworzWGeneratorze(0);
    }, { extra: FIKSTURA_EXTRA, zr: FIKSTURA_ZRODLA });
    await widok('wynik');
    await s.evaluate(() => { window.scrollTo(0, 0); const o = document.getElementById('out-scroll'); if (o) o.scrollTop = 0; });
    await uspokoj(s, 400);
    await zbadaj('wynik-dlugi');
    await s.evaluate(() => { const t = document.querySelectorAll('#article table'); const x = t[t.length - 1]; if (x) x.scrollIntoView({ block: 'center' }); });
    await uspokoj(s, 250); await zbadaj('wynik-dlugi-tabela');
    await s.evaluate(() => { const z = document.querySelector('#article .zrodla-box'); if (z) z.scrollIntoView({ block: 'start' }); });
    await uspokoj(s, 250); await zbadaj('wynik-dlugi-zrodla');
    await s.evaluate(() => { window.scrollTo(0, 0); const o = document.getElementById('out-scroll'); if (o) o.scrollTop = 0; });
  });
  await reset();
  // Baza, Historia, Konto
  await krok('baza', async () => {
    if (telefon || (gr === 'tablet' && w < 1024)) await klik(s, '#mnav-kb', dotyk);
    else if (await s.evaluate(() => document.body.classList.contains('kb-collapsed'))) await klik(s, '#kb-tab', dotyk);
    await uspokoj(s, 400); await zbadaj('baza');
    await s.evaluate((kb) => { try { closeMobileSidebar(); } catch (e) { /* brak */ } if (kb && !document.body.classList.contains('kb-collapsed')) { try { toggleKbPanel(); } catch (e) { /* brak */ } } }, kbPoczatek);
  });
  await reset();
  await krok('historia', async () => {
    if (telefon || (gr === 'tablet' && w < 1024)) await klik(s, '#mnav-hist', dotyk); else await klik(s, `button[onclick="switchTab('history',this)"]`, dotyk);
    await uspokoj(s, 300); await zbadaj('historia');
    await klik(s, '#h-list-inner .h-item', dotyk); await uspokoj(s, 400); await zbadaj('historia-podglad');
    await s.evaluate(() => { try { if (document.body.classList.contains('is-mobile')) switchMobileTab('generator'); else switchTab('generator', document.querySelector("button[onclick=\"switchTab('generator',this)\"]")); } catch (e) { /* brak */ } });
  });
  await reset();
  await krok('konto', async () => {
    if (telefon || (gr === 'tablet' && w < 1024)) await klik(s, '#mnav-konto', dotyk); else await klik(s, '#settings-btn', dotyk);
    await uspokoj(s, 350); await zbadaj('konto');
  });
  await reset();
  for (const [ekran, fn] of [['okno-klucze', 'openKeysModal'], ['okno-marka', 'openLlmsModal'], ['okno-pakiet', 'otworzPakiet'], ['okno-wordpress', 'openWpModal']]) {
    await krok(ekran, async () => {
      await s.evaluate((f) => { if (typeof window[f] === 'function') window[f](); }, fn);
      await uspokoj(s, 500);
      await zbadaj(ekran);
    });
    await reset();
  }
  // Odpornosc na powiekszony tekst (Samsung Internet skaluje pismo): kazdy element dostaje
  // inline font-size x1.2 wzgledem zapamietanego rozmiaru; wtedy ani poziomego przewijania, ani uciec.
  if (['412x700', '360x800'].includes(rozmiar) && (!TYLKO || TYLKO.includes('tekst-120'))) {
    const powieksz = () => s.evaluate(() => {
      const lista = [...document.querySelectorAll('body *')].map((e) => [e, parseFloat(getComputedStyle(e).fontSize)]);
      for (const [e, fs] of lista) if (fs > 0) e.style.fontSize = (fs * 1.2) + 'px';
    });
    for (const [ekran, ustaw] of [
      ['brief', async () => { await widok('brief'); await s.evaluate(() => { const d = document.getElementById('brief-zaawansowane'); if (d) d.open = true; }); }],
      ['grafika', async () => { await widok('wynik'); await s.evaluate(() => { if (typeof openImgPanelSmart === 'function') openImgPanelSmart(); }); }],
      ['wynik', async () => { await widok('wynik'); await s.evaluate(() => window.scrollTo(0, 0)); }],
    ]) {
      await krok('tekst-120-' + ekran, async () => {
        await s.reload({ waitUntil: 'load' });
        await uspokoj(s, 700);
        await ustaw();
        await uspokoj(s, 300);
        await powieksz();
        await uspokoj(s, 300);
        const r = await s.evaluate(audytStrony, { telefon, kontrast: false, oznacz: false, twarde: TWARDE, ostatni: false });
        const zle = r.wyniki.filter((x) => ['poziome', 'poza-ekran', 'przyciete', 'uciety-tekst'].includes(x.k));
        for (const x of zle.slice(0, 12)) ustalenie('tekst-120-' + ekran, 'tekst-120', x.s, { rodzaj: x.k, t: x.t, szczegol: x.os || x.o || x.scrollWidth || '' });
        if (!zle.length) console.log(`  ${tag.padEnd(22)} ${('tekst-120-' + ekran).padEnd(22)} {}`);
        if (TRYB_ZRZUTOW === 'wszystkie') { fs.mkdirSync(ZRZUTY, { recursive: true }); await s.screenshot({ path: path.join(ZRZUTY, `${PREFIKS}tekst-120-${ekran}-${tag}.png`) }).catch(() => {}); }
      });
    }
  }
  await k.close();
  return wynikiKontekstu;
}

// ── zestawienie ─────────────────────────────────────────────────────────────
function zestaw(wszystkie) {
  const mapa = new Map();
  for (const w of wszystkie) for (const x of w.wyniki) {
    const kl = [x.k, w.ekran, x.s].join('|');
    let e = mapa.get(kl);
    if (!e) { e = { k: x.k, ekran: w.ekran, s: x.s, t: x.t, rozmiary: new Set(), motywy: new Set(), jezyki: new Set(), przyklad: x, zrzut: w.zrzut || '' }; mapa.set(kl, e); }
    e.rozmiary.add(w.rozmiar); e.motywy.add(w.motyw); e.jezyki.add(w.jezyk);
    if (!e.zrzut && w.zrzut) e.zrzut = w.zrzut;
  }
  return [...mapa.values()].map((e) => Object.assign(e, { rozmiary: [...e.rozmiary], motywy: [...e.motywy], jezyki: [...e.jezyki] }));
}

(async () => {
  const srod = await postawSrodowisko();
  const b = await chromium.launch(Object.assign({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) },
    process.env.CAI_CHROMIUM || ARG.chromium ? { executablePath: process.env.CAI_CHROMIUM || ARG.chromium } : {}));
  const plan = [];
  for (const r of ROZMIARY) for (const m of MOTYWY) plan.push([r, m, 'pl']);
  for (const r of JASNY_CI) plan.push([r, 'jasny', 'pl']);
  for (const r of EN) for (const m of (CI ? ['ciemny'] : MOTYWY)) plan.push([r, m, 'en']);
  const zbior = { widziane: new Set() };
  const wszystkie = [];
  const t0 = Date.now();
  try {
    for (const [r, m, j] of plan) {
      const t1 = Date.now();
      try { wszystkie.push(...await przebieg(b, srod, r, m, j, zbior)); }
      catch (e) { wszystkie.push({ ekran: '(kontekst)', rozmiar: r, motyw: m, jezyk: j, wyniki: [{ k: 'blad-przebiegu', s: '', t: e.message.split('\n')[0].slice(0, 160) }], metryki: {} }); console.log('BLAD KONTEKSTU ' + r + ' ' + m + ' ' + j + ': ' + e.message.split('\n')[0]); }
      console.log(`== ${r} ${m} ${j}: ${Math.round((Date.now() - t1) / 1000)} s`);
    }
  } finally { await b.close(); await srod.sprzataj(); }
  const zest = zestaw(wszystkie);
  let wyjatki = [];
  if (ARG.wyjatki) { try { wyjatki = JSON.parse(fs.readFileSync(ARG.wyjatki, 'utf8')); } catch (e) { console.error('Nie da sie przeczytac --wyjatki: ' + e.message); } }
  const twarde = zest.filter((e) => TWARDE.includes(e.k) && !wyjatki.some((w) => w.k === e.k && (!w.ekran || w.ekran === e.ekran) && (!w.s || e.s.includes(w.s))));
  const plik = ARG.wynik || path.join(os.tmpdir(), 'cai-uklad-wynik.json');
  fs.writeFileSync(plik, JSON.stringify({ czas: new Date().toISOString(), repo: REPO, baza: srod.baza, plan, ekrany: wszystkie, zestawienie: zest }, null, 1));
  const lk = twarde.reduce((a, e) => { a[e.k] = (a[e.k] || 0) + 1; return a; }, {});
  console.log(`\nKontekstow: ${plan.length}, ekranow: ${wszystkie.length}, czas: ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log('Ustalenia twarde (unikalne ekran+selektor): ' + JSON.stringify(lk));
  console.log('Wyniki: ' + plik);
  if (ARG.ci) process.exit(twarde.length ? 1 : 0);
})();
