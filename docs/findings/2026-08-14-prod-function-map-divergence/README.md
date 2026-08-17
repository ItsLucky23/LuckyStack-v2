# Production function-map divergence — 2026-08-14

> Triggered by a deployed-build `TypeError` on `functions.sleep.sleep(...)` in a real 0.8.x consumer, then traced to the generator that emits `server/prod/generatedApis.*.ts`.

Last updated: 2026-08-14

| # | Finding | Severity | Status | Since | Resolved | Notes / link |
|---|---------|----------|--------|-------|----------|--------------|
| 1 | Production map generator ignored `paths.serverFunctionDirs` and never scanned `shared/`, so `functions.sleep` / `functions.tryCatch` were `undefined` in every deployed build | HIGH | fixed | 2026-08-14 | 2026-08-14 | Root cause of the reported crash. Discovery now goes through `collectFunctionModules()`. ADR 0046. Regression coverage: `packages/devkit/src/functionRegistry.test.ts`. |
| 2 | Production map keyed every module on `path.basename()`, flattening nested folders (`shared/rbac/engine.ts` -> `functions.engine`) against dev + generated types | HIGH | fixed | 2026-08-14 | 2026-08-14 | Same generator, independent defect; not yet hit in production because no consumer had nested function folders. `renderFunctionsMap()` now emits a nested literal. |
| 3 | Two function modules sharing a filename in different subdirectories silently overwrote each other in the production map | MEDIUM | fixed | 2026-08-14 | 2026-08-14 | Collapsed into finding 2; discovery now throws a named conflict and the build exits 1. |
| 4 | `areEquivalentFunctionEntries` compared namespaces shallowly, so a nested map would have failed multi-preset composition at boot | MEDIUM | fixed | 2026-08-14 | 2026-08-14 | Found while fixing 2 — would have re-broken ADR 0042 one level deeper. Comparison is now recursive. `packages/server/src/runtimeMapsLoader.test.ts`. |
| 5 | Type-map generator did not consult the `RoutingRules.ignore` predicate when walking function roots, unlike the dev loader | LOW | fixed | 2026-08-14 | 2026-08-14 | Third divergence in the same class; removed by routing all three layers through one walk. |
| 6 | `resolveFromRoot` is imported but unused in `scripts/generateServerRequests.ts` | LOW | fixed | 2026-08-14 | 2026-08-14 | Pre-existing, unrelated to this scan. `scripts/` sits outside every `lint:*` glob, so no rule catches it — worth revisiting separately. |
| 8 | `packages/devkit/src/typeMap/{wireProjectionEdges,transportInput,tsProgram}.test.ts` hit the 5000ms default timeout under full-suite load (~1 run in 3) | MEDIUM | fixed | 2026-08-14 | 2026-08-14 | **Pre-existing** — reproduced on a clean tree at HEAD with every change stashed. Raised to MEDIUM on measurement: 8 files drive the real TypeScript compiler (each builds its own `ts.Program`, since vitest's per-file module registry defeats `getServerProgram`'s cache), and individual cases measure 1.5–2.7s on an IDLE machine — the 5s default never had real margin. Because releases publish through CI, this was failing ~1 in 3 release runs on work unrelated to the change. Fixed by `testTimeout: 30_000` in `vitest.config.ts` (mirrors the integration config's existing 20000). Verified 9/9 consecutive full-suite runs green. |
| 7 | `packages/test-runner/src/runAllTests.test.ts` fails intermittently under the full suite (5s timeout, then a sibling assertion reads a Cookie value it never set) | LOW | fixed | 2026-08-14 | 2026-08-14 | Root cause: `buildAuthHeaders` does a real `await import('@luckystack/login')` and the test never mocked it — a ~600ms cold package load against ~2ms for every other case, which overran the 5s timeout under parallel load. The timed-out run's pending promise then wrote into the NEXT test's freshly-cleared mocks, which is why test 2 read test 1's `my_cookie`. Mocking `@luckystack/login` + `getCsrfConfig` makes the file deterministic (612ms → 2ms) and adds the two CSRF-header assertions that path never had. |

## Result

One generator carried two independent defects, both invisible to every local signal. `runtimeMapsLoader` delegates to the devkit loader in development, so the broken artifact is only ever loaded in production — which is why dev, `tsc`, `lint`, and the full unit suite were all green while deployed handlers crashed.

The fix is structural rather than arithmetic: discovery and key derivation now live in `packages/devkit/src/functionRegistry.ts`, and the dev loader, the type-map generator, and both production generators (framework + `create-luckystack-app` template) call it. Findings 1, 2, 3 and 5 disappear as a class rather than individually.

Verified end-to-end: this repository's production map went from 4 modules to 10 (`sleep`, `tryCatch`, `sentrySetup`, `serviceRoute`, `socketEvents`, `responseNormalizer` were all missing); a temporary `shared/rbac/engine.ts` emitted identically nested into `apiTypes.generated.ts` and `generatedApis.*.ts`; a deliberate duplicate key failed the build with exit code 1; and the shipped template generator was run inside a scaffolded project, which now emits `shared/sleep` + `shared/tryCatch` where it previously emitted neither.

## Scope note

Findings 6 and 7 were noticed during verification and are unrelated to the function-injection defect. Both were closed on user request in a follow-up pass. Finding 7 turned out not to be an ordinary flake: the failure was deterministic given enough load, and the second failing assertion was a downstream effect of the first test's timed-out promise writing into cleared mocks — worth remembering, because "passes in isolation, fails in the suite" read as flakiness until the leaked `my_cookie` value pinned the mechanism.

Finding 8 surfaced while re-verifying finding 7. It is pre-existing (reproduced at HEAD with everything stashed) and was closed in a follow-up pass because a release that publishes through CI cannot tolerate a ~1-in-3 red run on unrelated work. The measurement is the point: those cases cost 1.5–2.7s on an idle machine, so vitest's 5s default was never an appropriate hang-detector for a suite that drives `tsc`.

Still open elsewhere: `scripts/` is covered by no `lint:*` glob, which is why finding 6 survived until a manual read. That gap is not tracked here.
