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
