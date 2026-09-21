'use strict';

// ─── Konfiguracja marki po stronie serwera ───────────────────────────────────
//
// Dlaczego to powstalo: tozsamosc marki (nazwa, domeny, wykluczenia
// z wyszukiwania, rozroznienie linii biznesowych) siedziala w localStorage
// przegladarki. Czyli kazdy uzytkownik i kazde urzadzenie mialy wlasna kopie,
// a nowa osoba w zespole zaczynala od pustej konfiguracji i generowala teksty
// bez zadnych regul o marce. Przy jednej osobie to dzialalo, przy zespole nie.
//
// Konfiguracja jest JEDNA dla calego wdrozenia: pisze ja administrator,
// czytaja wszyscy. Zwykly plik JSON, jak reszta danych tej aplikacji.

const fs = require('node:fs');
const path = require('node:path');

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

function plik(katalog) {
  return path.join(katalog, 'marka.json');
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

function wczytaj(katalog) {
  try {
    return oczysc(JSON.parse(fs.readFileSync(plik(katalog), 'utf8')));
  } catch {
    // Brak pliku to normalny stan przed pierwszym zapisem, nie blad.
    return {};
  }
}

function zapisz(katalog, dane) {
  const czyste = oczysc(dane);
  fs.mkdirSync(katalog, { recursive: true });
  // 0o600: konfiguracja marki nie jest sekretem, ale lezy w tym samym
  // katalogu co sekret sesji i konta, wiec trzyma sie tych samych uprawnien.
  fs.writeFileSync(plik(katalog), JSON.stringify(czyste, null, 1), { mode: 0o600 });
  return czyste;
}

/** Czy cokolwiek jest ustawione. Pusty obiekt znaczy "jeszcze nie skonfigurowano". */
function pusta(dane) {
  return !dane || !Object.keys(dane).some((k) => String(dane[k] || '').trim());
}

module.exports = { wczytaj, zapisz, oczysc, pusta, POLA };
