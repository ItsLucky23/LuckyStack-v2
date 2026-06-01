# Testing Phase — Pickup Checklist

> Created 2026-05-29 after commit `7576c88` (package split prep + framework hardening + email change).
> This is the **next-session pickup doc** — everything below was implemented across the previous sessions but never end-to-end smoke-tested. Work through this top-to-bottom.

## How to use

- Each section has: **Setup**, numbered **Steps**, explicit **Pass criteria**, **Pri** (P0/P1/P2), **Est** time.
- Mark items `[x]` as they pass. Add notes inline if something fails.
- **Run order**: P0 first (blocks publish), then P1 (functional gaps), then P2 (nice-to-have).
- Most items need `npm run server` running in a separate terminal — open one and keep it warm.

## Pre-flight (run once, before anything)

- [ ] `npm install` clean (no peer-dep warnings of concern)
- [ ] `npm run build` exit 0 — 14/14 packages green
- [ ] `npm run lint && npm run lint:packages` — 0 errors / 0 warnings
- [ ] `npm run server` starts cleanly; visit `http://localhost:<port>/` — page loads
- [ ] Browser DevTools console: no red errors on first paint
- [ ] Sockets connect (network tab: `socket.io` HTTP 101 upgrade)

---

# P0 — Blocking the publish

## P0-1. Email-change confirmation flow (NEVER smoke-tested)

**Setup**: dev server running, logged in as a test user, console-email-sender wired (default in dev).
**Est**: 20 min.

1. Navigate to `/settings`.
2. Field "Email" should now be **editable** (not disabled). Type a different email address. Click "Send confirmation".
3. Expect toast: `settings.emailChange.checkInbox` ("Check your inbox..." or localized equivalent).
4. Switch to the terminal running `npm run server`. The console-email-sender prints the rendered email body — find the `/settings/confirm-email?token=...` URL.
5. Open that URL in the browser.
6. Expect page `src/settings/confirm-email/page.tsx` — title says "Confirming...", then "Email updated" within ~1s.
7. Expect: all sessions revoked → after ~3s auto-redirect to `/login`.
8. Log in with the **new** email + the same password. Expect success.
9. **Re-use the same token** by navigating to the URL again. Expect `auth.invalidToken` error page (one-shot consume).
10. **Request to an already-taken email**: log back in, settings, enter an existing user's email. Expect API response `auth.emailTaken`.
11. **Same-as-current email**: enter the current email. Expect `auth.emailSameAsCurrent` or similar.
12. **Invalid email format**: enter `not-an-email`. Expect `auth.invalidEmail`.

**Pass criteria**:
- Email actually sends in dev (console-email-sender output visible).
- Confirm URL works exactly once.
- Sessions ARE revoked (other browser tabs lose login).
- All 4 error codes return cleanly.

**Files involved**: `src/settings/_api/{requestEmailChange,confirmEmailChange}_v1.ts`, `src/settings/confirm-email/page.tsx`, `packages/login/src/emailChange.ts`, `packages/login/src/emailChangeNotification.ts`.

---

## P0-2. Auth flows end-to-end

**Setup**: fresh dev DB (or run `npm run prisma:migrate:reset`), dev server.
**Est**: 30 min.

1. **Register**: `/register` with email + password. Expect account created + auto-login.
2. **Logout**: `/settings` → logout. Expect redirect to `/login`.
3. **Login**: same credentials. Expect dashboard.
4. **Forgot password**: `/login` → "forgot password" → enter email. Find reset URL in dev console-email. Visit, set new password. Login with new password.
5. **Change password (logged in)**: `/settings` → change password section. Enter old + new. Expect success.
6. **Sign out everywhere**: log in same user in 2 browsers (or browser + incognito). In one, `/settings` → "sign out everywhere". Expect the OTHER browser to lose its session within seconds (Redis-driven, may take up to 5s).
7. **Delete account**: `/settings` → delete account → confirm. Expect account gone, redirect to `/login`. Try logging in → expect failure.

