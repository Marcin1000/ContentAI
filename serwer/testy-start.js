'use strict';

// ─── Testy: pierwszy artykul bez klucza (serwer/start.js, 14.10.2026) ─────────
//
// Konto samoobslugowe na wlasnych kluczach pisze pierwszy artykul bez klucza Anthropic, na OSOBNYM kluczu
// startu (CAI_START_KLUCZ), nigdy na ANTHROPIC_KEY zespolu. Kontrole: potwierdzony e-mail, jeden artykul,
// sufit wywolan, dzienna pula, jeden przydzial na adres (takze po usunieciu konta, +dopisek i kropki Gmaila),
// konto z wlasnym kluczem i konto zespolu bez zmian, zwrot po bledzie dostawcy i po odmowie modelu, blad
// rozliczen i odrzucony klucz startu wstrzymuja start (uzytkownik dostaje kreator klucza, nie nasz rachunek),
// CAI_START=0, zly format klucza, zadanie w tle, SERP poza pakietem bez zuzycia, /api/status bez klucza,
// e-mail powitalny, CLI (start, start-usun) i sprzatanie po roku.
// Wolane z serwer/testy.js: require('./testy-start.js').uruchom({ sprawdz }).

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { uruchomSerwer } = require('./testy-wspolne.js');
const konta = require('./konta.js');
const startBezKlucza = require('./start.js');
const szablony = require('./poczta-szablony.js');
const WERSJE = require('./dokumenty-prawne.js').wersje();

const KLUCZ_CIASTEK = crypto.randomBytes(32).toString('base64');
const SERWER = { ANTHROPIC_KEY: 'SERWER-anthropic-0000000000000000000', OPENAI_KEY: 'SERWER-openai-0000000000000000000000' };
const START = 'sk-ant-api03-START-' + 'd'.repeat(40);
const KLUCZ_UZYTKOWNIKA = 'sk-ant-api03-UZYTKOWNIK-' + 'a'.repeat(40);
const DOBA = 24 * 3600_000;

const ARTYKUL = (znacznik = '') => JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 50, messages: [{ role: 'user', content: `Napisz artykul o pompach ciepla ${znacznik}` }] });
const POMOCNICZE = (znacznik = '') => JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 50, messages: [{ role: 'user', content: `Krotka ocena tekstu ${znacznik}` }] });
const SERP_CIALO = JSON.stringify({
  model: 'claude-sonnet-5', max_tokens: 500, tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  system: 'Write the context in Polish. Search for top Google results for the given keyword.',
  messages: [{ role: 'user', content: 'Keyword: pompa ciepla\nSearch' }],
});

async function noweKonto(t, email, { potwierdzone = true, plan = 'darmowy' } = {}) {
  const h = t.srv.zahaszuj(t.HASLO);
  const konto = t.magazyn.utworzOrganizacjeIKonto({ email, hash: h.hash, sol: h.sol, jezyk: 'pl', plan, zrodloKluczy: 'wlasne' });
  if (potwierdzone) t.magazyn.zmienKonto(konto.login, { emailPotwierdzony: Date.now() });
  return { login: konto.login, sesja: await t.zaloguj(konto.login) };
}

function api(t, sesja, cialo, { artykul = false, inne = {} } = {}) {
  return t.zadanie('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...t.zWlasnej, cookie: sesja, ...(artykul ? { 'X-CAI-Czynnosc': 'artykul' } : {}), ...inne },
    body: cialo,
  });
}

async function stanKluczy(t, sesja) {
  const odp = await t.zadanie('/api/klucze', { headers: { cookie: sesja } });
  return odp.json();
}

async function json(odp) {
  return odp.json().catch(() => ({}));
}

/** Atrapa z zapisem kluczy autoryzacji: kazde wywolanie ma pole klucz. */
function atrapaZKluczami(t) {
  const modul = require('../narzedzia/atrapa/dostawcy.js');
  const przed = { zapisujKlucze: modul.KONF.zapisujKlucze, dziennik: modul.KONF.dziennik };
  modul.KONF.zapisujKlucze = true;
  modul.KONF.dziennik = path.join(t.katalog, 'atrapa-wywolania.log');
  modul.ostatnie.length = 0;
  return {
    wywolania: () => modul.ostatnie.filter((w) => /\/messages$/.test(w.sciezka || '')).slice(),
    wyczysc: () => { modul.ostatnie.length = 0; },
    przywroc: () => Object.assign(modul.KONF, przed),
  };
}

