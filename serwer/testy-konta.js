'use strict';

// ─── Testy: konta samoobslugowe (A1) - ZASLEPKA ETAPU 0 ───
// Kontrakt (PROJEKT-TECHNICZNY 11.2): plik eksportuje `async uruchom({ sprawdz })` i jest
// wolany z serwer/testy.js po testach etapu 0. Serwer testowy na porcie 0 z wlasnym
// srodowiskiem: require('./testy-wspolne.js').uruchomSerwer({ srodowisko, atrapaDostawcow }).
// Scenariusze do napisania: PROJEKT-TECHNICZNY 11.2, wiersz tego pliku.

const { pustaSekcja } = require('./testy-wspolne.js');

module.exports = { uruchom: pustaSekcja('konta samoobslugowe (A1)') };
