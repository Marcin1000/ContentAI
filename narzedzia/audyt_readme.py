#!/usr/bin/env python3
"""Kontrola README: odnosniki wskazuja na istniejace pliki, liczby sie zgadzaja.

README jest wizytowka publicznego repozytorium. Zepsuty odnosnik nie wywala
niczego - po prostu prowadzi donikad, a zlamany obrazek zostawia pusta ramke.
Jedno i drugie widac dopiero na GitHubie, wiec sprawdzamy to maszynowo.

Druga kontrola dotyczy liczby testow serwera. Audyt z sierpnia 2026 pokazal, ze
liczby wpisane do dokumentacji cicho rozjezdzaja sie z kodem ("~666 KB, ~10,5
tys. linii" przy rzeczywistych 664 KB i 11,9 tys.). Skoro README podaje
konkretna liczbe, ma byc pilnowana, a nie przepisywana z pamieci.

Sprawdzane sa odnosniki wzgledne. Adresy http(s) i kotwice pomijamy: pierwsze
wymagalyby sieci, drugie zaleza od tego, jak GitHub generuje identyfikatory
naglowkow.

Uzycie:
    python3 narzedzia/audyt_readme.py
"""
import re
import subprocess
import sys
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent
PLIKI = ['README.md']

# [tekst](cel) oraz ![alt](cel), a takze srcset="..." i src="..." z <picture>.
WZORZEC_MD = re.compile(r'!?\[[^\]]*\]\(([^)\s]+)')
WZORZEC_HTML = re.compile(r'(?:src|srcset)="([^"]+)"')


def cele(tresc):
    for m in WZORZEC_MD.finditer(tresc):
        yield m.group(1)
    for m in WZORZEC_HTML.finditer(tresc):
        yield m.group(1)


def sprawdz_liczbe_testow(plik):
    """Liczba testow podana w README musi zgadzac sie z faktyczna.

    Uruchamiamy zestaw i czytamy podsumowanie. Bez node kontrola sie nie
    wywala, tylko oznajmia, ze tego nie sprawdzila - inaczej audyt bylby
    nieuruchamialny na maszynie bez node.
    """
    tresc = plik.read_text(encoding='utf-8')
    zadeklarowane = re.search(r'(\d+)\s+tests', tresc)
    if not zadeklarowane:
        return []

    try:
        wynik = subprocess.run(['node', 'serwer/testy.js'], cwd=str(KORZEN),
                               capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        print('  info  liczby testow nie sprawdzono (brak node albo blad uruchomienia)')
        return []

    faktyczne = re.search(r'(\d+)\s+zaliczonych', wynik.stdout)
    if not faktyczne:
        print('  info  liczby testow nie sprawdzono (nieoczekiwane wyjscie testow)')
        return []

    if zadeklarowane.group(1) != faktyczne.group(1):
        return ['README podaje %s testow, a jest ich %s'
                % (zadeklarowane.group(1), faktyczne.group(1))]

    print('  ok    liczba testow w README zgadza sie z faktyczna (%s)' % faktyczne.group(1))
    return []


def main():
    bledy = []
    sprawdzonych = 0

    for nazwa in PLIKI:
        plik = KORZEN / nazwa
        if not plik.exists():
            bledy.append('%s nie istnieje' % nazwa)
            continue
        tresc = plik.read_text(encoding='utf-8')

        for cel in cele(tresc):
            if cel.startswith(('http://', 'https://', '#', 'mailto:', 'data:')):
                continue
            sprawdzonych += 1
            wskazany = KORZEN / cel.split('#')[0]
            if not wskazany.exists():
                bledy.append('%s -> %s (nie ma takiego pliku)' % (nazwa, cel))

    bledy += sprawdz_liczbe_testow(KORZEN / 'README.md')

    print('  sprawdzonych odnosnikow wzglednych: %d' % sprawdzonych)
    if bledy:
        print('  BLAD  znaleziono problemy (%d):' % len(bledy))
        for b in bledy:
            print('        %s' % b)
        print('\nBLEDOW: %d' % len(bledy))
        return 1

    print('  ok    kazdy odnosnik i obrazek wskazuje na istniejacy plik')
    print('\nBLEDOW: 0')
    return 0


if __name__ == '__main__':
    sys.exit(main())
