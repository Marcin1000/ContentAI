'use strict';

// ─── Konta samoobslugowe (wykonawca A1) - ZASLEPKA ETAPU 0 ───────────────────
//
// Kontrakt z PROJEKT-TECHNICZNY rozdz. 4 (trasy i przeplywy) i ARCH8-04..08;
// pelna lista funkcji i sygnatur: AG/runda9/WYKONANIE-A0.md.
//
// Router (server.js) wola ten modul w dwoch miejscach:
//   1. obsluzPubliczne(sciezka, req, res, kontekst) - PRZED ogolna kontrola CSRF
//      i bez sesji, tylko dla sciezek z SCIEZKI_PUBLICZNE. Formularze POST
//      sprawdzaja pochodzenie same: kontekst.obcePochodzenie(req) -> strona HTML 403.
//   2. obsluz(sciezka, req, res, kontekst) - z sesja (kontekst.sesja, kontekst.konto),
//      po platnosci.obsluz i klucze.obsluz; tu trafiaja /konto, /konto/*, /api/konto,
//      /api/konto/* (bez /konto/zakup, /konto/panel, /konto/platnosc - to modul B).
// Obie funkcje zwracaja true, gdy wyslaly odpowiedz, false = router idzie dalej.
//
// Kontekst (server.js kontekstZadania): { KONF, url, sciezka, jezyk, sesja, konto,
//   magazyn, plany, dzierzawy, limity, bledy, bladCai, poczta, platnosci, oznaczenia,
//   klucze, logowanie, odpowiedzJson, odpowiedzTekst, wyslij, czytajCialo, cialoJson,
//   typJson, obcePochodzenie, adresIp, jezykZadania, utworzSesje, ciasteczkoSesji,
//   ciasteczkoWylogowania, atrybutyCiasteczka, zapiszWylogowanie, zahaszujAsync,
//   hasloPasujeAsync, atrapaKontaAsync, BladZajety, podpisz, skrotEmaila, idKonta,
//   poprawnyLogin, stronaLogowania, funkcjaWlaczona }.
//
// Zasada etapu 0: z ustawieniami domyslnymi (CAI_REJESTRACJA=0) wszystko dziala jak
// dzis - publiczne sciezki przechodza dalej (ekran logowania / 404), a trasy konta
// z sesja odpowiadaja 501 `niezaimplementowane` (aplikacja ich jeszcze nie wola).

// Sciezki ekranow bez sesji. Router przepuszcza je przez obsluzPubliczne przed
// kontrola CSRF; nowa publiczna sciezka A1 = dopisanie jej tutaj, bez zmian w server.js.
const SCIEZKI_PUBLICZNE = ['/rejestracja', '/potwierdz', '/haslo', '/haslo/nowe', '/do-widzenia'];

function niezaimplementowane(res, kontekst) {
  kontekst.bladCai(res, 'niezaimplementowane', 501, { modul: 'konta' });
  return true;
}

/**
 * GET/POST /rejestracja, GET/POST /potwierdz, GET/POST /haslo, GET/POST /haslo/nowe, GET /do-widzenia.
 * -> true, gdy obsluzone. Rejestracja wylaczona (CAI_REJESTRACJA=0 albo zla konfiguracja): false.
 */
async function obsluzPubliczne(sciezka, req, res, kontekst) {
  if (!SCIEZKI_PUBLICZNE.includes(sciezka)) return false;
  if (!kontekst.funkcjaWlaczona('rejestracja')) return false;
  return niezaimplementowane(res, kontekst);
}

/**
 * Z sesja: GET /konto, POST /konto/potwierdzenie, POST /konto/email, POST /konto/haslo,
 * POST /konto/wyloguj-wszedzie, GET /konto/eksport, GET|POST /konto/usun, GET|POST /konto/zgody,
 * GET /api/konto (stan 4.4: sekcje B przez platnosci.stanDlaKonta, D przez oznaczenia.dlaKonta),
 * POST /api/konto/zgody, POST /api/konto/ustawienia (oznaczenia.sprawdzUstawienia).
 */
async function obsluz(sciezka, req, res, kontekst) {
  const moje = sciezka === '/konto' || sciezka.startsWith('/konto/') || sciezka === '/api/konto' || sciezka.startsWith('/api/konto/');
  if (!moje) return false;
  return niezaimplementowane(res, kontekst);
}

/**
 * Wolane raz przy starcie serwera (po migracji, przed listen) z kontekstem bez
 * zapytania ({ KONF, magazyn, ... }). A1: zegar dobowy usuwania kont niepotwierdzonych
 * (magazyn.kontaNiepotwierdzone + usuniecie z plikami, powod 'niepotwierdzone').
 */
function inicjuj(kontekstSerwera) {
  // Zaslepka etapu 0: nic do uruchomienia (kontekstSerwera = { KONF, magazyn, poczta, ... }).
}

module.exports = { SCIEZKI_PUBLICZNE, obsluzPubliczne, obsluz, inicjuj };
