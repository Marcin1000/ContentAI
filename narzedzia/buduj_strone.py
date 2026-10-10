#!/usr/bin/env python3
"""Buduje strone produktowa content-ai.net z szablonow, jednego slownika PL/EN i jednego pliku ustawien.

Zrodla (showcase/zrodlo/):
  szablon.html       strona glowna (z cennikiem i FAQ)
  klucz-api.html     „Jak zdobyc klucz API" (koszt artykulu ze zrodlem i data)
  ai-act.html        „AI Act i przejrzystosc"
  prywatnosc.html    krotko o prywatnosci na tej stronie i odnosnik do pelnej polityki
  regulamin.html     wejscie na pelny regulamin
  czesci/*.html      wspolne kawalki (naglowek, stopka, lista dokumentow), wstawiane przez {{>nazwa}}
  teksty.json        {"pl": {klucz: tekst}, "en": {klucz: tekst}}
  konfiguracja.json  adresy aplikacji, rejestracji i dokumentow, e-mail kontaktowy, ceny, koszt artykulu,
                     data stanu, sposob liczenia audio i formaty z oznaczeniami AI (opis: serwer/README.md)
  ikony.svg          zestaw ikon (Lucide, ISC); na strone trafiaja tylko uzyte
Pelne dokumenty prawne (regulamin, polityka, odstapienie, DPA, podprzetwarzajacy, dane uslugodawcy) renderuje
serwer aplikacji pod /dokumenty/<nazwa> z szablonow dokumenty-prawne/ (dane uslugodawcy tylko w konfiguracji
serwera); ta strona tylko do nich linkuje i pokazuje ich wersje.

Wynik (showcase/): strony z listy STRONY (PL i EN), robots.txt, sitemap.xml.

Skladnia szablonu:
  {{t:klucz}}   tekst z wnetrzem HTML (np. <b>, <a class="link">)
  {{a:klucz}}   tekst do atrybutu: bez znacznikow, z ucieczka cudzyslowow
  {{$nazwa}}    wartosc wbudowana (lista w zmienne_jezyka() i renderuj()); dziala tez wewnatrz tekstow
                z teksty.json, np. {{$cena_standard}}, {{$klucz_api}}, {{$email}}
  {{v:sciezka}} adres zasobu z odciskiem tresci (?v=...), zeby przegladarka nie trzymala starej wersji
  {{>nazwa}}    wstawia czesci/nazwa.html
  {{?flaga}}...{{/flaga}}   fragment tylko przy wlaczonej fladze, {{?!flaga}}...{{/flaga}} tylko przy wylaczonej
                (flagi z konfiguracji: oznaczenia, przejsciowy, nagrania, ozn-<format>; patrz flagi())
  {{nr}}        kolejny numer sekcji na stronie (01, 02, ...), liczony po fragmentach {{?...}}
  {# ... #}     komentarz szablonu, nie trafia do wyniku
Warianty tekstow: klucz@wariant w teksty.json zastepuje klucz, gdy wariant jest wlaczony:
  @nagrania     audio_liczone = "nagrania" (serwer liczy jedno nagranie, a nie kazdy fragment)
  @przejsciowy  lista oznaczenia pusta (oznaczenia AI w plikach jeszcze nie wdrozone: bez slow
                „wspiera wymogi przejrzystosci" i bez opisu oznaczen)

Uzycie:
  python3 narzedzia/buduj_strone.py            # zapisuje pliki
  python3 narzedzia/buduj_strone.py --sprawdz  # kod 1, gdy pliki nieaktualne albo teksty niekompletne

--sprawdz zatrzymuje CI, gdy: wygenerowany plik rozni sie od zapisanego, klucz z szablonu nie ma tekstu w PL
albo w EN, tekst w slowniku nie jest nigdzie uzyty, slowniki maja rozne klucze, konfiguracja jest bledna, w wyniku
zostal znacznik szablonu, dlugi myslnik albo zakazane sformulowanie (ZAKAZANE), tytul albo opis strony sa za dlugie,
liczba znakow w przykladzie opisu meta nie zgadza sie z tekstem, liczby i funkcje pakietow w tekstach rozjechaly
sie z serwer/plany.js, albo wersje dokumentow prawnych PL i EN sa rozne.
"""
import datetime
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
DOKUMENTY_PRAWNE = KORZEN / 'dokumenty-prawne'
KONFIGURACJA = ZRODLO / 'konfiguracja.json'

DOMENA = 'https://content-ai.net'
JEZYKI = ('pl', 'en')

