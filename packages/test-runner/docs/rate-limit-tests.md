# Rate-Limit Tests

The rate-limit layer proves one thing per endpoint: an endpoint declared `rateLimit: N` rejects the `(N+1)`th request inside its window with `errorCode: 'api.rateLimitExceeded'`. It is the layer that mutates the most server-side state — every probe drains a real bucket. Run it after the contract and auth layers, against a dedicated test instance, and ideally with `resetBetweenEndpoints: true`.

## Functions

### `runRateLimitCheck(input)`

Single-endpoint variant.

Signature:

```ts
runRateLimitCheck(input: RateLimitCheckInput): Promise<ContractCheckResult>

interface RateLimitCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  rateLimit: number;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  requestTimeoutMs?: number; // default 10000
}
```

Flow:

1. Fire `rateLimit` requests back-to-back. Their responses are ignored — they exist only to drain the bucket. The framework records each one against the limiter, regardless of whether the request itself succeeded or failed.
2. Fire one final request. This is the probe.
3. Parse the probe response. If `status === 'error'` AND `errorCode === 'api.rateLimitExceeded'`, pass. Anything else — including a `success` response, a different error code, or a network failure on the final probe — is a fail.

Important details:

- **Serial, not parallel.** Concurrent requests would race and the limiter could see them in any order. Serial keeps the math predictable: request N+1 is the one that crosses the threshold.
- **The first `rateLimit` requests are not asserted.** They can be `success`, validation-errors, anything. The whole point is to count, not to validate intermediate behavior. The contract layer already covers correctness of those.
- **Default timeout is 10 seconds**, double the contract layer. Rate limiters at the upper bound of `maxRateLimitToTest` (default 50) generate ~50 requests per endpoint, which adds latency.
- **Headers and `inputFor` are forwarded to every request**, including the drain requests. Use them when the validator rejects empty input and you want every probe to hit the limiter rather than fail at validation. (Validation failures still consume rate-limit budget in the framework.)

### `runRateLimitTests(input)`

Full sweep. Reads `rateLimit` from `apiMetaMap[page][name][version].rateLimit`, skips endpoints where it is `false`, `undefined`, or above `maxRateLimitToTest`, then runs `runRateLimitCheck` against the rest.

Signature:

```ts
runRateLimitTests(input: RunRateLimitTestsInput): Promise<RunContractSummary>

interface RunRateLimitTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  maxRateLimitToTest?: number;     // default 50
  resetBetweenEndpoints?: boolean; // default false
  resetToken?: string;
  onResult?: (result: ContractCheckResult) => void;
}
```

Behavior notes:

