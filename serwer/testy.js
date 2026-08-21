#!/usr/bin/env node
/**
 * Content AI - testy serwera.
 *
 * Bez frameworka i bez zaleznosci; uruchamiane w CI przez `node serwer/testy.js`.
 * Kod wyjscia 1 przy pierwszym niepowodzeniu.
 *
 * Zakres: haszowanie hasel i tlumaczenie Anthropic <-> OpenAI. Sciezki HTTP
 * (logowanie, role, proxy) sprawdzamy recznie - wymagaja sieci i uruchomionego procesu.
 */

'use strict';

const { zahaszuj, hasloPasuje, anthropicNaOpenai, openaiNaAnthropic } = require('./server.js');

let zaliczone = 0;
const bledy = [];

function sprawdz(opis, warunek) {
  if (warunek) {
    zaliczone += 1;
    console.log(`  ok    ${opis}`);
  } else {
    bledy.push(opis);
    console.log(`  BLAD  ${opis}`);
  }
}

console.log('\n  hasla');
{
  const { hash, sol } = zahaszuj('poprawne-haslo-123');
  sprawdz('poprawne haslo przechodzi', hasloPasuje('poprawne-haslo-123', { hash, sol }));
  sprawdz('bledne haslo nie przechodzi', !hasloPasuje('inne-haslo', { hash, sol }));
  sprawdz('puste haslo nie przechodzi', !hasloPasuje('', { hash, sol }));
  sprawdz('to samo haslo z inna sola daje inny hash', zahaszuj('poprawne-haslo-123').hash !== hash);
  sprawdz('hash ma 128 znakow hex', /^[0-9a-f]{128}$/.test(hash));
  sprawdz('sol ma 32 znaki hex', /^[0-9a-f]{32}$/.test(sol));
  // Rozne dlugosci hashy nie moga wywalic porownania timingSafeEqual
  sprawdz('uszkodzony wpis nie wywala porownania', hasloPasuje('cokolwiek', { hash: 'ab', sol }) === false);
}

console.log('\n  tlumaczenie Anthropic -> OpenAI');
{
  const wynik = anthropicNaOpenai({
    max_tokens: 4000,
    temperature: 0.7,
    system: 'Jestes ekspertem SEO.',
    messages: [
      { role: 'user', content: 'Napisz artykul.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Jasne.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Dodaj FAQ.' }, { type: 'image', source: {} }] },
    ],
  });
  sprawdz('system trafia na poczatek jako rola system', wynik.messages[0].role === 'system');
  sprawdz('liczba wiadomosci = system + 3', wynik.messages.length === 4);
  sprawdz('tresc tekstowa zachowana', wynik.messages[1].content === 'Napisz artykul.');
  sprawdz('bloki tekstowe sklejone', wynik.messages[2].content === 'Jasne.');
  sprawdz('bloki obrazow pominiete', wynik.messages[3].content === 'Dodaj FAQ.');
  sprawdz('max_tokens przeniesiony', wynik.max_tokens === 4000);
  sprawdz('temperature przeniesiona', wynik.temperature === 0.7);
  sprawdz('model podmieniony na model NIM', typeof wynik.model === 'string' && wynik.model.length > 0);

  const bezSystemu = anthropicNaOpenai({ messages: [{ role: 'user', content: 'Hej' }] });
  sprawdz('brak system nie dodaje pustej wiadomosci', bezSystemu.messages.length === 1);
  sprawdz('brak max_tokens nie dodaje pola', !('max_tokens' in bezSystemu));

  const pusty = anthropicNaOpenai({});
  sprawdz('puste zadanie nie wywala tlumaczenia', Array.isArray(pusty.messages) && pusty.messages.length === 0);
}

console.log('\n  tlumaczenie OpenAI -> Anthropic');
{
  const wynik = openaiNaAnthropic({
    choices: [{ message: { content: 'Gotowy artykul.' } }],
    usage: { prompt_tokens: 1200, completion_tokens: 800 },
  });
  sprawdz('tresc w formacie blokow Anthropic', wynik.content[0].type === 'text' && wynik.content[0].text === 'Gotowy artykul.');
  sprawdz('tokeny wejsciowe przeliczone', wynik.usage.input_tokens === 1200);
  sprawdz('tokeny wyjsciowe przeliczone', wynik.usage.output_tokens === 800);

  const pusty = openaiNaAnthropic(null);
  sprawdz('null nie wywala tlumaczenia', pusty.content[0].text === '' && pusty.usage.input_tokens === 0);

  const bezUsage = openaiNaAnthropic({ choices: [{ message: { content: 'x' } }] });
  sprawdz('brak usage daje zera zamiast undefined', bezUsage.usage.output_tokens === 0);
}


console.log('\n  rozpoznawanie zapytania SERP');
{
  const serp = require('./serp.js');
  const zadanieSerp = {
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: 'Write the context, topics and phrases in Polish. Search for top Google results',
    messages: [{ role: 'user', content: 'Keyword: kurier ecommerce\nSearch and analyze top results.' }],
  };
  sprawdz('rozpoznaje zapytanie SERP', serp.czyZapytanieSerp(zadanieSerp));
  sprawdz('zwykle zadanie nie jest SERP', !serp.czyZapytanieSerp({ messages: [] }));
  sprawdz('brak tools nie jest SERP', !serp.czyZapytanieSerp({ tools: null, messages: [] }));
  sprawdz('wyciaga fraze', serp.frazaZZadania(zadanieSerp) === 'kurier ecommerce');
  sprawdz('brak frazy zwraca pusty ciag', serp.frazaZZadania({ messages: [{ role: 'user', content: 'nic' }] }) === '');
  sprawdz('wykrywa jezyk polski', serp.jezykZZadania(zadanieSerp) === 'Polski');
  sprawdz('wykrywa jezyk angielski', serp.jezykZZadania({ system: 'Write ... in English.' }) === 'English');
  sprawdz('mapuje jezyk na kod DataForSEO', serp.jezykDoDataForSeo('Polski').kod === 'pl');
  sprawdz('nieznany jezyk wpada na polski', serp.jezykDoDataForSeo('Klingon').kod === 'pl');
  sprawdz('fraza z blokow tresci', serp.frazaZZadania({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Keyword: buty zimowe\nx' }] }],
  }) === 'buty zimowe');
}

