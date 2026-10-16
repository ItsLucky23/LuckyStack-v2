# Changelog

All notable changes to `@luckystack/email` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.0] - 2026-10-16

### Added

- **Error code and status per batch item.** `BatchItemResult` now has `code` and `status` when the adapter supplies them, so a project can tell a used-up quota from a rejected address.
- **A blocked sender stops its part of the batch.** When a mail fails with `blocksSender` (Resend: daily or monthly quota used up, missing/invalid/restricted API key; SMTP: rejected login), the remaining mails for that sender are skipped as `not-sent` with reason `sender-blocked` and the code that blocked it, instead of each collecting the same refusal. Mails routed to another sender continue. A per-second rate limit does not block.
- **Generated plain text.** A token batch without `text` gets a plain-text body generated from each rendered HTML body (links keep their target). Pass `text` to keep your own.

### Changed

- **Derived batch keys follow address and content, not position.** The per-mail key now comes from the batch key, the address and what the recipient reads (rendered subject/HTML/text, or template and data, plus attachment digests). Reordering or removing rows no longer moves keys onto other recipients. Two identical mails to one address share a key; changing the shared content between attempts changes every key. A batch interrupted on 0.13 and retried on 0.14 derives different keys, so finish such a retry before upgrading or give recipients their own keys.
- **Resend and SMTP pass the provider's error code and status through.** Resend also marks a rejected API key as `not-sent` (it is refused before any mail is accepted), and SMTP marks a rejected login (`EAUTH`) as `not-sent`.
- **nodemailer 7 to 10 are accepted.** The optional `nodemailer` peer range was `^6.9.0`, so installing the current nodemailer failed with ERESOLVE. New SMTP scaffolds get nodemailer 10, which ships its own types, so `@types/nodemailer` is no longer added.

### Fixed

- **An SMTP failure no longer reaches the error tracker on its own.** The SMTP adapter sent every failed mail to the tracker itself, with the raw address in the error, before `sendEmail` or the batch reported it. Now only the redacted report remains, and the failure reason in the server log is redacted too.
- **Abort stops a paced batch at once.** With `perSecond` set, mails after an abort each waited out their slot before ending as `send-aborted`.
- **Skipped mails no longer wait for pace slots.** Mails skipped because their sender was blocked used to take a `perSecond` slot each.
- **A blocked sender only blocks its own slot.** Two slots with separate accounts of the same adapter (two Resend keys) blocked each other, because blocking went by adapter name.
- **The batch tracker event no longer carries an unredacted provider error.** The error attached to the grouped event is redacted like the reason; a provider error object of another shape is left out.
- **A missing required sender in a batch is `not-sent` / `no-sender`.** It was `unknown`, although nothing was sent.
- **Generated plain text handles unclosed links in linear time.** Thousands of unclosed `<a href>` tags took seconds.
- **Generated plain text keeps table cells apart and decodes common entities.** Cells of one row are joined with ` | ` (empty cells dropped), rows stay on consecutive lines, and line breaks in the HTML source count as spaces, as in a browser. `&euro;`, `&copy;`, `&ndash;`, `&hellip;`, curly quotes and similar entities are decoded.
- **Derived batch keys tell Map and Set data apart.** Template data holding a Map or Set encoded as `{}`, so different data shared one key.
- **Resend attachments keep `cid`, `href` and binary content.** `cid` is now sent as Resend's `contentId`, `href` as its `path`, and `Uint8Array` content as a Buffer instead of an object of numbered keys.

## [0.13.0] - 2026-10-15

### Added

- **`sendEmailBatch`: send transactional mail to a list with one outcome per recipient.** Pass either shared content with `{{token}}` placeholders plus a recipient list, or a list of prepared messages (raw or registered templates). Every mail goes through `sendEmail`, so hooks, header sanitizing, timeout and log redaction apply per mail. Each recipient ends `sent`, `not-sent` or `unknown`; a normal failure never throws. Options bound mails in flight (default 2) and, optionally, mails started per second; an abort signal stops the batch; a batch key gives each mail a stable key derived from the key, its position and its address. Lists over 500 messages (configurable) are refused without sending. Failures reach the error tracker as one event per failure reason with its count (at most ten reasons plus one summary), not one event per recipient; the server log keeps a redacted line per mail. Address checks, de-duplication and consent stay with the project. See `docs/batch.md`.
- **`renderTokens`**: the `{{token}}` substitution the batch uses, exported for projects that build their own messages. Exact key first, then case-insensitive; a missing key or a `null`/`undefined` value leaves the token visible, an empty string renders empty; values are HTML-escaped unless `escape: 'none'`; a value is never expanded a second time.

### Changed

- **Failures that stop a mail before it reaches the provider now say so.** No sender, no template, a failed template render, a `preEmailSend` veto and a missing `from` return `deliveryOutcome: 'not-sent'`. Code that compares a whole `sendEmail` result with `toEqual` sees the extra field; code reading `ok` and `reason` is unaffected.
- **Resend: a 429 (rate limit, daily or monthly quota) returns `deliveryOutcome: 'not-sent'`**, since Resend refused the mail. Other Resend errors still carry no outcome, because a server error may follow acceptance.

## [0.12.0] - 2026-10-15

### Changed

- Requires Node.js 22.13 or newer (was 20). Node 20 stopped receiving security updates in April 2026, and the scaffold's lint toolchain (ESLint 10) needs 22.13.

## [0.11.0] - 2026-10-14

### Changed

- Type declarations are emitted per source file by TypeScript 7 (`tsc -b`) instead of one bundled `.d.ts` per entry, so the framework build no longer runs package by package. The exported types are unchanged; relative imports inside the declarations carry `.js`, so `moduleResolution: "node16"`/`"nodenext"` projects resolve them as before.
- Package design guidance now ships as `AGENTS.md`, not `CLAUDE.md`. Handwritten docs focus on rationale and safety, distinguishing pre-send stop signals from isolated hook exceptions for mandatory suppression policy.

## [0.8.4] - 2026-08-17

### Changed

- Updated observability and password-reset documentation for multi-tracker fan-out, SHA-256-at-rest reset tokens, prior-token invalidation, and current file-based route URLs.

## [0.8.1] - 2026-07-27

### Fixed

- Production email-adapter fallback warnings now follow `NODE_ENV` even when the deploy topology uses a named environment.

## [0.7.4] - 2026-07-22

### Added

- `sendEmail` accepts a cooperative `AbortSignal` and stable caller-provided
  idempotency key. Adapter context remains optional for backwards compatibility;
  Resend forwards the key to provider-native deduplication.

### Fixed

- Timeout/caller abort after provider dispatch now reports
  `deliveryOutcome: 'unknown'` instead of presenting “stopped waiting” as proof
  that delivery failed. Built-in adapters avoid dispatch when already aborted.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
