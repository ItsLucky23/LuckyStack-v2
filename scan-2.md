# LuckyStack v2 — Branch State, Testing Plan Review, and Recommendations

This is a verification + recommendation pass. No code changed.

---

## 1. Where the branch actually stands

### Package split is real and (mostly) complete
13 packages exist under `packages/`, with one of them — `create-luckystack-app` — being the CLI scaffolder, not a runtime package. The real runtime split is 12 packages. Internal dep graph is clean:

```
core ─┬─ login ─┬─ api  ─┐
      ├─ sync ──┼────────┼─→ server (aggregator)
      ├─ presence ───────┘
      ├─ email  (login lazy-loads it for forgot-password)
      ├─ sentry (api/sync wire it via DI shim in core)
      ├─ docs-ui (dev-only)
      ├─ devkit (Tier-B, not for npm — hot reload, type-map, Zod emit)
      └─ router (Tier-B, not for npm — multi-instance + fallback proxy)
test-runner (no internal deps; consumes generated maps)
```

- All **Tier-A packages have READMEs** and build green (per `SESSION_STATE.md`).
- All packages still have `private: true`. Task #25 in your last session — flip 8 tier-A `private: false` and `npm pack` smoke test — is **still open**.
- Runtime smoke test of the migrated `server/server.ts` (now using `createLuckyStackServer`) **has never been run on this branch**. That's the single biggest unverified thing.

### Email package
Production-ready for the basic flow. Three adapters — Resend, SMTP, Console — with `autoSelectEmailSender({ force? })` priority `Resend → SMTP → Console`. Lazy-loads `resend` and `nodemailer` so unused adapters don't ship. Login's forgot-password calls into it dynamically (no hard import), which is what keeps `@luckystack/email` an *optional* peer.

What it lacks: i18n templates, retry/backoff, attachments, batch send. None are blockers for first publish.

### Monitoring package
**Doesn't exist.** What you have today:
- `@luckystack/sentry` — error capture, hook/handler-throw auto-capture, `setSentryUser` on login/logout, performance spans, redacted breadcrumbs.
- `docs/MONITORING.md` — a **strategy spec** for a future `@luckystack/monitoring` package. It outlines hooking `preApiExecute`/`postApiExecute`/`postSyncFanout` to ship correlation-ID'd input/output JSON to OpenSearch, plus Prometheus vitals.

If you thought "monitoring" was implemented, it isn't — only the design is. Sentry covers the "Why" half; the "What" half (audit trail + metrics) is open.

### Services architecture & staging fallback — much further along than I expected
- `services.config.ts` defines `services` + `presets`. ✓
- `deploy.config.ts` defines `resources`, `environments`, `bindings`, `fallback`, `routing`, `development.{enableFallbackRouting, healthPollMs, switchNewTrafficToLocalWhenHealthy}`. ✓
- `scripts/generateServerRequests.ts` actually emits `server/prod/generatedApis.{preset}.ts` — `core-preset.ts`, `fleet-preset.ts`, `finance-preset.ts` are on disk. ✓
- `server/prod/runtimeMaps.ts:65` reads `process.env.LUCKYSTACK_BUNDLE` and `await import('./generatedApis.${bundle}')` — runtime preset selection **is** wired (one earlier agent missed this). ✓
- `packages/router/src/{startRouter,bootHandshake,resolveTarget,healthPoller,redisHealthStore,httpProxy,wsProxy}.ts` — full multi-instance topology. ✓
- Boot UUID handshake + `synchronizedEnvKeys` SHA-256 hash check + Redis-backed cross-router health state are all real and called from `startRouter()`. ✓
- WebSocket fallback is **deliberately** routed to the `system` service by convention (`wsProxy.ts:8-13`) — the Socket.io Redis adapter handles cross-instance room fanout regardless of which backend holds the connection. This is by design, not a gap.

What's still open:
- **Phase 2 function pruning** (per `ARCHITECTURE_PACKAGING.md:781`): preset bundles currently include all functions; import-graph pruning is deferred.
- **`generatedApis.default.ts` was deleted** (per packaging doc §835); production deploys MUST set `LUCKYSTACK_BUNDLE`. Worth a startup assertion if `NODE_ENV=production` and the env var is unset.

