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
 *   wspolna   - dokumenty organizacji, widoczne dla jej kont; dodaje ten, kto nia
 *               zarzadza (dzierzawy.mozeZarzadzac: w organizacji glownej admin,
 *               w samoobslugowej jej wlasciciel). Organizacja glowna ma dzisiejszy
 *               plik wspolna.json, kazda inna wlasny wspolna-<id>.json (ARCH8-09,
 *               SEC8-50: dokumenty zespolu nie trafiaja do obcych kont).
 *
 * Gdy wektorow nie da sie policzyc (brak klucza, awaria API), wyszukiwanie
 * schodzi na dopasowanie slow kluczowych - tak samo jak w Cosmosie. Gorzej,
 * ale dziala, zamiast nie dzialac wcale.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pliki = require('./pliki.js');
const dzierzawy = require('./dzierzawy.js');

const ROZMIAR_FRAGMENTU = 1500;   // znakow - jak w Cosmosie
const MAKS_FRAGMENTOW = 60;       // na dokument; Cosmos ma 30, tu dokumenty bywaja dluzsze
const DOMYSLNIE_FRAGMENTOW = 8;   // ile fragmentow wraca do promptu
// Ile znakow dokumentu trafia do bazy (KOD8-11): dluzszy dokument jest ucinany, ale juz
// nie po cichu - odpowiedz zapisu ma uciety/zapisanoZnakow/znakow, a lista limitZnakow.
const LIMIT_ZNAKOW = ROZMIAR_FRAGMENTU * MAKS_FRAGMENTOW;

// ─── Dzielenie na fragmenty ───────────────────────────────────────────────────

function podzielNaFragmenty(tekst, rozmiar = ROZMIAR_FRAGMENTU, maks = MAKS_FRAGMENTOW) {
  return podzielZZasiegiem(tekst, rozmiar, maks).fragmenty;
}

/** Fragmenty i zasieg: do ktorego znaku tekst trafil do fragmentow (reszta odpada, KOD8-11). */
function podzielZZasiegiem(tekst, rozmiar = ROZMIAR_FRAGMENTU, maks = MAKS_FRAGMENTOW) {
  const fragmenty = [];
  const t = String(tekst || '');
  let i = 0;
  for (; i < t.length && fragmenty.length < maks; i += rozmiar) {
    const kawalek = t.slice(i, i + rozmiar).trim();
    if (kawalek) fragmenty.push(kawalek);
  }
  return { fragmenty, zasieg: Math.min(i, t.length) };
}

// ─── Podobienstwo ─────────────────────────────────────────────────────────────

