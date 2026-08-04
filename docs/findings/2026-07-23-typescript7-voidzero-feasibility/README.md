# TypeScript 7 and VoidZero feasibility — 2026-07-23

> AI findings ledger. Status of every item is tracked here (Findings Protocol).
> Scope: LuckyStack compiler, lint, build, test, packaging, and scaffold compatibility · Sources: repository source/manifests, npm registry metadata, and official TypeScript/VoidZero documentation · Supersedes: —

Last updated: 2026-08-04 (re-verified against current registry state; see "Re-verification 2026-08-04")

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| TV-01 | `typescript@7.0.2` is not a safe drop-in replacement because its stable Compiler API and `tsserver` are not available yet, while LuckyStack imports the TypeScript API directly in 13 source/script files | HIGH | open | 2026-07-23 | — | `packages/devkit/**`, both `generateGraph.mjs` copies |
| TV-02 | Current `typescript-eslint` releases reject TypeScript 7 (`>=4.8.4 <6.1.0`) | HIGH | open | 2026-07-23 | — | Checked `typescript-eslint` / `@typescript-eslint/typescript-estree` 8.65.0 |
| TV-03 | A side-by-side TS7 CLI benchmark is feasible without changing LuckyStack's supported compiler/API contract | MED | open | 2026-07-23 | — | Requires a user-approved isolated dependency install |
| TV-04 | A full Vite+ migration is currently invasive and beta: it aliases Vite, pins Vitest, and its Node range excludes the current Node 22.14 environment | MED | open | 2026-07-23 | — | `vite-plus@0.2.6`; requires `^20.19 || ^22.18 || >=24.11` |
| TV-05 | Adopting Rolldown separately would duplicate the frontend bundler already shipped by LuckyStack's Vite 8 | LOW | duplicate | 2026-07-23 | 2026-07-23 | `vite@8.0.16` depends on `rolldown@1.0.3` |
| TV-06 | Oxlint is the most promising first VoidZero pilot, but must initially run beside ESLint until LuckyStack's custom rules and plugin behavior have parity evidence | MED | open | 2026-07-23 | — | VoidZero claims ESLint-plugin compatibility and type-aware linting via tsgo |
| TV-07 | tsdown supports TS7 and could replace tsup eventually, but its maturity and newer Node floor conflict with a production migration today | MED | open | 2026-07-23 | — | `tsdown@0.22.13`; current LuckyStack supports Node 20 |

## Compatibility assessment

| Surface | TS7 readiness | Reason |
| --- | --- | --- |
| `tsc -b` typecheck | Pilot-ready | Build mode/project references are marked complete; this is where the native speedup applies. |
| `@luckystack/devkit` + graph generation | Blocked | Direct Compiler API usage; TS7's API is explicitly not ready and its package root no longer exports the TS6 API. |
| ESLint/type-aware lint | Blocked | `typescript-eslint@8.65.0` has a `<6.1.0` TypeScript peer range. |
| Vite/Vitest | Compatible in principle | They do not require the TS compiler for normal transpilation; Vite 8 already uses Rolldown. |
| Prisma | Compatible in principle | Prisma's TypeScript range is `>=5.1.0`. |
| tsup declaration builds | High-risk / unproven | tsup's broad peer range is not sufficient evidence: declaration generation consumes TypeScript compiler internals. |
| IDE language service | Not migration-ready | TS7 ships only a `tsc` binary; language-service support is still in progress and there is no `tsserver` binary. |
| Consumer scaffold | Blocked | It currently pins TS 5.7 and consumes devkit/tooling contracts that have not been made TS7-safe. |

## Recommendation

