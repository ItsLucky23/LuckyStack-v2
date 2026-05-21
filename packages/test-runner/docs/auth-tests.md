# Auth Enforcement Tests

The auth-enforcement layer answers one question per endpoint: "If a logged-out caller hits this route, does the framework reject them?" It is the cheapest insurance policy against a `_api/*` file that forgets to set `auth.login: true`, an `auth.login` guard that was silently swapped to `false` during a refactor, or a middleware change in `@luckystack/api` that stops short-circuiting unauthenticated requests.

Pass criterion: the endpoint returns `{ status: 'error', errorCode: 'auth.required' }`. Anything else — `success`, a different `errorCode`, a missing envelope, a network error — is a failure.

## Functions

### `runAuthEnforcementCheck(input)`

Single-endpoint variant.

Signature:

```ts
runAuthEnforcementCheck(input: AuthEnforcementCheckInput): Promise<ContractCheckResult>

interface AuthEnforcementCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  requestTimeoutMs?: number; // default 5000
}
```

Flow:

1. Build URL the same way the contract layer does.
2. Build body via `inputFor?.(endpoint) ?? {}`. `GET` drops the body.
3. **Send the request with no session cookie, no `Authorization` header, no `X-CSRF-Token`.** The runner deliberately omits every form of credential — that is the whole point of this layer. `headers` is not a supported field for this reason; passing one would defeat the test.
4. Parse the JSON. Parse failure is a fail.
5. Branch on `parsed.status`:
   - `'success'` -> fail with `reason: 'auth.login endpoint returned success without a session'`. This is the headline case: the endpoint is open when it should be closed.
   - Not `'error'` (missing, weird) -> fail with `'Response missing standard `status` envelope'`.
   - `'error'` with `errorCode !== 'auth.required'` -> fail with the expected/actual codes inline in the `reason`. A different error code (e.g. validation rejecting `{}`) means the auth guard never ran — the request was killed earlier in the pipeline.
   - `'error'` with `errorCode === 'auth.required'` -> pass.

The canonical error code is imported from the framework constant `auth.required` (see `packages/api/src/handleHttpApiRequest.ts`). It is intentionally hard-coded in the runner rather than fed from config because the whole point is to detect drift: if `@luckystack/api` ever renames the code, this layer should fail every protected endpoint until consumers acknowledge the change.

### `runAuthEnforcementTests(input)`

Full sweep. Iterates `walkEndpoints(input.apiMethodMap)` and only checks endpoints where `apiMetaMap[page][name][version].auth.login === true`. Public endpoints (`auth.login: false` or missing meta) are skipped **silently** — they do not appear in the summary at all. This keeps the report focused on what this layer actually covers; public endpoints are already exercised by the contract layer.

Signature:

```ts
runAuthEnforcementTests(input: RunAuthEnforcementTestsInput): Promise<RunContractSummary>

interface RunAuthEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  onResult?: (result: ContractCheckResult) => void;
}

type ApiMetaMap = Record<string, Record<string, Record<string, {
  method: string;
  auth: { login: boolean; additional?: Record<string, unknown>[] };
  rateLimit?: number | false;
}>>>;
```

Behavior notes:

- **`skip` uses the same two-tier matching as `runContractTests`**: pass `'<page>/<name>'` for version-agnostic skip, or `'<page>/<name>/<version>'` for a specific version.
- **`onResult` fires only for endpoints that pass `requiresLogin`.** Public endpoints don't trigger it; they don't exist for this layer.
- **`additional` auth checks (e.g. role-based gates) are NOT covered.** Only the `login: true` flag is read. An endpoint with `auth.login: true, additional: [{ role: 'admin' }]` is asserted by this layer to reject unauthenticated requests with `auth.required`; the role check is out of scope and lives in a custom layer (see `extension-hooks.md`).

Returns the same `RunContractSummary` shape as the contract layer; `total` is the number of protected endpoints actually probed (after public-endpoint filtering).

## Types

```ts
interface AuthEnforcementCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  requestTimeoutMs?: number;
}

interface RunAuthEnforcementTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  onResult?: (result: ContractCheckResult) => void;
}
```

`ContractCheckResult` and `RunContractSummary` are shared with the contract layer — see `contract-tests.md`.

## Result shapes by branch

- **Pass**: `{ status: 'pass', httpStatus, responseStatus: 'error', errorCode: 'auth.required', durationMs }`.
- **Fail / open endpoint**: `{ status: 'fail', httpStatus, responseStatus: 'success', reason: 'auth.login endpoint returned success without a session', durationMs }`.
- **Fail / wrong errorCode**: `{ status: 'fail', httpStatus, responseStatus: 'error', errorCode: '<actual>', reason: "expected errorCode 'auth.required' but got '<actual>'", durationMs }`.
- **Fail / non-envelope**: `{ status: 'fail', httpStatus, responseStatus: 'unknown', reason: 'Response missing standard `status` envelope', durationMs }`.
- **Fail / JSON parse**: `{ status: 'fail', httpStatus, responseStatus: 'unknown', reason: 'JSON parse failed: ...', durationMs }`.
- **Fail / fetch error**: `{ status: 'fail', reason: <Error.message>, durationMs }`.
- **Skip**: `{ status: 'skipped', durationMs: 0, reason: 'Explicitly skipped' }`.

## Examples

### Full sweep in CI