function cosinus(a, b) {
  if (!(Array.isArray(a) || ArrayBuffer.isView(a)) || !(Array.isArray(b) || ArrayBuffer.isView(b))) return 0;
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

/**
 * Nazwa pliku w katalogu bazy. Login (prywatna) tylko z bezpiecznymi znakami, zeby nie
 * dalo sie wyjsc z katalogu; baza wspolna wg organizacji (dzierzawy: 'glowna' ->
 * wspolna.json jak dzis, inne -> wspolna-<id>.json, identyfikator sprawdzany wzorcem).
 */
function nazwaPliku(zakres, login, organizacja = dzierzawy.GLOWNA) {
  if (zakres === WSPOLNA) return dzierzawy.nazwaPlikuBazyWspolnej(organizacja || dzierzawy.GLOWNA);
  const czysty = String(login || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!czysty) throw new Error('pusty login dla bazy prywatnej');
  return `u-${czysty}.json`;
}

function sciezka(katalog, zakres, login, organizacja) {
  return path.join(katalog, nazwaPliku(zakres, login, organizacja));
}

// ─── Pamiec podreczna plikow bazy (SEC8-30) ─────────────────────────────────
// Kazde wyszukiwanie (kazde generowanie z baza) i kazda lista czytaly i parsowaly CALY
// plik z wektorami: 50 dokumentow to ok. 88 MB JSON i ok. 0,9 s zatrzymanej petli zdarzen
// dla wszystkich. Teraz plik parsujemy raz na wersje (i-wezel, rozmiar, czas zmiany),
// a kolejne odczyty biora gotowe dokumenty z pamieci. Budzet: 64 MB rozmiaru plikow,
// najdawniej uzywane wypadaja pierwsze; plik wiekszy od budzetu nie trafia do pamieci.
// Zmiana pliku z zewnatrz (CLI, kopia) zmienia jego wersje, wiec odczyt jest swiezy.

const PAMIEC = new Map();           // sciezka -> { wersja, dokumenty, bajty }
const PAMIEC_BAJTOW = 64 * 1024 * 1024;
let pamiecBajtow = 0;

function wersjaPliku(st) {
  return `${st.ino}:${st.size}:${st.mtimeMs}`;
}

function zapomnij(plik) {
  const byl = PAMIEC.get(plik);
  if (byl) { pamiecBajtow -= byl.bajty; PAMIEC.delete(plik); }
}

function zapamietaj(plik, wersja, dokumenty, bajty) {
  zapomnij(plik);
  if (bajty > PAMIEC_BAJTOW) return;
  while (pamiecBajtow + bajty > PAMIEC_BAJTOW && PAMIEC.size) zapomnij(PAMIEC.keys().next().value);
  PAMIEC.set(plik, { wersja, dokumenty, bajty });
  pamiecBajtow += bajty;
}

// Brak pliku = pusta baza. Uszkodzony plik to BladDanych (503), a nie pusta
// lista - inaczej nastepne dodanie nadpisaloby resztki jednym dokumentem.
// Zwrocona tablica jest wspolna z pamiecia podreczna: wolajacy jej nie zmienia.
function wczytaj(katalog, zakres, login, organizacja) {
  const plik = sciezka(katalog, zakres, login, organizacja);
  let st;
  try {
    st = fs.statSync(plik);
  } catch (e) {
    if (e.code === 'ENOENT') { zapomnij(plik); return []; }
    throw new pliki.BladDanych(plik, e.code || e.message);
  }
  const wersja = wersjaPliku(st);
  const byl = PAMIEC.get(plik);
  if (byl && byl.wersja === wersja) {
    PAMIEC.delete(plik);                    // na koniec kolejki: ostatnio uzywany
    PAMIEC.set(plik, byl);
    return byl.dokumenty;
  }
  const dokumenty = pliki.czytajJson(plik, [], pliki.czyTablica);
  zapamietaj(plik, wersja, dokumenty, st.size);
  return dokumenty;
}

function zapisz(katalog, zakres, login, dokumenty, organizacja) {
  const plik = sciezka(katalog, zakres, login, organizacja);
  zapomnij(plik);
  pliki.zapiszJson(plik, dokumenty, 1);
  try {
    const st = fs.statSync(plik);
    zapamietaj(plik, wersjaPliku(st), dokumenty, st.size);
  } catch { /* nastepny odczyt przeczyta plik */ }
}

/** Do testow: czysci pamiec podreczna plikow bazy. */
function wyczyscPamiec() {
  PAMIEC.clear();
  pamiecBajtow = 0;
}

// ─── Operacje ─────────────────────────────────────────────────────────────────

// ─── Adres strony dokumentu ───────────────────────────────────────────────────
// R6-F (E-13): strona dodana do bazy z adresu ma ten adres takze na serwerze, zeby
// sugestie linkow wewnetrznych widzialy Baze na serwerze (wczesniej lista nie miala
// adresow, wiec zakladka Linki byla w wariancie z serwerem zawsze pusta).
// Zrodla adresu: pole url przy dodawaniu albo naglowek "Zrodlo: URL" na poczatku tresci
// (tak aplikacja zapisuje strony, takze w dokumentach dodanych przed ta zmiana).

/** Adres http(s) albo pusty napis - nic innego nie trafia do listy. */
function czystyAdres(adres) {
  const t = String(adres || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(t) || t.length > 2000) return '';
  try { return new URL(t).href; } catch { return ''; }
}

/** Adres z naglowka "Zrodlo: URL" (albo "[Zrodlo: URL]", z ogonkami lub bez) na poczatku tresci. */
function adresZTresci(tresc) {
  const m = /^\s*\[?(?:Źródło|Zrodlo|Source)\s*:\s*(https?:\/\/[^\s\]]+)/i.exec(String(tresc || '').slice(0, 2100));
  return m ? czystyAdres(m[1]) : '';
}

/** Metadane bez fragmentow i wektorow - to idzie do przegladarki. */
function opis(d) {
  const zapisanoZnakow = Number.isFinite(d.zapisanoZnakow) ? d.zapisanoZnakow : d.znakow;
  return {
    id: d.id,
    nazwa: d.nazwa,
    zakres: d.zakres,
    wlasciciel: d.wlasciciel || null,
    dodany: d.dodany,
    znakow: d.znakow,
    fragmentow: (d.fragmenty || []).length,
    zWektorami: (d.fragmenty || []).some((f) => Array.isArray(f.wektor)),
    url: czystyAdres(d.url) || adresZTresci(((d.fragmenty || [])[0] || {}).tekst),
    // KOD8-11: dokument dluzszy niz LIMIT_ZNAKOW jest ucinany - jawnie, z liczbami.
    uciety: Number.isFinite(d.zapisanoZnakow) && d.zapisanoZnakow < d.znakow,
    zapisanoZnakow,
  };
}

// ─── Tresc, ktorej nie da sie uzyc (KOD8-15) ─────────────────────────────────
// Przegladarka czyta pliki sama i wysyla tekst. Trzy przypadki dawaly smieci w bazie
// (i w promptach) z komunikatem "Dodano": CSV z polskiego Excela (Windows-1250 czytany
// jako UTF-8 -> znaki zastepcze), stary .doc/.ppt/.xls i obraz upuszczony na strefe
// (bajty jako tekst). Serwer odmawia z jasnym komunikatem, zanim cokolwiek zapisze.

const STARE_FORMATY = /\.(doc|ppt|pps|xls|wps|rtf)$/i;
const OBRAZY = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif|ico|psd)$/i;

