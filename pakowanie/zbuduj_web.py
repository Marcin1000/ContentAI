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

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
APP = ROOT.parent / "app"   # kod aplikacji lezy obok pakowania, w contentai/app/

PLACEHOLDER_WORKER = "https://twoj-worker.workers.dev"

WARIANTY = {
    "keys":  APP / "web-keys.html",    # klucze wpisywane w UI aplikacji (panel "Klucze API"); na spotkania i pokazy
    "proxy": APP / "web-proxy.html",   # bez kluczy w pliku, ruch przez Cloudflare Worker (do szerszej dystrybucji)
    "owner": APP / "web-owner.html",   # klucze w pliku, bez blokady urzadzenia (tylko dla zaufanego, wewnetrznego uzytku)
}


def main():
    p = argparse.ArgumentParser(description="Przygotuj web/ dla opakowania natywnego")
    p.add_argument("--wariant", choices=list(WARIANTY.keys()), default="keys",
                   help="ktory wariant HTML opakowac (domyslnie: keys - klucze wpisywane w UI)")
    p.add_argument("--app", help="wlasna sciezka do pliku HTML (nadpisuje --wariant)")
    p.add_argument("--pwa", help="wlasna sciezka do katalogu pwa (manifest.json + icons/)")
    p.add_argument("--worker-url", help="bazowy adres Cloudflare Worker, np. https://moj-worker.example.workers.dev (tylko wariant proxy)")
    args = p.parse_args()

    app_src = Path(args.app).resolve() if args.app else WARIANTY[args.wariant]
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

    # index.html z wybranego wariantu
    html = app_src.read_text(encoding="utf-8")

    # podmiana adresu workera (dotyczy tylko wariantu proxy; w innych placeholder nie wystepuje)
    if args.worker_url:
        base = args.worker_url.rstrip("/")
        if PLACEHOLDER_WORKER in html:
            html = html.replace(PLACEHOLDER_WORKER, base)
            print(f"Podmieniono adres workera na: {base}")
        else:
            print("Uwaga: placeholder workera nie wystepuje w pliku (wariant inny niz proxy lub juz podmieniony).")
    else:
        if PLACEHOLDER_WORKER in html:
            print("Uwaga: wariant proxy bez --worker-url. W web/index.html zostaje placeholder")
            print("       https://twoj-worker.workers.dev - aplikacja nie polaczy sie z API, dopoki go nie ustawisz.")

    (WEB / "index.html").write_text(html, encoding="utf-8")

    # manifest + ikony
    shutil.copy2(pwa_src / "manifest.json", WEB / "manifest.json")
    for icon in (pwa_src / "icons").iterdir():
        if icon.is_file():
            shutil.copy2(icon, WEB / "icons" / icon.name)

    print(f"Gotowe. Payload web/ zbudowany z: {app_src.name}")
    print(f"  -> {WEB}")
    print("Service Worker celowo pominiety (sw.js nie jest kopiowany).")


if __name__ == "__main__":
    main()
