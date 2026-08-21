'use strict';

/**
 * Content AI -> OpenSEO: klient MCP
 *
 * OpenSEO wystawia swoje dane jako serwer MCP pod /mcp. W trybie Docker
 * (AUTH_MODE=local_noauth) endpoint nie wymaga zadnego tokenu, a my i tak
 * pukamy po petli zwrotnej - wiec Content AI moze pytac OpenSEO o dane
 * bez zadnej dodatkowej konfiguracji poza adresem kontenera.
 *
 * Protokol jest tu prostszy, niz sugeruje nazwa: pojedynczy POST z JSON-RPC,
 * bez handshake'u initialize i bez sesji (transport dziala bezstanowo,
 * potwierdza to dokumentacja OpenSEO). Odpowiedz przychodzi jako JSON albo
 * jako pojedyncze zdarzenie SSE - obslugujemy obie postaci.
 *
 * ─── Koszty ──────────────────────────────────────────────────────────────────
 * To jest najwazniejsza rzecz w tym pliku. Czesc narzedzi OpenSEO czyta tylko
 * jego wlasna baze i nie kosztuje nic. Czesc wola DataForSEO i jest platna
 * za zapytanie - z tego samego salda, ktorego uzywa Content AI.
 *
 * Dlatego kazde narzedzie jest tu jawnie zadeklarowane wraz z kosztem, a
 * wywolanie platnego wymaga podania platne:true przez wolajacego. Pomylka ma
 * skonczyc sie bledem, a nie cicho naliczonym rachunkiem.
 */

const http = require('node:http');

/**
 * Narzedzia, ktorych uzywa Content AI, wraz z kosztem.
 *   'darmowe' - czyta baze OpenSEO, zero wywolan DataForSEO
 *   'platne'  - wola DataForSEO, placisz za zapytanie
 */
const NARZEDZIA = {
  list_projects: 'darmowe',
  list_saved_keywords: 'darmowe',
  save_keywords: 'darmowe',
  get_project_context: 'darmowe',
  get_search_opportunities: 'darmowe', // czyta polaczone GSC i GA4, nie DataForSEO
  research_keywords: 'platne',
  get_serp_results: 'platne',
  get_keyword_metrics: 'platne',
  find_serp_competitors: 'platne',
  get_ranked_keywords: 'platne',
};

class BladOpenSeo extends Error {
  constructor(komunikat, status = 502) {
    super(komunikat);
    this.name = 'BladOpenSeo';
    this.status = status;
  }
}

/**
 * Wyciaga wiadomosc JSON-RPC z odpowiedzi. Transport moze oddac czysty JSON
 * albo strumien SSE z jednym zdarzeniem - w tym drugim przypadku interesuje
 * nas ostatnia linia "data:".
 */
function odpakuj(typTresci, tekst) {
  if (/text\/event-stream/i.test(typTresci || '')) {
    const linie = tekst.split(/\r?\n/).filter((l) => l.startsWith('data:'));
    if (!linie.length) throw new BladOpenSeo('pusty strumien SSE z OpenSEO');
    return JSON.parse(linie[linie.length - 1].slice(5).trim());
  }
  return JSON.parse(tekst);
}

/** Surowy POST na /mcp. Wydzielony, zeby dalo sie go podmienic w testach. */
function poslij(cialo, konf) {
  return new Promise((rozwiaz, odrzuc) => {
    const dane = Buffer.from(JSON.stringify(cialo), 'utf8');
    const zadanie = http.request(
      {
        host: konf.host,
        port: konf.port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          // Transport wymaga obu typow w Accept, nawet gdy odpowie czystym JSON-em.
          Accept: 'application/json, text/event-stream',
          'Content-Length': dane.length,
        },
        timeout: konf.timeoutMs || 120000,
      },
      (odp) => {
        const kawalki = [];
        odp.on('data', (c) => kawalki.push(c));
        odp.on('end', () => {
          const tekst = Buffer.concat(kawalki).toString('utf8');
          if (odp.statusCode >= 400) {
            return odrzuc(new BladOpenSeo(`OpenSEO odpowiedzialo ${odp.statusCode}: ${tekst.slice(0, 300)}`));
          }
          try {
            rozwiaz(odpakuj(odp.headers['content-type'], tekst));
          } catch (e) {
            odrzuc(new BladOpenSeo(`nieczytelna odpowiedz OpenSEO: ${e.message}`));
          }
        });
      }
    );
    zadanie.on('timeout', () => zadanie.destroy(new BladOpenSeo('przekroczony czas OpenSEO')));
    zadanie.on('error', (e) =>
      odrzuc(e instanceof BladOpenSeo ? e : new BladOpenSeo(`brak polaczenia z OpenSEO: ${e.message}`))
    );
    zadanie.end(dane);
  });
}

let licznik = 0;

/**
 * Wola narzedzie OpenSEO i zwraca jego dane.
 *
 * @param {string} narzedzie  nazwa z NARZEDZIA
 * @param {object} argumenty  argumenty narzedzia
 * @param {object} konf       { host, port, poslijImpl }
 * @param {object} opcje      { platne: true } - wymagane dla narzedzi platnych
 */
