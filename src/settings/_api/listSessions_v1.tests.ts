import { createHash } from 'node:crypto';
import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/listSessions/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? business logic the sweep cannot reach: the returned set is scoped to the
//? caller (no other user's session leaks), `isCurrent` flags exactly the
//? caller's own session, and the route NEVER returns a raw bearer token —
//? only an opaque 16-char fingerprint (`handle`) of it.
//?
//? Test environment runs with `sessionPerUser: 'multiple'`, so a user can
//? hold several live tokens at once — that is what the multi-session case
//? exercises.
//?
//? Input shape (from the route source `listSessions_v1.ts`):
//?   {}  // no fields
//? Output envelope:
//?   { status: 'success', result: { sessions: Array<{ handle: string;
//?       expiresInSeconds: number | null; isCurrent: boolean }> } }
//?   | { status: 'error', errorCode: 'common.500' }

//? Mirror of the route's opaque-handle derivation (sha256 sliced to 16 chars) —
//? the client only ever sees this, never the raw token.
const handleOf = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 16);

interface SessionEntry {
  handle: string;
  expiresInSeconds: number | null;
  isCurrent: boolean;
}
interface ListSuccess {
  status: 'success';
  result: { sessions: SessionEntry[] };
}
interface ListError {
  status: 'error';
  errorCode: string;
}
type ListResponse = ListSuccess | ListError;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path lists the callers current session by opaque handle, flagged isCurrent',
    run: async (ctx: TestContext) => {
      const { token } = await ctx.session.login();
      const result = await ctx.callApi<unknown, ListResponse>({});
      ctx.expect.eq(result.status, 'success');
      if (result.status !== 'success') return;

      //? The raw token must NEVER appear; the opaque fingerprint of it must.
      const handles = new Set(result.result.sessions.map((s) => s.handle));
      ctx.expect.ok(!handles.has(token), 'raw session token must never be returned to the client');

      const current = result.result.sessions.find((s) => s.handle === handleOf(token));
      ctx.expect.ok(current !== undefined, 'caller session (by opaque handle) must appear in its own list');
      ctx.expect.eq(current?.isCurrent, true);
    },
  },
  {
    name: 'multiple sessions for the same user are all listed, only one isCurrent',
    run: async (ctx: TestContext) => {
      const userId = `list-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `${userId}@example.com`;
      //? First login = a second device. Second login = the caller's current
      //? session. With multiple sessions allowed both stay live in the
      //? active-users set.
      const other = await ctx.session.login({ id: userId, email });
      const current = await ctx.session.login({ id: userId, email });

      const result = await ctx.callApi<unknown, ListResponse>({});
      ctx.expect.eq(result.status, 'success');
      if (result.status !== 'success') return;

      const handles = new Set(result.result.sessions.map((s) => s.handle));
      ctx.expect.ok(handles.has(handleOf(other.token)), 'other-device session (by handle) must be listed');
      ctx.expect.ok(handles.has(handleOf(current.token)), 'current session (by handle) must be listed');

      //? Exactly one entry — the caller's current session — is flagged isCurrent.
      const currentFlagged = result.result.sessions.filter((s) => s.isCurrent);
      ctx.expect.eq(currentFlagged.length, 1);
      ctx.expect.eq(currentFlagged[0]?.handle, handleOf(current.token));
    },
  },
  {
    name: 'another users sessions never leak into the callers list',
    run: async (ctx: TestContext) => {
      //? Victim logs in and holds a live token under their own user id.
      const victim = await ctx.session.login({ email: 'list-victim@example.com' });
      const victimToken = victim.token;

      //? Caller is a DIFFERENT user. Their session list is keyed by THEIR id,
      //? so neither the victim token nor its fingerprint must be present.
      await ctx.session.login({ email: 'list-caller@example.com' });

      const result = await ctx.callApi<unknown, ListResponse>({});
      ctx.expect.eq(result.status, 'success');
      if (result.status !== 'success') return;

      const handles = new Set(result.result.sessions.map((s) => s.handle));
      ctx.expect.ok(!handles.has(victimToken), 'victim raw token must never appear');
      ctx.expect.ok(!handles.has(handleOf(victimToken)), 'victim session must not leak into another users list');
    },
  },
];
