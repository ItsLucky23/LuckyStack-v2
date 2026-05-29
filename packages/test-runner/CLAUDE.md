# @luckystack/test-runner

> AI summary + function INDEX. For deep specs see `docs/` next to this file.

## What this package does

Generated-type-driven test layers voor LuckyStack APIs. Walkt elke endpoint uit de generated `apiMethodMap` en draait vijf progressive layers: contract smoke (Zod-valid input), auth enforcement, rate-limit, crash-resistance fuzz, en per-route custom tests (`<name>_v<N>.tests.ts` naast `_api/`/`_sync/` sources). Elke layer is independent runnable; `runAllTests` orchestreert alles in volgorde en levert een geaggregeerde summary op. Reporter/fixture/layer-extension registries laten consumers eigen checks plug-in zonder de framework te forken.

## When to USE this package

- Je wil elke `_api/*` route automatisch valideren tegen de generated contract zonder per endpoint een testfile te schrijven.
- Je wil in CI verifiëren dat endpoints met `auth.login: true` daadwerkelijk 401 returneren voor unauthenticated requests.
- Je wil rate-limit gedrag (`rateLimit: N`) confirmeren zonder handmatig de `N+1`th request te bouwen.
- Je wil nightly crash-resistance fuzz draaien op alle endpoints om 500-stacks te vangen.
- Je wil custom test-layers, fixtures of een webhook reporter toevoegen aan de standard sweep.

## When to NOT suggest this (yet)

- Voor unit tests van pure functions binnen `_api/*` — gebruik vitest/jest direct, niet deze runner.
- Voor frontend-UI tests — gebruik Playwright/`webapp-testing` skill, deze runner is server-only.
- Wanneer er geen generated `apiMethodMap` beschikbaar is (project gebruikt geen `@luckystack/devkit`).
- Wanneer de target server productie is — fuzz/rate-limit layers maken honderden requests en `/_test/reset` is daar uit.
- Voor sync-event testing via de auto-sweep — die walkt momenteel alleen API endpoints, niet de sync map (sync support voor de auto-layers staat op de roadmap maar is nog niet geleverd). Layer 5 (`runCustomTests` / `<name>_v<N>.tests.ts`) ondersteunt al wél sync routes via per-route testfiles naast `_sync/` sources.

## Function Index

