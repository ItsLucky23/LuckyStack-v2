# Bun runtime + package-manager support — feasibility & env risk — 2026-07-15

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: Bun runtime feasibility across `packages/*`, the scaffold wizard, the CLI manager, and LuckyStack's env-loading + secret-manager pointer pipeline · Tool/agents: 2 read-only investigation agents + Prisma/Bun doc research · Supersedes: —

Last updated: 2026-07-15

**Headline:** the framework runtime is largely Bun-clean already (no `node:cluster`, no `worker_threads`, no native addons in any package; `@luckystack/cli` already detects Bun). The real risk is **not** the runtime — it is **Bun's automatic `.env` loading** silently inverting LuckyStack's env precedence.

⚠️ **All Bun behaviour below is derived from official docs, NOT observed.** Bun is not installed on the dev machine; nothing here has been run under Bun. Items B1-B3 are **hypotheses pending one real Bun boot.**

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| B1 | **`LUCKYSTACK_ENV_FILES` silently activates AND loses under Bun.** `env.ts:22-24` requires it be a real env var, "not a key inside one of the .env files (those are only read AFTER this list is resolved)". Bun preloads `.env`, breaking that premise: `getEnvFiles()` now sees it, but the named first file gets `override: false` (`env.ts:65-75`) so **`.env` beats `.env.staging` on every shared key**. `.env_template:43` ships this key commented **inside `.env`** — the footgun is pre-installed. | HIGH | open | 2026-07-15 | — | Latent core↔CLI split: `cli/src/commands/checkEnv.ts:59-85` already reads it from the file |
| B2 | **`.env.{NODE_ENV}` becomes live but invisible.** Bun loads `.env.production`/`.development`/`.test` between `.env` and `.env.local`. LuckyStack never loads or inspects them, and since `.env` is `override:false`, Bun's `.env.development` **survives and beats `.env`**. Circular: `NODE_ENV` is itself defined in `.env`, so file selection is driven by a value LuckyStack thinks it owns. | MED-HIGH | open | 2026-07-15 | — | **Latent** — no such files exist today |
| B3 | **Duplicate-detector misses real duplicates** (no false positives). `reportDuplicateEnvKeys` (`env.ts:44-63`) parses *files* via `parseDotenv`, never `process.env` → zero false positives. But it only iterates `getEnvFiles()`, so a key in both `.env` and `.env.development` is **silently unreported** under Bun, and its "X wins" message can be wrong. | MED | open | 2026-07-15 | — | Violates the project's "one env key per file" rule silently |
| B4 | **Scaffold wizard hardcodes npm** — `create-luckystack-app/src/index.ts:1418` (`runNpmInstall` → `resolveCommandPath('npm')`) and `:1435` (`runPrismaGenerate` → `npx`). No PM detection in this package; no `--pm` flag in `VALID_FLAGS` (`:71-83`). | MED | open | 2026-07-15 | — | #1 blocker for any non-npm scaffold. `@luckystack/cli` already has `detectPackageManager` (`lib/project.ts:348-360`) to lift |
| B5 | **Template advertises no Bun** — `template/package.json:6-7` `engines` omits `bun`; no `packageManager` field written. All 17 packages declare only `node >=20.0.0`. Root already declares `engines.bun` + `bun:*` scripts + `scripts/checkBunCompat.mjs`. | LOW | open | 2026-07-15 | — | Metadata sweep |
| B6 | **`bun run <script>` likely does NOT give a Bun runtime.** `bun run` respects shebangs; `"server": "luckystack-dev"` is a bin with `#!/usr/bin/env node` → Bun starts it, sees the shebang, runs it **under Node**. Bun-as-taskrunner + Node-as-runtime, failing **silently green**. Prisma's docs prescribe `bunx --bun` for exactly this reason. | MED | open | 2026-07-15 | — | **Hypothesis** — doc evidence only. First thing to e2e-test. Directly threatens the "both runtimes always work" goal |
| B7 | **Router WS-upgrade proxying is the most Bun-sensitive code** — `router/src/wsProxy.ts` + `httpProxy.ts` + `startRouter.ts` do raw `node:http`/`node:https` + `node:net` Socket + 101 upgrade handling. Only relevant for opt-in `--router` projects. | MED | open | 2026-07-15 | — | Must be load-tested, not code-reviewed |
| B8 | **Prisma-on-Bun label is stale in our own docs.** `HOSTING.md:266` says "Prisma 6.x experimental Bun support"; Prisma now documents Bun as a supported runtime with driver adapters. But their guide demos `@prisma/adapter-pg` (Postgres) — LuckyStack offers Mongo/MySQL/Postgres/SQLite, so support may **not hold uniformly across all four**. | MED | open | 2026-07-15 | — | https://www.prisma.io/docs/guides/runtimes/bun · repo has Prisma 6.19.3 |
| B9 | **Pre-existing bug, unrelated to Bun (report-only): `redis.ts:40` reads `env.REDIS_HOST` from the FROZEN snapshot** — only password/user are call-time. So a **secret-manager-resolved `REDIS_HOST` never lands.** A gap in exactly the fix that took releases 0.6.3→0.6.6 to get right. | HIGH | open | 2026-07-15 | — | Found incidentally; **needs a decision** |
| B10 | **Stale finding from the 2026-07-02 scan (C-04)**: "config.ts reads EMAIL_FROM/DNS/EXTERNAL_ORIGINS at import time before `resolveSecretsIfConfigured`". `config.ts` now has **zero** direct `process.env` reads (DNS was removed in 0.1.5). | LOW | open | 2026-07-15 | — | Verify, then reclassify the 2026-07-02 ledger row to `false-positive` |