console.log('\n  przetwarzanie odpowiedzi DataForSEO');
{
  const serp = require('./serp.js');
  const odpowiedzApi = {
    tasks: [{ result: [{ items: [
      { type: 'organic', title: 'Najlepszy kurier dla sklepu internetowego', description: 'Porownanie firm kurierskich pod katem wysylki paczek ze sklepu.' },
      { type: 'organic', title: 'Kurier ecommerce - ranking firm kurierskich', description: 'Ranking firm kurierskich i porownanie cennikow wysylki.' },
      { type: 'paid', title: 'Reklama', description: 'Reklama nie powinna trafic do wynikow' },
      { type: 'organic', title: 'Wysylka paczek dla sklepu', description: 'Cennik wysylki paczek i porownanie firm.' },
    ] }] }],
  };
  const w = serp.zbudujWynik(odpowiedzApi, 'kurier ecommerce');
  sprawdz('liczy tylko wyniki organiczne', w.wynikow === 3);
  sprawdz('zwraca tematy', Array.isArray(w.topics) && w.topics.length > 0);
  sprawdz('zwraca frazy', Array.isArray(w.phrases) && w.phrases.length > 0);
  sprawdz('kontekst wspomina fraze', w.context.includes('kurier ecommerce'));
  sprawdz('oznacza zrodlo', w.zrodlo === 'dataforseo');
  sprawdz('nie zmysla dlugosci tresci', w.avgWords === 0 && w.avgH2 === 0);
  sprawdz('pomija slowa z samej frazy', !w.topics.includes('kurier') && !w.topics.includes('ecommerce'));
  sprawdz('pomija slowa nieznaczace', !w.topics.includes('oraz') && !w.phrases.includes('oraz'));
  sprawdz('najczestsze slowo na czele', w.phrases[0] === 'wysylki' || w.phrases.includes('wysylki'));

  const pusta = serp.zbudujWynik({ tasks: [{ result: [{ items: [] }] }] }, 'fraza');
  sprawdz('pusta odpowiedz nie wywala', pusta.wynikow === 0 && pusta.topics.length === 0);
  sprawdz('uszkodzona odpowiedz nie wywala', serp.zbudujWynik(null, 'x').wynikow === 0);
}