| Function / Export | 1-regel | Deep doc |
|---|---|---|
| `runAllTests({ apiMethodMap, apiMetaMap, apiInputSchemas, baseUrl, ... })` | Orchestrator: draait contract + auth + rate-limit + fuzz + custom (Layer 5) in volgorde, levert een `RunAllTestsSummary`. | → docs/contract-tests.md |
| `runCustomTests(input)` | Layer 5: draait per-route `<name>_v<N>.tests.ts` files naast de `_api/` / `_sync/` sources, levert een `RunCustomTestsSummary`. | → docs/contract-tests.md |
| `discoverCustomTestFiles(srcDir?)` | Walker die elke `<name>_v<N>.tests.ts` onder de configured src dir yields. | → docs/contract-tests.md |
| `logRunAllSummary(summary)` | Pretty-print één `RunAllTestsSummary`. | → docs/extension-hooks.md |
| `walkEndpoints(apiMethodMap)` | Genereert `EndpointDescriptor[]` uit de generated map | → docs/contract-tests.md |
| `runContractCheck({ endpoint, baseUrl, inputFor?, headers? })` | Single-endpoint contract smoke | → docs/contract-tests.md |
| `runContractTests({ apiMethodMap, baseUrl, skip?, inputFor?, headers?, onResult? })` | Full sweep contract layer | → docs/contract-tests.md |
| `runAuthEnforcementCheck({ endpoint, baseUrl, inputFor? })` | Single-endpoint auth check (verwacht 401 zonder token) | → docs/auth-tests.md |
| `runAuthEnforcementTests({ apiMethodMap, apiMetaMap, baseUrl, skip?, inputFor?, onResult? })` | Sweep alle `auth.login: true` endpoints | → docs/auth-tests.md |
| `runRateLimitCheck({ endpoint, baseUrl, rateLimit, inputFor?, headers? })` | Single-endpoint rate-limit assertie | → docs/rate-limit-tests.md |
| `runRateLimitTests({ apiMethodMap, apiMetaMap, baseUrl, skip?, inputFor?, headers?, maxRateLimitToTest?, resetBetweenEndpoints?, resetToken?, onResult? })` | Sweep alle `rateLimit: N` endpoints | → docs/rate-limit-tests.md |
| `runFuzzCheck({ endpoint, baseUrl, headers? })` | Single-endpoint crash-resistance fuzz | → docs/fuzz-tests.md |
| `runFuzzTests({ apiMethodMap, baseUrl, skip?, headers?, onResult? })` | Sweep fuzz layer (nightly CI) | → docs/fuzz-tests.md |
| `resetServerState({ baseUrl, token? })` | POST naar `/_test/reset` om DB+Redis schoon te maken | → docs/rate-limit-tests.md |
| `sampleSchemaInput(schema)` | Genereert Zod-valid sample payload uit een schema | → docs/contract-tests.md |
| `logContractResult(result)` | Pretty-print één `ContractCheckResult` | → docs/extension-hooks.md |
| `logContractSummary(summary)` | Pretty-print aggregate `RunContractSummary` | → docs/extension-hooks.md |
| `registerTestLayer(layer)` | Plug-in custom test-layer (CORS, business rules, multi-tenant) | → docs/extension-hooks.md |
| `listTestLayers()` | Lees alle geregistreerde custom layers | → docs/extension-hooks.md |
| `registerTestFixture(typeKey, fixture)` | Realistic-payload fixtures per typeKey (valid + invalid) | → docs/fuzz-tests.md |
| `getTestFixture(typeKey)` | Lees fixture voor een typeKey | → docs/fuzz-tests.md |
| `registerTestReporter(reporter)` | Plug-in onResult/onSummary/webhookUrl callbacks | → docs/extension-hooks.md |
| `getTestReporter()` | Lees actieve reporter callbacks | → docs/extension-hooks.md |
| `resetTestExtensionsForTests()` | Clear alle registries (alleen voor interne tests) | → docs/extension-hooks.md |
| Type: `EndpointDescriptor` | `{ page, name, version, method, fullPath }` | → docs/contract-tests.md |
| Type: `HttpMethod` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'` | → docs/contract-tests.md |
| Type: `ContractCheckResult` | Single-result shape (status, httpStatus, responseStatus, errorCode, reason, durationMs) | → docs/contract-tests.md |
| Type: `RunContractSummary` | Aggregate shape (total, passed, failed, skipped, results[]) | → docs/contract-tests.md |
| Type: `TestLayer` / `TestLayerInput` / `TestLayerResult` | Custom-layer interface | → docs/extension-hooks.md |
| Type: `TestFixture` | `{ valid: T[], invalid: T[] }` per typeKey | → docs/fuzz-tests.md |
| Type: `TestResult` / `TestSummary` | Aggregate shapes voor extension registry | → docs/extension-hooks.md |
| Type: `TestReporter` | `{ onResult?, onSummary?, webhookUrl?, webhookAuth? }` | → docs/extension-hooks.md |
| Type: `RunContractTestsInput` / `ContractCheckInput` | Inputs voor contract layer | → docs/contract-tests.md |
| Type: `RunAuthEnforcementTestsInput` / `AuthEnforcementCheckInput` | Inputs voor auth layer | → docs/auth-tests.md |
| Type: `RunRateLimitTestsInput` / `RateLimitCheckInput` | Inputs voor rate-limit layer | → docs/rate-limit-tests.md |
| Type: `RunFuzzTestsInput` / `FuzzCheckInput` | Inputs voor fuzz layer | → docs/fuzz-tests.md |
| Type: `ResetServerStateInput` | Input voor `resetServerState` | → docs/rate-limit-tests.md |
| Type: `TestContext` | `{ callApi, callSync, watchStream, session, prisma, expect }` — handed naar elke Layer-5 custom-tests case. | → docs/contract-tests.md |
| `ctx.watchStream(roomCode)` | Open een second-socket (socket B) joined aan `roomCode` om de chunk stream van `broadcastStream`/`streamTo`/`_client_v{N}` te observeren. Returnt `StreamWatcher<TChunk>` met `.chunks[]`, `.stopAt(predicate, timeoutMs?)`, `.waitForCount(n, timeoutMs?)`, `.close()`. Watchers worden auto-closed na elke case. | → docs/contract-tests.md |
| `openStreamWatcher(input)` | Lower-level factory voor `watchStream` — direct bruikbaar buiten een `TestContext` (custom layers, ad-hoc harness scripts). | → docs/contract-tests.md |
| Type: `StreamWatcher<TChunk>` | `{ readonly chunks, stopAt, waitForCount, close }` — observable chunk stream voor één route. | → docs/contract-tests.md |
| Type: `StreamChunkFrame` | Wire-shape van een sync chunk frame (`{ cb, fullName, status: 'stream', ...payload }`). Default chunk type voor `StreamWatcher`. | → docs/contract-tests.md |
| Type: `OpenStreamWatcherInput` | `{ baseUrl, roomCode, token, routeFullName, defaultTimeoutMs? }` voor `openStreamWatcher`. | → docs/contract-tests.md |
| Type: `CustomTestCase` | `{ name, run(ctx) }` — shape die consumers exporteren uit `<name>_v<N>.tests.ts`. | → docs/contract-tests.md |
| Type: `RunAllTestsSummary` | Aggregate result shape voor `runAllTests` (per-layer summaries + totals). | → docs/contract-tests.md |
| Type: `RunCustomTestsSummary` | Aggregate result shape voor `runCustomTests` (per-file resultaten + totals). | → docs/contract-tests.md |

