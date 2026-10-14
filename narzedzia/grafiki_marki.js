#!/usr/bin/env node
'use strict';
/*
 * Grafiki marki z jednego zrodla: znak A (ten sam co app/pwa/icons/favicon.svg), kolor --c-akcent i kroje z app/pwa/fonty.
 * Zgloszenie 14.10.2026 "jeden znak (A) wszedzie": ikony aplikacji i strony, obrazki OG i grafiki README mialy jeszcze
 * znak B (ramiona z przerwami i kropka w srodku), a ikony aplikacji natywnych starsza gwiazde z poswiata.
 *   serwer/zasoby/poczta-znak.png                      znak w naglowku e-maili (66 x 66, przezroczyste tlo, w mailu 22 x 22)
 *   dokumenty/marka/stripe-ikona.png, stripe-logo.png  ikona i logo do Stripe (Settings, Branding)
 *   app/pwa/icons/favicon-32.png, showcase/favicon.ico favicon w PNG i ICO, wprost z favicon.svg
 *   app/pwa/icons/znak-*.png                           ikony aplikacji: zwykle (zaokraglony kwadrat), maskable i Apple (pelne tlo)
 *   showcase/obrazy/icon-*.png, apple-touch-icon.png   te same ikony dla strony produktowej
 *   showcase/obrazy/og-pl.png, og-en.png               obrazek przy linku (LinkedIn, Facebook, X): haslo i przyklad z teksty.json
 *   docs/obrazy/banner-*.png, architecture-*.png       grafiki README w motywie ciemnym i jasnym GitHuba
 *   pakowanie/capacitor/..., pakowanie/electron/...    ikony Android (zwykla, okragla, adaptacyjna), iOS i Electron, ekran startowy
 *
 * Uzycie (z katalogu repozytorium): node narzedzia/grafiki_marki.js [fragment-sciezki ...]
 *   bez argumentow tworzy wszystkie pliki, z argumentami tylko te, ktorych sciezka zawiera ktorys fragment ("og-", "pakowanie").
 * Zmienna CAI_CHROMIUM: sciezka do Chromium, gdy Playwright nie ma wlasnego.
 * Pliki sa w repozytorium, wiec skrypt uruchamia sie tylko po zmianie znaku, koloru marki albo tekstow hero.
 * Pole "znak" kazdej grafiki (srodek znaku w pikselach pliku i piksele na jednostke pola 32 x 32) czyta narzedzia/test_znak.js.
 * Generator przy kazdym renderze porownuje je z ukladem strony, wiec pole nie rozjedzie sie z grafika.
 */

const path = require('path');
const fs = require('fs');
const { czytaj, bezAlfy } = require('./png.js');

const REPO = path.resolve(__dirname, '..');

const ZNAK = 'M16 1 L19.8 12.2 L18.12 13.88 A3 3 0 0 0 13.88 13.88 L12.2 12.2 Z M31 16 L19.8 19.8 L18.12 18.12 A3 3 0 0 0 18.12 13.88 L19.8 12.2 Z '
  + 'M16 31 L12.2 19.8 L13.88 18.12 A3 3 0 0 0 18.12 18.12 L19.8 19.8 Z M1 16 L12.2 12.2 L13.88 13.88 A3 3 0 0 0 13.88 18.12 L12.2 19.8 Z';
const ZLOTY = '#F6A623';   // --c-akcent
const CIEMNY = '#141413';  // tlo ikony aplikacji (app/pwa/icons/favicon.svg)
const TLO = '#111110';     // --c-tlo: tlo aplikacji i strony w motywie ciemnym

// Kroje jak w aplikacji (te same pliki i zakresy znakow), jako data: - strona z setContent nie wczytuje plikow file://.
const LACINKA = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LACINKA_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const RODZINY = [['Schibsted Grotesk', 'schibsted-grotesk', '400 900'], ['Literata', 'literata', '200 900'], ['JetBrains Mono', 'jetbrains-mono', '100 800']];
let krojeCss = '';
function kroje() {
  if (!krojeCss) {
    const dane = (plik) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(REPO, 'app', 'pwa', 'fonty', plik + '.woff2')).toString('base64');
    krojeCss = RODZINY.map(([rodzina, plik, waga]) => [['latin', LACINKA], ['latin-ext', LACINKA_EXT]].map(([zakres, znaki]) =>
      `@font-face{font-family:"${rodzina}";font-weight:${waga};src:url("${dane(`${plik}-${zakres}-wght-normal`)}") format("woff2");unicode-range:${znaki}}`).join('')).join('');
  }
  return krojeCss;
}

