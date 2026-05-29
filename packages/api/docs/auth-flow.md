# Auth Flow

> Last updated: 2026-05-20

## Overview

`@luckystack/api` does not own authentication — it consumes `getSession` from `@luckystack/login` and `validateRequest` from `@luckystack/core`. The handler's job is to translate the per-route `AuthProps` declaration into the right gate (require login + optional predicate checks) and to attribute every framework error tracker call that follows to the right user.

Auth runs **early** in the pipeline (step 2 + step 6 of the 13-step lifecycle), and it runs **before** rate limit, method check, and input validation. The ordering is deliberate: unauthenticated callers should not be able to enumerate routes via 404 vs 405 vs 400 timing, or learn input shapes via `inputValidation.message`. A failing auth gate always returns a generic `auth.required` (or `auth.forbidden`) before any of those signals leak.

The auth gate has two stages: a login check (cheap, boolean — does the session have a user ID?), then a predicate check (`validateRequest` evaluates `auth.additional[]`). Each can fail with a distinct error code + HTTP status. The HTTP transport also runs a defensive `if (!user)` check after the login gate to catch the edge case where `auth.login === false` was declared but downstream code still expects a user.

## Lifecycle stages owning auth

| Step | What happens |
| --- | --- |
| 2 (early) | `getSession(token)` → `setSentryUser(user)`. Read once per request; downstream code reads `user` as a closure variable. |
| 6 | `checkApiAuth({ apiEntry, user, name, emitApiError })` (or the inline HTTP block) runs the login + predicate gate. Rejection short-circuits the pipeline. |
| 4 (socket only) | `system/logout` shortcut. When the route normalizes to `system/logout`, the handler calls `logout(...)` directly and emits a success envelope — bypassing the runtime-map lookup, the auth gate, and every subsequent step. |

## API Reference

### `getSession(token)` (from `@luckystack/login`)

Read at request time. Returns `Promise<SessionLayout | null>`. Reads from the active session adapter (Redis by default); applies sliding-expiration (dispatches `preSessionRefresh` / `postSessionRefresh` hooks).

A `null` return means: no session token, an expired session, a deleted session, or a session-adapter outage. The handler treats all four identically — `user` is `null` for the rest of the request, and `auth.login: true` rejects with `auth.required`.

### `setSentryUser(user)` (from `@luckystack/error-tracking`)

Called immediately after `getSession`. Records `{ id, email }` (or `null` for unauthenticated requests) on every active error tracker so that any subsequent `captureException` / `captureMessage` (including from inside `main(...)`) is attributed to this user.

### `checkApiAuth(...)` (internal helper, socket transport)

**Signature**:

```ts
const checkApiAuth = (params: {
  apiEntry: RuntimeApiEntry;
  user: SessionLayout | null;
  name: string;            // The pre-normalization route name; used for log context.
  emitApiError: EmitApiError;
}): boolean;
```

**Behavior**:

1. If `apiEntry.auth.login === true` and `user?.id` is missing, emit `auth.required` + `401`. Return `false`.
2. Otherwise, run `validateRequest({ auth: apiEntry.auth, user: user! })`.
3. If the result is `{ status: 'error', errorCode, errorParams, httpStatus }`, emit it (defaulting to `auth.forbidden` + `403` when fields are missing). Return `false`.
4. Otherwise, return `true`.

The function logs auth failures at `warn` level when `logging.devLogs` is on.

### Inline auth block in `handleHttpApiRequest`

The HTTP transport inlines the same logic but adds a defensive `if (!user)` check between the login gate and the predicate gate:

```ts
if (auth.login && !user?.id) {
  return buildNetworkError({ response: { status: 'error', errorCode: 'auth.required' }, fallbackHttpStatus: 401 });
}

if (!user) {
  return buildNetworkError({ response: { status: 'error', errorCode: 'auth.forbidden' }, fallbackHttpStatus: 403 });
}
```

This catches the configuration drift where a route declared `auth.login: false` but the predicate evaluator (`validateRequest`) still expects a non-null user (its parameter type is `BaseSessionLayout`, not `BaseSessionLayout | null`). In practice this only matters if you opt out of login but still declare `auth.additional[]` checks — in that case, `validateRequest` would dereference `null`. The guard short-circuits with `auth.forbidden` first.

### `validateRequest({ auth, user })` (from `@luckystack/core`)

The predicate evaluator.

**Signature**:

```ts
function validateRequest(params: {
  auth: AuthProps;
  user: BaseSessionLayout;
}): {
  status: 'success' | 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean }[];
  httpStatus?: number;
};
```

