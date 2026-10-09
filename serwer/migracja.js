'use strict';

// ─── Migracja kont z plikow JSON (R8) do bazy SQLite (R9) i droga powrotna ───
//
// ARCH8-03. Wolana przy starcie serwera (i poleceniem `uzytkownicy.js migruj`),
// gdy istnieje uzytkownicy.json. Zasady bezpieczenstwa danych produkcyjnych:
//   1. najpierw wszystko jest CZYTANE i sprawdzane; uszkodzony plik (konta,
//      liczniki, wylogowania) przerywa migracje bledem BladDanych, zanim baza
//      zobaczy pierwszy wiersz, a pliki zostaja nietkniete (obok kopia .uszkodzony-*),
//   2. zapis do bazy w JEDNEJ transakcji BEGIN IMMEDIATE: awaria w polowie =
//      ROLLBACK, w bazie nic, pliki JSON nietkniete,
//   3. dopiero po COMMIT: kopia plikow do <dane>/przed-migracja-<czas>/ i zmiana
//      nazw na *.zmigrowany-<czas> (kod R8 uruchomiony bez eksportu nie wystartuje
//      na starych haslach i odwolanych sesjach, tylko zglosi "brak kont"),
//   4. idempotencja: ponowna migracja tych samych plikow niczego nie zmienia
//      (skrot zrodel w meta.migracja_json_skrot), a migracja plikow z eksportu
//      (wycofanie do R8 i powrot) przenosi zmiany z czasu wycofania,
//   5. sekret sesji (dane/sekret) zostaje bez zmian, wiec ciasteczka wydane przed
//      migracja dzialaja po niej.
// Wycofanie: eksportujDoJson() (polecenie `uzytkownicy.js eksport-json`) zapisuje
// pliki w formacie R8, tylko konta pochodzenie='admin'.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pliki = require('./pliki.js');
const magazyn = require('./magazyn.js');

const WZOR_LOGINU = /^[a-z0-9._-]{2,40}$/;
const ROLE = ['admin', 'uzytkownik'];
const WZOR_OKRESU = /^(zawsze|\d{4}-\d{2})$/;
const WZOR_CZYNNOSCI = /^[a-z][a-z:-]{0,39}$/;
// Czynnosci, ktore zna kod R8 (eksport-json pomija pule serwer:*).
const CZYNNOSCI_R8 = new Set(['artykul', 'grafika', 'audio', 'transkrypcja', 'wywolanie']);
const ZNANE_POLA = new Set(['login', 'hash', 'sol', 'rola', 'plan', 'utworzony', 'sesjeOd']);

class Wycofaj extends Error {}

function znacznik(teraz) {
  return new Date(teraz).toISOString().replace(/[:.]/g, '-');
}

/** Czyta zrodla bez zmian na dysku. Uszkodzony plik -> pliki.BladDanych (i kopia obok). */
function wczytajZrodla({ plikKont, katalogUzycia, plikWylogowanych }) {
  const skrot = crypto.createHash('sha256');
  let surowe;
  try {
    surowe = fs.readFileSync(plikKont);
  } catch (e) {
    throw new pliki.BladDanych(plikKont, e.code || e.message);
  }
  skrot.update('konta\0').update(surowe);
  const konta = pliki.czytajJson(plikKont, [], pliki.czyTablica);

  const liczniki = [];
  let wpisy = [];
  try {
    wpisy = fs.readdirSync(katalogUzycia, { withFileTypes: true });
  } catch (e) {
    if (e.code !== 'ENOENT') throw new pliki.BladDanych(katalogUzycia, e.code || e.message);
  }
  // Tylko <login>.json: pliki tymczasowe zapisu (.x.tmp-*) i kopie .uszkodzony-* nie sa licznikami.
  const nazwy = wpisy.filter((w) => w.isFile() && /^[A-Za-z0-9._-]+\.json$/.test(w.name) && !w.name.startsWith('.'))
    .map((w) => w.name).sort();
  for (const nazwa of nazwy) {
    const plik = path.join(katalogUzycia, nazwa);
    skrot.update(`uzycie\0${nazwa}\0`).update(fs.readFileSync(plik));
    liczniki.push({ login: nazwa.slice(0, -'.json'.length), plik, dane: pliki.czytajJson(plik, {}, pliki.czyObiekt) });
  }

  let wylogowane = [];
  if (fs.existsSync(plikWylogowanych)) {
    skrot.update('wylogowane\0').update(fs.readFileSync(plikWylogowanych));
    wylogowane = pliki.czytajJson(plikWylogowanych, [], pliki.czyTablica);
  }
  return { konta, liczniki, wylogowane, skrot: skrot.digest('hex') };
}

