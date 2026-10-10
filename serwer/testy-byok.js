'use strict';

// ─── Testy: wlasne klucze BYOK (wykonawca C) ─────────────────────────────────
//
// Najwazniejsza kontrola rundy 9 (warunek wlaczenia CAI_REJESTRACJA): konto na wlasnych
// kluczach (zrodloKluczy 'wlasne') NIGDY nie dostaje klucza serwera - w zadnej sciezce
// proxy (tekst, SERP, grafika, TTS, transkrypcja, ElevenLabs), z zadaniem w tle i bez,
// przy ponowieniu, z pustym naglowkiem, z WSTAW..., z kluczem w naglowku (przyjmowanym juz
// tylko od kont zespolu) i przy CAI_DOSTAWCA=nvidia. Atrapa dostawcow zapisuje naglowek
// autoryzacji kazdego wywolania (KONF.zapisujKlucze); klucze serwera maja przedrostek
// SERWER-, wiec wystarczy, ze zaden zapis wywolan konta 'wlasne' go nie zawiera. Kontrola
// pozytywna: konto zespolu w tych samych trasach dostaje klucze serwera jak dzis (gdyby
// atrapa nie zapisywala kluczy, test by padl, a nie przeszedl "na pusto").
//
// Dalej: ciasteczka (HttpOnly, SameSite=Strict, Path=/api, 30 dni, szyfr zwiazany
// z kontem), M-10 (zwykle wylogowanie nie usuwa kluczy, "wyloguj wszedzie" tak),
// /api/klucze (zapis, stan z koncowka, usuwanie, format SEC8-03, sprawdzenie u dostawcy
// z limitem), zly-klucz w naglowkach, klucz znika z kopii zadania w tle (KOD8-05), budzet
// pamieci zadan, zasoby serwera dla kont 'wlasne' (SERP DataForSEO, strony, odnosniki,
// wektory; potwierdzony e-mail), stan zadania (KOD8-30) i 413 (KOD8-16).
// Wolane z serwer/testy.js: require('./testy-byok.js').uruchom({ sprawdz }).

const crypto = require('node:crypto');
const path = require('node:path');
const { uruchomSerwer } = require('./testy-wspolne.js');

const KLUCZ_CIASTEK = crypto.randomBytes(32).toString('base64');
const SERWER = {
  ANTHROPIC_KEY: 'SERWER-anthropic-0000000000000000000',
  OPENAI_KEY: 'SERWER-openai-000000000000000000000000',
  ELEVEN_KEY: 'SERWER-eleven-000000000000000000000000',
  NVIDIA_KEY: 'SERWER-nvidia-000000000000000000000000',
};
const KLUCZ = {
  anthropic: 'sk-ant-api03-UZYTKOWNIK-' + 'a'.repeat(40),
  openai: 'sk-proj-UZYTKOWNIK-' + 'b'.repeat(40),
  eleven: 'sk_' + 'c'.repeat(48),
};
const NAGLOWEK = { anthropic: 'x-api-key', openai: 'x-openai-key', eleven: 'x-eleven-key' };

