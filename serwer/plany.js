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
 *
 * ─── Artykul to nie to samo co wywolanie modelu ──────────────────────────────
 *
 * Jedno generowanie artykulu to kilka wywolan modelu: brief, tresc, korekta
 * premium, uzupelnianie luk, przerobki fragmentow. Gdyby kazde liczylo sie jako
 * artykul, pakiet darmowy skonczylby sie w polowie pierwszego tekstu. Dlatego
 * artykul liczy sie tylko wtedy, gdy aplikacja zadeklaruje, ze wlasnie o to
 * chodzi, a wszystkie pozostale wywolania ida na osobny licznik `wywolanie`.
 *
 * Deklaracja przychodzi z przegladarki, wiec nie jest dowodem - i nie musi nim
 * byc. Licznik wywolan jest tu sufitem: konto, ktore nigdy nie przyzna sie do
 * artykulu, i tak ma skonczona pule. To nie jest zamek, tylko granica kosztu.
 */

const path = require('node:path');
const pliki = require('./pliki.js');
const magazyn = require('./magazyn.js');
const dzierzawy = require('./dzierzawy.js');

// ─── Pakiety ──────────────────────────────────────────────────────────────────
// okres: 'zawsze'  - limit na cale konto, nie odnawia sie (pakiet probny)
//        'miesiac' - licznik zeruje sie pierwszego dnia miesiaca
// null w limicie = bez ograniczenia.

const PLANY = {
  darmowy: {
    nazwa: 'Darmowy',
    nazwaEn: 'Free',
    opis: 'Na spróbowanie. Trzy artykuły, bez odnawiania.',
    opisEn: 'To try it out. Three articles, no renewal.',
    okres: 'zawsze',
    limity: {
      artykul: 3,
      grafika: 0,
      audio: 0,
      transkrypcja: 0,
      wywolanie: 30,
    },
    funkcje: {
      bazaWiedzy: true,        // ale limit dokumentow nizej
      serp: false,
      openseo: false,
      wlasnyKlucz: false,
      cms: false,
    },
    limitDokumentow: 3,
    // M-3 (DECYZJE-R9): sufit wywolan modelu dla kont na WLASNYM kluczu (zrodlo_kluczy
    // 'wlasne'): 3 pelne artykuly z zapasem 30%. Pomiar na atrapie (etap 0 R9, raport
    // WYKONANIE-A0): artykul z siecia i SERP, samokorekta, oceny SEO/AIO/AEO/GEO, Fakty,
    // Luki z poprawa to 9 wywolan (typ Hybryda), w najgorszym zmierzonym wariancie 12
    // (Artykul SEO z ocena i poprawa w trakcie generowania, wyszukiwanie z pause_turn):
    // 3 x 12 x 1,3 = 46,8, czyli 47. AEO i GEO licza sie w przegladarce (0 wywolan).
    // Konta na kluczach serwera dalej maja `limity.wywolanie` (30). Ten blok stoi PO
    // `limity`, bo buduj_strone.py czyta pierwsze `wywolanie:` w pakiecie.
    limityWlasneKlucze: {
      wywolanie: 47,
    },
    sprzedaz: false,            // nie ma go w Checkout (ARCH8-13)
    kolejnosc: 0,               // wybor subskrypcji przy kilku zywych i kolejnosc kart
    // Zasoby oplacane przez serwer, tylko konta zrodlo_kluczy='wlasne' (ARCH8-11);
    // okres jak `okres` pakietu, null = bez limitu, 0 = niedostepne w pakiecie.
    limitySerwera: {
      serp: 0,
      wektory: 20,
      strony: 30,
    },
  },

  standard: {
    nazwa: 'Standard',
    nazwaEn: 'Standard',
    opis: 'Do regularnej pracy nad treścią.',
    opisEn: 'For regular work on content.',
    okres: 'miesiac',
    limity: {
      artykul: 50,
      grafika: 50,
      audio: 20,
      transkrypcja: 20,
      wywolanie: 750,
    },
    funkcje: {
      bazaWiedzy: true,
      serp: true,
      openseo: false,
      wlasnyKlucz: true,
      cms: true,
    },
    limitDokumentow: 50,
    sprzedaz: true,
    kolejnosc: 1,
    limitySerwera: {
      serp: 100,
      wektory: 1000,
      strony: 1000,
    },
  },

  premium: {
    nazwa: 'Premium',
    nazwaEn: 'Premium',
    opis: 'Wszystko, bez limitów sztukowych.',
    opisEn: 'Everything, with no per-item limits.',
    okres: 'miesiac',
    limity: {
      artykul: null,
      grafika: null,
      audio: null,
      transkrypcja: null,
      wywolanie: null,
    },
    funkcje: {
      bazaWiedzy: true,
      serp: true,
      openseo: true,
      wlasnyKlucz: true,
      cms: true,
    },
    limitDokumentow: null,
    sprzedaz: true,
    kolejnosc: 2,
    limitySerwera: {
      serp: 500,
      wektory: 5000,
      strony: 5000,
    },
  },
};

