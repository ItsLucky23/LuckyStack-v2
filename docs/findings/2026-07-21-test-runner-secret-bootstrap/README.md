# Test-runner secret bootstrap — 2026-07-21

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: verify an external consumer diagnosis against v0.7.x and trace the official test-runner process · Method: current/tag source comparison + bootstrap call-flow review · Supersedes: —

Last updated: 2026-07-21

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| TR-SM-01 | The live server resolves secret pointers only in its own process; `runAllTests` had no env/secret bootstrap before Layer-5 modules or direct Prisma/Redis access. | HIGH | fixed | 2026-07-21 | 2026-07-21 | `packages/test-runner/src/resolveTestEnvironment.ts`, ADR 0032; regression tests cover ordering and fail-fast config validation. |

## Detail

The incoming “missing token” diagnosis was incorrect. A server process resolving
`DATABASE_URL=DATABASE_URL_V1` cannot mutate the separate test process. The test
runner loaded env files transitively through core but never called the optional
secret manager, so direct `ctx.prisma` access could receive the pointer as though
it were a Mongo URL.

The fix gives `runAllTests` a lazy consumer-config loader. It loads env files,
then config, then optional remote secret resolution before any layer executes.
The scaffolded test entry supplies the loader. Configured-but-missing or malformed
secret-manager setup fails before tests rather than leaking a pointer downstream.