**Pass criteria**: every flow lands the documented response shape; no 500s; Sentry breadcrumbs (if `@luckystack/sentry` enabled) capture only intended errors.

---

## P0-3. Test-runner sweep (npm run test)

**Setup**: dev server running on its declared port. **Important**: the sweep uses `/_test/reset` which requires `NODE_ENV !== 'production'`.
**Est**: 15 min (auto-runs).

1. `npm run test` — should walk every endpoint and run 5 layers (contract, auth, rate-limit, fuzz, custom).
2. Expect summary: `passed / failed / skipped` per layer.

**Pass criteria**: 0 failed across all 5 layers (skipped is fine — many endpoints opt out of rate-limit).
**If any layer fails**: check `branch-logs/TODO.md` for known carve-outs first; if not listed, file a finding.

**Currently untested layers**:
- The auto-sweep DOES walk `apiMethodMap` but the **sync map** is not yet auto-swept (carry-over from earlier; per `packages/test-runner/CLAUDE.md` "When to NOT suggest yet" section).
- Layer 5 (`runCustomTests`) covers sync per-route files via `<name>_server_v<N>.tests.ts` — verify the 3 new playground stream tests pass.

---

## P0-4. Stream tests + second-socket harness

**Setup**: dev server, `npm run test` accepts the new layer.
**Est**: 10 min.

1. `npm run test` — find the per-route results for:
   - `src/playground/_sync/streamBroadcast_server_v1.tests.ts`
   - `src/playground/_sync/streamProgress_server_v1.tests.ts`
   - `src/playground/_sync/streamToToken_server_v1.tests.ts`
2. Expected: each test exercises `ctx.watchStream(roomCode)` and asserts:
   - `streamBroadcast`: chunk count >= `tokenCount`; throttle coalesces (fewer frames than `tokenCount`).
   - `streamProgress`: socket B sees zero frames (originator-only isolation).
   - `streamToToken`: socket B with same token sees chunks; different token sees zero.

**Pass criteria**: all 3 files green.

**Known gap**: the playground sync routes don't plumb `abortSignal` from `SyncParams`, so abort assertions are NOT in the tests yet. If we want abort coverage, the routes have to wire `signal` into their emit loop first.

---

## P0-5. Router explicit-port boot crash

**Setup**: any `deploy.config.ts` or runtime config used by `packages/router`.
**Est**: 5 min.

1. Temporarily edit a binding to use `http://api.internal/` (no port).
2. Start the router (`npm run router` or whatever your local invocation is).
3. Expect: **hard boot crash** with the explicit-port error from `assertBindingsHaveExplicitPorts`.
4. Restore the port (e.g. `http://api.internal:8081/`). Router boots clean.

**Pass criteria**: boot crash fires on port-less URL; clean boot with port.

---

## P0-6. Fresh project install via `create-luckystack-app`

**Setup**: a sibling directory (NOT inside `LuckyStack-v2`), e.g. `C:\youcomm\luckystack-smoke-test`.
**Est**: 30 min (depends on network).

1. From the sibling dir: run `npx create-luckystack-app smoke-test`. Or, since `@luckystack/*` isn't on npm yet, use the local pack:
   - `cd C:\youcomm\LuckyStack-v2 && npm run pack:dry` — dry-pack all 14 packages.
   - Verify each `.tgz` builds.
2. After scaffold: `cd smoke-test && npm install`.
3. `npm run server` — fresh project boots.
4. Visit the landing page. Confirm the 7 new skills exist under `skills/custom/`.
5. Confirm `.github/workflows/ci.yml` + `.gitlab-ci.yml` are present.
6. Confirm `docs/luckystack/ARCHITECTURE_SECRETS.md` is present.

**Pass criteria**: full scaffold + boot without manual fixes.

**Carry-over check**: previous-session memory `project_npm_scope_registration.md` says `@luckystack` org not yet created on npm. So `npm publish` would fail today — that's a separate step before any external install.

---

# P1 — Functional gaps

