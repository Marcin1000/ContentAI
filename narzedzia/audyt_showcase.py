#!/usr/bin/env python3
"""Kontrola strony produktowej content-ai.net (showcase/).

Strona powstaje z jednego szablonu i jednego slownika PL/EN (narzedzia/buduj_strone.py).
Ta kontrola pilnuje rzeczy, ktorych nie widac golym okiem, a ktore psuja strone po cichu:

  1. wygenerowane pliki sa aktualne, a teksty kompletne w PL i EN
     (wola buduj_strone.py --sprawdz: brak tekstu, tekst nieuzyty, liczby z plany.js),
  2. zadnych zasobow z obcych serwerow: src=, srcset=, url(), <link href> do arkuszy,
     fontow i ikon tylko z wlasnego hosta; linki i adres formularza tylko do content-ai.net,
  3. bez dlugich myslnikow (U+2014, U+2013) i bez marki klienta (DHL),
  4. kazda strona ma lang, title, meta description, canonical, hreflang pl/en/x-default
     i dokladnie jeden naglowek h1,
  5. pod CSP: zadnych skryptow w tresci poza JSON-LD, zadnych onclick/onchange, zadnych style=,
     JSON-LD jest poprawnym JSON-em,
  6. budzet JS: wlasne skrypty razem <= 15 kB po gzip,
  7. system marki: w arkuszu strony zadnego pisma ponizej 12 px; fonty strony razem <= 110 kB.

Uzycie:
    python3 narzedzia/audyt_showcase.py
"""
import gzip
import json
import re
import subprocess
import sys
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent
SHOWCASE = KORZEN / 'showcase'
DOMENA = 'https://content-ai.net'

# strona -> (jezyk, adres kanoniczny)
STRONY = {
    'index.html': ('pl', DOMENA + '/'),
    'en/index.html': ('en', DOMENA + '/en/'),
    'prywatnosc/index.html': ('pl', DOMENA + '/prywatnosc/'),
    'en/privacy/index.html': ('en', DOMENA + '/en/privacy/'),
}
# Adresy, do ktorych wolno LINKOWAC (nawigacja, formularz, kanoniczne). Zasobow stad nie ladujemy.
DOZWOLONE_LINKI = re.compile(r'^https://(app\.)?content-ai\.net(/|$|\?)')
# Przestrzenie nazw i slowniki danych - nie sa zadaniami sieciowymi.
NIE_SIEC = re.compile(r'^https?://(www\.w3\.org|schema\.org|www\.sitemaps\.org)/')
TEKSTOWE = ('.html', '.css', '.js', '.json', '.svg', '.txt', '.xml', '.webmanifest')
BUDZET_JS = 15 * 1024
BUDZET_FONTY = 110 * 1024
MIN_PISMO = 12


def pliki_tekstowe():
    for p in sorted(SHOWCASE.rglob('*')):
        if p.is_file() and p.suffix in TEKSTOWE:
            yield p, p.relative_to(SHOWCASE).as_posix()


def zewnetrzny(adres):
    a = adres.strip()
    return a.startswith('//') or re.match(r'^[a-z][a-z0-9+.-]*:', a, re.I) and not a.startswith(('data:', 'mailto:', 'tel:', 'javascript:'))