// Znak w polu rozm x rozm px. id="znak" dostaje tylko ten znak, ktorego polozenie opisuje pole "znak" grafiki.
const svg = (rozm, { kolor = ZLOTY, id = '' } = {}) => `<svg${id ? ` id="${id}"` : ''} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" `
  + `width="${rozm}" height="${rozm}" style="display:block"><path d="${ZNAK}" fill="${kolor}"/></svg>`;

// Ikona bok x bok: tlo (pelny kwadrat, zaokraglony kwadrat jak favicon, kolo albo brak) i znak na srodku.
// rozp: rozpietosc znaku od konca do konca ramion jako ulamek boku (ramiona siegaja od 1 do 31 w polu 32).
// Pole znaku ma parzysta liczbe pikseli, wiec srodek wypada na granicy pikseli i krawedzie sa ostre.
function ikona(bok, rozp, ksztalt, tlo = CIEMNY) {
  const rozm = 2 * Math.round(bok * rozp * 16 / 30), od = (bok - rozm) / 2;
  const promien = { pelne: 0, zaokraglone: bok * 7.5 / 32, kolo: bok / 2 }[ksztalt];
  const pole = ksztalt === 'brak' ? '' : `<div style="position:absolute;inset:0;background:${tlo};border-radius:${promien}px"></div>`;
  return {
    w: bok, h: bok, tlo: ksztalt === 'pelne' ? tlo : 'transparent',
    // Pelne tlo bez kanalu alfa: tego wymaga App Store, a maskable i Apple i tak przycina system.
    bezAlfy: ksztalt === 'pelne',
    html: () => `<div style="position:relative;width:${bok}px;height:${bok}px">${pole}<div style="position:absolute;left:${od}px;top:${od}px">${svg(rozm, { id: 'znak' })}</div></div>`,
    znak: [bok / 2, bok / 2, rozm / 32],
  };
}

// Obrazek przy linku do strony (og:image, 1200 x 630): haslo i przyklad z Faktami z tych samych tekstow co hero strony.
function og(jezyk) {
  const t = JSON.parse(fs.readFileSync(path.join(REPO, 'showcase', 'zrodlo', 'teksty.json'), 'utf8'))[jezyk];
  const ikony = fs.readFileSync(path.join(REPO, 'showcase', 'zrodlo', 'czesci', 'ikony.html'), 'utf8');
  const [, pole, logotyp] = /<symbol id="i-logotyp" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/.exec(ikony);
  const zakr = (gdzie, wys) => `background:linear-gradient(rgba(246,166,35,.30),rgba(246,166,35,.30)) no-repeat 0 ${gdzie}/100% ${wys}`;
  return `<style>
body{width:1200px;height:630px;overflow:hidden;color:#EDEBE6;font-family:"Schibsted Grotesk";position:relative}
body::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(237,235,230,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(237,235,230,.04) 1px,transparent 1px);background-size:32px 32px;-webkit-mask-image:radial-gradient(ellipse 60% 80% at 80% 40%,#000,transparent 75%)}
.l{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:14px}
h1{position:absolute;left:72px;top:150px;width:600px;font-family:Literata;font-weight:560;font-size:62px;line-height:1.06;letter-spacing:-.025em}
.zakr{${zakr('86%', '32%')};-webkit-box-decoration-break:clone}
.d{position:absolute;left:72px;bottom:60px;font-family:"JetBrains Mono";font-size:20px;color:#A29E95;letter-spacing:.02em}.d b{color:${ZLOTY};font-weight:500}
.k{position:absolute;right:-30px;top:96px;width:460px;border-radius:20px;background:#171715;border:1px solid #363632;box-shadow:0 40px 90px -30px #000;padding:28px}
.k h2{font-family:Literata;font-weight:600;font-size:22px;line-height:1.3;margin-bottom:12px}.k p{font-family:Literata;font-size:17px;line-height:1.7}
.m{${zakr('90%', '36%')};text-decoration:underline 1.5px #F47C7C;text-underline-offset:4px}
.n{margin-top:18px;display:flex;gap:10px;padding:12px 14px;border-radius:10px;border:1px solid #6F3F3E;background:#362523;font-size:16px}.n b{color:#F47C7C}
.w{display:flex;gap:10px;margin-top:18px}.w span{flex:1;border:1px solid #363632;border-radius:8px;padding:8px 10px;font-size:12px;color:#A29E95;font-weight:600;background:#1E1E1B}
.w i{display:block;font-style:normal;font-family:"JetBrains Mono";font-size:22px;color:#EDEBE6}
</style>
<div class="l">${svg(34, { id: 'znak' })}<svg width="164" height="16.3" viewBox="${pole}" style="display:block;color:#EDEBE6">${logotyp}</svg></div>
<h1>${t['hero-h1']}</h1>
<p class="d"><b>content-ai.net</b> · SEO · AIO · AEO · GEO</p>
<div class="k"><h2>${t['hero-demo-h']}</h2><p>${t['hero-demo-z2']}<span class="m">${t['hero-demo-z3']}</span>.</p>
<div class="n"><span style="margin-top:3px;flex-shrink:0">${svg(14, { kolor: '#F47C7C' })}</span><div><b>${t['hero-demo-flag']}</b><br><span style="color:#B9B6AE">${t['hero-demo-flag-p']}</span></div></div>
<div class="w"><span>SEO<i>91</i></span><span>AIO<i>88</i></span><span>AEO<i>84</i></span><span>GEO<i>80</i></span></div></div>`;
}

