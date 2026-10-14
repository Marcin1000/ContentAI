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
     "const _rpLang = jezykDlaModelu(kaRp.jezyk);", None, None),

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

    # R3: PDF skladany z kopii artykulu (trescPdf) - ramka meta odkladana i dopisywana na koncu.
    ("F16", "eksport PDF doklejа meta-box na samym koncu",
     "if (el.classList.contains('meta-box')) { meta = el; return; }", None, None),

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

    # "Nadinterpretowanie zrodel": przepisy jednego kraju w tekscie o innym kraju.
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
     "const htmlArtykulu = dolaczZrodla(usunPowtorzoneLinki(html), zrodlaSieciowe);",
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
     "const MODEL_TRESCI     = 'claude-opus-5-5';", None, None),
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
     "'\\n\\nSOURCES (knowledge base' + (zSiecia ? '; you may also search the web'", None, None),
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
    # autoryzowala. Stad w artykule wziete znikad notowania gieldowe i biuletyn
    # cen surowcow, mimo wylaczonego uzupelniania z internetu.
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

    # Fraza kluczowa wstawiona doslownie zlamala zdanie ("oplata serwisowa
    # firma dolicza"), a fraza z rokiem wymusila twierdzenie o 2026 bez
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
    # R6: luki jak glowne generowanie - baza, a przy artykule z siecia (albo wlaczonym przelaczniku)
    # takze wyszukiwanie z przypisami. Sama baza przy pustej bazie dawala tylko "brak pokrycia".
    ("F38/luki", "uzupelnianie luk: zrodla jak przy generowaniu (baza + wyszukiwanie z przypisami)",
     "blokFaktow(zSiecia) + blokZakresu()", None, None),
    ("R6/luki-zrodla", "uzupelnianie luk nie gubi listy zrodel (zrodla wyjete przed cieciem na wnioski)",
     "robocze.querySelectorAll('.zrodla-box').forEach((el) => el.remove());", None, None),
    ("R6/luki-wynik", "wynik pokrycia tylko z napisanych sekcji, bez pustych sekcji 'brak pokrycia' w artykule",
     "gapSelectedTopics = [...new Set([...gapSelectedTopics, ...pokryteTeraz])];", "gapSelectedTopics = [...new Set([...gapSelectedTopics, ...selectedNow])];", None),
    ("R6/luki-ikony", "ikony tematow w Lukach jako SVG (emoji w kontenerze font-size 0 byly niewidoczne)",
     "ikona('circle-check', 'ok') + '</span>'", "<span class=\"gap-topic-icon\">\\u2705</span>", None),
    ("R6/luki-strzalka", "strzalka miedzy wynikami pokrycia jako ikona na srodku",
     '<span class="gap-delta-arrow" aria-hidden="true"><svg class="ikona"><use href="#i-arrow-right"/></svg></span>', None, None),

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

    # Bibliografia pierwszego artykulu z sieci miala 21 pozycji, w tym strony
    # pieciu konkurentow i kilkanascie porownywarek. Wymienialismy
    # wszystko, co model przejrzal, jakby kazda z tych stron cos potwierdzala.
    ("F43/cytowane", "w bibliografii tylko strony, na ktore model sie powolal",
     "return z.cytowan > 0;", None, None),
    # Lista wykluczen byla najpierw zgadywana, potem branzowa (pod jednego klienta),
    # a to produkt dla dowolnej marki. Ustawia sie ja w oknie Marka, a kod
    # startuje z pusta - wdrozenie dla nowej firmy nie ma sie zaczynac od
    # wykluczania cudzych konkurentow.
    ("F43/konkurenci", "wykluczenia z okna marki, nie z kodu",
     "const wykluczone = domenyZPola(cfg.blockedDomains);",
     "re:blockedDomains:\\s*\\[\\s*'", None),
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
     "re:attribute it to the \\w+ line, never to", None),
    ("F43/bezcytowania", "zakaz cytowania konkurencji jako zrodla",
     "never let one appear in the list", None, None),

    # Model uzyl naraz czterech nazw z jednej grupy i przypisal dwie rozne
    # formuly obliczania tej samej oplaty dwom nazwom tej samej spolki, bo
    # jedna z nich jest historyczna.
    ("F44/marka", "jedna marka, jedna nazwa, jedna spolka",
     "ONE BRAND, ONE NAME, ONE COMPANY", None, None),
    # 14.10: przyklady w poleceniach bez szczegolow branzy z pierwszych testow (repozytorium jest publiczne).
    ("RN/grupa", "polecenie o grupie spolek z przykladem bez jednej branzy",
     "A group can contain several companies (for example separate service lines or subsidiaries).",
     "(parcel, express, freight, e-commerce)", None),
    ("RN/odbiorca", "polecenie o jednym adresacie z neutralnym przykladem",
     'addressing the end customer (e.g. "you will receive your order")', "pick up your parcel", None),
    ("RN/audio", "polecenie skryptu audio z neutralnym przykladem odmiany",
     'e.g. "wiadomość", never "wiadość"', None, None),
    ("F44/tabela", "tabela okresow wymaga kazdego wiersza ze zrodla",
     "you do not have a table, you have three data points", None, None),

    # Przekroczony czas na stronie duzej firmy byl zglaszany jako "adres nie
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
     "re:competitors:\\s*'[^']", None),

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
     "uporzadkujArtykul(art);\n  pokazStanSieci(stanSieci, zrodlaSieciowe.length);", None, None),

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
     '<span class="menu-przelacznik-tekst"><span data-i18n="btn-premium">',
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
     "    : _tn('bulk-gotowe', udane);", None, None),
    ("R2/wczesny-jezyk", "teksty EN podmienione przed reszta skryptu (strona nie czeka ukryta)",
     "tlumaczStatyczne(I18N[currentLang] || I18N.pl);", None, None),
    ("R2/tytul-h1", "wariant tytulu mozna wstawic jako H1",
     "onclick=\"uzyjTytuluJakoH1(${i}, this)\"", None, None),
    ("R2/koszt-proxy", "w wariancie z serwerem koszt API domyslnie ukryty (pokazuje go tylko administratorowi, R4/koszt-api)",
     '<div class="hstat" id="h-cost-kafel" hidden>', None, ("proxy",)),
    ("R2/blokady-pakietu", "Grafika i Audio spoza pakietu oznaczone w menu zadan",
     "document.querySelectorAll('[onclick=\"openAudioPanel()\"]').forEach(", ".btn-module[onclick=", ("proxy",)),

    # ── runda 3: uklad i wyglad (A) ──
    ("R3/start-srodek", "ekran startowy wysrodkowany w kolumnie wyniku",
     ".start-ekran { margin-inline: auto; max-width: 720px; }", None, None),
    ("R3/samokorekta-switch", "Samokorekta jako przelacznik z opisem",
     'role="switch" aria-checked="false" aria-describedby="samokorekta-opis"', None, None),
    ("R3/samokorekta-menu", "Samokorekta w menu obok przycisku Wygeneruj, nie jako wiersz nad nim",
     'class="btn-secondary menu-przelacznik" id="premium-btn"', 'class="samokorekta-wiersz"', None),
    ("R3/start-na-briefie", "po wejsciu brief pusty: temat ostatniego artykulu nie wraca, widok Brief",
     "document.getElementById('topic').value = nowyTemat ? temat : '';", None, None),
    ("R3/seo-bez-projektu", "frazy OpenSEO bez projektu lub polaczenia: wyjasnienie zamiast pustych list",
     '<div id="seo-pusty" class="seo-pusty" hidden>', None, ("proxy",)),
    ("R3/konto-kategorie", "Konto: grupy jako kategorie (naglowek wersalikami z kreska)",
     ".settings-menu .menu-naglowek { margin: var(--s-8) var(--s-8) var(--s-4); padding: var(--s-12) 0 0; border-top: 1px solid var(--c-linia);", None, None),
    ("R3/pasek-zanikanie", "pasek Wygeneruj na telefonie: tresc zanika zamiast byc przecieta",
     "body.is-mobile .form-actions-sticky::before {", None, None),
    ("R3/dotyk-bez-hover", "ekrany dotykowe: podswietlenie pozycji menu nie zostaje po dotknieciu",
     "@media (hover: none) {\n  .settings-item:hover:not(:focus-visible)", None, None),
    ("R3/fog-w-arkuszu", "telefon: wyjasnienie FOG/KD w arkuszu statystyk, nie w panelu pod zaslona",
     "if (opisWArkuszuStatystyk('fog-panel')) return;", None, None),
    ("R3/arkusz-bez-maski", "arkusz statystyk bez maski zanikania (prawa strona nie przeswituje)",
     "body.is-mobile.statystyki-otwarte .article-stats.show { -webkit-mask-image: none; mask-image: none; }", None, None),
    ("R4/zadania-w-tle", "zerwane polaczenie (telefon w tle) nie gubi generowania: X-Zadanie i ponowienie po powrocie",
     "const res = await fetchZadania(endpoint, options, null, true);", None, ("proxy",)),
    ("R4/zadania-grafika", "grafika: jedno zadanie w tle dla wszystkich prob",
     "imgRes = await fetchZadania(imgEndpoint, { method:'POST', headers: imgHeaders, body: imgBody, signal: ctrl.signal }, idZadaniaGrafiki);", None, ("proxy",)),
    ("R4/edycja-pasek", "telefon: tryb Edytuj ma widoczny pasek pod naglowkiem z Gotowe",
     "body.is-mobile.edit-active .fmt-toolbar { display: flex; }", "    art.focus();\n  }\n}", None),
    ("R4/zrodla-zwarte", "telefon: zwarta lista zrodel, pole dotyku z ::after zamiast min-height",
     "body.is-mobile .zrodla-box li > a::after { content: \"\"; position: absolute; top: -14px;", "body.is-mobile .zrodla-box li > a { display: inline-block; min-height: var(--h-dotyk)", None),
    ("R4/brief-zapamietany", "Brief artykulu zapamietany dla tematu, Analizuj ponownie wymusza nowa analize",
     "const zapamietany = odswiez ? null : zapamietanyBrief(topic);", None, None),
    ("R4/brief-slow", "liczba slow w briefie bez podwojonego slowa",
     "replace(/\\s*(słów|slow|words?)\\.?\\s*$/i, '')", None, None),
    ("R4/frazy-bez-dubli", "frazy z briefu bez prawie identycznych dubli (a/i/w)",
     "if (!frazaJuzJest(kw)) { keywords.push(kw); renderKws(); }", None, None),
    ("R4/ikony-wysrodkowane", "ikona sama w kafelku bez odstepu dla tekstu (Konto, nawigacja)",
     ".settings-item > span:first-child > .ikona, span.nav-icon > .ikona, span.kb-empty-icon > .ikona { margin-right: 0; }", None, None),
    ("R4/samokorekta-raz", "okno Tryb samokorekty nie pyta po swiadomym wlaczeniu",
     "if (premiumMode && !skipPremiumModal && magazyn.getItem('cai_samokorekta_ok') !== '1') {", None, None),
    ("R4/pusty-pasek", "telefon: bez artykulu nie ma pustego paska statystyk",
     "body.is-mobile:not(:has(#article-stats.show)):not(:has(#versions-bar.show)) .output-bar .output-bar-left { display: none; }", None, None),
    ("R4/przycisk-samokorekta", "Wygeneruj z samokorekta jednym napisem tym samym krojem (bez dopisku mniejszym pismem)",
     "#gen-btn.z-samokorekta .gen-etykieta { display: none; }", "'gen-z-samokorekta':'+ samokorekta'", None),
    # Wykonawca A (logika generowania), runda 4.
    ("R4/przyciski-wyniku", "jedna lista przyciskow wyniku: generowanie, blad, Historia i odswiezenie (kod-01)",
     "pokazPrzyciskiWyniku(true, h.type);", "['copy-btn','dl-btn','dl-docx-btn','dl-pdf-btn','titles-btn','links-btn','gap-btn','edit-btn','seo-btn','aio-btn','img-btn'].forEach", None),
    ("R4/grupowe-bez-fraz", "Generuj grupowo: temat bez fraz z briefu, brief nietkniety (kod-03, UX4-03)",
     "ok = await generate(true, { temat: topics[i], frazy: [], zKolejki: true });", "document.getElementById('topic').value = topics[i];", None),
    ("R4/grupowe-samokorekta", "Generuj grupowo: samokorekta dla calej kolejki (kod-03)",
     "    premiumMode = premiumKolejki;", None, None),
    ("R4/grupowe-zatrzymaj", "Generuj grupowo: Zatrzymaj, X i Escape przerywaja kolejke (kod-03)",
     "  if (bulkRunning) zatrzymajGrupowe();", "if (okno.id === 'bulk-modal' && typeof bulkRunning", None),
    ("R4/grupowe-licznik", "Generuj grupowo: licznik tylko udanych (UX4-03)",
     "_t('bulk-gotowe-czesc').replace('{ok}', udane)", None, None),
    ("R4/edycja-autozapis", "edycja: zapis poprawek 1 s po zmianie i przy wyjsciu z karty (kod-04)",
     "licznikPoprawek = setTimeout(zapiszPoprawkiTeraz, 1000);", None, None),
    ("R4/edycja-przed-generowaniem", "nowe generowanie konczy edycje (bez edit-active i paska) (kod-04)",
     "re:  // artykule \\(martwe linki, kod-04\\)\\.\\n  if \\(editMode\\) toggleEdit\\(\\);", None, None),
    ("R4/dopracuj-przerwij", "Dopracuj tekst: wlasny AbortController, wynik do historii, bledy widoczne (kod-05)",
     "  // zatrzymuje, a apiFetch konczy tez zadanie na serwerze.\n  przerwanieGenerowania = new AbortController();", "catch(e) { console.warn('[premium] ocena nie powiodla sie:', e && e.message); }", None),
    ("R4/dopracuj-bez-zrodel", "Dopracuj tekst: do modelu bez listy zrodel, zrodla doklejane po powrocie (kod-05)",
     "art.innerHTML = wstawBlokZrodel(improved, zrodlaBox ? zrodlaBox.outerHTML : '');", None, None),
    ("R4/jedno-generowanie", "Popraw, Grupowe i Ctrl+Enter nie startuja drugiego generowania (kod-07)",
     "if (generowanieTrwa(opcje && opcje.zKolejki)) { ostrzezGenerowanieTrwa(); return false; }", None, None),
    ("R4/popraw-z-samokorekta", "Popraw z samokorekta nie gubi wklejonego tekstu (kod-07)",
     "    await generate(true);\n  } finally {", None, None),
    ("R4/spinner-jezyk", "zmiana jezyka w trakcie nie cofa napisu spinnera do 1. etapu (kod-16)",
     "if ((el.id === 'spin-label' || el.id === 'spin-sub') && spinnerPracuje()) {", None, None),
    # ── runda 4: wyglad i uklad (wykonawca C, agencja-ux UX4) ──
    ("R4/szablony-zapisz", "Szablony: pole nazwy sie kurczy, Zapisz w kolumnie arkusza (UX4-01)",
     "#tpl-save-name { min-width: 0; }", None, None),
    ("R4/grafika-przyciski", "wynik grafiki: Pobierz PNG, Kopiuj i Ponow nie sciskaja sie (UX4-02)",
     "#img-result-wrap div:has(> #img-download-link) > * { flex: none;", None, None),
    ("R4/zaawansowane-karty", "SERP i AEO w tresci ustawien zaawansowanych, z odstepami (UX4-04)",
     're:<select id="audience">[\\s\\S]{0,400}?</select>\\s*</div>\\s*<label class="toggle-row" for="use-serp">', None, None),
    ("R4/wytyczne-zamkniete", "pole Dodatkowe wytyczne zamkniete przed Zrodlami (UX4-04, UX4-14)",
     're:onclick="dictate\\(\'extra\', this\\)"[^\\n]*</button>\\s*</div>\\s*</div>\\s*<div class="field zrodla">', None, None),
    ("R4/przelacznik-dotyk", "ekrany dotykowe: ramka najazdu przelacznika nie zostaje po dotknieciu (UX4-04)",
     "@media (hover: none) {\n  .toggle-row:hover, .toggle-row:has(input:checked):hover", None, None),
    ("R4/arkusz-naglowek", "telefon: jeden naglowek arkusza 48 px, tytul 16 px, X 8 px od krawedzi (UX4-05)",
     "body.is-mobile .modal-head { align-items: center; min-height: 48px;", None, None),
    ("R4/statystyki-tytul", "arkusz statystyk z tytulem i zamknieciem (UX4-05)",
     '<div class="arkusz-tytul"><span data-i18n="statystyki-tytul">', None, None),
    ("R4/brief-od-dolu", "Brief artykulu od dolu ekranu, glowne dzialanie w stopce (UX4-05)",
     'class="modal-footer brief-stopka"', "bottom:calc(64px + env(safe-area-inset-bottom,0px))", None),
    ("R4/glowne-dzialanie", "glowne dzialanie okna: komputer na koncu po prawej, telefon na cala szerokosc (UX4-16)",
     ".modal div:not(.modal):has(> .btn-generate):not(#no-source-modal *, #premium-modal *, #trk-modal *) > .btn-generate { order: 99;", None, None),
    ("R4/skrot-odmiana", "skrot statystyk odmienia slowo jak arkusz: 833 slowa (UX4-07)",
     "_t(FORMY_STATYSTYK['stat-words'][formaLiczebnika(parseInt(sl, 10))])", "const t = sl + ' ' + _t('stat-words-unit')", None),
    ("R4/statystyki-kroj", "arkusz statystyk krojem interfejsu, ikona informacji z zestawu SVG (UX4-08)",
     "body.is-mobile.statystyki-otwarte .article-stats .astat { font-family: var(--f-ui); }", 'style="margin-left:1px">ℹ</span>', None),
    ("R4/zrodla-rozmiar", "zrodla z sieci: punkt i data w rozmiarze tytulu, nie akapitu (UX4-09)",
     "body.is-mobile .article .zrodla-box li { font-size: var(--t-sm); }", None, None),
    ("R4/popraw-tytul", "Popraw: tytul bez niewidocznego znaku, tresc bez drugiego wciecia (UX4-10)",
     "#improve-modal .modal-head + div { margin-inline: -4px;", "'improve-title':'\\ufe0f", None),
    ("R4/menu-samokorekta", "menu: tekst Samokorekty w kolumnie pozostalych pozycji (UX4-11)",
     ".grupa-menu .menu-przelacznik { align-items: center; gap: var(--s-8);", None, None),
    ("R4/eksport-jsonld", "Eksport: JSON-LD z ikona jak pozostale formaty, Grafika z jedna ikona (UX4-11)",
     'data-i18n="btn-jsonld" data-ikona="braces"', "'btn-jsonld':'{ } JSON-LD'", None),
    ("R4/historia-wciecie", "Historia: jedno wciecie kafli, wyszukiwania i wpisow, jedno tlo (UX4-12)",
     "#h-list-col > div:first-child { padding: var(--s-8) var(--hist-wciecie) !important; }", None, None),
    ("R4/konto-kafle", "Konto: Motyw i Jezyk z ikona w kafelku, przelaczniki rownej szerokosci (UX4-13)",
     ".settings-menu .menu-wiersz .segmenty { display: inline-grid; grid-template-columns: 1fr 1fr; min-width: 136px; }", None, None),
    ("R4/rytm-pionowy", "rytm 16 px od pola do etykiety w Briefie i Audio (UX4-14)",
     ".form-col .row2 { row-gap: var(--s-16); }", None, None),
    ("R4/grafika-telefon", "Grafika: pola bez drugiego wciecia, Uzyty prompt jako rozwijka (UX4-15)",
     '<details class="rozwijka" id="img-prompt-wrap"', None, None),
    ("R4/tempo-glosu", "tempo glosu z przecinkiem i znakiem razy (UX4-16)",
     "function tempoUI(x) {", "toFixed(2)+'x'", None),
    ("R4/tytuly-telefon", "Tytuly na telefonie: tytul na cala szerokosc, przyciski pod nim (UX4-16)",
     "body.is-mobile .title-opt-text { flex: 1 1 100%; }", None, None),
    ("R4/koszt-api", "koszt API w Historii: administrator widzi calosc, wlasne klucze - koszt na swoich kluczach",
     "kontoAdmin = markaAdmin;\n  updateCostDisplay();", None, ("proxy",)),
    ("R4/koszt-dostawcy", "koszt API liczony po dostawcach (Anthropic, OpenAI, ElevenLabs), osobno na wlasnych kluczach",
     "if (naWlasnymKluczu(dostawca)) kosztyApi.wlasne[dostawca] = (kosztyApi.wlasne[dostawca] || 0) + kwota;", "sessionCost += scriptCost;", None),
    ("R5/plakietka-stanu", "komputer: plakietka stanu (z historii) nie wchodzi pod Edytuj/Gotowe",
     "body:not(.is-mobile) .output-bar .output-bar-left { flex: 1 0 auto; }", None, None),
    ("R5/ptaszek", "pole zaznaczenia w Bazie: ptaszek wysrodkowany, bez powtorzen (biale punkty)",
     "background-size: 11px; background-repeat: no-repeat; background-position: center; }", None, None),
    ("R5/rzad-pol-w-oknie", "pola obok siebie w oknie (Drupal) wyrownane u gory",
     ".modal .row2 > .field + .field { margin-top: 0; }", None, None),
    ("R5/wiecej-zadan-nad-paskiem", "telefon: Wiecej zadan nad paskiem z Wygeneruj - drugie dotkniecie ... zamyka menu",
     "body.is-mobile #grupa-brief-menu { bottom: var(--nad-paskami, calc(var(--dol) + 72px)); }", None, None),
    ("R6/wybierz-baze", "Wybierz przy Bazie wiedzy otwiera baze (telefon: arkusz, komputer: panel)",
     'onclick="otworzBazeWiedzy()" data-i18n="zrodla-wybierz"', None, None),
    ("R6/wersje-telefon", "telefon, od trzech wersji: lista wyboru zamiast segmentu, ktory wchodzil na statystyki",
     "bar.classList.toggle('wiele-wersji', versions.length >= 3);", None, None),
    ("R6/cudzyslowy", "polski artykul: cudzyslowy ujednolicone na „...” (ekran, historia, eksport)",
     "  cudzyslowyPolskie(korzen);\n  return korzen;", None, None),
    ("R6/luki-caly-temat", "Luki: temat porownywany w calosci, nie po 20 pierwszych znakach",
     "const stillMissing = (baseline.missing || []).filter(t => !addrLC2.includes(t.toLowerCase().trim()));",
     "a.substring(0,20) === t.toLowerCase().trim().substring(0,20)", None),
    ("R6/luki-historia", "Poprawa SERP zapisana we wpisie historii (po odswiezeniu wracal artykul sprzed poprawy)",
     "addVersion(htmlDoZapisu(art), etykietaWersji(_t('ver-serp')));\n    // Wynik do biezacej wersji i do Historii - po odswiezeniu wracal tekst sprzed poprawy (E-03).\n    if (typeof zapiszRecznePoprawki === 'function') zapiszRecznePoprawki();", None, None),
    ("R6/oceny-wersji", "przelaczenie wersji odswieza otwarta ocene (SEO/AIO z pamieci wersji, AEO/GEO od nowa)",
     "  zapiszRecznePoprawki();\n  odswiezOtwarteOceny();\n}", None, None),
    ("R6/linki-ikona", "sugestie linkow: ikona zamiast kodu ' + ikona('link') + ' w tekscie",
     '<span class="link-sug-icon">${ikona(\'link\')}</span>', "<span class=\"link-sug-icon\">' + ikona('link') + '</span>", None),
    ("R6/dopracuj-etykieta", "Dopracuj: kolejna wersja o tej samej nazwie z numerem",
     "addVersion(htmlDoZapisu(art), etykietaWersji(_t('ver-after-premium')));", None, None),
    ("R6/dopracuj-bez-zmian", "Dopracuj bez uwag konczy sie komunikatem, nie cisza",
     "if (stan === 'gotowe' && !zmiana && samokorektaBezUwag !== null) pokazPowiadomienie(_t('msg-dopracuj-bez-zmian').replace('{n}', samokorektaBezUwag), 'info');", None, None),
    ("R6/luki-wyscig", "E-01: wynik poprawy pod luki tylko dla artykulu, z ktorego wyszla (numerArtykulu), w trakcie blokada generowania",
     "if (nrArt !== numerArtykulu) { pokazPowiadomienie(_t('gap-inny-artykul'), 'uwaga'); return; }", None, None),
    ("R6/luki-numer-artykulu", "E-01: numer artykulu rosnie przy kazdym nowym artykule",
     "  kontekstArt = null;\n  numerArtykulu++;", None, None),
    ("R6/luki-caly-tekst", "E-05: do analizy luk caly tekst, nie 3000 znakow",
     "return tekstBlokami(kopia).slice(0, 40000);", "const articleText = (art.innerText || '').substring(0, 3000);", None),
    ("R6/luki-tylko-tematy", "E-06: tematy czolowki bez fraz kluczowych, listy modelu dopasowane do SERP",
     "const present = dopasujDoSerp(odp.present, tematy);", "[...serpData.topics, ...serpData.phrases].join(', ')", None),
    ("R6/luki-w-toku", "E-10: ta sama analiza luk w toku nie idzie drugi raz",
     "if (gapWToku && gapWToku.snapshot === snap) return;", None, None),
    ("R6/luki-per-wersja", "E-09: stan Luk zapisany przy wersji i wczytany po przelaczeniu",
     "  zapiszStanLuk(versions[activeVersion]);\n  activeVersion = i;", None, None),
    ("R6/luki-bez-wymuszania", "E-11: po poprawie panel Luk tylko gdy na wierzchu, inaczej komunikat",
     "if (lukiNaWierzchu) runGapAnalysis();", None, None),
    ("R6/luki-miejsce", "E-16: nowe sekcje we wskazanym miejscu konspektu ([AFTER: ...]) i w stylu naglowkow artykulu",
     "const przed = kotwica === 'start' ? (h2Bazy[0] || null) : kotwica ? (h2Bazy[h2Bazy.indexOf(kotwica) + 1] || null) : null;", None, None),
    ("R6/luki-bledy", "E-08: pusta odpowiedz i bledy poprawy pod luki widoczne w panelu, odliczanie 429 w przycisku",
     "if (!aiOutput.replace(/<[^>]*>/g, '').trim()) { pokazBladLuk(_t('gap-pusto')); return; }", None, None),
    ("R6/serp-blad", "E-08: blad analizy SERP przy generowaniu - komunikat i osobny tekst w Lukach",
     "noSerp.textContent = _t(serpBlad ? 'gap-serp-blad' : 'gap-no-serp');", None, None),
    ("R6/luki-pkt", "E-17: punkty w Lukach przez slownik (EN pts)",
     "bEl.textContent = scoreBefore + ' ' + _t('gap-pkt');", "bEl.textContent = scoreBefore + ' pkt';", None),
    ("R6/nowy-artykul", "Nowy artykul: czysci temat, frazy, wytyczne i wynik (artykul w Historii), preferencje zostaja, Cofnij",
     'id="nowy-artykul-btn" onclick="nowyArtykul()"', None, None),
    ("R6/nowy-artykul-wynik", "Nowy artykul: wynik jak przed pierwszym generowaniem, bez powrotu starego artykulu po odswiezeniu",
     "  biezacyHist = null;\n  magazyn.removeItem('cai_biezacy');\n  art.innerHTML = '';", None, None),
    ("R6/ustawienia-domyslne", "Przywroc ustawienia domyslne (z Cofnij), jezyk tekstu znow za jezykiem interfejsu",
     "function przywrocUstawieniaDomyslne() {", None, None),
    ("R6/luki-wnioski", "uzupelnianie luk: wnioski nie puchna ponad 7 punktow (Runda A: wczesniej 8, lista 3-7 w AEO)",
     "ileLi(updatedKw) <= AEO_LISTA_MAX || !originalKw", None, None),
    ("R6/luki-bez-zrodla", "Luki: komunikat o tematach bez zrodla zalezy od trybu (baza / siec)",
     "gapBezPokrycia = bezPokrycia; gapBezPokryciaSiec = zSiecia;", None, None),
    ("R6/inspektor-od-gory", "nowa zakladka inspektora otwiera sie od gory",
     "if (tr) tr.scrollTop = 0;", None, None),
    ("R6/podpis-generowania", "podpis pod Generuje tresc wysrodkowany",
     ".spinner-wrap #spin-label, .spinner-sub { text-align: center; text-wrap: balance; max-width: 36em; }", None, None),
    ("R6/serp-porownanie", "SERP: srednie czolowki obok liczb artykulu, z podpisem",
     "tabela = '<div class=\"serp-porownanie\">", None, None),
    ("R3/wytyczne-w-briefie", "Dodatkowe wytyczne w glownym briefie, przed Zrodlami (poza zaawansowanymi)",
     "re:id=\"extra\"[\\s\\S]{0,2000}<div class=\"field zrodla\">", None, None),
    ("R3/ton-w-briefie", "Ton i Jezyk w glownym briefie, nie w zaawansowanych",
     '<div class="row2 row2-ton">', None, None),
    ("R3/tabela-telefon", "tabela w artykule na telefonie przewijana w bok z cieniem",
     "body.is-mobile .article table { display: block; width: max-content;", None, None),
    ("R3/wiersz-meta", "telefon: skrot statystyk w wierszu meta, pelna lista w arkuszu",
     'onclick="przelaczStatystyki()"', None, None),
    ("R3/paski-czytanie", "telefon: paski chowane przy czytaniu (transform)",
     "body.is-mobile.paski-ukryte .mobile-nav { transform: translateY(100%); }", None, None),
    # Drugie dotkniecie "Tworz"/"Wiecej" trafialo w pozycje arkusza i uruchamialo platna akcje.
    ("R3/arkusz-nad-paskiem", "arkusz menu nad paskiem akcji (przycisk zostaje widoczny)",
     "body.is-mobile .grupa-menu { bottom: var(--nad-paskami,", None, None),
    ("R3/blokada-przewijania", "przewijanie w arkuszu nie przewija strony pod spodem",
     "html:has(body.is-mobile.inspektor-otwarty), html:has(body.is-mobile.inspektor-otwarty) body,", None, None),
    ("R3/zrodla-zwin", "zrodla zwiniete do 5 z przyciskiem tylko na ekran",
     "przycisk.setAttribute('data-tylko-ekran', '');", None, None),
    # Tytul arkusza (R3-14) liczyl sie jako "cos w grupie" - Tworz/Eksport/Wiecej swiecily przed artykulem.
    ("R3/grupy-bez-tytulu", "tytul arkusza nie pokazuje pustej grupy w pasku",
     "!e.classList.contains('grupa-sep') && !e.classList.contains('arkusz-tytul')", None, None),
    ("R3/serp-bez-auto", "panel SERP nie otwiera sie sam po generowaniu",
     "function renderSerpPanel(pokaz) {", None, None),
    # ── Runda 4, wykonawca B: historia, kontekst artykulu, funkcje wyniku ──
    ("R4/historia-id", "wpisy historii z trwalym id; biezacyHist i cai_biezacy trzymaja id (kod-09)",
     "Object.assign(history[0], { id: noweIdWpisu(), ts: Date.now(), kontekst: kontekstArt });", "magazyn.setItem('cai_biezacy', '0');", None),
    ("R4/historia-migracja", "stare wpisy dostaja id, cai_biezacy z indeksu na id (kod-09)",
     "history.forEach(h => { if (h && !h.id) { h.id = noweIdWpisu(); noweId = true; } });", None, None),
    ("R4/historia-podglad", "podglad Historii na komputerze nie zeruje wersji ani paneli generatora (kod-09)",
     "if (otw) { otw.hidden = false; otw.dataset.id = i; }", "otworzWGeneratorze(Number(this.dataset.idx))", None),
    ("R4/historia-brief", "otwarcie wpisu z Historii nie nadpisuje tematu w briefie (kod-02)",
     "kontekstArt = kontekstZWpisu(h);", "if (topicEl) topicEl.value = h.topic || '';", None),
    ("R4/kontekst-tytuly", "Tytuly z kontekstu artykulu, nie z briefu (kod-08)",
     "const topic   = ka.temat || ka.h1 || 'temat';", "const topic   = document.getElementById('topic').value.trim() || 'temat';", None),
    ("R4/kontekst-oceny", "ocena SEO z kontekstu artykulu (kod-08)",
     "const kwText = ka.frazy.length ? ka.frazy.join(', ') : 'brak - oceniaj ogólną jakość treści';", None, None),
    ("R4/kontekst-dopracuj", "Dopracuj tekst z kontekstu artykulu (kod-08)",
     "const ka      = kontekstArtykulu(); // kod-08: kontekst artykulu, nie briefu", None, None),
    ("R4/tytuly-ladowanie", "napis ladowania Tytulow resetowany przy kazdym otwarciu (kod-08)",
     "document.getElementById('titles-loading').textContent = _t('titles-loading');", None, None),
    ("R4/popraw-temat", "Popraw: temat z okna albo domyslny, nie stary temat briefu (UX4-10)",
     "document.getElementById('topic').value = (document.getElementById('improve-topic')?.value || '').trim() || _t('improve-topic-default');",
     "document.getElementById('topic').value = document.getElementById('topic').value || _t('improve-topic-default');", None),
    ("R4/zapis-bez-obcinania", "historia i baza zapisywane bez cichego obcinania, z jezykiem wpisu (kod-10)",
     "html: h.html || '', jezyk: h.jezyk || '', kontekst: h.kontekst || null", "html: (h.html || '').substring(0, 30000)", None),
    ("R4/magazyn-pelny", "pelny magazyn: najstarsze wpisy historii usuwane z komunikatem (kod-10)",
     "pokazPowiadomienie(_t('msg-historia-przycieta').replace('{n}', usuniete), 'uwaga');", None, None),
    ("R4/wytyczne-czyszczone", "nowy tekst: Dodatkowe wytyczne poprzedniego artykulu czyszczone (kod-15)",
     "if (ex && (!k || typeof k.extra !== 'string' || k.extra === ex.value.trim())) ex.value = '';", None, None),
    ("R4/historia-usun", "usuwanie wpisu historii z potwierdzeniem (kod-17)",
     "if (!window.confirm(_t('hist-usun-pytanie').replace('{t}', h.topic || ''))) return;", None, None),
    ("R4/historia-data", "czas wpisu historii z data (kod-17)",
     "${escapeHtml(czasWpisu(h))}", None, None),
    # R6: po zapisie wersji dochodzi odswiezenie otwartej oceny (R6/oceny-wersji)
    ("R4/wersja-w-historii", "wybrana wersja zapisana we wpisie historii, cache ocen zerowany (kod-17)",
     "  seoCache = null; aioCache = null;\n  wczytajStanLuk(versions[i]);\n  zapiszRecznePoprawki();\n  odswiezOtwarteOceny();\n}", None, None),
    ("R4/hash-calosc", "hash oceny z calego tekstu (kod-17)",
     "for (let i = 0; i < str.length; i++) {", "for (let i = 0; i < Math.min(str.length, 500); i++) {", None),
    ("R4/baza-zaznaczone", "do artykulu ida tylko zaznaczone dokumenty bazy (kod-06)",
     "return docs.filter(d => d.selected);", "return anySelected ? docs.filter(d => d.selected) : docs;", None),
    ("R4/grafika-kontekst", "kontekst grafiki z biezacego artykulu i jego jezyk (kod-11)",
     "ctx.value = kontekstGrafiki.auto = tekstArtykuluDlaModelu().substring(0, 800);", "Article content (Polish, summarize visually):", None),
    ("R4/przerobki-calosc", "przerobki z calego artykulu bez zrodel i meta (kod-12)",
     "const articleText = tekstArtykuluDlaModelu(20000);", "art.innerText.substring(0, 4000)", None),
    ("R4/przerobki-wyscig", "spozniona przerobka nie nadpisuje nowszej (kod-12)",
     "if (nrPrzerobki !== runRepurpose.nr) return;", None, None),
    ("R4/szablony-wartosc", "szablony ustawiaja typ, ton i dlugosc po wartosci opcji (kod-13)",
     "const toneOpt = opcjaSzablonu(toneSel, t.tone);", "if (opt.text === t.tone)", None),
    ("R4/ton-wartosc", "opcje tonu z wartoscia niezalezna od jezyka interfejsu (kod-13)",
     '<option value="Ekspercki" data-i18n="opt-expert">', None, None),
    ("R4/wklejanie", "wklejanie w Edytuj przez filtr HTML, bez obcych stylow (kod-14)",
     "if (html) document.execCommand('insertHTML', false, oczyscHtmlModelu(html));", None, None),
    ("R4/kopia-bez-stylow", "zapis i eksport bez atrybutow style poza tabelami (kod-14)",
     "|| !el.closest('table')) el.removeAttribute('style');", None, None),
    ("R4/jezyk-tekstu", "interfejs EN ustawia jezyk tekstu English, dopoki autor nie wybierze (UX4-06)",
     "sel.value = currentLang === 'en' ? 'English' : 'Polski';", None, None),

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
     "if (!PLATNE[sciezka] || !wlasnyAdres(zasob)) return oryginalnyFetch.apply(null, arguments)", None, ("proxy",)),
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
    ("G/oceny-esc", "uwagi z oceny SEO/AIO escapowane (Runda A: i bez srednika)",
     '<span class="seo-item-text">${escapeHtml(bezSrednikowTekst(String(item.text || \'\')))}</span>', '<span class="seo-item-text">${item.text}</span>', None),
    ("G/magazyn", "uszkodzone ustawienia w magazynie nie zatrzymuja skryptu",
     "let wpSettings = czytajJson('cai-wp', {}) || {};", "JSON.parse(localStorage.getItem('cai-wp')", None),
    ("G/magazyn-jeden", "aplikacja nie siega do localStorage poza magazynem",
     "var magazyn = (function () {", "= localStorage.getItem(", None),
    ("G/konto", "za serwerem dane przegladarki rozdzielone miedzy konta (identyfikator z /konto.js, R9-D)",
     '<script src="/konto.js"></script>', None, ("proxy",)),
    ("G/zrodla", "zrodla sieciowe zerowane na starcie kazdego generowania",
     "  zrodlaSieciowe = [];\n  stanSieci = null;\n  if (API_KEY === 'WSTAW_TUTAJ_KLUCZ_API'", None, None),

    # ── runda 3, grupa R3B (wykonawca logiki: eksporty, stan, oceny) ──
    # DOCX przez html-docx-js byl HTML-em w opakowaniu (altChunk, strona Letter): Google Docs,
    # LibreOffice i Pages pokazywaly pusty dokument.
    ("R3B/docx", "DOCX z wlasnego generatora WordprocessingML (wszystkie trzy miejsca)",
     "await wczytajSkrypt('pwa/lib/docx-natywny-4.js');", "wczytajSkrypt('pwa/lib/html-docx.js')", None),
    ("R3B/docx-bez-altchunk", "zadne miejsce nie sklada DOCX starym sposobem",
     None, "htmlDocx.asBlob(", None),
    ("R3B/kopia", "wszystkie eksporty z jednej kopii artykulu",
     "function kopiaDoEksportu(zrodlo, cel) {", None, None),
    ("R3B/tylko-ekran", "elementy data-tylko-ekran usuwane z eksportu i historii",
     "kopia.querySelectorAll('[data-tylko-ekran]').forEach(function (el) { el.remove(); });", None, None),
    ("R3B/niewidoczne", "tresc niewidoczna na ekranie nie wychodzi do klienta",
     "const ukryte = niewidoczneWArtykule(zrodlo);", None, None),
    ("R3B/notatki-luk", "notatka autora o luce (p[data-brak]) nie trafia do eksportu",
     "const luki = usunNotatkiLuk(kopia);", None, None),
    ("R3B/schowek", "schowek z kopii w chwili klikniecia, nie z tekstu sprzed edycji",
     "const tekst = art && art.innerHTML.trim() ? tekstEksportu(kopiaDoEksportu(art, 'schowek')) : currentText;", None, None),
    ("R3B/cms-kopia", "WordPress i Drupal dostaja te sama kopie co pliki",
     "const artClone = kopiaDoEksportu(art, 'cms');", None, None),
    ("R3B/historia", "wpis historii ze zrodlami, bez elementow ekranowych, z jezykiem artykulu",
     "html: htmlDoZapisu(art), jezyk: KODY_JEZYKOW[lang] || '' });", None, None),
    # "(368 days ago)" pod polskim artykulem i w plikach dla klienta.
    ("R3B/daty", "page_age przeliczane na date bezwzgledna przy generowaniu",
     "data = dataZrodla(data, teraz);", None, None),
    ("R3B/miesiace", "data zrodla ze stalej tablicy miesiecy (30 wrz 2025 / 30 Sep 2025)",
     "pl: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],", None, None),
    ("R3B/bez-var", "data zrodla bez stylu z tokenem motywu",
     None, "const data = z.data ? ' <span style=\"color:var(--text3)\">(' + escapeHtml(z.data)", None),
    ("R3B/zrodla-aplikacji", "lista zrodel tylko od aplikacji (blok z modelu wypada)",
     "const podrobione = pojemnik.querySelectorAll('.zrodla-box');", None, None),
    ("R3B/jezyk", "etykiety i daty eksportu w jezyku artykulu, nie interfejsu",
     "jezykArtykulu = KODY_JEZYKOW[lang] || '';", None, None),
    ("R3B/nazwy", "nazwy plikow: transliteracja, laczniki, ciecie na granicy slowa, bez marki",
     "function rdzenNazwyPliku(tekst) {", "slugMarki()", None),
    ("R3B/klasy", "klasy i data-* z odpowiedzi modelu tylko z listy aplikacji",
     "const HTML_KLASY = new Set(['meta-box', 'meta-label', 'zrodla-box', 'zrodla-label', 'zrodlo-data', 'oznaczenie-ai']);",
     "/^data-[a-z0-9-]+$/.test(nazwa)", None),
    ("R3B/jsonld", "kod JSON-LD nie zamyka znacznika skryptu tekstem z artykulu",
     "JSON.stringify(schema, null, 2).replace(/</g, '\\\\u003c')", None, None),
    ("R3B/oceny", "jeden wzor naglowka czterech ocen",
     "function naglowekOceny(wynik, rodzaj) {", "const lbl = en ? 'AEO points' : 'pkt AEO';", None),
    ("R3B/aeo-geo", "teksty paneli AEO i GEO ze slownika (przelaczaja sie z jezykiem)",
     "_t('geo-skladnik-struktura')", "'Struktura / schema'", None),
    ("R3B/statystyki", "pasek statystyk i panele poprzedniego artykulu czyszczone na starcie generowania",
     "  // Statystyki, panele i wyniki poprzedniego artykulu nie przeciekaja do nowego (R3-20).\n  wyczyscStanArtykulu();", None, None),
    ("R3B/fakty-stan", "stan kontroli faktow przekazywany takze w sciezce z pamieci",
     "pokazWynikFaktow(faktyWynik, faktyStan);", "    pokazWynikFaktow(faktyWynik);\n    return;", None),
    ("R3B/docx-blad", "blad DOCX bez surowego komunikatu wyjatku",
     None, "powiadomBlad(_t('msg-docx-error') + ((e && e.message) || ''))", None),

    # -- 14.10: jeden znak marki (A) wszedzie --
    # Spinner (cztery ramiona osobno, bo animacja zapala je po kolei) mial znak B: ramiona z przerwami i kolo w srodku.
    ("ZA/spinner", "aplikacja: spinner ze znakiem A (ramiona z otworem), bez znaku B i kola w srodku",
     '<path d="M16 1 L19.8 12.2 L18.12 13.88 A3 3 0 0 0 13.88 13.88 L12.2 12.2 Z"/><path d="M31 16 L19.8 19.8',
     "L18.82 12.33", None),
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
     "el.textContent = kwotaUsd(wszystko ? Math.max(suma, sessionCost) : suma);", "sessionCost.toFixed(3)", None),
]


