import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/throwSync/v1`.
//? The auto-sweep does not yet walk sync routes for the contract layer, so
//? this per-route case is what verifies the deliberate-throw demo: an
//? uncaught throw inside the sync server handler is caught by
//? `handleHttpSyncRequest` and normalized to a stable error envelope
//? (`sync.serverExecutionFailed`) rather than a 5xx or a hang.
//?
//? The throw happens inside `serverMain`, which runs BEFORE the
//? no-receivers check — so the normalized envelope surfaces regardless of
//? who is in the room. `callSync` still requires a `receiver`, supplied via
//? the session token below.
//?
//? Input shape (from the route source `throwSync_server_v1.ts`):
//?   { reason?: string }
//? Output envelope:
//?   { status: 'error', errorCode: 'sync.serverExecutionFailed' }

interface ThrowSyncResponse {
  status: string;
  errorCode?: string;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'deliberate throw normalizes to sync.serverExecutionFailed',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const result = await ctx.callSync<unknown, ThrowSyncResponse>(
        { reason: 'test-trigger' },
        { receiver: session.token },
      );
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'sync.serverExecutionFailed');
    },
  },
];
