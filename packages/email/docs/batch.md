# Batch sending

`sendEmailBatch` is for transactional mail that goes to a list at once — monthly invoices, a rota change for a team, a status update for every member of an organisation — where the project must know afterwards, per recipient, whether the mail went out. It is not a newsletter or marketing tool: there are no unsubscribe links, no audience management and no sending schedule, and the framework does not intend to grow them ([ADR 0070](../../../docs/decisions/0070-email-batch-keys-follow-content-and-a-blocked-sender-stops.md)).

Each mail travels through `sendEmail`, so header sanitizing, the `preEmailSend`/`postEmailSend` hooks, the send timeout and log redaction apply per mail exactly as for a single send. A consent or suppression hook therefore covers batch mail without extra wiring.

## Reading the outcome

Every recipient gets one of three outcomes:

- **sent** — the provider accepted the mail. That is not proof of delivery.
- **not-sent** — the mail definitely did not leave: refused batch, aborted before it started, no sender or template, a hook veto, a missing `from`, a provider refusal (HTTP 429 or a rejected key), or skipped because its sender was blocked earlier in the batch.
- **unknown** — the mail may or may not have gone out: a timeout or abort after the provider was reached, a thrown adapter error, or any provider failure that does not say otherwise.

Treat **unknown** as possibly delivered. Retrying it with a fresh key can mail the recipient twice ([ADR 0034](../../../docs/decisions/0034-email-timeout-means-delivery-outcome-unknown.md)). A failed item also carries the provider's own error code and status where the adapter supplies them, so a project can tell a used-up quota from a rejected address.

## A sender that refuses everything

Some failures say nothing about the mail and everything about the sender: a used-up daily or monthly quota, or rejected credentials. After the first one, the rest of that sender's mails are skipped as not-sent (`sender-blocked`, with the code that blocked it) instead of each collecting the same refusal. Mails routed through another sender carry on. A per-second rate limit does not count: it clears within a second, so set a per-second bound instead.

## Retrying safely

Give the batch a stable key for the logical send, store it, and reuse it when retrying. Each mail's key is derived from that key, the address and everything the mail carries (subject and body, or template and data, plus sender, reply-to, copies, custom headers and attachments), not from its position, so reordering or removing rows leaves the other keys intact. Two identical mails to one address share a key and go out once. Changing the shared content between attempts changes every key, so a retry after such an edit sends the new version to everyone again; where that matters, give each recipient its own key. That key must be unique per distinct mail, not per recipient: Resend refuses a key reused for a different mail within 24 hours, and the mail ends as unknown. So a reminder for invoice 123 needs `invoice-123:reminder-1`, not the `invoice-123` the invoice itself used. Only providers with native de-duplication (Resend) skip mails that already went out; SMTP and the console sender ignore keys, so a retry there mails every recipient again. Resend also forgets keys after a day.

## What stays with the project

The batch validates nothing about recipients: address syntax, duplicates, opt-outs and how many mails a user may trigger belong to the project, which knows its data and its rules. The only limit inside the batch is a maximum list size that refuses the whole batch rather than silently truncating it.

Concurrency bounds mails in flight; providers also limit requests per second, so set a per-second bound when a list is large enough to hit it. A rate-limited mail is not retried.

## Error reports

A batch sends the error tracker one event per failure reason, with the number of recipients it hit, instead of one event per failed mail. A wrong API key in a batch of 500 is one event saying so 500 times, not 500 events that exhaust the tracker quota and bury other errors. Reasons that differ only by an echoed address are grouped, and the address never reaches the tracker. A throwing `preEmailSend`/`postEmailSend` handler is grouped the same way; it does not change the mail's outcome. The server log still has one redacted line per failed mail, and the batch result names each recipient's reason.

## Tokens

`{{token}}` substitution is deliberately small: values are inserted, never interpreted, and an unknown token — or one whose value is missing or `null` — stays visible in the sent mail so a typo or a gap in the data is noticed instead of silently blank. Only a deliberate empty string renders empty. HTML bodies escape values; subject and text bodies do not, since they are plain text. A value placed in a link must be a URL the project built itself — escaping prevents broken markup, not a hostile `javascript:` link. For conditional or localized content, register an `EmailTemplate` and use the prepared-messages form instead.

Without a text body, the shared form generates one from each rendered HTML body, keeping link targets next to their labels. A mail with a plain-text part is less likely to be filed as spam, and text-only clients get something readable. Pass `text` when the generated version is not good enough.

Copy recipients (`cc`/`bcc`) on the shared form go on the first mail only, so a manager copied on a 200-recipient batch receives one mail instead of 200.
