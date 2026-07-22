# Test-runner env/secret-bootstrap implementation review — 2026-07-21

> AI findings ledger. Scope: review the uncommitted ADR 0032 test-process env/secret bootstrap, package API, root/scaffold entrypoints, optional-peer metadata and Layer-5 import timing. Supersedes: —

Last updated: 2026-07-21

## Status ledger

| ID | Finding | Severity | Status | Found | Resolved | Evidence / resolution |
|---|---|---:|---|---|---|---|
| TR-ENV-01 | The independently exported `runCustomTests()` path could still import Layer-5 modules and expose `ctx.prisma` without running the new env/secret bootstrap. | **MEDIUM** | **fixed** | 2026-07-21 | 2026-07-21 | Both public orchestrators now require the lazy config loader in their TypeScript contract and reject omission by untyped callers. `runCustomTests` resolves before discovery/import; `runAllTests` calls a package-internal prepared entrypoint so Layer 5 does not reload `.env.local` pointer literals over freshly resolved values. Regressions cover direct/prepared and fail-closed paths. |

## Review notes

The ADR 0032 core flow is otherwise coherent:

- `loadEnvFiles()` precedes the lazy consumer-config callback.
- A non-empty `secretManager.url` requires a valid token shape and dynamically loads the optional peer.
- `source: 'remote'` is applied last, so consumer config cannot downgrade fail-fast test bootstrap to local/hybrid.
- Prisma/Redis clients remain lazy until after resolution; generated API maps/schemas do not value-import consumer config or construct clients.
- Root and scaffold `scripts/testAll.ts` both pass the required lazy default-config loader; direct orchestrator callers cannot omit it silently.
- Configured-but-unloadable secret-manager fails before any layer; a project without that config keeps the plain local-env path.
- Optional peer metadata and lockfile representation match the runtime dynamic import.

## Verification

| Check | Result (2026-07-21) |
|---|---|
| `resolveTestEnvironment.test.ts` | **PASS** |
| `runAllTests.test.ts` | **PASS** |
| `customTestsEnvironment.test.ts` | **PASS** — direct + already-prepared paths |
| Test-runner targeted set | **PASS** — 26/26, including typed and untyped missing-loader rejection |
| Full unit suite | **PASS** — 1907/1907 across 176 files |
| Package/root lint + full build | **PASS** — 17/17 packages plus TypeScript, Vite and server bundle |
