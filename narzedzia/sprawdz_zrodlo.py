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
import re
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
    ("F4/store", "klucze czytane z magazynu przegladarki",
     "magazyn.getItem('cai_key_anthropic')", None, ("keys",)),
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
     "  _tickStep();\n  const startGenerowania = Date.now();", None, None),
    ("G/przerwij", "generowanie mozna przerwac (wspolny sygnal w apiFetch)",
     "const sygnal = options.signal || (przerwanieGenerowania && przerwanieGenerowania.signal) || null;", None, None),
    ("G/postep", "licznik nie udaje etapow po rozpoczeciu pisania",
     "if (step < Math.min(3, activeSteps.length)) {", None, None),
    ("G/szkic", "formularz i ostatni artykul wracaja po odswiezeniu",
     "magazyn.setItem('cai_szkic', JSON.stringify(szkic));", None, None),
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

    # Przerobki nie maja juz wlasnego dropdownu - sa pozycjami w menu "Tworz".
    # Gwarancje z F12 (nad sidebarem, otwierany tak, zeby nie wyjsc poza ekran)
    # przenosza sie na wspolne menu grup.
    ("F12/kierunek", "menu grup otwiera sie w lewo, nie poza ekran",
     "position:absolute;top:calc(100% + 4px);right:0;left:auto;background:var(--surface);",
     None, None),
    ("F12/warstwa", "menu grup nad sidebarem",
     "box-shadow:var(--shadow);\n  z-index:9000;min-width:210px;", None, None),
    ("F12/bezmenu", "przerobki bez wlasnego dropdownu",
     None, '<div class="repurpose-wrap" id="repurpose-wrap"', None),

    # Model potrafi wstawic w tekst niezaslonięty cudzyslow (cytujac nazwe
    # z bazy wiedzy) - goly JSON.parse wywalal sie wtedy surowym komunikatem
    # parsera na ekranie uzytkownika. Kazde nowe miejsce czytajace JSON
    # z modelu ma isc przez parsujJsonModelu.
    ("F18/naprawa", "odporny odczyt JSON-a z modelu",
     "function parsujJsonModelu(", None, None),
    ("F18/bezgolego", "zaden odczyt nie idzie golym JSON.parse",
     None, "JSON.parse(raw)", None),

    # Model nie zna dzisiejszej daty i w tytulach wpisywal rok, ktory pamieta
    # z treningu ("w 2025 roku" w propozycjach wystawionych w 2026). Date musi
    # dostac z przegladarki przy kazdym wywolaniu.
    ("F19/blok", "prompty dostaja biezaca date",
     "function blokDaty() {", None, None),
    ("F19/zegar", "data z zegara, nie ze stalej w kodzie",
     "var rok = teraz.getFullYear();", None, None),

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

    # ── poprawki po audycie agencji SEO (wrzesien 2026) ──
    # Agencja testowala aplikacje na artykule o wysylce paczek i przyslala
    # liste tego, co nie dziala. Kazda pozycja ponizej pilnuje jednej uwagi.
    # Para "jest"/"niema" lapie zarowno skasowanie poprawki, jak i cofniecie
    # kodu do stanu sprzed niej.

    # "Nie dziala dodawanie linkow do bazy wiedzy - za kazdym razem fiasko".
    # Aplikacja kazala modelowi "odwiedzic adres" przez wyszukiwarke, ktora
    # nie pobiera stron. Teraz jest narzedzie do pobierania.
    ("F20/pobieranie", "strona pobierana narzedziem web_fetch, nie wyszukiwarka",
     "type: 'web_fetch_20250910'",
     "Visit this URL and extract ALL text content from the page", None),
    ("F20/zwyniku", "tekst czytany z bloku wyniku, nie z prozy modelu",
     "block.type !== 'web_fetch_tool_result'", None, None),
    ("F20/serwer", "wariant proxy pyta najpierw wlasny serwer",
     "await fetch('/api/strona', {", None, ("proxy",)),

    # "Narzedzie wymysla dane, jak czegos nie znajdzie w materiale zrodlowym".
    # Prompt wymagal liczby w pierwszym akapicie, w kazdym akapicie i w kazdym
    # punkcie podsumowania - model dopisywal je, zeby spelnic warunek.
    ("F21/fakty", "blok o pokryciu liczb w zrodlach",
     "function blokFaktow(uzupelnia) {", "function blokFaktow() {", None),
    ("F21/bezprzymusu", "pierwszy akapit nie musi zawierac liczby",
     None, "The first paragraph MUST include a key number", None),
    ("F21/bezpunktow", "punkty podsumowania nie musza zawierac liczby",
     None, "Each bullet MUST contain at least one specific number", None),

    # "Nadinterpretowanie zrodel": prawo pocztowe Niemiec w tekscie o Wloszech.
    ("F21/zakres", "blok o zakresie faktu ze zrodla",
     "function blokZakresu() {", None, None),
    # "Tresc jest niespojna w obrebie jednego artykulu" (akapit kontra tabela).
    ("F21/spojnosc", "blok o spojnosci liczb w artykule",
     "function blokSpojnosci() {", None, None),

    # "Intencja tekstu jest zle zinterpretowana" - zrodlo B2B, zapytanie B2C.
    ("F22/odbiorca", "pole wyboru odbiorcy",
     'id="audience"', None, None),
    ("F22/blok", "blok o odbiorcy niezaleznym od zrodla",
     "function blokOdbiorcy(odbiorca) {", None, None),

    # "Tresc troche sie klóci z biznesem" - artykul polecal porownywarki.
    ("F23/konflikt", "blok o konflikcie interesu",
     "function blokKonfliktu() {", None, None),

    # "Pole wyboru ton obiecuje duzo, ale nie dowozi" - szlo jedno slowo.
    ("F24/ton", "kazdy ton ma wlasne parametry, nie sama nazwe",
     "var OPISY_TONU = {", None, None),
    ("F24/jezyk", "ton rozpoznawany po pozycji, nie po tekscie opcji",
     "function tonKanoniczny() {", None, None),

    # "Teksty sa mocno monotonne", "wszystkie pokazuja zbyt duzy FOG".
    ("F25/rytm", "blok o rytmie zdan i wskazniku FOG",
     "function blokRytmu() {", None, None),
    ("F25/akapity", "akapity nie maja stalej dlugosci",
     None, "keep paragraphs to 3-5 sentences", None),

    # "Zadna z wersji nie schodzi do H3".
    ("F26/h3", "blok o glebokosci naglowkow",
     "function blokStruktury() {", None, None),
    ("F26/licznik", "liczba H3 widoczna w statystykach",
     'id="stat-h3"', None, None),

    # "Linkowanie powtarza link z bazy wiedzy wielokrotnie".
    ("F27/linki", "powtorzone odnosniki usuwane maszynowo",
     "function usunPowtorzoneLinki(html) {", None, None),
    ("F27/uzycie", "artykul przechodzi przez odchudzanie linkow",
     "art.innerHTML = dolaczZrodla(usunPowtorzoneLinki(html), zrodlaSieciowe);",
     "\n  art.innerHTML = html;\n  art.style.display = 'block';", None),

    # Wszystkie bloki doklejane jednym wywolaniem - zeby nie dalo sie dodac
    # polowy regul i zapomniec o reszcie.
    ("F27/wpiete", "reguly doklejane do promptu artykulu",
     "systemPrompt += blokRzetelnosci({", None, None),

    # Pierwsze przejscie weryfikacji za czlowieka.
    ("F28/faktycheck", "przebieg kontroli faktow",
     "async function uruchomKontroleFaktow(wymus) {", None, None),
    ("F28/przycisk", "kontrola faktow w menu Ocen",
     'id="fakty-btn"', None, None),

    # Model byl wpisany na sztywno w ponad dwudziestu miejscach.
    ("F29/stala", "jedna stala modelu tresci",
     "const MODEL_TRESCI     = 'claude-opus-5';", None, None),
    ("F29/bezliteralu", "zaden endpoint nie ma modelu wpisanego na sztywno",
     None, "model: 'claude-sonnet-4-6'", None),
    ("F29/bezTemperatury", "brak pola temperature (rodzina 5 odrzuca je bledem)",
     None, "temperature:", None),
    ("F29/rezerwa", "zapas tokenow na rozumowanie przy pisaniu",
     "function zRezerwa(tokeny) {", None, None),
    ("F29/cennik", "koszt liczony wedlug modelu z odpowiedzi",
     "function kosztOdpowiedzi(dane) {",
     "sessionCost += (inp * 0.000003) + (out * 0.000015);\n            updateCostDisplay();", None),

    # ── druga runda po audycie: linki, luki i pomiar ──

    # Adres ze zrodla byl przepisywany pod regule formy ("zawsze z www").
    # To ta sama choroba co zmyslanie liczb, tylko na adresie: znany fakt
    # zmieniany po to, zeby pasowal do szablonu.
    ("F30/adres", "adres kopiowany doslownie ze zrodla",
     "COPY THE ADDRESS CHARACTER FOR CHARACTER from the source",
     "always use the www prefix", None),
    ("F30/kotwice", "kotwice opisowe i niepowtarzalne",
     "function blokKotwic() {", None, None),
    ("F30/kontrola", "odnosniki sprawdzane maszynowo",
     "function sprawdzLinkiArtykulu() {", None, None),
    ("F30/normalizacja", "dwa zapisy tego samego adresu daja jeden klucz",
     "function kluczAdresu(adres) {", None, None),
    ("F30/zyje", "sprawdzenie, czy adres w ogole odpowiada",
     "async function sprawdzCzyLinkiZyja(linki) {", None, ("proxy",)),

    # Uzupelnianie luk pisalo nowe sekcje, majac temat i frazy, ale zadnych
    # zrodel - czyli musialo je wymyslic.
    ("F31/luki", "uzupelnianie luk dostaje zrodla",
     "SOURCES (the only material you may draw facts from)", None, None),
    ("F31/bezwymyslania", "luka bez pokrycia oznaczana, nie wypelniana",
     "A GAP IS NOT A LICENCE TO INVENT", None, None),

    # Wskaznik zamglenia byl liczony z calego tekstu i z niepelnego zbioru
    # zdan, wiec zawyzal wynik i prawie nie reagowal na skracanie zdan.
    ("F32/fog", "FOG liczony z tych samych zdan, z ktorych liczy slowa",
     "const sredniaDlugoscZdania = slowa.length / zdania.length;",
     "const avgSentLen = words.length / sentences.length;", None),
    ("F32/proza", "FOG liczony z prozy, bez naglowkow i meta description",
     "function tekstProzy(korzen) {", None, None),

    # Nazwa dokumentu bierze sie z tytulu pobranej strony, czyli z tresci
    # obcej witryny.
    ("F33/ucieczka", "nazwa dokumentu z ucieczka znakow w panelu sugestii",
     "<strong>${escapeHtml(s.name)}</strong>",
     "<strong>${s.name}</strong>", None),

    # -- trzecia runda: co pokazalo uruchomienie na prawdziwym materiale --

    # Kontekst SERP to streszczenie stron konkurencji, a regula pokrycia faktow
    # mowila "w bazie wiedzy LUB w wynikach wyszukiwania" - czyli sama go
    # autoryzowala. Stad w artykule wziete znikad "notowania PKN Orlen" i "EU
    # weekly oil bulletin", mimo wylaczonego uzupelniania z internetu.
    ("F34/serp", "SERP nie jest zrodlem faktow",
     "SERP CONTEXT IS NOT A SOURCE",
     "MUST appear in the knowledge base or in the search results provided", None),
    ("F34/etykieta", "blok SERP opisany w promptcie jako nie-zrodlo",
     "SERP CONTEXT - NOT A SOURCE OF FACTS", None, None),

    # Slowo trudne = 3+ sylaby to kryterium angielskie. W polszczyznie
    # trzysylabowe sa "oplata" i "uslugi", wiec prog zielony byl nieosiagalny:
    # artykul o srednim zdaniu 12,4 slowa dostawal 21,6 i swiecil na czerwono.
    ("F35/fogpl", "slowo trudne liczone od czterech sylab",
     "(w.match(/[aąeęioóuy]/gi) || []).length >= 4).length",
     "(w.match(/[aąeęioóuy]/gi) || []).length >= 3).length", None),
    ("F35/skala", "opis skali FOG mowi o polskiej wersji",
     "'fog-title':'Indeks mglistości (wersja dla polszczyzny)'", None, None),

    # Fraza kluczowa wstawiona doslownie zlamala zdanie ("doplata paliwowa
    # kurier dolicza"), a fraza z rokiem wymusila twierdzenie o 2026 bez
    # pokrycia w zrodle.
    ("F36/frazy", "frazy kluczowe odmieniane, nie wklejane",
     "function blokFraz() {", None, None),
    ("F36/wpiete", "blok fraz doklejany do promptu",
     "blokKotwic() + blokFraz()", None, None),
    ("F36/liczenie", "zakaz liczenia rzeczy dla samej cyfry",
     "Never COUNT something just to have a digit", None, None),

    # Drobiazgi z tego samego uruchomienia.
    ("F37/lamanie", "cytat lamany dopiero gdy slowo sie nie miesci",
     "overflow-wrap:anywhere", "word-break:break-all", None),
    ("F37/meta", "dlugosc meta poza zakresem sygnalizowana kolorem",
     "metaEl2.style.color", None, None),
    # Sama kolejnosc (fakty -> kreska -> SEO), bez emoji, wciec i atrybutow: ikony,
    # klasy i uklad paska moga sie zmieniac, kolejnosc pozycji w menu Ocen - nie.
    ("F37/kolejnosc", "kontrola faktow pierwsza w menu Ocen",
     're:id="fakty-btn"[^\\n]*onclick="przelaczPanelFaktow\\(\\)"[^\\n]*</button>\\s*<div class="grupa-sep"></div>\\s*<button[^>]*id="seo-btn"', None, None),

    # -- czwarta runda: przelacznik uzupelniania wiedza ogolna --

    # Przelacznik nazywal sie "uzupelnij luki wiedza z internetu", a nie dotyka
    # internetu: zmienia trzy zdania w promptcie i pozwala modelowi siegnac do
    # pamieci z treningu. Uzytkownik wylaczajac go sadzil, ze odcina siec.
    # Etykieta ma mowic, CO SIE STANIE po wlaczeniu. "Wiedza z internetu"
    # bylo nieprawda, ale dawalo jakis obraz; "wiedza ogolna modelu" bylo
    # prawdziwe i nie dalo sie z tego wywnioskowac, czy chce sie to wlaczyc.
    # Nazwa opisuje skutek dla artykulu, zastrzezenia sa w podpowiedzi.
    # Kotwica celuje w poczatek etykiety, nie w cale zdanie: poprawka
    # gramatyczna ("podawaj" -> "podaj") gasila kontrole, ktora z gramatyka
    # nie ma nic wspolnego. Liczy sie, ze etykieta nazywa SKUTEK i ze nie
    # wrocila do dawnego, mylacego mechanizmu.
    ("F38/etykieta", "przelacznik nazwany skutkiem, nie mechanizmem",
     "'toggle-web':'Szukaj w sieci",
     "'toggle-web':'Uzupełnij luki wiedzą z internetu'", None),
    ("F38/podpowiedz", "podpowiedz mowi o zrodlach i o danych firmy",
     "Dane o Twojej firmie zawsze tylko z bazy.", None, None),
    ("F38/czas", "podpowiedz uprzedza o dluzszym generowaniu",
     "Wydłuża generowanie o ok. 30 s.'", None, None),

    # Bezwarunkowe "baza wiedzy jest jedynym zrodlem faktow" stalo w
    # sprzecznosci z galezia promptu mowiaca "mozesz uzupelnic wiedza ogolna".
    ("F38/tryb", "reguly pokrycia zalezne od trybu uzupelniania",
     "blokFaktow(opcje.uzupelnia)", None, None),
    ("F38/pamiec", "pamiec modelu nie jest zrodlem takze przy wyszukiwaniu",
     "YOUR OWN MEMORY IS STILL NOT A SOURCE", None, None),
    ("F38/luki", "uzupelnianie luk zawsze tylko ze zrodel",
     "blokFaktow(false)", None, None),

    # Kontrola faktow musi wiedziec, w jakim trybie powstal tekst - inaczej
    # nazywa dozwolone uzupelnienie tak samo jak naciagniecie zrodla.
    ("F39/kontrola", "kontrola faktow zna tryb generowania",
     "trybUzupelniania = useWeb;", None, None),
    ("F39/nota", "nota w panelu o pochodzeniu zdan spoza zrodel",
     "'fakty-tryb-uzupelniania':", None, None),

    # -- piata runda: przelacznik naprawde otwiera siec --

    # Przez cala historie aplikacji przelacznik "uzupelnij luki" nie dotykal
    # internetu. Teraz daje modelowi narzedzie wyszukiwania, a przypisy sa po
    # stronie API zawsze wlaczone, wiec kazde zdanie spoza bazy wiedzy ma adres.
    ("F40/narzedzie", "wyszukiwanie w sieci jako narzedzie modelu",
     "function narzedzieWyszukiwania() {", None, None),
    ("F40/wariant", "podstawowy wariant narzedzia, dostepny takze na Azure i GCP",
     "type: 'web_search_20250305', name: 'web_search'", None, None),
    ("F40/wpiete", "artykul dostaje narzedzie przy wlaczonym przelaczniku",
     "cialoArtykulu.tools = [narzedzieWyszukiwania()]", None, None),
    ("F40/blokada", "domeny konkurencji wykluczone z wyszukiwania",
     "blockedDomains: [", None, None),

    # Przy dluzszym szukaniu API przerywa ture. Bez odeslania odpowiedzi
    # artykul urywalby sie w polowie zdania i wygladalo to jak blad modelu.
    ("F40/pauza", "przerwana tura jest dokanczana, nie urywana",
     "if (dane.stop_reason !== 'pause_turn') break;", None, None),

    # Adresy, z ktorych model skorzystal, jada razem z tekstem do DOCX-a i PDF-a.
    ("F41/zrodla", "zbieranie adresow z wynikow i z przypisow",
     "function zrodlaZOdpowiedzi(dane) {", None, None),
    ("F41/lista", "lista zrodel doklejana przed meta description",
     "function dolaczZrodla(html, zrodla) {", None, None),
    ("F41/bezstatystyk", "bibliografia nie wchodzi do statystyk tekstu",
     "const zrodla = kopia.querySelector('.zrodla-box');", None, None),
    ("F41/kontrola", "adresy z sieci sa dla kontroli zrodlami, nie obcymi",
     "zrodlaSieciowe.forEach(function (z) { zbior[kluczAdresu(z.url)] = true; });", None, None),

    # Kodowy blizniak reguly "zawsze z www": doklejanie www. do kazdej domeny
    # marki zamieniało dzialajacy odnosnik na martwy, gdy marka www nie uzywa.
    ("F42/www", "www doklejane tylko gdy adres marki sam go uzywa",
     "if (_bh.length && _zWww) {", "if (_bh.length) {", None),

    # -- szosta runda: co pokazalo pierwsze uruchomienie z wyszukiwaniem --

    # Bibliografia pierwszego artykulu z sieci miala 21 pozycji, w tym FedEx,
    # UPS, TNT, DPD, DB Schenker i kilkanascie porownywarek. Wymienialismy
    # wszystko, co model przejrzal, jakby kazda z tych stron cos potwierdzala.
    ("F43/cytowane", "w bibliografii tylko strony, na ktore model sie powolal",
     "return z.cytowan > 0;", None, None),
    # Lista wykluczen byla najpierw zgadywana, potem branzowa (kurierska),
    # a to produkt dla dowolnej marki. Ustawia sie ja w oknie Marka, a kod
    # startuje z pusta - wdrozenie dla nowej firmy nie ma sie zaczynac od
    # wykluczania cudzych konkurentow.
    ("F43/konkurenci", "wykluczenia z okna marki, nie z kodu",
     "const wykluczone = domenyZPola(cfg.blockedDomains);",
     "'dpd.com', 'fedex.com', 'ups.com', 'tnt.com', 'dbschenker.com'", None),
    ("F43/pole", "pole domen wykluczonych w oknie marki",
     'id="llms-blocked"', None, None),
    ("F43/czyszczenie", "adres z www i sciezka sprowadzany do samej domeny",
     "function domenyZPola(tekst) {", None, None),
    ("F43/hosty", "domeny marki tez z okna, nie tylko z kodu",
     "cfg && cfg.domains\n    ? domenyZPola(cfg.domains)", None, None),
    ("F43/nazwa", "skonfigurowana nazwa marki trafia do regul",
     "The brand is called exactly", None, None),

    # Regula rozroznienia linii miala wpisane wprost linie jednego klienta.
    ("F43/linie", "nazwy linii biznesowych z konfiguracji, nie z kodu",
     "They are separate offers, not synonyms.",
     "attribute it to the eCommerce line, never to Express", None),
    ("F43/bezcytowania", "zakaz cytowania konkurencji jako zrodla",
     "never let one appear in the list", None, None),

    # Model uzyl naraz czterech nazw z jednej grupy i przypisal dwie rozne
    # formuly obliczania tej samej oplaty dwom nazwom tej samej spolki, bo
    # jedna z nich jest historyczna.
    ("F44/marka", "jedna marka, jedna nazwa, jedna spolka",
     "ONE BRAND, ONE NAME, ONE COMPANY", None, None),
    ("F44/tabela", "tabela okresow wymaga kazdego wiersza ze zrodla",
     "you do not have a table, you have three data points", None, None),

    # Przekroczony czas na stronie DHL-a byl zglaszany jako "adres nie
    # odpowiada", z angielskim komunikatem wyjatku w polskim interfejsie.
    # Kontrola, ktora sie nie odbyla, nie jest wynikiem kontroli.
    ("F45/niesprawdzony", "przekroczony czas to nie martwy adres",
     "rodzaj: 'link-niesprawdzony'", None, None),
    ("F45/opis", "powod podany po polsku, nie tresc wyjatku",
     "'fakty-powod-link-niesprawdzony':", None, None),

    # -- audyt calosci: zaszlosci po jednym kliencie i sciezki bez regul --

    # Kolory eksportu, konkurenci i zapytania startowe byly wpisane w kod pod
    # jedna firme. Produkt ma obslugiwac dowolna marke.
    ("F46/kolory", "PDF w kolorach z konfiguracji marki",
     "function kolorMarki(ktory) {", "const BRAND_COLORS = {", None),
    ("F46/widocznosc", "badanie widocznosci startuje puste, bez cudzej branzy",
     "competitors: '',",
     "'InPost, DPD, Poczta Polska, UPS, GLS, FedEx, Orlen Paczka, Allegro'", None),

    # Korekta premium, poprawa po ocenie i przerobki dostaja sam artykul,
    # bez bazy wiedzy. Uwaga "za malo konkretow" konczyla sie dopisaniem
    # konkretow z niczego.
    ("F47/przepisywanie", "sciezki przepisujace nie wprowadzaja nowych faktow",
     "function blokPrzepisywania() {", None, None),
    ("F47/premium", "korekta premium z regula przepisywania",
     "const editorSysPelny = editorSys + blokPrzepisywania();", None, None),
    ("F47/przerobki", "przerobki na inne formaty z regula przepisywania",
     "system: blokPrzepisywania() + `", None, None),

    # Nazwa uzytkownika z obcej instalacji WordPressa szla prosto do innerHTML.
    ("F48/wordpress", "nazwa z obcego WordPressa z ucieczka znakow",
     "escapeHtml(_t('wp-zalogowano').replace('{name}', String(d.name || '')))", None, ("proxy", "keys", "owner")),

    # -- panel kontroli faktow milczal, a wyszukiwanie w sieci bylo nieme --
    # Spinner wlaczal sie DOPIERO po sprawdzeniu odnosnikow, a to potrafi
    # trwac dziesiatki sekund. Panel byl przez ten czas otwarty i pusty,
    # wiec wygladal na zepsuty. Zmierzone: 6034 ms do pierwszego znaku.
    ("F50/spinner", "stan kontroli faktow widoczny przed zapytaniami",
     "etapFaktow('fakty-etap-linki');",
     "  wynikEl.innerHTML = '';\n  ladowanie.style.display = 'block';\n  odswiez.style.display = 'none';",
     None),
    ("F50/rownolegle", "odnosniki i tresc sprawdzane rownolegle, nie po kolei",
     "const obietnicaLinkow = (async function () {", None, None),
    ("F50/bez-tekstu", "brak artykulu nazwany, nie cicha ucieczka z funkcji",
     "escapeHtml(_t('fakty-brak-tekstu'))", None, None),
    ("F50/przebieg", "starszy przebieg kontroli nie nadpisuje nowszego",
     "const moj = ++faktyPrzebieg;", None, None),

    # "Raz generuje zrodla, raz nie": model nie szukal, szukal i nic nie wzial,
    # albo przelacznik byl wylaczony - trzy rozne przebiegi, jeden obraz.
    ("F50/licznik", "liczba zapytan do sieci i przypisow policzona",
     "function statystykiWyszukiwania(dane) {", None, None),
    ("F50/wskaznik", "przebieg wyszukiwania widoczny po wygenerowaniu",
     "zrodlaSieciowe);\n  pokazStanSieci(stanSieci, zrodlaSieciowe.length);", None, None),

    # Wartosc jest ustawiana programowo, wiec nie ma data-i18n i applyLang
    # jej nie rusza: w angielskim interfejsie stalo "Web: nie szukal".
    ("F51/jezyk", "stan sieci przerysowany przy zmianie jezyka",
     "if (typeof przerysujStanSieci === 'function') przerysujStanSieci();", None, None),
    ("F51/odmiana", "rzeczownik odmieniony po liczebniku",
     "function formaZrodel(n) {", None, None),
    ("F51/bezosobowo", "stan sieci opisany bezosobowo, nie jak zachowanie osoby",
     "_t('siec-bez-wyszukiwania')", "'siec-nie-szukal'", None),

    # Ta sama wada co przy stanie sieci, w sasiednich napisach: tekst ustawiony
    # w kodzie nie ma data-i18n, wiec applyLang go nie tlumaczy. ustawTekst
    # nadaje atrybut razem z trescia, wiec element tlumaczy sie dalej sam.
    ("F51/ustawtekst", "napis z kodu dostaje data-i18n, wiec tlumaczy sie sam",
     "function ustawTekst(el, klucz) {", None, None),
    ("F51/premium", "przycisk premium tlumaczy sie po przelaczeniu jezyka",
     "ustawTekst(btn, 'btn-premium-active');",
     "btn.textContent = _t('btn-premium-active');", None),
    ("F51/marka", "stan zapisu konfiguracji marki tlumaczy sie po zmianie jezyka",
     "ustawTekst(info, tylkoOdczyt ? 'llms-tylko-odczyt' : '');", None, ("proxy",)),
    ("F51/fakty", "wynik kontroli faktow skladany na nowo po zmianie jezyka",
     "if (typeof przerysujWynikFaktow === 'function') przerysujWynikFaktow();", None, None),
    ("F50/historia", "wskaznik sieci nie opisuje artykulu z historii",
     "    trybUzupelniania = false;\n    pokazStanSieci(null, 0);", None, None),

    # -- konfiguracja marki na serwerze --
    # Tozsamosc marki siedziala w localStorage, wiec kazdy uzytkownik i kazde
    # urzadzenie mialy wlasna kopie, a nowa osoba w zespole zaczynala od pustej
    # i generowala teksty bez regul o marce.
    ("F49/serwer", "konfiguracja marki z serwera ma pierwszenstwo nad przegladarka",
     "if (markaZSerwera) return bezPrzykladu(Object.assign({}, LLMS_DEFAULTS, markaZSerwera));",
     "function getLlmsConfig() {\n  try {", None),
    ("F49/pobranie", "pobranie konfiguracji marki z serwera",
     "async function wczytajMarkeZSerwera() {", None, ("proxy",)),
    ("F49/start", "pobranie wpiete w start aplikacji",
     "\n  wczytajMarkeZSerwera();\n", None, ("proxy",)),
    ("F49/administrator", "pola marki tylko do odczytu, gdy pisze administrator",
     "const tylkoOdczyt = Boolean(markaZSerwera) && !markaAdmin;", None, ("proxy",)),
    # Warianty keys i owner nie maja serwera. Wywolanie jego endpointu konczy
    # sie tam bledem w konsoli przy kazdym uruchomieniu.
    ("F49/bezserwera", "warianty bez serwera nie wolaja jego endpointow",
     None, "wczytajMarkeZSerwera", ("keys", "owner")),

    # ── runda 2 ──
    ("R2/premium-uciety", "ucieta samokorekta zostawia oryginal i informuje",
     "if (impData.stop_reason === 'max_tokens') {", None, None),
    ("R2/wyloguj-sekrety", "wylogowanie usuwa klucze i hasla CMS konta",
     "var SEKRETY_KONTA = /^(cai_key_|cai_klucz_)|^(cai-wp|cai-drupal)$/;", None, ("proxy",)),
    ("R2/brief-telefon", "menu zadan briefu na telefonie jako arkusz od dolu",
     "body.is-mobile #grupa-brief-menu, body.is-mobile #grupa-widocznosc-menu { top: auto; bottom: 0;", None, None),
    # Na telefonie powiadomienie przez kilka sekund zaslanialo "Wygeneruj tresc", a pasek
    # audio lezal pod dolna nawigacja. Oba stoja teraz nad najwyzszym stalym paskiem.
    ("R2/paski-dolne", "powiadomienia i pasek audio nad paskami dolu telefonu",
     "body.is-mobile #powiadomienia { bottom: calc(var(--nad-audio,", None, None),
    ("R2/wp-bez-h1", "tresc do CMS bez H1 (tytul idzie osobnym polem)",
     "if (h1) h1.remove();", None, None),
    ("R2/wp-publikuj", "Publikuj dla biezacego artykulu po zapisaniu ustawien CMS",
     "if (pub) pub.style.display = ((wpSettings.url || drupalSettings.url) && art", None, None),
    ("R2/cms-https", "CMS pod http:// - komunikat o https zamiast CORS",
     "if (cmsBezHttps(adresCms)) {", None, None),
    ("R2/skip-link", "odnosnik Przejdz do tresci na poczatku strony",
     'class="przejdz-do-tresci" onclick="return przejdzDoTresci()"', None, None),
    # Odznaka miala data-i18n="badge-ready", wiec kazde applyLang (zmiana jezyka, start
    # po odswiezeniu) cofalo gotowy artykul do "gotowy do generowania".
    ("R2/odznaka-jezyk", "odznaka wyniku trzyma swoj klucz przy zmianie jezyka",
     "ustawTekst(document.getElementById('out-badge'), 'badge-historia');", "document.getElementById('out-badge').textContent = _t(", None),
    ("R2/odmiana", "odmiana liczebnikow w statusie generowania grupowego",
     "status.textContent = _tn('bulk-gotowe', topics.length);", None, None),
    ("R2/wczesny-jezyk", "teksty EN podmienione przed reszta skryptu (strona nie czeka ukryta)",
     "tlumaczStatyczne(I18N[currentLang] || I18N.pl);", None, None),
    ("R2/tytul-h1", "wariant tytulu mozna wstawic jako H1",
     "onclick=\"uzyjTytuluJakoH1(${i}, this)\"", None, None),
    ("R2/koszt-proxy", "bez kosztu sesji w wariancie z serwerem",
     None, 'id="h-cost"', ("proxy",)),
    ("R2/blokady-pakietu", "Grafika i Audio spoza pakietu oznaczone w menu zadan",
     "document.querySelectorAll('[onclick=\"openAudioPanel()\"]').forEach(", ".btn-module[onclick=", ("proxy",)),

    # ── warstwa reskinu ──
    # Splash trzymal gotowa aplikacje jeszcze 2,4 s (stale 1900 ms + zanikanie) i zjadal
    # pierwsze dotkniecie. Motyw i jezyk ustawia teraz skrypt w <head>, wiec nie ma czego
    # zaslaniac - splash nie wraca, a stan widoku jest gotowy przed pierwszym malowaniem.
    ("R/splash", "bez splasha trzymajacego gotowa aplikacje",
     'id="cai-motyw-start"', "setTimeout(done, 1900)", None),
    ("R/splash-css", "bez czastek i poswiaty splasha",
     "document.documentElement.classList.remove('bez-anim')", 'id="cin-splash-cv"', None),
    ("R/styl", "blok stylow reskinu",
     '<style id="cin-reskin">', None, None),
    ("R/postep", "paski postepu generowania",
     "cin-progress", None, None),
    ("R/panele", "pozycja paneli oceny tylko poza mobile",
     "body:not(.is-mobile)", None, None),

    # ── konfiguracja wariantow ──
    ("W/keys", "klucze z localStorage, deklaracje modyfikowalne",
     "let API_KEY = magazyn.getItem('cai_key_anthropic')", None, ("keys",)),
    ("W/owner", "tryb owner wylacza blokade urzadzenia",
     "const OWNER_MODE = true;", None, ("owner",)),
    ("W/proxy", "proxy kieruje ruch na workera",
     "window.API_ENDPOINT_OVERRIDE", None, ("proxy",)),
    # niema celuje w pelna deklaracje z komentarzem: sama nazwa placeholdera wystepuje
    # legalnie w komunikatach i18n, w porownaniach isDemo i w bloku <code> ekranu "brak klucza"
    # Proxy czyta klucz z localStorage (pusty = klucz serwera). W pliku nadal nie
    # ma zadnego klucza - i nie moze byc.
    ("W/proxy", "proxy nie trzyma kluczy w pliku",
     "let API_KEY = magazyn.getItem('cai_klucz_anthropic') || '';",
     "const API_KEY = 'WSTAW_TUTAJ_NOWY_KLUCZ_API'; //", ("proxy",)),

    # ── podpowiedzi tematow (wszystkie warianty - to zwykle wywolanie modelu) ──
    ("T/przycisk", "przycisk podpowiedzi przy polu tematu",
     'onclick="otworzTematy()"', None, None),
    ("T/okno", "okno podpowiedzi tematow",
     'id="tematy-modal"', None, None),
    ("T/wstawianie", "propozycja trafia do pola tematu",
     "function uzyjTematu(i) {", None, None),
    # Podpowiadanie tematow to wywolanie pomocnicze. Gdyby kiedys zaczelo sie
    # zglaszac jako artykul, zjadaloby uzytkownikowi sztuke z pakietu za sama
    # liste pomyslow - dlatego naglowek ma sie tu NIE pojawic.
    ("T/licznik", "podpowiadanie tematow nie liczy sie jako artykul",
     None, "'x-cai-czynnosc': 'artykul',\n        'anthropic-version': '2023-06-01',\n        'anthropic-dangerous-direct-browser-access': 'true'\n      },\n      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1600",
     None),
    ("T/i18n", "klucze i18n podpowiedzi w obu jezykach",
     "'tematy-generuj':'Zaproponuj 10 tematów'", None, None),
    ("T/i18n", "klucze i18n podpowiedzi po angielsku",
     "'tematy-generuj':'Suggest 10 topics'", None, None),

    # ── kreator pierwszego uruchomienia (tylko wariant proxy) ──
    ("K/kreator", "kreator pierwszego uruchomienia",
     'id="start-modal"', None, ("proxy",)),
    ("K/menu", "kreator da sie otworzyc ponownie z menu",
     'onclick="otworzStart();closeSettingsMenu()"', None, ("proxy",)),
    ("K/klucze", "klucz uzytkownika doklejany w jednym miejscu",
     "function zKluczem(sciezka, opcje){", None, ("proxy",)),
    # Klucze uzytkownika maja zostac w przegladarce. Gdyby ktos kiedys dopisal
    # ich wysylke na serwer, ta kontrola tego nie zlapie - ale zlapie
    # najprostsza pomylke: zapis klucza pod stara nazwa wariantu keys.
    ("K/klucze", "kreator nie miesza nazw z wariantem keys",
     None, "cai_key_anthropic", ("proxy",)),

    # ── baza wiedzy na serwerze (tylko wariant proxy) ──
    ("B/menu", "pozycja Baza wiedzy w menu ustawien",
     'onclick="otworzBazeSerwera();closeSettingsMenu()"', None, ("proxy",)),
    ("B/prompt", "wiedza do promptu idzie z serwera, nie z calych dokumentow",
     "ostatniaWiedzaSerwera = await wiedzaZSerwera(", None, ("proxy",)),
    ("B/kontrola", "kontrola faktow widzi te same fragmenty bazy co model",
     "return [ostatniaWiedzaSerwera, lokalne].filter(Boolean).join(", None, None),
    ("B/jedna", "dokumenty dodane w panelu trafiaja do bazy na serwerze",
     "var dodajLokalnie = window.addDoc;", None, ("proxy",)),
    ("B/pusta", "komunikat o pustej bazie liczy tez dokumenty na serwerze",
     "const isEmpty = liczbaDokumentow() === 0;", "const isEmpty = docs.length === 0;", None),
    ("B/api", "okno bazy rozmawia z endpointem wyszukiwania",
     "fetch('/api/baza/szukaj'", None, ("proxy",)),

    # ── brama OpenSEO (tylko wariant proxy) ──
    # Adres i domene podstawia serwer przy serwowaniu strony; w repo maja zostac
    # placeholdery, inaczej kazdy klon niesie czyjas domene.
    # OpenSEO stoi w obszarze "Widocznosc AI" w pasku gornym (nowy uklad, E4).
    ("O/menu", "pozycja OpenSEO w menu Widocznosc AI",
     'id="openseo-item" style="display:none" onclick="otworzOpenSeo()"', None, ("proxy",)),
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
    ("Z/fonty", "kroje marki z wlasnego hosta, nie z Google Fonts",
     "pwa/fonty/schibsted-grotesk-latin-ext-wght-normal.woff2", "fonts.googleapis.com", None),
    ("Z/leniwe", "ciezkie biblioteki ladowane w miejscu uzycia, nie w <head>",
     "await wczytajSkrypt('pwa/lib/mammoth.browser.min.js');", '<script src="pwa/lib/xlsx.full.min.js"></script>', None),
    ("R/tokeny", "tokeny systemu projektowego i warstwy kaskady",
     '<style id="cai-tokeny">', None, None),
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
    # ── pakiet widoczny w aplikacji (tylko wariant proxy) ──
    ("U/odznaka", "odznaka pakietu w pasku gornym",
     'id="pakiet-badge"', None, ("proxy",)),
    ("U/przechwyt", "jeden punkt przechwytu platnych wywolan",
     "if (!PLATNE[sciezka]) return oryginalnyFetch.apply(null, arguments);", None, ("proxy",)),
    ("U/402", "ekran wyczerpanego pakietu po HTTP 402",
     "window.pokazLimitPakietu", None, ("proxy",)),
    ("U/artykul", "tylko generowanie tresci zglasza sie jako artykul",
     "'x-cai-czynnosc': 'artykul',", None, ("proxy",)),
    # Naglowek spoza listy CORS Anthropic wywolalby preflight i zabil warianty,
    # ktore lacza sie z api.anthropic.com prosto z przegladarki.
    ("U/artykul", "naglowek czynnosci nie trafia do wywolan bezposrednich",
     None, "x-cai-czynnosc", ("keys", "owner")),

    ("P/kolejnosc", "frazy renderowane w jednym miejscu, nie w dwoch kopiach",
     'return \'<div class="brief-section"><h4>\' + _t(\'brief-kw-section\') + \'</h4><div id="brief-kw-list"></div></div>\';',
     None, None),

    # ── generowanie: stan wyniku z flag, nie z wygladu (audyt rundy 1) ──
    ("G/blad", "blad generowania rozpoznany po fladze, nie po stylu akapitu",
     "if (!html || bladGenerowania) {",
     "html.startsWith('<p style=\"color:var(--red)\">')", None),
    ("G/escape", "tresc bledu API escapowana przed wstawieniem",
     "escapeHtml(komunikatBleduApi(e, zapas, kontekst))", "</strong> ${e.message}</p>", None),
    ("G/uciety", "artykul uciety na limicie dlugosci oznaczony ostrzezeniem",
     "artykulUciety = data.stop_reason === 'max_tokens';", None, None),
    ("G/dostep", "przerobki, widocznosc i narracja dzialaja za proxy (bez klucza w przegladarce)",
     "const noKey = !maDostepDoApi();", "!API_KEY || API_KEY.startsWith(", None),
    ("G/oczysc", "HTML od modelu oczyszczany zaraz po odpowiedzi (lista dozwolonych znacznikow)",
     "html = oczyscHtmlModelu(html.replace(", None, None),
    ("G/oczysc-parser", "oczyszczanie w obojetnym dokumencie, nie w div glownego dokumentu",
     "new DOMParser().parseFromString('<!doctype html><body>' + String(html), 'text/html')", None, None),
    ("G/oczysc-cms", "do WordPressa i Drupala idzie oczyszczona tresc",
     "const content = oczyscHtmlModelu(artClone.innerHTML);", "const content = artClone.innerHTML;", None),
    ("G/oczysc-historia", "artykul z historii oczyszczany przy odczycie",
     "art.innerHTML = h.html ? oczyscHtmlModelu(h.html)", None, None),
    ("G/oceny-esc", "uwagi z oceny SEO/AIO escapowane",
     '<span class="seo-item-text">${escapeHtml(item.text)}</span>', '<span class="seo-item-text">${item.text}</span>', None),
    ("G/magazyn", "uszkodzone ustawienia w magazynie nie zatrzymuja skryptu",
     "let wpSettings = czytajJson('cai-wp', {}) || {};", "JSON.parse(localStorage.getItem('cai-wp')", None),
    ("G/magazyn-jeden", "aplikacja nie siega do localStorage poza magazynem",
     "var magazyn = (function () {", "= localStorage.getItem(", None),
    ("G/konto", "za serwerem dane przegladarki rozdzielone miedzy konta",
     '<meta name="cai-konto" content="WSTAW_TUTAJ_KONTO">', None, ("proxy",)),
    ("G/zrodla", "zrodla sieciowe zerowane na starcie kazdego generowania",
     "  zrodlaSieciowe = [];\n  stanSieci = null;\n  if (API_KEY === 'WSTAW_TUTAJ_KLUCZ_API'", None, None),
]