// Grafiki README w obu motywach GitHuba (2560 px szerokosci, rysowane w skali 2).
const MOTYW = {
  dark: { tlo: '#111110', karta: '#171715', kartka: '#1B1B19', linia: '#2A2A27', ramka: '#3A3A36', tekst: '#EDEBE6', t2: '#B9B6AE', t3: '#8D8A82', zakr: 'rgba(246,166,35,.30)', sukces: '#5BC793', siatka: 'rgba(237,235,230,.035)', cien: '.45' },
  light: { tlo: '#F7F6F2', karta: '#FFFFFF', kartka: '#FFFEFB', linia: '#E3E1DB', ramka: '#CFCCC4', tekst: '#1B1A17', t2: '#4F4C45', t3: '#6B6860', zakr: 'rgba(246,166,35,.38)', sukces: '#1B7042', siatka: 'rgba(27,26,23,.045)', cien: '.10' },
};
const readmeCss = (m) => `<style>
body{color:${m.tekst};font-family:"Schibsted Grotesk";-webkit-font-smoothing:antialiased}
.siatka{position:absolute;inset:0;background-image:linear-gradient(${m.siatka} 1px,transparent 1px),linear-gradient(90deg,${m.siatka} 1px,transparent 1px);background-size:32px 32px}
.slowo{font:700 17px/1 "Schibsted Grotesk";letter-spacing:.22em}
.zakr{background:linear-gradient(${m.zakr},${m.zakr}) no-repeat 0 88%/100% 30%;padding:0 2px}
.chip{display:inline-flex;align-items:center;height:30px;padding:0 13px;border:1px solid ${m.ramka};border-radius:999px;font:500 13px/1 "Schibsted Grotesk";color:${m.t2}}
</style>`;

