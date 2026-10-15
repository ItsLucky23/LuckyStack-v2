---
name: email-batch-is-transactional-with-a-per-recipient-outcome
title: Batch email is transactional mail sent one message at a time, with an outcome per recipient
status: accepted
date: 2026-10-15
deciders: [ItsLucky23]
tags: [email, reliability, idempotency, scope]
supersedes: []
relates: [0034]
---

## Context

`@luckystack/email` could send one mail per call. Projects that mail a list —
invoices, rota changes, organisation notices — each wrote their own loop with
`{{token}}` substitution, recipient keys and result bookkeeping. Flexbuddy's
version showed the recurring traps: tokens resolved to `Object.prototype`
members, subjects left unrendered, keys derived only from list position, and
copy recipients mailed once per personalised recipient. Providers also differ:
Resend de-duplicates by key and rate-limits per second, SMTP does neither.

## Decision

`sendEmailBatch` sends transactional mail to a list by calling `sendEmail` once
per message, a bounded number at a time with an optional per-second bound, and
returns one outcome per recipient: `sent`, `not-sent` or `unknown`. Only a
failure known to have happened before the provider accepted the mail is
`not-sent`: pre-dispatch failures in `sendEmail` and adapters now say so
explicitly, and a provider 429 counts as a refusal. Any failure without that
statement is `unknown`. A batch key derives one key per message from the key,
position and address. Recipient validation, de-duplication and consent remain
with the project; a maximum list size refuses an oversized batch. Failures
reach the error tracker as one event per failure reason with its count, not
one per recipient; the server log keeps a redacted line per mail. Marketing and
newsletter features are out of scope for the package.

## Rejected alternatives

- **Use the provider's batch endpoint (Resend `batch.send`).** It skips the
  per-mail hooks, so a suppression hook would not cover batch mail; it cannot
  carry attachments; and it ties the feature to one provider.
- **Treat a failure without an outcome as `not-sent`.** A 5xx or dropped
  connection can follow acceptance; reporting it as not-sent invites a
  duplicate on retry, the failure ADR 0034 exists to prevent.
- **Retry and queue inside the batch.** Durable retry needs storage and a
  worker the package does not own; an in-memory retry dies with the process
  and hides rate-limit pressure from the project.
- **Derive keys from position only.** Removing or reordering a recipient
  between attempts hands one recipient's key to another, so the provider skips
  or rejects a mail that was never sent.
- **Keep one tracker event per failed mail.** A batch of 500 with a wrong API
  key would send 500 identical events, exhaust the tracker quota and bury
  unrelated errors; the per-mail detail already lives in the server log.
- **Validate and de-duplicate addresses in the batch.** Whether two rows for
  one address are duplicates or two distinct mails depends on project data;
  a framework rule would silently drop legitimate mail.

## Consequences

- `sendEmail` results for no sender, no template, failed template render, hook
  veto and missing `from` now carry `deliveryOutcome: 'not-sent'`; callers
  comparing whole result objects see the extra field.
- Keys protect retries only on providers with native idempotency, and only for
  the same list in the same order.
- A rate-limited mail ends `not-sent` without retry; the project decides when
  to resend it.
- Revisit if the package gains a durable job store, which would make queued
  retry and marketing-scale sending feasible.
