'use strict';

// ─── Platnosci: rdzen niezalezny od dostawcy (wykonawca B, ARCH8-13..20) ─────
//
// Konta, plany i aplikacja znaja tylko znormalizowany stan subskrypcji (kolumny konta
// platnik*, subskrypcja_*: magazyn.js). Wszystko, co zna Stripe, jest w adapterze
// serwer/platnosci-<dostawca>.js (interfejs w naglowku platnosci-stripe.js).
//
// Router (server.js) wola:
//   1. obsluzWebhook(sciezka, req, res, kontekst) - POST /platnosci/webhook/<dostawca>, PRZED sesja
//      i kontrola CSRF; bezpieczenstwo to wylacznie podpis na surowych bajtach (ARCH8-15).
//      Wylaczone platnosci: false (zapytanie idzie dalej jak dzis).
//   2. obsluz(sciezka, req, res, kontekst) - z sesja, PIERWSZY z modulow tras:
//        GET  /konto/zakup?plan=&waluta=&z=app|konto     ekran zakupu (CSP z hostami dostawcy)
//        POST /konto/zakup (plan, waluta, zgoda_regulamin=1, zgoda_wykonanie=1, z)   303 do Checkout
//        POST /konto/panel (z)                             303 do panelu klienta dostawcy
//        GET  /konto/platnosc?wynik=ok|anulowana&sesja=&z= powrot: synchronizacja bez czekania na webhook,
//                                                          303 /?platnosc=ok|oczekuje|kraj|anulowana (z=konto: /konto?...)
//        GET|POST /konto/odstapienie                       odstapienie w 14 dni (PR8-31, art. 11a dyrektywy 2011/83/UE)
//        POST /api/platnosci/zakup { plan, waluta, zgodaNaWykonanie, zgodaRegulamin?, z? } -> { url, plan, waluta, kwota }
//        POST /api/platnosci/panel { z? }                  -> { url }
//        GET  /api/platnosci/stan                          -> stanDlaKonta (lekkie odpytywanie po powrocie z Checkout)
//        GET  /api/platnosci/odstapienie                   -> { mozliwe, powod, zawarcie, termin, szacunek }
//        POST /api/platnosci/odstapienie { potwierdzam: true } -> { ok, odstapienie }
//      Przy kazdym zapytaniu z sesja: konto 'aktywna' z okresDo starszym niz 2 doby -> synchronizacja w tle.
//   3. stanDlaKonta(konto, kontekst) - sekcje subskrypcja i platnosci w /api/konto (A1), synchronicznie.
//   4. anulujDlaKonta(konto, kontekst) - usuniecie konta (A1): w terminie odstapienia = odstapienie ze
//      zwrotem (regulamin par. 10 ust. 2), potem natychmiastowe anulowanie bez zwrotu. Blad = wyjatek.
//   5. stan() - sekcja platnosci w /api/status (tryb, ceny, webhook, zdarzenia, przychod i progi).
//   6. inicjuj(kontekstSerwera) - zegary: ceny u dostawcy (start, ponowienie po 5 min, co 6 h),
//      uzgadnianie co 6 h, progi przychodu.
//
// Osoba fizyczna bez dzialalnosci (decyzja 2, PR8-09..13): bez Stripe Tax i NIP (opcje), rejestr wplat
// i zwrotow, licznik przychodu w kwartale z progami ostrzezen (60%, 80%, 100% limitu kwartalnego) i progiem
// sprzedazy do innych krajow UE (10 000 EUR w roku), opcjonalny wylacznik sprzedazy nowym klientom
// (PLATNOSCI_WSTRZYMAJ_PO_PROGU: zakup, ktory przekroczylby limit kwartalny, jest odmawiany). Sprzedaz
// tylko do krajow z PLATNOSCI_KRAJE (D-04): Checkout nie ogranicza kraju adresu rozliczeniowego, wiec
// zakup z adresem spoza listy jest od razu anulowany i zwracany w calosci, a klient dostaje komunikat.

const crypto = require('node:crypto');
const magazyn = require('./magazyn.js');
const plany = require('./plany.js');
const limity = require('./limity.js');
const dzierzawy = require('./dzierzawy.js');
const ekrany = require('./ekrany-platnosci.js');
const dokumenty = require('./dokumenty-prawne.js');

// Dostawcy z adapterem w serwer/platnosci-<nazwa>.js (zmienna PLATNOSCI=<nazwa>).
const DOSTAWCY = ['stripe'];

const DOBA = 24 * 3600_000;
const DNI_ODSTAPIENIA = 14;
const CO_6_GODZIN = 6 * 3600_000;
const PONOW_CENY_MS = 5 * 60_000;
const SYNCHRONIZACJA_W_TLE_CO_MS = 10 * 60_000;
const METODY = new Set(['card', 'blik', 'link', 'sepa_debit', 'paypal', 'auto']);
const KRAJE_UE = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
const TRASY = new Set(['/konto/zakup', '/konto/panel', '/konto/platnosc', '/konto/odstapienie']);
const HTML = 'text/html; charset=utf-8';

// Sesje zakupu: 10 na godzine na konto (ARCH8-19).
const LIMIT_SESJI = limity.utworz('platnosci-sesje', [{ nazwa: 'konto', klucz: (k) => k.login, ile: 10, oknoMs: limity.GODZINA }]);

// Stan procesu (jeden proces Node): ostatnia konfiguracja serwera, pamiec cen, zamki klientow, zegary.
const STAN = {
  KONF: null,
  poczta: null,
  ceny: new Map(),              // klucz konfiguracji -> { kwoty, bledy, niezgodne, zablokowane:Set, czas }
  zegary: [],
  ostrzezenia: new Set(),
  synchronizacjeWTle: new Map(),
  wysylane: new Set(),
  progiWysylane: new Set(),
};

/** Odmowa biznesowa: kod z bledy.KODY (rozdz. 5), pola dla aplikacji. */
class Odmowa extends Error {
  constructor(kod, pola = {}, status = null) {
    super(kod);
    this.name = 'Odmowa';
    this.kod = kod;
    this.pola = pola;
    this.status = status;
  }
}

function adapter(konf) {
  const d = konf && konf.platnosci && konf.platnosci.dostawca;
  if (!DOSTAWCY.includes(d)) throw new Error(`nieznany dostawca platnosci: ${d}`);
  return require(`./platnosci-${d}.js`);
}

function zapamietaj(kontekst) {
  if (kontekst && kontekst.KONF) STAN.KONF = kontekst.KONF;
  if (kontekst && kontekst.poczta) STAN.poczta = kontekst.poczta;
}

function poczta(kontekst) {
  return (kontekst && kontekst.poczta) || STAN.poczta || require('./poczta.js');
}

function czekaj(ms) { return new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); }); }

function jsonMeta(klucz) {
  try { return JSON.parse(magazyn.meta(klucz) || 'null'); } catch { return null; }
}

// ─── Czas w Polsce (kwartaly, terminy odstapienia, ewidencja) ────────────────

let FORMAT_WAW = null;
try {
  FORMAT_WAW = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
} catch { FORMAT_WAW = null; }

/** Czesci daty w strefie Europe/Warsaw (bez danych strefy: UTC+1). */
function czesciWarszawa(ms) {
  if (!FORMAT_WAW) {
    const d = new Date(ms + 3600_000);
    return { rok: d.getUTCFullYear(), miesiac: d.getUTCMonth() + 1, dzien: d.getUTCDate(), godzina: d.getUTCHours(), minuta: d.getUTCMinutes(), sekunda: d.getUTCSeconds() };
  }
  const p = {};
  for (const c of FORMAT_WAW.formatToParts(new Date(ms))) p[c.type] = c.value;
  return { rok: Number(p.year), miesiac: Number(p.month), dzien: Number(p.day), godzina: Number(p.hour) % 24, minuta: Number(p.minute), sekunda: Number(p.second) };
}

function przesuniecieWarszawy(ms) {
  const c = czesciWarszawa(ms);
  return Date.UTC(c.rok, c.miesiac - 1, c.dzien, c.godzina, c.minuta, c.sekunda) - Math.floor(ms / 1000) * 1000;
}

/** Chwila polnocy w Warszawie dla daty (miesiac 1-12; dzien i miesiac moga wyjsc poza zakres). */
function polnocWarszawy(rok, miesiac, dzien) {
  const naiwny = Date.UTC(rok, miesiac - 1, dzien);
  let t = naiwny - przesuniecieWarszawy(naiwny);
  t = naiwny - przesuniecieWarszawy(t);
  return t;
}

function dzienWarszawy(ms) {
  const c = czesciWarszawa(ms);
  return `${c.rok}-${String(c.miesiac).padStart(2, '0')}-${String(c.dzien).padStart(2, '0')}`;
}

/** Kwartal kalendarzowy (czas polski): { nazwa: '2026-Q4', od, do } (do wylacznie). */
function kwartal(ms) {
  const c = czesciWarszawa(ms);
  const n = Math.floor((c.miesiac - 1) / 3) + 1;
  return { nazwa: `${c.rok}-Q${n}`, od: polnocWarszawy(c.rok, (n - 1) * 3 + 1, 1), do: polnocWarszawy(c.rok, n * 3 + 1, 1), rok: c.rok };
}

/** 'RRRR-Qn' albo 'RRRR' (albo pusty = biezacy kwartal) -> { nazwa, od, do } albo null. */
function okresZNazwy(nazwa, teraz = Date.now()) {
  if (!nazwa) return kwartal(teraz);
  let m = /^(\d{4})-[Qq]([1-4])$/.exec(nazwa);
  if (m) {
    const rok = Number(m[1]);
    const n = Number(m[2]);
    return { nazwa: `${rok}-Q${n}`, od: polnocWarszawy(rok, (n - 1) * 3 + 1, 1), do: polnocWarszawy(rok, n * 3 + 1, 1), rok };
  }
  m = /^(\d{4})$/.exec(nazwa);
  if (m) {
    const rok = Number(m[1]);
    return { nazwa: String(rok), od: polnocWarszawy(rok, 1, 1), do: polnocWarszawy(rok + 1, 1, 1), rok };
  }
  return null;
}

/** Termin odstapienia (wylacznie): koniec 14. dnia po dniu zawarcia umowy, czas polski. */
function terminOdstapienia(zawarcie) {
  const c = czesciWarszawa(zawarcie);
  return polnocWarszawy(c.rok, c.miesiac, c.dzien + DNI_ODSTAPIENIA + 1);
}

// ─── Konfiguracja (wolana przy require server.js, bez sieci) ────────────────

/**
 * PLATNOSCI_CENY_WYSWIETLANE: "standard:eur=19,pln=79;premium:eur=49,pln=199" (kwoty z kropka dziesietna).
 * -> { kwoty: { standard: { eur: 1900, pln: 7900 } } } albo { blad }
 */
function parsujCenyWyswietlane(tekst) {
  const kwoty = {};
  for (const czesc of String(tekst || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9_-]+)\s*:\s*(.+)$/i.exec(czesc);
    if (!m || !plany.PLANY[m[1]]) return { blad: `nieznany pakiet "${m ? m[1] : czesc}"` };
    kwoty[m[1]] = {};
    for (const para of m[2].split(',').map((x) => x.trim()).filter(Boolean)) {
      const w = /^([a-z]{3})\s*=\s*(\d+(?:\.\d{1,2})?)$/i.exec(para);
      if (!w) return { blad: `zla kwota "${para}"` };
      kwoty[m[1]][w[1].toLowerCase()] = Math.round(Number(w[2]) * 100);
    }
  }
  return { kwoty };
}

function planyNaSprzedaz() {
  return plany.planyNaSprzedaz();
}

/**
 * Kontrola przy starcie (ARCH8-20): rdzen (metody, kraje, ceny wyswietlane) i adapter (klucz a tryb,
 * sekret webhooka, ceny dla walut). Komunikaty podaja nazwy zmiennych, nigdy wartosci.
 *   sprawdzKonfiguracje(konf) -> ['opis bledu z nazwa zmiennej', ...] (pusta = dobrze)
 */
