'use strict';

// ─── Dokumenty prawne: GET /dokumenty/<nazwa> ────────────────────────────────
//
// Regulamin, polityka prywatnosci, pouczenie o odstapieniu z wzorem formularza, umowa powierzenia (DPA),
// wersjonowana lista podprzetwarzajacych (PR8-30) i strona "Dane uslugodawcy", po polsku i po angielsku.
//
// Tresc to szablony w repozytorium (dokumenty-prawne/<nazwa>.<pl|en>.md), ale dane uslugodawcy (osoba
// fizyczna: imie i nazwisko, adres, telefon, e-mail) przychodza WYLACZNIE z konfiguracji serwera
// (CAI_USLUGODAWCA_IMIE_NAZWISKO, _ADRES, _TELEFON, _EMAIL, _WWW) i nigdy nie trafiaja do repozytorium
// (DECYZJE-R9). Puste pole = na stronie widoczny znacznik "do uzupelnienia", a w trybie live platnosci
// (PLATNOSCI_TRYB=live) ostrzezenie w dzienniku - raz przy starcie i raz na kazdy brakujacy zestaw.
//
// Kontrakt z trasa w server.js (etap 0): obsluz(req, res, { nazwa, jezyk, konf }). Trasa ustawia naglowki
// bezpieczenstwa jak dla innych stron serwera; tu: tresc, Content-Type, krotki Cache-Control i noindex
// (dokumenty sa publiczne, ale adres osoby fizycznej nie musi trafiac do wyszukiwarek).
// ?format=txt oddaje ten sam dokument jako plik tekstowy do pobrania (regulamin par. 1 ust. 5).
//
// Skladnia szablonow (podzbior Markdown, bez zaleznosci npm):
//   --- tytul / wersja / data ---   naglowek; wersja ta sama w PL i EN i w CAI_REGULAMIN_WERSJA (zgody)
//   <!-- ... -->                    notatki dla prawnika i ksiegowej, nie trafiaja na strone
//   ## Tytul {#kotwica}             naglowki; akapity; listy "1." i "-" (zagniezdzone o 3 spacje);
//                                   tabele z "|"; **pogrubienie**; [tekst](adres); adresy http(s) jako linki
//   WSTAW_TUTAJ_*                   dane uslugodawcy z konfiguracji (POLA nizej)
//   {{NAZWA}}                       wartosci liczone przez serwer: adresy dokumentow, wersje, limity
//   {{?warunek}} ... {{/warunek}}   wiersze widoczne tylko przy wlaczonej usludze (nvidia, dataforseo,
//                                   elevenlabs); produkcja ich nie ma, wiec domyslnie sa ukryte
//   {{DO_UZUPELNIENIA: opis}}       luka w samym szablonie: widoczny znacznik, jak przy pustym polu

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const KATALOG = path.join(__dirname, '..', 'dokumenty-prawne');
const NAZWY = Object.freeze(['regulamin', 'prywatnosc', 'odstapienie', 'dpa', 'podprzetwarzajacy', 'uslugodawca']);
const JEZYKI = Object.freeze(['pl', 'en']);
const ADRES_APLIKACJI = 'https://app.content-ai.net';
const ADRES_STRONY = 'https://content-ai.net';
const ZALEGLA_DNI = 7;          // PLATNOSCI_ZALEGLA_DNI (wykonawca B), gdy konfiguracja milczy
const LIMIT_DARMOWY = 3;        // gdy serwer/plany.js nie da sie odczytac

