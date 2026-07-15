# Security + Correctness Audit — `@luckystack/router`

Date: 2026-07-02
Scanner: security/correctness auditor (SCAN ONLY, no edits made)
Scope: every source file under `packages/router/src/` (proxies, resolver, health, boot handshake, CLI). Tests read for corroboration only.

---

## Verdict on the historically-flagged CRITICALs

### wsProxy crash — FIXED (verified in current code)

Prior audits flagged an unauthenticated crash where a client RST mid-handshake emitted `'error'` on the raw `net.Socket` with no listener → uncaught exception → whole router down. This is **fixed** in `wsProxy.ts`:

- `packages/router/src/wsProxy.ts:93-99` attaches `onClientGone` to both `'error'` and `'close'` on `clientSocket` **synchronously, before any I/O or `await`** (the async gate check + upstream open happen after). The comment at lines 86-92 documents exactly this invariant.
- After a successful upgrade, `packages/router/src/wsProxy.ts:325-333` performs an atomic swap: post-upgrade `teardown` listeners are added **before** the pre-upgrade `onClientGone` listeners are removed, so there is never a window with no error handler (and no unbounded listener accumulation).
- Upstream legs are also guarded: handshake-timeout reap (`:248-253`), non-101 `'response'` (`:340-350`), upstream `'error'` (`:352-356`), all gated by a single `settled` latch so only the first path writes a status + tears down.

### WebSocket / HTTP SSRF — FIXED (verified)

The "re-host the upstream to an attacker-chosen origin" SSRF is mitigated by two independent, layered checks in **both** proxies:

- Strict origin-form gate before building the URL: `isOriginFormTarget()` (`proxyUtils.ts:86-87`) requires a single leading `/` and rejects `//host` and absolute/authority-form. Called at `httpProxy.ts:84` and `wsProxy.ts:117`.
- Defense-in-depth host pinning: `isHostPinned()` (`proxyUtils.ts:96-100`) re-parses the built `targetUrl` and requires `protocol` + `host` to equal the resolver-chosen backend. Called at `httpProxy.ts:123` and `wsProxy.ts:135`. This also catches the WHATWG-URL backslash quirk (`/\evil.com` parses to authority `evil.com` for special schemes but is then rejected by the host-pin → 502).

Router-authoritative header hardening is also solid: `stripForwardedHeaders` (`proxyUtils.ts:135-144`) drops all client-supplied `x-forwarded-*`, `x-real-ip`, `forwarded`, and `x-luckystack-*` headers before the router sets its own, so a client cannot spoof XFF / proto / internal routing markers via spread order. Upstream response headers are filtered to strip `x-luckystack-*` and (WS) `set-cookie` (`httpProxy.ts:225`, `wsProxy.ts:269-271`).

So the two long-standing criticals are genuinely resolved. The findings below are what remains.

---

## FINDING 1 — Prototype-inherited service key crashes the router process (unauthenticated DoS)  — **CRITICAL** (see preconditions)

**Files:**
- `packages/router/src/resolveTarget.ts:257-262` (unguarded object indexing in the fallback branch)
- `packages/router/src/httpProxy.ts:117` (`new URL` throws on the bogus target)
- `packages/router/src/httpProxy.ts:61-63` (`void handleRequest(...)` — rejection is not caught)

**Vulnerable code** (`resolveTarget.ts`, the fallback branch of `resolve`):

```ts
// Fall through to the fallback env.
if (fallbackEnv && fallbackEnvKey) {
  const fallbackBinding = fallbackEnv.bindings[service];   // <-- indexes with attacker-controlled key
  if (fallbackBinding) {
    return { target: fallbackBinding, viaFallback: true, resolvedEnvKey: fallbackEnvKey };
  }
}
```

`service` comes straight from the request path via `parseServiceFromPath` (`resolveTarget.ts:84-106`) — the first non-transport segment, `decodeURIComponent`-decoded. `fallbackEnv.bindings` is a plain object literal from the consumer's `deploy.config.ts` (normal `Object.prototype`). There is **no `Object.hasOwn` / own-property guard** anywhere in the package (confirmed by grep — zero `hasOwnProperty` / `hasOwn` / `Object.create(null)`).

For a service key that names an inherited property:
- `bindings['__proto__']` → `Object.prototype` (truthy object)
- `bindings['constructor']` → the `Object` constructor (truthy function)
- `bindings['toString']` / `['valueOf']` → functions (truthy)

`fallbackBinding` is truthy, so `resolve` returns `{ target: <Object.prototype | Object | function>, viaFallback: true, ... }` — `target` is a **non-string object/function**, not a URL.

Back in the HTTP proxy:

