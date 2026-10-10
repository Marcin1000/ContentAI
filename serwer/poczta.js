'use strict';

// ─── Poczta wychodzaca (wykonawca C, ARCH8-21, PR8-27) ───────────────────────
//
// Tryby (CAI_POCZTA):
//   log     (domyslny) nic nie wychodzi; dziennik systemowy dostaje tylko szablon i zamaskowany
//           adres, pelna wiadomosc trafia wylacznie do pliku CAI_POCZTA_LOG (JSON Lines, 0600),
//           jesli ustawiony (testy i srodowisko testowe),
//   resend  POST <CAI_POCZTA_URL>/emails (API Resend przez fetch, bez npm): Authorization Bearer
//           CAI_POCZTA_KLUCZ, limit czasu 10 s, jedno ponowienie po 1 s przy bledzie sieci, 429
//           i 5xx z tym samym naglowkiem Idempotency-Key (Resend nie wysle tej samej wiadomosci
//           drugi raz, gdy pierwsza proba jednak doszla).
// Sledzenie otwarc i klikniec (PR8-27): wiadomosci nie maja obrazkow ani przekierowan, a samo
// sledzenie wylacza sie w Resend w ustawieniach domeny (README "Poczta"; poczta-test pokazuje,
// czy jest wylaczone, gdy klucz pozwala odczytac domeny).
// Odnosnik z tokenem NIGDY nie trafia do dziennika systemowego ani do /api/status: dziennik dostaje
// szablon, zamaskowany adres, wynik i identyfikator wiadomosci, a opis bledu dostawcy jest
// przyciety, bez adresow e-mail i bez adresow URL.
//
// Kontrakt (WYKONANIE-A0 3.10):
//   async wyslij({ do, szablon, jezyk = 'pl', dane = {} }, konf) -> { ok, tryb, id?, blad? } (nie rzuca)
//   maskujAdres(adres) -> 'a***@firma.pl'
//   stan() -> { tryb, wyslanych, bledow, ostatniBlad, ostatniBladCzas } (sekcja /api/status)
//   inicjuj(kontekstSerwera); cli('poczta-test', [adres], kontekst) -> kod wyjscia
//   Linia CAI_POCZTA_LOG: { czas, do, szablon, jezyk, temat, tekst, html, dane, tryb, wynik }

const crypto = require('node:crypto');
const pliki = require('./pliki.js');
const szablony = require('./poczta-szablony.js');

const CZAS_MS = 10_000;
const PONOWIENIE_MS = 1000;
const STAN = { tryb: 'log', wyslanych: 0, bledow: 0, ostatniBlad: null, ostatniBladCzas: null };
const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));

function maskujAdres(adres) {
  const a = String(adres || '');
  const at = a.lastIndexOf('@');
  if (at < 1) return '***';
  return `${a[0]}***${a.slice(at)}`;
}

