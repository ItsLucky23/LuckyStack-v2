# Bun runtime + package-manager support — feasibility & env risk — 2026-07-15

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: Bun runtime feasibility across `packages/*`, the scaffold wizard, the CLI manager, and LuckyStack's env-loading + secret-manager pointer pipeline · Tool/agents: 2 read-only investigation agents + Prisma/Bun doc research · Supersedes: —

Last updated: 2026-07-15

**Headline:** the framework runtime is largely Bun-clean already (no `node:cluster`, no `worker_threads`, no native addons in any package; `@luckystack/cli` already detects Bun). The real risk is **not** the runtime — it is **Bun's automatic `.env` loading** silently inverting LuckyStack's env precedence.

⚠️ **Most Bun behaviour below is derived from official docs, NOT observed** — except **B1/B2/B3 and B6, which are now CONFIRMED EMPIRICALLY under real Bun 1.3.14 (Windows)**. Bun is now installed on the dev machine. Remaining doc-derived items (B7/B8) are still **hypotheses pending a real Bun run.**

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| B1 | **`LUCKYSTACK_ENV_FILES` silently activates AND loses under Bun.** `env.ts:22-24` requires it be a real env var, "not a key inside one of the .env files (those are only read AFTER this list is resolved)". Bun preloads `.env`, breaking that premise: `getEnvFiles()` now sees it, but the named first file gets `override: false` (`env.ts:65-75`) so **`.env` beats `.env.staging` on every shared key**. `.env_template:43` ships this key commented **inside `.env`** — the footgun is pre-installed. | HIGH | **fixed** | 2026-07-15 | 2026-07-15 | ✅ **CONFIRMED EMPIRICALLY** (bun 1.3.14, real `env.ts`): with `LUCKYSTACK_ENV_FILES=.env.custom,.env.local` inside `.env`, node → `.env.custom` never loaded (contract holds); bun → **loaded (list hijacked)**, and `.env.custom`'s `SHARED_KEY` lost to Bun's preloaded `.env` value — exactly as predicted. Fixed by `bunfig.toml` `env = false` (root + template) + boot guard in `loadEnvFiles()`. Bun exposes no way to read the setting back (`Bun.config`/`Bun.bunfig` undefined), so the guard detects the symptom. Latent core↔CLI split still stands: `cli/src/commands/checkEnv.ts:59-85` reads it from the file |
| B2 | **`.env.{NODE_ENV}` becomes live but invisible.** Bun loads `.env.production`/`.development`/`.test` between `.env` and `.env.local`. LuckyStack never loads or inspects them, and since `.env` is `override:false`, Bun's `.env.development` **survives and beats `.env`**. Circular: `NODE_ENV` is itself defined in `.env`, so file selection is driven by a value LuckyStack thinks it owns. | MED-HIGH | **fixed** | 2026-07-15 | 2026-07-15 | ✅ **CONFIRMED EMPIRICALLY** (bun 1.3.14, real `env.ts`): same files, node → `SHARED_KEY=from_dot_env`; bun → `SHARED_KEY=from_dot_env_development`. 100% silent. With `bunfig.toml` `env = false`, bun output is **byte-identical to node** (`DEV_ONLY=undefined`). Also **corrects the docs**: `.env.{mode}.local` (undocumented) outranks `.env.local`; Bun is first-wins, and a real ambient var still beats every file (verified — the `env.ts:67-68` contract survives) |
| B3 | **Duplicate-detector misses real duplicates** (no false positives). `reportDuplicateEnvKeys` (`env.ts:44-63`) parses *files* via `parseDotenv`, never `process.env` → zero false positives. But it only iterates `getEnvFiles()`, so a key in both `.env` and `.env.development` is **silently unreported** under Bun, and its "X wins" message can be wrong. | MED | **wontfix** | 2026-07-15 | 2026-07-15 | Confirmed by inspection, but **deliberately not implemented**: `winner = sources.at(-1)` encodes LuckyStack's *last-wins* model, while Bun is *first-wins* over a **different file set** — teaching it Bun's files would make it print a confidently WRONG winner. It is also opt-in (`LUCKYSTACK_ENV_DEBUG`), so it only fires for someone already debugging. The `bunfig.toml` removes the condition entirely, and the new always-on boot guard covers the unfixed case more loudly. Revisit only if the bunfig is ever dropped |
| B4 | **Scaffold wizard hardcodes npm** — `create-luckystack-app/src/index.ts:1418` (`runNpmInstall` → `resolveCommandPath('npm')`) and `:1435` (`runPrismaGenerate` → `npx`). No PM detection in this package; no `--pm` flag in `VALID_FLAGS` (`:71-83`). | MED | open | 2026-07-15 | — | #1 blocker for any non-npm scaffold. `@luckystack/cli` already has `detectPackageManager` (`lib/project.ts:348-360`) to lift |
| B5 | **Template advertises no Bun** — `template/package.json:6-7` `engines` omits `bun`; no `packageManager` field written. All 17 packages declare only `node >=20.0.0`. Root already declares `engines.bun` + `bun:*` scripts + `scripts/checkBunCompat.mjs`. | LOW | open | 2026-07-15 | — | Metadata sweep |
| B6 | **✅ CONFIRMED EMPIRICALLY (bun 1.3.14, Windows): `bun run <script>` does NOT give a Bun runtime.** A bin-based script (`"server": "luckystack-dev"`) runs under **Node** (`C:\Program Files\nodejs\node.exe`) and looks completely green. **The Windows mechanism is not the shebang** — Windows has no shebangs; it is npm's generated **`.cmd` shim, which hardcodes a `node` call**. `bun --bun run <script>` DOES force Bun (by injecting a fake `node.exe` shim into TEMP, e.g. `%TEMP%\bun-node-<hash>\node.exe`). A direct `bun run ./file.js` also runs under Bun. **Directly defeats the "both runtimes always work" goal**: today `npm run server` and `bun run server` both already "work" — both on Node. | **HIGH** | open | 2026-07-15 | — | Test: 4 cases, scratchpad `b6test/`. Consequence: either document `bun --bun run <script>`, or ship dedicated `bun:*` scripts (the root package.json already uses this pattern). **Also unresolved:** the devkit supervisor spawns `process.execPath` + the tsx CLI — under `bun --bun` that resolves to the TEMP node-shim, so the child's runtime needs its own test |
| B7 | **Router WS-upgrade proxying is the most Bun-sensitive code** — `router/src/wsProxy.ts` + `httpProxy.ts` + `startRouter.ts` do raw `node:http`/`node:https` + `node:net` Socket + 101 upgrade handling. Only relevant for opt-in `--router` projects. | MED | open | 2026-07-15 | — | Must be load-tested, not code-reviewed |
| B8 | **Prisma-on-Bun label is stale in our own docs.** `HOSTING.md:266` says "Prisma 6.x experimental Bun support"; Prisma now documents Bun as a supported runtime with driver adapters. But their guide demos `@prisma/adapter-pg` (Postgres) — LuckyStack offers Mongo/MySQL/Postgres/SQLite, so support may **not hold uniformly across all four**. | MED | open | 2026-07-15 | — | https://www.prisma.io/docs/guides/runtimes/bun · repo has Prisma 6.19.3 |
| B9 | **Pre-existing bug, unrelated to Bun: `redis.ts:40` + `:165` read `env.REDIS_HOST`/`REDIS_PORT` from the FROZEN snapshot** — only password/user were call-time. A secret-manager-resolved `REDIS_HOST` **never landed**: a pointer passes Zod's `min(1)`, so the client silently connected to a host literally named after the pointer. The asymmetry was *documented in the comment at `:32-34`* but never recognised as a bug. A gap in exactly the fix that took 0.6.3→0.6.6 to get right. `getEnv()` is NOT an alternative — `bootstrapEnv` returns a cached singleton. | HIGH | **fixed** | 2026-07-15 | 2026-07-15 | Both read sites now go through `readRedisHost()`/`readRedisPort()` (call-time `process.env`, explicit empty-check falling back to the validated snapshot). Regression test `redisConnectionOptions.test.ts` (6 cases) — **verified to FAIL without the fix (5/6) and pass with it**. 257/257 core tests green, lint clean. CHANGELOG entry pending (file owned by a concurrent agent) |
| B10 | **Stale finding from the 2026-07-02 scan (C-04)**: "config.ts reads EMAIL_FROM/DNS/EXTERNAL_ORIGINS at import time before `resolveSecretsIfConfigured`". `config.ts` now has **zero** direct `process.env` reads (DNS was removed in 0.1.5). | LOW | open | 2026-07-15 | — | Verify, then reclassify the 2026-07-02 ledger row to `false-positive` |

