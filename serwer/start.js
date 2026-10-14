'use strict';

// ─── Pierwszy artykul bez klucza (decyzja 14.10.2026) ────────────────────────
//
// Konto samoobslugowe na wlasnych kluczach (zrodloKluczy 'wlasne') pisze pierwszy artykul bez klucza
// Anthropic: wywolania modelu ida wtedy na OSOBNYM kluczu startu (CAI_START_KLUCZ) z osobnego obszaru
// roboczego (workspace) w konsoli Anthropic, z wlasnym miesiecznym limitem wydatkow. To nie jest
// ANTHROPIC_KEY zespolu: wyczerpany limit startu nie zatrzymuje zespolu, a klucz zespolu nadal nigdy
// nie trafia do konta 'wlasne' (niezmiennik klucze.kluczDla zostaje bez zmian).
//
// Bezpieczniki (kazdy z osobna daje gorna granice kosztu):
//   - tylko po potwierdzeniu adresu e-mail (rejestracja z Turnstile, gdy jest wlaczony) i po akceptacji aktualnego
//     regulaminu (CAI_REGULAMIN_WERSJA): regulamin opisuje start (§ 3 ust. 4), a umowa powierzenia, ktora jest jego
//     zalacznikiem, Anthropic jako dalszy podmiot przetwarzajacy przy tym artykule; dotychczasowe konta wchodza
//     w start po zaakceptowaniu nowej wersji, nowe od rejestracji,
//   - jeden przydzial na adres e-mail na rok, takze po usunieciu konta: przydzial lezy pod skrotem HMAC
//     adresu kanonicznego (male litery, bez +dopisku, Gmail bez kropek), bez loginu i bez jawnego adresu,
//   - tylko konto bez zadnego artykulu, jeden artykul (X-CAI-Czynnosc: artykul) na przydzial,
//   - sufit wywolan modelu na przydzial (CAI_START_WYWOLAN) i okno od pierwszego wywolania (CAI_START_MINUT),
//   - dzienna pula nowych przydzialow na caly serwer (CAI_START_DZIENNIE, doba UTC),
//   - odrzucenie klucza startu albo blad rozliczen u Anthropic (limit wydatkow, brak srodkow) wstrzymuje
//     start do konca doby UTC, a uzytkownik dostaje kreator klucza zamiast komunikatu o naszym rachunku,
//   - CAI_START=0 wylacza start od razu, bez zmiany kodu; brak CAI_START_KLUCZ to start wylaczony.
//
// Rozliczenie wywolania: zarezerwowane przed wywolaniem (atomowo w magazynie), oddane, gdy dostawca odrzucil
// zapytanie (blad HTTP nie kosztuje), a sztuka artykulu wraca takze po przerwaniu, limicie czasu i odmowie
// modelu (artykulu nie ma). Wywolanie przerwane w trakcie zostaje policzone: dostawca mogl juz naliczyc koszt,
// a zwrot pozwalalby powtarzac przerwane wywolania bez konca.

const { WZOR_KLUCZA_ANTHROPIC } = require('./klucze.js');

const DOBA = 24 * 3600_000;
// Ten sam wzor co klucz Anthropic uzytkownika (klucze.js): sk-ant-usr-... albo sk-ant-api03-..., nigdy klucz
// administracyjny ani token logowania. 14.10: klucz startu z nowego obszaru roboczego (sk-ant-usr-) byl odrzucany.
const WZOR_KLUCZA = WZOR_KLUCZA_ANTHROPIC;
// Odpowiedz dostawcy o rozliczeniach naszego obszaru roboczego (limit wydatkow, brak srodkow, platnosc).
const BLAD_ROZLICZEN = /credit balance|usage limit|spend(?:ing)? limit|billing|payment/i;
// Powody, ktore aplikacja pokazuje w kreatorze klucza; 'wylaczony' i 'konto' = start tego konta nie dotyczy.
const POWODY_DLA_APLIKACJI = ['email', 'regulamin', 'pula', 'wykorzystany'];

