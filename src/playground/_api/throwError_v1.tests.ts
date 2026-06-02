import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/throwError/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, and fuzz crash-resistance (which exercises the default
//? `throw` path). The cases below cover the `returnError` branch the sweep
//? can't infer: it returns the caller-chosen errorCode (or the documented
//? default) without throwing.
//?
//? Input shape (from the route source `throwError_v1.ts`):
//?   { mode?: 'throw' | 'returnError'; errorCode?: string }
//? Output envelope:
//?   { status: 'error', errorCode: string }

interface ThrowErrorResponse {
  status: string;
  errorCode?: string;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'returnError mode echoes the caller-supplied errorCode',
    run: async (ctx: TestContext) => {
      const result = await ctx.callApi<unknown, ThrowErrorResponse>({
        mode: 'returnError',
        errorCode: 'playground.customCode',
      });
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'playground.customCode');
    },
  },
  {
    name: 'returnError mode falls back to the default code when none is given',
    run: async (ctx: TestContext) => {
      const result = await ctx.callApi<unknown, ThrowErrorResponse>({ mode: 'returnError' });
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'playground.simulatedError');
    },
  },
  {
    name: 'default throw mode normalizes the uncaught throw to an error envelope',
    run: async (ctx: TestContext) => {
      //? No `mode` → defaults to 'throw'. handleApiRequest catches the throw,
      //? dispatches the apiError hook, and normalizes to a stable error
      //? envelope (`api.internalServerError` per the route source comment) —
      //? never a 5xx or a hang.
      const result = await ctx.callApi<unknown, ThrowErrorResponse>({});
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'api.internalServerError');
    },
  },
];