## Refuted

- ❌ **"`.env.local` secrets lose to Bun's preloaded `.env`"** — the feared severe case. **Doubly protected**: Bun's own precedence already ranks `.env.local` above `.env`, AND LuckyStack loads `.env.local` with `override: true` (force-overwrite). `.env` also holds no secrets (`NODE_ENV, SERVER_IP, SECURE, EXTERNAL_ORIGINS, PROJECT_NAME, REDIS_HOST, REDIS_PORT`).
- ❌ **"Secret-manager pointer resolution / Redis breaks under Bun"** — no new risk. `capturePointers` scans `process.env` at resolve time, `constructRedisClient` reads at **call** time, the default resolver is lazy, and `registerSecretsResolvedListener → rebuildDefaultRedisClient()` re-registers eagerly. The 0.6.5 fix holds. (See B9 for the *separate* pre-existing gap.)

## Mitigation (env) — ✅ SHIPPED 2026-07-15

**`bunfig.toml` with `env = false` at the repo root + in the scaffold template, plus a boot-time guard in `loadEnvFiles()`.** Verified end-to-end under real Bun 1.3.14: with the bunfig, `bun` and `node` produce byte-identical env; without it, the guard fires and names the offending files. This directly enables the "both runtimes always work" goal — both behave identically.

