'use strict';

// ─── Testy: konta samoobslugowe (A1) ─────────────────────────────────────────
// PROJEKT-TECHNICZNY 11.2 (wiersz testy-konta.js): rejestracja (CSRF, pulapka, znacznik czasu,
// walidacja przy polach, limity 429, logowanie od razu, ?pakiet=), potwierdzenie (GET nie
// zmienia, POST potwierdza, wygasly, cudzy token), logowanie e-mailem i loginem, blokada per
// konto, reset bez zdradzania kont (jednorazowy token, sesjeOd, admin wylaczony), zmiana adresu
// i hasla, wyloguj wszedzie, usuniecie (anulowanie przez kontrakt B, pliki konta i organizacji,
// konta_usuniete, Clear-Site-Data, odmowa przy bledzie anulowania), eksport bez hash/sol,
// ekrany bez skryptow, bez obcych zasobow i dlugich myslnikow, z CSP; ksztalt /api/konto.
// Kazdy serwer testowy na porcie 0 w katalogu tymczasowym (testy-wspolne.js).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { uruchomSerwer, HASLO } = require('./testy-wspolne.js');
const konta = require('./konta.js');
const limity = require('./limity.js');
const klucze = require('./klucze.js');
const platnosci = require('./platnosci.js');
const dzierzawy = require('./dzierzawy.js');
const plany = require('./plany.js');

const DLUGIE = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const DOBRE_HASLO = 'mocne-haslo-do-testu-42';

function srodowiskoRejestracji(dodatkowe = {}) {
  return {
    CAI_REJESTRACJA: '1', CAI_ADRES_PUBLICZNY: 'https://app.example.com',
    CAI_USLUGODAWCA_IMIE_NAZWISKO: 'Jan Testowy', CAI_USLUGODAWCA_ADRES: 'ul. Testowa 1, 00-001 Warszawa',
    CAI_USLUGODAWCA_EMAIL: 'kontakt@example.com', CAI_REGULAMIN_WERSJA: '2026-10-v1', CAI_POLITYKA_WERSJA: '2026-10-v1',
    CAI_KLUCZ_CIASTEK: crypto.randomBytes(32).toString('base64'),
    ...dodatkowe,
  };
}

let licznikIp = 0;
/** Kazda proba z innego adresu i innej sieci /24, zeby limity rejestracji nie mieszaly sie miedzy testami. */
function nowyIp() {
  licznikIp += 1;
  return `10.${Math.floor(licznikIp / 250) + 1}.${licznikIp % 250}.7`;
}

function ciasteczka(odp) {
  return odp.headers.getSetCookie ? odp.headers.getSetCookie() : [];
}

function ciasteczkoSesji(odp) {
  const c = ciasteczka(odp).find((x) => x.startsWith('cai_auth=') && !/Max-Age=0/.test(x));
  return c ? c.split(';')[0] : '';
}

function csrfZ(html) {
  const m = /name="csrf" value="([^"]+)"/.exec(html);
  return m ? m[1] : '';
}

/** Ekran serwera: bez skryptow, bez zasobow z obcych hostow (poza odnosnikami do content-ai.net), bez dlugich myslnikow. */
function czystyEkran(html) {
  const bezStrony = html.replace(/href="https:\/\/content-ai\.net[^"]*"/g, '');
  return !/<script/i.test(html) && !/(src|href)="https?:\/\//.test(bezStrony) && !DLUGIE.some((d) => html.includes(d));
}

function znacznik(t, wiekMs = 5000) {
  return konta.znacznikFormularza(t.srv.podpisz, Date.now() - wiekMs);
}

function zarejestruj(t, pola = {}, { ip = nowyIp(), naglowki = {} } = {}) {
  const dane = {
    jezyk: 'pl', t: znacznik(t), strona: '', email: 'ktos@firma.pl', haslo: DOBRE_HASLO,
    zgoda_regulamin: '1', zgoda_wiek: '1', ...pola,
  };
  for (const [k, v] of Object.entries(dane)) if (v === undefined) delete dane[k];
  return t.zadanie('/rejestracja', t.formularz(null, dane, { 'x-real-ip': ip, ...naglowki }));
}

/** Ostatni list z pliku poczty dla adresu i szablonu (tryb 'log', CAI_POCZTA_LOG). */
function ostatniList(t, adres, szablon) {
  return t.poczta().filter((w) => w.do === adres && (!szablon || w.szablon === szablon)).pop() || null;
}

function tokenZListu(list) {
  if (!list || !list.dane || !list.dane.odnosnik) return '';
  return new URL(list.dane.odnosnik).searchParams.get('t') || '';
}

/** Tresc odpowiedzi z twardymi spacjami zamienionymi na zwykle (akapit() wiaze jednoliterowe slowa). */
async function tekst(odp) {
  return (await odp.text()).replace(/&nbsp;/g, ' ');
}

// ─── Ustawienia domyslne: konta zespolu jak dzis ─────────────────────────────