# ── runda 5, wykonawca D: ekrany Grafika i Audio (dwie kolumny, stopka akcji zawsze w oknie) ──
# Osobna lista doklejana do KONTROLE, zeby nie zderzala sie z poprawkami koordynatora przy scalaniu.
KONTROLE += [
    ("R5/grafika-uklad", "Generator grafik: panel modulu bez stylu w atrybucie (dwie kolumny z CSS)",
     '<div id="img-panel" class="modul-panel" style="display:none">', '<div id="img-panel" style="display:none;position:fixed;', None),
    ("R5/audio-uklad", "Tresci audio: ten sam panel modulu zamiast waskiej kolumny 9 pol",
     '<div id="audio-panel" class="modul-panel" style="display:none">', '<div id="audio-panel" style="display:none;position:fixed;', None),
    ("R5/stopka-akcji", "komputer: pola przewijane w karcie, stopka z Wygeneruj na dole karty",
     ".modul-pola { flex: 1 1 auto; min-height: 0; overflow-y: auto;", None, None),
    ("R5/stopka-telefon", "telefon: stopka z Wygeneruj ostatnia i przyklejona nad dolnym paskiem",
     "body.is-mobile .modul-stopka { order: 3; position: sticky; bottom: 0;", None, None),
    ("R5/grafika-dol", "telefon: panel grafiki konczy sie nad dolnym paskiem (bez sztywnych 60 px)",
     "body.is-mobile #img-panel { padding: 16px 16px 24px; touch-action: pan-y; }", "bottom: 60px !important; touch-action: pan-y;", None),
    ("R5/panel-nad-przerobkami", "Grafika nad otwartym panelem przerobek (z-index jak Audio)",
     ".modul-panel { position: fixed; inset: var(--pasek-h) 0 0 0; z-index: 150;", None, None),
    ("R5/temat-glowny", "Audio: Temat lub tresc zaraz pod rodzajem, pole rosnie na wysokosc kolumny",
     '<div id="au-source-wrap" class="modul-pole modul-pole-glowne">', None, None),
    ("R5/audio-display", "Audio: widoczne pola bez sztywnego display:block (uklad z CSS)",
     "var sw=document.getElementById('au-source-wrap'); if(sw) sw.style.display=(t==='transcription')?'none':'';", None, None),
    ("R5/formaty-karty", "formaty grafiki jako karty z ksztaltem kadru, nazwa i wymiarem",
     "btn.innerHTML = '<span class=\"img-fmt-ksztalt\" aria-hidden=\"true\"></span>", "btn.textContent = fmt.labelKey ? _t(fmt.labelKey) : fmt.label;", None),
    ("R5/grafika-podsumowanie", "stopka grafiki: format, jakosc i zwykly czas; ramka podgladu w proporcjach formatu",
     "function imgPodsumowanie() {", None, None),
    ("R5/grafika-historia", "poprzednie grafiki: miniatura jako przycisk, pobieranie obok (bez pisma 9 px)",
     '<button type="button" class="img-hist-podglad" onclick="imgLoadFromHistory(', "font-size:9px;color:var(--text3)", None),
    ("R5/glosy-zwijka", "Audio: model i glosy mowcow w zwijce ze skrotem wyboru",
     "function audioPodsumujGlosy(){", None, None),
    ("R5/glosy-etykiety", "Audio: glosy mowcow obok siebie z etykieta pola (bez pisma 11 px)",
     '<label for="au-voice-\'+i+\'" class="au-glos-etykieta">', 'font-size:11px;color:var(--text3);margin:6px 0 4px', None),
    ("R5/audio-historia", "historia audio: wpis jako przycisk, rodzaj ze slownika zamiast surowej wartosci",
     "_t('au-typ-'+e.type)", "'<div class=\"au-hist-item\" onclick=\"audioHistLoad('", None),
    ("R5/odtwarzacz", "pasek odtwarzania w doku akcji pod skryptem",
     "document.getElementById('au-odtwarzacz')||document.getElementById('au-result-wrap')", None, None),
    ("R5/audio-telefon", "telefon: po wygenerowaniu skryptu przewiniecie do wyniku pod formularzem",
     "function audioPokazWynik(){", None, None),
    ("R5/jakosc-opis", "napis postepu grafiki z nazwa jakosci ze slownika (nie 'medium')",
     "• jakość ${jakoscOpis}", "• jakość ${quality}", None),
    ("R5/ref-i18n", "brak podgladu grafiki referencyjnej: komunikat ze slownika",
     "_t('img-ref-brak-podgladu')", "Podglad niedostepny - URL zostanie uzyty", None),
    ("R5/spinner-grafiki", "generowanie grafiki: ramka w ksztalcie formatu z widocznym znakiem ladowania",
     '<div id="img-spinner" class="img-ramka img-ramka-trwa" style="display:none">', None, None),
]

