# Extension Hooks: Reporter, Layer and Fixture Registries

The four built-in layers (contract, auth, rate-limit, fuzz) cover the framework envelope and the security guards every LuckyStack project ships. The extension registry is where consumers add their own checks — CORS enforcement, multi-tenant isolation, business rules, GDPR data-flow checks — and pipe the combined results into Slack, a build dashboard, or any webhook. The hooks are intentionally narrow: three slots (layers, fixtures, reporters), each replace-by-key, all clearable from a single test-only function.

## Slots

| Slot | Purpose | Cardinality |
| --- | --- | --- |
| Test layers | Additional per-endpoint checks. Each layer has a unique `name`. | Many. Replace-by-name. |
| Fixtures | Realistic valid/invalid payloads keyed by a type identifier. | Many. Replace-by-typeKey. |
| Reporter | Single sink for per-result and per-summary events plus optional webhook. | One. Replace by re-registering or unregister with `null`. |

The registries are in-memory and process-local. They survive across calls within one process and reset only via `resetTestExtensionsForTests()`. There is no persistence — registration happens at module load.

## Functions

### `logContractResult(result)`

Pretty-print one `ContractCheckResult` to stdout. Wire it as `onResult` in any of the four built-in sweeps to get live per-endpoint output.

Signature:

```ts
logContractResult(result: ContractCheckResult): void
```

Output format:

- Pass success: `[PASS] POST /api/billing/getInvoice/v1 12ms http=200`
- Pass typed error: `[PASS] POST /api/auth/login/v1 8ms http=200 (error: auth.required)`
- Skip: `[SKIP] POST /api/uploads/fileUpload/v1 0ms Explicitly skipped`
- Fail: `[FAIL] POST /api/billing/cancelSubscription/v1 14ms http=500 reason=fuzz payload produced 5xx: ...`

Status tag is one of `[PASS]`, `[FAIL]`, `[SKIP]`. `http=-` appears when no HTTP status is captured (network error, abort). `durationMs` is always present.

### `logContractSummary(summary)`

Pretty-print one `RunContractSummary` to stdout. Call it once at the end of a sweep — typically after `logContractResult` has streamed the individual lines.

Signature:

```ts
logContractSummary(summary: RunContractSummary): void
```

Output:

```
Contract tests: 47/50 passed, 2 failed, 1 skipped

Failures:
  - /api/billing/cancelSubscription/v1: fuzz payload produced 5xx: { nested: ...
  - /api/integrations/stripeWebhook/v1: Response missing standard `status` envelope
```

The header line is always printed. The failures block is only printed when `summary.failed > 0`. Skipped endpoints are counted but not enumerated.

### `registerTestLayer(layer)`

Add (or replace by name) a custom test layer in the registry.

Signature:

```ts
registerTestLayer(layer: TestLayer): void

interface TestLayer {
  name: string;
  run: (input: TestLayerInput) => Promise<TestLayerResult> | TestLayerResult;
}

interface TestLayerInput {
  endpoint: string;          // resolved route, e.g. 'api/billing/getInvoice/v1'
  method?: string;           // HTTP method, undefined for sync endpoints
  authToken?: string;        // bearer/session token for auth-aware checks
}

interface TestLayerResult {
  passed: boolean;
  message?: string;          // short reason key, i18n-style on failure
  metadata?: Record<string, unknown>;
}
```

Replace-by-name: registering a layer with a name that already exists overwrites the previous entry. Use this to update a layer mid-run, e.g. after fetching a fresh auth token.

The runner does **not** currently wire registered layers into the built-in sweeps automatically. Today they live in the registry as a coordination surface for custom test harnesses — read them with `listTestLayers()`, iterate `walkEndpoints`, and call `layer.run(input)` per endpoint. The roadmap is for a future `runRegisteredLayers({ apiMethodMap, baseUrl })` entry point to walk the registry as a fifth (or N-th) built-in layer.

### `listTestLayers()`

Return the current registry snapshot.

Signature:

```ts
listTestLayers(): TestLayer[]
```

Order is registration order (Map iteration order). The returned array is a fresh copy — mutating it does not affect the registry.

### `registerTestReporter(reporter)`

Set the reporter slot, or clear it by passing `null`.

Signature:

```ts
registerTestReporter(reporter: TestReporter | null): void

interface TestReporter {
  onResult?: (result: TestResult) => void | Promise<void>;
  onSummary?: (summary: TestSummary) => void | Promise<void>;
  webhookUrl?: string;
  webhookAuth?: { type: 'bearer'; token: string };
}

interface TestResult {
  layer: string;
  endpoint: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface TestSummary {
  totalLayers: number;
  totalEndpoints: number;
  passed: number;
  failed: number;
  results: TestResult[];
}
```

Replace-by-overwrite: only one reporter is active. To compose multiple sinks, write a single reporter that fans out internally.

