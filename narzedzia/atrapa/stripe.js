#!/usr/bin/env node
'use strict';
/*
 * Atrapa Stripe dla testow platnosci Content AI (wykonawca B, PROJEKT-TECHNICZNY 11.1).
 * Node bez zaleznosci. Ksztalt jak narzedzia/atrapa/dostawcy.js:
 *   obsluz(metoda, sciezka, naglowki, bufor) -> { status, naglowki, cialo, rodzaj }
 *     czysta funkcja nad stanem w pamieci: nie wychodzi do sieci, zdarzenia odklada do wyslania;
 *   uruchom(port, { sekret, webhook, host, klucz }) -> http.Server
 *     wysyla odlozone zdarzenia na adres webhooka z podpisem jak Stripe
 *     (Stripe-Signature: t=<s>,v1=HMAC-SHA256(sekret, `${t}.` + cialo)).
 *
 * Stan: klienci, sesje Checkout, subskrypcje (koniec okresu na elemencie: items.data[].current_period_end,
 * jak od wersji API 2025-03-31.basil; bez current_period_* na subskrypcji), faktury (subskrypcja w
 * parent.subscription_details, platnosc w /v1/invoice_payments), platnosci i obciazenia, zwroty, ceny
 * (z currency_options tylko po expand[]=currency_options, jak w Stripe), sesje panelu, metody platnosci,
 * zegary testowe, klucze idempotencji (ten sam klucz z innymi parametrami -> 400), zegar symulowany.
 *
 * API (application/x-www-form-urlencoded z nawiasami, Authorization: Bearer <ATRAPA_STRIPE_KLUCZ>,
 * wymagany naglowek Stripe-Version):
 *   POST /v1/customers, GET|POST /v1/customers/:id
 *   POST /v1/checkout/sessions, GET /v1/checkout/sessions/:id
 *   POST /v1/billing_portal/sessions
 *   GET /v1/subscriptions?customer=&status=all, POST /v1/subscriptions, GET|POST|DELETE /v1/subscriptions/:id
 *   GET /v1/prices/:id, GET /v1/invoices/:id, GET /v1/invoices?customer=&status=, GET /v1/invoice_payments?invoice=
 *   POST /v1/refunds, GET /v1/refunds?charge=|payment_intent=, GET /v1/charges/:id, GET /v1/payment_intents/:id
 *   POST /v1/payment_methods/:id/attach (pm_card_visa, pm_card_chargeCustomerFail)
 *   POST /v1/test_helpers/test_clocks, GET|DELETE /v1/test_helpers/test_clocks/:id, POST .../:id/advance
 *     (zegary tylko z kluczem sk_test_..., klucz ograniczony rk_test_... dostaje 403 jak w Stripe)
 * Strony przegladarki (formularze bez JS):
 *   GET|POST /c/pay/:sesja      "Zaplac karta testowa" (z krajem adresu rozliczeniowego), karta 0341
 *                               (pozniejsze obciazenia odrzucane), "Karta odrzucona", "Wroc"
 *   GET|POST /p/session/:id     "Anuluj na koniec okresu", "Wznow", "Zmien pakiet", "Zaktualizuj karte", "Wroc"
 *   Akcja zmienia stan, wysyla zdarzenia (przed przekierowaniem) i przekierowuje na success_url,
 *   cancel_url albo return_url.
 * Sterowanie:
 *   POST /_atrapa/czas { dni, godziny, sekundy }   przesuwa zegar: odnowienia, nieudane obciazenia karty
 *                                                    0341 z ponowieniami (po 3, 5 i 7 dniach, potem anulowanie),
 *                                                    koniec okresu po anulowaniu, koniec okresu probnego
 *   POST /_atrapa/zdarzenia/wyslij { typ, obiekt|id, zdarzenia: [...], kolejnosc, zlyPodpis, staryCzas, livemode, idZdarzenia }
 *        kolejnosc: normalna | odwrocona | podwojna | rownolegla
 *   POST /_atrapa/zdarzenia/ponow                    ponownie wysyla nieudane dostawy (jak ponowienia Stripe)
 *   POST /_atrapa/ustaw { kolejnosc, webhooki: 'wlaczone'|'wylaczone' }
 *   POST /_atrapa/blad { wzor, status, razy, metoda }   blad API na zadanie (status 0 = zerwane polaczenie);
 *        tez ATRAPA_STRIPE_BLAD=<wyrazenie sciezki>:<status>[:<razy>][;...]
 *   POST /_atrapa/reset, GET /_atrapa/stan, GET /_atrapa/wywolania?n=20, GET /zdrowie
 *
 * Start:  node narzedzia/atrapa/stripe.js   (port z ATRAPA_STRIPE_PORT, domyslnie 9201)
 * Modul:  const srv = require('../narzedzia/atrapa/stripe.js').uruchom(0, { sekret, webhook });
 *   sekret:  sekret podpisu webhookow (ATRAPA_STRIPE_SEKRET, ten sam co STRIPE_SEKRET_WEBHOOKA serwera),
 *   webhook: adres odbiorcy zdarzen (ATRAPA_STRIPE_WEBHOOK, np. http://127.0.0.1:<port>/platnosci/webhook/stripe).
 *   Serwer aplikacji wskazuje atrape zmienna STRIPE_URL_API=http://127.0.0.1:<port>.
 * Zmienne: ATRAPA_STRIPE_PORT, ATRAPA_HOST, ATRAPA_STRIPE_SEKRET, ATRAPA_STRIPE_WEBHOOK, ATRAPA_STRIPE_KLUCZ
 *   (domyslnie rk_test_atrapa), ATRAPA_STRIPE_KLUCZ_ZEGARY (sk_test_atrapa_zegary), ATRAPA_STRIPE_CENY (JSON),
 *   ATRAPA_STRIPE_BLAD, ATRAPA_STRIPE_KOLEJNOSC.
 */

const http = require('http');
const crypto = require('crypto');

const WERSJA = '1';
// Wersja API w tresci zdarzen (punkt koncowy webhooka ma wersje przypieta w panelu Stripe).
const WERSJA_API_ZDARZEN = '2025-03-31.basil';
const DOBA = 86400;
const PONOWIENIA_DNI = [3, 5, 7];       // kolejne proby obciazenia po nieudanym odnowieniu (Smart Retries)

const KONF = {
  port: Number(process.env.ATRAPA_STRIPE_PORT || 9201),
  host: process.env.ATRAPA_HOST || '127.0.0.1',
  sekret: process.env.ATRAPA_STRIPE_SEKRET || '',
  webhook: process.env.ATRAPA_STRIPE_WEBHOOK || '',
  klucz: process.env.ATRAPA_STRIPE_KLUCZ || 'rk_test_atrapa',
  kluczZegary: process.env.ATRAPA_STRIPE_KLUCZ_ZEGARY || 'sk_test_atrapa_zegary',
  kolejnosc: process.env.ATRAPA_STRIPE_KOLEJNOSC || 'normalna',
};

const ostatnie = [];

// Ceny: jedna cena wielowalutowa na pakiet (EUR z opcja PLN) i osobne ceny per waluta
// (format STRIPE_CENA_<PLAN>=eur:price_a,pln:price_b), cena nieaktywna i roczna do testow kontroli.
const CENY_DOMYSLNE = [
  { id: 'price_atrapa_standard', plan: 'standard', nazwa: 'Content AI Standard', waluta: 'eur', kwota: 1900, opcje: { pln: 7900 } },
  { id: 'price_atrapa_premium', plan: 'premium', nazwa: 'Content AI Premium', waluta: 'eur', kwota: 4900, opcje: { pln: 19900 } },
  { id: 'price_atrapa_standard_eur', plan: 'standard', nazwa: 'Content AI Standard', waluta: 'eur', kwota: 1900 },
  { id: 'price_atrapa_standard_pln', plan: 'standard', nazwa: 'Content AI Standard', waluta: 'pln', kwota: 7900 },
  { id: 'price_atrapa_premium_eur', plan: 'premium', nazwa: 'Content AI Premium', waluta: 'eur', kwota: 4900 },
  { id: 'price_atrapa_premium_pln', plan: 'premium', nazwa: 'Content AI Premium', waluta: 'pln', kwota: 19900 },
  { id: 'price_atrapa_nieaktywna', plan: 'standard', nazwa: 'Content AI Standard (stara)', waluta: 'eur', kwota: 1500, aktywna: false },
  { id: 'price_atrapa_roczna', plan: 'standard', nazwa: 'Content AI Standard (rok)', waluta: 'eur', kwota: 19000, interwal: 'year' },
];

function cenyStartowe() {
  let lista = CENY_DOMYSLNE;
  if (process.env.ATRAPA_STRIPE_CENY) {
    try { lista = JSON.parse(process.env.ATRAPA_STRIPE_CENY); } catch (e) { console.error('[atrapa stripe] ATRAPA_STRIPE_CENY: zly JSON'); }
  }
  const ceny = new Map();
  for (const c of lista) {
    const opcje = { [c.waluta]: { unit_amount: c.kwota, tax_behavior: 'unspecified' } };
    for (const [w, k] of Object.entries(c.opcje || {})) opcje[w] = { unit_amount: k, tax_behavior: 'unspecified' };
    ceny.set(c.id, {
      id: c.id, object: 'price', active: c.aktywna !== false, billing_scheme: 'per_unit', created: 1760000000,
      currency: c.waluta, currency_options: opcje, livemode: false, lookup_key: null, metadata: { plan: c.plan || '' },
      nickname: c.nazwa, product: `prod_atrapa_${c.plan || 'x'}`,
      recurring: { interval: c.interwal || 'month', interval_count: 1, usage_type: 'licensed' },
      tax_behavior: 'unspecified', type: 'recurring', unit_amount: c.kwota, unit_amount_decimal: String(c.kwota),
    });
  }
  return ceny;
}