async function testyDomyslne(sprawdz) {
  console.log('\n  konta (A1) - ustawienia domyslne: konta zespolu jak dzis');
  const t = await uruchomSerwer({ atrapaDostawcow: true });
  try {
    const pl = await tekst(await t.zadanie('/', { headers: { 'accept-language': 'pl-PL,pl;q=0.9' } }));
    const en = await tekst(await t.zadanie('/', { headers: { 'accept-language': 'en-GB,en;q=0.9' } }));
    sprawdz('logowanie: pole "E-mail lub login" i odnosnik "Nie pamietasz hasla?" (PL i EN)',
      pl.includes('E-mail lub login') && pl.includes('href="/haslo?lang=pl"') && pl.includes('Nie pamiętasz hasła?')
      && en.includes('Email or username') && en.includes('Forgot your password?') && en.includes('href="/haslo?lang=en"'));
    sprawdz('logowanie bez rejestracji: zostaje "Popros o dostep" i zdanie o administratorze, bez "Zaloz konto"',
      pl.includes('Poproś o dostęp') && pl.includes('Konto zakłada administrator') && !pl.includes('href="/rejestracja'));
    sprawdz('logowanie: pole przyjmuje e-mail (maxlength 254), nazwy pol bez zmian', /<input id="login" name="login"[^>]*maxlength="254"/.test(pl));
    const jezyk = async (naglowek) => {
      const h = await tekst(await t.zadanie('/', { headers: naglowek === null ? {} : { 'accept-language': naglowek } }));
      return (/<html lang="(\w+)"/.exec(h) || [])[1];
    };
    sprawdz('KOD8-26: przegladarka spoza PL/EN dostaje ekran po angielsku (jak aplikacja), polska i brak naglowka po polsku',
      await jezyk('de-DE,de;q=0.9') === 'en' && await jezyk('de-DE,de;q=0.9,pl;q=0.8') === 'en' && await jezyk('uk') === 'en'
      && await jezyk('pl') === 'pl' && await jezyk('pl-PL,en;q=0.5') === 'pl' && await jezyk(null) === 'pl'
      && await jezyk('en-US,pl;q=0.9') === 'en');

    const haslo = await t.zadanie('/haslo');
    const hasloHtml = await tekst(haslo);
    const hasloPost = await t.zadanie('/haslo', t.formularz(null, { email: 'kto@firma.pl' }));
    sprawdz('/haslo bez CAI_ADRES_PUBLICZNY: ekran "haslo zmienia administrator", bez formularza i bez wysylki',
      haslo.status === 200 && hasloHtml.includes('zmienia administrator') && !hasloHtml.includes('action="/haslo"')
      && hasloPost.status === 200 && t.poczta().length === 0 && czystyEkran(hasloHtml));

    const cStd = await t.zaloguj('standard');
    const api = await t.zadanie('/api/konto', { headers: { cookie: cStd } });
    const stan = await api.json();
    const surowe = JSON.stringify(stan);
    const kontoStd = t.magazyn.konto('standard');
    sprawdz('/api/konto konta zespolu: glowna, klucze serwera, bez wymaganej akceptacji, platnosci wylaczone, oznaczenia, csrf',
      api.status === 200 && stan.login === 'standard' && stan.pochodzenie === 'admin' && stan.zrodloKluczy === 'serwera'
      && stan.organizacja.id === 'glowna' && stan.zgody.regulamin.wymagaAkceptacji === false && stan.zgody.dotyczy === false
      && stan.platnosci.wlaczone === false && stan.oznaczenia.wersja === 1 && typeof stan.oznaczenia.uzytkownik.audio === 'boolean'
      && stan.mozliwosci.usuniecie === false && stan.mozliwosci.zmianaEmaila === false && stan.mozliwosci.zmianaHasla === true
      && typeof stan.csrf === 'string' && stan.csrf.length > 20 && stan.pakiet.plan === 'standard' && stan.adresy.konto === '/konto');
    sprawdz('/api/konto: bez hash i sol', !('hash' in stan) && !('sol' in stan) && !surowe.includes(kontoStd.hash) && !surowe.includes(kontoStd.sol));

    const ekran = await t.zadanie('/konto', { headers: { cookie: cStd } });
    const ekranHtml = await tekst(ekran);
    sprawdz('/konto konta zespolu: ekran bez skryptow z CSP i no-store; usuwa administrator; zmiana hasla tak, adresu nie (bez poczty)',
      ekran.status === 200 && czystyEkran(ekranHtml) && Boolean(ekran.headers.get('content-security-policy'))
      && ekran.headers.get('cache-control') === 'no-store' && ekranHtml.includes('usuwa je administrator')
      && ekranHtml.includes('action="/konto/haslo"') && !ekranHtml.includes('action="/konto/email"') && !ekranHtml.includes('href="/konto/usun'));
    const csrf = csrfZ(ekranHtml);
    const usun = await t.zadanie('/konto/usun', t.formularz(cStd, { csrf, haslo: HASLO, rozumiem: '1' }));
    sprawdz('konto zespolu nie usunie sie samo (CAI_USUWANIE_STARYCH=0, M-7)', usun.status === 403 && Boolean(t.magazyn.konto('standard')));

    const ust = await t.zadanie('/api/konto/ustawienia', t.json(cStd, { oznaczenia: { grafika: true } }));
    const ustJson = await ust.json();
    const zlePole = await t.zadanie('/api/konto/ustawienia', t.json(cStd, { oznaczenia: { wideo: true } }));
    const obcePole = await t.zadanie('/api/konto/ustawienia', t.json(cStd, { motyw: 'ciemny' }));
    sprawdz('POST /api/konto/ustawienia: wybor etykiety zapisany w koncie, nieznane pola 400',
      ust.status === 200 && ustJson.oznaczenia.uzytkownik.grafika === true && t.magazyn.konto('standard').oznaczenia.grafika === true
      && zlePole.status === 400 && (await zlePole.json()).pole === 'oznaczenia.wideo' && obcePole.status === 400);

    // Zmiana hasla z ekranu konta (konto zespolu): CSRF, zle stare haslo, nowe sesje.
    const zlyCsrf = await t.zadanie('/konto/haslo', t.formularz(cStd, { csrf: 'zly', stare: HASLO, nowe: DOBRE_HASLO }));
    const zleStare = await t.zadanie('/konto/haslo', t.formularz(cStd, { csrf, stare: 'nie-to-haslo-1', nowe: DOBRE_HASLO }));
    const slabe = await t.zadanie('/konto/haslo', t.formularz(cStd, { csrf, stare: HASLO, nowe: 'qwertyuiop' }));
    const ok = await t.zadanie('/konto/haslo', t.formularz(cStd, { csrf, stare: HASLO, nowe: DOBRE_HASLO }));
    const nowa = ciasteczkoSesji(ok);
    sprawdz('zmiana hasla: zly token CSRF 403, zle stare haslo i popularne nowe 400 z bledem przy polu',
      zlyCsrf.status === 403 && zleStare.status === 400 && (await tekst(zleStare)).includes('Niepoprawne hasło')
      && slabe.status === 400 && (await tekst(slabe)).includes('zbyt popularne'));
    sprawdz('zmiana hasla: 303 na /konto, nowa sesja tu, stara sesja i stare haslo niewazne, nowe dziala',
      ok.status === 303 && /^\/konto\?ok=haslo/.test(ok.headers.get('location')) && Boolean(nowa)
      && (await t.zadanie('/api/konto', { headers: { cookie: cStd } })).status === 401
      && (await t.zadanie('/api/konto', { headers: { cookie: nowa } })).status === 200
      && !(await t.zaloguj('standard')) && Boolean(await t.zaloguj('standard', DOBRE_HASLO)));

    // Logowanie e-mailem (konto zespolu z adresem dodanym przez administratora).
    t.magazyn.zmienKonto('premium', { email: 'premium@firma.pl', emailPotwierdzony: Date.now() });
    const zEmailem = await t.zaloguj('  Premium@Firma.PL ');
    const zleHaslo = await t.zadanie('/auth/login', t.formularz(null, { login: 'premium@firma.pl', haslo: 'zle-haslo-123', jezyk: 'pl' }, { 'x-real-ip': nowyIp() }));
    sprawdz('logowanie e-mailem (wielkosc liter i spacje bez znaczenia) i dalej loginem; blad bez zmiany tresci',
      Boolean(zEmailem) && Boolean(await t.zaloguj('premium')) && zleHaslo.status === 401
      && (await tekst(zleHaslo)).includes('Niepoprawny login lub hasło.'));

    const eksport = await t.zadanie('/konto/eksport', { headers: { cookie: zEmailem } });
    const eksportTekst = await tekst(eksport);
    const dane = JSON.parse(eksportTekst);
    const premium = t.magazyn.konto('premium');
    sprawdz('eksport konta zespolu: JSON do pobrania bez hash i sol, bez bazy wspolnej i marki zespolu',
      eksport.status === 200 && /attachment; filename="content-ai-dane-\d{4}-\d{2}-\d{2}\.json"/.test(eksport.headers.get('content-disposition') || '')
      && dane.konto.login === 'premium' && !('hash' in dane.konto) && !('sol' in dane.konto) && !eksportTekst.includes(premium.hash)
      && dane.bazaWiedzy.wspolna === null && dane.marka === null && Array.isArray(dane.zgody));

    const nieMa = await t.zadanie('/konto/nie-ma', { headers: { cookie: zEmailem } });
    const nieMaApi = await t.zadanie('/api/konto/nie-ma', { headers: { cookie: zEmailem } });
    const put = await t.zadanie('/api/konto', { method: 'PUT', headers: { cookie: zEmailem, 'Content-Type': 'application/json', ...t.zWlasnej }, body: '{}' });
    sprawdz('nieznane trasy konta 404 (HTML i JSON), zla metoda 405 z Allow',
      nieMa.status === 404 && nieMaApi.status === 404 && put.status === 405 && /GET/.test(put.headers.get('allow') || ''));

    // Licznik nieudanych prob per konto (ARCH8-05): z wielu adresow IP.
    const zle = async (login) => t.zadanie('/auth/login', t.formularz(null, { login, haslo: 'zle-haslo-12345' }, { 'x-real-ip': nowyIp() }));
    for (let i = 0; i < 20; i += 1) await zle('darmowy');
    const zablokowane = await t.zadanie('/auth/login', t.formularz(null, { login: 'darmowy', haslo: HASLO }, { 'x-real-ip': nowyIp() }));
    const zablokowaneHtml = await tekst(zablokowane);
    for (let i = 0; i < 20; i += 1) await zle('nie-ma-takiego');
    const nieistniejace = await t.zadanie('/auth/login', t.formularz(null, { login: 'nie-ma-takiego', haslo: HASLO }, { 'x-real-ip': nowyIp() }));
    sprawdz('blokada per konto: 20 nieudanych z roznych adresow -> 429 z propozycja resetu, takze dobre haslo; inne konto dziala',
      zablokowane.status === 429 && zablokowaneHtml.includes('ustaw nowe hasło') && Boolean(await t.zaloguj('admin')));
    sprawdz('blokada per konto: nieistniejacy login zachowuje sie tak samo (nie zdradza, ze konta nie ma)', nieistniejace.status === 429);
  } finally {
    await t.zamknij();
  }
}

// ─── Rejestracja ─────────────────────────────────────────────────────────────

