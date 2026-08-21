#!/usr/bin/env python3
"""
Content AI - kontrola, czy zrodlo nadal zawiera wszystkie poprawki F1-F17 i reskin.

Poprawki F1-F17 oraz warstwa reskinu sa juz wtopione w app/contentai.src.html. Nie ma ich
czym "nanosic" - sa czescia kodu. Ten skrypt pilnuje, zeby przypadkiem z niego nie wypadly:
buduje kazdy wariant i sprawdza, czy widac w nim slad po kazdej zmianie.

Kazda kontrola ma sygnature "jest" (fragment, ktory musi wystapic po poprawce) i czesto
sygnature "niema" (fragment sprzed poprawki, ktory nie moze wrocic). Dzieki temu wychodza
zarowno usuniecia, jak i cofniecia zmiany.

Uzycie:
    python3 sprawdz_zrodlo.py              # wszystkie warianty
    python3 sprawdz_zrodlo.py --wariant keys
    python3 sprawdz_zrodlo.py --cicho      # tylko podsumowanie i kod wyjscia

Kod wyjscia: 0 gdy wszystko na miejscu, 1 gdy czegos brakuje.
Pelny opis kazdej zmiany: INSTRUKCJA_naniesienia_zmian.md
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "pakowanie"))

try:
    from warianty import WARIANTY, BladZrodla, ZRODLO, zbuduj_wariant
except ImportError:
    sys.exit("BLAD: nie znaleziono pakowanie/warianty.py obok tego skryptu")


# (kod, opis, jest, niema, warianty)
#   jest    - musi wystapic w zbudowanym wariancie
#   niema   - nie moze wystapic (stan sprzed poprawki); None gdy nie dotyczy
#   warianty- None = wszystkie; inaczej krotka nazw
KONTROLE = [
    ("F1", "render historii przez _t(), bez sztywnego PL",
     "${history.length ? _t('history-no-filter') : _t('history-empty')}",
     "${history.length ? 'Brak wyników dla wybranego filtra.'", None),

    ("F2/PL", "klucz i18n history-no-filter (PL)",
     "'history-no-filter':'Brak wyników dla wybranego filtra.',", None, None),
    ("F2/EN", "klucz i18n history-no-filter (EN)",
     "'history-no-filter':'No results for the selected filter.',", None, None),

    ("F3", "wykrywanie jezyka przegladarki przy pierwszym starcie",
     "(navigator.language||'pl').toLowerCase().indexOf('pl')===0 ? 'pl' : 'en'",
     "var currentLang = localStorage.getItem('cai_lang') || 'pl';", None),

    ("F4/menu", "pozycja Klucze API w menu ustawien",
     'onclick="openKeysModal();closeSettingsMenu()"', None, ("keys",)),
    ("F4/modal", "modal Kluczy API",
     'id="keys-modal"', None, ("keys",)),
    ("F4/store", "klucze czytane z localStorage",
     "localStorage.getItem('cai_key_anthropic')", None, ("keys",)),
    ("F4/i18n", "klucze i18n panelu (PL i EN)",
     "'keys-modal-title':'Klucze API',", None, ("keys",)),
    ("F4/nokey", "komunikat braku klucza kieruje do panelu",
     "'nokey-line1':'Kliknij ikonę ustawień i wybierz Klucze API.'",
     "'nokey-line1':'Otwórz plik w edytorze tekstowym i znajdź linię:'", ("keys",)),
    ("F4/nokey", "komunikat braku klucza kieruje do edycji pliku",
     "'nokey-line1':'Otwórz plik w edytorze tekstowym i znajdź linię:'",
     None, ("owner", "proxy")),

    ("F5", "nazwa sekcji wnioskow w jezyku artykulu",
     "const kwName = ({ 'Polish':'Kluczowe wnioski','English':'Key takeaways'",
     '"Kluczowe wnioski" (or its equivalent in the article language)', None),

    ("F6", "prompt SERP: jezyk poza schematem JSON",
     "'Write the context, topics and phrases in ' + _serpLang + '.",
     "in the same language as keyword", None),

    ("F7/krok", "spinner pokazuje pierwszy krok natychmiast",
     "const iv = setInterval(_tickStep, 900);", None, None),
    ("F7/i18n", "komunikat premium przez _t(), nie zaszyty PL",
     "_t('msg-spin-premium-eval')",
     "'Premium: oceniam i poprawiam...'", None),

    ("F8/jezyk", "przerobki znaja jezyk tresci",
     "Write the ENTIRE output strictly in ${_rpLang}",
     "Napisz po polsku ", None),
    ("F8/zmienna", "zmienna _rpLang w przerobkach",
     "const _rpLang = ({ 'Polski':'Polish'", None, None),

    ("F9/jezyk", "auto-poprawka trzyma jezyk artykulu",
     "LANGUAGE: Write the improved article in ${langMap[lang] || 'Polish'}", None, None),
    ("F9/prefiks", "auto-poprawka bez mylacego prefiksu Premium",
     "(currentLang==='en'?'Improving (was ':'Poprawiam (było ')",
     "'Premium: ' + (currentLang==='en'?'improving (was ", None),

    ("F10", "brak reguly CSS psujacej panele oceny",
     None, ".seo-panel, .aio-panel { position: relative; }", None),

    ("F11", "uzupelnianie luk bez skoku na dol artykulu",
     "// status generowania sekcji tylko na gorze (przycisk)",
     "_genInd.scrollIntoView({ behavior: 'smooth', block: 'center' });", None),

    ("F12", "dropdown przerobek nad sidebarem i otwierany w prawo",
     "left:0;right:auto;background:var(--surface);border:1px solid var(--border);"
     "border-radius:var(--radius);box-shadow:var(--shadow);z-index:9000", None, None),

    ("F13", "panel Luk semantycznych scrolluje przy dlugiej liscie",
     "max-height:65vh;overflow-y:auto", None, None),

    ("F14", "przycisk generacji sekcji z kolkiem zamiast klepsydry",
     '<span class="progress-spinner" style="display:inline-block"></span>',
     "btn.textContent = _t('msg-spin-sections');", None),

    ("F16", "eksport PDF doklejа meta-box na samym koncu",
     "const _mbClone = _artClone.querySelector('.meta-box');", None, None),

    ("F17", "empty state jako SVG, nie znak Unicode",
     '<div class="placeholder-box"><svg viewBox="0 0 32 32"',
     '<div class="placeholder-box">✦</div>', None),

    # ── warstwa reskinu ──
    ("R/splash", "splash raz na sesje",
     'id="cin-splash"', None, None),
    ("R/splash-css", "style splasha",
     'id="cin-splash-css"', None, None),
    ("R/styl", "blok stylow reskinu",
     '<style id="cin-reskin">', None, None),
    ("R/postep", "paski postepu generowania",
     "cin-progress", None, None),
    ("R/panele", "pozycja paneli oceny tylko poza mobile",
     "body:not(.is-mobile)", None, None),

    # ── konfiguracja wariantow ──
    ("W/keys", "klucze z localStorage, deklaracje modyfikowalne",
     "let API_KEY = localStorage.getItem('cai_key_anthropic')", None, ("keys",)),
    ("W/owner", "tryb owner wylacza blokade urzadzenia",
     "const OWNER_MODE = true;", None, ("owner",)),
    ("W/proxy", "proxy kieruje ruch na workera",
     "window.API_ENDPOINT_OVERRIDE", None, ("proxy",)),
    # niema celuje w pelna deklaracje z komentarzem: sama nazwa placeholdera wystepuje
    # legalnie w komunikatach i18n, w porownaniach isDemo i w bloku <code> ekranu "brak klucza"
    ("W/proxy", "proxy nie trzyma kluczy w pliku",
     "const API_KEY = ''; // wersja proxy - klucz po stronie workera",
     "const API_KEY = 'WSTAW_TUTAJ_NOWY_KLUCZ_API'; //", ("proxy",)),

    # ── baza wiedzy na serwerze (tylko wariant proxy) ──
    ("B/menu", "pozycja Baza wiedzy w menu ustawien",
     'onclick="otworzBazeSerwera();closeSettingsMenu()"', None, ("proxy",)),
    ("B/prompt", "wiedza do promptu idzie z serwera, nie z calych dokumentow",
     "kbContext += await wiedzaZSerwera(", None, ("proxy",)),
    ("B/api", "okno bazy rozmawia z endpointem wyszukiwania",
     "fetch('/api/baza/szukaj'", None, ("proxy",)),

    # ── brama OpenSEO (tylko wariant proxy) ──
    # Adres i domene podstawia serwer przy serwowaniu strony; w repo maja zostac
    # placeholdery, inaczej kazdy klon niesie czyjas domene.
    ("O/menu", "pozycja OpenSEO w menu ustawien",
     'onclick="otworzOpenSeo();closeSettingsMenu()"', None, ("proxy",)),
    ("O/adres", "adres OpenSEO zostaje placeholderem",
     "var ADRES = 'WSTAW_TUTAJ_ADRES_OPENSEO';", None, ("proxy",)),
    ("O/domena", "domena ciasteczka zostaje placeholderem",
     "var DOMENA = 'WSTAW_TUTAJ_DOMENA_CIASTECZKA';", None, ("proxy",)),
    ("O/motyw", "wybor jasny/ciemny idzie do OpenSEO ciasteczkiem",
     "document.cookie = 'cai_motyw=' + (ciemny ? 'ciemny' : 'jasny')", None, ("proxy",)),

    # ── frazy z OpenSEO w formularzu (tylko wariant proxy) ──
    ("I/przycisk", "przycisk fraz OpenSEO przy polu slow kluczowych",
     'id="seo-frazy-btn"', None, ("proxy",)),
    ("I/czytanie", "okno czyta zapisane frazy z serwera",
     "'/api/seo/frazy?projekt='", None, ("proxy",)),
    ("I/oddawanie", "frazy artykulu wracaja do OpenSEO",
     "window.oddajFrazySeo", None, ("proxy",)),

    # ── samowystarczalnosc: zero zaleznosci od obcych serwerow ──
    ("Z/biblioteki", "biblioteki serwowane z wlasnego hosta",
     "pwa/lib/mammoth.browser.min.js", "cdnjs.cloudflare.com", None),
    ("Z/pdfmake", "pdfmake i jego fonty z wlasnego hosta",
     "pwa/lib/pdfmake.min.js", None, None),
    ("Z/fonty", "IBM Plex z wlasnego hosta, nie z Google Fonts",
     "pwa/fonty/ibm-plex-sans-latin-ext-400-normal.woff2", "fonts.googleapis.com", None),
    ("Z/sw", "aplikacja nie rejestruje nieistniejacego service workera",
     None, "navigator.serviceWorker.register", None),

    # ── usunieta pozorna blokada urzadzenia ──
    ("W/blokada", "brak blokady po odcisku przegladarki",
     None, "function checkFingerprint", None),
    ("W/blokada-okno", "brak okna nieautoryzowanego urzadzenia",
     None, 'id="fp-error-modal"', None),

    ("A/lang", "atrybut lang idzie za jezykiem interfejsu",
     "document.documentElement.lang = lang;", None, None),

    # ── Brief czerpie z OpenSEO (tylko wariant proxy) ──
    ("P/brief", "Brief pyta OpenSEO o sprawdzone frazy",
     "wzbogacBriefOSeo(b);", None, ("proxy",)),
    ("P/kolejnosc", "frazy renderowane w jednym miejscu, nie w dwoch kopiach",
     'return \'<div class="brief-section"><h4>\' + _t(\'brief-kw-section\') + \'</h4><div id="brief-kw-list"></div></div>\';',
     None, None),
]


# Deklaracje, ktore w gotowym wariancie moga wystapic dokladnie raz. Gdy zrodlo trafi
# do przegladarki bez przetworzenia, kazda z nich jest potrojona -> SyntaxError
# "Identifier ... has already been declared" wywala caly blok <script> i zabija UI.
DEKLARACJE = ("API_KEY", "OPENAI_API_KEY", "ELEVEN_API_KEY")


def sprawdz_deklaracje(html, wariant, cicho=False):
    """Kazda deklaracja klucza dokladnie raz - inaczej caly skrypt nie wykona sie."""
    bledy = []
    for nazwa in DEKLARACJE:
        ile = sum(
            1 for l in html.split("\n")
            if l.startswith(f"let {nazwa} =") or l.startswith(f"const {nazwa} =")
        )
        if ile == 1:
            if not cicho:
                print(f"    ok    {'D/' + nazwa:20} zadeklarowany dokladnie raz")
        else:
            powod = f"deklaracji: {ile} (ma byc 1)"
            bledy.append(("D/" + nazwa, f"{nazwa} zadeklarowany raz", powod))
            if not cicho:
                print(f"    BLAD  {'D/' + nazwa:20} {nazwa}: {powod}")
    return bledy


def sprawdz_warianty_w_repo(zrodlo, cicho=False):
    """Warianty lezace w app/ musza odpowiadac temu, co wychodzi ze zrodla."""
    bledy = []
    katalog = ZRODLO.parent
    for w in WARIANTY:
        plik = katalog / f"web-{w}.html"
        if not plik.exists():
            bledy.append((f"S/{w}", f"web-{w}.html obecny w app/", "pliku brak"))
            if not cicho:
                print(f"    BLAD  {'S/' + w:20} brak app/web-{w}.html")
            continue
        swiezy = zbuduj_wariant(zrodlo, w)
        if plik.read_text(encoding="utf-8") == swiezy:
            if not cicho:
                print(f"    ok    {'S/' + w:20} app/web-{w}.html zgodny ze zrodlem")
        else:
            bledy.append((f"S/{w}", f"web-{w}.html zgodny ze zrodlem",
                          "plik w repo rozjechal sie ze zrodlem - przebuduj warianty"))
            if not cicho:
                print(f"    BLAD  {'S/' + w:20} app/web-{w}.html rozjechal sie ze zrodlem")
    return bledy


def sprawdz(html, wariant, cicho=False):
    """Uruchamia kontrole dla jednego wariantu. Zwraca liczbe bledow."""
    bledy = []
    zrobione = 0

    for kod, opis, jest, niema, tylko in KONTROLE:
        if tylko and wariant not in tylko:
            continue
        zrobione += 1

        brak = jest is not None and jest not in html
        wrocilo = niema is not None and niema in html

        if brak or wrocilo:
            powod = "brak sladu poprawki" if brak else "wrocil stan sprzed poprawki"
            bledy.append((kod, opis, powod))
            if not cicho:
                print(f"    BLAD  {kod:12} {opis}")
                print(f"          -> {powod}")
        elif not cicho:
            print(f"    ok    {kod:12} {opis}")

    return zrobione, bledy


def main():
    p = argparse.ArgumentParser(description="Sprawdz, czy zrodlo zawiera poprawki F1-F17 i reskin")
    p.add_argument("--zrodlo", default=str(ZRODLO))
    p.add_argument("--wariant", choices=list(WARIANTY), help="tylko jeden wariant")
    p.add_argument("--cicho", action="store_true", help="tylko podsumowanie")
    args = p.parse_args()

    src = Path(args.zrodlo)
    if not src.exists():
        sys.exit(f"BLAD: nie znaleziono zrodla: {src}")
    zrodlo = src.read_text(encoding="utf-8")

    do_sprawdzenia = [args.wariant] if args.wariant else list(WARIANTY)
    wszystkie_bledy = []

    for w in do_sprawdzenia:
        try:
            html = zbuduj_wariant(zrodlo, w)
        except BladZrodla as e:
            sys.exit(f"BLAD: nie udalo sie zbudowac wariantu {w}: {e}")

        if not args.cicho:
            print(f"\n  wariant {w}")
        zrobione, bledy = sprawdz(html, w, args.cicho)
        bledy += sprawdz_deklaracje(html, w, args.cicho)
        zrobione += len(DEKLARACJE)
        wszystkie_bledy += [(w, *b) for b in bledy]
        if not args.cicho:
            print(f"    {zrobione} kontroli, bledow: {len(bledy)}")

    if not args.wariant:
        if not args.cicho:
            print("\n  warianty w repo")
        bledy = sprawdz_warianty_w_repo(zrodlo, args.cicho)
        wszystkie_bledy += [("repo", *b) for b in bledy]

    print()
    if wszystkie_bledy:
        print(f"NIEZGODNOSCI: {len(wszystkie_bledy)}")
        for w, kod, opis, powod in wszystkie_bledy:
            print(f"  {w:6} {kod:12} {opis}  ({powod})")
        print("\nOpis kazdej poprawki: INSTRUKCJA_naniesienia_zmian.md")
        return 1

    print(f"Wszystkie poprawki na miejscu ({', '.join(do_sprawdzenia)}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
