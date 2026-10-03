#!/usr/bin/env node
'use strict';
/*
 * Atrapa dostawcow AI dla testow Content AI (narzedzia/test_dymny.js i reczne sprawdzanie).
 * Node bez zaleznosci. Udaje:
 *   POST /v1/messages                       Anthropic Messages API (tez web_search, web_fetch, citations)
 *   POST /v1/chat/completions               OpenAI / NVIDIA NIM (format OpenAI)
 *   POST /v1/images/generations             OpenAI grafiki (PNG w b64_json)
 *   POST /v1/audio/speech                   OpenAI TTS (MP3)
 *   POST /v1/audio/transcriptions           OpenAI STT (json / verbose_json / text / srt / vtt)
 *   POST /eleven/v1/text-to-speech/:glos    ElevenLabs TTS (MP3), tez /v1/text-to-speech/:glos
 *   POST /v1/embeddings                     NVIDIA / OpenAI embeddings (wektory z hasha)
 *   GET  /zdrowie                           200 + lista obslugiwanych rodzajow
 *   GET  /_atrapa/wywolania                 ostatnie wywolania (do 200), ?n=20
 *
 * Start:  node narzedzia/atrapa/dostawcy.js  (port z ATRAPA_PORT, domyslnie 9199)
 * Zmienne: ATRAPA_PORT, ATRAPA_OPOZNIENIE_MS (np. 300 albo 200-800), ATRAPA_BLAD (429|500|529),
 *          ATRAPA_BLAD_RODZAJ (lista rodzajow, puste = wszystkie), ATRAPA_BLAD_RAZY (ile razy, potem normalnie),
 *          ATRAPA_BLAD_CO (co ktore pasujace wywolanie), ATRAPA_WYSZUKIWANIE (tak|nie|blad),
 *          ATRAPA_PAUSE_TURN=1, ATRAPA_WSTEP=1 (tekst przed wyszukiwaniem), ATRAPA_MYSLENIE (tak|nie),
 *          ATRAPA_DZIENNIK (plik dziennika wywolan).
 * Znaczniki w tresci zapytania (dzialaja tylko dla tego wywolania): [atrapa:429] [atrapa:500] [atrapa:529]
 *   [atrapa:opoznienie=3000] [atrapa:bez-sieci] [atrapa:siec-blad] [atrapa:pause] [atrapa:max-tokens]
 *   [atrapa:pusty] [atrapa:zly-json] [atrapa:ocena=55] [atrapa:wstep] [atrapa:bez-uwag] [atrapa:fetch-blad]
 *   Kazdy mozna zawezic do rodzaju: [atrapa:529@artykul].
 *
 * Uzycie jako modul (wariant keys w Playwright):
 *   const atrapa = require('./narzedzia/atrapa/dostawcy.js');
 *   await page.route(/api\.anthropic\.com|api\.openai\.com|api\.elevenlabs\.io/, atrapa.obsluzRoute);
 *   // albo recznie: const json = atrapa.odpowiedz(cialoZapytaniaAnthropic);
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const WERSJA = '2';

function zakres(s) {
  const m = String(s || '').match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2] || m[1])];
}

const KONF = {
  port: Number(process.env.ATRAPA_PORT || 9199),
  host: process.env.ATRAPA_HOST || '127.0.0.1',
  opoznienie: zakres(process.env.ATRAPA_OPOZNIENIE_MS || '0'),
  blad: String(process.env.ATRAPA_BLAD || '').trim(),
  bladRodzaj: String(process.env.ATRAPA_BLAD_RODZAJ || '').split(',').map((s) => s.trim()).filter(Boolean),
  bladRazy: Number(process.env.ATRAPA_BLAD_RAZY || 0),
  bladCo: Math.max(1, Number(process.env.ATRAPA_BLAD_CO || 1)),
  wyszukiwanie: String(process.env.ATRAPA_WYSZUKIWANIE || 'tak').toLowerCase(),
  pauseTurn: process.env.ATRAPA_PAUSE_TURN === '1',
  wstep: process.env.ATRAPA_WSTEP === '1',
  myslenie: String(process.env.ATRAPA_MYSLENIE || 'tak').toLowerCase() !== 'nie',
  cytatWJson: process.env.ATRAPA_CYTAT_W_JSON === '1',
  dziennik: process.env.ATRAPA_DZIENNIK || '',
};
if (!KONF.dziennik) {
  KONF.dziennik = path.join(require('os').tmpdir(), 'atrapa-wywolania-' + KONF.port + '.log');
}

// ─── Narzedzia ogolne ────────────────────────────────────────────────────────

function hash32(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function generator(ziarno) {
  let a = hash32(ziarno) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idLos(prefiks, dl = 24) {
  return prefiks + crypto.randomBytes(dl).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, dl);
}

function zaszyfrowane(dl = 96) {
  return crypto.randomBytes(dl).toString('base64');
}

function wielka(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tokeny(s) {
  return Math.max(1, Math.ceil(String(s || '').length / 4));
}

function tekstBlokow(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((b) => {
      if (!b) return '';
      if (typeof b === 'string') return b;
      if (b.type === 'text') return b.text || '';
      if (b.type === 'tool_result') return tekstBlokow(b.content);
      if (b.type === 'document' && b.source && b.source.type === 'text') return b.source.data || '';
      return '';
    }).join('\n');
  }
  if (typeof c === 'object' && c.text) return c.text;
  return '';
}

function bezHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Znaczniki [atrapa:...] i ustawienia wywolania ──────────────────────────

function znaczniki(surowe, rodzaj) {
  const z = {};
  const re = /\[atrapa:([a-z0-9_=\-]+)(?:@([a-z0-9\-]+))?\]/gi;
  let m;
  while ((m = re.exec(surowe))) {
    if (m[2] && rodzaj && m[2].toLowerCase() !== rodzaj && !rodzaj.startsWith(m[2].toLowerCase())) continue;
    const [klucz, wartosc] = m[1].toLowerCase().split('=');
    z[klucz] = wartosc === undefined ? true : wartosc;
  }
  return z;
}

let licznikBledow = 0;
let pasujacychDoBledu = 0;

/** Zwraca kod bledu do wstrzykniecia albo 0. */
function bladDlaWywolania(rodzaj, zn) {
  for (const k of ['429', '500', '529', '503', '400', '401']) if (zn[k]) return Number(k);
  if (!KONF.blad) return 0;
  if (KONF.bladRodzaj.length && !KONF.bladRodzaj.some((r) => rodzaj === r || rodzaj.startsWith(r))) return 0;
  pasujacychDoBledu++;
  if ((pasujacychDoBledu - 1) % KONF.bladCo !== 0) return 0;
  if (KONF.bladRazy && licznikBledow >= KONF.bladRazy) return 0;
  licznikBledow++;
  return Number(KONF.blad) || 500;
}

function opoznienieMs(zn) {
  if (zn.opoznienie) return Number(zn.opoznienie) || 0;
  const [a, b] = KONF.opoznienie;
  return a + Math.floor(Math.random() * (b - a + 1));
}

// ─── Wykrywanie jezyka ───────────────────────────────────────────────────────

const JEZYKI = { Polish: 'pl', English: 'en', German: 'de', Czech: 'cs', Polski: 'pl', Deutsch: 'de' };

function wykryjJezyk(sys, usr) {
  let m = (sys + '\n' + usr).match(/\bWrite in (Polish|English|German|Czech)\b/);
  if (m) return JEZYKI[m[1]];
  m = sys.match(/\bin (Polish|English|German|Czech)\b/) || usr.match(/\bin (Polish|English|German|Czech)\b/);
  if (m) return JEZYKI[m[1]];
  m = (sys + '\n' + usr).match(/\b(?:Language|Język|Jezyk)\s*:\s*(Polski|Polish|English|Deutsch|German|Czech)/i);
  if (m) return JEZYKI[wielka(m[1].toLowerCase())] || 'pl';
  const pl = (usr.match(/[ąćęłńóśźż]/gi) || []).length;
  return pl > 3 ? 'pl' : (usr.length > 40 ? 'en' : 'pl');
}

// ─── Teksty ──────────────────────────────────────────────────────────────────

const T = {
  pl: {
    akapity: [
      '{K} wymaga przede wszystkim jasnego planu: kto odpowiada za kolejne kroki, jakie są terminy i jak mierzy się efekt.',
      'Dane z bazy wiedzy pokazują, że 7 na 10 zespołów zaczyna od prostego wariantu i rozbudowuje go dopiero po pierwszym miesiącu.',
      'W praktyce oznacza to mniej poprawek, krótszy czas akceptacji i lepszą kontrolę kosztów.',
      'Warto zacząć od przeglądu obecnego procesu, bo pokazuje on, które elementy działają, a które generują opóźnienia.',
      'Koszt wdrożenia zależy od skali: mały zespół zmieści się zwykle w kilku godzinach pracy tygodniowo, większy potrzebuje osoby odpowiedzialnej za całość.',
      'Najlepsze efekty przynosi regularny przegląd wyników co 30 dni i porównanie ich z punktem wyjścia.',
      'Każdy etap warto opisać w jednym dokumencie, żeby nowa osoba w zespole mogła przejąć pracę bez dodatkowych pytań.',
      'Przy wyborze dostawcy liczą się trzy parametry: czas reakcji, przejrzystość cennika i dostępność wsparcia w języku polskim.',
      'Błąd, który powtarza się najczęściej, to zbyt szeroki zakres na starcie zamiast jednego, dobrze zmierzonego pilotażu.',
      'Dobrze przygotowany plan zakłada też, co zrobić, gdy wynik odbiega od założeń o więcej niż 20 procent.',
      'Klienci, którzy przeszli na ten model, skracali czas obsługi zamówienia średnio z 5 do 2 dni roboczych.',
      'Najwięcej zyskują firmy, które powtarzają ten sam proces co najmniej kilka razy w miesiącu.',
      'Dokumentacja źródłowa wskazuje, że pierwszy wynik widać zwykle po 2 do 4 tygodniach od uruchomienia.',
      'Przejrzysty podział ról ogranicza liczbę uzgodnień i pozwala szybciej podejmować decyzje.',
      'Jeżeli proces obejmuje kilka działów, każdy z nich powinien mieć jedną osobę kontaktową.',
      'Raport z najważniejszymi wskaźnikami warto przygotować przed startem, żeby po miesiącu było z czym porównać wynik.',
      'Najprostszy test polega na porównaniu dwóch wariantów na tej samej grupie odbiorców przez 14 dni.',
      'Umowa powinna jasno opisywać zakres usługi, czas reakcji i sposób rozliczenia.',
      'W okresie wzmożonego ruchu, na przykład przed świętami, czas realizacji może wydłużyć się o 1 do 2 dni.',
      'Warto sprawdzić, czy wybrane rozwiązanie integruje się z narzędziami, których zespół już używa.',
      'Ostateczny wybór zależy od budżetu, liczby zamówień i oczekiwanego tempa wzrostu.',
      'Dobrą praktyką jest zapisanie trzech mierników sukcesu i sprawdzanie ich co tydzień.',
      'Zmiany wprowadzane małymi krokami łatwiej zmierzyć i w razie potrzeby wycofać.',
      'Po trzech miesiącach większość zespołów ma już wystarczająco danych, żeby podjąć decyzję o rozszerzeniu.',
    ],
    h1: '{K}: jak działa, dla kogo i od czego zacząć',
    bluf: '{K} pozwala uporządkować pracę tam, gdzie liczą się czas, koszt i przewidywalny wynik. Z bazy wiedzy wynika, że pierwsze efekty widać zwykle po 2 do 4 tygodniach, a największą różnicę daje dobrze przygotowany start.',
    h2: ['Czym jest {k}?', 'Jak działa {k} w praktyce?', 'Dla kogo jest to rozwiązanie?', 'Parametry i koszty w jednym miejscu', 'Jak zacząć: {k} w pierwszych 30 dniach'],
    definicja: '{K} to uporządkowany sposób realizacji zadania, w którym każdy krok ma właściciela, termin i miernik.',
    h3: ['Na co zwrócić uwagę na starcie', 'Najczęstsze błędy i jak ich uniknąć'],
    kroki: ['Określ cel i miernik sukcesu.', 'Zbierz dane wyjściowe z ostatnich 3 miesięcy.', 'Wybierz wariant i ustal budżet.', 'Uruchom pilotaż w jednym obszarze.', 'Po 30 dniach porównaj wyniki i zdecyduj o rozszerzeniu.'],
    dlaKogo: ['małe firmy, które chcą uporządkować proces bez dużych nakładów,', 'sklepy internetowe z powtarzalnymi zamówieniami,', 'zespoły marketingu, które rozliczają się z wyników,', 'firmy planujące wejście na nowy rynek.'],
    tabela: {
      naglowki: ['Parametr', 'Wariant podstawowy', 'Wariant rozszerzony'],
      wiersze: [['Czas wdrożenia', '1 do 2 tygodni', '4 do 6 tygodni'], ['Koszt miesięczny', 'od 490 zł', 'od 1490 zł'], ['Wsparcie', 'e-mail', 'e-mail i telefon'], ['Raporty', 'miesięczne', 'tygodniowe']],
    },
    linkTekst: 'dokumentacji źródłowej',
    linkZdanie: 'Szczegóły znajdziesz w {LINK}, gdzie opisano warunki i wymagania.',
    faqH2: 'Najczęściej zadawane pytania',
    faq: [
      ['Ile trwa wdrożenie?', 'W wariancie podstawowym wdrożenie trwa zwykle od 1 do 2 tygodni.'],
      ['Ile to kosztuje?', 'Wariant podstawowy zaczyna się od 490 zł miesięcznie, rozszerzony od 1490 zł.'],
      ['Od czego zacząć?', 'Najlepiej od pilotażu w jednym obszarze i porównania wyników po 30 dniach.'],
      ['Czy potrzebny jest osobny zespół?', 'Nie, mały zespół wystarczy, jeśli każdy etap ma jednego właściciela.'],
    ],
    wnioski: [
      'Pierwsze efekty widać zwykle po 2 do 4 tygodniach od startu.',
      'Wariant podstawowy kosztuje od 490 zł miesięcznie, rozszerzony od 1490 zł.',
      '7 na 10 zespołów zaczyna od prostego wariantu i rozbudowuje go po miesiącu.',
      'Przegląd wyników co 30 dni pozwala wychwycić odchylenia powyżej 20 procent.',
      'Pilotaż w jednym obszarze zmniejsza ryzyko i ułatwia pomiar.',
    ],
    meta: '{K}: sprawdź, jak działa, dla kogo jest i od czego zacząć. Konkretne kroki, parametry, koszty i najczęstsze błędy w jednym przewodniku.',
    metaDopelnienie: ['Praktyczne wskazówki.', 'Bez zbędnych ogólników.', 'Aktualne dane.'],
    poprawa: 'Ten przewodnik porządkuje najważniejsze informacje: definicję, sposób działania, parametry i pierwsze kroki.',
    wstepSieci: 'Wyszukam aktualne informacje na ten temat. ',
  },
  en: {
    akapity: [
      '{K} needs a clear plan first: who owns each step, what the deadlines are and how the result is measured.',
      'Data from the knowledge base shows that 7 in 10 teams start with a simple variant and extend it only after the first month.',
      'In practice this means fewer revisions, shorter approval times and better cost control.',
      'It is worth starting with a review of the current process, because it shows which parts work and which cause delays.',
      'The cost of rollout depends on scale: a small team usually needs a few hours a week, a larger one needs a dedicated owner.',
      'The best results come from reviewing the numbers every 30 days and comparing them with the baseline.',
      'Each stage should be described in one document, so a new team member can take over without extra questions.',
      'When choosing a provider, three parameters matter: response time, pricing transparency and availability of support.',
      'The most common mistake is a scope that is too broad at the start instead of one well measured pilot.',
      'A good plan also says what to do when the result differs from the assumptions by more than 20 percent.',
      'Customers who moved to this model cut order handling time from 5 to 2 business days on average.',
      'Companies that repeat the same process several times a month gain the most.',
      'The source documentation indicates that the first result is usually visible 2 to 4 weeks after launch.',
      'A clear split of roles reduces the number of handoffs and speeds up decisions.',
      'If the process spans several departments, each of them should have a single contact person.',
      'A report with the key metrics should be prepared before launch, so there is something to compare after a month.',
      'The simplest test compares two variants on the same audience for 14 days.',
      'The contract should clearly describe the scope of the service, response time and billing.',
      'During peak periods, such as before holidays, lead times may grow by 1 to 2 days.',
      'Check whether the chosen solution integrates with the tools the team already uses.',
      'The final choice depends on budget, order volume and the expected pace of growth.',
      'A good practice is to write down three success metrics and check them every week.',
      'Changes introduced in small steps are easier to measure and, if needed, to roll back.',
      'After three months most teams have enough data to decide whether to expand.',
    ],
    h1: '{K}: how it works, who it is for and how to start',
    bluf: '{K} helps organise work where time, cost and a predictable result matter. The knowledge base shows that first effects usually appear within 2 to 4 weeks, and a well prepared start makes the biggest difference.',
    h2: ['What is {k}?', 'How does {k} work in practice?', 'Who is it for?', 'Parameters and costs in one place', 'How to start: {k} in the first 30 days'],
    definicja: '{K} is a structured way of delivering a task in which every step has an owner, a deadline and a metric.',
    h3: ['What to watch at the start', 'Common mistakes and how to avoid them'],
    kroki: ['Define the goal and the success metric.', 'Collect baseline data from the last 3 months.', 'Choose a variant and set the budget.', 'Run a pilot in one area.', 'After 30 days compare the results and decide whether to expand.'],
    dlaKogo: ['small businesses that want to organise the process without large spending,', 'online stores with repeat orders,', 'marketing teams accountable for results,', 'companies planning to enter a new market.'],
    tabela: {
      naglowki: ['Parameter', 'Basic variant', 'Extended variant'],
      wiersze: [['Rollout time', '1 to 2 weeks', '4 to 6 weeks'], ['Monthly cost', 'from 120 EUR', 'from 350 EUR'], ['Support', 'e-mail', 'e-mail and phone'], ['Reports', 'monthly', 'weekly']],
    },
    linkTekst: 'the source documentation',
    linkZdanie: 'You will find the details in {LINK}, which describes the terms and requirements.',
    faqH2: 'Frequently asked questions',
    faq: [
      ['How long does rollout take?', 'In the basic variant rollout usually takes 1 to 2 weeks.'],
      ['How much does it cost?', 'The basic variant starts at 120 EUR per month, the extended one at 350 EUR.'],
      ['Where to start?', 'Start with a pilot in one area and compare results after 30 days.'],
      ['Is a separate team needed?', 'No, a small team is enough if every stage has one owner.'],
    ],
    wnioski: [
      'First effects usually appear 2 to 4 weeks after the start.',
      'The basic variant costs from 120 EUR per month, the extended one from 350 EUR.',
      '7 in 10 teams start simple and extend after the first month.',
      'A review every 30 days catches deviations above 20 percent.',
      'A pilot in one area lowers the risk and makes measurement easier.',
    ],
    meta: '{K}: learn how it works, who it is for and how to start. Concrete steps, parameters, costs and the most common mistakes in one practical guide.',
    metaDopelnienie: ['Practical tips.', 'No filler.', 'Current data.'],
    poprawa: 'This guide organises the key information: the definition, how it works, the parameters and the first steps.',
    wstepSieci: "I'll search for current information on this topic. ",
  },
};