Implementation notes worth carrying forward:

- **Version floor**: `env = false` (and `--no-env-file`) landed in **Bun 1.3.3** ([PR #24767](https://github.com/oven-sh/bun/pull/24767)). On 1.3.0–1.3.2 the key **silently does nothing**. It is a top-level key (`env = false`), also accepted as `[env]` + `file = false`. bunfig is resolved from **cwd only** — it does not walk up parent dirs (monorepo footgun).
- **`bun install` ignores it** ([oven-sh/bun#31450](https://github.com/oven-sh/bun/issues/31450), open) — it always loads `.env.production`/`.env.local`/`.env`. So auto-load is unavoidable during install/postinstall. **This is why the guard warns rather than throws**: throwing would make a postinstall boot on Bun unfixably fatal.
- **No runtime introspection exists** — `Bun.config` / `Bun.bunfig` are `undefined` (verified), and `Bun.env` is a plain alias of `process.env` with no provenance. The guard therefore detects the *symptom*: an env file already applied to `process.env` byte-for-byte before the loader runs. Requiring **all** keys to match (not merely presence) keeps a Docker/K8s partial-ambient-override from false-positiving; Bun's mode files are included as candidates because they are pure signal (the framework never loads them) and they cover the case where a mode file overriding a `.env` key hides `.env` from the check.

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

## Blocker — ✅ CLEARED 2026-07-15

**Bun 1.3.14 is now installed** (not yet on PATH; invoke by absolute path at
`C:\Users\mathi\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe`).
B1/B2/B3/B6 are confirmed. **B7 (router WS-upgrade proxying) and B8 (Prisma-on-Bun across all
four DBs) remain unverified** — both need a real Bun run, not a code review.
