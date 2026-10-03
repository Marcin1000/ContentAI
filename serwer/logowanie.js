'use strict';

// ─── Ekrany serwera: logowanie, wylogowanie, bledy ───────────────────────────
//
// Pierwszy ekran, ktory widzi kazdy uzytkownik, wiec trzyma sie marki
// (kierunek A "Redakcja": cieply grafit i papier, bursztyn tylko przy
// decyzji, Schibsted Grotesk w interfejsie, Literata w tresci). Zasady:
//   - zero zewnetrznych zasobow: fonty z /pwa/fonty, znak jako inline SVG,
//   - zero skryptow: strona dziala pod CSP i bez JavaScriptu,
//   - dwa jezyki (Accept-Language albo ?lang=pl|en), jasny i ciemny motyw
//     wedlug ustawien systemu,
//   - dostepnosc: etykiety, widoczny fokus, komunikat bledu w aria-live.
// Kolory i skale to wartosci z tokeny.css marki (agencja-marka).

const DOSTEP = {
  pl: 'https://content-ai.net/#dostep',
  en: 'https://content-ai.net/en/#dostep',
};

const T = {
  pl: {
    lang: 'pl',
    tytul: 'Logowanie · Content AI',
    naglowek: 'Zaloguj się',
    wstep: 'Konto zakłada administrator Twojego zespołu.',
    login: 'Login',
    haslo: 'Hasło',
    przycisk: 'Zaloguj się',
    brakKonta: 'Nie masz konta?',
    popros: 'Poproś o dostęp',
    przelacz: 'English',
    przelaczOpis: 'Switch to English',
    przelaczLang: 'en',
    hasloTytul: 'Jeden tekst dla wyszukiwarki i dla odpowiedzi AI.',
    hasloOpis: 'Artykuły, grafiki i audio z jednego miejsca, oparte na Twojej bazie wiedzy i prawdziwych wynikach wyszukiwania.',
    stopka: 'Klucze API zostają na serwerze, nie w przeglądarce.',
    powierzchnie: 'Cztery powierzchnie wyszukiwania',
    komunikaty: {
      'zle-dane': 'Niepoprawny login lub hasło.',
      'za-duzo-prob': 'Za dużo prób logowania. Spróbuj ponownie za 15 minut.',
      'obce-zrodlo': 'Logowanie odrzucone: formularz nie pochodził z tej strony. Odśwież stronę i spróbuj ponownie.',
      openseo: 'Zaloguj się, żeby wejść do OpenSEO.',
    },
    wylogujTytul: 'Wylogowanie · Content AI',
    wylogujNaglowek: 'Wylogować się?',
    wylogujOpis: 'Wylogowanie przyszło z odnośnika spoza aplikacji, więc pytamy, zanim zakończymy sesję.',
    wylogujPrzycisk: 'Wyloguj się',
    wroc: 'Wróć do aplikacji',
    bramaTytul: 'Wyloguj się w bramie',
    bramaOpis: 'Logowaniem zarządza brama uwierzytelniająca, więc sesję kończysz po jej stronie. Zamknięcie tej karty nie wystarczy.',
    danychTytul: 'Dane chwilowo niedostępne',
    danychOpis: 'Serwer nie może odczytać swoich danych i nie zapisze niczego, dopóki administrator tego nie sprawdzi. Twoja praca nie została nadpisana. Spróbuj ponownie za kilka minut.',
    openseoTytul: 'OpenSEO w pakiecie Premium',
    openseoOpis: 'Twoje konto nie ma dostępu do OpenSEO. Badanie fraz i pozycji jest częścią pakietu Premium. Poproś administratora o zmianę pakietu.',
  },
  en: {
    lang: 'en',
    tytul: 'Sign in · Content AI',
    naglowek: 'Sign in',
    wstep: 'Your team administrator creates accounts.',
    login: 'Username',
    haslo: 'Password',
    przycisk: 'Sign in',
    brakKonta: 'No account yet?',
    popros: 'Request access',
    przelacz: 'Polski',
    przelaczOpis: 'Przełącz na polski',
    przelaczLang: 'pl',
    hasloTytul: 'One article for search results and AI answers.',
    hasloOpis: 'Articles, visuals and audio from one workspace, grounded in your knowledge base and real search results.',
    stopka: 'API keys stay on the server, never in the browser.',
    powierzchnie: 'Four search surfaces',
    komunikaty: {
      'zle-dane': 'Incorrect username or password.',
      'za-duzo-prob': 'Too many sign-in attempts. Try again in 15 minutes.',
      'obce-zrodlo': 'Sign-in rejected: the form did not come from this site. Refresh the page and try again.',
      openseo: 'Sign in to open OpenSEO.',
    },
    wylogujTytul: 'Sign out · Content AI',
    wylogujNaglowek: 'Sign out?',
    wylogujOpis: 'The sign-out came from a link outside the app, so we ask before ending your session.',
    wylogujPrzycisk: 'Sign out',
    wroc: 'Back to the app',
    bramaTytul: 'Sign out at the gateway',
    bramaOpis: 'Sign-in is handled by an authentication gateway, so you end the session there. Closing this tab is not enough.',
    danychTytul: 'Data temporarily unavailable',
    danychOpis: 'The server cannot read its data and will not write anything until an administrator checks it. Your work has not been overwritten. Please try again in a few minutes.',
    openseoTytul: 'OpenSEO is part of Premium',
    openseoOpis: 'Your account does not include OpenSEO. Keyword and ranking research is part of the Premium plan. Ask your administrator to change your plan.',
  },
};

