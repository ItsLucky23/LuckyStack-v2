# @luckystack/core — design context

Core owns the shared transport contracts and registration seams used by framework packages. Register infrastructure at boot and read it at call time; do not copy config defaults into consumers or bypass registries. Source: `src/projectConfig.ts`, `src/createRegistry.ts`, `src/index.ts`, `src/client.ts`.

Keep the server barrel out of browser bundles; use `@luckystack/core/client`. Extend session types in the consumer rather than editing shared base types. Do not let observability adapters break request handling; redact sensitive fields before emitting context. Source: `src/errorTrackerRegistry.ts`, `src/redactedLogKeys.ts`.

Security boundaries: cookie sessions use CSRF protection; token-mode bearer credentials are supplied explicitly. Do not enable bearer fallback in cookie mode without reviewing CSRF implications (`src/extractToken.ts`). Trust forwarded IP headers only when the reverse proxy and hop count are configured (`src/resolveClientIp.ts`); rate limits depend on this identity. Never relax origin checks for convenience (`src/checkOrigin.ts`). Redis keys and socket room names must remain isolated across tenants (`src/redisKeyFormatter.ts`, `src/roomNameFormatterRegistry.ts`).

Multi-instance: the per-instance socket maps must stay unreachable from consumer code by default — use the cross-instance room helper, and take the raw server only for deliberate per-instance work with a lint opt-out that says why (ADR 0061, `src/roomSockets.ts`). A room-name formatter's `userId` is context, never part of a content room's physical name (ADR 0060). The Redis-adapter key, not the Redis server, defines the socket cluster; it separates environments but not their data (`src/socketRedisAdapter.ts`).

Design discussions: `docs/` in this package and repository `docs/ARCHITECTURE_AUTH.md`, `docs/ARCHITECTURE_MULTI_INSTANCE.md`. Signatures and defaults live in source, not this file.