// Znacznik w szablonie -> pole danych uslugodawcy -> zmienna srodowiska.
const POLA = Object.freeze({
  WSTAW_TUTAJ_IMIE_I_NAZWISKO: 'imieNazwisko',
  WSTAW_TUTAJ_ADRES: 'adres',
  WSTAW_TUTAJ_TELEFON: 'telefon',
  WSTAW_TUTAJ_EMAIL: 'email',
  WSTAW_TUTAJ_WWW: 'www',
});
const ZMIENNE = Object.freeze({
  imieNazwisko: 'CAI_USLUGODAWCA_IMIE_NAZWISKO',
  adres: 'CAI_USLUGODAWCA_ADRES',
  telefon: 'CAI_USLUGODAWCA_TELEFON',
  email: 'CAI_USLUGODAWCA_EMAIL',
  www: 'CAI_USLUGODAWCA_WWW',
});
// Nazwy pol w obiekcie konf.uslugodawca (etap 0 moze nazwac je po swojemu) i stara nazwa z projektu.
const ALIASY = Object.freeze({
  imieNazwisko: ['imieNazwisko', 'imieINazwisko', 'imie_nazwisko', 'nazwa', 'IMIE_NAZWISKO', 'CAI_USLUGODAWCA_IMIE_NAZWISKO', 'CAI_USLUGODAWCA_NAZWA'],
  adres: ['adres', 'ADRES', 'CAI_USLUGODAWCA_ADRES'],
  telefon: ['telefon', 'TELEFON', 'CAI_USLUGODAWCA_TELEFON'],
  email: ['email', 'EMAIL', 'CAI_USLUGODAWCA_EMAIL'],
  www: ['www', 'WWW', 'strona', 'CAI_USLUGODAWCA_WWW'],
});
const WZOR_EMAIL = /^[^\s@<>"']+@[^\s@<>"'.]+(\.[^\s@<>"'.]+)+$/;
const WZOR_WWW = /^https?:\/\/[^\s"'<>]+$/i;

const MIESIACE = {
  pl: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const T = {
  pl: {
    lang: 'pl',
    etykieta: 'Dokumenty Content AI',
    wersja: (w, d) => `Wersja ${w} z ${d}`,
    pobierz: 'Pobierz jako tekst',
    pdf: 'Zapis do PDF: polecenie Drukuj w przeglądarce.',
    przelacz: 'English',
    przelaczOpis: 'Read this document in English',
    przejdz: 'Przejdź do treści',
    spis: 'Spis treści',
    dokumenty: 'Dokumenty',
    glowna: 'Strona główna Content AI',
    brak: 'do uzupełnienia',
    pola: {
      imieNazwisko: 'imię i nazwisko usługodawcy',
      adres: 'adres usługodawcy',
      telefon: 'numer telefonu usługodawcy',
      email: 'adres e-mail usługodawcy',
    },
    nazwy: {
      regulamin: 'Regulamin',
      prywatnosc: 'Polityka prywatności',
      odstapienie: 'Odstąpienie od umowy',
      dpa: 'Umowa powierzenia (DPA)',
      podprzetwarzajacy: 'Podprzetwarzający',
      uslugodawca: 'Dane usługodawcy',
    },
    nieMaTytul: 'Nie ma takiego dokumentu',
    nieMaOpis: 'Sprawdź adres albo wybierz dokument z listy.',
    bladTytul: 'Dokument chwilowo niedostępny',
    bladOpis: 'Serwer nie mógł przygotować dokumentu. Spróbuj ponownie za chwilę.',
    metodaTytul: 'Niedozwolona metoda',
    metodaOpis: 'Dokumenty można tylko czytać i pobierać.',
    zrodlo: 'Źródło',
  },
  en: {
    lang: 'en',
    etykieta: 'Content AI documents',
    wersja: (w, d) => `Version ${w} of ${d}`,
    pobierz: 'Download as text',
    pdf: 'To save as PDF, use your browser\'s Print command.',
    przelacz: 'Polski',
    przelaczOpis: 'Przeczytaj ten dokument po polsku',
    przejdz: 'Skip to content',
    spis: 'Contents',
    dokumenty: 'Documents',
    glowna: 'Content AI home page',
    brak: 'to be completed',
    pola: {
      imieNazwisko: 'service provider\'s full name',
      adres: 'service provider\'s address',
      telefon: 'service provider\'s telephone number',
      email: 'service provider\'s email address',
    },
    nazwy: {
      regulamin: 'Terms of Service',
      prywatnosc: 'Privacy Policy',
      odstapienie: 'Right of withdrawal',
      dpa: 'Data processing agreement',
      podprzetwarzajacy: 'Sub-processors',
      uslugodawca: 'Service provider details',
    },
    nieMaTytul: 'No such document',
    nieMaOpis: 'Check the address or choose a document from the list.',
    bladTytul: 'Document temporarily unavailable',
    bladOpis: 'The server could not prepare the document. Please try again in a moment.',
    metodaTytul: 'Method not allowed',
    metodaOpis: 'Documents can only be read and downloaded.',
    zrodlo: 'Source',
  },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (z) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[z]));
}

function tekst(w) {
  if (typeof w === 'number' && Number.isFinite(w)) return String(w);
  return typeof w === 'string' ? w.trim() : '';
}

function maPole(o, k) {
  return Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
}

/** Data ISO (RRRR-MM-DD) slownie: "9 października 2026 r." albo "9 October 2026". */
function dataSlownie(iso, jezyk) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(iso || '');
  const dzien = Number(m[3]);
  const miesiac = MIESIACE[jezyk === 'en' ? 'en' : 'pl'][Number(m[2]) - 1];
  return jezyk === 'en' ? `${dzien} ${miesiac} ${m[1]}` : `${dzien} ${miesiac} ${m[1]} r.`;
}

// ─── Konfiguracja ────────────────────────────────────────────────────────────
// konf to KONF serwera (ksztalt ustala etap 0). Przyjmujemy obiekt konf.uslugodawca albo plaskie pola
// o nazwach zmiennych srodowiska; gdy konf nie ma zadnego z nich, czytamy zmienne srodowiska, tak jak
// robi to KONF. Pusta wartosc w konf jest odpowiedzia (nie siegamy wtedy do srodowiska).

/** Dane uslugodawcy: { imieNazwisko, adres, telefon, email, www } (puste pola jako ''). */
function daneUslugodawcy(konf) {
  const obiekt = konf && typeof konf.uslugodawca === 'object' && konf.uslugodawca ? konf.uslugodawca : null;
  const plaski = !obiekt && Boolean(konf) && Object.keys(ZMIENNE).some((p) => ALIASY[p].some((a) => a.startsWith('CAI_') && maPole(konf, a)));
  const wynik = {};
  for (const pole of Object.keys(ZMIENNE)) {
    let w = '';
    if (obiekt) {
      const klucz = ALIASY[pole].find((a) => maPole(obiekt, a));
      w = klucz ? tekst(obiekt[klucz]) : '';
    } else if (plaski) {
      const klucz = ALIASY[pole].find((a) => a.startsWith('CAI_') && maPole(konf, a));
      w = klucz ? tekst(konf[klucz]) : '';
    } else {
      const zmienna = ALIASY[pole].find((a) => a.startsWith('CAI_') && tekst(process.env[a]));
      w = zmienna ? tekst(process.env[zmienna]) : '';
    }
    wynik[pole] = w.slice(0, 300);
  }
  return wynik;
}

/** Pierwsza wartosc, ktora konf podaje (takze pusta); bez niej zmienna srodowiska. */
function zKonf(konf, getery, zmienna) {
  for (const g of getery) {
    let w;
    try { w = g(konf || {}); } catch { w = undefined; }
    if (w !== undefined && w !== null) return w;
  }
  return zmienna ? process.env[zmienna] : undefined;
}

/** Adres strony uslugodawcy: tylko http(s) z prawdziwa nazwa hosta, inaczej content-ai.net. */
function adresWww(w) {
  let a = tekst(w);
  if (!a) return ADRES_STRONY;
  if (!/^https?:\/\//i.test(a)) a = 'https://' + a;
  try {
    const u = new URL(a);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname)) return ADRES_STRONY;
    return u.href.replace(/\/+$/, '');
  } catch {
    return ADRES_STRONY;
  }
}