async function testyRejestracji(sprawdz) {
  console.log('\n  konta (A1) - rejestracja');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji(), atrapaDostawcow: true });
  try {
    const logowanie = await tekst(await t.zadanie('/', { headers: { 'accept-language': 'pl' } }));
    sprawdz('logowanie przy otwartej rejestracji: "Zaloz konto" zamiast "Popros o dostep", bez zdania o administratorze, stopka o kluczu',
      logowanie.includes('href="/rejestracja?lang=pl"') && logowanie.includes('Załóż konto') && !logowanie.includes('Poproś o dostęp')
      && !logowanie.includes('Konto zakłada administrator') && logowanie.includes('Zaloguj się adresem e-mail i hasłem.')
      && logowanie.includes('Twój klucz API zapisuje tylko Twoja przeglądarka.'));

    const form = await t.zadanie('/rejestracja', { headers: { 'accept-language': 'pl' } });
    const html = await tekst(form);
    const csp = form.headers.get('content-security-policy') || '';
    sprawdz('GET /rejestracja: formularz bez skryptow i obcych zasobow, z CSP (bez ramek) i no-store',
      form.status === 200 && czystyEkran(html) && csp.includes("frame-src 'none'") && csp.includes("form-action 'self'")
      && form.headers.get('cache-control') === 'no-store' && /<html lang="pl"/.test(html));
    sprawdz('GET /rejestracja: pola e-mail, haslo, dwie osobne zgody niezaznaczone, pulapka, podpisany znacznik czasu',
      /<form method="POST" action="\/rejestracja"/.test(html) && /<input id="email" name="email" type="email"/.test(html)
      && /<input id="haslo" name="haslo" type="password" autocomplete="new-password"/.test(html)
      && /name="zgoda_regulamin" value="1">/.test(html) && /name="zgoda_wiek" value="1">/.test(html) && !/checked/.test(html)
      && /class="pulapka" aria-hidden="true"/.test(html) && /name="strona"/.test(html) && /name="t" value="\d+\.[A-Za-z0-9_-]+"/.test(html));
    sprawdz('GET /rejestracja: odnosniki do regulaminu i polityki z modulu E, administrator danych z konfiguracji, 3 darmowe artykuly',
      html.includes('href="/dokumenty/regulamin?lang=pl"') && html.includes('href="/dokumenty/prywatnosc?lang=pl"')
      && html.includes('Administratorem Twoich danych jest Jan Testowy') && html.includes('3 artykuły') && html.includes('Mam ukończone 18 lat.'));
    const formEn = await tekst(await t.zadanie('/rejestracja?lang=en&pakiet=standard'));
    sprawdz('GET /rejestracja?lang=en: po angielsku, przelacznik jezyka zachowuje pakiet; bez platnosci bez obietnicy Stripe',
      /<html lang="en"/.test(formEn) && formEn.includes('Create your account') && formEn.includes('href="/rejestracja?lang=pl&amp;pakiet=standard"')
      && formEn.includes('name="pakiet" value="standard"') && !formEn.includes('Stripe'));

    const obce = await zarejestruj(t, { email: 'obca@firma.pl' }, { naglowki: { origin: 'https://zly.example', 'sec-fetch-site': 'cross-site' } });
    sprawdz('rejestracja z obcej strony: 403 (strona HTML), konto nie powstaje',
      obce.status === 403 && /<html/.test(await tekst(obce)) && !t.magazyn.kontoPoEmailu('obca@firma.pl'));

    const pulapka = await zarejestruj(t, { email: 'bot@firma.pl', strona: 'https://spam.example' });
    const wyslano = await tekst(await t.zadanie(pulapka.headers.get('location') || '/'));
    sprawdz('pole-pulapka: udawany sukces (303 na "sprawdz skrzynke"), bez konta i bez e-maila',
      pulapka.status === 303 && /^\/rejestracja\?wyslano=1/.test(pulapka.headers.get('location')) && wyslano.includes('Sprawdź skrzynkę')
      && !t.magazyn.kontoPoEmailu('bot@firma.pl') && t.poczta().length === 0);

    const bezZnacznika = await zarejestruj(t, { email: 'anna@firma.pl', t: undefined });
    const bezZnacznikaHtml = await tekst(bezZnacznika);
    const szybko = await zarejestruj(t, { email: 'anna@firma.pl', t: znacznik(t, 0) });
    const stary = await zarejestruj(t, { email: 'anna@firma.pl', t: znacznik(t, 3 * 3600_000) });
    const podrobiony = await zarejestruj(t, { email: 'anna@firma.pl', t: `${Date.now() - 5000}.${'A'.repeat(43)}` });
    sprawdz('znacznik czasu: brak, podrobiony, wyslany po < 3 s albo > 2 h -> 400 z formularzem (e-mail wraca, haslo nie)',
      bezZnacznika.status === 400 && bezZnacznikaHtml.includes('Formularz wygasł') && bezZnacznikaHtml.includes('value="anna@firma.pl"')
      && !/<input id="haslo"[^>]*value=/.test(bezZnacznikaHtml) && szybko.status === 400 && (await tekst(szybko)).includes('wyślij formularz jeszcze raz')
      && stary.status === 400 && podrobiony.status === 400 && !t.magazyn.kontoPoEmailu('anna@firma.pl'));

    const zleDane = await zarejestruj(t, { email: 'anna@firma', haslo: 'krotkie', zgoda_regulamin: undefined, zgoda_wiek: undefined });
    const zleHtml = await tekst(zleDane);
    sprawdz('walidacja: bledy przy polach (aria-invalid, aria-describedby), komunikat w aria-live, konto nie powstaje',
      zleDane.status === 400 && /<input id="email"[^>]*aria-invalid="true" aria-describedby="email-b"/.test(zleHtml)
      && /id="email-b">Wpisz adres e-mail/.test(zleHtml) && /id="haslo-b">Hasło musi mieć co najmniej 10 znaków/.test(zleHtml)
      && /id="zgoda_regulamin-b">Zaznacz akceptację regulaminu/.test(zleHtml) && /id="zgoda_wiek-b">Zaznacz, że masz ukończone 18 lat/.test(zleHtml)
      && /role="alert" aria-live="assertive">.*Popraw zaznaczone pola/.test(zleHtml) && t.magazyn.listaKont().length === 4);
    const jakEmail = await zarejestruj(t, { email: 'anna@firma.pl', haslo: 'ANNA@firma.pl' });
    const popularne = await zarejestruj(t, { email: 'anna@firma.pl', haslo: '1234567890' });
    sprawdz('haslo takie jak e-mail albo z listy najczestszych: 400 z bledem przy polu',
      jakEmail.status === 400 && (await tekst(jakEmail)).includes('takie samo jak adres e-mail')
      && popularne.status === 400 && (await tekst(popularne)).includes('zbyt popularne'));

    const ok = await zarejestruj(t, { email: '  Anna.Kowalska@Firma.PL ' });
    const cookie = ciasteczkoSesji(ok);
    const surowe = ciasteczka(ok).find((c) => c.startsWith('cai_auth=')) || '';
    const konto = t.magazyn.kontoPoEmailu('anna.kowalska@firma.pl');
    sprawdz('rejestracja: 303 do aplikacji i od razu zalogowane ciasteczko HttpOnly SameSite=Lax',
      ok.status === 303 && ok.headers.get('location') === '/' && Boolean(cookie) && /HttpOnly/.test(surowe) && /SameSite=Lax/.test(surowe));
    sprawdz('rejestracja: konto k-... w nowej organizacji o-... (wlasciciel), samoobsluga, klucze wlasne, plan nowych, niepotwierdzone',
      Boolean(konto) && /^k-[a-z2-7]{12}$/.test(konto.login) && /^o-[a-z2-7]{12}$/.test(konto.organizacja) && konto.rolaWOrganizacji === 'wlasciciel'
      && konto.pochodzenie === 'samoobsluga' && konto.zrodloKluczy === 'wlasne' && konto.plan === null && konto.emailPotwierdzony === null
      && konto.rola === 'uzytkownik' && konto.jezyk === 'pl' && plany.planEfektywny(konto) === 'darmowy');
    const zgody = t.magazyn.zgody(konto.login);
    sprawdz('rejestracja: zgody z wersja i czasem (regulamin, polityka, pelnoletnosc), stan regulaminu w koncie, bez IP (CAI_ZGODY_IP=0)',
      zgody.length === 3 && zgody.every((z) => z.zrodlo === 'rejestracja' && z.wartosc === true && z.ip === null && z.czas > 0)
      && zgody.find((z) => z.rodzaj === 'regulamin').wersja === '2026-10-v1' && zgody.find((z) => z.rodzaj === 'polityka').wersja === '2026-10-v1'
      && Boolean(zgody.find((z) => z.rodzaj === 'pelnoletnosc')) && konto.regulaminWersja === '2026-10-v1' && konto.regulaminCzas > 0);
    const list = ostatniList(t, 'anna.kowalska@firma.pl', 'potwierdzenie');
    const token = tokenZListu(list);
    const plikiBazy = [t.KONF.sqlite, `${t.KONF.sqlite}-wal`].filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p));
    sprawdz('rejestracja: e-mail z linkiem z CAI_ADRES_PUBLICZNY, w bazie tylko skrot tokenu',
      Boolean(list) && list.jezyk === 'pl' && list.dane.odnosnik.startsWith('https://app.example.com/potwierdz?t=') && /&lang=pl$/.test(list.dane.odnosnik)
      && token.length >= 40 && Boolean(t.magazyn.sprawdzToken(token, 'potwierdzenie'))
      && plikiBazy.length > 0 && !plikiBazy.some((b) => b.includes(token)) && plikiBazy.some((b) => b.includes(t.magazyn.skrotTokenu(token))));
    const me = await (await t.zadanie('/auth/me', { headers: { cookie } })).json();
    const stan = await (await t.zadanie('/api/konto', { headers: { cookie } })).json();
    sprawdz('po rejestracji: /auth/me i /api/konto (niepotwierdzony, link wyslany, darmowy na wlasnym kluczu, zgody aktualne)',
      me.login === konto.login && me.email === 'anna.kowalska@firma.pl' && stan.emailPotwierdzony === false && stan.potwierdzenie.wyslano === true
      && stan.pakiet.plan === 'darmowy' && stan.zrodloKluczy === 'wlasne' && stan.zgody.regulamin.wersja === '2026-10-v1'
      && stan.zgody.regulamin.wymagaAkceptacji === false && stan.zgody.polityka.wersja === '2026-10-v1' && stan.organizacja.mozeZarzadzac === true
      && stan.uslugodawca.nazwa === 'Jan Testowy' && stan.mozliwosci.usuniecie === true);

    const znowu = await zarejestruj(t, { email: 'ANNA.KOWALSKA@firma.pl' });
    sprawdz('ten sam adres drugi raz (inna wielkosc liter): 400 z komunikatem przy polu, jedno konto',
      znowu.status === 400 && (await tekst(znowu)).includes('Ten adres ma już konto') && t.magazyn.listaKont({ pochodzenie: 'samoobsluga' }).length === 1);

    const zPakietem = await zarejestruj(t, { email: 'pakiet@firma.pl', pakiet: 'standard' });
    sprawdz('?pakiet=standard bez wlaczonych platnosci: po rejestracji do aplikacji (nie na ekran zakupu)',
      zPakietem.status === 303 && zPakietem.headers.get('location') === '/');
    const zalogowany = await t.zadanie('/rejestracja?pakiet=premium', { headers: { cookie } });
    sprawdz('zalogowany na /rejestracja: przekierowanie do aplikacji', zalogowany.status === 303 && zalogowany.headers.get('location') === '/');

    // Limity: 5 na godzine z adresu, 20 na dobe z sieci /24 (liczone po walidacji, takze adres zajety).
    const ipA = '198.51.100.10';
    const wyniki = [];
    for (let i = 0; i < 6; i += 1) wyniki.push(await zarejestruj(t, { email: 'anna.kowalska@firma.pl' }, { ip: ipA }));
    const szosty = wyniki[5];
    const szostyHtml = await tekst(szosty);
    sprawdz('limit z adresu: 5 prob na godzine, szosta 429 z Retry-After i komunikatem; z innego adresu dalej mozna',
      wyniki.slice(0, 5).every((o) => o.status === 400) && szosty.status === 429 && Number(szosty.headers.get('retry-after')) > 0
      && szostyHtml.includes('Za dużo prób z tego adresu') && (await zarejestruj(t, { email: 'anna.kowalska@firma.pl' })).status === 400);
    for (let i = 1; i <= 20; i += 1) await zarejestruj(t, { email: 'anna.kowalska@firma.pl' }, { ip: `203.0.113.${i}` });
    const siec = await zarejestruj(t, { email: 'nowa-z-sieci@firma.pl' }, { ip: '203.0.113.99' });
    sprawdz('limit z sieci /24: 20 na dobe, kolejna proba z tej sieci 429 i konto nie powstaje',
      siec.status === 429 && !t.magazyn.kontoPoEmailu('nowa-z-sieci@firma.pl'));
  } finally {
    await t.zamknij();
  }
}

// ─── Turnstile (opcja) i tryb bramy ──────────────────────────────────────────

