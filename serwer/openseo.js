'use strict';

/**
 * Content AI - OpenSEO za wspolnym logowaniem i we wspolnych barwach
 *
 * OpenSEO to osobna aplikacja w kontenerze. Nie forkujemy jej i nie budujemy
 * wlasnego obrazu - stoimy przed nia i robimy dwie rzeczy:
 *
 *   1. wpuszczamy tylko zalogowanych do Content AI (wersja Docker OpenSEO
 *      startuje z AUTH_MODE=local_noauth, czyli bez zadnego logowania),
 *   2. doklejamy do stron arkusz z paleta Content AI, zeby uzytkownik nie
 *      trafial nagle do obcej aplikacji.
 *
 * Dlaczego nie fork: compose.yaml OpenSEO ciagnie gotowy obraz z ghcr.io.
 * Wlasny obraz oznaczalby wlasny build przy kazdej ich wersji. Doklejanie
 * arkusza nie zaczepia sie o ich klasy, tylko o zmienne CSS daisyUI - a te
 * sa czescia publicznego kontraktu daisyUI, nie wewnetrznym detalem OpenSEO.
 *
 * Dlaczego osobny port, a nie sciezka /seo w glownej aplikacji: OpenSEO to
 * SPA z odwolaniami od korzenia (/assets/..., /api/...). Przepisywanie ich
 * wszystkich - w HTML, w bundlach JS i w WebSocketach - bylo by krucha
 * zabawa w kotka i myszke z kazda ich aktualizacja. Osobny host tego nie
 * wymaga: OpenSEO dostaje swoj korzen i nic nie wie o tym, ze stoi za nami.
 */

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

// Naglowki, ktore dotycza pojedynczego polaczenia, a nie tresci - nie wolno
// ich przekazywac dalej (RFC 9110). Transfer-encoding odpada, bo tresc
// skladamy u siebie na nowo.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Czy odpowiedz jest strona HTML - tylko w takie wstrzykujemy motyw. */
function czyHtml(naglowki) {
  return /^text\/html\b/i.test(String(naglowki['content-type'] || ''));
}

/**
 * Wstawia blok tuz przed </head>. Gdy strona nie ma <head> (zdarza sie przy
 * odpowiedziach bledu), probuje przed </body>, a w ostatecznosci dokleja na
 * poczatku - lepiej zeby styl byl nie na swoim miejscu, niz zeby go nie bylo.
 */
function wstrzyknij(html, blok) {
  const i = html.search(/<\/head\s*>/i);
  if (i !== -1) return html.slice(0, i) + blok + html.slice(i);
  const j = html.search(/<\/body\s*>/i);
  if (j !== -1) return html.slice(0, j) + blok + html.slice(j);
  return blok + html;
}

/**
 * Blok doklejany do kazdej strony: krój pisma, arkusz z paleta i trzy linijki,
 * ktore czytaja wybor jasny/ciemny zapisany przez Content AI w ciasteczku.
 * Skrypt jest bezwarunkowo bezpieczny - gdy ciasteczka nie ma, nie robi nic
 * i zostaje ustawienie systemowe.
 */
function blokMotywu(wersja) {
  return (
    '\n<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '\n<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700' +
    '&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">' +
    `\n<link rel="stylesheet" href="/__cai/motyw.css?v=${wersja}">` +
    '\n<script>(function(){try{' +
    "var m=(document.cookie.match(/(?:^|; )cai_motyw=([^;]*)/)||[])[1];" +
    "if(m==='ciemny')document.documentElement.classList.add('cai-ciemny');" +
    "else if(m==='jasny')document.documentElement.classList.add('cai-jasny');" +
    '}catch(e){}})();</script>\n'
  );
}

/** Naglowki zadania do OpenSEO: bez hop-by-hop, bez naszego ciasteczka sesji. */
function naglowkiDoGory(req, adresIp) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }

  // Token sesji Content AI nie ma czego szukac w obcej aplikacji.
  if (out.cookie) {
    const zostaja = String(out.cookie)
      .split(';')
      .filter((c) => !/^\s*cai_auth=/.test(c));
    if (zostaja.length) out.cookie = zostaja.join(';');
    else delete out.cookie;
  }

  // Bez tego OpenSEO dostaje spakowana tresc, ktorej nie umiemy rozpakowac
  // bez zaleznosci - a musimy widziec HTML, zeby wstrzyknac motyw. Ruch idzie
  // po petli zwrotnej, wiec nic to nie kosztuje; do przegladarki i tak pakuje
  // Caddy (dyrektywa `encode`).
  out['accept-encoding'] = 'identity';

  if (adresIp) {
    out['x-forwarded-for'] = adresIp;
    out['x-forwarded-host'] = req.headers.host || '';
    out['x-forwarded-proto'] = 'https';
  }
  return out;
}

