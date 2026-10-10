'use strict';

// ─── Adapter Stripe na fetch (wykonawca B, ARCH8-13..17) ─────────────────────
//
// Jedyny plik, ktory zna Stripe. Rdzen (platnosci.js), konta, pakiety i aplikacja znaja
// tylko znormalizowany stan subskrypcji, wiec inny dostawca (np. posrednik Merchant of
// Record) to nowy plik platnosci-<nazwa>.js z tymi samymi funkcjami i PLATNOSCI=<nazwa>.
//
// Interfejs (konf = KONF serwera; konf.platnosci.stripe = { klucz, sekretWebhooka[], ceny, wersjaApi,
// urlApi, portalKonfiguracja, hostyPrzekierowan[] }):
//   nazwa, WERSJA_API, BladPodpisu, BladDostawcy, USTAWIENIA
//   sprawdzKonfiguracje(konf, plany)       -> [bledy]   prefiks klucza a tryb, sekret webhooka, ceny dla walut (bez sieci)
//   ostrzezeniaKonfiguracji(konf)          -> [ostrzezenia]
//   async przygotujKlienta({ konto, jezyk, konf })                         -> idKlienta (klucz idempotencji klient-<tryb>-<login>)
//   async rozpocznijZakup({ konto, idKlienta, plan, waluta, jezyk, adresPowrotu, adresRezygnacji, metadane, tekstPrzycisku, konf })
//                                                                          -> { url, idSesji }
//   async otworzPanel({ idKlienta, jezyk, adresPowrotu, konf })            -> { url }
//   zweryfikujZdarzenie(surowe, naglowki, konf, teraz)                     -> zdarzenie albo throw BladPodpisu
//   rozpoznajZdarzenie(zdarzenie)          -> { id, typ, tryb, utworzone, idKlienta, login, idSesji, idFaktury, idObciazenia } | null
//   async stanKlienta({ idKlienta, konf, plany })                          -> StanSubskrypcji
//   async potwierdzSesje({ idSesji, konf })                               -> { idSesji, idKlienta, login, zakonczona, oplacona, idSubskrypcji, kraj, tryb }
//   async anulujWszystko({ idKlienta, konf })                             -> { anulowano, subskrypcje: [id] }
//   async anulujSubskrypcje({ idSubskrypcji, konf })                      -> { anulowano }
//   async ceny({ konf, plany })            -> { kwoty: { standard: { eur: 1900, pln: 7900 } }, bledy: [opis] }
//   async faktura({ idFaktury, konf })     -> Wplata
//   async faktury({ idKlienta, konf })     -> [Wplata]   oplacone faktury klienta (uzgadnianie rejestru wplat)
//   async zwroc({ idPlatnosci, kwota, idempotencja, metadane, konf })      -> { id, kwota, waluta, status, czas }
//   async zwrotyObciazenia({ idObciazenia, konf })                        -> { idPlatnosci, zwroconoLacznie, waluta, zwroty: [...] }
//   hostyPrzekierowan(konf)                -> ['https://checkout.stripe.com', 'https://billing.stripe.com']
//
// StanSubskrypcji: { stan: 'brak'|'probna'|'aktywna'|'zalegla'|'anulowana'|'wygasla', plan, idSubskrypcji,
//                    okresDo (ms), waluta, surowy, od (ms: zawarcie umowy), kraj }
// Wplata: { id, idKlienta, idSubskrypcji, kwota, waluta, kraj, oplacono, okresOd, okresDo, status, plan, idCeny,
//           idPlatnosci, powod, tryb }
//
// Wersja API przypieta (ARCH8-14): wszystkie zapytania wysylaja Stripe-Version, wiec domyslna wersja
// konta w panelu nie ma znaczenia. Kod czyta pola po zmianach 2025-03-31.basil: koniec okresu
// z items.data[].current_period_end (zapas: stare current_period_end), subskrypcja faktury z
// parent.subscription_details.subscription (zapas: stare subscription), platnosc faktury z
// /v1/invoice_payments (zapas: stare payment_intent/charge). Z tresci zdarzenia czytamy tylko pola
// stabilne we wszystkich wersjach (id, type, livemode, created, data.object.id/customer/
// client_reference_id/metadata), a stan zawsze pobieramy z API (ARCH8-15), wiec wersja punktu
// koncowego webhooka w panelu Stripe moze byc inna niz WERSJA_API.

const crypto = require('node:crypto');

const WERSJA_API = '2025-03-31.basil';
const TOLERANCJA_S = 300;                 // |teraz - t| podpisu webhooka (ARCH8-15)

// Limity czasu i ponowienia (ARCH8-14): 10 s, najwyzej 2 ponowienia po 0,5 s i 2 s przy bledzie
// sieci, 429 i 5xx; POST tylko z kluczem idempotencji. Testy skracaja przerwy.
const USTAWIENIA = { limitCzasuMs: 10_000, ponowieniaMs: [500, 2000] };

