'use strict';

// ─── Magazyn danych: konta, liczniki, sesje, tokeny, zgody, platnosci ───────
//
// Jedyne miejsce z SQL w serwerze (ARCH8-02, PROJEKT-TECHNICZNY rozdz. 3).
// Wbudowany node:sqlite (Node >= 22.13, bez zaleznosci npm), API synchroniczne
// DatabaseSync, tryb WAL, synchronous=FULL, foreign_keys=ON.
//
// Dlaczego baza zamiast plikow JSON: dzis kazde zapytanie czytalo i parsowalo
// caly plik kont kilka razy (3-35 ms przy 1-10 tys. kont, rosnie liniowo), a kazda
// zmiana przepisywala caly plik, wiec CLI i webhook platnosci gubily sobie
// nawzajem zmiany. Tutaj odczyt konta to kilka mikrosekund, a zmiana dotyka
// jednego wiersza w transakcji.
//
// Zasady dla wszystkich, ktorzy tu dopisuja:
//   - inne moduly NIE wykonuja SQL; potrzebne zapytanie = nowa funkcja tutaj,
//     w sekcji wlasciwej dla obszaru (konta, tokeny i zgody, platnosci...),
//   - nowa kolumna albo tabela = nowa migracja schematu w MIGRACJE_SCHEMATU
//     (numery zarezerwowane: 2 = A1 konta, 3 = C dzierzawy/klucze/poczta,
//     4 = B platnosci; nieuzyty numer po prostu zostaje pominiety),
//   - transakcja(fn) przyjmuje wylacznie funkcje SYNCHRONICZNA: await w srodku
//     wpuscilby do transakcji zapytania innych zadan,
//   - bledy "danych nie da sie teraz odczytac" (blokada, uszkodzenie, brak
//     miejsca, baza zamknieta) to BladMagazynu (podklasa pliki.BladDanych),
//     ktory router zamienia na 503 z wyjasnieniem, tak jak uszkodzony plik.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pliki = require('./pliki.js');

// node:sqlite w Node 22 ma status 1.1 i przy pierwszym require wypisuje
// ExperimentalWarning. Wiemy o tym (ARCH8-02: jeden modul, test magazynu w CI
// na Node 22), wiec wyciszamy dokladnie ten jeden komunikat, zeby nie zasmiecal
// dziennika i wyjscia CLI. Wszystkie inne ostrzezenia przechodza bez zmian.
const sqlite = (() => {
  const pierwotne = process.emitWarning;
  process.emitWarning = function (ostrzezenie, ...reszta) {
    const tresc = String((ostrzezenie && ostrzezenie.message) || ostrzezenie || '');
    const typ = typeof reszta[0] === 'string' ? reszta[0] : ((reszta[0] && reszta[0].type) || (ostrzezenie && ostrzezenie.name));
    if (typ === 'ExperimentalWarning' && /SQLite/i.test(tresc)) return undefined;
    return pierwotne.call(process, ostrzezenie, ...reszta);
  };
  try {
    return require('node:sqlite');
  } catch {
    // Node starszy niz 22.13 (albo bez flagi): otworz() zglosi to czytelnie.
    return null;
  } finally {
    process.emitWarning = pierwotne;
  }
})();

const WERSJA_SCHEMATU = 1;
const GLOWNA = 'glowna';
const DOBA = 24 * 3600_000;

// ─── Bledy ───────────────────────────────────────────────────────────────────

/**
 * Danych chwilowo nie da sie odczytac albo zapisac (blokada ponad limit czasu,
 * uszkodzony plik, pelny dysk, baza zamknieta). Dziedziczy po BladDanych, wiec
 * router odpowiada 503 z wyjasnieniem, a nie "nie ma takiego konta".
 */
class BladMagazynu extends pliki.BladDanych {
  constructor(opis, przyczyna) {
    super(plikBazy || 'baza danych', opis);
    this.name = 'BladMagazynu';
    this.message = `Baza danych ${plikBazy || '(nieotwarta)'}: ${opis}. Serwer nie zapisze nic `
      + 'po omacku; sprawdz dziennik, miejsce na dysku i kopie w katalogu kopii.';
    this.przyczyna = przyczyna || null;
  }
}

/** Naruszenie unikalnosci (e-mail zajety, login istnieje, klient platnosci przy innym koncie). */
class BladKonfliktu extends Error {
  constructor(pole, opis) {
    super(opis || `Wartosc pola ${pole} jest juz zajeta`);
    this.name = 'BladKonfliktu';
    this.pole = pole;
    this.status = 409;
  }
}

// Kody podstawowe SQLite, ktore znacza "dane chwilowo niedostepne", a nie blad w kodzie.
const NIEDOSTEPNE = new Map([
  [5, 'baza zajeta przez inny proces (SQLITE_BUSY)'],
  [6, 'tabela zablokowana (SQLITE_LOCKED)'],
  [7, 'brak pamieci (SQLITE_NOMEM)'],
  [8, 'baza tylko do odczytu (SQLITE_READONLY): sprawdz wlasciciela plikow bazy'],
  [10, 'blad wejscia-wyjscia dysku (SQLITE_IOERR)'],
  [11, 'plik bazy uszkodzony (SQLITE_CORRUPT)'],
  [13, 'brak miejsca na dysku (SQLITE_FULL)'],
  [14, 'nie mozna otworzyc pliku bazy (SQLITE_CANTOPEN)'],
  [26, 'plik nie jest baza danych (SQLITE_NOTADB)'],
]);

function przetlumacz(e) {
  if (!e || e instanceof pliki.BladDanych || e instanceof BladKonfliktu) return e;
  const kod = Number(e.errcode);
  if (e.code === 'ERR_SQLITE_ERROR' && Number.isFinite(kod)) {
    const podstawowy = kod & 0xff;
    if (NIEDOSTEPNE.has(podstawowy)) return new BladMagazynu(NIEDOSTEPNE.get(podstawowy), String(e.message || ''));
    if (podstawowy === 19 && /UNIQUE|PRIMARY KEY/i.test(String(e.message))) {
      const m = /constraint failed: ([\w.]+)/i.exec(String(e.message));
      const pole = m ? m[1].split('.').pop() : 'klucz';
      return new BladKonfliktu(pole);
    }
  }
  return e;
}

// ─── Polaczenie ──────────────────────────────────────────────────────────────

let db = null;
let plikBazy = null;
let poziomTransakcji = 0;
const zapytania = new Map();

function baza() {
  if (!db) throw new BladMagazynu('baza nie jest otwarta', 'zamknieta');
  return db;
}

/** Przygotowane zapytanie z pamieci (jedno na tekst SQL, wazne do zamkniecia bazy). */
function zap(sql) {
  let st = zapytania.get(sql);
  if (!st) {
    st = baza().prepare(sql);
    zapytania.set(sql, st);
  }
  return st;
}