function sprawdzKonfiguracje(konf) {
  if (konf) STAN.KONF = konf;
  const p = konf.platnosci;
  const bledy = [];
  const metody = p.metody || [];
  if (metody.some((m) => ['p24', 'przelewy24'].includes(m))) bledy.push('PLATNOSCI_METODY: Przelewy24 wymaga NIP i numeru rejestrowego (PR8-13)');
  else if (!metody.length || metody.some((m) => !METODY.has(m))) bledy.push(`PLATNOSCI_METODY: znane metody: ${[...METODY].join(', ')}`);
  if (!p.kraje.length || p.kraje.some((k) => !/^[A-Z]{2}$/.test(k))) bledy.push('PLATNOSCI_KRAJE: kody krajow ISO 3166-1 alfa-2 po przecinku, np. PL,DE,CZ');
  if (p.cenyWyswietlane) {
    const w = parsujCenyWyswietlane(p.cenyWyswietlane);
    if (w.blad) bledy.push(`PLATNOSCI_CENY_WYSWIETLANE: ${w.blad} (format standard:eur=19,pln=79;premium:eur=49,pln=199)`);
    else {
      for (const pl of planyNaSprzedaz()) {
        for (const waluta of p.waluty) {
          if (!w.kwoty[pl.plan] || w.kwoty[pl.plan][waluta] === undefined) bledy.push(`PLATNOSCI_CENY_WYSWIETLANE: brak kwoty ${pl.plan} ${waluta}`);
        }
      }
    }
  }
  if (!(Number(p.kursEurPln) > 0)) bledy.push('PLATNOSCI_KURS_EUR_PLN: liczba wieksza od zera');
  bledy.push(...adapter(konf).sprawdzKonfiguracje(konf, plany));
  return bledy;
}

function wlaczone(kontekst) {
  if (kontekst && typeof kontekst.funkcjaWlaczona === 'function') return kontekst.funkcjaWlaczona('platnosci');
  const konf = (kontekst && kontekst.KONF) || STAN.KONF;
  return Boolean(konf && konf.funkcje && konf.funkcje.platnosci && konf.funkcje.platnosci.wlaczona);
}

// ─── Ceny: do wyswietlenia z konfiguracji, sprawdzane u dostawcy (ARCH8-17) ──

function kluczCen(konf) {
  const st = konf.platnosci.stripe || {};
  return crypto.createHash('sha256').update(JSON.stringify([konf.platnosci.dostawca, konf.platnosci.tryb, st.urlApi, st.klucz, st.ceny,
    konf.platnosci.waluty, konf.platnosci.cenyWyswietlane])).digest('hex').slice(0, 24);
}

function cenyZPamieci(konf) {
  const c = STAN.ceny.get(kluczCen(konf));
  return c && Date.now() - c.czas < CO_6_GODZIN * 2 ? c : null;
}

/** Pobiera ceny u dostawcy i porownuje z kwotami do wyswietlenia. Blad sieci leci dalej. */
async function odswiezCeny(konf, { teraz = Date.now() } = {}) {
  const w = await adapter(konf).ceny({ konf, plany });
  const wysw = konf.platnosci.cenyWyswietlane ? parsujCenyWyswietlane(konf.platnosci.cenyWyswietlane).kwoty || {} : null;
  const niezgodne = [];
  const zablokowane = new Set();
  for (const b of w.bledy) {
    const m = /^([a-z0-9_-]+)\/([a-z]{3}):/.exec(b);
    if (m) zablokowane.add(`${m[1]}/${m[2]}`);
  }
  if (wysw) {
    for (const [plan, kw] of Object.entries(w.kwoty)) {
      for (const [waluta, kwota] of Object.entries(kw)) {
        const naEkranie = wysw[plan] && wysw[plan][waluta];
        if (naEkranie !== undefined && naEkranie !== kwota) {
          niezgodne.push(`${plan}/${waluta}: na ekranie ${naEkranie / 100}, u dostawcy ${kwota / 100}`);
          zablokowane.add(`${plan}/${waluta}`);
        }
      }
    }
  }
  const wpis = { kwoty: w.kwoty, bledy: w.bledy, niezgodne, zablokowane, czas: teraz };
  STAN.ceny.set(kluczCen(konf), wpis);
  if (w.bledy.length) console.error(`[platnosci] ceny u dostawcy: ${w.bledy.join('; ')}`);
  if (niezgodne.length) console.error(`[platnosci] PLATNOSCI_CENY_WYSWIETLANE niezgodne z cenami u dostawcy (sprzedaz tych pozycji wstrzymana): ${niezgodne.join('; ')}`);
  return wpis;
}

/** Kwoty do pokazania klientowi: z PLATNOSCI_CENY_WYSWIETLANE, a bez niej z pamieci cen dostawcy. */
function kwotyDoWyswietlenia(konf) {
  if (konf.platnosci.cenyWyswietlane) {
    const w = parsujCenyWyswietlane(konf.platnosci.cenyWyswietlane);
    if (!w.blad) return w.kwoty;
  }
  const c = cenyZPamieci(konf);
  return c ? c.kwoty : null;
}

/** Kwota zakupu pakietu w walucie (pobiera ceny, gdy nie ma ich jeszcze w pamieci). */
async function kwotaDlaZakupu(konf, plan, waluta) {
  let wysw = kwotyDoWyswietlenia(konf);
  if (!wysw || !wysw[plan] || wysw[plan][waluta] === undefined) {
    await odswiezCeny(konf);
    wysw = kwotyDoWyswietlenia(konf);
  }
  const kwota = wysw && wysw[plan] ? wysw[plan][waluta] : undefined;
  if (kwota === undefined) throw new Odmowa('plan-niedostepny', { plan, waluta });
  const c = cenyZPamieci(konf);
  if (c && c.zablokowane.has(`${plan}/${waluta}`)) throw new Odmowa('plan-niedostepny', { plan, waluta, powod: 'cena' });
  return kwota;
}

// ─── Konto a platnosci ───────────────────────────────────────────────────────

/** Identyfikator klienta konta u biezacego dostawcy w biezacym trybie albo null. */
function klientKonta(konto, konf) {
  const p = konf.platnosci;
  return konto && konto.platnik === p.dostawca && konto.platnikTryb === p.tryb && konto.platnikKlient ? konto.platnikKlient : null;
}

/** Zywa subskrypcja (nowej nie kupujemy, zmiana w panelu): probna, aktywna, zalegla, anulowana do konca okresu. */
function zywa(konto, konf, teraz = Date.now()) {
  if (!klientKonta(konto, konf)) return false;
  if (['probna', 'aktywna', 'zalegla'].includes(konto.subskrypcjaStan)) return true;
  return konto.subskrypcjaStan === 'anulowana' && Number(konto.okresDo) > teraz;
}

/** null albo kod odmowy: operator i konta zespolu (M-7) kupuja tylko przy PLATNOSCI_DLA_STARYCH=1. */
function zakazZakupu(konto, konf) {
  if (!konto || dzierzawy.operator(konto)) return 'zakup-niedozwolony';
  if (dzierzawy.idOrganizacji(konto) === dzierzawy.GLOWNA && !konf.platnosci.dlaStarych) return 'zakup-niedozwolony';
  return null;
}

/** Waluta zakupu: waluta klienta, ktory juz placil (Stripe nie laczy walut), potem wybrana, potem z jezyka. */
function walutaDla(konto, konf, jezyk, zadana) {
  const p = konf.platnosci;
  if (klientKonta(konto, konf) && konto.subskrypcjaWaluta && p.waluty.includes(konto.subskrypcjaWaluta)) {
    return { waluta: konto.subskrypcjaWaluta, wymuszona: true };
  }
  const z = String(zadana || '').toLowerCase();
  if (p.waluty.includes(z)) return { waluta: z, wymuszona: false };
  return { waluta: jezyk === 'pl' ? p.walutaPl : p.walutaDomyslna, wymuszona: false };
}

/**
 * Wiaze konto z klientem dostawcy. Konto z klientem z innego trybu (np. dane testowe) przepinamy.
 * -> 'ok' | 'konflikt' | 'brak-konta'
 */
function powiazKonto(konto, idKlienta, konf) {
  const p = konf.platnosci;
  const w = magazyn.powiazKlienta(konto.login, { platnik: p.dostawca, tryb: p.tryb, idKlienta });
  if (w !== 'konflikt') return w;
  const k = magazyn.konto(konto.login);
  if (k && k.platnikKlient && (k.platnikTryb !== p.tryb || k.platnik !== p.dostawca)) {
    magazyn.zmienKonto(k.login, {
      platnik: p.dostawca, platnikTryb: p.tryb, platnikKlient: idKlienta, platnikSubskrypcja: null, subskrypcjaStan: 'brak',
      subskrypcjaPlan: null, subskrypcjaWaluta: null, subskrypcjaSurowy: null, okresDo: null, zaleglaOd: null,
    });
    return 'ok';
  }
  console.error(`[platnosci] konflikt powiazania: konto ${konto.login} ma innego klienta albo klient nalezy do innego konta`);
  return 'konflikt';
}

// ─── Przychod i progi (PR8-09, PR8-10) ───────────────────────────────────────

function zaokraglij(x, miejsc = 2) { const m = 10 ** miejsc; return Math.round(x * m) / m; }

/**
 * Przychod w okresie [od, do): wplaty minus zwroty, per waluta i kraj, razem w PLN (EUR po
 * PLATNOSCI_KURS_EUR_PLN: przyblizenie do ostrzezen, nie ksiegowosc) i sprzedaz do innych
 * krajow UE niz Polska w EUR (prog 10 000 EUR).
 */
function przychodOkresu(konf, { od, do: doKiedy }) {
  const kurs = Number(konf.platnosci.kursEurPln) || 4.25;
  const sumy = magazyn.sumyPlatnosci({ tryb: konf.platnosci.tryb, od, do: doKiedy });
  const wgWalut = {};
  const wgKrajow = {};
  let razemPln = 0;
  let ueEur = 0;
  let wplat = 0;
  const inne = new Set();
  for (const w of sumy) {
    const netto = (Number(w.suma) - Number(w.zwroty)) / 100;
    wplat += Number(w.wplat) || 0;
    wgWalut[w.waluta] = zaokraglij((wgWalut[w.waluta] || 0) + netto);
    const kraj = w.kraj || '?';
    if (!wgKrajow[kraj]) wgKrajow[kraj] = {};
    wgKrajow[kraj][w.waluta] = zaokraglij((wgKrajow[kraj][w.waluta] || 0) + netto);
    let pln;
    let eur;
    if (w.waluta === 'pln') { pln = netto; eur = netto / kurs; } else if (w.waluta === 'eur') { pln = netto * kurs; eur = netto; } else { inne.add(w.waluta); continue; }
    razemPln += pln;
    if (w.kraj && w.kraj !== 'PL' && KRAJE_UE.has(w.kraj)) ueEur += eur;
  }
  return { wplat, wgWalut, wgKrajow, razemPln: zaokraglij(razemPln), ueEur: zaokraglij(ueEur), kurs, inneWaluty: [...inne] };
}

/** Stan progow teraz: kwartal (limit dzialalnosci nierejestrowanej) i rok (sprzedaz do UE). */
function stanProgow(konf, teraz = Date.now()) {
  const p = konf.platnosci;
  const kw = kwartal(teraz);
  const przychod = przychodOkresu(konf, kw);
  const limit = Number(p.progKwartalPln) || 0;
  const procent = limit > 0 ? zaokraglij((przychod.razemPln / limit) * 100, 1) : 0;
  const progi = [...new Set([...(p.progiOstrzezen || []), 100])].sort((a, b) => a - b);
  const osiagniete = progi.filter((x) => procent >= x);
  const rok = okresZNazwy(String(kw.rok));
  const roczny = przychodOkresu(konf, rok);
  const progUe = Number(p.progUeEur) || 10000;
  const ueProcent = zaokraglij((roczny.ueEur / progUe) * 100, 1);
  return {
    kwartal: kw.nazwa, od: kw.od, do: kw.do, przychodPln: przychod.razemPln, limitPln: limit, procent, progi, osiagniete,
    ostrzezenie: osiagniete.length ? osiagniete[osiagniete.length - 1] : null, wplat: przychod.wplat, wgWalut: przychod.wgWalut,
    wgKrajow: przychod.wgKrajow, kursEurPln: przychod.kurs, inneWaluty: przychod.inneWaluty,
    ue: { rok: String(kw.rok), przychodEur: roczny.ueEur, progEur: progUe, procent: ueProcent, osiagniete: [80, 100].filter((x) => ueProcent >= x) },
    wstrzymajPoProgu: Boolean(p.wstrzymajPoProgu),
    sprzedazWstrzymana: Boolean(p.wstrzymajPoProgu) && limit > 0 && przychod.razemPln >= limit,
  };
}

