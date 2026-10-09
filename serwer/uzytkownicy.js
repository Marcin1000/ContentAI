#!/usr/bin/env node
/**
 * Content AI - zarzadzanie kontami
 *
 * Na serwerze zawsze przez opakowanie z konfiguracja uslugi (laduje
 * /etc/contentai/srodowisko i uruchamia polecenie jako konto uslugi):
 *   sudo serwer/cli.sh <polecenie> [argumenty]
 * Lokalnie i w testach wprost:
 *   node serwer/uzytkownicy.js lista
 *   node serwer/uzytkownicy.js dodaj <login> [admin|uzytkownik]
 *   node serwer/uzytkownicy.js haslo <login>
 *   node serwer/uzytkownicy.js plan  <login> <darmowy|standard|premium>
 *   node serwer/uzytkownicy.js rola  <login> <admin|uzytkownik>
 *   node serwer/uzytkownicy.js usun  <login>
 *   node serwer/uzytkownicy.js prosby [ile]   - ostatnie prosby o dostep ze strony
 *   node serwer/uzytkownicy.js migruj [--sprawdz]  - konta z plikow JSON (R8) do bazy
 *   node serwer/uzytkownicy.js eksport-json   - wycofanie do R8: pliki JSON z bazy
 *   node serwer/uzytkownicy.js kopia [plik]   - kopia bazy w trakcie pracy uslugi
 * oraz polecenia platnosci (platnosci-cli.js) i poczty (poczta.js) - lista w pomocy.
 *
 * Konta leza w bazie SQLite (serwer/magazyn.js). Polecenie zmienia jeden wiersz
 * w transakcji, wiec nie gubi zmian zrobionych w tym czasie przez serwer (webhooki,
 * rejestracja). Hasla nie sa nigdzie zapisywane jawnie - w bazie laduja sie wylacznie
 * hash i sol. Haslo wpisuje sie interaktywnie, bez echa, zeby nie zostalo w historii powloki.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const plany = require('./plany.js');
const prosby = require('./prosby.js');
const baza = require('./baza.js');
const magazyn = require('./magazyn.js');
const migracja = require('./migracja.js');
const dzierzawy = require('./dzierzawy.js');
const platnosciCli = require('./platnosci-cli.js');
const poczta = require('./poczta.js');
const {
  zahaszuj, ROLE, PLIK_UZYTKOWNIKOW, PLIK_WYLOGOWANYCH, poprawnyLogin, skrotEmaila, KONF,
} = require('./server.js');

// Dane konta na dysku: prywatna baza wiedzy (u-<login>.json) razem z kopiami
// uszkodzonych wersji i plikami tymczasowymi zapisu (oraz plik licznikow z R8,
// jesli jeszcze lezy). Bez tego plik zostawal po usunieciu konta, a nowe konto
// o tym samym loginie przejmowalo cudza baze wiedzy (R3-38). Dane marki organizacji
// glownej sa wspolne dla zespolu, wiec zostaja. Zwraca liste usunietych plikow.
function usunPlikiZRodzina(plikiGlowne) {
  const usuniete = [];
  for (const plik of plikiGlowne) {
    const katalog = path.dirname(plik);
    const nazwa = path.basename(plik);
    let wpisy = [];
    try { wpisy = fs.readdirSync(katalog); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const w of wpisy) {
      if (w !== nazwa && !w.startsWith(nazwa + '.uszkodzony-') && !w.startsWith('.' + nazwa + '.tmp-')) continue;
      fs.unlinkSync(path.join(katalog, w));
      usuniete.push(path.join(katalog, w));
    }
  }
  return usuniete;
}

function usunDaneKonta(login) {
  return usunPlikiZRodzina([
    path.join(KONF.katalogBazy, baza.nazwaPliku('prywatna', login)),
    plany.plikUzycia(KONF.katalogUzycia, login),
  ]);
}

function pytaj(pytanie, ukryte = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (ukryte) {
      // Wylaczamy echo: nadpisujemy wypisywanie znakow w trakcie wpisywania
      const wypisz = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = function (s) {
        if (s.includes(pytanie)) return wypisz ? wypisz(s) : process.stdout.write(s);
        // nic nie pokazujemy dla samych znakow hasla
      };
    }
    rl.question(pytanie, (odp) => {
      rl.close();
      if (ukryte) process.stdout.write('\n');
      resolve(odp);
    });
  });
}

async function noweHaslo() {
  const a = await pytaj('Hasło: ', true);
  if (a.length < 10) {
    console.error('BŁĄD: hasło musi mieć co najmniej 10 znaków.');
    process.exit(1);
  }
  const b = await pytaj('Powtórz hasło: ', true);
  if (a !== b) {
    console.error('BŁĄD: hasła się różnią.');
    process.exit(1);
  }
  return a;
}

function sprawdzRole(rola) {
  if (!ROLE.includes(rola)) {
    console.error(`BŁĄD: nieznana rola "${rola}". Dostępne: ${ROLE.join(', ')}`);
    process.exit(1);
  }
}

function wypiszProsby(ile) {
  const { wpisy, pominiete } = prosby.lista(ile);
  if (!wpisy.length) {
    console.log(`Brak próśb o dostęp (${prosby.PLIK}).`);
    return;
  }
  console.log(`Prośby o dostęp, najnowsze pierwsze (${prosby.PLIK}):\n`);
  for (const p of wpisy) {
    const kiedy = String(p.czas || '').replace('T', ' ').slice(0, 16);
    console.log(`  ${kiedy}  ${String(p.imie || '').padEnd(20)} ${String(p.email || '').padEnd(32)} ${String(p.pakiet || '-').padEnd(9)} ${p.jezyk || '-'}`);
    if (p.firma) console.log(`  ${' '.repeat(16)}  firma: ${p.firma}`);
    if (p.wiadomosc) console.log(`  ${' '.repeat(16)}  ${String(p.wiadomosc).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  if (pominiete) console.log(`\n  (pominięto nieczytelnych linii: ${pominiete})`);
}

/**
 * Kontrola wlasciciela katalogu danych (ARCH8-02). Pliki bazy -wal i -shm
 * zalozone przez root (sudo bez zmiany konta) mialyby wlasciciela root i tryb 0600,
 * wiec usluga przestalaby zapisywac. Polecenie musi dzialac jako wlasciciel katalogu.
 */
