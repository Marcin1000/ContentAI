'use strict';

// ─── Testy etapu 0 rundy 9 (wykonawca A0) ────────────────────────────────────
// Magazyn (node:sqlite), migracja z plikow JSON R8 i wycofanie (eksport-json),
// CLI na bazie, kody bledow, ogranicznik prob, dzierzawy, plany z limitami serwera
// i sufitem M-3, oznaczenia, kolejnosc tras i zaslepki modulow, kontrola
// konfiguracji, pliki wdrozenia (uslugi systemd, cli.sh, tabela zmiennych w README),
// ksztalt atrap stripe.js i poczta.js.
// Wolane z serwer/testy.js: require('./testy-magazyn.js').uruchom({ sprawdz }).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HASLO = 'test-haslo-123';

function tymczasowy(nazwa) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cai-${nazwa}-`));
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Ciasteczko sesji policzone tak jak w R8 (server.js utworzSesje), niezaleznie od kodu R9. */
function ciasteczkoR8(sekret, opis) {
  const cialo = b64u(JSON.stringify(opis));
  return `cai_auth=${cialo}.${b64u(crypto.createHmac('sha256', sekret).update(cialo).digest())}`;
}

/** Dane jak na serwerze R8: konta, liczniki (z plikiem tymczasowym i kopia uszkodzonego), wylogowania. */
function daneR8(kat, teraz = Date.now()) {
  const { zahaszuj } = require('./server.js');
  const h = zahaszuj(HASLO);
  const konta = [
    { login: 'marcin', ...h, rola: 'admin', plan: 'premium', utworzony: '2026-03-01' },
    { login: 'anna', ...h, rola: 'uzytkownik', plan: 'standard', utworzony: '2026-04-02', sesjeOd: 1700000000000 },
    { login: 'ola', ...h, rola: 'uzytkownik', utworzony: '2026-05-03', telefon: '123' },
    { login: 'Zly Login', ...h, rola: 'uzytkownik' },
    { login: 'anna', ...h, rola: 'admin' },
    { login: 'bez-hasla', rola: 'uzytkownik' },
  ];
  const plikKont = path.join(kat, 'uzytkownicy.json');
  const katalogUzycia = path.join(kat, 'uzycie');
  const plikWylogowanych = path.join(kat, 'wylogowane.json');
  fs.mkdirSync(katalogUzycia, { recursive: true });
  fs.writeFileSync(plikKont, JSON.stringify(konta, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(katalogUzycia, 'anna.json'), JSON.stringify({ zawsze: { artykul: 1 }, '2026-09': { artykul: 4, wywolanie: 40 }, '2026-10': { artykul: 2 } }));
  fs.writeFileSync(path.join(katalogUzycia, 'ola.json'), JSON.stringify({ zawsze: { artykul: 3, wywolanie: 25 } }));
  fs.writeFileSync(path.join(katalogUzycia, 'sierota.json'), JSON.stringify({ zawsze: { artykul: 1 } }));
  fs.writeFileSync(path.join(katalogUzycia, '.anna.json.tmp-1-abcd'), 'polowa zapisu');
  fs.writeFileSync(path.join(katalogUzycia, 'ola.json.uszkodzony-2026-01-01T00-00-00-000Z'), '{"zawsze":');
  fs.writeFileSync(plikWylogowanych, JSON.stringify([{ id: 'aktywna', wygasa: teraz + 3600_000 }, { id: 'stara', wygasa: teraz - 1000 }]));
  return { plikKont, katalogUzycia, plikWylogowanych, katalogDanych: kat, hash: h };
}

function bajty(plik) {
  return fs.readFileSync(plik);
}

// ─── Magazyn ────────────────────────────────────────────────────────────────

async function testyMagazynu(sprawdz) {
  const magazyn = require('./magazyn.js');
  const pliki = require('./pliki.js');
  const kat = tymczasowy('magazyn');
  const plik = path.join(kat, 'dane', 'contentai.sqlite');
  try {
    console.log('\n  magazyn - schemat i plik bazy (node:sqlite)');
    const stan = magazyn.otworz({ plik });
    sprawdz('magazyn: otwarcie zaklada katalog, plik i schemat w najnowszej wersji (1 + migracje)', stan.otwarty && stan.wersjaSchematu === magazyn.WERSJA_NAJNOWSZA && fs.existsSync(plik));
    sprawdz('magazyn: plik bazy tylko dla konta uslugi (0600)', (fs.statSync(plik).mode & 0o777) === 0o600);
    magazyn.utworzKonto({ login: 'zespol', hash: 'aa', sol: 'b', rola: 'admin' });
    sprawdz('magazyn: tryb WAL - plik -wal obok bazy, tez 0600', fs.existsSync(`${plik}-wal`) && (fs.statSync(`${plik}-wal`).mode & 0o777) === 0o600);
    sprawdz('magazyn: organizacja glowna istnieje od poczatku', (magazyn.organizacja('glowna') || {}).rodzaj === 'glowna');
    magazyn.zamknij();
    magazyn.otworz({ plik });
    sprawdz('magazyn: ponowne otwarcie zachowuje dane i wersje schematu', magazyn.konto('zespol') !== null && magazyn.stan().wersjaSchematu === magazyn.WERSJA_NAJNOWSZA);

    console.log('\n  magazyn - konta i organizacje');
    const k = magazyn.konto('zespol');
    sprawdz('konto w camelCase z polami jak w JSON (login, rola, plan, sesjeOd) i domyslnymi rundy 9',
      k.login === 'zespol' && k.rola === 'admin' && 'sesjeOd' in k && k.plan === null && k.organizacja === 'glowna'
      && k.pochodzenie === 'admin' && k.zrodloKluczy === 'serwera' && k.subskrypcjaStan === 'brak' && k.marketing === false);
    let zlePole = null;
    try { magazyn.zmienKonto('zespol', { haslo: 'x' }); } catch (e) { zlePole = e; }
    let zmianaLoginu = null;
    try { magazyn.zmienKonto('zespol', { login: 'inny' }); } catch (e) { zmianaLoginu = e; }
    sprawdz('zmienKonto: nieznane pole albo zmiana loginu to wyjatek, nie cicha strata', zlePole !== null && zmianaLoginu !== null && magazyn.konto('inny') === null);
    const nowe = magazyn.utworzOrganizacjeIKonto({ email: '  Anna@Firma.PL ', hash: 'aa', sol: 'b', jezyk: 'en' });
    sprawdz('rejestracja: konto k- (format loginu) w nowej organizacji o-, wlasciciel, klucze wlasne, plan pusty',
      /^k-[a-z2-7]{12}$/.test(nowe.login) && /^o-[a-z2-7]{12}$/.test(nowe.organizacja) && nowe.org.rodzaj === 'samoobsluga'
      && nowe.org.wlasciciel === nowe.login && nowe.rolaWOrganizacji === 'wlasciciel' && nowe.pochodzenie === 'samoobsluga'
      && nowe.zrodloKluczy === 'wlasne' && nowe.plan === null && nowe.jezyk === 'en' && nowe.rola === 'uzytkownik');
    sprawdz('e-mail znormalizowany (trim, male litery) i znajdowany w kazdej pisowni',
      nowe.email === 'anna@firma.pl' && (magazyn.kontoPoEmailu(' ANNA@firma.pl') || {}).login === nowe.login);
    let zajety = null;
    try { magazyn.utworzOrganizacjeIKonto({ email: 'anna@FIRMA.pl', hash: 'aa', sol: 'b' }); } catch (e) { zajety = e; }
    sprawdz('zajety e-mail -> BladKonfliktu (pole email), bez osieroconej organizacji',
      zajety instanceof magazyn.BladKonfliktu && zajety.pole === 'email' && magazyn.liczbaKont({ pochodzenie: 'samoobsluga' }) === 1);
    let zajetyLogin = null;
    try { magazyn.utworzKonto({ login: 'zespol', hash: 'aa', sol: 'b' }); } catch (e) { zajetyLogin = e; }
    sprawdz('istniejacy login w utworzKonto -> BladKonfliktu (pole login)', zajetyLogin instanceof magazyn.BladKonfliktu && zajetyLogin.pole === 'login');
    sprawdz('liczba operatorow liczy tylko adminow organizacji glownej', magazyn.liczbaOperatorow() === 1);
    let orgZKontem = null;
    try { magazyn.usunOrganizacje(nowe.organizacja); } catch (e) { orgZKontem = e; }
    let glowna = null;
    try { magazyn.usunOrganizacje('glowna'); } catch (e) { glowna = e; }
    sprawdz('organizacji z kontami ani glownej nie da sie usunac', orgZKontem !== null && glowna !== null && magazyn.organizacja(nowe.organizacja) !== null);

    console.log('\n  magazyn - liczniki uzycia');
    sprawdz('policz: atomowe dopisanie, zwrot nigdy ponizej zera',
      magazyn.policz('zespol', '2026-10', 'artykul') === 1 && magazyn.policz('zespol', '2026-10', 'artykul', 2) === 3
      && magazyn.policz('zespol', '2026-10', 'artykul', -10) === 0);
    const r1 = magazyn.zarezerwuj('zespol', 'zawsze', 'artykul', 2);
    const r2 = magazyn.zarezerwuj('zespol', 'zawsze', 'artykul', 2);
    const r3 = magazyn.zarezerwuj('zespol', 'zawsze', 'artykul', 2);
    sprawdz('zarezerwuj: do limitu przechodzi, ponad limit odmawia bez zapisu (KOD8-20)',
      r1.ok && r2.ok && !r3.ok && r3.ile === 2 && magazyn.uzycie('zespol', 'zawsze').artykul === 2);
    let fk = null;
    try { magazyn.policz('nie-ma-konta', 'zawsze', 'artykul'); } catch (e) { fk = e; }
    sprawdz('licznik bez konta odrzucony (klucz obcy)', fk !== null);

    console.log('\n  magazyn - tokeny e-mailowe, zgody, sesje');
    const token = magazyn.zapiszToken({ login: nowe.login, rodzaj: 'potwierdzenie', email: nowe.email, wazneMs: 60_000 });
    magazyn.zamknij();
    const zawartosc = bajty(plik).toString('latin1') + (fs.existsSync(`${plik}-wal`) ? bajty(`${plik}-wal`).toString('latin1') : '');
    magazyn.otworz({ plik });
    sprawdz('token w bazie tylko jako skrot SHA-256 (jawnego nie ma w pliku)',
      /^[A-Za-z0-9_-]{43}$/.test(token) && !zawartosc.includes(token) && zawartosc.includes(magazyn.skrotTokenu(token)));
    sprawdz('sprawdzToken nie zuzywa tokenu, zuzyjToken dziala raz',
      (magazyn.sprawdzToken(token, 'potwierdzenie') || {}).login === nowe.login
      && (magazyn.zuzyjToken(token, 'potwierdzenie') || {}).login === nowe.login
      && magazyn.zuzyjToken(token, 'potwierdzenie') === null && magazyn.sprawdzToken(token, 'potwierdzenie') === null
      && (magazyn.sprawdzToken(token, 'potwierdzenie', { takzeUzyte: true }) || {}).uzyty > 0);
    const t1 = magazyn.zapiszToken({ login: nowe.login, rodzaj: 'reset', email: nowe.email, wazneMs: 60_000 });
    const t2 = magazyn.zapiszToken({ login: nowe.login, rodzaj: 'reset', email: nowe.email, wazneMs: 60_000 });
    sprawdz('nowy token tego samego rodzaju uniewaznia poprzedni; inny rodzaj nie pasuje',
      magazyn.sprawdzToken(t1, 'reset') === null && magazyn.sprawdzToken(t2, 'reset') !== null && magazyn.sprawdzToken(t2, 'potwierdzenie') === null);
    sprawdz('token po terminie niewazny', magazyn.sprawdzToken(t2, 'reset', { teraz: Date.now() + 120_000 }) === null
      && magazyn.zuzyjToken(t2, 'reset', { teraz: Date.now() + 120_000 }) === null);
    magazyn.dopiszZgode({ login: nowe.login, rodzaj: 'regulamin', wersja: '2026-10-v1', wartosc: true, zrodlo: 'rejestracja' });
    magazyn.dopiszZgode({ login: nowe.login, rodzaj: 'marketing', wartosc: false, zrodlo: 'konto' });
    const zg = magazyn.zgody(nowe.login);
    sprawdz('zgody: dziennik z wersja, wartoscia, czasem i zrodlem', zg.length === 2 && zg[0].wersja === '2026-10-v1' && zg[0].wartosc === true && zg[1].wartosc === false && zg[0].czas > 0);
    magazyn.odwolajSesje('s-1', Date.now() + 60_000);
    sprawdz('sesja odwolana widoczna, inna nie', magazyn.sesjaOdwolana('s-1') && !magazyn.sesjaOdwolana('s-2') && magazyn.liczbaOdwolanych() === 1);

    console.log('\n  magazyn - platnosci (rejestr dla wykonawcy B)');
    const zd = [1, 2].map(() => magazyn.zapiszZdarzenie({ dostawca: 'stripe', id: 'evt_1', typ: 'invoice.paid', tryb: 'test', utworzone: 1 }));
    magazyn.oznaczZdarzenie('stripe', 'evt_1', { wynik: 'ok', login: nowe.login });
    sprawdz('zdarzenie: nowe, potem nieprzetworzone, po oznaczeniu przetworzone (idempotencja webhooka)',
      zd[0] === 'nowe' && zd[1] === 'nieprzetworzone' && magazyn.zapiszZdarzenie({ dostawca: 'stripe', id: 'evt_1', typ: 'x', tryb: 'test', utworzone: 1 }) === 'przetworzone');
    sprawdz('powiazanie klienta: ok, drugi klient przy koncie i ten sam klient przy innym koncie to konflikt',
      magazyn.powiazKlienta(nowe.login, { platnik: 'stripe', tryb: 'test', idKlienta: 'cus_1' }) === 'ok'
      && magazyn.powiazKlienta(nowe.login, { platnik: 'stripe', tryb: 'test', idKlienta: 'cus_2' }) === 'konflikt'
      && magazyn.powiazKlienta('zespol', { platnik: 'stripe', tryb: 'test', idKlienta: 'cus_1' }) === 'konflikt'
      && (magazyn.kontoPoKliencie('stripe', 'test', 'cus_1') || {}).login === nowe.login);
    magazyn.zastosujStanSubskrypcji(nowe.login, { stan: 'zalegla', plan: 'standard', okresDo: 5 }, 1000);
    magazyn.zastosujStanSubskrypcji(nowe.login, { stan: 'zalegla', plan: 'standard', okresDo: 5 }, 2000);
    const zalegla = magazyn.konto(nowe.login).zaleglaOd;
    magazyn.zastosujStanSubskrypcji(nowe.login, { stan: 'aktywna', plan: 'standard', okresDo: 9 }, 3000);
    sprawdz('stan subskrypcji: zalegla_od od pierwszego wejscia w zalegla, czyszczone przy wyjsciu',
      zalegla === 1000 && magazyn.konto(nowe.login).zaleglaOd === null && magazyn.konto(nowe.login).subskrypcjaStan === 'aktywna');
    const wplata = { dostawca: 'stripe', id: 'in_1', tryb: 'test', login: nowe.login, kwota: 7900, waluta: 'PLN', kraj: 'pl', oplacono: 10 };
    sprawdz('rejestr wplat: wplata raz, sumy per waluta i kraj', magazyn.dopiszPlatnosc(wplata) && !magazyn.dopiszPlatnosc(wplata)
      && JSON.stringify(magazyn.sumyPlatnosci({ tryb: 'test' })) === JSON.stringify([{ waluta: 'pln', kraj: 'PL', wplat: 1, suma: 7900, zwroty: 0 }]));

    console.log('\n  magazyn - transakcje i bledy');
    let wycofana = null;
    try { magazyn.transakcja(() => { magazyn.ustawMeta('t', '1'); throw new Error('awaria'); }); } catch (e) { wycofana = e; }
    const zagniezdzona = magazyn.transakcja(() => {
      magazyn.ustawMeta('a', '1');
      try { magazyn.transakcja(() => { magazyn.ustawMeta('b', '2'); throw new Error('w srodku'); }); } catch { /* punkt zapisu wycofany */ }
      return [magazyn.meta('a'), magazyn.meta('b')];
    });
    sprawdz('transakcja: wyjatek wycofuje wszystko, zagniezdzona wycofuje tylko swoj punkt zapisu',
      wycofana !== null && magazyn.meta('t') === null && zagniezdzona[0] === '1' && zagniezdzona[1] === null && magazyn.meta('a') === '1');
    let asynchroniczna = null;
    try { magazyn.transakcja(async () => { magazyn.ustawMeta('c', '3'); }); } catch (e) { asynchroniczna = e; }
    sprawdz('transakcja z funkcja async odrzucona i wycofana', asynchroniczna !== null && magazyn.meta('c') === null);
    // Blokada zapisu przez inny proces dluzej niz limit czekania = 503, nie 500 ani cisza.
    const sqlite = require('node:sqlite');
    const inna = new sqlite.DatabaseSync(plik, { timeout: 50 });
    magazyn.zamknij();
    magazyn.otworz({ plik, timeoutMs: 100 });
    inna.exec('BEGIN IMMEDIATE');
    let zajeta = null;
    try { magazyn.policz('zespol', 'zawsze', 'grafika'); } catch (e) { zajeta = e; }
    inna.exec('ROLLBACK');
    inna.close();
    sprawdz('baza zablokowana przez inny proces -> BladMagazynu (BladDanych, 503)', zajeta instanceof pliki.BladDanych && zajeta.status === 503 && /SQLITE_BUSY/.test(zajeta.message));
    sprawdz('po zwolnieniu blokady zapis dziala', magazyn.policz('zespol', 'zawsze', 'grafika') === 1);

    console.log('\n  magazyn - kopie i sprzatanie');
    const katKopii = path.join(kat, 'kopie');
    const kopie = [];
    for (let i = 0; i < 4; i += 1) kopie.push(await magazyn.kopiaOkresowa({ katalog: katKopii, zostaw: 3, teraz: Date.UTC(2026, 9, 9, 10, i) }));
    const zostalo = fs.readdirSync(katKopii).sort();
    sprawdz('kopia okresowa: najnowsze 3, starsze usuniete, pliki 0600',
      zostalo.length === 3 && !fs.existsSync(kopie[0]) && fs.existsSync(kopie[3]) && (fs.statSync(kopie[3]).mode & 0o777) === 0o600);
    magazyn.zamknij();
    magazyn.otworz({ plik: kopie[3] });
    const zKopii = magazyn.konto('zespol');
    magazyn.zamknij();
    magazyn.otworz({ plik });
    sprawdz('kopia jest pelna baza (sqlite.backup w trakcie pracy)', zKopii !== null && zKopii.rola === 'admin');
    const teraz = Date.now();
    magazyn.ustawUzycie('zespol', '2024-01', 'artykul', 5);
    magazyn.ustawUzycie('zespol', '2099-01', 'artykul', 5);
    magazyn.odwolajSesje('przeterminowana', teraz - 1);
    const s = magazyn.sprzataj(teraz);
    sprawdz('sprzatanie: sesje po terminie i liczniki starsze niz 13 miesiecy znikaja, biezace i "zawsze" zostaja',
      s.sesje >= 1 && !magazyn.sesjaOdwolana('przeterminowana') && magazyn.sesjaOdwolana('s-1')
      && magazyn.uzycie('zespol', '2024-01').artykul === undefined && magazyn.uzycie('zespol', '2099-01').artykul === 5
      && magazyn.uzycie('zespol', 'zawsze').artykul === 2);
    const przedUsunieciem = magazyn.zapiszToken({ login: nowe.login, rodzaj: 'reset', email: nowe.email, wazneMs: 60_000 });
    magazyn.usunKonto(nowe.login, { powod: 'uzytkownik', emailSkrot: 'skrot-1' });
    sprawdz('usuniecie konta: kaskadowo liczniki i tokeny, wpis w konta_usuniete z klientem platnosci',
      magazyn.konto(nowe.login) === null && Object.keys(magazyn.uzycieKonta(nowe.login)).length === 0
      && magazyn.sprawdzToken(przedUsunieciem, 'reset') === null && (magazyn.kontoUsuniete(nowe.login) || {}).platnikKlient === 'cus_1'
      && magazyn.emailBylUsuniety('skrot-1') && magazyn.zgody(nowe.login).length === 2);
    sprawdz('ostatnie konto organizacji usuniete -> organizacje mozna usunac', magazyn.usunOrganizacje(nowe.organizacja) === true);

    console.log('\n  magazyn - uszkodzony plik bazy');
    magazyn.zamknij();
    const dobra = bajty(plik);
    fs.writeFileSync(plik, dobra.subarray(0, 1000));
    let uszkodzona = null;
    try { magazyn.otworz({ plik }); } catch (e) { uszkodzona = e; }
    sprawdz('uszkodzona baza: BladDanych 503, plik nietkniety, kopia .uszkodzony-* obok',
      uszkodzona instanceof pliki.BladDanych && uszkodzona.status === 503 && bajty(plik).equals(dobra.subarray(0, 1000))
      && fs.readdirSync(path.dirname(plik)).some((n) => n.startsWith('contentai.sqlite.uszkodzony-')));
    let zamknieta = null;
    try { magazyn.konto('zespol'); } catch (e) { zamknieta = e; }
    sprawdz('baza zamknieta: kazde zapytanie to BladMagazynu 503 (nie "nie ma konta")', zamknieta instanceof pliki.BladDanych && zamknieta.status === 503);
  } finally {
    magazyn.zamknij();
    fs.rmSync(kat, { recursive: true, force: true });
  }
}

// ─── Migracja z JSON i wycofanie ─────────────────────────────────────────────

async function testyMigracji(sprawdz) {
  const magazyn = require('./magazyn.js');
  const migracja = require('./migracja.js');
  const plany = require('./plany.js');
  const pliki = require('./pliki.js');
  const { hasloPasuje } = require('./server.js');
  const cicho = () => {};

  console.log('\n  migracja z plikow JSON (R8) do bazy');
  const kat = tymczasowy('migracja');
  try {
    const teraz = Date.now();
    const r8 = daneR8(kat, teraz);
    const oryginaly = { konta: bajty(r8.plikKont), anna: bajty(path.join(r8.katalogUzycia, 'anna.json')), wylogowane: bajty(r8.plikWylogowanych) };
    magazyn.otworz({ plik: path.join(kat, 'contentai.sqlite') });

    const sprawdzenie = migracja.migrujZJson({ ...r8, tylkoSprawdz: true, loguj: cicho, teraz });
    sprawdz('migruj --sprawdz: pelny przebieg wycofany - baza i pliki bez zmian',
      sprawdzenie.sprawdzenie && sprawdzenie.kont === 3 && magazyn.liczbaKont() === 0 && bajty(r8.plikKont).equals(oryginaly.konta));

    const raport = migracja.migrujZJson({ ...r8, loguj: cicho, teraz });
    sprawdz('migracja: 3 poprawne konta, 6 licznikow, 1 wazna sesja odwolana',
      raport.wykonano && raport.kont === 3 && raport.nowych === 3 && raport.licznikow === 6 && raport.sesji === 1);
    const powody = raport.pominiete.map((p) => p.powod).join('|');
    sprawdz('migracja: zle wpisy pominiete z powodem (format loginu, powtorzony login, brak hasla, liczniki bez konta), nieznane pola nazwane',
      /formacie/.test(powody) && /powtorzony/.test(powody) && /hash/.test(powody) && /bez konta/.test(powody)
      && raport.nieznanePola.join(',') === 'telefon');
    const marcin = magazyn.konto('marcin');
    const anna = magazyn.konto('anna');
    const ola = magazyn.konto('ola');
    sprawdz('konta po migracji: te same role, plany, sesjeOd i daty; organizacja glowna, pochodzenie admin, klucze serwera',
      marcin.rola === 'admin' && marcin.plan === 'premium' && anna.plan === 'standard' && anna.sesjeOd === 1700000000000
      && ola.plan === null && ola.utworzony === '2026-05-03' && marcin.utworzony === '2026-03-01'
      && [marcin, anna, ola].every((k) => k.organizacja === 'glowna' && k.pochodzenie === 'admin' && k.zrodloKluczy === 'serwera'));
    sprawdz('hasla przezywaja migracje (ten sam hash i sol)', [marcin, anna, ola].every((k) => hasloPasuje(HASLO, k)));
    sprawdz('liczniki przezywaja migracje: wyczerpany darmowy pakiet zostaje wyczerpany',
      JSON.stringify(magazyn.uzycie('anna', '2026-09')) === JSON.stringify({ artykul: 4, wywolanie: 40 })
      && plany.sprawdzLimit({ konto: ola, czynnosc: 'artykul' }).wolno === false && plany.nazwaPlanu(ola) === 'darmowy');
    sprawdz('wylogowania przezywaja migracje (przeterminowane pominiete)', magazyn.sesjaOdwolana('aktywna') && !magazyn.sesjaOdwolana('stara'));
    const pliki2 = fs.readdirSync(kat);
    const zmigrowany = pliki2.find((n) => n.startsWith('uzytkownicy.json.zmigrowany-'));
    const katalogKopii = path.join(kat, pliki2.find((n) => n.startsWith('przed-migracja-')) || 'brak');
    sprawdz('po COMMIT: pliki R8 przemianowane na *.zmigrowany-<czas> (z tymi samymi bajtami)',
      !fs.existsSync(r8.plikKont) && !fs.existsSync(r8.katalogUzycia) && !fs.existsSync(r8.plikWylogowanych)
      && Boolean(zmigrowany) && bajty(path.join(kat, zmigrowany)).equals(oryginaly.konta)
      && pliki2.some((n) => n.startsWith('uzycie.zmigrowany-')) && pliki2.some((n) => n.startsWith('wylogowane.json.zmigrowany-')));
    sprawdz('kopia przed migracja: przed-migracja-<czas>/ z identycznymi plikami, katalog 0700, pliki 0600',
      fs.existsSync(katalogKopii) && (fs.statSync(katalogKopii).mode & 0o777) === 0o700
      && bajty(path.join(katalogKopii, 'uzytkownicy.json')).equals(oryginaly.konta)
      && bajty(path.join(katalogKopii, 'uzycie', 'anna.json')).equals(oryginaly.anna)
      && bajty(path.join(katalogKopii, 'wylogowane.json')).equals(oryginaly.wylogowane)
      && (fs.statSync(path.join(katalogKopii, 'uzytkownicy.json')).mode & 0o777) === 0o600
      && raport.katalogKopii === katalogKopii && magazyn.meta('migracja_json') === raport.czas);
    sprawdz('migracja jest idempotentna: bez plikow R8 nic nie robi', migracja.migrujZJson({ ...r8, loguj: cicho }).powod === 'brak-pliku');

    // Awaria po COMMIT, przed zmiana nazw: te same pliki wracaja na miejsce. Ponowne
    // nalozenie cofneloby zmiany z R9 (tu: nowe haslo), wiec konczymy tylko pliki.
    const { zahaszuj } = require('./server.js');
    const noweHaslo = zahaszuj('nowe-haslo-12345');
    magazyn.zmienKonto('anna', noweHaslo);
    for (const n of fs.readdirSync(kat).filter((x) => x.includes('.zmigrowany-'))) {
      fs.renameSync(path.join(kat, n), path.join(kat, n.replace(/\.zmigrowany-.*$/, '')));
    }
    const powtorka = migracja.migrujZJson({ ...r8, loguj: cicho });
    sprawdz('powtorka tych samych plikow (awaria po COMMIT): bez nadpisania zmian z R9, tylko kopia i zmiana nazw',
      powtorka.powtorka && magazyn.konto('anna').hash === noweHaslo.hash && !fs.existsSync(r8.plikKont));

    console.log('\n  wycofanie do R8 (eksport-json) i powrot');
    const samo = magazyn.utworzOrganizacjeIKonto({ email: 'klient@firma.pl', ...zahaszuj(HASLO) });
    magazyn.policz(samo.login, 'zawsze', 'artykul', 2);
    magazyn.policz('anna', '2026-10', 'serwer:wektory', 5);
    magazyn.zmienKonto('marcin', { sesjeOd: 5000 });
    const eksport = migracja.eksportujDoJson(r8);
    const json = JSON.parse(fs.readFileSync(r8.plikKont, 'utf8'));
    const licznikAnny = JSON.parse(fs.readFileSync(path.join(r8.katalogUzycia, 'anna.json'), 'utf8'));
    sprawdz('eksport-json: format R8, tylko konta zespolu (bez samoobslugowych), sesjeOd i plan zachowane',
      eksport.kont === 3 && eksport.pominieteSamoobslugowe === 1 && json.map((k) => k.login).sort().join(',') === 'anna,marcin,ola'
      && json.every((k) => Object.keys(k).every((p) => ['login', 'hash', 'sol', 'rola', 'plan', 'utworzony', 'sesjeOd'].includes(p)))
      && json.find((k) => k.login === 'marcin').sesjeOd === 5000 && !('plan' in json.find((k) => k.login === 'ola')));
    sprawdz('eksport-json: liczniki tylko czynnosci R8 (bez puli serwer:*), wylogowania w wylogowane.json',
      licznikAnny['2026-09'].wywolanie === 40 && !('serwer:wektory' in (licznikAnny['2026-10'] || {}))
      && JSON.parse(fs.readFileSync(r8.plikWylogowanych, 'utf8')).some((w) => w.id === 'aktywna'));
    let podwojny = null;
    try { migracja.eksportujDoJson(r8); } catch (e) { podwojny = e; }
    sprawdz('eksport-json nie nadpisuje istniejacego pliku kont', podwojny !== null && /juz istnieje/.test(podwojny.message));

    // "Czas R8": haslo marcina zmienione przez CLI R8, ola dostaje pakiet, anna usunieta,
    // nowe liczniki; w bazie R9 po eksporcie powstaje konto zespolu (zostaje).
    const r8Haslo = zahaszuj('haslo-z-r8-123');
    const poR8 = json.filter((k) => k.login !== 'anna').map((k) => {
      if (k.login === 'marcin') return { ...k, ...r8Haslo, sesjeOd: 9000 };
      if (k.login === 'ola') return { ...k, plan: 'standard' };
      return k;
    });
    fs.writeFileSync(r8.plikKont, JSON.stringify(poR8));
    fs.writeFileSync(path.join(r8.katalogUzycia, 'ola.json'), JSON.stringify({ zawsze: { artykul: 3, wywolanie: 25 }, '2026-10': { artykul: 7 } }));
    magazyn.utworzKonto({ login: 'po-eksporcie', ...zahaszuj(HASLO) });
    const powrot = migracja.migrujZJson({ ...r8, loguj: cicho });
    sprawdz('powrot do R9: zmiany z czasu wycofania wygrywaja (haslo, sesjeOd, plan, liczniki)',
      powrot.wykonano && magazyn.konto('marcin').hash === r8Haslo.hash && magazyn.konto('marcin').sesjeOd === 9000
      && magazyn.konto('ola').plan === 'standard' && magazyn.uzycie('ola', '2026-10').artykul === 7);
    sprawdz('powrot do R9: konto usuniete w R8 usuniete z bazy, konto zalozone po eksporcie zostaje',
      powrot.usuniete.join(',') === 'anna' && magazyn.konto('anna') === null && magazyn.konto('po-eksporcie') !== null
      && powrot.niezgodnosci.includes('po-eksporcie') && magazyn.meta('eksport_json') === null);
    sprawdz('powrot do R9: konto samoobslugowe i jego liczniki nietkniete',
      magazyn.konto(samo.login) !== null && magazyn.uzycie(samo.login, 'zawsze').artykul === 2);
    // Starszy sesjeOd w pliku nie cofa "wyloguj wszedzie" z bazy.
    magazyn.zmienKonto('marcin', { sesjeOd: 20000 });
    migracja.eksportujDoJson(r8);
    fs.writeFileSync(r8.plikKont, JSON.stringify(JSON.parse(fs.readFileSync(r8.plikKont, 'utf8')).map((k) => (k.login === 'marcin' ? { ...k, sesjeOd: 100 } : k))));
    migracja.migrujZJson({ ...r8, loguj: cicho });
    sprawdz('sesjeOd przy migracji to wieksza z dwoch wartosci (uniewaznienie sie nie cofa)', magazyn.konto('marcin').sesjeOd === 20000);
    magazyn.zamknij();
  } finally {
    magazyn.zamknij();
    fs.rmSync(kat, { recursive: true, force: true });
  }

  console.log('\n  migracja - awaria i uszkodzone pliki');
  const kat2 = tymczasowy('migracja-awaria');
  try {
    const r8 = daneR8(kat2);
    const przed = fs.readdirSync(kat2).sort().join(',');
    const oryginal = bajty(r8.plikKont);
    magazyn.otworz({ plik: path.join(kat2, 'contentai.sqlite') });
    let awaria = null;
    try {
      migracja.migrujZJson({ ...r8, loguj: cicho, poKoncie: (k, i) => { if (i === 1) throw new Error('awaria w polowie'); } });
    } catch (e) { awaria = e; }
    sprawdz('awaria w polowie transakcji: ROLLBACK - w bazie zero kont, nic nie oznaczone',
      awaria !== null && /awaria w polowie/.test(awaria.message) && magazyn.liczbaKont() === 0 && magazyn.meta('migracja_json') === null);
    sprawdz('awaria w polowie transakcji: pliki JSON nietkniete i bez zmiany nazw, bez katalogu kopii',
      bajty(r8.plikKont).equals(oryginal) && fs.readdirSync(kat2).filter((n) => n !== 'contentai.sqlite' && !n.startsWith('contentai.sqlite-')).sort().join(',') === przed);
    fs.writeFileSync(r8.plikKont, '[{"login":"marcin","hash":');
    let uszkodzony = null;
    try { migracja.migrujZJson({ ...r8, loguj: cicho }); } catch (e) { uszkodzony = e; }
    sprawdz('uszkodzony uzytkownicy.json: BladDanych przed pierwszym zapisem, plik nietkniety, kopia obok',
      uszkodzony instanceof pliki.BladDanych && magazyn.liczbaKont() === 0 && fs.readFileSync(r8.plikKont, 'utf8') === '[{"login":"marcin","hash":'
      && fs.readdirSync(kat2).some((n) => n.startsWith('uzytkownicy.json.uszkodzony-')));
  } finally {
    magazyn.zamknij();
    fs.rmSync(kat2, { recursive: true, force: true });
  }

  console.log('\n  migracja - cudze pliki R8 poza katalogiem pliku kont');
  // Test albo serwer roli z CAI_UZYTKOWNICY w swoim katalogu i domyslnym CAI_WYLOGOWANE
  // (dane/wylogowane.json repozytorium, wspolne z innym serwerem R8): ten plik zostaje.
  const kat3 = tymczasowy('migracja-cudze');
  try {
    const wlasne = path.join(kat3, 'wlasne');
    const cudze = path.join(kat3, 'repo-dane');
    fs.mkdirSync(wlasne);
    fs.mkdirSync(cudze);
    const r8Cudze = daneR8(cudze);
    const plikKont = path.join(wlasne, 'uzytkownicy.json');
    fs.copyFileSync(r8Cudze.plikKont, plikKont);
    const oryginalWyl = bajty(r8Cudze.plikWylogowanych);
    const domyslne = migracja.zrodlaR8({ plikKont, katalogUzycia: r8Cudze.katalogUzycia, plikWylogowanych: r8Cudze.plikWylogowanych });
    const jawne = migracja.zrodlaR8({ plikKont, katalogUzycia: r8Cudze.katalogUzycia, plikWylogowanych: r8Cudze.plikWylogowanych, jawneUzycie: true, jawneWylogowane: true });
    const produkcja = migracja.zrodlaR8({ plikKont: r8Cudze.plikKont, katalogUzycia: r8Cudze.katalogUzycia, plikWylogowanych: r8Cudze.plikWylogowanych });
    sprawdz('zrodlaR8: liczniki i wylogowania spoza katalogu kont tylko jawnie (zmienna), obok pliku kont zawsze',
      domyslne.katalogUzycia === null && domyslne.plikWylogowanych === null && domyslne.pominiete.length === 2
      && jawne.katalogUzycia === r8Cudze.katalogUzycia && jawne.plikWylogowanych === r8Cudze.plikWylogowanych
      && produkcja.katalogUzycia === r8Cudze.katalogUzycia && produkcja.plikWylogowanych === r8Cudze.plikWylogowanych
      && domyslne.katalogDanych === wlasne);
    magazyn.otworz({ plik: path.join(wlasne, 'contentai.sqlite') });
    const raport = migracja.migrujZJson({ ...domyslne, loguj: cicho });
    sprawdz('migracja bez cudzych zrodel: konta przeniesione, cudze wylogowania i liczniki nietkniete (bez zmiany nazw)',
      raport.wykonano && raport.kont === 3 && raport.sesji === 0 && raport.licznikow === 0
      && bajty(r8Cudze.plikWylogowanych).equals(oryginalWyl) && fs.existsSync(path.join(r8Cudze.katalogUzycia, 'anna.json'))
      && !fs.readdirSync(cudze).some((n) => n.includes('.zmigrowany-')) && !fs.existsSync(plikKont));
  } finally {
    magazyn.zamknij();
    fs.rmSync(kat3, { recursive: true, force: true });
  }
}

// ─── Moduly pomocnicze: bledy, limity, dzierzawy, plany, oznaczenia ──────────

function testyModulow(sprawdz) {
  const bledy = require('./bledy.js');
  const limity = require('./limity.js');
  const dzierzawy = require('./dzierzawy.js');
  const plany = require('./plany.js');
  const oznaczenia = require('./oznaczenia.js');

  console.log('\n  kody bledow dla aplikacji (X-CAI-Kod)');
  const odp = () => {
    const o = { naglowki: {}, req: { headers: { 'accept-language': 'en-US,en;q=0.9' } }, headersSent: false };
    o.writeHead = (status, n) => { o.status = status; Object.assign(o.naglowki, n); };
    o.end = (c) => { o.cialo = JSON.parse(c); };
    return o;
  };
  const a = odp();
  bledy.bladCai(a, 'brak-klucza', 403, { dostawca: 'anthropic' });
  sprawdz('bladCai: status, X-CAI-Kod, cialo w ksztalcie bledu dostawcy z kodem i komunikatem w jezyku zapytania',
    a.status === 403 && a.naglowki['X-CAI-Kod'] === 'brak-klucza' && a.cialo.error.type === 'cai_brak_klucza'
    && /Anthropic/.test(a.cialo.error.message) && a.cialo.kod === 'brak-klucza' && a.cialo.dostawca === 'anthropic' && /Connect/.test(a.cialo.komunikat));
  const b = odp();
  bledy.bladCai(b, 'limit-pakietu', 402, { error: 'Limit pakietu wyczerpany', czynnosc: 'artykul', limit: 3, zuzyte: 3, odnawialny: false });
  sprawdz('bladCai: dzisiejsze pola 402 zostaja (error jako napis, czynnosc, limit), dochodzi tylko kod',
    b.cialo.error === 'Limit pakietu wyczerpany' && b.cialo.czynnosc === 'artykul' && b.cialo.limit === 3 && b.cialo.kod === 'limit-pakietu');
  let nieznany = null;
  try { bledy.bladCai(odp(), 'zmyslony', 400); } catch (e) { nieznany = e; }
  sprawdz('bladCai: nieznany kod to wyjatek (literowka nie wyjdzie do aplikacji)', nieznany !== null);
  const wymagane = ['sesja', 'brak-klucza', 'zly-klucz', 'limit-pakietu', 'funkcja-poza-pakietem', 'zasob-serwera-wyczerpany',
    'email-niepotwierdzony', 'zgoda-wymagana', 'uprawnienia-organizacji', 'platnosci-wylaczone', 'sprzedaz-wstrzymana',
    'zakup-niedozwolony', 'plan-niedostepny', 'subskrypcja-istnieje', 'brak-subskrypcji', 'dostawca-platnosci-niedostepny', 'za-duzo-prob'];
  sprawdz('lista kodow z rozdz. 5 kompletna, komunikaty PL i EN bez dlugich myslnikow',
    wymagane.every((k) => bledy.KODY[k] && bledy.KODY[k].pl && bledy.KODY[k].en)
    && !Object.values(bledy.KODY).some((k) => /[\u2013\u2014]/.test(k.pl + k.en)));

  console.log('\n  ogolny ogranicznik prob (limity.js)');
  const rej = limity.utworz('test-rejestracja', [
    { nazwa: 'adres', klucz: (k) => k.ip, ile: 2, oknoMs: limity.GODZINA },
    { nazwa: 'siec', klucz: (k) => limity.siecAdresu(k.ip), ile: 3, oknoMs: limity.DOBA },
  ]);
  const t0 = Date.UTC(2026, 9, 9, 12);
  const w = [rej.ocen({ ip: '203.0.113.1' }, t0), rej.ocen({ ip: '203.0.113.1' }, t0), rej.ocen({ ip: '203.0.113.1' }, t0)];
  sprawdz('limit z adresu: dwie proby przechodza, trzecia odmowa z czasem ponowienia',
    w[0].wolno && w[1].wolno && !w[2].wolno && w[2].regula === 'adres' && w[2].ponowZa === 3600);
  const zSieci = [rej.ocen({ ip: '203.0.113.2' }, t0), rej.ocen({ ip: '203.0.113.3' }, t0)];
  sprawdz('limit z sieci /24 liczy rozne adresy razem', zSieci[0].wolno && !zSieci[1].wolno && zSieci[1].regula === 'siec');
  sprawdz('okno przesuwne: po godzinie adres znow moze, siec jeszcze nie', rej.sprawdz({ ip: '198.51.100.1' }, t0 + limity.GODZINA).wolno
    && !rej.sprawdz({ ip: '203.0.113.9' }, t0 + limity.GODZINA).wolno && rej.sprawdz({ ip: '203.0.113.9' }, t0 + limity.DOBA).wolno);
  const konto = limity.utworz('test-logowanie-konto', [{ nazwa: 'konto', klucz: (k) => k.login, ile: 3, oknoMs: limity.GODZINA, blokadaMs: 15 * limity.MINUTA }]);
  for (let i = 0; i < 3; i += 1) konto.zapisz({ login: 'anna' }, t0);
  const zablokowane = konto.sprawdz({ login: 'anna' }, t0 + 1000);
  konto.wyczysc({ login: 'anna' });
  sprawdz('blokada po porazkach (logowanie per konto), wyczysc po sukcesie',
    !zablokowane.wolno && zablokowane.ponowZa === 899 && konto.sprawdz({ login: 'anna' }, t0 + 1000).wolno && konto.sprawdz({ login: 'ola' }, t0).wolno);
  sprawdz('siec adresu: IPv4 /24, IPv6 /48, IPv4 zapisany jako IPv6',
    limity.siecAdresu('::ffff:10.1.2.3') === '10.1.2.0/24' && limity.siecAdresu('2001:db8:abcd:12::1') === limity.siecAdresu('2001:db8:abcd:ffff::9'));

  console.log('\n  dzierzawy (organizacje)');
  const operator = { login: 'm', rola: 'admin', organizacja: 'glowna' };
  const czlonek = { login: 'a', rola: 'uzytkownik', organizacja: 'glowna', rolaWOrganizacji: 'czlonek' };
  const wlasciciel = { login: 'k-aaaaaaaaaaaa', rola: 'uzytkownik', organizacja: 'o-bbbbbbbbbbbb', rolaWOrganizacji: 'wlasciciel' };
  sprawdz('operator tylko admin organizacji glownej; konto bez pola organizacji = glowna (stary kod)',
    dzierzawy.operator(operator) && dzierzawy.operator({ rola: 'admin' }) && !dzierzawy.operator({ ...wlasciciel, rola: 'admin' }) && !dzierzawy.operator(czlonek));
  sprawdz('mozeZarzadzac: w glownej admin, w samoobslugowej wlasciciel',
    dzierzawy.mozeZarzadzac(operator) && !dzierzawy.mozeZarzadzac(czlonek) && dzierzawy.mozeZarzadzac(wlasciciel)
    && !dzierzawy.mozeZarzadzac({ ...wlasciciel, rolaWOrganizacji: 'czlonek' }));
  sprawdz('zrodlo SERP: glowna -> CAI_SERP, inne -> CAI_SERP_SAMOOBSLUGA',
    dzierzawy.zrodloSerp(operator, { serp: 'openseo', serpSamoobsluga: 'model' }) === 'openseo'
    && dzierzawy.zrodloSerp(wlasciciel, { serp: 'openseo', serpSamoobsluga: 'model' }) === 'model');
  let zlyId = null;
  try { dzierzawy.plikMarki('/m', '../etc'); } catch (e) { zlyId = e; }
  sprawdz('sciezki organizacji: glowna na dzisiejszych plikach, inne w marki/ i wspolna-<id>.json, zly identyfikator odrzucony',
    dzierzawy.plikMarki('/m', 'glowna') === path.join('/m', 'marka.json') && dzierzawy.plikMarki('/m', wlasciciel.organizacja) === path.join('/m', 'marki', 'o-bbbbbbbbbbbb.json')
    && dzierzawy.nazwaPlikuBazyWspolnej('glowna') === 'wspolna.json' && dzierzawy.plikiOrganizacji({ katalogMarki: '/m', katalogBazy: '/b' }, 'glowna').length === 0
    && zlyId !== null);

  console.log('\n  plany - konta na wlasnym kluczu (M-3, ARCH8-11)');
  const magazyn = require('./magazyn.js');
  const kat = tymczasowy('plany-r9');
  try {
    magazyn.otworz({ plik: path.join(kat, 'contentai.sqlite') });
    const zespol = magazyn.utworzKonto({ login: 'zespol-darmowy', hash: 'aa', sol: 'b', plan: 'darmowy' });
    const klient = magazyn.utworzOrganizacjeIKonto({ email: 'k@firma.pl', hash: 'aa', sol: 'b' });
    sprawdz('konto samoobslugowe bez planu dostaje CAI_PLAN_NOWYCH (darmowy), konto zespolu jak dzis',
      plany.nazwaPlanu(klient) === 'darmowy' && plany.nazwaPlanu(zespol) === 'darmowy' && plany.KONF_PLANOW.planNowych === 'darmowy');
    sprawdz('M-3: sufit wywolan darmowego na wlasnym kluczu z limityWlasneKlucze, na kluczach serwera bez zmian (30)',
      plany.sprawdzLimit({ konto: klient, czynnosc: 'wywolanie' }).limit === plany.PLANY.darmowy.limityWlasneKlucze.wywolanie
      && plany.sprawdzLimit({ konto: zespol, czynnosc: 'wywolanie' }).limit === 30
      // Pomiar M-3 (WYKONANIE-A0): najgorszy zmierzony pelny artykul to 12 wywolan modelu.
      && plany.PLANY.darmowy.limityWlasneKlucze.wywolanie >= Math.ceil(3 * 12 * 1.3));
    sprawdz('limity serwera: konto na kluczach serwera zawsze wolno i nic nie liczy',
      plany.sprawdzLimitSerwera(zespol, 'strony').wolno && plany.sprawdzLimitSerwera(zespol, 'strony').limit === null
      && (plany.policzSerwer(zespol, 'strony', 5), Object.keys(magazyn.uzycieKonta(zespol.login)).length === 0));
    for (let i = 0; i < 30; i += 1) plany.policzSerwer(klient, 'strony');
    sprawdz('limity serwera: konto na wlasnym kluczu liczy pule serwer:<zasob> i konczy sie na limicie pakietu',
      !plany.sprawdzLimitSerwera(klient, 'strony').wolno && magazyn.uzycie(klient.login, 'zawsze')['serwer:strony'] === 30
      && plany.sprawdzLimitSerwera(klient, 'serp').limit === 0 && !plany.sprawdzLimitSerwera(klient, 'serp').wolno
      && plany.sprawdzLimit({ konto: klient, czynnosc: 'artykul' }).zuzyte === 0);
    sprawdz('maFunkcje: OpenSEO tylko w organizacji glownej, wlasny klucz zawsze dla kont wlasne',
      !plany.maFunkcje({ ...klient, plan: 'premium' }, 'openseo') && plany.maFunkcje({ login: 'p', rola: 'uzytkownik', plan: 'premium' }, 'openseo')
      && plany.maFunkcje(klient, 'wlasnyKlucz') && !plany.maFunkcje(zespol, 'wlasnyKlucz'));
    const stanKlienta = plany.stanPakietu({ konto: klient });
    const stanZespolu = plany.stanPakietu({ konto: zespol });
    sprawdz('stanPakietu: zrodloKluczy, limitySerwera tylko dla wlasne, wywolanie z sufitem M-3, pole subskrypcja',
      stanKlienta.zrodloKluczy === 'wlasne' && stanKlienta.limitySerwera.strony.zuzyte === 30 && stanKlienta.limitySerwera.wektory.limit === 0
      && stanKlienta.uzycie.wywolanie.limit === plany.PLANY.darmowy.limityWlasneKlucze.wywolanie && stanKlienta.funkcje.wlasnyKlucz === true
      && stanZespolu.zrodloKluczy === 'serwera' && stanZespolu.limitySerwera === null && stanZespolu.uzycie.wywolanie.limit === 30
      && 'subskrypcja' in stanZespolu);
    sprawdz('D-09: wektory niedostepne dla kont na wlasnym kluczu w kazdym pakiecie, konta zespolu bez zmian',
      Object.values(plany.PLANY).every((p) => p.limitySerwera.wektory === 0)
      && !plany.sprawdzLimitSerwera({ ...klient, plan: 'premium' }, 'wektory').wolno && plany.sprawdzLimitSerwera(zespol, 'wektory').wolno);
    sprawdz('plany: pakiety na sprzedaz i kolejnosc w tabeli (limity i bramki bez zmian)',
      plany.PLANY.darmowy.sprzedaz === false && plany.PLANY.standard.sprzedaz && plany.PLANY.premium.kolejnosc === 2
      && plany.PLANY.darmowy.limity.artykul === 3 && plany.PLANY.standard.limity.wywolanie === 750);
  } finally {
    magazyn.zamknij();
    fs.rmSync(kat, { recursive: true, force: true });
  }

  console.log('\n  oznaczenia AI - stala i wybor uzytkownika');
  const domyslne = oznaczenia.dlaKonta({ oznaczenia: null }, { oznaczenia: true });
  sprawdz('oznaczenia: domyslnie tekst i grafika bez etykiety, audio z etykieta (M-5, D-08), metadane zawsze',
    domyslne.uzytkownik.tekst === false && domyslne.uzytkownik.grafika === false && domyslne.uzytkownik.audio === true
    && domyslne.tekst.metadane && domyslne.grafika.metadane && domyslne.audio.metadane && domyslne.wlaczone === true
    && ['pl', 'en', 'de', 'cs'].every((j) => domyslne.tekst.tresc[j] && domyslne.grafika.tresc[j] && domyslne.audio.tresc[j]));
  sprawdz('oznaczenia: wybor uzytkownika z konta, ustawienia tylko znane pola logiczne',
    oznaczenia.dlaKonta({ oznaczenia: { grafika: true } }, {}).uzytkownik.grafika === true
    && oznaczenia.sprawdzUstawienia({ tekst: true }).ok && !oznaczenia.sprawdzUstawienia({ tekst: 'tak' }).ok
    && !oznaczenia.sprawdzUstawienia({ wideo: true }).ok);
}

// ─── CLI na bazie ────────────────────────────────────────────────────────────

function testyCli(sprawdz) {
  const magazyn = require('./magazyn.js');
  console.log('\n  CLI (uzytkownicy.js) na bazie');
  const kat = tymczasowy('cli');
  try {
    const r8 = daneR8(kat);
    const env = Object.assign({}, process.env, {
      CAI_UZYTKOWNICY: r8.plikKont, CAI_UZYCIE: r8.katalogUzycia, CAI_WYLOGOWANE: r8.plikWylogowanych,
      CAI_BAZA: path.join(kat, 'baza'), CAI_MARKA: kat, CAI_SEKRET_PLIK: path.join(kat, 'sekret'),
      CAI_PROSBY: path.join(kat, 'prosby.jsonl'), CAI_KOPIE: path.join(kat, 'kopie'),
    });
    delete env.CAI_SQLITE;
    const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'uzytkownicy.js'), ...a], { env, encoding: 'utf8' });
    const spr = cli('migruj', '--sprawdz');
    const lista = cli('lista');
    sprawdz('CLI: migruj --sprawdz raportuje bez zmian; inne polecenie odmawia, dopoki konta sa w JSON',
      spr.status === 0 && /3 kont/.test(spr.stdout) && fs.existsSync(r8.plikKont) && lista.status === 1 && /jeszcze w/.test(lista.stderr));
    const m = cli('migruj');
    const lista2 = cli('lista');
    sprawdz('CLI: migruj przenosi konta do bazy obok pliku kont (CAI_SQLITE domyslnie), lista je pokazuje',
      m.status === 0 && fs.existsSync(path.join(kat, 'contentai.sqlite')) && /marcin\s+admin\s+premium \(admin: bez limitów\)/.test(lista2.stdout)
      && /ola\s+uzytkownik\s+darmowy/.test(lista2.stdout));
    const kopia = cli('kopia', path.join(kat, 'reczna.sqlite'));
    sprawdz('CLI: kopia bazy w trakcie pracy', kopia.status === 0 && fs.existsSync(path.join(kat, 'reczna.sqlite')));
    const prefiks = cli('dodaj', 'k-abc');
    sprawdz('CLI: dodaj odrzuca loginy z przedrostkiem k- (konta samoobslugowe)', prefiks.status === 1 && /zarezerwowane/.test(prefiks.stderr));
    magazyn.otworz({ plik: path.join(kat, 'contentai.sqlite') });
    const klient = magazyn.utworzOrganizacjeIKonto({ email: 'k@firma.pl', hash: 'aa', sol: 'b' });
    magazyn.zamknij();
    const rola = cli('rola', klient.login, 'admin');
    const ostatni = cli('rola', 'marcin', 'uzytkownik');
    sprawdz('CLI: rola admin tylko w organizacji glownej, ostatniego operatora nie da sie zdegradowac',
      rola.status === 1 && /organizacji głównej/.test(rola.stderr) && ostatni.status === 1 && /jedyne konto admina/.test(ostatni.stderr));
    const usunKlienta = cli('usun', klient.login);
    magazyn.otworz({ plik: path.join(kat, 'contentai.sqlite') });
    const orgZostala = magazyn.organizacja(klient.organizacja);
    magazyn.zamknij();
    sprawdz('CLI: usuniecie ostatniego konta organizacji samoobslugowej usuwa tez organizacje',
      usunKlienta.status === 0 && orgZostala === null && /Usunięto też organizację/.test(usunKlienta.stdout));
    const eksport = cli('eksport-json');
    const eksport2 = cli('eksport-json');
    sprawdz('CLI: eksport-json zapisuje pliki R8, drugi raz odmawia', eksport.status === 0 && fs.existsSync(r8.plikKont) && /Zapisano 3 kont/.test(eksport.stdout)
      && eksport2.status === 1);
    const platnosci = cli('platnosci-sprawdz');
    sprawdz('CLI: polecenia platnosci przekazane do platnosci-cli.js (bez PLATNOSCI: kod 1 z nazwa zmiennej)', platnosci.status === 1 && /brak PLATNOSCI/.test(platnosci.stderr));
    // Kontrola wlasciciela katalogu danych: root -> katalog innego konta; inne konto -> katalog roota.
    let obcy;
    if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
      obcy = path.join(kat, 'obcy');
      fs.mkdirSync(obcy);
      fs.chownSync(obcy, 65534, 65534);
    } else {
      obcy = os.tmpdir();
    }
    const uid = spawnSync(process.execPath, [path.join(__dirname, 'uzytkownicy.js'), 'lista'],
      { env: { ...env, CAI_SQLITE: path.join(obcy, `cai-uid-${process.pid}.sqlite`) }, encoding: 'utf8' });
    sprawdz('CLI: odmowa, gdy katalog danych nalezy do innego konta (pliki -wal/-shm roota zablokowalyby usluge)',
      uid.status === 1 && /cli\.sh/.test(uid.stderr) && !fs.existsSync(path.join(obcy, `cai-uid-${process.pid}.sqlite`)));
  } finally {
    magazyn.zamknij();
    fs.rmSync(kat, { recursive: true, force: true });
  }
}

// ─── Serwer: migracja przy starcie, sesje, kody, zaslepki, konfiguracja ──────

async function testySerwera(sprawdz) {
  const { uruchomSerwer } = require('./testy-wspolne.js');
  console.log('\n  serwer R9 - start z migracja: sesje, wylogowania i liczniki z R8');
  const sekret = crypto.randomBytes(32).toString('hex');
  const teraz = Date.now();
  const opis = (login, rola, id) => ({ login, rola, wygasa: teraz + 3600_000, wydana: teraz - 60_000, id });
  const ciastkoStandard = ciasteczkoR8(sekret, opis('standard', 'uzytkownik', 'sesja-z-r8'));
  const ciastkoWylogowane = ciasteczkoR8(sekret, opis('standard', 'uzytkownik', 'wylogowana-w-r8'));
  const t = await uruchomSerwer({
    przedStartem: ({ env }) => {
      fs.writeFileSync(env.CAI_SEKRET_PLIK, sekret);
      fs.mkdirSync(env.CAI_UZYCIE, { recursive: true });
      fs.writeFileSync(path.join(env.CAI_UZYCIE, 'darmowy.json'), JSON.stringify({ zawsze: { artykul: 3, wywolanie: 12 } }));
      fs.writeFileSync(env.CAI_WYLOGOWANE, JSON.stringify([{ id: 'wylogowana-w-r8', wygasa: teraz + 3600_000 }]));
    },
  });
  try {
    const me = await t.zadanie('/auth/me', { headers: { cookie: ciastkoStandard } });
    const meJson = await me.json();
    sprawdz('ciasteczko wydane przed migracja (R8) wazne po niej - bez ponownego logowania', me.status === 200 && meJson.login === 'standard');
    sprawdz('sesja wylogowana w R8 nadal niewazna po migracji', (await t.zadanie('/auth/me', { headers: { cookie: ciastkoWylogowane } })).status === 401);
    const cDarm = await t.zaloguj('darmowy');
    const pakiet = await (await t.zadanie('/api/pakiet', { headers: { cookie: cDarm } })).json();
    sprawdz('liczniki z R8 po migracji: darmowy 3 z 3 artykulow, jak przed wdrozeniem',
      pakiet.uzycie.artykul.zuzyte === 3 && pakiet.uzycie.artykul.zostalo === 0 && pakiet.uzycie.wywolanie.zuzyte === 12 && pakiet.zrodloKluczy === 'serwera');
    const odmowa = await t.zadanie('/api', t.json(cDarm, { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, { 'x-cai-czynnosc': 'artykul' }));
    const odmowaJson = await odmowa.json();
    sprawdz('402 limitu: X-CAI-Kod limit-pakietu, dzisiejsze pola bez zmian (error jako napis, czynnosc, odnawialny)',
      odmowa.status === 402 && odmowa.headers.get('x-cai-kod') === 'limit-pakietu' && odmowaJson.error === 'Limit pakietu wyczerpany'
      && odmowaJson.czynnosc === 'artykul' && odmowaJson.odnawialny === false && odmowaJson.kod === 'limit-pakietu');
    const bezSesji = await t.zadanie('/api/pakiet');
    const bezSesjiJson = await bezSesji.json();
    sprawdz('401 bez sesji: X-CAI-Kod sesja, error "Niezalogowany" jako napis (aplikacja rozpoznaje blad serwera)',
      bezSesji.status === 401 && bezSesji.headers.get('x-cai-kod') === 'sesja' && bezSesjiJson.error === 'Niezalogowany' && bezSesjiJson.kod === 'sesja');

    console.log('\n  serwer R9 - /auth/me, operator, konto samoobslugowe');
    const cAdmin = await t.zaloguj('admin');
    const meAdmin = await (await t.zadanie('/auth/me', { headers: { cookie: cAdmin } })).json();
    sprawdz('/auth/me: login, rola, email i organizacja z prawem zarzadzania (admin glownej)',
      meAdmin.login === 'admin' && meAdmin.rola === 'admin' && meAdmin.email === null
      && meAdmin.organizacja.id === 'glowna' && meAdmin.organizacja.rodzaj === 'glowna' && meAdmin.organizacja.mozeZarzadzac === true
      && meJson.organizacja.mozeZarzadzac === false);
    const { zahaszuj } = t.srv;
    const klient = t.magazyn.utworzOrganizacjeIKonto({ email: 'klient@firma.pl', ...zahaszuj(HASLO) });
    const cKlient = await t.zaloguj(klient.login);
    const meKlient = await (await t.zadanie('/auth/me', { headers: { cookie: cKlient } })).json();
    const statusAdmin = await t.zadanie('/api/status', { headers: { cookie: cAdmin } });
    const statusJson = await statusAdmin.json();
    sprawdz('konto samoobslugowe: wlasciciel swojej organizacji, bez /api/status i prosb (operator tylko w glownej)',
      meKlient.organizacja.rodzaj === 'samoobsluga' && meKlient.organizacja.mozeZarzadzac === true && meKlient.email === 'klient@firma.pl'
      && (await t.zadanie('/api/status', { headers: { cookie: cKlient } })).status === 403
      && (await t.zadanie('/api/admin/prosby', { headers: { cookie: cKlient } })).status === 403);
    sprawdz('/api/status operatora: magazyn, stan konfiguracji, platnosci i poczta (bez sekretow)',
      statusAdmin.status === 200 && statusJson.magazyn.otwarty && statusJson.magazyn.kont === 5 && statusJson.uzytkownikow === 5
      && statusJson.konfiguracja.rejestracja.wlaczona === false && statusJson.platnosci.wlaczone === false && statusJson.poczta.tryb === 'log');
    const pakietKlienta = await (await t.zadanie('/api/pakiet', { headers: { cookie: cKlient } })).json();
    sprawdz('/api/pakiet konta samoobslugowego: klucze wlasne, limity serwera, sufit wywolan M-3, bez OpenSEO',
      pakietKlienta.zrodloKluczy === 'wlasne' && pakietKlienta.limitySerwera.strony.limit === 30 && pakietKlienta.uzycie.wywolanie.limit === 47
      && pakietKlienta.funkcje.openseo === false && pakietKlienta.funkcje.wlasnyKlucz === true);

    console.log('\n  serwer R9 - kolejnosc tras i zaslepki modulow');
    const konto = await t.zadanie('/api/konto', { headers: { cookie: cKlient } });
    const kontoJson = await konto.json();
    const ekranKonta = await t.zadanie('/konto', { headers: { cookie: cKlient } });
    // R9-A1: trasy kont wdrozone (szczegoly w testy-konta.js); tu tylko, ze trafiaja do modulu kont.
    sprawdz('trasy kont (A1) trafiaja do modulu kont: /api/konto ze stanem konta; /konto bez pamieci podrecznej',
      konto.status === 200 && kontoJson.login === klient.login && kontoJson.organizacja.rodzaj === 'samoobsluga'
      && ekranKonta.status === 200 && ekranKonta.headers.get('cache-control') === 'no-store');
    const zakup = await t.zadanie('/api/platnosci/zakup', t.json(cKlient, { plan: 'standard', waluta: 'pln', zgodaNaWykonanie: true }));
    const panel = await t.zadanie('/konto/panel', t.formularz(cKlient, { z: 'konto' }));
    sprawdz('platnosci wylaczone: trasy zakupu i panelu -> 404 platnosci-wylaczone (aplikacja chowa przyciski)',
      zakup.status === 404 && zakup.headers.get('x-cai-kod') === 'platnosci-wylaczone' && panel.status === 404);
    const kluczSprawdz = await t.zadanie('/api/klucze/sprawdz', t.json(cKlient, { dostawca: 'anthropic' }));
    sprawdz('trasy kluczy (C) maja kontrakt: 501 niezaimplementowane', kluczSprawdz.status === 501 && kluczSprawdz.headers.get('x-cai-kod') === 'niezaimplementowane');
    const rejestracja = await t.zadanie('/rejestracja');
    const webhook = await t.zadanie('/platnosci/webhook/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=x' }, body: '{}' });
    sprawdz('bez CAI_REJESTRACJA i PLATNOSCI publiczne trasy dzialaja jak dzis (ekran logowania)',
      rejestracja.status === 200 && /name="login"/.test(await rejestracja.text()) && webhook.status === 200 && /name="login"/.test(await webhook.text()));
    const dok = await t.zadanie('/dokumenty/regulamin');
    const dokEn = await t.zadanie('/en/dokumenty/regulamin');
    const dokNieznany = await t.zadanie('/dokumenty/nieznany');
    const dokPost = await t.zadanie('/dokumenty/regulamin', t.formularz(null, {}));
    sprawdz('dokumenty prawne (E): publiczne bez logowania, naglowki bezpieczenstwa, krotka pamiec podreczna, PL/EN, 404 i 405',
      dok.status === 200 && /<html lang="pl"/.test(await dok.text()) && /frame-ancestors 'none'/.test(dok.headers.get('content-security-policy') || '')
      && dok.headers.get('cache-control') === 'public, max-age=300' && /<html lang="en"/.test(await dokEn.text())
      && dokNieznany.status === 404 && dokPost.status === 405);

    console.log('\n  serwer R9 - scrypt asynchroniczny');
    const sol = crypto.randomBytes(16).toString('hex');
    let tykniec = 0;
    const zegar = setInterval(() => { tykniec += 1; }, 1);
    const [async1] = await Promise.all([t.srv.zahaszujAsync(HASLO, sol), t.srv.zahaszujAsync('inne', sol), t.srv.zahaszujAsync('trzecie', sol)]);
    clearInterval(zegar);
    sprawdz('zahaszujAsync: ten sam format i wynik co dzisiejszy zahaszuj (zgodnosc kont), petla nie stoi',
      async1.hash === t.srv.zahaszuj(HASLO, sol).hash && async1.sol === sol && tykniec > 0
      && await t.srv.hasloPasujeAsync(HASLO, async1) && !(await t.srv.hasloPasujeAsync('zle', async1)));
  } finally {
    await t.zamknij();
  }

  console.log('\n  serwer R9 - kontrola konfiguracji (funkcje wylaczane, nie serwer)');
  const zla = await uruchomSerwer({
    srodowisko: {
      CAI_REJESTRACJA: '1', PLATNOSCI: 'stripe', PLATNOSCI_TRYB: 'live', STRIPE_KLUCZ: 'rk_test_TAJNE_123',
      CAI_POCZTA: 'resend', CAI_POCZTA_KLUCZ: 're_TAJNE_456', CAI_SERP_SAMOOBSLUGA: 'openseo',
      CAI_KLUCZ_CIASTEK: 'krotki-TAJNE', CAI_PLAN_NOWYCH: 'zloty',
    },
  });
  try {
    const f = zla.KONF.funkcje;
    const tekst = JSON.stringify(f);
    sprawdz('zla konfiguracja: rejestracja wylaczona z nazwami brakujacych zmiennych',
      f.rejestracja.zadana && !f.rejestracja.wlaczona && ['CAI_ADRES_PUBLICZNY', 'CAI_USLUGODAWCA_IMIE_NAZWISKO', 'CAI_USLUGODAWCA_ADRES',
        'CAI_USLUGODAWCA_EMAIL', 'CAI_REGULAMIN_WERSJA', 'CAI_POLITYKA_WERSJA', 'CAI_KLUCZ_CIASTEK'].every((z) => tekst.includes(z)));
    sprawdz('zla konfiguracja: platnosci i poczta resend wylaczone (poczta schodzi na log), SERP samoobslugi bez OpenSEO, plan nowych darmowy',
      !f.platnosci.wlaczona && f.platnosci.bledy.length > 0 && !f.poczta.wlaczona && zla.KONF.poczta.tryb === 'log'
      && f.serpSamoobsluga.bledy.length === 1 && zla.KONF.serpSamoobsluga === 'model' && f.planNowych.bledy.length === 1
      && zla.KONF.planNowych === 'darmowy' && f.kluczeCiastek.bledy.length === 1);
    sprawdz('zla konfiguracja: w komunikatach nazwy zmiennych, nigdy wartosci sekretow', !/TAJNE/.test(tekst));
    sprawdz('zla konfiguracja: serwer dziala dla istniejacych kont', /^cai_auth=/.test(await zla.zaloguj('standard')));
  } finally {
    await zla.zamknij();
  }
  const dobra = await uruchomSerwer({
    srodowisko: {
      CAI_REJESTRACJA: '1', CAI_ADRES_PUBLICZNY: 'https://app.example.com', CAI_USLUGODAWCA_IMIE_NAZWISKO: 'Jan Testowy',
      CAI_USLUGODAWCA_ADRES: 'ul. Testowa 1, 00-001 Warszawa', CAI_USLUGODAWCA_EMAIL: 'kontakt@example.com',
      CAI_REGULAMIN_WERSJA: '2026-10-v1', CAI_POLITYKA_WERSJA: '2026-10-v1', CAI_KLUCZ_CIASTEK: crypto.randomBytes(32).toString('base64'),
    },
  });
  try {
    const rej = await dobra.zadanie('/rejestracja');
    sprawdz('pelna konfiguracja rejestracji: funkcja wlaczona, trasa trafia do modulu kont (formularz A1), ostrzezenie o poczcie log',
      dobra.KONF.funkcje.rejestracja.wlaczona && rej.status === 200 && /action="\/rejestracja"/.test(await rej.text())
      && dobra.KONF.funkcje.rejestracja.ostrzezenia.length === 1 && dobra.KONF.uslugodawca.imieNazwisko === 'Jan Testowy');
  } finally {
    await dobra.zamknij();
  }
}

// ─── Pliki wdrozenia: uslugi, cli.sh, tabela zmiennych ──────────────────────

function testyPlikowWdrozenia(sprawdz) {
  console.log('\n  pliki wdrozenia: uslugi systemd, cli.sh, README');
  const korzen = path.join(__dirname, '..');
  const usluga = fs.readFileSync(path.join(__dirname, 'contentai.service'), 'utf8');
  const exec = (/^ExecStart=(.*)$/m.exec(usluga) || [])[1] || '';
  sprawdz('usluga: Node z --disable-warning=ExperimentalWarning i --max-old-space-size=900, MemoryMax, UMask=0077, bez zrzutow pamieci',
    /--disable-warning=ExperimentalWarning/.test(exec) && /--max-old-space-size=900/.test(exec) && /serwer\/server\.js$/.test(exec)
    && /^MemoryMax=\d+M$/m.test(usluga) && /^UMask=0077$/m.test(usluga) && /^LimitCORE=0$/m.test(usluga)
    && !/^MemoryDenyWriteExecute=yes/m.test(usluga));
  const zapisywalne = usluga.match(/^ReadWritePaths=.*$/gm) || [];
  sprawdz('usluga: utwardzona, zapis tylko do serwer/dane (baza, -wal, -shm, kopie, migracja)',
    zapisywalne.length === 1 && zapisywalne[0] === 'ReadWritePaths=/srv/contentai/serwer/dane' && /^ProtectSystem=strict$/m.test(usluga)
    && /^CapabilityBoundingSet=$/m.test(usluga) && /^SystemCallFilter=@system-service$/m.test(usluga) && /^User=contentai$/m.test(usluga));
  const testowa = fs.readFileSync(path.join(__dirname, 'contentai-test.service'), 'utf8');
  sprawdz('usluga testowa: osobny katalog, plik srodowiska i port 3101, bez dostepu do danych produkcji',
    /^WorkingDirectory=\/srv\/contentai-test$/m.test(testowa) && /^EnvironmentFile=\/etc\/contentai\/srodowisko-test$/m.test(testowa)
    && /^ReadWritePaths=\/srv\/contentai-test\/serwer\/dane$/m.test(testowa) && /PORT=3101/.test(testowa)
    && /^InaccessiblePaths=-\/srv\/contentai\/serwer\/dane$/m.test(testowa) && /\/srv\/contentai-test\/serwer\/server\.js/.test(testowa));
  const cliSh = path.join(__dirname, 'cli.sh');
  const tresc = fs.readFileSync(cliSh, 'utf8');
  sprawdz('cli.sh: wykonywalny, laduje srodowisko uslugi i uruchamia uzytkownicy.js jako konto uslugi',
    (fs.statSync(cliSh).mode & 0o111) !== 0 && /\/etc\/contentai\/srodowisko/.test(tresc) && /sudo -E -u/.test(tresc)
    && /--disable-warning=ExperimentalWarning/.test(tresc) && /uzytkownicy\.js/.test(tresc));
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  const zmienne = new Set();
  for (const plik of fs.readdirSync(__dirname).filter((n) => n.endsWith('.js') && !n.startsWith('testy'))) {
    for (const m of fs.readFileSync(path.join(__dirname, plik), 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) zmienne.add(m[1]);
  }
  const brak = [...zmienne].filter((z) => !readme.includes(`\`${z}\``)).sort();
  sprawdz(`README: kazda zmienna srodowiskowa serwera w tabeli (brak: ${brak.join(', ') || 'brak'})`,
    brak.length === 0 && zmienne.size > 90 && readme.includes('`STRIPE_CENA_<PLAN>`'));
  const sekcje = ['Konta samoobsługowe', 'Płatności', 'Własne klucze', 'Dzierżawy', 'Poczta', 'Oznaczanie treści AI', 'Strona i dokumenty', 'Magazyn danych'];
  sprawdz('README: sekcje wykonawcow rundy 9 (A1, B, C, D, E) i magazynu', sekcje.every((s) => readme.includes(`## ${s}`)));
  sprawdz('repozytorium: tylko placeholdery WSTAW_TUTAJ_ w przykladach srodowiska, bez danych uslugodawcy',
    !/CAI_USLUGODAWCA_(IMIE_NAZWISKO|ADRES)=(?!"?WSTAW_TUTAJ)/.test(readme)
    && !fs.readFileSync(path.join(korzen, 'serwer', 'contentai.service'), 'utf8').includes('USLUGODAWCA'));
}