// Komunikaty informacyjne (nie bledy) - inny wyglad, bez aria-invalid na polach.
const INFORMACJE = new Set(['openseo']);

/** Jezyk z Accept-Language: pierwszy z pl/en wg wag q; domyslnie polski. */
function jezykZNaglowka(naglowek) {
  const pozycje = String(naglowek || '').split(',').map((c, i) => {
    const [tag, ...param] = c.trim().toLowerCase().split(';');
    const q = param.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { tag: tag.trim(), q: q ? Number(q.slice(2)) || 0 : 1, i };
  }).filter((p) => p.tag && p.q > 0);
  pozycje.sort((a, b) => b.q - a.q || a.i - b.i);
  for (const p of pozycje) {
    if (p.tag === 'pl' || p.tag.startsWith('pl-')) return 'pl';
    if (p.tag === 'en' || p.tag.startsWith('en-')) return 'en';
  }
  return 'pl';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (z) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[z]));
}

/** Tekst do akapitu: escapowany, a jednoliterowe slowa (i, w, z, a, o, u) nie zostaja na koncu linii. */
function akapit(s) {
  return esc(s).replace(/(^|\s)([aiouwzAIOUWZ])\s+/g, '$1$2&nbsp;');
}

// Znak marki (znak-32.svg, agencja-marka): cztery ramiona wokol rdzenia z kropka.
const ZNAK_SCIEZKA = 'M16 1.5 L18.82 12.33 L17.94 13.21 A3.4 3.4 0 0 0 14.06 13.21 L13.18 12.33 Z '
  + 'M30.5 16 L19.67 18.82 L18.79 17.94 A3.4 3.4 0 0 0 18.79 14.06 L19.67 13.18 Z '
  + 'M16 30.5 L13.18 19.67 L14.06 18.79 A3.4 3.4 0 0 0 17.94 18.79 L18.82 19.67 Z '
  + 'M1.5 16 L12.33 13.18 L13.21 14.06 A3.4 3.4 0 0 0 13.21 17.94 L12.33 18.82 Z';

function znak(klasa, rozmiar) {
  return `<svg class="${klasa}" viewBox="0 0 32 32" width="${rozmiar}" height="${rozmiar}" aria-hidden="true" focusable="false">`
    + `<path d="${ZNAK_SCIEZKA}"/><circle cx="16" cy="16" r="1.6"/></svg>`;
}

