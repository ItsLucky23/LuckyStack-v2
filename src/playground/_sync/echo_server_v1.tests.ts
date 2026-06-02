import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/echo/v1` (sync server handler).
//? The auto-sweep does not walk sync routes for its contract layer, so this
//? per-route case is what verifies the room fan-out demo: an echo request
//? lands a `success` envelope and reaches a recipient in the receiver room.
//?
//? Transport note: over the HTTP `callSync` path the final envelope is
//? `{ status: 'success', message }` — the per-recipient `serverOutput`
//? (echoed `message` / `senderId`) is fanned out on the `sync` socket
//? channel to ROOM members, not folded into the originator's HTTP return.
//? A `ctx.watchStream` second socket joins the room so the route finds a
//? recipient (otherwise the handler returns `sync.noReceiversFound`). echo
//? has no `_client` handler and emits no `status: 'stream'` chunks, so the
//? watcher's chunk buffer stays empty by design — its job here is purely to
//? populate the receiver room.
//?
//? Input shape (from the route source `echo_server_v1.ts`):
//?   { message: string }
//? Output envelope (HTTP final):
//?   { status: 'success', message: string }
//?   | { status: 'error', errorCode: 'sync.noReceiversFound' | ... }

interface EchoSyncResponse {
  status: string;
  message?: string;
  errorCode?: string;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'echo fans out to a room member and returns a success envelope',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const room = session.token;
      //? socket B joins the room so the fan-out finds at least one recipient.
      const watcher = await ctx.watchStream(room);

      const result = await ctx.callSync<unknown, EchoSyncResponse>(
        { message: 'sync-echo-hello' },
        { receiver: room },
      );
      ctx.expect.eq(result.status, 'success');

      await watcher.close();
    },
  },
  {
    name: 'missing receiver is rejected with sync.missingReceiver',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      //? An empty receiver short-circuits before the handler runs — the
      //? framework requires a room to fan out into.
      const result = await ctx.callSync<unknown, EchoSyncResponse>(
        { message: 'no-room' },
        { receiver: '' },
      );
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'sync.missingReceiver');
    },
  },
];
