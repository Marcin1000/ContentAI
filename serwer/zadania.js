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
 *
 * Pamiec (ARCH8-12, KOD8-05, SEC8-02): kopia zapytania zadania niesie naglowki
 * z kluczami uzytkownika i ciasteczka (sesja, zaszyfrowane klucze). Po zakonczeniu
 * wywolania dostawcy usuwamy je z kopii, a sama kopia znika z wpisu (odp.req = null):
 * klucz nie zyje w pamieci dluzej niz wywolanie. Wyniki maja budzet w bajtach
 * (CAI_ZADANIA_MB, domyslnie 200): przy przekroczeniu najstarsze zakonczone wyniki
 * wypadaja, a gdy wszystkie jeszcze trwaja, nowe zapytanie idzie bez trybu w tle
 * (zwykle wywolanie). Wynik odebrany przez klienta czeka juz tylko 2 minuty (na
 * wypadek zerwania tuz po wyslaniu), nieodebrany 15 minut. Sprzatanie co minute.
 */
const { EventEmitter } = require('node:events');

const CZAS_PRZECHOWANIA_MS = 15 * 60 * 1000;
const PO_ODEBRANIU_MS = 2 * 60 * 1000;
const NA_KONTO = 8;
const RAZEM = 400;
// Naglowki kopii zapytania, ktore nie moga przezyc wywolania dostawcy.
const NAGLOWKI_TAJNE = ['x-api-key', 'x-openai-key', 'x-eleven-key', 'xi-api-key', 'authorization', 'cookie'];
const BUDZET = { bajty: 200 * 1024 * 1024 };

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
    this.bajty = 0;
    // Cialo zapytania w pamieci, dopoki zadanie trwa (nagranie do 25 MB) - liczy sie do budzetu.
    this.bajtyZapytania = 0;
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
    if (kawalek != null) {
      const b = Buffer.isBuffer(kawalek) ? kawalek : Buffer.from(String(kawalek));
      this._kawalki.push(b);
      this.bajty += b.length;
    }
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
    if (!wpis.koniec) continue;
    if (teraz - wpis.koniec > CZAS_PRZECHOWANIA_MS || (wpis.odebrane && teraz - wpis.odebrane > PO_ODEBRANIU_MS)) zadania.delete(klucz);
  }
}

/** Bajty w pamieci: wyniki (trwajace i zakonczone) i ciala zapytan zadan w toku. */
function bajtyRazem() {
  let suma = 0;
  for (const wpis of zadania.values()) suma += wpis.odp.bajty + wpis.odp.bajtyZapytania;
  return suma;
}

/**
 * Najstarsze zakonczone zadania znikaja pierwsze, gdy konto albo serwer ma ich za duzo
 * albo wyniki przekraczaja budzet bajtow. -> false, gdy budzetu nie da sie zwolnic
 * (wszystko jeszcze trwa): wolajacy robi wtedy zwykle wywolanie bez trybu w tle.
 */
function zrobMiejsce(login, nowe = 0) {
  const konta = [...zadania.entries()].filter(([, w]) => w.login === login);
  const zakonczone = (lista) => lista.filter(([, w]) => w.koniec).sort((a, b) => a[1].koniec - b[1].koniec);
  for (const [klucz] of zakonczone(konta).slice(0, Math.max(0, konta.length - NA_KONTO + 1))) zadania.delete(klucz);
  if (zadania.size >= RAZEM) {
    for (const [klucz] of zakonczone([...zadania.entries()]).slice(0, zadania.size - RAZEM + 1)) zadania.delete(klucz);
  }
  let bajty = bajtyRazem() + nowe;
  if (bajty < BUDZET.bajty) return true;
  for (const [klucz, wpis] of zakonczone([...zadania.entries()])) {
    zadania.delete(klucz);
    bajty -= wpis.odp.bajty;
    if (bajty < BUDZET.bajty) return true;
  }
  return bajty < BUDZET.bajty;
}

/** Usuwa z kopii zapytania naglowki z kluczami i ciasteczka (po wywolaniu dostawcy). */
function wyczyscKopie(req) {
  if (!req) return;
  if (req.headers) for (const n of NAGLOWKI_TAJNE) delete req.headers[n];
  if (req.cialoGotowe) req.cialoGotowe = null;
}