// ─── Atrapy Stripe (B) i poczty (C): ksztalt modulu ─────────────────────────

async function testyAtrap(sprawdz) {
  console.log('\n  atrapy stripe.js i poczta.js (ksztalt modulu, zaslepki)');
  const nasluch = (s) => new Promise((ok) => { if (s.listening) ok(); else s.once('listening', ok); });
  // stripe.js: pelna atrapa wykonawcy B, testy ksztaltu i API w testy-platnosci.js
  for (const [nazwa, plik, sciezka] of [['poczta', 'poczta.js', '/emails']]) {
    const atrapa = require(path.join(__dirname, '..', 'narzedzia', 'atrapa', plik));
    const serwer = atrapa.uruchom(0, { sekret: 'whsec_test', webhook: 'http://127.0.0.1:9/platnosci/webhook/stripe' });
    try {
      await nasluch(serwer);
      const adres = `http://127.0.0.1:${serwer.address().port}`;
      const zdrowie = await fetch(adres + '/zdrowie');
      const api = await fetch(adres + sciezka, { method: 'POST', body: 'a=1' });
      const wywolania = await (await fetch(adres + '/_atrapa/wywolania')).json();
      const czysta = atrapa.obsluz('GET', '/zdrowie', {}, Buffer.alloc(0));
      sprawdz(`atrapa ${nazwa}: obsluz i uruchom, /zdrowie 200, API 501 do czasu wykonawcy, dziennik wywolan`,
        zdrowie.status === 200 && (await zdrowie.json()).atrapa === nazwa && api.status === 501
        && wywolania.length === 1 && wywolania[0].sciezka === sciezka && czysta.status === 200 && typeof czysta.cialo === 'string');
    } finally {
      await new Promise((r) => serwer.close(r));
    }
  }
}

async function uruchom({ sprawdz }) {
  await testyMagazynu(sprawdz);
  await testyMigracji(sprawdz);
  testyModulow(sprawdz);
  testyCli(sprawdz);
  await testySerwera(sprawdz);
  testyPlikowWdrozenia(sprawdz);
  await testyAtrap(sprawdz);
}

module.exports = { uruchom, daneR8, ciasteczkoR8 };