/** null albo { powod: 'stary-format'|'obraz'|'plik-binarny'|'kodowanie', komunikat, komunikatEn }. */
function sprawdzTresc(nazwa, tresc) {
  const n = String(nazwa || '').trim();
  const t = String(tresc || '');
  if (STARE_FORMATY.test(n)) {
    return {
      powod: 'stary-format',
      komunikat: 'To stary format pakietu Office (.doc, .ppt, .xls). Zapisz plik jako DOCX, PPTX, XLSX albo PDF i dodaj go jeszcze raz.',
      komunikatEn: 'This is an old Office format (.doc, .ppt, .xls). Save the file as DOCX, PPTX, XLSX or PDF and add it again.',
    };
  }
  if (OBRAZY.test(n)) {
    return {
      powod: 'obraz',
      komunikat: 'To jest obraz, a baza wiedzy przyjmuje dokumenty z tekstem (PDF, DOCX, TXT, CSV, XLSX). Tekst z obrazu przepisz albo wklej jako notatkę.',
      komunikatEn: 'This is an image, but the knowledge base takes text documents (PDF, DOCX, TXT, CSV, XLSX). Type or paste the text from the image as a note.',
    };
  }
  const probka = t.length > 200000 ? t.slice(0, 200000) : t;
  let sterujace = 0;
  let zastepcze = 0;
  for (let i = 0; i < probka.length; i += 1) {
    const k = probka.charCodeAt(i);
    if (k === 0xfffd) zastepcze += 1;
    else if (k < 32 && k !== 9 && k !== 10 && k !== 13 && k !== 12) sterujace += 1;
  }
  if (probka.includes('\u0000') || sterujace > Math.max(8, probka.length * 0.01)) {
    return {
      powod: 'plik-binarny',
      komunikat: 'Ten plik nie wygląda na dokument tekstowy (np. obraz albo plik programu). Dodaj PDF, DOCX, TXT, CSV albo XLSX.',
      komunikatEn: 'This file does not look like a text document (for example an image or a program file). Add a PDF, DOCX, TXT, CSV or XLSX file.',
    };
  }
  if (zastepcze >= 3 && zastepcze > probka.length * 0.001) {
    return {
      powod: 'kodowanie',
      komunikat: 'Plik ma znaki, których nie da się odczytać (np. CSV z Excela zapisany w kodowaniu Windows-1250). Zapisz go jako „CSV UTF-8” albo dodaj jako XLSX.',
      komunikatEn: 'The file has characters that cannot be read (for example a CSV saved by Excel in a legacy encoding). Save it as "CSV UTF-8" or add it as XLSX.',
    };
  }
  return null;
}

