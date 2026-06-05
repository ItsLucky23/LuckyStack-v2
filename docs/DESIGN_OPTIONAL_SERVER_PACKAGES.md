# Design — Optional `login` / `presence` / `sync` in `@luckystack/server`

> Status: **PROPOSAL / not yet implemented.** Recommended implementation branch:
> `refactor/optional-server-packages`. This is a security-sensitive framework
> refactor — it MUST land on its own branch with a dedicated security review,
> NOT in the 0.1.3 publish (which only carries the install-blocking template
> fixes). Last updated: 2026-06-04.

---

## 1. Goal & scope

Let a consumer scaffold a project that does **not** install `@luckystack/login`,
`@luckystack/presence`, and/or `@luckystack/sync`, and have `@luckystack/server`
boot + run correctly with those features degraded to a sensible no-op.

Today these three are **hard `dependencies`** of `@luckystack/server` and are
imported **statically at module load** across the server's core. So removing them
from the consumer's `package.json` does nothing — npm reinstalls them
transitively, and even if it didn't, the server's `dist` would throw
`ERR_MODULE_NOT_FOUND` on the first `import`.

`error-tracking`, `email`, `docs-ui`, `devkit` are already optional peers (see
`packages/server/package.json` `peerDependenciesMeta`) and are the pattern to
follow. This refactor extends that pattern to login/presence/sync.

**In scope:** server package only (+ its package.json, + the scaffold CLI to
offer the opt-out). **Out of scope for 0.1.3:** everything in this document.

---

## 2. The coupling map (verified)

Static value-imports of the three packages inside `packages/server/src/`:

| Pkg | Symbol | Site | Lifecycle role | Criticality |
|---|---|---|---|---|
| login | `getSession` | `httpHandler.ts:12`, `csrfRoute.ts:1`, `csrfMiddleware.ts:3`, `loadSocket.ts:28` | Cookie refresh on every HTTP req; **CSRF token lookup**; socket room ops | **Critical** |
| login | `saveSession` | `loadSocket.ts:28` | Persist `roomCodes`/location on room mutations | High |
| login | `deleteSession` | `authCallbackRoute.ts:2`, `authApiRoute.ts` | Single-session enforcement after login | Medium |
| login | `loginCallback` | `authCallbackRoute.ts:2` | OAuth callback: state→code→user→session | High |
| login | `createOAuthState`, `getOAuthProviders`, `isFullOAuthProvider`, `loginWithCredentials` | `authApiRoute.ts:8-13` | `/auth/api/*` credentials + OAuth init | High |
| sync | `handleSyncRequest` | `loadSocket.ts:27` | `socket.on('sync')` handler | High |
| sync | `handleHttpSyncRequest` | `syncRoute.ts:8` | `/sync/*` HTTP/SSE fallback | Medium |
| sync | `HttpSyncStreamEvent` (type) | `syncRoute.ts:8` | type annotation only — **erasable** | Low |
| presence | `socketConnected`, `socketDisconnecting`, `socketLeaveRoom`, `initActivityBroadcaster` | `loadSocket.ts:29-34` | connect/disconnect/location lifecycle | Low–Medium |

`verifyBootstrap.ts:62` already lazy-imports `getOAuthProviders` via
`await import('@luckystack/login')` — proof the lazy pattern is viable here.

The route dispatch tables live in `httpHandler.ts` (`PRE_PARAMS_ROUTES` /
`POST_PARAMS_ROUTES`); socket events are wired in `loadSocket.ts`'s
`io.on(connect)`. These are the two seams where wiring must become conditional.

---

## 3. The hard part — CSRF ↔ session ↔ login

`csrfMiddleware.ts` is the blocker. Today (verified):

```ts
// only runs when cookie-mode AND state-changing AND framework route AND token
if (!(isCookieMode && isStateChanging && looksLikeFrameworkRoute && !isCallbackPath && token)) return false;
const csrfSession = await getSession(token);       // ← needs login
if (!csrfSession?.id) return false;
if (provided && provided === csrfSession.csrfToken) return false; // session-bound token
```

