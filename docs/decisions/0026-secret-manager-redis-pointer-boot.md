---
status: accepted
date: 2026-07-13
tags: [core, server, redis, secret-manager, boot]
---

# Redis default client survives a secret-manager pointer boot (decoupled reset, not core-resolves-pointers)

## Context

A consumer running Redis auth via a `@luckystack/secret-manager` POINTER
(`REDIS_PASSWORD=REDIS_PASSWORD_V1`, resolved into `process.env` at boot) hit a
hard boot failure: `WRONGPASS ... auth ['root','REDIS_PASSWORD_V1']` — the
literal pointer, even though `initSecretManager` had already overwritten
`process.env.REDIS_PASSWORD` with the real value, and even after calling
`resetDefaultRedisClient()`.

Root cause (verified end-to-end, correcting the incoming handoff's "core never
sees the resolved value" framing):

- `initSecretManager` DOES write resolved values into `process.env` in place —
  but only for names in its `envNames` allowlist (unset = deny-all).
- Core's `redis.ts` reads raw `process.env.REDIS_PASSWORD` at client
  CONSTRUCTION (`redis.ts:41`) and memoizes the client in `cachedDefault`. No
  coupling to secret-manager (by design).
- If anything touches the `redis` proxy before resolution, the pointer is baked
  into the cached client; a later `process.env` mutation can't reach an
  already-built ioredis instance. `resetDefaultRedisClient()` in the consumer's
  IIFE runs too EARLY — bootstrap's overlay imports / function-injection scan can
  rebuild the client afterwards.

The consumer's working workaround (`registerRedisClient(new IORedis(getRedisConnectionOptions()))`
AFTER init) proves `process.env` IS resolved by then — so the defect is purely
build TIMING + client caching, not a resolver design mismatch.

## Decision

Fix the timing at the framework level, without making core depend on
secret-manager and without moving secret-manager init into `bootstrapLuckyStack`.

> **0.6.4 correction.** The 0.6.3 version of this ADR used
> `resetDefaultRedisClient()` (null `cachedDefault`, defer the rebuild). Real
> testing proved that INSUFFICIENT: a plain reset only defers the lazy rebuild —
> a stale/pointer value can resurface by the time it rebuilds, and a reset never
> overrides a client already sitting in the registry. The proven fix (a consumer
> `registerRedisClient(new Redis(getRedisConnectionOptions()))` worked; a reset
> did not) is to **EAGERLY REBUILD + REGISTER**: build a fresh client from the
> now-resolved env immediately and put it in the default slot so it wins over the
> resolver. Both mechanisms below now call `rebuildDefaultRedisClient()`.

1. **Decoupled "secrets resolved" hook in core** (`secretsResolved.ts`):
   `registerSecretsResolvedListener` + `notifySecretsResolved(changedKeys?)`.
   `redis.ts` self-registers a listener that calls `rebuildDefaultRedisClient()`
   when a `REDIS_` key changed (or `undefined` = rebuild defensively). A resolver
   fires it (secret-manager already exposes the `onApplied` callback for exactly
   this — wire `onApplied: notifySecretsResolved`), so a fresh client is captured
   at boot AND on rotation, regardless of ordering. Generic on purpose — other
   cached-client owners (Prisma pools, SDK clients) can subscribe too.

2. **Eager rebuild in the server boot** (`createServer.ts`, before
   `writeBootUuid`): when `getProjectConfig().secretManager?.url` is set, call
   `rebuildDefaultRedisClient()`. By then the consumer's `initSecretManager`
   (called before `bootstrapLuckyStack`) has resolved `process.env`, so a fresh
   registered client captures the real password and the boot-UUID write
   authenticates — with NO consumer action, on a plain `npm` upgrade. Required a
   minimal `secretManager?: SecretManagerConfigRef` field on core's `ProjectConfig`
   (structural, dependency-free — core does not import secret-manager).

`rebuildDefaultRedisClient()` (core, exported): disconnect the previous default,
build a fresh client from the current (resolved) env via `getRedisConnectionOptions`
semantics, and `registerRedisClient(...)` it into the default slot (wins over the
lazy resolver). `resetDefaultRedisClient()` stays exported for the
resolve-by-other-means case but is documented as insufficient for this one.

## Rejected alternatives

- **Make core resolve pointers** (core reads secret-manager) — wrong layering;
  core must not depend on secret-manager. `process.env` is the only channel.
- **Move `initSecretManager` into `bootstrapLuckyStack` as step 0** (the incoming
  handoff's preference) — larger blast radius: bootstrap gains an optional
  secret-manager dependency, the scaffold `server.ts` IIFE block changes, error
  surface shifts. Unnecessary: the canonical layout already runs init before the
  first Redis touch, so a defensive reset + the decoupled hook cover the class
  with far less churn.
- **Rely on the consumer calling `resetDefaultRedisClient()`** — the workaround
  we are removing; it runs too early (before bootstrap can rebuild the client)
  and every project would have to re-derive it.

## Consequences

- A project resolving Redis auth via a secret-manager pointer boots green with no
  `server.ts` workaround; the consumer can drop `registerRedisClient(...)`.
- Rotation: wiring `onApplied: notifySecretsResolved` (documented in
  `ARCHITECTURE_SECRET_MANAGER.md`) drops the live client when a `REDIS_`
  credential rotates so the next use reconnects with the new secret.
- `envNames` must still list `REDIS_PASSWORD` (deny-all default) — surfaced in the
  `WRONGPASS` diagnostic and the docs.
- Host/port remain read from the import-frozen `env` snapshot (a separate,
  pre-existing limitation) — the pointer fix covers `REDIS_PASSWORD`/`REDIS_USER`.
