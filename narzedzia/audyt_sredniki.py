#!/usr/bin/env python3
"""Kontrola: zadnego srednika w tekstach dla klienta.

Decyzja Marcina (2026-10-12): w tekstach strony produktowej i aplikacji nie ma
znaku ;. Zdanie ze srednikiem dzielimy na dwa albo laczymy przecinkiem.

Co sprawdzamy:
  1. strona produktowa: widoczny tekst i atrybuty czytane przez ludzi (alt,
     title, aria-label, opis meta, data-et w tabeli cennika) ZBUDOWANYCH stron
     w showcase/, czyli to, co widzi odwiedzajacy, razem z wartosciami
     z konfiguracji,
  2. aplikacja (app/contentai.src.html): oba slowniki I18N, tekst i atrybuty
     znacznikow HTML oraz napisy w skryptach z polskimi znakami (tekst wpisany
     na sztywno obok slownika),
  3. serwer: napisy w modulach z ekranami i e-mailami dla klienta
     (MODULY_KLIENTA): logowanie, konto, platnosci, dokumenty, poczta, bledy.

Czego swiadomie nie sprawdzamy:
  - dokumentow prawnych (dokumenty-prawne/*.md): to jezyk prawnika, a kazda
    zmiana tresci to nowa wersja do ponownej akceptacji,
  - promptow dla modelu (klient ich nie widzi) i tresci generowanych artykulow,
  - dziennikow i komunikatow CLI (sa dla operatora),
  - srednika jako separatora w kodzie: CSS, ciasteczka, slowa kluczowe
    w metadanych plikow (oznaczenia.js), encje HTML (&amp;).

Uzycie:
    python3 narzedzia/audyt_sredniki.py
"""
import html
import re
import sys
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent
SHOWCASE = KORZEN / 'showcase'
APLIKACJA = KORZEN / 'app' / 'contentai.src.html'
MODULY_KLIENTA = ('ekrany-kont.js', 'ekrany-platnosci.js', 'logowanie.js', 'bledy.js',
                  'dokumenty-prawne.js', 'poczta-szablony.js')
ATRYBUTY_CZYTANE = ('alt', 'title', 'aria-label', 'placeholder', 'content', 'data-et',
                    'data-pauza', 'data-wznow')
POLSKIE = re.compile('[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]')
# Prompty dla modelu sa po angielsku, ale cytuja polskie slowa ("branża", formy
# rodzajowe). Napis liczy sie jako polski, gdy polskich slow funkcyjnych jest
# w nim wiecej niz angielskich.
SLOWA_PL = {'i', 'w', 'z', 'na', 'się', 'do', 'nie', 'że', 'jest', 'to', 'o', 'a', 'od', 'po', 'dla', 'ale', 'jak', 'czy', 'albo', 'już'}
SLOWA_EN = {'the', 'and', 'of', 'to', 'a', 'in', 'is', 'with', 'for', 'not', 'or', 'it', 'be', 'on', 'as', 'by', 'you', 'that', 'never', 'only'}
# Srednik w zdaniu: po slowie, liczbie, nawiasie albo cudzyslowie, a po nim
# spacja i mala litera (albo koniec napisu doklejanego do nastepnego).
# Wielka litera po sredniku to w tych plikach atrybuty ciasteczek (; Path=/).
W_ZDANIU = re.compile(r'[\w)\]%”"]\s*;(?:\s+[a-ząćęłńóśźż„"(]|\s*$)')


def czysty(tekst):
    """Tekst bez znacznikow HTML i encji (srednik z &amp; to nie srednik w tekscie)."""
    return html.unescape(re.sub(r'<[^>]*>', ' ', tekst))


def numer_linii(tresc, pozycja):
    return tresc.count('\n', 0, pozycja) + 1


# ─── JavaScript: napisy z kodu ───────────────────────────────────────────────

SLOWA_PRZED_WYRAZENIEM = {'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw',
                          'new', 'instanceof', 'do', 'else', 'yield', 'await'}


