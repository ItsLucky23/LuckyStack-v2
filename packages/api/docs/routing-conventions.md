# Routing Conventions

> Last updated: 2026-05-20

## Overview

`@luckystack/api` is transport-agnostic — it does not own file-based routing. Discovery of `_api/<name>_v<N>.ts` files lives in `@luckystack/devkit`, which walks `src/`, parses each file's exports, and emits two artifacts the API handler reads at runtime: the route map (`getRuntimeApiMaps()`) and the generated type map (`apiTypes.generated.ts`). This document describes the route-name conventions both handlers enforce, the per-route exports the runtime map carries, and the HTTP-method inference contract the HTTP transport applies.

If a route name on the wire does not match the conventions below, both `handleApiRequest` and `handleHttpApiRequest` reject with `routing.invalidServiceRouteName` before any other side effect. If a name parses but does not match a registered route, both return `api.notFound`.

## Wire-level route names

Both transports accept the same shape:

```
api/<page>/<name>/v<N>
```

| Segment | Constraints |
| --- | --- |
| `api/` | Literal prefix. The HTTP transport accepts `name` with or without it and normalizes; the socket transport requires the prefix to be present in `msg.name`. |
| `<page>` | Slash-separated page path. May be deeply nested (`organization/settings`). Top-level system APIs use `system` as the page (e.g. `api/system/session/v1`). |
| `<name>` | Endpoint name. Free-form identifier; influences HTTP method inference (see below). |
| `v<N>` | Version token (`v1`, `v2`, ...). Required. Files that do not end in `_v<N>.ts` are skipped by the discovery walker. |

`parseTransportRouteName({ value, prefix: 'api' })` (exported from `@luckystack/core`) is the single source of truth. The returned `normalizedFullName` is what the handler uses for runtime-map lookup, rate-limit keying, and hook payloads.

## File-system convention

Discovery is owned by `@luckystack/devkit`. Files are picked up when they live under `src/` and match `**/_api/<name>_v<N>.ts` (or any subdirectory, including `_api/<sub>/<name>_v<N>.ts` for nested routes). The marker segment `_api` is configurable via `registerRoutingRules` but defaults to `_api`.

| Path | Resolved route |
| --- | --- |
| `src/_api/session_v1.ts` | `api/system/session/v1` (top-level APIs are mapped under the `system` service) |
| `src/settings/_api/updateUser_v1.ts` | `api/settings/updateUser/v1` |
| `src/organization/_api/settings/sendInvite_v1.ts` | `api/organization/settings/sendInvite/v1` |
| `src/playground/_api/streamCounter_v1.ts` | `api/playground/streamCounter/v1` |

Files that do not match the `_v<N>` suffix are not discovered. The version digit must be a positive integer. Versions are sorted numerically when emitted into the type map.

Folders prefixed with `_` are private — they may sit alongside `_api/`, `_sync/`, `_components/`, etc. without being treated as page routes by the frontend router.

## Per-route exports

Each route file declares its behavior via exports. The discovery walker captures these via the TypeScript compiler API and emits them into the runtime map.

```ts
// src/settings/_api/updateUser_v1.ts
import type { AuthProps } from '@luckystack/core';
import type { ApiResponse } from 'src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 20;
export const httpMethod = 'POST' as const;
export const auth: AuthProps = { login: true };

export interface ApiParams {
  data: { name: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  // ...
  return { status: 'success', ok: true };
};
```

| Export | Type | Default | Effect |
| --- | --- | --- | --- |
| `main` | `(params) => Promise<ApiResponse>` | required | Handler invoked by `executeApiHandler` inside the `tryCatch` + Sentry span. |
| `auth` | `AuthProps` | required | Auth gate (see [`./auth-flow.md`](./auth-flow.md)). |
| `rateLimit` | `number \| false` | `rateLimiting.defaultApiLimit` from config | Per-route requests-per-window cap. `false` disables the per-route bucket; the global IP bucket still applies. See [`./rate-limiting.md`](./rate-limiting.md). |
| `httpMethod` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'` | inferred from name | Overrides `inferHttpMethod` for the HTTP transport. Socket transport ignores this field. |
| `ApiParams` interface | `{ data, user, functions, stream? }` | required | TypeScript-only. The `data` field's type is what `validateInputByType` checks at runtime via the generated Zod schema. |
| `validation` | `'strict' \| 'relaxed' \| { input: 'skip' \| 'strict' }` | `'strict'` | Socket-only escape hatch for public webhooks where the third-party payload is not modelable in TypeScript. See "Input validation" below. |

`ApiResponse` is exact: either `{ status: 'success'; httpStatus?: number; ...payload }` or `{ status: 'error'; errorCode: string; errorParams?: [...]; httpStatus?: number }`. Returning anything else is a runtime error (`api.invalidResponseStatus`).

## HTTP-method inference

Used by `handleHttpApiRequest` when the route file does not export `httpMethod`. Implemented in `inferHttpMethod` (from `@luckystack/core/src/httpApiUtils.ts`):