1. **Do not bump the canonical `typescript` dependency to 7 yet.** The headline speedup does not compensate for losing compiler-API, lint, declaration-build, and IDE guarantees.
2. **Run an isolated side-by-side benchmark first.** Keep TS6 canonical; add TS7 under an alias only for a non-blocking `tsc -b` comparison. Compare diagnostics, emitted declarations, cold/forced timings, and complete `npm run build` wall-clock time.
3. **Pilot Oxlint independently.** Use it as a fast additional pass, not an ESLint replacement, until all custom LuckyStack rules and React/i18n/import/a11y plugins produce equivalent results.
4. **Defer full Vite+.** Revisit after beta, Node-range, Vitest pinning, custom proxy/plugin, and package-build parity are proven. Its task cache may eventually help the 17-package monorepo, but adopting the entire toolchain now has more migration surface than demonstrated benefit.
5. **Reassess TS7 when either** its Compiler API is ready and `typescript-eslint` supports it, **or** a deliberate dual-compiler architecture (TS7 CLI plus pinned TS6 API) has passed a sustained CI trial.

## Download/performance claim

The npm downloads endpoint reported roughly **240 million downloads for the `typescript` package** in the checked week, not 15 million. That figure is package-wide and cannot establish TS7-specific adoption. The native compiler's roughly 8–12× typecheck claim is credible for compiler work, but LuckyStack's end-to-end build also includes code generation, 17 package builds, Vite/Rolldown, server bundling, and linting, so the full workflow will improve by materially less unless those stages migrate too.

## Re-verification 2026-08-04

Every blocking reason was re-checked against the current npm registry state. **No item changed status**; the recommendation stands unchanged. Version drift since 2026-07-23:

| Item | Checked 2026-07-23 | State 2026-08-04 | Effect |
| --- | --- | --- | --- |
| TS7 release | `typescript@7.0.2` latest | still `7.0.2` latest (only `7.1.0-dev.*` nightlies since); `latest` unchanged, `next` = `7.1.0-dev.20260804.1` | No stable-API progress; TV-01 unchanged |
| TS7 package shape | Compiler API absent | `exports` still only `.` → `lib/version.cjs` plus `./unstable/*` (fs, ast, sync, async, proto); `bin` is `tsc` only — no `tsserver` | TV-01 + the devkit/IDE rows confirmed verbatim |
| TV-02 lint | `typescript-eslint@8.65.0`, peer `>=4.8.4 <6.1.0` | `8.66.0`, peer range **identical** | Still blocked |
| TV-04 Vite+ | `vite-plus@0.2.6`, Node `^20.19 \|\| ^22.18 \|\| >=24.11` | `0.2.7`, Node range **identical**; still ships pinned `vitest@4.1.10` + `@vitest/*` deps | Still beta + still excludes the local Node 22.14 |
| TV-05 Rolldown | `vite@8.0.16` → `rolldown@1.0.3` | `vite@8.2.0` → `rolldown@~1.2.0` | Duplicate verdict unchanged |
| TV-06 Oxlint | best first pilot | `oxlint@1.77.0`, Node `^20.19 \|\| >=22.12` — compatible with the repo's Node floor | Still the recommended small pilot |
| TV-07 tsdown | `0.22.13`, newer Node floor | `0.22.14`, Node floor now `^22.18 \|\| >=24.11` — **Node 20 dropped entirely** | Conflict got *worse*: root `engines.node` is `>=20.0.0`, scaffold `>=20.19.0` |

Repo-side facts re-confirmed: root `typescript` is `^6.0.0` (latest TS6 = `6.0.3`), the scaffold template still pins `~5.7.3`, direct TypeScript-API imports still live in `packages/devkit/src/**` plus both `generateGraph.mjs` copies, and the local runtime is Node v22.14.0.

**Conclusion:** the reasons for not adopting TS7 or the VoidZero toolchain today are unchanged and, for tsdown, slightly stronger. Next natural re-check trigger: a `typescript` stable release beyond 7.0.2 that ships a documented Compiler API, or a `typescript-eslint` release whose peer range admits 7.x.

**User decision 2026-08-04:** hold on everything — TS7, Vite+, Rolldown, Oxlint, tsdown. Recommendation 3 (the standalone Oxlint pilot) is explicitly deferred too, so no VoidZero tooling is introduced for now, not even as an additional non-blocking pass. Revisit only on the re-check trigger above or on an explicit user request.

## Ecosystem note

VoidZero announced on 2026-06-04 that it is **joining Cloudflare**; this is stronger than a partnership. Vite, Vitest, Rolldown, Oxc, and Vite+ remain MIT-licensed and led by the existing team.