async function wolaj(narzedzie, argumenty, konf, opcje = {}) {
  const koszt = NARZEDZIA[narzedzie];
  if (!koszt) throw new BladOpenSeo(`nieznane narzedzie OpenSEO: ${narzedzie}`, 400);
  if (koszt === 'platne' && !opcje.platne) {
    throw new BladOpenSeo(`narzedzie ${narzedzie} jest platne - wymaga jawnej zgody`, 400);
  }

  licznik += 1;
  const odp = await (konf.poslijImpl || poslij)(
    {
      jsonrpc: '2.0',
      id: licznik,
      method: 'tools/call',
      params: { name: narzedzie, arguments: argumenty || {} },
    },
    konf
  );

  if (odp?.error) {
    throw new BladOpenSeo(`OpenSEO: ${odp.error.message || 'blad narzedzia'}`);
  }

  const wynik = odp?.result;
  if (!wynik) throw new BladOpenSeo('OpenSEO nie zwrocilo wyniku');

  // Blad narzedzia (np. brak projektu) przychodzi jako poprawna odpowiedz
  // z isError - tresc jest wtedy komunikatem dla czlowieka, nie danymi.
  if (wynik.isError) {
    const tekst = (wynik.content || []).map((c) => c?.text).filter(Boolean).join(' ');
    throw new BladOpenSeo(`OpenSEO: ${tekst || 'narzedzie zglosilo blad'}`, 400);
  }

  // structuredContent to dane; content to ten sam wynik opisany dla czlowieka.
  return wynik.structuredContent ?? { tekst: (wynik.content || []).map((c) => c?.text).join('\n') };
}

/** Czy kontener odpowiada. Uzywane przez /api/status - nie kosztuje nic. */
async function czyDziala(konf) {
  try {
    const odp = await (konf.poslijImpl || poslij)(
      { jsonrpc: '2.0', id: 0, method: 'tools/list' },
      { ...konf, timeoutMs: 5000 }
    );
    return Array.isArray(odp?.result?.tools) && odp.result.tools.length > 0;
  } catch (e) {
    return false;
  }
}

// ─── Ksztaltowanie danych pod Content AI ──────────────────────────────────────
// OpenSEO oddaje wiersze bogatsze, niz potrzebuje formularz. Sprowadzamy je do
// tego, co aplikacja faktycznie pokazuje, zeby nie przepychac do przegladarki
// kilkudziesieciu kilobajtow na kazde otwarcie okna.

/** Frazy zapisane w projekcie - z metrykami, jesli OpenSEO je ma w bazie. */
function frazyDoAplikacji(dane) {
  const wiersze = Array.isArray(dane?.rows) ? dane.rows : [];
  return {
    frazy: wiersze.map((w) => ({
      fraza: w.keyword || w.text || '',
      wolumen: liczbaAlboNull(w.searchVolume),
      trudnosc: liczbaAlboNull(w.keywordDifficulty),
      cpc: liczbaAlboNull(w.cpc),
      intencja: w.intent || null,
      tagi: Array.isArray(w.tags) ? w.tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean) : [],
    })).filter((f) => f.fraza),
    razem: Number(dane?.totalCount) || wiersze.length,
    tagi: (Array.isArray(dane?.tags) ? dane.tags : [])
      .map((t) => (typeof t === 'string' ? t : t?.name))
      .filter(Boolean),
  };
}

function projektyDoAplikacji(dane) {
  const lista = Array.isArray(dane?.projects) ? dane.projects : [];
  return lista.map((p) => ({ id: p.id, nazwa: p.name || p.id, domena: p.domain || p.url || null }));
}

/**
 * Brak metryki musi zostac brakiem. Number(null) i Number('') daja 0, wiec
 * bez tego sprawdzenia fraza bez danych pokazalaby sie jako "0 wyszukan
 * miesiecznie" - a to co innego niz "nie wiemy".
 */
function liczbaAlboNull(w) {
  if (w === null || w === undefined || w === '') return null;
  const n = Number(w);
  return Number.isFinite(n) ? n : null;
}

/**
 * Przebiera wyniki SERP z OpenSEO w koperte DataForSEO, zeby przepuscic je
 * przez serp.zbudujWynik bez duplikowania logiki wyciagania tematow i fraz.
 * Oba zrodla to i tak te same dane DataForSEO, tylko inaczej opakowane.
 *
 * Bledy pojedynczych fraz OpenSEO zwraca w batchu jako ok:false - traktujemy
 * je jak brak wynikow, bo wolamy zawsze o jedna fraze.
 */
function serpJakDataForSeo(dane, fraza) {
  const wyniki = Array.isArray(dane?.results) ? dane.results : [];
  const dlaFrazy = wyniki.find((w) => w?.keyword === fraza) || wyniki[0];
  const pozycje = dlaFrazy?.ok === false || !Array.isArray(dlaFrazy?.items) ? [] : dlaFrazy.items;

  return {
    tasks: [
      {
        result: [
          {
            items: pozycje.map((p) => ({
              // OpenSEO oddaje type jako null przy zwyklym wyniku organicznym,
              // a serp.zbudujWynik filtruje wlasnie po tym polu.
              type: p?.type || 'organic',
              rank_group: p?.rank ?? null,
              title: p?.title ?? null,
              description: p?.description ?? null,
              url: p?.url ?? null,
              domain: p?.domain ?? null,
            })),
          },
        ],
      },
    ],
  };
}

module.exports = {
  wolaj,
  czyDziala,
  odpakuj,
  frazyDoAplikacji,
  projektyDoAplikacji,
  serpJakDataForSeo,
  NARZEDZIA,
  BladOpenSeo,
};