## P1-1. CI workflows actually run

**Setup**: push the current branch (or open a PR).
**Est**: 20 min wait.

1. **GitHub**: open a PR. `.github/workflows/ci.yml` should trigger on `pull_request`. Watch the run.
   - Expect: matrix Node 20 + 22 both green: install → generateArtifacts → verify → lint → build → test → e2e skip.
2. **GitLab**: push to GitLab mirror (if one exists). Expect prepare → lint → build → test:sweep + test:e2e (skipped) → deploy (gated).

**Pass criteria**: both run green without manual intervention.
**Likely first-run gotchas**:
- GitHub: `test -s src/docs/apiDocs.generated.json` step — that file's been recently added; confirm it's actually produced by `generateArtifacts` (read `scripts/generateTypeMaps.ts` if missing).
- GitLab: the existing pipeline already used the same artifact assertion, so this should be fine.

---

## P1-2. Hot reload edges

**Setup**: dev server running.
**Est**: 20 min.

1. **Edit an `_api/<name>_v1.ts`**: change response body. Confirm hot reload picks it up; the next API call returns new data without a manual restart.
2. **Edit a `page.tsx`**: change visible text. Confirm Vite HMR reflects it in the browser.
3. **Edit `config.ts`**: change a `ProjectConfig` value. **Restart required** — verify the supervisor flags this rather than silently using the old value.
4. **Edit `.env`**: change a value. Currently `process.env` is snapshot at boot, so restart required. Verify the supervisor surfaces this (or document it as a known limitation; a future `@luckystack/secrets` package will solve it).
5. **Add a new `_api/<page>/<name>_v1.ts`**: confirm the loader picks it up and the route is callable without restart.

**Pass criteria**: 1, 2, 5 hot-reload cleanly. 3, 4 either restart cleanly or are flagged.

---

## P1-3. Database adapter coverage

**Setup**: requires switching `prisma/schema.prisma` `provider` + a target DB.
**Est**: 45 min per adapter.

LuckyStack claims support for MongoDB, MySQL, PostgreSQL, SQLite (per `docs/PACKAGE_OVERVIEW.md` / Project Snapshot in CLAUDE.md). **Only ONE is realistically used in dev today.** This is an audit, not a full test:

1. Identify the adapter currently used (check `.env.local`, NOT `.env.local` directly — ask user). Most likely PostgreSQL.
2. Walk through `packages/core/src/db.ts` and any adapter-conditional code. Note which functions have `if (provider === 'mongodb')` branches.
3. For each non-current adapter: at least confirm the connection-string parsing handles it.

**Pass criteria**: no adapter-specific branch fails to compile. Real cross-adapter testing is a separate effort.

---

## P1-4. Redis fallback / outage

**Setup**: dev server + a way to kill Redis temporarily.
**Est**: 20 min.

1. With Redis up: log in, request a password reset. Token stored in Redis. Click link. Confirmation works.
2. Kill Redis (`redis-cli shutdown` or stop the process).
3. Try to log in (sessions live in Redis). Expect a graceful failure mode (specific error, not a 500).
4. Try API calls that don't touch Redis. They should still work.
5. Restart Redis. Confirm session-based flows recover.

**Pass criteria**: server doesn't crash, errors are typed, logs are clear about Redis being down.
**Known concern**: per memory `feedback_peer_dep_guard_policy.md`, env keys set without the peer-dep installed should hard-crash. Redis unreachable at runtime is a different case — should NOT hard-crash, should degrade.

---

## P1-5. Sentry capture works

**Setup**: configure `@luckystack/sentry` with a real DSN (use a test project on Sentry).
**Est**: 15 min.

1. Trigger an intentional error in an `_api/*_v1.ts` — `throw new Error('test capture')`.
2. Call the route from the client.
3. Within ~1 min, find the event in your Sentry test project.
4. Verify breadcrumbs include: socket ID, session user ID (if logged in), route name.

**Pass criteria**: error captured; breadcrumbs useful; no sensitive data (passwords, tokens) leaked.