let S;
function wyczysc() {
  ostatnie.length = 0;
  S = {
    przesuniecie: 0,               // przesuniecie zegara symulowanego w sekundach
    ceny: cenyStartowe(),
    klienci: new Map(), sesje: new Map(), subskrypcje: new Map(), faktury: new Map(), platnosciFaktur: new Map(),
    intencje: new Map(), obciazenia: new Map(), zwroty: new Map(), panele: new Map(), metody: new Map(), zegary: new Map(),
    idempotencja: new Map(),
    zdarzenia: [], doWyslania: [], dostarczone: [], nieudane: [],
    webhooki: 'wlaczone', kolejnosc: KONF.kolejnosc,
    bledy: bledyZeSrodowiska(),
  };
}

function bledyZeSrodowiska() {
  return String(process.env.ATRAPA_STRIPE_BLAD || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(.*):(\d{1,3})(?::(\d+))?$/.exec(s);
    return m ? { wzor: m[1], status: Number(m[2]), razy: m[3] ? Number(m[3]) : Infinity, metoda: '' } : null;
  }).filter(Boolean);
}

function zapiszWywolanie(wpis) {
  ostatnie.push(wpis);
  if (ostatnie.length > 200) ostatnie.shift();
}

// ─── Pomocnicze ──────────────────────────────────────────────────────────────

const ZNAKI = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function nowyId(prefiks, dlugosc = 14) {
  const bajty = crypto.randomBytes(dlugosc);
  let s = '';
  for (let i = 0; i < dlugosc; i += 1) s += ZNAKI[bajty[i] % ZNAKI.length];
  return `${prefiks}_${s}`;
}

function terazGlobalnie() { return Math.floor(Date.now() / 1000) + S.przesuniecie; }
function zegarKlienta(idKlienta) {
  const k = S.klienci.get(idKlienta);
  return k && k.test_clock ? S.zegary.get(k.test_clock) || null : null;
}
function terazDla(idKlienta) {
  const z = zegarKlienta(idKlienta);
  return z ? z.frozen_time : terazGlobalnie();
}

function dodajMiesiac(sekundy, ile = 1) {
  const d = new Date(sekundy * 1000);
  const dzien = d.getUTCDate();
  const cel = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + ile, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const ostatni = new Date(Date.UTC(cel.getUTCFullYear(), cel.getUTCMonth() + 1, 0)).getUTCDate();
  cel.setUTCDate(Math.min(dzien, ostatni));
  return Math.floor(cel.getTime() / 1000);
}

function klon(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

/** Notacja nawiasowa Stripe: a[b][0][c]=x -> { a: { b: [ { c: 'x' } ] } } (tablice dla kluczy liczbowych i []). */
function rozkoduj(tekst) {
  const wynik = {};
  for (const [klucz, wartosc] of new URLSearchParams(String(tekst || ''))) {
    const czesci = [];
    const m = /^([^[\]]+)((?:\[[^\]]*\])*)$/.exec(klucz);
    if (!m) continue;
    czesci.push(m[1]);
    for (const c of m[2].matchAll(/\[([^\]]*)\]/g)) czesci.push(c[1]);
    let o = wynik;
    for (let i = 0; i < czesci.length; i += 1) {
      const c = czesci[i];
      const ostatnia = i === czesci.length - 1;
      const nastepnyTablica = !ostatnia && (czesci[i + 1] === '' || /^\d+$/.test(czesci[i + 1]));
      if (Array.isArray(o)) {
        const indeks = c === '' ? o.length : Number(c);
        if (ostatnia) o[indeks] = wartosc;
        else { if (o[indeks] === undefined) o[indeks] = nastepnyTablica ? [] : {}; o = o[indeks]; }
      } else if (ostatnia) {
        o[c] = wartosc;
      } else {
        if (o[c] === undefined) o[c] = nastepnyTablica ? [] : {};
        o = o[c];
      }
    }
  }
  return wynik;
}

function tak(v) { return v === true || v === 'true' || v === '1'; }

function json(status, obiekt, rodzaj, dod = {}) {
  return { status, naglowki: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'request-id': nowyId('req') }, dod), cialo: JSON.stringify(obiekt), rodzaj };
}
function bladStripe(status, typ, wiadomosc, dod = {}) {
  return json(status, { error: Object.assign({ type: typ, message: wiadomosc }, dod) }, 'blad');
}
function brakObiektu(nazwa, id) {
  return bladStripe(404, 'invalid_request_error', `No such ${nazwa}: '${id}'`, { code: 'resource_missing', param: 'id' });
}
function html(status, tresc, rodzaj, dod = {}) {
  return { status, naglowki: Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, dod), cialo: tresc, rodzaj };
}
function przekieruj(adres, rodzaj) {
  return { status: 303, naglowki: { location: adres, 'cache-control': 'no-store' }, cialo: '', rodzaj, wyslijPrzed: true };
}
function lista(dane, url) { return { object: 'list', data: dane, has_more: false, url }; }

// ─── Obiekty publiczne (to, co oddaje API) ───────────────────────────────────

function cenaPubliczna(cena, rozwin = []) {
  const c = klon(cena);
  if (!rozwin.includes('currency_options') && !rozwin.includes('data.currency_options')) delete c.currency_options;
  return c;
}

function kwotaCeny(cena, waluta) {
  if (!cena) return null;
  if (cena.currency === waluta) return cena.unit_amount;
  const o = cena.currency_options && cena.currency_options[waluta];
  return o ? o.unit_amount : null;
}

function subskrypcjaPubliczna(sub) {
  const s = klon(sub);
  for (const k of Object.keys(s)) if (k.startsWith('_')) delete s[k];
  return s;
}

function zdarzenie(typ, obiekt, poprzednie) {
  const e = {
    id: nowyId('evt', 24), object: 'event', api_version: WERSJA_API_ZDARZEN, created: terazGlobalnie(), livemode: false,
    pending_webhooks: 1, request: { id: null, idempotency_key: null }, type: typ,
    data: Object.assign({ object: klon(obiekt) }, poprzednie ? { previous_attributes: poprzednie } : {}),
  };
  S.zdarzenia.push(e);
  if (S.zdarzenia.length > 500) S.zdarzenia.shift();
  S.doWyslania.push(e);
  return e;
}

// ─── Klienci, metody platnosci ──────────────────────────────────────────────

function utworzKlienta(p) {
  const id = nowyId('cus');
  const k = {
    id, object: 'customer', address: null, balance: 0, created: terazGlobalnie(), currency: null, email: p.email || null,
    invoice_settings: { default_payment_method: null }, livemode: false, metadata: p.metadata || {}, name: p.name || null,
    preferred_locales: Array.isArray(p.preferred_locales) ? p.preferred_locales : [], test_clock: p.test_clock || null,
  };
  if (p.test_clock && !S.zegary.has(p.test_clock)) return { blad: brakObiektu('test_clock', p.test_clock) };
  S.klienci.set(id, k);
  return { obiekt: k };
}

const METODY_TESTOWE = { pm_card_visa: 'ok', pm_card_chargeCustomerFail: 'odrzucajaca', pm_card_chargeDeclined: 'odrzucona' };

function nowaMetoda(idKlienta, rodzaj) {
  const id = nowyId('pm');
  const m = { id, object: 'payment_method', type: 'card', customer: idKlienta, card: { brand: 'visa', last4: { ok: '4242', odrzucajaca: '0341', odrzucona: '0002' }[rodzaj] || '4242' }, _rodzaj: rodzaj };
  S.metody.set(id, m);
  return m;
}
function metodaPubliczna(m) { const c = klon(m); delete c._rodzaj; return c; }

// ─── Faktury, platnosci, obciazenia ─────────────────────────────────────────

/** Faktura subskrypcji za okres [od, do); proba obciazenia od razu. -> faktura */
function wystawFakture(sub, { powod, od, do: doKiedy, kwota }) {
  const klient = S.klienci.get(sub.customer) || {};
  const cena = S.ceny.get(sub.items.data[0].price.id);
  const id = nowyId('in');
  const teraz = terazDla(sub.customer);
  const f = {
    id, object: 'invoice', account_country: 'PL', amount_due: kwota, amount_paid: 0, amount_remaining: kwota,
    attempt_count: 0, billing_reason: powod, collection_method: 'charge_automatically', created: teraz, currency: sub.currency,
    customer: sub.customer, customer_address: klient.address ? klon(klient.address) : null, customer_email: klient.email || null,
    lines: lista([{
      id: nowyId('il'), object: 'line_item', amount: kwota, currency: sub.currency, description: cena ? cena.nickname : null,
      period: { start: od, end: doKiedy },
      pricing: { type: 'price_details', price_details: { price: cena ? cena.id : null, product: cena ? cena.product : null } },
      parent: { type: 'subscription_item_details', subscription_item_details: { subscription: sub.id, subscription_item: sub.items.data[0].id } },
      quantity: 1,
    }], `/v1/invoices/${id}/lines`),
    livemode: false, next_payment_attempt: null,
    parent: { type: 'subscription_details', subscription_details: { subscription: sub.id, metadata: klon(sub.metadata) } },
    period_start: od, period_end: doKiedy, status: 'open', status_transitions: { finalized_at: teraz, paid_at: null },
    subtotal: kwota, total: kwota,
  };
  S.faktury.set(id, f);
  sub.latest_invoice = id;
  return f;
}

