#!/usr/bin/env python3
"""Kontrola: zadnych dlugich myslnikow w tekstach widocznych dla uzytkownika.

Aplikacja od dawna usuwa je z generowanych artykulow po polsku. Ta kontrola
rozciaga te sama regule na interfejs, strone produktowa, dokumentacje,
prezentacje i komunikaty serwera.

Jedyny dozwolony wyjatek to samo to wyrazenie regularne w aplikacji: gdyby
ktos podmienil w nim znaki, klasa znakow stalaby sie zakresem i normalizacja
przestalaby dzialac po cichu, bez zadnego bledu.

DLACZEGO ZNAKI SA TU ZAPISANE JAKO \\u2014 I \\u2013, A NIE WPROST:
ten plik lezy w skanowanym drzewie i ma rozszerzenie .py. Przy pierwszym
uruchomieniu z --napraw skrypt podmienil myslniki we WLASNEJ definicji
i od tej pory zglaszal kazdy zwykly lacznik w repozytorium. Zapis unikodowy
plus pominiecie wlasnego pliku sprawiaja, ze nie moze sie to powtorzyc.

Uzycie:
    python3 narzedzia/audyt_myslniki.py          # sprawdza
    python3 narzedzia/audyt_myslniki.py --napraw # podmienia na lacznik
"""
import re
import sys
from pathlib import Path

TEN_PLIK = Path(__file__).resolve()
KORZEN = TEN_PLIK.parent.parent

PAUZA = '—'        # myslnik dlugi (em dash)
POLPAUZA = '–'     # myslnik polkrotki (en dash)
MYSLNIKI = (PAUZA, POLPAUZA)

ROZSZERZENIA = ('.md', '.html', '.js', '.py', '.mjs', '.yml', '.txt',
                '.przyklad', '.service', '.css')
# Porownujemy CZLONY sciezki, nie podciagi: '.git' jest podciagiem '.github',
# przez co caly katalog z konfiguracja CI wypadal z kontroli.
POMIJANE_KATALOGI = {'node_modules', '.git', '.eslint-tmp', '__pycache__'}
POMIJANE_SCIEZKI = ('app/pwa/lib/', 'app/pwa/fonty/', 'serwer/dane/')

# Fragment, w ktorym myslniki sa czescia kodu, nie tekstu.
CHRONIONE = [re.escape('/[' + PAUZA + POLPAUZA + ']/g')]


def pliki():
    for p in sorted(KORZEN.rglob('*')):
        if not p.is_file() or p.suffix not in ROZSZERZENIA:
            continue
        if p.resolve() == TEN_PLIK:      # nie zjadaj wlasnego ogona
            continue
        wzgledna = p.relative_to(KORZEN).as_posix()
        if POMIJANE_KATALOGI & set(p.relative_to(KORZEN).parts[:-1]):
            continue
        if wzgledna.startswith(POMIJANE_SCIEZKI):
            continue
        yield p, wzgledna


def zaslon(tresc):
    """Zamienia chronione fragmenty na znaczniki. Zwraca (tresc, lista)."""
    schowane = []
    for wzorzec in CHRONIONE:
        for m in list(re.finditer(wzorzec, tresc)):
            tresc = tresc.replace(m.group(0), '\x00%d\x00' % len(schowane), 1)
            schowane.append(m.group(0))
    return tresc, schowane


def odslon(tresc, schowane):
    for i, oryginal in enumerate(schowane):
        tresc = tresc.replace('\x00%d\x00' % i, oryginal, 1)
    return tresc


def main():
    napraw = '--napraw' in sys.argv
    znalezione = []
    naprawionych = 0

    for p, wzgledna in pliki():
        try:
            s = p.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        if not any(z in s for z in MYSLNIKI):
            continue

        bez_chronionych, schowane = zaslon(s)
        ile = sum(bez_chronionych.count(z) for z in MYSLNIKI)
        if ile == 0:
            continue

        if napraw:
            for z in MYSLNIKI:
                bez_chronionych = bez_chronionych.replace(z, '-')
            p.write_text(odslon(bez_chronionych, schowane), encoding='utf-8')
            naprawionych += ile
            print('  naprawiono %3d  %s' % (ile, wzgledna))
        else:
            for nr, linia in enumerate(bez_chronionych.split('\n'), 1):
                if any(z in linia for z in MYSLNIKI):
                    znalezione.append((wzgledna, nr, linia.strip()[:80]))

    if napraw:
        print('\nPodmieniono %d dlugich myslnikow.' % naprawionych)
        return 0

    if znalezione:
        print('BLAD: dlugie myslniki w tekstach (%d):' % len(znalezione))
        for plik, nr, linia in znalezione[:25]:
            print('  %s:%d  %s' % (plik, nr, linia))
        if len(znalezione) > 25:
            print('  ... i %d wiecej' % (len(znalezione) - 25))
        print('\nNapraw: python3 narzedzia/audyt_myslniki.py --napraw')
        return 1

    print('ok    brak dlugich myslnikow poza chronionym wyrazeniem regularnym')
    return 0


if __name__ == '__main__':
    sys.exit(main())