function kwotaWPln(kwota, waluta, konf) {
  const k = Number(kwota) / 100;
  if (waluta === 'pln') return k;
  if (waluta === 'eur') return k * (Number(konf.platnosci.kursEurPln) || 4.25);
  return k;
}

/** Wylacznik sprzedazy po progu: odmowa zakupu, ktory przekroczylby limit kwartalny. */
function wstrzymanieZakupu(konf, kwota, waluta, teraz = Date.now()) {
  const p = konf.platnosci;
  if (!p.wstrzymajPoProgu || !(Number(p.progKwartalPln) > 0)) return null;
  const st = stanProgow(konf, teraz);
  if (st.przychodPln + kwotaWPln(kwota, waluta, konf) > Number(p.progKwartalPln)) {
    return { powod: 'prog', kwartal: st.kwartal, procent: st.procent };
  }
  return null;
}

/** Ostrzezenia o progach: wpis w dzienniku i jeden e-mail do uslugodawcy na prog i okres. */
async function sprawdzProgi(konf, { teraz = Date.now(), kontekst = null } = {}) {
  const st = stanProgow(konf, teraz);
  const doWyslania = [];
  for (const p of st.osiagniete) doWyslania.push({ klucz: `prog:kwartal:${st.kwartal}:${p}`, rodzaj: 'kwartal', prog: p, okres: st.kwartal });
  for (const p of st.ue.osiagniete) doWyslania.push({ klucz: `prog:ue:${st.ue.rok}:${p}`, rodzaj: 'ue', prog: p, okres: st.ue.rok });
  for (const w of doWyslania) {
    if (magazyn.meta(w.klucz) || STAN.progiWysylane.has(w.klucz)) continue;
    STAN.progiWysylane.add(w.klucz);
    try {
      const opis = w.rodzaj === 'kwartal'
        ? `przychod w kwartale ${w.okres}: ${st.przychodPln.toFixed(2)} zl, ${st.procent}% limitu ${st.limitPln} zl (prog ${w.prog}%)`
        : `sprzedaz do innych krajow UE w roku ${w.okres}: ${st.ue.przychodEur.toFixed(2)} EUR, ${st.ue.procent}% progu ${st.ue.progEur} EUR (prog ${w.prog}%)`;
      console.warn(`[platnosci] PROG PRZYCHODU: ${opis}`);
      const adres = konf.uslugodawca && konf.uslugodawca.email;
      const dane = {
        rodzaj: w.rodzaj, prog: w.prog, okres: w.okres,
        przychod: w.rodzaj === 'kwartal' ? ekrany.kwotaTekst(Math.round(st.przychodPln * 100), 'pln', 'pl') : ekrany.kwotaTekst(Math.round(st.ue.przychodEur * 100), 'eur', 'pl'),
        limit: w.rodzaj === 'kwartal' ? ekrany.kwotaTekst(Math.round(st.limitPln * 100), 'pln', 'pl') : ekrany.kwotaTekst(Math.round(st.ue.progEur * 100), 'eur', 'pl'),
        procent: w.rodzaj === 'kwartal' ? st.procent : st.ue.procent,
        opis,
      };
      const wynik = adres ? await wyslijEmail(konf, { do: adres, szablon: 'prog-przychodu', jezyk: 'pl', dane }, kontekst) : { ok: false };
      // Prog w dzienniku jest zawsze; e-mail tylko raz (po udanej wysylce znacznik w meta).
      if (wynik.ok || !adres) magazyn.ustawMeta(w.klucz, String(teraz));
    } finally {
      STAN.progiWysylane.delete(w.klucz);
    }
  }
  return st;
}

// ─── E-mail ──────────────────────────────────────────────────────────────────

/** Wysylka przez kontrakt poczty (C). Szablonu jeszcze nie ma = ostrzezenie, bez wyjatku. */
async function wyslijEmail(konf, wiadomosc, kontekst) {
  let szablony = [];
  try { szablony = require('./poczta-szablony.js').SZABLONY || []; } catch { szablony = []; }
  if (!szablony.includes(wiadomosc.szablon)) {
    const o = `brak szablonu e-maila "${wiadomosc.szablon}" w poczta-szablony.js: wiadomosc nie wyslana`;
    if (!STAN.ostrzezenia.has(o)) { STAN.ostrzezenia.add(o); console.warn(`[platnosci] ${o}`); }
    return { ok: false, blad: 'brak-szablonu' };
  }
  try {
    return await poczta(kontekst).wyslij(wiadomosc, konf);
  } catch (e) {
    console.error(`[platnosci] e-mail ${wiadomosc.szablon}: ${e.message}`);
    return { ok: false, blad: e.message };
  }
}

// ─── Zamek per klient i synchronizacja (ARCH8-15) ────────────────────────────

const ZAMKI = new Map();

/** fn() po zakonczeniu poprzednich dla tego klucza (jeden proces Node). Zamek NIE jest wspolbiezny wewnatrz. */
function wZamku(klucz, fn) {
  const przed = ZAMKI.get(klucz) || Promise.resolve();
  const wynik = przed.catch(() => {}).then(fn);
  const ogon = wynik.catch(() => {});
  ZAMKI.set(klucz, ogon);
  ogon.then(() => { if (ZAMKI.get(klucz) === ogon) ZAMKI.delete(klucz); });
  return wynik;
}

/** Zapis wplaty z faktury do rejestru (tylko oplacone i niezerowe: okres probny to nie przychod). */
function zapiszWplate(konf, w, login) {
  if (!w || w.status !== 'paid' || !(Number(w.kwota) > 0)) return false;
  const p = konf.platnosci;
  const nowa = magazyn.dopiszPlatnosc({
    dostawca: p.dostawca, id: w.id, tryb: p.tryb, login: login || null, kwota: w.kwota, waluta: w.waluta, kraj: w.kraj,
    oplacono: w.oplacono, okresOd: w.okresOd, okresDo: w.okresDo, platnosc: w.idPlatnosci, subskrypcja: w.idSubskrypcji, plan: w.plan,
  });
  if (!nowa) magazyn.uzupelnijPlatnosc(p.dostawca, w.id, { login, kraj: w.kraj, platnosc: w.idPlatnosci, subskrypcja: w.idSubskrypcji, plan: w.plan });
  return nowa;
}

/** Synchronizacja BEZ zamka (wolajacy go trzyma). -> { login, stan } */
async function synchronizujBezZamka(konf, idKlienta, { login = null, teraz = Date.now(), importujWplaty = false } = {}) {
  const p = konf.platnosci;
  const a = adapter(konf);
  const st = await a.stanKlienta({ idKlienta, konf, plany });
  let konto = magazyn.kontoPoKliencie(p.dostawca, p.tryb, idKlienta);
  if (!konto && login) {
    const k = magazyn.konto(login);
    if (k && powiazKonto(k, idKlienta, konf) === 'ok') konto = magazyn.konto(login);
  }
  if (st.idSubskrypcji && st.od && !magazyn.meta(`platnosci:zawarcie:${st.idSubskrypcji}`)) {
    magazyn.ustawMeta(`platnosci:zawarcie:${st.idSubskrypcji}`, String(st.od));
  }
  if (!konto) return { login: null, stan: st };
  magazyn.zastosujStanSubskrypcji(konto.login, st, teraz);
  if (importujWplaty) {
    for (const w of await a.faktury({ idKlienta, konf, plany })) zapiszWplate(konf, w, konto.login);
  }
  return { login: konto.login, stan: st };
}

function synchronizujKlienta(konf, idKlienta, opcje = {}) {
  return wZamku(idKlienta, () => synchronizujBezZamka(konf, idKlienta, opcje));
}

/** Synchronizacja konta po loginie (CLI, powrot, zegar). -> { login, stan } albo null bez klienta. */
async function synchronizujKonto(konf, login, opcje = {}) {
  const konto = magazyn.konto(login);
  const idKlienta = klientKonta(konto, konf);
  if (!idKlienta) return null;
  return synchronizujKlienta(konf, idKlienta, { ...opcje, login });
}

/**
 * Uzgadnianie (zegar co 6 h, CLI platnosci-synchronizuj): konta z klientem w biezacym trybie,
 * zywe albo dawno nie uzgadniane, najwyzej `naSekunde` zapytan na sekunde; brakujace wplaty z API.
 */
async function uzgodnij(konf, { teraz = Date.now(), limit = 200, naSekunde = 3, login = null, loguj = null } = {}) {
  const konta = login ? [magazyn.konto(login)].filter(Boolean) : magazyn.kontaDoUzgodnienia(teraz, limit);
  const wynik = { kont: 0, zmienionych: 0, bledow: 0, stany: [] };
  for (const k of konta) {
    const idKlienta = klientKonta(k, konf);
    if (!idKlienta) continue;
    wynik.kont += 1;
    try {
      const w = await synchronizujKlienta(konf, idKlienta, { login: k.login, teraz, importujWplaty: true });
      if (w.stan.stan !== k.subskrypcjaStan) wynik.zmienionych += 1;
      wynik.stany.push({ login: k.login, przed: k.subskrypcjaStan, po: w.stan.stan, plan: w.stan.plan, okresDo: w.stan.okresDo });
      if (loguj) loguj(`${k.login}: ${k.subskrypcjaStan} -> ${w.stan.stan}${w.stan.plan ? ` (${w.stan.plan})` : ''}`);
    } catch (e) {
      wynik.bledow += 1;
      console.error(`[platnosci] uzgadnianie ${k.login}: ${e.message}`);
      if (loguj) loguj(`${k.login}: BLAD ${e.message}`);
    }
    if (naSekunde > 0) await czekaj(Math.ceil(1000 / naSekunde));
  }
  // Odstapienia przyjete, ale przerwane bledem dostawcy: dokonczenie (anulowanie i zwrot, te same klucze idempotencji).
  wynik.odstapien = 0;
  for (const o of magazyn.odstapieniaWStanie('blad', 20)) {
    if (login && o.login !== login) continue;
    const k = magazyn.konto(o.login);
    if (!k || !klientKonta(k, konf)) continue;
    try {
      await odstap({ konto: k, zrodlo: o.zrodlo, kontekst: { KONF: konf }, idOdstapienia: o.id });
      wynik.odstapien += 1;
      if (loguj) loguj(`${k.login}: odstapienie ${o.id} dokonczone`);
    } catch (e) {
      wynik.bledow += 1;
      if (loguj) loguj(`${k.login}: odstapienie ${o.id} nadal z bledem (${e.message})`);
    }
  }
  magazyn.ustawMeta('platnosci:ostatnie_uzgodnienie', String(Date.now()));
  await sprawdzProgi(konf, { teraz });
  if (wynik.kont) console.log(`[platnosci] uzgadnianie: ${wynik.kont} kont, zmienionych ${wynik.zmienionych}, bledow ${wynik.bledow}`);
  return wynik;
}

/** Konto "aktywna" z okresDo starszym niz 2 doby: zgubione zdarzenie; synchronizacja w tle (raz na 10 min). */
function synchronizacjaWTle(konto, konf) {
  if (!konto || konto.subskrypcjaStan !== 'aktywna' || !konto.okresDo || Number(konto.okresDo) > Date.now() - 2 * DOBA) return;
  if (!klientKonta(konto, konf)) return;
  const ostatnio = STAN.synchronizacjeWTle.get(konto.login) || 0;
  if (Date.now() - ostatnio < SYNCHRONIZACJA_W_TLE_CO_MS) return;
  STAN.synchronizacjeWTle.set(konto.login, Date.now());
  if (STAN.synchronizacjeWTle.size > 5000) STAN.synchronizacjeWTle.clear();
  synchronizujKonto(konf, konto.login).catch((e) => console.error(`[platnosci] synchronizacja w tle ${konto.login}: ${e.message}`));
}

// ─── Zakup, panel, powrot (ARCH8-19) ─────────────────────────────────────────

function tekstPrzyciskuCheckout(jezyk, kwota, waluta) {
  const cena = ekrany.kwotaTekst(kwota, waluta, jezyk);
  return jezyk === 'en'
    ? `By clicking the button you order a subscription with an obligation to pay ${cena} every month. Cancel any time in account settings.`
    : `Klikając przycisk, zamawiasz subskrypcję z obowiązkiem zapłaty ${cena} co miesiąc. Zrezygnujesz w każdej chwili w ustawieniach konta.`;
}

function wersjaRegulaminu(konf) {
  if (konf.regulaminWersja) return konf.regulaminWersja;
  try { return dokumenty.wersje().regulamin; } catch { return null; }
}