const NAZWY_WNIOSKOW = { pl: 'Kluczowe wnioski', en: 'Key takeaways', de: 'Wichtigste Erkenntnisse', cs: 'Klíčové poznatky' };

function teksty(j) { return T[j] || T.en; }

function wstaw(s, k) {
  return String(s).replace(/\{K\}/g, wielka(k)).replace(/\{k\}/g, k);
}

// ─── Wyniki wyszukiwania (realne, stabilne adresy) ──────────────────────────

const STRONY = [
  { url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content', title: 'Creating helpful, reliable, people-first content | Google Search Central', cytat: 'Google\'s automated ranking systems are designed to present helpful, reliable information that\'s primarily created to benefit people.' },
  { url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide', title: 'SEO Starter Guide: The Basics | Google Search Central', cytat: 'Search engine optimization (SEO) is the process of making your site better for search engines.' },
  { url: 'https://pl.wikipedia.org/wiki/Optymalizacja_dla_wyszukiwarek_internetowych', title: 'Optymalizacja dla wyszukiwarek internetowych - Wikipedia, wolna encyklopedia', cytat: 'Optymalizacja dla wyszukiwarek internetowych to procesy zmierzające do osiągnięcia przez dany serwis internetowy jak najwyższej pozycji w wynikach organicznych wyszukiwarek.' },
  { url: 'https://schema.org/FAQPage', title: 'FAQPage - Schema.org Type', cytat: 'A FAQPage is a WebPage presenting one or more "Frequently asked questions".' },
  { url: 'https://web.dev/articles/vitals', title: 'Web Vitals | web.dev', cytat: 'Web Vitals is an initiative by Google to provide unified guidance for quality signals that are essential to delivering a great user experience on the web.' },
  { url: 'https://www.gov.pl/web/gov/uslugi-dla-przedsiebiorcy', title: 'Usługi dla przedsiębiorcy - Portal Gov.pl', cytat: 'Sprawdź, jakie usługi możesz załatwić przez internet jako przedsiębiorca.' },
  { url: 'https://stat.gov.pl/', title: 'Główny Urząd Statystyczny', cytat: 'Główny Urząd Statystyczny publikuje dane o gospodarce, społeczeństwie i środowisku.' },
  { url: 'https://eur-lex.europa.eu/homepage.html', title: 'EUR-Lex - Access to European Union law', cytat: 'EUR-Lex provides free access to EU law and other public EU documents.' },
];

function wynikiWyszukiwania(zapytanie, los, ile = 5) {
  const start = Math.floor(los() * STRONY.length);
  const wyniki = [];
  for (let i = 0; i < ile; i++) {
    const s = STRONY[(start + i) % STRONY.length];
    const dni = 3 + Math.floor(los() * 400);
    const d = new Date(Date.now() - dni * 86400000);
    wyniki.push({
      type: 'web_search_result',
      url: s.url,
      title: s.title,
      encrypted_content: zaszyfrowane(120),
      // Produkcja podaje page_age na dwa sposoby: data ("September 30, 2025") albo wiek
      // strony ("368 days ago"). Na zmiane, zeby testy widzialy oba (R3-28).
      page_age: i % 2 ? dni + ' days ago' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      _cytat: s.cytat,
    });
  }
  return wyniki;
}

function czyscWynik(w) {
  const k = Object.assign({}, w);
  delete k._cytat;
  return k;
}

// ─── Artykul ────────────────────────────────────────────────────────────────

function analizaZadaniaArtykulu(sys, usr) {
  const temat = ((usr.match(/about: "([^"]+)"/) || usr.match(/about: (.+)/) || [])[1] || '').trim();
  const kwSur = ((usr.match(/Keywords to include naturally: ([^\n]*?)\.?\n/) || usr.match(/Keywords?: ([^\n]+)/) || [])[1] || '').trim();
  const frazy = (kwSur && !/^brak/i.test(kwSur) && kwSur !== 'none') ? kwSur.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const dl = (usr.match(/Target length: ([^\n]+?)\. STRICT/) || [])[1] || '';
  const liczba = Number((dl.replace(/\s/g, '').match(/\d+/) || ['800'])[0]);
  const typ = ((usr.match(/Task: Write an? (.+?) about:/) || [])[1] || '').trim();
  const kwName = (sys.match(/H2 titled "([^"]+)"/) || [])[1] || '';
  // Adresy z bazy wiedzy (tylko z czesci KNOWLEDGE BASE, nie z instrukcji)
  const kb = usr.split('KNOWLEDGE BASE')[1] || '';
  const linki = Array.from(new Set((kb.match(/https?:\/\/[^\s"'<>)\]]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')))).slice(0, 3);
  const aeo = /AEO \(ANSWER ENGINE OPTIMIZATION\) MODE/.test(sys);
  const faq = aeo || /FAQ/i.test(typ);
  const wnioski = /H2 titled "/.test(sys);
  const prasowa = /PRESS RELEASE FORMAT/.test(sys);
  const podcast = /OUTPUT FORMAT OVERRIDE \(podcast\)/.test(sys);
  const newsletter = /OUTPUT FORMAT OVERRIDE \(audio newsletter\)/.test(sys);
  const dataPrasowa = (sys.match(/Format the dateline as "([^"]+)"/) || [])[1] || '';
  return { temat, frazy, slowa: Math.min(3000, Math.max(150, liczba || 800)), typ, kwName, linki, faq, aeo, wnioski, prasowa, podcast, newsletter, dataPrasowa };
}

/**
 * Buduje artykul jako liste segmentow { html, cytat? }. Segment z cytatem
 * staje sie osobnym blokiem tekstu z citations (gdy jest wyszukiwanie).
 */
function zbudujArtykul(j, a, opcje = {}) {
  const t = teksty(j);
  const k = (a.frazy[0] || a.temat || (j === 'pl' ? 'przewodnik' : 'guide')).replace(/\s+/g, ' ').trim();
  const kw = a.frazy[0] ? k : k;
  const los = generator(a.temat + '|' + j);
  const seg = [];
  const dodaj = (html) => seg.push({ html });
  const cytaty = (opcje.cytaty || []).slice();
  let slow = 0;
  const licz = (s) => { slow += bezHtml(s).split(/\s+/).filter(Boolean).length; };

  let pula = t.akapity.slice();
  // przetasowanie deterministyczne
  for (let i = pula.length - 1; i > 0; i--) { const r = Math.floor(los() * (i + 1)); [pula[i], pula[r]] = [pula[r], pula[i]]; }
  let ip = 0;
  const zdanie = () => { const s = wstaw(pula[ip % pula.length], kw); ip++; return s; };
  const akapit = (n) => { const z = []; for (let i = 0; i < n; i++) z.push(zdanie()); return z.join(' '); };

  const h1 = wstaw(t.h1, kw);
  dodaj('<h1>' + esc(h1) + '</h1>\n'); licz(h1);
  const bluf = wstaw(t.bluf, kw);
  dodaj('<p>' + esc(bluf) + '</p>\n'); licz(bluf);
  if (opcje.poprawiony) { dodaj('<p>' + esc(t.poprawa) + '</p>\n'); licz(t.poprawa); }

  const sekcje = [];
  // 1. definicja
  sekcje.push(() => {
    dodaj('<h2>' + esc(wstaw(t.h2[0], kw)) + '</h2>\n');
    const p1 = wstaw(t.definicja, kw) + ' ' + akapit(2);
    if (cytaty.length) {
      const c = cytaty.shift();
      dodaj('<p>' + esc(p1) + ' ');
      seg.push({ html: esc(c.zdanie), cytat: c });
      dodaj('</p>\n');
      licz(c.zdanie);
    } else {
      dodaj('<p>' + esc(p1) + '</p>\n');
    }
    licz(p1);
  });
  // 2. jak dziala + lista krokow + h3
  sekcje.push(() => {
    dodaj('<h2>' + esc(wstaw(t.h2[1], kw)) + '</h2>\n');
    const p = akapit(3); dodaj('<p>' + esc(p) + '</p>\n'); licz(p);
    dodaj('<ol>\n' + t.kroki.map((s) => '<li>' + esc(s) + '</li>').join('\n') + '\n</ol>\n'); licz(t.kroki.join(' '));
    dodaj('<h3>' + esc(t.h3[0]) + '</h3>\n');
    const p2 = akapit(2); dodaj('<p>' + esc(p2) + '</p>\n'); licz(p2);
  });
  // 3. dla kogo + lista
  sekcje.push(() => {
    dodaj('<h2>' + esc(wstaw(t.h2[2], kw)) + '</h2>\n');
    const p = akapit(2);
    if (cytaty.length) {
      const c = cytaty.shift();
      dodaj('<p>' + esc(p) + ' ');
      seg.push({ html: esc(c.zdanie), cytat: c });
      dodaj('</p>\n');
      licz(c.zdanie);
    } else dodaj('<p>' + esc(p) + '</p>\n');
    licz(p);
    dodaj('<ul>\n' + t.dlaKogo.map((s) => '<li>' + esc(s) + '</li>').join('\n') + '\n</ul>\n'); licz(t.dlaKogo.join(' '));
  });
  // 4. tabela
  sekcje.push(() => {
    dodaj('<h2>' + esc(wstaw(t.h2[3], kw)) + '</h2>\n');
    const p = akapit(2); dodaj('<p>' + esc(p) + '</p>\n'); licz(p);
    const st = ' style="border:1px solid #ccc;padding:8px"';
    dodaj('<table style="border-collapse:collapse">\n<thead><tr>' + t.tabela.naglowki.map((h) => '<th' + st + '>' + esc(h) + '</th>').join('') + '</tr></thead>\n<tbody>\n'
      + t.tabela.wiersze.map((w) => '<tr>' + w.map((c) => '<td' + st + '>' + esc(c) + '</td>').join('') + '</tr>').join('\n') + '\n</tbody>\n</table>\n');
    licz(t.tabela.wiersze.flat().join(' '));
  });
  // 5. jak zaczac + link + h3
  sekcje.push(() => {
    dodaj('<h2>' + esc(wstaw(t.h2[4], kw)) + '</h2>\n');
    const adres = a.linki[0] || (opcje.linkSieci) || 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content';
    const link = '<a href="' + esc(adres) + '" target="_blank" rel="noopener">' + esc(t.linkTekst) + '</a>';
    const p = akapit(2) + ' ' + esc(t.linkZdanie).replace('{LINK}', link);
    if (cytaty.length) {
      const c = cytaty.shift();
      dodaj('<p>' + p.replace(/<a [^>]+>([^<]*)<\/a>/, (m) => m) + ' ');
      seg.push({ html: esc(c.zdanie), cytat: c });
      dodaj('</p>\n');
      licz(c.zdanie);
    } else dodaj('<p>' + p + '</p>\n');
    licz(p);
    dodaj('<h3>' + esc(t.h3[1]) + '</h3>\n');
    const p2 = akapit(3); dodaj('<p>' + esc(p2) + '</p>\n'); licz(p2);
  });
  for (const s of sekcje) s();

  // Dopelnienie do docelowej dlugosci (akapity dokladane przed wnioskami)
  const docelowo = Math.round(a.slowa * 0.95);
  let dodatkowe = 0;
  while (slow < docelowo - 60 && dodatkowe < 40) {
    if (dodatkowe % 3 === 0) {
      const nag = j === 'pl' ? ['Co warto wiedzieć o kosztach', 'Jak mierzyć efekty', 'Jak wybrać wariant', 'Co zmienia się po wdrożeniu', 'Jak przygotować zespół', 'Jak ograniczyć ryzyko'][(dodatkowe / 3) % 6]
        : ['What to know about costs', 'How to measure results', 'How to choose a variant', 'What changes after rollout', 'How to prepare the team', 'How to limit the risk'][(dodatkowe / 3) % 6];
      dodaj('<h3>' + esc(nag) + '</h3>\n'); licz(nag);
    }
    const p = akapit(3 + (dodatkowe % 2)); dodaj('<p>' + esc(p) + '</p>\n'); licz(p);
    dodatkowe++;
  }

  if (a.faq) {
    // AEO i strona FAQ: pytania jako H2 zakonczone znakiem zapytania, odpowiedz 40-60 slow
    for (const [q, o] of t.faq) {
      const odp = o + ' ' + akapit(2);
      dodaj('<h2>' + esc(q) + '</h2>\n<p>' + esc(odp) + '</p>\n'); licz(q + ' ' + odp);
    }
    // Razem z pytaniami w naglowkach sekcji (Czym jest...?, Jak dziala...?, Dla kogo...?) daje 7 pytan H2 - w normie AEO 5-7.
  }

  const nazwaWnioskow = a.kwName || NAZWY_WNIOSKOW[j] || NAZWY_WNIOSKOW.en;
  if (!opcje.bezWnioskow && a.wnioski !== false) {
    dodaj('<h2>' + esc(nazwaWnioskow) + '</h2>\n<ul>\n' + t.wnioski.map((s) => '<li>' + esc(s) + '</li>').join('\n') + '\n</ul>\n');
    licz(t.wnioski.join(' '));
  }

  dodaj('<div class="meta-box"><div class="meta-label">Meta description (SEO)</div><p>' + esc(metaOpis(j, kw)) + '</p></div>');
  return { segmenty: seg, slow, fraza: kw };
}

function metaOpis(j, k) {
  const t = teksty(j);
  let s = wstaw(t.meta, k);
  if (s.length > 160) {
    s = s.slice(0, 160);
    s = s.slice(0, s.lastIndexOf(' ')).replace(/[,:;]$/, '') + '.';
  }
  let i = 0;
  while (s.length < 150 && i < t.metaDopelnienie.length) {
    const n = s + ' ' + t.metaDopelnienie[i++];
    if (n.length <= 160) s = n;
  }
  return s;
}

// ─── Odpowiedzi Anthropic ───────────────────────────────────────────────────

function wiadomosc(cialo, content, opcje = {}) {
  const wyjscie = content.map((b) => b.text || b.thinking || JSON.stringify(b.input || '') || '').join('');
  const usage = {
    input_tokens: tokeny(JSON.stringify(cialo.messages || '') + JSON.stringify(cialo.system || '')),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: tokeny(wyjscie),
  };
  if (opcje.szukan) usage.server_tool_use = { web_search_requests: opcje.szukan };
  if (opcje.pobran) usage.server_tool_use = Object.assign(usage.server_tool_use || {}, { web_fetch_requests: opcje.pobran });
  return {
    id: idLos('msg_atrapa_'),
    type: 'message',
    role: 'assistant',
    model: cialo.model || 'claude-opus-5',
    content,
    stop_reason: opcje.stop || 'end_turn',
    stop_sequence: null,
    usage,
  };
}

function blokMyslenia(cialo, opis) {
  if (!KONF.myslenie) return [];
  if (cialo.thinking && cialo.thinking.type === 'disabled') return [];
  return [{ type: 'thinking', thinking: opis, signature: zaszyfrowane(64) }];
}

/** Gdy tekst przekracza max_tokens - utnij jak prawdziwe API. */
function przytnijDoLimitu(cialo, content, wymus) {
  const limit = Number(cialo.max_tokens) || 0;
  if (!limit && !wymus) return { content, stop: null };
  let budzet = wymus ? Math.max(40, Math.floor(content.reduce((s, b) => s + tokeny(b.text || ''), 0) / 3)) : limit;
  let przekroczono = false;
  const wynik = [];
  for (const b of content) {
    if (b.type !== 'text') { wynik.push(b); continue; }
    const tk = tokeny(b.text);
    if (przekroczono) continue;
    if (tk <= budzet) { wynik.push(b); budzet -= tk; continue; }
    const nb = Object.assign({}, b, { text: b.text.slice(0, Math.max(0, budzet * 4)) });
    delete nb.citations;
    wynik.push(nb);
    przekroczono = true;
  }
  return { content: wynik, stop: przekroczono ? 'max_tokens' : null };
}

function tekstJson(obiekt, zn) {
  if (zn['zly-json']) return '{"score": 70, "issues": ["niedomkniety' ;
  return JSON.stringify(obiekt);
}

function wynikOceny(tekst, zn) {
  if (zn.ocena) return Number(zn.ocena);
  const pl = /Ten przewodnik porządkuje|This guide organises/.test(tekst);
  return pl ? 86 : 64;
}

const OCENY = {
  pl: {
    issues: ['Fraza kluczowa tylko w jednym nagłówku H2', 'Meta description bez frazy kluczowej', 'Dwa akapity bez konkretnych danych', 'Brak definicji kluczowego pojęcia'],
    seo: [[true, 'Fraza kluczowa w H1 i dwóch nagłówkach H2'], [true, 'Logiczna struktura nagłówków H1, H2 i H3'], [false, 'Dwa punkty wniosków bez konkretnych liczb'], [true, 'Meta description ma 150-160 znaków'], [false, 'Marka nie pada w każdej sekcji H2']],
    aio: [[true, 'Pierwszy akapit odpowiada wprost na pytanie'], [true, 'Krótkie fragmenty łatwe do zacytowania'], [false, 'Brak definicji dwóch pojęć branżowych'], [true, 'Tekst pokrywa: co to, jak działa, dla kogo'], [false, 'Dwa akapity bez konkretnej liczby'], [true, 'Sekcja wniosków z konkretnymi liczbami']],
  },
  en: {
    issues: ['Keyword appears in only one H2 heading', 'Meta description lacks the keyword', 'Two paragraphs without concrete data', 'Key concept is not defined'],
    seo: [[true, 'Keyword in H1 and two H2 headings'], [true, 'Logical H1, H2 and H3 structure'], [false, 'Two takeaways without concrete numbers'], [true, 'Meta description is 150-160 characters'], [false, 'Brand is not named in every H2 section']],
    aio: [[true, 'First paragraph answers the question directly'], [true, 'Short passages that are easy to quote'], [false, 'Two industry terms are not defined'], [true, 'Covers what it is, how it works, who for'], [false, 'Two paragraphs without a concrete number'], [true, 'Takeaways section with concrete numbers']],
  },
};

function odpOcenaIssues(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const score = wynikOceny(ctx.usr, zn);
  const issues = score >= 82 ? [OCENY[j].issues[2]] : OCENY[j].issues.slice(0, 3);
  return [{ type: 'text', text: tekstJson({ score, issues }, zn) }];
}

function odpOcenaItems(cialo, ctx, zn, rodzaj) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const score = wynikOceny(ctx.usr, zn);
  const baza = rodzaj === 'ocena-aio' ? OCENY[j].aio : OCENY[j].seo;
  const items = baza.map(([ok, text], i) => ({ ok: score >= 82 ? (ok || i % 2 === 0) : ok, text }));
  return [{ type: 'text', text: tekstJson({ score, items }, zn) }];
}

function odpFakty(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  if (zn['bez-uwag']) return [{ type: 'text', text: tekstJson({ uwagi: [] }, zn) }];
  const art = (ctx.usr.split(/ARTICLE:\n/)[1] || ctx.usr).replace(/\s+/g, ' ');
  const zdania = art.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 25);
  const zLiczba = zdania.find((s) => /\d/.test(s)) || zdania[0] || '';
  const inne = zdania.find((s) => s !== zLiczba && s.length > 40) || '';
  const uwagi = [];
  if (zLiczba) uwagi.push({ rodzaj: 'liczba', cytat: zLiczba.slice(0, 120), powod: j === 'pl' ? 'Tej wartości nie ma w źródłach; źródła podają inny zakres albo milczą.' : 'This value is not in the sources; they give a different range or none.' });
  if (inne) uwagi.push({ rodzaj: 'zakres', cytat: inne.slice(0, 120), powod: j === 'pl' ? 'Źródła mówią o tym ogólnie, artykuł rozciąga to na wszystkie przypadki.' : 'The sources state this generally; the article extends it to every case.' });
  return [{ type: 'text', text: tekstJson({ uwagi }, zn) }];
}

function odpSerp(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const fraza = ((ctx.usr.match(/Keyword: ([^\n]+)/) || [])[1] || 'temat').trim();
  const los = generator('serp|' + fraza);
  const tresc = [];
  const sieci = wyszukiwanieWlaczone(zn);
  if (sieci === 'tak') {
    const id = idLos('srvtoolu_atrapa_');
    tresc.push({ type: 'server_tool_use', id, name: 'web_search', input: { query: fraza } });
    tresc.push({ type: 'web_search_tool_result', tool_use_id: id, content: wynikiWyszukiwania(fraza, los, 8).map(czyscWynik) });
  } else if (sieci === 'blad') {
    const id = idLos('srvtoolu_atrapa_');
    tresc.push({ type: 'server_tool_use', id, name: 'web_search', input: { query: fraza } });
    tresc.push({ type: 'web_search_tool_result', tool_use_id: id, content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } });
  }
  const dane = j === 'pl' ? {
    context: 'Strony z czołówki dla frazy „' + fraza + '” skupiają się na definicji, kosztach i porównaniu wariantów. Większość zawiera listę kroków oraz sekcję pytań i odpowiedzi.',
    topics: ['definicja i zastosowania', 'koszty i cennik', 'porównanie wariantów', 'wdrożenie krok po kroku', 'najczęstsze błędy', 'wymagania formalne', 'czas realizacji', 'pytania i odpowiedzi'],
    phrases: [fraza, fraza + ' cena', fraza + ' opinie', 'jak wybrać ' + fraza, fraza + ' krok po kroku', 'ile kosztuje ' + fraza, fraza + ' dla firm', fraza + ' porównanie', fraza + ' 2026', 'najlepsze ' + fraza],
  } : {
    context: 'Top results for "' + fraza + '" focus on the definition, costs and a comparison of options. Most include a list of steps and an FAQ section.',
    topics: ['definition and uses', 'costs and pricing', 'comparison of options', 'step by step rollout', 'common mistakes', 'formal requirements', 'lead time', 'questions and answers'],
    phrases: [fraza, fraza + ' price', fraza + ' reviews', 'how to choose ' + fraza, fraza + ' step by step', 'how much does ' + fraza + ' cost', fraza + ' for business', fraza + ' comparison', fraza + ' 2026', 'best ' + fraza],
  };
  dane.avgWords = 1200 + Math.floor(los() * 700);
  dane.avgH2 = 5 + Math.floor(los() * 4);
  tresc.push({ type: 'text', text: tekstJson(dane, zn) });
  return { content: tresc, szukan: sieci === 'nie' ? 0 : 1 };
}

function wyszukiwanieWlaczone(zn) {
  if (zn['bez-sieci']) return 'nie';
  if (zn['siec-blad']) return 'blad';
  return KONF.wyszukiwanie === 'nie' ? 'nie' : (KONF.wyszukiwanie === 'blad' ? 'blad' : 'tak');
}

function odpArtykul(cialo, ctx, zn) {
  const a = analizaZadaniaArtykulu(ctx.sys, ctx.usr);
  const j = ctx.jezyk;
  const mozeSzukac = (ctx.narzedzia || []).some((n) => /web_search/.test(n));
  const sieci = mozeSzukac ? wyszukiwanieWlaczone(zn) : 'nie';
  const los = generator('siec|' + a.temat);
  const tresc = [];
  let szukan = 0;
  let cytaty = [];
  let linkSieci = '';
  const wstep = KONF.wstep || zn.wstep;

  // Kontynuacja po pause_turn: ostatnia wiadomosc to odpowiedz asystenta
  if (ctx.kontynuacja) {
    const poprzednie = ctx.wiad[ctx.wiad.length - 1].content || [];
    for (const b of poprzednie) {
      if (b && b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const w of b.content) cytaty.push({ url: w.url, title: w.title });
      }
    }
    cytaty = cytaty.slice(0, 3).map((c, i) => ({
      url: c.url, title: c.title,
      zdanie: (STRONY.find((s) => s.url === c.url) || STRONY[i]).cytat,
    }));
    linkSieci = cytaty[0] ? cytaty[0].url : '';
  } else if (sieci === 'tak') {
    const zapytania = [a.frazy[0] || a.temat, (a.frazy[1] || a.temat) + (j === 'pl' ? ' koszty' : ' costs')];
    if (wstep) tresc.push({ type: 'text', text: teksty(j).wstepSieci });
    const znalezione = [];
    for (const q of zapytania) {
      const id = idLos('srvtoolu_atrapa_');
      const wyniki = wynikiWyszukiwania(q, los, 5);
      tresc.push({ type: 'server_tool_use', id, name: 'web_search', input: { query: q } });
      tresc.push({ type: 'web_search_tool_result', tool_use_id: id, content: wyniki.map(czyscWynik) });
      znalezione.push(...wyniki);
      szukan++;
    }
    const unikalne = [];
    for (const w of znalezione) if (!unikalne.some((u) => u.url === w.url)) unikalne.push(w);
    cytaty = unikalne.slice(0, 3).map((w) => ({ url: w.url, title: w.title, zdanie: w._cytat }));
    linkSieci = cytaty[0] ? cytaty[0].url : '';
    if (KONF.pauseTurn || zn.pause) {
      return { content: tresc, stop: 'pause_turn', szukan };
    }
  } else if (sieci === 'blad') {
    const id = idLos('srvtoolu_atrapa_');
    tresc.push({ type: 'server_tool_use', id, name: 'web_search', input: { query: a.frazy[0] || a.temat } });
    tresc.push({ type: 'web_search_tool_result', tool_use_id: id, content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } });
    szukan++;
  }

  if (a.podcast || a.newsletter || a.prasowa) {
    if (zn.pusty) return { content: [], szukan };
    const tytul = a.temat || a.frazy[0];
    const html = a.podcast ? skryptPodcastu(j, tytul, etykietyZPromptu(ctx.sys, j), plcieZPromptu(ctx.sys))
      : a.newsletter ? skryptNewslettera(j, tytul)
        : informacjaPrasowa(j, a, linkSieci);
    return { content: blokMyslenia(cialo, 'Format override.').concat(tresc, [{ type: 'text', text: html }]), szukan };
  }

  const art = zbudujArtykul(j, a, { cytaty, linkSieci });
  if (zn.pusty) return { content: [], szukan };
  // Laczenie segmentow w bloki tekstu; segment z cytatem = osobny blok z citations
  const bloki = [];
  let bufor = '';
  for (const s of art.segmenty) {
    if (s.cytat && sieci !== 'nie') {
      if (bufor) { bloki.push({ type: 'text', text: bufor }); bufor = ''; }
      bloki.push({
        type: 'text', text: s.html,
        citations: [{ type: 'web_search_result_location', url: s.cytat.url, title: s.cytat.title, encrypted_index: zaszyfrowane(48), cited_text: String(s.cytat.zdanie).slice(0, 150) }],
      });
    } else bufor += s.html;
  }
  if (bufor) bloki.push({ type: 'text', text: bufor });
  const mysl = blokMyslenia(cialo, j === 'pl' ? 'Plan artykułu: definicja, działanie, odbiorcy, parametry, start, wnioski, meta.' : 'Article plan: definition, how it works, audience, parameters, start, takeaways, meta.');
  return { content: mysl.concat(tresc, bloki), szukan };
}

function odpPoprawa(cialo, ctx, zn) {
  const j = ctx.jezyk;
  // Oryginal: po "Original article:\n" albo "Article:\n"
  const m = ctx.usr.match(/(?:Original article|Article|ARTICLE|Artykuł|Tekst):\s*\n([\s\S]+)$/);
  let html = m ? m[1].trim() : '';
  if (!/<h[1-3]|<p[ >]/i.test(html)) {
    // brak HTML w prompcie - zbuduj nowy artykul
    const a = analizaZadaniaArtykulu(ctx.sys, ctx.usr);
    if (!a.temat) a.temat = ((ctx.usr.match(/Keywords: ([^\n.]+)/) || [])[1] || (j === 'pl' ? 'temat' : 'topic')).split(',')[0].trim();
    html = zbudujArtykul(j, a, { poprawiony: true }).segmenty.map((s) => s.html).join('');
  } else if (!/Ten przewodnik porządkuje|This guide organises/.test(html)) {
    const zdanie = '<p>' + esc(teksty(j).poprawa) + '</p>\n';
    const i = html.indexOf('</p>');
    html = i >= 0 ? html.slice(0, i + 4) + '\n' + zdanie + html.slice(i + 4) : zdanie + html;
  }
  const mysl = blokMyslenia(cialo, 'Fix only the listed issues.');
  return mysl.concat([{ type: 'text', text: html }]);
}

function odpWebFetch(cialo, ctx, zn) {
  const url = ((ctx.usr.match(/https?:\/\/[^\s"'<>]+/) || [])[0] || 'https://example.com/').replace(/[.,;:]+$/, '');
  const id = idLos('srvtoolu_atrapa_');
  const tresc = [{ type: 'server_tool_use', id, name: 'web_fetch', input: { url } }];
  if (zn['fetch-blad'] || /atrapa-blad|nie-istnieje/.test(url)) {
    tresc.push({ type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } });
  } else {
    let host = url;
    try { host = new URL(url).hostname; } catch { /* zostaw */ }
    const j = /\.pl(\/|$)/.test(host) ? 'pl' : 'en';
    const tk = teksty(j);
    const tekst = (j === 'pl' ? 'Strona ' + host + '. ' : 'Page ' + host + '. ')
      + tk.akapity.slice(0, 12).map((s) => wstaw(s, j === 'pl' ? 'usługa' : 'the service')).join(' ')
      + '\n\n' + tk.tabela.naglowki.join(' | ') + '\n' + tk.tabela.wiersze.map((w) => w.join(' | ')).join('\n');
    tresc.push({
      type: 'web_fetch_tool_result', tool_use_id: id,
      content: {
        type: 'web_fetch_result', url,
        content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: tekst }, title: (j === 'pl' ? 'Strona ' : 'Page ') + host },
        retrieved_at: new Date().toISOString(),
      },
    });
  }
  tresc.push({ type: 'text', text: 'OK' });
  return { content: tresc, pobran: 1 };
}

// ─── Wersja 2: pozostale funkcje aplikacji ──────────────────────────────────

function krotko(s, max) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '');
}

/** Bloki web_search dla dowolnego zapytania; zwraca tez wyniki do cytowania. */
function blokiWyszukiwania(zapytania, los, zn) {
  const sieci = wyszukiwanieWlaczone(zn);
  const bloki = [];
  const wyniki = [];
  let szukan = 0;
  if (sieci === 'nie') return { bloki, wyniki, szukan, sieci };
  for (const q of zapytania) {
    const id = idLos('srvtoolu_atrapa_');
    bloki.push({ type: 'server_tool_use', id, name: 'web_search', input: { query: q } });
    szukan++;
    if (sieci === 'blad') {
      bloki.push({ type: 'web_search_tool_result', tool_use_id: id, content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } });
      continue;
    }
    const w = wynikiWyszukiwania(q, los, 5);
    bloki.push({ type: 'web_search_tool_result', tool_use_id: id, content: w.map(czyscWynik) });
    for (const x of w) if (!wyniki.some((y) => y.url === x.url)) wyniki.push(x);
  }
  return { bloki, wyniki, szukan, sieci };
}

