#!/usr/bin/env python3
"""Kontrola strony produktowej: tlumaczenia i teksty widoczne bez JavaScriptu.

Strona ma dwa rownolegle slowniki wpisane wprost w plik. Brak klucza nie
wywala niczego - applyLang() po prostu zostawia to, co stoi w znaczniku,
wiec angielska wersja po cichu pokazuje polskie zdanie. Dokladnie ta klasa
bledu, ktora w aplikacji lapie audyt_i18n.py; tutaj do tej pory nie lapal
jej nikt.

Sprawdzamy trzy rzeczy:
  1. kazdy klucz uzyty w data-i18n istnieje w obu slownikach,
  2. zaden slownik nie ma klucza, ktorego nikt nie uzywa (literowka),
  3. polski tekst w znaczniku zgadza sie ze slownikiem polskim - inaczej
     przed zaladowaniem skryptu widac inne zdanie niz po.

Uzycie:
    python3 narzedzia/audyt_showcase.py
"""
import html
import re
import sys
from pathlib import Path

STRONA = Path(__file__).resolve().parent.parent / 'showcase' / 'index.html'


def slownik(tresc, nazwa):
    """Wycina jeden slownik i zwraca {klucz: wartosc}.

    Wartosci moga zawierac apostrofy i przecinki, wiec nie da sie tego ciac
    prostym split(). Idziemy wyrazeniem po parach "klucz":"wartosc",
    respektujac ucieczki.
    """
    poczatek = tresc.find(nazwa + ':{')
    if poczatek < 0:
        sys.exit('BLAD: nie znaleziono slownika %s' % nazwa)
    i = tresc.index('{', poczatek)
    glebokosc = 0
    for koniec in range(i, len(tresc)):
        if tresc[koniec] == '{':
            glebokosc += 1
        elif tresc[koniec] == '}':
            glebokosc -= 1
            if glebokosc == 0:
                break
    blok = tresc[i:koniec + 1]
    pary = re.findall(r'"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', blok)
    return {k: v for k, v in pary}


def znormalizuj(tekst):
    """Sprowadza obie strony do porownywalnej postaci.

    W znaczniku stoi &rarr;, w slowniku znak wprost; w slowniku cudzyslowy sa
    poprzedzone ukosnikiem, w znaczniku nie. Renderuje sie to tak samo, wiec
    roznica nie jest usterka.
    """
    return html.unescape(tekst.replace('\\"', '"')).strip()


def main():
    tresc = STRONA.read_text(encoding='utf-8')
    pl = slownik(tresc, 'pl')
    en = slownik(tresc, 'en')

    # Klucze uzyte w znaczniku, razem z polskim tekstem, ktory przy nich stoi.
    # Nazwa znacznika przez odwolanie wsteczne, a nie pierwsze napotkane "</":
    # przy wartosciach z <b> albo <span> w srodku tekst urywal sie na
    # zagniezdzonym znaczniku i kontrola zglaszala rozjazd, ktorego nie bylo.
    uzyte = {}
    for m in re.finditer(r'<(\w+)[^>]*data-i18n="([^"]+)"[^>]*>(.*?)</\1>', tresc, re.S):
        uzyte.setdefault(m.group(2), znormalizuj(m.group(3)))

    bledy = []

    brak_pl = sorted(k for k in uzyte if k not in pl)
    brak_en = sorted(k for k in uzyte if k not in en)
    zbedne = sorted((set(pl) | set(en)) - set(uzyte))
    rozjazd = sorted(k for k, tekst in uzyte.items()
                     if k in pl and znormalizuj(pl[k]) != tekst)

    print('  kluczy PL: %d   kluczy EN: %d   uzytych: %d'
          % (len(pl), len(en), len(uzyte)))

    for opis, lista in [
        ('klucz uzyty, brak w slowniku PL', brak_pl),
        ('klucz uzyty, brak w slowniku EN (angielski pokaze polskie zdanie)', brak_en),
        ('polski tekst w znaczniku rozni sie od slownika', rozjazd),
    ]:
        if lista:
            bledy.append(opis)
            print('  BLAD  %s (%d):' % (opis, len(lista)))
            for k in lista[:12]:
                print('        %s' % k)
        else:
            print('  ok    %s' % opis)

    # Nieuzywany klucz nie psuje strony, ale zwykle znaczy literowke
    # albo tekst, ktory wypadl ze znacznika i nikt tego nie zauwazyl.
    if zbedne:
        print('  uwaga klucze w slowniku, ktorych nikt nie uzywa (%d): %s'
              % (len(zbedne), ', '.join(zbedne[:12])))
    else:
        print('  ok    zaden klucz w slowniku nie jest sierota')

    print('\nBLEDOW: %d' % len(bledy))
    return 1 if bledy else 0


if __name__ == '__main__':
    sys.exit(main())