const SCHEMAT = `
CREATE TABLE IF NOT EXISTS meta (klucz TEXT PRIMARY KEY, wartosc TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS organizacje (
  id         TEXT PRIMARY KEY,
  nazwa      TEXT,
  rodzaj     TEXT NOT NULL CHECK (rodzaj IN ('glowna','samoobsluga')),
  wlasciciel TEXT,
  utworzona  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS konta (
  login                TEXT PRIMARY KEY,
  email                TEXT UNIQUE,
  email_potwierdzony   INTEGER,
  email_nowy           TEXT,
  hash                 TEXT NOT NULL,
  sol                  TEXT NOT NULL,
  rola                 TEXT NOT NULL CHECK (rola IN ('admin','uzytkownik')),
  organizacja          TEXT NOT NULL REFERENCES organizacje(id),
  rola_w_organizacji   TEXT NOT NULL DEFAULT 'czlonek' CHECK (rola_w_organizacji IN ('wlasciciel','czlonek')),
  pochodzenie          TEXT NOT NULL CHECK (pochodzenie IN ('admin','samoobsluga')),
  zrodlo_kluczy        TEXT NOT NULL CHECK (zrodlo_kluczy IN ('serwera','wlasne')),
  plan                 TEXT,
  sesje_od             INTEGER,
  utworzony            TEXT NOT NULL,
  utworzony_ms         INTEGER,
  jezyk                TEXT NOT NULL DEFAULT 'pl' CHECK (jezyk IN ('pl','en')),
  ostatnie_logowanie   INTEGER,
  platnik              TEXT,
  platnik_tryb         TEXT CHECK (platnik_tryb IN ('test','live')),
  platnik_klient       TEXT,
  platnik_subskrypcja  TEXT,
  subskrypcja_stan     TEXT NOT NULL DEFAULT 'brak'
                       CHECK (subskrypcja_stan IN ('brak','probna','aktywna','zalegla','anulowana','wygasla')),
  subskrypcja_plan     TEXT,
  subskrypcja_waluta   TEXT,
  subskrypcja_surowy   TEXT,
  okres_do             INTEGER,
  zalegla_od           INTEGER,
  platnik_aktualizacja INTEGER,
  regulamin_wersja     TEXT,
  regulamin_czas       INTEGER,
  marketing            INTEGER NOT NULL DEFAULT 0,
  oznaczenia           TEXT,
  UNIQUE (platnik, platnik_tryb, platnik_klient)
);
CREATE INDEX IF NOT EXISTS konta_organizacja ON konta (organizacja);
CREATE INDEX IF NOT EXISTS konta_subskrypcje ON konta (subskrypcja_stan, okres_do);
CREATE INDEX IF NOT EXISTS konta_niepotwierdzone ON konta (pochodzenie, email_potwierdzony, utworzony_ms);

CREATE TABLE IF NOT EXISTS uzycie (
  login TEXT NOT NULL REFERENCES konta(login) ON DELETE CASCADE,
  okres TEXT NOT NULL,
  czynnosc TEXT NOT NULL,
  ile INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (login, okres, czynnosc)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sesje_odwolane (id TEXT PRIMARY KEY, wygasa INTEGER NOT NULL) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tokeny (
  skrot TEXT PRIMARY KEY,
  login TEXT NOT NULL REFERENCES konta(login) ON DELETE CASCADE,
  rodzaj TEXT NOT NULL CHECK (rodzaj IN ('potwierdzenie','reset','zmiana-email')),
  email TEXT NOT NULL,
  utworzony INTEGER NOT NULL, wygasa INTEGER NOT NULL, uzyty INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS tokeny_konta ON tokeny (login, rodzaj);

CREATE TABLE IF NOT EXISTS zgody (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  rodzaj TEXT NOT NULL,
  wersja TEXT, wartosc INTEGER NOT NULL,
  czas INTEGER NOT NULL,
  zrodlo TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS zgody_konta ON zgody (login, rodzaj, czas);

CREATE TABLE IF NOT EXISTS platnosci_zdarzenia (
  dostawca TEXT NOT NULL, id TEXT NOT NULL, typ TEXT NOT NULL, tryb TEXT NOT NULL,
  utworzone INTEGER NOT NULL, otrzymane INTEGER NOT NULL, przetworzone INTEGER,
  login TEXT, wynik TEXT,
  PRIMARY KEY (dostawca, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS platnosci (
  dostawca TEXT NOT NULL, id TEXT NOT NULL, tryb TEXT NOT NULL,
  login TEXT,
  kwota INTEGER NOT NULL, waluta TEXT NOT NULL, kraj TEXT,
  oplacono INTEGER NOT NULL, okres_od INTEGER, okres_do INTEGER,
  zwrot INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dostawca, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS platnosci_czas ON platnosci (tryb, oplacono);

CREATE TABLE IF NOT EXISTS konta_usuniete (
  login TEXT PRIMARY KEY, email_skrot TEXT,
  platnik TEXT, platnik_klient TEXT, usunieto INTEGER NOT NULL,
  powod TEXT
) WITHOUT ROWID;
`;

// Migracje schematu: { wersja, opis, wykonaj(db) }, rosnaco. Kazda w tej samej
// transakcji co podniesienie wersji_schematu. Numery zarezerwowane w naglowku pliku.
const MIGRACJE_SCHEMATU = [
  // { wersja: 2, opis: '...', wykonaj: (d) => d.exec('ALTER TABLE konta ADD COLUMN ...') },
  // 4 = B (platnosci): identyfikator platnosci u dostawcy przy wplacie (zwrot przy odstapieniu
  // i zwroty z panelu dostawcy), subskrypcja i pakiet wplaty (wplaty jednej umowy, ewidencja),
  // zwroty z data (ewidencja sprzedazy, PR8-09) i oswiadczenia o odstapieniu (PR8-31).
  {
    wersja: 4,
    opis: 'platnosci: platnosc/subskrypcja/plan wplaty, zwroty, odstapienia',
    wykonaj: (d) => d.exec(`
      ALTER TABLE platnosci ADD COLUMN platnosc TEXT;
      ALTER TABLE platnosci ADD COLUMN subskrypcja TEXT;
      ALTER TABLE platnosci ADD COLUMN plan TEXT;
      CREATE INDEX IF NOT EXISTS platnosci_platnosc ON platnosci (dostawca, platnosc);
      CREATE INDEX IF NOT EXISTS platnosci_subskrypcja ON platnosci (dostawca, subskrypcja);
      CREATE TABLE IF NOT EXISTS platnosci_zwroty (
        dostawca TEXT NOT NULL, id TEXT NOT NULL,
        wplata TEXT NOT NULL,
        login TEXT,
        kwota INTEGER NOT NULL, waluta TEXT NOT NULL,
        czas INTEGER NOT NULL,
        powod TEXT NOT NULL,
        PRIMARY KEY (dostawca, id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS platnosci_zwroty_czas ON platnosci_zwroty (czas);
      CREATE TABLE IF NOT EXISTS odstapienia (
        id INTEGER PRIMARY KEY,
        login TEXT NOT NULL,
        dostawca TEXT, subskrypcja TEXT,
        zlozone INTEGER NOT NULL,
        zrodlo TEXT NOT NULL,
        zawarcie INTEGER, termin INTEGER,
        tryb_zwrotu TEXT,
        kwota_zwrotu INTEGER, waluta TEXT, dni_uzyte INTEGER, dni_okresu INTEGER,
        stan TEXT NOT NULL,
        blad TEXT, zakonczone INTEGER
      );
      CREATE INDEX IF NOT EXISTS odstapienia_konta ON odstapienia (login, zlozone);
    `),
  },
];

function utworzSchemat(d) {
  d.exec('BEGIN IMMEDIATE');
  let wersja;
  try {
    d.exec(SCHEMAT);
    const w = d.prepare("SELECT wartosc FROM meta WHERE klucz = 'wersja_schematu'").get();
    wersja = w ? Number(w.wartosc) : 0;
    const ustaw = d.prepare("INSERT INTO meta (klucz, wartosc) VALUES ('wersja_schematu', ?) "
      + 'ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc');
    if (!wersja) {
      wersja = 1;
      ustaw.run(String(wersja));
    }
    for (const m of MIGRACJE_SCHEMATU.slice().sort((a, b) => a.wersja - b.wersja)) {
      if (m.wersja <= wersja) continue;
      m.wykonaj(d);
      wersja = m.wersja;
      ustaw.run(String(wersja));
      console.log(`[magazyn] schemat: migracja ${m.wersja} (${m.opis})`);
    }
    // Organizacja zespolu glownego istnieje zawsze: konta z CLI i z migracji naleza do niej.
    d.prepare("INSERT OR IGNORE INTO organizacje (id, nazwa, rodzaj, wlasciciel, utworzona) VALUES (?, NULL, 'glowna', NULL, ?)")
      .run(GLOWNA, Date.now());
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* transakcja juz zamknieta */ }
    throw e;
  }
  const najnowsza = Math.max(WERSJA_SCHEMATU, ...MIGRACJE_SCHEMATU.map((m) => m.wersja));
  if (wersja > najnowsza) {
    // Baza z nowszego wydania (kod cofniety bez cofniecia bazy). Nie zatrzymujemy
    // uslugi: zapytania wymieniaja kolumny z nazwy, ale administrator ma to wiedziec.
    console.error(`[magazyn] UWAGA: schemat bazy w wersji ${wersja}, a ten kod zna najwyzej ${najnowsza}. `
      + 'Wroc do nowszego kodu albo przywroc baze z kopii sprzed aktualizacji.');
  }
  return wersja;
}

/**
 * Otwiera (albo przelacza na inny plik) baze. Tworzy katalog i plik z trybem
 * 0600 (SQLite zaklada pliki -wal i -shm z uprawnieniami pliku bazy), schemat
 * i wiersz organizacji 'glowna'. Zwraca opis stanu.
 *   otworz({ plik, timeoutMs })   timeoutMs: czekanie na blokade (serwer 2000, CLI 5000)
 */
