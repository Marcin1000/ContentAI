#!/usr/bin/env python3
"""
Content AI - kroje do PDF (pdfmake): app/pwa/lib/vfs_fonts-2026-10.js.

Literata 400 i 600 (prosta i kursywa) oraz Schibsted Grotesk 600, statyczne TTF z pelnych krojow
zmiennych Google Fonts (OFL 1.1, licencje w app/pwa/fonty/licencje/). Podzbior: lacinka PL/DE/CZ,
typografia, a od 2026-10-12 takze greka i najczestsze symbole nauki i liczb (sigma, mikro, strzalki,
nierownosci, promil, potegi). Wczesniej podzbior mial sama lacinke i znak spoza niego (np. "3 sigma"
w artykule o astrobiologii) wypadal z PDF jako pusty znak \\x00.

Plik wynikowy podaje tez, jakie znaki ma kazdy kroj (this.pdfMake.znakiKrojow), zeby eksport PDF
usuwal znaki, ktorych kroj nie narysuje, zamiast zostawiac pusty znak (trescPdf w aplikacji).

Uzycie (raz, po zmianie listy znakow albo krojow; wynik jest w repozytorium):
    pip install fonttools
    python3 narzedzia/pdf_fonty.py                 # pobiera zrodla do ~/.cache/contentai-kroje
    python3 narzedzia/pdf_fonty.py --zrodla KATALOG
Zrodla sa przypiete suma SHA-256: gdy Google Fonts wyda nowa wersje, skrypt sie zatrzyma i trzeba
swiadomie zaktualizowac ZRODLA, a potem sprawdzic eksport (node narzedzia/test_eksport.js).
"""
import argparse
import base64
import hashlib
import io
import os
import sys
import urllib.request
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    from fontTools import subset
except ImportError:
    sys.exit('BLAD: brak fontTools (pip install fonttools)')

KORZEN = Path(__file__).resolve().parent.parent
# Nazwa z data: serwer wysyla pwa/lib z immutable na rok, wiec nowa tresc = nowa nazwa pliku i nowe
# odwolanie w aplikacji (serwer/README.md, pamiec podreczna plikow statycznych). Stary vfs_fonts.js zostaje
# w repozytorium dla kart otwartych przed aktualizacja.
WYNIK = KORZEN / 'app' / 'pwa' / 'lib' / 'vfs_fonts-2026-10.js'
GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
# plik -> (adres, SHA-256); wersje: Literata 3.103, Schibsted Grotesk 1.100 (te same co w aplikacji)
ZRODLA = {
    'Literata[opsz,wght].ttf': (GF + 'literata/Literata%5Bopsz%2Cwght%5D.ttf',
                                'b41138c9373112f32abb589cc22e8674b06ed4048b0c513be922bdd26f274440'),
    'Literata-Italic[opsz,wght].ttf': (GF + 'literata/Literata-Italic%5Bopsz%2Cwght%5D.ttf',
                                       'd483dfaeba9cbf4ce71d32a52ee65df82f7e35b15fff8d1011cdb242d1fcd465'),
    'SchibstedGrotesk[wght].ttf': (GF + 'schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf',
                                   '6ceeadf6be8e1fd7687011c7fa38ed0edd1abe967a0b73d97caec183552e823d'),
}
# (plik w pdfmake, zrodlo, waga); optyczny rozmiar Literaty zostaje domyslny (12), jak w aplikacji
WARIANTY = [
    ('Literata-Regular.ttf', 'Literata[opsz,wght].ttf', 400),
    ('Literata-SemiBold.ttf', 'Literata[opsz,wght].ttf', 600),
    ('Literata-Italic.ttf', 'Literata-Italic[opsz,wght].ttf', 400),
    ('Literata-SemiBoldItalic.ttf', 'Literata-Italic[opsz,wght].ttf', 600),
    ('SchibstedGrotesk-SemiBold.ttf', 'SchibstedGrotesk[wght].ttf', 600),
]
ZNAKI = sorted(set(
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x180))                    # ASCII, Latin-1, Latin Extended-A
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E,      # typografia (jak dotad)
       0x2022, 0x2026, 0x20AC, 0x2122, 0x00B0, 0x2212]
    + list(range(0x370, 0x400))                                           # greka (bez wielotonowej)
    + [0x2010, 0x2012, 0x2015, 0x2020, 0x2021, 0x2030, 0x2032, 0x2033,      # lacznik, kreski, krzyzyki, promil, prim
       0x2039, 0x203A, 0x2044]
    + list(range(0x2070, 0x20A0))                                         # indeksy gorne i dolne
    + list(range(0x20A0, 0x20C0))                                         # waluty
    + [0x2113, 0x2116, 0x2117, 0x2120, 0x2126, 0x212E]                    # litry, numero, om
    + list(range(0x2150, 0x2160))                                         # ulamki
    + list(range(0x2190, 0x21A0))                                         # strzalki
    + list(range(0x2200, 0x2300))                                         # symbole matematyczne
))
# Znaki, ktore musza byc w kazdym kroju (inaczej PDF po polsku sie rozsypie).
WYMAGANE = [0x105, 0x107, 0x119, 0x142, 0x144, 0xF3, 0x15B, 0x17A, 0x17C, 0x104, 0x141, 0x201E, 0x201D, 0xB5]
# ... a te w Literacie (tresc artykulu): sigma, mikro (greckie), strzalka, nierownosci, promil.
WYMAGANE_LITERATA = [0x3C3, 0x3BC, 0x2192, 0x2264, 0x2265, 0x2248, 0x2030, 0x2032]


