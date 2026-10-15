# Batch sending

`sendEmailBatch` is for transactional mail that goes to a list at once — monthly invoices, a rota change for a team, a status update for every member of an organisation — where the project must know afterwards, per recipient, whether the mail went out. It is not a newsletter or marketing tool: there are no unsubscribe links, no audience management and no sending schedule, and the framework does not intend to grow them ([ADR 0069](../../../docs/decisions/0069-email-batch-is-transactional-with-a-per-recipient-outcome.md)).

Each mail travels through `sendEmail`, so header sanitizing, the `preEmailSend`/`postEmailSend` hooks, the send timeout and log redaction apply per mail exactly as for a single send. A consent or suppression hook therefore covers batch mail without extra wiring.

## Reading the outcome

Every recipient gets one of three outcomes:

- **sent** — the provider accepted the mail. That is not proof of delivery.
- **not-sent** — the mail definitely did not leave: refused batch, aborted before it started, no sender or template, a hook veto, a missing `from`, or a provider rate-limit refusal (HTTP 429).
- **unknown** — the mail may or may not have gone out: a timeout or abort after the provider was reached, a thrown adapter error, or any provider failure that does not say otherwise.

Treat **unknown** as possibly delivered. Retrying it with a fresh key can mail the recipient twice ([ADR 0034](../../../docs/decisions/0034-email-timeout-means-delivery-outcome-unknown.md)).

## Retrying safely

Give the batch a stable key for the logical send, store it, and reuse it with the same list when retrying. Each mail's key is derived from that key, its position and its address, so a reordered or edited list produces different keys and can send duplicates. Only providers with native de-duplication (Resend) skip mails that already went out; SMTP and the console sender ignore keys, so a retry there mails every recipient again. Resend also forgets keys after a day.

## What stays with the project

The batch validates nothing about recipients: address syntax, duplicates, opt-outs and how many mails a user may trigger belong to the project, which knows its data and its rules. The only limit inside the batch is a maximum list size that refuses the whole batch rather than silently truncating it.

Concurrency bounds mails in flight; providers also limit requests per second, so set a per-second bound when a list is large enough to hit it. A rate-limited mail is not retried.

## Tokens

`{{token}}` substitution is deliberately small: values are inserted, never interpreted, and an unknown token stays visible in the sent mail so a typo is noticed instead of silently blank. HTML bodies escape values; subject and text bodies do not, since they are plain text. A value placed in a link must be a URL the project built itself — escaping prevents broken markup, not a hostile `javascript:` link. For conditional or localized content, register an `EmailTemplate` and use the prepared-messages form instead.

Copy recipients (`cc`/`bcc`) on the shared form go on the first mail only, so a manager copied on a 200-recipient batch receives one mail instead of 200.