/** Zdania -> bloki tekstu; co drugie zdanie (do 3) z przypisem do wyniku wyszukiwania. */
function tekstZCytatami(zdania, wyniki, lacznik = ' ') {
  const bloki = [];
  let bufor = '';
  let ic = 0;
  zdania.forEach((z, i) => {
    const w = wyniki[ic];
    if (w && i % 2 === 1 && ic < 3) {
      if (bufor) { bloki.push({ type: 'text', text: bufor }); bufor = ''; }
      bloki.push({ type: 'text', text: z, citations: [{ type: 'web_search_result_location', url: w.url, title: w.title, encrypted_index: zaszyfrowane(48), cited_text: String(w._cytat || '').slice(0, 150) }] });
      ic++;
      bufor = lacznik;
    } else {
      bufor += (bufor && bufor !== lacznik ? lacznik : '') + z;
    }
  });
  if (bufor.trim()) bloki.push({ type: 'text', text: bufor });
  return bloki;
}

function odpTytuly(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const kw = krotko(((ctx.usr.match(/Main keyword: ([^\n]+)/) || ctx.usr.match(/Topic: ([^\n]+)/) || [])[1] || 'temat').split(',')[0], 34);
  const K = wielka(kw);
  const r = new Date().getFullYear();
  const tytuly = j === 'pl'
    ? [K + ': kompletny przewodnik ' + r, K + ': ceny, warianty i jak wybrać', 'Jak zacząć: ' + kw + ' krok po kroku', '7 faktów, które warto znać: ' + kw, 'Czym jest ' + kw + '? Definicja i przykłady']
    : [K + ': the complete ' + r + ' guide', K + ': prices, options and how to choose', 'How to start: ' + kw + ' step by step', '7 facts worth knowing: ' + kw, 'What is ' + kw + '? Definition and examples'];
  return [{ type: 'text', text: tekstJson(tytuly, zn) }];
}

