#!/usr/bin/env node
'use strict';
/*
 * Jeden znak marki (A) wszedzie. Zgloszenie 14.10.2026: strona, logowanie, dokumenty prawne, ikony aplikacji, obrazki OG,
 * grafiki README i ikony aplikacji natywnych mialy jeszcze znak B (ramiona z przerwami, kropka w srodku) albo starsza gwiazde.
 *  1. Kazda kopia sciezki znaku w kodzie (favicon, sprite strony, logowanie, dokumenty prawne, aplikacja, generator grafik)
 *     to dokladnie znak A, bez kola w srodku.
 *  2. Kazdy obrazek z narzedzia/grafiki_marki.js i kazdy inny obrazek ze znakiem (zrzuty, grafiki ogloszenia) ma w miejscu
 *     znaku znak A: w srodku otwor (tlo), na przekatnej miedzy ramionami i na ramionach kolor marki. Znak B ma w srodku
 *     kropke, a na przekatnej przerwe miedzy ramionami.
 *  3. Kazdy PNG i ICO w repozytorium jest na jednej z list, wiec nowa ikona nie ominie kontroli.
 * Bez przegladarki i bez zaleznosci (PNG czyta narzedzia/png.js). Uzycie: node narzedzia/test_znak.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { czytaj } = require('./png.js');
const { ZNAK, GRAFIKI } = require('./grafiki_marki.js');

const REPO = path.resolve(__dirname, '..');
const tekst = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const ZNAK_A = 'M16 1 L19.8 12.2 L18.12 13.88 A3 3 0 0 0 13.88 13.88 L12.2 12.2 Z M31 16 L19.8 19.8 L18.12 18.12 A3 3 0 0 0 18.12 13.88 L19.8 12.2 Z '
  + 'M16 31 L12.2 19.8 L13.88 18.12 A3 3 0 0 0 18.12 18.12 L19.8 19.8 Z M1 16 L12.2 12.2 L13.88 13.88 A3 3 0 0 0 13.88 18.12 L12.2 19.8 Z';
// Fragmenty znaku B sklejane w locie, zeby ten plik sam ich nie zawieral.
const ZNAK_B = ['L18.82 ' + '12.33', 'A3.4 ' + '3.4 0 0 0'];
// Pliki, ktore zawieraja fragmenty znaku B celowo: sprawdzaja, ze ich nie ma.
const B_CELOWO = ['serwer/testy-konta.js', 'serwer/testy-dokumenty.js', 'narzedzia/sprawdz_zrodlo.py'];

// Obrazki spoza generatora ze znakiem: [plik, srodek x, srodek y, piksele na jednostke pola 32].
const INNE_ZE_ZNAKIEM = [
  // Zrzuty aplikacji do README (skala 2, znak 20 px w naglowku).
  ...['scoring', 'toolbar', 'workspace'].map((n) => [`docs/obrazy/screen-${n}.png`, 52, 48, 1.25]),
  // Grafiki ogloszenia premiery (LinkedIn i Product Hunt).
  ...['pl', 'en'].map((j) => [`dokumenty/ogloszenie/grafiki/linkedin-${j}.png`, 89, 81, 34 / 32]),
  ...['1-przeglad', '2-fakty', '3-oceny', '4-eksport', '5-cennik'].map((n) => [`dokumenty/ogloszenie/grafiki/ph-${n}.png`, 77, 67, 0.8]),
  ['dokumenty/ogloszenie/grafiki/ph-miniatura.png', 120, 120, 4.667],
];
// Obrazki bez znaku marki (sprawdzone 14.10.2026).
const BEZ_ZNAKU = ['docs/obrazy/screen-topics.png'];

let bledy = 0;
function sprawdz(nazwa, problemy) {
  const lista = [].concat(problemy).filter(Boolean);
  console.log(`  ${lista.length ? 'BLAD' : 'ok  '}  ${nazwa}${lista.length ? '\n          ' + lista.join('\n          ') : ''}`);
  if (lista.length) bledy++;
}

/* ---------- 1. Sciezka znaku w kodzie ---------- */