function adresPubliczny(konf) {
  const w = tekst(zKonf(konf, [(k) => k.adresPubliczny, (k) => k.CAI_ADRES_PUBLICZNY, (k) => k.konta.adresPubliczny], 'CAI_ADRES_PUBLICZNY'));
  return WZOR_WWW.test(w) ? w.replace(/\/+$/, '') : ADRES_APLIKACJI;
}

function trybPlatnosci(konf) {
  return tekst(zKonf(konf, [(k) => k.PLATNOSCI_TRYB, (k) => k.trybPlatnosci, (k) => k.platnosci.tryb], 'PLATNOSCI_TRYB')).toLowerCase();
}

function zaleglaDni(konf) {
  const n = Number(zKonf(konf, [(k) => k.PLATNOSCI_ZALEGLA_DNI, (k) => k.zaleglaDni, (k) => k.platnosci.zaleglaDni], 'PLATNOSCI_ZALEGLA_DNI'));
  return Number.isInteger(n) && n > 0 && n < 100 ? n : ZALEGLA_DNI;
}

/** Uslugi, ktore dokumenty wymieniaja tylko wtedy, gdy serwer je ma (produkcja: zadnej z nich). */
function warunki(konf) {
  const ma = (w) => Boolean(tekst(w));
  return {
    nvidia: ma(zKonf(konf, [(k) => k.klucze.nvidia, (k) => k.wektory.klucz, (k) => k.NVIDIA_KEY], 'NVIDIA_KEY')),
    elevenlabs: ma(zKonf(konf, [(k) => k.klucze.eleven, (k) => k.ELEVEN_KEY], 'ELEVEN_KEY')),
    dataforseo: ma(zKonf(konf, [(k) => k.dataForSeo.login, (k) => k.DATAFORSEO_LOGIN], 'DATAFORSEO_LOGIN'))
      && ma(zKonf(konf, [(k) => k.dataForSeo.haslo, (k) => k.DATAFORSEO_HASLO], 'DATAFORSEO_HASLO')),
  };
}

function limitDarmowy() {
  try {
    const n = require('./plany.js').PLANY.darmowy.limity.artykul;
    return Number.isInteger(n) && n > 0 ? n : LIMIT_DARMOWY;
  } catch {
    return LIMIT_DARMOWY;
  }
}

/** Ustawienia jednego renderowania. */
function ustawienia(konf) {
  const dane = daneUslugodawcy(konf);
  return {
    dane,
    www: adresWww(dane.www),
    adres: adresPubliczny(konf),
    tryb: trybPlatnosci(konf),
    zaleglaDni: zaleglaDni(konf),
    warunki: warunki(konf),
    kompresja: !(konf && konf.kompresja === false),
  };
}

/** Pola danych uslugodawcy, ktorych brakuje (nazwy zmiennych srodowiska). WWW ma wartosc domyslna. */
function brakujaceDane(konf) {
  const dane = daneUslugodawcy(konf);
  return Object.keys(ZMIENNE).filter((p) => p !== 'www' && !dane[p]).map((p) => ZMIENNE[p]);
}

// ─── Szablony ────────────────────────────────────────────────────────────────

const PAMIEC = new Map();

function wczytajSzablon(nazwa, jezyk) {
  const plik = path.join(KATALOG, `${nazwa}.${jezyk}.md`);
  const st = fs.statSync(plik);
  const byl = PAMIEC.get(plik);
  if (byl && byl.mtimeMs === st.mtimeMs && byl.size === st.size) return byl;
  const surowy = fs.readFileSync(plik, 'utf8').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(surowy);
  const meta = {};
  if (m) {
    for (const linia of m[1].split('\n')) {
      const i = linia.indexOf(':');
      if (i > 0) meta[linia.slice(0, i).trim()] = linia.slice(i + 1).trim();
    }
  }
  if (!meta.tytul || !meta.wersja || !meta.data) throw new Error(`szablon ${nazwa}.${jezyk}.md bez tytulu, wersji albo daty`);
  const tresc = (m ? surowy.slice(m[0].length) : surowy).replace(/<!--[\s\S]*?-->\n?/g, '');
  const wpis = { mtimeMs: st.mtimeMs, size: st.size, meta, tresc };
  PAMIEC.set(plik, wpis);
  return wpis;
}

/** Wersje dokumentow z naglowkow szablonow: { regulamin: '2026-10-v1', ... } (wersja PL). */
function wersje() {
  const wynik = {};
  for (const n of NAZWY) wynik[n] = wczytajSzablon(n, 'pl').meta.wersja;
  return wynik;
}

/** Adres dokumentu do odnosnikow: /dokumenty/regulamin?lang=pl (baza: CAI_ADRES_PUBLICZNY, gdy podana). */
function adres(nazwa, jezyk, baza = '') {
  return `${baza}/dokumenty/${nazwa}?lang=${jezyk === 'en' ? 'en' : 'pl'}`;
}

function wartosciSzablonu(jezyk, ust, meta) {
  const en = jezyk === 'en';
  const z = {
    WERSJA: meta.wersja,
    DATA: dataSlownie(meta.data, jezyk),
    URL_CENNIK: ust.www + (en ? '/en/#cennik' : '/#cennik'),
    URL_AI_ACT: ust.www + (en ? '/en/ai-act/' : '/ai-act/'),
    LIMIT_DARMOWY: String(limitDarmowy()),
    ZALEGLA_DNI: String(ust.zaleglaDni),
    WERSJA_PODPRZETWARZAJACY: wczytajSzablon('podprzetwarzajacy', jezyk).meta.wersja,
  };
  for (const n of NAZWY) z['URL_' + n.toUpperCase()] = adres(n, jezyk, ust.adres);
  return z;
}

