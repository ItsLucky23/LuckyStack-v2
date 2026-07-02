# Security + Correctness Audit — `@luckystack/core`

Date: 2026-07-02
Auditor: automated review agent (scan-only, no edits made)
Target: `C:\code\LuckyStack-v2\packages\core\src` (~118 files)

## Executive summary

`@luckystack/core` is an exceptionally mature, heavily-audited package (its own
comment history references dozens of prior fixes: CORE-N*, CORE-O*, SEC-13,
ET-O*, SYNC-*). I read the full source of every non-trivial module, prioritising
the areas requested (tryCatch, function injection, apiRequest client,
type-generation/runtime validation, socket client, i18n, crypto/hashing, and
anything on the security/data-flow boundary).

**No CRITICAL or HIGH findings.** The security-sensitive primitives are correct:
all tokens/ids/leases/boot-uuids use `node:crypto` (`randomBytes`/`randomUUID`),
one-time tokens are SHA-256-hashed at rest with an atomic MULTI GET+DEL consume,
CSRF/cookie handling is sound, prototype-pollution is guarded in BOTH the config
merge and the runtime input validator, the runtime type validator fails CLOSED,
`resolveClientIp` correctly refuses to trust the leftmost XFF hop, `/_health`
hashes are HMAC-salted by default, and there are **no** XSS sinks
(`dangerouslySetInnerHTML`/`innerHTML`), `eval`, `new Function`, or
`child_process` uses anywhere in the package.

Findings below are LOW / informational — a mix of a real proxy inconsistency, a
cosmetic mislog, a loose regex, and things to verify at the package boundary.

## Areas covered

- Error handling: `tryCatch.ts`, `tryCatchClient.ts` (client-safe lazy capture), `tryCatchSync.ts`
- Function-injection / DI: `clients.ts`, `db.ts`, `redis.ts` proxies, `createRegistry.ts`, all `*Registry.ts`
- Client transport: `apiRequest.ts`, `socketState.ts`, `offlineQueue.ts`, `apiInterceptors.ts`, `clientHookBus.ts`, `csrf.ts`
- Type/runtime validation: `runtimeTypeValidation.ts`, `validateRequest.ts`, `apiMethodMapRegistry.ts`, `runtimeMapsRegistry.ts`, `apiTypeStubs`
- Crypto/hashing: `oneTimeToken.ts`, `lease.ts`, `bootUuid.ts`, `synchronizedEnvHashes.ts`, `resolveClientIp.ts`
- Security boundary: `checkOrigin.ts`, `cookies.ts`, `csrfConfig.ts`, `extractToken.ts`, `extractTokenFromRequest.ts`, `getParams.ts`, `serveAvatars.ts`, `escapeHtml.ts`, `redactedLogKeys.ts`, `errorTrackerRegistry.ts`, `sentrySetup.ts`
- Rate limiting: `rateLimiter.ts`
- Config: `projectConfig.ts` (defaults), `configUtils.ts` (deepMerge), `avatarConfig.ts`
- i18n / React: `TranslationProvider.tsx`, `react/notify.ts`, `Router.tsx`, `Middleware.tsx`, `AvatarProvider.tsx`, `useTheme.ts`, `sessionContext.ts`
- Sockets: `socketEvents.ts`, `socketRedisAdapter.ts`, `cancelRegistry.ts`
- Misc: `env.ts`, `peerDeps.ts`, `pageRouteValidation.ts`, `serviceRoute.ts`, `httpApiUtils.ts`, `localizedNormalizer.ts`, `responseNormalizer.ts`, `errorFormatterRegistry.ts`, `roomNameFormatterRegistry.ts`, `emailRegistry.ts`, `consoleLog.ts`, `loggerRegistry.ts`, `localesRegistry.ts`, `index.ts` / `client.ts` barrels, one representative eslint rule.

---

## Findings

