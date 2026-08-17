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

console.log(`\n  ${zaliczone} zaliczonych, ${bledy.length} bledow\n`);
if (bledy.length) {
  for (const b of bledy) console.error(`  nie przeszlo: ${b}`);
  process.exit(1);
}
