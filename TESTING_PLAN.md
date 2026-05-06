# LuckyStack — Testing Plan for Today's Changes

**Branch:** `chore/package-split-prep`
**Date:** 2026-05-06
**Goal:** verify the package-split work + reviewer-found bug fixes + new configurability hooks before merge to master.

---

## 0. Pre-flight (do this first)

Run the package build and the project bootstrap. This is the **fastest signal** that nothing is broken — if it doesn't build, every test below is moot.

```powershell
# from C:\youcomm\LuckyStack-v2
npm install
npm run build
```

Expected: every `@luckystack/*` package emits `dist/` with no TypeScript errors. If you see errors complaining about `getLogger`, `dispatchHook('apiError'|'syncError'|'rateLimitExceeded'|'corsRejected'|'passwordResetRequested'|'passwordResetCompleted'|'passwordChanged')`, `registerPresenceConfig`, `registerAvatarConfig`, `autoSelectEmailSender`, or `initActivityBroadcaster` — flag and fix before running runtime tests.

Then boot:

```powershell
npm run dev
```

You should see: server listens, Redis connects, no `console.log('CORS rejected', ...)`-style warnings on startup. Open `http://localhost:5173` and confirm the dashboard mounts.

---

## 1. Critical bug fixes (reviewer-flagged)

### 1.1 Presence typo fix — `initActivityBroadcaster`

**Why this matters:** old name `initAcitivityBroadcaster` was a typo. Anyone importing it correctly would get `undefined` at runtime and crash on socket connect.

**Steps:**
1. Boot the server, log in.
2. Open dev tools → Network → WS, confirm a `connection` succeeds.
3. Set `socketActivityBroadcaster: true` in `config.ts`, restart.
4. Log in from a second browser session, navigate to a sync-enabled page, confirm `userBack` events fire and presence info propagates.

**Pass:** no `TypeError: initAcitivityBroadcaster is not a function` in server or client console; presence broadcasts work.

### 1.2 Logout PROJECT_NAME fallback

**Why this matters:** without `PROJECT_NAME` env var set, the Redis `activeUsers` key was `undefined-activeUsers:<id>`, breaking session tracking.

**Steps:**
1. **Unset** `PROJECT_NAME` in `.env.local` (comment it out), restart the server.
2. Log in, then log out (click Logout in the Navbar).
3. Inspect Redis: `redis-cli KEYS '*activeUsers*'` — should see `luckystack-activeUsers:<userId>` keys, never `undefined-activeUsers:*`.

**Pass:** logout completes without leaving stranded `undefined-activeUsers:*` keys.

### 1.3 `create-luckystack-app` version no longer silently falls back

**Why this matters:** old behavior shipped `0.0.1` for every dep regardless of what was published.

**Steps:**
1. From a clean temp folder, run:
   ```powershell
   cd $env:TEMP
   node C:\youcomm\LuckyStack-v2\packages\create-luckystack-app\dist\index.js test-app
   ```
