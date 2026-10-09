'use strict';

// Testy dokumentow prawnych (serwer/dokumenty-prawne.js). Trasa GET /dokumenty/<nazwa> w server.js (etap 0)
// wola obsluz(req, res, { nazwa, jezyk, konf }); tu ten sam kontrakt przez wlasny maly serwer HTTP,
// wiec testy nie zaleza od kolejnosci tras ani od reszty konfiguracji serwera.
// Wolane z serwer/testy.js: uruchom({ sprawdz }).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PELNE = Object.freeze({
  uslugodawca: {
    imieNazwisko: 'Jan Testowy', adres: 'ul. Próbna 1, 00-001 Warszawa', telefon: '+48 500 600 700',
    email: 'kontakt@example.com', www: 'https://content-ai.net',
  },
  klucze: { nvidia: '', eleven: '' }, dataForSeo: { login: '', haslo: '' }, PLATNOSCI_TRYB: 'test',
});

function surowe(adres, sciezka, opcje = {}) {
  return new Promise((ok, zle) => {
    const u = new URL(adres + sciezka);
    const z = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: opcje.method || 'GET', headers: opcje.headers || {} }, (o) => {
      const czesci = [];
      o.on('data', (c) => czesci.push(c));
      o.on('end', () => ok({ status: o.statusCode, h: o.headers, cialo: Buffer.concat(czesci) }));
    });
    z.on('error', zle);
    z.end();
  });
}