/** Proba zaplaty faktury metoda subskrypcji. -> true gdy zaplacona. Zdarzenia: invoice.paid albo invoice.payment_failed. */
function zaplacFakture(f, sub, { metoda = null, bezZdarzen = false } = {}) {
  const teraz = terazDla(f.customer);
  if (f.amount_due === 0) {
    f.status = 'paid';
    f.status_transitions.paid_at = teraz;
    f.amount_remaining = 0;
    if (!bezZdarzen) zdarzenie('invoice.paid', f);
    return true;
  }
  const m = S.metody.get(metoda || sub.default_payment_method || ((S.klienci.get(f.customer) || {}).invoice_settings || {}).default_payment_method);
  const udana = Boolean(m) && m._rodzaj === 'ok';
  f.attempt_count += 1;
  const pi = { id: nowyId('pi', 24), object: 'payment_intent', amount: f.amount_due, amount_received: udana ? f.amount_due : 0, currency: f.currency, customer: f.customer, status: udana ? 'succeeded' : 'requires_payment_method', latest_charge: null, created: teraz, livemode: false };
  const ch = {
    id: nowyId('ch', 24), object: 'charge', amount: f.amount_due, amount_captured: udana ? f.amount_due : 0, amount_refunded: 0,
    billing_details: { address: f.customer_address ? klon(f.customer_address) : null }, created: teraz, currency: f.currency,
    customer: f.customer, livemode: false, paid: udana, payment_intent: pi.id, refunded: false, status: udana ? 'succeeded' : 'failed',
    failure_code: udana ? null : 'card_declined',
  };
  pi.latest_charge = ch.id;
  S.intencje.set(pi.id, pi);
  S.obciazenia.set(ch.id, ch);
  const wplata = {
    id: nowyId('inpay', 20), object: 'invoice_payment', amount_paid: udana ? f.amount_due : null, amount_requested: f.amount_due,
    created: teraz, currency: f.currency, invoice: f.id, is_default: true, livemode: false,
    payment: { type: 'payment_intent', payment_intent: pi.id }, status: udana ? 'paid' : 'open',
    status_transitions: { canceled_at: null, paid_at: udana ? teraz : null },
  };
  const listaWplat = S.platnosciFaktur.get(f.id) || [];
  listaWplat.push(wplata);
  S.platnosciFaktur.set(f.id, listaWplat);
  if (udana) {
    f.status = 'paid';
    f.amount_paid = f.amount_due;
    f.amount_remaining = 0;
    f.status_transitions.paid_at = teraz;
    f.next_payment_attempt = null;
    if (!bezZdarzen) zdarzenie('invoice.paid', f);
    return true;
  }
  f.next_payment_attempt = null;
  if (!bezZdarzen) zdarzenie('invoice.payment_failed', f);
  return false;
}

// ─── Subskrypcje ─────────────────────────────────────────────────────────────

function utworzSubskrypcje({ idKlienta, cena, waluta, metadane, dniProby, metoda, zrodlo }) {
  const teraz = terazDla(idKlienta);
  const id = nowyId('sub', 24);
  const proba = Number(dniProby) > 0;
  const koniecProby = proba ? teraz + Number(dniProby) * DOBA : null;
  const koniecOkresu = proba ? koniecProby : dodajMiesiac(teraz);
  const kwota = kwotaCeny(cena, waluta);
  const pc = cenaPubliczna(cena);
  if (cena.currency !== waluta) { pc.currency = waluta; pc.unit_amount = kwota; pc.unit_amount_decimal = String(kwota); }
  const sub = {
    id, object: 'subscription', billing_cycle_anchor: koniecOkresu, cancel_at: null, cancel_at_period_end: false, canceled_at: null,
    cancellation_details: { comment: null, feedback: null, reason: null }, collection_method: 'charge_automatically', created: teraz,
    currency: waluta, customer: idKlienta, default_payment_method: metoda || null, ended_at: null,
    items: lista([{ id: nowyId('si'), object: 'subscription_item', created: teraz, current_period_start: teraz, current_period_end: koniecOkresu, price: pc, quantity: 1, subscription: id }], `/v1/subscription_items?subscription=${id}`),
    latest_invoice: null, livemode: false, metadata: metadane || {}, start_date: teraz, status: proba ? 'trialing' : 'incomplete',
    test_clock: (S.klienci.get(idKlienta) || {}).test_clock || null, trial_end: koniecProby, trial_start: proba ? teraz : null,
    _ponowienia: 0, _zrodlo: zrodlo || 'api',
  };
  S.subskrypcje.set(id, sub);
  const klient = S.klienci.get(idKlienta);
  if (klient && !klient.currency) klient.currency = waluta;
  const f = wystawFakture(sub, { powod: 'subscription_create', od: teraz, do: koniecOkresu, kwota: proba ? 0 : kwota });
  return { sub, faktura: f };
}

function okresKoniec(sub) { return Math.max(...sub.items.data.map((i) => i.current_period_end)); }

function zmienStatus(sub, status) {
  const byl = sub.status;
  sub.status = status;
  return byl;
}

function anulujTeraz(sub, teraz, powod = 'cancellation_requested') {
  const poprzednie = { status: sub.status };
  sub.status = 'canceled';
  sub.canceled_at = sub.canceled_at || teraz;
  sub.ended_at = teraz;
  sub.cancellation_details.reason = powod;
  // otwarta faktura po anulowaniu: bez dalszych prob
  const f = S.faktury.get(sub.latest_invoice);
  if (f && f.status === 'open') { f.status = 'void'; f.next_payment_attempt = null; }
  zdarzenie('customer.subscription.deleted', subskrypcjaPubliczna(sub), poprzednie);
}

/** Przetwarza subskrypcje do chwili `teraz` danego zegara (null = zegar globalny). -> liczba zmian */
function przetworzCzas(idZegara) {
  let zmian = 0;
  for (let kolko = 0; kolko < 60; kolko += 1) {
    let tu = 0;
    for (const sub of S.subskrypcje.values()) {
      if ((sub.test_clock || null) !== (idZegara || null)) continue;
      const teraz = terazDla(sub.customer);
      if (['canceled', 'incomplete_expired'].includes(sub.status)) continue;
      if (sub.status === 'incomplete') {
        if (teraz - sub.created > DOBA) {
          zmienStatus(sub, 'incomplete_expired');
          sub.ended_at = teraz;
          zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { status: 'incomplete' });
          tu += 1;
        }
        continue;
      }
      if (sub.cancel_at && sub.cancel_at <= teraz) { anulujTeraz(sub, sub.cancel_at); tu += 1; continue; }
      const f = S.faktury.get(sub.latest_invoice);
      if (sub.status === 'past_due' && f && f.status === 'open' && f.next_payment_attempt && f.next_payment_attempt <= teraz) {
        if (zaplacFakture(f, sub)) {
          zmienStatus(sub, 'active');
          sub._ponowienia = 0;
          zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { status: 'past_due' });
        } else {
          sub._ponowienia += 1;
          if (sub._ponowienia >= PONOWIENIA_DNI.length) anulujTeraz(sub, teraz, 'payment_failed');
          else f.next_payment_attempt = f.created + PONOWIENIA_DNI[sub._ponowienia] * DOBA;
        }
        tu += 1;
        continue;
      }
      const koniec = okresKoniec(sub);
      if (koniec > teraz) continue;
      if (sub.status === 'past_due') continue;          // czeka na ponowienie albo anulowanie
      if (sub.cancel_at_period_end) { anulujTeraz(sub, koniec); tu += 1; continue; }
      // odnowienie (albo koniec okresu probnego)
      const element = sub.items.data[0];
      const zProby = sub.status === 'trialing';
      element.current_period_start = koniec;
      element.current_period_end = dodajMiesiac(koniec);
      sub.billing_cycle_anchor = element.current_period_end;
      const cena = S.ceny.get(element.price.id);
      const nowa = wystawFakture(sub, { powod: 'subscription_cycle', od: koniec, do: element.current_period_end, kwota: kwotaCeny(cena, sub.currency) });
      nowa.created = koniec;
      if (zaplacFakture(nowa, sub)) {
        if (zProby) { zmienStatus(sub, 'active'); zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { status: 'trialing' }); }
        else zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { items: { data: [{ current_period_end: koniec }] } });
      } else {
        const byl = zmienStatus(sub, 'past_due');
        sub._ponowienia = 0;
        nowa.next_payment_attempt = nowa.created + PONOWIENIA_DNI[0] * DOBA;
        zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { status: byl });
      }
      tu += 1;
    }
    zmian += tu;
    if (!tu) break;
  }
  return zmian;
}

// ─── Zwroty ──────────────────────────────────────────────────────────────────