### LOW-1 — `redis` proxy is missing the `ownKeys` / `getOwnPropertyDescriptor` traps that the `prisma` proxy has (enumeration inconsistency)

- File: `packages/core/src/redis.ts` (lines 136-161) vs `packages/core/src/db.ts` (lines 31-56)
- The `prisma` Proxy defines four traps: `get`, `has`, `ownKeys`, and
  `getOwnPropertyDescriptor` — so `Object.keys(prisma)`, spread, and enumeration
  reflect the real client. The `redis` Proxy defines only `get` and `has`:

```ts
// redis.ts — only get + has
const redisProxy = new Proxy({} as RedisClient, {
  get: (_target, prop) => { /* ... */ },
  has: (_target, prop) => Reflect.has(getRedisClient(), prop),
});
```

- Failure scenario: any diagnostic/serialisation code that does `Object.keys(redis)`,
  `{ ...redis }`, or `JSON.stringify(redis)` sees an EMPTY object (the `{}` proxy
  target), silently, whereas the same operation on `prisma` reflects the client.
  Not a security issue and no current call site does this, but it is an
  inconsistency that could surprise future code and defeat a debug dump.
- Why it's worth noting: the two proxies are documented as mirrors ("Mirrors the
  `redis` proxy" in db.ts), yet they are not symmetric.

### LOW-2 — `applyErrorFormatter` logs a misleading "formatter threw" line when a global formatter returns a falsy value without throwing

- File: `packages/core/src/errorFormatterRegistry.ts` (lines 115-121)

```ts
const globalFormatter = registry.get();
if (globalFormatter) {
  const [error, formatted] = tryCatchSync(() => globalFormatter(errorEnvelope, ctx));
  if (!error && formatted) return formatted as T;
  console.error(`[errorFormatter] global formatter threw on ${routeName}:`, error); // error is null here
  return response;
}
```

- Failure scenario: a global formatter that legitimately returns `undefined`/`null`
  (or any falsy value) hits the `console.error(... threw ...)` branch with
  `error === null`, emitting a false "threw" log with a null cause. The
  functional fallback (return the un-formatted `response`) is correct — this is
  log-noise only, not a behaviour bug. (The per-route branch above it, lines
  101-113, handles the same case more carefully by separating `if (error)`.)

### LOW-3 — `isLoopbackIp` regex accepts out-of-range IPv4 octets

- File: `packages/core/src/resolveClientIp.ts` (lines 140-145)

```ts
return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(canonical);
```

- The pattern accepts `127.999.999.999` and similar invalid octets as
  "loopback". Impact is confined to the `rateLimiting.skipLoopbackInDev` path,
  which is gated to non-production (`NODE_ENV !== 'production'`), so this cannot
  relax rate limiting in prod. A crafted-but-invalid `127.x` value would only
  ever appear as a resolved peer address, not a spoofable header (loopback check
  runs on the already-resolved IP). Low impact; flagged for correctness only.

### INFO-1 — HTTP GET query params are always strings, and core's `validateType` matches primitives by strict `typeof` — verify the api package coerces before validating

- Files: `packages/core/src/getParams.ts` (lines 35-37) +
  `packages/core/src/runtimeTypeValidation.ts` (`isPrimitiveMatch`, lines 224-237)
- `getParams` returns `Object.fromEntries(new URLSearchParams(...))` for GET, so
  every value is a `string`. `validateType('number', "5")` and
  `validateType('boolean', "true")` FAIL (they require `typeof === 'number'` /
  `'boolean'`). With `validation.runtimeMode: 'enforce'` (the 0.2.0 default), a
  GET route declaring a numeric/boolean input field would be rejected with
  `invalidInputType` unless the `@luckystack/api` HTTP path coerces query params
  before calling `validateInputByType`. This is a cross-package interaction, not
  provably a core bug — worth confirming in `@luckystack/api`'s HTTP GET handler
  that numeric/boolean query params are coerced (or that GET routes only take
  string inputs by convention).