async function testyTurnstileIBramy(sprawdz) {
  console.log('\n  konta (A1) - Cloudflare Turnstile (opcja) i tryb bramy');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji({ CAI_TURNSTILE_KLUCZ: '1x00000000000000000000AA', CAI_TURNSTILE_SEKRET: 'sekret-turnstile' }) });
  const pierwotny = global.fetch;
  const weryfikacje = [];
  global.fetch = async (adres, opcje) => {
    if (String(adres).startsWith('https://challenges.cloudflare.com/')) {
      const p = new URLSearchParams(String(opcje && opcje.body));
      weryfikacje.push(Object.fromEntries(p));
      return new Response(JSON.stringify({ success: p.get('response') === 'dobry-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return pierwotny(adres, opcje);
  };
  try {
    const form = await t.zadanie('/rejestracja');
    const html = await tekst(form);
    const csp = form.headers.get('content-security-policy') || '';
    sprawdz('Turnstile wlaczony: widzet i skrypt Cloudflare tylko na tym ekranie, CSP z challenges.cloudflare.com w script-src i frame-src',
      html.includes('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"') && /class="pole cf-turnstile" data-sitekey="1x0+AA"/.test(html)
      && /script-src 'self' https:\/\/challenges\.cloudflare\.com/.test(csp) && /frame-src https:\/\/challenges\.cloudflare\.com/.test(csp)
      && !/challenges/.test((await t.zadanie('/')).headers.get('content-security-policy') || ''));
    const bez = await zarejestruj(t, { email: 'tsbez@firma.pl' });
    const zly = await zarejestruj(t, { email: 'tszly@firma.pl', 'cf-turnstile-response': 'zly-token' });
    const dobry = await zarejestruj(t, { email: 'tsok@firma.pl', 'cf-turnstile-response': 'dobry-token' });
    sprawdz('Turnstile: bez odpowiedzi i ze zla 400 (bez konta), z dobra konto powstaje; serwer weryfikuje sekretem',
      bez.status === 400 && (await tekst(bez)).includes('wysyła człowiek') && zly.status === 400 && !t.magazyn.kontoPoEmailu('tszly@firma.pl')
      && dobry.status === 303 && Boolean(t.magazyn.kontoPoEmailu('tsok@firma.pl')) && weryfikacje.length === 2
      && weryfikacje.every((w) => w.secret === 'sekret-turnstile'));
  } finally {
    global.fetch = pierwotny;
    await t.zamknij();
  }

  const b = await uruchomSerwer({ srodowisko: srodowiskoRejestracji({ CAI_ZAUFANY_NAGLOWEK: 'x-uzytkownik' }) });
  try {
    const rej = await tekst(await b.zadanie('/rejestracja'));
    const haslo = await tekst(await b.zadanie('/haslo'));
    sprawdz('tryb bramy: rejestracja wylaczona (konfiguracja), /rejestracja i /haslo daja ekran logowania bez odnosnikow kont',
      !b.KONF.funkcje.rejestracja.wlaczona && /name="login"/.test(rej) && /name="login"/.test(haslo)
      && !rej.includes('href="/haslo') && !rej.includes('href="/rejestracja'));
  } finally {
    await b.zamknij();
  }
}

// ─── Potwierdzenie adresu, ponowienie, bramka zasobow serwera ────────────────

async function testyPotwierdzenia(sprawdz) {
  console.log('\n  konta (A1) - potwierdzenie adresu (przycisk POST), ponowienie, zasoby serwera po potwierdzeniu');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji(), atrapaDostawcow: true });
  try {
    const odp = await zarejestruj(t, { email: 'ola@firma.pl' });
    const cookie = ciasteczkoSesji(odp);
    const login = t.magazyn.kontoPoEmailu('ola@firma.pl').login;
    const token = tokenZListu(ostatniList(t, 'ola@firma.pl', 'potwierdzenie'));

    const strona = await t.zadanie('/api/strona', t.json(cookie, { adres: 'https://example.com/' }));
    const strJson = await strona.json();
    const odnosniki = await t.zadanie('/api/odnosniki', t.json(cookie, { adresy: ['https://example.com/'] }));
    const cStd = await t.zaloguj('standard');
    const zespol = await t.zadanie('/api/strona', t.json(cStd, { adres: '' }));
    sprawdz('przed potwierdzeniem: pobieranie stron i sprawdzanie odnosnikow 403 email-niepotwierdzony; konta zespolu bez bramki',
      strona.status === 403 && strona.headers.get('x-cai-kod') === 'email-niepotwierdzony' && strJson.akcja === 'strony'
      && odnosniki.status === 403 && zespol.status !== 403);

    const get = await t.zadanie(`/potwierdz?t=${token}`);
    const getHtml = await tekst(get);
    await t.zadanie(`/potwierdz?t=${token}`);
    sprawdz('GET /potwierdz: ekran z przyciskiem POST (skaner poczty niczego nie potwierdza), adres niepotwierdzony',
      get.status === 200 && czystyEkran(getHtml) && /<form method="POST" action="\/potwierdz">/.test(getHtml)
      && getHtml.includes(`name="t" value="${token}"`) && getHtml.includes('Potwierdź adres') && t.magazyn.konto(login).emailPotwierdzony === null);
    const obce = await t.zadanie('/potwierdz', t.formularz(null, { t: token }, { origin: 'https://zly.example', 'sec-fetch-site': 'cross-site' }));
    sprawdz('POST /potwierdz z obcej strony: 403, adres dalej niepotwierdzony', obce.status === 403 && t.magazyn.konto(login).emailPotwierdzony === null);
    const post = await t.zadanie('/potwierdz', t.formularz(null, { t: token }));
    const postHtml = await tekst(post);
    const drugi = await t.zadanie('/potwierdz', t.formularz(null, { t: token }));
    const poGet = await tekst(await t.zadanie(`/potwierdz?t=${token}`));
    sprawdz('POST /potwierdz: adres potwierdzony; drugi raz i GET po uzyciu: "adres jest juz potwierdzony" (idempotentnie)',
      post.status === 200 && postHtml.includes('Adres potwierdzony') && t.magazyn.konto(login).emailPotwierdzony > 0
      && drugi.status === 200 && (await tekst(drugi)).includes('już potwierdzony') && poGet.includes('już potwierdzony'));
    const poStrona = await t.zadanie('/api/strona', t.json(cookie, { adres: '' }));
    sprawdz('po potwierdzeniu: zasoby serwera przechodza dalej (bez bramki e-maila)', poStrona.status !== 403);

    const losowy = await t.zadanie('/potwierdz', t.formularz(null, { t: crypto.randomBytes(32).toString('base64url') }));
    const pusty = await tekst(await t.zadanie('/potwierdz'));
    const wygasly = t.magazyn.zapiszToken({ login, rodzaj: 'potwierdzenie', email: 'ola@firma.pl', wazneMs: 3600_000, teraz: Date.now() - 2 * 3600_000 });
    const resetowy = t.magazyn.zapiszToken({ login, rodzaj: 'reset', email: 'ola@firma.pl', wazneMs: 3600_000 });
    sprawdz('losowy, pusty, wygasly i token innego rodzaju (reset) na /potwierdz: "link niewazny"',
      losowy.status === 400 && (await tekst(losowy)).includes('Link nieważny') && pusty.includes('Link nieważny')
      && (await tekst(await t.zadanie(`/potwierdz?t=${wygasly}`))).includes('Link nieważny')
      && (await tekst(await t.zadanie(`/potwierdz?t=${resetowy}`))).includes('Link nieważny'));

    // Ponowienie: limit odstepu (wysylka przy rejestracji sie liczy), nowy link uniewaznia poprzedni.
    const drugie = await zarejestruj(t, { email: 'piotr@firma.pl' });
    const cPiotr = ciasteczkoSesji(drugie);
    const pierwszyToken = tokenZListu(ostatniList(t, 'piotr@firma.pl', 'potwierdzenie'));
    const ekran = await tekst(await t.zadanie('/konto', { headers: { cookie: cPiotr } }));
    const csrf = csrfZ(ekran);
    const zaSzybko = await t.zadanie('/konto/potwierdzenie', t.formularz(cPiotr, { csrf }));
    const apiZaSzybko = await t.zadanie('/api/konto/potwierdzenie', t.json(cPiotr, {}));
    sprawdz('ponowienie zaraz po rejestracji: odmowa z czasem oczekiwania (formularz: komunikat, API: 429 za-duzo-prob z ponowZa)',
      ekran.includes('action="/konto/potwierdzenie"') && zaSzybko.status === 303 && /blad=ponow&za=\d+/.test(zaSzybko.headers.get('location'))
      && apiZaSzybko.status === 429 && apiZaSzybko.headers.get('x-cai-kod') === 'za-duzo-prob' && (await apiZaSzybko.json()).ponowZa > 0);
    limity.wyzerujWszystkie();
    const ponow = await t.zadanie('/konto/potwierdzenie', t.formularz(cPiotr, { csrf }));
    const nowyToken = tokenZListu(ostatniList(t, 'piotr@firma.pl', 'potwierdzenie'));
    const zlyCsrf = await t.zadanie('/konto/potwierdzenie', t.formularz(cPiotr, { csrf: 'nie' }));
    sprawdz('ponowienie: nowy e-mail, poprzedni link niewazny, nowy dziala; bez tokenu CSRF 403',
      ponow.status === 303 && /ok=potwierdzenie/.test(ponow.headers.get('location')) && Boolean(nowyToken) && nowyToken !== pierwszyToken
      && (await tekst(await t.zadanie(`/potwierdz?t=${pierwszyToken}`))).includes('Link nieważny')
      && (await tekst(await t.zadanie(`/potwierdz?t=${nowyToken}`))).includes('name="t"') && zlyCsrf.status === 403);
  } finally {
    await t.zamknij();
  }
}

// ─── Reset hasla ─────────────────────────────────────────────────────────────

async function testyResetu(sprawdz) {
  console.log('\n  konta (A1) - reset hasla (ta sama odpowiedz, jednorazowy token, sesjeOd, admin wylaczony)');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji(), atrapaDostawcow: true });
  const pierwotneCiasteczka = klucze.ciasteczkaUsuwajace;
  try {
    const rej = await zarejestruj(t, { email: 'ewa@firma.pl' });
    const cStara = ciasteczkoSesji(rej);
    const login = t.magazyn.kontoPoEmailu('ewa@firma.pl').login;

    const form = await t.zadanie('/haslo');
    const formHtml = await tekst(form);
    sprawdz('GET /haslo: formularz e-maila bez skryptow, z informacja dla kont zespolu',
      form.status === 200 && czystyEkran(formHtml) && /<form method="POST" action="\/haslo"/.test(formHtml) && formHtml.includes('Nowe hasło ustawia administrator'));

    const jest = await t.zadanie('/haslo', t.formularz(null, { email: 'ewa@firma.pl' }, { 'x-real-ip': nowyIp() }));
    const jestHtml = await tekst(jest);
    const nieMa = await t.zadanie('/haslo', t.formularz(null, { email: 'nikt@firma.pl' }, { 'x-real-ip': nowyIp() }));
    const nieMaHtml = await tekst(nieMa);
    await konta.czekajNaTlo();
    const listy = t.poczta().filter((w) => w.szablon === 'reset');
    sprawdz('POST /haslo: ta sama odpowiedz dla istniejacego i nieistniejacego adresu, e-mail tylko dla istniejacego',
      jest.status === 200 && nieMa.status === 200 && jestHtml.replace('ewa@firma.pl', 'X') === nieMaHtml.replace('nikt@firma.pl', 'X')
      && jestHtml.includes('Jeśli pod adresem') && listy.length === 1 && listy[0].do === 'ewa@firma.pl'
      && listy[0].dane.odnosnik.startsWith('https://app.example.com/haslo/nowe?t='));
    const token = tokenZListu(listy[0]);

    t.magazyn.zmienKonto('admin', { email: 'admin@firma.pl', emailPotwierdzony: Date.now() });
    await t.zadanie('/haslo', t.formularz(null, { email: 'admin@firma.pl' }, { 'x-real-ip': nowyIp() }));
    await konta.czekajNaTlo();
    const adminBez = t.poczta().filter((w) => w.do === 'admin@firma.pl').length;
    t.KONF.resetAdmin = true;
    await t.zadanie('/haslo', t.formularz(null, { email: 'admin@firma.pl' }, { 'x-real-ip': nowyIp() }));
    await konta.czekajNaTlo();
    t.KONF.resetAdmin = false;
    sprawdz('reset konta admin: domyslnie bez wysylki (CAI_RESET_ADMIN=0), przy CAI_RESET_ADMIN=1 link wychodzi',
      adminBez === 0 && t.poczta().filter((w) => w.do === 'admin@firma.pl').length === 1);

    for (let i = 0; i < 3; i += 1) await t.zadanie('/haslo', t.formularz(null, { email: 'limit@firma.pl' }, { 'x-real-ip': nowyIp() }));
    t.magazyn.zmienKonto('premium', { email: 'limit@firma.pl', emailPotwierdzony: Date.now() });
    const czwarty = await t.zadanie('/haslo', t.formularz(null, { email: 'limit@firma.pl' }, { 'x-real-ip': nowyIp() }));
    await konta.czekajNaTlo();
    const ipLimit = '192.0.2.44';
    const zIp = [];
    for (let i = 0; i < 6; i += 1) zIp.push(await t.zadanie('/haslo', t.formularz(null, { email: `ip${i}@firma.pl` }, { 'x-real-ip': ipLimit })));
    sprawdz('limity resetu: 3 na godzine na adres (czwarty ta sama odpowiedz, bez e-maila), 5 na godzine z IP (szosty 429)',
      czwarty.status === 200 && t.poczta().filter((w) => w.do === 'limit@firma.pl').length === 0
      && zIp.slice(0, 5).every((o) => o.status === 200) && zIp[5].status === 429);

    const get1 = await t.zadanie(`/haslo/nowe?t=${token}`);
    const get1Html = await tekst(get1);
    await t.zadanie(`/haslo/nowe?t=${token}`);
    sprawdz('GET /haslo/nowe: formularz z ukrytym tokenem, GET nie zuzywa tokenu',
      get1.status === 200 && czystyEkran(get1Html) && get1Html.includes(`name="t" value="${token}"`) && get1Html.includes('Konto: ewa@firma.pl')
      && Boolean(t.magazyn.sprawdzToken(token, 'reset')));
    const krotkie = await t.zadanie('/haslo/nowe', t.formularz(null, { t: token, haslo: 'krotkie' }));
    sprawdz('POST /haslo/nowe ze zlym haslem: 400 przy polu, token dalej wazny',
      krotkie.status === 400 && (await tekst(krotkie)).includes('co najmniej 10 znaków') && Boolean(t.magazyn.sprawdzToken(token, 'reset')));

    // Blokada logowania na konto: reset dziala mimo niej i ja zdejmuje.
    for (let i = 0; i < 20; i += 1) await t.zadanie('/auth/login', t.formularz(null, { login: 'ewa@firma.pl', haslo: 'zle-haslo-12345' }, { 'x-real-ip': nowyIp() }));
    const zablokowane = await t.zadanie('/auth/login', t.formularz(null, { login: 'ewa@firma.pl', haslo: DOBRE_HASLO }, { 'x-real-ip': nowyIp() }));
    klucze.ciasteczkaUsuwajace = () => ['cai_klucz_anthropic=; HttpOnly; Path=/; Max-Age=0'];
    const nowe = await t.zadanie('/haslo/nowe', t.formularz(null, { t: token, haslo: 'zupelnie-nowe-haslo-7' }));
    const cNowa = ciasteczkoSesji(nowe);
    const ponownie = await t.zadanie('/haslo/nowe', t.formularz(null, { t: token, haslo: 'jeszcze-inne-haslo-8' }));
    await konta.czekajNaTlo();
    sprawdz('reset: 303 do aplikacji z nowa sesja i kasowaniem zapamietanych kluczy; token jednorazowy',
      zablokowane.status === 429 && nowe.status === 303 && nowe.headers.get('location') === '/' && Boolean(cNowa)
      && ciasteczka(nowe).some((c) => c.startsWith('cai_klucz_anthropic=') && /Max-Age=0/.test(c))
      && ponownie.status === 400 && (await tekst(ponownie)).includes('Link nieważny'));
    sprawdz('reset: stare sesje niewazne (sesjeOd), stare haslo nie dziala, nowe tak (blokada zdjeta), adres potwierdzony, e-mail o zmianie',
      (await t.zadanie('/api/konto', { headers: { cookie: cStara } })).status === 401 && (await t.zadanie('/api/konto', { headers: { cookie: cNowa } })).status === 200
      && !(await t.zaloguj('ewa@firma.pl', DOBRE_HASLO)) && Boolean(await t.zaloguj('ewa@firma.pl', 'zupelnie-nowe-haslo-7'))
      && t.magazyn.konto(login).emailPotwierdzony > 0 && Boolean(ostatniList(t, 'ewa@firma.pl', 'haslo-zmienione')));
    const obce = await t.zadanie('/haslo/nowe', t.formularz(null, { t: token, haslo: 'zupelnie-nowe-haslo-9' }, { origin: 'https://zly.example', 'sec-fetch-site': 'cross-site' }));
    sprawdz('POST /haslo/nowe z obcej strony: 403', obce.status === 403);
  } finally {
    klucze.ciasteczkaUsuwajace = pierwotneCiasteczka;
    await t.zamknij();
  }
}