def napisy_js(kod):
    """Lista (pozycja, tekst): zawartosc '...' i "..." oraz czesci stale szablonow `...`
    (bez wyrazen ${...}, za to z zagniezdzonymi szablonami wewnatrz nich).
    Pomija komentarze i wyrazenia regularne (heurystyka: / po operatorze to regex)."""
    wynik = []
    n = len(kod)
    stos = []            # glebokosc nawiasow { } w kazdym otwartym ${...}
    poprzedni = '('      # ostatni znaczacy znak kodu; '(' = moze zaczac sie wyrazenie

    def czesc_szablonu(i):
        start = i
        while i < n:
            z = kod[i]
            if z == '\\':
                i += 2
                continue
            if z == '`':
                wynik.append((start, kod[start:i]))
                return i + 1, False
            if z == '$' and kod.startswith('${', i):
                wynik.append((start, kod[start:i]))
                return i + 2, True
            i += 1
        wynik.append((start, kod[start:n]))
        return n, False

    i = 0
    while i < n:
        z = kod[i]
        if z.isspace():
            i += 1
            continue
        if kod.startswith('//', i):
            j = kod.find('\n', i)
            i = n if j < 0 else j
            continue
        if kod.startswith('/*', i):
            j = kod.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if z in '\'"':
            j = i + 1
            while j < n and kod[j] != z and kod[j] != '\n':
                j += 2 if kod[j] == '\\' else 1
            wynik.append((i + 1, kod[i + 1:j]))
            i = j + 1
            poprzedni = 'a'
            continue
        if z == '`' or (z == '}' and stos and stos[-1] == 0):
            if z == '}':
                stos.pop()
            i, w_wyrazeniu = czesc_szablonu(i + 1)
            if w_wyrazeniu:
                stos.append(0)
            poprzedni = '(' if w_wyrazeniu else 'a'
            continue
        if z == '{':
            if stos:
                stos[-1] += 1
        elif z == '}':
            if stos:
                stos[-1] -= 1
        elif z == '/' and poprzedni in '(,=:[!&|?{};+-*%<>~^':
            j = i + 1
            klasa = False
            while j < n and kod[j] != '\n':
                c = kod[j]
                if c == '\\':
                    j += 2
                    continue
                if klasa:
                    klasa = c != ']'
                elif c == '[':
                    klasa = True
                elif c == '/':
                    break
                j += 1
            i = j + 1
            while i < n and kod[i].isalpha():
                i += 1
            poprzedni = 'a'
            continue
        elif z.isalnum() or z in '_$':
            j = i
            while j < n and (kod[j].isalnum() or kod[j] in '_$'):
                j += 1
            poprzedni = '(' if kod[i:j] in SLOWA_PRZED_WYRAZENIEM else 'a'
            i = j
            continue
        poprzedni = z
        i += 1
    return wynik


def zdanie_ze_srednikiem(napis, tylko_polskie=False):
    """Czy napis z kodu to tekst dla czlowieka ze srednikiem w zdaniu."""
    t = czysty(napis)
    if tylko_polskie:
        slowa = re.findall(r'[^\W\d_]+', t.lower())
        if not POLSKIE.search(t) or sum(w in SLOWA_PL for w in slowa) <= sum(w in SLOWA_EN for w in slowa):
            return False
    # Blok CSS (klamry po usunieciu {zmiennych}) albo atrybuty ciasteczka.
    if re.search(r'[{}]', re.sub(r'\{[\w.]+\}', '', t)) or re.search(r'HttpOnly|SameSite=|Path=/', t):
        return False
    return len(t.split()) >= 3 and bool(W_ZDANIU.search(t))


# ─── Kontrole ────────────────────────────────────────────────────────────────

def strona():
    bledy = []
    for plik in sorted(SHOWCASE.rglob('*.html')):
        wzgl = plik.relative_to(KORZEN).as_posix()
        if '/zrodlo/' in '/' + wzgl:
            continue
        s = plik.read_text(encoding='utf-8')
        bez_kodu = re.sub(r'<(script|style)\b.*?</\1>|<!--.*?-->',
                          lambda m: '\n' * m.group(0).count('\n'), s, flags=re.S)
        for m in re.finditer(r'>([^<>]+)<', bez_kodu):
            if ';' in html.unescape(m.group(1)):
                bledy.append((wzgl, numer_linii(bez_kodu, m.start()), html.unescape(m.group(1)).strip()))
        for m in re.finditer(r'\s(%s)="([^"]*)"' % '|'.join(ATRYBUTY_CZYTANE), bez_kodu):
            if ';' in html.unescape(m.group(2)):
                bledy.append((wzgl, numer_linii(bez_kodu, m.start()), '%s="%s"' % (m.group(1), html.unescape(m.group(2)))))
    return bledy


