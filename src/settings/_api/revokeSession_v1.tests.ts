import { createHash } from 'node:crypto';
import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/revokeSession/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? cross-user ownership invariant the sweep cannot reach: a user may only
//? revoke a session that belongs to THEM, and may never revoke their own
//? current session through this route (they must log out instead).
//?
//? The client passes an opaque `handle` (the 16-char fingerprint from
//? listSessions), never the raw token. The route resolves the handle back to a
//? real token by scanning the CALLER'S own active-session set — so a foreign
//? or unknown handle simply doesn't resolve and yields `session.invalid` (no
//? `auth.forbidden`, no existence signal that would enable enumeration).
//?
//? Test environment runs with `sessionPerUser: 'multiple'` (config.ts dev/
//? localhost env), so two logins for the same user id keep BOTH session tokens
//? live in Redis — that is how the happy-path case obtains an "other device".
//?
//? Input shape (from the route source `revokeSession_v1.ts`):
//?   { handle: string }   // opaque 16-char fingerprint of the target token
//? Output envelope:
//?   { status: 'success', result: {} }
//?   | { status: 'error', errorCode: 'session.invalid' | 'common.500' }

//? Mirror of the route's opaque-handle derivation (sha256 sliced to 16 chars).
const handleOf = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 16);

interface RevokeSuccess {
  status: 'success';
  result: Record<string, never>;
}
interface RevokeError {
  status: 'error';
  errorCode: string;
}
type RevokeResponse = RevokeSuccess | RevokeError;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path revokes another of the callers own sessions by opaque handle',
    run: async (ctx: TestContext) => {
      const { getSession } = await import('@luckystack/login');
      //? First login = the "other device" we will revoke. Capture its token.
      const userId = `revoke-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `${userId}@example.com`;
      const other = await ctx.session.login({ id: userId, email });
      const otherToken = other.token;

      //? Second login for the SAME user = the caller's current session. With
      //? multiple sessions allowed both tokens stay live in Redis.
      await ctx.session.login({ id: userId, email });

      //? Sanity: the other-device session must exist before we revoke it.
      const before = await getSession(otherToken);
      ctx.expect.ok(before !== null, 'precondition: other-device session must be live');

      const result = await ctx.callApi<unknown, RevokeResponse>({ handle: handleOf(otherToken) });
      ctx.expect.eq(result.status, 'success');

      //? Post-condition: the revoked token must no longer resolve to a session.
      const after = await getSession(otherToken);
      ctx.expect.eq(after, null);
    },
  },
  {
    name: 'refuses to revoke the callers own current session',
    run: async (ctx: TestContext) => {
      const { token } = await ctx.session.login();
      //? Passing the fingerprint of the caller's OWN token short-circuits with
      //? session.invalid (the route tells the user to log out instead).
      const result = await ctx.callApi<unknown, RevokeResponse>({ handle: handleOf(token) });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'session.invalid');

      //? The caller's own session must remain valid after the rejected call.
      const { getSession } = await import('@luckystack/login');
      const stillValid = await getSession(token);
      ctx.expect.ok(stillValid !== null, 'caller session must survive a self-revoke attempt');
    },
  },
  {
    name: 'cannot revoke another users session (foreign id does not resolve)',
    run: async (ctx: TestContext) => {
      //? Victim logs in as their OWN user id and keeps a live token.
      const victim = await ctx.session.login({ email: 'victim@example.com' });
      const victimToken = victim.token;

      //? Attacker is a DIFFERENT user id with a live current session. The
      //? victim's fingerprint is not in the attacker's active set, so it cannot
      //? be resolved → session.invalid (NOT auth.forbidden — the route gives no
      //? signal that the token exists for someone else).
      await ctx.session.login({ email: 'attacker@example.com' });

      const result = await ctx.callApi<unknown, RevokeResponse>({ handle: handleOf(victimToken) });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'session.invalid');

      //? The victim's session must be untouched after the forbidden attempt.
      const { getSession } = await import('@luckystack/login');
      const survived = await getSession(victimToken);
      ctx.expect.ok(survived !== null, 'victim session must survive a cross-user revoke attempt');
    },
  },
];