/**
 * Sesja zakupu dla konta. -> { url, idSesji, plan, waluta, kwota } albo throw Odmowa / BladDostawcy.
 * Kolejnosc kontroli jak w rozdz. 4.3: sprzedaz, prawo zakupu, pakiet, waluta, zywa subskrypcja,
 * zgoda, limit sesji, kwota, wylacznik po progu; zgody zapisane przed przekierowaniem (PR8-31).
 */
async function rozpocznijZakup({ konto, plan, waluta: zadana, jezyk = 'pl', z = 'app', zgodaNaWykonanie, zgodaRegulamin, ip = null, kontekst }) {
  const konf = kontekst.KONF;
  const p = konf.platnosci;
  const teraz = Date.now();
  if (!p.sprzedaz) throw new Odmowa('sprzedaz-wstrzymana', { powod: 'konfiguracja' });
  const zakaz = zakazZakupu(konto, konf);
  if (zakaz) throw new Odmowa(zakaz);
  const pl = plany.PLANY[plan];
  if (!pl || !pl.sprzedaz) throw new Odmowa('plan-niedostepny', { plan: plan || null, waluta: zadana || null });
  if (zadana && !p.waluty.includes(String(zadana).toLowerCase())) throw new Odmowa('plan-niedostepny', { plan, waluta: String(zadana) });
  const { waluta } = walutaDla(konto, konf, jezyk, zadana);
  if (zywa(konto, konf, teraz)) throw new Odmowa('subskrypcja-istnieje', { stan: konto.subskrypcjaStan, plan: konto.subskrypcjaPlan });
  if (zgodaNaWykonanie !== true) {
    throw new Odmowa('zgoda-wymagana', { zgoda: 'natychmiastowe-wykonanie', komunikat: jezyk === 'en'
      ? 'Request that the service begins immediately to buy a plan.' : 'Żeby kupić pakiet, zaznacz żądanie rozpoczęcia świadczenia przed upływem 14 dni.' });
  }
  const limit = LIMIT_SESJI.ocen({ login: konto.login });
  if (!limit.wolno) throw new Odmowa('za-duzo-prob', { ponowZa: limit.ponowZa });
  const kwota = await kwotaDlaZakupu(konf, plan, waluta);
  const wstrzymanie = wstrzymanieZakupu(konf, kwota, waluta, teraz);
  if (wstrzymanie) throw new Odmowa('sprzedaz-wstrzymana', wstrzymanie);

  const wersja = wersjaRegulaminu(konf);
  const ipZgody = konf.zgodyIp ? ip : null;
  const idZgody = magazyn.dopiszZgode({ login: konto.login, rodzaj: 'natychmiastowe-wykonanie', wersja, wartosc: true, zrodlo: 'zakup', ip: ipZgody, teraz });
  if (zgodaRegulamin === true) magazyn.dopiszZgode({ login: konto.login, rodzaj: 'regulamin', wersja, wartosc: true, zrodlo: 'zakup', ip: ipZgody, teraz });

  const a = adapter(konf);
  let idKlienta = klientKonta(konto, konf);
  if (!idKlienta) {
    idKlienta = await a.przygotujKlienta({ konto, jezyk, konf });
    if (powiazKonto(konto, idKlienta, konf) !== 'ok') throw new Odmowa('dostawca-platnosci-niedostepny', { powod: 'powiazanie' });
  }
  const adres = konf.adresPubliczny;
  const zz = z === 'konto' ? 'konto' : 'app';
  const { url, idSesji } = await a.rozpocznijZakup({
    konto, idKlienta, plan, waluta, jezyk,
    adresPowrotu: `${adres}/konto/platnosc?wynik=ok&sesja={CHECKOUT_SESSION_ID}&z=${zz}`,
    adresRezygnacji: `${adres}/konto/platnosc?wynik=anulowana&z=${zz}`,
    metadane: { zgoda: String(idZgody), regulamin: wersja || '' },
    tekstPrzycisku: tekstPrzyciskuCheckout(jezyk, kwota, waluta),
    konf,
  });
  console.log(`[platnosci] sesja zakupu ${plan}/${waluta} dla ${konto.login}`);
  return { url, idSesji, plan, waluta, kwota };
}

async function otworzPanel({ konto, jezyk = 'pl', z = 'app', kontekst }) {
  const konf = kontekst.KONF;
  const idKlienta = klientKonta(konto, konf);
  if (!idKlienta) throw new Odmowa('brak-subskrypcji');
  const adres = konf.adresPubliczny;
  return adapter(konf).otworzPanel({ idKlienta, jezyk, adresPowrotu: z === 'konto' ? `${adres}/konto` : `${adres}/?konto=1`, konf });
}

/** Wplaty jednej umowy z rejestru; brakujace (webhook jeszcze nie doszedl) dociagane z API. */
async function wplatyUmowy(konf, idKlienta, idSubskrypcji, login) {
  const d = konf.platnosci.dostawca;
  let wplaty = magazyn.wplatySubskrypcji(d, idSubskrypcji);
  if (!wplaty.length || wplaty.some((w) => !w.platnosc)) {
    for (const w of await adapter(konf).faktury({ idKlienta, konf, plany })) {
      if (w.idSubskrypcji === idSubskrypcji) zapiszWplate(konf, w, login);
    }
    wplaty = magazyn.wplatySubskrypcji(d, idSubskrypcji);
  }
  return wplaty;
}

/**
 * Zakup z adresem rozliczeniowym spoza PLATNOSCI_KRAJE (D-04, PR8-10): natychmiastowe anulowanie,
 * zwrot calosci i znacznik dla komunikatu w aplikacji. Idempotentne (webhook i powrot moga przyjsc razem).
 *   -> null (kraj z listy) albo { kraj, czas, sesja }
 */
async function sprawdzKraj(konf, login, sesja) {
  if (!sesja || !sesja.kraj || konf.platnosci.kraje.includes(sesja.kraj)) return null;
  const klucz = `platnosci:odrzucono:${login}`;
  const byl = jsonMeta(klucz);
  if (byl && byl.sesja === sesja.idSesji && byl.zakonczone) return byl;
  return wZamku(sesja.idKlienta, async () => {
    const teraz = jsonMeta(klucz);
    if (teraz && teraz.sesja === sesja.idSesji && teraz.zakonczone) return teraz;
    console.warn(`[platnosci] zakup z adresem spoza listy krajow (${sesja.kraj}) dla ${login}: anulowanie i zwrot calosci`);
    const a = adapter(konf);
    const d = konf.platnosci.dostawca;
    if (sesja.idSubskrypcji) await a.anulujSubskrypcje({ idSubskrypcji: sesja.idSubskrypcji, konf });
    const wplaty = sesja.idSubskrypcji ? await wplatyUmowy(konf, sesja.idKlienta, sesja.idSubskrypcji, login) : [];
    for (const w of wplaty) {
      const doZwrotu = Number(w.kwota) - Number(w.zwrot || 0);
      if (!(doZwrotu > 0) || !w.platnosc) continue;
      const r = await a.zwroc({ idPlatnosci: w.platnosc, kwota: doZwrotu, idempotencja: `kraj-${w.id}`, metadane: { powod: 'kraj', login, wplata: w.id }, konf });
      magazyn.dopiszZwrot({ dostawca: d, id: r.id, wplata: w.id, login, kwota: r.kwota, waluta: r.waluta || w.waluta, czas: r.czas || Date.now(), powod: 'kraj' });
    }
    const wynik = { kraj: sesja.kraj, czas: Date.now(), sesja: sesja.idSesji, zakonczone: true };
    magazyn.ustawMeta(klucz, JSON.stringify(wynik));
    await synchronizujBezZamka(konf, sesja.idKlienta, { login });
    return wynik;
  });
}

/** Potwierdzenie zawarcia umowy e-mailem (PR8-31): raz na sesje Checkout. */
async function potwierdzZakupEmailem(konf, login, sesja, kontekst) {
  const klucz = `platnosci:potwierdzenie:${sesja.idSesji}`;
  if (magazyn.meta(klucz) || STAN.wysylane.has(klucz)) return null;
  STAN.wysylane.add(klucz);
  try {
    const konto = magazyn.konto(login);
    if (!konto || !konto.email) return null;
    const jezyk = konto.jezyk === 'en' ? 'en' : 'pl';
    const wplaty = sesja.idSubskrypcji ? magazyn.wplatySubskrypcji(konf.platnosci.dostawca, sesja.idSubskrypcji) : [];
    const pierwsza = wplaty[0] || null;
    const zawarcie = (pierwsza && pierwsza.oplacono) || Number(magazyn.meta(`platnosci:zawarcie:${sesja.idSubskrypcji}`)) || Date.now();
    const zgoda = magazyn.zgody(login).filter((x) => x.rodzaj === 'natychmiastowe-wykonanie' && x.wartosc).pop() || null;
    const pakiet = plany.PLANY[konto.subskrypcjaPlan] || null;
    const wersja = wersjaRegulaminu(konf);
    const adresDok = (n) => { try { return dokumenty.adres(n, jezyk, konf.adresPubliczny); } catch { return ''; } };
    const zalaczniki = [];
    for (const n of ['regulamin', 'odstapienie']) {
      try {
        const r = dokumenty.renderuj({ nazwa: n, jezyk, konf, format: 'txt' });
        if (r.status === 200) zalaczniki.push({ nazwa: `content-ai-${n}-${jezyk}.txt`, typ: 'text/plain; charset=utf-8', tresc: r.tresc });
      } catch { /* bez zalacznika */ }
    }
    const dane = {
      pakiet: pakiet ? ekrany.nazwaPakietu(pakiet, jezyk) : konto.subskrypcjaPlan,
      kwota: pierwsza ? ekrany.kwotaTekst(pierwsza.kwota, pierwsza.waluta, jezyk) : '',
      waluta: konto.subskrypcjaWaluta || (pierwsza && pierwsza.waluta) || null,
      dataZawarcia: ekrany.dataTekst(zawarcie, jezyk, { godzina: true }),
      nastepnaPlatnosc: konto.okresDo ? ekrany.dataTekst(konto.okresDo, jezyk) : '',
      terminOdstapienia: ekrany.dataTekst(terminOdstapienia(zawarcie) - 1, jezyk),
      zadanieWykonania: zgoda ? ekrany.dataTekst(zgoda.czas, jezyk, { godzina: true }) : '',
      trybZwrotu: konf.platnosci.zwrot,
      regulaminWersja: wersja,
      adresRegulaminu: adresDok('regulamin'),
      adresOdstapienia: adresDok('odstapienie'),
      adresKonta: `${konf.adresPubliczny}/konto`,
      zalaczniki,
    };
    const w = await wyslijEmail(konf, { do: konto.email, szablon: 'zakup-potwierdzenie', jezyk, dane }, kontekst);
    if (w.ok) magazyn.ustawMeta(klucz, String(Date.now()));
    return w;
  } finally {
    STAN.wysylane.delete(klucz);
  }
}

/**
 * Powrot z Checkout: sesja nalezy do zalogowanego konta, synchronizacja bez czekania na webhook,
 * kraj z listy. -> 'ok' | 'oczekuje' | 'kraj' albo throw Odmowa (cudza sesja).
 */
async function powrotZCheckout({ konto, idSesji, kontekst }) {
  const konf = kontekst.KONF;
  const a = adapter(konf);
  const s = await a.potwierdzSesje({ idSesji, konf });
  if (!s.login || s.login !== konto.login) throw new Odmowa('zakup-niedozwolony', { powod: 'cudza-sesja' }, 403);
  if (s.tryb !== konf.platnosci.tryb) throw new Odmowa('zakup-niedozwolony', { powod: 'tryb' }, 403);
  if (s.idKlienta && !klientKonta(magazyn.konto(konto.login), konf) && powiazKonto(konto, s.idKlienta, konf) !== 'ok') {
    throw new Odmowa('zakup-niedozwolony', { powod: 'powiazanie' }, 403);
  }
  if (!s.zakonczona) return 'oczekuje';
  if (s.idKlienta) await synchronizujKlienta(konf, s.idKlienta, { login: konto.login });
  if (await sprawdzKraj(konf, konto.login, s)) return 'kraj';
  potwierdzZakupEmailem(konf, konto.login, s, kontekst).catch((e) => console.error(`[platnosci] potwierdzenie zakupu: ${e.message}`));
  const k = magazyn.konto(konto.login);
  return k && ['aktywna', 'probna'].includes(k.subskrypcjaStan) ? 'ok' : 'oczekuje';
}

