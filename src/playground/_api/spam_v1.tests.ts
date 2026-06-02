import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/spam/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp (the rate-limiter demo this route exists for), and fuzz
//? crash-resistance. The only assertion left for a per-route case is the
//? response envelope shape — `ok: true` plus an ISO timestamp and the
//? caller's session id.
//?
//? Input shape (from the route source `spam_v1.ts`):
//?   {}  // no fields
//? Output envelope:
//?   { status: 'success', result: { ok: true; at: string;
//?       sessionId: string | null } }

interface SpamResponse {
  status: string;
  result?: { ok?: boolean; at?: string; sessionId?: string | null };
}

export const customTests: CustomTestCase[] = [
  {
    name: 'returns ok with an ISO timestamp and the session id',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login();
      const result = await ctx.callApi<unknown, SpamResponse>({});
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.ok, true);
      ctx.expect.eq(result.result?.sessionId, userId);
      //? `at` is a server-side `new Date().toISOString()` — assert the shape.
      ctx.expect.matches(result.result?.at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    },
  },
];
