#!/usr/bin/env python3
"""Audyt kluczy slownika: kazdy klucz w I18N jest gdzies uzywany.

Uzycie: python3 narzedzia/audyt_klucze.py [--zrodlo sciezka/do/contentai.src.html]

Klucz bez uzycia niczego nie psuje, ale myli: autorzy tekstow poprawiaja zdanie, ktorego nikt
nie zobaczy, a to, co widac w aplikacji, siedzi w innym kluczu albo w kodzie. Porzadki
2026-11-07 usunely 69 takich kluczy (np. stare naglowki paneli, przyciski po przebudowie
okien). Ta kontrola pilnuje, zeby nie wracaly.

Klucz jest uzyty, gdy:
- jego nazwa stoi w kodzie poza slownikiem i nie jest to tylko id elementu, selektor albo
  klasa CSS (np. _t('k'), tekst('k', ...), ustawTekst(el, 'k'), data-i18n="k", mapy kluczy);
- kod sklada go z przedrostka i zmiennej: lista DYNAMICZNE nizej, kazdy wzorzec z dokladnym
  fragmentem kodu, ktory go sklada (gdy fragment zniknie, kontrola to zglosi, wiec lista nie
  starzeje sie po cichu);
- to forma liczby dla _tn('baza', n): baza-1, baza-2, baza-5 (bazy czytane z kodu).
Nowy sposob skladania klucza wymaga wpisu w DYNAMICZNE.
"""
import re
import sys
from pathlib import Path

ZRODLO = Path(__file__).resolve().parent.parent / 'app' / 'contentai.src.html'

# (wyrazenie dla nazwy klucza, fragment kodu, ktory go sklada, skad)
DYNAMICZNE = [
    (r'fakty-rodzaj-[a-z-]+', "_t('fakty-rodzaj-' + rodzaj)", 'Kontrola faktow: nazwa kategorii uwagi'),
    (r'fakty-powod-[a-z-]+', "_t('fakty-powod-' + rodzaj)", 'Kontrola faktow: domyslny powod uwagi'),
    (r'ocena-opis-[a-z]+', "_t('ocena-opis-' + otwarty)", 'inspektor ocen: zdanie pod SEO, AIO, AEO, GEO'),
    (r'ocena-opis-[a-z]+', "_t('ocena-opis-' + o[0])", 'przyklad artykulu: opis oceny'),
    (r'przyklad-nazwa-[a-z]+', "_t('przyklad-nazwa-' + o[0])", 'przyklad artykulu: nazwa oceny'),
    (r'au-typ-[a-z]+', "_t('au-typ-'+e.type)", 'historia audio: typ nagrania'),
    (r'pakiet-[a-z]+', "tekst('pakiet-' + nazwa, nazwa)", 'okno pakietu: nazwa czynnosci w limicie'),
    (r'pakiet-[a-z]+', "tekst('pakiet-' + dane.czynnosc, dane.czynnosc)", 'komunikat limitu: czynnosc poza pakietem'),
    (r'pakiet-fn-[a-zA-Z]+', "tekst('pakiet-fn-' + f, f)", 'tabela pakietow: funkcje z serwera (np. bazaWiedzy)'),
    (r'byok-krok-[0-9]+', "tekst('byok-krok-' + i, '')", 'kreator klucza: kroki 1-5'),
    (r'byok-podpowiedz-[0-9]+', "tekst('byok-podpowiedz-' + i, '')", 'kreator klucza: podpowiedzi tematu 1-3'),
    (r'byok-[a-z]+-opis', "tekst('byok-' + d + '-opis', '')", 'Konto, klucze API: opis dostawcy'),
    (r'konto-ozn-[a-z]+', "tekst('konto-ozn-' + r, '')", 'Konto: etykiety oznaczen AI'),
]

# Kontekst tuz przed nazwa, w ktorym nazwa jest id elementu, selektorem albo klasa, a nie kluczem.
TYLKO_ID = re.compile(
    r'''(?:\bid=["']|getElementById\(\s*["']|\bel\(\s*["']|querySelector(?:All)?\(\s*["'][^"']*#|\bfor=["']|'''
    r'''aria-(?:labelledby|describedby|controls)=["']|classList\.\w+\(\s*["']|class=["'][^"']*\b|[#.])$''')
NAZWA = r'[a-zA-Z0-9_.$-]'


def blok_i18n(tekst):
    """(poczatek, koniec) obiektu var I18N = {...}, liczac nawiasy poza tekstami."""
    start = tekst.index('var I18N = {') + len('var I18N = ')
    glebokosc, i, w_tekscie = 0, start, None
    while i < len(tekst):
        z = tekst[i]
        if w_tekscie:
            if z == '\\':
                i += 2
                continue
            if z == w_tekscie:
                w_tekscie = None
        elif tekst.startswith('//', i):
            i = tekst.index('\n', i)
            continue
        elif z in ("'", '"'):
            w_tekscie = z
        elif z == '{':
            glebokosc += 1
        elif z == '}':
            glebokosc -= 1
            if glebokosc == 0:
                return start, i + 1
        i += 1
    raise SystemExit('nie znaleziono konca slownika I18N')


def main():
    zrodlo = Path(sys.argv[sys.argv.index('--zrodlo') + 1]) if '--zrodlo' in sys.argv else ZRODLO
    tekst = zrodlo.read_text(encoding='utf-8')
    a, b = blok_i18n(tekst)
    slownik = tekst[a:b]
    kod = tekst[:a] + '\n' + tekst[b:]
    klucze = sorted(set(re.findall(r"(?:^|,|\{)\s*'(" + NAZWA + r"+)'\s*:", slownik, re.M)))
    bledy = []

    wzorce = []
    for wzor, fragment, skad in DYNAMICZNE:
        if fragment not in kod:
            bledy.append(f'wzorzec {wzor} ({skad}): w kodzie nie ma juz "{fragment}", popraw liste DYNAMICZNE')
        else:
            wzorce.append(re.compile(wzor))
    bazy_tn = set(re.findall(r"_tn\(\s*'([a-z0-9-]+)'", kod))
    formy_tn = {b + '-' + f for b in bazy_tn for f in ('1', '2', '5')}

    nieuzyte = []
    for k in klucze:
        if k in formy_tn or any(w.fullmatch(k) for w in wzorce):
            continue
        wystapienia = [m.start() for m in re.finditer(r'(?<!' + NAZWA + r')' + re.escape(k) + r'(?!' + NAZWA + r')', kod)]
        if any(not TYLKO_ID.search(kod[max(0, p - 60):p]) for p in wystapienia):
            continue
        nieuzyte.append((k, 'tylko jako id albo klasa' if wystapienia else 'brak w kodzie'))

    print(f'  kluczy w slowniku: {len(klucze)}   wzorcow dynamicznych: {len(DYNAMICZNE)}   form _tn: {len(formy_tn)}')
    for opis in bledy:
        print(f'  BLAD  {opis}')
    if nieuzyte:
        print(f'  BLAD  klucze bez uzycia: {len(nieuzyte)} (usun je z PL i EN albo dopisz wzorzec do DYNAMICZNE)')
        for k, powod in nieuzyte:
            print(f'          {k}  ({powod})')
    else:
        print('  ok    kazdy klucz slownika jest uzywany')
    razem = len(bledy) + len(nieuzyte)
    print()
    print(f'BLEDOW: {razem}')
    return 1 if razem else 0


if __name__ == '__main__':
    sys.exit(main())
