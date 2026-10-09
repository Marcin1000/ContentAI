'use strict';

// ─── Ekrany kont serwera (wykonawca A1) - ZASLEPKA ETAPU 0 ───────────────────
//
// Ekrany bez JavaScriptu pod CSP, jak serwer/logowanie.js (ARCH8-06): rejestracja,
// potwierdzenie e-maila, reset hasla, konto, zgody, usuniecie konta, pozegnanie.
// Wspolny wyglad z logowanie.js: szkielet(t, tytul, srodek, opcje), esc(s),
// akapit(s), teksty(jezyk) (eksporty od etapu 0). Makiety R1-R7:
// AG/runda8/agencja-ux/makiety/, teksty: AG/runda8/agencja-strona/.
//
// Kontrakt (propozycja dla A1, moze go rozwinac we wlasnym pliku): kazdy ekran to
// czysta funkcja zwracajaca HTML (bez zapisu, bez dostepu do bazy), np.
//   ekranRejestracji({ jezyk, email, bledy: { pole: kod }, pakiet, t, komunikat }) -> string
//   ekranKonta({ jezyk, konto, pakiet, platnosci, uslugodawca, komunikat }) -> string
// konta.js wysyla je przez kontekst.odpowiedzTekst(res, status, html, 'text/html; charset=utf-8').

const logowanie = require('./logowanie.js');

/** Zaslepka: strona "jeszcze niedostepne" w szkielecie ekranow serwera. */
function ekranNiedostepny({ jezyk = 'pl' } = {}) {
  const t = logowanie.teksty(jezyk);
  const tytul = jezyk === 'en' ? 'Not available yet' : 'Jeszcze niedostępne';
  const opis = jezyk === 'en'
    ? 'This screen is not available on this server yet.'
    : 'Ten ekran nie jest jeszcze dostępny na tym serwerze.';
  return logowanie.szkielet(t, `${tytul} · Content AI`,
    `      <h1>${logowanie.esc(tytul)}</h1>\n      <p class="wstep">${logowanie.akapit(opis)}</p>`, { przelacznik: false });
}

module.exports = { ekranNiedostepny };
