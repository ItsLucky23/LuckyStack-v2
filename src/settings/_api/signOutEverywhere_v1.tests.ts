import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/signOutEverywhere/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Cases below cover the
//? business invariants the sweep can't reach.
//?
//? Behavior: the route passes the caller's own token as `exceptToken` so
//? "sign out everywhere" sweeps OTHER devices and leaves the caller logged in.
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   { [key: string]: never }  // no fields

interface SignOutSuccess {
  status: 'success';
  result: { revokedSessions: number };
}
interface SignOutError {
  status: 'error';
  errorCode: string;
}
type SignOutResponse = SignOutSuccess | SignOutError;

const seedUser = async (ctx: TestContext): Promise<{ userId: string; token: string }> => {
  const email = `soe-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await ctx.prisma.user.create({
    data: {
      email,
      name: 'Multi Session',
      provider: 'credentials',
      avatarFallback: 'M',
    },
  });
  const { token } = await ctx.session.login({ id: created.id, email, name: 'Multi Session' });
  return { userId: created.id, token };
};

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path returns success with a numeric revokedSessions count',
    run: async (ctx: TestContext) => {
      await seedUser(ctx);
      const result = await ctx.callApi<unknown, SignOutResponse>({});
      ctx.expect.eq(result.status, 'success');
      if (result.status === 'success') {
        ctx.expect.eq(typeof result.result.revokedSessions, 'number');
        ctx.expect.ok(
          result.result.revokedSessions >= 0,
          'revokedSessions must be a non-negative integer',
        );
      }
    },
  },
  {
    name: 'callers own session token stays valid after the sweep',
    run: async (ctx: TestContext) => {
      const { token } = await seedUser(ctx);
      const result = await ctx.callApi<unknown, SignOutResponse>({});
      ctx.expect.eq(result.status, 'success');
      //? Caller's own token must still resolve to a stored session — the
      //? route passes `exceptToken: user.token` to `revokeUserSessions`.
      const { getSession } = await import('@luckystack/login');
      const stillValid = await getSession(token);
      ctx.expect.ok(stillValid !== null, 'caller session must remain valid');
    },
  },
];
