'use strict';

// ─── Ekrany platnosci (wykonawca B, ARCH8-19, PR8-10, PR8-11, PR8-31) ────────
//
// Ekrany serwera bez JavaScriptu, jak serwer/logowanie.js (ten sam szkielet, tokeny i fonty):
//   ekranZakupu(...)         GET /konto/zakup: podsumowanie pakietu, przelacznik waluty (odnosniki),
//                            dwa osobne pola zgody (regulamin z pouczeniem o odstapieniu; zadanie
//                            rozpoczecia swiadczenia przed uplywem 14 dni), informacja o krajach UE,
//                            dane uslugodawcy, "Przejdz do platnosci" -> POST /konto/zakup -> 303 do dostawcy
//   ekranOdstapienia(...)    GET /konto/odstapienie: drugi krok odstapienia (art. 11a dyrektywy 2011/83/UE):
//                            dane umowy, szacunek zwrotu, "Potwierdz odstapienie od umowy"
//   ekranKomunikatu(...)     wynik odstapienia, odmowy (subskrypcja istnieje, sprzedaz wstrzymana...)
//   sekcjaKonta(...)         fragment HTML dla ekranu /konto (A1): pakiet, panel subskrypcji, odstapienie,
//                            rachunek na zadanie; formularz panelu wymaga CSP z cspPlatnosci (platnosci.cspEkranu)
//   cspPlatnosci(cspBazowa, hosty)   CSP z hostami dostawcy w form-action: przegladarki stosuja form-action
//                            takze do przekierowania 303 po wyslaniu formularza (S11)
// Teksty PL/EN: prawo (zgody-i-komunikaty.md pkt 3, 6, 9) i agencja-strona (05-mikroteksty.md rozdz. 8, 9);
// nigdzie nazwy dokumentu sprzedazy z VAT (PR8-11): potwierdzenie platnosci wysyla Stripe, rachunek na prosbe.

const logowanie = require('./logowanie.js');

const { esc, akapit } = logowanie;

