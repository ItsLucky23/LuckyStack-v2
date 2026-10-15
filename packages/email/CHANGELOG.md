# Changelog

All notable changes to `@luckystack/email` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-10-15

### Added

- **`sendEmailBatch`: send transactional mail to a list with one outcome per recipient.** Pass either shared content with `{{token}}` placeholders plus a recipient list, or a list of prepared messages (raw or registered templates). Every mail goes through `sendEmail`, so hooks, header sanitizing, timeout and log redaction apply per mail. Each recipient ends `sent`, `not-sent` or `unknown`; a normal failure never throws. Options bound mails in flight (default 2) and, optionally, mails started per second; an abort signal stops the batch; a batch key gives each mail a stable key derived from the key, its position and its address. Lists over 500 messages (configurable) are refused without sending. Address checks, de-duplication and consent stay with the project. See `docs/batch.md`.
- **`renderTokens`**: the `{{token}}` substitution the batch uses, exported for projects that build their own messages. Exact key first, then case-insensitive; an unknown token stays visible; a `null`/`undefined` value renders empty; values are HTML-escaped unless `escape: 'none'`; a value is never expanded a second time.

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