```ts
const targetUrl = new URL(pathname, resolved.target);   // httpProxy.ts:117
```

`resolved.target` is coerced to string (`"[object Object]"` for `__proto__`, `"function Object() { [native code] }"` for `constructor`) → not a valid absolute URL → `new URL` throws `TypeError [ERR_INVALID_URL]`. This throw happens **before** any stream `'error'`/`'aborted'` listeners are registered (those are at `httpProxy.ts:251+`), and `handleRequest` is invoked as a bare `void handleRequest(...)` (`httpProxy.ts:62`) with no `.catch`. The rejected promise is unhandled → with Node's default `--unhandled-rejections=throw` (v15+), the **router process exits**.

**Failure scenario (inputs → outcome):**
1. Router runs in split/fallback mode (current env declares `fallback` in `deploy.config.ts`) — this is the package's primary production mode ("split/fallback mode always requires shared Redis").
2. Unauthenticated attacker sends `GET /__proto__/x` (or `/constructor/x`, `/toString`, `/valueOf`).
3. `isOriginFormTarget('/__proto__/x')` → true; `parseServiceFromPath` → `"__proto__"`; `resolve("__proto__")` skips the local branch (Set membership is false) and hits the unguarded fallback branch → returns a non-string `target`.
4. `new URL(pathname, nonStringTarget)` throws → unhandled rejection → **whole router crashes**, taking down all traffic (HTTP + WS) for every service behind it. Trivially repeatable → sustained outage.

**Why it's wrong:** untrusted request input is used to index a prototype-bearing object without an own-property check, and the resulting value is fed to `new URL` on the request path with no surrounding error boundary. The local-binding branch (`resolveTarget.ts:247-254`) is safe only incidentally because it is gated by `locallyOwnedSet.has(service)` (a real `Set` of real names); the fallback branch has no equivalent guard.

**Preconditions / honest scoping:** requires (a) a `fallback` env configured (split/fallback mode, or dev `enableFallbackRouting`) and (b) Node's default unhandled-rejection behavior (not overridden by a consumer-installed `process.on('unhandledRejection')`). Without a fallback env, `resolve` returns `null` → clean 502, no crash. Given the router is a single front-door SPOF and the trigger is a single unauthenticated GET, I rate this **CRITICAL** where a fallback is configured; downgrade to HIGH only if the deployment never uses fallback mode.

**Suggested direction (not applied):** guard the fallback (and, defensively, local) binding lookups with `Object.hasOwn(fallbackEnv.bindings, service)`; and/or wrap `handleRequest`'s body so a synchronous throw before stream setup emits a 502 instead of rejecting. No fix made per scan-only scope.

---

## FINDING 2 — `handleRequest` has no error boundary before stream listeners; any pre-pipe throw crashes the process — **MEDIUM** (root cause shared with Finding 1)

**File:** `packages/router/src/httpProxy.ts:61-63`, `:66-117`

```ts
return (req, res): void => {
  void handleRequest(req, res, {...});   // rejection is dropped
};
```

The comment at `httpProxy.ts:56-60` asserts "errors are handled inside `handleRequest` via the per-stream `'error'` listeners registered before any I/O." That is **not true for the early phase**: everything from entry through `new URL` (`:117`), `isHostPinned` (`:123`), and the awaited `dispatchHook('proxyRequestGate')` (`:156`) runs **before** the `req/res` `'error'` listeners are registered (`:301-303`). Any synchronous throw or awaited rejection in that window becomes an unhandled rejection → process crash. Concrete triggers:

- Finding 1's `new URL` throw.
- A consumer-registered custom `ServiceResolver` (`registerServiceResolver`) that throws — `resolveServiceKey` (`resolveTarget.ts:142-152`) is called synchronously at `httpProxy.ts:91` with no guard, so a buggy custom resolver takes the whole router down on the request path.

**Why it's wrong:** the request handler is fire-and-forget with no top-level catch, and the comment gives false confidence that the early path is covered. A proxy front-door should never let a single request's exception terminate the process.

---

## FINDING 3 — Listening HTTP server has no `'error'` listener; port-in-use / bind failure is an uncaught exception at startup — **LOW**

**File:** `packages/router/src/startRouter.ts:164`, `:188-192`

```ts
const server = http.createServer(proxy);
...
await new Promise<void>((resolve) => {
  server.listen(port, () => { resolve(); });
});
```