---

## P1-6. Layer-by-layer smoke of the test-runner CLI

**Setup**: dev server.
**Est**: 15 min.

Each layer is independently invokable. Verify each works in isolation:

1. `npm run test:contract` — contract layer only.
2. `npm run test:auth` — auth-enforcement only.
3. `npm run test:rate-limit` — rate-limit only.
4. `npm run test:fuzz` — fuzz only.

**Pass criteria**: each exits 0, prints its own summary.

---

# P2 — Audits + nice-to-have

## P2-1. Run the 7 new skills end-to-end

**Setup**: dev server (for some), built `dist/` (for others), and the prereq tools installed per each skill's `## Prerequisites` section.
**Est**: 15-30 min per skill.

For each, invoke as a skill and verify the output is useful:

1. **`/ideas`** — should produce a categorized list with 30min/half-day/multi-day buckets.
2. **`/lighthouse`** — needs `npx lighthouse` and `rollup-plugin-visualizer` set up. Should suggest specific `React.lazy()` candidates with file:line refs. Critical: the index bundle is currently 971 kB (warning from Vite); this skill's first concrete target.
3. **`/agent-browser`** — requires `npm i -D @vercel-labs/agent-browser`. Generates `e2e/<route>.test.ts`. Run `npm run test:e2e`.
4. **`/security-audit`** — needs `gitleaks` (optional). Run, review findings.
5. **`/a11y-audit`** — requires `@axe-core/cli`. Per-route WCAG report.
6. **`/upgrade-deps`** — semver-aware updater. Tries patch+minor, runs full test between bumps.
7. **`/perf-budget`** — baseline + diff against `perf-budget.json`.

**Pass criteria for each**: skill produces actionable output, no AI-fabricated content (file paths real, line numbers match code).

---

## P2-2. Documentation accuracy audit (code vs docs)

**Setup**: side-by-side reading.
**Est**: 60 min.

Walk the architecture docs and verify they match the code:

| Doc | Verify against |
|---|---|
| `docs/ARCHITECTURE_API.md` | `packages/api/src/handleApiRequest.ts` + `packages/api/src/handleHttpApiRequest.ts` |
| `docs/ARCHITECTURE_SYNC.md` | `packages/sync/src/` |
| `docs/ARCHITECTURE_AUTH.md` | `packages/login/src/` |
| `docs/ARCHITECTURE_SESSION.md` | `packages/core/src/session.ts` (or wherever it lives now) |
| `docs/ARCHITECTURE_FUNCTION_INJECTION.md` | `shared/*.ts` + how `functions.*` arrives in handlers |
| `docs/ARCHITECTURE_PACKAGING.md` | `packages/*/package.json` + 14-package matrix |
| `docs/ARCHITECTURE_SECRETS.md` | **N/A — design only, package not built yet** |
| `docs/ARCHITECTURE_ROUTING.md` | `packages/devkit/src/loader/` |
| `docs/ARCHITECTURE_SOCKET.md` | `packages/server/src/*Socket*.ts` |
| `docs/ARCHITECTURE_EMAIL.md` | `packages/email/src/` |
| `docs/ARCHITECTURE_EXTENSION_POINTS.md` | All `*Registry.ts` files in `packages/core/src/` |
| `docs/HOSTING.md` | `.gitlab-ci.yml` deploy stages |
| `docs/AGENT_TEAM_PLAYBOOK.md` | CLAUDE.md Rule 23 (already aligned this session) |

**Pass criteria**: every code example in every doc compiles + runs. Function signatures cited in docs match exports.
**When you find drift**: per CLAUDE.md "Verify Code Flow Against Docs" rule — flag it; the user decides whether to fix doc or code.

---

## P2-3. Per-package `CLAUDE.md` function index accuracy

**Setup**: 14 packages × walk export vs index table.
**Est**: 30 min total.