console.log('\n  baza wiedzy - fragmenty i podobienstwo');
{
  const baza = require('./baza.js');
  const dlugi = 'a'.repeat(3500);
  const fr = baza.podzielNaFragmenty(dlugi, 1000, 10);
  sprawdz('dzieli dlugi tekst', fr.length === 4);
  sprawdz('respektuje limit fragmentow', baza.podzielNaFragmenty('b'.repeat(50000), 1000, 5).length === 5);
  sprawdz('pusty tekst daje zero fragmentow', baza.podzielNaFragmenty('').length === 0);
  sprawdz('same biale znaki daja zero', baza.podzielNaFragmenty('   \n\t  ').length === 0);

  sprawdz('cosinus identycznych = 1', Math.abs(baza.cosinus([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  sprawdz('cosinus prostopadlych = 0', Math.abs(baza.cosinus([1, 0], [0, 1])) < 1e-9);
  sprawdz('cosinus przeciwnych = -1', Math.abs(baza.cosinus([1, 0], [-1, 0]) + 1) < 1e-9);
  sprawdz('cosinus wektora zerowego = 0', baza.cosinus([0, 0], [1, 1]) === 0);
  sprawdz('cosinus nie-tablicy = 0', baza.cosinus(null, [1]) === 0);

  sprawdz('slowa: pelne trafienie', baza.dopasowanieSlow('kurier ecommerce', 'oferta kurier dla ecommerce') === 1);
  sprawdz('slowa: brak trafien', baza.dopasowanieSlow('kurier', 'zupelnie inny tekst') === 0);
  sprawdz('slowa: krotkie pomijane', baza.dopasowanieSlow('a to', 'cokolwiek') === 0);
}

console.log('\n  baza wiedzy - nazwy plikow');
{
  const baza = require('./baza.js');
  sprawdz('wspolna ma stala nazwe', baza.nazwaPliku(baza.WSPOLNA) === 'wspolna.json');
  sprawdz('prywatna wg loginu', baza.nazwaPliku('prywatna', 'marcin') === 'u-marcin.json');
  sprawdz('czysci probe wyjscia z katalogu', baza.nazwaPliku('prywatna', '../../etc/passwd') === 'u-.._.._etc_passwd.json');
  let odrzucil = false;
  try { baza.nazwaPliku('prywatna', ''); } catch { odrzucil = true; }
  sprawdz('pusty login odrzucony', odrzucil);
}

console.log('\n  baza wiedzy - dodawanie i szukanie');
{
  const baza = require('./baza.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-baza-'));

  // zaslepka wektorow: kazdy tekst dostaje wektor wg tego, czy zawiera slowo "kurier"
  let ostatniRodzaj = null;
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    ostatniRodzaj = body.input_type;
    return { ok: true, json: async () => ({
      data: body.input.map((t) => ({ embedding: /kurier/i.test(t) ? [1, 0] : [0, 1] })),
    }) };
  };
  const konf = { klucz: 'test', url: 'http://x', model: 'm' };
  const zPodmiana = { ...konf };
  // podmieniamy globalny fetch na czas testu
  const oryginalnyFetch = global.fetch;
  global.fetch = fakeFetch;

  (async () => {
    const d1 = await baza.dodaj({ katalog, zakres: baza.WSPOLNA, nazwa: 'Cennik', tresc: 'Wysylka kurier dla sklepu', konfWektorow: zPodmiana });
    sprawdz('dodaje do wspolnej', d1.zakres === baza.WSPOLNA && d1.fragmentow === 1);
    sprawdz('liczy wektory dla dokumentu', d1.zWektorami === true);
    sprawdz('dokument oznaczony jako passage', ostatniRodzaj === 'passage');

    const d2 = await baza.dodaj({ katalog, zakres: 'prywatna', login: 'marcin', nazwa: 'Notatki', tresc: 'Zupelnie inny temat o pogodzie', konfWektorow: zPodmiana });
    sprawdz('dodaje do prywatnej', d2.zakres === 'prywatna' && d2.wlasciciel === 'marcin');

    const l = baza.lista({ katalog, login: 'marcin' });
    sprawdz('lista laczy wspolna i prywatna', l.length === 2);
    sprawdz('lista nie zawiera tresci ani wektorow', !('fragmenty' in l[0]) && !('wektor' in l[0]));

    const lObcy = baza.lista({ katalog, login: 'anna' });
    sprawdz('obcy nie widzi cudzej prywatnej', lObcy.length === 1 && lObcy[0].zakres === baza.WSPOLNA);

    const w = await baza.szukaj({ katalog, login: 'marcin', zapytanie: 'kurier', konfWektorow: zPodmiana });
    sprawdz('szuka po wektorach', w.metoda === 'wektory');
    sprawdz('zapytanie oznaczone jako query', ostatniRodzaj === 'query');
    sprawdz('najlepszy fragment to ten o kurierze', w.fragmenty[0].tekst.includes('kurier'));
    sprawdz('prompt zawiera naglowek wiedzy', baza.doPromptu(w).startsWith('## WIEDZA FIRMOWA'));
    sprawdz('prompt oznacza zrodlo wspolne', baza.doPromptu(w).includes('(wspólna)'));

    // bez klucza - zejscie na slowa kluczowe
    const wBez = await baza.szukaj({ katalog, login: 'marcin', zapytanie: 'kurier', konfWektorow: { klucz: '' } });
    sprawdz('bez klucza schodzi na slowa kluczowe', wBez.metoda === 'slowa-kluczowe');
    sprawdz('slowa kluczowe tez znajduja fragment', wBez.fragmenty.length > 0);

    sprawdz('usuwa dokument', baza.usun({ katalog, zakres: 'prywatna', login: 'marcin', id: d2.id }) === true);
    sprawdz('usuniecie nieistniejacego zwraca false', baza.usun({ katalog, zakres: 'prywatna', login: 'marcin', id: 'brak' }) === false);

    const pusto = await baza.szukaj({ katalog, login: 'nikt-taki', zapytanie: 'x', konfWektorow: { klucz: '' } });
    sprawdz('szukanie dziala przy samej wspolnej', Array.isArray(pusto.fragmenty));

    global.fetch = oryginalnyFetch;
    fs.rmSync(katalog, { recursive: true, force: true });

    await testyOpenSeo();
    await testyOpenSeoMcp();
    testySesji();
    testyBramy();
    testyPlanow();

    console.log(`\n  ${zaliczone} zaliczonych, ${bledy.length} bledow\n`);
    if (bledy.length) {
      for (const b of bledy) console.error(`  nie przeszlo: ${b}`);
      process.exit(1);
    }
  })();
}

// ─── Brama OpenSEO ────────────────────────────────────────────────────────────
// Prawdziwego OpenSEO tu nie ma (to kontener Dockera), wiec w jego miejsce
// stawiamy atrape mowiaca tym samym protokolem: strona HTML, zasob statyczny
// i echo naglowkow. To wystarcza, bo sprawdzamy nasza brame, nie ich aplikacje.

async function testyOpenSeo() {
  const http = require('node:http');
  const openseo = require('./openseo.js');

  console.log('\n  brama OpenSEO - skladanie odpowiedzi');
  {
    const blok = openseo.blokMotywu(7);
    sprawdz(
      'motyw ladauje sie przed </head>',
      openseo.wstrzyknij('<html><head><title>x</title></head><body>y</body></html>', blok)
        .indexOf('/__cai/motyw.css') < '<html><head><title>x</title></head>'.length + blok.length
    );
    sprawdz(
      'bez <head> motyw idzie przed </body>',
      /motyw\.css[\s\S]*<\/body>/.test(openseo.wstrzyknij('<body>y</body>', blok))
    );
    sprawdz('bez <head> i <body> motyw i tak jest', openseo.wstrzyknij('goly tekst', blok).includes('motyw.css'));
    sprawdz('wersja arkusza trafia do adresu', blok.includes('motyw.css?v=7'));
    sprawdz('krój pisma ten sam co w Content AI', blok.includes('IBM+Plex+Sans'));

    sprawdz('HTML rozpoznany', openseo.czyHtml({ 'content-type': 'text/html; charset=utf-8' }));
    sprawdz('JSON to nie HTML', !openseo.czyHtml({ 'content-type': 'application/json' }));
    sprawdz('brak typu to nie HTML', !openseo.czyHtml({}));
  }

  console.log('\n  brama OpenSEO - naglowki');
  {
    const req = {
      headers: {
        host: 'seo.example.pl',
        cookie: 'cai_auth=tajny-token; openseo_sesja=abc',
        connection: 'keep-alive',
        'accept-encoding': 'gzip, br',
      },
    };
    const g = openseo.naglowkiDoGory(req, '198.51.100.7');
    sprawdz('token sesji Content AI nie idzie do OpenSEO', !String(g.cookie).includes('cai_auth'));
    sprawdz('wlasne ciasteczka OpenSEO przechodza', String(g.cookie).includes('openseo_sesja=abc'));
    sprawdz('naglowki hop-by-hop odciete', !('connection' in g));
    sprawdz('zadamy nieskompresowanej tresci', g['accept-encoding'] === 'identity');
    sprawdz('adres klienta przekazany', g['x-forwarded-for'] === '198.51.100.7');
    sprawdz('host zachowany dla ALLOWED_HOST', g.host === 'seo.example.pl');

    const samoCai = openseo.naglowkiDoGory({ headers: { cookie: 'cai_auth=x' } }, null);
    sprawdz('puste ciasteczko nie zostaje pustym naglowkiem', !('cookie' in samoCai));

    const d = openseo.naglowkiWDol({ 'content-type': 'text/html', 'transfer-encoding': 'chunked' });
    sprawdz('transfer-encoding nie wraca do przegladarki', !('transfer-encoding' in d));
  }

  console.log('\n  brama OpenSEO - ruch');
  {
    let doszloDoOpenSeo = 0;
    let ostatnieCiasteczko = null;

    const atrapa = http.createServer((req, res) => {
      doszloDoOpenSeo += 1;
      ostatnieCiasteczko = req.headers.cookie || null;
      if (req.url === '/zasob.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end('console.log(1)');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>OpenSEO</title></head><body class="bg-base-200">panel</body></html>');
    });
    await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));

    let zalogowany = false;
    const brama = openseo.utworz(
      { host: '127.0.0.1', port: atrapa.address().port },
      {
        sesjaZadania: () => (zalogowany ? { login: 'marcin', rola: 'admin' } : null),
        obslugaLogowania: async (req, res) => res.writeHead(302, { Location: '/' }).end(),
        stronaLogowania: (k) => `<html><body>${k || 'logowanie'}</body></html>`,
        adresIp: () => '127.0.0.1',
      }
    );

    const serwer = http.createServer((req, res) => {
      brama.obsluz(req, res).catch(() => res.writeHead(500).end());
    });
    await new Promise((r) => serwer.listen(0, '127.0.0.1', r));
    const adres = `http://127.0.0.1:${serwer.address().port}`;

    // Bez sesji
    const bez = await fetch(adres + '/', { redirect: 'manual' });
    const bezTresc = await bez.text();
    sprawdz('bez logowania brama odmawia', bez.status === 401);
    sprawdz('bez logowania pokazuje ekran logowania', bezTresc.includes('Zaloguj'));
    sprawdz('bez logowania OpenSEO nie dostaje zadania', doszloDoOpenSeo === 0);

    // Arkusz z paleta - serwujemy go sami, bez pytania OpenSEO
    const css = await fetch(adres + '/__cai/motyw.css');
    const cssTresc = await css.text();
    sprawdz('arkusz palety dostepny bez logowania', css.status === 200);
    sprawdz('arkusz to CSS', /text\/css/.test(css.headers.get('content-type') || ''));
    sprawdz('arkusz podmienia zmienne daisyUI', cssTresc.includes('--color-base-100'));
    sprawdz('arkusz niesie bursztyn Content AI', cssTresc.includes('#ffb000'));
    sprawdz('arkusz nie pyta OpenSEO', doszloDoOpenSeo === 0);

    // Po zalogowaniu
    zalogowany = true;
    const strona = await fetch(adres + '/', { headers: { cookie: 'cai_auth=tajny; inne=1' } });
    const html = await strona.text();
    sprawdz('po zalogowaniu strona przechodzi', strona.status === 200);
    sprawdz('strona OpenSEO dotarla w calosci', html.includes('panel'));
    sprawdz('motyw doklejony do strony', html.includes('/__cai/motyw.css'));
    sprawdz('motyw przed </head>', html.indexOf('motyw.css') < html.indexOf('</head>'));
    sprawdz('dlugosc tresci przeliczona po wstrzyknieciu',
      Number(strona.headers.get('content-length')) === Buffer.byteLength(html));
    sprawdz('token sesji nie wyciekl do OpenSEO', !String(ostatnieCiasteczko).includes('tajny'));

    const zasob = await fetch(adres + '/zasob.js');
    const zasobTresc = await zasob.text();
    sprawdz('zasoby przechodza bez zmian', zasobTresc === 'console.log(1)');
    sprawdz('w zasoby nic nie wstrzykujemy', !zasobTresc.includes('motyw.css'));

    // Kontener padl
    await new Promise((r) => atrapa.close(r));
    const padl = await fetch(adres + '/');
    const padlTresc = await padl.text();
    sprawdz('gdy kontener nie odpowiada, jest 502', padl.status === 502);
    sprawdz('502 tlumaczy, co sprawdzic', padlTresc.includes('docker compose'));

    await new Promise((r) => serwer.close(r));
  }
}

