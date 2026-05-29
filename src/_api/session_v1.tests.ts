import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { getSession, saveSession } from '@luckystack/login';

//? Per-route tests for `/session/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Cases below assert business-logic
//? invariants the sweep can't reach.
//?
//? Input shape: Record<string, never> (no body).
//?
//? The route returns the `user` (SessionLayout | null) the framework resolved
//? from the session cookie. We assert it round-trips for an authenticated
//? caller and is null for an anonymous one.

interface SessionResultShape {
  id?: string;
  email?: string;
  name?: string;
  token?: string;
  provider?: string;
}

interface SessionResponse {
  status: string;
  result: SessionResultShape | null;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'authenticated caller gets back their session shape (id, email populated)',
    run: async (ctx: TestContext) => {
      const email = `session-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const { token, userId } = await ctx.session.login({ email });

      const result = await ctx.callApi<Record<string, never>, SessionResponse>({});
      ctx.expect.eq(result.status, 'success');
      ctx.expect.ok(result.result, 'expected a non-null session result for authenticated caller');
      const session = result.result ?? {};
      ctx.expect.eq(session.id, userId);
      ctx.expect.eq(session.email, email);
      ctx.expect.eq(session.token, token);
    },
  },
  {
    name: 'anonymous caller gets a null session',
    run: async (ctx: TestContext) => {
      //? No `ctx.session.login()` — no cookie sent. Route is `auth.login: false`
      //? so it must respond rather than 401, and `user` will be null.
      const result = await ctx.callApi<Record<string, never>, SessionResponse>({});
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result, null, 'unauthenticated session call should return null user');
    },
  },
  {
    name: 'reflects an updated session: re-saving the session changes what session/v1 returns',
    run: async (ctx: TestContext) => {
      const email = `session-update-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const { token } = await ctx.session.login({ email, name: 'Original Name' });

      const first = await ctx.callApi<Record<string, never>, SessionResponse>({});
      ctx.expect.eq(first.result?.name, 'Original Name');

      //? Read the existing session, mutate the name, write it back under the
      //? same token. The framework reads the session cookie -> Redis on
      //? every call, so the next /session/v1 must reflect the new value.
      const existing = await getSession(token);
      ctx.expect.ok(existing, 'expected to read back the session we just minted');
      if (!existing) return;
      const updated = { ...existing, name: 'Updated Name' };
      await saveSession(token, updated, false);

      const second = await ctx.callApi<Record<string, never>, SessionResponse>({});
      ctx.expect.eq(second.result?.name, 'Updated Name');
    },
  },
];
