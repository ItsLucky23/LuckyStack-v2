# repo-src-tooling — Verified & Merged Audit Findings
Sources: reports/repo-src-scripts.md + review/v0.2.0/* · Verified against current working tree (branch chore/package-split-prep, 2026-06-11).

## Verdict summary
Of ~28 distinct findings touching `src/`, `server/`, `scripts/`, `functions/`, overlays and CI: roughly 22 are **CONFIRMED still live**, 3 are **ALREADY-FIXED** (the raw-token leak in `listSessions`/`revokeSession` was replaced with SHA-256 fingerprints; the workspaces host-shell PTY bridge `server/hooks/workspacesTerminal.ts` from SEC-31 was deleted when the prototype moved to `workspaces-handoff/`; the template `console.log(user)` from SEC-15 never existed in the repo `src` copy), and 1 is **REFUTED** (SEC-31). The biggest live issue is **SEC-14 / reports-Finding-J**: `src/_api/session_v1.ts` still returns `result: user` — the full `SessionLayout`, which `config.ts` confirms contains `token: string` and `csrfToken?: string` — handing the raw bearer + CSRF token to client JS on every `system/session` fetch, defeating HttpOnly-cookie mode. The review/ scan's stalest miss: it still flagged the `listSessions`/`revokeSession` raw-token exposure and the workspaces PTY RCE, both of which the current code has already addressed (commit 302cbf1 era). The reports/ scan (with its verification pass) was more accurate but also predates the SHA-256 fingerprint rework being visible — it correctly identified the still-live hand-rolled Redis-key duplication (Finding A) which remains. One path error in review/: QUA-053/SEC's i18n call sites cite `src/_functions/socketInitializer.ts`; the real file is `src/_sockets/socketInitializer.ts`.

## Findings

### SEC-14 — `system/session` returns raw session token + csrfToken to client JS  ·  severity: high  ·  status: CONFIRMED
- **Sources:** reports(#J) + review(SEC-14) — both
- **Current location:** `src/_api/session_v1.ts:17`
- **Original claim:** The session endpoint echoes the full session object including bearer `token`/`csrfToken`, defeating HttpOnly cookie mode (reports flagged it "for verification"; review rated it medium).
- **Verification (current code):** `main` returns `{ status: 'success', result: user }` with `user: SessionLayout | null`. `config.ts:306-315` shows `SessionLayoutBase extends Omit<User,'password'>` and explicitly adds `token: string` (308) and `csrfToken?: string` (315). So the raw bearer token and CSRF token are serialized to the client on every `system/session` mount. No stripping is applied.
- **Verdict & why:** CONFIRMED, and resolved in reports' favour: the object handed in is NOT token-stripped, so reports' Finding J ("would leak the bearer token if not stripped") is realized. Severity is high, not medium — any XSS becomes full session-token theft via a first-party call the SPA makes on load.
- **Recommendation:** Strip credentials before returning: `const { token: _t, csrfToken: _c, ...publicUser } = user; return { status:'success', result: publicUser };`. Better: a framework `toPublicSession()` helper in `@luckystack/core` so every consumer route is safe by default. Apply identically to the create-luckystack-app template + cli mirrors.

### SEC-32 — Default `User.email` has no `@unique` — registration dedupe is TOCTOU-racy  ·  severity: med  ·  status: SUPERSEDED (user decision 2026-06-13)
- **Sources:** review(SEC-32)
- **Current location:** `prisma/schema.prisma`
- **Original claim:** No DB uniqueness constraint on email; concurrent registrations can create duplicate accounts, after which login non-deterministically authenticates.
- **Verdict & why:** The original `email @unique` recommendation is **SUPERSEDED**. A hard `email @unique` breaks the framework default `auth.providerAccountStrategy: 'per-provider'`, where the same email via two providers is intentionally two rows. Uniqueness is config-driven:
  - `'per-provider'` (default) ⇒ DB-enforced `@@unique([email, provider])` (blocks duplicate `(email, provider)` incl. under a race).
  - `'unified'` ⇒ application-level dedup via `findByEmailAnyProvider` (link-or-reject the email-matched account before create); a consumer may add a DB `email @unique` to also close the registration race.
- **Resolution:** Root `prisma/schema.prisma` now uses `@@unique([email, provider])` (matching the template + the `defaultPrismaUserAdapter`, which already implements `findByEmailAnyProvider`). The TOCTOU race for `'per-provider'` is closed by the composite constraint.

### SEC-19 — `updateUser` writes `name`/`theme`/`language` with no runtime validation  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(SEC-19)
- **Current location:** `src/settings/_api/updateUser_v1.ts:67-72`
- **Original claim:** The reference settings route trusts client input — no name-length policy; theme/language accept arbitrary strings.
- **Verification (current code):** Avatar input IS format-checked (base64 data-URL regex). But `if (name) newData = { ...newData, name }`, `if (theme) ...`, `if (language) ...` assign raw client values. `theme`/`language` are TypeScript-typed only; per the framework's prod runtime-validation no-op (review SEC-02, pkg-core), they are effectively unvalidated at runtime. No max length on `name`.
- **Verdict & why:** CONFIRMED. The reference route teaches an input-trust anti-pattern and lets authenticated users pollute session/theme/language with arbitrary strings.
- **Recommendation:** Add explicit length/enum validation (e.g. `name.trim().slice(0,80)`, allow-list theme/language) rather than relying on the type layer.

### SEC-47 — `scaffold:page` accepts `..` segments and can write outside `src/`  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(SEC-47)
- **Current location:** `scripts/scaffoldPage.mjs:54` (segment split) + `:63` (`path.join(SRC_DIR, ...folderSegments, 'page.tsx')`); validation `:90-101`
- **Original claim:** Path-name accepts `..`, can write outside src/repo; same shape in `scripts/scaffoldRouteTest.mjs`.
- **Verification (current code):** `normalizedArg.split('/').filter(s => s.length > 0)` removes only empty segments — a `..` segment survives. `validatePagePath` only rejects reserved underscore folders and checks a visible segment remains; it does NOT reject `..`. `path.join(SRC_DIR, '..','..',...)` would climb out of `src/`. No traversal guard.
- **Verdict & why:** CONFIRMED. An AI agent steered by prompt injection could write files outside `src/`. Low (local dev tool), but trivially closable.
- **Recommendation:** Reject any segment equal to `..` (or `.`) in `validatePagePath`, and assert `absoluteTargetPath.startsWith(SRC_DIR)`. Mirror in `scaffoldRouteTest.mjs` and the template copies.

### SEC-48 — CI workflow has no top-level `permissions` and uses mutable action tags  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(SEC-48)
- **Current location:** `.github/workflows/ci.yml` (no `permissions:` block; `actions/checkout@v4` :21, `actions/setup-node@v4` :24)
- **Original claim:** Over-broad default token scope + mutable action pins — supply-chain footgun shipped to every consumer.
- **Verification (current code):** ci.yml has no `permissions:` key (so the default `GITHUB_TOKEN` is broad), and both actions are pinned to `@v4` mutable tags, not commit SHAs.
- **Verdict & why:** CONFIRMED. Cheap hardening.
- **Recommendation:** Add top-level `permissions: contents: read` and pin actions to full commit SHAs (`actions/checkout@<sha> # v4`).

### SEC-33 — Login OAuth overlay credential selection / empty-secret registration  ·  severity: med  ·  status: PARTIALLY-FIXED
- **Sources:** review(SEC-33) + review(QUA-015)
- **Current location:** `luckystack/login/oauthProviders.ts:22-50`
- **Original claim:** Overlay silently falls back to `DEV_*` OAuth creds in prod and registers providers with empty `clientSecret`; a stale pre-0.2.0 fork masking `@luckystack/login/register`.
- **Verification (current code):** Now gated: `const prod = NODE_ENV !== 'development'`, `useProdCreds = prod && secure`, `env(prodKey, devKey)` returns prod keys only when `useProdCreds`. Provider registration is guarded by `if (env('GOOGLE_CLIENT_ID', 'DEV_GOOGLE_CLIENT_ID'))` — i.e. only the CLIENT_ID presence is checked, NOT the CLIENT_SECRET. `env(...)` returns `?? ''`, so a provider with a present ID but missing SECRET still registers with an empty secret.
- **Verdict & why:** PARTIALLY-FIXED. The "DEV creds in prod" half is materially improved (now requires `prod && secure` to use prod creds; in a misconfigured prod without `SECURE=true` it would still pick dev creds — a residual gap). The "empty clientSecret registration" half is CONFIRMED still present. The overlay-still-exists / fork concern (QUA-015) is also CONFIRMED — the file is still a hand-rolled overlay rather than relying on `@luckystack/login/register` auto-wiring.
- **Recommendation:** Require BOTH `*_CLIENT_ID` and `*_CLIENT_SECRET` non-empty before pushing a provider; tie dev/prod purely to `NODE_ENV`; or delete the overlay and let the canonical `register` auto-wiring be the only path.

### A / CFG-27 / G — Settings session routes hand-roll the internal Redis key format  ·  severity: med  ·  status: CONFIRMED
- **Sources:** reports(#A,#G) + review(CFG-27)
- **Current location:** `src/settings/_api/listSessions_v1.ts:20,23,30,32`, `revokeSession_v1.ts:21,32`, `deleteAccount_v1.ts:20,38`
- **Original claim:** Three routes rebuild `${PROJECT_NAME}-activeUsers:${id}` / `${PROJECT_NAME}-session:${token}` with a `?? 'luckystack'` default instead of consuming `sessionKeyFor`/`activeUsersKeyFor` from `@luckystack/login`; a Rule-12 miss and a silent-prefix-mismatch correctness/security risk.
- **Verification (current code):** All three files still declare `const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack'` and template the keys inline. They import `redis` from `@luckystack/core` directly and never call the exported key formatters.
- **Verdict & why:** CONFIRMED. If the framework derives its prefix from project config and it diverges from `PROJECT_NAME ?? 'luckystack'`, these routes silently scan the wrong keys — listSessions returns empty, revokeSession fails to revoke, deleteAccount orphans the activeUsers set. Ships identically in template + cli assets.
- **Recommendation:** Consume `activeUsersKeyFor`/`sessionKeyFor` from `@luckystack/login`, or (better) have the package expose `listUserSessions(userId)` / `revokeSessionById` so consumer code never touches raw Redis keys.

### listSessions/revokeSession raw-token exposure (review SEC-18-class)  ·  severity: high→n/a  ·  status: ALREADY-FIXED
- **Sources:** review (the "return opaque session identifiers instead of raw tokens" recommendation, SECURITY.md:186)
- **Current location:** `src/settings/_api/listSessions_v1.ts:34-40`, `revokeSession_v1.ts:29-47`
- **Original claim:** Session-list endpoints return raw session tokens to the client, defeating HttpOnly across all devices; revokeSession accepts a raw token.
- **Verification (current code):** `listSessions` now returns `id: createHash('sha256').update(token).digest('hex')` plus `expiresInSeconds`/`isCurrent` — never the raw token. `revokeSession` accepts that opaque `id` and resolves it back by scanning the user's own `activeUsers` set and SHA-256-comparing. Explicit `//?` comments document the no-raw-token intent.
- **Verdict & why:** ALREADY-FIXED. This is exactly the review/ recommendation, already implemented — a clear case of review/ predating the fix.
- **Recommendation:** None for the repo; ensure the template + cli mirrors carry the same fingerprint logic.

### SEC-31 — Host-shell PTY bridge wired at boot (RCE surface)  ·  severity: med  ·  status: REFUTED (code removed)
- **Sources:** review(SEC-31)
- **Current location:** n/a — `server/hooks/workspacesTerminal.ts` does not exist; `server/server.ts` no longer registers it.
- **Original claim:** `server/hooks/workspacesTerminal.ts:33` wires a host PTY with auth but no authz, registered unconditionally in `server/server.ts:61`.
- **Verification (current code):** No `workspacesTerminal.ts` under `server/hooks/` (only `notifications.ts`, `registry.ts`, `types.ts`). `server/server.ts` registration block contains only email/sentry/notification wiring — no terminal/PTY. Grep for `PTY`/`workspacesTerminal` across `server/` returns nothing.
- **Verdict & why:** REFUTED / ALREADY-FIXED. The workspaces prototype moved to `workspaces-handoff/` (out of audit scope per the prototype note) and the PTY hook went with it. review/ predates that move.
- **Recommendation:** None.

### SEC-15 — Template `session_v1` logs full session to stdout (repo copy)  ·  severity: med  ·  status: REFUTED for repo src (template-only)
- **Sources:** review(SEC-15)
- **Current location:** `src/_api/session_v1.ts` — no `console.log`
- **Original claim:** `session_v1` `main` contains `console.log(user)` printing token/csrfToken every request (drift: template stale, repo clean).
- **Verification (current code):** The repo `src/_api/session_v1.ts` has NO console.log (19-line file, body is just the `return`). review/ itself states the repo copy is clean and the template is the buggy mirror.
- **Verdict & why:** REFUTED for this area (`src/`). The live defect is in `packages/create-luckystack-app/template/...`, owned by the create-app area, not repo `src/`. (The token-leak via `result: user` IS live here — see SEC-14 — but that is the return value, not a log line.)
- **Recommendation:** Fix the template mirror under the create-app area; nothing to change in repo `src/`.

### Medium#1 / docs-explorer — `/docs` API Explorer ships ungated with full endpoint catalog  ·  severity: med  ·  status: CONFIRMED
- **Sources:** reports(#1,#E,#F) + review(HOOKS docs-coverage / enabledInProd context)
- **Current location:** `src/docs/page.tsx:9-17` (no `template`/`middleware`/`//? intent:` exports), static `import apiDocs from './apiDocs.generated.json'`
- **Original claim:** `/docs` exports neither `template` nor `middleware`, statically bundles the full generated API surface (routes, auth requirements, payload schemas) + a request runner, reachable by any unauthenticated visitor in prod.
- **Verification (current code):** The component still exports no `template`, no `middleware`, and no `//? intent:` line. It statically imports `apiDocs.generated.json` (the full catalog) and renders a socket+HTTP request runner. Contrast `src/admin/page.tsx` which guards via `middleware`.
- **Verdict & why:** CONFIRMED. A remote party gets a complete attack-surface map plus a built-in request runner; the catalog is bundled client-side regardless of gating. Also the intent/template doc gaps (reports F) remain.
- **Recommendation:** Add a login/admin `middleware` (and/or exclude the route from prod builds); add a `template` export and a `//? intent:` line. Treat as dev-only — this is the pattern consumers copy.

### #2 / QUA-054 / H — Leftover `console.log` of filesystem paths in prod file server  ·  severity: low/med  ·  status: CONFIRMED
- **Sources:** reports(#2,#H) + review(QUA-054)
- **Current location:** `server/prod/serveFile.ts:57-58`
- **Original claim:** Unconditional `console.log(filePath)` / `console.log(rootFolder)` run on every static-asset request in prod, leaking the absolute install path.
- **Verification (current code):** Both lines present verbatim at 57-58, not dev-gated, on the hot path.
- **Verdict & why:** CONFIRMED. Leftover debug.
- **Recommendation:** Delete both lines.

### H (docs) — Stray `console.log(joined)` in `src/docs/page.tsx`  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(#H)
- **Current location:** `src/docs/page.tsx:711`
- **Original claim:** Stray debug `console.log(joined)` in committed docs page.
- **Verification (current code):** Present at line 711.
- **Verdict & why:** CONFIRMED. Leftover debug.
- **Recommendation:** Remove.

### I / QUA-087 — serveFile sensitive-file denylist returns HTTP 200, plus fragile substring matching  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(#I) + review(QUA-087)
- **Current location:** `server/prod/serveFile.ts:69-87` (denylist), `:86` (`res.end("Forbidden")` with no status)
- **Original claim:** The substring `.includes('.ts')`-style denylist is fragile (blocks any asset whose name merely contains `.ts`) and the blocked response is `res.end("Forbidden")` with no `writeHead(403)` → HTTP 200.
- **Verification (current code):** The denylist (`.env`/`.ts`/`.tsx`/`.py`/`package.json`/… `schema.prisma`) is present; the genuine guard is the earlier `filePath.startsWith(rootFolder)` 403 (which DID improve — now preceded by `path.normalize` + leading-`../` strip). The blocked branch at line 86 is `return res.end("Forbidden")` — no status code, so 200.
- **Verdict & why:** CONFIRMED (both the messy substring belt-and-suspenders and the 200-vs-403 status bug). Not exploitable (real guard is the startsWith check), but wrong status + fragile.
- **Recommendation:** Set `res.writeHead(403, ...)` before `end`; rely on the allow-list of served extensions (already present via the contentType switch) and drop the substring denylist.

### QUA-086 — `src/docs/page.tsx` uses `as unknown as` + `as never` casts (zero-cast policy)  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-086)
- **Current location:** `src/docs/page.tsx:426` (`apiDocs as unknown as DocsResult`), `:471,:548,:633` (`... as never`)
- **Original claim:** The docs page violates the zero-tolerance cast policy (CLAUDE.md Rule 21).
- **Verification (current code):** `useState<DocsResult | null>(apiDocs as unknown as DocsResult)` at 426; `upsertSyncEventCallback(callbackParams as never)` (471), `apiRequest(apiParams as never)` (548), `syncRequest(syncParams as never)` (633). A nearby comment (541) even claims it works "without needing `as unknown as`", contradicting the casts.
- **Verdict & why:** CONFIRMED. Direct Rule 21 violation; per Rule 21 escalation the fix is `npm run generateArtifacts` and fixing the generator, not casting.
- **Recommendation:** Regenerate artifacts; if the dynamic route/version pattern genuinely can't be typed, isolate behind a documented helper rather than scattering `as never`.

### C / CFG (socketInitializer throttle) — Activity-heartbeat throttle hardcoded at 10s  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(#C) + review(CONFIGURABILITY, presence-throttle class)
- **Current location:** `src/_sockets/socketInitializer.ts:118`
- **Original claim:** The activity-heartbeat throttle `10_000`ms is hardcoded and not surfaced in `config.ts`.
- **Verification (current code):** Line 118 `if (now - lastActivitySent < 10_000) { return; }`; comment at 109-110 documents the 10s throttle. Not config-driven.
- **Verdict & why:** CONFIRMED. Minor configurability gap.
- **Recommendation:** Surface alongside `socketActivityBroadcaster` config if a knob is wanted.

### #3 (playground streamToToken) — Unauthenticated token-targeted streaming  ·  severity: low  ·  status: CONFIRMED (deliberate demo)
- **Sources:** reports(#3)
- **Current location:** `src/playground/_sync/streamToToken_server_v1.ts:32-33`
- **Original claim:** `auth: { login: false }` lets an unauthenticated caller stream arbitrary text to any socket-id/token room.
- **Verification (current code):** `export const auth: AuthProps = { login: false }` at 32-33; the file's own header (1-19) documents that `streamTo([socketId])` works without recipient auth because the id IS a room.
- **Verdict & why:** CONFIRMED but deliberately a `login:false` playground demo — scope limited, documented intent.
- **Recommendation:** Keep out of any non-demo template; require login on token-targeted streaming in real apps.

### B / HOK-19 — No `postPasswordChanged` hook; notification wired by direct cross-boundary import  ·  severity: med/low  ·  status: CONFIRMED
- **Sources:** reports(#B) + review(HOK-19)
- **Current location:** `server/hooks/notifications.ts:71-75` (comment), `src/settings/_api/changePassword_v1.ts:5,73`
- **Original claim:** `sendPasswordChangedNotification` is called directly by `changePassword` (not via a hook); no `postPasswordChange` hook exists, diverging from the auto-wired `postLogin` notification.
- **Verification (current code):** notifications.ts comment still reads "Called directly … not via a hook — there is no `postPasswordChange` hook." `changePassword_v1.ts:5` imports it across `src/ → server/`, calls `void sendPasswordChangedNotification(user.id)` at :73. Contrast `registerHook('postLogin')` wiring above.
- **Verdict & why:** CONFIRMED. Future password-change paths (admin reset, new route) silently skip the notification; add-ons can't subscribe.
- **Recommendation:** Add a `postPasswordChanged` hook in the framework and dispatch it from the auth mutation, letting notifications subscribe like `postLogin`.

### HOK-05 — No pre/postAccountDelete hooks on `deleteAccount`  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(HOK-05)
- **Current location:** `src/settings/_api/deleteAccount_v1.ts` (no `dispatchHook`/`registerHook` anywhere in the file)
- **Original claim:** The most consequential, GDPR-relevant mutation has no veto/audit/cascade-cleanup seam; packages can't subscribe.
- **Verification (current code):** Grep for `Hook`/`dispatchHook`/`pre`/`post` in `deleteAccount_v1.ts` returns nothing — the route revokes sessions, dels the activeUsers key, and deletes the Prisma row with no hook dispatch.
- **Verdict & why:** CONFIRMED. No injection point for invoice/legal-hold veto, audit log, external cascade (Stripe/S3/mailing list), or goodbye email.
- **Recommendation:** Add `preAccountDelete` (vetoable) + `postAccountDelete` hooks in the framework; dovetails with MIS-020 (avatar cleanup) and MIS-012 (UserAdapter.delete).

### MIS-020 — Account deletion never removes the user's uploaded avatar file  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(MIS-020)
- **Current location:** `src/settings/_api/deleteAccount_v1.ts:37-41`
- **Original claim:** deleteAccount revokes sessions + deletes the Prisma row but never unlinks `${user.id}.webp` under `getUploadsDir()` (written by `updateUser_v1.ts`), leaving PII on disk — a GDPR residue shipped to every consumer.
- **Verification (current code):** Grep for `webp`/`unlink`/`getUploadsDir`/`avatar` in `deleteAccount_v1.ts` returns nothing. `updateUser_v1.ts:37-40` confirms the avatar is written as `${user.id}.webp` in `getUploadsDir()`. No cleanup on delete.
- **Verdict & why:** CONFIRMED. GDPR "delete my account" leaves the user's photo on the filesystem indefinitely.
- **Recommendation:** After the Prisma delete, `fs.unlink(path.join(getUploadsDir(), \`${user.id}.webp\`)).catch(()=>{})`. Better: own it inside an `onAccountDelete` hook in `@luckystack/login` (ties to HOK-05).

### D — `deleteAccount` redis-key del redundant with `revokeUserSessions`  ·  severity: low  ·  status: CONFIRMED
- **Sources:** reports(#D)
- **Current location:** `src/settings/_api/deleteAccount_v1.ts:37-38`
- **Original claim:** Calls `revokeUserSessions(user.id)` (which clears the activeUsers set framework-side) then also `redis.del(...activeUsers:${user.id})` — redundant coupling.
- **Verification (current code):** Lines 37-38 are exactly `await revokeUserSessions(user.id);` then `await redis.del(\`${PROJECT_NAME}-activeUsers:${user.id}\`);`. The manual del also re-uses the hand-rolled key (Finding A).
- **Verdict & why:** CONFIRMED. Redundant and re-couples to the raw key format.
- **Recommendation:** Drop the manual `redis.del` if `revokeUserSessions` already clears the set; or rely on the package helper.

### QUA-053 — Six i18n keys referenced by client code exist in no locale file  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(QUA-053)
- **Current location:** `src/_sockets/socketInitializer.ts:158,174,207,271,297,326,347,386,416` (call sites); `src/_locales/{en,nl,de,fr}.json` (missing keys). NOTE: review cites the path as `src/_functions/socketInitializer.ts` — that file does not exist; the real path is `src/_sockets/socketInitializer.ts`.
- **Original claim:** `common.sessionReplacedElsewhere`, `common.unknownError`, `common.connectionError`, `common.logoutFailed`, `common.invalidGroup`, `common.invalidLocation` are emitted via `notify.*({ key })` but exist in no locale, so the user sees the literal key string. Rule 13 makes i18n mandatory.
- **Verification (current code):** `grep -c` for each of the six keys in `src/_locales/en.json` returns 0 for all six. The call sites in `src/_sockets/socketInitializer.ts` use exactly these `common.*` keys (lines 158/174/207/271/297/326/347/386/416).
- **Verdict & why:** CONFIRMED. Connection/session error toasts render raw keys — a Rule 13 violation visible on the first error a user hits.
- **Recommendation:** Add the six keys to all four locale files (and the template locales). Consider a lint/CI check cross-referencing `notify({key})` literals against the locale JSON.

### QUA-054→see #2 (merged above).

### QUA-085 — `changePassword_v1` diverged into three non-identical copies  ·  severity: low  ·  status: CONFIRMED (repo copy is canonical; drift is in mirrors)
- **Sources:** review(QUA-085)
- **Current location:** `src/settings/_api/changePassword_v1.ts` vs template + cli mirrors
- **Original claim:** Repo / template / cli copies of changePassword have diverged.
- **Verification (current code):** The repo copy is coherent (revokes other sessions via `revokeUserSessions(user.id, user.token)`, dispatches a hook, fires the notification). The divergence is between this and the template/cli mirrors — which live in the create-app/cli areas, not repo `src/`.
- **Verdict & why:** CONFIRMED as a drift finding, but the live fix belongs to the mirror-owning areas (create-app/cli); the repo `src/` copy is the reference. Flagged here for completeness.
- **Recommendation:** Re-sync template + cli `changePassword_v1.ts` to the repo copy (a packaging concern; out of this area's edit scope).

### CFG-28 — `lintInvariants.mjs` cannot define project-specific invariant rules  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(CFG-28)
- **Current location:** `scripts/lintInvariants.mjs:131-137` (loadConfig)
- **Original claim:** The RULES array (no-as-any, no-arbitrary-color, i18n-jsx) is hardcoded; `loadConfig` reads only `{ block, warn }` from `luckystack.invariants.json` — a consumer can promote/demote the three shipped rules but cannot ADD one.
- **Verification (current code):** `loadConfig` returns `{ block: Array.isArray(parsed.block)?...:[], warn: Array.isArray(parsed.warn)?...:[] }` — only severity overrides, no rule definitions. RULES remain hardcoded earlier in the file.
- **Verdict & why:** CONFIRMED. No path for a per-project diff-time invariant (e.g. "no direct @prisma/client import in components" — itself a CLAUDE.md convention with no machine check).
- **Recommendation:** Support consumer-defined rules (regex + message + severity) in `luckystack.invariants.json`, merged over the built-ins.

### CFG-43 — `scaffold:page` template choice is a path-name heuristic with no override flag  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(CFG-43)
- **Current location:** `scripts/scaffoldPage.mjs:124-126`
- **Original claim:** The dashboard-vs-plain template is picked by a hardcoded path regex; no `--template` override, and project-registered custom templates can never be scaffolded.
- **Verification (current code):** `looksLikeDashboard = /(^|\/)(admin|dashboard|settings|billing|account|profile)(\/|$)/.test(lowerPath); const flavor = looksLikeDashboard ? 'dashboard' : 'plain';` — no flag, no support for custom `TemplateProvider` templates.
- **Verdict & why:** CONFIRMED. Scaffolding e.g. `reports/weekly` (wants dashboard) or a custom template can't express intent.
- **Recommendation:** Add a `--template <name>` flag (validated against the `Template` union) overriding the heuristic.

### QUA-056 — `bundleServer.mjs` imports `esbuild` as a phantom (undeclared) dependency  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(QUA-056)
- **Current location:** `scripts/bundleServer.mjs:1` (`import { build } from 'esbuild'`)
- **Original claim:** esbuild is imported but not declared as a dependency.
- **Verification (current code):** Line 1 imports `build` from `esbuild`; `grep "\"esbuild\""` across root `package.json` and all `packages/*/package.json` returns nothing — esbuild is undeclared (relies on a transitive hoist).
- **Verdict & why:** CONFIRMED. The bundle step breaks if the transitive esbuild disappears.
- **Recommendation:** Add `esbuild` to root `devDependencies`.

### QUA-057 — `@luckystack/core` barrel connects to Redis at import time, forcing `process.exit` workarounds in generator scripts  ·  severity: med  ·  status: CONFIRMED (tooling symptom)
- **Sources:** review(QUA-057)
- **Current location:** `scripts/generateTypeMaps.ts` (+ the core barrel import-time side effect, pkg-core)
- **Original claim:** Importing the core barrel opens a Redis connection, so generator scripts must `process.exit` to terminate.
- **Verification (current code):** The root cause is in `packages/core` (import-time env load + dev PrismaClient + cleanup timer — see review QUA-059, pkg-core area). The tooling symptom (generator scripts forced to hard-exit) is real but the fix lives in pkg-core, not `scripts/`.
- **Verdict & why:** CONFIRMED as a symptom; UNCERTAIN that `scripts/` is the right fix site — the durable fix is making the core barrel side-effect-free (pkg-core area).
- **Recommendation:** Defer to pkg-core: make Redis/Prisma connection lazy so importing the barrel has no side effects; then generator scripts need no exit workaround.

### MIS-021 — `publishPackages.mjs` has no pre-flight safety checks and no resume  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(MIS-021)
- **Current location:** `scripts/publishPackages.mjs:52-65`
- **Original claim:** The publish loop has no git-clean / registry / version preflight and no resume after a mid-run failure.
- **Verification (current code):** The `for (const wave of WAVES)` loop publishes each package; on failure it prints "Already done this run: …" and `process.exit(1)` with a manual-recovery message — no resume flag, no preflight (clean tree / version-not-already-published / dist-built checks).
- **Verdict & why:** CONFIRMED. For a solo maintainer shipping 0.2.0 this is the highest-likelihood release failure mode, blast radius = every consumer installing during the broken window.
- **Recommendation:** Add a preflight (clean git tree, all dist built, versions not already on npm) and a `--resume-from <pkg>` flag.

### QUA-055 — CI never runs the vitest unit suite or `lint:packages`  ·  severity: med  ·  status: CONFIRMED
- **Sources:** review(QUA-055)
- **Current location:** `.github/workflows/ci.yml:41-48`
- **Original claim:** CI runs `lint` + `build` + `test` (the endpoint sweep) but never `test:unit` or `lint:packages`, so framework code is unverified.
- **Verification (current code):** ci.yml steps: Lint (`npm run lint`), Build, Test sweep (`npm run test`), E2E-if-installed. No `test:unit` and no `lint:packages` step.
- **Verdict & why:** CONFIRMED. Framework `packages/*` unit tests don't run in CI.
- **Recommendation:** Add `npm run test:unit` and `npm run lint:packages` (or equivalents) as CI steps.

### QUA-088 — Stray dev script with hardcoded internal IP committed  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-088)
- **Current location:** `server/dev/request.py:3`
- **Original claim:** A leftover Python dev script with a hardcoded internal IP ships in the repo.
- **Verification (current code):** `server/dev/request.py` exists; line 3 `url = "http://192.168.178.68:80"` (a private LAN IP).
- **Verdict & why:** CONFIRMED. Dead scratch file leaking an internal IP; also ships via the template if included.
- **Recommendation:** Delete `server/dev/request.py`.

### QUA-091 — 75KB scratch file `.publish-dry.out` committed at repo root  ·  severity: low  ·  status: CONFIRMED
- **Sources:** review(QUA-091)
- **Current location:** `.publish-dry.out` (repo root, 75KB)
- **Original claim:** A large publish-dry-run scratch file is committed.
- **Verification (current code):** `ls -la` shows `.publish-dry.out` 75044 bytes at root.
- **Verdict & why:** CONFIRMED. Committed build noise.
- **Recommendation:** Delete and add to `.gitignore`.

### QUA-090 — `eslint.official.config.js` 20-line `import-x/order` config is dead  ·  severity: low  ·  status: UNCERTAIN
- **Sources:** review(QUA-090)
- **Current location:** `eslint.official.config.js:114`
- **Original claim:** A 20-line `import-x/order` block is overridden by a later duplicate key set to `'off'`.
- **Verification (current code):** Not opened in this pass (a config-lint nicety, lower priority than the security/correctness findings above).
- **Verdict & why:** UNCERTAIN — would need to read the two `import-x/order` entries and confirm later-key-wins. Low impact regardless.
- **Recommendation:** If confirmed, delete the dead block or the override.

### QUA-092 — `buildPackages.mjs` topology comment no longer matches WAVES  ·  severity: low  ·  status: UNCERTAIN
- **Sources:** review(QUA-092)
- **Current location:** `scripts/buildPackages.mjs:5`
- **Original claim:** The header topology comment drifted from the actual `WAVES` array.
- **Verification (current code):** Not diffed in this pass (a comment-accuracy nit).
- **Verdict & why:** UNCERTAIN — needs a comment-vs-WAVES diff. Trivial impact.
- **Recommendation:** Re-sync the comment to the WAVES order if drifted.

### HOK-29 — Explicit "no hook gaps in tooling" marker  ·  severity: n/a  ·  status: CONFIRMED (no defect)
- **Sources:** review(HOK-29)
- **Current location:** `scripts/testAll.ts`
- **Original claim:** Recorded marker that the tooling dimension was audited and has no hook gaps.
- **Verification (current code):** No action required — it is a coverage marker, not a defect.
- **Verdict & why:** CONFIRMED as a non-finding (audit-coverage note).
- **Recommendation:** None.

### E — `functions/*.ts` shim override docs accurately describe framework-internal bypass  ·  severity: n/a  ·  status: CONFIRMED (no defect)
- **Sources:** reports(#E)
- **Current location:** `functions/db.ts`, `redis.ts`, `session.ts`, `sentry.ts`
- **Original claim:** The shim "edit this file" comments correctly state framework-internal calls bypass the shims — docs match code (the one place they do).
- **Verification (current code):** reports/ verified this with its adversarial pass; no contradiction found. Not re-litigated here.
- **Verdict & why:** CONFIRMED as a non-defect (docs accurate). The only caveat is the teaching surface (the docs page) is ungated — see Medium#1.
- **Recommendation:** None.
