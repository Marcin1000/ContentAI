#!/usr/bin/env python3
"""
Content AI - zapadka kolorow: twarde kolory hex poza tokenami systemu projektowego.

Paleta zyje w <style id="cai-tokeny"> (tokeny + aliasy starych nazw). Kazdy hex poza tym
blokiem to kolor, ktory nie pojdzie za motywem ani za zmiana palety. Liczba takich miejsc
nie moze rosnac; przy kazdej migracji obniza sie PROG w tym pliku.

Nie licza sie: blok tokenow, eksporty do druku/DOCX/PDF (dokument ma stale kolory papieru,
oznaczone komentarzem "kolory-eksportu"), zrodlowe ostrzezenie (@@IF zrodlo) i komentarze.

Uzycie: python3 narzedzia/audyt_kolory.py [--lista]
Kod wyjscia: 0 gdy liczba <= PROG, 1 gdy wzrosla.
"""
import re
import sys
from pathlib import Path

PROG = 7  # obnizaj przy kazdej migracji; 7 = theme-color (meta i JS musza miec hex) + maska #000


ZRODLO = Path(__file__).resolve().parent.parent / "app" / "contentai.src.html"


def policz(t):
    t = re.sub(r'<style id="cai-tokeny">.*?</style>', "", t, flags=re.S)
    t = re.sub(r"<!--@@IF zrodlo-->.*?<!--@@ENDIF-->", "", t, flags=re.S)
    # fragmenty oznaczone jako kolory dokumentu (druk, DOCX, PDF, raport)
    t = re.sub(r"/\* kolory-eksportu:start \*/.*?/\* kolory-eksportu:koniec \*/", "", t, flags=re.S)
    t = re.sub(r"// kolory-eksportu:start.*?// kolory-eksportu:koniec", "", t, flags=re.S)
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    wyniki = []
    for nr, linia in enumerate(t.split("\n"), 1):
        bez_kom = re.sub(r"(^|\s)//.*$", "", linia)
        for m in re.finditer(r"#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Za-z_-])", bez_kom):
            # pomijamy kotwice i identyfikatory w selektorach typu #abc (3 znaki bywaja id)
            if len(m.group(0)) == 4 and re.match(r"#[a-z]{3}$", m.group(0)):
                continue
            wyniki.append((nr, m.group(0), linia.strip()[:120]))
    return wyniki


def main():
    t = ZRODLO.read_text(encoding="utf-8")
    w = policz(t)
    if "--lista" in sys.argv:
        for nr, h, l in w:
            print(f"{nr:6} {h:8} {l}")
    prog = PROG
    print(f"twarde kolory poza tokenami: {len(w)} (prog {prog})")
    if len(w) > prog:
        print("BLAD: przybylo twardych kolorow - uzyj tokenu --c-* z bloku cai-tokeny")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