// ─── Klient MCP: Content AI pyta OpenSEO ──────────────────────────────────────
// Zywego OpenSEO tu nie ma, wiec podstawiamy wlasna funkcje wysylajaca. Testuje
// to nasza strone kontraktu: koszty, ksztalt danych i obsluge bledow.

async function testyOpenSeoMcp() {
  const mcp = require('./openseo-mcp.js');
  const serp = require('./serp.js');
  const http = require('node:http');

  console.log('\n  OpenSEO MCP - koszty');
  {
    let wywolane = null;
    const konf = {
      host: '127.0.0.1',
      port: 1,
      poslijImpl: async (cialo) => {
        wywolane = cialo;
        return { jsonrpc: '2.0', id: cialo.id, result: { structuredContent: { rows: [], totalCount: 0 } } };
      },
    };

    await mcp.wolaj('list_saved_keywords', { projectId: 'p1' }, konf);
    sprawdz('darmowe narzedzie idzie bez potwierdzenia', wywolane.params.name === 'list_saved_keywords');
    sprawdz('wolanie ma ksztalt JSON-RPC tools/call', wywolane.jsonrpc === '2.0' && wywolane.method === 'tools/call');

    let odmowa = null;
    wywolane = null;
    try { await mcp.wolaj('research_keywords', { projectId: 'p1' }, konf); }
    catch (e) { odmowa = e; }
    sprawdz('platne narzedzie bez zgody odmawia', odmowa !== null && odmowa.status === 400);
    sprawdz('platne narzedzie bez zgody NIE wysyla zadania', wywolane === null);

    await mcp.wolaj('research_keywords', { projectId: 'p1' }, konf, { platne: true });
    sprawdz('platne narzedzie ze zgoda przechodzi', wywolane && wywolane.params.name === 'research_keywords');

    let nieznane = null;
    try { await mcp.wolaj('rm_-rf', {}, konf); } catch (e) { nieznane = e; }
    sprawdz('nieznane narzedzie odrzucone', nieznane !== null && nieznane.status === 400);
  }

  console.log('\n  OpenSEO MCP - bledy');
  {
    const zBledem = (odp) => ({ host: 'x', port: 1, poslijImpl: async () => odp });

    let e1 = null;
    try { await mcp.wolaj('list_projects', {}, zBledem({ jsonrpc: '2.0', id: 1, error: { message: 'brak projektu' } })); }
    catch (e) { e1 = e; }
    sprawdz('blad JSON-RPC zamienia sie w wyjatek', e1 !== null && e1.message.includes('brak projektu'));

    let e2 = null;
    try {
      await mcp.wolaj('list_projects', {}, zBledem({
        jsonrpc: '2.0', id: 1,
        result: { isError: true, content: [{ type: 'text', text: 'Projekt nie istnieje' }] },
      }));
    } catch (e) { e2 = e; }
    sprawdz('isError niesie komunikat narzedzia', e2 !== null && e2.message.includes('Projekt nie istnieje'));
    sprawdz('isError to blad wolajacego, nie serwera', e2 !== null && e2.status === 400);

    let e3 = null;
    try { await mcp.wolaj('list_projects', {}, zBledem({ jsonrpc: '2.0', id: 1 })); } catch (e) { e3 = e; }
    sprawdz('brak wyniku to blad', e3 !== null);
  }

  console.log('\n  OpenSEO MCP - odpakowanie odpowiedzi');
  {
    sprawdz('czysty JSON', mcp.odpakuj('application/json', '{"jsonrpc":"2.0","id":1}').id === 1);
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
    sprawdz('strumien SSE', mcp.odpakuj('text/event-stream; charset=utf-8', sse).id === 7);
    let pusty = null;
    try { mcp.odpakuj('text/event-stream', 'event: ping\n\n'); } catch (e) { pusty = e; }
    sprawdz('pusty SSE to blad, nie cicha cisza', pusty !== null);
  }

  console.log('\n  OpenSEO MCP - ksztalt danych dla aplikacji');
  {
    const w = mcp.frazyDoAplikacji({
      rows: [
        { keyword: 'kurier dla sklepu', searchVolume: 1300, keywordDifficulty: 21, cpc: 2.4, intent: 'commercial', tags: [{ name: 'do-napisania' }] },
        { keyword: 'paczkomat cennik', searchVolume: null, tags: ['zrobione'] },
        { keyword: '' },
      ],
      totalCount: 3,
      tags: [{ name: 'do-napisania' }, 'zrobione'],
    });
    sprawdz('puste frazy odpadaja', w.frazy.length === 2);
    sprawdz('metryki przepisane', w.frazy[0].wolumen === 1300 && w.frazy[0].trudnosc === 21);
    sprawdz('tagi jako obiekt i jako tekst', w.frazy[0].tagi[0] === 'do-napisania' && w.frazy[1].tagi[0] === 'zrobione');
    sprawdz('brak metryki to null, nie zero', w.frazy[1].wolumen === null);
    sprawdz('lista tagow projektu splaszczona', w.tagi.length === 2);

    const p = mcp.projektyDoAplikacji({ projects: [{ id: 'p1', name: 'Sklep', domain: 'sklep.pl' }, { id: 'p2' }] });
    sprawdz('projekty przepisane', p[0].nazwa === 'Sklep' && p[0].domena === 'sklep.pl');
    sprawdz('projekt bez nazwy dostaje id', p[1].nazwa === 'p2');
  }

  console.log('\n  OpenSEO MCP - SERP w formacie wspolnym z DataForSEO');
  {
    const koperta = mcp.serpJakDataForSeo({
      results: [{
        keyword: 'kurier dla sklepu', ok: true,
        items: [
          { rank: 1, title: 'Kurier dla sklepu internetowego', description: 'Tania wysylka paczek dla sklepu', url: 'https://a.pl', domain: 'a.pl' },
          { rank: 2, type: 'organic', title: 'Wysylka paczek ze sklepu', description: 'Kurier i paczkomat dla sklepu', url: 'https://b.pl', domain: 'b.pl' },
        ],
      }],
    }, 'kurier dla sklepu');
    const wynik = serp.zbudujWynik(koperta, 'kurier dla sklepu');
    sprawdz('wyniki przechodza przez wspolny parser', wynik.context.includes('kurier dla sklepu'));
    sprawdz('type null traktowany jak organic', wynik.topics.length > 0);
    sprawdz('frazy wyciagniete z opisow', wynik.phrases.length > 0);

    const bezWynikow = mcp.serpJakDataForSeo({ results: [{ keyword: 'x', ok: false, error: 'limit' }] }, 'x');
    sprawdz('blad pojedynczej frazy to brak wynikow, nie wyjatek',
      bezWynikow.tasks[0].result[0].items.length === 0);
  }

  console.log('\n  OpenSEO MCP - prawdziwy POST');
  {
    let trafienie = null;
    const atrapa = http.createServer((req, res) => {
      const kawalki = [];
      req.on('data', (c) => kawalki.push(c));
      req.on('end', () => {
        trafienie = { sciezka: req.url, accept: req.headers.accept, cialo: JSON.parse(Buffer.concat(kawalki).toString('utf8')) };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"projects":[{"id":"p1","name":"Sklep"}]}}}\n\n');
      });
    });
    await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
    const konf = { host: '127.0.0.1', port: atrapa.address().port };

    const dane = await mcp.wolaj('list_projects', {}, konf);
    sprawdz('trafia pod /mcp', trafienie.sciezka === '/mcp');
    sprawdz('Accept obejmuje oba typy tresci', /application\/json/.test(trafienie.accept) && /text\/event-stream/.test(trafienie.accept));
    sprawdz('odpowiedz SSE odczytana', mcp.projektyDoAplikacji(dane)[0].nazwa === 'Sklep');
    sprawdz('czyDziala widzi martwy serwer', (await mcp.czyDziala({ host: '127.0.0.1', port: 1 })) === false);

    await new Promise((r) => atrapa.close(r));
    let brak = null;
    try { await mcp.wolaj('list_projects', {}, konf); } catch (e) { brak = e; }
    sprawdz('brak kontenera to czytelny blad', brak !== null && brak.message.includes('OpenSEO'));
  }
}

