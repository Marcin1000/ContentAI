#!/usr/bin/env node
'use strict';
/*
 * Atrapa dostawcy poczty (API jak Resend) dla testow Content AI (wykonawca C). ZASLEPKA ETAPU 0.
 * Ksztalt jak narzedzia/atrapa/dostawcy.js: czysta obsluz(metoda, sciezka, naglowki, bufor)
 * -> { status, naglowki, cialo, rodzaj }, uruchom(port, opcje) -> http.Server,
 * GET /zdrowie, GET /_atrapa/wywolania (ostatnie wywolania, do 200, ?n=20).
 *
 * Pelny zakres (C, PROJEKT-TECHNICZNY 11.1):
 *   POST /emails jak Resend: sprawdza Authorization: Bearer re_atrapa, pola from, to, subject, text|html;
 *     zapisuje wiadomosc, odpowiada { id };
 *   GET /_atrapa/poczta?do=<adres>: zapisane wiadomosci z wyciagnietymi odnosnikami (linki: []);
 *   bledy znacznikiem w temacie: [atrapa:429], [atrapa:500].
 *
 * Start:  node narzedzia/atrapa/poczta.js   (port z ATRAPA_POCZTA_PORT, domyslnie 9202)
 * Modul:  const srv = require('../narzedzia/atrapa/poczta.js').uruchom(0);
 *   Serwer aplikacji wskazuje atrape zmiennymi CAI_POCZTA=resend, CAI_POCZTA_KLUCZ=re_atrapa,
 *   CAI_POCZTA_URL=http://127.0.0.1:<port>.
 *
 * Etap 0: /zdrowie i /_atrapa/wywolania dzialaja, kazda inna sciezka -> 501 w formacie bledu Resend.
 */

const http = require('http');

const WERSJA = '0';

const KONF = {
  port: Number(process.env.ATRAPA_POCZTA_PORT || 9202),
  host: process.env.ATRAPA_HOST || '127.0.0.1',
};

const ostatnie = [];

function zapiszWywolanie(wpis) {
  ostatnie.push(wpis);
  if (ostatnie.length > 200) ostatnie.shift();
}

function json(status, obiekt, rodzaj, dod = {}) {
  return { status, naglowki: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, dod), cialo: JSON.stringify(obiekt), rodzaj };
}

/** Wspolna obsluga: (metoda, sciezka z query, naglowki, bufor ciala) -> { status, naglowki, cialo, rodzaj }. */
function obsluz(metoda, sciezkaPelna) {
  const [sciezka] = String(sciezkaPelna || '/').split('?');
  const sc = sciezka.replace(/\/+$/, '') || '/';
  if (metoda === 'GET' && (sc === '/zdrowie' || sc === '/health')) {
    return json(200, { ok: true, atrapa: 'poczta', wersja: WERSJA, port: KONF.port, gotowa: false }, 'zdrowie');
  }
  if (metoda === 'GET' && sc === '/_atrapa/wywolania') {
    const n = Number((String(sciezkaPelna).match(/[?&]n=(\d+)/) || [])[1] || 50);
    return json(200, ostatnie.slice(-n), 'wywolania');
  }
  return json(501, { statusCode: 501, name: 'not_implemented', message: 'atrapa poczty: niezaimplementowane (etap 0), ' + metoda + ' ' + sc },
    'niezaimplementowane');
}

/**
 * Serwer atrapy. uruchom(port, { host }) -> http.Server (nasluchuje od razu;
 * przy porcie 0 adres z serwer.address().port po zdarzeniu 'listening').
 */
function uruchom(port = KONF.port, opcje = {}) {
  const host = opcje.host || KONF.host;
  const serwer = http.createServer((req, res) => {
    const kawalki = [];
    req.on('data', (c) => kawalki.push(c));
    req.on('end', () => {
      const bufor = Buffer.concat(kawalki);
      let wynik;
      try {
        wynik = obsluz(req.method, req.url, req.headers, bufor);
      } catch (e) {
        wynik = json(500, { statusCode: 500, name: 'internal_server_error', message: 'atrapa poczty: ' + e.message }, 'wyjatek');
      }
      const cialo = Buffer.from(String(wynik.cialo || ''), 'utf8');
      res.writeHead(wynik.status, Object.assign({}, wynik.naglowki, { 'content-length': cialo.length }));
      res.end(cialo);
      if (!req.url.startsWith('/_atrapa/') && !req.url.startsWith('/zdrowie')) {
        zapiszWywolanie({ czas: new Date().toISOString(), metoda: req.method, sciezka: req.url, status: wynik.status, rodzaj: wynik.rodzaj });
      }
    });
  });
  serwer.listen(port, host, () => {
    if (require.main === module) console.log(`[atrapa] poczta (zaslepka) na http://${host}:${serwer.address().port}`);
  });
  return serwer;
}

module.exports = { obsluz, uruchom, KONF, WERSJA };

if (require.main === module) uruchom();