function baner(m) {
  const wyniki = [['88', 'SEO'], ['84', 'AIO'], ['83', 'AEO'], ['82', 'GEO']].map(([n, l]) => `<div style="flex:1;padding:12px 0 10px;border:1px solid ${m.linia};border-radius:10px;background:${m.kartka};text-align:center">`
    + `<div style="font:700 26px/1 'JetBrains Mono';color:${m.sukces}">${n}</div><div style="margin-top:6px;font:600 11px/1 'Schibsted Grotesk';letter-spacing:.1em;color:${m.t3}">${l}</div></div>`).join('');
  const zalety = ['Answer up front, with a number', 'Passages an AI can quote', 'Grounded in your own documents'].map((t) => `<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font:400 14px/1.3 'Schibsted Grotesk';color:${m.t2}">`
    + `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${m.sukces}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/></svg>${t}</div>`).join('');
  return `${readmeCss(m)}<div style="width:1280px;height:420px;position:relative;overflow:hidden">
<div class="siatka" style="-webkit-mask-image:linear-gradient(90deg,transparent 30%,#000 75%)"></div>
<div style="position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:14px">${svg(30, { id: 'znak' })}<span class="slowo">CONTENT AI</span></div>
<h1 style="position:absolute;left:64px;top:118px;width:690px;font:600 48px/1.12 Literata;letter-spacing:-.01em">AI content production for <span class="zakr">search and answer engines</span>.</h1>
<p style="position:absolute;left:64px;top:252px;width:600px;font:400 17px/1.55 'Schibsted Grotesk';color:${m.t2}">Articles, visuals and audio from one workspace, grounded in your own knowledge base and real search data.</p>
<div style="position:absolute;left:64px;top:336px;display:flex;gap:8px">${['SEO', 'AIO', 'AEO', 'GEO', 'RAG', 'Multi-provider', 'Self-hosted'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
<div style="position:absolute;right:64px;top:64px;width:390px;padding:22px 24px;background:${m.karta};border:1px solid ${m.linia};border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,${m.cien})">
<div style="display:flex;justify-content:space-between;font:600 11px/1 'Schibsted Grotesk';letter-spacing:.14em;color:${m.t3}"><span>RESULT</span><span>SCORED</span></div>
<div style="display:flex;gap:10px;margin-top:16px">${wyniki}</div>${zalety}</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,transparent 0,${ZLOTY} 35%,${ZLOTY} 65%,transparent 100%);opacity:.85"></div>
</div>`;
}

function architektura(m) {
  const karta = ([t, o]) => `<div style="flex:1;padding:16px 18px;background:${m.kartka};border:1px solid ${m.linia};border-radius:12px"><div style="font:600 15px/1.3 'Schibsted Grotesk'">${t}</div>`
    + `<div style="margin-top:6px;font:400 13px/1.45 'Schibsted Grotesk';color:${m.t2}">${o}</div></div>`;
  const pas = (etykieta, karty) => `<div style="padding:18px 20px 20px;background:${m.karta};border:1px solid ${m.linia};border-radius:16px">`
    + `<div style="font:500 11px/1 'JetBrains Mono';letter-spacing:.18em;color:${m.t3};margin-bottom:14px">${etykieta}</div><div style="display:flex;gap:12px">${karty.map(karta).join('')}</div></div>`;
  const strz = `<div style="display:flex;justify-content:center;padding:10px 0"><svg width="18" height="22" viewBox="0 0 18 22" fill="none" stroke="${ZLOTY}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1v19M2 13l7 7 7-7"/></svg></div>`;
  return `${readmeCss(m)}<div style="width:1280px;height:766px;position:relative;overflow:hidden;padding:44px 64px">
<div class="siatka" style="-webkit-mask-image:linear-gradient(180deg,#000,transparent 70%)"></div>
<div style="position:relative">
<div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">${svg(22, { id: 'znak' })}<span style="font:500 12px/1 'JetBrains Mono';letter-spacing:.18em;color:${m.t3}">ARCHITECTURE</span></div>
<div style="display:flex;justify-content:center"><div style="width:360px;padding:14px 18px;text-align:center;background:${m.karta};border:1px solid ${ZLOTY};border-radius:12px"><div style="font:600 16px/1.3 'Schibsted Grotesk'">User</div><div style="margin-top:4px;font:400 13px/1.4 'Schibsted Grotesk';color:${m.t2}">Browser or installed app, one login</div></div></div>
${strz}
${pas('CONTENT AI WORKSPACE', [['Content generation', 'SEO, AEO, AIO and GEO modes'], ['Knowledge base', 'RAG over your documents'], ['SEO &amp; SERP', 'Live results, gap analysis'], ['Image', 'Brand-styled visuals'], ['Audio', 'Narration and transcription']])}
${strz}
${pas('SERVER, PROXY AND SECURITY', [['Accounts and roles', 'Signed sessions, plans and usage limits'], ['API key custody', 'Server-side keys, or the user’s own key'], ['Provider abstraction', 'One request shape, many back ends']])}
${strz}
${pas('AI PROVIDERS', [['Commercial models', 'Anthropic, OpenAI, ElevenLabs'], ['Open-source models', 'NVIDIA NIM and compatible endpoints'], ['Search data', 'DataForSEO or OpenSEO']])}
</div></div>`;
}

