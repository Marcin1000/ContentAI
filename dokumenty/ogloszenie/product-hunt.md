# Product Hunt: formularz, galeria i odpowiedzi

Product Hunt jest po angielsku, więc wszystkie pola też. Fakty zgadzają się ze stroną
https://content-ai.net/en/ (cennik, języki, klucz API, AI Act). Limity znaków policzone.

Formularz otwierasz po zalogowaniu przyciskiem „Submit” albo „Launch” w górnym pasku Product Hunt.
Konto na Product Hunt musi istnieć co najmniej tydzień, zanim opublikujesz produkt.

---

## Pola formularza

**Name of the product**

```text
Content AI
```

**Tagline** (limit 60 znaków). Proponuję pierwszy wariant, pozostałe są zapasowe.

| Wariant | Znaki |
|---|---|
| `Articles for Google and AI answers, from your own sources` | 57 |
| `AI articles from your documents, with every claim checked` | 57 |
| `SEO, AEO and GEO articles written from your own sources` | 55 |

**Links**

```text
https://content-ai.net/en/
```

**Description** (limit 260 znaków, ten tekst ma 248)

```text
Content AI writes articles from your own documents, not from the model's memory. It scores every draft for SEO, AIO, AEO and GEO, lists claims your sources do not support and exports DOCX, PDF or JSON-LD. Free plan: 3 articles, on your own API key.
```

**Topics** (wybierz z listy Product Hunt, w tej kolejności): `SEO`, `Artificial Intelligence`, `Writing`.
Gdy któregoś nie ma, zamiennik: `Marketing`.

**Pricing**: opcja, która mówi, że jest darmowy pakiet i płatne wyższe (w formularzu zwykle
„Free options available” albo podobnie).

**Thumbnail** (240 x 240): `grafiki/ph-miniatura.png`.

**Video** (pole wideo w galerii): link do filmu `content-ai-film-en-16x9.mp4` wgranego na YouTube
(instrukcja w `README.md`, punkt 5). Product Hunt pokazuje go w galerii obok grafik.

**Gallery** (1270 x 760, w tej kolejności, pierwsza grafika jest okładką):

| Plik | Co pokazuje |
|---|---|
| `grafiki/ph-1-przeglad.png` | aplikacja z artykułem i oceną SEO 91, hasło „Content for Google and AI answers. Written from your sources.” |
| `grafiki/ph-2-fakty.png` | panel Fakty: liczba bez pokrycia i twierdzenie szersze niż źródło, przycisk poprawy zdań |
| `grafiki/ph-3-oceny.png` | ocena AEO z uwagami, cztery zakładki SEO, AIO, AEO i GEO |
| `grafiki/ph-4-eksport.png` | menu Eksport: DOCX, PDF, TXT, JSON-LD i przełącznik oznaczenia AI |
| `grafiki/ph-5-cennik.png` | trzy pakiety (€0, €19, €49) i koszt modelu na własnym kluczu |

**Makers**: tylko Ty. **Hunter**: Ty sam (publikacja własnego produktu jest na Product Hunt normalna).

**Launch date**: w formularzu wybierz „Schedule” i dzień z planu w `README.md`. Start dnia na
Product Hunt to 00:01 czasu pacyficznego.

---

## Komentarz twórcy (pierwszy komentarz, od razu po starcie)

```text
Hi Product Hunt! I'm Marcin, the maker of Content AI.

AI writing tools have a well-known problem: the text reads well, but the figures, product details and links come from the model's memory. For a company blog that means rewriting, or worse, publishing something wrong.

Content AI starts from your own documents. You upload your offer, price lists, reports or notes once, and every article is written from the passages that match the topic. With web search on, it fills the gaps from the web and lists the pages it used under the draft.

Then it does the checking:
• Four scores, each with concrete notes: SEO (Google results), AIO (AI Overviews), AEO (direct answers) and GEO (citations in AI chats).
• A fact check that lists unsupported figures, claims wider than the source, contradictions and dead or invented links, quoting the fragment. One click asks the model to remove or soften them.
• Export to DOCX, PDF, TXT and JSON-LD, or publishing to WordPress and Drupal. Every file carries an AI disclosure for the EU AI Act.

It runs on your own Anthropic API key, so you pay the model provider directly with no markup from us, roughly $0.20-0.40 per article. The Free plan gives you 3 articles to start, no card needed. Content can be written in English, Polish, German and Czech.

I would love to hear what works, what gets in the way and what you would add. I'm here all day to answer questions.
```

---

## Gotowe odpowiedzi na częste pytania

Wklejaj jako punkt wyjścia i dopasuj do pytania. Identyczne odpowiedzi pod wieloma komentarzami
wyglądają jak automat.

**Why do I need my own API key?**

```text
It keeps model costs under your control: you pay Anthropic directly, with no markup from us, and you can set a spend limit in their console. Your key stays in your browser in an encrypted cookie and is passed to Anthropic with each request. Our server never writes it to disk or to logs. Setup takes about 10 minutes: https://content-ai.net/en/api-key/
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
Drafts, scores and the fact check use Anthropic models, on your own key. Images, voice-over and transcription (from the Standard plan) use OpenAI, also on your own key.
```

**Do you train on my documents? Where is my data?**

```text
No. Content AI does not train any models, and the AI providers commit in their API terms not to train on submitted content. Your documents are stored on our server at Hetzner in Germany and only your account can see them. When a draft is written, the model gets only the passages that match the topic, not whole files.
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
That is not the goal. Content AI is built for accuracy and transparency: facts come from your sources, every file carries an AI disclosure, and a person always has the final say before publishing.
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
Consumers in the EU can withdraw within 14 days of purchase, as described in our Terms of Service. You can cancel any time in the Stripe portal, and the plan stays active until the end of the paid month.
```

---

## Czego nie robić na Product Hunt

- Nie proś wprost o głosy („upvote”). Proś o opinię: „I'd love your feedback”. Za prośby o głosy
  i wymianę głosów Product Hunt obniża pozycję albo ukrywa produkt.
- Nie kupuj głosów ani komentarzy i nie korzystaj z grup wymiany głosów.
- Nie wysyłaj znajomym bezpośredniego linku z prośbą o głos zaraz po starcie. Lepiej: post na
  LinkedIn i wiadomość „dziś startujemy, ciekawi mnie Twoja opinia”.