// ─── Odstapienie w 14 dni (PR8-31, D-03) ─────────────────────────────────────

/**
 * Zwrot przy odstapieniu dla kazdej wplaty umowy. 'proporcjonalny': klient placi za rozpoczete doby
 * dostepu (ustawa o prawach konsumenta: kwota proporcjonalna do spelnionego swiadczenia), dostaje
 * reszte; 'pelny': cala wplata. -> [{ wplata, kwota, dniUzyte, dniOkresu }]
 */
function wyliczZwrot(wplaty, chwila, tryb) {
  return wplaty.filter((w) => Number(w.kwota) > 0).map((w) => {
    const juz = Number(w.zwrot) || 0;
    const od = Number(w.okresOd) || Number(w.oplacono);
    const doK = Number(w.okresDo) || od + 30 * DOBA;
    const dniOkresu = Math.max(1, Math.round((doK - od) / DOBA));
    const dniUzyte = Math.min(dniOkresu, Math.max(0, Math.ceil((chwila - od) / DOBA)));
    const naleznosc = tryb === 'pelny' ? 0 : Math.round((Number(w.kwota) * dniUzyte) / dniOkresu);
    return { wplata: w, kwota: Math.max(0, Number(w.kwota) - naleznosc - juz), dniUzyte, dniOkresu };
  });
}

function szacunekZwrotu(konf, konto, chwila = Date.now()) {
  const wplaty = magazyn.wplatySubskrypcji(konf.platnosci.dostawca, konto.platnikSubskrypcja);
  const tryb = konf.platnosci.zwrot;
  const pozycje = wyliczZwrot(wplaty, chwila, tryb);
  const kwota = pozycje.reduce((s, p) => s + p.kwota, 0);
  const pierwsza = pozycje[0];
  return {
    kwota, waluta: (wplaty[0] && wplaty[0].waluta) || konto.subskrypcjaWaluta || null, tryb,
    dniUzyte: pierwsza ? pierwsza.dniUzyte : 0, dniOkresu: pierwsza ? pierwsza.dniOkresu : 0, wplat: wplaty.length,
  };
}

/**
 * Czy konto moze teraz odstapic od umowy (biezacej subskrypcji).
 *   -> { mozliwe, powod?: 'brak-umowy'|'zlozone'|'po-terminie', zawarcie, termin (wylacznie), szacunek?, odstapienie?, ponowienie? }
 * Oswiadczenie w stanie 'blad' (dostawca nie odpowiedzial) mozna ponowic takze po terminie: zlozono je w terminie.
 */
function stanOdstapienia(konto, konf, teraz = Date.now()) {
  const idSub = konto && konto.platnikSubskrypcja;
  if (!konto || !klientKonta(konto, konf) || !idSub) return { mozliwe: false, powod: 'brak-umowy' };
  const zlozone = magazyn.odstapieniaKonta(konto.login).find((x) => x.subskrypcja === idSub) || null;
  if (zlozone && zlozone.stan !== 'blad') {
    return { mozliwe: false, powod: 'zlozone', zawarcie: zlozone.zawarcie, termin: zlozone.termin, odstapienie: zlozone };
  }
  if (!zlozone && ['brak', 'wygasla'].includes(konto.subskrypcjaStan)) return { mozliwe: false, powod: 'brak-umowy' };
  const pierwsza = magazyn.wplatySubskrypcji(konf.platnosci.dostawca, idSub)[0];
  const zawarcie = Number(magazyn.meta(`platnosci:zawarcie:${idSub}`)) || (pierwsza && pierwsza.oplacono) || (zlozone && zlozone.zawarcie) || null;
  if (!zawarcie) return { mozliwe: false, powod: 'brak-umowy' };
  const termin = terminOdstapienia(zawarcie);
  if (teraz >= termin && !zlozone) return { mozliwe: false, powod: 'po-terminie', zawarcie, termin };
  return { mozliwe: true, zawarcie, termin, szacunek: szacunekZwrotu(konf, konto, zlozone ? zlozone.zlozone : teraz), ponowienie: Boolean(zlozone) };
}

/**
 * Odstapienie od umowy: zapis oswiadczenia, natychmiastowe anulowanie u dostawcy, zwrot (D-03),
 * stan konta, e-mail z potwierdzeniem. Blad dostawcy: oswiadczenie zostaje (stan 'blad'), wyjatek
 * leci dalej (ponowienie: ten sam przycisk albo CLI zwrot).
 *   odstap({ konto, zrodlo, zlozone, kontekst, trybZwrotu, poTerminie }) -> { id, zlozone, kwota, waluta, ... }
 */
async function odstap({ konto, zrodlo = 'konto', zlozone = Date.now(), kontekst, trybZwrotu = null, poTerminie = false, idOdstapienia = null }) {
  const konf = kontekst.KONF;
  const p = konf.platnosci;
  const idKlienta = klientKonta(konto, konf);
  const ponawiane = idOdstapienia ? magazyn.odstapienie(idOdstapienia) : null;
  if (!idKlienta || (!konto.platnikSubskrypcja && !ponawiane)) throw new Odmowa('odstapienie-niedostepne', { powod: 'brak-umowy' });
  const a = adapter(konf);
  const wynik = await wZamku(idKlienta, async () => {
    // Dostawca nie odpowiada: oswiadczenie i tak zapisujemy (liczy sie chwila zlozenia), anulowanie ponizej zawiedzie.
    try {
      await synchronizujBezZamka(konf, idKlienta, { login: konto.login });
    } catch (e) {
      if (!(e instanceof a.BladDostawcy)) throw e;
      console.error(`[platnosci] odstapienie ${konto.login}: stan u dostawcy niedostepny (${e.message})`);
    }
    const k = magazyn.konto(konto.login);
    let id;
    let idSub;
    let chwila;
    let tryb;
    let ocena = {};
    const wczesniejsze = ponawiane
      || magazyn.odstapieniaKonta(k.login).find((x) => x.subskrypcja === k.platnikSubskrypcja && x.stan === 'blad') || null;
    if (wczesniejsze && wczesniejsze.stan !== 'blad') throw new Odmowa('odstapienie-niedostepne', { powod: 'zlozone', termin: wczesniejsze.termin || null });
    if (wczesniejsze) {
      ({ id, subskrypcja: idSub, zlozone: chwila } = wczesniejsze);
      tryb = wczesniejsze.trybZwrotu || trybZwrotu || p.zwrot;
      ocena = { zawarcie: wczesniejsze.zawarcie, termin: wczesniejsze.termin };
    } else {
      ocena = stanOdstapienia(k, konf, zlozone);
      if (!ocena.mozliwe && !(poTerminie && ocena.powod === 'po-terminie')) {
        throw new Odmowa('odstapienie-niedostepne', { powod: ocena.powod, termin: ocena.termin || null });
      }
      idSub = k.platnikSubskrypcja;
      chwila = zlozone;
      tryb = trybZwrotu || p.zwrot;
      id = magazyn.zapiszOdstapienie({
        login: k.login, dostawca: p.dostawca, subskrypcja: idSub, zlozone, zrodlo, zawarcie: ocena.zawarcie || null, termin: ocena.termin || null, trybZwrotu: tryb,
      });
    }
    let suma = 0;
    let waluta = k.subskrypcjaWaluta || null;
    let pozycje = [];
    try {
      await a.anulujSubskrypcje({ idSubskrypcji: idSub, konf });
      const wplaty = await wplatyUmowy(konf, idKlienta, idSub, k.login);
      pozycje = wyliczZwrot(wplaty, chwila, tryb);
      for (const poz of pozycje) {
        if (!(poz.kwota > 0)) continue;
        if (!poz.wplata.platnosc) throw new Error(`wplata ${poz.wplata.id} bez identyfikatora platnosci u dostawcy`);
        const r = await a.zwroc({
          idPlatnosci: poz.wplata.platnosc, kwota: poz.kwota, idempotencja: `odstapienie-${id}-${poz.wplata.id}`,
          metadane: { powod: 'odstapienie', login: k.login, wplata: poz.wplata.id, odstapienie: String(id) }, konf,
        });
        magazyn.dopiszZwrot({ dostawca: p.dostawca, id: r.id, wplata: poz.wplata.id, login: k.login, kwota: r.kwota, waluta: r.waluta || poz.wplata.waluta, czas: r.czas || Date.now(), powod: 'odstapienie' });
        waluta = r.waluta || poz.wplata.waluta;
      }
      // lacznie ze zwrotami z poprzedniej, przerwanej proby (ten sam klucz idempotencji u dostawcy)
      suma = wplaty.reduce((x, w) => x + magazyn.zwrotyWplaty(p.dostawca, w.id).filter((z) => z.powod === 'odstapienie').reduce((y, z) => y + Number(z.kwota), 0), 0);
      magazyn.zmienOdstapienie(id, {
        stan: suma > 0 ? 'zwrot-zlecony' : 'bez-zwrotu', kwotaZwrotu: suma, waluta, blad: null, zakonczone: Date.now(),
        dniUzyte: pozycje[0] ? pozycje[0].dniUzyte : null, dniOkresu: pozycje[0] ? pozycje[0].dniOkresu : null,
      });
    } catch (e) {
      magazyn.zmienOdstapienie(id, { stan: 'blad', blad: String(e.message || e).slice(0, 300) });
      console.error(`[platnosci] odstapienie ${id} (${k.login}): ${e.message}`);
      throw e;
    }
    try {
      await synchronizujBezZamka(konf, idKlienta, { login: k.login });
    } catch (e) {
      // anulowanie i zwrot zlecone; stan konta dogoni webhook albo uzgadnianie
      console.error(`[platnosci] odstapienie ${id}: synchronizacja po zwrocie: ${e.message}`);
    }
    console.log(`[platnosci] odstapienie ${id} (${k.login}, ${zrodlo}): zwrot ${suma} ${waluta || ''} (${tryb})`);
    return {
      id, zlozone: chwila, kwota: suma, waluta, tryb, plan: k.subskrypcjaPlan, email: k.email, jezyk: k.jezyk,
      dniUzyte: pozycje[0] ? pozycje[0].dniUzyte : 0, dniOkresu: pozycje[0] ? pozycje[0].dniOkresu : 0,
      terminZwrotu: chwila + DNI_ODSTAPIENIA * DOBA, zawarcie: magazyn.odstapienie(id).zawarcie,
    };
  });
  // Potwierdzenie na trwalym nosniku (e-mail) i progi (zwrot zmniejsza przychod).
  if (wynik.email) {
    const j = wynik.jezyk === 'en' ? 'en' : 'pl';
    const pakiet = plany.PLANY[wynik.plan];
    const potracenie = wynik.tryb === 'pelny' ? null : `${wynik.dniUzyte}/${wynik.dniOkresu}`;
    wyslijEmail(konf, {
      do: wynik.email, szablon: 'odstapienie-potwierdzenie', jezyk: j,
      dane: {
        pakiet: pakiet ? ekrany.nazwaPakietu(pakiet, j) : wynik.plan, dataZawarcia: ekrany.dataTekst(wynik.zawarcie, j),
        zlozone: ekrany.dataTekst(wynik.zlozone, j, { godzina: true }), kwotaZwrotu: ekrany.kwotaTekst(wynik.kwota, wynik.waluta, j),
        waluta: wynik.waluta, terminZwrotu: ekrany.dataTekst(wynik.terminZwrotu, j), dniUzyte: wynik.dniUzyte, dniOkresu: wynik.dniOkresu,
        potracenie, trybZwrotu: wynik.tryb, adresKonta: `${konf.adresPubliczny}/konto`,
      },
    }, kontekst).catch(() => {});
  }
  sprawdzProgi(konf).catch(() => {});
  return wynik;
}

// ─── Trasy (z sesja) ─────────────────────────────────────────────────────────

function ustawCsp(res, konf) {
  const obecna = res.getHeader('Content-Security-Policy');
  if (!obecna) return;
  let hosty = [];
  try { hosty = adapter(konf).hostyPrzekierowan(konf); } catch { hosty = []; }
  res.setHeader('Content-Security-Policy', ekrany.cspPlatnosci(String(obecna), hosty));
}

/**
 * CSP z hostami dostawcy w form-action dla ekranu z formularzem platnosci (np. /konto A1 z sekcjaKonta):
 * przegladarki stosuja form-action do przekierowania 303 po formularzu.
 */