### Redis socket.io rooms + sync streaming
- Adapter wired in `packages/core/src/socketRedisAdapter.ts` and attached in `packages/server/src/loadSocket.ts:97`.
- Three stream channels in `packages/sync/src/handleSyncRequest.ts`:
  - `stream(payload)` — direct `socket.emit`, originator-only, doesn't cross instances (correct).
  - `broadcastStream(payload)` — `io.to(room).emit(...)` with solo-room shortcut. Crosses instances via Redis adapter.
  - `streamTo(tokens, payload)` — token rooms + `io.to(filtered).emit(...)`. Crosses instances.
- `createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 })` defaults — flush whichever fires first. The 20ms vs 50ms playground note in TESTING_PLAN.md §4.5 is correct.

This is the part I'd be most confident shipping. The streaming primitives + Redis adapter + room sharing are coherent and the design composes correctly with the staging-fallback router (because WS fan-out is Redis-mediated, not router-mediated).

---

## 2. Verification of TESTING_PLAN.md

The plan covers most of the new surface, but I see real gaps. Marked verdict for each section, then gaps below.

| Section | Verdict | Note |
|---|---|---|
| §0 Pre-flight build + boot | ✓ | Correct first signal. |
| §1.1 `initActivityBroadcaster` typo | ✓ | Right test. |
| §1.2 PROJECT_NAME fallback | ✓ | Right test. |
| §1.3 `create-luckystack-app` no fallback | ✓ | Both positive and negative paths. |
| §1.4 CORS allow-localhost + log gating | ✓ | Covers all four assertions. |
| §1.5 Custom-route error boundary | ✓ | Good. |
| §2.1 `registerLogger` | ✓ | Both no-op and structured paths. |
| §2.2 Hook handler errors visible | ✓ | Good. |
| §2.3 Redacted log keys | ✓ | Defaults + extension. |
| §2.4 Hooks table (apiError/syncError/etc.) | ⚠ | See gap (a). |
| §2.5 bcrypt rounds | ✓ | |
| §2.6 `autoSelectEmailSender` | ✓ | Priority + force. |
| §2.7 Presence config | ✓ | Both timer + ignoreReasons. |
| §2.8 Avatar config | ✓ | |
| §3.1 Forgot-password | ✓ | Includes anti-enumeration. |
| §3.2 Settings APIs | ✓ | Six APIs each have a check. |
| §3.3 OAuth | ✓ | Includes per-provider vs unified. |
| §3.4 Docs UI | ✓ | |
| §3.5 Scaffolder | ✓ | |
| §3.6 Multi-instance router | ⚠ | See gap (b). |
| §4.1 Regression | ✓ | |
| §4.2 Sentry coverage | ✓ | |
| §4.5 Sync streaming | ✓ | Strong section. |
| §4.6 CSRF | ✓ | |
| §4.7 Playground bench | ✓ | |
| §4.8 Dark palette | ✓ | |
| §4.9 Generated emitter types | ✓ | |

### Gaps in TESTING_PLAN.md (what to add)

**a) Hooks table is missing payload assertions.** §2.4 says "confirm payload matches the type defined in `…/hooks/types.ts`" but doesn't tell the tester what fields to verify. Add a column with the actual expected fields per hook (`apiError`: `{ name, version, errorCode, userId? }`, etc.) so a tester can spot a missing field.

**b) §3.6 Multi-instance router is too thin** for what's actually shipped. Missing tests:
- **Boot UUID handshake** — start two backends with different `REDIS_HOST` values → assert router refuses to start with `strictBootHandshake: true`, warns with `false`.
- **`synchronizedEnvKeys` mismatch** — start dev with `COOKIE_SECRET=A` and staging with `COOKIE_SECRET=B` (sharing same Redis) → assert SHA-256 hash compare fails on boot.
- **Health-poll switchover** (`switchNewTrafficToLocalWhenHealthy`) — kill local backend → router proxies to staging within `healthPollMs`. Restart local → new traffic flips back. Existing socket connections stay where they are (this is the dev-mode UX trade-off you described).
- **Per-preset routing** — a `vehicles/getAll` request hits a router fronting a `core-preset` bundle → assert it forwards to fallback's `vehicles` binding (not `system`).
- **Preset bundle selection** — boot the server with `LUCKYSTACK_BUNDLE=fleet-preset` and assert the loaded route map only contains `vehicles/*` routes; `billing/*` returns `serviceNotAssigned`.