function utworzZwrot(p) {
  let ch = null;
  if (p.charge) ch = S.obciazenia.get(p.charge);
  else if (p.payment_intent) {
    const pi = S.intencje.get(p.payment_intent);
    if (!pi) return { blad: brakObiektu('payment_intent', p.payment_intent) };
    ch = S.obciazenia.get(pi.latest_charge);
  }
  if (!ch) return { blad: bladStripe(400, 'invalid_request_error', 'Brak charge albo payment_intent do zwrotu', { param: 'charge' }) };
  if (!ch.paid) return { blad: bladStripe(400, 'invalid_request_error', `Charge ${ch.id} has not been captured`, { code: 'charge_not_refundable' }) };
  const zostalo = ch.amount - ch.amount_refunded;
  const kwota = p.amount === undefined ? zostalo : Number(p.amount);
  if (!(kwota > 0) || kwota > zostalo) {
    return { blad: bladStripe(400, 'invalid_request_error', `Refund amount (${kwota}) is greater than unrefunded amount on charge (${zostalo})`, { code: 'amount_too_large', param: 'amount' }) };
  }
  const re = {
    id: nowyId('re', 24), object: 'refund', amount: kwota, charge: ch.id, created: terazDla(ch.customer), currency: ch.currency,
    metadata: p.metadata || {}, payment_intent: ch.payment_intent, reason: p.reason || null, status: 'succeeded',
  };
  S.zwroty.set(re.id, re);
  ch.amount_refunded += kwota;
  ch.refunded = ch.amount_refunded >= ch.amount;
  zdarzenie('refund.created', re);
  zdarzenie('charge.refunded', ch);
  return { obiekt: re };
}

// ─── Strony przegladarki ─────────────────────────────────────────────────────

const STYL = 'body{font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;background:#f6f6f4;color:#1b1a17}'
  + 'h1{font-size:20px}.karta{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}'
  + 'button{display:block;width:100%;margin:8px 0;padding:10px;font:inherit;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer}'
  + 'button.glowny{background:#635bff;color:#fff;border-color:#635bff}.blad{color:#b72b29}.drobne{font-size:12px;color:#555}';

const NAZWY_KRAJOW = [['PL', 'Polska'], ['DE', 'Niemcy'], ['CZ', 'Czechy'], ['FR', 'Francja'], ['IE', 'Irlandia'], ['GB', 'Wielka Brytania'], ['US', 'Stany Zjednoczone'], ['CH', 'Szwajcaria'], ['NO', 'Norwegia']];

function kwotaTekst(kwota, waluta) {
  return `${(kwota / 100).toFixed(2).replace('.', ',')} ${String(waluta).toUpperCase()}`;
}

function stronaCheckout(sesja, blad) {
  const cena = S.ceny.get(sesja._pozycje[0].price);
  const kwota = kwotaCeny(cena, sesja.currency);
  const klient = S.klienci.get(sesja.customer) || {};
  const opcje = NAZWY_KRAJOW.map(([k, n]) => `<option value="${k}"${k === 'PL' ? ' selected' : ''}>${esc(n)}</option>`).join('');
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Atrapa Stripe Checkout</title><style>${STYL}</style></head><body>
<main>
<h1>Atrapa Stripe Checkout (tryb testowy)</h1>
<div class="karta"><p id="pozycja">${esc(cena ? cena.nickname : '?')}: <b id="kwota">${esc(kwotaTekst(kwota, sesja.currency))}</b> miesięcznie</p>
<p class="drobne">E-mail: <span id="email">${esc(klient.email || '')}</span>, język: ${esc(sesja.locale || 'auto')}, metody: ${esc((sesja.payment_method_types || []).join(', ') || 'z panelu')}</p>
${sesja.custom_text && sesja.custom_text.submit ? `<p class="drobne" id="tekst-przycisku">${esc(sesja.custom_text.submit.message)}</p>` : ''}
${blad ? `<p class="blad" id="blad" role="alert">${esc(blad)}</p>` : ''}
<form method="POST" action="/c/pay/${esc(sesja.id)}">
<label>Kraj adresu rozliczeniowego <select name="kraj" id="kraj">${opcje}</select></label>
<button class="glowny" name="akcja" value="zaplac" id="zaplac">Zapłać kartą testową 4242</button>
<button name="akcja" value="zaplac-0341" id="zaplac-0341">Zapłać kartą 0341 (kolejne obciążenia odrzucane)</button>
<button name="akcja" value="odrzuc" id="odrzuc">Karta odrzucona (0002)</button>
<button name="akcja" value="wroc" id="wroc">Wróć</button>
</form></div></main></body></html>`;
}

function stronaPanelu(panel, komunikat) {
  const subs = [...S.subskrypcje.values()].filter((s) => s.customer === panel.customer).sort((a, b) => b.created - a.created);
  const zywa = subs.find((s) => !['canceled', 'incomplete_expired'].includes(s.status));
  const wiersze = subs.map((s) => `<li data-sub="${esc(s.id)}">${esc(s.items.data[0].price.nickname || s.items.data[0].price.id)}: <b class="status">${esc(s.status)}</b>`
    + `${s.cancel_at_period_end ? ' <span class="anulowana">(anulowana na koniec okresu)</span>' : ''}, do ${esc(new Date(okresKoniec(s) * 1000).toISOString().slice(0, 10))}</li>`).join('');
  const przyciski = zywa ? `
<button name="akcja" value="${zywa.cancel_at_period_end ? 'wznow' : 'anuluj'}" id="${zywa.cancel_at_period_end ? 'wznow' : 'anuluj'}">${zywa.cancel_at_period_end ? 'Wznów subskrypcję' : 'Anuluj na koniec okresu'}</button>
<button name="akcja" value="zmien" id="zmien">Zmień pakiet</button>
<button name="akcja" value="karta" id="karta">Zaktualizuj kartę</button>` : '<p>Brak aktywnej subskrypcji.</p>';
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Atrapa Stripe Customer Portal</title><style>${STYL}</style></head><body>
<main><h1>Atrapa Customer Portal (tryb testowy)</h1>
${komunikat ? `<p id="komunikat" role="status">${esc(komunikat)}</p>` : ''}
<div class="karta"><ul id="subskrypcje">${wiersze}</ul>
<form method="POST" action="/p/session/${esc(panel.id)}">${przyciski}
<button class="glowny" name="akcja" value="wroc" id="wroc">Wróć</button>
</form></div></main></body></html>`;
}

function zaplacSesje(sesja, akcja, kraj) {
  const klient = S.klienci.get(sesja.customer);
  const rodzaj = akcja === 'zaplac-0341' ? 'odrzucajaca' : 'ok';
  const metoda = nowaMetoda(klient.id, 'ok');
  if (sesja.billing_address_collection === 'required' || kraj) {
    const adres = { city: 'Testowo', country: String(kraj || 'PL').toUpperCase(), line1: 'ul. Testowa 1', line2: null, postal_code: '00-001', state: null };
    if (!sesja.customer_update || sesja.customer_update.address === 'auto') klient.address = adres;
    sesja.customer_details = { address: adres, email: klient.email, name: klient.name || 'Klient Testowy', tax_exempt: 'none', tax_ids: [] };
  }
  klient.invoice_settings.default_payment_method = metoda.id;
  const cena = S.ceny.get(sesja._pozycje[0].price);
  const sd = sesja._subscription_data || {};
  const { sub, faktura } = utworzSubskrypcje({ idKlienta: klient.id, cena, waluta: sesja.currency, metadane: sd.metadata || {}, dniProby: sd.trial_period_days, metoda: metoda.id, zrodlo: 'checkout' });
  if (faktura.customer_address === null && klient.address) faktura.customer_address = klon(klient.address);
  zaplacFakture(faktura, sub, { metoda: metoda.id, bezZdarzen: true });
  if (sub.status === 'incomplete') sub.status = 'active';
  // karta 0341: podpieta, ale kolejne obciazenia odrzucane
  if (rodzaj === 'odrzucajaca') S.metody.get(metoda.id)._rodzaj = 'odrzucajaca';
  sesja.status = 'complete';
  sesja.payment_status = faktura.amount_due === 0 ? 'no_payment_required' : 'paid';
  sesja.subscription = sub.id;
  sesja.invoice = faktura.id;
  zdarzenie('customer.subscription.created', subskrypcjaPubliczna(sub));
  zdarzenie('invoice.paid', faktura);
  zdarzenie('checkout.session.completed', sesjaPubliczna(sesja));
}

function sesjaPubliczna(s) {
  const c = klon(s);
  for (const k of Object.keys(c)) if (k.startsWith('_')) delete c[k];
  return c;
}

function obsluzStroneCheckout(metoda, id, dane) {
  const sesja = S.sesje.get(id);
  if (!sesja) return html(404, '<!DOCTYPE html><p>Nie ma takiej sesji Checkout.</p>', 'checkout-brak');
  if (metoda === 'GET') {
    if (sesja.status !== 'open') return html(410, '<!DOCTYPE html><p>Sesja Checkout jest zakończona.</p>', 'checkout-zamknieta');
    return html(200, stronaCheckout(sesja), 'checkout-strona');
  }
  const akcja = String(dane.akcja || '');
  if (akcja === 'wroc') return przekieruj(sesja.cancel_url, 'checkout-wroc');
  if (sesja.status !== 'open') return html(410, '<!DOCTYPE html><p>Sesja Checkout jest zakończona.</p>', 'checkout-zamknieta');
  if (akcja === 'odrzuc') return html(402, stronaCheckout(sesja, 'Twoja karta została odrzucona. Spróbuj innej karty.'), 'checkout-odrzucona');
  if (akcja !== 'zaplac' && akcja !== 'zaplac-0341') return html(400, stronaCheckout(sesja, 'Nieznana akcja.'), 'checkout-zla-akcja');
  zaplacSesje(sesja, akcja, dane.kraj);
  return przekieruj(String(sesja.success_url).replace('{CHECKOUT_SESSION_ID}', sesja.id), 'checkout-zaplacona');
}