# szablon -> {jezyk: (plik wynikowy wzgledem showcase/, sciezka w adresie)}
# Jedno zrodlo listy stron: audyt_showcase.py i test_uklad_strony.js czytaja ja stad (STR8-17).
STRONY = [
    ('szablon.html', {'pl': ('index.html', '/'), 'en': ('en/index.html', '/en/')}),
    ('klucz-api.html', {'pl': ('klucz-api/index.html', '/klucz-api/'),
                        'en': ('en/api-key/index.html', '/en/api-key/')}),
    ('ai-act.html', {'pl': ('ai-act/index.html', '/ai-act/'), 'en': ('en/ai-act/index.html', '/en/ai-act/')}),
    ('prywatnosc.html', {'pl': ('prywatnosc/index.html', '/prywatnosc/'),
                         'en': ('en/privacy/index.html', '/en/privacy/')}),
    ('regulamin.html', {'pl': ('regulamin/index.html', '/regulamin/'), 'en': ('en/terms/index.html', '/en/terms/')}),
]
OG_LOCALE = {'pl': 'pl_PL', 'en': 'en_US'}

# Dokumenty, ktore renderuje serwer aplikacji (serwer/dokumenty-prawne.js, NAZWY); zmienne {{$dok_<nazwa>}}.
DOKUMENTY = ('regulamin', 'prywatnosc', 'odstapienie', 'dpa', 'podprzetwarzajacy', 'uslugodawca')

# Formaty, dla ktorych strona AI Act opisuje oznaczenia (konfiguracja "oznaczenia"). Wpisuje sie tylko te,
# ktore aplikacja naprawde oznacza (test_eksport.js); "etykiety" = widoczne etykiety przy eksporcie i publikacji.
FORMATY_OZNACZEN = ('docx', 'pdf', 'cms', 'jsonld', 'png', 'mp3', 'txt', 'etykiety')
WARIANTY = ('nagrania', 'przejsciowy')

# Liczby z serwer/plany.js, ktore musza stac w tekstach pakietow (w obu jezykach i w kazdym wariancie).
# Gdy ktos zmieni limit w plany.js, kontrola wskaze tekst do poprawienia - z poprawna odmiana,
# ktorej automat by nie zgadl („3 artykuly" / „5 artykulow").
LICZBY_PAKIETOW = {
    'hero-note': ['darmowy.artykul'],
    'end-p': ['darmowy.artykul'],
    'faq-2-a': ['darmowy.artykul'],
    'plan-free-1': ['darmowy.artykul'],
    'plan-free-2': ['darmowy.dokumenty'],
    'plan-std-1': ['standard.artykul'],
    'plan-std-2': ['standard.grafika', 'standard.audio', 'standard.transkrypcja'],
    'plan-std-3': ['standard.dokumenty'],
    'plan-tab-art-darmowy': ['darmowy.artykul'],
    'plan-tab-art-standard': ['standard.artykul'],
    'plan-tab-graf-standard': ['standard.grafika'],
    'plan-tab-audio-standard': ['standard.audio'],
    'plan-tab-trans-standard': ['standard.transkrypcja'],
    'plan-tab-dok-darmowy': ['darmowy.dokumenty'],
    'plan-tab-dok-standard': ['standard.dokumenty'],
}
# Teksty, ktore mowia „bez limitu" (w plany.js musi stac null) albo „nie" (w plany.js 0).
BEZ_LIMITU = {
    'plan-pro-1': ['premium.artykul', 'premium.grafika', 'premium.audio', 'premium.transkrypcja'],
    'plan-pro-2': ['premium.dokumenty'],
    'plan-tab-art-premium': ['premium.artykul'],
    'plan-tab-graf-premium': ['premium.grafika'],
    'plan-tab-audio-premium': ['premium.audio'],
    'plan-tab-trans-premium': ['premium.transkrypcja'],
    'plan-tab-dok-premium': ['premium.dokumenty'],
}
ZERO = {
    'plan-tab-graf-darmowy': ['darmowy.grafika'],
    'plan-tab-audio-darmowy': ['darmowy.audio'],
    'plan-tab-trans-darmowy': ['darmowy.transkrypcja'],
}
# Wiersze tabeli cennika z „tak"/„nie" (szablon.html) i funkcje z plany.js, ktore musza sie zgadzac.
FUNKCJE_W_TABELI = {
    'serp': {'darmowy': False, 'standard': True, 'premium': True},
    'cms': {'darmowy': False, 'standard': True, 'premium': True},
}

