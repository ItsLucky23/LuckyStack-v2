import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/echo/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below assert the one
//? thing the sweep can't infer: the echo round-trips the `message` field and
//? reflects the caller's session id (null when unauthenticated).
//?
//? Input shape (from the route source `echo_v1.ts`):
//?   { message: string }
//? Output envelope:
//?   { status: 'success', result: { echoed: string; receivedAt: string;
//?       sessionId: string | null } }

interface EchoResponse {
  status: string;
  result?: { echoed?: string; receivedAt?: string; sessionId?: string | null };
}

export const customTests: CustomTestCase[] = [
  {
    name: 'echoes the message and the authenticated session id',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login();
      const result = await ctx.callApi<unknown, EchoResponse>({ message: 'ping-123' });
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.echoed, 'ping-123');
      ctx.expect.eq(result.result?.sessionId, userId);
    },
  },
  {
    name: 'unauthenticated call echoes the message with a null sessionId',
    run: async (ctx: TestContext) => {
      //? auth.login is false, so no session is required. sessionId resolves to
      //? null when no session cookie is present.
      const result = await ctx.callApi<unknown, EchoResponse>({ message: 'anon-hello' });
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.echoed, 'anon-hello');
      ctx.expect.eq(result.result?.sessionId, null);
    },
  },
];
