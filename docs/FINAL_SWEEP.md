# FINAL SWEEP — session handoff (cross-device)

> **Branch:** `chore/package-split-prep` · **Date:** 2026-06-02 · **Status:** all framework work done + green; **nothing committed** (solo session — you commit when ready).
>
> This is the single pickup point to continue on another device. It summarizes everything done this session, the working context for a fresh AI session, what's left before npm publish, and a confirmed repo-cleanup TODO (not yet executed).

---

## TL;DR — where things stand

- The framework is **publish-ready** per the existing audit (`docs/PUBLISH_READINESS_AUDIT.md` → **14 GO · 0 BLOCKED**), and everything added this session is green on top of it.
- This session landed the **R1–R5 framework remediation + multi-tenancy doc**, fixed the **client build warnings**, and ran a **publish-readiness audit**.
- All gates green: `tsc -b` 0 · `lint:packages` 0 · `lint` (client+server) 0 · `vitest` **748** · `build:packages` 14/14 · `pack:dry` 14/14 · **live integration sweep 113/0/11** (on port `:81`).
- Remaining before publish = mostly **your developer actions** (secret-manager live test, commit, `npm org create`, publish, manual smoke) + **2 tiny doc-hygiene fixes** + an optional **loose-.md cleanup** (listed below).

---

## 1. What was done this session

### 1a. Framework-first remediation R1–R5 + D-MT
Closed the 5 framework-scope gaps from `sparring/FRAMEWORK_REMEDIATION.md` so the published packages cover webhooks, graded DB clients, multi-tenant Redis keys, real uploads, and single-owner orchestration. **All additive / opt-in — zero behavior change until a consumer opts in. No cast, no new runtime dep, no breaking change.** Full design notes: `docs/HANDOFF-R1-R5.md` (being replaced by this file — see cleanup) and the branch-log entry #49.

| ID | Package | What shipped | New exports |
|---|---|---|---|
| **R2** | core | Keyed client registry (graded creds) | `registerPrismaClient(c, key?)`, `getPrismaClientFor(key?)`, `getPrismaClientKeys()`, `DEFAULT_CLIENT_KEY` (+ Redis mirror), `resetClientsForTests()` |
| **R3** | core | `registerRedisKeyFormatter` + `formatKey` authority + proxy net | `formatKey`, `registerRedisKeyFormatter`, `getRedisKeyFormatter`, `applyStrayKeyPrefix`, `defaultRedisKeyFormatter`, `RedisKeyFormatter` |
| **R5** | core | Redis lease primitive | `acquireLease`, `renewLease`, `releaseLease` |
| **R1+R4** | server | Pre-params webhook/upload seam + origin-exempt registry | `registerCustomRoute(h, {phase})`, `getPreParamsCustomRoutes`, `registerOriginExemptPath`, `getOriginExemptPaths`, `isOriginExemptPath`, `CustomRoutePhase` |
| **D-MT** | docs | Multi-tenant pattern doc | `docs/ARCHITECTURE_MULTI_TENANCY.md` |

Key design decisions (verified against source, not guessed):
- **R1 ≡ R4 are the same seam.** `getParams` drains the POST body before custom routes run, and the framework already had a PRE_PARAMS dispatch phase. One mechanism (a pre-params raw-`req` custom route) serves both webhook HMAC and streaming uploads past the 1 MiB cap.
- **R3 = formatKey authority + light proxy net** (NOT a full transparent proxy — that was verified fragile: keys sit at non-arg0 positions in `scan`/`eval`/variadic-`del`/`multi`, and a static proxy carries no tenant context). The **default formatter reproduces the historical key bytes exactly → ZERO migration**; the proxy net only prefixes genuinely un-namespaced (colon-free) stray app keys, so every framework key + `bootUuid` is untouched. The 9 key-sites (session, sessionAdapter, passwordReset, emailChange, login oauth-state, rateLimiter, testReset) now route through `formatKey`.
- **R1 security model** (`docs/ARCHITECTURE_HTTP.md`): origin exemption ≠ authentication — the handler MUST verify a signature/secret. Fail-closed/empty by default. Worked examples: GitLab HMAC webhook + streaming audio upload.

