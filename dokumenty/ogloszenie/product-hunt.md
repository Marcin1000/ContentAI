# Product Hunt: formularz, galeria, dzień premiery i odpowiedzi

**Premiera: sobota 14.11.2026 o 9:01** (zapas: sobota 21.11, decyzja 7.11 według `plan.md`, punkt 5).
Formularz wypełnij i zaplanuj we wtorek 20.10 wieczorem, gdy konto będzie miało tydzień.

Product Hunt jest po angielsku, więc wszystkie pola też. Fakty zgadzają się ze stroną
https://content-ai.net/en/ (cennik, języki, klucz API, AI Act). Limity znaków policzone.

---

## Pola formularza

**Name of the product**

```text
Content AI
```

**Tagline** (limit 60 znaków). Pierwszy wariant mówi, czym produkt się wyróżnia, pozostałe są zapasowe.

| Wariant | Znaki |
|---|---|
| `SEO articles from your own docs, fact-checked against them` | 58 |
| `AI articles from your own documents, then fact-checked` | 54 |
| `Articles for Google and AI answers, from your own sources` | 57 |

**Links** (Product Hunt dopisuje do linku `ref=producthunt`, strona liczy oba znaczniki jako źródło)

```text
https://content-ai.net/en/?z=ph
```

**Description** (ten tekst ma 251 znaków, mieści się w limicie 260 ze starszej pomocy i 500 z obecnej)

```text
Content AI writes SEO articles from your own documents, not the model's memory. A fact check flags sentences your sources don't support and fixes them in one click. Scores for SEO, AIO, AEO and GEO. Free plan: 3 articles on your own Anthropic API key.
```

**Topics** (z listy Product Hunt, w tej kolejności): `SEO`, `Artificial Intelligence`, `Writing`. Gdy któregoś nie ma,
zamiennik: `Marketing`.

**Pricing**: opcja mówiąca o darmowym pakiecie i płatnych wyższych (zwykle „Free options available”).

**Thumbnail** (240 x 240): `grafiki/ph-miniatura.png`.

**Video**: link do filmu `content-ai-film-en-16x9.mp4` na YouTube (`kanaly.md`, punkt 2).

**Gallery** (1270 x 760, w tej kolejności, pierwsza grafika jest okładką):

| Plik | Co pokazuje |
|---|---|
| `grafiki/ph-1-przeglad.png` | aplikacja z artykułem i oceną SEO 91, hasło „Content for Google and AI answers. Written from your sources.” |
| `grafiki/ph-2-fakty.png` | panel Fakty: liczba bez pokrycia i twierdzenie szersze niż źródło, przycisk poprawy zdań |
| `grafiki/ph-3-oceny.png` | ocena AEO z uwagami, cztery zakładki SEO, AIO, AEO i GEO |
| `grafiki/ph-4-eksport.png` | menu Eksport: DOCX, PDF, TXT, JSON-LD i przełącznik oznaczenia AI |
| `grafiki/ph-5-cennik.png` | trzy pakiety (€0, €19, €49) i koszt modelu na własnym kluczu |

**Makers**: tylko Ty. **Hunter**: Ty sam (publikacja własnego produktu jest na Product Hunt normalna).

**Launch date**: „Schedule”, sobota 14.11. Dzień na Product Hunt zaczyna się o 00:01 czasu pacyficznego,
czyli o 9:01 w Polsce (od 25.10 do 31.10 byłoby 8:01, bo Europa zmienia czas tydzień wcześniej).

---

## Komentarz twórcy (pierwszy komentarz, od razu po starcie)

Przed 6.11 dopisz liczby i opinie z pierwszych tygodni, jeśli będą.

```text
Hi Product Hunt! I'm Marcin, the maker of Content AI.

[DO UZUPEŁNIENIA: 1-2 zdania po angielsku, skąd pomysł i od kiedy nad nim pracujesz. Bez nazw firm.]

The problem I kept running into: AI drafts read well, but figures, product details and links quietly come from the model's memory. “Setup usually takes 2 days” sounds right. Then you check, and none of the company's documents says so.

Content AI starts from your own documents: offers, price lists, reports, notes or web pages. Upload 1-3 of them before the first article, and every draft is written from the passages that match the topic. Without documents, it writes from web pages and lists them as sources. Then it checks its own work:
• Fact check: it compares the draft with your sources and flags figures they don't support, claims wider than the source, contradictions and dead links, quoting each fragment. One click asks the model to remove or soften them, without adding new facts.
• Four scores with notes: SEO (Google results), AIO (AI Overviews), AEO (direct answers) and GEO (citations in AI chats).
• Export to DOCX or PDF with an AI label in the file metadata, or publish to WordPress and Drupal (Standard plan). A visible note for readers is one switch away (EU AI Act).

Two honest caveats:
1. It runs on your own Anthropic API key. You pay Anthropic directly, roughly $0.20-0.40 per article, with no markup from us. A Claude chat subscription does not include API access, so this is a separate account in the Anthropic Console. Getting a key and adding credit takes about 10 minutes.
2. Paid plans need an EU billing address for now. The Free plan (3 articles) works everywhere.

Content can be written in English, Polish, German and Czech.

What I'd love to hear: where would you still not trust an AI draft, and would a check like this change that? I'm here all day to answer.
```

