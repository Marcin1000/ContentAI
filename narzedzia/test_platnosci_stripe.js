#!/usr/bin/env node
'use strict';
/*
 * Test platnosci w prawdziwym trybie testowym Stripe (PROJEKT-TECHNICZNY 11.4, krok T8 i T9 z 12.4).
 * Poza CI: na srodowisku testowym, z kluczem testowym z prawem do zegarow testowych (sk_test_...),
 * ktory NIGDY nie trafia do pliku srodowiska produkcji.
 *
 * Co robi:
 *   1. zegar testowy Stripe (test clock) i klient na tym zegarze z karta testowa
 *      (4242: platnosci przechodza; 0341: podpiecie dziala, obciazenia nie),
 *   2. subskrypcja pakietu w wybranej walucie,
 *   3. powiazanie z kontem: <cli> platnosci-powiaz <login> <cus_...> --zamien (tylko PLATNOSCI_TRYB=test),
 *   4. przesuniecie zegara o miesiac (albo kilka) i stan konta po webhookach i uzgodnieniu
 *      (<cli> platnosci-synchronizuj <login>): 4242 -> aktywna z nowym okresem i druga wplata,
 *      0341 -> zalegla (potem po ponowieniach wygasla),
 *   5. z --sprzataj usuwa zegar (Stripe usuwa wtedy klienta i subskrypcje).
 *
 * Uzycie (na serwerze testowym, z katalogu repozytorium):
 *   STRIPE_KLUCZ_ZEGARY=sk_test_... STRIPE_CENA_STANDARD=price_... \
 *     node narzedzia/test_platnosci_stripe.js --login k-abc123 --waluta pln \
 *     --cli "sudo serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test" [--karta 0341] [--plan premium]
 *     [--miesiace 2] [--sprzataj]
 * Na atrapie (bez sieci): STRIPE_URL_API=http://127.0.0.1:9201 STRIPE_KLUCZ_ZEGARY=sk_test_atrapa_zegary ...
 * Zmienne: STRIPE_KLUCZ_ZEGARY (wymagana), STRIPE_URL_API (domyslnie https://api.stripe.com),
 *   STRIPE_CENA_<PLAN> (jak w srodowisku serwera; albo --cena price_...), STRIPE_WERSJA_API (domyslnie
 *   wersja adaptera), TEST_PLATNOSCI_CZEKAJ_S (przerwa na webhooki po przesunieciu zegara, domyslnie 8).
 * Kod wyjscia: 0 gdy stan konta zgodny z oczekiwanym, 1 gdy nie, 2 przy zlym uzyciu.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const stripe = require(path.join(REPO, 'serwer', 'platnosci-stripe.js'));

const DOBA_S = 86400;
const KARTY = { 4242: 'pm_card_visa', '0341': 'pm_card_chargeCustomerFail' };

function argumenty(argv) {
  const a = { karta: '4242', waluta: 'pln', plan: 'standard', miesiace: 1, cli: 'node serwer/uzytkownicy.js', sprzataj: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const wartosc = () => { i += 1; return argv[i]; };
    if (k === '--login') a.login = wartosc();
    else if (k === '--karta') a.karta = wartosc();
    else if (k === '--waluta') a.waluta = String(wartosc() || '').toLowerCase();
    else if (k === '--plan') a.plan = wartosc();
    else if (k === '--cena') a.cena = wartosc();
    else if (k === '--miesiace') a.miesiace = Number(wartosc());
    else if (k === '--cli') a.cli = wartosc();
    else if (k === '--email') a.email = wartosc();
    else if (k === '--sprzataj') a.sprzataj = true;
    else if (k === '-h' || k === '--help') a.pomoc = true;
    else a.nieznany = k;
  }
  return a;
}

function pomoc(tekst) {
  if (tekst) console.error(tekst);
  console.error('Użycie: STRIPE_KLUCZ_ZEGARY=sk_test_... node narzedzia/test_platnosci_stripe.js --login <login> [--waluta pln|eur] [--plan standard|premium]\n'
    + '  [--karta 4242|0341] [--cena price_...] [--miesiace 1] [--cli "sudo serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test"] [--sprzataj]');
  process.exit(2);
}

function konf(klucz) {
  return {
    platnosci: {
      tryb: 'test',
      stripe: { klucz, urlApi: String(process.env.STRIPE_URL_API || 'https://api.stripe.com').replace(/\/+$/, ''), wersjaApi: String(process.env.STRIPE_WERSJA_API || '') },
    },
  };
}

/** Polecenie CLI serwera (np. "sudo serwer/cli.sh --srodowisko ..."): { status, stdout, stderr }. */
function uruchomCli(cli, argumentyCli) {
  return new Promise((ok) => {
    const czesci = cli.split(/\s+/).filter(Boolean);
    const p = spawn(czesci[0], [...czesci.slice(1), ...argumentyCli], { cwd: REPO, env: process.env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => ok({ status: 127, stdout, stderr: `${stderr}${e.message}` }));
    p.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

function czekaj(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

let bledow = 0;
function wynik(nazwa, ok, szczegol) {
  console.log(`${ok ? 'ok    ' : 'BLAD  '}${nazwa}${!ok && szczegol ? `  [${szczegol}]` : ''}`);
  if (!ok) bledow += 1;
}

/** Stan konta z wyjscia platnosci-synchronizuj ("login: przed -> po (plan)"). */
function stanZWyjscia(stdout, login) {
  const m = new RegExp(`${login.replace(/[-]/g, '\\-')}: \\S+ -> (\\S+)(?: \\((\\w+)\\))?`).exec(stdout);
  return m ? { stan: m[1], plan: m[2] || null } : null;
}

async function main() {
  const a = argumenty(process.argv.slice(2));
  if (a.pomoc) pomoc();
  if (a.nieznany) pomoc(`Nieznany argument: ${a.nieznany}`);
  const klucz = String(process.env.STRIPE_KLUCZ_ZEGARY || '').trim();
  if (!/^sk_test_/.test(klucz)) pomoc('STRIPE_KLUCZ_ZEGARY: potrzebny klucz testowy sk_test_... z prawem do zegarow testowych (nigdy klucz live).');
  if (!a.login) pomoc('Podaj --login konta, z ktorym powiazac klienta testowego.');
  if (!KARTY[a.karta]) pomoc('--karta: 4242 albo 0341');
  if (!(a.miesiace >= 1 && a.miesiace <= 6)) pomoc('--miesiace: od 1 do 6');
  const parsowana = stripe.parsujCene(a.cena || process.env[`STRIPE_CENA_${String(a.plan).toUpperCase()}`]);
  const cena = parsowana.ok ? parsowana.ceny['*'] || parsowana.ceny[a.waluta] : null;
  if (!cena) pomoc(`Brak ceny: --cena price_... albo STRIPE_CENA_${String(a.plan).toUpperCase()} z cena dla waluty ${a.waluta}`);
  const k = konf(klucz);
  const api = (metoda, sciezka, parametry, idempotencja = null) => stripe.zapytanie(k, metoda, sciezka, parametry, { idempotencja });
  const czekajS = Number(process.env.TEST_PLATNOSCI_CZEKAJ_S || 8);

  console.log(`Stripe ${k.platnosci.stripe.urlApi}, wersja API ${k.platnosci.stripe.wersjaApi || stripe.WERSJA_API}; konto ${a.login}, ${a.plan} ${a.waluta}, karta ${a.karta}`);
  const teraz = Math.floor(Date.now() / 1000);
  const zegar = await api('POST', '/test_helpers/test_clocks', { frozen_time: teraz, name: `content-ai T8 ${a.login}` });
  wynik(`zegar testowy ${zegar.id}`, Boolean(zegar.id));
  let kod = 1;
  try {
    const klient = await api('POST', '/customers', {
      email: a.email || `test+${a.login}@example.com`, test_clock: zegar.id, metadata: { login: a.login, test: 'test_platnosci_stripe' }, preferred_locales: ['pl'],
    });
    // Pierwsza platnosc zawsze karta 4242; karta 0341 zastepuje ja po zakupie (odrzuca dopiero odnowienie).
    const metoda = await api('POST', `/payment_methods/${KARTY[4242]}/attach`, { customer: klient.id });
    await api('POST', `/customers/${klient.id}`, { invoice_settings: { default_payment_method: metoda.id } });
    wynik(`klient ${klient.id} na zegarze, karta 4242 podpieta`, Boolean(klient.id && metoda.id));
    const sub = await api('POST', '/subscriptions', {
      customer: klient.id, items: [{ price: cena }], currency: a.waluta, default_payment_method: metoda.id, metadata: { login: a.login, plan: a.plan },
    });
    wynik(`subskrypcja ${sub.id}: ${sub.status}`, ['active', 'trialing'].includes(sub.status), sub.status);
    if (a.karta === '0341') {
      const odrzucajaca = await api('POST', `/payment_methods/${KARTY['0341']}/attach`, { customer: klient.id });
      await api('POST', `/customers/${klient.id}`, { invoice_settings: { default_payment_method: odrzucajaca.id } });
      await api('POST', `/subscriptions/${sub.id}`, { default_payment_method: odrzucajaca.id });
      wynik('karta 0341 domyslna dla odnowien (obciazenia odrzucane)', Boolean(odrzucajaca.id));
    }

    const powiaz = await uruchomCli(a.cli, ['platnosci-powiaz', a.login, klient.id, '--zamien']);
    wynik('platnosci-powiaz (konto z klientem testowym)', powiaz.status === 0, (powiaz.stderr || powiaz.stdout).trim().slice(0, 300));
    if (powiaz.status !== 0) return;
    await czekaj(czekajS * 1000);
    const przed = stanZWyjscia((await uruchomCli(a.cli, ['platnosci-synchronizuj', a.login])).stdout, a.login);
    wynik(`stan po zakupie: ${przed ? przed.stan : '?'}`, Boolean(przed) && przed.stan === 'aktywna', JSON.stringify(przed));

    let czas = zegar.frozen_time;
    for (let m = 1; m <= a.miesiace; m += 1) {
      czas += 31 * DOBA_S + 3600;
      await api('POST', `/test_helpers/test_clocks/${zegar.id}/advance`, { frozen_time: czas });
      // Stripe przesuwa zegar w tle (status advancing -> ready), webhooki ida po drodze
      for (let i = 0; i < 60; i += 1) {
        const z = await api('GET', `/test_helpers/test_clocks/${zegar.id}`);
        if (z.status === 'ready') break;
        await czekaj(2000);
      }
      await czekaj(czekajS * 1000);
      const sync = await uruchomCli(a.cli, ['platnosci-synchronizuj', a.login]);
      const st = stanZWyjscia(sync.stdout, a.login);
      const oczekiwany = a.karta === '4242' ? 'aktywna' : (m === 1 ? 'zalegla' : null);
      const faktury = await api('GET', '/invoices', { customer: klient.id, limit: 10 });
      const oplacone = (faktury.data || []).filter((f) => f.status === 'paid' && Number(f.amount_paid) > 0).length;
      wynik(`miesiac ${m}: stan ${st ? st.stan : '?'}, oplaconych faktur ${oplacone}`,
        Boolean(st) && (!oczekiwany || st.stan === oczekiwany) && (a.karta !== '4242' || oplacone === m + 1), sync.stdout.trim().slice(-300));
    }
    kod = bledow ? 1 : 0;
    console.log(kod === 0 ? 'Gotowe: stan konta zgodny z oczekiwanym (kod 0).' : `Błędów: ${bledow} (kod 1).`);
    console.log('W panelu Stripe (tryb testowy): Developers > Webhooks > punkt koncowy > zdarzenia z odpowiedzia 200.');
  } finally {
    if (a.sprzataj) {
      try { await api('DELETE', `/test_helpers/test_clocks/${zegar.id}`); console.log(`Usunięto zegar ${zegar.id} (z klientem i subskrypcją).`); } catch (e) { console.error(`Zegar ${zegar.id}: ${e.message}`); }
    } else {
      console.log(`Zegar ${zegar.id} zostaje (Stripe usuwa go sam po 30 dniach); --sprzataj usuwa od razu.`);
    }
    process.exitCode = kod;
  }
}

main().catch((e) => { console.error(`BLAD: ${e.message}`); process.exit(1); });
