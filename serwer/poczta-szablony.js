'use strict';

// ─── Szablony e-maili PL i EN (wykonawca C, ARCH8-21, PR8-27) ────────────────
//
// Teksty: AG/runda8/agencja-strona/06-emaile.md (potwierdzenie, reset, powitanie, proba
// rejestracji na zajety adres); pozostale napisane w tym samym tonie. Kazdy e-mail ma wersje
// tekstowa (link pelnym adresem) i prosty HTML: jedna kolumna, przycisk, bez obrazkow i bez
// pikseli sledzacych, odnosniki prosto do aplikacji (bez przekierowan). Stopka z danymi
// uslugodawcy, bez linku rezygnacji (wiadomosci transakcyjne); rozliczenia wysyla Stripe.
//
// Kontrakt (WYKONANIE-A0 3.10):
//   SZABLONY: lista nazw
//   renderuj(szablon, jezyk, dane, konf) -> { temat, tekst, html }
//     dane wg szablonu (konta.js A1, platnosci.js B):
//       potwierdzenie      { odnosnik, email, godzin?, minut? }
//       reset              { odnosnik, email, minut }
//       haslo-zmienione    { email, odnosnikResetu? }
//       zmiana-email       { odnosnik, email?, nowyEmail, godzin? }   (na NOWY adres)
//       zmiana-email-info  { email, nowyEmail }                       (na dotychczasowy adres)
//       konto-usuniete     { email }
//       prog-przychodu     { rodzaj: 'kwartal'|'ue', prog, okres, przychod, limit, procent, opis } (do uslugodawcy)
//       powitanie          { pakiet?, artykulow?, kosztArtykulu?, odnosnikKlucza? }
//       konto-istnieje     { email, odnosnik }                         (proba rejestracji na zajety adres)
//       test               {}                                          (polecenie poczta-test)
//     konf: KONF serwera (uslugodawca, adresPubliczny, poczta.odpowiedz)
// Odnosnik trafia do href tylko jako adres http(s); kazda wartosc w HTML jest zabezpieczona.