def blok_slownika(zrodlo, nazwa):
    """Cialo slownika I18N przez liczenie nawiasow (jak w audyt_i18n.py)."""
    start = zrodlo.index('\n  %s: {' % nazwa) + len('\n  %s: ' % nazwa)
    glebokosc, i, w_tekscie = 0, start, None
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
                return start, i + 1
        i += 1
    raise SystemExit('nie znaleziono konca slownika %s' % nazwa)


def aplikacja():
    bledy = []
    wzgl = APLIKACJA.relative_to(KORZEN).as_posix()
    s = APLIKACJA.read_text(encoding='utf-8')
    poczatek = s.index('var I18N = {')
    slowniki = []
    for jezyk in ('pl', 'en'):
        a, b = blok_slownika(s[poczatek:], jezyk)
        slowniki.append((poczatek + a, poczatek + b))
        blok = s[poczatek + a:poczatek + b]
        for m in re.finditer(r"'([\w.$-]+)'\s*:\s*('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")", blok):
            wartosc = m.group(2)[1:-1].replace("\\'", "'")
            if ';' in czysty(wartosc):
                bledy.append((wzgl, numer_linii(s, poczatek + a + m.start()), '%s/%s: %s' % (jezyk, m.group(1), czysty(wartosc))))
    # Znaczniki poza skryptami i stylami
    bez_kodu = re.sub(r'<(script|style)\b.*?</\1>|<!--.*?-->',
                      lambda m: '\n' * m.group(0).count('\n'), s, flags=re.S)
    for m in re.finditer(r'>([^<>]+)<', bez_kodu):
        if ';' in html.unescape(m.group(1)):
            bledy.append((wzgl, numer_linii(bez_kodu, m.start()), html.unescape(m.group(1)).strip()))
    for m in re.finditer(r'\s(%s)="([^"]*)"' % '|'.join(ATRYBUTY_CZYTANE), bez_kodu):
        if ';' in html.unescape(m.group(2)):
            bledy.append((wzgl, numer_linii(bez_kodu, m.start()), '%s="%s"' % (m.group(1), m.group(2))))
    # Polskie napisy w skryptach poza slownikami
    for m in re.finditer(r'<script\b[^>]*>(.*?)</script>', s, flags=re.S):
        for pozycja, napis in napisy_js(m.group(1)):
            gdzie = m.start(1) + pozycja
            if any(a <= gdzie < b for a, b in slowniki):
                continue
            if zdanie_ze_srednikiem(napis, tylko_polskie=True):
                bledy.append((wzgl, numer_linii(s, gdzie), czysty(napis).strip()))
    return bledy


def serwer():
    bledy = []
    for nazwa in MODULY_KLIENTA:
        plik = KORZEN / 'serwer' / nazwa
        s = plik.read_text(encoding='utf-8')
        for pozycja, napis in napisy_js(s):
            if zdanie_ze_srednikiem(napis):
                bledy.append(('serwer/' + nazwa, numer_linii(s, pozycja), czysty(napis).strip()))
    return bledy


def main():
    znalezione = strona() + aplikacja() + serwer()
    if znalezione:
        print('BLAD: srednik w tekstach dla klienta (%d):' % len(znalezione))
        for plik, nr, tekst in znalezione[:30]:
            print('  %s:%d  %s' % (plik, nr, ' '.join(tekst.split())[:150]))
        if len(znalezione) > 30:
            print('  ... i %d wiecej' % (len(znalezione) - 30))
        print('\nZdanie ze srednikiem podziel na dwa albo polacz przecinkiem (decyzja 2026-10-12).')
        return 1
    print('ok    brak srednikow w tekstach strony, aplikacji, ekranow i e-maili dla klienta')
    return 0


if __name__ == '__main__':
    sys.exit(main())
