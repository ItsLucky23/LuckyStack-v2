# Missing Functionality Report — LuckyStack v0.2.0 Review

**Scope & methodology.** One combined audit agent per package/area (core, server, login, presence, sync, email, error-tracking, router, devkit, docs-ui, cli, create-luckystack-app, secret-manager, test-runner, consumer app `src/`, release tooling) swept its surface for functionality a consumer would reasonably expect but cannot get without forking. Each finding was self-verified against the actual source, existing config options, the hook registries (so "missing" is never claimed when an extension hook already covers it), and the existing `docs/audits/` material. Near-duplicate findings reported by multiple agents were merged into single entries listing all affected paths. The benchmark throughout is the project's stated north star: *a stranger installs `@luckystack/*` packages and builds a real product without forking*. No critical-severity findings; ordering is high → medium → low.

## Severity Index

| ID | Severity | Title | File | Area |
|---|---|---|---|---|
| MIS-001 | high | EmailMessage supports neither attachments nor custom headers | `packages/core/src/emailRegistry.ts` | pkg-email |
| MIS-002 | high | No email-verification flow for credentials registration | `packages/login/src/login.ts` | pkg-login |
| MIS-003 | high | No userLeft/offline peer event on hard disconnect or grace expiry | `packages/presence/src/activity/lifecycle.ts` | pkg-presence |
| MIS-004 | medium | check-env / check-i18n always exit 0 — no CI fail mode | `packages/cli/src/index.ts` | pkg-cli |
| MIS-005 | medium | `add login` does no preflight for scaffold-shaped files its handlers require | `packages/cli/src/commands/addLogin.ts` | pkg-cli |
| MIS-006 | medium | Import-dependency graph cannot follow custom tsconfig path aliases | `packages/devkit/src/importDependencyGraph.ts` | pkg-devkit |
| MIS-007 | medium | Sync events never rendered in docs UI despite emitter producing them | `packages/docs-ui/src/docsHtml.ts` | pkg-docs-ui |
| MIS-008 | medium | No flush/shutdown lifecycle for error trackers — buffered events lost on exit | `packages/core/src/errorTrackerRegistry.ts` | pkg-error-tracking |
| MIS-009 | medium | No client/browser entry for error tracking; client config slots never consumed | `packages/error-tracking/src/sentryConfig.ts` | pkg-error-tracking |
| MIS-010 | medium | No PKCE support — PKCE-mandating OAuth providers cannot be registered | `packages/login/src/oauthProviders.ts` | pkg-login |
| MIS-011 | medium | No first-class 2FA support — veto hooks cannot express a challenge round-trip | `packages/login/src/hookPayloads.ts` | pkg-login |
| MIS-012 | medium | UserAdapter has no delete() — account deletion forces a Prisma bypass | `packages/login/src/userAdapter.ts` | pkg-login |
| MIS-013 | medium | No presence roster/snapshot query for late joiners | `packages/presence/src/index.ts` | pkg-presence |
| MIS-014 | medium | Presence fan-out is single-instance only | `packages/presence/src/activity/peerNotifier.ts` | pkg-presence |
| MIS-015 | medium | Router process exposes no liveness/readiness endpoint | `packages/router/src/startRouter.ts` | pkg-router |
| MIS-016 | medium | No graceful shutdown: no close(), dev signals hard-exit, no onShutdown hook | `packages/server/src/createServer.ts` | pkg-server |
| MIS-017 | medium | No per-account brute-force protection on credentials login | `packages/server/src/httpRoutes/authApiRoute.ts` | pkg-server |
| MIS-018 | medium | No server-initiated typed sync emit (cron/webhook fan-out) | `packages/sync/src/index.ts` | pkg-sync |
| MIS-019 | medium | No CSRF-enforcement sweep layer in the test runner | `packages/test-runner/src/runAllTests.ts` | pkg-test-runner |
| MIS-020 | medium | Account deletion never removes the user's uploaded avatar file (GDPR residue) | `src/settings/_api/deleteAccount_v1.ts` | consumer-app |
| MIS-021 | medium | publishPackages.mjs has no pre-flight safety checks and no resume | `scripts/publishPackages.mjs` | tooling |
| MIS-022 | low | No --version flag on either CLI (`luckystack` and `create-luckystack-app`) | `packages/cli/src/index.ts`, `packages/create-luckystack-app/src/index.ts` | pkg-cli / pkg-create-app |
| MIS-023 | low | `luckystack remove <feature>` does not exist — add is one-way | `packages/cli/CLAUDE.md` | pkg-cli |
| MIS-024 | low | Offline queue is memory-only — queued requests lost on refresh, no persistence seam | `packages/core/src/offlineQueue.ts` | pkg-core |
| MIS-025 | low | WebSocket upgrades emit no proxy hooks (no socket-traffic observability) | `packages/router/src/wsProxy.ts` | pkg-router |
| MIS-026 | low | No public stop/dispose API for the secret manager outside test helpers | `packages/secret-manager/src/index.ts` | pkg-secret-manager |
| MIS-027 | low | sync CLAUDE.md hook table omits 3 of the 7 dispatched hooks | `packages/sync/CLAUDE.md` | pkg-sync |
| MIS-028 | low | auth.additional metadata carried in ApiMetaEntry but never tested by any sweep | `packages/test-runner/src/types.ts` | pkg-test-runner |

---

### MIS-001 (high) — EmailMessage/SendEmailInput support neither attachments nor custom headers

**File:** `packages/core/src/emailRegistry.ts:16`
**Area:** pkg-email

