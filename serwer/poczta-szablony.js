'use strict';

// ─── Szablony e-maili PL i EN (wykonawca C) - ZASLEPKA ETAPU 0 ───────────────
//
// ARCH8-21: tekst + prosty HTML bez obrazkow z zewnatrz i bez pikseli sledzacych,
// stopka z danymi uslugodawcy, bez slowa "faktura". Teksty: AG/runda8/agencja-strona/.
// Kontrakt:
//   SZABLONY: lista nazw
//   renderuj(szablon, jezyk, dane, konf) -> { temat, tekst, html }
//     dane: { odnosnik?, email?, nowyEmail?, prog?, okres?, ... } zaleznie od szablonu
//     konf: KONF serwera (uslugodawca, adresPubliczny)
//
// Zaslepka: jeden ogolny szablon z odnosnikiem (dziala z trybem 'log' poczty,
// wiec A1 moze testowac rejestracje i reset przed scaleniem C).

const SZABLONY = ['potwierdzenie', 'reset', 'haslo-zmienione', 'zmiana-email', 'zmiana-email-info', 'konto-usuniete', 'prog-przychodu'];

const TEMATY = {
  pl: {
    potwierdzenie: 'Potwierdź adres e-mail w Content AI',
    reset: 'Ustaw nowe hasło w Content AI',
    'haslo-zmienione': 'Hasło do Content AI zostało zmienione',
    'zmiana-email': 'Potwierdź nowy adres e-mail w Content AI',
    'zmiana-email-info': 'Zmiana adresu e-mail w Content AI',
    'konto-usuniete': 'Konto w Content AI zostało usunięte',
    'prog-przychodu': 'Content AI: próg przychodu',
  },
  en: {
    potwierdzenie: 'Confirm your email address for Content AI',
    reset: 'Set a new password for Content AI',
    'haslo-zmienione': 'Your Content AI password has been changed',
    'zmiana-email': 'Confirm your new email address for Content AI',
    'zmiana-email-info': 'Email address change in Content AI',
    'konto-usuniete': 'Your Content AI account has been deleted',
    'prog-przychodu': 'Content AI: revenue threshold',
  },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

function renderuj(szablon, jezyk, dane = {}, konf = {}) {
  if (!SZABLONY.includes(szablon)) throw new Error(`nieznany szablon e-maila: ${szablon}`);
  const j = jezyk === 'en' ? 'en' : 'pl';
  const temat = TEMATY[j][szablon];
  const u = (konf && konf.uslugodawca) || {};
  const stopka = [u.imieNazwisko, u.adres, u.email].filter(Boolean).join(', ');
  const linie = [temat];
  if (dane.odnosnik) linie.push('', dane.odnosnik);
  if (stopka) linie.push('', '--', stopka);
  const tekst = linie.join('\n');
  const html = `<p>${esc(temat)}</p>${dane.odnosnik ? `<p><a href="${esc(dane.odnosnik)}">${esc(dane.odnosnik)}</a></p>` : ''}`
    + (stopka ? `<p>${esc(stopka)}</p>` : '');
  return { temat, tekst, html };
}

module.exports = { SZABLONY, renderuj };