DLUGIE_MYSLNIKI = ('\u2014', '\u2013')
# Sformulowania, ktorych na stronie byc nie moze: nazwa dokumentu sprzedazy z VAT (PR8-11), AI Act tylko „wspiera wymogi
# przejrzystosci" (PR8-04), samoobsluga zamiast formularza (STR8-03), uslugi nieuzywane na produkcji
# (DECYZJE-R9, konfiguracja produkcji), funkcja wysylek z wdrozenia klienta (STR8-11), marki klientow.
ZAKAZANE = re.compile(
    r'faktur|invoice|w pe\u0142ni zgodn|pe\u0142n\w* zgodno\u015b\u0107|fully compliant|full compliance'
    r'|Popro\u015b o dost\u0119p|Request access|Konto zak\u0142ada administrator|administrator creates'
    r'|OpenSEO|DataForSEO|NVIDIA|rynk\w* eksportow|export market|\bDHL\b', re.I)
MAKS_TYTUL = 70
MAKS_OPIS = 160

ZNACZNIK = re.compile(r'\{\{([tav$>]):?([^}]*)\}\}')
ZMIENNA_W_TEKSCIE = re.compile(r'\{\{\$([\w-]+)\}\}')
WARUNEK = re.compile(r'\{\{\?(!?)([\w-]+)\}\}(.*?)\{\{/\2\}\}', re.S)
MIESIACE = {
    'pl': ('stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września',
           'października', 'listopada', 'grudnia'),
    'en': ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
           'November', 'December'),
}
NBSP = '\u00a0'


class BladBudowy(Exception):
    pass


def czytaj_plany():
    """Wyciaga z plany.js limity i funkcje pakietow bez uruchamiania Node."""
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
        funkcje = re.search(r'\bfunkcje:\s*\{(.*?)\}', blok, re.S)
        for pole in FUNKCJE_W_TABELI:
            mm = re.search(r'\b%s:\s*(true|false)' % pole, funkcje.group(1)) if funkcje else None
            wynik['%s.funkcje.%s' % (nazwa, pole)] = (mm.group(1) == 'true') if mm else None
    return wynik


# ─── konfiguracja ────────────────────────────────────────────────────────────

def czytaj_ceny(tekst):
    """„standard:eur=19,pln=79;premium:eur=49,pln=199" (ten sam zapis co PLATNOSCI_CENY_WYSWIETLANE serwera)."""
    ceny = {}
    for czesc in filter(None, (c.strip() for c in str(tekst).split(';'))):
        plan, _, kwoty = czesc.partition(':')
        ceny[plan.strip()] = {}
        for para in kwoty.split(','):
            waluta, _, kwota = para.partition('=')
            if not re.fullmatch(r'\d{1,4}(\.\d{2})?', kwota.strip()):
                raise BladBudowy('konfiguracja.json: zla kwota „%s" w cenach (%s)' % (kwota, czesc))
            ceny[plan.strip()][waluta.strip().lower()] = kwota.strip()
    for plan in ('standard', 'premium'):
        for waluta in ('eur', 'pln'):
            if waluta not in ceny.get(plan, {}):
                raise BladBudowy('konfiguracja.json: brak ceny %s w %s (ceny: „%s")' % (plan, waluta.upper(), tekst))
    return ceny


def adres_https(nazwa, wartosc, ukosnik=None):
    if not isinstance(wartosc, str) or not re.fullmatch(r'https://[a-z0-9.-]+\.[a-z]{2,}(/[A-Za-z0-9._~/-]*)?', wartosc):
        raise BladBudowy('konfiguracja.json: „%s" musi byc adresem https:// bez zapytania (jest: %r)' % (nazwa, wartosc))
    if ukosnik is True and not wartosc.endswith('/'):
        raise BladBudowy('konfiguracja.json: „%s" musi konczyc sie ukosnikiem' % nazwa)
    if ukosnik is False and wartosc.endswith('/'):
        raise BladBudowy('konfiguracja.json: „%s" nie moze konczyc sie ukosnikiem' % nazwa)
    return wartosc