class BladPodpisu extends Error {
  constructor(powod) {
    super(`Niepoprawny podpis zdarzenia: ${powod}`);
    this.name = 'BladPodpisu';
    this.powod = powod;
    this.status = 400;
  }
}

/** Blad API dostawcy (siec, 4xx, 5xx). Do klienta idzie tylko nasz kod, do dziennika typ, kod i request-id. */
class BladDostawcy extends Error {
  constructor({ status = 0, typ = null, kod = null, idZadania = null, komunikat = '', metoda = '', sciezka = '' } = {}) {
    super(`Stripe ${metoda} ${sciezka}: ${status || 'brak polaczenia'} ${typ || ''}${kod ? `/${kod}` : ''}${idZadania ? ` (${idZadania})` : ''}${komunikat ? `: ${komunikat}` : ''}`);
    this.name = 'BladDostawcy';
    this.statusDostawcy = status;
    this.typ = typ;
    this.kod = kod;
    this.idZadania = idZadania;
    this.komunikatDostawcy = komunikat;
    this.status = 503;
    // 4xx (poza 429) to blad zapytania albo konfiguracji: ponowienie nic nie da
    this.przejsciowy = !status || status === 429 || status >= 500;
  }
}

function czekaj(ms) { return new Promise((r) => setTimeout(r, ms)); }

function s(konf) { return (konf && konf.platnosci && konf.platnosci.stripe) || {}; }
function wersjaApi(konf) { return s(konf).wersjaApi || WERSJA_API; }
function tryb(konf) { return konf && konf.platnosci ? konf.platnosci.tryb : ''; }

/** Notacja nawiasowa Stripe: { a: { b: [ { c: 1 } ] } } -> a[b][0][c]=1. */
function zakoduj(obiekt) {
  const pary = [];
  const dodaj = (klucz, v) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((e, i) => dodaj(`${klucz}[${i}]`, e));
    else if (typeof v === 'object') for (const [k, w] of Object.entries(v)) dodaj(`${klucz}[${k}]`, w);
    else pary.push([klucz, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)]);
  };
  for (const [k, v] of Object.entries(obiekt || {})) dodaj(k, v);
  return new URLSearchParams(pary).toString();
}

/**
 * Zapytanie do API Stripe. -> obiekt JSON albo throw BladDostawcy.
 *   zapytanie(konf, 'POST', '/customers', { email }, { idempotencja: 'klient-test-k-abc' })
 */
async function zapytanie(konf, metoda, sciezka, parametry = null, { idempotencja = null } = {}) {
  const st = s(konf);
  let url = `${st.urlApi || 'https://api.stripe.com'}/v1${sciezka}`;
  const zakodowane = parametry ? zakoduj(parametry) : '';
  const naglowki = {
    Authorization: `Bearer ${st.klucz}`,
    'Stripe-Version': wersjaApi(konf),
    'User-Agent': 'ContentAI/1 (+https://content-ai.net)',
  };
  let body;
  if (metoda === 'GET' || metoda === 'DELETE') {
    if (zakodowane) url += `${url.includes('?') ? '&' : '?'}${zakodowane}`;
  } else {
    body = zakodowane;
    naglowki['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencja) naglowki['Idempotency-Key'] = idempotencja;
  }
  const moznaPonowic = metoda !== 'POST' || Boolean(idempotencja);
  for (let proba = 0; ; proba += 1) {
    let odp = null;
    let dane = null;
    let bladSieci = null;
    try {
      odp = await fetch(url, { method: metoda, headers: naglowki, body, signal: AbortSignal.timeout(USTAWIENIA.limitCzasuMs) });
      const tekst = await odp.text();
      try { dane = tekst ? JSON.parse(tekst) : {}; } catch { dane = null; }
    } catch (e) {
      bladSieci = e;
    }
    if (!bladSieci && odp.ok && dane) return dane;
    const przejsciowy = Boolean(bladSieci) || odp.status === 429 || odp.status >= 500;
    if (przejsciowy && moznaPonowic && proba < USTAWIENIA.ponowieniaMs.length) {
      await czekaj(USTAWIENIA.ponowieniaMs[proba]);
      continue;
    }
    const e = (dane && dane.error) || {};
    throw new BladDostawcy({
      status: bladSieci ? 0 : odp.status,
      typ: bladSieci ? (bladSieci.name === 'TimeoutError' ? 'limit-czasu' : 'siec') : e.type || null,
      kod: e.code || null,
      idZadania: odp ? odp.headers.get('request-id') : null,
      komunikat: String(bladSieci ? bladSieci.message : e.message || '').slice(0, 300),
      metoda,
      sciezka: sciezka.split('?')[0],
    });
  }
}

// ─── Konfiguracja (bez sieci) ────────────────────────────────────────────────

const WZOR_CENY = /^price_[A-Za-z0-9_]{1,200}$/;

/**
 * STRIPE_CENA_<PLAN>: "price_..." (jedna cena wielowalutowa: currency_options) albo
 * "eur:price_a,pln:price_b" (osobna cena na walute). -> { ok, ceny: { '*'|waluta: id }, blad }
 */
function parsujCene(tekst) {
  const t = String(tekst || '').trim();
  if (!t) return { ok: false, blad: 'brak' };
  if (!t.includes(':')) return WZOR_CENY.test(t) ? { ok: true, ceny: { '*': t } } : { ok: false, blad: 'format' };
  const ceny = {};
  for (const czesc of t.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z]{3}):(.+)$/i.exec(czesc);
    if (!m || !WZOR_CENY.test(m[2].trim())) return { ok: false, blad: 'format' };
    ceny[m[1].toLowerCase()] = m[2].trim();
  }
  return { ok: true, ceny };
}