// ─── Ekran konta: adres, wyloguj wszedzie, eksport, zgody ────────────────────

async function testyKonta(sprawdz) {
  console.log('\n  konta (A1) - ekran konta: zmiana adresu, wyloguj wszedzie, eksport, nowa wersja regulaminu');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji(), atrapaDostawcow: true });
  const pierwotneCiasteczka = klucze.ciasteczkaUsuwajace;
  try {
    const rej = await zarejestruj(t, { email: 'maja@firma.pl' });
    let cookie = ciasteczkoSesji(rej);
    const login = t.magazyn.kontoPoEmailu('maja@firma.pl').login;
    await t.zadanie('/potwierdz', t.formularz(null, { t: tokenZListu(ostatniList(t, 'maja@firma.pl', 'potwierdzenie')) }));
    await zarejestruj(t, { email: 'zajety@firma.pl' });

    const ekran = await t.zadanie('/konto', { headers: { cookie } });
    const html = await tekst(ekran);
    const csrf = csrfZ(html);
    sprawdz('/konto (samoobsluga): adres potwierdzony, formularze konta z tokenem CSRF, eksport i usuniecie, bez skryptow',
      ekran.status === 200 && czystyEkran(html) && html.includes('maja@firma.pl') && html.includes('potwierdzony') && Boolean(csrf)
      && ['action="/konto/email"', 'action="/konto/haslo"', 'action="/konto/wyloguj-wszedzie"', 'href="/konto/eksport"', 'href="/konto/usun?lang=pl"']
        .every((x) => html.includes(x)) && html.includes('Twój klucz API zapisuje tylko Twoja przeglądarka.'));

    const resetPrzedZmiana = t.magazyn.zapiszToken({ login, rodzaj: 'reset', email: 'maja@firma.pl', wazneMs: 3600_000 });
    const zlyCsrf = await t.zadanie('/konto/email', t.formularz(cookie, { csrf: 'x', nowy: 'maja.nowa@firma.pl', haslo: DOBRE_HASLO }));
    const zleHaslo = await t.zadanie('/konto/email', t.formularz(cookie, { csrf, nowy: 'maja.nowa@firma.pl', haslo: 'nie-to-haslo-12' }));
    const zajety = await t.zadanie('/konto/email', t.formularz(cookie, { csrf, nowy: 'Zajety@Firma.pl', haslo: DOBRE_HASLO }));
    const takiSam = await t.zadanie('/konto/email', t.formularz(cookie, { csrf, nowy: 'maja@firma.pl', haslo: DOBRE_HASLO }));
    sprawdz('zmiana adresu: bez CSRF 403, zle haslo, adres zajety i ten sam adres 400 z bledem przy polu',
      zlyCsrf.status === 403 && zleHaslo.status === 400 && (await tekst(zleHaslo)).includes('Niepoprawne hasło')
      && zajety.status === 400 && (await tekst(zajety)).includes('Ten adres ma już konto') && takiSam.status === 400);
    const zmiana = await t.zadanie('/konto/email', t.formularz(cookie, { csrf, nowy: 'Maja.Nowa@firma.pl', haslo: DOBRE_HASLO }));
    const listNowy = ostatniList(t, 'maja.nowa@firma.pl', 'zmiana-email');
    await konta.czekajNaTlo();
    sprawdz('zmiana adresu: link na nowy adres, informacja na stary, do potwierdzenia logowanie starym adresem',
      zmiana.status === 303 && /ok=email/.test(zmiana.headers.get('location')) && t.magazyn.konto(login).emailNowy === 'maja.nowa@firma.pl'
      && Boolean(listNowy) && listNowy.dane.odnosnik.startsWith('https://app.example.com/potwierdz?t=')
      && Boolean(ostatniList(t, 'maja@firma.pl', 'zmiana-email-info')) && Boolean(await t.zaloguj('maja@firma.pl', DOBRE_HASLO)));
    const tokenZmiany = tokenZListu(listNowy);
    const potw = await t.zadanie('/potwierdz', t.formularz(null, { t: tokenZmiany }));
    const potwHtml = await tekst(potw);
    const k = t.magazyn.konto(login);
    sprawdz('potwierdzenie nowego adresu: adres zmieniony, nowym sie loguje, starym nie; link resetu wyslany na stary adres niewazny',
      potw.status === 200 && potwHtml.includes('Adres zmieniony') && k.email === 'maja.nowa@firma.pl' && k.emailNowy === null && k.emailPotwierdzony > 0
      && Boolean(await t.zaloguj('maja.nowa@firma.pl', DOBRE_HASLO)) && !(await t.zaloguj('maja@firma.pl', DOBRE_HASLO))
      && !t.magazyn.sprawdzToken(resetPrzedZmiana, 'reset'));

    const niepotw = await zarejestruj(t, { email: 'niepotw@firma.pl' });
    const cNiepotw = ciasteczkoSesji(niepotw);
    const csrfNiepotw = csrfZ(await tekst(await t.zadanie('/konto', { headers: { cookie: cNiepotw } })));
    const odmowa = await t.zadanie('/konto/email', t.formularz(cNiepotw, { csrf: csrfNiepotw, nowy: 'inny@firma.pl', haslo: DOBRE_HASLO }));
    sprawdz('zmiana adresu przed potwierdzeniem obecnego: 403 z komunikatem, bez zmiany',
      odmowa.status === 403 && (await tekst(odmowa)).includes('Najpierw potwierdź obecny adres') && !t.magazyn.kontoPoEmailu('niepotw@firma.pl').emailNowy);

    // Wyloguj wszedzie: obie sesje odciete, ciasteczko i zapamietane klucze skasowane.
    cookie = await t.zaloguj('maja.nowa@firma.pl', DOBRE_HASLO);
    const druga = await t.zaloguj('maja.nowa@firma.pl', DOBRE_HASLO);
    klucze.ciasteczkaUsuwajace = () => ['cai_klucz_openai=; HttpOnly; Path=/; Max-Age=0'];
    const wyloguj = await t.zadanie('/konto/wyloguj-wszedzie', t.formularz(cookie, { csrf: csrfZ(await tekst(await t.zadanie('/konto', { headers: { cookie } }))) }));
    klucze.ciasteczkaUsuwajace = pierwotneCiasteczka;
    sprawdz('wyloguj wszedzie: 303 do logowania, ciasteczko sesji i kluczy skasowane, obie sesje niewazne, logowanie dziala dalej',
      wyloguj.status === 303 && wyloguj.headers.get('location') === '/'
      && ciasteczka(wyloguj).some((c) => c.startsWith('cai_auth=;') && /Max-Age=0/.test(c)) && ciasteczka(wyloguj).some((c) => c.startsWith('cai_klucz_openai='))
      && (await t.zadanie('/api/konto', { headers: { cookie } })).status === 401 && (await t.zadanie('/api/konto', { headers: { cookie: druga } })).status === 401
      && Boolean(await t.zaloguj('maja.nowa@firma.pl', DOBRE_HASLO)));

    // Eksport: konto, zgody, liczniki, baza wiedzy (prywatna i wspolna organizacji), marka organizacji.
    cookie = await t.zaloguj('maja.nowa@firma.pl', DOBRE_HASLO);
    const konto = t.magazyn.kontoZOrganizacja(login);
    await t.zadanie('/api/baza', t.json(cookie, { nazwa: 'Cennik', tresc: 'Montaz kosztuje od 18 do 35 tys. zl.' }));
    fs.mkdirSync(path.join(t.katalog, 'marki'), { recursive: true });
    fs.writeFileSync(dzierzawy.plikMarki(t.KONF.katalogMarki, konto.organizacja), JSON.stringify({ name: 'Firma Mai', obce: 'x' }));
    fs.mkdirSync(t.KONF.katalogBazy, { recursive: true });
    fs.writeFileSync(dzierzawy.plikBazyWspolnej(t.KONF.katalogBazy, konto.organizacja), JSON.stringify([{ id: 'w1', nazwa: 'Oferta', zakres: 'wspolna', fragmenty: [{ tekst: 'Oferta firmy', wektor: [0.1, 0.2] }] }]));
    t.magazyn.policz(login, 'zawsze', 'artykul', 1);
    const eksport = await t.zadanie('/konto/eksport', { headers: { cookie } });
    const eksportTekst = await tekst(eksport);
    const dane = JSON.parse(eksportTekst);
    sprawdz('eksport: zalacznik JSON (no-store) z kontem bez hash i sol, zgodami, licznikami, baza wiedzy z trescia bez wektorow i marka organizacji',
      eksport.status === 200 && eksport.headers.get('cache-control') === 'no-store' && /attachment/.test(eksport.headers.get('content-disposition') || '')
      && dane.konto.email === 'maja.nowa@firma.pl' && !('hash' in dane.konto) && !eksportTekst.includes(konto.hash) && !eksportTekst.includes(konto.sol)
      && dane.zgody.length >= 3 && dane.uzycie.zawsze.artykul === 1 && dane.bazaWiedzy.prywatna[0].tresc.includes('Montaz kosztuje')
      && dane.bazaWiedzy.wspolna[0].tresc === 'Oferta firmy' && !JSON.stringify(dane.bazaWiedzy).includes('wektor') && dane.marka.name === 'Firma Mai'
      && !('obce' in dane.marka) && dane.organizacja.id === konto.organizacja && typeof dane.uwagi === 'string');

    // Nowa wersja regulaminu: wymaga akceptacji; przy CAI_WYMUS_AKCEPTACJE=1 API uzycia czeka.
    t.KONF.regulaminWersja = '2026-11-v2';
    const stan = await (await t.zadanie('/api/konto', { headers: { cookie } })).json();
    const ekranZgod = await tekst(await t.zadanie('/konto', { headers: { cookie } }));
    sprawdz('nowa wersja regulaminu: /api/konto wymagaAkceptacji, ekran konta proponuje akceptacje; konta zespolu bez wymogu',
      stan.zgody.regulamin.wymagaAkceptacji === true && stan.zgody.regulamin.aktualna === '2026-11-v2' && stan.zgody.regulamin.wymuszona === false
      && ekranZgod.includes('href="/konto/zgody?lang=pl"')
      && (await (await t.zadanie('/api/konto', { headers: { cookie: await t.zaloguj('standard') } })).json()).zgody.regulamin.wymagaAkceptacji === false);
    t.KONF.wymusAkceptacje = true;
    const proxy = await t.zadanie('/api', t.json(cookie, { model: 'x', messages: [] }));
    const pakiet = await t.zadanie('/api/pakiet', { headers: { cookie } });
    const zespolProxy = await t.zadanie('/api', t.json(await t.zaloguj('standard'), { model: 'x', messages: [] }));
    sprawdz('CAI_WYMUS_AKCEPTACJE=1: POST /api 403 zgoda-wymagana z wersja; odczyty i konta zespolu dzialaja',
      proxy.status === 403 && proxy.headers.get('x-cai-kod') === 'zgoda-wymagana' && (await proxy.json()).wersja === '2026-11-v2'
      && pakiet.status === 200 && zespolProxy.headers.get('x-cai-kod') !== 'zgoda-wymagana');
    const zgodyForm = await tekst(await t.zadanie('/konto/zgody', { headers: { cookie } }));
    const csrfZgod = csrfZ(zgodyForm);
    const bezZaznaczenia = await t.zadanie('/konto/zgody', t.formularz(cookie, { csrf: csrfZgod, regulamin: '2026-11-v2' }));
    const akceptacja = await t.zadanie('/konto/zgody', t.formularz(cookie, { csrf: csrfZgod, regulamin: '2026-11-v2', akceptuje: '1' }));
    const poAkceptacji = await t.zadanie('/api', t.json(cookie, { model: 'x', messages: [] }));
    const wpisy = t.magazyn.zgody(login).filter((z) => z.rodzaj === 'regulamin');
    sprawdz('akceptacja nowej wersji (/konto/zgody): bez zaznaczenia 400, po zaznaczeniu zapis z wersja i zrodlem, API znow dziala',
      czystyEkran(zgodyForm) && zgodyForm.includes('wersji 2026-11-v2') && bezZaznaczenia.status === 400 && akceptacja.status === 303
      && t.magazyn.konto(login).regulaminWersja === '2026-11-v2' && wpisy.length === 2 && wpisy[1].zrodlo === 'konto'
      && wpisy[1].wersja === '2026-11-v2' && poAkceptacji.headers.get('x-cai-kod') !== 'zgoda-wymagana');
    t.KONF.wymusAkceptacje = false;
    const marketing = await t.zadanie('/api/konto/zgody', t.json(cookie, { marketing: true }));
    const marketingJson = await marketing.json();
    const staraWersja = await t.zadanie('/api/konto/zgody', t.json(cookie, { regulamin: '2026-10-v1' }));
    const nieznane = await t.zadanie('/api/konto/zgody', t.json(cookie, { newsletter: true }));
    sprawdz('POST /api/konto/zgody: marketing zapisany w dzienniku i koncie; nieaktualna wersja i nieznane pole 400',
      marketing.status === 200 && marketingJson.zgody.marketing === true && t.magazyn.konto(login).marketing === true
      && t.magazyn.zgody(login).some((z) => z.rodzaj === 'marketing' && z.wartosc === true && z.zrodlo === 'aplikacja')
      && staraWersja.status === 400 && (await staraWersja.json()).aktualna === '2026-11-v2' && nieznane.status === 400);
    t.KONF.regulaminWersja = '2026-10-v1';
  } finally {
    klucze.ciasteczkaUsuwajace = pierwotneCiasteczka;
    await t.zamknij();
  }
}