const T = {
  pl: {
    locale: 'pl-PL',
    stopka: 'Płatności obsługuje Stripe. Dane karty nie trafiają do Content AI.',
    trybTestowy: 'Tryb testowy płatności: karta testowa Stripe, bez prawdziwych pieniędzy.',
    zakupTytul: 'Pakiet {pakiet} · Content AI',
    zakupNaglowek: 'Pakiet {pakiet}',
    zakupWstep: 'Płacisz co miesiąc z góry, zrezygnujesz w każdej chwili.',
    miesiecznie: 'miesięcznie',
    waluta: 'Waluta:',
    walutaWymuszona: 'Płacisz w {waluta}, tak jak przy poprzedniej subskrypcji tego konta.',
    innyPakiet: 'Wolisz pakiet {pakiet}?',
    zobacz: 'Zobacz pakiet {pakiet}',
    podsumowanie: 'Pakiet {pakiet}: {cena} miesięcznie. Płatność z góry, subskrypcja odnawia się automatycznie co miesiąc, dopóki z niej nie zrezygnujesz. Zrezygnować możesz w każdej chwili w ustawieniach konta; pakiet działa do końca opłaconego miesiąca. Cena jest ceną końcową. Do generowania potrzebny jest Twój klucz API; opłaty u dostawców AI nie są wliczone w cenę.',
    zgodaRegulaminPrzed: 'Akceptuję ',
    regulamin: 'Regulamin',
    zgodaRegulaminSrodek: ' i zapoznałem się z ',
    pouczenie: 'pouczeniem o prawie odstąpienia',
    zgodaRegulaminPo: '.',
    zgodaWykonanie: 'Żądam rozpoczęcia świadczenia usługi przed upływem 14 dni na odstąpienie od umowy. Wiem, że jeśli odstąpię od umowy, zapłacę za okres, w którym pakiet był dostępny.',
    zgodaWykonaniePelny: 'Żądam rozpoczęcia świadczenia usługi przed upływem 14 dni na odstąpienie od umowy. Wiem, że mogę odstąpić od umowy w ciągu 14 dni i otrzymać zwrot całej kwoty.',
    kraje: 'Sprzedajemy klientom z adresem rozliczeniowym w Unii Europejskiej. Zamówienie z adresem spoza Unii anulujemy i zwrócimy całą kwotę.',
    przycisk: 'Przejdź do płatności · {cena}',
    stripe: 'Płatność obsługuje Stripe. Potwierdzenie płatności wyśle Stripe, rachunek wystawimy na prośbę: {email}.',
    stripeBezEmaila: 'Płatność obsługuje Stripe. Potwierdzenie płatności wyśle Stripe, rachunek wystawimy na prośbę.',
    wrocAplikacja: 'Wróć do aplikacji',
    wrocKonto: 'Wróć do konta',
    bladZgody: 'Zaznacz oba pola zgody, żeby przejść do płatności.',
    subskrypcjaIstnieje: 'Masz już subskrypcję pakietu {pakiet}. Pakiet zmienisz, kartę zaktualizujesz albo subskrypcję anulujesz w panelu subskrypcji.',
    subskrypcjaIstniejeTytul: 'Masz już subskrypcję',
    panel: 'Zarządzaj subskrypcją',
    panelOpis: 'Otworzy się panel Stripe. Zmienisz w nim pakiet albo kartę, pobierzesz potwierdzenia płatności i anulujesz subskrypcję.',
    niedostepnyTytul: 'Zakup niedostępny',
    zakupNiedozwolony: 'Pakiet tego konta zmienia administrator.',
    sprzedazWstrzymana: 'Sprzedaż pakietów jest chwilowo wstrzymana. Zarządzanie subskrypcją działa.',
    planNiedostepny: 'Ten pakiet nie jest teraz dostępny w wybranej walucie.',
    zaDuzoProb: 'Za dużo prób w krótkim czasie. Spróbuj ponownie za {min} min.',
    dostawcaNiedostepny: 'Operator płatności nie odpowiada. Nic nie pobraliśmy. Spróbuj za chwilę.',
    platnosciWylaczone: 'Płatności są wyłączone na tym serwerze.',
    obcaPlatnosc: 'Ta płatność należy do innego konta. Zaloguj się na konto, z którego ją rozpocząłeś.',
    uslugodawca: 'Content AI prowadzi {nazwa}{adres}. Kontakt: {kontakt}.',
    tel: 'tel. {telefon}',
    odstTytul: 'Odstąpienie od umowy · Content AI',
    odstNaglowek: 'Odstąpienie od umowy',
    odstWstep: 'Możesz odstąpić od umowy o subskrypcję pakietu {pakiet} w ciągu 14 dni od jej zawarcia, bez podania przyczyny.',
    odstUmowa: 'Umowa',
    odstUmowaWartosc: 'Subskrypcja Content AI, pakiet {pakiet}',
    odstZawarta: 'Zawarta',
    odstTermin: 'Termin na odstąpienie',
    odstKonto: 'Konto',
    odstZwrot: 'Zwrot',
    odstZwrotProp: '{kwota} (pakiet był dostępny {dni} z {okres} dni; zwracamy kwotę za pozostałe dni)',
    odstZwrotPelny: '{kwota} (cała zapłacona kwota)',
    odstZwrotZero: 'brak (nie pobraliśmy żadnej płatności)',
    odstSkutek: 'Subskrypcja skończy się od razu, a konto przejdzie na pakiet Darmowy (bez nowej puli darmowych artykułów). Potwierdzenie wyślemy e-mailem.',
    odstPrzycisk: 'Potwierdź odstąpienie od umowy',
    odstNiemozliweTytul: 'Odstąpienie niedostępne',
    odstPoTerminie: 'Termin na odstąpienie od tej umowy minął {data}. Subskrypcję możesz anulować w panelu subskrypcji: pakiet działa do końca opłaconego okresu.',
    odstBrak: 'To konto nie ma umowy, od której można odstąpić.',
    odstZlozone: 'Oświadczenie o odstąpieniu od tej umowy już do nas dotarło ({data}).',
    odstWynikNaglowek: 'Odstąpienie przyjęte',
    odstWynik: 'Otrzymaliśmy Twoje oświadczenie o odstąpieniu od umowy o subskrypcję pakietu {pakiet}, złożone {data}. Subskrypcja została zakończona, konto działa w pakiecie Darmowym.',
    odstWynikZwrot: 'Zwrot: {kwota} na kartę użytą do płatności, najpóźniej do {termin}.',
    odstWynikBezZwrotu: 'Nie pobraliśmy żadnej płatności, więc nie ma czego zwracać.',
    odstBlad: 'Oświadczenie zapisaliśmy, ale operator płatności chwilowo nie odpowiada. Zakończymy subskrypcję i zlecimy zwrot najszybciej, jak się da; potwierdzenie przyjdzie e-mailem. Możesz też spróbować ponownie za chwilę.',
    sekcjaTytul: 'Pakiet i płatności',
    sekcjaAktywna: 'Pakiet {pakiet}, aktywny. Odnowienie {data}.',
    sekcjaProbna: 'Pakiet {pakiet}, okres próbny do {data}.',
    sekcjaAnulowana: 'Subskrypcja anulowana. Pakiet {pakiet} działa do {data}, potem konto przejdzie na pakiet Darmowy.',
    sekcjaZalegla: 'Nie udało się pobrać opłaty za pakiet {pakiet}. Zaktualizuj kartę do {data}, żeby pakiet działał bez przerwy.',
    sekcjaWygasla: 'Pakiet {pakiet} wygasł. Konto działa w pakiecie Darmowym.',
    sekcjaBrak: 'Konto działa w pakiecie, który przydzielił serwer. Pakiet płatny wybierzesz poniżej.',
    sekcjaWybierz: 'Wybierz pakiet',
    sekcjaOdstap: 'Odstąp od umowy tutaj',
    sekcjaOdstapOpis: 'Kupiłeś pakiet mniej niż 14 dni temu? Możesz odstąpić od umowy do {data}.',
    sekcjaRachunek: 'Rachunek wystawiamy na prośbę: napisz na {email} w ciągu 3 miesięcy od końca miesiąca płatności i podaj jej datę.',
    cechy: {
      artykul: (n) => (n === null ? 'bez limitu artykułów' : `${n} ${odmiana(n, ['artykuł', 'artykuły', 'artykułów'])} miesięcznie`),
      grafika: (n) => (n === null ? 'bez limitu grafik' : `${n} ${odmiana(n, ['grafika', 'grafiki', 'grafik'])}`),
      audio: (n) => (n === null ? 'bez limitu nagrań audio' : `${n} ${odmiana(n, ['nagranie audio', 'nagrania audio', 'nagrań audio'])}`),
      transkrypcja: (n) => (n === null ? 'bez limitu transkrypcji' : `${n} ${odmiana(n, ['transkrypcja', 'transkrypcje', 'transkrypcji'])}`),
      dokumenty: (n) => (n === null ? 'baza wiedzy bez limitu dokumentów' : `baza wiedzy do ${n} ${n === 1 ? 'dokumentu' : 'dokumentów'}`),
      serp: 'analiza wyników Google (SERP) i luk w tekście',
      cms: 'publikacja do WordPressa i Drupala',
    },
  },
  en: {
    locale: 'en-IE',
    stopka: 'Payments are handled by Stripe. Card details never reach Content AI.',
    trybTestowy: 'Payment test mode: Stripe test card, no real money.',
    zakupTytul: '{pakiet} plan · Content AI',
    zakupNaglowek: '{pakiet} plan',
    zakupWstep: 'You pay monthly in advance and can cancel at any time.',
    miesiecznie: 'per month',
    waluta: 'Currency:',
    walutaWymuszona: 'You pay in {waluta}, as with this account\'s previous subscription.',
    innyPakiet: 'Prefer the {pakiet} plan?',
    zobacz: 'See the {pakiet} plan',
    podsumowanie: '{pakiet} plan: {cena} per month. Paid in advance; the subscription renews automatically every month until you cancel. You can cancel at any time in account settings; the plan stays active until the end of the paid month. The price is the final price. Generation requires your own API key; AI provider fees are not included.',
    zgodaRegulaminPrzed: 'I accept the ',
    regulamin: 'Terms of Service',
    zgodaRegulaminSrodek: ' and have read the ',
    pouczenie: 'information on the right of withdrawal',
    zgodaRegulaminPo: '.',
    zgodaWykonanie: 'I request that the service begins before the 14-day withdrawal period ends. I understand that if I withdraw, I will pay for the period in which the plan was available.',
    zgodaWykonaniePelny: 'I request that the service begins before the 14-day withdrawal period ends. I understand that I can withdraw within 14 days and receive a full refund.',
    kraje: 'We sell to customers with a billing address in the European Union. Orders with a billing address outside the EU are cancelled and fully refunded.',
    przycisk: 'Continue to payment · {cena}',
    stripe: 'Payment is handled by Stripe. Stripe sends the payment confirmation; we issue a receipt on request: {email}.',
    stripeBezEmaila: 'Payment is handled by Stripe. Stripe sends the payment confirmation; we issue a receipt on request.',
    wrocAplikacja: 'Back to the app',
    wrocKonto: 'Back to your account',
    bladZgody: 'Tick both consent boxes to continue to payment.',
    subskrypcjaIstnieje: 'You already have a {pakiet} subscription. Change the plan, update the card or cancel in the subscription portal.',
    subskrypcjaIstniejeTytul: 'You already have a subscription',
    panel: 'Manage subscription',
    panelOpis: 'This opens the Stripe portal, where you can change your plan or card, download payment confirmations and cancel your subscription.',
    niedostepnyTytul: 'Purchase unavailable',
    zakupNiedozwolony: 'The plan of this account is managed by the administrator.',
    sprzedazWstrzymana: 'Plan sales are paused for now. Subscription management still works.',
    planNiedostepny: 'This plan is not available in the selected currency right now.',
    zaDuzoProb: 'Too many attempts in a short time. Try again in {min} min.',
    dostawcaNiedostepny: 'The payment provider is not responding. Nothing was charged. Please try again shortly.',
    platnosciWylaczone: 'Payments are disabled on this server.',
    obcaPlatnosc: 'This payment belongs to another account. Sign in to the account you started it from.',
    uslugodawca: 'Content AI is run by {nazwa}{adres}. Contact: {kontakt}.',
    tel: 'tel. {telefon}',
    odstTytul: 'Withdrawal from the contract · Content AI',
    odstNaglowek: 'Withdrawal from the contract',
    odstWstep: 'You can withdraw from the {pakiet} subscription contract within 14 days of concluding it, without giving any reason.',
    odstUmowa: 'Contract',
    odstUmowaWartosc: 'Content AI subscription, {pakiet} plan',
    odstZawarta: 'Concluded',
    odstTermin: 'Withdrawal deadline',
    odstKonto: 'Account',
    odstZwrot: 'Refund',
    odstZwrotProp: '{kwota} (the plan was available for {dni} of {okres} days; we refund the remaining days)',
    odstZwrotPelny: '{kwota} (the full amount paid)',
    odstZwrotZero: 'none (nothing was charged)',
    odstSkutek: 'The subscription ends immediately and the account moves to the Free plan (without a new pool of free articles). We will confirm by email.',
    odstPrzycisk: 'Confirm withdrawal from the contract',
    odstNiemozliweTytul: 'Withdrawal unavailable',
    odstPoTerminie: 'The withdrawal period for this contract ended on {data}. You can cancel the subscription in the subscription portal: the plan stays active until the end of the paid period.',
    odstBrak: 'This account has no contract to withdraw from.',
    odstZlozone: 'We have already received the notice of withdrawal from this contract ({data}).',
    odstWynikNaglowek: 'Withdrawal received',
    odstWynik: 'We have received your notice of withdrawal from the {pakiet} subscription contract, submitted on {data}. The subscription has ended and the account is on the Free plan.',
    odstWynikZwrot: 'Refund: {kwota} to the card used for payment, no later than {termin}.',
    odstWynikBezZwrotu: 'Nothing was charged, so there is nothing to refund.',
    odstBlad: 'We have recorded your notice, but the payment provider is not responding right now. We will end the subscription and issue the refund as soon as possible; you will get an email confirmation. You can also try again shortly.',
    sekcjaTytul: 'Plan and billing',
    sekcjaAktywna: '{pakiet} plan, active. Renews on {data}.',
    sekcjaProbna: '{pakiet} plan, trial until {data}.',
    sekcjaAnulowana: 'Subscription cancelled. Your {pakiet} plan stays active until {data}, then your account moves to the Free plan.',
    sekcjaZalegla: 'We could not collect the payment for your {pakiet} plan. Update your card by {data} to keep the plan running without a break.',
    sekcjaWygasla: 'Your {pakiet} plan has ended. Your account is on the Free plan.',
    sekcjaBrak: 'Your account is on the plan assigned by the server. You can choose a paid plan below.',
    sekcjaWybierz: 'Choose a plan',
    sekcjaOdstap: 'Withdraw from the contract here',
    sekcjaOdstapOpis: 'Bought the plan less than 14 days ago? You can withdraw from the contract until {data}.',
    sekcjaRachunek: 'We issue a receipt on request: write to {email} within 3 months of the end of the month of payment, giving its date.',
    cechy: {
      artykul: (n) => (n === null ? 'unlimited articles' : `${n} ${n === 1 ? 'article' : 'articles'} per month`),
      grafika: (n) => (n === null ? 'unlimited images' : `${n} ${n === 1 ? 'image' : 'images'}`),
      audio: (n) => (n === null ? 'unlimited audio recordings' : `${n} audio ${n === 1 ? 'recording' : 'recordings'}`),
      transkrypcja: (n) => (n === null ? 'unlimited transcriptions' : `${n} ${n === 1 ? 'transcription' : 'transcriptions'}`),
      dokumenty: (n) => (n === null ? 'knowledge base with unlimited documents' : `knowledge base up to ${n} ${n === 1 ? 'document' : 'documents'}`),
      serp: 'Google results (SERP) and content gap analysis',
      cms: 'publishing to WordPress and Drupal',
    },
  },
};