// Favicon w PNG prosto z favicon.svg (znak w grupie translate(2.35) scale(0.8533): srodek 16, 0,8533 px na jednostke).
const faviconSvg = () => fs.readFileSync(path.join(REPO, 'app', 'pwa', 'icons', 'favicon.svg'), 'utf8').replace('<path ', '<path id="znak" ');

// ICO z jednym obrazem PNG (jak dotychczasowy favicon.ico: 32 x 32, PNG w srodku).
function ico(png) {
  const { szer, wys } = czytaj(png);
  const n = Buffer.alloc(22);
  n.writeUInt16LE(1, 2); n.writeUInt16LE(1, 4);
  n[6] = szer % 256; n[7] = wys % 256;
  n.writeUInt16LE(1, 10); n.writeUInt16LE(32, 12); n.writeUInt32LE(png.length, 14); n.writeUInt32LE(22, 18);
  return Buffer.concat([n, png]);
}

const GRAFIKI = [
  { pliki: ['serwer/zasoby/poczta-znak.png'], w: 66, h: 66, tlo: 'transparent', html: () => svg(66, { id: 'znak' }), znak: [33, 33, 66 / 32] },
  { pliki: ['dokumenty/marka/stripe-ikona.png'], w: 512, h: 512, tlo: CIEMNY, znak: [256, 256, 304 / 32],
    html: () => `<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">${svg(304, { id: 'znak' })}</div>` },
  { pliki: ['dokumenty/marka/stripe-logo.png'], w: 1200, h: 300, tlo: 'transparent', znak: [178.75, 150, 150 / 32],
    html: () => `<div style="width:1200px;height:300px;display:flex;align-items:center;justify-content:center;gap:44px">${svg(150, { id: 'znak' })}`
      + `<span style="font-family:'Schibsted Grotesk';font-weight:600;font-size:104px;letter-spacing:.14em;color:${CIEMNY};line-height:1">CONTENT AI</span></div>` },
  { pliki: ['app/pwa/icons/favicon-32.png'], ico: 'showcase/favicon.ico', w: 32, h: 32, tlo: 'transparent', html: faviconSvg, znak: [16, 16, 0.8533] },
  // Ikony aplikacji (PWA) i strony to te same pliki. Zwykla: zaokraglony kwadrat jak favicon. Maskable i Apple: pelne tlo
  // (system przycina je sam), znak w strefie bezpiecznej.
  { pliki: ['app/pwa/icons/znak-192.png', 'showcase/obrazy/icon-192.png'], ...ikona(192, 0.58, 'zaokraglone') },
  { pliki: ['app/pwa/icons/znak-512.png', 'showcase/obrazy/icon-512.png'], ...ikona(512, 0.58, 'zaokraglone') },
  { pliki: ['app/pwa/icons/znak-apple-180.png', 'showcase/obrazy/apple-touch-icon.png'], ...ikona(180, 0.5, 'pelne') },
  { pliki: ['app/pwa/icons/znak-maskable-192.png'], ...ikona(192, 0.5, 'pelne') },
  { pliki: ['app/pwa/icons/znak-maskable-512.png', 'showcase/obrazy/icon-maskable-512.png'], ...ikona(512, 0.5, 'pelne') },
  { pliki: ['showcase/obrazy/og-pl.png'], w: 1200, h: 630, tlo: TLO, jezyk: 'pl', html: () => og('pl'), znak: [89, 81, 34 / 32] },
  { pliki: ['showcase/obrazy/og-en.png'], w: 1200, h: 630, tlo: TLO, jezyk: 'en', html: () => og('en'), znak: [89, 81, 34 / 32] },
  ...Object.entries(MOTYW).flatMap(([nazwa, m]) => [
    { pliki: [`docs/obrazy/banner-${nazwa}.png`], w: 1280, h: 420, skala: 2, tlo: m.tlo, html: () => baner(m), znak: [158, 142, 60 / 32] },
    { pliki: [`docs/obrazy/architecture-${nazwa}.png`], w: 1280, h: 766, skala: 2, tlo: m.tlo, html: () => architektura(m), znak: [150, 110, 44 / 32] },
  ]),
  // Android: zwykla (zaokraglony kwadrat), okragla i pierwszy plan ikony adaptacyjnej (108 dp, z czego widac srodkowe 72 dp;
  // tlo z android-res/res/values/ic_launcher_background.xml), w pieciu gestosciach.
  ...[['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]].flatMap(([gestosc, k]) => [
    { pliki: [`pakowanie/capacitor/android-res/res/mipmap-${gestosc}/ic_launcher.png`], ...ikona(48 * k, 0.58, 'zaokraglone') },
    { pliki: [`pakowanie/capacitor/android-res/res/mipmap-${gestosc}/ic_launcher_round.png`], ...ikona(48 * k, 0.56, 'kolo') },
    { pliki: [`pakowanie/capacitor/android-res/res/mipmap-${gestosc}/ic_launcher_foreground.png`], ...ikona(108 * k, 0.35, 'brak') },
  ]),
  { pliki: ['pakowanie/capacitor/ios-res/AppIcon.appiconset/AppIcon-1024.png'], ...ikona(1024, 0.5, 'pelne') },
  { pliki: ['pakowanie/capacitor/resources/icon.png'], ...ikona(1024, 0.58, 'zaokraglone') },
  { pliki: ['pakowanie/capacitor/resources/splash.png', 'pakowanie/capacitor/resources/splash-dark.png'], ...ikona(2732, 0.19, 'pelne', TLO) },
  { pliki: ['pakowanie/electron/build/icon.png'], ...ikona(512, 0.58, 'zaokraglone') },
];