function odpTematy(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const potrzeba = (ctx.usr.split(/Business need:\s*\n/)[1] || ctx.usr).split(/\n/)[0];
  const X = wielka(krotko(potrzeba.split(/[,.;:!?]/)[0], 40) || (j === 'pl' ? 'Usługa' : 'Service'));
  const r = new Date().getFullYear();
  const pl = [
    [X + ': jak wybrać najlepszą opcję w ' + r + ' roku', 'Osoby na etapie decyzji szukają kryteriów wyboru; to tekst z wysoką intencją.'],
    [X + ': ile to kosztuje i od czego zależy cena', 'Pytanie o cenę pada przed każdym zakupem, a odpowiedzi w sieci są rozproszone.'],
    [X + ' krok po kroku: praktyczna instrukcja', 'Początkujący szukają instrukcji, którą da się wykonać od razu.'],
    [X + ': porównanie dostępnych wariantów', 'Porównania przyciągają osoby, które mają już krótką listę.'],
    [X + ': 7 najczęstszych błędów i jak ich uniknąć', 'Lista błędów dobrze się udostępnia i buduje zaufanie do marki.'],
    [X + ' dla małej firmy: od czego zacząć', 'Małe firmy szukają prostego startu bez dużego budżetu.'],
    [X + ': pytania, które klienci zadają przed decyzją', 'Odpowiedzi na pytania klientów skracają rozmowę handlową.'],
    [X + ': jak zmierzyć efekty po 30 dniach', 'Osoby po wdrożeniu chcą wiedzieć, czy inwestycja się zwraca.'],
    [X + ' czy rozwiązanie we własnym zakresie', 'Tekst dla osób, które rozważają zrobienie tego samodzielnie.'],
    [X + ': wymagania i przepisy, o których trzeba pamiętać', 'Kwestie formalne budzą obawy i są częstym powodem odkładania decyzji.'],
  ];
  const en = [
    [X + ': how to choose the best option in ' + r, 'People at the decision stage look for selection criteria; high intent.'],
    [X + ': how much it costs and what drives the price', 'Price questions come before every purchase and answers are scattered.'],
    [X + ' step by step: a practical guide', 'Beginners look for instructions they can follow right away.'],
    [X + ': comparing the available options', 'Comparisons attract people who already have a shortlist.'],
    [X + ': 7 common mistakes and how to avoid them', 'Mistake lists are shared often and build trust in the brand.'],
    [X + ' for a small business: where to start', 'Small businesses look for a simple start without a big budget.'],
    [X + ': questions customers ask before deciding', 'Answering customer questions shortens the sales conversation.'],
    [X + ': how to measure results after 30 days', 'People after rollout want to know whether it pays off.'],
    [X + ' or doing it in-house', 'For readers who consider doing it themselves.'],
    [X + ': requirements and rules to remember', 'Formal issues raise concerns and often delay the decision.'],
  ];
  const tematy = (j === 'pl' ? pl : en).map(([temat, dlaczego]) => ({ temat, dlaczego }));
  return blokMyslenia(cialo, 'Ten topics with varied intent.').concat([{ type: 'text', text: tekstJson({ tematy }, zn) }]);
}

function odpBrief(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const kw = krotko(((ctx.usr.match(/Topic: ([^\n]+)/) || [])[1] || 'temat'), 50).toLowerCase();
  const t = teksty(j);
  const dane = j === 'pl' ? {
    keywords: [kw, kw + ' cena', kw + ' opinie', 'jak wybrać ' + kw, kw + ' krok po kroku'],
    h2: [wstaw(t.h2[0], kw), wstaw(t.h2[1], kw), t.h2[2], t.h2[3], 'Najczęstsze błędy i jak ich uniknąć', 'Najczęściej zadawane pytania'],
    gap: 'W czołowych wynikach brakuje porównania kosztów w rozbiciu na warianty i przykładu wdrożenia z liczbami.',
    words: '1200-1500',
  } : {
    keywords: [kw, kw + ' price', kw + ' reviews', 'how to choose ' + kw, kw + ' step by step'],
    h2: [wstaw(t.h2[0], kw), wstaw(t.h2[1], kw), t.h2[2], t.h2[3], 'Common mistakes and how to avoid them', 'Frequently asked questions'],
    gap: 'Top results lack a cost comparison by variant and a rollout example with numbers.',
    words: '1200-1500',
  };
  return blokMyslenia(cialo, 'Brief.').concat([{ type: 'text', text: tekstJson(dane, zn) }]);
}

function odpBrandVoice(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const dane = j === 'pl' ? {
    summary: 'Ton profesjonalny i przystępny. Zdania średnio 15-20 słów, dużo konkretów i liczb. Bez żargonu i nadmiaru przymiotników.',
    style: 'Pisz rzeczowo i życzliwie. Zaczynaj od odpowiedzi, potem wyjaśniaj. Używaj konkretnych liczb ze źródeł. Zdania krótkie, strona czynna, zwracaj się do czytelnika per Ty. Unikaj żargonu, superlatywów i ogólników.',
  } : {
    summary: 'Professional yet approachable tone. Sentences average 15-20 words with many concrete facts and numbers. No jargon or excessive adjectives.',
    style: 'Write factually and warmly. Lead with the answer, then explain. Use concrete numbers from the sources. Short sentences, active voice, address the reader as you. Avoid jargon, superlatives and vague statements.',
  };
  return [{ type: 'text', text: tekstJson(dane, zn) }];
}

