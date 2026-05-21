# Fuzz Tests

The fuzz layer is the crash-resistance net. It feeds every endpoint a fixed catalogue of malformed payloads — wrong types, oversized strings, deeply nested objects, prototype-pollution attempts — and asserts the server never returns 5xx with a stack and never returns a body that escapes the framework envelope. It is intentionally exhaustive and slow; wire it into nightly CI, not into every PR.

Pass criterion: across every probe, the server replies with a 1xx/2xx/3xx/4xx status code AND a JSON body of `{ status: 'success' | 'error', errorCode? }`. Any 5xx, any non-JSON body, any non-envelope JSON, or any `error` without an `errorCode` is a fail and the probe loop short-circuits to report the offending payload.

## Functions

### `runFuzzCheck(input)`

Single-endpoint variant.

Signature:

```ts
runFuzzCheck(input: FuzzCheckInput): Promise<ContractCheckResult>

interface FuzzCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number; // default 5000
}
```

Flow:

1. Iterate the built-in `JUNK_PAYLOADS` list serially.
2. For each payload, POST/PUT/DELETE it to `${baseUrl}/${endpoint.fullPath}` (or send no body on GET). The body is `JSON.stringify(payload)` so values that lose information under stringify (e.g. `undefined` keys, `NaN`) round-trip through the wire encoding the same as in production.
3. After each request:
   - **No response (fetch error, abort, DNS):** fail with `reason: 'fuzz probe crashed (no response) with payload: ...'`. The reason includes the first 80 chars of the payload JSON.
   - **`httpStatus >= 500`:** fail with `reason: 'fuzz payload produced 5xx: ...'`. Concrete: the server threw an unhandled error and the HTTP layer surfaced it as 500.
   - **Body fails JSON parse or `status` is not `'success' | 'error'`:** fail with `reason: 'fuzz payload produced non-envelope response: ...'`.
   - **`status === 'error'` and `errorCode` is not a string:** fail with `reason: 'fuzz error response missing errorCode for payload: ...'`.
4. If every payload passes, return pass.

The loop stops at the first failing probe. The result captures only that probe's response details — earlier passes are not aggregated, this layer is binary per endpoint.

### `runFuzzTests(input)`

Full sweep. Iterates `walkEndpoints(input.apiMethodMap)` and runs `runFuzzCheck` against each.

Signature:

```ts
runFuzzTests(input: RunFuzzTestsInput): Promise<RunContractSummary>

interface RunFuzzTestsInput {
  apiMethodMap: ApiMethodMap;
  baseUrl: string;
  skip?: string[];
  headers?: Record<string, string>;
  onResult?: (result: ContractCheckResult) => void;
}
```

There is no per-endpoint metadata filtering here — every endpoint is fuzzed, regardless of `auth.login` or `rateLimit`. `skip` matching follows the same two-tier convention as the other sweeps: `'<page>/<name>'` for version-agnostic, `'<page>/<name>/<version>'` for specific.

`onResult` fires once per endpoint (after all junk payloads for that endpoint have run, or at the first failing probe). It is NOT called per junk payload.

## Built-in junk payloads

The current catalogue lives in `src/fuzzCheck.ts:JUNK_PAYLOADS`. It is intentionally small and stable so a flake here is meaningful:

| Payload | What it stresses |
| --- | --- |
| `null` | Validator that assumes the body is an object. |
| `[]` | Empty-array confusion (validators that destructure as object). |
| `[1, 2, 3]` | Array where an object is expected. |
| `'string-instead-of-object'` | String-as-body. |
| `1234567890` | Number-as-body. |
| `true` | Boolean-as-body. |
| `{ nested: { deeply: { nested: { value: 'x'.repeat(10000) } } } }` | Oversized nested strings. Catches handlers that log the entire body without truncation. |
| `{ __proto__: { polluted: true } }` | Prototype-pollution attempt. Detects parsers that merge into a shared object. |
| `{ key: null, other: undefined, third: Number.NaN }` | Edge values that survive JSON encoding in non-obvious ways (`undefined` keys drop, `NaN` becomes `null`). |