### INFO-2 — `writeSession` fails OPEN (`{ ok: true }`) when no session provider is registered

- File: `packages/core/src/sessionProviderRegistry.ts` (lines 75-81)
- Already documented in-code as intentional (unauthenticated-app case), but worth
  re-surfacing: on a PARTIAL install (login package present but its
  `registerSessionProvider` side-effect not yet run, or misconfigured), a caller
  that checks `result.ok` will believe a session was persisted when it was not.
  The mitigation (`isSessionProviderRegistered()` boot check) exists but is
  opt-in. Matches the project's known "fail-open defaults" theme from prior
  audits. No change recommended without product input — reporting per the
  fail-open review convention.

---

## Positive confirmations (verified, no issue)

- **Randomness**: every security token uses `node:crypto` — `oneTimeToken`
  (`randomBytes(32)`), `lease` (`randomBytes(16)`), `bootUuid` (`randomUUID`).
  `Math.random()` appears only in `apiRequest.ts` (abort-dedup key fallback,
  line 60; queue id, line 101) — non-security identifiers. No weak randomness on
  any security path.
- **One-time tokens** (`oneTimeToken.ts`): SHA-256 hashed at rest, raw token
  never stored, atomic `MULTI GET+DEL` consume with DEL-error fail-closed,
  namespaced through `formatKey`. Correct.
- **Prototype pollution**: guarded in `configUtils.deepMerge` (`__proto__`
  skipped) AND — more strictly — in `runtimeTypeValidation` where
  `__proto__`/`constructor`/`prototype` are rejected outright on the
  attacker-controlled input boundary (Record + object branches).
- **Runtime type validator** fails CLOSED on unknown/unparseable types
  (terminal branch returns error, not success) and on parser throw
  (`safeValidateType`), with a depth cap (64) against payload-driven stack DoS.
- **`resolveClientIp`**: never trusts the leftmost (client-controlled) XFF hop;
  counts trusted hops from the right; clamps hop count ≥ 1. Correct CORE-O3 fix.
- **CSRF / cookies**: `httpFetch` only attaches CSRF on state-changing methods in
  cookie mode, single retry on mismatch (no loop); `getCookieValue` escapes the
  cookie name before building the RegExp (no ReDoS/injection); `__Host-`/`__Secure-`
  constraints resolved purely.
- **`escapeHtml`**: correct 5-entity escaping, `&` first.
- **Log redaction** (`redactedLogKeys` + `errorTrackerRegistry`): key-based +
  value-based (`key=value` / `key: value`) scrubbing, depth+cycle guarded, regex
  cache bounded with a warning. Legacy Sentry path (`sentrySetup`) also sanitises
  (CORE-O4).
- **`/_health` env hashes**: HMAC-on-boot-UUID by default (SEC-13), static salt
  never leaves the backend (`describeHealthHashConfig` exposes only mode + a
  bootUuid-salt boolean).
- **Hook / interceptor dispatch**: per-handler isolation, reporter calls
  themselves wrapped so a throwing logger can't break isolation (CORE-N10),
  handler set snapshotted before iteration to survive mid-dispatch unsubscribe.
- **`serveAvatars`**: `path.basename` + strict `^[A-Za-z0-9_-]{1,128}$` allowlist,
  404 (not 403) on hook veto to avoid existence disclosure, `stream.pipeline`
  with error sink (no worker crash on read error).
- **`getParams`**: enforces `requestBodyMaxBytes` on both declared and streamed
  size, destroys socket after 413, rejects non-object JSON bodies and unknown
  content-types (415).
- **Barrels**: `index.ts` (server) intentionally does NOT export `apiRequest`;
  client surface routes through `client.ts` + `tryCatchClient` to keep
  `node:async_hooks` out of the Vite client bundle (matches the known
  blank-page-leak lesson).