function odpPrzerobka(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const u = ctx.usr;
  const temat = krotko((u.match(/\(temat: ([^)\n]+)\)/) || [])[1] || (j === 'pl' ? 'nasz temat' : 'our topic'), 60);
  const marka = ((u.match(/Zespół ([^\n]+)/) || [])[1] || 'Content AI').trim();
  let tekst;
  if (/LinkedIn/i.test(u)) {
    tekst = j === 'pl'
      ? `Czy wiesz, że 7 na 10 zespołów zaczyna od najprostszego wariantu i dopiero po miesiącu go rozbudowuje? 🚀\n\nTemat „${temat}” wraca w rozmowach z klientami co tydzień. Najwięcej zyskują ci, którzy zaczynają od jednego, dobrze zmierzonego pilotażu zamiast pięciu rzeczy naraz.\n\nPierwsze efekty widać zwykle po 2 do 4 tygodniach. Warunek jest jeden: przed startem trzeba zapisać trzy mierniki i sprawdzać je co tydzień.\n\nNajczęstszy błąd? Zbyt szeroki zakres na początku. Mniejszy krok łatwiej zmierzyć i w razie potrzeby wycofać.\n\nJak to wygląda u Was? Zaczynacie od pilotażu czy od razu od pełnego wdrożenia?`
      : `Did you know that 7 in 10 teams start with the simplest variant and only extend it after a month? 🚀\n\n"${temat}" comes up in our client conversations every week. The teams that gain most start with one well measured pilot instead of five things at once.\n\nFirst effects usually show within 2 to 4 weeks. One condition: write down three metrics before launch and check them weekly.\n\nThe most common mistake? A scope that is too broad at the start. A smaller step is easier to measure and to roll back.\n\nHow does it look in your team? Pilot first or full rollout?`;
  } else if (/Facebook/i.test(u)) {
    tekst = j === 'pl'
      ? `Zastanawialiście się kiedyś, od czego zacząć z tematem „${temat}”? 🤔\n\nOdpowiedź jest prostsza, niż się wydaje: od jednego małego kroku. 📦 Pierwsze efekty widać zwykle już po 2 do 4 tygodniach.\n\nNajczęstszy błąd to chcieć wszystkiego naraz. Lepiej sprawdzić jedną rzecz i dopiero potem iść dalej. ✅\n\nA Wy? Zaczynacie od małych kroków czy od razu na głęboką wodę? Dajcie znać w komentarzu! 😊`
      : `Ever wondered where to start with "${temat}"? 🤔\n\nThe answer is simpler than it seems: one small step. 📦 First effects usually show within 2 to 4 weeks.\n\nThe most common mistake is wanting everything at once. Test one thing first, then move on. ✅\n\nWhat about you? Small steps or straight into deep water? Tell us in the comments! 😊`;
  } else if (/email|newsletter/i.test(u)) {
    tekst = j === 'pl'
      ? `Temat: ${krotko(wielka(temat) + ': od czego zacząć', 60)}\n\nSzanowni Państwo,\n\nprzygotowaliśmy krótkie podsumowanie tematu „${temat}”. Wiele firm pyta nas, jak zacząć i ile czasu potrzeba na pierwsze efekty. Poniżej zebraliśmy najważniejsze informacje.\n\nZ naszych danych wynika, że 7 na 10 zespołów zaczyna od prostego wariantu, a pierwsze efekty pojawiają się po 2 do 4 tygodniach. Wariant podstawowy kosztuje od 490 zł miesięcznie.\n\nDla Państwa firmy oznacza to możliwość sprawdzenia rozwiązania małym kosztem. Pilotaż w jednym obszarze ogranicza ryzyko i ułatwia pomiar wyników.\n\nChętnie pomożemy przygotować plan pilotażu i dobrać wariant do skali działania.\n\nSkontaktuj się z nami, aby umówić krótką rozmowę.\n\nZ poważaniem,\nZespół ${marka}`
      : `Subject: ${krotko(wielka(temat) + ': where to start', 60)}\n\nDear Sir or Madam,\n\nwe have prepared a short summary of "${temat}". Many companies ask us how to start and how long it takes to see results. Below are the key points.\n\nOur data shows that 7 in 10 teams start with a simple variant and see first effects within 2 to 4 weeks. The basic variant costs from 120 EUR per month.\n\nFor your company this means a low cost way to test the solution. A pilot in one area limits risk and makes measurement easier.\n\nWe will gladly help you plan the pilot and choose the right variant.\n\nContact us to book a short call.\n\nKind regards,\nThe ${marka} team`;
  } else if (/FAQ/i.test(u)) {
    const t = teksty(j);
    const dodatkowe = j === 'pl'
      ? [['Dla kogo jest to rozwiązanie?', 'Dla małych firm, sklepów internetowych i zespołów marketingu. Najwięcej zyskują ci, którzy powtarzają ten sam proces kilka razy w miesiącu.'], ['Jak mierzyć efekty?', 'Najprościej porównać trzy mierniki przed startem i po 30 dniach. Raport warto przygotować przed uruchomieniem.'], ['Co jest najczęstszym błędem?', 'Zbyt szeroki zakres na starcie. Lepszy jest jeden dobrze zmierzony pilotaż.'], ['Czy można zrezygnować?', 'Tak, zmiany wprowadzane małymi krokami łatwo wycofać. Warunki opisuje umowa.']]
      : [['Who is it for?', 'Small businesses, online stores and marketing teams. Those who repeat the process several times a month gain most.'], ['How to measure results?', 'Compare three metrics before launch and after 30 days. Prepare the report before you start.'], ['What is the most common mistake?', 'A scope that is too broad at the start. One well measured pilot is better.'], ['Can I cancel?', 'Yes, changes made in small steps are easy to roll back. The contract describes the terms.']];
    tekst = t.faq.concat(dodatkowe).map(([q, a]) => 'Q: ' + q + '\nA: ' + a).join('\n\n');
  } else {
    tekst = j === 'pl'
      ? `${krotko(wielka(temat), 50)} bez zbędnych komplikacji\n\nPomagamy firmom uporządkować ten proces tak, żeby pierwsze efekty były widoczne po 2 do 4 tygodniach. Rozwiązanie dla małych i średnich zespołów.\n\nKluczowe korzyści:\n- Start od 490 zł miesięcznie\n- Pierwsze efekty po 2 do 4 tygodniach\n- Pilotaż w jednym obszarze bez ryzyka\n- Raporty z wynikami co 30 dni\n\nSkontaktuj się z nami i zacznij już dziś.`
      : `${krotko(wielka(temat), 50)} without the hassle\n\nWe help companies organise this process so first effects show within 2 to 4 weeks. Built for small and mid-sized teams.\n\nKey benefits:\n- Start from 120 EUR per month\n- First effects within 2 to 4 weeks\n- A risk free pilot in one area\n- Results reports every 30 days\n\nContact us and start today.`;
  }
  return blokMyslenia(cialo, 'Repurpose.').concat([{ type: 'text', text: tekst }]);
}

function slowaTematu(s) {
  return String(s || '').toLowerCase().split(/[^a-ząćęłńóśźż0-9]+/i).filter((w) => w.length >= 4);
}

function odpLuki(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const lista = ((ctx.usr.match(/SERP topics \(full list\): ([^\n]*)/) || [])[1] || '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  const artykul = (ctx.usr.split(/Article:\n/)[1] || '').toLowerCase();
  const present = [];
  const missing = [];
  for (const tem of lista.slice(0, 16)) {
    const slowa = slowaTematu(tem);
    const jest = slowa.length > 0 && slowa.every((w) => artykul.includes(w.slice(0, 5)));
    (jest ? present : missing).push(tem);
  }
  if (!missing.length && present.length > 1) missing.push(present.pop());
  if (!present.length && missing.length > 1) present.push(missing.shift());
  const dane = { score: 0, missing: missing.slice(0, 8), present: present.slice(0, 8), msg: j === 'pl' ? 'Artykuł pokrywa część tematów z czołówki; brakuje kilku wątków, które konkurencja omawia.' : 'The article covers part of the top topics; a few angles covered by competitors are missing.' };
  dane.score = Math.round(dane.present.length / Math.max(1, dane.present.length + dane.missing.length) * 100);
  return [{ type: 'text', text: tekstJson(dane, zn) }];
}

function odpLukiSekcje(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const czesc = ctx.usr.split(/\) for:\n/)[1] || '';
  const tematy = [];
  for (const linia of czesc.split('\n')) {
    const m = linia.match(/^\s*\d+\.\s+(.+)$/);
    if (m) tematy.push(m[1].trim()); else if (tematy.length && !linia.trim()) break;
  }
  const brakTekst = (ctx.sys.match(/<p data-brak="1">([^<]*)<\/p>/) || [])[1] || (j === 'pl' ? 'Brak pokrycia w źródłach.' : 'Not covered by the sources.');
  const t = teksty(j);
  const los = generator('luki|' + tematy.join('|'));
  const pula = t.akapity;
  const zd = () => wstaw(pula[Math.floor(los() * pula.length)], j === 'pl' ? 'rozwiązanie' : 'the solution');
  let html = '';
  tematy.forEach((tem, i) => {
    if (tematy.length >= 3 && i === tematy.length - 1) {
      html += '<h2>' + esc(wielka(tem)) + '</h2><p data-brak="1">' + esc(brakTekst) + '</p>\n';
      return;
    }
    html += '<h2>' + esc(wielka(tem)) + '</h2>\n<p>' + esc((j === 'pl' ? 'W kontekście tematu „' + tem + '” źródła wskazują kilka konkretów. ' : 'For "' + tem + '" the sources give a few specifics. ') + zd() + ' ' + zd()) + '</p>\n<p>' + esc(zd() + ' ' + zd()) + '</p>\n';
  });
  const nazwa = (ctx.usr.match(/write an updated <h2>([^<]+)<\/h2>/) || [])[1];
  if (nazwa) {
    const nowe = tematy.slice(0, Math.max(1, tematy.length - (tematy.length >= 3 ? 1 : 0))).map((tem) => (j === 'pl' ? 'Nowa sekcja: ' : 'New section: ') + tem + (j === 'pl' ? ' opiera się na danych ze źródeł.' : ' is based on source data.'));
    html += '<h2>' + esc(nazwa) + '</h2>\n<ul>\n' + t.wnioski.concat(nowe).map((s) => '<li>' + esc(s) + '</li>').join('\n') + '\n</ul>';
  }
  return blokMyslenia(cialo, 'Write only new sections.').concat([{ type: 'text', text: html }]);
}

const KONKURENCI_DOMYSLNI = ['Konkurent Alfa', 'Konkurent Beta', 'Konkurent Gamma'];