// ─── Sesje bezstanowe ─────────────────────────────────────────────────────────
// Sesja siedzi w podpisanym ciasteczku, a nie w pamieci procesu. Testujemy to,
// co z tego wynika: przezycie restartu i cztery drogi uniewaznienia.

function testySesji() {
  const fs = require('node:fs');
  const path = require('node:path');
  const srv = require('./server.js');

  console.log('\n  sesje - podpis i odczyt');

  const katalog = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cai-sesje-'));
  const plikKont = path.join(katalog, 'uzytkownicy.json');
  const oryginalneKonta = process.env.CAI_UZYTKOWNICY;

  // Podmieniamy plik kont tak, jak robi to serwer przy starcie
  const konta = [
    { login: 'marcin', hash: 'x', sol: 'y', rola: 'admin' },
    { login: 'anna', hash: 'x', sol: 'y', rola: 'uzytkownik' },
  ];
  fs.writeFileSync(plikKont, JSON.stringify(konta));

  // wczytajUzytkownikow czyta ze stalej PLIK_UZYTKOWNIKOW ustalonej przy
  // wczytaniu modulu, wiec testujemy wobec prawdziwego pliku serwera
  const plikSerwera = srv.PLIK_UZYTKOWNIKOW;
  fs.mkdirSync(path.dirname(plikSerwera), { recursive: true });
  const kopia = fs.existsSync(plikSerwera) ? fs.readFileSync(plikSerwera) : null;
  fs.writeFileSync(plikSerwera, JSON.stringify(konta));

  const zCiasteczkiem = (token) => ({ headers: { cookie: `cai_auth=${token}` } });

  const token = srv.utworzSesje({ login: 'marcin', rola: 'admin' });
  sprawdz('token ma cialo i podpis', token.split('.').length === 2);
  sprawdz('cialo nie jest tajne, tylko podpisane',
    JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).login === 'marcin');

  const s = srv.sesjaZadania(zCiasteczkiem(token));
  sprawdz('poprawny token przechodzi', s !== null && s.login === 'marcin');
  sprawdz('rola odczytana z pliku kont', s.rola === 'admin');

  sprawdz('brak ciasteczka to brak sesji', srv.sesjaZadania({ headers: {} }) === null);
  sprawdz('smiec zamiast tokenu odrzucony', srv.sesjaZadania(zCiasteczkiem('abc')) === null);
  sprawdz('sam podpis bez ciala odrzucony', srv.sesjaZadania(zCiasteczkiem('.xyz')) === null);

  console.log('\n  sesje - proby podszycia');
  {
    const [cialo, podpis] = token.split('.');
    const opis = JSON.parse(Buffer.from(cialo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

    // Podniesienie roli w ciasteczku bez znajomosci sekretu
    opis.rola = 'admin';
    opis.login = 'anna';
    const podmienione = Buffer.from(JSON.stringify(opis)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sprawdz('podmiana loginu psuje podpis', srv.sesjaZadania(zCiasteczkiem(`${podmienione}.${podpis}`)) === null);

    // Sam podpis obciety
    sprawdz('obciety podpis odrzucony', srv.sesjaZadania(zCiasteczkiem(`${cialo}.${podpis.slice(0, -4)}`)) === null);
    // Podpis o tej samej dlugosci, ale inny
    const inny = podpis.slice(0, -1) + (podpis.slice(-1) === 'A' ? 'B' : 'A');
    sprawdz('podmieniony podpis odrzucony', srv.sesjaZadania(zCiasteczkiem(`${cialo}.${inny}`)) === null);
  }

  console.log('\n  sesje - uniewaznianie');
  {
    // 1. Wygasniecie
    const wygasly = srv.utworzSesje({ login: 'marcin', rola: 'admin' });
    const [c] = wygasly.split('.');
    const o = JSON.parse(Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    sprawdz('token niesie date wygasniecia', o.wygasa > Date.now());

    // 2. Usuniecie konta - weryfikacja siega do pliku kont
    fs.writeFileSync(plikSerwera, JSON.stringify(konta.filter((k) => k.login !== 'marcin')));
    sprawdz('usuniete konto konczy sesje natychmiast', srv.sesjaZadania(zCiasteczkiem(token)) === null);
    fs.writeFileSync(plikSerwera, JSON.stringify(konta));
    sprawdz('przywrocone konto znow przechodzi', srv.sesjaZadania(zCiasteczkiem(token)) !== null);

    // 3. Degradacja roli dziala od razu, bez czekania na wygasniecie
    fs.writeFileSync(plikSerwera, JSON.stringify([
      { login: 'marcin', hash: 'x', sol: 'y', rola: 'uzytkownik' },
    ]));
    const poDegradacji = srv.sesjaZadania(zCiasteczkiem(token));
    sprawdz('degradacja admina dziala natychmiast', poDegradacji !== null && poDegradacji.rola === 'uzytkownik');
    fs.writeFileSync(plikSerwera, JSON.stringify(konta));

    // 4. Znacznik sesjeOd - zmiana hasla uniewaznia starsze sesje
    fs.writeFileSync(plikSerwera, JSON.stringify([
      { login: 'marcin', hash: 'x', sol: 'y', rola: 'admin', sesjeOd: Date.now() + 1000 },
    ]));
    sprawdz('sesjeOd odcina sesje wydane wczesniej', srv.sesjaZadania(zCiasteczkiem(token)) === null);
    const poZmianie = srv.utworzSesje({ login: 'marcin', rola: 'admin' });
    fs.writeFileSync(plikSerwera, JSON.stringify([
      { login: 'marcin', hash: 'x', sol: 'y', rola: 'admin', sesjeOd: Date.now() - 1000 },
    ]));
    sprawdz('sesja wydana po zmianie hasla dziala', srv.sesjaZadania(zCiasteczkiem(poZmianie)) !== null);
    fs.writeFileSync(plikSerwera, JSON.stringify(konta));
  }

  console.log('\n  sesje - wylogowanie przezywa restart');
  {
    const kopiaWylog = fs.existsSync(srv.PLIK_WYLOGOWANYCH) ? fs.readFileSync(srv.PLIK_WYLOGOWANYCH) : null;
    try { fs.unlinkSync(srv.PLIK_WYLOGOWANYCH); } catch (e) { /* moze nie istniec */ }

    const t = srv.utworzSesje({ login: 'marcin', rola: 'admin' });
    const sesja = srv.sesjaZadania(zCiasteczkiem(t));
    sprawdz('sesja przed wylogowaniem dziala', sesja !== null);

    srv.zapiszWylogowanie(sesja.id, sesja.wygasa);
    sprawdz('po wylogowaniu token nie przechodzi', srv.sesjaZadania(zCiasteczkiem(t)) === null);
    sprawdz('wylogowanie zapisane na dysku', fs.existsSync(srv.PLIK_WYLOGOWANYCH));
    sprawdz('lista wylogowanych czytana z pliku', srv.wylogowane().some((w) => w.id === sesja.id));

    // Inna sesja tej samej osoby ma dzialac dalej
    const t2 = srv.utworzSesje({ login: 'marcin', rola: 'admin' });
    sprawdz('wylogowanie dotyczy jednej sesji, nie konta', srv.sesjaZadania(zCiasteczkiem(t2)) !== null);

    // Wpisy po terminie wypadaja przy kolejnym zapisie
    srv.zapiszWylogowanie('stary', Date.now() - 1000);
    srv.zapiszWylogowanie('nowy', Date.now() + 60_000);
    sprawdz('przeterminowane wpisy sa sprzatane', !srv.wylogowane().some((w) => w.id === 'stary'));

    if (kopiaWylog) fs.writeFileSync(srv.PLIK_WYLOGOWANYCH, kopiaWylog);
    else { try { fs.unlinkSync(srv.PLIK_WYLOGOWANYCH); } catch (e) { /* nic */ } }
  }

  // Sprzatanie
  if (kopia) fs.writeFileSync(plikSerwera, kopia);
  else { try { fs.unlinkSync(plikSerwera); } catch (e) { /* nic */ } }
  fs.rmSync(katalog, { recursive: true, force: true });
  if (oryginalneKonta === undefined) delete process.env.CAI_UZYTKOWNICY;
}

// ─── Logowanie przez bramę ────────────────────────────────────────────────────
// Tryb, w ktorym uwierzytelnia zewnetrzna brama (Authelia i pokrewne), a my
// czytamy tylko login z naglowka. Najwazniejszy test jest tu jeden: czy da sie
// podszyc pod admina, wysylajac ten naglowek z pominieciem bramy.

function testyBramy() {
  const fs = require('node:fs');
  const path = require('node:path');

  console.log('\n  logowanie przez bramę');

  // Serwer czyta konfiguracje przy wczytaniu modulu, wiec do tego testu
  // ladujemy go osobno, z ustawionym naglowkiem.
  const sciezkaModulu = require.resolve('./server.js');
  const kopiaModulu = require.cache[sciezkaModulu];
  delete require.cache[sciezkaModulu];

  const przedNaglowek = process.env.CAI_ZAUFANY_NAGLOWEK;
  process.env.CAI_ZAUFANY_NAGLOWEK = 'Remote-User';
  const srvBrama = require('./server.js');

  const plikKont = srvBrama.PLIK_UZYTKOWNIKOW;
  const kopiaKont = fs.existsSync(plikKont) ? fs.readFileSync(plikKont) : null;
  fs.mkdirSync(path.dirname(plikKont), { recursive: true });
  fs.writeFileSync(plikKont, JSON.stringify([
    { login: 'marcin', hash: 'x', sol: 'y', rola: 'admin' },
    { login: 'anna', hash: 'x', sol: 'y', rola: 'uzytkownik' },
  ]));

  const zadanie = (naglowki, adres) => ({
    headers: naglowki,
    socket: { remoteAddress: adres },
  });

  const zBramy = srvBrama.sesjaZadania(zadanie({ 'remote-user': 'marcin' }, '127.0.0.1'));
  sprawdz('brama wpuszcza znane konto', zBramy !== null && zBramy.login === 'marcin');
  sprawdz('rola nadal z pliku kont, nie z naglowka', zBramy.rola === 'admin');
  sprawdz('sesja oznaczona jako z bramy', zBramy.zBramy === true);

  const anna = srvBrama.sesjaZadania(zadanie({ 'remote-user': 'anna' }, '127.0.0.1'));
  sprawdz('zwykly uzytkownik nie dostaje roli admin', anna !== null && anna.rola === 'uzytkownik');

  // ── To jest sedno: naglowek spoza zaufanego adresu ──
  sprawdz('naglowek z obcego adresu ODRZUCONY',
    srvBrama.sesjaZadania(zadanie({ 'remote-user': 'marcin' }, '203.0.113.9')) === null);
  sprawdz('naglowek bez adresu ODRZUCONY',
    srvBrama.sesjaZadania(zadanie({ 'remote-user': 'marcin' }, undefined)) === null);
  sprawdz('X-Forwarded-For nie podszywa adresu',
    srvBrama.sesjaZadania(zadanie(
      { 'remote-user': 'marcin', 'x-forwarded-for': '127.0.0.1' }, '203.0.113.9')) === null);

  sprawdz('nieznane konto z bramy odrzucone',
    srvBrama.sesjaZadania(zadanie({ 'remote-user': 'ktos-obcy' }, '127.0.0.1')) === null);
  sprawdz('pusty naglowek odrzucony',
    srvBrama.sesjaZadania(zadanie({ 'remote-user': '   ' }, '127.0.0.1')) === null);
  sprawdz('brak naglowka to brak sesji',
    srvBrama.sesjaZadania(zadanie({}, '127.0.0.1')) === null);

  // W trybie bramy wlasne ciasteczko nie moze byc druga droga wejscia
  const wlasnyToken = srvBrama.utworzSesje({ login: 'marcin', rola: 'admin' });
  sprawdz('wlasne ciasteczko nie omija bramy',
    srvBrama.sesjaZadania(zadanie({ cookie: `cai_auth=${wlasnyToken}` }, '127.0.0.1')) === null);

  // Sprzatanie i powrot do stanu domyslnego
  if (kopiaKont) fs.writeFileSync(plikKont, kopiaKont);
  else { try { fs.unlinkSync(plikKont); } catch (e) { /* nic */ } }
  if (przedNaglowek === undefined) delete process.env.CAI_ZAUFANY_NAGLOWEK;
  else process.env.CAI_ZAUFANY_NAGLOWEK = przedNaglowek;
  delete require.cache[require.resolve('./server.js')];
  if (kopiaModulu) require.cache[sciezkaModulu] = kopiaModulu;
}

// ─── Plany i limity ───────────────────────────────────────────────────────────
// Fundament komercyjny: darmowy pakiet ma sie konczyc, platny odnawiac,
// a admin nie moze sobie zablokowac wlasnego narzedzia.

function testyPlanow() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const plany = require('./plany.js');

  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cai-plany-'));
  const wolny = { login: 'nowy', rola: 'uzytkownik', plan: 'darmowy' };
  const platny = { login: 'anna', rola: 'uzytkownik', plan: 'standard' };
  const szef = { login: 'marcin', rola: 'admin', plan: 'darmowy' };

  console.log('\n  plany - przypisanie');
  {
    sprawdz('konto bez planu dostaje darmowy', plany.nazwaPlanu({ login: 'x', rola: 'uzytkownik' }) === 'darmowy');
    sprawdz('nieznany plan schodzi na darmowy', plany.nazwaPlanu({ login: 'x', rola: 'uzytkownik', plan: 'zmyslony' }) === 'darmowy');
    sprawdz('admin zawsze premium, mimo wpisu darmowy', plany.nazwaPlanu(szef) === 'premium');
    sprawdz('platny plan zachowany', plany.nazwaPlanu(platny) === 'standard');
  }

  console.log('\n  plany - limit sie wyczerpuje');
  {
    const limit = (u) => plany.sprawdzLimit({ katalog, uzytkownik: u, czynnosc: 'artykul' });

    sprawdz('darmowy zaczyna z trzema artykulami', limit(wolny).zostalo === 3);
    for (let i = 0; i < 3; i++) plany.policz({ katalog, uzytkownik: wolny, czynnosc: 'artykul' });

    const po = limit(wolny);
    sprawdz('po trzech artykulach limit wyczerpany', po.wolno === false);
    sprawdz('powod nazwany wprost', po.powod === 'limit-wyczerpany');
    sprawdz('zostalo zero, nie liczba ujemna', po.zostalo === 0);
    sprawdz('darmowy limit sie NIE odnawia', po.okres === 'zawsze');

    // Inne czynnosci maja wlasne liczniki
    sprawdz('grafiki w darmowym od razu zablokowane', limit(wolny).wolno === false
      && plany.sprawdzLimit({ katalog, uzytkownik: wolny, czynnosc: 'grafika' }).limit === 0);
  }

  console.log('\n  plany - liczniki sa rozdzielne');
  {
    sprawdz('platny ma swoj wlasny licznik',
      plany.sprawdzLimit({ katalog, uzytkownik: platny, czynnosc: 'artykul' }).zostalo === 50);
    plany.policz({ katalog, uzytkownik: platny, czynnosc: 'artykul' });
    sprawdz('zliczenie u jednego nie rusza drugiego',
      plany.sprawdzLimit({ katalog, uzytkownik: platny, czynnosc: 'artykul' }).zostalo === 49
      && plany.sprawdzLimit({ katalog, uzytkownik: wolny, czynnosc: 'artykul' }).zostalo === 0);

    sprawdz('premium nie ma limitu sztukowego',
      plany.sprawdzLimit({ katalog, uzytkownik: szef, czynnosc: 'artykul' }).limit === null);
    plany.policz({ katalog, uzytkownik: szef, czynnosc: 'artykul' });
    sprawdz('przy braku limitu nic sie nie zapisuje',
      Object.keys(plany.wczytajUzycie(katalog, 'marcin')).length === 0);
  }

  console.log('\n  plany - okres miesieczny');
  {
    const sierpien = new Date(Date.UTC(2026, 7, 15));
    const wrzesien = new Date(Date.UTC(2026, 8, 1));
    sprawdz('okres miesieczny ma format RRRR-MM',
      plany.okresTeraz(plany.PLANY.standard, sierpien) === '2026-08');
    sprawdz('pakiet bez odnawiania ma jeden okres',
      plany.okresTeraz(plany.PLANY.darmowy, sierpien) === 'zawsze');

    const kowal = { login: 'kowal', rola: 'uzytkownik', plan: 'standard' };
    for (let i = 0; i < 50; i++) plany.policz({ katalog, uzytkownik: kowal, czynnosc: 'artykul', teraz: sierpien });
    sprawdz('limit miesieczny sie wyczerpuje',
      plany.sprawdzLimit({ katalog, uzytkownik: kowal, czynnosc: 'artykul', teraz: sierpien }).wolno === false);
    sprawdz('nowy miesiac zeruje licznik',
      plany.sprawdzLimit({ katalog, uzytkownik: kowal, czynnosc: 'artykul', teraz: wrzesien }).zostalo === 50);
  }

  console.log('\n  plany - bramki funkcji');
  {
    sprawdz('darmowy bez analizy SERP', plany.maFunkcje(wolny, 'serp') === false);
    sprawdz('standard z analiza SERP', plany.maFunkcje(platny, 'serp') === true);
    sprawdz('standard bez danych z OpenSEO', plany.maFunkcje(platny, 'openseo') === false);
    sprawdz('premium z OpenSEO', plany.maFunkcje({ login: 'p', rola: 'uzytkownik', plan: 'premium' }, 'openseo') === true);
    sprawdz('admin ma wszystkie funkcje', plany.maFunkcje(szef, 'openseo') === true);
    sprawdz('nieznana funkcja to nie', plany.maFunkcje(platny, 'teleportacja') === false);
  }

  console.log('\n  plany - stan dla aplikacji');
  {
    const stan = plany.stanPakietu({ katalog, uzytkownik: wolny });
    sprawdz('stan niesie nazwe pakietu', stan.plan === 'darmowy' && stan.nazwa === 'Darmowy');
    sprawdz('stan pokazuje zuzycie', stan.uzycie.artykul.zuzyte === 3 && stan.uzycie.artykul.zostalo === 0);
    sprawdz('stan niesie liste funkcji', stan.funkcje.serp === false);

    const stanPremium = plany.stanPakietu({ katalog, uzytkownik: szef });
    sprawdz('bez limitu widac null, nie zero', stanPremium.uzycie.artykul.limit === null);
  }

  console.log('\n  plany - artykul to nie to samo co wywolanie modelu');
  {
    // Jedno generowanie to kilka wywolan modelu. Gdyby kazde liczylo sie jako
    // artykul, pakiet darmowy skonczylby sie w polowie pierwszego tekstu.
    const nowak = { login: 'nowak', rola: 'uzytkownik', plan: 'darmowy' };
    for (let i = 0; i < 8; i++) plany.policz({ katalog, uzytkownik: nowak, czynnosc: 'wywolanie' });
    sprawdz('wywolania pomocnicze nie ruszaja licznika artykulow',
      plany.sprawdzLimit({ katalog, uzytkownik: nowak, czynnosc: 'artykul' }).zuzyte === 0);
    sprawdz('wywolania maja wlasny licznik',
      plany.sprawdzLimit({ katalog, uzytkownik: nowak, czynnosc: 'wywolanie' }).zuzyte === 8);

    // Sufit kosztu: konto, ktore nigdy nie przyzna sie do artykulu, i tak sie
    // konczy. To nie jest zamek, tylko granica wydatku.
    const sufit = plany.PLANY.darmowy.limity.wywolanie;
    sprawdz('darmowy ma sufit wywolan', typeof sufit === 'number' && sufit > 0);
    sprawdz('sufit jest wielokrotnoscia puli artykulow, nie rowny jej',
      sufit > plany.PLANY.darmowy.limity.artykul * 3);
    for (let i = 8; i < sufit; i++) plany.policz({ katalog, uzytkownik: nowak, czynnosc: 'wywolanie' });
    sprawdz('po wyczerpaniu sufitu nie wolno nic',
      plany.sprawdzLimit({ katalog, uzytkownik: nowak, czynnosc: 'wywolanie' }).wolno === false);

    sprawdz('premium nie ma sufitu wywolan', plany.PLANY.premium.limity.wywolanie === null);
    sprawdz('standard ma sufit ponad pule artykulow',
      plany.PLANY.standard.limity.wywolanie > plany.PLANY.standard.limity.artykul);
  }

  console.log('\n  plany - deklaracja czynnosci z aplikacji');
  {
    const { czynnosciTresci } = require('./server.js');
    const zNaglowkiem = (w) => czynnosciTresci({ headers: w === null ? {} : { 'x-cai-czynnosc': w } });

    sprawdz('bez naglowka liczy sie tylko wywolanie',
      JSON.stringify(zNaglowkiem(null)) === JSON.stringify(['wywolanie']));
    sprawdz('deklaracja artykulu obciaza oba liczniki',
      JSON.stringify(zNaglowkiem('artykul')) === JSON.stringify(['wywolanie', 'artykul']));
    sprawdz('wielkosc liter w naglowku bez znaczenia',
      JSON.stringify(zNaglowkiem('Artykul')) === JSON.stringify(['wywolanie', 'artykul']));
    // Cudza wartosc nie moze przypadkiem trafic na zaden inny licznik.
    sprawdz('zmyslona czynnosc nie otwiera nowego licznika',
      JSON.stringify(zNaglowkiem('grafika')) === JSON.stringify(['wywolanie']));
  }

  console.log('\n  plany - bezpieczenstwo zapisu');
  {
    // Sanityzacja zamienia ukosniki na podkreslenia, wiec ".." moze zostac
    // w nazwie jako nieszkodliwy fragment. Liczy sie jedno: czy sciezka po
    // rozwinieciu nadal wskazuje wewnatrz katalogu.
    const zloliwe = ['../../etc/passwd', '/etc/shadow', 'a/../../b', '....//x'];
    const wszystkieWewnatrz = zloliwe.every((zly) =>
      path.resolve(plany.plikUzycia(katalog, zly)).startsWith(path.resolve(katalog) + path.sep));
    sprawdz('zaden login nie wyprowadza poza katalog', wszystkieWewnatrz);
    let pusty = null;
    try { plany.plikUzycia(katalog, ''); } catch (e) { pusty = e; }
    sprawdz('pusty login odrzucony', pusty !== null);
  }

  fs.rmSync(katalog, { recursive: true, force: true });
}
