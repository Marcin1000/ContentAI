'use strict';

// ─── Testy: platnosci (wykonawca B) ──────────────────────────────────────────
//
// PROJEKT-TECHNICZNY 11.2 (wiersz testy-platnosci.js): kontrola konfiguracji, parametry Checkout,
// 409 przy zywej subskrypcji, panel, powrot (cudza sesja 403), podpis webhooka, livemode innego trybu,
// duplikaty, kolejnosc odwrocona, blad API -> 503 i ponowne przetworzenie, stany ARCH8-16 z przesuwanym
// czasem, rejestr wplat i jeden e-mail na prog, uzgadnianie, usuniecie konta anuluje, bez PLATNOSCI
// trasy platnosci-wylaczone, form-action z hostami Stripe tylko na ekranach platnosci. Do tego: kraje
// spoza listy (D-04), odstapienie w 14 dni (PR8-31, D-03), wylacznik sprzedazy po progu (PR8-09),
// polecenia CLI, rezerwacja limitu (KOD8-20) i kontynuacja pause_turn (KOD8-13).
//
// Serwer aplikacji z testy-wspolne.js, atrapa Stripe (narzedzia/atrapa/stripe.js) w tym samym procesie.
// Webhooki atrapa wysyla na adres serwera testowego z podpisem jak Stripe.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { uruchomSerwer, HASLO } = require('./testy-wspolne.js');
const stripe = require('./platnosci-stripe.js');
const platnosci = require('./platnosci.js');
const ekrany = require('./ekrany-platnosci.js');
const plany = require('./plany.js');
const atrapa = require('../narzedzia/atrapa/stripe.js');

const DOBA = 24 * 3600_000;
const SEKRET = 'whsec_atrapa_test_123456';
const KLUCZ = 'rk_test_atrapa';

function nasluch(s) {
  return new Promise((ok) => (s.listening ? ok(s.address().port) : s.once('listening', () => ok(s.address().port))));
}
function czekaj(ms) { return new Promise((r) => { setTimeout(r, ms); }); }
/** Czeka, az warunek bedzie prawdziwy (webhooki z wywolan API atrapa wysyla po odpowiedzi). */
async function az(warunek, ms = 4000) {
  const koniec = Date.now() + ms;
  while (Date.now() < koniec) {
    if (await warunek()) return true;
    await czekaj(15);
  }
  return Boolean(await warunek());
}

// ─── Atrapa: sterowanie i API ────────────────────────────────────────────────

let URL_ATRAPY = '';

async function sterowanie(sciezka, dane = {}) {
  const odp = await fetch(URL_ATRAPY + sciezka, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dane) });
  return odp.json();
}
async function wywolaniaAtrapy(n = 200) { return (await fetch(`${URL_ATRAPY}/_atrapa/wywolania?n=${n}`)).json(); }
async function apiAtrapy(metoda, sciezka, parametry = null, klucz = KLUCZ) {
  const zakodowane = parametry ? stripe.zakoduj(parametry) : '';
  const get = metoda === 'GET' || metoda === 'DELETE';
  const odp = await fetch(`${URL_ATRAPY}/v1${sciezka}${get && zakodowane ? `?${zakodowane}` : ''}`, {
    method: metoda,
    headers: { authorization: `Bearer ${klucz}`, 'stripe-version': stripe.WERSJA_API, 'content-type': 'application/x-www-form-urlencoded' },
    body: get ? undefined : zakodowane,
  });
  return { status: odp.status, json: await odp.json() };
}
/** Formularz strony atrapy (Checkout albo panel) bez JS: POST i adres przekierowania. */
async function formularzAtrapy(adres, pola) {
  const odp = await fetch(adres, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pola).toString(),
  });
  return { status: odp.status, lokalizacja: odp.headers.get('location') };
}
const subskrypcjeAtrapy = () => [...atrapa.stan().subskrypcje.values()];
const zwrotyAtrapy = () => [...atrapa.stan().zwroty.values()];

// ─── Serwer z platnosciami ───────────────────────────────────────────────────

function srodowiskoPlatnosci(dodatkowe = {}) {
  return {
    PLATNOSCI: 'stripe', PLATNOSCI_TRYB: 'test', STRIPE_KLUCZ: KLUCZ, STRIPE_SEKRET_WEBHOOKA: SEKRET,
    STRIPE_CENA_STANDARD: 'price_atrapa_standard', STRIPE_CENA_PREMIUM: 'price_atrapa_premium',
    STRIPE_URL_API: URL_ATRAPY, STRIPE_HOSTY_PRZEKIEROWAN: URL_ATRAPY, CAI_ADRES_PUBLICZNY: 'http://127.0.0.1',
    CAI_USLUGODAWCA_IMIE_NAZWISKO: 'Jan Testowy', CAI_USLUGODAWCA_ADRES: 'ul. Testowa 1, 00-001 Warszawa',
    CAI_USLUGODAWCA_EMAIL: 'kontakt@example.com', PLATNOSCI_CENY_WYSWIETLANE: 'standard:eur=19,pln=79;premium:eur=49,pln=199',
    ...dodatkowe,
  };
}

async function serwerZPlatnosciami(dodatkowe = {}, opcje = {}) {
  const t = await uruchomSerwer({ srodowisko: srodowiskoPlatnosci(dodatkowe), ...opcje });
  // adres serwera znany dopiero po starcie: adresy powrotu i webhook atrapy
  t.KONF.adresPubliczny = t.adres;
  atrapa.KONF.webhook = `${t.adres}/platnosci/webhook/stripe`;
  return t;
}

let LICZNIK_KONT = 0;
async function nowyKlient(t, { jezyk = 'pl' } = {}) {
  LICZNIK_KONT += 1;
  const k = t.magazyn.utworzOrganizacjeIKonto({ email: `klient${LICZNIK_KONT}@example.com`, jezyk, ...t.srv.zahaszuj(HASLO) });
  return { login: k.login, email: k.email, cookie: await t.zaloguj(k.login) };
}

/** Zakup ekranem serwera: POST /konto/zakup -> Checkout atrapy (akcja, kraj) -> powrot z ciasteczkiem. */
async function kup(t, cookie, { plan = 'standard', waluta = 'pln', kraj = 'PL', akcja = 'zaplac', z = 'app', jezyk = 'pl' } = {}) {
  const o = await t.zadanie('/konto/zakup', t.formularz(cookie, { plan, waluta, z, jezyk, zgoda_regulamin: '1', zgoda_wykonanie: '1' }));
  if (o.status !== 303) return { status: o.status, tekst: await o.text(), kod: o.headers.get('x-cai-kod') };
  const checkout = o.headers.get('location');
  const p = await formularzAtrapy(checkout, { akcja, kraj });
  if (p.status !== 303 || !p.lokalizacja) return { status: p.status, checkout };
  const r = await t.zadanie(p.lokalizacja.replace(t.adres, ''), { headers: { cookie } });
  return { status: r.status, lokalizacja: r.headers.get('location'), checkout, powrot: p.lokalizacja, sesja: new URL(p.lokalizacja).searchParams.get('sesja') };
}

function konto(t, login) { return t.magazyn.konto(login); }

/** Webhook wyslany wprost (podpis jak Stripe; opcje zmieniaja sekret, czas, cialo albo naglowek). */
async function webhook(t, zd, { sekret = SEKRET, czas = Math.floor(Date.now() / 1000), zmien = null, naglowek = null, sciezka = '/platnosci/webhook/stripe' } = {}) {
  const cialo = Buffer.from(JSON.stringify(zd));
  const podpis = `t=${czas},v1=${stripe.podpis(cialo, sekret, czas)}`;
  const odp = await t.zadanie(sciezka, {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': naglowek || podpis }, body: zmien ? Buffer.from(zmien(cialo.toString())) : cialo,
  });
  let json = null;
  try { json = await odp.json(); } catch { json = null; }
  return { status: odp.status, json, kod: odp.headers.get('x-cai-kod') };
}
function zdarzenieTestowe(typ, obiekt, inne = {}) {
  return { id: `evt_test_${Math.random().toString(36).slice(2, 12)}`, object: 'event', type: typ, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: obiekt }, ...inne };
}