CSRF is **session-bound**: the canonical CSRF token lives on the session record,
which only `@luckystack/login` writes. So "no login" currently means "no CSRF
token store" → every cookie-mode state-changing request on `/api`, `/sync`,
`/auth/api` would 403.

Note the gate: CSRF only applies in **cookie mode** (`session.basedToken ===
false`) on state-changing framework routes. Token-mode sessions, GET requests,
custom routes, and `/auth/callback` are already exempt.

### Decision: stateless double-submit fallback when login is absent

A login-less app is by definition **unauthenticated** (no user identity), so
per-user session-bound CSRF is not meaningful anyway. Replace it, only in the
no-login path, with the classic **double-submit cookie**:

- Server sets a random `csrf-token` cookie (the framework already owns a
  `csrf-token` cookie name + `getCsrfToken()` client helper — see
  `@luckystack/core` `getCsrfConfig`/`registerCsrfConfig`).
- Client echoes it in the `x-csrf-token` header (already the convention).
- Middleware compares cookie value vs header value — **no session read**.

This keeps CSRF protection intact without login. It must be written so the
**login-present path is byte-for-byte unchanged** (session-bound), and only the
absent path uses double-submit. → Primary security-review focus (§7).

---

## 4. Architecture — a capability layer

Add `packages/server/src/capabilities.ts`: a single module that detects + lazy
loads the optional packages once, and exposes typed accessors that return `null`
when absent. Mirrors `error-tracking/src/sentry.ts`'s `createRequire().resolve`
guard.

```ts
import { createRequire } from 'node:module';
const localRequire = createRequire(import.meta.url);

const has = (pkg: string): boolean => { try { localRequire.resolve(pkg); return true; } catch { return false; } };

// resolved once at boot, cached
export const capabilities = {
  login:    has('@luckystack/login'),
  presence: has('@luckystack/presence'),
  sync:     has('@luckystack/sync'),
};

let loginMod: typeof import('@luckystack/login') | null | undefined;
export const getLogin = async () => {
  if (loginMod !== undefined) return loginMod;
  loginMod = capabilities.login ? await import('@luckystack/login') : null;
  return loginMod;
};
// …getPresence(), getSync() identical
```

Every static `import { X } from '@luckystack/login'` becomes a call-time
`const login = await getLogin(); if (!login) { …degrade… }`. Type-only imports
(`HttpSyncStreamEvent`) stay as `import type` (erased, zero runtime cost).

A `session port`: the few server call-sites that need `getSession`/`saveSession`
outside auth (socket room ops, cookie refresh) route through a tiny indirection
so that when login is absent they hit a **no-op/Redis-only stub** (stores
`roomCodes` without user binding) rather than throwing.

---

## 5. Per-package plan

### login (HIGH risk)
- `package.json`: move `@luckystack/login` → `peerDependencies` + `peerDependenciesMeta.optional`.
- `authApiRoute.ts`, `authCallbackRoute.ts`: if `!login` → handler returns `404`/`{ status:'error', errorCode:'auth.disabled' }`. These are already isolated route handlers — cleanest conversion.
- `csrfMiddleware.ts` / `csrfRoute.ts`: branch — login present ⇒ existing session-bound path (unchanged); login absent ⇒ double-submit (§3).
- `httpHandler.ts` cookie-refresh + `loadSocket.ts` room ops: route `getSession`/`saveSession` through the session port (stub when absent).
- `verifyBootstrap.ts`: add an explicit, friendly boot check ("auth route hit but `@luckystack/login` not installed") instead of a raw module-not-found.

### presence (LOW–MEDIUM risk)
- `package.json`: → optional peer.
- `loadSocket.ts`: the four presence calls are already partly gated by `activityBroadcasterEnabled` config. Wrap each in `const p = await getPresence(); if (p) { … }`. Absent ⇒ no reconnect/afk broadcasts, no grace window (disconnect = immediate session expiry per TTL). Room joins/leaves still function. Lowest-risk of the three.