function otworz({ plik, timeoutMs = 2000 } = {}) {
  if (!sqlite) {
    throw new BladMagazynu('modul node:sqlite jest niedostepny - Content AI wymaga Node 22.13 albo nowszego', 'brak-modulu');
  }
  if (!plik) throw new Error('magazyn.otworz: brak sciezki pliku bazy');
  const sciezka = path.resolve(plik);
  if (db && plikBazy === sciezka) return stan();
  zamknij();
  fs.mkdirSync(path.dirname(sciezka), { recursive: true, mode: 0o700 });
  try {
    fs.closeSync(fs.openSync(sciezka, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600));
  } catch (e) {
    if (e.code !== 'EEXIST') throw new BladMagazynu(`nie mozna utworzyc pliku bazy (${e.code || e.message})`, e.message);
  }
  let nowa = null;
  plikBazy = sciezka;           // nazwa pliku w komunikatach bledow z otwarcia
  try {
    nowa = new sqlite.DatabaseSync(sciezka, { timeout: timeoutMs, enableForeignKeyConstraints: true });
    const tryb = nowa.prepare('PRAGMA journal_mode = WAL').get();
    if (!tryb || String(tryb.journal_mode).toLowerCase() !== 'wal') {
      console.warn(`[magazyn] system plikow nie obsluguje trybu WAL (tryb: ${tryb && tryb.journal_mode}); dziala wolniej, ale poprawnie`);
    }
    nowa.exec('PRAGMA synchronous = FULL');
    nowa.exec('PRAGMA foreign_keys = ON');
    utworzSchemat(nowa);
  } catch (e) {
    try { if (nowa) nowa.close(); } catch { /* juz zamknieta */ }
    const przetlumaczony = przetlumacz(e);
    // Uszkodzony plik zostaje nietkniety, a obok laduje kopia (jak przy plikach JSON).
    if (przetlumaczony instanceof BladMagazynu && /CORRUPT|NOTADB/.test(przetlumaczony.message)) pliki.zachowajKopie(sciezka);
    const blad = przetlumaczony instanceof BladMagazynu ? przetlumaczony
      : new BladMagazynu(`otwarcie bazy nie powiodlo sie (${e.message})`, e.message);
    plikBazy = null;
    throw blad;
  }
  db = nowa;
  zapytania.clear();
  poziomTransakcji = 0;
  return stan();
}

function zamknij() {
  zapytania.clear();
  poziomTransakcji = 0;
  if (db) {
    try { db.close(); } catch (e) { console.error('[magazyn] zamkniecie:', e.message); }
  }
  db = null;
  plikBazy = null;
}

function otwarty() { return Boolean(db); }
function sciezkaBazy() { return plikBazy; }

/**
 * Transakcja BEGIN IMMEDIATE ... COMMIT; wyjatek = ROLLBACK i rzucenie dalej.
 * Zagniezdzona transakcja to punkt zapisu (SAVEPOINT), wiec funkcje magazynu
 * z wlasna transakcja mozna wolac wewnatrz wiekszej. fn musi byc SYNCHRONICZNA.
 */
function transakcja(fn) {
  const d = baza();
  const nazwa = poziomTransakcji > 0 ? `p${poziomTransakcji}` : null;
  try {
    d.exec(nazwa ? `SAVEPOINT ${nazwa}` : 'BEGIN IMMEDIATE');
  } catch (e) {
    throw przetlumacz(e);
  }
  poziomTransakcji += 1;
  try {
    const wynik = fn();
    if (wynik && typeof wynik.then === 'function') {
      throw new Error('magazyn.transakcja: funkcja musi byc synchroniczna (await wpuscilby do transakcji cudze zapytania)');
    }
    d.exec(nazwa ? `RELEASE ${nazwa}` : 'COMMIT');
    return wynik;
  } catch (e) {
    try {
      if (nazwa) { d.exec(`ROLLBACK TO ${nazwa}`); d.exec(`RELEASE ${nazwa}`); } else d.exec('ROLLBACK');
    } catch { /* transakcje zamknal juz sam SQLite */ }
    throw przetlumacz(e);
  } finally {
    poziomTransakcji -= 1;
  }
}

// ─── Identyfikatory i e-mail ─────────────────────────────────────────────────

const ALFABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 'k-' albo 'o-' + 12 znakow [a-z2-7] (60 bitow z crypto.randomBytes). Zgodne z WZOR_LOGINU. */
function nowyIdentyfikator(prefiks) {
  if (prefiks !== 'k' && prefiks !== 'o') throw new Error(`nieznany prefiks identyfikatora: ${prefiks}`);
  let reszta = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  let wynik = '';
  for (let i = 0; i < 12; i += 1) {
    wynik += ALFABET[Number(reszta & 31n)];
    reszta >>= 5n;
  }
  return `${prefiks}-${wynik}`;
}

/** E-mail w postaci, w ktorej lezy w bazie: trim, NFC, male litery. Pusty = null. */
function normalizujEmail(email) {
  if (email === null || email === undefined) return null;
  const e = String(email).trim().normalize('NFC').toLowerCase();
  return e || null;
}

function dzisiaj(teraz = Date.now()) {
  return new Date(teraz).toISOString().slice(0, 10);
}

// ─── Konta ───────────────────────────────────────────────────────────────────

// Obiekt konta w kodzie (camelCase) -> kolumna. Kod, ktory czyta u.login, u.rola,
// u.plan, u.sesjeOd, dziala tak samo jak przy pliku JSON.
const POLA_KONTA = {
  login: 'login', email: 'email', emailPotwierdzony: 'email_potwierdzony', emailNowy: 'email_nowy',
  hash: 'hash', sol: 'sol', rola: 'rola', organizacja: 'organizacja', rolaWOrganizacji: 'rola_w_organizacji',
  pochodzenie: 'pochodzenie', zrodloKluczy: 'zrodlo_kluczy', plan: 'plan', sesjeOd: 'sesje_od',
  utworzony: 'utworzony', utworzonyMs: 'utworzony_ms', jezyk: 'jezyk', ostatnieLogowanie: 'ostatnie_logowanie',
  platnik: 'platnik', platnikTryb: 'platnik_tryb', platnikKlient: 'platnik_klient',
  platnikSubskrypcja: 'platnik_subskrypcja', subskrypcjaStan: 'subskrypcja_stan', subskrypcjaPlan: 'subskrypcja_plan',
  subskrypcjaWaluta: 'subskrypcja_waluta', subskrypcjaSurowy: 'subskrypcja_surowy', okresDo: 'okres_do',
  zaleglaOd: 'zalegla_od', platnikAktualizacja: 'platnik_aktualizacja', regulaminWersja: 'regulamin_wersja',
  regulaminCzas: 'regulamin_czas', marketing: 'marketing', oznaczenia: 'oznaczenia',
};
const KOLUMNY_KONTA = Object.values(POLA_KONTA).map((k) => `k.${k}`).join(', ');

function zWiersza(w) {
  if (!w) return null;
  const konto = {};
  for (const [pole, kolumna] of Object.entries(POLA_KONTA)) konto[pole] = w[kolumna] === undefined ? null : w[kolumna];
  konto.marketing = Boolean(konto.marketing);
  if (konto.oznaczenia !== null) {
    try { konto.oznaczenia = JSON.parse(konto.oznaczenia); } catch { konto.oznaczenia = null; }
  }
  if (w.org_id !== undefined) {
    konto.org = { id: w.org_id, nazwa: w.org_nazwa, rodzaj: w.org_rodzaj, wlasciciel: w.org_wlasciciel, utworzona: w.org_utworzona };
  }
  return konto;
}

function doKolumny(pole, wartosc) {
  if (wartosc === undefined) return undefined;
  if (pole === 'marketing') return wartosc ? 1 : 0;
  if (pole === 'oznaczenia') return wartosc === null ? null : JSON.stringify(wartosc);
  if (pole === 'email' || pole === 'emailNowy') return normalizujEmail(wartosc);
  if (typeof wartosc === 'boolean') return wartosc ? 1 : 0;
  return wartosc;
}

/** Konto po loginie albo null. */
function konto(login) {
  if (typeof login !== 'string' || !login) return null;
  return zWiersza(zap(`SELECT ${KOLUMNY_KONTA} FROM konta k WHERE k.login = ?`).get(login));
}

/** Konto razem z wierszem organizacji w polu `org` (jedno zapytanie). */
function kontoZOrganizacja(login) {
  if (typeof login !== 'string' || !login) return null;
  return zWiersza(zap(`SELECT ${KOLUMNY_KONTA}, o.id AS org_id, o.nazwa AS org_nazwa, o.rodzaj AS org_rodzaj,
    o.wlasciciel AS org_wlasciciel, o.utworzona AS org_utworzona
    FROM konta k JOIN organizacje o ON o.id = k.organizacja WHERE k.login = ?`).get(login));
}

/** Konto po e-mailu (normalizowanym tak samo jak przy zapisie) albo null. */
function kontoPoEmailu(email) {
  const e = normalizujEmail(email);
  if (!e) return null;
  return zWiersza(zap(`SELECT ${KOLUMNY_KONTA} FROM konta k WHERE k.email = ?`).get(e));
}