const DOMYSLNY = 'darmowy';

// ─── Konfiguracja (ustawia server.js z KONF; domyslne ze srodowiska) ─────────
// planNowych: plan konta samoobslugowego bez subskrypcji (CAI_PLAN_NOWYCH, decyzja 3),
// trybPlatnosci i zaleglaDni: dla dostepPlatny (wykonawca B, ARCH8-16).

const KONF_PLANOW = {
  planNowych: DOMYSLNY,
  trybPlatnosci: '',
  zaleglaDni: 7,
};

/**
 * Ustawia konfiguracje. Nieznany plan nowych kont -> darmowy (blad zglasza
 * kontrola konfiguracji przy starcie serwera, tu bez dziennika: modul czyta
 * takze CLI i testy).
 */
function ustawKonfiguracje({ planNowych, trybPlatnosci, zaleglaDni } = {}) {
  if (planNowych !== undefined) KONF_PLANOW.planNowych = PLANY[planNowych] ? planNowych : DOMYSLNY;
  if (trybPlatnosci !== undefined) KONF_PLANOW.trybPlatnosci = String(trybPlatnosci || '');
  if (zaleglaDni !== undefined && Number(zaleglaDni) >= 0) KONF_PLANOW.zaleglaDni = Number(zaleglaDni);
  return { ...KONF_PLANOW };
}

ustawKonfiguracje({
  planNowych: process.env.CAI_PLAN_NOWYCH || DOMYSLNY,
  trybPlatnosci: process.env.PLATNOSCI_TRYB || '',
  zaleglaDni: process.env.PLATNOSCI_ZALEGLA_DNI || 7,
});

function czasMs(teraz) {
  if (teraz instanceof Date) return teraz.getTime();
  return Number.isFinite(Number(teraz)) && teraz !== undefined && teraz !== null ? Number(teraz) : Date.now();
}

function czasData(teraz) {
  return teraz instanceof Date ? teraz : new Date(czasMs(teraz));
}

/**
 * Nazwa planu, wedlug ktorego konto dziala teraz (ARCH8-16).
 * Operator (admin organizacji glownej) zawsze premium - wlasciciel systemu nie moze
 * sobie zablokowac narzedzia. Potem plan przypisany przez administratora, a konto
 * samoobslugowe bez planu dostaje CAI_PLAN_NOWYCH.
 * Wykonawca B doklada tu, przed planem przypisanym, dostep z subskrypcji:
 *   if (dostepPlatny(konto, teraz, konf) && PLANY[konto.subskrypcjaPlan]) return konto.subskrypcjaPlan;
 */
function planEfektywny(konto, teraz = Date.now(), konf = KONF_PLANOW) {
  if (!konto) return DOMYSLNY;
  if (dzierzawy.operator(konto)) return 'premium';
  if (konto.plan && PLANY[konto.plan]) return konto.plan;
  return konto.pochodzenie === 'samoobsluga' ? konf.planNowych : DOMYSLNY;
}

/** Plan konta (obiekt z PLANY). */
function planKonta(uzytkownik, teraz) {
  return PLANY[planEfektywny(uzytkownik, czasMs(teraz))] || PLANY[DOMYSLNY];
}

function nazwaPlanu(uzytkownik, teraz) {
  return planEfektywny(uzytkownik, czasMs(teraz));
}

/** Czy konto pracuje na wlasnych kluczach (konto samoobslugowe; ARCH8-10). */
function naWlasnymKluczu(konto) {
  return Boolean(konto) && konto.zrodloKluczy === 'wlasne';
}

