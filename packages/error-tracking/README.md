# @luckystack/error-tracking

> Optional error-tracking integration for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Auto-wires error/performance capture into the framework's hook surface and request transports. Currently Sentry-backed; the package name is implementation-agnostic so future adapters (Datadog, etc.) can slot in without renaming consumers' imports. No-op when `SENTRY_DSN` is missing.

## Install

```bash
npm install @luckystack/error-tracking @sentry/node
```

`@sentry/node` is a peer dependency.

## Quickstart

Call `initializeSentry()` once at boot — before `createLuckyStackServer`.

```ts
import { initializeSentry } from '@luckystack/error-tracking';
import { createLuckyStackServer } from '@luckystack/server';

initializeSentry();

const server = await createLuckyStackServer({ /* ... */ });
await server.listen();
```

Set `SENTRY_DSN` in your environment to enable. Without it, every export is a safe no-op so you can keep the import in production code unconditionally.

## Public API

| Export | Purpose |
| --- | --- |
| `initializeSentry()` | Read `SENTRY_DSN`, sample rates, and init the SDK. Idempotent. |
| `captureException(error, context?)` | Forward to Sentry; called by `tryCatch` automatically. |
| `captureMessage(msg, level?, context?)` | Manual breadcrumb-style logging. |
| `setSentryUser(user \| null)` | Attach session identity (called by `@luckystack/login` on login/logout). |
| `startSpan(name, op)` | Performance tracing wrapper — used by API/sync request handlers. |
| `registerSentryConfig(input)` / `getSentryConfig()` | Per-package config registry. Owned by this package; not part of `@luckystack/core`'s `ProjectConfig`. |

## What gets auto-instrumented

`initializeSentry()` registers handlers on the framework's hook surface:

- `apiError`, `syncError` — capture exceptions thrown from `_api/*.ts` and `_sync/*.ts` handlers (already `tryCatch`-wrapped at the call site).
- `preApiExecute` / `postApiExecute` and `preSyncFanout` / `postSyncFanout` — performance spans + breadcrumbs with redacted input/output.
- `postLogin` / `postLogout` — call `setSentryUser` to attach session identity to subsequent events.

`tryCatch` (from `@luckystack/core` server entry) calls `captureException` automatically, so consumer-code errors flow into Sentry without explicit wiring.

Sample rates and ignore-list come from this package's own `registerSentryConfig({...})`. Breadcrumb redaction keys come from `registerRedactedLogKeys(...)` in `@luckystack/core`.

## Related architecture docs

- [`docs/MONITORING.md`](../../docs/MONITORING.md) — strategy spec for the future `@luckystack/monitoring` package (audit trail + metrics). Error-tracking covers the "Why?" half; monitoring will cover the "What?" half.

## Dependencies

- Runtime: `@luckystack/core`
- Peer (canonical ranges, standardized 2026-05-07):
  - `@sentry/node@^10.48.0`

## License

MIT — see [LICENSE](../../LICENSE).