// Trasy proxy: [sciezka, dostawca, cialo(znacznik), typ]
const GRANICA = 'byok-granica';
const TRASY = [
  ['/api', 'anthropic', (z) => JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 50, messages: [{ role: 'user', content: `Krotki test BYOK ${z}` }] })],
  ['/api/images', 'openai', (z) => JSON.stringify({ model: 'gpt-image-1', prompt: `test byok ${z}`, n: 1, size: '1024x1024' })],
  ['/api/tts', 'openai', (z) => JSON.stringify({ model: 'gpt-4o-mini-tts', input: `test byok ${z}`, voice: 'alloy' })],
  ['/api/transcribe', 'openai', (z) => `--${GRANICA}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
    + `--${GRANICA}\r\nContent-Disposition: form-data; name="file"; filename="${z}.mp3"\r\nContent-Type: audio/mpeg\r\n\r\nID3atrapa\r\n--${GRANICA}--\r\n`,
  `multipart/form-data; boundary=${GRANICA}`],
  ['/api/eleven-tts', 'eleven', (z) => JSON.stringify({ text: `test byok ${z}`, voice_id: 'glos-testowy' })],
];

const SERP_CIALO = {
  model: 'claude-sonnet-5', max_tokens: 500, tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  system: 'Write the context in Polish. Search for top Google results for the given keyword.',
  messages: [{ role: 'user', content: 'Keyword: pompa ciepla\nSearch' }],
};

function ciasteczkaZOdpowiedzi(odp) {
  const lista = typeof odp.headers.getSetCookie === 'function' ? odp.headers.getSetCookie() : [odp.headers.get('set-cookie') || ''];
  return lista.filter(Boolean);
}

/** "nazwa=wartosc" z naglowkow Set-Cookie (bez atrybutow), z pominieciem kasujacych. */
function paryCiasteczek(odp) {
  return ciasteczkaZOdpowiedzi(odp).filter((c) => !/Max-Age=0/i.test(c)).map((c) => c.split(';')[0]);
}

async function noweKontoWlasne(t, { email, plan = 'premium', potwierdzone = true } = {}) {
  const h = t.srv.zahaszuj(t.HASLO);
  const konto = t.magazyn.utworzOrganizacjeIKonto({ email, hash: h.hash, sol: h.sol, jezyk: 'pl', plan, zrodloKluczy: 'wlasne' });
  if (potwierdzone) t.magazyn.zmienKonto(konto.login, { emailPotwierdzony: Date.now() });
  return { login: konto.login, org: konto.organizacja, sesja: await t.zaloguj(konto.login) };
}

/** Zapytanie POST na trase proxy; naglowki dodatkowe (klucz w naglowku, X-Zadanie). */
function wywolaj(t, cookie, [sciezka, , cialo, typ], znacznik, inne = {}, opcje = {}) {
  return t.zadanie(sciezka, {
    method: 'POST',
    headers: { 'Content-Type': typ || 'application/json', ...t.zWlasnej, ...(cookie ? { cookie } : {}), ...inne },
    body: cialo(znacznik),
    ...opcje,
  });
}

async function zapiszKlucz(t, sesja, dostawca, klucz, dodatki = {}) {
  const odp = await t.zadanie('/api/klucze', t.json(sesja, { dostawca, klucz, ...dodatki }));
  return { odp, json: await odp.json().catch(() => null), ciasteczka: paryCiasteczek(odp), naglowki: ciasteczkaZOdpowiedzi(odp) };
}

async function testyMacierzy({ sprawdz }) {
  console.log('\n  BYOK: konto na wlasnym kluczu nigdy nie dostaje klucza serwera (kazda sciezka, CAI_DOSTAWCA=nvidia)');
  const atrapaModul = require('../narzedzia/atrapa/dostawcy.js');
  const t = await uruchomSerwer({
    srodowisko: { ...SERWER, CAI_DOSTAWCA: 'nvidia', CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_SERP: 'model' },
    atrapaDostawcow: true,
  });
  const zapisujPrzed = atrapaModul.KONF.zapisujKlucze;
  const dziennikPrzed = atrapaModul.KONF.dziennik;
  atrapaModul.KONF.zapisujKlucze = true;
  atrapaModul.KONF.dziennik = path.join(t.katalog, 'atrapa-wywolania.log');
  const wywolania = () => (atrapaModul.ostatnie || []).slice();
  try {
    const anna = await noweKontoWlasne(t, { email: 'anna@byok.example' });
    sprawdz('BYOK: konto samoobslugowe (zrodloKluczy wlasne) loguje sie', /^cai_auth=/.test(anna.sesja));
    if (atrapaModul.ostatnie) atrapaModul.ostatnie.length = 0;

    // 1. Bez klucza: kazda trasa, kazdy wariant naglowka, z zadaniem w tle i bez.
    const warianty = [
      ['bez naglowka', () => ({})],
      ['pusty naglowek', (d) => ({ [NAGLOWEK[d]]: '' })],
      ['naglowek WSTAW_TUTAJ', (d) => ({ [NAGLOWEK[d]]: 'WSTAW_TUTAJ_KLUCZ_' + 'x'.repeat(20) })],
      ['klucz w naglowku (przyjmowany juz tylko od kont zespolu)', (d) => ({ [NAGLOWEK[d]]: KLUCZ[d] })],
      ['zadanie w tle (X-Zadanie)', () => ({ 'x-zadanie': 'byok-bez-klucza-' + crypto.randomBytes(4).toString('hex') })],
    ];
    const zle = [];
    for (const trasa of TRASY) {
      for (const [opis, naglowki] of warianty) {
        const odp = await wywolaj(t, anna.sesja, trasa, 'bez-klucza', naglowki(trasa[1]));
        const j = await odp.json().catch(() => ({}));
        if (!(odp.status === 403 && odp.headers.get('x-cai-kod') === 'brak-klucza' && j.dostawca === trasa[1]
          && odp.headers.get('x-cai-dostawca') === trasa[1])) zle.push(`${trasa[0]} ${opis}: ${odp.status} ${odp.headers.get('x-cai-kod')}`);
      }
    }
    sprawdz(`BYOK: bez wlasnego klucza kazda trasa proxy -> 403 brak-klucza z dostawca (25 przypadkow; zle: ${zle.join('; ') || 'brak'})`, zle.length === 0);
    sprawdz('BYOK: odmowa przed wywolaniem dostawcy - atrapa nie dostala zadnego zapytania', wywolania().length === 0);
    const serpBez = await t.zadanie('/api', t.json(anna.sesja, SERP_CIALO));
    sprawdz('BYOK: analiza SERP (zrodlo model) bez klucza -> 403 brak-klucza, bez wywolania',
      serpBez.status === 403 && serpBez.headers.get('x-cai-kod') === 'brak-klucza' && wywolania().length === 0);

    // 2. Z wlasnym kluczem w ciasteczku: wywolanie idzie z kluczem uzytkownika, tekst do Anthropic (nie NVIDIA).
    const ciasteczka = [];
    for (const d of ['anthropic', 'openai', 'eleven']) {
      const z = await zapiszKlucz(t, anna.sesja, d, KLUCZ[d]);
      if (z.odp.status === 200) ciasteczka.push(...z.ciasteczka);
    }
    sprawdz('BYOK: zapis trzech kluczy przez POST /api/klucze -> trzy ciasteczka', ciasteczka.length === 3);
    const zKluczami = [anna.sesja, ...ciasteczka].join('; ');
    const statusy = [];
    for (const trasa of TRASY) {
      const zwykle = await wywolaj(t, zKluczami, trasa, 'z-kluczem');
      await zwykle.arrayBuffer();
      const id = 'byok-w-tle-' + crypto.randomBytes(4).toString('hex');
      const wTle = await wywolaj(t, zKluczami, trasa, 'w-tle', { 'x-zadanie': id });
      await wTle.arrayBuffer();
      const ponowienie = await wywolaj(t, zKluczami, trasa, 'w-tle', { 'x-zadanie': id });
      await ponowienie.arrayBuffer();
      statusy.push(`${trasa[0]}:${zwykle.status}/${wTle.status}/${ponowienie.status}`);
    }
    const serp = await t.zadanie('/api', t.json(zKluczami, SERP_CIALO));
    await serp.arrayBuffer();
    statusy.push(`serp:${serp.status}`);
    sprawdz(`BYOK: z kluczem w ciasteczku kazda trasa dziala, takze w tle i przy ponowieniu (${statusy.join(' ')})`,
      statusy.every((s) => /:(200\/200\/200|200)$/.test(s)));
    const wywolaniaAnny = wywolania();
    sprawdz(`BYOK: ZADNE wywolanie konta 'wlasne' nie mialo klucza serwera (${wywolaniaAnny.length} wywolan)`,
      wywolaniaAnny.length > 0 && wywolaniaAnny.every((w) => typeof w.klucz === 'string' && !w.klucz.includes('SERWER-')));
    sprawdz('BYOK: wywolania szly z kluczami uzytkownika wlasciwego dostawcy (Anthropic, OpenAI, ElevenLabs)',
      wywolaniaAnny.length > 0 && wywolaniaAnny.every((w) => [KLUCZ.anthropic, KLUCZ.openai, KLUCZ.eleven].includes(w.klucz))
      && wywolaniaAnny.filter((w) => /\/v1\/messages/.test(w.sciezka)).every((w) => w.klucz === KLUCZ.anthropic)
      && wywolaniaAnny.filter((w) => /text-to-speech/.test(w.sciezka)).every((w) => w.klucz === KLUCZ.eleven)
      && wywolaniaAnny.filter((w) => /\/v1\/(images|audio)/.test(w.sciezka)).every((w) => w.klucz === KLUCZ.openai));
    sprawdz('BYOK: przy CAI_DOSTAWCA=nvidia tekst i SERP z kluczem uzytkownika ida do Anthropic, nigdy do NVIDIA (SEC8-03)',
      wywolaniaAnny.some((w) => /\/v1\/messages/.test(w.sciezka)) && !wywolaniaAnny.some((w) => /chat\/completions/.test(w.sciezka)));
    sprawdz('BYOK: ponowienie zadania w tle odbiera wynik z pamieci (2 wywolania na trase: zwykle i w tle, plus SERP)',
      wywolaniaAnny.length === TRASY.length * 2 + 1);

    // 3. Kontrola pozytywna: konto zespolu ('serwera') w tych samych trasach jak dzis.
    if (atrapaModul.ostatnie) atrapaModul.ostatnie.length = 0;
    const cPrem = await t.zaloguj('premium');
    for (const trasa of TRASY) await (await wywolaj(t, cPrem, trasa, 'zespol')).arrayBuffer();
    const zespol = wywolania();
    sprawdz('BYOK: konto zespolu bez wlasnego klucza dostaje klucze serwera jak dzis (atrapa zapisuje klucze, test nie jest pusty)',
      zespol.length === TRASY.length && zespol.every((w) => /^SERWER-/.test(w.klucz || '')));
    sprawdz('BYOK: konto zespolu przy CAI_DOSTAWCA=nvidia: tekst na kluczu serwera NVIDIA jak dzis',
      zespol.some((w) => /chat\/completions/.test(w.sciezka) && w.klucz === SERWER.NVIDIA_KEY));
    if (atrapaModul.ostatnie) atrapaModul.ostatnie.length = 0;
    const zNaglowkiem = await wywolaj(t, cPrem, TRASY[0], 'zespol-naglowek', { 'x-api-key': KLUCZ.anthropic });
    await zNaglowkiem.arrayBuffer();
    sprawdz('BYOK: konto zespolu z kluczem w naglowku (aplikacja R8): klucz uzytkownika do Anthropic, nie do NVIDIA',
      zNaglowkiem.status === 200 && wywolania().length === 1 && /\/v1\/messages/.test(wywolania()[0].sciezka) && wywolania()[0].klucz === KLUCZ.anthropic);
    if (atrapaModul.ostatnie) atrapaModul.ostatnie.length = 0;
    const zeKrotkim = await wywolaj(t, cPrem, TRASY[0], 'zespol-krotki', { 'x-api-key': 'krotki' });
    await zeKrotkim.arrayBuffer();
    sprawdz('BYOK: naglowek spoza formatu (krotszy niz 20 znakow) jest pomijany - konto zespolu na kluczu serwera',
      zeKrotkim.status === 200 && wywolania().length === 1 && wywolania()[0].klucz === SERWER.NVIDIA_KEY);
  } finally {
    atrapaModul.KONF.zapisujKlucze = zapisujPrzed;
    atrapaModul.KONF.dziennik = dziennikPrzed;
    await t.zamknij();
  }
}

async function testyCiasteczek({ sprawdz }) {
  console.log('\n  BYOK: klucze w zaszyfrowanych ciasteczkach HttpOnly (SEC8-04, M-10)');
  const atrapaModul = require('../narzedzia/atrapa/dostawcy.js');
  const t = await uruchomSerwer({ srodowisko: { ...SERWER, CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK }, atrapaDostawcow: true });
  const zapisujPrzed = atrapaModul.KONF.zapisujKlucze;
  const dziennikPrzed = atrapaModul.KONF.dziennik;
  atrapaModul.KONF.zapisujKlucze = true;
  atrapaModul.KONF.dziennik = path.join(t.katalog, 'atrapa-wywolania.log');
  const ostatnie = () => atrapaModul.ostatnie || [];
  const wyczysc = () => { if (atrapaModul.ostatnie) atrapaModul.ostatnie.length = 0; };
  try {
    const ewa = await noweKontoWlasne(t, { email: 'ewa@byok.example' });
    const jan = await noweKontoWlasne(t, { email: 'jan@byok.example' });
    const z = await zapiszKlucz(t, ewa.sesja, 'anthropic', KLUCZ.anthropic);
    const naglowek = z.naglowki[0] || '';
    sprawdz('ciasteczko klucza: cai_k_a, HttpOnly, SameSite=Strict, Path=/api, bez Domain, 30 dni (zapamietaj domyslnie)',
      z.odp.status === 200 && /^cai_k_a=v1\./.test(naglowek) && /; HttpOnly/.test(naglowek) && /; SameSite=Strict/.test(naglowek)
      && /; Path=\/api(;|$)/.test(naglowek) && !/Domain=/i.test(naglowek) && /Max-Age=2592000/.test(naglowek));
    const surowa = naglowek.split(';')[0].slice('cai_k_a='.length);
    const odkodowana = Buffer.from(surowa.slice(3), 'base64url').toString('latin1');
    sprawdz('ciasteczko klucza: wartosc zaszyfrowana (ani klucz, ani jego base64 nie wystepuja w ciasteczku)',
      naglowek.length > 0 && !naglowek.includes(KLUCZ.anthropic) && !naglowek.includes(Buffer.from(KLUCZ.anthropic).toString('base64').slice(0, 20))
      && !odkodowana.includes('UZYTKOWNIK'));
    sprawdz('POST /api/klucze: odpowiedz z koncowka, nigdy z calym kluczem',
      Boolean(z.json) && z.json.ok === true && z.json.anthropic.ustawiony === true && z.json.anthropic.koncowka === KLUCZ.anthropic.slice(-4)
      && z.json.anthropic.zapamietany === true && !JSON.stringify(z.json).includes(KLUCZ.anthropic) && z.json.zrodloKluczy === 'wlasne');
    const sesyjne = await zapiszKlucz(t, ewa.sesja, 'openai', KLUCZ.openai, { zapamietaj: false });
    sprawdz('"Zapamietaj" odznaczone: ciasteczko sesyjne (bez Max-Age)', sesyjne.odp.status === 200 && !/Max-Age/i.test(sesyjne.naglowki[0] || 'Max-Age'));
    const kluczEwy = z.ciasteczka[0] || 'cai_k_a=brak';

    const stan = await (await t.zadanie('/api/klucze', { headers: { cookie: `${ewa.sesja}; ${kluczEwy}` } })).json();
    sprawdz('GET /api/klucze: stan z koncowka i data waznosci, bez klucza; pozostali dostawcy nieustawieni',
      Boolean(stan.anthropic) && stan.anthropic.ustawiony === true && stan.anthropic.koncowka === KLUCZ.anthropic.slice(-4)
      && stan.anthropic.wygasa > Date.now() + 29 * 86400_000 && stan.openai.ustawiony === false && stan.eleven.ustawiony === false
      && !JSON.stringify(stan).includes(KLUCZ.anthropic) && Array.isArray(stan.dostawcy) && stan.zapis === true);

    // Ciasteczko Ewy w sesji Jana: szyfr zwiazany z kontem, Jan dostaje brak-klucza, a jej klucz nie wychodzi.
    wyczysc();
    const cudze = await wywolaj(t, `${jan.sesja}; ${kluczEwy}`, TRASY[0], 'cudze');
    const cudzeJson = await cudze.json().catch(() => ({}));
    sprawdz('ciasteczko konta A w sesji konta B: 403 brak-klucza (niewazny), klucz A nie trafia do dostawcy',
      cudze.status === 403 && cudzeJson.kod === 'brak-klucza' && cudzeJson.niewazny === true && ostatnie().length === 0);
    const zepsute = kluczEwy.slice(0, -3) + (kluczEwy.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
    const zmienione = await wywolaj(t, `${ewa.sesja}; ${zepsute}`, TRASY[0], 'zmienione');
    sprawdz('zmieniony bajt w ciasteczku: jak brak klucza (403), bez wywolania dostawcy',
      zmienione.status === 403 && zmienione.headers.get('x-cai-kod') === 'brak-klucza' && ostatnie().length === 0);

    // M-10: zwykle wylogowanie nie usuwa kluczy, nowa sesja tego konta je czyta.
    const wyl = await t.zadanie('/auth/logout', { method: 'POST', headers: { cookie: `${ewa.sesja}; ${kluczEwy}`, ...t.zWlasnej, 'Content-Type': 'application/x-www-form-urlencoded' } });
    sprawdz('M-10: zwykle wylogowanie nie kasuje ciasteczek z kluczami',
      wyl.status === 302 && !ciasteczkaZOdpowiedzi(wyl).some((c) => /^(__Secure-)?cai_k_/.test(c)));
    const ewa2 = await t.zaloguj(ewa.login);
    const poPonownym = await wywolaj(t, `${ewa2}; ${kluczEwy}`, TRASY[0], 'po-wylogowaniu');
    await poPonownym.arrayBuffer();
    sprawdz('M-10: po ponownym zalogowaniu zapamietany klucz dziala bez ponownego wpisywania',
      poPonownym.status === 200 && ostatnie().some((w) => w.klucz === KLUCZ.anthropic));

    // "Wyloguj wszedzie" i zmiana hasla podnosza sesjeOd: zapamietane klucze traca waznosc wszedzie.
    await new Promise((r) => setTimeout(r, 5));
    t.magazyn.zmienKonto(ewa.login, { sesjeOd: Date.now() });
    await new Promise((r) => setTimeout(r, 5));
    const ewa3 = await t.zaloguj(ewa.login);
    const poWylogowaniuWszedzie = await wywolaj(t, `${ewa3}; ${kluczEwy}`, TRASY[0], 'wszedzie');
    const pww = await poWylogowaniuWszedzie.json().catch(() => ({}));
    sprawdz('"Wyloguj wszedzie" / zmiana hasla (sesjeOd): zapamietany klucz niewazny na kazdym urzadzeniu',
      poWylogowaniuWszedzie.status === 403 && pww.kod === 'brak-klucza' && pww.niewazny === true);
    const usuwajace = require('./klucze.js').ciasteczkaUsuwajace(t.KONF);
    sprawdz('ciasteczkaUsuwajace() dla A1: trzy naglowki z Max-Age=0 i tymi samymi atrybutami',
      usuwajace.length === 3 && usuwajace.every((c) => /^cai_k_[aoe]=; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=0$/.test(c)));

    // Usuniecie klucza.
    const ponownie = await zapiszKlucz(t, ewa3, 'anthropic', KLUCZ.anthropic);
    const nowyKlucz = ponownie.ciasteczka[0];
    const usun = await t.zadanie('/api/klucze?dostawca=anthropic', { method: 'DELETE', headers: { cookie: `${ewa3}; ${nowyKlucz}`, 'Content-Type': 'application/json', ...t.zWlasnej } });
    const usunJson = await usun.json().catch(() => ({}));
    sprawdz('DELETE /api/klucze?dostawca=anthropic: Set-Cookie z Max-Age=0, stan nieustawiony',
      usun.status === 200 && ciasteczkaZOdpowiedzi(usun).some((c) => /^cai_k_a=;.*Max-Age=0/.test(c)) && usunJson.anthropic && usunJson.anthropic.ustawiony === false);
    const wszystkie = await t.zadanie('/api/klucze/usun', t.json(ewa3, {}));
    sprawdz('POST /api/klucze/usun bez dostawcy: kasuje wszystkie trzy', wszystkie.status === 200
      && ciasteczkaZOdpowiedzi(wszystkie).filter((c) => /Max-Age=0/.test(c)).length === 3);

    // Format kluczy (SEC8-03): zly format -> 400 bez wywolania dostawcy i bez ciasteczka.
    wyczysc();
    const przypadki = [
      ['anthropic', 'sk-proj-' + 'z'.repeat(40), 'format'],
      ['anthropic', 'sk-ant-admin01-' + 'z'.repeat(40), 'administracyjny'],
      ['openai', KLUCZ.anthropic, 'inny-dostawca'],
      ['openai', 'sk-admin-' + 'z'.repeat(40), 'administracyjny'],
      ['eleven', 'nie-klucz', 'format'],
      ['anthropic', 'sk-ant-api03-' + 'z'.repeat(20) + ' spacja', 'format'],
    ];
    const zleFormaty = [];
    for (const [d, k, powod] of przypadki) {
      const o = await zapiszKlucz(t, ewa3, d, k);
      if (!(o.odp.status === 400 && o.odp.headers.get('x-cai-kod') === 'zly-klucz' && o.json && o.json.format === powod && o.ciasteczka.length === 0
        && /klucz|key/i.test((o.json.error || {}).message || ''))) zleFormaty.push(`${d}/${powod}: ${o.odp.status} ${o.json && o.json.format}`);
    }
    sprawdz(`format klucza (SEC8-03): 400 zly-klucz z powodem, bez ciasteczka i bez wysylki (zle: ${zleFormaty.join('; ') || 'brak'})`,
      zleFormaty.length === 0 && ostatnie().length === 0);
    const en = await t.zadanie('/api/klucze', t.json(ewa3, { dostawca: 'anthropic', klucz: 'sk-proj-' + 'z'.repeat(40) }, { 'accept-language': 'en' }));
    sprawdz('komunikat o zlym formacie po angielsku przy Accept-Language: en', /not an Anthropic API key/.test(((await en.json().catch(() => ({}))).error || {}).message || ''));

    // Sprawdzenie u dostawcy bez kosztu.
    wyczysc();
    const sprawdzKlucz = async (dane, inne) => (await t.zadanie('/api/klucze/sprawdz', t.json(ewa3, dane, inne))).json().catch(() => ({}));
    const dobry = await sprawdzKlucz({ dostawca: 'anthropic', klucz: KLUCZ.anthropic });
    const zly = await sprawdzKlucz({ dostawca: 'anthropic', klucz: 'sk-ant-api03-zly-' + 'q'.repeat(30) });
    const bezUpr = await sprawdzKlucz({ dostawca: 'openai', klucz: 'sk-proj-bez-uprawnien-' + 'q'.repeat(30) });
    const elevenOk = await sprawdzKlucz({ dostawca: 'eleven', klucz: KLUCZ.eleven });
    const elevenZly = await sprawdzKlucz({ dostawca: 'e', klucz: 'sk_deadbeef' + 'a'.repeat(40) });
    const zNaglowka = await sprawdzKlucz({ dostawca: 'openai' }, { 'x-openai-key': KLUCZ.openai });
    const formatZly = await sprawdzKlucz({ dostawca: 'anthropic', klucz: 'smiec' });
    sprawdz('POST /api/klucze/sprawdz: dobry -> ok, zly -> zly-klucz, bez uprawnien -> brak-uprawnien, ElevenLabs, klucz z naglowka',
      dobry.ok === true && zly.ok === false && zly.powod === 'zly-klucz' && bezUpr.powod === 'brak-uprawnien'
      && elevenOk.ok === true && elevenZly.powod === 'zly-klucz' && zNaglowka.ok === true && formatZly.powod === 'zly-klucz' && formatZly.format === 'format');
    const odczyty = ostatnie().filter((w) => /-klucz$/.test(w.rodzaj || ''));
    sprawdz('sprawdzenie: darmowy odczyt (GET /v1/models, /v1/user), klucz uzytkownika, zly format nie wychodzi',
      odczyty.length === 6 && odczyty.every((w) => /\/v1\/models|\/v1\/user/.test(w.sciezka)) && !odczyty.some((w) => /SERWER-/.test(w.klucz || '')));
    const cZesp = await t.zaloguj('standard');
    const zespolBez = await (await t.zadanie('/api/klucze/sprawdz', t.json(cZesp, { dostawca: 'anthropic' }))).json().catch(() => ({}));
    sprawdz('sprawdzenie nigdy nie bierze klucza serwera: konto zespolu bez wlasnego klucza -> brak-klucza',
      zespolBez.ok === false && zespolBez.powod === 'brak-klucza');
    let limit = null;
    for (let i = 0; i < 6; i++) {
      const o = await t.zadanie('/api/klucze/sprawdz', t.json(ewa3, { dostawca: 'anthropic', klucz: KLUCZ.anthropic }));
      if (o.status === 429) { limit = o; break; }
      await o.arrayBuffer();
    }
    sprawdz('sprawdzenie: 10 na minute na konto, potem 429 za-duzo-prob z ponowZa',
      limit !== null && limit.headers.get('x-cai-kod') === 'za-duzo-prob' && (await limit.json()).ponowZa > 0);
    const zapisISprawdz = await zapiszKlucz(t, cZesp, 'anthropic', 'sk-ant-api03-zly-' + 'w'.repeat(30), { sprawdz: true });
    sprawdz('"zapisz i sprawdz": klucz odrzucony przez dostawce nie jest zapisywany',
      zapisISprawdz.odp.status === 200 && Boolean(zapisISprawdz.json) && zapisISprawdz.json.zapisano === false
      && zapisISprawdz.json.powod === 'zly-klucz' && zapisISprawdz.ciasteczka.length === 0);

    // Konto zespolu tez moze zapisac wlasny klucz: wtedy ma on pierwszenstwo przed kluczem serwera.
    const kluczZespolu = (await zapiszKlucz(t, cZesp, 'anthropic', KLUCZ.anthropic)).ciasteczka[0];
    const stanZespolu = await (await t.zadanie('/api/klucze', { headers: { cookie: cZesp } })).json().catch(() => ({}));
    sprawdz('GET /api/klucze konta zespolu: zrodloKluczy serwera i informacja o kluczu serwera (bez wartosci)',
      stanZespolu.zrodloKluczy === 'serwera' && Boolean(stanZespolu.anthropic) && stanZespolu.anthropic.kluczSerwera === true
      && !JSON.stringify(stanZespolu).includes('SERWER-'));
    wyczysc();
    await (await wywolaj(t, `${cZesp}; ${kluczZespolu}`, TRASY[0], 'zespol-ciasteczko')).arrayBuffer();
    sprawdz('konto zespolu z zapisanym kluczem: wywolanie na kluczu uzytkownika', ostatnie().length === 1 && ostatnie()[0].klucz === KLUCZ.anthropic);

    // Odrzucenie klucza uzytkownika przez dostawce: odpowiedz bez zmian + X-CAI-Kod: zly-klucz.
    const zleKlucze = { anthropic: 'sk-ant-api03-zly-' + 'e'.repeat(30), openai: 'sk-proj-zly-' + 'e'.repeat(30), eleven: 'sk_deadbeef' + 'e'.repeat(40) };
    const zleOdp = [];
    for (const trasa of [TRASY[0], TRASY[1], TRASY[4]]) {
      const c = (await zapiszKlucz(t, ewa3, trasa[1], zleKlucze[trasa[1]])).ciasteczka[0];
      const o = await wywolaj(t, `${ewa3}; ${c}`, trasa, 'zly');
      await o.arrayBuffer();
      zleOdp.push(`${trasa[1]}:${o.status}:${o.headers.get('x-cai-kod')}:${o.headers.get('x-cai-dostawca')}`);
    }
    sprawdz(`zly klucz uzytkownika: status dostawcy (401) z X-CAI-Kod zly-klucz i X-CAI-Dostawca (${zleOdp.join(' ')})`,
      zleOdp.join(' ') === 'anthropic:401:zly-klucz:anthropic openai:401:zly-klucz:openai eleven:401:zly-klucz:eleven');
  } finally {
    atrapaModul.KONF.zapisujKlucze = zapisujPrzed;
    atrapaModul.KONF.dziennik = dziennikPrzed;
    await t.zamknij();
  }

  // Bez CAI_KLUCZ_CIASTEK: zapis wylaczony czytelnie, konta zespolu jak dzis.
  const bez = await uruchomSerwer({ srodowisko: { CAI_KLUCZ_CIASTEK: undefined }, atrapaDostawcow: true });
  try {
    const c = await bez.zaloguj('standard');
    const zapis = await bez.zadanie('/api/klucze', bez.json(c, { dostawca: 'anthropic', klucz: KLUCZ.anthropic }));
    const stan = await (await bez.zadanie('/api/klucze', { headers: { cookie: c } })).json().catch(() => ({}));
    const tekst = await bez.zadanie('/api', bez.json(c, { model: 'claude-sonnet-5', max_tokens: 20, messages: [{ role: 'user', content: 'x' }] }));
    sprawdz('bez CAI_KLUCZ_CIASTEK: zapis kluczy 503 z powodem, stan zapis:false, konto zespolu generuje jak dzis',
      zapis.status === 503 && (await zapis.json().catch(() => ({}))).powod === 'zapis-wylaczony' && stan.zapis === false && tekst.status === 200);
  } finally {
    await bez.zamknij();
  }
}

async function testyKluczDla({ sprawdz }) {
  console.log('\n  BYOK: kluczDla - galaz wlasne nie zna klucza serwera');
  const klucze = require('./klucze.js');
  const konf = {
    dostawca: 'nvidia', cookieSecure: true, kluczCiastek: { poprawny: true, klucz: crypto.randomBytes(32) },
    klucze: { anthropic: 'SERWER-a', openai: 'SERWER-o', eleven: 'SERWER-e', nvidia: 'SERWER-n' },
  };
  const naglowki = { 'x-api-key': KLUCZ.anthropic, 'x-openai-key': KLUCZ.openai, 'x-eleven-key': KLUCZ.eleven };
  const wyniki = [];
  for (const konto of [{ login: 'k-aaaaaaaaaaaa', zrodloKluczy: 'wlasne' }, { login: 'x' }, { login: 'y', zrodloKluczy: 'nieznane' }, null]) {
    for (const d of klucze.DOSTAWCY || ['anthropic']) wyniki.push(klucze.kluczDla({ headers: naglowki }, konto, d, konf));
  }
  sprawdz('kluczDla: konto wlasne, bez pola zrodloKluczy, z nieznana wartoscia i bez konta -> zawsze blad, nigdy klucz (takze przy naglowkach)',
    wyniki.length === 12 && wyniki.every((w) => w.blad && w.blad.kod === 'brak-klucza' && w.klucz === undefined));
  const zespol = { login: 'zespol', zrodloKluczy: 'serwera' };
  const serwerowy = klucze.kluczDla({ headers: {} }, zespol, 'anthropic', konf);
  const zNaglowka = klucze.kluczDla({ headers: naglowki }, zespol, 'anthropic', konf);
  sprawdz('kluczDla: konto zespolu bez naglowka -> NVIDIA na kluczu serwera; z naglowkiem -> Anthropic na kluczu uzytkownika',
    serwerowy.czyj === 'serwera' && serwerowy.cel === 'nvidia' && serwerowy.klucz === 'SERWER-n'
    && zNaglowka.czyj === 'uzytkownika' && zNaglowka.cel === 'anthropic' && zNaglowka.klucz === KLUCZ.anthropic);
  const ciastko = klucze.ciasteczkoZKluczem('anthropic', { klucz: KLUCZ.anthropic }, { login: 'k-bbbbbbbbbbbb' }, konf, true);
  sprawdz('CAI_COOKIE_SECURE=1: przedrostek __Secure- i atrybut Secure', /^__Secure-cai_k_a=v1\./.test(ciastko) && /; Secure/.test(ciastko));
  const odczyt = klucze.kluczDla({ headers: { cookie: ciastko.split(';')[0] } }, { login: 'k-bbbbbbbbbbbb', zrodloKluczy: 'wlasne' }, 'anthropic', konf);
  sprawdz('kluczDla: klucz z ciasteczka konta wlasne -> uzytkownika, cel anthropic', odczyt.czyj === 'uzytkownika' && odczyt.cel === 'anthropic' && odczyt.klucz === KLUCZ.anthropic);
  sprawdz('miejsce na czwartego dostawce (para login + haslo): format i koncowka z opisu dostawcy, nie z kodu tras',
    klucze.zlyFormat('anthropic', { klucz: KLUCZ.anthropic }) === null && klucze.zlyFormat('eleven', { klucz: 'x' }).powod === 'format'
    && klucze.DOSTAWCY_OPIS.anthropic.pola.length === 1 && typeof klucze.DOSTAWCY_OPIS.anthropic.sprawdzenie === 'function');
}

async function testyZadan({ sprawdz }) {
  console.log('\n  BYOK: klucz znika z pamieci zadania w tle, budzet pamieci (ARCH8-12, KOD8-05)');
  const zadania = require('./zadania.js');
  const req = {
    headers: { cookie: 'cai_auth=x; cai_k_a=v1.tajne', 'x-api-key': KLUCZ.anthropic, 'x-openai-key': KLUCZ.openai, 'x-eleven-key': KLUCZ.eleven, 'content-type': 'application/json' },
    cialoGotowe: Buffer.from('{}'),
  };
  const wpis = zadania.uruchom('test-pamieci', 'zadanie-pamieci-01', req, async (odp) => { odp.writeHead(200, { 'Content-Type': 'application/json' }); odp.end('{"ok":true}'); });
  await wpis.obietnica;
  sprawdz('zadanie w tle: po wywolaniu kopia zapytania bez cookie i naglowkow z kluczami, wpis bez zapytania',
    !('cookie' in req.headers) && !('x-api-key' in req.headers) && !('x-openai-key' in req.headers) && !('x-eleven-key' in req.headers)
    && req.headers['content-type'] === 'application/json' && wpis.odp.req === null && req.cialoGotowe === null);
  sprawdz('zadanie w tle: wynik zostaje do odebrania, stan "gotowe"',
    typeof zadania.stanZadania === 'function' && zadania.stanZadania('test-pamieci', 'zadanie-pamieci-01').stan === 'gotowe');

  // Budzet 0,0001 MB (ok. 105 B) mniejszy niz samo cialo zapytania (ok. 400 B). Modul zadan jest
  // wspolny dla calego procesu testow, wiec budzet wraca na koniec do poprzedniej wartosci.
  const budzetPrzed = zadania.stan().budzetBajtow;
  const t = await uruchomSerwer({ srodowisko: { CAI_ZADANIA_MB: '0.0001' }, atrapaDostawcow: true });
  try {
    const c = await t.zaloguj('standard');
    const cialo = { model: 'claude-sonnet-5', max_tokens: 20, messages: [{ role: 'user', content: 'budzet zadan ' + 'x'.repeat(300) }] };
    const odp = await t.zadanie('/api', t.json(c, cialo, { 'x-zadanie': 'zadanie-budzet-0001' }));
    sprawdz('CAI_ZADANIA_MB: przy wyczerpanym budzecie zapytanie idzie bez trybu w tle (200, wyniku nie ma w pamieci)',
      odp.status === 200 && Boolean((await odp.json()).content) && zadania.znajdz('standard', 'zadanie-budzet-0001') === null);
  } finally {
    await t.zamknij();
    zadania.ustaw({ budzetMb: budzetPrzed / 1024 / 1024 });
  }

  const t2 = await uruchomSerwer({ srodowisko: { CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK }, atrapaDostawcow: true });
  try {
    const anna = await noweKontoWlasne(t2, { email: 'pamiec@byok.example' });
    const c = [anna.sesja, (await zapiszKlucz(t2, anna.sesja, 'anthropic', KLUCZ.anthropic)).ciasteczka[0]].join('; ');
    const id = 'zadanie-tle-klucz-01';
    const odp = await t2.zadanie('/api', t2.json(c, { model: 'claude-sonnet-5', max_tokens: 20, messages: [{ role: 'user', content: 'klucz w pamieci' }] }, { 'x-zadanie': id }));
    await odp.arrayBuffer();
    const w = zadania._zadania.get(`${anna.login}:${id}`);
    sprawdz('zadanie w tle przez HTTP: po wywolaniu wpis nie trzyma zapytania ani ciasteczka z kluczem',
      odp.status === 200 && Boolean(w) && w.odp.req === null && !JSON.stringify(w.odp.wynik().naglowki).includes('cai_k_'));
    const stan = await (await t2.zadanie(`/api/zadanie?id=${id}`, { headers: { cookie: anna.sesja } })).json().catch(() => ({}));
    const stanSciezka = await (await t2.zadanie(`/api/zadanie/${id}`, { headers: { cookie: anna.sesja } })).json().catch(() => ({}));
    const brak = await (await t2.zadanie('/api/zadanie?id=zadanie-nieznane-01', { headers: { cookie: anna.sesja } })).json().catch(() => ({}));
    const cudzy = await (await t2.zadanie(`/api/zadanie?id=${id}`, { headers: { cookie: await t2.zaloguj('standard') } })).json().catch(() => ({}));
    sprawdz('GET /api/zadanie (KOD8-30): gotowe z kodem odpowiedzi, brak dla nieznanego i dla cudzego konta',
      stan.stan === 'gotowe' && stan.status === 200 && stanSciezka.stan === 'gotowe' && brak.stan === 'brak' && cudzy.stan === 'brak');
    // Konto wlasne bez klucza OpenAI dostaje 403 przed czytaniem ciala; konto zespolu: 413 z rozmiarem.
    const duze = await t2.zadanie('/api/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', cookie: c, ...t2.zWlasnej },
      body: Buffer.alloc(26 * 1024 * 1024),
    }).catch(() => ({ status: 0 }));
    const duzeJson = duze.status ? await duze.json().catch(() => ({})) : {};
    const cZesp = await t2.zaloguj('premium');
    const duzeZesp = await t2.zadanie('/api/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', cookie: cZesp, ...t2.zWlasnej },
      body: Buffer.alloc(26 * 1024 * 1024),
    }).catch(() => ({ status: 0 }));
    const duzeZespJson = duzeZesp.status ? await duzeZesp.json().catch(() => ({})) : {};
    sprawdz('za duze nagranie (KOD8-16): 413 z komunikatem o 25 MB zamiast 502; konto wlasne bez klucza: 403 od razu',
      duze.status === 403 && duzeJson.kod === 'brak-klucza' && duzeZesp.status === 413 && /25 MB/.test(duzeZespJson.komunikat || ''));
  } finally {
    await t2.zamknij();
  }
}

async function testyZasobow({ sprawdz }) {
  console.log('\n  zasoby oplacane przez serwer dla kont na wlasnym kluczu (ARCH8-11, D-09)');
  const strona = require('./strona.js');
  const serp = require('./serp.js');
  const plany = require('./plany.js');
  const atrapaModul = require('../narzedzia/atrapa/dostawcy.js');
  const t = await uruchomSerwer({
    srodowisko: {
      CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, NVIDIA_KEY: 'SERWER-nvidia-wektory-0000000000', CAI_SERP: 'model',
      CAI_SERP_SAMOOBSLUGA: 'dataforseo', DATAFORSEO_LOGIN: 'serwer-login', DATAFORSEO_HASLO: 'serwer-haslo',
    },
    atrapaDostawcow: true,
  });
  const pobierzPrzed = strona.pobierz;
  const odnosnikiPrzed = strona.sprawdzOdnosniki;
  const dataForSeoPrzed = serp.zDataForSeo;
  let pobran = 0;
  let zapytanSerp = 0;
  strona.pobierz = async (adres) => { pobran += 1; return { adres, tytul: 'Strona', tekst: 'tresc strony '.repeat(20), slowa: 40 }; };
  strona.sprawdzOdnosniki = async (adresy) => adresy.map((adres) => ({ adres, status: 200, stan: 'dziala', dziala: true }));
  serp.zDataForSeo = async (fraza) => { zapytanSerp += 1; return { context: 'x', topics: ['a'], phrases: ['b'], avgWords: 0, avgH2: 0, zrodlo: 'dataforseo', wynikow: 3, fraza }; };
  try {
    const wl = await noweKontoWlasne(t, { email: 'zasoby@byok.example', plan: 'standard' });
    const kluczA = (await zapiszKlucz(t, wl.sesja, 'anthropic', KLUCZ.anthropic)).ciasteczka[0];
    const c = `${wl.sesja}; ${kluczA}`;
    const okres = plany.okresTeraz(plany.PLANY.standard);
    const uzycie = () => t.magazyn.uzycie(wl.login, okres);

    // Strony: pula pakietu (standard: 1000 na miesiac), po wyczerpaniu 402 zasob-serwera-wyczerpany.
    const s1 = await t.zadanie('/api/strona', t.json(c, { adres: 'https://example.com/a' }));
    sprawdz('konto wlasne: pobranie strony liczy sie do puli serwer:strony', s1.status === 200 && uzycie()['serwer:strony'] === 1);
    t.magazyn.ustawUzycie(wl.login, okres, 'serwer:strony', 1000);
    const s2 = await t.zadanie('/api/strona', t.json(c, { adres: 'https://example.com/b' }));
    const s2j = await s2.json().catch(() => ({}));
    sprawdz('konto wlasne: po wyczerpaniu puli stron 402 zasob-serwera-wyczerpany (zasob, limit, zuzyte), bez pobrania',
      s2.status === 402 && s2.headers.get('x-cai-kod') === 'zasob-serwera-wyczerpany' && s2j.zasob === 'strony' && s2j.limit === 1000 && pobran === 1);
    t.magazyn.ustawUzycie(wl.login, okres, 'serwer:strony', 997);
    const o = await t.zadanie('/api/odnosniki', t.json(c, { adresy: ['https://example.com/1', 'https://example.com/2', 'https://example.com/3', 'https://example.com/4', 'https://example.com/5'] }));
    const oj = await o.json().catch(() => ({}));
    sprawdz('odnosniki: sprawdzone tyle, ile zostalo w puli (3 z 5), reszta "nieznany" z powodem; kolejnosc zachowana',
      o.status === 200 && Array.isArray(oj.odnosniki) && oj.odnosniki.length === 5 && oj.odnosniki.slice(0, 3).every((x) => x.stan === 'dziala')
      && oj.odnosniki.slice(3).every((x) => x.stan === 'nieznany' && x.powod === 'limit-pakietu') && oj.pominiete === 2 && uzycie()['serwer:strony'] === 1000);
    const o2 = await t.zadanie('/api/odnosniki', t.json(c, { adresy: ['https://example.com/6'] }));
    sprawdz('odnosniki: przy pustej puli 402 zasob-serwera-wyczerpany', o2.status === 402 && (await o2.json().catch(() => ({}))).zasob === 'strony');

    // SERP z DataForSEO oplaca serwer: pula pakietu (standard 100).
    const serpOk = await t.zadanie('/api', t.json(c, SERP_CIALO));
    const serpOkJ = await serpOk.json().catch(() => ({}));
    sprawdz('konto wlasne, CAI_SERP_SAMOOBSLUGA=dataforseo: SERP z DataForSEO, liczy serwer:serp',
      serpOk.status === 200 && /dataforseo/.test(((serpOkJ.content || [])[0] || {}).text || '') && zapytanSerp === 1 && uzycie()['serwer:serp'] === 1);
    t.magazyn.ustawUzycie(wl.login, okres, 'serwer:serp', 100);
    const serpKoniec = await t.zadanie('/api', t.json(c, SERP_CIALO));
    sprawdz('konto wlasne: po wyczerpaniu puli SERP 402 zasob-serwera-wyczerpany, DataForSEO nie wolane',
      serpKoniec.status === 402 && serpKoniec.headers.get('x-cai-kod') === 'zasob-serwera-wyczerpany'
      && (await serpKoniec.json().catch(() => ({}))).zasob === 'serp' && zapytanSerp === 1);

    // Wektory: D-09 - pula 0 we wszystkich pakietach, konta wlasne szukaja po slowach kluczowych.
    if (atrapaModul.ostatnie) atrapaModul.ostatnie.length = 0;
    const dok = await (await t.zadanie('/api/baza', t.json(c, { nazwa: 'Oferta', tresc: 'Pompa ciepla do domu jednorodzinnego, montaz w tydzien.' }))).json().catch(() => ({}));
    const szukaj = await (await t.zadanie('/api/baza/szukaj', t.json(c, { zapytanie: 'pompa ciepla montaz' }))).json().catch(() => ({}));
    sprawdz('D-09: konto wlasne dodaje i szuka w bazie bez wektorow NVIDIA (slowa kluczowe, powod limit-pakietu)',
      dok.zWektorami === false && szukaj.metoda === 'slowa-kluczowe' && szukaj.powod === 'limit-pakietu' && (szukaj.fragmenty || []).length > 0
      && !(atrapaModul.ostatnie || []).some((w) => /embeddings/.test(w.sciezka)));
    const cStd = await t.zaloguj('standard');
    const dokZesp = await (await t.zadanie('/api/baza', t.json(cStd, { nazwa: 'Zespol', tresc: 'Dokument zespolu z wektorami NVIDIA.' }))).json().catch(() => ({}));
    sprawdz('konto zespolu: wektory NVIDIA jak dzis (bez puli serwera)', dokZesp.zWektorami === true);

    // Niepotwierdzony e-mail konta samoobslugowego: zasoby serwera dopiero po potwierdzeniu.
    const nowy = await noweKontoWlasne(t, { email: 'niepotwierdzony@byok.example', plan: 'standard', potwierdzone: false });
    const cNowy = `${nowy.sesja}; ${(await zapiszKlucz(t, nowy.sesja, 'anthropic', KLUCZ.anthropic)).ciasteczka[0]}`;
    const sn = await t.zadanie('/api/strona', t.json(cNowy, { adres: 'https://example.com/c' }));
    const serpN = await t.zadanie('/api', t.json(cNowy, SERP_CIALO));
    const tekstN = await t.zadanie('/api', t.json(cNowy, { model: 'claude-sonnet-5', max_tokens: 20, messages: [{ role: 'user', content: 'tekst' }] }));
    sprawdz('niepotwierdzony e-mail: strony i SERP serwera -> 403 email-niepotwierdzony, tekst na wlasnym kluczu dziala',
      sn.status === 403 && sn.headers.get('x-cai-kod') === 'email-niepotwierdzony' && serpN.status === 403 && tekstN.status === 200 && pobran === 1);

    // Konto zespolu: strony bez puli (jak dzis).
    t.magazyn.ustawUzycie('standard', okres, 'serwer:strony', 5000);
    const sz = await t.zadanie('/api/strona', t.json(cStd, { adres: 'https://example.com/zespol' }));
    sprawdz('konto zespolu: pobieranie stron bez puli serwera (jak dzis)', sz.status === 200 && pobran === 2);
  } finally {
    strona.pobierz = pobierzPrzed;
    strona.sprawdzOdnosniki = odnosnikiPrzed;
    serp.zDataForSeo = dataForSeoPrzed;
    await t.zamknij();
  }
}

async function uruchom({ sprawdz }) {
  await testyMacierzy({ sprawdz });
  await testyCiasteczek({ sprawdz });
  await testyKluczDla({ sprawdz });
  await testyZadan({ sprawdz });
  await testyZasobow({ sprawdz });
  // Odpornosc serwera (KOD8-02, 07, 11, 15, SEC8-30, kompresja): osobny plik, wolany stad,
  // zeby lista plikow w serwer/testy.js (etap 0) zostala bez zmian.
  await require('./testy-odpornosc.js').uruchom({ sprawdz });
}

module.exports = { uruchom, KLUCZ, SERWER };
