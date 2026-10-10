'use strict';

// ─── Polecenia platnosci w CLI (wykonawca B) ─────────────────────────────────
//
// uzytkownicy.js przekazuje tu polecenia: platnosci-* (sprawdz, synchronizuj,
// powiaz), przychod, ewidencja, zwrot. Kontrakt:
//   POLECENIA: [{ nazwa, opis, uzycie }]           (pomoc w uzytkownicy.js)
//   async uruchom(polecenie, argumenty, kontekst) -> kod wyjscia (0 = dobrze)
// kontekst: { KONF, magazyn, plany, dzierzawy, wypisz(tekst), blad(tekst) } - CLI otworzyl
// juz baze (timeout 5000 ms) i sprawdzil wlasciciela katalogu danych.
//
// Na serwerze: sudo serwer/cli.sh <polecenie> (srodowisko uslugi, w tym PLATNOSCI i STRIPE_*).
//   platnosci-sprawdz                 konfiguracja, ceny u dostawcy, webhook, uzgadnianie, progi (kod 0 = gotowe)
//   platnosci-synchronizuj [login]    uzgodnienie stanu subskrypcji i wplat z dostawca, dokonczenie odstapien z bledem
//   platnosci-powiaz <login> <cus_..> [--zamien]   tylko tryb test (skrypt narzedzia/test_platnosci_stripe.js)
//   przychod [RRRR-Qn|RRRR]           wplaty minus zwroty per waluta i kraj, procent limitu kwartalnego, sprzedaz do UE
//   ewidencja <od> <do> [--dziennie]  CSV (srednik, przecinek dziesietny) do ewidencji sprzedazy, daty RRRR-MM-DD wlacznie
//   zwrot <login> [--zlozone RRRR-MM-DD[THH:MM]] [--pelny] [--wykonaj]
//                                     odstapienie zgloszone e-mailem albo listem: bez --wykonaj tylko wyliczenie

const platnosci = require('./platnosci.js');
const ekrany = require('./ekrany-platnosci.js');

const POLECENIA = [
  { nazwa: 'platnosci-sprawdz', opis: 'konfiguracja platnosci i ceny u dostawcy (kod 0 = gotowe)', uzycie: 'platnosci-sprawdz' },
  { nazwa: 'platnosci-synchronizuj', opis: 'uzgodnienie stanu subskrypcji z dostawca', uzycie: 'platnosci-synchronizuj [login]' },
  { nazwa: 'platnosci-powiaz', opis: 'powiazanie konta z klientem (tylko tryb test)', uzycie: 'platnosci-powiaz <login> <id-klienta> [--zamien]' },
  { nazwa: 'przychod', opis: 'sumy wplat w kwartale albo roku (per waluta i kraj)', uzycie: 'przychod [RRRR-Qn|RRRR]' },
  { nazwa: 'ewidencja', opis: 'wplaty i zwroty w okresie jako CSV (ewidencja sprzedazy)', uzycie: 'ewidencja <od RRRR-MM-DD> <do RRRR-MM-DD> [--dziennie]' },
  { nazwa: 'zwrot', opis: 'odstapienie w 14 dni: wyliczenie, z --wykonaj anulowanie i zwrot', uzycie: 'zwrot <login> [--zlozone RRRR-MM-DD[THH:MM]] [--pelny] [--wykonaj]' },
];

function obsluguje(polecenie) {
  return POLECENIA.some((p) => p.nazwa === polecenie);
}

// ─── Pomocnicze ──────────────────────────────────────────────────────────────

function kwota(k, waluta) { return ekrany.kwotaTekst(Math.round(Number(k)), waluta, 'pl'); }
function zl(liczba) { return ekrany.kwotaTekst(Math.round(Number(liczba) * 100), 'pln', 'pl'); }
function procent(x) { return `${String(Math.round(Number(x) * 10) / 10).replace('.', ',')}%`; }

/** Data i godzina w Warszawie: 2026-10-10 14:05. */
function chwilaTekst(ms) {
  if (!ms) return '-';
  const c = platnosci.czesciWarszawa(Number(ms));
  const d = (n) => String(n).padStart(2, '0');
  return `${c.rok}-${d(c.miesiac)}-${d(c.dzien)} ${d(c.godzina)}:${d(c.minuta)}`;
}