// ─── Usuniecie konta i sprzatanie niepotwierdzonych ──────────────────────────

async function testyUsuniecia(sprawdz) {
  console.log('\n  konta (A1) - usuniecie konta (anulowanie przez B, pliki, konta_usuniete, Clear-Site-Data), sprzatanie');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji(), atrapaDostawcow: true });
  const pierwotneAnulowanie = platnosci.anulujDlaKonta;
  const pierwotneCiasteczka = klucze.ciasteczkaUsuwajace;
  try {
    const rej = await zarejestruj(t, { email: 'zofia@firma.pl' });
    const cookie = ciasteczkoSesji(rej);
    await t.zadanie('/potwierdz', t.formularz(null, { t: tokenZListu(ostatniList(t, 'zofia@firma.pl', 'potwierdzenie')) }));
    const konto = t.magazyn.kontoZOrganizacja(t.magazyn.kontoPoEmailu('zofia@firma.pl').login);
    await t.zadanie('/api/baza', t.json(cookie, { nazwa: 'Notatka', tresc: 'Tresc notatki do usuniecia' }));
    const plikBazy = path.join(t.KONF.katalogBazy, `u-${konto.login}.json`);
    const kopiaBazy = `${plikBazy}.uszkodzony-2026-10-01T00-00-00-000Z`;
    const tmpBazy = path.join(t.KONF.katalogBazy, `.u-${konto.login}.json.tmp-1-abcd`);
    fs.writeFileSync(kopiaBazy, '[]');
    fs.writeFileSync(tmpBazy, '[]');
    const plikMarki = dzierzawy.plikMarki(t.KONF.katalogMarki, konto.organizacja);
    const plikWspolnej = dzierzawy.plikBazyWspolnej(t.KONF.katalogBazy, konto.organizacja);
    fs.mkdirSync(path.dirname(plikMarki), { recursive: true });
    fs.writeFileSync(plikMarki, '{"name":"Firma Zofii"}');
    fs.writeFileSync(plikWspolnej, '[]');
    const innaBaza = path.join(t.KONF.katalogBazy, 'u-standard.json');
    fs.writeFileSync(innaBaza, '[]');

    const formularzUsun = await t.zadanie('/konto/usun', { headers: { cookie } });
    const formHtml = await tekst(formularzUsun);
    const csrf = csrfZ(formHtml);
    sprawdz('GET /konto/usun: co zniknie, haslo i "rozumiem", bez skryptow; eksport proponowany przed usunieciem',
      formularzUsun.status === 200 && czystyEkran(formHtml) && formHtml.includes('zofia@firma.pl') && /name="haslo" type="password"/.test(formHtml)
      && /name="rozumiem" value="1"/.test(formHtml) && formHtml.includes('href="/konto/eksport"') && formHtml.includes('Wyczyścimy też dane Content AI'));
    const bezCsrf = await t.zadanie('/konto/usun', t.formularz(cookie, { haslo: DOBRE_HASLO, rozumiem: '1' }));
    const bezRozumiem = await t.zadanie('/konto/usun', t.formularz(cookie, { csrf, haslo: DOBRE_HASLO }));
    const zleHaslo = await t.zadanie('/konto/usun', t.formularz(cookie, { csrf, haslo: 'nie-to-haslo-12', rozumiem: '1' }));
    sprawdz('usuniecie: bez CSRF 403, bez "rozumiem" i ze zlym haslem 400, konto zostaje',
      bezCsrf.status === 403 && bezRozumiem.status === 400 && (await tekst(bezRozumiem)).includes('rozumiesz skutki')
      && zleHaslo.status === 400 && Boolean(t.magazyn.konto(konto.login)));

    const wywolania = [];
    platnosci.anulujDlaKonta = async (k) => { wywolania.push(k.login); throw new Error('dostawca nie odpowiada'); };
    const bladAnulowania = await t.zadanie('/konto/usun', t.formularz(cookie, { csrf, haslo: DOBRE_HASLO, rozumiem: '1' }));
    sprawdz('usuniecie przy bledzie anulowania subskrypcji (kontrakt B): 503, konto i pliki zostaja (klient nie placi za usuniete konto)',
      bladAnulowania.status === 503 && (await tekst(bladAnulowania)).includes('nie usunęliśmy') && Boolean(t.magazyn.konto(konto.login))
      && fs.existsSync(plikBazy) && wywolania.length === 1);
    platnosci.anulujDlaKonta = async (k) => { wywolania.push(k.login); return { ok: true, anulowano: false }; };
    klucze.ciasteczkaUsuwajace = () => ['cai_klucz_anthropic=; HttpOnly; Path=/; Max-Age=0'];
    const usun = await t.zadanie('/konto/usun', t.formularz(cookie, { csrf, haslo: DOBRE_HASLO, rozumiem: '1' }));
    const usunHtml = await tekst(usun);
    await konta.czekajNaTlo();
    const wpis = t.magazyn.kontoUsuniete(konto.login);
    sprawdz('usuniecie: 200 z ekranem pozegnania, Clear-Site-Data, ciasteczka sesji i kluczy skasowane, anulowanie przez B wywolane',
      usun.status === 200 && usun.headers.get('clear-site-data') === '"cache", "cookies", "storage"' && usunHtml.includes('Konto usunięte')
      && czystyEkran(usunHtml) && ciasteczka(usun).some((c) => c.startsWith('cai_auth=;') && /Max-Age=0/.test(c))
      && ciasteczka(usun).some((c) => c.startsWith('cai_klucz_anthropic=')) && wywolania.length === 2 && wywolania[1] === konto.login);
    sprawdz('usuniecie: konto i organizacja z bazy, wpis konta_usuniete ze skrotem e-maila (bez adresu), zgody zostaja jako dowod',
      !t.magazyn.konto(konto.login) && !t.magazyn.organizacja(konto.organizacja) && Boolean(wpis) && wpis.powod === 'uzytkownik'
      && wpis.emailSkrot === t.srv.skrotEmaila('zofia@firma.pl') && !String(wpis.emailSkrot).includes('@') && t.magazyn.zgody(konto.login).length >= 3);
    sprawdz('usuniecie: pliki konta (z kopia uszkodzonej i tymczasowym) i organizacji (marka, baza wspolna) usuniete, cudze zostaja',
      !fs.existsSync(plikBazy) && !fs.existsSync(kopiaBazy) && !fs.existsSync(tmpBazy) && !fs.existsSync(plikMarki) && !fs.existsSync(plikWspolnej)
      && fs.existsSync(innaBaza));
    sprawdz('usuniecie: e-mail "konto usuniete", stara sesja nie dziala, /do-widzenia publiczne',
      Boolean(ostatniList(t, 'zofia@firma.pl', 'konto-usuniete')) && (await t.zadanie('/api/konto', { headers: { cookie } })).status === 401
      && (await tekst(await t.zadanie('/do-widzenia'))).includes('Konto usunięte'));

    // Sprzatanie dobowe: niepotwierdzone, bez platnosci i bez logowania od CAI_NIEPOTWIERDZONE_DNI.
    const stare = Date.now() - 31 * 24 * 3600_000;
    const mk = (email) => t.magazyn.utworzOrganizacjeIKonto({ email, ...t.srv.zahaszuj('haslo-sprzatania-1'), teraz: stare });
    const porzucone = mk('porzucone@firma.pl');
    const potwierdzone = mk('potwierdzone@firma.pl');
    t.magazyn.zmienKonto(potwierdzone.login, { emailPotwierdzony: stare });
    const placace = mk('placace@firma.pl');
    t.magazyn.powiazKlienta(placace.login, { platnik: 'stripe', tryb: 'test', idKlienta: 'cus_test_1' });
    const swieze = t.magazyn.utworzOrganizacjeIKonto({ email: 'swieze@firma.pl', ...t.srv.zahaszuj('haslo-sprzatania-1') });
    const srodowisko = { KONF: t.KONF, magazyn: t.magazyn, dzierzawy, plany, skrotEmaila: t.srv.skrotEmaila };
    const wynik = konta.sprzatajNiepotwierdzone(srodowisko);
    sprawdz('sprzatanie: usuwa tylko niepotwierdzone bez platnosci i logowania od 30 dni (z organizacja), konta zespolu zostaja',
      wynik.usunieto === 1 && !t.magazyn.konto(porzucone.login) && !t.magazyn.organizacja(porzucone.organizacja)
      && t.magazyn.kontoUsuniete(porzucone.login).powod === 'niepotwierdzone' && Boolean(t.magazyn.konto(potwierdzone.login))
      && Boolean(t.magazyn.konto(placace.login)) && Boolean(t.magazyn.konto(swieze.login)) && t.magazyn.liczbaKont({ organizacja: 'glowna' }) === 4);
  } finally {
    platnosci.anulujDlaKonta = pierwotneAnulowanie;
    klucze.ciasteczkaUsuwajace = pierwotneCiasteczka;
    await t.zamknij();
  }
}

