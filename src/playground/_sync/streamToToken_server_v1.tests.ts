import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/streamToToken/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases target the
//? per-route business logic — empty-targets short-circuit + chunkCount
//? math + targetCount echo + observable per-recipient delivery through
//? the second-socket harness.
//?
//? Input shape (from `streamToToken_server_v1.ts`):
//?   { targetTokens: string; text?: string; intervalMs?: number }
//? Output envelope: { status, message, senderId, targetCount, chunkCount }
//?    OR on missing targets: { status: 'error', errorCode: 'playground.streamTo.missingTargets' }

//? S22 transport-parity: the HTTP `callSync` success envelope is the canonical
//? `{ status, message, result: serverOutput }` — the route's `targetCount` /
//? `chunkCount` / `senderId` live under `result`. The ERROR envelope keeps
//? `errorCode` at the top level.
interface ToTokenResponse {
  status: string;
  message?: string;
  errorCode?: string;
  result?: {
    status?: string;
    message?: string;
    senderId?: string;
    targetCount?: number;
    chunkCount?: number;
  };
}

interface StreamToChunkFrame {
  /** Word slice emitted by the route's `streamTo(tokens, { chunk })` call. */
  chunk?: string;
  cb?: string;
  fullName?: string;
  status?: 'stream';
  [key: string]: unknown;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'empty targetTokens returns missingTargets error',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      //? Whitespace-only string parses to zero tokens (split + filter Boolean).
      const result = await ctx.callSync<unknown, ToTokenResponse>(
        { targetTokens: '   ,  ,   ' },
        { receiver: ctx.session.current().token ?? 'test-room' },
      );
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'playground.streamTo.missingTargets');
    },
  },
  {
    name: 'happy path echoes targetCount and emits a chunk per word',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const result = await ctx.callSync<unknown, ToTokenResponse>(
        { targetTokens: session.token, text: 'one two three', intervalMs: 20 },
        { receiver: session.token },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.targetCount, 1);
      //? "one two three" tokenizes (split on /(\s+)/) to 5 entries — 3 words + 2 whitespace separators.
      ctx.expect.ok((result.result?.chunkCount ?? 0) >= 3, 'expected at least 3 chunks');
    },
  },
  {
    name: 'second-socket watcher receives chunks targeted at its session token',
    run: async (ctx: TestContext) => {
      const session = await ctx.session.login();
      const token = session.token;
      //? socket B authenticates with the SAME token as socket A — Socket.io
      //? auto-joins every authed socket into a room named after its token,
      //? so streamTo([token]) reaches every socket holding that session.
      const watcher = await ctx.watchStream<StreamToChunkFrame>(token);

      const result = await ctx.callSync<unknown, ToTokenResponse>(
        { targetTokens: token, text: 'alpha beta gamma', intervalMs: 20 },
        { receiver: token },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.targetCount, 1);

      await watcher.waitForCount(result.result?.chunkCount ?? 1, 3000);

      const first = watcher.chunks[0];
      ctx.expect.ok(first !== undefined, 'expected at least one chunk');
      ctx.expect.eq(first?.fullName, 'sync/playground/streamToToken/v1');
      ctx.expect.eq(first?.status, 'stream');

      //? Verify at least one chunk carries a non-empty `chunk` field.
      const anyText = watcher.chunks.some((c) => typeof c.chunk === 'string' && c.chunk.length > 0);
      ctx.expect.ok(anyText, 'expected at least one non-empty chunk text');

      await watcher.close();
    },
  },
  {
    name: 'untargeted second socket sees zero chunks (per-recipient isolation)',
    run: async (ctx: TestContext) => {
      const sender = await ctx.session.login();
      const senderToken = sender.token;

      //? Logout the sender, then login a fresh session to use as the
      //? "observer". The observer's socket B will auth with the new token
      //? and join a room named after THAT token — distinct from the
      //? sender's. The route streams to `senderToken` only, so the
      //? observer's socket MUST see zero frames.
      await ctx.session.logout();
      const observer = await ctx.session.login();
      const observerToken = observer.token;
      ctx.expect.ok(observerToken !== senderToken, 'observer must hold a distinct token');

      const watcher = await ctx.watchStream<StreamToChunkFrame>(observerToken);

      const result = await ctx.callSync<unknown, ToTokenResponse>(
        //? streamTo targets the original sender's token, NOT the observer's.
        { targetTokens: senderToken, text: 'private message', intervalMs: 20 },
        { receiver: observerToken },
      );
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(result.result?.targetCount, 1);

      //? Wait past the emit window before asserting zero chunks.
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      ctx.expect.eq(watcher.chunks.length, 0, 'expected zero chunks on untargeted watcher');

      await watcher.close();
    },
  },
];