/** 'RRRR-MM-DD' albo 'RRRR-MM-DDTHH:MM' (czas polski) -> ms albo null. Sama data = 12:00. */
function parsujChwile(tekst) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(tekst || ''));
  if (!m) return null;
  const [rok, mies, dzien] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mies < 1 || mies > 12 || dzien < 1 || dzien > 31) return null;
  const polnoc = platnosci.polnocWarszawy(rok, mies, dzien);
  if (platnosci.dzienWarszawy(polnoc) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  const godz = m[4] === undefined ? 12 : Number(m[4]);
  const min = m[5] === undefined ? 0 : Number(m[5]);
  if (godz > 23 || min > 59) return null;
  return polnoc + (godz * 60 + min) * 60_000;
}

function flaga(argumenty, nazwa) { return argumenty.includes(nazwa); }
function wartoscFlagi(argumenty, nazwa) {
  const i = argumenty.indexOf(nazwa);
  return i >= 0 ? argumenty[i + 1] : undefined;
}
function pozycyjne(argumenty, zWartoscia = []) {
  const wynik = [];
  for (let i = 0; i < argumenty.length; i += 1) {
    if (zWartoscia.includes(argumenty[i])) { i += 1; continue; }
    if (!String(argumenty[i]).startsWith('--')) wynik.push(argumenty[i]);
  }
  return wynik;
}

/** Platnosci wlaczone po kontroli konfiguracji? Inaczej komunikat z nazwami zmiennych i kod 1. */
function wymagaj(kontekst) {
  const { KONF, blad } = kontekst;
  const f = KONF.funkcje && KONF.funkcje.platnosci;
  if (!KONF.platnosci.dostawca) {
    blad('Płatności są wyłączone: brak PLATNOSCI (ustaw PLATNOSCI=stripe i zmienne z serwer/README.md, sekcja "Płatności").');
    return false;
  }
  if (!f || !f.wlaczona) {
    blad(`Płatności wyłączone przez błędy konfiguracji:\n${((f && f.bledy) || []).map((b) => `  - ${b}`).join('\n')}`);
    return false;
  }
  return true;
}

function kontekstPlatnosci(kontekst) {
  return { KONF: kontekst.KONF, funkcjaWlaczona: (n) => Boolean(kontekst.KONF.funkcje[n] && kontekst.KONF.funkcje[n].wlaczona) };
}

// ─── platnosci-sprawdz ───────────────────────────────────────────────────────