# R6-F: runda 6, wykonawca F - poprawki z audytu E poza Lukami (notatki o lukach, Wstecz na telefonie,
# Fakty ze stronami z sieci, zapytania w toku, statystyki = eksport, polski sklad, regula frazy).
# Osobna lista doklejana do KONTROLE, zeby nie zderzala sie z podpisami koordynatora przy scalaniu.
KONTROLE += [
    ("R6-F/notatka-z-tekstem", "E-02: notatka o luce z tekstem autora zostaje w eksporcie (bez data-brak)",
     "  // R6-F (E-02): tekst autora wpisany w notatke zostaje w pliku (bez data-brak).\n  zdejmijNotatkiZTekstem(kopia);", None, None),
    ("R6-F/notatka-edycja", "E-02: w trybie Edytuj akapit, ktory przestal byc notatka (takze z Entera), traci data-brak",
     "  zdejmijNotatkiZTekstem(this);\n  clearTimeout(licznikPoprawek);", None, None),
    ("R6-F/notatka-komunikat", "E-02/E-17: komunikat o pominietych notatkach jako ostrzezenie, z instrukcja",
     "pokazPowiadomienie(_t('eksport-pominiete-luki').replace('{n}', String(luki)), 'uwaga');",
     "pokazPowiadomienie(_t('eksport-pominiete-luki').replace('{n}', String(luki)), 'info');", None),
    ("R6-F/wstecz-arkusz", "E-04: telefon - Wstecz przy otwartym arkuszu zamyka arkusz zamiast cofac strone",
     "H.pushState({ cai: 'arkusz' }, '');", None, None),
    ("R6-F/fakty-siec", "E-07: Fakty przy pustej Bazie porownuja artykul ze stronami z sieci",
     "if (!zrodla.trim() && !sieciowe.length) {", None, None),
    ("R6-F/fakty-fragmenty", "E-07: cytowane fragmenty stron zapamietane przy zrodle (bez duplikatow, z limitem)",
     "if (frag && wpis.fragmenty.length < 8 && wpis.fragmenty.indexOf(frag) < 0) wpis.fragmenty.push(frag);", None, None),
    ("R6-F/fakty-dopisek", "E-07: panel Fakty mowi, ze sprawdzono wzgledem stron z sieci",
     "if (stan === 'gotowe' && faktyWzgledemSieci) {", None, None),
    ("R6-F/fakty-w-toku", "E-10: powrot na Fakty w trakcie kontroli czeka na nia (bez drugiego zapytania)",
     "if (!wymus && faktyWToku && faktyWToku.przebieg === faktyPrzebieg && faktyWToku.sygnatura === sygnatura) {", None, None),
    ("R6-F/oceny-w-toku", "E-10: SEO i AIO - ta sama ocena w toku wspolna (jedna platna ocena)",
     "const wpis = await ocenaWToku('seo', currentHash, zapytaj);", None, None),
    ("R6-F/zakladka-hidden", "E-12: zakladka inspektora z hidden naprawde znika (SERP bez danych)",
     ".ins-zakl[hidden], .ins-oceny [data-ins-ocena][hidden] { display: none; }", None, None),
    ("R6-F/linki-baza-serwer", "E-13: sugestie linkow biora adresy takze z Bazy na serwerze",
     "(window._bazaSerwer || []).forEach(function (d) {", None, None),
    ("R6-F/baza-url", "E-13: adres strony wysylany osobnym polem do /api/baza",
     "body: JSON.stringify({ zakres: 'prywatna', nazwa: nazwa, tresc: tresc, url: url || '' })", None, ("proxy",)),
    ("R6-F/statystyki-eksport", "E-14: statystyki, FOG i KD liczone z tego, co wyjdzie w pliku (bez notatek, zrodel, meta)",
     "const fog = calcFog(tekstProzy(tresc));", "const fog = calcFog(tekstProzy(tmp));", None),
    ("R6-F/historia-slowa", "E-14: liczba slow wpisu Historii jak w pasku statystyk",
     "wpis.words = liczbaSlowArtykulu(art);", "wpis.words = (art.innerText || '').split(/\\s+/).filter(Boolean).length;", None),
    ("R6-F/aeo-odmiana", "E-17: AEO z odmiana liczebnika (naglowki-pytania, slowa)",
     "text: _tn('aeo-faq', qH2.length)", "_t('aeo-faq').replace('{n}', qH2.length)", None),
    ("R6-F/geo-etykiety", "E-17: etykiety GEO opisuja to, co computeGeo liczy (bez JSON-LD i FAQPage)",
     "'geo-skladnik-struktura':'Struktura: H1, sekcje H2, pytania, lista'", "'geo-faq':'Sekcja FAQ pasująca do schematu FAQPage'", None),
    ("R6-F/popraw-lepki", "E-17: telefon - Popraw pod brakujace tematy przyklejony do dolu arkusza",
     "body.is-mobile .ins-tresc #gap-improve-btn { position: sticky; bottom: 0;", None, None),
    ("R6-F/twarde-spacje", "E-18: polski sklad - twarda spacja po wyrazach jednoliterowych w PDF, DOCX i TXT",
     "await pobierzDocx(twardeSpacjePl(kopia), opcje, nazwa);", None, None),
    ("R6-F/pdf-krotkie-akapity", "E-18: krotkie akapity PDF w calosci na jednej stronie",
     "akapitPdf.unbreakable = true;", None, None),
    ("R6-F/regula-frazy", "E-19: fraza kluczowa nie jako sztuczny podmiot zdania (generowanie i poprawa samokorekty)",
     "system: editorSysPelny + '\\n' + REGULA_FRAZY_PODMIOTU,", None, None),
    # Runda 7 (koordynator): Luki, adresat tekstu, tytuly zrodel
    ("R7/luki-wynik-od-razu", "wynik Luk po poprawie od razu, bez ponownej analizy calego tekstu",
     "const wynikPo = { msg: _t('gap-po-poprawie'), present: [], missing: [] };", None, None),
    ("R7/luki-blokada-wyboru", "zaznaczenia tematow zablokowane na czas poprawy",
     "const blokuj = (tak) => document.querySelectorAll('#gap-missing .gap-miss-check, #gap-missing-wrap .btn-maly')", None, None),
    ("R7/luki-konkurencja", "tematy o marce konkurencji domyslnie odznaczone, z plakietka",
     "gapKonkurencja = dopasujDoSerp(odp.competitors, tematy);", None, None),
    ("R7/luki-dlugosc-sekcji", "nowe sekcje zwiezle (120-200 slow), artykul nie puchnie ponad czolowke",
     "Keep each new section concise: about 120-200 words", None, None),
    ("R7/jeden-adresat", "jeden adresat w calym tekscie (wlasciciel sklepu albo klient, nie na zmiane)",
     "- Keep ONE addressee for the whole text", None, None),
    ("R7/tytul-zrodla", "tytul zrodla bez \"Strona 1 z 7\" z naglowka PDF",
     ".replace(/^\\s*(?:strona|page|seite)\\s+\\d+\\s+(?:z|of|von)\\s+\\d+\\s*[-:|]?\\s*/i, '')", None, None),
    # R7-H (runda 7, wykonawca H): pasek wyniku na komputerze w jednym wierszu, bez plakietki na pustym ekranie.
    ("R7-H/pasek-jeden-wiersz", "komputer: pasek wyniku nie zawija sie do drugiego wiersza",
     "body:not(.is-mobile) .output-bar { flex-wrap: nowrap; }", None, None),
    ("R7-H/ikony-po-kolei", "brak miejsca: przyciski paska traca podpisy po jednym, od najmniej waznego (nie wszystkie ponizej 1280 px)",
     "const ZWIJANE = ['#copy-btn', '#grupa-tworz-wrap > .btn-secondary', '#grupa-ocen-wrap > .btn-secondary',",
     "body:not(.is-mobile) .pasek-akcje > .btn-secondary span { font-size: 0; }", None),
    ("R7-H/pasek-jak-kartka", "krawedzie paska wyniku na krawedziach kartki artykulu",
     "html.style.setProperty('--kolumna-paska', kol);", None, None),
    ("R7-H/bez-plakietki-pusty", "pusty ekran bez 'gotowy do generowania' i bez pustego paska wyniku",
     'body:not(.is-mobile) #out-badge[data-i18n="badge-ready"] { display: none; }', None, None),
    ("R7-H/plakietka-kropka", "plakietka tylko dla stanow wartych uwagi (generowanie, blad, przerwane) z kropka; gotowe dla czytnika",
     'body:not(.is-mobile) #out-badge:is(.ready, [data-i18n="badge-done"]) { position: absolute;', None, None),
    ("R7-H/wersje-komputer", "komputer: dwie wersje jako Przed | Po, od trzech lista wyboru (#ver-select jak na telefonie)",
     "body:not(.is-mobile) .versions-bar.wiele-wersji .ver-wybor {", None, None),
]