/** Polecenie CLI w osobnym procesie (asynchronicznie: atrapa Stripe dziala w tym procesie). */
function cli(...argumenty) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'uzytkownicy.js'), ...argumenty], { env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

const DLUGIE_MYSLNIKI = new RegExp('[\\u2013\\u2014]');
const bezMyslnikow = (s) => !DLUGIE_MYSLNIKI.test(s);

// ─── 1. Bez sieci: adapter, podpis, czas polski, zwroty, ekrany ──────────────

function testyJednostkowe(sprawdz) {
  console.log('\n  platnosci (B) - adapter Stripe, podpis webhooka, czas polski, zwroty');
  sprawdz('adapter: notacja nawiasowa Stripe (obiekty, tablice, wartosci logiczne)',
    stripe.zakoduj({ a: { b: [{ c: 1 }] }, d: true, e: null }) === 'a%5Bb%5D%5B0%5D%5Bc%5D=1&d=true');
  sprawdz('adapter: STRIPE_CENA_<PLAN> jako cena wielowalutowa albo "eur:price_a,pln:price_b"',
    stripe.parsujCene('price_abc').ceny['*'] === 'price_abc' && stripe.parsujCene('eur:price_a,pln:price_b').ceny.pln === 'price_b'
    && !stripe.parsujCene('cena').ok && !stripe.parsujCene('').ok);
  sprawdz('adapter: wersja API przypieta do 2025-03-31.basil', stripe.WERSJA_API === '2025-03-31.basil');

  const konf = { platnosci: { stripe: { sekretWebhooka: [SEKRET] } } };
  const zd = { id: 'evt_1', type: 'invoice.paid', livemode: false, created: 1, data: { object: { id: 'in_1', customer: 'cus_1' } } };
  const cialo = Buffer.from(JSON.stringify(zd));
  const teraz = Date.now();
  const t = Math.floor(teraz / 1000);
  const v1 = (sekret, tt = t, c = cialo) => stripe.podpis(c, sekret, tt);
  const weryfikuj = (naglowek, c = cialo, k = konf) => {
    try { return stripe.zweryfikujZdarzenie(c, { 'stripe-signature': naglowek }, k, teraz); } catch (e) { return e; }
  };
  sprawdz('podpis: dobry sekret i swiezy czas -> zdarzenie', weryfikuj(`t=${t},v1=${v1(SEKRET)}`).id === 'evt_1');
  sprawdz('podpis: zly sekret -> BladPodpisu', weryfikuj(`t=${t},v1=${v1('whsec_inny_sekret')}`) instanceof stripe.BladPodpisu);
  const zmienione = Buffer.from(cialo.toString().replace('in_1', 'in_2'));
  sprawdz('podpis: zmienione cialo (podpis liczony na surowych bajtach) -> BladPodpisu', weryfikuj(`t=${t},v1=${v1(SEKRET)}`, zmienione) instanceof stripe.BladPodpisu);
  sprawdz('podpis: czas sprzed 301 s (tolerancja 300 s) -> BladPodpisu', weryfikuj(`t=${t - 301},v1=${v1(SEKRET, t - 301)}`) instanceof stripe.BladPodpisu
    && weryfikuj(`t=${t - 299},v1=${v1(SEKRET, t - 299)}`).id === 'evt_1');
  sprawdz('podpis: dwa v1 w naglowku (zly i dobry) -> zdarzenie', weryfikuj(`t=${t},v1=${'0'.repeat(64)},v1=${v1(SEKRET)}`).id === 'evt_1');
  const dwaSekrety = { platnosci: { stripe: { sekretWebhooka: ['whsec_stary_sekret', SEKRET] } } };
  sprawdz('podpis: dwa sekrety (zmiana sekretu w panelu) -> oba dzialaja',
    weryfikuj(`t=${t},v1=${v1('whsec_stary_sekret')}`, cialo, dwaSekrety).id === 'evt_1' && weryfikuj(`t=${t},v1=${v1(SEKRET)}`, cialo, dwaSekrety).id === 'evt_1');
  const naTekscie = (() => {
    try { stripe.zweryfikujZdarzenie(cialo.toString(), { 'stripe-signature': `t=${t},v1=${v1(SEKRET)}` }, konf, teraz); return false; } catch (e) { return e instanceof stripe.BladPodpisu; }
  })();
  sprawdz('podpis: brak naglowka, brak v1, cialo nie jako Buffer -> BladPodpisu',
    weryfikuj('') instanceof stripe.BladPodpisu && weryfikuj(`t=${t}`) instanceof stripe.BladPodpisu && naTekscie);
  const r = stripe.rozpoznajZdarzenie({ id: 'evt_2', type: 'checkout.session.completed', livemode: true, created: 5, data: { object: { id: 'cs_1', customer: 'cus_9', client_reference_id: 'k-abc' } } });
  sprawdz('zdarzenie: livemode -> tryb live, login z client_reference_id, nieobslugiwany typ -> null',
    r.tryb === 'live' && r.login === 'k-abc' && r.idSesji === 'cs_1' && r.idKlienta === 'cus_9' && r.utworzone === 5000
    && stripe.rozpoznajZdarzenie({ id: 'evt_3', type: 'customer.created', data: { object: {} } }) === null);

  // Czas polski: kwartaly i termin odstapienia (14 dni od dnia po zawarciu, do konca dnia, art. 111 KC)
  sprawdz('czas: kwartal liczony w Warszawie (1 pazdziernika 00:30 CEST to juz Q4)',
    platnosci.kwartal(Date.UTC(2026, 8, 30, 22, 30)).nazwa === '2026-Q4' && platnosci.kwartal(Date.UTC(2026, 8, 30, 21, 30)).nazwa === '2026-Q3'
    && platnosci.kwartal(Date.UTC(2026, 9, 5)).od === Date.UTC(2026, 8, 30, 22) && platnosci.kwartal(Date.UTC(2026, 9, 5)).do === Date.UTC(2026, 11, 31, 23));
  sprawdz('czas: termin odstapienia = polnoc po 14. dniu od zawarcia, takze przez zmiane czasu (25.10.2026)',
    platnosci.terminOdstapienia(Date.UTC(2026, 9, 10, 21, 30)) === Date.UTC(2026, 9, 24, 22)
    && platnosci.terminOdstapienia(Date.UTC(2026, 9, 10, 22, 30)) === Date.UTC(2026, 9, 25, 23));
  sprawdz('czas: okres z nazwy RRRR-Qn i RRRR, zla nazwa -> null',
    platnosci.okresZNazwy('2026-Q1').od === Date.UTC(2025, 11, 31, 23) && platnosci.okresZNazwy('2026').do === Date.UTC(2026, 11, 31, 23)
    && platnosci.okresZNazwy('2026-Q5') === null);

  const od = Date.UTC(2026, 9, 1);
  const w = [{ id: 'in_1', kwota: 7900, zwrot: 0, okresOd: od, okresDo: od + 31 * DOBA, oplacono: od }];
  const prop = (chwila) => platnosci.wyliczZwrot(w, chwila, 'proporcjonalny')[0];
  sprawdz('zwrot proporcjonalny (D-03): rozpoczete doby dostepu zaplacone, reszta wraca',
    prop(od).kwota === 7900 && prop(od + 1000).kwota === 7900 - Math.round(7900 / 31) && prop(od + 1000).dniUzyte === 1
    && prop(od + 3 * DOBA + 1).kwota === 7900 - Math.round((7900 * 4) / 31) && prop(od + 40 * DOBA).kwota === 0);
  sprawdz('zwrot pelny: cala wplata; juz zwrocone odjete; wplata zerowa (okres probny) pominieta',
    platnosci.wyliczZwrot(w, od + 5 * DOBA, 'pelny')[0].kwota === 7900
    && platnosci.wyliczZwrot([{ ...w[0], zwrot: 1000 }], od + 1000, 'proporcjonalny')[0].kwota === 6645
    && platnosci.wyliczZwrot([{ ...w[0], kwota: 0 }], od, 'pelny').length === 0);
  const cw = platnosci.parsujCenyWyswietlane('standard:eur=19,pln=79;premium:eur=49.5,pln=199');
  sprawdz('PLATNOSCI_CENY_WYSWIETLANE: kwoty w groszach i centach, nieznany pakiet -> blad',
    cw.kwoty.standard.pln === 7900 && cw.kwoty.premium.eur === 4950 && Boolean(platnosci.parsujCenyWyswietlane('zloty:eur=1').blad));

  const csp = "default-src 'self'; form-action 'self'; frame-ancestors 'none'";
  sprawdz('CSP ekranow platnosci: hosty dostawcy w form-action, obce schematy odrzucone',
    ekrany.cspPlatnosci(csp, ['https://checkout.stripe.com', 'javascript:alert(1)', 'http://zly.example']).includes("form-action 'self' https://checkout.stripe.com;")
    && !ekrany.cspPlatnosci(csp, ['http://zly.example']).includes('zly.example'));
  sprawdz('teksty: odmiana polska (3 artykuly, 50 artykulow, 12 i 22) i kwoty w jezyku ekranu',
    ekrany.cechyPakietu({ limity: { artykul: 3 } }, 'pl')[0] === '3 artykuły miesięcznie' && ekrany.cechyPakietu({ limity: { artykul: 50 } }, 'pl')[0] === '50 artykułów miesięcznie'
    && ekrany.odmiana(12, ['a', 'b', 'c']) === 'c' && ekrany.odmiana(22, ['a', 'b', 'c']) === 'b' && /79,00\s*zł/.test(ekrany.kwotaTekst(7900, 'pln', 'pl'))
    && ekrany.kwotaTekst(1900, 'eur', 'en') === '€19.00');

  // Stany ARCH8-16 a pakiet (plany.js): tryb platnika, laska przy zaleglej platnosci
  const konfPl = { trybPlatnosci: 'test', zaleglaDni: 7, planNowych: 'darmowy' };
  const baza = { login: 'k-x', pochodzenie: 'samoobsluga', organizacja: 'o-x', platnik: 'stripe', platnikTryb: 'test', subskrypcjaPlan: 'standard' };
  const teraz2 = Date.now();
  const pe = (zmiany, chwila = teraz2, k = konfPl) => plany.planEfektywny({ ...baza, ...zmiany }, chwila, k);
  sprawdz('ARCH8-16: probna i aktywna daja pakiet, anulowana do okresDo, wygasla i brak nie',
    pe({ subskrypcjaStan: 'probna' }) === 'standard' && pe({ subskrypcjaStan: 'aktywna' }) === 'standard'
    && pe({ subskrypcjaStan: 'anulowana', okresDo: teraz2 + 1000 }) === 'standard' && pe({ subskrypcjaStan: 'anulowana', okresDo: teraz2 - 1 }) === 'darmowy'
    && pe({ subskrypcjaStan: 'wygasla' }) === 'darmowy' && pe({ subskrypcjaStan: 'brak' }) === 'darmowy');
  sprawdz('ARCH8-16: zalegla przez PLATNOSCI_ZALEGLA_DNI od zalegla_od, potem darmowy',
    pe({ subskrypcjaStan: 'zalegla', zaleglaOd: teraz2 }) === 'standard' && pe({ subskrypcjaStan: 'zalegla', zaleglaOd: teraz2 }, teraz2 + 7 * DOBA) === 'darmowy'
    && plany.dostepDo({ ...baza, subskrypcjaStan: 'zalegla', zaleglaOd: teraz2 }, teraz2, konfPl) === teraz2 + 7 * DOBA);
  sprawdz('ARCH8-16: powiazanie z innego trybu (test na serwerze live) nie daje dostepu',
    pe({ subskrypcjaStan: 'aktywna' }, teraz2, { ...konfPl, trybPlatnosci: 'live' }) === 'darmowy'
    && pe({ subskrypcjaStan: 'aktywna', platnikTryb: 'live' }) === 'darmowy');

  // Ekran zakupu i sekcja konta (bez serwera)
  const html = ekrany.ekranZakupu({
    jezyk: 'pl', plan: 'standard', pakiet: plany.PLANY.standard, waluta: 'pln', waluty: ['eur', 'pln'], kwota: 7900, inne: [{ plan: 'premium', nazwa: 'Premium' }],
    uslugodawca: { imieNazwisko: 'Jan Testowy', adres: 'ul. Testowa 1', email: 'kontakt@example.com' }, tryb: 'test', z: 'app', adresy: {},
  });
  sprawdz('ekran zakupu: dwa osobne pola zgody, podsumowanie, kraje UE, dane uslugodawcy, pasek trybu testowego, bez <script>, myslnikow i "faktury"',
    /id="zgoda-regulamin"/.test(html) && /id="zgoda-wykonanie"/.test(html) && /Żądam rozpoczęcia świadczenia/.test(html)
    && /odnawia się automatycznie co miesiąc/.test(html) && /Unii Europejskiej/.test(html) && /Jan Testowy/.test(html)
    && /Tryb testowy płatności/.test(html) && /href="\/dokumenty\/regulamin"/.test(html) && !/<script/i.test(html) && bezMyslnikow(html)
    && !/[Ff]aktur/.test(html));
  const sekcja = ekrany.sekcjaKonta({
    jezyk: 'pl',
    pakiety: plany.PLANY,
    stan: {
      subskrypcja: { stan: 'aktywna', plan: 'standard', okresDo: teraz2 + 20 * DOBA },
      platnosci: { wlaczone: true, tryb: 'live', maPanel: true, odstapienie: { mozliwe: true, do: teraz2 + 10 * DOBA }, rachunek: { email: 'kontakt@example.com' } },
    },
  });
  sprawdz('sekcja konta (A1): stan pakietu, formularz panelu, "Odstąp od umowy tutaj", rachunek na prosbe',
    /Pakiet Standard, aktywny/.test(sekcja) && /action="\/konto\/panel"/.test(sekcja) && /id="odstap"/.test(sekcja) && /Odstąp od umowy tutaj/.test(sekcja)
    && /Rachunek wystawiamy na prośbę/.test(sekcja) && ekrany.sekcjaKonta({ stan: { platnosci: { wlaczone: false } } }) === '');
}

// ─── 2. Atrapa: ksztalt modulu (przeniesione z testy-magazyn.js) ─────────────

async function testyAtrapy(sprawdz) {
  console.log('\n  platnosci (B) - atrapa Stripe');
  const zdrowie = await fetch(`${URL_ATRAPY}/zdrowie`);
  const czysta = atrapa.obsluz('GET', '/zdrowie', {}, Buffer.alloc(0));
  const bezKlucza = await fetch(`${URL_ATRAPY}/v1/customers`, { method: 'POST', body: 'a=1' });
  const bezWersji = await fetch(`${URL_ATRAPY}/v1/customers`, { method: 'POST', headers: { authorization: `Bearer ${KLUCZ}` }, body: 'a=1' });
  sprawdz('atrapa stripe: obsluz i uruchom, /zdrowie 200, API: 401 bez klucza, 400 bez Stripe-Version',
    zdrowie.status === 200 && (await zdrowie.json()).atrapa === 'stripe' && czysta.status === 200 && typeof czysta.cialo === 'string'
    && bezKlucza.status === 401 && bezWersji.status === 400);
  const naglowki = { authorization: `Bearer ${KLUCZ}`, 'stripe-version': stripe.WERSJA_API, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': 'klucz-testu-1' };
  const raz = await fetch(`${URL_ATRAPY}/v1/customers`, { method: 'POST', headers: naglowki, body: 'email=a%40example.com' });
  const znow = await fetch(`${URL_ATRAPY}/v1/customers`, { method: 'POST', headers: naglowki, body: 'email=a%40example.com' });
  const inne = await fetch(`${URL_ATRAPY}/v1/customers`, { method: 'POST', headers: naglowki, body: 'email=b%40example.com' });
  const jr = await raz.json();
  sprawdz('atrapa stripe: ten sam Idempotency-Key oddaje ten sam obiekt, z innymi parametrami 400 idempotency_error',
    raz.status === 200 && (await znow.json()).id === jr.id && znow.headers.get('idempotent-replayed') === 'true'
    && inne.status === 400 && (await inne.json()).error.type === 'idempotency_error');
  const cena = await apiAtrapy('GET', '/prices/price_atrapa_standard');
  const cenaOpcje = await apiAtrapy('GET', '/prices/price_atrapa_standard', { expand: ['currency_options'] });
  const zegar = await apiAtrapy('POST', '/test_helpers/test_clocks', { frozen_time: Math.floor(Date.now() / 1000) });
  const zegarPelny = await apiAtrapy('POST', '/test_helpers/test_clocks', { frozen_time: Math.floor(Date.now() / 1000) }, 'sk_test_atrapa_zegary');
  sprawdz('atrapa stripe: currency_options tylko z expand, zegary testowe tylko kluczem sk_test_ (rk_ -> 403)',
    cena.json.currency_options === undefined && cenaOpcje.json.currency_options.pln.unit_amount === 7900 && zegar.status === 403 && zegarPelny.status === 200);
  const wywolania = await wywolaniaAtrapy();
  sprawdz('atrapa stripe: dziennik wywolan z wersja API i kluczem idempotencji',
    wywolania.some((x) => x.sciezka === '/v1/customers' && x.idempotencja === 'klucz-testu-1' && x.wersjaApi === stripe.WERSJA_API));
}

// ─── 3. Bez PLATNOSCI: wszystko jak dzis ─────────────────────────────────────

async function testyWylaczone(sprawdz) {
  console.log('\n  platnosci (B) - bez PLATNOSCI: trasy platnosci-wylaczone, reszta jak dzis');
  const t = await uruchomSerwer({ srodowisko: { PLATNOSCI: undefined } });
  try {
    const k = await nowyKlient(t);
    const kody = [];
    for (const sciezka of ['/konto/zakup?plan=standard', '/konto/platnosc?wynik=ok&sesja=cs_test_abcdefgh', '/konto/odstapienie', '/api/platnosci/stan', '/api/platnosci/odstapienie']) {
      const o = await t.zadanie(sciezka, { headers: { cookie: k.cookie } });
      kody.push([sciezka, o.status, o.headers.get('x-cai-kod')]);
    }
    for (const [sciezka, cialo] of [['/api/platnosci/zakup', { plan: 'standard', zgodaNaWykonanie: true }], ['/api/platnosci/panel', {}], ['/api/platnosci/odstapienie', { potwierdzam: true }]]) {
      const o = await t.zadanie(sciezka, t.json(k.cookie, cialo));
      kody.push([sciezka, o.status, o.headers.get('x-cai-kod')]);
    }
    const panel = await t.zadanie('/konto/panel', t.formularz(k.cookie, { z: 'konto' }));
    kody.push(['/konto/panel', panel.status, panel.headers.get('x-cai-kod')]);
    const zle = kody.filter((x) => x[1] !== 404 || x[2] !== 'platnosci-wylaczone').map((x) => x[0]);
    sprawdz(`bez PLATNOSCI: wszystkie trasy platnosci -> 404 platnosci-wylaczone${zle.length ? ` (zle: ${zle.join(', ')})` : ''}`, zle.length === 0);
    const wh = await webhook(t, zdarzenieTestowe('invoice.paid', { id: 'in_x', customer: 'cus_x' }));
    sprawdz('bez PLATNOSCI: webhook idzie dalej jak dzis (bez sesji ekran logowania), nic nie zapisane',
      wh.status === 200 && wh.json === null && t.magazyn.zdarzeniaNieprzetworzone().length === 0);
    const st = platnosci.stanDlaKonta(konto(t, k.login), { KONF: t.KONF, funkcjaWlaczona: t.srv.funkcjaWlaczona });
    const pakiet = await (await t.zadanie('/api/pakiet', { headers: { cookie: await t.zaloguj('standard') } })).json();
    sprawdz('bez PLATNOSCI: stanDlaKonta bez zakupu i panelu, konta glownej w swoich pakietach',
      st.platnosci.wlaczone === false && st.platnosci.mozeKupic === false && st.subskrypcja.stan === 'brak' && pakiet.plan === 'standard');
    const me = await t.zadanie('/auth/me', { headers: { cookie: k.cookie } });
    sprawdz('bez PLATNOSCI: CSP bez hostow dostawcy (form-action tylko self)', /form-action 'self';/.test(me.headers.get('content-security-policy')));
  } finally {
    await t.zamknij();
  }
}

// ─── 4. Kontrola konfiguracji (ARCH8-20) ─────────────────────────────────────

async function testyKonfiguracji(sprawdz) {
  console.log('\n  platnosci (B) - kontrola konfiguracji przy starcie');
  const zly = await uruchomSerwer({ srodowisko: srodowiskoPlatnosci({ PLATNOSCI_TRYB: 'live', STRIPE_SEKRET_WEBHOOKA: 'whsec_TAJNE_12345678' }) });
  try {
    const f = zly.KONF.funkcje.platnosci;
    sprawdz('konfiguracja: klucz trybu test przy PLATNOSCI_TRYB=live -> platnosci wylaczone, komunikat z nazwa zmiennej bez wartosci',
      f.zadana && !f.wlaczona && f.bledy.some((b) => /STRIPE_KLUCZ: klucz trybu test, a PLATNOSCI_TRYB=live/.test(b)) && !/TAJNE|rk_test_atrapa/.test(JSON.stringify(f)));
    sprawdz('konfiguracja: przy wylaczonych platnosciach serwer dziala dla kont', /^cai_auth=/.test(await zly.zaloguj('standard')));
  } finally {
    await zly.zamknij();
  }
  const bezCeny = await uruchomSerwer({ srodowisko: srodowiskoPlatnosci({ STRIPE_CENA_STANDARD: 'eur:price_atrapa_standard_eur' }) });
  try {
    const f = bezCeny.KONF.funkcje.platnosci;
    const c = await bezCeny.zaloguj('premium');
    const stan = await bezCeny.zadanie('/api/platnosci/stan', { headers: { cookie: c } });
    const pakiet = await bezCeny.zadanie('/api/pakiet', { headers: { cookie: c } });
    sprawdz('konfiguracja: brak ceny dla waluty z PLATNOSCI_WALUTY -> platnosci wylaczone (404), reszta dziala',
      !f.wlaczona && f.bledy.some((b) => /STRIPE_CENA_STANDARD: brak ceny dla waluty pln/.test(b)) && stan.status === 404 && pakiet.status === 200);
  } finally {
    await bezCeny.zamknij();
  }
  // Pojedyncze reguly bez serwera
  const baza = {
    platnosci: {
      dostawca: 'stripe', tryb: 'test', waluty: ['eur', 'pln'], kraje: ['PL', 'DE'], metody: ['card'], kursEurPln: 4.25, cenyWyswietlane: '',
      stripe: { klucz: KLUCZ, sekretWebhooka: [SEKRET], ceny: { standard: 'price_a', premium: 'price_b' }, urlApi: 'https://api.stripe.com', hostyPrzekierowan: ['https://checkout.stripe.com'] },
    },
  };
  const z = (zmiana) => {
    const k = JSON.parse(JSON.stringify(baza));
    zmiana(k.platnosci);
    return platnosci.sprawdzKonfiguracje(k).join(' | ');
  };
  sprawdz('konfiguracja: poprawna -> brak bledow', z(() => {}) === '');
  sprawdz('konfiguracja: Przelewy24 odrzucone (PR8-13), nieznana metoda, zly kod kraju',
    /Przelewy24/.test(z((p) => { p.metody = ['card', 'p24']; })) && /PLATNOSCI_METODY/.test(z((p) => { p.metody = ['bitcoin']; }))
    && /PLATNOSCI_KRAJE/.test(z((p) => { p.kraje = ['Polska']; })));
  sprawdz('konfiguracja: klucz publiczny pk_, WSTAW_TUTAJ_, zly sekret webhooka, cena w zlym formacie',
    /pk_/.test(z((p) => { p.stripe.klucz = 'pk_test_abc'; })) && /WSTAW_TUTAJ/.test(z((p) => { p.stripe.klucz = 'WSTAW_TUTAJ_KLUCZ'; }))
    && /whsec_/.test(z((p) => { p.stripe.sekretWebhooka = ['sekret']; })) && /STRIPE_CENA_PREMIUM/.test(z((p) => { p.stripe.ceny.premium = 'cena'; })));
  sprawdz('konfiguracja: PLATNOSCI_CENY_WYSWIETLANE bez kwoty dla waluty, adres API bez https',
    /brak kwoty premium pln/.test(z((p) => { p.cenyWyswietlane = 'standard:eur=19,pln=79;premium:eur=49'; }))
    && /STRIPE_URL_API/.test(z((p) => { p.stripe.urlApi = 'http://api.example.com'; })));
}

// ─── 5. Zakup, panel, powrot, webhook, odstapienie (serwer z atrapa) ─────────

async function testyZakupu(sprawdz) {
  await sterowanie('/_atrapa/reset');
  const t = await serwerZPlatnosciami();
  const ponowienia = stripe.USTAWIENIA.ponowieniaMs.slice();
  stripe.USTAWIENIA.ponowieniaMs = [5, 10];
  const kontekst = { KONF: t.KONF, funkcjaWlaczona: t.srv.funkcjaWlaczona };
  try {
    sprawdz('serwer z atrapa: platnosci wlaczone po kontroli konfiguracji', t.KONF.funkcje.platnosci.wlaczona === true);

    console.log('\n  platnosci (B) - ekran zakupu, waluta (M-1), zgody (PR8-31), CSP');
    const a = await nowyKlient(t);
    const ekran = await t.zadanie('/konto/zakup?plan=standard', { headers: { cookie: a.cookie } });
    const htmlPl = await ekran.text();
    const csp = ekran.headers.get('content-security-policy');
    sprawdz('GET /konto/zakup (PL): 200, cena 79,00 zl, CSP form-action z hostem dostawcy, pola zgody, bez <script>',
      ekran.status === 200 && /79,00\s*zł/.test(htmlPl) && csp.includes(`form-action 'self' ${URL_ATRAPY}`) && /zgoda_wykonanie/.test(htmlPl)
      && !/<script/i.test(htmlPl) && bezMyslnikow(htmlPl) && ekran.headers.get('cache-control') === 'no-store');
    const en = await t.zadanie('/konto/zakup?plan=standard', { headers: { cookie: a.cookie, 'accept-language': 'en-GB,en;q=0.9' } });
    const htmlEn = await en.text();
    sprawdz('GET /konto/zakup (EN): EUR, przelacznik waluty na PLN, teksty angielskie',
      en.status === 200 && /€19\.00/.test(htmlEn) && /waluta=pln/.test(htmlEn) && /Continue to payment/.test(htmlEn) && /<html lang="en"/.test(htmlEn));
    const przelacznik = await (await t.zadanie('/konto/zakup?plan=premium&waluta=eur', { headers: { cookie: a.cookie } })).text();
    sprawdz('GET /konto/zakup?waluta=eur (PL): wybrana waluta wygrywa z jezykiem', /49,00\s*€/.test(przelacznik));
    const me = await t.zadanie('/auth/me', { headers: { cookie: a.cookie } });
    sprawdz('form-action z hostami dostawcy tylko na ekranach platnosci (/auth/me ma CSP bazowa)', /form-action 'self';/.test(me.headers.get('content-security-policy')));
    const sesjePrzed = atrapa.stan().sesje.size;
    const bezZgody = await t.zadanie('/konto/zakup', t.formularz(a.cookie, { plan: 'standard', waluta: 'pln', zgoda_regulamin: '1' }));
    sprawdz('POST /konto/zakup bez zgody na natychmiastowe wykonanie: 400, komunikat przy polach, bez sesji u dostawcy',
      bezZgody.status === 400 && /Zaznacz oba pola zgody/.test(await bezZgody.text()) && atrapa.stan().sesje.size === sesjePrzed);
    const apiBezZgody = await t.zadanie('/api/platnosci/zakup', t.json(a.cookie, { plan: 'standard' }));
    const zlyPlan = await t.zadanie('/api/platnosci/zakup', t.json(a.cookie, { plan: 'darmowy', zgodaNaWykonanie: true }));
    const zlaWaluta = await t.zadanie('/api/platnosci/zakup', t.json(a.cookie, { plan: 'standard', waluta: 'usd', zgodaNaWykonanie: true }));
    sprawdz('API zakupu: bez zgodaNaWykonanie 403 zgoda-wymagana, pakiet nie na sprzedaz i obca waluta 400 plan-niedostepny',
      apiBezZgody.status === 403 && apiBezZgody.headers.get('x-cai-kod') === 'zgoda-wymagana' && zlyPlan.status === 400
      && zlyPlan.headers.get('x-cai-kod') === 'plan-niedostepny' && zlaWaluta.status === 400);
    const cStandard = await t.zaloguj('standard');
    const cAdmin = await t.zaloguj('admin');
    const glowna = await t.zadanie('/api/platnosci/zakup', t.json(cStandard, { plan: 'premium', zgodaNaWykonanie: true }));
    const operator = await t.zadanie('/api/platnosci/zakup', t.json(cAdmin, { plan: 'premium', zgodaNaWykonanie: true }));
    const ekranGlownej = await t.zadanie('/konto/zakup', { headers: { cookie: cStandard } });
    sprawdz('konta zespolu (glowna) i operator: 403 zakup-niedozwolony bez PLATNOSCI_DLA_STARYCH (M-7)',
      glowna.status === 403 && glowna.headers.get('x-cai-kod') === 'zakup-niedozwolony' && operator.status === 403 && ekranGlownej.status === 403);

    console.log('\n  platnosci (B) - Checkout: parametry sesji, zakup, powrot bez czekania na webhook');
    const zakup = await t.zadanie('/api/platnosci/zakup', t.json(a.cookie, { plan: 'standard', zgodaNaWykonanie: true, zgodaRegulamin: true }));
    const zj = await zakup.json();
    const wywolania = await wywolaniaAtrapy();
    const sesjaW = wywolania.filter((x) => x.sciezka === '/v1/checkout/sessions' && x.metoda === 'POST').pop();
    const klientW = wywolania.filter((x) => x.sciezka === '/v1/customers' && x.metoda === 'POST').pop();
    const ps = sesjaW.parametry;
    sprawdz('API zakupu: 200 { url, plan, waluta pln z jezyka, kwota 7900 }', zakup.status === 200 && zj.url.startsWith(`${URL_ATRAPY}/c/pay/cs_test_`)
      && zj.plan === 'standard' && zj.waluta === 'pln' && zj.kwota === 7900);
    sprawdz('Checkout: subskrypcja, currency przy cenie wielowalutowej, client_reference_id, karta, adres wymagany, bez automatic_tax i tax_id_collection',
      ps.mode === 'subscription' && ps.currency === 'pln' && ps.client_reference_id === a.login && ps.line_items[0].price === 'price_atrapa_standard'
      && JSON.stringify(ps.payment_method_types) === '["card"]' && ps.billing_address_collection === 'required' && ps.automatic_tax === undefined
      && ps.tax_id_collection === undefined && ps.allow_promotion_codes === undefined && ps.locale === 'pl');
    sprawdz('Checkout: adresy powrotu z CAI_ADRES_PUBLICZNY, tekst przycisku z obowiazkiem zaplaty, metadane (login, zgoda, regulamin)',
      ps.success_url === `${t.adres}/konto/platnosc?wynik=ok&sesja={CHECKOUT_SESSION_ID}&z=app` && ps.cancel_url === `${t.adres}/konto/platnosc?wynik=anulowana&z=app`
      && /obowiązkiem zapłaty 79,00\s*zł co miesiąc/.test(ps.custom_text.submit.message) && ps.metadata.login === a.login && /^\d+$/.test(ps.metadata.zgoda)
      && ps.metadata.regulamin === '2026-10-v1' && ps.subscription_data.metadata.plan === 'standard');
    sprawdz('wersja API przypieta w kazdym zapytaniu, klucze idempotencji klienta i sesji',
      wywolania.filter((x) => x.sciezka.startsWith('/v1/')).every((x) => x.wersjaApi === stripe.WERSJA_API)
      && klientW.idempotencja === `klient-test-${a.login}` && klientW.parametry.metadata.login === a.login && /^zakup-/.test(sesjaW.idempotencja));
    const zgody = t.magazyn.zgody(a.login);
    sprawdz('zgody zapisane przed przekierowaniem: natychmiastowe-wykonanie i regulamin z wersja i zrodlem zakup (PR8-31)',
      zgody.some((x) => x.rodzaj === 'natychmiastowe-wykonanie' && x.wartosc && x.zrodlo === 'zakup' && x.wersja === '2026-10-v1')
      && zgody.some((x) => x.rodzaj === 'regulamin' && x.zrodlo === 'zakup'));
    const zaplata = await formularzAtrapy(zj.url, { akcja: 'zaplac', kraj: 'PL' });
    const powrot = await t.zadanie(zaplata.lokalizacja.replace(t.adres, ''), { headers: { cookie: a.cookie } });
    const ka = konto(t, a.login);
    sprawdz('powrot z Checkout: 303 /?platnosc=ok, konto aktywna standard pln, okres do za miesiac',
      zaplata.status === 303 && powrot.status === 303 && powrot.headers.get('location') === '/?platnosc=ok' && ka.subskrypcjaStan === 'aktywna'
      && ka.subskrypcjaPlan === 'standard' && ka.subskrypcjaWaluta === 'pln' && ka.okresDo > Date.now() + 27 * DOBA && ka.platnikTryb === 'test');
    const dostarczone = atrapa.stan().dostarczone;
    sprawdz('webhooki zakupu: subscription.created, invoice.paid, checkout.session.completed -> 200 (podpis zweryfikowany)',
      ['customer.subscription.created', 'invoice.paid', 'checkout.session.completed'].every((typ) => dostarczone.some((x) => x.typ === typ && x.status === 200)));
    const wplaty = t.magazyn.platnosciKonta(a.login);
    sprawdz('rejestr wplat (ARCH8-18): kwota, waluta, kraj, okres, identyfikator platnosci do zwrotu, subskrypcja i pakiet',
      wplaty.length === 1 && wplaty[0].kwota === 7900 && wplaty[0].waluta === 'pln' && wplaty[0].kraj === 'PL' && /^pi_/.test(wplaty[0].platnosc)
      && /^sub_/.test(wplaty[0].subskrypcja) && wplaty[0].plan === 'standard' && wplaty[0].okresDo > wplaty[0].okresOd);
    const pakietA = await (await t.zadanie('/api/pakiet', { headers: { cookie: a.cookie } })).json();
    sprawdz('planEfektywny: konto samoobslugowe z oplacona subskrypcja dziala w pakiecie Standard', pakietA.plan === 'standard' && pakietA.subskrypcja.stan === 'aktywna');
    const powrot2 = await t.zadanie(zaplata.lokalizacja.replace(t.adres, ''), { headers: { cookie: a.cookie } });
    sprawdz('ponowny powrot z ta sama sesja: ok, bez drugiej wplaty', powrot2.headers.get('location') === '/?platnosc=ok' && t.magazyn.platnosciKonta(a.login).length === 1);
    const drugi = await t.zadanie('/api/platnosci/zakup', t.json(a.cookie, { plan: 'premium', zgodaNaWykonanie: true }));
    const drugiEkran = await t.zadanie('/konto/zakup?plan=premium', { headers: { cookie: a.cookie } });
    sprawdz('zywa subskrypcja: API 409 subskrypcja-istnieje, ekran 409 z przyciskiem panelu',
      drugi.status === 409 && drugi.headers.get('x-cai-kod') === 'subskrypcja-istnieje' && drugiEkran.status === 409 && /id="panel-subskrypcji"/.test(await drugiEkran.text()));
    const stanA = await (await t.zadanie('/api/platnosci/stan', { headers: { cookie: a.cookie } })).json();
    sprawdz('GET /api/platnosci/stan: subskrypcja i platnosci (kontrakt A0 + pola B), odstapienie mozliwe z szacunkiem',
      stanA.subskrypcja.stan === 'aktywna' && stanA.subskrypcja.dostepDo === ka.okresDo && stanA.platnosci.wlaczone && stanA.platnosci.mozeKupic === false
      && stanA.platnosci.maPanel === true && stanA.platnosci.walutaWymuszona === 'pln' && stanA.platnosci.plany.length === 2
      && stanA.platnosci.plany[0].ceny.pln === 7900 && stanA.platnosci.odstapienie.mozliwe === true && stanA.platnosci.odstapienie.szacunek.kwota > 7000
      && stanA.platnosci.kraje.includes('PL') && stanA.platnosci.rachunek.email === 'kontakt@example.com');

    console.log('\n  platnosci (B) - panel klienta i zmiany w nim');
    const panelApi = await t.zadanie('/api/platnosci/panel', t.json(a.cookie, {}));
    const pj = await panelApi.json();
    const panelEkran = await t.zadanie('/konto/panel', t.formularz(a.cookie, { z: 'konto' }));
    const panelW = (await wywolaniaAtrapy()).filter((x) => x.sciezka === '/v1/billing_portal/sessions');
    sprawdz('panel: API { url } i formularz 303 do dostawcy z CSP, adres powrotu /?konto=1 albo /konto',
      panelApi.status === 200 && pj.url.startsWith(`${URL_ATRAPY}/p/session/`) && panelEkran.status === 303
      && panelEkran.headers.get('location').startsWith(`${URL_ATRAPY}/p/session/`) && panelEkran.headers.get('content-security-policy').includes(URL_ATRAPY)
      && panelW[panelW.length - 2].parametry.return_url === `${t.adres}/?konto=1` && panelW[panelW.length - 1].parametry.return_url === `${t.adres}/konto`);
    const b = await nowyKlient(t);
    const panelB = await t.zadanie('/konto/panel', t.formularz(b.cookie, { z: 'app' }));
    const panelBApi = await t.zadanie('/api/platnosci/panel', t.json(b.cookie, {}));
    sprawdz('panel bez klienta platnosci: formularz -> ekran zakupu, API 409 brak-subskrypcji',
      panelB.status === 303 && panelB.headers.get('location').startsWith('/konto/zakup') && panelBApi.status === 409 && panelBApi.headers.get('x-cai-kod') === 'brak-subskrypcji');
    const adresPanelu = pj.url;
    await formularzAtrapy(adresPanelu, { akcja: 'anuluj' });
    const anulowana = konto(t, a.login);
    sprawdz('panel: anulowanie na koniec okresu -> anulowana, pakiet dziala do okresDo',
      anulowana.subskrypcjaStan === 'anulowana' && anulowana.okresDo === ka.okresDo && plany.planEfektywny(anulowana) === 'standard');
    await formularzAtrapy(adresPanelu, { akcja: 'wznow' });
    sprawdz('panel: wznowienie -> aktywna', konto(t, a.login).subskrypcjaStan === 'aktywna');
    await formularzAtrapy(adresPanelu, { akcja: 'zmien' });
    sprawdz('panel: zmiana pakietu -> plan z ceny (premium)', konto(t, a.login).subskrypcjaPlan === 'premium' && plany.planEfektywny(konto(t, a.login)) === 'premium');

    console.log('\n  platnosci (B) - powrot: cudza sesja, rezygnacja');
    const c = await nowyKlient(t);
    const sesjaC = await (await t.zadanie('/api/platnosci/zakup', t.json(c.cookie, { plan: 'standard', waluta: 'eur', zgodaNaWykonanie: true }))).json();
    const idSesjiC = sesjaC.url.split('/').pop();
    const cudza = await t.zadanie(`/konto/platnosc?wynik=ok&sesja=${idSesjiC}&z=app`, { headers: { cookie: b.cookie } });
    const rezygnacja = await t.zadanie('/konto/platnosc?wynik=anulowana&z=konto', { headers: { cookie: c.cookie } });
    const zlaSesja = await t.zadanie('/konto/platnosc?wynik=ok&sesja=nie-sesja', { headers: { cookie: c.cookie } });
    const otwarta = await t.zadanie(`/konto/platnosc?wynik=ok&sesja=${idSesjiC}`, { headers: { cookie: c.cookie } });
    sprawdz('powrot: cudza sesja 403 zakup-niedozwolony; rezygnacja i zly identyfikator -> anulowana; niezaplacona sesja -> oczekuje',
      cudza.status === 403 && cudza.headers.get('x-cai-kod') === 'zakup-niedozwolony' && /innego konta/.test(await cudza.text())
      && rezygnacja.headers.get('location') === '/konto?platnosc=anulowana' && zlaSesja.headers.get('location') === '/?platnosc=anulowana'
      && otwarta.headers.get('location') === '/?platnosc=oczekuje' && konto(t, b.login).platnikKlient === null);

    console.log('\n  platnosci (B) - webhook: podpis, tryb, duplikaty, kolejnosc, bledy API');
    const kaa = konto(t, a.login);
    const obiekt = { id: kaa.platnikSubskrypcja, object: 'subscription', customer: kaa.platnikKlient };
    const zd = zdarzenieTestowe('customer.subscription.updated', obiekt);
    const pierwszy = await webhook(t, zd);
    const powtorka = await webhook(t, zd);
    sprawdz('webhook: dobry podpis 200 (stan z API), to samo event.id drugi raz 200 powtorzone bez przetwarzania',
      pierwszy.status === 200 && pierwszy.json.wynik === 'ok' && powtorka.status === 200 && powtorka.json.powtorzone === true);
    const zlySekret = await webhook(t, zdarzenieTestowe('invoice.paid', { id: 'in_x', customer: kaa.platnikKlient }), { sekret: 'whsec_zly_sekret_1' });
    const zmienione = await webhook(t, zdarzenieTestowe('invoice.paid', { id: 'in_x', customer: kaa.platnikKlient }), { zmien: (s) => s.replace('in_x', 'in_y') });
    const stary = await webhook(t, zdarzenieTestowe('invoice.paid', { id: 'in_x', customer: kaa.platnikKlient }), { czas: Math.floor(Date.now() / 1000) - 600 });
    const bezPodpisu = await webhook(t, zdarzenieTestowe('invoice.paid', { id: 'in_x' }), { naglowek: 'nic' });
    sprawdz('webhook: zly sekret, zmienione cialo, stary czas, brak podpisu -> 400, nic nie zapisane',
      [zlySekret, zmienione, stary, bezPodpisu].every((x) => x.status === 400) && t.magazyn.zdarzeniaNieprzetworzone().length === 0);
    const dwaV1 = zdarzenieTestowe('customer.subscription.updated', obiekt);
    const tt = Math.floor(Date.now() / 1000);
    const naglowekDwa = `t=${tt},v1=${'f'.repeat(64)},v1=${stripe.podpis(Buffer.from(JSON.stringify(dwaV1)), SEKRET, tt)}`;
    const zDwoma = await webhook(t, dwaV1, { naglowek: naglowekDwa });
    const sekrety = t.KONF.platnosci.stripe.sekretWebhooka;
    t.KONF.platnosci.stripe.sekretWebhooka = ['whsec_poprzedni_sekret', SEKRET];
    const poprzedni = await webhook(t, zdarzenieTestowe('customer.subscription.updated', obiekt), { sekret: 'whsec_poprzedni_sekret' });
    t.KONF.platnosci.stripe.sekretWebhooka = sekrety;
    sprawdz('webhook: dwa v1 w naglowku i dwa sekrety w STRIPE_SEKRET_WEBHOOKA (zmiana sekretu) -> 200', zDwoma.status === 200 && poprzedni.status === 200);
    const live = await webhook(t, zdarzenieTestowe('customer.subscription.deleted', obiekt, { livemode: true }));
    const typ = await webhook(t, zdarzenieTestowe('customer.created', { id: kaa.platnikKlient }));
    const inny = await webhook(t, zdarzenieTestowe('invoice.paid', { id: 'in_x' }), { sciezka: '/platnosci/webhook/paypal' });
    const get = await t.zadanie('/platnosci/webhook/stripe');
    sprawdz('webhook: livemode innego trybu i nieobslugiwany typ -> 200 bez zmian; inny dostawca 404; GET 405',
      live.status === 200 && live.json.zignorowane === 'tryb' && typ.status === 200 && typ.json.zignorowane === 'typ' && inny.status === 404 && get.status === 405
      && konto(t, a.login).subskrypcjaStan === 'aktywna');
    const duzy = await t.zadanie('/platnosci/webhook/stripe', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=00' }, body: Buffer.alloc(600 * 1024, 32) });
    sprawdz('webhook: cialo ponad 512 kB -> 413', duzy.status === 413);

    await sterowanie('/_atrapa/blad', { wzor: '^/v1/subscriptions$', status: 500, razy: 3, metoda: 'GET' });
    const zdBlad = zdarzenieTestowe('customer.subscription.updated', obiekt);
    const blad503 = await webhook(t, zdBlad);
    const nieprzetworzone = t.magazyn.zdarzeniaNieprzetworzone().map((x) => x.id);
    const ponowione = await webhook(t, zdBlad);
    sprawdz('webhook: blad API dostawcy (3 proby) -> 503 dostawca-platnosci-niedostepny, zdarzenie czeka; ponowienie Stripe -> 200',
      blad503.status === 503 && blad503.kod === 'dostawca-platnosci-niedostepny' && nieprzetworzone.includes(zdBlad.id) && ponowione.status === 200
      && ponowione.json.wynik === 'ok' && !t.magazyn.zdarzeniaNieprzetworzone().some((x) => x.id === zdBlad.id));
    await sterowanie('/_atrapa/blad', { wzor: '^/v1/subscriptions$', status: 503, razy: 2, metoda: 'GET' });
    const zPonowieniem = await webhook(t, zdarzenieTestowe('customer.subscription.updated', obiekt));
    const listy = (await wywolaniaAtrapy(6)).filter((x) => x.sciezka.startsWith('/v1/subscriptions?'));
    sprawdz('adapter: 2 bledy 5xx -> ponowienia (0,5 s i 2 s, w tescie skrocone) i sukces',
      zPonowieniem.status === 200 && listy.filter((x) => x.status === 503).length === 2 && listy.some((x) => x.status === 200));

    // Kolejnosc: stara subskrypcja usunieta po nowej, zdarzenia odwrocone i podwojne
    const d = await nowyKlient(t);
    await kup(t, d.cookie, { plan: 'standard', waluta: 'pln' });
    const kd = konto(t, d.login);
    const stara = kd.platnikSubskrypcja;
    await apiAtrapy('DELETE', `/subscriptions/${stara}`);
    await az(() => konto(t, d.login).subskrypcjaStan === 'wygasla');
    const nowa = await apiAtrapy('POST', '/subscriptions', { customer: kd.platnikKlient, items: [{ price: 'price_atrapa_premium' }] });
    await az(() => konto(t, d.login).subskrypcjaPlan === 'premium' && konto(t, d.login).subskrypcjaStan === 'aktywna');
    for (const kolejnosc of ['normalna', 'odwrocona', 'podwojna']) {
      await sterowanie('/_atrapa/zdarzenia/wyslij', { zdarzenia: [{ typ: 'customer.subscription.created', id: nowa.json.id }, { typ: 'customer.subscription.deleted', id: stara }], kolejnosc });
    }
    const kd2 = konto(t, d.login);
    sprawdz('kolejnosc: usuniecie starej subskrypcji po nowej (normalnie, odwrocone, podwojnie) -> aktywna premium (stan z listy subskrypcji)',
      nowa.status === 200 && kd2.subskrypcjaStan === 'aktywna' && kd2.subskrypcjaPlan === 'premium' && kd2.platnikSubskrypcja === nowa.json.id
      && atrapa.stan().dostarczone.slice(-6).every((x) => x.status === 200));

    console.log('\n  platnosci (B) - kraj spoza listy (D-04)');
    const l = await nowyKlient(t);
    const kupUs = await kup(t, l.cookie, { kraj: 'US' });
    await az(() => konto(t, l.login).subskrypcjaStan === 'wygasla');
    const kl = konto(t, l.login);
    const zwrotyL = t.magazyn.zwrotyWplaty('stripe', t.magazyn.platnosciKonta(l.login)[0].id);
    const subL = subskrypcjeAtrapy().find((s) => s.customer === kl.platnikKlient);
    const stanL = await (await t.zadanie('/api/platnosci/stan', { headers: { cookie: l.cookie } })).json();
    sprawdz('kraj spoza PLATNOSCI_KRAJE: powrot /?platnosc=kraj, subskrypcja anulowana od razu, zwrot calosci raz, komunikat w stanie konta',
      kupUs.lokalizacja === '/?platnosc=kraj' && kl.subskrypcjaStan === 'wygasla' && subL.status === 'canceled' && zwrotyL.length === 1
      && zwrotyL[0].kwota === 7900 && zwrotyL[0].powod === 'kraj' && zwrotyAtrapy().filter((x) => x.metadata.login === l.login).length === 1
      && stanL.platnosci.odrzucenie.kraj === 'US' && plany.planEfektywny(kl) === 'darmowy');
    const v = await nowyKlient(t, { jezyk: 'en' });
    const kupDe = await kup(t, v.cookie, { waluta: 'eur', kraj: 'DE', jezyk: 'en' });
    sprawdz('kraj z listy (DE, EUR): zakup aktywny, kraj w rejestrze do progu sprzedazy UE',
      kupDe.lokalizacja === '/?platnosc=ok' && t.magazyn.platnosciKonta(v.login)[0].kraj === 'DE' && t.magazyn.platnosciKonta(v.login)[0].waluta === 'eur');

    console.log('\n  platnosci (B) - odstapienie w 14 dni (PR8-31, D-03)');
    const m = await nowyKlient(t);
    await kup(t, m.cookie, {});
    const ocena = await (await t.zadanie('/api/platnosci/odstapienie', { headers: { cookie: m.cookie } })).json();
    const ekranOdst = await t.zadanie('/konto/odstapienie?z=konto', { headers: { cookie: m.cookie } });
    const htmlOdst = await ekranOdst.text();
    const sz = ocena.szacunek;
    sprawdz('odstapienie: GET API mozliwe, termin, szacunek proporcjonalny; ekran z drugim krokiem "Potwierdź odstąpienie od umowy"',
      ocena.mozliwe === true && ocena.termin > Date.now() + 13 * DOBA && sz.tryb === 'proporcjonalny' && sz.kwota === 7900 - Math.round((7900 * sz.dniUzyte) / sz.dniOkresu)
      && ekranOdst.status === 200 && /id="potwierdz-odstapienie"/.test(htmlOdst) && /Potwierdź odstąpienie od umowy/.test(htmlOdst) && !/<script/i.test(htmlOdst));
    const bezPotwierdzenia = await t.zadanie('/api/platnosci/odstapienie', t.json(m.cookie, {}));
    sprawdz('odstapienie: API bez potwierdzam: true -> 403 zgoda-wymagana', bezPotwierdzenia.status === 403);
    const wynikOdst = await t.zadanie('/konto/odstapienie', t.formularz(m.cookie, { potwierdzam: '1', z: 'konto', jezyk: 'pl' }));
    const htmlWynik = await wynikOdst.text();
    await az(() => konto(t, m.login).subskrypcjaStan === 'wygasla');
    const km = konto(t, m.login);
    const odst = t.magazyn.odstapieniaKonta(m.login)[0];
    const zwrotM = zwrotyAtrapy().find((x) => x.metadata.login === m.login);
    sprawdz('odstapienie: oswiadczenie zapisane, subskrypcja anulowana od razu, zwrot proporcjonalny zlecony, konto w pakiecie darmowym',
      wynikOdst.status === 200 && /Odstąpienie przyjęte/.test(htmlWynik) && odst.stan === 'zwrot-zlecony' && odst.zrodlo === 'konto'
      && odst.kwotaZwrotu === zwrotM.amount && zwrotM.amount === 7900 - Math.round((7900 * odst.dniUzyte) / odst.dniOkresu) && km.subskrypcjaStan === 'wygasla'
      && plany.planEfektywny(km) === 'darmowy' && odst.termin === platnosci.terminOdstapienia(odst.zawarcie));
    const znowuOdst = await t.zadanie('/api/platnosci/odstapienie', t.json(m.cookie, { potwierdzam: true }));
    const znowuJ = await znowuOdst.json();
    const stanM = await (await t.zadanie('/api/platnosci/stan', { headers: { cookie: m.cookie } })).json();
    sprawdz('odstapienie: drugie oswiadczenie 409 odstapienie-niedostepne (zlozone), stan konta pokazuje przyjete oswiadczenie',
      znowuOdst.status === 409 && znowuOdst.headers.get('x-cai-kod') === 'odstapienie-niedostepne' && znowuJ.powod === 'zlozone'
      && stanM.platnosci.odstapienie.powod === 'zlozone' && stanM.platnosci.odstapienie.zlozone.kwota === odst.kwotaZwrotu);
    const wymuszona = await (await t.zadanie('/api/platnosci/zakup', t.json(m.cookie, { plan: 'standard', waluta: 'eur', jezyk: 'en', zgodaNaWykonanie: true }))).json();
    sprawdz('waluta klienta, ktory juz placil, wygrywa (Stripe nie laczy walut u klienta)', wymuszona.waluta === 'pln');

    const n = await nowyKlient(t);
    await kup(t, n.cookie, {});
    t.KONF.platnosci.zwrot = 'pelny';
    const ekranPelny = await (await t.zadanie('/konto/zakup', { headers: { cookie: b.cookie } })).text();
    const odstN = await t.zadanie('/api/platnosci/odstapienie', t.json(n.cookie, { potwierdzam: true }));
    const odstNJ = await odstN.json();
    t.KONF.platnosci.zwrot = 'proporcjonalny';
    sprawdz('PLATNOSCI_ZWROT=pelny: zwrot calej kwoty i wariant zgody "otrzymać zwrot całej kwoty"',
      odstN.status === 200 && odstNJ.odstapienie.zwrot.kwota === 7900 && odstNJ.odstapienie.zwrot.tryb === 'pelny' && /zwrot całej kwoty/.test(ekranPelny));

    const o = await nowyKlient(t);
    await kup(t, o.cookie, {});
    const ko = konto(t, o.login);
    t.magazyn.ustawMeta(`platnosci:zawarcie:${ko.platnikSubskrypcja}`, String(Date.now() - 20 * DOBA));
    const poTerminie = await (await t.zadanie('/api/platnosci/odstapienie', { headers: { cookie: o.cookie } })).json();
    const poTerminiePost = await t.zadanie('/api/platnosci/odstapienie', t.json(o.cookie, { potwierdzam: true }));
    const poTerminieEkran = await t.zadanie('/konto/odstapienie', { headers: { cookie: o.cookie } });
    const htmlPo = await poTerminieEkran.text();
    sprawdz('odstapienie po terminie: GET mozliwe false (po-terminie), POST 409, ekran z panelem subskrypcji, subskrypcja bez zmian',
      poTerminie.mozliwe === false && poTerminie.powod === 'po-terminie' && poTerminiePost.status === 409 && (await poTerminiePost.json()).powod === 'po-terminie'
      && /minął/.test(htmlPo) && /id="panel-subskrypcji"/.test(htmlPo) && konto(t, o.login).subskrypcjaStan === 'aktywna');

    const p = await nowyKlient(t);
    await kup(t, p.cookie, {});
    await sterowanie('/_atrapa/blad', { wzor: '^/v1/subscriptions/sub_', status: 500, razy: 3, metoda: 'DELETE' });
    const odstBlad = await t.zadanie('/api/platnosci/odstapienie', t.json(p.cookie, { potwierdzam: true }));
    const odstP = t.magazyn.odstapieniaKonta(p.login)[0];
    const statusAdmin = await (await t.zadanie('/api/status', { headers: { cookie: cAdmin } })).json();
    sprawdz('odstapienie przy awarii dostawcy: 503, oswiadczenie zapisane w stanie blad (liczy sie chwila zlozenia), /api/status je pokazuje',
      odstBlad.status === 503 && odstBlad.headers.get('x-cai-kod') === 'dostawca-platnosci-niedostepny' && odstP.stan === 'blad'
      && konto(t, p.login).subskrypcjaStan === 'aktywna' && statusAdmin.platnosci.odstapieniaZBledem === 1);
    const uzg = await platnosci.uzgodnij(t.KONF, { login: p.login, naSekunde: 0 });
    await az(() => konto(t, p.login).subskrypcjaStan === 'wygasla');
    const odstP2 = t.magazyn.odstapienie(odstP.id);
    sprawdz('uzgadnianie dokancza odstapienie z bledem: anulowanie i zwrot z tym samym kluczem, ta sama chwila zlozenia',
      uzg.odstapien === 1 && odstP2.stan === 'zwrot-zlecony' && odstP2.zlozone === odstP.zlozone && konto(t, p.login).subskrypcjaStan === 'wygasla'
      && zwrotyAtrapy().filter((x) => x.metadata.login === p.login).length === 1);

    console.log('\n  platnosci (B) - usuniecie konta (A1: anulujDlaKonta)');
    const q = await nowyKlient(t);
    await kup(t, q.cookie, {});
    const usunQ = await platnosci.anulujDlaKonta(konto(t, q.login), kontekst);
    const r = await nowyKlient(t);
    await kup(t, r.cookie, {});
    t.magazyn.ustawMeta(`platnosci:zawarcie:${konto(t, r.login).platnikSubskrypcja}`, String(Date.now() - 20 * DOBA));
    const usunR = await platnosci.anulujDlaKonta(konto(t, r.login), kontekst);
    const subR = subskrypcjeAtrapy().find((s) => s.customer === konto(t, r.login).platnikKlient);
    sprawdz('usuniecie konta: w terminie odstapienie ze zwrotem, po terminie natychmiastowe anulowanie bez zwrotu',
      usunQ.anulowano && usunQ.odstapienie && usunQ.odstapienie.kwota > 0 && t.magazyn.odstapieniaKonta(q.login)[0].zrodlo === 'usuniecie-konta'
      && usunR.anulowano && !usunR.odstapienie && subR.status === 'canceled' && !zwrotyAtrapy().some((x) => x.metadata.login === r.login));
    const bezKlienta = await platnosci.anulujDlaKonta(konto(t, b.login), kontekst);
    let wyjatek = null;
    try {
      await platnosci.anulujDlaKonta(konto(t, a.login), { KONF: { ...t.KONF, funkcje: { ...t.KONF.funkcje, platnosci: { wlaczona: false } } } });
    } catch (e) { wyjatek = e; }
    sprawdz('usuniecie konta: bez klienta nic do anulowania; zywa subskrypcja przy wylaczonych platnosciach -> wyjatek (konto zostaje)',
      bezKlienta.ok && bezKlienta.anulowano === false && wyjatek instanceof Error);

    console.log('\n  platnosci (B) - uzgadnianie (zgubione webhooki)');
    const j = await nowyKlient(t);
    await kup(t, j.cookie, {});
    const kj = konto(t, j.login);
    await sterowanie('/_atrapa/ustaw', { webhooki: 'wylaczone' });
    const panelJ = await (await t.zadanie('/api/platnosci/panel', t.json(j.cookie, {}))).json();
    await formularzAtrapy(panelJ.url, { akcja: 'anuluj' });
    const kk = await nowyKlient(t);
    const kupK = await kup(t, kk.cookie, {});
    const przedUzg = { j: konto(t, j.login).subskrypcjaStan, wplatyK: t.magazyn.platnosciKonta(kk.login).length };
    const wynikUzg = await platnosci.uzgodnij(t.KONF, { naSekunde: 0 });
    await sterowanie('/_atrapa/ustaw', { webhooki: 'wlaczone' });
    const ponow = await sterowanie('/_atrapa/zdarzenia/ponow');
    sprawdz('uzgadnianie: stan po zmianie w panelu bez webhooka dogoniony, brakujaca wplata z API, ponowione zdarzenia bez skutkow ubocznych',
      kj.subskrypcjaStan === 'aktywna' && przedUzg.j === 'aktywna' && konto(t, j.login).subskrypcjaStan === 'anulowana' && kupK.lokalizacja === '/?platnosc=ok'
      && przedUzg.wplatyK === 0 && wynikUzg.bledow === 0 && wynikUzg.kont >= 2 && ponow.dostarczone.length > 0
      && ponow.dostarczone.every((x) => x.status === 200) && t.magazyn.platnosciKonta(kk.login).length === 1 && Number(t.magazyn.meta('platnosci:ostatnie_uzgodnienie')) > 0);

    console.log('\n  platnosci (B) - ceny u dostawcy a ceny na ekranie, limit sesji');
    const cenyPrzed = t.KONF.platnosci.cenyWyswietlane;
    t.KONF.platnosci.cenyWyswietlane = 'standard:eur=19,pln=89;premium:eur=49,pln=199';
    const u = await nowyKlient(t);
    const niezgodnaPln = await t.zadanie('/api/platnosci/zakup', t.json(u.cookie, { plan: 'standard', waluta: 'pln', zgodaNaWykonanie: true }));
    const niezgodnaJ = await niezgodnaPln.json();
    const stanU = await (await t.zadanie('/api/platnosci/stan', { headers: { cookie: u.cookie } })).json();
    const zgodnaEur = await t.zadanie('/api/platnosci/zakup', t.json(u.cookie, { plan: 'standard', waluta: 'eur', zgodaNaWykonanie: true }));
    t.KONF.platnosci.cenyWyswietlane = cenyPrzed;
    sprawdz('PLATNOSCI_CENY_WYSWIETLANE inna niz cena u dostawcy: ta pozycja wstrzymana (400 plan-niedostepny, powod cena), inne dzialaja',
      niezgodnaPln.status === 400 && niezgodnaJ.powod === 'cena' && stanU.platnosci.plany[0].ceny.pln === undefined && stanU.platnosci.plany[0].ceny.eur === 1900
      && zgodnaEur.status === 200);
    const tt2 = await nowyKlient(t);
    const kodySesji = [];
    for (let i = 0; i < 11; i += 1) {
      kodySesji.push((await t.zadanie('/api/platnosci/zakup', t.json(tt2.cookie, { plan: 'standard', zgodaNaWykonanie: true }))).status);
    }
    sprawdz('limit sesji zakupu: 10 na godzine na konto, 11. -> 429 za-duzo-prob', kodySesji.slice(0, 10).every((s) => s === 200) && kodySesji[10] === 429);

    console.log('\n  platnosci (B) - przychod, progi (PR8-09), wylacznik sprzedazy');
    const kw = platnosci.kwartal(Date.now());
    const przychod = platnosci.przychodOkresu(t.KONF, kw);
    const wszystkie = t.magazyn.platnosciWOkresie({ tryb: 'test', od: kw.od, do: kw.do });
    const zwroty = t.magazyn.zwrotyWOkresie({ tryb: 'test', od: kw.od, do: kw.do });
    const sumaPln = wszystkie.filter((x) => x.waluta === 'pln').reduce((s, x) => s + x.kwota, 0) - zwroty.filter((x) => x.waluta === 'pln').reduce((s, x) => s + x.kwota, 0);
    sprawdz('przychod kwartalu: wplaty minus zwroty per waluta, EUR po kursie, sprzedaz do innych krajow UE (DE) w EUR',
      Math.abs(przychod.wgWalut.pln - sumaPln / 100) < 0.001 && przychod.wgWalut.eur === 19 && przychod.ueEur === 19
      && Math.abs(przychod.razemPln - (sumaPln / 100 + 19 * 4.25)) < 0.01 && przychod.zwrotow === zwroty.length && przychod.wplat === wszystkie.length);
    const listyPrzed = t.poczta().filter((x) => x.szablon === 'prog-przychodu').length;
    t.KONF.platnosci.progKwartalPln = przychod.razemPln / 0.85;
    const p1 = await platnosci.sprawdzProgi(t.KONF, { kontekst });
    await platnosci.sprawdzProgi(t.KONF, { kontekst });
    const listy1 = t.poczta().filter((x) => x.szablon === 'prog-przychodu');
    t.KONF.platnosci.progKwartalPln = przychod.razemPln / 1.5;
    const p2 = await platnosci.sprawdzProgi(t.KONF, { kontekst });
    await platnosci.sprawdzProgi(t.KONF, { kontekst });
    const listy2 = t.poczta().filter((x) => x.szablon === 'prog-przychodu');
    sprawdz('progi 60% i 80%, potem 100%: jeden e-mail do uslugodawcy na prog i kwartal (ponowne sprawdzenie nic nie wysyla)',
      listyPrzed === 0 && JSON.stringify(p1.osiagniete) === '[60,80]' && listy1.length === 2 && JSON.stringify(p2.osiagniete) === '[60,80,100]'
      && listy2.length === 3 && listy2.every((x) => x.do === 'kontakt@example.com') && listy2[2].dane.prog === 100 && listy2[0].dane.okres === kw.nazwa
      && t.magazyn.meta(`prog:kwartal:${kw.nazwa}:100`) !== null);
    t.KONF.platnosci.wstrzymajPoProgu = true;
    t.KONF.platnosci.progKwartalPln = przychod.razemPln + 50;
    const w1 = await nowyKlient(t);
    const ponadProg = await t.zadanie('/api/platnosci/zakup', t.json(w1.cookie, { plan: 'standard', waluta: 'pln', zgodaNaWykonanie: true }));
    const ponadJ = await ponadProg.json();
    const ponadProgEur = await t.zadanie('/api/platnosci/zakup', t.json(w1.cookie, { plan: 'standard', waluta: 'eur', zgodaNaWykonanie: true }));
    t.KONF.platnosci.progKwartalPln = przychod.razemPln - 1;
    const stanW = await (await t.zadanie('/api/platnosci/stan', { headers: { cookie: w1.cookie } })).json();
    const statusW = platnosci.stan();
    t.KONF.platnosci.wstrzymajPoProgu = false;
    t.KONF.platnosci.progKwartalPln = 10813.5;
    sprawdz('PLATNOSCI_WSTRZYMAJ_PO_PROGU: zakup, ktory przekroczylby limit kwartalny -> 403 sprzedaz-wstrzymana (powod prog); po limicie sprzedaz wylaczona w stanie konta',
      ponadProg.status === 403 && ponadProg.headers.get('x-cai-kod') === 'sprzedaz-wstrzymana' && ponadJ.powod === 'prog'
      && ponadProgEur.status === 403 && stanW.platnosci.sprzedaz === false && stanW.platnosci.mozeKupic === false && statusW.progi.sprzedazWstrzymana === true);

    console.log('\n  platnosci (B) - /api/status i CLI');
    const st = await (await t.zadanie('/api/status', { headers: { cookie: cAdmin } })).json();
    sprawdz('/api/status: platnosci wlaczone, ceny zgodne, ostatni webhook, 0 nieprzetworzonych, progi kwartalu, bez sekretow',
      st.platnosci.wlaczone && st.platnosci.tryb === 'test' && st.platnosci.cenyZgodne === true && st.platnosci.ostatniWebhook > 0 && st.platnosci.nieprzetworzone === 0
      && st.platnosci.progi.kwartal === kw.nazwa && st.platnosci.odstapieniaZBledem === 0 && !JSON.stringify(st).includes(SEKRET) && !JSON.stringify(st).includes(KLUCZ));
    const sprawdzCli = await cli('platnosci-sprawdz');
    sprawdz('CLI platnosci-sprawdz: konfiguracja, ceny u dostawcy, webhook, progi; kod 0', sprawdzCli.status === 0 && /Ceny u dostawcy: zgodne/.test(sprawdzCli.stdout)
      && /Gotowe \(kod 0\)/.test(sprawdzCli.stdout) && /Webhook: ostatnie zdarzenie \d{4}-/.test(sprawdzCli.stdout));
    const przychodCli = await cli('przychod');
    const rokCli = await cli('przychod', String(kw.rok));
    const zlyOkres = await cli('przychod', '2026-Q7');
    sprawdz('CLI przychod: kwartal z krajami, procentem limitu i sprzedaza do UE; rok z czterema kwartalami; zly okres kod 1',
      przychodCli.status === 0 && przychodCli.stdout.includes(`Przychód ${kw.nazwa}`) && /wg krajów: DE 19,00\s*€; PL/.test(przychodCli.stdout)
      && /limit kwartalny 10\s?813,50\s*zł/.test(przychodCli.stdout) && /innych krajów UE w \d{4}: 19,00\s*€/.test(przychodCli.stdout)
      && rokCli.status === 0 && (rokCli.stdout.match(/^\d{4}-Q\d: /gm) || []).length === 4 && zlyOkres.status === 1);
    const dzis = platnosci.dzienWarszawy(Date.now());
    const ewid = await cli('ewidencja', dzis, dzis);
    const wierszeCsv = ewid.stdout.trim().split('\n');
    const polnoc = platnosci.polnocWarszawy(...dzis.split('-').map(Number));
    const oczekiwane = t.magazyn.platnosciWOkresie({ tryb: 'test', od: polnoc, do: Date.now() + DOBA }).length
      + t.magazyn.zwrotyWOkresie({ tryb: 'test', od: polnoc, do: Date.now() + DOBA }).length;
    sprawdz('CLI ewidencja: CSV ze srednikiem, wplaty i zwroty (kwota ujemna) w dniu zlecenia, kwota w PLN',
      ewid.status === 0 && wierszeCsv[0].startsWith('lp;data;rodzaj;identyfikator') && wierszeCsv.length - 1 === oczekiwane
      && wierszeCsv.some((x) => /;zwrot \(odstapienie\);re_/.test(x) && /;-\d+,\d{2};pln;/.test(x))
      && wierszeCsv.some((x) => /;wplata;in_[^;]+;in_[^;]+;k-[^;]+;DE;19,00;eur;80,75;/.test(x)));
    const ewidDni = await cli('ewidencja', dzis, dzis, '--dziennie');
    const zleDaty = await cli('ewidencja', '2026-13-01', dzis);
    sprawdz('CLI ewidencja --dziennie: jeden wiersz na dzien z suma i narastajaco; zle daty -> kod 1',
      ewidDni.status === 0 && ewidDni.stdout.trim().split('\n').length === 2 && zleDaty.status === 1);
    const x = await nowyKlient(t);
    await kup(t, x.cookie, {});
    const zwrotSucho = await cli('zwrot', x.login);
    const zwrotTak = await cli('zwrot', x.login, '--wykonaj');
    await az(() => konto(t, x.login).subskrypcjaStan === 'wygasla');
    const odstX = t.magazyn.odstapieniaKonta(x.login)[0];
    const zwrotZnow = await cli('zwrot', x.login, '--wykonaj');
    sprawdz('CLI zwrot: bez --wykonaj tylko wyliczenie; z --wykonaj odstapienie (zrodlo cli), anulowanie i zwrot; drugi raz kod 1',
      zwrotSucho.status === 0 && /Bez zmian/.test(zwrotSucho.stdout) && /zwrot \d+,\d{2}\s*zł/.test(zwrotSucho.stdout) && zwrotTak.status === 0
      && /przyjęte/.test(zwrotTak.stdout) && odstX.zrodlo === 'cli' && odstX.stan === 'zwrot-zlecony' && konto(t, x.login).subskrypcjaStan === 'wygasla'
      && zwrotZnow.status === 1);
    const y = await nowyKlient(t);
    const klientY = await apiAtrapy('POST', '/customers', { email: 'y@example.com', metadata: { login: y.login } });
    const klientY2 = await apiAtrapy('POST', '/customers', { email: 'y2@example.com' });
    const powiaz = await cli('platnosci-powiaz', y.login, klientY.json.id);
    const konflikt = await cli('platnosci-powiaz', y.login, klientY2.json.id);
    const zamien = await cli('platnosci-powiaz', y.login, klientY2.json.id, '--zamien');
    sprawdz('CLI platnosci-powiaz (tryb test): wiazanie, konflikt bez --zamien, przepiecie z --zamien',
      powiaz.status === 0 && /Powiązano/.test(powiaz.stdout) && konflikt.status === 1 && zamien.status === 0 && konto(t, y.login).platnikKlient === klientY2.json.id);
    const sync = await cli('platnosci-synchronizuj', a.login);
    sprawdz('CLI platnosci-synchronizuj <login>: kod 0, stan konta z dostawcy', sync.status === 0 && /Uzgodniono kont: 1/.test(sync.stdout));
    const skryptStripe = (...dodatkowe) => new Promise((ok) => {
      const proc = spawn(process.execPath, [path.join(__dirname, '..', 'narzedzia', 'test_platnosci_stripe.js'), '--waluta', 'pln',
        '--cli', `${process.execPath} ${path.join(__dirname, 'uzytkownicy.js')}`, ...dodatkowe],
      { env: { ...process.env, STRIPE_KLUCZ_ZEGARY: 'sk_test_atrapa_zegary', TEST_PLATNOSCI_CZEKAJ_S: '0.2' } });
      let wyjscie = '';
      proc.stdout.on('data', (dd) => { wyjscie += dd; });
      proc.stderr.on('data', (dd) => { wyjscie += dd; });
      proc.on('close', (status) => ok({ status, wyjscie }));
    });
    const zz = await nowyKlient(t);
    const skrypt = await skryptStripe('--login', zz.login);
    const zz2 = await nowyKlient(t);
    const skrypt0341 = await skryptStripe('--login', zz2.login, '--karta', '0341', '--sprzataj');
    const bezKlucza = await new Promise((ok) => {
      const proc = spawn(process.execPath, [path.join(__dirname, '..', 'narzedzia', 'test_platnosci_stripe.js'), '--login', zz.login], { env: { ...process.env, STRIPE_KLUCZ_ZEGARY: KLUCZ } });
      proc.on('close', (status) => ok(status));
    });
    sprawdz('narzedzia/test_platnosci_stripe.js (11.4) na atrapie: zegar testowy, subskrypcja, powiazanie, miesiac pozniej aktywna z 2 wplatami; klucz rk_ -> kod 2',
      skrypt.status === 0 && /Gotowe: stan konta zgodny/.test(skrypt.wyjscie) && konto(t, zz.login).subskrypcjaStan === 'aktywna'
      && t.magazyn.platnosciKonta(zz.login).length === 2 && bezKlucza === 2);
    sprawdz('narzedzia/test_platnosci_stripe.js --karta 0341 --sprzataj: odnowienie odrzucone -> zalegla (T9), zegar usuniety',
      skrypt0341.status === 0 && /miesiac 1: stan zalegla/.test(skrypt0341.wyjscie) && /Usunięto zegar/.test(skrypt0341.wyjscie) && konto(t, zz2.login).subskrypcjaStan === 'zalegla');

    console.log('\n  platnosci (B) - stany ARCH8-16 z przesuwanym czasem atrapy');
    const e = await nowyKlient(t);
    await kup(t, e.cookie, { akcja: 'zaplac-0341' });
    const f = await nowyKlient(t);
    await kup(t, f.cookie, { akcja: 'zaplac-0341' });
    const g = await nowyKlient(t);
    await kup(t, g.cookie, {});
    const panelG = await (await t.zadanie('/api/platnosci/panel', t.json(g.cookie, {}))).json();
    await formularzAtrapy(panelG.url, { akcja: 'anuluj' });
    t.KONF.platnosci.probaDni = 7;
    const h = await nowyKlient(t);
    const kupH = await kup(t, h.cookie, {});
    t.KONF.platnosci.probaDni = 0;
    const kh = konto(t, h.login);
    sprawdz('ARCH8-16 probna: PLATNOSCI_PROBA_DNI -> trialing -> probna z pakietem, wplata zerowa poza rejestrem',
      kupH.lokalizacja === '/?platnosc=ok' && kh.subskrypcjaStan === 'probna' && plany.planEfektywny(kh) === 'standard' && t.magazyn.platnosciKonta(h.login).length === 0);
    const i = await nowyKlient(t);
    const klientI = await apiAtrapy('POST', '/customers', { email: 'i@example.com', metadata: { login: i.login } });
    platnosci.powiazKonto(konto(t, i.login), klientI.json.id, t.KONF);
    const metodaI = await apiAtrapy('POST', '/payment_methods/pm_card_chargeCustomerFail/attach', { customer: klientI.json.id });
    const subI = await apiAtrapy('POST', '/subscriptions', { customer: klientI.json.id, items: [{ price: 'price_atrapa_standard' }], currency: 'pln', default_payment_method: metodaI.json.id });
    await az(() => konto(t, i.login).subskrypcjaSurowy === 'incomplete');
    sprawdz('ARCH8-16 incomplete (pierwsza platnosc niedokonczona) -> brak, bez pakietu',
      subI.json.status === 'incomplete' && konto(t, i.login).subskrypcjaStan === 'brak' && plany.planEfektywny(konto(t, i.login)) === 'darmowy');
    const wplatyAPrzed = t.magazyn.platnosciKonta(a.login).length;
    const okresAPrzed = konto(t, a.login).okresDo;
    await sterowanie('/_atrapa/czas', { dni: 32 });
    const ke = konto(t, e.login);
    sprawdz('ARCH8-16 zalegla: nieudane odnowienie (karta 0341) -> zalegla, pakiet przez PLATNOSCI_ZALEGLA_DNI, potem darmowy',
      ke.subskrypcjaStan === 'zalegla' && ke.zaleglaOd > Date.now() - 60_000 && plany.planEfektywny(ke) === 'standard'
      && plany.planEfektywny(ke, Date.now() + 8 * DOBA) === 'darmowy' && plany.dostepDo(ke) === ke.zaleglaOd + 7 * DOBA);
    sprawdz('ARCH8-16 anulowana -> po koncu okresu wygasla (pakiet darmowy)', konto(t, g.login).subskrypcjaStan === 'wygasla' && plany.planEfektywny(konto(t, g.login)) === 'darmowy');
    sprawdz('ARCH8-16 koniec okresu probnego: platnosc -> aktywna, wplata w rejestrze', konto(t, h.login).subskrypcjaStan === 'aktywna' && t.magazyn.platnosciKonta(h.login).length === 1);
    sprawdz('ARCH8-16 incomplete_expired -> wygasla', konto(t, i.login).subskrypcjaStan === 'wygasla');
    const wplatyA = t.magazyn.platnosciKonta(a.login);
    sprawdz('odnowienie: invoice.paid -> nowy okres_do i druga wplata w rejestrze (kwota pakietu po zmianie w panelu)',
      wplatyA.length === wplatyAPrzed + 1 && konto(t, a.login).okresDo > okresAPrzed && wplatyA[wplatyA.length - 1].kwota === 19900 && wplatyA[wplatyA.length - 1].plan === 'premium');
    const panelE = await (await t.zadanie('/api/platnosci/panel', t.json(e.cookie, {}))).json();
    await formularzAtrapy(panelE.url, { akcja: 'karta' });
    sprawdz('zalegla -> aktualizacja karty w panelu -> aktywna', konto(t, e.login).subskrypcjaStan === 'aktywna' && konto(t, e.login).zaleglaOd === null);
    await sterowanie('/_atrapa/czas', { dni: 10 });
    const kf = konto(t, f.login);
    sprawdz('ARCH8-16 wyczerpane ponowienia obciazenia -> canceled -> wygasla, pakiet darmowy',
      kf.subskrypcjaStan === 'wygasla' && plany.planEfektywny(kf) === 'darmowy');
    const subH = subskrypcjeAtrapy().find((s) => s.customer === kh.platnikKlient);
    atrapa.stan().subskrypcje.get(subH.id).status = 'paused';
    await sterowanie('/_atrapa/zdarzenia/wyslij', { typ: 'customer.subscription.updated', id: subH.id });
    sprawdz('ARCH8-16 paused -> wygasla', konto(t, h.login).subskrypcjaStan === 'wygasla');
  } finally {
    stripe.USTAWIENIA.ponowieniaMs = ponowienia;
    await sterowanie('/_atrapa/blad', {});
    await sterowanie('/_atrapa/ustaw', { webhooki: 'wlaczone' });
    await t.zamknij();
  }
}

// ─── 6. KOD8-13 i KOD8-20: liczniki pakietu ──────────────────────────────────

async function testyLicznikow(sprawdz) {
  console.log('\n  plany (B) - KOD8-13 kontynuacja pause_turn, KOD8-20 rezerwacja limitu');
  const t = await uruchomSerwer({ atrapaDostawcow: true });
  try {
    const { czynnosciTresci } = t.srv;
    sprawdz('KOD8-13: x-cai-czynnosc artykul-ciag liczy tylko wywolanie (nie drugi artykul)',
      JSON.stringify(czynnosciTresci({ headers: { 'x-cai-czynnosc': 'artykul-ciag' } })) === '["wywolanie"]'
      && JSON.stringify(czynnosciTresci({ headers: { 'x-cai-czynnosc': 'artykul' } })) === '["wywolanie","artykul"]');
    const cookie = await t.zaloguj('darmowy');
    const kontoD = t.magazyn.kontoZOrganizacja('darmowy');
    for (let n = 0; n < 2; n += 1) plany.policz({ konto: kontoD, czynnosc: 'artykul' });
    const uzycie = async () => (await (await t.zadanie('/api/pakiet', { headers: { cookie } })).json()).uzycie;
    const tresc = { model: 'claude-sonnet-5', max_tokens: 20, messages: [{ role: 'user', content: 'Napisz krotki tekst.' }] };
    const artykul = await t.zadanie('/api', t.json(cookie, tresc, { 'x-cai-czynnosc': 'artykul' }));
    const poArtykule = await uzycie();
    const ciag = await t.zadanie('/api', t.json(cookie, tresc, { 'x-cai-czynnosc': 'artykul-ciag' }));
    const poCiagu = await uzycie();
    const nowy = await t.zadanie('/api', t.json(cookie, tresc, { 'x-cai-czynnosc': 'artykul' }));
    sprawdz('KOD8-13 przez serwer: przy 3/3 artykulach kontynuacja artykulu przechodzi (200, +1 wywolanie, artykuly bez zmian), nowy artykul 402',
      artykul.status === 200 && poArtykule.artykul.zuzyte === 3 && ciag.status === 200 && poCiagu.artykul.zuzyte === 3
      && poCiagu.wywolanie.zuzyte === poArtykule.wywolanie.zuzyte + 1 && nowy.status === 402 && nowy.headers.get('x-cai-kod') === 'limit-pakietu');

    // KOD8-20: rezerwacja atomowa w bazie (funkcje plany.js dla sekcji proxy w server.js)
    const { hash, sol } = t.srv.zahaszuj(HASLO);
    const klient = t.magazyn.utworzOrganizacjeIKonto({ email: 'rezerwacje@example.com', hash, sol });
    const k = t.magazyn.kontoZOrganizacja(klient.login);
    const dzis = Array.from({ length: 5 }, () => plany.sprawdzLimit({ konto: k, czynnosc: 'artykul' }).wolno);
    sprawdz('KOD8-20 (dzis): sprawdzLimit przed wywolaniem i policz po nim - 5 zapytan naraz przy limicie 3 przechodzi (wada)', dzis.every(Boolean));
    const r = Array.from({ length: 5 }, () => plany.zarezerwuj({ konto: k, czynnosci: ['wywolanie', 'artykul'] }));
    const ok = r.filter((x) => x.wolno);
    const stan1 = plany.stanPakietu({ konto: k });
    sprawdz('KOD8-20: 5 rezerwacji naraz przy limicie 3 artykulow -> 3 wolno, 2 odmowy (artykul, limit-wyczerpany), wywolanie oddane przy odmowie',
      ok.length === 3 && r.filter((x) => !x.wolno).every((x) => x.czynnosc === 'artykul' && x.odmowa.powod === 'limit-wyczerpany' && x.odmowa.zostalo === 0)
      && stan1.uzycie.artykul.zuzyte === 3 && stan1.uzycie.wywolanie.zuzyte === 3);
    plany.policz({ konto: k, czynnosc: 'wywolanie', rezerwacja: ok[0].rezerwacja });
    plany.policz({ konto: k, czynnosc: 'artykul', rezerwacja: ok[0].rezerwacja });
    const oddane0 = ok[0].rezerwacja.zwolnij();
    const oddane1 = ok[1].rezerwacja.zwolnij();
    const oddane1b = ok[1].rezerwacja.zwolnij();
    plany.policz({ konto: k, czynnosc: 'wywolanie', rezerwacja: ok[2].rezerwacja });
    const oddane2 = ok[2].rezerwacja.zwolnij();
    const stan2 = plany.stanPakietu({ konto: k });
    sprawdz('KOD8-20: potwierdzenie po sukcesie nie liczy drugi raz; blad dostawcy zwalnia (raz); czesciowe potwierdzenie oddaje reszte',
      oddane0 === 0 && oddane1 === 2 && oddane1b === 0 && oddane2 === 1 && stan2.uzycie.artykul.zuzyte === 1 && stan2.uzycie.wywolanie.zuzyte === 2);
    const premium = t.magazyn.kontoZOrganizacja('premium');
    const bezLimitu = plany.zarezerwuj({ konto: premium, czynnosci: ['wywolanie', 'artykul'] });
    const nieznana = plany.zarezerwuj({ konto: k, czynnosci: ['wywolanie', 'zmyslona'] });
    sprawdz('KOD8-20: pakiet bez limitu nic nie rezerwuje, nieznana czynnosc odmawia i oddaje juz zajete',
      bezLimitu.wolno && bezLimitu.rezerwacja.zwolnij() === 0 && !nieznana.wolno && nieznana.odmowa.powod === 'nieznana-czynnosc'
      && plany.stanPakietu({ konto: k }).uzycie.wywolanie.zuzyte === 2);
    // Po wpieciu rezerwacji w proxy (lata dla sekcji C: AG/runda9/b/kod8-20-server.diff) rownolegle zapytania przez serwer.
    if (fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').includes('plany.zarezerwuj')) {
      t.magazyn.utworzKonto({ login: 'rownolegle', hash, sol, plan: 'darmowy' });
      plany.policz({ konto: t.magazyn.kontoZOrganizacja('rownolegle'), czynnosc: 'artykul' });
      const cRow = await t.zaloguj('rownolegle');
      const naraz = await Promise.all(Array.from({ length: 4 }, () => t.zadanie('/api', t.json(cRow, tresc, { 'x-cai-czynnosc': 'artykul' }))));
      const statusy = naraz.map((x) => x.status).sort();
      sprawdz('KOD8-20 przez serwer: 4 artykuly naraz przy 2 pozostalych -> 2 x 200, 2 x 402', JSON.stringify(statusy) === '[200,200,402,402]');
    } else {
      console.log('    (KOD8-20 przez serwer: czeka na wpiecie plany.zarezerwuj w proxy, lata w AG/runda9/b/kod8-20-server.diff)');
    }
  } finally {
    await t.zamknij();
  }
}

async function uruchom({ sprawdz }) {
  testyJednostkowe(sprawdz);
  const serwerAtrapy = atrapa.uruchom(0, { sekret: SEKRET, webhook: '' });
  URL_ATRAPY = `http://127.0.0.1:${await nasluch(serwerAtrapy)}`;
  try {
    await testyAtrapy(sprawdz);
    await testyWylaczone(sprawdz);
    await testyKonfiguracji(sprawdz);
    await testyZakupu(sprawdz);
    await testyLicznikow(sprawdz);
  } finally {
    await new Promise((r) => serwerAtrapy.close(r));
    atrapa.KONF.webhook = '';
  }
}

module.exports = { uruchom };