| Name prefix (case-insensitive, last `/`-segment) | Inferred method |
| --- | --- |
| `get*`, `fetch*`, `list*` | `GET` |
| `delete*`, `remove*` | `DELETE` |
| `update*`, `edit*`, `patch*` | `PUT` |
| Everything else (`create*`, `send*`, `sync*`, bare verbs) | `POST` |

The inference reads the last segment before the version token. `api/admin/users/getList/v1` infers `GET`; `api/admin/getUsers/v2` also infers `GET`.

The socket transport does not validate HTTP method — only the HTTP transport does. Mismatches return `api.methodNotAllowed` + `405` with `errorParams: [{ key: 'method', value: expectedMethod }]`.

## Input validation

The discovery walker reads the `data` field of the `ApiParams` interface (or whatever the `main` parameter's `data` member is named) and:

1. Emits the **text form** of the type into the runtime map (`apiEntry.inputType`).
2. Emits a **Zod schema** for the same type into `apiInputSchemas.generated.ts` for runtime checking + test-runner fuzz.
3. Emits the **structural type** into `apiTypes.generated.ts` so `apiRequest({ name, version, data })` on the client gets full autocomplete + a compile-time error if `data` does not match.

At request time, `validateInputByType({ typeText, value, rootKey: 'data', filePath })` matches the payload against the stored type. The validator lazy-loads `@luckystack/devkit`'s deep resolver in dev so imported / re-exported aliases expand correctly; in production it falls back to a static resolver.

The per-route `validation` flag turns the validator off:

```ts
// Public webhook receiving a payload from Stripe / Slack / GitHub
export const validation = 'relaxed' as const;

// Or, equivalent:
export const validation = { input: 'skip' } as const;
```

Use sparingly. The skip suppresses both `api.invalidInputType` rejections and the dev-only "no inputType" warning. `postApiValidate` still fires with `{ status: 'success' }` so audit handlers see the skip.

## Wire-level route examples

```
api/system/session/v1           ← src/_api/session_v1.ts
api/system/logout/v1            ← src/_api/logout_v1.ts (built-in socket shortcut)
api/settings/updateUser/v1      ← src/settings/_api/updateUser_v1.ts
api/organization-settings/sendInvite/v1
                                ← src/organization-settings/_api/sendInvite_v1.ts
api/admin/users/listAll/v3      ← src/admin/_api/users/listAll_v3.ts
```

## Reserved routes

| Route | Owner | Notes |
| --- | --- | --- |
| `api/system/logout/v1` | `handleApiRequest` (socket only) | Short-circuited before runtime map lookup. Calls `logout(...)` from `@luckystack/login`. HTTP requests for this route go through the normal pipeline. |
| `api/system/session/v1` | Project | Conventional location for the session-fetch endpoint. Not framework-reserved. |

Consumer routes whose final segment happens to be `logout` (`admin/logout/v1`) are NOT hijacked — the short-circuit matches the full normalized route `system/logout`, not just the trailing segment.

## Hooks dispatched

Discovery / route-naming hooks live in `@luckystack/devkit`. The runtime API handler does not emit routing-level hooks beyond the standard `pre/postApiValidate` / `pre/postApiExecute` / `pre/postApiRespond` / `transformApiResponse` / `rateLimitExceeded` set. See [`./api-request-lifecycle.md`](./api-request-lifecycle.md).

## Config keys

| Key | Effect |
| --- | --- |
| `paths.srcDir` | Root directory for `_api/` discovery (devkit). |
| `paths.generatedSocketTypes` | Output path for `apiTypes.generated.ts` (devkit). |
| `paths.generatedApiSchemas` | Output path for `apiInputSchemas.generated.ts` (devkit). |
| `paths.generatedApiDocs` | Output path for `apiDocs.generated.json` (devkit). |

No routing-specific keys are read at request time by `@luckystack/api`.

## Edge cases

- **Two files normalize to the same route key.** `assertNoDuplicateNormalizedRouteKeys` (devkit) throws at generation time. The runtime map will reflect whichever file was loaded last; treat the throw as a build-time guard.
- **File saved without a version suffix.** Discovery skips the file. The route never registers; `apiRequest` calls fail with `api.notFound` at runtime.
- **`auth` export missing.** TypeScript will not compile; if compilation is bypassed, the runtime map's `apiEntry.auth` is `undefined` and the auth gate treats it as `{ login: false }`. Do not rely on this — declare `auth` explicitly.
- **Non-`_api/` folders matching the regex.** Discovery only descends through folders; the marker segment `_api` is required, and folders without the underscore prefix are ignored.

## Related

- API request lifecycle: [`./api-request-lifecycle.md`](./api-request-lifecycle.md)
- Generated types: [`./generated-types.md`](./generated-types.md)
- Architecture: [`/docs/ARCHITECTURE_ROUTING.md`](../../../docs/ARCHITECTURE_ROUTING.md)
- Devkit type-map: `@luckystack/devkit/docs/type-map-generation.md`
- Devkit loader pipeline: `@luckystack/devkit/docs/loader-pipeline.md`
