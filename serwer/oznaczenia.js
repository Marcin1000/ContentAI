'use strict';

// ─── Oznaczanie tresci AI (art. 50 AI Act) - konfiguracja (wykonawca D) ──────
//
// PROJEKT-TECHNICZNY rozdz. 9.1 (ARCH8-22), wartosci domyslne etykiet widocznych
// wg DECYZJE-R9 M-5 / D-08: tekst wylaczona, grafika wylaczona (z pytaniem przy
// eksporcie), audio wlaczona; oznaczenia maszynowe zawsze. Teksty etykiet PL i EN
// z AG/runda8/prawo/zgody-i-komunikaty.md; DE i CS do potwierdzenia przez prawo.
//
// Wynik prawa wchodzi tu bez zmian w kodzie aplikacji: stala jedzie do aplikacji
// w /api/konto.oznaczenia (dlaKonta), a aplikacja ma te sama wartosc jako
// OZNACZENIA_DOMYSLNE dla wariantow keys i owner (testy-oznaczenia.js porownuje obie:
// zmiana tutaj = ta sama zmiana w app/contentai.src.html).
//
// Gdzie aplikacja uzywa pol (R9-D, rozdz. 9.2 projektu):
//   zrodloIptc / zrodloSchema      - tekst, grafika i nagranie wygenerowane przez AI (PR8-18, tabela 3.2):
//                                    XMP w PNG, ID3 w MP3, wlasciwosci DOCX, PDF, data-ai-* w CMS, JSON-LD;
//   zrodloIptcZlozone / ...Schema  - wlasny tekst uzytkownika istotnie przerobiony przez AI ("Popraw wklejony tekst");
//   slowaKluczowe                  - cp:keywords w DOCX i /Keywords w PDF;
//   <rodzaj>.etykieta              - wartosc przelacznika widocznej etykiety, gdy uzytkownik nic nie wybral;
//   tekst.tresc / tekst.krotka     - etykieta pod tekstem (pliki, schowek, CMS) / pod przerobka (posty, newsletter);
//   grafika.tresc                  - napis w rogu grafiki (nowy plik PNG z naszym XMP; oryginal obok);
//   audio.tresc                    - zapowiedz glosowa na poczatku nagrania (jedno dodatkowe wywolanie TTS);
//   publikacja.atrybuty            - data-ai-* na tresci wpisu do WordPressa i Drupala.

const OZNACZENIA = {
  wersja: 1,                                   // podnoszona przy kazdej zmianie znaczenia pol
  system: 'Content AI',
  adresInformacji: 'https://content-ai.net/ai-act/',   // strona "AI Act i przejrzystosc"
  adresInformacjiEn: 'https://content-ai.net/en/ai-act/',
  zrodloIptc: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  zrodloSchema: 'https://schema.org/TrainedAlgorithmicMediaDigitalSource',
  zrodloIptcZlozone: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
  zrodloSchemaZlozone: 'https://schema.org/CompositeWithTrainedAlgorithmicMediaDigitalSource',
  slowaKluczowe: 'AI-generated; trainedAlgorithmicMedia; Content AI',
  // etykieta: 'zawsze' | 'domyslnie-wlaczona' | 'domyslnie-wylaczona' | 'nigdy'
  // (dwie srodkowe wartosci uzytkownik zmienia przelacznikiem; wybor w koncie: konta.oznaczenia)
  tekst: {
    metadane: true,                            // DOCX, PDF, HTML do CMS, JSON-LD
    etykieta: 'domyslnie-wylaczona',           // art. 50 ust. 4 to obowiazek uzytkownika (M-5)
    miejsce: 'koniec',                         // 'poczatek' | 'koniec'
    tresc: {                                   // w jezyku ARTYKULU, nie interfejsu
      pl: 'Ten tekst powstał z pomocą sztucznej inteligencji (Content AI).',
      en: 'This text was created with the help of artificial intelligence (Content AI).',
      de: 'Dieser Text wurde mit Hilfe künstlicher Intelligenz erstellt (Content AI).',
      cs: 'Tento text vznikl s pomocí umělé inteligence (Content AI).',
    },
    krotka: {                                  // posty z "Przerob na..." (LinkedIn, Facebook, newsletter)
      pl: 'Przygotowano z pomocą AI.',
      en: 'Prepared with the help of AI.',
      de: 'Mit Hilfe von KI erstellt.',
      cs: 'Připraveno s pomocí AI.',
    },
  },
  grafika: {
    metadane: true,                            // XMP w PNG; PNG z C2PA dostawcy zostaje nietkniety
    etykieta: 'domyslnie-wylaczona',           // D-08: z pytaniem przy eksporcie
    miejsce: 'prawy-dol',
    tresc: {
      pl: 'Grafika wygenerowana przez AI',
      en: 'AI-generated image',
      de: 'KI-generiertes Bild',
      cs: 'Obrázek vytvořený umělou inteligencí',
    },
  },
  audio: {
    metadane: true,                            // ID3v2.4 w MP3
    etykieta: 'domyslnie-wlaczona',            // zapowiedz glosowa na poczatku
    tresc: {
      pl: 'Ten materiał odczytuje syntetyczny głos wygenerowany przez sztuczną inteligencję.',
      en: 'This audio is read by an AI-generated synthetic voice.',
      de: 'Dieses Audio wird von einer KI-generierten synthetischen Stimme gelesen.',
      cs: 'Tento záznam čte syntetický hlas vytvořený umělou inteligencí.',
    },
  },
  publikacja: { atrybuty: true },              // data-ai-* w HTML do WordPressa i Drupala
};

