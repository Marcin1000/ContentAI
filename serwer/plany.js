'use strict';

/**
 * Content AI - plany, limity i zliczanie uzycia
 *
 * Trzy pakiety: darmowy na spróbowanie, standard i premium. Konto bez wpisanego
 * planu dostaje darmowy, wiec wlaczenie tego modulu niczego nie psuje istniejacym
 * kontom - trzeba im tylko nadac plan poleceniem `uzytkownicy.js plan`.
 *
 * ─── Dlaczego to jest tabela, a nie kod ──────────────────────────────────────
 *
 * Ceny i limity zmieniaja sie znacznie czesciej niz logika, ktora je egzekwuje.
 * Dlatego caly pakiet to jeden wpis w PLANY: zmiana "3 artykuly" na "5" albo
 * dolozenie grafik do standardu to edycja jednej linii, bez dotykania reszty.
 *
 * ─── Co jest liczone, a co bramkowane ────────────────────────────────────────
 *
 * LIMIT dotyczy rzeczy, ktore kosztuja za sztuke i rosna z uzyciem: artykuly,
 * grafiki, minuty audio. BRAMKA dotyczy calych funkcji - albo je masz, albo nie.
 * Mieszanie tych dwóch rzeczy w jednym mechanizmie zwykle konczy sie tym, ze
 * nie wiadomo, dlaczego komus cos nie dziala.
 *
 * ─── Uczciwosc licznika ──────────────────────────────────────────────────────
 *
 * Zliczamy PO udanej odpowiedzi dostawcy, nie przed. Jesli generowanie padnie
 * na bledzie API, uzytkownik nie traci artykulu z pakietu - dostal przeciez
 * nic. To kosztuje jedno dodatkowe wywolanie zapisu i jest tego warte.
 */

const fs = require('node:fs');
const path = require('node:path');

// ─── Pakiety ──────────────────────────────────────────────────────────────────
// okres: 'zawsze'  - limit na cale konto, nie odnawia sie (pakiet probny)
//        'miesiac' - licznik zeruje sie pierwszego dnia miesiaca
// null w limicie = bez ograniczenia.

const PLANY = {
  darmowy: {
    nazwa: 'Darmowy',
    opis: 'Na spróbowanie. Trzy artykuły, bez odnawiania.',
    okres: 'zawsze',
    limity: {
      artykul: 3,
      grafika: 0,
      audio: 0,
      transkrypcja: 0,
    },
    funkcje: {
      bazaWiedzy: true,        // ale limit dokumentow nizej
      serp: false,
      openseo: false,
      wlasnyKlucz: false,
      cms: false,
    },
    limitDokumentow: 3,
  },

  standard: {
    nazwa: 'Standard',
    opis: 'Do regularnej pracy nad treścią.',
    okres: 'miesiac',
    limity: {
      artykul: 50,
      grafika: 50,
      audio: 20,
      transkrypcja: 20,
    },
    funkcje: {
      bazaWiedzy: true,
      serp: true,
      openseo: false,
      wlasnyKlucz: true,
      cms: true,
    },
    limitDokumentow: 50,
  },

  premium: {
    nazwa: 'Premium',
    opis: 'Wszystko, bez limitów sztukowych.',
    okres: 'miesiac',
    limity: {
      artykul: null,
      grafika: null,
      audio: null,
      transkrypcja: null,
    },
    funkcje: {
      bazaWiedzy: true,
      serp: true,
      openseo: true,
      wlasnyKlucz: true,
      cms: true,
    },
    limitDokumentow: null,
  },
};

const DOMYSLNY = 'darmowy';

/**
 * Plan konta. Admin zawsze dostaje premium niezaleznie od wpisu - inaczej
 * wlasciciel systemu moglby sobie zablokowac wlasne narzedzie limitem.
 */
function planKonta(uzytkownik) {
  if (!uzytkownik) return PLANY[DOMYSLNY];
  if (uzytkownik.rola === 'admin') return PLANY.premium;
  return PLANY[uzytkownik.plan] || PLANY[DOMYSLNY];
}

function nazwaPlanu(uzytkownik) {
  if (!uzytkownik) return DOMYSLNY;
  if (uzytkownik.rola === 'admin') return 'premium';
  return PLANY[uzytkownik.plan] ? uzytkownik.plan : DOMYSLNY;
}

// ─── Zliczanie uzycia ─────────────────────────────────────────────────────────
// Jeden plik JSON na uzytkownika: { "zawsze": {...}, "2026-08": {...} }.
// Przy tej skali to wystarcza i nie wnosi zaleznosci; przy tysiacach kont
// trzeba bedzie bazy.