/** Opis bledu do dziennika i /api/status: bez adresow e-mail i URL, przyciety. */
function bezpiecznyOpis(tekst) {
  return String(tekst || '')
    .replace(/https?:\/\/\S+/gi, '<adres>')
    .replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function zanotujBlad(opis) {
  STAN.bledow += 1;
  STAN.ostatniBlad = bezpiecznyOpis(opis);
  STAN.ostatniBladCzas = new Date().toISOString();
}

/**
 * Jedna wiadomosc przez API Resend. -> { ok, id?, blad?, status? }
 * fetchImpl do testow; sieci i API dotyka tylko ta funkcja.
 */
async function wyslijResend({ adres, szablon, wiadomosc }, konfPoczty, fetchImpl = fetch) {
  if (!konfPoczty.klucz) return { ok: false, blad: 'brak CAI_POCZTA_KLUCZ' };
  if (!konfPoczty.od) return { ok: false, blad: 'brak CAI_POCZTA_OD' };
  const cialo = {
    from: konfPoczty.od,
    to: [adres],
    subject: wiadomosc.temat,
    text: wiadomosc.tekst,
    html: wiadomosc.html,
    tags: [{ name: 'rodzaj', value: szablon }],
  };
  if (konfPoczty.odpowiedz) cialo.reply_to = konfPoczty.odpowiedz;
  const tresc = JSON.stringify(cialo);
  const idempotencja = `cai-${crypto.randomUUID()}`;
  const url = `${String(konfPoczty.url || 'https://api.resend.com').replace(/\/+$/, '')}/emails`;
  let ostatni = { ok: false, blad: 'brak proby' };
  for (let proba = 1; proba <= 2; proba += 1) {
    let odp = null;
    let bladSieci = '';
    try {
      odp = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${konfPoczty.klucz}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencja,
          'User-Agent': 'ContentAI-poczta',
        },
        body: tresc,
        redirect: 'manual',
        signal: AbortSignal.timeout(CZAS_MS),
      });
    } catch (e) {
      bladSieci = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'limit czasu 10 s' : 'blad sieci';
    }
    if (odp && odp.ok) {
      const j = await odp.json().catch(() => ({}));
      return { ok: true, id: j && j.id ? String(j.id) : undefined };
    }
    if (odp) {
      const surowe = await odp.text().catch(() => '');
      let j = {};
      try { j = JSON.parse(surowe); } catch { /* nie JSON */ }
      ostatni = { ok: false, status: odp.status, blad: `HTTP ${odp.status}${j.name ? ` ${j.name}` : ''}${j.message ? `: ${j.message}` : ''}` };
    } else {
      ostatni = { ok: false, blad: bladSieci };
    }
    const ponow = !odp || odp.status === 429 || odp.status >= 500;
    if (proba === 1 && ponow) await czekaj(PONOWIENIE_MS);
    else break;
  }
  return ostatni;
}

async function wyslij({ do: adres, szablon, jezyk = 'pl', dane = {} } = {}, konf = {}, fetchImpl = fetch) {
  const poczta = (konf && konf.poczta) || { tryb: 'log' };
  const tryb = poczta.tryb === 'resend' ? 'resend' : 'log';
  STAN.tryb = tryb;
  const doKogo = String(adres || '').trim();
  if (!doKogo || !szablon) return { ok: false, tryb, blad: 'brak adresu albo szablonu' };
  let wiadomosc;
  try {
    wiadomosc = szablony.renderuj(szablon, jezyk, { email: doKogo, ...dane }, konf);
  } catch (e) {
    zanotujBlad(e.message);
    console.error(`[poczta] ${szablon}: ${e.message}`);
    return { ok: false, tryb, blad: 'szablon' };
  }

  const wynik = tryb === 'resend'
    ? await wyslijResend({ adres: doKogo, szablon, wiadomosc }, poczta, fetchImpl)
    : { ok: true };
  if (wynik.ok) STAN.wyslanych += 1;
  else zanotujBlad(wynik.blad);
  console.log(`[poczta] ${tryb}: ${szablon} -> ${maskujAdres(doKogo)}: ${wynik.ok ? `ok${wynik.id ? ` (${wynik.id})` : ''}` : `BLAD ${bezpiecznyOpis(wynik.blad)}`}`);

  // Pelna wiadomosc (z odnosnikiem) tylko w pliku CAI_POCZTA_LOG, nigdy w dzienniku systemowym.
  if (poczta.log) {
    try {
      pliki.dopiszLinie(poczta.log, {
        czas: new Date().toISOString(), do: doKogo, szablon, jezyk: jezyk === 'en' ? 'en' : 'pl', ...wiadomosc, dane,
        tryb, wynik: wynik.ok ? 'ok' : 'blad',
      });
    } catch (e) {
      zanotujBlad(`zapis CAI_POCZTA_LOG: ${e.code || e.message}`);
      console.error('[poczta] zapis pliku wiadomosci:', e.code || e.message);
    }
  }
  return wynik.ok
    ? { ok: true, tryb, ...(wynik.id ? { id: wynik.id } : {}) }
    : { ok: false, tryb, blad: bezpiecznyOpis(wynik.blad) };
}

function stan() {
  return { tryb: STAN.tryb, wyslanych: STAN.wyslanych, bledow: STAN.bledow, ostatniBlad: STAN.ostatniBlad, ostatniBladCzas: STAN.ostatniBladCzas };
}

