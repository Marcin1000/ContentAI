'use strict';

// ─── Wspolny pomocnik testow serwera (etap 0 rundy 9) ────────────────────────
//
// Serwer aplikacji na porcie 0 w katalogu tymczasowym z podanym srodowiskiem
// (wzor: testyPoprawek w serwer/testy.js), konta testowe, logowanie, zapytania
// JSON i formularzy z wlasnego pochodzenia, odczyt pliku poczty CAI_POCZTA_LOG.
// Kazdy plik testow wykonawcy (testy-konta.js, testy-platnosci.js, ...) eksportuje
// `async uruchom({ sprawdz })` i jest wolany z serwer/testy.js.
//
//   const { uruchomSerwer } = require('./testy-wspolne.js');
//   const t = await uruchomSerwer({ srodowisko: { CAI_REJESTRACJA: '1', ... }, atrapaDostawcow: true });
//   try {
//     const cookie = await t.zaloguj('standard');
//     const odp = await t.zadanie('/api/konto', { headers: { cookie } });
//     const post = await t.zadanie('/api/konto/zgody', t.json(cookie, { marketing: true }));
//     const form = await t.zadanie('/rejestracja', t.formularz(null, { email: 'a@b.pl', haslo: '...' }));
//     const listy = t.poczta();                 // wiadomosci z CAI_POCZTA_LOG (tryb 'log')
//   } finally { await t.zamknij(); }
//
// Serwer dostaje plik kont w formacie R8 i przenosi go do bazy przy utworzSerwer()
// (migracja), wiec kazdy test przechodzi tez przez migracje. Konta samoobslugowe
// zakladaj przez t.magazyn (np. utworzOrganizacjeIKonto) albo przez rejestracje.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HASLO = 'test-haslo-123';
// [login, rola, plan] - te same konta co w narzedzia/test_dymny.js i AG/narzedzia/konta.js
const KONTA_DOMYSLNE = [
  ['admin', 'admin', 'premium'],
  ['premium', 'uzytkownik', 'premium'],
  ['standard', 'uzytkownik', 'standard'],
  ['darmowy', 'uzytkownik', 'darmowy'],
];
// Moduly czytajace srodowisko przy require: przeladowane dla kazdego serwera testowego.
const MODULY_ZE_SRODOWISKIEM = ['./server.js', './prosby.js'];

function nasluch(serwer) {
  return new Promise((ok, zle) => {
    if (serwer.listening) return ok(serwer.address().port);
    serwer.once('listening', () => ok(serwer.address().port));
    serwer.once('error', zle);
    return undefined;
  });
}

/**
 * Stawia serwer aplikacji na porcie 0.
 *   uruchomSerwer({ srodowisko = {}, konta = KONTA_DOMYSLNE, atrapaDostawcow = false, przedStartem })
 *   -> { adres, katalog, srv, magazyn, KONF, zadanie, zaloguj, json, formularz, poczta, atrapa, zamknij }
 * srodowisko: zmienne dopisane do bazowych (undefined = usun zmienna).
 * atrapaDostawcow: true = narzedzia/atrapa/dostawcy.js na porcie 0 i CAI_URL_* na nia.
 * przedStartem({ katalog, env, srv }): po zapisie pliku kont R8, przed migracja i startem
 *   (np. dane z "poprzedniego wydania": liczniki, wylogowania, sekret sesji).
 */
