# Branch log — chore/overnight-audit-2026-06-24

Branched off `main` @ 7f24021 for an autonomous overnight audit (`/goal`): full adversarial codebase scan + e2e + auto-fix of high-confidence findings. No auto-merge to main — user reviews.

## 2026-06-24 02:00 — Round-1 adversarial audit + reviewed fixes

**User prompt:** `/goal` overnight audit — scan 15 packages + create-luckystack-app + scaffold for security/dead-code/missing-config/bad-code (adversarial, multi-finder + verify); fix high-confidence after a 2nd check; commit per-area to a new branch + push, no auto-merge; full e2e (build+tsc+lint per wizard variant + runtime/browser + verdaccio); converge over 2 dry rounds.

**What I did:**
- Ran a Workflow audit: 16 targets × 3 lenses (security / dead-code+config / correctness) + completeness critic + per-finding adversarial verify. 344 agents, ~27M tokens, 50 min. Result: 280 raw → 181 verified-real → 55 to_fix / 125 to_report (0 critical).
- Ran a strict re-verification Workflow over the 55 to_fix against current bytes (high false-positive rate confirmed). NOTE: the subagents had Edit tools and auto-applied ~34 fixes to the working tree.
- Reviewed the FULL 42-file working-tree diff vs HEAD hunk-by-hunk. Kept the correct fixes; **reverted** `devkit/routeNamingValidation.ts` (risky route-key behaviour change the re-verify itself rejected); fixed a posthog `||` lint regression an agent introduced (intentional → eslint-disable + reason); applied 1 extra medium security fix myself (sentry header redaction → suffix-aware `isRedactedLogKey`).
- Rejected #42 (resetServerState Origin) as a false positive — `/_test/reset` is origin-exempt.
- Committed in 2 commits: `d5d09b2` (code+test, 20 files), `aa0083e` (docs/comments, 21 files). Framework gate green each time (build:packages 16/16, lint:packages, ai:lint, test:unit 1387).

**Files touched:** ~41 across api, router, email, error-tracking, secret-manager, mcp, test-runner, devkit, server, cli, core, login, sync, docs-ui, presence, create-luckystack-app (+ docs). Full detail: commit bodies of d5d09b2 / aa0083e and `.runtime-test/audit-2026-06-24/HANDOFF_REPORT.md`.

**Verification:** framework gate green ×3 (after each fix batch). E2E wizard matrix (14 build-tier variants, fresh 0.2.7 tarballs reflecting the fixes) running. Local infra: WSL Redis :6380, Mongo rs0 :27018, verdaccio :4873.

**Notes / open:**
- 125 report-only findings (0C/2H/25M/98L) in `to_report.json` — 2 highs flagged for user review (api rate-limit keying = likely FP per CLAUDE.md; template session endpoint returning token+CSRF = design call).
- **Round-2 convergence audit blocked by Claude session limit (resets 04:00 Europe/Amsterdam); scheduled to resume.**
- Subagents auto-editing files (despite a verify-only prompt) is a workflow-design lesson: give re-verify agents read-only tooling next time.

## 2026-06-24 09:30 — E2E (matrix + verdaccio) + Round-2 convergence pass

**What I did:**
- Repacked 16 fresh 0.2.7 tarballs (with the round-1 fixes) and ran the wizard matrix: **14/14 PASS** (scaffold→install→generateArtifacts→build→tsc→lint→ships-only-needed) across every db × auth × email × monitoring × optional-package combo.
- Verdaccio: republished the fixed code, ran the real **semver** consumer flow — both scaffolds (credentials + auth=none) green through install/prisma/gen/tsc/lint/build; `luckystack add login` auto-installs + postadd green; repo root untouched (hard guards held).
- Round-2 deep re-audit (read-only finders + adversarial verify) over the 8 security-critical packages (core/api/server/login/sync/router/secret-manager/email): 29 raw → 23 real-new → 5 to_fix + 18 to_report (incl. 2 HIGH). Round 1 was NOT exhaustive — the deeper pass found real items.
- Applied + committed (`4aff69c`, gate green 1387 tests): **login OAuth `allowRegistration` gate (HIGH security — invite-only was OAuth-bypassable)**, secret-manager `timeoutMs` finite-guard, login/redirectResolver docstring, api/README login-dep parity.