2. Open `test-app/package.json`, confirm every `@luckystack/*` dep is pinned to the actual version of `create-luckystack-app/package.json` (currently `0.0.1` — but that's the truth, not a fallback).
3. **Negative test:** edit `packages/create-luckystack-app/package.json` to remove the `version` field, rebuild, rerun the scaffolder, confirm it **throws** with a clear error instead of silently falling back.

**Pass:** scaffolded `package.json` has the real version; missing version aborts with an error.

### 1.4 CORS — `localhost` opt-in + log spam fix

**Why this matters:** `localhost` was always allowed (even in prod), and every rejected origin spammed unstructured `console.log` lines (DoS amplification vector).

**Steps:**
1. **Dev path (should still work):** with `dev: true` in `config.ts`, hit any API from `http://localhost:5173`. No CORS error.
2. **Prod simulation:** set `dev: false` in `config.ts` (or set `resolvedEnvironment.dev = false`), restart. Hit the API from a non-listed origin (open `https://example.com` in a tab and `fetch()` your API). Should be **rejected**.
3. **Log gating:** with `logging.devLogs: false`, confirm CORS rejections do NOT print to terminal. With `devLogs: true`, they print **once per rejection** as a structured `getLogger().warn` line (not 4 separate `console.log` lines).
4. **Hook fires:** register a `corsRejected` handler in any overlay (or temporarily in `server/server.ts`):
   ```ts
   import { registerHook } from '@luckystack/core';
   registerHook('corsRejected', async (payload) => {
     console.log('AUDIT corsRejected:', payload);
     return undefined;
   });
   ```
   Trigger a rejection, confirm the audit log fires with `{ origin, normalizedOrigin, allowedOrigins, allowLocalhost }`.

**Pass:** allowLocalhost behaves as configured; rejection logs are structured and gated; `corsRejected` hook fires.

### 1.5 Custom-route handler error boundary

**Why this matters:** a thrown handler in `registerCustomRoute(...)` previously crashed the request loop.

**Steps:**
1. Add to any overlay (or temporarily in `server/server.ts` before `bootstrapLuckyStack`):
   ```ts
   import { registerCustomRoute } from '@luckystack/server';
   registerCustomRoute(async (req, res) => {
     if (req.url === '/_throwtest') throw new Error('boom');
     return false;
   });
   ```
2. Hit `http://localhost:80/_throwtest` from a browser/curl.
3. Expected: `500 { "status":"error","errorCode":"server.customRouteFailed" }`. Server log shows `getLogger().error('custom route handler threw', ...)`. Sentry receives a `captureException` with `{ routePath, method, source: 'customRoutesRegistry' }`.
4. Subsequent requests should still work — process did not crash.

**Pass:** thrown handler returns 500, logs the error, fires Sentry, server stays alive.

---

## 2. New configurability surfaces

### 2.1 Logger registry (`registerLogger`)

**Steps:**
1. In `server/server.ts` (after dotenv loads, before `bootstrapLuckyStack`), register a no-op logger:
   ```ts
   import { registerLogger } from '@luckystack/core';
   registerLogger({
     debug: () => {},
     info: () => {},
     warn: () => {},
     error: () => {},
   });
   ```
2. Restart, trigger an API failure (call any `_api/*.ts` route that throws). Confirm **no** `ERROR in <name>` line in the terminal — the logger swallowed it.
3. Replace with a structured logger:
   ```ts
   registerLogger({
     debug: (msg, ctx) => console.log(JSON.stringify({ level: 'debug', msg, ctx })),
     info: (msg, ctx) => console.log(JSON.stringify({ level: 'info', msg, ctx })),
     warn: (msg, ctx) => console.log(JSON.stringify({ level: 'warn', msg, ctx })),
     error: (msg, err, ctx) => console.log(JSON.stringify({ level: 'error', msg, err: String(err), ctx })),
   });
   ```
4. Trigger the same failure. Confirm output is JSON, ready to pipe to Datadog/Pino.
5. Remove the registration. Confirm the default colored-console output is back unchanged.

**Pass:** logger calls flow through whatever is registered; default behavior unchanged when nothing is registered.

### 2.2 Hook handler errors are now visible

**Steps:**
1. Add a misbehaving handler:
   ```ts
   import { registerHook } from '@luckystack/core';
   registerHook('postLogin', async () => { throw new Error('plugin bug'); });
   ```
2. Log in.
3. Confirm in the server terminal: `hook: handler for "postLogin" threw` line **and** the login flow continues (the error doesn't break anything else — handlers stay isolated).
4. If Sentry is configured, confirm the exception lands in Sentry with `{ hook: 'postLogin' }` context.

**Pass:** plugin throws are visible (logger + Sentry), main flow not interrupted.

### 2.3 Extensible redacted log keys

**Steps:**
1. From any overlay or `server/server.ts`:
   ```ts
   import { registerRedactedLogKeys } from '@luckystack/core';
   registerRedactedLogKeys(['mrn', 'ssn', 'apiKey']);
   ```
2. Set `logging.devLogs: true`. Send an API request whose body contains `{ mrn: 'SECRET-123', name: 'Alice' }` (e.g. via the dashboard or a curl).
3. In the server terminal, confirm the request log shows `mrn: '[REDACTED]'`, `name: 'Alice'`, no leak.
4. Already-defaulted keys (`password`, `confirmPassword`, `token`, `authorization`, `cookie`, `set-cookie`, plus the configured session cookie name) still redact.

**Pass:** custom redacted keys are masked alongside the defaults.

### 2.4 New error/security hooks

For each, register a handler that prints to terminal, trigger the condition, confirm fire:

| Hook | How to trigger |
|---|---|
| `apiError` | Throw inside any `_api/*.ts` route's `main`. Make an HTTP API call to that route. |
| `syncError` | Throw inside any `_server_v1.ts` sync handler. Trigger that sync via the UI. |
| `rateLimitExceeded` | Set `rateLimit = 2` on an API route, hit it 3× in quick succession. |
| `corsRejected` | Already covered in 1.4 above. |
| `passwordResetRequested` | Submit forgot-password form with a real email and a fake email — both should fire (matched + unmatched). |
| `passwordResetCompleted` | Complete a forgot-password flow end-to-end. |
| `passwordChanged` | In settings, change your password. |

For each, confirm the handler payload matches the type defined in `packages/core/src/hooks/types.ts` (apiError/syncError/rateLimitExceeded/corsRejected) or `packages/login/src/hookPayloads.ts` (passwordReset*/passwordChanged).

**Pass:** every hook fires with the right payload at the right moment.

### 2.5 Configurable bcrypt rounds

**Steps:**
1. Default (don't touch config): register a new account via `/register`. Inspect the resulting Prisma user's `password` column — should start with `$2b$10$` (10 rounds, default).
2. Override: in `config.ts`, add `auth: { bcryptRounds: 12 }` inside the `registerProjectConfig({...})` call. Restart.
3. Register another new account. Inspect — should start with `$2b$12$`.
4. Same expectation when calling `updatePasswordHash` (forgot-password and settings change-password flows).

**Pass:** stored hash prefix reflects the configured cost factor.

### 2.6 `autoSelectEmailSender()` from `@luckystack/email`

**Steps:**
1. With **no** email env vars set, restart. Trigger a forgot-password (or hit the Console adapter via any send path). Confirm a "Console" email box prints in terminal.
2. Set `RESEND_API_KEY=test` in `.env.local`. Restart. Trigger forgot-password — confirm Resend lazy-loads (will throw without a real key, but the path matters; you can verify via the terminal log line "Failed to load resend package" if it's not installed).
3. Replace with `SMTP_HOST=localhost` (no Resend). Restart. Same confirmation for SMTP path.
4. Force selection: change `server/server.ts` to `registerEmailSender(autoSelectEmailSender({ force: 'console' }))`. Even with `RESEND_API_KEY` set, Console wins.

**Pass:** selection priority is Resend → SMTP → Console; `force` overrides.

### 2.7 Configurable presence behavior

**Steps:**
1. Default: turn `socketActivityBroadcaster: true` in `config.ts`, log in, switch tabs (intentional disconnect). Confirm peers see "user away" after ~20s.
2. Override timers:
   ```ts
   import { registerPresenceConfig } from '@luckystack/presence';
   registerPresenceConfig({
     disconnectTimers: { tabSwitchMs: 5000, transportCloseMs: 30_000, defaultMs: 1000 },
   });
   ```
3. Restart, repeat the tab switch. Confirm the AFK trigger fires after **5 seconds**.
4. Override ignoreReasons:
   ```ts
   registerPresenceConfig({ ignoreReasons: ['ping timeout', 'transport close'] });
   ```
   Now `transport close` is treated as a no-op — when a client refreshes, peers shouldn't see them go offline.

**Pass:** all timers and reason lists are configurable at runtime.

### 2.8 Configurable avatar serving

**Steps:**
1. Default: hit `/avatars/<userId>` in browser (after the user uploaded an avatar). 200 with `Content-Type: image/webp`, `Cache-Control: public, max-age=86400`.
2. Override:
   ```ts
   import { registerAvatarConfig } from '@luckystack/core';
   registerAvatarConfig({
     formats: [
       { extension: 'png', contentType: 'image/png' },
       { extension: 'webp', contentType: 'image/webp' },
     ],
     cacheControl: 'public, max-age=3600',
   });
   ```
3. Drop a `.png` into the uploads folder for a user, hit the avatar URL — should serve PNG. Drop a `.webp` for another user — should serve WebP.
4. Confirm `Cache-Control: max-age=3600` is on the response.
5. Hit a non-existent userId — 404.

**Pass:** formats are tried in order; cache header is configurable.

---

## 3. Parallel-AI work — flows that need full end-to-end runs

These weren't built by me but are end-to-end-untested in the same session. Test them as a unit.

### 3.1 Forgot-password flow

1. Sign up a new credentials account (`/register`) using a real-ish email format.
2. Log out. Click "Forgot password?" on `/login`. Submit the email.
3. Confirm:
   - Console adapter prints the email with a `/reset-password?token=<hex>` link.
   - The `passwordResetRequested` hook fired with `{ matched: true, userId, token, ttlSeconds }`.
   - Redis has a `<projectName>-pwreset:<token>` key with TTL ≈ 3600s.
4. Click the link, set a new password, confirm it.
5. Confirm:
   - The reset succeeds.
   - All other sessions for that user are revoked (log in from a second tab first to verify they get kicked).
   - The `passwordResetCompleted` hook fired with `{ userId, revokedOtherSessions: true }`.
   - The Redis token is deleted (one-time use).
6. **Anti-enumeration:** repeat step 2 with `unknown@example.com`. The form returns success, **no email is sent**, but `passwordResetRequested` fires with `{ matched: false }`.

### 3.2 Settings — change password / sessions / preferences / delete account

For each new API in `src/settings/_api/*`:

| API | Test |
|---|---|
| `changePassword_v1` | Wrong current password → `login.wrongPassword`. Right current → success, `passwordChanged` hook fires, other sessions revoked, current session stays alive. |
| `listSessions_v1` | Returns array with `expiresInSeconds`. Cross-check Redis TTL of each `<projectName>-session:*` key. |
| `revokeSession_v1` | Revoking another session removes it from Redis and the user gets logged out on that device on next request. |
| `signOutEverywhere_v1` | Revokes ALL sessions including current; user is redirected to login. |
| `deleteAccount_v1` | Deletes the user row + all sessions. Login attempt with old credentials fails. |
| `updatePreferences_v1` | Theme + language updates persist on the user row + reflect in the next session. |

### 3.3 OAuth providers

If you have any OAuth env vars configured (`GOOGLE_CLIENT_ID`, etc.):
1. Click the provider button on `/login`.
2. Confirm redirect → callback → user created/linked → session created → dashboard.
3. With `auth.providerAccountStrategy: 'per-provider'` (default), same email via Google + Credentials creates two User rows.
4. Switch to `'unified'` (requires the Prisma `Account` table per the login package's README) — same email links to one User.

### 3.4 Docs UI

If `@luckystack/docs-ui` is wired into the overlay folder or registered manually:
1. Navigate to `/_docs` (or the configured path).
2. Confirm every API route shows up with method, auth requirements, request/response schemas.
3. Click "Try it" on a public route, confirm it fires through the framework normally.

### 3.5 `create-luckystack-app` scaffolder

1. From `$env:TEMP`, run `node C:\youcomm\LuckyStack-v2\packages\create-luckystack-app\dist\index.js scaffold-test`.
2. `cd scaffold-test`, `npm install`, `npx prisma migrate dev`, `npm run dev`.
3. Confirm: dev server boots, login page renders, you can register and log in.
4. Confirm `package.json` deps reference the actual `@luckystack/*` versions (no `0.0.1` masking).

### 3.6 Multi-instance router (if applicable)

If you're using the router for staging/multi-instance:
1. Boot two backend instances on different ports + the router.
2. Confirm router round-trips: WebSocket handshake, HTTP API, sync events, presence events.
3. Kill one backend, confirm the router fails over to the healthy one.
4. Reboot the dead backend, confirm health-poll re-adds it.

---

## 4. Regression checks (things that *shouldn't* have changed)

### 4.1 Existing dev workflow still works

- Hot reload triggers when you edit a `_api/*.ts` file.
- TypeScript types regenerate (`apiTypes.generated.ts`, `apiInputSchemas.generated.ts`).
- The colored `console.log('...', 'red')` shim still works for code that hasn't been migrated.
- All translations (`src/_locales/*.json`) load on language switch.
- Login → dashboard → settings → logout flow works.
- All your existing playground / example pages render.

### 4.2 Sentry capture coverage

If Sentry is initialized:
- `tryCatch` still auto-captures (existing behavior).
- New auto-capture sites: hook handler errors, custom-route handler errors, HTTP API/sync top-level catches.
- Verify with `Sentry.captureException`-style mocks in dev, or by inspecting the Sentry UI for new event types.

---

## 4.5 Sync streaming primitives (`broadcastStream`, `streamTo`, throttle)

**Why this matters:** the framework now has three server-side stream channels (originator-only, room-broadcast, targeted) plus a coalescing helper for LLM token streams. Validate the audience routing is correct.

**Steps (multi-browser):**

1. Open `http://localhost:5173/playground` in **two** Chrome windows. Sign in with a different account in each (or the same — single-session enforcement may kick the first one if you don't enable `allowMultipleSessions`).
2. In both tabs, type the same room code (e.g. `playground-room`) and click **Join** in each. Both should show `Joined: playground-room` in the badge.
3. **Originator-only stream test:** in window A, click `Sync stream (originator-only)`. Window A's log should fill with `progress 12% (working)` lines. Window B's log should NOT receive any chunk lines — only the final `streamProgress complete` summary.
4. **Broadcast stream test:** in window A, click `Sync broadcastStream`. **Both** windows should see `broadcast chunk: "..."` lines as they stream. The `Use createStreamThrottle` checkbox controls whether messages are coalesced — toggle it and watch the message count in the log change drastically (uncoalesced ≈ 1 chunk per token, throttled ≈ 1 chunk every 50ms). **Important:** the throttle batches only when the source is faster than its flush window. Default `Interval (ms)` is `20` which is below the 50ms flush window — leave it that low or batching won't be visible. If you set it ≥ 50, the timer fires before each next token and you'll see one chunk per token even with throttle on (correct behavior — the throttle just has nothing to coalesce).
5. **Solo-room degrade:** leave the room in window B, click `Sync broadcastStream` from A while only A is in the room. The server log (with `logging.stream: true` in config) should still print `broadcastStream` lines — but the `io.to(...).emit` path internally takes the unicast shortcut (room.size ≤ 1). Visually identical, slightly cheaper path.
6. **Sync echo cross-broadcast:** in window A, type a message, click `Sync echo`. Both A and B receive it through their `playground/echo received` log entries.
7. **API stream test:** click `API stream (counter)` in either window. That window's log fills with `tick N/10 = sum` chunks. Toggle `Log API stream chunks` off and re-run — chunks still arrive (server-side fires regardless), just don't appear in the log.

**Pass:**
- Originator-only `stream(...)` payloads ONLY land in the requesting window.
- `broadcastStream(...)` payloads land in EVERY window joined to the room.
- Throttle visibly reduces chunk count without breaking the rendered text.
- `streamTo` is exercised via the playground? Currently not wired with a UI button — verify by reading `packages/sync/src/handleSyncRequest.ts` `emitStreamToTokens` for a code review pass instead.

---

## 4.6 CSRF protection (cookie-mode only)

**Why this matters:** state-changing HTTP requests in cookie mode now require an `x-csrf-token` header that matches the session's stored value. Token-mode is unaffected.

**Steps:**

1. Confirm `sessionBasedToken: false` in `config.ts` (cookie mode).
2. Log in. From browser devtools console:
   ```js
   const r = await fetch('/auth/csrf', { credentials: 'include' });
   const { csrfToken } = await r.json();
   console.log(csrfToken);  // 64-char hex
   ```
3. **Negative path:**
   ```js
   await fetch('/api/system/session/v1', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     credentials: 'include',
     body: '{}'
   }).then(r => r.json());
   // → { status: 'error', errorCode: 'auth.csrfMismatch', ... } with 403
   ```
4. **Positive path:** add `'x-csrf-token': csrfToken` to the headers, repeat → 200 with the session payload.
5. **Token-mode immunity:** flip `sessionBasedToken: true`, restart, log in. Repeat step 3 (no CSRF header) — should succeed because cookie mode is off.
6. **Auto-attach via `httpFetch`:**
   ```js
   import { httpFetch } from '@luckystack/core/client';
   await httpFetch('/api/system/session/v1', { method: 'POST', body: '{}' });
   // → 200, header attached automatically; `Content-Type: application/json` was inferred from the string body
   ```
7. **Cache invalidation on logout:** log out, log back in. The new `/auth/csrf` returns a NEW token (different hex). The client-side `clearCsrfToken()` is called from `socketInitializer.ts` on the success branch of the logout socket event — verify by triggering an `httpFetch` immediately after relogin (it fetches fresh).

**Pass:** state-changing cookie-mode requests reject without the header; token mode passes through; `httpFetch` auto-attaches; logout invalidates the cache.

---

## 4.7 Playground test bench

**Why this matters:** the new playground section consolidates every multi-browser scenario the framework supports. Use it as the smoke-test checklist before merging.

**Steps:**

1. Navigate to `/playground`, scroll to the top **Test bench** section.
2. Verify the room input + Join/Leave buttons work. Joined-rooms badge updates.
3. Check the Echo message + Stream text fields persist across button clicks (state is held in React).
4. Confirm the four stream-option toggles (`Log API stream chunks`, `Log sync stream chunks`, `Use createStreamThrottle`, Interval ms) all wire through to button-handler behavior (toggle off + re-run = chunks suppressed in the log but still received on the server).
5. Click `Clear log` — the log empties; firing any button refills it.
6. Verify the log auto-scrolls to the bottom on new entries (any stream test).
7. Verify the `<= 250` cap doesn't overflow memory — fire the broadcast stream with `intervalMs=10` for a long text (~2000 chars) and confirm the log stays bounded.

**Pass:** all controls behave; log renders; multi-browser room sync works; stream chunks land in the right tabs.

---

## 4.8 Color theme — neutral dark palette

**Why this matters:** the dark theme was rewritten from purple to slate. Verify nothing reads incorrectly.

**Steps:**

1. Toggle dark mode (add `class="dark"` to `<html>` via devtools, or whatever the theme switcher does).
2. Walk through `/playground` → every Section. Confirm:
   - Backgrounds are clean slate, not purple.
   - Primary buttons are blue, with white text (was purple-pink before).
   - Dropdown selected items have visible primary borders.
   - MultiSelect unchecked checkboxes show a visible border (regression fix from earlier).
   - `text-muted` and `text-disabled` actually render (used by the playground's "Joined: ..." badge and disabled buttons).
3. Toggle back to light mode, sweep again — should look identical to pre-refactor.

**Pass:** no purple residue, contrast readable, both modes work.

---

## 4.9 Generated emitter types (sync streaming type-map)

**Why this matters:** `_server_v{n}.ts` now receives three emitters (`stream`, `broadcastStream`, `streamTo`). The type-map extractor unions all three call-site payloads into the route's `serverStream` type. Recipients consume the union via `upsertSyncEventStreamCallback`.

**Steps:**

1. Run `npm run generateArtifacts`. Confirm `src/_sockets/apiTypes.generated.ts` contains:
   - `export type SyncBroadcastStreamEmitter<T extends StreamPayload = StreamPayload> = (payload?: T) => void;`
   - `export type SyncStreamToEmitter<T extends StreamPayload = StreamPayload> = (tokens: string | string[], payload?: T) => void;`
2. Confirm the playground sync route map shows `serverStream` populated for `playground/streamBroadcast` (with `chunk: string`) and `playground/streamProgress` (with `step | total | progress | phase`).
3. In the playground page, hover the `upsertSyncEventStreamCallback` registration for `playground/streamBroadcast` — the callback's `stream` argument should be typed as the union of the broadcast chunk shape; no `any`.
4. **Negative test:** create a one-off file `src/scratch/_sync/foo_server_v1.ts` that doesn't call any stream helper. Regenerate. Try to register `upsertSyncEventStreamCallback({ name: 'scratch/foo', ... })` — should be a TS error (the callback type collapses to `never`).

**Pass:** generated types include the new emitters; route's `serverStream` reflects every call site; consumer-side typing matches; routes that don't stream reject the stream-callback registration at compile time.

---

## 5. Stuff explicitly NOT done today (deferred)

These were in the original plan but were either too disruptive given the in-flight parallel work, or low priority. Document them in a follow-up ticket:

1. **Per-package config split** — every feature's config still lives in core's `projectConfig.ts` (it grew significantly today). Splitting `email/login/presence/sentry` config into their own packages with `register{Feature}Config` is multi-day refactor work that overlaps with what the parallel AIs already grew. Defer until next PR cycle.
2. **Per-route `timeoutMs` / `responseTransform`** — useful but not blocking. `rateLimit` is already per-route which covers most needs.
3. **devkit naming-validation message customization** — minor.
4. **Router probe timeout / boot-key prefix tweaks** — only relevant for installers who actually deploy the multi-instance router; ship as default for now.
5. **`csrfFailed` hook** — depends on what the CSRF AI window did with `packages/core/src/csrf.ts`; verify it dispatches a hook on validation failure as a follow-up.

---

## 6. If something fails

| Symptom | Likely cause | Where to look |
|---|---|---|
| `getLogger is not a function` | core didn't rebuild after my export changes | `npm run build` from root |
| `dispatchHook('apiError', ...)` complains the name isn't in `HookPayloads` | `packages/core/src/hooks/types.ts` augmentation didn't pick up | Check `tsconfig` includes for the file |
| `initActivityBroadcaster is not a function` | a caller wasn't updated | grep for `initAcitivityBroadcaster` (the old typo) |
| Forgot-password says `forgotPasswordDisabled` | `auth.forgotPassword` not set to `'framework'` in config.ts | Already set in my change |
| CORS suddenly rejects localhost in dev | `allowLocalhost` defaults to false, and dev didn't enable it | Verified my `config.ts` change sets `allowLocalhost: resolvedEnvironment.dev` |
| `bcrypt` hashes still `$2b$10$` after override | config was registered after login.ts read it (shouldn't happen — `getProjectConfig()` is lazy) | Confirm `registerProjectConfig({ auth: { bcryptRounds: ... } })` runs before any login attempt |
| Avatar 404 for existing users | new format list doesn't include `webp` | Default is `[{ extension: 'webp', ... }]` — only changes if you call `registerAvatarConfig` |
| Playground broadcastStream lands only in window A | window B never joined the room | check the `Joined: ...` badge in window B |
| `upsertSyncEventStreamCallback` typed as `never` | the route's `_server_v{n}.ts` doesn't call any stream helper yet | run `npm run generateArtifacts` after adding a `stream(...)` / `broadcastStream(...)` / `streamTo(...)` call |
| `auth.csrfMismatch` on every state-changing fetch | client isn't sending `x-csrf-token` | use `httpFetch` from `@luckystack/core/client`, OR fetch `/auth/csrf` first and attach manually |
| `SyncBroadcastStreamEmitter` "no exported member" in `_server_v1.ts` | generated types stale | run `npm run generateArtifacts`; the regen pulls the new emitter type from `packages/devkit/src/typeMap/emitterArtifacts.ts` |
| Dark theme still purple | `index.css` change wasn't picked up by Vite HMR | hard-refresh; the @theme block is read at first compile only |

---

## 7. Sign-off checklist

- [ ] `npm run build` clean
- [ ] `npm run dev` boots without error
- [ ] All flows in §1 (critical bugs) verified
- [ ] All flows in §2 (configurability) verified
- [ ] All flows in §3 (parallel-AI work) verified
- [ ] §4 regressions check clean (incl. §4.5 sync streaming, §4.6 CSRF, §4.7 playground bench, §4.8 dark palette, §4.9 generated emitter types)
- [ ] Deferred items in §5 captured as follow-up tickets
- [ ] Commit + PR opened for review

When everything passes, commit with `git add` of the specific files changed (avoid `git add -A` — pull a fresh status first to make sure no stray files come along) and push.
