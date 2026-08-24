#!/usr/bin/env python3
"""Czy kazdy przycisk cos robi: funkcje wolane z onclick/onchange musza istniec.

Martwy przycisk nie rzuca bledem widocznym dla uzytkownika - w konsoli leci
"is not defined", a w interfejsie po prostu nic sie nie dzieje. Sprawdzamy to
na ZBUDOWANYCH wariantach, bo w zrodle obok siebie leza wszystkie trzy.
"""
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / 'app'
WBUDOWANE = {
    'this', 'event', 'window', 'document', 'console', 'alert', 'setTimeout',
    'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'Array', 'Object',
    'JSON', 'Math', 'Date', 'if', 'return', 'true', 'false', 'null', 'undefined',
    'navigator', 'localStorage', 'location', 'typeof', 'new', 'void', 'else',
    'function', 'catch', 'for', 'while', 'switch', 'try',
}

bledy_ogolem = 0
for wariant in ('keys', 'proxy', 'owner'):
    html = (APP / f'web-{wariant}.html').read_text(encoding='utf-8')

    # Wywolania z atrybutow zdarzen
    atrybuty = re.findall(r'on(?:click|change|input|submit|keydown|keyup)="([^"]*)"', html)
    wolane = set()
    for a in atrybuty:
        # (?<![.\w$]) odcina wywolania metod po kropce - one nie sa funkcjami globalnymi
        for nazwa in re.findall(r'(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(', a):
            if nazwa not in WBUDOWANE:
                wolane.add(nazwa)

    # Definicje: function X, X = function, let/const/var X = (...) =>, window.X =
    zdefiniowane = set(re.findall(r'function\s+([A-Za-z_$][\w$]*)\s*\(', html))
    zdefiniowane |= set(re.findall(r'window\.([A-Za-z_$][\w$]*)\s*=', html))
    zdefiniowane |= set(re.findall(r'(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()', html))
    zdefiniowane |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function', html))

    brak = sorted(wolane - zdefiniowane)
    if brak:
        bledy_ogolem += len(brak)
        print(f'  BLAD  {wariant}: przyciski wolajace nieistniejace funkcje: {len(brak)}')
        for n in brak:
            gdzie = [a for a in atrybuty if n + '(' in a][:1]
            print(f'          {n}()   np. w: {gdzie[0][:70] if gdzie else "?"}')
    else:
        print(f'  ok    {wariant}: wszystkie {len(wolane)} funkcji z onclick/onchange istnieja')

print()
print(f'BLEDOW: {bledy_ogolem}')
sys.exit(1 if bledy_ogolem else 0)
