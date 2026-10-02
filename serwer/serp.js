'use strict';

/**
 * Content AI - dane SERP
 *
 * Aplikacja pyta o kontekst SERP zadaniem do modelu z narzedziem `web_search`
 * (funkcja Anthropic). To ma dwie wady:
 *   1. dane sa szacowane przez model, a nie mierzone - brak realnego wolumenu i trudnosci frazy,
 *   2. `web_search` nie istnieje poza Anthropic, wiec przy dostawcy `nvidia` znika.
 *
 * Ten modul daje dane SERP niezaleznie od modelu:
 *
 *   CAI_SERP=model       - domyslnie; zadanie idzie do modelu tak jak dotad
 *   CAI_SERP=dataforseo  - realne dane z API DataForSEO (to samo zrodlo, z ktorego
 *                          korzysta OpenSEO), niezaleznie od dostawcy modelu
 *
 * Odpowiedz ma zawsze ksztalt, ktorego oczekuje aplikacja:
 *   { context, topics[], phrases[], avgWords, avgH2 }
 */

const JEZYKI = {
  Polski: { kod: 'pl', lokalizacja: 2616, nazwa: 'Polish' },
  English: { kod: 'en', lokalizacja: 2840, nazwa: 'English' },
  Deutsch: { kod: 'de', lokalizacja: 2276, nazwa: 'German' },
  'Čeština': { kod: 'cs', lokalizacja: 2203, nazwa: 'Czech' },
};

function jezykDoDataForSeo(nazwaWAplikacji) {
  return JEZYKI[nazwaWAplikacji] || JEZYKI.Polski;
}

/**
 * Czy zadanie do /api jest zapytaniem o kontekst SERP?
 *
 * Kiedys wystarczalo samo narzedzie web_search, bo aplikacja dokladala je
 * tylko tu. Dzis dostaje je tez artykul z przelacznikiem sieci, monitor AI,
 * widocznosc i narracja - i wszystkie te zapytania trafialy w SERP: plan
 * darmowy dostawal 402 "Analiza SERP", a przy CAI_SERP=dataforseo artykul
 * przychodzil jako JSON z danymi SERP.
 *
 * Teraz rozpoznajemy tresc: fetchSerpContext (app/contentai.src.html) wysyla
 * prompt systemowy "Search for top Google results for the given keyword"
 * i wiadomosc "Keyword: <fraza>". Oba warunki naraz plus web_search. Naglowek
 * x-cai-czynnosc: serp tez wystarcza (z narzedziem), gdyby aplikacja go wyslala.
 */
const ZNAK_SERP = /search for top google results/i;

function czyZapytanieSerp(body, naglowki) {
  const narzedzia = body?.tools;
  if (!Array.isArray(narzedzia)) return false;
  const zWyszukiwaniem = narzedzia.some((t) => t && (t.name === 'web_search' || String(t.type || '').startsWith('web_search')));
  if (!zWyszukiwaniem) return false;
  if (String(naglowki?.['x-cai-czynnosc'] || '').toLowerCase() === 'serp') return true;
  return ZNAK_SERP.test(tekstSystemu(body)) && frazaZZadania(body) !== '';
}

/** Prompt systemowy jako tekst - bywa napisem albo lista blokow. */
function tekstSystemu(body) {
  const sys = body?.system;
  if (Array.isArray(sys)) return sys.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join(' ');
  return String(sys || '');
}

