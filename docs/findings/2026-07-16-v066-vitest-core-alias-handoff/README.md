# v0.6.6 Vitest core-alias handoff validation — 2026-07-16

> AI findings ledger (Findings Protocol).
> Scope: validate an external v0.6.6 consumer handoff against the current framework/scaffold after the v0.7.0 ORM/runtime fixes · Method: current-source comparison, tag comparison, package-export probe, existing gate evidence · Supersedes: —

Last updated: 2026-07-16

| # | Finding | Severity | Status | Since | Resolved | Notes |
|---|---------|----------|--------|-------|----------|-------|
| VA-01 | The scaffold's global Vite alias still rewrites bare `@luckystack/core` to `@luckystack/core/client`, so server-side Vitest tests can receive the client barrel and lose server-only exports such as `tryCatchSync`. | MED | open | 2026-07-16 | — | The relevant v0.6.6 shape is unchanged: `vite.config.ts` still declares the exact-match alias; the current client barrel still omits `tryCatchSync`; a direct current-package probe reports bare=`function`, client=`undefined`. Vitest uses Vite configuration unless a separate test configuration overrides it. Production Node/Bun execution is unaffected. |

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

Therefore the stale Vite alias can likely be removed completely, guarded by:

1. a scaffold regression proving server-side Vitest resolves the bare barrel and can
   call `tryCatchSync`;
2. the existing `@luckystack/core/config` browser-safety graph test;
3. a generated scaffold client build proving no server barrel enters the browser.

No fix was applied during this validation; this ledger records the open framework-side
work without changing consumer or scaffold behavior.

## Earlier v0.7.0 assessment after the fixes

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
