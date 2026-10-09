'use strict';

// ─── Platnosci: rdzen niezalezny od dostawcy (wykonawca B) - ZASLEPKA ETAPU 0 ─
//
// Kontrakt z PROJEKT-TECHNICZNY ARCH8-13..20, rozdz. 4.2-4.4 i 5; sygnatury:
// AG/runda9/WYKONANIE-A0.md. Konta, plany i aplikacja znaja tylko znormalizowany
// stan subskrypcji (kolumny konta platnik*, subskrypcja_*; magazyn.js sekcja
// "Platnosci"). Adapter dostawcy: platnosci-<dostawca>.js (interfejs w platnosci-stripe.js).
//
// Router (server.js) wola:
//   1. obsluzWebhook(sciezka, req, res, kontekst) - POST /platnosci/webhook/<dostawca>,
//      PRZED sesja i kontrola CSRF; cialo czytaj surowe (kontekst.czytajCialo(req, 512 * 1024)).
//   2. obsluz(sciezka, req, res, kontekst) - z sesja, PIERWSZY z modulow tras:
//      GET|POST /konto/zakup, POST /konto/panel, GET /konto/platnosc,
//      POST /api/platnosci/zakup, POST /api/platnosci/panel.
// Obie zwracaja true, gdy wyslaly odpowiedz.
//
// Konfiguracja: kontekst.KONF.platnosci (wszystkie zmienne PLATNOSCI_* i STRIPE_*),
// kontekst.KONF.funkcje.platnosci = { zadana, wlaczona, bledy } po kontroli przy starcie
// (server.js sprawdzKonfiguracje wola sprawdzKonfiguracje z tego modulu).
//
// Zaslepka: platnosci nigdy nie sa wlaczone (sprawdzKonfiguracje zglasza brak
// modulu), webhook przechodzi dalej jak dzis, trasy zakupu odpowiadaja kodem
// `platnosci-wylaczone` (404), a aplikacja dostaje `platnosci.wlaczone: false`.

// Dostawcy z adapterem w serwer/platnosci-<nazwa>.js (zmienna PLATNOSCI=<nazwa>).
const DOSTAWCY = ['stripe'];

/**
 * Kontrola konfiguracji przy starcie, bez sieci (ARCH8-20): prefiks klucza a tryb,
 * sekret webhooka, cena dla kazdej waluty kazdego pakietu na sprzedaz.
 *   sprawdzKonfiguracje(konf) -> ['opis bledu z nazwa zmiennej', ...] (pusta = dobrze)
 * Komunikaty podaja nazwy zmiennych, nigdy wartosci.
 */
function sprawdzKonfiguracje(konf) {
  return konf && konf.platnosci && konf.platnosci.dostawca
    ? ['modul platnosci nie jest jeszcze wdrozony w tym wydaniu (zaslepka etapu 0)']
    : [];
}

/** POST /platnosci/webhook/<dostawca>. Platnosci wylaczone: false (zapytanie idzie dalej jak dzis). */
async function obsluzWebhook(sciezka, req, res, kontekst) {
  if (!kontekst.funkcjaWlaczona('platnosci')) return false;
  kontekst.bladCai(res, 'niezaimplementowane', 501, { modul: 'platnosci' });
  return true;
}

const TRASY = ['/konto/zakup', '/konto/panel', '/konto/platnosc'];

/** Trasy zakupu i panelu klienta (z sesja). */
async function obsluz(sciezka, req, res, kontekst) {
  if (!TRASY.includes(sciezka) && !sciezka.startsWith('/api/platnosci/')) return false;
  if (!kontekst.funkcjaWlaczona('platnosci')) {
    kontekst.bladCai(res, 'platnosci-wylaczone', 404);
    return true;
  }
  kontekst.bladCai(res, 'niezaimplementowane', 501, { modul: 'platnosci' });
  return true;
}

/**
 * Sekcje `subskrypcja` i `platnosci` odpowiedzi GET /api/konto (rozdz. 4.4) dla konta.
 *   stanDlaKonta(konto, kontekst) -> { subskrypcja: { stan, plan, okresDo, waluta, dostepDo },
 *     platnosci: { wlaczone, sprzedaz, tryb, dostawca, waluty, walutaDomyslna,
 *                  wymagaZgodyNaWykonanie, mozeKupic, maPanel, plany: [...] } }
 */
function stanDlaKonta(konto, kontekst) {
  const k = konto || {};
  return {
    subskrypcja: {
      stan: k.subskrypcjaStan || 'brak',
      plan: k.subskrypcjaPlan || null,
      okresDo: k.okresDo || null,
      waluta: k.subskrypcjaWaluta || null,
      dostepDo: null,
    },
    platnosci: {
      wlaczone: Boolean(kontekst && kontekst.funkcjaWlaczona('platnosci')),
      sprzedaz: false,
      tryb: null,
      dostawca: null,
      waluty: [],
      walutaDomyslna: null,
      wymagaZgodyNaWykonanie: true,
      mozeKupic: false,
      maPanel: false,
      plany: [],
    },
  };
}

/**
 * Usuniecie konta (A1): natychmiastowe anulowanie subskrypcji u dostawcy.
 *   async anulujDlaKonta(konto, kontekst) -> { ok: true, anulowano: boolean }
 * Blad dostawcy = wyjatek: konto NIE jest usuwane (klient placilby dalej).
 */
async function anulujDlaKonta(konto) {
  return { ok: true, anulowano: false, platnik: (konto && konto.platnik) || null };
}

/** Sekcja `platnosci` w /api/status (ARCH8-25), bez danych kont. */
function stan() {
  return { wdrozone: false, wlaczone: false, tryb: null, dostawca: null, cenyZgodne: null, ostatniWebhook: null, nieprzetworzone: 0 };
}

/**
 * Wolane raz przy starcie (po migracji, przed listen): zegar uzgadniania co 6 h,
 * kontrola cen u dostawcy (brak sieci = ostrzezenie i ponowienie po 5 min).
 */
function inicjuj(kontekstSerwera) {
  // Zaslepka etapu 0: nic do uruchomienia (kontekstSerwera = { KONF, magazyn, poczta, ... }).
}

module.exports = { DOSTAWCY, sprawdzKonfiguracje, obsluzWebhook, obsluz, stanDlaKonta, anulujDlaKonta, stan, inicjuj };
