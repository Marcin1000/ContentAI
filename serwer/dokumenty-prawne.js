'use strict';

// ─── Dokumenty prawne z danymi uslugodawcy (wykonawca E) - ZASLEPKA ETAPU 0 ───
//
// Trasa (server.js, publiczna, bez logowania, naglowki bezpieczenstwa jak strony
// serwera, Cache-Control: public, max-age=300):
//   GET /dokumenty/<nazwa>        jezyk z ?lang=pl|en, domyslnie pl
//   GET /en/dokumenty/<nazwa>     jezyk en
// Kontrakt (uzgodniony z E, przy scalaniu wygrywa pelna wersja E):
//   obsluz(req, res, { nazwa, jezyk, konf })  - modul sam wysyla odpowiedz (takze 404);
//     nazwa: [a-z0-9-]{1,40} z adresu, jezyk: 'pl'|'en', konf: KONF serwera
//     (konf.uslugodawca = { imieNazwisko, adres, telefon, email, www } z CAI_USLUGODAWCA_*,
//      konf.regulaminWersja, konf.politykaWersja, konf.platnosci.tryb).
// Szablony w repozytorium (katalog dokumenty-prawne/) maja placeholdery WSTAW_TUTAJ_*,
// ktore modul zastepuje wartosciami z konfiguracji; dane uslugodawcy nie trafiaja do repo.
//
// Zaslepka: znane nazwy -> 501 "dokument w przygotowaniu", inne -> 404.

const NAZWY = ['regulamin', 'prywatnosc', 'odstapienie', 'dpa', 'uslugodawca'];

function strona(res, req, status, jezyk, tytul, opis) {
  const lang = jezyk === 'en' ? 'en' : 'pl';
  const esc = (s) => String(s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + `<title>${esc(tytul)} · Content AI</title></head><body><main><h1>${esc(tytul)}</h1><p>${esc(opis)}</p></main></body></html>`;
  const cialo = Buffer.from(html, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': cialo.length });
  res.end(req.method === 'HEAD' ? undefined : cialo);
}

async function obsluz(req, res, { nazwa, jezyk } = {}) {
  if (!NAZWY.includes(nazwa)) {
    return strona(res, req, 404, jezyk, jezyk === 'en' ? 'Not found' : 'Nie znaleziono',
      jezyk === 'en' ? 'There is no such document.' : 'Nie ma takiego dokumentu.');
  }
  return strona(res, req, 501, jezyk, jezyk === 'en' ? 'Document in preparation' : 'Dokument w przygotowaniu',
    jezyk === 'en' ? 'This document will be available here soon.' : 'Ten dokument będzie tu dostępny wkrótce.');
}

module.exports = { NAZWY, obsluz };
