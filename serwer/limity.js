'use strict';

// ─── Ogolny ogranicznik prob (okno przesuwne w pamieci procesu) ─────────────
//
// Wzor: prosby.ocenLimit (limit z adresu, z sieci /24 albo /48 i dobowy), ale
// jako modul dla wszystkich nowych tras: rejestracja (5 na godzine z adresu,
// 20 na dobe z sieci, 300 na dobe lacznie), reset hasla, ponowna wysylka linku,
// logowanie per konto (20 nieudanych na godzine -> blokada 15 minut), sprawdzanie
// klucza (10 na minute na konto), sesje zakupu (10 na godzine na konto).
//
// Liczniki sa w pamieci, jak licznik prob logowania: restart je zeruje, co przy
// jednym procesie i tej skali wystarcza. Mapy sprzatamy, gdy rosna.
//
// Uzycie:
//   const limity = require('./limity.js');
//   const REJESTRACJA = limity.utworz('rejestracja', [
//     { nazwa: 'adres', klucz: (k) => k.ip, ile: 5, oknoMs: limity.GODZINA },
//     { nazwa: 'siec', klucz: (k) => limity.siecAdresu(k.ip), ile: 20, oknoMs: limity.DOBA },
//     { nazwa: 'wszystko', klucz: () => '*', ile: 300, oknoMs: limity.DOBA },
//   ]);
//   const w = REJESTRACJA.ocen({ ip });     // { wolno, regula, ponowZa } - wolno => proba policzona
//   if (!w.wolno) return bladCai(res, 'za-duzo-prob', 429, { ponowZa: w.ponowZa });
//
// Logowanie per konto (liczymy tylko porazki, sukces czysci):
//   const KONTO = limity.utworz('logowanie-konto', [
//     { nazwa: 'konto', klucz: (k) => k.login, ile: 20, oknoMs: limity.GODZINA, blokadaMs: 15 * limity.MINUTA },
//   ]);
//   if (!KONTO.sprawdz({ login }).wolno) ...; po porazce KONTO.zapisz({ login }); po sukcesie KONTO.wyczysc({ login })

const MINUTA = 60_000;
const GODZINA = 60 * MINUTA;
const DOBA = 24 * GODZINA;
const MAKS_KLUCZY = 5000;

/** Siec adresu: /24 dla IPv4 (takze zapisanego jako ::ffff:a.b.c.d), /48 dla IPv6. */
function siecAdresu(ip) {
  const a = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(a);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (a.includes(':')) {
    const [przod, tyl = ''] = a.split('::');
    const p = przod ? przod.split(':') : [];
    const t = tyl ? tyl.split(':') : [];
    const grupy = a.includes('::') ? [...p, ...Array(Math.max(0, 8 - p.length - t.length)).fill('0'), ...t] : p;
    return grupy.slice(0, 3).map((g) => g || '0').join(':') + '::/48';
  }
  return a || 'nieznany';
}

const WSZYSTKIE = new Map();   // nazwa -> ogranicznik (do wyzerowania w testach)

/**
 * Tworzy nazwany ogranicznik z regulami { nazwa, klucz(k) -> string|null, ile, oknoMs, blokadaMs? }.
 * Regula bez klucza (null/'') jest pomijana. Zwraca { sprawdz, zapisz, ocen, wyczysc, wyzeruj }.
 */
function utworz(nazwa, reguly) {
  if (!Array.isArray(reguly) || !reguly.length) throw new Error(`limity.utworz(${nazwa}): brak regul`);
  const stan = reguly.map(() => ({ proby: new Map(), blokady: new Map() }));

  function kluczReguly(r, k) {
    const wartosc = typeof r.klucz === 'function' ? r.klucz(k || {}) : (k || {})[r.nazwa];
    return wartosc === null || wartosc === undefined || wartosc === '' ? null : String(wartosc);
  }

  function sprzataj(s, teraz, oknoMs) {
    if (s.proby.size > MAKS_KLUCZY) {
      for (const [k, v] of s.proby) if (!v.some((t) => teraz - t < oknoMs)) s.proby.delete(k);
    }
    if (s.blokady.size > MAKS_KLUCZY) {
      for (const [k, v] of s.blokady) if (v <= teraz) s.blokady.delete(k);
    }
  }

  /** Decyzja bez liczenia proby. -> { wolno, regula?, ponowZa? (s) } */
  function sprawdz(k, teraz = Date.now()) {
    for (let i = 0; i < reguly.length; i += 1) {
      const r = reguly[i];
      const klucz = kluczReguly(r, k);
      if (klucz === null) continue;
      const s = stan[i];
      const blokadaDo = s.blokady.get(klucz);
      if (blokadaDo && blokadaDo > teraz) return { wolno: false, regula: r.nazwa, ponowZa: Math.ceil((blokadaDo - teraz) / 1000) };
      const lista = (s.proby.get(klucz) || []).filter((t) => teraz - t < r.oknoMs);
      if (lista.length) s.proby.set(klucz, lista); else s.proby.delete(klucz);
      if (lista.length >= r.ile) {
        return { wolno: false, regula: r.nazwa, ponowZa: Math.max(1, Math.ceil((lista[0] + r.oknoMs - teraz) / 1000)) };
      }
    }
    return { wolno: true };
  }

  /** Liczy probe we wszystkich regulach (porazka logowania, przyjeta rejestracja). */
  function zapisz(k, teraz = Date.now()) {
    reguly.forEach((r, i) => {
      const klucz = kluczReguly(r, k);
      if (klucz === null) return;
      const s = stan[i];
      const lista = (s.proby.get(klucz) || []).filter((t) => teraz - t < r.oknoMs);
      lista.push(teraz);
      s.proby.set(klucz, lista);
      if (r.blokadaMs && lista.length >= r.ile) s.blokady.set(klucz, teraz + r.blokadaMs);
      sprzataj(s, teraz, r.oknoMs);
    });
  }

  /** sprawdz + zapisz, gdy wolno. */
  function ocen(k, teraz = Date.now()) {
    const w = sprawdz(k, teraz);
    if (w.wolno) zapisz(k, teraz);
    return w;
  }

  /** Czysci liczniki klucza (np. po udanym logowaniu); `regula` zaweza do jednej reguly. */
  function wyczysc(k, regula) {
    reguly.forEach((r, i) => {
      if (regula && r.nazwa !== regula) return;
      const klucz = kluczReguly(r, k);
      if (klucz === null) return;
      stan[i].proby.delete(klucz);
      stan[i].blokady.delete(klucz);
    });
  }

  function wyzeruj() {
    for (const s of stan) { s.proby.clear(); s.blokady.clear(); }
  }

  const ogranicznik = { nazwa, reguly, sprawdz, zapisz, ocen, wyczysc, wyzeruj };
  WSZYSTKIE.set(nazwa, ogranicznik);
  return ogranicznik;
}

/** Do testow: zeruje wszystkie ograniczniki. */
function wyzerujWszystkie() {
  for (const o of WSZYSTKIE.values()) o.wyzeruj();
}

module.exports = { utworz, siecAdresu, wyzerujWszystkie, MINUTA, GODZINA, DOBA };