const STAN = {
  konf: null,
  magazyn: null,
  podpisz: null,
  wstrzymanyDo: 0,
  powodWstrzymania: '',
  // Liczniki od startu procesu (/api/status), bez danych kont.
  przydzialow: 0,
  wywolan: 0,
  zwrotow: 0,
  odmowy: {},
};

/** Ustawienia z KONF.start: { wlaczony, klucz, dziennie, wywolan, minut }. */
function ustawienia(konf = STAN.konf) {
  return (konf && konf.start) || {};
}

/** Czy start dziala: nie wylaczony awaryjnie (CAI_START=0) i jest poprawny klucz startu. */
function wlaczony(konf = STAN.konf) {
  const s = ustawienia(konf);
  return Boolean(s.wlaczony && s.klucz && STAN.magazyn);
}

/**
 * Co jest nie tak z wartoscia CAI_START_KLUCZ (14.10: pierwsze wdrozenie mialo zly klucz, a dziennik mowil
 * tylko "musi byc kluczem"). -> null (pusta albo poprawna) | { kod, dlugosc }. Bez fragmentow wartosci:
 * opis trafia do dziennika i do CLI.
 */
function diagnozaKlucza(wartosc) {
  const k = String(wartosc || '').trim();
  if (!k) return null;
  const d = (kod) => ({ kod, dlugosc: k.length });
  // Dwa wklejone klucze przechodza przez sam wzor (znaki i dlugosc sie zgadzaja), a Anthropic je odrzuca.
  if ((k.match(/sk-ant-/g) || []).length > 1) return d('podwojny');
  if (WZOR_KLUCZA.test(k)) return null;
  if (/^WSTAW_TUTAJ/i.test(k)) return d('wzor');
  if (/\.\.\.|…/.test(k)) return d('skrocony');
  if (/^sk-ant-admin/i.test(k)) return d('admin');
  if (/^sk-ant-(?:oat|ort|sid)/i.test(k)) return d('oauth');
  if (/\s/.test(k)) return d('spacja');
  if (/["'`]/.test(k)) return d('cudzyslow');
  if (/^sk-/i.test(k) && !/^sk-ant-/i.test(k)) return d('inny');
  if (/^sk-ant-[a-z]{2,10}\d{0,2}-/.test(k)) return d('znaki');
  return d('nieznany');
}

// Opisy diagnozy: dziennik uslugi (bez polskich znakow, jak reszta dziennika) i CLI (cli.sh start).
const OPIS_DZIENNIK = {
  podwojny: () => 'klucz wklejony dwa razy',
  wzor: () => 'zostal wzor z instrukcji zamiast klucza',
  skrocony: () => 'klucz skrocony z "..." (kopia z listy kluczy w konsoli), pelny klucz widac tylko przy tworzeniu',
  admin: () => 'klucz administracyjny (Admin key), potrzebny zwykly klucz z API keys',
  oauth: () => 'token logowania (OAuth albo sesja claude.ai), potrzebny klucz z API keys w konsoli Anthropic',
  spacja: () => 'spacja w wartosci (komentarz albo drugi tekst w tej samej linii)',
  cudzyslow: () => 'cudzyslow w wartosci',
  inny: () => 'klucz innego dostawcy (sk-, ale nie sk-ant-)',
  znaki: (d) => `znaki spoza klucza albo klucz uciety (${d.dlugosc} znakow)`,
  nieznany: (d) => `nieznany format (${d.dlugosc} znakow)`,
};
const OPIS_CLI = {
  podwojny: () => 'klucz jest wklejony dwa razy.',
  wzor: () => 'zamiast klucza został wzór z instrukcji (WSTAW_TUTAJ_…). Wklej w to miejsce klucz z konsoli Anthropic.',
  skrocony: () => 'klucz jest skrócony (z „...” w środku), jak na liście kluczy w konsoli. Pełny klucz widać tylko raz, przy tworzeniu: utwórz nowy w obszarze Content AI start i skopiuj go od razu.',
  admin: () => 'to klucz administracyjny (Admin key). Potrzebny jest zwykły klucz z API keys.',
  oauth: () => 'to token logowania (OAuth z Claude Code albo sesja claude.ai), a nie klucz API. Utwórz klucz w API keys w konsoli Anthropic.',
  spacja: () => 'w wartości jest spacja, np. komentarz albo drugi tekst w tej samej linii.',
  cudzyslow: () => 'w wartości jest cudzysłów (np. niedomknięty).',
  inny: () => 'to klucz innego dostawcy (zaczyna się od sk-, ale nie od sk-ant-).',
  znaki: (d) => `po początku sk-ant-...- są znaki spoza klucza albo klucz jest ucięty (${d.dlugosc} znaków).`,
  nieznany: (d) => `to nie jest klucz API Anthropic (${d.dlugosc} znaków, klucz zaczyna się od sk-ant-usr- albo sk-ant-api03-).`,
};

/** Opis diagnozy dla dziennika (`cli: false`) albo CLI (`cli: true`); null bez diagnozy. */
function opisDiagnozy(d, { cli = false } = {}) {
  if (!d) return null;
  const opisy = cli ? OPIS_CLI : OPIS_DZIENNIK;
  return (opisy[d.kod] || opisy.nieznany)(d);
}

/** Bledy i ostrzezenia konfiguracji startu (sprawdzKonfiguracje w server.js), bez wartosci klucza. */
function sprawdzKonfiguracje(konf) {
  const s = ustawienia(konf);
  const bledy = [];
  const ostrzezenia = [];
  const diagnoza = diagnozaKlucza(s.klucz);
  if (diagnoza) bledy.push(`CAI_START_KLUCZ musi byc kluczem API Anthropic (sk-ant-usr-... albo sk-ant-api03-...) z osobnego obszaru roboczego. Teraz: ${opisDiagnozy(diagnoza)}`);
  if (s.klucz && !bledy.length) {
    if (konf.klucze && s.klucz === konf.klucze.anthropic) {
      ostrzezenia.push('CAI_START_KLUCZ to ten sam klucz co ANTHROPIC_KEY: limit wydatkow startu obejmie tez zespol (zalecany osobny obszar roboczy w konsoli Anthropic)');
    }
    if (!s.wlaczony) ostrzezenia.push('CAI_START=0: pierwszy artykul bez klucza wylaczony awaryjnie');
    if (!(s.dziennie > 0)) ostrzezenia.push('CAI_START_DZIENNIE=0: brak nowych przydzialow (trwajace koncza sie normalnie)');
  }
  // CAI_START=0 przy ustawionym kluczu: funkcja niezadana (wylaczona), z ostrzezeniem w dzienniku.
  return { zadana: Boolean(s.klucz) && s.wlaczony !== false, bledy, ostrzezenia };
}

/**
 * Adres kanoniczny do przydzialu: male litery, bez +dopisku, Gmail i Googlemail bez kropek w czesci lokalnej
 * (ta sama skrzynka pod roznymi zapisami). Konto i logowanie dalej uzywaja adresu dokladnie tak, jak go wpisano.
 */
function emailKanoniczny(email) {
  const e = String(email || '').trim().normalize('NFC').toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1) return '';
  let lokalna = e.slice(0, at);
  let domena = e.slice(at + 1);
  const plus = lokalna.indexOf('+');
  if (plus > 0) lokalna = lokalna.slice(0, plus);
  if (domena === 'googlemail.com') domena = 'gmail.com';
  if (domena === 'gmail.com') lokalna = lokalna.replace(/\./g, '');
  return lokalna ? `${lokalna}@${domena}` : '';
}

/** Skrot przydzialu: HMAC z sekretu sesji z wlasnym przedrostkiem (inny niz skrot konta usunietego). */
function skrot(email) {
  const k = emailKanoniczny(email);
  return k && STAN.podpisz ? STAN.podpisz(`start-email:${k}`) : null;
}

function dzienUtc(teraz) {
  return new Date(teraz).toISOString().slice(0, 10);
}

/** Poczatek nastepnej doby UTC (koniec wstrzymania). */
function nastepnaDoba(teraz) {
  return (Math.floor(teraz / DOBA) + 1) * DOBA;
}

/** Konta, ktorych start dotyczy: samoobslugowe na wlasnych kluczach. */
function dotyczy(konto) {
  return Boolean(konto) && konto.zrodloKluczy === 'wlasne' && konto.pochodzenie === 'samoobsluga' && Boolean(konto.email);
}

/** Artykuly konta we wszystkich okresach licznikow (start tylko przed pierwszym artykulem). */
function artykulyKonta(login) {
  const u = STAN.magazyn.uzycieKonta(login);
  return Object.values(u).reduce((suma, okres) => suma + (Number(okres.artykul) || 0), 0);
}

function odmowa(powod) {
  STAN.odmowy[powod] = (STAN.odmowy[powod] || 0) + 1;
  return { ok: false, powod };
}

/**
 * Stan startu konta.
 *   -> { dostepny: true, artykul, zostalo, do } (do = koniec okna albo null przed pierwszym wywolaniem)
 *    | { dostepny: false, powod: 'wylaczony'|'konto'|'email'|'regulamin'|'pula'|'wykorzystany' }
 * artykulowWToku: sztuki artykulu zarezerwowane w pakiecie przez TO zapytanie (plany.zarezerwuj przed
 * wywolaniem) - licznik pakietu juz je zawiera, a to nie jest artykul napisany wczesniej.
 */
function stan(konto, teraz = Date.now(), { artykulowWToku = 0 } = {}) {
  if (!wlaczony()) return { dostepny: false, powod: 'wylaczony' };
  if (!dotyczy(konto)) return { dostepny: false, powod: 'konto' };
  if (!konto.emailPotwierdzony) return { dostepny: false, powod: 'email' };
  // Regulamin w wersji z konfiguracji (ta sama kontrola co pasek "Zmienilismy regulamin", konta.wymagaAkceptacji).
  if (STAN.konf.regulaminWersja && konto.regulaminWersja !== STAN.konf.regulaminWersja) return { dostepny: false, powod: 'regulamin' };
  const s = ustawienia();
  const sk = skrot(konto.email);
  if (!sk) return { dostepny: false, powod: 'konto' };
  const p = STAN.magazyn.startPrzydzial(sk);
  if (p) {
    const koniec = p.od + s.minut * 60_000;
    if (teraz >= koniec || p.wywolan >= s.wywolan) return { dostepny: false, powod: 'wykorzystany' };
    // Wstrzymanie (blad rozliczen) zatrzymuje tez trwajace przydzialy: klucz startu i tak nie zadziala.
    if (STAN.wstrzymanyDo > teraz) return { dostepny: false, powod: 'pula' };
    return { dostepny: true, artykul: p.artykulow < 1, zostalo: s.wywolan - p.wywolan, do: koniec };
  }
  // Konto z artykulem (np. pisalo juz na wlasnym kluczu i go usunelo): to nie jest pierwszy artykul.
  if (artykulyKonta(konto.login) - artykulowWToku > 0) return { dostepny: false, powod: 'konto' };
  if (STAN.wstrzymanyDo > teraz || STAN.magazyn.startLiczby(dzienUtc(teraz)).dzien >= s.dziennie) return { dostepny: false, powod: 'pula' };
  return { dostepny: true, artykul: true, zostalo: s.wywolan, do: null };
}

/** Stan dla zapytania: artykul przy wykorzystanej sztuce artykulu to odmowa 'wykorzystany'. */
function stanDla(konto, czynnosci = [], teraz = Date.now(), opcje = {}) {
  const st = stan(konto, teraz, opcje);
  if (st.dostepny && czynnosci.includes('artykul') && !st.artykul) return { dostepny: false, powod: 'wykorzystany' };
  return st;
}

/** Stan w GET /api/klucze (pole start) albo undefined, gdy start konta nie dotyczy. */
function stanDlaAplikacji(konto, teraz = Date.now()) {
  const st = stan(konto, teraz);
  if (!st.dostepny && !POWODY_DLA_APLIKACJI.includes(st.powod)) return undefined;
  return st;
}

/** Blad brak-klucza z powodem startu (tylko powody, ktore aplikacja pokazuje). */
function zPowodem(blad, powod) {
  return POWODY_DLA_APLIKACJI.includes(powod) ? { ...blad, start: powod } : { ...blad };
}

/** Wstrzymanie startu do konca doby UTC (blad rozliczen albo odrzucony klucz startu). */
function wstrzymaj(powod, teraz = Date.now()) {
  const do_ = nastepnaDoba(teraz);
  if (STAN.wstrzymanyDo >= do_) return;
  STAN.wstrzymanyDo = do_;
  STAN.powodWstrzymania = powod;
  console.error(`[start] pierwszy artykul bez klucza WSTRZYMANY do ${new Date(do_).toISOString()}: ${powod}`);
}

/**
 * Jedno wywolanie modelu na kluczu startu dla konta bez wlasnego klucza Anthropic. Przydzial atomowy
 * (magazyn.startWywolanie), wolany tuz przed wywolaniem dostawcy.
 *   przydziel(konto, czynnosci, { teraz, artykulowWToku }) (artykulowWToku jak w stan())
 *   -> { ok: true, k, rozlicz(status, cialo, { bezTekstu }), zakoncz() } | { ok: false, powod }
 * k ma ksztalt wyniku klucze.kluczDla z czyj 'start' (naglowki zlego klucza tylko dla klucza uzytkownika).
 */
function przydziel(konto, czynnosci = [], { teraz = Date.now(), artykulowWToku = 0 } = {}) {
  const st = stanDla(konto, czynnosci, teraz, { artykulowWToku });
  if (!st.dostepny) return odmowa(st.powod);
  const s = ustawienia();
  const sk = skrot(konto.email);
  const artykul = czynnosci.includes('artykul');
  const w = STAN.magazyn.startWywolanie(sk, {
    teraz,
    dzien: dzienUtc(teraz),
    pulaDzienna: s.dziennie,
    maxWywolan: s.wywolan,
    oknoMs: s.minut * 60_000,
    artykul,
    maxArtykulow: 1,
    nowyDozwolony: artykulyKonta(konto.login) - artykulowWToku <= 0,
  });
  if (!w.ok) return odmowa(w.powod);
  STAN.wywolan += 1;
  if (w.nowy) {
    STAN.przydzialow += 1;
    console.log(`[start] nowy przydzial pierwszego artykulu bez klucza (dzis ${STAN.magazyn.startLiczby(dzienUtc(teraz)).dzien} z ${s.dziennie})`);
  }
  let rozliczone = false;
  const zwroc = (co) => {
    try {
      if (STAN.magazyn.startZwrot(sk, co)) STAN.zwrotow += 1;
    } catch (e) {
      // Baza chwilowo niedostepna: wywolanie zostaje policzone (ostroznie: koszt, a nie sztuka ponad sufit).
      console.error('[start] zwrot:', e.message);
    }
  };
  return {
    ok: true,
    k: { klucz: s.klucz, dane: { klucz: s.klucz }, czyj: 'start', cel: 'anthropic', zrodlo: 'start' },
    /**
     * Po odpowiedzi dostawcy. Blad HTTP (nic nie kosztowal) oddaje wywolanie i artykul; odmowa modelu oddaje
     * artykul. Odrzucony klucz startu albo blad rozliczen wstrzymuje start. -> { wstrzymany }
     */
    rozlicz(status, cialo, { bezTekstu = false } = {}) {
      rozliczone = true;
      if (status >= 200 && status < 300) {
        if (bezTekstu && artykul) zwroc({ artykul: true });
        return { wstrzymany: false };
      }
      zwroc({ wywolanie: true, artykul });
      const tekst = Buffer.isBuffer(cialo) ? cialo.subarray(0, 4000).toString('utf8') : String(cialo || '').slice(0, 4000);
      if (status === 401 || status === 403) {
        wstrzymaj(`Anthropic odrzucil klucz startu (HTTP ${status}) - sprawdz CAI_START_KLUCZ w konsoli Anthropic`);
        return { wstrzymany: true };
      }
      if (status === 402 || (status === 400 && BLAD_ROZLICZEN.test(tekst))) {
        wstrzymaj(`limit wydatkow albo srodki obszaru roboczego startu (HTTP ${status})`);
        return { wstrzymany: true };
      }
      return { wstrzymany: false };
    },
    /** Koniec bez odpowiedzi dostawcy (przerwanie, limit czasu, blad sieci): wraca tylko sztuka artykulu. */
    zakoncz() {
      if (rozliczone) return;
      rozliczone = true;
      if (artykul) zwroc({ artykul: true });
    },
  };
}

/** Sekcja /api/status: ustawienia (bez klucza), dzisiejsza pula i liczniki od startu procesu. */
function status(teraz = Date.now()) {
  const s = ustawienia();
  const wynik = {
    wlaczony: wlaczony(),
    kluczUstawiony: Boolean(s.klucz),
    wylaczonyAwaryjnie: s.wlaczony === false,
    dziennie: s.dziennie,
    wywolanNaPrzydzial: s.wywolan,
    oknoMinut: s.minut,
    wstrzymanyDo: STAN.wstrzymanyDo > teraz ? STAN.wstrzymanyDo : null,
    powodWstrzymania: STAN.wstrzymanyDo > teraz ? STAN.powodWstrzymania : null,
    odStartuProcesu: { przydzialow: STAN.przydzialow, wywolan: STAN.wywolan, zwrotow: STAN.zwrotow, odmowy: { ...STAN.odmowy } },
  };
  if (STAN.magazyn) {
    try {
      const l = STAN.magazyn.startLiczby(dzienUtc(teraz));
      wynik.dzis = l.dzien;
      wynik.wRoku = l.razem;
    } catch (e) {
      wynik.blad = e.message;
    }
  }
  return wynik;
}

/**
 * Kontekst serwera albo CLI: { KONF, magazyn, podpisz }. Wolane przy kazdym wczytaniu server.js (takze serwery
 * testowe w jednym procesie): zeruje wstrzymanie i liczniki, jak start nowego procesu.
 */
function inicjuj(kontekst) {
  STAN.konf = (kontekst && kontekst.KONF) || null;
  STAN.magazyn = (kontekst && kontekst.magazyn) || null;
  STAN.podpisz = (kontekst && kontekst.podpisz) || null;
  STAN.wstrzymanyDo = 0;
  STAN.powodWstrzymania = '';
  STAN.przydzialow = 0;
  STAN.wywolan = 0;
  STAN.zwrotow = 0;
  STAN.odmowy = {};
}

/** Wiersz do dziennika przy starcie serwera albo null, gdy start wylaczony. */
function opisKonfiguracji() {
  if (!wlaczony()) return null;
  const s = ustawienia();
  return `pierwszy artykul bez klucza: do ${s.dziennie} nowych dziennie, ${s.wywolan} wywolan i ${s.minut} min na przydzial`;
}

module.exports = {
  WZOR_KLUCZA, POWODY_DLA_APLIKACJI,
  sprawdzKonfiguracje, diagnozaKlucza, opisDiagnozy, emailKanoniczny, skrot, wlaczony, stan, stanDla, stanDlaAplikacji, zPowodem,
  przydziel, wstrzymaj, status, inicjuj, opisKonfiguracji,
};
