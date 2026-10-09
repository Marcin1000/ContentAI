'use strict';

// ─── Wlasne klucze uzytkownikow, BYOK (wykonawca C) - ZASLEPKA ETAPU 0 ───────
//
// Kontrakt z PROJEKT-TECHNICZNY ARCH8-10..12, rozdz. 8 i projektu
// AG/runda8/it-bezpieczenstwo/projekt-klucze-w-ciasteczku.md (decyzja M-10:
// klucze w zaszyfrowanych ciasteczkach HttpOnly, klucz szyfrujacy KONF.kluczCiastek
// z CAI_KLUCZ_CIASTEK; zwykle wylogowanie ich nie usuwa). Sygnatury:
// AG/runda9/WYKONANIE-A0.md.
//
//   kluczDla(req, konto, dostawca, konf)
//     -> { klucz, czyj: 'uzytkownika'|'serwera', cel: 'anthropic'|'nvidia'|'openai'|'eleven' }
//      | { blad: { kod: 'brak-klucza', status: 403, dostawca } }
//     Konto zrodloKluczy='wlasne' NIGDY nie dostaje klucza serwera; klucz uzytkownika
//     Anthropic zawsze do Anthropic (nigdy do NVIDIA, SEC8-03).
//   brakKlucza(sciezka, req, konto, konf) -> null | { dostawca }
//     szybka kontrola w routerze przed limitem i zadaniem w tle (403 brak-klucza od razu).
//   ciasteczkaUsuwajace(konf) -> ['Set-Cookie kasujace ciasteczka z kluczami', ...]
//     dla "Wyloguj wszedzie", zmiany i resetu hasla, usuniecia konta (A1).
//   obsluz(sciezka, req, res, kontekst) -> boolean
//     /api/klucze (zapis, stan z koncowka, usuniecie) i /api/klucze/sprawdz (test u dostawcy bez kosztu).
//   stan() -> sekcja do /api/status; inicjuj(kontekstSerwera) -> zegary.
//
// Zaslepka: proxy w server.js dziala jak dzis (kluczDoUzycia), wiec dla kont
// 'serwera' nic sie nie zmienia; trasy /api/klucze* odpowiadaja 501.

const NAGLOWEK = { anthropic: 'x-api-key', openai: 'x-openai-key', eleven: 'x-eleven-key' };
const DOSTAWCY = Object.keys(NAGLOWEK);

function kluczDla() {
  throw new Error('klucze.kluczDla: nie jest jeszcze wdrozone (zaslepka etapu 0, wykonawca C)');
}

function brakKlucza() {
  return null;
}

function ciasteczkaUsuwajace() {
  return [];
}

async function obsluz(sciezka, req, res, kontekst) {
  if (sciezka !== '/api/klucze' && !sciezka.startsWith('/api/klucze/')) return false;
  kontekst.bladCai(res, 'niezaimplementowane', 501, { modul: 'klucze' });
  return true;
}

function stan() {
  return { wdrozone: false };
}

function inicjuj(kontekstSerwera) {
  // Zaslepka etapu 0: nic do uruchomienia (kontekstSerwera = { KONF, magazyn, ... }).
}

module.exports = { NAGLOWEK, DOSTAWCY, kluczDla, brakKlucza, ciasteczkaUsuwajace, obsluz, stan, inicjuj };
