#!/usr/bin/env python3
"""
Content AI - wycina bloki <script> z wariantu do jednego pliku .js.

Po co: aplikacja to jeden plik HTML, wiec zadne standardowe narzedzie nie
przejrzy jej JavaScriptu. Ten skrypt wyciaga same skrypty, zachowujac numeracje
linii (puste linie w miejscu HTML-a), zeby numery zglaszane przez ESLinta
zgadzaly sie z plikiem wejsciowym.

Uzycie:
    python3 narzedzia/wytnij_skrypty.py app/web-proxy.html /tmp/app.js
"""

import re
import sys

if len(sys.argv) != 3:
    sys.exit("uzycie: wytnij_skrypty.py <plik.html> <wyjscie.js>")

html = open(sys.argv[1], encoding="utf-8").read()
kawalki = []
poz = 0

# Pomijamy <script src=...> - to biblioteki, nie nasz kod
for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S):
    kawalki.append("\n" * html[poz:m.start(1)].count("\n"))
    kawalki.append(m.group(1))
    poz = m.end(1)

wynik = "".join(kawalki)
open(sys.argv[2], "w", encoding="utf-8").write(wynik)
print(f"wyciete linii: {wynik.count(chr(10))}")