New tests this session (+37): `clients.test.ts` (10), `redisKeyFormatter.test.ts` (9), `lease.test.ts` (8), `originExemptRegistry.test.ts` (5), + phase block in `customRoutesRegistry.test.ts` (5). `session.test.ts` mock updated for `formatKey`. New docs: `ARCHITECTURE_HTTP.md`, `ARCHITECTURE_MULTI_TENANCY.md`. Updated: `packages/{core,server}/CLAUDE.md`, root `CLAUDE.md` docs table.

**Live sweep proved it end-to-end** (113/0/11): `credentials login success` + all auth/rate-limit/session/contract routes pass with the new `formatKey` indirection — byte-preservation holds, origin/CSRF still fail-closed, zero regression.

### 1b. Client build warnings cleaned
- `vite.config.ts`: replaced the deprecated `vite-tsconfig-paths` plugin with Vite 8's native `resolve.tsconfigPaths: true` (build verified: 488 modules, all `@luckystack/*`/`config`/`src/*` paths resolve). The `vite-tsconfig-paths` devDependency is now **unused** (`npm uninstall vite-tsconfig-paths` optional).
- `src/main.tsx`: vconsole switched from a static import to a **lazy dynamic import** behind the `mobileConsole` toggle (top-level await). It now lands in its own chunk (~281 kB) instead of the main bundle — only downloaded when the toggle is on.
- Remaining build warnings are harmless: the `[EVAL]` warning is vconsole's own minified code (trusted); the >500 kB chunk is the **main app bundle** (1.2 MB / 355 kB gzip), not vconsole — optional future work (route code-splitting or `build.chunkSizeWarningLimit`).

### 1c. Publish-readiness audit (this session)
Three read-only agents + manual verification against `docs/PUBLISH_READINESS_AUDIT.md` (the prior 14-GO audit). Conclusion: **genuinely almost ready.** Only two small framework-side doc-hygiene items found (see §2), and I explicitly rejected three risky agent suggestions:
- **Do NOT blanket `"sideEffects": false`** — several packages register on module-load (`projectConfig`, `rateLimiter` cleanup, `redis.ts`/`db.ts` resolvers); blanket-false would let bundlers tree-shake needed side-effect imports away. The missing field is a safe default.
- **Do NOT mark devkit (`typescript`/`zod`) or router (`ioredis`) peers optional** — the master audit passed them (G6=P); those peers are genuinely required.
- **Versions:** all 14 at `0.1.0` is correct for a first publish (lockstep release).

---

## 2. What's left before publish

### Your developer actions (runtime / registry / interactive — not automatable here)
1. **Secret-manager "met" + rotation live test** — secret server on `localhost:4000`, secrets `TEST_V1..TEST_V5`. Set `LUCKYSTACK_SECRET_MANAGER_URL` + `.secret-manager-token` + a pointer `MY_SECRET=TEST_V1` in `.env`, restart, confirm `process.env.MY_SECRET` resolves; bump a server-side version and confirm it updates within ~30s **without restart** (the dev poll). *(Only the URL-unset "zonder" path is live-verified so far.)*
2. **Commit** the session (everything is uncommitted on `chore/package-split-prep`).
3. **`npm org create luckystack`** → **publish** the 14 packages in build-wave order (core → wave-2 → error-tracking → api/sync/presence → server; graph is acyclic). `publishConfig.access: public` is already set on all.
4. **Manual smoke** (no automated coverage): OAuth e2e against real Azure AD (`microsoftProvider`), SMTP delivery, `npx create-luckystack-app` scaffold smoke, devkit template injection. Full checklist: `docs/PUBLISH_READINESS_AUDIT.md` §6.