function obsluzStronePanelu(metoda, id, dane) {
  const panel = S.panele.get(id);
  if (!panel) return html(404, '<!DOCTYPE html><p>Nie ma takiej sesji panelu.</p>', 'panel-brak');
  if (metoda === 'GET') return html(200, stronaPanelu(panel), 'panel-strona');
  const akcja = String(dane.akcja || '');
  if (akcja === 'wroc') return przekieruj(panel.return_url, 'panel-wroc');
  const sub = [...S.subskrypcje.values()].filter((s) => s.customer === panel.customer && !['canceled', 'incomplete_expired'].includes(s.status))
    .sort((a, b) => b.created - a.created)[0];
  if (!sub) return html(409, stronaPanelu(panel, 'Brak aktywnej subskrypcji.'), 'panel-bez-subskrypcji');
  const teraz = terazDla(sub.customer);
  let komunikat = '';
  if (akcja === 'anuluj') {
    sub.cancel_at_period_end = true;
    sub.canceled_at = teraz;
    zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { cancel_at_period_end: false });
    komunikat = 'Subskrypcja zostanie anulowana na koniec okresu.';
  } else if (akcja === 'wznow') {
    sub.cancel_at_period_end = false;
    sub.canceled_at = null;
    zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { cancel_at_period_end: true });
    komunikat = 'Subskrypcja wznowiona.';
  } else if (akcja === 'zmien') {
    const element = sub.items.data[0];
    const plan = (S.ceny.get(element.price.id) || {}).metadata?.plan;
    const cel = [...S.ceny.values()].find((c) => c.active && c.recurring.interval === 'month' && c.metadata.plan && c.metadata.plan !== plan
      && kwotaCeny(c, sub.currency) !== null && c.currency_options[sub.currency]);
    if (!cel) return html(409, stronaPanelu(panel, 'Brak innego pakietu w tej walucie.'), 'panel-bez-zmiany');
    const poprzednia = element.price.id;
    const pc = cenaPubliczna(cel);
    if (cel.currency !== sub.currency) { pc.currency = sub.currency; pc.unit_amount = kwotaCeny(cel, sub.currency); pc.unit_amount_decimal = String(pc.unit_amount); }
    element.price = pc;
    zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { items: { data: [{ price: { id: poprzednia } }] } });
    komunikat = `Pakiet zmieniony na ${cel.nickname}.`;
  } else if (akcja === 'karta') {
    const metodaNowa = nowaMetoda(sub.customer, 'ok');
    sub.default_payment_method = metodaNowa.id;
    const klient = S.klienci.get(sub.customer);
    if (klient) klient.invoice_settings.default_payment_method = metodaNowa.id;
    const f = S.faktury.get(sub.latest_invoice);
    if (f && f.status === 'open' && zaplacFakture(f, sub)) {
      const byl = zmienStatus(sub, 'active');
      sub._ponowienia = 0;
      zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), { status: byl });
    }
    komunikat = 'Karta zaktualizowana.';
  } else {
    return html(400, stronaPanelu(panel, 'Nieznana akcja.'), 'panel-zla-akcja');
  }
  return Object.assign(przekieruj(`/p/session/${panel.id}?ok=${encodeURIComponent(komunikat)}`, `panel-${akcja}`));
}

// ─── API ─────────────────────────────────────────────────────────────────────

function zSesjaCheckout(p, baza) {
  if (p.mode !== 'subscription') return { blad: bladStripe(400, 'invalid_request_error', 'atrapa: obslugiwany tylko mode=subscription', { param: 'mode' }) };
  const klient = S.klienci.get(p.customer);
  if (!klient) return { blad: brakObiektu('customer', p.customer) };
  const pozycje = Array.isArray(p.line_items) ? p.line_items : [];
  if (pozycje.length !== 1 || !pozycje[0].price) return { blad: bladStripe(400, 'invalid_request_error', 'line_items: dokladnie jedna pozycja z cena', { param: 'line_items' }) };
  const cena = S.ceny.get(pozycje[0].price);
  if (!cena) return { blad: brakObiektu('price', pozycje[0].price) };
  if (!cena.active) return { blad: bladStripe(400, 'invalid_request_error', `The price specified is inactive: ${cena.id}`, { param: 'line_items[0][price]' }) };
  const waluta = String(p.currency || cena.currency).toLowerCase();
  if (kwotaCeny(cena, waluta) === null) {
    return { blad: bladStripe(400, 'invalid_request_error', `The price ${cena.id} does not have a currency option for ${waluta}`, { param: 'currency' }) };
  }
  if (klient.currency && klient.currency !== waluta) {
    return { blad: bladStripe(400, 'invalid_request_error', `You cannot combine currencies on a single customer. This customer has had a subscription or payment in ${klient.currency}, but you are trying to pay in ${waluta}.`, { code: 'currency_mismatch' }) };
  }
  if (!p.success_url) return { blad: bladStripe(400, 'invalid_request_error', 'Missing required param: success_url.', { param: 'success_url' }) };
  const id = nowyId('cs_test', 40);
  const teraz = terazGlobalnie();
  const s = {
    id, object: 'checkout.session', allow_promotion_codes: tak(p.allow_promotion_codes) || null,
    amount_subtotal: kwotaCeny(cena, waluta), amount_total: kwotaCeny(cena, waluta),
    automatic_tax: { enabled: tak(p.automatic_tax && p.automatic_tax.enabled) },
    billing_address_collection: p.billing_address_collection || null, cancel_url: p.cancel_url || null,
    client_reference_id: p.client_reference_id || null, created: teraz, currency: waluta,
    custom_text: p.custom_text ? klon(p.custom_text) : null, customer: klient.id, customer_details: null,
    customer_update: p.customer_update ? klon(p.customer_update) : null, expires_at: teraz + DOBA, invoice: null, livemode: false,
    locale: p.locale || null, metadata: p.metadata || {}, mode: 'subscription', payment_method_types: p.payment_method_types || [],
    payment_status: 'unpaid', status: 'open', subscription: null, success_url: p.success_url,
    tax_id_collection: { enabled: tak(p.tax_id_collection && p.tax_id_collection.enabled) }, url: `${baza}/c/pay/${id}`,
    _pozycje: pozycje.map((x) => ({ price: x.price, quantity: Number(x.quantity) || 1 })), _subscription_data: p.subscription_data ? klon(p.subscription_data) : {},
  };
  S.sesje.set(id, s);
  return { obiekt: s };
}

function podpisParametrow(metoda, sciezka, bufor) {
  return crypto.createHash('sha256').update(`${metoda} ${sciezka}\n`).update(bufor || Buffer.alloc(0)).digest('hex');
}