async function main(filtry) {
  const { chromium } = require('playwright');
  const wybrane = GRAFIKI.filter((g) => !filtry.length || [...g.pliki, g.ico || ''].some((p) => filtry.some((f) => p.includes(f))));
  if (!wybrane.length) throw new Error('zaden plik nie pasuje do: ' + filtry.join(', '));
  const b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
  try {
    for (const g of wybrane) {
      const skala = g.skala || 1;
      const s = await b.newPage({ viewport: { width: g.w, height: g.h }, deviceScaleFactor: skala });
      const html = g.html();
      await s.setContent(`<!doctype html><html lang="${g.jezyk || 'en'}"><head><meta charset="utf-8"><style>${kroje()}*{box-sizing:border-box;margin:0}`
        + `html,body{margin:0;padding:0;background:${g.tlo}}</style></head><body>${html}</body></html>`);
      await s.evaluate(() => document.fonts.ready);
      for (const [rodzina] of RODZINY) {
        if (html.includes(rodzina) && !(await s.evaluate((r) => [...document.fonts].some((f) => f.family.replace(/"/g, '') === r && f.status === 'loaded'), rodzina))) {
          throw new Error(`${g.pliki[0]}: nie wczytal sie kroj ${rodzina}`);
        }
      }
      // Srodek i skala znaku z ukladu strony (svg: pole 32 jednostek, sciezka favicon: ramiona od 1 do 31, czyli 30 jednostek).
      const zmierzono = await s.evaluate((k) => {
        const e = document.getElementById('znak');
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2, r.width / (e.tagName === 'path' ? 30 : 32)].map((v) => Math.round(v * k * 1000) / 1000);
      }, skala);
      if (!zmierzono || zmierzono.some((v, i) => Math.abs(v - g.znak[i]) > 0.01)) {
        throw new Error(`${g.pliki[0]}: znak jest w ${JSON.stringify(zmierzono)}, a pole "znak" mowi ${JSON.stringify(g.znak)}`);
      }
      let png = await s.screenshot({ omitBackground: g.tlo === 'transparent', clip: { x: 0, y: 0, width: g.w, height: g.h } });
      if (g.bezAlfy) png = bezAlfy(png);
      for (const [plik, dane] of [...g.pliki.map((p) => [p, png]), ...(g.ico ? [[g.ico, ico(png)]] : [])]) {
        const cel = path.join(REPO, plik);
        fs.mkdirSync(path.dirname(cel), { recursive: true });
        fs.writeFileSync(cel, dane);
        console.log(`${plik}  ${g.w * skala} x ${g.h * skala}  ${dane.length} B`);
      }
      await s.close();
    }
  } finally {
    await b.close();
  }
}

module.exports = { ZNAK, GRAFIKI };

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message || e); process.exit(1); });
