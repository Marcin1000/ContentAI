'use strict';

// ─── Testy: dzierzawy (wykonawca C, ARCH8-09, KOD8-01, SEC8-50..52) ──────────
//
// Macierz wielodostepnosci z RAPORT-it-bezpieczenstwo (rozdz. 6) na jednym serwerze: zespol
// glowny (dzisiejsze konta po migracji, dzisiejsze pliki marki i bazy wspolnej) i dwie
// organizacje samoobslugowe A i B. Sprawdzane:
//   - marka: kazda organizacja widzi tylko swoja; zmienia ja zarzadzajacy (glowna: admin jak
//     dzis, samoobslugowa: wlasciciel), czlonek organizacji czyta, ale nie zmienia; plik zespolu
//     zostaje na dzisiejszej sciezce (marka.json), inne w marki/<id>.json,
//   - baza wspolna: lista, wyszukiwanie i blok WIEDZA FIRMOWA tylko z wlasnej organizacji,
//     zapis i usuwanie we wspolnej tylko dla zarzadzajacego, limit dokumentow pakietu
//     w organizacji samoobslugowej liczy tez wspolne (w glownej jak dzis tylko prywatne),
//   - OpenSEO (brama i /api/seo/*) i SERP przez projekt OpenSEO tylko dla glownej, takze gdy
//     konto samoobslugowe ma przez pomylke role admin (operator to admin glownej),
//   - panel operatora (/api/status, /api/admin/prosby) tylko dla admina glownej.
// Wolane z serwer/testy.js: require('./testy-dzierzawy.js').uruchom({ sprawdz }).

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { uruchomSerwer } = require('./testy-wspolne.js');

const KLUCZ_CIASTEK = crypto.randomBytes(32).toString('base64');
const KLUCZ_A = 'sk-ant-api03-DZIERZAWA-' + 'a'.repeat(40);
const SERP_CIALO = {
  model: 'claude-sonnet-5', max_tokens: 500, tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  system: 'Write the context in Polish. Search for top Google results for the given keyword.',
  messages: [{ role: 'user', content: 'Keyword: pompa ciepla\nSearch' }],
};

/** Konto samoobslugowe (wlasna organizacja, wlasciciel), e-mail potwierdzony, zalogowane. */
async function noweKonto(t, email, plan = 'premium') {
  const h = t.srv.zahaszuj(t.HASLO);
  const k = t.magazyn.utworzOrganizacjeIKonto({ email, hash: h.hash, sol: h.sol, jezyk: 'pl', plan, zrodloKluczy: 'wlasne' });
  t.magazyn.zmienKonto(k.login, { emailPotwierdzony: Date.now() });
  return { login: k.login, org: k.organizacja, sesja: await t.zaloguj(k.login) };
}

const nazwy = (lista) => ((lista && lista.dokumenty) || []).map((d) => d.nazwa);