async function sprawdz(argumenty, kontekst) {
  const { KONF, magazyn, wypisz, blad } = kontekst;
  const p = KONF.platnosci;
  const f = (KONF.funkcje && KONF.funkcje.platnosci) || {};
  if (!p.dostawca) { wymagaj(kontekst); return 1; }
  wypisz(`Płatności: ${p.dostawca}, tryb ${p.tryb || '(brak PLATNOSCI_TRYB)'}, sprzedaż ${p.sprzedaz ? 'włączona' : 'WYŁĄCZONA (PLATNOSCI_SPRZEDAZ=0)'}`);
  if (!f.wlaczona) {
    blad('Konfiguracja: BŁĘDY (płatności wyłączone, serwer działa dla istniejących kont):');
    for (const b of f.bledy || []) blad(`  - ${b}`);
    return 1;
  }
  wypisz('Konfiguracja: dobrze');
  const a = platnosci.adapter(KONF);
  const ostrzezenia = [...(f.ostrzezenia || []), ...(a.ostrzezeniaKonfiguracji ? a.ostrzezeniaKonfiguracji(KONF) : [])];
  for (const o of ostrzezenia) wypisz(`  ostrzeżenie: ${o}`);
  wypisz(`Wersja API dostawcy: ${(p.stripe && p.stripe.wersjaApi) || a.WERSJA_API} (adapter pisany pod ${a.WERSJA_API})`);
  wypisz(`Waluty: ${p.waluty.join(', ')} (PL: ${p.walutaPl}, inne języki: ${p.walutaDomyslna}); metody: ${p.metody.join(', ')}; kraje: ${p.kraje.length}`);
  wypisz(`Odstąpienie: zwrot ${p.zwrot}; okres próbny: ${Number(p.probaDni) > 0 ? `${p.probaDni} dni` : 'brak'}; kody rabatowe: ${p.kodyRabatowe ? 'tak' : 'nie'}; NIP klienta: ${p.nipKlienta ? 'tak' : 'nie'}; podatki Stripe: ${p.podatki ? 'tak' : 'nie'}`);
  let kod = 0;
  try {
    const c = await platnosci.odswiezCeny(KONF);
    for (const [plan, kw] of Object.entries(c.kwoty)) {
      wypisz(`  cena ${plan}: ${Object.entries(kw).map(([w, k]) => kwota(k, w)).join(', ') || '(brak)'}`);
    }
    for (const b of c.bledy) { blad(`  BŁĄD ceny: ${b}`); kod = 1; }
    for (const n of c.niezgodne) { blad(`  BŁĄD: PLATNOSCI_CENY_WYSWIETLANE niezgodne z ceną u dostawcy (${n}); sprzedaż tej pozycji wstrzymana`); kod = 1; }
    if (!c.bledy.length && !c.niezgodne.length) wypisz('Ceny u dostawcy: zgodne z konfiguracją');
  } catch (e) {
    blad(`BŁĄD: dostawca płatności nie odpowiada (${e.message})`);
    kod = 1;
  }
  const webhook = Number(magazyn.meta('platnosci:ostatni_webhook')) || null;
  const nieprzetworzone = magazyn.zdarzeniaNieprzetworzone(100);
  wypisz(`Webhook: ostatnie zdarzenie ${webhook ? chwilaTekst(webhook) : 'jeszcze żadnego (po pierwszym zakupie albo "Send test webhook" w panelu)'}; nieprzetworzonych: ${nieprzetworzone.length}`);
  for (const z of nieprzetworzone.slice(0, 5)) wypisz(`  nieprzetworzone: ${z.typ} ${z.id} (${chwilaTekst(z.otrzymane)})`);
  const uzg = Number(magazyn.meta('platnosci:ostatnie_uzgodnienie')) || null;
  wypisz(`Uzgadnianie: ostatnie ${uzg ? chwilaTekst(uzg) : 'jeszcze nie było (co 6 h od startu usługi)'}`);
  const zBledem = magazyn.odstapieniaWStanie('blad', 100);
  if (zBledem.length) {
    wypisz(`Odstąpienia z błędem dostawcy: ${zBledem.length} (dokończy uzgadnianie albo "zwrot <login> --wykonaj"): ${zBledem.map((o) => o.login).join(', ')}`);
  }
  const st = platnosci.stanProgow(KONF);
  wypisz(`Przychód ${st.kwartal}: ${zl(st.przychodPln)} z limitu ${zl(st.limitPln)} (${procent(st.procent)})${st.sprzedazWstrzymana ? ': SPRZEDAŻ WSTRZYMANA (PLATNOSCI_WSTRZYMAJ_PO_PROGU)' : ''}`);
  wypisz(`Sprzedaż do innych krajów UE w ${st.ue.rok}: ${kwota(Math.round(st.ue.przychodEur * 100), 'eur')} z ${kwota(st.ue.progEur * 100, 'eur')} (${procent(st.ue.procent)})`);
  wypisz(kod === 0 ? 'Gotowe (kod 0).' : 'Są błędy (kod 1).');
  return kod;
}

// ─── platnosci-synchronizuj ──────────────────────────────────────────────────

async function synchronizuj(argumenty, kontekst) {
  const { KONF, magazyn, wypisz, blad } = kontekst;
  if (!wymagaj(kontekst)) return 1;
  const [login] = pozycyjne(argumenty);
  if (login && !magazyn.konto(login)) { blad(`Nie ma konta ${login}.`); return 1; }
  const w = await platnosci.uzgodnij(KONF, { login: login || null, limit: 100000, naSekunde: 3, loguj: (t) => wypisz(`  ${t}`) });
  wypisz(`Uzgodniono kont: ${w.kont}, zmienionych: ${w.zmienionych}, dokończonych odstąpień: ${w.odstapien || 0}, błędów: ${w.bledow}.`);
  if (login && !w.kont) wypisz(`Konto ${login} nie ma klienta płatności w trybie ${KONF.platnosci.tryb}.`);
  return w.bledow ? 1 : 0;
}