/** Konto po identyfikatorze klienta u dostawcy platnosci (w danym trybie test/live). */
function kontoPoKliencie(platnik, tryb, id) {
  if (!platnik || !tryb || !id) return null;
  return zWiersza(zap(`SELECT ${KOLUMNY_KONTA} FROM konta k
    WHERE k.platnik = ? AND k.platnik_tryb = ? AND k.platnik_klient = ?`).get(platnik, tryb, id));
}

/**
 * Lista kont (CLI, /api/status, eksport). Pelne obiekty, takze hash i sol -
 * wolajacy nie wysyla ich na zewnatrz.
 *   listaKont({ szukaj, organizacja, pochodzenie, limit = 1000, od = 0 })
 */
function listaKont({ szukaj, organizacja, pochodzenie, limit = 1000, od = 0 } = {}) {
  const warunki = [];
  const parametry = [];
  if (szukaj) { warunki.push('(k.login LIKE ? OR k.email LIKE ?)'); parametry.push(`%${szukaj}%`, `%${szukaj}%`); }
  if (organizacja) { warunki.push('k.organizacja = ?'); parametry.push(organizacja); }
  if (pochodzenie) { warunki.push('k.pochodzenie = ?'); parametry.push(pochodzenie); }
  const gdzie = warunki.length ? `WHERE ${warunki.join(' AND ')}` : '';
  parametry.push(Math.max(1, Math.min(Number(limit) || 1000, 100000)), Math.max(0, Number(od) || 0));
  return zap(`SELECT ${KOLUMNY_KONTA} FROM konta k ${gdzie} ORDER BY k.utworzony_ms IS NULL DESC, k.utworzony_ms, k.login
    LIMIT ? OFFSET ?`).all(...parametry).map(zWiersza);
}

function liczbaKont({ pochodzenie, organizacja } = {}) {
  if (pochodzenie) return zap('SELECT count(*) AS n FROM konta WHERE pochodzenie = ?').get(pochodzenie).n;
  if (organizacja) return zap('SELECT count(*) AS n FROM konta WHERE organizacja = ?').get(organizacja).n;
  return zap('SELECT count(*) AS n FROM konta').get().n;
}

/** Liczba operatorow (rola admin w organizacji glownej) - ostatniego nie wolno usunac ani zdegradowac. */
function liczbaOperatorow() {
  return zap("SELECT count(*) AS n FROM konta WHERE rola = 'admin' AND organizacja = ?").get(GLOWNA).n;
}

/**
 * Rejestracja: organizacja 'o-...' i konto 'k-...' (wlasciciel) w jednej transakcji.
 * E-mail zajety -> BladKonfliktu (pole 'email').
 *   utworzOrganizacjeIKonto({ email, hash, sol, jezyk, plan, zrodloKluczy, teraz }) -> konto z polem org
 */
function utworzOrganizacjeIKonto({ email, hash, sol, jezyk = 'pl', plan = null, zrodloKluczy = 'wlasne', teraz = Date.now() } = {}) {
  const adres = normalizujEmail(email);
  if (!adres) throw new Error('utworzOrganizacjeIKonto: brak e-maila');
  if (!hash || !sol) throw new Error('utworzOrganizacjeIKonto: brak hash/sol');
  return transakcja(() => {
    for (let proba = 0; proba < 5; proba += 1) {
      const idOrg = nowyIdentyfikator('o');
      const login = nowyIdentyfikator('k');
      if (organizacja(idOrg) || konto(login)) continue;
      zap("INSERT INTO organizacje (id, nazwa, rodzaj, wlasciciel, utworzona) VALUES (?, NULL, 'samoobsluga', ?, ?)")
        .run(idOrg, login, teraz);
      zap(`INSERT INTO konta (login, email, hash, sol, rola, organizacja, rola_w_organizacji, pochodzenie,
          zrodlo_kluczy, plan, utworzony, utworzony_ms, jezyk)
        VALUES (?, ?, ?, ?, 'uzytkownik', ?, 'wlasciciel', 'samoobsluga', ?, ?, ?, ?, ?)`)
        .run(login, adres, hash, sol, idOrg, zrodloKluczy, plan, dzisiaj(teraz), teraz, jezyk === 'en' ? 'en' : 'pl');
      return kontoZOrganizacja(login);
    }
    throw new Error('utworzOrganizacjeIKonto: nie udalo sie wylosowac wolnego identyfikatora');
  });
}

/**
 * Konto zakladane przez administratora (CLI 'dodaj'). Login zajety -> BladKonfliktu ('login').
 *   utworzKonto({ login, hash, sol, rola, organizacja, pochodzenie, zrodloKluczy, plan, email, utworzony, teraz })
 */
function utworzKonto({
  login, hash, sol, rola = 'uzytkownik', organizacja: idOrg = GLOWNA, pochodzenie = 'admin',
  zrodloKluczy = 'serwera', plan = null, email = null, utworzony = null, jezyk = 'pl', teraz = Date.now(),
} = {}) {
  if (!login || !hash || !sol) throw new Error('utworzKonto: wymagane login, hash i sol');
  return transakcja(() => {
    if (konto(login)) throw new BladKonfliktu('login', `Konto ${login} juz istnieje`);
    zap(`INSERT INTO konta (login, email, hash, sol, rola, organizacja, rola_w_organizacji, pochodzenie,
        zrodlo_kluczy, plan, utworzony, utworzony_ms, jezyk)
      VALUES (?, ?, ?, ?, ?, ?, 'czlonek', ?, ?, ?, ?, ?, ?)`)
      .run(login, normalizujEmail(email), hash, sol, rola, idOrg, pochodzenie, zrodloKluczy, plan,
        utworzony || dzisiaj(teraz), teraz, jezyk === 'en' ? 'en' : 'pl');
    return konto(login);
  });
}

/**
 * Zmiana pol konta. Tylko znane pola (camelCase z POLA_KONTA, bez loginu),
 * inaczej wyjatek: literowka nie moze cicho zgubic zmiany. undefined = pomin,
 * null = wyczysc. Zwraca true, gdy konto istnialo.
 */
function zmienKonto(login, pola) {
  if (!pola || typeof pola !== 'object') throw new Error('zmienKonto: brak pol');
  const zestaw = [];
  const wartosci = [];
  for (const [pole, wartosc] of Object.entries(pola)) {
    if (pole === 'login' || !Object.prototype.hasOwnProperty.call(POLA_KONTA, pole)) {
      throw new Error(`zmienKonto: nieznane albo niezmienne pole "${pole}"`);
    }
    const w = doKolumny(pole, wartosc);
    if (w === undefined) continue;
    zestaw.push(`${POLA_KONTA[pole]} = ?`);
    wartosci.push(w);
  }
  if (!zestaw.length) return Boolean(konto(login));
  const wynik = zap(`UPDATE konta SET ${zestaw.join(', ')} WHERE login = ?`).run(...wartosci, login);
  return wynik.changes > 0;
}

/**
 * Usuwa konto (kaskadowo liczniki i tokeny) i dopisuje wpis do konta_usuniete.
 * Pliki konta (baza wiedzy) i organizacji usuwa wolajacy (konta.js, CLI).
 *   usunKonto(login, { powod: 'uzytkownik'|'admin'|'niepotwierdzone', emailSkrot, teraz }) -> boolean
 */
function usunKonto(login, { powod = 'admin', emailSkrot = null, teraz = Date.now() } = {}) {
  return transakcja(() => {
    const k = konto(login);
    if (!k) return false;
    zap(`INSERT INTO konta_usuniete (login, email_skrot, platnik, platnik_klient, usunieto, powod) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(login) DO UPDATE SET email_skrot = excluded.email_skrot, platnik = excluded.platnik,
        platnik_klient = excluded.platnik_klient, usunieto = excluded.usunieto, powod = excluded.powod`)
      .run(login, emailSkrot, k.platnik, k.platnikKlient, teraz, powod);
    zap('DELETE FROM konta WHERE login = ?').run(login);
    return true;
  });
}

/** Wpis o usunietym koncie (rozliczenia, naduzycia darmowego pakietu) albo null. */
function kontoUsuniete(login) {
  const w = zap('SELECT login, email_skrot AS emailSkrot, platnik, platnik_klient AS platnikKlient, usunieto, powod FROM konta_usuniete WHERE login = ?')
    .get(login);
  return w ? { ...w } : null;
}

/** Czy skrot e-maila wystepuje wsrod kont usunietych (drugie darmowe konto na ten sam adres). */
function emailBylUsuniety(emailSkrot) {
  if (!emailSkrot) return false;
  return Boolean(zap('SELECT 1 AS x FROM konta_usuniete WHERE email_skrot = ? LIMIT 1').get(emailSkrot));
}

