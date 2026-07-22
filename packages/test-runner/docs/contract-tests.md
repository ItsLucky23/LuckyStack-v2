# Contract Tests

The contract layer is the entry point of `@luckystack/test-runner`. It walks every endpoint that the devkit emits into `apiMethodMap.generated.ts`, fires a single well-formed request, and asserts the response conforms to the framework envelope. It is the cheapest and broadest of the four layers — it does NOT prove business logic, it proves the route exists, decodes input without crashing, and replies with `{ status: 'success' | 'error', errorCode? }`.

## When to use it

- CI on every PR: catches `_api/<page>/<name>_v<n>.ts` files that have a typo in `main`, a broken import, or a renamed Zod field.
- After regenerating the type map (`npx @luckystack/devkit gen`): confirms the routing table the runtime resolves still matches the file system.
- During refactors of `@luckystack/api` request handling: contract failures here are a fast signal that the envelope shape regressed.

## Functions

### `walkEndpoints(apiMethodMap)`

Flatten the three-level generated map (`page -> name -> version -> method`) into a flat list of endpoint descriptors. Used internally by every `run*Tests` sweep and exported so consumers can build custom layers on top of the same iteration order.

Signature:

```ts
walkEndpoints(apiMethodMap: ApiMethodMap): EndpointDescriptor[]

type ApiMethodMap = Record<string, Record<string, Record<string, string>>>;
```

The order is deterministic: it follows `Object.entries` over the generated map, which the devkit emits sorted by page name, then api name, then version. Empty maps return `[]` (not an error).

### `runContractCheck(input)`

Run the contract assertion against one endpoint.

Signature:

```ts
runContractCheck(input: ContractCheckInput): Promise<ContractCheckResult>

interface ContractCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  requestTimeoutMs?: number; // default 5000
}
```

Flow:

1. Build URL: `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}` so trailing slashes on `baseUrl` are tolerated.
2. Build body: `inputFor?.(endpoint) ?? {}`. For `GET` the body is dropped entirely; otherwise it is `JSON.stringify`d.
3. Send the request with `AbortController` wired to `requestTimeoutMs`. A timeout surfaces as a `fetch` error rather than hanging the sweep.
4. Parse the JSON body. Any parse error is a contract failure (the framework always returns JSON).
5. Assert `parsed.status` is exactly `'success'` or `'error'`. Anything else (`null`, `undefined`, missing key, a custom shape) fails with `reason: 'Response missing standard `status` envelope'`.
6. If `parsed.status === 'error'`, assert `parsed.errorCode` is truthy. Missing `errorCode` on an error response is a contract violation — every framework error path is required to set one.

Pass criterion: a response that round-trips through the framework envelope, regardless of whether it's success or a typed error.

### `runContractTests(input)`

Full sweep version of `runContractCheck`. Iterates `walkEndpoints(input.apiMethodMap)` serially and aggregates results.

Signature:

```ts
runContractTests(input: RunContractTestsInput): Promise<RunContractSummary>

interface RunContractTestsInput {
  apiMethodMap: ApiMethodMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  onResult?: (result: ContractCheckResult) => void;
}
```

Behavior:

- **Serial, not parallel.** The runner walks endpoints one by one. This avoids tripping shared rate-limit buckets, keeps log output linear, and stops endpoint-ordering bugs from being masked by races. A pool option may land later; do not assume concurrency.
- **`skip` matching is two-tier.** `skip: ['billing/getInvoice']` skips every version of that endpoint. `skip: ['billing/getInvoice/v2']` skips only v2. Both forms compose: pass both to skip every version AND keep the specific one explicit.
- **`onResult` is fired after every endpoint** including skipped ones, so progress reporters update in real time. Throwing inside `onResult` propagates out of the sweep — wrap your own handler in `tryCatch` if you want it isolated.
- **Skipped results carry `status: 'skipped'` with `reason: 'Explicitly skipped'`** and `durationMs: 0`. They count toward `summary.skipped`, not `passed` or `failed`.

Returned summary:

```ts
interface RunContractSummary {
  total: number;     // results.length, including skipped
  passed: number;
  failed: number;
  skipped: number;
  results: ContractCheckResult[];
}
```

### `sampleSchemaInput(schema)`

Walk a Zod schema and produce a deterministic minimal-valid value. The contract layer does not call this automatically — consumers use it inside a custom `inputFor` when an endpoint's Zod validator rejects an empty object.

Signature:

```ts
sampleSchemaInput(schema: z.ZodTypeAny): unknown
```

Type-to-sample table:

| Zod node | Sample |
| --- | --- |
| `ZodString` | `'test'` |
| `ZodNumber` | `0` |
| `ZodBoolean` | `false` |
| `ZodNull` | `null` |
| `ZodUndefined` | `undefined` |
| `ZodAny` / `ZodUnknown` | `null` |
| `ZodLiteral` | the literal value |
| `ZodOptional` / `ZodNullable` | `undefined` (field omitted in objects) |
| `ZodUnion` | first option, recursively sampled |
| `ZodArray` | `[]` |
| `ZodObject` | object with every non-`undefined` child sampled |
| `ZodRecord` | `{}` |
| `ZodDate` | `new Date().toISOString()` |
| anything else | `null` |

`ZodOptional`/`ZodNullable` returning `undefined` is deliberate — the object branch drops keys whose sample is `undefined`, so optional fields stay absent rather than being sent as `null`. The result is the smallest payload that the validator will accept.

This is NOT a property-based generator. It always returns the same value for the same schema. Swap in `fast-check` if you need randomized fuzz that respects the schema.

### `resolveTestBaseUrl(options?)`

Resolve the live server target for test entrypoints. Priority is: non-empty `TEST_BASE_URL`, a valid integer port from `<cwd>/node_modules/.luckystack/dev-server.json` whose owner PID is still alive, then `fallbackUrl` (default `http://localhost:80`). Generated projects pass `http://localhost:${ports.backend}` as the fallback, so config changes, dev auto-increment hops, and stale crash leftovers remain truthful.

```ts
resolveTestBaseUrl(options?: {
  cwd?: string;
  fallbackUrl?: string;
}): string
```

This helper does not start or probe a server; connection failures remain visible to the actual test layer.

### `resolveTestEnvironment(input?)`

Prepare the **test process** before DB/Redis-backed integration tests run. It first calls core's `loadEnvFiles()`. When `loadProjectConfig` returns a config with a non-empty `secretManager.url`, it dynamically loads the optional `@luckystack/secret-manager` peer and runs `initSecretManager({ ...config.secretManager, source: 'remote' })`.

```ts
await resolveTestEnvironment({
  loadProjectConfig: async () => (await import('./config')).default,
});
```

`runAllTests` calls this automatically through its required `loadProjectConfig` callback. The official scaffolded `scripts/testAll.ts` supplies it. The callback is lazy deliberately: `.env` and `.env.local` must load before `config.ts` reads `LUCKYSTACK_SECRET_MANAGER_URL`.

This is a separate process from the live server. Resolving `DATABASE_URL` during server boot does **not** resolve it for Layer-5 `ctx.prisma` calls. If a secret-manager URL is configured but the package cannot load, resolution fails loudly before any layer runs instead of handing a raw `DATABASE_URL_V<n>` pointer to Prisma.

For a custom Vitest integration setup, call `resolveTestEnvironment` from a setup file before importing modules that construct env-backed clients. Direct Layer-5 callers must pass the same lazy loader to `runCustomTests({ ..., loadProjectConfig })`; it resolves before discovery/import. Both orchestrator APIs reject a missing loader at runtime, including from untyped JavaScript. `runAllTests` uses an internal already-prepared Layer-5 entrypoint, so the custom layer does not reload `.env.local` pointers over freshly resolved values.

## Types

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface EndpointDescriptor {
  page: string;
  name: string;
  version: string;
  method: HttpMethod;
  fullPath: string; // `api/<page>/<name>/<version>`
}

interface ContractCheckResult {
  endpoint: EndpointDescriptor;
  status: 'pass' | 'fail' | 'skipped';
  httpStatus?: number;
  responseStatus?: 'success' | 'error' | 'unknown';
  errorCode?: string;
  reason?: string;
  durationMs: number;
}

interface RunContractSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ContractCheckResult[];
}

interface ResolveTestEnvironmentInput {
  loadProjectConfig?: () => unknown | Promise<unknown>;
}