### Two small framework-side doc-hygiene fixes (I can do these next session — not done yet)
1. **Stale `packages/env-resolver/dist/`** — leftover from the env-resolver→secret-manager rename (no `package.json`/`src`/CLAUDE.md, so it doesn't publish). But `scripts/generateAiIndex.mjs` scans `packages/*` and counts it → a phantom "15th package" + skip-warning in the shipped `docs/AI_QUICK_INDEX.md`. Fix: remove `packages/env-resolver/`, then `npm run ai:index` → clean 14-package index.
2. **4 dangling `-> docs/sending.md` links** in `packages/email/CLAUDE.md` (rows 28/38/39/40). That file doesn't exist; real docs are `adapters.md`/`templates.md`/`hooks.md`/`error-handling.md`/`password-reset-integration.md`. Fix: repoint the 4 links (sender/config → `adapters.md`).

---

## 3. Repo cleanup — confirmed TODO (NOT executed this turn)

You confirmed removing these **loose/random** session `.md` files. **All folders stay — especially `handoff/` (do NOT delete).** Run when ready:

**Remove (6):**
- `SESSION_STATE.md` (root)
- `TESTING_PLAN.md` (root)
- `docs/HANDOFF-R1-R5.md` (superseded by this file)
- `docs/_archive/MIGRATION_HOOK_BASED_ERROR_TRACKING.md`
- `docs/_archive/PROJECT_CONTEXT.md`
- `docs/_archive/SESSION_STATE_2026-05-20.md`  *(→ `docs/_archive/` becomes empty; remove the dir too)*

**Keep (do NOT touch):** ⛔ `handoff/` (still needed) · `handoffs/2026-06-02/` · `sparring/` · `branch-logs/` · `docs/PUBLISH_READINESS_AUDIT.md` · `docs/STREAMING_RECONSTRUCTION.md` · all `docs/ARCHITECTURE_*.md` + canonical docs · root `README.md`/`CLAUDE.md`/`CONTRIBUTING.md` · all `packages/**`.

---

## 4. Session context (for the next AI session)

The working arc this session, so a fresh session has the mental model:
- Started from a handoff review, then the user drove a **full pre-publish backlog (WS1–WS6)** + `@luckystack/secret-manager` boot wiring (fail-OPEN when the package/URL is absent — a deliberate exception to the peer-dep-guard policy; see memory `feedback_secret_manager_failopen`).
- Then the **R1–R5 + D-MT** framework remediation (this session's main work), chosen as "all 5 before publish." Mid-flight, two user decisions reshaped it: R1/R4 merged into one seam; R3 switched from "full transparent proxy" to "formatKey authority + light net" after I verified the full proxy was fragile and reported it back (the user agreed).
- Then **build-warning cleanup** (vite native paths + vconsole lazy), then a **publish-readiness audit**, then this handoff.
- **Working style that worked for the user:** surface contradictions instead of silently picking (the R3 fragility finding); tight decomposed effort estimates; keep responses short; everything stays uncommitted (solo project, user commits at the end); ask before destructive deletes.

### Environment & gotchas
- **Port `:81`** — a second project (`C:\youcomm\matchrix`) holds `:80`. Always run the live sweep with `TEST_BASE_URL=http://localhost:81 npm run test`.
- **Dev resolution:** `tsx server/server.ts` resolves `@luckystack/*` → `packages/*/src` via `tsconfig.server.json` paths. The supervisor does **not** restart on `packages/*/src` changes — restart the `:81` server manually to pick up framework-package edits before a live sweep.
- **Nothing committed.** Whole session sits unstaged on `chore/package-split-prep` (plus an earlier secret-manager pile from a prior session). `npm install` still needed before a clean publish (refreshes the stale `@luckystack/env-resolver` symlink + lockfile).

### Key pointers
- Publish audit + developer checklist: `docs/PUBLISH_READINESS_AUDIT.md` (§6).
- Branch progress: `branch-logs/chore--package-split-prep.md` (entries #1–#50; R1–R5 is #49, build polish #50).
- Workspaces (next project, post-publish): `sparring/` + `handoff/`.
- New framework surfaces this session: `docs/ARCHITECTURE_HTTP.md`, `docs/ARCHITECTURE_MULTI_TENANCY.md`.
