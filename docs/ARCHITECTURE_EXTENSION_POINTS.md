# Extension points — design boundaries

LuckyStack exposes package-owned registries, adapters and lifecycle hooks so consumers can replace integrations without forking framework packages. Each optional package owns its surface; core supplies only cross-cutting registries and shared hooks. Public names and payload types belong to the package source and README, not a parallel inventory here.

## Choosing an extension seam

- Use an **adapter** for replacing an external system such as session storage, email delivery, a logger, or error tracking. Keep framework policy (authorization, CSRF, lifecycle) outside storage adapters; otherwise swapping a backend can silently change security behavior.
- Use a **hook** for a lifecycle decision or observation. Pre-operation guards can stop work; after-operation observers should not be treated as a security gate. The source defines which hooks are synchronous, stoppable, or allowed to mutate a shared payload. Do not assume a returned object replaces a payload.
- Use the **same registered data client** for app and framework queries when a cross-cutting Prisma extension must cover both. Conversely, tenant-scoped app queries must not accidentally expand access to framework-global session data. Prisma's own `$extends` is preferred to a second framework-specific query hook. See [multi-tenancy](./ARCHITECTURE_MULTI_TENANCY.md).
- Prefer `_sync` for ordinary realtime operations: it supplies the framework's auth, room fan-out and delivery contract. Raw socket events are an escape hatch for an incompatible external protocol, not a substitute for those safeguards. Middleware on the default namespace must not sidestep connection authentication.
- Choose the scheduler for recurring best-effort jobs, not a durable task queue. A shared lease can rarely permit double execution, so scheduled handlers must tolerate repeats; missed ticks are not replayed. Use a queue if retries, backoff or durable delivery matter. The reason the cron slot became viable after a lease primitive landed is recorded in ADR 0022.

## Security-sensitive customizations

Changing the error formatter, response transformer, origin policy, CSRF behavior or raw HTTP routing moves a trust boundary. Preserve authentication before validation, redact sensitive data before logging, and authenticate any origin-exempt endpoint independently. A pre-body HTTP route owns its request size, authentication and response once it consumes the stream; see [HTTP architecture](./ARCHITECTURE_HTTP.md).

For available registries and exact signatures, read the relevant `packages/<name>/README.md` and `packages/<name>/src/` (or installed package equivalents); package choice and installation are covered in [`PACKAGE_OVERVIEW.md`](./PACKAGE_OVERVIEW.md).