Like layers, the reporter is a coordination surface today: the built-in sweeps emit `ContractCheckResult` shapes, not `TestResult`. The registered reporter is intended for the cross-layer aggregator that lives in your test harness — collect results from each built-in sweep, map them into `TestResult`, and emit through this reporter so all sinks see one stream.

### `getTestReporter()`

Read the active reporter or `null` if none is registered.

Signature:

```ts
getTestReporter(): TestReporter | null
```

### `resetTestExtensionsForTests()`

Clear all three registries (layers, fixtures, reporter). Intended for the runner's own internal tests — calling it from a production test harness will wipe everything other modules registered at load time, which usually breaks fixture-dependent layers.

Signature:

```ts
resetTestExtensionsForTests(): void
```

The name advertises the intent: do not import this from production paths. There is no convenience "clear only layers" — by design, to keep the surface small.

## Webhook contract

When `reporter.webhookUrl` is set, the harness that drives the reporter is expected to POST the JSON-serialised `TestSummary` to that URL at the end of the sweep. The runner's own built-in sweeps do not call the webhook themselves — that's the job of the consumer's aggregator. Recommended client behavior:

- **Method:** `POST`.
- **Headers:** `Content-Type: application/json`, plus `Authorization: Bearer <token>` when `webhookAuth?.type === 'bearer'`.
- **Body:** `JSON.stringify(summary)`. `TestSummary.results` can be large — clip or compress on the producer side if the receiver has body limits.
- **Timeout:** wrap the POST in `tryCatch` with a sensible per-call timeout (e.g. 5s). A webhook failure should not fail the sweep.
- **Retries:** none by default. Add idempotency at the receiver if you want retries; the runner is a one-shot test driver, not a queue.

Concrete example of a webhook-emitting reporter:

```ts
import { registerTestReporter } from '@luckystack/test-runner';

registerTestReporter({
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXX',
  onSummary: async (summary) => {
    const url = 'https://hooks.slack.com/services/T000/B000/XXX';
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `LuckyStack tests: ${summary.passed}/${summary.totalEndpoints} passed`,
      }),
    });
  },
});
```

## Lifecycle and error isolation

- **Reporter callbacks** (`onResult`, `onSummary`) and **layer callbacks** (`run`) execute inline on the caller's task. The runner does not wrap them in `tryCatch`. A throw propagates out of the sweep and skips subsequent endpoints — handle errors inside your callback if you want isolation.
- **Async callbacks** are NOT awaited by the built-in sweeps' `onResult` plumbing. If you do async work, push results into an in-memory buffer and flush in `onSummary` (which the aggregator can await).
- **Order:** `onResult` fires per individual result in sweep order; `onSummary` fires exactly once at the end of the aggregator's run. Built-in sweeps emit `ContractCheckResult` through their own `onResult` parameter — the cross-layer reporter sees `TestResult` only when your aggregator forwards mapped results to it.

## Types

```ts
interface TestLayer {
  name: string;
  run: (input: TestLayerInput) => Promise<TestLayerResult> | TestLayerResult;
}

interface TestLayerInput {
  endpoint: string;
  method?: string;
  authToken?: string;
}

interface TestLayerResult {
  passed: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface TestFixture<TPayload = unknown> {
  valid: TPayload[];
  invalid: TPayload[];
}

interface TestResult {
  layer: string;
  endpoint: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface TestSummary {
  totalLayers: number;
  totalEndpoints: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

interface TestReporter {
  onResult?: (result: TestResult) => void | Promise<void>;
  onSummary?: (summary: TestSummary) => void | Promise<void>;
  webhookUrl?: string;
  webhookAuth?: { type: 'bearer'; token: string };
}
```

`ContractCheckResult` and `RunContractSummary` (the shapes emitted by the four built-in sweeps) live in `contract-tests.md`.

## Examples

### Live progress with the built-in pretty printer

```ts
import {
  runContractTests,
  runFuzzTests,
  logContractResult,
  logContractSummary,
} from '@luckystack/test-runner';

const contract = await runContractTests({
  apiMethodMap,
  baseUrl,
  onResult: logContractResult,
});
logContractSummary(contract);

const fuzz = await runFuzzTests({
  apiMethodMap,
  baseUrl,
  onResult: logContractResult,
});
logContractSummary(fuzz);
```

### Custom CORS-enforcement layer

```ts
import { registerTestLayer } from '@luckystack/test-runner';

registerTestLayer({
  name: 'cors',
  run: async ({ endpoint }) => {
    const response = await fetch(`http://127.0.0.1:80/${endpoint}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    const allowed = response.headers.get('Access-Control-Allow-Origin');
    if (allowed === '*' || allowed === 'https://evil.example.com') {
      return {
        passed: false,
        message: 'cors.openOrigin',
        metadata: { allowed },
      };
    }
    return { passed: true };
  },
});
```

A test harness then walks `listTestLayers()` per endpoint and aggregates results through the registered reporter.

### Multi-tenant isolation layer (combining fixtures and layers)

```ts
import {
  registerTestFixture,
  registerTestLayer,
  getTestFixture,
} from '@luckystack/test-runner';

