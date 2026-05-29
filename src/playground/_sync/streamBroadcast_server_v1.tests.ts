import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/streamBroadcast/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases target the
//? per-route behavior the sweep can't infer — response envelope shape +
//? token-count math + throttle toggle + observable chunk stream through
//? the second-socket harness.
//?
//? Input shape (from `streamBroadcast_server_v1.ts`):
//?   { text: string; intervalMs?: number; throttle?: boolean }
//? Output envelope (server response):
//?   { status, message, senderId, tokenCount, throttled }
//?
//? `ctx.watchStream(roomCode)` opens a second socket joined to `roomCode`
//? and exposes the chunk frames pushed by `broadcastStream` so the test
//? can assert chunk count, ordering and (with throttle on) batching.

interface BroadcastResponse {
  status: string;
  message: string;
  senderId: string;
  tokenCount: number;
  throttled: boolean;
}

interface BroadcastChunkFrame {
  /** Buffered token text — the route's `broadcastStream({ chunk })` payload. */
  chunk?: string;
  /** Per-request correlation id stamped by the server. */
  cb?: string;
  fullName?: string;
  status?: 'stream';
  //? Open-ended — the wire frame spreads arbitrary payload fields on top
  //? of the envelope; this index signature lets the type extend the base
  //? `StreamChunkFrame` shape.
  [key: string]: unknown;
}

const SHORT_TEXT = 'hi there world';

export const customTests: CustomTestCase[] = [
  {
    name: 'unthrottled run returns envelope with positive tokenCount',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      const result = await ctx.callSync<unknown, BroadcastResponse>(
        { text: SHORT_TEXT, intervalMs: 5 },
        { receiver: ctx.session.current().token ?? 'test-room' },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.message, SHORT_TEXT);
      ctx.expect.eq(result.throttled, false);
      ctx.expect.ok(result.tokenCount > 0, 'expected tokenCount > 0');
    },
  },
  {
    name: 'throttle flag round-trips into the envelope',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      const result = await ctx.callSync<unknown, BroadcastResponse>(
        { text: SHORT_TEXT, intervalMs: 5, throttle: true },
        { receiver: ctx.session.current().token ?? 'test-room' },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.throttled, true);
    },
  },
  {
    name: 'second-socket harness observes the broadcast chunk stream',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const room = session.token;
      const watcher = await ctx.watchStream<BroadcastChunkFrame>(room);

      const result = await ctx.callSync<unknown, BroadcastResponse>(
        { text: SHORT_TEXT, intervalMs: 5 },
        { receiver: room },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.ok(result.tokenCount > 0, 'expected tokenCount > 0');

      //? Wait for at least the tokenCount the server reported. The
      //? broadcast emit happens during the request — by the time the
      //? envelope resolves, most chunks have flown. Allow up to 3s for
      //? the last few in-flight frames to arrive.
      await watcher.waitForCount(result.tokenCount, 3000);

      //? Every observed chunk MUST carry the route's full name + stream
      //? status. The watcher already filters by `fullName`, but assert
      //? the contract explicitly so a drift surfaces here.
      const first = watcher.chunks[0];
      ctx.expect.ok(first !== undefined, 'expected at least one chunk');
      ctx.expect.eq(first?.fullName, 'sync/playground/streamBroadcast/v1');
      ctx.expect.eq(first?.status, 'stream');
      //? At least one chunk must carry a non-empty `chunk` field — the
      //? route streams token slices, never empty frames.
      const anyText = watcher.chunks.some((c) => typeof c.chunk === 'string' && c.chunk.length > 0);
      ctx.expect.ok(anyText, 'expected at least one non-empty chunk text');

      await watcher.close();
    },
  },
  {
    name: 'throttle coalesces chunks — fewer wire frames than tokenCount',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const room = session.token;
      const watcher = await ctx.watchStream<BroadcastChunkFrame>(room);

      //? Long-ish text + small intervalMs (5 < throttle.flushEveryMs 50)
      //? guarantees several tokens batch per flush. Compare against an
      //? unthrottled baseline run.
      const longText = 'the quick brown fox jumps over the lazy dog and then keeps running through the meadow';

      const throttled = await ctx.callSync<unknown, BroadcastResponse>(
        { text: longText, intervalMs: 5, throttle: true },
        { receiver: room },
      );
      ctx.expect.eq(throttled.status, 'success');
      ctx.expect.eq(throttled.throttled, true);

      //? Wait for chunks to settle — throttled runs emit fewer frames than
      //? `tokenCount`, so we wait on a steady-state heuristic instead:
      //? `stopAt` resolves once 200ms have passed without a new chunk OR
      //? the maximum timeout hits. Approximated here by polling for a
      //? small count and then waiting an extra 250ms for any trailing
      //? batched flush.
      await watcher.waitForCount(1, 2000);
      await new Promise<void>((resolve) => setTimeout(resolve, 250));

      ctx.expect.ok(
        watcher.chunks.length < throttled.tokenCount,
        `expected throttled chunks (${String(watcher.chunks.length)}) < tokenCount (${String(throttled.tokenCount)})`,
      );

      await watcher.close();
    },
  },
];