**Evidence/description:** `EmailMessage` (emailRegistry.ts:16-25) is a closed shape: `to/subject/html/text/from/replyTo/cc/bcc`. No `attachments`, no `headers`. The package's own docs pitch an "order-receipt" template (`packages/email/docs/templates.md:268`) — the canonical attach-a-PDF use case — and Gmail/Yahoo bulk-sender requirements increasingly expect `List-Unsubscribe` headers. Both nodemailer and Resend natively support attachments + headers, so this is purely a framework-type gap. Forking is genuinely required: even if a consumer augments the interface and writes a custom adapter, `sendEmail` rebuilds the message field-by-field (`packages/email/src/sendEmail.ts:114-134`) and silently drops unknown fields, so extra fields never reach any adapter. Verified absent: grep for `attachments|headers` across `packages/email/src` and `core/emailRegistry.ts` has zero hits; no docs mention.

**Why it matters for a consumer:** Receipts, invoices, calendar invites, and deliverability-compliant marketing mail are all blocked from the unified pipeline. The only workaround is bypassing `sendEmail` entirely — losing hooks, registry routing, redacted Sentry capture, and logging.

**Recommendation:** Add optional `attachments?: { filename: string; content: string | Buffer; contentType?: string }[]` and `headers?: Record<string, string>` to `EmailMessage` + `SendEmailInput`, pass them through in `sendEmail`'s message build and both production adapters (nodemailer accepts them as-is; Resend maps `attachments`/`headers` natively). `ConsoleSender` can print attachment names only.

### MIS-002 (high) — No email-verification flow for credentials registration

**File:** `packages/login/src/login.ts:220`
**Area:** pkg-login

**Evidence/description:** `registerWithCredentials` creates the user and immediately auto-logs them in (`postRegister` then `postLogin` at lines 220-242) with no verification of mailbox ownership. Grep for `emailVerified|verifyEmail|email-verification` across `packages/` and `docs/` returns zero hits. The package already owns every primitive needed (one-shot Redis tokens in `passwordReset.ts`/`emailChange.ts`, the lazy email orchestrator pattern, `renderEmailLayout`) — the email-*change* flow even proves new-mailbox ownership — but initial signup never does. `preRegister` can veto but cannot implement a confirm-link round trip.

**Why it matters for a consumer:** A consumer building a real product must hand-roll token mint/consume, a verified flag, and login gating, or accept accounts squatting on addresses they don't own — which also poisons the password-reset flow for the address's true owner.

**Recommendation:** Ship `auth.emailVerification: 'disabled' | 'framework' | 'custom'` mirroring `forgotPassword`: `createEmailVerificationToken`/`consumeEmailVerificationToken` primitives, a `sendVerificationEmail` orchestrator, an `emailVerified` column in the documented User schema + `UserRecord`, a configurable preLogin-level gate (block login vs. badge-only), and a `postEmailVerified` hook.

### MIS-003 (high) — Peers are never told a user actually left: no userLeft/offline event on hard disconnect or grace expiry

**File:** `packages/presence/src/activity/lifecycle.ts:61`
**Area:** pkg-presence

**Evidence/description:** The only peer-facing events are `userAfk` and `userBack` (verified: core `socketEvents.ts:24-25` defines no `userLeft`/`userOffline`; grep across `packages/` found none). `userAfk` is emitted ONLY on the client-initiated `intentionalDisconnect` path (lifecycle.ts:130) and on AFK timeout. For the most common departures — browser close, navigation away, network drop, laptop lid (`transport close`) — `socketDisconnecting` (lifecycle.ts:61-117) emits nothing to peers, and the grace-expiry timeout also emits nothing (`packages/presence/docs/disconnect-grace.md:228` confirms: "the timer cleanup does NOT re-broadcast"). Consumers cannot add this themselves: the timer body has no hook and `informRoomPeers` is not exported.

**Why it matters for a consumer:** Roommates' presence UI shows the departed user as present forever (or as AFK with a long-expired countdown). For a package whose pitch is "see who is present, idle, or temporarily disconnected", the offline transition is missing and unfixable without forking.

**Recommendation:** Add `userLeft: 'userLeft'` to core's `socketEventNames` and emit it via `informRoomPeers({ token, event: userLeft })` inside the grace-expiry timeout BEFORE `removeSession` (session lookup still works there). Optionally also emit `userAfk` with `endTime = now + graceMs` at the start of `socketDisconnecting` so peers see the grace countdown for transport-close disconnects.

### MIS-004 (medium) — check-env / check-i18n always exit 0 — no CI fail mode despite findings

**File:** `packages/cli/src/index.ts:83`
**Area:** pkg-cli

**Evidence/description:** The scan commands run, write dump logs, print counts, and `return` (index.ts:77-86); neither `checkEnv` nor `checkI18n` influences the process exit code. Verified: no `process.exit`/`exitCode` anywhere in `checkEnv.ts` or `checkI18n.ts`; both return void with counts only printed.

**Why it matters for a consumer:** `luckystack check-env` in a CI pipeline or pre-commit hook passes even with 50 missing env definitions or missing translations. For a framework whose pitch is automated, AI-driven hygiene, the audits can only be consumed interactively.

**Recommendation:** Add a `--fail-on-findings` (or `--ci`) flag that sets `process.exitCode = 1` when any scan count > 0 (optionally `--fail-on missing|unused|any` granularity), and have the commands return their counts to the entry so the flag stays in index.ts.

### MIS-005 (medium) — `add login` does no preflight for the scaffold-shaped files its copied handlers require

