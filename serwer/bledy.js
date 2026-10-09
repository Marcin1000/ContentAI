'use strict';

// ─── Kody bledow dla aplikacji (PROJEKT-TECHNICZNY rozdz. 5) ─────────────────
//
// Kazda wlasna odmowa serwera ma naglowek `X-CAI-Kod: <kod>` i cialo w ksztalcie
// bledu dostawcy (parsery aplikacji czytaja error.message), plus pola wlasne:
//
//   { "type": "error", "error": { "type": "cai_brak_klucza", "message": "..." },
//     "kod": "brak-klucza", "komunikat": "...", "dostawca": "anthropic" }
//
// Dzisiejsze odpowiedzi (401 "Niezalogowany", 402 limitu i bramki pakietu)
// zachowuja WSZYSTKIE swoje pola, takze `error` jako napis (aplikacja rozpoznaje
// po tym blad wlasny serwera), i dostaja tylko `kod`, `komunikat` i naglowek:
//   bladCai(res, 'limit-pakietu', 402, odmowa)    // odmowa.error zostaje napisem
//
// Komunikat jest zapasowy (jezyk z Accept-Language); aplikacja ma wlasne teksty
// po kodzie. Odpowiedzi dostawcow AI przechodza bez zmian i bez X-CAI-Kod
// (wyjatek: zly-klucz, ktory dokleja sam naglowek - patrz naglowekKodu).

const KODY = {
  sesja: {
    status: 401,
    pl: 'Sesja wygasła. Zaloguj się ponownie.',
    en: 'Your session has expired. Please sign in again.',
  },
  'brak-klucza': {
    status: 403,
    pl: 'Podłącz własny klucz {dostawca}, żeby korzystać z tej funkcji.',
    en: 'Connect your own {dostawca} key to use this feature.',
  },
  'zly-klucz': {
    status: 401,
    pl: 'Dostawca {dostawca} odrzucił Twój klucz. Sprawdź go albo wpisz nowy.',
    en: '{dostawca} rejected your key. Check it or enter a new one.',
  },
  'limit-pakietu': {
    status: 402,
    pl: 'Limit pakietu wyczerpany.',
    en: 'Your plan limit has been reached.',
  },
  'funkcja-poza-pakietem': {
    status: 402,
    pl: 'Ta funkcja nie wchodzi w Twój pakiet.',
    en: 'This feature is not included in your plan.',
  },
  'zasob-serwera-wyczerpany': {
    status: 402,
    pl: 'Wyczerpano pulę zasobów serwera w Twoim pakiecie.',
    en: 'You have used up the server resources included in your plan.',
  },
  'email-niepotwierdzony': {
    status: 403,
    pl: 'Potwierdź adres e-mail, żeby korzystać z tej funkcji.',
    en: 'Confirm your email address to use this feature.',
  },
  'zgoda-wymagana': {
    status: 403,
    pl: 'Zaakceptuj nową wersję regulaminu, żeby kontynuować.',
    en: 'Accept the new version of the terms to continue.',
  },
  'uprawnienia-organizacji': {
    status: 403,
    pl: 'To ustawienie zmienia właściciel konta organizacji.',
    en: 'Only the owner of the organisation account can change this.',
  },
  'platnosci-wylaczone': {
    status: 404,
    pl: 'Płatności są wyłączone na tym serwerze.',
    en: 'Payments are disabled on this server.',
  },
  'sprzedaz-wstrzymana': {
    status: 403,
    pl: 'Sprzedaż pakietów jest chwilowo wstrzymana. Zarządzanie subskrypcją działa.',
    en: 'Plan sales are paused for now. Subscription management still works.',
  },
  'zakup-niedozwolony': {
    status: 403,
    pl: 'Pakiet tego konta zmienia administrator.',
    en: 'The plan of this account is managed by the administrator.',
  },
  'plan-niedostepny': {
    status: 400,
    pl: 'Ten pakiet nie jest dostępny w wybranej walucie.',
    en: 'This plan is not available in the selected currency.',
  },
  'subskrypcja-istnieje': {
    status: 409,
    pl: 'Masz już aktywną subskrypcję. Zmienisz ją w panelu subskrypcji.',
    en: 'You already have an active subscription. Change it in the subscription portal.',
  },
  'brak-subskrypcji': {
    status: 409,
    pl: 'To konto nie ma subskrypcji.',
    en: 'This account has no subscription.',
  },
  'dostawca-platnosci-niedostepny': {
    status: 503,
    pl: 'Operator płatności nie odpowiada. Spróbuj za chwilę.',
    en: 'The payment provider is not responding. Please try again shortly.',
  },
  'za-duzo-prob': {
    status: 429,
    pl: 'Za dużo prób. Spróbuj ponownie za {ponowZa} s.',
    en: 'Too many attempts. Try again in {ponowZa} s.',
  },
  // Zaslepka etapu 0: trasa ma kontrakt, ale modul jeszcze nie jest wdrozony.
  niezaimplementowane: {
    status: 501,
    pl: 'Ta funkcja nie jest jeszcze dostępna na tym serwerze.',
    en: 'This feature is not available on this server yet.',
  },
};