This is a lightweight fuzzer, not a property-based one. Real schema-driven fuzzing (TS type -> random valid input via something like `fast-check`) is deferred until the devkit emits Zod schemas alongside the runtime types. When that lands, the fuzz layer will preferentially use registered fixtures (see below), fall back to schema-random, and finally fall back to this fixed catalogue.

## Fixture registry

Realistic-payload fixtures plug into the fuzz layer's roadmap. Today they are registered but the current implementation of `runFuzzCheck` does not consume them automatically — they are designed to be read by custom test layers and by the upcoming schema-aware fuzz mode. Registering them now keeps fixtures co-located with the endpoint code that owns the type.

### `registerTestFixture(typeKey, fixture)`

Store a fixture for a given type key. Re-registering replaces the previous entry. Typically called at module load from a `_api/*` file or a central registration module.

Signature:

```ts
registerTestFixture<TPayload = unknown>(typeKey: string, fixture: TestFixture<TPayload>): void

interface TestFixture<TPayload = unknown> {
  valid: TPayload[];
  invalid: TPayload[];
}
```

Conventions:

- **`typeKey` is a project-defined string** that uniquely identifies the input type. Common patterns: the route literal (`api/billing/getInvoice/v1`), or the named TypeScript interface (`GetInvoiceInput`). Pick one convention per project.
- **`valid` payloads** are shapes the validator accepts. Used to drive happy-path behavior (e.g. by a custom layer running each valid fixture and asserting `status === 'success'`).
- **`invalid` payloads** are shapes the validator should reject. Used to probe the error envelope: each invalid fixture should return `{ status: 'error', errorCode: '<validation code>' }`.
- **Re-registration replaces.** No merging — pass the full list each time.

### `getTestFixture(typeKey)`

Read back the fixture. Returns `undefined` when no fixture is registered for that key.

Signature:

```ts
getTestFixture(typeKey: string): TestFixture | undefined
```

Use this from a custom layer (see `extension-hooks.md`) to iterate per-endpoint fixtures.

## Types

```ts
interface FuzzCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
}

interface RunFuzzTestsInput {
  apiMethodMap: ApiMethodMap;
  baseUrl: string;
  skip?: string[];
  headers?: Record<string, string>;
  onResult?: (result: ContractCheckResult) => void;
}

interface TestFixture<TPayload = unknown> {
  valid: TPayload[];
  invalid: TPayload[];
}
```

`ContractCheckResult` and `RunContractSummary` are shared across layers — see `contract-tests.md`.

## Result shapes by branch

- **Pass**: `{ status: 'pass', durationMs }`. No `httpStatus` — the layer does not report which payloads passed, only that none failed.
- **Fail / crash**: `{ status: 'fail', reason: 'fuzz probe crashed (no response) with payload: <preview>', durationMs }`.
- **Fail / 5xx**: `{ status: 'fail', httpStatus, reason: 'fuzz payload produced 5xx: <preview>', durationMs }`.
- **Fail / non-envelope**: `{ status: 'fail', httpStatus, reason: 'fuzz payload produced non-envelope response: <preview>', durationMs }`.
- **Fail / error missing code**: `{ status: 'fail', httpStatus, reason: 'fuzz error response missing errorCode for payload: <preview>', durationMs }`.
- **Skip**: `{ status: 'skipped', durationMs: 0, reason: 'Explicitly skipped' }`.

`durationMs` covers the time to the first failing probe (fail branches) or the time to walk the whole catalogue (pass branch).

## Examples

### Nightly CI sweep

```ts
import { apiMethodMap } from './generated/apiMethodMap.generated';
import {
  runFuzzTests,
  logContractResult,
  logContractSummary,
} from '@luckystack/test-runner';

const summary = await runFuzzTests({
  apiMethodMap,
  baseUrl: 'http://127.0.0.1:80',
  onResult: logContractResult,
});

logContractSummary(summary);

if (summary.failed > 0) {
  process.exit(3);
}
```

### Authenticated fuzz (cookie-protected endpoints)