def sprawdz_hosty(tresc, nazwa, bledy):
    # zasoby: musza byc z wlasnego hosta
    for m in re.finditer(r'\b(src|srcset|poster)\s*=\s*"([^"]*)"', tresc):
        for adres in re.split(r',\s*', m.group(2)):
            adres = adres.strip().split(' ')[0]
            if adres and zewnetrzny(adres) and not NIE_SIEC.match(adres):
                bledy.append('%s: zasob z obcego serwera %s="%s"' % (nazwa, m.group(1), adres))
    for m in re.finditer(r'url\(\s*[\'"]?([^\'")]+)', tresc):
        adres = m.group(1)
        if zewnetrzny(adres) and not NIE_SIEC.match(adres):
            bledy.append('%s: zasob z obcego serwera url(%s)' % (nazwa, adres))
    for m in re.finditer(r'@import\s+[\'"]?([^\'";\s]+)', tresc):
        if zewnetrzny(m.group(1)):
            bledy.append('%s: @import z obcego serwera %s' % (nazwa, m.group(1)))
    for m in re.finditer(r'<link\b[^>]*>', tresc):
        znacznik = m.group(0)
        href = re.search(r'href="([^"]*)"', znacznik)
        rel = re.search(r'rel="([^"]*)"', znacznik)
        if not href:
            continue
        nawigacyjny = rel and set(rel.group(1).split()) <= {'canonical', 'alternate'}
        if zewnetrzny(href.group(1)) and not (nawigacyjny and DOZWOLONE_LINKI.match(href.group(1))):
            bledy.append('%s: <link> do obcego serwera %s' % (nazwa, href.group(1)))
    # linki, formularz, adres API: tylko content-ai.net i app.content-ai.net
    for m in re.finditer(r'\b(href|action|data-api|content)\s*=\s*"(https?:[^"]*|//[^"]*)"', tresc):
        adres = m.group(2)
        if not DOZWOLONE_LINKI.match(adres) and not NIE_SIEC.match(adres):
            bledy.append('%s: adres spoza content-ai.net %s="%s"' % (nazwa, m.group(1), adres))
    if nazwa.endswith('.js'):
        for m in re.finditer(r'[\'"`](https?:)?//[^\'"`\s]+', tresc):
            adres = m.group(0)[1:]
            if not DOZWOLONE_LINKI.match(adres) and not NIE_SIEC.match(adres):
                bledy.append('%s: adres w skrypcie spoza content-ai.net %s' % (nazwa, adres))


def sprawdz_strone(tresc, nazwa, jezyk, kanoniczny, bledy):
    m = re.search(r'<html\b[^>]*\blang="([^"]+)"', tresc)
    if not m or m.group(1) != jezyk:
        bledy.append('%s: <html lang> powinien byc "%s"' % (nazwa, jezyk))
    if not re.search(r'<title>[^<]{10,}</title>', tresc):
        bledy.append('%s: brak <title>' % nazwa)
    if not re.search(r'<meta name="description" content="[^"]{50,}"', tresc):
        bledy.append('%s: brak meta description' % nazwa)
    if '<link rel="canonical" href="%s">' % kanoniczny not in tresc:
        bledy.append('%s: canonical powinien wskazywac %s' % (nazwa, kanoniczny))
    for hl in ('pl', 'en', 'x-default'):
        if not re.search(r'<link rel="alternate" hreflang="%s" href="https://content-ai\.net/[^"]*">' % hl, tresc):
            bledy.append('%s: brak hreflang="%s"' % (nazwa, hl))
    h1 = len(re.findall(r'<h1\b', tresc))
    if h1 != 1:
        bledy.append('%s: naglowkow h1 jest %d, powinien byc 1' % (nazwa, h1))
    for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', tresc, re.S):
        atrybuty, wnetrze = m.group(1), m.group(2)
        if 'src=' in atrybuty:
            if wnetrze.strip():
                bledy.append('%s: <script src> z trescia w srodku' % nazwa)
            continue
        if 'type="application/ld+json"' not in atrybuty:
            bledy.append('%s: skrypt w tresci HTML (CSP pozwala tylko na pliki)' % nazwa)
            continue
        try:
            json.loads(wnetrze)
        except ValueError as e:
            bledy.append('%s: JSON-LD nie jest poprawnym JSON-em (%s)' % (nazwa, e))
    for m in re.finditer(r'<[^>]+\s(on[a-z]+)\s*=', tresc):
        bledy.append('%s: atrybut %s w HTML (pod CSP uchwyty tylko w strona.js)' % (nazwa, m.group(1)))
    if re.search(r'<[^>]+\sstyle\s*=', tresc):
        bledy.append('%s: atrybut style= w HTML (CSP style-src \'self\')' % nazwa)