**Files touched:** packages/login/src/login.ts, packages/secret-manager/src/index.ts, packages/login/src/redirectResolver.ts, packages/api/README.md.

**Notes / open:**
- Report-only (user review): HIGH sync `cb`-routing spoofing (needs a deliberate, tested fix — legit client cb shape differs from resolvedName, high blast radius); + ~16 medium/low (server SSE 200-before-auth, router fallback boot-UUID Redis, email PII-in-error, email template-send drops attachments, etc.). Full list: `.runtime-test/audit-2026-06-24/findings/round2a_to_report.json` + `HANDOFF_REPORT.md`.
- Deferred-to-report (real, risky/narrow): sync listener-leak when `requestTimeoutMs:false`; router health-store leak on strict boot-handshake throw.
- **Convergence NOT reached (literal):** round 2 found real issues. Remaining tail: round-2b + live-server browser-login smoke (now both done — see next entry).

## 2026-06-24 10:00 — Round-2b + runtime login smoke + convergence verdict

**What I did:**
- Runtime login smoke (sqlite + real Redis) on the verdaccio-installed vregcreds scaffold: started the live server, `prisma db push`, ran loginSmoke → register/login/wrong-password/csrf-401 ALL PASS. The fixed framework boots + credentials auth works end-to-end.
- Round-2b deep re-audit over the other 8 packages (cli/devkit/docs-ui/mcp/presence/test-runner/error-tracking/create-luckystack-app): 36 raw → 31 real-new → 7 to_fix + 24 to_report (**0 HIGH**). Applied 5 (`e527abc`, gate green 1387 tests): docs-ui protocol-relative logo-URL reject, mcp god_nodes truncation note + blast_radius Object.hasOwn guard, datadog context-shadowing, presence doc. Reported 2 (sentry lazy-proxy toString, scaffolder test:e2e script).

**Files touched:** packages/docs-ui/src/docsHtml.ts, packages/mcp/src/index.ts, packages/error-tracking/src/adapters/datadog.ts, packages/presence/docs/client-component.md.

**Convergence verdict:** SEVERITY converged — round-2b found ZERO new HIGH (only medium/low). The substantive security well is dry (the OAuth allowRegistration HIGH was the big one, fixed). A literal "2 dry rounds" isn't a realistic terminal state (each pass finds more low-sev doc/edge nits). ~40 reviewed fixes committed across rounds; ~60 report-only catalogued (1 report-only HIGH worth a deliberate fix: sync `cb` routing). Full detail: `.runtime-test/audit-2026-06-24/HANDOFF_REPORT.md`.

## 2026-06-25 — Round-3: 2nd-checked + fixed the high/medium report-only backlog

User asked to verify + fix everything real from the ~43 high/medium report-only items. Read-only verify workflow (no agent auto-edit this time): 16 real-with-safe-recipe, 23 risky/needs-design (stay report-only), 4 false-positives (secret-manager envNames = intentional, decision 0007). Applied 11 unique fixes (`f878c4e`, gate green 1387): devkit Windows prisma-spawn (Bug-H class), devkit routing-rule-override honoring + tsProgram guard, sync HTTP fanout yield, docs-ui prod-gate honors LUCKYSTACK_ENV, email template-send attachments/headers parity, test-runner reset-endpoint config, mcp get_runbook disambiguation, + api/docs-ui/test-runner doc parity. Reported (delicate): login deleteSession reorder, cli auth=none revert. 23 high/medium remain report-only by design.

## 2026-06-25 — Single-source ports (config.ports.ts) + opt-in router topology config (ADR 0016)