function sprawdzWlasciciela(polecenie) {
  if (typeof process.geteuid !== 'function') return;
  const euid = process.geteuid();
  const katalog = path.dirname(path.resolve(KONF.sqlite));
  let st;
  try {
    st = fs.statSync(katalog);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (euid === 0) {
      console.error(`BŁĄD: katalog danych ${katalog} nie istnieje, a polecenie działa jako root - `
        + 'założony teraz należałby do roota i usługa nie mogłaby w nim zapisywać.\n'
        + `Załóż go jako konto usługi: sudo -u contentai mkdir -p ${katalog}\n`
        + `albo uruchom polecenie przez: sudo serwer/cli.sh ${polecenie}`);
      process.exit(1);
    }
    return;
  }
  if (st.uid !== euid) {
    console.error(`BŁĄD: katalog danych ${katalog} należy do innego konta (uid ${st.uid}) niż to polecenie (uid ${euid}).\n`
      + 'Pliki bazy założone z tego konta zablokowałyby usłudze zapis.\n'
      + `Uruchom: sudo serwer/cli.sh ${polecenie}`);
    process.exit(1);
  }
}

function pomoc() {
  const dodatkowe = [...platnosciCli.POLECENIA, ...poczta.POLECENIA]
    .map((p) => `  node serwer/uzytkownicy.js ${p.uzycie.padEnd(34)} ${p.opis}`).join('\n');
  console.log(`Content AI - zarządzanie kontami

Na serwerze: sudo serwer/cli.sh <polecenie> (środowisko i konto usługi).

  node serwer/uzytkownicy.js lista
  node serwer/uzytkownicy.js dodaj <login> [admin|uzytkownik]
  node serwer/uzytkownicy.js haslo <login>
  node serwer/uzytkownicy.js plan <login> <${Object.keys(plany.PLANY).join('|')}>
  node serwer/uzytkownicy.js rola  <login> <admin|uzytkownik>
  node serwer/uzytkownicy.js usun  <login>
  node serwer/uzytkownicy.js prosby [ile]
  node serwer/uzytkownicy.js migruj [--sprawdz]     konta z plików JSON (R8) do bazy
  node serwer/uzytkownicy.js eksport-json           wycofanie do R8: pliki JSON z bazy
  node serwer/uzytkownicy.js kopia [plik]           kopia bazy w trakcie pracy usługi
${dodatkowe}

Baza kont: ${KONF.sqlite}
Prośby o dostęp: ${prosby.PLIK}`);
}

