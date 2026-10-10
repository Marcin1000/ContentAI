'use strict';

// ─── Testy: poczta (wykonawca C, ARCH8-21, PR8-27) ───────────────────────────
//
// Szablony PL i EN (wszystkie z listy, bez slowa o fakturach, bez dlugich myslnikow, bez obrazkow,
// zabezpieczony HTML, odnosnik tylko http(s), stopka uslugodawcy), tryb log (pelna wiadomosc tylko
// w CAI_POCZTA_LOG, w dzienniku zamaskowany adres i ani sladu odnosnika z tokenem), adapter
// Resend przeciw atrapie narzedzia/atrapa/poczta.js (pola API, Idempotency-Key, jedno ponowienie
// przy 5xx, 429 i bledzie sieci, bez ponowienia przy 401), stan w /api/status i polecenie
// poczta-test (ostrzezenie, gdy domena ma wlaczone sledzenie).
// Wolane z serwer/testy.js: require('./testy-poczta.js').uruchom({ sprawdz }).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { uruchomSerwer } = require('./testy-wspolne.js');

const TOKEN = 'TOKEN-TAJNY-0123456789abcdef';
const ODNOSNIK = `https://app.example.com/potwierdz?t=${TOKEN}&lang=pl`;
const KONF_BAZOWY = {
  adresPubliczny: 'https://app.example.com',
  uslugodawca: { imieNazwisko: 'Jan Testowy', adres: 'ul. Testowa 1, 00-001 Warszawa', email: 'kontakt@example.com', telefon: '+48 500 000 000' },
};

/** Przechwytuje console.* na czas wywolania (sprawdzenie, co trafia do dziennika). */
async function zDziennikiem(f) {
  const linie = [];
  const przed = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(przed)) console[k] = (...a) => linie.push(a.join(' '));
  try {
    return { wynik: await f(), dziennik: linie.join('\n') };
  } finally {
    Object.assign(console, przed);
  }
}

const DANE = {
  potwierdzenie: { odnosnik: ODNOSNIK, email: 'ola@example.com', godzin: 48, minut: 2880 },
  reset: { odnosnik: ODNOSNIK, email: 'ola@example.com', minut: 30 },
  'haslo-zmienione': { email: 'ola@example.com', odnosnikResetu: 'https://app.example.com/haslo' },
  'zmiana-email': { odnosnik: ODNOSNIK, email: 'ola@example.com', nowyEmail: 'ola.nowa@example.com', godzin: 24 },
  'zmiana-email-info': { email: 'ola@example.com', nowyEmail: 'ola.nowa@example.com' },
  'konto-usuniete': { email: 'ola@example.com' },
  'prog-przychodu': { rodzaj: 'kwartal', prog: 80, okres: '2026-Q4', przychod: '8 650,80 zł', limit: '10 813,50 zł', procent: 80, opis: 'przychod w kwartale 2026-Q4: 8650.80 zl, 80% limitu 10813.5 zl (prog 80%)' },
  powitanie: { pakiet: 'Darmowy', artykulow: 3, kosztArtykulu: 'ok. 0,40 zł', odnosnikKlucza: 'https://content-ai.net/klucz-api' },
  'konto-istnieje': { email: 'ola@example.com', odnosnik: 'https://app.example.com/haslo/nowe?t=X' },
  test: {},
  // Pola jak w platnosci.js (B): kwoty i daty juz sformatowane.
  'zakup-potwierdzenie': {
    pakiet: 'Standard', kwota: '79,00 zł', waluta: 'pln', dataZawarcia: '10.10.2026, 12:00', nastepnaPlatnosc: '10.11.2026',
    terminOdstapienia: '24.10.2026', zadanieWykonania: '10.10.2026, 11:58', trybZwrotu: 'proporcjonalny', regulaminWersja: '2026-10-01',
    adresRegulaminu: 'https://app.example.com/dokumenty/regulamin', adresOdstapienia: 'https://app.example.com/dokumenty/odstapienie',
    adresKonta: 'https://app.example.com/konto',
    zalaczniki: [
      { nazwa: 'content-ai-regulamin-pl.txt', typ: 'text/plain; charset=utf-8', tresc: 'REGULAMIN Content AI\nParagraf 1. Postanowienia ogólne.' },
      { nazwa: 'content-ai-odstapienie-pl.txt', typ: 'text/plain; charset=utf-8', tresc: 'POUCZENIE O ODSTĄPIENIU\nWzór formularza.' },
    ],
  },
  'odstapienie-potwierdzenie': {
    pakiet: 'Standard', dataZawarcia: '10.10.2026', zlozone: '12.10.2026, 09:15', kwotaZwrotu: '73,73 zł', waluta: 'pln',
    terminZwrotu: '26.10.2026', dniUzyte: 2, dniOkresu: 31, potracenie: '2/31', trybZwrotu: 'proporcjonalny', adresKonta: 'https://app.example.com/konto',
  },
};