# R9-F: runda 9, wykonawca F - poprawki aplikacji z audytu kodu rundy 8 (KOD8-NN).
# Osobny blok w srodku listy (D i G dopisuja swoje na koncu - scalanie po liniach bez konfliktu).
KONTROLE += [
    ("R9-F/fokus-okna-tekstu", "KOD8-03: okno tekstu bez opoznionego focus() (tekst Tresci nie trafia do pola nazwy)",
     "function openTextModal() { document.getElementById('text-modal').classList.add('open'); bladPolaTekstu(null); }",
     "setTimeout(()=>document.getElementById('m-name').focus(),80)", None),
    ("R9-F/fokus-okna-adresu", "KOD8-03: okno adresu strony bez opoznionego focus()",
     None, "setTimeout(() => document.getElementById('u-url').focus(), 80);", None),
    ("R9-F/pusta-tresc", "KOD8-03: Dodaj bez nazwy albo tresci - komunikat przy polu zamiast cichego powrotu",
     "bladPolaTekstu(document.getElementById(name ? 'm-content' : 'm-name'), name ? 'text-brak-tresci' : 'text-brak-nazwy');", None, None),
    ("R9-F/brama-ponowienie", "KOD8-07: 502/503/504 bramy bez JSON-a w oknie restartu = zerwane polaczenie, to samo zadanie ponowione",
     "if (!odpowiedzBramy(res) || bramaMs >= 60000) return res;", None, None),
    ("R9-F/historia-scalanie", "KOD8-09: zapis Historii scala liste z magazynem (druga karta tego konta), bez nadpisywania",
     "if (scalHistorieZMagazynem()) { try { renderHistory(); } catch (e) {} }", None, None),
    ("R9-F/historia-storage", "KOD8-09: zmiana Historii w innej karcie trafia do tej karty (zdarzenie storage)",
     "window.addEventListener('storage', function (e) {", None, None),
    ("R9-F/historia-usuniete", "KOD8-09: usuniety wpis nie wraca z listy innej karty",
     "if (h.id) oznaczUsunietyWpis(h.id);", None, None),
    ("R9-F/pause-turn-ciag", "KOD8-13: tura po pause_turn deklarowana jako artykul-ciag (nie drugi artykul z pakietu)",
     "if (h['x-cai-czynnosc'] === 'artykul') h['x-cai-czynnosc'] = 'artykul-ciag';", None, ("proxy",)),
    ("R9-F/artykul-w-toku-zapis", "KOD8-30: identyfikator zadania artykulu i brief zapamietane w karcie do konca generowania",
     "zapiszArtykulWToku(naglowkiArtykulu['X-Zadanie'], topic, frazy,", None, ("proxy",)),
    ("R9-F/artykul-w-toku-odbior", "KOD8-30: po ubiciu karty albo przeladowaniu aplikacja odbiera artykul z zadania na serwerze",
     "window.addEventListener('load', function () { setTimeout(odbierzArtykulWToku, 400); });", None, ("proxy",)),
    ("R9-F/zadanie-po-429", "KOD8-30: ponowienie po 429 jako nowe zadanie (nie zapamietane 429 pod tym samym identyfikatorem)",
     "delete options.headers['X-Zadanie'];", None, None),
    ("R9-F/fakty-baza-serwera", "KOD8-17: Fakty dla artykulu z Historii (i po odswiezeniu) pobieraja fragmenty Bazy na serwerze",
     "ostatniaWiedzaSerwera = await wiedzaZSerwera(ka.frazy && ka.frazy.length ? ka.frazy.join(', ') : (ka.temat || ka.h1));", None, ("proxy",)),
    ("R9-F/widocznosc-blad-api", "KOD8-22: Widocznosc AI - blad API zapytania niesie powod (nie 'marki nie ma')",
     "if (!res.ok || (data && data.error)) throw bladOdpowiedzi(data, res.status);", None, None),
    ("R9-F/widocznosc-same-bledy", "KOD8-22: Widocznosc AI - same bledy: komunikat z powodem, bez wyniku 0 i bez zapisu do historii pomiarow",
     "document.getElementById('vis-results').innerHTML = blokBledu(ostatniBlad || new Error(_t('vis-blad-wszystkie')), 'runVisibility()');", None, None),
    ("R9-F/widocznosc-mianownik", "KOD8-22: Widocznosc AI - nieudane zapytania poza mianownikiem wyniku",
     "results = (results || []).filter(r => r && !r.error);", None, None),
    ("R9-F/transkrypcja-limit", "KOD8-16: transkrypcja - plik ponad 25 MB zatrzymany przed wyslaniem z jasnym komunikatem",
     "if (file && file.size > LIMIT_PLIKU_TRANSKRYPCJI) throw new Error(_t('err-transkrypcja-za-duzy')", None, None),
    ("R9-F/transkrypcja-zadanie", "KOD8-16: transkrypcja przez zadanie w tle (zerwane polaczenie nie gubi wyniku)",
     "var res = await fetchZadania(OPENAI_STT_ENDPOINT, { method: 'POST', headers, body: fd });", None, None),
    ("R9-F/baza-dlugi-pytanie", "KOD8-11: dokument dluzszy niz miesci Baza na serwerze - pytanie przed dodaniem, ile zostanie zapisane",
     "if (tresc.length > limit && !window.confirm(tekst('kb-dlugi-pytanie', '')", None, ("proxy",)),
    ("R9-F/baza-uciety", "KOD8-11: po zapisie informacja o ucieciu dokumentu (uciety z serwera albo z liczby fragmentow)",
     "var uc = dokumentUciety(w.dane, tresc.length);", None, ("proxy",)),
    ("R9-F/animacje-waapi", "KOD8-14: animacje wejscia pol przez Web Animations API, bez offsetWidth na kazdym polu",
     "el._cinAnim=el.animate(KLATKI[m[1]],{duration:parseFloat(m[2])*1000,delay:(opoznienie||0)*1000,easing:m[3],fill:m[4]?'backwards':'none'});",
     "function anim(el,css){ if(el){ el.style.animation='none'; void el.offsetWidth; el.style.animation=css; } }", None),
    ("R9-F/inspektor-telefon", "KOD8-14: odswiezInspektor na telefonie bez odczytu innerWidth (wymuszony uklad przy starcie)",
     "sredni = !b.classList.contains('is-mobile') && window.innerWidth >= 1280 && window.innerWidth < 1440;", None, None),
    ("R9-F/temat-limit", "KOD8-25: temat najwyzej 300 znakow z podpowiedzia o Dodatkowych wytycznych",
     "pole.addEventListener('input', function () { podpowiedzTematu(pole.value.length >= LIMIT_TEMATU ? 'topic-za-dlugi' : null); });", None, None),
    ("R9-F/temat-pusty", "KOD8-25: pusty temat - komunikat przy polu zamiast samego fokusu",
     "podpowiedzTematu('topic-pusty'); // R9-F (KOD8-25)", None, None),
    ("R9-F/historia-temat-2-linie", "KOD8-25: temat wpisu Historii najwyzej w dwoch liniach",
     "#h-list-inner .h-item-topic { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;", None, None),
    ("R9-F/cms-utf8", "KOD8-29: naglowek Basic CMS w UTF-8 (polskie litery w loginie bez wyjatku btoa)",
     "const creds = base64Utf8(`${drupalSettings.user}:${drupalSettings.pass}`);", "const creds = btoa(`${drupalSettings.user}:${drupalSettings.pass}`);", None),
    ("R9-F/cms-https", "KOD8-29: adres CMS bez schematu dostaje https://, bez /wp-admin i ukosnikow",
     "wpSettings = { url: normalizujAdresCms(document.getElementById('wp-url').value),", None, None),
    ("R9-F/pdf-ladowanie", "KOD8-32: pierwszy PDF - komunikat od razu i jedno pobranie mimo kolejnych dotkniec w trakcie ladowania",
     "if (czekajacy.length) return; // ladowanie trwa: kolejne dotkniecie nie robi drugiego pliku", None, None),
    ("R9-F/luki-pakiet", "KOD8-33: Luki w pakiecie bez SERP - od ktorego pakietu sa dostepne, z przejsciem do pakietow",
     "escapeHtml(_t('gap-serp-pakiet'))", None, ("proxy",)),
    ("R9-F/czekam-na-siec", "KOD8-34: czekanie na siec widoczne w spinnerze (licznik etapow go nie nadpisuje)",
     "sp.classList.toggle('czeka-na-siec', czekamNaSiec.n > 0);", None, None),
    ("R9-F/baza-bez-sieci", "KOD8-34: wyszukiwanie w Bazie bez sieci czeka na polaczenie (artykul nie powstaje po cichu bez wiedzy)",
     "if (proba > 0 || typeof czekajNaPowrot !== 'function') return '';", None, ("proxy",)),
    ("R9-F/prompt-zrodla-serwera", "KOD8-19: prompt artykulu liczy fragmenty z Bazy na serwerze jako zrodla (nie 'You have 0 knowledge source(s)')",
     "const userPrompt = `You have ${activeDocs.length + fragmentySerwera} knowledge source(s):",
     "const userPrompt = `You have ${docs.length} knowledge source(s):", None),
    ("R9-F/brief-baza-serwera", "KOD8-18: brief z wiedza z Bazy na serwerze i w jezyku artykulu",
     "const kbText = await wiedzaDoPomocnika(topic, 3000);",
     "const kbText = docs.filter(d=>d.selected).map(d=>d.content).join('\\n').substring(0, 3000);", None),
    ("R9-F/brief-jezyk-tekstu", "KOD8-18: brief w jezyku tekstu (pole Jezyk tekstu), nie interfejsu",
     "All text MUST be in ' + jezykDlaModelu(document.getElementById('lang').value) + '.' + blokDaty(),", None, None),
    ("R9-F/tematy-baza-serwera", "KOD8-18: Podpowiedz tematy - pole Bazy i wiedza takze z Bazy na serwerze",
     "wiedza = await wiedzaDoPomocnika(opis, 3000);", None, None),
    ("R9-F/llms-baza-serwera", "KOD8-18: llms.txt - strony i kontekst z Bazy na serwerze, naglowki w jezyku tekstu",
     "document.getElementById('llms-out-full-ta').value = buildLlmsFullTxt(cfg, urls, zSerwera);", None, None),
    ("R9-F/widocznosc-rynek", "KOD8-23: Widocznosc AI - rynek i jezyk z pola Jezyk tekstu (nie 'Polish market' na sztywno)",
     "recommendation query for ' + rynekWidocznosci() + '. Use web search", "recommendation query for the Polish market.", None),
    ("R9-F/narracja-jezyk", "KOD8-23: Narracja marki w jezyku tekstu (nie 'in Polish' i 'Opowiedz o marce' na sztywno)",
     "120 to 180 words, in ' + jezykNarracji + ', plain text only", "120 to 180 words, in Polish, plain text only", None),
    ("R9-F/narracja-baza-serwera", "KOD8-23: Narracja porownuje z Baza na serwerze, blad API z powodem",
     "out.innerHTML = blokBledu(e, 'runNarrative()', 'vis-blad-narracji');", None, None),
    ("R9-F/baza-sesja-lista", "KOD8-10: wygasla sesja - lista Bazy mowi o sesji zamiast 'Brak dokumentow' i nie zeruje licznika",
     "if (odpBazy.status === 401) {", None, ("proxy",)),
    ("R9-F/baza-sesja-dodanie", "KOD8-10: dodanie dokumentu przy wygaslej sesji - komunikat z 'Zaloguj sie', bez cichego zapisu lokalnego",
     "var toast = pokazPowiadomienie(tekst('kb-sesja-wygasla', ''), 'blad', 15000);", None, ("proxy",)),
    ("R9-F/koszt-cennik-wersji", "KOD8-31: cennik modelu po przedrostku nazwy (nazwa wersji z data jak alias)",
     "const cennik = cennikModelu(dane.model);", "const cennik = CENY_MODELI[dane.model] || CENY_MODELI['claude-sonnet-5'];", None),
    ("R9-F/koszt-wyszukiwania", "KOD8-31: wyszukiwania w sieci wliczone do szacowanego kosztu",
     "return (we * cennik[0] + wy * cennik[1]) / 1e6 + wyszukiwania * CENA_WYSZUKIWANIA;", None, None),
    ("R9-F/koszt-transkrypcji", "KOD8-31: koszt transkrypcji z dlugosci nagrania",
     "dlugoscNagrania(file).then(function (s) { if (s) dodajKoszt('openai', s / 60 * CENA_TRANSKRYPCJI_MIN); });", None, None),
    ("R9-F/koszt-szacunek", "KOD8-31: etykieta kosztu na wlasnych kluczach mowi, ze to szacunek",
     "'hist-cost-wlasne':'Szacunkowy koszt na Twoich kluczach'", "'hist-cost-wlasne':'Koszt na Twoich kluczach'", None),
    ("R9-F/pdf-bez-emoji", "KOD8-35: emoji wypadaja z tekstu PDF (kroje nie maja tych znakow, zostawal pusty znak)",
     "const t = n.nodeValue.replace(EMOJI_PDF, '').replace(/[ \\t\\n\\r\\f]+/g, ' ');",
     "const t = n.nodeValue.replace(/[ \\t\\n\\r\\f]+/g, ' ');", None),
    ("R9-F/glos-marki-podpis", "KOD8-28: podpis Glosu marki w menu ze slownika (nie polski na sztywno, po zmianie jezyka dalej 'aktywny')",
     "ustawTekst(sub, 'settings-bv-active');", "sub.textContent = 'Aktywny - profil stylu ustawiony';", None),
    ("R9-F/glos-marki-podpis-en", "KOD8-28: klucz settings-bv-active w slowniku EN",
     "'settings-bv-active':'Active - style profile set',", None, None),
]

# R7-I: runda 7, wykonawca I - panel Faktow (jeden stan ladowania, adres jako link, notka zgodna
# z siecia, kategoria "Sprawdz na stronie", lista zrodel i ramka meta poza kontrola).
# Osobny blok na koncu listy podpisow aplikacji (scalanie po liniach z innymi wykonawcami).
KONTROLE += [
    ("R7-I/fakty-bez-czesciowych", "Fakty: jeden stan ladowania do konca, bez czesciowego licznika i listy odnosnikow",
     "let trescGotowa = false, linkiGotowe = false;", "if (u.length) pokazWynikFaktow(u, 'czesciowe');", None),
    ("R7-I/fakty-w-toku-najpierw", "Fakty: kontrola w toku przed zapamietanym wynikiem (bez starej listy w trakcie)",
     "    ladowanie.style.display = 'block';\n    return;\n  }\n  if (!wymus && faktyWynik && faktySygnatura === sygnatura) {", None, None),
    ("R7-I/fakty-adres-link", "Fakty: adres w uwadze jako link (host i skrocona sciezka), nie URL kursywa w cudzyslowie",
     "? '<div class=\"fakty-adres\" style=\"margin:3px 0\">' + linkUwagi(cytat.trim()) + '</div>'", None, None),
    ("R7-I/fakty-link-karta", "Fakty: link w uwadze otwiera nowa karte (target _blank, rel noopener)",
     "'\" target=\"_blank\" rel=\"noopener\" title=\"' + escapeHtml(tytul || adres) + '\">'", None, None),
    ("R7-I/fakty-notka-siec", "Fakty: notka 'z wyszukiwaniem' tylko przy stronach z sieci, inaczej wariant bez stron",
     "} else if (stan === 'gotowe' && trybUzupelniania && stronZSieci > 0) {", None, None),
    ("R7-I/fakty-tryb-promptu", "Fakty: tryb promptu 'z siecia' tylko, gdy byly strony z sieci",
     "const zSiecia = trybUzupelniania && sieciowe.length > 0;", None, None),
    ("R7-I/fakty-strona-prompt", "Fakty: prompt wie, ze cytowane fragmenty stron sa niepelne (kategoria strona)",
     "'whole pages: a detail missing from an excerpt is NOT evidence that the page lacks it. '", None, None),
    ("R7-I/fakty-strona-adres", "Fakty: 'Sprawdz na stronie' z adresem wylacznie z listy stron z sieci",
     "if (z) { kopia.rodzaj = 'strona'; kopia.adres = z.url; kopia.tytulStrony = nazwaZrodla(z.tytul, z.url); }", None, None),
    ("R7-I/fakty-waga", "Fakty: kolejnosc wagi - 'Sprawdz na stronie' i niesprawdzony adres na koncu listy",
     "const WAGA_UWAG = { strona: 1, 'link-niesprawdzony': 2 };", None, None),
    ("R7-I/fakty-slownik", "Fakty: nowa kategoria i warianty notki w slowniku PL",
     "'fakty-rodzaj-strona':'Sprawdź na stronie',", None, None),
    ("R7-I/fakty-bez-listy-zrodel", "Fakty: lista zrodel aplikacji, ramka meta i notatki o lukach poza kontrola",
     "const tekstArtykulu = tekstBlokami(kopiaDoStatystyk(art));", "const tekstArtykulu = art.innerText || art.textContent || '';", None),
    # Poprawka pilna: OpenAI wylacza gpt-image-1 23.10.2026
    ("PILNE/model-grafik", "grafiki na modelu, ktory OpenAI utrzymuje po 23.10.2026 (gpt-image-1 wylaczany)",
     "const MODEL_GRAFIKI = 'gpt-image-2.5-flare';", "model:          'gpt-image-1',", None),
    ("PILNE/typ-grafiki", "plik i schowek grafiki z prawdziwym typem obrazu (PNG, JPEG albo WebP)",
     "const typ = (ia[0] === 0xFF && ia[1] === 0xD8) ? 'image/jpeg'", None, None),
    ("PILNE/kreator-bez-pol", "kreator na koncie z kluczami serwera przechodzi przez krok kluczy (UX8-01)",
     "    if (!el('start-k-anthropic')) return true;", None, ("proxy",)),
]

# R9-G: runda 9, wykonawca G - aplikacja zrozumiala dla nowej osoby (UX8-11 do UX8-16 z raportu agencja-ux
# rundy 8). Osobny blok na koncu listy podpisow aplikacji (scalanie po liniach z innymi wykonawcami).
KONTROLE += [
    ("R9-G/siec-dla-pustej-bazy", "UX8-14: przy pustej bazie wiedzy Szukaj w sieci wlaczone od wejscia (do recznej zmiany), z dopiskiem",
     "if (pusta && !w.checked) { w.checked = true; siecWlaczonaDlaPustej = true; }", None, None),
    ("R9-G/siec-dopisek", "UX8-14: dopisek o pustej bazie przy przelaczniku sieci (PL)",
     "'toggle-web-hint-pusta':'Twoja baza wiedzy jest pusta, więc AI oprze tekst na stronach z sieci", None, None),
    ("R9-G/siec-po-dokumencie", "UX8-14: siec wlaczona dla pustej bazy wylacza sie po dodaniu dokumentu (defaultChecked dopiero po stanie)",
     "else if (!pusta && siecWlaczonaDlaPustej) { w.checked = false; siecWlaczonaDlaPustej = false; }\n  }\n"
     "  // Po ustawieniu stanu (inaczej sama zmiana defaultChecked przestawia jeszcze nieruszony przelacznik).\n  w.defaultChecked = pusta;",
     "const pusta = liczbaDokumentow() === 0;\n  w.defaultChecked = pusta;", None),
    ("R9-G/bez-zrodel", "UX8-14: okno Brak zrodel wiedzy ma trzecie wyjscie (bez zrodel) z ostrzezeniem",
     're:onclick="noSourceBezZrodel\\(\\)"[^>]*aria-describedby="no-source-bez-uwaga"', None, None),
    ("R9-G/dodaj-zrodlo-otwiera-baze", "UX8-14: Dodaj zrodla do bazy wiedzy otwiera baze (takze zwinieta na komputerze)",
     "  // R9-G (UX8-14): na komputerze baza bywa zwinieta - przewiniecie do ukrytego panelu nic nie pokazywalo.\n  otworzBazeWiedzy();",
     "if (kb) kb.scrollIntoView({ behavior: 'smooth' });", None),
    ("R9-G/kroki-startu", "UX8-14: pusty ekran: najpierw temat i Wygeneruj, potem materialy firmy",
     "'start-krok-1':'Wpisz temat i słowa kluczowe w briefie.',",
     "'start-krok-1':'Dodaj do bazy wiedzy pliki, strony albo notatki o firmie.',", None),
    ("R9-G/opis-oceny", "UX8-11: pod przelacznikiem SEO/AIO/AEO/GEO jedno zdanie, co mierzy wybrana ocena",
     "if (opisOceny) opisOceny.textContent = gr === 'ocena' ? _t('ocena-opis-' + otwarty) : '';", None, None),
    ("R9-G/opisy-ocen", "UX8-11: przyciski ocen z podpowiedzia (jedno zdanie, PL i EN)",
     "'ocena-opis-geo':'GEO: whether AI chats such as ChatGPT or Perplexity will cite the text and your brand as a source (nothing to do with geolocation).',",
     None, None),
    ("R9-G/opis-typu", "UX8-11: jedno zdanie pod Typem tresci dla typow SEO, AIO i Hybrydy",
     "const kluczOpisu = { 'Hybryda SEO + AIO': 'ctype-opis-hybryda', 'Artykuł SEO': 'ctype-opis-seo', 'Treść AIO': 'ctype-opis-aio' }[sel.value];", None, None),
    ("R9-G/filtry-historii", "UX8-11: filtry Historii SEO, AIO, Hybryda z podpowiedzia",
     'data-i18n-title="ctype-opis-aio"', None, None),
    ("R9-G/widocznosc-telefon", "UX8-13: Widocznosc AI (cztery narzedzia) w arkuszu Konto na telefonie",
     '<div class="menu-tel-widocznosc">', None, None),
    ("R9-G/widocznosc-tylko-telefon", "UX8-13: kopia grupy w menu konta ukryta na komputerze (tam jest gorny pasek)",
     "body:not(.is-mobile) .menu-tel-widocznosc { display: none; }", None, None),
    ("R9-G/fokus-menu-konta", "UX8-13: fokus menu konta na pierwszej widocznej pozycji",
     "const p = [...menu.querySelectorAll('.settings-item')].find(function (x) { return x.offsetParent !== null; });",
     "const p = menu.querySelector('.settings-item'); if (p) p.focus", None),
    ("R9-G/widocznosc-nazwy", "UX8-13: podpis 'po co' przy narzedziach Widocznosci AI, okna nazwane jak pozycje menu",
     "'aiv-modal-title':'Cytowania w AI',", "'aiv-modal-title':'Widoczność w AI (AEO/GEO)',", None),
    ("R9-G/openseo-telefon", "UX8-13: OpenSEO tez w arkuszu Konto na telefonie",
     "var pozTel = document.getElementById('openseo-item-tel');", None, ("proxy",)),
    ("R9-G/nazwa-plan", "UX8-12: narzedzie z menu Wiecej zadan to Plan artykulu (formularz zostaje Brief)",
     "'btn-brief':'Plan artykułu',", "'brief-title':'Brief artykułu'", None),
    ("R9-G/nazwa-plan-menu", "UX8-12: pozycja menu Plan artykulu tlumaczona ze slownika (wczesniej sztywne 'Brief')",
     'data-i18n-title="title-brief-tooltip" data-i18n="btn-brief">', None, None),
    ("R9-G/nazwa-popraw-wklejony", "UX8-12: wklejony tekst poprawia 'Popraw wklejony tekst' (menu, karta startu, okno)",
     "'btn-improve':'Popraw wklejony tekst',", "'improve-title':'Popraw istniejący artykuł'", None),
    ("R9-G/nazwa-popraw-ten-tekst", "UX8-12: samokorekta gotowego tekstu to 'Popraw ten tekst' (wczesniej Dopracuj tekst)",
     "'btn-premium-fix':'Popraw ten tekst',", "'btn-premium-fix':'Dopracuj tekst'", None),
    ("R9-G/nazwa-dopisz-tematy", "UX8-12: Luki dopisuja brakujace tematy (przycisk i nazwa wersji)",
     "'improve-by-gaps':'Dopisz brakujące tematy',", "'ver-serp':'Poprawa SERP'", None),
    ("R9-G/nazwa-grafika-audio", "UX8-12: panele Grafika i Audio nazwane jak pozycje menu",
     "'img-title':'Grafika',", "'img-title':'Generator grafik'", None),
    ("R9-G/nazwa-baza", "UX8-12: Baza wiedzy jedna nazwa (panel, dolny pasek, menu konta, okno)",
     "'nav-base':'Baza wiedzy',", "'sidebar-title':'Baza wiedzy - źródła'", None),
    ("R9-G/nazwa-baza-opis", "UX8-12: okno bazy na serwerze nie mowi juz, ze pliki z panelu to inna baza",
     "'bazas-desc':'To ta sama baza wiedzy, którą widzisz w panelu", "Pliki wgrywane w panelu bocznym to co innego", ("proxy",)),
    ("R9-G/nazwa-czytanie", "UX8-12: czytanie artykulu na glos to 'Czytaj na glos', ustawienia 'Czytanie na glos i dyktowanie'",
     "'tts-read':'Czytaj na głos',", "'settings-voice-title':'Asystent głosowy'", None),
    ("R9-G/grafika-bez-ponawiania", "UX8-07: grafika nie ponawia bledu, ktorego ponowienie nie naprawi (brak klucza na serwerze)",
     "if (!czyPonowic(bladOdpowiedzi(podglad, imgRes.status, 'OpenAI'))) break;", None, None),
    ("R9-G/przyklad-artykulu", "UX8-24: przykladowy artykul z ocenami i kontrola faktow bez klucza (okno tylko do odczytu)",
     '<div class="overlay" id="przyklad-modal" onclick="if(event.target===this)zamknijPrzyklad()">', None, None),
    ("R9-G/przyklad-wejscie", "UX8-24: link do przykladu na pustym ekranie Pisz",
     'onclick="otworzPrzyklad()" data-i18n="przyklad-link"', None, None),
    ("R9-G/przyklad-fokus", "UX8-24: okno przykladu przyjmuje fokus na sobie (czytnik czyta tytul, strzalki przewijaja tekst)",
     "requestAnimationFrame(function () { const d = document.querySelector('#przyklad-modal .modal'); if (d) d.focus({ preventScroll: true }); });",
     None, None),
    ("R9-G/historia-lokalnie", "UX8-16: Historia mowi, ze jest zapisana tylko w tej przegladarce",
     '<div class="hist-lokalnie" id="hist-lokalnie">', None, None),
    ("R9-G/nazwy-okien", "UX8-15: okna z tytulem w .tekst-tytul (baza, frazy OpenSEO, pakiet) dostaja aria-labelledby",
     "const t = d.querySelector('h1, h2, h3, [class*=\"title\"], .tekst-tytul');",
     "const t = d.querySelector('h1, h2, h3, [class*=\"title\"]');", None),
    ("R9-G/kreator-nazwa", "UX8-15: kreator nazwany tytulem kroku, postep 'Krok n z m' tekstem",
     '<div class="modal okno-panel" style="width:560px" aria-labelledby="start-tytul" aria-describedby="start-postep">', None, ("proxy",)),
    ("R9-G/kreator-fokus", "UX8-15: fokus kreatora na tytule kroku, nie na 'Pomin kreator'",
     "if (tytulKroku && el('start-modal').style.display === 'flex') tytulKroku.focus({ preventScroll: true });", None, ("proxy",)),
    ("R9-G/postep-czytnik", "UX8-15: postep generowania w regionie aria-live, aria-busy artykulu, 'Artykul gotowy' na koniec",
     "region.id = 'gen-postep-sr'; region.className = 'sr-only';", None, None),
    ("R9-G/historia-kopia", "UX8-16: kopia Historii do pobrania (HTML z artykulami i danymi wpisow w JSON)",
     "dok += '<' + 'script type=\"application/json\" id=\"content-ai-historia\">' + dane + '<' + '/script></body></html>';", None, None),
]