/** Odmiana polska: 1 artykul, 2-4 artykuly, 5+ artykulow (12-14 jak 5+). */
function odmiana(n, [jeden, kilka, wiele]) {
  if (n === 1) return jeden;
  const d = n % 10;
  const s = n % 100;
  return d >= 2 && d <= 4 && (s < 12 || s > 14) ? kilka : wiele;
}

function teksty(jezyk) { return T[jezyk === 'en' ? 'en' : 'pl']; }

function wstaw(szablon, pola = {}) {
  return String(szablon).replace(/\{(\w+)\}/g, (_, k) => (pola[k] === undefined || pola[k] === null ? '' : String(pola[k])));
}

/** Kwota w jednostkach najmniejszych -> tekst w jezyku ekranu (79,00 zl; €19.00). */
function kwotaTekst(kwota, waluta, jezyk = 'pl') {
  if (kwota === null || kwota === undefined || !waluta) return '';
  try {
    return new Intl.NumberFormat(teksty(jezyk).locale, { style: 'currency', currency: String(waluta).toUpperCase() }).format(Number(kwota) / 100);
  } catch {
    return `${(Number(kwota) / 100).toFixed(2)} ${String(waluta).toUpperCase()}`;
  }
}

/** Data (ms) w strefie Warszawy: "23 października 2026" / "23 October 2026"; z godzina: opcja. */
function dataTekst(ms, jezyk = 'pl', { godzina = false } = {}) {
  if (!ms) return '';
  const opcje = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' };
  if (godzina) Object.assign(opcje, { hour: '2-digit', minute: '2-digit' });
  try {
    return new Intl.DateTimeFormat(jezyk === 'en' ? 'en-GB' : 'pl-PL', opcje).format(new Date(Number(ms)));
  } catch {
    return new Date(Number(ms)).toISOString().slice(0, godzina ? 16 : 10).replace('T', ' ');
  }
}

