#!/usr/bin/env node
'use strict';
/*
 * Grafiki marki z jednego zrodla (znak z favicon.svg, kolor --c-akcent, krój Schibsted Grotesk z app/pwa/fonty):
 *   serwer/zasoby/poczta-znak.png   znak w naglowku e-maili (66 x 66, przezroczyste tlo, w mailu 22 x 22)
 *   dokumenty/marka/stripe-ikona.png  ikona do Stripe (Settings, Branding: Icon), 512 x 512, ciemne tlo
 *   dokumenty/marka/stripe-logo.png   logo do Stripe (Branding: Logo), 1200 x 300, przezroczyste tlo
 *
 * Uzycie (z katalogu repozytorium): node narzedzia/grafiki_marki.js
 * Zmienna CAI_CHROMIUM: sciezka do Chromium, gdy Playwright nie ma wlasnego.
 * Pliki sa w repozytorium, wiec skrypt uruchamia sie tylko po zmianie znaku albo koloru marki.
 */

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..');
const { chromium } = require('playwright');

const ZNAK = 'M16 1 L19.8 12.2 L18.12 13.88 A3 3 0 0 0 13.88 13.88 L12.2 12.2 Z M31 16 L19.8 19.8 L18.12 18.12 A3 3 0 0 0 18.12 13.88 L19.8 12.2 Z '
  + 'M16 31 L12.2 19.8 L13.88 18.12 A3 3 0 0 0 18.12 18.12 L19.8 19.8 Z M1 16 L12.2 12.2 L13.88 13.88 A3 3 0 0 0 13.88 18.12 L12.2 19.8 Z';
const ZLOTY = '#F6A623';   // --c-akcent
const CIEMNY = '#141413';  // tlo ikony aplikacji (app/pwa/icons/favicon.svg)
// Krój jako data: (strona z setContent nie wczytuje plikow file://, a bez kroju logo wyszloby szeryfowe).
const KROJ = 'data:font/woff2;base64,' + fs.readFileSync(path.join(REPO, 'app', 'pwa', 'fonty', 'schibsted-grotesk-latin-wght-normal.woff2')).toString('base64');

const svg = (rozmiar) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${rozmiar}" height="${rozmiar}"><path d="${ZNAK}" fill="${ZLOTY}"/></svg>`;

const GRAFIKI = [
  { plik: 'serwer/zasoby/poczta-znak.png', w: 66, h: 66, tlo: 'transparent', html: svg(66) },
  { plik: 'dokumenty/marka/stripe-ikona.png', w: 512, h: 512, tlo: CIEMNY,
    html: `<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">${svg(304)}</div>` },
  { plik: 'dokumenty/marka/stripe-logo.png', w: 1200, h: 300, tlo: 'transparent',
    html: `<div style="width:1200px;height:300px;display:flex;align-items:center;justify-content:center;gap:44px">${svg(150)}`
      + `<span style="font-family:Marka;font-weight:600;font-size:104px;letter-spacing:.14em;color:${CIEMNY};line-height:1">CONTENT AI</span></div>` },
];

(async () => {
  const b = await chromium.launch(process.env.CAI_CHROMIUM ? { executablePath: process.env.CAI_CHROMIUM } : {});
  try {
    for (const g of GRAFIKI) {
      const s = await b.newPage({ viewport: { width: g.w, height: g.h }, deviceScaleFactor: 1 });
      await s.setContent(`<!doctype html><html><head><style>@font-face{font-family:Marka;src:url("${KROJ}") format("woff2");font-weight:100 900}`
        + `html,body{margin:0;padding:0;background:${g.tlo}}</style></head><body>${g.html}</body></html>`);
      await s.evaluate(() => document.fonts.ready);
      if (g.html.includes('font-family:Marka') && !(await s.evaluate(() => document.fonts.check('600 104px Marka')))) throw new Error('brak kroju Schibsted Grotesk');
      const cel = path.join(REPO, g.plik);
      fs.mkdirSync(path.dirname(cel), { recursive: true });
      await s.screenshot({ path: cel, omitBackground: g.tlo === 'transparent', clip: { x: 0, y: 0, width: g.w, height: g.h } });
      console.log(`${g.plik}  ${g.w} x ${g.h}  ${fs.statSync(cel).size} B`);
      await s.close();
    }
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
