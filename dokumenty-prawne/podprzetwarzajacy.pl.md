---
tytul: Lista dalszych podmiotów przetwarzających
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
PR8-30: lista wersjonowana, publikowana. Każda zmiana listy = nowa wersja w nagłówku, nowy wiersz w historii zmian
(test serwera sprawdza, że wersja z nagłówka jest w historii) i e-mail do Użytkowników 14 dni przed zmianą
(umowa powierzenia, § 4 ust. 2). Ta sama treść jest Załącznikiem A do umowy powierzenia.
Konfiguracja produkcji (DECYZJE-R9): bez NVIDIA, DataForSEO i klucza ElevenLabs po stronie serwera, więc te wiersze
są w blokach warunkowych i pokazują się dopiero po włączeniu usługi w konfiguracji serwera.
-->

Lista podmiotów, którym Content AI powierza przetwarzanie danych osobowych wprowadzanych przez Użytkowników, na podstawie [umowy powierzenia]({{URL_DPA}}) (§ 4). O planowanym dodaniu lub zmianie podmiotu informujemy e-mailem co najmniej 14 dni wcześniej.

## Wszystkie konta

| Podmiot | Zakres | Lokalizacja | Podstawa przekazania poza EOG |
|---|---|---|---|
| Hetzner Online GmbH | serwer Serwisu: dane Kont, Baza wiedzy, kopie zapasowe | Niemcy | nie dotyczy |
| Resend, Inc. | wysyłka wiadomości e-mail związanych z Kontem | USA | EU-U.S. Data Privacy Framework, standardowe klauzule umowne |
| Stripe Payments Europe, Limited | płatności (dane płatnika, bez danych z Bazy wiedzy) | Irlandia, USA | EU-U.S. Data Privacy Framework, standardowe klauzule umowne |
| Cloudflare, Inc. | obsługa nazw domen i dostarczanie strony content-ai.net; aplikacja app.content-ai.net działa z pominięciem sieci Cloudflare | USA, sieć globalna | EU-U.S. Data Privacy Framework, standardowe klauzule umowne |
{{?dataforseo}}
| DataForSEO | wyniki wyszukiwania dla wpisanej frazy (przekazywana jest tylko fraza) | {{DO_UZUPELNIENIA: siedziba DataForSEO}} | {{DO_UZUPELNIENIA: podstawa przekazania}} |
{{/dataforseo}}

## Konta zespołu działające na kluczach Usługodawcy

Konta założone przez Usługodawcę przed udostępnieniem samodzielnej rejestracji mogą generować treści na kluczach API Usługodawcy. Wtedy dalszymi podmiotami przetwarzającymi są także:

| Podmiot | Zakres | Lokalizacja | Podstawa przekazania poza EOG |
|---|---|---|---|
| Anthropic Ireland, Limited (i Anthropic, PBC) | generowanie tekstu | Irlandia, USA | standardowe klauzule umowne (umowa powierzenia Anthropic) |
| OpenAI Ireland Ltd (i OpenAI OpCo, LLC) | grafika, synteza mowy, transkrypcja | Irlandia, USA | standardowe klauzule umowne lub decyzja o odpowiednim stopniu ochrony (umowa powierzenia OpenAI) |
{{?elevenlabs}}
| ElevenLabs | synteza mowy | {{DO_UZUPELNIENIA: podmiot i lokalizacja ElevenLabs}} | według umowy powierzenia ElevenLabs |
{{/elevenlabs}}
{{?nvidia}}
| NVIDIA Corporation | wektory fragmentów dokumentów Bazy wiedzy i zapytań do niej | USA | {{DO_UZUPELNIENIA: podstawa przekazania do NVIDIA (PR8-28)}} |
{{/nvidia}}

## Własne klucze API

Gdy Użytkownik korzysta z własnego Klucza API (Anthropic, OpenAI, ElevenLabs), dostawca przetwarza dane na podstawie umowy zawartej bezpośrednio z Użytkownikiem i nie jest dalszym podmiotem przetwarzającym Usługodawcy (umowa powierzenia, § 4 ust. 4). Konta zakładane samodzielnie działają wyłącznie na własnych Kluczach API.

## Historia zmian

| Wersja | Data | Zmiana |
|---|---|---|
| 2026-10-v1 | 9 października 2026 r. | pierwsza wersja listy |