/** Limit czynnosci dla konta: na wlasnym kluczu pierwszenstwo ma `limityWlasneKlucze` (M-3). */
function limitDla(konto, plan, czynnosc) {
  if (naWlasnymKluczu(konto) && plan.limityWlasneKlucze
    && Object.prototype.hasOwnProperty.call(plan.limityWlasneKlucze, czynnosc)) {
    return plan.limityWlasneKlucze[czynnosc];
  }
  return plan.limity[czynnosc];
}

// ─── Zliczanie uzycia ─────────────────────────────────────────────────────────
// Liczniki leza w bazie (serwer/magazyn.js, tabela uzycie): okres 'zawsze' albo
// 'RRRR-MM', atomowy UPSERT, bez przepisywania pliku. Pliki JSON z R8
// (uzycie/<login>.json) czyta juz tylko migracja - stad wczytajUzycie i plikUzycia.

function okresTeraz(plan, teraz = new Date()) {
  if (plan.okres === 'zawsze') return 'zawsze';
  const d = czasData(teraz);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Login w nazwie pliku - tylko bezpieczne znaki, zeby nie dalo sie wyjsc z katalogu. */
function plikUzycia(katalog, login) {
  const czysty = String(login || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!czysty) throw new Error('pusty login');
  return path.join(katalog, `${czysty}.json`);
}

// Format R8 (tylko migracja i eksport-json). Uszkodzony plik to BladDanych, nie pusty obiekt.
function wczytajUzycie(katalog, login) {
  return pliki.czytajJson(plikUzycia(katalog, login), {}, pliki.czyObiekt);
}

function zapiszUzycie(katalog, login, dane) {
  pliki.zapiszJson(plikUzycia(katalog, login), dane);
}

/**
 * Czy wolno wykonac czynnosc. Zwraca opis decyzji, a nie samo true/false -
 * aplikacja ma z czego zbudowac komunikat, a nie tylko powiedziec "nie mozna".
 *   sprawdzLimit({ konto, czynnosc, teraz })   (`uzytkownik` = dawna nazwa `konto`; `katalog` ignorowany)
 */
function sprawdzLimit({ konto, uzytkownik, czynnosc, teraz }) {
  const k = konto || uzytkownik;
  const plan = planKonta(k, teraz);
  const limit = limitDla(k, plan, czynnosc);

  if (limit === undefined) {
    return { wolno: false, powod: 'nieznana-czynnosc', czynnosc };
  }
  if (limit === null) {
    return { wolno: true, limit: null, zuzyte: null, zostalo: null, plan: nazwaPlanu(k, teraz) };
  }

  const okres = okresTeraz(plan, teraz);
  const zuzyte = Number(magazyn.uzycie(k.login, okres)[czynnosc]) || 0;

  return {
    wolno: zuzyte < limit,
    powod: zuzyte < limit ? null : 'limit-wyczerpany',
    limit,
    zuzyte,
    zostalo: Math.max(0, limit - zuzyte),
    okres: plan.okres,
    plan: nazwaPlanu(k, teraz),
  };
}

/** Dopisuje jedno uzycie (atomowo w bazie). Wolane PO udanej odpowiedzi dostawcy. */
function policz({ konto, uzytkownik, czynnosc, teraz }) {
  const k = konto || uzytkownik;
  const plan = planKonta(k, teraz);
  if (limitDla(k, plan, czynnosc) === null) return;   // bez limitu nie ma czego liczyc
  magazyn.policz(k.login, okresTeraz(plan, teraz), czynnosc, 1);
}

// ─── Zasoby oplacane przez serwer (ARCH8-11) ──────────────────────────────────
// Osobna pula w tej samej tabeli (czynnosc 'serwer:<zasob>'), tylko dla kont na
// wlasnym kluczu. Konta na kluczach serwera dzialaja jak dzis: zawsze wolno, nic
// nie liczymy, takze gdy maja ten sam plan co konto samoobslugowe.

const ZASOBY_SERWERA = ['serp', 'wektory', 'strony'];

/** -> { wolno, limit, zuzyte, zostalo, okres, zasob }; limit null = bez limitu. */
function sprawdzLimitSerwera(konto, zasob, teraz) {
  if (!ZASOBY_SERWERA.includes(zasob)) throw new Error(`nieznany zasob serwera: ${zasob}`);
  if (!naWlasnymKluczu(konto)) return { wolno: true, limit: null, zuzyte: null, zostalo: null, zasob };
  const plan = planKonta(konto, teraz);
  const limit = plan.limitySerwera ? plan.limitySerwera[zasob] : null;
  if (limit === null || limit === undefined) return { wolno: true, limit: null, zuzyte: null, zostalo: null, zasob };
  const zuzyte = Number(magazyn.uzycie(konto.login, okresTeraz(plan, teraz))[`serwer:${zasob}`]) || 0;
  return { wolno: zuzyte < limit, limit, zuzyte, zostalo: Math.max(0, limit - zuzyte), okres: plan.okres, zasob };
}

/** Dopisuje `ile` uzyc zasobu serwera (np. liczba sprawdzonych adresow). Konta 'serwera': nic. */
function policzSerwer(konto, zasob, ile = 1, teraz) {
  if (!ZASOBY_SERWERA.includes(zasob)) throw new Error(`nieznany zasob serwera: ${zasob}`);
  if (!naWlasnymKluczu(konto) || !(Number(ile) > 0)) return;
  const plan = planKonta(konto, teraz);
  const limit = plan.limitySerwera ? plan.limitySerwera[zasob] : null;
  if (limit === null || limit === undefined) return;
  magazyn.policz(konto.login, okresTeraz(plan, teraz), `serwer:${zasob}`, Number(ile));
}

/**
 * Czy plan daje dostep do calej funkcji (nie do puli sztuk).
 * OpenSEO (jeden kontener i projekt zespolu) tylko w organizacji glownej (ARCH8-09);
 * konto na wlasnym kluczu ma zawsze `wlasnyKlucz`.
 */
function maFunkcje(uzytkownik, funkcja) {
  if (funkcja === 'openseo' && dzierzawy.idOrganizacji(uzytkownik) !== dzierzawy.GLOWNA) return false;
  if (funkcja === 'wlasnyKlucz' && naWlasnymKluczu(uzytkownik)) return true;
  return Boolean(planKonta(uzytkownik).funkcje[funkcja]);
}

/** Pelny stan pakietu dla aplikacji - to pokazuje sie uzytkownikowi. */
function stanPakietu({ konto, uzytkownik, teraz }) {
  const k = konto || uzytkownik;
  const plan = planKonta(k, teraz);
  const okres = okresTeraz(plan, teraz);
  const uzycie = magazyn.uzycie(k.login, okres);

  const pozycje = {};
  for (const czynnosc of Object.keys(plan.limity)) {
    const limit = limitDla(k, plan, czynnosc);
    const zuzyte = Number(uzycie[czynnosc]) || 0;
    pozycje[czynnosc] = {
      limit,
      zuzyte: limit === null ? null : zuzyte,
      zostalo: limit === null ? null : Math.max(0, limit - zuzyte),
    };
  }

  const funkcje = {};
  for (const funkcja of Object.keys(plan.funkcje)) funkcje[funkcja] = maFunkcje(k, funkcja);

  let limitySerwera = null;
  if (naWlasnymKluczu(k)) {
    limitySerwera = {};
    for (const zasob of ZASOBY_SERWERA) {
      const s = sprawdzLimitSerwera(k, zasob, teraz);
      limitySerwera[zasob] = { limit: s.limit, zuzyte: s.zuzyte, zostalo: s.zostalo };
    }
  }

  return {
    plan: nazwaPlanu(k, teraz),
    nazwa: plan.nazwa,
    nazwaEn: plan.nazwaEn,
    opis: plan.opis,
    opisEn: plan.opisEn,
    okres: plan.okres,
    funkcje,
    limitDokumentow: plan.limitDokumentow,
    uzycie: pozycje,
    zrodloKluczy: (k && k.zrodloKluczy) || 'serwera',
    limitySerwera,
    subskrypcja: null,          // B: { stan, plan, okresDo, dostepDo } (ARCH8-16)
  };
}

module.exports = {
  PLANY,
  DOMYSLNY,
  KONF_PLANOW,
  ZASOBY_SERWERA,
  ustawKonfiguracje,
  planEfektywny,
  planKonta,
  nazwaPlanu,
  naWlasnymKluczu,
  limitDla,
  sprawdzLimit,
  policz,
  sprawdzLimitSerwera,
  policzSerwer,
  maFunkcje,
  stanPakietu,
  okresTeraz,
  wczytajUzycie,
  zapiszUzycie,
  plikUzycia,
};
