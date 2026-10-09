---
tytul: Content AI privacy policy
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
English version of prywatnosc.pl.md (same sections, same version). Rendered at /dokumenty/prywatnosc?lang=en.
Conditional blocks appear only when the service is enabled in the server configuration (NVIDIA_KEY,
DATAFORSEO_LOGIN, ELEVEN_KEY). DRAFT FOR LEGAL REVIEW.
-->

Short and to the point: what we collect, why, how long we keep it and who we share it with. This policy covers the content-ai.net site, the app at app.content-ai.net, payments and emails.

## 01. Who is responsible for your data

The data controller is WSTAW_TUTAJ_IMIE_I_NAZWISKO, address: WSTAW_TUTAJ_ADRES, who runs the Content AI service as a natural person ("we"). For data protection matters write to WSTAW_TUTAJ_EMAIL. We have not appointed a data protection officer because we are not required to.

## 02. What data we collect

**The content-ai.net site.** The site loads no scripts, fonts or analytics from third-party servers and sets no cookies. It only remembers your light or dark theme choice, in your browser. The site is delivered by the Cloudflare network, which processes technical connection data such as IP addresses in doing so.

**Account.** Your email address and whether it has been confirmed, a hash of your password (we never store the password itself; the hash is computed with scrypt and a random salt), the account creation date, the interface language, your plan and its status, plan usage counters, a record of your acceptance of the Terms and the privacy policy and of statements made at purchase (with date and document version), and your customer and subscription identifiers in the Stripe payment system. If you enter company details (name, description, domains, brand voice), we store them too.

**Knowledge base.** Documents you add to the server knowledge base, their names and text fragments. We search them by keywords.
{{?nvidia}}
For team accounts that we created before self-service registration was available, we also compute vectors for the fragments (a numerical description of the content, used for search by meaning).
{{/nvidia}}

**Content you work on.** The server does not store finished texts or their history on disk: they stay in your browser. The server keeps the result of each task (for example an article, image or recording) in memory for up to 15 minutes, so it can return it after a dropped connection, and then deletes it.

**API keys.** Your keys for AI providers are kept only by your browser, in an encrypted cookie that no script on the page can read. With each request the browser sends them to our server, which decrypts the key only for the duration of the request and passes it to the provider. We do not store the key on disk or write it to logs.

**Payments.** You enter card details directly in the Stripe form; we have no access to them. From Stripe we receive: your name or company name, email address, country and billing address, amount, currency, date and status of the payment, and refund information.

**Emails.** We send you emails about your account and order, for example address confirmation, a password reset link and the contract confirmation. We do not send newsletters.

**Correspondence and notices.** Messages you send us, complaints, notices of withdrawal, notices of illegal content.

**Technical data.** The server technical log does not contain the IP addresses of regular requests or API keys, but it may contain, for example, SERP analysis keywords and error messages. In exceptional situations related to abuse prevention it may contain part of a network address. To protect sign-in and registration, the server counts attempts per IP address and blocks them temporarily once a limit is exceeded.

**Access requests sent through the former form.** If you sent an access request through the form on the site before self-service registration was available, we keep: your first name, email address, optionally a company or team name, the chosen plan, an optional message, the page language, the fact that you agreed to be contacted, and the date, your IP address and the domain of the site the request came from.

## 03. Why and on what legal basis

| Purpose | Legal basis (GDPR) |
|---|---|
| Creating and running your account, operating the app, the knowledge base, generating content on your instruction, emails about your account and order | performance of a contract, Art. 6(1)(b) |
| Payments, confirmations, receipts, sales records, handling withdrawals and complaints | legal obligations (tax and consumer law), Art. 6(1)(c), and performance of a contract |
| Security of the service, abuse prevention (sign-in and registration limits), technical log | our legitimate interest, Art. 6(1)(f) |
| Establishing, exercising and defending legal claims (for example the record of acceptance of the Terms and statements at purchase) | our legitimate interest, Art. 6(1)(f) |
| Handling notices of illegal content (Digital Services Act) | legal obligation, Art. 6(1)(c) |
| Replying to an access request sent through the former form | steps at your request before entering into a contract, Art. 6(1)(b) |

We do not share data for advertising. We do not make decisions about you based solely on automated processing that produce legal effects, and we do not profile you. Plan limits are counted automatically according to the price list you accept.

Your email address and password are needed to create an account, and payment details to buy a plan; without them we cannot conclude the contract.

## 04. How long we keep it

| Data | Period |
|---|---|
| Account data | until the account is deleted |
| Record of acceptance of the Terms and statements at purchase | until the limitation period for claims expires |
| Knowledge base documents | until you delete them or delete your account |
| Plan usage counters | monthly periods older than a year are deleted automatically |
| Task result in server memory | up to 15 minutes |
| Payment data and sales records | 5 years from the end of the tax year in which the payment was made |
| Server technical log | 30 days |
| Server backups | may still contain deleted data for 30 days, after which they are overwritten |
| Access requests sent through the former form | up to about 365 days after they are sent, after which they are deleted automatically |