function cspEkranu(res, kontekst) {
  const konf = (kontekst && kontekst.KONF) || STAN.KONF;
  if (konf && wlaczone(kontekst)) ustawCsp(res, konf);
}

function jezykZ(kontekst, req, dane) {
  if (dane && (dane.jezyk === 'en' || dane.jezyk === 'pl')) return dane.jezyk;
  if (kontekst.url && ['pl', 'en'].includes(kontekst.url.searchParams.get('lang'))) return kontekst.url.searchParams.get('lang');
  return kontekst.jezyk || 'pl';
}

function zParam(v) { return v === 'konto' ? 'konto' : 'app'; }

function adresyDokumentow(konf, jezyk) {
  const a = (n) => { try { return dokumenty.adres(n, jezyk); } catch { return `/dokumenty/${n}`; } };
  return { regulamin: a('regulamin'), odstapienie: a('odstapienie') };
}

function wyslijHtml(kontekst, res, status, html, kod) {
  if (kod) res.setHeader('X-CAI-Kod', kod);
  kontekst.odpowiedzTekst(res, status, html, HTML);
}

function tekstOdmowy(odmowa, jezyk) {
  const t = ekrany.teksty(jezyk);
  switch (odmowa.kod) {
    case 'zakup-niedozwolony': return odmowa.pola.powod === 'cudza-sesja' ? t.obcaPlatnosc : t.zakupNiedozwolony;
    case 'sprzedaz-wstrzymana': return t.sprzedazWstrzymana;
    case 'plan-niedostepny': return t.planNiedostepny;
    case 'za-duzo-prob': return ekrany.wstaw(t.zaDuzoProb, { min: Math.max(1, Math.ceil((odmowa.pola.ponowZa || 60) / 60)) });
    case 'dostawca-platnosci-niedostepny': return t.dostawcaNiedostepny;
    case 'platnosci-wylaczone': return t.platnosciWylaczone;
    case 'zgoda-wymagana': return t.bladZgody;
    case 'brak-subskrypcji': return t.odstBrak;
    case 'odstapienie-niedostepne': return odmowa.pola.powod === 'po-terminie' ? ekrany.wstaw(t.odstPoTerminie, { data: ekrany.dataTekst((odmowa.pola.termin || 1) - 1, jezyk) }) : t.odstBrak;
    default: return t.dostawcaNiedostepny;
  }
}

/** Odmowa albo blad dostawcy na ekranie HTML. */
function ekranBledu(kontekst, res, e, jezyk, z) {
  const konf = kontekst.KONF;
  const t = ekrany.teksty(jezyk);
  const odmowa = e instanceof Odmowa ? e : new Odmowa('dostawca-platnosci-niedostepny');
  if (!(e instanceof Odmowa)) console.error(`[platnosci] ${e.message}`);
  const status = odmowa.status || (bledyKodow()[odmowa.kod] || {}).status || 503;
  const przyciski = [];
  if (odmowa.kod === 'subskrypcja-istnieje' || (odmowa.kod === 'odstapienie-niedostepne' && odmowa.pola.powod === 'po-terminie')) {
    przyciski.push({ rodzaj: 'formularz', adres: '/konto/panel', pola: { z }, tekst: t.panel, id: 'panel-subskrypcji' });
  }
  const tytul = odmowa.kod === 'subskrypcja-istnieje' ? t.subskrypcjaIstniejeTytul
    : (odmowa.kod === 'odstapienie-niedostepne' ? t.odstNiemozliweTytul : t.niedostepnyTytul);
  const opis = odmowa.kod === 'subskrypcja-istnieje'
    ? ekrany.wstaw(t.subskrypcjaIstnieje, { pakiet: ekrany.nazwaPakietu(plany.PLANY[odmowa.pola.plan], jezyk) || odmowa.pola.plan || '' })
    : tekstOdmowy(odmowa, jezyk);
  ustawCsp(res, konf);
  wyslijHtml(kontekst, res, status, ekrany.ekranKomunikatu({ jezyk, tytul, opis, przyciski, tryb: konf.platnosci.tryb, uslugodawca: konf.uslugodawca, z }), odmowa.kod);
}

function bledyKodow() {
  try { return require('./bledy.js').KODY; } catch { return {}; }
}

/** Odmowa albo blad dostawcy jako JSON (kod z rozdz. 5). */
function bladJson(kontekst, res, e) {
  if (e instanceof Odmowa) return kontekst.bladCai(res, e.kod, e.status || undefined, e.pola);
  const a = (() => { try { return adapter(kontekst.KONF); } catch { return null; } })();
  if (a && e instanceof a.BladDostawcy) {
    console.error(`[platnosci] ${e.message}`);
    return kontekst.bladCai(res, 'dostawca-platnosci-niedostepny', 503);
  }
  throw e;
}

function ekranZakupuDlaKonta(kontekst, res, { konto, plan, waluta: zadana, z, jezyk, blad = '', status = 200 }) {
  const konf = kontekst.KONF;
  const p = konf.platnosci;
  const naSprzedaz = planyNaSprzedaz();
  const wybrany = naSprzedaz.find((x) => x.plan === plan) || naSprzedaz[0];
  const { waluta, wymuszona } = walutaDla(konto, konf, jezyk, zadana);
  const kwoty = kwotyDoWyswietlenia(konf) || {};
  const kwota = wybrany && kwoty[wybrany.plan] ? kwoty[wybrany.plan][waluta] : undefined;
  if (!wybrany || kwota === undefined) throw new Odmowa('plan-niedostepny', { plan: plan || null, waluta });
  const inne = naSprzedaz.filter((x) => x.plan !== wybrany.plan).map((x) => ({ plan: x.plan, nazwa: ekrany.nazwaPakietu(x, jezyk) }));
  ustawCsp(res, konf);
  wyslijHtml(kontekst, res, status, ekrany.ekranZakupu({
    jezyk, plan: wybrany.plan, pakiet: wybrany, waluta, waluty: p.waluty, wymuszona, kwota, inne, uslugodawca: konf.uslugodawca,
    tryb: p.tryb, z, blad, zwrot: p.zwrot, adresy: adresyDokumentow(konf, jezyk),
  }), blad ? 'zgoda-wymagana' : null);
}

async function obsluzZakupEkran(sciezka, req, res, kontekst) {
  const konf = kontekst.KONF;
  const konto = kontekst.konto;
  if (req.method === 'GET' || req.method === 'HEAD') {
    const u = kontekst.url.searchParams;
    const jezyk = jezykZ(kontekst, req);
    const z = zParam(u.get('z'));
    try {
      if (!konf.platnosci.sprzedaz) throw new Odmowa('sprzedaz-wstrzymana');
      const zakaz = zakazZakupu(konto, konf);
      if (zakaz) throw new Odmowa(zakaz);
      if (zywa(konto, konf)) throw new Odmowa('subskrypcja-istnieje', { plan: konto.subskrypcjaPlan });
      if (!kwotyDoWyswietlenia(konf)) await odswiezCeny(konf);
      ekranZakupuDlaKonta(kontekst, res, { konto, plan: u.get('plan'), waluta: u.get('waluta'), z, jezyk });
    } catch (e) {
      ekranBledu(kontekst, res, e, jezyk, z);
    }
    return true;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    kontekst.odpowiedzTekst(res, 405, 'Metoda niedozwolona');
    return true;
  }
  const dane = Object.fromEntries(new URLSearchParams((await kontekst.czytajCialo(req, 8192)).toString('utf8')));
  const jezyk = jezykZ(kontekst, req, dane);
  const z = zParam(dane.z);
  if (dane.zgoda_regulamin !== '1' || dane.zgoda_wykonanie !== '1') {
    try {
      ekranZakupuDlaKonta(kontekst, res, { konto, plan: dane.plan, waluta: dane.waluta, z, jezyk, blad: ekrany.teksty(jezyk).bladZgody, status: 400 });
    } catch (e) {
      ekranBledu(kontekst, res, e, jezyk, z);
    }
    return true;
  }
  try {
    const w = await rozpocznijZakup({
      konto, plan: dane.plan, waluta: dane.waluta, jezyk, z, zgodaNaWykonanie: true, zgodaRegulamin: true, ip: kontekst.adresIp(req), kontekst,
    });
    ustawCsp(res, konf);
    res.writeHead(303, { Location: w.url, 'Cache-Control': 'no-store' });
    res.end();
  } catch (e) {
    ekranBledu(kontekst, res, e, jezyk, z);
  }
  return true;
}

async function obsluzPanelEkran(req, res, kontekst) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    kontekst.odpowiedzTekst(res, 405, 'Metoda niedozwolona');
    return true;
  }
  const dane = Object.fromEntries(new URLSearchParams((await kontekst.czytajCialo(req, 4096)).toString('utf8')));
  const jezyk = jezykZ(kontekst, req, dane);
  const z = zParam(dane.z);
  try {
    const w = await otworzPanel({ konto: kontekst.konto, jezyk, z, kontekst });
    ustawCsp(res, kontekst.KONF);
    res.writeHead(303, { Location: w.url, 'Cache-Control': 'no-store' });
    res.end();
  } catch (e) {
    if (e instanceof Odmowa && e.kod === 'brak-subskrypcji') {
      // bez klienta platnosci: panel nie ma czego pokazac, wiec ekran zakupu
      res.writeHead(303, { Location: `/konto/zakup?z=${z}&lang=${jezyk}` });
      res.end();
      return true;
    }
    ekranBledu(kontekst, res, e, jezyk, z);
  }
  return true;
}

async function obsluzPowrot(req, res, kontekst) {
  const u = kontekst.url.searchParams;
  const z = zParam(u.get('z'));
  const baza = z === 'konto' ? '/konto' : '/';
  const jezyk = jezykZ(kontekst, req);
  const idz = (wynik) => {
    res.writeHead(303, { Location: `${baza}?platnosc=${wynik}`, 'Cache-Control': 'no-store' });
    res.end();
  };
  if (u.get('wynik') !== 'ok') { idz('anulowana'); return true; }
  const idSesji = String(u.get('sesja') || '');
  if (!/^cs_[A-Za-z0-9_]{8,250}$/.test(idSesji)) { idz('anulowana'); return true; }
  try {
    idz(await powrotZCheckout({ konto: kontekst.konto, idSesji, kontekst }));
  } catch (e) {
    if (e instanceof Odmowa) { ekranBledu(kontekst, res, e, jezyk, z); return true; }
    // dostawca nie odpowiada: webhook dokonczy, aplikacja pokaze "czekamy na potwierdzenie"
    console.error(`[platnosci] powrot z Checkout: ${e.message}`);
    idz('oczekuje');
  }
  return true;
}