/** Sprawdzenie i normalizacja wpisow; nic, co nie przejdzie, nie trafia do bazy. */
function zaplanuj(zrodla, teraz) {
  const pominiete = [];
  const konta = [];
  const nieznanePola = new Set();
  const widziane = new Set();
  zrodla.konta.forEach((u, i) => {
    if (!u || typeof u !== 'object' || Array.isArray(u)) { pominiete.push({ pozycja: i, powod: 'wpis nie jest obiektem' }); return; }
    const login = typeof u.login === 'string' ? u.login : '';
    if (!WZOR_LOGINU.test(login)) { pominiete.push({ pozycja: i, powod: 'login w niepoprawnym formacie' }); return; }
    if (widziane.has(login)) { pominiete.push({ login, powod: 'powtorzony login (R8 uzywal pierwszego wpisu)' }); return; }
    if (!ROLE.includes(u.rola)) { pominiete.push({ login, powod: 'nieznana rola' }); return; }
    if (typeof u.hash !== 'string' || !/^[0-9a-f]{2,}$/i.test(u.hash) || typeof u.sol !== 'string' || !u.sol) {
      pominiete.push({ login, powod: 'brak skrotu hasla (hash/sol)' });
      return;
    }
    widziane.add(login);
    for (const pole of Object.keys(u)) if (!ZNANE_POLA.has(pole)) nieznanePola.add(pole);
    const sesjeOd = Number(u.sesjeOd);
    konta.push({
      login,
      hash: u.hash,
      sol: u.sol,
      rola: u.rola,
      plan: typeof u.plan === 'string' && u.plan ? u.plan : null,
      sesjeOd: Number.isFinite(sesjeOd) && sesjeOd > 0 ? sesjeOd : null,
      utworzony: typeof u.utworzony === 'string' && /^\d{4}-\d{2}-\d{2}/.test(u.utworzony) ? u.utworzony.slice(0, 10) : null,
    });
  });

  const liczniki = [];
  for (const { login, dane } of zrodla.liczniki) {
    if (!widziane.has(login)) { pominiete.push({ login, powod: 'plik licznikow bez konta w uzytkownicy.json' }); continue; }
    for (const [okres, czynnosci] of Object.entries(dane)) {
      if (!WZOR_OKRESU.test(okres) || !czynnosci || typeof czynnosci !== 'object' || Array.isArray(czynnosci)) {
        pominiete.push({ login, powod: `nieznany okres licznika "${String(okres).slice(0, 20)}"` });
        continue;
      }
      for (const [czynnosc, ile] of Object.entries(czynnosci)) {
        const n = Number(ile);
        if (!WZOR_CZYNNOSCI.test(czynnosc) || !Number.isFinite(n) || n < 0) {
          pominiete.push({ login, powod: `niepoprawny licznik ${okres}/${String(czynnosc).slice(0, 20)}` });
          continue;
        }
        liczniki.push({ login, okres, czynnosc, ile: Math.floor(n) });
      }
    }
  }

  const sesje = [];
  for (const w of zrodla.wylogowane) {
    if (w && typeof w.id === 'string' && w.id && Number(w.wygasa) > teraz) sesje.push({ id: w.id, wygasa: Number(w.wygasa) });
  }
  return { konta, liczniki, sesje, pominiete, nieznanePola: [...nieznanePola].sort(), loginy: widziane };
}

function kopiujZrodlo(zrodlo, cel) {
  if (!fs.existsSync(zrodlo)) return false;
  fs.cpSync(zrodlo, cel, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  // Kopia ma te same dane osobowe co oryginal: tylko dla konta uslugi.
  const zabezpiecz = (p) => {
    const st = fs.statSync(p);
    fs.chmodSync(p, st.isDirectory() ? 0o700 : 0o600);
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) zabezpiecz(path.join(p, n));
  };
  zabezpiecz(cel);
  return true;
}

/**
 * Migracja (albo jej sprawdzenie). Zrodla domyslnie z konfiguracji serwera.
 *   migrujZJson({ plikKont, katalogUzycia, plikWylogowanych, katalogDanych, teraz, tylkoSprawdz, poKoncie, loguj })
 *   -> { wykonano, powtorka, sprawdzenie, kont, nowych, zmienionych, licznikow, sesji, usuniete, pominiete,
 *        nieznanePola, katalogKopii, przeniesione, czas }
 * Bez pliku kont: { wykonano: false, powod: 'brak-pliku' }.
 * poKoncie(konto, i): tylko testy (symulacja awarii w polowie transakcji).
 */
