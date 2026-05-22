# Architecture — Testing

> Spec for the two test layers shipped with `@luckystack/test-runner`. Last updated 2026-05-22.

## TL;DR

```
npm run test                                # both layers
npm run scaffold:test <page>/<name>/<v>     # create a per-route stub
```

- **Auto-sweep** runs against every endpoint automatically. You write nothing.
- **Per-route business-logic tests** live next to the route source. You write one file per route covering the assertions the sweep can't reach.

---

## Layer 1 — Auto-sweep

Built into `@luckystack/test-runner`. Walks `apiMethodMap` (the generated route registry in `src/_sockets/apiTypes.generated.ts`) and runs four progressive checks against every endpoint:

| Check | What it asserts | Implementation |
|---|---|---|
| **Contract** | Endpoint returns a `{ status: 'success' \| 'error', … }` envelope without crashing on a minimal valid input. Catches "endpoint throws an unhandled exception on the happy path". | `runContractTests()` (`contractCheck.ts`) |
| **Auth enforcement** | Endpoints with `auth.login: true` reject unauthenticated calls with `errorCode: 'auth.required'`. Catches "I marked the route as login-required but never actually enforced it". | `runAuthEnforcementTests()` (`authEnforcementCheck.ts`) |
| **Rate limit** | After `rateLimit + 1` calls in a window, the endpoint rejects with `errorCode: 'api.rateLimitExceeded'`. Catches "I configured a rate limit but it's not wired". | `runRateLimitTests()` (`rateLimitCheck.ts`) |
| **Fuzz** | Endpoint doesn't 5xx or hang on junk inputs (null, deeply nested, prototype pollution, NaN, etc.). Catches input-validation gaps. | `runFuzzTests()` (`fuzzCheck.ts`) |

You add nothing for these. Every new route gets them for free.

---

## Layer 2 — Per-route business-logic tests

For assertions the sweep can't infer:

- **Post-conditions** — "did the `postRegister` hook fire with the right payload?", "was a row inserted?", "did the cache get invalidated?"
- **Integration** — "logging in user A doesn't leak user B's data into the session"
- **Edge cases** — boundary values that are technically valid but business-meaningful
- **Idempotency** — calling the route twice with the same input is safe (or correctly rejects)

### File location and naming

| Route source | Test file |
|---|---|
| `src/<page>/_api/<name>_v<N>.ts` | `src/<page>/_api/<name>_v<N>.tests.ts` |
| `src/<page>/_sync/<name>_server_v<N>.ts` | `src/<page>/_sync/<name>_server_v<N>.tests.ts` |

The runner discovers files by the `.tests.ts` suffix alongside route source. Filename binds the test to the route — you don't repeat the path inside.

### File format

```ts
import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/updateUser/v1`. The auto-sweep already
//? covers contract validation, auth enforcement, rate-limit clamp, and
//? fuzz crash-resistance. Add cases below for business-logic assertions
//? the sweep can't reach.
//?
//? Suggested scenarios:
//? [ ] Happy path with valid input → expected output shape + side effects
//? [ ] Authenticated user A cannot affect user B's data
//? [ ] Post-conditions: did the expected hook fire? row inserted?
//? [ ] Edge case: missing optional field, boundary values
//? [ ] Idempotency: calling twice with the same input is safe (if applicable)

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path updates name and email',
    run: async (ctx) => {
      const session = await ctx.session.login();
      const result = await ctx.callApi({ name: 'Alice', email: 'alice@example.com' });
      ctx.expect.eq(result.status, 'success');

      const updated = await ctx.prisma.user.findUnique({ where: { id: session.userId } });
      ctx.expect.eq(updated?.name, 'Alice');
      ctx.expect.eq(updated?.email, 'alice@example.com');
    },
  },
  {
    name: 'cannot update another user',
    run: async (ctx) => {
      const victim = await ctx.session.login({ email: 'victim@example.com' });
      await ctx.session.logout();
      const attacker = await ctx.session.login({ email: 'attacker@example.com' });

      const result = await ctx.callApi({ targetUserId: victim.userId, name: 'pwned' });
      ctx.expect.eq(result.status, 'error');
    },
  },
];
```

### `TestContext` shape

```ts
export interface TestContext {
  /** Invoke the route under test (page/name/version baked in from the filename). */
  callApi: <TInput, TOutput>(input: TInput) => Promise<TOutput>;
  callSync: <TInput, TOutput>(input: TInput, opts?: { receiver?: string }) => Promise<TOutput>;

