'use strict';

// ─── Ekrany platnosci (wykonawca B) - ZASLEPKA ETAPU 0 ───────────────────────
//
// Ekrany bez JavaScriptu (ARCH8-19): GET /konto/zakup?plan=&waluta=&z=app|konto
// (podsumowanie, przelacznik waluty jako odnosniki, pole zgody na natychmiastowe
// wykonanie, dane uslugodawcy, odnosniki do regulaminu) i sekcja platnosci ekranu
// /konto (A1 wola ja przy skladaniu ekranu konta). Wspolny wyglad: logowanie.szkielet.
// CSP tych odpowiedzi: CSP bazowa (server.js CSP) z `form-action 'self' <hosty adaptera>`,
// bo przegladarki stosuja form-action takze do przekierowania 303 po formularzu (S11).
//
// Kontrakt (propozycja dla B):
//   ekranZakupu({ jezyk, konto, plan, waluta, ceny, uslugodawca, z, blad }) -> string HTML
//   sekcjaKonta({ jezyk, konto, stan }) -> string HTML (fragment dla ekranu /konto)
//   cspPlatnosci(cspBazowa, hosty) -> string (CSP z hostami dostawcy w form-action)

/** CSP ekranow platnosci: bazowa z hostami dostawcy dopisanymi do form-action. */
function cspPlatnosci(cspBazowa, hosty) {
  const lista = (hosty || []).filter((h) => /^https:\/\/[a-z0-9.-]+$/i.test(h));
  return String(cspBazowa).replace("form-action 'self'", ["form-action 'self'", ...lista].join(' '));
}

module.exports = { cspPlatnosci };