// ─── Organizacje ─────────────────────────────────────────────────────────────

function organizacja(id) {
  if (typeof id !== 'string' || !id) return null;
  return zap('SELECT id, nazwa, rodzaj, wlasciciel, utworzona FROM organizacje WHERE id = ?').get(id) || null;
}

/** Usuwa organizacje samoobslugowa bez kont. Organizacji 'glowna' nie usuwa nigdy. */
function usunOrganizacje(id) {
  if (id === GLOWNA) throw new Error('organizacji glownej nie usuwamy');
  return transakcja(() => {
    if (liczbaKont({ organizacja: id }) > 0) throw new Error(`organizacja ${id} ma jeszcze konta`);
    return zap('DELETE FROM organizacje WHERE id = ?').run(id).changes > 0;
  });
}

function zmienOrganizacje(id, { nazwa } = {}) {
  return zap('UPDATE organizacje SET nazwa = ? WHERE id = ?').run(nazwa === undefined ? null : nazwa, id).changes > 0;
}

// ─── Liczniki uzycia ─────────────────────────────────────────────────────────
// okres: 'zawsze' albo 'RRRR-MM'; czynnosc: artykul, grafika, audio, transkrypcja,
// wywolanie, serwer:serp, serwer:wektory, serwer:strony.

/** { czynnosc: ile } dla okresu. */
function uzycie(login, okres) {
  const wynik = {};
  for (const w of zap('SELECT czynnosc, ile FROM uzycie WHERE login = ? AND okres = ?').all(login, okres)) wynik[w.czynnosc] = w.ile;
  return wynik;
}

/** { okres: { czynnosc: ile } } - wszystkie okresy konta (eksport, eksport-json). */
function uzycieKonta(login) {
  const wynik = {};
  for (const w of zap('SELECT okres, czynnosc, ile FROM uzycie WHERE login = ? ORDER BY okres, czynnosc').all(login)) {
    if (!wynik[w.okres]) wynik[w.okres] = {};
    wynik[w.okres][w.czynnosc] = w.ile;
  }
  return wynik;
}

/** Atomowe dopisanie (ujemne ile = zwrot), nigdy ponizej zera. Zwraca nowa wartosc. */
function policz(login, okres, czynnosc, ile = 1) {
  const w = zap(`INSERT INTO uzycie (login, okres, czynnosc, ile) VALUES (?, ?, ?, max(?, 0))
    ON CONFLICT(login, okres, czynnosc) DO UPDATE SET ile = max(ile + ?, 0)
    RETURNING ile`).get(login, okres, czynnosc, Number(ile) || 0, Number(ile) || 0);
  return w ? w.ile : 0;
}

/**
 * Rezerwacja jednej sztuki, jesli zuzycie jest ponizej limitu (KOD8-20: rownolegle
 * zapytania nie omijaja limitu). Atomowo w jednym zapytaniu. Zwolnienie: policz(..., -1).
 *   zarezerwuj(login, okres, czynnosc, limit) -> { ok, ile }
 */
function zarezerwuj(login, okres, czynnosc, limit) {
  if (limit === null || limit === undefined) return { ok: true, ile: null };
  if (!(Number(limit) > 0)) return { ok: false, ile: uzycie(login, okres)[czynnosc] || 0 };
  const w = zap(`INSERT INTO uzycie (login, okres, czynnosc, ile) VALUES (?, ?, ?, 1)
    ON CONFLICT(login, okres, czynnosc) DO UPDATE SET ile = ile + 1 WHERE ile < ?
    RETURNING ile`).get(login, okres, czynnosc, Number(limit));
  if (w) return { ok: true, ile: w.ile };
  return { ok: false, ile: uzycie(login, okres)[czynnosc] || 0 };
}

/** Ustawia licznik na wartosc (migracja z JSON: wartosc z pliku wygrywa). */
function ustawUzycie(login, okres, czynnosc, ile) {
  zap(`INSERT INTO uzycie (login, okres, czynnosc, ile) VALUES (?, ?, ?, ?)
    ON CONFLICT(login, okres, czynnosc) DO UPDATE SET ile = excluded.ile`).run(login, okres, czynnosc, Math.max(0, Number(ile) || 0));
}

// ─── Sesje odwolane (wylogowanie) ────────────────────────────────────────────

function odwolajSesje(id, wygasa) {
  if (!id) return;
  zap(`INSERT INTO sesje_odwolane (id, wygasa) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET wygasa = max(wygasa, excluded.wygasa)`).run(String(id), Number(wygasa) || 0);
}

function sesjaOdwolana(id) {
  if (!id) return false;
  return Boolean(zap('SELECT 1 AS x FROM sesje_odwolane WHERE id = ?').get(String(id)));
}

/** [{ id, wygasa }] jeszcze waznych wpisow (eksport-json, testy). */
function sesjeOdwolane(teraz = Date.now()) {
  return zap('SELECT id, wygasa FROM sesje_odwolane WHERE wygasa > ? ORDER BY wygasa').all(teraz).map((w) => ({ id: w.id, wygasa: w.wygasa }));
}

function liczbaOdwolanych(teraz = Date.now()) {
  return zap('SELECT count(*) AS n FROM sesje_odwolane WHERE wygasa > ?').get(teraz).n;
}

// ─── Tokeny e-mailowe (ARCH8-07) ─────────────────────────────────────────────
// Token jawny tylko w odnosniku w e-mailu; w bazie sha256(token) hex.