/** Naglowki odpowiedzi w strone przegladarki - te same zasady. */
function naglowkiWDol(naglowki) {
  const out = {};
  for (const [k, v] of Object.entries(naglowki)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

// ─── Przepuszczanie zadan ─────────────────────────────────────────────────────

function przepusc(req, res, konf, adresIp) {
  const zadanie = http.request(
    {
      host: konf.host,
      port: konf.port,
      method: req.method,
      path: req.url,
      headers: naglowkiDoGory(req, adresIp),
      timeout: konf.timeoutMs || 120000,
    },
    (gora) => {
      const naglowki = naglowkiWDol(gora.headers);

      // Zasoby (JS, CSS, obrazy) ida prosto do przegladarki - nie ma po co
      // trzymac ich w pamieci.
      if (!czyHtml(gora.headers)) {
        res.writeHead(gora.statusCode || 502, naglowki);
        return gora.pipe(res);
      }

      // Strony skladamy u siebie, bo po wstrzyknieciu zmienia sie dlugosc.
      const kawalki = [];
      gora.on('data', (c) => kawalki.push(c));
      gora.on('end', () => {
        const html = wstrzyknij(Buffer.concat(kawalki).toString('utf8'), blokMotywu(konf.wersja));
        const cialo = Buffer.from(html, 'utf8');
        naglowki['content-length'] = String(cialo.length);
        res.writeHead(gora.statusCode || 502, naglowki);
        res.end(cialo);
      });
    }
  );

  zadanie.on('timeout', () => zadanie.destroy(new Error('przekroczony czas OpenSEO')));
  zadanie.on('error', (e) => {
    console.error('[openseo]', e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(stronaBledu(konf));
    } else {
      res.end();
    }
  });

  req.pipe(zadanie);
}

/**
 * WebSockety - OpenSEO uzywa ich do czatu z agentem. Bez tego panel dziala,
 * ale czat milczy, wiec przepuszczamy je surowym gniazdem.
 */
function przepuscUpgrade(req, gniazdo, glowa, konf, adresIp) {
  const zadanie = http.request({
    host: konf.host,
    port: konf.port,
    method: req.method,
    path: req.url,
    headers: { ...naglowkiDoGory(req, adresIp), connection: 'Upgrade', upgrade: req.headers.upgrade },
  });

  zadanie.on('upgrade', (odp, gniazdoGory, glowaGory) => {
    const linie = [`HTTP/1.1 ${odp.statusCode} ${odp.statusMessage}`];
    for (const [k, v] of Object.entries(odp.headers)) {
      for (const jedna of Array.isArray(v) ? v : [v]) linie.push(`${k}: ${jedna}`);
    }
    gniazdo.write(linie.join('\r\n') + '\r\n\r\n');
    if (glowaGory && glowaGory.length) gniazdo.unshift(glowaGory);
    gniazdoGory.pipe(gniazdo);
    gniazdo.pipe(gniazdoGory);
    gniazdoGory.on('error', () => gniazdo.destroy());
    gniazdo.on('error', () => gniazdoGory.destroy());
  });

  zadanie.on('error', (e) => {
    console.error('[openseo ws]', e.message);
    gniazdo.destroy();
  });

  if (glowa && glowa.length) zadanie.write(glowa);
  zadanie.end();
}

// ─── Strony wlasne ────────────────────────────────────────────────────────────

function stronaBledu(konf) {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<title>OpenSEO niedostępne</title>
<style>body{font-family:'IBM Plex Sans',system-ui,sans-serif;background:#07080D;color:#E9EDF6;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
div{max-width:420px;padding:32px;background:#11131D;border:1px solid #242A3B;border-radius:14px}
h1{font-size:18px;margin:0 0 12px;color:#FFB000}p{font-size:13px;color:#9DA6BC;line-height:1.6;margin:0}
code{font-family:'IBM Plex Mono',monospace;color:#46D5F2}</style></head><body>
<div><h1>OpenSEO nie odpowiada</h1>
<p>Kontener nie działa albo jeszcze wstaje. Sprawdź na serwerze:<br>
<code>sudo docker compose -f /srv/openseo/compose.yaml ps</code><br><br>
Content AI działa niezależnie - panel treści jest sprawny.</p></div></body></html>`;
}

// ─── Wpiecie ──────────────────────────────────────────────────────────────────

/**
 * Zwraca funkcje obslugujace zadania na porcie OpenSEO.
 *
 * Zaleznosci przychodza z zewnatrz (sesjaZadania, obslugaLogowania,
 * stronaLogowania, adresIp), zeby nie robic petli w require - server.js
 * wciaga ten plik, a nie odwrotnie.
 */
function utworz(konf, zaleznosci) {
  const { sesjaZadania, obslugaLogowania, stronaLogowania, adresIp } = zaleznosci;
  const plikMotywu = path.join(__dirname, '..', 'app', 'openseo-motyw.css');

  // Wersja w adresie arkusza zmienia sie przy kazdym starcie - inaczej
  // przegladarka trzymalaby stara palete po aktualizacji.
  let motyw = null;
  try {
    motyw = fs.readFileSync(plikMotywu);
  } catch (e) {
    console.warn('[openseo] brak app/openseo-motyw.css - strony pojda bez palety Content AI');
  }
  const pelnaKonf = { ...konf, wersja: motyw ? motyw.length : 0 };

  async function obsluz(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Arkusz serwujemy sami - w kontenerze OpenSEO go nie ma.
    if (url.pathname === '/__cai/motyw.css') {
      if (!motyw) return res.writeHead(404).end();
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Content-Length': String(motyw.length),
        'Cache-Control': 'public, max-age=3600',
      });
      return res.end(motyw);
    }

    // Logowanie obslugujemy u siebie, tym samym ekranem co Content AI.
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      return obslugaLogowania(req, res);
    }

    if (!sesjaZadania(req)) {
      return res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(stronaLogowania('Zaloguj się, żeby wejść do OpenSEO.'));
    }

    return przepusc(req, res, pelnaKonf, adresIp(req));
  }

  function obsluzUpgrade(req, gniazdo, glowa) {
    if (!sesjaZadania(req)) return gniazdo.destroy();
    return przepuscUpgrade(req, gniazdo, glowa, pelnaKonf, adresIp(req));
  }

  return { obsluz, obsluzUpgrade };
}

module.exports = {
  utworz,
  czyHtml,
  wstrzyknij,
  blokMotywu,
  naglowkiDoGory,
  naglowkiWDol,
  HOP_BY_HOP,
};
