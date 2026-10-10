'use strict';

// ─── Konfiguracja marki po stronie serwera ───────────────────────────────────
//
// Dlaczego to powstalo: tozsamosc marki (nazwa, domeny, wykluczenia
// z wyszukiwania, rozroznienie linii biznesowych) siedziala w localStorage
// przegladarki. Czyli kazdy uzytkownik i kazde urzadzenie mialy wlasna kopie,
// a nowa osoba w zespole zaczynala od pustej konfiguracji i generowala teksty
// bez zadnych regul o marce. Przy jednej osobie to dzialalo, przy zespole nie.
//
// Konfiguracja jest jedna na ORGANIZACJE (dzierzawy, ARCH8-09, SEC8-51): zespol glowny
// ma dzisiejszy plik <katalog>/marka.json (pisze admin, czytaja wszyscy w zespole), a kazde
// konto samoobslugowe wlasna marke w <katalog>/marki/<id organizacji>.json, ktora edytuje
// jej wlasciciel. Obce konto nigdy nie dostaje marki zespolu (nazwa, domeny, wykluczenia).
// Zwykly plik JSON, jak reszta danych tej aplikacji.

const pliki = require('./pliki.js');
const dzierzawy = require('./dzierzawy.js');

// Tylko te pola. Cokolwiek innego przyjdzie w zadaniu, zostanie pominiete -
// konfiguracja trafia prosto do promptow, wiec nie moze byc workiem na
// dowolne klucze.
const POLA = {
  name: 200,
  legalName: 300,
  siteUrl: 300,
  description: 2000,
  services: 4000,
  lines: 4000,
  domains: 4000,
  blockedDomains: 4000,
};

/** Plik marki organizacji: 'glowna' (domyslnie) -> marka.json, inne -> marki/<id>.json. */
function plik(katalog, organizacja = dzierzawy.GLOWNA) {
  return dzierzawy.plikMarki(katalog, organizacja || dzierzawy.GLOWNA);
}

/** Przyciecie do dozwolonych pol i dlugosci. Zwraca zawsze obiekt. */
function oczysc(dane) {
  const wynik = {};
  if (!dane || typeof dane !== 'object') return wynik;
  for (const [pole, limit] of Object.entries(POLA)) {
    const wartosc = dane[pole];
    if (typeof wartosc !== 'string') continue;
    // Znaki sterujace poza tabulacja i nowa linia nie maja tu czego szukac.
    const czysta = wartosc.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    wynik[pole] = czysta.slice(0, limit);
  }
  return wynik;
}

function wczytaj(katalog, organizacja) {
  // Brak pliku to normalny stan przed pierwszym zapisem, nie blad. Uszkodzony
  // plik to BladDanych (kopia .uszkodzony-*), a nie "marki nie ma" - inaczej
  // zespol pisalby po cichu bez regul marki.
  return oczysc(pliki.czytajJson(plik(katalog, organizacja), {}, pliki.czyObiekt));
}

function zapisz(katalog, dane, organizacja) {
  const czyste = oczysc(dane);
  // 0o600: konfiguracja marki nie jest sekretem, ale lezy w tym samym
  // katalogu co sekret sesji i konta, wiec trzyma sie tych samych uprawnien.
  // Zapis atomowy: zapis przerwany w polowie nie zostawi polowy pliku.
  pliki.zapiszJson(plik(katalog, organizacja), czyste, 1);
  return czyste;
}

/** Czy cokolwiek jest ustawione. Pusty obiekt znaczy "jeszcze nie skonfigurowano". */
function pusta(dane) {
  return !dane || !Object.keys(dane).some((k) => String(dane[k] || '').trim());
}

module.exports = { wczytaj, zapisz, oczysc, pusta, plik, POLA };