async function uruchom({ sprawdz }) {
  console.log('\n  dzierzawy: organizacje samoobslugowe i zespol glowny nie widza swoich danych (ARCH8-09)');
  const baza = require('./baza.js');
  const atrapaOpenSeo = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><head></head><body>KONTENER-OPENSEO</body></html>');
  });
  await new Promise((r) => atrapaOpenSeo.listen(0, '127.0.0.1', r));
  const t = await uruchomSerwer({
    srodowisko: {
      CAI_KLUCZ_CIASTEK: KLUCZ_CIASTEK, CAI_SERP: 'openseo', CAI_SERP_SAMOOBSLUGA: 'model',
      CAI_OPENSEO_PORT: '1', CAI_OPENSEO_HOST: '127.0.0.1', CAI_OPENSEO_UPSTREAM: String(atrapaOpenSeo.address().port),
    },
    atrapaDostawcow: true,
    // Dane zespolu "z poprzedniego wydania": marka i baza wspolna na dzisiejszych sciezkach.
    przedStartem: async ({ katalog, env }) => {
      fs.writeFileSync(path.join(katalog, 'marka.json'), JSON.stringify({ name: 'Marka Zespolu', domains: 'zespol.example' }));
      await baza.dodaj({
        katalog: env.CAI_BAZA, zakres: baza.WSPOLNA, login: null, nazwa: 'Cennik zespolu', konfWektorow: { klucz: '' },
        tresc: 'Cennik zespolu glownego: pompa ciepla KODGLOWNA77 kosztuje 30 tys. zl brutto z montazem.',
      });
    },
  });
  let brama = null;
  try {
    const admin = await t.zaloguj('admin');
    const premium = await t.zaloguj('premium');
    const A = await noweKonto(t, 'wlasciciel-a@dzierzawy.example');
    const B = await noweKonto(t, 'wlasciciel-b@dzierzawy.example');
    // Czlonek organizacji A (miejsce na pozniejsze zespoly klientow): czyta, nie zmienia.
    const h = t.srv.zahaszuj(t.HASLO);
    t.magazyn.utworzKonto({ login: 'czlonek-a', hash: h.hash, sol: h.sol, organizacja: A.org, pochodzenie: 'admin', zrodloKluczy: 'wlasne', plan: 'premium' });
    const czlonekA = await t.zaloguj('czlonek-a');

    // ── Marka ──
    const marka = async (c) => (await t.zadanie('/api/marka', { headers: { cookie: c } })).json().catch(() => ({}));
    const zapiszMarke = (c, dane) => t.zadanie('/api/marka', t.json(c, dane));
    const plikZespolu = path.join(t.katalog, 'marka.json');
    const nazwaZPliku = (plik) => JSON.parse(fs.readFileSync(plik, 'utf8')).name;
    const mZespol = await marka(premium);
    const mA0 = await marka(A.sesja);
    sprawdz('marka: zespol glowny czyta dzisiejszy plik marka.json (migracja go nie rusza), bez prawa edycji dla uzytkownika',
      (mZespol.marka || {}).name === 'Marka Zespolu' && mZespol.zakres === 'glowna' && mZespol.mozeEdytowac === false);
    sprawdz('marka: nowa organizacja samoobslugowa zaczyna od pustej marki, nie od marki zespolu; wlasciciel moze edytowac',
      Boolean(mA0.marka) && Object.keys(mA0.marka).length === 0 && mA0.zakres === 'samoobsluga' && mA0.mozeEdytowac === true);
    const zapisA = await zapiszMarke(A.sesja, { name: 'Marka A', domains: 'a.example' });
    const mB = await marka(B.sesja);
    const mCzlonek = await marka(czlonekA);
    sprawdz('marka: wlasciciel A zapisuje marke organizacji; B i zespol jej nie widza, czlonek A widzi (bez prawa edycji)',
      zapisA.status === 200 && Boolean(mB.marka) && mB.marka.name === undefined && (await marka(premium)).marka.name === 'Marka Zespolu'
      && (mCzlonek.marka || {}).name === 'Marka A' && mCzlonek.mozeEdytowac === false);
    const plikA = path.join(t.katalog, 'marki', `${A.org}.json`);
    sprawdz('marka: plik organizacji w marki/<id>.json, marka.json zespolu nietkniety',
      fs.existsSync(plikA) && nazwaZPliku(plikA) === 'Marka A' && nazwaZPliku(plikZespolu) === 'Marka Zespolu');
    const zapisCzlonka = await zapiszMarke(czlonekA, { name: 'Przejecie' });
    const zapisPremium = await zapiszMarke(premium, { name: 'Przejecie' });
    const zapisPremiumJ = await zapisPremium.json().catch(() => ({}));
    sprawdz('marka: czlonek organizacji -> 403 uprawnienia-organizacji; uzytkownik zespolu -> 403 jak dzis; nic sie nie zmienia',
      zapisCzlonka.status === 403 && zapisCzlonka.headers.get('x-cai-kod') === 'uprawnienia-organizacji'
      && zapisPremium.status === 403 && zapisPremiumJ.error === 'Konfiguracje marki zmienia administrator'
      && (await marka(A.sesja)).marka.name === 'Marka A' && nazwaZPliku(plikZespolu) === 'Marka Zespolu');
    const zapisAdmina = await zapiszMarke(admin, { name: 'Marka Zespolu 2' });
    sprawdz('marka: admin zespolu zapisuje dzisiejszy marka.json; marki A i B bez zmian',
      zapisAdmina.status === 200 && nazwaZPliku(plikZespolu) === 'Marka Zespolu 2'
      && (await marka(A.sesja)).marka.name === 'Marka A' && (await marka(B.sesja)).marka.name === undefined);

    // ── Baza wiedzy ──
    const lista = async (c) => (await t.zadanie('/api/baza', { headers: { cookie: c } })).json().catch(() => ({}));
    const dodaj = (c, dane) => t.zadanie('/api/baza', t.json(c, dane));
    const szukaj = async (c, zapytanie) => (await t.zadanie('/api/baza/szukaj', t.json(c, { zapytanie }))).json().catch(() => ({}));
    const dA = await dodaj(A.sesja, { nazwa: 'Oferta A', zakres: 'wspolna', tresc: 'Oferta organizacji A: kocioł KODORGA55 w promocji do konca miesiaca. '.repeat(3) });
    const dAj = await dA.json().catch(() => ({}));
    sprawdz('baza: wlasciciel dodaje do bazy wspolnej swojej organizacji (plik wspolna-<id>.json obok wspolna.json zespolu)',
      dA.status === 200 && dAj.zakres === 'wspolna' && fs.existsSync(path.join(t.KONF.katalogBazy, `wspolna-${A.org}.json`))
      && fs.existsSync(path.join(t.KONF.katalogBazy, 'wspolna.json')));
    const lB = nazwy(await lista(B.sesja));
    const lZ = nazwy(await lista(premium));
    const lA = nazwy(await lista(A.sesja));
    const lC = nazwy(await lista(czlonekA));
    sprawdz('baza: B nie widzi wspolnej A ani zespolu; zespol nie widzi A; A i czlonek A widza wspolna A, nie zespolu',
      !lB.includes('Oferta A') && !lB.includes('Cennik zespolu') && lZ.includes('Cennik zespolu') && !lZ.includes('Oferta A')
      && lA.includes('Oferta A') && !lA.includes('Cennik zespolu') && lC.includes('Oferta A'));
    const sB = await szukaj(B.sesja, 'KODORGA55 kocioł promocja');
    const sZ = await szukaj(premium, 'KODORGA55 kocioł promocja');
    const sA = await szukaj(A.sesja, 'KODORGA55 kocioł promocja');
    const sAZespolu = await szukaj(A.sesja, 'KODGLOWNA77 pompa ciepla cennik');
    sprawdz('baza: wyszukiwanie i blok WIEDZA FIRMOWA tylko z wlasnej organizacji (B i zespol o dokument A, A o dokument zespolu: pusto)',
      sB.prompt === '' && sZ.prompt === '' && sAZespolu.prompt === '' && /WIEDZA FIRMOWA/.test(sA.prompt || '') && /KODORGA55/.test(sA.prompt || ''));
    const sZespol = await szukaj(premium, 'KODGLOWNA77 pompa ciepla cennik');
    sprawdz('baza: zespol glowny szuka w dzisiejszym wspolna.json jak dzis', /KODGLOWNA77/.test(sZespol.prompt || ''));

    const zapisCzlonkaBazy = await dodaj(czlonekA, { nazwa: 'Proba', zakres: 'wspolna', tresc: 'Tekst czlonka organizacji A do bazy wspolnej. '.repeat(3) });
    const zapisPremiumBazy = await dodaj(premium, { nazwa: 'Proba', zakres: 'wspolna', tresc: 'Tekst uzytkownika zespolu do bazy wspolnej. '.repeat(3) });
    const zapisPremiumBazyJ = await zapisPremiumBazy.json().catch(() => ({}));
    sprawdz('baza: do wspolnej nie pisze czlonek organizacji (403 uprawnienia-organizacji) ani uzytkownik zespolu (403 jak dzis)',
      zapisCzlonkaBazy.status === 403 && zapisCzlonkaBazy.headers.get('x-cai-kod') === 'uprawnienia-organizacji'
      && zapisPremiumBazy.status === 403 && zapisPremiumBazyJ.error === 'Do bazy wspólnej dodaje wyłącznie admin');
    const usuniecieB = await t.zadanie('/api/baza/usun', t.json(B.sesja, { id: dAj.id, zakres: 'wspolna' }));
    const usuniecieCzlonka = await t.zadanie('/api/baza/usun', t.json(czlonekA, { id: dAj.id, zakres: 'wspolna' }));
    sprawdz('baza: B nie usunie dokumentu wspolnego A (404, szuka we wspolnej swojej organizacji), czlonek A tez nie (403)',
      usuniecieB.status === 404 && usuniecieCzlonka.status === 403 && nazwy(await lista(A.sesja)).includes('Oferta A'));

    const D = await noweKonto(t, 'darmowy-d@dzierzawy.example', 'darmowy');
    const wOrganizacji = [];
    for (const [nazwa, zakres] of [['d1', 'prywatna'], ['d2', 'wspolna'], ['d3', 'prywatna'], ['d4', 'wspolna']]) {
      wOrganizacji.push((await dodaj(D.sesja, { nazwa, zakres, tresc: `Dokument ${nazwa} konta darmowego w organizacji samoobslugowej. `.repeat(2) })).status);
    }
    sprawdz(`baza: w organizacji samoobslugowej limit dokumentow liczy prywatne i wspolne (darmowy 3, czwarty 402; jest ${wOrganizacji.join(',')})`,
      wOrganizacji.join(',') === '200,200,200,402');
    const darmowy = await t.zaloguj('darmowy');
    const wZespole = [];
    for (const nazwa of ['z1', 'z2', 'z3', 'z4']) {
      wZespole.push((await dodaj(darmowy, { nazwa, tresc: `Dokument ${nazwa} konta darmowego zespolu glownego. `.repeat(2) })).status);
    }
    sprawdz(`baza: w zespole glownym limit liczy tylko prywatne, jak dzis (jest ${wZespole.join(',')})`, wZespole.join(',') === '200,200,200,402');

    // ── SERP: glowna -> CAI_SERP (tu projekt OpenSEO), samoobslugowe -> CAI_SERP_SAMOOBSLUGA ──
    const zapisKlucza = await t.zadanie('/api/klucze', t.json(A.sesja, { dostawca: 'anthropic', klucz: KLUCZ_A }));
    const ciastkoKlucza = (zapisKlucza.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
    const serpA = await t.zadanie('/api', t.json(`${A.sesja}; ${ciastkoKlucza}`, SERP_CIALO));
    const serpAJ = await serpA.text();
    const serpZespolu = await t.zadanie('/api', t.json(premium, SERP_CIALO));
    const serpZespoluJ = await serpZespolu.text();
    sprawdz('SERP: konto samoobslugowe nie idzie przez projekt OpenSEO zespolu (CAI_SERP=openseo), tylko modelem na swoim kluczu',
      zapisKlucza.status === 200 && serpA.status === 200 && !/OpenSEO/.test(serpAJ) && serpZespolu.status === 500 && /OpenSEO/.test(serpZespoluJ));

    // ── OpenSEO i panel operatora ──
    const seoA = await t.zadanie('/api/seo/projekty', { headers: { cookie: A.sesja } });
    await seoA.arrayBuffer();
    const seoZespolu = await t.zadanie('/api/seo/projekty', { headers: { cookie: premium } });
    await seoZespolu.arrayBuffer();
    sprawdz('OpenSEO /api/seo/*: konto samoobslugowe Premium -> 402 funkcja-poza-pakietem, Premium zespolu przechodzi dalej',
      seoA.status === 402 && seoA.headers.get('x-cai-kod') === 'funkcja-poza-pakietem' && seoZespolu.status !== 402);
    brama = t.srv.utworzBrameOpenSeo();
    await new Promise((r) => brama.listen(0, '127.0.0.1', r));
    const adresBramy = `http://127.0.0.1:${brama.address().port}/`;
    const wejdz = async (cookie) => {
      const o = await fetch(adresBramy, { headers: { cookie }, redirect: 'manual' });
      return { status: o.status, kontener: (await o.text()).includes('KONTENER-OPENSEO') };
    };
    const bAdmin = await wejdz(admin);
    const bPremium = await wejdz(premium);
    const bA = await wejdz(A.sesja);
    t.magazyn.zmienKonto(A.login, { rola: 'admin' });
    const bAJakoAdmin = await wejdz(A.sesja);
    const statusA = await t.zadanie('/api/status', { headers: { cookie: A.sesja } });
    const prosbyA = await t.zadanie('/api/admin/prosby', { headers: { cookie: A.sesja } });
    t.magazyn.zmienKonto(A.login, { rola: 'uzytkownik' });
    sprawdz('brama OpenSEO: admin i Premium zespolu wchodza; konto samoobslugowe -> 402, takze z rola admin (operator tylko w glownej)',
      bAdmin.kontener && bPremium.kontener && bA.status === 402 && !bA.kontener && bAJakoAdmin.status === 402 && !bAJakoAdmin.kontener);
    sprawdz('panel operatora (/api/status, /api/admin/prosby): konto samoobslugowe z rola admin -> 403',
      statusA.status === 403 && prosbyA.status === 403);
  } finally {
    if (brama) await new Promise((r) => brama.close(r));
    await t.zamknij();
    await new Promise((r) => atrapaOpenSeo.close(r));
  }
}

module.exports = { uruchom };