def wczytaj_konfiguracje(plik=KONFIGURACJA):
    try:
        k = json.loads(plik.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        raise BladBudowy('nie da sie odczytac %s: %s' % (plik.relative_to(KORZEN), e))
    znane = {'aplikacja', 'rejestracja', 'dokumenty', 'email_kontakt', 'ceny', 'koszt_artykulu', 'data_stanu',
             'audio_liczone', 'oznaczenia'}
    nieznane = sorted(p for p in k if p not in znane and not p.startswith('_'))
    if nieznane:
        raise BladBudowy('konfiguracja.json: nieznane pola %s' % ', '.join(nieznane))
    brak = sorted(znane - set(k))
    if brak:
        raise BladBudowy('konfiguracja.json: brak pol %s' % ', '.join(brak))
    konf = {
        'aplikacja': adres_https('aplikacja', k['aplikacja'], ukosnik=True),
        'rejestracja': adres_https('rejestracja', k['rejestracja'], ukosnik=False),
        'dokumenty': adres_https('dokumenty', k['dokumenty'], ukosnik=True),
        'ceny': czytaj_ceny(k['ceny']),
    }
    email = k['email_kontakt']
    if not isinstance(email, str) or not re.fullmatch(r'[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+', email):
        raise BladBudowy('konfiguracja.json: email_kontakt to nie jest adres e-mail (%r)' % email)
    konf['email'] = email
    koszt = k['koszt_artykulu']
    if not isinstance(koszt, dict) or any(not isinstance(koszt.get(j), str) or not koszt.get(j).strip()
                                          or re.search(r'[<>"&\u2013\u2014]', koszt.get(j)) for j in JEZYKI):
        raise BladBudowy('konfiguracja.json: koszt_artykulu musi miec tekst „pl" i „en" (bez <, >, ", & i dlugich myslnikow)')
    konf['koszt'] = {j: koszt[j].strip() for j in JEZYKI}
    try:
        konf['data_stanu'] = datetime.date.fromisoformat(k['data_stanu'])
    except (TypeError, ValueError):
        raise BladBudowy('konfiguracja.json: data_stanu w formacie RRRR-MM-DD (jest: %r)' % k['data_stanu'])
    if k['audio_liczone'] not in ('fragmenty', 'nagrania'):
        raise BladBudowy('konfiguracja.json: audio_liczone to „fragmenty" albo „nagrania" (jest: %r)' % k['audio_liczone'])
    konf['audio'] = k['audio_liczone']
    ozn = k['oznaczenia']
    if not isinstance(ozn, list) or any(f not in FORMATY_OZNACZEN for f in ozn):
        raise BladBudowy('konfiguracja.json: oznaczenia to lista z %s (jest: %r)' % (', '.join(FORMATY_OZNACZEN), ozn))
    konf['oznaczenia'] = list(ozn)
    return konf


def flagi(konf):
    f = {
        'oznaczenia': bool(konf['oznaczenia']),
        'przejsciowy': not konf['oznaczenia'],
        'nagrania': konf['audio'] == 'nagrania',
    }
    for format_ in FORMATY_OZNACZEN:
        f['ozn-' + format_] = format_ in konf['oznaczenia']
    return f


def warianty(konf):
    w = set()
    if konf['audio'] == 'nagrania':
        w.add('nagrania')
    if not konf['oznaczenia']:
        w.add('przejsciowy')
    return w


# ─── dokumenty prawne: wersje z naglowkow szablonow ──────────────────────────

def wersje_dokumentow():
    """{nazwa: {jezyk: (wersja, data)}} z naglowkow dokumenty-prawne/<nazwa>.<jezyk>.md."""
    wynik = {}
    for nazwa in DOKUMENTY:
        wynik[nazwa] = {}
        for jezyk in JEZYKI:
            plik = DOKUMENTY_PRAWNE / ('%s.%s.md' % (nazwa, jezyk))
            if not plik.is_file():
                raise BladBudowy('brak szablonu dokumentu %s' % plik.relative_to(KORZEN))
            m = re.match(r'---\n(.*?)\n---\n', plik.read_text(encoding='utf-8'), re.S)
            pola = dict(re.findall(r'^(\w+):\s*(.*?)\s*$', m.group(1), re.M)) if m else {}
            if not pola.get('wersja') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', pola.get('data', '')):
                raise BladBudowy('%s: naglowek bez pola wersja albo data (RRRR-MM-DD)' % plik.relative_to(KORZEN))
            wynik[nazwa][jezyk] = (pola['wersja'], datetime.date.fromisoformat(pola['data']))
    return wynik


# ─── formatowanie ────────────────────────────────────────────────────────────

def data_slownie(data, jezyk):
    if jezyk == 'pl':
        return '%d%s%s %d' % (data.day, NBSP, MIESIACE['pl'][data.month - 1], data.year)
    return '%d %s %d' % (data.day, MIESIACE['en'][data.month - 1], data.year)


def kwota(wartosc, waluta, jezyk):
    """PL: „79 zl", „19 EUR"; EN: „€19", „PLN 79" (z twarda spacja)."""
    if jezyk == 'pl':
        liczba = wartosc.replace('.', ',')
        return liczba + NBSP + ('zł' if waluta == 'pln' else 'EUR')
    return ('€' + wartosc) if waluta == 'eur' else ('PLN' + NBSP + wartosc)


def twarde_pl(tekst):
    """Twarda spacja po liczbach i jednoliterowych slowach (jak w teksty.json), dla wartosci z konfiguracji."""
    return re.sub(r'(?<![\w\u00c0-\u017f])([aiouwzAIOUWZ]|\d[\d,.\-]*) (?=\S)', lambda m: m.group(1) + NBSP, tekst)


def bez_znacznikow(tekst):
    return re.sub(r'<[^>]+>', '', tekst)


def do_atrybutu(tekst):
    return html.escape(html.unescape(bez_znacznikow(tekst)), quote=True)


def czysty_tekst(tekst):
    return html.unescape(bez_znacznikow(tekst))


def odcisk(sciezka):
    plik = SHOWCASE / sciezka
    if not plik.is_file():
        raise BladBudowy('brak zasobu %s' % sciezka)
    return hashlib.sha256(plik.read_bytes()).hexdigest()[:10]


# ─── szablony ────────────────────────────────────────────────────────────────

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


def rozwin_warunki(tekst, wlaczone, nazwa_szablonu, bledy):
    """{{?flaga}}...{{/flaga}} i {{?!flaga}}...{{/flaga}}; zagniezdzenia z roznymi nazwami flag."""
    def podmien(m):
        neg, flaga, srodek = m.group(1), m.group(2), m.group(3)
        if flaga not in wlaczone:
            bledy.append('%s: nieznana flaga {{?%s}}' % (nazwa_szablonu, flaga))
            return ''
        return srodek if bool(wlaczone[flaga]) != bool(neg) else ''
    for _ in range(10):
        nowy = WARUNEK.sub(podmien, tekst)
        if nowy == tekst:
            break
        tekst = nowy
    return tekst


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


def sciezki_stron():
    return {nazwa: sciezki for nazwa, sciezki in STRONY}


def zmienne_jezyka(jezyk, konf, wersje):
    """Wartosci {{$...}} wspolne dla wszystkich stron jednego jezyka (takze wewnatrz tekstow)."""
    strony = sciezki_stron()
    en = jezyk == 'en'

    def sciezka(nazwa):
        return strony[nazwa][jezyk][1]
    rej = konf['rejestracja']
    z = {
        'glowna': sciezka('szablon.html'),
        'prywatnosc': sciezka('prywatnosc.html'),
        'regulamin': sciezka('regulamin.html'),
        'klucz_api': sciezka('klucz-api.html'),
        'ai_act': sciezka('ai-act.html'),
        'cennik': sciezka('szablon.html') + '#cennik',
        'bezpieczenstwo': sciezka('szablon.html') + '#bezpieczenstwo',
        'app': konf['aplikacja'] + ('?lang=en' if en else ''),
        'rejestracja': rej + ('?lang=en' if en else ''),
        'rejestracja_standard': rej + '?pakiet=standard' + ('&amp;lang=en' if en else ''),
        'rejestracja_premium': rej + '?pakiet=premium' + ('&amp;lang=en' if en else ''),
        'email': konf['email'],
        # zakres kosztu w jednym wierszu („0,25-0,50 USD" nie lamie sie na lacznik)
        'koszt_artykulu': '<span class="nw">%s</span>' % html.escape(
            twarde_pl(konf['koszt']['pl']) if jezyk == 'pl' else konf['koszt']['en']),
        'data_stanu': data_slownie(konf['data_stanu'], jezyk),
    }
    for nazwa in DOKUMENTY:
        z['dok_' + nazwa] = '%s%s?lang=%s' % (konf['dokumenty'], nazwa, jezyk)
    for nazwa, klucz in (('regulamin', 'regulaminu'), ('prywatnosc', 'polityki')):
        wersja, data = wersje[nazwa][jezyk]
        z['wersja_' + klucz] = html.escape(wersja)
        z['data_' + klucz] = data_slownie(data, jezyk)
    glowna_waluta = 'pln' if jezyk == 'pl' else 'eur'
    for plan in ('standard', 'premium'):
        ceny = konf['ceny'][plan]
        z['cena_' + plan] = kwota(ceny[glowna_waluta], glowna_waluta, jezyk)
        for waluta in ('eur', 'pln'):
            z['cena_%s_%s' % (plan, waluta)] = kwota(ceny[waluta], waluta, jezyk)
    return z


class Teksty:
    """Teksty jednego jezyka: wariant klucza (klucz@wariant) i podstawienie {{$...}} wewnatrz tekstu."""

    def __init__(self, slownik, wlaczone_warianty, zmienne):
        self.t = slownik
        self.warianty = sorted(wlaczone_warianty)
        self.zmienne = zmienne

    def surowy(self, klucz):
        for w in self.warianty:
            if '%s@%s' % (klucz, w) in self.t:
                return self.t['%s@%s' % (klucz, w)]
        return self.t.get(klucz, '')

    def __call__(self, klucz):
        return ZMIENNA_W_TEKSCIE.sub(lambda m: self.zmienne.get(m.group(1), m.group(0)), self.surowy(klucz))


def jsonld(tk, jezyk, url, zm, konf):
    """Dane strukturalne z tych samych tekstow, ktore widac na stronie (FAQ = widoczne FAQ, ceny = cennik)."""
    faq = []
    n = 1
    while 'faq-%d-q' % n in tk.t:
        faq.append({'@type': 'Question', 'name': czysty_tekst(tk('faq-%d-q' % n)),
                    'acceptedAnswer': {'@type': 'Answer', 'text': czysty_tekst(tk('faq-%d-a' % n))}})
        n += 1
    waluta = 'pln' if jezyk == 'pl' else 'eur'
    adres_cennika = DOMENA + zm['cennik']
    oferty = [{'@type': 'Offer', 'name': czysty_tekst(tk('plan-free-name')), 'price': '0',
               'priceCurrency': waluta.upper(), 'url': adres_cennika}]
    for plan, klucz in (('standard', 'plan-std-name'), ('premium', 'plan-pro-name')):
        cena = konf['ceny'][plan][waluta]
        oferty.append({'@type': 'Offer', 'name': czysty_tekst(tk(klucz)), 'price': cena,
                       'priceCurrency': waluta.upper(), 'url': adres_cennika,
                       'priceSpecification': {'@type': 'UnitPriceSpecification', 'price': cena,
                                              'priceCurrency': waluta.upper(), 'billingDuration': 'P1M',
                                              'unitCode': 'MON'}})
    graf = {
        '@context': 'https://schema.org',
        '@graph': [
            {'@type': 'Organization', '@id': DOMENA + '/#organizacja', 'name': 'Content AI',
             'alternateName': 'content-ai.net', 'url': DOMENA + '/', 'logo': DOMENA + '/obrazy/icon-512.png',
             'email': konf['email']},
            {'@type': 'SoftwareApplication', '@id': DOMENA + '/#aplikacja', 'name': 'Content AI',
             'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Web',
             'url': url, 'inLanguage': jezyk, 'description': czysty_tekst(tk('meta-desc')),
             'publisher': {'@id': DOMENA + '/#organizacja'}, 'offers': oferty},
            {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': jezyk, 'mainEntity': faq},
        ],
    }
    tekst = json.dumps(graf, ensure_ascii=False, indent=1)
    # „</" w JSON-LD zamknalby znacznik <script> przedwczesnie
    return tekst.replace('</', '<\\/')


def renderuj(nazwa_szablonu, szablon, sciezki, jezyk, teksty, konf, wspolne, ikony):
    alt = 'en' if jezyk == 'pl' else 'pl'
    zmienne = dict(wspolne)
    zmienne.update({
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
        'og_locale': OG_LOCALE[jezyk],
        'og_locale_alt': OG_LOCALE[alt],
        'og_obraz': DOMENA + '/obrazy/og-%s.png' % jezyk,
        'ikony': ikony,
    })
    tk = Teksty(teksty[jezyk], warianty(konf), zmienne)
    bledy = []

    def podmien(m):
        rodzaj, nazwa = m.group(1), m.group(2).strip()
        if rodzaj == '$':
            if nazwa == 'jsonld':
                return jsonld(tk, jezyk, zmienne['url'], zmienne, konf)
            if nazwa not in zmienne:
                bledy.append('%s: nieznana zmienna {{$%s}}' % (nazwa_szablonu, nazwa))
                return ''
            return zmienne[nazwa]
        if rodzaj == 'v':
            return '/%s?v=%s' % (nazwa, odcisk(nazwa))
        # brak tekstu zglasza zbuduj() (przeglada tez fragmenty wylaczone flagami) i sprawdz_teksty()
        tekst = tk(nazwa)
        return tekst if rodzaj == 't' else do_atrybutu(tekst)

    wynik = rozwin_warunki(szablon, flagi(konf), nazwa_szablonu, bledy)
    numery = iter(range(1, 100))
    wynik = re.sub(r'\{\{nr\}\}', lambda m: '%02d' % next(numery), wynik)
    wynik = ZNACZNIK.sub(podmien, wynik)
    # puste linie po komentarzach szablonu i po znacznikach {{?...}}: najwyzej jedna z rzedu
    wynik = re.sub(r'\n[ \t]+(?=\n)', '\n', wynik)
    wynik = re.sub(r'\n{3,}', '\n\n', wynik)
    bledy.extend(sprawdz_wynik(nazwa_szablonu, jezyk, wynik))
    return wynik, bledy


def sprawdz_wynik(nazwa_szablonu, jezyk, wynik):
    bledy = []
    gdzie = '%s (%s)' % (nazwa_szablonu, jezyk)
    if '{{' in wynik or '}}' in wynik:
        bledy.append('%s: w wyniku zostal znacznik szablonu' % gdzie)
    for znak in DLUGIE_MYSLNIKI:
        if znak in wynik:
            bledy.append('%s: dlugi myslnik U+%04X w wyniku' % (gdzie, ord(znak)))
    for m in ZAKAZANE.finditer(html.unescape(wynik)):
        bledy.append('%s: zakazane sformulowanie „%s"' % (gdzie, m.group(0)))
    tytul = re.search(r'<title>(.*?)</title>', wynik, re.S)
    opis = re.search(r'<meta name="description" content="([^"]*)"', wynik)
    if not tytul or not opis:
        bledy.append('%s: brak <title> albo opisu strony' % gdzie)
    else:
        if len(html.unescape(tytul.group(1))) > MAKS_TYTUL:
            bledy.append('%s: tytul ma %d znakow (najwyzej %d)' % (gdzie, len(html.unescape(tytul.group(1))), MAKS_TYTUL))
        if len(html.unescape(opis.group(1))) > MAKS_OPIS:
            bledy.append('%s: opis ma %d znakow (najwyzej %d)' % (gdzie, len(html.unescape(opis.group(1))), MAKS_OPIS))
    return bledy


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


def warianty_klucza(slownik, klucz):
    return [k for k in slownik if k == klucz or k.startswith(klucz + '@')]


def sprawdz_teksty(teksty, plany, znane_zmienne):
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
            if not v.strip():
                bledy.append('teksty.json: pusty tekst %s/%s' % (jezyk, k))
            if '@' in k:
                baza, _, wariant = k.partition('@')
                if wariant not in WARIANTY:
                    bledy.append('teksty.json: nieznany wariant „@%s" w %s/%s' % (wariant, jezyk, k))
                if baza not in teksty[jezyk]:
                    bledy.append('teksty.json: wariant %s/%s bez tekstu podstawowego „%s"' % (jezyk, k, baza))
            for m in ZMIENNA_W_TEKSCIE.finditer(v):
                if m.group(1) not in znane_zmienne:
                    bledy.append('teksty.json: nieznana zmienna {{$%s}} w %s/%s' % (m.group(1), jezyk, k))

    def tekst(jezyk, klucz):
        return czysty_tekst(teksty[jezyk].get(klucz, '')).replace(NBSP, ' ')

    for klucz, pola in LICZBY_PAKIETOW.items():
        for pole in pola:
            wartosc = plany.get(pole)
            if wartosc in (None, 'null'):
                bledy.append('plany.js: %s nie jest liczba, a tekst %s ja podaje' % (pole, klucz))
                continue
            for jezyk in JEZYKI:
                for k in warianty_klucza(teksty[jezyk], klucz) or [klucz]:
                    if not re.search(r'(?<![\d,.])%s(?![\d,.]\d)' % re.escape(wartosc), tekst(jezyk, k)):
                        bledy.append('teksty.json: %s/%s nie podaje liczby %s z plany.js (%s)'
                                     % (jezyk, k, wartosc, pole))
    for klucz, pola in BEZ_LIMITU.items():
        for pole in pola:
            if plany.get(pole) != 'null':
                bledy.append('plany.js: %s = %s, a tekst %s mowi „bez limitu"' % (pole, plany.get(pole), klucz))
    for klucz, pola in ZERO.items():
        for pole in pola:
            if plany.get(pole) != '0':
                bledy.append('plany.js: %s = %s, a tekst %s mowi „nie"' % (pole, plany.get(pole), klucz))
    for funkcja, pakiety in FUNKCJE_W_TABELI.items():
        for pakiet, oczekiwane in pakiety.items():
            if plany.get('%s.funkcje.%s' % (pakiet, funkcja)) is not oczekiwane:
                bledy.append('plany.js: funkcje.%s w pakiecie %s to nie %s, jak w tabeli cennika (szablon.html)'
                             % (funkcja, pakiet, 'true' if oczekiwane else 'false'))
    # STR8-13: liczba znakow przykladowego opisu meta ma byc prawdziwa
    for jezyk in JEZYKI:
        for k in warianty_klucza(teksty[jezyk], 'surf-art-meta2'):
            v = teksty[jezyk][k]
            opis = re.search(r'<span class="z"[^>]*>(.*?)</span>', v)
            liczba = re.search(r'<span class="mono">\D*(\d+)', v)
            if not opis or not liczba:
                bledy.append('teksty.json: %s/%s bez opisu albo liczby znakow' % (jezyk, k))
            elif len(czysty_tekst(opis.group(1))) != int(liczba.group(1)):
                bledy.append('teksty.json: %s/%s podaje %s znakow, a opis ma %d'
                             % (jezyk, k, liczba.group(1), len(czysty_tekst(opis.group(1)))))
    return bledy


def klucze_szablonu(szablon):
    return {m.group(2).strip() for m in ZNACZNIK.finditer(szablon) if m.group(1) in 'ta'}


def zbuduj(plik_konfiguracji=KONFIGURACJA):
    """Zwraca ({plik wzgledem showcase: tresc}, [bledy], [informacje])."""
    teksty = json.loads((ZRODLO / 'teksty.json').read_text(encoding='utf-8'))
    zestaw_ikon = (ZRODLO / 'ikony.svg').read_text(encoding='utf-8')
    konf = wczytaj_konfiguracje(plik_konfiguracji)
    wersje = wersje_dokumentow()
    plany = czytaj_plany()
    bledy = []
    info = []
    for nazwa, jezyki in wersje.items():
        if jezyki['pl'] != jezyki['en']:
            bledy.append('dokumenty-prawne/%s: wersja albo data PL (%s, %s) rozna od EN (%s, %s)'
                         % (nazwa, jezyki['pl'][0], jezyki['pl'][1], jezyki['en'][0], jezyki['en'][1]))
    wspolne = {j: zmienne_jezyka(j, konf, wersje) for j in JEZYKI}
    znane_zmienne = set(wspolne['pl'])
    bledy.extend(sprawdz_teksty(teksty, plany, znane_zmienne))
    uzyte = set()
    pliki = {}
    for nazwa, sciezki in STRONY:
        szablon = wczytaj_szablon(nazwa)
        klucze = klucze_szablonu(szablon)
        uzyte |= klucze
        for k in sorted(klucze):
            for jezyk in JEZYKI:
                if k not in teksty[jezyk] or not teksty[jezyk][k].strip():
                    bledy.append('%s: klucz „%s" bez tekstu w %s' % (nazwa, k, jezyk.upper()))
        ikony = ikony_strony(szablon, zestaw_ikon)
        for jezyk in JEZYKI:
            tresc, b = renderuj(nazwa, szablon, sciezki, jezyk, teksty, konf, wspolne[jezyk], ikony)
            bledy.extend(b)
            pliki[sciezki[jezyk][0]] = tresc
    for k in sorted(set(teksty['pl'])):
        if k.partition('@')[0] not in uzyte:
            bledy.append('teksty.json: tekst „%s" nie jest uzyty w zadnym szablonie' % k)
    pliki['robots.txt'] = robots()
    pliki['sitemap.xml'] = sitemap()
    if not konf['oznaczenia']:
        info.append('oznaczenia AI: lista w konfiguracja.json pusta, wiec strona AI Act i FAQ sa w wariancie '
                    'przejsciowym (bez „wspiera wymogi przejrzystosci" i bez opisu oznaczen w plikach)')
    if konf['audio'] == 'fragmenty':
        info.append('audio: cennik opisuje fragmenty audio (audio_liczone = "fragmenty")')
    return pliki, bledy, info


def main():
    sprawdz = '--sprawdz' in sys.argv[1:]
    try:
        pliki, bledy, info = zbuduj()
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
    for i in info:
        print('  info  %s' % i)
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
