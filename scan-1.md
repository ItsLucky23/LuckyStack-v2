# LuckyStack Codebase Scan #1

Branch scanned: `chore/package-split-prep`
Date: 2026-05-06

Findings after reading the package layout, build script, server bootstrap, hooks registry, login/api/http handlers, project/deploy config types, and the `create-luckystack-app` template.

## What's actually here

Workspace monorepo with **13 packages** under `packages/`, split into two tiers:

| Tier-A (intended for npm) | Tier-B (project glue, stays private) |
|---|---|
| `@luckystack/core`, `login`, `api`, `sync`, `presence`, `server`, `sentry`, `email`, `test-runner`, `docs-ui`, `create-luckystack-app` | `@luckystack/devkit`, `@luckystack/router` |

Build pipeline (`scripts/buildPackages.mjs`) builds in 4 dependency waves — `core` → fan-out → `api/sync/presence` → `server`. All 13 currently build clean.

**One critical fact:** every `package.json` still has `"private": true` and the `@luckystack` npm scope is still unregistered (per `SESSION_STATE.md` Task #25). **So nothing is publishable today** — only the structure is ready.

## What a consumer's repo will look like

`create-luckystack-app` is fully wired. After `npx create-luckystack-app my-app`, the user gets a small project (~30 files), with framework internals living in `node_modules/@luckystack/*`. Their root contains:

```
my-app/
├── config.ts                  # registerProjectConfig({...})
├── deploy.config.ts           # services + infra topology
├── services.config.ts         # preset/service map
├── prisma/schema.prisma       # User model (6 enums, 1 model)
├── server/server.ts           # ~25 lines — calls bootstrapLuckyStack()
├── luckystack/                # overlay folder
│   ├── core/clients.ts        # optional Prisma/Redis overrides
│   ├── login/oauthProviders.ts
│   ├── login/userAdapter.ts
│   └── server/index.ts        # registerHook(...) calls
├── src/                       # your pages + _api + _sync
├── tsconfig.*.json, vite.config.ts
└── .env_template, .env.local_template, .gitignore
```

This is the right shape — they don't fork the 700-line `server.ts` anymore. `bootstrapLuckyStack` auto-imports `luckystack/<pkg>/*.ts` in topological order so registries are populated before `listen()`.

## Configurability — very high

`packages/core/src/projectConfig.ts` is the canonical surface. Roughly **50 knobs**, all deep-mergeable, all defaults-shipped. Highlights consumers can tune without forking:

- `auth.bcryptRounds`, `passwordMinLength/MaxLength`, `forgotPassword: 'framework' | 'custom' | 'disabled'`, `providerAccountStrategy`, `oauthStateTtlSeconds`
- `http.sessionCookieName/SameSite/Path`, `requestBodyMaxBytes`, `securityHeaders.*`, `cors.allowedOrigins/allowLocalhost`, `liveEndpoint/readyEndpoint/healthEndpoint`
- `rateLimiting.{store: 'memory'|'redis', defaultApiLimit, defaultIpLimit, windowMs}`
- `socket.{maxHttpBufferSize, pingTimeout, pingInterval}`
- `paths.*` (every generated artifact path is overridable)
- `email.*`, `sentry.{client,server}.tracesSampleRate`, etc.

On top of that, **13 DI registries** let consumers swap full implementations: `registerPrismaClient`, `registerRedisClient`, `registerOAuthProviders`, `registerUserAdapter`, `registerEmailSender`, `registerNotifier`, `registerLogger`, `registerLocaleReloader`, `registerCustomRoute`, `registerHook`, `registerProjectConfig`, `registerPostLoginRedirect`, `registerAvatarConfig`. Genuinely flexible.

## Hook coverage

Already dispatched and typed in `packages/core/src/hooks/types.ts` plus per-package `hookPayloads.ts`:

- API: `preApiExecute`, `postApiExecute`, `apiError`
- Sync: `preSyncFanout`, `postSyncFanout`, `syncError`
- Auth: `preLogin`, `postLogin`, `preRegister`, `postRegister`, `preLogout`, `postLogout`
- Session: `preSessionCreate`/`postSessionCreate`, `preSessionDelete`/`postSessionDelete`
- Socket: `onSocketConnect`/`onSocketDisconnect`, `preRoomJoin`/`postRoomJoin`, `preRoomLeave`/`postRoomLeave`, `onLocationUpdate`
- Security: `rateLimitExceeded`, `corsRejected`

**Gaps worth filling before publishing — none urgent but cheap to add now while signatures aren't frozen:**

1. `preApiValidate` / `postApiValidate` — intercept before/after runtime input typecheck (audit / fuzz logging)
2. `preApiRespond` / `postApiRespond` — mutate response (PII redaction, response signing)
3. `preErrorNormalize` / `postErrorNormalize` — custom error code mapping
4. `preSessionRefresh` / `postSessionRefresh` — for sliding-expiration accounting
5. `csrfMismatch` — security audit signal
6. `preEmailSend` / `postEmailSend` — audit transactional mail (especially password resets)
7. `onUploadStart` / `onUploadComplete` — avatar upload doesn't surface hooks today

`prePresenceUpdate`/`postPresenceUpdate` are typed but I didn't confirm they dispatch — worth verifying.

## Security findings (real, prioritized)

**1. Logout-by-route-suffix is a real footgun — `packages/api/src/handleApiRequest.ts:137`**
```ts
if (routeLeaf === 'logout') { await logout(...); return; }
```
*Any* API whose final path segment is `logout` (e.g. `admin/logout/v1`) silently calls the framework logout instead of running the handler. Match the full route (`system/logout/vN`) instead.

**2. CORS bypass via missing Origin header — `packages/server/src/httpHandler.ts:103`**
```ts
const origin = req.headers.origin ?? req.headers.referer ?? req.headers.host ?? '';
```
Falling back to `host` means a non-browser client (curl, native app) that omits Origin and Referer will pass `allowedOrigin()` because `host` matches the bound origin. Browsers always send `Origin` cross-origin, so this doesn't expose CSRF — but it neuters CORS for non-browser callers. Suggest: if neither `origin` nor `referer` is present, only allow same-origin reads, fail-close on writes.

**3. `validator.escape()` on the password — `packages/login/src/login.ts:98`**
```ts
const password = escape(params.password || '');
```
HTML-escapes `& < > " '` *before* the bcrypt compare. The password never reaches HTML, and this introduces silent breakage if anyone's password contains those chars and is later changed via a flow that doesn't escape. Drop it; bcrypt and length checks are enough. Same critique applies to escaping the email in such a way that legacy raw rows might not be findable.

**4. `/_test/reset` endpoint — `httpHandler.ts:280`**
Gated by `NODE_ENV !== 'production'` and an optional `TEST_RESET_TOKEN`. If a deployment forgets to set `NODE_ENV=production` (Cloud Run/k8s/dockerfile gotcha) AND the token is unset, anyone can wipe sessions, active users, and rate limits over the network. **Fail closed**: require the token unconditionally, OR require `NODE_ENV in {'development','test'}` rather than `!== 'production'`.

**5. OAuth `name` flows into the DB unsanitized — `login.ts:358`**
```ts
const name = String(userData[provider.nameKey] || 'didnt find a name')
```
If consumers render user names as `dangerouslySetInnerHTML` or in emails as raw HTML, that's stored XSS. Out of framework scope to fix downstream, but worth a one-line note in the login README.

**6. `bcryptjs` instead of `bcrypt`**
Pure-JS, ~30% slower than native. Fine for 10 rounds, just be aware that bumping to 12 will hurt login throughput more than with native bcrypt.

**7. Cookie `Secure` flag formatting — `httpHandler.ts:72`**
Trailing `;` joined with a leading space generates `... Secure;` or `... ; ` (extra blank space) when `SECURE !== 'true'`. Cosmetic; browsers tolerate it.

## Other things to address before publishing

- **Versioning:** every package is `0.0.1`. Pick `0.1.0` for the first real cut so semver-respecting tooling treats it as a published artifact rather than a pre-alpha placeholder.
- **`peerDependencies` consistency:** `@luckystack/core` declares peers for `@prisma/client`, `ioredis`, `socket.io`, `socket.io-client`, `zod`. Double-check every other tier-A package that imports those declares matching peer ranges (so `npm install @luckystack/login` doesn't pull a duplicate Prisma).
- **`files` array audit:** run `npm run pack:dry` (already in your scripts) for each tier-A package and confirm each tarball contains `dist/`, `package.json`, `README.md`, `LICENSE` and nothing else (no `src/`, no `tsconfig`, no `.cache`).
- **`.npmignore` vs `files`:** the `files` whitelist is in use — good, no `.npmignore` needed. Just verify no test fixtures or `.env*` sneak in.
- **README reality-check:** the root `README.md` still talks about `git clone PROJECT_NAME` + Docker compose as the install path, not `npx create-luckystack-app`. Once published, update it so the first thing a new user reads matches the supported install flow.
- **`auth.providerAccountStrategy: 'unified'`** is documented in `projectConfig.ts:148` but no code paths were found that link an Account row across providers — verify it's actually implemented or mark it `'per-provider'`-only for v1 and remove the option.
- **`server/server.ts` runtime smoke test** is still pending per `SESSION_STATE.md` — the migration to `bootstrapLuckyStack` builds clean but hasn't been booted since. Run `npm run server`, log in, fire one API call and one sync, before flipping `private: false` anywhere.

## Overall take

The architecture is in a much better shape than the branch name implies. The boundaries are correct (core → feature packages → server bootstrap), the hook surface is real (not just typed but wired through the request lifecycle), and the create-luckystack-app + overlay folder pattern is the right DX answer. The remaining work to ship is small and almost entirely operational (npm scope, version bump, smoke test, the security fixes above).

Block publish on items 1, 2, and 4 from the security list — each is a one-line fix and each is reachable from a remote attacker without auth.

## Suggested next moves

1. Fix the three blocking security items (logout suffix match, CORS host fallback, /_test/reset fail-closed).
2. Drop `escape()` on password, optionally on email.
3. Run `npm run server` end-to-end once.
4. `npm run pack:dry` and inspect tarballs.
5. Bump versions to `0.1.0`, register the npm scope, flip `private: false` on tier-A only, then `npm pack` for real and install into a throwaway directory to verify resolution + types.
6. Optionally add the 4-5 missing hooks before locking signatures (`csrfMismatch`, `pre/postEmailSend`, `pre/postSessionRefresh`, `pre/postApiRespond`).