function znajdz(login, id) {
  if (!login || !id) return null;
  sprzataj();
  return zadania.get(login + ':' + id) || null;
}

/**
 * Startuje zadanie. `wykonaj(odp)` to zwykla obsluga proxy, ktora pisze
 * do podanej odpowiedzi; tutaj pisze do OdpowiedzZadania. `req` to kopia
 * zapytania (wlasny obiekt naglowkow): po wywolaniu traci naglowki z kluczami.
 * -> wpis albo null, gdy budzet pamieci wynikow jest wyczerpany przez zadania
 *    w toku (wolajacy wykonuje wtedy zapytanie zwyczajnie, bez trybu w tle).
 */
function uruchom(login, id, req, wykonaj) {
  sprzataj();
  const bajtyZapytania = req && Buffer.isBuffer(req.cialoGotowe) ? req.cialoGotowe.length : 0;
  if (!zrobMiejsce(login, bajtyZapytania)) return null;
  const odp = new OdpowiedzZadania(req);
  odp.bajtyZapytania = bajtyZapytania;
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
      // Klucz uzytkownika nie zyje dluzej niz wywolanie (ARCH8-12): ani w kopii zapytania,
      // ani we wpisie (wynik do odebrania zostaje, zapytanie nie).
      wyczyscKopie(req);
      odp.req = null;
      odp.bajtyZapytania = 0;
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
  wpis.odebrane = Date.now();
}

/** Przerwij z aplikacji. Zwraca true, gdy bylo co przerwac. */
function anuluj(login, id) {
  const wpis = znajdz(login, id);
  if (!wpis || wpis.koniec) return false;
  wpis.odp.anuluj();
  return true;
}

/**
 * Stan zadania dla aplikacji (KOD8-30), bez tresci: { stan: 'trwa'|'gotowe'|'przerwane'|'brak', status? }.
 * 'gotowe' -> ponowienie z tym samym X-Zadanie odbierze wynik bez nowego wywolania i liczenia.
 */
function stanZadania(login, id) {
  const wpis = znajdz(login, id);
  if (!wpis) return { stan: 'brak' };
  if (!wpis.koniec) return { stan: 'trwa' };
  if (wpis.anulowane) return { stan: 'przerwane' };
  return { stan: 'gotowe', status: wpis.odp.statusCode };
}

/** Ile zadan jeszcze trwa (lagodne zatrzymanie serwera czeka, az bedzie 0). */
function trwajace() {
  let n = 0;
  for (const wpis of zadania.values()) if (!wpis.koniec) n += 1;
  return n;
}

/**
 * Ile wynikow jest gotowych, ale nikt ich jeszcze nie odebral (klient zerwal polaczenie,
 * ponowienie z tym samym X-Zadanie w drodze), zakonczonych najwyzej `oknoMs` temu.
 * Lagodne zatrzymanie chwile na nie czeka, zeby oplacony wynik nie zginal z procesem.
 */
function nieodebrane(oknoMs, teraz = Date.now()) {
  let n = 0;
  for (const wpis of zadania.values()) {
    if (wpis.koniec && !wpis.odebrane && !wpis.anulowane && teraz - wpis.koniec <= oknoMs) n += 1;
  }
  return n;
}

/** Konfiguracja z serwera: budzet wynikow w MB (CAI_ZADANIA_MB). */
function ustaw({ budzetMb } = {}) {
  if (Number(budzetMb) > 0) BUDZET.bajty = Math.round(Number(budzetMb) * 1024 * 1024);
  return { budzetBajtow: BUDZET.bajty };
}

/** Stan do testow i /api/status: liczba wpisow, trwajacych i bajtow wynikow. */
function stan() {
  return { wpisow: zadania.size, trwajacych: trwajace(), bajty: bajtyRazem(), budzetBajtow: BUDZET.bajty };
}

// Sprzatanie co minute niezaleznie od ruchu (wczesniej tylko przy nastepnym zapytaniu
// z X-Zadanie); zegar nie trzyma procesu przy zyciu.
setInterval(() => sprzataj(), 60_000).unref();

module.exports = {
  idZNaglowka, znajdz, uruchom, odbierz, anuluj, stanZadania, trwajace, nieodebrane, ustaw, stan, sprzataj, wyczyscKopie,
  OdpowiedzZadania, NAGLOWKI_TAJNE, _zadania: zadania,
};