interface RunCustomTestsInput {
  // other Layer-5 options omitted
  loadProjectConfig: NonNullable<ResolveTestEnvironmentInput['loadProjectConfig']>;
}
```

`responseStatus: 'unknown'` only appears on failed results when the JSON either failed to parse or did not carry a `status` field. `errorCode` is set on pass results when `responseStatus === 'error'` and on fail results when the auth/rate-limit layers' `errorCode` mismatch path runs (contract layer never sets it on fail).

## Result shapes by branch

- **Pass / success**: `{ status: 'pass', httpStatus, responseStatus: 'success', errorCode: undefined, durationMs }`.
- **Pass / typed error**: `{ status: 'pass', httpStatus, responseStatus: 'error', errorCode: '<code>', durationMs }`. A typed framework error still satisfies the contract.
- **Fail / fetch error**: `{ status: 'fail', reason: <Error.message>, durationMs }`. No `httpStatus`. Network refused, DNS failure, or `AbortController` firing all land here.
- **Fail / JSON parse**: `{ status: 'fail', httpStatus, responseStatus: 'unknown', reason: 'JSON parse failed: ...', durationMs }`.
- **Fail / missing envelope**: `{ status: 'fail', httpStatus, responseStatus: 'unknown', reason: 'Response missing standard `status` envelope', durationMs }`.
- **Fail / error without code**: `{ status: 'fail', httpStatus, responseStatus: 'error', reason: 'Error response missing `errorCode`', durationMs }`.
- **Skip**: `{ status: 'skipped', durationMs: 0, reason: 'Explicitly skipped' }`.

## Examples

### CI sweep with default inputs

```ts
import { apiMethodMap } from './generated/apiMethodMap.generated';
import {
  runContractTests,
  logContractResult,
  logContractSummary,
  resolveTestBaseUrl,
} from '@luckystack/test-runner';
import { ports } from './config.ports';

const summary = await runContractTests({
  apiMethodMap,
  baseUrl: resolveTestBaseUrl({ fallbackUrl: `http://localhost:${ports.backend}` }),
  onResult: logContractResult,
});

logContractSummary(summary);

if (summary.failed > 0) {
  process.exit(1);
}
```

### Endpoint-specific input via `inputFor`

Most validators reject `{}`. Use `inputFor` to return a shape the validator will accept for the specific endpoints that need it; fall through to `{}` for everything else.

```ts
import { sampleSchemaInput } from '@luckystack/test-runner';
import { sendInviteSchema } from 'src/organization-settings/_api/sendInvite_v1';

await runContractTests({
  apiMethodMap,
  baseUrl,
  inputFor: (endpoint) => {
    if (endpoint.fullPath === 'api/organization-settings/sendInvite/v1') {
      return sampleSchemaInput(sendInviteSchema);
    }
    return {}; // default
  },
});
```

### Single-endpoint debug loop

```ts
import { runContractCheck, logContractResult } from '@luckystack/test-runner';

const result = await runContractCheck({
  endpoint: {
    page: 'billing',
    name: 'getInvoice',
    version: 'v1',
    method: 'POST',
    fullPath: 'api/billing/getInvoice/v1',
  },
  baseUrl: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:80',
  inputFor: () => ({ invoiceId: 'inv_1' }),
  headers: { Cookie: 'session=abc' },
  requestTimeoutMs: 15000, // bump for slow endpoints
});

logContractResult(result);
```

### Skip noisy endpoints

```ts
await runContractTests({
  apiMethodMap,
  baseUrl,
  skip: [
    'uploads/fileUpload',         // needs multipart, not JSON
    'billing/getInvoice/v1',      // deprecated, kept for backwards compat
  ],
});
```

## Edge cases and gotchas

- **`GET` endpoints ignore `inputFor`.** The handler still calls `inputFor`, but the body is dropped before `fetch` sees it. Query-string fuzz is not in scope for the contract layer.
- **`headers` are merged after `Content-Type: application/json`.** If you pass `Content-Type` yourself you will override the default; the framework parses based on the header so this is intentional.
- **`baseUrl` trailing slash is normalized once.** `http://localhost/` and `http://localhost` produce identical requests. Embedded `//` further down the path is not collapsed.
- **`requestTimeoutMs` is per-request, not per-sweep.** A 30-endpoint sweep with the default 5000ms timeout can run for over two minutes if every endpoint stalls. The sweep itself has no overall timeout.
- **An endpoint that returns `204 No Content`** fails the contract because there is no JSON to parse. The framework never emits 204 from `_api/*`; this only happens if you've added a custom route handler that intercepts the path.
- **A response with `status: 'success'` and an extra `errorCode`** still passes. The contract layer only validates the envelope keys it cares about; unknown extras are ignored.
- **Endpoints absent from `apiMetaMap` are still walked.** The contract layer never reads `apiMetaMap`. Auth and rate-limit layers do — see those docs.