  /** Session helpers — reuse the same fixtures the auth-enforcement sweep uses. */
  session: {
    login: (user?: { email?: string; id?: string }) => Promise<{ token: string; userId: string }>;
    logout: () => Promise<void>;
    current: () => { token: string | null; userId: string | null };
  };

  /** Direct Prisma client for state assertions. */
  prisma: PrismaClient;

  /** Minimal assertion helpers — no external dependency. */
  expect: {
    eq: <T>(actual: T, expected: T, message?: string) => void;
    ok: (value: unknown, message?: string) => void;
    throws: (fn: () => unknown, message?: string) => Promise<Error>;
    matches: (value: string, pattern: RegExp, message?: string) => void;
  };
}
```

### `CustomTestCase` shape

```ts
export interface CustomTestCase {
  name: string;
  run: (ctx: TestContext) => Promise<void>;
}
```

Throw from `run` to fail the case. The thrown error's message is included in the output. The runner catches; one failing case does not stop the others.

---

## Running tests

```
npm run test                          # all layers, all routes
npm run test -- --no-fuzz             # skip the fuzz layer (faster local iteration)
npm run test -- --no-sweep            # only per-route custom tests
npm run test -- --only-custom         # alias for --no-sweep
npm run test -- --filter settings     # only routes whose path matches the substring
```

Exit code 0 if all pass, 1 if any failed. The CLI prints a per-route table and a final summary count.

### Side effects

Tests hit the real Prisma client + Redis. Run them against your dev environment (`.env.local`) — they will mutate state. Conventions:

- Use unique emails / identifiers per test (e.g. `test-${nanoid()}@example.com`) so cases don't collide.
- Clean up in your test logic when feasible — but the framework does NOT auto-rollback. Consider a dedicated test database if isolation matters.

---

## Creating a new test stub

```
npm run scaffold:test <page>/<name>/<version>
```

Example: `npm run scaffold:test settings/updateUser/v1` creates `src/settings/_api/updateUser_v1.tests.ts` with:

- Boilerplate imports.
- Comment block listing common scenarios as a TODO checklist.
- The route's input shape inlined as a comment (from `apiTypes.generated.ts`) so you don't have to look it up.
- One placeholder `CustomTestCase` that throws `TODO: implement this test case` — replace with real assertions.

The script refuses to overwrite an existing test file. If you want to regenerate, delete the old one first.

The CLAUDE.md "Testing" section requires running this for every new route and filling in at least one happy-path case before declaring done.

---

## Extending the sweep with a custom layer

The framework ships an `extensionRegistry` so consumers can add their own sweep layer (e.g. "every endpoint must have a specific custom header"). Call `registerTestLayer({ name, run })` at boot before invoking the runner. See `packages/test-runner/src/extensionRegistry.ts` for the contract. Per-route business-logic tests are the right tool for endpoint-specific assertions; custom sweep layers are for cross-cutting checks.

---

## Failure output

```
[luckystack-test] Running auto-sweep (4 layers) + custom tests (3 routes)…

  ✓ contract                       28/28
  ✓ auth-enforcement               19/19
  ✓ rate-limit                     28/28
  ✓ fuzz                           28/28
  ✗ custom (settings/updateUser/v1)
    ✗ cannot update another user
      AssertionError: expected 'error' got 'success'
        at run (src/settings/_api/updateUser_v1.tests.ts:31:18)

Summary: 102 passed, 1 failed in 4.2s
```

The route path + test case name + line number are always in the output so you can jump straight to the failing assertion.