// ─── platnosci-powiaz (tylko test) ───────────────────────────────────────────

async function powiaz(argumenty, kontekst) {
  const { KONF, magazyn, wypisz, blad } = kontekst;
  if (!wymagaj(kontekst)) return 1;
  if (KONF.platnosci.tryb !== 'test') { blad('platnosci-powiaz działa tylko w trybie testowym (PLATNOSCI_TRYB=test).'); return 1; }
  const [login, idKlienta] = pozycyjne(argumenty);
  if (!login || !/^cus_[A-Za-z0-9]{4,}$/.test(String(idKlienta || ''))) { blad('Użycie: platnosci-powiaz <login> <cus_...> [--zamien]'); return 1; }
  const konto = magazyn.konto(login);
  if (!konto) { blad(`Nie ma konta ${login}.`); return 1; }
  if (flaga(argumenty, '--zamien') && konto.platnikKlient && konto.platnikKlient !== idKlienta) {
    magazyn.zmienKonto(login, {
      platnik: null, platnikTryb: null, platnikKlient: null, platnikSubskrypcja: null, subskrypcjaStan: 'brak', subskrypcjaPlan: null,
      subskrypcjaWaluta: null, subskrypcjaSurowy: null, okresDo: null, zaleglaOd: null,
    });
    wypisz(`Usunięto poprzednie powiązanie ${login} z ${konto.platnikKlient}.`);
  }
  const w = platnosci.powiazKonto(magazyn.konto(login), idKlienta, KONF);
  if (w !== 'ok') { blad(`Nie powiązano: ${w} (konto ma innego klienta albo klient należy do innego konta; --zamien przepina konto).`); return 1; }
  const s = await platnosci.synchronizujKonto(KONF, login, { importujWplaty: true });
  const k = magazyn.konto(login);
  wypisz(`Powiązano ${login} z ${idKlienta}: stan ${k.subskrypcjaStan}${k.subskrypcjaPlan ? `, pakiet ${k.subskrypcjaPlan}` : ''}${k.okresDo ? `, okres do ${chwilaTekst(k.okresDo)}` : ''}${s ? '' : ' (bez synchronizacji)'}.`);
  return 0;
}

// ─── przychod ────────────────────────────────────────────────────────────────

function opisSum(sumy) {
  const pozycje = Object.entries(sumy).filter(([, v]) => v !== 0);
  return pozycje.length ? pozycje.map(([w, v]) => kwota(Math.round(v * 100), w)).join(', ') : '0';
}

function wypiszOkres(kontekst, przychod) {
  const { wypisz } = kontekst;
  wypisz(`  wpłat: ${przychod.wplat}, zwrotów: ${przychod.zwrotow}; netto: ${opisSum(przychod.wgWalut)}`);
  const kraje = Object.entries(przychod.wgKrajow).sort(([a], [b]) => a.localeCompare(b));
  if (kraje.length) wypisz(`  wg krajów: ${kraje.map(([k, s]) => `${k} ${opisSum(s)}`).join('; ')}`);
  wypisz(`  razem około ${zl(przychod.razemPln)} (EUR po ${String(przychod.kurs).replace('.', ',')} zł z PLATNOSCI_KURS_EUR_PLN: przybliżenie, nie księgowość)`);
  if (przychod.inneWaluty.length) wypisz(`  inne waluty poza sumą w PLN: ${przychod.inneWaluty.join(', ')}`);
}