/** Identyfikator ceny pakietu w walucie albo null. */
function idCeny(konf, plan, waluta) {
  const w = parsujCene((s(konf).ceny || {})[plan]);
  if (!w.ok) return null;
  return w.ceny['*'] || w.ceny[waluta] || null;
}

/** Pakiet dla ceny: z konfiguracji STRIPE_CENA_*, potem lookup_key albo metadata.plan ceny. */
function planZCeny(konf, plany, cena) {
  if (!cena) return null;
  const id = typeof cena === 'string' ? cena : cena.id;
  for (const plan of Object.keys((plany && plany.PLANY) || {})) {
    const w = parsujCene((s(konf).ceny || {})[plan]);
    if (w.ok && Object.values(w.ceny).includes(id)) return plan;
  }
  if (typeof cena === 'object') {
    for (const kandydat of [cena.lookup_key, cena.metadata && cena.metadata.plan]) {
      if (kandydat && plany && plany.PLANY[kandydat]) return kandydat;
    }
  }
  return null;
}

function poprawnyAdresApi(adres) {
  let u;
  try { u = new URL(adres); } catch { return false; }
  if (u.pathname !== '/' || u.search || u.username) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
}

/** Host przekierowania do form-action: https://host albo (testy) http://127.0.0.1:port. */
function poprawnyHost(h) {
  return /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(h) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(h);
}

/**
 * Kontrola konfiguracji adaptera przy starcie (bez sieci, ARCH8-20). Komunikaty podaja
 * nazwy zmiennych, nigdy wartosci.
 */
function sprawdzKonfiguracje(konf, plany) {
  const st = s(konf);
  const t = tryb(konf);
  const bledy = [];
  const klucz = String(st.klucz || '');
  if (!klucz) bledy.push('brak STRIPE_KLUCZ');
  else if (/^WSTAW_TUTAJ/.test(klucz)) bledy.push('STRIPE_KLUCZ: wartosc z przykladu (WSTAW_TUTAJ_...)');
  else if (/^pk_/.test(klucz)) bledy.push('STRIPE_KLUCZ: to klucz publiczny (pk_...); serwer potrzebuje klucza ograniczonego rk_...');
  else {
    const m = /^(rk|sk)_(test|live)_[A-Za-z0-9]+/.exec(klucz);
    if (!m) bledy.push('STRIPE_KLUCZ: nieznany format (oczekiwany rk_test_..., rk_live_... albo sk_...)');
    else if (m[2] !== t) bledy.push(`STRIPE_KLUCZ: klucz trybu ${m[2]}, a PLATNOSCI_TRYB=${t}`);
  }
  const sekrety = Array.isArray(st.sekretWebhooka) ? st.sekretWebhooka : [];
  if (!sekrety.length) bledy.push('brak STRIPE_SEKRET_WEBHOOKA');
  else if (sekrety.some((x) => /^WSTAW_TUTAJ/.test(x))) bledy.push('STRIPE_SEKRET_WEBHOOKA: wartosc z przykladu (WSTAW_TUTAJ_...)');
  else if (sekrety.some((x) => !/^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(x))) bledy.push('STRIPE_SEKRET_WEBHOOKA: sekret podpisu z panelu Stripe zaczyna sie od whsec_');
  const waluty = (konf.platnosci && konf.platnosci.waluty) || [];
  for (const [plan, p] of Object.entries((plany && plany.PLANY) || {})) {
    if (!p.sprzedaz) continue;
    const zmienna = `STRIPE_CENA_${plan.toUpperCase()}`;
    const w = parsujCene((st.ceny || {})[plan]);
    if (!w.ok) {
      bledy.push(w.blad === 'brak' ? `brak ${zmienna}` : `${zmienna}: format "price_..." albo "eur:price_...,pln:price_..."`);
      continue;
    }
    if (!w.ceny['*']) {
      for (const wal of waluty) if (!w.ceny[wal]) bledy.push(`${zmienna}: brak ceny dla waluty ${wal} (PLATNOSCI_WALUTY)`);
      for (const wal of Object.keys(w.ceny)) if (!waluty.includes(wal)) bledy.push(`${zmienna}: waluta ${wal} spoza PLATNOSCI_WALUTY`);
    }
  }
  if (!poprawnyAdresApi(st.urlApi || 'https://api.stripe.com')) bledy.push('STRIPE_URL_API: adres https://host (atrapa w testach: http://127.0.0.1:port)');
  if (st.wersjaApi && !/^\d{4}-\d{2}-\d{2}(\.[a-z]+)?$/.test(st.wersjaApi)) bledy.push('STRIPE_WERSJA_API: format RRRR-MM-DD.nazwa, np. 2025-03-31.basil');
  if (st.portalKonfiguracja && !/^bpc_[A-Za-z0-9]+$/.test(st.portalKonfiguracja)) bledy.push('STRIPE_PORTAL_KONFIGURACJA: identyfikator bpc_... z panelu Stripe');
  const hosty = Array.isArray(st.hostyPrzekierowan) ? st.hostyPrzekierowan : [];
  if (!hosty.length || hosty.some((h) => !poprawnyHost(h))) bledy.push('STRIPE_HOSTY_PRZEKIEROWAN: lista adresow https://host oddzielona spacjami');
  return bledy;
}