function migrujZJson({
  plikKont, katalogUzycia, plikWylogowanych, katalogDanych, teraz = Date.now(), tylkoSprawdz = false,
  poKoncie = null, loguj = (s) => console.log(s),
} = {}) {
  if (!plikKont || !katalogUzycia || !plikWylogowanych) throw new Error('migrujZJson: wymagane plikKont, katalogUzycia, plikWylogowanych');
  if (!fs.existsSync(plikKont)) return { wykonano: false, powod: 'brak-pliku' };
  const katalog = katalogDanych || path.dirname(plikKont);

  const zrodla = wczytajZrodla({ plikKont, katalogUzycia, plikWylogowanych });
  const plan = zaplanuj(zrodla, teraz);
  const raport = {
    wykonano: false, powtorka: false, sprawdzenie: Boolean(tylkoSprawdz),
    kont: plan.konta.length, nowych: 0, zmienionych: 0, licznikow: plan.liczniki.length, sesji: plan.sesje.length,
    usuniete: [], pominiete: plan.pominiete, nieznanePola: plan.nieznanePola, niezgodnosci: [],
    katalogKopii: null, przeniesione: [], czas: new Date(teraz).toISOString(),
  };

  const zapisz = () => {
    // Konta usuniete w R8 w czasie wycofania: eksport-json zostawil liste wyeksportowanych loginow.
    let eksport = null;
    try { eksport = JSON.parse(magazyn.meta('eksport_json') || 'null'); } catch { eksport = null; }
    const zEksportu = new Set(eksport && Array.isArray(eksport.loginy) ? eksport.loginy : []);
    for (const login of zEksportu) {
      if (!plan.loginy.has(login) && magazyn.migracjaUsunKonto(login)) raport.usuniete.push(login);
    }
    // Konta zespolu w bazie, ktorych nie ma w pliku i nie bylo w eksporcie, zostaja (zalozone po eksporcie).
    for (const k of magazyn.listaKont({ pochodzenie: 'admin', limit: 100000 })) {
      if (!plan.loginy.has(k.login) && !zEksportu.has(k.login)) raport.niezgodnosci.push(k.login);
    }
    plan.konta.forEach((k, i) => {
      const wynik = magazyn.migracjaZapiszKonto(k, teraz);
      if (wynik === 'nowe') raport.nowych += 1;
      else if (wynik === 'zmienione') raport.zmienionych += 1;
      else raport.pominiete.push({ login: k.login, powod: 'w bazie jest konto samoobslugowe o tym loginie' });
      if (poKoncie) poKoncie(k, i);
    });
    for (const l of plan.liczniki) magazyn.ustawUzycie(l.login, l.okres, l.czynnosc, l.ile);
    for (const s of plan.sesje) magazyn.odwolajSesje(s.id, s.wygasa);
    magazyn.ustawMeta('migracja_json', raport.czas);
    magazyn.ustawMeta('migracja_json_skrot', zrodla.skrot);
    magazyn.ustawMeta('eksport_json', null);
  };

  if (tylkoSprawdz) {
    // Pelny przebieg w transakcji zakonczonej ROLLBACK: sprawdza takze ograniczenia bazy.
    try {
      magazyn.transakcja(() => { zapisz(); throw new Wycofaj(); });
    } catch (e) {
      if (!(e instanceof Wycofaj)) throw e;
    }
    return raport;
  }

  if (magazyn.meta('migracja_json_skrot') === zrodla.skrot) {
    // Te same pliki sa juz w bazie (np. awaria po COMMIT, przed zmiana nazw):
    // ponowne nalozenie cofnieloby zmiany hasel z R9, wiec tylko konczymy pliki.
    raport.powtorka = true;
  } else {
    magazyn.transakcja(zapisz);
  }
  raport.wykonano = true;

  // Po COMMIT: kopia, potem zmiana nazw. Blad tutaj zostawia pliki na miejscu,
  // a nastepny start dokonczy (skrot zrodel w meta).
  const czas = znacznik(teraz);
  const katalogKopii = path.join(katalog, `przed-migracja-${czas}`);
  fs.mkdirSync(katalogKopii, { recursive: true, mode: 0o700 });
  for (const zrodlo of [plikKont, katalogUzycia, plikWylogowanych]) {
    kopiujZrodlo(zrodlo, path.join(katalogKopii, path.basename(zrodlo)));
  }
  raport.katalogKopii = katalogKopii;
  for (const zrodlo of [plikKont, katalogUzycia, plikWylogowanych]) {
    if (!fs.existsSync(zrodlo)) continue;
    const cel = `${zrodlo}.zmigrowany-${czas}`;
    fs.renameSync(zrodlo, cel);
    raport.przeniesione.push(cel);
  }

  loguj(`[magazyn] migracja: ${raport.kont} kont, ${raport.licznikow} licznikow, ${raport.sesji} sesji`
    + `${raport.powtorka ? ' (juz w bazie - tylko kopia i zmiana nazw plikow)' : ` (nowych ${raport.nowych}, zmienionych ${raport.zmienionych})`}`
    + `; kopia: ${katalogKopii}`);
  if (raport.usuniete.length) loguj(`[magazyn] migracja: usuniete konta (usuniete w R8 po eksporcie): ${raport.usuniete.join(', ')}`);
  if (raport.niezgodnosci.length) loguj(`[magazyn] migracja: konta zespolu tylko w bazie (zostaja): ${raport.niezgodnosci.join(', ')}`);
  if (raport.nieznanePola.length) loguj(`[magazyn] migracja: pominiete nieznane pola kont: ${raport.nieznanePola.join(', ')}`);
  for (const p of raport.pominiete) loguj(`[magazyn] migracja: pominiete ${p.login || `#${p.pozycja}`}: ${p.powod}`);
  return raport;
}

/**
 * Wycofanie do R8: zapisuje uzytkownicy.json, uzycie/<login>.json i wylogowane.json
 * w formacie R8, tylko konta pochodzenie='admin' (konta samoobslugowe w R8
 * dzialalyby na kluczach serwera). W meta zostaje lista wyeksportowanych loginow
 * (migracja powtorna usunie konta skasowane w R8).
 *   eksportujDoJson({ plikKont, katalogUzycia, plikWylogowanych, teraz })
 *   -> { kont, pominieteSamoobslugowe, plikowLicznikow, sesji, plikKont }
 */
function eksportujDoJson({ plikKont, katalogUzycia, plikWylogowanych, teraz = Date.now() } = {}) {
  if (!plikKont || !katalogUzycia || !plikWylogowanych) throw new Error('eksportujDoJson: wymagane plikKont, katalogUzycia, plikWylogowanych');
  if (fs.existsSync(plikKont)) {
    throw new Error(`${plikKont} juz istnieje - nie nadpisuje (migracja nie byla zrobiona albo eksport juz jest).`);
  }
  const konta = magazyn.listaKont({ pochodzenie: 'admin', limit: 100000 });
  const pominieteSamoobslugowe = magazyn.liczbaKont({ pochodzenie: 'samoobsluga' });
  let plikowLicznikow = 0;
  for (const k of konta) {
    const dane = {};
    for (const [okres, czynnosci] of Object.entries(magazyn.uzycieKonta(k.login))) {
      for (const [czynnosc, ile] of Object.entries(czynnosci)) {
        if (!CZYNNOSCI_R8.has(czynnosc)) continue;
        if (!dane[okres]) dane[okres] = {};
        dane[okres][czynnosc] = ile;
      }
    }
    if (!Object.keys(dane).length) continue;
    pliki.zapiszJson(path.join(katalogUzycia, `${k.login}.json`), dane);
    plikowLicznikow += 1;
  }
  const sesje = magazyn.sesjeOdwolane(teraz);
  pliki.zapiszJson(plikWylogowanych, sesje);
  magazyn.ustawMeta('eksport_json', JSON.stringify({ czas: new Date(teraz).toISOString(), loginy: konta.map((k) => k.login) }));
  // Plik kont na koncu: jego obecnosc znaczy "eksport kompletny".
  pliki.zapiszJson(plikKont, konta.map((k) => {
    const wpis = { login: k.login, hash: k.hash, sol: k.sol, rola: k.rola };
    if (k.plan) wpis.plan = k.plan;
    wpis.utworzony = k.utworzony;
    if (k.sesjeOd) wpis.sesjeOd = k.sesjeOd;
    return wpis;
  }), 2);
  return { kont: konta.length, pominieteSamoobslugowe, plikowLicznikow, sesji: sesje.length, plikKont };
}

/** Czy sa pliki R8 czekajace na migracje (CLI odmawia wtedy pracy na bazie). */
function czekaNaMigracje(plikKont) {
  return Boolean(plikKont) && fs.existsSync(plikKont);
}

module.exports = { migrujZJson, eksportujDoJson, czekaNaMigracje, wczytajZrodla, zaplanuj, CZYNNOSCI_R8 };
