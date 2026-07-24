#!/usr/bin/env python3
"""
Content AI - budowanie wariantow aplikacji z jednego zrodla (app/contentai.src.html).

Zrodlo zawiera wszystkie warianty naraz, oznaczone dyrektywami warunkowymi.
Ten modul wycina z niego to, co nie nalezy do wybranego wariantu.

Warianty:
  keys   - klucze wpisywane w UI (panel "Klucze API", localStorage); domyslny, na pokazy
  proxy  - bez kluczy w pliku, ruch przez Cloudflare Worker
  owner  - klucze wpisane w pliku, bez blokady urzadzenia; tylko wewnetrznie

Dyrektywy (cala linia, wylacznie taka postac):

  w HTML:            w JS (wewnatrz <script>):
    <!--@@IF keys-->   //@@IF keys
    <!--@@ELSE-->      //@@ELSE
    <!--@@ENDIF-->     //@@ENDIF

  @@IF przyjmuje liste wariantow po przecinku, np. //@@IF owner,proxy
  Blok @@ELSE trafia do wariantow spoza tej listy. Zagniezdzanie nie jest obslugiwane
  (celowo - plaska struktura jest latwiejsza do zweryfikowania wzrokiem).

Uzycie jako modul:
    from warianty import zbuduj_wariant
    html = zbuduj_wariant(zrodlo_tekst, "proxy", worker_url="https://...")

Uzycie z linii polecen:
    python3 warianty.py --wariant proxy --worker-url https://moj.workers.dev -o web-proxy.html
    python3 warianty.py --wszystkie -o ../app
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ZRODLO = ROOT.parent / "app" / "contentai.src.html"

WARIANTY = ("keys", "proxy", "owner")

# Pseudo-wariant: blok @@IF zrodlo nie trafia do zadnego wariantu, bo nigdy nie budujemy
# "zrodla". Sluzy do rzeczy, ktore maja istniec wylacznie w pliku zrodlowym - np. ostrzezenie
# dla kogos, kto otworzy zrodlo w przegladarce zamiast zbudowanego wariantu.
ZRODLO_ONLY = "zrodlo"
ZNANE = WARIANTY + (ZRODLO_ONLY,)

PLACEHOLDER_WORKER = "https://twoj-worker.workers.dev"

# Cala linia musi byc dyrektywa; dopuszczamy wciecie i obie skladnie komentarza.
DYREKTYWA = re.compile(
    r"^[ \t]*(?://|<!--)@@(IF|ELSE|ENDIF)\b[ \t]*([A-Za-z0-9_,]*)[ \t]*(?:-->)?[ \t]*$"
)


class BladZrodla(Exception):
    """Zrodlo ma niepoprawna strukture dyrektyw."""


def przetworz(tekst, wariant):
    """Zwraca tekst zredukowany do jednego wariantu."""
    if wariant not in WARIANTY:
        raise BladZrodla(f"nieznany wariant: {wariant} (dostepne: {', '.join(WARIANTY)})")

    wynik = []
    # stan bloku: None poza blokiem, inaczej (nr_linii_IF, czy_gałąź_IF_aktywna, czy_jestesmy_w_ELSE)
    blok = None

    for nr, linia in enumerate(tekst.split("\n"), 1):
        m = DYREKTYWA.match(linia)
        if not m:
            if blok is None:
                wynik.append(linia)
            else:
                _, aktywna_if, w_else = blok
                if aktywna_if != w_else:  # aktywna gałąź IF, albo aktywna gałąź ELSE
                    wynik.append(linia)
            continue

        slowo, arg = m.group(1), m.group(2)

        if slowo == "IF":
            if blok is not None:
                raise BladZrodla(
                    f"linia {nr}: @@IF wewnatrz bloku otwartego w linii {blok[0]} "
                    "(zagniezdzanie nie jest obslugiwane)"
                )
            lista = [w for w in arg.split(",") if w]
            if not lista:
                raise BladZrodla(f"linia {nr}: @@IF bez wariantu")
            nieznane = [w for w in lista if w not in ZNANE]
            if nieznane:
                raise BladZrodla(f"linia {nr}: nieznany wariant w @@IF: {', '.join(nieznane)}")
            blok = (nr, wariant in lista, False)

        elif slowo == "ELSE":
            if blok is None:
                raise BladZrodla(f"linia {nr}: @@ELSE bez @@IF")
            if blok[2]:
                raise BladZrodla(f"linia {nr}: drugi @@ELSE w bloku z linii {blok[0]}")
            blok = (blok[0], blok[1], True)

        else:  # ENDIF
            if blok is None:
                raise BladZrodla(f"linia {nr}: @@ENDIF bez @@IF")
            blok = None

    if blok is not None:
        raise BladZrodla(f"blok @@IF z linii {blok[0]} nie zostal domkniety przez @@ENDIF")

    return "\n".join(wynik)


def zbuduj_wariant(zrodlo, wariant, worker_url=None):
    """Buduje wariant ze zrodla; dla proxy podmienia adres workera."""
    html = przetworz(zrodlo, wariant)

    if worker_url:
        if wariant != "proxy":
            raise BladZrodla("--worker-url ma sens tylko dla wariantu proxy")
        url = worker_url.rstrip("/")
        if PLACEHOLDER_WORKER not in html:
            raise BladZrodla(
                f"nie znaleziono placeholdera workera ({PLACEHOLDER_WORKER}) w wariancie proxy"
            )
        html = html.replace(PLACEHOLDER_WORKER, url)

    sprawdz_bilans(html, wariant)
    return html


def sprawdz_bilans(html, wariant):
    """Kontrola po zlozeniu: znaczniki musza sie domykac, dyrektywy - zniknac."""
    for otw, zam in (("<style", "</style>"), ("<script", "</script>")):
        a, b = html.count(otw), html.count(zam)
        if a != b:
            raise BladZrodla(f"wariant {wariant}: bilans {otw}> = {a}, {zam} = {b}")

    resztki = [
        nr for nr, l in enumerate(html.split("\n"), 1) if DYREKTYWA.match(l)
    ]
    if resztki:
        raise BladZrodla(
            f"wariant {wariant}: w wyniku zostaly dyrektywy w liniach {resztki[:5]}"
        )


def main():
    p = argparse.ArgumentParser(description="Zbuduj wariant(y) Content AI z jednego zrodla")
    p.add_argument("--zrodlo", default=str(ZRODLO), help=f"plik zrodlowy (domyslnie: {ZRODLO})")
    p.add_argument("--wariant", choices=list(WARIANTY), default="keys")
    p.add_argument("--wszystkie", action="store_true", help="zbuduj wszystkie trzy warianty")
    p.add_argument("--worker-url", help="adres Cloudflare Worker (tylko wariant proxy)")
    p.add_argument("-o", "--out", help="plik wynikowy, albo katalog gdy --wszystkie")
    args = p.parse_args()

    src = Path(args.zrodlo)
    if not src.exists():
        sys.exit(f"BLAD: nie znaleziono zrodla: {src}")
    zrodlo = src.read_text(encoding="utf-8")

    try:
        if args.wszystkie:
            katalog = Path(args.out) if args.out else (src.parent / "dist")
            katalog.mkdir(parents=True, exist_ok=True)
            for w in WARIANTY:
                html = zbuduj_wariant(zrodlo, w, args.worker_url if w == "proxy" else None)
                cel = katalog / f"web-{w}.html"
                cel.write_text(html, encoding="utf-8")
                print(f"  {cel}  ({len(html):,} B)".replace(",", " "))
        else:
            html = zbuduj_wariant(zrodlo, args.wariant, args.worker_url)
            if args.out:
                Path(args.out).write_text(html, encoding="utf-8")
                print(f"  {args.out}  ({len(html):,} B)".replace(",", " "))
            else:
                sys.stdout.write(html)
    except BladZrodla as e:
        sys.exit(f"BLAD: {e}")


if __name__ == "__main__":
    main()
