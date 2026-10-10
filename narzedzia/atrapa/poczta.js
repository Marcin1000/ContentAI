#!/usr/bin/env node
'use strict';
/*
 * Atrapa dostawcy poczty (API jak Resend) dla testow Content AI (wykonawca C).
 * Ksztalt jak narzedzia/atrapa/dostawcy.js: czysta obsluz(metoda, sciezka, naglowki, bufor)
 * -> { status, naglowki, cialo, rodzaj }, uruchom(port, opcje) -> http.Server.
 *
 *   POST /emails                 jak Resend: Authorization: Bearer <klucz> (domyslnie re_atrapa),
 *                                pola from, to, subject i text albo html; zapisuje wiadomosc, odpowiada
 *                                { id }. Ten sam Idempotency-Key -> ta sama odpowiedz bez drugiej wiadomosci.
 *   GET  /domains                lista domen z polami open_tracking i click_tracking (jak Resend)
 *   GET  /_atrapa/poczta?do=     zapisane wiadomosci (do 200) z wyciagnietymi odnosnikami (linki: [])
 *   GET  /_atrapa/wywolania?n=   ostatnie wywolania (do 200), z naglowkiem Idempotency-Key
 *   GET  /zdrowie                200
 * Bledy znacznikiem w temacie albo w adresie odbiorcy (np. ola+atrapa-500-raz@example.com):
 *   atrapa-429, atrapa-500 (zawsze), atrapa-500-raz (pierwsza proba z danym Idempotency-Key, ponowienie
 *   przechodzi), atrapa-siec (zerwane polaczenie). KONF.sledzenie = true: GET /domains pokazuje
 *   wlaczone sledzenie otwarc i klikniec (test ostrzezenia w poczta-test).
 *
 * Start:  node narzedzia/atrapa/poczta.js   (port z ATRAPA_POCZTA_PORT, domyslnie 9202)
 * Modul:  const srv = require('../narzedzia/atrapa/poczta.js').uruchom(0);
 *   Serwer aplikacji wskazuje atrape zmiennymi CAI_POCZTA=resend, CAI_POCZTA_KLUCZ=re_atrapa,
 *   CAI_POCZTA_OD="Content AI <konto@example.com>", CAI_POCZTA_URL=http://127.0.0.1:<port>.
 */

const http = require('http');
const crypto = require('crypto');

const WERSJA = '1';

const KONF = {
  port: Number(process.env.ATRAPA_POCZTA_PORT || 9202),
  host: process.env.ATRAPA_HOST || '127.0.0.1',
  klucz: process.env.ATRAPA_POCZTA_KLUCZ || 're_atrapa',
  sledzenie: false,
};

const ostatnie = [];
const poczta = [];
const idempotencja = new Map();   // klucz -> { status, cialo, proby }

function zapiszWywolanie(wpis) {
  ostatnie.push(wpis);
  if (ostatnie.length > 200) ostatnie.shift();
}

function json(status, obiekt, rodzaj, dod = {}) {
  return { status, naglowki: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, dod), cialo: JSON.stringify(obiekt), rodzaj };
}

function bladResend(status, name, message, rodzaj) {
  return json(status, { statusCode: status, name, message }, rodzaj);
}

