#!/usr/bin/env python3
"""Audyt repozytorium: bez marki klienta z testow i szczegolow jego branzy.

Repozytorium jest publiczne. Pierwsze testy aplikacji szly na materialach jednej firmy, a komentarze,
dane testowe i sygnatury powtarzaly potem jej nazwe, konkurentow i szczegoly branzy. Zgloszenie
z 14.10.2026: takie slady usuwamy z biezacych plikow i pilnujemy, zeby nie wracaly.

Audyt czyta wszystkie pliki sledzone przez git (poza bibliotekami w app/pwa/lib i plikami binarnymi).
Lista slow nie lezy tu jawnie: sa tylko skroty SHA-256 calych slow i poczatkow slow (rdzen z odmiana),
wiec sam audyt niczego nie zdradza. Slowa porownujemy po normalizacji NFC i zamianie na male litery.

Uzycie:
  python3 narzedzia/audyt_klienta.py            # cale repozytorium, kod wyjscia 1 przy znalezisku
  python3 narzedzia/audyt_klienta.py PLIK...    # tylko te pliki
Wynik pokazuje plik, wiersz i zamaskowane slowo (pierwsza litera i liczba liter).
"""
import hashlib
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent

# Cale slowa (marka klienta z testow i nazwy konkurentow z jego branzy).
SLOWA = {
    '452ddac3092b5a859873096c3e55f0dbffc26c72f7cc9a50a75651ea3f13636a',
    '153f25d59bdaa619f92080a28af314758dbb4576736a9e114a57ce27daf04096',
    '3ee49785593999cef46e1c1482ad1a246d6e319b48149ec2e8cdff05ddf8b236',
    'ab4f4972ad0294abbd994703af86138fd441f8aca35f9977c5599faf6f275e48',
    '7848c4082d3a44ac931f75848ec86a1cb9e97a527723cccf2faec7ac25ddf6df',
    '30b98ca8dbfd7ae4ea9f779cbd31e54afea32e156178945cd5a6f83a90f5f738',
    'ca96bbe975e2e09fa2e26bda477eff89ce0c9fe0ab2a10056986255cfc90b8f1',
}
# Poczatki slow: (liczba liter, skrot tych liter). Lapia kazda odmiane rdzenia branzy.
POCZATKI = (
    (6, 'ca9babd68f8075b7750ea4ac4d923eda07181049f7c9d0e88b73b01e8ac6e58b'),
    (8, 'd8a3453987c91a58615790d3f2c6230195234d68d4d55d7b85ab23dac02d5701'),
    (8, '00d2863c14b29ff28eec1ece1beb5ac186b9ce476539e33f2a42664d5de12a8c'),
    (9, '7322664ada24e1660dd5202e6c0d1d720ab451dd74def7dbb41386569e2d7d3f'),
)

# Biblioteki z cudzym kodem i krojami w base64: przypadkowe ciagi liter, nie tekst.
POMIN_KATALOGI = ('app/pwa/lib/',)
POMIN_ROZSZERZENIA = {
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.icns', '.pdf', '.woff', '.woff2', '.ttf', '.otf',
    '.mp4', '.mp3', '.wav', '.zip', '.gz', '.sqlite', '.db', '.bin',
}
# Wiersz dluzszy niz to jest danymi (obraz w base64, zminifikowany kod), a nie tekstem.
MAKS_WIERSZ = 2000

LITERY = re.compile(r'[^\W\d_]+')
_pamiec = {}


def _skrot(tekst):
    return hashlib.sha256(tekst.encode('utf-8')).hexdigest()


def zakazane(slowo):
    """Czy slowo (male litery, NFC) jest na liscie: cale albo jego poczatek."""
    if slowo not in _pamiec:
        _pamiec[slowo] = _skrot(slowo) in SLOWA or any(
            len(slowo) >= ile and _skrot(slowo[:ile]) == skrot for ile, skrot in POCZATKI)
    return _pamiec[slowo]


def znajdz(tekst):
    """Lista (nr_wiersza, slowo) dla zakazanych slow w tekscie."""
    wynik = []
    for nr, wiersz in enumerate(tekst.splitlines(), 1):
        if len(wiersz) > MAKS_WIERSZ:
            continue
        for slowo in LITERY.findall(unicodedata.normalize('NFC', wiersz).lower()):
            if zakazane(slowo):
                wynik.append((nr, slowo))
    return wynik


def maska(slowo):
    return '%s… (%d liter)' % (slowo[0], len(slowo))


def pliki_repo():
    wynik = subprocess.run(['git', 'ls-files', '-z'], cwd=KORZEN, capture_output=True, check=True)
    for nazwa in wynik.stdout.decode('utf-8').split('\0'):
        if not nazwa or nazwa.startswith(POMIN_KATALOGI) or Path(nazwa).suffix.lower() in POMIN_ROZSZERZENIA:
            continue
        yield nazwa


def main(argv):
    nazwy = argv[1:] or list(pliki_repo())
    bledy = 0
    for nazwa in nazwy:
        sciezka = KORZEN / nazwa
        if not sciezka.is_file():
            continue
        try:
            tresc = sciezka.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        for nr, slowo in znajdz(tresc):
            bledy += 1
            print('  BLAD  %s:%d: %s' % (nazwa, nr, maska(slowo)))
    if bledy:
        print('BLEDOW: %d (marka klienta albo szczegoly branzy z testow; zamien na neutralny przyklad)' % bledy)
        return 1
    print('ok    %d plikow bez marki klienta i szczegolow branzy z testow' % len(nazwy))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