# ── runda 9, wykonawca D: oznaczenia AI w eksportach, konto, klucze BYOK, pakiet i zakup ──
# Osobna lista doklejana na koncu (jak R3-D), zeby nie zderzala sie z grupami F i G przy scalaniu.
KONTROLE += [
    ('R9-D/stala-oznaczen', 'PR8-01: stala oznaczen AI w aplikacji (ta sama co serwer/oznaczenia.js, testy-oznaczenia.js)',
     'const OZNACZENIA_DOMYSLNE = {', None, None),
    ('R9-D/kopia-oznaczenie', 'kopiaDoEksportu(zrodlo, cel) dokleja oznaczenie AI do kopii dla klienta',
     'return dodajOznaczenieAI(kopia, cel);', None, None),
    ('R9-D/kopia-txt', "TXT z kopii z celem 'txt' (etykieta wedlug przelacznika)",
     "const kopia = kopiaDoEksportu(art, 'txt');", None, None),
    ('R9-D/kopia-docx', "DOCX z kopii z celem 'docx'",
     "const kopia = kopiaDoEksportu(art, 'docx');", None, None),
    ('R9-D/kopia-pdf', "PDF z kopii z celem 'pdf'",
     "const kopia = kopiaDoEksportu(art, 'pdf');", None, None),
    ('R9-D/etykieta-tekstu', 'PR8-19: widoczna etykieta tekstu jako p.oznaczenie-ai w jezyku artykulu',
     "p.className = 'oznaczenie-ai';", None, None),
    ('R9-D/etykieta-filtr', 'etykieta przechodzi przez filtr HTML (klasa i data-ai-label z listy aplikacji)',
     "const HTML_DATA = new Set(['data-brak', 'data-ai-label']);", None, None),
    ('R9-D/przelacznik-eksportu', 'M-5: przelacznik etykiety tekstu w menu Eksport',
     'id="ozn-tekst-btn" data-oznaczenie="tekst"', None, None),
    ('R9-D/docx-wlasciwosci', 'DOCX: wlasciwosci AI (docProps/custom.xml, cp:keywords) w opcjach generatora',
     'wlasciwosciAI: wlasciwosciAI(),', None, None),
    ('R9-D/pdf-slowa', 'PDF: /Keywords i DigitalSourceType w informacjach dokumentu',
     'if (ai) { info.keywords = ai.slowa; info.DigitalSourceType = ai.zrodlo; }', None, None),
    ('R9-D/pdf-xmp', 'PDF: pakiet XMP dopisany aktualizacja przyrostowa',
     'bajty = pdfZXmp(bajty, xmpAI(ai.zrodlo, ai.system));', None, None),
    ('R9-D/png-xmp', 'projekt 10.4: oznaczPng w imgResizeB64 (XMP z IPTC Digital Source Type w kazdej grafice)',
     "if (typ === 'image/png' && metadaneAI('grafika')) { resolve(new Blob([oznaczPng(ia).bajty], { type: typ })); return; }", None, None),
    ('R9-D/png-c2pa', 'PNG z manifestem C2PA dostawcy (caBX) zostaje nietkniety',
     "if (lista.some(function (f) { return f.typ === 'caBX'; })) return { bajty: b, zmieniony: false, powod: 'c2pa-dostawcy' };", None, None),
    ('R9-D/grafika-pytanie', 'D-08: przed pobraniem grafiki bez napisu pytanie o realne osoby, miejsca, zdarzenia',
     'id="ozn-grafika-modal"', None, None),
    ('R9-D/grafika-schowek', 'D-07: komunikat, ze kopia grafiki w schowku nie niesie oznaczenia',
     "if (oznaczeniaWlaczone()) pokazPowiadomienie(_t('ozn-grafika-schowek'), 'info', 9000);", None, None),
    ('R9-D/mp3-modul', 'projekt 10.4: zbudujMp3 przy sklejaniu MP3 (ID3v2.4 z oznaczeniem AI)',
     'AUDIO.blob=await zbudujMp3(blobs, mp3||opcjeMp3Artykulu());', "AUDIO.blob=new Blob(blobs,{type:'audio/mpeg'});", None),
    ('R9-D/mp3-podcast', 'projekt 10.4: zbudujMp3 takze w drugim miejscu sklejania MP3',
     'var full = await zbudujMp3(blobs, opcjeMp3Artykulu());', "var full = new Blob(blobs, { type: 'audio/mpeg' });", None),
    ('R9-D/zapowiedz-audio', 'M-5: zapowiedz glosowa na poczatku nagrania (domyslnie wlaczona)',
     'async function audioBuild(){ return audioBuildCore(zZapowiedziaAI(audioUnits(), jezykModuluAudio())', None, None),
    ('R9-D/glos-syntetyczny', 'przy lektorze i w module audio informacja, ze glos jest syntetyczny',
     'id="audio-bar-ai" data-i18n="ozn-audio-glos"', None, None),
    ('R9-D/info-artykul', 'art. 50 ust. 1: pod artykulem informacja, ze powstal z pomoca AI',
     'id="ai-info-artykul"', None, None),
    ('R9-D/cms-atrybuty', 'HTML do WordPressa i Drupala w <div data-ai-*> (po filtrze modelu)',
     'const wpis = opakowanieCmsAI(artClone, content);', None, None),
    ('R9-D/cms-przypomnienie', 'PR8-19: przypomnienie o art. 50 ust. 4 w oknie publikacji do CMS',
     'data-i18n="ozn-cms-przypomnienie"', None, None),
    ('R9-D/jsonld', 'JSON-LD z digitalSourceType',
     'function schemaZOznaczeniemAI(schema) {', None, None),
    ('R9-D/jsonld-autor', "PR8-20: bez domyslnego autora 'Redakcja' w schema Article",
     "defaultAuthor: BRAND.defaultAuthor || '',", "defaultAuthor: 'Redakcja',", None),
    ('R9-D/pochodzenie', 'PR8-18: pochodzenie tekstu (tresc z AI albo tekst uzytkownika przerobiony przez AI)',
     "ai: nowePochodzenieAI(poprawaWklejonego ? 'zlozone' : 'ai')", None, None),
    ('R9-D/przerobki', 'krotka etykieta AI przy kopiowaniu przerobki (posty, newsletter)',
     "const text = przerobkaZOznaczeniemAI(document.getElementById('repurpose-out').value);", None, None),
    ('R9-D/bledy-kod', 'UX8-22: rodzaj bledu z kodu X-CAI-Kod przed zgadywaniem po tresci',
     "if (kc === 'brak-klucza') return 'brak-klucza';", None, None),
    ('R9-D/bledy-wlasne', "UX8-22: konto na wlasnych kluczach dostaje tekst z nazwa dostawcy, bez 'zglos administratorowi'",
     'return kontoNaWlasnychKluczach() && BLEDY_WLASNE[r] ? BLEDY_WLASNE[r] : klucz;', None, None),
    ('R9-D/bledy-pula', "KOD8-04: pula jednorazowa ma wlasne zdanie (nie 'na ten miesiac')",
     "if (r === 'pakiet' && e && e.odnawialny === false) return 'err-limit-pakietu-zawsze';", None, None),
    ('R9-D/naprawa-powiadomienie', 'UX8-05: blad klucza w grafice i audio z przyciskiem naprawy, dluzej na ekranie',
     "const naprawa = (r === 'klucz' || r === 'brak-klucza') && typeof window.otworzKreatorKlucza === 'function';", None, None),
    ('R9-D/wyloguj-wybor', 'UX8-09, M-10: wylogowanie konta z kluczami pyta, co z kluczami',
     "if (!opcje && typeof window.zapytajPrzyWylogowaniu === 'function' && window.zapytajPrzyWylogowaniu()) return;", None, None),
    ('R9-D/wyloguj-zostaw', "M-10: 'Wyloguj sie' zostawia zapamietane klucze na tym urzadzeniu",
     'if (zostawKlucze && /^cai_klucz_/.test(pref ? k.slice(pref.length) : k)) continue;', None, None),
    ('R9-D/cai-konto', 'ARCH8-24: magazyn bierze identyfikator konta z window.CAI_KONTO (z zapasem na meta)',
     "if (typeof window.CAI_KONTO === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(window.CAI_KONTO)) konto = window.CAI_KONTO;", None, None),
    ('R9-D/baza-jedna-lista', 'UX8-23: konto jednoosobowe ma jedna liste bazy wiedzy (bez wyboru zakresu)',
     'body.konto-samoobslugowe #bazas-zakres { display: none; }', None, None),
    ('R9-D/konto-js', 'ARCH8-24, KOD8-06: /konto.js przed skryptami aplikacji, bez miejsca na konto w HTML (jedna strona)',
     '<script src="/konto.js"></script>\n<script id="cai-motyw-start">', '<meta name="cai-konto" content="WSTAW_TUTAJ_KONTO">', ('proxy',)),
    ('R9-D/stan-konta', 'stan konta z /api/konto (zapas: /auth/me i /api/pakiet do scalenia A1)',
     "fetch('/api/konto', { headers: { Accept: 'application/json' }, cache: 'no-store' })", None, ('proxy',)),
    ('R9-D/x-cai-kod', 'projekt 10.4: X-CAI-Kod w opakowanym fetch',
     "var kod = odp.headers.get('X-CAI-Kod') || '';", None, ('proxy',)),
    ('R9-D/okno-pakietu', 'UX8-03: okno pakietu tylko przy odmowie pakietowej serwera, nie przy 402 dostawcy',
     'if (KODY_OKNA_PAKIETU.indexOf(kod) >= 0 || (d && (d.czynnosc || d.funkcja))) window.pokazLimitPakietu(d);', '.then(function(d){ window.pokazLimitPakietu(d); })', ('proxy',)),
    ('R9-D/brak-klucza', 'UX8-02: konto BYOK bez klucza dostaje 403 brak-klucza bez wywolania modelu i kreator (po swiezym odczycie stanu kluczy)',
     'if (!window.kontoBezKlucza(dostawca)) return window.fetch(zasob, opcje);', None, ('proxy',)),
    ('R9-D/stan-kluczy-z-odpowiedzi', 'C: kazda odpowiedz /api/klucze ze stanem (takze spoza kreatora) odswieza karte i Konto',
     "odp.clone().json().then(window.ustawStanKluczy).catch(function(){});", None, ('proxy',)),
    ('R9-D/sesja', 'KOD8-10 (prosba F): wygasla sesja w kazdym wywolaniu API - jeden pasek z logowaniem',
     "odp.headers.get('X-CAI-Kod') === 'sesja' && typeof window.sesjaWygasla === 'function') window.sesjaWygasla();", None, ('proxy',)),
    ('R9-D/klucze-ciasteczka', 'SEC8-04: klucz do /api/klucze (test u dostawcy, zapamietaj), nie do localStorage',
     "postJson('/api/klucze', { dostawca: d, klucz: klucz, zapamietaj: zapamietaj !== false, sprawdz: true })", None, ('proxy',)),
    ('R9-D/klucze-nieznane', 'C: konto BYOK bez odczytanego stanu kluczy nie jest blokowane w przegladarce (odpowie serwer), klucz nie trafia do localStorage',
     "window.kontoBezKlucza = function(d){ return wlasne() && !!window.STAN_KLUCZY && !window.STAN_KLUCZY._nieznany && !window.maKlucz(d || 'anthropic'); };", None, ('proxy',)),
    ('R9-D/bez-naglowkow-kluczy', 'C, SEC8-04: konto na wlasnych kluczach nie wysyla naglowkow x-*-key (klucz tylko w ciasteczku)',
     "if (typeof kontoNaWlasnychKluczach === 'function' && kontoNaWlasnychKluczach()) return bezKluczy(opcje);", None, ('proxy',)),
    ('R9-D/zadanie-stan', 'KOD8-30 (prosba F, trasa C): odbior artykulu po przeladowaniu sprawdza stan GET /api/zadanie zamiast sondy POST /api',
     "const res = await fetch('/api/zadanie?id=' + encodeURIComponent(rec.id), { cache: 'no-store', signal: przerwanieGenerowania.signal });",
     "body: '{}', signal: przerwanieGenerowania.signal }, rec.id, true);", ('proxy',)),
    ('R9-D/marka-moze-edytowac', 'C (ARCH8-09): edycja marki organizacji wedlug GET /api/marka mozeEdytowac',
     "if (dane && typeof dane.mozeEdytowac === 'boolean') mozeEdytowac = dane.mozeEdytowac;", None, ('proxy',)),
    ('R9-D/regulamin-przy-zapisie', 'A1: 403 zgoda-wymagana z wersja przy dowolnym zapisie - pasek akceptacji regulaminu',
     "odp.clone().json().then(function(d){ if (d && d.wersja) window.poOdmowieSerwera('zgoda-wymagana'); }).catch(function(){});", None, ('proxy',)),
    ('R9-D/zakup-regulamin', 'A1: zgoda-wymagana z wersja przy zakupie to nowy regulamin, nie pola zgody zakupu',
     "if (kod === 'zgoda-wymagana' && d && d.wersja) k = 'err-zgoda-wymagana';", None, ('proxy',)),
    ('R9-D/klucz-niewazny', 'C: ciasteczko klucza nie do odszyfrowania (niewazny bez klucza) - inny tekst niz odrzucenie u dostawcy',
     "esc(tekst(ka.niewazny ? (ka.ustawiony ? 'e1-odrzucony' : 'e1-niewazny') : 'e1-tytul', ''))", None, ('proxy',)),
    ('R9-D/klucz-odrzucenie-zostaje', 'odrzucenie klucza u dostawcy zostaje po odczycie stanu z serwera (ta sama koncowka), Sprawdz z ok je zdejmuje',
     "if (a && a.niewazny && a.ustawiony && b && b.ustawiony && !b.niewazny && b.koncowka === a.koncowka) b.niewazny = true;", None, ('proxy',)),
    ('R9-D/ai-info-telefon', 'test_uklad: informacja o AI pod artykulem na telefonie nad paskami na dole (ostatni wiersz tresci)',
     "body.is-mobile:has(#ai-info-artykul:not([hidden])) .article { padding-bottom: var(--s-16); }", None, None),
    ('R9-D/ozn-dotyk', 'test_uklad: przelaczniki etykiet AI na telefonie z polem dotyku 44 px',
     "body.is-mobile label.ozn-wiersz { min-height: var(--h-dotyk); }", None, None),
    ('R9-D/klucze-przeniesienie', 'SEC8-04: jednorazowe przeniesienie kluczy z localStorage do ciasteczek',
     'function przeniesKluczeZMagazynu(){', None, ('proxy',)),
    ('R9-D/kreator-byok', 'UX8-19: kreator konta BYOK w trzech krokach (klucz, firma, pierwszy artykul)',
     "KROKI_WLASNE = ['klucz', 'firma', 'artykul']", None, ('proxy',)),
    ('R9-D/kreator-klucza', 'projekt 10.2: otworzKreatorKlucza(dostawca) zamiast otworzStart() + startDalej()',
     'window.otworzKreatorKlucza = function(dostawca, powod){', None, ('proxy',)),
    ('R9-D/kreator-temat', 'KOD8-24: kreator nie wyskakuje nad zaczetym tematem ani nad innym oknem',
     "if ((juz && !(bezKlucza && !pozniej)) || (t && t.value.trim()) || inneOkno) return;", None, ('proxy',)),
    ('R9-D/karta-e1', "E1: bez klucza karta 'Podlacz klucz' w miejscu Wygeneruj",
     "if (window.kontoBezKlucza('anthropic')) rodzaj = 'klucz';", None, ('proxy',)),
    ('R9-D/karta-a4', "UX8-06: koniec darmowej puli widoczny przed kliknieciem (karta 'Wybierz pakiet')",
     "else if (a && a.zostalo === 0) rodzaj = a.okres === 'zawsze' ? 'darmowe' : 'okres';", None, ('proxy',)),
    ('R9-D/zakup', 'UX8-20: zakup przez POST /api/platnosci/zakup z waluta, zgoda na wykonanie i regulaminem (kontrakt B)',
     "postJson('/api/platnosci/zakup', { plan: wybranyPlan, waluta: wybranaWaluta, zgodaNaWykonanie: !!(z2 && z2.checked), zgodaRegulamin: !!(z1 && z1.checked), jezyk: jezyk(), z: 'app' })", None, ('proxy',)),
    ('R9-D/zakup-waluty', 'kontrakt B: waluta bez ceny ukryta, waluta wymuszona klienta, ktory juz placil',
     "return wym ? w.filter(function(x){ return x === wym; }) : w;", None, ('proxy',)),
    ('R9-D/zakup-limit-minuty', 'kontrakt B: 429 za-duzo-prob przy zakupie - czas w minutach (ponowZa w sekundach)',
     "var t = tekst(k, '').replace('{min}', String(Math.max(1, Math.ceil(((d && d.ponowZa) || 60) / 60))));", None, ('proxy',)),
    ('R9-D/panel-stripe', 'UX8-21: panel klienta Stripe (Zarzadzaj subskrypcja)',
     "postJson('/api/platnosci/panel', {})", None, ('proxy',)),
    ('R9-D/powrot-stripe', 'UX8-20: powrot ze Stripe z aktywacja z webhooka i wariantem opoznienia (ok i oczekuje)',
     "if (w === 'ok' || w === 'oczekuje') czekajNaPakiet();", None, ('proxy',)),
    ('R9-D/powrot-kraj', 'D-04, kontrakt B: powrot z krajem spoza listy - komunikat z platnosci.odrzucenie, bez aktywacji',
     "else if (w === 'kraj') odrzuconyKraj();", None, ('proxy',)),
    ('R9-D/powrot-panel', 'kontrakt B: powrot z panelu klienta Stripe (?konto=1) na ekran Konto',
     "if (!w) { window.otworzKonto(); return; }", None, ('proxy',)),
    ('R9-D/powrot-zespol', 'konta zespolu: parametry powrotu ze Stripe w aplikacji jak dzis (bez okna platnosci)',
     "if (!samoobsluga()) return;\n    var q; try { q = new URLSearchParams(location.search); } catch(e){ return; }", None, ('proxy',)),
    ('R9-D/odstapienie-adres', 'UX8-21: odstapienie z adresu kontraktu B z powrotem do aplikacji, zlozone oswiadczenie z data',
     "'?z=app&amp;lang=' + jezyk() + '\">' + esc(tekst('konto-odstap', ''))", None, ('proxy',)),
    ('R9-D/e8-wznow', 'E8: anulowana subskrypcja - przycisk panelu "Wznow subskrypcje"',
     "esc(tekst(sub.stan === 'anulowana' ? 'sub-wznow' : 'plat-ustawienia-portal', ''))", None, ('proxy',)),
    ('R9-D/pasek-test', 'pasek trybu testowego platnosci',
     "if (pl.wlaczone && pl.tryb === 'test') lista.push(['test',", None, ('proxy',)),
    ('R9-D/konto-ekran', 'UX8-21: ekran Konto (pakiet, klucze, firma, oznaczenia, dane, konto)',
     'id="konto-modal"', None, ('proxy',)),
    ('R9-D/ustawienia-konta', 'wybor etykiet AI zapisany w koncie (POST /api/konto/ustawienia)',
     "postJson('/api/konto/ustawienia', zmiany)", None, ('proxy',)),
    ('R9-D/pula-niedostepna', "KOD8-04: pula z limitem 0 to 'niedostepne w pakiecie', nie pelny czerwony pasek",
     'if (poz.limit === 0) return \'<div class="pakiet-niedostepna">', None, ('proxy',)),
    ('R9-D/limit-bez-administratora', "KOD8-04: konto jednoosobowe bez zdania 'Pakiet zmienia administrator'",
     "return tekst(wlasne ? 'pakiet-limit-zawsze-wlasne' : 'pakiet-limit-zawsze', '');", None, ('proxy',)),
    ('R9-D/marka-wlasciciel', 'UX8-23: marke edytuje ten, kto zarzadza organizacja (mozeZarzadzac)',
     "if (ja && ja.organizacja && typeof ja.organizacja.mozeZarzadzac === 'boolean') markaAdmin = ja.organizacja.mozeZarzadzac;", None, ('proxy',)),
    ('R9-D/karta-openai', 'UX8-25, A8: Grafika i Audio bez klucza OpenAI/ElevenLabs - karta podlaczenia',
     'window.rysujKartyKluczyModulow = function(){', None, ('proxy',)),
    ('R9-D/motyw-po-wyborze', 'PR8-26: ciasteczko cai_motyw dopiero po wyborze motywu',
     'if (wybrany !== null) zapiszMotyw(); else usunMotyw();', '    zapiszMotyw();\n    if (!wdrozone) return;', ('proxy',)),
    ('R9-D/pdf-stopka-emoji', 'KOD8-35 (prosba F): tytul w stopce i marka w naglowku PDF bez emoji (EMOJI_PDF)',
     "{ text: tekstWKrojuPdf(skrotTekstu(String(tytul || '').replace(EMOJI_PDF, '').trim(), 70), 'Schibsted'), style: 'meta2' },",
     "{ text: skrotTekstu(tytul, 70), style: 'meta2' },", None),
    ('R9-D/klucz-przycisk', 'przycisk kluczy przy bledzie: dostawca tylko dla konta na wlasnych kluczach, reszta jak dzis (test_stan)',
     "const dk = kontoNaWlasnychKluczach() && e && e.dostawcaKod ? '\\'' + escapeHtml(e.dostawcaKod) + '\\'' : '';", None, None),
    ('R9-D/e3-ponow', 'UX8-22, E3: brak srodkow u dostawcy na wlasnym kluczu - "Sprobuj ponownie" po doladowaniu',
     "const znowu = r === 'srodki' && ponow ? '<button type=\"button\" class=\"btn-secondary ponow-generowanie\"", None, None),
    ('R9-D/e4-limity', 'UX8-22, E4: limit wydatkow u dostawcy - przycisk do strony limitow w konsoli',
     "const LIMITY_DOSTAWCOW = { anthropic: 'https://platform.claude.com/settings/limits'", None, None),
]