- **Endpoints with `rateLimit: false` are silently skipped.** No `skipped` result, no `onResult` call. The summary's `total` reflects only endpoints with a numeric rate limit.
- **Endpoints with `rateLimit > maxRateLimitToTest` are skipped loudly.** They appear with `status: 'skipped'` and `reason: 'rateLimit ${N} exceeds maxRateLimitToTest=${max}'`. Bump `maxRateLimitToTest` to cover them, but be aware each endpoint then fires `N+1` requests serially.
- **`resetBetweenEndpoints: true` calls `resetServerState({ baseUrl, token: resetToken })` before every endpoint** that survives the skip filter. Without this, the limiter bucket on a shared IP (the test runner's host) is not flushed between endpoints — endpoint A's drain requests bleed into endpoint B's window and the N+1 assertion fires too early or too late depending on key collisions.
- **`resetToken` is required when `TEST_RESET_TOKEN` is set on the server.** Always set this in any non-prod environment that is reachable over the network (staging, preview). The server is fail-closed: missing token = 403, unset env var server-side = 403 (never "open").
- **`onResult` fires for tested AND `maxRateLimitToTest`-skipped endpoints**, but not for `rateLimit: false` endpoints (those don't show up at all).

### `resetServerState(input)`

POST to the server's `/_test/reset` endpoint. Used between rate-limit probes and at the start of a CI run to ensure a clean slate.

Signature:

```ts
resetServerState(input: ResetServerStateInput): Promise<boolean>

interface ResetServerStateInput {
  baseUrl: string;
  token?: string;
}
```

Returns `true` when the server responds 2xx, `false` on network error, parse error, or non-2xx. The error is swallowed deliberately — the most common reason for `false` is "the route is disabled in this environment", and the caller usually wants to proceed anyway.

URL: `${baseUrl}/_test/reset` (POST). When `token` is set, the request includes `X-Test-Reset-Token: ${token}`. The header name is part of the server contract.

## `/_test/reset` server contract

The endpoint is served by `@luckystack/server` (see `packages/server/src/httpRoutes/testResetRoute.ts`). It is mounted at `projectConfig.http.testResetEndpoint` (default `/_test/reset`).

Gating, in order:

1. `process.env.NODE_ENV` must be exactly `'development'` or `'test'`. Anything else — including missing — returns 404. "Anything but production" was rejected as too loose: a misconfigured env var must not expose this route.
2. `process.env.TEST_RESET_TOKEN` must be set on the server AND `req.headers['x-test-reset-token']` must match exactly. Empty server-side token = 403 unconditionally. The header check happens after the NODE_ENV check, so leaking the token name from a 403 only happens in dev/test environments.

What it clears (when both gates pass):

- **All rate-limit buckets** via `clearAllRateLimits()` from `@luckystack/core`. Every key under the rate-limit Redis namespace is dropped. Always cleared.
- **All sessions** under `${projectName}-session:*` and active-user records under `${projectName}-activeUsers:*`. Scanned in batches of 200 keys via `redis.scan + redis.del`. Project name comes from `getProjectName()` for consistency across `session.ts`, `rateLimiter.ts`, and this endpoint.
- **Registered runtime hooks** when `?include=hooks` is in the query string. NOT included by default because framework-internal handlers (e.g. presence postLogout) register at boot — clearing them would require a server restart to recover.

Response:

```json
{ "status": "success", "cleared": ["rateLimits", "sessions", "activeUsers"] }
```

The `cleared` array reflects what actually had keys to drop. It is informational; `runRateLimitTests` only checks `response.ok`.

## Types

```ts
interface RateLimitCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  rateLimit: number;
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
}

interface RunRateLimitTestsInput {
  apiMethodMap: ApiMethodMap;
  apiMetaMap: ApiMetaMap;
  baseUrl: string;
  skip?: string[];
  inputFor?: (endpoint: EndpointDescriptor) => unknown;
  headers?: Record<string, string>;
  maxRateLimitToTest?: number;
  resetBetweenEndpoints?: boolean;
  resetToken?: string;
  onResult?: (result: ContractCheckResult) => void;
}

interface ResetServerStateInput {
  baseUrl: string;
  token?: string;
}
```

## Result shapes by branch

- **Pass**: `{ status: 'pass', httpStatus, responseStatus: 'error', errorCode: 'api.rateLimitExceeded', durationMs }`.
- **Fail / final probe never returned**: `{ status: 'fail', reason: 'Final rate-limit probe request failed to return a response', durationMs }`.
- **Fail / wrong status or code**: `{ status: 'fail', httpStatus, responseStatus, errorCode, reason: "expected 'api.rateLimitExceeded' on request ${N+1} but got <status>/<code>", durationMs }`.
- **Skip / over max**: `{ status: 'skipped', durationMs: 0, reason: 'rateLimit ${N} exceeds maxRateLimitToTest=${max}' }`.
- **Skip / explicit**: `{ status: 'skipped', durationMs: 0, reason: 'Explicitly skipped' }`.

`durationMs` covers the entire `N+1` request sequence, not just the final probe.

## Examples

### Full sweep with state reset between endpoints

```ts
import { apiMethodMap } from './generated/apiMethodMap.generated';
import { apiMetaMap } from './generated/apiMetaMap.generated';
import {
  resetServerState,
  runRateLimitTests,
  logContractResult,
  logContractSummary,
} from '@luckystack/test-runner';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:80';
const resetToken = process.env.TEST_RESET_TOKEN;

await resetServerState({ baseUrl, token: resetToken });

const summary = await runRateLimitTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  resetBetweenEndpoints: true,
  resetToken,
  onResult: logContractResult,
});

logContractSummary(summary);
```

### Local dev: skip the reset (faster, less hygienic)

```ts
await runRateLimitTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:80',
  // No resetBetweenEndpoints — fine if all endpoints have separate limiter keys.
});
```

This works when every endpoint has its own limiter key (the framework default is `<ip>:<endpoint>`). It fails when limiter keys are coarsened to IP-only.

### Single-endpoint debug

```ts
import { runRateLimitCheck } from '@luckystack/test-runner';

const result = await runRateLimitCheck({
  endpoint: {
    page: 'auth',
    name: 'login',
    version: 'v1',
    method: 'POST',
    fullPath: 'api/auth/login/v1',
  },
  baseUrl: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:80',
  rateLimit: 5, // matches the value in src/auth/_api/login_v1.ts
  inputFor: () => ({ email: 'test@example.com', password: 'wrong' }),
});

console.log(result);
```

### Staging deploy with a token

```ts
await runRateLimitTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl: 'https://staging.example.com',
  resetBetweenEndpoints: true,
  resetToken: process.env.STAGING_TEST_RESET_TOKEN,
  maxRateLimitToTest: 100, // wider net for nightly sweep
});
```

Set `TEST_RESET_TOKEN` on the staging server to the same value. Without both halves of the token, the reset returns 403 and the rate-limit windows leak across endpoints.

### Tighten the budget

```ts
await runRateLimitTests({
  apiMethodMap,
  apiMetaMap,
  baseUrl,
  maxRateLimitToTest: 20, // skip everything noisier than 20/window
});
```

Endpoints with `rateLimit: 100` will appear as skipped with the reason inline.

## Edge cases and gotchas

- **Time-window granularity.** The framework rate-limiter uses Redis-backed sliding windows. Firing `N+1` serial requests typically completes in well under the window, so the assertion is reliable. If your endpoint sets `rateLimit: 1` and the window is sub-second, latency between the drain and the probe can let the bucket reset — bump `requestTimeoutMs` only buys per-call slack; the window itself is server-controlled.
- **Distributed rate-limit storage.** The runner assumes one limiter authority (one Redis instance, or a single cluster). Multi-region setups with eventual consistency can produce false negatives: the N+1 probe lands on a different shard than the drain. Run this layer against a single-region staging.
- **Multi-instance servers.** Without sticky sessions, the drain requests fan out to several pods and each pod sees fewer than N. The probe lands on a pod that has not yet seen the bucket fill. Either pin the runner to one upstream, or set the limiter keying to include the user-ip header consistently.
- **Limiter keys.** The framework keys on a combination of route + IP (or session, when present). Two endpoints can share a coarser key (e.g. `ip:<all>`). When they do, `resetBetweenEndpoints` is mandatory. When they do not, the option is optional and the test runs faster without it.
- **The `validation.failed` trap.** If the validator rejects every drain request before the limiter sees them, the framework still counts the request — but verifying this assumption is the user's responsibility. Use `inputFor` to provide payloads that survive validation when in doubt.
- **`maxRateLimitToTest` accidentally too high.** With `maxRateLimitToTest: 1000` and 30 endpoints, the sweep fires `~30000` requests serially. This will time out CI long before it completes. Default 50 is deliberate.
- **`/_test/reset` returning false from `resetServerState`.** Most common cause: `NODE_ENV !== 'development' | 'test'` on the server. Second most common: missing token. Third: route disabled via custom routing. The runner does not retry — it returns `false` and proceeds. The next endpoint's window will be polluted; consider failing the sweep early.
- **Sessions cleared as collateral damage.** `resetServerState` always drops sessions and active users in addition to limiter buckets. If you have a long-running logged-in test alongside this layer, run the rate-limit sweep first, then re-establish the session.
- **`?include=hooks` is opt-in for a reason.** Do not call `resetServerState` with this flag in a long-running test process — framework-internal hooks register only at boot, and dropping them mid-run will break presence, post-logout cleanup, and similar side-effects until restart.