/** Cechy pakietu z tabeli plany.js (te same liczby co limity, bez obietnic spoza pakietu). */
function cechyPakietu(plan, jezyk) {
  const c = teksty(jezyk).cechy;
  const wynik = [];
  const l = plan.limity || {};
  if (l.artykul !== 0 && l.artykul !== undefined) wynik.push(c.artykul(l.artykul));
  if (l.grafika !== 0 && l.grafika !== undefined) wynik.push(c.grafika(l.grafika));
  if (l.audio !== 0 && l.audio !== undefined) wynik.push(c.audio(l.audio));
  if (l.transkrypcja !== 0 && l.transkrypcja !== undefined) wynik.push(c.transkrypcja(l.transkrypcja));
  if (plan.limitDokumentow !== undefined) wynik.push(c.dokumenty(plan.limitDokumentow));
  if (plan.funkcje && plan.funkcje.serp) wynik.push(c.serp);
  if (plan.funkcje && plan.funkcje.cms) wynik.push(c.cms);
  return wynik;
}

function nazwaPakietu(plan, jezyk) {
  if (!plan) return '';
  return jezyk === 'en' ? plan.nazwaEn || plan.nazwa : plan.nazwa;
}

const STYL_PLATNOSCI = `<style>
.pasek-testowy{margin:0 0 20px;padding:10px 12px;border:1px solid var(--c-info-ramka);border-radius:var(--r-md);background:var(--c-info-tlo);color:var(--c-info);font-size:13px;line-height:1.45}
.plan{margin:0 0 18px;padding:16px;border:1px solid var(--c-linia-2);border-radius:var(--r-md);background:var(--c-panel)}
.cena{margin:0 0 10px;font:600 26px/1.2 var(--f-ui)}
.cena span{font:400 14px/1 var(--f-ui);color:var(--c-tekst-2)}
.cechy{margin:0;padding-left:18px;color:var(--c-tekst-2);font-size:14px;line-height:1.55}
.waluty{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px;font-size:14px;color:var(--c-tekst-2)}
.waluty a,.waluty strong{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--c-linia-2);border-radius:var(--r-sm);color:var(--c-tekst);text-decoration:none;font-weight:600}
.waluty strong{border-color:var(--c-akcent);background:var(--c-akcent-tlo)}
.drobne{margin:0 0 14px;color:var(--c-tekst-2);font-size:13px;line-height:1.5}
.zgoda{display:flex;gap:10px;align-items:flex-start;margin:0 0 14px}
.zgoda input[type="checkbox"]{display:inline-block;flex:none;width:20px;height:20px;margin:2px 0 0;padding:0;accent-color:var(--c-akcent)}
.zgoda label{display:inline;margin:0;font:400 14px/1.45 var(--f-ui);color:var(--c-tekst)}
.dane{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 18px;font-size:14px}
.dane dt{color:var(--c-tekst-2)}
.dane dd{margin:0}
.uslugodawca{margin:24px 0 0;color:var(--c-tekst-3);font-size:12px;line-height:1.5}
.inny{margin:0 0 18px;font-size:14px;color:var(--c-tekst-2)}
.inny a{display:inline-flex;align-items:center;min-height:44px}
.drobne.odstep{margin-top:16px}
</style>`;

