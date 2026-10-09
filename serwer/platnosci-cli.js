'use strict';

// ─── Polecenia platnosci w CLI (wykonawca B) - ZASLEPKA ETAPU 0 ──────────────
//
// uzytkownicy.js przekazuje tu polecenia: platnosci-* (sprawdz, synchronizuj,
// powiaz), przychod, ewidencja, zwrot. Kontrakt:
//   POLECENIA: [{ nazwa, opis, uzycie }]           (pomoc w uzytkownicy.js)
//   async uruchom(polecenie, argumenty, kontekst) -> kod wyjscia (0 = dobrze)
// kontekst: { KONF, magazyn, plany, dzierzawy, wypisz(tekst), blad(tekst) } - CLI otworzyl
// juz baze (timeout 5000 ms) i sprawdzil wlasciciela katalogu danych.

const POLECENIA = [
  { nazwa: 'platnosci-sprawdz', opis: 'konfiguracja platnosci i ceny u dostawcy (kod 0 = gotowe)', uzycie: 'platnosci-sprawdz' },
  { nazwa: 'platnosci-synchronizuj', opis: 'uzgodnienie stanu subskrypcji z dostawca', uzycie: 'platnosci-synchronizuj [login]' },
  { nazwa: 'platnosci-powiaz', opis: 'powiazanie konta z klientem (tylko tryb test)', uzycie: 'platnosci-powiaz <login> <id-klienta>' },
  { nazwa: 'przychod', opis: 'sumy wplat w kwartale albo roku (per waluta i kraj)', uzycie: 'przychod [RRRR-Qn|RRRR]' },
  { nazwa: 'ewidencja', opis: 'wplaty w okresie jako CSV (ewidencja sprzedazy)', uzycie: 'ewidencja <od RRRR-MM-DD> <do RRRR-MM-DD>' },
  { nazwa: 'zwrot', opis: 'zwrot przy odstapieniu w 14 dni', uzycie: 'zwrot <login>' },
];

function obsluguje(polecenie) {
  return POLECENIA.some((p) => p.nazwa === polecenie);
}

async function uruchom(polecenie, argumenty, kontekst) {
  const blad = (kontekst && kontekst.blad) || ((t) => console.error(t));
  blad(`Polecenie "${polecenie}" nie jest jeszcze dostępne w tym wydaniu (płatności: zaślepka etapu 0).`);
  return 1;
}

module.exports = { POLECENIA, obsluguje, uruchom };