function odpWidocznosc(cialo, ctx, zn) {
  const marka = (ctx.sys.match(/does the brand "([^"]*)" appear/) || [])[1] || 'Marka';
  const znani = ((ctx.sys.match(/Known competitor set to watch for: ([^\n]*?)\.?\s*$/) || [])[1] || '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  const q = krotko(ctx.usr, 120);
  const h = hash32(q + '|' + marka);
  const los = generator('vis|' + q);
  const s = blokiWyszukiwania([q], los, zn);
  const obecna = h % 3 !== 0;
  const konkurenci = (znani.length ? znani : KONKURENCI_DOMYSLNI).slice(0, 3);
  const dane = {
    present: obecna,
    position: obecna ? 1 + (h % 3) : null,
    competitors: obecna ? konkurenci.slice(0, 2) : konkurenci,
    sources: s.wyniki.slice(0, 4).map((w) => { try { return new URL(w.url).hostname; } catch { return w.url; } }),
    note: obecna ? 'Marka wymieniona wśród polecanych opcji.' : 'Marka nie pojawia się w odpowiedzi.',
  };
  const json = tekstJson(dane, zn);
  let tekstowe;
  if ((KONF.cytatWJson || zn['cytat-w-json']) && s.wyniki.length) {
    // Prawdziwe API potrafi dzielic tekst przypisami takze wewnatrz JSON-a.
    const i = json.indexOf('"note":"') + 8;
    const w = s.wyniki[0];
    tekstowe = [
      { type: 'text', text: json.slice(0, i) },
      { type: 'text', text: json.slice(i, json.length - 2), citations: [{ type: 'web_search_result_location', url: w.url, title: w.title, encrypted_index: zaszyfrowane(48), cited_text: w._cytat }] },
      { type: 'text', text: json.slice(json.length - 2) },
    ];
  } else tekstowe = [{ type: 'text', text: json }];
  return { content: s.bloki.concat(tekstowe), szukan: s.szukan };
}

function odpNarracja(cialo, ctx, zn) {
  const marka = (ctx.sys.match(/asks about the brand "([^"]*)"/) || [])[1] || 'Marka';
  const los = generator('narr|' + marka);
  const s = blokiWyszukiwania([marka, marka + ' opinie'], los, zn);
  const zdania = [
    marka + ' to firma, która pomaga klientom uporządkować procesy i szybciej osiągać mierzalne wyniki.',
    'W opisach w sieci najczęściej pojawiają się krótki czas wdrożenia i przejrzysty cennik.',
    'Główne mocne strony to wsparcie w języku polskim, raporty z wynikami co 30 dni i możliwość startu od pilotażu w jednym obszarze.',
    'Oferta jest kierowana do małych i średnich firm, sklepów internetowych oraz zespołów marketingu.',
    'Pod względem cen marka plasuje się w środku rynku: wariant podstawowy zaczyna się od kilkuset złotych miesięcznie.',
    'Klienci zwracają uwagę na przewidywalność współpracy i szybkie odpowiedzi na zgłoszenia.',
    'Recenzenci podkreślają też prosty start: pierwsze efekty mają być widoczne po dwóch do czterech tygodniach od uruchomienia współpracy.',
    'Wśród słabszych stron wymieniana jest mniejsza liczba integracji niż u największych konkurentów.',
    'Dla firm, które chcą zacząć małym kosztem i stopniowo rozbudowywać współpracę, ' + marka + ' jest rozsądnym wyborem.',
  ];
  return { content: s.bloki.concat(s.wyniki.length ? tekstZCytatami(zdania, s.wyniki) : [{ type: 'text', text: zdania.join(' ') }]), szukan: s.szukan };
}

function odpNarracjaOcena(cialo, ctx, zn) {
  const bezBazy = /\(no documents\)/.test(ctx.usr);
  const dane = {
    alignment: bezBazy ? 55 : 72,
    factual_issues: ['Opis podaje cenę „od kilkuset złotych”, a dokumenty nie zawierają cennika.', 'Mowa o „mniejszej liczbie integracji”, czego dokumenty nie potwierdzają.'],
    missing_strengths: ['Wsparcie wdrożeniowe opisane w dokumentach firmy.', 'Konkretne terminy realizacji podane w ofercie.'],
    note: bezBazy ? 'Brak dokumentów, ocena orientacyjna.' : 'Opis w większości zgodny z ofertą.',
  };
  return [{ type: 'text', text: tekstJson(dane, zn) }];
}

function odpWidocznoscAi(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const q = krotko(ctx.usr, 140);
  const los = generator('aiv|' + q);
  const s = blokiWyszukiwania([q], los, zn);
  const zdania = j === 'pl' ? [
    'Odpowiadając na pytanie „' + q + '”: najczęściej polecane są rozwiązania z przejrzystym cennikiem i krótkim czasem wdrożenia.',
    'Źródła wskazują, że warto porównać co najmniej trzy oferty pod kątem czasu reakcji i zakresu wsparcia.',
    'Dla małych firm dobrym punktem wyjścia jest pilotaż w jednym obszarze, a wyniki warto sprawdzić po 30 dniach.',
    'Przy wyborze pomocne są niezależne opinie klientów i aktualne zestawienia branżowe.',
  ] : [
    'Answering "' + q + '": the most recommended options have transparent pricing and a short rollout.',
    'Sources suggest comparing at least three offers on response time and scope of support.',
    'For small businesses a pilot in one area is a good start, with results checked after 30 days.',
    'Independent customer reviews and current industry rankings help with the choice.',
  ];
  return { content: s.bloki.concat(s.wyniki.length ? tekstZCytatami(zdania, s.wyniki) : [{ type: 'text', text: zdania.join(' ') }]), szukan: s.szukan };
}

function odpPromptGrafiki(cialo, ctx, zn) {
  const kontekstArt = (ctx.usr.split(/summarize visually\):\s*\n/)[1] || ctx.usr).split('\n').map((s) => s.trim()).filter(Boolean)[0] || 'a business topic';
  const format = (ctx.usr.match(/Format: ([^(\n]+)/) || [])[1] || 'horizontal landscape';
  const tekst = 'A ' + format.trim() + ' corporate marketing visual illustrating the idea of "' + krotko(kontekstArt, 80) + '". '
    + 'In the foreground, a modern workspace with a laptop showing simple abstract charts, a neatly packed parcel and a notebook with a hand drawn checklist. '
    + 'Soft natural daylight from the left, shallow depth of field, clean composition with generous negative space on the right. '
    + 'Warm amber accents on key objects, cool teal highlights in the background, premium editorial photography style, sharp focus, realistic materials. '
    + 'No text, no logos, no typography.';
  return [{ type: 'text', text: tekst }];
}

// Skrypty mowione (liczby slownie - wymog TTS w promptach aplikacji)
function etykietyZPromptu(sys, j) {
  if (/a SINGLE host monologue/.test(sys)) return [];
  const m = sys.match(/a DIALOGUE between (\d+) people: (.+?)\. Prefix/);
  if (m) return m[2].split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  return j === 'pl' ? ['PROWADZĄCY', 'GOŚĆ 1'] : ['HOST', 'GUEST 1'];
}

function plcieZPromptu(sys) {
  const m = sys.match(/CASTING \(follow strictly\): (.+?)\. Give/);
  const mapa = {};
  if (m) for (const para of m[1].split(/,\s*/)) { const [l, g] = para.split('='); if (l) mapa[l.trim()] = (g || '').trim(); }
  return mapa;
}

function skryptPodcastu(j, temat, etykiety, plcie) {
  const T0 = krotko(temat || (j === 'pl' ? 'nasz temat' : 'our topic'), 70);
  const imie = (lab, i) => { const g = plcie[lab] || (i === 1 ? 'female' : 'male'); return g === 'female' ? (i === 2 ? 'Ewa' : 'Anna') : (g === 'male' ? (i === 0 ? 'Piotr' : 'Tomasz') : 'Alex'); };
  const k = (lab) => (plcie[lab] || '') === 'female';
  if (!etykiety.length) {
    const p = j === 'pl' ? [
      'Dzień dobry, witam w kolejnym odcinku. Dziś opowiem o temacie: ' + T0 + '.',
      'Zacznijmy od najważniejszego. Pierwsze efekty widać zwykle po dwóch do czterech tygodniach, a siedem na dziesięć zespołów zaczyna od najprostszego wariantu.',
      'Wariant podstawowy kosztuje od czterystu dziewięćdziesięciu złotych miesięcznie. Rozszerzony zaczyna się od tysiąca czterystu dziewięćdziesięciu złotych.',
      'Najczęstszy błąd to zbyt szeroki zakres na starcie. Lepiej zrobić jeden dobrze zmierzony pilotaż i sprawdzić wyniki po trzydziestu dniach.',
      'To wszystko na dziś. Dziękuję za uwagę i do usłyszenia.',
    ] : [
      'Hello and welcome to another episode. Today I will talk about: ' + T0 + '.',
      'Let us start with the essentials. First effects usually show within two to four weeks, and seven in ten teams start with the simplest variant.',
      'The basic variant costs from one hundred twenty euros a month. The extended one starts at three hundred fifty euros.',
      'The most common mistake is a scope that is too broad at the start. Run one well measured pilot and check the results after thirty days.',
      'That is all for today. Thank you for listening.',
    ];
    return '<h1>' + esc(T0) + '</h1>\n' + p.map((s) => '<p>' + esc(s) + '</p>').join('\n');
  }
  const [H, G1, G2] = [etykiety[0], etykiety[1] || etykiety[0], etykiety[2]];
  const g1 = imie(G1, 1);
  const tury = j === 'pl' ? [
    [H, 'Dzień dobry, witam w kolejnym odcinku. Dziś rozmawiamy o temacie: ' + T0 + '. Ze mną w studiu jest ' + g1 + (k(G1) ? ', która' : ', który') + ' zajmuje się tym na co dzień. Od czego warto zacząć?'],
    [G1, 'Dzień dobry. ' + (k(G1) ? 'Zaczęłabym' : 'Zacząłbym') + ' od celu. Kiedy wiadomo, co chcemy osiągnąć, łatwiej wybrać wariant i policzyć koszty. Pierwsze efekty widać zwykle po dwóch do czterech tygodniach.'],
    [H, 'Dwa do czterech tygodni to szybko. Co najbardziej wpływa na ten czas?'],
    [G1, 'Przede wszystkim przygotowanie. Siedem na dziesięć zespołów zaczyna od prostego wariantu i rozbudowuje go dopiero po pierwszym miesiącu.'],
  ] : [
    [H, 'Hello and welcome to another episode. Today we talk about: ' + T0 + '. With me in the studio is ' + g1 + ', who works on this every day. Where should we start?'],
    [G1, 'Hello. I would start with the goal. Once you know what you want to achieve, it is easier to pick a variant and count the costs. First effects usually show within two to four weeks.'],
    [H, 'Two to four weeks is fast. What affects that time the most?'],
    [G1, 'Preparation, above all. Seven in ten teams start with a simple variant and extend it only after the first month.'],
  ];
  if (G2) {
    tury.push(j === 'pl'
      ? [G2, 'Dodam, że warto od razu ustalić, kto odpowiada za kolejne etapy. ' + ((plcie[G2] || '') === 'female' ? 'Zrobiłam' : 'Zrobiłem') + ' tak w swoim zespole i liczba poprawek wyraźnie spadła już w pierwszym miesiącu.']
      : [G2, 'Let me add that it pays to decide early who owns each stage. I did that in my team and the number of revisions dropped clearly in the first month.']);
  }
  tury.push(...(j === 'pl' ? [
    [H, 'A ile to kosztuje?'],
    [G1, 'Wariant podstawowy zaczyna się od czterystu dziewięćdziesięciu złotych miesięcznie, rozszerzony od tysiąca czterystu dziewięćdziesięciu. Różnica wynika głównie z zakresu wsparcia.'],
    [H, 'Dziękuję za rozmowę. Podsumowując: cel, pilotaż i przegląd wyników co trzydzieści dni. Do usłyszenia w kolejnym odcinku.'],
  ] : [
    [H, 'And how much does it cost?'],
    [G1, 'The basic variant starts at one hundred twenty euros a month, the extended one at three hundred fifty. The difference comes mainly from the scope of support.'],
    [H, 'Thank you for the conversation. To sum up: a goal, a pilot and a review every thirty days. See you in the next episode.'],
  ]));
  return '<h1>' + esc(T0) + '</h1>\n' + tury.map(([l, s]) => '<p><strong>' + esc(l) + ':</strong> ' + esc(s) + '</p>').join('\n');
}

function skryptNewslettera(j, temat) {
  const T0 = krotko(temat || (j === 'pl' ? 'nasz temat' : 'our topic'), 70);
  const p = j === 'pl' ? [
    'Dzień dobry, tu cotygodniowy przegląd najważniejszych informacji.',
    'Dziś w centrum uwagi: ' + T0 + '. Pierwsze efekty pojawiają się zwykle po dwóch do czterech tygodniach od startu.',
    'Siedem na dziesięć zespołów zaczyna od najprostszego wariantu i rozbudowuje go dopiero po miesiącu. To dobry sposób, żeby ograniczyć ryzyko.',
    'Wariant podstawowy kosztuje od czterystu dziewięćdziesięciu złotych miesięcznie, a wyniki warto sprawdzać co trzydzieści dni.',
    'Jeśli chcesz zacząć, wybierz jeden obszar na pilotaż i zapisz trzy mierniki sukcesu. Do usłyszenia za tydzień.',
  ] : [
    'Hello, this is your weekly round-up of the key news.',
    'Today in focus: ' + T0 + '. First effects usually appear within two to four weeks of the start.',
    'Seven in ten teams start with the simplest variant and extend it after a month. It is a good way to limit the risk.',
    'The basic variant costs from one hundred twenty euros a month, and results are worth checking every thirty days.',
    'If you want to start, pick one area for a pilot and write down three success metrics. Talk to you next week.',
  ];
  return '<h1>' + esc(T0) + '</h1>\n' + p.map((s) => '<p>' + esc(s) + '</p>').join('\n');
}

function skryptAudiobooka(j, zrodlo) {
  const zdania = String(zrodlo || '').replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((s) => s.length > 3).slice(0, 18);
  const tytul = krotko(zdania[0] || (j === 'pl' ? 'Opowieść' : 'Story'), 60).replace(/[.!?]$/, '');
  if (zdania.length < 6) zdania.push(...teksty(j).akapity.slice(0, 6).map((s) => wstaw(s, j === 'pl' ? 'ta historia' : 'this story')));
  let html = '<h1>' + esc(tytul) + '</h1>\n';
  for (let i = 0; i < zdania.length; i += 3) html += '<p>' + esc(zdania.slice(i, i + 3).join(' ')) + '</p>\n';
  return html.trim();
}

function odpAudioSkrypt(cialo, ctx, zn) {
  const j = ctx.jezyk === 'pl' ? 'pl' : 'en';
  const zrodlo = (ctx.usr.split(/Topic or source material:\s*\n\n|Convert the following into audiobook narration:\s*\n\n/)[1] || ctx.usr).trim();
  const temat = krotko(zrodlo.split('\n')[0], 70);
  let html;
  if (/podcast scriptwriter/.test(ctx.sys)) html = skryptPodcastu(j, temat, etykietyZPromptu(ctx.sys, j), plcieZPromptu(ctx.sys));
  else if (/audio newsletter writer/.test(ctx.sys)) html = skryptNewslettera(j, temat);
  else html = skryptAudiobooka(j, zrodlo);
  return blokMyslenia(cialo, 'Spoken script.').concat([{ type: 'text', text: html }]);
}

function informacjaPrasowa(j, a, linkSieci) {
  const k = a.frazy[0] || a.temat || (j === 'pl' ? 'nowa usługa' : 'new service');
  const data = a.dataPrasowa || (j === 'pl' ? 'Warszawa, ' + new Date().toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Warsaw, ' + new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }));
  const K = wielka(k);
  const adres = a.linki[0] || linkSieci || '';
  const link = adres ? (j === 'pl' ? ' Szczegóły oferty: <a href="' + esc(adres) + '" target="_blank" rel="noopener">strona firmy</a>.' : ' Offer details: <a href="' + esc(adres) + '" target="_blank" rel="noopener">company website</a>.') : '';
  const h = j === 'pl' ? [
    '<p><strong>' + esc(data) + '</strong></p>',
    '<h1>' + esc(krotko(K + ': nowa oferta skraca czas realizacji do 2 dni', 90)) + '</h1>',
    '<h2>' + esc('Wariant podstawowy dostępny od 490 zł miesięcznie') + '</h2>',
    '<p>' + esc('Od dziś firmy mogą skorzystać z nowej oferty w obszarze: ' + k + '. Rozwiązanie skraca czas realizacji z 5 do 2 dni roboczych i jest dostępne w dwóch wariantach.') + '</p>',
    '<p>' + esc('Z danych firmy wynika, że 7 na 10 klientów zaczyna od wariantu podstawowego, a pierwsze efekty widzi po 2 do 4 tygodniach. Wariant rozszerzony obejmuje wsparcie telefoniczne i raporty tygodniowe.') + link + '</p>',
    '<p>' + esc('„Chcieliśmy, żeby start był prosty i przewidywalny. Klient zaczyna od pilotażu w jednym obszarze i po miesiącu decyduje, co dalej”, powiedział przedstawiciel firmy.') + '</p>',
    '<h2>O firmie</h2>',
    '<p>' + esc('Firma pomaga przedsiębiorstwom porządkować procesy i mierzyć ich efekty. Obsługuje małe i średnie firmy oraz sklepy internetowe.') + '</p>',
    '<p><strong>Kontakt dla mediów:</strong> ' + esc('[imię i nazwisko], [adres e-mail], [telefon]') + '</p>',
  ] : [
    '<p><strong>' + esc(data) + '</strong></p>',
    '<h1>' + esc(krotko(K + ': new offer cuts lead time to 2 days', 90)) + '</h1>',
    '<h2>' + esc('Basic variant available from 120 EUR per month') + '</h2>',
    '<p>' + esc('Starting today, companies can use a new offer for: ' + k + '. It cuts lead time from 5 to 2 business days and comes in two variants.') + '</p>',
    '<p>' + esc('Company data shows that 7 in 10 customers start with the basic variant and see first effects within 2 to 4 weeks. The extended variant adds phone support and weekly reports.') + link + '</p>',
    '<p>' + esc('"We wanted the start to be simple and predictable. Customers begin with a pilot in one area and decide on the next step after a month," said a company representative.') + '</p>',
    '<h2>About the company</h2>',
    '<p>' + esc('The company helps businesses organise their processes and measure the results. It serves small and mid-sized companies and online stores.') + '</p>',
    '<p><strong>Media contact:</strong> ' + esc('[name], [e-mail address], [phone]') + '</p>',
  ];
  return h.join('\n') + '\n<div class="meta-box"><div class="meta-label">Meta description (SEO)</div><p>' + esc(metaOpis(j, k)) + '</p></div>';
}

// ─── Rozpoznanie rodzaju wywolania ──────────────────────────────────────────

/** Reguly: [rodzaj, test(ctx)] - pierwsza pasujaca wygrywa. */
const REGULY = [
  ['web-fetch', (c) => c.narzedzia.some((n) => /web_fetch/.test(n))],
  ['serp', (c) => /Search for top Google results/.test(c.sys)],
  ['widocznosc', (c) => /You simulate an AI assistant answering a user shopping or recommendation query/.test(c.sys)],
  ['narracja', (c) => /A user asks about the brand/.test(c.sys)],
  ['narracja-ocena', (c) => /You evaluate how an AI assistant described a brand/.test(c.sys)],
  ['widocznosc-ai', (c) => /You are a helpful AI assistant answering a user question using web search/.test(c.sys)],
  ['fakty', (c) => /You are a fact checker/.test(c.sys)],
  ['luki', (c) => /You are a semantic SEO expert\. Compare an article to SERP topics/.test(c.sys)],
  ['luki-sekcje', (c) => /Write ONLY the new HTML sections requested/.test(c.sys)],
  ['tytuly', (c) => /You are an SEO title specialist/.test(c.sys)],
  ['tematy', (c) => /propose EXACTLY 10 article topics/.test(c.sys)],
  ['brief', (c) => /Analyze the topic and knowledge base and respond ONLY with valid JSON/.test(c.sys)],
  ['brand-voice', (c) => /You are a brand strategist\. Analyze writing samples/.test(c.sys)],
  ['przerobka', (c) => /content repurposing specialist/.test(c.sys)],
  ['prompt-grafiki', (c) => /You are an expert art director/.test(c.sys)],
  ['audio-skrypt', (c) => /You are a professional podcast scriptwriter|You are an audio newsletter writer|You are an audiobook narrator-editor/.test(c.sys)],
  ['ocena-premium', (c) => /strict hybrid SEO\+AIO content evaluator|^AIO evaluator\.|^SEO content evaluator\./.test(c.sys)],
  ['ocena-seo', (c) => /content SEO expert evaluating/.test(c.sys) && /"items"/.test(c.sys)],
  ['ocena-seo-generowanie', (c) => /content SEO expert evaluating/.test(c.sys) && /"issues"/.test(c.sys)],
  ['ocena-aio', (c) => /You are an AIO \(AI Overview Optimization\) expert/.test(c.sys)],
  ['ocena-aio-generowanie', (c) => /^AIO expert evaluating/.test(c.sys)],
  ['poprawa', (c) => /You are an? (hybrid SEO\+AIO|SEO|AIO) editor/.test(c.sys)],
  ['artykul', (c) => /You are an expert content strategist|You are an SEO and content writer/.test(c.sys)],
];

const RODZAJE_OPIS = {
  'artykul': 'generowanie artykulu (generate), z web_search: server_tool_use + web_search_tool_result + citations',
  'serp': 'kontekst SERP (fetchSerpContext) - JSON context/topics/phrases/avgWords/avgH2 + bloki wyszukiwania',
  'ocena-seo': 'panel Ocen SEO - JSON score/items',
  'ocena-seo-generowanie': 'ocena SEO w trakcie generowania - JSON score/issues',
  'ocena-aio': 'panel Ocen AIO - JSON score/items',
  'ocena-aio-generowanie': 'ocena AIO w trakcie generowania - JSON score/issues',
  'ocena-premium': 'ocena trybu Premium - JSON score/issues',
  'poprawa': 'poprawa artykulu przez edytora SEO/AIO - HTML',
  'fakty': 'kontrola faktow - JSON uwagi[]',
  'web-fetch': 'pobranie strony do bazy wiedzy (web_fetch_tool_result)',
  'tytuly': 'warianty tytulow H1 - JSON tablica 5 napisow',
  'luki': 'analiza luk semantycznych - JSON score/missing/present/msg',
  'luki-sekcje': 'uzupelnienie luk - nowe sekcje HTML (+ data-brak) i zaktualizowane wnioski',
  'tematy': 'generator tematow - JSON tematy[10]{temat,dlaczego}',
  'brief': 'brief - JSON keywords/h2/gap/words',
  'brand-voice': 'analiza Brand Voice - JSON summary/style',
  'przerobka': 'przerobki: LinkedIn, Facebook, e-mail, FAQ (Q:/A:), landing',
  'widocznosc': 'widocznosc marki w AI (visQuery) - web_search + JSON present/position/competitors/sources/note',
  'narracja': 'narracja o marce, krok 1 - web_search + tekst z przypisami',
  'narracja-ocena': 'narracja o marce, krok 2 - JSON alignment/factual_issues/missing_strengths/note',
  'widocznosc-ai': 'monitor widocznosci AI (aivQueryAI) - web_search + tekst z przypisami',
  'prompt-grafiki': 'prompt do grafiki (art director) - tekst po angielsku',
  'audio-skrypt': 'skrypt audio: podcast (etykiety mowcow), newsletter, audiobook - HTML',
  'json-ogolny': 'nieznane wywolanie z prosba o JSON - obiekt wg szablonu z promptu',
  'nieznany': 'nieznane wywolanie - zwykly tekst',
};

function kontekst(cialo) {
  const sys = tekstBlokow(cialo.system);
  const wiad = Array.isArray(cialo.messages) ? cialo.messages : [];
  const usr = wiad.filter((m) => m.role === 'user').map((m) => tekstBlokow(m.content)).join('\n\n');
  const ostatnia = wiad[wiad.length - 1];
  const kontynuacja = !!(ostatnia && ostatnia.role === 'assistant');
  const narzedzia = (Array.isArray(cialo.tools) ? cialo.tools : []).map((t) => String((t && (t.type || t.name)) || ''));
  const jezyk = wykryjJezyk(sys, usr);
  return { sys, usr, wiad, kontynuacja, narzedzia, jezyk };
}

function rozpoznaj(cialo) {
  const ctx = kontekst(cialo);
  for (const [rodzaj, test] of REGULY) {
    try { if (test(ctx)) return { rodzaj, ctx }; } catch { /* zla regula nie moze wywrocic atrapy */ }
  }
  if (/valid JSON|ONLY JSON|JSON only|Return JSON|return ONLY a valid JSON|Respond ONLY with JSON/i.test(ctx.sys + '\n' + ctx.usr)) return { rodzaj: 'json-ogolny', ctx };
  return { rodzaj: 'nieznany', ctx };
}

// Ogolny wypelniacz: bierze pierwszy szablon JSON z promptu i oddaje obiekt o tych kluczach.
function wypelnijSzablon(szablon, j) {
  const t = String(szablon);
  const start = t.search(/[{[]/);
  if (start < 0) return null;
  // znajdz domkniecie
  let gl = 0, koniec = -1, wStr = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"' && t[i - 1] !== '\\') wStr = !wStr;
    if (wStr) continue;
    if (ch === '{' || ch === '[') gl++;
    if (ch === '}' || ch === ']') { gl--; if (gl === 0) { koniec = i; break; } }
  }
  if (koniec < 0) return null;
  const fragment = t.slice(start, koniec + 1);
  try { return JSON.parse(fragment); } catch { /* szablon nie jest poprawnym JSON - przerob */ }
  let s = fragment
    .replace(/"([^"]*)"/g, (m) => m.replace(/:/g, '\u0001'))
    .replace(/:\s*0-100/g, ': 72')
    .replace(/:\s*true\/false/g, ': true')
    .replace(/:\s*(?:estimated[a-z_]*|integer|number|int)\b/gi, ': 5')
    .replace(/,\s*\.\.\.[^\]}]*/g, '')
    .replace(/\.\.\./g, '');
  s = s.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_ |-]*)(\s*[,}\]])/g, (m, w, k) => (/^(true|false|null)$/.test(w.trim()) ? ': ' + w.trim() : ': "' + w.trim() + '"') + k);
  s = s.replace(/\u0001/g, ':');
  try { return JSON.parse(s); } catch { return null; }
}

