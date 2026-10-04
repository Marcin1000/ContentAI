'use strict';
/**
 * Zadania w tle: wywolanie dostawcy AI konczy sie na serwerze, nawet gdy
 * przegladarka zerwie polaczenie.
 *
 * Na telefonie przelaczenie aplikacji albo wygaszenie ekranu w trakcie
 * generowania zrywa polaczenie. Wczesniej serwer przerywal wtedy wywolanie
 * dostawcy, a uzytkownik po powrocie widzial "Brak polaczenia z serwerem"
 * i zaczynal od nowa. Teraz aplikacja nadaje kazdemu wywolaniu identyfikator
 * (naglowek X-Zadanie). Serwer prowadzi zadanie do konca i trzyma wynik przez
 * kilkanascie minut; aplikacja po powrocie ponawia to samo zadanie i dostaje
 * gotowa odpowiedz - bez drugiego wywolania dostawcy i bez drugiego liczenia
 * do pakietu. Przycisk Przerwij konczy zadanie jawnie (/api/zadanie/anuluj).
 */
const { EventEmitter } = require('node:events');

const CZAS_PRZECHOWANIA_MS = 15 * 60 * 1000;
const NA_KONTO = 8;
const RAZEM = 400;

/** klucz "login:id" -> { login, odp, obietnica, koniec, anulowane } */
const zadania = new Map();

/** Identyfikator zadania z naglowka albo '' (brak lub zly format). */
function idZNaglowka(req) {
  const id = String(req.headers['x-zadanie'] || '');
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

/**
 * Odpowiedz, ktora zbiera wynik w pamieci zamiast wysylac go do klienta.
 * Ma tyle z http.ServerResponse, ile uzywaja wyslij(), odpowiedzJson()
 * i hamulec(). Nigdy sama sie nie zamyka - dlatego wywolanie dostawcy trwa
 * dalej, gdy klient odejdzie; 'close' emituje dopiero anuluj().
 */
class OdpowiedzZadania extends EventEmitter {
  constructor(req) {
    super();
    this.req = req;
    this.statusCode = 200;
    this.headersSent = false;
    this.writableEnded = false;
    this.destroyed = false;
    this._naglowki = {};
    this._kawalki = [];
  }

  setHeader(nazwa, wartosc) { this._naglowki[String(nazwa).toLowerCase()] = wartosc; }
  getHeader(nazwa) { return this._naglowki[String(nazwa).toLowerCase()]; }
  removeHeader(nazwa) { delete this._naglowki[String(nazwa).toLowerCase()]; }

  writeHead(status, naglowki) {
    this.statusCode = status;
    if (naglowki) for (const [k, v] of Object.entries(naglowki)) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }

  write(kawalek) {
    if (kawalek != null) this._kawalki.push(Buffer.isBuffer(kawalek) ? kawalek : Buffer.from(String(kawalek)));
    this.headersSent = true;
    return true;
  }

  end(kawalek) {
    if (this.writableEnded) return this;
    this.write(kawalek);
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }

  /** Jawne przerwanie: hamulec widzi 'close' jak odejscie klienta i przerywa dostawce. */
  anuluj() {
    if (this.writableEnded || this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }

  wynik() {
    return { status: this.statusCode, naglowki: { ...this._naglowki }, cialo: Buffer.concat(this._kawalki) };
  }
}

function sprzataj(teraz = Date.now()) {
  for (const [klucz, wpis] of zadania) {
    if (wpis.koniec && teraz - wpis.koniec > CZAS_PRZECHOWANIA_MS) zadania.delete(klucz);
  }
}

/** Najstarsze zakonczone zadania znikaja pierwsze, gdy konto albo serwer ma ich za duzo. */
function zrobMiejsce(login) {
  const konta = [...zadania.entries()].filter(([, w]) => w.login === login);
  const zakonczone = (lista) => lista.filter(([, w]) => w.koniec).sort((a, b) => a[1].koniec - b[1].koniec);
  for (const [klucz] of zakonczone(konta).slice(0, Math.max(0, konta.length - NA_KONTO + 1))) zadania.delete(klucz);
  if (zadania.size >= RAZEM) {
    for (const [klucz] of zakonczone([...zadania.entries()]).slice(0, zadania.size - RAZEM + 1)) zadania.delete(klucz);
  }
}

function znajdz(login, id) {
  if (!login || !id) return null;
  sprzataj();
  return zadania.get(login + ':' + id) || null;
}

/**
 * Startuje zadanie. `wykonaj(odp)` to zwykla obsluga proxy, ktora pisze
 * do podanej odpowiedzi; tutaj pisze do OdpowiedzZadania.
 */
function uruchom(login, id, req, wykonaj) {
  sprzataj();
  zrobMiejsce(login);
  const odp = new OdpowiedzZadania(req);
  const wpis = { login, odp, koniec: 0, anulowane: false };
  wpis.obietnica = (async () => {
    try {
      await wykonaj(odp);
    } catch (e) {
      console.error('[zadanie]', e && e.message);
      if (!odp.headersSent && !odp.destroyed) {
        const tresc = JSON.stringify({ error: 'Błąd połączenia z dostawcą API' });
        odp.writeHead(e && e.status === 400 ? 400 : 502, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(tresc) });
        odp.end(tresc);
      }
    } finally {
      if (!odp.writableEnded) wpis.anulowane = true;
      wpis.koniec = Date.now();
    }
  })();
  zadania.set(login + ':' + id, wpis);
  return wpis;
}

/** Czeka na wynik zadania i oddaje go klientowi, jesli ten jeszcze czeka. */
async function odbierz(wpis, res) {
  await wpis.obietnica;
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  if (wpis.anulowane) {
    const tresc = JSON.stringify({ error: 'Zadanie przerwane', komunikat: 'Generowanie zostało przerwane.' });
    res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(tresc) });
    res.end(tresc);
    return;
  }
  const w = wpis.odp.wynik();
  res.writeHead(w.status, w.naglowki);
  res.end(res.req && res.req.method === 'HEAD' ? undefined : w.cialo);
}

/** Przerwij z aplikacji. Zwraca true, gdy bylo co przerwac. */
function anuluj(login, id) {
  const wpis = znajdz(login, id);
  if (!wpis || wpis.koniec) return false;
  wpis.odp.anuluj();
  return true;
}

module.exports = { idZNaglowka, znajdz, uruchom, odbierz, anuluj, OdpowiedzZadania, _zadania: zadania };
