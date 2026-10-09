'use strict';

// ─── Adapter Stripe na fetch (wykonawca B) - ZASLEPKA ETAPU 0 ────────────────
//
// Interfejs adaptera z ARCH8-13 (kazdy dostawca, np. pozniej Paddle albo
// Lemon Squeezy, to nowy plik platnosci-<nazwa>.js z tymi samymi funkcjami):
//
//   nazwa: 'stripe'
//   sprawdzKonfiguracje(konf)              -> [bledy]   tryb klucza, sekret webhooka, ceny dla kazdej waluty
//   async przygotujKlienta(konto)          -> idKlienta (klucz idempotencji klient-<login>)
//   async rozpocznijZakup({ konto, idKlienta, plan, waluta, jezyk, adresPowrotu, adresRezygnacji }) -> { url, idSesji }
//   async otworzPanel({ idKlienta, jezyk, adresPowrotu })               -> { url }
//   zweryfikujZdarzenie(surowe, naglowki)  -> zdarzenie albo throw BladPodpisu (HMAC na surowych bajtach)
//   rozpoznajZdarzenie(zdarzenie)          -> { id, typ, tryb, idKlienta, login?, idSesji?, wplata? } albo null
//   async stanKlienta(idKlienta)           -> StanSubskrypcji
//   async potwierdzSesje(idSesji)          -> { idKlienta, login }
//   async anulujWszystko(idKlienta)        -> void (usuniecie konta)
//   async ceny()                           -> { standard: { eur: 1900, pln: 7900 }, ... } (jednostki najmniejsze)
//   hostyPrzekierowan()                    -> ['https://checkout.stripe.com', 'https://billing.stripe.com']
//
// StanSubskrypcji: { stan: 'brak'|'probna'|'aktywna'|'zalegla'|'anulowana'|'wygasla', plan,
//                    idSubskrypcji, okresDo, waluta, surowy, kraj }
// Konfiguracja: konf.platnosci.stripe = { klucz, sekretWebhooka: [..], ceny: { <plan>: '...' },
//   wersjaApi, urlApi, portalKonfiguracja, hostyPrzekierowan: [..] } (server.js KONF).

// Wersja API przypieta (ARCH8-14): data z panelu Stripe w dniu wdrozenia; nadpisanie STRIPE_WERSJA_API.
const WERSJA_API = '';

class BladPodpisu extends Error {
  constructor(powod) {
    super(`Niepoprawny podpis zdarzenia: ${powod}`);
    this.name = 'BladPodpisu';
    this.status = 400;
  }
}

function niezaimplementowane(nazwa) {
  return () => { throw new Error(`platnosci-stripe.${nazwa}: adapter nie jest jeszcze wdrozony (zaslepka etapu 0)`); };
}

module.exports = {
  nazwa: 'stripe',
  WERSJA_API,
  BladPodpisu,
  sprawdzKonfiguracje: () => ['adapter Stripe nie jest jeszcze wdrozony (zaslepka etapu 0)'],
  przygotujKlienta: niezaimplementowane('przygotujKlienta'),
  rozpocznijZakup: niezaimplementowane('rozpocznijZakup'),
  otworzPanel: niezaimplementowane('otworzPanel'),
  zweryfikujZdarzenie: niezaimplementowane('zweryfikujZdarzenie'),
  rozpoznajZdarzenie: niezaimplementowane('rozpoznajZdarzenie'),
  stanKlienta: niezaimplementowane('stanKlienta'),
  potwierdzSesje: niezaimplementowane('potwierdzSesje'),
  anulujWszystko: niezaimplementowane('anulujWszystko'),
  ceny: niezaimplementowane('ceny'),
  hostyPrzekierowan: () => ['https://checkout.stripe.com', 'https://billing.stripe.com'],
};