function logo() {
  return `<span class="logo">${znak('logo-znak', 24)}<span class="logo-napis">CONTENT AI</span></span>`;
}

// Kroje z wlasnego hosta. Pliki dokleja wdrozenie marki do app/pwa/fonty; bez
// nich strona spada na kroje systemowe i nadal wyglada porzadnie.
const FONTY = `
@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:400 900;font-display:swap;
  src:url("/pwa/fonty/schibsted-grotesk-latin-wght-normal.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:400 900;font-display:swap;
  src:url("/pwa/fonty/schibsted-grotesk-latin-ext-wght-normal.woff2") format("woff2");
  unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Literata";font-style:normal;font-weight:200 900;font-display:swap;
  src:url("/pwa/fonty/literata-latin-wght-normal.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Literata";font-style:normal;font-weight:200 900;font-display:swap;
  src:url("/pwa/fonty/literata-latin-ext-wght-normal.woff2") format("woff2");
  unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;
  src:url("/pwa/fonty/jetbrains-mono-latin-wght-normal.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

// Tokeny marki: ciemny domyslnie, jasny z prefers-color-scheme.
const STYL = `${FONTY}
:root{color-scheme:dark;
  --c-tlo:#111110;--c-panel:#171715;--c-pole:#1E1E1B;--c-strona:#191917;--c-linia:#2A2A27;--c-linia-2:#363632;
  --c-ramka:#716F67;--c-ramka-najazd:#8A877F;--c-tekst:#EDEBE6;--c-tekst-2:#B9B6AE;--c-tekst-3:#A29E95;
  --c-akcent:#F6A623;--c-akcent-najazd:#FFB84D;--c-akcent-wcisk:#E39410;--c-na-akcencie:#1C1303;
  --c-akcent-mocny:#F6A623;--c-akcent-tlo:#362B17;--c-fokus:#F6A623;--c-dowod:#5AD1C4;
  --c-blad:#F47C7C;--c-blad-tlo:#362523;--c-blad-ramka:#6F3F3E;
  --c-info:#5AD1C4;--c-info-tlo:#20312E;--c-info-ramka:#32615B;
  --c-znak-tlo:#1C1C1A;--c-zaznaczenie:rgba(246,166,35,.30);
  --cien-3:0 0 0 1px rgba(255,255,255,.05),0 28px 72px -18px rgba(0,0,0,.8);
  --f-ui:"Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --f-tresc:"Literata",Georgia,"Times New Roman",serif;
  --f-mono:"JetBrains Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  --r-sm:6px;--r-md:8px;--r-lg:12px;--h-pole:44px;--m-1:90ms;--m-2:150ms;--e-std:cubic-bezier(.2,0,0,1)}
@media (prefers-color-scheme:light){:root{color-scheme:light;
  --c-tlo:#ECEBE6;--c-panel:#F7F6F2;--c-pole:#FFFFFF;--c-strona:#FFFEFB;--c-linia:#E3E1DB;--c-linia-2:#D6D3CB;
  --c-ramka:#8D897F;--c-ramka-najazd:#6F6B62;--c-tekst:#1B1A17;--c-tekst-2:#4F4C45;--c-tekst-3:#67635B;
  --c-akcent:#F6A623;--c-akcent-najazd:#FFB547;--c-akcent-wcisk:#E89512;--c-na-akcencie:#1C1303;
  --c-akcent-mocny:#8F5A00;--c-akcent-tlo:#F7EEDD;--c-fokus:#B06C00;--c-dowod:#0B7268;
  --c-blad:#B72B29;--c-blad-tlo:#F1E2DE;--c-blad-ramka:#DA9B98;
  --c-info:#0B7268;--c-info-tlo:#DFE9E4;--c-info-ramka:#8DBBB4;
  --c-znak-tlo:#EFEDE7;--c-zaznaczenie:rgba(246,166,35,.32);
  --cien-3:0 0 0 1px rgba(27,26,23,.06),0 28px 72px -20px rgba(27,26,23,.22)}}
@media (prefers-reduced-motion:reduce){:root{--m-1:0ms;--m-2:0ms}}
@media (prefers-contrast:more){:root{--c-tekst-2:var(--c-tekst);--c-tekst-3:var(--c-tekst);--c-linia-2:var(--c-ramka)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--c-tlo);color:var(--c-tekst);
  font:400 15px/1.5 var(--f-ui);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:var(--c-zaznaczenie)}
a{color:var(--c-akcent-mocny);text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--c-fokus);outline-offset:2px;border-radius:var(--r-sm)}
.uklad{min-height:100vh;min-height:100dvh;display:grid;grid-template-columns:1fr}
.redakcja{display:none}
.strona{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh;padding:20px 20px 28px}
.gora{display:flex;align-items:center;justify-content:space-between;gap:16px}
.logo{display:inline-flex;align-items:center;gap:10px;color:var(--c-tekst);text-decoration:none}
.logo-znak{fill:var(--c-akcent);flex:none}
.logo-napis{font:600 14px/1 var(--f-ui);letter-spacing:.14em}
.jezyk{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border:1px solid var(--c-linia-2);
  border-radius:var(--r-sm);color:var(--c-tekst-2);font:500 13px/1 var(--f-ui);text-decoration:none;
  transition:border-color var(--m-1) var(--e-std),color var(--m-1) var(--e-std)}