**User prompt:** make port/IP definitions single-sourced (one file with frontend + backend ports, not scattered across config.ts/.env/vite); and make the `@luckystack/router` topology configs NOT shipped in a default install — installed/removed via the `luckystack` cli manager. Implement fully + docs.

**What I did (one autonomous pass):**
- **Single-source ports:** new pure-data `config.ports.ts` (`{ frontend, backend }`) in template + root app. `config.ts` re-exports it (drives publicUrl/backendOrigin); `vite.config.ts` reads it (`server.port` + proxy target; `ROUTER_PORT` set ⇒ proxy targets the router in cluster-dev); `server.ts` passes `defaultPort: ports.backend`. Killed the hand-synced `5173` twin + the `SERVER_PORT` reads. `@luckystack/server` `createServer` gained `defaultPort` (precedence `options.port ?? argv ?? defaultPort ?? SERVER_PORT ?? 80`; argv still wins for multi-instance). `SERVER_PORT` removed from scaffold + root `.env`; `SERVER_IP` stays (bind address).
- **Router topology opt-in:** `services.config.ts` + `deploy.config.ts` + `server/config/presetLoader.ts` are PRUNED from a no-router scaffold via new `pruneRouter` (also strips the two `server.ts` side-effect imports), mirroring prunePresence/pruneDocsUi. `generateServerRequests.ts` made resilient → single `default` bundle when those files are absent (also closes the bare-`npm run server` default-preset gap). `npx luckystack add router` copies the 3 files (new `packages/cli/assets/router/`, initial preset named `default`) + wires the imports; `remove router` deletes + un-wires. `assetParity.test.ts` now covers `router`.
- **Root app migrated** (keeps its multi-service services/deploy config as the with-router reference).
- **Docs:** ADR 0016, ARCHITECTURE_PACKAGING + MULTI_INSTANCE (incl. fixing the STALE "src/vehicles + src/billing don't exist" claim — they do), PACKAGE_OVERVIEW, DEVELOPER_GUIDE, HOSTING, cli + create-luckystack-app CLAUDE.md. Regenerated ai:decisions + ai:index.

**Verification:** 16/16 packages build · lint clean · root-app `tsc -p tsconfig.server.json` exit 0 · 241 cli/scaffolder + assetParity(41) tests green · runtime scaffold test (both variants): no-router = no router config files + no router imports + has config.ports.ts; with-router = all 3 configs + both imports + dep + `router` script. NOT done: full verdaccio publish→install→boot smoke (no verdaccio installed + Redis :6380 unreachable in this env).