The fuzz layer does not strip credentials the way the auth layer does. Pass a session header so probes reach the handler instead of being killed at the auth guard:

```ts
await runFuzzTests({
  apiMethodMap,
  baseUrl: 'http://127.0.0.1:80',
  headers: {
    Cookie: 'session=<test-session-cookie>',
  },
  skip: ['integrations/stripeWebhook'], // signed payloads, would always fail
});
```

### Single-endpoint debug

```ts
import { runFuzzCheck } from '@luckystack/test-runner';

const result = await runFuzzCheck({
  endpoint: {
    page: 'organization-settings',
    name: 'sendInvite',
    version: 'v1',
    method: 'POST',
    fullPath: 'api/organization-settings/sendInvite/v1',
  },
  baseUrl: 'http://127.0.0.1:80',
  headers: { Cookie: 'session=<test-session>' },
  requestTimeoutMs: 8000,
});

console.log(result);
```

### Register a fixture for a critical endpoint

Co-locate the fixture next to the endpoint so it travels with refactors:

```ts
// src/billing/_api/getInvoice_v1.ts
import { registerTestFixture } from '@luckystack/test-runner';

registerTestFixture<{ invoiceId: string; expand?: string[] }>('api/billing/getInvoice/v1', {
  valid: [
    { invoiceId: 'inv_1' },
    { invoiceId: 'inv_1', expand: ['line_items'] },
  ],
  invalid: [
    { invoiceId: '' },
    { invoiceId: 'inv_1', expand: ['malicious; DROP TABLE'] },
  ],
});

export const main = async ({ data }: ApiParams) => { /* ... */ };
```

A nightly custom layer can then walk every endpoint, look up the fixture by route, and run the valid/invalid lists against the live endpoint to verify expected behavior beyond the framework envelope. The fuzz layer itself does not yet auto-pick these up — that wiring lands with the schema-aware fuzz mode.

## Edge cases and gotchas

- **Binary uploads.** Endpoints expecting `multipart/form-data` will fail every JUNK payload because the Content-Type header is `application/json`. Skip these endpoints explicitly; they need a separate, format-aware fuzzer.
- **Streaming endpoints.** Endpoints that hold the connection open (SSE, long-poll) will hit `requestTimeoutMs` and report as crashed. Skip them or add support for streaming responses in a custom layer.
- **Endpoints with filesystem side-effects.** A fuzz probe that triggers a real file write happens on every endpoint where the validator is permissive. Add cleanup in a custom layer or run the fuzz sweep against a disposable test instance.
- **Prototype pollution.** The runner sends `{ __proto__: { polluted: true } }`. Node's `JSON.parse` already strips `__proto__` to a regular own-property in modern runtimes, so this probe is mostly defensive. A failure here means a handler is using a custom merge function that does not honor that hardening.
- **`NaN` and `undefined` after stringify.** `Number.NaN` JSON-stringifies as `null`; `undefined`-valued keys are dropped. The payload that hits the server is `{ key: null, third: null }`. This is intentional — it mirrors what a malicious client can actually transmit.
- **Auth-protected endpoints with no session header.** They will all fail with `errorCode: 'auth.required'` (which passes the fuzz envelope check, since the response is a typed error). The fuzz sweep will report them as `pass`. Whether that is what you want depends on whether you trust the auth layer's earlier verdict — most projects pass headers to fuzz so the handler logic is actually reached.
- **The `<preview>` in the `reason`** is `JSON.stringify(payload).slice(0, 80)`. Long payloads (oversized nested) are truncated. Look at the source `JUNK_PAYLOADS` to identify which probe caused the failure when the preview is cut.
- **Adding payloads.** Today the catalogue is hard-coded. To extend it, fork the package or wrap `runFuzzCheck` in a custom layer (`registerTestLayer({ name: 'extra-fuzz', run })`) that issues additional probes. The roadmap is to make this list registry-driven once the schema-aware mode lands.
- **`onResult` is per-endpoint.** If you need per-probe visibility for a single endpoint, instrument `runFuzzCheck` directly or call it once per payload yourself. The exported function is the smallest stable unit.