function okresTeraz(plan, teraz = new Date()) {
  if (plan.okres === 'zawsze') return 'zawsze';
  return `${teraz.getUTCFullYear()}-${String(teraz.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Login w nazwie pliku - tylko bezpieczne znaki, zeby nie dalo sie wyjsc z katalogu. */
function plikUzycia(katalog, login) {
  const czysty = String(login || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!czysty) throw new Error('pusty login');
  return path.join(katalog, `${czysty}.json`);
}

function wczytajUzycie(katalog, login) {
  try {
    const dane = JSON.parse(fs.readFileSync(plikUzycia(katalog, login), 'utf8'));
    return dane && typeof dane === 'object' ? dane : {};
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[plany] odczyt uzycia:', e.message);
    return {};
  }
}

function zapiszUzycie(katalog, login, dane) {
  fs.mkdirSync(katalog, { recursive: true });
  fs.writeFileSync(plikUzycia(katalog, login), JSON.stringify(dane), { mode: 0o600 });
}

/**
 * Czy wolno wykonac czynnosc. Zwraca opis decyzji, a nie samo true/false -
 * aplikacja ma z czego zbudowac komunikat, a nie tylko powiedziec "nie mozna".
 */
function sprawdzLimit({ katalog, uzytkownik, czynnosc, teraz }) {
  const plan = planKonta(uzytkownik);
  const limit = plan.limity[czynnosc];

  if (limit === undefined) {
    return { wolno: false, powod: 'nieznana-czynnosc', czynnosc };
  }
  if (limit === null) {
    return { wolno: true, limit: null, zuzyte: null, zostalo: null, plan: nazwaPlanu(uzytkownik) };
  }

  const okres = okresTeraz(plan, teraz);
  const zuzyte = Number(wczytajUzycie(katalog, uzytkownik.login)?.[okres]?.[czynnosc]) || 0;

  return {
    wolno: zuzyte < limit,
    powod: zuzyte < limit ? null : 'limit-wyczerpany',
    limit,
    zuzyte,
    zostalo: Math.max(0, limit - zuzyte),
    okres: plan.okres,
    plan: nazwaPlanu(uzytkownik),
  };
}

/** Dopisuje jedno uzycie. Wolane PO udanej odpowiedzi dostawcy. */
function policz({ katalog, uzytkownik, czynnosc, teraz }) {
  const plan = planKonta(uzytkownik);
  if (plan.limity[czynnosc] === null) return;   // bez limitu nie ma czego liczyc

  const okres = okresTeraz(plan, teraz);
  const dane = wczytajUzycie(katalog, uzytkownik.login);
  if (!dane[okres]) dane[okres] = {};
  dane[okres][czynnosc] = (Number(dane[okres][czynnosc]) || 0) + 1;

  // Stare okresy miesieczne nie sa do niczego potrzebne poza statystyka,
  // a plik ma nie puchnac. Zostawiamy biezacy i dwanascie wstecz.
  const miesieczne = Object.keys(dane).filter((k) => k !== 'zawsze').sort();
  for (const stary of miesieczne.slice(0, -13)) delete dane[stary];

  zapiszUzycie(katalog, uzytkownik.login, dane);
}

/** Czy plan daje dostep do calej funkcji (nie do puli sztuk). */
function maFunkcje(uzytkownik, funkcja) {
  return Boolean(planKonta(uzytkownik).funkcje[funkcja]);
}

/** Pelny stan pakietu dla aplikacji - to pokazuje sie uzytkownikowi. */
function stanPakietu({ katalog, uzytkownik, teraz }) {
  const plan = planKonta(uzytkownik);
  const okres = okresTeraz(plan, teraz);
  const uzycie = wczytajUzycie(katalog, uzytkownik.login)[okres] || {};

  const pozycje = {};
  for (const [czynnosc, limit] of Object.entries(plan.limity)) {
    const zuzyte = Number(uzycie[czynnosc]) || 0;
    pozycje[czynnosc] = {
      limit,
      zuzyte: limit === null ? null : zuzyte,
      zostalo: limit === null ? null : Math.max(0, limit - zuzyte),
    };
  }

  return {
    plan: nazwaPlanu(uzytkownik),
    nazwa: plan.nazwa,
    opis: plan.opis,
    okres: plan.okres,
    funkcje: { ...plan.funkcje },
    limitDokumentow: plan.limitDokumentow,
    uzycie: pozycje,
  };
}

module.exports = {
  PLANY,
  DOMYSLNY,
  planKonta,
  nazwaPlanu,
  sprawdzLimit,
  policz,
  maFunkcje,
  stanPakietu,
  okresTeraz,
  wczytajUzycie,
  plikUzycia,
};