# Uwagi Marcina z telefonu (runda 9, koordynator). Scenariusz wariantUwagiTelefonu w test_dymny.js.
KONTROLE += [
    ("R9-UT/konto-x", "telefon: arkusz Konto ma X w prawym gornym rogu, naglowek zostaje u gory przy przewijaniu",
     '<button type="button" class="przycisk-ikona arkusz-zamknij menu-konto-zamknij" onclick="closeSettingsMenu()"', None, None),
    ("R9-UT/konto-x-styl", "X arkusza Konto tylko na telefonie",
     "body.is-mobile .settings-menu.open .menu-konto-zamknij { display: inline-flex;", None, None),
    ("R9-UT/bez-klawiatury", "ekran dotykowy: okno przy otwarciu nie stawia fokusu w polu tekstowym (klawiatura po dotknieciu pola)",
     "if (ekranDotykowy() && otwieraKlawiature(pierwsze)) pierwsze = dialogW(okno);", None, None),
    ("R9-UT/kreator-bez-klawiatury", "kreator otwarty dla dostawcy: na ekranie dotykowym pole klucza bez fokusu (fokus na tytule kroku)",
     "if (fokus && typeof ekranDotykowy === 'function' && ekranDotykowy() && otwieraKlawiature(fokus)) fokus = null;", None, ("proxy",)),
    ("R9-UT/tematy-bez-klawiatury", "Tematy i szablony: fokus w polu tematu bez klawiatury na ekranie dotykowym",
     "fokusBezKlawiatury(document.getElementById('tematy-zapotrzebowanie'));", "  document.getElementById('tematy-zapotrzebowanie').focus();\n}", None),
    ("R9-UT/audio-tworz", "menu Tworz przy gotowym tekscie ma Audio (blokada pakietu jak w menu briefu)",
     '<button type="button" class="btn-secondary" id="audio-wynik-btn" style="display:none" onclick="openAudioPanel()"', None, None),
    ("R9-UT/audio-tworz-wynik", "Audio na liscie przyciskow gotowego wyniku",
     "'img-btn', 'audio-wynik-btn', 'titles-btn',", None, None),
    ("R9-UT/audio-zrodlo", "Audio przy gotowym artykule: puste zrodlo dostaje ten artykul, wczytany znika z nowym artykulem",
     "if (as && as.value && typeof audioZArtykulu === 'function' && as.value === audioZArtykulu.auto) as.value = '';", None, None),
    ("R9-UT/siec-koszt-wlasny", "UX8-14 przy wlasnym kluczu: pod Szukaj w sieci zdanie o koszcie wyszukiwania na kluczu uzytkownika",
     "body.konto-wlasne .toggle-row .koszt-wlasny { display: block; }", None, None),
]

# Uwagi Marcina z testu premiery na test.content-ai.net (runda 9). Scenariusz wariantUwagiTestuPremiery w test_dymny.js.
KONTROLE += [
    ("R9-T/menu-brief-lewo", "karta Podlacz klucz / Wybierz pakiet: menu ... rozwija sie w prawo, nie poza lewa krawedz ekranu",
     "body.karta-konta:not(.is-mobile) #grupa-brief-menu { right: auto; left: 0; }", None, None),
    ("R9-T/zgody-zdanie", "zgoda przy zakupie jednym zdaniem z dwoma linkami (bez kolumny tytul nad opisem)",
     ".zakup label.ozn-wiersz > span { display: block; }", None, None),
    ("R9-T/klucz-niepelny", "uciety klucz sk-ant-...: komunikat o niepelnym kluczu zamiast 'zaczyna sie od sk-ant-'",
     "if (d === 'anthropic' && !/^sk-ant-admin/i.test(klucz) && !/^sk-ant-api\\d{2}-[A-Za-z0-9_-]{20,}$/.test(klucz)) return Promise.resolve({ ok: false, powod: 'niepelny' });",
     None, ("proxy",)),
    ("R9-T/pasek-srodek", "pasek wyniku bez plakietki i wersji: przyciski na srodku kolumny artykulu, nie przy prawej krawedzi",
     "body:not(.is-mobile) .output-bar:not(:has(#versions-bar.show)):has(#out-badge:is(.ready, [data-i18n=\"badge-done\"], [data-i18n=\"badge-ready\"])) .pasek-akcje { margin-inline: auto; }",
     None, None),
    ("R9-T/zakonczona-wczesniej", "pakiet zakonczony przed koncem okresu (odstapienie): data odstapienia, nie koniec oplaconego miesiaca",
     "if (zl && zl.czas) return tekst('sub-zakonczona-odstapienie', '').replace('{PAKIET}', nazwa).replace('{DATA}', data(zl.czas));",
     None, ("proxy",)),
    ("R9-T/historia-kosz", "Historia: tytul wpisu konczy sie przed ikona kosza (odstep na .h-usun)",
     "#h-list-inner > .h-item { padding-left: calc(var(--hist-wciecie) - 2px); padding-right: calc(var(--h-dotyk, 44px) + var(--s-8)); }",
     "#h-list-inner > .h-item { padding-left: calc(var(--hist-wciecie) - 2px); padding-right: var(--hist-wciecie); }", None),
    ("R9-T/koszt-usd", "koszt API po polsku '1,98 USD', po angielsku '$1.98' (nie '$1,984')",
     "return currentLang === 'en' ? '$' + liczba : liczba + '\\u00a0USD';",
     "el.textContent = '$' + formatujLiczbe(", None),
    ("R9-T/koszt-kreator", "kreator klucza: koszt kazdego tekstu w Historii (R9-K), nie obietnica bez pokrycia",
     "Szacunkowy koszt każdego tekstu zobaczysz w Historii.", "Koszt każdego tekstu zobaczysz w Historii.", ("proxy",)),
]

# Koszt kazdego tekstu w Historii (runda 9, po tescie premiery). Scenariusz w wariantProxy (test_dymny.js).
KONTROLE += [
    ("R9-K/kubelek", "apiFetch: wywolanie pracy na tekscie (doArtykulu) liczy koszt do artykulu z chwili wyslania",
     "const kubelekKosztu = options && options.doArtykulu ? kubelekArtykulu() : null;", None, None),
    ("R9-K/generowanie", "generowanie zbiera koszt w kubelku, po zapisie wpisu kubelek wskazuje wpis (spoznione odpowiedzi)",
     "kubelekGenerowania.wpis = history[0].id;", None, None),
    ("R9-K/zapis", "koszt wpisu zapisany w magazynie przegladarki razem z wpisem",
     "koszt: h.koszt > 0 ? h.koszt : undefined", None, None),
    ("R9-K/lista", "lista Historii: koszt tego tekstu w metadanych wpisu (kwotaUsd)",
     "${h.koszt > 0 ? ` · <span class=\"h-koszt\" title=\"${escapeHtml(_t('hist-koszt-wpisu'))}\">${escapeHtml(kwotaUsd(h.koszt))}</span>` : ''}", None, None),
]

# Uwagi Marcina z testu zakupu: ceny w EUR zamiast PLN, jezyk i waluta wedlug miejsca, zmiana pakietu bez wychodzenia
# do Stripe, data licznika (runda 9). Scenariusz wariantR9W w test_dymny.js, serwer: testyZmianyPakietu w testy-platnosci.js.
KONTROLE += [
    ("R9-W/jezyk-start", "jezyk startowy: pierwszy obslugiwany (pl, en) z jezykow przegladarki (de, pl -> pl; de -> en), nie tylko pierwszy",
     "var jezyk = zapamietany || zAdresu || jezykPrzegladarki();",
     "var jezyk = czytaj('cai_lang') || ((navigator.language || 'pl').toLowerCase().indexOf('pl') === 0 ? 'pl' : 'en');", None),
    ("R9-W/jezyk-adres", "?lang= z adresu (po zakupie, rejestracji) zapamietany tylko bez wlasnego wyboru w aplikacji",
     "if (!zapamietany) { try { if (ls) ls.setItem('cai_lang', zAdresu); } catch (e) {} }", None, None),
    ("R9-W/jezyk-aplikacji", "currentLang z jezyka startowego (ta sama negocjacja co przed pierwszym malowaniem)",
     "var currentLang = magazyn.getItem('cai_lang') || (window.CAI_START && window.CAI_START.jezyk)",
     "var currentLang = magazyn.getItem('cai_lang') || ((navigator.language||'pl').toLowerCase().indexOf('pl')===0 ? 'pl' : 'en');", None),
    ("R9-W/waluta-miejsce", "waluta startowa wedlug strefy czasowej urzadzenia (Europe/Warsaw -> PLN, inna -> EUR)",
     "var m = walutaZMiejsca(pl);\n    if (m && w.indexOf(m) >= 0) return m;", None, ("proxy",)),
    ("R9-W/waluta-bez-strefy", "bez strefy czasowej (UTC, Etc/*) waluta wedlug jezyka, nie EUR dla kazdego",
     "if (!strefa || /^(UTC|GMT|Etc\\/|Universal$|Zulu$)/i.test(strefa)) return '';", None, ("proxy",)),
    ("R9-W/waluta-konta", "zakup odrzucony przez blokade waluty w Stripe: komunikat z waluta konta zamiast ogolnego bledu",
     "t = wk ? tekst('zakup-bl-waluta-konta', '')", None, ("proxy",)),
    ("R9-W/licznik-1-dnia", "Konto: licznik wraca 1. dnia nastepnego miesiaca (UTC, jak serwer), nie w dniu odnowienia subskrypcji",
     "return data(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1), true);",
     "if (sub && sub.okresDo && ZYWE.indexOf(sub.stan) >= 0) return data(sub.okresDo, true);", ("proxy",)),
    ("R9-W/opis-bez-licznikow", "opis pakietu bez zdania o odnawianiu licznikow, gdy zaden licznik nie ma limitu (Premium)",
     "(zLimitem ? ' ' + tekst(stan.okres === 'miesiac' ? 'pakiet-okres-miesiac' : 'pakiet-okres-zawsze', '') : '');",
     "el('pakiet-opis').textContent = poJezyku('opis') + ' '\n      + tekst(stan.okres === 'miesiac'", ("proxy",)),
    ("R9-W/zmiana-sekcja", "okno pakietu: sekcja Zmien pakiet przy zywej subskrypcji (karty pakietow, potwierdzenie kwoty w Stripe)",
     "'<div class=\"zakup zmiana-pakietu\" id=\"zmiana-pakietu\">'", None, ("proxy",)),
    ("R9-W/zmiana-api", "zmiana pakietu przez POST /api/platnosci/zmiana (strona potwierdzenia zmiany w panelu Stripe)",
     "postJson('/api/platnosci/zmiana', { plan: wybranyPlanZmiany, jezyk: jezyk(), z: 'app' })", None, ("proxy",)),
    ("R9-W/zmiana-powrot", "powrot ze Stripe po zmianie pakietu (platnosc=zmiana): okno czeka na potwierdzenie z webhooka",
     "else if (w === 'zmiana') czekajNaZmiane(", None, ("proxy",)),
    ("R9-W/konto-zmien", "Konto: przycisk Zmien pakiet przy zywej subskrypcji (wczesniej zmiana tylko w panelu Stripe)",
     'id="konto-zmien-pakiet"', None, ("proxy",)),
    ("R9-W/kreator-nad-oknem", "kreator klucza po spoznionej odpowiedzi /api/pakiet nie wchodzi nad otwarte okno .okno-tlo (Pakiet, Klucze, Bazy, SEO)",
     "return o.id !== 'start-modal' && o.style.display === 'flex';",
     "if ((juz && !(bezKlucza && !pozniej)) || (t && t.value.trim()) || document.querySelector('.overlay.open')) return;", ("proxy",)),
    ("R9-W/openseo-dostep", "wejscia do OpenSEO z jednego sprawdzenia dostepu (dostepOpenSeo), przycisk fraz nie przy kazdej odpowiedzi 200",
     "window.dostepOpenSeo = function(){",
     "fetch('/api/seo/projekty').then(function(o){\n      if (!o.ok) return;\n      var b = el('seo-frazy-btn');", ("proxy",)),
    ("R9-W/openseo-klient", "konto samoobslugowe bez OpenSEO w pakiecie: bez menu OpenSEO i przycisku fraz (OpenSEO dla klientow po premierze)",
     "if (klient && !(f && f.openseo)) return { menu: false, frazy: false };", None, ("proxy",)),
    ("R9-W/openseo-frazy", "przycisk fraz tylko, gdy serwer potwierdzi OpenSEO (200 z dostepne: false to serwer bez OpenSEO)",
     "return o.json().then(function(d){ return { menu: true, frazy: !(d && d.dostepne === false) }; });", None, ("proxy",)),
    ("R9-W/openseo-menu", "pozycja menu OpenSEO (komputer i telefon) po sprawdzeniu dostepu konta",
     "window.dostepOpenSeo().then(function(d){\n      if (!d.menu) return;", None, ("proxy",)),
    ("R9-W/openseo-pakiet", "okno pakietu konta samoobslugowego bez wiersza 'Dane z OpenSEO: niedostepne'",
     "return f !== 'openseo' || Boolean(stan.funkcje && stan.funkcje.openseo)", None, ("proxy",)),
    ("R9-W/openseo-brief", "plan briefu bez zapytania o frazy OpenSEO, gdy konto albo serwer ich nie ma (402/501 w konsoli)",
     "if (typeof window.dostepOpenSeo === 'function' && !(await window.dostepOpenSeo()).frazy) return;", None, ("proxy",)),
    ("R9-W/istnieje-tekst", "komunikat 'konto ma juz subskrypcje' wskazuje zmiane w oknie pakietu, nie tylko panel Stripe",
     "'zakup-bl-istnieje':'To konto ma już aktywną subskrypcję. Pakiet zmienisz w tym oknie albo w panelu Stripe.'",
     "'zakup-bl-istnieje':'To konto ma już aktywną subskrypcję. Pakiet zmienisz w panelu Stripe: Zarządzaj subskrypcją.'", ("proxy",)),
]

# Uwagi Marcina do strony produktowej (2026-10-12): bez srednikow w tekstach strony i aplikacji
# (narzedzia/audyt_sredniki.py pilnuje calosci), tu slady zmian w kodzie aplikacji.
KONTROLE += [
    ("R9-S/vis-opis", "opis wyniku Widocznosci AI ze slownika (PL i EN), bez srednika wpisanego na sztywno w kodzie",
     "escapeHtml(_t('vis-obecnosc-opis').replace('{pct}', pct))",
     "'%; wskaźnik obniża ją za dalsze pozycje i niestabilność.'", None),
    ("R9-S/audio-bez-cors", "blad polaczenia z audio bez uwagi o CORS i proxy (klient i tak idzie przez serwer, ElevenLabs tez)",
     "'err-audio-siec':'Nie udało się połączyć z usługą audio. Sprawdź połączenie z internetem i klucz API, a potem spróbuj ponownie.'",
     "OpenAI TTS jest blokowane przez CORS przeglądarki i wymaga proxy;", None),
    ("R9-S/zakup-podsumowanie", "podsumowanie zakupu bez srednikow, zdanie w zdanie jak ekran platnosci serwera",
     "w ustawieniach konta. Pakiet działa do końca opłaconego miesiąca. Cena jest ceną końcową. Do generowania potrzebny jest Twój klucz API. Opłaty",
     "w ustawieniach konta; pakiet działa do końca opłaconego miesiąca.", ("proxy",)),
    ("R9-S/czekanie-stripe", "czekanie na potwierdzenie Stripe (platnosc i zmiana pakietu) bez srednika",
     "'plat-oczekuje':'Czekamy na potwierdzenie płatności od Stripe. To zwykle kilka sekund. Okno odświeży się samo.'",
     "To zwykle kilka sekund; okno odświeży się samo.", None),
]