// ─── CLI: pokaz, email, klucze, organizacja ──────────────────────────────────

async function testyCli(sprawdz) {
  console.log('\n  konta (A1) - CLI uzytkownicy.js: pokaz, email, klucze, organizacja');
  const { spawnSync } = require('node:child_process');
  const t = await uruchomSerwer({ srodowisko: srodowiskoRejestracji(), atrapaDostawcow: true });
  try {
    // CLI to osobny proces na tej samej bazie (WAL), ze srodowiskiem serwera testowego.
    const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'uzytkownicy.js'), ...a], { env: { ...process.env }, encoding: 'utf8' });
    const rej = await zarejestruj(t, { email: 'Ewa.Klient@Firma.pl' });
    const cookie = ciasteczkoSesji(rej);
    const klient = t.magazyn.kontoPoEmailu('ewa.klient@firma.pl');

    const pokaz = cli('pokaz', 'EWA.klient@firma.pl');
    const pokazZespolu = cli('pokaz', 'standard');
    sprawdz('CLI pokaz <e-mail|login>: konto, organizacja, klucze, pakiet, zgody z wersja; bez hasha i soli',
      pokaz.status === 0 && pokaz.stdout.includes(`Konto ${klient.login} (samoobsługowe`) && /e-mail:\s+ewa\.klient@firma\.pl \(niepotwierdzony\)/.test(pokaz.stdout)
      && pokaz.stdout.includes(klient.organizacja) && /klucze API:\s+własne/.test(pokaz.stdout) && /pakiet:\s+darmowy/.test(pokaz.stdout)
      && /artykul 0 z 3/.test(pokaz.stdout) && /regulamin\s+2026-10-v1\s+tak\s+rejestracja/.test(pokaz.stdout) && /polityka/.test(pokaz.stdout)
      && !pokaz.stdout.includes(klient.hash) && !pokaz.stdout.includes(klient.sol)
      && pokazZespolu.status === 0 && /e-mail:\s+brak \(loguje się loginem\)/.test(pokazZespolu.stdout) && /organizacja:\s+glowna/.test(pokazZespolu.stdout)
      && /klucze API:\s+serwera/.test(pokazZespolu.stdout));

    // email: adres od administratora jest potwierdzony; stare linki z e-maili przestaja dzialac.
    const staryReset = t.magazyn.zapiszToken({ login: 'standard', rodzaj: 'reset', email: 'stary@firma.pl', wazneMs: 3600_000 });
    const tokenPrzed = t.magazyn.sprawdzToken(staryReset, 'reset') !== null;
    const ustaw = cli('email', 'standard', 'Ola.Zespol@Firma.pl');
    const poUstawieniu = t.magazyn.konto('standard');
    const logowanie = await t.zadanie('/auth/login', t.formularz(null, { login: 'ola.zespol@firma.pl', haslo: HASLO }, { 'x-real-ip': nowyIp() }));
    sprawdz('CLI email <login> <adres>: zapis znormalizowany i potwierdzony, logowanie e-mailem, wczesniejsze tokeny niewazne',
      ustaw.status === 0 && poUstawieniu.email === 'ola.zespol@firma.pl' && Boolean(poUstawieniu.emailPotwierdzony)
      && logowanie.status === 302 && Boolean(ciasteczkoSesji(logowanie)) && tokenPrzed && t.magazyn.sprawdzToken(staryReset, 'reset') === null);
    const zajety = cli('email', 'premium', 'ewa.klient@firma.pl');
    const zly = cli('email', 'premium', 'ewa@firma');
    const usunSamoobslugowy = cli('email', klient.login, '-');
    sprawdz('CLI email: adres innego konta, zly format i usuniecie adresu konta samoobslugowego odrzucone (kod 1, bez zmian)',
      zajety.status === 1 && /ma już konto/.test(zajety.stderr) && zly.status === 1 && /nie wygląda na adres/.test(zly.stderr)
      && usunSamoobslugowy.status === 1 && t.magazyn.konto('premium').email === null
      && t.magazyn.konto(klient.login).email === 'ewa.klient@firma.pl');
    const usunZespolu = cli('email', 'ola.zespol@firma.pl', '-');
    sprawdz('CLI email <login> -: konto zespolu bez adresu loguje sie dalej loginem',
      usunZespolu.status === 0 && /nie ma już adresu/.test(usunZespolu.stdout) && t.magazyn.konto('standard').email === null && t.magazyn.konto('standard').emailPotwierdzony === null
      && (await t.zadanie('/auth/login', t.formularz(null, { login: 'standard', haslo: HASLO }, { 'x-real-ip': nowyIp() }))).status === 302);

    // klucze: zmiana dziala od nastepnego zapytania (konto czytane z bazy przy kazdym zadaniu).
    const kluczeSerwera = cli('klucze', klient.login, 'serwera');
    const poZmianie = await (await t.zadanie('/api/konto', { headers: { cookie } })).json();
    const zleZrodlo = cli('klucze', klient.login, 'cudze');
    const bezZmian = cli('klucze', klient.login, 'serwera');
    sprawdz('CLI klucze <login> serwera|wlasne: zmiana bez restartu (/api/konto), zla wartosc odrzucona, powtorka bez zmian',
      kluczeSerwera.status === 0 && poZmianie.zrodloKluczy === 'serwera' && t.magazyn.konto(klient.login).zrodloKluczy === 'serwera'
      && zleZrodlo.status === 1 && bezZmian.status === 0 && /Bez zmian/.test(bezZmian.stdout)
      && cli('klucze', klient.login, 'wlasne').status === 0 && t.magazyn.konto(klient.login).zrodloKluczy === 'wlasne');

    // organizacja: opis (konta, pliki) i nazwa widoczna w /api/konto.
    const opis = cli('organizacja', klient.login);
    const nazwa = cli('organizacja', klient.login, 'nazwa', 'Biuro', 'Ewy');
    const poNazwie = await (await t.zadanie('/api/konto', { headers: { cookie } })).json();
    const zaDluga = cli('organizacja', klient.organizacja, 'nazwa', 'x'.repeat(101));
    const nieznana = cli('organizacja', 'o-nieistnieje');
    const glowna = cli('organizacja', 'glowna');
    sprawdz('CLI organizacja <login|id> [nazwa <tekst>]: opis z kontami i plikami, nazwa w /api/konto, zla nazwa i nieznana organizacja odrzucone',
      opis.status === 0 && opis.stdout.includes(`Organizacja ${klient.organizacja} (samoobsługowa)`) && opis.stdout.includes(klient.login)
      && opis.stdout.includes(path.join('marki', `${klient.organizacja}.json`)) && nazwa.status === 0
      && t.magazyn.organizacja(klient.organizacja).nazwa === 'Biuro Ewy' && poNazwie.organizacja.nazwa === 'Biuro Ewy'
      && zaDluga.status === 1 && t.magazyn.organizacja(klient.organizacja).nazwa === 'Biuro Ewy' && nieznana.status === 1
      && glowna.status === 0 && /Konta \(4\)/.test(glowna.stdout)
      && cli('organizacja', klient.organizacja, 'nazwa', '-').status === 0 && t.magazyn.organizacja(klient.organizacja).nazwa === null);

    t.magazyn.usunKonto(klient.login, { powod: 'uzytkownik' });
    const poUsunieciu = cli('pokaz', klient.login);
    const pomoc = cli('pomoc');
    sprawdz('CLI pokaz usunietego konta: kod 1 z data i powodem; pomoc wymienia nowe polecenia',
      poUsunieciu.status === 1 && /usunięto .* \(powód: uzytkownik\)/.test(poUsunieciu.stderr)
      && ['pokaz <login|e-mail>', 'email <login|e-mail>', 'klucze <login|e-mail>', 'organizacja <login|e-mail|id>'].every((p) => pomoc.stdout.includes(p)));
  } finally {
    await t.zamknij();
  }
}

