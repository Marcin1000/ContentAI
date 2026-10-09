#!/usr/bin/env node
'use strict';
/*
 * Atrapa Stripe dla testow platnosci Content AI (wykonawca B). ZASLEPKA ETAPU 0.
 * Ksztalt jak narzedzia/atrapa/dostawcy.js: czysta obsluz(metoda, sciezka, naglowki, bufor)
 * -> { status, naglowki, cialo, rodzaj }, uruchom(port, opcje) -> http.Server,
 * GET /zdrowie, GET /_atrapa/wywolania (ostatnie wywolania, do 200, ?n=20).
 *
 * Pelny zakres (B, PROJEKT-TECHNICZNY 11.1):
 *   stan w pamieci: klienci, sesje Checkout, subskrypcje (current_period_end na elemencie),
 *     faktury, ceny (ATRAPA_STRIPE_CENY albo price_atrapa_standard / price_atrapa_premium),
 *     sesje panelu, klucze idempotencji (ten sam klucz z innymi parametrami -> 400), zegar symulowany;
 *   API (form-urlencoded z nawiasami, Authorization: Bearer rk_test_atrapa, wymagany Stripe-Version):
 *     POST /v1/customers, GET /v1/customers/:id, POST /v1/checkout/sessions, GET /v1/checkout/sessions/:id,
 *     POST /v1/billing_portal/sessions, GET /v1/subscriptions?customer=&status=all, GET /v1/subscriptions/:id,
 *     POST /v1/subscriptions/:id (cancel_at_period_end), DELETE /v1/subscriptions/:id, GET /v1/prices/:id;
 *   strony przegladarki: GET /c/pay/:sesja, GET /p/session/:id (formularze bez JS);
 *   sterowanie: POST /_atrapa/zdarzenia/wyslij { typ, obiekt, kolejnosc, zlyPodpis, staryCzas, livemode },
 *     POST /_atrapa/czas { dni }, GET /_atrapa/stan; bledy ATRAPA_STRIPE_BLAD=<wyrazenie sciezki>:<status>[:<razy>].
 *
 * Start:  node narzedzia/atrapa/stripe.js   (port z ATRAPA_STRIPE_PORT, domyslnie 9201)
 * Modul:  const srv = require('../narzedzia/atrapa/stripe.js').uruchom(0, { sekret, webhook });
 *   sekret:  sekret podpisu webhookow (ATRAPA_STRIPE_SEKRET, ten sam co STRIPE_SEKRET_WEBHOOKA serwera),
 *   webhook: adres odbiorcy zdarzen (ATRAPA_STRIPE_WEBHOOK, np. http://127.0.0.1:<port>/platnosci/webhook/stripe).
 *   Serwer aplikacji wskazuje atrape zmienna STRIPE_URL_API=http://127.0.0.1:<port>.
 *
 * Etap 0: /zdrowie i /_atrapa/wywolania dzialaja, kazda inna sciezka -> 501 w formacie bledu Stripe.
 */

const http = require('http');

const WERSJA = '0';

const KONF = {
  port: Number(process.env.ATRAPA_STRIPE_PORT || 9201),
  host: process.env.ATRAPA_HOST || '127.0.0.1',
  sekret: process.env.ATRAPA_STRIPE_SEKRET || '',
  webhook: process.env.ATRAPA_STRIPE_WEBHOOK || '',
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
    return json(200, { ok: true, atrapa: 'stripe', wersja: WERSJA, port: KONF.port, gotowa: false,
      webhook: KONF.webhook || null }, 'zdrowie');
  }
  if (metoda === 'GET' && sc === '/_atrapa/wywolania') {
    const n = Number((String(sciezkaPelna).match(/[?&]n=(\d+)/) || [])[1] || 50);
    return json(200, ostatnie.slice(-n), 'wywolania');
  }
  return json(501, { error: { type: 'api_error', message: 'atrapa stripe: niezaimplementowane (etap 0), ' + metoda + ' ' + sc } },
    'niezaimplementowane');
}

/**
 * Serwer atrapy. uruchom(port, { sekret, webhook, host }) -> http.Server (nasluchuje od razu;
 * przy porcie 0 adres z serwer.address().port po zdarzeniu 'listening').
 */
function uruchom(port = KONF.port, opcje = {}) {
  if (opcje.sekret !== undefined) KONF.sekret = String(opcje.sekret);
  if (opcje.webhook !== undefined) KONF.webhook = String(opcje.webhook);
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
        wynik = json(500, { error: { type: 'api_error', message: 'atrapa stripe: ' + e.message } }, 'wyjatek');
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
    if (require.main === module) console.log(`[atrapa] stripe (zaslepka) na http://${host}:${serwer.address().port}`);
  });
  return serwer;
}

module.exports = { obsluz, uruchom, KONF, WERSJA };

if (require.main === module) uruchom();
