#!/usr/bin/env python3
"""Buduje strone produktowa content-ai.net z jednego szablonu i jednego slownika PL/EN.

Zrodla (showcase/zrodlo/):
  szablon.html      strona glowna
  prywatnosc.html   polityka prywatnosci
  czesci/*.html     wspolne kawalki (naglowek, stopka), wstawiane przez {{>nazwa}}
  teksty.json       {"pl": {klucz: tekst}, "en": {klucz: tekst}}
  ikony.svg         zestaw ikon (Lucide, ISC); na strone trafiaja tylko uzyte

Wynik (showcase/):
  index.html, en/index.html, prywatnosc/index.html, en/privacy/index.html,
  robots.txt, sitemap.xml

Skladnia szablonu:
  {{t:klucz}}   tekst z wnetrzem HTML (np. <b>, <span class="zakr">)
  {{a:klucz}}   tekst do atrybutu: bez znacznikow, z ucieczka cudzyslowow
  {{$nazwa}}    wartosc wbudowana: jezyk, url, url_pl, url_en, glowna, alt,
                prywatnosc, prywatnosc_alt, og_locale, og_locale_alt, og_obraz, app, api, jsonld
  {{v:sciezka}} adres zasobu z odciskiem tresci (?v=...), zeby przegladarka nie trzymala starej wersji
  {{>nazwa}}    wstawia czesci/nazwa.html
  {# ... #}     komentarz szablonu, nie trafia do wyniku

Uzycie:
  python3 narzedzia/buduj_strone.py            # zapisuje pliki
  python3 narzedzia/buduj_strone.py --sprawdz  # kod 1, gdy pliki nieaktualne albo teksty niekompletne

--sprawdz zatrzymuje CI, gdy: wygenerowany plik rozni sie od zapisanego, klucz z szablonu nie ma
tekstu w PL albo w EN, tekst w slowniku nie jest nigdzie uzyty, slowniki maja rozne klucze, w wyniku
zostal znacznik szablonu albo dlugi myslnik, albo liczby pakietow w tekstach rozjechaly sie
z serwer/plany.js.
"""
import hashlib
import html
import json
import re
import sys
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent
SHOWCASE = KORZEN / 'showcase'
ZRODLO = SHOWCASE / 'zrodlo'
PLANY_JS = KORZEN / 'serwer' / 'plany.js'

DOMENA = 'https://content-ai.net'
APP = 'https://app.content-ai.net/'
API = 'https://app.content-ai.net/api/prosba-o-dostep'
JEZYKI = ('pl', 'en')

# szablon -> {jezyk: (plik wynikowy wzgledem showcase/, sciezka w adresie)}
STRONY = [
    ('szablon.html', {'pl': ('index.html', '/'), 'en': ('en/index.html', '/en/')}),
    ('prywatnosc.html', {'pl': ('prywatnosc/index.html', '/prywatnosc/'),
                         'en': ('en/privacy/index.html', '/en/privacy/')}),
]
OG_LOCALE = {'pl': 'pl_PL', 'en': 'en_US'}

# Liczby z serwer/plany.js, ktore musza stac w tekstach pakietow (w obu jezykach).
# Gdy ktos zmieni limit w plany.js, kontrola wskaze tekst do poprawienia - z poprawna odmiana,
# ktorej automat by nie zgadl („3 artykuly" / „5 artykulow").
LICZBY_PAKIETOW = {
    'plan-free-1': ['darmowy.artykul'],
    'plan-free-2': ['darmowy.dokumenty'],
    'plan-std-1': ['standard.artykul'],
    'plan-std-2': ['standard.grafika', 'standard.audio', 'standard.transkrypcja'],
    'plan-std-3': ['standard.dokumenty'],
    'plan-note': ['darmowy.wywolanie', 'standard.wywolanie'],
}

DLUGIE_MYSLNIKI = ('\u2014', '\u2013')
ZNACZNIK = re.compile(r'\{\{([tav$>]):?([^}]*)\}\}')