/**
 * Szablon po podstawieniach, jeszcze w skladni Markdown. Dane uslugodawcy i luki zamienia na znaczniki
 * \u0001N\u0001 (lista `znaczniki`), ktore renderer HTML albo tekstowy podmienia na koncu: wartosc z
 * konfiguracji trafia na strone dopiero po zbudowaniu HTML, wiec nie przejdzie przez parser Markdown.
 */
function przygotuj(nazwa, jezyk, ust) {
  const szablon = wczytajSzablon(nazwa, jezyk);
  const bledy = [];
  let tresc = szablon.tresc;
  tresc = tresc.replace(/^\{\{ZALACZNIK_PODPRZETWARZAJACY\}\}$/m, () =>
    wczytajSzablon('podprzetwarzajacy', jezyk).tresc.replace(/^(#{2,3})\s/gm, '#$1 ').trim());
  tresc = tresc.replace(/^\{\{\?([a-z]+)\}\}\n([\s\S]*?)^\{\{\/\1\}\}\n?/gm, (_, w, srodek) => {
    if (!(w in ust.warunki)) bledy.push(`nieznany warunek ${w}`);
    return ust.warunki[w] ? srodek : '';
  });
  const wartosci = wartosciSzablonu(jezyk, ust, szablon.meta);
  const znaczniki = [];
  const znacznik = (z) => { znaczniki.push(z); return `\u0001${znaczniki.length - 1}\u0001`; };
  tresc = tresc.replace(/\{\{DO_UZUPELNIENIA:\s*([^}]*)\}\}/g, (_, opis) => znacznik({ luka: opis.trim() }));
  tresc = tresc.replace(/\{\{([A-Z_]+)\}\}/g, (calosc, n) => {
    if (n in wartosci) return wartosci[n];
    bledy.push(`nieznana wartosc ${n}`);
    return '';
  });
  tresc = tresc.replace(/\bWSTAW_TUTAJ_[A-Z_]+/g, (z) => {
    if (z in POLA) return znacznik({ pole: POLA[z] });
    bledy.push(`nieznany znacznik ${z}`);
    return znacznik({ luka: z });
  });
  return { meta: szablon.meta, tresc, znaczniki, bledy };
}

// ─── Markdown -> HTML ────────────────────────────────────────────────────────

function bezpiecznyAdres(a) {
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(a) ? a : '';
}

function inline(surowy) {
  let h = esc(surowy);
  h = h.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (c, opis, a) => {
    const adresOk = bezpiecznyAdres(a);
    return adresOk ? `<a href="${adresOk}">${opis}</a>` : opis;
  });
  // Adresy wpisane w tekst jako linki, ale nie wewnatrz istniejacych <a>.
  let wLinku = false;
  return h.split(/(<[^>]+>)/).map((cz) => {
    if (cz.startsWith('<')) {
      if (/^<a\b/i.test(cz)) wLinku = true;
      else if (/^<\/a>/i.test(cz)) wLinku = false;
      return cz;
    }
    if (wLinku) return cz;
    return cz.replace(/https?:\/\/[^\s<\u0001]*[^\s<\u0001.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`);
  }).join('');
}

function komorki(linia) {
  let l = linia.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}

const WZOR_NAGLOWKA = /^(#{2,4})\s+(.*?)\s*(?:\{#([a-z0-9-]+)\})?\s*$/;
const WZOR_POZYCJI = /^( *)(\d+\.|-)\s+(.*)$/;

function bloki(tresc) {
  const linie = tresc.split('\n');
  const wynik = [];
  let i = 0;
  const poczatekBloku = (l) => WZOR_NAGLOWKA.test(l) || WZOR_POZYCJI.test(l) || /^\s*\|/.test(l);
  while (i < linie.length) {
    const linia = linie[i];
    if (!linia.trim()) { i += 1; continue; }
    const n = WZOR_NAGLOWKA.exec(linia);
    if (n) {
      wynik.push({ typ: 'naglowek', poziom: n[1].length, tekst: n[2], id: n[3] || '' });
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(linia)) {
      const wiersze = [];
      while (i < linie.length && /^\s*\|/.test(linie[i])) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(linie[i])) wiersze.push(komorki(linie[i]));
        i += 1;
      }
      wynik.push({ typ: 'tabela', wiersze });
      continue;
    }
    if (WZOR_POZYCJI.test(linia)) {
      const pozycje = [];
      while (i < linie.length && linie[i].trim()) {
        const p = WZOR_POZYCJI.exec(linie[i]);
        if (p) pozycje.push({ wciecie: p[1].length, numer: p[2] === '-' ? 0 : parseInt(p[2], 10), tekst: p[3] });
        else if (WZOR_NAGLOWKA.test(linie[i]) || /^\s*\|/.test(linie[i])) break;
        else pozycje[pozycje.length - 1].tekst += ' ' + linie[i].trim();
        i += 1;
      }
      wynik.push({ typ: 'lista', pozycje });
      continue;
    }
    const czesci = [];
    while (i < linie.length && linie[i].trim() && !poczatekBloku(linie[i])) {
      czesci.push(linie[i].trim());
      i += 1;
    }
    wynik.push({ typ: 'akapit', tekst: czesci.join(' ') });
  }
  return wynik;
}

function idNaglowka(tekstNaglowka, zajete) {
  const par = /^(?:§\s*)?(\d+)\.\s/.exec(tekstNaglowka);
  let id = par ? `par-${par[1]}` : tekstNaglowka.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sekcja';
  const baza = id;
  for (let k = 2; zajete.has(id); k += 1) id = `${baza}-${k}`;
  zajete.add(id);
  return id;
}

function htmlListy(pozycje) {
  let h = '';
  const stos = [];
  for (const p of pozycje) {
    while (stos.length && p.wciecie < stos[stos.length - 1].wciecie) h += `</li></${stos.pop().tag}>`;
    const szczyt = stos[stos.length - 1];
    if (!szczyt || p.wciecie > szczyt.wciecie) {
      const tag = p.numer ? 'ol' : 'ul';
      h += p.numer > 1 ? `<${tag} start="${p.numer}">` : `<${tag}>`;
      stos.push({ wciecie: p.wciecie, tag });
      h += `<li>${inline(p.tekst)}`;
    } else {
      h += `</li><li>${inline(p.tekst)}`;
    }
  }
  while (stos.length) h += `</li></${stos.pop().tag}>`;
  return h;
}

function htmlTabeli(wiersze) {
  if (!wiersze.length) return '';
  const [glowa, ...reszta] = wiersze;
  const et = glowa.map((g) => esc(g.replace(/\*\*/g, '')));
  const th = glowa.map((g) => `<th scope="col">${inline(g)}</th>`).join('');
  const tr = reszta.map((w) => '<tr>' + w.map((c, k) => (k === 0
    ? `<th scope="row" data-et="${et[k] || ''}">${inline(c)}</th>`
    : `<td data-et="${et[k] || ''}">${inline(c)}</td>`)).join('') + '</tr>').join('');
  return `<div class="tabela"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** Markdown -> { html, spis: [{ id, tekst }] } (spis z naglowkow drugiego poziomu). */
function markdownNaHtml(tresc) {
  const zajete = new Set();
  const spis = [];
  const html = bloki(tresc).map((b) => {
    if (b.typ === 'naglowek') {
      const id = b.id || idNaglowka(b.tekst, zajete);
      if (b.id) zajete.add(b.id);
      if (b.poziom === 2) spis.push({ id, tekst: b.tekst });
      return `<h${b.poziom} id="${id}">${inline(b.tekst)}</h${b.poziom}>`;
    }
    if (b.typ === 'tabela') return htmlTabeli(b.wiersze);
    if (b.typ === 'lista') return htmlListy(b.pozycje);
    return `<p>${inline(b.tekst)}</p>`;
  }).join('\n');
  return { html, spis };
}

/** Markdown -> zwykly tekst do pobrania (bez znacznikow, adresy w nawiasach). */
function markdownNaTekst(tresc) {
  return tresc.split('\n').map((l) => {
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-') && l.includes('|')) return null;
    let x = l.replace(WZOR_NAGLOWKA, (c, h, t) => `\n${t}`);
    x = x.replace(/\*\*([^*]+?)\*\*/g, '$1');
    x = x.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (c, opis, a) => (opis === a ? a : `${opis} (${a})`));
    return x;
  }).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ─── Wartosci uslugodawcy w gotowym dokumencie ──────────────────────────────

function htmlZnacznika(z, ust, t) {
  if (z.luka !== undefined) return `<span class="brak">[${esc(t.brak)}: ${esc(z.luka)}]</span>`;
  const w = z.pole === 'www' ? ust.www : ust.dane[z.pole];
  if (!w) return `<span class="brak">[${esc(t.brak)}: ${esc(t.pola[z.pole] || z.pole)}]</span>`;
  if (z.pole === 'email' && WZOR_EMAIL.test(w)) return `<a href="mailto:${esc(w)}">${esc(w)}</a>`;
  if (z.pole === 'telefon') {
    const numer = w.replace(/[^\d+]/g, '');
    if (/^\+?\d{6,15}$/.test(numer)) return `<a href="tel:${numer}">${esc(w)}</a>`;
  }
  if (z.pole === 'www') return `<a href="${esc(w)}">${esc(w.replace(/^https?:\/\//i, ''))}</a>`;
  return esc(w);
}

function tekstZnacznika(z, ust, t) {
  if (z.luka !== undefined) return `[${t.brak}: ${z.luka}]`;
  const w = z.pole === 'www' ? ust.www : ust.dane[z.pole];
  return w || `[${t.brak}: ${t.pola[z.pole] || z.pole}]`;
}

function wstawZnaczniki(tekstWyniku, znaczniki, zamiana) {
  return tekstWyniku.replace(/\u0001(\d+)\u0001/g, (c, i) => zamiana(znaczniki[Number(i)]));
}

/** Luki widoczne w gotowym dokumencie: puste pola uslugodawcy i {{DO_UZUPELNIENIA}}. */
function lukiDokumentu(znaczniki, ust) {
  const luki = new Set();
  for (const z of znaczniki) {
    if (z.luka !== undefined) luki.add(`szablon: ${z.luka}`);
    else if (z.pole !== 'www' && !ust.dane[z.pole]) luki.add(ZMIENNE[z.pole]);
  }
  return [...luki];
}

// ─── Ostrzezenia w trybie live ───────────────────────────────────────────────

const OSTRZEZONE = new Set();

function ostrzezWTrybieLive(ust, luki, gdzie) {
  if (ust.tryb !== 'live' || !luki.length) return;
  const klucz = luki.join('|');
  if (OSTRZEZONE.has(klucz)) return;
  OSTRZEZONE.add(klucz);
  console.warn(`[dokumenty] tryb live: ${gdzie} pokazuje znacznik "do uzupelnienia": ${luki.join(', ')}`);
}

// Przy starcie serwera (modul laduje server.js): tryb live bez danych uslugodawcy widac od razu w dzienniku,
// a nie dopiero po pierwszym otwarciu regulaminu.
if (String(process.env.PLATNOSCI_TRYB || '').trim().toLowerCase() === 'live') {
  const brak = brakujaceDane(null);
  if (brak.length) ostrzezWTrybieLive({ tryb: 'live' }, brak, 'dokumenty prawne');
}

// ─── Strona HTML ─────────────────────────────────────────────────────────────

const ZNAK = 'M16 1.5 L18.82 12.33 L17.94 13.21 A3.4 3.4 0 0 0 14.06 13.21 L13.18 12.33 Z '
  + 'M30.5 16 L19.67 18.82 L18.79 17.94 A3.4 3.4 0 0 0 18.79 14.06 L19.67 13.18 Z '
  + 'M16 30.5 L13.18 19.67 L14.06 18.79 A3.4 3.4 0 0 0 17.94 18.79 L18.82 19.67 Z '
  + 'M1.5 16 L12.33 13.18 L13.21 14.06 A3.4 3.4 0 0 0 13.21 17.94 L12.33 18.82 Z';

// Tokeny marki jak na ekranie logowania (logowanie.js, kierunek A "Redakcja"): ciemny domyslnie, jasny
// z ustawien systemu; do druku zawsze jasny papier.
const STYL = `
@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:400 900;font-display:swap;src:url("/pwa/fonty/schibsted-grotesk-latin-wght-normal.woff2") format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:400 900;font-display:swap;src:url("/pwa/fonty/schibsted-grotesk-latin-ext-wght-normal.woff2") format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Literata";font-style:normal;font-weight:200 900;font-display:swap;src:url("/pwa/fonty/literata-latin-wght-normal.woff2") format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Literata";font-style:normal;font-weight:200 900;font-display:swap;src:url("/pwa/fonty/literata-latin-ext-wght-normal.woff2") format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF}
:root{color-scheme:dark;
  --c-tlo:#111110;--c-panel:#171715;--c-pole:#1E1E1B;--c-linia:#2A2A27;--c-linia-2:#363632;--c-ramka:#716F67;
  --c-tekst:#EDEBE6;--c-tekst-2:#B9B6AE;--c-tekst-3:#A29E95;--c-akcent:#F6A623;--c-akcent-mocny:#F6A623;
  --c-fokus:#F6A623;--c-uwaga:#F39A5D;--c-uwaga-tlo:#36291F;--c-uwaga-ramka:#6F4B32;--c-zaznaczenie:rgba(246,166,35,.30);
  --f-ui:"Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --f-tresc:"Literata",Georgia,"Times New Roman",serif;--r-sm:6px;--r-md:8px}
@media (prefers-color-scheme:light){:root{color-scheme:light;
  --c-tlo:#F7F6F2;--c-panel:#FFFEFB;--c-pole:#FFFFFF;--c-linia:#E3E1DB;--c-linia-2:#D6D3CB;--c-ramka:#8D897F;
  --c-tekst:#1B1A17;--c-tekst-2:#4F4C45;--c-tekst-3:#67635B;--c-akcent:#F6A623;--c-akcent-mocny:#8F5A00;
  --c-fokus:#B06C00;--c-uwaga:#A2470B;--c-uwaga-tlo:#F3E7DC;--c-uwaga-ramka:#D1A78A;--c-zaznaczenie:rgba(246,166,35,.32)}}
@media (prefers-contrast:more){:root{--c-tekst-2:var(--c-tekst);--c-tekst-3:var(--c-tekst);--c-linia-2:var(--c-ramka)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--c-tlo);color:var(--c-tekst);font:400 16px/1.6 var(--f-ui);-webkit-font-smoothing:antialiased}
::selection{background:var(--c-zaznaczenie)}
a{color:var(--c-akcent-mocny);text-underline-offset:3px;text-decoration-thickness:1px;overflow-wrap:anywhere}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--c-fokus);outline-offset:2px;border-radius:var(--r-sm)}
.skip{position:absolute;left:16px;top:-80px;padding:10px 14px;border-radius:var(--r-md);background:var(--c-akcent);color:#1C1303;font-weight:600;text-decoration:none}
.skip:focus{top:12px}
.kont{max-width:46rem;margin:0 auto;padding:0 20px}
.gora{border-bottom:1px solid var(--c-linia);background:var(--c-panel)}
.gora .kont{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;max-width:62rem}
.logo{display:inline-flex;align-items:center;gap:10px;min-height:44px;color:var(--c-tekst);text-decoration:none}
.logo svg{fill:var(--c-akcent);flex:none}
.logo span{font:600 14px/1 var(--f-ui);letter-spacing:.14em}
.jezyk{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid var(--c-linia-2);border-radius:var(--r-sm);color:var(--c-tekst-2);font:500 14px/1 var(--f-ui);text-decoration:none}
.jezyk:hover{border-color:var(--c-ramka);color:var(--c-tekst)}
main{padding:40px 0 56px}
.etyk{margin:0 0 12px;font:600 12px/1.4 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--c-tekst-2)}
h1{margin:0 0 12px;font:560 clamp(30px,5vw,42px)/1.12 var(--f-tresc);letter-spacing:-.02em;text-wrap:balance}
.wersja{margin:0;color:var(--c-tekst-2);font-size:15px}
.akcje{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;margin:8px 0 0;color:var(--c-tekst-3);font-size:14px}
.akcje a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
.spis{margin:28px 0 8px;padding:16px 20px;border:1px solid var(--c-linia-2);border-radius:var(--r-md);background:var(--c-panel)}
.spis h2{margin:0 0 8px;font:600 12px/1.4 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--c-tekst-3);border:0;padding:0}
.spis ol{margin:0;padding:0;list-style:none;columns:2 16rem;column-gap:24px}
.spis li{margin:0;break-inside:avoid}
.spis a{display:inline-block;padding:5px 0;font-size:15px;text-decoration:none}
.spis a:hover{text-decoration:underline}
.tresc{font:400 17px/1.7 var(--f-tresc)}
.tresc h2{margin:40px 0 12px;padding-top:24px;border-top:1px solid var(--c-linia);font:700 21px/1.3 var(--f-ui);letter-spacing:-.012em;scroll-margin-top:16px}
.tresc h3{margin:28px 0 10px;font:700 18px/1.35 var(--f-ui)}
.tresc p{margin:0 0 14px}
.tresc ol,.tresc ul{margin:0 0 16px;padding-left:1.6em}
.tresc li{margin:0 0 8px}
.tresc li>ol,.tresc li>ul{margin:8px 0 0}
.tresc strong{font-weight:650}
.tabela{margin:8px 0 20px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font:400 15px/1.5 var(--f-ui)}
th,td{padding:10px 12px 10px 0;border-bottom:1px solid var(--c-linia);text-align:left;vertical-align:top}
thead th{font:600 12px/1.4 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--c-tekst-3);border-bottom-color:var(--c-linia-2)}
tbody th{font-weight:600}
.brak{display:inline;padding:1px 6px;border:1px dashed var(--c-uwaga-ramka);border-radius:var(--r-sm);background:var(--c-uwaga-tlo);color:var(--c-uwaga);font:600 14px/1.6 var(--f-ui)}
.stopka{border-top:1px solid var(--c-linia);background:var(--c-panel);padding:28px 0 36px;font-size:14px;color:var(--c-tekst-2)}
.stopka .kont{max-width:62rem}
.stopka h2{margin:0 0 8px;font:600 12px/1.4 var(--f-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--c-tekst-3)}
.stopka ul{margin:0 0 16px;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:0 20px}
.stopka li a{display:inline-flex;align-items:center;min-height:44px}
.stopka a[aria-current="page"]{color:var(--c-tekst);text-decoration:none;font-weight:600}
.stopka p{margin:0}
@media (max-width:640px){
  main{padding:28px 0 40px}
  .tresc{font-size:16px}
  .spis ol{columns:1}
  table,thead,tbody,tr,th,td{display:block}
  thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  tr{padding:12px 0;border-bottom:1px solid var(--c-linia)}
  th,td{border:0;padding:2px 0}
  tbody th{font-size:16px}
  td::before{content:attr(data-et);display:block;font:600 12px/1.5 var(--f-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--c-tekst-3)}
}
@media print{
  :root{color-scheme:light;--c-tlo:#FFFFFF;--c-panel:#FFFFFF;--c-tekst:#000000;--c-tekst-2:#222222;--c-tekst-3:#444444;--c-akcent-mocny:#000000;--c-linia:#BBBBBB;--c-linia-2:#999999}
  .gora,.stopka,.akcje,.skip,.spis{display:none}
  main{padding:0}
  .tresc{font-size:11pt}
}`;

function szkielet({ t, tytul, srodek, nav = '', jezyk, inny = '' }) {
  return `<!DOCTYPE html>
<html lang="${t.lang}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#111110" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F7F6F2" media="(prefers-color-scheme: light)">
<meta name="robots" content="noindex">
<title>${esc(tytul)} · Content AI</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="#F6A623"><path d="${ZNAK}"/><circle cx="16" cy="16" r="1.6"/></svg>`)}">
<style>${STYL}</style></head><body>
<a class="skip" href="#tresc">${esc(t.przejdz)}</a>
<header class="gora"><div class="kont">
<a class="logo" href="${esc(jezyk === 'en' ? ADRES_STRONY + '/en/' : ADRES_STRONY + '/')}" aria-label="${esc(t.glowna)}"><svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" focusable="false"><path d="${ZNAK}"/><circle cx="16" cy="16" r="1.6"/></svg><span>CONTENT AI</span></a>
${inny}
</div></header>
<main id="tresc"><div class="kont">
${srodek}
</div></main>
${nav}
</body></html>`;
}

function stopkaDokumentow(t, jezyk, biezacy) {
  const linki = NAZWY.map((n) => `<li><a href="${esc(adres(n, jezyk))}"${n === biezacy ? ' aria-current="page"' : ''}>${esc(t.nazwy[n])}</a></li>`).join('');
  return `<footer class="stopka"><div class="kont">
<nav aria-labelledby="st-dok"><h2 id="st-dok">${esc(t.dokumenty)}</h2><ul>${linki}</ul></nav>
<p>Content AI · <a href="${esc(jezyk === 'en' ? ADRES_STRONY + '/en/' : ADRES_STRONY + '/')}">content-ai.net</a></p>
</div></footer>`;
}

function stronaDokumentu(nazwa, jezyk, ust, p) {
  const t = T[jezyk];
  const inny = jezyk === 'pl' ? 'en' : 'pl';
  const { html, spis } = markdownNaHtml(p.tresc);
  const tresc = wstawZnaczniki(html, p.znaczniki, (z) => htmlZnacznika(z, ust, t));
  const spisHtml = spis.length >= 4
    ? `<nav class="spis" aria-labelledby="spis-t"><h2 id="spis-t">${esc(t.spis)}</h2><ol>${spis.map((s) => `<li><a href="#${s.id}">${inline(s.tekst).replace(/<\/?a\b[^>]*>/g, '')}</a></li>`).join('')}</ol></nav>`
    : '';
  const srodek = `<p class="etyk">${esc(t.etykieta)}</p>
<h1>${esc(p.meta.tytul)}</h1>
<p class="wersja">${esc(t.wersja(p.meta.wersja, dataSlownie(p.meta.data, jezyk)))}</p>
<p class="akcje"><a href="${esc(adres(nazwa, jezyk) + '&format=txt')}" download>${esc(t.pobierz)}</a><span>${esc(t.pdf)}</span></p>
${spisHtml}
<article class="tresc">
${tresc}
</article>`;
  const przelacznik = `<a class="jezyk" href="${esc(adres(nazwa, inny))}" hreflang="${inny}" lang="${inny}" aria-label="${esc(T[inny].przelaczOpis)}">${esc(T[jezyk].przelacz)}</a>`;
  return szkielet({ t, tytul: p.meta.tytul, srodek, nav: stopkaDokumentow(t, jezyk, nazwa), jezyk, inny: przelacznik });
}

function stronaKomunikatu(jezyk, tytul, opis) {
  const t = T[jezyk];
  const lista = NAZWY.map((n) => `<li><a href="${esc(adres(n, jezyk))}">${esc(t.nazwy[n])}</a></li>`).join('');
  return szkielet({ t, tytul, jezyk, srodek: `<p class="etyk">${esc(t.etykieta)}</p>
<h1>${esc(tytul)}</h1>
<p class="wersja">${esc(opis)}</p>
<article class="tresc"><ul>${lista}</ul></article>` });
}

// ─── Renderowanie i odpowiedz ────────────────────────────────────────────────

/**
 * Dokument gotowy do wyslania (takze do zalacznika e-maila: format 'txt').
 * Zwraca { status, naglowki, tresc, luki }; nie rzuca wyjatkow.
 */
function renderuj({ nazwa, jezyk, konf, format = 'html' } = {}) {
  const j = JEZYKI.includes(jezyk) ? jezyk : 'pl';
  const t = T[j];
  const html = 'text/html; charset=utf-8';
  const wspolne = { 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex', 'Content-Language': j, Vary: 'Accept-Language' };
  if (!NAZWY.includes(nazwa)) {
    return { status: 404, naglowki: { ...wspolne, 'Content-Type': html, 'Cache-Control': 'no-store' }, tresc: stronaKomunikatu(j, t.nieMaTytul, t.nieMaOpis), luki: [] };
  }
  try {
    const ust = ustawienia(konf);
    const p = przygotuj(nazwa, j, ust);
    if (p.bledy.length) console.error(`[dokumenty] szablon ${nazwa}.${j}.md: ${p.bledy.join(', ')}`);
    const luki = lukiDokumentu(p.znaczniki, ust);
    ostrzezWTrybieLive(ust, luki, `dokument ${nazwa} (${j})`);
    if (format === 'txt') {
      const naglowek = `${p.meta.tytul}\n${t.wersja(p.meta.wersja, dataSlownie(p.meta.data, j))}\n${t.zrodlo}: ${adres(nazwa, j, ust.adres)}\n\n`;
      const tekstDok = naglowek + wstawZnaczniki(markdownNaTekst(p.tresc), p.znaczniki, (z) => tekstZnacznika(z, ust, t));
      return {
        status: 200,
        naglowki: { ...wspolne, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="content-ai-${nazwa}-${p.meta.wersja}-${j}.txt"` },
        tresc: tekstDok,
        luki,
      };
    }
    return { status: 200, naglowki: { ...wspolne, 'Content-Type': html }, tresc: stronaDokumentu(nazwa, j, ust, p), luki };
  } catch (e) {
    console.error(`[dokumenty] ${nazwa} (${j}): ${e.message}`);
    return { status: 500, naglowki: { ...wspolne, 'Content-Type': html, 'Cache-Control': 'no-store' }, tresc: stronaKomunikatu(j, t.bladTytul, t.bladOpis), luki: [] };
  }
}

