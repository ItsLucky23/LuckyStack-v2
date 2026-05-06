# @luckystack/sentry

> Optional Sentry integration for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Auto-wires error/performance capture into the framework's hook surface and request transports. No-op when `SENTRY_DSN` is missing.

## Install

```bash
npm install @luckystack/sentry @sentry/node
```

`@sentry/node` is a peer dependency.

## Quickstart

Call `initializeSentry()` once at boot — before `createLuckyStackServer`.

```ts
import { initializeSentry } from '@luckystack/sentry';
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
| `startSpan(opts, fn)` | Performance tracing wrapper — used by API/sync request handlers. |

## Dependencies

- Runtime: `@luckystack/core`
- Peer: `@sentry/node`

## License

MIT — see [LICENSE](../../LICENSE).