**c) §3.5 scaffolder doesn't test the deploy/services config** — after `npm run dev`, walk a freshly scaffolded `services.config.ts` + `deploy.config.ts`. Confirm the scaffolder ships sensible defaults (single-service, no fallback) so beginners don't have to learn the topology system day one.

**d) No test for `streamTo`.** §4.5 calls this out: "currently not wired with a UI button — verify by reading code." That's a code review pass, not a test. Add a button to the playground so it's exercised end-to-end.

**e) No test for the runtime smoke of `createLuckyStackServer`.** Per `SESSION_STATE.md:34`, this has never run. Add §0.5: "Boot, log in, hit one API, fire one sync, confirm `server.ts` is functionally equivalent to the old 700-line bootstrap." This is the single most load-bearing change of the package split.

**f) No tarball test.** §3.5 tests the scaffolder against `dist/`, but you also need: `npm pack` a tier-A package → install the tarball into a fresh test repo → `import { … } from '@luckystack/core'` resolves at runtime AND types resolve. Without this, you'll catch packaging issues only after a real publish.

**g) No `/_test/reset` test for `@luckystack/test-runner`.** The test-runner's four layers (contract, auth-enforcement, rate-limit, fuzz) depend on `/_test/reset` — `f4430b2` added that endpoint. Document a single command (`npm run test:contract` etc.) and confirm each layer green.

**h) No assertion that monitoring is *not* present.** Sounds silly, but worth a note in §5 deferred: `@luckystack/monitoring` isn't built; `docs/MONITORING.md` is the spec. Until built, audit-trail compliance for "boss requirement" (input/output JSON per call) is unmet.

---

## 3. Playground page coverage

It's the main test surface. Coverage is good for streaming, weak elsewhere.

**Covered (10 features):** room join/leave, sync echo, sync stream (originator-only), sync broadcastStream, API stream, `createStreamThrottle` toggle + interval, throttle flush window verification, error-boundary throw, log auto-scroll cap, multi-room support.

**Not covered (worth adding to the playground or to a separate `/test-bench` page):**
- **`streamTo`** — code path exists, no UI.
- **Forgot-password** — login pages, separate from playground.
- **Settings page CRUD** — change password / list sessions / revoke / sign out everywhere / delete / preferences.
- **OAuth providers** — login pages.
- **CSRF auto-attach** — visible only via devtools console examples in §4.6.
- **Custom-route error** — requires editing `server.ts`; playground could expose a dev-only button.
- **Presence broadcast / activity tracker** — visible only as a side effect.
- **Locale switching** — none.
- **Avatar serving** — none.
- **Hooks** — `apiError`, `syncError`, `rateLimitExceeded`, `corsRejected`, `passwordReset*`, `passwordChanged` — all need overlay registration to test.
- **Multi-instance router fallback** — needs separate boot.

Rough estimate: **playground covers ~30–40%** of what TESTING_PLAN.md actually verifies. Streaming and rooms are well-covered; auth/settings/hooks/router/CSRF/avatar are not.

**Recommendation:** consolidate into a `/playground` mega-page with sections for each feature class, behind `dev: true` only. The current single-section playground is too narrow for what the framework now does.

---

## 4. Goals assessment — "minimal but capable, scales small to large"

Your stated goals, mapped to the current state:

| Goal | Status | Notes |
|---|---|---|
| Install minimally for small projects | **Mostly there** | 12 runtime packages with optional peerDeps (resend, nodemailer, sentry, all OAuth provider keys). Small project = `core + login + api + sync + server`. |
| Rich opt-in features | **Yes** | email/sentry/presence/docs-ui/test-runner/router are all opt-in. |
| Build-config services architecture | **Yes** | services.config + presets + per-preset generated route maps + `LUCKYSTACK_BUNDLE` runtime selection. |
| Run different folders on different server bundles | **Yes** | `presets[].services` controls which folders go into which bundle. |
| Share config with staging server | **Yes** | `deploy.config.ts` `bindings` + `fallback`. |
| Run only the services you changed; reroute rest to staging | **Yes** | `enableFallbackRouting` + `switchNewTrafficToLocalWhenHealthy` + service-key resolver. |
| Same cache + DB shared with staging | **Yes** | `resources` + `synchronizedEnvKeys` + boot UUID handshake catch the "two URLs both respond" footgun. |
| Redis socket.io rooms work across instances with sync logic | **Yes** | adapter attached, all streaming paths use `io.to(room).emit`. |
| Streaming over syncs works with above | **Yes** | broadcastStream + streamTo go through the adapter; only originator-only `stream()` stays local (correct). |
| Dev → staging switching, accept transient loss | **Yes** | health poller flips traffic on `healthPollMs` cadence; sockets in flight stay where they are (you noted this is acceptable). |