async function dodaj({ katalog, zakres, login, nazwa, tresc, url, konfWektorow, organizacja }) {
  const pelny = String(tresc || '');
  const { fragmenty: fragmentyTekstu, zasieg } = podzielZZasiegiem(pelny);
  if (!fragmentyTekstu.length) throw new Error('dokument jest pusty');

  const wektory = await policzWektory(fragmentyTekstu, konfWektorow, 'passage');

  const dokument = {
    id: crypto.randomBytes(8).toString('hex'),
    nazwa: String(nazwa || 'bez nazwy').slice(0, 200),
    zakres,
    wlasciciel: zakres === WSPOLNA ? null : login,
    dodany: new Date().toISOString(),
    znakow: pelny.length,
    url: czystyAdres(url) || adresZTresci(pelny),
    fragmenty: fragmentyTekstu.map((tekst, i) => ({ tekst, wektor: wektory ? wektory[i] : null })),
  };
  // Dalsza czesc tekstu (poza zasiegiem fragmentow) nie trafia do bazy: zapisujemy, ile weszlo.
  if (zasieg < pelny.length && pelny.slice(zasieg).trim()) dokument.zapisanoZnakow = zasieg;

  const lista = wczytaj(katalog, zakres, login, organizacja).slice();
  lista.push(dokument);
  zapisz(katalog, zakres, login, lista, organizacja);
  return opis(dokument);
}

/** Dokumenty widoczne dla konta: baza wspolna JEGO organizacji i jego prywatna. */
function lista({ katalog, login, organizacja }) {
  return [
    ...wczytaj(katalog, WSPOLNA, null, organizacja).map(opis),
    ...wczytaj(katalog, 'prywatna', login).map(opis),
  ];
}

function usun({ katalog, zakres, login, id, organizacja }) {
  const dokumenty = wczytaj(katalog, zakres, login, organizacja);
  const zostaja = dokumenty.filter((d) => d.id !== id);
  if (zostaja.length === dokumenty.length) return false;
  zapisz(katalog, zakres, login, zostaja, organizacja);
  return true;
}

/**
 * Zwraca fragmenty najlepiej pasujace do zapytania - z bazy wspolnej organizacji konta
 * i z jego prywatnej. Gdy sa wektory, liczy podobienstwo cosinusowe; gdy nie ma, dopasowanie slow.
 */
async function szukaj({ katalog, login, zapytanie, ile = DOMYSLNIE_FRAGMENTOW, konfWektorow, organizacja }) {
  const dokumenty = [...wczytaj(katalog, WSPOLNA, null, organizacja), ...wczytaj(katalog, 'prywatna', login)];
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
  podzielZZasiegiem,
  sprawdzTresc,
  wyczyscPamiec,
  LIMIT_ZNAKOW,
  cosinus,
  dopasowanieSlow,
  policzWektory,
  dodaj,
  lista,
  usun,
  szukaj,
  doPromptu,
  opis,
  adresZTresci,
  nazwaPliku,
  WSPOLNA,
  ROZMIAR_FRAGMENTU,
  DOMYSLNIE_FRAGMENTOW,
};