---

## Dzień premiery

| Kiedy | Co robisz |
|---|---|
| pt 13.11, wieczór | Resend Pro włączony, kontrola serwera (`README.md`, punkt 3), wiadomość „jutro” do wspierających (niżej) |
| sb 14.11, 9:01-9:05 | Strona premiery działa, komentarz twórcy |
| 9:15 | Pierwsza tura wiadomości 1:1 (Europa): link do strony premiery i prośba o opinię |
| 9:30 | Post EN na LinkedIn (`linkedin.md`, #9), link do premiery w pierwszym komentarzu |
| 10:00-24:00 | Odpowiedzi na Product Hunt w ciągu około 30 minut, serwer co 2-3 godziny, osobiste maile do nowych kont wieczorem |
| 13:00 | Druga tura wiadomości (reszta Europy) |
| 15:00-18:00 | Trzecia tura (USA), r/SideProject i Indie Hackers (niżej) |
| nd 15.11, 9:00 | Koniec dnia premiery. Podziękowanie w komentarzu na Product Hunt i pod postem |

---

## Wiadomości do wspierających (zawsze prośba o opinię, nigdy o głos)

Lista 50 osób z aktywnym kontem na Product Hunt (`plan.md`). Wysyłaj pojedynczo.

**25.10, zapowiedź**

```text
Cześć [imię], w sobotę 14 listopada Content AI startuje na Product Hunt. Zależy mi na szczerych opiniach osób, które piszą treści, więc w dniu premiery podeślę link. Jeśli wolisz nie dostawać takich wiadomości, daj znać, nie będę pisał.
```

```text
Hi [name], on Saturday, 14 November, Content AI launches on Product Hunt. I care about honest feedback from people who write content, so I'll send you the link on launch day. If you'd rather not get messages like this, just tell me.
```

**31.10, konto na Product Hunt**

```text
Cześć [imię], krótko przed premierą 14.11: jeśli zechcesz zostawić opinię na Product Hunt, potrzebne jest tam konto. Założenie trwa chwilę, na przykład przez logowanie LinkedIn. Link do premiery wyślę w sobotę rano.
```

```text
Hi [name], a quick note before the launch on 14 November: if you'd like to leave feedback on Product Hunt, you need an account there. It takes a moment, for example by signing in with LinkedIn. I'll send the launch link on Saturday morning.
```

**13.11, „jutro”**

```text
Cześć [imię], jutro o 9:01 Content AI startuje na Product Hunt. Link wyślę rano. Najbardziej pomoże mi jedno szczere zdanie: co warto zmienić.
```

```text
Hi [name], Content AI launches on Product Hunt tomorrow at 9:01 CET. I'll send the link in the morning. One honest sentence about what to change would help the most.
```

**14.11, dzień premiery**

```text
Cześć [imię], dziś Content AI jest na Product Hunt. Jeśli masz chwilę, zajrzyj i napisz tam, co myślisz, także krytycznie: [link]. Każda konkretna uwaga bardzo mi pomoże.
```

```text
Hi [name], Content AI is on Product Hunt today. If you have a minute, I'd love your honest take there, critical is fine: [link]. Any concrete note helps a lot.
```

---

## Reddit i Indie Hackers (tylko 14.11)

Przed wpisem przeczytaj zasady miejsca. Reddit wymaga udziału w rozmowie, nie samych linków.

**r/SideProject** (wątek tygodniowy):

```text
Content AI: AI articles written from your own documents, then fact-checked against them.

The problem: AI drafts read well, but figures and product details come from the model's memory. Content AI writes from your knowledge base (PDF, DOCX, XLSX, PPTX, notes and web pages), flags sentences your sources don't support and fixes them in one click without adding new facts. It also scores each draft for SEO, AIO, AEO and GEO.

Built by one person, launched on Product Hunt today. It runs on your own Anthropic API key (roughly $0.20-0.40 per article). Free plan: 3 articles.

Blunt feedback welcome: where would you still not trust an AI draft?
https://content-ai.net/en/?z=reddit
```

**Indie Hackers**, tytuł:

```text
Launching a fact-checking AI writer on a Saturday: what I learned in the first month
```

Treść:

```text
I launched Content AI publicly on 12 October. It writes articles from a company's own documents and then checks the draft against them: figures the sources don't support, claims wider than the source, contradictions and dead links.

A few decisions that shaped it:
1. Bring your own key. Drafts run on the user's Anthropic API key, so there is no markup on the model. It keeps my costs flat, but it adds friction: a Claude chat subscription does not include API access, and new users have to add credit in the Anthropic Console first.
2. No analytics. The site and the app load nothing from third-party servers. I measure with account counts and revenue only.
3. EU-only paid plans for now. The Free plan works everywhere.

First month in numbers: [DO UZUPEŁNIENIA: accounts, accounts with a first article, paid plans, best channel].

What I'd do differently: [DO UZUPEŁNIENIA: one honest sentence].

Today it is on Product Hunt. I'd love feedback from anyone who has dealt with the “bring your own key” friction: how did you lower it?
```

---

## Gotowe odpowiedzi na częste pytania

Wklejaj jako punkt wyjścia i dopasuj do pytania. Identyczne odpowiedzi pod wieloma komentarzami
wyglądają jak automat.

**Why do I need my own API key?**

```text
It keeps model costs under your control: you pay Anthropic directly, with no markup from us, and you can set a spend limit in their console. Anthropic's API is prepaid, so you add credit with a card in their console. $10 covers roughly 25-50 articles. A Claude chat subscription does not include API access, it is a separate account. Your key stays in your browser in an encrypted cookie and is passed to Anthropic with each request. Our server never writes it to disk or to logs. Setup takes about 10 minutes: https://content-ai.net/en/api-key/
```

**How much does one article cost?**

```text
Roughly $0.20-0.40 for an article of about 800 words, including the scores and the fact check. The app shows the estimated cost of every draft in History.
```

**Can I use it outside the EU?**

```text
Yes, the Free plan works everywhere. Paid plans are available for billing addresses in the EU for now.
```

**Which AI models do you use?**

```text
Drafts, the SEO and AIO scores and the fact check use Anthropic models, on your own key. The AEO and GEO scores are rule-based and run in your browser. Images, voice-over and transcription (Standard and Premium plans) use OpenAI, also on your own key, and ElevenLabs is an optional, better voice.
```

**Do you train on my documents? Where is my data?**

```text
No. Content AI does not train any models. Your documents are stored on our server at Hetzner in Germany and only your account can see them. When a draft is written, only the passages that match the topic go to Anthropic, on your own key, never whole files. Anthropic's commercial terms say they do not train models on API customer content.
```

**How is this different from asking ChatGPT?**

```text
A chat answers from the model's memory. Content AI writes from your knowledge base, goes to the web only for what is missing and lists the sources, then scores the draft for four kinds of search and checks it against your documents. All in one workspace, from topic to publishing.
```

**What do AIO, AEO and GEO mean?**

```text
SEO is classic Google results. AIO is the AI summaries above them (AI Overviews). AEO is direct answers in search engines and voice assistants. GEO is being cited in AI chats. Each needs a slightly different shape of text, so Content AI scores them separately, with a list of what to fix.
```

**Will it pass AI detectors?**

```text
That is not the goal. Content AI is built for accuracy and transparency: facts come from your sources, DOCX, PDF and JSON-LD files carry an AI label in their metadata, and a person always has the final say before publishing.
```

**Does it work for agencies and teams?**

```text
Plans are per account today. For agencies there is bulk generation from a list of topics, and from the Standard plan the SERP analysis with content gaps and publishing straight to WordPress or Drupal.
```

**Which languages?**

```text
Content in English, Polish, German and Czech. The interface is in English and Polish.
```

**Can I get a refund?**

```text
Consumers in the EU can withdraw within 14 days of purchase, as described in our Terms of Service. If the plan was already in use, the refund is reduced in proportion to the days it was active. You can cancel any time in the Stripe portal, and the plan stays active until the end of the paid month.
```

---

## Czego nie robić na Product Hunt

- Nie proś wprost o głosy („upvote”). Proś o opinię: „I'd love your feedback”. Za prośby o głosy
  i wymianę głosów Product Hunt obniża pozycję albo ukrywa produkt.
- Nie kupuj głosów ani komentarzy i nie korzystaj z grup wymiany głosów.
- Nie wysyłaj znajomym linku z prośbą o głos zaraz po starcie. Lepiej: post na LinkedIn i wiadomość
  „dziś startujemy, ciekawi mnie Twoja opinia”.
- Odznaka Product Hunt na stronie: oficjalny kod wczytuje obraz z serwera Product Hunt, a strona obiecuje,
  że nic nie ładuje z obcych serwerów. Jeśli odznaka, to jako statyczny obraz na naszym serwerze.