.jezyk:hover{border-color:var(--c-ramka);color:var(--c-tekst)}
.srodek{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 0 24px}
.karta{width:100%;max-width:380px}
h1{margin:0 0 8px;font:600 28px/1.2 var(--f-ui);letter-spacing:-.012em}
.wstep{margin:0 0 28px;color:var(--c-tekst-2);font-size:15px}
.komunikat{margin:0 0 20px;padding:12px 14px;border:1px solid var(--c-blad-ramka);border-radius:var(--r-md);
  background:var(--c-blad-tlo);color:var(--c-blad);font-size:14px;line-height:1.45;display:flex;gap:10px;align-items:flex-start}
.komunikat.info{border-color:var(--c-info-ramka);background:var(--c-info-tlo);color:var(--c-info)}
.komunikat svg{flex:none;margin-top:2px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.komunikat:empty{display:none}
.pole{margin:0 0 18px}
label{display:block;margin:0 0 6px;font:600 13px/1.3 var(--f-ui);color:var(--c-tekst)}
input{display:block;width:100%;height:var(--h-pole);padding:0 14px;border:1px solid var(--c-ramka);border-radius:var(--r-sm);
  background:var(--c-pole);color:var(--c-tekst);font:400 16px/1 var(--f-ui);
  transition:border-color var(--m-1) var(--e-std),box-shadow var(--m-1) var(--e-std)}
input:hover{border-color:var(--c-ramka-najazd)}
input:focus{outline:none;border-color:var(--c-fokus);box-shadow:0 0 0 3px var(--c-akcent-tlo)}
input[aria-invalid="true"]{border-color:var(--c-blad)}
button{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;margin-top:8px;padding:0 20px;
  border:0;border-radius:var(--r-sm);background:var(--c-akcent);color:var(--c-na-akcencie);
  font:600 15px/1 var(--f-ui);cursor:pointer;transition:background var(--m-1) var(--e-std),transform var(--m-1) var(--e-std)}
button:hover{background:var(--c-akcent-najazd)}
button:active{background:var(--c-akcent-wcisk);transform:translateY(1px)}
button:focus-visible{outline:2px solid var(--c-fokus);outline-offset:3px}
button svg{stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dostep{margin:28px 0 0;padding-top:20px;border-top:1px solid var(--c-linia);color:var(--c-tekst-2);font-size:14px}
.dostep a{font-weight:600;white-space:nowrap}
.dol{color:var(--c-tekst-3);font-size:12px;line-height:1.5;text-align:center}
.wtorny{display:flex;align-items:center;justify-content:center;height:48px;margin-top:12px;border:1px solid var(--c-linia-2);
  border-radius:var(--r-sm);color:var(--c-tekst);font:500 15px/1 var(--f-ui);text-decoration:none}
.wtorny:hover{border-color:var(--c-ramka)}
@media (min-width:960px){
  .uklad{grid-template-columns:minmax(0,1.08fr) minmax(440px,1fr)}
  .redakcja{display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;
    padding:40px 56px 44px;background:var(--c-panel);border-right:1px solid var(--c-linia)}
  .redakcja .logo-napis{font-size:15px}
  .tlo-znak{position:absolute;right:-150px;bottom:-170px;width:600px;height:600px;fill:var(--c-znak-tlo);pointer-events:none}
  .tresc{position:relative;max-width:560px}
  .powierzchnie{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px;padding:0;list-style:none}
  .powierzchnie li{padding:5px 10px;border:1px solid var(--c-linia-2);border-radius:var(--r-sm);
    font:500 12px/1 var(--f-mono);letter-spacing:.06em;color:var(--c-tekst-2);background:var(--c-tlo)}
  .haslo-tytul{margin:0 0 20px;font:500 clamp(34px,3.3vw,46px)/1.14 var(--f-tresc);letter-spacing:-.02em;color:var(--c-tekst);text-wrap:balance}
  .haslo-opis{margin:0;max-width:46ch;font:400 17px/1.6 var(--f-tresc);color:var(--c-tekst-2)}
  .redakcja .dol{position:relative;text-align:left;display:flex;align-items:center;gap:10px}
  .redakcja .dol::before{content:"";width:24px;height:1px;background:var(--c-ramka)}
  .strona{padding:40px 56px 44px}
  .strona .gora .logo{visibility:hidden}
  .strona .dol{display:none}
  .srodek{padding:0}
}
@media (min-width:1280px){.redakcja{padding:48px 72px 52px}.strona{padding:48px 72px 52px}}
`;

const IKONA_BLEDU = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
const IKONA_INFO = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
const STRZALKA = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function teksty(jezyk) {
  return T[jezyk === 'en' ? 'en' : 'pl'];
}

/** Szkielet wspolny dla wszystkich ekranow: panel redakcyjny + kolumna z trescia. */
function szkielet(t, tytul, srodek, opcje = {}) {
  const przelacznik = opcje.przelacznik === false ? '<span></span>'
    : `<a class="jezyk" href="/?lang=${t.przelaczLang}" hreflang="${t.przelaczLang}" lang="${t.przelaczLang}" aria-label="${esc(t.przelaczOpis)}">${esc(t.przelacz)}</a>`;
  return `<!DOCTYPE html>
<html lang="${t.lang}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#111110" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F7F6F2" media="(prefers-color-scheme: light)">
<meta name="robots" content="noindex">
<title>${esc(tytul)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="#F6A623"><path d="${ZNAK_SCIEZKA}"/><circle cx="16" cy="16" r="1.6"/></svg>`)}">
<style>${STYL}</style></head><body>
<div class="uklad">
  <aside class="redakcja" aria-label="Content AI">
    ${logo()}
    <div class="tresc">
      <ul class="powierzchnie" aria-label="${esc(t.powierzchnie)}"><li>SEO</li><li>AIO</li><li>AEO</li><li>GEO</li></ul>
      <p class="haslo-tytul">${akapit(t.hasloTytul)}</p>
      <p class="haslo-opis">${akapit(t.hasloOpis)}</p>
    </div>
    <p class="dol">${esc(t.stopka)}</p>
    ${znak('tlo-znak', 640)}
  </aside>
  <main class="strona">
    <div class="gora">${logo()}${przelacznik}</div>
    <div class="srodek"><div class="karta">
${srodek}
    </div></div>
    <p class="dol">${esc(t.stopka)}</p>
  </main>
</div>
</body></html>`;
}

/**
 * Ekran logowania. `kod` to klucz komunikatu ('zle-dane', 'za-duzo-prob',
 * 'obce-zrodlo', 'openseo') albo pusty. Nazwy pol (login, haslo) i przycisk
 * submit sa kontraktem: uzywaja ich brama OpenSEO i testy end-to-end.
 */
function stronaLogowania({ kod = '', jezyk = 'pl', login = '', sciezka = '/auth/login' } = {}) {
  const t = teksty(jezyk);
  const tekst = kod ? (t.komunikaty[kod] || '') : '';
  const info = INFORMACJE.has(kod);
  const blad = Boolean(tekst) && !info;
  const komunikat = `<p class="komunikat${info ? ' info' : ''}" id="komunikat" role="${info ? 'status' : 'alert'}" aria-live="${info ? 'polite' : 'assertive'}">`
    + (tekst ? `${info ? IKONA_INFO : IKONA_BLEDU}<span>${esc(tekst)}</span>` : '') + '</p>';
  const opisPol = blad ? ' aria-invalid="true" aria-describedby="komunikat"' : '';
  const srodek = `      <h1>${esc(t.naglowek)}</h1>
      <p class="wstep">${akapit(t.wstep)}</p>
      ${komunikat}
      <form method="POST" action="${esc(sciezka)}" novalidate>
        <input type="hidden" name="jezyk" value="${t.lang}">
        <div class="pole">
          <label for="login">${esc(t.login)}</label>
          <input id="login" name="login" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
            required maxlength="40" value="${esc(login)}"${login ? '' : ' autofocus'}${opisPol}>
        </div>
        <div class="pole">
          <label for="haslo">${esc(t.haslo)}</label>
          <input id="haslo" name="haslo" type="password" autocomplete="current-password" required${login ? ' autofocus' : ''}${opisPol}>
        </div>
        <button type="submit">${esc(t.przycisk)}${STRZALKA}</button>
      </form>
      <p class="dostep">${esc(t.brakKonta)} <a href="${DOSTEP[t.lang]}">${esc(t.popros)}</a></p>`;
  return szkielet(t, t.tytul, srodek);
}

/** Wylogowanie wywolane spoza aplikacji (link, obrazek): pytamy o potwierdzenie. */
function stronaPotwierdzeniaWylogowania(jezyk) {
  const t = teksty(jezyk);
  const srodek = `      <h1>${esc(t.wylogujNaglowek)}</h1>
      <p class="wstep">${akapit(t.wylogujOpis)}</p>
      <form method="POST" action="/auth/logout"><button type="submit">${esc(t.wylogujPrzycisk)}</button></form>
      <a class="wtorny" href="/">${esc(t.wroc)}</a>`;
  return szkielet(t, t.wylogujTytul, srodek, { przelacznik: false });
}

/** Ekran wylogowania w trybie bramy - sesje trzyma ona, nie my. */
function stronaWylogowaniaZBramy(jezyk) {
  const t = teksty(jezyk);
  return szkielet(t, t.bramaTytul, `      <h1>${esc(t.bramaTytul)}</h1>
      <p class="wstep">${akapit(t.bramaOpis)}</p>`, { przelacznik: false });
}

/** 503 przy uszkodzonym pliku danych. */
function stronaBleduDanych(jezyk) {
  const t = teksty(jezyk);
  return szkielet(t, t.danychTytul, `      <h1>${esc(t.danychTytul)}</h1>
      <p class="wstep">${akapit(t.danychOpis)}</p>`, { przelacznik: false });
}

/** 402 na bramie OpenSEO dla konta bez pakietu Premium. */
function stronaOpenSeoBezPakietu(jezyk) {
  const t = teksty(jezyk);
  return szkielet(t, t.openseoTytul, `      <h1>${esc(t.openseoTytul)}</h1>
      <p class="wstep">${akapit(t.openseoOpis)}</p>`, { przelacznik: false });
}

module.exports = {
  stronaLogowania, stronaPotwierdzeniaWylogowania, stronaWylogowaniaZBramy, stronaBleduDanych,
  stronaOpenSeoBezPakietu, jezykZNaglowka, esc, T, DOSTEP,
};
