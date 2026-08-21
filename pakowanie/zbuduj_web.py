#!/usr/bin/env python3
"""
Content AI - przygotowanie wspolnego payloadu web/ dla Electron i Capacitor.

Co robi:
- bierze wybrany wariant HTML i kopiuje go jako web/index.html (dzieki temu '/' serwuje aplikacje),
- kopiuje manifest.json oraz ikony (sciezki absolutne /manifest.json, /icons/... dzialaja, bo web/ jest korzeniem),
- NIE kopiuje sw.js (Service Worker jest zbedny w opakowaniu natywnym i powoduje problemy ze stalym cache; brak pliku = rejestracja po cichu nie powiedzie sie, co jest pozadane),
- dla wariantu PROXY podmienia adres workera (placeholder https://twoj-worker.workers.dev na podany --worker-url).

Uzycie:
  python3 zbuduj_web.py                          # wariant keys (klucze wpisywane w UI) - na spotkania
  python3 zbuduj_web.py --wariant proxy --worker-url https://moj-worker.example.workers.dev
  python3 zbuduj_web.py --wariant owner
  python3 zbuduj_web.py --app /sciezka/do/ContentAI_team.html --pwa /sciezka/do/pwa

Wynik: katalog web/ gotowy do uzycia przez electron/ i capacitor/.
"""

import argparse
import shutil
import sys
from pathlib import Path

import warianty
from warianty import BladZrodla, PLACEHOLDER_WORKER, WARIANTY, ZRODLO

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
APP = ROOT.parent / "app"   # kod aplikacji lezy obok pakowania, w contentai/app/


def main():
    p = argparse.ArgumentParser(description="Przygotuj web/ dla opakowania natywnego")
    p.add_argument("--wariant", choices=list(WARIANTY), default="keys",
                   help="ktory wariant zbudowac ze zrodla (domyslnie: keys - klucze wpisywane w UI)")
    p.add_argument("--zrodlo", default=str(ZRODLO),
                   help=f"jedno zrodlo aplikacji (domyslnie: {ZRODLO})")
    p.add_argument("--app", help="gotowy plik HTML zamiast budowania ze zrodla (pomija --wariant)")
    p.add_argument("--pwa", help="wlasna sciezka do katalogu pwa (manifest.json + icons/)")
    p.add_argument("--worker-url", help="bazowy adres Cloudflare Worker, np. https://moj-worker.example.workers.dev (tylko wariant proxy)")
    args = p.parse_args()

    app_src = Path(args.app).resolve() if args.app else Path(args.zrodlo).resolve()
    pwa_src = Path(args.pwa).resolve() if args.pwa else (APP / "pwa")

    if not app_src.exists():
        sys.exit(f"BLAD: nie znaleziono pliku HTML: {app_src}")
    if not (pwa_src / "manifest.json").exists():
        sys.exit(f"BLAD: nie znaleziono manifest.json w: {pwa_src}")
    if not (pwa_src / "icons").exists():
        sys.exit(f"BLAD: nie znaleziono katalogu icons/ w: {pwa_src}")

    # czysty start
    if WEB.exists():
        shutil.rmtree(WEB)
    (WEB / "icons").mkdir(parents=True)

    zrodlo_tekst = app_src.read_text(encoding="utf-8")

    if args.app:
        # gotowy plik: bierzemy jak lezy, podmieniamy tylko adres workera
        html = zrodlo_tekst
        opis = app_src.name
        if args.worker_url and PLACEHOLDER_WORKER in html:
            html = html.replace(PLACEHOLDER_WORKER, args.worker_url.rstrip("/"))
            print(f"Podmieniono adres workera na: {args.worker_url.rstrip('/')}")
    else:
        # jedno zrodlo -> wybrany wariant
        try:
            html = warianty.zbuduj_wariant(zrodlo_tekst, args.wariant, args.worker_url)
        except BladZrodla as e:
            sys.exit(f"BLAD: {e}")
        opis = f"{app_src.name} (wariant: {args.wariant})"
        if args.worker_url:
            print(f"Podmieniono adres workera na: {args.worker_url.rstrip('/')}")

    if PLACEHOLDER_WORKER in html:
        print("Uwaga: wariant proxy bez --worker-url. W web/index.html zostaje placeholder")
        print(f"       {PLACEHOLDER_WORKER} - aplikacja nie polaczy sie z API, dopoki go nie ustawisz.")

    (WEB / "index.html").write_text(html, encoding="utf-8")

    # manifest + ikony
    shutil.copy2(pwa_src / "manifest.json", WEB / "manifest.json")
    for icon in (pwa_src / "icons").iterdir():
        if icon.is_file():
            shutil.copy2(icon, WEB / "icons" / icon.name)

    # Biblioteki (mammoth, pdf.js, pdfmake, xlsx, html-docx-js). Aplikacja wola je
    # sciezka wzgledna pwa/lib/..., wiec w paczce musza lezec dokladnie tam - inaczej
    # w wersji desktopowej i mobilnej przestaje dzialac wczytywanie i eksport plikow.
    for katalog, rozszerzenie, czego in [("lib", ".js", "Biblioteki"), ("fonty", ".woff2", "Fonty")]:
        zrodlo = pwa_src / katalog
        if not zrodlo.exists():
            print(f"UWAGA: brak app/pwa/{katalog} - w paczce zabraknie tych plikow.")
            continue
        cel = WEB / "pwa" / katalog
        cel.mkdir(parents=True, exist_ok=True)
        ile = 0
        for plik in zrodlo.iterdir():
            if plik.is_file() and plik.suffix == rozszerzenie:
                shutil.copy2(plik, cel / plik.name)
                ile += 1
        print(f"{czego} skopiowane do web/pwa/{katalog}/: {ile}")

    print(f"Gotowe. Payload web/ zbudowany z: {opis}")
    print(f"  -> {WEB}")
    print("Service Worker celowo pominiety - aplikacja nie rejestruje sw.js.")


if __name__ == "__main__":
    main()
