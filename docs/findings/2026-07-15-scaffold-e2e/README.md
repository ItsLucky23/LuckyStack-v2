# Scaffold end-to-end via a local registry — 2026-07-15

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: a real `create-luckystack-app` scaffold + install resolved by SEMVER from a throwaway verdaccio, then generate → typecheck → build · Tool: `npm run e2e:verdaccio` (new this session) · Supersedes: —

Last updated: 2026-07-15

**Why this folder exists:** a `file:` + `overrides` harness cannot reach the real install path — the scaffolder resolves `@luckystack/*` by semver from a registry. That gap is where **Bug H** hid (a Windows `npm.cmd` space-in-path bug that silently broke `npx create-luckystack-app` for every standard Windows user, missed by 1370 green unit tests). The recipe previously existed only as prose in `branch-logs/`; it is now `scripts/e2eVerdaccio.mjs`.

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| **E2** | **🔴 `--pm=bun` shipped a BROKEN project: Bun runs no lifecycle scripts without `trustedDependencies`.** Proven empirically (bun 1.3.14) with a minimal probe: a dep whose `postinstall` writes a marker file → **without** `trustedDependencies` the marker never appears; **with** it, it does. Consequences for the scaffold: (a) **`@prisma/client`**'s `postinstall: node scripts/postinstall.js` is what GENERATES the client — without it, `generateArtifacts` dies on `unresolved type identifiers: User`, and every subsequent `bun install` (including the one `luckystack add <feature>` runs) silently destroys a client that `npx prisma generate` had produced, with nothing to regenerate it; (b) **`sharp`**'s `install: node install/check.js \|\| npm run build` fetches/builds its NATIVE binary — **this one fails silently and only at runtime**, in avatar processing. npm never had the problem because it re-runs `@prisma/client`'s postinstall on every install. | **HIGH** | fixed | 2026-07-15 | 2026-07-15 | `trustedDependencies: ["@prisma/client", "prisma", "sharp"]` in `template/package.json`. **This is the vindication of "a wizard option is a support claim"**: `--pm=bun` passed 281 unit tests, a real scaffold render, and the cross-package `detectPackageManager` seam — and still produced a broken project. Only a real registry install surfaced it |
| E1 | **A freshly scaffolded project cannot `npm run typecheck` or `npm run build`.** Both fail with `TS2307: Cannot find module '../_sockets/apiTypes.generated'` plus ~4 cascading errors in `SessionProvider.tsx` (`Type 'string' is not assignable to type 'never'`). The scaffold ships **without** the generated route/type maps: the repo root has a guarded `postinstall` that generates them when missing, **the template does not**; `test` chains `generateArtifacts` (deliberately, per the package docs) but `typecheck` and `build` do not; and `main()` runs install + `prisma generate` but never generation. The intended first command IS `npm run server`, which generates them via the dev supervisor — so the happy path works and this only bites someone who typechecks/builds **before ever running the dev server**: a CI pipeline (`npm ci && npm run typecheck`), or an AI agent asked to verify the scaffold. | MED | **fixed** | 2026-07-15 | 2026-07-15 | Found by the first full e2e run. **Fixed by chaining `generateArtifacts` into the template's `typecheck` + `build`** (`template/package.json`), matching what `test` already did. The recommended `postinstall` mirror was **rejected on inspection**: the root's runs after its own install, but in a freshly-scaffolded project it would race `prisma generate` — generation needs the Prisma client to exist, and postinstall ordering does not guarantee it. Chaining puts the dependency where it actually belongs, at the point of use. Proven by removing the e2e harness's explicit `generateArtifacts` step and watching the matrix stay green. ⚠️ **This row said `open` until 2026-07-16 although the fix shipped on the 15th — ledger drift, my bookkeeping, not a second bug.** The status line is the thing a later cleanup trusts, so it has to move with the code |

## What the e2e proved GREEN (the real install path)

Real registry, real semver resolution, real onboarding install — not a `file:` shortcut:

**`npm run e2e:verdaccio` (npm + node baseline): ALL GREEN, exit 0.**

| Step | Result |
|---|---|
| build packages | ✅ |
| publish 17/17 to the local registry | ✅ (via the REAL `scripts/publishPackages.mjs`, not a reimplementation) |
| the registry serves OUR tarball, not npmjs | ✅ `http://127.0.0.1:4873/create-luckystack-app/-/create-luckystack-app-0.6.7.tgz` |
| **scaffold via `npx`, WITH install** | ✅ ← the onboarding path Bug H broke |
| **`npm install` (idempotent re-install)** | ✅ ← the add/upgrade path |
| generateArtifacts | ✅ |
| typecheck | ✅ |
| build | ✅ |

### Matrix coverage

| PM | Runtime | Status |
|---|---|---|
| npm | node | ✅ **ALL GREEN** — the baseline |
| bun | node | ✅ **ALL GREEN** — `bun.lock` present, so bun genuinely performed the install |
| bun | bun | ✅ **ALL GREEN** — runtime probe reports `BUN` |
| npm | bun | ✅ **ALL GREEN** — isolates the runtime from the installer |

**All four cells green.**

Every cell covers: publish 17/17 → origin assertion → **scaffold via `npx` WITH install** →
lockfile assertion → re-install → generateArtifacts → typecheck → build.

**Scope of the runtime probe, stated honestly:** it runs a file under bun and checks
`typeof Bun`, which proves bun executes the project's code — *not* that the SERVER boots
under bun. That is proven separately, and more strongly, by a real boot against live Redis
(`[Supervisor] Started server process (runtime: bun)`, `typeof Bun = object`, `Connected to
Redis`, `GET /livez` → 200, `/_health` → ok). The two should not be conflated.

