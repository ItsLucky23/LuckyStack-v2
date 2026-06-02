import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/revokeSession/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? cross-user ownership invariant the sweep cannot reach: a user may only
//? revoke a token that belongs to THEM, and may never revoke their own
//? current session through this route (they must log out instead).
//?
//? Test environment runs with `allowMultipleSessions: true` (config.ts dev/
//? localhost env → `session.perUser: 'multiple'`, no cap), so two logins for
//? the same user id keep BOTH session tokens live in Redis — that is how the
//? happy-path case obtains an "other device" token to revoke.
//?
//? Input shape (from the route source `revokeSession_v1.ts`):
//?   { token: string }
//? Output envelope:
//?   { status: 'success', result: {} }
//?   | { status: 'error', errorCode: 'session.invalid' | 'auth.forbidden' }

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
    name: 'happy path revokes another of the callers own sessions',
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

      const result = await ctx.callApi<unknown, RevokeResponse>({ token: otherToken });
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
      //? Passing the caller's own token short-circuits with session.invalid
      //? (the route tells the user to log out instead of self-revoking).
      const result = await ctx.callApi<unknown, RevokeResponse>({ token });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'session.invalid');

      //? The caller's own session must remain valid after the rejected call.
      const { getSession } = await import('@luckystack/login');
      const stillValid = await getSession(token);
      ctx.expect.ok(stillValid !== null, 'caller session must survive a self-revoke attempt');
    },
  },
  {
    name: 'cannot revoke another users session (cross-user ownership)',
    run: async (ctx: TestContext) => {
      //? Victim logs in as their OWN user id and keeps a live token.
      const victim = await ctx.session.login({ email: 'victim@example.com' });
      const victimToken = victim.token;

      //? Attacker is a DIFFERENT user id with a live current session. Single-
      //? session enforcement is per-user, so the victim token stays alive.
      await ctx.session.login({ email: 'attacker@example.com' });

      const result = await ctx.callApi<unknown, RevokeResponse>({ token: victimToken });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'auth.forbidden');

      //? The victim's session must be untouched after the forbidden attempt.
      const { getSession } = await import('@luckystack/login');
      const survived = await getSession(victimToken);
      ctx.expect.ok(survived !== null, 'victim session must survive a cross-user revoke attempt');
    },
  },
];