function uzycie(s) {
  console.error(`Użycie: node serwer/uzytkownicy.js ${s}`);
  process.exit(1);
}

function brakKonta(login) {
  console.error(`BŁĄD: nie ma konta "${login}".`);
  process.exit(1);
}

function znacznikPliku() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

async function main() {
  const argumenty = process.argv.slice(2);
  const [polecenie, login, arg] = argumenty;
  // Prośby nie potrzebują bazy kont - działają nawet przy jej awarii.
  if (polecenie === 'prosby') return wypiszProsby(Math.min(Math.max(Number(login) || 20, 1), 500));
  if (!polecenie || ['pomoc', 'help', '-h', '--help'].includes(polecenie)) return pomoc();

  sprawdzWlasciciela(argumenty.join(' '));
  // Uszkodzona albo zablokowana baza kończy się błędem tutaj, zanim cokolwiek zapiszemy.
  magazyn.otworz({ plik: KONF.sqlite, timeoutMs: 5000 });

  if (polecenie === 'migruj') {
    const tylkoSprawdz = argumenty.includes('--sprawdz');
    const raport = migracja.migrujZJson({
      plikKont: PLIK_UZYTKOWNIKOW, katalogUzycia: KONF.katalogUzycia, plikWylogowanych: PLIK_WYLOGOWANYCH,
      katalogDanych: path.dirname(PLIK_UZYTKOWNIKOW), tylkoSprawdz, loguj: (t) => console.log(t),
    });
    if (raport.powod === 'brak-pliku') {
      console.log(`Nie ma pliku kont R8 (${PLIK_UZYTKOWNIKOW}) - nie ma czego migrować.`);
      return;
    }
    if (tylkoSprawdz) {
      console.log(`Sprawdzenie bez zmian: ${raport.kont} kont (nowych ${raport.nowych}, zmienionych ${raport.zmienionych}), `
        + `${raport.licznikow} liczników, ${raport.sesji} wylogowanych sesji.`);
      if (raport.usuniete.length) console.log(`Do usunięcia (skasowane w R8 po eksporcie): ${raport.usuniete.join(', ')}`);
      for (const p of raport.pominiete) console.log(`  pominięte ${p.login || `#${p.pozycja}`}: ${p.powod}`);
      if (raport.nieznanePola.length) console.log(`  nieznane pola (pominięte): ${raport.nieznanePola.join(', ')}`);
      console.log('Migrację zrobi usługa przy starcie albo: uzytkownicy.js migruj (przy zatrzymanej usłudze R8).');
    }
    return;
  }

  if (polecenie === 'eksport-json') {
    const w = migracja.eksportujDoJson({ plikKont: PLIK_UZYTKOWNIKOW, katalogUzycia: KONF.katalogUzycia, plikWylogowanych: PLIK_WYLOGOWANYCH });
    console.log(`Zapisano ${w.kont} kont zespołu w formacie R8: ${w.plikKont} (pliki liczników: ${w.plikowLicznikow}, wylogowane sesje: ${w.sesji}).`);
    if (w.pominieteSamoobslugowe) {
      console.log(`Pominięto ${w.pominieteSamoobslugowe} kont samoobsługowych: w R8 działałyby na kluczach serwera; czekają w bazie na powrót R9.`);
    }
    console.log('Dalej (PROJEKT-TECHNICZNY 12.6): git checkout <commit R8>, poprzedni contentai.service, daemon-reload, restart.\n'
      + 'Powrót do R9: git checkout wydania R9 i restart - migracja przy starcie przeniesie zmiany z czasu wycofania.');
    return;
  }

  if (polecenie === 'kopia') {
    const cel = login ? path.resolve(login) : path.join(KONF.kopie, `contentai-reczna-${znacznikPliku()}.sqlite`);
    await magazyn.kopia(cel);
    console.log(`Kopia bazy: ${cel}`);
    return;
  }

  const kontekstCli = {
    KONF, magazyn, plany, dzierzawy, wypisz: (t) => console.log(t), blad: (t) => console.error(t),
  };
  if (platnosciCli.obsluguje(polecenie)) {
    process.exitCode = await platnosciCli.uruchom(polecenie, argumenty.slice(1), kontekstCli);
    return;
  }
  if (poczta.POLECENIA.some((p) => p.nazwa === polecenie)) {
    process.exitCode = await poczta.cli(polecenie, argumenty.slice(1), kontekstCli);
    return;
  }

  // Konta R8 jeszcze w plikach: praca na bazie przed migracją pokazałaby pustą listę,
  // a zmiany zostałyby nadpisane przy migracji. Migrację robi usługa przy starcie.
  if (migracja.czekaNaMigracje(PLIK_UZYTKOWNIKOW)) {
    console.error(`BŁĄD: konta są jeszcze w ${PLIK_UZYTKOWNIKOW} (format R8).\n`
      + 'Uruchom ponownie usługę (migracja przy starcie) albo, przy zatrzymanej usłudze: uzytkownicy.js migruj');
    process.exit(1);
  }

  switch (polecenie) {
    case 'lista': {
      const konta = magazyn.listaKont({ limit: 100000 });
      if (konta.length === 0) {
        console.log('Brak kont. Załóż pierwsze: node serwer/uzytkownicy.js dodaj <login> admin');
        return;
      }
      console.log(`Konta (${KONF.sqlite}):\n`);
      for (const u of konta) {
        const pakiet = plany.nazwaPlanu(u) + (dzierzawy.operator(u) ? ' (admin: bez limitów)' : '');
        const samoobsluga = u.pochodzenie === 'samoobsluga' ? `  samoobsługa ${u.email || ''}`.trimEnd() : '';
        console.log(`  ${u.login.padEnd(20)} ${u.rola.padEnd(12)} ${pakiet.padEnd(26)} utworzony: ${u.utworzony || '-'}${samoobsluga}`);
      }
      return;
    }

    case 'dodaj': {
      if (!login) return uzycie('dodaj <login> [rola]');
      if (!poprawnyLogin(login)) {
        console.error('BŁĄD: login może mieć 2-40 znaków: małe litery a-z, cyfry, kropkę, podkreślnik i myślnik.');
        process.exit(1);
      }
      if (login.startsWith('k-')) {
        console.error('BŁĄD: loginy z przedrostkiem "k-" są zarezerwowane dla kont samoobsługowych.');
        process.exit(1);
      }
      const rola = arg || 'uzytkownik';
      sprawdzRole(rola);
      if (magazyn.konto(login)) {
        console.error(`BŁĄD: konto "${login}" już istnieje.`);
        process.exit(1);
      }
      const haslo = await noweHaslo();
      const { hash, sol } = zahaszuj(haslo);
      try {
        magazyn.utworzKonto({
          login, hash, sol, rola,
          organizacja: dzierzawy.GLOWNA, pochodzenie: 'admin', zrodloKluczy: 'serwera', plan: plany.DOMYSLNY,
        });
      } catch (e) {
        if (e instanceof magazyn.BladKonfliktu) {
          console.error(`BŁĄD: konto "${login}" już istnieje.`);
          process.exit(1);
        }
        throw e;
      }
      console.log(`Dodano konto "${login}" z rolą ${rola}.`);
      return;
    }

    case 'haslo': {
      if (!login) return uzycie('haslo <login>');
      if (!magazyn.konto(login)) return brakKonta(login);
      const haslo = await noweHaslo();
      const { hash, sol } = zahaszuj(haslo);
      // Sesje sa bezstanowe (podpisane ciasteczko), wiec sam zapis nowego hasla
      // ich nie uniewaznia. Znacznik sesjeOd odcina wszystkie wydane wczesniej.
      if (!magazyn.zmienKonto(login, { hash, sol, sesjeOd: Date.now() })) return brakKonta(login);
      console.log(`Zmieniono hasło konta "${login}". Wszystkie jego sesje zostały unieważnione.`);
      return;
    }

    case 'rola': {
      if (!login || !arg) return uzycie('rola <login> <admin|uzytkownik>');
      sprawdzRole(arg);
      const blad = magazyn.transakcja(() => {
        const u = magazyn.konto(login);
        if (!u) return 'brak';
        if (arg === 'admin' && u.organizacja !== dzierzawy.GLOWNA) return 'poza-glowna';
        if (dzierzawy.operator(u) && arg !== 'admin' && magazyn.liczbaOperatorow() === 1) return 'jedyny';
        // Rola i tak jest czytana z bazy przy kazdym zadaniu, wiec zmiana dziala
        // natychmiast. Znacznik ustawiamy dla porzadku - degradacja admina ma odciac
        // takze wszystko, co mogl sobie w miedzyczasie otworzyc.
        magazyn.zmienKonto(login, { rola: arg, sesjeOd: Date.now() });
        return null;
      });
      if (blad === 'brak') return brakKonta(login);
      if (blad === 'poza-glowna') {
        console.error('BŁĄD: rola admin (operator serwera) istnieje tylko w organizacji głównej zespołu.');
        process.exit(1);
      }
      if (blad === 'jedyny') {
        console.error('BŁĄD: to jedyne konto admina - najpierw nadaj rolę admin komuś innemu.');
        process.exit(1);
      }
      console.log(`Konto "${login}" ma teraz rolę ${arg}. Jego sesje zostały unieważnione.`);
      return;
    }

    case 'plan': {
      if (!login || !arg) return uzycie(`plan <login> <${Object.keys(plany.PLANY).join('|')}>`);
      if (!plany.PLANY[arg]) {
        console.error(`BŁĄD: nieznany plan "${arg}". Dostępne: ${Object.keys(plany.PLANY).join(', ')}`);
        process.exit(1);
      }
      const u = magazyn.konto(login);
      if (!u) return brakKonta(login);
      magazyn.zmienKonto(login, { plan: arg });
      const p = plany.PLANY[arg];
      console.log(`Konto "${login}" ma teraz pakiet ${p.nazwa}.`);
      if (dzierzawy.operator(u)) {
        console.log('Uwaga: to konto ma rolę admin, więc i tak działa bez limitów.');
      }
      return;
    }

    case 'usun': {
      if (!login) return uzycie('usun <login>');
      const u = magazyn.konto(login);
      if (!u) return brakKonta(login);
      if (dzierzawy.operator(u) && magazyn.liczbaOperatorow() === 1) {
        console.error('BŁĄD: to jedyne konto admina - nie można go usunąć.');
        process.exit(1);
      }
      if (u.platnikKlient && ['probna', 'aktywna', 'zalegla', 'anulowana'].includes(u.subskrypcjaStan) && !argumenty.includes('--wymus')) {
        console.error(`BŁĄD: konto ma subskrypcję w stanie "${u.subskrypcjaStan}" u dostawcy płatności - po usunięciu konta `
          + 'klient płaciłby dalej. Najpierw anuluj subskrypcję (panel dostawcy) albo dodaj --wymus.');
        process.exit(1);
      }
      const licznikow = Object.values(magazyn.uzycieKonta(login)).reduce((s, o) => s + Object.keys(o).length, 0);
      // Konto (z licznikami i tokenami, kaskadowo) znika z bazy w jednej transakcji;
      // weryfikacja sesji szuka konta w bazie, wiec dostep konczy sie od razu, bez restartu.
      magazyn.usunKonto(login, { powod: 'admin', emailSkrot: skrotEmaila(u.email) });
      console.log(`Usunięto konto "${login}". Dostęp odcięty natychmiast, bez restartu.`);
      const usuniete = usunDaneKonta(login);
      // Ostatnie konto organizacji samoobslugowej: znika tez jej marka, baza wspolna i wiersz.
      const zOrganizacja = u.organizacja !== dzierzawy.GLOWNA && magazyn.liczbaKont({ organizacja: u.organizacja }) === 0;
      if (zOrganizacja) {
        usuniete.push(...usunPlikiZRodzina(dzierzawy.plikiOrganizacji(KONF, u.organizacja)));
        magazyn.usunOrganizacje(u.organizacja);
      }
      if (usuniete.length || licznikow) {
        console.log('Usunięte dane konta (prywatna baza wiedzy, liczniki użycia):');
        usuniete.forEach((p) => console.log(`  - ${p}`));
        if (licznikow) console.log(`  - liczniki użycia w bazie: ${licznikow}`);
      } else {
        console.log('Konto nie miało na serwerze prywatnej bazy wiedzy ani liczników użycia.');
      }
      if (zOrganizacja) console.log(`Usunięto też organizację ${u.organizacja} (jej markę i bazę wspólną).`);
      else console.log('Dane marki są wspólne dla zespołu i zostają.');
      return;
    }

    // A1 dopisuje tu polecenia: pokaz, email, klucze, organizacja (13.3).

    default:
      pomoc();
  }
}

main().catch((e) => {
  console.error('BŁĄD:', e.message);
  process.exit(1);
});