async function obsluzOdstapienieEkran(req, res, kontekst) {
  const konf = kontekst.KONF;
  const konto = kontekst.konto;
  const t = (j) => ekrany.teksty(j);
  if (req.method === 'GET' || req.method === 'HEAD') {
    const jezyk = jezykZ(kontekst, req);
    const z = zParam(kontekst.url.searchParams.get('z'));
    const ocena = stanOdstapienia(konto, konf);
    if (!ocena.mozliwe) {
      const opis = ocena.powod === 'po-terminie' ? ekrany.wstaw(t(jezyk).odstPoTerminie, { data: ekrany.dataTekst(ocena.termin - 1, jezyk) })
        : ocena.powod === 'zlozone' ? ekrany.wstaw(t(jezyk).odstZlozone, { data: ekrany.dataTekst(ocena.odstapienie.zlozone, jezyk, { godzina: true }) })
          : t(jezyk).odstBrak;
      const przyciski = ocena.powod === 'po-terminie' ? [{ rodzaj: 'formularz', adres: '/konto/panel', pola: { z }, tekst: t(jezyk).panel, id: 'panel-subskrypcji' }] : [];
      ustawCsp(res, konf);
      wyslijHtml(kontekst, res, ocena.powod === 'brak-umowy' ? 409 : 200, ekrany.ekranKomunikatu({
        jezyk, tytul: t(jezyk).odstNiemozliweTytul, opis, przyciski, tryb: konf.platnosci.tryb, uslugodawca: konf.uslugodawca, z,
      }), ocena.powod === 'brak-umowy' || ocena.powod === 'po-terminie' ? 'odstapienie-niedostepne' : null);
      return true;
    }
    wyslijHtml(kontekst, res, 200, ekrany.ekranOdstapienia({
      jezyk, pakiet: plany.PLANY[konto.subskrypcjaPlan] || { nazwa: konto.subskrypcjaPlan || '', nazwaEn: konto.subskrypcjaPlan || '' },
      email: konto.email || '', zawarcie: ocena.zawarcie, termin: ocena.termin, szacunek: ocena.szacunek, tryb: konf.platnosci.tryb,
      uslugodawca: konf.uslugodawca, z,
    }));
    return true;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    kontekst.odpowiedzTekst(res, 405, 'Metoda niedozwolona');
    return true;
  }
  const dane = Object.fromEntries(new URLSearchParams((await kontekst.czytajCialo(req, 4096)).toString('utf8')));
  const jezyk = jezykZ(kontekst, req, dane);
  const z = zParam(dane.z);
  if (dane.potwierdzam !== '1') {
    res.writeHead(303, { Location: `/konto/odstapienie?z=${z}&lang=${jezyk}` });
    res.end();
    return true;
  }
  try {
    const w = await odstap({ konto, zrodlo: 'konto', kontekst });
    const pakiet = plany.PLANY[w.plan];
    const opis = ekrany.wstaw(t(jezyk).odstWynik, { pakiet: ekrany.nazwaPakietu(pakiet, jezyk) || w.plan || '', data: ekrany.dataTekst(w.zlozone, jezyk, { godzina: true }) });
    const dodatkowe = [w.kwota > 0
      ? ekrany.wstaw(t(jezyk).odstWynikZwrot, { kwota: ekrany.kwotaTekst(w.kwota, w.waluta, jezyk), termin: ekrany.dataTekst(w.terminZwrotu, jezyk) })
      : t(jezyk).odstWynikBezZwrotu];
    wyslijHtml(kontekst, res, 200, ekrany.ekranKomunikatu({
      jezyk, tytul: t(jezyk).odstWynikNaglowek, opis, dodatkowe, info: true, tryb: konf.platnosci.tryb, uslugodawca: konf.uslugodawca, z,
    }));
  } catch (e) {
    if (e instanceof Odmowa) { ekranBledu(kontekst, res, e, jezyk, z); return true; }
    console.error(`[platnosci] odstapienie: ${e.message}`);
    wyslijHtml(kontekst, res, 503, ekrany.ekranKomunikatu({
      jezyk, tytul: t(jezyk).odstNaglowek, opis: t(jezyk).odstBlad, tryb: konf.platnosci.tryb, uslugodawca: konf.uslugodawca, z,
    }), 'dostawca-platnosci-niedostepny');
  }
  return true;
}

async function cialoApi(req, kontekst, limit = 8192) {
  try {
    return await kontekst.cialoJson(req, limit);
  } catch (e) {
    const err = new Odmowa('plan-niedostepny', { error: e.message }, e.status || 400);
    err.zleCialo = true;
    throw err;
  }
}

async function obsluzApi(sciezka, req, res, kontekst) {
  const konto = kontekst.konto;
  const jezyk = kontekst.jezyk || 'pl';
  try {
    if (sciezka === '/api/platnosci/stan' && req.method === 'GET') {
      kontekst.odpowiedzJson(res, 200, stanDlaKonta(konto, kontekst));
      return true;
    }
    if (sciezka === '/api/platnosci/zakup' && req.method === 'POST') {
      const d = await cialoApi(req, kontekst);
      const w = await rozpocznijZakup({
        konto, plan: d.plan, waluta: d.waluta, jezyk: d.jezyk === 'en' || d.jezyk === 'pl' ? d.jezyk : jezyk, z: d.z,
        zgodaNaWykonanie: d.zgodaNaWykonanie, zgodaRegulamin: d.zgodaRegulamin, ip: kontekst.adresIp(req), kontekst,
      });
      kontekst.odpowiedzJson(res, 200, { url: w.url, plan: w.plan, waluta: w.waluta, kwota: w.kwota });
      return true;
    }
    if (sciezka === '/api/platnosci/panel' && req.method === 'POST') {
      const d = await cialoApi(req, kontekst, 4096).catch(() => ({}));
      const w = await otworzPanel({ konto, jezyk: d && (d.jezyk === 'en' || d.jezyk === 'pl') ? d.jezyk : jezyk, z: d && d.z, kontekst });
      kontekst.odpowiedzJson(res, 200, { url: w.url });
      return true;
    }
    if (sciezka === '/api/platnosci/odstapienie' && req.method === 'GET') {
      const o = stanOdstapienia(konto, kontekst.KONF);
      kontekst.odpowiedzJson(res, 200, {
        mozliwe: o.mozliwe, powod: o.powod || null, zawarcie: o.zawarcie || null, termin: o.termin ? o.termin - 1 : null,
        szacunek: o.szacunek || null, plan: konto.subskrypcjaPlan || null,
      });
      return true;
    }
    if (sciezka === '/api/platnosci/odstapienie' && req.method === 'POST') {
      const d = await cialoApi(req, kontekst, 4096);
      if (d.potwierdzam !== true) throw new Odmowa('zgoda-wymagana', { zgoda: 'odstapienie', komunikat: 'Potwierdź odstąpienie od umowy (potwierdzam: true).' });
      const w = await odstap({ konto, zrodlo: 'aplikacja', kontekst });
      kontekst.odpowiedzJson(res, 200, {
        ok: true,
        odstapienie: { id: w.id, zlozone: w.zlozone, zwrot: { kwota: w.kwota, waluta: w.waluta, tryb: w.tryb, dniUzyte: w.dniUzyte, dniOkresu: w.dniOkresu, najpozniej: w.terminZwrotu } },
      });
      return true;
    }
  } catch (e) {
    if (e instanceof Odmowa && e.zleCialo) { kontekst.odpowiedzJson(res, e.status, { error: e.pola.error }); return true; }
    bladJson(kontekst, res, e);
    return true;
  }
  kontekst.bladCai(res, 'platnosci-wylaczone', 404, { error: 'Nieznana trasa platnosci' });
  return true;
}

/** Trasy zakupu, panelu, powrotu i odstapienia (z sesja). Pierwszy modul routera: dla innych sciezek false. */
async function obsluz(sciezka, req, res, kontekst) {
  zapamietaj(kontekst);
  const moje = TRASY.has(sciezka) || sciezka.startsWith('/api/platnosci/');
  if (!wlaczone(kontekst)) {
    if (!moje) return false;
    if (sciezka.startsWith('/api/')) kontekst.bladCai(res, 'platnosci-wylaczone', 404);
    else {
      req.resume();
      const jezyk = jezykZ(kontekst, req);
      res.setHeader('X-CAI-Kod', 'platnosci-wylaczone');
      kontekst.odpowiedzTekst(res, 404, ekrany.ekranKomunikatu({ jezyk, tytul: ekrany.teksty(jezyk).niedostepnyTytul, opis: ekrany.teksty(jezyk).platnosciWylaczone }), HTML);
    }
    return true;
  }
  if (kontekst.konto) synchronizacjaWTle(kontekst.konto, kontekst.KONF);
  if (!moje) return false;
  if (sciezka.startsWith('/api/platnosci/')) return obsluzApi(sciezka, req, res, kontekst);
  if (sciezka === '/konto/zakup') return obsluzZakupEkran(sciezka, req, res, kontekst);
  if (sciezka === '/konto/panel') return obsluzPanelEkran(req, res, kontekst);
  if (sciezka === '/konto/platnosc') return obsluzPowrot(req, res, kontekst);
  return obsluzOdstapienieEkran(req, res, kontekst);
}

// ─── Webhook (ARCH8-15) ──────────────────────────────────────────────────────

async function przetworzZdarzenie(konf, r, kontekst) {
  const p = konf.platnosci;
  const a = adapter(konf);
  switch (r.typ) {
    case 'checkout.session.completed': {
      if (!r.idKlienta || !r.idSesji) return { wynik: 'ignorowane' };
      let konto = r.login ? magazyn.konto(r.login) : null;
      if (!konto) konto = magazyn.kontoPoKliencie(p.dostawca, p.tryb, r.idKlienta);
      if (!konto) return { wynik: 'bez-konta' };
      if (powiazKonto(konto, r.idKlienta, konf) === 'konflikt') return { wynik: 'konflikt', login: konto.login };
      const s = await a.potwierdzSesje({ idSesji: r.idSesji, konf });
      await synchronizujKlienta(konf, r.idKlienta, { login: konto.login });
      if (await sprawdzKraj(konf, konto.login, s)) return { wynik: 'kraj', login: konto.login };
      if (s.zakonczona) await potwierdzZakupEmailem(konf, konto.login, s, kontekst);
      return { wynik: 'ok', login: konto.login };
    }
    case 'invoice.paid': {
      if (!r.idFaktury) return { wynik: 'ignorowane' };
      const w = await a.faktura({ idFaktury: r.idFaktury, konf, plany });
      let konto = w.idKlienta ? magazyn.kontoPoKliencie(p.dostawca, p.tryb, w.idKlienta) : null;
      if (!konto && r.login) konto = magazyn.konto(r.login);
      zapiszWplate(konf, w, konto ? konto.login : null);
      if (w.idKlienta) await synchronizujKlienta(konf, w.idKlienta, { login: konto ? konto.login : null });
      await sprawdzProgi(konf, { kontekst });
      return { wynik: konto ? 'ok' : 'bez-konta', login: konto ? konto.login : null };
    }
    case 'charge.refunded': {
      if (!r.idObciazenia) return { wynik: 'ignorowane' };
      const z = await a.zwrotyObciazenia({ idObciazenia: r.idObciazenia, konf });
      const wpl = magazyn.wplataPoPlatnosci(p.dostawca, z.idPlatnosci) || magazyn.wplataPoPlatnosci(p.dostawca, z.idObciazenia);
      if (!wpl) return { wynik: 'bez-wplaty' };
      for (const x of z.zwroty) {
        magazyn.dopiszZwrot({ dostawca: p.dostawca, id: x.id, wplata: wpl.id, login: wpl.login, kwota: x.kwota, waluta: x.waluta || wpl.waluta, czas: x.czas || Date.now(), powod: x.powod || 'panel' });
      }
      if (z.zwroconoLacznie > (magazyn.wplata(p.dostawca, wpl.id) || {}).zwrot) magazyn.ustawZwrot(p.dostawca, wpl.id, z.zwroconoLacznie);
      return { wynik: 'ok', login: wpl.login };
    }
    default: {
      if (!r.idKlienta) return { wynik: 'ignorowane' };
      const w = await synchronizujKlienta(konf, r.idKlienta, { login: r.login });
      return { wynik: w.login ? 'ok' : 'bez-konta', login: w.login };
    }
  }
}

/** POST /platnosci/webhook/<dostawca>. Platnosci wylaczone: false (zapytanie idzie dalej jak dzis). */
async function obsluzWebhook(sciezka, req, res, kontekst) {
  zapamietaj(kontekst);
  if (!wlaczone(kontekst)) return false;
  const konf = kontekst.KONF;
  const p = konf.platnosci;
  const m = /^\/platnosci\/webhook\/([a-z0-9-]+)\/?$/.exec(sciezka);
  if (!m || m[1] !== p.dostawca) {
    req.resume();
    kontekst.odpowiedzJson(res, 404, { error: 'Nieznany dostawca platnosci' });
    return true;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    kontekst.odpowiedzJson(res, 405, { error: 'Tylko POST' });
    return true;
  }
  let surowe;
  try {
    surowe = await kontekst.czytajCialo(req, 512 * 1024);
  } catch (e) {
    kontekst.odpowiedzJson(res, e.status === 413 ? 413 : 400, { error: 'Niepoprawne cialo zdarzenia' });
    return true;
  }
  const a = adapter(konf);
  let zd;
  try {
    zd = a.zweryfikujZdarzenie(surowe, req.headers, konf);
  } catch (e) {
    if (!(e instanceof a.BladPodpisu)) throw e;
    console.warn(`[platnosci] webhook odrzucony: ${e.powod}`);
    kontekst.odpowiedzJson(res, 400, { error: 'Niepoprawny podpis zdarzenia' });
    return true;
  }
  const r = a.rozpoznajZdarzenie(zd);
  if (!r) {
    kontekst.odpowiedzJson(res, 200, { ok: true, zignorowane: 'typ' });
    return true;
  }
  if (r.tryb !== p.tryb) {
    console.warn(`[platnosci] webhook z trybu ${r.tryb} na serwerze w trybie ${p.tryb}: zignorowany (${r.typ} ${r.id})`);
    kontekst.odpowiedzJson(res, 200, { ok: true, zignorowane: 'tryb' });
    return true;
  }
  const zapis = magazyn.zapiszZdarzenie({ dostawca: p.dostawca, id: r.id, typ: r.typ, tryb: r.tryb, utworzone: r.utworzone });
  magazyn.ustawMeta('platnosci:ostatni_webhook', String(Date.now()));
  if (zapis === 'przetworzone') {
    kontekst.odpowiedzJson(res, 200, { ok: true, powtorzone: true });
    return true;
  }
  try {
    const w = await przetworzZdarzenie(konf, r, kontekst);
    magazyn.oznaczZdarzenie(p.dostawca, r.id, { wynik: w.wynik, login: w.login || null });
    kontekst.odpowiedzJson(res, 200, { ok: true, wynik: w.wynik });
  } catch (e) {
    // przetworzone zostaje puste: dostawca ponowi, a ponowne przetworzenie liczy stan od nowa
    console.error(`[platnosci] webhook ${r.typ} ${r.id}: ${e.message}`);
    if (e instanceof a.BladDostawcy) kontekst.bladCai(res, 'dostawca-platnosci-niedostepny', 503);
    else kontekst.odpowiedzJson(res, 500, { error: 'Blad przetwarzania zdarzenia' });
  }
  return true;
}