function trasaApi(metoda, sciezka, p, rozwin, baza, klucz) {
  let m;
  // Klienci
  if (sciezka === '/v1/customers' && metoda === 'POST') {
    const w = utworzKlienta(p);
    return w.blad || json(200, w.obiekt, 'klient-utworz');
  }
  if ((m = /^\/v1\/customers\/([^/]+)$/.exec(sciezka))) {
    const k = S.klienci.get(m[1]);
    if (!k) return brakObiektu('customer', m[1]);
    if (metoda === 'GET') return json(200, k, 'klient');
    if (metoda === 'POST') {
      if (p.email !== undefined) k.email = p.email;
      if (p.name !== undefined) k.name = p.name;
      if (p.metadata) Object.assign(k.metadata, p.metadata);
      if (p.invoice_settings && p.invoice_settings.default_payment_method !== undefined) {
        if (!S.metody.has(p.invoice_settings.default_payment_method)) return brakObiektu('payment_method', p.invoice_settings.default_payment_method);
        k.invoice_settings.default_payment_method = p.invoice_settings.default_payment_method;
      }
      return json(200, k, 'klient-zmien');
    }
  }
  // Metody platnosci (testowe)
  if ((m = /^\/v1\/payment_methods\/([^/]+)\/attach$/.exec(sciezka)) && metoda === 'POST') {
    const rodzaj = METODY_TESTOWE[m[1]];
    if (!rodzaj) return brakObiektu('payment_method', m[1]);
    if (!S.klienci.has(p.customer)) return brakObiektu('customer', p.customer);
    if (rodzaj === 'odrzucona') return bladStripe(402, 'card_error', 'Your card was declined.', { code: 'card_declined', decline_code: 'generic_decline' });
    return json(200, metodaPubliczna(nowaMetoda(p.customer, rodzaj)), 'metoda-podepnij');
  }
  // Checkout
  if (sciezka === '/v1/checkout/sessions' && metoda === 'POST') {
    const w = zSesjaCheckout(p, baza);
    return w.blad || json(200, sesjaPubliczna(w.obiekt), 'checkout-utworz');
  }
  if ((m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(sciezka)) && metoda === 'GET') {
    const s = S.sesje.get(m[1]);
    return s ? json(200, sesjaPubliczna(s), 'checkout-odczyt') : brakObiektu('checkout.session', m[1]);
  }
  // Panel klienta
  if (sciezka === '/v1/billing_portal/sessions' && metoda === 'POST') {
    if (!S.klienci.has(p.customer)) return brakObiektu('customer', p.customer);
    if (p.configuration && !/^bpc_/.test(p.configuration)) return brakObiektu('billing_portal.configuration', p.configuration);
    const id = nowyId('bps', 24);
    const panel = { id, object: 'billing_portal.session', configuration: p.configuration || 'bpc_atrapa', created: terazGlobalnie(), customer: p.customer, livemode: false, locale: p.locale || null, return_url: p.return_url || null, url: `${baza}/p/session/${id}` };
    S.panele.set(id, panel);
    return json(200, panel, 'panel-utworz');
  }
  // Subskrypcje
  if (sciezka === '/v1/subscriptions' && metoda === 'GET') {
    const status = p.status || '';
    let dane = [...S.subskrypcje.values()].filter((s) => !p.customer || s.customer === p.customer);
    if (!status) dane = dane.filter((s) => !['canceled', 'incomplete_expired'].includes(s.status));
    else if (status !== 'all') dane = dane.filter((s) => s.status === status);
    dane.sort((a, b) => b.created - a.created);
    return json(200, lista(dane.slice(0, Math.min(Number(p.limit) || 10, 100)).map(subskrypcjaPubliczna), '/v1/subscriptions'), 'subskrypcje-lista');
  }
  if (sciezka === '/v1/subscriptions' && metoda === 'POST') {
    const klient = S.klienci.get(p.customer);
    if (!klient) return brakObiektu('customer', p.customer);
    const pozycja = Array.isArray(p.items) ? p.items[0] : null;
    const cena = pozycja && S.ceny.get(pozycja.price);
    if (!cena) return brakObiektu('price', pozycja && pozycja.price);
    const waluta = String(p.currency || klient.currency || cena.currency).toLowerCase();
    if (kwotaCeny(cena, waluta) === null) return bladStripe(400, 'invalid_request_error', `The price ${cena.id} does not have a currency option for ${waluta}`, { param: 'currency' });
    const metodaPl = p.default_payment_method || klient.invoice_settings.default_payment_method;
    if (!metodaPl || !S.metody.has(metodaPl)) return bladStripe(400, 'invalid_request_error', 'This customer has no attached payment source or default payment method.', { code: 'resource_missing' });
    const { sub, faktura } = utworzSubskrypcje({ idKlienta: klient.id, cena, waluta, metadane: p.metadata, dniProby: p.trial_period_days, metoda: metodaPl, zrodlo: 'api' });
    const zaplacona = zaplacFakture(faktura, sub, { metoda: metodaPl, bezZdarzen: true });
    if (sub.status !== 'trialing') sub.status = zaplacona ? 'active' : 'incomplete';
    zdarzenie('customer.subscription.created', subskrypcjaPubliczna(sub));
    zdarzenie(zaplacona ? 'invoice.paid' : 'invoice.payment_failed', faktura);
    return json(200, subskrypcjaPubliczna(sub), 'subskrypcja-utworz');
  }
  if ((m = /^\/v1\/subscriptions\/([^/]+)$/.exec(sciezka))) {
    const sub = S.subskrypcje.get(m[1]);
    if (!sub) return brakObiektu('subscription', m[1]);
    const teraz = terazDla(sub.customer);
    if (metoda === 'GET') return json(200, subskrypcjaPubliczna(sub), 'subskrypcja');
    if (metoda === 'DELETE') {
      if (sub.status === 'canceled') {
        return bladStripe(400, 'invalid_request_error', `A canceled subscription can only update its cancellation_details and metadata. Subscription ${sub.id} is canceled.`);
      }
      anulujTeraz(sub, teraz);
      return json(200, subskrypcjaPubliczna(sub), 'subskrypcja-anuluj');
    }
    if (metoda === 'POST') {
      const poprzednie = {};
      if (p.cancel_at_period_end !== undefined) { poprzednie.cancel_at_period_end = sub.cancel_at_period_end; sub.cancel_at_period_end = tak(p.cancel_at_period_end); sub.canceled_at = sub.cancel_at_period_end ? teraz : null; }
      if (p.cancel_at !== undefined) { poprzednie.cancel_at = sub.cancel_at; sub.cancel_at = p.cancel_at === '' ? null : Number(p.cancel_at); }
      if (p.metadata) Object.assign(sub.metadata, p.metadata);
      if (p.default_payment_method) { if (!S.metody.has(p.default_payment_method)) return brakObiektu('payment_method', p.default_payment_method); sub.default_payment_method = p.default_payment_method; }
      zdarzenie('customer.subscription.updated', subskrypcjaPubliczna(sub), poprzednie);
      return json(200, subskrypcjaPubliczna(sub), 'subskrypcja-zmien');
    }
  }
  // Ceny
  if ((m = /^\/v1\/prices\/([^/]+)$/.exec(sciezka)) && metoda === 'GET') {
    const c = S.ceny.get(m[1]);
    return c ? json(200, cenaPubliczna(c, rozwin), 'cena') : brakObiektu('price', m[1]);
  }
  // Faktury i ich platnosci
  if (sciezka === '/v1/invoices' && metoda === 'GET') {
    let dane = [...S.faktury.values()];
    if (p.customer) dane = dane.filter((f) => f.customer === p.customer);
    if (p.subscription) dane = dane.filter((f) => f.parent.subscription_details.subscription === p.subscription);
    if (p.status) dane = dane.filter((f) => f.status === p.status);
    dane.sort((a, b) => b.created - a.created);
    return json(200, lista(dane.slice(0, Math.min(Number(p.limit) || 10, 100)), '/v1/invoices'), 'faktury-lista');
  }
  if ((m = /^\/v1\/invoices\/([^/]+)$/.exec(sciezka)) && metoda === 'GET') {
    const f = S.faktury.get(m[1]);
    if (!f) return brakObiektu('invoice', m[1]);
    const wynik = klon(f);
    if (rozwin.includes('payments')) wynik.payments = lista(klon(S.platnosciFaktur.get(f.id) || []), `/v1/invoices/${f.id}/payments`);
    return json(200, wynik, 'faktura');
  }
  if (sciezka === '/v1/invoice_payments' && metoda === 'GET') {
    let dane = [...S.platnosciFaktur.values()].flat();
    if (p.invoice) dane = dane.filter((x) => x.invoice === p.invoice);
    if (p.payment && p.payment.payment_intent) dane = dane.filter((x) => x.payment.payment_intent === p.payment.payment_intent);
    return json(200, lista(klon(dane), '/v1/invoice_payments'), 'platnosci-faktur');
  }
  // Zwroty, obciazenia, platnosci
  if (sciezka === '/v1/refunds' && metoda === 'POST') {
    const w = utworzZwrot(p);
    return w.blad || json(200, w.obiekt, 'zwrot-utworz');
  }
  if (sciezka === '/v1/refunds' && metoda === 'GET') {
    let dane = [...S.zwroty.values()];
    if (p.charge) dane = dane.filter((r) => r.charge === p.charge);
    if (p.payment_intent) dane = dane.filter((r) => r.payment_intent === p.payment_intent);
    dane.sort((a, b) => b.created - a.created);
    return json(200, lista(dane, '/v1/refunds'), 'zwroty-lista');
  }
  if ((m = /^\/v1\/refunds\/([^/]+)$/.exec(sciezka)) && metoda === 'GET') {
    const r = S.zwroty.get(m[1]);
    return r ? json(200, r, 'zwrot') : brakObiektu('refund', m[1]);
  }
  if ((m = /^\/v1\/charges\/([^/]+)$/.exec(sciezka)) && metoda === 'GET') {
    const c = S.obciazenia.get(m[1]);
    return c ? json(200, c, 'obciazenie') : brakObiektu('charge', m[1]);
  }
  if ((m = /^\/v1\/payment_intents\/([^/]+)$/.exec(sciezka)) && metoda === 'GET') {
    const x = S.intencje.get(m[1]);
    return x ? json(200, x, 'platnosc') : brakObiektu('payment_intent', m[1]);
  }
  // Zegary testowe (tylko pelny klucz testowy)
  if (sciezka.startsWith('/v1/test_helpers/')) {
    if (!/^sk_test_/.test(klucz)) {
      return bladStripe(403, 'invalid_request_error', `The provided key '${klucz.slice(0, 12)}***' does not have the required permissions for this endpoint on account 'acct_atrapa'.`);
    }
    if (sciezka === '/v1/test_helpers/test_clocks' && metoda === 'POST') {
      const id = nowyId('clock', 24);
      const z = { id, object: 'test_helpers.test_clock', created: terazGlobalnie(), deletes_after: terazGlobalnie() + 30 * DOBA, frozen_time: Number(p.frozen_time) || terazGlobalnie(), livemode: false, name: p.name || null, status: 'ready' };
      S.zegary.set(id, z);
      return json(200, z, 'zegar-utworz');
    }
    if ((m = /^\/v1\/test_helpers\/test_clocks\/([^/]+)(\/advance)?$/.exec(sciezka))) {
      const z = S.zegary.get(m[1]);
      if (!z) return brakObiektu('test_clock', m[1]);
      if (metoda === 'GET' && !m[2]) return json(200, z, 'zegar');
      if (metoda === 'DELETE' && !m[2]) {
        S.zegary.delete(z.id);
        for (const [idK, k] of S.klienci) if (k.test_clock === z.id) S.klienci.delete(idK);
        for (const [idS, s] of S.subskrypcje) if (s.test_clock === z.id) S.subskrypcje.delete(idS);
        return json(200, { id: z.id, object: 'test_helpers.test_clock', deleted: true }, 'zegar-usun');
      }
      if (metoda === 'POST' && m[2]) {
        const cel = Number(p.frozen_time);
        if (!(cel > z.frozen_time)) return bladStripe(400, 'invalid_request_error', 'frozen_time musi byc pozniej niz obecny czas zegara', { param: 'frozen_time' });
        // jak Stripe: przesuwamy dzien po dniu, zeby ponowienia i odnowienia szly po kolei
        while (z.frozen_time < cel) {
          z.frozen_time = Math.min(cel, z.frozen_time + DOBA);
          przetworzCzas(z.id);
        }
        z.status = 'ready';
        return json(200, z, 'zegar-przesun');
      }
    }
  }
  return bladStripe(404, 'invalid_request_error', `Unrecognized request URL (${metoda}: ${sciezka}). (atrapa)`);
}

