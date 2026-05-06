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
  walkEndpoints,
  runContractTests,
  runAuthEnforcementTests,
  runRateLimitTests,
  runFuzzTests,
  resetServerState,
  logContractSummary,
} from '@luckystack/test-runner';

const endpoints = await walkEndpoints();

const contract = await runContractTests({ endpoints, baseUrl: 'http://127.0.0.1:80' });
logContractSummary(contract);

const auth = await runAuthEnforcementTests({ endpoints, baseUrl });
const rate = await runRateLimitTests({ endpoints, baseUrl });
const fuzz = await runFuzzTests({ endpoints, baseUrl });

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

- `/_test/reset` endpoint — exposed by `@luckystack/server` only when `ProjectConfig.test.enabled` is true. Used by `resetServerState` to clear DB + Redis between layers.
- `apiMethodMap.generated.ts` — produced by `@luckystack/devkit` from your `_api/*` files.

## Public API

| Export | Purpose |
| --- | --- |
| `walkEndpoints()` | Returns `EndpointDescriptor[]` from the generated map. |
| `runContractCheck(input)` / `runContractTests(input)` | Single endpoint / full sweep. |
| `runAuthEnforcementCheck(input)` / `runAuthEnforcementTests(input)` | Auth layer. |
| `runRateLimitCheck(input)` / `runRateLimitTests(input)` | Rate-limit layer. |
| `runFuzzCheck(input)` / `runFuzzTests(input)` | Fuzz layer. |
| `resetServerState(input)` | POST to `/_test/reset`. |
| `sampleSchemaInput(schema)` | Generate a Zod-valid sample payload. |
| `logContractResult` / `logContractSummary` | Pretty-printers. |

Types: `EndpointDescriptor`, `HttpMethod`, `ContractCheckResult`, `RunContractSummary`, plus per-layer input types.

## Dependencies

- Peer: `zod`

## License

MIT — see [LICENSE](../../LICENSE).