async function uruchom({ sprawdz }) {
  const dok = require('./dokumenty-prawne.js');
  console.log('\n  dokumenty prawne (/dokumenty/<nazwa>, PL i EN)');

  let konf = PELNE;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = /^\/dokumenty\/([a-z-]+)$/.exec(u.pathname);
    dok.obsluz(req, res, { nazwa: m ? m[1] : '', jezyk: u.searchParams.get('lang') === 'en' ? 'en' : 'pl', konf });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const ADRES = `http://127.0.0.1:${srv.address().port}`;
  const pobierz = async (sciezka, opcje = {}) => {
    const o = await fetch(ADRES + sciezka, { redirect: 'manual', ...opcje });
    return { status: o.status, h: o.headers, tekst: await o.text() };
  };
  const wszystkie = async () => {
    const wynik = [];
    for (const nazwa of dok.NAZWY) for (const jezyk of dok.JEZYKI) wynik.push({ nazwa, jezyk, ...(await pobierz(`/dokumenty/${nazwa}?lang=${jezyk}`)) });
    return wynik;
  };

  try {
    konf = PELNE;
    const dokumenty = await wszystkie();
    const wersje = dok.wersje();
    for (const nazwa of dok.NAZWY) {
      const para = dokumenty.filter((d) => d.nazwa === nazwa);
      const szablony = dok.JEZYKI.map((j) => fs.readFileSync(path.join(dok.KATALOG, `${nazwa}.${j}.md`), 'utf8'));
      const tytuly = szablony.map((s) => (/\ntytul:\s*(.+)\n/.exec(s) || [])[1]);
      sprawdz(`${nazwa}: PL i EN 200, HTML w UTF-8, <html lang>, tytul i wersja ${wersje[nazwa]} z naglowka szablonu`,
        para.every((d, i) => d.status === 200 && /^text\/html; charset=utf-8$/.test(d.h.get('content-type'))
          && d.tekst.includes(`<html lang="${d.jezyk}">`) && d.tekst.includes(`<h1>${tytuly[i].replace(/'/g, '&#39;')}</h1>`)
          && d.tekst.includes(wersje[nazwa]))
        && szablony.every((s) => s.includes(`\nwersja: ${wersje[nazwa]}\n`)));
    }

    const zDanymi = dokumenty.filter((d) => ['regulamin', 'prywatnosc', 'odstapienie', 'dpa', 'uslugodawca'].includes(d.nazwa));
    sprawdz('dane uslugodawcy z konfiguracji w regulaminie, polityce, odstapieniu, DPA i danych uslugodawcy (PL i EN)',
      zDanymi.every((d) => d.tekst.includes('Jan Testowy') && d.tekst.includes('<a href="mailto:kontakt@example.com">kontakt@example.com</a>')));
    const uslugodawca = dokumenty.find((d) => d.nazwa === 'uslugodawca' && d.jezyk === 'pl').tekst;
    sprawdz('dane uslugodawcy: adres, telefon jako tel:, strona jako link',
      uslugodawca.includes('ul. Próbna 1, 00-001 Warszawa') && uslugodawca.includes('<a href="tel:+48500600700">+48 500 600 700</a>')
      && uslugodawca.includes('<a href="https://content-ai.net">content-ai.net</a>'));

    // tresc strony bez arkusza stylow (w CSS "}}" zamyka regule @media)
    const glowna = (h) => (/<main[\s\S]*<\/main>/.exec(h) || [''])[0];
    const zostawione = dokumenty.filter((d) => /WSTAW_TUTAJ|\{\{|\}\}|\u0001|<!--|PRAWNIK|KSIĘGOWA|LAWYER|ACCOUNTANT|DO_UZUPELNIENIA|do uzupełnienia|to be completed/.test(glowna(d.tekst)));
    sprawdz('pelna konfiguracja: zadnych znacznikow szablonu, notatek dla prawnika ani znacznika "do uzupelnienia"',
      zostawione.length === 0 && dokumenty.every((d) => glowna(d.tekst).length > 1000));

    const slowa = /faktur|invoice|w pełni zgodn|fully compliant|zgodn\w* z kodeksem|compliant with the code|—|–|\bDHL\b/i;
    sprawdz('bez slow "faktura"/"invoice", "w pelni zgodne"/"fully compliant", zgodnosci z Kodeksem praktyk, dlugich myslnikow i marki klienta',
      dokumenty.every((d) => !slowa.test(d.tekst)));
    const reg = (j) => dokumenty.find((d) => d.nazwa === 'regulamin' && d.jezyk === j).tekst;
    sprawdz('AI Act (PR8-04): regulamin "wspiera wymogi przejrzystosci" / "supports the transparency requirements"',
      reg('pl').includes('wspiera wymogi przejrzystości') && reg('en').includes('supports the transparency requirements'));
    sprawdz('regulamin (PR8-03): zakaz usuwania oznaczen AI, obowiazki z art. 50 ust. 4, zakaz tresci intymnych bez zgody',
      reg('pl').includes('usuwania, zmieniania lub fałszowania oznaczeń') && reg('pl').includes('art. 50 ust. 4')
      && reg('pl').includes('wizerunków intymnych') && reg('en').includes('remove, alter or falsify marks'));
    sprawdz('regulamin (PR8-11): potwierdzenie platnosci od Stripe i rachunek na zadanie w 3 miesiace, ceny koncowe',
      reg('pl').includes('potwierdzenie płatności') && reg('pl').includes('wystawia rachunek') && reg('pl').includes('ceny końcowe')
      && reg('en').includes('issues a receipt'));
    sprawdz('regulamin: limit pakietu Darmowego z serwer/plany.js i dni zaleglosci z konfiguracji (domyslnie 7)',
      reg('pl').includes(`limit ${require('./plany.js').PLANY.darmowy.limity.artykul} artykułów`) && reg('pl').includes('w ciągu 7 dni'));
    konf = { ...PELNE, PLATNOSCI_ZALEGLA_DNI: 10 };
    sprawdz('regulamin: PLATNOSCI_ZALEGLA_DNI=10 zmienia termin w tekscie', (await pobierz('/dokumenty/regulamin?lang=pl')).tekst.includes('w ciągu 10 dni'));

    konf = PELNE;
    const lista = (j) => dokumenty.find((d) => d.nazwa === 'podprzetwarzajacy' && d.jezyk === j).tekst;
    const polityka = (j) => dokumenty.find((d) => d.nazwa === 'prywatnosc' && d.jezyk === j).tekst;
    sprawdz('produkcja (bez NVIDIA_KEY, DataForSEO, ELEVEN_KEY): lista i polityka bez NVIDIA i DataForSEO, ElevenLabs tylko na kluczu uzytkownika',
      dok.JEZYKI.every((j) => !/NVIDIA|DataForSEO/.test(lista(j) + polityka(j)))
      && !/<th scope="row"[^>]*>ElevenLabs/.test(lista('pl')) && polityka('pl').includes('synteza mowy, tylko na Twoim kluczu API')
      && polityka('en').includes('speech synthesis, only on your API key'));
    konf = { ...PELNE, klucze: { nvidia: 'nvapi-x', eleven: 'el-x' }, dataForSeo: { login: 'l', haslo: 'h' } };
    const listaWl = (await pobierz('/dokumenty/podprzetwarzajacy?lang=pl')).tekst;
    sprawdz('uslugi wlaczone w konfiguracji: NVIDIA, DataForSEO i ElevenLabs pojawiaja sie na liscie z widoczna luka do uzupelnienia',
      listaWl.includes('NVIDIA Corporation') && listaWl.includes('DataForSEO') && /<th scope="row"[^>]*>ElevenLabs/.test(listaWl)
      && listaWl.includes('class="brak"'));

    konf = PELNE;
    const dpa = dokumenty.find((d) => d.nazwa === 'dpa' && d.jezyk === 'pl').tekst;
    sprawdz('DPA: Zalacznik A to lista podprzetwarzajacych (ta sama tresc i wersja listy), Zalacznik B ze srodkami',
      dpa.includes('id="zalacznik-a"') && dpa.includes('Hetzner Online GmbH') && dpa.includes(`lista w wersji ${wersje.podprzetwarzajacy}`)
      && dpa.includes('id="zalacznik-b"') && dpa.includes('AES-256-GCM'));
    sprawdz('lista podprzetwarzajacych (PR8-30): wersja z naglowka jest w historii zmian (PL i EN)',
      dok.JEZYKI.every((j) => new RegExp(`<t[hd][^>]*>${wersje.podprzetwarzajacy}</t[hd]>`).test(lista(j))));
    const odst = dokumenty.find((d) => d.nazwa === 'odstapienie' && d.jezyk === 'pl').tekst;
    sprawdz('odstapienie (PR8-31): pouczenie i wzor formularza z adresatem z konfiguracji',
      odst.includes('Wzór formularza odstąpienia od umowy') && /Adresat: Jan Testowy/.test(odst) && odst.includes('14 dni'));

    konf = { uslugodawca: {}, klucze: {}, dataForSeo: {}, PLATNOSCI_TRYB: 'test' };
    const puste = await wszystkie();
    sprawdz('puste dane uslugodawcy: widoczny znacznik "do uzupelnienia" (PL) i "to be completed" (EN) przy kazdym polu',
      puste.filter((d) => d.nazwa === 'regulamin').every((d) => (d.jezyk === 'pl'
        ? ['do uzupełnienia: imię i nazwisko usługodawcy', 'do uzupełnienia: adres usługodawcy', 'do uzupełnienia: numer telefonu usługodawcy', 'do uzupełnienia: adres e-mail usługodawcy']
        : ['to be completed: service provider&#39;s full name', 'to be completed: service provider&#39;s telephone number']).every((s) => d.tekst.includes(s)))
      && puste.every((d) => d.status === 200 && !/WSTAW_TUTAJ/.test(d.tekst)));

    konf = { uslugodawca: { imieNazwisko: '<script>alert(1)</script>', adres: 'a', telefon: '1', email: 'zly@adres', www: 'javascript:alert(1)' } };
    const wrogi = (await pobierz('/dokumenty/uslugodawca?lang=pl')).tekst;
    sprawdz('wartosci z konfiguracji sa escapowane; zly e-mail nie jest linkiem mailto, zly adres strony zastapiony domyslnym',
      wrogi.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !wrogi.includes('<script>') && !wrogi.includes('mailto:zly@adres')
      && !wrogi.includes('javascript:') && wrogi.includes('<a href="https://content-ai.net">content-ai.net</a>'));

    konf = { ...PELNE, uslugodawca: { ...PELNE.uslugodawca, www: 'https://witryna-uslugodawcy.example.pl' } };
    const inneWww = (await pobierz('/dokumenty/regulamin?lang=en')).tekst;
    sprawdz('cennik i strona AI Act zawsze na content-ai.net, takze gdy CAI_USLUGODAWCA_WWW wskazuje inna witryne',
      inneWww.includes('https://content-ai.net/en/#cennik') && inneWww.includes('https://content-ai.net/en/ai-act/')
      && !inneWww.includes('witryna-uslugodawcy.example.pl/en/'));

    const ostrzezenia = [];
    const oryginalWarn = console.warn;
    console.warn = (...a) => ostrzezenia.push(a.join(' '));
    try {
      konf = { uslugodawca: { imieNazwisko: 'Jan Testowy', adres: '', telefon: '', email: 'kontakt@example.com' }, PLATNOSCI_TRYB: 'live', klucze: {}, dataForSeo: {} };
      await pobierz('/dokumenty/regulamin?lang=pl');
      await pobierz('/dokumenty/regulamin?lang=pl');
      const poLive = ostrzezenia.length;
      konf = { ...PELNE, PLATNOSCI_TRYB: 'live' };
      await pobierz('/dokumenty/regulamin?lang=pl');
      konf = { uslugodawca: {}, PLATNOSCI_TRYB: 'test', klucze: {}, dataForSeo: {} };
      await pobierz('/dokumenty/odstapienie?lang=en');
      sprawdz('tryb live bez danych: jedno ostrzezenie w dzienniku z nazwami brakujacych zmiennych; pelne dane albo tryb test: cisza',
        poLive === 1 && ostrzezenia.length === 1 && /CAI_USLUGODAWCA_ADRES/.test(ostrzezenia[0]) && /CAI_USLUGODAWCA_TELEFON/.test(ostrzezenia[0])
        && !/CAI_USLUGODAWCA_IMIE_NAZWISKO/.test(ostrzezenia[0]));
    } finally {
      console.warn = oryginalWarn;
    }
    sprawdz('brakujaceDane(konf) dla startu serwera: nazwy pustych zmiennych CAI_USLUGODAWCA_*',
      dok.brakujaceDane({ uslugodawca: { imieNazwisko: 'X', email: 'a@b.pl' } }).join(',') === 'CAI_USLUGODAWCA_ADRES,CAI_USLUGODAWCA_TELEFON'
      && dok.brakujaceDane(PELNE).length === 0);

    konf = { CAI_USLUGODAWCA_IMIE_NAZWISKO: 'Anna Płaska', CAI_USLUGODAWCA_ADRES: 'a', CAI_USLUGODAWCA_TELEFON: '600100200', CAI_USLUGODAWCA_EMAIL: 'anna@example.com' };
    const plaski = (await pobierz('/dokumenty/uslugodawca?lang=en')).tekst;
    const przed = { ...process.env };
    process.env.CAI_USLUGODAWCA_IMIE_NAZWISKO = 'Ewa Środowiskowa';
    konf = null;
    const zEnv = (await pobierz('/dokumenty/uslugodawca?lang=pl')).tekst;
    for (const k of Object.keys(process.env)) if (!(k in przed)) delete process.env[k];
    Object.assign(process.env, przed);
    sprawdz('konfiguracja plaska (pola CAI_USLUGODAWCA_*) i bez konf (zmienne srodowiska) dzialaja jak obiekt uslugodawca',
      plaski.includes('Anna Płaska') && plaski.includes('mailto:anna@example.com') && zEnv.includes('Ewa Środowiskowa'));

    konf = PELNE;
    const txt = await pobierz('/dokumenty/regulamin?lang=pl&format=txt');
    sprawdz('format=txt: plik tekstowy do pobrania z wersja i danymi, bez HTML i bez skladni Markdown',
      txt.status === 200 && /^text\/plain; charset=utf-8$/.test(txt.h.get('content-type'))
      && /attachment; filename="content-ai-regulamin-[0-9a-z-]+-pl\.txt"/.test(txt.h.get('content-disposition') || '')
      && txt.tekst.startsWith('Regulamin serwisu Content AI\nWersja ') && txt.tekst.includes('Jan Testowy')
      && !/<a |<\/|\*\*|\]\(/.test(txt.tekst));

    const reg2 = await pobierz('/dokumenty/regulamin?lang=pl');
    sprawdz('naglowki: krotki Cache-Control, noindex, jezyk; strona bez skryptow',
      /max-age=(\d+)/.test(reg2.h.get('cache-control') || '') && Number(/max-age=(\d+)/.exec(reg2.h.get('cache-control'))[1]) <= 600
      && reg2.h.get('x-robots-tag') === 'noindex' && reg2.h.get('content-language') === 'pl'
      && reg2.tekst.includes('<meta name="robots" content="noindex">') && !/<script/i.test(reg2.tekst));
    sprawdz('odnosniki: przelacznik jezyka, spis tresci, lista dokumentow w stopce, pobranie jako tekst',
      reg2.tekst.includes('href="/dokumenty/regulamin?lang=en"') && reg2.tekst.includes('href="#par-9"')
      && dok.NAZWY.every((n) => reg2.tekst.includes(`href="/dokumenty/${n}?lang=pl"`)) && reg2.tekst.includes('aria-current="page"')
      && reg2.tekst.includes('href="/dokumenty/regulamin?lang=pl&amp;format=txt"'));

    const nieMa = await pobierz('/dokumenty/nie-ma-takiego?lang=en');
    sprawdz('nieznany dokument: 404 z lista dokumentow', nieMa.status === 404 && nieMa.tekst.includes('No such document') && nieMa.tekst.includes('/dokumenty/regulamin?lang=en'));
    const post = await pobierz('/dokumenty/regulamin', { method: 'POST' });
    sprawdz('POST: 405 z naglowkiem Allow', post.status === 405 && post.h.get('allow') === 'GET, HEAD');
    const head = await surowe(ADRES, '/dokumenty/regulamin?lang=pl', { method: 'HEAD' });
    sprawdz('HEAD: naglowki z dlugoscia, bez tresci', head.status === 200 && head.cialo.length === 0 && Number(head.h['content-length']) > 1000);
    const br = await surowe(ADRES, '/dokumenty/prywatnosc?lang=pl', { headers: { 'accept-encoding': 'br' } });
    const bezKompresji = await surowe(ADRES, '/dokumenty/prywatnosc?lang=pl');
    sprawdz('kompresja brotli przy Accept-Encoding: br, bez naglowka zwykly HTML',
      br.h['content-encoding'] === 'br' && /Accept-Encoding/.test(br.h.vary) && require('node:zlib').brotliDecompressSync(br.cialo).toString('utf8') === bezKompresji.cialo.toString('utf8'));

    const md = dok.markdownNaHtml('## A\n\n1. jeden\n   1. pod\n2. dwa\n\n| K | W |\n|---|---|\n| x | [z](javascript:alert(1)) [ok](https://example.com/a?b=1&c=2) |\n\nTekst http://example.com/x.');
    sprawdz('Markdown: zagniezdzone listy, tabela z naglowkiem wiersza, linki tylko http(s), mailto i wzgledne, adresy w tekscie',
      md.html.includes('<ol><li>jeden<ol><li>pod</li></ol></li><li>dwa</li></ol>') && md.html.includes('<th scope="row" data-et="K">x</th>')
      && !md.html.includes('javascript:') && md.html.includes('<a href="https://example.com/a?b=1&amp;c=2">ok</a>')
      && md.html.includes('<a href="http://example.com/x">http://example.com/x</a>.'));
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

module.exports = { uruchom };
