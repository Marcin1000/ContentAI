#!/usr/bin/env node
/**
 * Content AI - zarzadzanie kontami
 *
 *   node serwer/uzytkownicy.js lista
 *   node serwer/uzytkownicy.js dodaj <login> [admin|uzytkownik]
 *   node serwer/uzytkownicy.js haslo <login>
 *   node serwer/uzytkownicy.js rola  <login> <admin|uzytkownik>
 *   node serwer/uzytkownicy.js usun  <login>
 *
 * Hasla nie sa nigdzie zapisywane jawnie - w pliku ladują sie wylacznie hash i sol.
 * Haslo wpisuje sie interaktywnie, bez echa, zeby nie zostalo w historii powloki.
 */

'use strict';

const readline = require('node:readline');
const {
  zahaszuj, ROLE, PLIK_UZYTKOWNIKOW, wczytajUzytkownikow, zapiszUzytkownikow,
} = require('./server.js');

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

async function main() {
  const [polecenie, login, arg] = process.argv.slice(2);
  const lista = wczytajUzytkownikow();

  switch (polecenie) {
    case 'lista': {
      if (lista.length === 0) {
        console.log('Brak kont. Załóż pierwsze: node serwer/uzytkownicy.js dodaj <login> admin');
        return;
      }
      console.log(`Konta (${PLIK_UZYTKOWNIKOW}):\n`);
      for (const u of lista) {
        console.log(`  ${u.login.padEnd(20)} ${u.rola.padEnd(12)} utworzony: ${u.utworzony || '-'}`);
      }
      return;
    }

    case 'dodaj': {
      if (!login) return uzycie('dodaj <login> [rola]');
      const rola = arg || 'uzytkownik';
      sprawdzRole(rola);
      if (lista.some((u) => u.login === login)) {
        console.error(`BŁĄD: konto "${login}" już istnieje.`);
        process.exit(1);
      }
      const haslo = await noweHaslo();
      const { hash, sol } = zahaszuj(haslo);
      lista.push({ login, hash, sol, rola, utworzony: new Date().toISOString().slice(0, 10) });
      zapiszUzytkownikow(lista);
      console.log(`Dodano konto "${login}" z rolą ${rola}.`);
      return;
    }

    case 'haslo': {
      if (!login) return uzycie('haslo <login>');
      const u = lista.find((x) => x.login === login);
      if (!u) return brakKonta(login);
      const haslo = await noweHaslo();
      const { hash, sol } = zahaszuj(haslo);
      u.hash = hash;
      u.sol = sol;
      // Sesje sa bezstanowe (podpisane ciasteczko), wiec sam zapis nowego hasla
      // ich nie unieważnia. Znacznik sesjeOd odcina wszystkie wydane wczesniej.
      u.sesjeOd = Date.now();
      zapiszUzytkownikow(lista);
      console.log(`Zmieniono hasło konta "${login}". Wszystkie jego sesje zostały unieważnione.`);
      return;
    }

    case 'rola': {
      if (!login || !arg) return uzycie('rola <login> <admin|uzytkownik>');
      sprawdzRole(arg);
      const u = lista.find((x) => x.login === login);
      if (!u) return brakKonta(login);
      const adminow = lista.filter((x) => x.rola === 'admin').length;
      if (u.rola === 'admin' && arg !== 'admin' && adminow === 1) {
        console.error('BŁĄD: to jedyne konto admina - najpierw nadaj rolę admin komuś innemu.');
        process.exit(1);
      }
      u.rola = arg;
      // Rola i tak jest czytana z tego pliku przy kazdym zadaniu, wiec zmiana
      // dziala natychmiast. Znacznik ustawiamy dla porzadku - degradacja admina
      // ma odciac takze wszystko, co mogl sobie w miedzyczasie otworzyc.
      u.sesjeOd = Date.now();
      zapiszUzytkownikow(lista);
      console.log(`Konto "${login}" ma teraz rolę ${arg}. Jego sesje zostały unieważnione.`);
      return;
    }

    case 'usun': {
      if (!login) return uzycie('usun <login>');
      const u = lista.find((x) => x.login === login);
      if (!u) return brakKonta(login);
      const adminow = lista.filter((x) => x.rola === 'admin').length;
      if (u.rola === 'admin' && adminow === 1) {
        console.error('BŁĄD: to jedyne konto admina - nie można go usunąć.');
        process.exit(1);
      }
      // Sesja jest w podpisanym ciasteczku, ale weryfikacja szuka konta w tym
      // pliku - brak konta to koniec dostepu, od razu i bez restartu.
      zapiszUzytkownikow(lista.filter((x) => x.login !== login));
      console.log(`Usunięto konto "${login}". Dostęp odcięty natychmiast, bez restartu.`);
      return;
    }

    default:
      console.log(`Content AI - zarządzanie kontami

  node serwer/uzytkownicy.js lista
  node serwer/uzytkownicy.js dodaj <login> [admin|uzytkownik]
  node serwer/uzytkownicy.js haslo <login>
  node serwer/uzytkownicy.js rola  <login> <admin|uzytkownik>
  node serwer/uzytkownicy.js usun  <login>

Plik z kontami: ${PLIK_UZYTKOWNIKOW}`);
  }
}

function uzycie(s) {
  console.error(`Użycie: node serwer/uzytkownicy.js ${s}`);
  process.exit(1);
}

function brakKonta(login) {
  console.error(`BŁĄD: nie ma konta "${login}".`);
  process.exit(1);
}

main().catch((e) => {
  console.error('BŁĄD:', e.message);
  process.exit(1);
});
