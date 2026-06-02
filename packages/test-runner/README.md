# @luckystack/test-runner

> Generated-type-driven test layers for [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2). Walks every endpoint in your `apiMethodMap.generated.ts` and runs four progressive test layers: contract smoke (Zod-valid input), auth enforcement, rate-limit, and crash-resistance fuzz.

## Install

```bash
npm install --save-dev @luckystack/test-runner zod
```

## Quickstart

Run all four layers against a running server:

```ts
import {
  runContractTests,
  runAuthEnforcementTests,
  runRateLimitTests,
  runFuzzTests,
  resetServerState,
  logContractSummary,
} from '@luckystack/test-runner';
import { apiMethodMap } from './src/_sockets/apiMethodMap.generated';
import { apiMetaMap } from './src/_sockets/apiMetaMap.generated';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:80';
const contract = await runContractTests({ apiMethodMap, baseUrl });
logContractSummary(contract);

const auth = await runAuthEnforcementTests({ apiMethodMap, apiMetaMap, baseUrl });
const rate = await runRateLimitTests({ apiMethodMap, apiMetaMap, baseUrl });
const fuzz = await runFuzzTests({ apiMethodMap, baseUrl });

await resetServerState({ baseUrl });
```

Each layer is independently runnable — you can skip the ones that don't apply or rearrange them.

## Layers

| Layer | What it asserts |
| --- | --- |
| **Contract** | A Zod-valid input payload reaches `main` and returns `{ status: 'success' }` (or a typed failure status). Catches schema/route mismatches. |
| **Auth enforcement** | Endpoints flagged `auth.login: true` reject unauthenticated requests with the framework's standard 401 shape. |
| **Rate limit** | Endpoints with `rateLimit: <N>` reject the `(N + 1)`th request inside the window. |
| **Fuzz** | Bad/random inputs never crash the server (still returns a typed error response, never 500 with a stack). |

The fuzz layer is intentionally exhaustive and slow — wire it into nightly CI rather than every PR.

## Server hooks it depends on

- `/_test/reset` endpoint — served by `@luckystack/server` outside production (gated on `NODE_ENV !== 'production'` and an optional `TEST_RESET_TOKEN`). Used by `resetServerState` to clear DB + Redis between layers. Make sure `TEST_RESET_TOKEN` is set in any non-prod environment that is reachable over the network.
- `apiMethodMap.generated.ts` — produced by `@luckystack/devkit` from your `_api/*` files. Defaults are read via `getApiMethodMapPath()` from `@luckystack/core`.

## Public API

| Export | Purpose |
| --- | --- |
| `walkEndpoints(apiMethodMap)` | Returns `EndpointDescriptor[]` from the generated map. |
| `runContractCheck(input)` / `runContractTests(input)` | Single endpoint / full sweep. |
| `runAuthEnforcementCheck(input)` / `runAuthEnforcementTests(input)` | Auth layer. |
| `runRateLimitCheck(input)` / `runRateLimitTests(input)` | Rate-limit layer. |
| `runFuzzCheck(input)` / `runFuzzTests(input)` | Fuzz layer. |
| `resetServerState(input)` | POST to `/_test/reset`. |
| `sampleSchemaInput(schema)` | Generate a Zod-valid sample payload. |
| `logContractResult` / `logContractSummary` | Pretty-printers. |

Types: `EndpointDescriptor`, `HttpMethod`, `ContractCheckResult`, `RunContractSummary`, plus per-layer input types.

## Related architecture docs

- [`docs/ARCHITECTURE_API.md`](../../docs/ARCHITECTURE_API.md) — the contract this runner asserts against.
- [`docs/ARCHITECTURE_PACKAGING.md`](../../docs/ARCHITECTURE_PACKAGING.md) — how generated maps are emitted per preset.

## Dependencies

- Peer (canonical ranges, standardized 2026-05-07):
  - `zod@^3.25.0`

## License

MIT — see [LICENSE](../../LICENSE).