## Refuted

- ❌ **"`.env.local` secrets lose to Bun's preloaded `.env`"** — the feared severe case. **Doubly protected**: Bun's own precedence already ranks `.env.local` above `.env`, AND LuckyStack loads `.env.local` with `override: true` (force-overwrite). `.env` also holds no secrets (`NODE_ENV, SERVER_IP, SECURE, EXTERNAL_ORIGINS, PROJECT_NAME, REDIS_HOST, REDIS_PORT`).
- ❌ **"Secret-manager pointer resolution / Redis breaks under Bun"** — no new risk. `capturePointers` scans `process.env` at resolve time, `constructRedisClient` reads at **call** time, the default resolver is lazy, and `registerSecretsResolvedListener → rebuildDefaultRedisClient()` re-registers eagerly. The 0.6.5 fix holds. (See B9 for the *separate* pre-existing gap.)

## Recommended mitigation (env)

**Ship `bunfig.toml` with `env = false` in the scaffold template + a loud boot-time guard in `loadEnvFiles()`** (detect `globalThis.Bun` with auto-load still active → warn/throw). The bunfig restores exact Node semantics with zero code change; the guard covers consumers whose project lacks it, because the failure is otherwise **100% silent**. This also directly enables the "both runtimes always work" goal — no runtime choice needed if both behave identically.

**Explicitly rejected:**
- ❌ **`override: true` everywhere** — deliberately deletes the "a real ambient env var wins" contract (`env.ts:67-68`), which is load-bearing for Docker/K8s/CI. Trades a Bun-only bug for a production regression.
- ❌ **Snapshot `process.env`** — by the time any LuckyStack code runs, Bun has already mutated it. Nothing clean to snapshot.

## Runtime & PM decisions (user, 2026-07-15)

**Scope: npm + node + bun. pnpm and yarn are DROPPED for now.** (Reversed mid-discussion: the
user first wanted all 4 PMs first-class, then — once the matrix cost was made explicit —
narrowed to npm+bun. Correct call: it collapses the matrix from 8 cells to 4, and every
remaining cell tests a distinct mechanism rather than a resolution variant nobody asked for.)

- **Both runtimes always work** — no runtime choice, no manifest dimension, no switching
  machinery. `npm run server` and `bun run server` both work in every project. Consequence: a
  **stronger** claim than "choose one" — every project carries the promise, so the test bar goes
  up. Rationale (user): "dan heb je altijd beide werelden en geen gezeik als iemand via de CLI
  tool wil switchen." See B6 — the shebang hypothesis directly threatens this.
- **CI**: keep the existing LuckyStack-repo CI commands as-is. Do **not** build a PM matrix for
  the framework's own install (setup-specific, low value). **Scaffold-install matrix = high
  value** — precedent: Bug H (Windows `npm.cmd` space) was caught by a real scaffold install via
  verdaccio, missed by 1370 unit tests.
- **The 4 remaining matrix cells**, each testing a distinct mechanism:

  | PM | Runtime | Why this cell |
  |---|---|---|
  | npm | node | baseline — today |
  | bun | node | the 90/10: install speed, ~zero runtime risk |
  | npm | bun | isolates the runtime from the installer |
  | bun | bun | the full story |

## Already runtime-agnostic (enablers)

No `node:cluster` / `worker_threads` / native addons in any package — the classic Bun dealbreakers are absent (`scripts/cluster.ts` is a red herring; it just re-boots a second process). `AsyncLocalStorage` is the only static `node:*` runtime dep and Bun supports it. All 17 packages build with `tsup`; scripts run on `tsx`/`vite`/`tsc`. Socket.io attaches to a plain `http.Server`; HTTP-polling fallback already claimed validated. `scaffoldManifest.ts` + template ship no lockfile and no npm-specific fields. `@luckystack/cli`'s `detectPackageManager` + `runNpmInstall` already handle Bun end-to-end with Windows-safe quoting.

## Blocker

**Bun is not installed on the dev machine** (`bun --version` → not found). B1/B2/B3/B6 are all confirmable by a single real Bun boot. Installing Bun is a developer action.
