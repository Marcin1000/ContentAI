'use strict';

// ─── Pliki danych: zapis atomowy i odczyt, ktory nie udaje pustej listy ──────
//
// Dlaczego to powstalo: kazdy plik danych (konta, liczniki, baza wiedzy,
// wylogowania, marka) byl zapisywany wprost przez writeFileSync, a odczyt
// lapal kazdy blad i zwracal pusta liste. Razem dawalo to trwala utrate
// danych: awaria albo pelny dysk w trakcie zapisu zostawialy uciety plik,
// nastepny odczyt widzial "nic tu nie ma", a nastepny zapis nadpisywal
// resztki lista z jednym nowym wpisem.
//
// Teraz:
//   - zapis idzie do pliku tymczasowego w tym samym katalogu, potem fsync
//     i rename. Rename w obrebie jednego systemu plikow jest atomowy, wiec
//     na dysku jest zawsze albo stara, albo nowa wersja - nigdy polowa,
//   - brak pliku (ENOENT) to normalny stan przed pierwszym zapisem,
//   - kazdy inny blad odczytu albo uszkodzony JSON to BladDanych: plik
//     zostaje nietkniety, obok laduje kopia .uszkodzony-<czas>, a zadanie
//     dostaje 503 zamiast po cichu zaczynac od zera.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class BladDanych extends Error {
  constructor(plik, przyczyna) {
    super(`Plik danych ${plik} jest nieczytelny (${przyczyna}). `
      + 'Serwer go nie nadpisze. Przywroc go z kopii albo usun, jesli ma zaczac od zera.');
    this.name = 'BladDanych';
    this.plik = plik;
    this.status = 503;
  }
}

/**
 * Zapisuje tresc atomowo: plik tymczasowy obok docelowego, fsync, rename.
 * Tryb 0600, bo w tych plikach sa hashe hasel, sekret i dane klientow.
 */
function zapiszAtomowo(plik, tresc, tryb = 0o600) {
  const katalog = path.dirname(plik);
  fs.mkdirSync(katalog, { recursive: true });
  const tymczasowy = path.join(katalog,
    `.${path.basename(plik)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  let fd = null;
  try {
    fd = fs.openSync(tymczasowy, 'wx', tryb);
    fs.writeSync(fd, typeof tresc === 'string' ? tresc : Buffer.from(tresc));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tymczasowy, plik);
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* juz zamkniety */ } }
    try { fs.unlinkSync(tymczasowy); } catch { /* moglo go nie byc */ }
    throw e;
  }
  // fsync katalogu utrwala sam rename; nie kazdy system plikow na to pozwala.
  try {
    const fdKat = fs.openSync(katalog, 'r');
    try { fs.fsyncSync(fdKat); } finally { fs.closeSync(fdKat); }
  } catch { /* np. Windows - rename i tak jest juz zrobiony */ }
}

/** Zapis obiektu jako JSON, atomowo. */
function zapiszJson(plik, dane, wciecie) {
  zapiszAtomowo(plik, JSON.stringify(dane, null, wciecie));
}

// Jedna kopia na jedna wersje uszkodzonego pliku. Konta czytamy przy kazdym
// zadaniu - bez tego kazde zadanie dokladaloby kolejna kopie.
const skopiowane = new Set();

function zachowajKopie(plik) {
  try {
    const st = fs.statSync(plik);
    const klucz = `${plik}:${st.size}:${st.mtimeMs}`;
    if (skopiowane.has(klucz)) return null;
    skopiowane.add(klucz);
    const czas = new Date().toISOString().replace(/[:.]/g, '-');
    const kopia = `${plik}.uszkodzony-${czas}`;
    fs.copyFileSync(plik, kopia);
    try { fs.chmodSync(kopia, 0o600); } catch { /* bez znaczenia dla kopii */ }
    console.error(`[dane] ${plik} jest uszkodzony - kopia: ${kopia}`);
    return kopia;
  } catch (e) {
    console.error(`[dane] nie udalo sie skopiowac uszkodzonego ${plik}:`, e.message);
    return null;
  }
}

/**
 * Czyta JSON. Brak pliku -> `domyslnie`. Uszkodzony plik, zly ksztalt
 * (gdy podano `ksztalt`) albo blad odczytu -> kopia + BladDanych.
 */
function czytajJson(plik, domyslnie, ksztalt) {
  let surowe;
  try {
    surowe = fs.readFileSync(plik, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return typeof domyslnie === 'function' ? domyslnie() : domyslnie;
    throw new BladDanych(plik, e.code || e.message);
  }
  let dane;
  try {
    dane = JSON.parse(surowe);
  } catch (e) {
    zachowajKopie(plik);
    throw new BladDanych(plik, 'niepoprawny JSON');
  }
  if (ksztalt && !ksztalt(dane)) {
    zachowajKopie(plik);
    throw new BladDanych(plik, 'nieoczekiwany ksztalt danych');
  }
  return dane;
}

const czyTablica = (d) => Array.isArray(d);
const czyObiekt = (d) => d !== null && typeof d === 'object' && !Array.isArray(d);

/**
 * Dopisuje jedna linie do pliku JSON Lines. Jedno wywolanie write na
 * deskryptorze otwartym z O_APPEND (flaga 'a') + fsync: wpisy z rownoleglych
 * zadan sie nie przeplataja, a po awarii co najwyzej ostatnia linia bywa
 * ucieta - czytelnik ja pomija.
 */
function dopiszLinie(plik, obiekt) {
  fs.mkdirSync(path.dirname(plik), { recursive: true });
  const linia = JSON.stringify(obiekt).replace(/\n/g, ' ') + '\n';
  const fd = fs.openSync(plik, 'a', 0o600);
  try {
    fs.writeSync(fd, linia);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Czyta JSON Lines; linie, ktorych nie da sie odczytac, liczy osobno. */
function czytajLinie(plik) {
  let surowe;
  try {
    surowe = fs.readFileSync(plik, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { wpisy: [], pominiete: 0 };
    throw new BladDanych(plik, e.code || e.message);
  }
  const wpisy = [];
  let pominiete = 0;
  for (const linia of surowe.split('\n')) {
    if (!linia.trim()) continue;
    try { wpisy.push(JSON.parse(linia)); } catch { pominiete += 1; }
  }
  return { wpisy, pominiete };
}

module.exports = {
  BladDanych, zapiszAtomowo, zapiszJson, czytajJson, dopiszLinie, czytajLinie, czyTablica, czyObiekt,
  zachowajKopie,
};