**File:** `packages/cli/src/commands/addLogin.ts:27`
**Area:** pkg-cli

**Evidence/description:** The copied `_api` handlers hard-depend on project files the CLI neither ships nor verifies: `changePassword_v1.ts` imports `../../../server/hooks/notifications` (asset line 5 — lives only in the create-luckystack-app template, `server/hooks/notifications.ts`), `updatePreferences_v1` writes a `preferences` Prisma field and extended SessionLayout shape, and every page/handler references `login.*`/`settings.*`/`auth.*` locale keys the asset bundle does not include. `addLogin.ts` just calls `copyDirIfAbsent` + `addDependency` with no existence checks — contrast `addPresence.ts:83`, which verifies its two target files before editing. Today every scaffold ships those files (the pruner only prunes presence — `create-luckystack-app/src/index.ts:1030`), so this is latent; but the CLI's documented audience is "a base/partial project", where the copy succeeds and the project then fails to compile with no guidance.

**Why it matters for a consumer:** On a partial project the command appears to succeed, then the build breaks with import/type/locale errors and nothing points back to `add login`. Becomes load-bearing the moment the planned login pruner lands.

**Recommendation:** Preflight like `addPresence`: check `server/hooks/notifications.ts`, `src/_locales/*.json` (and the needed key namespaces), and the Prisma schema field before copying; on a miss, either ship the missing pieces in the asset bundle (notifications.ts + a locale-merge step for `login.*`/`settings.*` keys) or fail with an actionable message listing what to create.

### MIS-006 (medium) — Import-dependency graph cannot follow custom tsconfig path aliases — silent loss of cascade hot reload

**File:** `packages/devkit/src/importDependencyGraph.ts:134`
**Area:** pkg-devkit

**Evidence/description:** `resolveImportToFile` (lines 134-158) resolves only relative specifiers, the literal `config`, `src/`, `@/` (hardcoded to mean srcDir), and `shared/`. Any other tsconfig `paths` alias a consumer defines (e.g. `~lib/*`, `#utils/*`, or multiple aliases) returns null, so edits to modules imported through such aliases never fan out to dependent `_api/`/`_sync/` routes — the route keeps serving the stale module until a manual save of the route file, with only the generic `[HotReload] No API/Sync routes depend on:` log as a clue. Grepped `packages/devkit/docs/` (hot-reload.md, loader-pipeline.md) — the limitation is undocumented and there is no resolver hook.

**Why it matters for a consumer:** A consumer with their own alias convention loses cascade hot reload silently and cannot fix it without forking; the failure mode (stale module served) is a debugging time-sink.

**Recommendation:** Either read the consumer's tsconfig `paths` (`ts.parseJsonConfigFileContent` is already a dependency via tsProgram.ts) and resolve aliases generically, or expose `registerImportResolver((importerPath, specifier) => string | null)` evaluated before the built-ins; at minimum document the supported specifier forms in `docs/hot-reload.md`.

### MIS-007 (medium) — Sync events never rendered despite devkit emitting `syncs` and package CLAUDE.md claiming they appear

**File:** `packages/docs-ui/src/docsHtml.ts:329`
**Area:** pkg-docs-ui

**Evidence/description:** `packages/docs-ui/CLAUDE.md:7` states "Sync events appear alongside APIs when the type-map emitter has produced metadata for them." The emitter DOES produce them — `GeneratedDocsData` has `syncs: Record<string, SyncDocsEntry[]>` (`packages/devkit/src/typeMap/emitterArtifacts.ts:63`) with clientInput/serverOutput/clientOutput/stream shapes, present in the working-tree `src/docs/apiDocs.generated.json`. But the renderer reads only `data.apis` (docsHtml.ts:329 `const apis = data && data.apis ? data.apis : data;`) — grep of the package shows zero references to `syncs`.

**Why it matters for a consumer:** In a socket-FIRST framework, half the route surface (everything under `_sync/`) is invisible in the docs browser, and the CLAUDE.md claim misleads AI consumers into believing it works.

**Recommendation:** Render a second group section per page from `data.syncs` (event name, version, clientInput, serverOutput/clientOutput, stream shapes) — the data is already in the artifact. If deferred past 0.2.0, correct CLAUDE.md line 7 to say sync rendering is not yet implemented.

### MIS-008 (medium) — No flush/shutdown lifecycle for error trackers — buffered events are lost on process exit

**File:** `packages/core/src/errorTrackerRegistry.ts:34`
**Area:** pkg-error-tracking

**Evidence/description:** The `ErrorTracker` contract has no `flush`/`shutdown` member, the registry has no `flushErrorTrackers()`, and the framework dispatches no shutdown hook anywhere (verified: no `preShutdown`/`onShutdown`/`serverShutdown` dispatchHook in `packages/`). posthog-node batches events (default flushAt=20 / flushInterval=10s) — on SIGTERM/redeploy the tail of captured exceptions (often the most interesting ones) is silently dropped, and on the zero-config register path the client isn't even reachable to call `shutdown()` manually; Sentry similarly recommends `Sentry.close(timeout)` before exit. A consumer cannot add this without forking because the auto-registered PostHog client is module-private to `register.ts`. Closely coupled to MIS-016 (graceful shutdown), which would provide the natural call site.

**Why it matters for a consumer:** The errors captured right before a crash or redeploy — the ones you bought error tracking for — never reach the backend.