// ─── Funkcje modulu bez serwera ──────────────────────────────────────────────

function testyFunkcji(sprawdz) {
  console.log('\n  konta (A1) - zasady hasla, adresu i znacznika formularza');
  sprawdz('haslo: 10-256 znakow, rozne od e-maila, nie z listy najczestszych i nie z jednego znaku',
    konta.ocenHaslo('krotkie', 'a@b.pl') === 'haslo-krotkie' && konta.ocenHaslo('x'.repeat(257), '') === 'haslo-dlugie'
    && konta.ocenHaslo('anna@firma.pl', 'anna@firma.pl') === 'haslo-jak-email' && konta.ocenHaslo('Password123', '') === 'haslo-slabe'
    && konta.ocenHaslo('zzzzzzzzzzzz', '') === 'haslo-slabe' && konta.ocenHaslo('trzy dobre slowa', 'a@b.pl') === null);
  sprawdz('adres e-mail: format nazwa@domena.tld, bez znakow HTML i sterujacych, do 254 znakow',
    konta.poprawnyEmail('anna.kowalska+test@firma.com.pl') && !konta.poprawnyEmail('anna@firma') && !konta.poprawnyEmail('a<b@firma.pl')
    && !konta.poprawnyEmail('a b@firma.pl') && !konta.poprawnyEmail(`${'a'.repeat(250)}@b.pl`) && !konta.poprawnyEmail('a"@firma.pl'));
  const podpisz = (d) => crypto.createHmac('sha256', 'testowy').update(d).digest('base64url');
  const teraz = Date.now();
  sprawdz('znacznik formularza: podpis sekretem, za szybko < 3 s, wygasly > 2 h, cudzy podpis odrzucony',
    konta.ocenZnacznik(konta.znacznikFormularza(podpisz, teraz - 10_000), podpisz, teraz) === 'ok'
    && konta.ocenZnacznik(konta.znacznikFormularza(podpisz, teraz - 1000), podpisz, teraz) === 'szybko'
    && konta.ocenZnacznik(konta.znacznikFormularza(podpisz, teraz - 3 * 3600_000), podpisz, teraz) === 'wygasl'
    && konta.ocenZnacznik(konta.znacznikFormularza((d) => podpisz(`inny${d}`), teraz - 10_000), podpisz, teraz) === 'wygasl'
    && konta.ocenZnacznik('', podpisz, teraz) === 'wygasl');
  sprawdz('bramka potwierdzenia: tylko konta na wlasnym kluczu bez potwierdzonego adresu',
    konta.wymagaPotwierdzenia({ zrodloKluczy: 'wlasne', emailPotwierdzony: null }) && !konta.wymagaPotwierdzenia({ zrodloKluczy: 'wlasne', emailPotwierdzony: 1 })
    && !konta.wymagaPotwierdzenia({ zrodloKluczy: 'serwera', emailPotwierdzony: null }));
}

async function uruchom({ sprawdz }) {
  testyFunkcji(sprawdz);
  await testyDomyslne(sprawdz);
  await testyRejestracji(sprawdz);
  await testyTurnstileIBramy(sprawdz);
  await testyPotwierdzenia(sprawdz);
  await testyResetu(sprawdz);
  await testyKonta(sprawdz);
  await testyUsuniecia(sprawdz);
  await testyCli(sprawdz);
}

module.exports = { uruchom };