const SZABLONY = [
  'potwierdzenie', 'reset', 'haslo-zmienione', 'zmiana-email', 'zmiana-email-info', 'konto-usuniete', 'prog-przychodu',
  'powitanie', 'konto-istnieje', 'test',
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

/** Adres do href albo '' (tylko http i https, bez spacji i cudzyslowow). */
function bezpiecznyOdnosnik(adres) {
  const a = String(adres || '').trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(a) && a.length <= 2000 ? a : '';
}

/** Polska odmiana liczebnika: 1 godzine, 2-4 godziny, 5+ godzin (12-14 godzin, 22-24 godziny). */
function odmiana(n, [jeden, kilka, wiele]) {
  if (n === 1) return jeden;
  const d = n % 10;
  const s = n % 100;
  return d >= 2 && d <= 4 && (s < 12 || s > 14) ? kilka : wiele;
}

/** Waznosc linku slownie: "48 godzin", "30 minut", "48 hours". */
function waznosc(d, j) {
  let minut = Number(d.minut) || 0;
  const godzin = Number(d.godzin) || (minut >= 120 && minut % 60 === 0 ? minut / 60 : 0);
  if (godzin) {
    return j === 'en' ? `${godzin} ${godzin === 1 ? 'hour' : 'hours'}` : `${godzin} ${odmiana(godzin, ['godzinę', 'godziny', 'godzin'])}`;
  }
  if (!minut) minut = 60;
  return j === 'en' ? `${minut} ${minut === 1 ? 'minute' : 'minutes'}` : `${minut} ${odmiana(minut, ['minutę', 'minuty', 'minut'])}`;
}

function hostAplikacji(konf) {
  try { return new URL(String((konf && konf.adresPubliczny) || '')).host; } catch { return ''; }
}

// Elementy tresci: napis (akapit) albo { przycisk, odnosnik }. Kazdy szablon:
//   { temat, podglad, akapity(d, k) -> [...], powod?: 'konto'|'nowy-adres'|'usuniete'|'uslugodawca'|'test', podpis? }
// k: { app, kontakt } - adres aplikacji i adres kontaktowy uslugodawcy.
const TRESCI = {
  pl: {
    powitanie: 'Dzień dobry,',
    podpis: 'Zespół Content AI',
    zapasowy: 'Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:',
    powody: {
      konto: (h) => `Dostajesz tę wiadomość, bo ten adres jest przypisany do konta w Content AI${h ? ` (${h})` : ''}.`,
      'nowy-adres': (h) => `Dostajesz tę wiadomość, bo ten adres podano jako nowy adres konta w Content AI${h ? ` (${h})` : ''}.`,
      usuniete: (h) => `Dostajesz tę wiadomość, bo ten adres był przypisany do konta w Content AI${h ? ` (${h})` : ''}.`,
      uslugodawca: () => 'Wiadomość z serwera Content AI do usługodawcy (CAI_USLUGODAWCA_EMAIL).',
      test: () => 'Wiadomość próbna wysłana poleceniem poczta-test.',
    },
    szablony: {
      potwierdzenie: {
        temat: 'Potwierdź adres e-mail w Content AI',
        podglad: 'Jedno kliknięcie i konto jest aktywne.',
        akapity: (d) => [
          `ktoś, prawdopodobnie Ty, założył konto w Content AI na adres ${d.email}. Żeby je aktywować, potwierdź adres:`,
          { przycisk: 'Potwierdź adres', odnosnik: d.odnosnik },
          `Link jest ważny ${waznosc(d, 'pl')} i działa raz. Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość: bez potwierdzenia konto nie zostanie aktywowane.`,
        ],
      },
      reset: {
        temat: 'Ustaw nowe hasło do Content AI',
        podglad: (d) => `Link jest ważny ${waznosc(d, 'pl')}.`,
        akapity: (d) => [
          `otrzymaliśmy prośbę o ustawienie nowego hasła do konta ${d.email}. Nowe hasło ustawisz tutaj:`,
          { przycisk: 'Ustaw nowe hasło', odnosnik: d.odnosnik },
          `Link jest ważny ${waznosc(d, 'pl')} i działa raz. Po zmianie hasła wylogujemy Cię na pozostałych urządzeniach.`,
          'Jeśli to nie Ty prosiłeś o zmianę, zignoruj tę wiadomość: dotychczasowe hasło działa dalej. Nikt z Content AI nigdy nie poprosi Cię o hasło ani o klucz API.',
        ],
      },
      'haslo-zmienione': {
        temat: 'Hasło do Content AI zostało zmienione',
        podglad: 'Jeśli to nie Ty, od razu ustaw nowe hasło.',
        akapity: (d, k) => [
          `hasło do konta ${d.email} w Content AI zostało zmienione. Pozostałe urządzenia zostały wylogowane.`,
          'Jeśli to Ty, nic więcej nie musisz robić.',
          `Jeśli to nie Ty, od razu ustaw nowe hasło${k.kontakt ? ` i napisz do nas na ${k.kontakt}` : ''}. Nikt z Content AI nigdy nie poprosi Cię o hasło ani o klucz API.`,
          { przycisk: 'Ustaw nowe hasło', odnosnik: d.odnosnikResetu },
        ],
      },
      'zmiana-email': {
        temat: 'Potwierdź nowy adres e-mail w Content AI',
        podglad: 'Zmiana adresu zadziała po potwierdzeniu.',
        powod: 'nowy-adres',
        akapity: (d) => [
          `ktoś, prawdopodobnie Ty, chce zmienić adres e-mail konta w Content AI na ${d.nowyEmail}. Żeby dokończyć zmianę, potwierdź ten adres:`,
          { przycisk: 'Potwierdź nowy adres', odnosnik: d.odnosnik },
          `Link jest ważny ${waznosc(d, 'pl')} i działa raz. Do czasu potwierdzenia konto loguje się dotychczasowym adresem. Jeśli to nie Ty, zignoruj tę wiadomość: adres konta się nie zmieni.`,
        ],
      },
      'zmiana-email-info': {
        temat: 'Zmiana adresu e-mail w Content AI',
        podglad: 'Jeśli to nie Ty, zmień hasło.',
        akapity: (d, k) => [
          `na koncie ${d.email} w Content AI zlecono zmianę adresu e-mail na ${d.nowyEmail}. Zmiana zadziała dopiero po potwierdzeniu nowego adresu.`,
          'Jeśli to Ty, nic więcej nie musisz robić.',
          `Jeśli to nie Ty, zaloguj się i zmień hasło w ustawieniach konta: to wyloguje wszystkie urządzenia, a niepotwierdzona zmiana adresu przepadnie.${k.kontakt ? ` Napisz też do nas na ${k.kontakt}.` : ''}`,
          { przycisk: 'Otwórz ustawienia konta', odnosnik: k.app ? `${k.app}/konto` : '' },
        ],
      },
      'konto-usuniete': {
        temat: 'Konto w Content AI zostało usunięte',
        podglad: 'Usunęliśmy konto i dane zapisane na serwerze.',
        powod: 'usuniete',
        akapity: (d, k) => [
          `konto ${d.email} w Content AI zostało usunięte razem z danymi zapisanymi na serwerze (baza wiedzy, marka). Jeśli konto miało płatny pakiet, subskrypcja została anulowana i kolejne opłaty nie zostaną pobrane.`,
          `Jeśli to nie Ty usuwałeś konto, ${k.kontakt ? `napisz do nas od razu na ${k.kontakt}` : 'odpisz od razu na tę wiadomość'}.`,
        ],
      },
      'prog-przychodu': {
        temat: (d) => `Content AI: ${d.prog}% ${d.rodzaj === 'ue' ? 'progu sprzedaży do innych krajów UE' : 'limitu przychodu w kwartale'} (${d.okres})`,
        podglad: (d) => String(d.opis || ''),
        powod: 'uslugodawca',
        podpis: 'Serwer Content AI',
        akapity: (d) => [
          `serwer Content AI odnotował próg ostrzeżenia: ${d.opis || `${d.procent}% (${d.przychod} z ${d.limit})`}.`,
          d.rodzaj === 'ue'
            ? 'To próg sprzedaży do konsumentów w innych krajach UE (PLATNOSCI_PROG_UE_EUR).'
            : 'To limit przychodu w kwartale (PLATNOSCI_PROG_KWARTAL_PLN). Przy PLATNOSCI_WSTRZYMAJ_PO_PROGU=1 serwer sam wstrzymuje nowe zakupy, które przekroczyłyby limit.',
          'Rejestr wpłat pokazuje polecenie: sudo serwer/cli.sh przychod',
        ],
      },
      powitanie: {
        temat: 'Konto w Content AI jest gotowe: trzy kroki do pierwszego artykułu',
        podglad: 'Klucz API, dokumenty, temat.',
        akapity: (d, k) => [
          `Twoje konto w Content AI jest aktywne.${d.pakiet ? ` Masz pakiet ${d.pakiet}${d.artykulow ? `: ${d.artykulow} ${odmiana(Number(d.artykulow), ['artykuł', 'artykuły', 'artykułów'])} na start` : ''}.` : ''}`,
          'Do pierwszego artykułu są trzy kroki:',
          `1. Podłącz klucz API Anthropic. Na nim powstają teksty, a koszt modelu${d.kosztArtykulu ? `, orientacyjnie ${d.kosztArtykulu} za artykuł,` : ''} rozlicza Twoje konto u Anthropic.${bezpiecznyOdnosnik(d.odnosnikKlucza) ? ` Nie masz klucza? Instrukcja krok po kroku: ${d.odnosnikKlucza}` : ''}`,
          '2. Dodaj do bazy wiedzy dokumenty firmy: ofertę, cennik, opis usług. Model pisze z nich, a nie z pamięci.',
          '3. Wpisz temat i kliknij „Wygeneruj treść”. Potem sprawdź oceny i kontrolę faktów.',
          { przycisk: 'Otwórz Content AI', odnosnik: k.app },
          'Pytania? Odpisz na tę wiadomość.',
        ],
      },
      'konto-istnieje': {
        temat: 'Próba założenia konta na Twój adres',
        podglad: 'Twoje konto i hasło pozostają bez zmian.',
        akapity: (d, k) => [
          `ktoś próbował założyć konto w Content AI na adres ${d.email}, ale to konto już istnieje. Jeśli to Ty, zaloguj się albo ustaw nowe hasło:`,
          { przycisk: 'Zaloguj się', odnosnik: k.app },
          { przycisk: 'Ustaw nowe hasło', odnosnik: d.odnosnik },
          'Jeśli to nie Ty, zignoruj tę wiadomość. Twoje konto i hasło pozostają bez zmian.',
        ],
      },
      test: {
        temat: 'Content AI: wiadomość próbna',
        podglad: 'Wysyłka poczty działa.',
        powod: 'test',
        podpis: 'Serwer Content AI',
        akapity: (d, k) => [
          `to wiadomość próbna z serwera Content AI${k.app ? ` (${k.app})` : ''}. Skoro ją widzisz, wysyłka działa.`,
          'Sprawdź w nagłówkach tej wiadomości wynik SPF, DKIM i DMARC (powinno być "pass").',
        ],
      },
    },
  },
  en: {
    powitanie: 'Hello,',
    podpis: 'The Content AI team',
    zapasowy: 'If the button does not work, copy this address into your browser:',
    powody: {
      konto: (h) => `You are receiving this message because this address belongs to a Content AI account${h ? ` (${h})` : ''}.`,
      'nowy-adres': (h) => `You are receiving this message because this address was entered as the new address of a Content AI account${h ? ` (${h})` : ''}.`,
      usuniete: (h) => `You are receiving this message because this address belonged to a Content AI account${h ? ` (${h})` : ''}.`,
      uslugodawca: () => 'A message from the Content AI server to the service provider (CAI_USLUGODAWCA_EMAIL).',
      test: () => 'A test message sent with the poczta-test command.',
    },
    szablony: {
      potwierdzenie: {
        temat: 'Confirm your email address for Content AI',
        podglad: 'One click and your account is active.',
        akapity: (d) => [
          `someone, probably you, created a Content AI account for ${d.email}. To activate it, please confirm your address:`,
          { przycisk: 'Confirm address', odnosnik: d.odnosnik },
          `The link is valid for ${waznosc(d, 'en')} and works once. If you did not create this account, ignore this message: the account stays inactive without confirmation.`,
        ],
      },
      reset: {
        temat: 'Set a new password for Content AI',
        podglad: (d) => `The link is valid for ${waznosc(d, 'en')}.`,
        akapity: (d) => [
          `we received a request to set a new password for the account ${d.email}. You can set it here:`,
          { przycisk: 'Set a new password', odnosnik: d.odnosnik },
          `The link is valid for ${waznosc(d, 'en')} and works once. After the change we will sign you out on your other devices.`,
          'If you did not ask for this, ignore this message: your current password still works. Nobody from Content AI will ever ask you for your password or API key.',
        ],
      },
      'haslo-zmienione': {
        temat: 'Your Content AI password has been changed',
        podglad: 'If this was not you, set a new password right away.',
        akapity: (d, k) => [
          `the password of the Content AI account ${d.email} has been changed. Your other devices have been signed out.`,
          'If this was you, you do not need to do anything else.',
          `If this was not you, set a new password right away${k.kontakt ? ` and write to us at ${k.kontakt}` : ''}. Nobody from Content AI will ever ask you for your password or API key.`,
          { przycisk: 'Set a new password', odnosnik: d.odnosnikResetu },
        ],
      },
      'zmiana-email': {
        temat: 'Confirm your new email address for Content AI',
        podglad: 'The change takes effect after confirmation.',
        powod: 'nowy-adres',
        akapity: (d) => [
          `someone, probably you, wants to change the email address of a Content AI account to ${d.nowyEmail}. To complete the change, please confirm this address:`,
          { przycisk: 'Confirm new address', odnosnik: d.odnosnik },
          `The link is valid for ${waznosc(d, 'en')} and works once. Until then the account keeps signing in with its current address. If this was not you, ignore this message: the address will not change.`,
        ],
      },
      'zmiana-email-info': {
        temat: 'Email address change in Content AI',
        podglad: 'If this was not you, change your password.',
        akapity: (d, k) => [
          `a change of the email address of the Content AI account ${d.email} to ${d.nowyEmail} has been requested. It takes effect only after the new address is confirmed.`,
          'If this was you, you do not need to do anything else.',
          `If this was not you, sign in and change your password in the account settings: this signs out all devices and the unconfirmed address change is dropped.${k.kontakt ? ` Please also write to us at ${k.kontakt}.` : ''}`,
          { przycisk: 'Open account settings', odnosnik: k.app ? `${k.app}/konto` : '' },
        ],
      },
      'konto-usuniete': {
        temat: 'Your Content AI account has been deleted',
        podglad: 'We deleted the account and the data stored on the server.',
        powod: 'usuniete',
        akapity: (d, k) => [
          `the Content AI account ${d.email} has been deleted together with the data stored on the server (knowledge base, brand). If the account had a paid plan, the subscription has been cancelled and no further payments will be taken.`,
          `If you did not delete this account, ${k.kontakt ? `write to us right away at ${k.kontakt}` : 'reply to this message right away'}.`,
        ],
      },
      'prog-przychodu': {
        temat: (d) => `Content AI: ${d.prog}% of the ${d.rodzaj === 'ue' ? 'EU cross-border sales threshold' : 'quarterly revenue limit'} (${d.okres})`,
        podglad: (d) => String(d.opis || ''),
        powod: 'uslugodawca',
        podpis: 'Content AI server',
        akapity: (d) => [
          `the Content AI server recorded a warning threshold: ${d.opis || `${d.procent}% (${d.przychod} of ${d.limit})`}.`,
          d.rodzaj === 'ue'
            ? 'This is the threshold for sales to consumers in other EU countries (PLATNOSCI_PROG_UE_EUR).'
            : 'This is the quarterly revenue limit (PLATNOSCI_PROG_KWARTAL_PLN). With PLATNOSCI_WSTRZYMAJ_PO_PROGU=1 the server pauses new purchases that would exceed the limit.',
          'The payment register is shown by: sudo serwer/cli.sh przychod',
        ],
      },
      powitanie: {
        temat: 'Your Content AI account is ready: three steps to your first article',
        podglad: 'API key, documents, topic.',
        akapity: (d, k) => [
          `your Content AI account is active.${d.pakiet ? ` You are on the ${d.pakiet} plan${d.artykulow ? `: ${d.artykulow} ${Number(d.artykulow) === 1 ? 'article' : 'articles'} to start` : ''}.` : ''}`,
          'Your first article takes three steps:',
          `1. Connect your Anthropic API key. It powers your drafts, and model usage${d.kosztArtykulu ? `, roughly ${d.kosztArtykulu} per article,` : ''} is billed to your Anthropic account.${bezpiecznyOdnosnik(d.odnosnikKlucza) ? ` No key yet? Step-by-step guide: ${d.odnosnikKlucza}` : ''}`,
          '2. Add your company documents to the knowledge base: your offer, pricing, service descriptions. The model writes from them, not from memory.',
          '3. Enter a topic and click “Generate content”. Then check the scores and the fact check.',
          { przycisk: 'Open Content AI', odnosnik: k.app },
          'Questions? Just reply to this message.',
        ],
      },
      'konto-istnieje': {
        temat: 'Someone tried to create an account with your address',
        podglad: 'Your account and password stay unchanged.',
        akapity: (d, k) => [
          `someone tried to create a Content AI account for ${d.email}, but that account already exists. If it was you, sign in or set a new password:`,
          { przycisk: 'Sign in', odnosnik: k.app },
          { przycisk: 'Set a new password', odnosnik: d.odnosnik },
          'If it was not you, ignore this message. Your account and password stay unchanged.',
        ],
      },
      test: {
        temat: 'Content AI: test message',
        podglad: 'Email sending works.',
        powod: 'test',
        podpis: 'Content AI server',
        akapity: (d, k) => [
          `this is a test message from the Content AI server${k.app ? ` (${k.app})` : ''}. If you can read it, sending works.`,
          'Check the SPF, DKIM and DMARC results in the headers of this message (they should say "pass").',
        ],
      },
    },
  },
};

const wartosc = (pole, d) => (typeof pole === 'function' ? pole(d) : pole);

/** Stopka: "Content AI · dane uslugodawcy · kontakt" i powod wiadomosci. */
function stopka(j, powod, konf, kontakt) {
  const u = (konf && konf.uslugodawca) || {};
  const dane = [u.imieNazwisko, u.adres].filter(Boolean).join(', ');
  const pierwsza = ['Content AI', dane, kontakt].filter(Boolean).join(' · ');
  return [pierwsza, TRESCI[j].powody[powod || 'konto'](hostAplikacji(konf))];
}

function htmlPrzycisku(tekst, odnosnik) {
  return `<p style="margin:24px 0;"><a href="${esc(odnosnik)}" style="display:inline-block;background:#111110;color:#ffffff;`
    + `text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;">${esc(tekst)}</a></p>`;
}

function renderuj(szablon, jezyk, dane = {}, konf = {}) {
  if (!SZABLONY.includes(szablon)) throw new Error(`nieznany szablon e-maila: ${szablon}`);
  const j = jezyk === 'en' ? 'en' : 'pl';
  const zestaw = TRESCI[j];
  const s = zestaw.szablony[szablon];
  const d = dane || {};
  const app = bezpiecznyOdnosnik(String((konf && konf.adresPubliczny) || '').replace(/\/+$/, ''));
  const kontakt = String((konf && konf.poczta && konf.poczta.odpowiedz) || (konf && konf.uslugodawca && konf.uslugodawca.email) || '').trim();
  const temat = String(wartosc(s.temat, d)).replace(/[\r\n]+/g, ' ').trim();
  const podglad = String(wartosc(s.podglad, d) || '');
  // Przycisk bez poprawnego adresu znika (np. haslo-zmienione bez wlaczonej poczty kont).
  const elementy = s.akapity(d, { app, kontakt })
    .map((e) => (typeof e === 'string' ? e : { ...e, odnosnik: bezpiecznyOdnosnik(e.odnosnik) }))
    .filter((e) => (typeof e === 'string' ? e.trim() : e.odnosnik));
  const przyciski = elementy.filter((e) => typeof e !== 'string');
  const podpis = s.podpis || zestaw.podpis;
  const linieStopki = stopka(j, s.powod, konf, kontakt);

  const tekst = [
    zestaw.powitanie, '',
    ...elementy.flatMap((e) => (typeof e === 'string' ? [e, ''] : [`${e.przycisk}: ${e.odnosnik}`, ''])),
    podpis, '', '--', ...linieStopki,
  ].join('\n');

  const akapit = (t) => `<p style="margin:0 0 16px;">${esc(t)}</p>`;
  const zapasowy = przyciski.length === 1
    ? `<p style="margin:0 0 16px;font-size:14px;color:#55554f;">${esc(zestaw.zapasowy)}<br><span style="word-break:break-all;">${esc(przyciski[0].odnosnik)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="${j}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${esc(temat)}</title></head><body style="margin:0;padding:0;background:#f7f6f2;">`
    + `<div style="display:none;max-height:0;overflow:hidden;">${esc(podglad)}</div>`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2;"><tr><td align="center" style="padding:24px 12px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">'
    + '<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1a1a19;">'
    + akapit(zestaw.powitanie)
    + elementy.map((e) => (typeof e === 'string' ? akapit(e) : htmlPrzycisku(e.przycisk, e.odnosnik))).join('')
    + zapasowy
    + akapit(podpis)
    + '</td></tr><tr><td style="padding:8px 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#77776f;">'
    + linieStopki.map((l) => esc(l)).join('<br>')
    + '</td></tr></table></td></tr></table></body></html>';
  return { temat, tekst, html };
}

module.exports = { SZABLONY, renderuj, odmiana, bezpiecznyOdnosnik };
