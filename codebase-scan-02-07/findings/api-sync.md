# Security + Correctness Audit — `@luckystack/api` + `@luckystack/sync`

Date: 2026-07-02
Scanner: security/correctness auditor (SCAN ONLY — no files modified)
Scope: every source file under `packages/api/src` and `packages/sync/src` (read in full), plus cross-package verification against `packages/server/src/loadSocket.ts` and `packages/core/src/roomNameFormatterRegistry.ts`.

## TL;DR

These two packages are heavily hardened by prior audit rounds. The transport pipelines (auth → rate-limit → validate → execute → respond), the receiver-authorization defaults (`requireRoomMembership`/`allowClientReceiverAll` now secure-by-default), the input-validation fail-CLOSED behavior, the token redaction, the abort-registry keying (S13), and the malformed-frame guards all check out on a careful read. The prior-audit flags (validateType fail-open, MT-3 room bypass, shadow-API drift) are addressed in the CURRENT code.

**One real defect stands out (F1): a room-name `purpose` mismatch** between how sockets JOIN rooms (`purpose:'join'`) and how sync membership-auth + fanout + streaming resolve the room (`purpose:'broadcast'`). Default (identity) formatter deployments are unaffected; **multi-tenant deployments that register a `purpose`-aware `registerRoomNameFormatter` break** — legitimate members get rejected and/or fanout silently reaches nobody. Everything else below is LOW / informational.

No CRITICAL findings. No confirmed auth-bypass that grants MORE access than intended.

---

## F1 — Room-name `purpose` mismatch: membership-auth + fanout use `'broadcast'`, sockets join with `'join'`

- Severity: **MEDIUM** (elevate to **HIGH** for any multi-tenant deployment that registers a `purpose`-branching room-name formatter)
- Files:
  - `packages/sync/src/handleSyncRequest.ts:561` (socket membership check)
  - `packages/sync/src/handleSyncRequest.ts:898` (socket fanout target)
  - `packages/sync/src/handleHttpSyncRequest.ts:718` (HTTP fanout target)
  - `packages/sync/src/_shared/streamEmitters.ts:192,253,306` (broadcastStream / flushPressure room)
  - vs. `packages/server/src/loadSocket.ts:199` (`roomPurpose = 'join'` on join), `:295` and `:498` (`purpose:'join'` on evict/reconnect-rejoin)
  - registry: `packages/core/src/roomNameFormatterRegistry.ts:17` (`purpose: 'join' | 'leave' | 'broadcast' | 'presence'`)

Code — the socket physically joins with `purpose:'join'`:

```ts
// loadSocket.ts:198-199 (executeRoomMutation)
const roomPurpose = preHook === 'preRoomJoin' ? 'join' as const : 'leave' as const;
const physicalRoom = formatRoomName(group, { purpose: roomPurpose, userId: session.id });
// ...
await sock.join(physicalRoom);          // line 298
// reconnect rejoin, line 498:
await socket.join(formatRoomName(roomCode, { purpose: 'join', userId }));
```

Code — the sync handler authorizes membership and fans out with `purpose:'broadcast'`:

```ts
// handleSyncRequest.ts:559-562 (runReceiverAuth)
isMember: () =>
  socket.rooms.has(
    receiver === 'all' ? 'all' : formatRoomName(receiver, { purpose: 'broadcast', userId: user?.id ?? null }),
  ),
// handleSyncRequest.ts:898 (runSyncFanout)
const physicalReceiver = receiver === 'all' ? 'all' : formatRoomName(receiver, { purpose: 'broadcast', userId: user?.id ?? null });
const sockets = await ioInstance!.in(physicalReceiver).fetchSockets();
```

Why it's wrong: the `RoomNameFormatterContext.purpose` field exists specifically so a consumer's formatter CAN branch on it (`roomNameFormatterRegistry.ts` documents "so a formatter can branch if needed"). The moment a formatter returns a different string for `'join'` vs `'broadcast'` on the same raw room code, the physical room a socket is IN (`join:<room>`) differs from the physical room the membership check tests and the fanout targets (`broadcast:<room>`).

Failure scenario (multi-tenant formatter that prefixes by purpose, or simply includes the purpose):
1. User joins room `R` → socket is in physical room `join:R`.
2. User calls `syncRequest({ receiver: 'R' })`.
3. `runReceiverAuth` tests `socket.rooms.has('broadcast:R')` → **false** → request rejected with `sync.notRoomMember` (403) even though the user legitimately joined `R`. `requireRoomMembership` (now the secure default) makes this the standard path, so the feature is DOA under such a formatter.
4. Even if membership were satisfied, `runSyncFanout` fetches `io.in('broadcast:R')` → the actual members live in `join:R` → **empty recipient set** → `sync.noReceiversFound`, or (HTTP) a silent zero-recipient fanout. `broadcastStream`/`streamTo` streaming has the same blind spot (streamEmitters.ts:192).