/** Teksty szkieletu logowania z wlasna stopka ekranow platnosci. */
function tSzkieletu(jezyk) {
  return { ...logowanie.teksty(jezyk), stopka: teksty(jezyk).stopka };
}

function pasekTestowy(tryb, jezyk) {
  return tryb === 'test' ? `      <p class="pasek-testowy" role="status">${akapit(teksty(jezyk).trybTestowy)}</p>\n` : '';
}

/** Stopka z danymi uslugodawcy (art. 5 ustawy o swiadczeniu uslug droga elektroniczna). */
function stopkaUslugodawcy(u, jezyk) {
  const t = teksty(jezyk);
  if (!u || !u.imieNazwisko) return '';
  const kontakt = [u.email, u.telefon ? wstaw(t.tel, { telefon: u.telefon }) : ''].filter(Boolean).join(', ');
  return `      <p class="uslugodawca">${akapit(wstaw(t.uslugodawca, { nazwa: u.imieNazwisko, adres: u.adres ? `, ${u.adres}` : '', kontakt: kontakt || '-' }))}</p>\n`;
}

function komunikatBledu(tekst, id = 'komunikat') {
  if (!tekst) return '';
  return `      <p class="komunikat" id="${id}" role="alert" aria-live="assertive">${logowanie.IKONA_BLEDU}<span>${esc(tekst)}</span></p>\n`;
}