# Opus 5.5 (2026-10-12): model tresci claude-opus-5-5 (4/20 USD zamiast 5/25). Mysli zawsze, wiec
# thinking disabled to 400, odmowa filtra przychodzi jako HTTP 200 ze stop_reason "refusal", a zapasowy
# model wlacza fallbacks "default" z naglowkiem beta. Do tego zakaz srednika w zasadach pisania
# z siatka bezpieczenstwa na swiezy tekst i okno glosu bez dyktowania, dopoki jest wylaczone.
KONTROLE += [
    ("R9-O/cennik", "cennik Opus 5.5: 4 USD wejscie i 20 USD wyjscie za milion tokenow",
     "'claude-opus-5-5':   [4, 20],", None, None),
    ("R9-O/cennik-zapas", "cennik modelu zapasowego po odmowie filtra (claude-opus-4-8, 5/25), wczesniej stawka Sonneta",
     "'claude-opus-4-8':   [5, 25],", None, None),
    ("R9-O/koszt-kreator", "kreator klucza: koszt artykulu po nowej stawce, jak na stronie (koszt_artykulu w konfiguracja.json)",
     "kontrolą faktów to orientacyjnie 0,20-0,40 USD.", "orientacyjnie 0,25-0,50 USD", ("proxy",)),
    ("R9-O/bez-disabled", "krotkie oceny JSON na MODEL_TRESCI z effort low i zapasem tokenow, bez thinking disabled (400 na Opus 5.5)",
     "model: MODEL_TRESCI, output_config: WYSILEK_OCENY, max_tokens: zRezerwaOceny(",
     "re:model: MODEL_TRESCI,\\s*thinking: BEZ_MYSLENIA", None),
    ("R9-O/wysilek", "niski wysilek myslenia dla krotkich ocen (Opus 5.5 domyslnie medium)",
     "const WYSILEK_OCENY = { effort: 'low' };", None, None),
    ("R9-O/rezerwa-oceny", "zapas tokenow na krotkie rozumowanie przed JSON-em oceny",
     "function zRezerwaOceny(tokeny) { return tokeny + REZERWA_OCENY; }", None, None),
    ("R9-O/zapasowy", "model zapasowy po odmowie filtra: fallbacks \"default\" tylko w zapytaniach o MODEL_TRESCI",
     "if (!b || b.model !== MODEL_TRESCI || b.fallbacks !== undefined) return options;\n  b.fallbacks = 'default';", None, None),
    ("R9-O/zapasowy-wpiety", "zapasowy model tylko na API Anthropic (Foundry i tryb GPT go nie maja)",
     "if (!gptMode && endpoint === API_ENDPOINT) options = zZapasowymModelem(options);", None, None),
    ("R9-O/zapasowy-naglowek", "naglowek beta server-side-fallback-2026-07-01 w zapytaniu z klucza w przegladarce",
     "zmienione.headers = Object.assign({}, options.headers, { 'anthropic-beta': BETA_ZAPASOWEGO_MODELU });", None, ("keys", "owner")),
    ("R9-O/zapasowy-proxy", "proxy bez naglowka beta z przegladarki (serwer buduje wlasne naglowki do Anthropic i sam go dopisuje)",
     None, "{ 'anthropic-beta': BETA_ZAPASOWEGO_MODELU }", ("proxy",)),
    ("R9-O/odmowa", "odmowa filtra (HTTP 200, stop_reason refusal) jako blad z kosztem, nie pusta albo urwana odpowiedz",
     "if (d && d.stop_reason === 'refusal') return odpowiedzOdmowy(d);", None, None),
    ("R9-O/odmowa-rodzaj", "rodzaj bledu odmowa-modelu (bez przycisku ponowienia z tym samym tematem)",
     "if (/\\brefusal\\b/.test(typ)) return 'odmowa-modelu';", None, None),
    ("R9-O/odmowa-pl", "komunikat odmowy filtra (PL)",
     "'err-odmowa-modelu':'Model AI odmówił odpowiedzi, bo zadziałał filtr bezpieczeństwa dostawcy.", None, None),
    ("R9-O/odmowa-en", "komunikat odmowy filtra (EN)",
     "'err-odmowa-modelu':'The AI model declined to answer because a safety filter at the provider was triggered.", None, None),
    ("R9-O/sredniki-artykul", "zakaz srednika w zasadach pisania artykulu",
     "systemPrompt += blokDaty() + blokInterpunkcji();", None, None),
    ("R9-O/sredniki-przepisywanie", "zakaz srednika przy przepisywaniu (korekta premium, poprawa po ocenie, przerobki)",
     "+ '- Keep every figure exactly as it stands, including its units and its wording.'\n    + blokInterpunkcji();", None, None),
    ("R9-O/sredniki-siatka", "srednik z modelu usuwany ze swiezego artykulu (siatka bezpieczenstwa za zasada)",
     "html = bezSrednikow(html);", None, None),
    ("R9-O/sredniki-premium", "srednik usuwany po korekcie premium",
     "premiumHtml = bezSrednikow(oczyscHtmlModelu(", None, None),
    ("R9-O/sredniki-przerobki", "przerobki na inne formaty bez srednika",
     "showRepurpose(bezSrednikowTekst((d.content||[]).map(b=>b.text||'').join('').trim()));", None, None),
    ("R9-O/sredniki-audio", "scenariusz audio z zasada interpunkcji",
     "var system=audioScriptSystem(t,n,L,gens)+blokInterpunkcji();", None, None),
    ("R9-O/dyktowanie-css", "dyktowanie wylaczone: wybor silnika dyktowania ukryty",
     "body:not(.voice-input-on) .tylko-dyktowanie { display:none !important; }", None, None),
    ("R9-O/dyktowanie-teksty", "dyktowanie wylaczone: menu i okno glosu mowia tylko o czytaniu na glos",
     "else document.querySelectorAll('[data-i18n-bez-dyktowania]').forEach(function (el) { el.setAttribute('data-i18n', el.getAttribute('data-i18n-bez-dyktowania')); });", None, None),
    ("R9-O/dyktowanie-menu", "pozycja menu ustawien z tekstem bez dyktowania",
     'data-i18n="settings-voice-title" data-i18n-bez-dyktowania="settings-voice-title-czytanie"', None, None),
]

# Runda A (2026-10-12): poprawki po artykule o astrobiologii, ktory Opus 5.5 napisal na produkcji.
# Fakty: kategoria "brak" (nazwany fakt bez zrodla), powod bez srednika, stopka przy Bazie bez pasujacych
# materialow, przycisk "Popraw zdania bez zrodla". Oceny SEO i AIO: pelne zdanie do 100 znakow bez srednika.
# Luki: limit naglowkow-pytan, 5-7 punktow wnioskow, akapity do 80 slow (wspolne limity z AEO). Linki bez
# stron spoza tematu. Jedna liczba slow w SERP i pasku. Reguly faktow i tonu. PDF: znaki w kroju.
KONTROLE += [
    ("R9-A/fakty-brak", "kontrola faktow: kategoria \"brak\" dla nazwanego faktu bez zadnego zrodla (wczesniej jako \"zakres\")",
     "+ '  \"brak\"      - a named fact that NO source supports at all: an event, discovery, study or its '", None, None),
    ("R9-A/fakty-brak-pl", "etykieta kategorii \"Brak w źródłach\" (PL)",
     "'fakty-rodzaj-brak':'Brak w źródłach'", None, None),
    ("R9-A/fakty-brak-en", "etykieta kategorii \"Not in the sources\" (EN)",
     "'fakty-rodzaj-brak':'Not in the sources'", None, None),
    ("R9-A/fakty-interpunkcja", "kontrola faktow z zasada bez srednika w wyjasnieniach",
     "+ 'Max 12 findings, most serious first.'\n    + blokInterpunkcji();", None, None),
    ("R9-A/fakty-powod", "wyjasnienie uwagi bez srednika przy wyswietlaniu (siatka za zasada)",
     "escapeHtml(bezSrednikowTekst(String(u.powod || ''))", "escapeHtml(String(u.powod || '') || _t('fakty-powod-' + rodzaj)", None),
    ("R9-A/fakty-stopka", "stopka: Baza z dokumentami bez pasujacych materialow to nie \"Baza wiedzy jest pusta\"",
     "_t(liczbaDokumentow() ? 'fakty-wzgledem-sieci-baza' : 'fakty-wzgledem-sieci')", "escapeHtml(_t('fakty-wzgledem-sieci')) + '</div>'", None),
    ("R9-A/fakty-popraw", "przycisk \"Popraw zdania bez zrodla\" pod lista uwag",
     'onclick="poprawZdaniaBezZrodla()"', None, None),
    ("R9-A/fakty-popraw-model", "poprawa zdan: redaktor usuwa albo lagodzi tylko zdania z listy uwag",
     "const system = 'You are a fact-checking editor. A fact check compared the article with its sources and found the '", None, None),
    ("R9-A/fakty-popraw-bez-faktow", "poprawa zdan bez nowych faktow (blokPrzepisywania)",
     "+ 'Return ONLY the complete corrected article HTML, no markdown fences, no comments.'\n      + blokPrzepisywania();", None, None),
    ("R9-A/fakty-popraw-wersja", "poprawa zdan jako nowa wersja \"Poprawione fakty\"",
     "addVersion(htmlDoZapisu(art), etykietaWersji(_t('ver-fakty')));", None, None),
    ("R9-A/oceny-zdanie", "uwagi ocen SEO i AIO pelnym zdaniem do 100 znakow (wczesniej skrot do 60 znakow ze srednikiem)",
     "const DLUGOSC_UWAGI_OCENY = 100;", "\"short observation in ${currentLang === 'en' ? 'English' : 'Polish'}, max 60 chars\"", None),
    ("R9-A/oceny-generowanie", "oceny po generowaniu z ta sama regula uwag (ich uwagi tez trafiaja do panelu)",
     "The article is COMPLETE if it has a conclusion paragraph.' + regulaJezykaUwag(),", "' max 50 chars\"]}", None),
    ("R9-A/oceny-siatka", "uwagi SEO i AIO bez srednika przy wyswietlaniu",
     "escapeHtml(bezSrednikowTekst(String(item.text || '')))", '<span class="seo-item-text">${escapeHtml(item.text)}</span>', None),
    ("R9-A/luki-msg", "komunikat analizy Luk bez srednika",
     "msgEl.textContent  = bezSrednikowTekst(parsed.msg || '');", "msgEl.textContent  = parsed.msg || '';", None),
    ("R9-A/luki-interpunkcja", "analiza Luk z zasada bez srednika",
     "rather than the article\\'s own subject.' + blokInterpunkcji(),", None, None),
    ("R9-A/luki-pytania", "Luki: najwyzej 7 naglowkow-pytan razem z nowymi sekcjami",
     "(pytajne * 2 >= h2Istniejace.length ? stylPytanLuk(pytajne, selectedNow.length) :",
     "'Phrase each new H2 as a question, like most existing headings.' : 'Match the style", None),
    ("R9-A/luki-wnioski", "Luki: wnioski 5-7 punktow (lista 3-7 w ocenie AEO)",
     "with ' + WNIOSKI_MIN_PUNKTOW + ' to ' + AEO_LISTA_MAX + ' bullet points", "with 5 to 8 bullet points", None),
    ("R9-A/luki-wnioski-prog", "Luki: wnioski z 8 punktami nie zastepuja dotychczasowych",
     "ileLi(updatedKw) <= AEO_LISTA_MAX ||", "ileLi(updatedKw) <= 8 ||", None),
    ("R9-A/luki-akapity", "Luki: akapit ponad 80 slow dzielony na granicy zdan",
     "podzielDlugieAkapity(czesci.filter(", None, None),
    ("R9-A/luki-akapity-prompt", "Luki: prosba o akapity ponizej 70 slow",
     "' Keep every paragraph under ' + LUKI_SLOW_AKAPITU + ' words", None, None),
    ("R9-A/aeo-wspolne", "ocena AEO na tych samych limitach co poprawa z Luk",
     "qH2.length >= AEO_PYTANIA_MIN && qH2.length <= AEO_PYTANIA_MAX", "qH2.length >= 5 && qH2.length <= 7", None),
    ("R9-A/linki", "Linki: tylko strony pasujace do artykulu, bez \"zawsze sugeruj URL z bazy\"",
     "const suggestions = propozycjeLinkow(art.innerText || '', urlDocs);", "Fallback: zawsze sugeruj URL z bazy", None),
    ("R9-A/linki-pl", "Linki: komunikat bez pasujacych stron (PL)",
     "'links-brak-dopasowan':'Żadna strona z Bazy wiedzy nie pasuje do tego artykułu.", None, None),
    ("R9-A/serp-slowa", "SERP: liczba slow jak w pasku statystyk",
     "slowaArt = liczbaSlowArtykulu(art);", "slowaArt = ((k.textContent || '').trim().match(/\\S+/g) || []).length;", None),
    ("R9-A/wedlug", "\"wedlug X\" tylko ze zrodlem, ktore popiera to zdanie",
     "+ '- \"According to X\" (\"według X\") may name only the source that supports that very sentence. '", None, None),
    ("R9-A/nazwy", "nazwane osoby, misje, badania i wydarzenia tylko z przypisem",
     "+ '- A named person, mission, probe, study, experiment, discovery, award or historical event '", None, None),
    ("R9-A/angielski", "wyszukiwanie takze po angielsku przy tematach z angielskimi zrodlami",
     "+ 'bodies, standards). For such a topic search in English as well as in the article language, '", None, None),
    ("R9-A/ton", "ton przyjazny bez formulek (Pamiętaj, Pewnie zastanawiasz się, Wniosek jest prosty, Masz w ręku)",
     "+ '\"Pamiętaj\", \"Pewnie zastanawiasz się\", \"Wniosek jest prosty\", \"Masz w ręku\", \"Warto wiedzieć\", '", None, None),
    ("R9-A/ton-formuly", "zadna formulka zwracania sie do czytelnika dwa razy w tekscie",
     "+ 'Never use the same formula to address the reader or to open a sentence twice in one text.';", None, None),
    ("R9-A/pdf-kroje", "PDF: kazdy tekst w kroju, ktory go narysuje (znak spoza kroju wypada, nie \\x00)",
     "content: trescWKrojachPdf(tresc, 'Literata', stylePdf()),", None, None),
    ("R9-A/pdf-naglowek", "PDF: marka i tytul w naglowku i stopce przez filtr znakow Schibsted",
     "{ text: tekstWKrojuPdf(String(marka).replace(EMOJI_PDF, '').trim(), 'Schibsted'), font: 'Schibsted'", None, None),
    ("R9-A/raport-separator", "raport widocznosci AI: lista zapytan rozdzielona kropka srodkowa, nie srednikiem",
     "rep.trend.newlyPresent.join(' · ')", "rep.trend.newlyPresent.join('; ')", None),
    ("R9-A/pdf-kroje-nazwa", "nowe kroje PDF pod nowa nazwa (pwa/lib idzie z immutable na rok, stara nazwa = stare kroje u klienta)",
     "wczytaj('pwa/lib/vfs_fonts-2026-10.js'", "'pwa/lib/vfs_fonts.js'", None),
]

# Srodtytuly (2026-10-12, zrzut Marcina z produkcji): H2 w aplikacji z text-wrap balance dzielil sie na dwa wiersze
# po polowie kolumny. Teraz lamany jak tekst (pretty). W PDF i DOCX tekst przylegal do srodtytulu (po H2 6 pt, po H3
# 4 pt, miedzy akapitami 7 pt), teraz po naglowku wiecej miejsca niz miedzy akapitami. Generator DOCX pod nowa nazwa.
KONTROLE += [
    ("R9-B/h2-pretty", "srodtytul H2 lamany jak tekst (pretty), nie na dwa wiersze po polowie kolumny (balance)",
     "margin: 1.7em 0 .5em; padding: 0; border: 0; text-wrap: pretty; }",
     "margin: 1.7em 0 .5em; padding: 0; border: 0; text-wrap: balance; }", None),
    ("R9-B/pdf-h2", "PDF: po H2 14,5 pt (wczesniej 6 pt, mniej niz 7 pt po akapicie)",
     "h2: { fontSize: 15, bold: true, lineHeight: 0.84, margin: [0, 18, 0, 14.5] },",
     "h2: { fontSize: 15, bold: true, lineHeight: 0.84, margin: [0, 18, 0, 6] },", None),
    ("R9-B/pdf-h3", "PDF: po H3 11 pt (wczesniej 4 pt)",
     "h3: { fontSize: 12, bold: true, lineHeight: 0.88, margin: [0, 12, 0, 11] },",
     "h3: { fontSize: 12, bold: true, lineHeight: 0.88, margin: [0, 12, 0, 4] },", None),
    ("R9-B/docx-3", "DOCX z generatora w wersji 3 lub nowszej (wieksze odstepy po srodtytulach, nowa nazwa pliku pwa/lib)",
     "await wczytajSkrypt('pwa/lib/docx-natywny-4.js');", "wczytajSkrypt('pwa/lib/docx-natywny-2.js')", None),
]