console.log('\n  znak w kodzie');
// Sciezki w <svg viewBox="0 0 32 32"> (znak w jednym kawalku albo w czterech ramionach spinnera) i kola w srodku.
function znakiSvg(html) {
  return [...html.matchAll(/<svg[^>]*viewBox="0 0 32 32"[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => ({
    d: [...m[1].matchAll(/<path[^>]* d="([^"]+)"/g)].map((p) => p[1]).join(' '),
    kolo: /<circle/.test(m[1]),
  }));
}
const tylkoA = (znaki) => (znaki.length ? znaki : [{ d: '(brak znaku)', kolo: false }])
  .flatMap(({ d, kolo }) => [d === ZNAK_A ? '' : 'inna sciezka niz znak A: ' + d.slice(0, 60), kolo ? 'kolo w srodku (znak B)' : '']);
// Stala JS sklejana z kilku napisow: const NAZWA = '...' + '...';
function stala(plik, nazwa) {
  const m = new RegExp(`const ${nazwa} = ((?:'[^']*'\\s*\\+?\\s*)+);`).exec(tekst(plik));
  return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('') : '';
}

for (const plik of ['app/pwa/icons/favicon.svg', 'showcase/favicon.svg']) sprawdz(`${plik}: znak A`, tylkoA(znakiSvg(tekst(plik))));
sprawdz('narzedzia/grafiki_marki.js: ZNAK to znak A', ZNAK === ZNAK_A ? [] : ['ZNAK: ' + ZNAK.slice(0, 60)]);
const sprite = (/<symbol id="i-znak"[^>]*>([\s\S]*?)<\/symbol>/.exec(tekst('showcase/zrodlo/czesci/ikony.html')) || [])[1] || '';
sprawdz('showcase/zrodlo/czesci/ikony.html: symbol i-znak to znak A', tylkoA([{ d: [...sprite.matchAll(/ d="([^"]+)"/g)].map((p) => p[1]).join(' '), kolo: /<circle/.test(sprite) }]));
sprawdz('serwer/logowanie.js: ZNAK_SCIEZKA to znak A (logo i favicon logowania i rejestracji)', stala('serwer/logowanie.js', 'ZNAK_SCIEZKA') === ZNAK_A ? [] : ['inna sciezka']);
sprawdz('serwer/dokumenty-prawne.js: ZNAK to znak A (logo i favicon dokumentow)', stala('serwer/dokumenty-prawne.js', 'ZNAK') === ZNAK_A ? [] : ['inna sciezka']);
for (const plik of ['app/contentai.src.html', 'app/web-keys.html', 'app/web-proxy.html', 'app/web-owner.html']) {
  const znaki = znakiSvg(tekst(plik));
  sprawdz(`${plik}: ${znaki.length} znakow (logo, pole na grafike, spinnery) to znak A`, [znaki.length >= 5 ? '' : `tylko ${znaki.length} znakow, oczekiwano co najmniej 5`, ...tylkoA(znaki)]);
}
const pliki = execFileSync('git', ['ls-files', '-z'], { cwd: REPO }).toString('utf8').split('\0').filter(Boolean);
const strony = pliki.filter((p) => /^showcase\/(.+\/)?index\.html$/.test(p));
sprawdz(`strona produktowa: ${strony.length} stron ma w sprite znak A`, strony.flatMap((p) => {
  const s = (/<symbol id="i-znak"[^>]*>([\s\S]*?)<\/symbol>/.exec(tekst(p)) || [])[1] || '';
  return tylkoA([{ d: [...s.matchAll(/ d="([^"]+)"/g)].map((x) => x[1]).join(' '), kolo: /<circle/.test(s) }]).map((b) => b && `${p}: ${b}`);
}));
// Obrazek przy linku z odciskiem tresci: LinkedIn i Facebook trzymaja obrazek pod danym adresem, wiec bez odcisku
// podglady linkow pokazywalyby stary znak jeszcze przez dni po wdrozeniu.
const odcisk = (p) => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(REPO, p))).digest('hex').slice(0, 10);
sprawdz('strona produktowa: og:image z odciskiem aktualnego obrazka (PL i EN)', strony.map((p) => {
  const m = /<meta property="og:image" content="https:\/\/content-ai\.net\/(obrazy\/og-(?:pl|en)\.png)\?v=([0-9a-f]{10})">/.exec(tekst(p));
  return !m ? `${p}: og:image bez odcisku ?v=` : m[2] !== odcisk('showcase/' + m[1]) ? `${p}: odcisk ${m[2]} nie pasuje do ${m[1]}` : '';
}));
const tekstowe = pliki.filter((p) => !p.startsWith('app/pwa/lib/') && !B_CELOWO.includes(p) && /\.(html|js|css|svg|py|md|json|txt|xml)$/.test(p));
sprawdz(`${tekstowe.length} plikow tekstowych bez fragmentow znaku B`, tekstowe.flatMap((p) => ZNAK_B.filter((f) => tekst(p).includes(f)).map((f) => `${p}: "${f}"`)));

/* ---------- 2. Znak w obrazkach ---------- */

// Kolor marki (#F6A623) po nalozeniu na czarne tlo; przezroczystosc liczy sie jak ciemne tlo. Brzeg wygladzony w 3/4 wciaz
// przechodzi, tlo ciemne i jasne nie.
function zloty([r, g, b, a]) {
  const k = a / 255;
  [r, g, b] = [r * k, g * k, b * k];
  return r >= 170 && g >= 100 && g <= 200 && b <= 110 && r - b >= 120;
}
// Znak A w (x, y) przy skali s: otwor w srodku (promien 3), kolor marki na przekatnej 4,2 jednostki od srodka (pas miedzy
// otworem a wewnetrznym rogiem gwiazdy, ponad 1 jednostke od kazdej krawedzi) i na ramionach 10 jednostek od srodka.
// Stara gwiazda z poswiata ma w srodku tylko kropke (promien ok. 1,4), wiec 2 jednostki od srodka ma juz kolor marki.
function znakA(obraz, [x, y, s]) {
  const p = (dx, dy) => obraz.piksel(Math.floor(x + dx * s), Math.floor(y + dy * s));
  const d = 4.2 / Math.SQRT2;
  return [
    zloty(p(0, 0)) ? 'w srodku znaku kolor marki (kropka znaku B), a powinien byc otwor' : '',
    [p(0, -2), p(2, 0), p(0, 2), p(-2, 0)].some(zloty) ? 'otwor w srodku mniejszy niz w znaku A (stara gwiazda z kropka)' : '',
    [p(d, -d), p(-d, d), p(d, d), p(-d, -d)].every(zloty) ? '' : 'na przekatnej brak koloru marki (przerwa miedzy ramionami jak w znaku B albo inny znak)',
    [p(0, -10), p(10, 0), p(0, 10), p(-10, 0)].every(zloty) ? '' : 'na ramionach brak koloru marki (brak znaku w tym miejscu)',
  ];
}
// PNG z pliku albo z ICO (pierwszy obraz).
function obraz(plik) {
  const b = fs.readFileSync(path.join(REPO, plik));
  return czytaj(plik.endsWith('.ico') ? b.subarray(b.readUInt32LE(18), b.readUInt32LE(18) + b.readUInt32LE(14)) : b);
}

console.log('\n  znak w obrazkach z narzedzia/grafiki_marki.js');
for (const g of GRAFIKI) {
  for (const plik of [...g.pliki, ...(g.ico ? [g.ico] : [])]) {
    const o = obraz(plik), k = g.skala || 1;
    sprawdz(`${plik} (${o.szer} x ${o.wys})`, [
      o.szer === g.w * k && o.wys === g.h * k ? '' : `rozmiar ${o.szer} x ${o.wys}, a generator rysuje ${g.w * k} x ${g.h * k}`,
      g.bezAlfy && o.typ !== 2 ? `ma kanal alfa (typ PNG ${o.typ}), a ikona z pelnym tlem musi byc RGB` : '',
      ...znakA(o, g.znak),
    ]);
  }
}
console.log('\n  znak w zrzutach i grafikach ogloszenia');
for (const [plik, ...znak] of INNE_ZE_ZNAKIEM) sprawdz(plik, znakA(obraz(plik), znak));

/* ---------- 3. Zaden obrazek poza kontrola ---------- */

console.log('\n  obrazki w repozytorium');
const znane = new Set([...GRAFIKI.flatMap((g) => [...g.pliki, ...(g.ico ? [g.ico] : [])]), ...INNE_ZE_ZNAKIEM.map(([p]) => p), ...BEZ_ZNAKU]);
const obrazki = pliki.filter((p) => /\.(png|ico|icns)$/i.test(p) && !p.startsWith('app/pwa/lib/'));
sprawdz(`${obrazki.length} obrazkow PNG i ICO na listach (generator, inne ze znakiem, bez znaku)`,
  obrazki.filter((p) => !znane.has(p)).map((p) => `${p}: dopisz do narzedzia/grafiki_marki.js albo do list w tym tescie`));
sprawdz('listy nie wskazuja usunietych plikow', [...znane].filter((p) => !pliki.includes(p)).map((p) => `${p}: nie ma w repozytorium`));

console.log(bledy ? `\nBLEDOW: ${bledy}` : '\nZnak A wszedzie.');
process.exit(bledy ? 1 : 0);
