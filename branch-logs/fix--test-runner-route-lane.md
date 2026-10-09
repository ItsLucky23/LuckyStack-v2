# Branch log — fix/test-runner-route-lane

> Fixes six defects reported against `@luckystack/test-runner` 0.10.1 (from the flexbuddy route lane). Started on the local `main` (0.9.1, the local `origin` mirror was behind) with the 0.10.1 pieces recovered from the published sourcemaps. Then rebased onto GitHub `main` (`6ae8e25`, v0.10.1), and released as v0.10.2.

## 2026-10-09 12:30 — Six test-runner defects: sync over socket + sync sweeps, GET input, filter, results file, scoped reset, custom-layer sample input

**User prompt:** pasted defect report (6 items) + "ook 1 meenemen indien die te fixen valt" / "kies in jouw ogen de beste oplossing" / "jouw advies".

**What I did:**
1. **callSync + sync sweeps** — `callSync` follows `transport.invocation` (socket by default, per-call override, auto-join of the receiver). The sweep layers walk sync routes via devkit's new `syncMetaMap` + `syncInputSchemas` (built by a sub-agent) over a socket probe transport. One throwaway room per run that the sweep session joins. CSRF stays on HTTP. Shared socket wire: `testSocket.ts`.
2. **GET input** — the probe encodes the payload in `__luckystack_data` (core `buildRoutedGetUrl`, taken from the 0.10.1 sourcemap).
3. **Filter** — `selectEndpoints` filters before any request; all five layers + custom receive `filter`. Report-side re-filtering removed.
4. **Results file** — `runAllTests` writes `test-results.json` itself (`outputFile` / `TEST_OUTPUT_FILE`, `false` = off). Repo script no longer writes it; the template gets it automatically.
5. **Reset** — `/_test/reset?only=…` (shared list in core, 400 on unknown/empty). The runner only sends `only=rateLimits`. Legacy default unchanged. ADR 0064.
6. **Custom layer** — `TestLayerInput.sampleInput` (+ `kind`-aware `method`), `runRegisteredLayers` accepts schemas/`inputFor`/`syncMetaMap`/`filter`.

**Verification:** unit (2119/2119, incl. new tests for probe/GET, selectEndpoints, socket transport against an in-process socket.io, reset `only`, outputFile, filter, bookend scope), `npm run build` 17/17 + app, `lint` + `lint:packages` clean. Live against the branch environment: reset 403/200/400 behaves as expected. Anonymous sweep: sync routes reached over the socket. Authenticated sweep: 106 passed / 0 failed, sync contract 5/5 pass (membership works). The session survives `only=rateLimits` and a full sweep with logout skipped.

**Files touched:** packages/core/src/{routedDataQuery,testResetTargets,index,client}.ts · packages/server/src/httpRoutes/testResetRoute(.test).ts · packages/devkit/src/{typeMapGenerator.ts,typeMap/emitterArtifacts.ts,typeMap/syncRouteMaps.test.ts} · packages/test-runner/src/* (probe/transport/socket/helpers/all run* layers/customTests/runAllTests/runRegisteredLayers/extensionRegistry/types/walkEndpoints + tests) · scripts/testAll.ts · packages/create-luckystack-app/template/scripts/testAll.ts · docs + CHANGELOGs (test-runner, server, core, devkit, create-luckystack-app) · docs/decisions/0064.

**Notes:**
- Out of scope, reported: the contract sweep also calls logout routes with the sweep session (that is what logged out the first live run, not the reset). The bookend comments claimed DB cleanup, which was false; the comments are now corrected, the behaviour is unchanged.
- The ADR was written as 0057, which collided with the 0.9.2 line (0057–0063 already existed there). It moved to 0064 during the rebase; it was never published under the old number.