## Config keys (env vars + register* slots)

- `NODE_ENV` (env, server-side) — `/_test/reset` is automatisch beschikbaar wanneer NIET `production`.
- `TEST_RESET_TOKEN` (env, optional, server-side) — wanneer gezet moet `resetServerState({ token })` deze meesturen als `X-Test-Reset-Token`. Verplicht voor staging/preview deploys die het endpoint over het netwerk exposen.
- `RunRateLimitTestsInput.maxRateLimitToTest` (default `50`) — endpoints met hogere `rateLimit` worden geskipt om duizenden requests in CI te vermijden.
- `RunRateLimitTestsInput.resetBetweenEndpoints` (default `false`) — hit `/_test/reset` voor elke endpoint zodat het shared IP-bucket schoon is.
- `registerTestLayer({ name, run })` — custom check per endpoint (CORS, business rules, custom auth-schemes, multi-tenant isolation).
- `registerTestFixture(typeKey, { valid, invalid })` — realistic payloads die de fuzz layer prefereert boven schema-random.
- `registerTestReporter({ onResult?, onSummary?, webhookUrl?, webhookAuth? })` — wire per-result/per-summary callbacks of POST de summary naar een webhook.

## Peer dependencies

- **Required**: `zod@^3.25.0` (peer), `@luckystack/core@^0.1.0` (dependency — leest `getApiMethodMapPath()` voor de default map-locatie).
- **Required server-side**: `@luckystack/server` met `/_test/reset` endpoint gemount (default ingebouwd, gated op `NODE_ENV !== 'production'`).
- **Required generated artefact**: `apiMethodMap.generated.ts` (en `apiMetaMap.generated.ts` voor de auth/rate-limit layers), geproduceerd door `@luckystack/devkit`.
- **Optional**: geen — fixtures, reporters en custom layers zijn pure-JS opt-in.

## Related

- Architecture deep-dives: `/docs/ARCHITECTURE_API.md` (het contract dat deze runner asserteert), `/docs/ARCHITECTURE_PACKAGING.md` (hoe generated maps per preset worden geëmit).
- Consumer quickstart: `./README.md`.
- Devkit (genereert de maps die deze runner consumeert): `packages/devkit/CLAUDE.md`.
- Server (`/_test/reset` endpoint): `packages/server/CLAUDE.md`.