function odpOgolnyJson(cialo, ctx, zn) {
  const obiekt = wypelnijSzablon(ctx.sys, ctx.jezyk) || wypelnijSzablon(ctx.usr, ctx.jezyk) || { wynik: ctx.jezyk === 'pl' ? 'odpowiedź atrapy' : 'mock answer' };
  return [{ type: 'text', text: tekstJson(obiekt, zn) }];
}

/**
 * Glowna funkcja: cialo zapytania Anthropic Messages -> obiekt odpowiedzi.
 * Bledy wstrzykniete znacznikiem/zmienna: { status, json } w polu _http.
 */
function odpowiedzAnthropic(cialo) {
  if (typeof cialo === 'string') { try { cialo = JSON.parse(cialo); } catch { cialo = {}; } }
  cialo = cialo || {};
  const { rodzaj, ctx } = rozpoznaj(cialo);
  const surowe = JSON.stringify(cialo);
  const zn = znaczniki(surowe, rodzaj);
  let content = [];
  let opcje = {};
  switch (rodzaj) {
    case 'artykul': { const r = odpArtykul(cialo, ctx, zn); content = r.content; opcje = { szukan: r.szukan, stop: r.stop }; break; }
    case 'serp': { const r = odpSerp(cialo, ctx, zn); content = r.content; opcje = { szukan: r.szukan }; break; }
    case 'web-fetch': { const r = odpWebFetch(cialo, ctx, zn); content = r.content; opcje = { pobran: r.pobran }; break; }
    case 'fakty': content = blokMyslenia(cialo, 'Compare figures with the sources.').concat(odpFakty(cialo, ctx, zn)); break;
    case 'ocena-premium':
    case 'ocena-seo-generowanie':
    case 'ocena-aio-generowanie': content = odpOcenaIssues(cialo, ctx, zn); break;
    case 'ocena-seo':
    case 'ocena-aio': content = odpOcenaItems(cialo, ctx, zn, rodzaj); break;
    case 'poprawa': content = odpPoprawa(cialo, ctx, zn); break;
    case 'tytuly': content = odpTytuly(cialo, ctx, zn); break;
    case 'tematy': content = odpTematy(cialo, ctx, zn); break;
    case 'brief': content = odpBrief(cialo, ctx, zn); break;
    case 'brand-voice': content = odpBrandVoice(cialo, ctx, zn); break;
    case 'przerobka': content = odpPrzerobka(cialo, ctx, zn); break;
    case 'luki': content = odpLuki(cialo, ctx, zn); break;
    case 'luki-sekcje': content = odpLukiSekcje(cialo, ctx, zn); break;
    case 'narracja-ocena': content = odpNarracjaOcena(cialo, ctx, zn); break;
    case 'prompt-grafiki': content = odpPromptGrafiki(cialo, ctx, zn); break;
    case 'audio-skrypt': content = odpAudioSkrypt(cialo, ctx, zn); break;
    case 'widocznosc': { const r = odpWidocznosc(cialo, ctx, zn); content = r.content; opcje = { szukan: r.szukan }; break; }
    case 'narracja': { const r = odpNarracja(cialo, ctx, zn); content = r.content; opcje = { szukan: r.szukan }; break; }
    case 'widocznosc-ai': { const r = odpWidocznoscAi(cialo, ctx, zn); content = r.content; opcje = { szukan: r.szukan }; break; }
    case 'json-ogolny': content = odpOgolnyJson(cialo, ctx, zn); break;
    default: content = [{ type: 'text', text: ctx.jezyk === 'pl' ? 'Odpowiedź atrapy (nieznany rodzaj wywołania).' : 'Mock answer (unknown call type).' }];
  }
  if (zn.pusty) content = content.filter((b) => b.type !== 'text');
  if (opcje.stop !== 'pause_turn') {
    const p = przytnijDoLimitu(cialo, content, !!zn['max-tokens']);
    content = p.content;
    if (p.stop) opcje.stop = p.stop;
  }
  const odp = wiadomosc(cialo, content, opcje);
  Object.defineProperty(odp, '_rodzaj', { value: rodzaj, enumerable: false });
  Object.defineProperty(odp, '_zn', { value: zn, enumerable: false });
  return odp;
}

/** Eksport dla page.route: tylko tresc odpowiedzi Anthropic (bez bledow). */
function odpowiedz(cialoZapytania) {
  return odpowiedzAnthropic(cialoZapytania);
}

// ─── Bledy w formacie dostawcow ─────────────────────────────────────────────

function bladAnthropic(kod) {
  const typ = { 400: 'invalid_request_error', 401: 'authentication_error', 429: 'rate_limit_error', 500: 'api_error', 503: 'api_error', 529: 'overloaded_error' }[kod] || 'api_error';
  const msg = { 400: 'Invalid request (atrapa)', 401: 'invalid x-api-key', 429: 'Number of request tokens has exceeded your per-minute rate limit (atrapa)', 500: 'Internal server error', 503: 'Service unavailable', 529: 'Overloaded' }[kod] || 'Error';
  return { status: kod, naglowki: kod === 429 ? { 'retry-after': '1' } : {}, json: { type: 'error', error: { type: typ, message: msg }, request_id: idLos('req_atrapa_') } };
}

function bladOpenAi(kod) {
  const typ = { 400: 'invalid_request_error', 401: 'invalid_request_error', 429: 'requests', 500: 'server_error', 503: 'server_error', 529: 'server_error' }[kod] || 'server_error';
  const msg = { 429: 'Rate limit reached for requests (atrapa)', 401: 'Incorrect API key provided (atrapa)' }[kod] || 'The server had an error while processing your request (atrapa)';
  return { status: kod, naglowki: {}, json: { error: { message: msg, type: typ, param: null, code: kod === 429 ? 'rate_limit_exceeded' : null } } };
}

function bladEleven(kod) {
  const st = { 401: 'invalid_api_key', 429: 'too_many_concurrent_requests', 400: 'invalid_request' }[kod] || 'internal_error';
  return { status: kod, naglowki: {}, json: { detail: { status: st, message: 'ElevenLabs error ' + kod + ' (atrapa)' } } };
}

// ─── Grafika PNG (bez zaleznosci) ───────────────────────────────────────────

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function kawalekPng(typ, dane) {
  const dl = Buffer.alloc(4); dl.writeUInt32BE(dane.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), dane]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([dl, td, crc]);
}

/** Gradient bursztyn -> cyjan z czteroramienna gwiazda; rozmiar wg zapytania. */
function obrazPng(szer, wys, ziarno) {
  szer = Math.max(16, Math.min(2048, szer | 0)); wys = Math.max(16, Math.min(2048, wys | 0));
  const los = generator(ziarno || 'obraz');
  const przes = los();
  const wiersz = szer * 3 + 1;
  const surowe = Buffer.alloc(wiersz * wys);
  const cx = szer / 2, cy = wys / 2, r = Math.min(szer, wys) * 0.28;
  for (let y = 0; y < wys; y++) {
    surowe[y * wiersz] = 0;
    for (let x = 0; x < szer; x++) {
      const t = (x / szer * 0.6 + y / wys * 0.4 + przes * 0.3) % 1;
      let R = Math.round(7 + 240 * (1 - t) * 0.9), G = Math.round(8 + 166 * (1 - t) * 0.9 + 224 * t * 0.5), B = Math.round(13 + 208 * t * 0.8);
      const dx = Math.abs(x - cx) / r, dy = Math.abs(y - cy) / r;
      if (Math.pow(dx, 0.5) + Math.pow(dy, 0.5) < 1) { R = 246; G = 166; B = 35; }
      const o = y * wiersz + 1 + x * 3;
      surowe[o] = R; surowe[o + 1] = G; surowe[o + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(szer, 0); ihdr.writeUInt32BE(wys, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    kawalekPng('IHDR', ihdr),
    kawalekPng('IDAT', zlib.deflateSync(surowe, { level: 6 })),
    kawalekPng('IEND', Buffer.alloc(0)),
  ]);
}

function odpObraz(cialo, zn) {
  const rozm = String(cialo.size || '1024x1024');
  let [s, w] = rozm.split('x').map(Number);
  if (!s || !w) { s = 1024; w = 1024; }
  const n = Math.max(1, Math.min(4, Number(cialo.n) || 1));
  const data = [];
  for (let i = 0; i < n; i++) {
    const png = obrazPng(s, w, String(cialo.prompt || '') + i);
    if (cialo.response_format === 'url') data.push({ url: 'data:image/png;base64,' + png.toString('base64'), revised_prompt: cialo.prompt || '' });
    else data.push({ b64_json: png.toString('base64'), revised_prompt: cialo.prompt || '' });
  }
  const odp = { created: Math.floor(Date.now() / 1000), data };
  if (/gpt-image/.test(String(cialo.model || ''))) {
    odp.usage = { input_tokens: tokeny(cialo.prompt), output_tokens: 1056, total_tokens: tokeny(cialo.prompt) + 1056 };
    odp.size = s + 'x' + w;
    odp.output_format = 'png';
  }
  return odp;
}

// ─── Audio MP3 (cisza, poprawne ramki MPEG-1 Layer III) ─────────────────────

function mp3Cisza(sekundy) {
  const ramek = Math.max(4, Math.min(20000, Math.round(sekundy * 44100 / 1152)));
  const ramka = Buffer.alloc(417);
  ramka[0] = 0xff; ramka[1] = 0xfb; ramka[2] = 0x90; ramka[3] = 0xc4; // 128 kb/s, 44,1 kHz, mono
  const bufory = new Array(ramek).fill(ramka);
  return Buffer.concat(bufory);
}

function sekundyMowy(tekst) {
  const slow = String(tekst || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(900, slow / 2.5));
}

// ─── Transkrypcja ───────────────────────────────────────────────────────────

function poleMultipart(bufor, typ, nazwa) {
  const m = String(typ || '').match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) return null;
  const granica = '--' + (m[1] || m[2]);
  const tekst = bufor.toString('latin1');
  for (const czesc of tekst.split(granica)) {
    const naglowki = czesc.split('\r\n\r\n')[0] || '';
    const mm = naglowki.match(/name="([^"]+)"(?:; filename="([^"]*)")?/);
    if (mm && mm[1] === nazwa) {
      const wart = czesc.slice(naglowki.length + 4).replace(/\r\n$/, '');
      return { wartosc: Buffer.from(wart, 'latin1').toString('utf8'), plik: mm[2] || '', rozmiar: wart.length };
    }
  }
  return null;
}