def pobierz(katalog):
    katalog.mkdir(parents=True, exist_ok=True)
    for plik, (adres, suma) in ZRODLA.items():
        sciezka = katalog / plik
        if not sciezka.exists():
            print('pobieram', adres)
            with urllib.request.urlopen(adres, timeout=60) as odp:
                sciezka.write_bytes(odp.read())
        jest = hashlib.sha256(sciezka.read_bytes()).hexdigest()
        if jest != suma:
            sys.exit('BLAD: %s ma inna sume SHA-256 (%s) niz przypieta (%s). Nowa wersja kroju: sprawdz '
                     'ja i zaktualizuj ZRODLA.' % (plik, jest, suma))


def zakresy(kody):
    z = []
    for k in sorted(kody):
        if z and k == z[-1][1] + 1:
            z[-1][1] = k
        else:
            z.append([k, k])
    return ','.join(('%04X' % a) + ('' if a == b else '-%04X' % b) for a, b in z)


def zbuduj(katalog):
    vfs, znaki = {}, {}
    for nazwa, zrodlo, waga in WARIANTY:
        pelny = TTFont(str(katalog / zrodlo))
        osie = {a.axisTag: a.defaultValue for a in pelny['fvar'].axes}
        osie['wght'] = waga
        kroj = instancer.instantiateVariableFont(pelny, osie, updateFontNames=True)
        opcje = subset.Options()
        opcje.layout_features = ['kern', 'liga']
        opcje.name_IDs = ['*']
        opcje.notdef_outline = True
        s = subset.Subsetter(opcje)
        s.populate(unicodes=ZNAKI)
        s.subset(kroj)
        cmap = kroj.getBestCmap()
        wymagane = WYMAGANE + (WYMAGANE_LITERATA if nazwa.startswith('Literata') else [])
        brak = ['U+%04X' % c for c in wymagane if c not in cmap]
        if brak:
            sys.exit('BLAD: %s bez znakow %s' % (nazwa, ', '.join(brak)))
        buf = io.BytesIO()
        kroj.save(buf)
        vfs[nazwa] = base64.b64encode(buf.getvalue()).decode()
        znaki[nazwa] = zakresy(cmap)
        print('%-30s %7d B  %4d znakow' % (nazwa, len(buf.getvalue()), len(cmap)))
    return vfs, znaki


def zapisz(vfs, znaki, wynik):
    with open(wynik, 'w', encoding='utf-8') as o:
        o.write('/* Kroje marki do PDF (pdfmake): Literata i Schibsted Grotesk, OFL 1.1, lacinka PL/DE/CZ, greka '
                'i symbole. Generuje narzedzia/pdf_fonty.py - nie edytowac recznie. */\n')
        o.write('this.pdfMake = this.pdfMake || {}; this.pdfMake.vfs = {\n')
        o.write(',\n'.join('  "%s": "%s"' % (k, v) for k, v in vfs.items()))
        o.write('\n};\n')
        # Znaki kazdego kroju (zakresy szesnastkowo): eksport usuwa to, czego kroj nie narysuje.
        o.write('this.pdfMake.znakiKrojow = {\n')
        o.write(',\n'.join('  "%s": "%s"' % (k, v) for k, v in znaki.items()))
        o.write('\n};\n')
    print('zapisano', wynik, os.path.getsize(wynik), 'B')


def main():
    p = argparse.ArgumentParser(description='Kroje do PDF (app/pwa/lib/vfs_fonts-2026-10.js)')
    p.add_argument('--zrodla', default=str(Path.home() / '.cache' / 'contentai-kroje'))
    p.add_argument('--wynik', default=str(WYNIK))
    a = p.parse_args()
    katalog = Path(a.zrodla)
    pobierz(katalog)
    vfs, znaki = zbuduj(katalog)
    zapisz(vfs, znaki, a.wynik)


if __name__ == '__main__':
    main()