**Recommendation:** Add optional `flush?(timeoutMs?: number): Promise<void>` to `ErrorTracker`, implement it in the three built-in adapters (Sentry.close, posthog `client.shutdown`, statsd close), expose `flushErrorTrackersAcrossTrackers()`, and call it from the new framework shutdown path proposed in MIS-016.

### MIS-009 (medium) — No client/browser entry for error tracking; package-level client config slots are never consumed

**File:** `packages/error-tracking/src/sentryConfig.ts:17`
**Area:** pkg-error-tracking

**Evidence/description:** The package defines `SentryClientConfig` (tracesSampleRate, replaysSessionSampleRate, replaysOnErrorSampleRate) in its registry, but nothing in the package ever reads `getSentryConfig().client`. The only consumer of client config is the framework repo's hand-rolled `src/_functions/sentry.ts` (~130 lines: @sentry/react init, replay integration, URL-token-scrubbing beforeSend, client-side `initSharedSentry` wiring), which is NOT shipped in the create-luckystack-app template — the template only tells users to "install @sentry/react separately and call Sentry.setUser yourself" (`template/src/_providers/SessionProvider.tsx:51-54`). **Framework and template have DRIFTED**: the framework repo has a working private reference implementation; the template ships nothing. This IS documented as out-of-scope (package CLAUDE.md: "Client-side Sentry should be configured directly in the React entry"), so it is a conscious decision — but the dead `client` config slot makes the gap look supported when it isn't.

**Why it matters for a consumer:** A stranger building a real product needs browser error capture and today must reverse-engineer the framework repo's private file, including the non-obvious client `initSharedSentry` wiring that client-side `tryCatch` capture depends on.

