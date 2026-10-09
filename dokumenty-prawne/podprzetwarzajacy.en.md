---
tytul: List of sub-processors
wersja: 2026-10-v1
data: 2026-10-09
---
<!--
English version of podprzetwarzajacy.pl.md (PR8-30, versioned, published; Schedule A to the data processing
agreement). Conditional rows appear only when the service is enabled in the server configuration.
-->

The entities to which Content AI entrusts the processing of personal data entered by Users, under the [data processing agreement]({{URL_DPA}}) (section 4). We inform you by email at least 14 days before adding or replacing an entity.

## All accounts

| Entity | Scope | Location | Transfer basis outside the EEA |
|---|---|---|---|
| Hetzner Online GmbH | the Service's server: Account data, Knowledge Base, backups | Germany | not applicable |
| Resend, Inc. | sending emails about the Account | USA | EU-U.S. Data Privacy Framework, standard contractual clauses |
| Stripe Payments Europe, Limited | payments (payer data, no Knowledge Base data) | Ireland, USA | EU-U.S. Data Privacy Framework, standard contractual clauses |
| Cloudflare, Inc. | domain name services and delivery of the content-ai.net site; the app at app.content-ai.net bypasses the Cloudflare network | USA, global network | EU-U.S. Data Privacy Framework, standard contractual clauses |
{{?dataforseo}}
| DataForSEO | search results for the keyword entered (only the keyword is sent) | {{DO_UZUPELNIENIA: DataForSEO location}} | {{DO_UZUPELNIENIA: transfer basis}} |
{{/dataforseo}}

## Team accounts working on the Provider's keys

Accounts created by the Provider before self-service registration was available may generate content on the Provider's API keys. In that case the following are also sub-processors:

| Entity | Scope | Location | Transfer basis outside the EEA |
|---|---|---|---|
| Anthropic Ireland, Limited (and Anthropic, PBC) | text generation | Ireland, USA | standard contractual clauses (Anthropic DPA) |
| OpenAI Ireland Ltd (and OpenAI OpCo, LLC) | images, speech synthesis, transcription | Ireland, USA | standard contractual clauses or adequacy decision (OpenAI DPA) |
{{?elevenlabs}}
| ElevenLabs | speech synthesis | {{DO_UZUPELNIENIA: ElevenLabs entity and location}} | per the ElevenLabs DPA |
{{/elevenlabs}}
{{?nvidia}}
| NVIDIA Corporation | vectors for Knowledge Base document fragments and queries | USA | {{DO_UZUPELNIENIA: transfer basis for NVIDIA (PR8-28)}} |
{{/nvidia}}

## Own API keys

When a User uses their own API Key (Anthropic, OpenAI, ElevenLabs), the provider processes the data under an agreement concluded directly with the User and is not a sub-processor of the Provider (data processing agreement, section 4(4)). Self-created Accounts work only on their own API Keys.

## Change history

| Version | Date | Change |
|---|---|---|
| 2026-10-v1 | 9 October 2026 | first version of the list |
