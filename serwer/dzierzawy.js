'use strict';

// ─── Dzierzawy: organizacja per konto (ARCH8-09, KOD8-01, SEC8-50..52) ───────
//
// Dzisiejsze konta naleza do organizacji 'glowna' i dzialaja jak dzis: marka
// i baza wspolna zespolu leza na tych samych sciezkach (<CAI_MARKA>/marka.json,
// <CAI_BAZA>/wspolna.json), migracja nie rusza zadnego pliku. Kazde konto
// samoobslugowe to wlasna organizacja 'o-...' z wlasna marka i baza wspolna,
// ktore edytuje jej wlasciciel. OpenSEO i SERP przez OpenSEO tylko 'glowna'.
//
// Ten modul to same reguly i sciezki (bez SQL i bez zapisu plikow). Konto to
// obiekt z magazyn.konto()/kontoZOrganizacja(); konto bez pola `organizacja`
// (stary kod, testy) jest traktowane jak konto organizacji 'glowna'.

const path = require('node:path');

const GLOWNA = 'glowna';
const WZOR_ID = /^o-[a-z2-7]{12}$/;

/** Czy identyfikator organizacji jest bezpieczny do zlozenia sciezki pliku. */
function poprawnyId(id) {
  return id === GLOWNA || (typeof id === 'string' && WZOR_ID.test(id));
}

function idOrganizacji(konto) {
  return (konto && konto.organizacja) || GLOWNA;
}

function rodzajOrganizacji(konto, org) {
  if (org && org.rodzaj) return org.rodzaj;
  if (konto && konto.org && konto.org.rodzaj) return konto.org.rodzaj;
  return idOrganizacji(konto) === GLOWNA ? 'glowna' : 'samoobsluga';
}

/** Operator calego serwera: /api/status, /api/admin/*, prosby o dostep, pakiet bez limitow. */
function operator(konto) {
  return Boolean(konto) && konto.rola === 'admin' && idOrganizacji(konto) === GLOWNA;
}

/** Kto moze zmieniac marke i baze wspolna SWOJEJ organizacji. */
function mozeZarzadzac(konto, org) {
  if (!konto) return false;
  return rodzajOrganizacji(konto, org) === 'glowna' ? konto.rola === 'admin' : konto.rolaWOrganizacji === 'wlasciciel';
}

/** Zrodlo SERP dla konta: organizacja glowna -> CAI_SERP, inne -> CAI_SERP_SAMOOBSLUGA. */
function zrodloSerp(konto, konf) {
  return idOrganizacji(konto) === GLOWNA ? konf.serp : konf.serpSamoobsluga;
}

/** Plik marki organizacji: 'glowna' -> <katalogMarki>/marka.json, inne -> <katalogMarki>/marki/<id>.json. */
function plikMarki(katalogMarki, id) {
  if (!poprawnyId(id)) throw new Error('niepoprawny identyfikator organizacji');
  return id === GLOWNA ? path.join(katalogMarki, 'marka.json') : path.join(katalogMarki, 'marki', `${id}.json`);
}

/** Nazwa pliku bazy wspolnej w katalogu bazy: 'wspolna.json' albo 'wspolna-<id>.json'. */
function nazwaPlikuBazyWspolnej(id) {
  if (!poprawnyId(id)) throw new Error('niepoprawny identyfikator organizacji');
  return id === GLOWNA ? 'wspolna.json' : `wspolna-${id}.json`;
}

function plikBazyWspolnej(katalogBazy, id) {
  return path.join(katalogBazy, nazwaPlikuBazyWspolnej(id));
}

/**
 * Pliki organizacji samoobslugowej do usuniecia razem z nia (marka, baza wspolna);
 * dla 'glowna' zawsze pusta lista. Kopie .uszkodzony-* i pliki .tmp-* obok
 * usuwa wolajacy (wzor usunDaneKonta w uzytkownicy.js).
 */
function plikiOrganizacji({ katalogMarki, katalogBazy }, id) {
  if (id === GLOWNA || !poprawnyId(id)) return [];
  return [plikMarki(katalogMarki, id), plikBazyWspolnej(katalogBazy, id)];
}

/** Opis organizacji dla aplikacji (/auth/me, /api/konto). */
function opisDlaAplikacji(konto) {
  const org = (konto && konto.org) || null;
  return {
    id: idOrganizacji(konto),
    nazwa: org ? org.nazwa : null,
    rodzaj: rodzajOrganizacji(konto, org),
    mozeZarzadzac: mozeZarzadzac(konto, org),
  };
}

module.exports = {
  GLOWNA, poprawnyId, idOrganizacji, operator, mozeZarzadzac, zrodloSerp,
  plikMarki, nazwaPlikuBazyWspolnej, plikBazyWspolnej, plikiOrganizacji, opisDlaAplikacji,
};