// ─── Kontrakty dla innych modulow ────────────────────────────────────────────

/**
 * Sekcje `subskrypcja` i `platnosci` odpowiedzi GET /api/konto (rozdz. 4.4) dla konta. Synchronicznie,
 * bez sieci (kwoty z konfiguracji albo z pamieci cen).
 *   stanDlaKonta(konto, kontekst) -> { subskrypcja: { stan, plan, okresDo, waluta, dostepDo },
 *     platnosci: { wlaczone, sprzedaz, tryb, dostawca, waluty, walutaDomyslna, wymagaZgodyNaWykonanie, mozeKupic, maPanel,
 *                  plany: [...], (B:) walutaWymuszona, zakupNiedozwolony, kraje, zwrot, odstapienie, odrzucenie, adresy, rachunek } }
 */
function stanDlaKonta(konto, kontekst) {
  zapamietaj(kontekst);
  const k = konto || {};
  const teraz = Date.now();
  const subskrypcja = {
    stan: k.subskrypcjaStan || 'brak',
    plan: k.subskrypcjaPlan || null,
    okresDo: Number(k.okresDo) || null,
    waluta: k.subskrypcjaWaluta || null,
    dostepDo: plany.dostepDo(k, teraz),
  };
  const konf = kontekst && kontekst.KONF;
  if (!konf || !wlaczone(kontekst)) {
    return {
      subskrypcja,
      platnosci: {
        wlaczone: false, sprzedaz: false, tryb: null, dostawca: null, waluty: [], walutaDomyslna: null,
        wymagaZgodyNaWykonanie: true, mozeKupic: false, maPanel: false, plany: [],
      },
    };
  }
  const p = konf.platnosci;
  const jezyk = (kontekst && kontekst.jezyk) || k.jezyk || 'pl';
  const { waluta, wymuszona } = walutaDla(k, konf, jezyk);
  const kwoty = kwotyDoWyswietlenia(konf) || {};
  const zakaz = zakazZakupu(k, konf);
  let wstrzymana = false;
  try { wstrzymana = stanProgow(konf, teraz).sprzedazWstrzymana; } catch { wstrzymana = false; }
  const sprzedaz = Boolean(p.sprzedaz) && !wstrzymana;
  const zyw = zywa(k, konf, teraz);
  const odst = k.login ? stanOdstapienia(k, konf, teraz) : { mozliwe: false, powod: 'brak-umowy' };
  const odrzucenie = k.login ? jsonMeta(`platnosci:odrzucono:${k.login}`) : null;
  return {
    subskrypcja,
    platnosci: {
      wlaczone: true,
      sprzedaz,
      tryb: p.tryb,
      dostawca: p.dostawca,
      waluty: p.waluty.slice(),
      walutaDomyslna: waluta,
      wymagaZgodyNaWykonanie: true,
      mozeKupic: sprzedaz && !zakaz && !zyw,
      maPanel: Boolean(klientKonta(k, konf)) && (k.subskrypcjaStan || 'brak') !== 'brak',
      plany: planyNaSprzedaz().map((x) => ({
        plan: x.plan, nazwa: x.nazwa, nazwaEn: x.nazwaEn, opis: x.opis, opisEn: x.opisEn, limity: x.limity, funkcje: x.funkcje,
        limitDokumentow: x.limitDokumentow, ceny: { ...(kwoty[x.plan] || {}) },
      })),
      walutaWymuszona: wymuszona ? waluta : null,
      zakupNiedozwolony: Boolean(zakaz),
      kraje: p.kraje.slice(),
      zwrot: p.zwrot,
      odstapienie: odst.mozliwe
        ? { mozliwe: true, zawarcie: odst.zawarcie, do: odst.termin - 1, szacunek: odst.szacunek, adres: '/konto/odstapienie', ponowienie: Boolean(odst.ponowienie) }
        : {
          mozliwe: false, powod: odst.powod || null, do: odst.termin ? odst.termin - 1 : null,
          zlozone: odst.odstapienie ? {
            czas: odst.odstapienie.zlozone, stan: odst.odstapienie.stan, kwota: odst.odstapienie.kwotaZwrotu, waluta: odst.odstapienie.waluta,
          } : null,
        },
      odrzucenie: odrzucenie ? { powod: 'kraj', kraj: odrzucenie.kraj, czas: odrzucenie.czas } : null,
      adresy: { zakup: '/konto/zakup', panel: '/konto/panel', odstapienie: '/konto/odstapienie' },
      rachunek: { email: (konf.uslugodawca && konf.uslugodawca.email) || null },
    },
  };
}

/**
 * Usuniecie konta (A1): natychmiastowe anulowanie subskrypcji u dostawcy. W terminie odstapienia
 * to odstapienie ze zwrotem (regulamin par. 10 ust. 2), po nim bez zwrotu (DECYZJE-R9 D-03 / M-8).
 *   async anulujDlaKonta(konto, kontekst) -> { ok: true, anulowano: boolean, odstapienie? }
 * Blad dostawcy = wyjatek: konto NIE jest usuwane (klient placilby dalej).
 */
async function anulujDlaKonta(konto, kontekst) {
  zapamietaj(kontekst);
  const konf = (kontekst && kontekst.KONF) || STAN.KONF;
  const k = konto && konto.login ? magazyn.konto(konto.login) || konto : konto;
  if (!k || !k.platnikKlient) return { ok: true, anulowano: false, platnik: null };
  if (!konf || !konf.platnosci || !konf.platnosci.dostawca || !wlaczone(kontekst)) {
    if (['probna', 'aktywna', 'zalegla', 'anulowana'].includes(k.subskrypcjaStan)) {
      throw new Error('platnosci sa wylaczone na serwerze: subskrypcji nie da sie teraz anulowac u dostawcy');
    }
    return { ok: true, anulowano: false, platnik: k.platnik };
  }
  const idKlienta = klientKonta(k, konf);
  if (!idKlienta) return { ok: true, anulowano: false, platnik: k.platnik };
  if (stanOdstapienia(k, konf).mozliwe) {
    const w = await odstap({ konto: k, zrodlo: 'usuniecie-konta', kontekst: { ...(kontekst || {}), KONF: konf } });
    return { ok: true, anulowano: true, platnik: k.platnik, odstapienie: { id: w.id, kwota: w.kwota, waluta: w.waluta } };
  }
  const w = await wZamku(idKlienta, () => adapter(konf).anulujWszystko({ idKlienta, konf }));
  try { await synchronizujKlienta(konf, idKlienta, { login: k.login }); } catch (e) { console.error(`[platnosci] po anulowaniu ${k.login}: ${e.message}`); }
  console.log(`[platnosci] usuniecie konta ${k.login}: anulowano subskrypcji ${w.anulowano}`);
  return { ok: true, anulowano: w.anulowano > 0, platnik: k.platnik };
}

/** Sekcja `platnosci` w /api/status (ARCH8-25), bez danych kont. */
function stan() {
  const konf = STAN.KONF;
  const f = konf && konf.funkcje && konf.funkcje.platnosci;
  const baza = {
    wdrozone: true, wlaczone: Boolean(f && f.wlaczona), tryb: (konf && konf.platnosci && konf.platnosci.tryb) || null,
    dostawca: (konf && konf.platnosci && konf.platnosci.dostawca) || null, cenyZgodne: null, ostatniWebhook: null, nieprzetworzone: 0,
  };
  if (!baza.wlaczone) return baza;
  try {
    const c = cenyZPamieci(konf);
    const odstapienia = magazyn.odstapieniaWStanie('blad', 100);
    return {
      ...baza,
      sprzedaz: Boolean(konf.platnosci.sprzedaz),
      cenyZgodne: c ? !c.bledy.length && !c.niezgodne.length : null,
      ceny: c ? { kwoty: c.kwoty, bledy: c.bledy, niezgodne: c.niezgodne, sprawdzone: c.czas } : null,
      ostatniWebhook: Number(magazyn.meta('platnosci:ostatni_webhook')) || null,
      ostatnieUzgodnienie: Number(magazyn.meta('platnosci:ostatnie_uzgodnienie')) || null,
      nieprzetworzone: magazyn.zdarzeniaNieprzetworzone(100).length,
      progi: stanProgow(konf),
      // oswiadczenia przyjete, ale bez anulowania albo zwrotu u dostawcy: ponowienie `zwrot <login>`
      odstapieniaZBledem: odstapienia.length,
      ostrzezenia: [...STAN.ostrzezenia],
    };
  } catch (e) {
    return { ...baza, blad: e.message };
  }
}

/**
 * Wolane raz przy starcie (po migracji, przed listen): ceny u dostawcy (brak sieci = ostrzezenie
 * i ponowienie po 5 min; potem co 6 h), uzgadnianie co 6 h, progi przychodu.
 */
function inicjuj(kontekstSerwera) {
  zapamietaj(kontekstSerwera);
  for (const z of STAN.zegary) clearTimeout(z);
  STAN.zegary = [];
  const konf = kontekstSerwera && kontekstSerwera.KONF;
  if (!konf || !wlaczone(kontekstSerwera)) return;
  try {
    for (const o of adapter(konf).ostrzezeniaKonfiguracji(konf)) console.warn(`[konfiguracja] platnosci: ${o}`);
  } catch { /* adapter bez ostrzezen */ }
  const ceny = () => odswiezCeny(konf).then((c) => {
    if (!c.bledy.length && !c.niezgodne.length) console.log('[platnosci] ceny u dostawcy sprawdzone: zgodne z konfiguracja');
  }).catch((e) => {
    console.warn(`[platnosci] ceny u dostawcy niedostepne (${e.message}); ponowienie za 5 min, start nie jest blokowany`);
    STAN.zegary.push(setTimeout(ceny, PONOW_CENY_MS).unref());
  });
  STAN.zegary.push(setTimeout(ceny, 1000).unref());
  STAN.zegary.push(setInterval(ceny, CO_6_GODZIN).unref());
  const uzg = () => uzgodnij(konf).catch((e) => console.error(`[platnosci] uzgadnianie: ${e.message}`));
  STAN.zegary.push(setTimeout(uzg, 60_000).unref());
  STAN.zegary.push(setInterval(uzg, CO_6_GODZIN).unref());
  sprawdzProgi(konf, { kontekst: kontekstSerwera }).catch((e) => console.error(`[platnosci] progi: ${e.message}`));
}

module.exports = {
  DOSTAWCY, sprawdzKonfiguracje, obsluzWebhook, obsluz, stanDlaKonta, anulujDlaKonta, stan, inicjuj, cspEkranu,
  // CLI (platnosci-cli.js), testy, narzedzia
  Odmowa, adapter, odswiezCeny, kwotyDoWyswietlenia, parsujCenyWyswietlane, synchronizujKlienta, synchronizujKonto, uzgodnij,
  stanProgow, sprawdzProgi, przychodOkresu, okresZNazwy, kwartal, dzienWarszawy, terminOdstapienia, czesciWarszawa, polnocWarszawy,
  wyliczZwrot, stanOdstapienia, odstap, rozpocznijZakup, otworzPanel, powiazKonto, klientKonta, walutaDla, zapiszWplate,
  KRAJE_UE, STAN,
};