### Runtime proof on a REAL scaffolded project (2026-07-15)

The matrix only builds. These are the gaps it could not see — closed by booting a project
that `npx create-luckystack-app --pm=bun` produced from the local registry, against a
dockerised MongoDB replica set + Redis. No source hacks: this is what a consumer gets.

```
[Supervisor] Started server process (pid: 91028, runtime: bun)
Connected to Redis
SocketIO server initialized (redis adapter attached)
Server is running on http://127.0.0.1:84/

GET  /livez    -> 200 {"status":"live"}
GET  /_health  -> 200 {"status":"ok","bootUuid":"38ed765f-..."}
socket.io client connected · transport=websocket      <- the WS upgrade
apiRequest over the socket -> {"status":"success","result":null,"httpStatus":200}
```

Prisma CRUD (count → create → read → delete) against MongoDB, run on both runtimes:

```
[NODE] ✅ create+read+delete OK · createdAt=Date
[BUN]  ✅ create+read+delete OK · createdAt=Date
```

(Incidentally this confirms the wire-type analysis in the type-generation ledger: `createdAt`
really is a `Date` object server-side. It only becomes a string on the wire.)

| Gap | Status |
|---|---|
| Prisma *queries* under Bun | ✅ **closed** — real CRUD on MongoDB, both runtimes |
| A real Socket.io client connection | ✅ **closed** — `transport=websocket`, full apiRequest round-trip |
| Server boot under Bun | ✅ **closed** — on a genuinely scaffolded project |
| Databases other than MongoDB/SQLite | ⛔ **open** — MySQL / Postgres untested on Bun (B8) |
| Router WS proxying | ⛔ **blocked, not open** — the router cannot start on ANY runtime (B13 fixed, **B14 open**), so the Bun question cannot yet be asked |

**Verdict: Bun is proven for a consumer's build, boot, and full request path — HTTP, the
WebSocket upgrade, the socket API round-trip, and Prisma queries.** Two things remain: two
untested database engines, and a router that is broken independently of Bun.

### E3 — the harness reported a bun install that never happened

The `--pm=bun` run went green on "bun install" **before bun was ever invoked**. What
actually happened: winget installs bun without touching the current shell's PATH → the
scaffolder's PATH-only scan (deliberate: cwd is excluded as a BatBadBut mitigation) did not
find it → it **skipped the install with a hint and no crash** (correct behaviour) → `npx
prisma generate` then ran against an EMPTY `node_modules` → npx fetched the newest prisma
from npmjs, i.e. **Prisma 7**, which rejects the v6-style `datasource.url` (P1012) → and the
harness's own re-install step later populated `node_modules` anyway, painting the run green.

Fixed by prepending bun's directory to the scaffold step's PATH, plus a **lockfile
assertion** — `bun.lock` is the artifact only the real installer leaves behind, so a skipped
install can no longer pass. This was the FOURTH time this harness tried to report green on
something it had not tested (see bugs 3, 5, 7 below); the assertion pattern is the answer.

**Worth its own note:** `npx prisma generate` silently resolves the NEWEST prisma from the
registry when the local one is absent. A partially-failed install therefore produces a
confusing Prisma **7** schema error in a project that pins **6** — the error names the schema,
not the real cause. Not fixed; recorded.

## Harness bugs found by RUNNING it (all mine, all fixed)

Recorded because the pattern matters more than the bugs: **three of the eight would have produced a GREEN run that proved nothing** — strictly worse than a red one, because red forces you to look. The script had been written, reviewed, and called "ready" before any of these surfaced.

| # | Bug | Would have caused |
|---|---|---|
| 1 | `waitForPort` probed IPv4 while verdaccio binds `[::1]` given only a port | Full timeout against a healthy server. The manual check passed only because `curl localhost` prefers IPv6 on Windows |
| 2 | `stdio: 'ignore'` discarded verdaccio's log | A clear "address in use" became a mute 120s timeout |
| 3 | No pre-flight port check | 🔴 **Publishing into, and testing against, someone else's registry** |
| 4 | `kill()` on the `npx` wrapper, not the tree | Every run orphaned a verdaccio that poisons the next run — this is what created the stray that exposed #1 |
| 5 | `create-luckystack-app` is **unscoped**, so `@luckystack/*`-local-only didn't cover it → fell through to the npmjs proxy | 🔴 **Silently testing the PUBLISHED scaffolder** |
| 6 | Reimplemented `npm publish` instead of calling `scripts/publishPackages.mjs` | Missed that `publishConfig.provenance: true` needs the `--provenance=false` FORM (plain `--no-provenance` and the env var do nothing — lesson 0005, walked into again), and skipped the script's idempotency check. A harness built to catch drift, introducing drift |
| 7 | npx caches under `_npx/<hash>` keyed by the package **spec**, not the registry | 🔴 **Silently running the npmjs copy** even with a correct local registry. Fixed with a per-run `npm_config_cache` |
| 8 | Skipped `generateArtifacts` | Misread E1 as a harness artifact instead of the real finding it is |

Mitigation now in the script: an explicit **"the registry serves OUR tarball"** assertion (#5 and #7 would both have failed it immediately), a pre-flight port check that refuses to run (#3), and tree-kill teardown (#4). A harness that claims it tests the real path must **prove** it, not assume it.
