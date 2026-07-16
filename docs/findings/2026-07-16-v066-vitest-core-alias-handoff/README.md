# v0.6.6 Vitest core-alias handoff validation — 2026-07-16

> AI findings ledger (Findings Protocol).
> Scope: validate and resolve an external v0.6.6 consumer handoff against the current framework/scaffold after the v0.7.0 ORM/runtime fixes · Method: current-source/tag comparison, package-export probe, permanent regressions, real-registry scaffold install/typecheck/build/boot, full repo gates · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---------|----------|--------|-------|----------|-------|
| VA-01 | The scaffold's global Vite alias still rewrites bare `@luckystack/core` to `@luckystack/core/client`, so server-side Vitest tests can receive the client barrel and lose server-only exports such as `tryCatchSync`. | MED | fixed | 2026-07-16 | 2026-07-16 | Removed the obsolete alias after config moved to `/config`. Regression guards pin the absence of the rewrite, real bare-barrel `tryCatchSync` execution under Vitest, and explicit `/client`/`/config` browser imports. A real-registry scaffold typechecked, built, executed Drizzle CRUD, booted, and returned 200 health checks. |
| VA-02 | The built `@luckystack/core/client` entry still statically reaches a split chunk containing `node:async_hooks`, producing a browser-build warning despite source-level browser-safe imports. | MED | fixed | 2026-07-16 | 2026-07-16 | Moved `AsyncLocalStorage` identity state behind a server-only module while keeping the browser-reachable registry free of Node builtins. `checkClientBundle.mjs` now walks the emitted `dist/client.js` chunk graph and fails on any reachable Node builtin; it reports 5 files and 0 builtins. Real root and scaffold production builds are warning-free. |

## Current assessment

The external handoff's symptom and root cause still match the current scaffold. It is
not caused by consumer code, and TypeScript can remain green because the source import
is typed against the bare barrel while Vitest rewrites the runtime module.

The handoff's proposed fix A (also export `tryCatchSync` from `/client`) would repair the
reported helper but not the general class: the next server-only bare-barrel export would
fail in the same way. Its fix B (split client/server Vitest projects) is structurally
sound when a project intentionally mixes both test environments, but the current
framework has a simpler upstream option that did not exist in v0.6.6:

- The scaffold's `config.ts` now imports runtime config APIs from the browser-safe
  `@luckystack/core/config` subpath.
- Remaining bare-core imports in `config.ts` are type-only and erase at build time.
- Scaffold client modules already import `@luckystack/core/client` explicitly.

Therefore the stale Vite alias was removed completely and is guarded by:

1. a scaffold regression proving server-side Vitest resolves the bare barrel and can
   call `tryCatchSync`;
2. a source guard requiring browser runtime imports to use explicit `/client` or
   `/config` entries;
3. the existing `@luckystack/core/config` browser-safety graph test;
4. a real-registry generated scaffold typecheck, client/server build, ORM probe,
   production boot, and health checks.

The first real scaffold build also separated VA-02 from the alias fix: `core/client.js`
already reached an `async_hooks`-bearing tsup chunk before the alias was removed. The
follow-up moved only request-identity storage into a server-only module and added a
post-build graph check against the actual emitted client chunks. The core client graph
now reaches five emitted files and zero Node builtins; both the repository and a real
registry-installed scaffold build without the former warning.

## Final v0.7.0 assessment after the fixes

The older release blockers are no longer open:

- monorepo production bundle: fixed and full build passes;
- secret-resolution policy reset/stale URLs: fixed with complete config reconstruction
  and blast-radius assertions for auth, session, rate limiting, localhost policy, URLs,
  and CORS;
- missing Prisma/Drizzle deep coverage: fixed with real three-level fixtures and direct
  Node/Bun projection gates;
- unsafe Date inputs: fixed by rejecting `Date` transport-input declarations and
  requiring explicit ISO strings;
- ORM/runtime claim: backed by real CRUD, nested Date serialization, production boot,
  and health checks for Prisma/Drizzle/MikroORM on Node and Bun (SQLite release gate;
  Prisma also retains its broader four-database runtime matrix).