/** Ostrzezenia (funkcja dziala): rzeczy do sprawdzenia w trybie testowym. */
function ostrzezeniaKonfiguracji(konf) {
  const o = [];
  const metody = (konf.platnosci && konf.platnosci.metody) || [];
  if (metody.includes('blik')) o.push('PLATNOSCI_METODY: blik tylko dla PLN; sprawdz w trybie testowym (krok T6), czy Stripe przyjmuje go w subskrypcji');
  if (s(konf).wersjaApi && s(konf).wersjaApi !== WERSJA_API) o.push(`STRIPE_WERSJA_API rozna od wersji, pod ktora pisano adapter (${WERSJA_API}): sprawdz pola okresu i faktur w trybie testowym`);
  return o;
}

// ─── Podpis webhooka (ARCH8-15) ──────────────────────────────────────────────

/** HMAC-SHA256(sekret, `${t}.` + surowe cialo) w hex - ten sam schemat co Stripe. */
function podpis(surowe, sekret, t) {
  return crypto.createHmac('sha256', sekret).update(`${t}.`).update(surowe).digest('hex');
}

/**
 * Weryfikacja na SUROWYCH bajtach (bez JSON.parse przed sprawdzeniem). Naglowek
 * Stripe-Signature: t=<s>,v1=<hex>[,v1=<hex>]; kazdy sekret z listy (zmiana sekretu)
 * porownany z kazdym v1 (timingSafeEqual), tolerancja czasu 300 s. -> zdarzenie albo BladPodpisu.
 */
