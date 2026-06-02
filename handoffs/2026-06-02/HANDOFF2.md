# Handoff 2026-06-02 solo (dependency-modernization + secret-manager AI)

> Companion file to `HANDOFF.md` (written by the concurrent test-AI). This file covers the OTHER
> workstream on `chore/package-split-prep`: the `@luckystack/secret-manager` package + the dependency
> modernization. Resume target: laptop. Nothing is committed — the user commits/pushes themselves. The
> branch is shared with the test-AI (see Caveats). Deepest per-step detail lives in
> `branch-logs/chore--package-split-prep.md` (this AI's entries 23:26 → 07:55).

## Session overview

Two workstreams ran on `chore/package-split-prep`:

1. **`@luckystack/secret-manager`** — built a new rotation-aware secret-resolver client package that
   replaces the unused `@luckystack/env-resolver` package and the never-built `@luckystack/secrets`
   design (`docs/ARCHITECTURE_SECRETS.md`). Fully done, gated green. The companion external server
   (`luckystack-secret-manager`) was built in a separate repo (in another window) and now runs.
2. **Dependency modernization (Stages 0-4)** — bumped the whole dependency tree, including framework-
   critical majors. TS 6, Vite 8, Zod 4 landed; **Prisma 7 and ESLint 10 are held** (hard upstream
   blockers, not choices). **Stage 5 (publish-contract refresh + final gate) is NOT done yet.**

End state: working tree is green (`build:packages` 14/14, `tsc -b` 0, `lint`+`lint:packages` 0,
`test:unit` 47 files/703 tests, `generateArtifacts` ✓). Nothing committed.

## Timeline

- Located env/secret-manager docs (`packages/env-resolver/docs/architecture.md`, `docs/ARCHITECTURE_SECRETS.md`), flagged the two divergent contracts.
- Planned + built `packages/secret-manager/` (client) — `src/index.ts`, `package.json`, `tsup.config.ts`, `CLAUDE.md`, `README.md`, `docs/architecture.md`, `LICENSE`, `CHANGELOG.md`, `src/index.test.ts`.
- Removed `packages/env-resolver/`, `docs/ARCHITECTURE_SECRETS.md`, template copy; updated build wave (`scripts/buildPackages.mjs`), `tsconfig.server.json`, `docs/PACKAGE_OVERVIEW.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE_EXTENSION_POINTS.md`, root `CLAUDE.md`, `.gitignore`, `.env_template`; added `docs/ARCHITECTURE_SECRET_MANAGER.md`.
- Enhanced dev hot-reload (`reloadSecretManagerFromFiles` + in-package `.env` parser); 18→20 tests.
- Added CLAUDE.md rule-12 pre-commit clarification; confirmed pre-commit hook regenerates all 3 AI snapshots.
- Removed transient `docs/SECRET_MANAGER_SERVER_HANDOFF.md` + `docs/SECRET_MANAGER_PACKAGE_PLAN.md` (external repo now live); `git rm .lint-unnecessary.out` + gitignored.
- Dep Stage 0: removed env-resolver orphan from `package-lock.json`.
- Dep Stage 1: `npm update` (within-major) + auto-fixed ~32 `no-unnecessary-type-assertion` (from typescript-eslint 8.60) + 1 orphan import in `src/_sockets/socketInitializer.ts`.
- Dep Stage 2: bcryptjs 3, dotenv 17, uuid 14, chokidar 5, lucide-react 1, resend 6 (manifests only).
- Dep Stage 3: Vite 8 + plugins; unicorn 64 / globals 17 / react-hooks 7 / react-refresh 0.5; pinned `@types/node@^22`; fixed a type-hole in `packages/sync/src/handleHttpSyncRequest.ts`.
- Dep Stage 4a: TypeScript 6 (`ignoreDeprecations`, explicit `types`, secret-manager tsconfig).
- Dep Stage 4b: investigated Prisma 7 → **held** (no Mongo adapter); removed react-x/react-dom (TS6 forced).
- Dep Stage 4c: Zod 4 (migrated `schemaSampleInput.ts` introspection); regenerated artifacts.
- Wrote this handoff (as HANDOFF2.md to avoid clobbering the test-AI's HANDOFF.md).

## Done

### Workstream 1 — @luckystack/secret-manager (complete, green)

- **New package `packages/secret-manager/`** — rotation-aware secret resolver CLIENT.
  - Pointer model: `.env` holds `OPENAI_KEY=OPENAI_AUTHORIZATION_KEY_V5` (a pointer, committable); at boot
    the client resolves it against the external server and overwrites `process.env.OPENAI_KEY` with the
    real secret. Pattern `^(.+)_V(\d+)$`; non-pointer values left untouched (local overrides win for free).
  - Exports: `initSecretManager(config)` (first line of `server.ts`), `refreshSecretManager()` (poll
    channel), `reloadSecretManagerFromFiles()` (file-watch channel — re-parses `.env`/`.env.local`,
    injects plain values + resolves pointers), `getCachedResolution()`, `resetSecretManagerForTests()`.
  - Modes: `remote` (missing pointer / fetch error throws), `local` (no network), `hybrid` (warn + keep
    local env). Token: literal or `{ fromFile: '.secret-manager-token' }` (gitignored single-line file).
  - Dev hot-reload is opt-in via `config.dev` (`watch`, `pollIntervalMs`, `envFiles`); no-op in production.
    Uses a tiny in-package `.env` parser so the package stays dependency-free (NO `dotenv` dep — an earlier
    attempt to use dotenv was reverted because its dynamic import broke the tsup DTS build under the shared tsconfig).
  - Wire contract it depends on: `POST /resolve` `{ keys: [...] }` -> `{ values: {...} }`.
  - `src/index.test.ts`: 20 vitest cases (pointer detection, resolve mapping, atomic remote-fail, hybrid
    soft-fail, rotation, token-from-file, dev poll + production no-op, file reload, reset).
- **Removed** `packages/env-resolver/` (whole dir), `docs/ARCHITECTURE_SECRETS.md`, and the stale template
  copy `packages/create-luckystack-app/template/docs/luckystack/ARCHITECTURE_SECRETS.md`.
- **Wiring/docs**: `scripts/buildPackages.mjs` WAVES (`env-resolver`→`secret-manager`, still 14 pkgs);
  `tsconfig.server.json` include swap; `docs/PACKAGE_OVERVIEW.md` (utilities row + cheatsheet);
  `docs/ROADMAP.md` (external-server item now "built and running"); `docs/ARCHITECTURE_EXTENSION_POINTS.md`;
  root `CLAUDE.md` (doc table + rule-12 pre-commit clarification); `.gitignore` (`.secret-manager-token`,
  `.lint-unnecessary.out`); `.env_template` (secret-manager section); new `docs/ARCHITECTURE_SECRET_MANAGER.md`.
- **Cleanup**: deleted the two transient docs (`docs/SECRET_MANAGER_SERVER_HANDOFF.md`,
  `docs/SECRET_MANAGER_PACKAGE_PLAN.md`) after the external repo went live, and rerouted the 5 references
  to them; `git rm .lint-unnecessary.out` (accidentally-tracked lint output).
- `ai:index`, `ai:capabilities`, `ai:project-index` regenerated during this workstream.

### Workstream 2 — Dependency modernization (Stages 0-4 done within ecosystem limits)

- **Stage 0** — removed the `extraneous` `"packages/env-resolver"` block from `package-lock.json`.
- **Stage 1 (safe minors)** — `npm update`: react/react-dom 19.2.7 (+@types/react 19.2.16),
  react-router-dom 7.16, @sentry/node+react 10.55, tailwindcss + @tailwindcss/postcss 4.3, ioredis 5.11,
  postcss 8.5.15, vite 6.4.3, vitest 4.1.8, tsx 4.22.4, typescript-eslint 8.60.1,
  eslint-import-resolver-typescript 4.4.5, eslint-plugin-i18next 6.1.4, @fortawesome/react-fontawesome 3.3.1.
  - typescript-eslint 8.60's stricter `no-unnecessary-type-assertion` flagged ~32 sites → auto-fixed with
    `--fix` across `src/` + `packages/*/src`; removed the resulting orphan import in
    `src/_sockets/socketInitializer.ts` (`SyncRouteStreamEvent`).
- **Stage 2 (runtime majors)** — `bcryptjs` 3.0.3 (removed now-redundant `@types/bcryptjs`), `dotenv` 17.4.2,
  `uuid` 14, `chokidar` 5 (root + devkit), `lucide-react` 1.17 (NOTE: unused anywhere — removal candidate),
  `resend` 6.12.4 (adapter unchanged — it uses its own interface + `@ts-expect-error`). No code changes needed.
- **Stage 3 (build/dev tooling majors)** — `vite` 8 (now Rolldown bundler) + `@vitejs/plugin-react-swc` 4 +
  `vite-tsconfig-paths` 6 + `@rollup/plugin-alias` 6; `eslint-plugin-unicorn` 64, `globals` 17,
  `eslint-plugin-react-hooks` 7, `eslint-plugin-react-refresh` 0.5.
  - react-hooks 7's `recommended` preset now bundles the React-Compiler rules (`set-state-in-effect` etc.)
    flagging ~25 existing effect sites → pinned the config to the classic `rules-of-hooks` + `exhaustive-deps`
    in `eslint.official.config.js` (adopting the new rules is a separate opt-in refactor).
  - unicorn 64 new rules (`escape-case`, `no-hex-escape`, `explicit-length-check`) + ts-eslint
    `no-unnecessary-type-conversion` → fixed in `packages/test-runner/src/runAllTests.ts`.
  - Pinned `@types/node@^22` (Vite 8 transitively pulled Node-25 types; that shifted inference).
  - Fixed a real type-hole exposed by the newer types: `packages/sync/src/handleHttpSyncRequest.ts` success
    envelope now guarantees `HttpSyncResponse.message` (preserving the route's own message).
- **Stage 4a — TypeScript 6** (typescript-eslint 8.60 supports TS <6.1, so no blocker):
  - `"ignoreDeprecations": "6.0"` in `tsconfig.shared.json` (TS 6 turns the tsup-injected `baseUrl` into an error).
  - Explicit `"types": ["node","react","react-dom"]` in `tsconfig.packages.base.json` (TS 6 no longer
    auto-includes all `@types/*`).
  - New `packages/secret-manager/tsconfig.json` (it had none — relied on TS 5.7 defaults).
  - devkit's TS compiler API works unchanged with TS 6 (`generateArtifacts` clean).
- **Stage 4c — Zod 4** (4.4.3):
  - Peers `zod ^3.25.0 → ^4.0.0` (core/devkit/test-runner) + root dep.
  - `packages/core/src/env.ts` — no change (z.object/enum/string/default/safeParse/infer unchanged).
  - `packages/test-runner/src/schemaSampleInput.ts` — migrated `_def` introspection to zod 4 internals:
    object `_def.shape` is now an object not a function (`typeof === 'function' ? shape() : shape`); literal
    uses `_def.values[]` not `_def.value`; `z.ZodTypeAny → z.ZodType`, `schema._def → schema.def`. v3-compat kept.
  - devkit schema-emitter emits zod-4-valid output; `apiInputSchemas.generated.ts` regenerated.

## In Progress

- **Stage 5 — publish-contract refresh + final gate (NOT started):**
  - Update `docs/PACKAGE_OVERVIEW.md` peer tables (zod 3→4, typescript 5.7→6; note react-x/react-dom removed;
    prisma stays 6). The published peer ranges already bumped in package.json files: `typescript ^6` (devkit
    peer), `zod ^4` (core/devkit/test-runner peers). `@prisma/client` peer stays `^6.19.0` everywhere.
  - Full `npm run build` (vite client + `tsc -b` + `bundleServer`) — only `build:packages` + `vite build`
    + `tsc -b` have been run separately so far; the full pipeline + `npm run pack:dry` 14/14 not yet run.
  - Regenerate AI indexes a final time; add the closing branch-log + INDEX entry.

## Blockers

- **Prisma 7 — HELD (hard upstream blocker).** `prisma generate` under v7 fails:
  ```
  Error code: P1012
  error: The datasource property `url` is no longer supported in schema files.
  ```
  Prisma 7 requires a driver `adapter` in the `PrismaClient` constructor. `@prisma/adapter-mongodb` does
  NOT exist (npm 404; only `@prisma/adapter-pg`/`-mariadb`/`-better-sqlite3` ship at 7.8.0). Prisma's own
  docs state: *"MongoDB support for Prisma ORM v7 is coming in the near future. In the meantime, please use
  Prisma ORM v6.19."* This repo defaults to MongoDB, so Prisma 7 is unusable here. **Reverted to Prisma 6.19**
  (all peers + root deps back to `^6.19.x`). Re-attempt when Prisma ships MongoDB v7 support.
- **ESLint 10 — HELD (hard upstream blocker).** Latest `eslint-plugin-react` (7.37.5, peer `eslint … || ^9.7`)
  and `eslint-plugin-jsx-a11y` (6.10.2, peer `eslint … || ^9`) have NO eslint-10 release. Because
  `eslint-plugin-react-x@5`/`-react-dom@5` REQUIRE `eslint ^10.3`, they can't be installed either — and the
  v1/v2 line of react-x caps `typescript` at 5.x (incompatible with TS 6). So **react-x + react-dom were
  removed** from `eslint.official.config.js` and devDeps to keep TS 6. Held: `eslint` 10, `@eslint/js` 10,
  `eslint-plugin-react-x` 5, `eslint-plugin-react-dom` 5. Re-add (react-x/dom @ v5 + eslint 10) once
  eslint-plugin-react + jsx-a11y ship eslint-10 support. (typescript-eslint 8.60 already supports eslint 10.)
- **`prisma generate` EPERM (transient, Windows).** `rename query_engine-windows.dll.node` failed — the
  query engine `.dll` was locked, almost certainly by the concurrent test-AI's running dev server. Harmless;
  the existing Prisma-6 client matches `@prisma/client` 6. Not a code issue.

## Next Steps

1. (If resuming on a fresh checkout/laptop) `git pull` the branch, then `npm install` to refresh
   `node_modules` + workspace symlinks.
2. Re-verify the gate is green: `npm run lint && npm run lint:packages && npm run build:packages && npx tsc -b && npm run test:unit`.
3. **Stage 5a** — update `docs/PACKAGE_OVERVIEW.md` peer-dep tables: zod `^3.25` → `^4`, typescript `~5.7.3` → `^6`,
   drop any react-x mention, keep `@prisma/client ^6.19`.
4. **Stage 5b** — run the FULL build: `npm run build` (build:packages + generateArtifacts + tsc -b + vite build + bundleServer).
   Then `npm run pack:dry` and confirm 14/14 with LICENSE + CHANGELOG in each tarball, no `src/`/`*.test.ts` leakage.
5. **Stage 5c** — regenerate AI indexes (`npm run ai:index`, `npm run ai:capabilities`, `npm run ai:project-index`)
   and append a closing branch-log entry + bump `branch-logs/INDEX.md`.
6. Decide on the held majors (Open Questions) and on committing (user owns this).
7. Optional follow-ups surfaced this session: remove unused `lucide-react`; adopt react-hooks-7 React-Compiler
   rules (the ~25 effect refactors); switch Vite to native `resolve.tsconfigPaths: true` (vite-tsconfig-paths
   is now redundant); drop `baseUrl` entirely before TS 7 (currently silenced via `ignoreDeprecations`).

## Open Questions

- **Prisma 7 timing** — wait for Prisma's MongoDB v7 support (recommended), or migrate only the SQL providers
  now while MongoDB stays on 6? Decided this session: hold on 6 (Mongo is the default).
- **ESLint 10 timing** — wait for `eslint-plugin-react` + `jsx-a11y` to support eslint 10, then re-add
  react-x/react-dom @ v5 and bump eslint 10. Until then react-x lint coverage is reduced (classic
  `eslint-plugin-react` `jsx-no-literals` + `jsx-a11y` remain).
- **Commit strategy** — the branch holds BOTH this dep work AND the concurrent test-AI's uncommitted work.
  A single commit snapshots both. User said they will commit/push themselves.

## Files Touched

Modified:
```
package.json
package-lock.json
.gitignore
.env_template            (also edited by the test-AI)
CLAUDE.md
tsconfig.shared.json
tsconfig.packages.base.json
tsconfig.server.json
eslint.official.config.js
scripts/buildPackages.mjs
docs/PACKAGE_OVERVIEW.md
docs/ROADMAP.md
docs/ARCHITECTURE_EXTENSION_POINTS.md
docs/PUBLISH_READINESS_AUDIT.md
docs/AI_QUICK_INDEX.md
docs/AI_CAPABILITIES.md
docs/AI_PROJECT_INDEX.md
src/_sockets/socketInitializer.ts
packages/core/package.json
packages/api/package.json
packages/login/package.json
packages/server/package.json
packages/sync/package.json
packages/devkit/package.json
packages/email/package.json
packages/test-runner/package.json
packages/sync/src/handleHttpSyncRequest.ts          (also edited by the test-AI — coordinated)
packages/test-runner/src/runAllTests.ts             (also edited by the test-AI — coordinated)
packages/test-runner/src/schemaSampleInput.ts
branch-logs/chore--package-split-prep.md            (shared log; INDEX too)
branch-logs/INDEX.md
```
Added:
```
packages/secret-manager/                            (package.json, tsup.config.ts, tsconfig.json, src/index.ts, src/index.test.ts, CLAUDE.md, README.md, docs/architecture.md, LICENSE, CHANGELOG.md)
docs/ARCHITECTURE_SECRET_MANAGER.md
handoffs/2026-06-02/HANDOFF2.md                      (this file)
```
Deleted:
```
packages/env-resolver/                              (whole dir)
docs/ARCHITECTURE_SECRETS.md
packages/create-luckystack-app/template/docs/luckystack/ARCHITECTURE_SECRETS.md
docs/SECRET_MANAGER_SERVER_HANDOFF.md               (transient, after external repo went live)
docs/SECRET_MANAGER_PACKAGE_PLAN.md                 (transient)
.lint-unnecessary.out                               (git rm; was accidentally tracked)
```

Note: many `package.json` peer ranges were edited twice (bumped to `^7` for the Prisma 7 attempt, then
reverted to `^6.19.x`). Net Prisma state = 6.19. Net zod state = `^4`. Net typescript state = `^6`.

## Caveats (read before resuming)

- **Concurrent test-AI on the same branch + working tree** (see its `HANDOFF.md` in this folder). It made
  testing fixes in `packages/login/src/session.ts`, `logout.ts`, `packages/devkit/src/typeMap/apiMeta.ts`,
  `packages/sync/src/handleHttpSyncRequest.ts`, `packages/test-runner/src/{runAllTests,customTests}.ts`,
  `src/_providers/socketStatusProvider.tsx`, `docs/ARCHITECTURE_TESTING.md`, `.env_template`. It also fixed
  a build-breaker that this AI's Stage-1 `eslint --fix` introduced in `socketStatusProvider.tsx`. Our
  simultaneous `npm install`s caused transient `node_modules/@prisma/client` races (self-resolved). If both
  sessions keep editing the same files, watch for clobbering. Its detailed entries are in the branch-log
  (00:42, 07:42).
- **Nothing is committed.** To resume on a different machine the branch (incl. all this WIP) must be
  committed + pushed — the user is handling that.
- **`@prisma/adapter-mongodb` 404** and **eslint 10 plugin gap** are external; do not `--force` past them.

## User testing checklist

- [ ] Pull the branch on the laptop, run `npm install`.
- [ ] Confirm green: `npm run lint`, `npm run lint:packages`, `npm run build:packages` (14/14),
      `npx tsc -b` (0), `npm run test:unit` (47 files / 703 tests), `npm run generateArtifacts`.
- [ ] Optional full check before publish: `npm run build` then `npm run pack:dry` (expect 14/14).
- [ ] Confirm `@luckystack/secret-manager` is present and `@luckystack/env-resolver` is gone
      (`ls packages`, grep `env-resolver`).
- [ ] Sanity-run the app if a DB is available: `npm run server` (uses Prisma 6; secret-manager is NOT wired
      into the live boot — documented only, so boot is unaffected).
- [ ] Decide Prisma 7 / ESLint 10 timing (Open Questions) and whether to proceed with Stage 5.