`server.listen` is awaited only on the success (`listening`) callback; there is no `server.on('error', ...)`. If the port is already in use (`EADDRINUSE`), unbindable, or an invalid/out-of-range value flows through (e.g. `ROUTER_PORT` or `--port` passes the `Number.isFinite` check at `startRouter.ts:80` / `cli.ts:45` but is `> 65535` or negative), the server emits `'error'` with no listener → uncaught exception, and the awaited promise never resolves. Operator-facing (not attacker-reachable), hence LOW, but it turns a normal misconfiguration into an opaque crash instead of a clean startup error. Note: `parseNumericFlag`/`ROUTER_PORT` validation only checks finiteness, not the valid TCP port range.

---

## FINDING 4 — Backend-controlled status/reason bytes and header values written verbatim to the client — **LOW / informational (no exploit found)**

**Files:** `packages/router/src/wsProxy.ts:264-278` (WS 101 status line + header lines), `:344` (non-101 reason phrase), `httpProxy.ts:217` (status code).

The WS upgrade path builds the client-facing status line and headers by string concatenation from upstream-supplied values (`upstreamRes.statusMessage`, header keys/values). This would be a header/response-splitting concern **if** those values could contain CRLF — but Node's HTTP client parser rejects CR/LF in status reason phrases and header fields before they reach this code, so no injection is reachable in practice. Flagged only because it relies on the upstream parser as the sole CRLF barrier and the backend is semi-trusted; a raw `socket.write` of concatenated upstream bytes is a fragile pattern worth a defensive note. No action required unless the upstream trust boundary changes.

---

## Areas checked and found sound (no findings)

- **Request smuggling:** `transfer-encoding`, `connection`, `keep-alive`, `te`, `trailer` are stripped as hop-by-hop (`proxyUtils.ts:11-28`), plus dynamic `Connection`-listed tokens (`extractConnectionTokens`, `:36-45`). Body is piped and Node's own parser normalizes CL/TE. No TE/CL desync introduced by the proxy.
- **Body-flood DoS:** dual cap — declared `content-length` fast-reject (`httpProxy.ts:139-149`) and streaming byte accumulator (`:305-325`), both draining/destroying cleanly; 100 MiB default, `Infinity` to disable.
- **Slow-loris:** `headersTimeout`/`keepAliveTimeout`/`requestTimeout` set on the edge server (`startRouter.ts:170-172`); upstream-leg timeouts in both proxies (`httpProxy.ts:247-249`, `wsProxy.ts:248-253`); WS head-buffer cap, idle timeout, per-connection byte budget (`wsProxy.ts:106-111, 297-319`).
- **Internal-topology disclosure:** upstream network-error `err.message` (which carries internal IP:port / cluster DNS) is deliberately NOT sent to the client — a generic `routing.upstreamUnreachable` is returned instead; the detail goes only to the hook/logger (`httpProxy.ts:278-291`). Env keys forwarded as headers are charset-validated at boot to block CRLF header injection (`resolveTarget.ts:159-169`).
- **ioredis unhandled `'error'` crashes:** every client attaches an `'error'` listener before connecting (`bootHandshake.ts:147-149, 197-199`; `redisHealthStore.ts:72-77`). Redis pub/sub messages are `JSON.parse`-guarded and type-checked (`redisHealthStore.ts:98-108`).
- **Boot-handshake SSRF:** `probeFallbackHealth` restricts the probe URL to `http:`/`https:` (`bootHandshake.ts:58, 67-68`); target comes from config, not attacker input. Cross-Redis detection logic reads the fallback key from the router's OWN Redis (correct — documented at `:190-195`).
- **Health poller:** probes only `new URL(binding).origin` (never an attacker path), config-sourced URLs, timeout + `tryCatch`, `interval.unref()` (`healthPoller.ts:78-105`).
- **WS service key is a constant** (`DEFAULT_WS_SERVICE = 'system'` or `routing.websocketService`), NOT derived from the request path — so the WS proxy is **not** exposed to Finding 1's prototype-key vector.

---

## Summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | CRITICAL* | Prototype-inherited service key (`/__proto__`, `/constructor`) → non-string `target` → `new URL` throws → unhandled rejection → router process crash (unauth DoS) in fallback mode. `resolveTarget.ts:257-262` + `httpProxy.ts:117`. *CRITICAL where a `fallback` env is configured; else HIGH. |
| 2 | MEDIUM | `void handleRequest(...)` has no error boundary before stream listeners; any pre-pipe throw (incl. #1 and a throwing custom resolver) crashes the process. `httpProxy.ts:61-63`. |
| 3 | LOW | Listening server has no `'error'` listener; `EADDRINUSE` / out-of-range port → uncaught startup exception. `startRouter.ts:164,188`. |
| 4 | LOW/info | Backend-controlled status/header bytes written verbatim to client; no CRLF injection reachable (Node parser barrier), fragile pattern only. `wsProxy.ts:264-278,344`. |
