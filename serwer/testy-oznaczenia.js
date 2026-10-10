'use strict';

// ─── Testy: oznaczenia AI (wykonawca D, PROJEKT-TECHNICZNY 9 i 11.2) ─────────
//
// 1. Stala serwera (serwer/oznaczenia.js) jest ta sama co OZNACZENIA_DOMYSLNE w aplikacji
//    (app/contentai.src.html): warianty keys i owner nie maja serwera, wiec znaja tylko kopie
//    w aplikacji. Zmiana tresci etykiety w jednym miejscu bez drugiego = blad tego testu.
// 2. dlaKonta, sprawdzUstawienia, polaczWybor, zrodloDla: wybor uzytkownika, blokady
//    'zawsze'/'nigdy', awaryjne wylaczenie (CAI_OZNACZENIA=0), kod zrodla tekstu przerobionego.
// 3. /api/konto.oznaczenia i POST /api/konto/ustawienia (tylko znane pola logiczne, wybor
//    zostaje w koncie): na serwerze z modulem kont (A1). Zaslepka etapu 0 odpowiada 501 -
//    wtedy ta czesc sie nie wykonuje i mowi o tym w wyniku.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');

const oznaczenia = require('./oznaczenia.js');

/** OZNACZENIA_DOMYSLNE ze zrodla aplikacji: literal obiektu wyciety po nawiasach i policzony w vm. */
function stalaAplikacji() {
  const zrodlo = fs.readFileSync(path.join(__dirname, '..', 'app', 'contentai.src.html'), 'utf8');
  const start = zrodlo.indexOf('const OZNACZENIA_DOMYSLNE = {');
  if (start < 0) return null;
  const od = zrodlo.indexOf('{', start);
  let glebokosc = 0;
  let w = null;
  for (let i = od; i < zrodlo.length; i++) {
    const z = zrodlo[i];
    if (w) {
      if (z === '\\') { i++; continue; }
      if (z === w) w = null;
      continue;
    }
    if (z === "'" || z === '"' || z === '`') { w = z; continue; }
    if (z === '{') glebokosc++;
    else if (z === '}' && --glebokosc === 0) return vm.runInNewContext('(' + zrodlo.slice(od, i + 1) + ')');
  }
  return null;
}

function rowne(a, b) {
  try { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); return true; } catch { return false; }
}

async function testyApiKonta(sprawdz) {
  const { uruchomSerwer } = require('./testy-wspolne.js');
  const t = await uruchomSerwer({});
  try {
    const cookie = await t.zaloguj('standard');
    const stan = await t.zadanie('/api/konto', { headers: { cookie } });
    if (stan.status === 501) {
      console.log('  info  /api/konto i /api/konto/ustawienia: modul kont (A1) jeszcze nie scalony, ta czesc po scaleniu');
      return;
    }
    const d = await stan.json();
    sprawdz('oznaczenia: /api/konto.oznaczenia to stala z wyborem uzytkownika (domyslnie tekst bez etykiety, audio z zapowiedzia)',
      Boolean(d.oznaczenia) && d.oznaczenia.wersja === oznaczenia.OZNACZENIA.wersja && d.oznaczenia.wlaczone === true
      && d.oznaczenia.uzytkownik && d.oznaczenia.uzytkownik.tekst === false && d.oznaczenia.uzytkownik.audio === true
      && d.oznaczenia.tekst.tresc.pl === oznaczenia.OZNACZENIA.tekst.tresc.pl);
    const zle = await t.zadanie('/api/konto/ustawienia', t.json(cookie, { oznaczenia: { tekst: 'tak' } }));
    const obce = await t.zadanie('/api/konto/ustawienia', t.json(cookie, { oznaczenia: { wideo: true } }));
    const ok = await t.zadanie('/api/konto/ustawienia', t.json(cookie, { oznaczenia: { tekst: true } }));
    const okD = ok.status === 200 ? await ok.json() : {};
    const drugi = await t.zadanie('/api/konto/ustawienia', t.json(cookie, { oznaczenia: { grafika: true } }));
    const poD = await (await t.zadanie('/api/konto', { headers: { cookie } })).json();
    sprawdz('oznaczenia: POST /api/konto/ustawienia przyjmuje tylko znane rodzaje i wartosci logiczne (400 dla innych)',
      zle.status === 400 && obce.status === 400 && ok.status === 200 && drugi.status === 200);
    sprawdz('oznaczenia: wybor zostaje w koncie i laczy sie z poprzednim (tekst i grafika wlaczone, audio domyslne)',
      Boolean(okD.oznaczenia) && okD.oznaczenia.uzytkownik.tekst === true
      && poD.oznaczenia.uzytkownik.tekst === true && poD.oznaczenia.uzytkownik.grafika === true && poD.oznaczenia.uzytkownik.audio === true);
  } finally {
    await t.zamknij();
  }
}