# ── runda 3, wykonawca D: komunikaty bledow dostawcow i liczby w jezyku interfejsu ──
# Osobna lista doklejana do KONTROLE, zeby nie zderzala sie z grupa R3B przy scalaniu.
KONTROLE += [
    ("R3D/blad-typ", "blad API niesie typ i status z odpowiedzi (nie sam tekst)",
     "if (data.error) throw bladOdpowiedzi(data);", "throw new Error(msg || _t('err-api-generic'));", None),
    ("R3D/rodzaje", "zly klucz, brak srodkow, za dlugi tekst rozpoznane po typie i tresci",
     "if (/prompt is too long|too many (input )?tokens|context length|maximum context/i.test(m)) return 'za-dlugi';", None, None),
    ("R3D/ponow", "Sprobuj ponownie tylko przy bledach przejsciowych",
     "if (ponow && czyPonowic(e)) {", "onclick=\"generate()\">' + ikona('refresh-cw')", None),
    ("R3D/klucz-keys", "zly klucz prowadzi do okna Klucze API",
     "if (typeof window.openKeysModal === 'function') window.openKeysModal();", None, ("keys",)),
    ("R3D/klucz-proxy", "zly klucz prowadzi do kreatora konta",
     "if (typeof window.startDalej === 'function') window.startDalej();", None, ("proxy",)),
    ("R3D/panele", "panele ocen i briefu bez surowego e.message",
     "document.getElementById('seo-content').innerHTML = blokBledu(e,",
     "${_t('msg-err-prefix')}${escapeHtml(e.message)}", None),
    ("R3D/strona", "pobieranie strony bez \"Blad:\" na sztywno",
     "status.textContent = _t('msg-blad-prefiks') + ' ' + komunikatBleduApi(e, 'err-url-extract');", "status.textContent = `Błąd: ${e.message}`;", None),
    ("R3D/audio", "TTS, STT i skrypt audio przez wspolny komunikat",
     "powiadomBladApi(e, 'err-stt', 'audio');", "'STT error'", None),
    ("R3D/grafika", "blad OpenAI przy grafice przez wspolny komunikat",
     "throw bladOdpowiedzi(err, st, 'OpenAI');", "OpenAI odrzucił klucz. Sprawdź OPENAI_API_KEY", None),
    ("R3D/cms", "bledy WordPressa i Drupala ze slownika (status na zdanie)",
     "resEl.innerHTML = htmlBleduCms(r.status, err.message || '', 'wp');", "escapeHtml(err.message || 'błąd')", None),
    ("R3D/genind", "bez martwego wskaznika _genInd", None, "_genInd", None),
    ("R3D/liczby", "liczby z ulamkiem w jezyku interfejsu (koszt, srednie pozycje)",
     "el.textContent = '$' + formatujLiczbe(sessionCost, 3, true);", "sessionCost.toFixed(3)", None),
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

        # Wzorzec "re:..." to wyrazenie regularne (kolejnosc elementow niezaleznie od zapisu).
        def jest_w(wzor):
            return re.search(wzor[3:], html) is not None if wzor.startswith("re:") else wzor in html
        brak = jest is not None and not jest_w(jest)
        wrocilo = niema is not None and jest_w(niema)

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