registerTestFixture('api/billing/getInvoice/v1', {
  valid: [{ invoiceId: 'inv_tenant_a' }],
  invalid: [{ invoiceId: 'inv_tenant_b_owned_by_other_tenant' }],
});

registerTestLayer({
  name: 'multi-tenant-isolation',
  run: async ({ endpoint, authToken }) => {
    const fixture = getTestFixture(endpoint);
    if (!fixture || fixture.invalid.length === 0) return { passed: true };

    const probe = fixture.invalid[0];
    const response = await fetch(`http://127.0.0.1:80/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken ?? ''}`,
      },
      body: JSON.stringify(probe),
    });
    const body = await response.json() as { status?: string; errorCode?: string };
    if (body.status === 'success') {
      return {
        passed: false,
        message: 'tenant.crossAccess',
        metadata: { probe },
      };
    }
    return { passed: true };
  },
});
```

### Slack webhook reporter

```ts
import { registerTestReporter } from '@luckystack/test-runner';

registerTestReporter({
  webhookUrl: process.env.SLACK_WEBHOOK_URL,
  onSummary: async (summary) => {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) return;
    const text = summary.failed > 0
      ? `LuckyStack tests FAILED: ${summary.failed}/${summary.totalEndpoints} endpoints`
      : `LuckyStack tests passed: ${summary.passed}/${summary.totalEndpoints}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  },
});
```

### Buffering reporter that forwards built-in sweep results

The built-in sweeps emit `ContractCheckResult`. The reporter sees `TestResult`. Bridge them in your aggregator:

```ts
import {
  runContractTests,
  runAuthEnforcementTests,
  registerTestReporter,
  getTestReporter,
} from '@luckystack/test-runner';

const buffered: TestResult[] = [];

registerTestReporter({
  onResult: (r) => buffered.push(r),
  onSummary: async (summary) => {
    console.log('Final summary:', summary);
  },
});

const forward = (layer: string) => (result: ContractCheckResult) => {
  getTestReporter()?.onResult?.({
    layer,
    endpoint: result.endpoint.fullPath,
    passed: result.status === 'pass',
    message: result.reason,
    durationMs: result.durationMs,
    metadata: {
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      responseStatus: result.responseStatus,
    },
  });
};

const contract = await runContractTests({
  apiMethodMap,
  baseUrl,
  onResult: forward('contract'),
});
const auth = await runAuthEnforcementTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  onResult: forward('auth'),
});

await getTestReporter()?.onSummary?.({
  totalLayers: 2,
  totalEndpoints: contract.total + auth.total,
  passed: buffered.filter(r => r.passed).length,
  failed: buffered.filter(r => !r.passed).length,
  results: buffered,
});
```

## Edge cases and gotchas

- **Throwing inside `onResult` kills the sweep.** The built-in sweeps call `input.onResult?.(result)` without `tryCatch`. Wrap your callback in your own `tryCatch` if it can throw.
- **Async `onResult` is fire-and-forget for built-in sweeps.** Returning a promise does not pause the iteration. Push into a buffer; await in `onSummary`.
- **`registerTestReporter(null)` removes the reporter.** `getTestReporter()` returns `null` after that. There is no "remove specific callback" — the slot is whole-object replace-only.
- **`registerTestLayer` with a duplicate name silently replaces** the previous layer. To verify, call `listTestLayers()` and check the length / `name`s before kicking off the sweep.
- **`resetTestExtensionsForTests()` is destructive.** It clears layers, fixtures, AND the reporter. Use it in `beforeEach`-style hooks for the runner's own tests, never in production harnesses.
- **Webhook failures.** The runner does not own the webhook POST. Your reporter implements it; handle 4xx/5xx and timeouts there. A webhook that throws while inside `onSummary` will bubble up to your aggregator.
- **`TestResult.layer` is a string, not a union.** That keeps the registry permissive: built-in layers can also feed in (`'contract'`, `'auth'`, `'rate-limit'`, `'fuzz'`) plus any custom names you registered. Establish a project-wide convention for layer names so the reporter can route on them.
- **No deregistration for fixtures.** `registerTestFixture(typeKey, { valid: [], invalid: [] })` is the closest you get; pass empty arrays to neutralize. `resetTestExtensionsForTests()` is the nuclear option.
- **Layer `run` callbacks are not concurrent.** A consumer aggregator that iterates `listTestLayers()` per endpoint is expected to await each layer sequentially. If you want concurrency, write it explicitly in your aggregator (with `Promise.allSettled`) — the registry imposes no policy.
- **`logContractResult` uses `console.log` only.** No file output, no log levels. To capture output, redirect stdout or write your own reporter on top of the result shape.
