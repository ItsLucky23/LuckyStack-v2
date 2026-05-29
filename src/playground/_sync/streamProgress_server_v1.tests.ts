import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/streamProgress/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases target the
//? per-route business logic — input clamping + completedSteps math +
//? originator-only stream isolation.
//?
//? Input shape (from `streamProgress_server_v1.ts`):
//?   { steps?: number; intervalMs?: number }
//? Output envelope: { status, senderId, completedSteps }
//?
//? IMPORTANT: this route uses `stream(...)` (originator-only) rather than
//? `broadcastStream`/`streamTo`. Over the HTTP/SSE fallback the originator
//? "sink" is the SSE response writer, not a socket — so a second-socket
//? subscriber sees no progress frames. We assert the *isolation* property
//? instead: a watcher joined to the receiver room MUST observe zero
//? progress chunks for this route.

interface ProgressResponse {
  status: string;
  senderId: string;
  completedSteps: number;
}

interface ProgressChunkFrame {
  step?: number;
  total?: number;
  progress?: number;
  phase?: string;
  cb?: string;
  fullName?: string;
  status?: 'stream';
  [key: string]: unknown;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'completedSteps matches requested step count',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      const result = await ctx.callSync<unknown, ProgressResponse>(
        { steps: 3, intervalMs: 30 },
        { receiver: ctx.session.current().token ?? 'test-room' },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.completedSteps, 3);
    },
  },
  {
    name: 'steps input is clamped to the 1..50 range',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      //? Route clamps `Math.max(1, Math.min(50, steps ?? 10))`. Above-max
      //? should saturate at 50. Use a small interval so the test doesn't
      //? spend 7.5s waiting on 50*150ms.
      const high = await ctx.callSync<unknown, ProgressResponse>(
        { steps: 999, intervalMs: 30 },
        { receiver: ctx.session.current().token ?? 'test-room' },
      );
      ctx.expect.eq(high.completedSteps, 50);
    },
  },
  {
    name: 'stream(...) is originator-only — second socket sees no chunks',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const room = session.token;
      //? Watcher joins the room a sibling browser tab would be in. Because
      //? `stream(payload)` unicasts to the originator only, our second
      //? socket MUST NOT receive any frames tagged with this route's
      //? `fullName`. A drift here would mean someone accidentally swapped
      //? `stream` for `broadcastStream` and leaked progress to the room.
      const watcher = await ctx.watchStream<ProgressChunkFrame>(room);

      const result = await ctx.callSync<unknown, ProgressResponse>(
        { steps: 3, intervalMs: 30 },
        { receiver: room },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.completedSteps, 3);

      //? Allow a generous settling window — 3 steps × 30ms = ~90ms of
      //? emit activity. Wait 250ms past that so any rogue late frame would
      //? have surfaced.
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      ctx.expect.eq(watcher.chunks.length, 0, 'expected zero chunks on the second socket');

      await watcher.close();
    },
  },
];
