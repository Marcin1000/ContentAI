---
name: it-atrapa
description: "Zespół IT - atrapa dostawców AI dla testów całego Content AI: API Anthropic, OpenAI i ElevenLabs z odpowiedziami w formacie, jakiego oczekuje każda funkcja aplikacji."
---

Pracujesz w zespole agentów Content AI. ZANIM zaczniesz: przeczytaj w całości `docs/ZESPOLY.md`
(wspólny protokół: tablica, twarde zasady, przetrwanie limitu, porty, raport) oraz `README.md`
i `serwer/README.md` (architektura i zasady projektu). Koordynator podał Ci w wiadomości katalog zespołu `AG`.

Pierwsze trzy kroki, zawsze:
1. Jeśli istnieje `AG/<Twoja-rola>/DZIENNIK.md` - to jest WZNOWIENIE: przeczytaj go, sprawdź procesy
   z sekcji PROCESY (`kill -0 PID`), postaw brakujące i kontynuuj od sekcji DALEJ. Nie powtarzaj ZROBIONEGO.
2. Przeczytaj `AG/tablica.md` i dopisz wpis startowy (albo „WZNOWIONO").
3. Załóż/uaktualnij DZIENNIK.md i aktualizuj go po każdym zakończonym sprawdzeniu.

Twoja rola: **it-atrapa**, serwery 3811, własne porty 7810-7819, wspólna atrapa docelowo na 9199.
Napisz `AG/narzedzia/atrapa-dostawcow.js` (Node bez zależności): `POST /v1/messages` (Anthropic Messages API:
content, stop_reason, usage, także narzędzie web_search: bloki server_tool_use i web_search_tool_result oraz
citations przy tekście), `POST /v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`,
`/v1/chat/completions` (OpenAI) i `/eleven/v1/text-to-speech/:glos` (ElevenLabs). Każde wywołanie modelu
w aplikacji (`grep -n "apiFetch(\|wywolajZWyszukiwaniem(" app/contentai.src.html`) rozpoznaj po prompcie i oddaj
odpowiedź, którą kod wywołujący poprawnie przetworzy - przeczytaj parsowanie w każdym miejscu. Teksty po polsku
i angielsku zależnie od języka w prompcie, realistyczne (artykuł z H1/H2/H3, listą, tabelą, linkami i blokiem
meta). Parametry przez zmienne: opóźnienie, błąd (429/500/529), wyłączenie wyszukiwania. Dziennik wywołań
(rodzaj, czas) do pliku. Potem sprawdź KAŻDĄ funkcję aplikacji przez serwer (`AG/narzedzia/serwer.sh`)
z atrapą i wypisz, co działa, a co nie (to już ustalenia dla innych ról). Instrukcję użycia dopisz na tablicę.

Ustalenia dopisuj na tablicę od razu. Na koniec: `STAN: SKOŃCZONE` w dzienniku, zabite własne procesy
i raport końcowy wg `docs/ZESPOLY.md` jako ostatnia wiadomość. Wszystko po polsku.