function zweryfikujZdarzenie(surowe, naglowki, konf, teraz = Date.now()) {
  if (!Buffer.isBuffer(surowe)) throw new BladPodpisu('cialo musi byc Bufferem (surowe bajty)');
  const naglowek = String((naglowki && (naglowki['stripe-signature'] || naglowki['Stripe-Signature'])) || '');
  if (!naglowek) throw new BladPodpisu('brak naglowka Stripe-Signature');
  let t = null;
  const v1 = [];
  for (const czesc of naglowek.split(',')) {
    const i = czesc.indexOf('=');
    if (i < 1) continue;
    const k = czesc.slice(0, i).trim();
    const v = czesc.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (!t || !v1.length) throw new BladPodpisu('brak t albo v1 w naglowku');
  const sekrety = (s(konf).sekretWebhooka || []).filter(Boolean);
  const zgodny = sekrety.some((sekret) => {
    const oczekiwany = Buffer.from(podpis(surowe, sekret, t), 'hex');
    return v1.some((p) => {
      const b = Buffer.from(p, 'hex');
      return b.length === oczekiwany.length && crypto.timingSafeEqual(b, oczekiwany);
    });
  });
  if (!zgodny) throw new BladPodpisu('podpis niezgodny');
  if (Math.abs(teraz / 1000 - t) > TOLERANCJA_S) throw new BladPodpisu('znacznik czasu poza tolerancja (300 s)');
  try {
    return JSON.parse(surowe.toString('utf8'));
  } catch {
    throw new BladPodpisu('cialo nie jest JSON');
  }
}

const OBSLUGIWANE = new Set([
  'checkout.session.completed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed',
  'charge.refunded',
]);

/**
 * Co zdarzenie mowi rdzeniowi: KTOREGO klienta odswiezyc (stan i tak z API). Nieobslugiwany
 * typ -> null (200 bez przetwarzania). Czyta tylko pola stabilne miedzy wersjami API.
 */
function rozpoznajZdarzenie(zd) {
  if (!zd || typeof zd !== 'object' || typeof zd.id !== 'string' || typeof zd.type !== 'string') return null;
  if (!OBSLUGIWANE.has(zd.type)) return null;
  const o = (zd.data && zd.data.object) || {};
  const wynik = {
    id: zd.id, typ: zd.type, tryb: zd.livemode ? 'live' : 'test', utworzone: (Number(zd.created) || 0) * 1000,
    idKlienta: typeof o.customer === 'string' ? o.customer : (o.customer && o.customer.id) || null,
    login: (o.metadata && o.metadata.login) || null,
    idSesji: null, idFaktury: null, idObciazenia: null,
  };
  if (zd.type === 'checkout.session.completed') {
    wynik.idSesji = o.id || null;
    wynik.login = o.client_reference_id || wynik.login;
  } else if (zd.type.startsWith('invoice.')) {
    wynik.idFaktury = o.id || null;
  } else if (zd.type === 'charge.refunded') {
    wynik.idObciazenia = o.id || null;
  }
  return wynik;
}

// ─── Klient, Checkout, Portal ────────────────────────────────────────────────

async function przygotujKlienta({ konto, jezyk = 'pl', konf }) {
  const parametry = {
    metadata: { login: konto.login },
    preferred_locales: [jezyk === 'en' ? 'en' : 'pl'],
  };
  if (konto.email) parametry.email = konto.email;
  const k = await zapytanie(konf, 'POST', '/customers', parametry, { idempotencja: `klient-${tryb(konf)}-${konto.login}` });
  return k.id;
}

/**
 * Sesja Checkout w trybie subskrypcji (ARCH8-17, ARCH8-18, PR8-10, PR8-13): waluta wybrana przez nas
 * (currency przy cenie wielowalutowej), adres rozliczeniowy wymagany, bez automatic_tax i tax_id_collection
 * (opcje z konfiguracji), metody platnosci z PLATNOSCI_METODY ('auto' = ustawienia panelu Stripe).
 */
async function rozpocznijZakup({ konto, idKlienta, plan, waluta, jezyk = 'pl', adresPowrotu, adresRezygnacji, metadane = {}, tekstPrzycisku = '', konf }) {
  const p = konf.platnosci;
  const cena = idCeny(konf, plan, waluta);
  if (!cena) throw new BladDostawcy({ status: 400, typ: 'konfiguracja', komunikat: `brak ceny ${plan}/${waluta}`, metoda: 'POST', sciezka: '/checkout/sessions' });
  const wieloWalutowa = Boolean(parsujCene((s(konf).ceny || {})[plan]).ceny['*']);
  const metody = (p.metody || ['card']).filter((m) => m !== 'auto' && (m !== 'blik' || waluta === 'pln'));
  const parametry = {
    mode: 'subscription',
    customer: idKlienta,
    client_reference_id: konto.login,
    line_items: [{ price: cena, quantity: 1 }],
    locale: jezyk === 'en' ? 'en' : 'pl',
    success_url: adresPowrotu,
    cancel_url: adresRezygnacji,
    billing_address_collection: 'required',
    customer_update: { address: 'auto', name: 'auto' },
    metadata: { login: konto.login, plan, ...metadane },
    subscription_data: { metadata: { login: konto.login, plan, ...metadane } },
  };
  if (wieloWalutowa) parametry.currency = waluta;
  if (!(p.metody || []).includes('auto')) parametry.payment_method_types = metody.length ? metody : ['card'];
  if (p.kodyRabatowe) parametry.allow_promotion_codes = true;
  if (Number(p.probaDni) > 0) parametry.subscription_data.trial_period_days = Number(p.probaDni);
  if (p.nipKlienta) parametry.tax_id_collection = { enabled: true };
  if (p.podatki) parametry.automatic_tax = { enabled: true };
  if (tekstPrzycisku) parametry.custom_text = { submit: { message: String(tekstPrzycisku).slice(0, 1200) } };
  const sesja = await zapytanie(konf, 'POST', '/checkout/sessions', parametry, { idempotencja: `zakup-${crypto.randomUUID()}` });
  return { url: sesja.url, idSesji: sesja.id };
}

async function otworzPanel({ idKlienta, jezyk = 'pl', adresPowrotu, konf }) {
  const parametry = { customer: idKlienta, return_url: adresPowrotu, locale: jezyk === 'en' ? 'en' : 'pl' };
  if (s(konf).portalKonfiguracja) parametry.configuration = s(konf).portalKonfiguracja;
  const p = await zapytanie(konf, 'POST', '/billing_portal/sessions', parametry, { idempotencja: `panel-${crypto.randomUUID()}` });
  return { url: p.url };
}

/** Sesja Checkout po powrocie: do kogo nalezy i czy zakonczona. */
async function potwierdzSesje({ idSesji, konf }) {
  const x = await zapytanie(konf, 'GET', `/checkout/sessions/${encodeURIComponent(idSesji)}`);
  const adres = (x.customer_details && x.customer_details.address) || {};
  return {
    idSesji: x.id,
    idKlienta: typeof x.customer === 'string' ? x.customer : (x.customer && x.customer.id) || null,
    login: x.client_reference_id || (x.metadata && x.metadata.login) || null,
    zakonczona: x.status === 'complete',
    oplacona: x.payment_status === 'paid' || x.payment_status === 'no_payment_required',
    idSubskrypcji: typeof x.subscription === 'string' ? x.subscription : (x.subscription && x.subscription.id) || null,
    kraj: adres.country ? String(adres.country).toUpperCase() : null,
    tryb: x.livemode ? 'live' : 'test',
  };
}

// ─── Stan subskrypcji (ARCH8-15, ARCH8-16) ───────────────────────────────────

// Pierwszenstwo statusow przy kilku subskrypcjach klienta: zywe, potem unpaid, incomplete, zakonczone.
const PIERWSZENSTWO = { trialing: 0, active: 0, past_due: 0, unpaid: 1, incomplete: 2, canceled: 3, incomplete_expired: 3, paused: 3 };

function stanZeStatusu(sub) {
  switch (sub.status) {
    case 'trialing': return 'probna';
    case 'active': return sub.cancel_at_period_end || sub.cancel_at ? 'anulowana' : 'aktywna';
    case 'past_due': case 'unpaid': return 'zalegla';
    case 'canceled': case 'incomplete_expired': case 'paused': return 'wygasla';
    default: return 'brak';          // incomplete: pierwsza platnosc niedokonczona (np. 3D Secure)
  }
}

function koniecOkresu(sub) {
  const elementy = (sub.items && sub.items.data) || [];
  const konce = elementy.map((e) => Number(e.current_period_end) || 0).filter(Boolean);
  if (!konce.length && sub.current_period_end) konce.push(Number(sub.current_period_end));   // przed basil
  return konce.length ? Math.max(...konce) * 1000 : null;
}

function cenaSubskrypcji(sub) {
  const e = ((sub.items && sub.items.data) || [])[0];
  return e ? e.price || (e.plan ? { id: e.plan.id } : null) : null;
}

/**
 * Stan klienta z LISTY jego subskrypcji (kolejnosc i liczba zdarzen bez znaczenia).
 *   -> StanSubskrypcji
 */
async function stanKlienta({ idKlienta, konf, plany }) {
  const odp = await zapytanie(konf, 'GET', '/subscriptions', { customer: idKlienta, status: 'all', limit: 10 });
  const lista = (odp && odp.data) || [];
  const kolejnoscPlanu = (sub) => {
    const plan = planZCeny(konf, plany, cenaSubskrypcji(sub));
    return plan && plany.PLANY[plan] ? plany.PLANY[plan].kolejnosc || 0 : -1;
  };
  const wybrana = lista.slice().sort((a, b) => ((PIERWSZENSTWO[a.status] ?? 4) - (PIERWSZENSTWO[b.status] ?? 4))
    || (kolejnoscPlanu(b) - kolejnoscPlanu(a)) || ((b.created || 0) - (a.created || 0)))[0];
  if (!wybrana) return { stan: 'brak', plan: null, idSubskrypcji: null, okresDo: null, waluta: null, surowy: null, od: null, kraj: null };
  const stan = stanZeStatusu(wybrana);
  const plan = planZCeny(konf, plany, cenaSubskrypcji(wybrana));
  if (!plan && stan !== 'brak' && stan !== 'wygasla') {
    console.error(`[platnosci] subskrypcja ${wybrana.id}: cena ${(cenaSubskrypcji(wybrana) || {}).id || '?'} spoza STRIPE_CENA_* (pakiet nieznany)`);
  }
  let okresDo = koniecOkresu(wybrana);
  if (wybrana.cancel_at && stan === 'anulowana') okresDo = Math.min(okresDo || Infinity, Number(wybrana.cancel_at) * 1000);
  const surowy = [wybrana.status, wybrana.cancel_at_period_end ? 'cancel_at_period_end' : null, wybrana.cancel_at ? 'cancel_at' : null]
    .filter(Boolean).join(',');
  return {
    stan, plan, idSubskrypcji: wybrana.id, okresDo, waluta: wybrana.currency ? String(wybrana.currency).toLowerCase() : null,
    surowy, od: wybrana.start_date ? Number(wybrana.start_date) * 1000 : null, kraj: null,
  };
}

/** Anuluje od razu wszystkie niezakonczone subskrypcje klienta (usuniecie konta). */
async function anulujWszystko({ idKlienta, konf }) {
  const odp = await zapytanie(konf, 'GET', '/subscriptions', { customer: idKlienta, status: 'all', limit: 100 });
  const zywe = ((odp && odp.data) || []).filter((x) => !['canceled', 'incomplete_expired'].includes(x.status));
  const anulowane = [];
  for (const sub of zywe) {
    const w = await anulujSubskrypcje({ idSubskrypcji: sub.id, konf });
    if (w.anulowano) anulowane.push(sub.id);
  }
  return { anulowano: anulowane.length, subskrypcje: anulowane };
}

/** Natychmiastowe anulowanie (bez proporcjonalnych rozliczen po stronie Stripe). Juz anulowana = ok. */
async function anulujSubskrypcje({ idSubskrypcji, konf }) {
  try {
    await zapytanie(konf, 'DELETE', `/subscriptions/${encodeURIComponent(idSubskrypcji)}`);
    return { anulowano: true };
  } catch (e) {
    if (!(e instanceof BladDostawcy) || e.przejsciowy) throw e;
    // 4xx: sprawdzamy stan (np. anulowana w miedzyczasie przez webhook albo panel)
    const sub = await zapytanie(konf, 'GET', `/subscriptions/${encodeURIComponent(idSubskrypcji)}`);
    if (['canceled', 'incomplete_expired'].includes(sub.status)) return { anulowano: false, juzAnulowana: true };
    throw e;
  }
}

// ─── Ceny (ARCH8-17) ─────────────────────────────────────────────────────────

/** Kwoty pakietow na sprzedaz ze Stripe i problemy cen (nieaktywna, nie miesieczna, zly tryb, brak waluty). */
async function ceny({ konf, plany }) {
  const waluty = konf.platnosci.waluty || [];
  const kwoty = {};
  const bledy = [];
  const pobrane = new Map();
  for (const [plan, p] of Object.entries(plany.PLANY)) {
    if (!p.sprzedaz) continue;
    kwoty[plan] = {};
    for (const waluta of waluty) {
      const id = idCeny(konf, plan, waluta);
      if (!id) { bledy.push(`${plan}/${waluta}: brak ceny w STRIPE_CENA_${plan.toUpperCase()}`); continue; }
      if (!pobrane.has(id)) pobrane.set(id, await zapytanie(konf, 'GET', `/prices/${encodeURIComponent(id)}`, { expand: ['currency_options'] }));
      const c = pobrane.get(id);
      const zle = [];
      if (!c.active) zle.push('nieaktywna');
      if (!c.recurring || c.recurring.interval !== 'month' || Number(c.recurring.interval_count || 1) !== 1) zle.push('nie jest miesieczna');
      if (Boolean(c.livemode) !== (tryb(konf) === 'live')) zle.push(`z trybu ${c.livemode ? 'live' : 'test'}`);
      let kwota = null;
      if (String(c.currency).toLowerCase() === waluta) kwota = c.unit_amount;
      else if (c.currency_options && c.currency_options[waluta]) kwota = c.currency_options[waluta].unit_amount;
      if (kwota === null || kwota === undefined) zle.push(`bez kwoty w ${waluta}`);
      if (zle.length) bledy.push(`${plan}/${waluta}: cena ${id} ${zle.join(', ')}`);
      else kwoty[plan][waluta] = Number(kwota);
    }
  }
  return { kwoty, bledy };
}

// ─── Wplaty i zwroty ─────────────────────────────────────────────────────────

function wplataZFaktury(f, konf, plany, idPlatnosci) {
  const linia = ((f.lines && f.lines.data) || []).find((l) => l && l.period) || ((f.lines && f.lines.data) || [])[0] || {};
  const idSub = (f.parent && f.parent.subscription_details && f.parent.subscription_details.subscription)
    || (typeof f.subscription === 'string' ? f.subscription : null)
    || (linia.parent && linia.parent.subscription_item_details && linia.parent.subscription_item_details.subscription) || null;
  const cena = (linia.pricing && linia.pricing.price_details && linia.pricing.price_details.price) || (linia.price && linia.price.id) || null;
  const okres = linia.period || {};
  const zaplacono = f.status_transitions && f.status_transitions.paid_at;
  return {
    id: f.id,
    idKlienta: typeof f.customer === 'string' ? f.customer : (f.customer && f.customer.id) || null,
    idSubskrypcji: idSub,
    kwota: Number(f.amount_paid) || 0,
    waluta: String(f.currency || '').toLowerCase(),
    kraj: f.customer_address && f.customer_address.country ? String(f.customer_address.country).toUpperCase() : null,
    oplacono: zaplacono ? zaplacono * 1000 : (Number(f.created) || 0) * 1000,
    okresOd: okres.start ? okres.start * 1000 : null,
    okresDo: okres.end ? okres.end * 1000 : null,
    status: f.status,
    plan: planZCeny(konf, plany, cena),
    idCeny: cena,
    idPlatnosci: idPlatnosci || (typeof f.payment_intent === 'string' ? f.payment_intent : null) || (typeof f.charge === 'string' ? f.charge : null),
    powod: f.billing_reason || null,
    tryb: f.livemode ? 'live' : 'test',
  };
}

/** Platnosc faktury (basil: /v1/invoice_payments; starsze wersje: pola faktury). */
async function platnoscFaktury(konf, idFaktury) {
  try {
    const odp = await zapytanie(konf, 'GET', '/invoice_payments', { invoice: idFaktury, limit: 10 });
    const oplacona = ((odp && odp.data) || []).find((x) => x.status === 'paid') || null;
    if (!oplacona || !oplacona.payment) return null;
    return oplacona.payment.payment_intent || oplacona.payment.charge || null;
  } catch (e) {
    if (e instanceof BladDostawcy && e.statusDostawcy === 404) return null;
    throw e;
  }
}

async function faktura({ idFaktury, konf, plany }) {
  const f = await zapytanie(konf, 'GET', `/invoices/${encodeURIComponent(idFaktury)}`);
  const idPlatnosci = f.status === 'paid' && Number(f.amount_paid) > 0 ? await platnoscFaktury(konf, f.id) : null;
  return wplataZFaktury(f, konf, plany, idPlatnosci);
}

/** Oplacone faktury klienta (ostatnie 10): uzgadnianie rejestru wplat po zgubionym webhooku. */
async function faktury({ idKlienta, konf, plany, limit = 10 }) {
  const odp = await zapytanie(konf, 'GET', '/invoices', { customer: idKlienta, status: 'paid', limit });
  const wynik = [];
  for (const f of (odp && odp.data) || []) {
    const idPlatnosci = Number(f.amount_paid) > 0 ? await platnoscFaktury(konf, f.id) : null;
    wynik.push(wplataZFaktury(f, konf, plany, idPlatnosci));
  }
  return wynik;
}

/** Zwrot (calosc albo czesc) platnosci: pi_... albo ch_.... */
async function zwroc({ idPlatnosci, kwota, idempotencja, metadane = {}, konf }) {
  const parametry = { amount: Math.round(Number(kwota)), reason: 'requested_by_customer', metadata: metadane };
  if (String(idPlatnosci).startsWith('ch_')) parametry.charge = idPlatnosci;
  else parametry.payment_intent = idPlatnosci;
  const r = await zapytanie(konf, 'POST', '/refunds', parametry, { idempotencja });
  return { id: r.id, kwota: Number(r.amount) || 0, waluta: String(r.currency || '').toLowerCase(), status: r.status, czas: (Number(r.created) || 0) * 1000 };
}

/** Zwroty obciazenia (charge.refunded, takze zwroty zrobione w panelu Stripe). */
async function zwrotyObciazenia({ idObciazenia, konf }) {
  const ch = await zapytanie(konf, 'GET', `/charges/${encodeURIComponent(idObciazenia)}`);
  const lista = await zapytanie(konf, 'GET', '/refunds', { charge: idObciazenia, limit: 100 });
  return {
    idPlatnosci: (typeof ch.payment_intent === 'string' ? ch.payment_intent : null) || ch.id,
    idObciazenia: ch.id,
    zwroconoLacznie: Number(ch.amount_refunded) || 0,
    waluta: String(ch.currency || '').toLowerCase(),
    zwroty: ((lista && lista.data) || []).filter((r) => r.status !== 'failed' && r.status !== 'canceled')
      .map((r) => ({ id: r.id, kwota: Number(r.amount) || 0, waluta: String(r.currency || '').toLowerCase(), czas: (Number(r.created) || 0) * 1000, powod: (r.metadata && r.metadata.powod) || null })),
  };
}

function hostyPrzekierowan(konf) {
  const h = s(konf).hostyPrzekierowan;
  return Array.isArray(h) && h.length ? h.slice() : ['https://checkout.stripe.com', 'https://billing.stripe.com'];
}

module.exports = {
  nazwa: 'stripe',
  WERSJA_API,
  TOLERANCJA_S,
  USTAWIENIA,
  BladPodpisu,
  BladDostawcy,
  sprawdzKonfiguracje,
  ostrzezeniaKonfiguracji,
  przygotujKlienta,
  rozpocznijZakup,
  otworzPanel,
  zweryfikujZdarzenie,
  rozpoznajZdarzenie,
  stanKlienta,
  potwierdzSesje,
  anulujWszystko,
  anulujSubskrypcje,
  ceny,
  faktura,
  faktury,
  zwroc,
  zwrotyObciazenia,
  hostyPrzekierowan,
  // pomocnicze (rdzen, CLI, testy)
  idCeny,
  parsujCene,
  planZCeny,
  zakoduj,
  podpis,
  zapytanie,
};