async function uruchom({ sprawdz }) {
  console.log('\n  oznaczenia AI (D) - stala w aplikacji, wybor uzytkownika, kody zrodla');
  const zApp = stalaAplikacji();
  sprawdz('oznaczenia: aplikacja ma OZNACZENIA_DOMYSLNE rowne stalej serwera (etykiety PL/EN/DE/CS, kody IPTC i schema.org)',
    zApp !== null && rowne(zApp, oznaczenia.OZNACZENIA));
  const O = oznaczenia.OZNACZENIA;
  sprawdz('oznaczenia: stala zawiera kody tresci zlozonej (PR8-18), slowa kluczowe plikow i krotka etykiete przerobek',
    /compositeWithTrainedAlgorithmicMedia$/.test(O.zrodloIptcZlozone || '') && /CompositeWithTrainedAlgorithmicMediaDigitalSource$/.test(O.zrodloSchemaZlozone || '')
    && /AI-generated/.test(O.slowaKluczowe || '') && /Content AI/.test(O.slowaKluczowe || '')
    && ['pl', 'en', 'de', 'cs'].every((j) => Boolean(O.tekst.krotka && O.tekst.krotka[j]) && Boolean(O.grafika.tresc[j]) && Boolean(O.audio.tresc[j])));

  const zapisane = oznaczenia.dlaKonta({ oznaczenia: { tekst: true, grafika: false, audio: false } }, { oznaczenia: true });
  sprawdz('oznaczenia: dlaKonta bierze wybor zapisany w koncie, a CAI_OZNACZENIA=0 wylacza calosc (wlaczone=false)',
    zapisane.uzytkownik.tekst === true && zapisane.uzytkownik.audio === false && zapisane.wlaczone === true
    && oznaczenia.dlaKonta(null, { oznaczenia: false }).wlaczone === false);
  // Wartosci 'zawsze' i 'nigdy' nie daja sie zmienic przelacznikiem.
  const etykieta = O.tekst.etykieta;
  try {
    O.tekst.etykieta = 'zawsze';
    const zawsze = oznaczenia.dlaKonta({ oznaczenia: { tekst: false } }, {}).uzytkownik.tekst;
    O.tekst.etykieta = 'nigdy';
    const nigdy = oznaczenia.dlaKonta({ oznaczenia: { tekst: true } }, {}).uzytkownik.tekst;
    sprawdz('oznaczenia: etykieta "zawsze" i "nigdy" wygrywa z zapisanym wyborem', zawsze === true && nigdy === false);
  } finally {
    O.tekst.etykieta = etykieta;
  }
  sprawdz('oznaczenia: sprawdzUstawienia odrzuca nieznane pola, napisy i tablice',
    oznaczenia.sprawdzUstawienia({ tekst: true, audio: false }).ok && !oznaczenia.sprawdzUstawienia({ tekst: 1 }).ok
    && !oznaczenia.sprawdzUstawienia({ tekst: true, wideo: true }).ok && !oznaczenia.sprawdzUstawienia([true]).ok
    && oznaczenia.sprawdzUstawienia({ grafika: true }).oznaczenia.grafika === true);
  sprawdz('oznaczenia: polaczWybor laczy zapisany wybor z nowym i pomija nieznane rodzaje',
    typeof oznaczenia.polaczWybor === 'function'
    && rowne(oznaczenia.polaczWybor({ tekst: true, wideo: true }, { grafika: true }), { tekst: true, grafika: true })
    && rowne(oznaczenia.polaczWybor({ tekst: true }, { tekst: false }), { tekst: false })
    && rowne(oznaczenia.polaczWybor(null, { audio: 'tak' }), {}));
  sprawdz('oznaczenia: zrodloDla - tekst uzytkownika przerobiony przez AI dostaje kod tresci zlozonej, reszta trainedAlgorithmicMedia',
    typeof oznaczenia.zrodloDla === 'function'
    && oznaczenia.zrodloDla('zlozone').iptc === O.zrodloIptcZlozone && oznaczenia.zrodloDla('zlozone').schema === O.zrodloSchemaZlozone
    && oznaczenia.zrodloDla('ai').iptc === O.zrodloIptc && oznaczenia.zrodloDla(undefined).schema === O.zrodloSchema);

  await testyApiKonta(sprawdz);
}

module.exports = { uruchom, stalaAplikacji };