## 05. Who we share data with

The data can be accessed by us and by the companies that help us provide the service. The current, versioned list of these companies is on the [List of sub-processors]({{URL_PODPRZETWARZAJACY}}) page.

| Recipient | Purpose | Where |
|---|---|---|
| Hetzner Online GmbH | the server that runs the app and stores account data and the knowledge base | Germany |
| Cloudflare, Inc. | delivering the content-ai.net site and domain name services | USA and global network |
| Stripe Payments Europe, Limited | payment processing; for fraud prevention and legal compliance Stripe acts as a separate controller | Ireland, USA |
| Resend, Inc. | sending emails about your account and order | USA |
| Anthropic Ireland, Limited | text generation: on your API key or, for team accounts we created, on our key | Ireland, USA |
| OpenAI Ireland Ltd | images, speech synthesis, transcription: on your API key or, for team accounts we created, on our key | Ireland, USA |
| ElevenLabs | speech synthesis, only on your API key | per the ElevenLabs terms |
{{?nvidia}}
| NVIDIA Corporation | computing vectors for knowledge base document fragments and queries, only for team accounts we created | USA |
{{/nvidia}}
{{?dataforseo}}
| DataForSEO | Google search results for the keyword you enter (we send only the keyword) | {{DO_UZUPELNIENIA: DataForSEO location}} |
{{/dataforseo}}

The server passes the content a task needs (for example the topic, brief, matching knowledge base passages, text to be read aloud or a recording to transcribe) to the AI model provider. When you use your own API key, this happens on your own account with the provider and under your own agreement with it; our server only forwards the request. The AI providers we use commit in their API terms not to train models on submitted content (OpenAI: by default) and may keep it for a short time to detect abuse (for example OpenAI for up to 30 days).

We may also disclose data to public authorities where the law requires it.

**Browser dictation.** If you choose the dictation built into your browser, speech recognition is performed by the browser and its maker (for example in Chrome the audio may be sent to Google's servers), not by our server.

## 06. Transfers outside the European Economic Area

Some of the companies in section 05 operate outside the European Economic Area or use subcontractors outside it. Data reaches them with the safeguards provided for in the GDPR: the European Commission adequacy decision for US companies participating in the EU-U.S. Data Privacy Framework, or the standard contractual clauses adopted by the Commission. You can obtain a copy of the safeguards by writing to us.

## 07. Cookies and browser storage

The content-ai.net site itself sets no cookies; it only remembers your theme choice, in your browser.

The app at app.content-ai.net sets:

| Cookie | Purpose | How long |
|---|---|---|
| cai_auth | sign-in session | until you sign out, at most 14 days |
| cai_motyw | your light or dark theme, set when you change the theme | one year |
| __Secure-cai_k_a, __Secure-cai_k_o, __Secure-cai_k_e | your encrypted Anthropic, OpenAI and ElevenLabs API keys, bound to your account | with "Remember on this device" 30 days, without it until the browser is closed |

No script on the page and no other account can read the key cookies. A remembered key stays in the browser after a normal sign-out; it is removed by the "Remove key" button, signing out on all devices, changing or resetting your password and deleting your account.

The app keeps your text history, draft, settings and WordPress or Drupal access details in your browser storage, separately for each account. You can delete them by clearing your browser data for app.content-ai.net.

Payment takes place on the Stripe page (checkout.stripe.com), which uses its own cookies, described in Stripe's privacy policy. We do not load Stripe scripts on Content AI pages.

All of these cookies and storage items are strictly necessary for features you ask for, so we do not ask for consent. We do not use analytics or advertising cookies. Our emails contain no open-tracking pixels or click-tracking redirects.

## 08. Artificial intelligence and your content

- Content AI supports the transparency requirements of Article 50 of Regulation (EU) 2024/1689 (the AI Act): files and content generated in the app are marked in a machine-readable format wherever the format allows it. These marks contain no personal data about you. AI providers may add their own invisible watermarks; according to them, these contain no information about the user. Details: the "AI Act and transparency" page ({{URL_AI_ACT}}).
- Before adding a document to the knowledge base, check that it contains no personal data of employees or customers that you do not need. If you enter personal data you are responsible for, we process it on your behalf under the [data processing agreement]({{URL_DPA}}) (annex to the Terms).

## 09. Your rights

You have the right to access, rectify and erase your data, to restrict its processing, to data portability and to object to processing based on our legitimate interest. If you gave consent, you can withdraw it at any time without affecting earlier processing. We reply within one month.

You can download your account data and delete your account in the account settings of the app. For anything else write to WSTAW_TUTAJ_EMAIL.

You can also lodge a complaint with the Polish data protection authority, the President of the Personal Data Protection Office (ul. Stawki 2, 00-193 Warsaw, https://uodo.gov.pl), or with the authority in your EU country of residence.

## 10. Changes to this policy

We will inform you of material changes to this policy by email and in the app. Each version has a number and date shown at the top of the page; previous versions are available on request.
