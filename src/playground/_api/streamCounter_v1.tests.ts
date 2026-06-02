import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/streamCounter/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below assert the
//? deterministic business logic the sweep can't reach: input clamping
//? (ticks 1..200) and the triangular-sum math returned in the envelope.
//?
//? Input shape (from the route source `streamCounter_v1.ts`):
//?   { ticks?: number; intervalMs?: number }
//? Output envelope:
//?   { status: 'success', result: { totalTicks: number; finalSum: number } }

interface CounterResponse {
  status: string;
  result?: { totalTicks?: number; finalSum?: number };
}

export const customTests: CustomTestCase[] = [
  {
    name: 'finalSum is the triangular sum of the requested tick count',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      //? 5 ticks → sum(1..5) = 15. Use the minimum 20ms interval so the
      //? streamed run finishes quickly (4 gaps × 20ms ≈ 80ms).
      const result = await ctx.callApi<unknown, CounterResponse>({ ticks: 5, intervalMs: 20 });
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.totalTicks, 5);
      ctx.expect.eq(result.result?.finalSum, 15);
    },
  },
  {
    name: 'ticks below the floor are clamped up to 1',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      //? `Math.max(1, Math.min(200, ticks ?? 10))` clamps 0 up to 1, so the
      //? single tick yields totalTicks=1 and finalSum=1.
      const result = await ctx.callApi<unknown, CounterResponse>({ ticks: 0, intervalMs: 20 });
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.totalTicks, 1);
      ctx.expect.eq(result.result?.finalSum, 1);
    },
  },
];