const NAZWY_DOSTAWCOW = { anthropic: 'Anthropic', openai: 'OpenAI', eleven: 'ElevenLabs', nvidia: 'NVIDIA' };

/** Jezyk zapasowego komunikatu z Accept-Language (pierwszy z pl/en wg wag; domyslnie pl). */
function jezykZadania(req) {
  const naglowek = String((req && req.headers && req.headers['accept-language']) || '');
  const pozycje = naglowek.split(',').map((c, i) => {
    const [tag, ...param] = c.trim().toLowerCase().split(';');
    const q = param.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { tag: tag.trim(), q: q ? Number(q.slice(2)) || 0 : 1, i };
  }).filter((p) => p.tag && p.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const p of pozycje) {
    if (p.tag === 'pl' || p.tag.startsWith('pl-')) return 'pl';
    if (p.tag === 'en' || p.tag.startsWith('en-')) return 'en';
  }
  return 'pl';
}

/** Tekst komunikatu dla kodu w jezyku, z podstawionymi polami ({dostawca}, {ponowZa}). */
function komunikat(kod, jezyk = 'pl', pola = {}) {
  const wpis = KODY[kod];
  if (!wpis) return '';
  const szablon = wpis[jezyk === 'en' ? 'en' : 'pl'];
  return szablon.replace(/\{(\w+)\}/g, (_, nazwa) => {
    if (nazwa === 'dostawca') return NAZWY_DOSTAWCOW[pola.dostawca] || String(pola.dostawca || '');
    return pola[nazwa] === undefined ? '' : String(pola[nazwa]);
  });
}

/** Cialo bledu bez wysylania (np. do zadan w tle albo testow). */
function cialoBledu(kod, pola = {}, jezyk = 'pl') {
  const tekst = komunikat(kod, jezyk, pola);
  return {
    type: 'error',
    error: { type: `cai_${String(kod).replace(/-/g, '_')}`, message: tekst },
    kod,
    komunikat: tekst,
    ...pola,
  };
}

/** Ustawia sam naglowek kodu (np. zly-klucz na odpowiedzi dostawcy przepuszczanej bez zmian). */
function naglowekKodu(res, kod, dodatkowe = {}) {
  if (!res || res.headersSent) return;
  res.setHeader('X-CAI-Kod', kod);
  for (const [k, v] of Object.entries(dodatkowe)) res.setHeader(k, v);
}

/**
 * Wysyla wlasna odmowe serwera: status, X-CAI-Kod, cialo JSON.
 *   bladCai(res, kod, status, pola)  status domyslnie z tabeli KODY
 * `pola` dokleja sie na koncu, wiec moze nadpisac `error` (dzisiejsze odpowiedzi z napisem).
 */
function bladCai(res, kod, status, pola = {}) {
  if (!res || res.headersSent || res.destroyed) return;
  if (!KODY[kod]) throw new Error(`bladCai: nieznany kod "${kod}"`);
  const jezyk = jezykZadania(res.req);
  const tresc = JSON.stringify(cialoBledu(kod, pola, jezyk));
  res.writeHead(status || KODY[kod].status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(tresc),
    'X-CAI-Kod': kod,
  });
  res.end(tresc);
}

module.exports = { KODY, bladCai, cialoBledu, komunikat, naglowekKodu, jezykZadania };