# Po etapie 7 (2026-10-12, PDF i DOCX artykulu o egzoplanetach, zrzuty kreatora i maila od Marcina): nazwy zrodel bez
# "Suggested Searches", tytulu rownego domenie i nazwy serwisu powtarzajacej domene (takze w artykulach sprzed poprawki),
# data przy zrodle w jednym wierszu (PDF i DOCX w wersji 4), regula o frazach i liczbach ze zrodel w innym jezyku,
# arkusze z wlasna szerokoscia na srodku na tablecie, stopka kreatora na telefonie wg UX4-16, teksty kreatora bez " - ".
KONTROLE += [
    ("R9-C/zrodla-nazwa", "nazwa zrodla z jednej funkcji (lista zrodel, PDF, DOCX, WordPress, uwagi Faktow)",
     "function nazwaZrodla(tytul, url) {", "const nazwa = String(z.tytul || '').replace(", None),
    ("R9-C/zrodla-ogolne", "tytul ogolny ('Suggested Searches', 'Strona główna', 404) zastepuje ostatni czlon adresu",
     "const TYTULY_OGOLNE = new Set(['suggested searches', 'search', 'search results',", None, None),
    ("R9-C/zrodla-adres", "nazwa z adresu: ostatni czlon z co najmniej 3 literami, bez numerow, rozszerzen i czlonow technicznych",
     "if (/^\\d+$/.test(c) || CZLONY_TECHNICZNE.test(c)) continue;", None, None),
    ("R9-C/zrodla-serwis", "nazwa serwisu na koncu tytulu odpada, gdy powtarza domene ('- NASA Science', '| Scientific American')",
     "if (slowa.length && slowa.length <= 5 && (bezTld.indexOf(slowa[0]) >= 0 || etykiety.indexOf(razem) >= 0 || bezTld.join('') === razem)", None, None),
    ("R9-C/zrodla-domena", "tytul rowny domenie ('astrobiology.nasa.gov') traktowany jak ogolny",
     "return !r || TYTULY_OGOLNE.has(r) || /^https?\\s/.test(r) || r.replace(/ /g, '') === host.replace(/[^a-z0-9]/g, '');", None, None),
    ("R9-C/zrodla-stare", "nazwy zrodel w artykulach sprzed poprawki poprawiane przy wyswietleniu i eksporcie (uporzadkujZrodla)",
     "li.querySelectorAll(':scope > a[href]').forEach(function (a) {", None, None),
    ("R9-C/zrodla-fakty", "uwaga Faktow 'Sprawdz na stronie': tytul strony z nazwaZrodla",
     "kopia.tytulStrony = nazwaZrodla(z.tytul, z.url);", "kopia.tytulStrony = z.tytul || '';", None),
    ("R9-C/pdf-data", "PDF: data przy zrodle z twardymi spacjami (bez '12' na koncu wiersza i 'gru 2016' w nastepnym)",
     "data ? data.textContent.trim().replace(/\\s+/g, '\\u00a0') : ''].filter(Boolean).join(' · ');",
     "[domenaZrodla(href), data ? data.textContent.trim() : ''].filter(Boolean).join(' · ');", None),
    ("R9-C/docx-4", "DOCX z generatora w wersji 4 (data przy zrodle w jednym wierszu, nowa nazwa pliku pwa/lib)",
     "await wczytajSkrypt('pwa/lib/docx-natywny-4.js');", "wczytajSkrypt('pwa/lib/docx-natywny-3.js')", None),
    ("R9-C/fakty-jezyk", "regula faktow: fraza ze zrodla w innym jezyku tlumaczona, liczby wg jezyka artykulu (6445, nie 6,445), kazda raz",
     "never paste a phrase from the source (in a Polish article \"6,445 confirmed exoplanets\" is a defect). ", None, None),
    ("R9-C/arkusz-srodek", "arkusz z wlasna szerokoscia (kreator, klucze, pakiet, Baza, SEO) na srodku na tablecie, nie przy lewej krawedzi",
     "body.is-mobile .overlay, body.is-mobile .okno-tlo { align-items: flex-end; justify-content: center; padding: 0; }",
     "body.is-mobile .overlay, body.is-mobile .okno-tlo { align-items: flex-end; justify-content: stretch; padding: 0; }", None),
    ("R9-C/kreator-stopka-css", "stopka kreatora na telefonie: kolumna na cala szerokosc, 'Pomin kreator' na srodku nad przyciskami",
     "body.is-mobile #start-modal .start-stopka { flex-direction: column; align-items: stretch;", None, None),
    ("R9-C/kreator-stopka", "stopka kreatora z klasami (bez stylu w linii, ktory trzymal przyciski w waskiej kolumnie)",
     '<div class="start-stopka" id="start-stopka">',
     '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:22px">', ("proxy",)),
    ("R9-C/kreator-pierwszy", "telefon chowa Wstecz na pierwszym kroku kreatora (bez pustego miejsca nad Dalej)",
     "el('start-modal').classList.toggle('start-pierwszy', krok === 0);", None, ("proxy",)),
    ("R9-C/kreator-teksty-pl", "kreator: tytul i etykiety kluczy bez ' - ' w roli myslnika (PL)",
     "'start-2-tytul':'Własne klucze API (opcjonalnie)',", "'start-2-tytul':'Klucze API - tylko jeśli chcesz',", ("proxy",)),
    ("R9-C/kreator-teksty-en", "kreator: tytul i etykiety kluczy bez ' - ' w roli myslnika (EN)",
     "'start-2-tytul':'Your own API keys (optional)',", "'start-2-tytul':'API keys - only if you want to',", ("proxy",)),

    # Runda P (promocja): poprawki z raportow agencja-ux i agencja-copywriter.
    ("RP/fakty-cudzyslow", "panel Fakty: cytat w cudzyslowie jezyka interfejsu (PL dolny i gorny, EN angielski), nie w prostym \"...\"",
     "overflow-wrap:anywhere\">' + (currentLang === 'en' ? '“' : '„') + escapeHtml(cytat) + '”</div>'",
     "overflow-wrap:anywhere\">\"' + escapeHtml(cytat) + '\"</div>'", None),
    ("RP/klucz-czas-pl", "karta 'Podlacz klucz': okolo 10 minut jak kreator i strona klucza, nie 5 (PL)",
     "'e1-opis':'To zajmuje około 10 minut, pokażemy jak.", "'e1-opis':'To zajmuje około 5 minut", ("proxy",)),
    ("RP/klucz-czas-en", "karta 'Podlacz klucz': okolo 10 minut jak kreator i strona klucza, nie 5 (EN)",
     "'e1-opis':'It takes about 10 minutes, we will show you how.", "'e1-opis':'It takes about 5 minutes", ("proxy",)),
    ("RP/limit-forma", "limit wydatkow u dostawcy: forma bezosobowa wobec czytelnika (bez 'ustawiles')",
     "'err-limit-wydatkow-wlasny':'Zapytanie zatrzymał limit wydatków ustawiony w konsoli {DOSTAWCA}.", "limit wydatków, który ustawiłeś", None),
    ("RP/kreator-instrukcja", "kreator klucza: 'Nie masz klucza? Okolo 10 minut' nad polem klucza (wczesniej na dole, pod akapitem o bezpieczenstwie)",
     "re:class=\"rozwijka byok-przewodnik\"[\\s\\S]{0,1500}?window\\.htmlPolaKlucza\\('start', 'anthropic'\\)",
     "re:window\\.htmlZapamietaj\\('start'\\)[\\s\\S]{0,800}?class=\"rozwijka byok-przewodnik\"", ("proxy",)),    ("RP/konto-z-emaila", "menu konta z rejestracji: nazwa i inicjaly z e-maila, nie z technicznego loginu k-... (KD, KX)",
     "if (d && d.login) odswiezKonto(d.login, d.email);", "if (d && d.login) odswiezKonto(d.login); }", ("proxy",)),
    ("RP/konto-inicjaly", "inicjaly z e-maila: pierwsza litera dwoch czlonow nazwy (ola.nowak@ -> ON)",
     "var zEmaila = Boolean(email) && /^k-/.test(String(login || ''));", None, None),
    ("RP/slowa-odmiana", "liczba slow w Bazie i Historii z odmiana ('23 słowa', nie '23 słów'), formy paska statystyk",
     "function slowaLiczba(n) { return _t(FORMY_STATYSTYK['stat-words'][formaLiczebnika(n)]); }", "_t('kb-words-suffix')", None),
    ("RP/slowa-historia", "wpis Historii: '~1022 słowa' (odmiana), nie stale 'słów'",
     "~${h.words} ${slowaLiczba(h.words)} · ${escapeHtml(czasWpisu(h))}", "_t('hist-words-suffix')", None),
    ("RP/odznaka-dwukropek", "odznaka pakietu bez tabular-nums: 'Darmowe: 3 z 3' bez odstepu przed dwukropkiem",
     "font-weight: var(--g-mocny); line-height: 1; cursor: pointer; white-space: nowrap; }",
     "font-weight: var(--g-mocny); line-height: 1; cursor: pointer; white-space: nowrap; font-variant-numeric: tabular-nums; }", None),
]

# Tresc plikow pwa/lib, ktore aplikacja wczytuje (nie przechodza przez budowanie wariantow): (kod, opis, plik, jest, niema).
KONTROLE_BIBLIOTEK = [
    ("R9-B/docx-h2", "DOCX: Heading2 20 pt nad i 12 pt pod (wczesniej 18 i 6 pt)", "docx-natywny-4.js",
     '<w:spacing w:before="400" w:after="240" w:line="264" w:lineRule="auto"/><w:outlineLvl w:val="1"/>', None),
    ("R9-B/docx-h3", "DOCX: Heading3 16 pt nad i 11 pt pod (wczesniej 12 i 4 pt)", "docx-natywny-4.js",
     '<w:spacing w:before="320" w:after="220" w:line="264" w:lineRule="auto"/><w:outlineLvl w:val="2"/>', None),
    ("R9-B/stare-pliki", "poprzednia wersja generatora DOCX zostaje dla kart otwartych przed aktualizacja",
     "docx-natywny-2.js", "docx-natywny-2.js", None),
    ("R9-B/stare-kroje", "stary plik krojow PDF zostaje dla kart otwartych przed aktualizacja",
     "vfs_fonts.js", "this.pdfMake.vfs", None),
    ("R9-C/docx-data", "DOCX: data przy zrodle z twardymi spacjami (generator w wersji 4)", "docx-natywny-4.js",
     "var data = dataEl ? String(dataEl.textContent || '').replace(/[()]/g, '').replace(/\\s+/g, ' ').trim().replace(/ /g, '\\u00a0') : '';", None),
    ("R9-C/stare-pliki", "generator DOCX w wersji 3 zostaje dla kart otwartych przed aktualizacja",
     "docx-natywny-3.js", "docx-natywny-3.js", None),
]

# Pliki serwera i narzedzi (sciezka od katalogu repozytorium): (kod, opis, plik, jest, niema).
KONTROLE_PLIKOW = [
    ("R9-C/poczta-znak", "e-maile: znak marki w naglowku jako obrazek w samej wiadomosci (Content-ID), napis CONTENT AI tekstem",
     "serwer/poczta-szablony.js", "<img src=\"cid:${ZNAK_CID}\" width=\"22\" height=\"22\" alt=\"\"", "<img src=\"http"),
    ("R9-C/poczta-zalacznik", "e-maile: plik znaku dolaczany do wiadomosci w Resend (content_id), tylko gdy HTML go wola",
     "serwer/poczta.js", "content_type: 'image/png', content_id: szablony.ZNAK_CID }", None),
    ("R9-C/poczta-plik", "e-maile: plik znaku marki (narzedzia/grafiki_marki.js)", "serwer/zasoby/poczta-znak.png", None, None),
    ("R9-C/cli-zwrot-email", "CLI: zwrot, platnosci-synchronizuj i platnosci-powiaz przyjmuja e-mail (konta k-... szukano w 'lista')",
     "serwer/platnosci-cli.js", "return String(arg).includes('@') ? magazyn.kontoPoEmailu(arg) : magazyn.konto(String(arg));",
     "const konto = login ? magazyn.konto(login) : null;"),
    ("R9-C/cli-konta-email", "CLI: haslo, plan, rola i usun przyjmuja e-mail jak pokaz",
     "serwer/uzytkownicy.js", "if (['haslo', 'plan', 'rola', 'usun'].includes(polecenie) && login && String(login).includes('@')) {", None),
    ("R9-C/logowanie-rejestracja", "rejestracja zapisuje ostatnie logowanie (loguje od razu; 'pokaz' mial '-')",
     "serwer/konta.js", "regulaminCzas: teraz, ostatnieLogowanie: teraz });", None),
    ("R9-C/logowanie-reset", "nowe haslo z linku zapisuje ostatnie logowanie (loguje od razu)",
     "serwer/konta.js", "emailPotwierdzony: k.emailPotwierdzony || teraz, ostatnieLogowanie: teraz });", None),
    # Runda P (promocja): agencja-ux D1, copywriter (formy bezosobowe), agencja-strona-projekt (ramka w hero).
    ("RP/powitanie-wysylka", "e-mail powitalny po pierwszym potwierdzeniu adresu (konto na wlasnym kluczu; wczesniej szablon byl, wysylki nie)",
     "serwer/konta.js", "if (wynik === 'potwierdzony' && rec.rodzaj === 'potwierdzenie') powitaj(kontekst, magazyn.konto(rec.login));", None),
    ("RP/powitanie-tresc", "powitanie: klucz to osobne konto (nie subskrypcja czatu Claude), okolo 10 minut przy komputerze, 1-3 dokumenty",
     "serwer/poczta-szablony.js", "subskrypcja czatu Claude nie daje klucza API. Konto, doładowanie i klucz to około 10 minut, najwygodniej przy komputerze.",
     "'2. Dodaj do bazy wiedzy dokumenty firmy: ofertę, cennik, opis usług. Model pisze z nich, a nie z pamięci.'"),
    ("RP/poczta-formy", "e-maile: formy bezosobowe wobec czytelnika ('bez Twojej wiedzy', nie 'zakladales')",
     "serwer/poczta-szablony.js", "Jeśli konto zostało założone bez Twojej wiedzy, zignoruj tę wiadomość", "Jeśli to nie Ty zakładałeś konto"),
    ("RP/platnosci-formy", "ekrany platnosci: formy bezosobowe wobec czytelnika ('Od zakupu pakietu minelo', nie 'Kupiles')",
     "serwer/ekrany-platnosci.js", "sekcjaOdstapOpis: 'Od zakupu pakietu minęło mniej niż 14 dni?", "Kupiłeś pakiet"),
    ("RP/ramka-fakty", "strona: ramka w hero zaczyna od pelnego przykladu z Faktami (6 s), potem petla od Tematu",
     "showcase/zasoby/strona.js", "var czasKroku = function (n) { return n === 5 && pierwszyPokaz ? PIERWSZY : CZAS[n - 1]; };",
     "if (bezPetli()) { krok = 5; ustawKlasy(5, true); } else ustawKlasy(0, true);"),

    # -- zgloszenie z 14.10 po wdrozeniu PR #71: ramka w hero stala pusta i sie nie ruszala --

    # Kursor nad ramka zatrzymuje petle. Trafiony w chwili miedzy cyklami (krok 0) zostawial pusta ramke
    # tak dlugo, jak lezal na ramce. Teraz pod kursorem pelny przyklad, jak po kliknieciu pauzy.
    ("RF/ramka-kursor", "strona: kursor w chwili kroku 0 pokazuje pelny przyklad, nie zatrzymuje pustej ramki",
     "showcase/zasoby/strona.js", "if (krok === 0) { krok = 5; ustawKlasy(5); ramka.classList.add('zatrzymana'); }",
     "tresc.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { wstrzymana = true; zatrzymaj(); } });"),
    # Karta schowana w trakcie zaniku zostawiala tresc przezroczysta do konca kolejnego kroku (3,4 s).
    ("RF/ramka-zanik", "strona: przerwany zanik konczy reset od razu, ramka nie zostaje przezroczysta",
     "showcase/zasoby/strona.js", "if (ramka.classList.contains('zanik')) { krok = 0; ustawKlasy(0, true); }",
     "var zatrzymaj = function () { if (zegar) { clearTimeout(zegar); zegar = null; } ramka.classList.add('zatrzymana'); };"),
    # Laptop (okno ok. 1425x830) i monitor: 94-96 px pustego miejsca pod menu, dol tekstu hero poza ekranem.
    ("RF/hero-odstep", "strona: odstep pod menu zalezy od wysokosci okna (24-56 px), tekst hero na pierwszym ekranie",
     "showcase/zasoby/strona.css", ".hero{position:relative;padding:clamp(24px,4.5vh,56px) 0 0;",
     ".hero{position:relative;padding:clamp(40px,6.5vw,96px) 0 0;"),

    # -- 14.10: bez marki klienta z testow i szczegolow jego branzy w publicznym repozytorium --

    # Audyt czyta kazdy sledzony plik tekstowy. Lista slow to same skroty SHA-256 (cale slowa i rdzenie).
    ("RN/audyt-klienta", "audyt repozytorium: bez marki klienta i branzy z testow, lista slow jako skroty",
     "narzedzia/audyt_klienta.py", "def znajdz(tekst):", None),
    ("RN/ci-audyt", "CI uruchamia audyt marki klienta przy kazdej zmianie",
     ".github/workflows/kontrola.yml", "run: python3 narzedzia/audyt_klienta.py", None),
    ("RN/strona-audyt", "audyt strony sprawdza marke klienta ta sama lista (bez slowa wpisanego wprost)",
     "narzedzia/audyt_showcase.py", "for nr, slowo in audyt_klienta.znajdz(tresc):", None),

    # -- 14.10: jeden znak marki (A) wszedzie --
    # Strona, logowanie i dokumenty prawne mialy znak B (ramiona z przerwami, kolo w srodku), a aplikacja, e-maile i Stripe znak A.
    ("ZA/strona", "strona: symbol i-znak (naglowek i stopka) to znak A",
     "showcase/zrodlo/czesci/ikony.html", '<symbol id="i-znak" viewBox="0 0 32 32"><g fill="currentColor" stroke="none"><path d="M16 1 L19.8 12.2',
     "L18.82 12.33"),
    ("ZA/logowanie", "logowanie i rejestracja: logo i favicon ze znaku A",
     "serwer/logowanie.js", "const ZNAK_SCIEZKA = 'M16 1 L19.8 12.2 L18.12 13.88", "L18.82 12.33"),
    ("ZA/dokumenty", "dokumenty prawne: logo i favicon ze znaku A",
     "serwer/dokumenty-prawne.js", "const ZNAK = 'M16 1 L19.8 12.2 L18.12 13.88", "L18.82 12.33"),
    # Ikony aplikacji i strony, obrazki OG, grafiki README i ikony natywne z jednego generatora (mialy znak B albo stara gwiazde).
    ("ZA/generator", "generator grafik marki: ikony, obrazki OG, README i ikony natywne ze znaku A",
     "narzedzia/grafiki_marki.js", "{ pliki: ['showcase/obrazy/og-pl.png'], w: 1200, h: 630", None),
    ("ZA/test", "test znaku: sciezka w kodzie i znak w kazdym obrazku (otwor w srodku, ramiona bez przerw)",
     "narzedzia/test_znak.js", "function znakA(obraz, [x, y, s]) {", None),
    ("ZA/ci", "CI uruchamia test znaku przy kazdej zmianie",
     ".github/workflows/kontrola.yml", "run: node narzedzia/test_znak.js", None),
    ("ZA/android", "Android: tlo ikony adaptacyjnej takie jak ikona aplikacji",
     "pakowanie/capacitor/android-res/res/values/ic_launcher_background.xml", "#141413", "#07080D"),
    # LinkedIn i Facebook trzymaja obrazek pod adresem: bez odcisku podglad linku pokazywalby stary znak.
    ("ZA/og-odcisk", "strona: og:image z odciskiem tresci, nowy obrazek w podgladach linkow od razu",
     "narzedzia/buduj_strone.py", "'og_obraz': DOMENA + '/obrazy/og-%s.png?v=%s' % (jezyk, odcisk('obrazy/og-%s.png' % jezyk)),",
     "'og_obraz': DOMENA + '/obrazy/og-%s.png' % jezyk,"),
]


def sprawdz_tresc_plikow(cicho=False):
    korzen = Path(__file__).resolve().parent.parent
    bledy = []
    for kod, opis, plik, jest, niema in KONTROLE_PLIKOW:
        sciezka = korzen / plik
        powod = None
        if not sciezka.is_file():
            powod = "brak pliku " + plik
        elif jest is not None or niema is not None:
            tresc = sciezka.read_text(encoding="utf-8")
            if jest is not None and jest not in tresc:
                powod = "brak sladu poprawki"
            elif niema is not None and niema in tresc:
                powod = "wrocil stan sprzed poprawki"
        if powod:
            bledy.append((kod, opis, powod))
            if not cicho:
                print(f"    BLAD  {kod:20} {opis}\n          -> {powod}")
        elif not cicho:
            print(f"    ok    {kod:20} {opis}")
    return bledy


def sprawdz_tresc_bibliotek(cicho=False):
    katalog = Path(__file__).resolve().parent.parent / "app" / "pwa" / "lib"
    bledy = []
    for kod, opis, plik, jest, niema in KONTROLE_BIBLIOTEK:
        sciezka = katalog / plik
        tresc = sciezka.read_text(encoding="utf-8") if sciezka.is_file() else None
        powod = None
        if tresc is None:
            powod = "brak pliku " + plik
        elif jest is not None and jest not in tresc:
            powod = "brak sladu poprawki"
        elif niema is not None and niema in tresc:
            powod = "wrocil stan sprzed poprawki"
        if powod:
            bledy.append((kod, opis, powod))
            if not cicho:
                print(f"    BLAD  {kod:20} {opis}\n          -> {powod}")
        elif not cicho:
            print(f"    ok    {kod:20} {opis}")
    return bledy


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


def sprawdz_biblioteki(html, wariant, cicho=False):
    """Kazdy plik pwa/lib/..., ktory wczytuje wariant, lezy w app/pwa/lib. Runda A: plik krojow PDF dostal
    nowa nazwe (pwa/lib idzie z immutable na rok), a wariant ze stara nazwa wczytalby plik, ktorego nie ma."""
    katalog = Path(__file__).resolve().parent.parent / "app" / "pwa" / "lib"
    nazwy = sorted(set(re.findall(r"pwa/lib/([A-Za-z0-9._-]+\.js)\b", html)))
    brak = [n for n in nazwy if not (katalog / n).is_file()]
    if brak:
        powod = "brak pliku: " + ", ".join(brak)
        if not cicho:
            print(f"    BLAD  {'L/pwa-lib':20} {powod}")
        return [("L/pwa-lib", "pliki pwa/lib wczytywane przez wariant istnieja", powod)]
    if not cicho:
        print(f"    ok    {'L/pwa-lib':20} {len(nazwy)} plikow pwa/lib wczytywanych przez wariant istnieje")
    return []


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
        bledy += sprawdz_biblioteki(html, w, args.cicho)
        zrobione += 1
        wszystkie_bledy += [(w, *b) for b in bledy]
        if not args.cicho:
            print(f"    {zrobione} kontroli, bledow: {len(bledy)}")

    if not args.wariant:
        if not args.cicho:
            print("\n  warianty w repo")
        bledy = sprawdz_warianty_w_repo(zrodlo, args.cicho)
        wszystkie_bledy += [("repo", *b) for b in bledy]
        if not args.cicho:
            print("\n  biblioteki pwa/lib")
        bledy = sprawdz_tresc_bibliotek(args.cicho)
        wszystkie_bledy += [("lib", *b) for b in bledy]
        if not args.cicho:
            print("\n  pliki serwera i narzedzi")
        bledy = sprawdz_tresc_plikow(args.cicho)
        wszystkie_bledy += [("pliki", *b) for b in bledy]

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