async function przychod(argumenty, kontekst) {
  const { KONF, wypisz, blad } = kontekst;
  const p = KONF.platnosci;
  if (!p.dostawca) { wymagaj(kontekst); return 1; }
  const [nazwa] = pozycyjne(argumenty);
  const okres = platnosci.okresZNazwy(nazwa || '', Date.now());
  if (!okres) { blad('Użycie: przychod [RRRR-Qn|RRRR], np. przychod 2026-Q4 albo przychod 2026'); return 1; }
  wypisz(`Przychód ${okres.nazwa} (${platnosci.dzienWarszawy(okres.od)} do ${platnosci.dzienWarszawy(okres.do - 1)}, czas polski), tryb ${p.tryb}; zwroty pomniejszają okres, w którym je zlecono`);
  const limit = Number(p.progKwartalPln) || 0;
  if (/Q/.test(okres.nazwa)) {
    const w = platnosci.przychodOkresu(KONF, okres);
    wypiszOkres(kontekst, w);
    if (limit > 0) {
      const progi = [...new Set([...(p.progiOstrzezen || []), 100])].sort((x, y) => x - y).map((x) => `${x}%`).join(', ');
      wypisz(`  limit kwartalny ${zl(limit)}: ${procent((w.razemPln / limit) * 100)} (progi ostrzeżeń: ${progi})`);
    }
  } else {
    for (let n = 1; n <= 4; n += 1) {
      const kw = platnosci.okresZNazwy(`${okres.rok}-Q${n}`);
      const w = platnosci.przychodOkresu(KONF, kw);
      wypisz(`${kw.nazwa}: około ${zl(w.razemPln)}${limit > 0 ? ` (${procent((w.razemPln / limit) * 100)} limitu ${zl(limit)})` : ''}`);
      if (w.wplat || w.zwrotow) wypiszOkres(kontekst, w);
    }
    const w = platnosci.przychodOkresu(KONF, okres);
    wypisz(`Rok ${okres.rok}: netto ${opisSum(w.wgWalut)}, około ${zl(w.razemPln)}`);
  }
  const rok = platnosci.przychodOkresu(KONF, platnosci.okresZNazwy(String(okres.rok)));
  const prog = Number(p.progUeEur) || 10000;
  wypisz(`Sprzedaż do konsumentów z innych krajów UE w ${okres.rok}: ${kwota(Math.round(rok.ueEur * 100), 'eur')} z progu ${kwota(prog * 100, 'eur')} (${procent((rok.ueEur / prog) * 100)})`);
  return 0;
}

// ─── ewidencja (CSV) ─────────────────────────────────────────────────────────

