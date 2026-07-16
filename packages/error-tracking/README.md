# @luckystack/error-tracking

> Optional error-tracking integration for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Auto-wires error/performance capture into the framework's hook surface and request transports. Ships a backend-agnostic `ErrorTracker` adapter contract plus three built-in adapters — Sentry (`@sentry/node`), Datadog (`dd-trace` + `hot-shots`), and PostHog (`posthog-node`) — that can be registered together with fan-out. The package name is implementation-agnostic so further backends (CloudWatch, New Relic, ...) can slot in without renaming consumers' imports. The legacy single-Sentry entry is a no-op when `SENTRY_DSN` is missing.

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
| `setSentryUser(user \| null)` | Attach session identity. Not called by `@luckystack/login` directly — identity is propagated by this package's auto-instrumentation hooks (`preApiValidate` / `preSyncAuthorize` set it; `postLogout` clears it). |
| `startSpan(name, op)` | Performance tracing wrapper — used by API/sync request handlers. |
| `registerSentryConfig(input)` / `getSentryConfig()` | Per-package config registry. Owned by this package; not part of `@luckystack/core`'s `ProjectConfig`. |

## What gets auto-instrumented

`initializeSentry()` registers handlers on the framework's hook surface:

- `preApiValidate` / `preSyncAuthorize` — attach session identity (`setSentryUser` / `setCurrentErrorTrackerIdentity`) as early as each pipeline carries `user`.
- `preApiExecute` / `postApiExecute` and `preSyncFanout` / `postSyncFanout` — performance spans + breadcrumbs with redacted input/output.
- `postLogout` — clear the identity so a subsequent anonymous request is not attributed to the logged-out user.

Handler exceptions are NOT captured via an `apiError`/`syncError` hook subscription — they flow through `tryCatch` -> `captureException` (see below).

`tryCatch` (from `@luckystack/core` server entry) calls `captureException` automatically, so consumer-code errors flow into Sentry without explicit wiring.

Sample rates and ignore-list come from this package's own `registerSentryConfig({...})`. Breadcrumb redaction keys come from `registerRedactedLogKeys(...)` in `@luckystack/core`.

## Related architecture docs

- Error-tracking covers the "why did it break?" half (stack traces, breadcrumbs, error grouping). The "what happened?" half (input/output audit trail, metrics, RUM) is planned for a future `@luckystack/monitoring` package that lives in its own repo — see `docs/ROADMAP.md`.

## Dependencies

- Runtime: `@luckystack/core`
- Peer (canonical ranges, standardized 2026-05-07; all optional — install only what the adapters you use need):
  - `@sentry/node@^10.66.0` — required only when `createSentryAdapter()` or `initializeSentry()` is called.
  - `dd-trace@^5.0.0` — required only when `createDatadogAdapter(...)` is called. Import dd-trace as the FIRST require in your server entry.
  - `hot-shots@^10.0.0` — optional StatsD companion for the Datadog adapter (metrics). The adapter still captures exceptions without it.
  - `posthog-node@^4.0.0` — required only when `createPostHogAdapter(...)` is called.

## License

MIT — see [LICENSE](../../LICENSE).
