'use strict';

// ─── Poczta wychodzaca (wykonawca C) - ZASLEPKA ETAPU 0 z dzialajacym trybem 'log' ─
//
// ARCH8-21: adaptery 'resend' (POST <CAI_POCZTA_URL>/emails, jedno ponowienie przy
// bledzie sieci, 429 i 5xx, limit czasu 10 s) i 'log' (domyslny). Kontrakt:
//
//   async wyslij({ do: adres, szablon, jezyk = 'pl', dane = {} }, konf)
//     -> { ok: boolean, tryb: 'log'|'resend', id?: string, blad?: string }
//     konf = KONF serwera (konf.poczta, konf.uslugodawca, konf.adresPubliczny).
//     Nie rzuca wyjatku przy bledzie wysylki: ekran mowi "nie udalo sie wyslac"
//     i proponuje ponowienie, a konto i token powstaja niezaleznie od wyniku.
//   maskujAdres(adres) -> 'a***@firma.pl'
//   stan() -> { tryb, wyslanych, ostatniBlad } (sekcja /api/status)
//   inicjuj(kontekstSerwera); cli(polecenie, argumenty, kontekst) -> kod wyjscia (poczta-test <adres>)
//
// Tryb 'log' (dziala juz w etapie 0, zeby A1 mogl testowac rejestracje i reset):
// w dzienniku systemowym tylko szablon i zamaskowany adres, NIGDY odnosnik z tokenem;
// pelna wiadomosc tylko do pliku CAI_POCZTA_LOG (JSON Lines, 0600), jesli ustawiony
// (testy i srodowisko testowe). Linia pliku:
//   { czas, do, szablon, jezyk, temat, tekst, html, dane }   (odnosnik testy biora z dane.odnosnik)

const pliki = require('./pliki.js');
const szablony = require('./poczta-szablony.js');

const STAN = { wyslanych: 0, ostatniBlad: null, tryb: 'log' };

function maskujAdres(adres) {
  const a = String(adres || '');
  const at = a.lastIndexOf('@');
  if (at < 1) return '***';
  return `${a[0]}***${a.slice(at)}`;
}

async function wyslij({ do: adres, szablon, jezyk = 'pl', dane = {} } = {}, konf = {}) {
  const poczta = (konf && konf.poczta) || { tryb: 'log' };
  STAN.tryb = poczta.tryb || 'log';
  if (!adres || !szablon) return { ok: false, tryb: STAN.tryb, blad: 'brak adresu albo szablonu' };
  const wiadomosc = szablony.renderuj(szablon, jezyk, dane, konf);
  console.log(`[poczta] ${STAN.tryb === 'log' ? 'log' : 'zaslepka'}: ${szablon} -> ${maskujAdres(adres)}`);
  if (poczta.log) {
    try {
      pliki.dopiszLinie(poczta.log, {
        czas: new Date().toISOString(), do: String(adres), szablon, jezyk, ...wiadomosc, dane,
      });
    } catch (e) {
      STAN.ostatniBlad = `zapis CAI_POCZTA_LOG: ${e.code || e.message}`;
      console.error('[poczta] zapis pliku wiadomosci:', e.code || e.message);
    }
  }
  if (STAN.tryb !== 'log') {
    STAN.ostatniBlad = 'adapter resend nie jest jeszcze wdrozony (zaslepka etapu 0)';
    return { ok: false, tryb: STAN.tryb, blad: 'niezaimplementowane' };
  }
  STAN.wyslanych += 1;
  return { ok: true, tryb: 'log' };
}

function stan() {
  return { tryb: STAN.tryb, wyslanych: STAN.wyslanych, ostatniBlad: STAN.ostatniBlad };
}

function inicjuj(kontekstSerwera) {
  STAN.tryb = (kontekstSerwera && kontekstSerwera.KONF && kontekstSerwera.KONF.poczta.tryb) || 'log';
}

const POLECENIA = [{ nazwa: 'poczta-test', opis: 'wysyla wiadomosc probna (SPF, DKIM, DMARC)', uzycie: 'poczta-test <adres>' }];

async function cli(polecenie, argumenty, kontekst) {
  const blad = (kontekst && kontekst.blad) || ((t) => console.error(t));
  blad(`Polecenie "${polecenie}" nie jest jeszcze dostępne w tym wydaniu (poczta: zaślepka etapu 0).`);
  return 1;
}

module.exports = { wyslij, maskujAdres, stan, inicjuj, POLECENIA, cli };