function sprawdzBladNaZadanie(metoda, sciezka) {
  for (const b of S.bledy) {
    if (b.metoda && b.metoda !== metoda) continue;
    if (!(b.razy > 0)) continue;
    let pasuje = false;
    try { pasuje = new RegExp(b.wzor).test(sciezka); } catch { pasuje = sciezka.includes(b.wzor); }
    if (!pasuje) continue;
    b.razy -= 1;
    if (b.status === 0) return { status: 0, naglowki: {}, cialo: '', rodzaj: 'zerwane', zerwij: true };
    const typ = b.status === 429 ? 'rate_limit_error' : (b.status >= 500 ? 'api_error' : 'invalid_request_error');
    return bladStripe(b.status, typ, `atrapa: blad na zadanie (${b.status})`);
  }
  return null;
}

// ─── Sterowanie atrapa ──────────────────────────────────────────────────────

function stanAtrapy() {
  const obiekty = (mapa, f = (x) => x) => [...mapa.values()].map(f);
  return {
    teraz: terazGlobalnie(), przesuniecie: S.przesuniecie, webhooki: S.webhooki, kolejnosc: S.kolejnosc,
    klienci: obiekty(S.klienci), sesje: obiekty(S.sesje, sesjaPubliczna), subskrypcje: obiekty(S.subskrypcje, subskrypcjaPubliczna),
    faktury: obiekty(S.faktury), zwroty: obiekty(S.zwroty), obciazenia: obiekty(S.obciazenia), zegary: obiekty(S.zegary),
    zdarzenia: S.zdarzenia.map((e) => ({ id: e.id, typ: e.type, obiekt: e.data.object.id })),
    dostarczone: S.dostarczone.slice(-100), nieudane: S.nieudane.map((e) => ({ id: e.id, typ: e.type })), doWyslania: S.doWyslania.length,
  };
}

function obiektPoId(id) {
  for (const mapa of [S.subskrypcje, S.faktury, S.sesje, S.obciazenia, S.klienci, S.zwroty]) {
    if (mapa.has(id)) {
      const o = mapa.get(id);
      if (o.object === 'subscription') return subskrypcjaPubliczna(o);
      if (o.object === 'checkout.session') return sesjaPubliczna(o);
      return klon(o);
    }
  }
  return null;
}

function sterowanie(metoda, sciezka, dane) {
  if (sciezka === '/_atrapa/stan' && metoda === 'GET') return json(200, stanAtrapy(), 'stan');
  if (sciezka === '/_atrapa/reset' && metoda === 'POST') { wyczysc(); return json(200, { ok: true }, 'reset'); }
  if (sciezka === '/_atrapa/czas' && metoda === 'POST') {
    const sekundy = (Number(dane.dni) || 0) * DOBA + (Number(dane.godziny) || 0) * 3600 + (Number(dane.sekundy) || 0);
    if (!(sekundy > 0)) return json(400, { blad: 'podaj dni, godziny albo sekundy > 0' }, 'czas-zle');
    const przed = S.zdarzenia.length;
    // dzien po dniu: ponowienia i odnowienia po kolei
    let zostalo = sekundy;
    while (zostalo > 0) {
      const krok = Math.min(zostalo, DOBA);
      S.przesuniecie += krok;
      zostalo -= krok;
      przetworzCzas(null);
    }
    return Object.assign(json(200, { teraz: terazGlobalnie(), zdarzenia: S.zdarzenia.slice(przed).map((e) => e.type) }, 'czas'), { wyslijPrzed: true });
  }
  if (sciezka === '/_atrapa/ustaw' && metoda === 'POST') {
    if (dane.kolejnosc) S.kolejnosc = String(dane.kolejnosc);
    if (dane.webhooki) S.webhooki = dane.webhooki === 'wylaczone' ? 'wylaczone' : 'wlaczone';
    return json(200, { ok: true, kolejnosc: S.kolejnosc, webhooki: S.webhooki }, 'ustaw');
  }
  if (sciezka === '/_atrapa/blad' && metoda === 'POST') {
    if (!dane.wzor) { S.bledy = []; return json(200, { ok: true, bledy: 0 }, 'blad-wyczysc'); }
    S.bledy.push({ wzor: String(dane.wzor), status: Number(dane.status) || 0, razy: dane.razy === undefined ? 1 : Number(dane.razy), metoda: String(dane.metoda || '').toUpperCase() });
    return json(200, { ok: true, bledy: S.bledy.length }, 'blad-ustaw');
  }
  if (sciezka === '/_atrapa/zdarzenia/ponow' && metoda === 'POST') {
    S.doWyslania.push(...S.nieudane.splice(0));
    return Object.assign(json(200, { ok: true }, 'zdarzenia-ponow'), { wyslijPrzed: true, raport: true });
  }
  if (sciezka === '/_atrapa/zdarzenia/wyslij' && metoda === 'POST') {
    const wpisy = Array.isArray(dane.zdarzenia) ? dane.zdarzenia : [{ typ: dane.typ, obiekt: dane.obiekt, id: dane.id, idZdarzenia: dane.idZdarzenia }];
    const nowe = [];
    for (const w of wpisy) {
      let obiekt = w.obiekt;
      if (!obiekt && w.id) obiekt = obiektPoId(w.id);
      if (typeof obiekt === 'string') obiekt = obiektPoId(obiekt);
      if (!w.typ || !obiekt) return json(400, { blad: 'podaj typ i obiekt (albo id istniejacego obiektu)' }, 'wyslij-zle');
      const e = zdarzenie(w.typ, obiekt);
      S.doWyslania.pop();
      if (w.idZdarzenia) e.id = String(w.idZdarzenia);
      if (dane.livemode !== undefined) e.livemode = tak(dane.livemode);
      nowe.push(e);
    }
    let kolejka = nowe;
    if (dane.kolejnosc === 'odwrocona') kolejka = nowe.slice().reverse();
    if (dane.kolejnosc === 'podwojna') kolejka = nowe.flatMap((e) => [e, e]);
    const opcje = { zlyPodpis: tak(dane.zlyPodpis), staryCzas: tak(dane.staryCzas), rownolegle: dane.kolejnosc === 'rownolegla' };
    for (const e of kolejka) S.doWyslania.push(Object.assign(Object.create(null), { __e: e, __o: opcje }));
    return Object.assign(json(200, { ok: true }, 'zdarzenia-wyslij'), { wyslijPrzed: true, raport: true, rownolegle: opcje.rownolegle });
  }
  return null;
}

// ─── Wejscie ─────────────────────────────────────────────────────────────────

