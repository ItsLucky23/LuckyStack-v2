# Session Types

> Deep specs for the foundational session/auth types plus `validateRequest`, `isFalsy`, and `validateInputByType`. Source: `packages/core/src/sessionTypes.ts`, `validateRequest.ts`, `runtimeTypeValidation.ts`. Bijgewerkt: 2026-05-20.

## Overview

`BaseSessionLayout` is the structural contract every project session type extends. It lives in `@luckystack/core` (not `@luckystack/login`) so `validateRequest` can consume it without creating a circular dep: login depends on core for prisma/redis, so the session shape has to live in the lower layer. `@luckystack/login` re-exports the type for ergonomics — existing `import type { BaseSessionLayout } from '@luckystack/login'` paths keep working.

`AuthProps` defines the auth gate that every API/sync handler exports (`login: true/false` + an optional `additional[]` predicate list). `validateRequest({ auth, user })` is the runtime check that turns those declarations into a `ValidationResult`.

`validateInputByType` is the runtime input validator used by the api/sync handlers in dev. It lazy-loads `@luckystack/devkit` (the heavy TS compiler resolver) only when running in non-production. In production it short-circuits to success because the prod esbuild bundle marks devkit as external and the validator should not need TS to validate request bodies at request time.

## Types

```typescript
export interface SessionLocation {
  pathName: string;
  searchParams?: Record<string, string>;
}

export interface BaseSessionLayout {
  id: string;
  token: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarFallback?: string | null;
  admin?: boolean | null;
  language?: string | null;
  location?: SessionLocation;
  roomCodes?: string[];
  csrfToken?: string;
  lastLogin?: Date | string | null;
  previousLogin?: Date | string | null;
}

export interface AuthProps {
  login: boolean;
  additional?: {
    key: keyof BaseSessionLayout;
    value?: unknown;
    type?: 'string' | 'number' | 'boolean';
    nullish?: boolean;
    mustBeFalsy?: boolean;
  }[];
}

export interface ValidationResult {
  status: 'success' | 'error';
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean }[];
  httpStatus?: number;
}
```

### Extending `BaseSessionLayout`

Projects extend the type in their own `config.ts`:

```typescript
import type { BaseSessionLayout } from '@luckystack/core';

export interface SessionLayout extends BaseSessionLayout {
  organizationId?: string;
  role?: 'member' | 'admin' | 'owner';
}
```

The framework's `validateRequest` only inspects keys it knows from `BaseSessionLayout`; project-specific keys are checked via `additional[]`.

## API Reference

### `isFalsy(value: unknown): boolean`

**Signature:**
```typescript
export const isFalsy = (value: unknown): boolean
```

**Behavior:** Returns `true` for `false`, `0`, `0n`, `''`, `null`, `undefined`, or `NaN`. Everything else is truthy.

**Note:** This is a stricter "falsy" than JavaScript's coercion-based check because it ALSO treats `NaN` as falsy. Used inside `validateRequest` for the `mustBeFalsy` predicate.

### `validateRequest({ auth, user }): ValidationResult`

**Signature:**
```typescript
export const validateRequest = ({
  auth,
  user,
}: {
  auth: AuthProps;
  user: BaseSessionLayout;
}): ValidationResult
```

**Behavior (in order):**
1. If `auth.additional` is undefined → returns `{ status: 'success' }` immediately. (The `login` flag is enforced by the surrounding handler, not by this function.)
2. For each `condition` in `auth.additional`:
   - If `condition.key` is not in `user` → returns `{ status: 'error', errorCode: 'auth.invalidCondition', errorParams: [{ key: 'key', value: condition.key }], httpStatus: 500 }`. This is a developer setup error, not a runtime auth failure.
   - Reads `val = user[condition.key]`. Computes `isNullish = val === null || val === undefined`.
   - `nullish: true` requires `isNullish`; `nullish: false` requires NOT `isNullish`. Mismatch → forbid.
   - `type: 'string' | 'number' | 'boolean'` requires `typeof val === <type>` (skipped when `val` is nullish). Mismatch → forbid.
   - `'value' in condition` requires strict equality `val === condition.value`. The membership check distinguishes "no exact-value constraint" from `value: undefined` (the latter explicitly demands `val === undefined`).
   - `mustBeFalsy: true` requires `isFalsy(val)`; `mustBeFalsy: false` requires `!isFalsy(val)`. Mismatch → forbid.