**Behavior**: walks `auth.additional[]` (if present). Each entry references a `key` on the session object and adds up to four AND'd constraints:

| Constraint | Semantics |
| --- | --- |
| `nullish: true` | `user[key]` must be `null` or `undefined`. |
| `nullish: false` | `user[key]` must NOT be `null` or `undefined`. |
| `type: 'string' \| 'number' \| 'boolean'` | `typeof user[key]` must match. Skipped if `user[key]` is null/undefined. |
| `value: <x>` | Strict equality `user[key] === x`. Use `'value' in condition` semantics: omit the key entirely if you don't want the check (setting `value: undefined` explicitly means "must be undefined"). |
| `mustBeFalsy: true` | `isFalsy(user[key])`. |
| `mustBeFalsy: false` | `!isFalsy(user[key])`. |

Multiple constraints on a single entry are AND'd. Multiple entries in the array are also AND'd — every entry must pass.

**Errors**:

| Condition | Returns |
| --- | --- |
| `condition.key` does not exist on the session object | `{ errorCode: 'auth.invalidCondition', errorParams: [{ key: 'key', value: <missingKey> }], httpStatus: 500 }`. This is a setup error, not a runtime auth fail — a route asked for a session field the project's `SessionLayout` does not declare. |
| Any constraint fails | `{ errorCode: 'auth.forbidden', errorParams: [{ key: 'key', value: <failingKey> }], httpStatus: 403 }`. |
| All constraints pass | `{ status: 'success' }`. |

### `logout({ token, socket, userId })` (from `@luckystack/login`)

Only reachable via the `system/logout` socket shortcut. Calls `deleteSession(token)` (which dispatches `preSessionDelete` → adapter delete + active-user untrack → `postSessionDelete`), emits `socketEventNames.logout` to the socket, and leaves the socket room.

The shortcut bypasses every later step: runtime-map lookup, auth gate, rate limit, validation, hooks (no `preApiExecute` / `postApiExecute`), execution, and respond hooks. Logout is a built-in, not a user-defined route.

## `AuthProps` shape

```ts
interface AuthProps {
  /** If true, user must have a valid session with an ID. */
  login: boolean;

  /** Additional validation rules for session properties. */
  additional?: {
    key: keyof BaseSessionLayout;   // The session field to inspect (e.g. 'admin').
    value?: unknown;                // Strict equality.
    type?: 'string' | 'number' | 'boolean';
    nullish?: boolean;
    mustBeFalsy?: boolean;
  }[];
}
```

Project code typically declares `AuthProps` like:

```ts
// src/admin/_api/banUser_v1.ts
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true },
  ],
};
```

`additional[].key` is constrained by `keyof BaseSessionLayout` — the project's `SessionLayout` extends `BaseSessionLayout`, so any field the project adds (e.g. `admin: boolean`, `organizationId: string`) is type-checkable. Referencing a key the session does not declare is a TypeScript error at compile time and a `500` `auth.invalidCondition` at runtime.

## Error codes

| Code | When | HTTP status |
| --- | --- | --- |
| `auth.required` | `auth.login === true` and `user?.id` is missing. | 401 |
| `auth.forbidden` | `auth.additional[]` predicate rejects, or the HTTP-transport defensive `if (!user)` fires. | 403 |
| `auth.invalidCondition` | `auth.additional[].key` is not present on the session shape. Setup error. | 500 |
| Custom `errorCode` from `validateRequest` | Custom predicate (none ship by default) overrides the fallback. | Custom `httpStatus`, default 403. |

All four codes go through `normalizeErrorResponse` so the localized normalizer can render a translated message (see [`./error-handling.md`](./error-handling.md)).

## Ordering: why auth runs before rate limit

Auth is step 6 of 13. Rate limit is step 7. The comment in `handleApiRequest.ts` puts it bluntly:

```ts
//? Auth → rate-limit → validate → execute → respond.
//? Auth runs before validate so unauthenticated probes can't enumerate
//? routes or learn input shape from `inputValidation.message`.
```

In practice this means:

- An anonymous caller hitting a `login: true` route gets `auth.required` for every request, regardless of the route's input shape, regardless of whether the route exists.
- An anonymous caller hitting a route that does **not** exist gets the SAME `auth.required` (because the route lookup is step 5, before auth at step 6, but the runtime map check returns `api.notFound` early — see edge case below).