### sync (MEDIUM risk)
- `package.json`: → optional peer.
- `loadSocket.ts`: only attach the `socket.on('sync')` listener when `getSync()` resolves; else don't register it.
- `syncRoute.ts`: if `!sync` → `/sync/*` returns `{ status:'error', errorCode:'sync.disabled' }` (or 404). Keep `HttpSyncStreamEvent` as `import type`.
- Open question: presence + sync are usually wanted together. Consider gating them behind a single "real-time" scaffold choice, or allow independent opt-out. (§8 OPEN VRAAG)

---

## 6. Scaffold CLI changes (after the server refactor lands)

- `runPrompts()` (`create-luckystack-app/src/index.ts`): add multi-select "Which optional framework features?" → login(auth) / presence / sync (+ existing i18n, error-tracking).
- Generate `template/package.json` dependencies **dynamically** from the choices instead of shipping a static file (drop the unselected `@luckystack/*` lines).
- Conditional file inclusion (per the opt-out map in the parallel investigation): skip `template/luckystack/login/**`, `src/login|register|reset-password|settings/**`, `LoginForm.tsx`, `src/_sockets/syncRequest.ts`, `functions/sentry.ts`, `luckystack/i18n/**` + `src/_locales/**`, etc., and strip the matching imports from `config.ts` / `main.tsx` / `socketInitializer.ts`.
- `config.ts` no-login variant: `SessionLayout` must not `extends BaseSessionLayout` (the import is gone) — ship a minimal local `SessionLayout` + local `AuthProps` when login is opted out.

---

## 7. Risks & security-review focus

1. **CSRF regression (top priority).** Prove the login-present path is unchanged; prove the double-submit fallback actually blocks cross-site state changes. Add explicit tests for both modes.
2. **Silent auth disable.** If login is accidentally absent in an app that *needs* auth, fail LOUD at boot (`verifyBootstrap`), not silently at first request.
3. **Session stub correctness.** The Redis-only `roomCodes` stub must not leak across clients or resurrect deleted sessions.
4. **Transitive reinstall.** After moving to optional peers, verify a fresh `npm install` of a no-login scaffold genuinely omits the package from `node_modules` (npm won't add an optional peer unless something else depends on it — check api/core/etc. don't pull it).
5. **Type erosion.** No `as any` to paper over the now-`| null` module accessors — narrow with `if (!mod) return`.

---

## 8. Testing strategy

- Unit: CSRF middleware in both modes (login present → session-bound; absent → double-submit pass + cross-site reject).
- Scaffold matrix via `.smoke-test/run.mjs`, extended to several combos: full, no-login, no-presence, no-sync, no-presence+no-sync, minimal. Each must reach `typecheck 0 · build PASS · lint 0/0`, AND a runtime boot smoke (server starts, `/livez` 200, an authenticated `/api` round-trip where login is present, a 404 on `/auth/api` where login is absent).
- Add a runtime boot check to the smoke test — the current gate is compile/lint only and would NOT have caught the validator/`process`/page_dashboard runtime bugs.

### OPEN VRAAG (decide before implementation)
- **Granularity:** independent opt-out of login / presence / sync, or bundle presence+sync as one "real-time" toggle? (presence+sync are usually co-used.)
- **No-login CSRF default:** double-submit ON by default for login-less apps, or leave CSRF off and document it (since the app is unauthenticated anyway)?
- **Sync HTTP-fallback absent:** 404 vs `{ errorCode:'sync.disabled' }` — pick one error contract.

---

## 9. Rollout

1. Land this on `refactor/optional-server-packages`.
2. Security review of §7 (esp. CSRF) before merge.
3. Publish as a **minor** bump (new capability), not a patch — likely `0.2.0`, since server's dependency shape changes for consumers.
4. Only then extend the scaffold CLI (§6) + smoke matrix (§8).