class BladBudowy(Exception):
    pass


def czytaj_plany():
    """Wyciaga z plany.js limity pakietow bez uruchamiania Node."""
    tresc = PLANY_JS.read_text(encoding='utf-8')
    wynik = {}
    for nazwa in ('darmowy', 'standard', 'premium'):
        m = re.search(r'\n  %s: \{(.*?)\n  \},' % nazwa, tresc, re.S)
        if not m:
            raise BladBudowy('nie znaleziono pakietu %s w serwer/plany.js' % nazwa)
        blok = m.group(1)
        for pole in ('artykul', 'grafika', 'audio', 'transkrypcja', 'wywolanie'):
            mm = re.search(r'\b%s:\s*(\d+|null)' % pole, blok)
            wynik['%s.%s' % (nazwa, pole)] = mm.group(1) if mm else None
        mm = re.search(r'limitDokumentow:\s*(\d+|null)', blok)
        wynik['%s.dokumenty' % nazwa] = mm.group(1) if mm else None
    return wynik


def bez_znacznikow(tekst):
    return re.sub(r'<[^>]+>', '', tekst)


def do_atrybutu(tekst):
    return html.escape(html.unescape(bez_znacznikow(tekst)), quote=True)


def odcisk(sciezka):
    plik = SHOWCASE / sciezka
    if not plik.is_file():
        raise BladBudowy('brak zasobu %s' % sciezka)
    return hashlib.sha256(plik.read_bytes()).hexdigest()[:10]


def wstaw_czesci(tekst, glebokosc=0):
    if glebokosc > 5:
        raise BladBudowy('zbyt gleboko zagniezdzone {{>...}}')

    def podmien(m):
        plik = ZRODLO / 'czesci' / (m.group(1).strip() + '.html')
        if not plik.is_file():
            raise BladBudowy('brak czesci %s' % plik.relative_to(KORZEN))
        return wstaw_czesci(plik.read_text(encoding='utf-8'), glebokosc + 1)
    return re.sub(r'\{\{>([^}]+)\}\}', podmien, tekst)


def wczytaj_szablon(nazwa):
    tekst = wstaw_czesci((ZRODLO / nazwa).read_text(encoding='utf-8'))
    return re.sub(r'\{#.*?#\}', '', tekst, flags=re.S)


def ikony_strony(tekst, zestaw):
    """Zostawia w zestawie tylko symbole uzyte na stronie (href="#i-...")."""
    uzyte = sorted(set(re.findall(r'href="#(i-[\w-]+)"', tekst)))
    symbole = {m.group(1): m.group(0)
               for m in re.finditer(r'(?s)<symbol id="(i-[\w-]+)".*?</symbol>', zestaw)}
    wlasne = set(re.findall(r'<symbol id="(i-[\w-]+)"', tekst))
    brak = [i for i in uzyte if i not in symbole and i not in wlasne]
    if brak:
        raise BladBudowy('ikony uzyte, a nieobecne w zrodlo/ikony.svg: %s' % ', '.join(brak))
    return '\n'.join(symbole[i] for i in uzyte if i in symbole)


