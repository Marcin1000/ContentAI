---
tytul: Data processing agreement
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
English version of dpa.pl.md (Annex 1 to the Terms, Article 28(3) GDPR). Schedule A is inserted by the server from
podprzetwarzajacy.en.md. Schedule B to be confirmed by it-bezpieczenstwo. DRAFT FOR LEGAL REVIEW.
-->

This agreement is concluded when a User who enters personal data into the Service as a controller (for example an agency or a company) accepts the [Terms of Service]({{URL_REGULAMIN}}).

## 1. Parties and subject matter

1. Controller: the Content AI User who accepts the Terms (the Controller).
2. Processor: WSTAW_TUTAJ_IMIE_I_NAZWISKO, address: WSTAW_TUTAJ_ADRES, email: WSTAW_TUTAJ_EMAIL (the Processor).
3. The Controller entrusts the Processor with processing personal data contained in the content the Controller enters into the Service, to the extent and for the purpose set out in section 2.

## 2. Nature, purpose, scope and duration of processing

1. Purpose: providing the Service under the Terms: storing Knowledge Base documents, searching them, passing content to AI Providers to generate outputs on the Controller's instruction, transcribing recordings, publishing to CMS systems indicated by the Controller.
2. Nature: storage, organisation, retrieval, transmission, erasure; automated operations.
3. Types of data: data contained in the Controller's documents, briefs, topics and recordings, in particular names, contact details, job titles, statements, voice (recordings). The Controller does not enter special categories of data or data on criminal convictions unless it has a legal basis to do so and informs the Processor in advance.
4. Categories of data subjects: employees, collaborators, customers and business partners of the Controller, persons named in the Controller's documents.
5. Duration: for the period of use of the Service, until the Controller deletes the data or the Account is deleted.

## 3. Obligations of the Processor

The Processor:

1. processes data only on documented instructions from the Controller; using the Service's features in line with the Terms constitutes such instructions, including the instruction to transfer data to a third country to the extent set out in Schedule A. Where the law requires the Processor to process data, it informs the Controller before processing unless the law prohibits this;
2. ensures that persons authorised to process data have committed themselves to confidentiality;
3. applies the security measures under Article 32 GDPR described in Schedule B;
4. engages sub-processors under section 4;
5. assists the Controller, insofar as possible, in responding to data subject requests (access, rectification, erasure, restriction, portability, objection); the Service lets the Controller delete Knowledge Base documents, download Account data and delete the Account on their own;
6. assists the Controller in complying with Articles 32 to 36 GDPR, taking into account the nature of processing and the information available;
7. notifies the Controller of a personal data breach without undue delay and no later than 48 hours after becoming aware of it, with the information under Article 33(3) GDPR available at that time;
8. after the end of the services, deletes the data (the Controller may download it beforehand) unless the law requires storage; data in backups is deleted as backups are overwritten, at the latest after 30 days;
9. makes available to the Controller the information necessary to demonstrate compliance with Article 28 GDPR and allows audits (primarily through written explanations; an on-site audit after agreeing a date with at least 14 days' notice, at the Controller's cost, without access to other users' data);
10. immediately informs the Controller if, in its opinion, an instruction infringes the GDPR or other data protection law.

## 4. Sub-processors

1. The Controller gives general authorisation to engage the sub-processors listed in Schedule A ([list version {{WERSJA_PODPRZETWARZAJACY}}]({{URL_PODPRZETWARZAJACY}})).
2. The Processor informs the Controller by email of any intended addition or replacement of a sub-processor at least 14 days in advance. During that time the Controller may raise a reasoned objection; if the parties do not find a solution, the Controller may terminate the service agreement with immediate effect and the Processor refunds the price for the unused period.
3. The Processor imposes on sub-processors data protection obligations no less protective than in this agreement and remains liable for them as for its own acts.
4. **The Controller's own API keys.** When the Controller uses its own API key of an AI provider (Anthropic, OpenAI, ElevenLabs) in the Service, the provider processes the data under an agreement concluded directly with the Controller (that provider's terms and data processing addendum). In that case the provider is not a sub-processor of the Processor, and the Processor only forwards the Controller's request to that provider without storing the key or the content.

## 5. Transfers outside the EEA

Data is transferred to a third country only to the entities in Schedule A, on the basis of a Commission adequacy decision (including the EU-U.S. Data Privacy Framework for certified entities) or the standard contractual clauses (Commission Implementing Decision (EU) 2021/914) concluded by the Processor or by the sub-processor.

## 6. Liability and final provisions

1. The parties' liability is governed by Article 82 GDPR and otherwise by the Terms.
2. This agreement applies for as long as the services are provided and expires with the Account agreement, subject to the obligations in section 3(8).
3. Matters not covered are governed by the GDPR and Polish law. In case of conflict with the Terms on data protection matters, this agreement prevails.

## Schedule A. Sub-processors {#zalacznik-a}

{{ZALACZNIK_PODPRZETWARZAJACY}}

## Schedule B. Technical and organisational measures {#zalacznik-b}

1. Encryption in transit: HTTPS (TLS) with an HSTS header; connections to AI providers, Stripe and Resend over HTTPS only.
2. Authentication: passwords hashed with scrypt and a random salt, with timing-safe comparison; limits on failed sign-in attempts; session in a signed HttpOnly, Secure, SameSite=Lax cookie; sessions invalidated on password change, sign-out on all devices and Account deletion.
3. Users' API keys: only in encrypted browser cookies (AES-256-GCM, bound to the Account) that page scripts cannot read; the server decrypts a key only for the duration of a request and does not store it on disk or in logs.
4. Application protection: Content Security Policy forbidding framing, nosniff and Referrer-Policy headers, request origin checks (CSRF), address checks when fetching pages (protection against requests to internal networks).
5. Data separation: every self-created Account has its own space with its own Knowledge Base and company details, invisible to other Accounts; browser data is kept separately for each Account.
6. Minimisation: the server does not store generated content on disk; task results stay in memory for at most 15 minutes; the technical log contains no IP addresses of regular requests and is kept for 30 days.
7. Integrity and availability: a transactional database, data files accessible only to the service system account; automatic database backups kept for no longer than 30 days.
8. Administrative access: only the Processor, via a private network (VPN) and a service system account with limited permissions.
9. Payments: card data is processed only by Stripe; Service pages do not load Stripe scripts.
10. Email: no tracking pixels and no click-tracking redirects; links with one-time tokens are never written to logs.
11. Procedures: the Processor keeps a record of categories of processing activities (Article 30(2) GDPR) and a register of personal data breaches.
