import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `/logout/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below assert the
//? business-logic invariants the sweep can't reach.
//?
//? Input shape: Record<string, never> (no body).
//?
//? Behavioral note: this route's `main` is an INTENTIONAL no-op
//? `{ status: 'success', result: true }`. The real session teardown runs via the
//? framework's built-in `system/logout` shortcut + the `/auth/logout` HTTP route,
//? NOT this route (see src/_api/logout_v1.ts). This route exists only so a stray
//? `api/logout/v1` call returns a clean success instead of 404. These cases assert
//? that no-op API-shape contract: success + idempotent across calls.

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