def jsonld(t, jezyk, url):
    """Dane strukturalne z tych samych tekstow, ktore widac na stronie (FAQ = widoczne FAQ)."""
    faq = []
    n = 1
    while 'faq-%d-q' % n in t:
        faq.append({'@type': 'Question', 'name': bez_znacznikow(t['faq-%d-q' % n]),
                    'acceptedAnswer': {'@type': 'Answer', 'text': bez_znacznikow(t['faq-%d-a' % n])}})
        n += 1
    graf = {
        '@context': 'https://schema.org',
        '@graph': [
            {'@type': 'Organization', '@id': DOMENA + '/#organizacja', 'name': 'Content AI',
             'url': DOMENA + '/', 'logo': DOMENA + '/obrazy/icon-512.png'},
            {'@type': 'SoftwareApplication', '@id': DOMENA + '/#aplikacja', 'name': 'Content AI',
             'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Web',
             'url': url, 'inLanguage': jezyk, 'description': bez_znacznikow(t['meta-desc']),
             'publisher': {'@id': DOMENA + '/#organizacja'}},
            {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': jezyk, 'mainEntity': faq},
        ],
    }
    tekst = json.dumps(graf, ensure_ascii=False, indent=1)
    # „</" w JSON-LD zamknalby znacznik <script> przedwczesnie
    return tekst.replace('</', '<\\/')


def renderuj(nazwa_szablonu, szablon, sciezki, jezyk, teksty, uzyte_klucze, ikony):
    t = teksty[jezyk]
    alt = 'en' if jezyk == 'pl' else 'pl'
    sciezki_prywatnosci = dict(STRONY)['prywatnosc.html']
    sciezki_glowne = dict(STRONY)['szablon.html']
    zmienne = {
        'jezyk': jezyk,
        'url': DOMENA + sciezki[jezyk][1],
        'url_pl': DOMENA + sciezki['pl'][1],
        'url_en': DOMENA + sciezki['en'][1],
        'alt': sciezki[alt][1],
        'jezyk_alt': alt,
        'jezyk_pl': sciezki['pl'][1],
        'jezyk_en': sciezki['en'][1],
        'biezacy_pl': 'aria-current="page"' if jezyk == 'pl' else '',
        'biezacy_en': 'aria-current="page"' if jezyk == 'en' else '',
        'glowna': sciezki_glowne[jezyk][1],
        'prywatnosc': sciezki_prywatnosci[jezyk][1],
        'og_locale': OG_LOCALE[jezyk],
        'og_locale_alt': OG_LOCALE[alt],
        'og_obraz': DOMENA + '/obrazy/og-%s.png' % jezyk,
        'app': APP + ('?lang=en' if jezyk == 'en' else ''),
        'api': API,
        'ikony': ikony,
    }
    bledy = []

    def podmien(m):
        rodzaj, nazwa = m.group(1), m.group(2).strip()
        if rodzaj == '$':
            if nazwa == 'jsonld':
                return jsonld(t, jezyk, zmienne['url'])
            if nazwa not in zmienne:
                bledy.append('%s: nieznana zmienna {{$%s}}' % (nazwa_szablonu, nazwa))
                return ''
            return zmienne[nazwa]
        if rodzaj == 'v':
            return '/%s?v=%s' % (nazwa, odcisk(nazwa))
        uzyte_klucze.add(nazwa)
        if nazwa not in t or not t[nazwa].strip():
            bledy.append('%s: klucz „%s" bez tekstu w %s' % (nazwa_szablonu, nazwa, jezyk.upper()))
            return ''
        return t[nazwa] if rodzaj == 't' else do_atrybutu(t[nazwa])

    wynik = ZNACZNIK.sub(podmien, szablon)
    # puste linie po komentarzach szablonu
    wynik = re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n\n', wynik)
    if '{{' in wynik or '}}' in wynik:
        bledy.append('%s (%s): w wyniku zostal znacznik szablonu' % (nazwa_szablonu, jezyk))
    for znak in DLUGIE_MYSLNIKI:
        if znak in wynik:
            bledy.append('%s (%s): dlugi myslnik U+%04X w wyniku' % (nazwa_szablonu, jezyk, ord(znak)))
    return wynik, bledy


def robots():
    return 'User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % DOMENA


def sitemap():
    wiersze = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
               'xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for _, sciezki in STRONY:
        for jezyk in JEZYKI:
            wiersze.append('  <url>')
            wiersze.append('    <loc>%s%s</loc>' % (DOMENA, sciezki[jezyk][1]))
            for j2 in JEZYKI:
                wiersze.append('    <xhtml:link rel="alternate" hreflang="%s" href="%s%s"/>'
                               % (j2, DOMENA, sciezki[j2][1]))
            wiersze.append('    <xhtml:link rel="alternate" hreflang="x-default" href="%s%s"/>'
                           % (DOMENA, sciezki['en'][1]))
            wiersze.append('  </url>')
    wiersze.append('</urlset>')
    return '\n'.join(wiersze) + '\n'


def sprawdz_teksty(teksty, plany):
    bledy = []
    pl, en = set(teksty['pl']), set(teksty['en'])
    for k in sorted(pl - en):
        bledy.append('teksty.json: klucz „%s" jest w PL, brak w EN' % k)
    for k in sorted(en - pl):
        bledy.append('teksty.json: klucz „%s" jest w EN, brak w PL' % k)
    for jezyk in JEZYKI:
        for k, v in teksty[jezyk].items():
            if any(z in v for z in DLUGIE_MYSLNIKI):
                bledy.append('teksty.json: dlugi myslnik w %s/%s' % (jezyk, k))
    for klucz, pola in LICZBY_PAKIETOW.items():
        for pole in pola:
            wartosc = plany.get(pole)
            if wartosc in (None, 'null'):
                bledy.append('plany.js: %s nie jest liczba, a tekst %s ja podaje' % (pole, klucz))
                continue
            for jezyk in JEZYKI:
                tekst = bez_znacznikow(teksty[jezyk].get(klucz, '')).replace('\u00a0', ' ')
                if not re.search(r'(?<![\d,.])%s(?![\d,.]\d)' % re.escape(wartosc), tekst):
                    bledy.append('teksty.json: %s/%s nie podaje liczby %s z plany.js (%s)'
                                 % (jezyk, klucz, wartosc, pole))
    return bledy


def zbuduj():
    """Zwraca ({plik wzgledem showcase: tresc}, [bledy])."""
    teksty = json.loads((ZRODLO / 'teksty.json').read_text(encoding='utf-8'))
    zestaw_ikon = (ZRODLO / 'ikony.svg').read_text(encoding='utf-8')
    plany = czytaj_plany()
    bledy = sprawdz_teksty(teksty, plany)
    uzyte = set()
    pliki = {}
    for nazwa, sciezki in STRONY:
        szablon = wczytaj_szablon(nazwa)
        ikony = ikony_strony(szablon, zestaw_ikon)
        for jezyk in JEZYKI:
            tresc, b = renderuj(nazwa, szablon, sciezki, jezyk, teksty, uzyte, ikony)
            bledy.extend(b)
            pliki[sciezki[jezyk][0]] = tresc
    for k in sorted(set(teksty['pl']) - uzyte):
        bledy.append('teksty.json: tekst „%s" nie jest uzyty w zadnym szablonie' % k)
    pliki['robots.txt'] = robots()
    pliki['sitemap.xml'] = sitemap()
    return pliki, bledy


def main():
    sprawdz = '--sprawdz' in sys.argv[1:]
    try:
        pliki, bledy = zbuduj()
    except BladBudowy as e:
        print('BLAD: %s' % e)
        return 1
    nieaktualne = []
    for sciezka, tresc in sorted(pliki.items()):
        plik = SHOWCASE / sciezka
        stara = plik.read_text(encoding='utf-8') if plik.is_file() else None
        if stara == tresc:
            continue
        if sprawdz:
            nieaktualne.append(sciezka)
        elif not bledy:
            plik.parent.mkdir(parents=True, exist_ok=True)
            plik.write_text(tresc, encoding='utf-8')
            print('  zapisano  showcase/%s' % sciezka)
    for b in bledy:
        print('  BLAD  %s' % b)
    for s in nieaktualne:
        print('  BLAD  showcase/%s jest nieaktualny: uruchom python3 narzedzia/buduj_strone.py' % s)
    if bledy and not sprawdz:
        print('Nic nie zapisano, dopoki sa bledy.')
    if not bledy and not nieaktualne:
        print('  ok    %d plikow strony aktualnych, teksty PL i EN kompletne' % len(pliki))
    return 1 if (bledy or nieaktualne) else 0


if __name__ == '__main__':
    sys.exit(main())