3. After all conditions pass → returns `{ status: 'success' }`.

**Forbid shape:**
```typescript
{ status: 'error', errorCode: 'auth.forbidden', errorParams: [{ key: 'key', value: <key> }], httpStatus: 403 }
```

**Constraint AND-semantics:** Multiple fields on a single `additional` entry are AND'd (every specified field must pass). Entries across the array are also AND'd.

**Example — admin-only endpoint:**
```typescript
export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true, type: 'boolean' }],
};
```

**Example — verified email required:**
```typescript
export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'email', nullish: false, type: 'string' }],
};
```

### `validateInputByType({ typeText, value, rootKey, filePath? }): Promise<ValidationResult>`

**Signature:**
```typescript
type ValidationResult =
  | { status: 'success' }
  | { status: 'error'; message: string };

export const validateInputByType = async ({
  typeText,
  value,
  rootKey,
  filePath,
}: {
  typeText?: string;
  value: unknown;
  rootKey: string;
  filePath?: string;
}): Promise<ValidationResult>
```

**Behavior:**
1. When `typeText` is empty, whitespace, or literal `'any'` → returns `{ status: 'success' }`.
2. When `process.env.NODE_ENV === 'production'` → returns `{ status: 'success' }` (avoids loading the TS compiler in prod).
3. Otherwise lazy-imports `@luckystack/devkit` via an indirect module ID (`const devkitModuleId: string = '@luckystack/devkit'; await import(devkitModuleId)`) so `tsc` doesn't try to resolve devkit at build time (devkit depends on core — a literal import would be a build-time circular dep).
4. Calls `devkit.resolveRuntimeTypeText({ typeText, filePath })`. On `status: 'error'` returns `{ status: 'error', message: '<rootKey>: <message>' }`.
5. Otherwise calls the internal `validateType(resolvedType.typeText, value, rootKey)` recursive validator.

**Supported type forms (validateType):**
- Primitives: `string`, `number`, `boolean`, `true`, `false`, `null`, `undefined`, `Date` (accepts ISO string or `Date` instance).
- String/number literal types (single-quoted or double-quoted).
- Unions (`A | B`) — succeeds on first matching branch.
- Intersections (`A & B`) — requires all branches to succeed.
- Arrays (`T[]`) — checks every element.
- `Record<K, V>` — accepts any non-array object.
- Object literals `{ key?: T; key2: T2; [index: keyof IndexKey]: T }` — checks each named field, applies index signatures for unknown keys.
- `any` / `unknown` — always succeeds.
- Unresolved type aliases or generics return `{ status: 'error', message: '<path>: unresolved type <name>' }`.

**Edge cases:**
- The `__RUNTIME_UNRESOLVED__::<message>` sentinel from devkit surfaces as `{ status: 'error', message: '<path>: <message>' }` so a missing project type doesn't crash the request.
- Object validation rejects unknown keys when there is no matching index signature.
- Index-signature keys can be `string`, `number`, string-literal unions, or literal types; `number` keys require the key to match `/^-?\d+(\.\d+)?$/`.

## Related

- Function INDEX: `packages/core/CLAUDE.md`
- Architecture: `docs/ARCHITECTURE_SESSION.md`, `docs/ARCHITECTURE_AUTH.md`, `docs/ARCHITECTURE_API.md`
- README: `packages/core/README.md`
- Source: `packages/core/src/sessionTypes.ts`, `validateRequest.ts`, `runtimeTypeValidation.ts`