async function uruchomSerwer({ srodowisko = {}, konta = KONTA_DOMYSLNE, atrapaDostawcow = false, przedStartem = null } = {}) {
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-test-'));
  let atrapa = null;
  const env = {
    CAI_UZYTKOWNICY: path.join(katalog, 'uzytkownicy.json'), CAI_SQLITE: path.join(katalog, 'contentai.sqlite'),
    CAI_KOPIE: path.join(katalog, 'kopie'), CAI_BAZA: path.join(katalog, 'baza'), CAI_UZYCIE: path.join(katalog, 'uzycie'),
    CAI_MARKA: katalog, CAI_SEKRET_PLIK: path.join(katalog, 'sekret'), CAI_WYLOGOWANE: path.join(katalog, 'wylogowane.json'),
    CAI_PROSBY: path.join(katalog, 'prosby.jsonl'), CAI_POCZTA_LOG: path.join(katalog, 'poczta.jsonl'),
    CAI_COOKIE_SECURE: '0', ANTHROPIC_KEY: 'test', OPENAI_KEY: 'test', ELEVEN_KEY: 'test',
  };
  if (atrapaDostawcow) {
    atrapa = require('../narzedzia/atrapa/dostawcy.js').uruchom(0, '127.0.0.1');
    const port = await nasluch(atrapa);
    Object.assign(env, {
      CAI_URL_ANTHROPIC: `http://127.0.0.1:${port}/v1/messages`, CAI_URL_OPENAI: `http://127.0.0.1:${port}/v1`,
      CAI_URL_ELEVEN: `http://127.0.0.1:${port}/eleven/v1`, CAI_URL_NVIDIA: `http://127.0.0.1:${port}/v1/chat/completions`,
      CAI_URL_EMBED: `http://127.0.0.1:${port}/v1/embeddings`,
    });
  }
  Object.assign(env, srodowisko);

  const przedEnv = {};
  for (const [k, v] of Object.entries(env)) {
    przedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = String(v);
  }
  const sciezki = MODULY_ZE_SRODOWISKIEM.map((m) => require.resolve(m));
  const kopieModulow = sciezki.map((m) => require.cache[m]);
  for (const m of sciezki) delete require.cache[m];
  const srv = require('./server.js');
  const magazyn = require('./magazyn.js');
  require('./limity.js').wyzerujWszystkie();
  require('./prosby.js').wyzerujLimity();

  fs.writeFileSync(env.CAI_UZYTKOWNICY, JSON.stringify(konta.map(([login, rola, plan]) => Object.assign(
    { login, rola, plan, utworzony: '2026-01-01' }, srv.zahaszuj(HASLO))), null, 2));
  if (przedStartem) await przedStartem({ katalog, env, srv });

  const serwer = srv.utworzSerwer();
  serwer.listen(0, '127.0.0.1');
  const adres = `http://127.0.0.1:${await nasluch(serwer)}`;
  const zWlasnej = { origin: adres, 'sec-fetch-site': 'same-origin' };

  const zadanie = (sciezka, opcje = {}) => fetch(adres + sciezka, { redirect: 'manual', ...opcje });
  async function zaloguj(login, haslo = HASLO) {
    const odp = await zadanie('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...zWlasnej },
      body: new URLSearchParams({ login, haslo }).toString(),
    });
    return (odp.headers.get('set-cookie') || '').split(';')[0];
  }
  const json = (cookie, body, inne = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...zWlasnej, ...(cookie ? { cookie } : {}), ...inne },
    body: JSON.stringify(body),
  });
  const formularz = (cookie, pola, inne = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...zWlasnej, ...(cookie ? { cookie } : {}), ...inne },
    body: new URLSearchParams(pola).toString(),
  });
  const poczta = () => {
    try {
      return fs.readFileSync(env.CAI_POCZTA_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  };

  async function zamknij() {
    await new Promise((r) => serwer.close(r));
    if (atrapa) await new Promise((r) => atrapa.close(r));
    magazyn.zamknij();
    for (const [k, v] of Object.entries(przedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    sciezki.forEach((m, i) => { delete require.cache[m]; if (kopieModulow[i]) require.cache[m] = kopieModulow[i]; });
    fs.rmSync(katalog, { recursive: true, force: true });
  }

  return {
    adres, katalog, srv, magazyn, KONF: srv.KONF, zWlasnej, zadanie, zaloguj, json, formularz, poczta, atrapa, zamknij, HASLO,
  };
}

/** Pusty plik testow wykonawcy: naglowek sekcji i nic wiecej (etap 0). */
function pustaSekcja(nazwa) {
  return async function uruchom() {
    console.log(`\n  ${nazwa}: brak testow (zaslepka etapu 0)`);
  };
}

module.exports = { uruchomSerwer, pustaSekcja, KONTA_DOMYSLNE, HASLO };