const RODZAJE = ['tekst', 'grafika', 'audio'];

/** Wartosc przelacznika uzytkownika, gdy nic nie wybral: z `etykieta` rodzaju. */
function domyslnyWybor(rodzaj) {
  const e = OZNACZENIA[rodzaj].etykieta;
  return e === 'zawsze' || e === 'domyslnie-wlaczona';
}

/**
 * Sekcja `oznaczenia` odpowiedzi /api/konto: stala + wybor uzytkownika.
 *   dlaKonta(konto, konf) -> { ...OZNACZENIA, wlaczone, uzytkownik: { tekst, grafika, audio } }
 * wlaczone=false przy CAI_OZNACZENIA=0 (awaryjne wylaczenie). Wartosci 'zawsze' i 'nigdy'
 * nie daja sie zmienic przelacznikiem.
 */
function dlaKonta(konto, konf = {}) {
  const zapisane = (konto && konto.oznaczenia && typeof konto.oznaczenia === 'object') ? konto.oznaczenia : {};
  const uzytkownik = {};
  for (const rodzaj of RODZAJE) {
    const e = OZNACZENIA[rodzaj].etykieta;
    if (e === 'zawsze') uzytkownik[rodzaj] = true;
    else if (e === 'nigdy') uzytkownik[rodzaj] = false;
    else uzytkownik[rodzaj] = typeof zapisane[rodzaj] === 'boolean' ? zapisane[rodzaj] : domyslnyWybor(rodzaj);
  }
  return { ...OZNACZENIA, wlaczone: konf.oznaczenia !== false, uzytkownik };
}

/**
 * Walidacja POST /api/konto/ustawienia { oznaczenia: { tekst?, grafika?, audio? } }:
 * tylko znane pola i wartosci logiczne. -> { ok: true, oznaczenia } | { ok: false, pole }
 */
function sprawdzUstawienia(dane) {
  if (!dane || typeof dane !== 'object' || Array.isArray(dane)) return { ok: false, pole: 'oznaczenia' };
  const wynik = {};
  for (const [pole, wartosc] of Object.entries(dane)) {
    if (!RODZAJE.includes(pole) || typeof wartosc !== 'boolean') return { ok: false, pole };
    wynik[pole] = wartosc;
  }
  return { ok: true, oznaczenia: wynik };
}

/**
 * Laczy zapisany wybor konta z nowym (POST /api/konto/ustawienia wysyla zwykle jeden rodzaj):
 * zostaja tylko znane rodzaje, nowe wartosci nadpisuja stare. -> wartosc kolumny konta `oznaczenia`.
 */
function polaczWybor(zapisane, nowe) {
  const wynik = {};
  const stare = (zapisane && typeof zapisane === 'object' && !Array.isArray(zapisane)) ? zapisane : {};
  const dalej = (nowe && typeof nowe === 'object') ? nowe : {};
  for (const rodzaj of RODZAJE) {
    if (typeof dalej[rodzaj] === 'boolean') wynik[rodzaj] = dalej[rodzaj];
    else if (typeof stare[rodzaj] === 'boolean') wynik[rodzaj] = stare[rodzaj];
  }
  return wynik;
}

/** Kod pochodzenia (IPTC i schema.org): 'zlozone' = tekst uzytkownika przerobiony przez AI, inaczej tresc z AI. */
function zrodloDla(pochodzenie) {
  return pochodzenie === 'zlozone'
    ? { iptc: OZNACZENIA.zrodloIptcZlozone, schema: OZNACZENIA.zrodloSchemaZlozone }
    : { iptc: OZNACZENIA.zrodloIptc, schema: OZNACZENIA.zrodloSchema };
}

module.exports = { OZNACZENIA, RODZAJE, dlaKonta, sprawdzUstawienia, domyslnyWybor, polaczWybor, zrodloDla };