const linki = (tekst) => [...new Set(String(tekst || '').match(/https?:\/\/[^\s"'<>]+/g) || [])];

function wyczysc() {
  ostatnie.length = 0;
  poczta.length = 0;
  idempotencja.clear();
}

/** Wspolna obsluga: (metoda, sciezka z query, naglowki, bufor ciala) -> { status, naglowki, cialo, rodzaj }. */
function obsluz(metoda, sciezkaPelna, naglowki = {}, bufor = Buffer.alloc(0)) {
  const [sciezka, zapytanie = ''] = String(sciezkaPelna || '/').split('?');
  const sc = sciezka.replace(/\/+$/, '') || '/';
  const parametry = new URLSearchParams(zapytanie);
  if (metoda === 'GET' && (sc === '/zdrowie' || sc === '/health')) {
    return json(200, { ok: true, atrapa: 'poczta', wersja: WERSJA, port: KONF.port, gotowa: true }, 'zdrowie');
  }
  if (metoda === 'GET' && sc === '/_atrapa/wywolania') {
    return json(200, ostatnie.slice(-Number(parametry.get('n') || 50)), 'wywolania');
  }
  if (metoda === 'GET' && sc === '/_atrapa/poczta') {
    const adres = String(parametry.get('do') || '').toLowerCase();
    return json(200, poczta.filter((w) => !adres || w.to.some((t) => String(t).toLowerCase() === adres)), 'poczta');
  }
  const autoryzacja = String(naglowki.authorization || '');
  if (autoryzacja !== `Bearer ${KONF.klucz}`) {
    return bladResend(401, autoryzacja ? 'validation_error' : 'missing_api_key', autoryzacja ? 'API key is invalid' : 'Missing API key in the authorization header', 'zly-klucz');
  }
  if (metoda === 'GET' && sc === '/domains') {
    return json(200, { data: [{ id: 'dom_atrapa', name: 'example.com', status: 'verified', open_tracking: KONF.sledzenie, click_tracking: KONF.sledzenie }] }, 'domeny');
  }
  if (metoda !== 'POST' || sc !== '/emails') {
    return bladResend(404, 'not_found', `atrapa poczty: nieznana sciezka ${metoda} ${sc}`, 'brak');
  }
  let cialo;
  try { cialo = JSON.parse(bufor.toString('utf8') || '{}'); } catch { return bladResend(422, 'validation_error', 'Invalid JSON', 'zly-json'); }
  const do_ = Array.isArray(cialo.to) ? cialo.to : [cialo.to].filter(Boolean);
  if (!cialo.from || !do_.length || !cialo.subject || !(cialo.text || cialo.html)) {
    return bladResend(422, 'validation_error', 'Missing required field: from, to, subject and text or html', 'brak-pola');
  }
  const znaczniki = `${cialo.subject} ${do_.join(' ')}`;
  const klucz = String(naglowki['idempotency-key'] || '');
  const zapamietany = klucz ? idempotencja.get(klucz) : null;
  if (zapamietany && zapamietany.status === 200) return { ...zapamietany.wynik, rodzaj: 'powtorzona' };
  const proba = (zapamietany ? zapamietany.proby : 0) + 1;
  const zapamietaj = (wynik) => { if (klucz) idempotencja.set(klucz, { status: wynik.status, wynik, proby: proba }); return wynik; };
  if (/atrapa-siec/.test(znaczniki)) return { status: 0, naglowki: {}, cialo: '', rodzaj: 'siec' };
  if (/atrapa-429/.test(znaczniki)) return zapamietaj(bladResend(429, 'rate_limit_exceeded', 'Too many requests', 'blad-429'));
  if (/atrapa-500-raz/.test(znaczniki) && proba === 1) return zapamietaj(bladResend(500, 'internal_server_error', 'atrapa: blad przy pierwszej probie', 'blad-500-raz'));
  if (/atrapa-500(?!-raz)/.test(znaczniki)) return zapamietaj(bladResend(500, 'internal_server_error', 'atrapa: blad serwera', 'blad-500'));
  const id = crypto.randomUUID();
  poczta.push({
    id, czas: new Date().toISOString(), from: cialo.from, to: do_, subject: cialo.subject, text: cialo.text || '', html: cialo.html || '',
    reply_to: cialo.reply_to || null, tags: cialo.tags || [], idempotencja: klucz || null, linki: linki(`${cialo.text || ''} ${cialo.html || ''}`),
  });
  if (poczta.length > 200) poczta.shift();
  return zapamietaj(json(200, { id }, 'wyslana'));
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
      if (!req.url.startsWith('/_atrapa/') && !req.url.startsWith('/zdrowie')) {
        zapiszWywolanie({
          czas: new Date().toISOString(), metoda: req.method, sciezka: req.url, status: wynik.status, rodzaj: wynik.rodzaj,
          idempotencja: req.headers['idempotency-key'] || null,
        });
      }
      if (wynik.status === 0) { req.socket.destroy(); return; }
      const cialo = Buffer.from(String(wynik.cialo || ''), 'utf8');
      res.writeHead(wynik.status, Object.assign({}, wynik.naglowki, { 'content-length': cialo.length }));
      res.end(cialo);
    });
  });
  serwer.listen(port, host, () => {
    if (require.main === module) console.log(`[atrapa] poczta (Resend) na http://${host}:${serwer.address().port}, klucz ${KONF.klucz}`);
  });
  return serwer;
}

module.exports = { obsluz, uruchom, wyczysc, KONF, WERSJA, ostatnie, poczta };

if (require.main === module) uruchom();