function komunikatInfo(tekst, id = 'komunikat') {
  if (!tekst) return '';
  return `      <p class="komunikat info" id="${id}" role="status" aria-live="polite">${logowanie.IKONA_INFO}<span>${esc(tekst)}</span></p>\n`;
}

function adresWroc(z) { return z === 'konto' ? '/konto' : '/'; }

/**
 * GET /konto/zakup. Wszystkie dane przychodza gotowe (bez bazy i sieci).
 *   ekranZakupu({ jezyk, plan, plany: [{ plan, nazwa, nazwaEn, limity, funkcje, limitDokumentow }], waluta, waluty,
 *     wymuszona, kwota, inne: [{ plan, nazwa }], uslugodawca, tryb, z, blad, zwrot, adresy: { regulamin, odstapienie } })
 */
function ekranZakupu({
  jezyk = 'pl', plan, pakiet, waluta, waluty = [], wymuszona = false, kwota, inne = [], uslugodawca = {}, tryb = '',
  z = 'app', blad = '', zwrot = 'proporcjonalny', adresy = {},
} = {}) {
  const t = teksty(jezyk);
  const nazwa = nazwaPakietu(pakiet, jezyk);
  const cena = kwotaTekst(kwota, waluta, jezyk);
  const linkWaluty = (w) => `/konto/zakup?plan=${encodeURIComponent(plan)}&waluta=${encodeURIComponent(w)}&z=${encodeURIComponent(z)}&lang=${jezyk}`;
  const walutyHtml = wymuszona
    ? `      <p class="drobne" id="waluta-wymuszona">${akapit(wstaw(t.walutaWymuszona, { waluta: String(waluta).toUpperCase() }))}</p>\n`
    : `      <p class="waluty" id="waluty"><span>${esc(t.waluta)}</span> ${waluty.map((w) => (w === waluta
      ? `<strong aria-current="true" lang="${jezyk}">${esc(w.toUpperCase())}</strong>`
      : `<a href="${esc(linkWaluty(w))}" hreflang="${jezyk}">${esc(w.toUpperCase())}</a>`)).join(' ')}</p>\n`;
  const inneHtml = inne.map((p) => `      <p class="inny">${esc(wstaw(t.innyPakiet, { pakiet: p.nazwa }))} `
    + `<a href="${esc(`/konto/zakup?plan=${encodeURIComponent(p.plan)}&waluta=${encodeURIComponent(waluta)}&z=${encodeURIComponent(z)}&lang=${jezyk}`)}">${esc(wstaw(t.zobacz, { pakiet: p.nazwa }))}</a></p>\n`).join('');
  const opisPol = blad ? ' aria-invalid="true" aria-describedby="komunikat"' : '';
  const email = uslugodawca && uslugodawca.email;
  const srodek = `${STYL_PLATNOSCI}
${pasekTestowy(tryb, jezyk)}      <h1>${esc(wstaw(t.zakupNaglowek, { pakiet: nazwa }))}</h1>
      <p class="wstep">${akapit(t.zakupWstep)}</p>
${komunikatBledu(blad)}      <div class="plan" id="plan" data-plan="${esc(plan)}">
        <p class="cena" id="cena">${esc(cena)} <span>${esc(t.miesiecznie)}</span></p>
        <ul class="cechy">${cechyPakietu(pakiet, jezyk).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>
${walutyHtml}${inneHtml}      <p class="drobne" id="podsumowanie">${akapit(wstaw(t.podsumowanie, { pakiet: nazwa, cena }))}</p>
      <form method="POST" action="/konto/zakup" novalidate>
        <input type="hidden" name="plan" value="${esc(plan)}">
        <input type="hidden" name="waluta" value="${esc(waluta)}">
        <input type="hidden" name="z" value="${esc(z === 'konto' ? 'konto' : 'app')}">
        <input type="hidden" name="jezyk" value="${jezyk === 'en' ? 'en' : 'pl'}">
        <div class="zgoda"><input type="checkbox" id="zgoda-regulamin" name="zgoda_regulamin" value="1" required${opisPol}>
          <label for="zgoda-regulamin">${esc(t.zgodaRegulaminPrzed)}<a href="${esc(adresy.regulamin || '/dokumenty/regulamin')}">${esc(t.regulamin)}</a>${esc(t.zgodaRegulaminSrodek)}<a href="${esc(adresy.odstapienie || '/dokumenty/odstapienie')}">${esc(t.pouczenie)}</a>${esc(t.zgodaRegulaminPo)}</label></div>
        <div class="zgoda"><input type="checkbox" id="zgoda-wykonanie" name="zgoda_wykonanie" value="1" required${opisPol}>
          <label for="zgoda-wykonanie">${esc(zwrot === 'pelny' ? t.zgodaWykonaniePelny : t.zgodaWykonanie)}</label></div>
        <p class="drobne" id="kraje">${akapit(t.kraje)}</p>
        <button type="submit" id="do-platnosci">${esc(wstaw(t.przycisk, { cena }))}${logowanie.STRZALKA}</button>
      </form>
      <p class="drobne odstep" id="obsluga-platnosci">${akapit(email ? wstaw(t.stripe, { email }) : t.stripeBezEmaila)}</p>
      <a class="wtorny" href="${adresWroc(z)}">${esc(z === 'konto' ? t.wrocKonto : t.wrocAplikacja)}</a>
${stopkaUslugodawcy(uslugodawca, jezyk)}`;
  return logowanie.szkielet(tSzkieletu(jezyk), wstaw(t.zakupTytul, { pakiet: nazwa }), srodek, { przelacznik: false });
}