def main():
    bledy = []

    # 1. aktualnosc i kompletnosc tekstow - przez generator
    wynik = subprocess.run([sys.executable, str(KORZEN / 'narzedzia' / 'buduj_strone.py'), '--sprawdz'],
                           capture_output=True, text=True)
    for linia in wynik.stdout.strip().splitlines():
        print('  ' + linia.strip() if not linia.startswith('  ') else linia)
    if wynik.returncode != 0:
        bledy.append('buduj_strone.py --sprawdz zakonczyl sie bledem')

    # 2-3. obce hosty, dlugie myslniki, marka klienta - we wszystkich plikach tekstowych strony
    przed = len(bledy)
    for plik, nazwa in pliki_tekstowe():
        tresc = plik.read_text(encoding='utf-8', errors='replace')
        sprawdz_hosty(tresc, nazwa, bledy)
        for znak in ('\u2014', '\u2013'):
            if znak in tresc:
                bledy.append('%s: dlugi myslnik U+%04X' % (nazwa, ord(znak)))
        if re.search(r'\bDHL\b', tresc, re.I):
            bledy.append('%s: marka klienta (DHL) w materiale publicznym' % nazwa)
    print('  %s    obce serwery, dlugie myslniki, marka klienta' % ('ok' if len(bledy) == przed else 'BLAD'))

    # 4-5. struktura stron i CSP
    przed = len(bledy)
    for nazwa, (jezyk, kanoniczny) in STRONY.items():
        plik = SHOWCASE / nazwa
        if not plik.is_file():
            bledy.append('brak pliku showcase/%s' % nazwa)
            continue
        sprawdz_strone(plik.read_text(encoding='utf-8'), nazwa, jezyk, kanoniczny, bledy)
    print('  %s    lang, title, description, canonical, hreflang, jedno h1, CSP' % ('ok' if len(bledy) == przed else 'BLAD'))

    # 6. budzet JS
    js = sorted((SHOWCASE / 'zasoby').glob('*.js'))
    rozmiar = sum(len(gzip.compress(p.read_bytes(), 9)) for p in js)
    if rozmiar > BUDZET_JS:
        bledy.append('JS strony %d B po gzip, budzet %d B' % (rozmiar, BUDZET_JS))
    print('  %s    JS strony %.1f kB po gzip (budzet 15 kB)' % ('ok' if rozmiar <= BUDZET_JS else 'BLAD', rozmiar / 1024))

    # 7. minimum pisma i budzet fontow
    przed = len(bledy)
    for css in sorted((SHOWCASE / 'zasoby').glob('*.css')):
        for nr, linia in enumerate(css.read_text(encoding='utf-8').splitlines(), 1):
            for m in re.finditer(r'font-size:\s*([0-9.]+)px', linia):
                if float(m.group(1)) < MIN_PISMO:
                    bledy.append('zasoby/%s:%d: pismo %spx, minimum systemu marki to %d px' % (css.name, nr, m.group(1), MIN_PISMO))
    fonty = sum(p.stat().st_size for p in (SHOWCASE / 'fonty').glob('*.woff2'))
    if fonty > BUDZET_FONTY:
        bledy.append('fonty strony %d B, budzet %d B' % (fonty, BUDZET_FONTY))
    print('  %s    pismo >= %d px, fonty %.0f kB (budzet 110 kB)' % ('ok' if len(bledy) == przed else 'BLAD', MIN_PISMO, fonty / 1024))

    for b in bledy:
        print('  BLAD  %s' % b)
    print('\nBLEDOW: %d' % len(bledy))
    return 1 if bledy else 0


if __name__ == '__main__':
    sys.exit(main())