Wait — re-reading the pipeline: step 5 (`getRuntimeApiMaps + route lookup`) DOES run before auth. That is intentional: route lookup is needed to read `apiEntry.auth`. An unknown route returns `api.notFound` to the anonymous caller. That is a known leak (route names are enumerable by an anonymous caller); deliberate, since route names are not secret (the client bundle ships them anyway). The defense is at the input-shape and `auth.forbidden` boundary, where predicate details and validation messages would otherwise leak.

## Authorization extension points

The auth gate's predicate engine is intentionally small. Two ways to add custom behavior:

1. **Session-field predicates via `auth.additional[]`.** Add fields to your project's `SessionLayout` (via `BaseSessionLayout` module augmentation) and reference them by key. Examples: `admin`, `organizationId`, `plan`, `verified`. The session is populated by `@luckystack/login`'s adapter system — see `@luckystack/login` docs.

2. **Hook-based auth via `preApiExecute`.** Register a hook that inspects `user` + `routeName` + `data` and returns a stop signal:

   ```ts
   registerHook('preApiExecute', async ({ routeName, user, data }) => {
     if (routeName.startsWith('admin/') && !user?.admin) {
       return { stop: true, errorCode: 'auth.forbidden', httpStatus: 403 };
     }
   });
   ```

   `preApiExecute` runs after the per-route `AuthProps` gate, so use it for cross-cutting rules (admin gate across many routes, organization scoping, feature flags) rather than per-route checks.

For more complex authorization (RBAC, per-resource ACLs), keep the framework gate at the coarse-grained level (`login: true`, `admin: true`) and run fine-grained checks inside `main(...)`.

## Hooks dispatched

The auth gate itself does not dispatch hooks. Adjacent hooks that observe auth state:

| Hook | When | Payload |
| --- | --- | --- |
| `preSessionRefresh` / `postSessionRefresh` | Inside `getSession`, on every authenticated request | `{ token, oldTtl, newTtl }`. `preSessionRefresh` can stop the TTL extend. |
| `preApiExecute` | After the `AuthProps` gate, before `main(...)` | `{ routeName, data, user }`. Can stop with `{ errorCode, httpStatus }` for custom authorization. |

See [`./api-request-lifecycle.md`](./api-request-lifecycle.md) for the full hook order.

## Config keys

This package does not read any auth-specific config. `@luckystack/login` owns session policy:

- `session.expiryDays` (TTL for `getSession` sliding-extend).
- `session.perUser`, `session.maxConcurrentPerUser`, `session.onConflict` (single-session enforcement on new login).
- `auth.passwordPolicy.*` (credentials register / change paths).
- `auth.forgotPassword` (framework vs custom vs disabled).

Read those in `@luckystack/login/CLAUDE.md`.

## Edge cases

- **`user.id` is `0` or `''`.** The check is `!user?.id` — both falsy values reject with `auth.required`. Session adapters should never write a falsy ID; if you customize the user adapter, ensure IDs are truthy.
- **`auth.login: false` + `auth.additional[]` declared.** The login gate passes (no ID required), but the predicate engine receives a possibly-null user. The socket transport asserts `user!` and relies on `validateRequest`'s nullish guards (constraints are skipped when `user[key]` is null/undefined). The HTTP transport adds the defensive `if (!user)` short-circuit. Don't rely on this combination — declare `login: true` if you need session field checks.
- **Session deleted between `getSession` and `validateRequest`.** Not possible — `user` is captured once at step 2 and used as a closure. Subsequent revocations affect later requests, not this one.
- **`system/logout` race with concurrent requests on the same socket.** `logout` runs synchronously inside the API handler; concurrent requests on the same socket may have already resolved `getSession` before the logout completes. Those requests see a still-valid session. The next request to enter step 2 sees the deleted session.
- **OAuth callback or login HTTP routes.** Those live in `@luckystack/server`'s HTTP route table (`/auth/callback/<provider>`, `/auth/api/credentials`), not in `/api/*`. The auth gate documented here is for `/api/*` traffic only. Login endpoints have their own session-minting flow inside `@luckystack/login`.

## Related

- API request lifecycle: [`./api-request-lifecycle.md`](./api-request-lifecycle.md)
- Error handling: [`./error-handling.md`](./error-handling.md)
- Session management: `@luckystack/login/docs/session-management.md`
- OAuth providers: `@luckystack/login/docs/oauth-providers.md`
- Architecture: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md), [`/docs/ARCHITECTURE_SESSION.md`](../../../docs/ARCHITECTURE_SESSION.md)