function odpTranskrypcja(bufor, typ) {
  const format = (poleMultipart(bufor, typ, 'response_format') || {}).wartosc || 'json';
  const jezykPole = (poleMultipart(bufor, typ, 'language') || {}).wartosc || '';
  const plik = poleMultipart(bufor, typ, 'file') || { plik: 'nagranie', rozmiar: 0 };
  const j = jezykPole && jezykPole !== 'pl' ? 'en' : 'pl';
  const zdania = j === 'pl'
    ? ['Dzień dobry, witam wszystkich na dzisiejszym spotkaniu.', 'Omówimy wyniki z ostatniego miesiąca i plan na kolejny kwartał.', 'Sprzedaż wzrosła o 12 procent, a czas realizacji zamówień skrócił się do 2 dni.', 'Następnym krokiem jest pilotaż w jednym regionie.', 'Dziękuję, przechodzimy do pytań.']
    : ['Good morning, welcome everyone to today\'s meeting.', 'We will go through last month\'s results and the plan for the next quarter.', 'Sales grew by 12 percent and order lead time dropped to 2 days.', 'The next step is a pilot in one region.', 'Thank you, let\'s move on to questions.'];
  const tekst = zdania.join(' ');
  const segmenty = zdania.map((z, i) => ({ id: i, seek: 0, start: i * 4, end: i * 4 + 3.8, text: ' ' + z, tokens: [], temperature: 0, avg_logprob: -0.2, compression_ratio: 1.3, no_speech_prob: 0.01 }));
  const czas = (s) => { const g = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sek = Math.floor(s % 60), ms = Math.round((s % 1) * 1000); return [g, m, sek].map((x) => String(x).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0'); };
  if (format === 'text') return { typ: 'text/plain; charset=utf-8', cialo: tekst };
  if (format === 'srt') return { typ: 'text/plain; charset=utf-8', cialo: segmenty.map((s, i) => (i + 1) + '\n' + czas(s.start) + ' --> ' + czas(s.end) + '\n' + s.text.trim() + '\n').join('\n') };
  if (format === 'vtt') return { typ: 'text/vtt; charset=utf-8', cialo: 'WEBVTT\n\n' + segmenty.map((s) => czas(s.start).replace(',', '.') + ' --> ' + czas(s.end).replace(',', '.') + '\n' + s.text.trim() + '\n').join('\n') };
  if (format === 'verbose_json') return { typ: 'application/json', cialo: JSON.stringify({ task: 'transcribe', language: j === 'pl' ? 'polish' : 'english', duration: segmenty.length * 4, text: tekst, segments: segmenty }) };
  return { typ: 'application/json', cialo: JSON.stringify({ text: tekst, usage: { type: 'duration', seconds: segmenty.length * 4 }, _plik: plik.plik }) };
}

// ─── OpenAI chat completions (NVIDIA NIM, Azure GPT) ────────────────────────

function odpChat(cialo) {
  const wiad = Array.isArray(cialo.messages) ? cialo.messages : [];
  const system = wiad.filter((m) => m.role === 'system').map((m) => tekstBlokow(m.content)).join('\n');
  const reszta = wiad.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : (m.content || []).map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'text', text: '' })) }));
  const anth = odpowiedzAnthropic({ model: cialo.model, system, messages: reszta, max_tokens: cialo.max_tokens || cialo.max_completion_tokens || 4096, thinking: { type: 'disabled' } });
  const tekst = anth.content.map((b) => b.text || '').join('');
  return {
    _rodzaj: anth._rodzaj,
    json: {
      id: idLos('chatcmpl-atrapa'), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: cialo.model || 'atrapa',
      choices: [{ index: 0, message: { role: 'assistant', content: tekst }, finish_reason: anth.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
      usage: { prompt_tokens: anth.usage.input_tokens, completion_tokens: anth.usage.output_tokens, total_tokens: anth.usage.input_tokens + anth.usage.output_tokens },
    },
  };
}

function odpEmbeddings(cialo) {
  const wej = Array.isArray(cialo.input) ? cialo.input : [cialo.input || ''];
  const wymiar = Number(cialo.dimensions) || 1024;
  return {
    object: 'list', model: cialo.model || 'atrapa-embed',
    data: wej.map((t, i) => {
      const los = generator(String(t));
      const v = Array.from({ length: wymiar }, () => los() * 2 - 1);
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return { object: 'embedding', index: i, embedding: v.map((x) => +(x / n).toFixed(6)) };
    }),
    usage: { prompt_tokens: tokeny(wej.join(' ')), total_tokens: tokeny(wej.join(' ')) },
  };
}

// ─── Router HTTP (wspolny dla serwera i page.route) ─────────────────────────

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': '*',
};

const ostatnie = [];

function zapiszWywolanie(wpis) {
  ostatnie.push(wpis);
  if (ostatnie.length > 200) ostatnie.shift();
  try { fs.mkdirSync(path.dirname(KONF.dziennik), { recursive: true }); fs.appendFileSync(KONF.dziennik, JSON.stringify(wpis) + '\n'); } catch { /* dziennik nie moze zatrzymac atrapy */ }
}

function listaRodzajow() {
  return Object.keys(RODZAJE_OPIS).concat(['openai-grafika', 'openai-tts', 'openai-transkrypcja', 'openai-chat', 'eleven-tts', 'embeddings']);
}

/**
 * Wspolna obsluga: (metoda, sciezka z query, naglowki, bufor ciala) -> { status, naglowki, cialo(Buffer|string), rodzaj }
 * Bez opoznienia - opoznienie dokłada warstwa wywolujaca.
 */
function obsluz(metoda, sciezkaPelna, naglowki, bufor) {
  const [sciezka] = String(sciezkaPelna || '/').split('?');
  const sc = sciezka.replace(/\/+$/, '') || '/';
  const typTresci = (naglowki && (naglowki['content-type'] || naglowki['Content-Type'])) || '';
  const json = (status, obiekt, rodzaj, dod = {}) => ({ status, naglowki: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, dod), cialo: JSON.stringify(obiekt), rodzaj });

  if (metoda === 'OPTIONS') return { status: 204, naglowki: {}, cialo: '', rodzaj: 'cors' };
  if (metoda === 'GET' && (sc === '/zdrowie' || sc === '/health')) {
    return json(200, { ok: true, atrapa: 'dostawcy-ai', wersja: WERSJA, port: KONF.port, rodzaje: listaRodzajow(), opisy: RODZAJE_OPIS, ustawienia: { opoznienie_ms: KONF.opoznienie, blad: KONF.blad || null, blad_rodzaj: KONF.bladRodzaj, blad_razy: KONF.bladRazy, wyszukiwanie: KONF.wyszukiwanie, pause_turn: KONF.pauseTurn, wstep: KONF.wstep, myslenie: KONF.myslenie, dziennik: KONF.dziennik } }, 'zdrowie');
  }
  if (metoda === 'GET' && sc === '/_atrapa/wywolania') {
    const n = Number((String(sciezkaPelna).match(/[?&]n=(\d+)/) || [])[1] || 50);
    return json(200, ostatnie.slice(-n), 'wywolania');
  }
  if (metoda !== 'POST') return json(404, { error: 'atrapa: nieznana sciezka ' + sc }, 'brak');

  let cialo = null;
  const tekst = bufor ? bufor.toString('utf8') : '';
  if (/json/.test(typTresci) || /^\s*[{[]/.test(tekst)) { try { cialo = JSON.parse(tekst || '{}'); } catch { cialo = null; } }

  // Anthropic
  if (/\/messages$/.test(sc)) {
    if (!cialo) return Object.assign(bladAnthropic(400), { rodzaj: 'zly-json' }, { cialo: JSON.stringify(bladAnthropic(400).json), naglowki: { 'content-type': 'application/json' } });
    const { rodzaj } = rozpoznaj(cialo);
    const zn = znaczniki(tekst, rodzaj);
    const kod = bladDlaWywolania(rodzaj, zn);
    if (kod) { const b = bladAnthropic(kod); return json(kod, b.json, rodzaj, b.naglowki); }
    const odp = odpowiedzAnthropic(cialo);
    return json(200, odp, odp._rodzaj, { 'request-id': idLos('req_atrapa_') });
  }
  // OpenAI chat (NVIDIA NIM / Azure GPT)
  if (/\/chat\/completions$/.test(sc)) {
    if (!cialo) return json(400, bladOpenAi(400).json, 'openai-chat');
    const zn = znaczniki(tekst, 'openai-chat');
    const kod = bladDlaWywolania('openai-chat', zn);
    if (kod) return json(kod, bladOpenAi(kod).json, 'openai-chat');
    const r = odpChat(cialo);
    return json(200, r.json, 'openai-chat:' + r._rodzaj);
  }
  if (/\/images\/generations$/.test(sc)) {
    if (!cialo) return json(400, bladOpenAi(400).json, 'openai-grafika');
    const zn = znaczniki(tekst, 'openai-grafika');
    const kod = bladDlaWywolania('openai-grafika', zn);
    if (kod) return json(kod, bladOpenAi(kod).json, 'openai-grafika');
    return json(200, odpObraz(cialo, zn), 'openai-grafika');
  }
  if (/\/audio\/speech$/.test(sc)) {
    const zn = znaczniki(tekst, 'openai-tts');
    const kod = bladDlaWywolania('openai-tts', zn);
    if (kod) return json(kod, bladOpenAi(kod).json, 'openai-tts');
    const mp3 = mp3Cisza(sekundyMowy(cialo && cialo.input));
    return { status: 200, naglowki: { 'content-type': 'audio/mpeg' }, cialo: mp3, rodzaj: 'openai-tts' };
  }
  if (/\/audio\/transcriptions$/.test(sc)) {
    const zn = znaczniki(bufor ? bufor.toString('latin1').slice(0, 4000) : '', 'openai-transkrypcja');
    const kod = bladDlaWywolania('openai-transkrypcja', zn);
    if (kod) return json(kod, bladOpenAi(kod).json, 'openai-transkrypcja');
    const t = odpTranskrypcja(bufor || Buffer.alloc(0), typTresci);
    return { status: 200, naglowki: { 'content-type': t.typ }, cialo: t.cialo, rodzaj: 'openai-transkrypcja' };
  }
  if (/\/embeddings$/.test(sc)) {
    if (!cialo) return json(400, bladOpenAi(400).json, 'embeddings');
    return json(200, odpEmbeddings(cialo), 'embeddings');
  }
  // ElevenLabs: /eleven/v1/text-to-speech/:glos albo /v1/text-to-speech/:glos
  const mE = sc.match(/\/text-to-speech\/([^/]+)(?:\/stream)?$/);
  if (mE) {
    const zn = znaczniki(tekst, 'eleven-tts');
    const kod = bladDlaWywolania('eleven-tts', zn);
    if (kod) return json(kod, bladEleven(kod).json, 'eleven-tts');
    const mp3 = mp3Cisza(sekundyMowy(cialo && cialo.text));
    return { status: 200, naglowki: { 'content-type': 'audio/mpeg' }, cialo: mp3, rodzaj: 'eleven-tts' };
  }
  return json(404, { error: 'atrapa: nieznana sciezka ' + sc }, 'brak');
}

function opoznienieDla(tekst, rodzaj) {
  return opoznienieMs(znaczniki(tekst || '', rodzaj));
}

// ─── Serwer ─────────────────────────────────────────────────────────────────

function uruchom(port = KONF.port, host = KONF.host) {
  const serwer = http.createServer((req, res) => {
    const kawalki = [];
    req.on('data', (c) => kawalki.push(c));
    req.on('end', () => {
      const start = Date.now();
      const bufor = Buffer.concat(kawalki);
      let wynik;
      try {
        wynik = obsluz(req.method, req.url, req.headers, bufor);
      } catch (e) {
        wynik = { status: 500, naglowki: { 'content-type': 'application/json' }, cialo: JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'atrapa: ' + e.message } }), rodzaj: 'wyjatek' };
        console.error('[atrapa] wyjatek:', e && e.stack);
      }
      const czekaj = (req.method === 'POST') ? opoznienieDla(bufor.toString('utf8').slice(0, 200000), wynik.rodzaj) : 0;
      setTimeout(() => {
        const cialo = Buffer.isBuffer(wynik.cialo) ? wynik.cialo : Buffer.from(String(wynik.cialo || ''), 'utf8');
        res.writeHead(wynik.status, Object.assign({}, CORS, wynik.naglowki, { 'content-length': cialo.length }));
        res.end(cialo);
        if (req.method === 'POST') {
          let fragment = '';
          try { const c = JSON.parse(bufor.toString('utf8')); fragment = (tekstBlokow(c.system) || (c.messages && tekstBlokow(c.messages[0] && c.messages[0].content)) || c.prompt || c.input || c.text || '').slice(0, 140); } catch { fragment = ''; }
          zapiszWywolanie({ czas: new Date().toISOString(), rodzaj: wynik.rodzaj, sciezka: req.url, status: wynik.status, ms: Date.now() - start, bajty: cialo.length, poczatek: fragment.replace(/\s+/g, ' ') });
        }
      }, czekaj);
    });
  });
  serwer.listen(port, host, () => {
    console.log(`[atrapa] dostawcy AI na http://${host}:${port} (wersja ${WERSJA}), dziennik: ${KONF.dziennik}`);
  });
  return serwer;
}

/** Handler dla Playwright: page.route(wzorzec, obsluzRoute). */
async function obsluzRoute(route) {
  const req = route.request();
  let url;
  try { url = new URL(req.url()); } catch { return route.continue(); }
  let sciezka = url.pathname + url.search;
  if (/elevenlabs\.io$/.test(url.hostname)) sciezka = '/eleven' + sciezka;
  const bufor = req.postDataBuffer ? (req.postDataBuffer() || Buffer.alloc(0)) : Buffer.from(req.postData() || '', 'utf8');
  const wynik = obsluz(req.method(), sciezka, req.headers(), bufor);
  const czekaj = req.method() === 'POST' ? opoznienieDla(bufor.toString('utf8').slice(0, 200000), wynik.rodzaj) : 0;
  if (czekaj) await new Promise((r) => setTimeout(r, czekaj));
  zapiszWywolanie({ czas: new Date().toISOString(), rodzaj: wynik.rodzaj, sciezka: 'route:' + url.hostname + url.pathname, status: wynik.status, ms: czekaj, bajty: (wynik.cialo || '').length });
  return route.fulfill({ status: wynik.status, headers: Object.assign({}, CORS, wynik.naglowki), body: Buffer.isBuffer(wynik.cialo) ? wynik.cialo : String(wynik.cialo || '') });
}

module.exports = { odpowiedz, odpowiedzAnthropic, obsluz, obsluzRoute, uruchom, rozpoznaj, obrazPng, mp3Cisza, KONF, CORS, listaRodzajow };

if (require.main === module) uruchom();