function inicjuj(kontekstSerwera) {
  const konf = kontekstSerwera && kontekstSerwera.KONF;
  STAN.tryb = (konf && konf.poczta && konf.poczta.tryb === 'resend') ? 'resend' : 'log';
}

/**
 * Ustawienia sledzenia domen w Resend (PR8-27), jesli klucz pozwala je odczytac.
 * -> [{ nazwa, otwarcia, klikniecia }] albo null (klucz tylko do wysylki, inne API).
 */
async function sledzenieDomen(konfPoczty, fetchImpl = fetch) {
  try {
    const odp = await fetchImpl(`${String(konfPoczty.url || 'https://api.resend.com').replace(/\/+$/, '')}/domains`, {
      headers: { Authorization: `Bearer ${konfPoczty.klucz}` }, redirect: 'manual', signal: AbortSignal.timeout(CZAS_MS),
    });
    if (!odp.ok) return null;
    const j = await odp.json().catch(() => null);
    const lista = j && Array.isArray(j.data) ? j.data : null;
    if (!lista) return null;
    return lista.map((d) => ({ nazwa: String(d.name || d.id || '?'), otwarcia: d.open_tracking, klikniecia: d.click_tracking }));
  } catch {
    return null;
  }
}

const POLECENIA = [{ nazwa: 'poczta-test', opis: 'wysyla wiadomosc probna (SPF, DKIM, DMARC, sledzenie wylaczone)', uzycie: 'poczta-test <adres>' }];

async function cli(polecenie, argumenty, kontekst = {}, fetchImpl = fetch) {
  const wypisz = kontekst.wypisz || ((t) => console.log(t));
  const blad = kontekst.blad || ((t) => console.error(t));
  if (polecenie !== 'poczta-test') {
    blad(`Nieznane polecenie poczty: ${polecenie}`);
    return 1;
  }
  const adres = String((argumenty && argumenty[0]) || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) {
    blad('Użycie: poczta-test <adres>');
    return 1;
  }
  const konf = kontekst.KONF || {};
  const poczta = konf.poczta || { tryb: 'log' };
  if (poczta.tryb !== 'resend') {
    wypisz(`CAI_POCZTA=${poczta.tryb || 'log'}: wiadomości nie wychodzą (tylko dziennik${poczta.log ? ` i plik ${poczta.log}` : ''}). Ustaw CAI_POCZTA=resend, CAI_POCZTA_KLUCZ i CAI_POCZTA_OD.`);
  }
  const wynik = await wyslij({ do: adres, szablon: 'test', jezyk: 'pl' }, konf, fetchImpl);
  if (!wynik.ok) {
    blad(`Nie udało się wysłać wiadomości próbnej: ${wynik.blad}`);
    return 1;
  }
  wypisz(`Wysłano wiadomość próbną na ${maskujAdres(adres)} (tryb ${wynik.tryb}${wynik.id ? `, id ${wynik.id}` : ''}).`);
  if (wynik.tryb === 'resend') {
    const domeny = await sledzenieDomen(poczta, fetchImpl);
    if (!domeny) {
      wypisz('Śledzenie otwarć i kliknięć: sprawdź w panelu Resend (Domains), że jest wyłączone (PR8-27); ten klucz nie odczytuje domen.');
    } else {
      for (const d of domeny) {
        const wl = [d.otwarcia === true ? 'otwarcia' : '', d.klikniecia === true ? 'kliknięcia' : ''].filter(Boolean);
        const znane = typeof d.otwarcia === 'boolean' || typeof d.klikniecia === 'boolean';
        if (wl.length) blad(`UWAGA: domena ${d.nazwa} ma włączone śledzenie (${wl.join(', ')}): wyłącz je w panelu Resend (PR8-27).`);
        else wypisz(`Domena ${d.nazwa}: ${znane ? 'śledzenie otwarć i kliknięć wyłączone' : 'brak informacji o śledzeniu, sprawdź w panelu Resend'}.`);
      }
    }
  }
  return 0;
}

module.exports = { wyslij, wyslijResend, maskujAdres, bezpiecznyOpis, stan, inicjuj, POLECENIA, cli };