// ─── Glowny scenariusz: bezpieczniki na jednym serwerze ──────────────────────

async function testyBezpiecznikow({ sprawdz }) {
  console.log('\n  pierwszy artykul bez klucza: osobny klucz startu, e-mail, jeden artykul, sufit wywolan, dzienna pula, usuniecie konta');
  const t = await uruchomSerwer({
    srodowisko: { ...SERWER, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_START_KLUCZ: START, CAI_START_DZIENNIE: '3', CAI_START_WYWOLAN: '4', CAI_SERP: 'model' },
    atrapaDostawcow: true,
  });
  const a = atrapaZKluczami(t);
  try {
    const fStart = t.KONF.funkcje.start || { bledy: [] };
    sprawdz('konfiguracja: start wlaczony z poprawnym kluczem, bez bledow', fStart.wlaczona === true && fStart.bledy.length === 0);

    // 1. Niepotwierdzony e-mail: odmowa z powodem, bez wywolania dostawcy.
    const nowa = await noweKonto(t, 'nowa@start.example', { potwierdzone: false });
    const bezPotw = await api(t, nowa.sesja, ARTYKUL(), { artykul: true });
    const bezPotwJ = await json(bezPotw);
    const stanNowej = await stanKluczy(t, nowa.sesja);
    sprawdz('niepotwierdzony adres: 403 brak-klucza z start "email", bez wywolania dostawcy; /api/klucze: start { dostepny: false, powod: email }',
      bezPotw.status === 403 && bezPotw.headers.get('x-cai-kod') === 'brak-klucza' && bezPotwJ.start === 'email' && bezPotwJ.dostawca === 'anthropic'
      && a.wywolania().length === 0 && stanNowej.start && (stanNowej.start || {}).dostepny === false && (stanNowej.start || {}).powod === 'email');

    // 2. Potwierdzony: pierwszy artykul na kluczu startu (nie ANTHROPIC_KEY), naglowek X-CAI-Start, licznik pakietu.
    const ewa = await noweKonto(t, 'ewa@start.example');
    const przed = await stanKluczy(t, ewa.sesja);
    sprawdz('potwierdzony adres bez klucza: /api/klucze start { dostepny, artykul, zostalo 4, do: null }',
      przed.start && (przed.start || {}).dostepny === true && (przed.start || {}).artykul === true && (przed.start || {}).zostalo === 4 && (przed.start || {}).do === null);
    const art = await api(t, ewa.sesja, ARTYKUL(), { artykul: true });
    const artJ = await json(art);
    const w1 = a.wywolania();
    sprawdz('pierwszy artykul: 200 z tekstem, wywolanie na kluczu startu (nie ANTHROPIC_KEY zespolu), naglowek X-CAI-Start',
      art.status === 200 && Array.isArray(artJ.content) && w1.length === 1 && w1[0].klucz === START && art.headers.get('x-cai-start') === '1');
    const po = await stanKluczy(t, ewa.sesja);
    sprawdz('po artykule: start { dostepny, artykul: false, zostalo 3, do = koniec okna }, licznik artykulow pakietu = 1',
      (po.start || {}).dostepny === true && (po.start || {}).artykul === false && (po.start || {}).zostalo === 3 && (po.start || {}).do > Date.now() + 100 * 60_000
      && t.magazyn.uzycie(ewa.login, 'zawsze').artykul === 1);

    // 3. Drugi artykul: odmowa przed wywolaniem; wywolanie pomocnicze (ocena, Fakty) dalej na starcie.
    a.wyczysc();
    const drugi = await api(t, ewa.sesja, ARTYKUL(), { artykul: true });
    const drugiJ = await json(drugi);
    sprawdz('drugi artykul: 403 brak-klucza z start "wykorzystany", bez wywolania dostawcy, licznik pakietu bez zmian',
      drugi.status === 403 && drugiJ.start === 'wykorzystany' && a.wywolania().length === 0 && t.magazyn.uzycie(ewa.login, 'zawsze').artykul === 1);
    const pom = await api(t, ewa.sesja, POMOCNICZE());
    sprawdz('wywolanie pomocnicze po artykule (ocena, Fakty): 200 na kluczu startu',
      pom.status === 200 && a.wywolania().length === 1 && a.wywolania()[0].klucz === START);

    // 4. Blad dostawcy (nic nie kosztowal): wywolanie wraca do przydzialu, odpowiedz bez zmian.
    const skrotEwy = startBezKlucza.skrot('ewa@start.example');
    const przedBledem = (t.magazyn.startPrzydzial(skrotEwy) || {}).wywolan;
    const blad = await api(t, ewa.sesja, POMOCNICZE('[atrapa:500]'));
    sprawdz('blad dostawcy (HTTP 500): odpowiedz dostawcy bez zmian, wywolanie oddane do przydzialu',
      blad.status === 500 && (t.magazyn.startPrzydzial(skrotEwy) || {}).wywolan === przedBledem);

    // 4a. Limit zapytan (429) naszego obszaru startu: neutralne przeciazenie (529) bez tresci dostawcy, wywolanie oddane.
    const limit = await api(t, ewa.sesja, POMOCNICZE('[atrapa:429]'));
    const limitTekst = await limit.text();
    sprawdz('429 na kluczu startu: 529 overloaded_error bez tresci dostawcy (nie "limit Twojego konta"), wywolanie oddane',
      limit.status === 529 && /"overloaded_error"/.test(limitTekst) && !/rate limit|organization/i.test(limitTekst)
      && (t.magazyn.startPrzydzial(skrotEwy) || {}).wywolan === przedBledem);

    // 5. Sufit wywolan: 4 na przydzial (2 zuzyte), potem odmowa.
    const r3 = await api(t, ewa.sesja, POMOCNICZE());
    const r4 = await api(t, ewa.sesja, POMOCNICZE());
    a.wyczysc();
    const r5 = await api(t, ewa.sesja, POMOCNICZE());
    const r5J = await json(r5);
    const poSuficie = await stanKluczy(t, ewa.sesja);
    sprawdz('sufit wywolan (CAI_START_WYWOLAN=4): 3. i 4. przechodza, 5. -> 403 start "wykorzystany" bez wywolania; /api/klucze powod wykorzystany',
      r3.status === 200 && r4.status === 200 && r5.status === 403 && r5J.start === 'wykorzystany' && a.wywolania().length === 0
      && (poSuficie.start || {}).dostepny === false && (poSuficie.start || {}).powod === 'wykorzystany');

    // 6. Wlasny klucz: idzie klucz uzytkownika, bez przydzialu i bez pola start.
    const ola = await noweKonto(t, 'ola@start.example');
    const zapis = await t.zadanie('/api/klucze', t.json(ola.sesja, { dostawca: 'anthropic', klucz: KLUCZ_UZYTKOWNIKA }));
    const ciastko = (zapis.headers.getSetCookie() || []).map((c) => c.split(';')[0]).filter((c) => /^cai_k_a=/.test(c));
    a.wyczysc();
    const zKluczem = await api(t, `${ola.sesja}; ${ciastko[0]}`, ARTYKUL(), { artykul: true });
    const stanOli = await stanKluczy(t, `${ola.sesja}; ${ciastko[0]}`);
    sprawdz('konto z wlasnym kluczem: artykul na kluczu uzytkownika, bez przydzialu startu, bez naglowka X-CAI-Start i bez pola start',
      zKluczem.status === 200 && a.wywolania().length === 1 && a.wywolania()[0].klucz === KLUCZ_UZYTKOWNIKA && !zKluczem.headers.get('x-cai-start')
      && t.magazyn.startPrzydzial(startBezKlucza.skrot('ola@start.example')) === null && stanOli.start === undefined);

    // 7. Konto zespolu: klucz serwera jak dzis, nigdy klucz startu.
    const std = await t.zaloguj('standard');
    a.wyczysc();
    const zespol = await api(t, std, ARTYKUL(), { artykul: true });
    const stanZespolu = await stanKluczy(t, std);
    sprawdz('konto zespolu: klucz serwera (ANTHROPIC_KEY), nie klucz startu; /api/klucze bez pola start',
      zespol.status === 200 && a.wywolania().length === 1 && a.wywolania()[0].klucz === SERWER.ANTHROPIC_KEY && stanZespolu.start === undefined);

    // 8. SERP poza pakietem (Darmowy): 402 przed przydzialem - nie zabiera wywolania i nie zaklada przydzialu.
    const jan = await noweKonto(t, 'Jan.Nowak@gmail.com');
    a.wyczysc();
    const serp = await t.zadanie('/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...t.zWlasnej, cookie: jan.sesja }, body: SERP_CIALO });
    sprawdz('SERP poza pakietem Darmowy: 402 funkcja-poza-pakietem bez wywolania i bez przydzialu startu',
      serp.status === 402 && a.wywolania().length === 0 && t.magazyn.startPrzydzial(startBezKlucza.skrot('jan.nowak@gmail.com')) === null);

    // 9. Zadanie w tle (X-Zadanie, telefon): artykul na kluczu startu, naglowek X-CAI-Start w odebranym wyniku.
    const tlo = await api(t, jan.sesja, ARTYKUL(), { artykul: true, inne: { 'x-zadanie': 'start-tlo-' + crypto.randomBytes(4).toString('hex') } });
    sprawdz('zadanie w tle (X-Zadanie): 200 na kluczu startu z naglowkiem X-CAI-Start',
      tlo.status === 200 && tlo.headers.get('x-cai-start') === '1' && a.wywolania().length === 1 && a.wywolania()[0].klucz === START);

    // 10. Usuniecie konta i nowe konto na ten sam adres (+dopisek, Googlemail, kropki): przydzial zostaje.
    t.magazyn.usunKonto(jan.login, { powod: 'uzytkownik', emailSkrot: t.srv.skrotEmaila('Jan.Nowak@gmail.com') });
    const jan2 = await noweKonto(t, 'jannowak+drugie@googlemail.com');
    a.wyczysc();
    const ponowny = await api(t, jan2.sesja, ARTYKUL(), { artykul: true });
    const ponownyJ = await json(ponowny);
    sprawdz('nowe konto po usunieciu (ten sam adres z +dopiskiem, googlemail, bez kropek): 403 start "wykorzystany", bez wywolania',
      ponowny.status === 403 && ponownyJ.start === 'wykorzystany' && a.wywolania().length === 0);

    // 11. Dzienna pula (CAI_START_DZIENNIE=3): ewa i jan to dwa przydzialy dnia, iga trzeci, zofia juz poza pula.
    const iga = await noweKonto(t, 'iga@start.example');
    const igaArt = await api(t, iga.sesja, ARTYKUL(), { artykul: true });
    const zofia = await noweKonto(t, 'zofia@start.example');
    a.wyczysc();
    const poPuli = await api(t, zofia.sesja, ARTYKUL(), { artykul: true });
    const poPuliJ = await json(poPuli);
    const stanZofii = await stanKluczy(t, zofia.sesja);
    sprawdz('dzienna pula (3): trzeci przydzial dnia przechodzi, czwarty -> 403 start "pula" bez wywolania; /api/klucze powod pula',
      igaArt.status === 200 && poPuli.status === 403 && poPuliJ.start === 'pula' && a.wywolania().length === 0
      && (stanZofii.start || {}).dostepny === false && (stanZofii.start || {}).powod === 'pula' && t.magazyn.startLiczby(new Date().toISOString().slice(0, 10)).dzien === 3);

    // 12. Konto, ktore ma juz artykul (pisalo na wlasnym kluczu i go usunelo): start go nie dotyczy.
    const piotr = await noweKonto(t, 'piotr@start.example');
    t.magazyn.ustawUzycie(piotr.login, 'zawsze', 'artykul', 1);
    const piotrOdp = await api(t, piotr.sesja, POMOCNICZE());
    const piotrJ = await json(piotrOdp);
    const stanPiotra = await stanKluczy(t, piotr.sesja);
    sprawdz('konto z artykulem: 403 brak-klucza bez pola start (zwykly kreator klucza), /api/klucze bez pola start',
      piotrOdp.status === 403 && piotrJ.start === undefined && stanPiotra.start === undefined);

    // 12a. Regulamin: przy CAI_REGULAMIN_WERSJA start wymaga akceptacji tej wersji (konto sprzed zmiany: najpierw akceptacja).
    t.KONF.regulaminWersja = '2026-10-v3';
    const marek = await noweKonto(t, 'marek@start.example');
    t.magazyn.zmienKonto(marek.login, { regulaminWersja: '2026-10-v2', regulaminCzas: Date.now() });
    a.wyczysc();
    const stary = await api(t, marek.sesja, POMOCNICZE());
    const staryJ = await json(stary);
    const stanMarka = await stanKluczy(t, marek.sesja);
    t.magazyn.zmienKonto(marek.login, { regulaminWersja: '2026-10-v3', regulaminCzas: Date.now() });
    const poAkceptacji = await stanKluczy(t, marek.sesja);
    t.KONF.regulaminWersja = '';
    // Pula dnia jest juz pelna (krok 11), wiec po akceptacji kolejna kontrola to pula, a nie regulamin.
    sprawdz('regulamin starszy niz CAI_REGULAMIN_WERSJA: 403 start "regulamin" bez wywolania; po akceptacji aktualnej wersji regulamin juz nie blokuje (dalej pula dnia)',
      stary.status === 403 && staryJ.start === 'regulamin' && a.wywolania().length === 0 && (stanMarka.start || {}).powod === 'regulamin'
      && poAkceptacji.start && (poAkceptacji.start || {}).powod === 'pula');

    // 13. Prywatnosc: przydzial pod skrotem (bez adresu i loginu), innym niz skrot konta usunietego.
    const sk = startBezKlucza.skrot('ewa@start.example');
    const p13 = t.magazyn.startPrzydzial(sk);
    sprawdz('przydzial pod skrotem HMAC (bez adresu i loginu), innym niz skrot konta usunietego (osobny przedrostek)',
      typeof sk === 'string' && sk.length >= 40 && !sk.includes('@') && sk !== t.srv.skrotEmaila('ewa@start.example')
      && startBezKlucza.skrot('EWA+promo@Start.Example') === sk && p13 && Object.keys(p13).sort().join(',') === 'artykulow,dzien,od,wywolan');

    // 14. /api/status: sekcja startu bez wartosci klucza.
    const admin = await t.zaloguj('admin');
    const status = await (await t.zadanie('/api/status', { headers: { cookie: admin } })).json();
    const tekstStatusu = JSON.stringify(status);
    sprawdz('/api/status: startBezKlucza (wlaczony, dzis 3 z 3, liczniki) bez wartosci klucza startu',
      status.startBezKlucza && status.startBezKlucza.wlaczony === true && status.startBezKlucza.dzis === 3 && status.startBezKlucza.dziennie === 3
      && status.startBezKlucza.odStartuProcesu.przydzialow === 3 && !tekstStatusu.includes(START) && !tekstStatusu.includes('START-ddd'));

    // 15. Odmowa modelu (filtr): sztuka artykulu wraca, wywolanie liczy sie jak kazde inne.
    const lena = await noweKonto(t, 'lena@start.example');
    t.magazyn.startUsun(startBezKlucza.skrot('iga@start.example'));   // miejsce w puli dla leny (CLI start-usun)
    t.magazyn.startUsun(startBezKlucza.skrot('ewa@start.example'));
    const odmowa = await api(t, lena.sesja, ARTYKUL('[atrapa:odmowa=cala]'), { artykul: true });
    const pLeny = t.magazyn.startPrzydzial(startBezKlucza.skrot('lena@start.example'));
    sprawdz('odmowa modelu (stop_reason refusal): 200, sztuka artykulu startu oddana, wywolanie policzone',
      odmowa.status === 200 && pLeny && pLeny.artykulow === 0 && pLeny.wywolan === 1);

    // 16. Sprzatanie: przydzial sprzed ponad roku znika, swiezy zostaje.
    t.magazyn.startWywolanie('stary-skrot-testu', {
      teraz: Date.now() - 366 * DOBA, dzien: '2025-10-01', pulaDzienna: 99, maxWywolan: 4, oknoMs: 3600_000, artykul: true,
    });
    const sprz = t.magazyn.sprzataj();
    sprawdz('sprzatanie: przydzial starszy niz rok usuniety (adres moze znow dostac start), swiezy zostaje',
      sprz.start === 1 && t.magazyn.startPrzydzial('stary-skrot-testu') === null && t.magazyn.startPrzydzial(startBezKlucza.skrot('lena@start.example')) !== null);
  } finally {
    a.przywroc();
    await t.zamknij();
  }
}

// ─── Rownolegle zapytania: jeden artykul, pula bez przekroczenia ─────────────

async function testyRownoleglosci({ sprawdz }) {
  console.log('\n  pierwszy artykul bez klucza: rownolegle zapytania nie omijaja jednego artykulu ani puli');
  const t = await uruchomSerwer({
    srodowisko: { ...SERWER, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_START_KLUCZ: START, CAI_START_DZIENNIE: '2', CAI_START_WYWOLAN: '10' },
    atrapaDostawcow: true,
  });
  const a = atrapaZKluczami(t);
  try {
    const ala = await noweKonto(t, 'ala@start.example');
    const naraz = await Promise.all([1, 2, 3].map(() => api(t, ala.sesja, ARTYKUL('[atrapa:opoznienie=150]'), { artykul: true })));
    const statusy = naraz.map((o) => o.status).sort();
    sprawdz(`trzy artykuly naraz z jednego konta: dokladnie jeden 200, reszta 403 (statusy ${statusy.join(',')}), licznik pakietu 1`,
      statusy.join(',') === '200,403,403' && t.magazyn.uzycie(ala.login, 'zawsze').artykul === 1 && a.wywolania().length === 1);

    const osoby = await Promise.all(['b1', 'b2', 'b3'].map((n) => noweKonto(t, `${n}@start.example`)));
    const wyniki = await Promise.all(osoby.map((o) => api(t, o.sesja, ARTYKUL(), { artykul: true })));
    const ok = wyniki.filter((o) => o.status === 200).length;
    sprawdz(`pula 2 na dobe, trzy nowe osoby naraz (pierwszy przydzial dnia juz byl): jedna przechodzi, dwie dostaja 403 "pula" (przeszlo ${ok})`,
      ok === 1 && t.magazyn.startLiczby(new Date().toISOString().slice(0, 10)).dzien === 2);
  } finally {
    a.przywroc();
    await t.zamknij();
  }
}

// ─── Blad rozliczen i odrzucony klucz startu: wstrzymanie do konca doby ──────

async function testyWstrzymania({ sprawdz }) {
  console.log('\n  pierwszy artykul bez klucza: limit wydatkow i odrzucony klucz startu wstrzymuja start (kreator zamiast naszego rachunku)');
  for (const [opis, klucz, powod] of [
    ['limit wydatkow (400 credit balance)', 'sk-ant-api03-START-bez-srodkow-' + 'e'.repeat(30), /limit wydatkow/],
    ['odrzucony klucz startu (401)', 'sk-ant-api03-START-zly-' + 'f'.repeat(30), /odrzucil klucz startu/],
  ]) {
    const t = await uruchomSerwer({ srodowisko: { ...SERWER, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_START_KLUCZ: klucz }, atrapaDostawcow: true });
    const a = atrapaZKluczami(t);
    try {
      const ewa = await noweKonto(t, 'ewa@start.example');
      const odp = await api(t, ewa.sesja, ARTYKUL(), { artykul: true });
      const j = await json(odp);
      const p = t.magazyn.startPrzydzial(startBezKlucza.skrot('ewa@start.example'));
      sprawdz(`${opis}: uzytkownik dostaje 403 brak-klucza z start "pula" (nie blad naszego rachunku), wywolanie i artykul oddane`,
        odp.status === 403 && odp.headers.get('x-cai-kod') === 'brak-klucza' && j.start === 'pula' && !/credit|balance|x-api-key/i.test(JSON.stringify(j))
        && a.wywolania().length === 1 && p && p.wywolan === 0 && p.artykulow === 0 && !t.magazyn.uzycie(ewa.login, 'zawsze').artykul);
      const jan = await noweKonto(t, 'jan@start.example');
      a.wyczysc();
      const kolejna = await api(t, jan.sesja, ARTYKUL(), { artykul: true });
      const kolejnaJ = await json(kolejna);
      const stanEwy = await stanKluczy(t, ewa.sesja);
      const admin = await t.zaloguj('admin');
      const st = (await (await t.zadanie('/api/status', { headers: { cookie: admin } })).json()).startBezKlucza;
      sprawdz(`${opis}: start wstrzymany do konca doby UTC - kolejne osoby i trwajace przydzialy dostaja "pula" bez wywolania, /api/status pokazuje powod`,
        kolejna.status === 403 && kolejnaJ.start === 'pula' && a.wywolania().length === 0 && (stanEwy.start || {}).powod === 'pula'
        && st.wstrzymanyDo === (Math.floor(Date.now() / DOBA) + 1) * DOBA && powod.test(st.powodWstrzymania));
    } finally {
      a.przywroc();
      await t.zamknij();
    }
  }
}

// ─── Konfiguracja: wylacznik, zly format, ten sam klucz co zespol, CLI ───────

async function testyKonfiguracji({ sprawdz }) {
  console.log('\n  pierwszy artykul bez klucza: CAI_START=0, format klucza, ten sam klucz co zespol, CLI');
  {
    const t = await uruchomSerwer({ srodowisko: { ...SERWER, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_START_KLUCZ: START, CAI_START: '0' }, atrapaDostawcow: true });
    try {
      const ewa = await noweKonto(t, 'ewa@start.example');
      const odp = await api(t, ewa.sesja, ARTYKUL(), { artykul: true });
      const j = await json(odp);
      const s = await stanKluczy(t, ewa.sesja);
      const f = t.KONF.funkcje.start || { ostrzezenia: [], bledy: [] };
      sprawdz('CAI_START=0: zwykla odmowa brak-klucza bez pola start, /api/klucze bez start, funkcja niezadana z ostrzezeniem w dzienniku',
        odp.status === 403 && j.start === undefined && s.start === undefined && f.zadana === false && f.wlaczona === false
        && f.ostrzezenia.some((o) => /CAI_START=0/.test(o)) && startBezKlucza.wlaczony() === false);
    } finally {
      await t.zamknij();
    }
  }
  {
    const t = await uruchomSerwer({ srodowisko: { ...SERWER, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_START_KLUCZ: 'WSTAW_TUTAJ_KLUCZ_STARTU' }, atrapaDostawcow: true });
    try {
      const ewa = await noweKonto(t, 'ewa@start.example');
      const odp = await api(t, ewa.sesja, ARTYKUL(), { artykul: true });
      const f = t.KONF.funkcje.start || { ostrzezenia: [], bledy: [] };
      sprawdz('CAI_START_KLUCZ w zlym formacie (WSTAW_TUTAJ_...): funkcja wylaczona z bledem bez wartosci klucza, odmowa brak-klucza',
        f.zadana === true && f.wlaczona === false && f.bledy.length === 1 && !f.bledy[0].includes('WSTAW') && t.KONF.start.klucz === ''
        && odp.status === 403);
    } finally {
      await t.zamknij();
    }
  }
  {
    const t = await uruchomSerwer({ srodowisko: { ...SERWER, ANTHROPIC_KEY: START, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_START_KLUCZ: START }, atrapaDostawcow: true });
    try {
      const f = t.KONF.funkcje.start || { ostrzezenia: [], bledy: [] };
      sprawdz('CAI_START_KLUCZ rowny ANTHROPIC_KEY: dziala, ale z ostrzezeniem o wspolnym limicie wydatkow',
        f.wlaczona === true && f.ostrzezenia.some((o) => /ten sam klucz co ANTHROPIC_KEY/.test(o)));
      // CLI: start i start-usun na tej samej bazie i tym samym sekrecie co serwer.
      await noweKonto(t, 'cli@start.example');
      const ewa = await noweKonto(t, 'ewa@start.example');
      await api(t, ewa.sesja, ARTYKUL(), { artykul: true });
      const env = { ...process.env, CAI_START_KLUCZ: START };
      const cli = (...arg) => spawnSync(process.execPath, [path.join(__dirname, 'uzytkownicy.js'), ...arg], { env, encoding: 'utf8' });
      const s = cli('start');
      sprawdz('CLI start: wlaczony, pula 20 dziennie, dzis 1 przydzial, bez wartosci klucza',
        s.status === 0 && /włączony/.test(s.stdout) && /dziś \(doba UTC\):\s+1 z 20/.test(s.stdout) && !s.stdout.includes(START));
      const u = cli('start-usun', 'Ewa+cokolwiek@start.example');
      const u2 = cli('start-usun', 'ewa@start.example');
      sprawdz('CLI start-usun: usuwa przydzial adresu (adres kanoniczny), drugi raz mowi, ze go nie ma',
        u.status === 0 && /Usunięto przydział/.test(u.stdout) && u2.status === 0 && /nie ma przydziału/.test(u2.stdout)
        && t.magazyn.startPrzydzial(startBezKlucza.skrot('ewa@start.example')) === null);
    } finally {
      await t.zamknij();
    }
  }
}

// ─── E-mail powitalny: pierwszy artykul bez klucza ───────────────────────────

async function testyPowitania({ sprawdz }) {
  console.log('\n  pierwszy artykul bez klucza: e-mail powitalny po potwierdzeniu adresu (PL i EN)');
  const srodowisko = {
    ...SERWER, CAI_START_KLUCZ: START,
    CAI_REJESTRACJA: '1', CAI_ADRES_PUBLICZNY: 'https://app.example.com',
    CAI_USLUGODAWCA_IMIE_NAZWISKO: 'Jan Testowy', CAI_USLUGODAWCA_ADRES: 'ul. Testowa 1, 00-001 Warszawa',
    CAI_USLUGODAWCA_EMAIL: 'kontakt@example.com', CAI_REGULAMIN_WERSJA: WERSJE.regulamin, CAI_POLITYKA_WERSJA: WERSJE.prywatnosc,
    CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK,
  };
  const t = await uruchomSerwer({ srodowisko, atrapaDostawcow: true });
  try {
    let ip = 0;
    const zarejestruj = (email, jezyk = 'pl') => t.zadanie('/rejestracja', t.formularz(null, {
      jezyk, t: konta.znacznikFormularza(t.srv.podpisz, Date.now() - 5000), strona: '', email, haslo: 'mocne-haslo-do-testu-42',
      zgoda_regulamin: '1', zgoda_wiek: '1',
    }, { 'x-real-ip': `10.77.${(ip += 1)}.7` }));
    const potwierdz = async (email) => {
      const list = t.poczta().filter((w) => w.do === email && w.szablon === 'potwierdzenie').pop();
      const token = list && list.dane && list.dane.odnosnik ? new URL(list.dane.odnosnik).searchParams.get('t') : '';
      await t.zadanie('/potwierdz', t.formularz(null, { t: token }));
      await konta.czekajNaTlo();
      return t.poczta().filter((w) => w.do === email && w.szablon === 'powitanie').pop() || { dane: {} };
    };
    await zarejestruj('ola@firma.pl');
    const pw = await potwierdz('ola@firma.pl');
    const r = szablony.renderuj('powitanie', 'pl', pw.dane, { adresPubliczny: 'https://app.example.com' });
    const kolejnosc = r.tekst.indexOf('Wgraj do bazy') < r.tekst.indexOf('Kolejne artykuły powstają na Twoim kluczu');
    sprawdz('powitanie PL przy dostepnym starcie: bezKlucza, temat "pierwszy artykul napiszesz bez klucza", dokumenty i temat przed kluczem',
      pw.dane.bezKlucza === true && /bez klucza API/.test(r.temat) && r.tekst.includes('Do pierwszego artykułu są dwa kroki')
      && r.tekst.includes('1. Wgraj do bazy') && r.tekst.includes('2. Wpisz temat') && kolejnosc && !r.tekst.includes('3. '));
    await zarejestruj('amy@firma.pl', 'en');
    const list = t.poczta().filter((w) => w.do === 'amy@firma.pl' && w.szablon === 'potwierdzenie').pop();
    await t.zadanie('/potwierdz', t.formularz(null, { t: new URL(list.dane.odnosnik).searchParams.get('t'), jezyk: 'en' }));
    await konta.czekajNaTlo();
    const pwEn = t.poczta().filter((w) => w.do === 'amy@firma.pl' && w.szablon === 'powitanie').pop() || { dane: {} };
    const rEn = szablony.renderuj('powitanie', 'en', pwEn.dane, { adresPubliczny: 'https://app.example.com' });
    sprawdz('powitanie EN przy dostepnym starcie: "write your first article without an API key", klucz po krokach',
      pwEn.dane.bezKlucza === true && /without an API key/.test(rEn.temat) && rEn.tekst.indexOf('2. Enter a topic') < rEn.tekst.indexOf('Your next articles run on your own'));
    const bez = szablony.renderuj('powitanie', 'pl', { pakiet: 'Darmowy', artykulow: 3 }, { adresPubliczny: 'https://app.example.com' });
    sprawdz('powitanie bez startu (np. CAI_START=0): dawne trzy kroki z kluczem na poczatku',
      /trzy kroki/.test(bez.temat) && bez.tekst.includes('1. Podłącz klucz API Anthropic') && bez.tekst.includes('3. Wpisz temat'));
  } finally {
    await t.zamknij();
  }
}

// ─── Adres kanoniczny ────────────────────────────────────────────────────────

function testyAdresu({ sprawdz }) {
  console.log('\n  pierwszy artykul bez klucza: adres kanoniczny przydzialu');
  const k = startBezKlucza.emailKanoniczny;
  sprawdz('adres kanoniczny: male litery, bez +dopisku, Gmail i Googlemail bez kropek, inne domeny z kropkami',
    k(' Jan.Kowalski+promo@GoogleMail.com ') === 'jankowalski@gmail.com' && k('j.a.n@gmail.com') === 'jan@gmail.com'
    && k('A.B+x@Firma.pl') === 'a.b@firma.pl' && k('bez-malpy') === '' && k('@firma.pl') === '' && k('+tylko@firma.pl') === '+tylko@firma.pl');
}

async function uruchom({ sprawdz }) {
  testyAdresu({ sprawdz });
  await testyBezpiecznikow({ sprawdz });
  await testyRownoleglosci({ sprawdz });
  await testyWstrzymania({ sprawdz });
  await testyKonfiguracji({ sprawdz });
  await testyPowitania({ sprawdz });
}

module.exports = { uruchom };