function testySzablonow({ sprawdz }) {
  console.log('\n  poczta: szablony PL i EN');
  const szablony = require('./poczta-szablony.js');
  const wymagane = ['potwierdzenie', 'reset', 'haslo-zmienione', 'zmiana-email', 'zmiana-email-info', 'konto-usuniete', 'prog-przychodu'];
  const bledy = [];
  for (const nazwa of szablony.SZABLONY) {
    for (const j of ['pl', 'en']) {
      const w = szablony.renderuj(nazwa, j, DANE[nazwa] || {}, KONF_BAZOWY);
      const calosc = `${w.temat}\n${w.tekst}\n${w.html}`;
      if (!w.temat || /[\r\n]/.test(w.temat)) bledy.push(`${nazwa}/${j}: temat`);
      if (/faktur|invoice/i.test(calosc)) bledy.push(`${nazwa}/${j}: faktura`);
      if (/[\u2013\u2014]/.test(calosc)) bledy.push(`${nazwa}/${j}: dlugi myslnik`);
      if (/<img|<script|url\(/i.test(w.html)) bledy.push(`${nazwa}/${j}: obrazek albo skrypt`);
      if (!w.tekst.includes('Jan Testowy') || !w.html.includes('kontakt@example.com')) bledy.push(`${nazwa}/${j}: stopka`);
      if (!/^<!doctype html><html lang="(pl|en)">/.test(w.html)) bledy.push(`${nazwa}/${j}: html`);
      const dane = DANE[nazwa] || {};
      if (dane.odnosnik && (!w.tekst.includes(dane.odnosnik) || !w.html.includes(`href="${dane.odnosnik.replace(/&/g, '&amp;')}"`))) bledy.push(`${nazwa}/${j}: odnosnik`);
    }
  }
  sprawdz(`szablony: komplet z kontraktu, PL i EN, temat w jednej linii, bez slowa o fakturach, dlugich myslnikow i obrazkow, stopka uslugodawcy (${bledy.join('; ') || 'ok'})`,
    wymagane.every((n) => szablony.SZABLONY.includes(n)) && bledy.length === 0);

  const p = szablony.renderuj('potwierdzenie', 'pl', DANE.potwierdzenie, KONF_BAZOWY);
  const e = szablony.renderuj('reset', 'en', DANE.reset, KONF_BAZOWY);
  sprawdz('szablony: tresc z AG/runda8/agencja-strona (potwierdzenie PL, reset EN), waznosc linku slownie z odmiana',
    p.temat === 'Potwierdź adres e-mail w Content AI' && p.tekst.includes('ktoś, prawdopodobnie Ty, założył konto w Content AI na adres ola@example.com')
    && p.tekst.includes('Link jest ważny 48 godzin i działa raz') && e.temat === 'Set a new password for Content AI'
    && e.tekst.includes('The link is valid for 30 minutes and works once')
    && szablony.renderuj('zmiana-email', 'pl', DANE['zmiana-email'], KONF_BAZOWY).tekst.includes('ważny 24 godziny')
    && szablony.renderuj('potwierdzenie', 'pl', { ...DANE.potwierdzenie, godzin: 1 }, KONF_BAZOWY).tekst.includes('ważny 1 godzinę'));
  const zly = szablony.renderuj('potwierdzenie', 'pl', { email: '<b>x</b>"@example.com', odnosnik: 'javascript:alert(1)' }, KONF_BAZOWY);
  sprawdz('szablony: wartosci w HTML zabezpieczone, odnosnik inny niz http(s) nie trafia ani do przycisku, ani do tekstu',
    zly.html.includes('&lt;b&gt;x&lt;/b&gt;&quot;@example.com') && !zly.html.includes('<b>x</b>') && !/javascript:/i.test(zly.html + zly.tekst));
  const zmiana = szablony.renderuj('zmiana-email', 'pl', DANE['zmiana-email'], KONF_BAZOWY);
  const prog = szablony.renderuj('prog-przychodu', 'pl', DANE['prog-przychodu'], KONF_BAZOWY);
  sprawdz('szablony: zmiana adresu idzie z powodem "nowy adres", prog przychodu do uslugodawcy z opisem i poleceniem rejestru',
    zmiana.tekst.includes('ten adres podano jako nowy adres konta') && zmiana.tekst.includes('ola.nowa@example.com')
    && prog.temat === 'Content AI: 80% limitu przychodu w kwartale (2026-Q4)' && prog.tekst.includes('cli.sh przychod')
    && prog.tekst.includes('do usługodawcy'));
}

function testyUmowy({ sprawdz }) {
  console.log('\n  poczta: potwierdzenie umowy i odstapienia (PR8-31, pola z platnosci.js B)');
  const szablony = require('./poczta-szablony.js');
  const z = szablony.renderuj('zakup-potwierdzenie', 'pl', DANE['zakup-potwierdzenie'], KONF_BAZOWY);
  sprawdz('zakup-potwierdzenie PL: dane uslugodawcy z konfiguracji, pakiet, cena, data zawarcia i odnowienia, odstapienie do terminu, zalaczniki i adresy dokumentow',
    z.temat === 'Content AI: potwierdzenie zamówienia pakietu Standard'
    && z.tekst.includes('Usługodawca: Jan Testowy, ul. Testowa 1, 00-001 Warszawa, e-mail kontakt@example.com, tel. +48 500 000 000.')
    && z.tekst.includes('Data zawarcia umowy: 10.10.2026, 12:00. Cena: 79,00 zł miesięcznie') && z.tekst.includes('Kolejna płatność: 10.11.2026.')
    && z.tekst.includes('w ciągu 14 dni (do 24.10.2026)') && z.tekst.includes('Pouczenie i wzór formularza są w załączniku.')
    && z.tekst.includes('W załącznikach: Regulamin (wersja 2026-10-01)') && z.tekst.includes('https://app.example.com/dokumenty/odstapienie')
    && z.tekst.includes('złożone 10.10.2026, 11:58. Jeśli odstąpisz od umowy, zapłacisz za okres, w którym pakiet był dostępny.')
    && z.html.includes('href="https://app.example.com/konto"'));
  const pelny = szablony.renderuj('zakup-potwierdzenie', 'pl', { ...DANE['zakup-potwierdzenie'], trybZwrotu: 'pelny' }, KONF_BAZOWY);
  const bezZadania = szablony.renderuj('zakup-potwierdzenie', 'pl', { ...DANE['zakup-potwierdzenie'], zadanieWykonania: '', zalaczniki: [] }, KONF_BAZOWY);
  const en = szablony.renderuj('zakup-potwierdzenie', 'en', DANE['zakup-potwierdzenie'], KONF_BAZOWY);
  sprawdz('zakup-potwierdzenie: wariant D-03 (pelny zwrot), bez zadania wykonania bez tego zdania, bez zalacznikow adresy dokumentow; EN',
    pelny.tekst.includes('otrzymasz zwrot całej kwoty') && !bezZadania.tekst.includes('Potwierdzamy Twoje żądanie')
    && !bezZadania.tekst.includes('w załączniku') && bezZadania.tekst.includes('są na stronie.')
    && en.temat === 'Content AI: confirmation of your Standard plan order' && en.tekst.includes('Service provider: Jan Testowy')
    && en.tekst.includes('phone +48 500 000 000') && en.tekst.includes('Attached: Terms (version 2026-10-01)'));
  const o = szablony.renderuj('odstapienie-potwierdzenie', 'pl', DANE['odstapienie-potwierdzenie'], KONF_BAZOWY);
  const oPelny = szablony.renderuj('odstapienie-potwierdzenie', 'pl', { ...DANE['odstapienie-potwierdzenie'], potracenie: null, trybZwrotu: 'pelny' }, KONF_BAZOWY);
  const oEn = szablony.renderuj('odstapienie-potwierdzenie', 'en', DANE['odstapienie-potwierdzenie'], KONF_BAZOWY);
  sprawdz('odstapienie-potwierdzenie: przyjecie oswiadczenia, kwota i termin zwrotu, potracenie proporcjonalne tylko przy potraceniu; EN',
    o.tekst.includes('pakietu Standard z dnia 10.10.2026, złożone 12.10.2026, 09:15. Subskrypcja została zakończona.')
    && o.tekst.includes('Zwrot: 73,73 zł na kartę użytą do płatności, najpóźniej do 26.10.2026.') && o.tekst.includes('za 2 z 31 dni dostępu')
    && !oPelny.tekst.includes('pomniejszona') && o.tekst.includes('pakiecie Darmowym')
    && oEn.tekst.includes('Refund: 73,73 zł to the card used for payment') && oEn.tekst.includes('Free plan'));
}

async function testyLog({ sprawdz }) {
  console.log('\n  poczta: tryb log (domyslny)');
  const poczta = require('./poczta.js');
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-poczta-'));
  try {
    const plik = path.join(kat, 'poczta.jsonl');
    const konf = { ...KONF_BAZOWY, poczta: { tryb: 'log', log: plik } };
    const { wynik, dziennik } = await zDziennikiem(() => poczta.wyslij({ do: 'ola@example.com', szablon: 'potwierdzenie', jezyk: 'pl', dane: DANE.potwierdzenie }, konf));
    const linie = fs.readFileSync(plik, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    await poczta.wyslij({ do: 'ola@example.com', szablon: 'zakup-potwierdzenie', dane: DANE['zakup-potwierdzenie'] }, konf);
    const zZalacznikami = JSON.parse(fs.readFileSync(plik, 'utf8').trim().split('\n').pop());
    sprawdz('log: zalaczniki w CAI_POCZTA_LOG skrocone do nazwy, typu i rozmiaru (bez tresci regulaminu)',
      zZalacznikami.szablon === 'zakup-potwierdzenie' && zZalacznikami.dane.zalaczniki.length === 2
      && zZalacznikami.dane.zalaczniki[0].nazwa === 'content-ai-regulamin-pl.txt' && zZalacznikami.dane.zalaczniki[0].bajtow > 10
      && !JSON.stringify(zZalacznikami.dane).includes('Paragraf 1'));
    sprawdz('log: { ok, tryb: log }, dziennik z zamaskowanym adresem, bez odnosnika z tokenem i bez pelnego adresu',
      wynik.ok === true && wynik.tryb === 'log' && dziennik.includes('o***@example.com') && dziennik.includes('potwierdzenie')
      && !dziennik.includes(TOKEN) && !dziennik.includes('ola@example.com'));
    sprawdz('log: pelna wiadomosc w CAI_POCZTA_LOG (czas, do, szablon, jezyk, temat, tekst, html, dane z odnosnikiem), plik 0600',
      linie.length === 1 && linie[0].do === 'ola@example.com' && linie[0].szablon === 'potwierdzenie' && linie[0].dane.odnosnik === ODNOSNIK
      && linie[0].tekst.includes(ODNOSNIK) && linie[0].html.includes('Potwierdź adres') && Boolean(linie[0].czas)
      && (fs.statSync(plik).mode & 0o777) === 0o600);
    const brak = await poczta.wyslij({ szablon: 'reset' }, konf);
    const nieznany = await zDziennikiem(() => poczta.wyslij({ do: 'ola@example.com', szablon: 'nie-ma-takiego' }, konf));
    sprawdz('log: brak adresu albo nieznany szablon -> { ok: false } bez wyjatku', brak.ok === false && nieznany.wynik.ok === false);
  } finally {
    fs.rmSync(kat, { recursive: true, force: true });
  }
}

async function testyResend({ sprawdz }) {
  console.log('\n  poczta: adapter Resend (atrapa narzedzia/atrapa/poczta.js)');
  const poczta = require('./poczta.js');
  const atrapa = require('../narzedzia/atrapa/poczta.js');
  atrapa.wyczysc();
  const serwer = atrapa.uruchom(0);
  await new Promise((r) => (serwer.listening ? r() : serwer.once('listening', r)));
  const url = `http://127.0.0.1:${serwer.address().port}`;
  const konf = {
    ...KONF_BAZOWY,
    poczta: { tryb: 'resend', klucz: 're_atrapa', od: 'Content AI <konto@example.com>', odpowiedz: 'kontakt@example.com', url, log: '' },
  };
  try {
    const { wynik, dziennik } = await zDziennikiem(() => poczta.wyslij({ do: 'ola@example.com', szablon: 'reset', jezyk: 'en', dane: { ...DANE.reset, odnosnik: ODNOSNIK } }, konf));
    const list = atrapa.poczta[atrapa.poczta.length - 1] || {};
    const wywolanie = atrapa.ostatnie[atrapa.ostatnie.length - 1] || {};
    sprawdz('resend: POST /emails z from, to, subject, text, html, reply_to i znacznikiem rodzaju; wynik z id dostawcy',
      wynik.ok === true && wynik.tryb === 'resend' && Boolean(wynik.id) && list.id === wynik.id && list.from === 'Content AI <konto@example.com>'
      && list.to[0] === 'ola@example.com' && list.subject === 'Set a new password for Content AI' && list.text.includes(ODNOSNIK)
      && list.linki.includes(ODNOSNIK) && list.reply_to === 'kontakt@example.com'
      && list.tags.some((t) => t.name === 'rodzaj' && t.value === 'reset') && /^cai-/.test(wywolanie.idempotencja || ''));
    sprawdz('resend: dziennik bez odnosnika z tokenem i bez pelnego adresu (zamaskowany adres i id wiadomosci)',
      !dziennik.includes(TOKEN) && !dziennik.includes('ola@example.com') && dziennik.includes('o***@example.com') && dziennik.includes(wynik.id));

    atrapa.wyczysc();
    const raz = await zDziennikiem(() => poczta.wyslij({ do: 'ola+atrapa-500-raz@example.com', szablon: 'potwierdzenie', dane: DANE.potwierdzenie }, konf));
    sprawdz('resend: 500 przy pierwszej probie -> jedno ponowienie z tym samym Idempotency-Key, jedna wiadomosc',
      raz.wynik.ok === true && atrapa.ostatnie.length === 2 && atrapa.ostatnie[0].status === 500 && atrapa.ostatnie[1].status === 200
      && atrapa.ostatnie[0].idempotencja === atrapa.ostatnie[1].idempotencja && atrapa.poczta.length === 1);

    atrapa.wyczysc();
    const limit = await zDziennikiem(() => poczta.wyslij({ do: 'ola+atrapa-429@example.com', szablon: 'potwierdzenie', dane: DANE.potwierdzenie }, konf));
    const stanPo429 = poczta.stan();
    sprawdz('resend: 429 dwa razy -> { ok: false } z opisem bez adresu, dwie proby, stan() z ostatnim bledem bez adresu i odnosnika',
      limit.wynik.ok === false && /429/.test(limit.wynik.blad) && !limit.wynik.blad.includes('@') && atrapa.ostatnie.length === 2
      && /429/.test(stanPo429.ostatniBlad) && !JSON.stringify(stanPo429).includes('example.com') && !JSON.stringify(stanPo429).includes(TOKEN));

    atrapa.wyczysc();
    const siec = await zDziennikiem(() => poczta.wyslij({ do: 'ola+atrapa-siec@example.com', szablon: 'reset', dane: DANE.reset }, konf));
    sprawdz('resend: zerwane polaczenie -> ponowienie, potem { ok: false, blad: blad sieci }',
      siec.wynik.ok === false && siec.wynik.blad === 'blad sieci' && atrapa.ostatnie.length === 2);

    atrapa.wyczysc();
    const zlyKlucz = await zDziennikiem(() => poczta.wyslij({ do: 'ola@example.com', szablon: 'reset', dane: DANE.reset }, { ...konf, poczta: { ...konf.poczta, klucz: 're_zly' } }));
    const bezKlucza = await poczta.wyslij({ do: 'ola@example.com', szablon: 'reset', dane: DANE.reset }, { ...konf, poczta: { ...konf.poczta, klucz: '' } });
    sprawdz('resend: zly klucz (401) bez ponowienia; brak CAI_POCZTA_KLUCZ bez wywolania API',
      zlyKlucz.wynik.ok === false && /401/.test(zlyKlucz.wynik.blad) && atrapa.ostatnie.length === 1
      && bezKlucza.ok === false && /CAI_POCZTA_KLUCZ/.test(bezKlucza.blad) && atrapa.ostatnie.length === 1);

    // Zalaczniki (potwierdzenie umowy, PR8-31): tresc w base64 do Resend, nazwy bezpieczne, zle wpisy pominiete.
    atrapa.wyczysc();
    const zalaczniki = [...DANE['zakup-potwierdzenie'].zalaczniki, { nazwa: 'pusty.txt', typ: 'text/plain', tresc: '' }, { nazwa: '../zly nazwa.txt', typ: 'zly typ', tresc: 'x' }];
    const zZal = await zDziennikiem(() => poczta.wyslij({ do: 'ola@example.com', szablon: 'zakup-potwierdzenie', dane: { ...DANE['zakup-potwierdzenie'], zalaczniki } }, konf));
    const listZal = atrapa.poczta[0] || { zalaczniki: [] };
    const nazwyZal = listZal.zalaczniki.map((a) => a.filename);
    sprawdz(`resend: zalaczniki do Resend (base64, typ, nazwa bez ukosnikow), pusty pominiety (${nazwyZal.join(', ')})`,
      zZal.wynik.ok === true && nazwyZal.join(',') === 'content-ai-regulamin-pl.txt,content-ai-odstapienie-pl.txt,_zly_nazwa.txt'
      && listZal.zalaczniki[0].tekst === DANE['zakup-potwierdzenie'].zalaczniki[0].tresc && listZal.zalaczniki[1].tekst.includes('ODSTĄPIENIU')
      && listZal.zalaczniki[0].content_type === 'text/plain; charset=utf-8' && listZal.zalaczniki[2].content_type === 'application/octet-stream'
      && !listZal.text.includes('Paragraf 1') && /zalacznikow: 3/.test(zZal.dziennik));

    // Polecenie poczta-test: wysylka probna i kontrola sledzenia domen (PR8-27).
    const wyjscie = [];
    const kontekst = { KONF: konf, wypisz: (t) => wyjscie.push(t), blad: (t) => wyjscie.push('BLAD ' + t) };
    const kodOk = await zDziennikiem(() => poczta.cli('poczta-test', ['ola@example.com'], kontekst));
    const poOk = wyjscie.splice(0).join('\n');
    atrapa.KONF.sledzenie = true;
    const kodSledzenie = await zDziennikiem(() => poczta.cli('poczta-test', ['ola@example.com'], kontekst));
    const poSledzeniu = wyjscie.splice(0).join('\n');
    atrapa.KONF.sledzenie = false;
    const kodZly = await poczta.cli('poczta-test', ['nie-adres'], kontekst);
    sprawdz('poczta-test: wysylka probna (kod 0), sledzenie wylaczone potwierdzone; wlaczone sledzenie -> ostrzezenie; zly adres -> kod 1',
      kodOk.wynik === 0 && /Wysłano wiadomość próbną/.test(poOk) && /śledzenie otwarć i kliknięć wyłączone/.test(poOk)
      && kodSledzenie.wynik === 0 && /UWAGA: domena example\.com ma włączone śledzenie/.test(poSledzeniu) && kodZly === 1);
  } finally {
    atrapa.KONF.sledzenie = false;
    await new Promise((r) => serwer.close(r));
  }
}

async function testySerwera({ sprawdz }) {
  console.log('\n  poczta: konfiguracja serwera i /api/status');
  const poczta = require('./poczta.js');
  const atrapa = require('../narzedzia/atrapa/poczta.js');
  atrapa.wyczysc();
  const serwerPoczty = atrapa.uruchom(0);
  await new Promise((r) => (serwerPoczty.listening ? r() : serwerPoczty.once('listening', r)));
  const t = await uruchomSerwer({
    srodowisko: {
      CAI_POCZTA: 'resend', CAI_POCZTA_KLUCZ: 're_atrapa', CAI_POCZTA_OD: 'Content AI <konto@example.com>',
      CAI_POCZTA_URL: `http://127.0.0.1:${serwerPoczty.address().port}`, CAI_ADRES_PUBLICZNY: 'https://app.example.com',
    },
  });
  try {
    t.srv.sprawdzKonfiguracje();
    const wynik = await zDziennikiem(() => poczta.wyslij({ do: 'ola@example.com', szablon: 'potwierdzenie', dane: DANE.potwierdzenie }, t.KONF));
    const admin = await t.zaloguj('admin');
    const status = await (await t.zadanie('/api/status', { headers: { cookie: admin } })).json();
    const plik = t.poczta();
    sprawdz('serwer: CAI_POCZTA=resend z kluczem i nadawca wlacza funkcje poczta; wysylka idzie do API z konfiguracji serwera',
      t.KONF.funkcje.poczta.wlaczona === true && wynik.wynik.ok === true && atrapa.poczta.length === 1
      && atrapa.poczta[0].text.includes('app.example.com'));
    sprawdz('serwer: /api/status.poczta (tryb, wyslanych, bledow) bez klucza, adresow i odnosnikow; kopia w CAI_POCZTA_LOG',
      status.poczta && status.poczta.tryb === 'resend' && status.poczta.wyslanych >= 1 && typeof status.poczta.bledow === 'number'
      && !JSON.stringify(status.poczta).includes('re_atrapa') && !JSON.stringify(status.poczta).includes(TOKEN)
      && plik.length === 1 && plik[0].dane.odnosnik === ODNOSNIK && plik[0].tryb === 'resend');
    // Sekcje C w /api/status obok dzisiejszych: klucze serwera (tak/nie) zostaja pod "klucze".
    sprawdz('serwer: /api/status ma dzisiejsze "klucze" (klucze serwera tak/nie) oraz kluczeUzytkownikow i zadania (bez wartosci)',
      status.klucze && status.klucze.anthropic === true && status.klucze.openai === true
      && status.kluczeUzytkownikow && typeof status.kluczeUzytkownikow.zapis === 'boolean'
      && status.zadania && status.zadania.budzetBajtow > 0 && !JSON.stringify(status).includes('re_atrapa'));
  } finally {
    await t.zamknij();
    await new Promise((r) => serwerPoczty.close(r));
  }
}

async function uruchom({ sprawdz }) {
  testySzablonow({ sprawdz });
  testyUmowy({ sprawdz });
  await testyLog({ sprawdz });
  await testyResend({ sprawdz });
  await testySerwera({ sprawdz });
}

module.exports = { uruchom };