/**
 * Ekran komunikatu (odmowa, wynik). przyciski: [{ rodzaj: 'link'|'formularz', tekst, adres, pola }]
 * (formularz POST na wlasne pochodzenie, np. panel subskrypcji).
 */
function ekranKomunikatu({ jezyk = 'pl', tytul, opis = '', dodatkowe = [], przyciski = [], tryb = '', uslugodawca = {}, info = false, z = 'app' } = {}) {
  const t = teksty(jezyk);
  const guziki = przyciski.map((p) => {
    if (p.rodzaj === 'formularz') {
      const pola = Object.entries(p.pola || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
      return `      <form method="POST" action="${esc(p.adres)}">${pola}<button type="submit"${p.id ? ` id="${esc(p.id)}"` : ''}>${esc(p.tekst)}</button></form>\n`;
    }
    return `      <a class="wtorny" href="${esc(p.adres)}"${p.id ? ` id="${esc(p.id)}"` : ''}>${esc(p.tekst)}</a>\n`;
  }).join('');
  const srodek = `${STYL_PLATNOSCI}
${pasekTestowy(tryb, jezyk)}      <h1>${esc(tytul)}</h1>
${info ? komunikatInfo(opis) : `      <p class="wstep" id="opis">${akapit(opis)}</p>\n`}${dodatkowe.map((d) => `      <p class="drobne">${akapit(d)}</p>\n`).join('')}${guziki}      <a class="wtorny" href="${adresWroc(z)}">${esc(z === 'konto' ? t.wrocKonto : t.wrocAplikacja)}</a>
${stopkaUslugodawcy(uslugodawca, jezyk)}`;
  return logowanie.szkielet(tSzkieletu(jezyk), `${tytul} · Content AI`, srodek, { przelacznik: false });
}

/** Opis zwrotu (szacunek albo wynik) dla ekranow i e-maili. */
function opisZwrotu(szacunek, jezyk) {
  const t = teksty(jezyk);
  if (!szacunek || !(szacunek.kwota > 0)) return t.odstZwrotZero;
  const kwota = kwotaTekst(szacunek.kwota, szacunek.waluta, jezyk);
  if (szacunek.tryb === 'pelny') return wstaw(t.odstZwrotPelny, { kwota });
  return wstaw(t.odstZwrotProp, { kwota, dni: szacunek.dniUzyte, okres: szacunek.dniOkresu });
}

/**
 * GET /konto/odstapienie (drugi krok: "Potwierdz odstapienie od umowy").
 *   ekranOdstapienia({ jezyk, pakiet, email, zawarcie, termin, szacunek, tryb, uslugodawca, z })
 */
function ekranOdstapienia({ jezyk = 'pl', pakiet, email = '', zawarcie, termin, szacunek, tryb = '', uslugodawca = {}, z = 'app' } = {}) {
  const t = teksty(jezyk);
  const nazwa = nazwaPakietu(pakiet, jezyk);
  const wiersz = (dt, dd, id) => `        <dt>${esc(dt)}</dt><dd${id ? ` id="${id}"` : ''}>${esc(dd)}</dd>\n`;
  const srodek = `${STYL_PLATNOSCI}
${pasekTestowy(tryb, jezyk)}      <h1>${esc(t.odstNaglowek)}</h1>
      <p class="wstep">${akapit(wstaw(t.odstWstep, { pakiet: nazwa }))}</p>
      <dl class="dane">
${wiersz(t.odstUmowa, wstaw(t.odstUmowaWartosc, { pakiet: nazwa }))}${wiersz(t.odstZawarta, dataTekst(zawarcie, jezyk, { godzina: true }), 'zawarcie')}${wiersz(t.odstTermin, dataTekst(termin - 1, jezyk), 'termin')}${email ? wiersz(t.odstKonto, email) : ''}${wiersz(t.odstZwrot, opisZwrotu(szacunek, jezyk), 'zwrot')}      </dl>
      <p class="drobne">${akapit(t.odstSkutek)}</p>
      <form method="POST" action="/konto/odstapienie">
        <input type="hidden" name="potwierdzam" value="1">
        <input type="hidden" name="z" value="${esc(z === 'konto' ? 'konto' : 'app')}">
        <input type="hidden" name="jezyk" value="${jezyk === 'en' ? 'en' : 'pl'}">
        <button type="submit" id="potwierdz-odstapienie">${esc(t.odstPrzycisk)}</button>
      </form>
      <a class="wtorny" href="${adresWroc(z)}">${esc(z === 'konto' ? t.wrocKonto : t.wrocAplikacja)}</a>
${stopkaUslugodawcy(uslugodawca, jezyk)}`;
  return logowanie.szkielet(tSzkieletu(jezyk), t.odstTytul, srodek, { przelacznik: false });
}

/**
 * Sekcja "Pakiet i platnosci" ekranu /konto (A1). stan = platnosci.stanDlaKonta(konto, kontekst).
 * Formularz panelu (POST /konto/panel -> 303 do Stripe) wymaga na tej stronie CSP z hostami
 * dostawcy: konta.js wola platnosci.cspEkranu(res, kontekst) przed wyslaniem ekranu.
 */
function sekcjaKonta({ jezyk = 'pl', stan, pakiety = {} } = {}) {
  const t = teksty(jezyk);
  if (!stan || !stan.platnosci || !stan.platnosci.wlaczone) return '';
  const s = stan.subskrypcja || {};
  const p = stan.platnosci;
  const nazwa = pakiety[s.plan] ? nazwaPakietu(pakiety[s.plan], jezyk) : (s.plan || '');
  const data = (ms) => dataTekst(ms, jezyk);
  let opis;
  switch (s.stan) {
    case 'aktywna': opis = wstaw(t.sekcjaAktywna, { pakiet: nazwa, data: data(s.okresDo) }); break;
    case 'probna': opis = wstaw(t.sekcjaProbna, { pakiet: nazwa, data: data(s.okresDo) }); break;
    case 'anulowana': opis = wstaw(t.sekcjaAnulowana, { pakiet: nazwa, data: data(s.okresDo) }); break;
    case 'zalegla': opis = wstaw(t.sekcjaZalegla, { pakiet: nazwa, data: data(s.dostepDo) }); break;
    case 'wygasla': opis = wstaw(t.sekcjaWygasla, { pakiet: nazwa }); break;
    default: opis = t.sekcjaBrak;
  }
  const czesci = [`    <section class="platnosci" id="platnosci" aria-labelledby="platnosci-tytul">`, `      <h2 id="platnosci-tytul">${esc(t.sekcjaTytul)}</h2>`];
  if (p.tryb === 'test') czesci.push(`      <p class="pasek-testowy" role="status">${akapit(t.trybTestowy)}</p>`);
  czesci.push(`      <p id="platnosci-stan">${akapit(opis)}</p>`);
  if (p.maPanel) {
    czesci.push(`      <form method="POST" action="/konto/panel"><input type="hidden" name="z" value="konto"><button type="submit" id="panel-subskrypcji">${esc(t.panel)}</button></form>`);
    czesci.push(`      <p class="drobne">${akapit(t.panelOpis)}</p>`);
  } else if (p.mozeKupic) {
    czesci.push(`      <a class="wtorny" href="/konto/zakup?z=konto&amp;lang=${jezyk}" id="wybierz-pakiet">${esc(t.sekcjaWybierz)}</a>`);
  }
  if (p.odstapienie && p.odstapienie.mozliwe) {
    czesci.push(`      <p class="drobne">${akapit(wstaw(t.sekcjaOdstapOpis, { data: data(p.odstapienie.do) }))} <a href="/konto/odstapienie?z=konto&amp;lang=${jezyk}" id="odstap">${esc(t.sekcjaOdstap)}</a></p>`);
  }
  if (p.rachunek && p.rachunek.email) czesci.push(`      <p class="drobne">${akapit(wstaw(t.sekcjaRachunek, { email: p.rachunek.email }))}</p>`);
  czesci.push('    </section>');
  return czesci.join('\n');
}

/** Host do form-action: https://host[:port], a w testach petla zwrotna http://127.0.0.1:port. */
function hostDozwolony(h) {
  return /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(h) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(h);
}

/** CSP ekranow platnosci: bazowa z hostami dostawcy dopisanymi do form-action. */
function cspPlatnosci(cspBazowa, hosty) {
  const lista = (hosty || []).filter(hostDozwolony);
  return String(cspBazowa).replace("form-action 'self'", ["form-action 'self'", ...lista].join(' '));
}

module.exports = {
  T, teksty, wstaw, kwotaTekst, dataTekst, cechyPakietu, nazwaPakietu, odmiana, opisZwrotu,
  ekranZakupu, ekranKomunikatu, ekranOdstapienia, sekcjaKonta, cspPlatnosci, hostDozwolony,
};