**The framework is closer to your goals than the testing plan implies.** The outstanding work is mostly **proving** it works, not building it.

---

## 5. Recommendations (ordered by leverage)

**High leverage / do before merging this branch:**

1. **Run the runtime smoke of `createLuckyStackServer`** — `npm run server`, log in, fire one API, fire one sync. Without this, the build-green signal is misleading.
2. **Add the missing TESTING_PLAN sections** I listed (a–h above), specifically the multi-instance router topology tests (§3.6) and the tarball install test.
3. **Add a `LUCKYSTACK_BUNDLE` startup assertion** — in production, refuse to boot if it's unset and `runtimeMaps.ts` would silently load empty maps. Currently it just `console.log`s yellow and serves nothing — a deploy in this state is a 30-minute outage waiting to happen.
4. **Wire the playground to cover `streamTo` and at least the major hooks.** Five new buttons, one afternoon.

**Medium leverage / next PR cycle:**

5. **Build `@luckystack/monitoring` per `MONITORING.md`** — even a Phase-1 audit-trail emitter via `preApiExecute`/`postApiExecute` hooks, writing JSON lines to stdout that an OpenSearch sidecar can pick up. This is the "boss requirement" half of the observability story.
6. **Per-package config split** — moving email/login/presence/sentry config out of core's `projectConfig.ts` is on the deferred list. Worth doing because it lets each package own its config schema and READMEs read cleanly.
7. **`csrfFailed` hook** — listed in §5 deferred; one-line addition.

**Low leverage / when stable:**

8. **Phase 2 function pruning** — only after measurement. Don't optimize until you have a deploy and a metric.
9. **`@luckystack/web-vitals`** — front-end RUM, per `MONITORING.md` §C. Far future.

**Things I'd reconsider:**

- **Two Tier-B packages (`devkit`, `router`) in the monorepo.** This is correct *for now* but means consumers can't `npm install @luckystack/router` for multi-instance deploys. If the goal is "framework people can install," the router should be promoted to Tier-A with a published binary. Otherwise the multi-instance story is "vendor it yourself," which contradicts the framework promise.
- **`server/prod/runtimeMaps.ts` lives in app code, not in `@luckystack/server`.** Means every consumer copies this file. Consider moving the preset-bundle-loader logic into `@luckystack/server` and exposing it via `createLuckyStackServer({ preset: process.env.LUCKYSTACK_BUNDLE })`.
- **Renaming the `sentry` package to `errors` or `error-tracking`** so a future `@luckystack/monitoring` doesn't read as "two competing observability packages." Or alternatively: collapse them into one `@luckystack/observability`.
- **`services.config.ts` + `deploy.config.ts` are root files but are imported via a relative path into `packages/core/src/...Registry.ts`.** This works but means the package can never be tested in isolation. Worth adding a CLI helper `luckystack-validate-deploy` that checks both at build time.

---

## 6. Suggested next move

Given the goal is "verify before publishing," I'd run this order:

1. `npm run build` (already green per session state, just confirm).
2. `npm run server` — runtime smoke for `createLuckyStackServer`. **This is the unblocker.**
3. Walk TESTING_PLAN.md §1 + §2 (1 hour).
4. Walk §4.5 / §4.6 / §4.7 / §4.9 (30 min — playground covers most).
5. Add the new test sections I listed for §3.6 (router) + §0.5 (smoke) + §3.5b (tarball install).
6. Run §3 (the parallel-AI flows you didn't write yourself) — that's where regressions are most likely.
7. Then Task #25 (flip `private: false`, `npm pack`, real install).
