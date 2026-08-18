'use strict';

/**
 * Content AI - baza wiedzy z wyszukiwaniem po znaczeniu (RAG)
 *
 * Rozwiazanie jest odwzorowaniem tego z Cosmosa: tekst dzielimy na fragmenty,
 * liczymy dla nich wektory, a przy generowaniu dobieramy tylko te fragmenty,
 * ktore faktycznie pasuja do tematu. Rozni sie jedno: Cosmos liczy wektory
 * lokalnie na GPU (usluga senses, model bge-m3), a tutaj VPS nie ma karty,
 * wiec ide przez API NVIDIA - gdzie bge-m3 tez jest dostepny.
 *
 * Dlaczego to ma znaczenie: dotad aplikacja wklejala do promptu CALA tresc
 * kazdego zaznaczonego dokumentu. Koszt rosl liniowo z wielkoscia bazy,
 * przy wiekszej bazie konczyl sie kontekst, a trafne fragmenty tonely w szumie.
 *
 * Dwa zakresy bazy:
 *   prywatna  - dokumenty jednego uzytkownika, widoczne tylko dla niego
 *   wspolna   - dokumenty zespolu, widoczne dla wszystkich; dodaje admin
 *
 * Gdy wektorow nie da sie policzyc (brak klucza, awaria API), wyszukiwanie
 * schodzi na dopasowanie slow kluczowych - tak samo jak w Cosmosie. Gorzej,
 * ale dziala, zamiast nie dzialac wcale.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROZMIAR_FRAGMENTU = 1500;   // znakow - jak w Cosmosie
const MAKS_FRAGMENTOW = 60;       // na dokument; Cosmos ma 30, tu dokumenty bywaja dluzsze
const DOMYSLNIE_FRAGMENTOW = 8;   // ile fragmentow wraca do promptu

// ─── Dzielenie na fragmenty ───────────────────────────────────────────────────

function podzielNaFragmenty(tekst, rozmiar = ROZMIAR_FRAGMENTU, maks = MAKS_FRAGMENTOW) {
  const fragmenty = [];
  const t = String(tekst || '');
  for (let i = 0; i < t.length && fragmenty.length < maks; i += rozmiar) {
    const kawalek = t.slice(i, i + rozmiar).trim();
    if (kawalek) fragmenty.push(kawalek);
  }
  return fragmenty;
}

// ─── Podobienstwo ─────────────────────────────────────────────────────────────

function cosinus(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  let iloczyn = 0, normaA = 0, normaB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    iloczyn += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (!normaA || !normaB) return 0;
  return iloczyn / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

/** Awaryjne dopasowanie, gdy nie ma wektorow: ile slow zapytania jest we fragmencie. */
function dopasowanieSlow(zapytanie, tekst) {
  const slowa = String(zapytanie || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((s) => s.length > 3);
  if (!slowa.length) return 0;
  const dolny = String(tekst || '').toLowerCase();
  let trafienia = 0;
  for (const s of slowa) if (dolny.includes(s)) trafienia += 1;
  return trafienia / slowa.length;
}

// ─── Wektory ──────────────────────────────────────────────────────────────────

/**
 * Liczy wektory przez API zgodne z OpenAI (domyslnie NVIDIA NIM).
 * input_type rozroznia dokument od zapytania - modele retrieval oczekuja tego
 * rozroznienia i bez niego trafnosc spada.
 * Zwraca null przy dowolnym problemie; wolajacy ma wtedy zejsc na slowa kluczowe.
 */
async function policzWektory(teksty, konf, rodzaj = 'passage', fetchImpl = fetch) {
  if (!konf?.klucz || !teksty.length) return null;
  try {
    const odp = await fetchImpl(konf.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + konf.klucz },
      body: JSON.stringify({
        model: konf.model,
        input: teksty,
        input_type: rodzaj,
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(konf.timeoutMs || 60000),
    });
    if (!odp.ok) {
      console.error(`[baza] wektory HTTP ${odp.status}: ${(await odp.text().catch(() => '')).slice(0, 200)}`);
      return null;
    }
    const dane = await odp.json();
    const wektory = (dane?.data || []).map((d) => d?.embedding).filter(Array.isArray);
    return wektory.length === teksty.length ? wektory : null;
  } catch (e) {
    console.error('[baza] wektory:', e.message);
    return null;
  }
}

// ─── Przechowywanie ───────────────────────────────────────────────────────────
// Pliki JSON w serwer/dane/baza/. Dla zespolu tej wielkosci to wystarcza
// i nie wnosi zaleznosci; przy tysiacach dokumentow trzeba bedzie bazy.

const WSPOLNA = 'wspolna';

/** Login w nazwie pliku - tylko bezpieczne znaki, zeby nie dalo sie wyjsc z katalogu. */
function nazwaPliku(zakres, login) {
  if (zakres === WSPOLNA) return 'wspolna.json';
  const czysty = String(login || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!czysty) throw new Error('pusty login dla bazy prywatnej');
  return `u-${czysty}.json`;
}

function sciezka(katalog, zakres, login) {
  return path.join(katalog, nazwaPliku(zakres, login));
}

function wczytaj(katalog, zakres, login) {
  try {
    const dane = JSON.parse(fs.readFileSync(sciezka(katalog, zakres, login), 'utf8'));
    return Array.isArray(dane) ? dane : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[baza] odczyt:', e.message);
    return [];
  }
}

function zapisz(katalog, zakres, login, dokumenty) {
  fs.mkdirSync(katalog, { recursive: true });
  fs.writeFileSync(sciezka(katalog, zakres, login), JSON.stringify(dokumenty, null, 1), { mode: 0o600 });
}

// ─── Operacje ─────────────────────────────────────────────────────────────────

/** Metadane bez fragmentow i wektorow - to idzie do przegladarki. */
function opis(d) {
  return {
    id: d.id,
    nazwa: d.nazwa,
    zakres: d.zakres,
    wlasciciel: d.wlasciciel || null,
    dodany: d.dodany,
    znakow: d.znakow,
    fragmentow: (d.fragmenty || []).length,
    zWektorami: (d.fragmenty || []).some((f) => Array.isArray(f.wektor)),
  };
}

async function dodaj({ katalog, zakres, login, nazwa, tresc, konfWektorow }) {
  const fragmentyTekstu = podzielNaFragmenty(tresc);
  if (!fragmentyTekstu.length) throw new Error('dokument jest pusty');

  const wektory = await policzWektory(fragmentyTekstu, konfWektorow, 'passage');

  const dokument = {
    id: crypto.randomBytes(8).toString('hex'),
    nazwa: String(nazwa || 'bez nazwy').slice(0, 200),
    zakres,
    wlasciciel: zakres === WSPOLNA ? null : login,
    dodany: new Date().toISOString(),
    znakow: String(tresc).length,
    fragmenty: fragmentyTekstu.map((tekst, i) => ({ tekst, wektor: wektory ? wektory[i] : null })),
  };

  const lista = wczytaj(katalog, zakres, login);
  lista.push(dokument);
  zapisz(katalog, zakres, login, lista);
  return opis(dokument);
}

function lista({ katalog, login }) {
  return [
    ...wczytaj(katalog, WSPOLNA).map(opis),
    ...wczytaj(katalog, 'prywatna', login).map(opis),
  ];
}

function usun({ katalog, zakres, login, id }) {
  const dokumenty = wczytaj(katalog, zakres, login);
  const zostaja = dokumenty.filter((d) => d.id !== id);
  if (zostaja.length === dokumenty.length) return false;
  zapisz(katalog, zakres, login, zostaja);
  return true;
}

/**
 * Zwraca fragmenty najlepiej pasujace do zapytania - z bazy wspolnej i prywatnej.
 * Gdy sa wektory, liczy podobienstwo cosinusowe; gdy nie ma, dopasowanie slow.
 */
async function szukaj({ katalog, login, zapytanie, ile = DOMYSLNIE_FRAGMENTOW, konfWektorow }) {
  const dokumenty = [...wczytaj(katalog, WSPOLNA), ...wczytaj(katalog, 'prywatna', login)];
  if (!dokumenty.length) return { fragmenty: [], metoda: 'brak-dokumentow' };

  const maWektory = dokumenty.some((d) => (d.fragmenty || []).some((f) => Array.isArray(f.wektor)));
  const wektorZapytania = maWektory
    ? (await policzWektory([zapytanie], konfWektorow, 'query'))?.[0] || null
    : null;

  const wszystkie = [];
  for (const d of dokumenty) {
    for (const f of d.fragmenty || []) {
      const ocena = (wektorZapytania && Array.isArray(f.wektor))
        ? cosinus(wektorZapytania, f.wektor)
        : dopasowanieSlow(zapytanie, f.tekst);
      wszystkie.push({ dokument: d.nazwa, zakres: d.zakres, tekst: f.tekst, ocena });
    }
  }

  wszystkie.sort((a, b) => b.ocena - a.ocena);
  return {
    fragmenty: wszystkie.filter((f) => f.ocena > 0).slice(0, ile),
    metoda: wektorZapytania ? 'wektory' : 'slowa-kluczowe',
    przeszukano: wszystkie.length,
  };
}

/** Skleja znalezione fragmenty w blok gotowy do wstawienia w prompt. */
function doPromptu(wynik) {
  if (!wynik.fragmenty.length) return '';
  const linie = wynik.fragmenty.map(
    (f) => `### ${f.dokument}${f.zakres === WSPOLNA ? ' (wspólna)' : ''}\n${f.tekst}`
  );
  return `## WIEDZA FIRMOWA\n${linie.join('\n\n---\n\n')}\n\n`;
}

module.exports = {
  podzielNaFragmenty,
  cosinus,
  dopasowanieSlow,
  policzWektory,
  dodaj,
  lista,
  usun,
  szukaj,
  doPromptu,
  opis,
  nazwaPliku,
  WSPOLNA,
  ROZMIAR_FRAGMENTU,
  DOMYSLNIE_FRAGMENTOW,
};