function skrotTokenu(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

const WZOR_TOKENU = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Nowy token jednorazowy; uniewaznia niezuzyte tokeny tego samego rodzaju konta.
 *   zapiszToken({ login, rodzaj: 'potwierdzenie'|'reset'|'zmiana-email', email, wazneMs, teraz }) -> token jawny
 */
function zapiszToken({ login, rodzaj, email, wazneMs, teraz = Date.now() } = {}) {
  if (!login || !rodzaj || !email || !(Number(wazneMs) > 0)) throw new Error('zapiszToken: wymagane login, rodzaj, email, wazneMs');
  const token = crypto.randomBytes(32).toString('base64url');
  transakcja(() => {
    zap('DELETE FROM tokeny WHERE login = ? AND rodzaj = ? AND uzyty IS NULL').run(login, rodzaj);
    zap('INSERT INTO tokeny (skrot, login, rodzaj, email, utworzony, wygasa, uzyty) VALUES (?, ?, ?, ?, ?, ?, NULL)')
      .run(skrotTokenu(token), login, rodzaj, normalizujEmail(email), teraz, teraz + Number(wazneMs));
  });
  return token;
}

/**
 * Odczyt bez zuzycia (GET formularza resetu, ekran potwierdzenia). Domyslnie tylko
 * niezuzyty i niewygasly; z { takzeUzyte: true } takze zuzyty (pole uzyty = czas).
 *   sprawdzToken(token, rodzaj, { teraz, takzeUzyte }) -> { login, email, wygasa, uzyty, utworzony } | null
 */
function sprawdzToken(token, rodzaj, { teraz = Date.now(), takzeUzyte = false } = {}) {
  if (typeof token !== 'string' || !WZOR_TOKENU.test(token)) return null;
  const w = zap('SELECT login, email, utworzony, wygasa, uzyty FROM tokeny WHERE skrot = ? AND rodzaj = ?').get(skrotTokenu(token), rodzaj);
  if (!w || w.wygasa <= teraz) return null;
  if (w.uzyty && !takzeUzyte) return null;
  return { login: w.login, email: w.email, utworzony: w.utworzony, wygasa: w.wygasa, uzyty: w.uzyty };
}

/** Zuzycie atomowe: drugi raz ten sam token daje null. -> { login, email } | null */
function zuzyjToken(token, rodzaj, { teraz = Date.now() } = {}) {
  if (typeof token !== 'string' || !WZOR_TOKENU.test(token)) return null;
  const w = zap(`UPDATE tokeny SET uzyty = ? WHERE skrot = ? AND rodzaj = ? AND uzyty IS NULL AND wygasa > ?
    RETURNING login, email`).get(teraz, skrotTokenu(token), rodzaj, teraz);
  return w ? { login: w.login, email: w.email } : null;
}

// ─── Zgody (ARCH8-08) ────────────────────────────────────────────────────────

/** dopiszZgode({ login, rodzaj, wersja, wartosc, zrodlo, ip, teraz }) -> id wpisu */
function dopiszZgode({ login, rodzaj, wersja = null, wartosc, zrodlo, ip = null, teraz = Date.now() } = {}) {
  if (!login || !rodzaj || !zrodlo) throw new Error('dopiszZgode: wymagane login, rodzaj, zrodlo');
  const w = zap('INSERT INTO zgody (login, rodzaj, wersja, wartosc, czas, zrodlo, ip) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .get(login, rodzaj, wersja, wartosc ? 1 : 0, teraz, zrodlo, ip);
  return w.id;
}

/** Dziennik zgod konta, od najstarszej. */
function zgody(login) {
  return zap('SELECT id, rodzaj, wersja, wartosc, czas, zrodlo, ip FROM zgody WHERE login = ? ORDER BY czas, id').all(login)
    .map((w) => ({ id: w.id, rodzaj: w.rodzaj, wersja: w.wersja, wartosc: Boolean(w.wartosc), czas: w.czas, zrodlo: w.zrodlo, ip: w.ip }));
}

// ─── Platnosci (ARCH8-13..18) ────────────────────────────────────────────────

/** Idempotencja webhooka. -> 'nowe' | 'przetworzone' | 'nieprzetworzone' */
function zapiszZdarzenie({ dostawca, id, typ, tryb, utworzone, teraz = Date.now() } = {}) {
  const w = zap(`INSERT INTO platnosci_zdarzenia (dostawca, id, typ, tryb, utworzone, otrzymane) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(dostawca, id) DO NOTHING`).run(dostawca, id, typ, tryb, Number(utworzone) || teraz, teraz);
  if (w.changes > 0) return 'nowe';
  const byl = zap('SELECT przetworzone FROM platnosci_zdarzenia WHERE dostawca = ? AND id = ?').get(dostawca, id);
  return byl && byl.przetworzone ? 'przetworzone' : 'nieprzetworzone';
}

function oznaczZdarzenie(dostawca, id, { wynik = 'ok', login = null, teraz = Date.now() } = {}) {
  return zap('UPDATE platnosci_zdarzenia SET przetworzone = ?, wynik = ?, login = ? WHERE dostawca = ? AND id = ?')
    .run(teraz, wynik, login, dostawca, id).changes > 0;
}

/** Zdarzenia zapisane, ale nieprzetworzone (do /api/status). */
function zdarzeniaNieprzetworzone(limit = 50) {
  return zap(`SELECT dostawca, id, typ, tryb, utworzone, otrzymane FROM platnosci_zdarzenia
    WHERE przetworzone IS NULL ORDER BY otrzymane LIMIT ?`).all(limit).map((w) => ({ ...w }));
}

/**
 * Wiaze konto z klientem u dostawcy. Inny klient przy koncie albo ten klient przy
 * innym koncie = 'konflikt' (decyzja administratora).
 *   powiazKlienta(login, { platnik, tryb, idKlienta }) -> 'ok' | 'konflikt' | 'brak-konta'
 */
function powiazKlienta(login, { platnik, tryb, idKlienta } = {}) {
  try {
    return transakcja(() => {
      const k = konto(login);
      if (!k) return 'brak-konta';
      if (k.platnikKlient && (k.platnikKlient !== idKlienta || k.platnik !== platnik || k.platnikTryb !== tryb)) return 'konflikt';
      zap('UPDATE konta SET platnik = ?, platnik_tryb = ?, platnik_klient = ? WHERE login = ?').run(platnik, tryb, idKlienta, login);
      return 'ok';
    });
  } catch (e) {
    if (e instanceof BladKonfliktu) return 'konflikt';
    throw e;
  }
}

/**
 * Zapis znormalizowanego stanu subskrypcji (ARCH8-16): zalegla_od ustawiane przy
 * wejsciu w 'zalegla', czyszczone przy wyjsciu.
 *   zastosujStanSubskrypcji(login, { stan, plan, idSubskrypcji, okresDo, waluta, surowy }, teraz) -> boolean
 */
function zastosujStanSubskrypcji(login, stanSub, teraz = Date.now()) {
  const s = stanSub || {};
  return transakcja(() => {
    const k = konto(login);
    if (!k) return false;
    const zaleglaOd = s.stan === 'zalegla' ? (k.subskrypcjaStan === 'zalegla' && k.zaleglaOd ? k.zaleglaOd : teraz) : null;
    zap(`UPDATE konta SET subskrypcja_stan = ?, subskrypcja_plan = ?, platnik_subskrypcja = ?, subskrypcja_waluta = ?,
        subskrypcja_surowy = ?, okres_do = ?, zalegla_od = ?, platnik_aktualizacja = ? WHERE login = ?`)
      .run(s.stan || 'brak', s.plan || null, s.idSubskrypcji || null, s.waluta || null,
        s.surowy === undefined || s.surowy === null ? null : String(s.surowy), s.okresDo || null, zaleglaOd, teraz, login);
    return true;
  });
}

/**
 * Rejestr wplat (invoice.paid). -> true gdy nowa wplata, false gdy juz byla.
 * platnosc: identyfikator platnosci u dostawcy (pi_..., ch_...) do zwrotu; subskrypcja i plan:
 * wplaty jednej umowy (odstapienie) i ewidencja (migracja schematu 4, B).
 */
function dopiszPlatnosc({
  dostawca, id, tryb, login = null, kwota, waluta, kraj = null, oplacono, okresOd = null, okresDo = null,
  platnosc = null, subskrypcja = null, plan = null,
} = {}) {
  return zap(`INSERT INTO platnosci (dostawca, id, tryb, login, kwota, waluta, kraj, oplacono, okres_od, okres_do, platnosc, subskrypcja, plan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dostawca, id) DO NOTHING`)
    .run(dostawca, id, tryb, login, Number(kwota) || 0, String(waluta || '').toLowerCase(), kraj ? String(kraj).toUpperCase() : null,
      Number(oplacono) || Date.now(), okresOd, okresDo, platnosc || null, subskrypcja || null, plan || null).changes > 0;
}

const POLA_WPLATY = `dostawca, id, tryb, login, kwota, waluta, kraj, oplacono, okres_od AS okresOd, okres_do AS okresDo, zwrot,
  platnosc, subskrypcja, plan`;

/** Uzupelnia brakujace pola wplaty zapisanej wczesniej (pola juz zapisane zostaja). -> boolean */
function uzupelnijPlatnosc(dostawca, id, { login, kraj, platnosc, subskrypcja, plan } = {}) {
  return zap(`UPDATE platnosci SET login = COALESCE(login, ?), kraj = COALESCE(kraj, ?), platnosc = COALESCE(platnosc, ?),
      subskrypcja = COALESCE(subskrypcja, ?), plan = COALESCE(plan, ?) WHERE dostawca = ? AND id = ?`)
    .run(login || null, kraj ? String(kraj).toUpperCase() : null, platnosc || null, subskrypcja || null, plan || null, dostawca, id).changes > 0;
}

/** Wplata po identyfikatorze albo null. */
function wplata(dostawca, id) {
  const w = zap(`SELECT ${POLA_WPLATY} FROM platnosci WHERE dostawca = ? AND id = ?`).get(dostawca, id);
  return w ? { ...w } : null;
}

/** Wplata po identyfikatorze platnosci u dostawcy (zwrot z panelu dostawcy: charge.refunded). */
function wplataPoPlatnosci(dostawca, platnosc) {
  if (!platnosc) return null;
  const w = zap(`SELECT ${POLA_WPLATY} FROM platnosci WHERE dostawca = ? AND platnosc = ? ORDER BY oplacono LIMIT 1`).get(dostawca, platnosc);
  return w ? { ...w } : null;
}

/** Wplaty jednej subskrypcji (umowy), od najstarszej. */
function wplatySubskrypcji(dostawca, subskrypcja) {
  if (!subskrypcja) return [];
  return zap(`SELECT ${POLA_WPLATY} FROM platnosci WHERE dostawca = ? AND subskrypcja = ? ORDER BY oplacono, id`)
    .all(dostawca, subskrypcja).map((w) => ({ ...w }));
}

/**
 * Zwrot do wplaty (odstapienie, kraj spoza listy, zwrot z panelu dostawcy). Idempotentnie po
 * identyfikatorze zwrotu; pole platnosci.zwrot = suma zwrotow wplaty (nie mniej niz bylo).
 *   dopiszZwrot({ dostawca, id, wplata, login, kwota, waluta, czas, powod }) -> true gdy nowy
 */
function dopiszZwrot({ dostawca, id, wplata: idWplaty, login = null, kwota, waluta, czas = Date.now(), powod = 'inny' } = {}) {
  if (!dostawca || !id || !idWplaty) throw new Error('dopiszZwrot: wymagane dostawca, id i wplata');
  return transakcja(() => {
    const nowy = zap(`INSERT INTO platnosci_zwroty (dostawca, id, wplata, login, kwota, waluta, czas, powod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dostawca, id) DO NOTHING`)
      .run(dostawca, id, idWplaty, login, Math.max(0, Number(kwota) || 0), String(waluta || '').toLowerCase(), Number(czas) || Date.now(), powod)
      .changes > 0;
    zap(`UPDATE platnosci SET zwrot = max(zwrot, (SELECT COALESCE(sum(kwota), 0) FROM platnosci_zwroty z WHERE z.dostawca = ? AND z.wplata = ?))
      WHERE dostawca = ? AND id = ?`).run(dostawca, idWplaty, dostawca, idWplaty);
    return nowy;
  });
}

/** Zwroty wplaty, od najstarszego. */
function zwrotyWplaty(dostawca, idWplaty) {
  return zap('SELECT dostawca, id, wplata, login, kwota, waluta, czas, powod FROM platnosci_zwroty WHERE dostawca = ? AND wplata = ? ORDER BY czas, id')
    .all(dostawca, idWplaty).map((w) => ({ ...w }));
}

/** Zwroty w okresie [od, do) dla wplat danego trybu (ewidencja): z krajem i pakietem wplaty. */
function zwrotyWOkresie({ tryb, od = 0, do: doCzasu = Number.MAX_SAFE_INTEGER } = {}) {
  return zap(`SELECT z.dostawca, z.id, z.wplata, z.login, z.kwota, z.waluta, z.czas, z.powod, p.kraj, p.plan, p.oplacono
    FROM platnosci_zwroty z JOIN platnosci p ON p.dostawca = z.dostawca AND p.id = z.wplata
    WHERE p.tryb = ? AND z.czas >= ? AND z.czas < ? ORDER BY z.czas, z.id`).all(tryb, od, doCzasu).map((w) => ({ ...w }));
}

// Oswiadczenia o odstapieniu od umowy (PR8-31): wpis zostaje po usunieciu konta (dowod, rozliczenia).
const POLA_ODSTAPIENIA = {
  stan: 'stan', kwotaZwrotu: 'kwota_zwrotu', waluta: 'waluta', dniUzyte: 'dni_uzyte', dniOkresu: 'dni_okresu',
  blad: 'blad', zakonczone: 'zakonczone', trybZwrotu: 'tryb_zwrotu', subskrypcja: 'subskrypcja',
};

function zWierszaOdstapienia(w) {
  if (!w) return null;
  return {
    id: w.id, login: w.login, dostawca: w.dostawca, subskrypcja: w.subskrypcja, zlozone: w.zlozone, zrodlo: w.zrodlo,
    zawarcie: w.zawarcie, termin: w.termin, trybZwrotu: w.tryb_zwrotu, kwotaZwrotu: w.kwota_zwrotu, waluta: w.waluta,
    dniUzyte: w.dni_uzyte, dniOkresu: w.dni_okresu, stan: w.stan, blad: w.blad, zakonczone: w.zakonczone,
  };
}

/** zapiszOdstapienie({ login, dostawca, subskrypcja, zlozone, zrodlo, zawarcie, termin, trybZwrotu }) -> id */
function zapiszOdstapienie({ login, dostawca = null, subskrypcja = null, zlozone = Date.now(), zrodlo, zawarcie = null, termin = null, trybZwrotu = null } = {}) {
  if (!login || !zrodlo) throw new Error('zapiszOdstapienie: wymagane login i zrodlo');
  return zap(`INSERT INTO odstapienia (login, dostawca, subskrypcja, zlozone, zrodlo, zawarcie, termin, tryb_zwrotu, stan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'przyjete') RETURNING id`)
    .get(login, dostawca, subskrypcja, Number(zlozone) || Date.now(), zrodlo, zawarcie, termin, trybZwrotu).id;
}

/** Zmiana pol oswiadczenia (stan: przyjete | zwrot-zlecony | bez-zwrotu | blad). Literowka = wyjatek. */
function zmienOdstapienie(id, pola = {}) {
  const zestaw = [];
  const wartosci = [];
  for (const [pole, wartosc] of Object.entries(pola)) {
    if (!Object.prototype.hasOwnProperty.call(POLA_ODSTAPIENIA, pole)) throw new Error(`zmienOdstapienie: nieznane pole "${pole}"`);
    if (wartosc === undefined) continue;
    zestaw.push(`${POLA_ODSTAPIENIA[pole]} = ?`);
    wartosci.push(wartosc);
  }
  if (!zestaw.length) return false;
  return zap(`UPDATE odstapienia SET ${zestaw.join(', ')} WHERE id = ?`).run(...wartosci, id).changes > 0;
}

function odstapienie(id) {
  return zWierszaOdstapienia(zap('SELECT * FROM odstapienia WHERE id = ?').get(id));
}

/** Oswiadczenia konta, od najnowszego. */
function odstapieniaKonta(login) {
  return zap('SELECT * FROM odstapienia WHERE login = ? ORDER BY zlozone DESC, id DESC').all(login).map(zWierszaOdstapienia);
}

/** Oswiadczenia w stanie (np. 'blad': zwrot do ponowienia, /api/status i CLI), od najstarszego. */
function odstapieniaWStanie(stan, limit = 100) {
  return zap('SELECT * FROM odstapienia WHERE stan = ? ORDER BY zlozone, id LIMIT ?').all(String(stan), Math.max(1, Number(limit) || 100)).map(zWierszaOdstapienia);
}

/** Kwota zwrocona dla wplaty (w jednostkach najmniejszych; laczna, nie przyrost). */
function ustawZwrot(dostawca, id, kwotaZwrotu) {
  return zap('UPDATE platnosci SET zwrot = ? WHERE dostawca = ? AND id = ?').run(Math.max(0, Number(kwotaZwrotu) || 0), dostawca, id).changes > 0;
}

/** Sumy w okresie [od, do) per waluta i kraj: [{ waluta, kraj, wplat, suma, zwroty }]. */
function sumyPlatnosci({ tryb, od = 0, do: doCzasu = Number.MAX_SAFE_INTEGER } = {}) {
  return zap(`SELECT waluta, kraj, count(*) AS wplat, sum(kwota) AS suma, sum(zwrot) AS zwroty FROM platnosci
    WHERE tryb = ? AND oplacono >= ? AND oplacono < ? GROUP BY waluta, kraj ORDER BY waluta, kraj`)
    .all(tryb, od, doCzasu).map((w) => ({ ...w }));
}

/** Wplaty w okresie (ewidencja CSV): pelne wiersze, od najstarszej. */
function platnosciWOkresie({ tryb, od = 0, do: doCzasu = Number.MAX_SAFE_INTEGER } = {}) {
  return zap(`SELECT ${POLA_WPLATY}
    FROM platnosci WHERE tryb = ? AND oplacono >= ? AND oplacono < ? ORDER BY oplacono, id`).all(tryb, od, doCzasu).map((w) => ({ ...w }));
}

function platnosciKonta(login) {
  return zap(`SELECT ${POLA_WPLATY}
    FROM platnosci WHERE login = ? ORDER BY oplacono`).all(login).map((w) => ({ ...w }));
}

/**
 * Konta do uzgodnienia z dostawca (zegar co 6 h): z klientem platnosci i stanem
 * zywym albo bez synchronizacji od 7 dni; najdawniej uzgadniane pierwsze.
 */
function kontaDoUzgodnienia(teraz = Date.now(), limit = 100) {
  return zap(`SELECT ${KOLUMNY_KONTA} FROM konta k WHERE k.platnik_klient IS NOT NULL
      AND (k.subskrypcja_stan IN ('probna','aktywna','zalegla','anulowana')
        OR k.platnik_aktualizacja IS NULL OR k.platnik_aktualizacja < ?)
    ORDER BY k.platnik_aktualizacja IS NOT NULL, k.platnik_aktualizacja LIMIT ?`).all(teraz - 7 * DOBA, limit).map(zWiersza);
}

// ─── Meta ────────────────────────────────────────────────────────────────────

function meta(klucz) {
  const w = zap('SELECT wartosc FROM meta WHERE klucz = ?').get(String(klucz));
  return w ? w.wartosc : null;
}

function ustawMeta(klucz, wartosc) {
  if (wartosc === null || wartosc === undefined) {
    zap('DELETE FROM meta WHERE klucz = ?').run(String(klucz));
    return;
  }
  zap('INSERT INTO meta (klucz, wartosc) VALUES (?, ?) ON CONFLICT(klucz) DO UPDATE SET wartosc = excluded.wartosc')
    .run(String(klucz), String(wartosc));
}

// ─── Migracja z JSON (wolana wylacznie z migracja.js) ─────────────────────────

/**
 * UPSERT konta z uzytkownicy.json (format R8). Pola stare z JSON wygrywaja,
 * pola nowe (e-mail, platnosci) zostaja nietkniete. sesje_od: wieksza z dwoch
 * wartosci (uniewaznienie nie moze sie cofnac). Konta samoobslugowego o tym samym
 * loginie nie rusza. -> 'nowe' | 'zmienione' | 'pominiete'
 */
function migracjaZapiszKonto({ login, hash, sol, rola, plan, sesjeOd, utworzony }, teraz = Date.now()) {
  const byl = konto(login);
  if (byl && byl.pochodzenie !== 'admin') return 'pominiete';
  zap(`INSERT INTO konta (login, hash, sol, rola, organizacja, rola_w_organizacji, pochodzenie, zrodlo_kluczy,
      plan, sesje_od, utworzony, utworzony_ms, jezyk)
    VALUES ($login, $hash, $sol, $rola, 'glowna', 'czlonek', 'admin', 'serwera', $plan, $sesjeOd,
      COALESCE($utworzony, $dzis), $teraz, 'pl')
    ON CONFLICT(login) DO UPDATE SET hash = excluded.hash, sol = excluded.sol, rola = excluded.rola, plan = excluded.plan,
      sesje_od = CASE WHEN excluded.sesje_od IS NULL THEN konta.sesje_od
                      WHEN konta.sesje_od IS NULL THEN excluded.sesje_od
                      ELSE max(konta.sesje_od, excluded.sesje_od) END,
      utworzony = COALESCE($utworzony, konta.utworzony)
    WHERE konta.pochodzenie = 'admin'`)
    .run({
      login, hash, sol, rola,
      plan: plan === undefined ? null : plan,
      sesjeOd: Number.isFinite(Number(sesjeOd)) && sesjeOd !== null ? Number(sesjeOd) : null,
      utworzony: utworzony || null,
      dzis: dzisiaj(teraz),
      teraz,
    });
  return byl ? 'zmienione' : 'nowe';
}

/** Usuwa konto 'admin' usuniete w R8 w czasie wycofania (lista z eksport-json). */
function migracjaUsunKonto(login) {
  return zap("DELETE FROM konta WHERE login = ? AND pochodzenie = 'admin'").run(login).changes > 0;
}

// ─── Kopie i sprzatanie ──────────────────────────────────────────────────────

/** Kopia spojna w trakcie pracy (sqlite.backup), zapis do pliku tymczasowego i rename. -> Promise<sciezka> */
async function kopia(sciezka) {
  const d = baza();
  const cel = path.resolve(sciezka);
  fs.mkdirSync(path.dirname(cel), { recursive: true, mode: 0o700 });
  const tymczasowy = `${cel}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await sqlite.backup(d, tymczasowy);
    fs.chmodSync(tymczasowy, 0o600);
    fs.renameSync(tymczasowy, cel);
  } catch (e) {
    try { fs.unlinkSync(tymczasowy); } catch { /* nie powstal */ }
    throw przetlumacz(e);
  }
  return cel;
}

/**
 * Kopia okresowa do katalogu: contentai-RRRRMMDD-GGMMSS.sqlite, zostaje `zostaw`
 * najnowszych. -> Promise<sciezka nowej kopii>
 */
async function kopiaOkresowa({ katalog, zostaw = 48, teraz = Date.now() } = {}) {
  const znacznik = new Date(teraz).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const cel = await kopia(path.join(katalog, `contentai-${znacznik}.sqlite`));
  const stare = fs.readdirSync(katalog).filter((n) => /^contentai-\d{8}-\d{6}\.sqlite$/.test(n)).sort();
  for (const n of stare.slice(0, Math.max(0, stare.length - zostaw))) {
    try { fs.unlinkSync(path.join(katalog, n)); } catch (e) { console.error('[magazyn] kopie:', e.message); }
  }
  ustawMeta('ostatnia_kopia', String(teraz));
  return cel;
}

function miesiacWstecz(teraz, ile) {
  const d = new Date(teraz);
  const m = d.getUTCFullYear() * 12 + d.getUTCMonth() - ile;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
}

/**
 * Sprzatanie dobowe: sesje odwolane po terminie, tokeny tydzien po terminie,
 * zdarzenia platnosci starsze niz 90 dni, liczniki miesieczne starsze niz biezacy
 * i 12 poprzednich miesiecy. Konta niepotwierdzone: kontaNiepotwierdzone() + konta.js
 * (usuwa razem z plikami). -> { sesje, tokeny, zdarzenia, liczniki }
 */
function sprzataj(teraz = Date.now()) {
  return transakcja(() => ({
    sesje: zap('DELETE FROM sesje_odwolane WHERE wygasa <= ?').run(teraz).changes,
    tokeny: zap('DELETE FROM tokeny WHERE wygasa < ?').run(teraz - 7 * DOBA).changes,
    zdarzenia: zap('DELETE FROM platnosci_zdarzenia WHERE otrzymane < ?').run(teraz - 90 * DOBA).changes,
    liczniki: zap("DELETE FROM uzycie WHERE okres <> 'zawsze' AND okres < ?").run(miesiacWstecz(teraz, 12)).changes,
  }));
}

/** Loginy kont samoobslugowych bez potwierdzenia e-maila, bez platnosci i bez logowania od `dni` dni. */
function kontaNiepotwierdzone(teraz = Date.now(), dni = 30) {
  return zap(`SELECT login FROM konta WHERE pochodzenie = 'samoobsluga' AND email_potwierdzony IS NULL
      AND platnik_klient IS NULL AND COALESCE(ostatnie_logowanie, utworzony_ms, 0) < ?`)
    .all(teraz - Math.max(1, Number(dni) || 30) * DOBA).map((w) => w.login);
}

/** Opis do /api/status i dziennika (bez danych kont). */
function stan() {
  if (!db) return { otwarty: false };
  return {
    otwarty: true,
    plik: path.basename(plikBazy),
    wersjaSchematu: Number(meta('wersja_schematu')) || null,
    migracjaJson: meta('migracja_json'),
    ostatniaKopia: Number(meta('ostatnia_kopia')) || null,
    kont: liczbaKont(),
  };
}

// ─── Eksport ─────────────────────────────────────────────────────────────────
// Kazda funkcja publiczna zamienia bledy SQLite "dane niedostepne" na BladMagazynu,
// a naruszenie unikalnosci na BladKonfliktu.

function chron(fn) {
  return function chronione(...argumenty) {
    try {
      const wynik = fn.apply(this, argumenty);
      if (wynik && typeof wynik.then === 'function') return wynik.catch((e) => { throw przetlumacz(e); });
      return wynik;
    } catch (e) {
      throw przetlumacz(e);
    }
  };
}

const API = {
  otworz, zamknij, otwarty, sciezkaBazy, transakcja, stan,
  nowyIdentyfikator, normalizujEmail,
  konto, kontoZOrganizacja, kontoPoEmailu, kontoPoKliencie, listaKont, liczbaKont, liczbaOperatorow,
  utworzOrganizacjeIKonto, utworzKonto, zmienKonto, usunKonto, kontoUsuniete, emailBylUsuniety,
  organizacja, usunOrganizacje, zmienOrganizacje,
  uzycie, uzycieKonta, policz, zarezerwuj, ustawUzycie,
  odwolajSesje, sesjaOdwolana, sesjeOdwolane, liczbaOdwolanych,
  zapiszToken, sprawdzToken, zuzyjToken, skrotTokenu,
  dopiszZgode, zgody,
  zapiszZdarzenie, oznaczZdarzenie, zdarzeniaNieprzetworzone, powiazKlienta, zastosujStanSubskrypcji,
  dopiszPlatnosc, ustawZwrot, sumyPlatnosci, platnosciWOkresie, platnosciKonta, kontaDoUzgodnienia,
  uzupelnijPlatnosc, wplata, wplataPoPlatnosci, wplatySubskrypcji, dopiszZwrot, zwrotyWplaty, zwrotyWOkresie,
  zapiszOdstapienie, zmienOdstapienie, odstapienie, odstapieniaKonta, odstapieniaWStanie,
  meta, ustawMeta,
  migracjaZapiszKonto, migracjaUsunKonto,
  kopia, kopiaOkresowa, sprzataj, kontaNiepotwierdzone,
};

for (const [nazwa, fn] of Object.entries(API)) module.exports[nazwa] = chron(fn);
// Najnowsza wersja schematu w tym kodzie (WERSJA_SCHEMATU + migracje): testy i diagnostyka.
const WERSJA_NAJNOWSZA = Math.max(WERSJA_SCHEMATU, ...MIGRACJE_SCHEMATU.map((m) => m.wersja));
Object.assign(module.exports, { BladMagazynu, BladKonfliktu, GLOWNA, WERSJA_SCHEMATU, WERSJA_NAJNOWSZA, POLA_KONTA });