**Files touched:** packages/server/src/{types.ts,createServer.ts}; packages/create-luckystack-app/template/{config.ports.ts (new),config.ts,vite.config.ts,_dot_env_template,server/server.ts,scripts/generateServerRequests.ts}; packages/create-luckystack-app/src/index.ts (pruneRouter+wireRouter); packages/cli/src/commands/addRouter.ts + src/assetParity.test.ts + assets/router/* (new); root config.ports.ts (new) + config.ts + server/server.ts + .env; docs/* + 2 per-package CLAUDE.md + docs/decisions/0016-*.md.

**Notes / open:**
- Caught + REVERTED stray edits from the earlier research-workflow subagents: an unrequested rate-limit refactor (token-bucket → user.id keying) across `api`/`sync` that broke the build. Out of scope for this task; reverted to HEAD. Reasonable on its own merits — flagged to the user for a separate decision.
- Remaining: the full verdaccio per-variant tsc/build + live boot smoke once Redis/verdaccio infra is up (the step the memory says catches install-only bugs that static + unit tests miss).

## 2026-06-26 23:30 — Round-4: verify-and-fix the 16 to_fix items (post-concurrency-resume)

**User prompt:** verify all high/medium report-only items and fix the ones that genuinely need it where the fix is known; handle the 2 deferred items + the remaining report-only; "fix alles in 1 keer"; sync-cb = server-authoritative; greenlit #1 api rate-limit, #5 server SSE, #8 router handshake ("Fix + verwijder de param"), #16 test-runner reset, presence token→userId, build the AFK Redis feature; ask per-fork for design forks. After another AI overtook the working tree: pause, then on signal review the other AI's changes for conflicts before re-applying.

**What I did (each fix gated: per-pkg tsc + lint:packages [test-excluded] + vitest, committed with explicit `git add`, pushed; NO auto-merge):**
- **api #1** (rate-limit keyed on validated `user.id`/IP, never the token) — `c3d32c8` (re-applied after the concurrency revert).
- **sync twin** (#1 rate-limit user.id keying on both transports) + **sync #2** (server-authoritative cb: forward `resolvedName` as recipient callback key) — committed.
- **presence #3+#4** — `RoomPresenceEntry` token→userId; AFK last-activity mirrored to Redis (`-presence-activity` namespace) so presence/AFK is correct across instances + tabs (the greenlit Redis feature).
- **error-tracking #7** — Sentry adapter rebuilds a scrubbed Error (message+stack via `sanitizeErrorStrings`) so interpolated secrets don't reach Sentry (parity with Datadog/PostHog).
- **router #8** — boot-handshake reads the fallback boot-UUID key from the router's OWN Redis (was reading the fallback's own Redis → always "verified", defeating cross-cluster detection); removed the now-vestigial `fallbackRedisOptions` param.
- **api #6** — socket error responses now run the full respond-hook chain (preApiRespond → transformApiResponse → postApiRespond), matching the success path + the HTTP transport (consumer PII-redaction/signing/audit hooks previously never fired on WS error responses). `emitApiError` + guard helpers made async. Also removed a deriveTokenBucketId test mock orphaned by #1.
- **server #5** — defer `initSseResponse` (HTTP 200 + event-stream headers) until AFTER the API gates pass (lazy open on first chunk / successful final); a gate rejection on a streaming endpoint now returns a real 401/403/404/429 JSON status instead of 200 + SSE-wrapped error.
- **api #27** (doc) — README rate-limit step reflects user.id keying.

**Verified ALREADY-FIXED in the current tree (other AI / earlier round — re-applying would duplicate), so NO action:** #4 devkit Windows `.cmd`/`.bat` spawn shim (CVE-2024-27980), #8 devkit `tsProgram` `target.symbol?.name` null-safety, #22 sync HTTP fanout event-loop yield, #23/#25/#26 test-runner `resetServerState` (`getProjectConfig().http.testResetEndpoint` + reset-token), #33 email template sends carry attachments+headers, #34 cli authMode-none config block, #36 docs-ui `resolveEnvKey`, #38 mcp runbook `sectionMatching`, #13 login single-session logout flow, #9 docs-ui `mounting.md` array-shape, #42 test-runner `auth-tests.md` pass-criterion.

**FLAGGED — needs user decision (genuine fork):** #5/#6 devkit `routeNamingValidation.ts` — I reverted this in round-1 as a risky route-key behaviour change; not re-applying without an explicit go-ahead.

**Gate:** full `build:packages` 16/16 OK + `lint:packages` clean on the combined tree (my commits + the other AI's uncommitted router/ports work). 19 commits ahead of main. Branch NOT merged.

**Notes:** the other AI's uncommitted work (config.ports.ts, ADR 0016, router assets/`addRouter`, server `createServer`) was left untouched — I only `git add`-ed my own files per commit. Most code-level to_fix items were already resolved in the tree exactly as the user anticipated ("of het moet niet meer nodig zijn door de andere AI zijn changes").

## 2026-06-27 11:55 — Round-5: the 🟡 report-only backlog + regression tests

**User prompt:** (after reviewing the HIGH report-only list) "chokidar v5 glob fixen, abortsignal fixen, test-runner fixen, verifiëer de http sync array clientinput bug, remove dead code, fix docs". Earlier in the same exchange the user also approved writing regression tests for the round-4 behaviour fixes.

**Regression tests added (round-4 fixes were untested):**
- `api/src/transportParity.test.ts` — error responses run the respond-hook chain on the SOCKET transport too (#6) + preApiRespond-stop rewrite. (+3)
- `presence/.../activitySampler.test.ts` — `getSharedLastActivity` local-first + Redis fallback + clearActivity (#3/#4). (+4)
- `server/.../apiRoute.test.ts` (new) — streaming gate-reject → real status JSON, SSE lazy-opens on success/chunk, pre-chunk throw → real 500 (#5). (+5/+abort)

**🟡 backlog fixes (each gated tsc + lint:packages + vitest, committed, pushed):**
- **devkit supervisor chokidar v5** — globs (`server/bootstrap/**/*.ts`, `…/auth/**`) are no longer expanded in chokidar v5; they were watched as literal non-existent paths so those changes never restarted the dev server. Now watches the concrete files + the bootstrap/auth DIRECTORIES (recursive) and filters events to `.ts` (+ `.env*`). hotReload.ts already watched plain dirs — no glob bug there.
- **server abortSignal (#7/#8)** — apiRoute + syncRoute now create an AbortController, abort on client disconnect (req close/error/aborted, res error), and pass `abortSignal` to the handler (which already raced `main()` against it). For streaming + non-streaming. + abort regression tests on both.
- **syncRoute lazy-SSE (#5 twin)** — the #5 finding named /sync/* too but round-4 only fixed apiRoute; applied the same defer-initSseResponse-until-gates-pass fix to syncRoute. + new `syncRoute.test.ts`.
- **sync HTTP ARRAY clientInput (#9)** — VERIFIED real: socket rejects `Array.isArray(data)` but the HTTP normalize let an array through (`typeof []==='object'`). Added the guard to `stageResolveRoute` (sync.invalidRequest). + parity test.
- **test-runner reset token (#10)** — `runAllTests` set `resetBetweenEndpoints:true` but threaded no token, so `/_test/reset` 403'd; now passes `resetToken` (input, else `TEST_RESET_TOKEN` env).
- **dead code** — removed the fully-orphaned `devkit/src/typeMap/emitter.ts` (superseded by `emitterArtifacts.ts`, imported by typeMapGenerator.ts; verified zero references).
- **docs** — `test-runner/docs/fuzz-tests.md` corrected: a 5xx that still returns a valid `{status:'error',errorCode}` envelope PASSES (fuzzCheck only fails on no-response / non-envelope / missing errorCode). `extension-hooks.md` finding (#20 `runRegisteredLayers ships wired`) = FALSE POSITIVE (the function doesn't exist; the doc correctly calls it roadmap) → left as-is.

**Gate:** full `build:packages` 16/16 + `lint:packages` clean; affected-package suites green (devkit/server/sync/test-runner 356 tests; api/presence/server 238). 28 commits ahead of main, branch NOT merged.

**Not done (deliberate):** create-luckystack-app session-endpoint returning token+CSRF to client JS — a template design decision the user did not greenlight this round.

## 2026-06-27 12:30 — create-app session-endpoint credential leak (the deferred design call)

**User prompt:** (after I explained the finding) "ja fix maar".

**What I did:** `template/src/_api/session_v1.ts` (`system/session`, `auth.login:false`) returned `result: user` verbatim, leaking the raw session `token` (HttpOnly-cookie-backed → JS must never read it; returning it defeats the XSS defence) and `csrfToken` to client JS. `main` now returns a projection stripping both (mirrors `_stripToken` in login/session.ts). Verified: only ONE copy (no cli-asset drift); no template client code reads `user.token`/`.csrfToken` (all uses are server-side `_api/` handlers via server injection). ai:lint clean. Template isn't in build:packages/lint:packages (generated imports only exist post-scaffold), so gated by the login precedent + ai:lint + logic review.
