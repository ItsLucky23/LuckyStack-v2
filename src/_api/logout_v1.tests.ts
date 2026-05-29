import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `/logout/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below assert the
//? business-logic invariants the sweep can't reach.
//?
//? Input shape: Record<string, never> (no body).
//?
//? Behavioral note: this route's `main` is a tiny `{ status: 'success', result: true }`
//? — the actual session-teardown work happens in the server's transport
//? layer (cookie clearing + redirect via the HTTP route handler in
//? `@luckystack/server`). For the JSON-only fetch this test layer uses, we
//? therefore assert the API-shape contract: success + idempotent across calls.

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: authenticated user logout returns success',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      const result = await ctx.callApi<Record<string, never>, { status: string; result?: unknown }>({});
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result, true);
    },
  },
  {
    name: 'idempotent: logging out when not logged in still returns success',
    run: async (ctx: TestContext) => {
      //? Skip `ctx.session.login()` — call the API anonymously. The route
      //? declares `auth.login: false`, so it must succeed without a session
      //? and not error on the missing user.
      const result = await ctx.callApi<Record<string, never>, { status: string; result?: unknown }>({});
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result, true);
    },
  },
];