```ts
import { apiMethodMap } from './generated/apiMethodMap.generated';
import { apiMetaMap } from './generated/apiMetaMap.generated';
import {
  runAuthEnforcementTests,
  logContractResult,
  logContractSummary,
} from '@luckystack/test-runner';

const summary = await runAuthEnforcementTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl: 'http://127.0.0.1:80',
  onResult: logContractResult,
});

logContractSummary(summary);

if (summary.failed > 0) {
  // A failure here is a security finding, not a flaky test.
  process.exit(2);
}
```

### Single endpoint debug

```ts
import { runAuthEnforcementCheck, logContractResult } from '@luckystack/test-runner';

const result = await runAuthEnforcementCheck({
  endpoint: {
    page: 'billing',
    name: 'cancelSubscription',
    version: 'v1',
    method: 'POST',
    fullPath: 'api/billing/cancelSubscription/v1',
  },
  baseUrl: 'http://127.0.0.1:80',
});

logContractResult(result);
```

### Bypass an over-eager validator

Some validators reject `{}` before the auth guard runs. The framework runs auth before validation, but a custom middleware (or a custom error formatter) can flip that order. If you see `errorCode: 'validation.failed'` instead of `auth.required`, supply a payload that the validator accepts so the request reaches the auth check:

```ts
await runAuthEnforcementTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  inputFor: (endpoint) => {
    if (endpoint.fullPath === 'api/billing/cancelSubscription/v1') {
      return { subscriptionId: 'sub_test' };
    }
    return {};
  },
});
```

When you see this happen for many endpoints, the right fix is usually in the middleware order in `@luckystack/api`, not in the runner.

### Skip endpoints with custom auth schemes

Endpoints that authenticate via a non-session mechanism (e.g. a webhook with HMAC signature, an internal cron token) declare `auth.login: false` and live outside this layer. If for some reason a webhook endpoint is registered as `auth.login: true` (and you cannot fix the source), skip it:

```ts
await runAuthEnforcementTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  skip: ['integrations/stripeWebhook'],
});
```

Prefer fixing the meta over skipping — a wrong `auth.login` flag breaks runtime behavior, not just this test.

## Edge cases and gotchas

- **CSRF.** The framework enforces CSRF on state-changing requests. The runner sends no `X-CSRF-Token`, so for a brief window the request can be rejected on CSRF grounds before reaching auth. The current framework returns `auth.required` ahead of CSRF for unauthenticated sessions, so this layer passes; if you reorder middleware to CSRF-first, this layer will need updating.
- **`additional` auth checks** are not covered here. Put role/scope checks in a `registerTestLayer({ name: 'role-enforcement', run })` plug-in (see `extension-hooks.md`).
- **Endpoints absent from `apiMetaMap`.** The runner reads `apiMetaMap[page]?.[name]?.[version]?.auth.login`. If any link in that chain is missing, `requiresLogin` returns `false` and the endpoint is silently skipped. Regenerate the meta map if your sweep reports `total: 0`.
- **Session-cookie names are project-specific.** This layer never sets one, so the name doesn't matter to the runner. It does matter for the auth layer's mirror image: a custom "logged-in sweep" you might write to confirm protected endpoints work *with* a valid session.
- **Wrong errorCode is a real signal.** When you see `expected 'auth.required' but got 'auth.sessionExpired'`, the framework is detecting and reporting the missing session — just with a stricter code. Either align the runner expectation (fork or PR) or align the framework code. Do not skip.
- **`@luckystack/login` session-token interaction.** Sessions live in Redis under `${projectName}-session:*` keys. The runner does not touch them. If a logged-in regression suite must run before this layer, use `resetServerState()` to clear sessions and rate limits in one shot (see `rate-limit-tests.md`).
- **`onResult` async handlers.** The runner does `input.onResult?.(result)` without awaiting. Sync side-effects fire in order; async work is fire-and-forget. Push results into an array and process after the sweep if you need ordering guarantees.
- **Empty `summary.total`.** When the protected-endpoint filter excludes every endpoint, the sweep returns `{ total: 0, passed: 0, failed: 0, skipped: 0, results: [] }`. This is the expected "no protected endpoints" outcome, not a failure mode. Distinguish from network failure by inspecting `apiMetaMap` directly before running the sweep when you want to assert there *should* be protected endpoints.

## Pairing with the contract layer

The auth-enforcement layer covers the unauthenticated path. It does NOT cover the authenticated path — an endpoint that's protected, accepts a valid session, but crashes on real input would pass this layer cleanly. Run the contract layer with real session headers as the second half of the matrix:

```ts
await runContractTests({
  apiMethodMap,
  baseUrl,
  headers: { Cookie: 'session=<test-session-cookie>' },
});

await runAuthEnforcementTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  // No headers — the layer deliberately omits credentials.
});
```

The first sweep proves "logged-in callers get sane responses"; the second proves "logged-out callers get blocked". A custom role-enforcement layer (registered via `registerTestLayer`) is the natural third leg.

## Interaction with `@luckystack/login`

Sessions written by `@luckystack/login` live in Redis under `${projectName}-session:*`. The auth layer does not read them and never sets a `Cookie` header. When wiring an end-to-end matrix:

1. Use `resetServerState()` from `rate-limit-tests.md` to flush sessions before kicking off any logged-in sweep.
2. Establish one session through the project's `/auth/login` flow (or call `setSession` directly in your harness).
3. Pass that session as `Cookie: session=<token>` to the contract or fuzz layer.
4. Run the auth-enforcement layer last (or before step 2) — it does its own thing with no credentials, so order vs the logged-in sweep does not matter for correctness, only for test runtime.
