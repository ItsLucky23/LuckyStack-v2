---
name: email-batch-keys-follow-content-and-a-blocked-sender-stops
title: Batch mail keys follow address and content, and a sender that refuses all mail stops its part of the batch
status: accepted
date: 2026-10-16
deciders: [ItsLucky23]
tags: [email, reliability, idempotency, scope]
supersedes: [0069]
relates: [0034]
---

## Context

ADR 0069 introduced `sendEmailBatch`: transactional mail to a list, one
`sendEmail` call per message, one outcome per recipient. The first project to
adopt it (Flexbuddy) found four gaps. Keys derived from list position still
moved when a list was edited between attempts, because every recipient after a
removed row shifted. A used-up daily quota made every remaining mail collect
the same refusal. The provider's error name and status were lost, so a project
could not tell a quota from a typo in an address. And a batch with only HTML
sent no plain-text part.

## Decision

`sendEmailBatch` sends transactional mail to a list by calling `sendEmail` once
per message, a bounded number at a time with an optional per-second bound, and
returns one outcome per recipient: `sent`, `not-sent` or `unknown`. Only a
failure known to have happened before the provider accepted the mail is
`not-sent`: pre-dispatch failures say so explicitly, a provider 429 and a
rejected key count as refusals, and any failure without that statement is
`unknown`. Each failed item carries the provider's error code and status.

A batch key derives one key per message from the address and everything the
recipient reads — rendered subject, HTML and text, or template and data, plus
attachment digests — never from the position. A project's own key per
recipient still wins.

When an adapter reports that its sender refuses all mail until an operator
acts (`blocksSender`: quota used up, credentials rejected), the batch skips the
rest of that sender's mails as `not-sent` with reason `sender-blocked`; mails
routed to another sender continue. A per-second rate limit does not block.

A token batch without a text body gets one generated from each rendered HTML
body. Recipient validation, de-duplication and consent remain with the
project; a maximum list size refuses an oversized batch. Failures reach the
error tracker as one event per failure reason with its count. Marketing and
newsletter features are out of scope for the package.

## Rejected alternatives

- **Keep the position in the key (ADR 0069).** Removing one row shifts every
  later recipient onto a neighbour's key; the provider then skips or rejects
  mail that was never sent.
- **Key on the address alone.** Two different mails to one address — two
  invoices — would share a key and the second would never go out.
- **Stop the whole batch on any blocking failure.** A batch can route mail
  through several senders; one exhausted quota says nothing about the others.
- **Stop on every 429.** A per-second limit clears within a second; stopping
  would abandon mail that a slower retry would deliver.
- **Generate text for every `sendEmail`.** It would change the body of mail
  that projects already send; the batch is new, so its default can include it.
- **Use the provider's batch endpoint (Resend `batch.send`).** It skips the
  per-mail hooks, cannot carry attachments and ties the feature to one
  provider.
- **Retry and queue inside the batch.** Durable retry needs storage and a
  worker the package does not own.
- **Validate and de-duplicate addresses in the batch.** Whether two rows are
  duplicates depends on project data.

## Consequences

- Two identical mails to one address in one batch share a key: on Resend the
  second is reported as sent with the first one's id instead of arriving
  twice. If both are in flight at once Resend can refuse the second as a
  concurrent request, which ends `unknown`.
- Editing the shared template between attempts changes every key, so a retry
  after such an edit sends the new version to everyone again. Retry with the
  same content, or give each recipient its own key.
- Keys protect retries only on providers with native idempotency (Resend).
- `EmailResult` failures gained optional `code`, `status` and `blocksSender`;
  custom adapters can set them, and without them a batch behaves as before.
- Revisit if the package gains a durable job store, which would make queued
  retry and marketing-scale sending feasible.