function liczbaCsv(x) { return (Math.round(Number(x) * 100) / 100).toFixed(2).replace('.', ','); }
function poleCsv(v) {
  const t = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Wplaty i zwroty w [od, do) jako wiersze ewidencji (zwrot z kwota ujemna, w dniu zlecenia). */
function wierszeEwidencji(KONF, magazyn, od, doKiedy) {
  const p = KONF.platnosci;
  const kurs = Number(p.kursEurPln) || 4.25;
  const naPln = (k, w) => {
    if (w === 'pln') return k;
    return w === 'eur' ? k * kurs : 0;
  };
  const wiersze = [
    ...magazyn.platnosciWOkresie({ tryb: p.tryb, od, do: doKiedy }).map((w) => ({
      czas: w.oplacono, rodzaj: 'wplata', id: w.id, wplata: w.id, konto: w.login, kraj: w.kraj, kwota: Number(w.kwota) / 100, waluta: w.waluta,
      plan: w.plan, okresOd: w.okresOd, okresDo: w.okresDo,
    })),
    ...magazyn.zwrotyWOkresie({ tryb: p.tryb, od, do: doKiedy }).map((z) => ({
      czas: z.czas, rodzaj: `zwrot (${z.powod || 'inny'})`, id: z.id, wplata: z.wplata, konto: z.login, kraj: z.kraj, kwota: -Number(z.kwota) / 100,
      waluta: z.waluta, plan: z.plan, okresOd: null, okresDo: null,
    })),
  ].sort((a, b) => a.czas - b.czas || a.id.localeCompare(b.id));
  for (const w of wiersze) w.pln = naPln(w.kwota, w.waluta);
  return wiersze;
}

async function ewidencja(argumenty, kontekst) {
  const { KONF, magazyn, wypisz, blad } = kontekst;
  if (!KONF.platnosci.dostawca) { wymagaj(kontekst); return 1; }
  const [odT, doT] = pozycyjne(argumenty);
  const od = parsujChwile(odT);
  const doDnia = parsujChwile(doT);
  if (od === null || doDnia === null || /[T ]/.test(`${odT}${doT}`)) {
    blad('Użycie: ewidencja <od RRRR-MM-DD> <do RRRR-MM-DD> [--dziennie] (daty włącznie, czas polski)');
    return 1;
  }
  const poczatek = od - 12 * 3600_000;
  const c = platnosci.czesciWarszawa(doDnia);
  const koniec = platnosci.polnocWarszawy(c.rok, c.miesiac, c.dzien + 1);
  if (koniec <= poczatek) { blad('Data "do" jest wcześniejsza niż "od".'); return 1; }
  const wiersze = wierszeEwidencji(KONF, magazyn, poczatek, koniec);
  // Narastajaco w kwartale (limit dzialalnosci nierejestrowanej) od poczatku kwartalu pierwszej daty.
  const kw0 = platnosci.kwartal(poczatek);
  let narastajaco = wierszeEwidencji(KONF, magazyn, kw0.od, poczatek).reduce((s, w) => s + w.pln, 0);
  let kwartalBiezacy = kw0.nazwa;
  const narastajacoPo = (czas, pln) => {
    const kw = platnosci.kwartal(czas).nazwa;
    if (kw !== kwartalBiezacy) { kwartalBiezacy = kw; narastajaco = 0; }
    narastajaco += pln;
    return narastajaco;
  };
  if (flaga(argumenty, '--dziennie')) {
    wypisz('lp;data;wplat;zwrotow;netto_pln;netto_eur;netto_pln_razem;narastajaco_kwartal_pln');
    const dni = new Map();
    for (const w of wiersze) {
      const d = platnosci.dzienWarszawy(w.czas);
      const x = dni.get(d) || { wplat: 0, zwrotow: 0, pln: 0, eur: 0, razem: 0, czas: w.czas };
      if (w.kwota >= 0) x.wplat += 1; else x.zwrotow += 1;
      if (w.waluta === 'pln') x.pln += w.kwota;
      if (w.waluta === 'eur') x.eur += w.kwota;
      x.razem += w.pln;
      dni.set(d, x);
    }
    let lp = 0;
    for (const [d, x] of dni) {
      lp += 1;
      const n = narastajacoPo(x.czas, x.razem);
      wypisz([lp, d, x.wplat, x.zwrotow, liczbaCsv(x.pln), liczbaCsv(x.eur), liczbaCsv(x.razem), liczbaCsv(n)].join(';'));
    }
  } else {
    wypisz('lp;data;rodzaj;identyfikator;wplata;konto;kraj;kwota;waluta;kwota_pln;narastajaco_kwartal_pln;pakiet;okres_od;okres_do');
    wiersze.forEach((w, i) => {
      const n = narastajacoPo(w.czas, w.pln);
      wypisz([
        i + 1, chwilaTekst(w.czas), w.rodzaj, w.id, w.wplata, w.konto || '', w.kraj || '', liczbaCsv(w.kwota), w.waluta, liczbaCsv(w.pln), liczbaCsv(n),
        w.plan || '', w.okresOd ? platnosci.dzienWarszawy(w.okresOd) : '', w.okresDo ? platnosci.dzienWarszawy(w.okresDo - 1) : '',
      ].map(poleCsv).join(';'));
    });
  }
  if (!wiersze.length) blad(`Brak wpłat i zwrotów od ${odT} do ${doT} (tryb ${KONF.platnosci.tryb}).`);
  return 0;
}

// ─── zwrot (odstapienie zgloszone e-mailem albo listem) ──────────────────────

async function zwrot(argumenty, kontekst) {
  const { KONF, magazyn, wypisz, blad } = kontekst;
  if (!wymagaj(kontekst)) return 1;
  const [login] = pozycyjne(argumenty, ['--zlozone']);
  const konto = login ? magazyn.konto(login) : null;
  if (!konto) { blad(login ? `Nie ma konta ${login}.` : 'Użycie: zwrot <login> [--zlozone RRRR-MM-DD[THH:MM]] [--pelny] [--wykonaj]'); return 1; }
  let zlozone = Date.now();
  if (wartoscFlagi(argumenty, '--zlozone') !== undefined) {
    zlozone = parsujChwile(wartoscFlagi(argumenty, '--zlozone'));
    if (zlozone === null || zlozone > Date.now()) {
      blad('--zlozone: chwila otrzymania oświadczenia, RRRR-MM-DD albo RRRR-MM-DDTHH:MM (czas polski), nie z przyszłości');
      return 1;
    }
  }
  const tryb = flaga(argumenty, '--pelny') ? 'pelny' : KONF.platnosci.zwrot;
  const ocena = platnosci.stanOdstapienia(konto, KONF, zlozone);
  wypisz(`Konto ${login}${konto.email ? ` (${konto.email})` : ''}: subskrypcja ${konto.subskrypcjaStan}${konto.subskrypcjaPlan ? `, pakiet ${konto.subskrypcjaPlan}` : ''}`);
  if (ocena.zawarcie) wypisz(`  zawarcie umowy: ${chwilaTekst(ocena.zawarcie)}, termin na odstąpienie do ${chwilaTekst(ocena.termin - 1)}`);
  wypisz(`  oświadczenie złożone: ${chwilaTekst(zlozone)}`);
  if (!ocena.mozliwe) {
    const powody = {
      'brak-umowy': 'konto nie ma umowy, od której można odstąpić',
      zlozone: `oświadczenie już przyjęte (${ocena.odstapienie ? `${chwilaTekst(ocena.odstapienie.zlozone)}, stan ${ocena.odstapienie.stan}` : ''})`,
      'po-terminie': 'termin na odstąpienie minął (anulowanie bez zwrotu: panel subskrypcji klienta)',
    };
    blad(`Odstąpienie niemożliwe: ${powody[ocena.powod] || ocena.powod}.`);
    return 1;
  }
  const wplaty = magazyn.wplatySubskrypcji(KONF.platnosci.dostawca, konto.platnikSubskrypcja);
  const pozycje = platnosci.wyliczZwrot(wplaty, zlozone, tryb);
  for (const poz of pozycje) {
    wypisz(`  wpłata ${poz.wplata.id} z ${chwilaTekst(poz.wplata.oplacono)}: ${kwota(poz.wplata.kwota, poz.wplata.waluta)}, dostęp ${poz.dniUzyte} z ${poz.dniOkresu} dni, `
      + `już zwrócono ${kwota(poz.wplata.zwrot || 0, poz.wplata.waluta)}, zwrot ${kwota(poz.kwota, poz.wplata.waluta)}`);
  }
  if (!pozycje.length) wypisz('  brak wpłat w rejestrze (okres próbny albo webhook jeszcze nie doszedł: przy --wykonaj dociągniemy je z API)');
  wypisz(`  tryb zwrotu: ${tryb}${ocena.ponowienie ? '; ponowienie oświadczenia przerwanego błędem dostawcy' : ''}`);
  if (!flaga(argumenty, '--wykonaj')) {
    wypisz('Bez zmian. Dopisz --wykonaj, żeby zapisać oświadczenie, anulować subskrypcję od razu i zlecić zwrot.');
    return 0;
  }
  try {
    const w = await platnosci.odstap({ konto, zrodlo: 'cli', zlozone, kontekst: kontekstPlatnosci(kontekst), trybZwrotu: tryb });
    wypisz(`Odstąpienie ${w.id} przyjęte: subskrypcja anulowana, zwrot ${kwota(w.kwota, w.waluta || konto.subskrypcjaWaluta || 'pln')} (najpóźniej do ${chwilaTekst(w.terminZwrotu)}).`);
    return 0;
  } catch (e) {
    if (e instanceof platnosci.Odmowa) { blad(`Odmowa: ${e.kod} (${JSON.stringify(e.pola)})`); return 1; }
    blad(`BŁĄD dostawcy: ${e.message}. Oświadczenie zostało zapisane; ponów "zwrot ${login} --wykonaj" albo poczekaj na uzgadnianie.`);
    return 1;
  }
}

const OBSLUGA = {
  'platnosci-sprawdz': sprawdz,
  'platnosci-synchronizuj': synchronizuj,
  'platnosci-powiaz': powiaz,
  przychod,
  ewidencja,
  zwrot,
};

async function uruchom(polecenie, argumenty, kontekst) {
  const blad = (kontekst && kontekst.blad) || ((t) => console.error(t));
  const fn = OBSLUGA[polecenie];
  if (!fn) { blad(`Nieznane polecenie płatności: ${polecenie}`); return 1; }
  try {
    return await fn(argumenty || [], { ...kontekst, blad, wypisz: (kontekst && kontekst.wypisz) || ((t) => console.log(t)) });
  } catch (e) {
    blad(`BŁĄD: ${e.message}`);
    return 1;
  }
}

module.exports = { POLECENIA, obsluguje, uruchom, parsujChwile };