function kodowanie(req) {
  const ae = String((req && req.headers && req.headers['accept-encoding']) || '').toLowerCase();
  const ma = (n) => ae.split(',').some((c) => {
    const [nazwaKod, ...param] = c.trim().split(';');
    const q = param.map((x) => x.trim()).find((x) => x.startsWith('q='));
    return nazwaKod.trim() === n && (!q || Number(q.slice(2)) > 0);
  });
  if (ma('br')) return 'br';
  if (ma('gzip')) return 'gzip';
  return null;
}

/** Obsluga trasy GET /dokumenty/<nazwa> (kontrakt etapu 0). */
function obsluz(req, res, { nazwa, jezyk, konf } = {}) {
  const j = JEZYKI.includes(jezyk) ? jezyk : 'pl';
  const metoda = String(req.method || 'GET').toUpperCase();
  let wynik;
  if (metoda !== 'GET' && metoda !== 'HEAD') {
    const t = T[j];
    wynik = { status: 405, naglowki: { 'Content-Type': 'text/html; charset=utf-8', Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }, tresc: stronaKomunikatu(j, t.metodaTytul, t.metodaOpis) };
  } else {
    let format = 'html';
    try { format = new URL(req.url || '/', 'http://x').searchParams.get('format') === 'txt' ? 'txt' : 'html'; } catch { /* zly adres: HTML */ }
    wynik = renderuj({ nazwa, jezyk: j, konf, format });
  }
  if (res.headersSent || res.destroyed) return;
  let cialo = Buffer.from(wynik.tresc, 'utf8');
  const naglowki = { ...wynik.naglowki };
  const kod = cialo.length > 1024 && !(konf && konf.kompresja === false) ? kodowanie(req) : null;
  if (kod === 'br') cialo = zlib.brotliCompressSync(cialo, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  if (kod === 'gzip') cialo = zlib.gzipSync(cialo);
  if (kod) {
    naglowki['Content-Encoding'] = kod;
    naglowki.Vary = naglowki.Vary ? `${naglowki.Vary}, Accept-Encoding` : 'Accept-Encoding';
  }
  naglowki['Content-Length'] = cialo.length;
  res.writeHead(wynik.status, naglowki);
  res.end(metoda === 'HEAD' ? undefined : cialo);
}

module.exports = {
  obsluz, renderuj, wersje, adres, daneUslugodawcy, brakujaceDane, NAZWY, JEZYKI, POLA, ZMIENNE,
  // do testow
  markdownNaHtml, markdownNaTekst, przygotuj, ustawienia, dataSlownie, KATALOG,
};