/** Wyciaga frazę z wiadomosci uzytkownika: "Keyword: <fraza>\n..." */
function frazaZZadania(body) {
  for (const m of body?.messages || []) {
    const tresc = typeof m.content === 'string'
      ? m.content
      : (m.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    const dopasowanie = /Keyword:\s*(.+)/i.exec(tresc || '');
    if (dopasowanie) return dopasowanie[1].split('\n')[0].trim();
  }
  return '';
}

/** Jezyk odczytany z promptu systemowego ("Write the context ... in Polish."). */
function jezykZZadania(body) {
  const sys = tekstSystemu(body);
  for (const [nazwaPl, dane] of Object.entries(JEZYKI)) {
    if (sys.includes(dane.nazwa)) return nazwaPl;
  }
  return 'Polski';
}

/**
 * Pobiera dane SERP z DataForSEO.
 * Uzywa dwoch endpointow: organicznych wynikow (tematy, frazy, kontekst)
 * oraz danych o frazach (wolumen), laczonych w jeden wynik.
 */
async function zDataForSeo(fraza, jezykAplikacji, konf, fetchImpl = fetch) {
  const jezyk = jezykDoDataForSeo(jezykAplikacji);
  const autoryzacja = 'Basic ' + Buffer.from(`${konf.login}:${konf.haslo}`).toString('base64');

  const odp = await fetchImpl('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: autoryzacja },
    body: JSON.stringify([
      {
        keyword: fraza,
        language_code: jezyk.kod,
        location_code: jezyk.lokalizacja,
        depth: 10,
      },
    ]),
    // Bez limitu zawieszone DataForSEO trzymaloby generowanie bez konca.
    signal: AbortSignal.timeout(konf.czasMs || 30000),
  });

  if (!odp.ok) {
    const tresc = await odp.text().catch(() => '');
    throw new Error(`DataForSEO HTTP ${odp.status}: ${tresc.slice(0, 200)}`);
  }

  const dane = await odp.json();
  return zbudujWynik(dane, fraza);
}

/** Przeksztalca odpowiedz DataForSEO na ksztalt oczekiwany przez aplikacje. */
function zbudujWynik(dane, fraza) {
  const pozycje = dane?.tasks?.[0]?.result?.[0]?.items || [];
  const organiczne = pozycje.filter((p) => p && p.type === 'organic').slice(0, 10);

  const tytuly = organiczne.map((p) => p.title).filter(Boolean);
  const opisy = organiczne.map((p) => p.description).filter(Boolean);

  // Tematy: najczestsze znaczace slowa z tytulow konkurencji
  const tematy = najczestszeSlowa(tytuly.join(' '), 8, fraza);
  // Frazy: najczestsze z opisow, bo tam siedzi jezyk, ktorym opisuje sie temat
  const frazy = najczestszeSlowa(opisy.join(' '), 10, fraza);

  const kontekst = opisy.length
    ? `Czolowe wyniki dla frazy "${fraza}" koncentruja sie na: ${tematy.slice(0, 5).join(', ')}. ` +
      `Przeanalizowano ${organiczne.length} wynikow organicznych.`
    : `Brak wynikow organicznych dla frazy "${fraza}".`;

  return {
    context: kontekst,
    topics: tematy,
    phrases: frazy,
    // DataForSEO nie zwraca dlugosci tresci konkurencji w tym endpoencie.
    // Zera sa uczciwsze niz zmyslona liczba - aplikacja traktuje je jako brak danych.
    avgWords: 0,
    avgH2: 0,
    zrodlo: 'dataforseo',
    wynikow: organiczne.length,
  };
}

// Slowa pomijane przy zliczaniu - nie niosa tresci
const STOP = new Set(
  ('i oraz w we na do od za po z ze o u a ale lub czy jak to ten ta te tego tej dla przez'
    + ' the a an and or of for to in on at is are was were be by with from your you it its this that'
    + ' der die das und oder fur mit von den dem des ein eine').split(/\s+/)
);

function najczestszeSlowa(tekst, ile, fraza) {
  const slowaFrazy = new Set(fraza.toLowerCase().split(/\s+/));
  const licznik = new Map();
  for (const slowo of String(tekst).toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
    if (slowo.length < 4 || STOP.has(slowo) || slowaFrazy.has(slowo)) continue;
    licznik.set(slowo, (licznik.get(slowo) || 0) + 1);
  }
  return [...licznik.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, ile)
    .map(([slowo]) => slowo);
}

module.exports = {
  czyZapytanieSerp,
  frazaZZadania,
  jezykZZadania,
  jezykDoDataForSeo,
  zDataForSeo,
  zbudujWynik,
  najczestszeSlowa,
};