/** Wspolna obsluga: (metoda, sciezka z query, naglowki, bufor ciala) -> { status, naglowki, cialo, rodzaj }. */
function obsluz(metoda, sciezkaPelna, naglowki = {}, bufor = Buffer.alloc(0)) {
  const [sciezkaSurowa, zapytanie = ''] = String(sciezkaPelna || '/').split('?');
  const sc = sciezkaSurowa.replace(/\/+$/, '') || '/';
  const h = {};
  for (const [k, v] of Object.entries(naglowki || {})) h[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  const baza = `http://${h.host || `${KONF.host}:${KONF.port}`}`;
  const tekstCiala = Buffer.isBuffer(bufor) ? bufor.toString('utf8') : String(bufor || '');

  if (metoda === 'GET' && (sc === '/zdrowie' || sc === '/health')) {
    return json(200, { ok: true, atrapa: 'stripe', wersja: WERSJA, port: KONF.port, gotowa: true, webhook: KONF.webhook || null }, 'zdrowie');
  }
  if (metoda === 'GET' && sc === '/_atrapa/wywolania') {
    const n = Number((String(sciezkaPelna).match(/[?&]n=(\d+)/) || [])[1] || 50);
    return json(200, ostatnie.slice(-n), 'wywolania');
  }
  if (sc.startsWith('/_atrapa/')) {
    let dane = {};
    if (tekstCiala) { try { dane = JSON.parse(tekstCiala); } catch { dane = rozkoduj(tekstCiala); } }
    const w = sterowanie(metoda, sc, dane);
    if (w) return w;
    return json(404, { blad: `nieznane sterowanie ${metoda} ${sc}` }, 'sterowanie-brak');
  }
  let m;
  if ((m = /^\/c\/pay\/([^/]+)$/.exec(sc)) && (metoda === 'GET' || metoda === 'POST')) {
    return obsluzStroneCheckout(metoda, m[1], metoda === 'POST' ? rozkoduj(tekstCiala) : {});
  }
  if ((m = /^\/p\/session\/([^/]+)$/.exec(sc)) && (metoda === 'GET' || metoda === 'POST')) {
    if (metoda === 'GET') {
      const ok = new URLSearchParams(zapytanie).get('ok');
      const panel = S.panele.get(m[1]);
      if (panel && ok) return html(200, stronaPanelu(panel, ok), 'panel-strona');
    }
    return obsluzStronePanelu(metoda, m[1], metoda === 'POST' ? rozkoduj(tekstCiala) : {});
  }
  if (!sc.startsWith('/v1/')) return bladStripe(404, 'invalid_request_error', `Unrecognized request URL (${metoda}: ${sc}). (atrapa)`);

  // API: uwierzytelnienie, wersja, bledy na zadanie, idempotencja
  const autoryzacja = h.authorization || '';
  const klucz = /^Bearer\s+(\S+)$/i.test(autoryzacja) ? autoryzacja.replace(/^Bearer\s+/i, '').trim() : '';
  if (!klucz || (klucz !== KONF.klucz && klucz !== KONF.kluczZegary)) {
    return bladStripe(401, 'invalid_request_error', `Invalid API Key provided: ${klucz ? `${klucz.slice(0, 8)}***` : '(brak)'}`);
  }
  if (!h['stripe-version']) {
    return bladStripe(400, 'invalid_request_error', 'atrapa: brak naglowka Stripe-Version (serwer ma przypinac wersje API)');
  }
  const blad = sprawdzBladNaZadanie(metoda, sc);
  if (blad) return blad;
  const p = metoda === 'GET' || metoda === 'DELETE' ? rozkoduj(zapytanie) : rozkoduj(tekstCiala);
  const rozwin = Array.isArray(p.expand) ? p.expand : [];
  const kluczIdem = h['idempotency-key'] || '';
  if (metoda === 'POST' && kluczIdem) {
    const podpis = podpisParametrow(metoda, sc, Buffer.from(tekstCiala));
    const byl = S.idempotencja.get(kluczIdem);
    if (byl) {
      if (byl.podpis !== podpis) {
        return bladStripe(400, 'idempotency_error', `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${kluczIdem}' if you meant to execute a different request.`);
      }
      return Object.assign(klon(byl.wynik), { naglowki: Object.assign({}, byl.wynik.naglowki, { 'idempotent-replayed': 'true' }) });
    }
    const wynik = trasaApi(metoda, sc, p, rozwin, baza, klucz);
    if (wynik.status < 500) S.idempotencja.set(kluczIdem, { podpis, wynik: klon(wynik) });
    return wynik;
  }
  return trasaApi(metoda, sc, p, rozwin, baza, klucz);
}

// ─── Wysylka zdarzen ─────────────────────────────────────────────────────────

function podpisz(cialo, sekret, t) {
  return crypto.createHmac('sha256', sekret).update(`${t}.`).update(cialo).digest('hex');
}

let lancuchWysylki = Promise.resolve();

async function dostarcz(wpis) {
  const e = wpis.__e || wpis;
  const o = wpis.__o || {};
  const wynik = { id: e.id, typ: e.type, status: 0, czas: new Date().toISOString() };
  if (S.webhooki === 'wylaczone' || !KONF.webhook) {
    wynik.status = 0;
    wynik.powod = KONF.webhook ? 'webhooki wylaczone' : 'brak adresu webhooka';
    S.nieudane.push(e);
    S.dostarczone.push(wynik);
    return wynik;
  }
  const cialo = Buffer.from(JSON.stringify(e), 'utf8');
  const t = Math.floor(Date.now() / 1000) - (o.staryCzas ? 600 : 0);
  const podpis = o.zlyPodpis ? podpisz(cialo, 'whsec_zly', t) : podpisz(cialo, KONF.sekret, t);
  try {
    const odp = await fetch(KONF.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Stripe-Signature': `t=${t},v1=${podpis}`, 'User-Agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks) atrapa' },
      body: cialo,
      signal: AbortSignal.timeout(15000),
    });
    wynik.status = odp.status;
    try { wynik.odpowiedz = (await odp.text()).slice(0, 300); } catch { /* bez tresci */ }
  } catch (err) {
    wynik.status = 0;
    wynik.powod = err.message;
  }
  if (!(wynik.status >= 200 && wynik.status < 300) && !o.zlyPodpis && !o.staryCzas) S.nieudane.push(e);
  S.dostarczone.push(wynik);
  if (S.dostarczone.length > 300) S.dostarczone.shift();
  return wynik;
}

/** Wysyla odlozone zdarzenia (po kolei, w kolejnosci z ustawien). -> lista wynikow */
function wyslijZdarzenia({ rownolegle = false } = {}) {
  const kolejka = S.doWyslania.splice(0);
  let doWyslania = kolejka;
  if (S.kolejnosc === 'odwrocona') doWyslania = kolejka.slice().reverse();
  if (S.kolejnosc === 'podwojna') doWyslania = kolejka.flatMap((e) => [e, e]);
  const rownolegleWszystkie = rownolegle || S.kolejnosc === 'rownolegla';
  const praca = lancuchWysylki.then(async () => {
    if (rownolegleWszystkie) return Promise.all(doWyslania.map(dostarcz));
    const wyniki = [];
    for (const e of doWyslania) wyniki.push(await dostarcz(e));
    return wyniki;
  });
  lancuchWysylki = praca.catch(() => []);
  return praca;
}

/**
 * Serwer atrapy. uruchom(port, { sekret, webhook, host, klucz }) -> http.Server (nasluchuje od razu;
 * przy porcie 0 adres z serwer.address().port po zdarzeniu 'listening').
 * Zdarzenia z akcji przegladarki i sterowania ida PRZED odpowiedzia (przekierowanie widzi
 * juz przetworzony stan), zdarzenia z wywolan API ida PO odpowiedzi (serwer aplikacji
 * moze czekac na odpowiedz API w zamku klienta, ktory obsluga webhooka tez bierze).
 */
function uruchom(port = KONF.port, opcje = {}) {
  if (opcje.sekret !== undefined) KONF.sekret = String(opcje.sekret);
  if (opcje.webhook !== undefined) KONF.webhook = String(opcje.webhook);
  if (opcje.klucz !== undefined) KONF.klucz = String(opcje.klucz);
  const host = opcje.host || KONF.host;
  wyczysc();
  const serwer = http.createServer((req, res) => {
    const kawalki = [];
    req.on('data', (c) => kawalki.push(c));
    req.on('end', async () => {
      const bufor = Buffer.concat(kawalki);
      let wynik;
      try {
        wynik = obsluz(req.method, req.url, req.headers, bufor);
      } catch (e) {
        wynik = json(500, { error: { type: 'api_error', message: 'atrapa stripe: ' + e.message } }, 'wyjatek');
      }
      if (wynik.zerwij) { req.socket.destroy(); return; }
      let raport = null;
      if (wynik.wyslijPrzed) {
        try { raport = await wyslijZdarzenia({ rownolegle: wynik.rownolegle }); } catch (e) { raport = [{ blad: e.message }]; }
      }
      const cialo = Buffer.from(wynik.raport ? JSON.stringify({ ok: true, dostarczone: raport }) : String(wynik.cialo || ''), 'utf8');
      res.writeHead(wynik.status, Object.assign({}, wynik.naglowki, { 'content-length': cialo.length }));
      res.end(cialo);
      if (!wynik.wyslijPrzed && S.doWyslania.length) wyslijZdarzenia().catch(() => {});
      if (!req.url.startsWith('/_atrapa/') && !req.url.startsWith('/zdrowie')) {
        let parametry = null;
        if (req.url.startsWith('/v1/')) {
          try { parametry = req.method === 'GET' || req.method === 'DELETE' ? rozkoduj(String(req.url).split('?')[1] || '') : rozkoduj(bufor.toString('utf8')); } catch { parametry = null; }
        }
        const autoryzacja = String(req.headers.authorization || '');
        zapiszWywolanie({
          czas: new Date().toISOString(), metoda: req.method, sciezka: req.url, status: wynik.status, rodzaj: wynik.rodzaj,
          wersjaApi: req.headers['stripe-version'] || null, idempotencja: req.headers['idempotency-key'] || null,
          klucz: autoryzacja ? autoryzacja.replace(/^Bearer\s+/i, '').slice(0, 8) : null, parametry,
        });
      }
    });
  });
  serwer.listen(port, host, () => {
    if (require.main === module) console.log(`[atrapa] stripe na http://${host}:${serwer.address().port} (webhook: ${KONF.webhook || 'brak'})`);
  });
  return serwer;
}

wyczysc();

module.exports = { obsluz, uruchom, wyslijZdarzenia, podpisz, rozkoduj, KONF, WERSJA, WERSJA_API_ZDARZEN, stan: () => S, wyczysc };

if (require.main === module) uruchom();
