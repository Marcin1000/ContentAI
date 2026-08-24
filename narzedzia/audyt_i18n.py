#!/usr/bin/env python3
"""Audyt i18n: czy kazdy klucz uzywany w aplikacji istnieje w OBU slownikach.

Brak klucza nie wywala niczego - t() po cichu schodzi na polski albo zwraca sam
klucz. Dlatego angielski interfejs potrafi wyswietlac polskie zdania, a nikt
tego nie zauwaza. To jedyny sposob, zeby to wylapac inaczej niz okiem.
"""
import re
import sys
from pathlib import Path

ZRODLO = Path(__file__).resolve().parent.parent / 'app' / 'contentai.src.html'
tekst = ZRODLO.read_text(encoding='utf-8')


def blok_slownika(zrodlo, nazwa):
    """Wycina cialo slownika przez liczenie nawiasow - regex tu nie wystarcza,
    bo wartosci zawieraja i nawiasy, i apostrofy, i HTML."""
    start = zrodlo.index(f'\n  {nazwa}: {{') + len(f'\n  {nazwa}: ')
    glebokosc = 0
    i = start
    w_tekscie = None
    while i < len(zrodlo):
        z = zrodlo[i]
        if w_tekscie:
            if z == '\\':
                i += 2
                continue
            if z == w_tekscie:
                w_tekscie = None
        elif z in ("'", '"'):
            w_tekscie = z
        elif z == '{':
            glebokosc += 1
        elif z == '}':
            glebokosc -= 1
            if glebokosc == 0:
                return zrodlo[start:i + 1]
        i += 1
    raise SystemExit(f'nie znaleziono konca slownika {nazwa}')


poczatek = tekst.index('var I18N = {')
blok = tekst[poczatek:]

frag_pl = blok_slownika(blok, 'pl')
frag_en = blok_slownika(blok, 'en')

# Klucz to 'nazwa': na poczatku wyrazenia, nie w srodku tekstu wartosci.
WZOR = re.compile(r"(?:^|,)\s*'([a-zA-Z0-9_.$-]+)'\s*:", re.M)
pl = set(WZOR.findall(frag_pl))
en = set(WZOR.findall(frag_en))

print(f'  kluczy PL: {len(pl)}   kluczy EN: {len(en)}')

uzyte_t = set(re.findall(r"_t\(\s*'([^']+)'\s*\)", tekst))
uzyte_tekst = set(re.findall(r"tekst\(\s*'([^']+)'\s*,", tekst))
uzyte_atrybuty = set(re.findall(r'data-i18n(?:-ph|-title|-html)?="([^"]+)"', tekst))
uzyte = uzyte_t | uzyte_tekst | uzyte_atrybuty

dynamiczne = set(re.findall(r"_t\(\s*'([a-z-]+)'\s*\+", tekst)) | \
             set(re.findall(r"tekst\(\s*'([a-z-]+-)'\s*\+", tekst))

brak_pl = sorted(uzyte - pl)
brak_en = sorted(uzyte - en)
tylko_pl = sorted(pl - en)
tylko_en = sorted(en - pl)

bledy = 0


def raport(tytul, pozycje, powaga):
    global bledy
    if not pozycje:
        print(f'  ok    {tytul}')
        return
    if powaga == 'blad':
        bledy += len(pozycje)
    print(f'  {"BLAD " if powaga == "blad" else "UWAGA"} {tytul}: {len(pozycje)}')
    for k in pozycje[:30]:
        print(f'          {k}')
    if len(pozycje) > 30:
        print(f'          ... i {len(pozycje) - 30} wiecej')


raport('kazdy uzywany klucz jest w slowniku PL', brak_pl, 'blad')
raport('kazdy uzywany klucz jest w slowniku EN', brak_en, 'blad')
raport('klucze tylko w PL (angielski UI pokaze polskie zdanie)', tylko_pl, 'blad')
raport('klucze tylko w EN (nieuzywane albo literowka)', tylko_en, 'uwaga')

if dynamiczne:
    print(f'  info  prefiksy skladane w kodzie: {", ".join(sorted(dynamiczne))}')

print()
print(f'BLEDOW: {bledy}')
sys.exit(1 if bledy else 0)