The in-code comments assert the opposite of reality — e.g. handleSyncRequest.ts:556-558 and streamEmitters.ts:141-143 both claim membership/broadcast target "the SAME physical name … sockets actually joined." That is only true for the identity default. The fix is to resolve one canonical purpose for a given room across join + membership + broadcast (or document that a formatter MUST be purpose-invariant for room codes, contradicting the API's stated intent).

Note: the DEFAULT identity formatter returns the raw name for every purpose, so stock deployments are byte-for-byte unaffected — which is why the test suite and prior audits didn't catch it. It only bites the exact use case the `purpose` field was added for.

---

## F2 — HTTP-sync membership authority (`session.roomCodes`) can diverge from socket membership (`socket.rooms`)

- Severity: **LOW** (design/staleness observation)
- File: `packages/sync/src/handleHttpSyncRequest.ts:383-388` (stageAuthorizeReceiver)

```ts
isMember: user ? () => Boolean(user.roomCodes?.includes(normalizedReceiver)) : null,
```

The socket transport derives membership from the live `socket.rooms` set; the HTTP/SSE transport derives it from the persisted `session.roomCodes`. I verified these are normally kept in step — `loadSocket.ts` `executeRoomMutation` updates `roomCodes` on join/leave and the reconnect path rejoins from `roomCodes`. So the two are consistent for the standard join/leave flow, and the anonymous (`isMember: null`) case correctly fails closed under `requireRoomMembership`.

Residual risk: any room a socket is placed in WITHOUT going through `executeRoomMutation` (a direct `socket.join(...)` by framework/consumer code, presence/token rooms, etc.) is invisible to the HTTP membership check, and any code path that mutates `socket.rooms` without persisting to the session would let the two transports disagree (a user could still be authorized over HTTP for a room they've effectively left, or vice-versa). This is a latent correctness coupling to keep in mind, not an exploited bypass. Also note the HTTP check compares against the RAW `normalizedReceiver` while the socket check compares against the FORMATTED room name (interacts with F1 under a custom formatter).

---

## F3 — API socket transport ignores `rateLimiting.skipLoopbackInDev` (parity drift)

- Severity: **LOW** (functional/consistency; the drift is toward MORE restriction, so not a security hole)
- Files: `packages/api/src/handleApiRequest.ts:136-176` (`runSocketRateLimits`) + `packages/api/src/_shared/applyApiRateLimits.ts` (socket caller never sets `skipGlobalIpBucket`).

The HTTP API transport (`handleHttpApiRequest.ts:368-380`), the socket SYNC transport (`handleSyncRequest.ts:149-152`), and the HTTP SYNC transport (`handleHttpSyncRequest.ts:158-160`) all honor `rateLimiting.skipLoopbackInDev` (skip the global per-IP abuse cap for loopback in non-prod). The socket API transport does not — it always applies the global IP bucket. `applyApiRateLimits.ts:20-23` even documents this asymmetry as intentional ("The socket transport never sets this"), but it means a dev/test client hammering API routes over WebSocket from localhost trips the cross-route IP cap while the equivalent sync/HTTP paths don't. Consistency drift; harmless security-wise (fails safe).

---

## F4 — No handler-level request payload size cap (unbounded-input DoS delegated to transport)

- Severity: **LOW / informational**
- Files: `handleApiRequest.ts` (`validateApiMessage`), `handleHttpApiRequest.ts` (`validateHttpApiRequestShape`), `handleSyncRequest.ts` (`parseSyncFields`), `handleHttpSyncRequest.ts` (`stageResolveRoute`).

None of the four entry points bound the SIZE of `data`/`clientInput` or of the `receiver`/`name` strings. Protection against oversized payloads is entirely the transport layer's job (`socket.maxHttpBufferSize`, `http.requestBodyMaxBytes` in `@luckystack/server`). Consequence: (a) a consumer who builds a custom transport and calls these handlers directly gets no size guard; (b) `receiver` is used verbatim as a Socket.io room / Redis-adapter key with no length cap (a very long receiver string becomes a large key, though it's rate-limited and yields an empty room). Worth documenting as a handler-level assumption rather than a defended invariant.

---

## F5 — `readSession(token)` runs BEFORE rate-limiting on every message

- Severity: **LOW / informational**
- Files: `handleApiRequest.ts:454`, `handleHttpApiRequest.ts:157`, `handleSyncRequest.ts:1175`, `handleHttpSyncRequest.ts:852`.

Per-route rate-limit keying needs the validated `user.id`, so the session is resolved before any bucket check. A flood of messages over an already-established socket therefore triggers one session-store lookup per message ahead of any throttle; the only pre-session gate is the opt-in `preSocketMessage` hook (which a consumer must implement). This is inherent to identity-keyed rate limiting and is mitigated by connection-level limits, but it means the session store — not the rate limiter — absorbs a message flood. Documenting as a known tradeoff.

---

## F6 — `applyApiRateLimits` declares an unused `token` param

- Severity: **INFO** (no impact)
- File: `packages/api/src/_shared/applyApiRateLimits.ts:14` (interface) — `token` is in `ApplyApiRateLimitsArgs` but not destructured/used in the function body (line 39-46).

Both callers pass `token`, but the helper deliberately keys on `user.id`/IP and never the token (correct, documented anti-abuse design). The param is simply dead. Harmless; noted only because a future reader might assume token participates in the key.

---

## F7 — API handlers rely on core `validateRequest` null-safety without the explicit guard the sync handlers use (asymmetry)

- Severity: **INFO / verify**
- Files: `handleApiRequest.ts:104-105` and `handleHttpApiRequest.ts:309-310` (both pass `user!` into `validateRequest`), vs. `handleSyncRequest.ts:483-497` / `handleHttpSyncRequest.ts:337-348` (explicit `auth.additional && !user → auth.required` guard before the call).

On a PUBLIC route (`auth.login:false`) with `auth.additional[]` predicates called by an anonymous user, the API handlers pass a null session into `validateRequest` (cast `user!`), trusting core to be null-safe (CORE-06). Per `@luckystack/core`'s documented behavior this fails closed, and both API handlers wrap execution in a top-level `tryCatch` (socket: line 390; HTTP: the outer scope), so even a core regression would surface as a clean 500 rather than a worker crash. The asymmetry is only a robustness/clarity gap: the sync handlers defend locally; the API handlers depend on the invariant holding in core. Confirm core `validateRequest(null)` still returns `status:'error'` for any non-empty `additional[]` (it should — verified via CLAUDE.md contract, not re-read here).

---

## Things explicitly checked and found CORRECT (anti-false-positive notes)

- **Malformed-frame DoS guards**: both socket handlers reject `null`/array/primitive `msg` before field access (`handleApiRequest.ts:417-423`, `handleSyncRequest.ts:235`), and both reject array `data`/`clientInput` via `Array.isArray` (`api:70`, `sync:290`, HTTP `sync:240`). Prevents the `socket.emit('sync', null)` pre-auth crash prior audits flagged.
- **Input-validation fail-CLOSED**: `resolveValidationMode` / `resolveSyncValidationMode` return `'strict'` for ANY unrecognized `validation` value; only exact `'relaxed'` / `{input:'skip'}` skips. No fail-open. Raw validator messages are never echoed to the client (generic `*.invalidInputType` only) — schema-enumeration closed on both transports.
- **Client-only route rejection**: a `_client` file with no `_server` is rejected as `sync.notFound` on both transports (`handleSyncRequest.ts:429`, `handleHttpSyncRequest.ts:298`) — the `_server` file is the mandatory auth+validation gate; no unauth'd unvalidated fanout.
- **Cross-route callback spoofing closed**: recipient callbacks route off the SERVER-resolved `resolvedName`, never the client `cb` (`handleSyncRequest.ts:1033,1054`; `clientFanout` `callbackKey`). Client `cb` is only used for the originator's own cancel handshake.
- **Abort-registry keying (S13)**: keyed on a server-issued `randomUUID` cancel id, not the reused client `cb` — no cross-request registry clobber. Verified by `handleSyncTransport.test.ts`.
- **Token redaction**: raw session tokens are redacted before error-tracker context + stream logs (`redactToken`/`redactTokens`, `clientFanout.ts:122`, `streamEmitters.ts:268`). `_client` handlers still receive the raw recipient token by design (for `getSession`).
- **Rate-limit key basis**: per-route bucket keyed on validated `user.id` (never the token → can't reset by re-login), anonymous → resolved IP; global per-IP `*:all` bucket applied separately incl. the `system/logout` shortcut. Auth failures do NOT consume a bucket (deliberate — prevents victim-IP DoS via bad creds).
- **Receiver auth ordering**: auth → receiver-auth → rate-limit → `preSyncAuthorize` → validate → execute; no expensive unthrottled work before the rate-limit gate; `'all'` broadcast and unjoined rooms rejected by secure-default config.
- **Fanout robustness**: `fanoutYieldEvery` clamped `>=1` (no `%0` NaN starvation), early originator-ack before the serial `_client` loop, `originatorAcked` guards against a double-emit on a late fanout throw.
- **Streaming**: `broadcastStream` correctly uses `io.to(room).emit` (cross-instance via Redis adapter) rather than a per-process room-size optimization; abort short-circuits every emitter; per-request chunk counters are closure-scoped (no module-level leak).