For each `packages/<name>/CLAUDE.md`:
1. Read the `## Function Index` table.
2. Run `git grep "^export " packages/<name>/src/` to list actual exports.
3. Diff: anything in source not in table = missing row; anything in table not in source = stale row.

**Pass criteria**: every public export from `packages/<name>/src/index.ts` has a row.

---

## P2-4. Memory file accuracy + relevance

**Setup**: read `C:\Users\MathijsYouComm\.claude\projects\C--youcomm-LuckyStack-v2\memory\MEMORY.md` + each linked memory file.
**Est**: 15 min.

For each memory entry, verify:
- The fact is still true (e.g. "npm scope not yet registered" — has it been now?).
- The "Why" still applies.
- The "How to apply" still makes sense given the current codebase.

**Pass criteria**: prune outdated entries; update wording on entries that need refining.

---

## P2-5. Bundle size + chunk split (informational)

**Setup**: built `dist/`.
**Est**: 10 min.

1. Current build prints `(!) Some chunks are larger than 500 kB after minification` — `assets/index-*.js` is 971 kB (gzip 274 kB).
2. Run `/lighthouse` skill against the running server.
3. Run `/perf-budget` to capture a baseline.

**Pass criteria**: baseline written. Lighthouse score recorded. Defer the actual split to a separate session.

---

## P2-6. Repository hygiene (committed artifacts to review)

These files were swept into commit `7576c88` — review whether they belong:

| File | Smell |
|---|---|
| `.lint-packages.out` | Lint output capture, probably ad-hoc debugging artifact |
| `.lint-unnecessary.out` | Same |
| `.ts-errors.out` | TS error capture, ad-hoc artifact |
| `SESSION_STATE.md` | Repo root .md (violates CLAUDE.md Rule 10) |
| `tsconfig.shared.json.backup` | Backup file, should be deleted or `.gitignore`d |

**Decide per file**: keep + document, or delete + add to `.gitignore`.

---

## P2-7. Hooks system smoke

**Setup**: dev server.
**Est**: 20 min.

1. Verify the 3 new email-change hooks fire when expected:
   - `preEmailChange` (vetoable) — fire from a test consumer plugin.
   - `postEmailChangeRequested` (observational) — fires when email sent.
   - `postEmailChanged` (observational) — fires after DB update.
2. Test that a `preEmailChange` veto rejects the request.

**Pass criteria**: hooks fire in the documented order; veto works.

---

# Items explicitly deferred (do NOT pick up here)

- **`@luckystack/secrets` implementation** — design doc only at `docs/ARCHITECTURE_SECRETS.md`. The package + separate `luckystack-secrets-server` repo are future work.
- **Mailpit/Docker SMTP smoke** — explicitly dropped this session as overkill.
- **Stream `signal.abort()` assertions** — the playground sync routes don't currently plumb `abortSignal`. Wire that into 1 playground route first, then add the assertion.
- **`/api-docs` skill (OpenAPI emitter)** — swapped for `/upgrade-deps` this session. Revisit when a project actually exposes a public API.
- **`bun:server` / Bun compatibility** — `package.json` has `bun:check` + `bun:server` scripts; verify these still work as a separate effort.

---

# Open questions to confirm with user during testing

1. **npm scope `@luckystack`** — confirm whether the org has been registered yet (memory entry `project_npm_scope_registration.md` says no as of last check). Blocks P0-6 actual publish.
2. **Sentry test DSN** — for P1-5, do you have a test project DSN handy?
3. **GitLab mirror** — for P1-1, is there a GitLab remote configured, or is GitHub only?
4. **Repo hygiene files (P2-6)** — keep `.lint-packages.out` etc. or sweep?

---

# When this checklist is done

1. Update `branch-logs/INDEX.md` row for `chore/package-split-prep`: bump `Last updated` + entry count + flip Status to `merged YYYY-MM-DD` if branch lands.
2. Delete this file OR move its remaining open items into `branch-logs/TODO.md`.
3. Capture lessons-learned in a memory entry if any of these revealed a class-of-bugs we should guard against in future sessions.