**Recommendation:** Ship a browser-safe `@luckystack/error-tracking/client` subpath exporting `initializeClientSentry()` (reads `VITE_SENTRY_DSN` + the registry's client slots, wires client `initSharedSentry`, includes the URL token-scrubbing beforeSend), with @sentry/react as an optional peer — or, if it stays out of scope for 0.2.0, move the reference implementation into the create-luckystack-app template and delete/clearly mark the unconsumed `SentryClientConfig` registry slots.

### MIS-010 (medium) — No PKCE support — custom OAuth providers that require PKCE cannot be registered

**File:** `packages/login/src/oauthProviders.ts:28`
**Area:** pkg-login

**Evidence/description:** Grep for `pkce|code_challenge|code_verifier` across `packages/` returns zero hits. `FullOAuthProvider` has no PKCE fields, `authApiRoute` builds the authorization URL without `code_challenge`, and `exchangeOAuthToken` (`login.ts:377-424`) has no `code_verifier` seam — and the verifier would need to be stored alongside the Redis state, which `createOAuthState` stores as the literal `'1'`. The registry is genuinely pluggable for classic confidential-client providers, but providers that mandate PKCE (X/Twitter OAuth2, many Okta/Auth0 org policies, anything tracking OAuth 2.1 where PKCE is required for all clients) cannot be integrated even as custom `OAuthProvider` objects.

**Why it matters for a consumer:** This is precisely the "can a stranger register a custom provider without forking" test — and a growing class of providers fails it.

**Recommendation:** Add `usePkce?: boolean` (or `pkce?: 'S256'`) to `FullOAuthProvider`; in `createOAuthState` generate a code_verifier and store it as the Redis state value (replacing the `'1'` sentinel), send `code_challenge`/`S256` on the authorization redirect, and have `consumeOAuthState` return the verifier for `exchangeOAuthToken` to include as `code_verifier`.

### MIS-011 (medium) — No first-class 2FA support — veto hooks cannot express a challenge round-trip

**File:** `packages/login/src/hookPayloads.ts:19`
**Area:** pkg-login

**Evidence/description:** The package CLAUDE.md markets hooking login "for audit, 2FA, notifications", but the hook bus is stop-or-continue only (`redirectResolver.ts:4-7` acknowledges hooks cannot carry values): `preLogin`/`preSessionCreate` can abort a login, yet a real TOTP/WebAuthn flow needs an intermediate "password-verified-awaiting-second-factor" state, a challenge endpoint, and a way to resume session minting afterwards — none of which exists (no half-session primitive, no challenge token, no enrolled-secret storage convention; grep for `totp|2fa|two-factor|webauthn` in `packages/` finds nothing).

**Why it matters for a consumer:** A consumer can block logins pending 2FA but cannot complete one without re-implementing the credentials flow around `loginWithCredentialsCore` and minting sessions manually — and the CLAUDE.md marketing implies otherwise.

**Recommendation:** Provide a pending-auth primitive: `createPendingLoginToken(userId, ttl)` / `completePendingLogin(token)` (one-shot Redis token like pwreset) plus a documented recipe where `preSessionCreate` vetoes with errorCode `auth.2faRequired` and a consumer challenge API calls `completePendingLogin` → `saveSession`. Even without shipping TOTP itself, this unlocks consumer-built 2FA without forking.

### MIS-012 (medium) — UserAdapter has no delete() — account deletion forces a Prisma bypass, breaking custom-adapter consumers

**File:** `packages/login/src/userAdapter.ts:28`
**Area:** pkg-login

**Evidence/description:** The `UserAdapter` contract is `findByEmail / findById / create / update` only. The scaffolded `deleteAccount_v1` therefore calls `functions.db.prisma.user.delete({ where: { id } })` directly (`src/settings/_api/deleteAccount_v1.ts:40`). The adapter exists precisely so "multi-tenant, soft-delete, alternative ORM" consumers (userAdapter.ts header comment) never touch `prisma.user` — but anyone who registers a custom adapter gets a deleteAccount route that throws or deletes from the wrong store, and soft-delete consumers have no seam at all. Related: MIS-020 (the same route also leaves avatar files behind).

**Why it matters for a consumer:** GDPR-grade deletion is a baseline expectation for the no-fork north star; custom-adapter consumers currently get a silently wrong or crashing delete path.

**Recommendation:** Add `delete(id: string): Promise<void>` to `UserAdapter` (implemented in `defaultPrismaUserAdapter` as a Prisma delete), update the scaffolded route to `getUserAdapter().delete(user.id)`, and document soft-delete as "implement delete() as an update({ deletedAt })" in `packages/login/docs/user-adapter.md`.

### MIS-013 (medium) — No presence roster/snapshot query — a newly joined client cannot learn who is currently present or AFK

**File:** `packages/presence/src/index.ts:9`
**Area:** pkg-presence

**Evidence/description:** Presence state is delivered exclusively as deltas (`userAfk`/`userBack` socket events). A client that joins a room mid-session has no way to fetch the current roster ("who is in room X and who of them is idle") — verified by grepping `packages/` and `docs/` for roster/onlineUsers/presenceState/listPresence/getOnline variants (only an unrelated ARCHITECTURE_SYNC.md mention) and reviewing the barrel exports (index.ts) and core's `getJoinedRooms` (own rooms only, `loadSocket.ts:299-317`). The raw ingredients exist server-side (`io.sockets.adapter.rooms`, `lastActivityBySocket`) but `lastActivityBySocket` is module-private, so even a consumer-built `_api` route cannot compute AFK-ness without forking.

**Why it matters for a consumer:** Any late-joiner scenario (the package's stated multiplayer/collab use case) hits this immediately; tracking deltas from page-load only works in apps where everyone joins at the start.

**Recommendation:** Export a server helper `getRoomPresence(roomCode): Promise<Array<{ userId: string, socketId: string, lastActivity: number, afk: boolean }>>` built on the adapter + `lastActivityBySocket` (export a read accessor), and document wiring it into a consumer `_api` route; or ship a framework `getRoomPresence` socket event symmetrical to `getJoinedRooms`.

### MIS-014 (medium) — Presence fan-out is single-instance only: multi-instance deployments lose userAfk/userBack for remote peers

**File:** `packages/presence/src/activity/peerNotifier.ts:40`
**Area:** pkg-presence

**Evidence/description:** `informRoomPeers` walks `io.sockets.adapter.rooms.get(room)` and emits on `io.sockets.sockets.get(socketKey)` (peerNotifier.ts:40-61) — both local-instance views. With the Redis adapter attached (which @luckystack/server always does, `loadSocket.ts:113`), peers connected to OTHER instances silently receive nothing. `packages/presence/docs/peer-notifier.md:182` acknowledges this ("informRoomPeers is local-instance fan-out"), so it is a known documented limitation rather than an undocumented bug — but the framework markets multi-instance as first-class (`docs/ARCHITECTURE_MULTI_INSTANCE.md` describes sync's cross-instance fan-out via fetchSockets), and a consumer cannot fix presence themselves because `informRoomPeers` is intentionally not exported.

**Why it matters for a consumer:** Presence becomes the one package that breaks the moment a second instance is added — directly against the 0.2.0 no-fork north star.

**Recommendation:** Mirror @luckystack/sync's pattern: use `await io.in(room).fetchSockets()` (returns RemoteSocket across instances) for the per-peer dedupe/ignoreSelf loop, or `io.to(room).except(originSocketRooms).emit(...)` for the simple cases. At minimum, surface the limitation in the package README/CLAUDE.md "When NOT to use" list, not only deep in peer-notifier.md.

### MIS-015 (medium) — Router process exposes no liveness/readiness endpoint

**File:** `packages/router/src/startRouter.ts:139`
**Area:** pkg-router

**Evidence/description:** `startRouter` creates the HTTP server with `http.createServer(proxy)` (line 139) where every request goes straight into `createHttpProxy` and is treated as proxiable traffic (a request to `/` yields 400 invalidRequestPath; `/_health` would parse `_health` as a service and 502). @luckystack/server ships `/livez`, `/readyz`, `/_health`, but the router is a SEPARATE process/container with none.

**Why it matters for a consumer:** A consumer deploying the router on k8s/Cloud Run/ECS cannot configure a liveness or readiness probe for the router itself without proxying a request through to a backend — which conflates router health with backend health.

**Recommendation:** Reserve a router-local path (e.g. `deploy.routing.routerHealthPath`, default `/_router/health`) handled before service resolution in `createHttpProxy`/`startRouter`, returning 200 with `{ status: 'ok', env, bootUuid, healthStore: 'redis'|'in-memory' }`. Document it for orchestrator probes.

### MIS-016 (medium) — No graceful shutdown: RunningLuckyStackServer has no close(), dev signals hard-exit, no onShutdown hook

**File:** `packages/server/src/createServer.ts:105`
**Area:** pkg-server

**Evidence/description:** The returned `RunningLuckyStackServer` (`types.ts:94-102`) exposes only `{ httpServer, ioServer, listen }` — no close/stop. In dev, SIGINT/SIGTERM map straight to `process.exit(0)` (createServer.ts:105-106), killing in-flight requests; in production no signal handler exists at all, so a k8s/systemd SIGTERM relies on default termination with no connection draining, no Socket.io `io.close()` (clients get no disconnect frame), no Redis/Prisma disconnect, and no hook for consumer cleanup (flush queues, deregister from LB). Verified absent: no `close|shutdown` logic in `packages/server/src` beyond the two exit handlers, no `onShutdown` in core's HookPayloads, no graceful-shutdown doc in `docs/`. This is also the missing call site for MIS-008 (error-tracker flush).

**Why it matters for a consumer:** Consumers CAN hand-roll using the returned handles — hence medium, not high — but every production deploy needs this, and the framework's promise is a ~20-line `server.ts`.

**Recommendation:** Add `close(opts?: { timeoutMs?: number }): Promise<void>` to `RunningLuckyStackServer`: stop accepting (`httpServer.close`), `io.close()` to notify sockets, await in-flight drain up to timeout, dispatch a new `onShutdown: { reason: 'signal' | 'manual' }` hook, then disconnect Redis/Prisma. Wire SIGTERM/SIGINT to it (prod included) instead of bare `process.exit`.

### MIS-017 (medium) — No per-account brute-force protection on credentials login — only a coarse shared per-IP limit

**File:** `packages/server/src/httpRoutes/authApiRoute.ts:72`
**Area:** pkg-server

**Evidence/description:** The only brute-force defense for `/auth/api/credentials` is `checkRateLimit({ key: 'ip:<ip>:auth:credentials', limit: rateLimiting.defaultApiLimit, ... })` (authApiRoute.ts:70-76). Issues: (1) the limit is the GENERAL api limit — no dedicated auth knob, so tightening login attempts to e.g. 5/min also throttles every API; (2) keyed by IP only — a distributed attacker (or one rotating IPs) gets `defaultApiLimit` fresh attempts per IP against a single account, and conversely one NAT'd office can lock out legit users; (3) setting `defaultApiLimit: false` silently removes ALL login throttling. Verified: `packages/login/src` has no lockout/failed-attempt logic (grep for lockout/failedAttempts/checkRateLimit returns nothing), and no docs mention account lockout. The `preLogin` hook CAN host a hand-rolled lockout, so it is achievable without forking.

**Why it matters for a consumer:** Per-account throttling/lockout is table-stakes auth functionality a stranger expects the framework to own, not something to discover is missing after a credential-stuffing incident.

**Recommendation:** Add `rateLimiting.auth: { perIp: number; perAccount: number; windowMs; lockoutMs? }` and a second `checkRateLimit` keyed `email:<sha256(email)>:auth:credentials` (hashed to keep PII out of Redis keys), counting only FAILED attempts (decrement/skip on success). Dispatch `rateLimitExceeded` with scope `'auth'` + an `accountLocked` hook so consumers can email the user.

### MIS-018 (medium) — No server-initiated typed sync emit — cron jobs/webhooks cannot trigger a sync fanout without impersonating a client

**File:** `packages/sync/src/index.ts:5`
**Area:** pkg-sync

**Evidence/description:** Both entry points require a client context: `handleSyncRequest` needs a live Socket, and `handleHttpSyncRequest` needs a session `token` to pass `auth.login` routes (a background job has none). A consumer building "cron job pushes a daily-summary event into every workspace room" or "incoming webhook fans out an order-update sync" must either hand-roll `getIoInstance().to(room).emit(socketEventNames.sync, {...})` — bypassing the route's `_client` handlers, generated types, `preSyncFanout`/`postSyncFanout` hooks, and the response envelope shape — or fake an HTTP sync request with a stolen/service session. Verified absent: no `emitSync`/`pushSync`/`serverSync`/"server-initiated" export or doc recipe in `packages/sync`, `packages/core` exports, `docs/ARCHITECTURE_SYNC.md`, or the package `docs/` folder.

**Why it matters for a consumer:** Server-originated realtime pushes are bread-and-butter for a realtime framework; today the typed pipeline only works when a browser initiates.

**Recommendation:** Export a server-side `emitServerSync({ name, version, data, receiver, ignoreSelf? })` from `@luckystack/sync` that runs the existing pipeline (skip auth/rate-limit, run `_server` with `user: null` or a configurable system identity, then the normal fanout + `_client` + hooks), and document the cron/webhook recipe in ARCHITECTURE_SYNC.md.

### MIS-019 (medium) — No CSRF-enforcement sweep layer despite the framework shipping CSRF middleware

**File:** `packages/test-runner/src/runAllTests.ts:79`
**Area:** pkg-test-runner

**Evidence/description:** The framework has first-class CSRF protection (`customTests.ts:202-203,278` actively fetches and sends the CSRF token via `getCsrfConfig().headerName` so authenticated tests can PASS the middleware), and the auto-sweep covers `auth.login` and rateLimit enforcement — but no layer asserts the inverse: that an authenticated state-changing request WITHOUT the CSRF header is rejected. Grep for `csrf` across `packages/test-runner/src` shows only token-passing code, never an enforcement assertion; `docs/extension-hooks.md` offers CORS as a hand-rolled custom-layer example but nothing covers CSRF.

**Why it matters for a consumer:** A consumer who accidentally disables or misconfigures the CSRF middleware gets a green `npm run test`. Per-route custom tests can assert it manually, but the sweep is exactly where regression protection belongs.

**Recommendation:** Add a `runCsrfEnforcementTests({ apiMethodMap, apiMetaMap, baseUrl, authToken })` sweep mirroring `runAuthEnforcementTests`: for each `auth.login` POST/PUT/DELETE endpoint, send a valid session Cookie but omit the CSRF header and assert the framework's csrf rejection errorCode; wire into `runAllTests` behind `noCsrf?: boolean`.

### MIS-020 (medium) — Account deletion never removes the user's uploaded avatar file (GDPR residue on disk)

**File:** `src/settings/_api/deleteAccount_v1.ts:40` (ships identically in the create-luckystack-app template and the cli `add login` asset bundle)
**Area:** consumer-app

**Evidence/description:** `deleteAccount` revokes sessions, clears the activeUsers Redis key, and deletes the Prisma user row, but never deletes the avatar file written by updateUser (`${user.id}.webp` under `getUploadsDir()` — see `updateUser_v1.ts:38-40`). Because the route ships in both the template and the cli asset bundle, every consumer's account-deletion flow inherits the gap. Related: MIS-012 (the same route's missing UserAdapter delete seam).

**Why it matters for a consumer:** A GDPR "delete my account" flow leaves the user's face/photo (PII) on the server filesystem indefinitely — a compliance defect the consumer doesn't know they shipped.

**Recommendation:** After the Prisma delete, unlink the avatar: `await import('node:fs/promises').then(fs => fs.unlink(path.join(getUploadsDir(), `${user.id}.webp`)).catch(() => {}));`. Better: expose an `onAccountDelete`/`postAccountDelete` hook and let @luckystack/login own avatar cleanup so consumers don't have to remember it.

### MIS-021 (medium) — publishPackages.mjs has no pre-flight safety checks and no resume — a mid-run failure leaves the registry half-published

**File:** `scripts/publishPackages.mjs:57`
**Area:** tooling

**Evidence/description:** The header (lines 4-7) lists "a clean working tree committed + tagged" as a prerequisite but the script verifies none of it — it will happily publish uncommitted working-tree state to npm. On a mid-wave failure it prints "finish the remaining packages manually if needed" (lines 58-60) and exits; because all 15 packages move in version lockstep (`setPackageVersions.mjs`), a flaky `npm publish` on package 8 of 15 leaves consumers with a registry where `@luckystack/server@0.2.0` exists but its just-bumped peer `@luckystack/sync@0.2.0` does not — exactly the install-time breakage the wave ordering exists to prevent. Re-running from scratch fails on the first already-published package (npm refuses to re-publish).

**Why it matters for a consumer:** For a solo maintainer shipping 0.2.0 this is the highest-likelihood release failure mode, and the blast radius is every consumer running `npm install` during the broken window.

**Recommendation:** Before wave 1: fail if `git status --porcelain` is non-empty (unless `--allow-dirty`). Per package: query `npm view @luckystack/<name>@<version> version` and SKIP if already on the registry, making the script idempotently resumable — re-run after a failure and it completes the remaining set.

### MIS-022 (low) — No --version flag on either CLI (`luckystack` and `create-luckystack-app`)

**File:** `packages/cli/src/index.ts:67` and `packages/create-luckystack-app/src/index.ts:49`
**Area:** pkg-cli / pkg-create-app (merged — same gap reported independently by both area agents)

**Evidence/description:** Two parallel instances of the same missing standard flag:
- **`luckystack` CLI** (`packages/cli/src/index.ts:67`): the entry parses only `add`, `check-env`, `check-i18n`, `-h/--help`; `luckystack --version` falls through to "Unknown command" + exit 2. The package already loads its own version at line 19 (`parsePackageVersion(createRequire(import.meta.url)('../package.json'))`) for dependency ranges, so the data is in hand.
- **`create-luckystack-app`** (`packages/create-luckystack-app/src/index.ts:49`): `VALID_FLAGS` has no `--version`/`-v`; `npx create-luckystack-app --version` exits 2 with "Unknown flag". `readSelfVersion()` already exists for `{{LUCKYSTACK_VERSION}}` substitution.

**Why it matters for a consumer:** Standard CLI expectation for bug reports — and given the asset-drift findings elsewhere in this review, knowing the CLI version is what identifies which asset/template snapshot a consumer received, and which framework version a scaffold is about to pin.

**Recommendation:** In both entries, handle `--version`/`-V` (cli) and `--version`/`-v` (create-app) before command/flag dispatch, printing the already-loaded version and exiting 0. For create-luckystack-app, mirror the `--help` precedence handling and update `docs/cli-flags.md` + `printHelp()`.

### MIS-023 (low) — `luckystack remove <feature>` does not exist — add is one-way (acknowledged-future, confirming for 0.2.0 scoping)

**File:** `packages/cli/CLAUDE.md:24`
**Area:** pkg-cli

**Evidence/description:** A consumer who runs `add presence` and changes their mind must hand-reverse the JSX injections and dependency line; the exact inverse edit lists already exist on both sides (pruner in `create-luckystack-app/src/index.ts:1030-1066`, re-adder in `addPresence.ts`). `packages/cli/CLAUDE.md:24` explicitly defers this ("that is the scaffold pruner's job (a future `luckystack remove`)"), so this is roadmap confirmation rather than an undocumented gap — no audit-doc conflict (`docs/audits/` does not cover it).

**Why it matters for a consumer:** Without it, trying an optional feature carries a manual-reversal cost, discouraging exactly the experimentation the 0.2.0 optional-packages model is meant to enable.

**Recommendation:** When implementing, reuse the pruner's edit lists as the shared single source (export them from a small shared module or a JSON manifest consumed by both packages) so remove/add/prune can never drift — the same mechanism the manifest-driven FEATURES recommendation enables.

### MIS-024 (low) — Offline queue is memory-only — queued requests are lost on page refresh with no persistence option

**File:** `packages/core/src/offlineQueue.ts:32`
**Area:** pkg-core

**Evidence/description:** `apiQueue`/`syncQueue` are plain module-level arrays (lines 32-33). A user who goes offline, performs actions (queued), then refreshes or closes the tab loses every queued request silently — no persistence adapter, no `onQueueDrop` notification hook, and no flush-to-storage seam (verified: no localStorage/sessionStorage/persist reference in offlineQueue.ts or `docs/socket-bootstrap.md`). In-memory is a defensible default; the gap is the absence of any extension seam.

**Why it matters for a consumer:** Given the offline-first pitch (per-item dropPolicy, maxAge config), PWA-style apps will reasonably expect an opt-in survival story; today it requires reimplementing the queue.

**Recommendation:** Add an optional storage adapter knob: `offlineQueue.persistence?: { save(items: SerializedQueueItem[]): void; load(): SerializedQueueItem[] }` (items must be declaratively serializable — store `{name, version, data}` instead of closures for persistable entries), or at minimum a `queueItemDropped` client hook so apps can inform users about lost actions.

### MIS-025 (low) — WebSocket upgrades emit no proxy hooks (no socket-traffic observability)

**File:** `packages/router/src/wsProxy.ts:24`
**Area:** pkg-router

**Evidence/description:** `createWsProxy` dispatches no hooks at all — no preProxyRequest/postProxyResponse and no connect/disconnect equivalent (wsProxy.ts:24-90). Acknowledged as a current limitation in `packages/router/docs/post-proxy-response-hook.md:8`, so it is a known gap rather than a regression.

**Why it matters for a consumer:** A consumer using the router as their edge for a socket-first framework gets ZERO router-level visibility into WebSocket traffic (counts, target, fallback usage, upgrade failures) — exactly the realtime traffic LuckyStack centers on.

**Recommendation:** Add lightweight WS lifecycle hooks (e.g. `preWsUpgrade` / `postWsUpgrade` with `{ service, target, viaFallback, statusCode }`) mirroring the HTTP hook shape so socket traffic is observable; or document the recommended workaround (front-of-router tap) explicitly.

### MIS-026 (low) — No public stop/dispose API — production-usable teardown only exists as resetSecretManagerForTests

**File:** `packages/secret-manager/src/index.ts:421`
**Area:** pkg-secret-manager

**Evidence/description:** The only way to tear down the dev poll timer, debounce timer and fs watchers is `resetSecretManagerForTests()`, which is documented "Test-only" and additionally nukes cachedResolution/pointerMap/activeConfig. Verified: grep for stop/dispose/close/shutdown in the package finds only `watcher.close()` inside the test helper.

**Why it matters for a consumer:** A consumer embedding the resolver in a worker thread, a CLI tool, or a graceful-shutdown sequence (which MIS-016 proposes the framework grow) has no sanctioned `stop` call — they must call a test-only API that also wipes the cache, or rely on unref'd handles.

**Recommendation:** Export `stopSecretManager(): void` that closes watchers and clears timers WITHOUT wiping the resolution cache, and reimplement `resetSecretManagerForTests` as stop + state clear. Mention it in CLAUDE.md's function index.

### MIS-027 (low) — Docs gap: sync package CLAUDE.md hook table omits 3 of the 7 hooks the package dispatches

**File:** `packages/sync/CLAUDE.md:1`
**Area:** pkg-sync

**Evidence/description:** The "Hooks dispatched by the server handler" table lists only preSyncAuthorize, preSyncFanout, postSyncFanout, and rateLimitExceeded. The code also dispatches `postSyncAuthorize` (`handleSyncRequest.ts:383`, observational audit/metrics mirror), `preSyncStream` and `postSyncStream` (`streamEmitters.ts:24-26`, per-chunk with chunkIndex). Exists-but-undocumented, reported as a docs gap per the audit rules.

**Why it matters for a consumer:** CLAUDE.md is the per-package INDEX an AI consumer reads first; three real extension points are effectively invisible, so AI sessions will wrongly conclude streaming/auth-mirror hooks are absent and hand-roll around them.

**Recommendation:** Add postSyncAuthorize, preSyncStream, and postSyncStream rows to the hook table in `packages/sync/CLAUDE.md` (and mirror in `docs/server-vs-client-handlers.md` §10 / streaming.md), then regenerate `docs/AI_QUICK_INDEX.md`.

### MIS-028 (low) — auth.additional metadata is carried in ApiMetaEntry but no layer tests additional auth requirements

**File:** `packages/test-runner/src/types.ts:18`
**Area:** pkg-test-runner

**Evidence/description:** `ApiMetaEntry` declares `auth: { login: boolean; additional?: Record<string, unknown>[] }` (types.ts:18), mirroring the framework's `AuthProps` (`auth: { login: true, additional: [] }` in the canonical API pattern). The auth-enforcement layer only consumes `meta?.auth.login` (`testLayerHelpers.ts:27`) — `additional` (role/permission-style requirements) is parsed into the meta map but never exercised by any sweep. Low because the right assertion requires consumer-specific role semantics the runner cannot infer; per-route custom tests are the current documented escape hatch.

**Why it matters for a consumer:** Endpoints gated on additional claims get no automated enforcement coverage — e.g. nothing proves a logged-in non-admin is rejected from an admin route — while the green sweep implies auth is covered.

**Recommendation:** Document the gap explicitly in `auth-tests.md`, and consider a hook: `additionalAuthProbe?: (endpoint, additional) => { headers, expectedErrorCode } | null` on `RunAuthEnforcementTestsInput` so consumers can supply an under-privileged session per additional-claim shape.
